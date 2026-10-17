import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const MAX_CAPTURE_TRANSFER_SOURCE_BYTES = 640 * 1024 * 1024;
export const MAX_CAPTURE_TRANSFER_PART_BYTES = 24 * 1024 * 1024;
const READ_BYTES = 2 * 1024 * 1024;
const PART_HEADER_RESERVE = 4096;
const encoder = new TextEncoder();

export interface CaptureTransferPart {
  index: number;
  fileName: string;
  fileBytes: number;
  fileSha256: string;
  offset: number;
  payloadBytes: number;
  payloadSha256: string;
}

export interface CaptureTransferManifest {
  kind: "CTI_CAPTURE_TRANSFER_MANIFEST";
  schemaVersion: 1;
  notForCourseAudit: true;
  transferId: string;
  preparedAt: string;
  original: { fileName: string; bytes: number; sha256: string };
  transport: {
    fileName: string;
    encoding: "GZIP" | "IDENTITY";
    bytes: number;
    sha256: string;
  };
  partCount: number;
  maxPartFileBytes: number;
  parts: CaptureTransferPart[];
  instructions: string[];
  warnings: string[];
}

export interface PreparedCaptureTransfer {
  manifest: CaptureTransferManifest;
  manifestFile: File;
  partFiles: File[];
}

export function validateCaptureTransferFile(file: Pick<File, "name" | "size">) {
  if (!/\.(json|json\.gz|zip)$/i.test(file.name))
    throw Error(
      "Choose your existing capture or QA report: JSON, JSON.gz or CTI ZIP.",
    );
  if (
    !file.name ||
    file.name.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(file.name)
  )
    throw Error(
      "The selected file name is invalid. Choose the original downloaded file.",
    );
  if (!Number.isSafeInteger(file.size) || file.size < 1)
    throw Error("The selected file is empty or its size could not be read.");
  if (file.size > MAX_CAPTURE_TRANSFER_SOURCE_BYTES)
    throw Error(
      "File sharing supports existing files up to 640 MiB. Your original file is unchanged.",
    );
}

function cancelled(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

async function hashBlob(
  blob: Blob,
  progress: (bytes: number) => void = () => {},
  signal?: AbortSignal,
) {
  const hash = sha256.create();
  for (let start = 0; start < blob.size; start += READ_BYTES) {
    cancelled(signal);
    const end = Math.min(blob.size, start + READ_BYTES);
    const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
    if (bytes.byteLength !== end - start)
      throw Error(
        "The existing file could not be read completely. Download it locally and choose it again.",
      );
    hash.update(bytes);
    progress(end);
  }
  cancelled(signal);
  return bytesToHex(hash.digest());
}

function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
  return btoa(chunks.join(""));
}

/** Transfer packaging only: no JSON parsing, evidence rewriting, network reads,
 * or removal of originals. Parts are valid JSON files accepted by chat uploads. */
