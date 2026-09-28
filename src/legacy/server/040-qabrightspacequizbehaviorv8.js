

// ============================================================================
// CTI v8.0.0 — 15-title evidence-dimension hardening layer
// Generic invariants only. No course/title-specific exceptions.
// ============================================================================
function qaBrightspaceQuizBehaviorV8_(quiz) {
  quiz=quiz||{}; var raw=quiz.raw||quiz;
  var description=qaBrightspaceText_(quiz.description);
  if(!description||description==='[object Object]')description=qaBrightspaceText_(raw.Description);
  var gradeItem=raw.GradeItemId!=null&&Number(raw.GradeItemId)>0 ? raw.GradeItemId : null;
  var autoExport=typeof raw.AutoExportToGrades==='boolean'?raw.AutoExportToGrades:null;
  var explicitlyUngraded=/\bungraded\b/i.test(description)&&!/\bnot\s+(?:an?\s+)?ungraded\b/i.test(description);
  var gradingConflict=explicitlyUngraded&&(gradeItem!=null||autoExport===true);
  var attempts=quiz.attemptsAllowed||raw.AttemptsAllowed||{}, limit=quiz.timeLimit||raw.SubmissionTimeLimit||{};
  var unlimited=attempts.IsUnlimited===true;
  var attemptCount=attempts.NumberOfAttemptsAllowed!=null?Number(attempts.NumberOfAttemptsAllowed):null;
  var minutes=limit.TimeLimitValue!=null?Number(limit.TimeLimitValue):null;
  var graded=gradingConflict?null:(explicitlyUngraded?false:((gradeItem!=null||autoExport===true)?true:null));
  return {
    observed:graded!==null||unlimited||Number.isFinite(attemptCount)||Number.isFinite(minutes),
    source:'BRIGHTSPACE_LIVE_QUIZ_API',
    submission:{},
    settings:{
      graded:graded,
      gradeSetting:graded===false?'Ungraded':(graded===true?'Graded':''),
      gradeLinked:gradeItem!=null||autoExport===true,
      attempts:unlimited?'UNLIMITED':(Number.isFinite(attemptCount)?String(attemptCount):''),
      timeLimitMinutes:Number.isFinite(minutes)&&limit.IsEnforced!==false?minutes:null,
      passingThreshold:null
    },
    evidence:{description:description,gradeItemId:gradeItem,autoExportToGrades:autoExport,gradingConflict:gradingConflict}
  };
}

function qaCanonicalMathTextV8_(value) {
  var s=qaAssessmentText_(value);
  if(!s)return '';
  var fractions={'½':'1/2','¼':'1/4','¾':'3/4','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8','⅓':'1/3','⅔':'2/3'};
  Object.keys(fractions).forEach(function(k){s=s.split(k).join(' '+fractions[k]+' ');});
  s=s.replace(/\\frac\s*\{\s*([^{}]+)\s*\}\s*\{\s*([^{}]+)\s*\}/gi,function(_,a,b){function group(x){x=x.trim();return /^[+-]?(?:\d+(?:\.\d+)?|[a-z])$/i.test(x)?x:'('+x+')';}return ' '+group(a)+'/'+group(b)+' ';});
  s=s.replace(/\\\(|\\\)|\$+/g,' ');
  s=s.replace(/[′’‘]/g,"'").replace(/[″”“]/g,"''");
  // MathJax accessibility text may duplicate the visible expression. Remove its
  // spoken structural tokens without inventing numeric content.
  s=s.replace(/\b(?:start|end)\s+(?:fraction|superscript|subscript)\b/gi,' ')
     .replace(/\bdivided\s+by\b/gi,'/')
     .replace(/\bprime\b/gi,"'")
     .replace(/\s+/g,' ').trim();
  return s;
}

