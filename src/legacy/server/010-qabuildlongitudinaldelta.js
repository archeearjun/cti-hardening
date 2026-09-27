

function qaBuildLongitudinalDelta_(previousSummary, currentSummary, lineage) {
  previousSummary = previousSummary || {};
  currentSummary = currentSummary || {};
  lineage = lineage || {};
  if (!lineage.previousGenerationRunId) return null;
  function num(obj, key) { var n = Number(obj && obj[key]); return Number.isFinite(n) ? n : null; }
  function d(key) {
    var before = num(previousSummary,key), after = num(currentSummary,key);
    return { before:before, after:after, delta:(before == null || after == null) ? null : after-before };
  }
  var prevPolicy = previousSummary.operationalPolicy || {};
  var curPolicy = currentSummary.operationalPolicy || {};
  return {
    kind:'REIMPORT_RAW_TO_RAW',
    fromRunId:lineage.previousGenerationRunId,
    toGeneration:lineage.generationLabel,
    observedFidelity:d('observedFidelity'),
    evidenceCoverage:d('evidenceCoverage'),
    ingestionFailures:d('ingestionFailures'),
    missing:d('missing'),
    partial:d('partial'),
    unverified:d('unverified'),
    behaviorMutations:d('behaviorMutations'),
    runtimeReviews:d('runtimeReviews'),
    previousRecommendation:String(prevPolicy.recommendationCode || ''),
    currentRecommendation:String(curPolicy.recommendationCode || '')
  };
}

