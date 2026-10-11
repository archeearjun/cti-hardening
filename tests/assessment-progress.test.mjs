import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assessmentQuestionCheckpointV61518} from '../src/extractors/coursera/assessments-4.js';
import {captureContractV6150} from '../src/extractors/coursera/completion.js';
const {fixture,El}=createRequire(import.meta.url)('../tools/assessment-fixture.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));

test('a delayed 100-question editor avoids repeated rail layout and unchanged DOM parsing',async()=>{
  const f=fixture({count:100,mode:'virtual',delay:1000,budget:480000});
  let anchorLayouts=0,parses=0;
  const visible=f.c.isVisibleElement,parse=f.c.parseAssignmentPartDomV665;
  f.c.isVisibleElement=el=>{if(el?.tagName==='A')anchorLayouts++;return visible(el);};
  f.c.parseAssignmentPartDomV665=(...args)=>{parses++;return parse(...args);};
  const result=await f.runFull();
  assert.equal(result.assessment.questionCount,100);
  assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert(anchorLayouts<1200,`Repeated full-rail layout checks: ${anchorLayouts}`);
  assert(parses<340,`Repeated parsing of unchanged questions: ${parses}`);
  assert.equal(f.mutations(),0);
});

test('interrupted question collection resumes only matching observed question identities',async()=>{
  const first=fixture({count:100,mode:'virtual',budget:480000});
  let saved=null;
  await assert.rejects(first.c.collectCourseraAssessmentByQuestionCycleV662(first.envelope,first.fp,{
    deadline:480000,onCheckpoint:async model=>{
      saved=clone(model);
      if(model.questionCount>=36)throw new Error('synthetic document interruption');
      return true;
    },
  }),/synthetic document interruption/);
  assert.equal(saved.questionCount,36);
  assert.equal(saved.captureCompleteness.questionCoverageComplete,false);
  const resumed=fixture({count:100,mode:'virtual',budget:480000});
  const result=await resumed.c.collectCourseraAssessmentByQuestionCycleV662(resumed.envelope,resumed.fp,{
    deadline:480000,seedAssessment:saved,
  });
  assert.equal(result.assessment.questionCount,100);
  assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert.equal(resumed.clicks(),64);
  assert.deepEqual(clone(result.assessment.questions.slice(1,36)),saved.questions.slice(1));
  const changed=fixture({count:100,mode:'virtual',budget:480000});
  saved.questions[9].prompt='A different question that was previously observed.';
  const checked=await changed.c.collectCourseraAssessmentByQuestionCycleV662(changed.envelope,changed.fp,{deadline:480000,seedAssessment:saved});
  assert.equal(changed.clicks(),65,'A changed prompt must be observed again');
  assert.notEqual(checked.assessment.questions[9].prompt,saved.questions[9].prompt);
});

test('a partial question checkpoint preserves raw observations and cannot complete an unfinished visit',async()=>{
  const f=fixture({count:10,mode:'virtual',budget:480000}),full=(await f.runFull()).assessment;
  const raw={questions:[{unknownField:'original raw evidence'}]};
  const fp={id:'assessment-under-test',type:'Assignment',payload:{captureAttempts:1,rawSnapshot:raw,structuredAssessment:full}};
  const before=JSON.stringify(fp);
  const checkpoint=assessmentQuestionCheckpointV61518(fp,full,'2026-10-11T00:00:00Z');
  assert.equal(checkpoint.payload.captureAttempts,0);
  assert.equal(captureContractV6150(checkpoint).complete,false);
  assert.equal(captureContractV6150(checkpoint).needsEditor,true);
  assert.deepEqual(checkpoint.payload.rawSnapshot,raw);
  assert.equal(JSON.stringify(fp),before);
  const subset={...full,questionCount:2,questions:full.questions.slice(0,2)};
  const repeated=assessmentQuestionCheckpointV61518({...fp,payload:{...fp.payload,assessmentCaptureInProgress:checkpoint.payload.assessmentCaptureInProgress}},subset,'2026-10-11T00:01:00Z');
  assert.equal(repeated.payload.assessmentCaptureInProgress.assessment.questionCount,10,'A later interruption cannot erase earlier saved question observations');
  assert.equal(captureContractV6150(repeated).complete,false);
  delete repeated.payload.assessmentCaptureInProgress;
  assert.equal(captureContractV6150(repeated).complete,true);
});

test('all mounted identified questions finish without a redundant question traversal',async()=>{
  const f=fixture({count:100,mode:'virtual',budget:480000});
  f.content.replaceChildren(...Array.from({length:100},(_,i)=>{
    const n=i+1,part=new El('section',{id:'assessment~q'+n,'data-testid':'assignment-part-'+i});
    part.append(new El('h3',{},n+'Auto-Graded 1 point'),new El('p',{},'Question Type Multiple Choice Prompt'),
      new El('p',{},`Which result is correct for scenario ${n} in this assessment?`),new El('p',{},'Options'));
    for(const [label,status] of [['A','Correct'],['B','Incorrect']]){
      const row=new El('div',{'data-testid':'option'});row.append(new El('p',{},label),new El('span',{},status));part.append(row);
    }
    return part;
  }));
  f.c.collectAssessmentFromOutlineDomV665=()=>{throw new Error('Redundant traversal');};
  const result=await f.runFull();
  assert.equal(result.stopReason,'MOUNTED_QUESTIONS_COMPLETE');
  assert.equal(result.assessment.questionCount,100);assert.equal(f.clicks(),0);
  assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
});

test('a failed progress save stops repeat writes without discarding collected questions',async()=>{
  const f=fixture({count:100,mode:'virtual',budget:480000});let writes=0;
  const result=await f.c.collectCourseraAssessmentByQuestionCycleV662(f.envelope,f.fp,{deadline:480000,onCheckpoint:async()=>{writes++;return false;}});
  assert.equal(writes,1);assert.equal(result.assessment.questionCount,100);
});
