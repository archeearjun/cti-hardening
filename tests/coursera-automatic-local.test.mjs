import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {automaticLocalCaptureNeedsContinuationV61519,advanceAutomaticLocalCaptureV61517} from '../src/extractors/coursera/automatic-local.js';
import {compactCaptureBlobV61517} from '../src/extractors/coursera/text-and-dom.js';
import {courseraSource} from '../src/generated/extractor-sources.js';
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
