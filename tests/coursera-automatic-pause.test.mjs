import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticLocalRunTimingV61530,advanceAutomaticLocalCaptureV61517,resumeAutomaticLocalCaptureV61529} from '../src/extractors/coursera/automatic-local.js';

const hour=60*60*1000,startedAt=Date.parse('2026-10-13T00:00:00Z');
const oldToken='pause_fixture_old_123',newToken='pause_fixture_new_456';
function plan(overrides={}){
 return {state:'RUNNING',courseId:'Pause_course_123',token:oldToken,startedAt,batches:40,stalled:0,
  captureMode:'FRESH_FULL_COURSE',checkpointRunId:'fresh-'+oldToken,supervisorRecoveries:2,...overrides};
}
function capture(documentAt,paused,complete=1){
 return {extractedAt:new Date(documentAt).toISOString(),fingerprints:[{id:'reading',payload:{captureContract:{complete:true}}}],
  meta:{activeSpaCrawl:{visibilityPausedMs:paused},captureAccounting:{complete:false,completeCount:complete,unvisitedCount:25}}};
}
function advance(prior,data,now){return advanceAutomaticLocalCaptureV61517(prior,data,true,false,true,now);}
function resume(prior,now){
 return resumeAutomaticLocalCaptureV61529(prior,{resumeExisting:true,courseId:prior.courseId,token:newToken},
  {id:prior.checkpointRunId},now);
}

test('five observed paused hours do not spend the automatic eight-hour active-work budget',()=>{
 const now=startedAt+(8*hour+12*60000),data=capture(startedAt+3*hour,5*hour);
 const next=advance(plan(),data,now);
 assert.equal(next.state,'RUNNING');assert.equal(next.reason,'');assert.equal(next.startedAt,startedAt);
 assert.equal(next.visibilityPausedMs,5*hour);assert.equal(next.wallElapsedMs,(8*hour+12*60000));
 assert.equal(next.activeElapsedMs,(3*hour+12*60000));assert.equal(next.batches,41);assert.equal(next.supervisorRecoveries,2);
});

test('eight active hours still stop a paused run and batch limits remain unchanged',()=>{
 const prior=plan({visibilityPausedMs:5*hour,visibilityPauseAccountedAt:startedAt+5*hour});
 const next=advance(prior,capture(startedAt+12*hour,0),startedAt+13*hour);
 assert.equal(next.reason,'LOCAL_CAPTURE_RUN_LIMIT');assert.equal(next.activeElapsedMs,8*hour);
 assert.equal(next.visibilityPausedMs,5*hour);assert.equal(next.complete,false);
 const batch=advance({...prior,batches:499},capture(startedAt+6*hour,0),startedAt+(6*hour+6*60000));
 assert.equal(batch.reason,'LOCAL_CAPTURE_RUN_LIMIT');assert.equal(batch.batches,500);
});

test('repeated document receipts cannot double count a pause and separate batches add only their own pause',()=>{
 const firstCapture=capture(startedAt+hour,5*hour),firstNow=startedAt+(6*hour+6*60000);
 const first=advance(plan(),firstCapture,firstNow);
 const repeated=advance(first,firstCapture,firstNow+60000);
 assert.equal(repeated.visibilityPausedMs,5*hour);assert.equal(repeated.visibilityPauseReceiptRejected,true);
 const secondAt=firstNow+120000,secondNow=secondAt+hour+60000;
 const second=advance(repeated,capture(secondAt,hour,2),secondNow);
 assert.equal(second.visibilityPausedMs,6*hour);
 assert.equal(second.activeElapsedMs,second.wallElapsedMs-6*hour);assert.equal(second.visibilityPauseReceiptRejected,false);
 assert.equal(first.visibilityPausedMs,5*hour,'Accounting must not mutate the prior plan');
});

test('liveness heartbeat updates cannot erase an independently observed pause',()=>{
 const now=startedAt+(8*hour+12*60000);
 const next=advance(plan({updatedAt:now-10}),capture(startedAt+3*hour,5*hour),now);
 assert.equal(next.visibilityPausedMs,5*hour);assert.equal(next.state,'RUNNING');
});

test('malformed or impossible document pause receipts receive no credit against limits',()=>{
 const now=startedAt+8*hour;
 for(const paused of ['5',NaN,Infinity,-1,0.5,9*hour]){
  const next=advance(plan(),capture(startedAt+3*hour,paused),now);
  assert.equal(next.visibilityPausedMs,0);assert.equal(next.activeElapsedMs,8*hour);
  assert.equal(next.reason,'LOCAL_CAPTURE_RUN_LIMIT');assert.equal(next.visibilityPauseReceiptRejected,true);
 }
 for(const extractedAt of [undefined,'not-a-date',new Date(startedAt-1).toISOString(),new Date(now+1).toISOString()]){
  const next=advance(plan(),{...capture(startedAt,5*hour),extractedAt},now);
  assert.equal(next.visibilityPausedMs,0);assert.equal(next.reason,'LOCAL_CAPTURE_RUN_LIMIT');
 }
});

test('malformed cumulative pause counters cannot disable active-work limits or permit recovery',()=>{
 const now=startedAt+(8*hour+12*60000);
 for(const visibilityPausedMs of ['5',NaN,Infinity,-1,0.5,9*hour]){
  const prior=plan({visibilityPausedMs});
  assert.equal(advance(prior,capture(startedAt+3*hour,0),now).reason,'LOCAL_CAPTURE_RUN_LIMIT');
  assert.throws(()=>resume(prior,now),/run reached/);
 }
 const missingFrontier=plan({visibilityPausedMs:5*hour});
 assert.equal(automaticLocalRunTimingV61530(missingFrontier,null,now).valid,false);
 assert.throws(()=>resume(missingFrontier,now),/run reached/);
 for(const visibilityPauseAccountedAt of [startedAt-1,now+1,NaN,'123']){
  const prior=plan({visibilityPausedMs:5*hour,visibilityPauseAccountedAt});
  assert.equal(automaticLocalRunTimingV61530(prior,null,now).valid,false);
  assert.throws(()=>resume(prior,now),/run reached/);
 }
});

test('explicit recovery preserves paused hours and original limits while recomputing honest elapsed times',()=>{
 const now=startedAt+(8*hour+12*60000),prior=advance(plan(),capture(startedAt+3*hour,5*hour),now);
 const next=resume(prior,now+60000);
 assert.equal(next.startedAt,startedAt);assert.equal(next.visibilityPausedMs,5*hour);
 assert.equal(next.wallElapsedMs,(8*hour+12*60000)+60000);assert.equal(next.activeElapsedMs,(3*hour+12*60000)+60000);
 for(const key of ['batches','stalled','supervisorRecoveries','captureMode','checkpointRunId','evidenceProgress','visibilityPauseAccountedAt'])
  assert.deepEqual(next[key],prior[key]);
 assert.throws(()=>resume({...prior,state:'FINISHED',reason:'LOCAL_CAPTURE_RUN_LIMIT'},now),/already ended/);
 assert.throws(()=>resume(prior,startedAt+13*hour),/run reached/);
});
