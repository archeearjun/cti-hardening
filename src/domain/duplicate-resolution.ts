import { packageRecordIdentity } from "./package-identity.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

function scanTime(record: WorkspaceRecord) {
  const value = String(record.data.scan?.scannedAt || "");
  return Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
}

export function planDuplicateResolution(
  group: WorkspaceRecord[],
  survivorId: string,
  now = new Date().toISOString(),
) {
  const active = group.filter(
    (record) => record.kind === "package" && record.data.archived !== true,
  );
  const survivor = active.find((record) => record.id === survivorId);
  if (!survivor) throw new Error("Choose an active duplicate record to keep.");
  const identity = packageRecordIdentity(survivor);
  if (!identity || active.some((record) => packageRecordIdentity(record) !== identity))
    throw new Error("Only records with the same partner and semantic package identity can be reconciled.");
  if (active.length < 2)
    throw new Error("At least two active duplicate records are required.");

  const newest = [...active].sort(
    (a, b) => scanTime(b) - scanTime(a) || b.updatedAt.localeCompare(a.updatedAt),
  )[0];
  const archiveIds = active
    .filter((record) => record.id !== survivor.id)
    .map((record) => record.id);

  const survivorNext: WorkspaceRecord = {
    ...survivor,
    data: {
      ...survivor.data,
      scan:
        scanTime(newest) > scanTime(survivor)
          ? structuredClone(newest.data.scan)
          : survivor.data.scan,
      duplicateResolution: {
        resolvedAt: now,
        survivorId: survivor.id,
        archivedPackageIds: archiveIds,
        newestScanSourceId: newest.id,
        policy:
          "Explicit survivor selection; newest source scan retained; archived package records and their history remain recoverable.",
      },
    },
  };

  const archived = active
    .filter((record) => record.id !== survivor.id)
    .map((record) => ({
      ...record,
      data: {
        ...record.data,
        archived: true,
        archive: {
          archivedAt: now,
          reason: "SEMANTIC_PACKAGE_DUPLICATE",
          survivorId: survivor.id,
          recoverable: true,
        },
      },
    }));

  return { survivor: survivorNext, archived };
}

export function restoreArchivedPackage(
  record: WorkspaceRecord,
): WorkspaceRecord {
  if (record.kind !== "package" || record.data.archived !== true)
    throw new Error("Only an archived source-course record can be restored.");
  const data = { ...record.data };
  delete data.archived;
  data.archive = {
    ...(data.archive || {}),
    restoredAt: new Date().toISOString(),
    recoverable: true,
  };
  return { ...record, data };
}
