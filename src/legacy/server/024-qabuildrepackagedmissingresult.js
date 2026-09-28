

function qaBuildRepackagedMissingResult_(source, recovery, snapshotContext) {
    var titleDerived = recovery && recovery.titleDerivedRecovery === true;
    var semanticRecovered = recovery && recovery.semanticRecovered === true;
    var semanticCarrier = recovery && recovery.semanticCarrierEvidence || null;
    var identityRecovered = recovery && recovery.identityRecovered === true;
    var identityCarrier = recovery && recovery.identityCarrierEvidence || null;
    var sourcePayloadAvailable = recovery && recovery.sourcePayloadAvailable === true;
    var assetExpected = (source.assetDetails || []).map(function(d) { return qaAssetDescriptor_(d); }).filter(function(d) {
        return d.referenceOnly !== true && d.presentInPackage !== false;
    }).map(function(d) { return d.name || d.url || d.href || d.path; }).filter(Boolean);
    var linkExpected = (source.links || []).map(function(d) { return d.raw || d.normalized; }).filter(Boolean);
    if (!assetExpected.length && titleDerived) assetExpected = [source.name + ' [source item title proxy]'];

    var recoveredAssets = (recovery.relocatedAssets || []).map(function(m) { return m.expected; });
    var recoveredLinks = (recovery.relocatedLinks || []).map(function(m) { return m.expected; });

    var possible = 30, earned = 0;
    if (semanticRecovered && semanticCarrier) { possible += 25; earned += 25; }
    if (identityRecovered && identityCarrier) { possible += 20; earned += 20; }
    if (assetExpected.length) { possible += 20; earned += 10 * Math.min(1, recoveredAssets.length / assetExpected.length); }
    if (linkExpected.length) { possible += 10; earned += 5 * Math.min(1, recoveredLinks.length / linkExpected.length); }

    var bestPathScore = null;
    (recovery.carriers || []).forEach(function(carrier) {
        var sim = qaPathSimilarity_(source.path, carrier.path);
        if (sim !== null && (bestPathScore === null || sim > bestPathScore)) bestPathScore = sim;
    });
    if (bestPathScore !== null) {
        possible += 10;
        if (bestPathScore >= 0.62) earned += 10;
        else if (bestPathScore >= 0.40) earned += 5;
    }

    var observedPublication = (recovery.carriers || []).some(function(c) { return c.published === true || c.published === false; });
    var publishedCarrier = (recovery.carriers || []).some(function(c) { return c.published === true; });
    if (observedPublication) {
        possible += 5;
        if ((snapshotContext && snapshotContext.mode === 'RAW_INGESTION') || publishedCarrier) earned += 5;
    }

    var issues = ['STRUCTURE_REPACKAGED'];
    if (semanticRecovered) issues.push('SEMANTIC_REPACKAGING_CONFIRMED');
    if (identityRecovered) issues.push('STRUCTURAL_IDENTITY_REPACKAGING');
    if (titleDerived) issues.push('TITLE_DERIVED_RECOVERY');
    if (titleDerived && !sourcePayloadAvailable) issues.push('SOURCE_PAYLOAD_NOT_AVAILABLE');
    if (!recovery.allRecovered) issues.push('PAYLOAD_UNVERIFIED');

    var result = {
        sourceId: source.id, sourceName: source.name, sourceType: source.type, sourcePath: source.path,
        courseraId: recovery.carriers && recovery.carriers.length === 1 ? recovery.carriers[0].id : '',
        courseraName: recovery.carriers && recovery.carriers.length === 1 ? recovery.carriers[0].name : '',
        courseraType: recovery.carriers && recovery.carriers.length === 1 ? recovery.carriers[0].type : '',
        courseraPath: recovery.carriers && recovery.carriers.length === 1 ? recovery.carriers[0].path : '',
        matchScore: 0,
        fidelityPercent: possible ? Math.round((earned / possible) * 100) : 0,
        evidenceCoverage: Math.min(100, Math.round(possible)),
        earnedPoints: Number(earned.toFixed(2)), possiblePoints: possible,
        verdict: 'REPACKAGED', issues: issues,
        checks: {
            structure: { status: 'REPACKAGED', weight: 30,
                reason: semanticRecovered
                    ? 'The source item is absent as a standalone Coursera item, but strong same-module learner-text evidence proves that its content survives inside a compatible destination item.'
                    : (identityRecovered
                        ? 'The source item is absent as a standalone Coursera item, but a unique same-module Discussion with the same distinctive activity identity and strong destination evidence proves structural survival. Source prompt equivalence remains unverified.'
                        : 'The source item is absent as a standalone Coursera item, but positive payload evidence was observed inside another Coursera item.') },
            semanticRepackaging: semanticRecovered && semanticCarrier ? {
                status:'VERIFIED', method:semanticCarrier.method || '', score:Number(semanticCarrier.score || 0),
                carrierId:semanticCarrier.carrierId || '', carrierName:semanticCarrier.carrierName || '', carrierType:semanticCarrier.carrierType || '', carrierPath:semanticCarrier.carrierPath || '',
                pathScore:Number(semanticCarrier.pathScore || 0), titleScore:Number(semanticCarrier.titleScore || 0),
                textComparison:semanticCarrier.textComparison || null, reason:semanticCarrier.reason || '', weight:25
            } : { status:'NOT_APPLICABLE', weight:25 },
            identityRepackaging: identityRecovered && identityCarrier ? {
                status:'VERIFIED_IDENTITY_PAYLOAD_UNVERIFIED', method:identityCarrier.method || '', score:Number(identityCarrier.score || 0),
                identityKey:identityCarrier.identityKey || '', carrierId:identityCarrier.carrierId || '', carrierName:identityCarrier.carrierName || '', carrierType:identityCarrier.carrierType || '', carrierPath:identityCarrier.carrierPath || '',
                pathScore:Number(identityCarrier.pathScore || 0), textEvidenceCompleteness:Number(identityCarrier.textEvidenceCompleteness || 0),
                knownConsolidationCarrier:identityCarrier.knownConsolidationCarrier === true, reason:identityCarrier.reason || '', weight:20
            } : { status:'NOT_APPLICABLE', weight:20 },
            assets: assetExpected.length ? {
                status: titleDerived ? 'TITLE_DERIVED_RELOCATION' : (recovery.unresolvedAssets.length ? 'REPACKAGED_PARTIAL' : 'RELOCATED'),
                expected: assetExpected, present: [], relocated: recovery.relocatedAssets || [], missing: [],
                unresolved: titleDerived ? [] : (recovery.unresolvedAssets || []), matches: [],
                evidenceConfidence: recovery.relocatedAssets.length ? Math.round(Math.min.apply(null, recovery.relocatedAssets.map(function(m) { return Number(m.score || 0); })) * 100) : 0,
                reason: titleDerived
                    ? 'The source tree did not preserve an item-level payload fingerprint. An actual Coursera asset filename strongly matches the source item identity, so survival/repackaging is inferred but binary equivalence is not proven.'
                    : (recovery.unresolvedAssets.length
                        ? 'Some expected source assets were positively observed elsewhere in Coursera; remaining assets are unresolved, not proven missing.'
                        : 'Expected source assets were positively observed in other Coursera item(s).'),
                weight: 20
            } : { status: 'NOT_APPLICABLE', expected: [], matches: [], weight: 20 },
            links: linkExpected.length ? {
                status: recovery.unresolvedLinks.length ? 'REPACKAGED_PARTIAL' : 'RELOCATED',
                expected: linkExpected, present: [], relocated: recovery.relocatedLinks || [], missing: [],
                unresolved: recovery.unresolvedLinks || [],
                evidenceConfidence: recovery.relocatedLinks.length ? 100 : 0,
                reason: recovery.unresolvedLinks.length
                    ? 'Some expected source links were positively observed elsewhere in Coursera; remaining links are unresolved.'
                    : 'Expected source links were observed in other Coursera item(s).',
                weight: 10
            } : { status: 'NOT_APPLICABLE', expected: [], weight: 10 },
            publication: observedPublication ? {
                status: (snapshotContext && snapshotContext.mode === 'RAW_INGESTION') ? (publishedCarrier ? 'RAW_PUBLISHED' : 'RAW_UNPUBLISHED') : (publishedCarrier ? 'VERIFIED' : 'UNPUBLISHED'),
                published: publishedCarrier,
                weight: 5,
                reason: (snapshotContext && snapshotContext.mode === 'RAW_INGESTION') ? 'Carrier publication state is observed but not penalized in a raw-ingestion snapshot.' : ''
            } : { status:'UNVERIFIED', published:null, weight:5 },
            repackaging: {
                status: semanticRecovered ? (recovery.allRecovered ? 'VERIFIED' : 'PARTIAL') : (identityRecovered ? 'IDENTITY_VERIFIED_PAYLOAD_UNVERIFIED' : (titleDerived ? 'INFERRED' : (recovery.allRecovered ? 'VERIFIED' : 'PARTIAL'))),
                recoveryRatio: recovery.recoveryRatio, recoveredCount: recovery.recoveredCount,
                totalExpected: recovery.totalExpected, sourcePayloadAvailable: sourcePayloadAvailable,
                titleDerivedRecovery: titleDerived, semanticRecovered:semanticRecovered, identityRecovered:identityRecovered, inferredWhilePayloadAvailable: recovery.inferredWhilePayloadAvailable === true, ignoredSourceReferenceAssets: recovery.ignoredSourceReferenceAssets || [], carriers: recovery.carriers || [], weight: 0
            }
        },
        repackaging: recovery,
        snapshotContext: snapshotContext || null,
        evidenceSources: semanticRecovered
            ? ['Cross-item Coursera payload graph', 'Cross-item learner-text semantic evidence']
            : (identityRecovered
                ? ['Cross-item structural identity evidence', 'Destination learner-surface evidence']
                : (titleDerived
                ? ['Cross-item Coursera payload graph', 'Source-title-to-observed-asset inference']
                : ['Cross-item Coursera payload graph']))
    };
    result.ownerAction = qaOwnerActionForResult_(result);
    result.evidenceStrength = qaEvidenceStrength_(result);
    return result;
}


