import test from 'node:test';
import assert from 'node:assert/strict';
import {accumulateAutomaticLocalPerformanceV61531,advanceAutomaticLocalCaptureV61517} from '../src/extractors/coursera/automatic-local.js';
import {captureContractV6150} from '../src/extractors/coursera/completion.js';

const start=Date.parse('2026-10-13T00:00:00Z');

test('deferred checkpoint progress preserves counts without certifying an empty fingerprint',()=>{
 const fp={id:'complete_checkpoint',typeName:'supplement',payload:{}};
 const data={extractedAt:new Date(start+1000).toISOString(),fingerprints:[fp],
  meta:{captureAccounting:{scope:'CHECKPOINT_CONTINUATION_ONLY',complete:false,completeCount:1,unvisitedCount:1}}};
 const getter=item=>item===fp?[100,100,1000,0,0,1,1]:null;
 const next=advanceAutomaticLocalCaptureV61517({startedAt:start,batches:0,stalled:0},data,true,false,true,start+2000,getter);
 assert.deepEqual(next.evidenceProgress.items[0],['complete_checkpoint',100,100,1000,0,0,1,1]);
 assert.equal(next.state,'RUNNING');assert.equal(next.complete,false);
 assert.equal(captureContractV6150(fp).complete,false);assert.deepEqual(fp.payload,{});
});

test('unchanged deferred progress still reaches the no-progress stop',()=>{
 const fp={id:'complete_checkpoint',payload:{}};
 let plan={startedAt:start,batches:0,stalled:0};
 for(let i=0;i<4;i++){
  const at=start+(i+1)*10000;
  const data={extractedAt:new Date(at).toISOString(),fingerprints:[fp],
   meta:{captureAccounting:{scope:'CHECKPOINT_CONTINUATION_ONLY',complete:false,completeCount:1,unvisitedCount:1}}};
  plan=advanceAutomaticLocalCaptureV61517(plan,data,true,false,true,at+1000,()=>[100,100,1000,0,0,1,1]);
 }
 assert.equal(plan.reason,'LOCAL_CAPTURE_NO_PROGRESS');assert.equal(plan.batches,4);assert.equal(plan.stalled,3);
});
function capture(batch,overrides={}){
 return {extractedAt:new Date(start+batch*100000).toISOString(),...overrides,
  meta:{runtime:{totalBeforeDownloadMs:50000,setupMs:10000,primaryMs:30000,recoveryMs:5000,
    postCrawlCaptureMs:1000,assetAndNormalizationMs:3000,finalizationMs:1000},
    performance:{primaryVisibilityPausedMs:20000,recoveryVisibilityPausedMs:1000,
      api:{requests:202,elapsedMs:30000,fallbackReasons:['INCOMPLETE_LIVE_OUTLINE_INVENTORY']}},
    checkpointResume:{stored:100,restored:50,deferred:45,skipped:5,restoredBytes:600000},
    localCaptureBatch:{yieldReason:'LOCAL_RENDERER_HEAP_LIMIT'},...overrides.meta}};
}

test('cumulative telemetry separates paused phase time and measures repeated restoration work',()=>{
 const first=accumulateAutomaticLocalPerformanceV61531({batches:10},capture(1));
 Object.freeze(first);Object.freeze(first.totals);
 const next=accumulateAutomaticLocalPerformanceV61531({batches:11,performance:first},capture(2));
 assert.equal(next.recordedBatches,2);assert.equal(next.totals.wallMs,100000);assert.equal(next.totals.activeMs,58000);
 assert.equal(next.totals.pausedMs,42000);assert.equal(next.totals.primaryActiveMs,20000);
 assert.equal(next.totals.recoveryActiveMs,8000);assert.equal(next.totals.setupMs,20000);
 assert.equal(next.totals.finalizationMs,2000);assert.equal(next.totals.checkpointRestoredBytes,1200000);
 assert.equal(next.totals.checkpointRestored,100);assert.equal(next.totals.checkpointDeferred,90);
 assert.equal(next.totals.checkpointSkipped,10);assert.equal(next.totals.apiRequests,404);
 assert.equal(next.totals.apiElapsedMs,60000);assert.equal(next.yieldReasons.LOCAL_RENDERER_HEAP_LIMIT,2);
 assert.equal(next.apiFallbackReasons.INCOMPLETE_LIVE_OUTLINE_INVENTORY,2);
 assert.equal(first.recordedBatches,1);assert.equal(next.recent[1].batch,12);
});

test('a repeated document does not count its costs twice',()=>{
 const data=capture(1),first=accumulateAutomaticLocalPerformanceV61531({batches:0},data);
 const next=accumulateAutomaticLocalPerformanceV61531({batches:1,performance:first},data);
 assert.deepEqual(next,first);
});

