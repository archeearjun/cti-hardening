import { CTI_RELEASE_REGISTRY_ } from "../engine/release.js";
import { packageRecordIdentity } from "./package-identity.ts";
import { validateRecord } from "./workspace-validation.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

export interface HealthFinding {
  code: string;
  severity: "ERROR" | "WARNING" | "INFO";
  detail: string;
  recordIds?: string[];
}

export function buildSystemHealth(
  records: WorkspaceRecord[],
  storageMode: "local" | "team" | "unknown" = "unknown",
) {
  const findings: HealthFinding[] = [];
  const ids = new Set(records.map((record) => record.id));
  for (const record of records) {
    try {
      validateRecord(record, false);
    } catch (error) {
      findings.push({
        code: "INVALID_RECORD",
        severity: "ERROR",
        detail:
          record.id +
          ": " +
          (error instanceof Error ? error.message : String(error)),
        recordIds: [record.id],
      });
    }
    if (record.packageId && !ids.has(record.packageId)) {
      findings.push({
        code: "ORPHAN_PACKAGE_REFERENCE",
        severity: "ERROR",
        detail:
          record.id +
          " points to missing source course " +
          record.packageId +
          ".",
        recordIds: [record.id, record.packageId],
      });
    }
  }

  const byIdentity = new Map<string, WorkspaceRecord[]>();
  for (const record of records.filter(
    (row) => row.kind === "package" && row.data.archived !== true,
  )) {
    const key = packageRecordIdentity(record);
    if (!key) continue;
    const bucket = byIdentity.get(key) || [];
    bucket.push(record);
    byIdentity.set(key, bucket);
  }
  for (const [key, group] of byIdentity) {
    if (group.length < 2) continue;
    findings.push({
      code: "SEMANTIC_PACKAGE_DUPLICATE",
      severity: "WARNING",
      detail:
        "Multiple active source-course records share semantic identity " +
        key +
        ": " +
        group.map((record) => record.title).join(", ") +
        ".",
      recordIds: group.map((record) => record.id),
    });
  }

  for (const record of records.filter((row) => row.kind === "package")) {
    const stats = record.data.scan?.stats || {};
    const runtimeFlagged =
      Number(stats.interactiveRuntimeCandidates || 0) > 0 ||
      Number(stats.scormLikeCandidates || 0) > 0 ||
      Number(stats.practiceJsonDependencies || 0) > 0;
    if (runtimeFlagged && !record.data.externalRuntimeEvidence) {
      findings.push({
        code: "RUNTIME_INVENTORY_MISSING",
        severity: "WARNING",
        detail:
          record.title +
          " has source runtime/interactivity signals but no imported external runtime inventory.",
        recordIds: [record.id],
      });
    }
  }

  const migrationCases = records.filter(
    (record) =>
      record.kind === "legacy-backup" &&
      record.data.kind === "CTI_MIGRATION_RECOVERY_CASE",
  );
  if (migrationCases.length)
    findings.push({
      code: "MIGRATION_RECOVERY_OPEN",
      severity: "WARNING",
      detail:
        migrationCases.length +
        " legacy migration recovery case(s) remain preserved for review.",
      recordIds: migrationCases.map((record) => record.id),
    });

  return {
    kind: "CTI_SYSTEM_HEALTH",
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    storageMode,
    releases: {
      gateway: CTI_RELEASE_REGISTRY_.gateway,
      qaEngine: CTI_RELEASE_REGISTRY_.qaEngine,
      courseraExtractor: CTI_RELEASE_REGISTRY_.courseraExtractor,
      brightspaceExtractor: CTI_RELEASE_REGISTRY_.brightspaceExtractor,
    },
    counts: {
      records: records.length,
      packages: records.filter((row) => row.kind === "package").length,
      audits: records.filter((row) => row.kind === "audit").length,
      workbooks: records.filter((row) => row.kind === "workbook").length,
      itemReviews: records.filter((row) => row.kind === "item-review").length,
      errors: findings.filter((finding) => finding.severity === "ERROR").length,
      warnings: findings.filter((finding) => finding.severity === "WARNING").length,
    },
    status: findings.some((finding) => finding.severity === "ERROR")
      ? "ERROR"
      : findings.some((finding) => finding.severity === "WARNING")
        ? "REVIEW"
        : "HEALTHY",
    findings,
  };
}
