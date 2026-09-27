import { migrationTextInfo, migrationTextParts } from "./migration-files.ts";
import { MAX_WORKSPACE_RECORD_BYTES } from "./workspace-validation.ts";
import { newRecord } from "./workspace-store.ts";
import type { EvidenceObject, WorkspaceRecord } from "./workspace-types.ts";

/** Preserve the entire original export, including tables without a native view. */
export function migrationBackupRecords(
  value: EvidenceObject,
): WorkspaceRecord[] {
  const text = JSON.stringify(value);
  const info = migrationTextInfo(text);
  const id = "backup_" + info.sha256;
  const title = `Original CTI export ${value.exportedAt || ""}`;
  if (info.utf8Bytes <= MAX_WORKSPACE_RECORD_BYTES)
    return [{ ...newRecord("legacy-backup", title, value), id }];
  const records: WorkspaceRecord[] = [];
  const parts = [];
  for (const fragment of migrationTextParts(text)) {
    const partIndex = records.length;
    const partId = `${id}_part_${String(partIndex).padStart(6, "0")}`;
    const part = {
      id: partId,
      index: partIndex,
      charCount: fragment.length,
      ...migrationTextInfo(fragment),
    };
    parts.push(part);
    records.push({
      ...newRecord("legacy-backup", `${title} · part ${partIndex + 1}`, {
        kind: "CTI_MIGRATION_BACKUP_PART",
        schemaVersion: 1,
        exportSha256: info.sha256,
        index: partIndex,
        text: fragment,
      }),
      id: partId,
    });
  }
  // Save the index last, just as the Drive completion manifest is written last.
  records.push({
    ...newRecord("legacy-backup", title, {
      kind: "CTI_MIGRATION_BACKUP_INDEX",
      schemaVersion: 1,
      exportSha256: info.sha256,
      utf8Bytes: info.utf8Bytes,
      charCount: text.length,
      parts,
    }),
    id,
  });
  return records;
}

/** Recovery helper for backup records, including records from a browser backup. */
export function restoreMigrationBackup(
  index: WorkspaceRecord,
  records: WorkspaceRecord[],
): EvidenceObject {
  if (index.kind !== "legacy-backup")
    throw new Error("Not a migration backup.");
  if (index.data.kind === "CTI_WORKSPACE_MIGRATION") return index.data;
  const data = index.data;
  if (
    data.kind !== "CTI_MIGRATION_BACKUP_INDEX" ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.parts)
  )
    throw new Error("Invalid migration backup index.");
  const byId = new Map(records.map((r) => [r.id, r]));
  const fragments = data.parts.map((part: any, i: number) => {
    const r = byId.get(part.id),
      p = r?.data;
    if (
      part.index !== i ||
      r?.kind !== "legacy-backup" ||
      p?.kind !== "CTI_MIGRATION_BACKUP_PART" ||
      p.schemaVersion !== 1 ||
      p.index !== i ||
      p.exportSha256 !== data.exportSha256 ||
      typeof p.text !== "string" ||
      p.text.length !== part.charCount
    )
      throw new Error(`Missing or invalid backup part ${i + 1}.`);
    const info = migrationTextInfo(p.text);
    if (info.sha256 !== part.sha256 || info.utf8Bytes !== part.utf8Bytes)
      throw new Error(`Corrupt backup part ${i + 1}.`);
    return p.text;
  });
  const text = fragments.join("");
  const info = migrationTextInfo(text);
  if (
    text.length !== data.charCount ||
    info.sha256 !== data.exportSha256 ||
    info.utf8Bytes !== data.utf8Bytes
  )
    throw new Error("Migration backup totals do not match.");
  return JSON.parse(text);
}
