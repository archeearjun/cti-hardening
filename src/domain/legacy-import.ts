import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { buildPostQaText_ } from "../generated/owner-report.js";
import { validateRecord } from "./workspace-validation.ts";
import type { WorkspaceRecord, EvidenceObject } from "./workspace-types.ts";
import { newRecord } from "./workspace-store.ts";
export function importLegacyWorkspace(value: EvidenceObject): {
  records: WorkspaceRecord[];
  warnings: string[];
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
  const tables = value.sheets as Record<string, any[][]>;
  function decodeChunks(table: string, id: string) {
    const rows = (tables[table] || [])
      .slice(1)
      .filter((r) => String(r[0]) === id)
      .sort((a, b) => Number(a[1]) - Number(b[1]));
    if (!rows.length || rows.some((r, i) => Number(r[1]) !== i))
      throw new Error(
        `Incomplete ${table} chunks for ${id}. Import stopped without fabricating evidence.`,
      );
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(rows.map((r) => String(r[2] || "")).join("")),
          (c) => c.charCodeAt(0),
        ),
      ),
    );
  }
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
    const payload = decodeChunks("QA_Run_Chunks", id);
    if (!payload.result) throw new Error(`Saved report ${id} has no result.`);
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
  records.push({
    ...newRecord(
      "legacy-backup",
      `Original CTI export ${value.exportedAt || ""}`,
      value,
    ),
    id: stableId("backup_", JSON.stringify(value)),
  });
  records.forEach((r) => validateRecord(r));
  return { records, warnings };
}
