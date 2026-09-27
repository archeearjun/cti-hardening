

function getRedoWorkQueueDb(partnerName, fromDate, toDate, ownerFilter) {
  authorize_();
  try {
    partnerName = String(partnerName || CTI_WORK_SOURCE_CONFIG_.nait.partner).trim();
    fromDate = workValidateDateOnly_(fromDate, CTI_WORK_DEFAULT_FROM_, 'From date');
    toDate = workValidateDateOnly_(toDate, CTI_WORK_DEFAULT_TO_, 'To date');
    if (toDate < fromDate) return { success:false, error:'To date must be on or after From date.' };
    ownerFilter = String(ownerFilter || '').trim();
    var scanAfter = workValidateDateOnly_(PropertiesService.getScriptProperties().getProperty('WORK_REDO_SCAN_AFTER'), CTI_WORK_DEFAULT_SCAN_AFTER_, 'Redo scan cutoff');
    var campaignId = workCampaignId_(partnerName, fromDate, toDate, scanAfter);

    var catalog;
    if (normalizePartnerName_(partnerName) === normalizePartnerName_(CTI_WORK_SOURCE_CONFIG_.nait.partner)) catalog = workBuildNaitCatalog_();
    else if (normalizePartnerName_(partnerName) === normalizePartnerName_(CTI_WORK_SOURCE_CONFIG_.marshall.partner)) catalog = workBuildMarshallCatalog_();
    else return { success:false, error:'Work Queue currently supports NAIT and Marshall catalog sources.' };

    var scormIndex = normalizePartnerName_(partnerName) === normalizePartnerName_(CTI_WORK_SOURCE_CONFIG_.nait.partner) ? workBuildScormIndex_() : Object.create(null);
    var groups = workReadPlannerGroups_(partnerName, fromDate, toDate, catalog.byKey);
    var titleKeys = Object.create(null);
    groups.forEach(function(group){ group.codes.forEach(function(key){ titleKeys[key] = true; }); });

    var packageSheet = getDatabaseSheet_(), ss = packageSheet.getParent();
    var packageIndex = workBuildPackageIndex_(packageSheet, partnerName);
    var scanHistory = loadLatestPackageScanHistoryMap_(ss);
    var rawQaMap = loadLatestRawQaMap_(ss);
    var stateMap = loadWorkStateMap_(ss, campaignId);
    var scanAfterMs = new Date(scanAfter + 'T00:00:00').getTime();
    var items = [], owners = Object.create(null);
    groups.forEach(function(group){ if (group.owner) owners[group.owner] = true; });

    Object.keys(titleKeys).forEach(function(titleKey) {
      var evidence = workPlannerEvidenceForItem_(groups, titleKey);
      if (ownerFilter && workOwnerKey_(evidence.owner) !== workOwnerKey_(ownerFilter)) return;
      var resolved = workResolveCatalogCandidate_(catalog.byKey[titleKey] || [], evidence.owner);
      var cat = resolved.row || {
        titleKey:titleKey, displayCode:titleKey.toUpperCase(), title:'Catalog title unresolved',
        productType:'', owner:evidence.owner, expectedFileName:titleKey.toUpperCase() + '.imscc',
        titleCode:'', brightspaceAccess:'', ccPackageAccess:'', importStatus:''
      };
      var packages = packageIndex[titleKey] || [];
      var ctiMatchStatus = packages.length === 0 ? 'MISSING' : (packages.length === 1 ? 'MATCH' : 'AMBIGUOUS');
      var pkg = packages.length === 1 ? packages[0] : null;
      var metrics = pkg ? workPackageMetricsFromRow_(pkg.row) : null;
      var uuid = pkg ? String(pkg.row[18] || '') : '';
      var latestScan = uuid ? scanHistory[uuid] || null : null;
      var latestScanMs = latestScan && latestScan.timestamp ? new Date(latestScan.timestamp).getTime() : NaN;
      var sourceRescanned = Number.isFinite(latestScanMs) && latestScanMs >= scanAfterMs;
      var latestRawQa = uuid ? rawQaMap[uuid] || null : null;
      var rawQaMs = latestRawQa && latestRawQa.timestamp ? new Date(latestRawQa.timestamp).getTime() : NaN;
      var rawQaFresh = sourceRescanned && Number.isFinite(rawQaMs) && (!Number.isFinite(latestScanMs) || rawQaMs >= latestScanMs);
      var rawQaRecommendation = rawQaFresh ? workRawQaRecommendation_(latestRawQa) : { code:'NONE', label:'No fresh raw-ingestion audit after the current source scan', tone:'muted' };
      var workKey = campaignId + '|' + titleKey;
      var state = stateMap[workKey] || workDefaultState_(workKey,campaignId,titleKey);
      var scorm = scormIndex[titleKey] || { riseCount:0, storylineCount:0, linkLabel:'' };
      var item = {
        workKey:workKey, campaignId:campaignId, partner:partnerName,
        titleKey:titleKey, displayCode:cat.displayCode || workDisplayCode_(cat.titleCode || titleKey),
        title:cat.title || '', productType:cat.productType || '', owner:evidence.owner,
        catalogOwner:cat.owner || '', catalogStatus:resolved.status,
        catalogCandidateCount:(resolved.candidates || []).length,
        catalogCandidates:(resolved.candidates || []).map(function(row){ return { row:row.sourceRow, title:row.title, owner:row.owner, code:row.titleCode }; }),
        brightspaceAccess:cat.brightspaceAccess || '', ccPackageAccess:cat.ccPackageAccess || '', catalogImportStatus:cat.importStatus || '',
        expectedFileName:cat.expectedFileName || ((cat.displayCode || titleKey.toUpperCase()) + '.imscc'),
        plannerLatestDate:evidence.latestDate, plannerCategories:evidence.categories, plannerRows:evidence.rows,
        scorm:{ riseCount:Number(scorm.riseCount || 0), storylineCount:Number(scorm.storylineCount || 0), linkLabel:String(scorm.linkLabel || '') },
        ctiMatchStatus:ctiMatchStatus, ctiCandidateCount:packages.length,
        ctiUuid:uuid, ctiFileName:pkg ? String(pkg.row[2] || '') : '', ctiVersion:pkg ? versionToken_(pkg.row[0]) : '',
        ctiMetrics:metrics, sourceRescanned:sourceRescanned, latestSourceScan:latestScan,
        latestRawQa:latestRawQa, rawQaFresh:rawQaFresh, rawQaRecommendation:rawQaRecommendation,
        state:state
      };
      item.existingCourseraShell = workHasExistingCourseraShell_(item);
      item.nextAction = workNextAction_(item,state);
      items.push(item);
    });

    items.sort(function(a,b){
      var ownerCompare = a.owner.localeCompare(b.owner);
      if (ownerCompare) return ownerCompare;
      var dateCompare = String(a.plannerLatestDate || '').localeCompare(String(b.plannerLatestDate || ''));
      return dateCompare || String(a.displayCode || '').localeCompare(String(b.displayCode || ''));
    });

    var unresolvedGroups = groups.filter(function(group){
      return group.unresolvedTitleCount > 0 && (!ownerFilter || workOwnerKey_(group.owner) === workOwnerKey_(ownerFilter));
    }).map(function(group){
      return {
        assignmentDate:group.assignmentDate, owner:group.owner,
        expectedTitleAssignments:group.expectedTitleAssignments,
        parsedTitleCount:group.parsedTitleCount, unresolvedTitleCount:group.unresolvedTitleCount,
        categories:group.categories, plannerRows:group.plannerRows.map(function(row){ return row.rowNumber; })
      };
    });

    var summary = {
      confirmedTitles:items.length,
      needsUpload:items.filter(function(item){ return item.nextAction.code === 'UPLOAD_SOURCE'; }).length,
      needsRescan:items.filter(function(item){ return item.nextAction.code === 'RESCAN_SOURCE'; }).length,
      needsRawAudit:items.filter(function(item){ return item.nextAction.code === 'AUDIT_EXISTING_RAW'; }).length,
      keepExistingRecommended:items.filter(function(item){ return item.nextAction.code === 'CONFIRM_KEEP_EXISTING'; }).length,
      reingestRecommended:items.filter(function(item){ return item.rawQaFresh && item.rawQaRecommendation && item.rawQaRecommendation.code === 'REINGEST'; }).length,
      scormManualReview:items.filter(function(item){ return item.nextAction.code === 'REVIEW_SCORM_EXISTING'; }).length,
      rescanned:items.filter(function(item){ return item.sourceRescanned; }).length,
      complete:items.filter(function(item){ return item.nextAction.code === 'COMPLETE'; }).length,
      excluded:items.filter(function(item){ return item.state.scope === 'EXCLUDED'; }).length,
      scormFlagged:items.filter(function(item){ return Number(item.scorm.riseCount || 0) + Number(item.scorm.storylineCount || 0) > 0; }).length,
      unresolvedPlannerSlots:unresolvedGroups.reduce(function(total,group){ return total + group.unresolvedTitleCount; },0),
      plannerExpectedAssignments:groups.reduce(function(total,group){ return total + group.expectedTitleAssignments; },0)
    };

    return {
      success:true,
      buildId:CTI_WORK_QUEUE_BUILD_ID_,
      campaign:{ id:campaignId, partner:partnerName, fromDate:fromDate, toDate:toDate, scanAfter:scanAfter },
      owners:Object.keys(owners).sort(),
      summary:summary, items:items, unresolvedGroups:unresolvedGroups,
      evidenceChecklistSteps:workEvidenceChecklistSteps_(),
      sources:{
        planner:{ id:CTI_WORK_SOURCE_CONFIG_.plannerId, sheet:CTI_WORK_SOURCE_CONFIG_.plannerSheet },
        catalog:{ id:catalog.sourceId, sheet:catalog.sourceName },
        scorm:normalizePartnerName_(partnerName) === normalizePartnerName_(CTI_WORK_SOURCE_CONFIG_.nait.partner) ? { id:CTI_WORK_SOURCE_CONFIG_.nait.scormId, sheet:CTI_WORK_SOURCE_CONFIG_.nait.scormSheet, warning:scormIndex._error || '' } : null
      }
    };
  } catch (e) {
    return { success:false, error:'Work Queue Error: ' + e.message };
  }
}

