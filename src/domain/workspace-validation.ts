import type { WorkspaceRecord } from "./workspace-types.ts";
import { validateOwnerReview } from "./owner-actions.ts";
import { validateCourseMetadata } from "./operations.ts";
const kinds = [
  "package",
  "audit",
  "workbook",
  "checklist",
  "legacy-backup",
  "item-review",
  "operations",
];
export function validateRecord(record: WorkspaceRecord, full = true): void {
  if (
    !record ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(record.id) ||
    !kinds.includes(record.kind) ||
    !Number.isInteger(record.version) ||
    record.version < 0 ||
    typeof record.title !== "string" ||
    record.title.length > 500 ||
    typeof record.packageId !== "string" ||
    record.packageId.length > 120 ||
    !record.data ||
    typeof record.data !== "object" ||
    Array.isArray(record.data)
  )
    throw new Error("Invalid workspace record.");
  if (!full) return;
  if (record.kind === "item-review") {
    if (
      !record.packageId ||
      typeof record.data.auditId !== "string" ||
      !record.data.auditId ||
      typeof record.data.itemKey !== "string" ||
      !record.data.itemKey ||
      !record.data.review ||
      typeof record.data.review.note !== "string"
    )
      throw new Error("Invalid item review.");
    validateOwnerReview(record.data.review);
  }
  if (record.kind === "package") {
    if (!Array.isArray(record.data.scan?.courseTree) || !record.data.scan?.stats)
      throw new Error(
        "A source record must contain a complete source tree and scan statistics.",
      );
    validateCourseMetadata({
      partner: record.data.partner,
      owner: record.data.owner,
      status: record.data.status,
      assignedDate: record.data.assignedDate,
      deadline: record.data.deadline,
      driveLink: record.data.driveLink,
    });
    if (
      record.data.archived !== undefined &&
      typeof record.data.archived !== "boolean"
    )
      throw new Error("Package archived state must be boolean.");
  }
  if (
    record.kind === "audit" &&
    (!record.packageId ||
      !record.data.result ||
      !Number.isInteger(record.data.generation) ||
      record.data.generation < 0)
  )
    throw new Error(
      "An audit must include its source course, result and ingestion attempt.",
    );
  if (
    record.kind === "workbook" &&
    (!record.data.book?.sheets ||
      !Object.values(record.data.book.sheets).every((s: any) =>
        Array.isArray(s?.values),
      ))
  )
    throw new Error("Invalid saved workbook.");
  if (
    record.kind === "checklist" &&
    (!record.data.evidence ||
      typeof record.data.evidence !== "object" ||
      Array.isArray(record.data.evidence) ||
      !Object.values(record.data.evidence).every((v) => typeof v === "boolean"))
  )
    throw new Error("Invalid saved checklist.");
  if (record.kind === "operations") {
    const type = String(record.data.type || "");
    if (
      ![
        "catalog",
        "planner",
        "runtime-inventory",
        "lineage-repair",
      ].includes(type)
    )
      throw new Error("Invalid operations record type.");
    if (type === "lineage-repair") {
      if (
        !record.packageId ||
        typeof record.data.runId !== "string" ||
        !record.data.runId ||
        !Number.isInteger(record.data.toGeneration) ||
        record.data.toGeneration < 0
      )
        throw new Error("Invalid lineage repair record.");
    } else if (!Array.isArray(record.data.rows)) {
      throw new Error("Operations input records must contain normalized rows.");
    }
  }
}
export function prepareWorkspaceBackup(value: any): WorkspaceRecord[] {
  if (
    value?.kind !== "CTI_BROWSER_WORKSPACE" ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records)
  )
    throw new Error("Invalid workspace backup.");
  const seen = new Set<string>();
  return value.records.map((r: WorkspaceRecord) => {
    validateRecord(r);
    if (seen.has(r.id)) throw new Error("Duplicate record IDs in backup.");
    seen.add(r.id);
    return { ...r, version: 0 };
  });
}

export const MAX_WORKSPACE_RECORD_BYTES = 32 * 1024 * 1024;
// Run before the first save, not after importing an arbitrary subset.
export function validateImportRecordSizes(records: WorkspaceRecord[]): void {
  const ids = new Set<string>();
  for (const record of records) {
    validateRecord(record);
    if (ids.has(record.id))
      throw new Error(`Duplicate import record ID: ${record.id}.`);
    ids.add(record.id);
    const bytes = new TextEncoder().encode(JSON.stringify(record.data)).length;
    if (bytes > MAX_WORKSPACE_RECORD_BYTES)
      throw new Error(
        `Import stopped before saving: "${record.title}" (${record.id}) is ${(bytes / 1024 / 1024).toFixed(1)} MiB, above the 32 MiB per-record limit. Its data has not been truncated. Keep the export for a targeted migration fix.`,
      );
  }
}
