import { decodeDownloadBatch, DOWNLOAD_BATCH_PARTS, DOWNLOAD_MAX_BYTES } from "./workspace-download-batch.ts";
import { performanceTrace } from '../diagnostics/runtime.ts';
import {
  validateRecord,
  validateWorkspaceTransition,
  validateOperationalReferences,
} from "./workspace-validation.ts";
import { reviewTime } from "./owner-time.ts";
import { summarizeAssignmentChanges } from "./assignment-change-freshness.ts";
import { normalizePartnerName, packageSemanticKey } from "./operations.ts";
import {
  workspaceRequest as request,
  workspaceBinaryRequest,
  workspaceBatchRequest,
  type TransferOptions,
} from "./workspace-http.ts";
import type {
  EvidenceObject,
  WorkspaceRecord,
  RecordKind,
} from "./workspace-types.ts";
export interface SaveOptions extends TransferOptions {
  /**
   * Import-only escape hatch for preserving historical duplicate package rows
   * so Operations can reconcile them losslessly. Normal course writes must
   * never set this flag.
   */
  allowSemanticDuplicate?: boolean;
}
interface UploadSession {
  id: string;
  email: string;
  record: WorkspaceRecord;
  sha256: string;
  nextPart: number;
  commitUncertain: boolean;
}
// Session identifiers/progress only. Payload bytes remain owned by the caller;
// an interrupted save is never persisted to disk or shared with another actor.
const uploadSessions = new Map<string, UploadSession>();
function transferProtocolError(message: string, phase: string) {
  return Object.assign(new Error(message), {
    code: "WORKSPACE_TRANSFER_PROTOCOL_INVALID",
    context: "Workspace evidence transfer",
    phase,
  });
}
function knownMissingRecord(error: unknown) {
  return (
    (error as { status?: number })?.status === 404 &&
    error instanceof Error &&
    /(?:^|HTTP 404\. )Record not found\.(?: Cloudflare Ray ID: [A-Za-z0-9-]{1,120}\.)?$/.test(
      error.message,
    )
  );
}
function sameSavedReceipt(
  expected: WorkspaceRecord,
  saved: WorkspaceRecord,
  actualHash: string,
  expectedHash: string,
) {
  return (
    saved?.id === expected.id &&
    saved.kind === expected.kind &&
    saved.packageId === expected.packageId &&
    saved.title === expected.title &&
    saved.version === expected.version + 1 &&
    !!saved.updatedAt &&
    !!saved.updatedBy &&
    actualHash === expectedHash
  );
}
export interface WorkspaceStore {
  mode: "local" | "team";
  role: "admin" | "editor" | "viewer";
  email: string;
  list(): Promise<WorkspaceRecord[]>;
  get(id: string, options?: TransferOptions): Promise<WorkspaceRecord>;
  save(
    record: WorkspaceRecord,
    options?: SaveOptions,
  ): Promise<WorkspaceRecord>;
  versions(id: string): Promise<EvidenceObject[]>;
}
// The listing/prepare envelope contains counters, not the report's nested
// per-item findings. Full evidence is independently checksummed and chunked.
function scalarSummary(value: EvidenceObject | undefined): EvidenceObject {
  let remaining = 16 * 1024;
  return Object.fromEntries(
    Object.entries(value || {})
      .filter(
        ([key, v]) =>
          key.length <= 120 &&
          (v === null ||
            typeof v === "boolean" ||
            (typeof v === "number" && Number.isFinite(v)) ||
            typeof v === "string"),
      )
      .slice(0, 128)
      .map(([key, v]) => [key, typeof v === "string" ? v.slice(0, 1024) : v])
      .filter((entry) => {
        const bytes = new TextEncoder().encode(JSON.stringify(entry)).length;
        if (bytes > remaining) return false;
        remaining -= bytes;
        return true;
      }),
  );
}
export function recordSummary(record: WorkspaceRecord): WorkspaceRecord {
  const d = record.data;
  const data =
    record.kind === "package"
      ? {
          partner: d.partner,
          owner: d.owner,
          status: d.status,
          assignedDate: d.assignedDate,
          deadline: d.deadline,
          driveLink: d.driveLink,
          archived: d.archived === true,
          archivedAt: d.archivedAt,
          archivedReason: d.archivedReason,
          duplicateSurvivorId: d.duplicateSurvivorId,
          hasExternalRuntimeEvidence: !!d.externalRuntimeEvidence,
          workState: d.workState,
          assignmentPlan: d.assignmentPlan,
          scan: {
            fileName: d.scan?.fileName,
            stats: scalarSummary(d.scan?.stats),
            moduleCount: d.scan?.moduleCount,
            fileSha256: d.scan?.fileSha256,
            scannedAt: d.scan?.scannedAt,
          },
        }
      : record.kind === "audit"
        ? {
            generation: d.generation,
            hashes: d.hashes,
            sourceScanSha256: d.sourceScanSha256,
            ...(d.automaticIngestion
              ? { automaticIngestion: d.automaticIngestion }
              : {}),
            summary: scalarSummary(d.result?.summary),
            stage: d.result?.snapshotContext?.mode,
          }
        : record.kind === "item-review"
          ? {
              auditId: d.auditId,
              itemKey: d.itemKey,
              review: {
                relevance: d.review?.relevance,
                timeEstimate: reviewTime(d.review),
                status: d.review?.status,
                note: d.review?.note,
                updatedAt: d.review?.updatedAt,
                updatedBy: d.review?.updatedBy,
                changeDeclaredAt: d.review?.changeDeclaredAt,
                hasCapture: !!d.review?.capture,
                pluginCaptureCount: d.review?.pluginCaptures?.length || 0,
                panoptoCaptureCount: d.review?.panoptoCaptures?.length || 0,
              },
            }
          : record.kind === "checklist"
            ? d
            : record.kind === "operations"
              ? d.type === "ingestion-attempt"
                ? {
                    type: d.type,
                    schemaVersion: d.schemaVersion,
                    courseId: d.courseId,
                    generation: d.generation,
                    previousGeneration: d.previousGeneration,
                    baseAuditId: d.baseAuditId,
                    previousAttemptId: d.previousAttemptId,
                    declaredAt: d.declaredAt,
                    declaredBy: d.declaredBy,
                    scope: d.scope,
                  }
                : {
                    type: d.type,
                    partner: d.partner,
                    sourceName: d.sourceName,
                    sourceSheet: d.sourceSheet,
                    sourceUrl: d.sourceUrl,
                    importedAt: d.importedAt,
                    rowCount: Array.isArray(d.rows) ? d.rows.length : 0,
                    runId: d.runId,
                    platform: d.platform,
                    sourceHash: d.sourceHash,
                    toGeneration: d.toGeneration,
                    schemaVersion: d.schemaVersion,
                    courseId: d.courseId,
                    eventCount: Array.isArray(d.events) ? d.events.length : 0,
                    mappingReviewCount: Array.isArray(d.events)
                      ? d.events.filter((e: any) =>
                          ["mapping-confirmed", "mapping-rejected"].includes(
                            e.kind,
                          ),
                        ).length
                      : 0,
                    lastEventAt: d.events?.at(-1)?.recordedAt,
                    ...(d.type === "item-lifecycle"
                      ? { declaredChanges: summarizeAssignmentChanges(d) }
                      : {}),
                    role: d.role,
                    nativeCourseId: d.nativeCourseId,
                    capturedAt: d.capturedAt,
                    confirmedCourseId: d.confirmedCourseId,
                    retention: d.original?.retention,
                    deliverableId: d.deliverableId,
                    deliverableKind: d.deliverableKind,
                    revision: d.revision,
                    previousRecordId: d.previousRecordId,
                    event: d.event,
                    basisHash: d.basisHash,
                    auditId: d.auditId,
                    auditVersion: d.auditVersion,
                    createdAt: d.createdAt,
                    datasetFingerprint: d.datasetFingerprint,
                    modelStatus: d.modelStatus,
                    exampleCount: d.exampleCount,
                  }
              : record.kind === "legacy-backup" &&
                  d.kind === "CTI_MIGRATION_RECOVERY_CASE"
                ? { kind: d.kind, sourceRunId: d.sourceRunId, issue: d.issue }
                : record.kind === "legacy-backup" &&
                    d.kind === "CTI_LEGACY_ACCESS_POLICY"
                  ? {
                      kind: d.kind,
                      authorizedDomain: d.authorizedDomain,
                      authorizedEmailCount: Array.isArray(d.authorizedEmails)
                        ? d.authorizedEmails.length
                        : 0,
                      editorEmailCount: Array.isArray(d.editorEmails)
                        ? d.editorEmails.length
                        : 0,
                    }
                  : {};
  return { ...record, data };
}
export function newRecord(
  kind: RecordKind,
  title: string,
  data: EvidenceObject,
  packageId = "",
): WorkspaceRecord {
  return {
    id: crypto.randomUUID(),
    kind,
    title,
    packageId,
    version: 0,
    updatedAt: "",
    updatedBy: "",
    data,
  };
}
function openLocal(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("cti-workspace-v1", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("records", { keyPath: "id" });
      r.result.createObjectStore("versions", { keyPath: "key" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export function localStore(): WorkspaceStore {
  const db = openLocal();
  async function read(store: string, key?: string): Promise<any> {
    const d = await db;
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store);
      const r = key
        ? tx.objectStore(store).get(key)
        : tx.objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return {
    mode: "local",
    role: "admin",
    email: "This browser",
    async list() {
      return (await read("records")).map(recordSummary);
    },
    async get(id) {
      const r = await read("records", id);
      if (!r) throw new Error("Record not found.");
      return r;
    },
    async versions(id) {
      return (await read("versions"))
        .filter((r: any) => r.id === id)
        .map((r: any) => ({
          version: r.version,
          updatedAt: r.updatedAt,
          updatedBy: r.updatedBy,
        }));
    },
    async save(record, options = {}) {
      validateRecord(record);
      const d = await db;
      let validatedReferences: WorkspaceRecord[] | undefined;
      const validatedLookups = new Map<string, number | null>();
      if (
        (record.kind === "audit" &&
          record.data.automaticIngestion !== undefined) ||
        (record.kind === "operations" &&
          [
            "item-lifecycle",
            "evidence-input",
            "assignment-deliverable",
            "advisory-model",
            "ingestion-attempt",
            "lineage-repair",
          ].includes(record.data.type))
      ) {
        // Complete asynchronous validation before opening the write transaction.
        // IndexedDB may commit an idle transaction while awaited work continues.
        const snapshot = (await read("records")) as WorkspaceRecord[];
        const byId = new Map(snapshot.map((row) => [row.id, row]));
        const prior = byId.get(record.id);
        validateWorkspaceTransition(prior, record);
        await validateOperationalReferences(
          record,
          async (id) => {
            const row = byId.get(id);
            validatedLookups.set(id, row?.version ?? null);
            return row;
          },
          prior,
          snapshot,
        );
        // All potentially consulted records, including a previously absent
        // supplement/review/revision, must still be identical at the write.
        validatedReferences = snapshot.filter(
          (row) =>
            row.id === record.packageId || row.packageId === record.packageId,
        );
      }
      return new Promise((resolve, reject) => {
        const tx = d.transaction(["records", "versions"], "readwrite");
        const table = tx.objectStore("records");
        let saved: WorkspaceRecord;
        let settled = false;
        const stop = (message: string) => {
          if (settled) return;
          settled = true;
          reject(new Error(message));
          tx.abort();
        };
        const continueSave = () => {
          const req = table.get(record.id);
          req.onerror = () => stop("Saved record could not be checked.");
          req.onsuccess = () => {
            const prior = req.result as WorkspaceRecord | undefined;
            if ((prior?.version || 0) !== record.version) {
              stop("Another change was saved. Refresh before retrying.");
              return;
            }
            if (prior?.kind === "audit") {
              stop("Saved audit snapshots are immutable. Create a new report.");
              return;
            }
            if (prior && prior.kind !== record.kind) {
              stop("Record type cannot change.");
              return;
            }
            const persist = () => {
              saved = {
                ...record,
                version: record.version + 1,
                updatedAt: new Date().toISOString(),
                updatedBy: "This browser",
              };
              table.put(saved);
              tx.objectStore("versions").put({
                ...saved,
                key: `${record.id}:${saved.version}`,
              });
            };
            try {
              validateWorkspaceTransition(prior, record);
            } catch (error) {
              stop(
                error instanceof Error
                  ? error.message
                  : "Invalid record transition.",
              );
              return;
            }
            if (validatedReferences) {
              const references = table.getAll();
              references.onerror = () =>
                stop("Referenced course evidence could not be checked.");
              references.onsuccess = () => {
                const byId = new Map(
                  (references.result as WorkspaceRecord[]).map((row) => [
                    row.id,
                    row,
                  ]),
                );
                const current = (references.result as WorkspaceRecord[]).filter(
                  (row) =>
                    row.id === record.packageId ||
                    row.packageId === record.packageId,
                );
                const versions = (rows: WorkspaceRecord[]) =>
                  JSON.stringify(
                    rows
                      .map((row) => [row.id, row.version])
                      .sort(([a], [b]) => String(a).localeCompare(String(b))),
                  );
                if (
                  versions(current) !== versions(validatedReferences!) ||
                  [...validatedLookups].some(
                    ([id, version]) =>
                      (byId.get(id)?.version ?? null) !== version,
                  )
                ) {
                  stop(
                    "Course evidence changed during validation. Refresh before retrying.",
                  );
                  return;
                }
                // No awaited work follows this IDB request callback: validation
                // and writes are joined by the atomic snapshot predicate above.
                persist();
              };
            } else persist();
          };
        };

        if (
          record.kind === "package" &&
          record.data.archived !== true &&
          options.allowSemanticDuplicate !== true
        ) {
          // IndexedDB read/write transactions on this object store are
          // serialized, so the duplicate check and put are one atomic local
          // decision even across two tabs.
          const all = table.getAll();
          all.onerror = () => stop("Course identity could not be checked.");
          all.onsuccess = () => {
            const rows = all.result as WorkspaceRecord[];
            const partner = normalizePartnerName(record.data.partner);
            const semantic = packageSemanticKey(
              record.data.scan?.fileName || record.title,
            );
            const prior = rows.find((candidate) => candidate.id === record.id);
            const priorPartner = normalizePartnerName(prior?.data.partner);
            const priorSemantic = prior
              ? packageSemanticKey(prior.data.scan?.fileName || prior.title)
              : "";
            // Existing historical duplicate rows must remain editable so the
            // reconciliation workflow can preserve/merge them. Enforce
            // uniqueness when an identity is introduced, changed or restored
            // from archive—not on a same-identity edit that does not worsen the
            // pre-existing state.
            const activatesIdentity =
              !prior ||
              prior.data.archived === true ||
              priorPartner !== partner ||
              priorSemantic !== semantic;
            const duplicate = activatesIdentity
              ? rows.find(
                  (candidate) =>
                    candidate.id !== record.id &&
                    candidate.kind === "package" &&
                    candidate.data.archived !== true &&
                    normalizePartnerName(candidate.data.partner) === partner &&
                    packageSemanticKey(
                      candidate.data.scan?.fileName || candidate.title,
                    ) === semantic,
                )
              : undefined;
            if (partner && semantic && duplicate) {
              stop(
                "An active course with the same partner and semantic package identity already exists. Rescan that course or reconcile duplicates in Operations.",
              );
              return;
            }
            continueSave();
          };
        } else {
          continueSave();
        }

        tx.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve(saved!);
          }
        };
        tx.onerror = () => {
          if (!settled) {
            settled = true;
            reject(tx.error || new Error("Save failed."));
          }
        };
        tx.onabort = () => {
          if (!settled) {
            settled = true;
            reject(new Error("Save was not committed."));
          }
        };
      });
    },
  };
}
export async function teamStore(
  downloadOptions: TransferOptions = {},
): Promise<WorkspaceStore> {
  const session = await request("session");
  // Per authenticated store instance, memory only. Keep at most two interrupted
  // records (32 MiB each); no persistent partial file or unverified import.
  const downloads = new Map<
    string,
    { identity: string; buffers: Uint8Array[] }
  >();
  let downloadTail: Promise<unknown> = Promise.resolve();
  function readSavedRecord(id: string, options: TransferOptions = {}) {
    const current = downloadTail.then(() =>
      performRead(id, { ...downloadOptions, ...options }),
    );
    downloadTail = current.catch(() => {});
    return current;
  }
  async function performRead(id: string, options: TransferOptions) {
const diagnosticEnd = performanceTrace().begin('evidence_load');
let diagnosticOutcome = 'observed';
try {

    const m = await request(
      `records/${encodeURIComponent(id)}`,
      {},
      {
        ...options,
        context: `Reading saved evidence (${id})`,
        phase: "download",
      },
    );
    if (
      !m.record ||
      m.record.id !== id ||
      !Number.isInteger(m.parts) ||
      m.parts < 1 ||
      m.parts > 256 ||
      !/^[a-f0-9]{64}$/.test(m.sha256) ||
      typeof m.revision !== "string" ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(m.revision)
    )
      throw transferProtocolError(
        "Saved evidence manifest is invalid.",
        "download",
      );
    const batch = m.downloadBatch;
    if (batch !== undefined && (batch?.version !== 1 || batch.maxParts !== DOWNLOAD_BATCH_PARTS ||
        !Number.isInteger(m.bytes) || m.bytes < 1 || m.bytes > DOWNLOAD_MAX_BYTES || m.parts !== Math.ceil(m.bytes / (128 * 1024))))
      throw transferProtocolError("Saved evidence batch capability is invalid.", "download");
    const identity = JSON.stringify([m.revision, m.sha256, m.parts, m.record, m.bytes]);
    let held = downloads.get(id);
    if (!held || held.identity !== identity) {
      downloads.delete(id);
      while (downloads.size >= 2)
        downloads.delete(downloads.keys().next().value!);
      held = { identity, buffers: [] };
      downloads.set(id, held);
    }
    const buffers = held.buffers;
    performanceTrace().count("cache_hits", buffers.length);
    performanceTrace().count("reused_chunks", buffers.length);
    try {
      if (buffers.length)
        options.onProgress?.(
          `Resuming saved evidence (${id}) at chunk ${buffers.length + 1}/${m.parts}; earlier chunks retained for final checksum verification.`,
        );
      for (let i = buffers.length; i < m.parts;) {
        if (options.signal?.aborted) throw Error("Transfer stopped by you.");
        if (batch) {
          const count = Math.min(DOWNLOAD_BATCH_PARTS, m.parts - i);
          const context = `Downloading saved evidence (${id}), chunks ${i + 1}–${i + count}/${m.parts}`;
          options.onProgress?.(context);
          const frame = await workspaceBatchRequest(
            `records/${encodeURIComponent(id)}/chunk-batch?revision=${encodeURIComponent(m.revision)}&first=${i}&count=${count}`,
            {...options, context, phase: "download"},
          );
          const chunks = await performanceTrace().measure("batch_validate", () => decodeDownloadBatch(frame, {
            recordId: id, revision: m.revision, sha256: m.sha256, bytes: m.bytes, parts: m.parts, first: i, count,
          }));
          if (options.signal?.aborted) throw Error("Transfer stopped by you.");
          buffers.push(...chunks);
          performanceTrace().count("chunks_acquired", count);
          performanceTrace().count(`batches_${count}`);
          i += count;
          continue;
        }
        options.onProgress?.(
          `Downloading saved evidence (${id}), chunk ${i + 1}/${m.parts}`,
        );
        const bytes = await workspaceBinaryRequest(
          `records/${encodeURIComponent(id)}/chunks/${i}?revision=${encodeURIComponent(m.revision)}`,
          {
            ...options,
            context: `Downloading saved evidence (${id}), chunk ${i + 1}/${m.parts}`,
            phase: "download",
            maxBytes: 128 * 1024,
          },
        );
        if (!bytes.length)
          throw transferProtocolError(
            "Saved evidence chunk is empty.",
            "download",
          );
        buffers.push(bytes);
        performanceTrace().count("chunks_acquired");
        i++;
      }
      const bytes = new Uint8Array(buffers.reduce((n, b) => n + b.length, 0));
      let offset = 0;
      for (const buffer of buffers) {
        bytes.set(buffer, offset);
        offset += buffer.length;
      }
      options.onProgress?.(
        `Verifying saved evidence (${id}): all ${m.parts} chunks downloaded.`,
      );
      const hash = await digest(bytes);
      if (hash !== m.sha256)
        throw transferProtocolError(
          "Saved evidence checksum failed.",
          "download",
        );
      let data: EvidenceObject;
      try {
        data = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw transferProtocolError(
          "Saved evidence JSON is invalid.",
          "download",
        );
      }
      const record = { ...m.record, data } as WorkspaceRecord;
      for (const [key, held] of uploadSessions)
        if (
          held.email === session.email &&
          sameSavedReceipt(held.record, record, hash, held.sha256)
        )
          uploadSessions.delete(key);
      downloads.delete(id);
      return { record, sha256: hash };
    } catch (error) {
      if (
        (error as { code?: string })?.code ===
          "WORKSPACE_TRANSFER_PROTOCOL_INVALID" ||
        (error as { code?: string })?.code === "WORKSPACE_BINARY_BOUND_EXCEEDED"
      )
        downloads.delete(id);
      else if (error instanceof Error && buffers.length)
        error.message += ` ${buffers.length}/${m.parts} chunks retained in this tab. Retry the same operation to resume after rechecking the saved revision. Closing or reloading this tab discards partial download progress, not saved evidence.`;
      throw error;
    }

} catch (error) { diagnosticOutcome = 'failed'; throw error; } finally { diagnosticEnd(diagnosticOutcome); }
}
  return {
    mode: "team",
    role: session.role,
    email: session.email,
    async list() {
      return (await request("records")).records;
    },
    async versions(id) {
      return (await request(`records/${encodeURIComponent(id)}/versions`))
        .versions;
    },
    async get(id, options) {
      return (await readSavedRecord(id, options)).record;
    },
    async save(record, options = {}) {
      validateRecord(record);
      record = JSON.parse(JSON.stringify(record)) as WorkspaceRecord;
      options = { ...options };
      if (session.role === "viewer")
        throw new Error("Your account has read-only access.");
      const bytes = new TextEncoder().encode(JSON.stringify(record.data));
      if (bytes.length > 32 * 1024 * 1024)
        throw new Error(
          "This saved artifact exceeds the 32 MiB workspace limit. Download a local copy.",
        );
      const size = 128 * 1024,
        parts = Math.ceil(bytes.length / size);
      const sha256 = await digest(bytes);
      const summary = recordSummary(record);
      const allowSemanticDuplicate = options.allowSemanticDuplicate === true;
      const binding = JSON.stringify([
        session.email,
        summary,
        bytes.length,
        parts,
        sha256,
        allowSemanticDuplicate,
      ]);
      const label = `"${record.title}" (${record.id})`;
      let held = uploadSessions.get(binding);
      if (held?.commitUncertain) {
        // Even direct callers must resolve a lost commit response before a
        // second finalization POST. A failed read is never proof of absence.
        try {
          const saved = await readSavedRecord(record.id, options);
          if (!sameSavedReceipt(record, saved.record, saved.sha256, sha256))
            throw transferProtocolError(
              `Checking ${label}: this ID contains different saved evidence. No write was repeated.`,
              "finalize",
            );
          uploadSessions.delete(binding);
          return saved.record;
        } catch (error) {
          if (!knownMissingRecord(error)) throw error;
        }
      }
      options.onProgress?.(
        `${held ? "Checking interrupted upload for" : "Preparing"} ${label}`,
      );
      const init = held
        ? await request(
            `uploads/${encodeURIComponent(held.id)}`,
            {},
            {
              ...options,
              context: `Checking interrupted upload for ${label}`,
              phase: "upload",
            },
          )
        : await request(
            "uploads",
            {
              method: "POST",
              body: JSON.stringify({
                record: summary,
                bytes: bytes.length,
                parts,
                sha256,
                allowSemanticDuplicate,
              }),
            },
            {
              ...options,
              context: `Preparing ${label}`,
              phase: "prepare",
              comparisonRecovery: record.kind === "audit",
            },
          );
      if (
        typeof init.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(init.id) ||
        (held && init.id !== held.id) ||
        JSON.stringify(init.record) !== JSON.stringify(summary) ||
        init.bytes !== bytes.length ||
        init.parts !== parts ||
        init.sha256 !== sha256 ||
        init.allowSemanticDuplicate !== allowSemanticDuplicate ||
        typeof init.committed !== "boolean" ||
        !Array.isArray(init.receivedParts) ||
        init.receivedParts.length > parts
      )
        throw transferProtocolError(
          `Preparing ${label}: the service did not return an exact matching upload manifest.`,
          "prepare",
        );
      const received = new Set<number>();
      for (const receipt of init.receivedParts) {
        if (
          !receipt ||
          typeof receipt !== "object" ||
          !Number.isInteger(receipt.part) ||
          receipt.part < 0 ||
          receipt.part >= parts ||
          received.has(receipt.part) ||
          receipt.bytes !==
            Math.min(size, bytes.length - receipt.part * size) ||
          !/^[a-f0-9]{64}$/.test(receipt.digest) ||
          receipt.digest !==
            (await digest(
              bytes.slice(receipt.part * size, (receipt.part + 1) * size),
            ))
        )
          throw transferProtocolError(
            `Checking ${label}: an existing upload chunk receipt differs from the selected evidence. No conflicting chunk was overwritten.`,
            "upload",
          );
        received.add(receipt.part);
      }
      if (init.committed) {
        const saved = await readSavedRecord(record.id, options);
        if (!sameSavedReceipt(record, saved.record, saved.sha256, sha256))
          throw transferProtocolError(
            `Checking ${label}: the saved report differs from this upload.`,
            "finalize",
          );
        uploadSessions.delete(binding);
        return saved.record;
      }
      held ||= {
        id: init.id,
        email: session.email,
        record: summary,
        sha256,
        nextPart: 0,
        commitUncertain: false,
      };
      uploadSessions.set(binding, held);
      for (let i = 0; i < parts; i++) {
        if (received.has(i)) continue;
        const chunk = bytes.slice(i * size, (i + 1) * size);
        const context = `Uploading ${label}, chunk ${i + 1}/${parts}`;
        options.onProgress?.(context);
        const uploaded = await request(
          `uploads/${init.id}/chunks/${i}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: chunk,
          },
          { ...options, context, phase: "upload" },
        );
        if (uploaded.success !== true)
          throw new Error(
            `${context}: the service did not confirm this chunk. Retry the import; saved records will be skipped.`,
          );
        held.nextPart = i + 1;
      }
      options.onProgress?.(`Finalizing ${label}`);
      held.commitUncertain = true;
      const saved = await request(
        `uploads/${init.id}/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            allowSemanticDuplicate,
          }),
        },
        {
          ...options,
          context: `Finalizing ${label}`,
          phase: "finalize",
          comparisonRecovery: record.kind === "audit",
        },
      );
      if (!sameSavedReceipt(record, saved.record, sha256, sha256))
        throw new Error(
          `Finalizing ${label}: the service did not confirm the saved record. Retry the import to check saved IDs first.`,
        );
      uploadSessions.delete(binding);
      return { ...saved.record, data: record.data };
    },
  };
}
export async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
