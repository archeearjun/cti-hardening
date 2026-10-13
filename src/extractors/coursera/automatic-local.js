import { questionEvidenceReadyV6138 } from './assessments-2.js';
import { canonicalRemoteAssetKeyV614 } from './assets.js';

// Pure controller decisions. The entry point owns browser storage and reloads.
export function automaticLocalRunTimingV61530(plan,capture,now) {
  const validWall=typeof now==='number' && Number.isFinite(now) && typeof plan.startedAt==='number' &&
    Number.isFinite(plan.startedAt) && plan.startedAt>0 && plan.startedAt<=now;
  const wallElapsedMs=validWall?now-plan.startedAt:0;
  const storedPause=plan.visibilityPausedMs===undefined?0:plan.visibilityPausedMs;
  const storedAccountedAt=plan.visibilityPauseAccountedAt===undefined?plan.startedAt:plan.visibilityPauseAccountedAt;
  const valid=validWall && Number.isSafeInteger(storedPause) && storedPause>=0 && storedPause<=wallElapsedMs &&
    (storedPause===0 || plan.visibilityPauseAccountedAt!==undefined) &&
    typeof storedAccountedAt==='number' && Number.isFinite(storedAccountedAt) &&
    storedAccountedAt>=plan.startedAt && storedAccountedAt<=now &&
    (plan.visibilityPauseAccountedAt===undefined || storedPause<=storedAccountedAt-plan.startedAt);
  let visibilityPausedMs=valid?storedPause:0;
  let visibilityPauseReceiptRejected=false;
  const observedPause=capture?.meta?.activeSpaCrawl?.visibilityPausedMs;
  if(valid && observedPause!==undefined && observedPause!==0){
    const documentStartedAt=typeof capture.extractedAt==='string'?Date.parse(capture.extractedAt):NaN;
    // Receipt intervals must not overlap an already accounted document. The
    // liveness updatedAt changes during waits and cannot serve this purpose.
    if(Number.isSafeInteger(observedPause) && observedPause>0 && Number.isFinite(documentStartedAt) &&
      documentStartedAt>=storedAccountedAt && documentStartedAt<=now && observedPause<=now-documentStartedAt){
      visibilityPausedMs=Math.min(wallElapsedMs,visibilityPausedMs+observedPause);
    }else visibilityPauseReceiptRejected=true;
  }
  return {valid,wallElapsedMs,visibilityPausedMs,activeElapsedMs:wallElapsedMs-visibilityPausedMs,
    visibilityPauseAccountedAt:capture && valid?now:storedAccountedAt,visibilityPauseReceiptRejected};
}

