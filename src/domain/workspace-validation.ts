import type { WorkspaceRecord } from "./workspace-types.ts";
import { validateOwnerReview } from "./owner-actions.ts";
import { validateCourseWorkState } from "./work-state.ts";
export const VALID_COURSE_STATUSES = [
  "In Queue",
  "In Progress",
  "QA Review",
  "Blocked",
  "Completed",
] as const;

export function validateDateOnly(value: unknown, fieldName: string): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new Error(fieldName + " must use YYYY-MM-DD format.");
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error(fieldName + " is not a valid calendar date.");
  return text;
}

export function validateCourseStatus(value: unknown): string {
  const status = String(value || "In Queue").trim();
  if (!(VALID_COURSE_STATUSES as readonly string[]).includes(status))
    throw new Error("Invalid course status.");
  return status;
}

export function validateDriveLink(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Drive link must be a valid HTTPS Google Drive or Docs URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !["drive.google.com", "docs.google.com"].includes(url.hostname.toLowerCase())
  )
    throw new Error("Drive link must be an HTTPS Google Drive or Docs URL.");
  return url.toString();
}

const kinds = [
  "package",
  "audit",
  "workbook",
  "checklist",
  "legacy-backup",
  "item-review",
  "reference-data",
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
    if (
      typeof record.data.partner !== "string" ||
      record.data.partner.length > 200 ||
      typeof record.data.owner !== "string" ||
      record.data.owner.length > 300
    )
      throw new Error("Invalid source-course partner or owner metadata.");
    validateCourseStatus(record.data.status);
    validateDateOnly(record.data.assignedDate, "Assigned date");
    validateDateOnly(record.data.deadline, "Deadline");
    validateDriveLink(record.data.driveLink);
    if (
      record.data.assignedDate &&
      record.data.deadline &&
      record.data.deadline < record.data.assignedDate
    )
      throw new Error("Deadline must be on or after the assigned date.");
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
  if (record.kind === "reference-data") {
    const subtype = String(record.data.subtype || "");
    if (!["CATALOG", "PLANNER", "RUNTIME"].includes(subtype))
      throw new Error("Reference data must identify CATALOG, PLANNER, or RUNTIME.");
    if (
      typeof record.data.sourceName !== "string" ||
      record.data.sourceName.length > 500 ||
      typeof record.data.importedAt !== "string" ||
      !Number.isFinite(Date.parse(record.data.importedAt))
    )
      throw new Error("Invalid reference-data source metadata.");
    if (
      record.data.partner != null &&
      (typeof record.data.partner !== "string" ||
        record.data.partner.length > 200)
    )
      throw new Error("Invalid reference-data partner.");
    if (!Array.isArray(record.data.rows) || record.data.rows.length > 50_000)
      throw new Error("Reference data must contain at most 50,000 parsed rows.");
    if (
      record.data.rows.some(
        (row: unknown) =>
          !row || typeof row !== "object" || Array.isArray(row),
      )
    )
      throw new Error("Reference data contains an invalid parsed row.");
  }
  if (record.kind === "checklist") {
    if (
      !record.data.evidence ||
      typeof record.data.evidence !== "object" ||
      Array.isArray(record.data.evidence) ||
      !Object.values(record.data.evidence).every((v) => typeof v === "boolean")
    )
      throw new Error("Invalid saved checklist.");
    if (
      record.data.notes != null &&
      (typeof record.data.notes !== "string" || record.data.notes.length > 4000)
    )
      throw new Error("Checklist notes exceed the 4,000-character limit.");
    if (record.data.workState != null)
      validateCourseWorkState(record.data.workState);
  }
}
export function validateRecordSummary(record: WorkspaceRecord): void {
  validateRecord(record, false);
  const data = record.data || {};
  if (record.kind === "package") {
    if (
      typeof data.partner !== "string" ||
      data.partner.length > 200 ||
      typeof data.owner !== "string" ||
      data.owner.length > 300
    )
      throw new Error("Invalid source-course partner or owner metadata.");
    validateCourseStatus(data.status);
    validateDateOnly(data.assignedDate, "Assigned date");
    validateDateOnly(data.deadline, "Deadline");
    validateDriveLink(data.driveLink);
    if (
      data.assignedDate &&
      data.deadline &&
      data.deadline < data.assignedDate
    )
      throw new Error("Deadline must be on or after the assigned date.");
    if (
      !data.scan ||
      typeof data.scan !== "object" ||
      Array.isArray(data.scan) ||
      typeof data.scan.fileName !== "string" ||
      data.scan.fileName.length > 500
    )
      throw new Error("Invalid source-course scan summary.");
  }
  if (record.kind === "audit") {
    if (
      !record.packageId ||
      !Number.isInteger(data.generation) ||
      data.generation < 0
    )
      throw new Error("Invalid audit summary.");
  }
  if (record.kind === "checklist") {
    if (
      !data.evidence ||
      typeof data.evidence !== "object" ||
      Array.isArray(data.evidence) ||
      !Object.values(data.evidence).every((value) => typeof value === "boolean")
    )
      throw new Error("Invalid saved checklist summary.");
    if (data.workState != null) validateCourseWorkState(data.workState);
  }
  if (record.kind === "reference-data") {
    if (!["CATALOG", "PLANNER", "RUNTIME"].includes(String(data.subtype || "")))
      throw new Error("Invalid reference-data summary.");
    if (
      typeof data.sourceName !== "string" ||
      data.sourceName.length > 500 ||
      typeof data.importedAt !== "string" ||
      !Number.isFinite(Date.parse(data.importedAt)) ||
      !Number.isInteger(Number(data.rowCount)) ||
      Number(data.rowCount) < 0 ||
      Number(data.rowCount) > 50_000
    )
      throw new Error("Invalid reference-data summary.");
    if (
      data.partner != null &&
      (typeof data.partner !== "string" || data.partner.length > 200)
    )
      throw new Error("Invalid reference-data partner.");
  }
  if (record.kind === "item-review") {
    if (
      !record.packageId ||
      typeof data.auditId !== "string" ||
      !data.auditId ||
      typeof data.itemKey !== "string" ||
      !data.itemKey
    )
      throw new Error("Invalid item-review summary.");
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
