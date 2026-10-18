import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import {
  readBrightspaceCaptureArchive,
  NotBrightspaceCaptureArchiveError,
} from "./brightspace-capture-archive.ts";
import { readCourseraCaptureArchiveBlobs } from "./coursera-capture-archive.ts";
import { readCourseraCaptureFileBytes } from "./coursera-capture-file.ts";
import { parseCourseraShellUrl } from "./coursera-background-extraction.ts";
import { directSourceBindingEvidenceV1 } from "../extractors/coursera/direct-data-contracts.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import {
  directCmlMediaInventoryV1,
  directMediaEvidenceStructureV1,
} from "../extractors/coursera/direct-data-media-contracts.js";
import { directRetainedAssetBodyV1 } from "../extractors/coursera/direct-data-media.js";

export const CAPTURE_REVIEW_SHARING_TARGET_BYTES = 24 * 1024 * 1024;
export const MAX_CAPTURE_REVIEW_TEXT_BYTES = 4 * 1024 * 1024;
export const MAX_CAPTURE_REVIEW_TOTAL_TEXT_BYTES = 128 * 1024 * 1024;
const encoder = new TextEncoder();
type Row = Record<string, any>;
const row = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(row) : [];
const digest = (value: Uint8Array) => bytesToHex(sha256(value));
const json = (value: unknown) =>
  encoder.encode(JSON.stringify(value, null, 2) + "\n");
const ptr = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
const mime = (value: unknown) =>
  typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
const generic = new Set(["application/octet-stream", "binary/octet-stream"]);
const isTextMime = (value: string) =>
  value.startsWith("text/") ||
  /^(?:application\/(?:json|ld\+json|xml|xhtml\+xml|javascript|x-javascript|x-subrip|smil\+xml)|image\/svg\+xml)$/.test(
    value,
  ) ||
  /\+(?:xml|json)$/.test(value);

export interface ReviewOriginalIndex {
  sha256: string;
  bytes: number;
  nativeArchivePath: string;
  recordedMediaTypes: string[];
  recordedUrls: string[];
  nativeBindings: Row[];
  originalVerification: "VERIFIED_BYTES";
  includedInReviewBundle: boolean;
  reviewEntry?: string;
  classificationBasis?: string;
  omissionReason?: "BINARY_OR_UNRECOGNIZED_MEDIA_TYPE";
}
export interface CaptureReviewBundleManifest {
  kind: "CTI_CAPTURE_REVIEW_BUNDLE";
  version: 1;
  notForCourseAudit: true;
  notAnOriginalCapture: true;
  wholeCourseCompletenessCertified: false;
  originalOuterZipVerified: true;
  nativePayloadImmutable: true;
  noSilentTruncation: true;
  createdAt: string;
  platform: "BRIGHTSPACE" | "COURSERA";
  original: { name: string; bytes: number; sha256: string };
  nativeCapture: {
    path: string;
    compressedBytes: number;
    compressedSha256: string;
    expandedBytes: number;
    expandedSha256: string;
  };
  counts: {
    originalsVerified: number;
    originalBytes: number;
    includedTextOriginals: number;
    includedTextBytes: number;
    omittedOriginals: number;
    omittedOriginalBytes: number;
  };
  entries: { path: string; bytes: number; sha256: string }[];
  sharingTargetBytes: number;
  manifestSelfHashExcluded: true;
}
export interface PreparedCaptureReviewBundle {
  file: File;
  manifest: CaptureReviewBundleManifest;
  underSharingTarget: boolean;
  sha256: string;
}

