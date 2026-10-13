import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {courseraSource} from '../src/generated/extractor-sources.js';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';
import {extractorFunctions} from './extractor-functions.cjs';
import {CTI_CHECKPOINT_DB,CTI_CHECKPOINT_STORE,CTI_CHECKPOINT_SESSION_PREFIX} from '../src/extractors/coursera/config.js';

// Run the maintained entry, checkpoint store, completion accounting, renderer
// bounds, automatic controller and export in Chromium. Substitute only the
// authenticated external editor observations and its waiting/navigation boundary.
const courseId='Native_local_fixture_123';
const shell=`https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const functions=extractorFunctions(courseraSource);
let fixtureProgram=courseraSource;
const substitutes={
 readingRouteTemplateV61312:'function readingRouteTemplateV61312(){return {fixture:true}}',
 readingRouteForTargetV61311:'function readingRouteForTargetV61311(fp){return "fixture:"+fp.id}',
 sleepMs:'async function sleepMs(){}',
 returnToOutlineV6142:'async function returnToOutlineV6142(){}',
 hydrateOutlineSurfaceForCrawl:'async function hydrateOutlineSurfaceForCrawl(){return {fixture:true}}',
 findNavigationTargetForFingerprint:'async function findNavigationTargetForFingerprint(){return null}',
 recoverReadingRouteV61311:`async function recoverReadingRouteV61311(fp){
   const visits=JSON.parse(sessionStorage.getItem('fixture-visits') || '[]');visits.push(fp.id);sessionStorage.setItem('fixture-visits',JSON.stringify(visits));
   const text='Observed learner content café 日本語 '+fp.id+' '+ 'x'.repeat(16000);
   return {attempted:true,captured:true,route:'fixture:'+fp.id,dwellMs:1,samples:3,
     evidence:{textSample:text,textConfidence:'high',textEvidenceCompleteness:1,textScopeKind:'reading-content-field',
       readingEditorEvidence:{itemId:fp.id},textCaptureEvidence:{method:'EXACT_READING_FIELD',scope:'EXACT_READING_FIELD',itemId:fp.id,observedCharacters:text.length,capturedCharacters:text.length}}};}`,
};
for(const [name,replacement] of Object.entries(substitutes)){
 const original=functions.get(name);assert(original,`Missing fixture boundary ${name}`);
 assert(fixtureProgram.includes(original));fixtureProgram=fixtureProgram.replace(original,replacement);
}
const browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({acceptDownloads:true});
 let inventoryCount=188,apiFails=false;
 const fulfillFixture=async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.startsWith('/api/')){
   if(apiFails && url.pathname.includes('authoringCourseMaterials'))return route.fulfill({status:401,json:{error:'synthetic session expired'}});
   return route.fulfill({json:url.pathname.includes('authoringCourseMaterials')?
    {elements:Array.from({length:inventoryCount},(_,i)=>({id:'reading-'+i,name:'Reading '+i,typeName:'supplement'}))}:{}});
  }
  return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local fixture</title><body><main>Authoring outline</main><script>window.fixtureDocumentId=crypto.randomUUID()</script>'});
 };
 await context.route('https://www.coursera.org/**',fulfillFixture);
 const page=await context.newPage();const errors=[],downloads=[],documents=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('download',download=>downloads.push(download));
 page.on('domcontentloaded',()=>documents.push(Date.now()));
 await page.goto(shell);
 const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
 const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'native_fixture_token_123'));
 const registration=await cdp.send(command.cmd,command.args);assert(registration.identifier);
 await page.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:90000});
 if(!downloads.length)await page.waitForEvent('download',{timeout:10000});
 assert.equal(downloads.length,1,'Only the final course capture downloads');
 const downloaded=JSON.parse(fs.readFileSync(await downloads[0].path(),'utf8'));
 assert.equal(downloaded.fingerprints.length,188);
 assert.equal(downloaded.meta.captureAccounting.complete,true);
 assert.equal(downloaded.meta.automaticLocalCapture.batches,10);
 assert.equal(documents.length,10,'Each bounded batch creates a new document');
 const receipt=await page.evaluate(()=>({visits:JSON.parse(sessionStorage.getItem('fixture-visits')),json:window.__CTI_LAST_JSON,
   blob:window.__CTI_LAST_JSON_BLOB.size,continuation:!!document.getElementById('__cti_checkpoint_continuation')}));
 assert.equal(receipt.visits.length,188);assert.equal(new Set(receipt.visits).size,188);
 assert.equal(receipt.json,null,'No second course-sized JSON string is retained');assert(receipt.blob>3000000);
 assert.equal(receipt.continuation,false);
 await page.reload();await page.waitForTimeout(1000);
 assert.equal(downloads.length,1,'A finished registration cannot restart or duplicate the download');
 await page.goto('https://www.coursera.org/teach/synthetic/Different_course_123/content/edit');
 await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>Boolean(window.__CTI_ITEM_FIDELITY_RUN_LOCK)),false);
 await page.goto(shell);inventoryCount=3;
 // Force a failed durable checkpoint write. The same canonical entry must stop
 // automatic navigation and export its raw partial evidence, never certify it.
 const failureProgram=fixtureProgram.replace(functions.get('createCheckpointManagerV6150'),`async function createCheckpointManagerV6150(){return {available:false,saved:0,error:'fixture write failure',restore:async()=>({available:false,restored:0}),save:async()=>false,clear:async()=>{},close(){}}}`);
 const failed=JSON.parse(createAutomaticLocalCourseraCommand(shell,failureProgram,'failed_fixture_token_123'));
 await cdp.send(failed.cmd,failed.args);
 await page.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.token==='failed_fixture_token_123',{},{timeout:10000});
 const partial=await page.evaluate(()=>window.__CTI_LAST_RESULT);
 assert.equal(partial.meta.automaticLocalCapture.reason,'LOCAL_CHECKPOINT_UNAVAILABLE');
 assert.equal(partial.meta.captureAccounting.complete,false);assert(partial.meta.captureAccounting.unvisitedCount>0);
 assert.equal(partial.meta.automaticLocalCapture.state,'FINISHED');
 // A late restore failure can occur after one legacy row was restored. It must
 // stop acquisition before bare placeholders can replace durable raw evidence.
 const restoreContext=await browser.newContext({acceptDownloads:true});
 await restoreContext.route('https://www.coursera.org/**',fulfillFixture);
 const restorePage=await restoreContext.newPage(),restoreDownloads=[];
 restorePage.on('download',download=>restoreDownloads.push(download));
 restorePage.on('pageerror',error=>errors.push(error.message));
 await restorePage.goto(shell);
 const restoreSession=await restoreContext.newCDPSession(restorePage);await restoreSession.send('Page.enable');
 const restoreFailureProgram=fixtureProgram.replace(functions.get('createCheckpointManagerV6150'),`async function createCheckpointManagerV6150(){return {available:true,saved:0,error:'synthetic late restore failure',restore:async()=>({available:true,restored:1,deferred:0,error:'synthetic late restore failure'}),save:async()=>{throw Error('Acquisition must not overwrite saved evidence')},close(){}}}`);
 const restoreFailureCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,restoreFailureProgram,'restore_failure_token_123'));
 await restoreSession.send(restoreFailureCommand.cmd,restoreFailureCommand.args);
 await restorePage.waitForFunction(()=>JSON.parse(localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_restore_failure_token_123') || 'null')?.reason==='LOCAL_CHECKPOINT_RESTORE_FAILED',{},{timeout:10000});
 assert.equal(await restorePage.evaluate(()=>JSON.parse(sessionStorage.getItem('fixture-visits') || '[]').length),0);
 assert.equal(restoreDownloads.length,0,'A failed restoration must not publish a complete or replacement capture');
 await restoreContext.close();
 await page.reload();apiFails=true;
 const unavailable=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'unavailable_fixture_token_123'));
 await cdp.send(unavailable.cmd,unavailable.args);
 await page.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.reason==='COURSE_INVENTORY_UNAVAILABLE',{},{timeout:10000});
 const diagnostic=await page.evaluate(()=>window.__CTI_LAST_RESULT);
 assert.equal(evaluateCourseraCapture(diagnostic,courseId).complete,false);
 apiFails=false;
 // A debugger disconnect removes its script registration but leaves the item
 // store intact. Registering a new command in the same reloaded tab recovers it.
 inventoryCount=55;
 const recoveryContext=await browser.newContext({acceptDownloads:true});
 await recoveryContext.route('https://www.coursera.org/**',fulfillFixture);
 const recoveryPage=await recoveryContext.newPage(),recoveryDownloads=[];
 recoveryPage.on('download',download=>recoveryDownloads.push(download));
 recoveryPage.on('pageerror',error=>errors.push(error.message));
 await recoveryPage.goto(shell);
 await recoveryPage.evaluate(()=>{window.__CTI_LOCAL_CAPTURE_RENDERER_SESSION__={visits:20,startedAt:Date.now(),checkpointFailed:false,baselineHeapBytes:0,yieldReason:'LOCAL_RENDERER_VISIT_LIMIT'};});
 const firstSession=await recoveryContext.newCDPSession(recoveryPage);await firstSession.send('Page.enable');
 const firstCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'recovery_first_token_123'));
 await firstSession.send(firstCommand.cmd,firstCommand.args);
 await recoveryPage.waitForFunction(()=>JSON.parse(localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_recovery_first_token_123') || 'null')?.batches===1,{},{timeout:10000});
 await firstSession.detach();
 await recoveryPage.waitForEvent('domcontentloaded',{timeout:5000});
 assert.equal(await recoveryPage.evaluate(()=>Boolean(window.__CTI_ITEM_FIDELITY_RUN_LOCK)),false);
 assert.equal(recoveryDownloads.length,0);
 const nextSession=await recoveryContext.newCDPSession(recoveryPage);await nextSession.send('Page.enable');
 const nextCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'recovery_next_token_123'));
 await nextSession.send(nextCommand.cmd,nextCommand.args);
 await recoveryPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:10000});
 await recoveryPage.waitForTimeout(100);
 assert.equal(recoveryDownloads.length,1);
 const recovered=await recoveryPage.evaluate(()=>({result:window.__CTI_LAST_RESULT,visits:JSON.parse(sessionStorage.getItem('fixture-visits'))}));
 assert.equal(recovered.result.meta.captureAccounting.complete,true);
 assert.equal(recovered.result.meta.checkpointResume.restored,40);
 assert.equal(recovered.visits.length,55);assert.equal(new Set(recovered.visits).size,55);
 await recoveryContext.close();
 const importContext=await browser.newContext({acceptDownloads:true});
 await importContext.route('https://www.coursera.org/**',fulfillFixture);
 const importPage=await importContext.newPage(),importDownloads=[];
 importPage.on('download',download=>importDownloads.push(download));importPage.on('pageerror',error=>errors.push(error.message));
 await importPage.goto(shell);
 const importSession=await importContext.newCDPSession(importPage);await importSession.send('Page.enable');
 const savedPartial={...downloaded,fingerprints:downloaded.fingerprints.slice(0,25)};
 const importCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'import_fixture_token_123',savedPartial));
 await importSession.send(importCommand.cmd,importCommand.args);
 await importPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:10000});
 await importPage.waitForTimeout(100);
 const imported=await importPage.evaluate(()=>({result:window.__CTI_LAST_RESULT,visits:JSON.parse(sessionStorage.getItem('fixture-visits'))}));
 assert.equal(importDownloads.length,1);assert.equal(imported.result.meta.captureAccounting.complete,true);
 assert.equal(imported.result.meta.automaticLocalCapture.seeded,true);
 assert.equal(imported.result.meta.savedCaptureResume,undefined,'Saved file is imported only in the initial document');
 assert.equal(imported.visits.length,30);assert.equal(new Set(imported.visits).size,30);
 assert(imported.visits.every(id=>Number(id.split('-')[1])>=25));
 for(let i=0;i<25;i++)assert.equal(imported.result.fingerprints[i].payload.textSample,downloaded.fingerprints[i].payload.textSample);
 await importContext.close();
 // Reproduce a recovery budget ending after every primary item was visited.
 // The real entry/controller must retain checkpoints and finish pending retries
 // in another document, rather than downloading and clearing the partial run.
 inventoryCount=3;
 const retryContext=await browser.newContext({acceptDownloads:true});
 await retryContext.route('https://www.coursera.org/**',fulfillFixture);
 const retryPage=await retryContext.newPage(),retryDownloads=[];
 retryPage.on('download',download=>retryDownloads.push(download));retryPage.on('pageerror',error=>errors.push(error.message));
 await retryPage.goto(shell);
 const retryProgram=fixtureProgram.replace(substitutes.recoverReadingRouteV61311,`async function recoverReadingRouteV61311(fp){
  const visits=JSON.parse(sessionStorage.getItem('fixture-visits') || '[]');
  const attempt=visits.filter(id=>id===fp.id).length+1;visits.push(fp.id);sessionStorage.setItem('fixture-visits',JSON.stringify(visits));
  const text='Observed learner content café 日本語 '+fp.id;
  if(attempt===1)return {attempted:true,captured:true,route:'fixture:'+fp.id,dwellMs:1,samples:3,
   evidence:{textSample:text,textConfidence:'medium',textEvidenceCompleteness:0.5,textScopeKind:'reading-content-field'}};
  if(!sessionStorage.getItem('fixture-recovery-budget-ended')){
   sessionStorage.setItem('fixture-recovery-budget-ended','true');const actualNow=Date.now.bind(Date);Date.now=()=>actualNow()+1300000;
  }
  return {attempted:true,captured:true,route:'fixture:'+fp.id,dwellMs:1,samples:3,
   evidence:{textSample:text,textConfidence:'high',textEvidenceCompleteness:1,textScopeKind:'reading-content-field',
    readingEditorEvidence:{itemId:fp.id},textCaptureEvidence:{method:'EXACT_READING_FIELD',scope:'EXACT_READING_FIELD',itemId:fp.id,observedCharacters:text.length,capturedCharacters:text.length}}};
 }`);
 const retrySession=await retryContext.newCDPSession(retryPage);await retrySession.send('Page.enable');
 const retryCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,retryProgram,'pending_retries_token_123'));
 await retrySession.send(retryCommand.cmd,retryCommand.args);
 await retryPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.batches===1,{},{timeout:10000});
 const pending=await retryPage.evaluate(()=>({accounting:window.__CTI_LAST_RESULT.meta.captureAccounting,
  controller:window.__CTI_LAST_RESULT.meta.automaticLocalCapture,retained:window.__CTI_LAST_RESULT.meta.checkpointRetainedForResume}));
 assert.equal(pending.accounting.unvisitedCount,0);assert.equal(pending.accounting.retryableUnresolvedCount,2);
 assert.equal(pending.controller.state,'RUNNING');assert.equal(pending.retained,true);assert.equal(retryDownloads.length,0);
 await retryPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:10000});
 if(!retryDownloads.length)await retryPage.waitForEvent('download',{timeout:10000});
 const retried=JSON.parse(fs.readFileSync(await retryDownloads[0].path(),'utf8'));
 assert.equal(retryDownloads.length,1);assert.equal(retried.meta.automaticLocalCapture.batches,2);
 assert.equal(retried.meta.captureAccounting.complete,true);assert.equal(retried.meta.captureAccounting.retryableUnresolvedCount,0);
 assert.equal(evaluateCourseraCapture(retried,courseId).complete,true);
 const retryVisits=await retryPage.evaluate(()=>JSON.parse(sessionStorage.getItem('fixture-visits')));
 assert.equal(retryVisits.length,6);assert(retryVisits.every(id=>retryVisits.filter(other=>other===id).length===2));
 await retryContext.close();
 // A fresh full-course run must ignore an interrupted run's real IndexedDB
 // records, retain them unchanged, and reset only once across all ten documents.
 inventoryCount=188;
 const freshContext=await browser.newContext({acceptDownloads:true});
 await freshContext.route('https://www.coursera.org/**',fulfillFixture);
 const freshPage=await freshContext.newPage(),freshDownloads=[];
 freshPage.on('download',download=>freshDownloads.push(download));freshPage.on('pageerror',error=>errors.push(error.message));
 await freshPage.goto(shell);
 const oldSession=await freshContext.newCDPSession(freshPage);await oldSession.send('Page.enable');
 const oldCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'old_partial_token_123'));
 await oldSession.send(oldCommand.cmd,oldCommand.args);
 await freshPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.batches===1,{},{timeout:10000});
 const oldRunId=await freshPage.evaluate(()=>window.__CTI_LAST_RESULT.meta.checkpoint.runId);
 await oldSession.detach();await freshPage.waitForEvent('domcontentloaded',{timeout:5000});
 const readRecords=async()=>freshPage.evaluate(async ({dbName,storeName})=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(dbName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  try{return await new Promise((resolve,reject)=>{const request=db.transaction(storeName,'readonly').objectStore(storeName).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}finally{db.close()}
 },{dbName:CTI_CHECKPOINT_DB,storeName:CTI_CHECKPOINT_STORE});
 const oldRecords=await readRecords();assert.equal(oldRecords.length,20);
 await freshPage.evaluate(()=>{localStorage.setItem('unrelated-app-setting','keep');sessionStorage.setItem('fixture-visits','[]')});
 await freshContext.addCookies([{name:'fixture-login',value:'keep',domain:'www.coursera.org',path:'/'}]);
 const freshSession=await freshContext.newCDPSession(freshPage);await freshSession.send('Page.enable');
 const freshCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'fresh_full_token_123',undefined,{freshRun:true}));
 await freshSession.send(freshCommand.cmd,freshCommand.args);
 await freshPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.batches===1,{},{timeout:10000});
 const freshFirst=await freshPage.evaluate(()=>window.__CTI_LAST_RESULT);
 assert.equal(freshFirst.meta.checkpointResume.restored,0);assert.equal(freshFirst.meta.automaticLocalCapture.captureMode,'FRESH_FULL_COURSE');
 assert.equal(freshFirst.meta.checkpoint.runId,'fresh-fresh_full_token_123');assert.notEqual(freshFirst.meta.checkpoint.runId,oldRunId);
 assert.equal(freshDownloads.length,0,'Fresh capture still has no intermediate download');
 const competingPage=await freshContext.newPage();await competingPage.goto(shell);
 const competingSession=await freshContext.newCDPSession(competingPage);await competingSession.send('Page.enable');
 const competing=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'competing_fresh_token_123',undefined,{freshRun:true}));
 await competingSession.send(competing.cmd,competing.args);
 assert.equal(await competingPage.evaluate(()=>JSON.parse(localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_competing_fresh_token_123')).reason),'ANOTHER_LOCAL_CAPTURE_RUNNING');
 assert.equal(await competingPage.evaluate(key=>JSON.parse(localStorage.getItem(key)).id,CTI_CHECKPOINT_SESSION_PREFIX+courseId),freshFirst.meta.checkpoint.runId);
 await competingSession.detach();await competingPage.close();
 await freshPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:90000});
 if(!freshDownloads.length)await freshPage.waitForEvent('download',{timeout:10000});
 const freshResult=JSON.parse(fs.readFileSync(await freshDownloads[0].path(),'utf8'));
 const freshVisits=await freshPage.evaluate(()=>JSON.parse(sessionStorage.getItem('fixture-visits')));
 assert.equal(freshDownloads.length,1);assert.equal(freshResult.meta.automaticLocalCapture.batches,10);
 assert.equal(freshResult.meta.checkpoint.runId,freshFirst.meta.checkpoint.runId,'Reloads keep this fresh run rather than restarting it');
 assert.equal(freshResult.meta.checkpointResume.restored,180);assert.equal(evaluateCourseraCapture(freshResult,courseId).complete,true);
 assert.equal(freshVisits.length,188);assert.equal(new Set(freshVisits).size,188);
 assert(freshResult.fingerprints.every(fp=>fp.payload.captureAttempts===1));
 assert.deepEqual(await readRecords(),oldRecords,'Earlier item snapshots remain untouched');
 assert.equal(await freshPage.evaluate(()=>localStorage.getItem('unrelated-app-setting')),'keep');
 assert((await freshContext.cookies()).some(cookie=>cookie.name==='fixture-login' && cookie.value==='keep'));
 // Run the entire course again in the same browser. A finished registration
 // remains inert; another fresh command gets another namespace and one JSON.
 await freshSession.detach();await freshPage.reload();
 await freshPage.evaluate(()=>sessionStorage.setItem('fixture-visits','[]'));
 const rerunSession=await freshContext.newCDPSession(freshPage);await rerunSession.send('Page.enable');
 const rerun=JSON.parse(createAutomaticLocalCourseraCommand(shell,fixtureProgram,'fresh_rerun_token_123',undefined,{freshRun:true}));
 await rerunSession.send(rerun.cmd,rerun.args);
 await freshPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.batches===1,{},{timeout:10000});
 assert.equal(await freshPage.evaluate(()=>window.__CTI_LAST_RESULT.meta.checkpointResume.restored),0);
 await freshPage.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:90000});
 if(freshDownloads.length<2)await freshPage.waitForEvent('download',{timeout:10000});
 const rerunResult=JSON.parse(fs.readFileSync(await freshDownloads[1].path(),'utf8'));
 assert.equal(freshDownloads.length,2);assert.equal(rerunResult.meta.automaticLocalCapture.batches,10);
 assert.equal(rerunResult.meta.checkpoint.runId,'fresh-fresh_rerun_token_123');
 assert.equal(evaluateCourseraCapture(rerunResult,courseId).complete,true);
 const rerunVisits=await freshPage.evaluate(()=>JSON.parse(sessionStorage.getItem('fixture-visits')));
 assert.equal(rerunVisits.length,188);assert.equal(new Set(rerunVisits).size,188);assert.deepEqual(await readRecords(),oldRecords);
 await freshContext.close();
 assert.deepEqual(errors,[]);
 console.log('Native Chrome debugger: 188 items / 10 automatic documents, one final lossless JSON, no repeat visits, course guard, checkpoint-failure stop and debugger-disconnect recovery, saved-file import, unavailable-inventory stop, recovery-budget continuation and two fresh full-course reruns with old checkpoints/cookies preserved and concurrent fresh capture blocked verified.');
}finally{await browser.close()}
