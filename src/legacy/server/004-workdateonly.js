

function workDateOnly_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
  }
  var text = String(value || '').trim();
  if (!text) return '';
  var parsed = new Date(text);
  if (isNaN(parsed.getTime())) return '';
  return Utilities.formatDate(parsed, Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
}

function workValidateDateOnly_(value, fallback, fieldName) {
  var text = String(value || fallback || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error((fieldName || 'Date') + ' must use YYYY-MM-DD.');
  return text;
}

function workCampaignId_(partnerName, fromDate, toDate, scanAfter) {
  var partnerToken = normalizePartnerName_(partnerName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'partner';
  return ('REDO-' + partnerToken + '-' + fromDate.replace(/-/g, '') + '-' + toDate.replace(/-/g, '') + '-' + scanAfter.replace(/-/g, '')).toUpperCase();
}

function workDisplayCode_(value) {
  var text = String(value || '').trim();
  var match = text.match(/[A-Za-z]{2,8}\d{2,4}/);
  return match ? match[0].toUpperCase() : text.replace(/\.(imscc|zip|xml)$/i, '').trim();
}

function workNumberOrZero_(value) {
  var number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function workScormCount_(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text || /^n\/?a$/i.test(text) || /^none$/i.test(text) || /^no$/i.test(text)) return 0;
  var number = Number(text);
  if (Number.isFinite(number) && number >= 0) return number;
  return 1;
}

function workBuildNaitCatalog_() {
  var cfg = CTI_WORK_SOURCE_CONFIG_.nait;
  var ss = SpreadsheetApp.openById(cfg.catalogId);
  var sheet = ss.getSheetByName(cfg.catalogSheet) || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) throw new Error('NAIT catalog contains no title rows.');
  var headers = data[0];
  var codeIdx = workHeaderIndex_(headers, ['Title Code']);
  var titleIdx = workHeaderIndex_(headers, ['Title']);
  var typeIdx = workHeaderIndex_(headers, ['Coursera Product Type']);
  var ownerIdx = workHeaderIndex_(headers, ['Assignment Owner']);
  var brightIdx = workHeaderIndex_(headers, ['Brightspace Access']);
  var ccIdx = workHeaderIndex_(headers, ['CC Package Access']);
  var importIdx = workHeaderIndex_(headers, ['Import Status']);
  if (codeIdx < 0 || titleIdx < 0) throw new Error('NAIT catalog must contain Title Code and Title columns.');

  var rows = [], byKey = Object.create(null);
  for (var i = 1; i < data.length; i++) {
    var titleCode = String(data[i][codeIdx] || '').trim();
    var title = String(data[i][titleIdx] || '').trim();
    if (!titleCode && !title) continue;
    var displayCode = workDisplayCode_(titleCode || title);
    var titleKey = getMatchKey_(titleCode || displayCode || title);
    if (!titleKey) continue;
    var row = {
      sourceRow: i + 1,
      partner: cfg.partner,
      titleCode: titleCode,
      displayCode: displayCode,
      titleKey: titleKey,
      title: title,
      productType: typeIdx > -1 ? String(data[i][typeIdx] || '').trim() : '',
      owner: ownerIdx > -1 ? String(data[i][ownerIdx] || '').trim() : '',
      brightspaceAccess: brightIdx > -1 ? String(data[i][brightIdx] || '').trim() : '',
      ccPackageAccess: ccIdx > -1 ? String(data[i][ccIdx] || '').trim() : '',
      importStatus: importIdx > -1 ? String(data[i][importIdx] || '').trim() : '',
      expectedFileName: displayCode ? displayCode + '.imscc' : ''
    };
    rows.push(row);
    if (!byKey[titleKey]) byKey[titleKey] = [];
    byKey[titleKey].push(row);
  }
  return { rows: rows, byKey: byKey, sourceName: cfg.catalogSheet, sourceId: cfg.catalogId };
}

function workBuildMarshallCatalog_() {
  var cfg = CTI_WORK_SOURCE_CONFIG_.marshall;
  var ss = SpreadsheetApp.openById(cfg.catalogId);
  var sheet = ss.getSheetByName(cfg.catalogSheet) || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) throw new Error('Marshall catalog contains no title rows.');
  var headers = data[0];
  var fileIdx = workHeaderIndex_(headers, ['Common Cartridge File Name']);
  var titleIdx = workHeaderIndex_(headers, ['Title']);
  var ownerIdx = workHeaderIndex_(headers, ['Assignment Owner']);
  if (fileIdx < 0 || titleIdx < 0) throw new Error('Marshall catalog must contain Common Cartridge File Name and Title columns.');

  var rows = [], byKey = Object.create(null);
  for (var i = 1; i < data.length; i++) {
    var fileName = String(data[i][fileIdx] || '').trim();
    var title = String(data[i][titleIdx] || '').trim();
    if (!fileName && !title) continue;
    var displayCode = workDisplayCode_(fileName || title);
    var titleKey = getMatchKey_(fileName || displayCode || title);
    if (!titleKey) continue;
    var row = {
      sourceRow: i + 1,
      partner: cfg.partner,
      titleCode: displayCode,
      displayCode: displayCode,
      titleKey: titleKey,
      title: title,
      productType: '',
      owner: ownerIdx > -1 ? String(data[i][ownerIdx] || '').trim() : '',
      brightspaceAccess: '',
      ccPackageAccess: '',
      importStatus: '',
      expectedFileName: /\.imscc$/i.test(fileName) ? fileName : (fileName ? fileName + '.imscc' : (displayCode ? displayCode + '.imscc' : ''))
    };
    rows.push(row);
    if (!byKey[titleKey]) byKey[titleKey] = [];
    byKey[titleKey].push(row);
  }
  return { rows: rows, byKey: byKey, sourceName: cfg.catalogSheet, sourceId: cfg.catalogId };
}

