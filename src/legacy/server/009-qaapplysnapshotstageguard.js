

function qaApplySnapshotStageGuard_(snapshotContext, generationContext, courseraItems, inputIdentity) {
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

function qaLoadGenerationEvidenceContext_(targetUuid, lineageMeta) {
  var out = {
    generation:0, provenanceIntelligence:null, provenanceSourceRunId:'',
    rawBaselineRunId:'', rawBaselineItems:[], rawBaselinePolicy:'FIRST_VALID_RAW_IMMUTABLE',
    rawBaselineCandidateCount:0, latestSameGenerationRunId:'',
    latestNonRawRunId:'', latestNonRawStage:'',
    source:'NONE'
  };
  try {
    var ss = getDatabaseSheet_().getParent();
    var sheet = ss.getSheetByName(QA_RUNS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return out;
    var generation = qaRequestedGenerationFromMemory_(targetUuid,lineageMeta,sheet);
    out.generation = generation;
    var values = sheet.getDataRange().getValues();
    var rows = qaLineageRows_(values,targetUuid).filter(function(r){ return r.generation === generation; });
    if (!rows.length) return out;
    out.latestSameGenerationRunId = rows[rows.length-1].runId;

    // Scan newest to oldest for durable Smart Ingestion provenance in the same generation.
    for (var i=rows.length-1; i>=0; i--) {
      var payload = qaLoadRunPayloadById_(ss,rows[i].runId);
      var result = payload && payload.result || {};
      var intel = result.ingestionIntelligence ||
        (result.rawSnapshot && result.rawSnapshot.ingestionIntelligence) ||
        (result.currentSnapshot && result.currentSnapshot.ingestionIntelligence) || null;
      if (intel && Array.isArray(intel.claims) && intel.claims.length) {
        out.provenanceIntelligence = qaCompactIngestionIntelligence_(intel);
        out.provenanceSourceRunId = rows[i].runId;
        break;
      }
    }

    // v7.2.1: freeze the FIRST valid raw snapshot of this exact generation.
    // Later rows labelled raw are evidence refreshes at most; they must never
    // rewrite the historical post-ingestion state used for manual attribution.
    var rawRows = rows.filter(function(r){ return r.mode === 'SINGLE_C0' || r.stage === 'RAW_UNPUBLISHED'; });
    out.rawBaselineCandidateCount = rawRows.length;
    for (var j=0; j<rawRows.length; j++) {
      var rawPayload = qaLoadRunPayloadById_(ss,rawRows[j].runId);
      var rawResult = rawPayload && rawPayload.result || {};
      var items = rawResult.itemResults || (rawResult.rawSnapshot && rawResult.rawSnapshot.itemResults) || [];
      if (Array.isArray(items) && items.length) {
        out.rawBaselineRunId = rawRows[j].runId;
        out.rawBaselineItems = items;
        var rawMeta=(rawResult.stats || rawResult.rawSnapshot && rawResult.rawSnapshot.stats || {}).extractorMeta || {};
        out.rawBaselineEvidence={excelSha256:rawRows[j].c0Hash,jsonSha256:rawRows[j].c0JsonHash,
          hasReadingRecovery:!!rawMeta.supplementalReadingRecovery};
        break;
      }
    }
    var nonRawRows = rows.filter(function(r){ return r.stage && r.stage !== 'RAW_UNPUBLISHED' && r.mode !== 'SINGLE_C0'; });
    out.correctedAggregateStageRunIds=[];
    var aggregateHistoryReview=out.rawBaselineItems.some(function(item){return /^cti-aggregate:/.test(String(item.courseraId||''));});
    nonRawRows.forEach(function(row){
      if(out.latestNonRawRunId || !aggregateHistoryReview){
        out.latestNonRawRunId=String(row.runId||'');
        out.latestNonRawStage=String(row.stage||'');
        return;
      }
      var saved=qaLoadRunPayloadById_(ss,row.runId);
      var result=saved && saved.result || {};
      if(qaObsoleteAggregateStageGuard_(result,out.rawBaselineItems,!!out.latestNonRawRunId)){
        out.correctedAggregateStageRunIds.push(row.runId);
        return;
      }
      out.latestNonRawRunId=String(row.runId||'');
      out.latestNonRawStage=String(row.stage||'');
    });
    out.source = (out.provenanceSourceRunId || out.rawBaselineRunId) ? 'QA_EVIDENCE_MEMORY' : 'NONE';
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  return out;
}

function qaLineageItemKey_(item) {
  if (item && item.sourceId) return 'id:' + String(item.sourceId);
  return 'name:' + qaCleanName_(item && item.sourceName || '') + '|path:' + qaCleanName_(item && item.sourcePath || '');
}

function qaApplySameGenerationManualAttribution_(itemResults, generationContext, snapshotContext) {
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

function qaResolveLineage_(targetUuid, mode, result, inputMeta, runsSheet) {
  inputMeta = inputMeta || {};
  result = result || {};
  var requested = inputMeta.lineageRequested && typeof inputMeta.lineageRequested === 'object' ? inputMeta.lineageRequested : {};
  var requestedGeneration = qaNormalizeRequestedGeneration_(requested.generation);
  var importEvent = String(requested.importEvent || requested.event || '').trim().toUpperCase();
  var allowedEvents = ['', 'AUTO', 'SAME_IMPORT', 'REIMPORT_ONCE', 'ORIGINAL_IMPORT', 'MANUAL'];
  if (allowedEvents.indexOf(importEvent) === -1) throw new Error('Choose whether Smart Ingestion ran again, stayed on the same import attempt, or select an import attempt manually.');
  if (requestedGeneration == null && requested.generation != null && requested.generation !== '' && String(requested.generation).toLowerCase() !== 'auto') {
    throw new Error('Choose a valid import attempt in Advanced options.');
  }
  var prior = qaLineageRows_(runsSheet ? runsSheet.getDataRange().getValues() : [], targetUuid);
  var anchors = prior.filter(function(r){ return /^EXPLICIT_/.test(String(r.provenance || '')); });
  var activeGeneration = anchors.length ? Math.max.apply(null, anchors.map(function(r){ return r.generation; })) :
    (prior.length ? Math.max.apply(null, prior.map(function(r){ return r.generation; })) : 0);
  var generation = requestedGeneration;
  var provenance = requestedGeneration == null ? '' : 'EXPLICIT_OPERATOR';
  var warnings = [];

  if (generation == null && importEvent === 'REIMPORT_ONCE') {
    generation = activeGeneration + 1;
    provenance = 'EXPLICIT_REIMPORT_EVENT';
    if (!prior.length) warnings.push('No earlier CTI QA run exists for this title. Based on your confirmation, this was recorded as the first re-ingestion after the original import.');
  } else if (generation == null && importEvent === 'ORIGINAL_IMPORT') {
    generation = 0;
    provenance = 'EXPLICIT_ORIGINAL_IMPORT';
  } else if (generation == null && importEvent === 'SAME_IMPORT') {
    generation = activeGeneration;
    provenance = 'EXPLICIT_SAME_IMPORT';
  } else if (generation == null) {
    generation = activeGeneration;
    provenance = anchors.length ? 'AUTO_INHERITED_EXPLICIT_ANCHOR' : (prior.length ? 'AUTO_INHERITED_BASELINE' : 'AUTO_BASELINE');
    if (!anchors.length && generation > 0) {
      provenance = 'AUTO_INHERITED_LEGACY';
      warnings.push('Older lineage has no recorded operator confirmation. Verify whether Smart Ingestion actually ran again before relying on cross-attempt comparisons.');
    }
  }

  var sameGen = prior.filter(function(r){ return r.generation === generation; });
  var parent = sameGen.length ? sameGen[sameGen.length-1] : null;
  var previous = prior.filter(function(r){ return r.generation === generation-1 && r.mode === 'SINGLE_C0'; });
  var previousRaw = previous.length ? previous[previous.length-1] : null;
  var currentCourseId = qaCourseIdFromSnapshot_(result.currentSnapshot || result.rawSnapshot || result);
  var knownDestinations = sameGen.filter(function(r){ return !!r.courseId; });
  var lastDestination = knownDestinations.length ? knownDestinations[knownDestinations.length-1] : null;
  var explicitReimportDecision = importEvent === 'REIMPORT_ONCE' || importEvent === 'ORIGINAL_IMPORT' || requestedGeneration != null;
  if (!explicitReimportDecision && currentCourseId && lastDestination && currentCourseId !== lastDestination.courseId) {
    warnings.push('The Coursera destination course/branch ID changed. CTI did not treat that alone as a re-ingestion. Confirm whether Smart Ingestion actually ran again.');
  } else if (!explicitReimportDecision && parent && parent.warning) {
    warnings.push(parent.warning);
  }
  if (mode === 'LIFECYCLE') {
    var rawId = qaCourseIdFromSnapshot_(result.rawSnapshot);
    var curId = qaCourseIdFromSnapshot_(result.currentSnapshot);
    if (rawId && curId && rawId !== curId) warnings.push('The two Before/After files come from different Coursera destination IDs. Use this comparison only when both snapshots belong to the same Smart Ingestion attempt.');
  }
  return {
    generation:generation, generationLabel:'G'+generation,
    stage:qaSnapshotStageFromResult_(mode,result,requested.stage),
    generationProvenance:provenance, generationWarning:warnings.filter(function(w,i,a){ return a.indexOf(w) === i && !a.some(function(other){ return other !== w && other.indexOf(w) !== -1; }); }).join(' '),
    parentRunId:parent ? parent.runId : '', parentSummary:parent ? parent.summary : {},
    previousGenerationRunId:previousRaw ? previousRaw.runId : '', previousSummary:previousRaw ? previousRaw.summary : {},
    requestedGeneration:requestedGeneration, requestedStage:String(requested.stage || 'AUTO'), requestedImportEvent:importEvent || 'AUTO',
    notes:String(requested.notes || '').slice(0,1000)
  };
}

// Legacy v6.12.0 did not preserve the requested generation. These are candidates,
// not proof of an automatic decision; the operator must confirm no reimport.
function qaRepeatedExportRepairCandidates_(values, targetUuid) {
  var prior = qaLineageRows_(values, targetUuid);
  return prior.filter(function(r) {
    if (r.release !== 'v6.12.0' || r.engine !== 'v6.12.0-longitudinal-fidelity-systems-health-20260913' || r.provenance ||
        r.mode !== 'SINGLE_C0' || r.stage !== 'RAW_UNPUBLISHED' || r.generation < 1 ||
        r.notes !== 'Reimport generation inferred from a distinct raw XLSX snapshot.' ||
        r.label || r.reviewerNotes || r.reviewStatus !== 'UNREVIEWED' || !r.courseId || !r.c0Hash) return false;
    var parents = prior.filter(function(p){ return p.runId === r.previousRunId && p.rowNumber < r.rowNumber; });
    if (parents.length !== 1) return false;
    var parent = parents[0];
    if (parent.mode !== 'SINGLE_C0' || parent.generation !== r.generation-1 || parent.courseId !== r.courseId ||
        !parent.c0Hash || parent.c0Hash === r.c0Hash || r.parentRunId) return false;
    // Refuse to rewrite a generation with other observations or later dependents.
    if (prior.some(function(p){ return p.runId !== r.runId && (p.generation >= r.generation || p.parentRunId === r.runId || p.previousRunId === r.runId); })) return false;
    var d = r.delta;
    if (d.kind !== 'REIMPORT_RAW_TO_RAW' || d.fromRunId !== parent.runId || d.toGeneration !== 'G'+r.generation) return false;
    var zero = ['observedFidelity','evidenceCoverage','ingestionFailures','missing','partial','unverified','behaviorMutations','runtimeReviews'].every(function(key) {
      var metric = d[key];
      return metric && typeof metric.before === 'number' && Number.isFinite(metric.before) &&
        typeof metric.after === 'number' && Number.isFinite(metric.after) && metric.delta === 0 && metric.before === metric.after &&
        typeof parent.summary[key] === 'number' && typeof r.summary[key] === 'number' &&
        parent.summary[key] === metric.before && r.summary[key] === metric.after;
    });
    var evo = d.itemEvolution;
    return zero && evo && evo.fixedOrImproved === 0 && evo.regressed === 0 && evo.addedEvidence === 0 && evo.removedEvidence === 0 &&
      Number.isInteger(evo.unchanged) && evo.unchanged > 0 && Array.isArray(evo.changes) && evo.changes.length === 0 &&
      d.previousRecommendation === d.currentRecommendation;
  }).map(function(r) {
    return {runId:r.runId, rowNumber:r.rowNumber, fromGeneration:r.generation, toGeneration:r.generation-1, parentRunId:r.previousRunId};
  });
}

function qaRepairRepeatedExportLineage_(ss, sheet, targetUuid, runId) {
  var values = sheet.getDataRange().getValues();
  var candidate = qaRepeatedExportRepairCandidates_(values,targetUuid).filter(function(c){ return c.runId === runId; })[0];
  if (!candidate) throw new Error('This run is no longer eligible for conservative repeated-export repair. Refresh QA Evidence Memory.');
  var prior = qaLineageRows_(values,targetUuid);
  var current = prior.filter(function(r){ return r.runId === runId; })[0];
  var previous = prior.filter(function(r){ return r.rowNumber < current.rowNumber && r.generation === candidate.toGeneration-1 && r.mode === 'SINGLE_C0'; });
  var previousRaw = previous.length ? previous[previous.length-1] : null;
  var delta = qaBuildLongitudinalDelta_(previousRaw ? previousRaw.summary : {}, current.summary, {
    previousGenerationRunId:previousRaw ? previousRaw.runId : '', generationLabel:'G'+candidate.toGeneration
  });
  if (delta) {
    var before = qaLoadRunPayloadById_(ss,previousRaw.runId), after = qaLoadRunPayloadById_(ss,runId);
    if (!before || !after || !Array.isArray((before.result || {}).itemResults) || !Array.isArray((after.result || {}).itemResults)) {
      throw new Error('Stored item evidence is unavailable to rebuild the earlier-generation comparison; no repair was made.');
    }
    delta.itemEvolution = qaItemEvolutionDelta_(before.result.itemResults,after.result.itemResults);
  }
  // One contiguous metadata write; Summary JSON, review fields and payload chunks remain untouched.
  var metadata = values[current.rowNumber-1].slice(26,37);
  while (metadata.length < 11) metadata.push('');
  metadata[0] = candidate.toGeneration;
  metadata[5] = candidate.parentRunId;
  metadata[6] = previousRaw ? previousRaw.runId : '';
  metadata[7] = 'Operator confirmed no Smart Ingestion reimport. Repaired repeated-export G'+candidate.fromGeneration+' to G'+candidate.toGeneration+'; original QA payload preserved.';
  metadata[8] = delta ? JSON.stringify(delta) : '';
  metadata[9] = 'REPAIRED_REPEAT_EXPORT';
  metadata[10] = '';
  sheet.getRange(current.rowNumber,27,1,11).setValues([metadata]);
  return {success:true, runId:runId, generation:candidate.toGeneration, snapshotStage:current.stage};
}

function repairQaRepeatedExportLineage(targetUuid, runId, confirmedNoReimport) {
  authorize_();
  var lock = null;
  try {
    targetUuid = validateUuid_(targetUuid);
    if (confirmedNoReimport !== true) throw new Error('Confirm that no Smart Ingestion reimport occurred before requesting repair.');
    if (typeof runId !== 'string' || !runId || runId.length > 180) throw new Error('Invalid QA run ID.');
    var ss = getDatabaseSheet_().getParent();
    lock = LockService.getScriptLock();
    lock.waitLock(10000);
    var sheet = getQaRunsSheet_(ss);
    return qaRepairRepeatedExportLineage_(ss,sheet,targetUuid,runId);
  } catch(e) { return {success:false,error:String(e && e.message || e)}; }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}