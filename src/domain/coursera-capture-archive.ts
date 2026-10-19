import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directPanoptoArchiveBodiesV1 } from "../extractors/coursera/direct-data-panopto-contracts.js";
import { bindDirectAuthoringDraftV1 } from "../extractors/coursera/direct-data-models.js";
import { directInlineWidgetEvidenceV1 } from "../extractors/coursera/direct-data-contracts.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { directPublisherResourceEvidenceV1 } from "../extractors/coursera/direct-data-publisher.js";
import { directPublisherMediaStructureV1, directPublisherImageKindV1 } from "../extractors/coursera/direct-data-publisher-media.js";
import { directPublisherFirstPartyPlanV1 } from "../extractors/coursera/direct-data-publisher-first-party.js";
import { directMaterialStabilityModelV1 } from "../extractors/coursera/direct-data-material-stability.js";

export const MAX_COURSERA_ARCHIVE_BYTES = 640 * 1024 * 1024;
export const MAX_COURSERA_ARCHIVE_ORIGINAL_BYTES = 512 * 1024 * 1024;
export const MAX_COURSERA_ARCHIVE_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_COURSERA_ARCHIVE_PANOPTO_BYTES = 128 * 1024 * 1024;

export interface CourseraArchiveFile {
  path: string;
  sha256: string;
  size: number;
  bytes: Uint8Array;
  kind?: "PANOPTO_PODCAST_RENDITION";
}

export interface CourseraArchiveBlob {
  path: string;
  sha256: string;
  size: number;
  blob: Blob;
}

interface ArchiveEntry {
  path: string;
  size: number;
  crc32: number;
  flags: number;
  versionNeeded: number;
  localOffset: number;
  dataOffset: number;
  endOffset: number;
}

export interface CourseraArchiveReadResult {
  bytes: Uint8Array;
  archiveFiles: CourseraArchiveFile[];
  archiveSha256: string;
  originalBodyBytes: number;
}

function archiveError(message: string): never {
  throw new Error(`Invalid Coursera capture archive: ${message}`);
}

function little(view: DataView, offset: number, bytes = 4): number {
  return bytes === 2
    ? view.getUint16(offset, true)
    : view.getUint32(offset, true);
}

async function range(
  file: File,
  start: number,
  end: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > file.size
  )
    archiveError("entry ranges exceed the selected file.");
  const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
  if (bytes.length !== end - start)
    archiveError("the selected file was not read completely.");
  return bytes;
}

function crcUpdate(crc: number, bytes: Uint8Array, table: Uint32Array): number {
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return crc >>> 0;
}

function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return archiveError("an entry name or capture contains invalid UTF-8.");
  }
}

function validPath(path: string): boolean {
  return path === "capture.json.gz" || /^files\/[a-f0-9]{64}$/.test(path);
}

/** Validate a frozen recovery manifest once per archive, then use exact source
 * membership for each body. This is ownership context, not HTTP attestation. */
