import { questionEvidenceReadyV6138 } from './assessments-2.js';
import { canonicalRemoteAssetKeyV614 } from './assets.js';

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

export function automaticLocalEvidenceProgressV61526(plan,capture) {
  const prior=plan.evidenceProgress?.version===1?plan.evidenceProgress:{version:1,completeCount:0,items:[]};
  const items=new Map();
  for(const row of (Array.isArray(prior.items)?prior.items:[]).slice(0,20000)){
    if(Array.isArray(row) && typeof row[0]==='string' && row[0])items.set(row[0],row.slice(1,8).map(value=>Math.max(0,Math.min(20000,Number(value)||0))));
  }
  let advanced=false;
  for(const fp of (Array.isArray(capture.fingerprints)?capture.fingerprints:[]).slice(0,20000)){
    if(!fp || typeof fp.id!=='string' || !fp.id)continue;
    const payload=fp.payload || {},questions=new Map(),assets=new Set(),hashes=new Set();
    for(const model of [payload.structuredAssessment,payload.assessmentCaptureInProgress?.assessment]){
      for(const question of (Array.isArray(model?.questions)?model.questions:[]).slice(0,20000)){
        if(!question || typeof question.courseraQuestionId!=='string' || !question.courseraQuestionId || question.questionOrdinalObserved!==true)continue;
        const ready=questionEvidenceReadyV6138(question);
        questions.set(question.courseraQuestionId,ready || questions.get(question.courseraQuestionId)===true);
      }
    }
    for(const asset of (Array.isArray(payload.assetDetails)?payload.assetDetails:[]).slice(0,20000)){
      if(!asset || typeof asset!=='object')continue;
      const key=typeof asset.assetId==='string' && asset.assetId || canonicalRemoteAssetKeyV614(asset);
      if(key && Number(payload.assetEvidenceConfidence || 0)>=0.9)assets.add(key);
      if(typeof asset.sha256==='string' && /^[a-f0-9]{64}$/i.test(asset.sha256))hashes.add(asset.sha256);
    }
    const contract=payload.captureContract || fp.captureContract || {};
    const complete=contract.complete===true?1:0;
    const terminal=contract.accounted===true && contract.needsEditor===false && contract.retryable===false?1:0;
    const textEvidence=payload.textCaptureEvidence;
    const textCharacters=textEvidence?.itemId===fp.id?Math.min(20000,Math.max(0,Number(textEvidence.capturedCharacters || 0))):0;
    const observed=[questions.size,[...questions.values()].filter(Boolean).length,textCharacters,assets.size,hashes.size,complete,terminal];
    const previous=items.get(fp.id) || [],highWater=observed.map((value,index)=>{
      const before=Number(previous[index] || 0);if(value>before)advanced=true;return Math.max(value,before);
    });
    if(items.has(fp.id) || items.size<20000)items.set(fp.id,highWater);
  }
  const currentComplete=Math.max(0,Math.min(20000,Number(capture.meta?.captureAccounting?.completeCount || 0)));
  const priorComplete=Math.max(0,Math.min(20000,Number(prior.completeCount || 0)));
  if(currentComplete>priorComplete)advanced=true;
  const record={version:1,completeCount:Math.max(currentComplete,priorComplete),items:[...items].sort((a,b)=>a[0].localeCompare(b[0])).map(([id,metrics])=>[id,...metrics])};
  return {advanced,record,signature:JSON.stringify(record)};
}

export function advanceAutomaticLocalCaptureV61517(plan, capture, checkpointAvailable, checkpointFailed, retainCheckpoint, now) {
  const accounting=capture.meta && capture.meta.captureAccounting || {};
  const fingerprints=Array.isArray(capture.fingerprints)?capture.fingerprints:[];
  const progress=automaticLocalEvidenceProgressV61526(plan,capture);
  const next=Object.assign({},plan,{batches:Number(plan.batches || 0)+1,lastProgress:progress.signature,evidenceProgress:progress.record,
    stalled:progress.advanced?0:Number(plan.stalled || 0)+1,updatedAt:now});
  let reason='';
  if(capture.meta?.activeSpaCrawl?.authoringApiAccessStopped)reason='AUTHORING_API_ACCESS_REQUIRED';
  else if(capture.meta?.activeSpaCrawl?.authoringApiRateLimited)reason='AUTHORING_API_RATE_LIMITED';
  else if(fingerprints.length===0)reason='COURSE_INVENTORY_EMPTY';
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
    reason==='AUTHORING_API_ACCESS_REQUIRED'?'Coursera denied a question-definition read. Check your sign-in and authoring permission before resuming. Partial evidence is retained.':
    reason==='AUTHORING_API_RATE_LIMITED'?'Coursera rate-limited question reads. Capture stopped with saved evidence; allow its cooldown before resuming.':
    reason==='LOCAL_CHECKPOINT_UNAVAILABLE'?'Browser checkpoints are unavailable. Capture stopped with partial evidence.':
    reason==='LOCAL_CAPTURE_NO_PROGRESS'?'Capture stopped after repeated batches made no progress. Partial evidence is retained.':
    reason==='LOCAL_CAPTURE_RUN_LIMIT'?'Capture reached its run limit. Partial evidence is retained.':'Continuing automatically.';
  return next;
}
