// Maintained source: explicit dependencies; no ordered concatenation.
import { qaAssessmentText_ } from "./assessment/questions.js";
import { qaAssetDescriptor_, qaAssetKey_ } from "./matching/assets.js";
import { qaCleanText_ } from "./matching/text.js";
import { qaOwnerActionForResult_ } from "./reporting/actions.js";
import { qaEvidenceStrength_ } from "./reporting/evidence.js";
import { qaBrightspaceText_ } from "./source/brightspace-assessment.js";

export function qaBrightspaceQuizBehaviorV8_(quiz) {
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

export function qaCanonicalMathTextV8_(value) {
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

export function qaEvidenceDimensionsV8_(source,coursera,result){
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

export function qaApplyDimensionalVerdictGateV8_(source,coursera,result){
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
