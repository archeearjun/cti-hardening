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
  assert(r.captured);assert(f.now()>=10000 && f.now()<13000);
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
