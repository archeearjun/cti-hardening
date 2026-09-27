

function appendPackageScanHistory_(ss, packageUuid, action, fileName, oldMetrics, newMetrics) {
  try {
    var sheet = getPackageScanHistorySheet_(ss);
    var created = new Date();
    var actor = '';
    try { actor = authorize_(); } catch (e) {}
    var scanId = 'SCAN-' + Utilities.formatDate(created, Session.getScriptTimeZone() || 'Etc/UTC', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0,8);
    sheet.appendRow([
      scanId, created, packageUuid, action, sheetSafeText_(fileName || ''),
      oldMetrics && oldMetrics.ifs != null ? Number(oldMetrics.ifs) : '',
      newMetrics && newMetrics.ifs != null ? Number(newMetrics.ifs) : '',
      JSON.stringify(oldMetrics || {}), JSON.stringify(newMetrics || {}),
      CTI_GATEWAY_RELEASE_, sheetSafeText_(actor)
    ]);
    return { status:'SAVED', scanId:scanId, timestamp:created.toISOString() };
  } catch (e) {
    return { status:'FAILED', error:String(e && e.message || e) };
  }
}

function loadLatestPackageScanHistoryMap_(ss) {
  var sheet = ss.getSheetByName(PACKAGE_SCAN_HISTORY_SHEET_NAME);
  var map = Object.create(null);
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getRange(2,1,sheet.getLastRow()-1,11).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var uuid = String(values[i][2] || '');
    if (!uuid || map[uuid]) continue;
    var oldMetrics = {}, newMetrics = {};
    try { oldMetrics = values[i][7] ? JSON.parse(values[i][7]) : {}; } catch (e) {}
    try { newMetrics = values[i][8] ? JSON.parse(values[i][8]) : {}; } catch (e) {}
    var timestamp = values[i][1];
    map[uuid] = {
      scanId:String(values[i][0] || ''),
      timestamp:timestamp instanceof Date ? timestamp.toISOString() : String(timestamp || ''),
      action:String(values[i][3] || ''),
      fileName:String(values[i][4] || ''),
      oldMetrics:oldMetrics,
      newMetrics:newMetrics
    };
  }
  return map;
}

function loadLatestRawQaMap_(ss) {
  var sheet = ss.getSheetByName(QA_RUNS_SHEET_NAME);
  var map = Object.create(null);
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    var row = values[i];
    var uuid = String(row[2] || '');
    var mode = String(row[3] || '');
    if (!uuid || map[uuid] || mode !== 'SINGLE_C0') continue;
    var summary = {};
    try { summary = row[21] ? JSON.parse(String(row[21])) : {}; } catch (e) { summary = {}; }
    var timestamp = row[1];
    map[uuid] = {
      runId:String(row[0] || ''),
      timestamp:timestamp instanceof Date ? timestamp.toISOString() : String(timestamp || ''),
      mode:mode,
      gatewayRelease:String(row[4] || ''),
      extractorVersion:String(row[6] || ''),
      extractorSchema:String(row[7] || ''),
      courseId:String(row[9] || ''),
      sourceFidelity:row[19] === '' ? null : Number(row[19]),
      summary:summary,
      operationalPolicy:summary.operationalPolicy || null,
      reviewStatus:String(row[22] || 'UNREVIEWED')
    };
  }
  return map;
}


