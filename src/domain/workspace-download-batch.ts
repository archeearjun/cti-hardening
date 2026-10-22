/** Versioned read-only transport. Stored chunks and upload format are unchanged. */
export const DOWNLOAD_CHUNK_BYTES = 128 * 1024;
export const DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024;
export const DOWNLOAD_BATCH_PARTS = 8;
export const DOWNLOAD_BATCH_HEADER_BYTES = 1024;
export const DOWNLOAD_BATCH_MAX_BYTES =
  12 +
  DOWNLOAD_BATCH_HEADER_BYTES +
  DOWNLOAD_BATCH_PARTS * (40 + DOWNLOAD_CHUNK_BYTES);
const magic = new Uint8Array([67, 84, 73, 66, 65, 84, 67, 49]); // CTIBATC1
export interface DownloadBatchIdentity {
  recordId: string;
  revision: string;
  sha256: string;
  bytes: number;
  parts: number;
  first: number;
  count: number;
}
export interface DownloadBatchChunk {
  part: number;
  bytes: Uint8Array;
  digest: string;
}
export function invalidDownloadBatch(): never {
  throw Object.assign(
    new Error("Saved evidence batch identity, framing or checksum is invalid."),
    {
      code: "WORKSPACE_TRANSFER_PROTOCOL_INVALID",
      phase: "download",
      context: "Workspace evidence transfer",
    },
  );
}
export function validateDownloadBatch(identity: DownloadBatchIdentity) {
  if (
    !identity ||
    typeof identity.recordId !== "string" ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(identity.recordId) ||
    typeof identity.revision !== "string" ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(identity.revision) ||
    typeof identity.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(identity.sha256) ||
    !Number.isInteger(identity.bytes) ||
    identity.bytes < 1 ||
    identity.bytes > DOWNLOAD_MAX_BYTES ||
    identity.parts !== Math.ceil(identity.bytes / DOWNLOAD_CHUNK_BYTES) ||
    !Number.isInteger(identity.first) ||
    identity.first < 0 ||
    !Number.isInteger(identity.count) ||
    identity.count < 1 ||
    identity.count > DOWNLOAD_BATCH_PARTS ||
    identity.first + identity.count > identity.parts
  )
    invalidDownloadBatch();
}
export function downloadChunkSize(
  identity: DownloadBatchIdentity,
  part: number,
) {
  return Math.min(
    DOWNLOAD_CHUNK_BYTES,
    identity.bytes - part * DOWNLOAD_CHUNK_BYTES,
  );
}
export function encodeDownloadBatch(
  identity: DownloadBatchIdentity,
  chunks: DownloadBatchChunk[],
) {
  validateDownloadBatch(identity);
  const header = new TextEncoder().encode(JSON.stringify(identity));
  if (
    header.length > DOWNLOAD_BATCH_HEADER_BYTES ||
    chunks.length !== identity.count
  )
    invalidDownloadBatch();
  const total =
    12 +
    header.length +
    chunks.reduce((sum, chunk) => sum + 40 + chunk.bytes.length, 0);
  if (total > DOWNLOAD_BATCH_MAX_BYTES) invalidDownloadBatch();
  const result = new Uint8Array(total),
    view = new DataView(result.buffer);
  result.set(magic);
  view.setUint32(8, header.length);
  result.set(header, 12);
  let offset = 12 + header.length;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (
      chunk.part !== identity.first + i ||
      chunk.bytes.length !== downloadChunkSize(identity, chunk.part) ||
      !/^[a-f0-9]{64}$/.test(chunk.digest)
    )
      invalidDownloadBatch();
    view.setUint32(offset, chunk.part);
    view.setUint32(offset + 4, chunk.bytes.length);
    for (let d = 0; d < 32; d++)
      result[offset + 8 + d] = parseInt(
        chunk.digest.slice(d * 2, d * 2 + 2),
        16,
      );
    result.set(chunk.bytes, offset + 40);
    offset += 40 + chunk.bytes.length;
  }
  return result;
}
/** All-or-nothing: no chunk reaches the resume buffer until the entire frame validates. */
export async function decodeDownloadBatch(
  frame: Uint8Array,
  expected: DownloadBatchIdentity,
): Promise<Uint8Array[]> {
  validateDownloadBatch(expected);
  if (
    frame.length < 12 ||
    frame.length > DOWNLOAD_BATCH_MAX_BYTES ||
    magic.some((b, i) => frame[i] !== b)
  )
    invalidDownloadBatch();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const headerSize = view.getUint32(8);
  if (
    !headerSize ||
    headerSize > DOWNLOAD_BATCH_HEADER_BYTES ||
    12 + headerSize > frame.length
  )
    invalidDownloadBatch();
  let actual: DownloadBatchIdentity;
  try {
    actual = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        frame.subarray(12, 12 + headerSize),
      ),
    );
  } catch {
    invalidDownloadBatch();
  }
  if (
    !actual ||
    Object.keys(actual).length !== 7 ||
    Object.entries(expected).some(
      ([key, value]) => actual[key as keyof DownloadBatchIdentity] !== value,
    )
  )
    invalidDownloadBatch();
  let offset = 12 + headerSize;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < expected.count; i++) {
    if (offset + 40 > frame.length) invalidDownloadBatch();
    const part = view.getUint32(offset),
      size = view.getUint32(offset + 4);
    if (
      part !== expected.first + i ||
      size !== downloadChunkSize(expected, part) ||
      offset + 40 + size > frame.length
    )
      invalidDownloadBatch();
    const bytes = frame.subarray(offset + 40, offset + 40 + size);
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    );
    if (hash.some((b, n) => frame[offset + 8 + n] !== b))
      invalidDownloadBatch();
    chunks.push(bytes);
    offset += 40 + size;
  }
  if (offset !== frame.length) invalidDownloadBatch();
  // Copy only validated payloads: retained chunks never hold frame/header overhead.
  return chunks.map((bytes) => bytes.slice());
}