// -------------------------------------------------------------------
// DATABASE MANAGEMENT
// -------------------------------------------------------------------
var DB_SPREADSHEET_NAME = "Universal Partner Package Database";
var PACKAGES_SHEET_NAME = "Packages";
var TREE_STORE_SHEET_NAME = "Package_Trees";
var DUPLICATE_ARCHIVE_SHEET_NAME = "Duplicate_Archive";
var QA_RUNS_SHEET_NAME = "QA_Runs";
var QA_RUN_CHUNKS_SHEET_NAME = "QA_Run_Chunks";
var QA_RUN_SCHEMA_VERSION_ = 5;
var QA_RUN_CHUNK_SIZE_ = 40000;
var WORK_STATE_SHEET_NAME = "Work_State";
var PACKAGE_SCAN_HISTORY_SHEET_NAME = "Package_Scan_History";
var WORK_STATE_SCHEMA_VERSION_ = 1;
var PACKAGE_SCAN_HISTORY_SCHEMA_VERSION_ = 1;
var CTI_WORK_QUEUE_BUILD_ID_ = 'v1.6-evidence-checklist-20260919';
var CTI_WORK_DEFAULT_FROM_ = '2026-05-01';
var CTI_WORK_DEFAULT_TO_ = '2026-06-30';
var CTI_WORK_DEFAULT_SCAN_AFTER_ = '2026-09-12';
var CTI_WORK_SOURCE_CONFIG_ = {
  plannerId: '18V_aY4rNRrawo3GV-a65L-lrA4v7MvhVQsMORgnmH-M',
  plannerSheet: 'Assignments Master Planner',
  nait: {
    partner: 'Northern Alberta Institute of Technology',
    catalogId: '1Z7xpd4_75pyZsTp-mrxxDX03gAlw1zdQxZLeifIzwOc',
    catalogSheet: 'NAIT Full Catalog 2026',
    scormId: '1-DGjqyPcaKqp3mQd4_B3jRxXO2gncVTG',
    scormSheet: 'SCORM'
  },
  marshall: {
    partner: 'Marshall University',
    catalogId: '16vzyWCfp7blk1TxXgNaVLGRBlQfripZGOAAJXdLauFM',
    catalogSheet: 'Sheet1'
  }
};
var DB_SCHEMA_VERSION = "4";
var TREE_CELL_LIMIT_ = 45000;
var TREE_CHUNK_SIZE_ = 40000;

