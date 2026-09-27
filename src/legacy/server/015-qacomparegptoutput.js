


/**
 * Deterministically validates a GPT-produced Macmillan workbook against the
 * specialization baseline created in SpecN_Clean. The frontend has called
 * this endpoint since the original staged workflow. v6.8.2 keeps the
 * server contract and adds evidence-lineage, deterministic-time, count-aware,
 * exclusion-aware stage contracts so
 * Stages 3-5 cannot silently accept duplicated or hallucinated modules.
 */
function qaCompareGptOutput(fileData, fileName, masterFileId, stageName, specNum) {
  authorize_('editor');
  var importedFileId = null;
  try {
    validateWorkflowFileId_(masterFileId);
    stageName = String(stageName || '').trim();
    if (['Metadata', 'Merged', 'ContentMap'].indexOf(stageName) === -1) return { success: false, error: 'Unknown QA stage: ' + stageName + '.' };
    specNum = Number(specNum);
    if (!Number.isInteger(specNum) || specNum < 1 || specNum > 4) return { success: false, error: 'Invalid specialization number.' };
    if (!fileData || String(fileData).length > 35000000) return { success: false, error: 'Select an .xlsx file smaller than 25 MB.' };
    if (!/\.xlsx$/i.test(String(fileName || ''))) return { success: false, error: 'The QA input must be an .xlsx workbook.' };

    var masterSs = SpreadsheetApp.openById(masterFileId);
    var baselineSheet = masterSs.getSheetByName('Spec' + specNum + '_Clean');
    if (!baselineSheet) return { success: false, error: "Baseline tab 'Spec" + specNum + "_Clean' was not found. Re-run Stage 2 first." };

    var baseline = baselineSheet.getDataRange().getDisplayValues();
    if (!baseline || baseline.length < 2) return { success: false, error: 'The specialization baseline contains no module rows.' };
    var baseHeaders = baseline[0].map(function(v){ return String(v || '').trim().toLowerCase(); });
    var baseNoIdx = baseHeaders.indexOf('module no.'); if (baseNoIdx === -1) baseNoIdx = baseHeaders.indexOf('module no');
    var baseNameIdx = baseHeaders.indexOf('module name'); if (baseNameIdx === -1) baseNameIdx = baseHeaders.indexOf('name');
    var baseDescIdx = baseHeaders.indexOf('module description');
    var baseTimeIdx = baseHeaders.indexOf('time estimate');
    var baseObjIdx = baseHeaders.indexOf('learning objectives');
    if (baseNameIdx === -1) return { success:false, error:'The specialization baseline has no Module Name column.' };

    function normName_(value) { return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
    function normHeader_(value) { return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
    function normText_(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
    function asInteger_(value) {
      if (typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value) return value;
      var text = String(value == null ? '' : value).trim();
      return /^-?\d+$/.test(text) ? Number(text) : null;
    }
    // Content Map durations are human-readable, but CTI always validates them
    // back to the exact authoritative minute count. Accepted canonical forms:
    // 125, "2h 5m", "2h", "45m", or "2:05". No decimal-hour
    // rounding is accepted because it would destroy minute-level lineage.
    function asDurationMinutes_(value) {
      if (typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value && value >= 0) return value;
      var text = String(value == null ? '' : value).trim().toLowerCase();
      if (!text) return null;
      if (/^\d+$/.test(text)) return Number(text);
      var hm = text.match(/^(\d+)\s*h(?:ours?|rs?)?(?:\s*(\d+)\s*m(?:in(?:ute)?s?)?)?$/i);
      if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
      var mins = text.match(/^(\d+)\s*m(?:in(?:ute)?s?)?$/i);
      if (mins) return Number(mins[1]);
      var colon = text.match(/^(\d+):([0-5]\d)$/);
      if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
      return null;
    }

    var expectedRows = [], expectedCounts = Object.create(null), expectedDisplay = Object.create(null), expectedByKey = Object.create(null);
    for (var i = 1; i < baseline.length; i++) {
      var display = String(baseline[i][baseNameIdx] || '').trim(), key = normName_(display);
      if (!key) continue;
      var rec = {
        row: i + 1,
        no: baseNoIdx > -1 ? asInteger_(baseline[i][baseNoIdx]) : i,
        name: display,
        key: key,
        description: baseDescIdx > -1 ? String(baseline[i][baseDescIdx] || '') : '',
        time: baseTimeIdx > -1 ? Number(baseline[i][baseTimeIdx] || 0) : 0,
        objectives: baseObjIdx > -1 ? String(baseline[i][baseObjIdx] || '') : ''
      };
      expectedRows.push(rec);
      expectedCounts[key] = (expectedCounts[key] || 0) + 1;
      if (!expectedDisplay[key]) expectedDisplay[key] = display;
      if (!expectedByKey[key]) expectedByKey[key] = rec;
    }
    if (!expectedRows.length) return { success:false, error:'The specialization baseline contains no named modules.' };

    var excludedNames = [], excludedMap = Object.create(null);
    var excludedSheet = masterSs.getSheetByName('Spec' + specNum + '_Excluded');
    if (excludedSheet) {
      var excludedData = excludedSheet.getDataRange().getDisplayValues();
      for (var ex = 1; ex < excludedData.length; ex++) {
        var excludedName = String(excludedData[ex][0] || '').trim(), excludedKey = normName_(excludedName);
        if (!excludedName || !excludedKey) continue;
        excludedNames.push(excludedName); excludedMap[excludedKey] = excludedName;
      }
    }

    var blob = Utilities.newBlob(Utilities.base64Decode(fileData), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);
    var tempName = 'CTI_QA_' + stageName + '_S' + specNum + '_' + new Date().getTime();
    var tempFile = ctiImportXlsxAsSheet_(blob, tempName);
    importedFileId = tempFile.id;

    var qaSs = SpreadsheetApp.openById(importedFileId);
    var qaSheet = qaSs.getSheetByName('export') || qaSs.getSheets()[0];
    var dataRange = qaSheet.getDataRange();
    var data = dataRange.getDisplayValues();
    var rawData = dataRange.getValues();
    if (!data || data.length < 2) return { success: false, error: 'The uploaded workbook contains no data rows.' };

    var rawHeaders = data[0].map(function(v){ return String(v || '').trim(); });
    var headers = rawHeaders.map(normHeader_);
    var expectedHeadersByStage = {
      Metadata: ['module name','module description','learning objectives'],
      Merged: ['module no','module name','module description','time estimate','learning objectives'],
      ContentMap: ['orig mod no','orig mod name','orig mod description','orig mod length','course no','course title','mod no in course','mod name in course','mod length','remarks']
    };
    var expectedHeaders = expectedHeadersByStage[stageName];
    var headerOrderMatches = headers.length === expectedHeaders.length && expectedHeaders.every(function(h, idx){ return headers[idx] === h; });
    if (!headerOrderMatches) {
      return { success:false, error:stageName + ' QA failed for Specialization ' + specNum + ': spreadsheet headers do not match the required schema. Expected [' + expectedHeaders.join(', ') + '] but found [' + rawHeaders.join(', ') + '].' };
    }

    var nameHeader = stageName === 'ContentMap' ? 'orig mod name' : 'module name';
    var nameIdx = headers.indexOf(nameHeader);
    var foundCounts = Object.create(null), foundDisplay = Object.create(null), foundRows = 0, blankNameRows = [];
    for (var r = 1; r < data.length; r++) {
      var rowHasData = data[r].some(function(v){ return String(v || '').trim() !== ''; });
      if (!rowHasData) continue;
      foundRows++;
      var candidate = String(data[r][nameIdx] || '').trim(), norm = normName_(candidate);
      if (!norm) { blankNameRows.push(r + 1); continue; }
      foundCounts[norm] = (foundCounts[norm] || 0) + 1;
      if (!foundDisplay[norm]) foundDisplay[norm] = candidate;
    }

    var matchedNames = [], missingNames = [], countMismatches = [];
    Object.keys(expectedCounts).forEach(function(key) {
      var expectedCount = Number(expectedCounts[key] || 0), foundCount = Number(foundCounts[key] || 0);
      if (foundCount >= expectedCount) for (var copy = 0; copy < expectedCount; copy++) matchedNames.push(expectedDisplay[key]);
      else { missingNames.push(expectedDisplay[key]); countMismatches.push(expectedDisplay[key] + ' — expected ' + expectedCount + ', found ' + foundCount); }
      // Macmillan content mapping is a one-source-module -> one-map-row contract.
      if (foundCount > expectedCount) countMismatches.push(expectedDisplay[key] + ' — expected ' + expectedCount + ', found ' + foundCount);
    });

    var unexpectedNames = [], excludedNamesFound = [];
    Object.keys(foundCounts).forEach(function(key) {
      if (excludedMap[key]) excludedNamesFound.push(excludedMap[key]);
      else if (!expectedCounts[key]) unexpectedNames.push(foundDisplay[key]);
    });

    var structuralProblems = missingNames.length || unexpectedNames.length || excludedNamesFound.length || countMismatches.length || blankNameRows.length;
    if (structuralProblems) {
      var reasons = [];
      if (missingNames.length) reasons.push('missing: ' + missingNames.join(', '));
      if (unexpectedNames.length) reasons.push('unexpected: ' + unexpectedNames.join(', '));
      if (excludedNamesFound.length) reasons.push('excluded modules reappeared: ' + excludedNamesFound.join(', '));
      if (countMismatches.length) reasons.push('occurrence mismatch: ' + countMismatches.join('; '));
      if (blankNameRows.length) reasons.push('blank module-name rows: ' + blankNameRows.join(', '));
      return { success:false, error:stageName + ' QA failed for Specialization ' + specNum + ': ' + reasons.join(' | '), expectedCount:expectedRows.length, foundCount:foundRows };
    }

    var warnings = [], contractProblems = [], metrics = { timeModelVersion: MACMILLAN_TIME_MODEL_VERSION_ };

    if (stageName === 'Metadata') {
      var contextEvidenceByKey = Object.create(null), contextEvidenceRows = 0;
      var contextSheet = masterSs.getSheetByName('Spec' + specNum + '_Context');
      if (contextSheet) {
        var cx = contextSheet.getDataRange().getDisplayValues(), cxh = cx[0].map(normHeader_);
        var cxName = cxh.indexOf('module name'), cxUse = cxh.indexOf('use for metadata');
        for (var cxi = 1; cxi < cx.length; cxi++) {
          var cxKey = cxName > -1 ? normName_(cx[cxi][cxName]) : '';
          var usable = cxUse === -1 || String(cx[cxi][cxUse] || '').toUpperCase() === 'YES';
          if (cxKey && usable) { contextEvidenceByKey[cxKey] = (contextEvidenceByKey[cxKey] || 0) + 1; contextEvidenceRows++; }
        }
      } else {
        warnings.push('Module Context evidence sheet is missing; metadata grounding cannot be independently checked.');
      }
      metrics.contextEvidenceRows = contextEvidenceRows;
      var descIdx = headers.indexOf('module description'), objIdx = headers.indexOf('learning objectives');
      for (var mr = 1; mr < data.length; mr++) {
        if (!data[mr].some(function(v){ return String(v || '').trim() !== ''; })) continue;
        var mName = String(data[mr][nameIdx] || '').trim(), mKey = normName_(mName);
        var desc = normText_(data[mr][descIdx]), objectives = normText_(data[mr][objIdx]);
        if (contextSheet && !contextEvidenceByKey[mKey]) warnings.push(mName + ': no usable Module Context evidence rows were found; review metadata grounding manually.');
        if (!desc) contractProblems.push(mName + ': Module Description is blank.');
        if (!objectives) contractProblems.push(mName + ': Learning Objectives are blank.');
        if (desc && desc.length < 120) warnings.push(mName + ': description is short (' + desc.length + ' chars); verify it is grounded in Module Context.');
        var objectiveSignals = (String(data[mr][objIdx] || '').match(/(?:^|\n)\s*(?:\d+[.)]|[-•])/g) || []).length;
        if (objectives && objectiveSignals < 2 && objectives.split(';').length < 2) warnings.push(mName + ': fewer than two clearly separated learning objectives detected.');
      }
      if (!contractProblems.length) macmillanPersistValidatedTab_(masterSs, 'Spec' + specNum + '_Metadata_Validated', rawData);
    }

    if (stageName === 'Merged') {
      var noIdx = headers.indexOf('module no'), mDescIdx = headers.indexOf('module description'), timeIdx = headers.indexOf('time estimate'), mObjIdx = headers.indexOf('learning objectives');
      var validatedMetaSheet = masterSs.getSheetByName('Spec' + specNum + '_Metadata_Validated');
      var metadataByKey = Object.create(null);
      if (validatedMetaSheet) {
        var vm = validatedMetaSheet.getDataRange().getDisplayValues(), vmh = vm[0].map(normHeader_);
        var vmName = vmh.indexOf('module name'), vmDesc = vmh.indexOf('module description'), vmObj = vmh.indexOf('learning objectives');
        for (var vi = 1; vi < vm.length; vi++) {
          var vk = normName_(vm[vi][vmName]); if (vk) metadataByKey[vk] = { description:normText_(vm[vi][vmDesc]), objectives:normText_(vm[vi][vmObj]) };
        }
      }
      if (foundRows !== expectedRows.length) contractProblems.push('Merged workbook must contain exactly ' + expectedRows.length + ' module rows; found ' + foundRows + '.');
      var mergedRowNo = 0;
      for (var rr = 1; rr < data.length; rr++) {
        if (!data[rr].some(function(v){ return String(v || '').trim() !== ''; })) continue;
        if (mergedRowNo >= expectedRows.length) break;
        var exp = expectedRows[mergedRowNo++], rowKey = normName_(data[rr][nameIdx]);
        if (rowKey !== exp.key) contractProblems.push('Row ' + (rr + 1) + ': module order/name changed; expected ' + exp.name + '.');
        var actualNo = asInteger_(rawData[rr][noIdx]); if (actualNo !== exp.no) contractProblems.push(exp.name + ': Module No. changed from ' + exp.no + ' to ' + data[rr][noIdx] + '.');
        var actualTime = asInteger_(rawData[rr][timeIdx]); if (actualTime !== exp.time) contractProblems.push(exp.name + ': Time Estimate must remain CTI-authoritative ' + exp.time + ' minutes; found ' + data[rr][timeIdx] + '.');
        var md = normText_(data[rr][mDescIdx]), mo = normText_(data[rr][mObjIdx]);
        if (!md) contractProblems.push(exp.name + ': Module Description is blank after merge.');
        if (!mo) contractProblems.push(exp.name + ': Learning Objectives are blank after merge.');
        if (metadataByKey[rowKey]) {
          if (md !== metadataByKey[rowKey].description) contractProblems.push(exp.name + ': merged description differs from the validated Metadata output.');
          if (mo !== metadataByKey[rowKey].objectives) contractProblems.push(exp.name + ': merged objectives differ from the validated Metadata output.');
        }
      }
      if (!validatedMetaSheet) warnings.push('No validated Metadata snapshot was available, so text lineage could not be checked; structure/time were still verified.');
      if (!contractProblems.length) macmillanPersistValidatedTab_(masterSs, 'Spec' + specNum + '_Merged_Validated', rawData);
    }

    if (stageName === 'ContentMap') {
      var origNoIdx = headers.indexOf('orig mod no'), origDescIdx = headers.indexOf('orig mod description'), origLenIdx = headers.indexOf('orig mod length');
      var courseNoIdx = headers.indexOf('course no'), courseTitleIdx = headers.indexOf('course title'), modNoCourseIdx = headers.indexOf('mod no in course');
      var modNameCourseIdx = headers.indexOf('mod name in course'), modLenIdx = headers.indexOf('mod length'), remarksIdx = headers.indexOf('remarks');
      var validatedMergedSheet = masterSs.getSheetByName('Spec' + specNum + '_Merged_Validated');
      var mergedByKey = Object.create(null);
      if (validatedMergedSheet) {
        var mg = validatedMergedSheet.getDataRange().getDisplayValues(), mgh = mg[0].map(normHeader_);
        var mgName = mgh.indexOf('module name'), mgDesc = mgh.indexOf('module description'), mgTime = mgh.indexOf('time estimate');
        for (var gi = 1; gi < mg.length; gi++) {
          var gk = normName_(mg[gi][mgName]); if (gk) mergedByKey[gk] = { description:normText_(mg[gi][mgDesc]), time:Number(mg[gi][mgTime] || 0) };
        }
      }

      if (foundRows !== expectedRows.length) contractProblems.push('Content Map must contain exactly one row per source module (' + expectedRows.length + '); found ' + foundRows + '.');
      var courseTitles = Object.create(null), courseCounts = Object.create(null), courseTotals = Object.create(null), partnerCourseRows = Object.create(null), lastCourseNo = 0, lastModNoByCourse = Object.create(null);
      var expectedTotal = 0, origTotal = 0, mappedTotal = 0, mapRowNo = 0;
      expectedRows.forEach(function(er){ expectedTotal += Number(er.time || 0); });

      for (var cr = 1; cr < data.length; cr++) {
        if (!data[cr].some(function(v){ return String(v || '').trim() !== ''; })) continue;
        if (mapRowNo >= expectedRows.length) break;
        var expected = expectedRows[mapRowNo++], cKey = normName_(data[cr][nameIdx]);
        if (cKey !== expected.key) contractProblems.push('Row ' + (cr + 1) + ': original module order/name changed; expected ' + expected.name + '.');
        var origNo = asInteger_(rawData[cr][origNoIdx]); if (origNo !== expected.no) contractProblems.push(expected.name + ': Orig. Mod No. must be ' + expected.no + '.');
        var origLen = asDurationMinutes_(rawData[cr][origLenIdx]), modLen = asDurationMinutes_(rawData[cr][modLenIdx]);
        if (origLen !== expected.time) contractProblems.push(expected.name + ': Orig. Mod Length must represent exactly ' + expected.time + ' CTI minutes in h/m form (for example 125 -> 2h 5m); found ' + data[cr][origLenIdx] + '.');
        if (modLen !== expected.time) contractProblems.push(expected.name + ': Mod Length must represent exactly ' + expected.time + ' CTI minutes in h/m form (for example 125 -> 2h 5m); found ' + data[cr][modLenIdx] + '.');
        origTotal += Number(origLen || 0); mappedTotal += Number(modLen || 0);

        var courseNo = asInteger_(rawData[cr][courseNoIdx]), modNoCourse = asInteger_(rawData[cr][modNoCourseIdx]);
        var courseTitle = String(data[cr][courseTitleIdx] || '').trim(), mappedName = String(data[cr][modNameCourseIdx] || '').trim();
        if (!courseNo || courseNo < 1) contractProblems.push(expected.name + ': Course No. must be a positive integer.');
        if (!modNoCourse || modNoCourse < 1) contractProblems.push(expected.name + ': Mod No. in Course must be a positive integer.');
        if (!courseTitle) contractProblems.push(expected.name + ': Course Title is blank.');
        if (courseTitle.length > 60) contractProblems.push('Course ' + courseNo + ': title exceeds 60 characters.');
        if (normName_(mappedName) !== expected.key) contractProblems.push(expected.name + ': Mod Name in Course must preserve the source module identity.');
        if (courseNo && courseNo < lastCourseNo) contractProblems.push(expected.name + ': Course No. moved backwards; source order must be preserved.');
        if (courseNo) lastCourseNo = courseNo;
        if (courseNo) {
          if (courseTitles[courseNo] && courseTitles[courseNo] !== courseTitle) contractProblems.push('Course ' + courseNo + ': inconsistent titles across rows.');
          courseTitles[courseNo] = courseTitle;
          courseCounts[courseNo] = (courseCounts[courseNo] || 0) + 1;
          courseTotals[courseNo] = (courseTotals[courseNo] || 0) + Number(modLen || 0);
          if (!partnerCourseRows[courseNo]) partnerCourseRows[courseNo] = [];
          partnerCourseRows[courseNo].push({
            sourceModuleNo: origNo,
            moduleNoInCourse: modNoCourse,
            moduleName: mappedName || expected.name,
            description: String(data[cr][origDescIdx] || '').trim(),
            minutes: Number(modLen || 0),
            remarks: remarksIdx > -1 ? String(data[cr][remarksIdx] || '').trim() : ''
          });
          var expectedModNo = (lastModNoByCourse[courseNo] || 0) + 1;
          if (modNoCourse !== expectedModNo) contractProblems.push(expected.name + ': Mod No. in Course must be contiguous; expected ' + expectedModNo + ', found ' + data[cr][modNoCourseIdx] + '.');
          lastModNoByCourse[courseNo] = modNoCourse || expectedModNo;
        }
        if (mergedByKey[cKey]) {
          if (normText_(data[cr][origDescIdx]) !== mergedByKey[cKey].description) contractProblems.push(expected.name + ': Orig. Mod Description changed after the validated merge.');
          if (Number(mergedByKey[cKey].time || 0) !== expected.time) warnings.push(expected.name + ': validated merged time differs from Stage 2 baseline; Stage 2 remains authoritative.');
        }
      }

      var courseNos = Object.keys(courseTitles).map(Number).sort(function(a,b){return a-b;});
      for (var ci = 0; ci < courseNos.length; ci++) if (courseNos[ci] !== ci + 1) contractProblems.push('Course numbers must be contiguous starting at 1.');
      if (expectedRows.length >= 6 && courseNos.length < 3) contractProblems.push('A specialization with ' + expectedRows.length + ' modules must map to at least 3 courses.');
      courseNos.forEach(function(cn){ if (courseCounts[cn] < 2) contractProblems.push('Course ' + cn + ' contains fewer than 2 source modules.'); });
      if (origTotal !== expectedTotal) contractProblems.push('Orig. Mod Length total changed: expected ' + expectedTotal + ' minutes, found ' + origTotal + '.');
      if (mappedTotal !== expectedTotal) contractProblems.push('Mod Length total changed: expected ' + expectedTotal + ' minutes, found ' + mappedTotal + '.');
      if (!validatedMergedSheet) warnings.push('No validated Merged snapshot was available, so description lineage could not be checked; module/time/course contracts were still verified.');
      courseNos.forEach(function(cn){
        if (courseCounts[cn] < 3 || courseCounts[cn] > 4) warnings.push('Course ' + cn + ' contains ' + courseCounts[cn] + ' modules; the 3–4 module benchmark is advisory, not a failure.');
      });
      if (expectedTotal < 2400 || expectedTotal > 3600) warnings.push('Total deterministic learner time is ' + expectedTotal + ' minutes; the 40–60 hour benchmark is advisory and CTI will not alter source-derived planning time to force compliance.');
      if (courseNos.length > 1) {
        var averageCourseMinutes = expectedTotal / courseNos.length;
        courseNos.forEach(function(cn){
          if (averageCourseMinutes > 0 && Math.abs(courseTotals[cn] - averageCourseMinutes) / averageCourseMinutes > 0.35) warnings.push('Course ' + cn + ' learner time differs from the course average by more than 35%; review grouping coherence/balance without changing module times.');
        });
      }

      var minCourseMinutes = null, maxCourseMinutes = null, minCourseNo = null, maxCourseNo = null;
      courseNos.forEach(function(cn) {
        var mins = Number(courseTotals[cn] || 0);
        if (minCourseMinutes === null || mins < minCourseMinutes) { minCourseMinutes = mins; minCourseNo = cn; }
        if (maxCourseMinutes === null || mins > maxCourseMinutes) { maxCourseMinutes = mins; maxCourseNo = cn; }
      });
      var balanceRatio = minCourseMinutes && maxCourseMinutes ? maxCourseMinutes / minCourseMinutes : null;

      metrics.totalMinutes = expectedTotal;
      metrics.courseCount = courseNos.length;
      metrics.minCourseMinutes = minCourseMinutes;
      metrics.maxCourseMinutes = maxCourseMinutes;
      metrics.minCourseNo = minCourseNo;
      metrics.maxCourseNo = maxCourseNo;
      metrics.balanceRatio = balanceRatio == null ? null : Math.round(balanceRatio * 100) / 100;
      metrics.courseBreakdown = courseNos.map(function(cn){ return { courseNo:cn, title:courseTitles[cn], modules:courseCounts[cn], minutes:courseTotals[cn] }; });
      metrics.partnerDocument = {
        moduleCount: expectedRows.length,
        courseCount: courseNos.length,
        totalMinutes: expectedTotal,
        excludedModules: excludedNames.slice(),
        courses: courseNos.map(function(cn) {
          return { courseNo: cn, title: courseTitles[cn], minutes: courseTotals[cn], modules: (partnerCourseRows[cn] || []).slice() };
        })
      };
      metrics.contractStatus = contractProblems.length ? 'FAIL' : 'PASS';
      metrics.ctiVerdict = contractProblems.length ? 'FAIL' : (warnings.length ? 'PASS_WITH_REVIEW' : 'PASS');
      metrics.reviewFlagCount = warnings.length;
      metrics.reviewFlags = warnings.slice();
      if (!contractProblems.length) macmillanPersistValidatedTab_(masterSs, 'Spec' + specNum + '_ContentMap_Validated', rawData);
    }

    if (contractProblems.length) {
      metrics.contractStatus = 'FAIL';
      if (stageName === 'ContentMap') metrics.ctiVerdict = 'FAIL';
      return {
        success:false,
        error:stageName + ' contract QA failed for Specialization ' + specNum + ': ' + contractProblems.slice(0, 20).join(' | ') + (contractProblems.length > 20 ? ' | +' + (contractProblems.length - 20) + ' more issue(s).' : ''),
        expectedCount:expectedRows.length,
        foundCount:foundRows,
        matchedNames:matchedNames,
        explicitlyExcluded:excludedNames,
        warnings:warnings,
        metrics:metrics
      };
    }

    return {
      success:true,
      stage:stageName,
      specNum:specNum,
      expectedCount:expectedRows.length,
      foundCount:foundRows,
      matchedNames:matchedNames,
      missingNames:[], unexpectedNames:[], excludedNamesFound:[], countMismatches:[], blankNameRows:[],
      explicitlyExcluded:excludedNames,
      warnings:warnings,
      metrics:metrics
    };
  } catch (e) {
    return { success:false, error:stageName + ' QA Error: ' + e.message };
  } finally {
    if (importedFileId) try { DriveApp.getFileById(importedFileId).setTrashed(true); } catch (cleanupError) {}
  }
}