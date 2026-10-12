import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {chromium} from 'playwright';
import {courseraSource} from '../src/generated/extractor-sources.js';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {evaluateCourseraCapture,parseCourseraShellUrl} from '../src/domain/coursera-background-extraction.ts';
import {CTI_CHECKPOINT_DB,CTI_CHECKPOINT_STORE} from '../src/extractors/coursera/config.js';
import {assessmentBrowserFixture} from './assessment-browser-fixture.mjs';
import {fixtureCourseraAssessmentProgram} from './coursera-assessment-program-fixture.mjs';

const courseId='Supervised_course_fixture_123',shell=`https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const controllerOrigin='https://cti-hardening.pages.dev',token='native_supervisor_token_123';
const program=fixtureCourseraAssessmentProgram(courseraSource,shell);
const supervisorSource=stripTypeScriptTypes(fs.readFileSync('src/domain/coursera-local-supervisor.ts','utf8'))
 .replace(/^import[^\n]+\n/m,'').replace(/export /g,'');
const controllerCode=parseCourseraShellUrl.toString()+'\n'+supervisorSource+'\nconst CTISupervisor={startCourseraLocalSupervisor};';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-supervised-course-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
let loadedModel=false,severLink=false;
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
 const url=new URL(request.url,request.headers.host?.startsWith('cti-hardening')?controllerOrigin:'https://www.coursera.org');
 if(url.origin===controllerOrigin){
  response.setHeader('Content-Type','text/html');response.end(`<button id="open">Open managed Coursera</button><script>${controllerCode}</script><script>
   document.getElementById('open').onclick=()=>{window.child=window.open(${JSON.stringify(shell)},'cti-course');
    window.supervisor=CTISupervisor.startCourseraLocalSupervisor(window,child,${JSON.stringify(shell)},${JSON.stringify(token)},status=>{window.captureStatus=status;},{timeoutMs:7000,intervalMs:500});};
   </script>`);return;
 }
 if(severLink)response.setHeader('Cross-Origin-Opener-Policy','same-origin');
 if(url.pathname==='/assets/question-diagram.svg'){
  response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');return;
 }
 if(url.pathname.startsWith('/api/')){
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(url.pathname.includes('authoringCourseMaterials')?
   {elements:Array.from({length:168},(_,i)=>i===1?{id:'assessment-under-test',name:'Synthetic quiz',typeName:'staffGraded'}:
    {id:'reading-'+i,name:'Reading '+i,typeName:'supplement'})}:{}));return;
 }
 let html=assessmentBrowserFixture(100,true);
 if(loadedModel)html+=`<script>document.getElementById('editor').__reactProps$fixture={questions:Array.from({length:100},(_,i)=>({
  id:'assessment~q'+(i+1),questionType:'Multiple Choice',prompt:'Which result is correct for scenario '+(i+1)+' in this assessment?',
  options:[{text:'Correct choice café '+(i+1),correct:true},{text:'Other choice 日本語 '+(i+1),correct:false}],sourceMath:'<math><mi>α</mi></math>',unknownOriginal:{retained:true},
  ...(i===1?{diagram:'https://www.coursera.org/assets/question-diagram.svg'}:{})
 }))};</script>`;
 response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
async function checkpointAtLeast(cdp,n){
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){
  try{const query=async ({dbName,storeName,n})=>{
   if(!(await indexedDB.databases()).some(d=>d.name===dbName))return false;
   const db=await new Promise(resolve=>{const r=indexedDB.open(dbName);r.onsuccess=()=>resolve(r.result)});
   try{return await new Promise(resolve=>{const r=db.transaction(storeName).objectStore(storeName).getAll();r.onsuccess=()=>resolve(r.result.some(row=>Number(row.fingerprint?.payload?.assessmentCaptureInProgress?.assessment?.questionCount || 0)>=n))})}finally{db.close()}
  };
   // Playwright's Page stays marked crashed after a browser-controlled reload;
   // the retained CDP session can inspect the new renderer without recreating it.
   const result=await cdp.send('Runtime.evaluate',{expression:'('+query.toString()+')('+JSON.stringify({dbName:CTI_CHECKPOINT_DB,storeName:CTI_CHECKPOINT_STORE,n})+')',awaitPromise:true,returnByValue:true});
   if(result.result?.value===true)return;
  }catch(error){if(!/context was destroyed|Cannot find (?:default execution )?context|Target crashed|Inspected target navigated or closed/i.test(error.message))throw error;}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('No committed checkpoint at '+n+' questions');
}
try{
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}, MAP cti-hardening.pages.dev 127.0.0.1:${server.address().port}`]});
 for(const bulk of [false,true]){
  loadedModel=bulk;const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  const parent=await context.newPage();await parent.goto(controllerOrigin+'/controller');
  const opening=context.waitForEvent('page');await parent.click('#open');const child=await opening;await child.waitForLoadState();
  const downloads=[],errors=[];child.on('download',d=>downloads.push(d));child.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(child);await cdp.send('Page.enable');
  const browserSession=await browser.newBrowserCDPSession();await browserSession.send('Target.setDiscoverTargets',{discover:true});
  const info=await cdp.send('Target.getTargetInfo');
  const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,token,undefined,{controllerOrigin,freshRun:bulk}));
  await cdp.send(command.cmd,command.args);
  await parent.waitForFunction(()=>captureStatus?.state==='RUNNING',{},{timeout:15000});
  if(!bulk){
   for(const count of [31,70]){
    await checkpointAtLeast(cdp,count);
    const previous=await parent.evaluate(()=>captureStatus.recoveries);
    // Browser-level crash events remain observable after repeated renderer
    // crashes even though Playwright keeps its Page marked crashed.
    const crashed=new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{browserSession.off('Target.targetCrashed',onCrash);reject(Error('No browser-level crash event'));},10000);
     function onCrash(event){if(event.targetId!==info.targetInfo.targetId)return;clearTimeout(timer);browserSession.off('Target.targetCrashed',onCrash);resolve(event);}
     browserSession.on('Target.targetCrashed',onCrash);
    });cdp.send('Page.crash').catch(()=>{});await crashed;
    console.log('Real Coursera renderer crash after at least '+count+' questions; waiting for CTI tab recovery.');
    await parent.waitForFunction(previous=>captureStatus?.state==='RUNNING' && captureStatus.recoveries>previous,previous,{timeout:20000});
   }
  }
  await parent.waitForFunction(()=>captureStatus?.state==='FINISHED',{},{timeout:120000});
  assert.equal(downloads.length,1,'One final automatic JSON, without requested recovery exports or manual reinjection');
  const capture=JSON.parse(fs.readFileSync(await downloads[0].path(),'utf8'));
  const quiz=capture.fingerprints.find(fp=>fp.id==='assessment-under-test');
  assert.equal(capture.fingerprints.length,168);assert.equal(quiz.payload.structuredAssessment.questionCount,100);
  assert.equal(capture.meta.automaticLocalCapture.captureMode,bulk?'FRESH_FULL_COURSE':'RESUME_AVAILABLE_WORK');
  assert.equal(quiz.payload.captureAttempts,1);assert.equal(evaluateCourseraCapture(capture,courseId).complete,true);
  const status=await parent.evaluate(()=>captureStatus);assert.equal(status.recoveries,bulk?0:2);
  const questionRead=await cdp.send('Runtime.evaluate',{expression:"JSON.parse(localStorage.getItem('fixture-question-visits') || '[]')",returnByValue:true});
  const questions=questionRead.result.value;
  if(bulk){
   assert.equal(questions.length,0,'Loaded model still matches observed outline identities without opening each question');
   assert.equal(quiz.payload.loadedAssessmentEvidence.rawQuestionDefinitions.length,100);
   assert(quiz.payload.loadedAssessmentEvidence.rawQuestionDefinitions.every(q=>q.sourceMath==='<math><mi>α</mi></math>' && q.unknownOriginal.retained));
   assert(quiz.payload.images.includes('https://www.coursera.org/assets/question-diagram.svg'));
   assert(quiz.payload.assetDetails.some(asset=>asset.url==='https://www.coursera.org/assets/question-diagram.svg' && asset.sha256));
  }else{
   assert.equal(new Set(questions).size,99);assert(questions.length<=109,'Only uncommitted observations may be reread after two crashes');
   assert.equal(capture.meta.localCaptureBatch.maxQuestionObservations,5,'Later recovered documents retain the smaller renderer question budget');
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',courseItems:168,questions:100,mode:bulk?'loaded-data matched to live outline':'CTI-tab crash supervision',automaticRecoveries:status.recoveries,downloads:downloads.length,
   scope:'Synthetic external content; real canonical entry, IndexedDB, cross-origin controller, Chrome renderer crashes and retained debugger registration.'}));
  await browserSession.detach();await context.close();
 }
 // The registered guard reports login or unrelated navigation before the
 // supervisor can mistake it for a renderer failure and repeatedly reload it.
 loadedModel=false;const loginContext=await browser.newContext({ignoreHTTPSErrors:true});
 const loginParent=await loginContext.newPage();await loginParent.goto(controllerOrigin+'/controller');
 const loginOpening=loginContext.waitForEvent('page');await loginParent.click('#open');const loginChild=await loginOpening;await loginChild.waitForLoadState();
 const loginSession=await loginContext.newCDPSession(loginChild);
 await loginSession.send('Page.enable');
 const loginCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,token,undefined,{controllerOrigin}));
 await loginSession.send(loginCommand.cmd,loginCommand.args);
 await loginParent.waitForFunction(()=>captureStatus?.state==='RUNNING',{},{timeout:15000});
 await loginSession.send('Page.navigate',{url:'https://www.coursera.org/login'});
 await loginParent.waitForFunction(()=>captureStatus?.state==='STOPPED' && captureStatus.message.includes('left the selected authoring course'),{},{timeout:15000});
 assert.equal((await loginParent.evaluate(()=>captureStatus)).recoveries,0);
 console.log('PASS: login/outside-course navigation pauses recovery without sending authentication data.');
 await loginContext.close();
 // A server policy which severs window.opener must never start an allegedly
 // supervised acquisition or silently downgrade its guarantees.
 severLink=true;loadedModel=false;const context=await browser.newContext({ignoreHTTPSErrors:true});
 const parent=await context.newPage();await parent.goto(controllerOrigin+'/controller');
 const opening=context.waitForEvent('page');await parent.click('#open');const child=await opening;await child.waitForLoadState();
 await parent.waitForFunction(()=>captureStatus?.state==='STOPPED',{},{timeout:10000});
 const cdp=await context.newCDPSession(child);const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,'blocked_supervisor_token_123',undefined,{controllerOrigin}));
 await cdp.send(command.cmd,command.args);await child.waitForFunction(()=>localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_blocked_supervisor_token_123')?.includes('LOCAL_SUPERVISOR_LINK_UNAVAILABLE'),{},{timeout:15000});
 assert.equal(await child.evaluate(()=>localStorage.getItem('fixture-reading-visits')),null);
 console.log('PASS: browser opener-isolation policy stops supervision before editor visits; no security header is bypassed.');
 await context.close();
}catch(error){
 // Public check annotations expose fixture failures even when Actions logs
 // require an authenticated GitHub session. No real course content is used.
 const diagnostic=String(error.stack || error).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
 console.error('::error title=Managed capture native check::'+diagnostic);throw error;
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
