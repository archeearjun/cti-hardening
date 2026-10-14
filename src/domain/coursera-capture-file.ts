/** File transport limits are separate from capture fidelity. A gzip download
 * expands to the original JSON bytes before any identity or completion check. */
import {
  readCourseraCaptureArchive,
  attachCourseraArchiveFileBytes,
  type CourseraArchiveFile,
} from "./coursera-capture-archive.ts";
export { attachCourseraArchiveFileBytes } from "./coursera-capture-archive.ts";
export type { CourseraArchiveFile } from "./coursera-capture-archive.ts";
export const MAX_COURSERA_CAPTURE_JSON_BYTES = 128 * 1024 * 1024;
export const MAX_COURSERA_COMPRESSED_CAPTURE_BYTES = 128 * 1024 * 1024;
export const COURSERA_CAPTURE_FILE_ACCEPT =
  ".json,.json.gz,.zip,application/json,application/gzip,application/zip";

export interface CourseraCaptureTransport {
  encoding: "gzip" | "zip";
  name: string;
  bytes: number;
  sha256: string;
  expandedBytes: number;
  originalBodyBytes?: number;
  fileCount?: number;
  files?: { path: string; sha256: string; size: number }[];
}

export interface CourseraCaptureFileBytes {
  bytes: Uint8Array;
  transport?: CourseraCaptureTransport;
  archiveFiles?: CourseraArchiveFile[];
}

export function isCompressedCourseraCaptureFile(name: string): boolean {
  return /\.json\.gz$/i.test(name);
}

export async function readCourseraCaptureFileBytes(
  file: File,
  limits: {
    compressedBytes?: number;
    expandedBytes?: number;
    archiveBytes?: number;
    originalBytes?: number;
  } = {},
): Promise<CourseraCaptureFileBytes> {
  const reducedLimit = (value: number | undefined, maximum: number) =>
    value === undefined
      ? maximum
      : Number.isSafeInteger(value) && value > 0
        ? Math.min(value, maximum)
        : (() => {
            throw Error("Invalid Coursera capture transport limit.");
          })();
  const compressedLimit = reducedLimit(
    limits.compressedBytes,
    MAX_COURSERA_COMPRESSED_CAPTURE_BYTES,
  );
  const expandedLimit = reducedLimit(
    limits.expandedBytes,
    MAX_COURSERA_CAPTURE_JSON_BYTES,
  );
  if (!Number.isSafeInteger(file.size) || file.size < 1)
    throw Error("The selected capture file is empty or has an invalid size.");
  if (/\.zip$/i.test(file.name)) {
    const archived = await readCourseraCaptureArchive(
      file,
      async (source) => {
        const expanded = await readCourseraCaptureFileBytes(
          new File([source as BlobPart], "capture.json.gz", {
            type: "application/gzip",
          }),
          {
            compressedBytes: compressedLimit,
            expandedBytes: expandedLimit,
          },
        );
        return expanded.bytes;
      },
      {
        archiveBytes: limits.archiveBytes,
        originalBytes: limits.originalBytes,
        metadataBytes: expandedLimit,
      },
    );
    return {
      bytes: archived.bytes,
      archiveFiles: archived.archiveFiles,
      transport: {
        encoding: "zip",
        name: file.name,
        bytes: file.size,
        sha256: archived.archiveSha256,
        expandedBytes: archived.bytes.length,
        originalBodyBytes: archived.originalBodyBytes,
        fileCount: archived.archiveFiles.length,
        files: archived.archiveFiles.map(({ path, sha256, size }) => ({
          path,
          sha256,
          size,
        })),
      },
    };
  }
  const compressed = isCompressedCourseraCaptureFile(file.name);
  if (file.size > (compressed ? compressedLimit : expandedLimit))
    throw Error(
      compressed
        ? "The compressed Coursera capture exceeds the 128 MiB file limit."
        : "The Coursera capture exceeds the 128 MiB JSON limit.",
    );
  const source = new Uint8Array(await file.arrayBuffer());
  if (source.byteLength !== file.size)
    throw Error("The selected Coursera capture could not be read completely.");
  if (!compressed) return { bytes: source };
  if (typeof DecompressionStream !== "function")
    throw Error(
      "This browser cannot open gzip captures. Open CTI in current Chrome.",
    );
  if (source[0] !== 0x1f || source[1] !== 0x8b || source[2] !== 0x08)
    throw Error("The selected .json.gz capture is not a gzip file.");

  const chunks: Uint8Array[] = [];
  let expandedBytes = 0;
  const reader = new Blob([source])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > expandedLimit - expandedBytes) {
        void reader.cancel().catch(() => {});
        throw Error(
          "The expanded Coursera capture exceeds the 128 MiB JSON limit.",
        );
      }
      expandedBytes += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "The expanded Coursera capture exceeds the 128 MiB JSON limit."
    )
      throw error;
    throw Error(
      "The gzip Coursera capture is truncated or damaged. Select the original download.",
    );
  } finally {
    reader.releaseLock();
  }
  if (!expandedBytes)
    throw Error("The gzip Coursera capture contains no JSON.");
  const bytes = new Uint8Array(expandedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!globalThis.crypto?.subtle)
    throw Error("This browser cannot verify the compressed capture identity.");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return {
    bytes,
    transport: {
      encoding: "gzip",
      name: file.name,
      bytes: source.byteLength,
      sha256: Array.from(hash, (value) =>
        value.toString(16).padStart(2, "0"),
      ).join(""),
      expandedBytes,
    },
  };
}

export async function readCourseraCaptureFileJson(
  file: File,
): Promise<unknown> {
  const { bytes, archiveFiles } = await readCourseraCaptureFileBytes(file);
  let capture: unknown;
  try {
    capture = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw Error("The selected Coursera capture is not valid UTF-8 JSON.");
  }
  return archiveFiles
    ? attachCourseraArchiveFileBytes(capture, archiveFiles)
    : capture;
}
