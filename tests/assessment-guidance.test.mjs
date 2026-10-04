import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildPostQaText_} from '../src/reporting/owner-report.js';
import {qaAssessmentAnswerEvidenceText_} from '../src/reporting/assessment-evidence.js';
import {qaEvidenceDimensionsV8_} from '../src/engine/hardening.js';
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
function readiness(q,version=c.CTI_RELEASE_REGISTRY_.courseraExtractor.version){return c.qaCourseraCaptureReadiness_({buildId:version},[result(q)]);}

// Reproduces the live survey's shape without publishing private course content:
// declared/captured positions agree, while types and options were not captured.
function unknownDestinationComparison(sourceKeys=false) {
  const sourceQuestions=['one','two'].map((id)=>({id,type:'single-select',prompt:'Choose the route to station '+id,
    options:[{text:'North',correct:sourceKeys?true:null},{text:'South',correct:sourceKeys?false:null}],
    correctAnswers:sourceKeys?['North']:[],answerTextReliable:sourceKeys}));
  const assessment=(questions)=>({parser:'ims-qti-dom-v4',parserConfidence:.95,declaredQuestionCount:2,questions});
  const destination=assessment(sourceQuestions.map(({id,prompt})=>({id,prompt,type:'unknown',options:[],correctAnswers:[],optionTextReliable:false,answerTextReliable:false})));
  destination.captureCompleteness={declared:2,captured:2,questionCoverageComplete:true,requiredAnswerCoverageComplete:false,missingQuestionOrdinals:[],missingRequiredAnswerOrdinals:[1,2]};
  return c.qaStructuredAssessmentComparison_({isStructuredAssessment:true,structuredAssessment:assessment(sourceQuestions)},{structuredAssessment:destination});
}

test('Unknown destination types cannot turn zero answerable questions into complete keys',()=>{
  const q=unknownDestinationComparison();
  assert.equal(q.unknownTypeCount,2);
  assert.equal(q.courseraAnswerableQuestionCount,0);
  assert.equal(q.courseraAnswerEvidenceQuestionCount,0);
  assert.equal(c.qaAssessmentAnswerEvidenceSide_(q,'source'),'INCOMPLETE');
  assert.equal(c.qaAssessmentAnswerEvidenceSide_(q,'coursera'),'UNKNOWN');
  const r=readiness(q);
  assert.equal(r.status,'ASSESSMENT_EVIDENCE_REVIEW');
  assert.equal(r.assessmentGaps[0].sourceEvidenceOnly,false);
  assert.equal(r.assessmentGaps[0].unknownQuestionTypeCount,2);
  assert.match(r.action,/question types, options, and applicable answer keys/);
  const action=c.qaOwnerActionForResult_(result(q)).action;
  assert.match(action,/2 source\/destination question type\(s\) remain unknown/);
  assert.match(action,/focused item check or manual inspection/);
  assert.doesNotMatch(action,/remaining gap is source answer evidence|capture the unobserved questions/);
  const report=buildPostQaText_({success:true,captureReadiness:r,summary:{headlineStatus:'REVIEW'},itemResults:[],missing:[],injected:[]});
  assert.match(report,/unknown\/unsupported question types=2/);
  assert.doesNotMatch(report,/captured destination keys complete|SOURCE_ASSESSMENT_EVIDENCE_REVIEW/);
});

test('Unknown destination fields remain visible even when source keys are complete',()=>{
  const q=unknownDestinationComparison(true);
  assert.equal(q.answerEvidenceCoverage,null);
  assert.match(qaAssessmentAnswerEvidenceText_(q),/not established.*unknown/);
  assert.equal(qaEvidenceDimensionsV8_({isStructuredAssessment:true},{},result(q)).answers.status,'UNVERIFIED');
  assert.equal(q.status,'UNVERIFIED');
  assert.equal(c.qaAssessmentAnswerEvidenceSide_(q,'source'),'COMPLETE');
  assert.equal(c.qaAssessmentAnswerEvidenceSide_(q,'coursera'),'UNKNOWN');
  assert.equal(readiness(q).status,'ASSESSMENT_EVIDENCE_REVIEW');
  assert.equal(readiness(q).assessmentGaps.length,1);
});

test('Explicit incomplete key capture and unknown unmatched types cannot receive complete evidence advice',()=>{
  const q=comparison();
  q.courseraCaptureCompleteness={requiredAnswerCoverageComplete:false};
  assert.equal(c.qaAssessmentAnswerEvidenceSide_(q,'coursera'),'INCOMPLETE');
  q.questionResults=[];q.unknownTypeCount=1;
  assert.equal(c.qaAssessmentAnswerEvidenceSide_(q,'coursera'),'UNKNOWN');
  assert.equal(c.qaAssessmentAnswerEvidenceSide_({...q,answerEvidenceApplicable:false},'coursera'),'NOT_APPLICABLE');
});