export function resumeAutomaticLocalCaptureV61529(prior,config,checkpointSession,now) {
  if(!config || typeof config!=='object' || Array.isArray(config) || config.resumeExisting!==true ||
    config.freshRun===true || config.savedCapture!==undefined || config.localResumeCapture!==undefined)
    throw Error('Browser resume requires an explicit checkpoint command without a fresh run or imported capture.');
  if(!prior || typeof prior!=='object' || Array.isArray(prior) ||
    typeof prior.courseId!=='string' || !/^[A-Za-z0-9_-]{1,160}$/.test(prior.courseId) ||
    prior.courseId!==config.courseId || typeof prior.token!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(prior.token) ||
    typeof config.token!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(config.token) || config.token===prior.token ||
    !['FRESH_FULL_COURSE','RESUME_AVAILABLE_WORK'].includes(prior.captureMode))
    throw Error('Saved run identity does not match this course or a new valid run token.');
  if(!(prior.state==='RUNNING' && !prior.reason ||
    prior.state==='FINISHED' && prior.reason==='LOCAL_SUPERVISOR_LINK_UNAVAILABLE'))
    throw Error('Saved run has already ended for a reason that requires review before resuming.');
  const timing=automaticLocalRunTimingV61530(prior,null,now);
  if(!timing.valid || timing.activeElapsedMs>=8*60*60*1000 ||
    !Number.isInteger(prior.batches) || prior.batches<0 || prior.batches>=500 ||
    !Number.isInteger(prior.stalled) || prior.stalled<0 || prior.stalled>=3 ||
    prior.supervisorRecoveries!==undefined && (!Number.isInteger(prior.supervisorRecoveries) ||
      prior.supervisorRecoveries<0 || prior.supervisorRecoveries>=30))
    throw Error('Saved run reached its elapsed, batch or no-progress limit. Export saved progress.');
  const owner=prior.checkpointOwnerToken===undefined?prior.token:prior.checkpointOwnerToken;
  if(typeof owner!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(owner))
    throw Error('Saved checkpoint owner is invalid. Export saved progress.');
  const storedId=checkpointSession && typeof checkpointSession==='object' && !Array.isArray(checkpointSession)?checkpointSession.id:'';
  const namespace=prior.checkpointRunId==null || prior.checkpointRunId===''?storedId:prior.checkpointRunId;
  if(typeof namespace!=='string' || !/^(?:run-\d{1,17}-[a-z0-9]{1,32}|fresh-[A-Za-z0-9_-]{8,100})$/.test(namespace) || storedId!==namespace)
    throw Error('No matching active browser checkpoint namespace was found for this course.');
  if(prior.captureMode==='FRESH_FULL_COURSE' &&
    (prior.checkpointRunId!==namespace || namespace!=='fresh-'+owner))
    throw Error('Saved checkpoint namespace does not match the original fresh run.');
  return Object.assign({},prior,{state:'RUNNING',token:config.token,reason:'',updatedAt:now,
    checkpointRunId:namespace,checkpointOwnerToken:owner,resumedFromToken:prior.token,resumedAt:now,
    visibilityPausedMs:timing.visibilityPausedMs,wallElapsedMs:timing.wallElapsedMs,activeElapsedMs:timing.activeElapsedMs,
    visibilityPauseAccountedAt:timing.visibilityPauseAccountedAt,
    message:'Resuming the saved run with its original browser checkpoints and limits.'});
}

export function automaticLocalCaptureNeedsContinuationV61519(capture,contractFor) {
  const meta=capture.meta || {},accounting=meta.captureAccounting || {};
  const crawl=meta.activeSpaCrawl || {};
  return Boolean(crawl.timeBudgetExhausted || Number(accounting.unvisitedCount || 0)>0 ||
    Number(accounting.retryableUnresolvedCount || 0)>0 ||
    (capture.fingerprints || []).some(fp=>{
      const contract=typeof contractFor==='function'?contractFor(fp):fp.captureContract || fp.payload && fp.payload.captureContract;
      return contract && (contract.needsEditor===true || contract.retryable===true);
    }));
}

