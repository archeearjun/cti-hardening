

function qaParseBrightspaceGroundTruthCapture_(base64Value, fileName) {
  if (!base64Value) return null;
  if (String(base64Value).length > 56000000) throw new Error('Brightspace live-source JSON is larger than the 40 MB safety limit.');
  var json = Utilities.newBlob(Utilities.base64Decode(base64Value)).getDataAsString();
  var parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Brightspace live-source JSON must contain one capture object.');
  var extractor = String(parsed.extractor || '');
  if (!/Brightspace/i.test(extractor)) throw new Error('The live-source file does not identify itself as a Brightspace CTI capture.');
  var schema = Number(parsed.schemaVersion || 0);
  if (![1,2].includes(schema)) throw new Error('Unsupported Brightspace live-source schema ' + schema + '. Expected schema 1 or 2.');
  var topics = qaBrightspaceFlattenTopics_(parsed.contentTree || []);
  var quizzes = Array.isArray(parsed.quizzes) ? parsed.quizzes : [];
  var assignments = Array.isArray(parsed.assignments) ? parsed.assignments.map(qaNormalizeBrightspaceAssignment_) : [];
  var discussions = Array.isArray(parsed.discussions) ? parsed.discussions : [];
  var quizById = Object.create(null), quizByName = Object.create(null);
  quizzes.forEach(function(q) {
    if (q && q.id != null) quizById[String(q.id)] = q;
    var key = qaCleanName_(q && (q.name || q.title) || '');
    if (key) quizByName[key] = q;
  });
  var assignmentById = Object.create(null), assignmentByName = Object.create(null);
  assignments.forEach(function(a) {
    if (a && a.id != null) assignmentById[String(a.id)] = a;
    var key = qaCleanName_(a && (a.name || a.title) || '');
    if (key) assignmentByName[key] = a;
  });
  var runtimeCarriers = Array.isArray(parsed.runtimeCarriers) ? parsed.runtimeCarriers.slice() : [];
  if (!runtimeCarriers.length && Array.isArray(parsed.runtimeSignals)) {
    runtimeCarriers = parsed.runtimeSignals.filter(function(x){ return /scorm|lti/i.test(String(x && x.activityTypeLabel || '')); }).map(function(x){
      var label=String(x.activityTypeLabel || '');
      return Object.assign({},x,{family:/scorm/i.test(label)?'SCORM':(/lti/i.test(label)?'LTI':'RUNTIME_CARRIER')});
    });
  }
  var interactiveEmbeds = Array.isArray(parsed.interactiveEmbeds) ? parsed.interactiveEmbeds.slice() : [];
  if (!interactiveEmbeds.length) {
    topics.forEach(function(t) {
      ((t.contentEvidence || {}).embeds || []).forEach(function(embed) {
        var u=String(embed && (embed.url || embed.href) || '');
        var family='EMBED';
        if (/practices\.lcs\.brightspace\.com|practice\.html/i.test(u)) family='D2L_PRACTICE_RUNTIME';
        else if (/h5p/i.test(u)) family='H5P';
        else if (/storyline|articulate|rise/i.test(u)) family='ARTICULATE_RUNTIME';
        else if (/youtube|vimeo/i.test(u)) family='VIDEO_EMBED';
        interactiveEmbeds.push({topicId:t.id,topicTitle:t.title,path:t.path,family:family,url:u,tag:embed && embed.tag || ''});
      });
    });
  }
  return {
    fileName:String(fileName || ''),
    sha256:qaSha256Base64_(base64Value),
    schemaVersion:schema,
    extractor:extractor,
    buildId:String(parsed.buildId || ''),
    capturedAt:String(parsed.capturedAt || ''),
    course:parsed.course || {},
    page:parsed.page || {},
    summary:parsed.summary || {},
    safety:parsed.safety || {},
    permissionBlocks:Array.isArray(parsed.permissionBlocks) ? parsed.permissionBlocks : [],
    topics:topics,
    quizzes:quizzes,
    discussions:discussions,
    assignments:assignments,
    quizById:quizById,
    quizByName:quizByName,
    assignmentById:assignmentById,
    assignmentByName:assignmentByName,
    runtimeCarriers:runtimeCarriers,
    interactiveEmbeds:interactiveEmbeds,
    warnings:Array.isArray(parsed.captureWarnings) ? parsed.captureWarnings.slice() : []
  };
}