function walk(
  value: unknown,
  visit: (value: Row, path: string) => void,
  path = "",
) {
  if (Array.isArray(value))
    value.forEach((child, index) => walk(child, visit, `${path}/${index}`));
  else if (value && typeof value === "object") {
    visit(value as Row, path);
    Object.entries(value).forEach(([key, child]) =>
      walk(child, visit, `${path}/${ptr(key)}`),
    );
  }
}
function originalIndex(
  path: string,
  sha256: string,
  bytes: number,
): ReviewOriginalIndex {
  return {
    sha256,
    bytes,
    nativeArchivePath: path,
    recordedMediaTypes: [],
    recordedUrls: [],
    nativeBindings: [],
    originalVerification: "VERIFIED_BYTES",
    includedInReviewBundle: false,
  };
}
function addBinding(
  index: ReviewOriginalIndex,
  binding: Row,
  types: unknown[],
  urls: unknown[],
) {
  index.nativeBindings.push(binding);
  for (const value of types)
    if (
      typeof value === "string" &&
      value &&
      !index.recordedMediaTypes.includes(value)
    )
      index.recordedMediaTypes.push(value);
  for (const value of urls)
    if (
      typeof value === "string" &&
      value &&
      !index.recordedUrls.includes(value)
    )
      index.recordedUrls.push(value);
}
function sourceIndex(capture: Row, originals: Map<string, Blob>) {
  const records = new Map<string, ReviewOriginalIndex>();
  for (const [hash, descriptor] of Object.entries(row(capture.assetBodies))) {
    const body = row(descriptor);
    records.set(hash, originalIndex(body.archivePath, hash, body.bytes));
  }
  function visitSourceNode(node: Row, path: string) {
    const ev = row(node.contentEvidence),
      hash = ev.rawBodyRef || ev.originalRef;
    if (hash) {
      const record = records.get(hash);
      if (!record)
        throw Error("A native Brightspace item refers to an unknown original.");
      addBinding(
        record,
        {
          jsonPointer: "/contentTree" + path + "/contentEvidence",
          nativeItem: {
            id: node.id,
            kind: node.kind,
            title: node.title,
            path: node.path,
          },
          receipt: ev.bodyReceipt,
        },
        [ev.contentType, row(ev.bodyReceipt).contentType],
        [ev.url, node.url],
      );
    }
    rows(node.children).forEach((child, index) =>
      visitSourceNode(child, `${path}/children/${index}`),
    );
  }
  rows(capture.contentTree).forEach((node, index) =>
    visitSourceNode(node, `/${index}`),
  );
  rows(capture.contentAcquisition?.assets).forEach((asset, index) => {
    if (!asset.originalRef) return;
    const record = records.get(asset.originalRef);
    if (!record)
      throw Error("A Brightspace asset refers to an unknown original.");
    addBinding(
      record,
      {
        jsonPointer: `/contentAcquisition/assets/${index}`,
        sourceBindings: asset.sourceBindings,
        receipt: asset.receipt,
      },
      [asset.mediaType, row(asset.receipt).contentType],
      [asset.url],
    );
  });
  if (
    records.size !== originals.size ||
    [...records.values()].some(
      (record) =>
        !record.nativeBindings.length || !originals.has(record.sha256),
    )
  )
    throw Error("The verified native source/body inventory is incomplete.");
  return records;
}
async function destinationIndex(
  capture: Row,
  originals: Map<string, Blob>,
  progress: (phase: string) => void,
) {
  const shell = parseCourseraShellUrl(String(capture.page?.url || ""));
  if (
    capture.page?.courseId !== undefined &&
    capture.page.courseId !== shell.courseId
  )
    throw Error(
      "The Coursera page identity belongs to a different native course.",
    );
  const records = new Map<string, ReviewOriginalIndex>();
  for (const [ordinal, fp] of rows(capture.fingerprints).entries()) {
    const payload = row(fp.payload),
      assets = rows(payload.directAssetEvidence?.assets);
    const addNativeBody = (body: Row, path: string) => {
      if (!body?.archivePath) return;
      if (
        !originals.has(body.sha256) ||
        body.archivePath !== "files/" + body.sha256
      )
        throw Error(
          "A Coursera native body reference is not independently verified.",
        );
      const prior = records.get(body.sha256);
      if (prior && prior.bytes !== body.size)
        throw Error("Coursera original descriptors disagree on byte length.");
      const record =
        prior ?? originalIndex(body.archivePath, body.sha256, body.size);
      records.set(body.sha256, record);
      addBinding(
        record,
        {
          jsonPointer: `/fingerprints/${ordinal}${path}`,
          nativeItem: {
            id: fp.id,
            atomId: fp.atomId,
            contentId: fp.contentId,
            name: fp.name,
            path: fp.path,
            ancestors: fp.ancestors,
          },
          receipt: body.receipt,
        },
        [body.mime, row(body.receipt).mime],
        [body.canonicalUrl],
      );
    };
    if (
      assets.some(
        (asset) =>
          asset.body?.archivePath || asset.retainedEvidence?.body?.archivePath,
      )
    ) {
      const nativeDraft = payload.directDataSources?.atom?.elements?.[0]?.draft;
      let nativeDraftHash = "";
      try {
        nativeDraftHash = digest(
          encoder.encode(directCanonicalSourceTextV1(nativeDraft)),
        );
      } catch {
        /* Missing models fail below. */
      }
      if (
        !nativeDraftHash ||
        nativeDraftHash !== payload.directDataEvidence?.draftHash ||
        nativeDraftHash !==
          payload.directDataSources?.receipts?.stability?.draftHash ||
        payload.directDataEvidence?.courseId !== shell.courseId ||
        !directSourceBindingEvidenceV1(fp, {
          ...payload.directDataEvidence,
          courseId: shell.courseId,
          courseSlug: shell.slug,
        })
      )
        throw Error(
          "A Coursera original lacks its exact native item/atom source binding.",
        );
      const references: Row[] = [];
      walk(payload.directDataSources?.atom?.elements?.[0]?.draft, (source) => {
        if (
          source.typeName === "cml" &&
          typeof source.definition?.value === "string"
        ) {
          const parsed = directCmlMediaInventoryV1(
            source.definition.value,
            payload.directDataEvidence?.textProjectionVersion ?? 1,
          );
          if (!parsed.valid)
            throw Error(
              "A Coursera original's native CML reference model is invalid.",
            );
          references.push(...parsed.references);
        }
      });
      for (const [assetOrdinal, asset] of assets.entries()) {
        const ownedReferences = references.filter(
          (reference) => reference.id === asset.assetId,
        );
        if (
          !ownedReferences.length &&
          (asset.body?.archivePath || asset.retainedEvidence?.body?.archivePath)
        )
          throw Error(
            "A Coursera original is attached to a different native item's CML.",
          );
        for (const [body, retained] of [
          [asset.body, false],
          [asset.retainedEvidence?.body, true],
        ] as const) {
          if (!body?.archivePath) continue;
          const original = originals.get(body.sha256);
          if (!original)
            throw Error("A Coursera original body is unavailable.");
          progress(
            "Checking Coursera original metadata, source ownership and signatures",
          );
          const bytes = new Uint8Array(await original.arrayBuffer());
          const own = { ...body };
          Object.defineProperty(own, "bytes", {
            value: bytes,
            enumerable: false,
          });
          if (retained) {
            if (
              !(await directRetainedAssetBodyV1(
                { ...asset.retainedEvidence, body: own },
                asset.assetId,
              ))
            )
              throw Error(
                "A retained Coursera original has invalid historical source metadata or bytes.",
              );
          } else {
            const proof = directMediaEvidenceStructureV1(
              {
                method: "BOUND_CML_ASSET_METADATA_AND_BODY",
                assets: [{ ...asset, body: own }],
                failures: [],
                missingPointers: [],
              },
              ownedReferences,
            );
            if (!proof.complete)
              throw Error(
                `A Coursera original's native source/body proof failed: ${proof.reason}.`,
              );
          }
          addNativeBody(
            body,
            `/payload/directAssetEvidence/assets/${assetOrdinal}/${retained ? "retainedEvidence/body" : "body"}`,
          );
        }
      }
    }
    if (
      rows(payload.directPanoptoEvidence?.deliveries).some((delivery) =>
        rows(delivery.podcasts).some(
          (podcast) =>
            podcast.body?.archivePath ||
            podcast.retainedEvidence?.podcast?.body?.archivePath,
        ),
      ) &&
      capture.meta?.directDataCapture?.materials?.elements?.[0]?.id !==
        shell.courseId
    )
      throw Error(
        "A Panopto original's native material ownership belongs to a different course.",
      );
    rows(payload.directPanoptoEvidence?.deliveries).forEach(
      (delivery, deliveryOrdinal) => {
        rows(delivery.podcasts).forEach((podcast, podcastOrdinal) => {
          addNativeBody(
            podcast.body,
            `/payload/directPanoptoEvidence/deliveries/${deliveryOrdinal}/podcasts/${podcastOrdinal}/body`,
          );
          addNativeBody(
            podcast.retainedEvidence?.podcast?.body,
            `/payload/directPanoptoEvidence/deliveries/${deliveryOrdinal}/podcasts/${podcastOrdinal}/retainedEvidence/podcast/body`,
          );
        });
      },
    );
    /* Explicit native paths above exclude arbitrary archivePath-shaped data. */
  }
  if (records.size !== originals.size)
    throw Error("The verified Coursera original inventory has unbound files.");
  return records;
}