function publisherFirstPartyRecoveryValid(captureMode: any, courseId: string, receipt: any, cache: Map<any,any>): boolean {
  try {
    const matches = (contexts: Map<string,any>) => {
      const binding = receipt.firstPartyBinding, context = contexts.get(binding?.sessionId + ":" + binding?.planSha256);
      return Boolean(context && Date.parse(context.readyAt) <= Date.parse(receipt.responseObservedAt) &&
        context.entries.has(directCanonicalSourceTextV1({itemId:binding.itemId,atomId:binding.atomId,providerId:binding.providerId,
          targetUrl:binding.targetUrl,imageUrl:receipt.requestedUrl,sourceSha256:binding.sourceSha256})));
    };
    if (cache.has(captureMode)) return matches(cache.get(captureMode));
    const hashValue = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(directCanonicalSourceTextV1(value)))),
      history = captureMode?.firstPartyRecoveryHistory;
    if (history !== undefined && (!Array.isArray(history) || history.length > 16)) return false;
    const contexts = [captureMode?.firstPartyRecovery,...(history || [])], seen = new Set<string>(),
      comparison = captureMode?.materialStability,
      initial = captureMode?.materials?.elements?.[0];
    if (!initial || initial.id !== courseId || comparison?.policy !== "NATIVE_ASSIGNMENT_FEATURE_FLAGS_V1" ||
        hashValue(directMaterialStabilityModelV1(initial)) !== comparison.initialSha256 ||
        captureMode.finalMaterials && (hashValue(directMaterialStabilityModelV1(captureMode.finalMaterials.elements?.[0])) !== comparison.initialSha256 ||
          comparison.finalSha256 !== comparison.initialSha256)) return false;
    const prepared = new Map<string,any>();
    for (const context of contexts) {
      const plan = context && directPublisherFirstPartyPlanV1(courseId,context.entries);
      if (!plan || Object.keys(context).length !== 14 || Object.keys(context).some(key => !["scope","courseId","origin","planSha256","sessionId","requestedAt","readyAt",
          "pinnedRunId","pinnedMaterialHash","pinnedComparisonSha256","entries","publisherPagesRefetched","wholeWidgetVerified","publishedContentVerified"].includes(key)) ||
          context.scope !== "PLANNED_PUBLISHER_IMAGES" || context.courseId !== courseId || context.origin !== plan.origin ||
          !/^[a-f0-9]{64}$/.test(context.pinnedMaterialHash || "") || context.pinnedComparisonSha256 !== comparison.initialSha256 ||
          typeof captureMode.runId !== "string" || !captureMode.runId || context.pinnedRunId !== captureMode.runId ||
          !/^[a-f0-9]{32}$/.test(context.sessionId || "") ||
          !Number.isFinite(Date.parse(context.requestedAt)) || new Date(context.requestedAt).toISOString() !== context.requestedAt ||
          !Number.isFinite(Date.parse(context.readyAt)) || new Date(context.readyAt).toISOString() !== context.readyAt || Date.parse(context.requestedAt) > Date.parse(context.readyAt) ||
          context.publisherPagesRefetched !== false || context.wholeWidgetVerified !== false || context.publishedContentVerified !== false ||
          directCanonicalSourceTextV1(context.entries) !== directCanonicalSourceTextV1(plan.entries) ||
          context.planSha256 !== hashValue({courseId,entries:plan.entries})) return false;
      const key = context.sessionId + ":" + context.planSha256;
      if (seen.has(key)) return false;
      seen.add(key);
      prepared.set(key,{readyAt:context.readyAt,entries:new Set(plan.entries.map((entry: any) => directCanonicalSourceTextV1(entry)))});
    }
    cache.set(captureMode,prepared);
    return matches(prepared);
  } catch (_) { return false; }
}

/** A failed current refresh cannot revoke independently proven historical file
 * ownership. Omitting that marker here makes no current-content claim. */
function publisherOwnedBodies(fp: any, courseId: string, captureMode: any, recoveryCache: Map<any,any>): Set<any> {
  const result = new Set<any>(), hashBytes = (bytes: Uint8Array) => bytesToHex(sha256(bytes)),
    hashValue = (value: unknown) => hashBytes(new TextEncoder().encode(directCanonicalSourceTextV1(value)));
  try {
    const payload = { ...fp.payload };
    delete payload.directResumeRevalidation;
    const retained = {...fp,payload}, sources = payload.directDataSources,
      branch = sources.relation.elements[0].branchRelationMap[courseId + "~" + fp.id],
      bound = bindDirectAuthoringDraftV1(retained,courseId,branch.courseSlug,sources.atom,sources.relation),
      checked = directInlineWidgetEvidenceV1(retained,bound,hashValue);
    if (!checked) return result;
    for (const proof of payload.directInlineWidgetProviderEvidence.providers || []) {
      const valid = checked.providers.find((value: any) => value.binding.providerId === proof.providerId);
      if (!valid || !Array.isArray(proof.publisherPages) || proof.publisherPages.length > 64) continue;
      const seen = new Set<string>();
      for (const page of proof.publisherPages) {
        if (!page?.media) continue;
        const fields = [...new Set(valid.targets.filter((target: any) => target.url === page.targetUrl).map((target: any) => target.sourceField))],
          observation = page.observation || page.retainedObservation;
        if (!fields.length || seen.has(page.targetUrl) || hashValue(fields) !== hashValue(page.sourceFields) ||
            !directPublisherResourceEvidenceV1(observation,page.targetUrl,hashBytes) ||
            !directPublisherMediaStructureV1(observation,page.targetUrl,page.media,
              {courseId,itemId:fp.id,atomId:fp.atomId,providerId:proof.providerId})) return new Set();
        seen.add(page.targetUrl);
        for (const group of [{observation,resources:page.media.resources},...(page.media.retained || [])]) {
          if (!directPublisherResourceEvidenceV1(group.observation,page.targetUrl,hashBytes)) return new Set();
          for (const resource of group.resources) if (resource.body) {
            if (resource.body.receipt?.transport === "FIRST_PARTY_BROWSER" &&
                (!(Date.parse(resource.body.receipt.observedAt) <= Date.parse(sources.receipts.stability.receipt.observedAt)) ||
                  !publisherFirstPartyRecoveryValid(captureMode,courseId,resource.body.receipt,recoveryCache))) return new Set();
            result.add(resource.body);
          }
        }
      }
    }
    return result;
  } catch (_) { return new Set(); }
}