function workBuildScormIndex_() {
  var cfg = CTI_WORK_SOURCE_CONFIG_.nait;
  var result = Object.create(null);
  try {
    var ss = SpreadsheetApp.openById(cfg.scormId);
    var sheet = ss.getSheetByName(cfg.scormSheet) || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    if (!data || !data.length) return result;
    var headers = data[0];
    var codeIdx = workHeaderIndex_(headers, ['Coursecode', 'Course Code']);
    var titleIdx = workHeaderIndex_(headers, ['Course Title']);
    var riseIdx = workHeaderIndex_(headers, ['RISE']);
    var storylineIdx = workHeaderIndex_(headers, ['Storyline']);
    var linkIdx = workHeaderIndex_(headers, ['Link']);
    for (var i = 1; i < data.length; i++) {
      var code = codeIdx > -1 ? String(data[i][codeIdx] || '').trim() : '';
      var title = titleIdx > -1 ? String(data[i][titleIdx] || '').trim() : '';
      if (!code && !title) continue;
      var key = getMatchKey_(code || title);
      if (!key) continue;
      result[key] = {
        courseCode: code,
        title: title,
        riseCount: riseIdx > -1 ? workScormCount_(data[i][riseIdx]) : 0,
        storylineCount: storylineIdx > -1 ? workScormCount_(data[i][storylineIdx]) : 0,
        linkLabel: linkIdx > -1 ? String(data[i][linkIdx] || '').trim() : ''
      };
    }
  } catch (e) {
    result._error = String(e && e.message || e);
  }
  return result;
}

function workResolveCatalogCandidate_(candidates, plannerOwner) {
  candidates = candidates || [];
  if (!candidates.length) return { status:'MISSING', row:null, candidates:[] };
  if (candidates.length === 1) return { status:'MATCH', row:candidates[0], candidates:candidates };

  var ownerKey = workOwnerKey_(plannerOwner);
  var ownerMatches = candidates.filter(function(row) { return ownerKey && workOwnerKey_(row.owner) === ownerKey; });
  if (ownerMatches.length === 1) return { status:'MATCH', row:ownerMatches[0], candidates:candidates };

  var completeMatches = candidates.filter(function(row) {
    return String(row.ccPackageAccess || '').toLowerCase() === 'complete' && String(row.importStatus || '').toLowerCase() !== 'pending';
  });
  if (!ownerKey && completeMatches.length === 1) return { status:'MATCH', row:completeMatches[0], candidates:candidates };

  return { status:'AMBIGUOUS', row:null, candidates:candidates };
}

function workExtractCatalogKeysFromText_(text, catalogByKey) {
  var out = [], seen = Object.create(null);
  var source = String(text || '');
  var regex = /\b[A-Za-z]{2,8}\d{2,4}\b/g;
  var match;
  while ((match = regex.exec(source)) !== null) {
    var key = getMatchKey_(match[0]);
    if (!key || !catalogByKey[key] || seen[key]) continue;
    seen[key] = true;
    out.push(key);
  }
  return out;
}

