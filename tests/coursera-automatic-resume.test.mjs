import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeAutomaticLocalCaptureV61529} from '../src/extractors/coursera/automatic-local.js';

const now=Date.now(),oldToken='old_fixture_token_123',newToken='new_fixture_token_456';
const config={resumeExisting:true,courseId:'Resume_course_123',token:newToken};
function plan(overrides={}){
 return {state:'RUNNING',token:oldToken,courseId:config.courseId,reason:'',startedAt:now-50*60000,
  updatedAt:now-60000,batches:41,stalled:0,captureMode:'FRESH_FULL_COURSE',checkpointRunId:'fresh-'+oldToken,
  supervisorRecoveries:2,evidenceProgress:{version:1,completeCount:35,items:[['quiz',100,100,0,0,0,1,1]]},
  lastProgress:'original-signature',...overrides};
}
function resume(prior=plan(),nextConfig=config,session={id:prior.checkpointRunId},at=now){
 return resumeAutomaticLocalCaptureV61529(prior,nextConfig,session,at);
}

test('explicit resume preserves the original fresh namespace, evidence and every run limit counter',()=>{
 const prior=plan();Object.freeze(prior);Object.freeze(prior.evidenceProgress);
 const next=resume(prior);
 for(const key of ['courseId','startedAt','batches','stalled','captureMode','supervisorRecoveries','lastProgress','evidenceProgress','checkpointRunId'])
  assert.deepEqual(next[key],prior[key],key+' must survive recovery');
 assert.equal(next.token,newToken);assert.equal(next.state,'RUNNING');assert.equal(next.reason,'');
 assert.equal(next.updatedAt,now);assert.equal(next.resumedAt,now);assert.equal(next.resumedFromToken,oldToken);
 assert.equal(next.checkpointOwnerToken,oldToken);assert.notEqual(next,prior);
 assert.equal(prior.token,oldToken);assert.equal(prior.updatedAt,now-60000);
});

test('a second manual resume preserves the same namespace and original checkpoint owner',()=>{
 const first=resume(),later=resume(first,{...config,token:'third_fixture_token_789'},{id:first.checkpointRunId},now+60000);
 assert.equal(later.checkpointRunId,'fresh-'+oldToken);assert.equal(later.checkpointOwnerToken,oldToken);
 assert.equal(later.resumedFromToken,newToken);assert.equal(later.startedAt,plan().startedAt);
 assert.equal(later.batches,41);assert.equal(later.supervisorRecoveries,2);
});

test('legacy resume adopts only the current locally stored valid namespace',()=>{
 for(const id of ['run-1791800000000-a9z','fresh-other_fixture_token_123']){
  const prior=plan({captureMode:'RESUME_AVAILABLE_WORK',checkpointRunId:''});
  const next=resume(prior,config,{id});
  assert.equal(next.checkpointRunId,id);assert.equal(next.captureMode,'RESUME_AVAILABLE_WORK');
 }
 for(const id of ['',undefined,'run-x-ab','run-123-UPPER','fresh-short','older|wrong-course','run-123-abc/extra']){
  assert.throws(()=>resume(plan({captureMode:'RESUME_AVAILABLE_WORK',checkpointRunId:''}),config,{id}),/checkpoint namespace/);
 }
});

test('resume rejects cross-course or mismatched namespaces and malformed run identities',()=>{
 assert.throws(()=>resume(plan(),{...config,courseId:'Other_course_123'}),/identity/);
 assert.throws(()=>resume(plan(),{...config,token:oldToken}),/identity/);
 assert.throws(()=>resume(plan({token:'short'})),/identity/);
 assert.throws(()=>resume(plan({captureMode:'unknown'})),/identity/);
 assert.throws(()=>resume(plan(),config,{id:'fresh-other_fixture_token_123'}),/checkpoint namespace/);
 assert.throws(()=>resume(plan({checkpointRunId:'fresh-other_fixture_token_123'})),/original fresh run/);
 assert.throws(()=>resume(plan({checkpointRunId:''}),config,{id:'fresh-'+oldToken}),/original fresh run/);
 assert.throws(()=>resume(plan({checkpointOwnerToken:'bad'})),/checkpoint owner/);
});

test('only a verified controller-link interruption is resumable after a terminal state',()=>{
 const linked=resume(plan({state:'FINISHED',reason:'LOCAL_SUPERVISOR_LINK_UNAVAILABLE'}));
 assert.equal(linked.state,'RUNNING');assert.equal(linked.reason,'');
 for(const reason of ['INVENTORY_FINISHED','AUTHORING_API_ACCESS_REQUIRED','AUTHORING_API_RATE_LIMITED',
  'LOCAL_CHECKPOINT_UNAVAILABLE','LOCAL_CAPTURE_NO_PROGRESS','LOCAL_CAPTURE_RUN_LIMIT','RESUMED_WITH_NEW_COMMAND','']){
  assert.throws(()=>resume(plan({state:'FINISHED',reason})),/already ended/);
 }
 assert.throws(()=>resume(plan({state:'SUPERSEDED',reason:'RESUMED_WITH_NEW_COMMAND'})),/already ended/);
 assert.throws(()=>resume(plan({reason:'unexplained'})),/already ended/);
});

test('manual recovery cannot reset elapsed, batch, stall or recovery limits',()=>{
 for(const fields of [{startedAt:now+1},{startedAt:now-8*60*60*1000},{startedAt:NaN},{startedAt:'123'},
  {startedAt:0},{batches:500},{batches:NaN},{batches:-1},{batches:1.5},{stalled:3},{stalled:-1},
  {supervisorRecoveries:30},{supervisorRecoveries:31},{supervisorRecoveries:'2'}]){
  assert.throws(()=>resume(plan(fields)),/run reached/);
 }
 const near=resume(plan({startedAt:now-8*60*60*1000+1,batches:499,stalled:2}));
 assert.equal(near.batches,499);assert.equal(near.stalled,2);
 assert.throws(()=>resume(plan(),config,{id:'fresh-'+oldToken},NaN),/run reached/);
});

test('helper requires explicit browser resume without a fresh run or imported capture',()=>{
 for(const nextConfig of [null,[],{...config,resumeExisting:false},{...config,resumeExisting:'true'},
  {...config,freshRun:true},{...config,savedCapture:{}},{...config,localResumeCapture:null}]){
  assert.throws(()=>resume(plan(),nextConfig),/explicit checkpoint command/);
 }
});
