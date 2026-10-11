import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CTI_NETWORK_MAX_RETAINED_CHARS, CTI_NETWORK_MAX_RETAINED_RECORDS, CTI_NETWORK_MAX_PENDING_REQUESTS, CTI_NETWORK_MAX_RESPONSE_COPIES } from '../src/extractors/coursera/config.js';
import { captureContractV6150, finalCaptureAccountingV6150 } from '../src/extractors/coursera/completion.js';
import { CTI_LOCAL_BATCH_MAX_VISITS, CTI_LOCAL_BATCH_MAX_MS, CTI_LOCAL_ASSESSMENT_MAX_QUESTIONS, CTI_LOCAL_ASSESSMENT_MAX_MS, CTI_LOCAL_HEAP_YIELD_BYTES, CTI_LOCAL_HEAP_GROWTH_BYTES } from '../src/extractors/coursera/config.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {functionCode}=require('../tools/assessment-fixture.cjs');

function localSessionFixture(heap=0){
  let now=1000;
  const context={window:{performance:{memory:{usedJSHeapSize:heap}}},Date:{now:()=>now},
    CTI_LOCAL_BATCH_MAX_VISITS,CTI_LOCAL_BATCH_MAX_MS,CTI_LOCAL_ASSESSMENT_MAX_QUESTIONS,CTI_LOCAL_ASSESSMENT_MAX_MS,CTI_LOCAL_HEAP_YIELD_BYTES,CTI_LOCAL_HEAP_GROWTH_BYTES};
  vm.createContext(context);vm.runInContext(functionCode('createLocalCaptureSessionV61514'),context);
  return {context,session:context.createLocalCaptureSessionV61514(),advance:ms=>{now+=ms;}};
}
test('Local primary, retry and repeat invocations share a renderer visit budget',()=>{
  const f=localSessionFixture();
  for(let i=0;i<CTI_LOCAL_BATCH_MAX_VISITS-2;i++){
    assert.equal(f.session.beforeItem(),'');f.session.startItem();f.session.checkpointWritten(true);
  }
  const retry=f.context.createLocalCaptureSessionV61514();
  for(let i=0;i<2;i++){assert.equal(retry.beforeItem(),'');retry.startItem();retry.checkpointWritten(true);}
  assert.equal(retry.beforeItem(),'LOCAL_RENDERER_VISIT_LIMIT');
  assert.equal(f.context.createLocalCaptureSessionV61514().beforeItem(),'LOCAL_RENDERER_VISIT_LIMIT');
  assert.equal(f.session.snapshot().visits,CTI_LOCAL_BATCH_MAX_VISITS);
  assert.equal(localSessionFixture().session.beforeItem(),'','A fresh document can resume');
});
test('Local time and heap yields happen at the next item boundary',()=>{
  const timed=localSessionFixture();timed.session.startItem();
  timed.advance(CTI_LOCAL_BATCH_MAX_MS+1);timed.session.checkpointWritten(true);
  assert.equal(timed.session.beforeItem(),'LOCAL_RENDERER_TIME_LIMIT');
  const memory=localSessionFixture();memory.session.startItem();memory.session.checkpointWritten(true);
  memory.context.window.performance.memory.usedJSHeapSize=CTI_LOCAL_HEAP_YIELD_BYTES;
  assert.equal(memory.session.beforeItem(),'LOCAL_RENDERER_HEAP_LIMIT');
  assert.equal(memory.session.snapshot().visits,1);
});
test('High initial heap still allows one item; unavailable memory readings use visit limits',()=>{
  const f=localSessionFixture(CTI_LOCAL_HEAP_YIELD_BYTES+1);
  assert.equal(f.session.beforeItem(),'');f.session.startItem();f.session.checkpointWritten(true);
  assert.equal(f.session.beforeItem(),'LOCAL_RENDERER_HEAP_LIMIT');
  const unavailable=localSessionFixture();delete unavailable.context.window.performance.memory;
  assert.equal(unavailable.session.beforeItem(),'');unavailable.session.startItem();
  assert.equal(unavailable.session.beforeItem(),'');assert.equal(unavailable.session.snapshot().observedHeapBytes,0);
});
test('Failed checkpoint writes stop new visits and cannot be reset by repasting',()=>{
  const f=localSessionFixture();f.session.startItem();f.session.checkpointWritten(false);
  assert.equal(f.session.beforeItem(),'LOCAL_CHECKPOINT_UNAVAILABLE');
  f.session.checkpointWritten(true);
  assert.equal(f.context.createLocalCaptureSessionV61514().beforeItem(),'LOCAL_CHECKPOINT_UNAVAILABLE');
  assert.equal(f.session.snapshot().checkpointFailed,true);assert.equal(f.session.snapshot().visits,1);
});
test('A large restored course baseline can progress until bounded heap growth',()=>{
  const baseline=280*1024*1024,f=localSessionFixture(baseline);
  f.session.startItem();f.session.checkpointWritten(true);
  f.context.window.performance.memory.usedJSHeapSize=baseline+10*1024*1024;
  assert.equal(f.session.beforeItem(),'','A baseline above the former 256 MiB guard is not new renderer growth');
  const resumed=f.context.createLocalCaptureSessionV61514();resumed.startItem();resumed.checkpointWritten(true);
  f.context.window.performance.memory.usedJSHeapSize=baseline+CTI_LOCAL_HEAP_GROWTH_BYTES;
  assert.equal(resumed.beforeItem(),'LOCAL_RENDERER_HEAP_GROWTH_LIMIT');
  assert.equal(resumed.snapshot().baselineHeapBytes,baseline,'Repasting must not reset the baseline');
  assert.equal(resumed.snapshot().heapGrowthLimitBytes,CTI_LOCAL_HEAP_GROWTH_BYTES);
});

