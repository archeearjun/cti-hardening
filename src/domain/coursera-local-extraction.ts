import { CTI_RELEASE_REGISTRY_ } from "../engine/release.js";
import { validateSavedCaptureResumeV61515 } from "../extractors/coursera/runtime.js";
import {
  evaluateCourseraCapture,
  parseCourseraShellUrl,
  type CourseraCaptureVerdict,
} from "./coursera-background-extraction.ts";

export const MAX_LOCAL_COURSERA_CAPTURE_BYTES = 40 * 1024 * 1024;

export interface LocalCourseraCaptureInspection {
  courseId: string;
  schemaVersion: number;
  extractor: string;
  buildId: string;
  capturedAt: string;
  verdict: CourseraCaptureVerdict;
  currentSchema: boolean;
  currentVersion: boolean;
  resumeAvailable: boolean;
  pausedBatch: boolean;
  batchVisits: number;
  authoringShellUrl: string;
}

const record = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Select a full CTI Coursera capture JSON.");
  return value as Record<string, any>;
};

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
  const currentVersion = (extractor + " " + buildId).includes(current.version);
  let resumeAvailable = false;
  try {
    validateSavedCaptureResumeV61515(capture, expectedCourseId);
    resumeAvailable = !verdict.complete;
  } catch {
    /* Older evidence remains inspectable without a resume claim. */
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
    verdict,
    currentSchema: schemaVersion === current.schema,
    currentVersion,
    resumeAvailable,
    pausedBatch: meta.localCaptureBatch?.requiresReload === true,
    batchVisits: Number(meta.localCaptureBatch?.visits || 0),
    authoringShellUrl,
  };
}

export async function readLocalCourseraCaptureFile(
  file: File,
): Promise<unknown> {
  if (file.size < 1) throw new Error("The selected capture file is empty.");
  if (file.size > MAX_LOCAL_COURSERA_CAPTURE_BYTES)
    throw new Error(
      "The selected Coursera capture exceeds the 40 MiB local inspection limit.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("The selected Coursera capture is not valid JSON.");
  }
  return parsed;
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
  const courseId = parseCourseraShellUrl(shellUrl).courseId;
  const capture = record(value);
  inspectLocalCourseraCapture(capture, shellUrl);
  validateSavedCaptureResumeV61515(capture, courseId);
  if (
    !currentScript.startsWith("javascript:(async function ctiCourseraCapture")
  )
    throw new Error(
      "The current Coursera extractor is unavailable. Reload CTI and try again.",
    );
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
  return (
    "javascript:(()=>{\nwindow.__CTI_LOCAL_CAPTURE_RESUME__=JSON.parse(" +
    literal +
    ");\n" +
    currentScript.slice("javascript:".length) +
    "\n})();"
  );
}
