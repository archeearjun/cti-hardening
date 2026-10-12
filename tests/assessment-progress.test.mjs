import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assessmentQuestionCheckpointV61518,rawAssessmentStateV61522,parseQuestionStateV664,loadedStateTextV61522} from '../src/extractors/coursera/assessments-4.js';
import {stateSearchBudgetV61313} from '../src/extractors/coursera/text-and-dom-3.js';
import {captureContractV6150} from '../src/extractors/coursera/completion.js';
const {fixture,El}=createRequire(import.meta.url)('../tools/assessment-fixture.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));

test('a delayed 100-question editor avoids repeated rail layout and unchanged DOM parsing',async()=>{
  const f=fixture({count:100,mode:'virtual',delay:1000,budget:480000});
  let anchorLayouts=0,parses=0;
  const visible=f.c.isVisibleElement,parse=f.c.parseAssignmentPartDomV665;
  f.c.isVisibleElement=el=>{if(el?.tagName==='A')anchorLayouts++;return visible(el);};
  f.c.parseAssignmentPartDomV665=(...args)=>{parses++;return parse(...args);};
  const result=await f.runFull();
  assert.equal(result.assessment.questionCount,100);
  assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert(anchorLayouts<1200,`Repeated full-rail layout checks: ${anchorLayouts}`);
  assert(parses<340,`Repeated parsing of unchanged questions: ${parses}`);
  assert.equal(f.mutations(),0);
});

test('interrupted question collection resumes only matching observed question identities',async()=>{
  const first=fixture({count:100,mode:'virtual',budget:480000});
  let saved=null;
  await assert.rejects(first.c.collectCourseraAssessmentByQuestionCycleV662(first.envelope,first.fp,{
    deadline:480000,onCheckpoint:async model=>{
      saved=clone(model);
      if(model.questionCount>=36)throw new Error('synthetic document interruption');
      return true;
    },
  }),/synthetic document interruption/);
  assert(saved.questionCount>=36 && saved.questionCount<=40);
  assert.equal(saved.captureCompleteness.questionCoverageComplete,false);
  const resumed=fixture({count:100,mode:'virtual',budget:480000});
  const result=await resumed.c.collectCourseraAssessmentByQuestionCycleV662(resumed.envelope,resumed.fp,{
    deadline:480000,seedAssessment:saved,
  });
  assert.equal(result.assessment.questionCount,100);
  assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert.equal(resumed.clicks(),100-saved.questionCount);
  assert.deepEqual(clone(result.assessment.questions.slice(1,saved.questionCount)),saved.questions.slice(1));
  const changed=fixture({count:100,mode:'virtual',budget:480000});
  saved.questions[9].prompt='A different question that was previously observed.';
  const checked=await changed.c.collectCourseraAssessmentByQuestionCycleV662(changed.envelope,changed.fp,{deadline:480000,seedAssessment:saved});
  assert.equal(changed.clicks(),101-saved.questionCount,'A changed prompt must be observed again');
  assert.notEqual(checked.assessment.questions[9].prompt,saved.questions[9].prompt);
});

test('a partial question checkpoint preserves raw observations and cannot complete an unfinished visit',async()=>{
  const f=fixture({count:10,mode:'virtual',budget:480000}),full=(await f.runFull()).assessment;
  const raw={questions:[{unknownField:'original raw evidence'}]};
  const fp={id:'assessment-under-test',type:'Assignment',payload:{captureAttempts:1,rawSnapshot:raw,structuredAssessment:full}};
  const before=JSON.stringify(fp);
  const checkpoint=assessmentQuestionCheckpointV61518(fp,full,'2026-10-11T00:00:00Z');
  assert.equal(checkpoint.payload.captureAttempts,0);
  assert.equal(captureContractV6150(checkpoint).complete,false);
  assert.equal(captureContractV6150(checkpoint).needsEditor,true);
  assert.deepEqual(checkpoint.payload.rawSnapshot,raw);
  assert.equal(JSON.stringify(fp),before);
  const subset={...full,questionCount:2,questions:full.questions.slice(0,2)};
  const repeated=assessmentQuestionCheckpointV61518({...fp,payload:{...fp.payload,assessmentCaptureInProgress:checkpoint.payload.assessmentCaptureInProgress}},subset,'2026-10-11T00:01:00Z');
  assert.equal(repeated.payload.assessmentCaptureInProgress.assessment.questionCount,10,'A later interruption cannot erase earlier saved question observations');
  assert.equal(captureContractV6150(repeated).complete,false);
  delete repeated.payload.assessmentCaptureInProgress;
  assert.equal(captureContractV6150(repeated).complete,true);
});

test('all mounted identified questions finish without a redundant question traversal',async()=>{
  const f=fixture({count:100,mode:'virtual',budget:480000});
  f.content.replaceChildren(...Array.from({length:100},(_,i)=>{
    const n=i+1,part=new El('section',{id:'assessment~q'+n,'data-testid':'assignment-part-'+i});
    part.append(new El('h3',{},n+'Auto-Graded 1 point'),new El('p',{},'Question Type Multiple Choice Prompt'),
      new El('p',{},`Which result is correct for scenario ${n} in this assessment?`),new El('p',{},'Options'));
    for(const [label,status] of [['A','Correct'],['B','Incorrect']]){
      const row=new El('div',{'data-testid':'option'});row.append(new El('p',{},label),new El('span',{},status));part.append(row);
    }
    return part;
  }));
  f.c.collectAssessmentFromOutlineDomV665=()=>{throw new Error('Redundant traversal');};
  const result=await f.runFull();
  assert.equal(result.stopReason,'MOUNTED_QUESTIONS_COMPLETE');
  assert.equal(result.assessment.questionCount,100);assert.equal(f.clicks(),0);
  assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
});

test('a fresh mounted question is saved before the first editor activation can crash',async()=>{
 const f=fixture({count:100,mode:'virtual',budget:480000});let saved;
 await assert.rejects(f.c.collectCourseraAssessmentByQuestionCycleV662(f.envelope,f.fp,{deadline:480000,
  onCheckpoint:async model=>{saved=clone(model);throw Error('interrupt before activation');}}),/interrupt before activation/);
 assert.equal(saved.questionCount,1);assert.equal(saved.questions[0].courseraQuestionId,'assessment~q1');assert.equal(f.clicks(),0);
 assert.equal(saved.captureCompleteness.questionCoverageComplete,false);
});

test('a failed progress save stops repeat writes without discarding collected questions',async()=>{
  const f=fixture({count:100,mode:'virtual',budget:480000});let writes=0;
  const result=await f.c.collectCourseraAssessmentByQuestionCycleV662(f.envelope,f.fp,{deadline:480000,onCheckpoint:async()=>{writes++;return false;}});
  assert.equal(writes,1);assert.equal(result.assessment.questionCount,100);
});

test('loaded definitions bind to live outline identities without clicking question editors or losing raw fields',async()=>{
 const f=fixture({count:100,mode:'virtual',budget:480000});f.fp.payload={};f.c.MAX_CAPTURED_RESPONSE_CHARS=2500000;f.c.MAX_WALK_NODES=40000;f.c.URL=URL;f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit/assessment/assessment-under-test');
 f.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[f.now()]));}static now(){return f.now();}};
 const raw=Array.from({length:100},(_,i)=>({id:'assessment~q'+(i+1),questionType:'Multiple Choice',
  prompt:`Which result is correct for scenario ${i+1} in this assessment?`,
  options:[{text:'Correct choice '+(i+1),correct:true},{text:'Wrong choice '+(i+1),correct:false}],
  sourceMath:'<math><mi>α</mi></math>',unknownOriginalField:{unicode:'café 日本語'}}));
 // The same question objects can appear in an earlier preview in another order.
 f.envelope.__reactProps$fixture={preview:raw.slice(0,2).reverse(),questions:raw};
 const result=await f.c.collectCourseraAssessmentByQuestionCycleV662(f.envelope,f.fp,{deadline:480000,certifiedItem:true});
 assert.equal(result.assessment.questionCount,100);assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(f.clicks(),0);assert.equal(result.outlineDomTraversal.loadedModelQuestions,99);
 assert.deepEqual(clone(f.fp.payload.loadedAssessmentEvidence.rawQuestionDefinitions),raw);
 assert(result.assessment.questions.filter(q=>q.observationMethod==='LOADED_MODEL_MATCHED_TO_LIVE_OUTLINE')
  .every(q=>raw[q.sourceArrayIndex].id===q.sourceQuestionId),'Raw definition indices belong to the selected array, even when parsed objects were cached');
 assert(result.assessment.questions.every((q,i)=>q.courseraQuestionId==='assessment~q'+(i+1) && q.questionOrdinalObserved));
});

