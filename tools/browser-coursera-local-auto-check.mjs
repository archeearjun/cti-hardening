import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {courseraSource} from '../src/generated/extractor-sources.js';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';
import {extractorFunctions} from './extractor-functions.cjs';

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
 assert.deepEqual(errors,[]);
 console.log('Native Chrome debugger: 188 items / 10 automatic documents, one final lossless JSON, no repeat visits, course guard, checkpoint-failure stop and debugger-disconnect recovery, saved-file import and unavailable-inventory stop verified.');
}finally{await browser.close()}
