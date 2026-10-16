import {
  readCourseraCaptureFileBytes,
  attachCourseraArchiveFileBytes,
} from "../domain/coursera-capture-file.ts";
import { encodeJavaScriptBookmarkPayload } from "../domain/bookmark-address.js";
import {
  bindDirectAuthoringDraftV1,
  directDraftReadingSourceV1,
} from "../extractors/coursera/direct-data-models.js";
import { directSourceBindingEvidenceV1 } from "../extractors/coursera/direct-data-contracts.js";
import {
  directCmlMediaInventoryV1,
  directMediaEvidenceStructureV1,
} from "../extractors/coursera/direct-data-media-contracts.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The activity workspace consumes the same saved bookmark and original
 * capture as reconciliation. This bridge adds no Coursera readers or routes. */
export function bookmark(source: string): string {
  if (typeof source !== "string" || !source.trim())
    throw Error("The course capture bookmark is unavailable.");
  const address =
    "javascript:" + encodeJavaScriptBookmarkPayload("void " + source);
  if (new TextEncoder().encode(address).byteLength >= 500 * 1024)
    throw Error("The complete bookmark exceeds Chrome's safe address limit.");
  return address;
}

/** Range reads, ZIP paths, CRC, original-body SHA-256 and ownership use the
 * maintained importer. No separate, weaker archive implementation lives here. */
export async function read(file: File) {
  const imported = await readCourseraCaptureFileBytes(file);
  let raw: any;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(imported.bytes),
    );
  } catch {
    throw Error("The selected course capture is not valid UTF-8 JSON.");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Array.isArray(raw.fingerprints) ||
    !raw.page?.courseId ||
    raw.kind === "FOCUSED_EXTRACTOR_DIAGNOSTIC" ||
    raw.notForCourseAudit === true ||
    raw.kind === "CTI_COURSERA_READING_RECOVERY"
  )
    throw Error(
      "Select the original full CTI course capture, not a diagnostic or supplemental file.",
    );
  if (imported.archiveFiles)
    attachCourseraArchiveFileBytes(raw, imported.archiveFiles);
  return {
    raw,
    sha256: imported.transport?.sha256 || bytesToHex(sha256(imported.bytes)),
    transport: imported.transport || null,
  };
}

/** Only current, bound reading PDFs can enter the smaller activity work packet.
 * Other retained originals remain in the source capture. The existing packet
 * limit is explicit and cannot silently discard the source archive itself. */
export function pdfs(raw: any) {
  const result: {
    itemId: string;
    name: string;
    asset: { sha256: string; mime: string; size: number; base64: string };
  }[] = [];
  const retained = new Set<string>();
  let bytes = 0;
  for (const fp of raw.fingerprints || []) {
    const payload = fp?.payload,
      sources = payload?.directDataSources;
    if (!sources?.atom || !sources?.relation) continue;
    const slug =
      sources.relation.elements?.[0]?.branchRelationMap?.[
        raw.page.courseId + "~" + fp.id
      ]?.courseSlug;
    let bound: any, source: any;
    try {
      bound = bindDirectAuthoringDraftV1(
        fp,
        raw.page.courseId,
        slug,
        sources.atom,
        sources.relation,
      );
      if (!directSourceBindingEvidenceV1(fp, bound)) continue;
      source = directDraftReadingSourceV1(bound);
    } catch {
      continue;
    }
    if (!source?.cml) continue;
    const inventory = directCmlMediaInventoryV1(source.cml);
    if (!inventory.valid) continue;
    const media = directMediaEvidenceStructureV1(
      payload.directAssetEvidence,
      inventory.references,
    );
    if (!media.complete) continue;
    for (const original of media.decoded) {
      if (original.kind !== "PDF") continue;
      const body = original.asset.body;
      if (!retained.has(body.sha256) && bytes + body.size > 8 * 1024 * 1024)
        continue;
      if (!retained.has(body.sha256)) bytes += body.size;
      retained.add(body.sha256);
      let binary = "";
      for (let offset = 0; offset < original.bytes.length; offset += 0x8000)
        binary += String.fromCharCode(
          ...original.bytes.subarray(offset, offset + 0x8000),
        );
      result.push({
        itemId: fp.id,
        name: original.asset.metadata.elements[0].name || "",
        asset: {
          sha256: body.sha256,
          mime: "application/pdf",
          size: body.size,
          base64: btoa(binary),
        },
      });
    }
  }
  return result;
}
