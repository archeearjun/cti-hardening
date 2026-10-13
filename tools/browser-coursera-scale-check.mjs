import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {bundleConsole} from './console-bundle.mjs';
import {extractorFunctions} from './extractor-functions.cjs';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';
import * as config from '../src/extractors/coursera/config.js';

// Synthetic, authenticated-origin-shaped pages, real Chromium and IndexedDB.
// The canonical entry and every acquisition/navigation helper run unchanged.
// Instrumentation counts native reads and DOM events; it never supplies evidence.
// Baseline timing is descriptive. Assertions use fidelity and work counts.
const baselineRevision='b7024f5'; // Last released v6.15.30 canonical source.
const groupResource='authoringAssignmentQuestionGroups.v1';
const definitionResource='authoringAssignmentMachineEvaluableQuestions.v1';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-capture-scale-'));
const currentSource=bundleConsole(path.resolve('src/extractors/coursera/entry.js'));
const functions=extractorFunctions(currentSource);
const seedRuntime=Object.entries(config).map(([name,value])=>`const ${name}=${JSON.stringify(value)};`).join('\n')+
 '\n'+[...functions.values()].join('\n');
const baselineDirectory=path.join(scratch,'baseline');fs.mkdirSync(baselineDirectory);
const baselineArchive=path.join(scratch,'baseline.tar');
fs.writeFileSync(baselineArchive,execFileSync('git',['archive',baselineRevision,'src/extractors/coursera'],{maxBuffer:16*1024*1024}));
execFileSync('tar',['-xf',baselineArchive,'-C',baselineDirectory]);
const baselineSource=bundleConsole(path.join(baselineDirectory,'src/extractors/coursera/entry.js'));
assert(baselineSource.includes('v6.15.30'),'The comparison baseline must be the released v6.15.30 entry');
const baselineSeedRuntime=fs.readFileSync(path.join(baselineDirectory,'src/extractors/coursera/config.js'),'utf8').replace(/export /g,'')+
 '\n'+[...extractorFunctions(baselineSource).values()].join('\n');

const repeat=(prefix,length)=>prefix+' '+('Synthetic content data retained. ').repeat(Math.ceil(length/29)).slice(0,length);
const groupId=(assignment,n)=>assignment+'~group_'+String(n).padStart(4,'0');
const questionId=(assignment,n)=>assignment+'~question_'+String(n).padStart(4,'0')+'@'+(n%3+1);
const prompt=(n,rich=false)=>rich?repeat('Synthetic scenario '+n+'?',50):'Which result is correct for synthetic scenario '+n+'?';
const label=(n,k,rich=false)=>rich?repeat('Choice '+k+' scenario '+n,35):'Choice '+k+' for synthetic scenario '+n+' café 日本語';
const feedback=(n,k,rich=false)=>rich?repeat('Feedback '+k+' scenario '+n,45):'Independent feedback '+k+' for synthetic scenario '+n+'.';
const correctId=n=>'option-'+(n%4+1);
const cml=text=>({typeName:'cml',definition:{dtdId:'assess/1',value:'<co-content><p>'+text+'</p></co-content>',
 renderableHtmlWithMetadata:{metadata:{hasMath:false,isPlainText:true,hasAssetBlock:false,hasCodeBlock:false},renderableHtml:'<p>'+text+'</p>'},
 untouchedFixtureMetadata:{unicode:'café 日本語',formula:'x² + y² = z²',unknown:[false,0,null]}}});
function group(assignment,n){return {id:groupId(assignment,n),scoringWeight:1,questions:[questionId(assignment,n)],validation:{isReadyForPublish:true}};}
function definition(assignment,n,rich=false){return {id:questionId(assignment,n),definition:{typeName:'mcq',definition:{
 shuffleOptions:false,prompt:cml(prompt(n,rich)),options:[1,2,3,4].map(k=>({id:'option-'+k,display:cml(label(n,k,rich)),feedback:cml(feedback(n,k,rich))})),
 correctOption:correctId(n)}},validation:{typeName:'multipleChoiceValidation',definition:{isReadyForPublish:true}}};}
