import { performanceTrace } from '../diagnostics/runtime.ts';
import {
  buildContentSnapshot,
  validateContentSnapshot,
  type ContentSnapshot,
} from "./content-evidence.ts";
import { digest, newRecord, type WorkspaceStore } from "./workspace-store.ts";
import type { EvidenceObject, WorkspaceRecord } from "./workspace-types.ts";
import { buildCourseraArchiveProof } from "./coursera-archive-proof.ts";
import {
  MAX_COURSERA_CAPTURE_JSON_BYTES,
  attachCourseraArchiveFileBytes,
  type CourseraArchiveFile,
  type CourseraCaptureTransport,
} from "./coursera-capture-file.ts";
import {
  attachBrightspaceArchiveFileBlobs,
  type BrightspaceArchiveFile,
} from "./brightspace-capture-archive.ts";

/** Original audits are immutable. Content recovered from the exact input bytes
 * is a separate, versioned, report-bound supplement, never a rewritten audit. */
export async function saveOriginalContent(
  bytes: Uint8Array,
  report: EvidenceObject,
  auditId: string,
  store: WorkspaceStore,
  options: {
    archiveFiles?: CourseraArchiveFile[];
    brightspaceArchiveFiles?: BrightspaceArchiveFile[];
    transport?: CourseraCaptureTransport;
  } = {},
) {
  // Caller buffers and option objects can change while digest/storage awaits.
  bytes = new Uint8Array(bytes);
  options = {
    ...options,
    transport: options.transport
      ? structuredClone(options.transport)
      : undefined,
    archiveFiles: options.archiveFiles?.map((file) => ({ ...file })),
    brightspaceArchiveFiles: options.brightspaceArchiveFiles?.map((file) => ({
      ...file,
    })),
  };
  const expectedReport = {
    hashes: { ...report.hashes },
    packageId: report.packageId,
  };
  if (bytes.length > MAX_COURSERA_CAPTURE_JSON_BYTES)
    throw Error("Extraction exceeds the 128 MiB content-import limit.");
  const hash = await digest(bytes),
    platform =
      hash === expectedReport.hashes?.json
        ? "coursera"
        : hash === expectedReport.hashes?.brightspace
          ? "brightspace"
          : null;
  if (!platform)
    throw Error(
      "This file does not match either original extraction hash. Use the original file or create a new comparison.",
    );
  const saved = await store.get(auditId);
  if (
    saved.kind !== "audit" ||
    saved.packageId !== expectedReport.packageId ||
    saved.data.hashes?.[platform === "coursera" ? "json" : "brightspace"] !==
      hash
  )
    throw Error("The saved report changed or does not match this extraction.");
  let parsedCourseraCapture: unknown,
    parsedBrightspaceCapture: unknown,
    archiveProof;
  if (platform === "coursera") {
    if (options.brightspaceArchiveFiles)
      throw Error(
        "Brightspace archive originals cannot supplement Coursera evidence.",
      );
    const files = options.archiveFiles || [];
    parsedCourseraCapture = attachCourseraArchiveFileBytes(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      files,
    );
    const verifiedProof = buildCourseraArchiveProof(
      hash,
      bytes.length,
      options.transport,
      files,
    );
    if (verifiedProof) {
      const expected = saved.data.captureTransport?.json;
      if (
        expected?.encoding === "zip" &&
        expected.sha256 !== verifiedProof.archiveSha256
      )
        throw Error(
          "This archive does not match the report's original ZIP hash.",
        );
      archiveProof = {
        ...verifiedProof,
        archiveIdentityMatchedReport: expected?.encoding === "zip",
      };
    }
  } else {
    if (options.archiveFiles?.length)
      throw Error(
        "Coursera archive originals cannot supplement Brightspace evidence.",
      );
    parsedBrightspaceCapture = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    const declaredArchive =
      (parsedBrightspaceCapture as EvidenceObject)?.originalBodyTransport
        ?.format === "CTI_BRIGHTSPACE_ARCHIVE_V1";
    const expected = saved.data.captureTransport?.brightspace;
    if (
      (declaredArchive ||
        options.brightspaceArchiveFiles ||
        expected?.encoding === "zip") &&
      options.transport?.encoding !== "zip"
    )
      throw Error(
        "Supply the original Brightspace ZIP archive and its verified transport identity.",
      );
    if (
      expected?.encoding === "zip" &&
      expected.sha256 !== options.transport?.sha256
    )
      throw Error(
        "This archive does not match the report's original Brightspace ZIP hash.",
      );
    if (options.brightspaceArchiveFiles)
      await attachBrightspaceArchiveFileBlobs(
        parsedBrightspaceCapture,
        options.brightspaceArchiveFiles,
      );
    if (options.transport?.encoding === "zip") {
      if (!options.brightspaceArchiveFiles)
        throw Error("Brightspace archive originals were not supplied.");
    }
  }
  const contentEvidence = buildContentSnapshot(
    platform === "coursera" ? bytes : undefined,
    platform === "brightspace" ? bytes : undefined,
    parsedCourseraCapture,
    parsedBrightspaceCapture,
  );
  validateContentSnapshot(contentEvidence);
  const id =
    "report-content-" +
    (await digest(
      new TextEncoder().encode(JSON.stringify([auditId, platform])),
    ));
  const summary = (await store.list()).find((r) => r.id === id);
  const previous = summary
    ? await store.get(id)
    : newRecord(
        "operations",
        `Original ${platform} content`,
        {},
        saved.packageId,
      );
  if (
    summary &&
    (previous.kind !== "operations" ||
      previous.packageId !== saved.packageId ||
      previous.data.type !== "report-content" ||
      previous.data.runId !== auditId ||
      previous.data.platform !== platform)
  )
    throw Error("Existing content supplement does not match this report.");
  await store.save({
    ...previous,
    id,
    data: {
      type: "report-content",
      runId: auditId,
      platform,
      sourceHash: hash,
      contentEvidence,
      ...(archiveProof ? { archiveProof } : {}),
    },
  });
  return platform;
}
export async function loadReportContent(
  report: EvidenceObject,
  auditId: string,
  packageId: string,
  store: Pick<WorkspaceStore, "list" | "get">,
  records?: WorkspaceRecord[],
): Promise<ContentSnapshot> {
const diagnosticEnd = performanceTrace().begin('evidence_load');
let diagnosticOutcome = 'observed';
try {

  const base = report.contentEvidence || {
    schemaVersion: 1,
    coursera: [],
    brightspace: [],
  };
  validateContentSnapshot(base);
  const output = { ...base },
    seen = new Set<string>();
  const summaries = (records || (await store.list())).filter(
    (r) =>
      r.kind === "operations" &&
      r.packageId === packageId &&
      r.data.type === "report-content" &&
      r.data.runId === auditId,
  );
  if (summaries.length > 2)
    throw Error(
      "Duplicate report content supplements. Resolve their source identity before using them.",
    );
  for (const summary of summaries) {
    const r = await store.get(summary.id),
      p = r.data.platform;
    if (
      r.id !== summary.id ||
      r.version !== summary.version ||
      r.kind !== "operations" ||
      r.packageId !== packageId ||
      r.data.type !== "report-content" ||
      r.data.runId !== auditId ||
      !["coursera", "brightspace"].includes(p) ||
      seen.has(p) ||
      !/^[a-f0-9]{64}$/.test(String(r.data.sourceHash || "")) ||
      r.data.sourceHash !==
        report.hashes?.[p === "coursera" ? "json" : "brightspace"]
    )
      throw Error(
        "Saved content changed or does not match this report's original extraction. Retry after refreshing.",
      );
    validateContentSnapshot(r.data.contentEvidence);
    seen.add(p);
    if (p === "coursera") output.coursera = r.data.contentEvidence.coursera;
    else output.brightspace = r.data.contentEvidence.brightspace;
  }
  return output;

} catch (error) { diagnosticOutcome = 'failed'; throw error; } finally { diagnosticEnd(diagnosticOutcome); }
}
