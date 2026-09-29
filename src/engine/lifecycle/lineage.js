// Maintained source: explicit dependencies; no ordered concatenation.
import { qaCleanName_ } from "../matching/text.js";
import { qaIsProvenHardPayloadLoss_ } from "../readiness/destination.js";
import { qaIsExactRawEvidenceReplay_, qaPhysicalDestinationIds_ } from "./generation.js";

export function qaApplySnapshotStageGuard_(snapshotContext, generationContext, courseraItems, inputIdentity) {
  snapshotContext = snapshotContext || {};
  generationContext = generationContext || {};
  courseraItems = Array.isArray(courseraItems) ? courseraItems : [];

  if (String(snapshotContext.mode || '') !== 'RAW_INGESTION') return snapshotContext;
  if (!generationContext.rawBaselineRunId || !Array.isArray(generationContext.rawBaselineItems) || !generationContext.rawBaselineItems.length) {
    return snapshotContext;
  }

  if (qaIsExactRawEvidenceReplay_(generationContext,inputIdentity)) {
    return Object.assign({},snapshotContext,{
      rawEvidenceReplay:true, canonicalRawBaselineRunId:String(generationContext.rawBaselineRunId),
      reason:'The submitted XLSX and JSON exactly match the immutable raw baseline. This is reanalysis of saved raw evidence, not a new observation of the current shell.'
    });
  }

  var reasons = [];
  if (generationContext.latestNonRawRunId) {
    reasons.push('a later-stage QA snapshot already exists in this same Smart Ingestion generation');
  }

  var currentIds = Object.create(null);
  courseraItems.forEach(function(item){
    var id = String(item && item.id || '').trim();
    if (id) currentIds[id] = true;
  });

  var missingBaselineIds = [];
  qaPhysicalDestinationIds_(generationContext.rawBaselineItems).forEach(function(id){
    if (!currentIds[id]) missingBaselineIds.push(id);
  });
  if (missingBaselineIds.length) {
    reasons.push(missingBaselineIds.length + ' destination item(s) that existed in the canonical raw baseline are absent now');
  }

  if (!reasons.length) return snapshotContext;

  var guarded = {};
  Object.keys(snapshotContext).forEach(function(k){ guarded[k] = snapshotContext[k]; });
  guarded.stageGuardApplied = true;
  guarded.originalMode = 'RAW_INGESTION';
  guarded.mode = 'OPS_CURRENT';
  guarded.label = 'Current / Ops-prepared Coursera shell';
  guarded.inferred = true;
  guarded.confidence = 1;
  guarded.publicationPolicy = 'NORMAL_FIDELITY';
  guarded.canonicalRawBaselineRunId = String(generationContext.rawBaselineRunId || '');
  guarded.stageGuardReason = reasons.join('; ');
  guarded.reason = 'CTI stage guard overrode the Raw selection because ' + guarded.stageGuardReason +
    '. With no new Smart Ingestion generation, the immutable raw baseline cannot move backward or be replaced by a later edited shell.';
  return guarded;
}

export function qaLineageItemKey_(item) {
  if (item && item.sourceId) return 'id:' + String(item.sourceId);
  return 'name:' + qaCleanName_(item && item.sourceName || '') + '|path:' + qaCleanName_(item && item.sourcePath || '');
}

