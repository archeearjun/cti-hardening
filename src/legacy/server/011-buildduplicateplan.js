

function buildDuplicatePlan_(data) {
  var grouped = Object.create(null);
  for (var dataIndex = 1; dataIndex < data.length; dataIndex++) {
    var row = data[dataIndex].slice(0, 20);
    while (row.length < 20) row.push("");
    var partnerKey = normalizePartnerName_(row[1]);
    var canonicalKey = packageSemanticKey_(row[2]);
    if (!partnerKey || !canonicalKey) continue;
    var groupKey = partnerKey + "\u0000" + canonicalKey;
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push({ rowNumber: dataIndex + 1, row: row, uuid: String(row[18] || ""), version: versionToken_(row[0]), fileName: String(row[2] || "") });
  }

  var groups = [];
  Object.keys(grouped).forEach(function(groupKey) {
    var records = grouped[groupKey];
    if (records.length < 2) return;
    var canonicalKey = packageSemanticKey_(records[0].row[2]);
    var unsuffixed = records.filter(function(record) { return normalizeFileName_(record.row[2], false) === normalizeFileName_(canonicalDisplayFileName_(record.row[2]), false); });
    var survivor = chooseOldestDuplicateRecord_(unsuffixed.length ? unsuffixed : records);
    var latestScan = chooseLatestDuplicateRecord_(records);
    var metadata = mergeDuplicateMetadata_(records, survivor);
    var fingerprints = Object.create(null);
    records.forEach(function(record) { fingerprints[duplicateScanFingerprint_(record.row)] = true; });
    var archiveRecords = records.filter(function(record) { return record.rowNumber !== survivor.rowNumber; });
    groups.push({ id: duplicateDigest_(groupKey), groupKey: groupKey, partner: String(survivor.row[1] || ""), canonicalName: canonicalDisplayFileName_(survivor.row[2]), survivor: survivor, latestScan: latestScan, archiveRecords: archiveRecords, metadataValues: metadata.values, conflictFields: metadata.conflicts, safeToArchive: metadata.conflicts.length === 0, scanDataDiffers: Object.keys(fingerprints).length > 1 });
  });

  groups.sort(function(a, b) { var partnerCompare = a.partner.localeCompare(b.partner); return partnerCompare || a.canonicalName.localeCompare(b.canonicalName); });
  var tokenData = groups.map(function(group) { return { id: group.id, survivor: group.survivor.uuid + ":" + group.survivor.version, archive: group.archiveRecords.map(function(record) { return record.uuid + ":" + record.version; }), conflicts: group.conflictFields }; });
  return { groups: groups, planToken: duplicateDigest_(JSON.stringify(tokenData)), duplicateEntryCount: groups.reduce(function(total, group) { return total + group.archiveRecords.length; }, 0), safeGroupCount: groups.filter(function(group) { return group.safeToArchive; }).length };
}

function duplicateGroupForClient_(group) {
  return { id: group.id, partner: group.partner, canonicalName: group.canonicalName, safeToArchive: group.safeToArchive, conflictFields: group.conflictFields, scanDataDiffers: group.scanDataDiffers, survivor: { uuid: group.survivor.uuid, fileName: group.survivor.fileName, updatedAt: duplicateDisplayTimestamp_(group.survivor.row[0]) }, latestScan: { uuid: group.latestScan.uuid, fileName: group.latestScan.fileName, updatedAt: duplicateDisplayTimestamp_(group.latestScan.row[0]) }, archive: group.archiveRecords.map(function(record) { return { uuid: record.uuid, fileName: record.fileName, updatedAt: duplicateDisplayTimestamp_(record.row[0]) }; }) };
}

function getDuplicateEntryPreview() {
  authorize_();
  try {
    var sheet = getDatabaseSheet_();
    var data = sheet.getDataRange().getValues();
    var plan = buildDuplicatePlan_(data);
    return { success: true, planToken: plan.planToken, groupCount: plan.groups.length, duplicateEntryCount: plan.duplicateEntryCount, safeGroupCount: plan.safeGroupCount, groups: plan.groups.map(duplicateGroupForClient_) };
  } catch (e) { return { success: false, error: "Duplicate Preview Error: " + e.message }; }
}

