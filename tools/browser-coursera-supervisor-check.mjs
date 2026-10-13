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
import {CTI_CHECKPOINT_DB,CTI_CHECKPOINT_STORE,CTI_CHECKPOINT_SESSION_PREFIX} from '../src/extractors/coursera/config.js';
import {assessmentBrowserFixture} from './assessment-browser-fixture.mjs';
import {extractorFunctions} from './extractor-functions.cjs';
import {fixtureCourseraAssessmentProgram} from './coursera-assessment-program-fixture.mjs';

const courseId='Supervised_course_fixture_123',shell=`https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const controllerOrigin='https://cti-hardening.pages.dev',token='native_supervisor_token_123';
const program=fixtureCourseraAssessmentProgram(courseraSource,shell);
const supervisorSource=stripTypeScriptTypes(fs.readFileSync('src/domain/coursera-local-supervisor.ts','utf8'))
 .replace(/^import[^\n]+\n/m,'').replace(/export /g,'');
const controllerCode=parseCourseraShellUrl.toString()+'\n'+supervisorSource+'\nconst CTISupervisor={startCourseraLocalSupervisor};';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-supervised-course-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
let loadedModel=false,severLink=false,apiReads=false;
let apiProgram=fixtureCourseraAssessmentProgram(courseraSource,shell);
const boundaryFunctions=extractorFunctions(apiProgram);
apiProgram=apiProgram.replace(boundaryFunctions.get('findNavigationTargetForFingerprint'),
 "async function findNavigationTargetForFingerprint(fp){if(fp.id!=='assessment-under-test')return null;return {element:document.getElementById('open-assessment'),score:0.99,reason:'visible-direct-title',text:fp.name}}");
apiProgram=apiProgram.replace(boundaryFunctions.get('dispatchReadOnlyEditorControl'),
 "function dispatchReadOnlyEditorControl(control){control.element.click();history.replaceState(null,'',"+JSON.stringify(shell.replace('/content/edit','/content/item/project/assessment-under-test'))+");return {attempted:true,mode:'history-popstate'}}");
const cml=text=>({typeName:'cml',definition:{dtdId:'assess/1',value:'<co-content><p>'+text+'</p></co-content>'}});
function apiQuestion(n){return {id:'assessment~definition'+n+'@1',definition:{typeName:'mcq',definition:{prompt:cml('Which result is correct for scenario '+n+' in this assessment?'),
 options:[{id:'correct',display:cml('Correct choice café '+n)},{id:'other',display:cml('Other choice 日本語 '+n)}],correctOption:'correct',shuffleOptions:false}}};}
function cachedApiEditorHtml(fullBody=false){
 const rows=Array.from({length:fullBody?27:100},(_,i)=>{const n=i+1;return '<div data-testid="assignment-outline" data-rbd-drag-handle-draggable-id="assessment~q'+n+'"><span>'+n+' </span><a href="#assessment~q'+n+'">Which result is correct for scenario '+n+' in this assessment?</a></div>';}).join('');
 let layout='<aside data-testid="item-layout-left-sidebar"><p>Assignment outline Content (100)</p>'+rows+'</aside><div data-testid="item-layout-content"><section id="assessment~q1" data-testid="assignment-part-0"><h3>1 Auto-Graded 1 point</h3><p>Prompt</p><p>Which result is correct for scenario 1 in this assessment?</p><p>Options</p><div data-testid="option"><p>Correct choice café 1</p></div><div data-testid="option"><p>Other choice 日本語 1</p></div></section></div>';
 if(fullBody){
  layout=layout.replace('data-testid="item-layout-content"','id="quiz-body"').replace('</section></div>',
   '</section>'+Array.from({length:99},(_,i)=>'<section id="assessment~q'+(i+2)+'" data-testid="assignment-part-'+(i+1)+'"></section>').join('')+'</div>');
 }
 return '<!doctype html><style>a{display:inline-block}[data-testid=assignment-outline]{min-height:24px}</style><button id="open-assessment">Open assessment</button><main id="editor" style="display:none"></main><script>document.getElementById("open-assessment").onclick=()=>{const editor=document.getElementById("editor");editor.innerHTML='+JSON.stringify(layout)+';editor.style.display="block"};</script>';
}
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
 const url=new URL(request.url,request.headers.host?.startsWith('cti-hardening')?controllerOrigin:'https://www.coursera.org');
 if(url.origin===controllerOrigin){
  response.setHeader('Content-Type','text/html');response.end(`<button id="open">Open managed Coursera</button><script>${controllerCode}</script><script>
   document.getElementById('open').onclick=()=>{window.child=window.open(${JSON.stringify(shell)},'cti-course');
    window.supervisor=CTISupervisor.startCourseraLocalSupervisor(window,child,${JSON.stringify(shell)},${JSON.stringify(token)},status=>{window.captureStatus=status;},{timeoutMs:7000,reconnectTimeoutMs:7000,intervalMs:500});};
   </script>`);return;
 }
 if(severLink)response.setHeader('Cross-Origin-Opener-Policy','same-origin');
 if(url.pathname==='/assets/question-diagram.svg'){
  response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');return;
 }
 if(apiReads && /^\/api\/authoringAssignment(?:QuestionGroups|MachineEvaluableQuestions)\.v1/.test(url.pathname)){
  const group=url.pathname.includes('QuestionGroups');
  const ids=url.searchParams.get('ids')?.split(',') || [decodeURIComponent(url.pathname.split('/')[3] || '')];
  const elements=ids.map(id=>{const match=id.match(group?/^assessment~q(\d+)$/:/^assessment~definition(\d+)@1$/);if(!match)return null;const n=Number(match[1]);return group?{id,scoringWeight:1,questions:['assessment~definition'+n+'@1']}:apiQuestion(n)}).filter(Boolean).reverse();
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({elements,paging:{},linked:{}}));return;
 }
 if(url.pathname.startsWith('/api/')){
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(url.pathname.includes('authoringCourseMaterials')?
   {elements:Array.from({length:168},(_,i)=>i===1?{id:'assessment-under-test',name:apiReads?'Untitled':'Synthetic quiz',typeName:'staffGraded'}:
    {id:'reading-'+i,name:'Reading '+i,typeName:'supplement'})}:{}));return;
 }
 let html=apiReads?cachedApiEditorHtml(apiReads==='full-body'):assessmentBrowserFixture(100,true);
 if(loadedModel)html+=`<script>document.getElementById('editor').__reactProps$fixture={questions:Array.from({length:100},(_,i)=>({
  id:'assessment~q'+(i+1),questionType:'Multiple Choice',prompt:'Which result is correct for scenario '+(i+1)+' in this assessment?',
  options:[{text:'Correct choice café '+(i+1),correct:true},{text:'Other choice 日本語 '+(i+1),correct:false}],sourceMath:'<math><mi>α</mi></math>',unknownOriginal:{retained:true},
  ...(i===1?{diagram:'https://www.coursera.org/assets/question-diagram.svg'}:{})
 })),queryCache:Array.from({length:10000},(_,i)=>({cached:{metadata:{id:'unrelated-'+i,child:{value:i}}}}))};</script>`;
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
 // Use full Chromium with its normal desktop site isolation. The default
 // headless shell can place these two sites in one renderer and crash both.
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}, MAP cti-hardening.pages.dev 127.0.0.1:${server.address().port}`]});
 for(const strategy of ['dom-recovery','loaded-model','cached-api','cached-api-body']){
  const bulk=strategy!=='dom-recovery';apiReads=strategy==='cached-api-body'?'full-body':strategy==='cached-api';loadedModel=strategy==='loaded-model';const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  const parent=await context.newPage();await parent.goto(controllerOrigin+'/controller');
  const opening=context.waitForEvent('page');await parent.click('#open');const child=await opening;await child.waitForLoadState();
  const downloads=[],errors=[];child.on('download',d=>downloads.push(d));child.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(child);await cdp.send('Page.enable');
  const browserSession=await browser.newBrowserCDPSession();await browserSession.send('Target.setDiscoverTargets',{discover:true});
  const info=await cdp.send('Target.getTargetInfo');
  const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,apiReads?apiProgram:program,token,undefined,{controllerOrigin,freshRun:bulk}));
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
  if(loadedModel){
   assert.equal(questions.length,0,'Loaded model still matches observed outline identities without opening each question');
   assert.equal(quiz.payload.loadedAssessmentEvidence.rawQuestionDefinitions.length,100);
   assert(quiz.payload.loadedAssessmentEvidence.rawQuestionDefinitions.every(q=>q.sourceMath==='<math><mi>α</mi></math>' && q.unknownOriginal.retained));
   assert(quiz.payload.images.includes('https://www.coursera.org/assets/question-diagram.svg'));
   assert(quiz.payload.assetDetails.some(asset=>asset.url==='https://www.coursera.org/assets/question-diagram.svg' && asset.sha256));
  }else if(apiReads){
   assert.equal(questions.length,0,'Cached API acquisition must not click any question');
   assert.equal(quiz.payload.structuredAssessment.captureCompleteness.requiredAnswerCoverageComplete,true);
   assert.equal(quiz.payload.assessmentApiEvidence.groups.length,100);
   assert.equal(quiz.payload.assessmentApiEvidence.questionDefinitions.length,100);
   assert.equal(quiz.payload.assessmentApiEvidence.resources.groups.source,'CAPTURE_ADAPTER');
   assert.equal(quiz.payload.assessmentApiEvidence.resources.questions.source,'CAPTURE_ADAPTER');
   assert(quiz.payload.structuredAssessment.questions.every(q=>q.observationMethod==='AUTHORING_API_MATCHED_TO_LIVE_OUTLINE'));
   if(strategy==='cached-api-body'){
    // The final document's crawl diagnostics cover its remaining visits. The
    // original body inventory persists with the restored assessment evidence.
    const inventory=quiz.payload.assessmentApiEvidence.inventory;
    assert.equal(inventory.length,100);
    assert.deepEqual(inventory.map(q=>q.ordinal),Array.from({length:100},(_,i)=>i+1));
    assert(inventory.slice(27).every(q=>q.label===''),'Unmounted rail rows must not acquire invented labels');
   }
  }else{
   assert.equal(new Set(questions).size,99);assert(questions.length<=109,'Only uncommitted observations may be reread after two crashes');
   assert.equal(capture.meta.localCaptureBatch.maxQuestionObservations,5,'Later recovered documents retain the smaller renderer question budget');
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',courseItems:168,questions:100,mode:strategy,automaticRecoveries:status.recoveries,downloads:downloads.length,
   scope:'Synthetic external content; real canonical entry, IndexedDB, cross-origin controller, Chrome renderer crashes and retained debugger registration.'}));
  await browserSession.detach();await context.close();
 }
 // Lose the real debugger registration after multiple fresh renderer batches,
 // then attach a new managed token to that exact durable run. Completed items
 // must survive the handoff; a new token must not reset its namespace or limits.
 apiReads='full-body';loadedModel=false;
 const resumeContext=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
 const resumeParent=await resumeContext.newPage();await resumeParent.goto(controllerOrigin+'/controller');
 const firstOpening=resumeContext.waitForEvent('page');await resumeParent.click('#open');const firstChild=await firstOpening;await firstChild.waitForLoadState();
 const firstCdp=await resumeContext.newCDPSession(firstChild);await firstCdp.send('Page.enable');
 const resumedDownloads=[],resumeErrors=[];
 firstChild.on('download',download=>resumedDownloads.push(download));firstChild.on('pageerror',error=>resumeErrors.push(error.message));
 const freshCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,apiProgram,token,undefined,{controllerOrigin,freshRun:true}));
 const firstRegistration=await firstCdp.send(freshCommand.cmd,freshCommand.args);
 await resumeParent.waitForFunction(()=>captureStatus?.state==='RUNNING',{},{timeout:15000});
 // Managed documents now release after six visits, and the 100-part quiz
 // releases its document as soon as its checkpoint commits. Keep the original
 // forty-completed-item handoff coverage instead of assuming two documents
 // can still hold forty editor visits.
 await resumeParent.waitForFunction(()=>captureStatus?.state==='RUNNING'&&captureStatus.completeItems>=40,{},{timeout:120000});
 await firstChild.waitForFunction(token=>Number(JSON.parse(localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_'+token) || 'null')?.batches || 0)>=2,token,{timeout:60000});
 await firstCdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:firstRegistration.identifier});
 await firstChild.goto(shell,{waitUntil:'load'});
 assert.equal(await firstChild.evaluate(()=>Boolean(window.__CTI_ITEM_FIDELITY_RUN_LOCK || window.__CTI_COURSERA_PROGRESS__)),false,
  'Removing registration must leave a plain outline instead of secretly rerunning capture');
 const beforeResume=await firstChild.evaluate(async({token,courseId,dbName,storeName,prefix})=>{
  const planKey='__CTI_AUTOMATIC_LOCAL_V61517_'+token,plan=JSON.parse(localStorage.getItem(planKey));
  const session=JSON.parse(localStorage.getItem(prefix+courseId));
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(dbName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  let records;try{records=await new Promise((resolve,reject)=>{const request=db.transaction(storeName).objectStore(storeName).index('runKey').getAll(plan.checkpointRunId+'|'+courseId);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}finally{db.close()}
  const complete=records.filter(row=>row.diagnostic?.captureContract?.complete===true || row.fingerprint?.payload?.captureContract?.complete===true);
  // Registration is gone and the old tab will close. Age only this fixture's
  // liveness receipt so the handoff does not spend 45 seconds waiting to prove
  // an already-removed producer is inactive.
  plan.updatedAt=Date.now()-50000;localStorage.setItem(planKey,JSON.stringify(plan));
  return {plan,session,stored:records.length,completeIds:complete.map(row=>row.itemId),
   quiz:records.find(row=>row.itemId==='assessment-under-test')?.fingerprint?.payload,
   readingVisits:JSON.parse(localStorage.getItem('fixture-reading-visits') || '[]')};
 },{token,courseId,dbName:CTI_CHECKPOINT_DB,storeName:CTI_CHECKPOINT_STORE,prefix:CTI_CHECKPOINT_SESSION_PREFIX});
 assert.equal(beforeResume.plan.state,'RUNNING');assert.equal(beforeResume.plan.captureMode,'FRESH_FULL_COURSE');
 assert(beforeResume.plan.batches>=2);assert(beforeResume.completeIds.length>=40);
 assert.equal(beforeResume.session.id,beforeResume.plan.checkpointRunId);
 assert.equal(beforeResume.quiz.structuredAssessment.questionCount,100);
 assert.equal(beforeResume.quiz.assessmentApiEvidence.questionDefinitions.length,100);
 assert.equal(resumedDownloads.length,0,'Intermediate fresh batches must not download JSON before the handoff');
 await resumeParent.evaluate(()=>supervisor.dispose());await firstChild.close();
 const replacementToken='native_resumed_supervisor_token_123';
 const replacementOpening=resumeContext.waitForEvent('page');
 await resumeParent.evaluate(({shell,courseId,token})=>{
  window.child=window.open(shell,'cti-resumed-course');
  window.supervisor=CTISupervisor.startCourseraLocalSupervisor(window,child,shell,token,status=>{window.captureStatus=status},
   {timeoutMs:7000,reconnectTimeoutMs:7000,intervalMs:500});
 },{shell,courseId,token:replacementToken});
 const replacementChild=await replacementOpening;await replacementChild.waitForLoadState();
 replacementChild.on('download',download=>resumedDownloads.push(download));replacementChild.on('pageerror',error=>resumeErrors.push(error.message));
 const replacementCdp=await resumeContext.newCDPSession(replacementChild);await replacementCdp.send('Page.enable');
 const resumeCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,apiProgram,replacementToken,undefined,{controllerOrigin,resumeExisting:true}));
 assert(resumeCommand.args.source.includes('"resumeExisting":true'),'An explicit resume must survive the copied-command boundary');
 await replacementCdp.send(resumeCommand.cmd,resumeCommand.args);
 await resumeParent.waitForFunction(()=>captureStatus?.state==='FINISHED',{},{timeout:120000});
 assert.equal(resumedDownloads.length,1,'A lost-registration resume must produce one final JSON across both producers');
 const resumedCapture=JSON.parse(fs.readFileSync(await resumedDownloads[0].path(),'utf8'));
 const resumedQuiz=resumedCapture.fingerprints.find(fp=>fp.id==='assessment-under-test');
 const resumedPlan=resumedCapture.meta.automaticLocalCapture;
 assert.equal(resumedPlan.checkpointRunId,beforeResume.plan.checkpointRunId,'New token switched the preserved fresh namespace');
 assert.equal(resumedPlan.startedAt,beforeResume.plan.startedAt,'New token reset the overall run clock');
 assert(resumedPlan.batches>beforeResume.plan.batches,'New token reset the durable batch budget');
 assert.equal(resumedPlan.captureMode,beforeResume.plan.captureMode,'Resume relabelled the original fresh course run');
 assert(resumedCapture.meta.checkpointResume.restored>=beforeResume.completeIds.length);
 assert.equal(resumedQuiz.payload.captureAttempts,1,'A completed quiz was opened again after the registration handoff');
 assert.equal(resumedQuiz.payload.structuredAssessment.questionCount,100);
 assert.equal(resumedQuiz.payload.structuredAssessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(resumedQuiz.payload.assessmentApiEvidence.questionDefinitions.length,100);
 assert.equal(evaluateCourseraCapture(resumedCapture,courseId).complete,true);
 const readingVisitsAfter=await replacementChild.evaluate(()=>JSON.parse(localStorage.getItem('fixture-reading-visits') || '[]'));
 for(const id of beforeResume.completeIds.filter(id=>id!=='assessment-under-test')){
  assert.equal(readingVisitsAfter.filter(visited=>visited===id).length,beforeResume.readingVisits.filter(visited=>visited===id).length,
   'A completed reading was captured again after its durable checkpoint was adopted: '+id);
 }
 assert.deepEqual(resumeErrors,[]);
 console.log(JSON.stringify({status:'PASS',mode:'lost registration after multiple fresh batches resumes under a new managed token',
  completedBeforeHandoff:beforeResume.completeIds.length,batchesBeforeHandoff:beforeResume.plan.batches,
  finalBatches:resumedPlan.batches,preservedCheckpointNamespace:true,preservedStartedAt:true,
  duplicateCompletedEditorVisits:0,questions:100,keys:100,downloads:resumedDownloads.length,
  scope:'Real CDP registration removal, same-origin IndexedDB and new managed tab/token; prior complete native API quiz and reading checkpoints are reused.'}));
 await resumeContext.close();
 // Matching plan metadata is insufficient if browser item storage disappeared.
 // An explicit recovery must stop before any editor visit rather than silently
 // treating an empty namespace as permission for a fresh course extraction.
 const emptyContext=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
 const emptyParent=await emptyContext.newPage();await emptyParent.goto(controllerOrigin+'/controller');
 const emptyOpening=emptyContext.waitForEvent('page');await emptyParent.click('#open');const emptyChild=await emptyOpening;await emptyChild.waitForLoadState();
 const emptyDownloads=[];emptyChild.on('download',download=>emptyDownloads.push(download));
 const emptyToken='native_empty_checkpoint_resume_123';
 await emptyChild.evaluate(({courseId,plan,session,prefix})=>{
  localStorage.setItem('__CTI_AUTOMATIC_LOCAL_V61517_'+plan.token,JSON.stringify({...plan,state:'RUNNING',reason:'',updatedAt:Date.now()-50000}));
  localStorage.setItem('__CTI_AUTOMATIC_LOCAL_ACTIVE_V61517_'+courseId,plan.token);
  localStorage.setItem(prefix+courseId,JSON.stringify(session));
 },{courseId,plan:beforeResume.plan,session:beforeResume.session,prefix:CTI_CHECKPOINT_SESSION_PREFIX});
 await emptyParent.evaluate(({shell,token})=>{
  supervisor.dispose();window.supervisor=CTISupervisor.startCourseraLocalSupervisor(window,child,shell,token,
   status=>{window.captureStatus=status},{timeoutMs:7000,reconnectTimeoutMs:7000,intervalMs:500});
 },{shell,token:emptyToken});
 const emptyCdp=await emptyContext.newCDPSession(emptyChild);await emptyCdp.send('Page.enable');
 const emptyCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,apiProgram,emptyToken,undefined,{controllerOrigin,resumeExisting:true}));
 await emptyCdp.send(emptyCommand.cmd,emptyCommand.args);
 await emptyParent.waitForFunction(()=>captureStatus?.state==='STOPPED',{},{timeout:15000});
 assert.match((await emptyParent.evaluate(()=>captureStatus)).message,/could not restore matching item evidence/);
 const emptyState=await emptyChild.evaluate(({courseId,prefix,token})=>({
  readings:JSON.parse(localStorage.getItem('fixture-reading-visits') || '[]'),
  questions:JSON.parse(localStorage.getItem('fixture-question-visits') || '[]'),
  pointer:JSON.parse(localStorage.getItem(prefix+courseId)),
  plan:JSON.parse(localStorage.getItem('__CTI_AUTOMATIC_LOCAL_V61517_'+token)),
 }),{courseId,prefix:CTI_CHECKPOINT_SESSION_PREFIX,token:emptyToken});
 assert.deepEqual(emptyState.readings,[]);assert.deepEqual(emptyState.questions,[]);assert.equal(emptyDownloads.length,0);
 assert.equal(emptyState.pointer.id,beforeResume.session.id);
 assert.equal(emptyState.plan.checkpointRunId,beforeResume.plan.checkpointRunId);
 console.log(JSON.stringify({status:'PASS',mode:'explicit resume with no matching IndexedDB observations stops before editor visits',
  readingVisits:0,questionVisits:0,downloads:0,checkpointNamespacePreserved:true,freshFallback:false,
  scope:'Valid prior course plan and pinned fresh namespace metadata cannot substitute for missing item checkpoints.'}));
 await emptyContext.close();
 // A reopened document cannot restore capture after its debugger registration
 // disappeared. A terminal durable plan must report its reason rather than
 // silently look like the same missing-registration failure.
 apiReads=false;loadedModel=false;
 for(const loss of ['registration-lost','terminal-plan']){
  const lossContext=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  const lossParent=await lossContext.newPage();await lossParent.goto(controllerOrigin+'/controller');
  const lossOpening=lossContext.waitForEvent('page');await lossParent.click('#open');const lossChild=await lossOpening;await lossChild.waitForLoadState();
  const lossCdp=await lossContext.newCDPSession(lossChild);await lossCdp.send('Page.enable');
  const lossCommand=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,token,undefined,{controllerOrigin,freshRun:true}));
  const lossRegistration=await lossCdp.send(lossCommand.cmd,lossCommand.args);
  await lossParent.waitForFunction(()=>captureStatus?.state==='RUNNING',{},{timeout:15000});
  await checkpointAtLeast(lossCdp,10);
  if(loss==='registration-lost')await lossCdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:lossRegistration.identifier});
  else await lossChild.evaluate(token=>{
   const key='__CTI_AUTOMATIC_LOCAL_V61517_'+token,plan=JSON.parse(localStorage.getItem(key));
   plan.state='FINISHED';plan.reason='LOCAL_CAPTURE_NO_PROGRESS';localStorage.setItem(key,JSON.stringify(plan));
  },token);
  await lossCdp.send('Page.navigate',{url:shell});
  await lossParent.waitForFunction(()=>captureStatus?.state==='STOPPED',{},{timeout:25000});
  const lossStatus=await lossParent.evaluate(()=>captureStatus);
  assert(lossStatus.savedQuestions>=10);assert.equal(lossStatus.recoveries,loss==='registration-lost'?1:0);
  assert.match(lossStatus.message,loss==='registration-lost'?/extractor did not reconnect/:/LOCAL_CAPTURE_NO_PROGRESS/);
  await checkpointAtLeast(lossCdp,10);
  console.log(JSON.stringify({status:'PASS',mode:loss,savedQuestions:lossStatus.savedQuestions,recoveries:lossStatus.recoveries,
   scope:'Real registration removal or terminal-plan reentry; no false restore claim and committed observations remain.'}));
  await lossContext.close();
 }
 // The registered guard reports login or unrelated navigation before the
 // supervisor can mistake it for a renderer failure and repeatedly reload it.
 apiReads=false;loadedModel=false;const loginContext=await browser.newContext({ignoreHTTPSErrors:true});
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
