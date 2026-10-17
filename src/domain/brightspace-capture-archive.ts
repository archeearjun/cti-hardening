import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  attachBrightspaceArchiveFileBlobs,
  MAX_BRIGHTSPACE_ARCHIVE_FILE_BYTES,
  MAX_BRIGHTSPACE_ARCHIVE_ORIGINAL_BYTES,
} from "./brightspace-capture-evidence.ts";
import type { BrightspaceArchiveFile } from "./brightspace-capture-evidence.ts";
export type { BrightspaceArchiveFile } from "./brightspace-capture-evidence.ts";
export {
  attachBrightspaceArchiveFileBlobs,
  MAX_BRIGHTSPACE_ARCHIVE_FILE_BYTES,
  MAX_BRIGHTSPACE_ARCHIVE_ORIGINAL_BYTES,
} from "./brightspace-capture-evidence.ts";
export const MAX_BRIGHTSPACE_ARCHIVE_BYTES = 640 * 1024 * 1024;
export class NotBrightspaceCaptureArchiveError extends Error {
  readonly code = "NOT_BRIGHTSPACE_CAPTURE_ARCHIVE";
  constructor() {
    super("The capture archive manifest is not Brightspace evidence.");
    this.name = "NotBrightspaceCaptureArchiveError";
  }
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

export interface BrightspaceArchiveReadResult {
  bytes: Uint8Array;
  capture: unknown;
  archiveFiles: BrightspaceArchiveFile[];
  archiveSha256: string;
  originalBodyBytes: number;
}

function archiveError(message: string): never {
  throw new Error(`Invalid Brightspace capture archive: ${message}`);
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

/** ZIP_STORE range reads keep the complete archive out of JS memory. Metadata
 * and each original file have independent bounds, CRC32 and SHA-256 checks. */
export async function readBrightspaceCaptureArchive(
  file: File,
  expandMetadata: (gzip: Uint8Array) => Promise<Uint8Array>,
  limits: {
    archiveBytes?: number;
    originalBytes?: number;
    metadataBytes?: number;
  } = {},
): Promise<BrightspaceArchiveReadResult> {
  const cap = (requested: number | undefined, maximum: number) =>
    requested === undefined
      ? maximum
      : Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, maximum)
        : archiveError("invalid transport limits.");
  const archiveLimit = cap(limits.archiveBytes, MAX_BRIGHTSPACE_ARCHIVE_BYTES),
    originalLimit = cap(
      limits.originalBytes,
      MAX_BRIGHTSPACE_ARCHIVE_ORIGINAL_BYTES,
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
      size < 0 ||
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
      if (size < 1 || size > metadataLimit)
        archiveError("compressed metadata exceeds its 128 MiB bound.");
    } else {
      // This preliminary ceiling does not authorize a large original. The
      // manifest's native source bindings must do that before its allocation.
      // This parser also performs the bounded metadata probe for universal
      // intake. Coursera has a separately authorized 128 MiB podcast class;
      // Brightspace's 64 MiB bound applies only after platform identification.
      if (size > 128 * 1024 * 1024)
        archiveError(
          "an original file exceeds the 128 MiB platform-probe ceiling.",
        );
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
  const archiveFiles: BrightspaceArchiveFile[] = [];
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index++) {
    let current = index;
    for (let bit = 0; bit < 8; bit++)
      current = (current >>> 1) ^ (0xedb88320 & -(current & 1));
    crcTable[index] = current >>> 0;
  }
  async function readEntry(entry: ArchiveEntry, materialize = false) {
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
  const metadata = await expandMetadata(
    (await readEntry(metadataEntry, true)).bytes,
  );
  if (!metadata || metadata.length > metadataLimit)
    archiveError("capture metadata exceeds its 128 MiB bound.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8(metadata));
  } catch {
    return archiveError("capture metadata is not valid UTF-8 JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    archiveError("capture metadata is not an object.");
  const capture = parsed as Record<string, any>;
  const brightspaceMarkers =
    Object.hasOwn(capture, "contentTree") ||
    Object.hasOwn(capture, "originalBodyTransport") ||
    Object.hasOwn(capture, "assetBodies") ||
    [
      capture.extractor,
      capture.platform,
      capture.meta?.extractor,
      capture.meta?.platform,
      capture.extractionMeta?.extractor,
      capture.extractionMeta?.platform,
    ].some((value) => typeof value === "string" && /brightspace/i.test(value));
  if (!brightspaceMarkers && Array.isArray(capture.fingerprints))
    throw new NotBrightspaceCaptureArchiveError();
  const transport = capture?.originalBodyTransport;
  if (
    Number(capture?.schemaVersion) !== 2 ||
    !Array.isArray(capture?.contentTree) ||
    transport?.format !== "CTI_BRIGHTSPACE_ARCHIVE_V1" ||
    transport.version !== 1 ||
    transport.bodyEncoding !== "archive" ||
    transport.hashAlgorithm !== "SHA-256"
  )
    archiveError(
      "capture metadata does not declare the Brightspace archive format.",
    );
  if (
    entries.some(
      (entry) =>
        entry.path !== "capture.json.gz" &&
        entry.size > MAX_BRIGHTSPACE_ARCHIVE_FILE_BYTES,
    )
  )
    archiveError("an original file exceeds its 64 MiB Brightspace bound.");
  const archiveHasher = sha256.create();
  for (let start = 0; start < file.size; start += 1024 * 1024)
    archiveHasher.update(
      await range(file, start, Math.min(file.size, start + 1024 * 1024)),
    );
  const bodies = capture.assetBodies;
  if (!bodies || typeof bodies !== "object" || Array.isArray(bodies))
    archiveError("the native original-body inventory is missing.");
  const bodyEntries = Object.entries(bodies) as [string, Record<string, any>][];
  if (bodyEntries.length > 10000)
    archiveError(
      "the native original-body inventory exceeds its 10,000-body bound.",
    );
  const byPath = new Map<string, number>();
  for (const [hash, body] of bodyEntries) {
    if (
      !body ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      body.sha256 !== hash ||
      body.encoding !== "archive" ||
      body.archivePath !== "files/" + hash ||
      !Number.isSafeInteger(body.bytes) ||
      body.bytes < 0 ||
      body.bytes > MAX_BRIGHTSPACE_ARCHIVE_FILE_BYTES ||
      Object.hasOwn(body, "base64")
    )
      archiveError(
        "a native body descriptor has invalid original identity or size.",
      );
    byPath.set(body.archivePath, body.bytes);
  }
  for (const entry of entries) {
    if (entry.path === "capture.json.gz") continue;
    if (!byPath.has(entry.path))
      archiveError("the archive contains unreferenced original files.");
    if (byPath.get(entry.path) !== entry.size)
      archiveError(
        "a referenced original file is absent or differs from its body receipt.",
      );
    const { hash } = await readEntry(entry);
    if (entry.path !== "files/" + hash)
      archiveError("an original file SHA-256 differs from its path.");
    archiveFiles.push({
      path: entry.path,
      sha256: hash,
      size: entry.size,
      blob: file.slice(entry.dataOffset, entry.dataOffset + entry.size),
    });
  }
  await attachBrightspaceArchiveFileBlobs(capture, archiveFiles);
  return {
    bytes: metadata,
    capture,
    archiveFiles,
    archiveSha256: bytesToHex(archiveHasher.digest()),
    originalBodyBytes: originals,
  };
}