test('an unrelated large query cache cannot discard a completely parsed and copied assessment array',async()=>{
 const f=fixture({count:100,mode:'virtual',budget:480000});f.fp.payload={};f.c.MAX_CAPTURED_RESPONSE_CHARS=2500000;f.c.MAX_WALK_NODES=40000;f.c.URL=URL;
 f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit/assessment/assessment-under-test');
 f.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[f.now()]));}static now(){return f.now();}};
 const raw=Array.from({length:100},(_,i)=>({id:'assessment~q'+(i+1),questionType:'Multiple Choice',
  prompt:`Which result is correct for scenario ${i+1} in this assessment?`,
  options:[{text:'Correct choice '+(i+1),correct:true},{text:'Wrong choice '+(i+1),correct:false}]}));
 const cache=Array.from({length:100},()=>Object.fromEntries(Array.from({length:100},(_,j)=>
  ['cached'+j,{value:'Unrelated cached information',nested:{number:j}}])));
 f.envelope.__reactProps$fixture={questions:raw,cache};
 const probe=f.c.collectReactAssessmentStateV664(f.envelope,f.fp,100,{deadline:480000});
 assert.equal(probe.truncated,true);assert.equal(probe.stopReason,'NODE_BUDGET');
 assert.equal(probe.selectedArrayComplete,true);assert.equal(probe.assessment.stateEvidence.selectedArrayComplete,true);
 assert.equal(probe.assessment.stateEvidence.rawCapture.complete,true);
 assert.deepEqual(clone(probe.assessment.stateEvidence.rawQuestionDefinitions),raw);
 const result=await f.c.collectCourseraAssessmentByQuestionCycleV662(f.envelope,f.fp,{deadline:480000,certifiedItem:true});
 assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(f.clicks(),0);assert.equal(result.outlineDomTraversal.loadedModelQuestions,99);
 assert.deepEqual(clone(f.fp.payload.loadedAssessmentEvidence.rawQuestionDefinitions),raw);
});

