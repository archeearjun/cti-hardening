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
import * as apiConfig from '../src/extractors/coursera/assessment-api.js';

// Synthetic definitions follow the observed authoring group -> versioned MCQ
// schema. No uploaded response, question text, token, or account is used here.
// All canonical cycle/navigation/assessment helpers execute unchanged.
const courseId='Assessment_api_fixture_123',itemId='assessment-under-test';
const rootId='SyntheticAssignment_123456',count=100;
const shell=`https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const editorUrl=shell+'/assessment/'+itemId;
const groupResource='authoringAssignmentQuestionGroups.v1';
const questionResource='authoringAssignmentMachineEvaluableQuestions.v1';
const groupId=n=>rootId+'~group_'+String(n).padStart(3,'0');
const questionId=n=>rootId+'~question_'+String(n).padStart(3,'0')+'@'+(n%3+1);
// Equal prompts still belong to distinct observed groups and versioned keys.
const prompt=n=>'Which result is correct for synthetic scenario '+(n===88?87:n)+'?';
const label=(n,k)=>'Option '+k+' for scenario '+n+' café 日本語';
const feedback=(n,k)=>'Feedback '+k+' for scenario '+n+'; kept separately.';
const cml=text=>({typeName:'cml',definition:{dtdId:'assess/1',
 value:'<co-content><p>'+text+'</p></co-content>',
 renderableHtmlWithMetadata:{metadata:{hasMath:false,isPlainText:true,hasAssetBlock:false,hasCodeBlock:false},renderableHtml:'<p>'+text+'</p>'}}});
const correctId=n=>'option-'+(n%4+1);
function group(n){return {id:groupId(n),scoringWeight:1,questions:[questionId(n)],
 writeAccessToken:'SYNTHETIC_SECRET_MUST_BE_OMITTED',validation:{isReadyForPublish:true}};}
function question(n){return {id:questionId(n),writeAccessToken:'SYNTHETIC_SECRET_MUST_BE_OMITTED',
 definition:{typeName:'mcq',definition:{shuffleOptions:false,prompt:cml(prompt(n)),
 options:Array.from({length:4},(_,i)=>({id:'option-'+(i+1),display:cml(label(n,i+1)),feedback:cml(feedback(n,i+1))})),correctOption:correctId(n)}},
 validation:{typeName:'multipleChoiceValidation',definition:{isReadyForPublish:true}}};}
const groupLookup=new Map(Array.from({length:count},(_,i)=>[groupId(i+1),i+1]));
const questionLookup=new Map(Array.from({length:count},(_,i)=>[questionId(i+1),i+1]));

function fixtureHtml(virtualRail=false,unhydratedFirst=false){
 const rows=Array.from({length:count},(_,i)=>{const n=i+1;return '<div data-testid="assignment-outline" data-rbd-drag-handle-draggable-id="'+groupId(n)+'"><span>'+n+' </span><a href="#'+groupId(n)+'" data-n="'+n+'">'+prompt(n)+'</a></div>';}).join('');
 const warmGroup='/api/'+groupResource+'/'+groupId(1)+'?fields=id,scoringWeight,questions,validation';
 const warmQuestion='/api/'+questionResource+'/'+questionId(1)+'?fields=id,definition,validation';
 return `<!doctype html><meta charset="utf-8"><style>
 #editor{display:flex;gap:20px}#rail{width:420px;height:${virtualRail?320:560}px;overflow-y:auto;flex-shrink:0}#content{width:650px;min-height:560px}
 [data-testid=assignment-outline]{min-height:26px}a{display:inline-block}section{padding:5px}
 ${virtualRail?`#rows{height:${count*32}px;position:relative}#rows [data-testid=assignment-outline]{position:absolute;height:32px;width:410px}`:''}
 </style><main id="editor"><aside id="rail" data-testid="item-layout-left-sidebar"><p>Assignment outline Content (${count})</p>${virtualRail?'<div id="rows"></div>':rows}</aside><div id="content" data-testid="item-layout-content"></div></main>
 <script>
 window.questionClicks=[];window.fixtureReady=false;window.railScrollEvents=0;
 const rootId=${JSON.stringify(rootId)};
 const unhydratedFirst=${JSON.stringify(unhydratedFirst)};
 const content=document.getElementById('content');
 const prompt=${prompt.toString()},label=${label.toString()},feedback=${feedback.toString()};
 const groupId=${groupId.toString()},correctId=${correctId.toString()};
 function mount(n){content.innerHTML='<section id="'+groupId(n)+'" data-testid="assignment-part-'+(n-1)+'"><h3>'+n+' Auto-Graded 1 point</h3><p>Question Type Multiple Choice Prompt</p><p>'+prompt(n)+'</p><p>Options</p>'+[1,2,3,4].map(k=>'<div data-testid="option"><p>'+label(n,k)+'</p>'+(unhydratedFirst&&n===1?'':'<span>'+(correctId(n)==='option-'+k?'Correct':'Incorrect')+'</span>')+'</div>').join('')+'<p>Export Settings</p></section>'}
 function listenToQuestions(){document.querySelectorAll('a[data-n]').forEach(anchor=>anchor.onclick=event=>{event.preventDefault();const n=Number(anchor.dataset.n);questionClicks.push(n);mount(n)})}
 ${virtualRail?`const rail=document.getElementById('rail'),rows=document.getElementById('rows');
 function renderRail(){
  const first=Math.min(90,Math.max(0,Math.floor(rail.scrollTop/32)));rows.replaceChildren();
  for(let i=first;i<Math.min(${count},first+10);i++){
   const n=i+1,row=document.createElement('div');row.dataset.testid='assignment-outline';row.style.top=i*32+'px';row.setAttribute('data-rbd-drag-handle-draggable-id',groupId(n));
   const number=document.createElement('span');number.textContent=n+' ';const anchor=document.createElement('a');anchor.href='#'+groupId(n);anchor.dataset.n=String(n);anchor.textContent=prompt(n);row.append(number,anchor);rows.append(row);
  }listenToQuestions();
 }
 rail.addEventListener('scroll',()=>{railScrollEvents++;renderRail()});rail.scrollTop=64;renderRail();`:'listenToQuestions();'}mount(1);
 Promise.all([fetch(${JSON.stringify(warmGroup)}).then(r=>r.text()),fetch(${JSON.stringify(warmQuestion)}).then(r=>r.text())]).then(()=>fixtureReady=true);
 </script>`;
}

const definitions=extractorFunctions(bundleConsole(path.resolve('src/extractors/coursera/entry.js')));
assert(definitions.has('collectCourseraAssessmentApiV61524'),'API helper must be linked into the canonical entry');
const runtimeConstants={...config,...Object.fromEntries(Object.entries(apiConfig).filter(([name])=>name.startsWith('CTI_ASSESSMENT_API_')))};
const runtime=Object.entries(runtimeConstants).map(([name,value])=>`const ${name}=${JSON.stringify(value)};`).join('\n')+'\n'+[...definitions.values()].join('\n');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-assessment-api-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
let mode='batch',active=0,maximumActive=0,requests=[];
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},async(request,response)=>{
 const url=new URL(request.url,'https://www.coursera.org');
 if(!url.pathname.startsWith('/api/')){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixtureHtml(url.searchParams.has('virtual'),url.searchParams.has('partial')));return;}
 active++;maximumActive=Math.max(maximumActive,active);
 const pathname=decodeURIComponent(url.pathname),resource=pathname.split('/')[2];
 const requestedIds=url.searchParams.has('ids')?url.searchParams.get('ids').split(','):pathname.split('/')[3]?[pathname.split('/')[3]]:url.searchParams.has('id')?[url.searchParams.get('id')]:[];
 const isBatch=url.searchParams.has('ids');
 requests.push({method:request.method,resource,pathname,ids:requestedIds,fields:url.searchParams.get('fields'),isBatch});
 response.setHeader('Content-Type','application/json');
 try{
  await new Promise(resolve=>setTimeout(resolve,15));
  if(![groupResource,questionResource].includes(resource)){response.writeHead(404);response.end('{}');return;}
  if(mode==='authentication'){response.writeHead(401);response.end('{}');return;}
  if(mode==='single'&&isBatch){response.writeHead(400);response.end('{}');return;}
  const lookup=resource===groupResource?groupLookup:questionLookup;
  let elements=requestedIds.filter(id=>lookup.has(id)).map(id=>resource===groupResource?group(lookup.get(id)):question(lookup.get(id))).reverse();
  if(mode==='duplicate-response'&&isBatch&&elements.length>1)elements[1]=structuredClone(elements[0]);
  if(mode==='duplicate-reference'&&resource===groupResource)for(const e of elements)if(e.id===groupId(2))e.questions=[questionId(1)];
  if(['missing-key','partial'].includes(mode)&&resource===questionResource)for(const e of elements)if(e.id===questionId(55))e.definition.definition.correctOption='unobserved-option';
  response.end(JSON.stringify({elements,paging:{},linked:{}}));
 }finally{active--;}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}`]});
 const errors=[];
 async function openCase(nextMode){
  mode='batch';active=0;maximumActive=0;requests=[];
  const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();
  const observedRequests=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))observedRequests.push({url:request.url(),method:request.method()});});
  page.on('pageerror',e=>errors.push(e.message));await page.goto(editorUrl+(nextMode==='virtual'?'?virtual=1':nextMode==='partial'?'?partial=1':''));await page.waitForFunction(()=>fixtureReady);
  assert(await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/')).length>=2));
  const warmupRequests=observedRequests.map(request=>({...request}));
  assert.equal(warmupRequests.length,2);
  assert(warmupRequests.every(observed=>observed.method==='GET'&&requests.some(received=>received.method===observed.method&&received.pathname===decodeURIComponent(new URL(observed.url).pathname))),'Explicit warmup GETs were not received by the fixture server');
  await page.addScriptTag({content:runtime});
  mode=nextMode;maximumActive=0;requests=[];
  return {context,page,warmupRequests};
 }
 function assertRequests(){
  assert(maximumActive<=2,'Assessment API requests exceeded the bounded concurrency');
  assert(requests.every(r=>r.method==='GET'&&[groupResource,questionResource].includes(r.resource)),'Unexpected API route or method');
  assert(requests.every(r=>r.ids.length<=15&&r.ids.every(id=>(r.resource===groupResource?groupLookup:questionLookup).has(id))),'Requests must use observed group identities or returned exact versioned definition references');
  assert(requests.every(r=>r.fields&&r.fields.split(',').every(field=>['id','scoringWeight','questions','definition','validation','-writeAccessToken'].includes(field))&&!r.fields.split(',').includes('writeAccessToken')),'Requested authoring write capability');
 }
 function assertComplete(observation){
  const assessment=observation.result.assessment;
  assert.equal(assessment.questionCount,count);assert.equal(assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert.equal(observation.clicks.length,0,'A complete API model must not activate question editors');
  assert.equal(observation.contract.complete,true);
  assessment.questions.forEach((q,i)=>{
   const n=i+1;assert.equal(q.id,String(n));assert.equal(q.courseraQuestionId,groupId(n));assert.equal(q.sourceDefinitionId,questionId(n));
   assert.equal(q.questionOrdinalObserved,true);assert.equal(q.prompt,prompt(n));assert.equal(q.options.length,4);
   assert.equal(q.shuffleOptions,false);assert.equal(q.points,null,'A raw group scoring weight does not prove question points');
   assert.deepEqual(q.correctAnswers,[label(n,n%4+1)]);
   q.options.forEach((o,k)=>{assert.equal(o.id,'option-'+(k+1));assert.equal(o.label||o.text,label(n,k+1));assert.equal(o.correct,o.id===correctId(n));assert.equal(o.feedback,feedback(n,k+1));});
  });
  const raw=observation.payload.assessmentApiEvidence;
  assert.equal(raw.groups.length,count);assert.equal(raw.questionDefinitions.length,count);
  const rawDefinitions=new Map(raw.questionDefinitions.map(e=>[e.id,e]));
  const rawGroups=new Map(raw.groups.map(g=>[g.id,g]));
  for(let n=1;n<=count;n++){
   const g=rawGroups.get(groupId(n));assert(g);assert.deepEqual(g.questions,[questionId(n)]);assert.equal(g.scoringWeight,1);
   const original=rawDefinitions.get(questionId(n));assert(original);
   assert.equal(original.definition.definition.prompt.definition.value,cml(prompt(n)).definition.value);
   assert.equal(original.definition.definition.correctOption,correctId(n));
  }
  assert.equal(assessment.questions[86].prompt,assessment.questions[87].prompt);
  assert.notEqual(assessment.questions[86].courseraQuestionId,assessment.questions[87].courseraQuestionId);
  assert.notDeepEqual(assessment.questions[86].correctAnswers,assessment.questions[87].correctAnswers);
  const serialized=JSON.stringify(observation);
  assert(!serialized.includes('writeAccessToken')&&!serialized.includes('SYNTHETIC_SECRET_MUST_BE_OMITTED'),'Raw acquisition exported a write capability');
  assert(serialized.includes('<co-content>')&&serialized.includes('assess/1'),'Original CML was not retained');
  assert(serialized.includes(feedback(55,1)),'Per-option feedback was not preserved independently');
 }
 for(const strategy of ['batch','single','virtual']){
  const {context,page}=await openCase(strategy);
  if(strategy==='single')await page.evaluate(()=>{
   // Mirror the entry's dedicated caller before installing its generic
   // recorder: 202 owned reads must not clone into the 48-record stream.
   window.assessmentApiFetch=fetch.bind(window);
   window.fixtureGenericRecorder=installReadOnlyNetworkRecorder();
  });
  const initialPosition=await page.evaluate(()=>({sidebar:document.getElementById('rail').scrollTop,content:document.getElementById('content').scrollTop,body:document.scrollingElement.scrollTop}));
  if(strategy==='virtual')assert.equal(await page.locator('[data-testid="assignment-outline"]').count(),10,'The fixture must mount only a ten-question rail window');
  const observation=await page.evaluate(async({courseId,itemId})=>{
   const fp={id:itemId,name:'Synthetic API assessment',type:'Assignment',typeName:'staffGraded',payload:{captureAttempts:1}};
   if(window.fixtureGenericRecorder)window.fixtureGenericRecorder.setActive(fp);
   const result=await collectCourseraAssessmentByQuestionCycleV662(document.getElementById('editor'),fp,{certifiedItem:true,courseId,deadline:Date.now()+60000});
   fp.payload.structuredAssessment=result.assessment;
   return {result,payload:fp.payload,contract:captureContractV6150(fp),clicks:questionClicks};
  },{courseId,itemId});
  if(strategy==='virtual')console.log(JSON.stringify({mode:strategy,stopReason:observation.result.stopReason,
   apiStopReason:observation.result.authoringApiStopReason,api:observation.result.authoringApi,
   captured:observation.result.assessment?.questionCount,questionClicks:observation.clicks.length}));
  assertComplete(observation);assertRequests();
  if(strategy==='single') {
   const recorder=await page.evaluate(()=>{const stats=fixtureGenericRecorder.stats();fixtureGenericRecorder.restore();return stats;});
   assert.equal(recorder.retainedRecords,0,'Dedicated API reads were duplicated in the generic recorder');
  }
  if(strategy==='virtual'){
   const after=await page.evaluate(()=>({sidebar:document.getElementById('rail').scrollTop,content:document.getElementById('content').scrollTop,body:document.scrollingElement.scrollTop,scrollEvents:railScrollEvents,anchors:document.querySelectorAll('[data-testid="assignment-outline"]').length}));
   assert(after.scrollEvents>1,'The canonical API path did not scroll the virtualized question rail');
   assert.equal(after.sidebar,initialPosition.sidebar,'Restore the original question-rail position');
   assert.equal(after.content,initialPosition.content,'API inventory discovery scrolled question content');assert.equal(after.body,initialPosition.body,'API inventory discovery scrolled the page body');
   assert.equal(after.anchors,10,'The fixture must remain virtualized after identity discovery');
   assert(observation.result.authoringApi.inventoryDiscovery.scrollSteps>0);
   assert.equal(observation.result.authoringApi.inventoryDiscovery.restored,true);
  }
  if(strategy==='single')assert(requests.filter(r=>r.isBatch).length<=2,'Unsupported batch must be probed once per resource');
  else assert(requests.every(r=>r.isBatch),'Supported batch unexpectedly fell back to individual definition requests');
  console.log(JSON.stringify({status:'PASS',mode:strategy,questions:count,questionEditorClicks:0,requests:requests.length,maxConcurrency:maximumActive,scope:'Real canonical cycle, observed HTTPS endpoints, unordered synthetic Naptime response records.'}));
  await context.close();
 }
 const partialCase=await openCase('partial');
 const partial=await partialCase.page.evaluate(async({courseId,itemId})=>{
  const fp={id:itemId,name:'Synthetic partial API assessment',type:'Assignment',typeName:'staffGraded',payload:{captureAttempts:1}};
  const charged=new Set();let checkpoints=0;
  const result=await collectCourseraAssessmentByQuestionCycleV662(document.getElementById('editor'),fp,{
   certifiedItem:true,courseId,deadline:Date.now()+60000,
   onCheckpoint:async assessment=>{
    checkpoints++;
    for(const q of assessment.questions||[])if(q.observedAtMs&&q.observationMethod!=='AUTHORING_API_MATCHED_TO_LIVE_OUTLINE')charged.add(q.courseraQuestionId);
    return true;
   },shouldYield:()=>charged.size>25?'FIXTURE_ACTUAL_RENDER_BUDGET_EXCEEDED':''
  });
  fp.payload.structuredAssessment=result.assessment;
  return {result,payload:fp.payload,contract:captureContractV6150(fp),clicks:questionClicks,charged:charged.size,checkpoints};
 },{courseId,itemId});
 assert.equal(partial.result.assessment.questionCount,count);assert.equal(partial.result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(partial.contract.complete,true);assert.deepEqual(partial.clicks,[55],'Only the question without an API key may activate its editor');
 assert.equal(partial.charged,1,'API definitions were charged to the renderer observation budget');assert(partial.checkpoints>0);
 assert.equal(partial.result.assessment.questions.filter(q=>q.observationMethod==='AUTHORING_API_MATCHED_TO_LIVE_OUTLINE').length,99,'Partial API seeds lost their source provenance');
 for(const q of partial.result.assessment.questions){
  const n=Number(q.id);assert.equal(q.courseraQuestionId,groupId(n));assert.deepEqual(q.correctAnswers,[label(n,n%4+1)]);
  if(n!==55){assert.equal(q.sourceDefinitionId,questionId(n));assert.equal(q.observationMethod,'AUTHORING_API_MATCHED_TO_LIVE_OUTLINE');}
 }
 assertRequests();assert(!JSON.stringify(partial).includes('writeAccessToken'));
 console.log(JSON.stringify({status:'PASS',mode:'99 API definitions plus one observed DOM key',questions:count,questionEditorClicks:1,chargedRendererObservations:partial.charged,scope:'Real canonical cycle preserves API provenance and only renders the missing-key question.'}));
 await partialCase.context.close();
 const modalCase=await openCase('batch');
 await modalCase.page.evaluate(shell=>history.replaceState(null,'',shell),shell);
 const modal=await modalCase.page.evaluate(async({courseId,itemId,observedRequests,questionHash})=>{
  const fp={id:itemId,name:'Synthetic modal API assessment',type:'Assignment',typeName:'staffGraded',payload:{captureAttempts:1}};
  window.assessmentApiFetch=fetch.bind(window);
  const recorder=installReadOnlyNetworkRecorder();recorder.setActive(fp);
  // Observe actual reads through the maintained recorder. These resource
  // bodies are excluded from its generic filter; only bounded GET receipts
  // may bind the fresh modal's dedicated definition reader.
  await Promise.all(observedRequests.map(observed=>{
   const url=new URL(observed.url);url.searchParams.set('fields','id,questions,definition,-writeAccessToken');
   url.searchParams.set('access_token','SYNTHETIC_QUERY_SECRET');return fetch(url.href).then(response=>response.text());
  }));
  observedRequests=recorder.observedAssessmentGetsFor(fp);
  const requestReceipts={count:observedRequests.length,bodyRecords:recorder.takeFor(fp).length,
   credentialFree:!JSON.stringify(observedRequests).includes('SYNTHETIC_QUERY_SECRET')};
  const sessionCertificate=createAssessmentApiSessionCertificateV61525(document.getElementById('editor'),fp,courseId,true,new Set());
  if(!sessionCertificate)throw Error('Fresh unique modal fixture did not receive an item-control certificate');
  const result=await collectCourseraAssessmentByQuestionCycleV662(document.getElementById('editor'),fp,{certifiedItem:false,courseId,observedRequests,sessionCertificate,deadline:Date.now()+60000});
  fp.payload.structuredAssessment=result.assessment;
  const stillCurrent=()=>assessmentApiSessionStillCurrentV61525(document.getElementById('editor'),fp,courseId,sessionCertificate);
  const sessionCurrent={beforeHash:stillCurrent()};
  history.replaceState(null,'',location.pathname+'#'+questionHash);sessionCurrent.afterHash=stillCurrent();
  const sidebar=sessionCertificate.sidebar,sidebarReplacement=sidebar.cloneNode(true);
  sidebar.replaceWith(sidebarReplacement);sessionCurrent.replacedSidebar=stillCurrent();sidebarReplacement.replaceWith(sidebar);
  const content=sessionCertificate.content;content.replaceWith(content.cloneNode(true));sessionCurrent.replacedContent=stillCurrent();
  recorder.releaseFor(fp);requestReceipts.released=recorder.stats().assessmentGetReceipts===0;recorder.restore();
  return {result,payload:fp.payload,contract:captureContractV6150(fp),clicks:questionClicks,sessionCurrent,requestReceipts};
 },{courseId,itemId,observedRequests:modalCase.warmupRequests,questionHash:groupId(55)});
 assertComplete(modal);assertRequests();
 assert.equal(modal.payload.assessmentApiEvidence.identityMethod,'SESSION_EXACT_ITEM_CONTROL');
 assert.deepEqual(modal.requestReceipts,{count:2,bodyRecords:0,credentialFree:true,released:true},'Fresh-modal identity must use maintained, item-scoped GET receipts without cloning credential-bearing bodies');
 assert.deepEqual(modal.sessionCurrent,{beforeHash:true,afterHash:true,replacedSidebar:false,replacedContent:false},'Post-API identity must allow only fragment navigation and reject same-URL pinned DOM replacements');
 console.log(JSON.stringify({status:'PASS',mode:'generic shell modal with pinned certificate and explicit GET observations',questions:count,questionEditorClicks:0,scope:'Real canonical cycle on unchanged course shell URI; performance URL strings alone do not certify item identity.'}));
 await modalCase.context.close();
 for(const defect of ['reused-layout','second-visible-layout']){
  const rejectedBuilder=await openCase('batch');
  await rejectedBuilder.page.evaluate(shell=>history.replaceState(null,'',shell),shell);
  const created=await rejectedBuilder.page.evaluate(({courseId,itemId,defect})=>{
   const sidebar=document.getElementById('rail'),content=document.getElementById('content'),baseline=new Set();
   if(defect==='reused-layout'){baseline.add(sidebar);baseline.add(content);}
   else{const second=document.getElementById('editor').cloneNode(true);second.id='second-editor';document.body.append(second);}
   const certificate=createAssessmentApiSessionCertificateV61525(document.getElementById('editor'),{id:itemId,type:'Assignment',typeName:'staffGraded'},courseId,true,baseline);
   return Boolean(certificate);
  },{courseId,itemId,defect});
  assert.equal(created,false,'The builder certified a stale or non-unique modal layout');
  assert.equal(requests.length,0);
  console.log(JSON.stringify({status:'PASS',mode:'modal certificate builder declines '+defect}));
  await rejectedBuilder.context.close();
 }
 for(const defect of ['stale-sidebar','wrong-item','wrong-course','post-method','performance-only']){
  const modalDecline=await openCase('batch');
  await modalDecline.page.evaluate(shell=>history.replaceState(null,'',shell),shell);
  const result=await modalDecline.page.evaluate(async({courseId,itemId,observedRequests,defect})=>{
   const sidebar=document.getElementById('rail'),content=document.getElementById('content');
   const sessionCertificate=createAssessmentApiSessionCertificateV61525(document.getElementById('editor'),{id:itemId,type:'Assignment',typeName:'staffGraded'},courseId,true,new Set());
   if(!sessionCertificate)throw Error('Negative modal fixture did not begin with a valid certificate');
   if(defect==='stale-sidebar')sidebar.replaceWith(sidebar.cloneNode(true));
   if(defect==='wrong-item')sessionCertificate.itemId='different-item';
   if(defect==='wrong-course')sessionCertificate.courseId='different-course';
   if(defect==='post-method')observedRequests=observedRequests.map(request=>({...request,method:'POST'}));
   if(defect==='performance-only')observedRequests=[];
   return collectCourseraAssessmentApiV61524(document.getElementById('editor'),{id:itemId,type:'Assignment',typeName:'staffGraded',payload:{}},{certifiedItem:false,courseId,observedRequests,sessionCertificate,deadline:Date.now()+30000});
  },{courseId,itemId,observedRequests:modalDecline.warmupRequests,defect});
  assert.equal(result.captured,false);assert.equal(requests.length,0,'An invalid modal certificate issued acquisition requests');
  assert.equal(await modalDecline.page.evaluate(()=>questionClicks.length),0);
  console.log(JSON.stringify({status:'PASS',mode:'modal decline '+defect,stopReason:result.stopReason}));
  await modalDecline.context.close();
 }
 const unobservedCase=await openCase('virtual');
 const unobserved=await unobservedCase.page.evaluate(async({courseId,itemId})=>{
  performance.clearResourceTimings();
  const before={scrollEvents:railScrollEvents,position:document.getElementById('rail').scrollTop};
  const result=await collectCourseraAssessmentApiV61524(document.getElementById('editor'),{id:itemId,type:'Assignment',typeName:'staffGraded',payload:{}},{certifiedItem:true,courseId,deadline:Date.now()+30000});
  return {result,before,after:{scrollEvents:railScrollEvents,position:document.getElementById('rail').scrollTop},clicks:questionClicks};
 },{courseId,itemId});
 assert.equal(unobserved.result.attempted,false);assert.equal(unobserved.result.stopReason,'SAME_ASSIGNMENT_READ_ENDPOINTS_NOT_OBSERVED');
 assert.deepEqual(unobserved.after,unobserved.before,'An unavailable API path still traversed the virtualized rail');
 assert.equal(requests.length,0);assert.deepEqual(unobserved.clicks,[]);
 console.log('PASS: missing observed API endpoints decline before scrolling or issuing speculative requests.');
 await unobservedCase.context.close();
 for(const strategy of ['duplicate-response','duplicate-reference','missing-key','authentication']){
  const {context,page}=await openCase(strategy);
  const result=await page.evaluate(async({courseId,itemId})=>{
   const fp={id:itemId,name:'Synthetic API assessment',type:'Assignment',typeName:'staffGraded',payload:{}};
   return collectCourseraAssessmentApiV61524(document.getElementById('editor'),fp,{certifiedItem:true,courseId,deadline:Date.now()+30000});
  },{courseId,itemId});
  assert.equal(result.captured,false,'Ambiguous, missing or unauthorized evidence became a complete API capture');
  if(strategy==='authentication')assert.equal(result.authenticationFailed,true);
  assert(!(result.assessment?.captureCompleteness?.requiredAnswerCoverageComplete),'Incomplete API evidence certified full answer coverage');
  assertRequests();assert.equal(await page.evaluate(()=>questionClicks.length),0,'API collector activated an editor during a declined acquisition');
  console.log(JSON.stringify({status:'PASS',mode:strategy,stopReason:result.stopReason,scope:'Declines/abort are explicit; no completeness inferred from response order or missing keys.'}));
  await context.close();
 }
 const {context,page}=await openCase('batch');
 const requestStarted=page.waitForEvent('request',{predicate:request=>new URL(request.url()).searchParams.has('ids')});
 const changingCycle=page.evaluate(async({courseId,itemId})=>collectCourseraAssessmentByQuestionCycleV662(document.getElementById('editor'),{id:itemId,type:'Assignment',typeName:'staffGraded',payload:{}},{certifiedItem:true,courseId,deadline:Date.now()+30000}),{courseId,itemId});
 await requestStarted;
 await page.evaluate(()=>history.replaceState(null,'',location.pathname.replace('assessment-under-test','changed-editor')));
 const changed=await changingCycle;
 assert.equal(changed.itemIdentityChanged,true,'The canonical cycle did not stop after changing the editor route');
 assert.equal(changed.assessment,null,'Evidence was accepted after changing the editor route');
 assert.equal(await page.evaluate(()=>questionClicks.length),0,'The canonical cycle fell through to DOM in a changed editor');
 assertRequests();await context.close();assert.deepEqual(errors,[]);
 console.log('PASS: changed editor aborts API acceptance; synthetic secrets and private content are never printed.');
}catch(error){
 console.error('::error title=Assessment API native check::'+String(error.stack||error).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));throw error;
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
