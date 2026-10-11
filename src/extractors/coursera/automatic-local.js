// Pure controller decisions. The entry point owns browser storage and reloads.
export function automaticLocalCaptureNeedsContinuationV61519(capture) {
  const meta=capture.meta || {},accounting=meta.captureAccounting || {};
  const crawl=meta.activeSpaCrawl || {};
  return Boolean(crawl.timeBudgetExhausted || Number(accounting.unvisitedCount || 0)>0 ||
    Number(accounting.retryableUnresolvedCount || 0)>0 ||
    (capture.fingerprints || []).some(fp=>{
      const contract=fp.captureContract || fp.payload && fp.payload.captureContract;
      return contract && (contract.needsEditor===true || contract.retryable===true);
    }));
}

export function advanceAutomaticLocalCaptureV61517(plan, capture, checkpointAvailable, checkpointFailed, retainCheckpoint, now) {
  const accounting=capture.meta && capture.meta.captureAccounting || {};
  const fingerprints=Array.isArray(capture.fingerprints)?capture.fingerprints:[];
  const progress=JSON.stringify([fingerprints.length,
    fingerprints.filter(fp=>Number(fp.payload && fp.payload.captureAttempts || 0)>0 || fp.payload && fp.payload.checkpointRestored).length,
    fingerprints.reduce((n,fp)=>n+Number(fp.payload && fp.payload.captureAttempts || 0),0),
    Number(accounting.completeCount || 0)]);
  const next=Object.assign({},plan,{batches:Number(plan.batches || 0)+1,lastProgress:progress,
    stalled:plan.lastProgress===progress?Number(plan.stalled || 0)+1:0,updatedAt:now});
  let reason='';
  if(fingerprints.length===0)reason='COURSE_INVENTORY_EMPTY';
  else if(!retainCheckpoint && !automaticLocalCaptureNeedsContinuationV61519(capture))reason='INVENTORY_FINISHED';
  else if(!checkpointAvailable || checkpointFailed)reason='LOCAL_CHECKPOINT_UNAVAILABLE';
  else if(next.stalled>=3)reason='LOCAL_CAPTURE_NO_PROGRESS';
  else if(next.batches>=500 || now-Number(plan.startedAt)>=8*60*60*1000)reason='LOCAL_CAPTURE_RUN_LIMIT';
  next.state=reason?'FINISHED':'RUNNING';
  next.reason=reason;
  next.complete=accounting.complete===true;
  next.message=reason==='INVENTORY_FINISHED'?
    (next.complete?'Every inventory item has a complete capture.':'Acquisition finished; review the explicit evidence gaps.'):
    reason==='COURSE_INVENTORY_EMPTY'?'No supported course inventory was returned. Check the authoring shell before restarting.':
    reason==='LOCAL_CHECKPOINT_UNAVAILABLE'?'Browser checkpoints are unavailable. Capture stopped with partial evidence.':
    reason==='LOCAL_CAPTURE_NO_PROGRESS'?'Capture stopped after repeated batches made no progress. Partial evidence is retained.':
    reason==='LOCAL_CAPTURE_RUN_LIMIT'?'Capture reached its run limit. Partial evidence is retained.':'Continuing automatically.';
  return next;
}