test('a selected raw snapshot survives the search deadline spent on unrelated cached state',()=>{
 const f=fixture({count:100,mode:'virtual',budget:480000});f.c.MAX_CAPTURED_RESPONSE_CHARS=2500000;
 let searchTime=0;
 f.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[searchTime]));}static now(){return searchTime;}};
 const step=f.c.stateSearchStepV61313;
 f.c.stateSearchStepV61313=work=>{searchTime+=0.2;return step(work);};
 const raw=Array.from({length:100},(_,i)=>({id:'assessment~q'+(i+1),
  prompt:`Which result is correct for scenario ${i+1} in this assessment?`,
  options:[{text:'A',correct:true},{text:'B',correct:false}]}));
 const cache=Array.from({length:100},()=>Object.fromEntries(Array.from({length:100},(_,j)=>['cached'+j,{value:'Unrelated cached information'}])));
 f.envelope.__reactProps$fixture={questions:raw,cache};
 const probe=f.c.collectReactAssessmentStateV664(f.envelope,f.fp,100,{deadline:480000});
 assert.equal(probe.truncated,true);assert.equal(probe.stopReason,'TIME_BUDGET');
 assert.equal(probe.selectedArrayComplete,true);assert.equal(probe.assessment.stateEvidence.rawCapture.complete,true);
 assert.deepEqual(clone(probe.assessment.stateEvidence.rawQuestionDefinitions),raw);
});

