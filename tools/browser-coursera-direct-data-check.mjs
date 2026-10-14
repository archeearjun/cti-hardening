import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';

// Execute the actual generated direct-data delivery program. The default CI
// path requires browser-initiated javascript: navigation. The explicit local
// flag permits only a separately reported reader test where managed Chromium's
// URL policy also blocks a no-CSP native canary; policies are never changed.
// Synthetic timings and schemas certify no private Coursera course or plugin.
const origin='https://www.coursera.org',slug='synthetic-direct-data';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-direct-data-browser-'));
const allowPolicyFallback=process.env.CTI_ALLOW_BOOKMARK_POLICY_BLOCKED==='1';
let knownPolicy=false;
try{const policy=JSON.parse(fs.readFileSync('/etc/chromium/policies/managed/urls.json','utf8'));
  knownPolicy=policy.URLBlocklist?.includes('*')&&!policy.URLAllowlist?.some(value=>value==='*'||/^javascript(?::|$)/i.test(value));
}catch{ /* Stock hosted Chromium has no local managed policy file. */ }
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),
  '-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const groupResource='authoringAssignmentQuestionGroups.v1',definitionResource='authoringAssignmentMachineEvaluableQuestions.v1';
const resources=new Set(['authoringCourseMaterials.v1','authoringCourses.v2','authoringAtoms.v2','authoringItemContentRelations.v1',groupResource,definitionResource]);
const secrets=['fixture-http-only-cookie','fixture-write-token','fixture-nested-token'];
const configs=new Map(),atoms=new Map(),groups=new Map(),definitions=new Map(),fileSizes=new WeakMap();
const requests=[],documents=[],errors=[],active=new Map(),maximum=new Map();
function key(prefix,index){return prefix+String(index).padStart(22-prefix.length,'0');}
function cml(text,dtd='assess/1'){return {typeName:'cml',definition:{dtdId:dtd,value:'<co-content><p>'+text+'</p></co-content>'}};}
function makeCourse(id,mode,large=false){
  const items=[],partsCount=large?609:9,contentCount=large?165:mode==='large-export'?8:3,emptyCount=large?20:1;
  const config={id,mode,large,atomGets:new Map(),groupGets:new Map(),materialGets:0,partsCount,contentCount,emptyCount};configs.set(id,config);
  const courseIndex=configs.size;
  for(let index=0;index<contentCount;index++){
    const itemId='item_'+String(index).padStart(4,'0'),atomId=key('a'+courseIndex+'_',index);
    const type=index<2?'staffGraded':index===2&&large?'widget':'supplement';
    const contentId='atom~'+atomId,definition=type==='staffGraded'?{assignmentId:key('s'+courseIndex+'_',index)+'@1'}:
      type==='supplement'?{assetId:key('r'+courseIndex+'_',index)+'@1',assetTypeName:'html'}:{widgetId:'fixture-widget'};
    const leaf={id:itemId,name:'Material '+itemId,originalName:'Original '+itemId,published:false,atomId,contentId,
      content:{typeName:type,definition}};items.push(leaf);
    let draftContent;
    if(type==='staffGraded'){
      const count=index===0?partsCount:1,parts=[];
      for(let position=0;position<count;position++){
        const localId=key('g',position),groupId=atomId+'~'+localId,definitionId=atomId+'~'+key('q',position)+'@'+(position%3+1);
        parts.push({typeName:'storedQuestionGroupPart',definition:{id:localId}});
        groups.set(groupId,{courseId:id,itemId,value:{id:groupId,typeName:'storedQuestionGroup',questions:[definitionId],scoringWeight:1,
          writeAccessToken:secrets[1],validation:{isReadyForPublish:true}}});
        const checkbox=index===1;
        const native={prompt:cml('Synthetic question '+(position===8?7:position)+' café 日本語'),shuffleOptions:false,
          options:[0,1,2].map(option=>({id:'option-'+option,display:cml('Option '+option+' 日本語'),feedback:cml('Feedback '+option)})),
          ...(checkbox?{correctOptions:['option-0','option-2'],allowPartialScoring:false}:{correctOption:'option-'+(position%3)})};
        definitions.set(definitionId,{courseId:id,itemId,value:{id:definitionId,definition:{typeName:checkbox?'checkbox':'mcq',definition:native},
          validation:{typeName:'multipleChoiceValidation',definition:{isReadyForPublish:true}},writeAccessToken:secrets[1]}});
      }
      draftContent={typeName:'staffGradedDraft',definition:{name:'Draft '+itemId,parts,configuration:{shuffleQuestions:false},
        introduction:cml('Synthetic introduction'),passingFraction:0.8,reviewCriteria:[],assignmentLevelRubrics:[]}};
    }else if(type==='supplement')draftContent={typeName:'supplementDraft',definition:{name:'Draft '+itemId,
      content:cml(config.mode==='large-export'?'Bound large reading '+itemId+' '+'x'.repeat(1400000):
        'Bound reading body '+itemId+' café 日本語','supplement/1'),assetId:key('r'+courseIndex+'_',index)+'@2'}};
    else draftContent={typeName:'widgetDraft',definition:{widgetId:'fixture-widget',opaque:{externalBody:'not-fetched'}}};
    const atom={id:atomId,contentId,status:{typeName:'draftAtomStatus',definition:{}},storedAtomVersion:1,
      metadata:{updatedAt:1000},draft:{content:draftContent,timeCommitment:600},
      published:{content:{typeName:type==='supplement'?'supplementDraft':'oldPublishedType',definition:{name:'Separate published snapshot'}},timeCommitment:300},
      writeAccessToken:secrets[1],nested:{accessToken:secrets[2]}};
    const relation={id:atomId,atomId,branchRelationMap:{[id+'~'+itemId]:{courseId:id,itemId,courseSlug:slug}}};
    atoms.set(atomId,{courseId:id,itemId,atom,relation});
  }
  const empty=Array.from({length:emptyCount},(_,index)=>({id:'empty_'+index,name:'Explicit empty module '+index,
    elements:[],description:'',learningObjectives:[],timeCommitment:0}));
  config.material={id,courseId:id,conflictMetadata:{version:1,courseBranchVersion:1},
    material:{elements:[{id:'module_main',name:'Module',elements:[{id:'lesson_main',name:'Lesson',trackId:'fixture-track',elements:items}]},...empty]}};
  return config;
}
const baseline=makeCourse('Direct_baseline_fixture_123','baseline',true);
const complete=makeCourse('Direct_complete_fixture_123','complete');
const interrupted=makeCourse('Direct_resume_fixture_123','resume');
const oldCutoff=makeCourse('Direct_old_cutoff_fixture_123','resume');
const budgetResume=makeCourse('Direct_budget_resume_123','budget-resume');
const changed=makeCourse('Direct_changed_fixture_123','changed');
const changedMaterial=makeCourse('Direct_material_change_123','material-changed');
const changedGroup=makeCourse('Direct_group_change_123','group-changed');
const authentication=makeCourse('Direct_auth_fixture_123','authentication');
const limited=makeCourse('Direct_limit_fixture_123','limited');
const largeExport=makeCourse('Direct_large_export_123','large-export');
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
  const url=new URL(request.url,origin);
  if(url.pathname==='/favicon.ico'){response.statusCode=204;response.end();return;}
  if(!url.pathname.startsWith('/api/')){
    const courseId=url.pathname.split('/')[3],config=configs.get(courseId);documents.push(url.pathname);
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.setHeader('Set-Cookie','fixtureSession='+secrets[0]+'; HttpOnly; Secure; SameSite=Lax; Path=/');
    if(!url.searchParams.has('open'))response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'nonce-fixture'; style-src 'self'; connect-src 'self'");
    response.end(`<!doctype html><title>Direct capture fixture</title><main><a id="editor" href="/teach/${slug}/${courseId}/content/item/project/item_0000">Open quiz normally</a></main><script nonce="fixture">
      window.fixtureEditorClicks=0;window.fixtureScrolls=0;window.fixtureCsp=[];
      document.getElementById('editor').onclick=()=>{window.fixtureEditorClicks++;};
      window.addEventListener('scroll',()=>window.fixtureScrolls++,true);
      document.addEventListener('securitypolicyviolation',event=>window.fixtureCsp.push(event.violatedDirective));
      localStorage.setItem('__CTI_AUTOMATIC_LOCAL_ACTIVE_V61517_${courseId}','legacy-fixture-sentinel');
      ${config?.mode==='limited'?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={requests:4};':config?.mode==='budget-resume'?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={requests:40};':''}
    </script>`);return;
  }
  const [, ,resource,...tail]=url.pathname.split('/'),reference=decodeURIComponent(tail.join('/').replace(/\/$/,''));
  const binding=atoms.get(reference)||groups.get(reference)||definitions.get(reference),courseId=binding?.courseId||reference;
  const config=configs.get(courseId),inFlight=(active.get(courseId)||0)+1;
  active.set(courseId,inFlight);maximum.set(courseId,Math.max(maximum.get(courseId)||0,inFlight));
  let settled=false;const settle=()=>{if(settled)return;settled=true;active.set(courseId,(active.get(courseId)||1)-1);};
  response.on('finish',settle);response.on('close',settle);
  requests.push({courseId,resource,reference,path:url.pathname,query:[...url.searchParams],method:request.method,
    all:request.headers['x-coursera-naptime-fields'],authenticated:request.headers.cookie?.includes('fixtureSession='+secrets[0])===true});
  response.setHeader('Content-Type','application/json; charset=utf-8');
  let value;
  if(!config||!resources.has(resource)){response.statusCode=404;response.end('{}');return;}
  if(config.mode==='authentication'&&resource===groupResource){response.statusCode=401;response.end('{"error":"fixture auth stopped"}');return;}
  if(resource==='authoringCourseMaterials.v1'){
    config.materialGets++;value=structuredClone(config.material);
    if(config.mode==='material-changed'&&config.materialGets>1)value.conflictMetadata.version=2;
  }else if(resource==='authoringCourses.v2')value={id:courseId,name:'Synthetic course'};
  else if(resource==='authoringAtoms.v2'){
    const count=(config.atomGets.get(reference)||0)+1;config.atomGets.set(reference,count);value=structuredClone(binding.atom);
    if(config.mode==='changed'&&count>1){value.storedAtomVersion=2;value.metadata.updatedAt=2000;}
  }else if(resource==='authoringItemContentRelations.v1')value=structuredClone(binding.relation);
  else if(resource===groupResource){
    value=structuredClone(groups.get(reference)?.value);
    const count=(config.groupGets.get(reference)||0)+1;config.groupGets.set(reference,count);
    if(config.mode==='group-changed'&&count>1&&value)value.scoringWeight=2;
  }
  else if(resource===definitionResource){
    if(/%40/i.test(url.pathname)){response.statusCode=404;response.end('{"error":"literal version delimiter required"}');return;}
    value=structuredClone(definitions.get(reference)?.value);
  }
  if(!value){response.statusCode=404;response.end('{}');return;}
  setTimeout(()=>{if(!response.destroyed)response.end(JSON.stringify({elements:[value],paging:{},linked:{}}));},config.mode==='resume'?8:1);
});
let browser,heartbeat;
try{
  const {courseraDirectDataSource}=await import('../src/generated/extractor-sources.js');
  assert.equal(typeof courseraDirectDataSource,'string','Generate the maintained direct-data delivery source first');
  assert.match(courseraDirectDataSource,/__CTI_COURSERA_DIRECT_DATA_CAPTURE__/);
  const deliveredProgram='void '+courseraDirectDataSource;
  const bookmark='javascript:'+encodeURIComponent(deliveredProgram);
  assert(Buffer.byteLength(bookmark,'utf8')<=500*1024,'The exact emitted bookmark must fit Chrome Bookmark Manager\'s URL limit');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,
    ...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
    args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP www.coursera.org 127.0.0.1:'+server.address().port],
  });
  if(process.env.CTI_DIRECT_BROWSER_PROGRESS==='1')heartbeat=setInterval(async()=>{
    for(const context of browser.contexts())for(const page of context.pages())try{
      const progress=await page.evaluate(()=>{const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;return state&&{state:state.state,phase:state.phase,counts:state.counts};});
      if(progress)console.error('Synthetic fixture progress: '+JSON.stringify(progress));
    }catch{ /* A closed synthetic page has no remaining state to report. */ }
  },10000);
  let nativeExecuted=true,policyCanaryVerified=false;
  async function poll(check,timeout=2000){const deadline=Date.now()+timeout;do{if(await check())return true;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);return false;}
  const canaryContext=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  if(allowPolicyFallback&&knownPolicy&&process.env.CTI_CHROMIUM_PATH==='/usr/bin/chromium'){
    const canary=await canaryContext.newPage();await canary.goto(origin+'/teach/'+slug+'/'+complete.id+'/content/edit?open=1');
    const session=await canaryContext.newCDPSession(canary),reply=await session.send('Page.navigate',{url:'javascript:void(window.__CTI_DIRECT_NATIVE_CANARY=true)',transitionType:'auto_bookmark'});
    assert.equal(reply.errorText,'net::ERR_ABORTED');assert.equal(await poll(()=>canary.evaluate(()=>window.__CTI_DIRECT_NATIVE_CANARY===true)),false);
    assert.equal(requests.length,0);policyCanaryVerified=true;await session.detach();await canary.close();
  }
  await canaryContext.close();
  async function launch(page,context){
    const session=await context.newCDPSession(page);
    if(process.env.CTI_DIRECT_DEBUG_EXCEPTIONS==='1'){
      session.on('Debugger.paused',async event=>{
        console.error('Synthetic direct-data exception: '+String(event.data?.description||event.reason).slice(0,350));
        await session.send('Debugger.resume').catch(()=>{});
      });
      await session.send('Debugger.enable');await session.send('Debugger.setPauseOnExceptions',{state:'all'});
    }
    const reply=await session.send('Page.navigate',{url:bookmark,transitionType:'auto_bookmark'});
    const observed=await poll(()=>page.evaluate(()=>Boolean(window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__)));
    if(!observed){
      if(!policyCanaryVerified||reply.errorText!=='net::ERR_ABORTED'){
        const csp=await page.evaluate(()=>window.fixtureCsp||[]);throw new Error('Native direct-data bookmark did not execute: '+JSON.stringify({errorText:reply.errorText,csp}));
      }
      nativeExecuted=false;
      const evaluation=await session.send('Runtime.evaluate',{expression:deliveredProgram,userGesture:true,returnByValue:true});
      assert.equal(evaluation.exceptionDetails,undefined,'Generated direct capture source must be self-contained');
      await page.waitForFunction(()=>Boolean(window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__));
    }
    if(process.env.CTI_DIRECT_DEBUG_EXCEPTIONS!=='1')await session.detach();
  }
  async function open(config){
    const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    const destinations=[];page.on('request',request=>destinations.push(new URL(request.url()).origin));
    await page.goto(origin+'/teach/'+slug+'/'+config.id+'/content/edit');
    return {context,page,destinations};
  }
  async function terminal(page){
    await page.waitForFunction(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__?.running===false,{},{timeout:180000});
    return page.evaluate(()=>{const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;return {state:state.state,runId:state.runId,phase:state.phase,counts:state.counts,
      diagnostic:document.getElementById('cti-direct-data-capture-v1')?.innerText.slice(0,900)};});
  }
  async function readFile(download){
    const bytes=fs.readFileSync(await download.path());
    const compressed=download.suggestedFilename().endsWith('.json.gz');
    assert(bytes.byteLength<=(compressed?32:128)*1024*1024,'The final file must fit its compressed or plain byte limit');
    const jsonBytes=compressed?gunzipSync(bytes,{maxOutputLength:128*1024*1024}):bytes;
    assert(jsonBytes.byteLength<=128*1024*1024,'Expanded JSON must stay within the 128 MiB processing limit');
    const capture=JSON.parse(jsonBytes.toString('utf8'));
    fileSizes.set(capture,{compressed,fileBytes:bytes.byteLength,jsonBytes:jsonBytes.byteLength});
    return capture;
  }
  function assertTransport(config,start){
    const received=requests.slice(start).filter(request=>request.courseId===config.id);
    assert(received.length>0);assert(received.every(request=>request.method==='GET'&&request.authenticated&&resources.has(request.resource)));
    assert(received.every(request=>!request.query.some(([key])=>key==='ids')),'No collection enumeration or guessed batch request');
    assert(maximum.get(config.id)<=4,'All roots, items, groups and definitions share one four-read pool');
    for(const request of received){
      if([groupResource,definitionResource,'authoringAtoms.v2','authoringItemContentRelations.v1'].includes(request.resource))assert.equal(request.all,'ALL');
      if(request.resource===definitionResource){assert(definitions.has(request.reference));assert(request.path.endsWith('@'+request.reference.split('@')[1]));assert(!/%40/i.test(request.path));}
      if(request.resource===groupResource){assert(groups.has(request.reference));assert.equal(new Map(request.query).get('id'),request.reference);}
    }
  }
  async function assertNoEditor(page,destinations){
    assert.deepEqual(new Set(destinations),new Set([origin]));
    assert.equal(await page.evaluate(()=>window.fixtureEditorClicks),0);assert.equal(await page.evaluate(()=>window.fixtureScrolls),0);
    assert(!documents.some(address=>address.includes('/content/item/')),'No authoring editor is opened');
    assert.equal(await page.evaluate(()=>document.cookie.includes('fixtureSession')),false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('__CTI_AUTOMATIC_LOCAL_ACTIVE_V61517_'+location.pathname.split('/')[3])),'legacy-fixture-sentinel');
  }
  async function runFileCase(config){
    const target=await open(config),downloads=[];target.page.on('download',download=>downloads.push(download));
    const downloading=target.page.waitForEvent('download',{timeout:180000});void downloading.catch(()=>{});
    const start=requests.length;await launch(target.page,target.context);const state=await terminal(target.page);
    assert(state.counts.total>0,'No fixture inventory was established: '+JSON.stringify({state,requests:requests.slice(start).map(request=>({resource:request.resource,reference:request.reference}))}));
    const capture=await readFile(await downloading);await target.page.waitForTimeout(50);assert.equal(downloads.length,1);
    assertTransport(config,start);await assertNoEditor(target.page,target.destinations);
    for(const secret of secrets)assert(!JSON.stringify(capture).includes(secret),'Credential markers must not enter final JSON');
    return {...target,state,capture,start,downloads};
  }
  const main=await runFileCase(baseline);
  assert.equal(main.capture.page.courseId,baseline.id);assert.equal(main.capture.fingerprints.length,185);
  assert.equal(main.state.state,'INCOMPLETE');
  assert.equal(main.capture.meta.directDataCapture.stats.maxConcurrentRequests,4,'The assessment workers fill the bounded four-read pool');
  const largeAssessment=main.capture.fingerprints.find(fp=>fp.id==='item_0000');
  const questions=largeAssessment.payload.structuredAssessment.questions;
  assert.equal(questions.length,609);assert.equal(largeAssessment.captureContract.complete,true);
  assert.equal(new Set(questions.map(question=>question.courseraQuestionId)).size,609);
  assert.equal(questions[7].prompt,questions[8].prompt,'Equal prompts remain separate source identities');
  assert.notEqual(questions[7].sourceDefinitionId,questions[8].sourceDefinitionId);
  for(let index=0;index<questions.length;index++){
    const question=questions[index],owner=atoms.get(largeAssessment.atomId);
    assert.equal(question.id,String(index+1));assert.equal(question.sourceDefinitionId,largeAssessment.atomId+'~'+key('q',index)+'@'+(index%3+1));
    assert.equal(question.courseraQuestionId,largeAssessment.atomId+'~'+key('g',index));assert.equal(owner.courseId,baseline.id);
    assert.deepEqual(question.options.filter(option=>option.correct).map(option=>option.sourceOptionId),['option-'+(index%3)]);
  }
  const checkbox=main.capture.fingerprints.find(fp=>fp.id==='item_0001');
  assert.equal(checkbox.captureContract.complete,true);assert.deepEqual(checkbox.payload.structuredAssessment.questions[0].answerKeyEvidence.correctOptions,['option-0','option-2']);
  const widget=main.capture.fingerprints.find(fp=>fp.id==='item_0002');assert.equal(widget.captureContract.complete,false);
  assert.equal(widget.captureContract.externalBodyVerified,false);assert(widget.payload.directDataSources.atom.elements[0].draft);
  assert.equal(evaluateCourseraCapture(main.capture,baseline.id).complete,false,'An unsupported widget prevents strict completion');
  const reading=main.capture.fingerprints.find(fp=>fp.id==='item_0003');assert.equal(reading.captureContract.complete,true);
  assert.match(reading.payload.textSample,/Bound reading body item_0003 café 日本語/);
  assert.equal(reading.payload.directDataSources.atom.elements[0].draft.content.definition.name,'Draft item_0003');
  assert.equal(reading.payload.directDataSources.atom.elements[0].published.content.definition.name,'Separate published snapshot');
  assert(main.capture.fingerprints.filter(fp=>fp.id.startsWith('empty_')).every(fp=>fp.captureContract.complete===true));
  await main.context.close();

  const success=await runFileCase(complete);assert.equal(success.state.state,'COMPLETE');
  const verdict=evaluateCourseraCapture(success.capture,complete.id);assert.equal(verdict.complete,true,JSON.stringify(verdict.reasons));
  await success.context.close();

  const scaled=await runFileCase(largeExport),scaledSize=fileSizes.get(scaled.capture);
  assert.equal(scaled.state.state,'COMPLETE');assert.equal(scaledSize.compressed,true,'Chrome should download one gzip file');
  assert(scaledSize.jsonBytes>32*1024*1024,'The complete retained raw capture must exceed the old plain-JSON cutoff');
  assert(scaledSize.fileBytes<=32*1024*1024,'Lossless compression keeps the one-file download within the transfer limit');
  assert.equal(scaled.capture.fingerprints.length,9);assert(scaled.capture.fingerprints.every(fp=>fp.captureContract.complete===true));
  const scaledVerdict=evaluateCourseraCapture(scaled.capture,largeExport.id);
  assert.equal(scaledVerdict.complete,true,JSON.stringify(scaledVerdict.reasons));
  assert(scaled.capture.fingerprints.at(-2).payload.directDataSources.atom.elements[0].draft.content.definition.content.definition.value.includes('x'.repeat(1000000)),
    'The large raw body is preserved after compression and expansion');
  await scaled.context.close();

  const resumed=await open(interrupted),partialDownloads=[];resumed.page.on('download',download=>partialDownloads.push(download));
  const resumeStart=requests.length;await launch(resumed.page,resumed.context);
  assert(await poll(()=>requests.slice(resumeStart).filter(request=>request.resource===definitionResource).length>=4,15000));
  await resumed.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.stop());
  const paused=await terminal(resumed.page);assert.equal(paused.state,'PAUSED');assert.equal(partialDownloads.length,0,'Operator stop saves checkpoints without an automatic partial file');
  const saved=await resumed.page.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const rows=await new Promise((resolve,reject)=>{const transaction=database.transaction(['definitions','groups','runs'],'readonly'),out={};
      for(const name of ['definitions','groups','runs']){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result;};}
      transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);});database.close();
    return {definitions:rows.definitions.map(row=>row.definitionId),groups:rows.groups.length,
      groupIds:rows.groups.map(row=>row.groupId),runs:rows.runs.map(row=>({runId:row.runId,state:row.state}))};
  });
  assert(saved.definitions.length>0);assert(saved.groups>0);assert(saved.runs.some(run=>run.runId===paused.runId));
  await resumed.page.reload();const afterResumeStart=requests.length;
  const resumeDownload=resumed.page.waitForEvent('download',{timeout:180000});void resumeDownload.catch(()=>{});
  await launch(resumed.page,resumed.context);const resumeState=await terminal(resumed.page),resumeCapture=await readFile(await resumeDownload);
  assert.equal(resumeState.runId,paused.runId);assert.equal(resumeState.state,'COMPLETE');assert.equal(partialDownloads.length,1);
  assert.equal(evaluateCourseraCapture(resumeCapture,interrupted.id).complete,true);
  assert(resumeCapture.meta.directDataCapture.stats.requests>=requests.slice(resumeStart).filter(request=>request.courseId===interrupted.id).length,
    'The exported API budget includes requests from before the pause');
  assert(!requests.slice(afterResumeStart).some(request=>request.resource===definitionResource&&saved.definitions.includes(request.reference)),
    'Committed exact versioned definitions should resume from real IndexedDB rather than repeat reads');
  for(const id of saved.groupIds)assert.equal(requests.slice(afterResumeStart).filter(request=>request.resource===groupResource&&request.reference===id).length,1,
    'An unchanged committed group resumes with one fresh consistency read');
  assertTransport(interrupted,resumeStart);await assertNoEditor(resumed.page,resumed.destinations);await resumed.context.close();

  const recovering=await open(oldCutoff),recoveryDownloads=[];recovering.page.on('download',download=>recoveryDownloads.push(download));
  const recoveryStart=requests.length;await launch(recovering.page,recovering.context);
  assert(await poll(()=>requests.slice(recoveryStart).filter(request=>request.resource===definitionResource).length>=4,15000));
  await recovering.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.stop());
  const recoveryPaused=await terminal(recovering.page);assert.equal(recoveryPaused.state,'PAUSED');assert.equal(recoveryDownloads.length,0);
  const legacy=await recovering.page.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const saved=await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','groups','definitions'],'readwrite'),out={};
      const runs=transaction.objectStore('runs'),request=runs.getAll();request.onsuccess=()=>{
        const row=request.result.at(-1);row.state='INCOMPLETE';row.reason='DIRECT_CAPTURE_EXPORT_BYTE_LIMIT';
        row.buildId='v1.0.0-bound-authoring-drafts-20261014';row.budget.limits.concurrentRequests=2;
        row.captureMeta.buildId=row.buildId;row.captureMeta.directDataCapture.stopReason=row.reason;
        row.captureMeta.directDataCapture.acquisitionComplete=false;row.captureMeta.directDataCapture.wholeCourseVerified=false;
        row.captureMeta.directDataCapture.limits.concurrentRequests=2;
        row.captureMeta.directDataCapture.limits.exportBytes=32*1024*1024;runs.put(row);
        out.runId=row.runId;out.requests=row.budget.requests;
      };
      const definitionRequest=transaction.objectStore('definitions').getAll();definitionRequest.onsuccess=()=>{out.definitions=definitionRequest.result.map(row=>row.definitionId);};
      const groupRows=transaction.objectStore('groups'),groupRequest=groupRows.getAll();groupRequest.onsuccess=()=>{
        out.groupIds=groupRequest.result.map(row=>row.groupId);
        for(const row of groupRequest.result){delete row.value.modelHash;groupRows.put(row);}
      };
      transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);
    });database.close();return saved;
  });
  assert(legacy.definitions.length>0);assert(legacy.groupIds.length>0);
  await recovering.page.reload();const recoveryFreshStart=requests.length;
  const recoveryDownloading=recovering.page.waitForEvent('download',{timeout:180000});void recoveryDownloading.catch(()=>{});
  await launch(recovering.page,recovering.context);const recoveryFinal=await terminal(recovering.page),recoveryCapture=await readFile(await recoveryDownloading);
  assert.equal(recoveryFinal.runId,recoveryPaused.runId,'The former export cutoff resumes the existing run');
  assert.equal(recoveryFinal.state,'COMPLETE');assert.equal(recoveryDownloads.length,1);
  assert.equal(recoveryCapture.meta.directDataCapture.limits.concurrentRequests,4,'The old two-slot limit upgrades without resetting cumulative budgets');
  assert(recoveryCapture.meta.directDataCapture.stats.requests>=legacy.requests,'The old run keeps its spent request budget');
  assert(!requests.slice(recoveryFreshStart).some(request=>request.resource===definitionResource&&legacy.definitions.includes(request.reference)),
    'Old versioned definitions survive an export-cutoff upgrade');
  for(const id of legacy.groupIds)assert.equal(requests.slice(recoveryFreshStart).filter(request=>request.resource===groupResource&&request.reference===id).length,1,
    'Old group checkpoints without new cache metadata still receive a fresh source read');
  assert.equal(evaluateCourseraCapture(recoveryCapture,oldCutoff.id).complete,true);
  assertTransport(oldCutoff,recoveryStart);await assertNoEditor(recovering.page,recovering.destinations);await recovering.context.close();

  const budgetTarget=await open(budgetResume),budgetDownloads=[];budgetTarget.page.on('download',download=>budgetDownloads.push(download));
  const budgetStart=requests.length;await launch(budgetTarget.page,budgetTarget.context);
  assert(await poll(()=>requests.slice(budgetStart).filter(request=>request.resource===definitionResource).length>=4,15000));
  await budgetTarget.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.stop());
  const budgetPaused=await terminal(budgetTarget.page);assert.equal(budgetPaused.state,'PAUSED');assert.equal(budgetDownloads.length,0);
  await budgetTarget.page.reload();
  const budgetDownloading=budgetTarget.page.waitForEvent('download',{timeout:180000});void budgetDownloading.catch(()=>{});
  await launch(budgetTarget.page,budgetTarget.context);
  const budgetFinal=await terminal(budgetTarget.page),budgetCapture=await readFile(await budgetDownloading);
  assert.equal(budgetFinal.runId,budgetPaused.runId);assert.equal(budgetFinal.state,'INCOMPLETE');assert.equal(budgetDownloads.length,1);
  assert.equal(budgetCapture.meta.directDataCapture.stats.requests,40,'Resume must not reset the course request limit');
  assert.equal(budgetCapture.meta.directDataCapture.stopReason,'COURSE_API_REQUEST_LIMIT');
  assert(requests.slice(budgetStart).filter(request=>request.courseId===budgetResume.id).length<=40);
  assert.equal(evaluateCourseraCapture(budgetCapture,budgetResume.id).complete,false);
  assertTransport(budgetResume,budgetStart);await assertNoEditor(budgetTarget.page,budgetTarget.destinations);await budgetTarget.context.close();

  for(const config of [changed,changedMaterial,changedGroup,authentication,limited]){
    const target=await runFileCase(config);assert.equal(evaluateCourseraCapture(target.capture,config.id).complete,false);
    assert(target.capture.fingerprints.some(fp=>fp.captureContract?.complete!==true),'Failures remain explicit item gaps');
    if(config.mode==='limited')assert(requests.slice(target.start).filter(request=>request.courseId===config.id).length<=4);
    if(config.mode==='authentication')assert.equal(target.state.state,'PAUSED');
    await target.context.close();
  }
  assert.deepEqual(errors,[]);
  if(!nativeExecuted)console.warn('::warning::Managed Chromium blocks native bookmark URLs. Only the explicit debugger reader path was verified here; no browser policy changed.');
  console.log(JSON.stringify({status:nativeExecuted?'PASS':'PARTIAL',nativeBookmarkExecuted:nativeExecuted,readerVerified:true,
    inventory:185,contentItems:165,orderedMcqQuestions:609,checkboxKeys:true,unknownWidgetPreventsCompletion:true,
    realIndexedDbInterruptedResume:true,oldExportCutoffRunRecovered:true,stableVersionedDefinitionsNotReread:true,
    unchangedGroupsNeedOneFreshResumeRead:true,maximumRequestsInFlight:4,
    cumulativeResumeBudget:true,completeCaptureBeyondOld32MiBCutoff:true,losslessGzipWithin32MiB:true,expandedJsonWithin128MiB:true,
    finalDownloadsPerCompletedRun:1,noEditorNavigation:true,authenticationAndLimitsAndSourceChangesRemainGaps:true,
    scope:'Actual generated entry with synthetic authoring draft APIs; no private-course completeness or throughput claim.'}));
}catch(error){
  console.error('::error::Direct-data browser check failed: '+error.message);throw error;
}finally{
  clearInterval(heartbeat);
  await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(scratch,{recursive:true,force:true});
}
