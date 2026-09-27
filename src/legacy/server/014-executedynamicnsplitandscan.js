

function executeDynamicNSplitAndScan(fileId, anchorRows, specNames, partnerName, approvedGrayItems, workflowMode) {
  authorize_('editor');
  return executeDynamicNSplitAndScanCore_(fileId, anchorRows, specNames, partnerName, approvedGrayItems, workflowMode, ctiWorkflowIo_());
}

// Deterministic workflow; storage is supplied explicitly by the host.
function executeDynamicNSplitAndScanCore_(fileId, anchorRows, specNames, partnerName, approvedGrayItems, workflowMode, io) {
  try {
    io.validateWorkbook(fileId);
    if (!Array.isArray(anchorRows) || !Array.isArray(specNames) || anchorRows.length !== specNames.length) return { success: false, error: "Split anchors and specialization names must have matching lengths." };
    if (anchorRows.length < 1 || anchorRows.length > 4) return { success: false, error: "Choose between 1 and 4 specializations." };
    var ss = io.openWorkbook(fileId), sheet = ss.getSheetByName('export') || ss.getSheets()[0], data = sheet.getDataRange().getValues();
    if (!data || data.length < 2) return { success: false, error: "The master spreadsheet contains no data rows." };
    var headers = data[0], normalizedHeaders = headers.map(function(header) { return String(header).trim().toLowerCase(); });
    var levelIdx = normalizedHeaders.indexOf('level'), nameIdx = normalizedHeaders.indexOf('name'), toolIdx = normalizedHeaders.indexOf('assignment_tool');
    var nodeTypeIdx = normalizedHeaders.indexOf('node_type'), pathIdx = normalizedHeaders.indexOf('path');
    if (levelIdx === -1 || nameIdx === -1) return { success: false, error: "Required Level and Name columns are missing." };

    var indices = [];
    for (var a = 0; a < anchorRows.length; a++) {
      var excelRow = Number(anchorRows[a]), dataIndex = excelRow - 1;
      if (!Number.isInteger(excelRow) || dataIndex < 1 || dataIndex >= data.length) return { success: false, error: "Invalid anchor row for Specialization " + (a + 1) + "." };
      if (Number(data[dataIndex][levelIdx]) !== 1) return { success: false, error: "Anchor row " + excelRow + " is not a Level 1 module." };
      if (indices.length && dataIndex <= indices[indices.length - 1]) return { success: false, error: "Specialization anchors must be unique and ordered from top to bottom." };
      indices.push(dataIndex);
    }

    var numSpecs = indices.length, safePartnerName = partnerName ? partnerName.replace(/[^a-zA-Z0-9_\-]/g, '_') + "_" : "";
    var isMacmillan = String(workflowMode || '').toLowerCase() === 'macmillan' || !!(partnerName && partnerName.toLowerCase().indexOf('macmillan') > -1);
    var totalMasterDataRows = data.length - 1, foundation = data.slice(1, indices[0]), foundationRows = foundation.length;
    var isDryRun = approvedGrayItems === null || approvedGrayItems === undefined, approvedItems = Array.isArray(approvedGrayItems) ? approvedGrayItems : [];
    var triageData = [], pendingSpecs = [];
    var timeIndices = { levelIdx: levelIdx, nameIdx: nameIdx, toolIdx: toolIdx, nodeTypeIdx: nodeTypeIdx };

    for (var s = 0; s < numSpecs; s++) {
      var startIdx = indices[s], endIdx = s === numSpecs - 1 ? data.length : indices[s + 1], specSlice = data.slice(startIdx, endIdx);
      var fullSpecData = [], contextData = [], specGrayItems = [], specExcludedItems = [], timeRuleCounts = Object.create(null);
      if (isMacmillan) {
        fullSpecData.push(['Module No.', 'Module Name', 'Module Description', 'Time Estimate', 'Learning Objectives']);
        contextData.push(['Module No.', 'Module Name', 'Source Level', 'Node Type', 'Item Name', 'Source Tool', 'Deterministic Minutes', 'Time Rule', 'Use for Metadata', 'Source Path']);
        var combinedRaw = foundation.concat(specSlice), currentMod = null, modCounter = 1;

        var flushCurrentModule_ = function() {
          if (!currentMod) return;
          fullSpecData.push([currentMod.num, currentMod.name, "", currentMod.time, ""]);
          modCounter++;
          currentMod = null;
        };

        for (var r = 0; r < combinedRaw.length; r++) {
          var row = combinedRaw[r], lvl = Number(row[levelIdx]);
          var rName = String(row[nameIdx] || "").replace(/^[^\w]+/, '').trim();
          var rNameLow = rName.toLowerCase();

          if (lvl === 1) {
            flushCurrentModule_();
            var isAutoInclude = /^(chapter|ch\b|spotlight|module|lesson|unit|part|section)/i.test(rNameLow);
            var isStrictExclude = /(instructor|appendix|appendices|welcome|glossary|index|survey|about this book|back matter|front matter|teaching materials|selected answers)/i.test(rNameLow);

            if (isAutoInclude && !isStrictExclude) {
              currentMod = { num: modCounter, name: rName, time: 0 };
            } else {
              if (isDryRun) {
                if (specGrayItems.indexOf(rName) === -1) specGrayItems.push(rName);
                currentMod = { num: modCounter, name: rName, time: 0 };
              } else if (approvedItems.indexOf(rName) > -1) {
                currentMod = { num: modCounter, name: rName, time: 0 };
              } else {
                currentMod = null;
                if (rName && specExcludedItems.indexOf(rName) === -1) specExcludedItems.push(rName);
              }
            }
          } else if (lvl > 1 && currentMod) {
            var estimate = macmillanEstimateItemTime_(row, timeIndices);
            currentMod.time += Number(estimate.minutes || 0);
            var timeRuleKey = String(estimate.rule || 'unknown');
            timeRuleCounts[timeRuleKey] = (timeRuleCounts[timeRuleKey] || 0) + 1;
            var nodeType = nodeTypeIdx !== -1 ? String(row[nodeTypeIdx] || '').trim() : '';
            var toolStr = toolIdx !== -1 ? String(row[toolIdx] || '').trim() : '';
            var pathValue = pathIdx !== -1 ? String(row[pathIdx] || '').trim() : '';
            contextData.push([
              currentMod.num, currentMod.name, lvl, nodeType, rName, toolStr,
              Number(estimate.minutes || 0), estimate.rule || '', estimate.useForMetadata ? 'YES' : 'NO', pathValue
            ]);
          }
        }
        flushCurrentModule_();
        if (isDryRun && specGrayItems.length > 0) triageData.push({ specNum: s + 1, specName: specNames[s], items: specGrayItems });
      } else {
        fullSpecData = [headers].concat(foundation, specSlice);
      }
      pendingSpecs.push({
        fullSpecData: fullSpecData,
        contextData: contextData,
        specSlice: specSlice,
        startIdx: startIdx,
        specExcludedItems: specExcludedItems,
        timeRuleCounts: timeRuleCounts
      });
    }

    if (isDryRun && triageData.length > 0) return { success: true, isTriage: true, triageData: triageData };

    var specResults = [];
    for (var p = 0; p < pendingSpecs.length; p++) {
      var pending = pendingSpecs[p], tabName = 'Spec' + (p + 1) + '_Clean';
      createTab(ss, tabName, pending.fullSpecData);
      if (isMacmillan) {
        createTab(ss, 'Spec' + (p + 1) + '_Context', pending.contextData);
        createTab(ss, 'Spec' + (p + 1) + '_Time_Policy', macmillanTimePolicyRows_());
        var excludedData = [['Excluded Module Name']];
        for (var ex = 0; ex < pending.specExcludedItems.length; ex++) excludedData.push([pending.specExcludedItems[ex]]);
        createTab(ss, 'Spec' + (p + 1) + '_Excluded', excludedData);
      }

      var l1Mods = [];
      if (isMacmillan) {
        for (var mi = 1; mi < pending.fullSpecData.length; mi++) l1Mods.push(String(pending.fullSpecData[mi][1]));
      } else {
        for (var ri = 1; ri < pending.fullSpecData.length; ri++) {
          if (Number(pending.fullSpecData[ri][levelIdx]) === 1) l1Mods.push(String(pending.fullSpecData[ri][nameIdx]));
        }
      }
      var rawName = String(specNames[p] || ('Specialization_' + (p + 1))).trim();
      var cleanFileName = (safePartnerName + rawName.replace(/[^a-zA-Z0-9_\-]/g, '_') + '_Cleaned.xlsx').replace(/_+/g, '_');
      var totalEstimatedMinutes = 0;
      if (isMacmillan) {
        for (var tm = 1; tm < pending.fullSpecData.length; tm++) totalEstimatedMinutes += Number(pending.fullSpecData[tm][3] || 0);
      }
      specResults.push({
        specNum: p + 1,
        specName: rawName,
        anchorName: String(data[pending.startIdx][nameIdx]),
        sliceRows: pending.specSlice.length,
        totalFileRows: pending.fullSpecData.length - 1,
        foundationRows: foundationRows,
        modules: l1Mods,
        filename: cleanFileName,
        contextRows: isMacmillan ? Math.max(0, pending.contextData.length - 1) : 0,
        totalEstimatedMinutes: totalEstimatedMinutes,
        timeModelVersion: isMacmillan ? MACMILLAN_TIME_MODEL_VERSION_ : '',
        excludedModules: pending.specExcludedItems.slice(),
        timeRuleCounts: pending.timeRuleCounts || {},
        fallbackItemCount: isMacmillan ? Number((pending.timeRuleCounts || {})['unknown-leaf-default'] || 0) : 0
      });
    }
    return { success: true, isTriage: false, numSpecs: numSpecs, totalMasterDataRows: totalMasterDataRows, foundationRows: foundationRows, specResults: specResults };
  } catch (e) {
    return { success: false, error: "Dynamic Split Error: " + e.toString() };
  }
}