test('a question array interrupted during its own parsing remains ineligible for loaded-model reuse',()=>{
 const f=fixture({count:100,mode:'virtual',budget:480000});f.c.MAX_CAPTURED_RESPONSE_CHARS=2500000;
 const budget=f.c.stateSearchBudgetV61313;
 f.c.stateSearchBudgetV61313=options=>({...budget(options),remaining:2000});
 f.envelope.__reactProps$fixture={questions:Array.from({length:100},(_,i)=>({id:'assessment~q'+(i+1),
  prompt:`Which result is correct for scenario ${i+1} in this assessment?`,
  options:[{text:'A',correct:true},{text:'B',correct:false}]}))};
 const probe=f.c.collectReactAssessmentStateV664(f.envelope,f.fp,100,{deadline:480000});
 assert.equal(probe.truncated,true);assert.equal(probe.stopReason,'NODE_BUDGET');
 assert(probe.questionCount>1 && probe.questionCount<100);
 assert.equal(probe.selectedArrayComplete,false);assert.equal(probe.assessment.stateEvidence.selectedArrayComplete,false);
 assert.equal(probe.assessment.stateEvidence.rawCapture.complete,false);
 assert.equal(probe.assessment.stateEvidence.rawCapture.reason,'SELECTED_ARRAY_NOT_FULLY_PARSED');
 assert.equal(probe.assessment.stateEvidence.rawQuestionDefinitions,undefined);
});

test('incomplete or ambiguous loaded models retain DOM recovery and cannot invent answer keys',async()=>{
 const f=fixture({count:10,mode:'virtual',budget:480000});f.fp.payload={};f.c.MAX_CAPTURED_RESPONSE_CHARS=2500000;f.c.MAX_WALK_NODES=40000;f.c.URL=URL;f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit/assessment/assessment-under-test');
 f.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[f.now()]));}static now(){return f.now();}};
 f.envelope.__reactProps$fixture={questions:Array.from({length:10},(_,i)=>({id:'assessment~q'+(i+1),
  prompt:`Which result is correct for scenario ${i+1} in this assessment?`,options:[{text:'A'},{text:'B'}]}))};
 const result=await f.c.collectCourseraAssessmentByQuestionCycleV662(f.envelope,f.fp,{deadline:480000,certifiedItem:true});
 assert.equal(result.assessment.questionCount,10);assert.equal(f.clicks(),9);assert.equal(result.outlineDomTraversal.loadedModelQuestions,0);
 assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true,'Keys came from the observed DOM');
});

test('raw loaded-model copying preserves JSON data and declines getters, cycles, non-JSON objects and oversized strings',()=>{
 const original={math:'<math><mi>α</mi></math>',unknown:{unicode:'café 日本語'},options:[null,true,3,'A']};
 const copied=rawAssessmentStateV61522(original,Date.now()+1000);assert.equal(copied.complete,true);assert.deepEqual(clone(copied.value),original);
 const unusual=JSON.parse('{"__proto__":{"retained":true},"text":"observed"}');
 const unusualCopy=rawAssessmentStateV61522(unusual,Date.now()+1000);assert.equal(unusualCopy.complete,true);
 assert.deepEqual(unusualCopy.value,unusual);assert.equal(Object.getPrototypeOf(unusualCopy.value),Object.prototype);
 assert.equal(String(unusualCopy.value),'[object Object]');assert.equal({}.retained,undefined);
 let invoked=0;const accessor={};Object.defineProperty(accessor,'question',{enumerable:true,get(){invoked++;return 'unobserved'}});
 assert.equal(rawAssessmentStateV61522(accessor,Date.now()+1000).reason,'ACCESSOR_STATE');assert.equal(invoked,0);
 const cycle={};cycle.self=cycle;assert.equal(rawAssessmentStateV61522(cycle,Date.now()+1000).reason,'CYCLIC_STATE');
 assert.equal(rawAssessmentStateV61522(new Date(),Date.now()+1000).reason,'NON_JSON_OBJECT');
 assert.equal(rawAssessmentStateV61522({prompt:'x'.repeat(2500001)},Date.now()+1000).reason,'RAW_MODEL_LIMIT_REACHED');
});