function nativeBodyReferences(capture: unknown) {
  if (!capture || typeof capture !== "object" || Array.isArray(capture))
    archiveError("the capture metadata is not an object.");
  const raw = capture as Record<string, any>,
    references: { body: Record<string, any>; podcast: boolean }[] = [],
    courseId = raw.meta?.directDataCapture?.materials?.elements?.[0]?.id,
    recoveryCache = new Map<any,any>();
  if (!Array.isArray(raw.fingerprints)) return references;
  const add = (body: any, podcast: boolean) => {
    if (!body || !Object.hasOwn(body, "archivePath")) return;
    if (
      typeof body.archivePath !== "string" ||
      body.archivePath !== "files/" + body.sha256 ||
      !/^[a-f0-9]{64}$/.test(body.sha256 || "")
    )
      archiveError("a native body reference has a mismatched file identity.");
    if (
      !Number.isSafeInteger(body.size) ||
      body.size < 1 ||
      body.size >
        (podcast
          ? MAX_COURSERA_ARCHIVE_PANOPTO_BYTES
          : MAX_COURSERA_ARCHIVE_FILE_BYTES)
    )
      archiveError(
        podcast
          ? "a Panopto podcast rendition exceeds its 128 MiB bound."
          : "an original file exceeds its 16 MiB bound.",
      );
    references.push({ body, podcast });
  };
  for (const fp of raw.fingerprints) {
    const assets = fp?.payload?.directAssetEvidence?.assets;
    if (assets != null) {
      if (!Array.isArray(assets))
        archiveError("an item has an invalid native asset inventory.");
      for (const asset of assets) {
        add(asset?.body, false);
        add(asset?.retainedEvidence?.body, false);
      }
    }
    const publisherBodies = publisherOwnedBodies(fp,courseId,raw.meta?.directDataCapture,recoveryCache);
    for (const evidence of [fp?.payload?.directInlineWidgetProviderEvidence,fp?.payload?.directInlineWidgetProviderAttempt])
      for (const provider of evidence?.providers || [])
        for (const page of provider.publisherPages || [])
          for (const group of [{resources:page.media?.resources || []},...(page.media?.retained || [])])
            for (const resource of group.resources || []) if (resource.body) {
              if (!publisherBodies.has(resource.body)) archiveError("a publisher image has no independently verified native source binding.");
              add(resource.body,false);
            }
    const deliveries = fp?.payload?.directPanoptoEvidence?.deliveries;
    if (deliveries == null) continue;
    if (!Array.isArray(deliveries))
      archiveError("an item has an invalid Panopto delivery inventory.");
    const owned = new Set(directPanoptoArchiveBodiesV1(fp, courseId));
    for (const delivery of deliveries) {
      if (!Array.isArray(delivery?.podcasts)) {
        if (delivery?.podcasts == null) continue;
        archiveError("an item has an invalid Panopto podcast inventory.");
      }
      for (const podcast of delivery.podcasts) {
        for (const source of [podcast, podcast?.retainedEvidence?.podcast]) {
          const body = source?.body;
          if (!body || !Object.hasOwn(body, "archivePath")) continue;
          if (!owned.has(body))
            archiveError(
              "a Panopto body reference has no native source binding.",
            );
          add(body, true);
        }
      }
    }
  }
  return references;
}

