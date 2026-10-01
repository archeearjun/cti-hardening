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
      !record.data.partner.trim() ||
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
