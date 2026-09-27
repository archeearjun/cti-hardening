

function workRawQaRecommendation_(rawQa) {
  if (!rawQa) return { code:'NONE', label:'No raw-ingestion audit has been run', tone:'muted' };
  var s = rawQa.summary || {};
  var op = rawQa.operationalPolicy || s.operationalPolicy || null;
  if (op && op.recommendationCode) {
    var tone = op.recommendationCode === 'KEEP' ? 'success' : (op.recommendationCode === 'REINGEST' ? 'danger' : 'warning');
    return {
      code:op.recommendationCode,
      label:op.recommendationLabel || (op.recommendationCode === 'KEEP' ? 'Keep existing raw shell' : op.recommendationCode === 'REINGEST' ? 'Re-ingest recommended' : 'Review existing raw shell'),
      tone:tone,
      reason:op.recommendationReason || '',
      policy:op
    };
  }

  // Backward-compatible fallback for QA runs created before Gateway v6.9.2.
  var critical = Number(s.ownerCritical || 0);
  var missing = Number(s.missing || 0);
  var mutations = Number(s.mutations || 0);
  var partial = Number(s.partial || 0);
  var unverified = Number(s.unverified || 0);
  var review = Number(s.ownerReview || 0);
  var evidenceOnly = Number(s.ownerEvidence || 0);
  var extras = Number(s.extraCourseraItems || 0);
  var moved = Number(s.moved || 0);
  var stateMutations = Number(s.stateMutations || 0);
  var exclusions = Number(s.intentionalExclusions || 0);
  var fidelity = rawQa.sourceFidelity == null ? Number(s.observedFidelity || 0) : Number(rawQa.sourceFidelity || 0);
  var coverage = Number(s.evidenceCoverage || 0);

  if (critical > 0 || missing > 0) {
    return { code:'REINGEST', label:'Material source-fidelity issues found — re-ingest recommended', tone:'danger' };
  }
  // Type mutations are review findings unless a partner policy or item-level evidence
  // proves they are hard learner-facing loss. Smart Ingestion may intentionally convert
  // a Reading into a native/plugin item.
  if (mutations > 0 || partial > 0 || unverified > 0 || review > 0 || evidenceOnly > 0 || extras > 0 || moved > 0 || stateMutations > 0 || exclusions > 0 || coverage < 80 || fidelity < 95) {
    return { code:'REVIEW', label:'Existing raw shell needs review before deciding whether to re-ingest', tone:'warning' };
  }
  if (fidelity >= 95 && coverage >= 80) {
    return { code:'KEEP', label:'Existing raw shell is strongly supported by CTI evidence', tone:'success' };
  }
  return { code:'REVIEW', label:'Existing raw shell needs review before deciding whether to re-ingest', tone:'warning' };
}

function workIsImportOnlyAssignment_(item) {
  return (item && item.plannerCategories || []).some(function(category) {
    return String(category || '').trim().toLowerCase() === 'import only';
  });
}

function workHasScormFlag_(item) {
  return Number(item && item.scorm && item.scorm.riseCount || 0) + Number(item && item.scorm && item.scorm.storylineCount || 0) > 0;
}

function workHasSourceRuntimeFlag_(item) {
  var metrics = item && item.ctiMetrics || {};
  return Number(metrics.interactiveRuntimeCandidates || 0) > 0 ||
         Number(metrics.scormLikeCandidates || 0) > 0 ||
         Number(metrics.practiceJsonDependencies || 0) > 0;
}

function workHasExistingCourseraShell_(item) {
  // The catalog's Import Status=Complete only proves that an import completed;
  // it does not prove the shell is untouched/unpublished. Restrict audit-first
  // automation to planner work explicitly assigned as "Import Only".
  if (!workIsImportOnlyAssignment_(item)) return false;
  var status = String(item && item.catalogImportStatus || '').trim().toLowerCase();
  return status === 'complete' || status === 'completed' || status === 'imported';
}

