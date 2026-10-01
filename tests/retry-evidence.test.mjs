import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {captureContractV6150,captureContractSummaryV6150} from '../src/extractors/coursera/completion.js';
const require=createRequire(import.meta.url),qa=require('../tools/check.cjs');
const {functionCode}=require('../tools/assessment-fixture.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function runtime(){
  const c={captureContractV6150,captureContractSummaryV6150,CTI_MAX_ITEM_ATTEMPTS:2};vm.createContext(c);
  for(const name of ['assessmentTextReceiptV6146','genericAssessmentTextHeuristicNotApplicableV6146','retryReasonsForDiagnostic','retrySeverity','retryDecisionV61318','buildRetryPlan'])vm.runInContext(functionCode(name),c);
  return c;
}
function assessment(){
  return {parserConfidence:.96,declaredQuestionCount:2,warnings:[],questions:[1,2].map(n=>({courseraQuestionId:'item~q'+n,parserConfidence:.97,questionOrdinalObserved:true,
    type:'single-select',prompt:'Which result fits scenario '+n+'?',options:[{text:'A',correct:true},{text:'B',correct:false}],
    correctAnswers:['A'],optionTextReliable:true,answerTextReliable:true})),captureCompleteness:{declared:2,captured:2,uniqueQuestionIds:2,declaredContentParts:2,
    questionCoverageComplete:true,answerCoverageComplete:true,requiredAnswerCoverageComplete:true,nonQuestionPartOrdinals:[],
    missingQuestionOrdinals:[],missingRequiredAnswerOrdinals:[],unansweredQuestionOrdinals:[],missingOrdinalListTruncated:false}};
}
function diagnostic(c,a){return {id:'item',found:true,editorSurfaceCaptured:true,upgraded:true,bodyScoped:true,
  textScopeKind:'scoped-subtree',textCompleteness:.58,questionCycleDeclared:a.declaredQuestionCount,questionCycleQuestions:a.questions.length,
  questionCycleCaptureCompleteness:clone(a.captureCompleteness),assessmentTextReceipt:c.assessmentTextReceiptV6146(a,{id:'item'})};}
