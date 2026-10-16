import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  assertBrightspaceCaptureIntegrity,
  inspectBrightspaceCaptureEvidence,
} from "./brightspace-capture-evidence.ts";
import {
  attachCourseraArchiveFileBytes,
  readCourseraCaptureFileBytes,
} from "./coursera-capture-file.ts";
import { reviewCapture } from "./capture-review.ts";

type Row = Record<string, any>;
const row = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(row) : [];
const literal = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const nativeId = (value: unknown) =>
  /^[A-Za-z0-9_.:-]{1,160}$/.test(literal(value)) ? literal(value) : "";
const encoder = new TextEncoder();
export const MAX_CAPTURE_SHARE_REVIEW_BYTES = 96 * 1024;
const MAX_DETAILS = 200;
const queryIdentities = new Set([
  "id",
  "itemid",
  "ou",
  "orgunitid",
  "topicid",
  "assetid",
  "fileid",
  "type",
]);
function shareQueryIdentity(key: string, value: string) {
  if (!queryIdentities.has(key)) return false;
  // A permitted key is not permission to relay an arbitrary URL or access
  // payload. Query values must remain plain native identities.
  if (/^[A-Za-z0-9_.-]{1,160}$/.test(value)) return true;
  if (key !== "fileid") return false;
  // Brightspace coursefile quicklinks can contain a relative file path. Keep
  // plain path segments, but exclude nested URLs, escapes and traversal.
  return (
    /^[\p{L}\p{N}_./ ()-]{1,512}$/u.test(value) &&
    !value.startsWith("//") &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

/** Sharing removes access parameters; the original file is never modified. */
export function captureReviewShareUrl(value: unknown, base?: string) {
  if (!literal(value).trim() || literal(value).length > 16384) return "";
  try {
    const url = new URL(literal(value), base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      return "";
    for (const [key, entry] of [...url.searchParams])
      if (!shareQueryIdentity(key.toLowerCase(), entry))
        url.searchParams.delete(key);
    url.hash = "";
    return url.href.length <= 2048 ? url.href : "";
  } catch {
    return "";
  }
}

export interface CaptureShareReview {
  kind: "CTI_CAPTURE_SHARE_REVIEW";
  schemaVersion: 1;
  platform: "BRIGHTSPACE" | "COURSERA";
  preparedAt: string;
  scope: string;
  source: {
    fileName: string;
    fileBytes?: number;
    jsonBytes?: number;
    jsonSha256?: string;
    transport?: string;
    title: string;
    extractor: string;
    capturedAt: string;
    captureStatus: string;
    courseId: string;
    pageUrl: string;
  };
  localCheck: {
    status: "PASSED" | "FAILED";
    originalIntegrity: string;
    errors: string[];
    meaning: string;
  };
  wholeCourseCoverage: "UNVERIFIED";
  counts: Record<string, number | null>;
  collectorReportedSummary: Record<string, string | number | boolean>;
  findings: Array<{
    code: string;
    severity: string;
    nativeItemId: string;
    itemName: string;
    path: string;
    detail: string;
    action: string;
  }>;
  acquisitionGaps: Array<{
    nativeItemId: string;
    sourceKind: string;
    parentId: string;
    path: string;
    url: string;
    reason: string;
  }>;
  items: Array<{
    nativeItemId: string;
    kind: string;
    title: string;
    path: string;
    url: string;
    status: string;
  }>;
  warnings: string[];
  omissions: {
    findings: number;
    acquisitionGaps: number;
    items: number;
    warnings: number;
    textFieldsClipped: number;
    originalBodies: "EXCLUDED_FROM_SHARE_REPORT";
  };
}

/** A bounded, allowlisted diagnostic projection, never a substitute capture.
 * Retained originals are checked locally before body data is discarded. */
export function createCaptureShareReview(
  value: unknown,
  fileName: string,
  options: {
    preparedAt?: string;
    progress?: (phase: string) => void;
  } = {},
): CaptureShareReview {
  const capture = row(value),
    meta = { ...row(capture.extractionMeta), ...row(capture.meta) },
    brightspace = /brightspace/i.test(
      literal(capture.extractor || meta.extractor),
    );
  if (
    capture.kind === "CTI_CAPTURE_SHARE_REVIEW" ||
    capture.notForCourseAudit === true ||
    capture.kind === "FOCUSED_EXTRACTOR_DIAGNOSTIC"
  )
    throw Error(
      "Choose the original full capture, not a diagnostic or share report.",
    );
  if (
    brightspace
      ? !Array.isArray(capture.contentTree)
      : !Array.isArray(capture.fingerprints)
  )
    throw Error("Choose a full CTI Brightspace or Coursera capture JSON.");
  let clipped = 0;
  const clean = (value: unknown, limit = 300) => {
    const source = literal(value)
      // Inline data is original content too; remove its entire URL before
      // clipping a warning or finding, rather than sharing a base64 prefix.
      .replace(/\bdata:[^\s<>"']*/gi, "[inline data omitted]")
      .replace(
        /\bhttps?:\/\/[^\s<>"'()[\]{}]+/gi,
        (url) => captureReviewShareUrl(url) || "[URL omitted]",
      )
      .replace(
        /\b(?:authorization|cookie|set-cookie|x-api-key)\s*:\s*[^\r\n]*/gi,
        "[access header omitted]",
      )
      .replace(
        /\b(?:access_?token|hmac|signature|password|secret)\s*[:=]\s*[^\s;,]+/gi,
        "[access parameter omitted]",
      );
    if (source.length <= limit) return source;
    clipped++;
    return source.slice(0, Math.max(0, limit - 1)) + "…";
  };
  const path = (value: unknown) =>
    clean(Array.isArray(value) ? value.map(literal).join(" > ") : value, 350);
  const page = row(capture.page),
    course = row(capture.course),
    pageUrl = captureReviewShareUrl(page.url),
    nodes: Row[] = [];
  const visit = (values: unknown, depth: number) => {
    if (depth > 100 || nodes.length > 100000)
      throw Error("The capture content tree exceeds the local review bound.");
    for (const node of rows(values)) {
      nodes.push(node);
      visit(node.children, depth + 1);
    }
  };
  if (brightspace) visit(capture.contentTree, 0);
  const items = brightspace ? nodes : rows(capture.fingerprints);
  if (items.length > 100000)
    throw Error("The capture item inventory exceeds the local review bound.");
  let findings: Row[] = [],
    warnings: string[] = [],
    counts: Record<string, number | null> = {},
    originalIntegrity = "NOT_CHECKED",
    errors: string[] = [];
  options.progress?.("Checking retained evidence locally");
  if (brightspace) {
    try {
      const checked = assertBrightspaceCaptureIntegrity(capture);
      findings = checked.findings;
      warnings = checked.warnings;
      counts = { ...checked.counts };
      originalIntegrity = checked.originalIntegrity;
    } catch (error) {
      errors.push(
        clean(error instanceof Error ? error.message : String(error), 600),
      );
      originalIntegrity = "FAILED";
      // Inventory findings remain useful when original-body consistency fails;
      // none of these declared counts are labelled as verified.
      try {
        const inspected = inspectBrightspaceCaptureEvidence(capture);
        findings = inspected.findings;
        warnings = inspected.warnings;
        counts = { ...inspected.counts, retainedOriginalBytes: null };
      } catch {
        /* The check error above remains visible. */
      }
    }
  } else {
    try {
      const checked = reviewCapture(capture, fileName, {
        partner: "",
        mode: "OPS_CURRENT",
      });
      findings = checked.findings;
      warnings = checked.warnings;
      counts = { ...checked.counts };
    } catch (error) {
      errors.push(
        clean(error instanceof Error ? error.message : String(error), 600),
      );
    }
    warnings.push(
      "This small review does not independently verify every Coursera original-body reference or full-course completion. Use the full CTI comparison for those checks.",
    );
  }
  const reportedSummary: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(row(capture.summary)).slice(
    0,
    40,
  )) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(key)) continue;
    if (
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    )
      reportedSummary[key] = entry;
    else if (
      typeof entry === "string" &&
      /^(?:status|outcome|completeness|meaning)$/i.test(key)
    )
      reportedSummary[key] = clean(entry);
  }
  const gaps = rows(row(capture.contentAcquisition).gaps);
  for (const warning of Array.isArray(capture.captureWarnings)
    ? capture.captureWarnings
    : [])
    if (typeof warning === "string")
      warnings.push("Capture-reported warning: " + warning);
  if (literal(capture.exportError))
    warnings.push(
      "Capture-reported export error: " + literal(capture.exportError),
    );
  const report: CaptureShareReview = {
    kind: "CTI_CAPTURE_SHARE_REVIEW",
    schemaVersion: 1,
    platform: brightspace ? "BRIGHTSPACE" : "COURSERA",
    preparedAt: options.preparedAt || new Date().toISOString(),
    scope:
      "Small local diagnostic review, not a full capture or server attestation. Original files and full course/question bodies are excluded. Findings can contain short source excerpts. Signed access parameters are removed from shared URLs. The original input is unchanged.",
    source: {
      fileName: clean(fileName, 220),
      title: clean(
        course.title ||
          course.name ||
          page.courseName ||
          page.title ||
          fileName,
        220,
      ),
      extractor: clean(
        capture.extractor || meta.extractor || capture.buildId || meta.buildId,
      ),
      capturedAt: clean(
        capture.capturedAt || capture.extractedAt || meta.capturedAt,
        50,
      ),
      captureStatus: clean(row(capture.attempt).status || capture.status, 50),
      courseId: nativeId(
        capture.orgUnitId ||
          course.id ||
          course.Id ||
          course.orgUnitId ||
          meta.courseId ||
          page.courseId,
      ),
      pageUrl,
    },
    localCheck: {
      status: errors.length ? "FAILED" : "PASSED",
      originalIntegrity,
      errors,
      meaning: brightspace
        ? "Brightspace body bytes, hashes, receipts and native bindings were checked by the current local validator. A pass concerns retained evidence consistency; it does not prove source completeness or source authentication. Counts in a failed check are unverified inventory declarations."
        : "The current Coursera capture review ran locally. This status is not a full original-body integrity or course-completeness certification.",
    },
    wholeCourseCoverage: "UNVERIFIED",
    counts,
    collectorReportedSummary: reportedSummary,
    findings: findings.slice(0, MAX_DETAILS).map((finding) => ({
      code: clean(finding.code, 100),
      severity: clean(finding.severity, 30),
      nativeItemId: nativeId(finding.itemId),
      itemName: clean(finding.itemName, 180),
      path: path(finding.path),
      detail: clean(finding.detail, 450),
      action: clean(finding.action, 300),
    })),
    acquisitionGaps: gaps.slice(0, MAX_DETAILS).map((gap) => {
      const binding = row(gap.sourceBinding);
      return {
        nativeItemId: nativeId(binding.id || gap.id),
        sourceKind: clean(binding.kind, 50),
        parentId: nativeId(binding.parentId),
        path: path(binding.path || gap.path),
        url: captureReviewShareUrl(gap.url, pageUrl || undefined),
        reason: clean(gap.reason || gap.status, 300),
      };
    }),
    items: items.slice(0, MAX_DETAILS).map((item) => ({
      nativeItemId: nativeId(item.id || item.Id || item.TopicId),
      kind: clean(item.kind || item.typeName || item.type, 60),
      title: clean(item.title || item.name, 180),
      path: path(item.path),
      url: captureReviewShareUrl(
        item.url || item.Url || row(item.contentEvidence).url,
        pageUrl || undefined,
      ),
      status: clean(
        row(item.contentEvidence).status || row(item.structureEvidence).status,
        70,
      ),
    })),
    warnings: warnings.slice(0, 15).map((warning) => clean(warning, 550)),
    omissions: {
      findings: Math.max(0, findings.length - MAX_DETAILS),
      acquisitionGaps: Math.max(0, gaps.length - MAX_DETAILS),
      items: Math.max(0, items.length - MAX_DETAILS),
      warnings: Math.max(0, warnings.length - 15),
      textFieldsClipped: clipped,
      originalBodies: "EXCLUDED_FROM_SHARE_REPORT",
    },
  };
  // Explicitly report every omitted detail rather than silently clip JSON or
  // let a large course exceed a chat's paste limit.
  while (
    encoder.encode(JSON.stringify(report, null, 2)).length >
    MAX_CAPTURE_SHARE_REVIEW_BYTES
  ) {
    const longest = (["findings", "acquisitionGaps", "items"] as const).reduce(
      (a, b) => (report[a].length >= report[b].length ? a : b),
    );
    if (!report[longest].length)
      throw Error("The local review metadata exceeds the small-report limit.");
    report[longest].pop();
    report.omissions[longest]++;
  }
  return report;
}

export async function prepareCaptureShareReview(
  file: File,
  progress: (phase: string) => void = () => {},
): Promise<CaptureShareReview> {
  progress("Reading your existing capture locally");
  const { bytes, archiveFiles, transport } =
    await readCourseraCaptureFileBytes(file);
  let capture: unknown;
  try {
    capture = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw Error("The selected capture is not valid UTF-8 JSON.");
  }
  if (archiveFiles)
    capture = attachCourseraArchiveFileBytes(capture, archiveFiles);
  const report = createCaptureShareReview(capture, file.name, { progress });
  report.source.fileBytes = file.size;
  report.source.jsonBytes = bytes.length;
  report.source.jsonSha256 = bytesToHex(sha256(bytes));
  if (transport) report.source.transport = transport.encoding;
  // Reserve enough space for these bounded identity fields in reports that
  // reached the detail budget before the file reader supplied them.
  while (
    encoder.encode(JSON.stringify(report, null, 2)).length >
    MAX_CAPTURE_SHARE_REVIEW_BYTES
  ) {
    const key = report.items.length
      ? "items"
      : report.findings.length
        ? "findings"
        : "acquisitionGaps";
    if (!report[key].length)
      throw Error("The local review exceeds its sharing limit.");
    report[key].pop();
    report.omissions[key]++;
  }
  progress("Local review ready to copy");
  return report;
}