function qaBrightspaceIdentityGuard_(liveCapture, packageMeta) {
  liveCapture = liveCapture || {}; packageMeta = packageMeta || {};
  var liveTitle = String((liveCapture.course || {}).title || (liveCapture.page || {}).title || '');
  var packageTitle = String(packageMeta.fileName || '');
  var liveCode = qaBrightspaceCourseCode_(liveTitle);
  var packageCode = qaBrightspaceCourseCode_(packageTitle);
  if (liveCode && packageCode && liveCode !== packageCode) {
    return {ok:false,hardMismatch:true,liveCode:liveCode,packageCode:packageCode,reason:'Brightspace capture is for ' + liveCode + ' but the saved source package resolves to ' + packageCode + '.'};
  }
  return {ok:true,hardMismatch:false,liveCode:liveCode,packageCode:packageCode,reason:liveCode && packageCode ? 'Course code agrees.' : 'No conflicting explicit course code was observed.'};
}

function qaBrightspaceTopicType_(topic) {
  var label = String(topic && topic.activityTypeLabel || '').toLowerCase();
  var url = String(topic && topic.url || '').toLowerCase();
  if (/quiz/.test(label) || /type=quiz/.test(url)) return 'Assessment';
  if (/discussion/.test(label) || /type=discuss/.test(url)) return 'Discussion';
  if (/dropbox|assignment/.test(label) || /type=dropbox/.test(url)) return 'Assignment';
  if (/lti/.test(label)) return 'LTI';
  if (/scorm/.test(label)) return 'Plugin';
  return 'Reading';
}

function qaBrightspaceMatchScore_(source, topic) {
  var st = qaCleanName_(source && source.name || '');
  var tt = qaCleanName_(topic && topic.title || '');
  if (!st || !tt) return 0;
  var score = st === tt ? 0.82 : fuzzyMatchScore_(st,tt) * 0.65;
  var sp = qaCleanText_(source && source.path || '');
  var tp = qaCleanText_(topic && topic.path || '');
  var pathScore = qaPathSimilarity_(sp,tp);
  if (pathScore != null) score += 0.18 * pathScore;
  var lt = qaBrightspaceTopicType_(topic);
  if (qaTypesCompatible_(source && source.type || '', lt)) score += 0.10;
  return Math.min(1,score);
}

function qaMergeInteractiveSignals_(existing, additions) {
  existing = existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {};
  additions = additions && typeof additions === 'object' ? additions : {};
  var families = [];
  (existing.runtimeFamilies || []).concat(additions.runtimeFamilies || []).forEach(function(v){ if(v && families.indexOf(v)===-1) families.push(v); });
  if (additions.detected === true) existing.detected = true;
  if (families.length) existing.runtimeFamilies = families;
  if (additions.confidence) existing.confidence = additions.confidence;
  var notes=[String(existing.note || ''),String(additions.note || '')].filter(Boolean);
  if (notes.length) existing.note=notes.filter(function(v,i,a){return a.indexOf(v)===i;}).join(' | ');
  existing.liveSourceObserved = existing.liveSourceObserved === true || additions.liveSourceObserved === true;
  return existing;
}