function getDatabaseSheet_() {
  var lock = LockService.getScriptLock();
  var acquiredHere = false;
  if (!lock.hasLock()) {
    if (!lock.tryLock(10000)) throw new Error("Database initialization is currently locked.");
    acquiredHere = true;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var fileId = props.getProperty('DB_FILE_ID');
    var recoveryCompleted = props.getProperty('LEGACY_RECOVERY_COMPLETED') === 'true';
    var ss = null;
    var packageSheet = null;
    var currentRecordCount = 0;

    if (fileId) {
      try {
        ss = SpreadsheetApp.openById(fileId);
        packageSheet = findPackageSheet_(ss);
        currentRecordCount = packageSheet ? Math.max(0, packageSheet.getLastRow() - 1) : 0;
      } catch (e) { ss = null; packageSheet = null; }
    }

    if (!ss || !packageSheet || (!recoveryCompleted && currentRecordCount === 0)) {
      var legacy = findBestLegacyDatabase_(ss ? ss.getId() : null);
      if (legacy && legacy.recordCount > currentRecordCount) {
        ss = legacy.spreadsheet; packageSheet = legacy.sheet;
      }
    }

    if (!ss || !packageSheet) {
      ss = SpreadsheetApp.create(DB_SPREADSHEET_NAME);
      packageSheet = ss.getSheets()[0];
      packageSheet.setName(PACKAGES_SHEET_NAME);
      initializePackageSheet_(packageSheet);
    }

    if (packageSheet.getName() !== PACKAGES_SHEET_NAME && !ss.getSheetByName(PACKAGES_SHEET_NAME)) {
      packageSheet.setName(PACKAGES_SHEET_NAME);
    }

    var needsMigration = props.getProperty('DB_SCHEMA_VERSION') !== DB_SCHEMA_VERSION ||
      packageSheet.getLastColumn() < 20 ||
      String(packageSheet.getRange(1, 19).getValue()) !== 'UUID' ||
      String(packageSheet.getRange(1, 20).getValue()) !== 'Empty Folders';
    if (needsMigration) migratePackageSheetToUuid_(packageSheet);
    props.setProperty('DB_FILE_ID', ss.getId());
    props.setProperty('DB_SCHEMA_VERSION', DB_SCHEMA_VERSION);
    props.setProperty('LEGACY_RECOVERY_COMPLETED', 'true');

    return packageSheet;
  } finally { if (acquiredHere) lock.releaseLock(); }
}

