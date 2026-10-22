import { performanceTrace } from '../diagnostics/runtime.ts';
import {
  BlobReader,
  Reader,
  ZipReader,
  type CreateReadableOptions,
  type FileEntry,
} from "@zip.js/zip.js/lib/zip-core-native.js";

export const MAX_SOURCE_PACKAGE_ENTRY_BYTES = 24 * 1024 * 1024;
// Incompressible DEFLATE has framing/block overhead above its expanded body.
// Keep that overhead bounded without lowering the existing 24 MiB body limit.
export const MAX_SOURCE_PACKAGE_COMPRESSED_ENTRY_BYTES =
  MAX_SOURCE_PACKAGE_ENTRY_BYTES + 64 * 1024;
export const MAX_SOURCE_PACKAGE_ZIP_ENTRIES = 50000;
const MAX_RANGE_BYTES = 16 * 1024 * 1024;
const ENTRY_CHUNK_BYTES = 512 * 1024;

export interface SourcePackageZipEntry {
  name: string;
  dir: boolean;
  _data: { uncompressedSize: number };
  async(type: "string"): Promise<string>;
  async(type: "arraybuffer"): Promise<ArrayBuffer>;
  async(type: "uint8array"): Promise<Uint8Array>;
}
export interface SourcePackageZip {
  files: Record<string, SourcePackageZipEntry>;
  close(): Promise<void>;
}

/** Keep directory reads bounded and force entry streams through range reads.
 * BlobReader's native stream shortcut would bypass both the range receipt and
 * the configured entry chunk bound. Never call the original file.arrayBuffer. */
class SourcePackageBlobReader extends BlobReader {
  private readonly file: Blob;
  constructor(file: Blob) {
    super(file);
    this.file = file;
  }
  override async readUint8Array(offset: number, length: number) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > this.file.size ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_RANGE_BYTES
    )
      throw Error(
        "Source ZIP metadata or byte range exceeds the 16 MiB read bound.",
      );
    const end = Math.min(this.file.size, offset + length);
    if (!Number.isSafeInteger(end))
      throw Error("Invalid source ZIP byte range.");
    const bytes = new Uint8Array(
      await this.file.slice(offset, end).arrayBuffer(),
    );
    if (bytes.byteLength !== end - offset)
      throw Error(
        "Source ZIP byte range was truncated or its Blob slice was ignored.",
      );
    return bytes;
  }
  override createReadable(options: CreateReadableOptions = {}) {
    return Reader.prototype.createReadable.call(this, {
      ...options,
      chunkSize: ENTRY_CHUNK_BYTES,
    });
  }
}

function validPath(name: string) {
  if (
    !name ||
    name.includes("\0") ||
    /^[\\/]/.test(name) ||
    /^[A-Za-z]:/.test(name) ||
    name.split(/[\\/]/).includes("..")
  )
    throw Error(
      "Source ZIP contains an unsafe absolute or parent-directory path.",
    );
}

const readOptions = {
  useWebWorkers: false,
  useCompressionStream: true,
  checkCrc32: true,
  checkLocalDirectory: true,
  checkLocalFilename: true,
  checkOverlappingEntry: true,
} as const;

/** A seekable, bounded JSZip-shaped view for the source scanner. The directory
 * retains exact names and large assets; only a requested body is decompressed.
 * ZIP64 offsets are handled by zip.js without buffering the whole package. */