test('recognized loaded markup wrappers keep full prompt and feedback text without mixing metadata into content',()=>{
 const prompt='Which result is correct? '+('Observed learner wording. '.repeat(100));
 const feedback='Full feedback explanation. '.repeat(100);
 const q=parseQuestionStateV664({id:'observed-source-id',questionType:'Multiple Choice',
  prompt:{typeName:'cml',definition:{dtdId:'metadata-not-learner-text',value:'<p>'+prompt+'</p>'}},
  options:[{text:'A',correct:true},{text:'B',correct:false}],feedback:{definition:{value:'<p>'+feedback+'</p>'}}},0);
 assert.equal(q.loadedTextComplete,true);assert.equal(q.prompt,prompt.trim());assert.equal(q.feedback,feedback.trim());
 assert(!q.prompt.includes('metadata-not-learner-text'));
 const work=stateSearchBudgetV61313();
 assert.equal(loadedStateTextV61522('x'.repeat(1500000),work).complete,true);
 assert.equal(loadedStateTextV61522('y'.repeat(1500000),work).complete,false);
 assert.equal(work.stopReason,'STATE_TEXT_CHARACTER_LIMIT','Aggregate string allocation stops before decoding an oversized loaded bank');
});

test('duplicate loaded prompts cannot substitute one question identity or answer for another',async()=>{
 const f=fixture({count:100,mode:'virtual',duplicates:true,budget:480000});f.fp.payload={};f.c.MAX_CAPTURED_RESPONSE_CHARS=2500000;f.c.MAX_WALK_NODES=40000;
 f.c.URL=URL;f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit/assessment/assessment-under-test');
 f.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[f.now()]));}static now(){return f.now();}};
 f.envelope.__reactProps$fixture={questions:Array.from({length:100},(_,i)=>({id:'assessment~q'+(i+1),questionType:'Multiple Choice',
  prompt:`Which result is correct for scenario ${i===27?27:i+1} in this assessment?`,
  options:[{text:'Correct choice '+(i+1),correct:true},{text:'Wrong choice '+(i+1),correct:false}]}))};
 const result=await f.c.collectCourseraAssessmentByQuestionCycleV662(f.envelope,f.fp,{deadline:480000,certifiedItem:true});
 assert.equal(result.assessment.questionCount,100);assert.equal(f.clicks(),0);
 assert.equal(result.outlineDomTraversal.loadedModelQuestions,99);
 assert.deepEqual(clone(result.assessment.questions[26].correctAnswers),['Correct choice 27']);
 assert.equal(result.assessment.questions[27].courseraQuestionId,'assessment~q28');
 assert.deepEqual(clone(result.assessment.questions[27].correctAnswers),['Correct choice 28']);
});