var CTI_V7931_qaQuestionPromptSimilarity_=qaQuestionPromptSimilarity_;
qaQuestionPromptSimilarity_=function(a,b){
  return CTI_V7931_qaQuestionPromptSimilarity_(qaCanonicalMathTextV8_(a),qaCanonicalMathTextV8_(b));
};
var CTI_V7931_qaAssessmentFieldSimilarity_=qaAssessmentFieldSimilarity_;
qaAssessmentFieldSimilarity_=function(a,b){
  // Inspect untouched representations before the older prose normalizer erases
  // the TeX/visual/speech boundaries needed to prove exact math equivalence.
  var am=qaAssessmentMathKey_(a),bm=qaAssessmentMathKey_(b);
  if(am && bm)return am===bm?1:0;
  return CTI_V7931_qaAssessmentFieldSimilarity_(qaCanonicalMathTextV8_(a),qaCanonicalMathTextV8_(b));
};
var CTI_V7931_qaNormalizeQuestion_=qaNormalizeQuestion_;
qaNormalizeQuestion_=function(q,index){
  var out=CTI_V7931_qaNormalizeQuestion_(q,index);
  if(out && out.options && out.options.length>=2 && (out.type==='essay'||out.type==='unknown')){
    var correct=out.options.filter(function(o){return o.correct===true;}).length;
    if(correct>0)out.type=correct>1?'multiple-select':'single-select';
  }
  return out;
};

var CTI_V7931_qaBehaviorComparison_=qaBehaviorComparison_;
qaBehaviorComparison_=function(source,coursera){
  var src=source&&source.behavior, dst=coursera&&coursera.nativeAssignment;
  var required=/Assignment|Assessment|Quiz|Exam/i.test(String(source&&source.type||''));
  function unknown(issue,reason){return {status:'UNVERIFIED',comparable:true,reviewRequired:true,mismatches:[],issues:[issue],sourceObserved:!!(src&&src.observed),destinationObserved:!!dst,reason:reason};}
  if(!src||src.observed!==true)return required?unknown('BEHAVIOR_SOURCE_UNVERIFIED','Source behavior was not observed.'): {status:'NOT_APPLICABLE',comparable:false,mismatches:[],issues:[]};
  if(!dst)return unknown('BEHAVIOR_DESTINATION_UNVERIFIED','Source behavior exists but destination behavior was not captured.');
  var s=src.settings||{},d=dst.settings||{},ss=src.submission||{},ds=dst.submission||{},mis=[],comp=[],missing=[];
  function compare(key,a,b){if(a==null||a==='')return;if(b==null||b===''){missing.push(key);return;}comp.push(key);if(a!==b)mis.push(key+'_CHANGED');}
  function number(v){return v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;}
  function attempts(v){if(v==null||v==='')return null;var text=String(v).toLowerCase();if(/unlimited/.test(text))return 'UNLIMITED';var m=text.match(/\d+/);return m?String(Number(m[0])):null;}
  function graded(settings){if(typeof settings.graded==='boolean')return settings.graded;var text=String(settings.gradeSetting||'').trim();if(/^(?:ungraded|practice)$/i.test(text))return false;if(/^graded$/i.test(text))return true;return null;}
  if(ss.fileUpload===true){if(ds.fileUpload===true)comp.push('FILE_UPLOAD');else if(ds.aiGraded===true||ds.textSubmission===true)mis.push('FILE_UPLOAD_REPLACED');else missing.push('FILE_UPLOAD');}
  if(ss.textSubmission===true){if(ds.textSubmission===true)comp.push('TEXT_SUBMISSION');else if(ds.fileUpload===true&&ds.aiGraded!==true)mis.push('TEXT_SUBMISSION_REPLACED');else missing.push('TEXT_SUBMISSION');}
  compare('ATTEMPTS',attempts(s.attempts),attempts(d.attempts));
  var sg=graded(s),dg=graded(d);compare('GRADED_STATE',sg,dg);
  var sp=number(s.passingThreshold),dp=number(d.passingThreshold);
  if(sg===false&&dp!=null&&dp>0){comp.push('PASSING_THRESHOLD');mis.push('PASSING_THRESHOLD_ON_UNGRADED_SOURCE');}
  else compare('PASSING_THRESHOLD',sp,dp);
  compare('POINTS',number(s.points),number(d.points));compare('TIME_LIMIT',number(s.timeLimitMinutes),number(d.timeLimitMinutes));
  return {status:mis.length?'MUTATED':(missing.length||!comp.length?'UNVERIFIED':'VERIFIED'),comparable:true,reviewRequired:!!(missing.length||!comp.length),
    mismatches:mis,issues:mis.concat(missing.map(function(k){return k+'_UNVERIFIED';})),compared:comp,unverifiedDimensions:missing,source:src,coursera:dst,
    reason:mis.length?'Explicitly observed behavior differs.':missing.length?'Required source settings are not all observed at the destination.':!comp.length?'No portable behavior settings were comparable.':'All observed source behavior dimensions match.'};
};