export async function openSourcePackageZip(
  file: Blob,
): Promise<SourcePackageZip> {
const diagnosticEnd = performanceTrace().begin('archive_index');
let diagnosticOutcome = 'observed';
try {

  if (
    !file ||
    !Number.isSafeInteger(file.size) ||
    file.size < 22 ||
    typeof file.slice !== "function"
  )
    throw Error("Choose a valid, seekable source ZIP or IMSCC file.");
  const reader = new ZipReader(new SourcePackageBlobReader(file), {
    ...readOptions,
    strictness: "strict",
    // Reject traversal, retaining other native path spellings unchanged so the
    // scanner can expose case/normalization ambiguities instead of hiding them.
    filenameValidation: "balanced",
  });
  const files: Record<string, SourcePackageZipEntry> = Object.create(null);
  const controller = new AbortController();
  let closed = false,
    count = 0;
  const close = async () => {
    if (closed) return;
    closed = true;
    controller.abort();
    await reader.close();
  };
  async function body(entry: FileEntry): Promise<Uint8Array> {
const diagnosticEnd = performanceTrace().begin('archive_read');
let diagnosticOutcome = 'observed';
try {

    if (closed) throw Error("The source ZIP has been closed.");
    if (
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0 ||
      !Number.isSafeInteger(entry.compressedSize) ||
      entry.compressedSize < 0 ||
      entry.uncompressedSize > MAX_SOURCE_PACKAGE_ENTRY_BYTES ||
      entry.compressedSize > MAX_SOURCE_PACKAGE_COMPRESSED_ENTRY_BYTES
    )
      throw Error(
        "This source ZIP entry exceeds the 24 MiB expanded read limit or its bounded compression allowance. Its inventory reference is retained.",
      );
    if (entry.encrypted)
      throw Error(
        "Encrypted source ZIP entry bodies are not supported; their inventory references are retained.",
      );
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
      throw Error(
        "This source ZIP entry uses an unsupported compression method; its inventory reference is retained.",
      );
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const output = new WritableStream<Uint8Array>({
      write(chunk) {
        if (!(chunk instanceof Uint8Array))
          throw Error("Unexpected source ZIP output chunk.");
        if (chunk.byteLength > MAX_SOURCE_PACKAGE_ENTRY_BYTES - bytes)
          throw Error(
            "Source ZIP entry output exceeds the actual 24 MiB read limit.",
          );
        if (chunk.byteLength > entry.uncompressedSize - bytes)
          throw Error(
            "Source ZIP entry output exceeds its declared uncompressed size.",
          );
        bytes += chunk.byteLength;
        chunks.push(chunk.slice());
      },
    });
    try {
      await entry.getData(output, {
        ...readOptions,
        signal: controller.signal,
      });
      if (bytes !== entry.uncompressedSize)
        throw Error("Source ZIP entry output was truncated.");
      const result = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    } finally {
      chunks.length = 0;
    }

} catch (error) { diagnosticOutcome = 'failed'; throw error; } finally { diagnosticEnd(diagnosticOutcome); }
}
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > MAX_SOURCE_PACKAGE_ZIP_ENTRIES)
        throw Error("Source ZIP exceeds the 50,000-entry inventory limit.");
      validPath(entry.filename);
      if (Object.hasOwn(files, entry.filename))
        throw Error(
          "Source ZIP contains duplicate exact paths. Its item identity is ambiguous.",
        );
      const value = {
        name: entry.filename,
        dir: entry.directory,
        _data: { uncompressedSize: entry.uncompressedSize },
        async async(type: "string" | "arraybuffer" | "uint8array") {
          if (!["string", "arraybuffer", "uint8array"].includes(type))
            throw Error("Unsupported source ZIP read format.");
          if (closed) throw Error("The source ZIP has been closed.");
          if (
            entry.directory &&
            (entry.compressedSize || entry.uncompressedSize)
          )
            throw Error("A source ZIP directory contains an unexpected body.");
          performanceTrace().repeated(entry.filename);
          const bytes = entry.directory ? new Uint8Array() : await body(entry);
          performanceTrace().count('files');
          performanceTrace().count('bytes', bytes.byteLength);
          return type === "string"
            ? new TextDecoder().decode(bytes)
            : type === "arraybuffer"
              ? bytes.buffer
              : bytes;
        },
      };
      files[entry.filename] = value as SourcePackageZipEntry;
    }
    return { files, close };
  } catch (error) {
    await close();
    throw error;
  }

} catch (error) { diagnosticOutcome = 'failed'; throw error; } finally { diagnosticEnd(diagnosticOutcome); }
}
