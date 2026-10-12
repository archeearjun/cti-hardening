import { isAssessmentLikeFingerprintV662 } from "./assessments-2.js";
import { assessmentTypeKey } from "./assessments.js";
import { isObservedWrittenResponseV6138 } from "./text-and-dom-3.js";
import { uniqueAssetDetails } from "./assets.js";
import { validateSavedCaptureResumeV61515 } from "./runtime.js";
import {
  CTI_CHECKPOINT_DB,
  CTI_CHECKPOINT_SESSION_PREFIX,
  CTI_CHECKPOINT_STORE,
  CTI_CHECKPOINT_TTL_MS,
  CTI_MAX_ITEM_ATTEMPTS,
} from "./config.js";
import { pluginReadinessV6147 } from "./plugins.js";
import { normalizeType, unique } from "./text-and-dom.js";

export function captureContractV6150(fp) {
  const p = (fp && fp.payload) || {};
  const attempts = Math.max(0, Number(p.captureAttempts || 0));
  const normalized = normalizeType((fp && (fp.typeName || fp.type)) || "");
  const typeName = String((fp && fp.typeName) || "").toLowerCase();
  const reasons = [];
  const result = {
    itemId: String((fp && fp.id) || ""),
    type: normalized,
    attempts,
    maxAttempts: CTI_MAX_ITEM_ATTEMPTS,
    complete: false,
    accounted: false,
    needsEditor: false,
    retryable: false,
    status: "UNVERIFIED",
    reasons,
    externalBodyVerified: null,
  };

  if (p.assessmentCaptureInProgress && p.assessmentCaptureInProgress.state === "IN_PROGRESS") {
    reasons.push("ASSESSMENT_QUESTION_COLLECTION_INTERRUPTED");
    return Object.assign(result, {
      accounted: true,
      needsEditor: attempts < CTI_MAX_ITEM_ATTEMPTS,
      retryable: attempts < CTI_MAX_ITEM_ATTEMPTS,
      status: attempts >= CTI_MAX_ITEM_ATTEMPTS ? "UNRESOLVED_AFTER_MAX_ATTEMPTS" : "RETRY_REQUIRED",
    });
  }

  if (p.ingestionFailure && p.ingestionFailure.detected === true) {
    return Object.assign(result, {
      complete: true,
      accounted: true,
      status: "INGESTION_FAILURE_CAPTURED",
      needsEditor: false,
      retryable: false,
    });
  }

  if (p.networkCaptureGap && Number(p.networkCaptureGap.skippedResponses) > 0) {
    reasons.push("NETWORK_CAPTURE_LIMIT_REACHED");
    reasons.push(...(p.networkCaptureGap.reasons || []).slice(0, 8));
    return Object.assign(result, {
      accounted: attempts > 0,
      needsEditor: attempts < CTI_MAX_ITEM_ATTEMPTS,
      retryable: attempts < CTI_MAX_ITEM_ATTEMPTS,
      status: attempts >= CTI_MAX_ITEM_ATTEMPTS
        ? "UNRESOLVED_AFTER_MAX_ATTEMPTS" : "RETRY_REQUIRED",
    });
  }

  const text = String(p.textSample || "");
  const textComplete =
    String(p.textConfidence || "").toLowerCase() === "high" &&
    Number(p.textEvidenceCompleteness || 0) >= 0.9 &&
    p.textCaptureTruncated !== true &&
    !/LOADING|LIMIT_REACHED/i.test(String(p.readingCaptureGap || ""));
  const strongAsset =
    (p.assetDetails || []).some(
      (a) =>
        a &&
        (a.url || a.assetId || a.sha256 || Number(a.size || 0) > 0),
    ) && Number(p.assetEvidenceConfidence || 0) >= 0.9;
  const strongLink =
    (p.links || []).length > 0 && Number(p.linkEvidenceConfidence || 0) >= 0.9;
  const exactReading =
    p.textCaptureEvidence &&
    p.textCaptureEvidence.method === "EXACT_READING_FIELD" &&
    p.textCaptureEvidence.itemId === String((fp && fp.id) || "") &&
    p.textCaptureTruncated !== true &&
    Number(p.textCaptureEvidence.capturedCharacters) ===
      Number(p.textCaptureEvidence.observedCharacters);
  const readingAttachments = p.readingAttachmentEvidence;
  const readingAttachmentsSettled =
    !readingAttachments ||
    !Array.isArray(readingAttachments.unresolvedLabels) ||
    readingAttachments.unresolvedLabels.length === 0;

  if (normalized === "Reading") {
    const exactRequired = typeName === "supplement" || typeName === "reading";
    const observedChars = Number(
      (p.textCaptureEvidence && p.textCaptureEvidence.observedCharacters) || 0,
    );
    const stableEmpty = Boolean(
      p.emptyReadingEvidence &&
        p.emptyReadingEvidence.status === "OBSERVED_STABLE_EMPTY_READING" &&
        p.emptyReadingEvidence.itemId === String((fp && fp.id) || "") &&
        p.emptyReadingEvidence.scope === "EXACT_READING_FIELD",
    );
    if (exactRequired && exactReading && readingAttachmentsSettled) {
      if (observedChars === 0 && (strongAsset || strongLink))
        return Object.assign(result, {
          complete: true,
          accounted: true,
          status: "COMPLETE_ASSET_ONLY_READING",
          needsEditor: false,
          retryable: false,
        });
      if (observedChars === 0 && stableEmpty)
        return Object.assign(result, {
          complete: true,
          accounted: true,
          status: "COMPLETE_EMPTY_READING",
          needsEditor: false,
          retryable: false,
        });
      if (observedChars > 0)
        return Object.assign(result, {
          complete: true,
          accounted: true,
          status: "COMPLETE_READING",
          needsEditor: false,
          retryable: false,
        });
    }
    if (!exactRequired && textComplete && readingAttachmentsSettled)
      return Object.assign(result, {
        complete: true,
        accounted: true,
        status: "COMPLETE_READING",
        needsEditor: false,
        retryable: false,
      });
    if (p.textCaptureTruncated === true) reasons.push("TEXT_TRUNCATED");
    if (exactRequired && !exactReading)
      reasons.push("EXACT_READING_FIELD_NOT_COMPLETE");
    if (
      exactRequired &&
      exactReading &&
      observedChars === 0 &&
      !stableEmpty &&
      !strongAsset &&
      !strongLink
    )
      reasons.push("EMPTY_READING_NOT_STABLY_PROVEN");
    if (!exactRequired && !textComplete && !strongAsset && !strongLink)
      reasons.push("READING_CONTENT_NOT_ESTABLISHED");
    if (!readingAttachmentsSettled)
      reasons.push("ATTACHMENT_URLS_UNRESOLVED");
  } else if (normalized === "Discussion") {
    const scoped =
      /^discussion-prompt(?:-field)?$/.test(String(p.textScopeKind || "")) &&
      text.length > 0 &&
      p.textCaptureTruncated !== true &&
      Number(p.textEvidenceCompleteness || 0) >= 0.94;
    if (scoped)
      return Object.assign(result, {
        complete: true,
        accounted: true,
        status: "COMPLETE_DISCUSSION",
        needsEditor: false,
        retryable: false,
      });
    reasons.push("DISCUSSION_PROMPT_NOT_ESTABLISHED");
  } else if (normalized === "Plugin") {
    const plugin = p.pluginEvidence || {};
    const targets = Array.isArray(plugin.targets) ? plugin.targets : [];
    const frames = Array.isArray(plugin.frames) ? plugin.frames : [];
    const targetObserved =
      targets.length > 0 || plugin.configurationStatus === "TARGET_OBSERVED";
    const readiness = plugin.readiness || pluginReadinessV6147(plugin);
    const terminalReadiness =
      readiness &&
      readiness.pending === false &&
      readiness.status &&
      readiness.status !== "TARGET_NOT_OBSERVED";
    const readable = Number((readiness && readiness.readableFrames) || 0) > 0;
    const externalOnly =
      targetObserved &&
      terminalReadiness &&
      !readable &&
      (Number((readiness && readiness.unreadableFrames) || 0) > 0 ||
        readiness.status === "CONFIGURATION_ONLY");
    if (targetObserved && terminalReadiness) {
      const backgroundBodyObserved=Boolean(
        plugin.backgroundCapture &&
        plugin.externalBodyVerified === true &&
        Number(plugin.backgroundCapture.bodyObservedFrames || 0) > 0
      );
      const backgroundScopeComplete=Boolean(
        plugin.backgroundCapture &&
        plugin.backgroundCapture.scopeComplete === true &&
        plugin.backgroundCapture.interactionVerified === true
      );
      if (backgroundBodyObserved && !backgroundScopeComplete) {
        reasons.push("EXTERNAL_PLUGIN_SCOPE_NOT_VERIFIED");
        return Object.assign(result, {
          complete: false,
          accounted: true,
          status: "ACCOUNTED_EXTERNAL_BODY_OBSERVED",
          needsEditor: false,
          retryable: false,
          externalBodyVerified: true,
        });
      }
      if (externalOnly) {
        const crossOrigin = frames.some((f) =>
          /CROSS_ORIGIN|INACCESSIBLE/.test(String((f && f.access) || "")),
        );
        reasons.push(
          crossOrigin
            ? "EXTERNAL_BODY_UNREADABLE_CROSS_ORIGIN"
            : "EXTERNAL_BODY_NOT_OBSERVED",
        );
        return Object.assign(result, {
          complete: false,
          accounted: true,
          status: "ACCOUNTED_EXTERNAL_TARGET_ONLY",
          needsEditor: false,
          retryable: false,
          externalBodyVerified: false,
        });
      }
      return Object.assign(result, {
        complete: true,
        accounted: true,
        status: "COMPLETE_PLUGIN",
        needsEditor: false,
        retryable: false,
        externalBodyVerified: true,
      });
    }
    if (!targetObserved) reasons.push("PLUGIN_TARGET_NOT_OBSERVED");
    if (readiness && readiness.pending) reasons.push("PLUGIN_STILL_LOADING");
    if (targetObserved && !terminalReadiness)
      reasons.push("PLUGIN_READINESS_NOT_FINAL");
    if (!frames.length && !targets.length) reasons.push("PLUGIN_SURFACE_EMPTY");
  } else if (
    normalized === "Assignment" ||
    normalized === "Assessment" ||
    isAssessmentLikeFingerprintV662(fp) ||
    !!p.structuredAssessment
  ) {
    const a = p.structuredAssessment || {};
    const c = a.captureCompleteness || {};
    const declared = Number(a.declaredQuestionCount || c.declared || 0);
    const captured = Number(
      a.questionCount || (a.questions || []).length || 0,
    );
    const coverage =
      declared > 0 &&
      captured === declared &&
      c.questionCoverageComplete === true &&
      c.requiredAnswerCoverageComplete === true &&
      (!Array.isArray(c.missingQuestionOrdinals) ||
        c.missingQuestionOrdinals.length === 0) &&
      (!Array.isArray(c.missingRequiredAnswerOrdinals) ||
        c.missingRequiredAnswerOrdinals.length === 0);
    const na = p.nativeAssignment || null;
    const textOnly = Boolean(
      na &&
        na.contentBlockEvidence &&
        na.contentBlockEvidence.completeTextBlockOnly === true &&
        !(na.contentBlockEvidence.blocks || []).some((b) => b.truncated),
    );
    const nativeLearnerContent = Boolean(
      na && String(na.learnerSemanticText || "").trim(),
    );
    const nativeRubricContent = Boolean(na && Number(na.rubricCount || 0) > 0);
    const nativeSubmissionBehavior = Boolean(
      na && Object.values(na.submission || {}).some(Boolean),
    );
    const nativeAssignmentComplete = Boolean(
      !declared &&
        na &&
        Number(na.parserConfidence || 0) >= 0.9 &&
        na.currentStateEvidence &&
        na.currentStateEvidence.editorSurfaceObserved === true &&
        (nativeLearnerContent ||
          nativeRubricContent ||
          nativeSubmissionBehavior),
    );
    const questionPositionsComplete = Boolean(
      declared > 0 &&
        captured === declared &&
        c.questionCoverageComplete === true &&
        (!Array.isArray(c.missingQuestionOrdinals) ||
          c.missingQuestionOrdinals.length === 0) &&
        Array.isArray(a.questions) &&
        a.questions.length === declared &&
        a.questions.every((q) => q && q.questionOrdinalObserved === true),
    );
    const questionContentComplete = questionPositionsComplete && a.questions.every((q) => {
          if (!String(q.prompt || "").trim() || q.optionCaptureIssue) return false;
          if (isObservedWrittenResponseV6138(q)) return true;
          const type = assessmentTypeKey(q.type || q.rawType);
          if (/^(regex|text-entry)$/.test(type)) return true;
          return /^(single-select|multiple-select|true-false)$/.test(type) &&
            q.optionTextReliable === true && Array.isArray(q.options) &&
            q.options.length >= 2 && q.options.every((o) => o && String(o.text || o.label || "").trim());
        });
    const answerApplicabilityReview = Boolean(
      attempts >= 1 &&
        questionContentComplete &&
        c.requiredAnswerCoverageComplete !== true &&
        na &&
        na.currentStateEvidence &&
        na.currentStateEvidence.editorSurfaceObserved === true &&
        /^Practice$/i.test(String((na.settings || {}).gradeSetting || "")),
    );
    const empty = p.emptyEditorEvidence;
    const stableEmpty = Boolean(
      empty &&
        empty.status === "OBSERVED_EMPTY_EDITOR" &&
        empty.itemId === String((fp && fp.id) || "") &&
        empty.scope === "EXACT_ITEM_ASSIGNMENT_LAYOUT",
    );
    if (coverage)
      return Object.assign(result, {
        complete: true,
        accounted: true,
        status: "COMPLETE_ASSESSMENT",
        needsEditor: false,
        retryable: false,
      });
    if (textOnly)
      return Object.assign(result, {
        complete: true,
        accounted: true,
        status: "COMPLETE_ASSIGNMENT_TEXT_BLOCKS",
        needsEditor: false,
        retryable: false,
      });
    if (nativeAssignmentComplete)
      return Object.assign(result, {
        complete: true,
        accounted: true,
        status: "COMPLETE_NATIVE_ASSIGNMENT",
        needsEditor: false,
        retryable: false,
      });
    if (answerApplicabilityReview) {
      reasons.push("ASSESSMENT_ANSWER_APPLICABILITY_REQUIRES_REVIEW");
      return Object.assign(result, {
        complete: false,
        accounted: true,
        status: "UNRESOLVED_ANSWER_APPLICABILITY_REVIEW",
        needsEditor: false,
        retryable: false,
      });
    }
    if (stableEmpty) {
      reasons.push("OBSERVED_EMPTY_EDITOR_REQUIRES_SOURCE_REVIEW");
      return Object.assign(result, {
        complete: false,
        accounted: true,
        status: "UNRESOLVED_SOURCE_REVIEW",
        needsEditor: false,
        retryable: false,
      });
    }
    if (
      na &&
      !declared &&
      !nativeLearnerContent &&
      !nativeRubricContent &&
      !nativeSubmissionBehavior &&
      Object.keys(na.settings || {}).length > 0
    )
      reasons.push("ASSIGNMENT_SETTINGS_ONLY_CONTENT_NOT_PROVEN");
    if (!declared) reasons.push("ASSESSMENT_DECLARED_COUNT_NOT_ESTABLISHED");
    if (declared && captured !== declared)
      reasons.push("ASSESSMENT_QUESTION_COVERAGE_INCOMPLETE");
    if (questionPositionsComplete && !questionContentComplete)
      reasons.push("ASSESSMENT_QUESTION_CONTENT_INCOMPLETE");
    if (
      c.questionCoverageComplete === true &&
      c.requiredAnswerCoverageComplete !== true
    )
      reasons.push("ASSESSMENT_REQUIRED_ANSWER_EVIDENCE_INCOMPLETE");
  } else {
    if (textComplete || strongAsset || strongLink) {
      return Object.assign(result, {
        complete: true,
        accounted: true,
        status: "COMPLETE_GENERIC_CONTENT",
        needsEditor: false,
        retryable: false,
      });
    }
    reasons.push("NO_STRONG_ITEM_PAYLOAD");
    if (normalized === "unknown" && !typeName && attempts >= 1) {
      reasons.push("UNTYPED_MATERIAL_LEAF_NO_ITEM_PAYLOAD");
      return Object.assign(result, {
        complete: false,
        accounted: true,
        status: "UNRESOLVED_UNTYPED_MATERIAL_LEAF",
        needsEditor: false,
        retryable: false,
      });
    }
  }

  if (attempts >= CTI_MAX_ITEM_ATTEMPTS) {
    return Object.assign(result, {
      complete: false,
      accounted: true,
      status: "UNRESOLVED_AFTER_MAX_ATTEMPTS",
      needsEditor: false,
      retryable: false,
    });
  }
  result.needsEditor = true;
  result.retryable = true;
  result.status = attempts ? "RETRY_REQUIRED" : "EDITOR_REQUIRED";
  return result;
}