/** Classify by captured declarations, never by guessed source content. The only
 * generic-MIME exception is an explicitly recorded CSV URL with exact UTF-8. */
export async function classifyReviewOriginal(
  record: Pick<
    ReviewOriginalIndex,
    "recordedMediaTypes" | "recordedUrls" | "bytes"
  >,
  blob: Blob,
) {
  if (
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 0 ||
    !(blob instanceof Blob) ||
    blob.size !== record.bytes
  )
    throw Error(
      "A review original's byte length differs from its verified native descriptor.",
    );
  const types = [
    ...new Set(record.recordedMediaTypes.map(mime).filter(Boolean)),
  ];
  const specific = types.filter((type) => !generic.has(type));
  const textual = specific.length > 0 && specific.every(isTextMime);
  if (specific.some(isTextMime) && !textual)
    throw Error(
      "An original has contradictory textual and binary native MIME declarations.",
    );
  const csv =
    specific.length === 0 &&
    types.length > 0 &&
    record.recordedUrls.some((value) => {
      try {
        return /\.csv$/i.test(decodeURIComponent(new URL(value).pathname));
      } catch {
        return false;
      }
    });
  if (!textual && !csv)
    return {
      included: false as const,
      reason: "BINARY_OR_UNRECOGNIZED_MEDIA_TYPE" as const,
    };
  if (record.bytes > MAX_CAPTURE_REVIEW_TEXT_BYTES)
    throw Error(
      "A textual original exceeds the independent 4 MiB review bound. Use the complete original capture; no text was trimmed.",
    );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw Error(
      "A declared textual original is not strict UTF-8. A complete textual review bundle cannot be prepared; use the original capture.",
    );
  }
  const encoded = encoder.encode(text);
  if (
    text.includes("\0") ||
    encoded.length !== bytes.length ||
    encoded.some((value, index) => value !== bytes[index])
  )
    throw Error(
      "A textual original does not round-trip exactly as UTF-8. Use the original capture; no text was changed.",
    );
  return {
    included: true as const,
    basis: textual
      ? "DECLARED_TEXTUAL_MIME_AND_STRICT_UTF8_ROUNDTRIP"
      : "RECORDED_CSV_URL_WITH_GENERIC_MIME_AND_STRICT_UTF8_ROUNDTRIP",
  };
}

