import { genericAssessmentTextHeuristicNotApplicableV6146 } from "./assessments-5.js";
import { captureContractSummaryV6150, captureContractV6150 } from "./completion.js";
import { CTI_MAX_ITEM_ATTEMPTS } from "./config.js";
import { diagnosticNavigated } from "./navigation-2.js";
import { diagnosticQualityScore } from "./text-and-dom-5.js";

export function retryDecisionV61318(d,p,reasons) {
    const result={retryReasons:[...reasons],deferredReasons:[],status:'',action:''};
    if(!d || !d.editorSurfaceCaptured)return result;
    p=p || {};
    // Use this visit's receipt. A merged payload can contain a later retry receipt.
    const empty=d.emptyEditorEvidence || p.emptyEditorEvidence;
    const model=p.structuredAssessment || {};
    const route=empty && String(empty.route || '').match(/^https:\/\/(?:www\.)?coursera\.org\/teach\/[^/]+\/([^/]+)\/content\/item\/[^/]+\/([^/?#]+)\/?$/i);
    const observedAt=empty?Date.parse(empty.observedAt):NaN;
    let stableEmpty=!!(empty && route && empty.status==='OBSERVED_EMPTY_EDITOR' &&
      empty.itemId===String(d.id) && route[2]===String(d.id) &&
      empty.scope==='EXACT_ITEM_ASSIGNMENT_LAYOUT' && empty.sourceCompleteness==='NOT_DETERMINED' &&
      empty.marker==='Content you add will show in order here.' &&
      Number.isFinite(observedAt) && Number.isSafeInteger(empty.samples) && empty.samples>=2 &&
      Number.isFinite(empty.intervalMs) && empty.intervalMs>=1200 &&
      !(model.questions || []).length && !Number(model.questionCount || 0) && !Number(model.declaredQuestionCount || 0) &&
      !Number(d.questionCycleDeclared || 0) && !Number(d.questionCycleQuestions || 0) &&
      !Number(d.questionCycleReactStateQuestions || 0));
    if(d.stabilityTimedOut) {
      // Only a later exact-layout observation from the SAME visit supersedes
      // the generic stability timeout. Keep the original timeout diagnostic.
      const layout=d.assessmentSurface && d.assessmentSurface.layoutDiagnostic;
      const started=Date.parse(d.startedAt);
      const timing=[started,d.navigationMs,d.stabilityPhaseMs,d.elapsedMs];
      stableEmpty=stableEmpty && empty===d.emptyEditorEvidence &&
        d.questionCycleStopReason==='STABLE_EMPTY_EDITOR' && layout && layout.exactRoute===true &&
        layout.route===empty.route && timing.every(n=>Number.isFinite(n) && n>=0) &&
        observedAt>=started+d.navigationMs+d.stabilityPhaseMs+empty.intervalMs &&
        observedAt<=started+d.elapsedMs;
      if(!stableEmpty)return result;
    }
    const truncated=p.textCaptureTruncated===true && p.textCaptureEvidence && p.textCaptureEvidence.method==='EXACT_READING_FIELD';
    if(stableEmpty || truncated) {
      const defer=new Set(stableEmpty?['timeout','incomplete-text','generic-fallback-only','no-upgrade']:['incomplete-text']);
      result.deferredReasons=result.retryReasons.filter(x=>defer.has(x));
      result.retryReasons=result.retryReasons.filter(x=>!defer.has(x));
      result.status=stableEmpty?'OBSERVED_EMPTY_EDITOR_REQUIRES_SOURCE_REVIEW':'TEXT_CAPTURE_LIMIT_REQUIRES_TARGETED_RECOVERY';
      result.action=stableEmpty?'Compare this observed empty editor with the source. No questions were inferred.':'Retain the captured portion and explicit limit; another identical pass cannot recover its omitted text.';
    }
    return result;
  }

export function retryReasonsForDiagnostic(d) {
    const reasons = [];
    if (!d || !d.found) reasons.push("not-found");
    if (d && d.found && !d.editorSurfaceCaptured) reasons.push("no-surface");
    if (d && d.stabilityTimedOut) reasons.push("timeout");
    if (d && Number(d.textCompleteness || 0) > 0 && Number(d.textCompleteness || 0) < 0.75 &&
        Number(d.sessionPayloadFiles || 0) === 0 && Number(d.launchUrlsFound || 0) === 0) {
      if (!genericAssessmentTextHeuristicNotApplicableV6146(d)) reasons.push("incomplete-text");
    }
    if (d && Number(d.questionCycleDeclared || 0) > 1 && Number(d.questionCycleQuestions || 0) < Number(d.questionCycleDeclared || 0)) {
      reasons.push("incomplete-question-cycle");
    }
    if (d && d.questionCycleCaptureCompleteness && d.questionCycleCaptureCompleteness.questionCoverageComplete && !d.questionCycleCaptureCompleteness.answerCoverageComplete && d.questionCycleCaptureCompleteness.requiredAnswerCoverageComplete!==true) reasons.push("incomplete-answer-evidence");
    if (d && d.genericBaseName && d.editorSurfaceCaptured &&
        String(d.textScopeKind || "") === "field-aggregate" &&
        Number(d.editorSurfaceScore || 0) < 0.98 &&
        Number(d.sessionPayloadFiles || 0) === 0 &&
        Number(d.sessionPayloadLinks || 0) === 0 &&
        Number(d.launchUrlsFound || 0) === 0) {
      reasons.push("generic-fallback-only");
    }
    if (d && !d.upgraded) reasons.push("no-upgrade");
    return reasons;
  }

export function retrySeverity(reasons) {
    const r = new Set(reasons || []);
    if (r.has("not-found")) return 100;
    if (r.has("no-surface")) return 90;
    if (r.has("no-upgrade")) return 80;
    if (r.has("incomplete-question-cycle") || r.has("incomplete-answer-evidence")) return 78;
    if (r.has("generic-fallback-only")) return 75;
    if (r.has("timeout")) return 70;
    if (r.has("incomplete-text")) return 60;
    return 0;
  }

export function buildRetryPlan(primaryMeta, fingerprints) {
  const contractFn=typeof captureContractV6150==='function'?captureContractV6150:(fp)=>({
    complete:false,retryable:true,attempts:Number(fp && fp.payload && fp.payload.captureAttempts || 0),reasons:[]
  });
  const contractSummaryFn=typeof captureContractSummaryV6150==='function'?captureContractSummaryV6150:(fp)=>({
    itemId:String(fp && fp.id || ''),status:'LEGACY_TEST_FALLBACK',complete:false,retryable:true,
    attempts:Number(fp && fp.payload && fp.payload.captureAttempts || 0),reasons:[]
  });
  const maxAttempts=typeof CTI_MAX_ITEM_ATTEMPTS==='number'?CTI_MAX_ITEM_ATTEMPTS:2;
  const byId=new Map((fingerprints || []).map(fp=>[String(fp.id || ''),fp]));
  const diagById=new Map((primaryMeta && primaryMeta.targetDiagnostics || []).map(d=>[String(d.id || ''),d]));
  const queueIds=[...new Set(primaryMeta && primaryMeta.targetIds || [])];
  primaryMeta.retryDeferredEvidence=[];
  primaryMeta.assessmentTextHeuristicSkipped=(primaryMeta.targetDiagnostics || []).filter(d=>
    Number(d.textCompleteness)>0 && Number(d.textCompleteness)<0.75 &&
    genericAssessmentTextHeuristicNotApplicableV6146(d)).map(d=>({id:String(d.id),reason:'GENERIC_TEXT_HEURISTIC_NOT_APPLICABLE',evidence:d.assessmentTextReceipt}));
  const candidates=[];
  for(const id of queueIds){
    const fp=byId.get(id);if(!fp)continue;
    const contract=contractFn(fp);
    if(contract.complete || !contract.retryable || contract.attempts>=maxAttempts)continue;
    const d=diagById.get(id);
    let reasons=d?retryReasonsForDiagnostic(d):['not-attempted'];
    const decision=d?retryDecisionV61318(d,fp.payload || {},reasons):{retryReasons:reasons,deferredReasons:[],status:'',action:''};
    reasons=decision.retryReasons || [];
    if(decision.deferredReasons && decision.deferredReasons.length)primaryMeta.retryDeferredEvidence.push({id,
      reasons:decision.deferredReasons,status:decision.status,action:decision.action});
    for(const reason of contract.reasons || [])if(!reasons.includes(reason))reasons.push(reason);
    if(!reasons.length)reasons.push('CAPTURE_CONTRACT_INCOMPLETE');
    candidates.push({id,name:String(fp.name || ''),reasons,severity:d?Math.max(65,retrySeverity(reasons)):110,contract:contractSummaryFn(fp)});
  }
  candidates.sort((a,b)=>b.severity-a.severity);
  primaryMeta.retryCandidateIds=candidates.map(x=>x.id);
  primaryMeta.retryCandidatesNotScheduled=0;
  return candidates;
}
export function attachRetryResults(primaryMeta, retryMeta, plan, fingerprints) {
  const contractFn=typeof captureContractV6150==='function'?captureContractV6150:null;
  primaryMeta.retryTargets = (plan || []).length;
  primaryMeta.retryDeferredCount=(primaryMeta.retryDeferredEvidence || []).length;
  primaryMeta.retryAttempts = retryMeta ? (retryMeta.targetDiagnostics || []).length : 0;
  primaryMeta.retryImproved = 0;
  primaryMeta.retryResolved = 0;
  primaryMeta.retryRemainingWeak = 0;
  primaryMeta.retryDiagnostics = [];

  const primaryById = new Map((primaryMeta.targetDiagnostics || []).map(d => [String(d.id || ""), d]));
  const retryById = new Map((retryMeta && retryMeta.targetDiagnostics || []).map(d => [String(d.id || ""), d]));
  const planById = new Map((plan || []).map(p => [String(p.id || ""), p]));
  const fingerprintById = new Map((fingerprints || []).map(fp => [String(fp.id || ""), fp]));

  for (const p of plan || []) {
    const before = primaryById.get(String(p.id || ""));
    const after = retryById.get(String(p.id || ""));
    const beforeQuality = diagnosticQualityScore(before);
    const afterQuality = diagnosticQualityScore(after);
    const fp=fingerprintById.get(String(p.id || ""));
    const contract=fp&&contractFn?contractFn(fp):null;
    const afterReasons = contract && contract.complete ? [] : [...new Set([...(after?retryReasonsForDiagnostic(after):["retry-not-attempted"]),...((contract && contract.reasons) || [])])];
    const improved = Boolean(after && afterQuality > beforeQuality);
    const resolved = contract ? Boolean(contract.complete) : Boolean(after && retryReasonsForDiagnostic(after).length===0);
    if (improved) primaryMeta.retryImproved++;
    if (resolved) primaryMeta.retryResolved++;
    if (!resolved) primaryMeta.retryRemainingWeak++;

    if (before) {
      before.retryAttempted = Boolean(after);
      before.retryReason = (planById.get(String(p.id || "")) || {}).reasons || [];
      before.retryImproved = improved;
      before.retryResolved = resolved;
      before.retryResult = after ? {
        found:Boolean(after.found),
        navigated:diagnosticNavigated(after),
        surface:Boolean(after.editorSurfaceCaptured),
        upgraded:Boolean(after.upgraded),
        textCompleteness:Number(after.textCompleteness || 0),
        stabilityTimedOut:Boolean(after.stabilityTimedOut),
        stabilityMs:Number(after.stabilityMs || 0),
        sessionPayloadFiles:Number(after.sessionPayloadFiles || 0),
        sessionPayloadLinks:Number(after.sessionPayloadLinks || 0),
        launchUrlsFound:Number(after.launchUrlsFound || 0)
      } : null;
    }

    primaryMeta.retryDiagnostics.push({
      id:String(p.id || ""),
      name:String(p.name || ""),
      reasons:p.reasons,
      beforeQuality,
      afterQuality,
      improved,
      resolved,
      remainingReasons:afterReasons,
      result: after ? {
        found:Boolean(after.found),
        navigated:diagnosticNavigated(after),
        surface:Boolean(after.editorSurfaceCaptured),
        upgraded:Boolean(after.upgraded),
        textCompleteness:Number(after.textCompleteness || 0),
        stabilityTimedOut:Boolean(after.stabilityTimedOut),
        stabilityMs:Number(after.stabilityMs || 0),
        sessionPayloadFiles:Number(after.sessionPayloadFiles || 0),
        sessionPayloadLinks:Number(after.sessionPayloadLinks || 0),
        launchUrlsFound:Number(after.launchUrlsFound || 0)
      } : null
    });
  }

  let effectiveDiscovered = 0, effectiveNavigated = 0, effectiveUpgraded = 0;
  const effectiveIds = new Set([...primaryById.keys(), ...retryById.keys()]);
  for (const targetId of effectiveIds) {
    const d = primaryById.get(targetId) || {};
    const rd = retryById.get(targetId);
    if (d.found || (rd && rd.found)) effectiveDiscovered++;
    if (diagnosticNavigated(d) || diagnosticNavigated(rd)) effectiveNavigated++;
    if (d.upgraded || (rd && rd.upgraded)) effectiveUpgraded++;
  }
  primaryMeta.effectiveDiscoveredTargets = effectiveDiscovered;
  primaryMeta.effectiveNavigated = effectiveNavigated;
  primaryMeta.effectiveEvidenceUpgrades = effectiveUpgraded;
  if (Array.isArray(primaryMeta.targetIds)) {
    primaryMeta.primaryCompletedTargets = Number(primaryMeta.completedTargets || 0);
    primaryMeta.primaryUnvisitedDueToBudget = Number(primaryMeta.unvisitedDueToBudget || 0);
    const queueIds = [...new Set(primaryMeta.targetIds)];
    primaryMeta.recoveryFirstVisits = queueIds.filter(id => !primaryById.has(id) && retryById.has(id)).length;
    primaryMeta.unvisitedTargetIds = queueIds.filter(id => !effectiveIds.has(id));
    primaryMeta.unvisitedDueToBudget = primaryMeta.unvisitedTargetIds.length;
    primaryMeta.completedTargets = queueIds.filter(id => (primaryById.get(id) || {}).completed || (retryById.get(id) || {}).completed).length;
    primaryMeta.allTargetsAttempted = primaryMeta.unvisitedTargetIds.length===0 && primaryMeta.coverageLimitedByCap!==true;
    primaryMeta.unreachedEditorIds = queueIds.filter(id => {
      const d=primaryById.get(id), r=retryById.get(id);
      return !(d&&(d.domCaptured||d.editorSurfaceCaptured)) && !(r&&(r.domCaptured||r.editorSurfaceCaptured));
    });
    primaryMeta.visitedEditorCount = queueIds.length-primaryMeta.unreachedEditorIds.length;
    primaryMeta.allEditorsVisited = primaryMeta.unreachedEditorIds.length===0 && primaryMeta.coverageLimitedByCap!==true;
    primaryMeta.coverageMeaning = 'allTargetsAttempted means searched for; allEditorsVisited requires an observed item editor. Neither verifies all payload.';
  }
  primaryMeta.retryPassStats = retryMeta ? {
    targets:Number(retryMeta.targets || 0),
    discoveredTargets:Number(retryMeta.discoveredTargets || 0),
    navigated:Number(retryMeta.navigated || 0),
    evidenceUpgrades:Number(retryMeta.evidenceUpgrades || 0),
    stabilityTimeouts:Number(retryMeta.stabilityTimeouts || 0),
    sessionAssociatedResponses:Number(retryMeta.sessionAssociatedResponses || 0),
    sessionPayloadFiles:Number(retryMeta.sessionPayloadFiles || 0),
    sessionPayloadLinks:Number(retryMeta.sessionPayloadLinks || 0)
  } : null;

  primaryMeta.unresolvedRetryIds=(primaryMeta.retryCandidateIds || []).filter(id=>{
    const fp=fingerprintById.get(id);
    if(fp && contractFn)return contractFn(fp).complete!==true;
    const d=retryById.get(id);return !d || retryReasonsForDiagnostic(d).length>0;
  });
  primaryMeta.unresolvedEvidenceCount=new Set([...(primaryMeta.unresolvedRetryIds || []),
    ...(primaryMeta.retryDeferredEvidence || []).map(x=>x.id)]).size;
  primaryMeta.runHealthMeaning='Editor traversal and unresolved retry/review evidence only; not a course-content or publication verdict.';
  const fullTraversal = Number(primaryMeta.effectiveDiscoveredTargets || 0) === Number(primaryMeta.targets || 0) &&
    Number(primaryMeta.effectiveNavigated || 0) === Number(primaryMeta.targets || 0) &&
    Number(primaryMeta.routeFailures || 0) === 0 &&
    primaryMeta.allTargetsAttempted === true && primaryMeta.coverageLimitedByCap !== true;
  primaryMeta.deepCoverageCompleteness = Number(primaryMeta.eligibleTargets || 0) ?
    Number((Math.min(Number(primaryMeta.effectiveNavigated || 0), Number(primaryMeta.eligibleTargets || 0)) / Number(primaryMeta.eligibleTargets || 1)).toFixed(3)) : 1;
  primaryMeta.runHealthGrade = fullTraversal && Number(primaryMeta.retryRemainingWeak || 0) === 0 && Number(primaryMeta.retryDeferredCount || 0) === 0 && Number(primaryMeta.unresolvedEvidenceCount || 0) === 0 ? "A" :
    (fullTraversal ? "B" : (Number(primaryMeta.deepCoverageCompleteness || 0) >= 0.90 ? "B" : (Number(primaryMeta.deepCoverageCompleteness || 0) >= 0.70 ? "C" : "D")));
  return primaryMeta;
}
