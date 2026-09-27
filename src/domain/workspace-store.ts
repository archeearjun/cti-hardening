import { validateRecord } from "./workspace-validation.ts";
import type {
  EvidenceObject,
  WorkspaceRecord,
  RecordKind,
} from "./workspace-types.ts";
export interface WorkspaceStore {
  mode: "local" | "team";
  role: "admin" | "editor" | "viewer";
  email: string;
  list(): Promise<WorkspaceRecord[]>;
  get(id: string): Promise<WorkspaceRecord>;
  save(record: WorkspaceRecord): Promise<WorkspaceRecord>;
  versions(id: string): Promise<EvidenceObject[]>;
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
          scan: {
            fileName: d.scan?.fileName,
            stats: d.scan?.stats,
            moduleCount: d.scan?.moduleCount,
            fileSha256: d.scan?.fileSha256,
          },
        }
      : record.kind === "audit"
        ? {
            generation: d.generation,
            hashes: d.hashes,
            sourceScanSha256: d.sourceScanSha256,
            summary: d.result?.summary,
            stage: d.result?.snapshotContext?.mode,
          }
        : record.kind === "checklist"
          ? d
          : record.kind === "legacy-backup" &&
              d.kind === "CTI_MIGRATION_RECOVERY_CASE"
            ? { kind: d.kind, sourceRunId: d.sourceRunId, issue: d.issue }
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
    async save(record) {
      validateRecord(record);
      const d = await db;
      return new Promise((resolve, reject) => {
        const tx = d.transaction(["records", "versions"], "readwrite");
        const table = tx.objectStore("records");
        const req = table.get(record.id);
        let saved: WorkspaceRecord;
        req.onsuccess = () => {
          const prior = req.result as WorkspaceRecord | undefined;
          if ((prior?.version || 0) !== record.version) {
            tx.abort();
            reject(
              new Error("Another change was saved. Refresh before retrying."),
            );
            return;
          }
          if (prior?.kind === "audit") {
            tx.abort();
            reject(
              new Error(
                "Saved audit snapshots are immutable. Create a new report.",
              ),
            );
            return;
          }
          if (prior && prior.kind !== record.kind) {
            tx.abort();
            reject(new Error("Record type cannot change."));
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
        tx.oncomplete = () => resolve(saved!);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error("Save was not committed."));
      });
    },
  };
}
async function request(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch("/api/" + path, {
    signal: AbortSignal.timeout(45000),
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  const data = await res
    .json()
    .catch(() => ({ error: "Unexpected service response." }));
  if (!res.ok)
    throw Object.assign(
      new Error(data.error || `Service returned ${res.status}`),
      { status: res.status },
    );
  return data;
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
    async save(record) {
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
      const init = await request("uploads", {
        method: "POST",
        body: JSON.stringify({
          record: recordSummary(record),
          bytes: bytes.length,
          parts,
          sha256: await digest(bytes),
        }),
      });
      for (let i = 0; i < parts; i++) {
        const chunk = bytes.slice(i * size, (i + 1) * size);
        const r = await fetch(`/api/uploads/${init.id}/chunks/${i}`, {
          method: "PUT",
          signal: AbortSignal.timeout(45000),
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        if (!r.ok) {
          const error = await r
            .json()
            .catch(() => ({ error: "Evidence upload failed." }));
          throw new Error(error.error);
        }
      }
      const saved = await request(`uploads/${init.id}/commit`, {
        method: "POST",
        body: "{}",
      });
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