function qaEvidenceDimensionsV8_(source,coursera,result){
  var checks=result.checks||{},dims={},assets=(source.assetDetails||[]).map(qaAssetDescriptor_).filter(function(a){return a.referenceOnly!==true&&a.presentInPackage!==false;});
  function dimension(required,check){return {required:required,status:required?(check&&check.status||'UNVERIFIED'):'NOT_APPLICABLE'};}
  dims.structure=dimension(true,checks.structure);
  var text=qaCleanText_(source.textSample||'');
  dims.learnerText=dimension(source.contentComparable!==false&&!source.isStructuredAssessment&&(!!text||(!assets.length&&!(source.links||[]).length)),checks.content);
  dims.requiredAssets=dimension(assets.length>0,checks.assets);
  if(assets.length){
    var ac=checks.assets||{},dest=(coursera&&coursera.assetDetails||[]).map(qaAssetDescriptor_);
    var unproved=assets.filter(function(a){
      if(!a.sha256)return false;
      if(dest.some(function(d){return d.sha256===a.sha256;}))return false;
      var key=qaAssetKey_(a.name||a.url);
      // Preserve established per-document native transformation and relocation
      // evidence. Byte identity and semantic transformation are separate proofs.
      if((ac.transformed||[]).some(function(t){return qaAssetKey_(t.expected||'')===key&&t.method==='NATIVE_SEMANTIC_TRANSFORMATION';}))return false;
      return !(ac.relocated||[]).some(function(t){return qaAssetKey_(t.expected||'')===key&&t.method==='SHA256_EXACT';});
    });
    if((ac.missing||[]).length)dims.requiredAssets.status='MISSING';
    else if((ac.unresolved||[]).length||unproved.length)dims.requiredAssets.status='UNVERIFIED';
    dims.requiredAssets.byteIdentityUnverified=unproved.map(function(a){return a.name||a.url;});
  }
  dims.linksMedia=dimension((source.links||[]).length>0,checks.links);
  dims.assessmentQuestions=dimension(source.isStructuredAssessment===true,checks.structuredAssessment);
  var assessment=checks.structuredAssessment||{};
  dims.answers=dimension(source.isStructuredAssessment===true&&assessment.answerEvidenceApplicable!==false,{status:Number(assessment.answerEvidenceCoverage)>=0.99?'VERIFIED':'UNVERIFIED'});
  dims.behavior=dimension(/Assignment|Assessment|Quiz|Exam/i.test(String(source.type||''))||!!(source.behavior&&source.behavior.observed),checks.behavior);
  dims.runtime=dimension(!!(source.interactiveSignals&&source.interactiveSignals.detected),checks.runtime);
  return dims;
}
function qaApplyDimensionalVerdictGateV8_(source,coursera,result){
  if(!result||!source)return result;
  result.checks=result.checks||{};result.issues=result.issues||[];
  var dims=qaEvidenceDimensionsV8_(source,coursera,result);result.checks.evidenceDimensions=dims;
  var required=Object.keys(dims).filter(function(k){return dims[k].required;});
  var accepted=['VERIFIED','TRANSFORMED','RELOCATED','VERIFIED_CONFIGURATION'];
  var failed=required.filter(function(k){return /MISSING|MUTATED|CHANGED|FAILED|PARTIAL/.test(String(dims[k].status));});
  var uncertain=required.filter(function(k){return failed.indexOf(k)<0&&accepted.indexOf(dims[k].status)<0;});
  result.checks.dimensionGaps={failed:failed,unverified:uncertain};
  if(['VERIFIED','EXPECTED_TRANSFORMATION','MOVED'].indexOf(result.verdict)>-1){
    if(failed.length)result.verdict=dims.behavior.status==='MUTATED'?'BEHAVIOR_MUTATION':'PARTIAL';
    else if(uncertain.length)result.verdict='UNVERIFIED';
  }
  if((failed.length||uncertain.length)&&result.issues.indexOf('DIMENSIONAL_VERIFICATION_GATE')<0)result.issues.push('DIMENSIONAL_VERIFICATION_GATE');
  result.ownerAction=qaOwnerActionForResult_(result);result.evidenceStrength=qaEvidenceStrength_(result);
  if(result.verdict==='UNVERIFIED'&&uncertain.length)result.ownerAction={severity:'EVIDENCE',label:'Verify required evidence',action:'Unverified dimensions: '+uncertain.join(', ')+'. Resolve these evidence gaps before treating this item as preserved.'};
  return result;
}
var CTI_V7931_compareItemFidelity_=compareItemFidelity_;
compareItemFidelity_=function(source,coursera,matchScore,allCourseraItems,snapshotContext,ingestionIntelligence){
  var result=CTI_V7931_compareItemFidelity_.apply(this,arguments);
  return qaApplyDimensionalVerdictGateV8_(source,coursera,result);
};