// Collection progress is manually recorded. It never supplies QA evidence or changes a verdict.
function workEvidenceChecklistSteps_() {
  return [
    {key:'sourceRescanned',group:'Source',label:'Original IMSCC re-scanned in CTI'},
    {key:'brightspaceCaptured',group:'Source',label:'Brightspace source JSON saved'},
    {key:'beforeCourseraCaptured',group:'Before re-ingestion',label:'Old Coursera JSON saved'},
    {key:'beforeExcelSaved',group:'Before re-ingestion',label:'Old Coursera XLSX saved'},
    {key:'beforeQaSaved',group:'Before re-ingestion',label:'BEFORE QA report saved'},
    {key:'reingested',group:'Re-ingestion',label:'Latest Smart Ingestion completed'},
    {key:'afterCourseraCaptured',group:'After re-ingestion',label:'New Coursera JSON saved before manual corrections'},
    {key:'afterExcelSaved',group:'After re-ingestion',label:'New Coursera XLSX saved'},
    {key:'afterQaSaved',group:'After re-ingestion',label:'AFTER QA report saved'},
    {key:'evidenceOrganized',group:'Ready to review',label:'Original IMSCC, source JSON and both Coursera file/report sets kept together'}
  ];
}

function workValidateEvidenceChecklistPatch_(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid evidence checklist.');
  var allowed = workEvidenceChecklistSteps_().map(function(step){ return step.key; });
  var keys = Object.keys(patch), out = {};
  if (!keys.length) throw new Error('No evidence checklist changes were provided.');
  keys.forEach(function(key) {
    if (allowed.indexOf(key) < 0 || typeof patch[key] !== 'boolean') throw new Error('Invalid evidence checklist step: ' + key + '.');
    out[key] = patch[key];
  });
  return out;
}

function workNormalizeEvidenceChecklist_(saved) {
  var out = {};
  workEvidenceChecklistSteps_().forEach(function(step){ out[step.key] = false; });
  if (saved === '' || saved == null) return out;
  if (typeof saved === 'string') {
    try { saved = JSON.parse(saved); } catch(e) { throw new Error('Saved evidence checklist is unreadable. No progress has been overwritten.'); }
  }
  if (saved && typeof saved === 'object' && !Array.isArray(saved) && !Object.keys(saved).length) return out;
  var patch = workValidateEvidenceChecklistPatch_(saved);
  Object.keys(patch).forEach(function(key){ out[key] = patch[key]; });
  return out;
}

function getWorkStateSheet_(ss) {
  var headers = ['Work Key','Campaign ID','Title Key','Scope','Coursera Redo','Course Outline','Source Audit','Specialization Outline','Content Map','Notes','Updated At','Updated By','Version','Evidence Checklist JSON'];
  var sheet = ss.getSheetByName(WORK_STATE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(WORK_STATE_SHEET_NAME);
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.getRange('1:1').setFontWeight('bold').setBackground('#ECFDF3');
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (e) {}
  } else {
    if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    var checklistHeader = String(sheet.getRange(1,14).getValue() || '');
    if (checklistHeader && checklistHeader !== headers[13]) throw new Error('Work-state column 14 is already in use. Progress was not changed.');
    if (!checklistHeader) sheet.getRange(1,14).setValue(headers[13]);
  }
  return sheet;
}

function loadWorkStateMap_(ss, campaignId) {
  var sheet = ss.getSheetByName(WORK_STATE_SHEET_NAME);
  var map = Object.create(null);
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getRange(2,1,sheet.getLastRow()-1,Math.min(14,sheet.getLastColumn())).getValues();
  for (var i = 0; i < values.length; i++) {
    if (campaignId && String(values[i][1] || '') !== campaignId) continue;
    var key = String(values[i][0] || '');
    if (!key) continue;
    map[key] = {
      workKey:key,
      campaignId:String(values[i][1] || ''),
      titleKey:String(values[i][2] || ''),
      scope:String(values[i][3] || 'ACTIVE') || 'ACTIVE',
      courseraRedo:String(values[i][4] || 'NOT_STARTED') || 'NOT_STARTED',
      courseOutline:String(values[i][5] || 'NOT_STARTED') || 'NOT_STARTED',
      sourceAudit:String(values[i][6] || 'NOT_STARTED') || 'NOT_STARTED',
      specializationOutline:String(values[i][7] || 'NOT_STARTED') || 'NOT_STARTED',
      contentMap:String(values[i][8] || 'NOT_STARTED') || 'NOT_STARTED',
      notes:String(values[i][9] || ''),
      updatedAt:values[i][10] instanceof Date ? values[i][10].toISOString() : String(values[i][10] || ''),
      updatedBy:String(values[i][11] || ''),
      version:String(values[i][12] || ''),
      evidenceChecklist:workNormalizeEvidenceChecklist_(values[i][13])
    };
  }
  return map;
}

