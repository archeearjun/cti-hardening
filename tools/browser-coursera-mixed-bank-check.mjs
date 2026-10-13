import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {bundleConsole} from './console-bundle.mjs';
import {extractorFunctions} from './extractor-functions.cjs';
import * as config from '../src/extractors/coursera/config.js';

// Real Chromium, same-origin HTTPS responses, the unchanged canonical cycle,
// native checkpoint helpers and IndexedDB. The unsupported API type is opaque
// synthetic data: this does not assert an actual Coursera text-entry schema.
const courseId='Mixed_bank_fixture_course_123',itemId='mixed-bank',assignmentId='SyntheticMixedAssignment_123',count=609;
const textOrdinals=[136,143,149,154,164,166,169,172,178,181,187,190,197],textParts=new Set(textOrdinals);
const groupResource='authoringAssignmentQuestionGroups.v1',definitionResource='authoringAssignmentMachineEvaluableQuestions.v1';
const url='https://www.coursera.org/teach/synthetic/'+courseId+'/content/item/project/'+itemId;
const groupId=n=>assignmentId+'~group_'+String(n).padStart(4,'0');
const definitionId=n=>assignmentId+'~question_'+String(n).padStart(4,'0')+'@'+(n%3+1);
const prompt=n=>'What is the observed result for synthetic bank scenario '+n+'?';
const label=(n,k)=>'Choice '+k+' for synthetic scenario '+n;
const answers=n=>[String(n*7),String(n*7)+'.0'];
const cml=text=>({typeName:'cml',definition:{dtdId:'assess/1',value:'<co-content><p>'+text+'</p></co-content>',
 renderableHtmlWithMetadata:{metadata:{hasMath:false},renderableHtml:'<p>'+text+'</p>'}}});
function group(n){return {id:groupId(n),questions:[definitionId(n)],scoringWeight:1,writeAccessToken:'SYNTHETIC_WRITE_SECRET',validation:{isReadyForPublish:true}};}
function definition(n){return {id:definitionId(n),writeAccessToken:'SYNTHETIC_WRITE_SECRET',definition:textParts.has(n)?
 {typeName:'opaque-synthetic-unsupported-type',definition:{untouchedOriginalFixtureEnvelope:{ordinal:n,values:[0,false,null,'café 日本語 ∑x²']}}}:
 {typeName:'mcq',definition:{prompt:cml(prompt(n)),options:[1,2,3,4].map(k=>({id:'option-'+k,display:cml(label(n,k)),feedback:cml('Feedback '+k+' for '+n)})),
 correctOption:'option-'+(n%4+1),shuffleOptions:false}},validation:{fixtureOriginalFlag:true}};}
