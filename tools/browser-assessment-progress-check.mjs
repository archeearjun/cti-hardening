import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright';
import {bundleConsole} from './console-bundle.mjs';
import {extractorFunctions} from './extractor-functions.cjs';
import * as config from '../src/extractors/coursera/config.js';

const definitions=[...extractorFunctions(bundleConsole(path.resolve('src/extractors/coursera/entry.js'))).values()].join('\n');
const runtime=Object.entries(config).map(([name,value])=>`const ${name}=${JSON.stringify(value)};`).join('\n')+'\n'+definitions;
const shell='https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit';
const html=`<!doctype html><meta charset="utf-8"><style>
 #editor{position:relative}#rail{width:350px;height:320px;overflow-y:auto}#rows{height:3200px;position:relative}
 [data-testid=assignment-outline]{position:absolute;height:32px;width:340px}#content{margin-left:380px;min-height:600px}
</style><main id="editor"><aside id="rail" data-testid="item-layout-left-sidebar"><p>Assignment outline Content (100)</p><div id="rows"></div></aside><div id="content" data-testid="item-layout-content"></div></main>
<script>
 const rail=document.getElementById('rail'),rows=document.getElementById('rows'),content=document.getElementById('content');
 const prompt=n=>'Which result is correct for scenario '+n+' in this assessment?';
 function open(n,record=true){
  if(record){const visits=JSON.parse(localStorage.getItem('fixture-question-visits') || '[]');visits.push(n);localStorage.setItem('fixture-question-visits',JSON.stringify(visits));}
  content.innerHTML='<section id="assessment~q'+n+'" data-testid="assignment-part-'+(n-1)+'"><h3>'+n+'Auto-Graded 1 point</h3><p>Question Type Multiple Choice Prompt</p><p>'+prompt(n)+'</p><p>Options</p><div data-testid="option"><p>Correct choice café '+n+'</p><span>Correct</span></div><div data-testid="option"><p>Other choice 日本語 '+n+'</p><span>Incorrect</span></div><p>Incorrect Answers: Explanation</p><p>Explanation '+n+'.</p><p>Export Settings</p></section>';
 }
 function render(){
  const first=Math.min(90,Math.max(0,Math.floor(rail.scrollTop/32)));
  rows.replaceChildren();
  for(let i=first;i<Math.min(100,first+10);i++){
   const row=document.createElement('div');row.dataset.testid='assignment-outline';row.style.top=(i*32)+'px';row.setAttribute('data-rbd-drag-handle-draggable-id','q'+(i+1));
   const number=document.createElement('span');number.textContent=(i+1)+' ';
   const anchor=document.createElement('a');anchor.href='#assessment~q'+(i+1);anchor.textContent=prompt(i+1).slice(0,47);anchor.onclick=event=>{event.preventDefault();open(i+1)};
   row.append(number,anchor);rows.append(row);
  }
 }
 rail.addEventListener('scroll',render);render();open(1,false);
</script>`;
const browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext();await context.route('https://www.coursera.org/**',route=>route.fulfill({contentType:'text/html',body:html}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(shell);await page.addScriptTag({content:runtime});
 const reloaded=page.waitForEvent('domcontentloaded',{timeout:30000});
 const interrupted=page.evaluate(async()=>{
  const fp={id:'assessment-under-test',name:'Synthetic assessment',type:'Assignment',typeName:'staffGraded',payload:{captureAttempts:1,rawSnapshot:{preserved:true}}};
  const manager=await createCheckpointManagerV6150('Assessment_fixture_123');
  return collectCourseraAssessmentByQuestionCycleV662(document.getElementById('editor'),fp,{deadline:Date.now()+90000,onCheckpoint:async assessment=>{
   const snapshot=assessmentQuestionCheckpointV61518(fp,assessment,new Date().toISOString());
   const saved=await manager.save(snapshot,null,'assessment-progress');if(!saved)throw new Error('Synthetic checkpoint failed');
   fp.payload.assessmentCaptureInProgress=snapshot.payload.assessmentCaptureInProgress;
   if(assessment.questionCount>=31){manager.close();setTimeout(()=>location.reload(),0);await new Promise(()=>{});}
   return true;
  }});
 }).then(()=>({unexpectedCompletion:true}),error=>({error:error.message}));
 await reloaded;const interruption=await interrupted;assert.match(interruption.error,/Execution context was destroyed|Cannot find context/);
 await page.addScriptTag({content:runtime});
 const resumed=await page.evaluate(async()=>{
  const fp={id:'assessment-under-test',name:'Synthetic assessment',type:'Assignment',typeName:'staffGraded',payload:{}};
  const manager=await createCheckpointManagerV6150('Assessment_fixture_123');const receipt=await manager.restore([fp]);
  const before={restored:receipt.restored,attempts:fp.payload.captureAttempts,questions:fp.payload.assessmentCaptureInProgress?.assessment?.questionCount,
   contract:captureContractV6150(fp),raw:fp.payload.rawSnapshot};
  fp.payload.captureAttempts=Number(fp.payload.captureAttempts || 0)+1;
  const result=await collectCourseraAssessmentByQuestionCycleV662(document.getElementById('editor'),fp,{deadline:Date.now()+90000,
   seedAssessment:fp.payload.assessmentCaptureInProgress.assessment,onCheckpoint:async assessment=>{
    const snapshot=assessmentQuestionCheckpointV61518(fp,assessment,new Date().toISOString());
    const saved=await manager.save(snapshot,null,'assessment-progress');if(saved)fp.payload.assessmentCaptureInProgress=snapshot.payload.assessmentCaptureInProgress;return saved;
   }});
  fp.payload.structuredAssessment=result.assessment;delete fp.payload.assessmentCaptureInProgress;
  await manager.save(fp,null,'primary');manager.close();
  return {before,result,contract:captureContractV6150(fp),visits:JSON.parse(localStorage.getItem('fixture-question-visits'))};
 });
 assert.equal(resumed.before.restored,1);assert.equal(resumed.before.attempts,0);assert.equal(resumed.before.questions,31);
 assert.equal(resumed.before.contract.complete,false);assert.equal(resumed.before.contract.needsEditor,true);assert.equal(resumed.before.raw.preserved,true);
 assert.equal(resumed.result.assessment.questionCount,100);assert.equal(resumed.result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(resumed.result.outlineDomTraversal.reusedQuestions,31);assert.equal(resumed.contract.complete,true);
 assert.equal(resumed.visits.length,99);assert.equal(new Set(resumed.visits).size,99,'Saved matching questions must not be clicked again after reload');
 assert(resumed.result.assessment.questions.every((q,i)=>q.courseraQuestionId==='assessment~q'+(i+1) && q.options.some(o=>o.text.includes('café'))));
 assert.deepEqual(errors,[]);
 console.log('Native assessment: virtualized 100 questions, durable save before a real document interruption, restoration of 31 identified questions without repeated clicks, Unicode/raw preservation and strict unfinished/finished contracts verified.');
}finally{await browser.close()}
