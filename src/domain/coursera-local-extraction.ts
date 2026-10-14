import { CTI_RELEASE_REGISTRY_ } from "../engine/release.js";
import { validateSavedCaptureResumeV61515 } from "../extractors/coursera/runtime.js";
import {
  evaluateCourseraCapture,
  hasCourseraDirectDataCaptureMarker,
  parseCourseraShellUrl,
  type CourseraCaptureVerdict,
} from "./coursera-background-extraction.ts";
import { readCourseraCaptureFileJson } from "./coursera-capture-file.ts";
import { directDataCoverageSummaryV1 } from "../extractors/coursera/direct-data-summary.js";

// Legacy Protocol commands embed a resume JSON literal. File inspection uses
// the separate bounded JSON/gzip transport reader below.
export const MAX_LOCAL_COURSERA_CAPTURE_BYTES = 40 * 1024 * 1024;

export interface DirectCourseraCaptureSummary {
  coverage: ReturnType<typeof directDataCoverageSummaryV1>;
  currentAttempt: { requests: number | null; elapsedMs: number | null };
  inheritedBudget: { requests: number | null; elapsedMs: number | null };
  cumulativeBudget: { requests: number | null; elapsedMs: number | null };
  timingSource: "RECORDED_ATTEMPT" | "RECEIPT_SPAN" | "UNAVAILABLE";
  mediaContinuation: {
    retainedAssessmentObservations: boolean;
    baseSourceCapturedAt: string;
  } | null;
  media: {
    currentAttempt: { requests: number | null; bytes: number | null };
    cumulativeBudget: { requests: number | null; bytes: number | null };
  } | null;
}

export interface LocalCourseraCaptureInspection {
  courseId: string;
  schemaVersion: number;
  extractor: string;
  buildId: string;
  capturedAt: string;
  captureMode: "AUTHORING_EDITOR" | "BOUND_AUTHORING_DRAFT_API";
  verdict: CourseraCaptureVerdict;
  currentSchema: boolean;
  currentVersion: boolean;
  resumeAvailable: boolean;
  pausedBatch: boolean;
  batchVisits: number;
  authoringShellUrl: string;
  directSummary: DirectCourseraCaptureSummary | null;
}

const record = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Select a full CTI Coursera capture JSON.");
  return value as Record<string, any>;
};

