import {
  roles,
  MAX_EVIDENCE_DOCUMENT_BYTES,
  MAX_FILE_BYTES,
  documentScope,
  documentGaps,
  genericDocument,
  validateEvidenceInput,
  evidenceInputId,
  type EvidenceInputRole,
  type EvidenceInputData,
  type EvidenceInputDocument,
} from "./evidence-input-record.ts";
export {
  MAX_EVIDENCE_DOCUMENT_BYTES,
  validateEvidenceInput,
  evidenceInputId,
} from "./evidence-input-record.ts";
export type {
  EvidenceInputRole,
  EvidenceInputData,
  EvidenceInputDocument,
} from "./evidence-input-record.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  readCourseraCaptureFileBytes,
  attachCourseraArchiveFileBytes,
} from "./coursera-capture-file.ts";
import { reviewCapture, MAX_CAPTURE_BYTES } from "./capture-review.ts";
import { assertBrightspaceCaptureIntegrity } from "./brightspace-capture-evidence.ts";
import { readWorkbook } from "../adapters/workbook.ts";
import type { PackageProgress, PackageScan } from "./package-types.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";
import { sourceDocumentScan } from "./source-documents.ts";

export const MAX_EVIDENCE_INTAKE_FILES = 12;
export const MAX_EVIDENCE_INTAKE_BYTES = 1024 * 1024 * 1024;
export interface EvidenceStage {
  excel?: File;
  capture?: File;
  source?: File;
  package?: { file: File; scan: PackageScan };
  documents?: EvidenceInputDocument[];
}
export interface InspectedEvidenceInput {
  file: File;
  data: EvidenceInputData;
  scan?: PackageScan;
}
export interface EvidenceIntakeResult {
  file: File;
  status: "ready" | "duplicate" | "error" | "conflict";
  input?: InspectedEvidenceInput;
  message: string;
}
interface IntakeOptions {
  signal?: AbortSignal;
  documentPlatform?: string;
  progress?: (message: string) => void;
  scanPackage?: (
    file: File,
    progress: (p: PackageProgress) => void,
  ) => Promise<PackageScan>;
}
const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
const text = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
const abort = (signal?: AbortSignal) => signal?.throwIfAborted();
function utf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw Error("This input is not valid UTF-8 text.");
  }
}
async function fileHash(file: File, signal?: AbortSignal) {
  const hash = sha256.create();
  // Hash slices without allocating a second archive-sized byte array.
  for (let start = 0; start < file.size; start += 1024 * 1024) {
    abort(signal);
    hash.update(
      new Uint8Array(
        await file.slice(start, start + 1024 * 1024).arrayBuffer(),
      ),
    );
  }
  abort(signal);
  return bytesToHex(hash.digest());
}

/** Detect and inspect one input. Only the maintained native readers evaluate
 * captures/packages; plain documents never acquire synthetic items or totals. */
