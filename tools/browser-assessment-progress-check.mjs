import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright';
import {bundleConsole} from './console-bundle.mjs';
import {extractorFunctions} from './extractor-functions.cjs';
import * as config from '../src/extractors/coursera/config.js';
import {assessmentBrowserFixture} from './assessment-browser-fixture.mjs';

const definitions=[...extractorFunctions(bundleConsole(path.resolve('src/extractors/coursera/entry.js'))).values()].join('\n');
const runtime=Object.entries(config).map(([name,value])=>`const ${name}=${JSON.stringify(value)};`).join('\n')+'\n'+definitions;
const shell='https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit';
const html=assessmentBrowserFixture();
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
   if(assessment.questionCount>=31){localStorage.setItem('fixture-interrupted-count',String(assessment.questionCount));manager.close();setTimeout(()=>location.reload(),0);await new Promise(()=>{});}
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
  return {before,result,interruptedCount:Number(localStorage.getItem('fixture-interrupted-count')),contract:captureContractV6150(fp),visits:JSON.parse(localStorage.getItem('fixture-question-visits'))};
 });
 assert.equal(resumed.before.restored,1);assert.equal(resumed.before.attempts,0);assert.equal(resumed.before.questions,resumed.interruptedCount);
 assert(resumed.interruptedCount>=31 && resumed.interruptedCount<=35);
 assert.equal(resumed.before.contract.complete,false);assert.equal(resumed.before.contract.needsEditor,true);assert.equal(resumed.before.raw.preserved,true);
 assert.equal(resumed.result.assessment.questionCount,100);assert.equal(resumed.result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(resumed.result.outlineDomTraversal.reusedQuestions,resumed.interruptedCount);assert.equal(resumed.contract.complete,true);
 assert.equal(resumed.visits.length,99);assert.equal(new Set(resumed.visits).size,99,'Saved matching questions must not be clicked again after reload');
 assert(resumed.result.assessment.questions.every((q,i)=>q.courseraQuestionId==='assessment~q'+(i+1) && q.options.some(o=>o.text.includes('café'))));
 assert.deepEqual(errors,[]);
 console.log('Native assessment: virtualized 100 questions, durable save before a real document interruption, restoration of '+resumed.interruptedCount+' identified questions without repeated clicks, Unicode/raw preservation and strict unfinished/finished contracts verified.');
}finally{await browser.close()}