// -------------------------------------------------------------------
// LIVE SOURCE ADAPTER — BRIGHTSPACE
// Package evidence remains the immutable ingestion denominator. Live Brightspace
// can corroborate or fill otherwise-unobservable evidence on an already-matched
// source item, but it never silently adds live-only items to the re-ingestion
// denominator. Contradictions become source-drift review evidence.
// -------------------------------------------------------------------
function qaBrightspaceText_(value, depth) {
  if(value==null || Number(depth||0)>12) return '';
  if(typeof value==='string') return value==='[object Object]'?'':qaCleanText_(value);
  if(typeof value!=='object') return '';
  var keys=['text','Text'];
  for(var i=0;i<keys.length;i++) if(value[keys[i]]!=null){var text=qaBrightspaceText_(value[keys[i]],Number(depth||0)+1);if(text)return text;}
  var html=typeof value.html==='string'?value.html:(typeof value.Html==='string'?value.Html:'');
  return html?qaLearnerMarkupText_(html):'';
}

function qaBrightspacePath_(value) {
  if (Array.isArray(value)) return value.map(qaCleanText_).filter(Boolean).join(' > ');
  return qaCleanText_(value || 'Root') || 'Root';
}

function qaBrightspaceCourseCode_(value) {
  var m = String(value || '').match(/\b([A-Za-z]{2,8}\d{2,4})\b/);
  return m ? String(m[1]).toUpperCase().replace(/B0RL/g,'BORL') : '';
}