var CTI_V7931_qaFindCrossItemSemanticRepackagingEvidence_=qaFindCrossItemSemanticRepackagingEvidence_;
qaFindCrossItemSemanticRepackagingEvidence_=function(source,courseraItems,excludeCourseraId){
  var existing=CTI_V7931_qaFindCrossItemSemanticRepackagingEvidence_.apply(this,arguments);if(existing)return existing;
  var sourceText=qaCleanText_(source&&source.textSample||'');
  if(sourceText.length<80)return null;
  var candidates=(courseraItems||[]).filter(function(item){
    if(!item||String(item.id||'')===String(excludeCourseraId||''))return false;
    if(qaNormalizeIngestionFailure_(item.ingestionFailure||null,item.name||'',item.textSample||'').detected)return false;
    if(normalizeCourseraType_(item.type)!=='Reading')return false;
    var path=qaPathSimilarity_(source.path,item.path);if(path==null||path<0.58)return false;
    var text=qaCleanText_(item.textSample||'');if(text.length<80||Number(item.textEvidenceCompleteness||0)<0.80)return false;
    var directional=qaDirectionalSemanticSimilarity_(sourceText,text);
    return directional>=0.86;
  });
  if(candidates.length!==1)return null;
  var c=candidates[0];
  return {score:0.91,method:'SEMANTIC_CONSOLIDATED_READING',reason:'A unique same-module Coursera Reading contains strong directional learner-text coverage for the source activity. This proves semantic consolidation only; unresolved files/links remain unresolved.',
    carrierId:c.id||'',carrierName:c.name||'',carrierType:c.type||'',carrierPath:c.path||'',carrierPublished:c.published,carrierEvidenceOnly:c.evidenceOnly===true,
    textEvidenceCompleteness:Number(c.textEvidenceCompleteness||0)};
};