function getDuplicateArchiveSheet_(ss) {
  var headers = [ "Timestamp", "University/Partner", "File Name", "Modules", "WebContent", "Quizzes & Assignments", "Discussions", "Web Links", "LTI Risk Items", "Unknown Items", "File Extensions", "Assessment Names", "Course Tree JSON", "Assigned Date", "Owner", "Deadline", "Status", "Drive Link", "UUID", "Empty Folders", "Archived At", "Archived By", "Survivor UUID", "Duplicate Group", "Archive Action" ];
  var sheet = ss.getSheetByName(DUPLICATE_ARCHIVE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DUPLICATE_ARCHIVE_SHEET_NAME);
    if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#FEF3C7");
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() > 0) {
    var existing = sheet.getRange(1, 1, 1, Math.min(headers.length, sheet.getLastColumn())).getDisplayValues()[0];
    if (existing[0] !== headers[0] || existing[20] !== headers[20]) throw new Error("The existing Duplicate_Archive sheet has an unexpected layout.");
  }
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  return sheet;
}

function duplicateArchiveRow_(record, archivedAt, archivedBy, survivorUuid, groupName, action) {
  var row = record.row.slice(0, 20).map(function(value) { return typeof value === "string" ? sheetSafeText_(value) : value; });
  return row.concat([ archivedAt, sheetSafeText_(archivedBy), survivorUuid, groupName, action ]);
}

function archiveDuplicateEntries(groupIds, expectedPlanToken) {
  var editorEmail = authorize_('editor');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, error: "Database locked." };

  try {
    if (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.length > 200) return { success: false, error: "Select at least one duplicate group." };
    var selectedIds = Object.create(null);
    groupIds.forEach(function(id) {
      var safeId = String(id || "");
      if (!/^[0-9a-f]{64}$/.test(safeId)) throw new Error("Invalid duplicate group identifier.");
      selectedIds[safeId] = true;
    });

    var sheet = getDatabaseSheet_();
    var data = sheet.getDataRange().getValues();
    var plan = buildDuplicatePlan_(data);
    if (!expectedPlanToken || String(expectedPlanToken) !== plan.planToken) return { success: false, error: "The package database changed after the preview loaded. Review duplicates again." };

    var groupsToClean = plan.groups.filter(function(group) { return selectedIds[group.id]; });
    if (groupsToClean.length !== Object.keys(selectedIds).length) return { success: false, error: "One or more selected duplicate groups no longer exist." };
    var blocked = groupsToClean.filter(function(group) { return !group.safeToArchive; });
    if (blocked.length) return { success: false, error: "Metadata conflicts must be reviewed before those duplicate groups can be archived." };

    var archivedAt = new Date(), archiveRows = [], survivorUpdates = [], rowsToDelete = [];

    groupsToClean.forEach(function(group) {
      archiveRows.push(duplicateArchiveRow_(group.survivor, archivedAt, editorEmail, group.survivor.uuid, group.partner + " / " + group.canonicalName, "SURVIVOR_BEFORE_MERGE"));
      group.archiveRecords.forEach(function(record) {
        archiveRows.push(duplicateArchiveRow_(record, archivedAt, editorEmail, group.survivor.uuid, group.partner + " / " + group.canonicalName, "DUPLICATE_REMOVED"));
        rowsToDelete.push(record.rowNumber);
      });
      var mergedRow = group.survivor.row.slice(0, 20), newestRow = group.latestScan.row;
      mergedRow[0] = archivedAt;
      for (var scanIndex = 3; scanIndex <= 12; scanIndex++) mergedRow[scanIndex] = newestRow[scanIndex];
      mergedRow[13] = group.metadataValues[13]; mergedRow[14] = group.metadataValues[14]; mergedRow[15] = group.metadataValues[15]; mergedRow[16] = group.metadataValues[16]; mergedRow[17] = group.metadataValues[17];
      mergedRow[19] = newestRow[19]; mergedRow[1] = group.survivor.row[1]; mergedRow[2] = group.survivor.row[2]; mergedRow[18] = group.survivor.uuid;
      survivorUpdates.push({ rowNumber: group.survivor.rowNumber, values: mergedRow });
    });

    var archiveSheet = getDuplicateArchiveSheet_(sheet.getParent());
    if (archiveRows.length) {
      var archiveStartRow = archiveSheet.getLastRow() + 1;
      var requiredArchiveLastRow = archiveStartRow + archiveRows.length - 1;
      if (archiveSheet.getMaxRows() < requiredArchiveLastRow) archiveSheet.insertRowsAfter(archiveSheet.getMaxRows(), requiredArchiveLastRow - archiveSheet.getMaxRows());
      archiveSheet.getRange(archiveStartRow, 1, archiveRows.length, archiveRows[0].length).setValues(archiveRows);
    }
    survivorUpdates.forEach(function(update) { sheet.getRange(update.rowNumber, 1, 1, 20).setValues([update.values]); });
    rowsToDelete.sort(function(a, b) { return b - a; }).forEach(function(rowNumber) { sheet.deleteRow(rowNumber); });

    SpreadsheetApp.flush();
    invalidateAnalyticsCache_();
    return { success: true, cleanedGroups: groupsToClean.length, archivedDuplicates: rowsToDelete.length, message: rowsToDelete.length + " duplicate entr" + (rowsToDelete.length === 1 ? "y was" : "ies were") + " moved to Duplicate_Archive." };
  } catch (e) { return { success: false, error: "Duplicate Cleanup Error: " + e.message }; } finally { lock.releaseLock(); }
}

