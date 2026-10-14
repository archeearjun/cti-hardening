import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as config from '../src/extractors/coursera/config.js';
import { CTI_RELEASE_REGISTRY_ } from '../src/engine/release.js';
import { courseraSource } from '../src/generated/extractor-sources.js';
import { extractorFunctions } from './extractor-functions.cjs';
import { ownerAccessFixture } from './browser-owner-fixture.mjs';
import { createSavedCourseraResumeScript } from '../src/domain/coursera-local-extraction.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const definitions=[...extractorFunctions(courseraSource).values()].join('\n');
const constants=Object.entries(config).map(([key,value])=>`const ${key}=${JSON.stringify(value)};`).join('\n');
const payload=JSON.stringify({learnerText:'x'.repeat(2399950)});
const fixture=`<!doctype html><style>
  #scroll {height:100px;overflow:auto;width:300px} #space {height:2000px}
  ::view-transition-group(root) {animation-duration:100ms}
</style><div id="scroll"><div id="space"><div id="questions"></div></div></div>`;
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(pathname==='/runtime-fixture'){
    res.setHeader('Content-Type','text/html');res.end(fixture);return;
  }
  if(pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
    if(pathname.endsWith('/large-json')){
      // No Content-Length: the XHR guard must bound serialization itself.
      res.write(JSON.stringify({learnerText:'x'.repeat(3000000)}));res.end();return;
    }
    res.end(pathname.endsWith('/small')?'{"answer":"café 日本語"}':payload);return;
  }
  try{
    const file=path.join(root,'dist',pathname==='/'?'index.html':pathname);
    res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':'text/html');
    res.end(fs.readFileSync(file));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({headless:true,
    ...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),
    args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/runtime-fixture');
  await page.addScriptTag({content:constants+'\n'+definitions});

  const scrolling=await page.evaluate(async()=>{
    const scroller=document.getElementById('scroll'),questions=document.getElementById('questions');
    const events=[],rejections=[],transitions=[];
    function render(){
      // Mount a different row after a native scroll, as a virtualized outline does.
      const ordinal=Math.floor(scroller.scrollTop/100)+1;
      questions.innerHTML=`<a href="#question-${ordinal}">Question ${ordinal}</a>`;
    }
    render();
    scroller.addEventListener('scroll',event=>{
      events.push({trusted:event.isTrusted,bubbles:event.bubbles});
      const transition=document.startViewTransition(render);
      transition.ready.catch(error=>rejections.push(error.message));
      transitions.push(transition.finished);
    });
    await setScrollRootPosition(scroller,200);
    await Promise.all(transitions);
    const mounted=questions.textContent;
    await setScrollRootPosition(scroller,200);
    const afterNoOp=events.length;
    await setScrollRootPosition(scroller,0);
    await Promise.all(transitions);
    return {events,rejections,mounted,afterNoOp,restored:questions.textContent};
  });
  assert.equal(scrolling.mounted,'Question 3');
  assert.equal(scrolling.afterNoOp,1,'A no-op must not activate another scroll handler');
  assert.equal(scrolling.events.length,2,'Each changed position must produce exactly one native event');
  assert(scrolling.events.every(event=>event.trusted && !event.bubbles));
  assert.deepEqual(scrolling.rejections,[]);
  assert.equal(scrolling.restored,'Question 1');

  await page.evaluate(()=>{
    window.fp={id:'item',type:'Reading',typeName:'supplement',payload:{captureAttempts:1,
      textCaptureEvidence:{method:'EXACT_READING_FIELD',itemId:'item',observedCharacters:10,capturedCharacters:10}}};
    window.recorder=installReadOnlyNetworkRecorder();recorder.setActive(fp);
  });
  for(let i=0;i<64;i++){
    const length=await page.evaluate(async i=>(await (await fetch('/api/authoringAtoms.v2/item?observation='+i)).text()).length,i);
    assert.equal(length,payload.length,'Coursera must retain the complete original response');
    await page.waitForFunction(()=>recorder.stats().pendingRequests===0);
    const stats=await page.evaluate(()=>recorder.stats());
    assert(stats.retainedChars+stats.reservedChars<=config.CTI_NETWORK_MAX_RETAINED_CHARS);
    assert(stats.retainedRecords+stats.reservedRecords<=config.CTI_NETWORK_MAX_RETAINED_RECORDS);
  }
  const retained=await page.evaluate(()=>({stats:recorder.stats(),contract:captureContractV6150(fp),gap:fp.payload.networkCaptureGap}));
  assert(retained.stats.retainedRecords<64);
  assert(retained.stats.resourceLimits.retainedCharacters>0);
  assert.equal(retained.contract.complete,false,'Omitted observations cannot certify a complete capture');
  assert(retained.contract.reasons.includes('NETWORK_CAPTURE_LIMIT_REACHED'));
  await page.evaluate(()=>recorder.releaseFor(fp));

  const isolation=await page.evaluate(async()=>{
    window.fp={id:'next'};recorder.setActive(fp);
    const request=(url,method='GET',json=false)=>new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open(method,url);if(json)xhr.responseType='json';
      xhr.onload=()=>resolve(json?xhr.response:xhr.responseText);xhr.onerror=reject;xhr.send();
    });
    const fetchPost=await (await fetch('/api/next/small',{method:'POST'})).text();
    const fetchUnrelated=await (await fetch('/api/unrelated/small')).text();
    const xhrPost=await request('/api/next/small','POST');
    const xhrUnrelated=await request('/api/unrelated/small');
    const before=recorder.takeFor(fp).length;
    const original=await request('/api/next/small','GET',true);
    // The site's onload runs before the recorder's added load listener.
    await new Promise(resolve=>setTimeout(resolve,0));
    const large=await request('/api/next/large-json','GET',true);
    await new Promise(resolve=>setTimeout(resolve,0));
    return {fetchPost,fetchUnrelated,xhrPost,xhrUnrelated,before,original,
      originalLargeCharacters:large.learnerText.length,gap:fp.payload.networkCaptureGap,
      records:recorder.takeFor(fp).map(record=>({text:record.text,source:record.source})),stats:recorder.stats()};
  });
  assert.equal(isolation.before,0,'Unrelated fetch/XHR traffic and POSTs must not be captured');
  for(const name of ['fetchPost','fetchUnrelated','xhrPost','xhrUnrelated'])assert.deepEqual(JSON.parse(isolation[name]),{answer:'café 日本語'});
  assert.deepEqual(isolation.original,{answer:'café 日本語'});
  assert.equal(isolation.records.length,1);assert.equal(isolation.records[0].source,'xhr');
  assert.deepEqual(JSON.parse(isolation.records[0].text),isolation.original);
  assert.equal(isolation.originalLargeCharacters,3000000);
  assert.equal(isolation.stats.responseCopyLimits.oversize,1);
  assert(isolation.gap.reasons.includes('oversize'));assert.equal(isolation.stats.reservedChars,0);
  await page.evaluate(()=>recorder.restore());
  const cleaned=await page.evaluate(()=>recorder.stats());
  assert.equal(cleaned.retainedChars,0);assert.equal(cleaned.reservedChars,0);assert.equal(cleaned.pendingRequests,0);

  // The maintained crawl driver and IndexedDB manager run unchanged. Only the
  // authenticated external editor response is substituted with exact Reading
  // evidence; this fixture does not certify a live Coursera course.
  const batchPage=await browser.newPage();
  const prepareBatchPage=async(target=batchPage,background=false)=>{
    if(target.url()===base+'/runtime-fixture')await target.reload();
    else await target.goto(base+'/runtime-fixture');
    await target.addScriptTag({content:constants+'\n'+definitions});
    await target.evaluate((background)=>{
      Object.assign(window,{ctiCheckpointManager:null,backgroundChunkMode:background,CTI_WHOLE_RUN_DEADLINE:Infinity,
        __CTI_BACKGROUND_CHUNK_DEADLINE_MS:background?Date.now()+25*60*1000:0,
        sleepMs:async()=>{},
        readingRouteForTargetV61311:fp=>'fixture:'+fp.id,
        recoverReadingRouteV61311:async fp=>({attempted:true,captured:true,route:'fixture:'+fp.id,dwellMs:1,samples:3,
          evidence:{textSample:'Observed learner text.',textConfidence:'high',textEvidenceCompleteness:1,
            textScopeKind:'reading-content-field',readingEditorEvidence:{itemId:fp.id},
            textCaptureEvidence:{method:'EXACT_READING_FIELD',scope:'EXACT_READING_FIELD',itemId:fp.id,
              observedCharacters:22,capturedCharacters:22}}})});
      window.makeInventory=()=>Array.from({length:45},(_,i)=>({id:'reading-'+i,name:'Reading '+i,type:'Reading',typeName:'supplement',payload:{}}));
    },background);
  };
  const batchResults=[];
  let previousRunId='';
  for(let batch=0;batch<3;batch++){
    await prepareBatchPage(); // Navigation creates a fresh document/renderer session.
    const receipt=await batchPage.evaluate(async()=>{
      const fingerprints=makeInventory();
      const manager=await createCheckpointManagerV6150('browser-batch-fixture');
      const restored=await manager.restore(fingerprints);
      const session=createLocalCaptureSessionV61514();
      const meta=await activeSpaCrawl(fingerprints,'browser-batch-fixture',{
        readingRouteTemplate:{fixture:true},localSession:session,
        checkpoint:(fp,diag,pass)=>manager.save(fp,diag,pass)});
      const accounting=finalCaptureAccountingV6150(fingerprints,meta);
      const visited=meta.targetDiagnostics.map(d=>d.id);
      const stopped=await activeSpaCrawl(fingerprints,'browser-batch-fixture',{
        readingRouteTemplate:{fixture:true},localSession:createLocalCaptureSessionV61514(),
        checkpoint:(fp,diag,pass)=>manager.save(fp,diag,pass)});
      const attempts=fingerprints.map(fp=>Number(fp.payload.captureAttempts || 0));
      const data={schemaVersion:35,fingerprints,meta:{captureAccounting:accounting,activeSpaCrawl:meta}};
      await exportCaptureWithCheckpoints('batch.json',data,manager,meta.cooperativeChunkYielded);
      const cleared=meta.cooperativeChunkYielded?null:await manager.restore(makeInventory());
      const title=document.querySelector('#__cti_download_panel div').textContent;
      manager.close();
      return {available:manager.available,runId:manager.runId,restored,visited,attempts,
        stoppedVisits:stopped.targetDiagnostics.length,meta,accounting,cleared,title};
    });
    assert.equal(receipt.available,true);
    assert.equal(receipt.restored.restored,batch*20);
    if(previousRunId)assert.equal(receipt.runId,previousRunId,'Reload must retain the checkpoint run');
    previousRunId=receipt.runId;
    assert.equal(receipt.visited.length,batch<2?20:5);
    assert.equal(receipt.stoppedVisits,0,'Repasting in the same document cannot bypass the batch limit');
    assert.equal(receipt.attempts.filter(n=>n>1).length,0,'Restored complete items must not be revisited');
    assert.equal(receipt.accounting.complete,batch===2);
    if(batch<2){
      assert.equal(receipt.meta.cooperativeYieldReason,'LOCAL_RENDERER_VISIT_LIMIT');
      assert.equal(receipt.title,'CTI partial capture saved');
    }else{
      assert.equal(receipt.cleared.restored,0,'Final JSON preparation clears the finished checkpoints');
      assert.equal(receipt.title,'CTI extraction complete');
    }
    batchResults.push(receipt.visited);
  }
  assert.equal(new Set(batchResults.flat()).size,45);

  // Match the remote controller: persist full browser storage, close the old
  // browser context, then resume in a fresh context without member downloads.
  let remoteState;
  const remoteVisits=[];
  for(let chunk=0;chunk<3;chunk++) {
    const remoteContext=await browser.newContext(remoteState?{storageState:remoteState}:{});
    const remotePage=await remoteContext.newPage();
    let remoteDownloads=0;remotePage.on('download',()=>remoteDownloads++);
    await prepareBatchPage(remotePage,true);
    const receipt=await remotePage.evaluate(async()=>{
      const fingerprints=makeInventory();
      const manager=await createCheckpointManagerV6150('remote-browser-batch-fixture');
      const restored=await manager.restore(fingerprints);
      const meta=await activeSpaCrawl(fingerprints,'remote-browser-batch-fixture',{
        readingRouteTemplate:{fixture:true},localSession:createLocalCaptureSessionV61514(),cooperativeChunk:true,
        checkpoint:(fp,diag,pass)=>manager.save(fp,diag,pass)});
      const data={schemaVersion:35,fingerprints,meta:{activeSpaCrawl:meta,captureAccounting:finalCaptureAccountingV6150(fingerprints,meta)}};
      await exportCaptureWithCheckpoints('remote.json',data,manager,meta.cooperativeChunkYielded);
      const result={restored:restored.restored,visited:meta.targetDiagnostics.map(d=>d.id),
        yielded:meta.cooperativeChunkYielded,complete:data.meta.captureAccounting.complete,
        retained:JSON.parse(window.__CTI_LAST_JSON).fingerprints.length,
        panel:!!document.getElementById('__cti_download_panel'),attempts:fingerprints.map(fp=>fp.payload.captureAttempts || 0)};
      manager.close();return result;
    });
    assert.equal(receipt.restored,chunk*20);
    assert.equal(receipt.visited.length,chunk<2?20:5);
    assert.equal(receipt.yielded,chunk<2);assert.equal(receipt.complete,chunk===2);
    assert.equal(receipt.retained,45);assert.equal(receipt.panel,false);assert.equal(remoteDownloads,0);
    assert(receipt.attempts.every(n=>n<=1));remoteVisits.push(...receipt.visited);
    remoteState=await remoteContext.storageState({indexedDB:true});
    await remoteContext.close();
  }
  assert.equal(new Set(remoteVisits).size,45);

  // An imported JSON recovers a lost session without downgrading newer work,
  // copying untouched records into checkpoints, or crossing live identities.
  await prepareBatchPage();
  const imported=await batchPage.evaluate(async()=>{
    const fresh=makeInventory().slice(0,4),saved=JSON.parse(JSON.stringify(fresh));
    function complete(fp,text){fp.payload={captureAttempts:1,textSample:text,textConfidence:'high',
      textEvidenceCompleteness:1,textScopeKind:'reading-content-field',
      textCaptureEvidence:{method:'EXACT_READING_FIELD',itemId:fp.id,observedCharacters:text.length,capturedCharacters:text.length}};}
    complete(saved[0],'Older saved observation.');complete(saved[1],'Saved observation recovered.');
    saved[0].payload.lastCaptureAttemptAt=new Date(Date.now()-60000).toISOString();
    saved[3].name='Different old title';complete(saved[3],'Cannot match the renamed item.');
    const absent={...saved[1],id:'deleted-item'};
    const capture={schemaVersion:35,extractedAt:new Date(Date.now()+1000).toISOString(),page:{courseId:'browser-batch-fixture'},fingerprints:[...saved,absent]};
    const manager=await createCheckpointManagerV6150('browser-batch-fixture');
    const newer=JSON.parse(JSON.stringify(fresh[0]));complete(newer,'Newer checkpoint observation.');
    await manager.save(newer,null,'primary');
    const seed=await manager.seed(capture,fresh),restored=await manager.restore(fresh);
    let mismatchBlocked=false;
    try{await manager.seed({...capture,page:{courseId:'different'}},fresh);}catch(_){mismatchBlocked=true;}
    const meta=await activeSpaCrawl(fresh,'browser-batch-fixture',{readingRouteTemplate:{fixture:true},
      localSession:createLocalCaptureSessionV61514(),checkpoint:(fp,diag,pass)=>manager.save(fp,diag,pass)});
    const result={seed,restored,mismatchBlocked,newerText:fresh[0].payload.textSample,
      importedText:fresh[1].payload.textSample,visited:meta.targetDiagnostics.map(d=>d.id)};
    await manager.clear();manager.close();return result;
  });
  assert.equal(imported.seed.imported,1);assert.equal(imported.seed.keptNewer,1);assert.equal(imported.seed.skipped,3);
  assert.equal(imported.restored.restored,2);assert.equal(imported.mismatchBlocked,true);
  assert.equal(imported.newerText,'Newer checkpoint observation.');assert.equal(imported.importedText,'Saved observation recovered.');
  assert.deepEqual(imported.visited,['reading-2','reading-3'],'Completed saved items must not be captured again');

  const emptyPage=await browser.newPage();emptyPage.on('pageerror',error=>errors.push(error.message));
  const emptyCourse='synthetic_empty_course',emptyItem='empty_reading';
  await emptyPage.route('https://www.coursera.org/**',route=>route.fulfill({contentType:'text/html',body:
    `<div style="width:300px;height:40px" contenteditable="true" role="textbox" aria-label="Reading Content" data-testid="${emptyCourse}+${emptyItem}"></div>`}));
  await emptyPage.goto(`https://www.coursera.org/teach/synthetic/${emptyCourse}/content/item/supplement/${emptyItem}`);
  await emptyPage.addScriptTag({content:constants+'\n'+definitions});
  const emptyCapture=await emptyPage.evaluate(async({courseId,itemId})=>{
    const fp={id:itemId,name:'Empty Reading',type:'Reading',typeName:'supplement',payload:{captureAttempts:1}};
    // Reproduce an approximate snapshot that includes editor chrome, while
    // keeping the real exact-field extraction and stability loop unchanged.
    const quick=quickRootEvidenceSnapshot;
    window.quickRootEvidenceSnapshot=(...args)=>({...quick(...args),textLength:1});
    const recovery=await recoverReadingRouteV61311(fp,courseId,readingRouteTemplateV61312(courseId),
      {reuseMounted:true,deadline:Date.now()+14000});
    mergeReadingRecoveryV61311(fp,recovery);
    const manager=await createCheckpointManagerV6150(courseId);await manager.save(fp,null,'primary');manager.close();
    return {captured:recovery.captured,proof:fp.payload.emptyReadingEvidence,contract:captureContractV6150(fp)};
  },{courseId:emptyCourse,itemId:emptyItem});
  assert.equal(emptyCapture.captured,true);assert(emptyCapture.proof.dwellMs>=10000);
  assert.equal(emptyCapture.contract.status,'COMPLETE_EMPTY_READING');
  await emptyPage.reload();await emptyPage.addScriptTag({content:constants+'\n'+definitions});
  const emptyRestored=await emptyPage.evaluate(async({courseId,itemId})=>{
    const fp={id:itemId,name:'Empty Reading',type:'Reading',typeName:'supplement',payload:{}};
    const manager=await createCheckpointManagerV6150(courseId),restored=await manager.restore([fp]);
    const result={restored,proof:fp.payload.emptyReadingEvidence,status:captureContractV6150(fp).status};
    await manager.clear();manager.close();return result;
  },{courseId:emptyCourse,itemId:emptyItem});
  assert.equal(emptyRestored.restored.restored,1);assert.deepEqual(emptyRestored.proof,emptyCapture.proof);
  assert.equal(emptyRestored.status,'COMPLETE_EMPTY_READING');
  const wrongCourseResume=createSavedCourseraResumeScript({schemaVersion:35,extractedAt:'2026-10-11T00:00:00Z',
    page:{courseId:'different_course'},fingerprints:[{id:'reading',name:'Reading',type:'Reading',typeName:'supplement',payload:{}}]},
    'https://www.coursera.org/teach/synthetic/different_course/content/edit',courseraSource);
  const wrongCourse=await emptyPage.evaluate(async program=>{
    await (0,eval)(program);return {locked:!!window.__CTI_ITEM_FIDELITY_RUN_LOCK,
      resumeDataRetained:!!window.__CTI_LOCAL_CAPTURE_RESUME__};
  },wrongCourseResume);
  assert.equal(wrongCourse.locked,false);assert.equal(wrongCourse.resumeDataRetained,false);

  await prepareBatchPage();
  const failedCheckpoint=await batchPage.evaluate(async()=>{
    const session=createLocalCaptureSessionV61514(),fingerprints=makeInventory();
    const meta=await activeSpaCrawl(fingerprints,'browser-batch-fixture',{
      readingRouteTemplate:{fixture:true},localSession:session,checkpoint:async()=>false});
    return {visits:meta.targetDiagnostics.length,errors:meta.checkpointErrors,writes:meta.checkpointWrites || 0,
      reason:meta.cooperativeYieldReason,remainingAttempts:fingerprints.slice(1).map(fp=>fp.payload.captureAttempts || 0)};
  });
  assert.equal(failedCheckpoint.visits,1);assert.equal(failedCheckpoint.errors,1);assert.equal(failedCheckpoint.writes,0);
  assert.equal(failedCheckpoint.reason,'LOCAL_CHECKPOINT_UNAVAILABLE');
  assert(failedCheckpoint.remainingAttempts.every(n=>n===0));

  await batchPage.context().grantPermissions(['clipboard-read','clipboard-write']);
  const continuation=await batchPage.evaluate(async source=>{
    window.__CTI_LOCAL_CAPTURE_RENDERER_SESSION__={visits:20,startedAt:Date.now(),yieldReason:'LOCAL_RENDERER_VISIT_LIMIT',checkpointFailed:false};
    const nativeAttach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){
      const root=nativeAttach.call(this,options);
      if(this.hasAttribute('data-cti-continuation'))window.fixtureContinuationRoot=root;
      return root;
    };
    let requests=0;const nativeFetch=window.fetch;
    window.fetch=(...args)=>{requests++;return nativeFetch(...args);};
    await (0,eval)(source); // The actual pasted bundle must stop before API/editor work.
    return {requests,insideBody:!!document.body.querySelector('[data-cti-continuation]'),
      reloadHidden:fixtureContinuationRoot.getElementById('reload').hidden,
      rootMode:fixtureContinuationRoot.mode};
  },courseraSource);
  assert.equal(continuation.requests,0);assert.equal(continuation.insideBody,false);
  assert.equal(continuation.rootMode,'closed');assert.equal(continuation.reloadHidden,false);
  const copyContinuation=await batchPage.evaluateHandle(()=>fixtureContinuationRoot.getElementById('copy'));
  await copyContinuation.asElement().click();
  await batchPage.waitForFunction(()=>fixtureContinuationRoot.getElementById('status').textContent.startsWith('Copied.'));
  const continuationSource=await batchPage.evaluate(()=>navigator.clipboard.readText());
  assert.equal(continuationSource.trimEnd(),courseraSource.trimEnd(),'Continuation must copy the entire current standalone bundle');
  new Function(continuationSource);
  await batchPage.evaluate(()=>{
    Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw Error('Fixture permission denial');}});
  });
  await copyContinuation.asElement().click();
  const manualContinuation=await batchPage.evaluate(()=>({
    source:fixtureContinuationRoot.getElementById('manual').value,
    visible:!fixtureContinuationRoot.getElementById('manual').hidden,
    bodyContainsScript:document.body.textContent.includes('ctiCourseraCaptureV61533')}));
  assert.equal(manualContinuation.source.trimEnd(),courseraSource.trimEnd());assert.equal(manualContinuation.visible,true);
  assert.equal(manualContinuation.bodyContainsScript,false);

  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  await ownerAccessFixture(context);
  const app=await context.newPage();app.on('pageerror',error=>errors.push(error.message));
  await app.goto(base);
  await app.getByRole('button',{name:'Review a capture',exact:true}).click();
  await app.getByRole('button',{name:'Coursera extractor',exact:false}).click();
  const quickLocal=app.locator('.script-panel .local-extraction-card');
  await quickLocal.locator('.legacy-local-extraction > summary').click();
  await quickLocal.getByLabel('Coursera authoring-shell URL',{exact:true}).fill('https://www.coursera.org/teach/synthetic/Native_local_fixture_123/content/edit');
  await quickLocal.getByText('Diagnostic one-quiz response sample',{exact:true}).click();
  await quickLocal.getByRole('button',{name:'Copy one-quiz data check',exact:true}).click();
  await quickLocal.getByText('Data-check script copied.',{exact:false}).waitFor();
  const sampleScript=await app.evaluate(()=>navigator.clipboard.readText());
  assert(sampleScript.startsWith('void ('));assert(sampleScript.includes('Native_local_fixture_123'));
  assert(sampleScript.includes('Download response sample'));assert.doesNotThrow(()=>new Function(sampleScript));
  await context.route('https://www.coursera.org/**',route=>route.fulfill({contentType:'text/html',body:'<html><body>Managed Coursera shell fixture</body></html>'}));
  const samplePage=await context.newPage();
  await samplePage.goto('https://www.coursera.org/teach/synthetic/Native_local_fixture_123/content/edit');
  await samplePage.evaluate(sampleScript);
  assert.equal(await samplePage.evaluate(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot().courseId),'Native_local_fixture_123');
  await samplePage.evaluate(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.stop());await samplePage.close();await app.bringToFront();
  await quickLocal.getByRole('button',{name:'Copy automatic local capture command',exact:true}).click();
  await quickLocal.getByText('automatic command copied.',{exact:false}).waitFor();
  const nativeCommand=JSON.parse(await app.evaluate(()=>navigator.clipboard.readText()));
  assert.equal(nativeCommand.cmd,'Page.addScriptToEvaluateOnNewDocument');
  assert(nativeCommand.args.source.includes(courseraSource.slice('javascript:'.length)));
  const previousCapture={schemaVersion:35,extractedAt:new Date().toISOString(),
    page:{courseId:'Native_local_fixture_123'},fingerprints:[{id:'previous-reading',name:'Previous reading',typeName:'supplement',
      payload:{captureAttempts:1,textSample:'Previously observed learner content.'}}]};
  await quickLocal.locator('input[type="file"]').setInputFiles({name:'previous-capture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(previousCapture))});
  await quickLocal.getByRole('button',{name:'Copy automatic resume command',exact:true}).waitFor();
  await quickLocal.getByRole('button',{name:'Copy fresh full-course command',exact:true}).click();
  await quickLocal.getByText('fresh full-course command copied.',{exact:false}).waitFor();
  const freshCommand=JSON.parse(await app.evaluate(()=>navigator.clipboard.readText()));
  assert.equal(freshCommand.cmd,'Page.addScriptToEvaluateOnNewDocument');
  assert(freshCommand.args.source.includes('"freshRun":true'));
  assert(freshCommand.args.source.includes(courseraSource.slice('javascript:'.length)));
  assert.equal(freshCommand.args.source.includes('previous-reading'),false,'Fresh button ignores a selected saved capture');
  await quickLocal.getByRole('button',{name:'Copy automatic resume command',exact:true}).waitFor();
  await app.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw Error('Fixture permission denial')}}));
  await quickLocal.getByRole('button',{name:'Copy one-quiz data check',exact:true}).click();
  await quickLocal.getByText('Select and copy the complete data-check script below.',{exact:false}).waitFor();
  assert.equal(await quickLocal.getByLabel('One-quiz data-check script',{exact:true}).inputValue(),sampleScript);
  await quickLocal.getByRole('button',{name:'Copy fresh full-course command',exact:true}).click();
  await quickLocal.getByText('Select and copy the full command below.',{exact:false}).waitFor();
  const freshFallback=JSON.parse(await quickLocal.getByLabel('Automatic local capture command',{exact:true}).inputValue());
  assert(freshFallback.args.source.includes('"freshRun":true'));
  assert(freshFallback.args.source.includes(courseraSource.slice('javascript:'.length)));
  await app.evaluate(()=>delete navigator.clipboard.writeText);
  await quickLocal.getByRole('button',{name:'Copy saved-progress export command',exact:true}).click();
  await quickLocal.getByText('Saved-progress export command copied.',{exact:false}).waitFor();
  const recoveryCommand=JSON.parse(await app.evaluate(()=>navigator.clipboard.readText()));
  assert.equal(recoveryCommand.cmd,'Runtime.evaluate');assert.equal(recoveryCommand.args.awaitPromise,true);
  assert(recoveryCommand.args.expression.includes('__CTI_LOCAL_CHECKPOINT_EXPORT__='));
  assert(recoveryCommand.args.expression.includes(courseraSource.slice('javascript:'.length)));
  await quickLocal.getByRole('button',{name:'Copy saved-progress Console script',exact:true}).click();
  await quickLocal.getByText('Saved-progress Console script copied.',{exact:false}).waitFor();
  const consoleRecovery=await app.evaluate(()=>navigator.clipboard.readText());
  assert.equal(consoleRecovery,recoveryCommand.args.expression,'Console export must preserve the exact guarded read-only recovery program');
  await quickLocal.getByRole('button',{name:'Copy current quiz API check',exact:true}).click();
  await quickLocal.getByText('Current quiz API check copied.',{exact:false}).waitFor();
  const quizProbe=await app.evaluate(()=>navigator.clipboard.readText());
  new Function(quizProbe);
  assert(quizProbe.includes('CURRENT_QUIZ_ONLY'));assert(quizProbe.includes('collectCourseraAssessmentApiV61524'));
  assert(!quizProbe.includes('const CTI_RUN_LOCK_KEY ='),'The copied quiz probe included full-course entry orchestration');
  await quickLocal.getByLabel('Fresh full-course managed run',{exact:true}).check();
  const managedOpening=context.waitForEvent('page');
  await quickLocal.getByRole('button',{name:'Open managed Coursera tab',exact:true}).click();
  const managedTab=await managedOpening;
  await quickLocal.getByRole('button',{name:'Copy managed capture command',exact:true}).waitFor({state:'visible'});
  await quickLocal.getByText('Managed command ready.',{exact:false}).waitFor();
  await app.bringToFront();
  await quickLocal.getByRole('button',{name:'Copy managed capture command',exact:true}).click();
  await quickLocal.getByText('Managed command copied.',{exact:false}).waitFor();
  const managedCommand=JSON.parse(await app.evaluate(()=>navigator.clipboard.readText()));
  assert.equal(managedCommand.cmd,'Page.addScriptToEvaluateOnNewDocument');
  assert(managedCommand.args.source.includes('"controllerOrigin":'+JSON.stringify(new URL(app.url()).origin)));
  assert(managedCommand.args.source.includes('"freshRun":true'));assert(!managedCommand.args.source.includes('previous-reading'));
  assert(managedCommand.args.source.includes(courseraSource.slice('javascript:'.length)));
  const managedConfig=JSON.parse(managedCommand.args.source.match(/window\.__CTI_AUTOMATIC_LOCAL_CONFIG__=([^\n;]+);/)[1]);
  await app.locator('.script-panel > .section-top').getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await quickLocal.count(),0,'The test must actually unmount the capture panel');
  await managedTab.evaluate(config=>{
    window.fixtureControllerAcks=[];
    window.addEventListener('message',event=>{if(event.data?.kind==='CTI_LOCAL_CAPTURE_ACK_V1')fixtureControllerAcks.push(event.data.token);});
    window.opener.postMessage({kind:'CTI_LOCAL_CAPTURE_STATUS_V1',event:'READY',token:config.token,
      courseId:config.courseId,visibility:'visible',itemId:'fixture-quiz',savedQuestions:79},config.controllerOrigin);
  },managedConfig);
  await managedTab.waitForFunction(token=>fixtureControllerAcks.includes(token),managedConfig.token,{timeout:5000});
  await app.getByRole('button',{name:'Coursera extractor',exact:false}).click();
  await quickLocal.getByRole('button',{name:'Show managed Coursera tab',exact:true}).waitFor();
  assert.equal(await quickLocal.getByLabel('Coursera authoring-shell URL',{exact:true}).inputValue(),
    'https://www.coursera.org/teach/synthetic/Native_local_fixture_123/content/edit');
  assert((await quickLocal.innerText()).includes('79 question observations saved'));
  await quickLocal.getByRole('button',{name:'Copy managed capture command',exact:true}).click();
  assert.deepEqual(JSON.parse(await app.evaluate(()=>navigator.clipboard.readText())),managedCommand,
    'Remount must retain the existing command and child, rather than create another run');
  const managedClosed=managedTab.waitForEvent('close');
  await quickLocal.getByRole('button',{name:'Stop managed run',exact:true}).click();
  await managedClosed;
  assert(managedTab.isClosed());
  await quickLocal.getByRole('button',{name:'Copy saved-run recovery command',exact:true}).click();
  await quickLocal.getByText('saved-run recovery command copied.',{exact:false}).waitFor();
  const standaloneRecovery=JSON.parse(await app.evaluate(()=>navigator.clipboard.readText()));
  assert(standaloneRecovery.args.source.includes('"resumeExisting":true'));
  assert(!standaloneRecovery.args.source.includes('"freshRun":true'));
  assert(!standaloneRecovery.args.source.includes('previous-reading'));
  const recoveryOpening=context.waitForEvent('page');
  await quickLocal.getByRole('button',{name:'Resume saved managed run',exact:true}).click();
  const recoveryTab=await recoveryOpening;
  await quickLocal.getByText('Managed command ready.',{exact:false}).waitFor();
  await app.bringToFront();
  await quickLocal.getByRole('button',{name:'Copy managed capture command',exact:true}).click();
  await quickLocal.getByText('Managed command copied.',{exact:false}).waitFor();
  const managedRecovery=JSON.parse(await app.evaluate(()=>navigator.clipboard.readText()));
  assert(managedRecovery.args.source.includes('"resumeExisting":true'));
  assert(!managedRecovery.args.source.includes('"freshRun":true'));
  assert(!managedRecovery.args.source.includes('previous-reading'));
  assert.equal(await quickLocal.getByLabel('Fresh full-course managed run',{exact:true}).isChecked(),false);
  const recoveryClosed=recoveryTab.waitForEvent('close');
  await quickLocal.getByRole('button',{name:'Stop managed run',exact:true}).click();
  await recoveryClosed;
  await app.getByText('Manual extractor script',{exact:true}).click();
  await app.getByRole('button',{name:'Copy script',exact:true}).click();
  await app.getByText(CTI_RELEASE_REGISTRY_.courseraExtractor.version+' copied.',{exact:true}).waitFor();
  const copied=await app.evaluate(()=>navigator.clipboard.readText());
  assert.equal(copied,courseraSource,'The built copy button must deliver the fixed canonical bundle');
  assert.equal(await app.getByLabel('Extractor script',{exact:true}).inputValue(),copied);
  const download=app.waitForEvent('download');
  await app.getByRole('button',{name:'Download script',exact:true}).click();
  assert.equal(fs.readFileSync(await (await download).path(),'utf8'),copied);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',release:CTI_RELEASE_REGISTRY_.courseraExtractor,
    checks:['native scroll mounts virtualized question rows without duplicate ViewTransitions','no-op and restore scrolling',
      '64-response burst stays inside acquisition budget','resource gaps prevent false completion',
      'original fetch/XHR responses and Unicode preserved','unknown-length oversized JSON XHR copy bounded',
      'ineligible requests excluded','release restores capacity',
      '45-item capture across three fresh documents restores IndexedDB checkpoints without duplicate visits',
      'remote capture across three fresh contexts restores browser storage and makes no intermediate downloads',
      'saved JSON restores matching observed items, keeps newer checkpoints and visits only remaining items',
      'real exact-empty Reading waits ten seconds, merges its proof and survives IndexedDB reload',
      'actual saved-file resume blocks a different Coursera course before capture/storage work',
      'repasting cannot bypass renderer limits; partial exports remain incomplete',
      'failed checkpoint write stops further editor visits',
      'actual pasted bundle refuses repeat work until reload and copies a complete standalone continuation',
      'continuation clipboard denial offers manual copy outside course evidence',
      'built automatic and fresh full-course copy buttons, selected-file isolation and complete clipboard-denial fallback',
      'built saved-run recovery commands preserve browser checkpoints rather than importing the selected file or starting fresh',
      'closing the capture panel preserves the live controller; reopening restores its command, child and saved counts',
      'built one-quiz Console sampler copy and complete clipboard-denial fallback',
      'built Copy script, download and manual copy match fixed bundle'],
    retainedRecords:retained.stats.retainedRecords,retainedCharacters:retained.stats.retainedChars,pageErrors:errors},null,2));
}finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
}