var CTI_V7931_qaParseSmartIngestionIntelligence_=qaParseSmartIngestionIntelligence_;
qaParseSmartIngestionIntelligence_=function(courseraEvidenceItems){
  var out=CTI_V7931_qaParseSmartIngestionIntelligence_.apply(this,arguments)||{reportItems:[],claims:[]};
  out.claims=Array.isArray(out.claims)?out.claims.map(qaNormalizeIngestionClaimScope_):[];
  var seen=Object.create(null);out.claims.forEach(function(c){seen[qaClaimResolutionKey_(c)]=true;});
  function push(type,subject,path,excerpt,severity,remediation){
    var c=qaNormalizeIngestionClaimScope_({type:type,subject:qaCleanText_(subject||''),target:'',excerpt:qaCleanText_(excerpt||''),confidence:0.97,detail:qaCleanText_(excerpt||''),pathHint:qaCleanText_(path||''),context:'AAR_EVENT_V8',severity:severity||'REVIEW',remediation:qaCleanText_(remediation||'')});
    c.excerpt=qaSmartIngestionClaimExcerpt_(c.excerpt);c.detail=qaSmartIngestionClaimExcerpt_(c.detail);
    // The legacy parser may already describe the same event without its category
    // heading. Keep that evidence once, while retaining separate failures for
    // different items, modules, or event wording.
    if(c.type==='UNRESOLVED_SOURCE_ASSET' && out.claims.some(function(prior){
      if(prior.type!==c.type || qaCleanName_(prior.subject)!==qaCleanName_(c.subject) || qaCleanName_(prior.pathHint)!==qaCleanName_(c.pathHint))return false;
      var a=qaCleanText_(prior.excerpt||'').toLowerCase(),b=c.excerpt.toLowerCase();
      return a.length>=50 && b.length>=50 && (a.indexOf(b)>=0 || b.indexOf(a)>=0);
    }))return;
    var k=qaClaimResolutionKey_(c);if(!c.excerpt||seen[k])return;seen[k]=true;out.claims.push(c);
  }
  (courseraEvidenceItems||[]).forEach(function(item){
    if(!qaSmartIngestionReportLooksValid_(item))return;
    var text=qaCleanText_(item.textSample||'');if(!text)return;
    var markers='AI-Generated Mandatory Field|Content Adaptation|Content Excluded|Unsupported Content Fallback|Empty Module Structure';
    var re=new RegExp('\\b('+markers+')\\b([\\s\\S]*?)(?=\\b(?:'+markers+'|DO NOT PUBLISH)\\b|\\b(?:Module|Item):\\s|$)','gi'),m;
    while((m=re.exec(text))!==null){
      var cat=m[1],body=qaCleanText_(m[2]||''),prefix=text.slice(Math.max(0,m.index-12000),m.index);
      var mods=[...prefix.matchAll(/Module:\s+(.+?)(?=\s+(?:Item:|AI-Generated Mandatory Field|Content Adaptation|Content Excluded|Unsupported Content Fallback|Empty Module Structure|$))/gi)];
      var path=mods.length?qaCleanText_(mods[mods.length-1][1]):'';
      var items=[...prefix.matchAll(/Item:\s+(.+?)(?=\s+(?:Module:|AI-Generated Mandatory Field|Content Adaptation|Content Excluded|Unsupported Content Fallback|Empty Module Structure|$))/gi)];
      var currentItem=items.length && (!mods.length || items[items.length-1].index>mods[mods.length-1].index) ? items[items.length-1] : null;
      var subject=currentItem?qaCleanText_(currentItem[1]):path;
      if(/^(?:supplement|ungradedAssignment|gradedAssignment|assignment|ungradedWidget|gradedWidget|widget|plugin|lecture|discussionPrompt)(?:\s+Opens in a new tab)?$/i.test(subject)) subject='';
      var event=cat+' '+body;
      if(cat==='Content Excluded')push('INTENTIONAL_EXCLUSION',subject,path,event,'REVIEW','Confirm the exclusion is intentional.');
      if(cat==='Unsupported Content Fallback')push('UNSUPPORTED_CONTENT_FALLBACK',subject,path,event,'REVIEW','Inspect/recreate only the unsupported learner payload identified here.');
      var assetKind=qaIngestionAssetEventKind_(event);
      if(assetKind==='UNRESOLVED_SOURCE_ASSET')
        push(assetKind,subject,path,event,'CRITICAL','Confirm learner access to the identified source asset; restore or link the file if absent. A filename or local path alone is not an accessible attachment.');
      else if(assetKind==='CONTENT_MARKUP_ADAPTATION')push(assetKind,subject,path,event,'INFO','');
      if(/(?:NonRetryable|Exception|ERROR DURING DISTILLATION|distillation|parsing failure|malformed model|failed to (?:parse|convert|distill))/i.test(event))
        push('SI_PROCESSING_FAILURE',subject,path,event,'CRITICAL','Escalate the Smart Ingestion processing failure and restore from source evidence if required.');
      if(cat==='AI-Generated Mandatory Field' && /(?:passing threshold|passing score|grader type|rubric|graded|grade setting)/i.test(event))
        push('GENERATED_BEHAVIOR',subject,path,event,'REVIEW','Compare generated behavior with the source LMS behavior before approval.');
      else if(cat==='AI-Generated Mandatory Field' && /\bgenerated\s+(?:the\s+)?(?:replacement\s+)?reading\s+content\b/i.test(body))
        push('GENERATED_CONTENT_FALLBACK',subject,path,event,'REVIEW','Compare generated content with actual source evidence.');
      if(assetKind!=='UNRESOLVED_SOURCE_ASSET' && /(?:^|[\s.])(?:reattach|re-attach|recreate|re-create|manually add|course team should|restore|upload)\b.*?(?:file|attachment|question|content|document|asset)/i.test(event))
        push('REPAIR_INSTRUCTION',subject,path,event,'REVIEW',body);
    }
    var failRe=/(NonRetryable[A-Za-z0-9_.$:-]*Exception[^.]{0,500}|\[ERROR DURING DISTILLATION\][^.]{0,500}|malformed model JSON[^.]{0,500})/gi,f;
    while((f=failRe.exec(text))!==null)push('SI_PROCESSING_FAILURE','Smart Ingestion processing','',f[0],'CRITICAL','Escalate the processing failure; do not attribute it to missing source content without source evidence.');
  });
  // Rebuild projections after event parsing without applying the persistence
  // compactor's claim-count limit to a fresh report.
  out.categoryCounts={};out.claims.forEach(function(c){out.categoryCounts[c.type]=(out.categoryCounts[c.type]||0)+1;});
  out.criticalClaims=out.claims.filter(function(c){return c.severity==='CRITICAL';}).slice(0,60);
  out.reviewClaims=out.claims.filter(function(c){return c.severity==='REVIEW';}).slice(0,80);
  out.parserVersion='aar-event-parser-v8.1';return out;
};

