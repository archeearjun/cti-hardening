import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  MAX_COURSERA_CAPTURE_JSON_BYTES,
  type CourseraArchiveFile,
  type CourseraCaptureTransport,
} from "./coursera-capture-file.ts";
import {
  MAX_COURSERA_ARCHIVE_BYTES,
  MAX_COURSERA_ARCHIVE_FILE_BYTES,
  MAX_COURSERA_ARCHIVE_ORIGINAL_BYTES,
} from "./coursera-capture-archive.ts";

export interface CourseraArchiveProof {
  method: "VERIFIED_ORIGINAL_ARCHIVE_FILES";
  metadataSha256: string;
  archiveSha256: string;
  archiveBytes: number;
  originalBytesStored: false;
  originalBodyBytes: number;
  fileCount: number;
  files: { path: string; sha256: string; size: number }[];
}

/** Original bytes remain in the local artifact. Persist only independently
 * checked descriptors, alongside its reader-computed ZIP and metadata hashes.
 * Native reference ownership is checked separately by the attachment bridge. */
export function buildCourseraArchiveProof(
  metadataSha256: string,
  metadataBytes: number,
  transport: CourseraCaptureTransport | undefined,
  archiveFiles: CourseraArchiveFile[] = [],
): CourseraArchiveProof | undefined {
  if (!Array.isArray(archiveFiles))
    throw Error("Archive original inventory is invalid.");
  if (transport?.encoding !== "zip") {
    if (archiveFiles.length)
      throw Error(
        "Original archive files require their verified ZIP identity.",
      );
    return undefined;
  }
  const integer = (value: unknown, maximum: number, allowZero = false) =>
    Number.isSafeInteger(value) &&
    Number(value) >= (allowZero ? 0 : 1) &&
    Number(value) <= maximum;
  if (
    !/^[a-f0-9]{64}$/.test(metadataSha256) ||
    !integer(metadataBytes, MAX_COURSERA_CAPTURE_JSON_BYTES) ||
    !/^[a-f0-9]{64}$/.test(transport.sha256) ||
    !integer(transport.bytes, MAX_COURSERA_ARCHIVE_BYTES) ||
    transport.expandedBytes !== metadataBytes ||
    transport.fileCount !== archiveFiles.length ||
    archiveFiles.length > 20000 ||
    !Array.isArray(transport.files) ||
    transport.files.length !== archiveFiles.length
  )
    throw Error("The archive identity contradicts its verified originals.");
  const actual = new Map<
    string,
    { path: string; sha256: string; size: number }
  >();
  let total = 0;
  for (const file of archiveFiles) {
    if (
      !file ||
      !/^files\/[a-f0-9]{64}$/.test(file.path) ||
      file.path !== "files/" + file.sha256 ||
      actual.has(file.path) ||
      !integer(file.size, MAX_COURSERA_ARCHIVE_FILE_BYTES) ||
      !(file.bytes instanceof Uint8Array) ||
      file.bytes.byteLength !== file.size ||
      bytesToHex(sha256(file.bytes)) !== file.sha256
    )
      throw Error(
        "The archive original proof has invalid bytes, size or checksum.",
      );
    total += file.size;
    if (total > MAX_COURSERA_ARCHIVE_ORIGINAL_BYTES)
      throw Error("Archive originals exceed the bounded proof inventory.");
    actual.set(file.path, {
      path: file.path,
      sha256: file.sha256,
      size: file.size,
    });
  }
  const seen = new Set<string>();
  for (const declared of transport.files) {
    const verified = declared && actual.get(declared.path);
    if (
      !verified ||
      seen.has(declared.path) ||
      declared.sha256 !== verified.sha256 ||
      declared.size !== verified.size
    )
      throw Error(
        "The archive transport file inventory contradicts its verified originals.",
      );
    seen.add(declared.path);
  }
  if (transport.originalBodyBytes !== total || total > transport.bytes)
    throw Error(
      "The archive identity contradicts its verified original sizes.",
    );
  return {
    method: "VERIFIED_ORIGINAL_ARCHIVE_FILES",
    metadataSha256,
    archiveSha256: transport.sha256,
    archiveBytes: transport.bytes,
    originalBytesStored: false,
    originalBodyBytes: total,
    fileCount: actual.size,
    files: [...actual.values()],
  };
}