test('duplicate prompts with missing or conflicting source IDs require fresh DOM answer observations',async()=>{
 for(const conflictingIds of [false,true]){
  const f=fixture({count:100,mode:'virtual',duplicates:true,budget:480000});f.fp.payload={};f.c.MAX_CAPTURED_RESPONSE_CHARS=2500000;f.c.MAX_WALK_NODES=40000;
  f.c.URL=URL;f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit/assessment/assessment-under-test');
  f.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[f.now()]));}static now(){return f.now();}};
  const raw=Array.from({length:100},(_,i)=>({id:'assessment~q'+(i+1),questionType:'Multiple Choice',
   prompt:`Which result is correct for scenario ${i===27?27:i+1} in this assessment?`,
   options:[{text:'Unverified loaded choice '+(i+1),correct:true},{text:'Wrong choice '+(i+1),correct:false}]}));
  if(conflictingIds)raw[27].id=raw[26].id;
  else {delete raw[26].id;delete raw[27].id;}
  f.envelope.__reactProps$fixture={questions:raw};
  const result=await f.c.collectCourseraAssessmentByQuestionCycleV662(f.envelope,f.fp,{deadline:480000,certifiedItem:true});
  assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert.equal(f.clicks(),2,'Ambiguous rows must fall back to their own mounted DOM definitions');
  assert.deepEqual(clone(result.assessment.questions[26].correctAnswers),['Correct choice 27']);
  assert.deepEqual(clone(result.assessment.questions[27].correctAnswers),['Correct choice 28']);
 }
});
test('safe pauses resume an unfinished keyed or unkeyed assessment without repeating its observed prefix',async()=>{
 for(const unkeyed of [false,true]){
  const first=fixture({count:100,mode:'virtual',budget:480000});let saved,reason='';
  function removeKeys(f){
   const parse=f.c.parseAssignmentPartDomV665;f.c.collectCourseraStructuredAssessment=()=>null;
   f.c.parseAssignmentPartDomV665=(...args)=>{const q=parse(...args);return q?{...q,answerTextReliable:false,correctAnswers:[],answerEvidence:'NOT_OBSERVED'}:q};
  }
  if(unkeyed)removeKeys(first);
  const partial=await first.c.collectCourseraAssessmentByQuestionCycleV662(first.envelope,first.fp,{deadline:480000,
   shouldYield:()=>reason,onCheckpoint:async model=>{saved=clone(model);if(model.questionCount>=25)reason='LOCAL_RENDERER_QUESTION_LIMIT';return true}});
  assert.equal(partial.stopReason,'LOCAL_ASSESSMENT_CHECKPOINT_YIELD');assert(saved.questionCount>=25 && saved.questionCount<=30);
  let result,writes=0,totalClicks=0;
  for(let document=0;document<5;document++){
   const resumed=fixture({count:100,mode:'virtual',budget:480000});if(unkeyed)removeKeys(resumed);
   const baseline=saved.questionCount;let pause='';
   const hydrate=resumed.c.hydrateAssignmentPartV666;
   resumed.c.hydrateAssignmentPartV666=(candidate,...args)=>{
    assert(Number(candidate.ordinal)>baseline,'An observed matching prefix must not be clicked again');return hydrate(candidate,...args);
   };
   result=await resumed.c.collectCourseraAssessmentByQuestionCycleV662(resumed.envelope,resumed.fp,{deadline:480000,
    seedAssessment:saved,resumeInProgress:true,shouldYield:()=>pause,onCheckpoint:async model=>{
     assert(model.questionCount>baseline,'Rediscovering a saved prefix must not cause a checkpoint write');
     writes++;saved=clone(model);if(model.questionCount-baseline>=25 && model.questionCount<100)pause='LOCAL_RENDERER_QUESTION_LIMIT';return true;
    }});
   totalClicks+=resumed.clicks();if(result.assessment.questionCount===100)break;
  }
  assert.equal(result.assessment.questionCount,100);if(!unkeyed)assert(totalClicks<=75);
  assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,!unkeyed);
  assert(writes<=(unkeyed?100:22),'Writes must be bounded by new observations, including slow per-question saves');
  if(unkeyed)assert(result.assessment.questions.every(q=>q.answerTextReliable===false));
 }
});
