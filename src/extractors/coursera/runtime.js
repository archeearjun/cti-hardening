import { CTI_LOCAL_BATCH_MAX_VISITS, CTI_LOCAL_BATCH_MAX_MS, CTI_LOCAL_ASSESSMENT_MAX_QUESTIONS, CTI_LOCAL_ASSESSMENT_MAX_MS, CTI_LOCAL_HEAP_YIELD_BYTES, CTI_LOCAL_HEAP_GROWTH_BYTES, CTI_LOCAL_MANAGED_BATCH_MAX_VISITS_V61532, CTI_LOCAL_MANAGED_RECOVERY_MAX_VISITS_V61532, CTI_LOCAL_MANAGED_HEAVY_PARTS_V61532, CTI_LOCAL_MANAGED_HEAVY_ITEM_BYTES_V61532, CTI_LOCAL_MANAGED_EVIDENCE_BYTES_V61532 } from "./config.js";

export function validateSavedCaptureResumeV61515(capture, expectedCourseId) {
  if(!capture || capture.schemaVersion!==35 || capture.notForCourseAudit===true || capture.kind ||
      !capture.page || String(capture.page.courseId || '')!==String(expectedCourseId || '') || !expectedCourseId ||
      !Number.isFinite(Date.parse(capture.extractedAt || capture.capturedAt || '')) ||
      !Array.isArray(capture.fingerprints) || !capture.fingerprints.length || capture.fingerprints.length>20000) {
    throw new Error('Resume requires an original schema 35 capture for this Coursera course.');
  }
  const ids=new Set();
  for(const fp of capture.fingerprints) {
    if(!fp || typeof fp.id!=='string' || !fp.id || ids.has(fp.id) ||
        !fp.payload || typeof fp.payload!=='object' || Array.isArray(fp.payload)) {
      throw new Error('The saved capture contains invalid or duplicate item identities.');
    }
    ids.add(fp.id);
  }
  return capture;
}