function workReadPlannerGroups_(partnerName, fromDate, toDate, catalogByKey) {
  var cfg = CTI_WORK_SOURCE_CONFIG_;
  var ss = SpreadsheetApp.openById(cfg.plannerId);
  var sheet = ss.getSheetByName(cfg.plannerSheet) || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) throw new Error('Master Planner contains no assignment rows.');
  var headers = data[0];
  var dateIdx = workHeaderIndex_(headers, ['Assignment Date [mm/dd/yyyy]', 'Assignment Date']);
  var partnerIdx = workHeaderIndex_(headers, ['Partner']);
  var methodIdx = workHeaderIndex_(headers, ['Content Ingestion Method']);
  var categoryIdx = workHeaderIndex_(headers, ['Assignment Category']);
  var subCategoryIdx = workHeaderIndex_(headers, ['Assignment Sub-Category']);
  var ownerIdx = workHeaderIndex_(headers, ['Assignment Owner']);
  var totalIdx = workHeaderIndex_(headers, ['Total Title Count']);
  var statusIdx = workHeaderIndex_(headers, ['Status']);
  var remarksIdx = workHeaderIndex_(headers, ['Assignment Owner Remarks']);
  if (dateIdx < 0 || partnerIdx < 0 || ownerIdx < 0) throw new Error('Master Planner is missing Assignment Date, Partner, or Assignment Owner.');

  var partnerKey = normalizePartnerName_(partnerName);
  var groups = Object.create(null);
  for (var i = 1; i < data.length; i++) {
    var rowPartner = String(data[i][partnerIdx] || '').trim();
    if (normalizePartnerName_(rowPartner) !== partnerKey) continue;
    var assignmentDate = workDateOnly_(data[i][dateIdx]);
    if (!assignmentDate || assignmentDate < fromDate || assignmentDate > toDate) continue;
    var method = methodIdx > -1 ? String(data[i][methodIdx] || '').trim() : '';
    if (method && method.toLowerCase().indexOf('smart ingestion') === -1) continue;
    var owner = String(data[i][ownerIdx] || '').trim() || 'Unassigned';
    var groupKey = assignmentDate + '|' + workOwnerKey_(owner);
    if (!groups[groupKey]) groups[groupKey] = {
      key: groupKey,
      assignmentDate: assignmentDate,
      owner: owner,
      expectedTitleAssignments: 0,
      codes: [],
      codeSet: Object.create(null),
      plannerRows: [],
      categories: []
    };
    var group = groups[groupKey];
    var total = totalIdx > -1 ? nonNegativeInteger_(data[i][totalIdx]) : 0;
    group.expectedTitleAssignments += total;
    var remarks = remarksIdx > -1 ? String(data[i][remarksIdx] || '') : '';
    var category = categoryIdx > -1 ? String(data[i][categoryIdx] || '').trim() : '';
    var subCategory = subCategoryIdx > -1 ? String(data[i][subCategoryIdx] || '').trim() : '';
    var status = statusIdx > -1 ? String(data[i][statusIdx] || '').trim() : '';
    if (category && group.categories.indexOf(category) === -1) group.categories.push(category);
    var extracted = workExtractCatalogKeysFromText_(remarks, catalogByKey);
    extracted.forEach(function(key) {
      if (group.codeSet[key]) return;
      group.codeSet[key] = true;
      group.codes.push(key);
    });
    group.plannerRows.push({
      rowNumber: i + 1,
      assignmentDate: assignmentDate,
      category: category,
      subCategory: subCategory,
      status: status,
      totalTitleCount: total,
      remarks: remarks
    });
  }
  return Object.keys(groups).map(function(key) {
    var g = groups[key];
    g.parsedTitleCount = g.codes.length;
    g.unresolvedTitleCount = Math.max(0, g.expectedTitleAssignments - g.parsedTitleCount);
    delete g.codeSet;
    return g;
  }).sort(function(a,b) {
    return a.assignmentDate === b.assignmentDate ? a.owner.localeCompare(b.owner) : a.assignmentDate.localeCompare(b.assignmentDate);
  });
}

