import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAutomaticLocalCourseraCommand,createSavedCourseraCheckpointExportCommand} from '../src/domain/coursera-local-extraction.ts';
import {automaticLocalCaptureNeedsContinuationV61519,advanceAutomaticLocalCaptureV61517} from '../src/extractors/coursera/automatic-local.js';

test('denied authoring API reads finish the controller without a reload loop',()=>{
 const data={fingerprints:[{id:'quiz',payload:{captureAttempts:1}}],
  meta:{activeSpaCrawl:{authoringApiAccessStopped:true},captureAccounting:{complete:false,unvisitedCount:10}}};
 const next=advanceAutomaticLocalCaptureV61517({startedAt:100,batches:0},data,true,false,true,200);
 assert.equal(next.state,'FINISHED');assert.equal(next.reason,'AUTHORING_API_ACCESS_REQUIRED');
 assert.equal(next.complete,false);assert.match(next.message,/sign-in and authoring permission/);
});

test('Coursera rate limits stop automatic editor traversal and continuation',()=>{
 const data={fingerprints:[{id:'quiz',payload:{captureAttempts:1}}],
  meta:{activeSpaCrawl:{authoringApiRateLimited:true},captureAccounting:{complete:false,unvisitedCount:10}}};
 const next=advanceAutomaticLocalCaptureV61517({startedAt:100,batches:0},data,true,false,true,200);
 assert.equal(next.state,'FINISHED');assert.equal(next.reason,'AUTHORING_API_RATE_LIMITED');
 assert.equal(next.complete,false);assert.match(next.message,/cooldown/);
});
import {compactCaptureBlobV61517} from '../src/extractors/coursera/text-and-dom.js';
import {courseraSource} from '../src/generated/extractor-sources.js';
import {createCheckpointManagerV6150,checkpointSessionIdV6150} from '../src/extractors/coursera/completion.js';
import {createLocalCaptureSessionV61514} from '../src/extractors/coursera/runtime.js';
const shell='https://www.coursera.org/teach/synthetic/Course_id_123/content/edit';
const initial={state:'RUNNING',startedAt:100,batches:0,stalled:0};
const capture=(n=20)=>({fingerprints:Array.from({length:n},(_,i)=>({id:String(i),payload:{captureAttempts:1}})),meta:{captureAccounting:{complete:false,completeCount:n}}});
test('native debugger command carries the full canonical program and exact course guard',()=>{
 const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,courseraSource,'fixture_token_123'));
 assert.equal(command.cmd,'Page.addScriptToEvaluateOnNewDocument');assert.equal(command.args.runImmediately,true);
 assert(command.args.source.includes(courseraSource.slice('javascript:'.length)));
 assert(command.args.source.includes('window!==window.top'));new vm.Script(command.args.source);
 assert.throws(()=>createAutomaticLocalCourseraCommand('https://other.test/teach/a/b/content',courseraSource,'fixture_token_123'),/coursera/i);
 assert.throws(()=>createAutomaticLocalCourseraCommand(shell,courseraSource,'bad'),/identifier/);
});
test('automatic continuation requires durable evidence and stops repeated stalled batches',()=>{
 let plan=advanceAutomaticLocalCaptureV61517(initial,capture(),true,false,true,200);
 assert.equal(plan.state,'RUNNING');
 for(let i=0;i<3;i++)plan=advanceAutomaticLocalCaptureV61517(plan,capture(),true,false,true,300+i);
 assert.equal(plan.state,'FINISHED');assert.equal(plan.reason,'LOCAL_CAPTURE_NO_PROGRESS');assert.equal(plan.complete,false);
 for(const [available,failed] of [[false,false],[true,true]]){
  const next=advanceAutomaticLocalCaptureV61517(initial,capture(),available,failed,true,200);
  assert.equal(next.state,'FINISHED');assert.equal(next.reason,'LOCAL_CHECKPOINT_UNAVAILABLE');
 }
});
test('fresh navigation contracts stop a completed retry without trusting its stale stored contract',()=>{
 const fp={id:'repaired',payload:{captureContract:{complete:false,needsEditor:true,retryable:true}}};
 const result={fingerprints:[fp],meta:{captureAccounting:{completeCount:1,unvisitedCount:0,retryableUnresolvedCount:0},activeSpaCrawl:{timeBudgetExhausted:false}}};
 assert.equal(automaticLocalCaptureNeedsContinuationV61519(result),true);
 assert.equal(automaticLocalCaptureNeedsContinuationV61519(result,()=>({complete:true,needsEditor:false,retryable:false})),false);
 assert.equal(automaticLocalCaptureNeedsContinuationV61519(result,()=>({complete:false,needsEditor:true,retryable:true})),true);
 assert.equal(fp.payload.captureContract.complete,false,'Navigation decisions do not rewrite raw evidence or contracts');
});
test('final inventory and run limits preserve incomplete verdicts',()=>{
 const final=advanceAutomaticLocalCaptureV61517(initial,capture(),true,false,false,200);
 assert.equal(final.reason,'INVENTORY_FINISHED');assert.equal(final.complete,false);
 for(const [plan,time] of [[{...initial,batches:499},200],[initial,8*60*60*1000+101]]){
  const next=advanceAutomaticLocalCaptureV61517(plan,capture(),true,false,true,time);
  assert.equal(next.reason,'LOCAL_CAPTURE_RUN_LIMIT');assert.equal(next.complete,false);
 }
});
test('a fully visited inventory continues pending retries and then stops at explicit terminal gaps',()=>{
 const result={fingerprints:Array.from({length:188},(_,i)=>({id:String(i),payload:{captureAttempts:1,
  captureContract:{complete:i<155,needsEditor:i>=183,retryable:i>=183}}})),
  meta:{captureAccounting:{inventoryCount:188,complete:false,completeCount:155,unresolvedCount:33,
   unvisitedCount:0,retryableUnresolvedCount:5},activeSpaCrawl:{timeBudgetExhausted:false}}};
 assert.equal(automaticLocalCaptureNeedsContinuationV61519(result),true);
 const continued=advanceAutomaticLocalCaptureV61517(initial,result,true,false,false,200);
 assert.equal(continued.state,'RUNNING');assert.equal(continued.complete,false);
 for(const fp of result.fingerprints.slice(183)){
  fp.payload.captureAttempts=2;fp.payload.captureContract.needsEditor=false;fp.payload.captureContract.retryable=false;
 }
 result.meta.captureAccounting.retryableUnresolvedCount=0;
 assert.equal(automaticLocalCaptureNeedsContinuationV61519(result),false);
 const final=advanceAutomaticLocalCaptureV61517(continued,result,true,false,false,300);
 assert.equal(final.reason,'INVENTORY_FINISHED');assert.equal(final.complete,false);
});
test('pending retry continuation keeps checkpoint and no-progress limits effective',()=>{
 const result=capture(1);result.fingerprints[0].payload.captureContract={needsEditor:true,retryable:true};
 assert.equal(automaticLocalCaptureNeedsContinuationV61519(result),true,'Item contracts also prevent early finalization');
 assert.equal(advanceAutomaticLocalCaptureV61517(initial,result,false,false,false,200).reason,'LOCAL_CHECKPOINT_UNAVAILABLE');
 let plan=initial;
 for(let i=0;i<4;i++)plan=advanceAutomaticLocalCaptureV61517(plan,result,true,false,false,200+i);
 assert.equal(plan.reason,'LOCAL_CAPTURE_NO_PROGRESS');
});
test('compact item serialization preserves the complete raw JSON, including Unicode and models',async()=>{
 const data={schemaVersion:35,page:{title:'日本語 café'},meta:{captureAccounting:{complete:false},array:[null,false,0]},
  fingerprints:Array.from({length:70},(_,i)=>({id:String(i),payload:{rawAssessmentModel:{questions:[{prompt:'x'.repeat(40000),key:false}]},text:'line\nquote"'}})),omitted:undefined};
 const blob=compactCaptureBlobV61517(data);
 assert.deepEqual(JSON.parse(await blob.text()),JSON.parse(JSON.stringify(data)));
 assert(blob.size>2800000);
 const circular={};circular.self=circular;assert.throws(()=>compactCaptureBlobV61517(circular),/circular/i);
});
test('automatic saved-file seed is guarded after a verified first import',()=>{
 const saved={schemaVersion:35,extractedAt:'2026-10-11T00:00:00Z',page:{courseId:'Course_id_123'},fingerprints:[{id:'one',payload:{captureAttempts:1}}]};
 const source=JSON.parse(createAutomaticLocalCourseraCommand(shell,courseraSource,'fixture_token_123',saved)).args.source;
 assert(source.includes('?.seeded'));assert(source.includes('__CTI_LOCAL_CAPTURE_RESUME__=JSON.parse('));new vm.Script(source);
 assert.throws(()=>createAutomaticLocalCourseraCommand(shell,courseraSource,'fixture_token_123',{...saved,page:{courseId:'Other_course_123'}}),/course/i);
});
test('fresh full-course commands use an isolated run and cannot import an old JSON',()=>{
 const source=JSON.parse(createAutomaticLocalCourseraCommand(shell,courseraSource,'fresh_fixture_token_123',undefined,{freshRun:true})).args.source;
 assert(source.includes('"freshRun":true'));new vm.Script(source);
 const saved={schemaVersion:35,page:{courseId:'Course_id_123'},fingerprints:[]};
 assert.throws(()=>createAutomaticLocalCourseraCommand(shell,courseraSource,'fresh_fixture_token_123',saved,{freshRun:true}),/cannot import/);
});
test('a failed fresh namespace write stops instead of restoring earlier checkpoints',async()=>{
 const previous=globalThis.localStorage;
 let opened=false;
 const oldIndexedDB=globalThis.indexedDB;
 globalThis.localStorage={getItem:()=>JSON.stringify({id:'older-run',createdAt:Date.now()}),setItem:()=>{throw Error('Storage is full')}};
 globalThis.indexedDB={open:()=>{opened=true;throw Error('Must not open an older namespace')}};
 try{
  const manager=await createCheckpointManagerV6150('Course_id_123','fresh-fixture_token_123');
  assert.equal(manager.available,false);assert.match(manager.error,/Fresh capture checkpoint session/);assert.equal(opened,false);
  assert.equal((await manager.restore([])).restored,0);
 }finally{
  if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;
  if(oldIndexedDB===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=oldIndexedDB;
 }
});
test('growing question checkpoints keep progress-only documents running beyond the stall limit',()=>{
 let plan=initial;
 for(let n=25;n<=600;n+=25){
  const data=capture(1);data.fingerprints[0].payload={captureAttempts:0,checkpointRestored:true,
   assessmentCaptureInProgress:{assessment:{questions:Array.from({length:n},(_,i)=>({id:String(i+1),courseraQuestionId:'assessment~group'+i,questionOrdinalObserved:true}))}},captureContract:{needsEditor:true}};
  plan=advanceAutomaticLocalCaptureV61517(plan,data,true,false,true,200+n);
  assert.equal(plan.state,'RUNNING');assert.equal(plan.stalled,0);
 }
});
test('saved-progress commands evaluate once and preserve expired session pointers',()=>{
 const command=JSON.parse(createSavedCourseraCheckpointExportCommand(shell,courseraSource));
 assert.equal(command.cmd,'Runtime.evaluate');assert.equal(command.args.awaitPromise,true);
 new vm.Script(command.args.expression);assert(command.args.expression.includes('__CTI_LOCAL_CHECKPOINT_EXPORT__='));
 const previous=globalThis.localStorage;
 const saved=JSON.stringify({id:'older-run',createdAt:Date.now()-14*60*60*1000});let writes=0;
 globalThis.localStorage={getItem:()=>saved,setItem:()=>writes++,removeItem:()=>writes++};
 try{assert.equal(checkpointSessionIdV6150('Course_id_123','',true).id,'older-run');assert.equal(writes,0)}
 finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
 assert.throws(()=>createSavedCourseraCheckpointExportCommand('https://other.test/',courseraSource),/Coursera/i);
});
test('question boundaries include count, elapsed time, heap growth and checkpoint failure',()=>{
 const previous=globalThis.window;
 try{
  let heap=100*1024*1024;
  globalThis.window={performance:{memory:{get usedJSHeapSize(){return heap}}}};
  let session=createLocalCaptureSessionV61514();session.startItem();
  assert.equal(session.afterQuestionCheckpoint(24,false),'');
  assert.equal(session.afterQuestionCheckpoint(1,false),'LOCAL_RENDERER_QUESTION_LIMIT');
  globalThis.window={performance:{memory:{get usedJSHeapSize(){return heap}}}};
  session=createLocalCaptureSessionV61514();session.startItem();heap+=70*1024*1024;
  assert.equal(session.afterQuestionCheckpoint(1,false),'LOCAL_RENDERER_HEAP_GROWTH_LIMIT');
  globalThis.window={__CTI_LOCAL_CAPTURE_RENDERER_SESSION__:{visits:1,startedAt:Date.now()-121000},performance:{}};
  session=createLocalCaptureSessionV61514();assert.equal(session.afterQuestionCheckpoint(1,false),'LOCAL_RENDERER_QUESTION_TIME_LIMIT');
  globalThis.window={performance:{}};session=createLocalCaptureSessionV61514();session.startItem();session.checkpointWritten(false);
  assert.equal(session.afterQuestionCheckpoint(1,false),'LOCAL_CHECKPOINT_UNAVAILABLE');
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous}
});


test('retry counters and rediscovered prefixes cannot keep a stalled quiz running',()=>{
 let plan=initial;
 const sample=(count,attempts)=>({fingerprints:[{id:'quiz',payload:{captureAttempts:attempts,checkpointRestored:attempts%2===0,
  assessmentCaptureInProgress:{assessment:{questions:Array.from({length:count},(_,i)=>({id:String(i+1),courseraQuestionId:'assignment~group'+i,questionOrdinalObserved:true}))}},captureContract:{needsEditor:true,retryable:true}}}],
  meta:{captureAccounting:{completeCount:0,unvisitedCount:166}}});
 plan=advanceAutomaticLocalCaptureV61517(plan,sample(18,1),true,false,true,200);
 assert.equal(plan.stalled,0);
 for(const [index,count] of [12,18,12].entries()){
  plan=advanceAutomaticLocalCaptureV61517(plan,sample(count,index+2),true,false,true,300+index);
  assert.equal(plan.stalled,index+1);
 }
 assert.equal(plan.state,'FINISHED');assert.equal(plan.reason,'LOCAL_CAPTURE_NO_PROGRESS');assert.equal(plan.complete,false);
 assert.equal(plan.evidenceProgress.items[0][1],18,'Preserve the durable question high-water mark');
});

test('saved question ordinals and IDs, rather than transient parser counts, establish progress',()=>{
 const result=capture(1);result.meta.captureAccounting.completeCount=0;result.fingerprints[0].payload={captureAttempts:1,assessmentCaptureInProgress:{assessment:{questionCount:100,questions:[{id:'1'}]}}};
 let plan=advanceAutomaticLocalCaptureV61517(initial,result,true,false,true,200);
 assert.equal(plan.stalled,1);
 result.fingerprints[0].payload.assessmentCaptureInProgress.assessment.questions=[{id:'1',courseraQuestionId:'assignment~group1',questionOrdinalObserved:true}];
 plan=advanceAutomaticLocalCaptureV61517(plan,result,true,false,true,300);assert.equal(plan.stalled,0);
 const stable=advanceAutomaticLocalCaptureV61517(plan,result,true,false,true,400);assert.equal(stable.stalled,1);
});

test('terminal run reentry reports the saved reason before starting acquisition',async()=>{
 for(const state of ['FINISHED','REJECTED']){
  const messages=[],window={opener:{postMessage:(message,origin)=>messages.push({message,origin})}};
  window.top=window;
  const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,courseraSource,'terminal_fixture_token_123',undefined,{controllerOrigin:'https://cti-hardening.pages.dev'}));
  vm.runInNewContext(command.args.source,{window,URL,location:new URL(shell),console,document:{visibilityState:'visible'},
   localStorage:{getItem:key=>key==='__CTI_AUTOMATIC_LOCAL_V61517_terminal_fixture_token_123'?JSON.stringify({state,reason:'LOCAL_CAPTURE_NO_PROGRESS'}):null},
   fetch:()=>{throw Error('Terminal state must not start acquisition')}});
  await Promise.resolve();
  assert.equal(messages.length,1);assert.equal(messages[0].message.event,'ERROR');
  assert.match(messages[0].message.message,/LOCAL_CAPTURE_NO_PROGRESS/);
  assert.match(messages[0].message.message,/checkpoints remain available/);
 }
});