function workRedoPolicyDefinition_(partnerName) {
  var partner = normalizePartnerName_(partnerName);
  var isNait = partner === 'nait' || partner.indexOf('northern alberta institute of technology') > -1;
  return {
    id: isNait ? 'NAIT-LFM-REDO-v4' : 'DEFAULT-REDO-v3',
    partner: partnerName || '',
    isNait: isNait,
    // NAIT operational rule: Instructor Resources and Archive remain visible in the
    // fidelity report but do not decide whether Smart Ingestion must be re-run.
    // Student Resources remains in-scope because it can contain learner-facing material.
    nonLearnerFacingRoots: isNait ? ['instructor resources','archive'] : [],
    description: isNait
      ? 'NAIT redo gate excludes Instructor Resources and Archive from automatic re-ingestion. Hidden attachment/media dependencies are parent-aware rather than standalone learner items. Explicit learner-facing ingestion failures and proven hard payload loss trigger the technical REINGEST diagnosis; the ingestion-version guard determines the next action, including manual remediation when the latest Smart Ingestion is already applied; behavior/type/partial/unverified findings are review-first; KEEP requires ≥95% adjusted fidelity and ≥80% evidence coverage.'
      : 'No partner-specific non-learner-facing source paths are excluded from the automatic re-ingestion decision.'
  };
}

function workPathRoot_(pathValue) {
  var path = String(pathValue || '').trim().replace(/\\/g,'/');
  if (!path) return '';
  var parts = path.split(/\s*(?:>|\/|\|)\s*/).filter(String);
  return String(parts.length ? parts[0] : path).trim().toLowerCase();
}

function workSourceItemPolicy_(partnerName, item) {
  var policy = workRedoPolicyDefinition_(partnerName);
  var path = String(item && (item.sourcePath || item.path) || '');
  var root = workPathRoot_(path);
  var normalizedPath = String(path || '').trim().toLowerCase().replace(/\\/g,'/');
  var exempt = policy.nonLearnerFacingRoots.some(function(policyRoot) {
    return root === policyRoot || normalizedPath === policyRoot || normalizedPath.indexOf(policyRoot + ':') === 0 || normalizedPath.indexOf(policyRoot + ' >') === 0 || normalizedPath.indexOf(policyRoot + '/') === 0 || normalizedPath.indexOf(policyRoot + '|') === 0;
  });
  return {
    inDecisionGate: !exempt,
    classification: exempt ? 'NON_LFM_POLICY_EXEMPT' : 'LEARNER_FACING_GATE',
    root: root,
    reason: exempt
      ? 'This source item is under "' + root + '", which NAIT treats as non-learner-facing for Smart Ingestion redo decisions. It remains visible for audit but does not force re-ingestion.'
      : 'This source item remains in the learner-facing Smart Ingestion redo decision gate.'
  };
}

function workExtraItemPolicy_(partnerName, item) {
  var sourceLike = { sourcePath: item && item.path || '' };
  var pathPolicy = workSourceItemPolicy_(partnerName, sourceLike);
  var severity = String(item && item.severity || '').toUpperCase();
  var classification = String(item && item.classification || '');
  var hardIngestionExtra = classification === 'INGESTION_FAILURE_EXTRA';
  var infoOnly = severity === 'INFO' ||
    classification === 'ADMIN_EXTRA' ||
    classification === 'TEMPLATE_EXTRA' ||
    classification === 'CONSOLIDATION_CARRIER' || classification === 'SOURCE_ASSET_CARRIER';

  if (hardIngestionExtra && pathPolicy.inDecisionGate) {
    return {
      inDecisionGate:true,
      forceReingest:true,
      classification:'LEARNER_FACING_INGESTION_FAILURE_EXTRA',
      reason:'Coursera contains an unmatched learner-facing item that explicitly renders an ingestion/conversion failure artifact. A broken extra cannot be treated as harmless additional content.'
    };
  }

  if (!pathPolicy.inDecisionGate || infoOnly) {
    return {
      inDecisionGate:false,
      classification:!pathPolicy.inDecisionGate ? 'NON_LFM_POLICY_EXEMPT' : 'INFORMATIONAL_EXTRA',
      reason:!pathPolicy.inDecisionGate ? pathPolicy.reason : 'Administrative/template/repackaging extras do not by themselves justify re-ingestion.'
    };
  }
  return {
    inDecisionGate:true,
    classification:'LEARNER_FACING_EXTRA_REVIEW',
    reason:'This extra Coursera item is learner-facing or unresolved enough to require review before keeping the existing shell.'
  };
}