function qaApplyBrightspaceGroundTruth_(sourceItems, liveCapture, packageMeta, bundledAssets) {
  sourceItems = Array.isArray(sourceItems) ? sourceItems : [];
  if (!liveCapture) return {sourceItems:sourceItems,report:null};
  var guard = qaBrightspaceIdentityGuard_(liveCapture, packageMeta || {});
  if (!guard.ok) throw new Error('Live source course mismatch: ' + guard.reason);
  var topics = liveCapture.topics || [];
  var topicUsed = Object.create(null), matches = [], drift = [], contradictions = [], evidenceReviews = [], bundledMatches = [];
  sourceItems.forEach(function(source) {
    var best=null,bestScore=0,bestIndex=-1;
    for (var i=0;i<topics.length;i++) {
      if (topicUsed[i]) continue;
      var score=qaBrightspaceMatchScore_(source,topics[i]);
      if(score>bestScore){bestScore=score;best=topics[i];bestIndex=i;}
    }
    if(!best || bestScore < 0.76) return;
    topicUsed[bestIndex]=true;
    var liveMeta={topicId:best.id,title:best.title,path:best.path,matchScore:Number(bestScore.toFixed(3)),activityTypeLabel:best.activityTypeLabel,contentEvidenceStatus:String((best.contentEvidence||{}).status||''),textSample:'',textLength:0};
    var enriched=[];
    var liveText=qaCleanText_((best.contentEvidence||{}).text || qaBrightspaceText_(best.description || ''));
    liveMeta.textSample=liveText.slice(0,40000); liveMeta.textLength=liveMeta.textSample.length;
    if(liveText && !source.textSample){ source.textSample=liveText; source.textLength=liveText.length; enriched.push('TEXT'); }
    else if(liveText && source.textSample && !source.isStructuredAssessment) {
      var liveTextSimilarity = qaDirectionalSemanticSimilarity_(source.textSample, liveText);
      var reverseLiveTextSimilarity = qaDirectionalSemanticSimilarity_(liveText, source.textSample);
      var strongestTextSimilarity = Math.max(liveTextSimilarity, reverseLiveTextSimilarity);
      if (source.textSample.length >= 160 && liveText.length >= 160 && strongestTextSimilarity > 0 && strongestTextSimilarity < 0.45) {
        var textPolicy = workSourceItemPolicy_((packageMeta || {}).partner || '', source);
        contradictions.push({sourceName:source.name,sourcePath:source.path,kind:'LIVE_TEXT_MATERIALLY_DIFFERS_FROM_PACKAGE',liveTopic:best.title,similarity:Number(strongestTextSimilarity.toFixed(3)),decisionRelevant:!(textPolicy && textPolicy.inDecisionGate === false)});
      }
    }
    var topicType=qaBrightspaceTopicType_(best);
    if(/Assessment/i.test(source.type || '') || topicType==='Assessment') {
      var q = null;
      if(best.toolItemId != null) q=liveCapture.quizById[String(best.toolItemId)] || null;
      if(!q) q=liveCapture.quizByName[qaCleanName_(best.title)] || null;
      var liveAssessment=qaBrightspaceQuizToAssessment_(q);
      var liveQuizBehaviorV8=qaBrightspaceQuizBehaviorV8_(q);
      if(liveQuizBehaviorV8 && liveQuizBehaviorV8.observed===true && !(source.behavior && source.behavior.observed===true)){
        source.behavior=liveQuizBehaviorV8; enriched.push('BEHAVIOR');
      }
      if(liveAssessment) {
        if(!source.structuredAssessment){ source.structuredAssessment=liveAssessment; source.isStructuredAssessment=true; enriched.push('ASSESSMENT'); }
        else {
          var packageCount=Number((source.structuredAssessment||{}).declaredQuestionCount || (source.structuredAssessment||{}).questionCount || 0);
          var liveCount=Number(liveAssessment.declaredQuestionCount || liveAssessment.questionCount || 0);
          if(packageCount && liveCount && packageCount !== liveCount) {
            var quizPolicy = workSourceItemPolicy_((packageMeta || {}).partner || '', source);
            evidenceReviews.push({sourceName:source.name,sourcePath:source.path,kind:'QUIZ_COUNT_MEASURES_NOT_EQUIVALENT',packageCount:packageCount,liveCapturedDefinitions:liveAssessment.questionCount,liveDeclaredCount:qaBrightspaceQuizCaptureSummary_([q]).items[0].descriptionQuestionCount,reason:'Package question-bank size and captured live definitions do not establish delivered quiz length or deleted questions.',decisionRelevant:!(quizPolicy && quizPolicy.inDecisionGate === false)});
          }
        }
      }
    }
    if(/Assignment/i.test(source.type || '') || topicType==='Assignment') {
      var a=null;
      if(best.toolItemId != null) a=liveCapture.assignmentById[String(best.toolItemId)] || null;
      if(!a) a=liveCapture.assignmentByName[qaCleanName_(best.title)] || null;
      var behavior=qaBrightspaceAssignmentBehavior_(a);
      if(behavior && behavior.observed===true && !(source.behavior && source.behavior.observed===true)){source.behavior=behavior; enriched.push('BEHAVIOR');}
    }
    var families=[];
    (liveCapture.runtimeCarriers || []).forEach(function(r){
      var sameId=String(r.id||'') && String(r.id||'')===String(best.id||'');
      var sameTitle=qaCleanName_(r.title||'') && qaCleanName_(r.title||'')===qaCleanName_(best.title||'');
      if(sameId||sameTitle){var f=String(r.family||r.activityTypeLabel||'RUNTIME').toUpperCase(); if(families.indexOf(f)===-1)families.push(f);}
    });
    (liveCapture.interactiveEmbeds || []).forEach(function(r){
      var sameId=String(r.topicId||'') && String(r.topicId||'')===String(best.id||'');
      var sameTitle=qaCleanName_(r.topicTitle||'') && qaCleanName_(r.topicTitle||'')===qaCleanName_(best.title||'');
      var f=String(r.family||'').toUpperCase();
      if((sameId||sameTitle) && f && f!=='VIDEO_EMBED' && families.indexOf(f)===-1) families.push(f);
    });
    if(families.length){source.interactiveSignals=qaMergeInteractiveSignals_(source.interactiveSignals,{detected:true,runtimeFamilies:families,confidence:'HIGH',liveSourceObserved:true,note:'Positive interactive/runtime evidence observed in live Brightspace.'}); enriched.push('RUNTIME');}
    source.liveSource=liveMeta;
    source.liveSource.enrichedFields=enriched;
    var competitors=topics.filter(function(t){return String(t.id)!==String(best.id) && qaBrightspaceMatchScore_(source,t)>=bestScore-0.03;});
    var navigationArea=function(path){return /(?:^|>)\s*Archive\s*(?:>|$)/i.test(path)?'archive':/(?:^|>)\s*Instructor Resources\s*(?:>|$)/i.test(path)?'instructor':'learner';};
    matches.push({sourceId:source.id||'',sourceName:source.name,sourcePath:source.path,topicId:best.id,topicTitle:best.title,score:liveMeta.matchScore,enrichedFields:enriched,navigationEligible:bestScore>=0.90 && competitors.length===0 && qaCleanName_(source.name)===qaCleanName_(best.title) && navigationArea(source.path)===navigationArea(best.path)});
  });
  // Binary documents are intentionally outside the core learner-item denominator.
  // They still exist in the package and must not be labelled live-only drift.
  (bundledAssets || []).forEach(function(asset) {
    var candidates=[];
    topics.forEach(function(t,i) {
      if(topicUsed[i] || qaCleanName_(asset.name)!==qaCleanName_(t.title)) return;
      var sourcePath=String(asset.path||'').split('>').map(qaCleanName_).filter(Boolean);
      var livePath=String(t.path||'').split('>').map(qaCleanName_).filter(Boolean);
      var ancestry=sourcePath.length>0 && sourcePath.every(function(v,i){return livePath[i]===v;});
      if(!ancestry)return;
      var score=qaBrightspaceMatchScore_(asset,t);
      if(score>=0.90)candidates.push({topic:t,index:i,score:score});
    });
    candidates.sort(function(a,b){return b.score-a.score;});
    if(!candidates.length || (candidates.length>1 && candidates[0].score-candidates[1].score<0.03))return;
    var best=candidates[0];topicUsed[best.index]=true;
    bundledMatches.push({sourceId:asset.id,sourceName:asset.name,sourcePath:asset.path,topicId:best.topic.id,topicTitle:best.topic.title,scope:'PACKAGE_ATTACHMENT_IDENTITY_ONLY',contentVerified:false});
  });
  topics.forEach(function(t,i){
    if(topicUsed[i]) return;
    var livePolicy = workSourceItemPolicy_((packageMeta || {}).partner || '', {name:t.title,path:t.path,type:qaBrightspaceTopicType_(t)});
    drift.push({id:t.id,title:t.title,path:t.path,type:qaBrightspaceTopicType_(t),activityTypeLabel:t.activityTypeLabel,decisionRelevant:!(livePolicy && livePolicy.inDecisionGate === false),policyReason:livePolicy && livePolicy.reason || ''});
  });
  var decisionRelevantLiveOnly = drift.filter(function(x){ return x.decisionRelevant !== false; });
  var decisionRelevantContradictions = contradictions.filter(function(x){ return x.decisionRelevant !== false; });
  var report={
    status:(decisionRelevantLiveOnly.length || decisionRelevantContradictions.length || evidenceReviews.some(function(x){return x.decisionRelevant!==false;})) ? 'REVIEW' : 'CORROBORATED',
    platform:'BRIGHTSPACE',
    fileName:liveCapture.fileName,
    sha256:liveCapture.sha256,
    schemaVersion:liveCapture.schemaVersion,
    extractor:liveCapture.extractor,
    buildId:liveCapture.buildId,
    capturedAt:liveCapture.capturedAt,
    course:liveCapture.course,
    identity:guard,
    matchedSourceItems:matches.length,
    sourceTopicMappings:matches,
    matchedBundledAssetCount:bundledMatches.length,
    matchedBundledAssets:bundledMatches,
    evidenceReviews:evidenceReviews,
    evidenceReviewCount:evidenceReviews.length,
    liveTopicCount:topics.length,
    liveOnlyItems:drift.slice(0,100),
    liveOnlyCount:drift.length,
    liveOnlyDecisionRelevantCount:decisionRelevantLiveOnly.length,
    contradictions:contradictions.slice(0,100),
    contradictionCount:contradictions.length,
    contradictionDecisionRelevantCount:decisionRelevantContradictions.length,
    permissionBlocks:(liveCapture.permissionBlocks||[]).length,
    runtimeCarriers:(liveCapture.runtimeCarriers||[]).length,
    interactiveEmbeds:(liveCapture.interactiveEmbeds||[]).filter(function(x){return String(x.family||'').toUpperCase()!=='VIDEO_EMBED';}).length,
    videoEmbeds:(liveCapture.interactiveEmbeds||[]).filter(function(x){return String(x.family||'').toUpperCase()==='VIDEO_EMBED';}).length,
    warnings:(liveCapture.warnings||[]).slice()
  };
  report.quizCapture=qaBrightspaceQuizCaptureSummary_(liveCapture.quizzes);
  return {sourceItems:sourceItems,report:report};
}