/** A distinct review artifact, never a native audit input. Preparation performs
 * no upload, LMS request, content generation, normalization or truncation. */
export async function prepareCaptureReviewBundle(
  file: File,
  progress: (phase: string) => void = () => {},
): Promise<PreparedCaptureReviewBundle> {
  if (!/\.cti\.zip$/i.test(file.name))
    throw Error(
      "Choose the original Brightspace or Coursera .cti.zip capture. JSON and review bundles cannot replace its complete original-file archive.",
    );
  progress(
    "Verifying the full original archive and every retained body locally",
  );
  const expand = async (gzip: Uint8Array) =>
    (
      await readCourseraCaptureFileBytes(
        new File([gzip as BlobPart], "capture.json.gz"),
      )
    ).bytes;
  let platform: "BRIGHTSPACE" | "COURSERA",
    native: {
      bytes: Uint8Array;
      compressedMetadata: Uint8Array;
      capture: unknown;
      archiveSha256: string;
    },
    originals: Map<string, Blob>;
  try {
    const input = await readBrightspaceCaptureArchive(file, expand);
    platform = "BRIGHTSPACE";
    native = input;
    originals = new Map(
      input.archiveFiles.map((body) => [body.sha256, body.blob]),
    );
  } catch (error) {
    if (!(error instanceof NotBrightspaceCaptureArchiveError)) throw error;
    const input = await readCourseraCaptureArchiveBlobs(file, expand);
    platform = "COURSERA";
    native = input;
    originals = new Map(
      input.archiveBlobs.map((body) => [body.sha256, body.blob]),
    );
  }
  const capture = row(native.capture);
  const records =
    platform === "BRIGHTSPACE"
      ? sourceIndex(capture, originals)
      : await destinationIndex(capture, originals, progress);
  const payloads: { path: string; blob: Blob; hash: string }[] = [];
  const add = (path: string, bytes: Uint8Array) =>
    payloads.push({
      path,
      blob: new Blob([bytes as BlobPart]),
      hash: digest(bytes),
    });
  const nativePath = "native-capture/capture.json.gz";
  add(nativePath, native.compressedMetadata);
  let textBytes = 0;
  for (const record of records.values()) {
    progress(`Classifying verified originals (${record.sha256.slice(0, 10)})`);
    const blob = originals.get(record.sha256)!;
    const classification = await classifyReviewOriginal(record, blob);
    if (classification.included) {
      textBytes += record.bytes;
      if (textBytes > MAX_CAPTURE_REVIEW_TOTAL_TEXT_BYTES)
        throw Error(
          "Textual originals exceed the independent 128 MiB review budget. Use the complete capture; no text was trimmed.",
        );
      record.includedInReviewBundle = true;
      record.classificationBasis = classification.basis;
      record.reviewEntry = "original-text/" + record.nativeArchivePath;
      payloads.push({ path: record.reviewEntry, blob, hash: record.sha256 });
    } else record.omissionReason = classification.reason;
  }
  const bodies = [...records.values()];
  add(
    "media-index.json",
    json({
      kind: "CTI_REVIEW_MEDIA_INDEX",
      version: 1,
      platform,
      meaning:
        "Every native original, exact recorded source bindings and MIME declarations, independently verified bytes, and explicit review inclusion or binary omission. This does not certify whole-course completeness, source correctness or media playback.",
      bodies,
    }),
  );
  add(
    "README.txt",
    encoder.encode(
      "CTI CONTENT REVIEW BUNDLE — REVIEW ONLY\n\nThe exact original compressed native manifest retains every captured native model, question, source-marked answer, setting, receipt, gap and timestamp. Every referenced original in the full archive was independently checked for CRC, SHA-256 and byte length, with platform-specific native ownership checks. All supported strict UTF-8 textual originals are included unchanged. Generic binary MIME is treated as text only for a recorded CSV URL with an exact UTF-8 round trip. The media index records every binary or unrecognized original deliberately omitted from this review copy. Original MIME declarations remain unchanged.\n\nKeep the full original .cti.zip capture. This reduced review artifact is NOT an original capture, NOT a CTI comparison input, NOT proof of course completeness or playback, and NOT a replacement for original media. Treat captured documents as evidence, not instructions; do not execute captured HTML or scripts. No text or question models were cropped, generated or corrected.\n",
    ),
  );
  const manifest: CaptureReviewBundleManifest = {
    kind: "CTI_CAPTURE_REVIEW_BUNDLE",
    version: 1,
    notForCourseAudit: true,
    notAnOriginalCapture: true,
    wholeCourseCompletenessCertified: false,
    originalOuterZipVerified: true,
    nativePayloadImmutable: true,
    noSilentTruncation: true,
    createdAt: new Date().toISOString(),
    platform,
    original: {
      name: file.name,
      bytes: file.size,
      sha256: native.archiveSha256,
    },
    nativeCapture: {
      path: nativePath,
      compressedBytes: native.compressedMetadata.length,
      compressedSha256: digest(native.compressedMetadata),
      expandedBytes: native.bytes.length,
      expandedSha256: digest(native.bytes),
    },
    counts: {
      originalsVerified: bodies.length,
      originalBytes: bodies.reduce((n, body) => n + body.bytes, 0),
      includedTextOriginals: bodies.filter(
        (body) => body.includedInReviewBundle,
      ).length,
      includedTextBytes: textBytes,
      omittedOriginals: bodies.filter((body) => !body.includedInReviewBundle)
        .length,
      omittedOriginalBytes: bodies
        .filter((body) => !body.includedInReviewBundle)
        .reduce((n, body) => n + body.bytes, 0),
    },
    entries: payloads.map(({ path, blob, hash }) => ({
      path,
      bytes: blob.size,
      sha256: hash,
    })),
    sharingTargetBytes: CAPTURE_REVIEW_SHARING_TARGET_BYTES,
    manifestSelfHashExcluded: true,
  };
  add("review-manifest.json", json(manifest));
  progress("Compressing unchanged content into one review file");
  const writer = new ZipWriter(new BlobWriter("application/zip"), {
    useWebWorkers: false,
    zip64: false,
    level: 9,
  });
  for (const payload of payloads)
    await writer.add(payload.path, new BlobReader(payload.blob));
  const blob = await writer.close();
  const name = file.name.replace(/\.cti\.zip$/i, "") + ".review.zip";
  const output = new File([blob], name, { type: "application/zip" });
  const hasher = sha256.create();
  for (let start = 0; start < output.size; start += 1024 * 1024)
    hasher.update(
      new Uint8Array(
        await output.slice(start, start + 1024 * 1024).arrayBuffer(),
      ),
    );
  progress("Complete review file ready; original capture unchanged");
  return {
    file: output,
    manifest,
    underSharingTarget: output.size <= CAPTURE_REVIEW_SHARING_TARGET_BYTES,
    sha256: bytesToHex(hasher.digest()),
  };
}
