import test from 'node:test';
import assert from 'node:assert/strict';
import {installReadOnlyNetworkRecorder} from '../src/extractors/coursera/evidence-2.js';

test('assessment GET receipts are item-scoped, bounded, credential-free and never clone response bodies',async()=>{
 const previousWindow=globalThis.window,previousLocation=globalThis.location;
 let clones=0,calls=0;
 const native=async url=>{calls++;return {url,status:200,headers:{get:()=> 'application/json'},clone(){clones++;throw Error('No clone allowed');}};};
 globalThis.window={fetch:native};globalThis.location=new URL('https://www.coursera.org/teach/synthetic/Metadata_fixture_123/content/edit');
 const fp={id:'course-item',payload:{}},recorder=installReadOnlyNetworkRecorder();
 const group='/api/authoringAssignmentQuestionGroups.v1/assignment~group';
 const definition='/api/authoringAssignmentMachineEvaluableQuestions.v1/assignment~question';
 try {
  recorder.setActive(fp);
  for(let i=0;i<70;i++)await window.fetch(group+i+'?access_token=SYNTHETIC_QUERY_SECRET#fragment');
  for(let i=0;i<70;i++)await window.fetch(definition+i+'@1?writeAccessToken=SYNTHETIC_QUERY_SECRET');
  await window.fetch(group+'post',{method:'POST'});
  await window.fetch('https://other.invalid'+group+'other');
  const receipts=recorder.observedAssessmentGetsFor(fp);
  assert.equal(receipts.length,64);assert.equal(new Set(receipts.map(r=>r.resource)).size,2);
  assert(receipts.every(r=>r.method==='GET'&&r.itemId===fp.id&&!r.url.includes('?')&&!r.url.includes('#')));
  assert(!JSON.stringify(receipts).includes('SYNTHETIC_QUERY_SECRET'));
  assert.equal(recorder.takeFor(fp).length,0);assert.equal(clones,0);assert.equal(fp.payload.networkCaptureGap,undefined);
  assert.deepEqual(recorder.observedAssessmentGetsFor({id:'another-item'}),[]);
  recorder.setActive(fp);assert.deepEqual(recorder.observedAssessmentGetsFor(fp),[],'A new activation cannot reuse earlier request history');
  await window.fetch(group+'current');assert.equal(recorder.observedAssessmentGetsFor(fp).length,1);
  recorder.releaseFor(fp);assert.equal(recorder.stats().assessmentGetReceipts,0);
  assert.deepEqual(recorder.observedAssessmentGetsFor(fp),[]);assert.equal(calls,143);
 } finally {
  recorder.restore();assert.equal(window.fetch,native);
  if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
  if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;
 }
});
