import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {functionCode}=require('../tools/assessment-fixture.cjs');

function recorderFor(response,limit=1024){
  const nativeFetch=async()=>response;
  const context={window:{fetch:nativeFetch},location:{origin:'https://example.test'},
    URL,URLSearchParams,FormData,TextDecoder,Promise,
    setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,60)),clearTimeout,
    MAX_CAPTURED_RESPONSE_CHARS:limit,isPerItemNetworkNoise:()=>false,
    isCourseWideNetworkResponse:()=>false,isSessionScopedPayloadEndpoint:()=>true};
  vm.createContext(context);vm.runInContext(functionCode('installReadOnlyNetworkRecorder'),context);
  return {context,recorder:context.installReadOnlyNetworkRecorder(),nativeFetch};
}
async function until(predicate){
  const deadline=Date.now()+1000;
  while(!predicate()){assert(Date.now()<deadline,'Recorder did not settle');await new Promise(r=>setTimeout(r,2));}
}
test('Response capture preserves Unicode bytes and the original response',async()=>{
  const raw=JSON.stringify({answer:'café 日本語 2½',feedback:'An observed field.'});
  const f=recorderFor(new Response(raw,{headers:{'content-type':'application/json'}}));
  f.recorder.setActive({id:'item'});
  const response=await f.context.window.fetch('https://example.test/api/item');
  assert.equal(await response.text(),raw);
  await until(()=>f.recorder.takeFor({id:'item'}).length===1);
  assert.equal(f.recorder.takeFor({id:'item'})[0].text,raw);
  f.recorder.restore();assert.equal(f.context.window.fetch,f.nativeFetch);
});
test('An unknown-length oversized copy is cancelled without truncating Coursera response',async()=>{
  const raw=JSON.stringify({content:'x'.repeat(500)});
  const f=recorderFor(new Response(raw,{headers:{'content-type':'application/json'}}),64);
  f.recorder.setActive({id:'item'});
  const response=await f.context.window.fetch('https://example.test/api/item');
  assert.equal(await response.text(),raw);
  await until(()=>f.recorder.stats().responseCopyLimits.oversize===1);
  assert.equal(f.recorder.takeFor({id:'item'}).length,0);
  assert.equal(f.recorder.stats().activeResponseCopies,0);f.recorder.restore();
});
test('Leaving an item cancels its pending copy without aborting the site request',async()=>{
  let controller;const response=new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'content-type':'application/json'}});
  const f=recorderFor(response);f.recorder.setActive({id:'old'});
  const original=await f.context.window.fetch('https://example.test/api/old');
  f.recorder.releaseFor({id:'old'});f.recorder.setActive({id:'new'});
  assert.equal(f.recorder.stats().activeResponseCopies,0);
  controller.enqueue(new TextEncoder().encode('{"answer":"still delivered"}'));controller.close();
  assert.equal(await original.text(),'{"answer":"still delivered"}');
  await until(()=>f.recorder.stats().responseCopyLimits.released===1);
  assert.equal(f.recorder.takeFor({id:'new'}).length,0);f.recorder.restore();
});
test('A stalled response copy times out and leaves the original readable',async()=>{
  let controller;const response=new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'content-type':'application/json'}});
  const f=recorderFor(response);f.recorder.setActive({id:'item'});
  const original=await f.context.window.fetch('https://example.test/api/item');
  await until(()=>f.recorder.stats().responseCopyLimits.timedOut===1);
  assert.equal(f.recorder.stats().activeResponseCopies,0);
  controller.enqueue(new TextEncoder().encode('{}'));controller.close();
  assert.equal(await original.text(),'{}');assert.equal(f.recorder.takeFor({id:'item'}).length,0);f.recorder.restore();
});
function routes(){
  const location={href:'https://example.test/teach/course/content/edit'};
  const counts={replace:0,push:0,events:0};
  const context={URL,location,history:{state:{},replaceState(s,t,url){counts.replace++;location.href=url;},pushState(){counts.push++;}},
    window:{dispatchEvent(){counts.events++;}},PopStateEvent:class {constructor(type,props){this.type=type;Object.assign(this,props);}}};
  vm.createContext(context);vm.runInContext(functionCode('safelyRouteWithHistory')+functionCode('safelyRestoreRoute'),context);
  return {context,counts};
}
test('Repeated outline restores dispatch no duplicate route events',()=>{
  const {context:c,counts}=routes();assert(c.safelyRestoreRoute(c.location.href));assert(c.safelyRestoreRoute(c.location.href));
  assert.deepEqual(counts,{replace:0,push:0,events:0});
  assert(c.safelyRouteWithHistory('/teach/course/content/item/one'));assert(c.safelyRouteWithHistory(c.location.href));
  assert.deepEqual(counts,{replace:1,push:0,events:1});
});
test('An asynchronous Close navigation finishes before history fallback',async()=>{
  const {context:c,counts}=routes(),outline=c.location.href;c.location.href='https://example.test/editor';
  c.dismissEditorSurfaceSafely=()=>true;c.sleepMs=async()=>{c.location.href=outline;};
  vm.runInContext(functionCode('returnToOutlineV6142'),c);
  assert(await c.returnToOutlineV6142(outline));assert.deepEqual(counts,{replace:0,push:0,events:0});
});
test('History fallback still runs once when Close does not navigate',async()=>{
  const {context:c,counts}=routes(),outline=c.location.href;c.location.href='https://example.test/editor';
  c.dismissEditorSurfaceSafely=()=>false;c.sleepMs=async()=>{};
  vm.runInContext(functionCode('returnToOutlineV6142'),c);
  assert(await c.returnToOutlineV6142(outline));assert.deepEqual(counts,{replace:1,push:0,events:1});
});