function findPackageSheet_(ss) {
  var namedSheet = ss.getSheetByName(PACKAGES_SHEET_NAME);
  if (namedSheet && hasPackageHeaders_(namedSheet)) return namedSheet;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (hasPackageHeaders_(sheets[i])) return sheets[i];
  }
  return null;
}

function hasPackageHeaders_(sheet) {
  if (!sheet || sheet.getLastColumn() < 3 || sheet.getLastRow() < 1) return false;
  var headers = sheet.getRange(1, 1, 1, 3).getDisplayValues()[0];
  return headers[0] === "Timestamp" && headers[1] === "University/Partner" && headers[2] === "File Name";
}

function findBestLegacyDatabase_(excludedFileId) {
  var files = DriveApp.getFilesByName(DB_SPREADSHEET_NAME);
  var best = null;
  while (files.hasNext()) {
    var file = files.next();
    if (excludedFileId && file.getId() === excludedFileId) continue;
    try {
      var candidateSs = SpreadsheetApp.open(file);
      var candidateSheet = findPackageSheet_(candidateSs);
      if (!candidateSheet) continue;
      var recordCount = Math.max(0, candidateSheet.getLastRow() - 1);
      if (!best || recordCount > best.recordCount) {
        best = { spreadsheet: candidateSs, sheet: candidateSheet, recordCount: recordCount };
      }
    } catch (e) {}
  }
  return best;
}

