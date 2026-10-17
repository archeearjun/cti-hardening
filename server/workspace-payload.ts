import { courseraContentObservedAt } from "../src/domain/coursera-observation-time.ts";
import { validateIngestionAttemptData } from "../src/domain/ingestion-attempts.ts";
import type { WorkspaceRecord } from "../src/domain/workspace-types.ts";

export const WORKSPACE_PAYLOAD_CHUNK_BYTES = 128 * 1024;
export const WORKSPACE_PAYLOAD_MAX_BYTES = 32 * 1024 * 1024;
// D1 returns BLOBs as JavaScript number arrays. Reading a complete 32 MiB
// artifact that way can allocate over 256 MiB before decoding its JSON. Keep
// each result bounded and transport bytes as hex strings instead. At the
// maximum artifact size this takes eight reads, rather than 256 single-part
// reads. Each response carries at most 4 MiB of bytes as 8 MiB of hex. This
// bounds transport allocations; it does not remove D1's per-request query cap
// or make an unlimited number of historical artifacts fit in one request.
export const WORKSPACE_PAYLOAD_BATCH_PARTS = 32;

interface PayloadStatement {
  bind(...values: unknown[]): PayloadStatement;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[] }>;
}
interface PayloadDatabase {
  prepare(sql: string): PayloadStatement;
}
interface PayloadManifest {
  id: string;
  bytes: number;
  parts: number;
  sha256: string;
}
type PayloadContext = "uploaded" | "referenced";

function failPayload(
  context: PayloadContext,
  reason: string,
  status = 409,
): never {
  throw Object.assign(
    new Error(
      `${context === "uploaded" ? "Uploaded" : "Referenced"} evidence ${reason}.${context === "uploaded" ? " Nothing has been saved." : ""}`,
    ),
    { status },
  );
}

/** Validate the immutable bytes before exposing any record fields. The byte
 * buffer and bounded D1 results live only in this frame, not in the subsequent
 * reference/history validation performed by the caller. */
export async function readWorkspacePayload(
  db: PayloadDatabase,
  upload: PayloadManifest,
  context: PayloadContext,
): Promise<unknown> {
  if (
    !Number.isInteger(upload.bytes) ||
    upload.bytes < 1 ||
    upload.bytes > WORKSPACE_PAYLOAD_MAX_BYTES ||
    upload.parts !== Math.ceil(upload.bytes / WORKSPACE_PAYLOAD_CHUNK_BYTES) ||
    !/^[a-f0-9]{64}$/.test(upload.sha256)
  )
    failPayload(context, "manifest is invalid or exceeds its storage bound");

  const count = await db
    .prepare(
      "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM chunks WHERE upload_id=?",
    )
    .bind(upload.id)
    .first<{ count: number; bytes: number }>();
  if (!count || count.count !== upload.parts || count.bytes !== upload.bytes)
    failPayload(context, "is incomplete");

  const bytes = new Uint8Array(upload.bytes);
  let offset = 0;
  for (
    let first = 0;
    first < upload.parts;
    first += WORKSPACE_PAYLOAD_BATCH_PARTS
  ) {
    const end = Math.min(first + WORKSPACE_PAYLOAD_BATCH_PARTS, upload.parts);
    const { results } = await db
      .prepare(
        "SELECT part,bytes,hex(value) AS value_hex FROM chunks WHERE upload_id=? AND part>=? AND part<? ORDER BY part ASC",
      )
      .bind(upload.id, first, end)
      .all<{ part: number; bytes: number; value_hex: string }>();
    if (results.length !== end - first) failPayload(context, "is incomplete");
    for (let index = 0; index < results.length; index++) {
      const chunk = results[index];
      const part = first + index;
      const size = Math.min(
        WORKSPACE_PAYLOAD_CHUNK_BYTES,
        upload.bytes - offset,
      );
      if (
        Number(chunk.part) !== part ||
        Number(chunk.bytes) !== size ||
        typeof chunk.value_hex !== "string" ||
        chunk.value_hex.length !== size * 2 ||
        !/^[a-fA-F0-9]+$/.test(chunk.value_hex)
      )
        failPayload(context, "chunk ordering or length is invalid");
      for (let position = 0; position < size; position++) {
        const high = chunk.value_hex.charCodeAt(position * 2);
        const low = chunk.value_hex.charCodeAt(position * 2 + 1);
        bytes[offset + position] =
          (((high & 15) + (high > 57 ? 9 : 0)) << 4) |
          ((low & 15) + (low > 57 ? 9 : 0));
      }
      offset += size;
    }
  }
  const actual = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  if (offset !== upload.bytes || actual !== upload.sha256)
    failPayload(context, "checksum failed");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    failPayload(context, "is not valid JSON", 400);
  }
}

/** This is a transient server projection of an independently checksummed
 * original, never a replacement for its stored payload or a listing summary.
 * Ingestion allocation/freshness uses these fields only. Actual item/approval
 * operations continue to load complete original records. */
export function compactIngestionHistoryRecord(
  record: WorkspaceRecord,
): WorkspaceRecord {
  if (record.kind === "audit") {
    const meta = record.data.result?.stats?.extractorMeta;
    const enrichment = meta?.directDataCapture?.mediaEnrichment;
    const captureMeta = {
      ...(typeof meta?.capturedAt === "string"
        ? { capturedAt: meta.capturedAt }
        : {}),
      ...(enrichment && typeof enrichment === "object"
        ? {
            directDataCapture: {
              mediaEnrichment: {
                ...(typeof enrichment.scope === "string"
                  ? { scope: enrichment.scope }
                  : {}),
                ...(enrichment.retainedAssessmentObservations === true
                  ? { retainedAssessmentObservations: true }
                  : {}),
                ...(typeof enrichment.baseSourceCapturedAt === "string"
                  ? { baseSourceCapturedAt: enrichment.baseSourceCapturedAt }
                  : {}),
              },
            },
          }
        : {}),
    };
    const compact = {
      ...record,
      data: {
        generation: record.data.generation,
        hashes:
          typeof record.data.hashes?.json === "string"
            ? { json: record.data.hashes.json }
            : {},
        result: { stats: { extractorMeta: captureMeta } },
      },
    };
    // Keep freshness semantics explicit when future observation rules change.
    if (
      courseraContentObservedAt(compact) !== courseraContentObservedAt(record)
    )
      throw Error("Ingestion history observation projection is incomplete.");
    return compact;
  }
  if (
    record.kind === "operations" &&
    record.data.type === "ingestion-attempt"
  ) {
    // Validate before selecting fields: unsupported receipt fields must not
    // silently disappear and become acceptable historical declarations.
    const data = validateIngestionAttemptData(record.data);
    return { ...record, data: { ...data } };
  }
  if (record.kind === "operations" && record.data.type === "lineage-repair")
    return {
      ...record,
      data: {
        type: record.data.type,
        runId: record.data.runId,
        toGeneration: record.data.toGeneration,
      },
    };
  return record;
}
