

function ctiDriveImportMatches_(files, requestId, legacy) {
  if(!files || typeof files.list!=='function')throw new Error('Drive conversion recovery lookup is unavailable.');
  var marker=String(requestId||'');
  if(!/^[A-Za-z0-9-]{8,100}$/.test(marker))throw new Error('Invalid internal conversion request marker.');
  var key='ctiImportRequest';
  var q="trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and "+
    (legacy?"properties has { key = '"+key+"' and value = '"+marker+"' and visibility = 'PRIVATE' }":"appProperties has { key = '"+key+"' and value = '"+marker+"' }");
  var options=legacy?{q:q,maxResults:10,fields:'items(id,mimeType,properties),nextPageToken'}:{q:q,pageSize:10,fields:'files(id,mimeType,appProperties),nextPageToken,incompleteSearch'};
  var result=files.list(options);
  if(!result || result.nextPageToken || result.incompleteSearch)throw new Error('Drive conversion recovery lookup was incomplete.');
  var rows=legacy?(result.items||[]):(result.files||[]),seen=Object.create(null);
  return rows.filter(function(file){
    var own=legacy?(file.properties||[]).some(function(prop){return prop.key===key && prop.value===marker && prop.visibility==='PRIVATE';}):file.appProperties && file.appProperties[key]===marker;
    if(!own || file.mimeType!=='application/vnd.google-apps.spreadsheet' || !file.id || seen[file.id])return false;
    seen[file.id]=true;return true;
  });
}

function ctiImportXlsxAsSheet_(blob, name, adapter) {
  // Adapter is used only by deterministic tests; app callers keep the normal
  // authorization and their existing success/failure cleanup policies.
  var io=adapter || {};
  var files=io.files || (typeof Drive!=='undefined' && Drive.Files);
  if(!files || (typeof files.insert!=='function' && typeof files.create!=='function'))throw new Error('Drive API Service is not enabled.');
  var legacy=typeof files.insert==='function';
  var requestId=io.requestId || Utilities.getUuid();
  var wait=io.wait || function(ms){Utilities.sleep(ms);};
  var random=io.random || Math.random;
  var trash=io.trash || function(id){DriveApp.getFileById(id).setTrashed(true);};
  var log=io.log || function(message){Logger.log(message);};
  var resource={mimeType:'application/vnd.google-apps.spreadsheet'};
  if(legacy){resource.title=String(name);resource.properties=[{key:'ctiImportRequest',value:requestId,visibility:'PRIVATE'}];}
  else {resource.name=String(name);resource.appProperties={ctiImportRequest:requestId};}
  var attempts=0,lastError=null;
  function cleanupDuplicates(matches, keepId){
    matches.forEach(function(file){
      if(file.id===keepId)return;
      try{trash(file.id);}catch(e){log('CTI: a duplicate temporary conversion could not be moved to trash.');}
    });
  }
  while(attempts<3){
    attempts++;
    try {
      var converted=legacy?files.insert(resource,blob,{convert:true}):files.create(resource,blob);
      if(!converted || !converted.id)throw new Error('Drive conversion returned no file ID; the result is uncertain.');
      if(attempts>1){
        // A delayed earlier conversion may become visible after a retry succeeds.
        try{cleanupDuplicates(ctiDriveImportMatches_(files,requestId,legacy),converted.id);}catch(cleanupError){log('CTI: conversion succeeded; duplicate recovery lookup is unavailable.');}
      }
      return converted;
    } catch(error) {
      lastError=error;
      if(!ctiDriveConversionRetryable_(error))throw error;
    }
    // Bound retries to three conversion attempts, with 1/2/4-second backoff
    // plus jitter. Also reconcile after the last failure before reporting it.
    wait(Math.pow(2,attempts-1)*1000+Math.floor(random()*250));
    var recovered;
    try{recovered=ctiDriveImportMatches_(files,requestId,legacy);}
    catch(recoveryError){
      throw new Error('Google Drive conversion could not be confirmed. QA has not run. Retry this stage. Original Drive error: '+String(lastError.message||lastError)+'. Recovery lookup: '+String(recoveryError.message||recoveryError));
    }
    if(recovered.length){
      cleanupDuplicates(recovered,recovered[0].id);
      log('CTI: recovered a converted workbook after Drive returned a temporary error. Content QA will run normally.');
      return recovered[0];
    }
    if(attempts<3)log('CTI: retrying workbook conversion after a temporary Drive error ('+(attempts+1)+'/3).');
  }
  throw new Error('Google Drive could not convert this workbook after 3 attempts. QA has not run. Retry this stage. Latest Drive error: '+String(lastError && lastError.message || lastError));
}

function uploadAndScanMaster(fileData, fileName) {
  authorize_('editor');
  return uploadAndScanMasterCore_(fileData, fileName, ctiWorkflowIo_());
}

// Deterministic workflow; storage is supplied explicitly by the host.
function uploadAndScanMasterCore_(fileData, fileName, io) {
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
}


// -------------------------------------------------------------------
// MACMILLAN DETERMINISTIC LEARNER-TIME MODEL + EVIDENCE CONTEXT
// -------------------------------------------------------------------
var MACMILLAN_TIME_MODEL_VERSION_ = 'm2-leaf-evidence-20260911';

function macmillanTimePolicyRows_() {
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

function macmillanEstimateItemTime_(row, indices) {
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

function macmillanSafeMatrix_(data) {
  return (data || []).map(function(row) {
    return (row || []).map(function(value) {
      return typeof value === 'string' ? sheetSafeText_(value) : value;
    });
  });
}

function macmillanPersistValidatedTab_(ss, tabName, data) {
  return createTab(ss, tabName, macmillanSafeMatrix_(data));
}

// -------------------------------------------------------------------
// SHEET TAB WRITER (required by Macmillan Stage 2 split workflow)
// -------------------------------------------------------------------
function createTab(ss, tabName, data) {
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