function parsedQuestion(assignment,n,rich=false){return {id:String(n),courseraQuestionId:groupId(assignment,n),sourceDefinitionId:questionId(assignment,n),
 questionOrdinalObserved:true,observationMethod:'AUTHORING_API_MATCHED_TO_LIVE_OUTLINE',type:'single-select',rawType:'mcq',prompt:prompt(n,rich),
 options:[1,2,3,4].map(k=>({id:'option-'+k,text:label(n,k,rich),label:label(n,k,rich),feedback:feedback(n,k,rich),correct:correctId(n)==='option-'+k})),
 correctAnswers:[label(n,n%4+1,rich)],optionTextReliable:true,answerTextReliable:true,shuffleOptions:false,points:null};}
function payloadBase(){return {captureAttempts:1,textSample:'',textConfidence:'none',textEvidenceCompleteness:0,files:[],links:[],images:[],embeddedRefs:[],assetDetails:[]};}
function completedSeed(){
 const fingerprints=[];
 for(let i=0;i<25;i++){
  const id='complete-assessment-'+i,assignment='SeedAssignment_'+i;
  fingerprints.push({id,name:'Completed synthetic assessment '+i,type:'Assignment',typeName:'staffGraded',path:'',evidenceLevel:'active-editor',evidenceSources:['synthetic-prior-observation'],
   payload:{...payloadBase(),rawSnapshot:{id,unknownOriginalWrapper:{zero:0,flag:false,unicode:'café 日本語',formula:'∫₀¹ x² dx',sequence:[null,'preserve']}},
    assessmentApiEvidence:{courseId:'seed',itemId:id,groups:Array.from({length:100},(_,j)=>group(assignment,j+1)),questionDefinitions:Array.from({length:100},(_,j)=>definition(assignment,j+1,true))},
    structuredAssessment:{questionCount:100,declaredQuestionCount:100,questions:Array.from({length:100},(_,j)=>parsedQuestion(assignment,j+1,true))}}});
 }
 for(let i=0;i<107;i++){
  const id='complete-reading-'+i,text=repeat('Completed observed reading '+i,1000);
  fingerprints.push({id,name:'Completed synthetic reading '+i,type:'Reading',typeName:'supplement',path:'',evidenceLevel:'active-editor',evidenceSources:['synthetic-prior-observation'],
   payload:{...payloadBase(),textSample:text,textConfidence:'high',textEvidenceCompleteness:1,textScopeKind:'reading-content-field',
    textCaptureEvidence:{method:'EXACT_READING_FIELD',scope:'EXACT_READING_FIELD',itemId:id,observedCharacters:text.length,capturedCharacters:text.length},
    rawSnapshot:{id,originalHtml:'<article>'+repeat('Preserved original synthetic content '+i,12000)+'</article>',unknownOriginalWrapper:{unicode:'café 日本語',formula:'∫₀¹ x² dx',sequence:[false,0,null]}}}});
 }
 return fingerprints;
}
const completed=completedSeed(),payloadBytes=Buffer.byteLength(JSON.stringify(completed.map(fp=>fp.payload)));
assert.equal(completed.length,132);assert(payloadBytes>=16*1024*1024&&payloadBytes<=21*1024*1024,'Keep the seeded corpus comparable to the observed 17 MB completed-item payload');
const cases=new Map();
function createCase(name,{remainingReadings=4,bankCount=0,collapsed=false,seed=true,recoveryCount=0}={}){
 const courseId='Scale_'+name+'_course_123',assignment='Assignment_'+name+'_123',shell='https://www.coursera.org/teach/synthetic/'+courseId+'/content/edit';
 const prior=seed?completed:[],materials=[...prior.map(({id,name,typeName})=>({id,name,typeName})),
  ...Array.from({length:remainingReadings},(_,i)=>({id:'reading-'+i,name:'New synthetic reading '+i,typeName:'supplement'})),
  ...(bankCount?[{id:'bank',name:'Large synthetic bank',typeName:'staffGraded'}]:[])];
 const state={name,courseId,assignment,shell,remainingReadings,bankCount,collapsed,seed,recoveryCount,materials,active:0,maxConcurrent:0,requests:[]};cases.set(courseId,state);return state;
}
function fixtureHtml(state){
 const setup={courseId:state.courseId,assignment:state.assignment,materials:state.materials,bankCount:state.bankCount,collapsed:state.collapsed};
 return '<!doctype html><meta charset="utf-8"><title>Measured synthetic course</title><style>body{margin:0;font:16px Arial}main{padding:15px}#course-outline{height:560px;overflow-y:auto}#course-outline .item{min-height:260px}#editor{display:flex;gap:20px}#rail{width:420px;height:560px;overflow-y:auto;flex-shrink:0}#rows{position:relative}#rows [data-testid=assignment-outline]{position:absolute;height:32px;width:410px}#content{width:650px;min-height:560px}a{display:inline-block}section{padding:5px}[aria-label="Reading Content"]{width:800px;min-height:520px;white-space:pre-wrap}</style><div id="app"></div><script>('+pageFixture.toString()+')('+JSON.stringify(setup)+',{'+'groupId:'+groupId.toString()+',questionId:'+questionId.toString()+',prompt:'+prompt.toString()+',label:'+label.toString()+',feedback:'+feedback.toString()+',correctId:'+correctId.toString()+'});</script>';
}
function pageFixture(setup,helpers){
 const {courseId,assignment,materials,bankCount,collapsed}=setup,{groupId,questionId,prompt,label,feedback,correctId}=helpers;
 const key='scale-observations-'+courseId,app=document.getElementById('app');
 function observations(){return JSON.parse(sessionStorage.getItem(key)||'{"readingMounts":[],"outlineScrollEvents":0,"railScrollEvents":0,"questionClicks":[],"expansions":0,"railRestores":[]}');}
 function record(update){const value=observations();update(value);sessionStorage.setItem(key,JSON.stringify(value));}
 function outline(){
  app.innerHTML='<main id="course-outline"><h1>Course content</h1></main>';const root=document.getElementById('course-outline');
  root.addEventListener('scroll',()=>record(o=>o.outlineScrollEvents++));
  let holder=root;
  if(collapsed){const button=document.createElement('button');button.textContent='Synthetic module';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','module-items');
   const children=document.createElement('div');children.id='module-items';children.hidden=true;root.append(button,children);holder=children;
   button.onclick=()=>{children.hidden=false;button.setAttribute('aria-expanded','true');record(o=>o.expansions++);};}
  for(const material of materials){const row=document.createElement('div');row.className='item';row.dataset.itemId=material.id;
   const anchor=document.createElement('a');anchor.dataset.itemId=material.id;anchor.textContent=material.name;
   anchor.href='/teach/synthetic/'+courseId+'/content/item/'+(material.typeName==='supplement'?'supplement':'project')+'/'+material.id;
   anchor.onclick=event=>{event.preventDefault();history.replaceState(history.state,'',anchor.href);render();};row.append(anchor);holder.append(row);}
 }
 function reading(id){
  record(o=>o.readingMounts.push({id,documentId:window.scaleDocumentId,outlineScrollEvents:o.outlineScrollEvents,completeRawRowsRead:window.scaleNativeReads?.completedRows||0,at:Date.now()}));
  app.innerHTML='<main><h1>New synthetic reading '+id+'</h1><div role="textbox" contenteditable="true" aria-label="Reading Content" data-testid="'+courseId+'+'+id+'"></div></main>';
  document.querySelector('[aria-label="Reading Content"]').textContent='Complete local browser observation for '+id+'. café 日本語 ∑x². '+('Read and retain this synthetic course content. ').repeat(180);
 }
 function bank(){
  app.innerHTML='<main id="editor"><aside id="rail" data-testid="item-layout-left-sidebar"><p>Assignment outline Content ('+bankCount+')</p><div id="rows" style="height:'+bankCount*32+'px"></div></aside><div id="content" data-testid="item-layout-content"></div></main>';
  const rail=document.getElementById('rail'),rows=document.getElementById('rows'),content=document.getElementById('content');
  function mountQuestion(n){content.innerHTML='<section id="'+groupId(assignment,n)+'" data-testid="assignment-part-'+(n-1)+'"><h3>'+n+' Auto-Graded 1 point</h3><p>Question Type Multiple Choice Prompt</p><p>'+prompt(n)+'</p><p>Options</p>'+[1,2,3,4].map(k=>'<div data-testid="option"><p>'+label(n,k)+'</p><span>'+(correctId(n)==='option-'+k?'Correct':'Incorrect')+'</span><p>'+feedback(n,k)+'</p></div>').join('')+'<p>Export Settings</p></section>';}
  function renderRail(){const first=Math.max(0,Math.min(bankCount-27,Math.floor(rail.scrollTop/32)));rows.replaceChildren();
   for(let i=first;i<Math.min(bankCount,first+27);i++){const n=i+1,row=document.createElement('div');row.dataset.testid='assignment-outline';row.style.top=i*32+'px';row.setAttribute('data-rbd-drag-handle-draggable-id',groupId(assignment,n));
    const ordinal=document.createElement('span');ordinal.textContent=n+' ';const anchor=document.createElement('a');anchor.href='#'+groupId(assignment,n);anchor.textContent=prompt(n);anchor.onclick=event=>{event.preventDefault();record(o=>o.questionClicks.push(n));mountQuestion(n);};row.append(ordinal,anchor);rows.append(row);}}
  rail.addEventListener('scroll',()=>{record(o=>o.railScrollEvents++);renderRail();});rail.scrollTop=64;renderRail();mountQuestion(1);
  const nativeFetch=fetch.bind(window);Promise.all([nativeFetch('/api/authoringAssignmentQuestionGroups.v1/'+groupId(assignment,1)+'?id='+encodeURIComponent(groupId(assignment,1))+'&fields=id,questions,scoringWeight,validation').then(r=>r.text()),
   nativeFetch('/api/authoringAssignmentMachineEvaluableQuestions.v1/'+questionId(assignment,1)+'?fields=id,definition,validation').then(r=>r.text())]);
  window.scaleRail=rail;
 }
 function render(){const match=location.pathname.match(/\/content\/item\/([^/]+)\/([^/]+)$/);if(match?.[1]==='supplement')reading(match[2]);else if(match?.[2]==='bank')bank();else outline();}
 window.addEventListener('popstate',render);render();window.scaleFixtureReady=true;
}

execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},async(request,response)=>{
 const url=new URL(request.url,'https://www.coursera.org'),pathname=decodeURIComponent(url.pathname);
 const state=[...cases.values()].find(c=>pathname.includes('/'+c.courseId+'/')||pathname.endsWith('/'+c.courseId)||pathname.includes(c.assignment)||String(request.headers.referer||'').includes('/'+c.courseId+'/'));
 if(!state){response.writeHead(404);response.end('Unknown synthetic course');return;}
 if(!pathname.startsWith('/api/')){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixtureHtml(state));return;}
 response.setHeader('Content-Type','application/json');
 const resource=pathname.split('/')[2];
 if(resource==='authoringCourseMaterials.v1'){response.end(JSON.stringify({elements:state.materials}));return;}
 if(![groupResource,definitionResource].includes(resource)){response.end('{}');return;}
 const ids=url.searchParams.has('ids')?url.searchParams.get('ids').split(','):[pathname.split('/')[3]||url.searchParams.get('id')].filter(Boolean);
 state.active++;state.maxConcurrent=Math.max(state.maxConcurrent,state.active);state.requests.push({resource,ids,method:request.method,isBatch:url.searchParams.has('ids')});
 try{await new Promise(resolve=>setTimeout(resolve,5));
  const lookup=new Map(Array.from({length:state.bankCount},(_,i)=>[resource===groupResource?groupId(state.assignment,i+1):questionId(state.assignment,i+1),i+1]));
  response.end(JSON.stringify({elements:ids.filter(id=>lookup.has(id)).map(id=>resource===groupResource?group(state.assignment,lookup.get(id)):definition(state.assignment,lookup.get(id))).reverse(),paging:{},linked:{}}));
 }finally{state.active--;}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}`]});
 async function runCase(state,source,{large=false,baseline=false}={}){
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  await context.addInitScript(({courseId})=>{
   const measureKey='scale-batch-receipts-'+courseId,activeKey='scale-measure-active-'+courseId;
   window.scaleDocumentId=crypto.randomUUID();
   window.scaleNativeReads={rawRows:0,completedRows:0,metadataRows:0};
   function observe(request,storeName){request.addEventListener('success',()=>{
    if(sessionStorage.getItem(activeKey)!=='1')return;
    const values=Array.isArray(request.result)?request.result:[request.result];
    for(const row of values){if(!row||typeof row!=='object')continue;
     if(storeName==='item-checkpoints'&&row.fingerprint){window.scaleNativeReads.rawRows++;if(String(row.itemId||'').startsWith('complete-'))window.scaleNativeReads.completedRows++;}
     else if(storeName==='item-checkpoint-manifests'&&row.itemId)window.scaleNativeReads.metadataRows++;
    }
   });return request;}
   for(const Constructor of [IDBObjectStore,IDBIndex])for(const method of ['get','getAll','openCursor']){
    const original=Constructor.prototype[method];Constructor.prototype[method]=function(...args){return observe(original.apply(this,args),this instanceof IDBObjectStore?this.name:this.objectStore.name);};}
   let actualResult;
   Object.defineProperty(window,'__CTI_LAST_RESULT',{configurable:true,get:()=>actualResult,set:result=>{
    actualResult=result;if(sessionStorage.getItem(activeKey)!=='1')return;
    const receipts=JSON.parse(sessionStorage.getItem(measureKey)||'[]');
    receipts.push({at:Date.now(),documentId:window.scaleDocumentId,reads:{...window.scaleNativeReads},checkpointResume:result?.meta?.checkpointResume,checkpointMaterialization:result?.meta?.checkpointMaterialization,
     localCaptureBatch:result?.meta?.localCaptureBatch,runtime:result?.meta?.runtime,outlineHydration:result?.meta?.outlineHydration,
     automatic:result?.meta?.automaticLocalCapture,inventory:result?.fingerprints?.length,complete:result?.meta?.captureAccounting?.completeCount,
     bankApi:result?.fingerprints?.find(fp=>fp.id==='bank')?.payload?.captureDiagnostics?.authoringAssessmentApi,
     questionBank:result?.meta?.activeSpaCrawl?.targetDiagnostics?.find(d=>d.id==='bank')});
    sessionStorage.setItem(measureKey,JSON.stringify(receipts));
   }});
  },{courseId:state.courseId});
  const page=await context.newPage(),downloads=[],errors=[];page.on('download',download=>downloads.push(download));page.on('pageerror',error=>errors.push(error.message));
  await page.goto(state.shell);await page.waitForFunction(()=>scaleFixtureReady);
  if(state.seed){
   await page.addScriptTag({content:baseline?baselineSeedRuntime:seedRuntime});
   const seedReceipt=await page.evaluate(async({completed,courseId,bankCount,assignment})=>{
    const manager=await createCheckpointManagerV6150(courseId);if(!manager.available)throw Error(manager.error);
    let count=0;
    for(const fp of completed){
     if(fp.payload.structuredAssessment){const model=fp.payload.structuredAssessment;model.captureCompleteness=assessmentCaptureCoverageV613(model.questions,100,'COMPLETE_ITEM_BOUND_AUTHORING_API');}
     if(fp.payload.assessmentApiEvidence)fp.payload.assessmentApiEvidence.courseId=courseId;
     if(!captureContractV6150(fp).complete)throw Error('Synthetic completed row has no completion proof: '+fp.id);
     if(!await manager.save(fp,{id:fp.id,completed:true,captureContract:captureContractSummaryV6150(fp)},'synthetic-prior-observation'))throw Error('Seed save failed');count++;
    }
    if(bankCount){const questions=Array.from({length:11},(_,i)=>({id:String(i+1),courseraQuestionId:assignment+'~group_'+String(i+1).padStart(4,'0'),
     questionOrdinalObserved:true,type:'single-select',prompt:'Prior partial observed question '+(i+1),options:[],correctAnswers:[],optionTextReliable:false,answerTextReliable:false}));
     const fp={id:'bank',name:'Large synthetic bank',type:'Assignment',typeName:'staffGraded',path:'',payload:{captureAttempts:0,textSample:'',files:[],links:[],images:[],embeddedRefs:[],assetDetails:[],
      rawSnapshot:{fixture:'partial bank evidence remains distinct'},assessmentCaptureInProgress:{state:'IN_PROGRESS',assessment:{declaredQuestionCount:bankCount,questionCount:11,questions}}}};
     if(!await manager.save(fp,{id:fp.id,completed:false},'synthetic-partial-observation'))throw Error('Partial seed save failed');count++;
    }
    manager.close();return {count,runKey:manager.runKey};
   },{completed,courseId:state.courseId,bankCount:state.bankCount,assignment:state.assignment});
   assert.equal(seedReceipt.count,132+(state.bankCount?1:0));
  }
  await page.evaluate(courseId=>{sessionStorage.setItem('scale-measure-active-'+courseId,'1');window.scaleNativeReads={rawRows:0,completedRows:0,metadataRows:0};},state.courseId);
  const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
  const token='scale_'+state.name+'_token_123';
  if(state.recoveryCount && !baseline)await page.evaluate(({courseId,token,recoveryCount})=>{
   // Exercise a previously acknowledged recovery's smaller document budget.
   // This fixture does not pretend to trigger a real renderer crash.
   localStorage.setItem('__CTI_AUTOMATIC_LOCAL_V61517_'+token,JSON.stringify({state:'RUNNING',token,courseId,
    startedAt:Date.now(),updatedAt:Date.now(),batches:0,stalled:0,captureMode:'RESUME_AVAILABLE_WORK',
    checkpointRunId:'',supervisorRecoveries:recoveryCount}));
  },{courseId:state.courseId,token,recoveryCount:state.recoveryCount});
  const command=JSON.parse(createAutomaticLocalCourseraCommand(state.shell,source,token));
  const started=Date.now();await cdp.send(command.cmd,command.args);
  await page.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:large?240000:120000});
  if(!downloads.length)await page.waitForEvent('download',{timeout:10000});
  assert.equal(downloads.length,1,'Only the final automatic capture should download');
  const capture=JSON.parse(fs.readFileSync(await downloads[0].path(),'utf8'));
  const observed=await page.evaluate(courseId=>({batches:JSON.parse(sessionStorage.getItem('scale-batch-receipts-'+courseId)||'[]'),observations:JSON.parse(sessionStorage.getItem('scale-observations-'+courseId)),
   railPosition:window.scaleRail?.isConnected?window.scaleRail.scrollTop:null}),state.courseId);
  assert.deepEqual(errors,[]);assert.equal(evaluateCourseraCapture(capture,state.courseId).complete,true,
   'Synthetic capture incomplete: '+JSON.stringify({reason:capture.meta.automaticLocalCapture.reason,accounting:capture.meta.captureAccounting.unresolved}));
  assert.equal(capture.fingerprints.length,state.materials.length);
  for(const expected of state.seed?completed:[]){const fp=capture.fingerprints.find(row=>row.id===expected.id);assert(fp);assert.deepEqual(fp.payload.rawSnapshot,expected.payload.rawSnapshot,'Completed original raw snapshot changed');
   if(expected.payload.assessmentApiEvidence){const wanted={...expected.payload.assessmentApiEvidence,courseId:state.courseId};assert.deepEqual(fp.payload.assessmentApiEvidence,wanted,'Completed original CML/IDs/keys/feedback wrappers changed');}}
  const readingMounts=observed.observations.readingMounts.filter(row=>row.id.startsWith('reading-'));
  assert.equal(new Set(readingMounts.map(row=>row.id)).size,state.remainingReadings);
  assert.equal(readingMounts.length,state.remainingReadings,'Completed readings were reopened in later documents');
  if(!baseline){assert(readingMounts.every(row=>row.outlineScrollEvents===0),'Certified direct readings warmed or reset the full course outline');
   assert(readingMounts.every(row=>row.completeRawRowsRead===0),'Completed raw payload was loaded before direct reading acquisition');
   if(state.seed){assert(observed.batches[0].checkpointResume.deferred>=132,'Completed raw rows were not deferred');assert.equal(observed.batches[0].checkpointResume.loaded,state.bankCount?1:0,'Only incomplete raw rows should be loaded at initial restore');}}
  else {assert(readingMounts[0].outlineScrollEvents>0,'The released baseline must demonstrate its eager outline warmup');assert(readingMounts[0].completeRawRowsRead>=132,'The released baseline did not read the completed raw corpus');}
  const documentVisits=observed.batches.map(batch=>Number(batch.localCaptureBatch?.visits || 0));
  if(!baseline){
   const visitLimit=state.recoveryCount?config.CTI_LOCAL_MANAGED_RECOVERY_MAX_VISITS_V61532:config.CTI_LOCAL_MANAGED_BATCH_MAX_VISITS_V61532;
   assert.equal(visitLimit,state.recoveryCount?4:6,'The native scale case must exercise the released managed bounds');
   assert.equal(new Set(observed.batches.map(batch=>batch.documentId)).size,observed.batches.length,'A receipt was counted twice in one document');
   for(const batch of observed.batches){
    assert.equal(batch.localCaptureBatch.managed,true);
    assert.equal(batch.localCaptureBatch.maxVisits,visitLimit);
    assert(batch.localCaptureBatch.visits<=visitLimit,'A managed document exceeded its visit budget');
    assert(readingMounts.filter(row=>row.documentId===batch.documentId).length<=visitLimit,'The fixture mounted too many reading editors in a document');
   }
   assert.equal(documentVisits.reduce((sum,visits)=>sum+visits,0),state.remainingReadings+(state.bankCount?1:0),'An acquired item was duplicated or omitted across renderer documents');
   if(state.seed)assert.equal(observed.batches.reduce((sum,batch)=>sum+batch.reads.completedRows,0),132,'The completed raw corpus should be read only once for final materialization');
  }

  if(state.bankCount){
   const bank=capture.fingerprints.find(fp=>fp.id==='bank'),model=bank.payload.structuredAssessment;
   assert.equal(model.questionCount,state.bankCount);assert.equal(model.captureCompleteness.requiredAnswerCoverageComplete,true);
   assert.deepEqual(model.questions.map(q=>q.courseraQuestionId),Array.from({length:state.bankCount},(_,i)=>groupId(state.assignment,i+1)));
   assert.deepEqual(model.questions.map(q=>q.sourceDefinitionId),Array.from({length:state.bankCount},(_,i)=>questionId(state.assignment,i+1)));
   assert.deepEqual(model.questions.map(q=>q.correctAnswers),Array.from({length:state.bankCount},(_,i)=>[label(i+1,(i+1)%4+1)]));
   assert.equal(observed.observations.questionClicks.length,0,'The API bank rendered individual question editors');
   assert(state.maxConcurrent<=2,'Authoring API requests exceeded bounded concurrency');
   assert(state.requests.every(r=>r.method==='GET'&&r.ids.length<=15&&r.ids.every(id=>Array.from({length:state.bankCount},(_,i)=>r.resource===groupResource?groupId(state.assignment,i+1):questionId(state.assignment,i+1)).includes(id))));
   if(state.bankCount>27)assert(observed.observations.railScrollEvents>1,'Large bank identities were not observed across the actual virtual rail');
   if(state.collapsed)assert(observed.observations.expansions>0,'Collapsed non-direct outline fallback was skipped');
   if(!baseline && state.bankCount>=config.CTI_LOCAL_MANAGED_HEAVY_PARTS_V61532){
    const heavy=observed.batches.find(batch=>batch.localCaptureBatch?.yieldReason==='LOCAL_RENDERER_HEAVY_ITEM_LIMIT');
    assert(heavy,'A completed heavy assessment did not yield at its durable boundary');
    assert.equal(heavy.localCaptureBatch.heavyItems,1);
    assert(heavy.localCaptureBatch.durableItems>0,'Heavy-item yield occurred before evidence was durably checkpointed');
    assert.equal(heavy.automatic.state,'RUNNING','A heavy editor must yield before final materialization');
    assert.equal(heavy.checkpointMaterialization,undefined,'Heavy-item document materialized completed raw payloads');
    assert.equal(heavy.reads.completedRows,0,'Heavy editor retained the completed raw corpus before cleanup');
    const final=observed.batches.at(-1);
    assert.notEqual(final.documentId,heavy.documentId);
    assert.equal(final.localCaptureBatch.visits,0,'Final cleanup document reopened an editor');
    assert.equal(final.automatic.state,'FINISHED');
    assert.equal(readingMounts.filter(row=>row.documentId===final.documentId).length,0);
    assert(final.checkpointMaterialization.loaded>=132,'Cleanup document did not materialize the old raw corpus');
   }

  }
  const receipt={mode:state.name,elapsedMs:Date.now()-started,items:capture.fingerprints.length,batches:capture.meta.automaticLocalCapture.batches,
   documentVisits,recoveryCount:state.recoveryCount,completedSeedPayloadBytes:state.seed?payloadBytes:0,rawRowsRead:observed.batches.reduce((sum,batch)=>sum+batch.reads.rawRows,0),
   completedRawRowsRead:observed.batches.reduce((sum,batch)=>sum+batch.reads.completedRows,0),metadataRowsRead:observed.batches.reduce((sum,batch)=>sum+batch.reads.metadataRows,0),
   firstReadingOutlineScrollEvents:readingMounts[0]?.outlineScrollEvents||0,firstReadingCompletedRawReads:readingMounts[0]?.completeRawRowsRead||0,
   outlineScrollEvents:observed.observations.outlineScrollEvents,railScrollEvents:observed.observations.railScrollEvents,questionEditorClicks:observed.observations.questionClicks.length,
   apiRequests:state.requests.length,maxApiConcurrency:state.maxConcurrent,restoreReceipts:observed.batches.map(batch=>batch.checkpointResume),
   setupMs:observed.batches.map(batch=>batch.runtime?.setupMs)};
  console.log(JSON.stringify({status:'PASS',...receipt}));await context.close();return receipt;
 }
 const controls=[];
 for(let repetition=0;repetition<3;repetition++){
  controls.push({baseline:await runCase(createCase('baseline_'+repetition),baselineSource,{baseline:true}),current:await runCase(createCase('current_'+repetition),currentSource)});
 }
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 console.log(JSON.stringify({status:'PASS',comparison:{baselineRevision,repetitions:3,baselineMedianMs:median(controls.map(c=>c.baseline.elapsedMs)),currentMedianMs:median(controls.map(c=>c.current.elapsedMs)),
  baselineFirstReadingRawRows:controls.map(c=>c.baseline.firstReadingCompletedRawReads),currentFirstReadingRawRows:controls.map(c=>c.current.firstReadingCompletedRawReads),
  baselineFirstReadingOutlineScrolls:controls.map(c=>c.baseline.firstReadingOutlineScrollEvents),currentFirstReadingOutlineScrolls:controls.map(c=>c.current.firstReadingOutlineScrollEvents)},
  scope:'Identical synthetic 132-row completed corpus and four real rendered readings; descriptive wall times, no elapsed-time pass threshold.'}));
 const large=await runCase(createCase('large',{remainingReadings:28,bankCount:609}),currentSource,{large:true});
 assert(large.batches>=Math.ceil(29/config.CTI_LOCAL_MANAGED_BATCH_MAX_VISITS_V61532)+1,'Managed acquisition needs bounded documents plus a separate heavy-editor cleanup document');
 await runCase(createCase('recovered',{remainingReadings:10,recoveryCount:1}),currentSource);
 await runCase(createCase('collapsed',{remainingReadings:0,bankCount:3,collapsed:true,seed:false}),currentSource);
 console.log(JSON.stringify({status:'PASS',scope:'Real canonical Chrome continuation, completed raw deferred until final export, unchanged original rich wrappers, direct reading zero warmup, collapsed outline fallback, six-visit managed / four-visit recovery bounds, heavy-bank cleanup-only document, and 609 virtual identities with zero question-editor clicks. Synthetic fixture does not measure live Coursera latency or certify every content type.'}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