export function captureContractSummaryV6150(fp) {
  const c = captureContractV6150(fp);
  return {
    itemId: c.itemId,
    type: c.type,
    status: c.status,
    complete: c.complete,
    accounted: c.accounted,
    needsEditor: c.needsEditor,
    retryable: c.retryable,
    attempts: c.attempts,
    maxAttempts: c.maxAttempts,
    externalBodyVerified: c.externalBodyVerified,
    reasons: (c.reasons || []).slice(0, 12),
  };
}

export function compactDiagnosticV6150(diag, fp) {
  if (!diag) return diag;
  diag.captureContract = captureContractSummaryV6150(fp);
  if (diag.assessmentSurface) {
    const a = diag.assessmentSurface;
    diag.assessmentSurfaceSummary = {
      partCount: Number(a.partCount || 0),
      rootTag: String(a.rootTag || ""),
      rootTestId: String(a.rootTestId || ""),
      emptyProbe:
        (a.layoutDiagnostic && a.layoutDiagnostic.emptyProbe) ||
        a.emptyProbe ||
        null,
      parts: (a.parts || []).slice(0, 8).map((x) => ({
        id: String(x.id || ""),
        testId: String(x.testId || ""),
        visible: Boolean(x.visible),
        textPreview: String(x.textPreview || "").slice(0, 420),
      })),
    };
    delete diag.assessmentSurface;
  }
  diag.questionCycleControlDiagnostics = (
    diag.questionCycleControlDiagnostics || []
  )
    .slice(0, 10)
    .map((x) => ({
      tag: String(x.tag || ""),
      role: String(x.role || ""),
      text: String(x.text || "").slice(0, 180),
      attrs: String(x.attrs || "").slice(0, 280),
      hasOnClick: Boolean(x.hasOnClick),
    }));
  diag.questionCycleReactStateCandidates = (
    diag.questionCycleReactStateCandidates || []
  )
    .slice(0, 6)
    .map((x) => ({
      path: String(x.path || "").slice(0, 240),
      arrayLength: Number(x.arrayLength || 0),
      parsedQuestions: Number(x.parsedQuestions || 0),
      answerRich: Number(x.answerRich || 0),
      optionRich: Number(x.optionRich || 0),
      score: Number(x.score || 0),
      prompts: (x.prompts || [])
        .slice(0, 4)
        .map((v) => String(v || "").slice(0, 140)),
    }));
  diag.questionCycleOutlineDomPreview = (
    diag.questionCycleOutlineDomPreview || []
  ).slice(0, 8);
  diag.questionCycleCandidatePreview = (
    diag.questionCycleCandidatePreview || []
  ).slice(0, 8);
  diag.unmarkedChoiceProbes = (diag.unmarkedChoiceProbes || [])
    .slice(0, 10)
    .map((x) => ({
      partId: String(x.partId || ""),
      status: String(x.status || ""),
      reason: String(x.reason || ""),
      parsedType: String(x.parsedType || ""),
      parsedChoices: Number(x.parsedChoices || 0),
      // Preserve bounded rejection reasons, without option text or DOM dumps.
      controls: (x.controls || []).slice(0, 16).map((control) => ({
        type: String(control.type || ""),
        accepted: control.accepted === true,
        reason: String(control.reason || ""),
        depth: Number(control.depth || 0),
      })),
      labels: (x.labels || []).slice(0, 16).map((label) => ({
        controlType: String(label.controlType || ""),
        rowTag: String(label.rowTag || ""),
        rowHasBox: label.rowHasBox === true,
        display: String(label.display || ""),
        contentVisibility: String(label.contentVisibility || ""),
        reason: String(label.reason || ""),
        scannedNodes: Number(label.scannedNodes || 0),
        renderedTextNodes: Number(label.renderedTextNodes || 0),
        capturedCharacters: Number(label.capturedCharacters || 0),
      })),
    }));
  diag.controlAttempts = (diag.controlAttempts || []).slice(-12);
  diag.responseSummaries = (diag.responseSummaries || []).slice(-5);
  if (diag.captureContract.complete) {
    delete diag.typedEditorDiagnostics;
    delete diag.questionCycleTraversal;
  } else if (
    diag.typedEditorDiagnostics &&
    Array.isArray(diag.typedEditorDiagnostics.nodes)
  ) {
    diag.typedEditorDiagnostics = {
      ...diag.typedEditorDiagnostics,
      nodes: diag.typedEditorDiagnostics.nodes.slice(0, 24).map((x) => ({
        tag: x.tag,
        attributes: x.attributes,
        visible: x.visible,
        frameAccess: x.frameAccess,
        frameLocation: x.frameLocation,
      })),
    };
  }
  return diag;
}

