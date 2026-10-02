import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { buildPostQaText_ } from "../reporting/owner-report.js";
import {
  createLegacyChunkReader,
  LegacyChunkError,
  type LegacyChunkDiagnostics,
} from "./legacy-chunks.ts";
import { migrationBackupRecords } from "./migration-backup.ts";
import { validateRecord } from "./workspace-validation.ts";
import type { WorkspaceRecord, EvidenceObject } from "./workspace-types.ts";
import { newRecord } from "./workspace-store.ts";
export interface MigrationIssue {
  runId: string;
  packageId: string;
  reason: string;
  chunks?: LegacyChunkDiagnostics;
}
export interface LegacyAccessPolicy {
  authorizedDomain: string;
  authorizedEmails: string[];
  editorEmails: string[];
}
function splitLegacyAccessList(value: unknown): string[] {
  return [...new Set(
    String(value || "")
      .split(/[;,\n]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )];
}
function legacyRowObject(headers: unknown[], row: unknown[]): EvidenceObject {
  return Object.fromEntries(
    headers
      .map((header, index) => [String(header || "").trim(), row[index]])
      .filter(([header]) => !!header),
  );
}
function legacyJsonCell(value: unknown): EvidenceObject | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
export function importLegacyWorkspace(value: EvidenceObject): {
  records: WorkspaceRecord[];
  warnings: string[];
  issues: MigrationIssue[];
  legacyAccessPolicy: LegacyAccessPolicy | null;
} {
  if (
    value.kind !== "CTI_WORKSPACE_MIGRATION" ||
    value.schemaVersion !== 1 ||
    !value.sheets?.Packages
  )
    throw new Error(
      "Choose a CTI workspace migration JSON exported from the existing app.",
    );
  const stableId = (prefix: string, value: string) =>
    prefix + bytesToHex(sha256(new TextEncoder().encode(value)));
  const records: WorkspaceRecord[] = [];
  const warnings: string[] = [];
  const issues: MigrationIssue[] = [];
  const tables = value.sheets as Record<string, any[][]>;
  const decodeChunks = createLegacyChunkReader(tables);
  const legacyPolicySource = value.accessPolicy || {};
  const legacyAccessPolicy: LegacyAccessPolicy = {
    authorizedDomain: String(legacyPolicySource.AUTHORIZED_DOMAIN || "").trim().toLowerCase(),
    authorizedEmails: splitLegacyAccessList(legacyPolicySource.AUTHORIZED_EMAILS),
    editorEmails: splitLegacyAccessList(legacyPolicySource.EDITOR_EMAILS),
  };
  const hasLegacyAccessPolicy =
    !!legacyAccessPolicy.authorizedDomain ||
    legacyAccessPolicy.authorizedEmails.length > 0 ||
    legacyAccessPolicy.editorEmails.length > 0;
  for (const row of tables.Packages.slice(1)) {
    const id = String(row[18] || "");
    if (!id) {
      warnings.push(`Package ${row[2]} has no UUID; retained in backup only.`);
      continue;
    }
    const cell = String(row[12] || "");
    const tree = cell.startsWith("TREE:")
      ? decodeChunks("Package_Trees", cell.slice(5))
      : JSON.parse(cell || "[]");
    if (!Array.isArray(tree))
      throw new Error(`Invalid source tree for ${row[2]}.`);
    let extensions: EvidenceObject = {};
    try {
      extensions = JSON.parse(String(row[10] || "{}"));
    } catch {
      warnings.push(
        `File-extension metadata for ${row[2]} remains in the backup.`,
      );
    }
    const a = extensions._advanced || {};
    const stats = {
      webcontent: Number(row[4] || 0),
      quizzes: Number(row[5] || 0),
      assignments: 0,
      discussions: Number(row[6] || 0),
      weblinks: Number(row[7] || 0),
      lti: Number(row[8] || 0),
      unknown: Number(row[9] || 0),
      emptyFolders: Number(row[19] || 0),
      orphans: a.orphans || 0,
      lexicalTTR: a.ttr,
      zScoreImbalances: a.zScores || [],
      interactiveRuntimeCandidates: a.interactiveRuntimeCandidates || 0,
      scormLikeCandidates: a.scormLikeCandidates || 0,
      practiceJsonDependencies: a.practiceJsonDependencies || 0,
      lexicalTokenCount: a.lexicalTokenCount || 0,
      lexicalContextReliable: a.lexicalContextReliable === true,
      repeatedTitleRatio: a.repeatedTitleRatio || 0,
    };
    const total =
      stats.webcontent +
      stats.quizzes +
      stats.discussions +
      stats.weblinks +
      stats.lti +
      stats.unknown;
    const ifs =
      stats.lti * 10 +
      stats.emptyFolders * 5 +
      stats.unknown * 3 +
      stats.quizzes * 2 +
      stats.discussions * 1.5 +
      stats.weblinks +
      stats.webcontent * 0.5;
    const scan = {
      kind: "CTI_PACKAGE_SCAN",
      schemaVersion: 1,
      fileName: String(row[2]),
      scannedAt: String(row[0] || ""),
      fileSha256: "",
      moduleCount: Number(row[3] || 0),
      courseTree: tree,
      stats: {
        ...stats,
        totalItems: total,
        ifs:
          total &&
          !(total <= 5 && stats.quizzes === 0 && stats.webcontent === 0)
            ? ifs
            : 100,
      },
      fileExtensionsLog: extensions,
      unknownTypesLog: {},
      sourceEvidence: { manifestOnly: false, resources: {} },
      warnings: [
        "Imported historical source tree. Original scanner evidence remains on each source payload; no new scan was performed.",
      ],
    };
    const data: EvidenceObject = {
      scan,
      partner: String(row[1] || ""),
      owner: String(row[14] || ""),
      assignedDate: String(row[13] || ""),
      deadline: String(row[15] || ""),
      status: String(row[16] || "In Queue"),
      driveLink: String(row[17] || ""),
      legacyTimestamp: row[0],
      legacyAssessmentNames: row[11],
      legacyCombinedAssessmentCount: true,
    };
    if (value.externalRuntimeByPackage?.[id])
      data.externalRuntimeEvidence = value.externalRuntimeByPackage[id];
    records.push({ ...newRecord("package", String(row[2]), data), id });
  }
  const qa = tables.QA_Runs || [];
  const headers = (qa[0] || []).map(String);
  const get = (r: any[], name: string) => r[headers.indexOf(name)];
  for (const row of qa.slice(1)) {
    const id = String(get(row, "Run ID") || ""),
      packageId = String(get(row, "Package UUID") || "");
    if (!id) continue;
    let payload;
    try {
      payload = decodeChunks("QA_Run_Chunks", id, get(row, "Payload Chunks"));
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !payload.result ||
        typeof payload.result !== "object" ||
        Array.isArray(payload.result)
      )
        throw new Error("The saved payload does not contain a report result.");
      if (payload.runId !== undefined && String(payload.runId) !== id)
        throw new Error("The payload Run ID does not match its history row.");
      if (
        payload.packageUuid !== undefined &&
        String(payload.packageUuid) !== packageId
      )
        throw new Error(
          "The payload source-course UUID does not match its history row.",
        );
    } catch (e) {
      const issue: MigrationIssue = {
        runId: id,
        packageId,
        reason: e instanceof Error ? e.message : String(e),
        ...(e instanceof LegacyChunkError ? { chunks: e.diagnostics } : {}),
      };
      issues.push(issue);
      // Retain the history row as a recovery case, never as a fabricated audit.
      // Original chunk rows are also retained in the full original-export backup.
      records.push({
        ...newRecord(
          "legacy-backup",
          `Unavailable QA report: ${id}`,
          {
            kind: "CTI_MIGRATION_RECOVERY_CASE",
            schemaVersion: 1,
            sourceRunId: id,
            issue,
            legacyRunMetadata: Object.fromEntries(
              headers.map((h, i) => [h, row[i]]),
            ),
            recovery:
              "Keep the original export. Recover this run's full payload from the old workspace or a prior backup. Reimporting a complete payload restores the audit under its original Run ID.",
          },
          packageId,
        ),
        id: stableId("migration_issue_", id),
      });
      continue;
    }
    const raw = String(get(row, "Mode")) === "SINGLE_C0";
    const data = {
      result: payload.result,
      report: payload.result.currentSnapshot
        ? "BEFORE SNAPSHOT\n" +
          buildPostQaText_(structuredClone(payload.result.rawSnapshot || {})) +
          "\nAFTER SNAPSHOT\n" +
          buildPostQaText_(structuredClone(payload.result.currentSnapshot)) +
          "\nLIFECYCLE FINDINGS\n" +
          JSON.stringify(payload.result.lifecycleItems || [], null, 2)
        : buildPostQaText_(structuredClone(payload.result)),
      generation: Number(get(row, "Lineage Generation") || 0),
      packageId,
      hashes: {
        excel: String(
          get(row, raw ? "C0 XLSX SHA256" : "C1 XLSX SHA256") || "",
        ),
        json: String(get(row, raw ? "C0 JSON SHA256" : "C1 JSON SHA256") || ""),
        brightspace: String(get(row, "Live Source SHA256") || ""),
      },
      sourceScanSha256: "",
      legacyRunMetadata: Object.fromEntries(headers.map((h, i) => [h, row[i]])),
      capturedAt: String(get(row, "Timestamp") || payload.storedAt || ""),
    };
    records.push({
      ...newRecord("audit", id, data, packageId),
      id,
      updatedAt: data.capturedAt,
    });
  }
  for (const row of (tables.Work_State || []).slice(1)) {
    const key = String(row[0] || "");
    if (!key) continue;
    let evidence = {};
    try {
      evidence = JSON.parse(String(row[13] || "{}"));
    } catch {
      warnings.push(
        `Checklist ${key} needs manual review; its original text is retained.`,
      );
    }
    records.push({
      ...newRecord("checklist", key, {
        legacyWorkKey: key,
        legacyRow: row,
        evidence,
        notes: String(row[9] || ""),
      }),
      id: stableId("checklist_", key),
    });
  }
  const scanHistory = tables.Package_Scan_History || [];
  if (scanHistory.length > 1) {
    const historyHeaders = scanHistory[0] || [];
    let imported = 0;
    scanHistory.slice(1).forEach((row, index) => {
      const legacy = legacyRowObject(historyHeaders, row);
      if (!Object.values(legacy).some((cell) => cell !== "" && cell != null)) return;
      const runId = String(legacy["Scan ID"] || `row-${index + 2}`);
      const packageId = String(legacy["Package UUID"] || "");
      const fileName = String(legacy["File Name"] || packageId || "Source package");
      records.push({
        ...newRecord(
          "operations",
          `Legacy source scan · ${fileName}`,
          {
            type: "legacy-scan-history",
            sourceName: "Package_Scan_History",
            importedAt: String(legacy.Timestamp || value.exportedAt || ""),
            runId,
            action: String(legacy.Action || ""),
            gatewayRelease: String(legacy["Gateway Release"] || ""),
            oldMetrics: legacyJsonCell(legacy["Old Metrics JSON"]),
            newMetrics: legacyJsonCell(legacy["New Metrics JSON"]),
            rows: [legacy],
          },
          packageId,
        ),
        id: stableId(
          "legacy_scan_",
          `${packageId}|${runId}|${index}|${JSON.stringify(legacy)}`,
        ),
      });
      imported++;
    });
    if (imported)
      warnings.push(
        `Imported ${imported} legacy package scan-history entr${imported === 1 ? "y" : "ies"} as operational history.`,
      );
  }

  const duplicateArchive = tables.Duplicate_Archive || [];
  if (duplicateArchive.length > 1) {
    const archiveHeaders = duplicateArchive[0] || [];
    let imported = 0;
    duplicateArchive.slice(1).forEach((row, index) => {
      const legacy = legacyRowObject(archiveHeaders, row);
      if (!Object.values(legacy).some((cell) => cell !== "" && cell != null)) return;
      const packageId = String(legacy.UUID || "");
      const fileName = String(legacy["File Name"] || packageId || "Archived duplicate");
      const archivedAt = String(legacy["Archived At"] || legacy.Timestamp || value.exportedAt || "");
      records.push({
        ...newRecord(
          "operations",
          `Legacy duplicate archive · ${fileName}`,
          {
            type: "legacy-duplicate-archive",
            partner: String(legacy["University/Partner"] || ""),
            sourceName: "Duplicate_Archive",
            importedAt: archivedAt,
            survivorId: String(legacy["Survivor UUID"] || ""),
            duplicateGroup: String(legacy["Duplicate Group"] || ""),
            archiveAction: String(legacy["Archive Action"] || ""),
            rows: [legacy],
          },
          packageId,
        ),
        id: stableId(
          "legacy_duplicate_archive_",
          `${packageId}|${archivedAt}|${index}|${JSON.stringify(legacy)}`,
        ),
      });
      imported++;
    });
    if (imported)
      warnings.push(
        `Imported ${imported} legacy duplicate-archive entr${imported === 1 ? "y" : "ies"} as operational history.`,
      );
  }

  const catalogMap = tables.Catalog_Map || [];
  if (catalogMap.length > 1) {
    const catalogHeaders = catalogMap[0] || [];
    const rows = catalogMap
      .slice(1)
      .map((row) => legacyRowObject(catalogHeaders, row))
      .filter((row) => Object.values(row).some((cell) => cell !== "" && cell != null));
    if (rows.length) {
      records.push({
        ...newRecord("operations", "Legacy catalog map", {
          type: "legacy-catalog-map",
          sourceName: "Catalog_Map",
          importedAt: String(value.exportedAt || ""),
          rows,
          note:
            "Historical catalog mapping retained for provenance. Import a current portable catalog XLSX before using it for new operational decisions.",
        }),
        id: stableId("legacy_catalog_map_", JSON.stringify(rows)),
      });
      warnings.push(
        `Imported the legacy catalog map (${rows.length} row${rows.length === 1 ? "" : "s"}) as reference provenance; current portable catalog inputs remain authoritative for new work.`,
      );
    }
  }

  if (hasLegacyAccessPolicy) {
    records.push({
      ...newRecord("legacy-backup", "Legacy Apps Script access policy", {
        kind: "CTI_LEGACY_ACCESS_POLICY",
        schemaVersion: 1,
        ...legacyAccessPolicy,
        mappingNote:
          "These are the previous Apps Script authorization settings. They are retained for administrator review only and are not automatically applied to Cloudflare Access. Configure CTI_ADMINS / CTI_EDITORS and the Cloudflare Access policy explicitly.",
      }),
      id: stableId("legacy_access_policy_", JSON.stringify(legacyAccessPolicy)),
    });
    warnings.push(
      "Legacy Apps Script access settings were retained for administrator review; Cloudflare Access roles were not changed automatically.",
    );
  }

  for (const entry of value.workbooks || []) {
    const book = {
      name: String(entry.name || "Imported master"),
      sheets: entry.sheets,
    };
    const rows =
      book.sheets.export?.values ||
      (Object.values(book.sheets)[0] as { values?: any[][] })?.values ||
      [];
    const headers = (rows[0] || []).map((h: any) => String(h).toLowerCase());
    const l = headers.indexOf("level"),
      n = headers.indexOf("name");
    const all = rows
      .slice(1)
      .map((r: any[], i: number) => ({
        excelRow: i + 2,
        name: String(r[n] || ""),
        level: Number(r[l]),
      }))
      .filter((r: any) => r.level === 1);
    const filtered = all.filter((r: any) =>
      /^(Chapter|Ch\b|Spotlight|Module|Lesson|Unit|Part|Section)/i.test(r.name),
    );
    records.push({
      ...newRecord("workbook", book.name, {
        book,
        masterResult: { filteredModules: filtered.length ? filtered : all },
        legacyFileId: entry.id,
      }),
      id: stableId("master_", String(entry.id)),
    });
  }
  warnings.push(...(value.warnings || []).map(String));
  records.push(...migrationBackupRecords(value));
  records.forEach((r) => validateRecord(r));
  return {
    records,
    warnings,
    issues,
    legacyAccessPolicy: hasLegacyAccessPolicy ? legacyAccessPolicy : null,
  };
}