function workDefaultState_(workKey, campaignId, titleKey) {
  return {
    workKey:workKey, campaignId:campaignId, titleKey:titleKey,
    scope:'ACTIVE', courseraRedo:'NOT_STARTED', courseOutline:'NOT_STARTED',
    sourceAudit:'NOT_STARTED', specializationOutline:'NOT_STARTED', contentMap:'NOT_STARTED',
    notes:'', updatedAt:'', updatedBy:'', version:'', evidenceChecklist:workNormalizeEvidenceChecklist_()
  };
}

function workValidateStatePatch_(patch) {
  patch = patch || {};
  var allowed = {
    scope:['ACTIVE','EXCLUDED'],
    courseraRedo:['NOT_STARTED','IN_PROGRESS','DONE','NOT_REQUIRED','BLOCKED'],
    courseOutline:['NOT_STARTED','DRAFT','SECURED','BLOCKED'],
    sourceAudit:['NOT_STARTED','PASS','REVIEW','BLOCKED'],
    specializationOutline:['NOT_STARTED','DRAFT','SECURED','BLOCKED'],
    contentMap:['NOT_STARTED','IN_PROGRESS','DONE','BLOCKED']
  };
  var out = {};
  Object.keys(patch).forEach(function(field) {
    if (field === 'evidenceChecklist') {
      out.evidenceChecklist = workValidateEvidenceChecklistPatch_(patch.evidenceChecklist);
      return;
    }
    if (field === 'notes') {
      out.notes = String(patch.notes || '').slice(0,4000);
      return;
    }
    if (!allowed[field] || allowed[field].indexOf(String(patch[field] || '')) === -1) throw new Error('Invalid work-state value for ' + field + '.');
    out[field] = String(patch[field]);
  });
  if (!Object.keys(out).length) throw new Error('No supported work-state changes were provided.');
  return out;
}

