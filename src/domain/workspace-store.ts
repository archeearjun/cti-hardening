import { validateRecord } from "./workspace-validation.ts";
import { reviewTime } from "./owner-time.ts";
import {
  normalizePartnerName,
  packageSemanticKey,
} from "./operations.ts";
import {
  workspaceRequest as request,
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
export interface WorkspaceStore {
  mode: "local" | "team";
  role: "admin" | "editor" | "viewer";
  email: string;
  list(): Promise<WorkspaceRecord[]>;
  get(id: string): Promise<WorkspaceRecord>;
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
                hasCapture: !!d.review?.capture,
                pluginCaptureCount: d.review?.pluginCaptures?.length || 0,
              },
            }
          : record.kind === "checklist"
            ? d
            : record.kind === "operations"
              ? {
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
export async function teamStore(): Promise<WorkspaceStore> {
  const session = await request("session");
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
    async get(id) {
      const m = await request(`records/${encodeURIComponent(id)}`);
      const buffers: Uint8Array[] = [];
      for (let i = 0; i < m.parts; i++) {
        const r = await fetch(
          `/api/records/${encodeURIComponent(id)}/chunks/${i}?revision=${encodeURIComponent(m.revision)}`,
          { signal: AbortSignal.timeout(45000) },
        );
        if (!r.ok) throw new Error("Saved evidence could not be downloaded.");
        buffers.push(new Uint8Array(await r.arrayBuffer()));
      }
      const bytes = new Uint8Array(buffers.reduce((n, b) => n + b.length, 0));
      let offset = 0;
      for (const b of buffers) {
        bytes.set(b, offset);
        offset += b.length;
      }
      const hash = await digest(bytes);
      if (hash !== m.sha256) throw new Error("Saved evidence checksum failed.");
      return { ...m.record, data: JSON.parse(new TextDecoder().decode(bytes)) };
    },
    async save(record, options = {}) {
      validateRecord(record);
      if (session.role === "viewer")
        throw new Error("Your account has read-only access.");
      const bytes = new TextEncoder().encode(JSON.stringify(record.data));
      if (bytes.length > 32 * 1024 * 1024)
        throw new Error(
          "This saved artifact exceeds the 32 MiB workspace limit. Download a local copy.",
        );
      const size = 128 * 1024,
        parts = Math.ceil(bytes.length / size);
      const label = `"${record.title}" (${record.id})`;
      options.onProgress?.(`Preparing ${label}`);
      const init = await request(
        "uploads",
        {
          method: "POST",
          body: JSON.stringify({
            record: recordSummary(record),
            bytes: bytes.length,
            parts,
            sha256: await digest(bytes),
          }),
        },
        { ...options, context: `Preparing ${label}` },
      );
      if (
        typeof init.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(init.id)
      )
        throw new Error(
          `Preparing ${label}: the service did not return a valid upload ID.`,
        );
      for (let i = 0; i < parts; i++) {
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
          { ...options, context },
        );
        if (uploaded.success !== true)
          throw new Error(
            `${context}: the service did not confirm this chunk. Retry the import; saved records will be skipped.`,
          );
      }
      options.onProgress?.(`Finalizing ${label}`);
      const saved = await request(
        `uploads/${init.id}/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            allowSemanticDuplicate:
              options.allowSemanticDuplicate === true,
          }),
        },
        { ...options, context: `Finalizing ${label}` },
      );
      if (
        !saved.record ||
        saved.record.id !== record.id ||
        saved.record.version !== record.version + 1
      )
        throw new Error(
          `Finalizing ${label}: the service did not confirm the saved record. Retry the import to check saved IDs first.`,
        );
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
