import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {chromium} from 'playwright';
import {bundleConsole} from './console-bundle.mjs';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {evaluateCourseraCapture,parseCourseraShellUrl} from '../src/domain/coursera-background-extraction.ts';

// Real canonical extractor, native IndexedDB and cross-origin controller.
// Only external Coursera pages/material responses are synthetic. Four genuine
// renderer crashes must retain individually committed reading progress, even
// though no planned batch boundary has yet published an aggregate receipt.
const source=bundleConsole(path.resolve('src/extractors/coursera/entry.js'));
const controllerOrigin='https://cti-hardening.pages.dev';
const supervisorSource=stripTypeScriptTypes(fs.readFileSync('src/domain/coursera-local-supervisor.ts','utf8'))
 .replace(/^import[^\n]+\n/m,'').replace(/export /g,'');
const controllerCode=parseCourseraShellUrl.toString()+'\n'+supervisorSource;
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-reading-recovery-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const cases=new Map();
function fixture(state){
 return '<!doctype html><meta charset="utf-8"><title>Synthetic reading recovery</title><style>main{padding:12px;font:16px Arial}[aria-label="Reading Content"]{min-height:520px;width:800px;white-space:pre-wrap}.item{min-height:75px}</style><div id="app"></div><script>('+pageFixture.toString()+')('+JSON.stringify({courseId:state.courseId,materials:state.materials,hold:state.hold})+');</script>';
}
function pageFixture({courseId,materials,hold}){
 const app=document.getElementById('app'),key='reading-mounts-'+courseId;
 function render(){
  const id=location.pathname.match(/\/content\/item\/supplement\/([^/]+)$/)?.[1];
  if(id){
   const mounts=JSON.parse(sessionStorage.getItem(key)||'[]');mounts.push({id,at:Date.now()});sessionStorage.setItem(key,JSON.stringify(mounts));
   app.innerHTML='<main><h1>Reading '+id+'</h1><div role="textbox" contenteditable="true" aria-label="Reading Content" data-testid="'+courseId+'+'+id+'"></div></main>';
   const body=document.querySelector('[aria-label="Reading Content"]');
   body.textContent=hold?'Loading…':'Complete observed reading '+id+'. café 日本語 ∑x². '+('Retain this observed synthetic course content. ').repeat(120);
   if(hold)body.setAttribute('aria-busy','true');
  }else{
   app.innerHTML='<main id="course-outline"><h1>Course content</h1></main>';
   for(const material of materials){
    const row=document.createElement('div');row.className='item';row.dataset.itemId=material.id;
    const anchor=document.createElement('a');anchor.dataset.itemId=material.id;anchor.textContent=material.name;
    anchor.href='/teach/synthetic/'+courseId+'/content/item/supplement/'+material.id;
    anchor.onclick=event=>{event.preventDefault();history.replaceState(history.state,'',anchor.href);render();};
    row.append(anchor);document.getElementById('course-outline').append(row);
   }
  }
 }
 window.addEventListener('popstate',render);render();window.readingFixtureReady=true;
}
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
 const url=new URL(request.url,request.headers.host?.startsWith('cti-hardening')?controllerOrigin:'https://www.coursera.org');
 const state=[...cases.values()].find(row=>url.pathname.includes('/'+row.courseId+'/')||url.pathname.endsWith('/'+row.courseId)||String(request.headers.referer||'').includes('/'+row.courseId+'/'));
 if(url.origin===controllerOrigin){
  const chosen=cases.get(url.searchParams.get('course'));
  if(!chosen){response.writeHead(404);response.end('Unknown fixture controller');return;}
  response.setHeader('Content-Type','text/html');response.end('<button id="open">Open managed Coursera</button><script>'+controllerCode+'</script><script>document.getElementById("open").onclick=()=>{window.receipts=[];window.child=window.open('+JSON.stringify(chosen.shell)+',"reading-course");window.supervisor=startCourseraLocalSupervisor(window,child,'+JSON.stringify(chosen.shell)+','+JSON.stringify(chosen.token)+',status=>{window.captureStatus=status;receipts.push({...status})},{timeoutMs:7000,reconnectTimeoutMs:7000,intervalMs:100})};</script>');return;
 }
 if(!state){response.writeHead(404);response.end('Unknown fixture course');return;}
 if(url.pathname.startsWith('/api/')){
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(url.pathname.includes('authoringCourseMaterials.v1')?{elements:state.materials}:{}));return;
 }
 response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixture(state));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 // Match the other managed crash fixtures: full Chromium isolates the
 // cross-origin controller when Page.crash deliberately kills Coursera.
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}, MAP cti-hardening.pages.dev 127.0.0.1:${server.address().port}`]});
 for(const stalled of [false,true]){
  const courseId=stalled?'Reading_stalled_course_123':'Reading_progress_course_123',shell='https://www.coursera.org/teach/synthetic/'+courseId+'/content/edit';
  const state={courseId,shell,token:'reading_recovery_'+(stalled?'stalled':'progress')+'_123',hold:false,
   materials:Array.from({length:9},(_,i)=>({id:'reading-'+i,name:'Reading reading-'+i,typeName:'supplement'}))};cases.set(courseId,state);
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  const parent=await context.newPage();await parent.goto(controllerOrigin+'/controller?course='+courseId);
  const opening=context.waitForEvent('page');await parent.click('#open');const child=await opening;await child.waitForLoadState();
  const downloads=[],errors=[];child.on('download',download=>downloads.push(download));child.on('pageerror',error=>errors.push(error.message));
  const cdp=await context.newCDPSession(child);await cdp.send('Page.enable');
  const browserSession=await browser.newBrowserCDPSession();await browserSession.send('Target.setDiscoverTargets',{discover:true});
  const target=(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
  const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,source,state.token,undefined,{controllerOrigin,freshRun:true}));
  await cdp.send(command.cmd,command.args);
  const committedMounts=new Map();
  async function evaluate(expression){return (await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result?.value;}
  async function crash(){
   const occurred=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{browserSession.off('Target.targetCrashed',listener);reject(Error('No real renderer crash event'));},10000);
    function listener(event){if(event.targetId!==target)return;clearTimeout(timer);browserSession.off('Target.targetCrashed',listener);resolve(event);}
    browserSession.on('Target.targetCrashed',listener);
   });cdp.send('Page.crash').catch(()=>{});await occurred;
  }
  for(let index=0;index<4;index++){
   const wanted=stalled?1:index+1;
   await parent.waitForFunction(({wanted,recoveries})=>captureStatus?.state==='RUNNING'&&captureStatus.completeItems>=wanted&&captureStatus.recoveries===recoveries,{wanted,recoveries:index},{timeout:30000});
   const before=await parent.evaluate(()=>captureStatus);assert.equal(before.failuresWithoutProgress,stalled?index:0);
   if(!stalled){
    const mounts=await evaluate('JSON.parse(sessionStorage.getItem('+JSON.stringify('reading-mounts-'+courseId)+')||"[]")');
    // IDs captured earlier are already durably complete. Record their exact
    // native render count before the crash; uncommitted later mounts may repeat.
    for(const id of state.materials.slice(0,wanted).map(row=>row.id))if(!committedMounts.has(id))committedMounts.set(id,mounts.filter(row=>row.id===id).length);
   }else state.hold=true;
   await crash();
   if(stalled&&index===3){
    await parent.waitForFunction(()=>captureStatus?.state==='STOPPED',{},{timeout:15000});break;
   }
   await parent.waitForFunction(recoveries=>captureStatus?.state==='RUNNING'&&captureStatus.recoveries===recoveries,index+1,{timeout:15000});
  }
  if(stalled){
   const status=await parent.evaluate(()=>captureStatus);assert.equal(status.recoveries,3);assert.equal(status.completeItems,1);
   assert.equal(status.failuresWithoutProgress,3);assert.match(status.message,/repeated failures/);assert.equal(downloads.length,0);
   console.log(JSON.stringify({status:'PASS',mode:'unchanged restored reading evidence stops repeated renderer recovery',realRendererCrashes:4,recoveries:3,completeItems:1,downloads:0}));
  }else{
   await parent.waitForFunction(()=>captureStatus?.state==='FINISHED',{},{timeout:60000});
   if(!downloads.length)await child.waitForEvent('download',{timeout:10000});
   assert.equal(downloads.length,1);
   const capture=JSON.parse(fs.readFileSync(await downloads[0].path(),'utf8'));
   assert.equal(evaluateCourseraCapture(capture,courseId).complete,true);assert.equal(capture.fingerprints.length,state.materials.length);
   const mounts=await evaluate('JSON.parse(sessionStorage.getItem('+JSON.stringify('reading-mounts-'+courseId)+')||"[]")');
   for(const [id,count] of committedMounts)assert.equal(mounts.filter(row=>row.id===id).length,count,'Completed reading reopened after renderer recovery: '+id);
   for(const fp of capture.fingerprints)assert(fp.payload.textSample.includes('Complete observed reading '+fp.id+'.'),'Original observed reading text was lost');
   const status=await parent.evaluate(()=>captureStatus);assert.equal(status.recoveries,4);assert.equal(status.completeItems,state.materials.length);assert.equal(status.savedQuestions,0);
   console.log(JSON.stringify({status:'PASS',mode:'individually committed readings reset repeated renderer recovery failures',realRendererCrashes:4,recoveries:4,items:state.materials.length,duplicateCompletedEditorVisits:0,downloads:1,strictComplete:true}));
  }
  assert.deepEqual(errors,[]);await browserSession.detach();await context.close();
 }
 console.log(JSON.stringify({status:'PASS',scope:'Synthetic Coursera pages; unchanged canonical acquisition/entry/checkpoint contracts, native Chromium renderer crashes, exact completed-item reuse and final strict JSON. No live private course acceptance claim.'}));
}catch(error){
 console.error('::error::Reading crash fixture: '+String(error.message).replace(/[\r\n]+/g,' ').slice(0,1500));throw error;
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
