import { performanceTrace } from '../diagnostics/runtime.ts';
import { readSourceHierarchy } from "./source-hierarchy.ts";
import {
  openSourcePackageZip,
  MAX_SOURCE_PACKAGE_ENTRY_BYTES,
} from "../adapters/source-package-zip.ts";
import {
  hashSourcePackageFile,
  validateSourcePackageFile,
  MAX_SOURCE_MANIFEST_BYTES,
  MAX_SOURCE_PACKAGE_BYTES,
  SOURCE_PACKAGE_HASH_CHUNK_BYTES,
} from "./source-package-file.ts";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
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

export async function scanPackage(
  file: File,
  progress: (p: PackageProgress) => void,
): Promise<PackageScan> {
const diagnosticEnd = performanceTrace().begin('scan');
let diagnosticOutcome = 'observed';
try {

  validateSourcePackageFile(file);
  progress({
    phase: "Open package",
    detail: "Reading the selected file locally.",
  });
  const fileSha256 = await hashSourcePackageFile(file, (completed, total) => {
    progress({
      phase: "Fingerprint package",
      detail: `Reading ${Math.round(completed / 1048576)} of ${Math.ceil(total / 1048576)} MiB in bounded chunks.`,
    });
  });
  let xml: string;
  let sourceEvidence: PackageScan["sourceEvidence"];
  const warnings: string[] = [];
  if (/\.xml$/i.test(file.name)) {
    xml = new TextDecoder().decode(await file.arrayBuffer());
    sourceEvidence = { schemaVersion: 8, manifestOnly: true, resources: {} };
    warnings.push(
      "Manifest only: file presence, content, hashes and question definitions have not been inspected. Choose the original IMSCC for content evidence.",
    );
  } else {
    const zip = await openSourcePackageZip(file);
    try {
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
      if (
        zip.files[candidates[0]]._data.uncompressedSize >
        MAX_SOURCE_MANIFEST_BYTES
      )
        throw new Error("The manifest exceeds the 12 MB limit.");
      xml = await zip.files[candidates[0]].async("string");
      if (xml.length > MAX_SOURCE_MANIFEST_BYTES)
        throw new Error("The manifest exceeds the 12 MB limit.");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new Error("Manifest XML declarations are unsupported.");
      const preflight = performanceTrace().measure('manifest_parse', () => scanner.parseXmlCompat_(xml));
      if (!preflight.doc)
        throw Error("The manifest hierarchy could not be parsed.");
      performanceTrace().measure('manifest_parse', () => readSourceHierarchy(preflight.doc));
      progress({
        phase: "Read content",
        detail:
          "Reading source files, questions, attachments and dependencies.",
      });
      sourceEvidence = await performanceTrace().measure('content_inventory', () => scanner.buildSourceEvidenceFromZip_(
        zip,
        xml,
        candidates[0],
        progress,
        performanceTrace().enabled ? performanceTrace() : undefined,
      ));
      sourceEvidence.environment = {
        host: "CTI browser package inspector",
        pdfParser: `pdfjs-${pdfjsLib.version}`,
        packageReadLimitBytes: MAX_SOURCE_PACKAGE_ENTRY_BYTES,
        packageArchiveLimitBytes: MAX_SOURCE_PACKAGE_BYTES,
        packageHashChunkBytes: SOURCE_PACKAGE_HASH_CHUNK_BYTES,
        packageReadMode: "BLOB_RANGES",
      };
    } finally {
      await zip.close();
    }
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Manifest XML declarations are unsupported.");
  const parsed = performanceTrace().measure('manifest_parse', () => scanner.parseXmlCompat_(xml));
  if (!parsed.doc)
    throw new Error(
      "The manifest hierarchy could not be parsed. No complete package scan was produced.",
    );
  const sourceHierarchy = performanceTrace().measure('manifest_parse', () => readSourceHierarchy(parsed.doc));
  if (parsed.repaired)
    warnings.push(
      "The manifest needed the existing compatibility repair pass; its parser diagnostics are retained in the source evidence.",
    );
  progress({
    phase: "Analyze structure",
    detail: "Building the source tree and calculating CTI structural metrics.",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const analysis = performanceTrace().measure('structure_analysis', () => engine.analyzeImsccCore_(
    parsed.repairedText || xml,
    file.name,
    sourceEvidence,
  ));
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
  if (sourceEvidence.qtiDiagnostics?.incompleteQuestionResources?.length)
    warnings.push(
      `${sourceEvidence.qtiDiagnostics.incompleteQuestionResources.length} assessment resource(s) have incomplete question capture. Declared and captured counts are retained separately.`,
    );
  if (sourceEvidence.qtiDiagnostics?.orphanSearchIncomplete)
    warnings.push(
      "Unreferenced QTI search could not finish within read limits. No orphan assessment was assigned on incomplete evidence.",
    );
  if (hashGaps)
    warnings.push(
      `${hashGaps} present file evidence record(s) have no SHA-256 fingerprint, including files beyond scanner budgets.`,
    );
  performanceTrace().count('unresolved', missing + unresolved + reads + hashGaps);
  performanceTrace().count('items_observed', resources.length);
  return {
    fileName: analysis.fileName!,
    moduleCount: analysis.moduleCount!,
    courseTree: analysis.courseTree,
    sourceHierarchy,
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

} catch (error) { diagnosticOutcome = 'failed'; throw error; } finally { diagnosticEnd(diagnosticOutcome); }
}