export async function inspectEvidenceInput(
  file: File,
  course: WorkspaceRecord,
  options: IntakeOptions = {},
): Promise<InspectedEvidenceInput> {
  abort(options.signal);
  if (course.kind !== "package")
    throw Error("Choose a saved course before adding evidence.");
  if (
    !file.size ||
    !Number.isSafeInteger(file.size) ||
    file.size > MAX_FILE_BYTES
  )
    throw Error("Choose a non-empty input within the 640 MiB archive limit.");
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const prefix = new TextDecoder().decode(head);
  const zip =
    head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
  const gzip = head[0] === 0x1f && head[1] === 0x8b && head[2] === 8;
  const firstZipName =
    zip && head.length >= 30
      ? new TextDecoder().decode(
          head.slice(30, 30 + new DataView(head.buffer).getUint16(26, true)),
        )
      : "";
  const archive =
    zip &&
    (/\.cti\.zip$/i.test(file.name) || firstZipName === "capture.json.gz");
  let role: EvidenceInputRole,
    platform = "",
    nativeCourseId = "",
    capturedAt = "",
    title = file.name;
  let scope = "",
    gaps: string[] = [],
    counts: Record<string, number> | undefined;
  let original: EvidenceInputData["original"] = { retention: "FILE_REFERENCE" };
  let document: EvidenceInputDocument | undefined,
    scan: PackageScan | undefined;
  let inspectedFile = file;
  if (zip && /\.xlsx$/i.test(file.name)) {
    if (file.size > 25 * 1024 * 1024)
      throw Error("Workbook exceeds the 25 MiB limit.");
    const book = readWorkbook(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
    );
    role = "coursera-workbook";
    platform = "COURSERA";
    scope =
      "Workbook structure supplied for comparison; source identity and content fidelity still require comparison.";
    counts = { sheets: Object.keys(book.sheets).length };
    gaps = [
      "Workbook alone does not establish original item content or complete extraction.",
    ];
  } else if (
    archive ||
    gzip ||
    (/^\s*\{/.test(prefix) && !/\.(md|markdown|txt)$/i.test(file.name)) ||
    /\.json$/i.test(file.name)
  ) {
    if (archive && !/\.zip$/i.test(file.name))
      inspectedFile = new File([file], file.name + ".cti.zip", {
        type: file.type,
        lastModified: file.lastModified,
      });
    if (gzip && !/\.json\.gz$/i.test(file.name))
      inspectedFile = new File([file], file.name + ".json.gz", {
        type: file.type,
        lastModified: file.lastModified,
      });
    const capture = await readCourseraCaptureFileBytes(inspectedFile);
    abort(options.signal);
    let value: Record<string, any>;
    try {
      value = object(JSON.parse(utf8(capture.bytes).replace(/^\uFEFF/, "")));
    } catch {
      throw Error("The selected input is not a valid UTF-8 JSON object.");
    }
    if (value.kind === "CTI_SOURCE_DOCUMENT") {
      if (archive || gzip || file.size > MAX_EVIDENCE_DOCUMENT_BYTES)
        throw Error(
          "Source-document JSON must be an uncompressed file within the 4 MiB document limit.",
        );
      document = genericDocument(value);
      role = "source-document";
      original = { retention: "TEXT", text: utf8(capture.bytes) };
    } else {
      const meta = { ...object(value.extractionMeta), ...object(value.meta) };
      const brightspace = /brightspace/i.test(
        text(value.extractor || meta.extractor),
      );
      if (brightspace && capture.bytes.byteLength > MAX_CAPTURE_BYTES)
        throw Error("Brightspace capture exceeds the 128 MiB limit.");
      if (brightspace) assertBrightspaceCaptureIntegrity(value);
      const review = reviewCapture(
        capture.archiveFiles
          ? attachCourseraArchiveFileBytes(value, capture.archiveFiles)
          : value,
        file.name,
        {
          partner:
            text(course.data.partner).toUpperCase() === "NAIT" ? "NAIT" : "",
          mode: "OPS_CURRENT",
        },
      );
      role = brightspace ? "brightspace-capture" : "coursera-capture";
      platform = brightspace ? "BRIGHTSPACE" : "COURSERA";
      nativeCourseId = brightspace
        ? text(value.course?.orgUnitId)
        : text(value.page?.courseId || meta.directDataCapture?.courseId);
      capturedAt = text(
        value.capturedAt || value.extractedAt || meta.capturedAt,
      );
      title = review.title;
      scope = review.scope;
      gaps = [
        ...review.warnings,
        ...(brightspace ? review.findings.map((finding) =>
          [finding.itemName || finding.itemId || "Brightspace source", finding.detail || finding.code].join(": "),
        ) : []),
        "Input inspection and saved file identity do not certify whole-course completeness.",
      ];
      if (gaps.length > 2000) gaps = [
        ...gaps.slice(0, 1999),
        `${gaps.length - 1999} additional gap details exceed this input record's display bound. Keep the original capture and its full inspection findings.`,
      ];
      counts = {
        items: review.counts.items,
        questionDefinitions: review.counts.questionDefinitions,
      };
    }
  } else if (zip || /^\s*(?:<\?xml[^>]*>\s*)?<manifest(?:\s|>)/i.test(prefix)) {
    role = "source-package";
    platform = "SOURCE_PACKAGE";
    if (!/\.(imscc|zip|xml)$/i.test(file.name))
      inspectedFile = new File([file], file.name + (zip ? ".zip" : ".xml"), {
        lastModified: file.lastModified,
      });
    const scanner =
      options.scanPackage || (await import("./package-scan.ts")).scanPackage;
    scan = await scanner(inspectedFile, (p) => {
      abort(options.signal);
      options.progress?.([p.phase, p.detail].filter(Boolean).join(": "));
    });
    abort(options.signal);
    scope = scan.scope;
    gaps = [...scan.warnings];
    counts = {
      items: Number(scan.stats.totalItems) || 0,
      modules: scan.moduleCount,
    };
  } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
    if (file.size > MAX_EVIDENCE_DOCUMENT_BYTES)
      throw Error("Source documents must be within the 4 MiB text limit.");
    const sourceText = utf8(new Uint8Array(await file.arrayBuffer()));
    role = "source-document";
    document = {
      format: /\.(md|markdown)$/i.test(file.name) ? "markdown" : "text",
      title: file.name,
      text: sourceText,
      platform: options.documentPlatform?.trim() || "SOURCE_DOCUMENT",
      nativeCourseId: "",
      capturedAt: "",
      url: "",
      scope: documentScope,
      gaps: [...documentGaps],
    };
    original = { retention: "TEXT", text: sourceText };
  } else
    throw Error(
      "Unsupported input. Add a Coursera capture, Brightspace JSON, source IMSCC/ZIP/manifest XML, XLSX, Markdown or plain-text source document.",
    );
  if (document)
    ({ platform, nativeCourseId, capturedAt, title, scope, gaps } = document);
  if (original.retention === "FILE_REFERENCE")
    gaps.push(
      "The original binary file is not copied into workspace storage. Keep this exact local file to reopen or compare it later.",
    );
  abort(options.signal);
  const sourceHash = scan?.fileSha256 || (await fileHash(file, options.signal));
  const data: EvidenceInputData = {
    type: "evidence-input",
    schemaVersion: 1,
    role,
    sourceName: file.name,
    sourceHash,
    bytes: file.size,
    mediaType: file.type,
    importedAt: new Date().toISOString(),
    confirmedCourseId: course.id,
    platform,
    nativeCourseId,
    capturedAt,
    title,
    scope,
    gaps,
    original,
    ...(counts ? { counts } : {}),
    ...(document ? { document } : {}),
  };
  validateEvidenceInput(data);
  return { file: inspectedFile, data, ...(scan ? { scan } : {}) };
}

