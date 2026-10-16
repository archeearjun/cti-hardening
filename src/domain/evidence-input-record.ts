import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
export const roles = [
  "coursera-capture",
  "brightspace-capture",
  "source-package",
  "coursera-workbook",
  "source-document",
] as const;
export type EvidenceInputRole = (typeof roles)[number];
export interface EvidenceInputDocument {
  format: "markdown" | "text" | "json";
  title: string;
  text: string;
  platform: string;
  nativeCourseId: string;
  capturedAt: string;
  url: string;
  scope: string;
  gaps: string[];
}
export interface EvidenceInputData {
  type: "evidence-input";
  schemaVersion: 1;
  role: EvidenceInputRole;
  sourceName: string;
  sourceHash: string;
  bytes: number;
  mediaType: string;
  importedAt: string;
  confirmedCourseId: string;
  platform: string;
  nativeCourseId: string;
  capturedAt: string;
  title: string;
  scope: string;
  gaps: string[];
  original: { retention: "FILE_REFERENCE" | "TEXT"; text?: string };
  counts?: Record<string, number>;
  document?: EvidenceInputDocument;
}
const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
const text = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
export const MAX_EVIDENCE_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_BYTES = 640 * 1024 * 1024;
export const documentScope =
  "Owner-supplied source document. Retained text is not a structured LMS capture, an expected item inventory, or proof of complete source extraction.";
export const documentGaps = [
  "Expected source inventory and extraction completeness are not established.",
  "Linked media, quiz definitions and external bodies are not fetched from this document.",
];
export function evidenceInputId(
  courseId: string,
  input: Pick<EvidenceInputData, "role" | "sourceHash">,
) {
  return (
    "evidence_" +
    bytesToHex(
      sha256(
        new TextEncoder().encode(
          JSON.stringify([courseId, input.role, input.sourceHash]),
        ),
      ),
    )
  );
}
export function genericDocument(
  value: Record<string, any>,
): EvidenceInputDocument {
  if (
    value.kind !== "CTI_SOURCE_DOCUMENT" ||
    value.schemaVersion !== 1 ||
    typeof value.platform !== "string" ||
    !value.platform.trim() ||
    value.platform.length > 100 ||
    typeof value.text !== "string" ||
    typeof value.scope !== "string" ||
    !value.scope.trim() ||
    value.scope.length > 4000 ||
    !Array.isArray(value.gaps) ||
    value.gaps.length > 200 ||
    value.gaps.some((v: unknown) => typeof v !== "string" || v.length > 2000)
  )
    throw Error(
      "Unknown JSON format. Other LMS evidence must declare kind CTI_SOURCE_DOCUMENT, schemaVersion 1, platform, text, scope and gaps; it is not treated as a Brightspace capture.",
    );
  const course = object(value.course);
  return {
    format: "json",
    title: text(value.title || course.title),
    text: value.text,
    platform: value.platform,
    nativeCourseId: text(course.id),
    capturedAt: text(value.capturedAt),
    url: text(course.url),
    scope: value.scope + " " + documentScope,
    gaps: [...value.gaps, ...documentGaps],
  };
}

export function validateEvidenceInput(
  value: unknown,
): asserts value is EvidenceInputData {
  const d = object(value);
  const bounded = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max;
  if (
    d.type !== "evidence-input" ||
    d.schemaVersion !== 1 ||
    !roles.includes(d.role) ||
    !/^[a-f0-9]{64}$/.test(d.sourceHash) ||
    !Number.isSafeInteger(d.bytes) ||
    d.bytes < 1 ||
    d.bytes > MAX_FILE_BYTES ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(d.confirmedCourseId) ||
    !bounded(d.sourceName, 500) ||
    !d.sourceName ||
    !bounded(d.mediaType, 200) ||
    !bounded(d.platform, 100) ||
    !d.platform ||
    !bounded(d.nativeCourseId, 256) ||
    !bounded(d.title, 2000) ||
    !bounded(d.scope, 12000) ||
    !d.scope ||
    !bounded(d.capturedAt, 100) ||
    (d.capturedAt && !Number.isFinite(Date.parse(d.capturedAt))) ||
    !bounded(d.importedAt, 100) ||
    !Number.isFinite(Date.parse(d.importedAt)) ||
    !Array.isArray(d.gaps) ||
    d.gaps.length > 2000 ||
    d.gaps.some((g: unknown) => !bounded(g, 12000)) ||
    !["TEXT", "FILE_REFERENCE"].includes(d.original?.retention)
  )
    throw Error("Invalid evidence input record.");
  if (d.original.retention === "TEXT") {
    if (
      typeof d.original.text !== "string" ||
      new TextEncoder().encode(d.original.text).length >
        MAX_EVIDENCE_DOCUMENT_BYTES ||
      new TextEncoder().encode(d.original.text).length !== d.bytes ||
      bytesToHex(sha256(new TextEncoder().encode(d.original.text))) !==
        d.sourceHash ||
      d.role !== "source-document"
    )
      throw Error(
        "Saved source text does not match its original file identity.",
      );
  } else if (d.original.text !== undefined || d.document !== undefined)
    throw Error(
      "Binary evidence must retain a file reference, not embedded content.",
    );
  if (d.document) {
    const doc = object(d.document);
    if (
      !["markdown", "text", "json"].includes(doc.format) ||
      typeof doc.text !== "string" ||
      new TextEncoder().encode(doc.text).length > MAX_EVIDENCE_DOCUMENT_BYTES ||
      !bounded(doc.url, 4000) ||
      doc.platform !== d.platform ||
      doc.nativeCourseId !== d.nativeCourseId ||
      doc.capturedAt !== d.capturedAt ||
      doc.title !== d.title ||
      doc.scope !== d.scope ||
      JSON.stringify(doc.gaps) !== JSON.stringify(d.gaps)
    )
      throw Error("Invalid source document attribution.");
    if (doc.format !== "json" && doc.text !== d.original.text)
      throw Error("Source document text differs from the original.");
    if (doc.format === "json") {
      let originalDocument: EvidenceInputDocument;
      try {
        originalDocument = genericDocument(
          object(JSON.parse(d.original.text.replace(/^\uFEFF/, ""))),
        );
      } catch {
        throw Error("Invalid original source-document JSON.");
      }
      if (JSON.stringify(originalDocument) !== JSON.stringify(doc))
        throw Error(
          "Source-document projection differs from its original JSON.",
        );
    }
  } else if (d.role === "source-document")
    throw Error("Source document attribution is required.");
  if (
    d.counts !== undefined &&
    (!d.counts ||
      typeof d.counts !== "object" ||
      Array.isArray(d.counts) ||
      Object.keys(d.counts).length > 20 ||
      Object.values(d.counts).some(
        (v) => !Number.isSafeInteger(v) || Number(v) < 0,
      ))
  )
    throw Error("Invalid input inspection counts.");
}
