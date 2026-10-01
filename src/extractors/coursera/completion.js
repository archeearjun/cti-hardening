import { isAssessmentLikeFingerprintV662 } from "./assessments-2.js";
import { uniqueAssetDetails } from "./assets.js";
import {
  CTI_CHECKPOINT_DB,
  CTI_CHECKPOINT_SESSION_PREFIX,
  CTI_CHECKPOINT_STORE,
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

  if (p.ingestionFailure && p.ingestionFailure.detected === true) {
    return Object.assign(result, {
      complete: true,
      accounted: true,
      status: "INGESTION_FAILURE_CAPTURED",
      needsEditor: false,
      retryable: false,
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
    isAssessmentLikeFingerprintV662(fp)
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

export function checkpointSessionIdV6150(courseId) {
  const key = CTI_CHECKPOINT_SESSION_PREFIX + String(courseId || "unknown");
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = "run-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      sessionStorage.setItem(key, id);
    }
    return { id, key };
  } catch (_) {
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

export async function createCheckpointManagerV6150(courseId) {
  const session = checkpointSessionIdV6150(courseId);
  const runKey = session.id + "|" + String(courseId || "");
  let db = null;
  let error = "";
  try {
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
      if (session.key) sessionStorage.removeItem(session.key);
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
    externalContentUnverifiedCount: Number(
      statusCounts.ACCOUNTED_EXTERNAL_TARGET_ONLY || 0,
    ),
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
    unresolved: unresolved.slice(0, 500),
    unvisitedTargetIds: unvisited.slice(0, 500),
    statusCounts,
  };
}