function initializePackageSheet_(sheet) {
  var headers = [[ "Timestamp", "University/Partner", "File Name", "Modules", "WebContent", "Quizzes & Assignments", "Discussions", "Web Links", "LTI Risk Items", "Unknown Items", "File Extensions", "Assessment Names", "Course Tree JSON", "Assigned Date", "Owner", "Deadline", "Status", "Drive Link", "UUID", "Empty Folders" ]];
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  sheet.getRange("1:1").setFontWeight("bold").setBackground("#f1f3f4");
}

function getTreeStoreSheet_(ss) {
  var sheet = ss.getSheetByName(TREE_STORE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TREE_STORE_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([["Tree Key", "Chunk Index", "Base64 JSON Chunk"]]);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#f1f3f4");
    try { sheet.hideSheet(); } catch (e) {}
  }
  return sheet;
}

function removeStoredCourseTree_(ss, treeKey) {
  var sheet = ss.getSheetByName(TREE_STORE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var runs = [], runStart = null, runEnd = null;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === treeKey) {
      var sheetRow = i + 2;
      if (runStart === null) runStart = runEnd = sheetRow;
      else if (sheetRow === runEnd + 1) runEnd = sheetRow;
      else { runs.push([runStart, runEnd]); runStart = runEnd = sheetRow; }
    }
  }
  if (runStart !== null) runs.push([runStart, runEnd]);
  for (var r = runs.length - 1; r >= 0; r--) sheet.deleteRows(runs[r][0], runs[r][1] - runs[r][0] + 1);
}

function prepareCourseTreeCell_(ss, uuid, treeJson) {
  treeJson = String(treeJson || "[]");
  if (treeJson.length > 5000000) throw new Error("Course structure exceeds the 5 MB storage safety limit.");
  if (treeJson.length <= TREE_CELL_LIMIT_) return treeJson;
  var treeKey = uuid + '_' + Utilities.getUuid();
  var encoded = Utilities.base64Encode(Utilities.newBlob(treeJson).getBytes());
  var rows = [];
  for (var offset = 0, index = 0; offset < encoded.length; offset += TREE_CHUNK_SIZE_, index++) {
    rows.push([treeKey, index, encoded.slice(offset, offset + TREE_CHUNK_SIZE_)]);
  }
  var treeSheet = getTreeStoreSheet_(ss);
  treeSheet.getRange(treeSheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  return "TREE:" + treeKey;
}

function loadTreeStoreMap_(ss) {
  var sheet = ss.getSheetByName(TREE_STORE_SHEET_NAME);
  var result = Object.create(null);
  if (!sheet || sheet.getLastRow() < 2) return result;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  rows.forEach(function(row) {
    var uuid = String(row[0] || ""), index = Number(row[1]), chunk = String(row[2] || "");
    if (!uuid || !Number.isInteger(index)) return;
    if (!result[uuid]) result[uuid] = [];
    result[uuid][index] = chunk;
  });
  Object.keys(result).forEach(function(uuid) {
    try {
      var bytes = Utilities.base64Decode(result[uuid].join(""));
      result[uuid] = Utilities.newBlob(bytes).getDataAsString();
    } catch (e) { result[uuid] = ""; }
  });
  return result;
}

function resolveCourseTreeJson_(ss, uuid, cellValue, treeStoreMap) {
  var value = String(cellValue || "");
  if (value.indexOf("TREE:") !== 0) return value || "[]";
  var map = treeStoreMap || loadTreeStoreMap_(ss);
  return map[value.slice(5)] || "";
}