function updateRedoWorkItemState(workKey, patch, expectedVersion) {
  var editor = authorize_('editor');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success:false, error:'Work queue is busy.' };
  try {
    workKey = String(workKey || '').trim();
    if (!/^[A-Z0-9._|:-]{5,240}$/i.test(workKey)) return { success:false, error:'Invalid work item key.' };
    patch = workValidateStatePatch_(patch);
    var splitAt = workKey.lastIndexOf('|');
    if (splitAt < 1) return { success:false, error:'Invalid work item key.' };
    var campaignId = workKey.slice(0, splitAt), titleKey = workKey.slice(splitAt + 1);
    var packageSheet = getDatabaseSheet_();
    var ss = packageSheet.getParent();
    var sheet = getWorkStateSheet_(ss);
    var values = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,14).getValues() : [];
    var rowIndex = -1, current = workDefaultState_(workKey,campaignId,titleKey);
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '') !== workKey) continue;
      rowIndex = i + 2;
      current = {
        workKey:workKey, campaignId:campaignId, titleKey:titleKey,
        scope:String(values[i][3] || 'ACTIVE'), courseraRedo:String(values[i][4] || 'NOT_STARTED'),
        courseOutline:String(values[i][5] || 'NOT_STARTED'), sourceAudit:String(values[i][6] || 'NOT_STARTED'),
        specializationOutline:String(values[i][7] || 'NOT_STARTED'), contentMap:String(values[i][8] || 'NOT_STARTED'),
        notes:String(values[i][9] || ''), version:String(values[i][12] || ''),
        evidenceChecklist:workNormalizeEvidenceChecklist_(values[i][13])
      };
      break;
    }
    if (expectedVersion != null && String(expectedVersion) !== current.version) return { success:false, error:'This work item changed after the queue loaded. Refresh and try again.' };
    Object.keys(patch).forEach(function(field){
      if (field === 'evidenceChecklist') {
        Object.keys(patch.evidenceChecklist).forEach(function(key){ current.evidenceChecklist[key] = patch.evidenceChecklist[key]; });
      } else current[field] = patch[field];
    });
    var now = new Date(), version = String(Math.max(now.getTime(), (Number(current.version) || 0) + 1));
    var row = [[
      workKey, campaignId, titleKey, current.scope, current.courseraRedo, current.courseOutline,
      current.sourceAudit, current.specializationOutline, current.contentMap, sheetSafeText_(current.notes),
      now, sheetSafeText_(editor), version, JSON.stringify(current.evidenceChecklist)
    ]];
    if (rowIndex > -1) sheet.getRange(rowIndex,1,1,14).setValues(row);
    else sheet.getRange(sheet.getLastRow()+1,1,1,14).setValues(row);
    return { success:true, workKey:workKey, state:{
      scope:current.scope, courseraRedo:current.courseraRedo, courseOutline:current.courseOutline,
      sourceAudit:current.sourceAudit, specializationOutline:current.specializationOutline,
      contentMap:current.contentMap, notes:current.notes, updatedAt:now.toISOString(), updatedBy:editor, version:version,
      evidenceChecklist:current.evidenceChecklist
    }};
  } catch (e) {
    return { success:false, error:'Work state update error: ' + e.message };
  } finally { lock.releaseLock(); }
}

function workBuildPackageIndex_(packageSheet, partnerName) {
  var values = packageSheet.getDataRange().getValues();
  var partnerKey = normalizePartnerName_(partnerName), byKey = Object.create(null);
  for (var i = 1; i < values.length; i++) {
    if (normalizePartnerName_(values[i][1]) !== partnerKey) continue;
    var key = getMatchKey_(values[i][2]);
    if (!key) continue;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ rowNumber:i+1, row:values[i] });
  }
  return byKey;
}

function workPlannerEvidenceForItem_(groups, titleKey) {
  var evidence = [], owner = '', latestDate = '';
  (groups || []).forEach(function(group) {
    if (group.codes.indexOf(titleKey) === -1) return;
    if (!latestDate || group.assignmentDate >= latestDate) { latestDate = group.assignmentDate; owner = group.owner; }
    group.plannerRows.forEach(function(row) {
      evidence.push({
        rowNumber:row.rowNumber, assignmentDate:row.assignmentDate, category:row.category,
        subCategory:row.subCategory, status:row.status, totalTitleCount:row.totalTitleCount
      });
    });
  });
  var categories = [];
  evidence.forEach(function(row){ if (row.category && categories.indexOf(row.category) === -1) categories.push(row.category); });
  return { owner:owner || 'Unassigned', latestDate:latestDate, rows:evidence, categories:categories };
}