function mp4(bytes: Uint8Array) {
  return (
    bytes.length >= 12 &&
    bytes[4] === 102 &&
    bytes[5] === 116 &&
    bytes[6] === 121 &&
    bytes[7] === 112
  );
}

/** Resolve only explicit native asset-body references. This leaves the capture
 * JSON unchanged for hashing/serialization and carries original bytes as an
 * own, non-enumerable property. Worker callers must also carry archiveFiles. */
export function attachCourseraArchiveFileBytes(
  capture: unknown,
  archiveFiles: CourseraArchiveFile[],
): unknown {
  const references = nativeBodyReferences(capture),
    podcasts = new Set(
      references
        .filter((entry) => entry.podcast)
        .map((entry) => entry.body.archivePath),
    );
  if (!Array.isArray(archiveFiles))
    archiveError("the original file inventory is missing.");
  const files = new Map<string, CourseraArchiveFile>();
  let total = 0;
  for (const file of archiveFiles) {
    if (
      !file ||
      !/^files\/[a-f0-9]{64}$/.test(file.path) ||
      file.path !== "files/" + file.sha256 ||
      files.has(file.path) ||
      !(file.bytes instanceof Uint8Array) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size >
        (podcasts.has(file.path)
          ? MAX_COURSERA_ARCHIVE_PANOPTO_BYTES
          : MAX_COURSERA_ARCHIVE_FILE_BYTES) ||
      file.bytes.byteLength !== file.size ||
      bytesToHex(sha256(file.bytes)) !== file.sha256
    )
      archiveError(
        "an original file has a duplicate path, invalid size or failed checksum.",
      );
    total += file.size;
    if (total > MAX_COURSERA_ARCHIVE_ORIGINAL_BYTES)
      archiveError("original files exceed the 512 MiB bound.");
    files.set(file.path, file);
  }
  const referenced = new Set<string>();
  for (const { body, podcast } of references) {
    const file = files.get(body.archivePath);
    if (!file || body.size !== file.size || Object.hasOwn(body, "base64"))
      archiveError(
        "a referenced original file is absent or differs from its body receipt.",
      );
    if (podcast && !mp4(file.bytes))
      archiveError("a Panopto podcast body is not an MP4 rendition.");
    if (body.receipt?.resource === "PublisherImage" && !directPublisherImageKindV1(file.bytes,body.mime))
      archiveError("a publisher image original differs from its recorded raster format.");
    if (Object.hasOwn(body, "bytes")) {
      const prior = Object.getOwnPropertyDescriptor(body, "bytes");
      if (
        !prior ||
        !("value" in prior) ||
        prior.enumerable ||
        !(prior.value instanceof Uint8Array) ||
        bytesToHex(sha256(prior.value)) !== file.sha256
      )
        archiveError(
          "a native file resolver contradicts its verified original bytes.",
        );
    }
    Object.defineProperty(body, "bytes", {
      value: file.bytes,
      enumerable: false,
      configurable: true,
    });
    referenced.add(file.path);
    if (podcast) file.kind = "PANOPTO_PODCAST_RENDITION";
  }
  if (referenced.size !== files.size)
    archiveError("the archive contains unreferenced original files.");
  return capture;
}

/** ZIP_STORE range reads keep the complete archive out of JS memory. Metadata
 * and each original file have independent bounds, CRC32 and SHA-256 checks. */
async function readCourseraCaptureArchiveInternal(
  file: File,
  expandMetadata: (gzip: Uint8Array) => Promise<Uint8Array>,
  limits: {
    archiveBytes?: number;
    originalBytes?: number;
    metadataBytes?: number;
  } = {},
  retainOriginalBlobs = false,
): Promise<
  CourseraArchiveReadResult & {
    archiveBlobs: CourseraArchiveBlob[];
    capture: unknown;
    compressedMetadata: Uint8Array;
  }