function workBuildRawQaOperationalPolicy_(partnerName, itemResults, injected, courseLevelFailure) {
  itemResults = Array.isArray(itemResults) ? itemResults : [];
  injected = Array.isArray(injected) ? injected : [];
  courseLevelFailure = courseLevelFailure && typeof courseLevelFailure === 'object' ? courseLevelFailure : { detected:false };
  var definition = workRedoPolicyDefinition_(partnerName);
  var out = {
    policyId:definition.id, partner:partnerName || '', description:definition.description,
    gateSourceItems:0, policyExemptSourceItems:0, policyExemptNames:[],
    learnerFacingIngestionFailures:0, ingestionFailureNames:[], learnerFacingExtraIngestionFailures:0, extraIngestionFailureNames:[], learnerFacingBehaviorMutations:0, behaviorMutationNames:[], learnerFacingBehaviorUnverified:0, behaviorUnverifiedNames:[], learnerFacingRuntimeReviews:0, runtimeReviewNames:[],
    hiddenDependencyReviews:0, hiddenDependencyNames:[], dependencyProxies:0, dependenciesVerified:0,
    learnerFacingMissing:0, learnerFacingMissingNames:[], learnerFacingHardPayloadLoss:0, hardPayloadLossNames:[],
    learnerFacingManualRemovals:0, manualRemovalNames:[], learnerFacingManualRegressions:0, manualRegressionNames:[],
    learnerFacingTypeMutations:0, learnerFacingPartial:0, learnerFacingUnverified:0, learnerFacingMoved:0,
    learnerFacingStateMutations:0, learnerFacingIntentionalExclusions:0, learnerFacingExtraReview:0,
    informationalExtras:0, policyExemptExtras:0, adjustedObservedFidelity:0, adjustedEvidenceCoverage:0,
    courseLevelFailure:courseLevelFailure,
    recommendationCode:'REVIEW', recommendationLabel:'Review the existing shell before deciding whether to re-ingest',
    recommendationReason:'Operational policy could not establish a clean keep decision.'
  };

  var totalEarned = 0, totalPossible = 0, totalCoverage = 0, coverageDenominator = 0;
  itemResults.forEach(function(item) {
    var hidden = item && (item.hiddenDependency || (item.original && item.original.hiddenDependency));
    var verdict = String(item && item.verdict || '');
    if (verdict === 'DEPENDENCY_PROXY') { out.dependencyProxies++; return; }
    if (verdict === 'DEPENDENCY_VERIFIED') { out.dependenciesVerified++; return; }
    if (verdict === 'HIDDEN_DEPENDENCY_REVIEW') {
      // Hidden children inherit the operational scope of their source path/parent.
      // A hidden dependency under NAIT Instructor Resources or Archive must remain
      // visible in the fidelity report without blocking KEEP/redo decisions.
      var hiddenPolicy = workSourceItemPolicy_(partnerName, item);
      item.operationalPolicy = hiddenPolicy;
      if (!hiddenPolicy.inDecisionGate) {
        out.policyExemptSourceItems++;
        if (out.policyExemptNames.length < 25) out.policyExemptNames.push(String(item.sourceName || item.name || 'Hidden dependency'));
        return;
      }
      out.hiddenDependencyReviews++;
      if (out.hiddenDependencyNames.length < 25) out.hiddenDependencyNames.push(String(item.sourceName || item.name || 'Hidden dependency'));
      return;
    }

    var p = workSourceItemPolicy_(partnerName, item);
    item.operationalPolicy = p;
    if (!p.inDecisionGate) {
      out.policyExemptSourceItems++;
      if (out.policyExemptNames.length < 25) out.policyExemptNames.push(String(item.sourceName || item.name || 'Untitled'));
      return;
    }

    out.gateSourceItems++; coverageDenominator++;
    var issues = Array.isArray(item.issues) ? item.issues : [];
    if (verdict === 'MISSING') {
      out.learnerFacingMissing++;
      if (out.learnerFacingMissingNames.length < 25) out.learnerFacingMissingNames.push(String(item.sourceName || item.name || 'Untitled'));
      totalPossible += 100; totalCoverage += 30;
    } else if (verdict === 'MANUAL_REMOVAL_REVIEW') {
      out.learnerFacingManualRemovals++;
      if (out.manualRemovalNames.length < 25) out.manualRemovalNames.push(String(item.sourceName || item.name || 'Untitled'));
      // Keep the current-shell fidelity honest: a manually removed source-equivalent
      // learner item still contributes zero fidelity, but it is not an ingestion failure.
      totalPossible += 100; totalCoverage += Number(item.evidenceCoverage || 30);
    } else {
      totalEarned += Number(item.earnedPoints || 0); totalPossible += Number(item.possiblePoints || 0); totalCoverage += Number(item.evidenceCoverage || 0);
    }

    if (verdict === 'INGESTION_FAILURE' || issues.indexOf('INGESTION_FAILURE') > -1) {
      out.learnerFacingIngestionFailures++;
      if (out.ingestionFailureNames.length < 25) out.ingestionFailureNames.push(String(item.sourceName || item.name || 'Untitled'));
    }
    if (verdict === 'BEHAVIOR_MUTATION' || issues.indexOf('BEHAVIOR_MUTATION') > -1) {
      out.learnerFacingBehaviorMutations++;
      if (out.behaviorMutationNames.length < 25) out.behaviorMutationNames.push(String(item.sourceName || item.name || 'Untitled'));
    }
    if (issues.indexOf('BEHAVIOR_UNVERIFIED') > -1 || issues.indexOf('SI_GENERATED_BEHAVIOR') > -1) {
      out.learnerFacingBehaviorUnverified++;
      if (out.behaviorUnverifiedNames.length < 25) out.behaviorUnverifiedNames.push(String(item.sourceName || item.name || 'Untitled'));
    }
    if (verdict === 'RUNTIME_REVIEW' || issues.indexOf('RUNTIME_VERIFICATION_REQUIRED') > -1) {
      out.learnerFacingRuntimeReviews++;
      if (out.runtimeReviewNames.length < 25) out.runtimeReviewNames.push(String(item.sourceName || item.name || 'Untitled'));
    }

    var manualRegression = issues.indexOf('MANUAL_PAYLOAD_REGRESSION_SINCE_RAW') > -1;
    if (manualRegression) {
      out.learnerFacingManualRegressions++;
      if (out.manualRegressionNames.length < 25) out.manualRegressionNames.push(String(item.sourceName || item.name || 'Untitled'));
    }
    var hardPayload = qaIsProvenHardPayloadLoss_(item);
    if (hardPayload && !manualRegression) {
      out.learnerFacingHardPayloadLoss++;
      if (out.hardPayloadLossNames.length < 25) out.hardPayloadLossNames.push(String(item.sourceName || item.name || 'Untitled'));
    }

    if (verdict === 'TYPE_MUTATION') out.learnerFacingTypeMutations++;
    else if (verdict === 'PARTIAL') out.learnerFacingPartial++;
    else if (verdict === 'UNVERIFIED') out.learnerFacingUnverified++;
    else if (verdict === 'MOVED') out.learnerFacingMoved++;
    else if (verdict === 'STATE_MUTATION') out.learnerFacingStateMutations++;
    else if (verdict === 'INTENTIONAL_EXCLUSION') out.learnerFacingIntentionalExclusions++;
    else if (verdict === 'MANUAL_REMOVAL_REVIEW') { /* counted separately above */ }
  });

  injected.forEach(function(item) {
    var p = workExtraItemPolicy_(partnerName, item); item.operationalPolicy = p;
    if (p.forceReingest === true) {
      out.learnerFacingExtraIngestionFailures++;
      if (out.extraIngestionFailureNames.length < 25) out.extraIngestionFailureNames.push(String(item.name || 'Untitled Coursera extra'));
    } else if (p.inDecisionGate) out.learnerFacingExtraReview++;
    else if (p.classification === 'NON_LFM_POLICY_EXEMPT') out.policyExemptExtras++;
    else out.informationalExtras++;
  });

  out.adjustedObservedFidelity = totalPossible ? Math.round((totalEarned / totalPossible) * 100) : 0;
  out.adjustedEvidenceCoverage = coverageDenominator ? Math.round(totalCoverage / coverageDenominator) : 0;

  if (courseLevelFailure.detected === true && courseLevelFailure.severity === 'CRITICAL') {
    out.recommendationCode = 'REINGEST'; out.recommendationLabel = 'Re-ingest recommended'; out.recommendationReason = courseLevelFailure.reason || 'Course-level ingestion failure detected.';
  } else if (out.learnerFacingIngestionFailures > 0 || out.learnerFacingExtraIngestionFailures > 0 || out.learnerFacingMissing > 0 || out.learnerFacingHardPayloadLoss > 0) {
    out.recommendationCode = 'REINGEST';
    var reasons = [];
    if (out.learnerFacingIngestionFailures) reasons.push(out.learnerFacingIngestionFailures + ' explicit learner-facing ingestion failure(s)');
    if (out.learnerFacingExtraIngestionFailures) reasons.push(out.learnerFacingExtraIngestionFailures + ' unmatched learner-facing Coursera ingestion failure artifact(s)');
    if (out.learnerFacingMissing) reasons.push(out.learnerFacingMissing + ' learner-facing source item(s) missing');
    if (out.learnerFacingHardPayloadLoss) reasons.push(out.learnerFacingHardPayloadLoss + ' learner-facing item(s) with hard payload/content loss');
    out.recommendationLabel = 'Re-ingest recommended'; out.recommendationReason = reasons.join('; ') + '.';
  } else {
    var reviewCount = out.learnerFacingBehaviorMutations + out.learnerFacingRuntimeReviews + out.hiddenDependencyReviews + out.learnerFacingTypeMutations + out.learnerFacingPartial + out.learnerFacingUnverified + out.learnerFacingMoved + out.learnerFacingStateMutations + out.learnerFacingIntentionalExclusions + out.learnerFacingExtraReview + out.learnerFacingManualRemovals + out.learnerFacingManualRegressions;
    if (reviewCount > 0 || out.adjustedEvidenceCoverage < 80 || out.adjustedObservedFidelity < 95) {
      out.recommendationCode = 'REVIEW';
      var reviewReasons = [];
      if (out.learnerFacingBehaviorMutations) reviewReasons.push(out.learnerFacingBehaviorMutations + ' behavior mutation(s)');
      if (out.learnerFacingBehaviorUnverified) reviewReasons.push(out.learnerFacingBehaviorUnverified + ' assignment behavior verification gap(s)');
      if (out.learnerFacingRuntimeReviews) reviewReasons.push(out.learnerFacingRuntimeReviews + ' interactive/runtime verification item(s)');
      if (out.hiddenDependencyReviews) reviewReasons.push(out.hiddenDependencyReviews + ' hidden dependency review(s)');
      if (out.learnerFacingTypeMutations) reviewReasons.push(out.learnerFacingTypeMutations + ' type mutation(s)');
      if (out.learnerFacingPartial) reviewReasons.push(out.learnerFacingPartial + ' partial item(s)');
      if (out.learnerFacingUnverified) reviewReasons.push(out.learnerFacingUnverified + ' unverified item(s)');
      if (out.learnerFacingManualRemovals) reviewReasons.push(out.learnerFacingManualRemovals + ' same-generation manual removal(s) to confirm');
      if (out.learnerFacingManualRegressions) reviewReasons.push(out.learnerFacingManualRegressions + ' same-generation manual regression(s) to repair/review');
      if (out.learnerFacingExtraReview) reviewReasons.push(out.learnerFacingExtraReview + ' learner-facing extra item(s)');
      if (out.adjustedEvidenceCoverage < 80) reviewReasons.push('policy-adjusted evidence coverage ' + out.adjustedEvidenceCoverage + '%');
      if (out.adjustedObservedFidelity < 95) reviewReasons.push('policy-adjusted observed match ' + out.adjustedObservedFidelity + '%');
      out.recommendationLabel = (out.learnerFacingManualRemovals || out.learnerFacingManualRegressions)
        ? 'Manual cleanup review/fix required — do not re-ingest solely for same-generation manual changes'
        : 'Human review required before deciding on re-ingestion';
      out.recommendationReason = (reviewReasons.length ? reviewReasons.join('; ') : 'Learner-facing review findings remain') + '.';
    } else {
      out.recommendationCode = 'KEEP'; out.recommendationLabel = 'Keep existing raw shell';
      out.recommendationReason = 'No learner-facing ingestion failures, broken unmatched Coursera extras, missing/hard-loss findings, behavior/runtime review findings, or unresolved hidden dependencies remain, with adjusted fidelity ≥95% and evidence coverage ≥80%.';
    }
  }
  return out;
}