function directCapturePresentation(
  capture: Record<string, any>,
): DirectCourseraCaptureSummary {
  const fingerprints = capture.fingerprints as Record<string, any>[];
  const direct =
    (capture.meta || capture.extractionMeta)?.directDataCapture || {};
  const coverage = directDataCoverageSummaryV1(
    fingerprints.map((item) => {
      const payload = item.payload || {},
        contract = item.captureContract || payload.captureContract || {},
        references = Array.isArray(
          payload.directDataEvidence?.unresolvedAssetReferences,
        )
          ? payload.directDataEvidence.unresolvedAssetReferences
          : [];
      return {
        type: item.type,
        contract,
        processed:
          contract.status !== "UNVISITED_DIRECT_ITEM" &&
          !!payload.directDataSources &&
          !!(
            payload.directDataSources.atom ||
            payload.directDataSources.materials
          ),
        questions: Array.isArray(payload.structuredAssessment?.questions)
          ? payload.structuredAssessment.questions.length
          : 0,
        assetReferenceCount:
          payload.directDataEvidence?.assetReferenceCount || references.length,
        assetReferenceIds: [
          ...references.map(
            (reference: Record<string, any> | null) =>
              reference?.id || reference?.url,
          ),
          ...(Array.isArray(payload.assetDetails)
            ? payload.assetDetails
            : []
          ).map(
            (detail: Record<string, any> | null) =>
              detail?.assetId || detail?.url,
          ),
        ],
        missingPointerCount: references.filter(
          (reference: Record<string, any> | null) =>
            !reference?.id && !reference?.url,
        ).length,
      };
    }),
  );
  const nonnegative = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const stats = direct.stats || {};
  const cumulativeBudget = {
    requests: nonnegative(stats.cumulativeBudget?.requests ?? stats.requests),
    elapsedMs: nonnegative(
      stats.cumulativeBudget?.elapsedMs ?? stats.elapsedMs,
    ),
  };
  const recordedTime = nonnegative(stats.currentAttempt?.elapsedMs),
    recordedRequests = nonnegative(stats.currentAttempt?.requests);
  let currentAttempt = {
    requests: recordedRequests,
    elapsedMs: recordedTime,
  };
  let timingSource: DirectCourseraCaptureSummary["timingSource"] =
    recordedTime !== null ? "RECORDED_ATTEMPT" : "UNAVAILABLE";
  if (recordedTime === null) {
    // v1.0/v1.1 recorded cumulative time alongside this attempt's resource
    // counts. Saved question receipts can predate a resume by hours; only
    // observations after the current material read belong to this attempt.
    const timestamp = (value: unknown): number | null => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value))
        return null;
      const time = Date.parse(value);
      return Number.isFinite(time) ? time : null;
    };
    const first = timestamp(direct.materialsReceipt?.observedAt),
      extractedAt = timestamp(capture.extractedAt),
      observations = new Map<string, number>();
    const observe = (receipt: any): void => {
      const time = timestamp(receipt?.observedAt);
      if (
        first === null ||
        time === null ||
        time < first ||
        (extractedAt !== null && time > extractedAt) ||
        typeof receipt?.resource !== "string"
      )
        return;
      const key = JSON.stringify([
        receipt.resource,
        receipt.id,
        receipt.observedAt,
      ]);
      observations.set(key, time);
    };
    for (const receipt of [
      direct.materialsReceipt,
      direct.courseReceipt,
      direct.finalMaterialsReceipt,
    ])
      observe(receipt);
    for (const item of fingerprints) {
      const payload = item.payload || {},
        receipts = payload.directDataSources?.receipts || {},
        assessment = payload.assessmentApiEvidence || {};
      for (const receipt of [
        receipts.atom,
        receipts.relation,
        receipts.materials,
        receipts.stability?.receipt,
      ])
        observe(receipt);
      for (const receipt of Array.isArray(assessment.receipts)
        ? assessment.receipts
        : [])
        observe(receipt);
      for (const stability of Array.isArray(assessment.groupStability)
        ? assessment.groupStability
        : [])
        observe(stability?.receipt);
    }
    if (observations.size > 1) {
      let minimum = Infinity,
        maximum = -Infinity;
      for (const time of observations.values()) {
        minimum = Math.min(minimum, time);
        maximum = Math.max(maximum, time);
      }
      const resourceCounts = Object.values(stats.byResource || {}),
        resourceRequests = resourceCounts.every(
          (count) => Number.isSafeInteger(count) && Number(count) >= 0,
        )
          ? resourceCounts.reduce<number>(
              (total, count) => total + Number(count),
              0,
            )
          : null;
      currentAttempt = {
        requests:
          recordedRequests ??
          (resourceRequests !== null &&
          resourceRequests > 0 &&
          (cumulativeBudget.requests === null ||
            resourceRequests <= cumulativeBudget.requests)
            ? resourceRequests
            : observations.size),
        elapsedMs: maximum - minimum,
      };
      timingSource = "RECEIPT_SPAN";
    }
  }
  const difference = (total: number | null, current: number | null) =>
    total !== null && current !== null && total >= current
      ? total - current
      : null;
  const continuation = direct.mediaEnrichment,
    media = stats.media;
  const baseCapturedAt = continuation?.baseSourceCapturedAt;
  return {
    coverage,
    currentAttempt,
    inheritedBudget: {
      requests:
        nonnegative(stats.inheritedBudget?.requests) ??
        difference(cumulativeBudget.requests, currentAttempt.requests),
      elapsedMs:
        nonnegative(stats.inheritedBudget?.elapsedMs) ??
        difference(cumulativeBudget.elapsedMs, currentAttempt.elapsedMs),
    },
    cumulativeBudget,
    timingSource,
    mediaContinuation:
      continuation?.scope === "REFERENCED_READING_MEDIA_ONLY"
        ? {
            retainedAssessmentObservations:
              continuation.retainedAssessmentObservations === true,
            baseSourceCapturedAt:
              typeof baseCapturedAt === "string" &&
              /^\d{4}-\d{2}-\d{2}T/.test(baseCapturedAt) &&
              Number.isFinite(Date.parse(baseCapturedAt))
                ? baseCapturedAt
                : "",
          }
        : null,
    media:
      media && typeof media === "object"
        ? {
            currentAttempt: {
              requests: nonnegative(media.currentAttempt?.requests),
              bytes: nonnegative(media.currentAttempt?.bytes),
            },
            cumulativeBudget: {
              requests: nonnegative(media.requests),
              bytes: nonnegative(media.bytes),
            },
          }
        : null,
  };
}