function recorderFor(response,limit=1024,overrides={}){
  const nativeFetch=typeof response==='function'?response:async()=>response;
  const context={window:{fetch:nativeFetch},location:{origin:'https://example.test'},
    URL,URLSearchParams,FormData,TextDecoder,Promise,
    setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,60)),clearTimeout,
    MAX_CAPTURED_RESPONSE_CHARS:limit,isPerItemNetworkNoise:()=>false,
    isCourseWideNetworkResponse:()=>false,isSessionScopedPayloadEndpoint:()=>true,
    CTI_NETWORK_MAX_RETAINED_CHARS, CTI_NETWORK_MAX_RETAINED_RECORDS,
    CTI_NETWORK_MAX_PENDING_REQUESTS, CTI_NETWORK_MAX_RESPONSE_COPIES,...overrides};
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

test('Cumulative response retention stops before exhausting the shared character budget',async()=>{
  const raw=JSON.stringify({content:'x'.repeat(400)});
  const f=recorderFor(async()=>new Response(raw,{headers:{'content-type':'application/json'}}),1024,{CTI_NETWORK_MAX_RETAINED_CHARS:1700});
  const fp={id:'item'};f.recorder.setActive(fp);
  try{
    for(let i=0;i<20;i++){
      assert.equal(await (await f.context.window.fetch('https://example.test/api/item')).text(),raw);
      await until(()=>f.recorder.stats().pendingRequests===0);
      const s=f.recorder.stats();assert(s.retainedChars+s.reservedChars<=1700);
    }
    assert.equal(f.recorder.stats().retainedRecords,2);
    assert.equal(f.recorder.stats().resourceLimits.retainedCharacters,18);
    assert.equal(fp.payload.networkCaptureGap.skippedResponses,18);
    assert(fp.payload.networkCaptureGap.reasons.includes('retainedCharacters'));
    f.recorder.releaseFor(fp);assert.equal(f.recorder.stats().retainedChars,0);
    f.recorder.setActive({id:'next'});
    assert.equal(await (await f.context.window.fetch('https://example.test/api/next')).text(),raw);
    await until(()=>f.recorder.stats().retainedRecords===1);
  }finally{f.recorder.restore();}
});

