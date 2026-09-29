import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const qa=require('../tools/check.cjs');
const {fixture,El,functionCode}=require('../tools/assessment-fixture.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));

function entryPart(n,values,rawType='Text match') {
  const part=new El('section',{id:'assessment~q'+n,'data-testid':'assignment-part-'+(n-1)});
  part.append(new El('h3',{},n+'Auto-Graded 1 point'),new El('p',{},'Question Type '+rawType+' Prompt'),
    new El('p',{},'Which result is correct for scenario '+n+' in this assessment?'),new El('p',{},'Correct Answers'));
  for(const value of values){const row=new El('div',{'data-testid':'option'});row.append(new El('p',{},value),new El('span',{},'Correct'));part.append(row);}
  return part;
}
test('Full collector keeps numeric text-match variants as accepted responses, without stripping digits',async()=>{
  const f=fixture({count:2});
  f.content.replaceChildren(entryPart(1,['1234','1,234']),entryPart(2,['-3.50','0.25']));
  const result=await f.runFull(),a=result.assessment;
  assert.equal(a.questionCount,2);assert.equal(a.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert.deepEqual(plain(a.questions.map(q=>q.type)),['text-entry','text-entry']);
  assert.deepEqual(plain(a.questions[0].correctAnswers),['1234','1,234']);
  assert.deepEqual(plain(a.questions[1].correctAnswers),['-3.50','0.25']);
  assert.equal(f.mutations(),0);
});
test('Explicit text-match response type outranks true/false-looking accepted values',()=>{
  const f=fixture({count:1});
  assert.equal(f.c.inferSelectedQuestionTypeV662('Text match',[{label:'True',correct:true},{label:'False',correct:true}],'',''),'text-entry');
  assert.equal(f.c.inferSelectedQuestionTypeV662('Multiple Choice',[{label:'True',correct:true},{label:'False',correct:false}],'',''),'true-false');
});
test('Historical raw type and identity survive repeated normalization without altering captured answers',()=>{
  for(const previous of ['unknown','multiple-select']){
    const q={id:'4',courseraQuestionId:'assessment~question4',questionOrdinalObserved:true,type:previous,rawType:'Text match',
      prompt:'Calculate this result.',correctAnswers:['1234','1,234'],options:[],answerTextReliable:true};
    const before=JSON.stringify(q),once=qa.qaNormalizeQuestion_(q,0),twice=qa.qaNormalizeQuestion_(once,0);
    assert.equal(twice.type,'text-entry');assert.equal(twice.rawType,'Text match');
    assert.equal(twice.id,'4');assert.equal(twice.courseraQuestionId,q.courseraQuestionId);
    assert.deepEqual(plain(twice.correctAnswers),q.correctAnswers);assert.equal(JSON.stringify(q),before);
  }
});
test('Identified partial assessment cannot be inflated or renumbered by clipped page text',()=>{
  const primary={parser:'coursera-assignment-outline-dom-v2-dynamic',declaredQuestionCount:2,
    captureCompleteness:{declared:2,captured:1,questionCoverageComplete:false,missingQuestionOrdinals:[1]},
    questions:[{id:'2',courseraQuestionId:'test~second',questionOrdinalObserved:true,type:'text-entry',rawType:'Text match',
      prompt:'What value was observed?',correctAnswers:['20'],answerTextReliable:true}]};
  const fallback={declaredQuestionCount:2,questions:[{id:'1',type:'text-entry',prompt:'What value was observed?',correctAnswers:['20']},
    {id:'2',type:'text-entry',prompt:'What value was observed? Export Settings',correctAnswers:['20']}]};
  const merged=qa.qaMergeCourseraStructuredEvidence_(primary,fallback);
  assert.equal(merged.questions.length,1);assert.equal(merged.questions[0].id,'2');
  assert.equal(merged.captureCompleteness.questionCoverageComplete,false);
  assert.deepEqual(plain(merged.captureCompleteness.missingQuestionOrdinals),[1]);
});
test('Matching captured subset cannot become verified when explicit coverage is incomplete',()=>{
  const model={parser:'fixture',declaredQuestionCount:1,questions:[{id:'1',type:'text-entry',prompt:'What value was observed?',correctAnswers:['20'],answerTextReliable:true}]};
  const source={isStructuredAssessment:true,structuredAssessment:model};
  const destination={structuredAssessment:{...model,captureCompleteness:{questionCoverageComplete:false}}};
  let result=qa.qaStructuredAssessmentComparison_(source,destination);
  assert.equal(result.captureCoverageUnverified,true);assert.equal(result.status,'UNVERIFIED');
  const readiness=qa.qaCourseraCaptureReadiness_({buildId:qa.CTI_RELEASE_REGISTRY_.courseraExtractor.version},[
    {courseraId:'one',courseraName:'Assessment',checks:{structuredAssessment:result}}]);
  assert.equal(readiness.assessmentGaps[0].questionCaptureIncomplete,true);
  destination.structuredAssessment.questions=[{...model.questions[0],correctAnswers:['30']}];
  result=qa.qaStructuredAssessmentComparison_(source,destination);
  assert.equal(result.answerMismatchCount,1);assert.notEqual(result.status,'VERIFIED');
});
test('Fallback keeps instruction positions separate from unresolved question answer evidence',async()=>{
  const f=fixture({count:3}),intro=new El('div',{id:'assessment~textBlock!~intro','data-testid':'assignment-part-0'});
  intro.append(new El('h3',{},'1Text block'),new El('p',{},'Title Introduction Content Read the scenario before answering.'));
  f.sidebar.querySelector('a[href^="#"]').setAttribute('href','#assessment~textBlock!~intro');
  const unresolved=entryPart(2,[],'Unsupported response'),complete=entryPart(3,['20']);
  f.content.replaceChildren(intro,unresolved,complete);
  for(const link of f.sidebar.querySelectorAll('a[href^="#"]'))link.onClick=()=>{};
  const result=await f.runFull(),a=result.assessment;
  assert.equal(a.declaredQuestionCount,2);assert.equal(a.questions.length,2);
  assert.deepEqual(plain(a.captureCompleteness.nonQuestionPartOrdinals),[1]);
  assert.equal(a.captureCompleteness.questionCoverageComplete,true);
  assert.equal(a.captureCompleteness.requiredAnswerCoverageComplete,false);
  assert.equal(f.mutations(),0);
});
test('Published YouTube configuration captures the scoped video target without claiming playback',()=>{
  const f=fixture({count:1}),root=new El('div');root.documentRoot=true;
  root.append(new El('div',{},'PLUGIN Tutorial'),new El('span',{},'YouTube'),new El('button',{},'View Configuration'));
  Object.assign(f.c,{URL,location:{href:'https://example.test/item/plugin/video'},isAuthoringChromeUrl:()=>false,isCourseraUiAssetUrl:()=>false,
    visiblePluginConfigurationV61316:()=>({values:[{videoId:'AbcDefGh123',start:12}],editorCount:1,parseFailures:0}),
    extractConfiguredExternalUrls:()=>[],reactPropsForElement:()=>null});
  vm.runInContext(functionCode('collectPluginEvidenceV6139'),f.c);
  const p=f.c.collectPluginEvidenceV6139(root,{id:'video',type:'Plugin'});
  assert.equal(p.kind,'YOUTUBE');assert.match(p.targets[0].url,/watch\?v=AbcDefGh123&start=12/);
  assert.equal(p.playbackStatus,'NOT_OBSERVED');assert.equal(p.launchStatus,'NOT_VERIFIED');
  root.querySelector('span').textContent='Read about YouTube';
  assert.equal(f.c.collectPluginEvidenceV6139(root,{id:'video',type:'Plugin'}).kind,'PLUGIN');
});

const bs=qa.ctiCanonicalBrightspaceExtractorSource_();
function brightspacePages(pages){
  const calls=[],context={URL,location:{origin:'https://lms.example.test'},REQUEST_DELAY_MS:0,sleep:async()=>{},
    fetchJson:async(url)=>{calls.push(url);const p=pages[calls.length-1];if(p instanceof Error)throw p;return p;}};
  vm.createContext(context);
  const functions=createRequire(import.meta.url)('../tools/extractor-functions.cjs').extractorFunctions(bs);
  for(const name of ['fetchDefinitionPagesV106','fetchQuestionPagesV105','getId','listObjects'])vm.runInContext(functions.get(name),context);
  return {c:context,calls};
}
const endpoint='/d2l/api/le/1.82/123/quizzes/';
test('Brightspace quiz inventory follows all same-endpoint pages and deduplicates by QuizId',async()=>{
  const f=brightspacePages([{Objects:[{QuizId:1},{QuizId:2}],Next:endpoint+'?bookmark=2'},
    {Objects:[{QuizId:2},{QuizId:3}],Next:null}]);
  const result=await f.c.fetchDefinitionPagesV106(endpoint,'Quizzes',100,['QuizId']);
  assert.deepEqual(plain(result.objects.map(x=>x.QuizId)),[1,2,3]);assert.equal(result.evidence.complete,true);
  assert.equal(result.evidence.duplicates,1);assert.equal(f.calls.length,2);
});
test('Brightspace question collection passes the former 500-definition ceiling',async()=>{
  const rows=Array.from({length:650},(_,i)=>({QuestionId:i+1}));
  const f=brightspacePages([{Objects:rows.slice(0,400),Next:endpoint+'7/questions/?bookmark=400'},
    {Objects:rows.slice(400),Next:null}]);
  const result=await f.c.fetchQuestionPagesV105(endpoint+'7/questions/','Questions',5000);
  assert.equal(result.objects.length,650);assert.equal(result.evidence.complete,true);
});
test('Pagination refuses endpoint escapes, loops, missing markers and partial permissions',async()=>{
  for(const [next,reason] of [['https://elsewhere.test/steal','OUT_OF_SCOPE_NEXT_URL'],[endpoint+'7/attempts/','OUT_OF_SCOPE_NEXT_URL'],[endpoint,'REPEATED_PAGE']]){
    const f=brightspacePages([{Objects:[{QuizId:1}],Next:next}]);
    const result=await f.c.fetchDefinitionPagesV106(endpoint,'Quizzes',100,['QuizId']);
    assert.equal(result.evidence.stopReason,reason);assert.equal(result.evidence.complete,false);assert.equal(f.calls.length,1);
  }
  let f=brightspacePages([{Objects:[{QuizId:1}]}]);
  let result=await f.c.fetchDefinitionPagesV106(endpoint,'Quizzes',100,['QuizId']);
  assert.equal(result.evidence.stopReason,'MISSING_NEXT_MARKER');assert.equal(result.objects.length,1);
  f=brightspacePages([{Objects:[{QuizId:1}],Next:endpoint+'?bookmark=1'},new Error('403 unavailable')]);
  result=await f.c.fetchDefinitionPagesV106(endpoint,'Quizzes',100,['QuizId']);
  assert.equal(result.objects.length,1);assert.equal(result.evidence.stopReason,'PAGE_UNAVAILABLE');assert.equal(result.evidence.complete,false);
});
test('Brightspace bounded record limit reports truncation rather than completeness',async()=>{
  const f=brightspacePages([{Objects:[{QuizId:1},{QuizId:2},{QuizId:3}],Next:null}]);
  const result=await f.c.fetchDefinitionPagesV106(endpoint,'Quizzes',2,['QuizId']);
  assert.equal(result.objects.length,2);assert.equal(result.evidence.stopReason,'DEFINITION_LIMIT');assert.equal(result.evidence.complete,false);
});