function qaBrightspaceFlattenTopics_(contentTree) {
  var out = [];
  function walk(nodes) {
    (nodes || []).forEach(function(node) {
      node = node || {};
      if (String(node.kind || '').toUpperCase() === 'TOPIC') {
        out.push({
          id:String(node.id || ''),
          title:qaCleanText_(node.title || ''),
          path:qaBrightspacePath_(node.path || []),
          topicType:node.topicType,
          contentType:node.contentType,
          activityType:node.activityType,
          activityTypeLabel:qaCleanText_(node.activityTypeLabel || ''),
          toolId:node.toolId == null ? null : node.toolId,
          toolItemId:node.toolItemId == null ? null : node.toolItemId,
          url:String(node.url || ''),
          description:node.description || {},
          contentEvidence:node.contentEvidence || {}
        });
      }
      if (Array.isArray(node.children)) walk(node.children);
    });
  }
  walk(contentTree || []);
  return out;
}

function qaBrightspaceQuestionType_(q) {
  q = q || {};
  var id = Number(q.QuestionTypeId || q.questionTypeId || 0);
  if (id === 1) return 'single-select';
  if (id === 2) return 'true-false';
  if (id === 3) return 'text-entry';
  if (id === 4) return 'multiple-select';
  if (id === 7) return 'essay';
  if (id === 8) return 'text-entry';
  return 'unknown';
}

