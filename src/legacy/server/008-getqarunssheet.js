


// -------------------------------------------------------------------
// POST-INGESTION QA EVIDENCE MEMORY v5 — operator-confirmed import attempts + retrievable reports
// Append-only storage of deterministic QA outputs. Runs are version-tagged and
// default to UNREVIEWED so future ML can train only on human-confirmed labels.
// -------------------------------------------------------------------
function getQaRunsSheet_(ss) {
  var sheet = ss.getSheetByName(QA_RUNS_SHEET_NAME);
  var baseHeaders = [
    "Run ID", "Timestamp", "Package UUID", "Mode", "Gateway Release", "QA Engine Build",
    "Extractor Version", "Extractor Schema", "Extractor Build", "C0 Course ID", "C1 Course ID",
    "C0 XLSX", "C0 JSON", "C1 XLSX", "C1 JSON", "C0 XLSX SHA256", "C0 JSON SHA256",
    "C1 XLSX SHA256", "C1 JSON SHA256", "Source→C0 Match", "Source→C1 Match",
    "Summary JSON", "Review Status", "Human Label", "Reviewer Notes", "Payload Chunks"
  ];
  var lineageHeaders = [
    "Lineage Generation", "Snapshot Stage", "Source Scan ID", "Source Scan Timestamp",
    "Source Scan Metrics JSON", "Parent Run ID", "Previous Generation Run ID",
    "Lineage Notes", "Delta JSON", "Generation Provenance", "Generation Warning"
  ];
  var liveSourceHeaders = [
    "Live Source Platform", "Live Source File", "Live Source SHA256", "Live Source Course ID",
    "Live Source Schema", "Live Source Extractor", "Live Source Build"
  ];
  var generationEvidenceHeaders = [
    "Generation SI Provenance JSON", "Generation SI Provenance Source Run ID", "Manual Change Attribution JSON"
  ];
  var allHeaders = baseHeaders.concat(lineageHeaders).concat(liveSourceHeaders).concat(generationEvidenceHeaders);
  if (!sheet) {
    sheet = ss.insertSheet(QA_RUNS_SHEET_NAME);
    sheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#EEF2FF");
    sheet.setFrozenRows(1);
  } else {
    var lastCol = Math.max(1, sheet.getLastColumn());
    var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){ return String(v || ''); });
    var changed = false;
    allHeaders.forEach(function(header) {
      if (existing.indexOf(header) === -1) { existing.push(header); changed = true; }
    });
    if (changed) sheet.getRange(1, 1, 1, existing.length).setValues([existing]);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#EEF2FF");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getQaRunChunksSheet_(ss) {
  var sheet = ss.getSheetByName(QA_RUN_CHUNKS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(QA_RUN_CHUNKS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([["Run ID", "Chunk Index", "Base64 Result Chunk"]]);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#F3F4F6");
    try { sheet.hideSheet(); } catch (e) {}
  }
  return sheet;
}