test('Complete structured question text avoids only the generic body-text retry',()=>{
  const c=runtime(),a=assessment(),before=JSON.stringify(a),d=diagnostic(c,a);
  assert.equal(d.assessmentTextReceipt.complete,true);assert.deepEqual(clone(c.retryReasonsForDiagnostic(d)),[]);
  assert.equal(JSON.stringify(a),before);assert.equal(d.textCompleteness,.58);
  d.stabilityTimedOut=true;assert.deepEqual(clone(c.retryReasonsForDiagnostic(d)),['timeout']);
  d.questionCycleCaptureCompleteness.answerCoverageComplete=false;d.questionCycleCaptureCompleteness.requiredAnswerCoverageComplete=false;
  assert(c.retryReasonsForDiagnostic(d).includes('incomplete-answer-evidence'));
});
test('Receipts retain retries for uncertain fields, identity gaps and non-question content',()=>{
  const c=runtime();
  const mutations=[
    a=>a.questions[1]=null,a=>a.questions[1].parserConfidence=.5,a=>a.parserConfidence=.5,a=>a.questions[1].prompt='',a=>a.questions[1].correctAnswers=[],a=>a.questions[1].answerTextReliable=false,
    a=>a.questions[1].optionTextReliable=false,a=>delete a.questions[1].options[0].correct,
    a=>a.questions[1].courseraQuestionId=a.questions[0].courseraQuestionId,
    a=>a.questions[1].questionOrdinalObserved=false,a=>a.questions[1].promptTruncated=true,
    a=>a.questions[1].promptBoundaryEvidence={rawPromptTruncated:true},
    a=>a.captureCompleteness.missingQuestionOrdinals=[2],a=>a.captureCompleteness.missingRequiredAnswerOrdinals=[2],
    a=>a.captureCompleteness.missingOrdinalListTruncated=true,a=>a.captureCompleteness.declaredContentParts=3,
    a=>a.captureCompleteness.nonQuestionPartOrdinals=[3],a=>a.warnings=['unresolved field'],
    a=>a.questions[1].type='unknown',a=>a.questions[1].type='file-upload',a=>a.questions[1].type='essay',
    a=>a.captureCompleteness.questionCoverageComplete=false,a=>a.captureCompleteness.answerCoverageComplete=false
  ];
  for(const mutate of mutations){const a=assessment();mutate(a);const d=diagnostic(c,a);
    assert.equal(d.assessmentTextReceipt.complete,false,mutate.toString());
    assert(c.retryReasonsForDiagnostic(d).includes('incomplete-text'),mutate.toString());}
  const a=assessment();a.questions[0].type='text-entry';a.questions[0].options=[];a.questions[0].optionTextReliable=false;
  assert.equal(diagnostic(c,a).assessmentTextReceipt.complete,true);
});
test('Retry selection requires this visit, retains receipts, and never infers from a later merged payload',()=>{
  const c=runtime(),a=assessment(),d=diagnostic(c,a),meta={targetIds:['item'],targetDiagnostics:[d]};
  assert.equal(c.buildRetryPlan(meta,[{id:'item',payload:{structuredAssessment:a}}]).length,0);
  assert.equal(meta.assessmentTextHeuristicSkipped.length,1);assert.equal(meta.retryDeferredEvidence.length,0);
  for(const mutate of [d=>delete d.assessmentTextReceipt,d=>d.assessmentTextReceipt.itemId='other',d=>d.questionCycleReactStateTruncated=true,
    d=>d.textScopeKind='reading-contenteditable',d=>d.bodyScoped=false,d=>d.questionCycleQuestions=1]){
    const changed=clone(d);mutate(changed);const m={targetIds:['item'],targetDiagnostics:[changed]};
    const plan=c.buildRetryPlan(m,[{id:'item',payload:{structuredAssessment:a}}]);
    assert(plan.some(p=>p.reasons.includes('incomplete-text')),mutate.toString());
  }
  const old=clone(d);delete old.assessmentTextReceipt;old.questionCycleQuestions=1;
  assert(c.retryReasonsForDiagnostic(old).includes('incomplete-question-cycle'));
});
test('Owner tasks deduplicate identical actions while retaining findings and different obligations',()=>{
  const results=[{courseraId:'item',ownerAction:{severity:'EVIDENCE',action:'Check media at question 4.'},checks:{}}];
  const items=[{id:'item'}],readiness={findings:[
    {itemId:'item',severity:'EVIDENCE',code:'A',action:'Confirm this question image.'},
    {itemId:'item',severity:'EVIDENCE',code:'B',action:'Confirm this question image.'},
    {itemId:'item',severity:'REVIEW',code:'C',action:'Check the attempt setting.'}]},before=JSON.stringify(readiness);
  qa.qaAttachReadinessActions_(results,items,readiness);
  assert.equal(results[0].ownerAction.action.match(/Confirm this question image\./g).length,1);
  assert.match(results[0].ownerAction.action,/Check the attempt setting/);
  assert.equal(results[0].checks.destinationReadiness.length,3);assert.equal(JSON.stringify(readiness),before);
});
test('Formula renderer advice distinguishes formula equivalence from restoring a navigation target',()=>{
  const url='https://example.test/filter/tex/displaytex.php?texexp=%20%5Cdiv%20';
  const r={verdict:'PARTIAL',issues:['LINK_NOT_OBSERVED'],checks:{links:{missing:[url,'https://video.example.test/lesson']}}},before=JSON.stringify(r);
  const action=qa.qaOwnerActionForResult_(r);
  assert.match(action.action,/Compare the source formula\(s\) \\div/);
  assert.match(action.action,/restore them if still required: https:\/\/video.example.test\/lesson/);
  assert.doesNotMatch(action.action,/restore them if still required: https:\/\/example.test\/filter/);
  assert.equal(JSON.stringify(r),before);
  for(const value of ['https://example.test/page?texexp=x','https://example.test/filter/tex/displaytex.php?texexp=%','https://example.test/filter/tex/displaytex.php?texexp='])assert.equal(qa.qaMathRendererFormula_(value),null);
});
test('Partially cleaned TeX and its exact spoken duplicate compare without fuzzy matching',()=>{
  const simple="2\\frac{7}{8}''",spoken="2, start fraction, 7, divided by, 8, end fraction, start superscript, prime, prime, end superscript";
  const rendered=simple+' '+spoken;
  assert.equal(qa.qaAssessmentFieldSimilarity_(simple,rendered),1);
  assert.equal(qa.qaOptionSemanticSimilarity_({text:simple},{text:rendered}).score,1);
  const changed="2\\frac{5}{8}'' 2, start fraction, 5, divided by, 8, end fraction, start superscript, prime, prime, end superscript";
  assert.equal(qa.qaAssessmentFieldSimilarity_(simple,changed),0);
  assert.equal(qa.qaAssessmentFieldSimilarity_(simple,simple+' '+spoken.replace('7, divided','5, divided')),0);
  assert.equal(qa.qaAssessmentMathKey_(rendered+' explanation'),null);
});
