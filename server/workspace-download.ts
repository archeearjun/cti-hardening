import {
  validateDownloadBatch,
  downloadChunkSize,
  encodeDownloadBatch,
  type DownloadBatchIdentity,
} from "../src/domain/workspace-download-batch.ts";
import type { Database } from "./api.ts";

/** One bounded range query. Hex avoids D1's BLOB-as-number-array expansion. */
export async function readWorkspaceDownloadBatch(
  db: Database,
  identity: DownloadBatchIdentity,
) {
  validateDownloadBatch(identity);
  const { results } = await db
    .prepare(
      "SELECT part,bytes,digest,hex(value) AS value_hex FROM chunks WHERE upload_id=? AND part>=? AND part<? ORDER BY part ASC LIMIT 8",
    )
    .bind(identity.revision, identity.first, identity.first + identity.count)
    .all();
  const fail = (): never => {
    throw Object.assign(
      new Error("Saved evidence batch is incomplete or invalid."),
      { status: 409 },
    );
  };
  if (results.length !== identity.count) fail();
  const chunks = results.map((row, index) => {
    const part = identity.first + index,
      size = downloadChunkSize(identity, part);
    if (
      row.part !== part ||
      row.bytes !== size ||
      typeof row.value_hex !== "string" ||
      row.value_hex.length !== size * 2 ||
      !/^[a-fA-F0-9]+$/.test(row.value_hex) ||
      typeof row.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.digest)
    )
      fail();
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      const high = row.value_hex.charCodeAt(i * 2),
        low = row.value_hex.charCodeAt(i * 2 + 1);
      bytes[i] =
        (((high & 15) + (high > 57 ? 9 : 0)) << 4) |
        ((low & 15) + (low > 57 ? 9 : 0));
    }
    return { part, bytes, digest: row.digest };
  });
  return encodeDownloadBatch(identity, chunks);
}