var CTI_V7931_qaApplySmartIngestionProvenanceToResult_=qaApplySmartIngestionProvenanceToResult_;
qaApplySmartIngestionProvenanceToResult_=function(source,result,intelligence){
  result=CTI_V7931_qaApplySmartIngestionProvenanceToResult_.apply(this,arguments);
  var argumentsDestinations=arguments[3]||[];
  var claims=qaSmartIngestionClaimsForSource_(source,intelligence),issues=result.issues||[];result.checks=result.checks||{};
  claims.forEach(function(c){
    if(c.provenanceOrigin==='EVIDENCE_MEMORY')return;
    if(c.type==='UNSUPPORTED_CONTENT_FALLBACK' && ['VERIFIED','EXPECTED_TRANSFORMATION'].indexOf(result.verdict)>-1){
      var pairedAsset=claims.some(function(other){return other.type==='UNRESOLVED_SOURCE_ASSET' && !!c.subject && qaCleanName_(other.subject)===qaCleanName_(c.subject);});
      var hit=pairedAsset?qaFindCurrentAttachmentEvidence_(c.subject,argumentsDestinations,result.courseraId):null;
      var observed=qaCurrentAttachmentIsObserved_(hit);
      if(!observed){result.verdict='UNVERIFIED';if(issues.indexOf('SI_UNSUPPORTED_CONTENT')<0)issues.push('SI_UNSUPPORTED_CONTENT');}
    }
    if(c.type==='SI_PROCESSING_FAILURE'){
      if(issues.indexOf('SI_PROCESSING_FAILURE')<0)issues.push('SI_PROCESSING_FAILURE');
      var empty=result.checks.destinationReadiness&&JSON.stringify(result.checks.destinationReadiness).indexOf('EMPTY_ASSESSMENT_EDITOR_OBSERVED')>-1;
      if(empty||issues.indexOf('INGESTION_FAILURE')>-1)result.verdict='INGESTION_FAILURE';
      else if(['VERIFIED','EXPECTED_TRANSFORMATION'].indexOf(result.verdict)>-1)result.verdict='UNVERIFIED';
    }
    if(c.type==='REPAIR_INSTRUCTION'){result.checks.ingestionRepairInstruction=result.checks.ingestionRepairInstruction||[];result.checks.ingestionRepairInstruction.push(c);}
  });
  result.issues=issues;result.ownerAction=qaOwnerActionForResult_(result);result.evidenceStrength=qaEvidenceStrength_(result);return result;
};