export function assertEvidenceCourseBinding(
  input: EvidenceInputData,
  courseId: string,
  records: WorkspaceRecord[],
) {
  if (input.confirmedCourseId !== courseId)
    throw Error("This evidence was inspected for a different selected course.");
  const known = records
    .filter(
      (r) =>
        r.packageId === courseId &&
        r.kind === "operations" &&
        r.data.type === "evidence-input" &&
        text(r.data.platform).toUpperCase() === input.platform.toUpperCase() &&
        r.data.nativeCourseId,
    )
    .map((r) => r.data.nativeCourseId);
  if (input.nativeCourseId && known.some((id) => id !== input.nativeCourseId))
    throw Error(
      "Native course ID differs from evidence already bound to this course. Select the matching course; title similarity cannot override this identity conflict.",
    );
}

/** Sequential inspection bounds peak memory. Any same-role ambiguity blocks
 * both inputs; file order must never decide the comparison baseline. */
export async function inspectEvidenceInputs(
  files: File[],
  course: WorkspaceRecord,
  records: WorkspaceRecord[],
  options: IntakeOptions = {},
): Promise<EvidenceIntakeResult[]> {
  if (!files.length || files.length > MAX_EVIDENCE_INTAKE_FILES)
    throw Error("Choose between 1 and 12 evidence files per intake.");
  if (files.reduce((n, f) => n + f.size, 0) > MAX_EVIDENCE_INTAKE_BYTES)
    throw Error(
      "This intake exceeds the 1 GiB total input limit. Add smaller batches.",
    );
  const results: EvidenceIntakeResult[] = [],
    seen = new Set<string>();
  for (const file of files) {
    abort(options.signal);
    options.progress?.("Inspecting " + file.name);
    try {
      const input = await inspectEvidenceInput(file, course, options),
        id = evidenceInputId(course.id, input.data);
      assertEvidenceCourseBinding(input.data, course.id, records);
      const duplicate = seen.has(id) || records.some((r) => r.id === id);
      results.push({
        file,
        input,
        status: duplicate ? "duplicate" : "ready",
        message: duplicate
          ? "Already retained with this exact identity; it can be selected again without creating duplicate history."
          : "Inspected; confirm the selected course before saving.",
      });
      seen.add(id);
    } catch (error) {
      abort(options.signal);
      results.push({
        file,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const nativeIds = new Map<string, Set<string>>();
  for (const r of results)
    if (r.input?.data.nativeCourseId) {
      const d = r.input.data;
      const ids = nativeIds.get(d.platform) || new Set();
      ids.add(d.nativeCourseId);
      nativeIds.set(d.platform, ids);
    }
  for (const r of results)
    if (r.input && (nativeIds.get(r.input.data.platform)?.size || 0) > 1) {
      r.status = "conflict";
      r.message =
        "This batch contains different native course IDs for the same platform. Separate the courses before importing.";
    }
  for (const role of roles.filter((r) => r !== "source-document")) {
    const matches = results.filter(
      (r) =>
        r.input?.data.role === role &&
        r.status !== "error" &&
        r.status !== "conflict",
    );
    if (new Set(matches.map((r) => r.input!.data.sourceHash)).size > 1)
      for (const r of matches) {
        r.status = "conflict";
        r.message =
          "More than one different input supplies this evidence role. Remove the unwanted version; no first-file selection is made.";
      }
  }
  return results;
}

export function stageEvidenceInputs(
  results: EvidenceIntakeResult[],
  selection: { sourceDocumentHash?: string; courseId?: string } = {},
): EvidenceStage {
  const stage: EvidenceStage = {},
    seen = new Set<string>();
  for (const r of results) {
    if (
      !r.input ||
      !["ready", "duplicate"].includes(r.status) ||
      seen.has(r.input.data.sourceHash)
    )
      continue;
    const { file, data, scan } = r.input;
    validateEvidenceInput(data);
    if (selection.courseId && data.confirmedCourseId !== selection.courseId)
      throw Error(
        "This evidence was inspected for a different selected course.",
      );
    seen.add(data.sourceHash);
    if (data.role === "coursera-capture") stage.capture = file;
    if (data.role === "brightspace-capture") stage.source = file;
    if (data.role === "coursera-workbook") stage.excel = file;
    if (data.role === "source-package" && scan) stage.package = { file, scan };
    if (data.document) (stage.documents ||= []).push(data.document);
  }
  if (selection.sourceDocumentHash) {
    if (stage.package)
      throw Error("Choose a package or a document source baseline, not both.");
    const chosen = results.find(
      (r) =>
        ["ready", "duplicate"].includes(r.status) &&
        r.input?.data.role === "source-document" &&
        r.input.data.sourceHash === selection.sourceDocumentHash,
    )?.input;
    if (!chosen)
      throw Error(
        "The selected source-document baseline is no longer available.",
      );
    stage.package = {
      file: chosen.file,
      scan: sourceDocumentScan(chosen.data),
    };
  }
  return stage;
}
