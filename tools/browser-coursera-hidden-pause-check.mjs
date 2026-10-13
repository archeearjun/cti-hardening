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
import {fixtureCourseraAssessmentProgram} from './coursera-assessment-program-fixture.mjs';

// The browser clock and visibility are fixture inputs. The canonical entry,
// waitForVisible, renderer pause credit, automatic decisions, IndexedDB, verified
// controller link and final JSON execute normally. Existing fixture substitutions
// cover external reading/editor navigation; no capture result or limit is replaced.
const courseId='Hidden_pause_course_fixture_123';
const shell=`https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const controllerOrigin='https://cti-hardening.pages.dev',token='hidden_pause_fixture_token_123';
const hiddenMilliseconds=5*60*60*1000,previousActiveMilliseconds=3.5*60*60*1000;
const planKey='__CTI_AUTOMATIC_LOCAL_V61517_'+token;
const program=fixtureCourseraAssessmentProgram(courseraSource,shell);
const supervisorSource=stripTypeScriptTypes(fs.readFileSync('src/domain/coursera-local-supervisor.ts','utf8'))
 .replace(/^import[^\n]+\n/m,'').replace(/export /g,'');
const controllerCode=parseCourseraShellUrl.toString()+'\n'+supervisorSource+'\nconst CTISupervisor={startCourseraLocalSupervisor};';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-hidden-pause-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
 const url=new URL(request.url,request.headers.host?.startsWith('cti-hardening')?controllerOrigin:'https://www.coursera.org');
 if(url.origin===controllerOrigin){
  response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<button id="open">Open managed Coursera</button><script>${controllerCode}</script><script>
   document.getElementById('open').onclick=()=>{window.child=window.open(${JSON.stringify(shell)},'cti-hidden-pause');
    window.supervisor=CTISupervisor.startCourseraLocalSupervisor(window,child,${JSON.stringify(shell)},${JSON.stringify(token)},status=>{window.captureStatus=status;},{timeoutMs:40000,reconnectTimeoutMs:40000,intervalMs:500});};
  </script>`);return;
 }
 if(url.pathname.startsWith('/api/')){
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(url.pathname.includes('authoringCourseMaterials')?
   {elements:Array.from({length:25},(_,i)=>({id:'reading-'+i,name:'Synthetic reading '+i,typeName:'supplement'}))}:{}));return;
 }
 response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><main id="editor" style="display:none"></main>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}, MAP cti-hardening.pages.dev 127.0.0.1:${server.address().port}`]});
 const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
 await context.addInitScript(({courseId,token,planKey,previousActiveMilliseconds})=>{
  if(location.origin!=='https://www.coursera.org')return;
  const NativeDate=Date,nativeSet=Storage.prototype.setItem,nativeGet=Storage.prototype.getItem;
  const offset=()=>Number(nativeGet.call(localStorage,'fixture-clock-offset')||0);
  class FixtureDate extends NativeDate {
   constructor(...args){super(...(args.length?args:[NativeDate.now()+offset()]));}
   static now(){return NativeDate.now()+offset();}
  }
  window.Date=FixtureDate;
  window.fixtureHidden=false;window.fixturePauseListening=false;
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>fixtureHidden?'hidden':'visible'});
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>fixtureHidden});
  const nativeAdd=document.addEventListener.bind(document);
  document.addEventListener=function(type,listener,options){
   nativeAdd(type,listener,options);
   if(type==='visibilitychange'&&fixtureHidden)window.fixturePauseListening=true;
  };
  if(!nativeGet.call(localStorage,'fixture-original-started-at')){
   const startedAt=Date.now()-previousActiveMilliseconds;
   nativeSet.call(localStorage,'fixture-original-started-at',String(startedAt));
   nativeSet.call(localStorage,planKey,JSON.stringify({state:'RUNNING',token,courseId,startedAt,batches:0,stalled:0,
    captureMode:'FRESH_FULL_COURSE',checkpointRunId:'fresh-'+token}));
  }
  Storage.prototype.setItem=function(key,value){
   const result=nativeSet.call(this,key,value);
   if(this!==localStorage)return result;
   if(key==='fixture-reading-visits'&&!nativeGet.call(localStorage,'fixture-hidden-once')){
    nativeSet.call(localStorage,'fixture-hidden-once','1');window.fixtureHidden=true;
    document.dispatchEvent(new Event('visibilitychange'));
   }
   if(key===planKey&&!nativeGet.call(localStorage,'fixture-first-batch')){
    const plan=JSON.parse(value);
    if(plan.batches===1){
     const renderer=window.__CTI_LOCAL_CAPTURE_RENDERER_SESSION__;
     nativeSet.call(localStorage,'fixture-first-batch',JSON.stringify({plan,renderer,observedNow:Date.now(),
      readingVisits:JSON.parse(nativeGet.call(localStorage,'fixture-reading-visits')||'[]')}));
    }
   }
   return result;
  };
 },{courseId,token,planKey,previousActiveMilliseconds});
 const parent=await context.newPage();await parent.goto(controllerOrigin+'/controller');
 const controllerStarted=await parent.evaluate(()=>Date.now());
 const opening=context.waitForEvent('page');await parent.click('#open');const child=await opening;await child.waitForLoadState();
 const downloads=[],errors=[];child.on('download',download=>downloads.push(download));child.on('pageerror',error=>errors.push(error.message));
 const cdp=await context.newCDPSession(child);await cdp.send('Page.enable');
 const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,token,undefined,{controllerOrigin,freshRun:true}));
 await cdp.send(command.cmd,command.args);
 await parent.waitForFunction(()=>captureStatus?.state==='RUNNING',{},{timeout:15000});
 await child.waitForFunction(()=>fixturePauseListening&&document.visibilityState==='hidden',{},{timeout:30000});
 const beforePause=await child.evaluate(({planKey})=>({original:Number(localStorage.getItem('fixture-original-started-at')),
  plan:JSON.parse(localStorage.getItem(planKey)),renderer:{...window.__CTI_LOCAL_CAPTURE_RENDERER_SESSION__},visits:JSON.parse(localStorage.getItem('fixture-reading-visits'))}),{planKey});
 assert.equal(beforePause.plan.startedAt,beforePause.original);assert.equal(beforePause.renderer.visits,1);assert.equal(downloads.length,0);
 assert.equal(beforePause.renderer.visibilityPausedMs,0,'No direct pause state is injected before the observed visibility wait');
 await child.evaluate(hiddenMilliseconds=>{
  localStorage.setItem('fixture-clock-offset',String(hiddenMilliseconds));
  window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));
 },hiddenMilliseconds);
 await child.waitForFunction(()=>localStorage.getItem('fixture-first-batch'),{},{timeout:30000});
 const firstBatch=await child.evaluate(()=>JSON.parse(localStorage.getItem('fixture-first-batch')));
 assert.equal(firstBatch.plan.state,'RUNNING','Hidden time incorrectly exhausted the automatic capture run limit');
 assert.equal(firstBatch.plan.startedAt,beforePause.original,'An observed pause reset the original course-run start');
 assert.equal(firstBatch.renderer.visits,6,'A hidden wait prematurely exhausted the managed renderer visit allowance');
 assert(firstBatch.renderer.visibilityPausedMs>=hiddenMilliseconds);
 const firstWall=firstBatch.observedNow-firstBatch.renderer.startedAt,firstActive=firstWall-firstBatch.renderer.visibilityPausedMs;
 assert(firstWall>=hiddenMilliseconds);assert(firstActive>=0&&firstActive<5*60*1000);
 assert.equal(firstBatch.readingVisits.length,6);assert.equal(downloads.length,0,'An intermediate renderer batch downloaded a partial JSON');
 await parent.waitForFunction(()=>captureStatus?.state==='FINISHED',{},{timeout:60000});
 assert.equal(downloads.length,1,'The run must produce one final JSON after all renderer batches');
 const capture=JSON.parse(fs.readFileSync(await downloads[0].path(),'utf8'));
 const plan=capture.meta.automaticLocalCapture;
 assert.equal(capture.fingerprints.length,25);assert.equal(evaluateCourseraCapture(capture,courseId).complete,true);
 assert.equal(plan.reason,'INVENTORY_FINISHED');assert.equal(plan.startedAt,beforePause.original);
 assert.equal(plan.batches,5);assert(plan.visibilityPausedMs>=hiddenMilliseconds&&plan.visibilityPausedMs<hiddenMilliseconds+10000);
 assert(plan.wallElapsedMs>8*60*60*1000);assert(plan.activeElapsedMs>=previousActiveMilliseconds&&plan.activeElapsedMs<8*60*60*1000);
 assert.equal((await parent.evaluate(()=>captureStatus)).recoveries,0,'The verified controller link must survive the simulated hidden wait');
 const controllerElapsed=(await parent.evaluate(()=>Date.now()))-controllerStarted;
 assert(controllerElapsed>=0&&controllerElapsed<60000,'The fixture changed the CTI controller clock');
 const readingVisits=await child.evaluate(()=>JSON.parse(localStorage.getItem('fixture-reading-visits')||'[]'));
 assert.equal(readingVisits.length,25);assert.equal(new Set(readingVisits).size,25,'A completed reading reopened after a managed renderer yield');
 for(const fp of capture.fingerprints)assert(fp.payload.textSample.includes('Observed learner text café 日本語 '+fp.id),'Original observed reading text changed during hidden continuation');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',items:25,batches:5,downloads:1,hiddenHours:5,duplicateCompletedEditorVisits:0,
  wallHours:plan.wallElapsedMs/3600000,activeHours:plan.activeElapsedMs/3600000,supervisorRecoveries:0,
  scope:'Synthetic readings, coherent Coursera-only clock and visibility inputs; actual canonical pause wait, renderer guards, automatic accounting, durable reload and verified CTI supervisor.'}));
 await context.close();
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