export function inspectLocalCourseraCapture(
  value: unknown,
  expectedShellUrl = "",
): LocalCourseraCaptureInspection {
  const capture = record(value);
  if (
    capture.kind === "FOCUSED_EXTRACTOR_DIAGNOSTIC" ||
    capture.notForCourseAudit === true ||
    capture.schemaVersion === "CTI_EXTRACTOR_TRIAL_V1"
  )
    throw new Error(
      "This is a focused diagnostic capture, not a full Coursera course capture.",
    );
  if (capture.kind === "CTI_COURSERA_READING_RECOVERY")
    throw new Error(
      "This is a supplemental Reading recovery. Select the original full Coursera capture.",
    );
  if (!Array.isArray(capture.fingerprints))
    throw new Error(
      "This JSON does not contain the full Coursera fingerprint inventory.",
    );
  if (
    capture.fingerprints.some(
      (item: unknown) =>
        !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    throw new Error(
      "The capture contains an invalid fingerprint item. Use the original unmodified JSON.",
    );
  if (capture.fingerprints.length > 20_000)
    throw new Error(
      "The capture exceeds the supported 20,000-item safety limit.",
    );

  const schemaVersion = Number(capture.schemaVersion);
  const current = CTI_RELEASE_REGISTRY_.courseraExtractor;
  if (
    !Number.isInteger(schemaVersion) ||
    schemaVersion < 1 ||
    schemaVersion > current.schema
  )
    throw new Error(
      "Unsupported Coursera capture schema " +
        String(capture.schemaVersion ?? "missing") +
        ". This CTI release supports schemas 1–" +
        current.schema +
        ".",
    );

  const page = record(capture.page || {});
  const courseId = String(page.courseId || "");
  if (!courseId)
    throw new Error(
      "The capture does not identify its Coursera course/branch ID.",
    );

  const expectedCourseId = expectedShellUrl.trim()
    ? parseCourseraShellUrl(expectedShellUrl).courseId
    : courseId;
  const verdict = evaluateCourseraCapture(capture, expectedCourseId);
  const meta = record(capture.meta || capture.extractionMeta || {});
  const extractor = String(
    capture.extractor || meta.extractor || meta.version || "",
  );
  const buildId = String(capture.buildId || meta.buildId || "");
  const capturedAt = String(
    capture.capturedAt || capture.extractedAt || meta.capturedAt || "",
  );
  const directDraftApi = hasCourseraDirectDataCaptureMarker(capture);
  const currentVersion =
    !directDraftApi && (extractor + " " + buildId).includes(current.version);
  let resumeAvailable = false;
  if (!directDraftApi) {
    try {
      validateSavedCaptureResumeV61515(capture, expectedCourseId);
      resumeAvailable = !verdict.complete;
    } catch {
      /* Older evidence remains inspectable without a resume claim. */
    }
  }
  let authoringShellUrl = "";
  try {
    const target = parseCourseraShellUrl(String(page.url || ""));
    if (target.courseId === courseId) authoringShellUrl = target.shellUrl;
  } catch {
    /* A capture can be inspected without a recorded authoring URL. */
  }

  return {
    courseId,
    schemaVersion,
    extractor: extractor || "Not recorded",
    buildId,
    capturedAt,
    captureMode: directDraftApi
      ? "BOUND_AUTHORING_DRAFT_API"
      : "AUTHORING_EDITOR",
    verdict,
    currentSchema: schemaVersion === current.schema,
    currentVersion,
    resumeAvailable,
    pausedBatch:
      !directDraftApi &&
      meta.localCaptureBatch?.requiresReload === true &&
      meta.automaticLocalCapture?.state !== "FINISHED",
    batchVisits: Number(meta.localCaptureBatch?.visits || 0),
    authoringShellUrl,
    directSummary: directDraftApi ? directCapturePresentation(capture) : null,
  };
}

export function createAutomaticLocalCourseraCommand(
  shellUrl: string,
  currentScript: string,
  token = crypto.randomUUID(),
  savedCapture?: unknown,
  options: {
    freshRun?: boolean;
    controllerOrigin?: string;
    resumeExisting?: boolean;
  } = {},
): string {
  const target = parseCourseraShellUrl(shellUrl);
  if (
    !currentScript.startsWith("javascript:(async function ctiCourseraCapture")
  )
    throw new Error(
      "The current Coursera extractor is unavailable. Reload CTI.",
    );
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(token))
    throw new Error("Invalid local capture identifier.");
  if (options.freshRun && savedCapture !== undefined)
    throw new Error(
      "A fresh full-course capture cannot import a saved capture.",
    );
  if (
    options.resumeExisting !== undefined &&
    typeof options.resumeExisting !== "boolean"
  )
    throw new Error("Invalid browser checkpoint resume option.");
  if (options.resumeExisting && options.freshRun)
    throw new Error(
      "A browser checkpoint resume cannot start a fresh full-course capture.",
    );
  if (options.resumeExisting && savedCapture !== undefined)
    throw new Error(
      "A browser checkpoint resume cannot import a saved capture.",
    );
  let controllerOrigin = "";
  if (options.controllerOrigin) {
    const controller = new URL(options.controllerOrigin);
    if (
      controller.origin !== options.controllerOrigin ||
      controller.username ||
      controller.password ||
      !(
        controller.protocol === "https:" ||
        (controller.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(controller.hostname))
      )
    )
      throw new Error("Invalid local CTI controller origin.");
    controllerOrigin = controller.origin;
  }
  const config = JSON.stringify({
    token,
    courseId: target.courseId,
    shellUrl: target.shellUrl,
    ...(options.freshRun ? { freshRun: true } : {}),
    ...(options.resumeExisting ? { resumeExisting: true } : {}),
    ...(controllerOrigin ? { controllerOrigin } : {}),
  });
  // Chrome owns this registration outside the page's JavaScript context. The
  // extractor checks the durable run state before every subsequent invocation.
  const source =
    "(()=>{\nif(window!==window.top || location.origin!==" +
    JSON.stringify("https://www.coursera.org") +
    " || !location.pathname.startsWith(" +
    JSON.stringify(
      new URL(target.shellUrl).pathname.replace(/\/content.*$/, "/content"),
    ) +
    ")){" +
    (controllerOrigin
      ? "if(window===window.top && window.opener)try{window.opener.postMessage({kind:'CTI_LOCAL_CAPTURE_OUTSIDE_COURSE_V1',token:" +
        JSON.stringify(token) +
        ",courseId:" +
        JSON.stringify(target.courseId) +
        "}," +
        JSON.stringify(controllerOrigin) +
        ");}catch{}"
      : "") +
    "return;}\nwindow.__CTI_AUTOMATIC_LOCAL_CONFIG__=" +
    config +
    ";\n" +
    (savedCapture === undefined
      ? ""
      : "try{if(!JSON.parse(localStorage.getItem(" +
        JSON.stringify("__CTI_AUTOMATIC_LOCAL_V61517_" + token) +
        ")||'null')?.seeded)window.__CTI_LOCAL_CAPTURE_RESUME__=JSON.parse(" +
        savedCourseraResumeLiteral(savedCapture, shellUrl) +
        ");}catch{}\n") +
    currentScript.slice("javascript:".length) +
    "\n})();";
  return JSON.stringify({
    cmd: "Page.addScriptToEvaluateOnNewDocument",
    args: {
      source,
      runImmediately: true,
    },
  });
}

export function createSavedCourseraCheckpointExportCommand(
  shellUrl: string,
  currentScript: string,
): string {
  const target = parseCourseraShellUrl(shellUrl);
  if (
    !currentScript.startsWith("javascript:(async function ctiCourseraCapture")
  )
    throw new Error(
      "The current Coursera extractor is unavailable. Reload CTI.",
    );
  const source =
    '(()=>{if(window!==window.top || location.origin!=="https://www.coursera.org" || !location.pathname.startsWith(' +
    JSON.stringify(
      new URL(target.shellUrl).pathname.replace(/\/content.*$/, "/content"),
    ) +
    "))return;window.__CTI_LOCAL_CHECKPOINT_EXPORT__=" +
    JSON.stringify(target) +
    ";return " +
    currentScript.slice("javascript:".length) +
    "\n})();";
  return JSON.stringify({
    cmd: "Runtime.evaluate",
    args: { expression: source, awaitPromise: true, returnByValue: true },
  });
}

export async function readLocalCourseraCaptureFile(
  file: File,
): Promise<unknown> {
  return readCourseraCaptureFileJson(file);
}

export async function inspectLocalCourseraCaptureFile(
  file: File,
  expectedShellUrl = "",
): Promise<LocalCourseraCaptureInspection> {
  return inspectLocalCourseraCapture(
    await readLocalCourseraCaptureFile(file),
    expectedShellUrl,
  );
}

export function createSavedCourseraResumeScript(
  value: unknown,
  shellUrl: string,
  currentScript: string,
): string {
  const literal = savedCourseraResumeLiteral(value, shellUrl);
  if (
    !currentScript.startsWith("javascript:(async function ctiCourseraCapture")
  )
    throw new Error(
      "The current Coursera extractor is unavailable. Reload CTI and try again.",
    );
  return (
    "javascript:(()=>{\nwindow.__CTI_LOCAL_CAPTURE_RESUME__=JSON.parse(" +
    literal +
    ");\n" +
    currentScript.slice("javascript:".length) +
    "\n})();"
  );
}

function savedCourseraResumeLiteral(value: unknown, shellUrl: string): string {
  const courseId = parseCourseraShellUrl(shellUrl).courseId;
  const capture = record(value);
  const inspection = inspectLocalCourseraCapture(capture, shellUrl);
  if (inspection.captureMode === "BOUND_AUTHORING_DRAFT_API")
    throw new Error(
      "A direct draft-API capture cannot resume through the authoring-editor Protocol command. Use the CTI bookmark for this capture mode.",
    );
  validateSavedCaptureResumeV61515(capture, courseId);
  // Retain observations, not exported accounting claims. The extractor checks
  // these against the live inventory and recalculates every completion verdict.
  const snapshot = JSON.stringify({
    schemaVersion: capture.schemaVersion,
    extractedAt: capture.extractedAt || capture.capturedAt,
    page: { courseId },
    fingerprints: capture.fingerprints,
  });
  if (
    new TextEncoder().encode(snapshot).byteLength >
    MAX_LOCAL_COURSERA_CAPTURE_BYTES
  )
    throw new Error("The saved capture exceeds the 40 MiB resume limit.");
  const literal = JSON.stringify(snapshot).replace(
    /[<>&\u2028\u2029]/g,
    (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  return literal;
}