test('Unknown types do not hide missing positions or independently confirmed course failures',()=>{
  const q=unknownDestinationComparison();q.courseraDeclaredQuestionCount=3;
  assert.equal(readiness(q).status,'CAPTURE_INCOMPLETE');
  assert.match(c.qaOwnerActionForResult_(result(q)).action,/capture the unobserved/);
  const r=result(q);r.verdict='INGESTION_FAILURE';r.issues.push('INGESTION_FAILURE');r.checks.ingestionFailure={codes:['QUESTION_IMAGE_CREATION_ERROR']};
  assert.equal(c.qaOwnerActionForResult_(r).severity,'CRITICAL');
});

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
  for(const key of ['captureCoverageUnverified','definitionCoverageUnverified'])assert.equal(c.qaAssessmentMediaOnlyGap_({...q,[key]:true}),false,key);
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
  for(const version of ['v6.14.3','v6.12.0']) {
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
  const meta={buildId:c.CTI_RELEASE_REGISTRY_.courseraExtractor.version,activeSpaCrawl:{eligibleTargets:2,targetIds:['a','b'],visitedEditorCount:1,unreachedEditorIds:['b'],allEditorsVisited:false}};
  assert.equal(c.qaCourseraCaptureReadiness_(meta,[result(q)]).status,'EDITOR_TRAVERSAL_INCOMPLETE');
});

test('Downloadable report names source answer gaps and preserves the overall review',()=>{
  const q=comparison({sourceGap:true});q.status='UNVERIFIED';
  const report=buildPostQaText_({success:true,captureReadiness:readiness(q),summary:{headlineStatus:'REVIEW'},itemResults:[],missing:[],injected:[]});
  assert.match(report,/SOURCE_ASSESSMENT_EVIDENCE_REVIEW/);
  assert.match(report,/source answer evidence incomplete; captured destination keys complete/);
  assert.doesNotMatch(report,/capture status=CAPTURE_INCOMPLETE/);
});


test('Downloadable report separates historical captured evidence from the current extractor release',()=>{
  const readiness=c.qaCourseraCaptureReadiness_({
    buildId:'v6.13.27-memory-cleanup-20260922',
    capturedAt:'2026-09-23T11:36:06.301Z'
  },[]);
  assert.equal(readiness.olderCapture,true);
  assert.equal(readiness.expectedVersion,'v6.15.7');
  const report=buildPostQaText_({
    success:true,
    stats:{extractorMeta:{buildId:'v6.13.27-memory-cleanup-20260922',capturedAt:'2026-09-23T11:36:06.301Z'}},
    captureReadiness:readiness,
    summary:{headlineStatus:'REVIEW'},
    itemResults:[],missing:[],injected:[]
  });
  assert.match(report,/Report evidence source: uploaded Coursera capture JSON/);
  assert.match(report,/Coursera captured extractor: v6\.13\.27-memory-cleanup-20260922/);
  assert.match(report,/Current available Coursera extractor: v6\.15\.7/);
  assert.match(report,/Version relationship: HISTORICAL_CAPTURE/);
  assert.match(report,/does not retroactively change its evidence/);
});


test('Source-only answer evidence never tells the owner to recapture already complete Coursera positions',()=>{
  const sa={
    status:'UNVERIFIED',
    sourceQuestionCount:2,courseraQuestionCount:2,alignedQuestionCount:2,
    sourceDeclaredQuestionCount:2,courseraDeclaredQuestionCount:2,
    sourceAnswerableQuestionCount:2,sourceAnswerEvidenceQuestionCount:0,
    courseraAnswerableQuestionCount:0,courseraAnswerEvidenceQuestionCount:0,
    answerEvidenceApplicable:true,answerEvidenceCoverage:0,
    unmatchedSourceQuestions:[],unmatchedCourseraQuestions:[],captureIssueQuestionNumbers:[],
    hardMismatchCount:0,unknownTypeCount:0,fidelity:1,evidenceCoverage:.35,
    declaredCaptureIncomplete:false,captureCoverageUnverified:false,definitionCoverageUnverified:false,
    selectionPolicyStatus:'NOT_OBSERVED',sourceMediaQuestionNumbers:[],sourceAnswerRefreshRequired:false
  };
  const result={verdict:'PAYLOAD_UNVERIFIED',issues:['PAYLOAD_UNVERIFIED'],checks:{structuredAssessment:sa}};
  const action=c.qaOwnerActionForResult_(result).action;
  assert.match(action,/All 2\/2 destination question positions were captured/);
  assert.match(action,/repeating the Coursera extraction will not recover missing source keys/);
  assert.doesNotMatch(action,/capture the unobserved questions\/answers/);
});