function recordSiteVisit() {
  authorize_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, error: "System busy." };
  try {
    var ss = getDatabaseSheet_().getParent();
    var analyticsSheet = ss.getSheetByName("App_Analytics");
    if (!analyticsSheet) {
      analyticsSheet = ss.insertSheet("App_Analytics");
      analyticsSheet.appendRow(["Total App Loads", "Last Loaded Timestamp"]);
      analyticsSheet.getRange("1:1").setFontWeight("bold").setBackground("#e6f4ea");
      analyticsSheet.getRange("A2").setValue(0);
    }
    var currentCount = Number(analyticsSheet.getRange("A2").getValue()) || 0;
    currentCount++;
    analyticsSheet.getRange("A2").setValue(currentCount);
    analyticsSheet.getRange("B2").setValue(new Date());
    return { success: true, count: currentCount };
  } catch (e) { return { success: false, error: "Telemetry Error: " + e.message }; } finally { lock.releaseLock(); }
}

function savePackageAuditToDb(partnerName, assignedDate, owner, deadline, status, driveLink, payload, overwrite) {
  authorize_('editor');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: "Database is currently locked by another process." };
  try {
    if (!partnerName || partnerName.trim() === "") return { success: false, error: "Please select a Partner name." };
    if (!payload || !payload.stats || !payload.fileName) return { success: false, error: "Invalid package payload." };
    overwrite = overwrite === true;
    var sheet = getDatabaseSheet_();
    
    var extLogObj = payload.fileExtensionsLog || {};
    extLogObj._advanced = { orphans: payload.stats.orphans, ttr: payload.stats.lexicalTTR, lexicalTokenCount:nonNegativeInteger_(payload.stats.lexicalTokenCount), lexicalUniqueCount:nonNegativeInteger_(payload.stats.lexicalUniqueCount), lexicalContextReliable:payload.stats.lexicalContextReliable === true, repeatedTitleRatio:Number(payload.stats.repeatedTitleRatio || 0), zScores: payload.stats.zScoreImbalances, interactiveRuntimeCandidates: nonNegativeInteger_(payload.stats.interactiveRuntimeCandidates), scormLikeCandidates: nonNegativeInteger_(payload.stats.scormLikeCandidates), practiceJsonDependencies: nonNegativeInteger_(payload.stats.practiceJsonDependencies) };
    var extStr = JSON.stringify(extLogObj);
    var qtiStr = sheetSafeText_((payload.qtiNames || []).join(", "));
    var treeJson = JSON.stringify(payload.courseTree || []);
    var combinedAssessments = nonNegativeInteger_(payload.stats.quizzes) + nonNegativeInteger_(payload.stats.assignments);
    var uuid = Utilities.getUuid();

    assignedDate = validateDateOnly_(assignedDate, "Assigned Date");
    deadline = validateDateOnly_(deadline, "Deadline");
    status = validateStatus_(status);
    driveLink = validateDriveLink_(driveLink);

    var rowData = [ new Date(), sheetSafeText_(partnerName.trim()), sheetSafeText_(payload.fileName), nonNegativeInteger_(payload.moduleCount), nonNegativeInteger_(payload.stats.webcontent), combinedAssessments, nonNegativeInteger_(payload.stats.discussions), nonNegativeInteger_(payload.stats.weblinks), nonNegativeInteger_(payload.stats.lti), nonNegativeInteger_(payload.stats.unknown), extStr, qtiStr, "", assignedDate, sheetSafeText_(owner), deadline, status, driveLink, uuid, nonNegativeInteger_(payload.stats.emptyFolders) ];

    var data = sheet.getDataRange().getValues();
    var matchingRows = [];
    var normalizedPartner = normalizePartnerName_(partnerName);
    var normalizedFileName = packageSemanticKey_(payload.fileName);
    for (var i = 1; i < data.length; i++) {
      if (normalizePartnerName_(data[i][1]) === normalizedPartner && packageSemanticKey_(data[i][2]) === normalizedFileName) matchingRows.push(i);
    }
    if (matchingRows.length > 1) return { success: false, error: "Multiple saved entries match this partner and filename. Use Review Duplicate Entries before saving." };
    if (matchingRows.length === 1 && !overwrite) return { success: false, duplicateDetected: true, error: "A matching package already exists. Refresh the dashboard and update its existing UUID instead of creating another entry." };
    if (overwrite && matchingRows.length === 1) {
      var matchingIndex = matchingRows[0];
      var existingRow = data[matchingIndex];
      var existingUuid = existingRow[18] || Utilities.getUuid();
      var updatedTreeCell = prepareCourseTreeCell_(sheet.getParent(), existingUuid, treeJson);
      var updatedRow = [ new Date(), existingRow[1], existingRow[2], nonNegativeInteger_(payload.moduleCount), nonNegativeInteger_(payload.stats.webcontent), combinedAssessments, nonNegativeInteger_(payload.stats.discussions), nonNegativeInteger_(payload.stats.weblinks), nonNegativeInteger_(payload.stats.lti), nonNegativeInteger_(payload.stats.unknown), extStr, qtiStr, updatedTreeCell, existingRow[13], existingRow[14], existingRow[15], existingRow[16], existingRow[17], existingUuid, nonNegativeInteger_(payload.stats.emptyFolders) ];
      sheet.getRange(matchingIndex + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
      removeTreeCellStorage_(sheet.getParent(), existingRow[12]);
      var overwriteHistory = appendPackageScanHistory_(sheet.getParent(), existingUuid, 'OVERWRITE_SCAN', existingRow[2], workPackageMetricsFromRow_(existingRow), workPackageMetricsFromPayload_(payload));
      invalidateAnalyticsCache_();
      return { success: true, message: "Updated existing database record for " + existingRow[2] + "; its UUID and manual details were preserved.", scanHistory: overwriteHistory };
    }

    rowData[12] = prepareCourseTreeCell_(sheet.getParent(), uuid, treeJson);
    sheet.appendRow(rowData);
    var initialHistory = appendPackageScanHistory_(sheet.getParent(), uuid, 'INITIAL_SAVE', payload.fileName, null, workPackageMetricsFromPayload_(payload));
    invalidateAnalyticsCache_();
    return { success: true, message: "Saved new record to database for " + partnerName, scanHistory: initialHistory };
  } catch (e) { return { success: false, error: "Database Save Error: " + e.message }; } finally { lock.releaseLock(); }
}