export function checkpointSessionIdV6150(courseId, requestedRunId = "", readOnly = false) {
  const key = CTI_CHECKPOINT_SESSION_PREFIX + String(courseId || "unknown");
  try {
    const now = Date.now();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
    // Recovery reads the existing session even after its normal resume TTL.
    // It must not create, switch, refresh or delete browser checkpoint state.
    if (readOnly) return { id: saved && typeof saved.id === "string" ? saved.id : "", key: "" };
    if (requestedRunId) {
      if (!/^fresh-[A-Za-z0-9_-]{8,100}$/.test(requestedRunId))
        throw new Error("Invalid fresh checkpoint identifier.");
      // A fresh command owns a separate namespace. Keep old records intact,
      // and reuse this same namespace on every automatic document reload.
      localStorage.setItem(key, JSON.stringify({ id: requestedRunId,
        createdAt: saved && saved.id === requestedRunId ? saved.createdAt : now }));
      return { id: requestedRunId, key };
    }
    let id =
      saved &&
      typeof saved.id === "string" &&
      Number.isFinite(Number(saved.createdAt)) &&
      now - Number(saved.createdAt) <= CTI_CHECKPOINT_TTL_MS
        ? saved.id
        : "";
    if (!id) {
      id = "run-" + now + "-" + Math.random().toString(36).slice(2);
      localStorage.setItem(key, JSON.stringify({ id, createdAt: now }));
    }
    return { id, key };
  } catch (_) {
    if (readOnly) return { id: "", key: "" };
    return {
      id: "volatile-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      key: "",
    };
  }
}