export function createLocalCaptureSessionV61514(options = {}) {
  // A second invocation in the same document cannot reset renderer pressure.
  // Only a real reload creates a new session; durable item checkpoints survive it.
  const key="__CTI_LOCAL_CAPTURE_RENDERER_SESSION__";
  const state=window[key] || (window[key]={visits:0,startedAt:0,yieldReason:"",checkpointFailed:false});
  state.managed=state.managed===true || options.managed===true;
  const visitLimit=state.managed
    ? (Number(options.recoveryCount || 0)>0?CTI_LOCAL_MANAGED_RECOVERY_MAX_VISITS_V61532:CTI_LOCAL_MANAGED_BATCH_MAX_VISITS_V61532)
    : CTI_LOCAL_BATCH_MAX_VISITS;
  state.maxVisits=Math.min(Number.isSafeInteger(state.maxVisits) && state.maxVisits>0?state.maxVisits:visitLimit,visitLimit);
  if(!Array.isArray(state.durableItems))state.durableItems=[];
  if(!Number.isSafeInteger(state.retainedEvidenceBytes) || state.retainedEvidenceBytes<0)state.retainedEvidenceBytes=0;
  if(!Number.isSafeInteger(state.heavyItems) || state.heavyItems<0)state.heavyItems=0;
  if(!state.questionLimit)state.questionLimit=Math.max(5,Math.min(CTI_LOCAL_ASSESSMENT_MAX_QUESTIONS,Number(options.questionLimit || CTI_LOCAL_ASSESSMENT_MAX_QUESTIONS)));
  if(!Number.isSafeInteger(state.visibilityPausedMs) || state.visibilityPausedMs<0)state.visibilityPausedMs=0;
  function wallElapsedMs() {return state.startedAt?Math.max(0,Date.now()-state.startedAt):0;}
  function activeElapsedMs(wall = wallElapsedMs()) {return Math.max(0,wall-state.visibilityPausedMs);}
  function heapBytes() {
    const bytes=Number(window.performance && window.performance.memory && window.performance.memory.usedJSHeapSize);
    return Number.isFinite(bytes) && bytes>0?bytes:0;
  }
  function pressureYieldReason(atItemBoundary = false) {
    if(state.checkpointFailed)state.yieldReason="LOCAL_CHECKPOINT_UNAVAILABLE";
    if(state.yieldReason)return state.yieldReason;
    if(atItemBoundary && state.visits>=state.maxVisits)state.yieldReason="LOCAL_RENDERER_VISIT_LIMIT";
    else if(state.startedAt && activeElapsedMs()>=CTI_LOCAL_BATCH_MAX_MS)state.yieldReason="LOCAL_RENDERER_TIME_LIMIT";
    else if(state.visits>0 && heapBytes()>=CTI_LOCAL_HEAP_YIELD_BYTES)state.yieldReason="LOCAL_RENDERER_HEAP_LIMIT";
    else if(state.visits>0 && state.baselineHeapBytes>0 && heapBytes()-state.baselineHeapBytes>=CTI_LOCAL_HEAP_GROWTH_BYTES)state.yieldReason="LOCAL_RENDERER_HEAP_GROWTH_LIMIT";
    return state.yieldReason || "";
  }
  return {
    beforeItem() {return pressureYieldReason(true);},
    pressureYieldReason,
    startItem() { if(!state.startedAt){state.startedAt=Date.now();state.baselineHeapBytes=heapBytes();}state.visits++; },
    afterItemCheckpoint(metrics, saved) {
      // A completed API quiz need not click 25 panels to reach a safe reload.
      // Yield after its raw evidence has been durably saved; this changes only
      // the document budget, never the item's capture contract or attempt count.
      if(saved!==true || state.checkpointFailed){state.checkpointFailed=true;return pressureYieldReason(true);}
      if(state.managed && metrics && typeof metrics.itemId==='string' && metrics.itemId){
        let receipt=state.durableItems.find(item=>item.id===metrics.itemId);
        if(!receipt){receipt={id:metrics.itemId,bytes:0,heavy:false};state.durableItems.push(receipt);}
        const bytes=Number.isSafeInteger(metrics.evidenceBytes) && metrics.evidenceBytes>0?metrics.evidenceBytes:0;
        state.retainedEvidenceBytes=Math.min(Number.MAX_SAFE_INTEGER,state.retainedEvidenceBytes+Math.max(0,bytes-receipt.bytes));
        receipt.bytes=Math.max(receipt.bytes,bytes);
        const heavy=Number.isSafeInteger(metrics.declaredParts) && metrics.declaredParts>=CTI_LOCAL_MANAGED_HEAVY_PARTS_V61532 ||
          bytes>=CTI_LOCAL_MANAGED_HEAVY_ITEM_BYTES_V61532;
        if(heavy){if(!receipt.heavy)state.heavyItems++;receipt.heavy=true;state.yieldReason="LOCAL_RENDERER_HEAVY_ITEM_LIMIT";}
        else if(state.retainedEvidenceBytes>=CTI_LOCAL_MANAGED_EVIDENCE_BYTES_V61532)
          state.yieldReason="LOCAL_RENDERER_EVIDENCE_LIMIT";
      }
      return pressureYieldReason(true);
    },
    recordVisibilityPause(milliseconds) {
      if(!state.startedAt || !Number.isSafeInteger(milliseconds) || milliseconds<=0)return 0;
      const endedAt=Date.now(),startedAt=endedAt-milliseconds;
      if(startedAt<state.startedAt || startedAt<Number(state.visibilityPauseEndedAt || 0) ||
        milliseconds>Math.max(0,endedAt-state.startedAt-state.visibilityPausedMs))return 0;
      state.visibilityPausedMs+=milliseconds;state.visibilityPauseEndedAt=endedAt;return milliseconds;
    },
    afterQuestionCheckpoint(newQuestions, complete) {
      state.questionObservations=Number(state.questionObservations || 0)+Math.max(0,Number(newQuestions || 0));
      if(complete)return '';
      if(state.checkpointFailed)state.yieldReason='LOCAL_CHECKPOINT_UNAVAILABLE';
      else if(state.questionObservations>=state.questionLimit)state.yieldReason='LOCAL_RENDERER_QUESTION_LIMIT';
      else if(state.startedAt && activeElapsedMs()>=CTI_LOCAL_ASSESSMENT_MAX_MS)state.yieldReason='LOCAL_RENDERER_QUESTION_TIME_LIMIT';
      else if(heapBytes()>=CTI_LOCAL_HEAP_YIELD_BYTES)state.yieldReason='LOCAL_RENDERER_HEAP_LIMIT';
      else if(state.baselineHeapBytes>0 && heapBytes()-state.baselineHeapBytes>=CTI_LOCAL_HEAP_GROWTH_BYTES)state.yieldReason='LOCAL_RENDERER_HEAP_GROWTH_LIMIT';
      return state.yieldReason || '';
    },
    checkpointWritten(saved) { if(saved!==true)state.checkpointFailed=true; },
    snapshot() {
      const wall=wallElapsedMs(),active=activeElapsedMs(wall);
      return {visits:state.visits,elapsedMs:active,activeElapsedMs:active,wallElapsedMs:wall,visibilityPausedMs:Math.min(wall,state.visibilityPausedMs),
        questionObservations:Number(state.questionObservations || 0),maxQuestionObservations:state.questionLimit,
        maxVisits:state.maxVisits,maxMs:CTI_LOCAL_BATCH_MAX_MS,
        managed:state.managed,durableItems:state.durableItems.length,heavyItems:state.heavyItems,
        retainedEvidenceBytes:state.retainedEvidenceBytes,
        heavyItemParts:CTI_LOCAL_MANAGED_HEAVY_PARTS_V61532,
        heavyItemBytes:CTI_LOCAL_MANAGED_HEAVY_ITEM_BYTES_V61532,
        evidenceYieldBytes:CTI_LOCAL_MANAGED_EVIDENCE_BYTES_V61532,
        observedHeapBytes:heapBytes(),heapYieldBytes:CTI_LOCAL_HEAP_YIELD_BYTES,
        baselineHeapBytes:state.baselineHeapBytes || 0,heapGrowthLimitBytes:CTI_LOCAL_HEAP_GROWTH_BYTES,
        requiresReload:Boolean(state.yieldReason),yieldReason:state.yieldReason,
        checkpointFailed:state.checkpointFailed};
    }
  };
}