export async function prepareCaptureFileTransfer(
  file: File,
  progress: (phase: string) => void = () => {},
  options: {
    partFileBytes?: number;
    compression?: "auto" | "identity";
    preparedAt?: string;
    signal?: AbortSignal;
  } = {},
): Promise<PreparedCaptureTransfer> {
  validateCaptureTransferFile(file);
  const maxPartFileBytes =
    options.partFileBytes ?? MAX_CAPTURE_TRANSFER_PART_BYTES;
  if (
    !Number.isSafeInteger(maxPartFileBytes) ||
    maxPartFileBytes < 8192 ||
    maxPartFileBytes > MAX_CAPTURE_TRANSFER_PART_BYTES
  )
    throw Error("Invalid file-sharing part limit.");
  const preparedAt = options.preparedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(preparedAt)))
    throw Error("Invalid file-sharing preparation date.");
  const payloadLimit =
    Math.floor((maxPartFileBytes - PART_HEADER_RESERVE) / 4) * 3;
  const warnings: string[] = [];
  let originalSha256: string;
  let transport: Blob = file;
  let encoding: "GZIP" | "IDENTITY" = "IDENTITY";
  const compress =
    /\.json$/i.test(file.name) && options.compression !== "identity";
  if (compress && typeof CompressionStream === "function") {
    progress(
      "Compressing the existing JSON locally without changing its contents…",
    );
    const originalHash = sha256.create();
    let observed = 0;
    const input = new TransformStream<Uint8Array<ArrayBuffer>, BufferSource>({
      transform(chunk, controller) {
        cancelled(options.signal);
        if (
          !(chunk instanceof Uint8Array) ||
          chunk.byteLength > file.size - observed
        )
          throw Error("The existing file could not be read completely.");
        originalHash.update(chunk);
        observed += chunk.byteLength;
        if (observed === file.size || observed % (8 * 1024 * 1024) === 0)
          progress(
            `Compressing locally: ${Math.round(observed / 1048576)} of ${Math.ceil(file.size / 1048576)} MiB`,
          );
        controller.enqueue(chunk);
      },
    });
    const reader = file
      .stream()
      .pipeThrough(input)
      .pipeThrough(new CompressionStream("gzip"))
      .getReader();
    const compressed: BlobPart[] = [];
    let compressedBytes = 0;
    try {
      for (;;) {
        cancelled(options.signal);
        const next = await reader.read();
        if (next.done) break;
        compressedBytes += next.value.byteLength;
        if (compressedBytes > MAX_CAPTURE_TRANSFER_SOURCE_BYTES + READ_BYTES)
          throw Error(
            "The compressed transfer exceeds its bounded file-sharing limit.",
          );
        compressed.push(next.value as BlobPart);
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (observed !== file.size)
      throw Error(
        "The existing file could not be read completely. Choose its complete local download.",
      );
    originalSha256 = bytesToHex(originalHash.digest());
    if (compressedBytes < file.size) {
      transport = new Blob(compressed, { type: "application/gzip" });
      encoding = "GZIP";
    } else
      warnings.push(
        "Gzip did not reduce this file. The transfer retains its original bytes directly.",
      );
  } else {
    if (compress && typeof CompressionStream !== "function")
      warnings.push(
        "This browser cannot compress JSON. The original bytes are split losslessly instead; current Chrome can produce smaller files.",
      );
    progress("Checking the exact existing file locally…");
    originalSha256 = await hashBlob(
      file,
      (bytes) =>
        progress(
          `Checking locally: ${Math.round(bytes / 1048576)} of ${Math.ceil(file.size / 1048576)} MiB`,
        ),
      options.signal,
    );
  }
  cancelled(options.signal);
  progress("Checking the complete transfer and preparing file parts…");
  const transportSha256 =
    encoding === "IDENTITY"
      ? originalSha256
      : await hashBlob(transport, () => {}, options.signal);
  const transferId = `${originalSha256.slice(0, 16)}-${transportSha256.slice(0, 16)}`;
  const stem =
    file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "capture";
  const prefix = `CTI_TRANSFER_${stem}_${transferId}`;
  const partCount = Math.ceil(transport.size / payloadLimit);
  const parts: CaptureTransferPart[] = [];
  const partFiles: File[] = [];
  for (
    let index = 1, offset = 0;
    index <= partCount;
    index++, offset += payloadLimit
  ) {
    cancelled(options.signal);
    progress(`Preparing part ${index} of ${partCount} locally…`);
    const end = Math.min(transport.size, offset + payloadLimit);
    const bytes = new Uint8Array(
      await transport.slice(offset, end).arrayBuffer(),
    );
    if (bytes.byteLength !== end - offset)
      throw Error("A transfer part could not be read completely.");
    const payloadSha256 = bytesToHex(sha256(bytes));
    const envelope = {
      kind: "CTI_CAPTURE_TRANSFER_PART",
      schemaVersion: 1,
      notForCourseAudit: true,
      transferId,
      index,
      partCount,
      offset,
      payloadBytes: bytes.byteLength,
      payloadSha256,
      payloadEncoding: "BASE64",
      data: base64(bytes),
    };
    const text = JSON.stringify(envelope);
    const body = encoder.encode(text);
    if (body.byteLength > maxPartFileBytes)
      throw Error(
        "A transfer part exceeded the safe attachment limit. No partial transfer was prepared.",
      );
    const fileName = `${prefix}.part-${String(index).padStart(3, "0")}-of-${String(partCount).padStart(3, "0")}.json`;
    parts.push({
      index,
      fileName,
      fileBytes: body.byteLength,
      fileSha256: bytesToHex(sha256(body)),
      offset,
      payloadBytes: bytes.byteLength,
      payloadSha256,
    });
    partFiles.push(new File([body], fileName, { type: "application/json" }));
  }
  const manifest: CaptureTransferManifest = {
    kind: "CTI_CAPTURE_TRANSFER_MANIFEST",
    schemaVersion: 1,
    notForCourseAudit: true,
    transferId,
    preparedAt,
    original: { fileName: file.name, bytes: file.size, sha256: originalSha256 },
    transport: {
      fileName: encoding === "GZIP" ? `${file.name}.gz` : file.name,
      encoding,
      bytes: transport.size,
      sha256: transportSha256,
    },
    partCount,
    maxPartFileBytes,
    parts,
    instructions: [
      "Share this manifest and every listed part file together. Keep them as files; do not paste part text.",
      "Verify each part file's size and SHA-256, parse its JSON envelope, verify its identity/order and decode its BASE64 data.",
      "Concatenate decoded payloads in index order, verifying contiguous offsets, payload hashes, total bytes and transport SHA-256.",
      "If transport encoding is GZIP, decompress it. Verify the restored original byte count and SHA-256, then restore its original file name.",
      "This is lossless file transport, not a QA report or proof of capture completeness. Use the original file for CTI comparison inputs.",
    ],
    warnings,
  };
  cancelled(options.signal);
  progress("Complete file ready. Download the manifest and every part below.");
  return {
    manifest,
    manifestFile: new File(
      [JSON.stringify(manifest, null, 2)],
      `${prefix}.manifest.json`,
      { type: "application/json" },
    ),
    partFiles,
  };
}
