import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const qa=createRequire(import.meta.url)('../tools/check.cjs');
function quiz(patch={}) {
  return {id:'quiz',questionsStatus:'CAPTURED',questionPageEvidence:{complete:true,stopReason:'END_OF_API_PAGES'},
    questionCoverage:{status:'TOTAL_UNVERIFIED',completenessVerified:false},
    questions:[{QuestionId:1,QuestionTypeId:1,QuestionText:{Text:'Choose the matching safety label.'},
      QuestionInfo:{Answers:[{Answer:{Text:'A'},Weight:100},{Answer:{Text:'B'},Weight:0}]}}],...patch};
}
function compare(a,answer='A') {
  return qa.qaStructuredAssessmentComparison_({isStructuredAssessment:true,structuredAssessment:a},
    {structuredAssessment:{parser:'coursera-observed',parserConfidence:.99,questionCount:1,declaredQuestionCount:1,
      questions:[{type:'single-select',prompt:'Choose the matching safety label.',options:['A','B'],correctAnswers:[answer]}]}});
}
test('Matching Brightspace subsets cannot verify an unknown source total; raw evidence stays intact',()=>{
  const raw=quiz(),before=JSON.stringify(raw),a=qa.qaBrightspaceQuizToAssessment_(raw),r=compare(a);
  assert.equal(qa.qaBrightspaceDeclaredQuizCount_(raw),null);
  assert.equal(a.definitionCoverage.observedDeclaredQuestionCount,null);
  assert.equal(a.definitionCoverage.completenessVerified,false);
  assert.equal(r.alignedQuestionCount,1);assert.equal(r.answerEvidenceCoverage,1);
  assert.equal(r.status,'UNVERIFIED');assert.equal(r.definitionCoverageUnverified,true);
  assert.match(r.reason,/Matching captured subsets/);assert.equal(JSON.stringify(raw),before);
});
test('Coverage uncertainty survives repeated normalization and old stored API models',()=>{
  const a=qa.qaBrightspaceQuizToAssessment_(quiz());
  const normalized=qa.qaNormalizeAssessment_(qa.qaNormalizeAssessment_(a,'source-qti'),'source-qti');
  assert.equal(normalized.definitionCoverage.completenessVerified,false);
  const legacy=JSON.parse(JSON.stringify(a));delete legacy.definitionCoverage;
  assert.equal(compare(legacy).status,'UNVERIFIED');
  assert.equal(compare(legacy).sourceDefinitionCoverage.status,'LEGACY_TOTAL_UNVERIFIED');
});
test('A complete declared definition capture retains verification; partial or contradictory receipts do not',()=>{
  const complete=quiz({declaredQuestionCount:1,questionCoverage:{status:'MATCH',completenessVerified:true}});
  assert.equal(compare(qa.qaBrightspaceQuizToAssessment_(complete)).status,'VERIFIED');
  for(const patch of [{questionsStatus:'PARTIAL'},{questionPageEvidence:{complete:false}},
    {declaredQuestionCount:2},{declaredQuestionCount:null},{questionCoverage:{status:'TOTAL_UNVERIFIED',completenessVerified:false}}]) {
    assert.equal(compare(qa.qaBrightspaceQuizToAssessment_({...complete,...patch})).status,'UNVERIFIED');
  }
});
test('Observed answer defects remain actionable even when the total is unknown',()=>{
  const r=compare(qa.qaBrightspaceQuizToAssessment_(quiz()),'B');
  assert.equal(r.status,'CHANGED');assert.equal(r.answerMismatchCount,1);
  assert.equal(r.definitionCoverageUnverified,true);
});
test('Independent package QTI definitions retain their own coverage and are not downgraded by unrelated API gaps',()=>{
  const a=qa.qaBrightspaceQuizToAssessment_(quiz());
  a.parser='ims-qti-dom-v4';a.origin='source-qti';delete a.definitionCoverage;
  const r=compare(a);assert.equal(r.status,'VERIFIED');assert.equal(r.definitionCoverageUnverified,false);
});
test('Owner guidance requests source evidence instead of another identical destination crawl',()=>{
  const structured=compare(qa.qaBrightspaceQuizToAssessment_(quiz()));
  const action=qa.qaOwnerActionForResult_({sourceName:'Safety assessment',verdict:'UNVERIFIED',issues:['PAYLOAD_UNVERIFIED'],checks:{structuredAssessment:structured}});
  assert.match(action.action,/Repeating an unchanged destination capture will not resolve an unknown source total/);
});
