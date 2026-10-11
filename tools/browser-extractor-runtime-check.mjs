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
  const prepareBatchPage=async()=>{
    if(batchPage.url()===base+'/runtime-fixture')await batchPage.reload();
    else await batchPage.goto(base+'/runtime-fixture');
    await batchPage.addScriptTag({content:constants+'\n'+definitions});
    await batchPage.evaluate(()=>{
      Object.assign(window,{backgroundChunkMode:false,CTI_WHOLE_RUN_DEADLINE:Infinity,
        sleepMs:async()=>{},
        readingRouteForTargetV61311:fp=>'fixture:'+fp.id,
        recoverReadingRouteV61311:async fp=>({attempted:true,captured:true,route:'fixture:'+fp.id,dwellMs:1,samples:3,
          evidence:{textSample:'Observed learner text.',textConfidence:'high',textEvidenceCompleteness:1,
            textScopeKind:'reading-content-field',readingEditorEvidence:{itemId:fp.id},
            textCaptureEvidence:{method:'EXACT_READING_FIELD',scope:'EXACT_READING_FIELD',itemId:fp.id,
              observedCharacters:22,capturedCharacters:22}}})});
      window.makeInventory=()=>Array.from({length:45},(_,i)=>({id:'reading-'+i,name:'Reading '+i,type:'Reading',typeName:'supplement',payload:{}}));
    });
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
    bodyContainsScript:document.body.textContent.includes('ctiCourseraCaptureV61515')}));
  assert.equal(manualContinuation.source.trimEnd(),courseraSource.trimEnd());assert.equal(manualContinuation.visible,true);
  assert.equal(manualContinuation.bodyContainsScript,false);

  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  await ownerAccessFixture(context);
  const app=await context.newPage();app.on('pageerror',error=>errors.push(error.message));
  await app.goto(base);
  await app.getByRole('button',{name:'Review a capture',exact:true}).click();
  await app.getByRole('button',{name:'Coursera extractor',exact:false}).click();
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
      'saved JSON restores matching observed items, keeps newer checkpoints and visits only remaining items',
      'real exact-empty Reading waits ten seconds, merges its proof and survives IndexedDB reload',
      'actual saved-file resume blocks a different Coursera course before capture/storage work',
      'repasting cannot bypass renderer limits; partial exports remain incomplete',
      'failed checkpoint write stops further editor visits',
      'actual pasted bundle refuses repeat work until reload and copies a complete standalone continuation',
      'continuation clipboard denial offers manual copy outside course evidence',
      'built Copy script, download and manual copy match fixed bundle'],
    retainedRecords:retained.stats.retainedRecords,retainedCharacters:retained.stats.retainedChars,pageErrors:errors},null,2));
}finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
}