function updatePackageInDb(targetUuid, payload, expectedVersion) {
  authorize_('editor');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: "Database locked." };
  try {
    targetUuid = validateUuid_(targetUuid);
    var sheet = getDatabaseSheet_();
    var data = sheet.getDataRange().getValues();
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) { if (data[i][18] === targetUuid) { rowIndex = i + 1; break; } }
    if (rowIndex === -1) return { success: false, error: "Record not found for UUID." };
    if (!payload || !payload.stats) return { success: false, error: "Invalid package payload." };

    var existingRow = data[rowIndex - 1];
    assertCurrentVersion_(existingRow[0], expectedVersion);

    var extLogObj = payload.fileExtensionsLog || {};
    extLogObj._advanced = { orphans: payload.stats.orphans, ttr: payload.stats.lexicalTTR, lexicalTokenCount:nonNegativeInteger_(payload.stats.lexicalTokenCount), lexicalUniqueCount:nonNegativeInteger_(payload.stats.lexicalUniqueCount), lexicalContextReliable:payload.stats.lexicalContextReliable === true, repeatedTitleRatio:Number(payload.stats.repeatedTitleRatio || 0), zScores: payload.stats.zScoreImbalances, interactiveRuntimeCandidates: nonNegativeInteger_(payload.stats.interactiveRuntimeCandidates), scormLikeCandidates: nonNegativeInteger_(payload.stats.scormLikeCandidates), practiceJsonDependencies: nonNegativeInteger_(payload.stats.practiceJsonDependencies) };
    var extStr = JSON.stringify(extLogObj);
    var qtiStr = sheetSafeText_((payload.qtiNames || []).join(", "));
    var treeJson = JSON.stringify(payload.courseTree || []);
    var combinedAssessments = nonNegativeInteger_(payload.stats.quizzes) + nonNegativeInteger_(payload.stats.assignments);
    var treeCell = prepareCourseTreeCell_(sheet.getParent(), targetUuid, treeJson);
    var rowData = [ new Date(), existingRow[1], existingRow[2], nonNegativeInteger_(payload.moduleCount), nonNegativeInteger_(payload.stats.webcontent), combinedAssessments, nonNegativeInteger_(payload.stats.discussions), nonNegativeInteger_(payload.stats.weblinks), nonNegativeInteger_(payload.stats.lti), nonNegativeInteger_(payload.stats.unknown), extStr, qtiStr, treeCell, existingRow[13], existingRow[14], existingRow[15], existingRow[16], existingRow[17], targetUuid, nonNegativeInteger_(payload.stats.emptyFolders) ];
    
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    removeTreeCellStorage_(sheet.getParent(), existingRow[12]);
    var scanHistoryResult = appendPackageScanHistory_(sheet.getParent(), targetUuid, 'RESCAN', existingRow[2], workPackageMetricsFromRow_(existingRow), workPackageMetricsFromPayload_(payload));
    invalidateAnalyticsCache_();
    return { success: true, message: "Record re-scanned successfully; existing metadata and filename were preserved.", scanHistory: scanHistoryResult };
  } catch (e) { return { success: false, error: "Update Error: " + e.message }; } finally { lock.releaseLock(); }
}