test('The recorder enforces the record-count ceiling during acquisition',async()=>{
  const f=recorderFor(async()=>new Response('{}',{headers:{'content-type':'application/json'}}),1024,{CTI_NETWORK_MAX_RETAINED_RECORDS:3});
  const fp={id:'item'};f.recorder.setActive(fp);
  try{
    for(let i=0;i<10;i++){
      assert.equal(await (await f.context.window.fetch('https://example.test/api/item')).text(),'{}');
      await until(()=>f.recorder.stats().pendingRequests===0);
    }
    assert.equal(f.recorder.takeFor(fp).length,3);
    assert.equal(f.recorder.stats().resourceLimits.retainedRecords,7);
  }finally{f.recorder.restore();}
});

test('Concurrent copies reserve aggregate space and releasing an item frees every reservation',async()=>{
  const controllers=[];
  const f=recorderFor(async()=>new Response(new ReadableStream({start(c){controllers.push(c);}}),{headers:{'content-type':'application/json'}}),1024,{CTI_NETWORK_MAX_RETAINED_CHARS:2048,CTI_NETWORK_MAX_RESPONSE_COPIES:8});
  const fp={id:'item'};f.recorder.setActive(fp);
  const originals=await Promise.all(Array.from({length:8},()=>f.context.window.fetch('https://example.test/api/item')));
  try{
    const s=f.recorder.stats();assert.equal(s.activeResponseCopies,2);assert.equal(s.reservedChars,2048);
    assert.equal(s.resourceLimits.retainedCharacters,6);
    f.recorder.releaseFor(fp);
    assert.equal(f.recorder.stats().reservedChars,0);assert.equal(f.recorder.stats().reservedRecords,0);
    assert.equal(f.recorder.stats().activeCopies,0);assert.equal(f.recorder.stats().pendingRequests,0);
    for(const c of controllers){c.enqueue(new TextEncoder().encode('{}'));c.close();}
    assert.deepEqual(await Promise.all(originals.map(r=>r.text())),Array(8).fill('{}'));
  }finally{f.recorder.restore();}
});

test('Response-copy concurrency has its own ceiling without aborting original responses',async()=>{
  const controllers=[];
  const f=recorderFor(async()=>new Response(new ReadableStream({start(c){controllers.push(c);}}),{headers:{'content-type':'application/json'}}),1024,{CTI_NETWORK_MAX_RESPONSE_COPIES:1});
  const fp={id:'item'};f.recorder.setActive(fp);
  const originals=await Promise.all(Array.from({length:4},()=>f.context.window.fetch('https://example.test/api/item')));
  try{
    assert.equal(f.recorder.stats().activeResponseCopies,1);assert.equal(f.recorder.stats().resourceLimits.responseCopies,3);
    for(const c of controllers){c.enqueue(new TextEncoder().encode('{}'));c.close();}
    assert.deepEqual(await Promise.all(originals.map(r=>r.text())),Array(4).fill('{}'));
    await until(()=>f.recorder.stats().reservedChars===0);
  }finally{f.recorder.restore();}
});

test('Pending request limits preserve fetch behavior and expose missed capture',async()=>{
  const complete=[];
  const f=recorderFor(()=>new Promise(resolve=>complete.push(resolve)),1024,{CTI_NETWORK_MAX_PENDING_REQUESTS:2});
  const fp={id:'item'};f.recorder.setActive(fp);
  const requests=Array.from({length:3},()=>f.context.window.fetch('https://example.test/api/item'));
  try{
    assert.equal(f.recorder.stats().pendingRequests,2);
    assert.equal(f.recorder.stats().resourceLimits.pendingRequests,1);
    assert(fp.payload.networkCaptureGap.reasons.includes('pendingRequests'));
    for(const resolve of complete)resolve(new Response('{}',{headers:{'content-type':'application/json'}}));
    assert.deepEqual(await Promise.all((await Promise.all(requests)).map(r=>r.text())),Array(3).fill('{}'));
    await until(()=>f.recorder.stats().pendingRequests===0);
    assert.equal(f.recorder.stats().retainedRecords,2);
  }finally{f.recorder.restore();}
});