function qaBrightspaceQuizQuestion_(q, index) {
  q = q || {};
  var info = q.QuestionInfo || q.questionInfo || {};
  var type = qaBrightspaceQuestionType_(q);
  var options = [], correct = [], answerReliable=true;
  if (type === 'true-false') {
    var tw=info.TrueWeight==null?null:Number(info.TrueWeight),fw=info.FalseWeight==null?null:Number(info.FalseWeight);
    answerReliable=tw!=null&&fw!=null&&Number.isFinite(tw)&&Number.isFinite(fw)&&((tw===100&&fw===0)||(fw===100&&tw===0));
    options=[{id:String(info.TruePartId||'true'),text:'True',correct:tw===100},{id:String(info.FalsePartId||'false'),text:'False',correct:fw===100}];
  } else if (Array.isArray(info.Answers)) {
    options = info.Answers.map(function(a, i) {
      a = a || {};
      var txt = qaBrightspaceText_(a.Answer || a.answer || a.Text || a.text || '');
      var rawWeight=a.Weight==null?a.weight:a.Weight, weight=rawWeight==null?null:Number(rawWeight);
      var flag=typeof a.IsCorrect==='boolean'?a.IsCorrect:(typeof a.isCorrect==='boolean'?a.isCorrect:null);
      if(type==='multiple-select'&&flag===null) answerReliable=false;
      if(type==='single-select'&&(weight==null||!Number.isFinite(weight)||[0,100].indexOf(weight)===-1)) answerReliable=false;
      var isCorrect=flag!==null?flag:weight===100;
      return {id:String(a.PartId || a.partId || i+1),text:txt,correct:isCorrect};
    }).filter(function(o){ return !!o.text; });
    if(type==='single-select' && options.filter(function(o){return o.correct;}).length!==1) answerReliable=false;
  } else if (type === 'text-entry' && Array.isArray(info.Blanks)) {
    if(info.Blanks.length!==1) answerReliable=false;
    (info.Blanks || []).forEach(function(blank) {
      (blank.Answers || []).forEach(function(a) {
        var answer=qaCleanText_(a.TextAnswer||a.textAnswer||a.Text||'');
        var weight=a.Weight==null?a.weight:a.Weight;
        if(weight==null||!Number.isFinite(Number(weight))||[0,100].indexOf(Number(weight))===-1) answerReliable=false;
        if(answer&&Number(weight)===100)correct.push(answer);
      });
    });
  }
  if (!correct.length) options.forEach(function(o){ if(o.correct) correct.push(o.text); });
  return {
    id:String(q.QuestionId || q.questionId || index+1),
    number:index+1,
    type:type,
    prompt:qaBrightspaceText_(q.QuestionText || q.questionText || q.Name || q.name || ''),
    options:options,
    correctAnswers:correct,
    feedback:qaBrightspaceText_(q.Feedback || q.feedback || ''),
    points:q.Points!=null && Number.isFinite(Number(q.Points)) ? Number(q.Points) : null,
    optionTextReliable:true,
    answerTextReliable:answerReliable && correct.length > 0,
    parserConfidence:0.98
  };
}