test('malformed numbers are finite and telemetry cannot retain raw values, IDs, URLs or tokens',()=>{
 const marker='PRIVATE_PAYLOAD_DO_NOT_RETAIN',bad=capture(1,{meta:{runtime:{setupMs:Infinity,primaryMs:NaN,recoveryMs:-1,
    finalizationMs:'123',totalBeforeDownloadMs:1000},performance:{primaryVisibilityPausedMs:1001,api:{requests:Infinity,
    elapsedMs:-1,fallbackReasons:[marker,'https://private.test/?token='+marker,'ITEM_API_DEADLINE'],raw:marker}},
    checkpointResume:{stored:-1,restored:'20',deferred:NaN,skipped:Infinity,restoredBytes:marker,runId:marker},
    localCaptureBatch:{yieldReason:marker}}});
 const prior={version:1,totals:{setupMs:Infinity,checkpointRestored:marker,secret:marker},
  recent:[{batch:1,itemId:marker,url:marker,setupMs:NaN}],yieldReasons:{[marker]:1}};
 const next=accumulateAutomaticLocalPerformanceV61531({performance:prior},bad);
 assert.equal(next.totals.setupMs,0);assert.equal(next.totals.primaryMs,0);assert.equal(next.totals.checkpointRestored,0);
 assert.equal(next.totals.activeMs,1000);assert.equal(next.apiFallbackReasons.ITEM_API_DEADLINE,1);
 assert.equal(next.apiFallbackReasons.OTHER,2);assert.equal(next.yieldReasons.OTHER,2);
 assert(!JSON.stringify(next).includes(marker));assert(!JSON.stringify(next).includes('https://'));
 assert(Object.values(next.totals).every(value=>Number.isFinite(value) && value>=0));
});

test('history stays at twenty receipts and telemetry stops accumulating after five hundred batches',()=>{
 let performance;
 for(let batch=1;batch<=510;batch++)performance=accumulateAutomaticLocalPerformanceV61531({batches:batch-1,performance},capture(batch));
 assert.equal(performance.recordedBatches,500);assert.equal(performance.recent.length,20);
 assert.equal(performance.recent[0].batch,481);assert.equal(performance.recent.at(-1).batch,500);
 assert.equal(performance.totals.apiRequests,500*202);assert.equal(performance.yieldReasons.LOCAL_RENDERER_HEAP_LIMIT,500);
 assert(JSON.stringify(performance).length<40000);
});

test('undefined finalization fields and unavailable API summaries contribute zero',()=>{
 const next=accumulateAutomaticLocalPerformanceV61531({},capture(1,{meta:{runtime:{totalBeforeDownloadMs:1000,setupMs:1000},
  performance:{},checkpointResume:{restored:1}}}));
 assert.equal(next.totals.primaryMs,0);assert.equal(next.totals.finalizationMs,0);assert.equal(next.totals.apiRequests,0);
 assert.equal(next.totals.setupMs,1000);assert.equal(next.totals.activeMs,1000);assert.equal(next.totals.checkpointRestored,1);
});

test('performance counts repeated partial-question batches without changing progress or safety limits',()=>{
 let plan={state:'RUNNING',startedAt:start,batches:0,stalled:0};
 for(let batch=1;batch<=3;batch++){
  const data=capture(batch,{fingerprints:[{id:'quiz',payload:{assessmentCaptureInProgress:{assessment:{
    questions:Array.from({length:batch*5},(_,i)=>({courseraQuestionId:'group'+i,questionOrdinalObserved:true}))}}}}]});
  data.meta.captureAccounting={complete:false,completeCount:0,unvisitedCount:1};
  plan=advanceAutomaticLocalCaptureV61517(plan,data,true,false,true,start+batch*100000+50000);
  assert.equal(plan.state,'RUNNING');assert.equal(plan.stalled,0);
 }
 assert.equal(plan.performance.recordedBatches,3);assert.equal(plan.performance.totals.checkpointRestored,150);
 assert.equal(plan.performance.totals.apiRequests,606);assert.equal(plan.evidenceProgress.items[0][1],15);
 assert.equal(plan.startedAt,start);assert(!JSON.stringify(plan.performance).includes('quiz'));
 const final=capture(4,{fingerprints:[{id:'reading',payload:{}}]});
 const stopped=advanceAutomaticLocalCaptureV61517({...plan,batches:499},final,true,false,true,start+500000);
 assert.equal(stopped.reason,'LOCAL_CAPTURE_RUN_LIMIT');assert.equal(stopped.batches,500);
 const elapsed=advanceAutomaticLocalCaptureV61517(plan,{...final,extractedAt:new Date(start+8*60*60*1000-50000).toISOString()},
  true,false,true,start+8*60*60*1000);
 assert.equal(elapsed.reason,'LOCAL_CAPTURE_RUN_LIMIT');assert.equal(elapsed.startedAt,start);
});