test('Ineligible GET and POST requests are not cloned or attached to the active item',async()=>{
  let clones=0;
  const f=recorderFor(async()=>{
    const response=new Response('{}',{headers:{'content-type':'application/json'}}),clone=response.clone.bind(response);
    response.clone=()=>{clones++;return clone();};return response;
  },1024,{isSessionScopedPayloadEndpoint:()=>false});
  const fp={id:'item'};f.recorder.setActive(fp);
  try{
    for(const [url,method] of [['https://example.test/api/unrelated','GET'],['https://example.test/api/item','POST']]){
      assert.equal(await (await f.context.window.fetch(url,{method})).text(),'{}');
    }
    assert.equal(clones,0);assert.equal(f.recorder.takeFor(fp).length,0);assert.equal(fp.payload,undefined);
    assert.equal(await (await f.context.window.fetch('https://example.test/api/item')).text(),'{}');
    await until(()=>f.recorder.stats().retainedRecords===1);assert.equal(clones,1);
  }finally{f.recorder.restore();}
});

test('A network resource gap cannot certify otherwise complete reading evidence',()=>{
  const fp={id:'item',type:'Reading',typeName:'supplement',payload:{captureAttempts:1,
    textCaptureEvidence:{method:'EXACT_READING_FIELD',itemId:'item',observedCharacters:10,capturedCharacters:10}}};
  assert.equal(captureContractV6150(fp).complete,true);
  fp.payload.networkCaptureGap={status:'NETWORK_CAPTURE_LIMIT_REACHED',skippedResponses:1,reasons:['retainedCharacters']};
  const retry=captureContractV6150(fp);assert.equal(retry.complete,false);assert.equal(retry.retryable,true);
  assert(retry.reasons.includes('NETWORK_CAPTURE_LIMIT_REACHED'));
  fp.payload.captureAttempts=2;assert.equal(captureContractV6150(fp).retryable,false);
  const accounting=finalCaptureAccountingV6150([fp],{});assert.equal(accounting.complete,false);assert.equal(accounting.technicalUnresolvedCount,1);
});