var CTI_V7931_qaApplyIngestionActionabilityPolicy_=qaApplyIngestionActionabilityPolicy_;
qaApplyIngestionActionabilityPolicy_=function(operationalPolicy,lineageMeta,snapshotContext){
  var status=String(lineageMeta&& (lineageMeta.ingestionCapabilityStatus||lineageMeta.ingestionStatus)||'').toUpperCase();
  if(status==='LATEST_ATTEMPT_FAILED_NO_OUTPUT'){
    operationalPolicy=operationalPolicy||{};operationalPolicy.ingestionCapabilityStatus=status;operationalPolicy.reingestionUseful=null;
    operationalPolicy.reingestionGuardApplied=true;operationalPolicy.diagnosticRecommendationCode=operationalPolicy.recommendationCode||'REVIEW';
    operationalPolicy.recommendationCode='REVIEW';operationalPolicy.recommendationLabel='Latest Smart Ingestion attempt failed — no replacement shell';
    operationalPolicy.recommendationReason='The latest Smart Ingestion was attempted but did not produce a usable destination shell. The existing shell must not be relabelled LATEST_APPLIED and this failed attempt must not advance generation.';
    return operationalPolicy;
  }
  if(status==='INGESTION_BLOCKED_NO_DESTINATION'){
    operationalPolicy=operationalPolicy||{};operationalPolicy.ingestionCapabilityStatus=status;operationalPolicy.reingestionUseful=null;
    operationalPolicy.recommendationCode='BLOCKED';operationalPolicy.recommendationLabel='Blocked at ingestion — no destination to audit';
    operationalPolicy.recommendationReason='No usable Coursera destination exists. Resolve the ingestion failure before source-to-destination fidelity QA.';
    return operationalPolicy;
  }
  return CTI_V7931_qaApplyIngestionActionabilityPolicy_.apply(this,arguments);
};

var CTI_V7931_qaBuildSummary_=qaBuildSummary_;
qaBuildSummary_=function(itemResults,injected){
  var s=CTI_V7931_qaBuildSummary_.apply(this,arguments);
  var critical=(itemResults||[]).filter(function(r){return r&&!(r.operationalPolicy&&r.operationalPolicy.inDecisionGate===false)&&((r.ownerAction&&r.ownerAction.severity==='CRITICAL')||r.verdict==='INGESTION_FAILURE');});
  s.criticalBlockers=critical.length;
  s.headlineStatus=critical.length?'BLOCKED':((s.ownerReview||s.ownerEvidence||s.unverified||s.partial||!itemResults||!itemResults.length)?'REVIEW':'NO_BLOCKERS_OBSERVED');
  s.headlineText=critical.length?('BLOCKED — '+critical.length+' critical learner-facing finding'+(critical.length===1?'':'s')):(s.headlineStatus==='REVIEW'?'REVIEW — evidence gaps or owner checks remain':'No critical learner-facing blocker observed; publication approval remains separate');
  return s;
};