export function automaticLocalEvidenceProgressV61526(plan,capture,progressFor) {
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
    const checkpointProgress=typeof progressFor==='function'?progressFor(fp):null;
    const observed=Array.isArray(checkpointProgress) && checkpointProgress.length===7
      ? checkpointProgress.map(value=>Math.max(0,Math.min(20000,Number(value)||0)))
      : [questions.size,[...questions.values()].filter(Boolean).length,textCharacters,assets.size,hashes.size,complete,terminal];
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

export function accumulateAutomaticLocalPerformanceV61531(plan,capture) {
  const prior=plan.performance?.version===1?plan.performance:{};
  const dayMs=24*60*60*1000;
  const limits={wallMs:31*dayMs,activeMs:31*dayMs,pausedMs:31*dayMs,setupMs:31*dayMs,
    primaryMs:31*dayMs,primaryActiveMs:31*dayMs,primaryPausedMs:31*dayMs,
    recoveryMs:31*dayMs,recoveryActiveMs:31*dayMs,recoveryPausedMs:31*dayMs,
    postCrawlMs:31*dayMs,assetAndNormalizationMs:31*dayMs,finalizationMs:31*dayMs,
    checkpointStored:20000,checkpointRestored:20000,checkpointDeferred:20000,checkpointSkipped:20000,
    checkpointRestoredBytes:1024*1024*1024,apiRequests:20000,apiElapsedMs:31*dayMs};
  function bounded(value,max){return typeof value==='number' && Number.isFinite(value) && value>=0?Math.min(max,Math.floor(value)):0;}
  function metrics(value,scale){
    const out={};for(const [key,max] of Object.entries(limits))out[key]=bounded(value?.[key],max*scale);return out;
  }
  function safeReason(value,kind){
    if(!value)return '';
    const allowed=kind==='yield'?['LOCAL_CHECKPOINT_UNAVAILABLE','LOCAL_RENDERER_VISIT_LIMIT','LOCAL_RENDERER_TIME_LIMIT',
      'LOCAL_RENDERER_HEAP_LIMIT','LOCAL_RENDERER_HEAP_GROWTH_LIMIT','LOCAL_RENDERER_QUESTION_LIMIT',
      'LOCAL_RENDERER_QUESTION_TIME_LIMIT','LOCAL_ASSESSMENT_CHECKPOINT_YIELD','CHUNK_CRAWL_BUDGET_EXHAUSTED',
      'NEXT_ITEM_REQUIRES_FULL_ATTEMPT_BUDGET','OTHER']:
      ['EDITOR_NOT_CERTIFIED','SESSION_EDITOR_IDENTITY_NOT_VERIFIED','EDITOR_OUTLINE_UNAVAILABLE',
      'UNSUPPORTED_DECLARED_PART_COUNT','AMBIGUOUS_OUTLINE_IDENTITY','INCOMPLETE_LIVE_OUTLINE_INVENTORY',
      'SAME_ASSIGNMENT_READ_ENDPOINTS_NOT_OBSERVED','EDITOR_IDENTITY_CHANGED_DURING_API_DISCOVERY',
      'EDITOR_IDENTITY_CHANGED_DURING_API_CAPTURE','AUTHORING_API_AUTHENTICATION_FAILED','AUTHORING_API_RATE_LIMITED',
      'ITEM_API_DEADLINE','ITEM_API_BYTE_LIMIT','API_RESPONSE_BYTE_LIMIT','API_REQUEST_TIMEOUT','API_REQUEST_FAILED',
      'AUTHORING_API_EVIDENCE_INCOMPLETE','INVALID_API_ENVELOPE','AMBIGUOUS_API_RESPONSE_IDENTITY',
      'UNEXPECTED_API_REDIRECT','UNEXPECTED_API_MIME','OTHER'];
    return typeof value==='string' && allowed.includes(value)?value:'OTHER';
  }
  function histogram(value,kind,max){
    const out={};if(!value || typeof value!=='object' || Array.isArray(value))return out;
    for(const [key,count] of Object.entries(value).slice(0,40)){
      const reason=safeReason(key,kind),n=bounded(count,max);
      if(reason && n)out[reason]=Math.min(max,(out[reason] || 0)+n);
    }return out;
  }
  function receipt(value){
    return {batch:bounded(value?.batch,500),...metrics(value,1),yieldReason:safeReason(value?.yieldReason,'yield'),
      apiFallbackReasons:histogram(value?.apiFallbackReasons,'api',20000)};
  }
  const next={version:1,recordedBatches:bounded(prior.recordedBatches,500),
    lastDocumentStartedAt:bounded(prior.lastDocumentStartedAt,8640000000000000),
    totals:metrics(prior.totals,500),yieldReasons:histogram(prior.yieldReasons,'yield',500),
    apiFallbackReasons:histogram(prior.apiFallbackReasons,'api',500*20000),
    recent:Array.isArray(prior.recent)?prior.recent.slice(-20).map(receipt):[]};
  const documentStartedAt=typeof capture.extractedAt==='string'?Date.parse(capture.extractedAt):0;
  if(next.recordedBatches>=500 || Number.isFinite(documentStartedAt) && documentStartedAt>0 &&
    next.lastDocumentStartedAt>0 && documentStartedAt<=next.lastDocumentStartedAt)return next;
  const runtime=capture.meta?.runtime || {},performance=capture.meta?.performance || {};
  const checkpoint=capture.meta?.checkpointResume || {},api=performance.api || {};
  const primaryMs=bounded(runtime.primaryMs,limits.primaryMs),recoveryMs=bounded(runtime.recoveryMs,limits.recoveryMs);
  function pause(value,wall){return Number.isSafeInteger(value) && value>=0 && value<=wall?value:0;}
  const primaryPausedMs=pause(performance.primaryVisibilityPausedMs,primaryMs);
  const recoveryPausedMs=pause(performance.recoveryVisibilityPausedMs,recoveryMs);
  const wallMs=bounded(runtime.totalBeforeDownloadMs,limits.wallMs);
  const pausedMs=performance.primaryVisibilityPausedMs!==undefined || performance.recoveryVisibilityPausedMs!==undefined?
    Math.min(wallMs,primaryPausedMs+recoveryPausedMs):pause(capture.meta?.activeSpaCrawl?.visibilityPausedMs,wallMs);
  const fallback={};
  for(const value of (Array.isArray(api.fallbackReasons)?api.fallbackReasons:[]).slice(0,20000)){
    const reason=safeReason(value,'api');if(reason)fallback[reason]=(fallback[reason] || 0)+1;
  }
  const current=receipt({batch:bounded(plan.batches,499)+1,wallMs,activeMs:wallMs-pausedMs,pausedMs,
    setupMs:runtime.setupMs,primaryMs,primaryActiveMs:primaryMs-primaryPausedMs,primaryPausedMs,
    recoveryMs,recoveryActiveMs:recoveryMs-recoveryPausedMs,recoveryPausedMs,
    postCrawlMs:runtime.postCrawlCaptureMs,assetAndNormalizationMs:runtime.assetAndNormalizationMs,finalizationMs:runtime.finalizationMs,
    checkpointStored:checkpoint.stored,checkpointRestored:checkpoint.restored,checkpointDeferred:checkpoint.deferred,
    checkpointSkipped:checkpoint.skipped,checkpointRestoredBytes:checkpoint.restoredBytes,
    apiRequests:api.requests,apiElapsedMs:api.elapsedMs,yieldReason:capture.meta?.localCaptureBatch?.yieldReason,
    apiFallbackReasons:fallback});
  for(const [key,max] of Object.entries(limits))next.totals[key]=Math.min(max*500,next.totals[key]+current[key]);
  if(current.yieldReason)next.yieldReasons[current.yieldReason]=Math.min(500,(next.yieldReasons[current.yieldReason] || 0)+1);
  for(const [reason,count] of Object.entries(current.apiFallbackReasons))
    next.apiFallbackReasons[reason]=Math.min(500*20000,(next.apiFallbackReasons[reason] || 0)+count);
  next.recordedBatches++;next.recent=[...next.recent,current].slice(-20);
  if(Number.isFinite(documentStartedAt) && documentStartedAt>0)next.lastDocumentStartedAt=documentStartedAt;
  return next;
}

export function advanceAutomaticLocalCaptureV61517(plan, capture, checkpointAvailable, checkpointFailed, retainCheckpoint, now,progressFor) {
  const accounting=capture.meta && capture.meta.captureAccounting || {};
  const fingerprints=Array.isArray(capture.fingerprints)?capture.fingerprints:[];
  const progress=automaticLocalEvidenceProgressV61526(plan,capture,progressFor);
  const timing=automaticLocalRunTimingV61530(plan,capture,now);
  const next=Object.assign({},plan,{batches:Number(plan.batches || 0)+1,lastProgress:progress.signature,evidenceProgress:progress.record,
    stalled:progress.advanced?0:Number(plan.stalled || 0)+1,updatedAt:now,
    visibilityPausedMs:timing.visibilityPausedMs,wallElapsedMs:timing.wallElapsedMs,activeElapsedMs:timing.activeElapsedMs,
    visibilityPauseAccountedAt:timing.visibilityPauseAccountedAt,visibilityPauseReceiptRejected:timing.visibilityPauseReceiptRejected,
    performance:accumulateAutomaticLocalPerformanceV61531(plan,capture)});
  let reason='';
  if(capture.meta?.activeSpaCrawl?.authoringApiAccessStopped)reason='AUTHORING_API_ACCESS_REQUIRED';
  else if(capture.meta?.activeSpaCrawl?.authoringApiRateLimited)reason='AUTHORING_API_RATE_LIMITED';
  else if(fingerprints.length===0)reason='COURSE_INVENTORY_EMPTY';
  else if(!retainCheckpoint && !automaticLocalCaptureNeedsContinuationV61519(capture))reason='INVENTORY_FINISHED';
  else if(!checkpointAvailable || checkpointFailed)reason='LOCAL_CHECKPOINT_UNAVAILABLE';
  else if(next.stalled>=3)reason='LOCAL_CAPTURE_NO_PROGRESS';
  else if(next.batches>=500 || !timing.valid || timing.activeElapsedMs>=8*60*60*1000)reason='LOCAL_CAPTURE_RUN_LIMIT';
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