export function offerCheckpointContinuationV61514(source, canReload) {
  // Keep the continuation controls outside the body and in a closed shadow,
  // so future capture attempts cannot treat their script/text as course content.
  const key="__CTI_CHECKPOINT_CONTINUATION__";
  if(window[key])window[key].remove();
  const host=document.createElement("div");
  host.setAttribute("data-cti-continuation","true");
  host.style.cssText="all:initial!important;position:fixed!important;left:18px!important;bottom:18px!important;z-index:2147483646!important;width:min(390px,calc(100vw - 36px))!important;display:block!important";
  const root=host.attachShadow({mode:"closed"});
  root.innerHTML=`<style>*{box-sizing:border-box}[hidden]{display:none!important}section{font:14px/1.45 system-ui,sans-serif;background:#fff;color:#172b4d;border:1px solid #cbd5e1;border-radius:12px;padding:16px;box-shadow:0 8px 36px #0f172a26}h2{font-size:16px;margin:0}p{margin:10px 0}button{font:inherit;background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:8px;margin:4px 4px 0 0;cursor:pointer}textarea{width:100%;height:100px}button:focus-visible{outline:2px solid #2563eb}</style><section role="region" aria-label="Continue Coursera capture"><h2>Batch saved · more evidence remains</h2><p id="note"></p><button id="copy" type="button">Copy continuation script</button><button id="reload" type="button">Reload Coursera</button><p id="status" role="status" aria-live="polite"></p><textarea id="manual" aria-label="Continuation script" readonly hidden></textarea></section>`;
  root.getElementById("note").textContent=canReload
    ? "Save the batch JSON, copy the continuation script, reload Coursera, then paste it in Console. Saved item checkpoints will be restored. Repeat until the final capture is ready."
    : "Browser checkpoints could not be saved. Download this JSON before reloading. Automatic continuation is unavailable; check browser storage access before starting another run.";
  root.getElementById("reload").hidden=!canReload;
  root.getElementById("copy").hidden=!canReload;
  root.getElementById("copy").onclick=async()=>{
    try {await navigator.clipboard.writeText(source);root.getElementById("status").textContent="Copied. Reload Coursera, then paste in Console to continue.";}
    catch(_) {
      const field=root.getElementById("manual");field.value=source;field.hidden=false;field.focus();field.select();
      root.getElementById("status").textContent="Copy the selected continuation script, reload Coursera, then paste in Console.";
    }
  };
  root.getElementById("reload").onclick=()=>location.reload();
  root.addEventListener("click",event=>event.stopPropagation());
  document.documentElement.appendChild(host);window[key]=host;
}
