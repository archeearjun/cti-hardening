// Maintained source: explicit dependencies; no ordered concatenation.
import { sheetSafeText_ } from "../validation.js";

export function create_uploadAndScanMasterCore_(services) {
const {Utilities} = services;
return function uploadAndScanMasterCore_(fileData, fileName, io) {
  var importedFileId = null;
  try {
    if (!fileData || String(fileData).length > 35000000) return { success: false, error: "Select an .xlsx file smaller than 25 MB." };
    if (!/\.xlsx$/i.test(String(fileName || ""))) return { success: false, error: "The Master file must be an .xlsx workbook." };
    var blob = Utilities.newBlob(Utilities.base64Decode(fileData), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);
    var masterName = String(fileName).replace(/\.xlsx$/i, ' (Master)');
    var tempFile = io.importWorkbook(blob, masterName);
    importedFileId = tempFile.id;
    var ss = io.openWorkbook(importedFileId), sheet = ss.getSheetByName('export') || ss.getSheets()[0], data = sheet.getDataRange().getValues();
    if (!data || data.length < 2) throw new Error("The Master workbook contains no data rows.");
    var headers = data[0].map(function(value) { return String(value).trim().toLowerCase(); });
    var levelIdx = headers.indexOf('level'), nameIdx = headers.indexOf('name');
    if (levelIdx === -1 || nameIdx === -1) throw new Error("Required Level and Name columns are missing.");

    var allL1Modules = [], filteredModules = [], excludedModules = [], l2Count = 0, l3Count = 0;
    for (var i = 1; i < data.length; i++) {
      var lvl = Number(data[i][levelIdx]);
      // Strip out bullet points, weird spaces, and leading non-letters
      var name = String(data[i][nameIdx]).replace(/^[^\w]+/, '').trim(); 
      var excelRow = i + 1;
      
      if (lvl === 1) { 
          allL1Modules.push({ excelRow: excelRow, name: name }); 
          // Broadened keyword acceptance including 'Ch'
          if (/^(Chapter|Ch\b|Spotlight|Module|Lesson|Unit|Part|Section)/i.test(name)) {
              filteredModules.push({ excelRow: excelRow, name: name }); 
          } else {
              excludedModules.push({ excelRow: excelRow, name: name });
          }
      } else if (lvl === 2) {
          l2Count++; 
      } else if (lvl === 3) {
          l3Count++;
      }
    }
    
    // FALLBACK: If no specific keywords are found, safely accept ALL Level 1 items as anchors
    if (filteredModules.length === 0 && allL1Modules.length > 0) {
        filteredModules = allL1Modules;
        excludedModules = [];
    }

    if (filteredModules.length === 0) throw new Error("No Level 1 modules/anchors were found in this document.");
    io.registerWorkbook(importedFileId);
    return { success: true, fileId: importedFileId, totalRows: data.length - 1, totalL1: allL1Modules.length, primaryCount: filteredModules.length, totalL2: l2Count, filteredModules: filteredModules, excludedModules: excludedModules };
  } catch (e) {
    if (importedFileId) try { io.getTemporaryFile(importedFileId).setTrashed(true); } catch (cleanupError) {}
    return { success: false, error: "Master Scan Error: " + e.message };
  }
};
}

export const MACMILLAN_TIME_MODEL_VERSION_ = 'm2-leaf-evidence-20260911';

export function macmillanTimePolicyRows_() {
  return [
    ['Time Model Version', MACMILLAN_TIME_MODEL_VERSION_],
    ['Principle', 'Only learner-facing leaf items contribute time. Structural folders/containers contribute 0 minutes.'],
    ['Reading — chapter/part navigation heading', '0 minutes'],
    ['Reading — chapter review', '3 minutes'],
    ['Reading — substantive section', '8 minutes'],
    ['LearningCurve adaptive quiz', '10 minutes'],
    ['Video / MAPI / ALVIN / ALTP', '5 minutes'],
    ['Assessment — quiz/practice quiz', '10 minutes'],
    ['Assessment — homework/assignment/Desmos/dynamic figure', '15 minutes'],
    ['Assessment — other', '15 minutes'],
    ['Short-form writing', '15 minutes'],
    ['Static file / URL — rubric or report', '2 minutes'],
    ['Static file / URL — other', '5 minutes'],
    ['Unknown learner-facing leaf item', '5 minutes'],
    ['Important', 'These are deterministic CTI planning estimates, not source-authored durations. GPT agents must never recalculate or change them.']
  ];
}