export function qaApplySameGenerationManualAttribution_(itemResults, generationContext, snapshotContext) {
  itemResults = Array.isArray(itemResults) ? itemResults : [];
  generationContext = generationContext || {};
  var baseline = Array.isArray(generationContext.rawBaselineItems) ? generationContext.rawBaselineItems : [];
  var stage = String(snapshotContext && snapshotContext.mode || '');
  if (!baseline.length || stage === 'RAW_INGESTION') {
    return {applied:false, baselineRunId:String(generationContext.rawBaselineRunId||''), manualRemovalNames:[], manualRegressionNames:[], attributedCount:0};
  }
  var prior = Object.create(null);
  baseline.forEach(function(item){ prior[qaLineageItemKey_(item)] = item; });
  var manualRemovalNames=[], manualRegressionNames=[], attributed=0;

  itemResults.forEach(function(item){
    var before = prior[qaLineageItemKey_(item)];
    if (!before) return;
    var beforeVerdict = String(before.verdict || '');
    var currentVerdict = String(item.verdict || '');
    var beforeHadDestination = !!(before.courseraId || before.courseraName) ||
      ['VERIFIED','EXPECTED_TRANSFORMATION','REPACKAGED','MOVED','STATE_MUTATION','TYPE_MUTATION','PARTIAL','UNVERIFIED','RUNTIME_REVIEW'].indexOf(beforeVerdict) > -1;
    if (!beforeHadDestination || beforeVerdict === 'MISSING' || beforeVerdict === 'INGESTION_FAILURE') return;

    if (currentVerdict === 'MISSING') {
      item.verdict = 'MANUAL_REMOVAL_REVIEW';
      item.issues = (item.issues || []).filter(function(v){return v !== 'MISSING_ITEM';});
      if (item.issues.indexOf('MANUAL_REMOVAL_SINCE_RAW') === -1) item.issues.push('MANUAL_REMOVAL_SINCE_RAW');
      item.checks = item.checks || {};
      item.checks.lineageAttribution = {
        status:'MANUAL_CHANGE_AFTER_INGESTION',
        baselineRunId:String(generationContext.rawBaselineRunId || ''),
        baselineVerdict:beforeVerdict,
        baselineCourseraId:String(before.courseraId || ''),
        baselineCourseraName:String(before.courseraName || ''),
        reason:'This source item was present in the saved raw snapshot of the same Smart Ingestion generation and is absent now. With no new Smart Ingestion event, CTI attributes the disappearance to manual/current-shell change rather than ingestion.'
      };
      item.ownerAction = {
        severity:'REVIEW',
        label:'Confirm manual removal',
        action:'This item existed immediately after Smart Ingestion and disappeared during later manual cleanup in the same import attempt. Confirm that deleting it was intentional and acceptable; restore it only if the source-equivalent learner content is still required. Do not re-run Smart Ingestion solely for this finding.'
      };
      item.evidenceSources = (item.evidenceSources || []).concat(['QA Evidence Memory raw baseline']);
      manualRemovalNames.push(String(item.sourceName || 'Untitled'));
      attributed++;
      return;
    }

    var currentHard = qaIsProvenHardPayloadLoss_(item);
    var beforeHard = qaIsProvenHardPayloadLoss_(before);
    if (currentHard && !beforeHard) {
      item.issues = item.issues || [];
      if (item.issues.indexOf('MANUAL_PAYLOAD_REGRESSION_SINCE_RAW') === -1) item.issues.push('MANUAL_PAYLOAD_REGRESSION_SINCE_RAW');
      item.checks = item.checks || {};
      item.checks.lineageAttribution = {
        status:'MANUAL_CHANGE_AFTER_INGESTION',
        baselineRunId:String(generationContext.rawBaselineRunId || ''),
        baselineVerdict:beforeVerdict,
        reason:'The saved raw snapshot in this same Smart Ingestion generation did not prove this hard payload loss. The stronger negative finding appeared only after manual/current-shell changes, so CTI treats it as a manual regression until independently confirmed.'
      };
      item.ownerAction = item.ownerAction || {severity:'REVIEW',label:'Review manual payload regression',action:''};
      item.ownerAction.severity = 'REVIEW';
      item.ownerAction.label = 'Review manual payload regression';
      item.ownerAction.action = 'This negative payload finding appeared only after manual cleanup in the same import attempt. Compare the current item with the saved raw snapshot/source and repair the manual change if needed; do not re-run Smart Ingestion solely for this regression.';
      manualRegressionNames.push(String(item.sourceName || 'Untitled'));
      attributed++;
    }
  });

  return {
    applied:attributed > 0,
    baselineRunId:String(generationContext.rawBaselineRunId || ''),
    manualRemovalNames:manualRemovalNames,
    manualRegressionNames:manualRegressionNames,
    attributedCount:attributed
  };
}
