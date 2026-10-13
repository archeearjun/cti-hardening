import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {bundleConsole} from './console-bundle.mjs';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';

// Full maintained entry and acquisition helpers, with no substitutions. The
// fixture reproduces an unmarked body nine ancestors above its question part,
// a deeper mutation surface, 609 body IDs and only 27 virtual rail anchors.
// Definitions are synthetic MCQ records in the observed authoring schema.
const count=609,itemId='final-bank',assignmentId='SyntheticFinalBank_123';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-api-surface-'));
const groupId=n=>assignmentId+'~group_'+n;
const definitionId=n=>assignmentId+'~definition_'+n+'@1';
const prompt=n=>'Which synthetic choice belongs to scenario '+n+'?';
const cml=value=>({typeName:'cml',definition:{value:'<co-content><p>'+value+'</p></co-content>',dtdId:'assess/1'}});
function group(n){return {id:groupId(n),questions:[definitionId(n)],scoringWeight:1};}
function definition(n){return {id:definitionId(n),definition:{typeName:'mcq',definition:{prompt:cml(prompt(n)),shuffleOptions:false,
  options:[{id:'correct',display:cml('Correct synthetic choice '+n),feedback:cml('Correct feedback '+n)},
    {id:'other',display:cml('Other synthetic choice '+n),feedback:cml('Incorrect feedback '+n)}],correctOption:'correct'}}};}
