import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createSourceScanner } from "../source/scanner.js";
import { createEngine } from "../engine/index.js";
import { createBrowserServices } from "../adapters/browser-services.ts";
import { browserXml } from "../adapters/browser-xml.ts";
import type { PackageProgress, PackageScan } from "./package-types.ts";

const scanner = createSourceScanner({
  pdfjsLib,
  pdfWorkerUrl,
  pdfVersion: pdfjsLib.version,
});
const engine = createEngine({
  ...createBrowserServices(),
  XmlService: browserXml,
});
const MAX_PACKAGE_BYTES = 250 * 1024 * 1024;

export async function scanPackage(
  file: File,
  progress: (p: PackageProgress) => void,
): Promise<PackageScan> {
  if (!/\.(imscc|zip|xml)$/i.test(file.name))
    throw new Error("Choose an IMSCC package, ZIP or imsmanifest.xml.");
  if (!file.size || file.size > MAX_PACKAGE_BYTES)
    throw new Error("Choose a non-empty package no larger than 250 MiB.");
  progress({
    phase: "Open package",
    detail: "Reading the selected file locally.",
  });
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fileSha256 = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  let xml: string;
  let sourceEvidence: PackageScan["sourceEvidence"];
  const warnings: string[] = [];
  if (/\.xml$/i.test(file.name)) {
    if (file.size > 12000000)
      throw new Error("The manifest exceeds the 12 MB limit.");
    xml = new TextDecoder().decode(bytes);
    sourceEvidence = { schemaVersion: 8, manifestOnly: true, resources: {} };
    warnings.push(
      "Manifest only: file presence, content, hashes and question definitions have not been inspected. Choose the original IMSCC for content evidence.",
    );
  } else {
    const zip = await JSZip.loadAsync(bytes);
    const paths = Object.keys(zip.files);
    if (paths.length > 50000)
      throw new Error(
        "This archive exceeds the 50,000-entry inspection limit.",
      );
    // Prefer the cartridge root over any embedded SCORM manifest. Ambiguous
    // packages must be selected explicitly, never resolved by ZIP ordering.
    const manifests = paths.filter(
      (p) => !zip.files[p].dir && /(^|\/)imsmanifest\.xml$/i.test(p),
    );
    const roots = manifests.filter((p) => !p.includes("/"));
    const candidates = roots.length ? roots : manifests;
    if (candidates.length !== 1)
      throw new Error(
        candidates.length
          ? "Multiple package manifests found. Provide an archive containing one cartridge, or choose its manifest XML for structure-only inspection."
          : "imsmanifest.xml was not found in this archive.",
      );
    // The scanner bounds text, hashes and PDF pages. Guard reads
    // that historically lacked an entry-size bound (notably orphan QTI rescue).
    for (const entry of Object.values(zip.files)) {
      const size = Number(
        (entry as unknown as { _data?: { uncompressedSize?: number } })._data
          ?.uncompressedSize || 0,
      );
      if (size > 24 * 1024 * 1024) {
        entry.async = (() =>
          Promise.reject(
            new Error(
              "Entry exceeds the 24 MiB content-read limit; presence remains recorded.",
            ),
          )) as typeof entry.async;
      }
    }
    xml = await zip.files[candidates[0]].async("string");
    if (xml.length > 12000000)
      throw new Error("The manifest exceeds the 12 MB limit.");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("Manifest XML declarations are unsupported.");
    progress({
      phase: "Read content",
      detail: "Reading source files, questions, attachments and dependencies.",
    });
    sourceEvidence = await scanner.buildSourceEvidenceFromZip_(
      zip,
      xml,
      candidates[0],
      progress,
    );
    sourceEvidence.environment = {
      host: "CTI browser package inspector",
      pdfParser: `pdfjs-${pdfjsLib.version}`,
      packageReadLimitBytes: 24 * 1024 * 1024,
    };
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Manifest XML declarations are unsupported.");
  const parsed = scanner.parseXmlCompat_(xml);
  if (!parsed.doc)
    throw new Error(
      "The manifest hierarchy could not be parsed. No complete package scan was produced.",
    );
  if (parsed.repaired)
    warnings.push(
      "The manifest needed the existing compatibility repair pass; its parser diagnostics are retained in the source evidence.",
    );
  progress({
    phase: "Analyze structure",
    detail: "Building the source tree and calculating CTI structural metrics.",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const analysis = engine.analyzeImsccCore_(
    parsed.repairedText || xml,
    file.name,
    sourceEvidence,
  );
  if (!analysis.success || !analysis.courseTree || !analysis.stats)
    throw new Error(analysis.error || "Package analysis failed.");
  const resources = Object.values(sourceEvidence.resources);
  const truncated = resources.filter((r) => r.evidenceTruncated).length;
  const files = resources.flatMap((r) => r.files || []);
  const missing = files.filter((f) => f.presentInPackage === false).length;
  const unresolved =
    sourceEvidence.qtiDiagnostics?.unresolvedQtiResources.length || 0;
  const reads = files.filter(
    (f) =>
      f.readError ||
      f.pdfReadError ||
      (f.pdfParser && /unavailable|error|skipped/.test(f.pdfParser)),
  ).length;
  const hashGaps = files.filter(
    (f) => f.presentInPackage === true && !f.sha256,
  ).length;
  if (truncated)
    warnings.push(
      `${truncated} resource(s) reached scanner evidence limits. Consult the retained limits and per-resource evidenceTruncated markers.`,
    );
  if (missing)
    warnings.push(
      `${missing} file reference(s) were not resolved in the archive. Review their paths and ambiguity markers before declaring a missing source asset.`,
    );
  if (unresolved)
    warnings.push(
      `${unresolved} QTI resource(s) have no resolved structured question evidence.`,
    );
  if (reads)
    warnings.push(
      `${reads} file evidence record(s) contain text/PDF read limitations. Details are retained on the file records.`,
    );
  if (hashGaps)
    warnings.push(
      `${hashGaps} present file evidence record(s) have no SHA-256 fingerprint, including files beyond scanner budgets.`,
    );
  return {
    fileName: analysis.fileName!,
    moduleCount: analysis.moduleCount!,
    courseTree: analysis.courseTree,
    stats: analysis.stats,
    unknownTypesLog: analysis.unknownTypesLog!,
    fileExtensionsLog: analysis.fileExtensionsLog!,
    kind: "CTI_PACKAGE_SCAN",
    schemaVersion: 1,
    fileSha256,
    scannedAt: new Date().toISOString(),
    scope:
      "Local source-package inspection. No destination comparison, runtime verification, publication approval or shared database update has been performed.",
    sourceEvidence,
    warnings,
  };
}
