import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { computeRiskMetrics_ } from "../engine/source/manifest.js";
import { validateEvidenceInput, type EvidenceInputData } from "./evidence-input-record.ts";
import type { PackageNode, PackageScan } from "./package-types.ts";

/** A document baseline describes only the supplied text. Headings are document
 * sections, never inferred LMS items, assessment definitions or absent media. */
export function sourceDocumentScan(input: EvidenceInputData): PackageScan {
  validateEvidenceInput(input);
  if (input.role !== "source-document" || !input.document || input.original.retention !== "TEXT")
    throw Error("Choose a retained source document before creating its baseline.");
  const doc = input.document, lines = doc.text.split(/(?<=\n)/), sections: { title: string; start: number; text: string }[] = [];
  let fence: { marker: string; length: number } | null = null;
  let current = { title: doc.title || input.sourceName, start: 1, text: "" };
  for (const [i, line] of lines.entries()) {
    const fenceLine = line.replace(/\r?\n$/, ""), marker = fenceLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (doc.format === "markdown" && (fence || marker)) {
      if (fence) {
        if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && /^[\t ]*$/.test(marker[2]))
          fence = null;
      } else if (marker && (marker[1][0] === "~" || !marker[2].includes("`"))) {
        fence = { marker: marker[1][0], length: marker[1].length };
      }
      current.text += line;
      continue;
    }
    const heading = doc.format === "markdown" ? line.match(/^ {0,3}#{1,6}[\t ]+(.+?)[\t ]*(?:\r?\n)?$/) : null;
    if (heading) {
      if (current.text) sections.push(current);
      current = { title: heading[1].replace(/[\t ]+#+[\t ]*$/, ""), start: i + 1, text: line };
    } else current.text += line;
  }
  if (current.text || !sections.length) sections.push(current);
  if (sections.length > 10000) throw Error("Source document exceeds the 10,000-section limit.");
  const resources: PackageScan["sourceEvidence"]["resources"] = {};
  const children: PackageNode[] = sections.map(section => {
    const id = `document_${input.sourceHash}_${section.start}`;
    const payload = { files: [], textSample: section.text, textLength: section.text.length,
      textSha256: bytesToHex(sha256(new TextEncoder().encode(section.text))), textFormat: "plain",
      evidenceTruncated: false, sourceDocument: { sourceHash: input.sourceHash, line: section.start,
        platform: doc.platform, scope: doc.scope, nativeCourseId: doc.nativeCourseId },
      expectedQuestionCount: null, mediaCoverage: "NOT_ESTABLISHED", courseCoverage: "NOT_ESTABLISHED" };
    resources[id] = payload;
    return { title: section.title, type: "webcontent", idref: id, children: [], sourcePayload: payload };
  });
  return { kind: "CTI_PACKAGE_SCAN", schemaVersion: 1, fileName: input.sourceName,
    scannedAt: input.importedAt, fileSha256: input.sourceHash, moduleCount: 1,
    scope: "Supplied source-document text and literal heading sections only. This is not a complete LMS or cartridge inventory; assessment, media and runtime coverage remain unestablished.",
    courseTree: [{ title: doc.title || input.sourceName, type: "folder", idref: null, children }],
    sourceHierarchy: [{ title: doc.title || input.sourceName, type: "folder", idref: null, children }],
    stats: { ...computeRiskMetrics_(children.length, 0, 0, 0, 0, 0, 0), webcontent: children.length,
      quizzes: 0, assignments: 0, lti: 0, discussions: 0, weblinks: 0, unknown: 0, emptyFolders: 0,
      sourceDocument: true, expectedAssessmentCountKnown: false },
    unknownTypesLog: {}, fileExtensionsLog: {},
    sourceEvidence: { manifestOnly: false, resources, kind: "CTI_SOURCE_DOCUMENT_BASELINE",
      completeCourse: false, original: input.original, sourceHash: input.sourceHash, document: doc },
    warnings: ["Document headings are source sections, not confirmed LMS item boundaries. Cross-platform matches require review.", ...doc.gaps] };
}