test('JSON serialization failure preserves checkpoints; successful export clears them afterward',async()=>{
  const events=[];
  const c={downloadJson:()=>{events.push('export');throw Error('serialization failed');}};
  vm.createContext(c);vm.runInContext(functionCode('exportCaptureWithCheckpoints'),c);
  const manager={clear:async()=>events.push('clear')};
  await assert.rejects(c.exportCaptureWithCheckpoints('capture.json',{},manager,false),/serialization failed/);
  assert.deepEqual(events,['export']);
  c.downloadJson=()=>events.push('prepared');
  await c.exportCaptureWithCheckpoints('capture.json',{},manager,false);
  assert.deepEqual(events,['export','prepared','clear']);
  await c.exportCaptureWithCheckpoints('partial.json',{},manager,true);
  assert.deepEqual(events,['export','prepared','clear','prepared']);
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

function pluginWaitFixture({readyAt=8000, blocked=false, deadline=60000, routeChangeAt=Infinity, stopAt=Infinity}={}) {
  let now=0;
  const route='https://example.test/teach/course/branch/content/item/plugin/item';
  const fp={id:'item',type:'Plugin',typeName:'ungradedWidget'};
  const root={innerText:'Choose Plugin External Webpage',querySelectorAll:()=>[
    {getAttribute:key=>key==='src'?'https://external.test/resource':''}
  ]};
  const surface={root,heading:'Plugin title',fields:[],identity:'EXACT_ITEM_ID_AND_TYPED_ROUTE',itemIdObserved:true};
  const probe=()=>({targets:now>=readyAt?[{url:'https://external.test/final-target',method:'VISIBLE_CONFIGURATION_JSON'}]:[{url:'https://external.test/resource',method:'FRAME_SRC'}],
    frames:[{src:'https://external.test/resource',access:blocked?'CROSS_ORIGIN_UNREADABLE':'READABLE',readyState:now>=readyAt?'complete':'loading',
      surfaceStatus:blocked?'NOT_OBSERVED':now>=readyAt?'CONTENT_OBSERVED':'LOADING',textLength:now>=readyAt?300:0,textPreview:now>=readyAt?'Loaded content':'Loading...'}]});
  const c={Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},
    Set,Math,Number,String,JSON,CTI_PLUGIN_PRIMARY_MAX_MS:45000,CTI_PLUGIN_RETRY_MAX_MS:60000,location:{href:route},
    typedEditorRouteTypeV61316:()=> 'plugin',typedEditorRouteV61316:()=>route,
    typedEditorNameFieldsV61317:()=>[],safelyRestoreRoute:()=>true,
    authoringItemRouteV61311:()=>({courseId:'branch',itemId:now>=routeChangeAt?'different':'item',typeName:'plugin'}),
    typedEditorProductionSurfaceV61317:()=>now>=routeChangeAt?null:surface,
    collectPluginEvidenceV6139:probe,visiblePluginConfigurationV61316:()=>({values:now>=readyAt?[{}]:[]}),
    hasVisibleLoadingIndicator:()=>false,typedEditorDiagnosticsV61316:()=>({status:'STRUCTURE_ONLY'}),
    collectDomEvidenceFromRoot:()=>({pluginEvidence:probe(),textSample:'Choose Plugin External Webpage',_diagnostics:{}}),
    sleepMs:async ms=>{now+=ms;}};
  vm.createContext(c);
  for(const f of ['scopedWaitBudgetV61321','clearTypedPluginChromeV61317','pluginReadinessV6147','recoverTypedEditorV61317'])
    vm.runInContext(functionCode(f),c);
  return {run:()=>c.recoverTypedEditorV61317(fp,'branch',{}, {deadline,shouldStop:()=>now>=stopAt}),now:()=>now};
}
test('plugin recovery waits for delayed frame/configuration content instead of accepting its URL',async()=>{
  const f=pluginWaitFixture({readyAt:8000}),r=await f.run();
  assert(r.captured);assert(f.now()>=10000);assert(f.now()<13000);
  assert.equal(r.evidence.pluginEvidence.targets[0].url,'https://external.test/final-target');
  assert.equal(r.pluginWait.status,'READABLE_FRAME_OBSERVED');
  assert.equal(r.evidence.textSample,''); // authoring chrome cannot become learner content
  assert.equal(r.evidence.typedEditorEvidence.externalInteractionVerified,false);
});
test('a late 18-second readable plugin is captured without applying the wait to every reading',async()=>{
  const f=pluginWaitFixture({readyAt:18000}),r=await f.run();
  assert(r.captured);assert(f.now()>=19200);assert.equal(r.pluginWait.status,'READABLE_FRAME_OBSERVED');
});
test('cross-origin frames retain their target and an explicit unreadable status after the grace period',async()=>{
  const f=pluginWaitFixture({blocked:true,readyAt:8000}),r=await f.run();
  assert(r.captured);assert(f.now()>=3000 && f.now()<6000);
  assert.equal(r.pluginWait.minimumSurfaceWaitMs,3000);
  assert.equal(r.pluginWait.status,'FRAME_CONTENT_UNREADABLE');
  assert.equal(r.pluginWait.interactionVerified,false);
  assert.equal(r.evidence.pluginEvidence.readiness.status,'FRAME_CONTENT_UNREADABLE');
});
test('a permanently loading plugin retains partial evidence at a bounded timeout',async()=>{
  const f=pluginWaitFixture({readyAt:Infinity}),r=await f.run();
  assert.equal(f.now(),45000);assert(r.captured);
  assert.equal(r.reason,'PLUGIN_WAIT_LIMIT_REACHED');
  assert.equal(r.pluginWait.pending,true);assert.equal(r.pluginWait.status,'FRAME_STILL_LOADING');
  assert.equal(r.evidence.pluginEvidence.targets.length,1);
});
test('plugin waiting respects course deadline, route identity and user stop',async()=>{
  const deadline=await pluginWaitFixture({readyAt:Infinity,deadline:6000}).run();
  assert.equal(deadline.dwellMs,6000);assert.equal(deadline.reason,'COURSE_TIME_BUDGET_REACHED');
  const changed=await pluginWaitFixture({routeChangeAt:2000}).run();
  assert.equal(changed.captured,false);assert.equal(changed.reason,'ROUTE_CHANGED');
  const stopped=await pluginWaitFixture({stopAt:2000}).run();
  assert.equal(stopped.captured,false);assert.equal(stopped.reason,'STOP_REQUESTED');
});

test('readable frame text is retained separately, bounded and replaced by newer evidence for the same frame',()=>{
  const {fixture,El}=require('../tools/assessment-fixture.cjs');
  const f=fixture({count:1}),root=new El('div');root.documentRoot=true;
  root.append(new El('div',{},'Choose Plugin External Webpage'));
  const frame=new El('iframe',{src:'https://example.test/plugin'}),body=new El('body',{},'Learner screen '.repeat(2500));
  frame.contentDocument={readyState:'complete',body};root.append(frame);
  Object.assign(f.c,{URL,location:{href:'https://example.test/course/item/plugin/item'},
    isAuthoringChromeUrl:()=>false,isCourseraUiAssetUrl:()=>false,reactPropsForElement:()=>null,
    visiblePluginConfigurationV61316:()=>({values:[],editorCount:0,parseFailures:0}),extractConfiguredExternalUrls:()=>[]});
  for(const name of ['collectPluginEvidenceV6139','mergePluginEvidenceV6139'])vm.runInContext(functionCode(name),f.c);
  const first=f.c.collectPluginEvidenceV6139(root,{id:'item',type:'Plugin'});
  assert.equal(first.frames[0].textSample.length,24000);assert.equal(first.frames[0].textTruncated,true);
  body.textContent='A newer visible learner screen.';
  const latest=f.c.collectPluginEvidenceV6139(root,{id:'item',type:'Plugin'});
  const merged=f.c.mergePluginEvidenceV6139(first,latest);
  assert.equal(merged.frames[0].textSample,'A newer visible learner screen.');
  assert.equal(merged.launchStatus,'NOT_VERIFIED');assert.equal(merged.playbackStatus,'NOT_OBSERVED');
  body.textContent='Loading...';
  const loading=f.c.collectPluginEvidenceV6139(root,{id:'item',type:'Plugin'});
  assert.equal(loading.frames[0].surfaceStatus,'LOADING');assert.equal(loading.frames[0].textSample,undefined);
});

test('generic plugin fallback measures its grace from surface appearance; ordinary reading waits stay short',async()=>{
  async function run(plugin) {
    let now=0;const root={isConnected:true},surface={root};
    const c={Date:{now:()=>now},Math,Number,String,Boolean,JSON,WeakMap,
      location:{pathname:'/editor',search:''},isHeavyHydrationFingerprint:()=>false,
      EVIDENCE_STABILITY_MAX_MS:8000,EVIDENCE_STABILITY_HEAVY_MAX_MS:10000,
      EVIDENCE_STABILITY_MIN_MS:1600,EVIDENCE_STABILITY_HEAVY_MIN_MS:2600,
      EVIDENCE_STABILITY_EMPTY_HEAVY_MIN_MS:4600,EVIDENCE_STABILITY_REQUIRED_SAMPLES:3,EVIDENCE_STABILITY_SAMPLE_MS:400,CTI_PLUGIN_PRIMARY_MAX_MS:45000,CTI_PLUGIN_RETRY_MAX_MS:60000,
      isVisibleElement:()=>true,findCurrentEditorSurface:()=>now>=4000?surface:null,
      quickRootEvidenceSnapshot:()=>({links:1,loading:false,signature:'stable'}),
      quickNetworkEvidenceSnapshot:()=>({links:1,signature:'stable'}),
      collectPluginEvidenceV6139:()=>({targets:[{url:'https://external.test'}],frames:[{access:'CROSS_ORIGIN_UNREADABLE'}]}),
      sleepMs:async ms=>{now+=ms;}};
    vm.createContext(c);for(const f of ['pluginReadinessV6147','waitForItemEvidenceStability'])vm.runInContext(functionCode(f),c);
    return c.waitForItemEvidenceStability({type:plugin?'Plugin':'Reading'}, {},0,null,[],{deadline:30000});
  }
  const plugin=await run(true),reading=await run(false);
  assert(plugin.dwellMs>=14000);assert.equal(plugin.timedOut,false);
  assert.equal(plugin.pluginReadiness.status,'FRAME_CONTENT_UNREADABLE');
  assert(reading.dwellMs<6000);assert.equal(reading.pluginReadiness,null);
});