function workNextAction_(item, state) {
  state = state || {};
  if (state.scope === 'EXCLUDED') return { code:'EXCLUDED', label:'Excluded from this redo campaign', tone:'muted' };
  if (item.catalogStatus === 'AMBIGUOUS') return { code:'RESOLVE_CATALOG', label:'Resolve duplicate catalog assignment before work begins', tone:'warning' };
  if (item.ctiMatchStatus === 'AMBIGUOUS') return { code:'RESOLVE_CTI_DUPLICATE', label:'Review duplicate CTI package records', tone:'warning' };
  if (!item.ctiUuid) return { code:'UPLOAD_SOURCE', label:'Upload source package: ' + (item.expectedFileName || item.displayCode + '.imscc'), tone:'danger' };
  if (!item.sourceRescanned) return { code:'RESCAN_SOURCE', label:'Re-Scan source IMSCC with the current CTI parser', tone:'primary' };

  if (state.courseraRedo === 'BLOCKED') return { code:'COURSERA_BLOCKED', label:'Resolve Coursera reimport blocker', tone:'danger' };

  // Audit-first rule for titles that already have a completed/imported Coursera shell.
  // Do not re-run Smart Ingestion simply because the tool improved: compare the refreshed
  // source fingerprint against the existing raw/unpublished Coursera shell first.
  if (state.courseraRedo !== 'DONE' && state.courseraRedo !== 'NOT_REQUIRED' && workHasExistingCourseraShell_(item)) {
    if (!item.rawQaFresh) {
      return { code:'AUDIT_EXISTING_RAW', label:'Audit the existing Coursera shell against the refreshed source before re-ingesting', tone:'warning' };
    }
    var recommendation = item.rawQaRecommendation || workRawQaRecommendation_(item.latestRawQa);
    if (recommendation.code === 'KEEP') {
      if (workHasScormFlag_(item) || workHasSourceRuntimeFlag_(item)) {
        return { code:'REVIEW_SCORM_EXISTING', label:'CTI supports the structural/payload evidence, but source runtime/interactivity is flagged — manually launch and verify the source LMS activity and Coursera equivalent before keeping the shell', tone:'warning' };
      }
      return { code:'CONFIRM_KEEP_EXISTING', label:'CTI supports the existing raw shell — mark Coursera reimport “Not required” to proceed', tone:'success' };
    }
    if (recommendation.code === 'REVIEW') {
      return { code:'REVIEW_EXISTING_RAW', label:'Review the existing raw-shell QA findings before deciding whether to re-ingest', tone:'warning' };
    }
    if (recommendation.code === 'REINGEST') {
      return { code:'REDO_COURSERA', label:'Re-run Smart Ingestion in Coursera; CTI found material fidelity issues in the existing shell', tone:'danger' };
    }
  }

  if (state.courseraRedo !== 'DONE' && state.courseraRedo !== 'NOT_REQUIRED') return { code:'REDO_COURSERA', label:'Redo Smart Ingestion in Coursera', tone:'primary' };
  if (state.courseOutline === 'BLOCKED') return { code:'OUTLINE_BLOCKED', label:'Resolve course-outline blocker', tone:'danger' };
  if (state.courseOutline === 'NOT_STARTED') return { code:'BUILD_COURSE_OUTLINE', label:'Create the course outline', tone:'primary' };
  if (state.courseOutline === 'DRAFT' && state.sourceAudit !== 'PASS') return { code:'AUDIT_SOURCE', label:'Audit the course outline against the source LMS', tone:'warning' };
  if (state.sourceAudit === 'BLOCKED' || state.sourceAudit === 'REVIEW') return { code:'AUDIT_REVIEW', label:'Resolve source-LMS audit findings', tone:'warning' };
  if (state.sourceAudit === 'PASS' && state.courseOutline !== 'SECURED') return { code:'SECURE_COURSE_OUTLINE', label:'Secure/finalize the audited course outline', tone:'primary' };

  var needsSpecialization = String(item.productType || '').toLowerCase().indexOf('specialization') > -1 ||
    (item.plannerCategories || []).some(function(category){ return String(category || '').toLowerCase().indexOf('course-to-specialization') > -1; });
  if (needsSpecialization) {
    if (state.specializationOutline === 'BLOCKED') return { code:'SPEC_OUTLINE_BLOCKED', label:'Resolve specialization-outline blocker', tone:'danger' };
    if (state.specializationOutline === 'NOT_STARTED') return { code:'BUILD_SPEC_OUTLINE', label:'Create the specialization outline', tone:'primary' };
    if (state.specializationOutline === 'DRAFT') return { code:'SECURE_SPEC_OUTLINE', label:'Review and secure the specialization outline', tone:'warning' };
    if (state.contentMap === 'BLOCKED') return { code:'CONTENT_MAP_BLOCKED', label:'Resolve content-map blocker', tone:'danger' };
    if (state.contentMap !== 'DONE') return { code:'BUILD_CONTENT_MAP', label:'Create/finalize the content map', tone:'primary' };
  }
  return { code:'COMPLETE', label:'Redo workflow complete', tone:'success' };
}