function qaApplyLiveSourceReviewPolicy_(operationalPolicy, liveReport) {
  operationalPolicy=operationalPolicy||{};
  if(!liveReport) return operationalPolicy;
  operationalPolicy.liveSourceGroundTruth=liveReport;
  var requiresReview=Number(liveReport.liveOnlyDecisionRelevantCount == null ? liveReport.liveOnlyCount : liveReport.liveOnlyDecisionRelevantCount)>0 || Number(liveReport.contradictionDecisionRelevantCount == null ? liveReport.contradictionCount : liveReport.contradictionDecisionRelevantCount)>0 || (liveReport.evidenceReviews||[]).some(function(x){return x.decisionRelevant!==false;});
  operationalPolicy.liveSourceReviewRequired=requiresReview;
  if(requiresReview && operationalPolicy.recommendationCode==='KEEP'){
    operationalPolicy.recommendationCode='REVIEW';
    operationalPolicy.recommendationLabel='REVIEW';
    operationalPolicy.recommendationReason='Automated destination checks meet KEEP thresholds, but live Brightspace ground truth has unresolved source drift, contradictory source evidence, or permission-limited areas. Resolve that source-evidence review before KEEP.';
  }
  return operationalPolicy;
}

function flattenTreeForQa_(nodes, currentPath) {
    currentPath = currentPath || "";
    var items = [];

    function traverse(list, path, parentItem) {
        for (var i = 0; i < (list || []).length; i++) {
            var node = list[i] || {};
            var nodeTypeRaw = String(node.type || '');
            var isFolder = nodeTypeRaw === 'folder' && !node.idref;
            var nodeTitle = String(node.title || "Untitled");
            var newPath = path ? path + " > " + nodeTitle : nodeTitle;
            var itemMeta = null;

            if (!isFolder && !node.autoDeleted) {
                var tool = "Reading";
                if (nodeTypeRaw.indexOf('imsqti') > -1) tool = "Assessment";
                else if (nodeTypeRaw.indexOf('assignment') > -1) tool = "Assignment";
                else if (nodeTypeRaw.indexOf('imsdt') > -1) tool = "Discussion";
                else if (nodeTypeRaw.indexOf('imsbasiclti') > -1) tool = "LTI";
                else if (nodeTypeRaw === "plugin") tool = "Plugin";

                var titleLow = nodeTitle.toLowerCase();
                var isRawAsset = /\.(pdf|pptx|ppt|docx|doc|zip|xlsx|xls|csv)$/.test(titleLow);
                var payload = node.sourcePayload || {};
                itemMeta = {
                    id: String(payload.resourceId || node.idref || ''),
                    name: nodeTitle,
                    type: tool
                };

                items.push({
                    id: itemMeta.id,
                    name: nodeTitle,
                    type: tool,
                    sourceTypeRaw: nodeTypeRaw,
                    path: path || "Root",
                    hierarchyPath: parentItem ? ((path ? path + " > " : "") + parentItem.name) : (path || "Root"),
                    parentSourceId: parentItem ? String(parentItem.id || '') : '',
                    parentSourceName: parentItem ? String(parentItem.name || '') : '',
                    parentSourceType: parentItem ? String(parentItem.type || '') : '',
                    isRawAsset: isRawAsset,
                    sourceFiles: Array.isArray(payload.files) ? payload.files : [],
                    sourceLinks: Array.isArray(payload.links) ? payload.links : [],
                    sourceImages: Array.isArray(payload.images) ? payload.images : [],
                    sourceEmbeddedRefs: Array.isArray(payload.embeddedRefs) ? payload.embeddedRefs : [],
                    sourceDependencies: Array.isArray(payload.dependencies) ? payload.dependencies : [],
                    sourceTextSample: String(payload.textSample || ''),
                    sourceTextFormat: String(payload.textFormat || ''),
                    sourceTextNormalizationStatus: String(payload.textNormalizationStatus || ''),
                    sourceTextSha256: String(payload.textSha256 || ''),
                    sourceTextLength: nonNegativeInteger_(payload.textLength),
                    sourceStructuredAssessment: (payload.structuredAssessment && typeof payload.structuredAssessment === 'object') ? payload.structuredAssessment : null,
                    sourceBehavior: (payload.behavior && typeof payload.behavior === 'object') ? payload.behavior : null,
                    sourceInteractiveSignals: (payload.interactiveSignals && typeof payload.interactiveSignals === 'object') ? payload.interactiveSignals : null,
                    sourceEvidenceSchemaVersion: nonNegativeInteger_(payload.schemaVersion),
                    sourceEvidenceExtractor: qaCleanText_(payload.evidenceExtractor || ''),
                    sourceEvidenceBuildId: qaCleanText_(payload.evidenceBuildId || ''),
                    sourceEvidenceTruncated: payload.evidenceTruncated === true,
                    matched: false
                });
            }

            if (node.children) traverse(node.children, isFolder ? newPath : path, !isFolder && itemMeta ? itemMeta : parentItem);
        }
    }

    traverse(nodes, currentPath, null);
    return items;
}