export function openCheckpointDbV6150() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(CTI_CHECKPOINT_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.objectStoreNames.contains(CTI_CHECKPOINT_STORE)
        ? req.transaction.objectStore(CTI_CHECKPOINT_STORE)
        : db.createObjectStore(CTI_CHECKPOINT_STORE, { keyPath: "key" });
      if (!store.indexNames.contains("runKey"))
        store.createIndex("runKey", "runKey", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error || new Error("IndexedDB open failed"));
  });
}

export async function createCheckpointManagerV6150(courseId, requestedRunId = "", options = {}) {
  const session = checkpointSessionIdV6150(courseId, requestedRunId, options.readOnly === true);
  const runKey = session.id + "|" + String(courseId || "");
  let db = null;
  let error = "";
  try {
    if (options.readOnly && !session.id)
      throw new Error("No saved checkpoint session was found for this course.");
    if (requestedRunId && !session.key)
      throw new Error("Fresh capture checkpoint session could not be saved.");
    db = await openCheckpointDbV6150();
  } catch (e) {
    error = String((e && e.message) || e);
  }
  const manager = {
    available: !!db,
    runId: session.id,
    runKey,
    error,
    restored: 0,
    saved: 0,
  };
  manager.close = () => { if (db) db.close(); };
  manager.seed = async (capture, fingerprints) => {
    if(options.readOnly)throw new Error('Saved-progress export cannot import or change checkpoints.');
    validateSavedCaptureResumeV61515(capture, courseId);
    if(!db)throw new Error('Browser checkpoints are unavailable. Enable Coursera browser storage before resuming.');
    const current=new Map((fingerprints || []).map(fp=>[String(fp.id),fp]));
    const capturedAt=Date.parse(capture.extractedAt || capture.capturedAt);
    let imported=0,keptNewer=0,skipped=0;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(CTI_CHECKPOINT_STORE,'readwrite');
      const store=tx.objectStore(CTI_CHECKPOINT_STORE);
      for(const saved of capture.fingerprints) {
        const fresh=current.get(saved.id),p=saved.payload;
        const observed=Number(p.captureAttempts || 0)>0 || p.checkpointRestored===true || captureContractV6150(saved).complete;
        if(!fresh || String(saved.name || '')!==String(fresh.name || '') ||
            String(saved.typeName || '')!==String(fresh.typeName || '') || !observed) {skipped++;continue;}
        // A later batch export can contain older restored item observations.
        // Compare the item's observation time before falling back to file time.
        const observedAt=Date.parse(p.lastCaptureAttemptAt || '');
        const savedAt=Number.isFinite(observedAt)?observedAt:capturedAt;
        const key=runKey+'|'+saved.id;
        const req=store.get(key);
        req.onsuccess=()=>{
          if(req.result && Number(req.result.savedAt)>=savedAt) {keptNewer++;return;}
          store.put({key,runKey,itemId:saved.id,savedAt,pass:'saved-json-resume',fingerprint:saved});
          imported++;
        };
      }
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error || new Error('Saved capture checkpoint import failed.'));
      tx.onabort=()=>reject(tx.error || new Error('Saved capture checkpoint import was aborted.'));
    });
    return {available:true,imported,keptNewer,skipped,capturedAt:new Date(capturedAt).toISOString(),
      meaning:'Saved observations restored against current item identities; remaining evidence must still be captured.'};
  };
  manager.restore = async (fingerprints) => {
    if (!db) return { available: false, restored: 0, error };
    let rows = [];
    try {
      rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(CTI_CHECKPOINT_STORE, "readonly");
        const idx = tx.objectStore(CTI_CHECKPOINT_STORE).index("runKey");
        const req = idx.getAll(runKey);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return {
        available: true,
        restored: 0,
        error: String((e && e.message) || e),
      };
    }
    const byId = new Map(
      (fingerprints || []).map((fp) => [String(fp.id || ""), fp]),
    );
    let restored = 0;
    for (const row of rows) {
      const fp = byId.get(String(row.itemId || ""));
      const saved = row.fingerprint;
      if (
        !fp ||
        !saved ||
        String(saved.name || "") !== String(fp.name || "") ||
        String(saved.typeName || "") !== String(fp.typeName || "")
      )
        continue;
      const old = fp.payload || {};
      const next = saved.payload || {};
      fp.payload = Object.assign({}, old, next);
      fp.payload.files = unique([...(old.files || []), ...(next.files || [])], 600);
      fp.payload.links = unique([...(old.links || []), ...(next.links || [])], 600);
      fp.payload.images = unique(
        [...(old.images || []), ...(next.images || [])],
        600,
      );
      fp.payload.embeddedRefs = unique(
        [...(old.embeddedRefs || []), ...(next.embeddedRefs || [])],
        600,
      );
      fp.payload.assetDetails = uniqueAssetDetails(
        [...(old.assetDetails || []), ...(next.assetDetails || [])],
        800,
      );
      fp.evidenceSources = unique(
        [
          ...(fp.evidenceSources || []),
          ...(saved.evidenceSources || []),
          "checkpoint-resume",
        ],
        50,
      );
      fp.payload.checkpointRestored = true;
      restored++;
    }
    manager.restored = restored;
    return {
      available: true,
      restored,
      stored: rows.length,
      runId: session.id,
    };
  };
  manager.save = async (fp, diag, pass) => {
    if(options.readOnly)return false;
    if (!db || !fp || !fp.id) return false;
    let fingerprint;
    try {
      fingerprint = JSON.parse(
        JSON.stringify({
          id: fp.id,
          name: fp.name,
          type: fp.type,
          typeName: fp.typeName,
          path: fp.path,
          payload: fp.payload,
          evidenceSources: fp.evidenceSources,
          evidenceLevel: fp.evidenceLevel,
        }),
      );
    } catch (_) {
      return false;
    }
    // Keep the acquisition decision after a renderer restart. Only explicit
    // codes and bounded counts belong in this receipt; API bodies, question
    // labels, URLs and credentials remain outside the diagnostic projection.
    const safeCode = value => {
      if (!value) return "";
      return /^(?:EDITOR_NOT_CERTIFIED|SESSION_EDITOR_IDENTITY_NOT_VERIFIED|EDITOR_OUTLINE_UNAVAILABLE|UNSUPPORTED_DECLARED_PART_COUNT|AMBIGUOUS_OUTLINE_IDENTITY|INCOMPLETE_LIVE_OUTLINE_INVENTORY|COMPLETE_LIVE_OUTLINE_INVENTORY|INCOMPLETE_OBSERVED_BODY_INVENTORY|AMBIGUOUS_OBSERVED_BODY_INVENTORY|COMPLETE_OBSERVED_BODY_PART_INVENTORY|SAME_ASSIGNMENT_READ_ENDPOINTS_NOT_OBSERVED|EDITOR_IDENTITY_CHANGED_DURING_API_DISCOVERY|EDITOR_IDENTITY_CHANGED_DURING_API_CAPTURE|AUTHORING_API_AUTHENTICATION_FAILED|AUTHORING_API_RATE_LIMITED|ITEM_API_BYTE_LIMIT|API_RESPONSE_BYTE_LIMIT|ITEM_API_DEADLINE|COMPLETE_ITEM_BOUND_AUTHORING_API|AUTHORING_API_EVIDENCE_INCOMPLETE|API_REQUEST_FAILED|API_REQUEST_TIMEOUT|UNEXPECTED_API_REDIRECT|UNEXPECTED_API_MIME|RATE_LIMITED|INVALID_API_ENVELOPE|AMBIGUOUS_API_RESPONSE_IDENTITY|AUTHORING_API_COMPLETE|STABLE_EMPTY_EDITOR|STABLE_TEXT_BLOCK_ONLY_EDITOR|MOUNTED_QUESTIONS_COMPLETE|LOCAL_ASSESSMENT_CHECKPOINT_YIELD|TIME_BUDGET|NO_FURTHER_QUESTIONS|COMPLETE|HTTP_[1-5]\d\d)$/.test(String(value))
        ? String(value) : "UNRECOGNIZED_DIAGNOSTIC_REASON";
    };
    const safeCount = (value, maximum = 20000) =>
      Number.isFinite(Number(value)) ? Math.min(maximum, Math.max(0, Math.floor(Number(value)))) : 0;
    const api = diag && diag.authoringAssessmentApi;
    const apiDiagnostic = api ? {
      requests: safeCount(api.requests),
      maxConcurrentRequests: safeCount(api.maxConcurrentRequests, 100),
      bytes: safeCount(api.bytes, 1024 * 1024 * 1024),
      rateLimitRetries: safeCount(api.rateLimitRetries),
      missingGroups: safeCount(Array.isArray(api.missingGroups) ? api.missingGroups.length : 0),
      missingDefinitions: safeCount(Array.isArray(api.missingDefinitions) ? api.missingDefinitions.length : 0),
      unsupportedGroups: safeCount(Array.isArray(api.unsupportedGroups) ? api.unsupportedGroups.length : 0),
      failures: (Array.isArray(api.failures) ? api.failures : []).slice(0, 40).map(failure => ({
        resource: /^(?:authoringAssignmentQuestionGroups\.v1|authoringAssignmentMachineEvaluableQuestions\.v1)$/.test(String(failure?.resource || "")) ? String(failure.resource) : "",
        status: safeCount(failure?.status, 599),
        reason: safeCode(failure?.reason),
      })),
      inventoryDiscovery: api.inventoryDiscovery ? {
        method: /^(?:OBSERVED_VIRTUAL_RAIL_SCROLL|COMPLETE_MOUNTED_RAIL|COMPLETE_OBSERVED_BODY_PART_INVENTORY)$/.test(String(api.inventoryDiscovery.method || "")) ? String(api.inventoryDiscovery.method) : "",
        scrollSteps: safeCount(api.inventoryDiscovery.scrollSteps, 1000),
        elapsedMs: safeCount(api.inventoryDiscovery.elapsedMs, 900000),
        restored: api.inventoryDiscovery.restored === true,
      } : null,
    } : null;
    const record = {
      key: runKey + "|" + String(fp.id),
      runKey,
      itemId: String(fp.id),
      savedAt: Date.now(),
      pass: String(pass || ""),
      fingerprint,
      diagnostic: diag
        ? {
            id: String(diag.id || ""),
            attempt: Number(diag.attempt || 0),
            completed: Boolean(diag.completed),
            captureContract:
              diag.captureContract || captureContractSummaryV6150(fp),
            extractorVersion: /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(diag.version || "")) ? String(diag.version) : "",
            strongIdentitySeed: diag.strongIdentitySeed === true,
            routeEditorCertified: diag.routeEditorCertified === true,
            sessionEditorCertified: diag.sessionEditorCertified === true,
            authoringAssessmentApiStopReason: safeCode(diag.authoringAssessmentApiStopReason),
            questionCycleStopReason: safeCode(diag.questionCycleStopReason),
            authoringAssessmentApi: apiDiagnostic,
          }
        : null,
    };
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CTI_CHECKPOINT_STORE, "readwrite");
        tx.objectStore(CTI_CHECKPOINT_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      manager.saved++;
      return true;
    } catch (_) {
      return false;
    }
  };
  manager.clear = async () => {
    if(options.readOnly)return;
    if (db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(CTI_CHECKPOINT_STORE, "readwrite");
          const idx = tx.objectStore(CTI_CHECKPOINT_STORE).index("runKey");
          const req = idx.openKeyCursor(IDBKeyRange.only(runKey));
          req.onsuccess = () => {
            const cur = req.result;
            if (cur) {
              tx.objectStore(CTI_CHECKPOINT_STORE).delete(cur.primaryKey);
              cur.continue();
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (_) {}
    }
    try {
      if (session.key) localStorage.removeItem(session.key);
    } catch (_) {}
  };
  return manager;
}

export function finalCaptureAccountingV6150(fingerprints, activeMeta) {
  const items = (fingerprints || []).map((fp) => ({
    id: String(fp.id || ""),
    name: String(fp.name || ""),
    ...captureContractSummaryV6150(fp),
  }));
  const complete = items.filter((x) => x.complete);
  const unresolved = items.filter((x) => !x.complete);
  const unknown = items.filter((x) => !x.status || x.status === "UNVERIFIED");
  const unvisited = ((activeMeta && activeMeta.unvisitedTargetIds) || []).slice();
  const statusCounts = items.reduce(
    (m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m),
    {},
  );
  return {
    inventoryCount: items.length,
    completeCount: complete.length,
    unresolvedCount: unresolved.length,
    unknownCount: unknown.length,
    unvisitedCount: unvisited.length,
    allInventoryAccounted:
      items.length === complete.length + unresolved.length &&
      unknown.length === 0,
    noSilentMisses: unknown.length === 0 && unvisited.length === 0,
    complete:
      unresolved.length === 0 &&
      unknown.length === 0 &&
      unvisited.length === 0,
    terminalAccountedIncompleteCount: unresolved.filter(
      (x) => x.accounted && !x.retryable,
    ).length,
    externalContentUnverifiedCount:
      Number(statusCounts.ACCOUNTED_EXTERNAL_TARGET_ONLY || 0) +
      Number(statusCounts.ACCOUNTED_EXTERNAL_BODY_OBSERVED || 0),
    untypedMaterialLeafCount: Number(
      statusCounts.UNRESOLVED_UNTYPED_MATERIAL_LEAF || 0,
    ),
    emptyReadingCount: Number(statusCounts.COMPLETE_EMPTY_READING || 0),
    assetOnlyReadingCount: Number(
      statusCounts.COMPLETE_ASSET_ONLY_READING || 0,
    ),
    settingsOnlyAssignmentCount: unresolved.filter((x) =>
      (x.reasons || []).includes("ASSIGNMENT_SETTINGS_ONLY_CONTENT_NOT_PROVEN"),
    ).length,
    sourceReviewCount: Number(statusCounts.UNRESOLVED_SOURCE_REVIEW || 0),
    answerApplicabilityReviewCount: Number(
      statusCounts.UNRESOLVED_ANSWER_APPLICABILITY_REVIEW || 0,
    ),
    retryableUnresolvedCount: unresolved.filter((x) => x.retryable).length,
    technicalUnresolvedCount: unresolved.filter(
      (x) =>
        !x.retryable &&
        ![
          "UNRESOLVED_SOURCE_REVIEW",
          "UNRESOLVED_ANSWER_APPLICABILITY_REVIEW",
          "ACCOUNTED_EXTERNAL_TARGET_ONLY",
          "ACCOUNTED_EXTERNAL_BODY_OBSERVED",
        ].includes(x.status),
    ).length,
    unresolved: unresolved.slice(0, 500),
    unvisitedTargetIds: unvisited.slice(0, 500),
    statusCounts,
  };
}