function qaApplyIngestionActionabilityPolicy_(operationalPolicy, lineageMeta, snapshotContext) {
  operationalPolicy = operationalPolicy || {};
  lineageMeta = lineageMeta && typeof lineageMeta === 'object' ? lineageMeta : {};
  var status = String(lineageMeta.ingestionCapabilityStatus || lineageMeta.ingestionStatus || '').trim().toUpperCase();
  if (!status) status = 'UNKNOWN';

  operationalPolicy.ingestionCapabilityStatus = status;
  operationalPolicy.diagnosticRecommendationCode = operationalPolicy.recommendationCode || 'REVIEW';
  operationalPolicy.diagnosticRecommendationLabel = operationalPolicy.recommendationLabel || '';
  operationalPolicy.diagnosticRecommendationReason = operationalPolicy.recommendationReason || '';
  operationalPolicy.reingestionUseful = null;
  operationalPolicy.reingestionGuardApplied = false;

  if (status === 'LEGACY_OR_OUTDATED') operationalPolicy.reingestionUseful = true;
  else if (status === 'LATEST_APPLIED') operationalPolicy.reingestionUseful = false;

  if (operationalPolicy.recommendationCode === 'REINGEST') {
    if (status === 'LATEST_APPLIED') {
      operationalPolicy.reingestionGuardApplied = true;
      operationalPolicy.recommendationCode = 'MANUAL_REMEDIATION';
      operationalPolicy.recommendationLabel = 'Manual remediation required — latest Smart Ingestion already applied';
      operationalPolicy.recommendationReason = (operationalPolicy.diagnosticRecommendationReason || 'Material ingestion-origin defects remain.') + ' Re-running the same current Smart Ingestion is not expected to improve these findings. Fix or verify the remaining learner-facing issues manually, or escalate them as Smart Ingestion limitations.';
    } else if (status === 'LEGACY_OR_OUTDATED') {
      operationalPolicy.recommendationLabel = 'Re-ingest once with the latest Smart Ingestion';
      operationalPolicy.recommendationReason = (operationalPolicy.diagnosticRecommendationReason || 'Material ingestion-origin defects remain.') + ' A newer/current Smart Ingestion pass has not yet been applied to this shell.';
    } else {
      operationalPolicy.recommendationCode = 'REVIEW';
      operationalPolicy.recommendationLabel = 'Confirm ingestion version before re-ingesting';
      operationalPolicy.recommendationReason = (operationalPolicy.diagnosticRecommendationReason || 'Material ingestion-origin defects remain.') + ' CTI cannot tell whether a newer Smart Ingestion capability is available. Confirm whether this shell already came from the latest Smart Ingestion before running it again.';
    }
  }

  if (snapshotContext && snapshotContext.mode && status === 'LATEST_APPLIED') {
    operationalPolicy.latestAppliedSnapshot = String(snapshotContext.mode || '');
  }
  return operationalPolicy;
}