const cases=new Map();
function fixtureHtml(state){return '<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px Arial}#course-outline{padding:20px}#editor{display:flex}#rail{width:420px;height:420px;overflow-y:auto;flex-shrink:0}#rows{position:relative;height:'+count*32+'px}#rows>div{position:absolute;height:32px;width:410px}#body{width:650px;min-height:500px}section{min-height:24px}a{display:inline-block}</style><main id="app"></main><script>('+pageFixture.toString()+')('+JSON.stringify({courseId:state.courseId,route:state.route,itemId,count,assignmentId})+',{groupId:'+groupId.toString()+',prompt:'+prompt.toString()+'});</script>';}
function pageFixture(setup,helpers){
  const {courseId,route,itemId,count,assignmentId}=setup,{prompt}=helpers;
  const groupId=n=>assignmentId+'~group_'+n;
  const app=document.getElementById('app');window.fixtureReady=true;
  const observationKey='api-surface-observations-'+courseId;
  window.fixtureObservations=JSON.parse(sessionStorage.getItem(observationKey)||'{"opens":0,"questionClicks":0}');
  function record(){sessionStorage.setItem(observationKey,JSON.stringify(window.fixtureObservations));}
  function outline(){app.innerHTML='<div id="course-outline"><h1>Course content</h1><div data-item-id="'+itemId+'"><button data-item-id="'+itemId+'">Untitled</button></div></div>';
    app.querySelector('button').onclick=open;}
  function open(){
    window.fixtureObservations.opens++;record();
    if(route==='project')history.replaceState(null,'','/teach/synthetic/'+courseId+'/content/item/project/'+itemId);
    app.innerHTML='<div id="editor"><aside id="rail" data-testid="item-layout-left-sidebar"><p>Assignment outline Content ('+count+')</p><div id="rows"></div></aside><div id="body"></div></div>';
    const body=document.getElementById('body');let parent=body;
    // Part -> eight body wrappers -> common editor: exactly nine ancestors.
    for(let depth=0;depth<7;depth++){const wrapper=document.createElement('div');parent.append(wrapper);parent=wrapper;}
    for(let n=1;n<=count;n++){
      const part=document.createElement('section');part.id=groupId(n);part.dataset.testid='assignment-part-'+(n-1);part.textContent='Observed synthetic body part '+n;parent.append(part);
      if(n===1){let field=part;for(let depth=0;depth<6;depth++){const wrapper=document.createElement('div');field.append(wrapper);field=wrapper;}
        field.dataset.itemId=itemId;field.id='deep-item-mutation';
        const promptField=document.createElement('textarea');promptField.readOnly=true;promptField.setAttribute('aria-label','Prompt');
        promptField.value='Observed editor prompt field for the exact activated item';field.append(promptField);
        setTimeout(()=>{field.append(document.createElement('p'));field.lastChild.textContent='Observed item editor field';},50);}
    }
    const rail=document.getElementById('rail'),rows=document.getElementById('rows');
    function render(){const first=Math.min(count-27,Math.max(0,Math.floor(rail.scrollTop/32)));rows.replaceChildren();
      for(let i=first;i<first+27;i++){const row=document.createElement('div');row.style.top=i*32+'px';row.dataset.testid='assignment-outline';row.setAttribute('data-rbd-drag-handle-draggable-id',groupId(i+1));
        const number=document.createElement('span');number.textContent=(i+1)+' ';const anchor=document.createElement('a');anchor.href='#'+groupId(i+1);anchor.textContent=prompt(i+1);
        anchor.onclick=event=>{event.preventDefault();window.fixtureObservations.questionClicks++;record();};row.append(number,anchor);rows.append(row);}}
    rail.addEventListener('scroll',render);render();
    // Coursera's close button remounts the outline through the native handler.
    const close=document.createElement('button');close.textContent='Close';close.onclick=()=>{history.replaceState(null,'','/teach/synthetic/'+courseId+'/content/edit');outline();};document.getElementById('editor').append(close);
    // The normal editor itself reads one group and its versioned definition.
    // Canonical acquisition may use only these actually observed adapters.
    const firstGroup=groupId(1),firstDefinition=assignmentId+'~definition_1@1';
    Promise.all([
      fetch('/api/authoringAssignmentQuestionGroups.v1/'+firstGroup+'?id='+encodeURIComponent(firstGroup)+'&fields=id,scoringWeight,questions,validation').then(r=>r.text()),
      fetch('/api/authoringAssignmentMachineEvaluableQuestions.v1/'+firstDefinition+'?fields=id,definition,validation').then(r=>r.text())
    ]).catch(()=>{});
  }
  window.addEventListener('popstate',()=>{if(location.pathname.endsWith('/content/edit'))outline();});outline();
}
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),'-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},async(request,response)=>{
  const url=new URL(request.url,'https://www.coursera.org'),pathname=decodeURIComponent(url.pathname);
  const state=[...cases.values()].find(c=>pathname.includes(c.courseId)||String(request.headers.referer||'').includes(c.courseId));
  if(!state){response.writeHead(404);response.end('{}');return;}
  if(!pathname.startsWith('/api/')){response.setHeader('Content-Type','text/html');response.end(fixtureHtml(state));return;}
  response.setHeader('Content-Type','application/json');
  if(pathname.includes('authoringCourseMaterials.v1')){response.end(JSON.stringify({elements:[{id:itemId,name:'Untitled',typeName:'staffGraded'}]}));return;}
  const resource=pathname.split('/')[2];
  if(!['authoringAssignmentQuestionGroups.v1','authoringAssignmentMachineEvaluableQuestions.v1'].includes(resource)){response.end('{}');return;}
  const ids=url.searchParams.has('ids')?url.searchParams.get('ids').split(','):[pathname.split('/')[3]];
  state.requests.push({resource,ids,method:request.method});
  const lookup=new Map(Array.from({length:count},(_,i)=>[resource.includes('QuestionGroups')?groupId(i+1):definitionId(i+1),i+1]));
  await new Promise(resolve=>setTimeout(resolve,5));
  response.end(JSON.stringify({elements:ids.filter(id=>lookup.has(id)).map(id=>resource.includes('QuestionGroups')?group(lookup.get(id)):definition(lookup.get(id))),paging:{},linked:{}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const currentSource=bundleConsole(path.resolve('src/extractors/coursera/entry.js'));
const baselineRoot=path.join(scratch,'baseline');fs.mkdirSync(baselineRoot);
const archive=path.join(scratch,'baseline.tar');fs.writeFileSync(archive,execFileSync('git',['archive','b9f9ef1','src/extractors/coursera'],{maxBuffer:16*1024*1024}));execFileSync('tar',['-xf',archive,'-C',baselineRoot]);
const baselineSource=bundleConsole(path.join(baselineRoot,'src/extractors/coursera/entry.js'));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}`]});
  for(const route of ['project','generic'])for(const baseline of (route==='project'?[true,false]:[false])){
    const courseId='Api_surface_'+route+'_'+(baseline?'baseline':'current')+'_123',shell='https://www.coursera.org/teach/synthetic/'+courseId+'/content/edit';
    const state={courseId,route,requests:[]};cases.set(courseId,state);
    const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true}),page=await context.newPage(),downloads=[],errors=[];
    page.on('download',download=>downloads.push(download));page.on('pageerror',error=>errors.push(error.message));
    await page.goto(shell);const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
    const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,baseline?baselineSource:currentSource,'api_surface_'+route+'_'+(baseline?'baseline':'current')+'_123',undefined,{freshRun:true}));
    const startedAt=Date.now();await cdp.send(command.cmd,command.args);
    if(baseline){
      await page.waitForFunction(()=>window.__CTI_COURSERA_PROGRESS__?.snapshot()?.note?.includes('EDITOR_NOT_CERTIFIED') ||
        window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:90000});
      const previous=await page.evaluate(()=>({note:window.__CTI_COURSERA_PROGRESS__?.snapshot()?.note,
        questions:window.__CTI_LAST_RESULT?.fingerprints?.[0]?.payload?.structuredAssessment?.questionCount || 0,
        reason:window.__CTI_LAST_RESULT?.fingerprints?.[0]?.payload?.captureDiagnostics?.authoringAssessmentApiStopReason}));
      assert.equal(state.requests.filter(r=>r.ids.length>1).length,0,'The old deep-surface path unexpectedly captured a full API inventory');
      assert(previous.questions<count,'The baseline unexpectedly captured the complete observed body');
      assert(previous.note?.includes('EDITOR_NOT_CERTIFIED'),'The old release must reproduce the specific certification failure');
      console.log(JSON.stringify({status:'REPRODUCED',route,reason:previous.note?.includes('EDITOR_NOT_CERTIFIED')?'EDITOR_NOT_CERTIFIED':previous.reason,
        capturedQuestions:previous.questions,expectedQuestions:count,definitionRequests:state.requests.length,
        scope:'Full released v6.15.32 entry: the nested surface did not capture the full observed assignment'}));
      assert.deepEqual(errors,[],'Baseline must contain a real valid editor, without fixture script errors');
    }else{
      try{await page.waitForFunction(()=>window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture?.state==='FINISHED',{},{timeout:180000});}
      catch(error){console.log(JSON.stringify({route,requests:state.requests.length,diagnostic:await page.evaluate(()=>({progress:window.__CTI_COURSERA_PROGRESS__?.snapshot(),automatic:window.__CTI_LAST_RESULT?.meta?.automaticLocalCapture,diagnostics:window.__CTI_LAST_RESULT?.meta?.activeSpaCrawl?.targetDiagnostics}))}));throw error;}
      if(!downloads.length)await page.waitForEvent('download',{timeout:10000});assert.equal(downloads.length,1);
      const capture=JSON.parse(fs.readFileSync(await downloads[0].path(),'utf8')),fp=capture.fingerprints.find(fp=>fp.id===itemId);
      fs.writeFileSync(path.join('/tmp','cti-v33-api-surface-'+route+'.json'),JSON.stringify(capture));
      console.log(JSON.stringify({route,requests:state.requests.length,verdict:evaluateCourseraCapture(capture,courseId),questionCount:fp.payload.structuredAssessment?.questionCount,diagnostic:fp.payload.captureDiagnostics}));
      assert.equal(evaluateCourseraCapture(capture,courseId).complete,true);assert.equal(fp.payload.structuredAssessment.questionCount,count);
      assert.equal(fp.payload.assessmentApiEvidence.groups.length,count);assert.equal(fp.payload.assessmentApiEvidence.questionDefinitions.length,count);
      assert(fp.payload.structuredAssessment.questions.every((q,i)=>q.courseraQuestionId===groupId(i+1)&&q.sourceDefinitionId===definitionId(i+1)&&q.correctAnswers[0]==='Correct synthetic choice '+(i+1)));
      const diag=fp.payload.captureDiagnostics;assert.equal(diag.authoringAssessmentApiCertification.status,'CERTIFIED');
      assert.equal(diag.authoringAssessmentApiCertification.routeKind,route==='project'?'ITEM_SPECIFIC':'GENERIC_COURSE_EDIT');
      assert.equal(errors.length,0,JSON.stringify(errors));assert(state.requests.every(request=>request.method==='GET'));
      const questionClicks=await page.evaluate(()=>fixtureObservations.questionClicks);assert.equal(questionClicks,0);
      console.log(JSON.stringify({status:'PASS',route,questions:count,definitionRequests:state.requests.length,questionEditorClicks:0,downloads:1,elapsedMs:Date.now()-startedAt,certification:diag.authoringAssessmentApiCertification,scope:'Full current canonical entry and native IndexedDB; synthetic MCQ definitions'}));
    }
    await context.close();
  }
}catch(error){console.error('::error::Deep assessment surface regression: '+String(error.message).replace(/\r?\n/g,' '));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