function updatePackageMetadataInDb(targetUuid, partnerName, assignedDate, owner, deadline, status, driveLink, expectedVersion) {
  authorize_('editor');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: "Database locked." };
  try {
    targetUuid = validateUuid_(targetUuid);
    var sheet = getDatabaseSheet_();
    var data = sheet.getDataRange().getValues();
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) { if (data[i][18] === targetUuid) { rowIndex = i + 1; break; } }
    if (rowIndex === -1) return { success: false, error: "Record not found." };
    assertCurrentVersion_(data[rowIndex - 1][0], expectedVersion);

    var safePartnerName = String(partnerName || "").trim();
    if (!safePartnerName) return { success: false, error: "Partner name is required." };
    assignedDate = validateDateOnly_(assignedDate, "Assigned Date");
    deadline = validateDateOnly_(deadline, "Deadline");
    status = validateStatus_(status);
    driveLink = validateDriveLink_(driveLink);

    sheet.getRange(rowIndex, 1).setValue(new Date());
    sheet.getRange(rowIndex, 2).setValue(sheetSafeText_(safePartnerName));
    sheet.getRange(rowIndex, 14, 1, 5).setValues([[assignedDate, sheetSafeText_(owner), deadline, status, driveLink]]);
    invalidateAnalyticsCache_();
    return { success: true, message: "Metadata updated successfully." };
  } catch (e) { return { success: false, error: "Metadata Update Error: " + e.message }; } finally { lock.releaseLock(); }
}

