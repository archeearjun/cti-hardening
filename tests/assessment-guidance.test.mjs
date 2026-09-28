import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildPostQaText_} from '../src/generated/owner-report.js';
const c=createRequire(import.meta.url)('../tools/check.cjs');

function comparison({media=false,sourceGap=false}={}) {
  const question=(id)=>({id,type:'single-select',prompt:'Which route reaches station '+id+'?',options:[{text:'North road',correct:true},{text:'South road',correct:false}],correctAnswers:['North road']});
  const source=[question('one'),question('two')];
  if(media)source[1].mediaRefs=['diagram.png'];
  if(sourceGap)source.push({...question('three'),prompt:'Identify the safety equipment.',correctAnswers:[],options:[{text:'Mask',correct:null},{text:'Gloves',correct:null}],answerTextReliable:false});
  const assessment=(questions)=>({parser:'ims-qti-dom-v4',parserConfidence:.95,declaredQuestionCount:questions.length,questions});
  return c.qaStructuredAssessmentComparison_({isStructuredAssessment:true,structuredAssessment:assessment(source)},{structuredAssessment:assessment([question('one'),question('two')])});
}
function result(q){return {courseraId:'exam',courseraName:'Test exam',sourceName:'Source exam',verdict:'PAYLOAD_UNVERIFIED',issues:['PAYLOAD_UNVERIFIED'],checks:{structuredAssessment:q}};}
function readiness(q,version='v6.14.2'){return c.qaCourseraCaptureReadiness_({buildId:version},[result(q)]);}

test('Media-only review retains the image check without inventing missing questions',()=>{
  const q=comparison({media:true}),original=JSON.stringify(q);
  assert.equal(q.status,'UNVERIFIED');assert.equal(q.answerEvidenceCoverage,1);
  assert(c.qaAssessmentMediaOnlyGap_(q));
  const action=c.qaOwnerActionForResult_(result(q));
  assert.match(action.action,/answer evidence is complete/);
  assert.match(action.action,/media referenced by source question\(s\) 2/);
  assert.doesNotMatch(action.action,/question bank|capture the unobserved|Refresh the Coursera/);
  assert.equal(action.severity,'EVIDENCE');assert.equal(JSON.stringify(q),original);
});

test('Media-only advice cannot hide independent uncertainty or source media loss',()=>{
  const q=comparison({media:true});
  for(const [key,value] of [['courseraDeclaredQuestionCount',3],['sourceDeclaredQuestionCount',3],['alignedQuestionCount',1],['answerEvidenceCoverage',.5],['hardMismatchCount',1],['unknownTypeCount',1],['selectionPolicyStatus','UNVERIFIED'],['sourceParserConfidence',.3],['courseraParserConfidence',.3],['captureIssueQuestionNumbers',[1]],['unmatchedSourceQuestions',[1]],['sourceAnswerRefreshRequired',true]]) {
    assert.equal(c.qaAssessmentMediaOnlyGap_({...q,[key]:value}),false,key);
  }
  q.sourcePackageMediaGaps=[{question:2,status:'NOT_IN_PACKAGE'}];
  assert.match(c.qaOwnerActionForResult_(result(q)).action,/Recover referenced images.*those files are absent/);
  const r=result(q);r.issues.push('BEHAVIOR_MUTATION');r.checks.behavior={status:'MUTATED',mutations:['ATTEMPTS_CHANGED']};
  // An independent confirmed failure retains its blocking action.
  r.verdict='INGESTION_FAILURE';r.issues.push('INGESTION_FAILURE');r.checks.ingestionFailure={codes:['NO_CONTENT']};
  assert.equal(c.qaOwnerActionForResult_(r).severity,'CRITICAL');
});

test('Source-only answer gaps do not blame the complete destination question capture',()=>{
  const q=comparison({sourceGap:true});
  // A source question absent from the matched destination reduces coverage;
  // reproduce a conservative unverified comparison with source-only key gaps.
  q.status='UNVERIFIED';
  assert.equal(q.sourceAnswerableQuestionCount,3);assert.equal(q.sourceAnswerEvidenceQuestionCount,2);
  assert.equal(q.courseraAnswerEvidenceQuestionCount,2);
  for(const version of ['v6.14.2','v6.12.0']) {
    const r=readiness(q,version);
    assert.equal(r.status,'SOURCE_ASSESSMENT_EVIDENCE_REVIEW');
    assert.equal(r.assessmentGaps[0].sourceAnswerEvidence,'INCOMPLETE');
    assert.equal(r.assessmentGaps[0].destinationAnswerEvidence,'COMPLETE');
    assert.match(r.action,/original source keys/);
    assert.doesNotMatch(r.action,/Assessment capture is incomplete|repeat extraction when/);
  }
  const action=c.qaOwnerActionForResult_(result(q)).action;
  assert.match(action,/Captured 2\/2.*3 source questions/);
  assert.match(action,/Source question\(s\) 3 have no aligned/);
  assert.match(action,/original source answer evidence/);
  assert.doesNotMatch(action,/capture the unobserved/);
});

test('Mixed destination gaps, unknown keys and incomplete traversal remain unresolved',()=>{
  const q=comparison({sourceGap:true});q.status='UNVERIFIED';
  assert.equal(readiness({...q,courseraDeclaredQuestionCount:3}).status,'CAPTURE_INCOMPLETE');
  assert.equal(readiness({...q,courseraDeclaredQuestionCount:3},'v6.12.0').status,'OLDER_CAPTURE_WITH_GAPS');
  for(const patch of [{courseraAnswerEvidenceQuestionCount:1},{courseraAnswerableQuestionCount:null},{courseraDeclaredQuestionCount:0},{captureIssueQuestionNumbers:[1]}]) {
    const r=readiness({...q,...patch});
    assert.equal(r.status,'ASSESSMENT_EVIDENCE_REVIEW');
    assert.equal(r.assessmentGaps[0].sourceEvidenceOnly,false);
  }
  assert.equal(readiness(q,'').status,'VERSION_UNKNOWN_WITH_GAPS');
  const meta={buildId:'v6.14.2',activeSpaCrawl:{eligibleTargets:2,targetIds:['a','b'],visitedEditorCount:1,unreachedEditorIds:['b'],allEditorsVisited:false}};
  assert.equal(c.qaCourseraCaptureReadiness_(meta,[result(q)]).status,'EDITOR_TRAVERSAL_INCOMPLETE');
});

test('Downloadable report names source answer gaps and preserves the overall review',()=>{
  const q=comparison({sourceGap:true});q.status='UNVERIFIED';
  const report=buildPostQaText_({success:true,captureReadiness:readiness(q),summary:{headlineStatus:'REVIEW'},itemResults:[],missing:[],injected:[]});
  assert.match(report,/SOURCE_ASSESSMENT_EVIDENCE_REVIEW/);
  assert.match(report,/source answer evidence incomplete; captured destination keys complete/);
  assert.doesNotMatch(report,/capture status=CAPTURE_INCOMPLETE/);
});