export function macmillanEstimateItemTime_(row, indices) {
  indices = indices || {};
  var lvl = Number(indices.levelIdx > -1 ? row[indices.levelIdx] : 0);
  var name = String(indices.nameIdx > -1 ? row[indices.nameIdx] || '' : '').replace(/^[^\w]+/, '').trim();
  var low = name.toLowerCase();
  var nodeType = String(indices.nodeTypeIdx > -1 ? row[indices.nodeTypeIdx] || '' : '').toLowerCase().trim();
  var tool = String(indices.toolIdx > -1 ? row[indices.toolIdx] || '' : '').toLowerCase().trim();

  if (lvl <= 1) return { minutes: 0, rule: 'module-root', useForMetadata: false };
  if (/instructor|pre-class|active lecture/i.test(low)) return { minutes: 0, rule: 'instructor-support-excluded', useForMetadata: false };

  // Macmillan export rows explicitly identify folders. When node_type is not
  // available, a blank assignment_tool is treated as a structural container.
  if ((nodeType && nodeType !== 'item') || (!nodeType && !tool)) {
    return { minutes: 0, rule: 'container', useForMetadata: true };
  }

  if (tool === 'reading') {
    if (/^part\s+[ivxlcdm]+\b/i.test(low)) return { minutes: 0, rule: 'reading-navigation-part', useForMetadata: true };
    if (/^chapter\s+\d+\b/i.test(low) && !/review/i.test(low)) return { minutes: 0, rule: 'reading-navigation-chapter', useForMetadata: true };
    if (/review/i.test(low)) return { minutes: 3, rule: 'reading-review', useForMetadata: true };
    return { minutes: 8, rule: 'reading-section', useForMetadata: true };
  }
  if (tool === 'learningcurve') return { minutes: 10, rule: 'learningcurve-quiz', useForMetadata: true };
  if (tool === 'mapi' || tool === 'alvin' || tool === 'altp' || /video/i.test(low)) return { minutes: 5, rule: 'video', useForMetadata: true };
  if (tool === 'assessment' || tool === 'short-form-writing') {
    if (/quiz/i.test(low)) return { minutes: 10, rule: 'assessment-quiz', useForMetadata: true };
    if (/homework|assignment|desmos|dynamic\s+figure/i.test(low)) return { minutes: 15, rule: 'assessment-activity', useForMetadata: true };
    return { minutes: 15, rule: tool === 'short-form-writing' ? 'short-form-writing' : 'assessment-default', useForMetadata: true };
  }
  if (tool === 'staticfile' || tool === 'url') {
    if (/rubric|report/i.test(low)) return { minutes: 2, rule: 'reference-rubric-report', useForMetadata: true };
    return { minutes: 5, rule: 'reference-file-url', useForMetadata: true };
  }
  return { minutes: 5, rule: 'unknown-leaf-default', useForMetadata: true };
}

export function macmillanSafeMatrix_(data) {
  return (data || []).map(function(row) {
    return (row || []).map(function(value) {
      return typeof value === 'string' ? sheetSafeText_(value) : value;
    });
  });
}

export function macmillanPersistValidatedTab_(ss, tabName, data) {
  return createTab(ss, tabName, macmillanSafeMatrix_(data));
}

export function createTab(ss, tabName, data) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  sheet.clear();
  if (data && data.length > 0) {
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
    sheet.getRange(1, 1, 1, data[0].length).setFontWeight("bold").setBackground("#e6f4ea");
    try { sheet.autoResizeColumns(1, data[0].length); } catch(e) {}
  }
  return sheet;
}