function deletePackageFromDb(targetUuid, expectedVersion) {
  authorize_('editor');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: "Database locked." };
  try {
    targetUuid = validateUuid_(targetUuid);
    var sheet = getDatabaseSheet_();
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][18] === targetUuid) {
        assertCurrentVersion_(data[i][0], expectedVersion);
        removeTreeCellStorage_(sheet.getParent(), data[i][12]);
        sheet.deleteRow(i + 1);
        invalidateAnalyticsCache_();
        return { success: true, message: "Record deleted successfully." };
      }
    }
    return { success: false, error: "Record not found." };
  } catch (e) { return { success: false, error: "Database Delete Error: " + e.message }; } finally { lock.releaseLock(); }
}

function getPartnerAnalyticsDb() {
  authorize_();
  try {
    var sheet = getDatabaseSheet_();
    var cache = CacheService.getScriptCache();
    var cached = cache.get("PARTNER_ANALYTICS_V7");
    if (cached) { try { return JSON.parse(cached); } catch (cacheError) {} }
    
    var data = sheet.getDataRange().getValues();
    var duplicatePlan = buildDuplicatePlan_(data);
    var duplicateSummary = { groupCount: duplicatePlan.groups.length, duplicateEntryCount: duplicatePlan.duplicateEntryCount, safeGroupCount: duplicatePlan.safeGroupCount };
    if (data.length < 2) return { success: true, partners: {}, owners: [], totalPackages: 0, duplicateSummary: duplicateSummary };

    var partners = Object.create(null);
    var ownersSet = Object.create(null);
    var catalogMap = loadCatalogMap_(sheet.getParent());
    var ownerColUpdates = [];
    var dbChanged = false;

    for (var i = 1; i < data.length; i++) {
      var partner = data[i][1], fileName = data[i][2];
      var modules = Number(data[i][3]) || 0, webcontent = Number(data[i][4]) || 0, combinedAssessments = Number(data[i][5]) || 0;
      var discussions = Number(data[i][6]) || 0, weblinks = Number(data[i][7]) || 0, lti = Number(data[i][8]) || 0, unknown = Number(data[i][9]) || 0;
      var uuid = data[i][18], emptyFolders = nonNegativeInteger_(data[i][19]);
      
      var assignedDate = "", deadline = "", status = data[i][16] || "In Queue", driveLink = data[i][17] || "";
      if (data[i][13]) { var d = data[i][13]; assignedDate = (Object.prototype.toString.call(d) === '[object Date]') ? Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(d).split('T')[0]; }
      if (data[i][15]) { var d2 = data[i][15]; deadline = (Object.prototype.toString.call(d2) === '[object Date]') ? Utilities.formatDate(d2, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(d2).split('T')[0]; }
      
      var owner = data[i][14] ? String(data[i][14]).trim() : "";
      var matchKey = getMatchKey_(fileName);
      var realTitle = "";
      
      if (catalogMap[matchKey]) {
          realTitle = catalogMap[matchKey].title;
          var catOwner = catalogMap[matchKey].owner;
          if (catOwner && catOwner !== owner) {
              owner = catOwner;
              data[i][14] = catOwner; 
              dbChanged = true;
          }
      }
      ownerColUpdates.push([owner]);
      if (owner) ownersSet[owner] = true; 

      if (!partners[partner]) {
        partners[partner] = { packageCount: 0, totalModules: 0, totalWebContent: 0, totalQuizzes: 0, totalDiscussions: 0, totalWebLinks: 0, totalLtiRisk: 0, totalUnknown: 0, totalEmpty: 0, totalIFS: 0, avgIFS: 0, packages: [] };
      }

      var riskMetrics = computeRiskMetrics_(webcontent, combinedAssessments, discussions, weblinks, lti, unknown, emptyFolders);
      var orphans = 0, zScores = [], lexicalTTR = 0, lexicalTokenCount = 0, lexicalContextReliable = false, repeatedTitleRatio = 0, interactiveRuntimeCandidates = 0, scormLikeCandidates = 0, practiceJsonDependencies = 0;
      try { if (data[i][10]) { var extLogObj = JSON.parse(data[i][10]); if (extLogObj._advanced) { orphans = extLogObj._advanced.orphans || 0; zScores = extLogObj._advanced.zScores || []; lexicalTTR = extLogObj._advanced.ttr || 0; lexicalTokenCount = nonNegativeInteger_(extLogObj._advanced.lexicalTokenCount); lexicalContextReliable = extLogObj._advanced.lexicalContextReliable === true; repeatedTitleRatio = Number(extLogObj._advanced.repeatedTitleRatio || 0); interactiveRuntimeCandidates = nonNegativeInteger_(extLogObj._advanced.interactiveRuntimeCandidates); scormLikeCandidates = nonNegativeInteger_(extLogObj._advanced.scormLikeCandidates); practiceJsonDependencies = nonNegativeInteger_(extLogObj._advanced.practiceJsonDependencies); } } } catch(e) {}

      partners[partner].packageCount++; partners[partner].totalModules += modules; partners[partner].totalWebContent += webcontent; partners[partner].totalQuizzes += combinedAssessments; partners[partner].totalDiscussions += discussions; partners[partner].totalWebLinks += weblinks; partners[partner].totalLtiRisk += lti; partners[partner].totalUnknown += unknown; partners[partner].totalEmpty += emptyFolders; partners[partner].totalIFS += riskMetrics.ifs;

      partners[partner].packages.push({ 
        name: fileName, realTitle: realTitle, uuid: uuid, version: versionToken_(data[i][0]), ifs: riskMetrics.ifs, empty: emptyFolders, 
        date: assignedDate, owner: owner, deadline: deadline, status: status, lti: lti, driveLink: driveLink,
        totalItems: riskMetrics.totalItems, quizzes: combinedAssessments, discussions: discussions, weblinks: weblinks, webcontent: webcontent, unknown: unknown,
        isBoilerplate: riskMetrics.isBoilerplate, ifsPerItem:riskMetrics.ifsPerItem, ifsVersion:riskMetrics.ifsVersion, orphans: orphans, zScores: zScores, lexicalTTR: lexicalTTR, lexicalTokenCount:lexicalTokenCount, lexicalContextReliable:lexicalContextReliable, repeatedTitleRatio:repeatedTitleRatio,
        interactiveRuntimeCandidates: interactiveRuntimeCandidates, scormLikeCandidates: scormLikeCandidates, practiceJsonDependencies: practiceJsonDependencies
      });
    }
    
    if (dbChanged) sheet.getRange(2, 15, ownerColUpdates.length, 1).setValues(ownerColUpdates);

    for (var p in partners) partners[p].avgIFS = Math.round(partners[p].totalIFS / partners[p].packageCount);
    
    var result = { success: true, partners: partners, owners: Object.keys(ownersSet).sort(), totalPackages: data.length - 1, duplicateSummary: duplicateSummary };
    try { cache.put("PARTNER_ANALYTICS_V7", JSON.stringify(result), 300); } catch (cacheError) {}
    return result;
  } catch (e) { return { success: false, error: "Database Fetch Error: " + e.message }; }
}