function workPackageMetricsFromRow_(row) {
  row = row || [];
  var webcontent = nonNegativeInteger_(row[4]), assessments = nonNegativeInteger_(row[5]), discussions = nonNegativeInteger_(row[6]);
  var weblinks = nonNegativeInteger_(row[7]), lti = nonNegativeInteger_(row[8]), unknown = nonNegativeInteger_(row[9]), empty = nonNegativeInteger_(row[19]);
  var risk = computeRiskMetrics_(webcontent, assessments, discussions, weblinks, lti, unknown, empty);
  var ext = {}, orphans = 0, lexicalTTR = 0, lexicalTokenCount = 0, lexicalContextReliable = false, repeatedTitleRatio = 0, zScores = [], interactiveRuntimeCandidates = 0, scormLikeCandidates = 0, practiceJsonDependencies = 0;
  try { ext = row[10] ? JSON.parse(row[10]) : {}; } catch (e) { ext = {}; }
  if (ext && ext._advanced) {
    orphans = nonNegativeInteger_(ext._advanced.orphans);
    lexicalTTR = Number(ext._advanced.ttr || 0);
    lexicalTokenCount = nonNegativeInteger_(ext._advanced.lexicalTokenCount);
    lexicalContextReliable = ext._advanced.lexicalContextReliable === true;
    repeatedTitleRatio = Number(ext._advanced.repeatedTitleRatio || 0);
    zScores = Array.isArray(ext._advanced.zScores) ? ext._advanced.zScores : [];
    interactiveRuntimeCandidates = nonNegativeInteger_(ext._advanced.interactiveRuntimeCandidates);
    scormLikeCandidates = nonNegativeInteger_(ext._advanced.scormLikeCandidates);
    practiceJsonDependencies = nonNegativeInteger_(ext._advanced.practiceJsonDependencies);
  }
  return {
    modules: nonNegativeInteger_(row[3]),
    webcontent: webcontent,
    assessments: assessments,
    discussions: discussions,
    weblinks: weblinks,
    lti: lti,
    unknown: unknown,
    emptyFolders: empty,
    totalItems: risk.totalItems,
    ifs: risk.ifs,
    ifsPerItem:risk.ifsPerItem, ifsVersion:risk.ifsVersion,
    orphans: orphans,
    lexicalTTR: lexicalTTR, lexicalTokenCount:lexicalTokenCount, lexicalContextReliable:lexicalContextReliable, repeatedTitleRatio:repeatedTitleRatio,
    zScoreCount: zScores.length,
    interactiveRuntimeCandidates: interactiveRuntimeCandidates,
    scormLikeCandidates: scormLikeCandidates,
    practiceJsonDependencies: practiceJsonDependencies
  };
}

function workPackageMetricsFromPayload_(payload) {
  payload = payload || {};
  var stats = payload.stats || {};
  var assessments = nonNegativeInteger_(stats.quizzes) + nonNegativeInteger_(stats.assignments);
  var risk = computeRiskMetrics_(stats.webcontent, assessments, stats.discussions, stats.weblinks, stats.lti, stats.unknown, stats.emptyFolders);
  return {
    modules: nonNegativeInteger_(payload.moduleCount),
    webcontent: nonNegativeInteger_(stats.webcontent),
    assessments: assessments,
    discussions: nonNegativeInteger_(stats.discussions),
    weblinks: nonNegativeInteger_(stats.weblinks),
    lti: nonNegativeInteger_(stats.lti),
    unknown: nonNegativeInteger_(stats.unknown),
    emptyFolders: nonNegativeInteger_(stats.emptyFolders),
    totalItems: risk.totalItems,
    ifs: risk.ifs,
    ifsPerItem:risk.ifsPerItem, ifsVersion:risk.ifsVersion,
    orphans: nonNegativeInteger_(stats.orphans),
    lexicalTTR: Number(stats.lexicalTTR || 0), lexicalTokenCount:nonNegativeInteger_(stats.lexicalTokenCount), lexicalContextReliable:stats.lexicalContextReliable === true, repeatedTitleRatio:Number(stats.repeatedTitleRatio || 0),
    zScoreCount: Array.isArray(stats.zScoreImbalances) ? stats.zScoreImbalances.length : 0,
    interactiveRuntimeCandidates: nonNegativeInteger_(stats.interactiveRuntimeCandidates),
    scormLikeCandidates: nonNegativeInteger_(stats.scormLikeCandidates),
    practiceJsonDependencies: nonNegativeInteger_(stats.practiceJsonDependencies)
  };
}

function getPackageScanHistorySheet_(ss) {
  var headers = ['Scan ID','Timestamp','Package UUID','Action','File Name','Old IFS','New IFS','Old Metrics JSON','New Metrics JSON','Gateway Release','Actor'];
  var sheet = ss.getSheetByName(PACKAGE_SCAN_HISTORY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PACKAGE_SCAN_HISTORY_SHEET_NAME);
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.getRange('1:1').setFontWeight('bold').setBackground('#E0F2FE');
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (e) {}
  }
  return sheet;
}