function exportSpecAsXlsxBlob(fileId, specNum) {
  authorize_('editor');
  var tempSpreadsheetId = null;
  try {
    validateWorkflowFileId_(fileId);
    specNum = Number(specNum);
    if (!Number.isInteger(specNum) || specNum < 1 || specNum > 4) return { success: false, error: "Invalid specialization number." };
    var ss = SpreadsheetApp.openById(fileId), tabName = 'Spec' + specNum + '_Clean', sheet = ss.getSheetByName(tabName);
    if (!sheet) return { success: false, error: "Tab '" + tabName + "' not found." };

    var tempSs = SpreadsheetApp.create('Temp_Export_S' + specNum);
    tempSpreadsheetId = tempSs.getId();
    var cleanCopy = sheet.copyTo(tempSs); cleanCopy.setName('export');

    var contextSheet = ss.getSheetByName('Spec' + specNum + '_Context');
    if (contextSheet) { var contextCopy = contextSheet.copyTo(tempSs); contextCopy.setName('Module Context'); }
    var policySheet = ss.getSheetByName('Spec' + specNum + '_Time_Policy');
    if (policySheet) { var policyCopy = policySheet.copyTo(tempSs); policyCopy.setName('Time Policy'); }
    var excludedSheet = ss.getSheetByName('Spec' + specNum + '_Excluded');
    if (excludedSheet) { var excludedCopy = excludedSheet.copyTo(tempSs); excludedCopy.setName('Excluded Modules'); }

    var defaultSheet = tempSs.getSheetByName('Sheet1');
    if (defaultSheet && tempSs.getSheets().length > 1) tempSs.deleteSheet(defaultSheet);
    tempSs.setActiveSheet(cleanCopy);
    SpreadsheetApp.flush();

    var url = "https://docs.google.com/spreadsheets/d/" + tempSs.getId() + "/export?format=xlsx";
    var params = { method: "get", headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
    var response = UrlFetchApp.fetch(url, params);
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error("Google export returned HTTP " + response.getResponseCode() + ".");
    var blob = response.getBlob(); var base64 = Utilities.base64Encode(blob.getBytes());
    return { success: true, base64: base64, timeModelVersion: MACMILLAN_TIME_MODEL_VERSION_ };
  } catch (e) {
    return { success: false, error: "XLSX Generation Error: " + e.message };
  } finally {
    if (tempSpreadsheetId) try { DriveApp.getFileById(tempSpreadsheetId).setTrashed(true); } catch (cleanupError) {}
  }
}