function ctiDeclaredQuizCountFromText_(value) {
  var text=String(value || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  // Exam length is metadata, not a proof of question-bank or pool completeness.
  var pattern=/\b(\d+)[ -]+(?:(?:short[ -]answer|true\s*\/\s*false|multiple[ -]choice|multiple[ -]select|matching|essay|numeric|written[ -]response)(?:\s*,?\s*(?:and\s+)?))*questions?\b/gi;
  var counts=[],m;
  while((m=pattern.exec(text))) {
    var before=text.slice(Math.max(0,m.index-70),m.index);
    // Do not mistake "answer 5 of 20 questions" for a declared exam total.
    if (/\b(?:\d+\s+of|from|pool of|bank of)\s*$/i.test(before)) continue;
    var n=Number(m[1]);
    if(n>0 && Number.isSafeInteger(n) && counts.indexOf(n)<0) counts.push(n);
  }
  return counts.length===1?counts[0]:null;
}

function qaBrightspaceDeclaredQuizCount_(quiz) {
  quiz = quiz || {};
  var direct = Number(quiz.declaredQuestionCount || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  var desc = qaBrightspaceText_(quiz.description) || qaBrightspaceText_(quiz.raw && quiz.raw.Description);
  return ctiDeclaredQuizCountFromText_(desc);
}

function qaBrightspaceQuizToAssessment_(quiz) {
  if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length) return null;
  var questions = quiz.questions.map(qaBrightspaceQuizQuestion_).filter(function(q){ return !!q.prompt || q.options.length || q.correctAnswers.length; });
  if (!questions.length) return null;
  var declared = qaBrightspaceDeclaredQuizCount_(quiz) || questions.length;
  var observedDeclared = qaBrightspaceDeclaredQuizCount_(quiz);
  var pages = quiz.questionPageEvidence || {}, coverage = quiz.questionCoverage || {};
  // Parsing the returned definitions and establishing the entire source bank
  // are separate claims. Preserve the source capture's uncertainty through QA.
  var complete = coverage.completenessVerified === true && pages.complete === true &&
      quiz.questionsStatus === 'CAPTURED' && observedDeclared === questions.length &&
      questions.length === quiz.questions.length;
  return qaNormalizeAssessment_({
    schemaVersion:1,
    origin:'brightspace-live-api',
    parser:'brightspace-question-api-v2',
    declaredQuestionCount:declared,
    questionCount:questions.length,
    definitionCoverage:{scope:'BRIGHTSPACE_QUESTION_DEFINITIONS',completenessVerified:complete,
      status:complete?'VERIFIED_DECLARED_DEFINITIONS':String(coverage.status || 'TOTAL_UNVERIFIED'),
      observedDeclaredQuestionCount:observedDeclared,capturedDefinitions:questions.length,
      apiPagesComplete:pages.complete===true,stopReason:String(pages.stopReason||''),
      meaning:'API page completion and matching captured subsets do not establish the total source question bank or pool membership.'},
    questions:questions,
    parserConfidence:declared === questions.length ? 0.99 : 0.88,
    warnings:(declared === questions.length ? [] : ['Brightspace declared question count differs from captured question definitions.']).concat(complete?[]:['Brightspace question-definition completeness remains unverified.'])
  }, 'brightspace-live-api');
}

function qaBrightspaceQuizCaptureSummary_(quizzes) {
  var rows=(Array.isArray(quizzes)?quizzes:[]).map(function(q){
    q=q||{};
    var captured=Array.isArray(q.questions)?q.questions.length:0;
    var stated=qaBrightspaceDeclaredQuizCount_(q);
    var status=q.questionsStatus==='PARTIAL'?'PARTIAL_API_CAPTURE':q.questionsStatus==='UNAVAILABLE'?'UNAVAILABLE':(q.questionsStatus==='NOT_REQUESTED'?'NOT_REQUESTED':(captured===0?'NO_DEFINITIONS_CAPTURED':(stated!=null&&stated!==captured?'COUNT_DIFFERS':'CAPTURED')));
    if(status==='CAPTURED' && q.questionCoverage && q.questionCoverage.completenessVerified===false) status=String(q.questionCoverage.status||'TOTAL_UNVERIFIED');
    return {id:String(q.id||''),name:String(q.name||q.title||'Quiz'),capturedQuestionDefinitions:captured,descriptionQuestionCount:stated,status:status,pageEvidence:q.questionPageEvidence||null,definitionCoverage:q.questionCoverage||null};
  });
  return {quizzes:rows.length,capturedQuestionDefinitions:rows.reduce(function(n,q){return n+q.capturedQuestionDefinitions;},0),quizEvidenceGaps:rows.filter(function(q){return q.status!=='CAPTURED';}).length,items:rows,
    countMeaning:'Captured question definitions, a described exam length, and a source-package question bank are different measurements. A count difference is an evidence review, not proof of deleted questions.'};
}

function qaBrightspaceAssignmentBehavior_(assignment) {
  assignment = assignment || {};
  var raw = assignment.raw || assignment;
  var st = raw.SubmissionType == null || raw.SubmissionType === '' ? NaN : Number(raw.SubmissionType);
  var observedSubmission = [0,1,2,3,4].indexOf(st) > -1;
  var score = raw.Assessment && raw.Assessment.ScoreDenominator != null ? Number(raw.Assessment.ScoreDenominator) : null;
  return {
    observed:observedSubmission || Number.isFinite(score),
    source:'BRIGHTSPACE_LIVE_API',
    submission:{
      fileUpload:st === 0 || st === 4,
      textSubmission:st === 1 || st === 4,
      onPaper:st === 2,
      observedInPerson:st === 3,
      submissionType:Number.isFinite(st) ? st : null
    },
    settings:{
      points:Number.isFinite(score) ? score : null,
      dueDate:String(raw.DueDate || assignment.dueDate || ''),
      hidden:raw.IsHidden === true || assignment.isHidden === true,
      submissionRule:raw.SubmissionsRule != null ? raw.SubmissionsRule : (raw.SubmissionRule == null ? null : raw.SubmissionRule)
    }
  };
}

function qaBrightspaceExternalComparableLinks_(links, pageOrigin) {
  pageOrigin = String(pageOrigin || '').toLowerCase();
  var out = [];
  (links || []).forEach(function(link) {
    var raw = typeof link === 'string' ? link : String(link && (link.url || link.href) || '');
    if (!/^https?:\/\//i.test(raw)) return;
    try {
      var hostPart = raw.match(/^https?:\/\/[^/]+/i);
      var origin = hostPart ? String(hostPart[0]).toLowerCase() : '';
      if (pageOrigin && origin === pageOrigin) return;
      if (/\/d2l\//i.test(raw) || /\/content\/enforced\//i.test(raw)) return;
      out.push(raw);
    } catch (e) {}
  });
  return out.filter(function(v,i,a){ return a.indexOf(v) === i; });
}