const groupLookup=new Map(Array.from({length:count},(_,i)=>[groupId(i+1),i+1])),definitionLookup=new Map(Array.from({length:count},(_,i)=>[definitionId(i+1),i+1]));
const source=bundleConsole(path.resolve('src/extractors/coursera/entry.js'));
const runtime=Object.entries(config).map(([name,value])=>'const '+name+'='+JSON.stringify(value)+';').join('\n')+'\n'+[...extractorFunctions(source).values()].join('\n');
function fixtureHtml(){return '<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px Arial}#editor{display:flex;gap:20px}#rail{width:430px;height:320px;overflow-y:auto;flex-shrink:0}#rows{height:'+count*32+'px;position:relative}[data-testid=assignment-outline]{position:absolute;height:32px;width:420px}a{display:inline-block}#content{width:620px;min-height:500px}section{padding:5px}</style><main id="editor"><aside id="rail" data-testid="item-layout-left-sidebar"><p>Assignment outline Content ('+count+')</p><div id="rows"></div></aside><div id="content" data-testid="item-layout-content"></div></main><script>('+pageFixture.toString()+')('+JSON.stringify({count,assignmentId,textOrdinals})+',{'+'groupId:'+groupId.toString()+',prompt:'+prompt.toString()+',label:'+label.toString()+',answers:'+answers.toString()+'});</script>';}
function pageFixture(setup,helpers){
 const {count,assignmentId,textOrdinals}=setup,{prompt,label,answers}=helpers,entries=new Set(textOrdinals);
 const groupId=n=>assignmentId+'~group_'+String(n).padStart(4,'0');
 window.mixedQuestionClicks=[];window.mixedMutations=0;window.mixedRailScrolls=0;window.mixedReady=false;
 const rail=document.getElementById('rail'),rows=document.getElementById('rows'),content=document.getElementById('content');
 function mount(n){
  const heading='<section id="'+groupId(n)+'" data-testid="assignment-part-'+(n-1)+'"><h3>'+n+' Auto-Graded 1 point</h3>';
  const body=entries.has(n)?'<p>Question Type Text match Prompt</p><p>'+prompt(n)+'</p><p>Correct Answers</p>'+answers(n).map(value=>'<div data-testid="option"><p>'+value+'</p><span>Correct</span></div>').join(''):
   '<p>Question Type Multiple Choice Prompt</p><p>'+prompt(n)+'</p><p>Options</p>'+[1,2,3,4].map(k=>'<div data-testid="option"><p>'+label(n,k)+'</p>'+(n===1?'':'<span>'+(k===n%4+1?'Correct':'Incorrect')+'</span>')+'</div>').join('');
  content.innerHTML=heading+body+'<p>Export Settings</p></section>';
 }
 function render(){
  const first=Math.max(0,Math.min(count-27,Math.floor(rail.scrollTop/32)));rows.replaceChildren();
  for(let i=first;i<Math.min(count,first+27);i++){
   const n=i+1,row=document.createElement('div');row.dataset.testid='assignment-outline';row.style.top=i*32+'px';row.setAttribute('data-rbd-drag-handle-draggable-id',groupId(n));
   const ordinal=document.createElement('span');ordinal.textContent=n+' ';const anchor=document.createElement('a');anchor.href='#'+groupId(n);anchor.textContent=prompt(n);
   anchor.onclick=event=>{event.preventDefault();mixedQuestionClicks.push(n);mount(n);};row.append(ordinal,anchor);rows.append(row);
  }
 }
 rail.addEventListener('scroll',()=>{mixedRailScrolls++;render();});rail.scrollTop=64;render();mount(1);
 Promise.all([fetch('/api/authoringAssignmentQuestionGroups.v1/'+groupId(1)+'?id='+encodeURIComponent(groupId(1))+'&fields=id,questions,validation').then(r=>r.text()),
  fetch('/api/authoringAssignmentMachineEvaluableQuestions.v1/'+assignmentId+'~question_0001@2?fields=id,definition,validation').then(r=>r.text())]).then(()=>mixedReady=true);
}
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-mixed-bank-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
let active=0,maxActive=0,requests=[];
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},async(request,response)=>{
 const parsed=new URL(request.url,'https://www.coursera.org');
 if(!parsed.pathname.startsWith('/api/')){response.setHeader('content-type','text/html; charset=utf-8');response.end(fixtureHtml());return;}
 active++;maxActive=Math.max(maxActive,active);
 try{
  await new Promise(resolve=>setTimeout(resolve,5));
  const resource=parsed.pathname.split('/')[2],ids=parsed.searchParams.has('ids')?parsed.searchParams.get('ids').split(','):[decodeURIComponent(parsed.pathname.split('/')[3]||'')];
  requests.push({method:request.method,resource,ids,fields:parsed.searchParams.get('fields')});
  const lookup=resource===groupResource?groupLookup:resource===definitionResource?definitionLookup:null;
  if(!lookup||request.method!=='GET'){response.writeHead(404);response.end('{}');return;}
  response.setHeader('content-type','application/json');response.end(JSON.stringify({elements:ids.filter(id=>lookup.has(id)).map(id=>resource===groupResource?group(lookup.get(id)):definition(lookup.get(id))).reverse(),paging:{},linked:{}}));
 }finally{active--;}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP www.coursera.org 127.0.0.1:'+server.address().port]});
 const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function runDocument(resume){
  await page.goto(url);await page.waitForFunction(()=>mixedReady);assert.equal(await page.locator('[data-testid="assignment-outline"]').count(),27);
  await page.addScriptTag({content:runtime});requests=[];maxActive=0;
  const result=await page.evaluate(async({courseId,itemId,resume})=>{
   const fp={id:itemId,name:'Synthetic mixed bank',type:'Assignment',typeName:'staffGraded',evidenceLevel:'active-editor',payload:{captureAttempts:1}};
   const manager=await createCheckpointManagerV6150(courseId);if(!manager.available)throw Error(manager.error);
   const restored=resume?await manager.restore([fp]):null;
   const seed=fp.payload.assessmentCaptureInProgress?.assessment || fp.payload.structuredAssessment;
   const baseline=new Map((seed?.questions || []).map(q=>[q.courseraQuestionId,q.observedAtMs]));
   const charged=new Set();let checkpointWrites=0,yieldReason='';const start=Date.now();
   const cycle=await collectCourseraAssessmentByQuestionCycleV662(document.getElementById('editor'),fp,{certifiedItem:true,courseId,deadline:Date.now()+180000,
    seedAssessment:seed,resumeInProgress:!!fp.payload.assessmentCaptureInProgress,shouldYield:()=>yieldReason,
    onCheckpoint:async model=>{
     let snapshot=fp;
     if(model){snapshot=assessmentQuestionCheckpointV61518(fp,model,new Date().toISOString());fp.payload.assessmentCaptureInProgress=snapshot.payload.assessmentCaptureInProgress;}
     const saved=await manager.save(snapshot,{id:fp.id,completed:false},'mixed-native-progress');if(!saved)throw Error('Native progress save failed');checkpointWrites++;
     for(const q of model?.questions || [])if(q.observationMethod!=='AUTHORING_API_MATCHED_TO_LIVE_OUTLINE' && q.courseraQuestionId &&
      (!baseline.has(q.courseraQuestionId)||baseline.get(q.courseraQuestionId)!==q.observedAtMs))charged.add(q.courseraQuestionId);
     if(!resume&&charged.size>=6)yieldReason='MIXED_NATIVE_ACTUAL_DOM_PAUSE';
     return true;
    }});
   fp.payload.structuredAssessment=cycle.assessment;
   // Like the canonical completed-item checkpoint, end the interrupted state
   // only after current observations cover every required question and key.
   if(cycle.stopReason!=='LOCAL_ASSESSMENT_CHECKPOINT_YIELD' &&
    cycle.assessment?.captureCompleteness?.requiredAnswerCoverageComplete===true)delete fp.payload.assessmentCaptureInProgress;
   const contract=captureContractV6150(fp);
   if(contract.complete){delete fp.payload.assessmentCaptureInProgress;fp.payload.captureAttempts=1;}
   else fp.payload.captureAttempts=0;
   if(!await manager.save(fp,{id:fp.id,completed:contract.complete},contract.complete?'mixed-native-complete':'mixed-native-yield'))throw Error('Native final item save failed');
   const db=await openCheckpointDbV6150({readOnly:true});
   const rows=await new Promise((resolve,reject)=>{const request=db.transaction(CTI_CHECKPOINT_STORE,'readonly').objectStore(CTI_CHECKPOINT_STORE).index('runKey').getAll(manager.runKey);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();
   const receipt={cycle,payload:fp.payload,contract,charged:charged.size,checkpointWrites,saved:manager.saved,restored,rows:rows.length,
    storedAttempts:rows[0]?.fingerprint.payload.captureAttempts,durableModel:rows[0]?.fingerprint.payload.assessmentCaptureInProgress?.assessment || rows[0]?.fingerprint.payload.structuredAssessment,
    clicks:mixedQuestionClicks,elapsedMs:Date.now()-start};manager.close();return receipt;
  },{courseId,itemId,resume});
  assert(maxActive<=2);assert(requests.every(r=>r.method==='GET'&&[groupResource,definitionResource].includes(r.resource)&&r.ids.length<=15));
  assert(requests.every(r=>r.fields.includes('-writeAccessToken')&&!r.fields.split(',').includes('writeAccessToken')));
  assert(requests.every(r=>r.ids.every(id=>(r.resource===groupResource?groupLookup:definitionLookup).has(id))));
  assert(result.checkpointWrites<=8,'API seeds caused progress writes to scale with596definitions rather than observed DOM questions');
  assert.equal(result.rows,1,'Progress saves created duplicate durable item rows');
  assert.equal(result.payload.assessmentApiEvidence.groups.length,count);assert.equal(result.payload.assessmentApiEvidence.questionDefinitions.length,count);
  const raw=new Map(result.payload.assessmentApiEvidence.questionDefinitions.map(d=>[d.id,d]));
  for(let n=1;n<=count;n++){
   const expected=definition(n);delete expected.writeAccessToken;assert.deepEqual(raw.get(definitionId(n)),expected);
  }
  assert(!JSON.stringify(result).includes('writeAccessToken')&&!JSON.stringify(result).includes('SYNTHETIC_WRITE_SECRET'));
  return {...result,apiRequests:requests.length,maxApiConcurrency:maxActive};
 }
 const paused=await runDocument(false);
 assert.equal(paused.cycle.stopReason,'LOCAL_ASSESSMENT_CHECKPOINT_YIELD');assert.equal(paused.contract.complete,false);
 assert.equal(paused.charged,6);assert.deepEqual(paused.clicks,textOrdinals.slice(0,6));assert.equal(paused.storedAttempts,0);
 assert.equal(paused.durableModel.questionCount,602,'The forced DOM pause discarded previously checkpointed API questions');
 assert.equal(paused.durableModel.questions.filter(q=>q.observationMethod==='AUTHORING_API_MATCHED_TO_LIVE_OUTLINE').length,596);
 assert.equal(paused.apiRequests,82);
 console.log(JSON.stringify({status:'PASS',mode:'mixed609 paused after6DOMkeys',durableQuestions:602,apiQuestions:596,actualDomObservations:paused.charged,
  questionClicks:paused.clicks.length,checkpointWrites:paused.checkpointWrites,durableRows:paused.rows,complete:paused.contract.complete,elapsedMs:paused.elapsedMs}));
 const completed=await runDocument(true);
 assert.equal(completed.restored.restored,1);assert.equal(completed.contract.complete,true);assert.equal(completed.storedAttempts,1);
 assert.equal(completed.cycle.assessment.questionCount,count);assert.equal(completed.cycle.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.deepEqual(completed.clicks,textOrdinals.slice(6));assert.equal(completed.charged,7);
 assert.equal(completed.cycle.assessment.questions.filter(q=>q.observationMethod==='AUTHORING_API_MATCHED_TO_LIVE_OUTLINE').length,596);
 assert.equal(completed.cycle.authoringApi.reusedDefinitions,596);assert.equal(completed.cycle.authoringApi.definitionRequests,1);
 for(const q of completed.cycle.assessment.questions){const n=Number(q.id);assert.equal(q.courseraQuestionId,groupId(n));assert.equal(q.questionOrdinalObserved,true);
  if(textParts.has(n)){assert.equal(q.type,'text-entry');assert.equal(q.answerTextReliable,true);assert.deepEqual(q.correctAnswers,answers(n));assert.equal(q.options.length,0);}
  else{assert.equal(q.sourceDefinitionId,definitionId(n));assert.deepEqual(q.correctAnswers,[label(n,n%4+1)]);}
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',mode:'mixed609 resumed remaining7DOMkeys',questions:count,apiQuestions:596,actualDomObservations:completed.charged,
  questionClicks:completed.clicks.length,checkpointWrites:completed.checkpointWrites,durableRows:completed.rows,apiRequests:completed.apiRequests,
  maxApiConcurrency:completed.maxApiConcurrency,complete:true,elapsedMs:completed.elapsedMs,
  scope:'Unchanged canonical cycle and native checkpoints; 13 observed text-match DOM keys, opaque unsupported API wrappers, no actual Coursera text-entry schema asserted.'}));
 await context.close();
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