> {
  const cap = (requested: number | undefined, maximum: number) =>
    requested === undefined
      ? maximum
      : Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, maximum)
        : archiveError("invalid transport limits.");
  const archiveLimit = cap(limits.archiveBytes, MAX_COURSERA_ARCHIVE_BYTES),
    originalLimit = cap(
      limits.originalBytes,
      MAX_COURSERA_ARCHIVE_ORIGINAL_BYTES,
    ),
    metadataLimit = cap(limits.metadataBytes, 128 * 1024 * 1024);
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 22 ||
    file.size > archiveLimit
  )
    archiveError("the ZIP exceeds the 640 MiB archive bound or is truncated.");
  const tailOffset = Math.max(0, file.size - 65557),
    tail = await range(file, tailOffset, file.size),
    tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let footer = -1;
  for (let position = tail.length - 22; position >= 0; position--) {
    if (
      little(tailView, position) === 0x06054b50 &&
      position + 22 + little(tailView, position + 20, 2) === tail.length
    ) {
      footer = position;
      break;
    }
  }
  if (footer < 0) archiveError("the ZIP footer is missing.");
  const count = little(tailView, footer + 10, 2),
    directorySize = little(tailView, footer + 12),
    directoryOffset = little(tailView, footer + 16),
    footerOffset = tailOffset + footer;
  if (
    little(tailView, footer + 4, 2) ||
    little(tailView, footer + 6, 2) ||
    little(tailView, footer + 8, 2) !== count ||
    count < 1 ||
    count > 20001 ||
    directorySize < 46 ||
    directorySize > 4 * 1024 * 1024 ||
    directoryOffset + directorySize !== footerOffset
  )
    archiveError("multi-disk, ZIP64 or oversized directories are unsupported.");
  const directory = await range(file, directoryOffset, footerOffset),
    view = new DataView(
      directory.buffer,
      directory.byteOffset,
      directory.byteLength,
    ),
    entries: ArchiveEntry[] = [],
    names = new Set<string>();
  let offset = 0,
    originals = 0;
  for (let position = 0; position < count; position++) {
    if (offset + 46 > directory.length || little(view, offset) !== 0x02014b50)
      archiveError("the ZIP directory is damaged.");
    const versionNeeded = little(view, offset + 6, 2),
      flags = little(view, offset + 8, 2),
      method = little(view, offset + 10, 2),
      crc32 = little(view, offset + 16),
      compressed = little(view, offset + 20),
      size = little(view, offset + 24),
      nameSize = little(view, offset + 28, 2),
      extraSize = little(view, offset + 30, 2),
      commentSize = little(view, offset + 32, 2),
      disk = little(view, offset + 34, 2),
      localOffset = little(view, offset + 42),
      next = offset + 46 + nameSize + extraSize + commentSize;
    if (
      next > directory.length ||
      versionNeeded < 10 ||
      versionNeeded > 20 ||
      flags & ~(0x0800 | 0x0008) ||
      method !== 0 ||
      disk ||
      compressed !== size ||
      size < 1 ||
      size === 0xffffffff ||
      localOffset === 0xffffffff
    )
      archiveError(
        "encrypted, compressed, ZIP64 or invalid-sized entries are unsupported.",
      );
    const path = utf8(directory.subarray(offset + 46, offset + 46 + nameSize));
    if (!validPath(path) || names.has(path))
      archiveError("an entry path is duplicated or unsafe.");
    names.add(path);
    if (path === "capture.json.gz") {
      if (size > metadataLimit)
        archiveError("compressed metadata exceeds its 128 MiB bound.");
    } else {
      // This preliminary ceiling does not authorize a large original. The
      // manifest's native source bindings must do that before its allocation.
      if (size > MAX_COURSERA_ARCHIVE_PANOPTO_BYTES)
        archiveError("an original file exceeds its 128 MiB transport ceiling.");
      originals += size;
      if (originals > originalLimit)
        archiveError("original files exceed their 512 MiB bound.");
    }
    entries.push({
      path,
      size,
      crc32,
      flags,
      versionNeeded,
      localOffset,
      dataOffset: 0,
      endOffset: 0,
    });
    offset = next;
  }
  if (offset !== directory.length || !names.has("capture.json.gz"))
    archiveError("the ZIP metadata inventory is incomplete.");
  for (const entry of entries) {
    const local = await range(file, entry.localOffset, entry.localOffset + 30),
      localView = new DataView(local.buffer),
      nameSize = little(localView, 26, 2),
      extraSize = little(localView, 28, 2);
    if (
      little(localView, 0) !== 0x04034b50 ||
      little(localView, 4, 2) !== entry.versionNeeded ||
      little(localView, 6, 2) !== entry.flags ||
      little(localView, 8, 2) !== 0 ||
      entry.localOffset + 30 + nameSize + extraSize > directoryOffset
    )
      archiveError("a local entry header is invalid.");
    const name = await range(
      file,
      entry.localOffset + 30,
      entry.localOffset + 30 + nameSize,
    );
    if (utf8(name) !== entry.path)
      archiveError("local and directory entry paths disagree.");
    entry.dataOffset = entry.localOffset + 30 + nameSize + extraSize;
    entry.endOffset = entry.dataOffset + entry.size;
    if (entry.endOffset > directoryOffset)
      archiveError("an original file overlaps the ZIP directory.");
    if (!(entry.flags & 8)) {
      if (
        little(localView, 14) !== entry.crc32 ||
        little(localView, 18) !== entry.size ||
        little(localView, 22) !== entry.size
      )
        archiveError("local and directory entry checksums or sizes disagree.");
    } else {
      if (
        little(localView, 14) ||
        little(localView, 18) ||
        little(localView, 22)
      )
        archiveError("streaming local checksums and sizes must be zero.");
      const first = await range(file, entry.endOffset, entry.endOffset + 4),
        signed = little(new DataView(first.buffer), 0) === 0x08074b50,
        descriptor = await range(
          file,
          entry.endOffset,
          entry.endOffset + (signed ? 16 : 12),
        ),
        descriptorView = new DataView(descriptor.buffer),
        start = signed ? 4 : 0;
      if (
        little(descriptorView, start) !== entry.crc32 ||
        little(descriptorView, start + 4) !== entry.size ||
        little(descriptorView, start + 8) !== entry.size
      )
        archiveError("an entry data descriptor disagrees with its directory.");
      entry.endOffset += descriptor.length;
    }
  }
  const ordered = [...entries].sort(
    (left, right) => left.localOffset - right.localOffset,
  );
  for (let index = 0; index < ordered.length; index++) {
    if (
      (index === 0
        ? ordered[index].localOffset !== 0
        : ordered[index - 1].endOffset !== ordered[index].localOffset) ||
      (index === ordered.length - 1 &&
        ordered[index].endOffset !== directoryOffset)
    )
      archiveError("entry ranges overlap or contain unaccounted archive data.");
  }
  const archiveHasher = sha256.create();
  for (let start = 0; start < file.size; start += 1024 * 1024)
    archiveHasher.update(
      await range(file, start, Math.min(file.size, start + 1024 * 1024)),
    );
  const archiveFiles: CourseraArchiveFile[] = [];
  const archiveBlobs: CourseraArchiveBlob[] = [];
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index++) {
    let current = index;
    for (let bit = 0; bit < 8; bit++)
      current = (current >>> 1) ^ (0xedb88320 & -(current & 1));
    crcTable[index] = current >>> 0;
  }
  async function readEntry(entry: ArchiveEntry, materialize = true) {
    let crc = 0xffffffff;
    const bodyHasher = sha256.create(),
      chunks: Uint8Array[] = [];
    for (
      let start = entry.dataOffset;
      start < entry.dataOffset + entry.size;
      start += 1024 * 1024
    ) {
      const chunk = await range(
        file,
        start,
        Math.min(entry.dataOffset + entry.size, start + 1024 * 1024),
      );
      crc = crcUpdate(crc, chunk, crcTable);
      bodyHasher.update(chunk);
      if (materialize) chunks.push(chunk);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== entry.crc32)
      archiveError("an entry CRC32 checksum failed.");
    const bytes = new Uint8Array(materialize ? entry.size : 0);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.length;
    }
    return { bytes, hash: bytesToHex(bodyHasher.digest()) };
  }
  const metadataEntry = entries.find(
    (entry) => entry.path === "capture.json.gz",
  )!;
  const compressedMetadata = (await readEntry(metadataEntry)).bytes;
  const metadata = await expandMetadata(compressedMetadata);
  if (!metadata || metadata.length > metadataLimit)
    archiveError("capture metadata exceeds its 128 MiB bound.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8(metadata));
  } catch {
    return archiveError("capture metadata is not valid UTF-8 JSON.");
  }
  const format = (parsed as Record<string, any>)?.meta?.directDataCapture
    ?.exportTransport?.format;
  if (format !== "ZIP_GZIP_JSON_V1")
    archiveError("capture metadata does not declare this archive format.");
  const references = nativeBodyReferences(parsed),
    byPath = new Map<string, number>();
  for (const { body } of references) {
    const previous = byPath.get(body.archivePath);
    if (previous !== undefined && previous !== body.size)
      archiveError("native body references disagree on their original size.");
    byPath.set(body.archivePath, body.size);
  }
  for (const entry of entries) {
    if (entry.path === "capture.json.gz") continue;
    if (!byPath.has(entry.path))
      archiveError("the archive contains unreferenced original files.");
    if (byPath.get(entry.path) !== entry.size)
      archiveError(
        "a referenced original file is absent or differs from its body receipt.",
      );
    const { bytes, hash } = await readEntry(entry, !retainOriginalBlobs);
    if (entry.path !== "files/" + hash)
      archiveError("an original file SHA-256 differs from its path.");
    if (retainOriginalBlobs) {
      const blob = file.slice(entry.dataOffset, entry.dataOffset + entry.size);
      const podcast = references.some(
        ({ body, podcast }) => podcast && body.archivePath === entry.path,
      );
      if (
        podcast &&
        !mp4(new Uint8Array(await blob.slice(0, 12).arrayBuffer()))
      )
        archiveError("a Panopto podcast body is not an MP4 rendition.");
      archiveBlobs.push({
        path: entry.path,
        sha256: hash,
        size: entry.size,
        blob,
      });
    } else
      archiveFiles.push({
        path: entry.path,
        sha256: hash,
        size: bytes.length,
        bytes,
      });
  }
  if (retainOriginalBlobs) {
    const files = new Map(archiveBlobs.map((file) => [file.path, file]));
    for (const { body } of references) {
      const original = files.get(body.archivePath);
      if (
        !original ||
        original.size !== body.size ||
        Object.hasOwn(body, "base64")
      )
        archiveError(
          "a referenced original file is absent or differs from its body receipt.",
        );
    }
  } else attachCourseraArchiveFileBytes(parsed, archiveFiles);
  return {
    bytes: metadata,
    archiveFiles,
    archiveBlobs,
    capture: parsed,
    compressedMetadata,
    archiveSha256: bytesToHex(archiveHasher.digest()),
    originalBodyBytes: originals,
  };
}

/** Native capture intake retains its established byte resolver contract. */
export async function readCourseraCaptureArchive(
  file: File,
  expandMetadata: (gzip: Uint8Array) => Promise<Uint8Array>,
  limits: {
    archiveBytes?: number;
    originalBytes?: number;
    metadataBytes?: number;
  } = {},
): Promise<CourseraArchiveReadResult> {
  return readCourseraCaptureArchiveInternal(file, expandMetadata, limits);
}

/** Review preparation verifies every original in bounded ranges, while retaining
 * only immutable Blob slices. It never creates a normal capture byte resolver. */
export async function readCourseraCaptureArchiveBlobs(
  file: File,
  expandMetadata: (gzip: Uint8Array) => Promise<Uint8Array>,
) {
  return readCourseraCaptureArchiveInternal(file, expandMetadata, {}, true);
}
