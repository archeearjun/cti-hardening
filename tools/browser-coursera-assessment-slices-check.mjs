import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {courseraSource} from '../src/generated/extractor-sources.js';
import {createAutomaticLocalCourseraCommand,createSavedCourseraCheckpointExportCommand} from '../src/domain/coursera-local-extraction.ts';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';
import {CTI_CHECKPOINT_DB,CTI_CHECKPOINT_STORE,CTI_CHECKPOINT_SESSION_PREFIX} from '../src/extractors/coursera/config.js';
import {extractorFunctions} from './extractor-functions.cjs';
import {assessmentBrowserFixture} from './assessment-browser-fixture.mjs';

// Real canonical entry, question DOM, checkpoints, renderer/controller and final
// export. Only external editor routing and simulated loading delays are replaced.
const courseId='Long_assessment_fixture_123',shell=`https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const functions=extractorFunctions(courseraSource);
let program=courseraSource;
const substitutes={
 sleepMs:`async function sleepMs(ms){
  if(ms===350){await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}
  else await new Promise(resolve=>setTimeout(resolve,1));
 }`,
 readingRouteTemplateV61312:'function readingRouteTemplateV61312(){return {fixture:true}}',
 readingRouteForTargetV61311:'function readingRouteForTargetV61311(fp){return "fixture:"+fp.id}',
 recoverTypedEditorV61317:'async function recoverTypedEditorV61317(){return {attempted:false,captured:false,reason:"EXTERNAL_FIXTURE"}}',
 returnToOutlineV6142:`async function returnToOutlineV6142(){history.replaceState(null,'',${JSON.stringify(shell)});document.getElementById('editor').style.display='none'}`,
 hydrateOutlineSurfaceForCrawl:'async function hydrateOutlineSurfaceForCrawl(){return {fixture:true}}',
 crawlTargetPriority:'function crawlTargetPriority(){return 1}',
 interleaveCrawlTargetsV61313:'function interleaveCrawlTargetsV61313(targets){return targets}',
 findNavigationTargetForFingerprint:`async function findNavigationTargetForFingerprint(fp){if(fp.id!=='assessment-under-test')return null;return {element:document.getElementById('open-assessment'),score:1,reason:'visible-attribute-id',text:fp.name}}`,
 editorControlCandidates:`function editorControlCandidates(){return [{element:document.getElementById('open-assessment'),label:'Open assessment',tag:'button',score:1}]}`,
 dispatchReadOnlyEditorControl:`function dispatchReadOnlyEditorControl(control){control.element.click();history.replaceState(null,'',${JSON.stringify(shell + '/assessment/assessment-under-test')});return {attempted:true,mode:'history-popstate'}}`,
 findOpenedEditorSurface:`function findOpenedEditorSurface(){return {root:document.getElementById('editor'),score:1}}`,
 findCurrentEditorSurface:`function findCurrentEditorSurface(){return {root:document.getElementById('editor'),score:1}}`,
 waitForItemEvidenceStability:`async function waitForItemEvidenceStability(){return {surface:{root:document.getElementById('editor'),score:1},dwellMs:1,samples:3,evidenceChanges:0,timedOut:false}}`,
 recoverReadingRouteV61311:`async function recoverReadingRouteV61311(fp){
  const visits=JSON.parse(localStorage.getItem('fixture-reading-visits') || '[]');visits.push(fp.id);localStorage.setItem('fixture-reading-visits',JSON.stringify(visits));
  const text='Observed learner text café 日本語 '+fp.id;
  return {attempted:true,captured:true,route:'fixture:'+fp.id,dwellMs:1,samples:3,evidence:{textSample:text,textConfidence:'high',textEvidenceCompleteness:1,
    readingEditorEvidence:{itemId:fp.id},textCaptureEvidence:{method:'EXACT_READING_FIELD',scope:'EXACT_READING_FIELD',itemId:fp.id,observedCharacters:text.length,capturedCharacters:text.length}}};}`,
};
for(const [name,replacement] of Object.entries(substitutes)){
 const original=functions.get(name);assert(original,`Missing external boundary ${name}`);program=program.replace(original,replacement);
}
// Serve a local HTTPS origin with the real Coursera hostname. Network
// interception has pending request IDs that become invalid after Page.crash;
// an actual server lets Chromium recover without changing the app/storage.
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-assessment-crash-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
 const url=new URL(request.url,'https://www.coursera.org');
 if(url.pathname.startsWith('/api/')){
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(url.pathname.includes('authoringCourseMaterials')?
   {elements:Array.from({length:165},(_,i)=>i===17?{id:'assessment-under-test',name:'Synthetic long assessment',typeName:'staffGraded'}:
    {id:'reading-'+i,name:'Reading '+i,typeName:'supplement'})}:{}));
 }else{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(assessmentBrowserFixture(609,true));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}`]});
 const context=await browser.newContext({acceptDownloads:true,ignoreHTTPSErrors:true});
 let page=await context.newPage();const downloads=[],errors=[];
 function observePage(current){current.on('download',d=>downloads.push(d));current.on('pageerror',e=>errors.push(e.message));current.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log('Fixture browser '+m.type()+': '+m.text());});}
 observePage(page);
 await page.goto(shell);
 console.log('165-item / 609-question native fixture loaded.');
 const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
 const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,'long_assessment_token_123',undefined,{freshRun:true}));
 const registration=await cdp.send(command.cmd,command.args);
 console.log('Canonical automatic command registered. Waiting for durable question checkpoint.');
 const recordKey='fresh-long_assessment_token_123|'+courseId+'|assessment-under-test';
 // Read the actual IndexedDB checkpoint, then crash the renderer mid-visit.
 // Await the IndexedDB result explicitly in Node. waitForFunction treats an
 // async predicate's Promise as truthy before the database request resolves.
 const checkpointDeadline=Date.now()+60000;let checkpointReady=false;
 while(!checkpointReady){
  assert(Date.now()<checkpointDeadline,'No durable long-assessment checkpoint within 60 seconds');
  try{checkpointReady=await page.evaluate(async ({dbName,storeName,key})=>{
   if(!(await indexedDB.databases()).some(db=>db.name===dbName))return false;
   const db=await new Promise(resolve=>{const r=indexedDB.open(dbName);r.onsuccess=()=>resolve(r.result)});
   try{if(!db.objectStoreNames.contains(storeName))return false;
    return await new Promise(resolve=>{const r=db.transaction(storeName).objectStore(storeName).get(key);r.onsuccess=()=>resolve(Number(r.result?.fingerprint?.payload?.assessmentCaptureInProgress?.assessment?.questionCount || 0)>=31)})}finally{db.close()}
  },{dbName:CTI_CHECKPOINT_DB,storeName:CTI_CHECKPOINT_STORE,key:recordKey})}catch(error){
   if(!/context was destroyed|Cannot find context/i.test(error.message))throw error;
  }
  if(!checkpointReady)await page.waitForTimeout(50);
 }
 console.log('Durable in-progress checkpoint observed; triggering Page.crash.');
 // The operator must re-register after a crash/closed DevTools. Remove the
 // original registration before crashing so recovery opens a quiet shell.
 await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:registration.identifier});
 const crashed=page.waitForEvent('crash',{timeout:10000});cdp.send('Page.crash').catch(()=>{});await crashed;
 console.log('Chrome emitted the renderer crash event.');
 // Playwright declares a crashed page unusable. Reopen in the same browser
 // profile, retaining actual localStorage/IndexedDB instead of reseeding them.
 console.log('Reopening the course in the same browser profile after the crash.');
 await page.close();page=await context.newPage();observePage(page);await page.goto(shell);
 console.log('Synthetic 165-item course: actual renderer crash delivered; restoring browser checkpoints.');
 assert.equal(downloads.length,0,'Renderer crash did not produce a misleading final file');
 const before=await page.evaluate(async ({dbName,storeName,sessionKey})=>{
  const pointer=JSON.parse(localStorage.getItem(sessionKey));pointer.createdAt=Date.now()-13*60*60*1000;localStorage.setItem(sessionKey,JSON.stringify(pointer));
  const db=await new Promise(resolve=>{const r=indexedDB.open(dbName);r.onsuccess=()=>resolve(r.result)});
  const records=await new Promise(resolve=>{const r=db.transaction(storeName).objectStore(storeName).getAll();r.onsuccess=()=>resolve(r.result)});db.close();
  return {records,pointer:localStorage.getItem(sessionKey),visits:localStorage.getItem('fixture-question-visits')};
 },{dbName:CTI_CHECKPOINT_DB,storeName:CTI_CHECKPOINT_STORE,sessionKey:CTI_CHECKPOINT_SESSION_PREFIX+courseId});
 const recoverySession=await context.newCDPSession(page);
 const exportCommand=JSON.parse(createSavedCourseraCheckpointExportCommand(shell,program));
 let recoveryTimer;
 try{const evaluation=await Promise.race([recoverySession.send(exportCommand.cmd,exportCommand.args),new Promise((_,reject)=>{recoveryTimer=setTimeout(()=>reject(Error('Saved-progress command did not finish within 30 seconds')),30000)})]);
  assert.equal(evaluation.exceptionDetails,undefined,JSON.stringify(evaluation.exceptionDetails));}
 finally{clearTimeout(recoveryTimer)}
 if(!downloads.length)await page.waitForEvent('download',{timeout:10000});
 const recovered=JSON.parse(fs.readFileSync(await downloads[0].path(),'utf8'));
 const partial=recovered.fingerprints.find(fp=>fp.id==='assessment-under-test');
 assert.equal(recovered.fingerprints.length,165);assert.equal(recovered.meta.savedProgressExport.liveEditorVisits,0);
 assert(partial.payload.assessmentCaptureInProgress.assessment.questionCount>=31);assert.equal(partial.payload.captureAttempts,0);
 assert.equal(evaluateCourseraCapture(recovered,courseId).complete,false);
 const after=await page.evaluate(async ({dbName,storeName,sessionKey})=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open(dbName);r.onsuccess=()=>resolve(r.result)});
  const records=await new Promise(resolve=>{const r=db.transaction(storeName).objectStore(storeName).getAll();r.onsuccess=()=>resolve(r.result)});db.close();
  return {records,pointer:localStorage.getItem(sessionKey),visits:localStorage.getItem('fixture-question-visits')};
 },{dbName:CTI_CHECKPOINT_DB,storeName:CTI_CHECKPOINT_STORE,sessionKey:CTI_CHECKPOINT_SESSION_PREFIX+courseId});
 assert.deepEqual(after,before,'Recovery reads even expired checkpoints without writes or question clicks');
 console.log('Read-only saved-progress export recovered '+partial.payload.assessmentCaptureInProgress.assessment.questionCount+' questions; checkpoint records and editor visits unchanged.');
 await page.reload();
 // A newly opened tab must respect the unchanged 45-second duplicate-tab
 // liveness guard before taking over a crashed tab's automatic plan.
 await page.waitForFunction(course=>{
  const token=localStorage.getItem('__CTI_AUTOMATIC_LOCAL_ACTIVE_V61517_'+course);
  const plan=JSON.parse(localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_'+token) || 'null');
  return !plan || Date.now()-Number(plan.updatedAt || plan.startedAt || 0)>=45000;
 },courseId,{timeout:50000});
 // Resume from the recovered JSON; no stale session TTL is bypassed by capture.
 const resumedSession=await context.newCDPSession(page);await resumedSession.send('Page.enable');
 const resume=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,'long_assessment_resume_123',recovered));
 await resumedSession.send(resume.cmd,resume.args);
 console.log('Resuming the 609-question assessment through the actual automatic controller.');
 const finalDeadline=Date.now()+180000;let finished=false,lastProgress='';
 while(!finished){
  assert(Date.now()<finalDeadline,'Automatic assessment resume did not finish within 180 seconds');
  try{const progress=await page.evaluate(()=>({finished:window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',
   plan:localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_long_assessment_resume_123')}));
   finished=progress.finished;const plan=JSON.parse(progress.plan || 'null');
   if(plan?.lastProgress && plan.lastProgress!==lastProgress){lastProgress=plan.lastProgress;console.log('Automatic batch '+plan.batches+': '+plan.lastProgress);}
  }catch(error){if(!/context was destroyed|Cannot find context/i.test(error.message))throw error;}
  if(!finished)await page.waitForTimeout(100);
 }
 if(downloads.length<2)await page.waitForEvent('download',{timeout:10000});
 const final=JSON.parse(fs.readFileSync(await downloads[1].path(),'utf8'));
 const assignment=final.fingerprints.find(fp=>fp.id==='assessment-under-test');
 console.log(JSON.stringify({finalController:final.meta.automaticLocalCapture,questionCount:assignment.payload.structuredAssessment?.questionCount,
  captureAttempts:assignment.payload.captureAttempts,contract:assignment.payload.captureContract,
  coverage:assignment.payload.structuredAssessment?.captureCompleteness},null,2));
 assert.equal(downloads.length,2,'One requested recovery export and one automatic final capture');
 assert.equal(final.fingerprints.length,165);assert.equal(assignment.payload.structuredAssessment.questionCount,609);
 assert(assignment.payload.structuredAssessment.questions.every((q,i)=>q.courseraQuestionId==='assessment~q'+(i+1) &&
  q.options.some(o=>o.text.includes('café')) && q.options.some(o=>o.text.includes('日本語'))));
 assert.equal(assignment.payload.captureAttempts,1,'Planned question pauses do not consume editor attempts');
 assert.equal(assignment.payload.assessmentCaptureInProgress,undefined);
 assert.equal(evaluateCourseraCapture(final,courseId).complete,true);
 assert(final.meta.automaticLocalCapture.batches>20,'A large assessment continues across more than three progress-only documents');
 const visits=await page.evaluate(()=>({readings:JSON.parse(localStorage.getItem('fixture-reading-visits')),questions:JSON.parse(localStorage.getItem('fixture-question-visits'))}));
 assert.equal(visits.readings.length,164);assert.equal(new Set(visits.readings).size,164);
 assert.equal(new Set(visits.questions).size,608);
 const savedOrdinals=new Set(partial.payload.assessmentCaptureInProgress.assessment.questions.map(q=>Number(q.id)));
 const beforeClicks=JSON.parse(before.visits || '[]'),unsavedClicks=beforeClicks.filter(n=>!savedOrdinals.has(n));
 const frequencies=new Map();for(const n of visits.questions)frequencies.set(n,(frequencies.get(n)||0)+1);
 for(const n of savedOrdinals)if(n!==1)assert.equal(frequencies.get(n),1,'Durably saved question '+n+' must not be clicked again');
 assert(visits.questions.length>=608 && visits.questions.length<=608+unsavedClicks.length,
  'Only observations not yet checkpointed when Chrome crashes may be revisited');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',inventory:165,assessmentQuestions:609,batches:final.meta.automaticLocalCapture.batches,
  recoveredQuestions:partial.payload.assessmentCaptureInProgress.assessment.questionCount,checks:['real renderer crash via Page.crash','read-only recovery of expired checkpoints',
   'zero editor visits during saved-progress export','bounded in-assessment continuation','one completed editor attempt','no repeated durable reading or question visits','one final automatic JSON','strict gate and Unicode preservation'],scope:'Synthetic external course observations; real canonical entry/DOM/IndexedDB/Chrome crash/controller/export.'},null,2));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
