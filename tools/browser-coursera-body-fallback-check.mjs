import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {bundleConsole} from './console-bundle.mjs';
import {fixtureCourseraAssessmentProgram} from './coursera-assessment-program-fixture.mjs';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';

// Generic assignment modal: every body ID/order/prompt is present, while only
// 27 sidebar labels and answer sets are initially hydrated. The authoring API
// deliberately returns 404, so the canonical DOM continuation must do the work.
// Actual Chrome scrolling lazily exposes keys; no question controls are clicked.
const courseId='Body_fallback_fixture_123',count=609,itemId='assessment-under-test';
const shell=`https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const program=fixtureCourseraAssessmentProgram(bundleConsole(path.resolve('src/extractors/coursera/entry.js')),shell);
function html(){return `<!doctype html><meta charset="utf-8"><style>
 #editor{display:none;position:relative}#layout{display:flex;gap:20px}#rail{width:340px;height:450px;overflow-y:auto}
 #content{width:650px;height:600px;overflow-y:auto}section{height:270px;box-sizing:border-box;border:1px solid #ddd;padding:12px}
 [data-testid=assignment-outline]{height:28px}button{min-height:30px}
 </style><button id="open-assessment">Open assessment</button><main id="editor"><div id="layout"><aside id="rail" data-testid="item-layout-left-sidebar"><p>Assignment outline Content (${count})</p></aside><div id="content"></div></div></main>
 <script>
 const count=${count},rail=document.getElementById('rail'),content=document.getElementById('content');
 const prompt=n=>'Which result is correct for scenario '+n+' in this assessment?';
 const markup=(n,ready)=>'<h3>'+n+' Auto-Graded 1 point</h3><p>Question Type Multiple Choice Prompt</p><p>'+prompt(n)+'</p><p>Options</p>'+(ready?'<div data-testid="option"><p>Correct choice café '+n+'</p><span>Correct</span></div><div data-testid="option"><p>Other choice 日本語 '+n+'</p><span>Incorrect</span></div>':'')+'<p>Export Settings</p>';
 for(let n=1;n<=count;n++){
  const part=document.createElement('section');part.id='assessment~q'+n;part.dataset.testid='assignment-part-'+(n-1);part.dataset.ready=String(n<=27);part.innerHTML=markup(n,n<=27);content.append(part);
  const row=document.createElement('div');row.dataset.testid='assignment-outline';row.setAttribute('data-rbd-drag-handle-draggable-id','assessment~q'+n);row.append(document.createTextNode(n+' '));
  if(n<=27){const a=document.createElement('a');a.href='#assessment~q'+n;a.textContent=prompt(n).slice(0,47);a.onclick=e=>{e.preventDefault();const clicks=JSON.parse(localStorage.getItem('fixture-body-clicks')||'[]');clicks.push(n);localStorage.setItem('fixture-body-clicks',JSON.stringify(clicks));};row.append(a);}rail.append(row);
 }
 const parts=[...content.children];
 function hydrateVisible(){
  const bound=content.getBoundingClientRect();
  for(let i=0;i<parts.length;i++)if(parts[i].dataset.ready!=='true'){
   const rect=parts[i].getBoundingClientRect();if(rect.top<bound.top || rect.bottom>bound.bottom)continue;
   parts[i].dataset.ready='true';parts[i].innerHTML=markup(i+1,true);
   const hydrated=JSON.parse(localStorage.getItem('fixture-body-hydrations')||'[]');hydrated.push(i+1);localStorage.setItem('fixture-body-hydrations',JSON.stringify(hydrated));
  }
 }
 content.addEventListener('scroll',hydrateVisible);
 document.getElementById('open-assessment').onclick=()=>document.getElementById('editor').style.display='block';
 </script>`;}
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-body-fallback-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
 const url=new URL(request.url,'https://www.coursera.org');
 if(url.pathname.startsWith('/api/')){
  response.setHeader('Content-Type','application/json');
  if(url.pathname.includes('authoringCourseMaterials'))response.end(JSON.stringify({elements:[{id:itemId,name:'Synthetic long assessment',typeName:'staffGraded'}]}));
  else {response.writeHead(404);response.end('{}');}
 }else{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html());}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}`]});
 const context=await browser.newContext({acceptDownloads:true,ignoreHTTPSErrors:true});const page=await context.newPage(),downloads=[],errors=[];
 page.on('download',download=>downloads.push(download));page.on('pageerror',error=>errors.push(error.message));
 await page.goto(shell);const session=await context.newCDPSession(page);await session.send('Page.enable');
 const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,'body_fallback_token_123',undefined,{freshRun:true}));
 await session.send(command.cmd,command.args);
 const started=Date.now(),deadline=started+180000;let finished=false,lastBatch=-1;
 while(!finished){
  assert(Date.now()<deadline,'609-body DOM continuation did not finish within 180 seconds');
  try{
   const state=await page.evaluate(()=>({finished:window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',
    plan:JSON.parse(localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_body_fallback_token_123')||'null')}));
   finished=state.finished;if(state.plan?.batches!==lastBatch){lastBatch=state.plan?.batches;console.log('Body fallback batch '+lastBatch+'; saved '+(state.plan?.evidenceProgress?.items?.[0]?.[1]||0)+' questions');}
  }catch(error){if(!/context was destroyed|Cannot find context/i.test(error.message))throw error;}
  if(!finished)await page.waitForTimeout(50);
 }
 if(!downloads.length)await page.waitForEvent('download',{timeout:10000});
 assert.equal(downloads.length,1,'Only one final automatic JSON is downloaded');
 const capture=JSON.parse(fs.readFileSync(await downloads[0].path(),'utf8')),fp=capture.fingerprints.find(f=>f.id===itemId);
 assert.equal(capture.fingerprints.length,1);assert.equal(fp.payload.structuredAssessment.questionCount,count);
 assert.equal(fp.payload.structuredAssessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(fp.payload.captureAttempts,1,'Planned DOM pauses remain one unfinished editor attempt');
 assert.equal(fp.payload.assessmentCaptureInProgress,undefined);assert.equal(evaluateCourseraCapture(capture,courseId).complete,true);
 assert(fp.payload.structuredAssessment.questions.every((q,i)=>q.id===String(i+1)&&q.courseraQuestionId==='assessment~q'+(i+1)&&q.correctAnswers[0]==='Correct choice café '+(i+1)));
 const visits=await page.evaluate(()=>({hydrated:JSON.parse(localStorage.getItem('fixture-body-hydrations')||'[]'),clicks:JSON.parse(localStorage.getItem('fixture-body-clicks')||'[]')}));
 assert.equal(visits.clicks.length,0,'Body fallback never activates a question or authoring control');
 assert.equal(new Set(visits.hydrated).size,count-27);
 // A visible adjacent part may load before a pause. Permit at most one such
 // uncheckpointed neighbour per document; a growing saved prefix must not reload.
 assert(visits.hydrated.length<=count-27+capture.meta.automaticLocalCapture.batches,
  'DOM resumes must not hydrate their growing saved prefix again');
 assert(capture.meta.automaticLocalCapture.batches>=20);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',bodyParts:count,initialRailLinks:27,batches:capture.meta.automaticLocalCapture.batches,
  bodyHydrations:visits.hydrated.length,questionClicks:visits.clicks.length,elapsedMs:Date.now()-started,
  scope:'Canonical DOM parsing/checkpoints/automatic controller/export; synthetic external routing and accelerated loading waits.'},null,2));
}catch(error){console.error('::error::Assessment body resume regression: '+String(error.message).replace(/\r?\n/g,' '));throw error;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