function qaLoadRunPayloadById_(ss, runId) {
  if (!ss || !runId) return null;
  var sheet = ss.getSheetByName(QA_RUN_CHUNKS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var rows = sheet.getRange(2,1,sheet.getLastRow()-1,3).getValues().filter(function(r){ return String(r[0] || '') === String(runId); });
  if (!rows.length) return null;
  rows.sort(function(a,b){ return Number(a[1]||0)-Number(b[1]||0); });
  try {
    var encoded = rows.map(function(r){ return String(r[2] || ''); }).join('');
    var json = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString();
    return JSON.parse(json);
  } catch (e) { return null; }
}

function qaItemEvolutionDelta_(previousItems, currentItems) {
  previousItems = Array.isArray(previousItems) ? previousItems : [];
  currentItems = Array.isArray(currentItems) ? currentItems : [];
  function key(item) {
    if (item && item.sourceId) return 'id:' + String(item.sourceId);
    return 'name:' + qaCleanName_(item && item.sourceName || '') + '|path:' + qaCleanName_(item && item.sourcePath || '');
  }
  function rank(verdict) {
    var v=String(verdict||'');
    var map={VERIFIED:0,EXPECTED_TRANSFORMATION:0,REPACKAGED:1,MOVED:2,STATE_MUTATION:3,RUNTIME_REVIEW:3,UNVERIFIED:4,PARTIAL:5,TYPE_MUTATION:6,BEHAVIOR_MUTATION:6,INGESTION_FAILURE:8,MISSING:9};
    return map[v] == null ? 4 : map[v];
  }
  var prev=Object.create(null), cur=Object.create(null);
  previousItems.forEach(function(i){ prev[key(i)]=i; }); currentItems.forEach(function(i){ cur[key(i)]=i; });
  var keys=Object.keys(prev); Object.keys(cur).forEach(function(k){ if(keys.indexOf(k)===-1) keys.push(k); });
  var changes=[], fixed=0, regressed=0, unchanged=0, added=0, removed=0;
  keys.forEach(function(k){
    var a=prev[k], b=cur[k];
    if (!a && b) { added++; if(changes.length<60) changes.push({sourceName:b.sourceName||'',sourcePath:b.sourcePath||'',from:'ABSENT_IN_PRIOR_EVIDENCE',to:b.verdict||'',change:'ADDED_EVIDENCE'}); return; }
    if (a && !b) { removed++; if(changes.length<60) changes.push({sourceName:a.sourceName||'',sourcePath:a.sourcePath||'',from:a.verdict||'',to:'ABSENT_IN_CURRENT_EVIDENCE',change:'REMOVED_EVIDENCE'}); return; }
    var ar=rank(a.verdict), br=rank(b.verdict);
    if (String(a.verdict||'')===String(b.verdict||'') && JSON.stringify(a.issues||[])===JSON.stringify(b.issues||[])) { unchanged++; return; }
    var change=br<ar?'FIXED_OR_IMPROVED':(br>ar?'REGRESSED':'CHANGED_SAME_SEVERITY');
    if(change==='FIXED_OR_IMPROVED') fixed++; else if(change==='REGRESSED') regressed++;
    if(changes.length<60) changes.push({sourceName:b.sourceName||a.sourceName||'',sourcePath:b.sourcePath||a.sourcePath||'',from:a.verdict||'',to:b.verdict||'',change:change,fromIssues:a.issues||[],toIssues:b.issues||[]});
  });
  return {fixedOrImproved:fixed,regressed:regressed,unchanged:unchanged,addedEvidence:added,removedEvidence:removed,changes:changes};
}

function qaBuildStageDelta_(parentSummary, currentSummary, lineage) {
  lineage = lineage || {};
  if (!lineage.parentRunId) return null;
  var fake = Object.assign({}, lineage, { previousGenerationRunId:lineage.parentRunId });
  var delta = qaBuildLongitudinalDelta_(parentSummary || {}, currentSummary || {}, fake);
  if (delta) { delta.kind = 'GENERATION_STAGE_DELTA'; delta.fromRunId = lineage.parentRunId; }
  return delta;
}

function persistQaRun_(targetUuid, mode, result, inputMeta) {
  var lineageLock = null;
  try {
    targetUuid = validateUuid_(targetUuid);
    var packageSheet = getDatabaseSheet_();
    var ss = packageSheet.getParent();
    lineageLock = LockService.getScriptLock();
    lineageLock.waitLock(10000);
    var runs = getQaRunsSheet_(ss);
    var chunks = getQaRunChunksSheet_(ss);
    var runId = 'QA-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 8);
    var created = new Date();
    var extractor = qaExtractorIdentityFromResult_(result);
    var raw = result && result.rawSnapshot || null;
    var cur = result && result.currentSnapshot || null;
    var singleCourseId = qaCourseIdFromSnapshot_({stats: result && result.stats || {}});
    var c0CourseId = raw ? qaCourseIdFromSnapshot_(raw) : (result && result.snapshotContext && result.snapshotContext.mode === 'RAW_INGESTION' ? singleCourseId : '');
    var c1CourseId = cur ? qaCourseIdFromSnapshot_(cur) : (result && result.snapshotContext && result.snapshotContext.mode !== 'RAW_INGESTION' ? singleCourseId : '');
    inputMeta = inputMeta || {};

    var payload = JSON.stringify({
      schemaVersion: QA_RUN_SCHEMA_VERSION_,
      runId: runId,
      storedAt: created.toISOString(),
      packageUuid: targetUuid,
      mode: mode,
      reportFormatVersion: 'QA_REPORT_V1',
      result: result
    });
    if (payload.length > 12000000) throw new Error('QA result exceeds the 12 MB evidence-memory safety limit.');
    var encoded = Utilities.base64Encode(Utilities.newBlob(payload).getBytes());
    var chunkRows = [];
    for (var offset = 0, index = 0; offset < encoded.length; offset += QA_RUN_CHUNK_SIZE_, index++) {
      chunkRows.push([runId, index, encoded.slice(offset, offset + QA_RUN_CHUNK_SIZE_)]);
    }

    var summaryObj = mode === 'LIFECYCLE' ? (result.lifecycleSummary || {}) : (result.summary || {});
    var summaryJson = JSON.stringify(summaryObj);
    if (summaryJson.length > 45000) summaryJson = summaryJson.slice(0, 45000);
    var sourceC0 = raw ? ((raw.summary || {}).observedFidelity) : (result.snapshotContext && result.snapshotContext.mode === 'RAW_INGESTION' ? ((result.summary || {}).observedFidelity) : '');
    var sourceC1 = cur ? ((cur.summary || {}).observedFidelity) : (result.snapshotContext && result.snapshotContext.mode !== 'RAW_INGESTION' ? ((result.summary || {}).observedFidelity) : '');
    var lineage = qaResolveLineage_(targetUuid, mode, result, inputMeta, runs);
    var sourceScan = qaLatestSourceScanForUuid_(ss, targetUuid) || {};
    var delta = mode === 'SINGLE_C0' ? qaBuildLongitudinalDelta_(lineage.previousSummary, summaryObj, lineage) : (mode === 'SINGLE_C1' ? qaBuildStageDelta_(lineage.parentSummary, summaryObj, lineage) : null);
    if (delta && delta.fromRunId) {
      var previousPayload = qaLoadRunPayloadById_(ss, delta.fromRunId);
      var previousResult = previousPayload && previousPayload.result || {};
      var previousItems = previousResult.itemResults || (previousResult.currentSnapshot && previousResult.currentSnapshot.itemResults) || [];
      var currentItems = result && result.itemResults || (result && result.currentSnapshot && result.currentSnapshot.itemResults) || [];
      delta.itemEvolution = qaItemEvolutionDelta_(previousItems, currentItems);
    }
    var deltaJson = delta ? JSON.stringify(delta) : '';
    var lineageNotes = lineage.notes || 'Generation tracks a Smart Ingestion attempt; exports are evidence only.';

    var row = [[
      runId, created, targetUuid, mode, CTI_GATEWAY_RELEASE_, CTI_QA_ENGINE_BUILD_ID_,
      sheetSafeText_(extractor.version), sheetSafeText_(extractor.schema), sheetSafeText_(extractor.build), sheetSafeText_(c0CourseId), sheetSafeText_(c1CourseId),
      sheetSafeText_(inputMeta.c0ExcelName || ''), sheetSafeText_(inputMeta.c0JsonName || ''), sheetSafeText_(inputMeta.c1ExcelName || ''), sheetSafeText_(inputMeta.c1JsonName || ''),
      inputMeta.c0ExcelSha256 || '', inputMeta.c0JsonSha256 || '', inputMeta.c1ExcelSha256 || '', inputMeta.c1JsonSha256 || '',
      sourceC0 === '' || sourceC0 == null ? '' : Number(sourceC0), sourceC1 === '' || sourceC1 == null ? '' : Number(sourceC1),
      summaryJson, 'UNREVIEWED', '', '', chunkRows.length,
      lineage.generation, sheetSafeText_(lineage.stage), sheetSafeText_(sourceScan.scanId || ''), sheetSafeText_(sourceScan.timestamp || ''),
      JSON.stringify(sourceScan.metrics || {}), sheetSafeText_(lineage.parentRunId || ''), sheetSafeText_(lineage.previousGenerationRunId || ''),
      sheetSafeText_(lineageNotes), deltaJson, sheetSafeText_(lineage.generationProvenance), sheetSafeText_(lineage.generationWarning),
      sheetSafeText_(inputMeta.liveSourcePlatform || ''), sheetSafeText_(inputMeta.liveSourceFile || ''), inputMeta.liveSourceSha256 || '', sheetSafeText_(inputMeta.liveSourceCourseId || ''),
      sheetSafeText_(inputMeta.liveSourceSchema || ''), sheetSafeText_(inputMeta.liveSourceExtractor || ''), sheetSafeText_(inputMeta.liveSourceBuild || ''),
      sheetSafeText_(JSON.stringify(qaCompactIngestionIntelligence_(result && result.ingestionIntelligence || {}))),
      sheetSafeText_((result && result.generationEvidenceContext && result.generationEvidenceContext.provenanceSourceRunId) || ''),
      sheetSafeText_(JSON.stringify(result && result.manualChangeAttribution || {}))
    ]];

    runs.getRange(runs.getLastRow() + 1, 1, 1, row[0].length).setValues(row);
    if (chunkRows.length) chunks.getRange(chunks.getLastRow() + 1, 1, chunkRows.length, 3).setValues(chunkRows);
    return { status:'SAVED', runId:runId, storedAt:created.toISOString(), reviewStatus:'UNREVIEWED', lineage:{ generationProvenance:lineage.generationProvenance, generationWarning:lineage.generationWarning, generation:lineage.generation, generationLabel:lineage.generationLabel, stage:lineage.stage, parentRunId:lineage.parentRunId, previousGenerationRunId:lineage.previousGenerationRunId, sourceScanId:String(sourceScan.scanId || ''), sourceScanTimestamp:String(sourceScan.timestamp || '') }, delta:delta };
  } catch (e) {
    return { status:'FAILED', error:String(e && e.message || e) };
  } finally { if (lineageLock && lineageLock.hasLock()) lineageLock.releaseLock(); }
}

function getQaRunHistory(targetUuid, limit) {
  authorize_();
  try {
    targetUuid = validateUuid_(targetUuid);
    limit = Math.max(1, Math.min(25, Number(limit) || 10));
    var packageSheet = getDatabaseSheet_();
    var ss = packageSheet.getParent();
    var sheet = ss.getSheetByName(QA_RUNS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return { success:true, runs:[] };
    var values = sheet.getDataRange().getValues();
    var qaHeaders = qaRunHeaderMap_(sheet);
    function qaHistoryField_(row, name) { var idx = qaHeaders[name]; return idx == null ? '' : row[idx]; }
    var repairCandidates = qaRepeatedExportRepairCandidates_(values, targetUuid);
    var rows = [];
    for (var i = values.length - 1; i >= 1 && rows.length < limit; i--) {
      var r = values[i];
      if (String(r[2] || '') !== targetUuid) continue;
      rows.push({
        runId:String(r[0] || ''), timestamp:r[1] instanceof Date ? r[1].toISOString() : String(r[1] || ''),
        mode:String(r[3] || ''), gatewayRelease:String(r[4] || ''), engineBuild:String(r[5] || ''),
        extractorVersion:String(r[6] || ''), extractorSchema:String(r[7] || ''), extractorBuild:String(r[8] || ''),
        c0CourseId:String(r[9] || ''), c1CourseId:String(r[10] || ''),
        sourceToC0:r[19] === '' ? null : Number(r[19]), sourceToC1:r[20] === '' ? null : Number(r[20]),
        reviewStatus:String(r[22] || 'UNREVIEWED'), humanLabel:String(r[23] || ''), reviewerNotes:String(r[24] || ''), reportAvailable:Number(r[25] || 0) > 0,
        generation:r[26] === '' || r[26] == null ? 0 : Number(r[26]), generationLabel:'G' + (r[26] === '' || r[26] == null ? 0 : Number(r[26])),
        generationProvenance:String(r[35] || ''), generationWarning:String(r[36] || ''),
        repairCandidate:repairCandidates.filter(function(c){ return c.runId === String(r[0] || ''); })[0] || null,
        snapshotStage:String(r[27] || (String(r[3] || '') === 'SINGLE_C0' ? 'RAW_UNPUBLISHED' : 'LEGACY')),
        sourceScanId:String(r[28] || ''), sourceScanTimestamp:String(r[29] || ''), parentRunId:String(r[31] || ''), previousGenerationRunId:String(r[32] || ''), lineageNotes:String(r[33] || ''),
        liveSourcePlatform:String(qaHistoryField_(r,'Live Source Platform') || ''),
        liveSourceFile:String(qaHistoryField_(r,'Live Source File') || ''),
        liveSourceSha256:String(qaHistoryField_(r,'Live Source SHA256') || ''),
        liveSourceCourseId:String(qaHistoryField_(r,'Live Source Course ID') || ''),
        liveSourceSchema:String(qaHistoryField_(r,'Live Source Schema') || ''),
        liveSourceExtractor:String(qaHistoryField_(r,'Live Source Extractor') || ''),
        liveSourceBuild:String(qaHistoryField_(r,'Live Source Build') || ''),
        generationSiProvenanceSourceRunId:String(qaHistoryField_(r,'Generation SI Provenance Source Run ID') || ''),
        manualChangeAttribution:(function(){ try { var v=qaHistoryField_(r,'Manual Change Attribution JSON'); return v ? JSON.parse(String(v)) : null; } catch (e) { return null; } })(),
        delta:(function(){ try { return r[34] ? JSON.parse(String(r[34])) : null; } catch (e) { return null; } })()
      });
    }
    return { success:true, runs:rows };
  } catch (e) { return { success:false, error:'QA history error: ' + e.message }; }
}

function getQaStoredRun(targetUuid, runId) {
  authorize_();
  try {
    targetUuid = validateUuid_(targetUuid);
    runId = String(runId || '');
    if (!/^QA-[A-Za-z0-9-]+$/.test(runId) || runId.length > 180) throw new Error('Invalid QA run ID.');
    var ss = getDatabaseSheet_().getParent();
    var sheet = ss.getSheetByName(QA_RUNS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return {success:false,error:'No QA Evidence Memory exists for this title.'};
    var values = sheet.getDataRange().getValues();
    var storedQaHeaders = qaRunHeaderMap_(sheet);
    function storedQaField_(rowValue, name) { var idx = storedQaHeaders[name]; return idx == null ? '' : rowValue[idx]; }
    var row = null;
    for (var i=values.length-1;i>=1;i--) {
      if (String(values[i][0] || '') === runId && String(values[i][2] || '') === targetUuid) { row = values[i]; break; }
    }
    if (!row) return {success:false,error:'That saved QA run was not found for this title.'};
    var payload = qaLoadRunPayloadById_(ss,runId);
    if (!payload || !payload.result) return {success:false,error:'The saved QA payload is unavailable or incomplete.'};
    return {
      success:true,
      runId:runId,
      timestamp:row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ''),
      mode:String(row[3] || ''),
      gatewayRelease:String(row[4] || ''),
      generation:row[26] === '' || row[26] == null ? 0 : Number(row[26]),
      snapshotStage:String(row[27] || ''),
      generationProvenance:String(row[35] || ''),
      generationWarning:String(row[36] || ''),
      liveSource:{
        platform:String(storedQaField_(row,'Live Source Platform') || ''),
        fileName:String(storedQaField_(row,'Live Source File') || ''),
        sha256:String(storedQaField_(row,'Live Source SHA256') || ''),
        courseId:String(storedQaField_(row,'Live Source Course ID') || ''),
        schemaVersion:String(storedQaField_(row,'Live Source Schema') || ''),
        extractor:String(storedQaField_(row,'Live Source Extractor') || ''),
        buildId:String(storedQaField_(row,'Live Source Build') || '')
      },
      generationEvidence:{
        provenanceSourceRunId:String(storedQaField_(row,'Generation SI Provenance Source Run ID') || ''),
        provenance:(function(){ try { var v=storedQaField_(row,'Generation SI Provenance JSON'); return v ? JSON.parse(String(v)) : null; } catch(e){ return null; } })(),
        manualChangeAttribution:(function(){ try { var v=storedQaField_(row,'Manual Change Attribution JSON'); return v ? JSON.parse(String(v)) : null; } catch(e){ return null; } })()
      },
      reportFormatVersion:String(payload.reportFormatVersion || 'LEGACY_STRUCTURED_RESULT'),
      result:payload.result
    };
  } catch(e) { return {success:false,error:'Saved QA report error: ' + String(e && e.message || e)}; }
}

function removeTreeCellStorage_(ss, cellValue) {
  var value = String(cellValue || '');
  if (value.indexOf('TREE:') === 0) removeStoredCourseTree_(ss, value.slice(5));
}

function migratePackageSheetToUuid_(sheet) {
  sheet.getRange(1, 19).setValue("UUID");
  sheet.getRange(1, 20).setValue("Empty Folders");
  var recordCount = Math.max(0, sheet.getLastRow() - 1);
  if (recordCount === 0) return 0;
  var uuidRange = sheet.getRange(2, 19, recordCount, 1);
  var uuidValues = uuidRange.getValues();
  var addedCount = 0;
  var seenUuids = {};
  for (var i = 0; i < uuidValues.length; i++) {
    var candidate = String(uuidValues[i][0] || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate) || seenUuids[candidate]) {
      candidate = Utilities.getUuid();
      uuidValues[i][0] = candidate;
      addedCount++;
    } else if (String(uuidValues[i][0]) !== candidate) {
      uuidValues[i][0] = candidate;
      addedCount++;
    }
    seenUuids[candidate] = true;
  }
  if (addedCount > 0) uuidRange.setValues(uuidValues);
  var emptyRange = sheet.getRange(2, 20, recordCount, 1);
  var emptyValues = emptyRange.getValues();
  var needsEmptyMigration = emptyValues.some(function(row) { return row[0] === "" || row[0] == null; });
  if (needsEmptyMigration) {
    var rows = sheet.getRange(2, 1, recordCount, 20).getValues();
    var treeMap = loadTreeStoreMap_(sheet.getParent());
    for (var j = 0; j < rows.length; j++) {
      if (emptyValues[j][0] !== "" && emptyValues[j][0] != null) continue;
      var tree = [];
      try { tree = JSON.parse(resolveCourseTreeJson_(sheet.getParent(), rows[j][18], rows[j][12], treeMap) || "[]"); } catch (e) {}
      emptyValues[j][0] = countEmptyFolders_(tree);
    }
    emptyRange.setValues(emptyValues);
  }
  return addedCount;
}

function normalizePartnerName_(partnerName) { return String(partnerName || "").trim().replace(/\s+/g, " ").toLowerCase(); }
function duplicateDigest_(value) { var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || "")); return bytes.map(function(valueByte) { return ("0" + ((valueByte + 256) % 256).toString(16)).slice(-2); }).join(""); }
function duplicateTimestampNumber_(value, fallback) { if (Object.prototype.toString.call(value) === '[object Date]') return value.getTime(); var parsed = new Date(value).getTime(); return Number.isFinite(parsed) ? parsed : fallback; }
function duplicateDisplayTimestamp_(value) { var timestamp = duplicateTimestampNumber_(value, NaN); if (!Number.isFinite(timestamp)) return "Unknown"; return Utilities.formatDate(new Date(timestamp), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"); }
function duplicateCellIsBlank_(value) { return value == null || String(value).trim() === ""; }
function duplicateComparableValue_(value) { if (Object.prototype.toString.call(value) === '[object Date]') return "date:" + value.getTime(); return "text:" + String(value == null ? "" : value).trim().replace(/\s+/g, " ").toLowerCase(); }

function duplicateScanFingerprint_(row) {
  var values = [];
  for (var columnIndex = 3; columnIndex <= 11; columnIndex++) values.push(duplicateComparableValue_(row[columnIndex]));
  values.push(duplicateComparableValue_(row[19]));
  return JSON.stringify(values);
}

function chooseOldestDuplicateRecord_(records) { return records.slice().sort(function(a, b) { var aTime = duplicateTimestampNumber_(a.row[0], a.rowNumber); var bTime = duplicateTimestampNumber_(b.row[0], b.rowNumber); return aTime === bTime ? a.rowNumber - b.rowNumber : aTime - bTime; })[0]; }
function chooseLatestDuplicateRecord_(records) { return records.slice().sort(function(a, b) { var aTime = duplicateTimestampNumber_(a.row[0], a.rowNumber); var bTime = duplicateTimestampNumber_(b.row[0], b.rowNumber); return aTime === bTime ? b.rowNumber - a.rowNumber : bTime - aTime; })[0]; }

function mergeDuplicateMetadata_(records, survivor) {
  var metadataFields = [{ index: 13, label: "Assigned Date" }, { index: 14, label: "Owner" }, { index: 15, label: "Deadline" }, { index: 16, label: "Status" }, { index: 17, label: "Drive Link" }];
  var merged = {}, conflicts = [];
  metadataFields.forEach(function(field) {
    var distinct = Object.create(null), firstValue = null;
    records.forEach(function(record) {
      var value = record.row[field.index];
      if (duplicateCellIsBlank_(value)) return;
      distinct[duplicateComparableValue_(value)] = true;
      if (firstValue === null) firstValue = value;
    });
    if (Object.keys(distinct).length > 1) conflicts.push(field.label);
    merged[field.index] = duplicateCellIsBlank_(survivor.row[field.index]) && firstValue !== null ? firstValue : survivor.row[field.index];
  });
  return { values: merged, conflicts: conflicts };
}