import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openSourcePackageZip } from "../adapters/source-package-zip.ts";
import {
  hashSourcePackageFile,
  validateSourcePackageFile,
} from "./source-package-file.ts";
import { itemCheckEvidenceRevision } from "./item-check.ts";
import { assessmentMediaResolution } from "../engine/assessment/media-recovery.js";
import type { EvidenceObject } from "./workspace-types.ts";
import type { PackageScan } from "./package-types.ts";

export const SOURCE_ASSET_LIMITS = Object.freeze({
  candidates: 16,
  references: 128,
  fileBytes: 24 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  milliseconds: 120000,
});
const hash = (b: Uint8Array) => bytesToHex(sha256(b));
const validHash = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
/** Reject credentials rather than exporting a partially redacted locator as original. */
export function safeAssetReference(value: string): boolean {
  if (!value || value.length > 4096 || /[\x00-\x1f]/.test(value)) return false;
  try {
    const u = new URL(value, "https://archive.invalid/");
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      ![...u.searchParams.keys()].some((k) =>
        /token|secret|sign|credential|auth|password|session|key|policy/i.test(
          k,
        ),
      )
    );
  } catch {
    return false;
  }
}
function path(value: string): string {
  if (
    !safeAssetReference(value) ||
    /^[a-z]+:/i.test(value) ||
    value.startsWith("//")
  )
    return "";
  try {
    const decoded = decodeURIComponent(value.split(/[?#]/)[0]);
    if (
      decoded.includes("\\") ||
      decoded.startsWith("/") ||
      /[\x00-\x1f]/.test(decoded)
    )
      return "";
    return decoded.replace(/^\.\//, "");
  } catch {
    return "";
  }
}
function relative(base: string, ref: string): string {
  const r = path(ref),
    b = path(base);
  if (!r) return "";
  const segments = (b ? b.split("/").slice(0, -1) : []).concat(r.split("/")),
    out: string[] = [];
  for (const s of segments) {
    if (s === "..") {
      if (!out.length) return "";
      out.pop();
    } else if (s && s !== ".") out.push(s);
  }
  return out.join("/");
}
export interface AssetReference {
  ref: string;
  expectedPath?: string;
  sourceFile?: string;
  sha256?: string;
  dependencyPaths?: string[];
}
/** No directory names or URLs are guessed. Every candidate must exist in this inventory. */
export function sourceAssetCandidates(
  reference: AssetReference,
  paths: string[],
) {
  const known = paths.filter(
    (p) => path(p) === p && !p.split("/").includes(".."),
  );
  const exact = reference.expectedPath
    ? relative("", reference.expectedPath)
    : relative(reference.sourceFile || "", reference.ref);
  const literal = relative("", reference.ref),
    name = (path(reference.ref) || exact).split("/").pop();
  const candidates: { path: string; method: string }[] = [];
  const add = (p: string, method: string) => {
    if (p && known.includes(p) && !candidates.some((c) => c.path === p))
      candidates.push({ path: p, method });
  };
  add(exact, "EXACT_QUESTION_REFERENCE");
  for (const p of reference.dependencyPaths || [])
    if (p.split("/").pop() === name) add(p, "MANIFEST_DEPENDENCY_CANDIDATE");
  add(literal, "EXACT_ARCHIVE_PATH_CANDIDATE");
  for (const p of known)
    if (p.split("/").pop() === name) add(p, "FILENAME_CANDIDATE");
  return {
    expectedPath: exact,
    candidates: candidates.slice(0, SOURCE_ASSET_LIMITS.candidates),
    candidateCount: candidates.length,
    truncated: candidates.length > SOURCE_ASSET_LIMITS.candidates,
    caseVariants: known
      .filter(
        (p) =>
          name &&
          p.split("/").pop() !== name &&
          p.split("/").pop()?.toLowerCase() === name.toLowerCase(),
      )
      .slice(0, SOURCE_ASSET_LIMITS.candidates),
  };
}
/** For diagnostics only: an observed URL must remain within the exact course root. */
export function boundSourceUrl(url: string, courseRoot: string): string | null {
  if (!safeAssetReference(url) || !safeAssetReference(courseRoot)) return null;
  try {
    const root = new URL(courseRoot),
      u = new URL(url, root);
    const p = decodeURIComponent(u.pathname),
      base = decodeURIComponent(root.pathname);
    return root.protocol === "https:" &&
      u.origin === root.origin &&
      base.endsWith("/") &&
      p.startsWith(base) &&
      !p.includes("\\") &&
      !p.split("/").includes("..")
      ? u.href
      : null;
  } catch {
    return null;
  }
}
/** Binary structural checks do not certify rendering, instructional meaning or association. */
export function inspectSourceBinary(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > SOURCE_ASSET_LIMITS.fileBytes)
    throw Error("ASSET_BYTE_LIMIT");
  const ascii = (a: number, b: number) =>
    String.fromCharCode(...bytes.subarray(a, b));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = "",
    width: number | null = null,
    height: number | null = null;
  if (
    bytes.length >= 45 &&
    bytes[0] === 137 &&
    ascii(1, 8) === "PNG\r\n\x1a\n"
  ) {
    let offset = 8,
      ended = false,
      chunks = 0;
    while (offset + 12 <= bytes.length && chunks++ < 4096) {
      const n = view.getUint32(offset),
        end = offset + 12 + n;
      if (end > bytes.length) throw Error("INVALID_PNG_CHUNK");
      const type = ascii(offset + 4, offset + 8);
      let crc = 0xffffffff;
      for (let i = offset + 4; i < offset + 8 + n; i++) {
        crc ^= bytes[i];
        for (let k = 0; k < 8; k++)
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(offset + 8 + n))
        throw Error("INVALID_PNG_CRC");
      if (offset === 8) {
        if (type !== "IHDR" || n !== 13) throw Error("INVALID_PNG_HEADER");
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
      }
      if (type === "IEND") {
        if (n !== 0 || end !== bytes.length) throw Error("INVALID_PNG_END");
        ended = true;
        break;
      }
      offset = end;
    }
    if (!ended || !width || !height) throw Error("INVALID_PNG");
    format = "PNG";
  } else if (
    bytes.length >= 10 &&
    /^GIF8[79]a$/.test(ascii(0, 6)) &&
    bytes.at(-1) === 59
  ) {
    format = "GIF";
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
    if (!width || !height) throw Error("INVALID_GIF");
  } else if (
    bytes.length > 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    format = "JPEG";
  else if (
    bytes.length >= 20 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 12) === "WEBP" &&
    view.getUint32(4, true) + 8 === bytes.length
  )
    format = "WEBP";
  else if (
    bytes.length > 12 &&
    ascii(0, 5) === "%PDF-" &&
    new TextDecoder().decode(bytes.subarray(-1024)).includes("%%EOF")
  )
    format = "PDF";
  else
    throw Error(
      "UNSUPPORTED_OR_INVALID_BINARY: HTML/login bodies are not originals.",
    );
  return {
    sha256: hash(bytes),
    size: bytes.length,
    format,
    detectedMime: (
      {
        PNG: "image/png",
        GIF: "image/gif",
        JPEG: "image/jpeg",
        WEBP: "image/webp",
        PDF: "application/pdf",
      } as Record<string, string>
    )[format],
    width,
    height,
    validationScope: "BINARY_STRUCTURE_NOT_RENDERING",
  };
}
export function sourceAssetBinding(
  report: EvidenceObject,
  auditId: string,
  sourceId: string,
  destinationId: string,
) {
  const revision = itemCheckEvidenceRevision(report);
  const row = report.result?.itemResults?.find(
    (r: EvidenceObject) =>
      r.sourceId === sourceId && (r.courseraId || "") === destinationId,
  );
  if (!auditId || !validHash(report.sourceScanSha256) || !revision || !row)
    throw Error("Source assessment and comparison identity required.");
  if (
    row.operationalPolicy?.inDecisionGate === false ||
    row.operationalPolicy?.classification === "NON_LFM_POLICY_EXEMPT"
  )
    throw Error("Excluded scope is not an automatic repair task.");
  return {
    auditId,
    sourceId,
    destinationId,
    packageSha256: report.sourceScanSha256,
    evidenceRevision: revision,
  };
}
export type SourceAssetBinding = ReturnType<typeof sourceAssetBinding>;
export interface SourceAssetSession {
  binding: SourceAssetBinding;
  observedAt: string;
  assets: Map<string, { bytes: Uint8Array; receipt: EvidenceObject }>;
  rows: EvidenceObject[];
  complete: boolean;
}
export function createSourceAssetSession(
  binding: SourceAssetBinding,
): SourceAssetSession {
  return {
    binding: { ...binding },
    observedAt: new Date().toISOString(),
    assets: new Map(),
    rows: [],
    complete: false,
  };
}
function sameBinding(a: SourceAssetBinding, b: SourceAssetBinding) {
  return [
    "auditId",
    "sourceId",
    "destinationId",
    "packageSha256",
    "evidenceRevision",
  ].every(
    (k) =>
      a[k as keyof SourceAssetBinding] === b[k as keyof SourceAssetBinding],
  );
}
export function recoveryReceipt(session: SourceAssetSession) {
  return {
    kind: "CTI_SOURCE_ASSET_RECOVERY",
    version: 1,
    binding: session.binding,
    observedAt: session.observedAt,
    complete: session.complete,
    assets: [...session.assets.values()].map((a) => a.receipt),
    rows: session.rows,
    scope: "LOCAL_PACKAGE_ONLY",
    learnerRenderingVerified: false,
    questionParityVerified: false,
  };
}
/** Imported receipts are context only until the original package is independently read again. */
export function validateRecoveryReceipt(
  value: EvidenceObject,
  binding: SourceAssetBinding,
) {
  if (
    value.kind !== "CTI_SOURCE_ASSET_RECOVERY" ||
    value.version !== 1 ||
    !value.binding ||
    !sameBinding(value.binding, binding)
  )
    throw Error(
      "Recovery receipt belongs to a different course, item or comparison revision.",
    );
  if (
    !Array.isArray(value.assets) ||
    value.assets.length > 128 ||
    !Array.isArray(value.rows) ||
    value.rows.length > 128
  )
    throw Error("Recovery receipt exceeds limits.");
  return {
    observedAt: value.observedAt,
    assetCount: value.assets.length,
    status: "ORIGINAL_PACKAGE_REVALIDATION_REQUIRED",
  };
}
/** One serial local reader, bounded work, no network. Retry reuses rehashed bytes from this session. */
export async function recoverSourceAssets(
  file: File,
  scan: PackageScan,
  session: SourceAssetSession,
  options: { signal?: AbortSignal; progress?: (s: string) => void } = {},
) {
  session.complete = false;
  const started = Date.now(),
    check = () => {
      if (options.signal?.aborted)
        throw Error(
          "Recovery paused; retained session bytes can be reused on retry.",
        );
      if (Date.now() - started > SOURCE_ASSET_LIMITS.milliseconds)
        throw Error(
          "Recovery time budget exhausted; retry retains completed bytes.",
        );
    };
  validateSourcePackageFile(file);
  check();
  if (scan.fileSha256 !== session.binding.packageSha256)
    throw Error("Source scan revision mismatch.");
  const resource = scan.sourceEvidence.resources[session.binding.sourceId];
  const questions = (resource?.structuredAssessment as EvidenceObject)
    ?.questions;
  if (!Array.isArray(questions))
    throw Error("No source-bound question definitions in this package scan.");
  options.progress?.("Verifying original package hash…");
  const packageHash = await hashSourcePackageFile(file, () => check());
  if (packageHash !== session.binding.packageSha256)
    throw Error("Selected package does not match this comparison.");
  const zip = await openSourcePackageZip(file);
  try {
    const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
    const dependencies = [
      resource,
      ...((resource.dependencies as string[]) || [])
        .map((id) => scan.sourceEvidence.resources[id])
        .filter(Boolean),
    ]
      .flatMap((r) => r.files.map((f) => f.path || ""))
      .filter(Boolean);
    const refs = questions.flatMap((q: EvidenceObject) =>
      (q.mediaRefs || []).map((ref: string) => ({ q, ref })),
    );
    if (refs.length > SOURCE_ASSET_LIMITS.references)
      throw Error("Assessment exceeds the 128-reference recovery limit.");
    const rows: EvidenceObject[] = [];
    let total = [...session.assets.values()].reduce(
      (n, a) => n + a.bytes.length,
      0,
    );
    for (const { q, ref } of refs) {
      check();
      if (!safeAssetReference(ref)) {
        rows.push({
          sourceQuestionId: q.id || null,
          status: "UNSAFE_REFERENCE_OMITTED",
        });
        continue;
      }
      const presence = (q.mediaPresence || []).find(
        (p: EvidenceObject) => p.ref === ref,
      );
      const reference = {
        ref,
        sourceFile: q.sourceFile || "",
        expectedPath: presence?.expectedPath || undefined,
        dependencyPaths: dependencies,
      };
      const plan = sourceAssetCandidates(reference, paths),
        assets: EvidenceObject[] = [];
      for (const c of plan.candidates) {
        check();
        options.progress?.(
          `Checking ${rows.length + 1}/${refs.length}: ${c.path}`,
        );
        let retained = session.assets.get(c.path);
        if (retained && hash(retained.bytes) !== retained.receipt.sha256)
          throw Error("Retained original checksum mismatch.");
        if (!retained) {
          if (session.assets.size >= 128) {
            assets.push({ ...c, status: "FILE_COUNT_LIMIT" });
            continue;
          }
          const entry = zip.files[c.path];
          if (
            entry._data.uncompressedSize > SOURCE_ASSET_LIMITS.fileBytes ||
            total + entry._data.uncompressedSize >
              SOURCE_ASSET_LIMITS.totalBytes
          ) {
            assets.push({ ...c, status: "BYTE_LIMIT" });
            continue;
          }
          const bytes = await entry.async("uint8array");
          check();
          total += bytes.length;
          try {
            const proof = inspectSourceBinary(bytes);
            retained = {
              bytes,
              receipt: {
                path: c.path,
                ...proof,
                observedAt: new Date().toISOString(),
                packageSha256: packageHash,
                transport: "LOCAL_ZIP_CRC_VERIFIED",
              },
            };
            session.assets.set(c.path, retained);
          } catch (e) {
            assets.push({ ...c, status: "BINARY_REJECTED", reason: String(e) });
            continue;
          }
        }
        const recordedHashes = new Set(
          Object.values(scan.sourceEvidence.resources)
            .flatMap((r) => r.files || [])
            .filter((f) => f.path === c.path && validHash(f.sha256))
            .map((f) => f.sha256),
        );
        if (
          recordedHashes.size &&
          (recordedHashes.size !== 1 ||
            !recordedHashes.has(retained.receipt.sha256))
        ) {
          assets.push({
            ...c,
            ...retained.receipt,
            status: "CONTENT_IDENTITY_CONFLICT",
          });
          continue;
        }
        assets.push({
          ...c,
          ...retained.receipt,
          status: "BINARY_ACQUIRED",
          integrity: "VERIFIED_RETAINED_ORIGINAL",
          originalBytes: retained.bytes,
        });
      }
      const resolution = assessmentMediaResolution(
        { ...reference, expectedPath: plan.expectedPath },
        assets,
        false,
      );
      const proven =
        !!q.id && !plan.truncated && resolution.resolved.length > 0;
      const status = proven
        ? "RECOVERED_VERIFIED_ORIGINAL"
        : plan.candidateCount || plan.caseVariants.length
          ? "CANDIDATE_FOUND_IDENTITY_UNVERIFIED"
          : plan.expectedPath
            ? "SOURCE_ASSET_NOT_IN_PACKAGE"
            : "LIVE_SOURCE_ACCESS_REQUIRED";
      rows.push({
        sourceAssessmentId: session.binding.sourceId,
        sourceQuestionId: q.id || null,
        sourceFile: q.sourceFile || null,
        originalRef: ref,
        expectedPath: plan.expectedPath,
        status,
        binaryStatus: proven
          ? "VERIFIED_PACKAGE_ORIGINAL"
          : assets.some((a) => a.status === "BINARY_ACQUIRED")
            ? "ACQUIRED_CANDIDATE_BYTES"
            : "BINARY_NOT_ACQUIRED",
        resolvedOriginals: proven ? resolution.resolved : [],
        repairStatus: "NOT_APPLIED",
        originalPackageReference: plan.candidates.some(
          (c) => c.method === "EXACT_QUESTION_REFERENCE",
        )
          ? "PRESENT_AT_REFERENCE"
          : "NOT_AT_REFERENCE",
        liveSourceReference: "UNVERIFIED",
        association: proven ? "EXACT_PACKAGE_QUESTION_REFERENCE" : "UNVERIFIED",
        destinationItemId: session.binding.destinationId,
        destinationQuestionId: null,
        destinationStatus: "DESTINATION_ASSET_UNVERIFIED",
        candidates: assets.map(({ originalBytes, integrity, ...a }) => a),
        candidateCount: plan.candidateCount,
        truncated: plan.truncated,
        caseVariants: plan.caseVariants,
        learnerRenderingVerified: false,
        questionParityVerified: false,
        action: proven
          ? "Inspect destination association and media before repair."
          : plan.candidateCount || plan.caseVariants.length
            ? "Confirm the original question/image association; filename matches are candidates only."
            : "Request source material or authorized source access.",
        dependencies: [
          "Published/draft identity and learner rendering require independent destination evidence.",
        ],
      });
      session.rows = rows.slice();
    }
    session.complete = true;
    return recoveryReceipt(session);
  } finally {
    await zip.close();
  }
}

/** Independent destination observations: never bind questions by position. */
export function destinationMediaFailures(questions: EvidenceObject[] = []) {
  return questions
    .filter(
      (q) =>
        q.id && /\[Error: Image could not be created\]/i.test(q.prompt || ""),
    )
    .map((q) => ({
      questionId: q.id,
      ordinal: q.ordinal ?? null,
      status: "DESTINATION_INGESTION_FAILURE",
      sourceQuestionBinding: "UNVERIFIED",
      learnerRenderingVerified: false,
      action:
        "Confirm intended source-question association, preserve original bytes, repair manually, then run a focused destination check.",
    }));
}
