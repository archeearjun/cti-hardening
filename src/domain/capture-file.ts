import {
  readCourseraCaptureFileBytes,
  attachCourseraArchiveFileBytes,
  type CourseraCaptureFileBytes,
  type CourseraCaptureTransport,
} from "./coursera-capture-file.ts";
import {
  readBrightspaceCaptureArchive,
  NotBrightspaceCaptureArchiveError,
  type BrightspaceArchiveFile,
} from "./brightspace-capture-archive.ts";

export const BRIGHTSPACE_CAPTURE_FILE_ACCEPT =
  ".cti.zip,.zip,.json,.json.gz,application/zip,application/json,application/gzip";

export interface CaptureFileBytes extends CourseraCaptureFileBytes {
  brightspaceArchiveFiles?: BrightspaceArchiveFile[];
  /** Present only when an archive reader has already parsed and checked it. */
  capture?: unknown;
}

/** Both platforms retain their own archive ownership and body validators. A
 * valid non-Brightspace manifest is the only reason to try the Coursera reader. */
export async function readCaptureFileBytes(
  file: File,
): Promise<CaptureFileBytes> {
  if (/\.zip$/i.test(file.name)) {
    try {
      const archived = await readBrightspaceCaptureArchive(
        file,
        async (gzip) => {
          const expanded = await readCourseraCaptureFileBytes(
            new File([gzip as BlobPart], "capture.json.gz", {
              type: "application/gzip",
            }),
          );
          return expanded.bytes;
        },
      );
      const transport: CourseraCaptureTransport = {
        encoding: "zip",
        name: file.name,
        bytes: file.size,
        sha256: archived.archiveSha256,
        expandedBytes: archived.bytes.byteLength,
        originalBodyBytes: archived.originalBodyBytes,
        fileCount: archived.archiveFiles.length,
        files: archived.archiveFiles.map(({ path, sha256, size }) => ({
          path,
          sha256,
          size,
        })),
      };
      return {
        bytes: archived.bytes,
        transport,
        brightspaceArchiveFiles: archived.archiveFiles,
        capture: archived.capture,
      };
    } catch (error) {
      if (!(error instanceof NotBrightspaceCaptureArchiveError)) throw error;
    }
  }
  return readCourseraCaptureFileBytes(file);
}

export async function readCaptureFileJson(file: File): Promise<unknown> {
  const input = await readCaptureFileBytes(file);
  const parsed =
    input.capture ??
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes));
  return input.archiveFiles
    ? attachCourseraArchiveFileBytes(parsed, input.archiveFiles)
    : parsed;
}

export async function readBrightspaceCaptureFileBytes(file: File) {
  const input = await readCaptureFileBytes(file);
  const parsed =
    input.capture ??
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("extractor" in parsed) ||
    typeof parsed.extractor !== "string" ||
    !/brightspace/i.test(parsed.extractor)
  )
    throw Error(
      "Choose a full CTI Brightspace source capture (.cti.zip, JSON or .json.gz).",
    );
  return {
    bytes: input.bytes,
    ...(input.transport ? { transport: input.transport } : {}),
    ...(input.brightspaceArchiveFiles
      ? {
          brightspaceArchiveFiles: input.brightspaceArchiveFiles,
        }
      : {}),
  };
}