function qaHexDigest_(bytes) {
  return (bytes || []).map(function(b) {
    var v = b < 0 ? b + 256 : b;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

function qaSha256Base64_(base64Value) {
  if (!base64Value) return '';
  try {
    var bytes = Utilities.base64Decode(base64Value);
    return qaHexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  } catch (e) { return ''; }
}

function qaExtractorIdentityFromResult_(result) {
  var meta = {};
  if (result && result.stats && result.stats.extractorMeta) meta = result.stats.extractorMeta || {};
  else if (result && result.currentSnapshot && result.currentSnapshot.stats) meta = result.currentSnapshot.stats.extractorMeta || {};
  var crawl = meta.activeSpaCrawl || {};
  return {
    version: String(crawl.version || meta.version || meta.extractor || '').replace(/^.*?v(?=\d)/i, 'v').slice(0, 80),
    schema: meta.schemaVersion == null ? '' : String(meta.schemaVersion),
    build: String(crawl.buildId || meta.buildId || '').slice(0, 180)
  };
}

function qaCourseIdFromSnapshot_(snapshot) {
  var meta = snapshot && snapshot.stats && snapshot.stats.extractorMeta || {};
  var page = meta.page || {};
  return String(page.courseId || '').slice(0, 120);
}


function qaRunHeaderMap_(sheet) {
  var map = Object.create(null);
  if (!sheet || sheet.getLastColumn() < 1) return map;
  var headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  headers.forEach(function(value, index){ map[String(value || '')] = index; });
  return map;
}

function qaLatestSourceScanForUuid_(ss, targetUuid) {
  var sheet = ss.getSheetByName(PACKAGE_SCAN_HISTORY_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var rows = sheet.getRange(2,1,sheet.getLastRow()-1,11).getValues();
  for (var i=rows.length-1; i>=0; i--) {
    if (String(rows[i][2] || '') !== String(targetUuid || '')) continue;
    var timestamp = rows[i][1];
    var metrics = {};
    try { metrics = rows[i][8] ? JSON.parse(String(rows[i][8])) : {}; } catch (e) {}
    return {
      scanId:String(rows[i][0] || ''),
      timestamp:timestamp instanceof Date ? timestamp.toISOString() : String(timestamp || ''),
      action:String(rows[i][3] || ''),
      metrics:metrics
    };
  }
  return null;
}

function qaNormalizeRequestedGeneration_(value) {
  if (value === '' || value === null || value === undefined || String(value).toLowerCase() === 'auto') return null;
  var m = String(value).match(/^(?:g)?(\d+)$/i);
  if (!m) return null;
  var n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 99 ? Math.floor(n) : null;
}

function qaSnapshotStageFromResult_(mode, result, requestedStage) {
  var requested = String(requestedStage || 'AUTO').toUpperCase();
  if (['RAW_UNPUBLISHED','OPS_PREPARED_UNPUBLISHED','PUBLISHED'].indexOf(requested) > -1) return requested;
  if (mode === 'LIFECYCLE') return 'LIFECYCLE_COMPARISON';
  if (mode === 'SINGLE_C0') return 'RAW_UNPUBLISHED';
  var ctx = result && result.snapshotContext || {};
  if (['RAW_UNPUBLISHED','OPS_PREPARED_UNPUBLISHED','PUBLISHED'].indexOf(String(ctx.stage || '').toUpperCase()) > -1) return String(ctx.stage).toUpperCase();
  var observed = Number(ctx.publicationObservedCount || 0);
  var published = Number(ctx.publishedCount || 0);
  var unpublished = Number(ctx.unpublishedCount || 0);
  if (observed >= 1 && published > 0 && unpublished === 0) return 'PUBLISHED';
  if (observed >= 3 && published / observed >= 0.90) return 'PUBLISHED';
  return 'OPS_PREPARED_UNPUBLISHED';
}

// XLSX fingerprints identify evidence files, never Smart Ingestion attempts.
function qaLineageRows_(values, targetUuid) {
  if (!values || !values.length) return [];
  var h = Object.create(null);
  values[0].forEach(function(v,i){ h[String(v)] = i; });
  function field(row, name) { return h[name] == null ? '' : row[h[name]]; }
  function json(value) { try { var parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch(e) { return {}; } }
  return values.slice(1).map(function(row,index) {
    var g = Number(field(row,'Lineage Generation'));
    return {
      rowNumber:index+2, runId:String(field(row,'Run ID') || ''), uuid:String(field(row,'Package UUID') || ''),
      generation:Number.isInteger(g) && g >= 0 && g <= 99 ? g : 0,
      mode:String(field(row,'Mode') || ''), stage:String(field(row,'Snapshot Stage') || ''),
      courseId:String(field(row,'C1 Course ID') || field(row,'C0 Course ID') || ''),
      c0Hash:String(field(row,'C0 XLSX SHA256') || ''),
      c0JsonHash:String(field(row,'C0 JSON SHA256') || ''),
      summary:json(field(row,'Summary JSON')), delta:json(field(row,'Delta JSON')),
      release:String(field(row,'Gateway Release') || ''), engine:String(field(row,'QA Engine Build') || ''),
      provenance:String(field(row,'Generation Provenance') || ''), warning:String(field(row,'Generation Warning') || ''),
      notes:String(field(row,'Lineage Notes') || ''), label:String(field(row,'Human Label') || ''),
      reviewerNotes:String(field(row,'Reviewer Notes') || ''), reviewStatus:String(field(row,'Review Status') || ''),
      parentRunId:String(field(row,'Parent Run ID') || ''), previousRunId:String(field(row,'Previous Generation Run ID') || '')
    };
  }).filter(function(row){ return row.uuid === String(targetUuid || ''); });
}


function qaRequestedGenerationFromMemory_(targetUuid, lineageMeta, runsSheet) {
  lineageMeta = lineageMeta && typeof lineageMeta === 'object' ? lineageMeta : {};
  var requestedGeneration = qaNormalizeRequestedGeneration_(lineageMeta.generation);
  var importEvent = String(lineageMeta.importEvent || lineageMeta.event || '').trim().toUpperCase();
  var prior = qaLineageRows_(runsSheet ? runsSheet.getDataRange().getValues() : [], targetUuid);
  var anchors = prior.filter(function(r){ return /^EXPLICIT_/.test(String(r.provenance || '')); });
  var activeGeneration = anchors.length ? Math.max.apply(null, anchors.map(function(r){ return r.generation; })) :
    (prior.length ? Math.max.apply(null, prior.map(function(r){ return r.generation; })) : 0);
  if (requestedGeneration != null) return requestedGeneration;
  if (importEvent === 'REIMPORT_ONCE') return activeGeneration + 1;
  if (importEvent === 'ORIGINAL_IMPORT') return 0;
  return activeGeneration;
}

function qaCompactIngestionIntelligence_(intel) {
  intel = intel && typeof intel === 'object' ? intel : {};
  var claims = Array.isArray(intel.claims) ? intel.claims.slice(0,220).map(function(c){
    return {
      type:String(c.type || ''), subject:String(c.subject || ''), target:String(c.target || ''),
      excerpt:String(c.excerpt || '').slice(0,560), confidence:Number(c.confidence || 0),
      detail:String(c.detail || '').slice(0,560), pathHint:String(c.pathHint || '').slice(0,300),
      context:String(c.context || '').slice(0,700), severity:String(c.severity || ''),
      remediation:String(c.remediation || '').slice(0,560),
      originalClaimType:String(c.originalClaimType || ''), originalClaimSubject:String(c.originalClaimSubject || ''),
      classificationReason:String(c.classificationReason || '').slice(0,560)
    };
  }) : [];
  var counts = {};
  claims.forEach(function(c){ if(c.type) counts[c.type] = (counts[c.type] || 0) + 1; });
  return {
    detected:claims.length > 0 || intel.detected === true,
    parserVersion:String(intel.parserVersion || 'smart-ingestion-provenance-v2'),
    reportCount:Number(intel.reportCount || 0),
    reportItems:Array.isArray(intel.reportItems) ? intel.reportItems.slice(0,20) : [],
    claims:claims,
    categoryCounts:counts,
    criticalClaims:claims.filter(function(c){return c.severity === 'CRITICAL';}).slice(0,60),
    reviewClaims:claims.filter(function(c){return c.severity === 'REVIEW';}).slice(0,80),
    generatedFieldMentions:Number(intel.generatedFieldMentions || 0),
    contentAdaptationMentions:Number(intel.contentAdaptationMentions || 0),
    emptyModuleMentions:Number(intel.emptyModuleMentions || 0),
    reportTextLength:Number(intel.reportTextLength || 0),
    trustModel:String(intel.trustModel || 'CLAIM_PLUS_OBSERVATION'),
    note:String(intel.note || '')
  };
}

function qaMergeGenerationIngestionIntelligence_(currentIntel, inheritedIntel, sourceRunId) {
  currentIntel = qaCompactIngestionIntelligence_(currentIntel || {});
  inheritedIntel = qaCompactIngestionIntelligence_(inheritedIntel || {});
  var claims = [], seen = Object.create(null);
  function addClaim(c, origin) {
    if (!c) return;
    c = qaNormalizeIngestionClaimScope_(c);
    var key = [String(c.type||''),qaCleanName_(c.subject||''),qaCleanName_(c.target||''),qaCleanName_(c.pathHint||''),String(c.excerpt||'').toLowerCase()].join('|');
    if (!key || seen[key]) return;
    seen[key] = true;
    var clone = Object.assign({}, c);
    clone.provenanceOrigin = origin;
    claims.push(clone);
  }
  (currentIntel.claims || []).forEach(function(c){ addClaim(c,'CURRENT_SNAPSHOT'); });
  (inheritedIntel.claims || []).forEach(function(c){ addClaim(c,'EVIDENCE_MEMORY'); });
  var counts = {};
  claims.forEach(function(c){ if(c.type) counts[c.type]=(counts[c.type]||0)+1; });
  var inheritedCount = claims.filter(function(c){return c.provenanceOrigin === 'EVIDENCE_MEMORY';}).length;
  var currentCount = claims.length - inheritedCount;
  return {
    detected:claims.length > 0,
    parserVersion:'smart-ingestion-provenance-v2+generation-memory-v1',
    reportCount:Number(currentIntel.reportCount || 0),
    reportItems:currentIntel.reportItems || [],
    claims:claims,
    categoryCounts:counts,
    criticalClaims:claims.filter(function(c){return c.severity === 'CRITICAL';}).slice(0,60),
    reviewClaims:claims.filter(function(c){return c.severity === 'REVIEW';}).slice(0,80),
    generatedFieldMentions:Math.max(Number(currentIntel.generatedFieldMentions||0),Number(inheritedIntel.generatedFieldMentions||0)),
    contentAdaptationMentions:Math.max(Number(currentIntel.contentAdaptationMentions||0),Number(inheritedIntel.contentAdaptationMentions||0)),
    emptyModuleMentions:Math.max(Number(currentIntel.emptyModuleMentions||0),Number(inheritedIntel.emptyModuleMentions||0)),
    reportTextLength:Number(currentIntel.reportTextLength || 0),
    trustModel:'CLAIM_PLUS_OBSERVATION',
    provenanceMemory:{
      inherited:inheritedCount > 0,
      inheritedClaimCount:inheritedCount,
      currentClaimCount:currentCount,
      sourceRunId:String(sourceRunId || ''),
      reason:inheritedCount ? 'Smart Ingestion provenance was inherited from an earlier QA snapshot in the same import generation so deleting the [DELETE ME] Author Alignment Report during cleanup does not erase ingestion history.' : ''
    },
    note:claims.length ? 'Smart Ingestion provenance is generation-scoped. Current Author Alignment Report claims and durable same-generation Evidence Memory claims are reconciled with independent CTI evidence.' : ''
  };
}


function qaSelectCanonicalRawBaselineRow_(rows) {
  rows = Array.isArray(rows) ? rows : [];
  var rawRows = rows.filter(function(r){
    return r && (r.mode === 'SINGLE_C0' || r.stage === 'RAW_UNPUBLISHED');
  });
  // v7.2.1: the raw baseline is immutable within a Smart Ingestion generation.
  // Use the FIRST valid raw observation, never the latest row labelled raw.
  // This prevents an operator accidentally labelling a manually edited shell as
  // "raw" from rewriting the historical post-ingestion baseline.
  return rawRows.length ? rawRows[0] : null;
}

function qaPhysicalDestinationIds_(items) {
  var ids=[];
  (Array.isArray(items)?items:[]).forEach(function(item){
    var id=String(item && item.courseraId || '').trim();
    var family=item && item.checks && item.checks.transformationFamily;
    var refs=/^cti-aggregate:/.test(id) ? (family && Array.isArray(family.childIds)?family.childIds:[]) : [id];
    refs.forEach(function(ref){var value=String(ref||'').trim();if(value && !/^cti-aggregate:/.test(value) && ids.indexOf(value)<0)ids.push(value);});
  });
  return ids;
}

function qaObsoleteAggregateStageGuard_(result, baseline, priorNonRaw) {
  // Repair only the documented synthetic-ID false positive. Keep the saved raw
  // baseline and genuine later-stage observations immutable.
  var ctx=result && result.snapshotContext || {};
  if(priorNonRaw || !ctx.stageGuardApplied || ctx.originalMode!=='RAW_INGESTION')return false;
  var reason=String(ctx.stageGuardReason||'');
  var m=reason.match(/^(?:a later-stage QA snapshot already exists in this same Smart Ingestion generation; )?(\d+) destination item\(s\) that existed in the canonical raw baseline are absent now$/);
  if(!m)return false;
  var synthetic=(baseline||[]).filter(function(x){return /^cti-aggregate:/.test(String(x.courseraId||''));});
  if(!synthetic.length || synthetic.some(function(x){return !qaPhysicalDestinationIds_([x]).length;}))return false;
  var seen=qaPhysicalDestinationIds_(result.itemResults||[]);
  var required=qaPhysicalDestinationIds_(baseline);
  if(!required.length || required.some(function(id){return seen.indexOf(id)<0;}))return false;
  var legacyMissing=[];
  (baseline||[]).forEach(function(x){var id=String(x.courseraId||'').trim();if(id && seen.indexOf(id)<0 && legacyMissing.indexOf(id)<0)legacyMissing.push(id);});
  return legacyMissing.length===Number(m[1]) && legacyMissing.every(function(id){return /^cti-aggregate:/.test(id);});
}

// Reanalysis of exactly the saved raw inputs is not a new course snapshot.
// Both hashes are computed by the server; missing hashes or supplemental inputs
// cannot establish replay identity. The first raw baseline remains immutable.
function qaIsExactRawEvidenceReplay_(generationContext, inputIdentity) {
  var saved=generationContext && generationContext.rawBaselineEvidence || {}, incoming=inputIdentity || {};
  if(saved.hasReadingRecovery || incoming.hasReadingRecovery)return false;
  return ['excelSha256','jsonSha256'].every(function(key){
    return /^[a-f0-9]{64}$/i.test(String(saved[key]||'')) &&
      String(saved[key]).toLowerCase()===String(incoming[key]||'').toLowerCase();
  });
}