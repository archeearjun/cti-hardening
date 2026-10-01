import { readWorkbook, type BookData, type Cell } from "../adapters/workbook.ts";
import {
  packageMatchKey,
  partnerKey,
} from "./package-identity.ts";
import {
  defaultCourseWorkState,
  nextCourseWorkAction,
  validateCourseWorkState,
} from "./work-state.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

export interface CatalogRow {
  sourceRow: number;
  partner: string;
  titleCode: string;
  displayCode: string;
  titleKey: string;
  title: string;
  productType: string;
  owner: string;
  brightspaceAccess: string;
  ccPackageAccess: string;
  importStatus: string;
  expectedFileName: string;
}

export interface PlannerRow {
  sourceRow: number;
  assignmentDate: string;
  partner: string;
  method: string;
  category: string;
  subCategory: string;
  owner: string;
  totalTitleCount: number;
  status: string;
  remarks: string;
}

export interface RuntimeRow {
  sourceRow: number;
  titleKey: string;
  courseCode: string;
  title: string;
  riseCount: number;
  storylineCount: number;
  linkLabel: string;
}

const text = (value: unknown) => String(value ?? "").trim();
const normalizeHeader = (value: unknown) =>
  text(value).toLowerCase().replace(/\s+/g, " ");
const ownerKey = (value: unknown) =>
  text(value).toLowerCase().replace(/[.\s]+/g, " ").trim();
const integer = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};
const scormCount = (value: unknown) => {
  const valueText = text(value);
  if (!valueText || /^n\/?a$/i.test(valueText) || /^none$/i.test(valueText) || /^no$/i.test(valueText))
    return 0;
  const number = Number(valueText);
  return Number.isFinite(number) && number >= 0 ? number : 1;
};
const headerIndex = (headers: Cell[], names: string[]) => {
  const normalized = headers.map(normalizeHeader);
  for (const name of names) {
    const index = normalized.indexOf(normalizeHeader(name));
    if (index >= 0) return index;
  }
  return -1;
};
const displayCode = (value: unknown) => {
  const valueText = text(value);
  const match = valueText.match(/[A-Za-z]{2,8}\d{2,4}/);
  return match
    ? match[0].toUpperCase()
    : valueText.replace(/\.(imscc|zip|xml)$/i, "").trim();
};

function firstSheet(book: BookData) {
  const entry = Object.entries(book.sheets)[0];
  if (!entry) throw new Error("Reference workbook has no sheets.");
  return { name: entry[0], rows: entry[1].display || entry[1].values };
}

function dateOnly(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel's serial date epoch includes the historical 1900 leap-year quirk.
    const millis = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(millis);
    return Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10)
      : "";
  }
  const valueText = text(value);
  if (!valueText) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(valueText)) return valueText;
  const parsed = new Date(valueText);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : "";
}

export function parseCatalogBook(book: BookData, partner: string) {
  const { name, rows } = firstSheet(book);
  if (rows.length < 2) throw new Error("Catalog contains no title rows.");
  const headers = rows[0] || [];
  const nait = partnerKey(partner).includes("nait");
  const codeIdx = nait
    ? headerIndex(headers, ["Title Code"])
    : headerIndex(headers, ["Common Cartridge File Name"]);
  const titleIdx = headerIndex(headers, ["Title"]);
  const typeIdx = headerIndex(headers, ["Coursera Product Type"]);
  const ownerIdx = headerIndex(headers, ["Assignment Owner"]);
  const brightIdx = headerIndex(headers, ["Brightspace Access"]);
  const ccIdx = headerIndex(headers, ["CC Package Access"]);
  const importIdx = headerIndex(headers, ["Import Status"]);
  if (codeIdx < 0 || titleIdx < 0)
    throw new Error(
      nait
        ? "NAIT catalog must contain Title Code and Title columns."
        : "Marshall catalog must contain Common Cartridge File Name and Title columns.",
    );

  const parsed: CatalogRow[] = [];
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index] || [];
    const code = text(row[codeIdx]);
    const title = text(row[titleIdx]);
    if (!code && !title) continue;
    const codeDisplay = displayCode(code || title);
    const titleKey = packageMatchKey(code || codeDisplay || title);
    if (!titleKey) continue;
    parsed.push({
      sourceRow: index + 1,
      partner,
      titleCode: nait ? code : codeDisplay,
      displayCode: codeDisplay,
      titleKey,
      title,
      productType: typeIdx >= 0 ? text(row[typeIdx]) : "",
      owner: ownerIdx >= 0 ? text(row[ownerIdx]) : "",
      brightspaceAccess: brightIdx >= 0 ? text(row[brightIdx]) : "",
      ccPackageAccess: ccIdx >= 0 ? text(row[ccIdx]) : "",
      importStatus: importIdx >= 0 ? text(row[importIdx]) : "",
      expectedFileName: /\.imscc$/i.test(code)
        ? code
        : code
          ? code + ".imscc"
          : codeDisplay
            ? codeDisplay + ".imscc"
            : "",
    });
  }
  return { sourceName: name, partner, rows: parsed };
}

export function parsePlannerBook(book: BookData) {
  const { name, rows } = firstSheet(book);
  if (rows.length < 2) throw new Error("Planner contains no assignment rows.");
  const headers = rows[0] || [];
  const dateIdx = headerIndex(headers, [
    "Assignment Date [mm/dd/yyyy]",
    "Assignment Date",
  ]);
  const partnerIdx = headerIndex(headers, ["Partner"]);
  const methodIdx = headerIndex(headers, ["Content Ingestion Method"]);
  const categoryIdx = headerIndex(headers, ["Assignment Category"]);
  const subCategoryIdx = headerIndex(headers, ["Assignment Sub-Category"]);
  const ownerIdx = headerIndex(headers, ["Assignment Owner"]);
  const totalIdx = headerIndex(headers, ["Total Title Count"]);
  const statusIdx = headerIndex(headers, ["Status"]);
  const remarksIdx = headerIndex(headers, ["Assignment Owner Remarks"]);
  if (dateIdx < 0 || partnerIdx < 0 || ownerIdx < 0)
    throw new Error(
      "Master Planner is missing Assignment Date, Partner, or Assignment Owner.",
    );

  const parsed: PlannerRow[] = [];
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index] || [];
    const assignmentDate = dateOnly(row[dateIdx]);
    const partner = text(row[partnerIdx]);
    const owner = text(row[ownerIdx]) || "Unassigned";
    if (!assignmentDate || !partner) continue;
    parsed.push({
      sourceRow: index + 1,
      assignmentDate,
      partner,
      method: methodIdx >= 0 ? text(row[methodIdx]) : "",
      category: categoryIdx >= 0 ? text(row[categoryIdx]) : "",
      subCategory: subCategoryIdx >= 0 ? text(row[subCategoryIdx]) : "",
      owner,
      totalTitleCount: totalIdx >= 0 ? integer(row[totalIdx]) : 0,
      status: statusIdx >= 0 ? text(row[statusIdx]) : "",
      remarks: remarksIdx >= 0 ? text(row[remarksIdx]) : "",
    });
  }
  return { sourceName: name, rows: parsed };
}

export function parseRuntimeBook(book: BookData) {
  const { name, rows } = firstSheet(book);
  if (!rows.length) return { sourceName: name, rows: [] as RuntimeRow[] };
  const headers = rows[0] || [];
  const codeIdx = headerIndex(headers, ["Coursecode", "Course Code"]);
  const titleIdx = headerIndex(headers, ["Course Title"]);
  const riseIdx = headerIndex(headers, ["RISE"]);
  const storylineIdx = headerIndex(headers, ["Storyline"]);
  const linkIdx = headerIndex(headers, ["Link"]);
  const parsed: RuntimeRow[] = [];
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index] || [];
    const code = codeIdx >= 0 ? text(row[codeIdx]) : "";
    const title = titleIdx >= 0 ? text(row[titleIdx]) : "";
    if (!code && !title) continue;
    const titleKey = packageMatchKey(code || title);
    if (!titleKey) continue;
    parsed.push({
      sourceRow: index + 1,
      titleKey,
      courseCode: code,
      title,
      riseCount: riseIdx >= 0 ? scormCount(row[riseIdx]) : 0,
      storylineCount: storylineIdx >= 0 ? scormCount(row[storylineIdx]) : 0,
      linkLabel: linkIdx >= 0 ? text(row[linkIdx]) : "",
    });
  }
  return { sourceName: name, rows: parsed };
}

export async function readReferenceWorkbook(file: File) {
  if (!file.size) throw new Error("Reference-data file is empty.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readWorkbook(bytes, file.name);
}

function resolveCatalogCandidate(candidates: CatalogRow[], plannerOwner: string) {
  if (!candidates.length)
    return { status: "MISSING", row: null as CatalogRow | null, candidates };
  if (candidates.length === 1)
    return { status: "MATCH", row: candidates[0], candidates };
  const expectedOwner = ownerKey(plannerOwner);
  const ownerMatches = candidates.filter(
    (row) => expectedOwner && ownerKey(row.owner) === expectedOwner,
  );
  if (ownerMatches.length === 1)
    return { status: "MATCH", row: ownerMatches[0], candidates };
  const completeMatches = candidates.filter(
    (row) =>
      row.ccPackageAccess.toLowerCase() === "complete" &&
      row.importStatus.toLowerCase() !== "pending",
  );
  if (!expectedOwner && completeMatches.length === 1)
    return { status: "MATCH", row: completeMatches[0], candidates };
  return { status: "AMBIGUOUS", row: null as CatalogRow | null, candidates };
}

function catalogKeysFromText(value: string, catalogByKey: Map<string, CatalogRow[]>) {
  const output: string[] = [];
  const seen = new Set<string>();
  const regex = /\b[A-Za-z]{2,8}\d{2,4}\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const key = packageMatchKey(match[0]);
    if (!key || !catalogByKey.has(key) || seen.has(key)) continue;
    seen.add(key);
    output.push(key);
  }
  return output;
}

function plannerGroups(
  planner: PlannerRow[],
  partner: string,
  fromDate: string,
  toDate: string,
  catalogByKey: Map<string, CatalogRow[]>,
) {
  const groups = new Map<string, any>();
  for (const row of planner) {
    if (partnerKey(row.partner) !== partnerKey(partner)) continue;
    if (row.assignmentDate < fromDate || row.assignmentDate > toDate) continue;
    if (row.method && !row.method.toLowerCase().includes("smart ingestion"))
      continue;
    const key = row.assignmentDate + "|" + ownerKey(row.owner);
    const group = groups.get(key) || {
      key,
      assignmentDate: row.assignmentDate,
      owner: row.owner,
      expectedTitleAssignments: 0,
      codes: [] as string[],
      codeSet: new Set<string>(),
      plannerRows: [] as PlannerRow[],
      categories: [] as string[],
    };
    group.expectedTitleAssignments += row.totalTitleCount;
    if (row.category && !group.categories.includes(row.category))
      group.categories.push(row.category);
    for (const titleKey of catalogKeysFromText(row.remarks, catalogByKey)) {
      if (group.codeSet.has(titleKey)) continue;
      group.codeSet.add(titleKey);
      group.codes.push(titleKey);
    }
    group.plannerRows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    parsedTitleCount: group.codes.length,
    unresolvedTitleCount: Math.max(
      0,
      group.expectedTitleAssignments - group.codes.length,
    ),
    codeSet: undefined,
  }));
}

function plannerEvidence(groups: any[], titleKey: string) {
  const matching = groups.filter((group) => group.codes.includes(titleKey));
  return {
    owner: matching[0]?.owner || "",
    latestDate: matching.reduce(
      (latest, group) =>
        group.assignmentDate > latest ? group.assignmentDate : latest,
      "",
    ),
    categories: [
      ...new Set(matching.flatMap((group) => group.categories || [])),
    ],
    rows: matching.flatMap((group) =>
      (group.plannerRows || []).map((row: PlannerRow) => row.sourceRow),
    ),
  };
}

export function buildPortableWorkQueue({
  records,
  catalogRows,
  plannerRows,
  runtimeRows = [],
  partner,
  fromDate,
  toDate,
  scanAfter,
}: {
  records: WorkspaceRecord[];
  catalogRows: CatalogRow[];
  plannerRows: PlannerRow[];
  runtimeRows?: RuntimeRow[];
  partner: string;
  fromDate: string;
  toDate: string;
  scanAfter: string;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate))
    throw new Error("Work-queue dates must use YYYY-MM-DD.");
  if (toDate < fromDate) throw new Error("To date must be on or after From date.");
  const catalogByKey = new Map<string, CatalogRow[]>();
  for (const row of catalogRows.filter(
    (row) => partnerKey(row.partner) === partnerKey(partner),
  )) {
    const group = catalogByKey.get(row.titleKey) || [];
    group.push(row);
    catalogByKey.set(row.titleKey, group);
  }
  const groups = plannerGroups(
    plannerRows,
    partner,
    fromDate,
    toDate,
    catalogByKey,
  );
  const titleKeys = new Set<string>(groups.flatMap((group) => group.codes));
  const packagesByKey = new Map<string, WorkspaceRecord[]>();
  for (const record of records.filter(
    (record) =>
      record.kind === "package" &&
      record.data.archived !== true &&
      partnerKey(record.data.partner) === partnerKey(partner),
  )) {
    const key = packageMatchKey(record.data.scan?.fileName || record.title);
    if (!key) continue;
    const bucket = packagesByKey.get(key) || [];
    bucket.push(record);
    packagesByKey.set(key, bucket);
  }
  const runtimeByKey = new Map(runtimeRows.map((row) => [row.titleKey, row]));
  const checklistByPackage = new Map(
    records
      .filter((record) => record.kind === "checklist" && record.packageId)
      .map((record) => [record.packageId, record]),
  );
  const auditsByPackage = new Map<string, WorkspaceRecord[]>();
  for (const audit of records.filter((record) => record.kind === "audit")) {
    const bucket = auditsByPackage.get(audit.packageId) || [];
    bucket.push(audit);
    auditsByPackage.set(audit.packageId, bucket);
  }

  const items = [...titleKeys].map((titleKey) => {
    const evidence = plannerEvidence(groups, titleKey);
    const resolved = resolveCatalogCandidate(
      catalogByKey.get(titleKey) || [],
      evidence.owner,
    );
    const catalog = resolved.row || {
      sourceRow: 0,
      partner,
      titleCode: titleKey.toUpperCase(),
      displayCode: titleKey.toUpperCase(),
      titleKey,
      title: "Catalog title unresolved",
      productType: "",
      owner: evidence.owner,
      brightspaceAccess: "",
      ccPackageAccess: "",
      importStatus: "",
      expectedFileName: titleKey.toUpperCase() + ".imscc",
    };
    const packages = packagesByKey.get(titleKey) || [];
    const packageRecord = packages.length === 1 ? packages[0] : null;
    const scannedAt = String(packageRecord?.data.scan?.scannedAt || "");
    const sourceRescanned =
      !!scannedAt && scannedAt.slice(0, 10) >= scanAfter;
    const audits = packageRecord
      ? auditsByPackage.get(packageRecord.id) || []
      : [];
    const rawAudits = audits
      .filter((audit) => String(audit.data.stage || "").toUpperCase() === "RAW_INGESTION")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const latestRaw = rawAudits[0] || null;
    const rawQaFresh =
      sourceRescanned &&
      !!latestRaw &&
      (!scannedAt || latestRaw.updatedAt >= scannedAt);
    const recommendation = rawQaFresh
      ? String(latestRaw?.data.recommendationCode || "REVIEW").toUpperCase()
      : "NONE";
    const checklist = packageRecord
      ? checklistByPackage.get(packageRecord.id)
      : null;
    const state = validateCourseWorkState(
      checklist?.data.workState || defaultCourseWorkState(),
    );
    const runtime = runtimeByKey.get(titleKey) || {
      riseCount: 0,
      storylineCount: 0,
      linkLabel: "",
    };
    const existingImportOnlyShell =
      evidence.categories.some(
        (category: string) => category.toLowerCase() === "import only",
      ) && /complete|completed|imported/i.test(catalog.importStatus);
    const nextAction = nextCourseWorkAction(
      {
        hasSourcePackage: !!packageRecord,
        sourceRescanned,
        existingImportOnlyShell,
        rawQaFresh,
        rawQaRecommendation:
          recommendation === "KEEP" ||
          recommendation === "REINGEST" ||
          recommendation === "REVIEW"
            ? (recommendation as "KEEP" | "REINGEST" | "REVIEW")
            : "NONE",
        runtimeFlagged:
          Number(runtime.riseCount || 0) +
            Number(runtime.storylineCount || 0) >
          0,
        needsSpecialization:
          catalog.productType.toLowerCase().includes("specialization") ||
          evidence.categories.some((category: string) =>
            category.toLowerCase().includes("course-to-specialization"),
          ),
        duplicateAmbiguous: packages.length > 1,
      },
      state,
    );
    return {
      titleKey,
      displayCode: catalog.displayCode,
      title: catalog.title,
      productType: catalog.productType,
      owner: evidence.owner,
      catalogOwner: catalog.owner,
      catalogStatus: resolved.status,
      catalogCandidateCount: resolved.candidates.length,
      catalogImportStatus: catalog.importStatus,
      plannerLatestDate: evidence.latestDate,
      plannerCategories: evidence.categories,
      plannerRows: evidence.rows,
      runtime: {
        riseCount: Number(runtime.riseCount || 0),
        storylineCount: Number(runtime.storylineCount || 0),
        linkLabel: String(runtime.linkLabel || ""),
      },
      ctiMatchStatus:
        packages.length === 0
          ? "MISSING"
          : packages.length === 1
            ? "MATCH"
            : "AMBIGUOUS",
      ctiCandidateCount: packages.length,
      ctiUuid: packageRecord?.id || "",
      ctiFileName: packageRecord?.data.scan?.fileName || "",
      sourceRescanned,
      latestRawQaId: latestRaw?.id || "",
      rawQaFresh,
      rawQaRecommendation: recommendation,
      state,
      nextAction,
    };
  });

  const unresolvedGroups = groups
    .filter((group) => group.unresolvedTitleCount > 0)
    .map((group) => ({
      assignmentDate: group.assignmentDate,
      owner: group.owner,
      expectedTitleAssignments: group.expectedTitleAssignments,
      parsedTitleCount: group.parsedTitleCount,
      unresolvedTitleCount: group.unresolvedTitleCount,
      categories: group.categories,
      plannerRows: group.plannerRows.map((row: PlannerRow) => row.sourceRow),
    }));
  return {
    partner,
    fromDate,
    toDate,
    scanAfter,
    items: items.sort(
      (a, b) =>
        a.owner.localeCompare(b.owner) ||
        a.plannerLatestDate.localeCompare(b.plannerLatestDate) ||
        a.displayCode.localeCompare(b.displayCode),
    ),
    unresolvedGroups,
    summary: {
      confirmedTitles: items.length,
      needsUpload: items.filter((item) => item.nextAction.code === "UPLOAD_SOURCE").length,
      needsRescan: items.filter((item) => item.nextAction.code === "RESCAN_SOURCE").length,
      needsRawAudit: items.filter((item) => item.nextAction.code === "AUDIT_EXISTING_RAW").length,
      complete: items.filter((item) => item.nextAction.code === "COMPLETE").length,
      excluded: items.filter((item) => item.state.scope === "EXCLUDED").length,
      runtimeFlagged: items.filter(
        (item) => item.runtime.riseCount + item.runtime.storylineCount > 0,
      ).length,
      unresolvedPlannerSlots: unresolvedGroups.reduce(
        (sum, group) => sum + group.unresolvedTitleCount,
        0,
      ),
      plannerExpectedAssignments: groups.reduce(
        (sum, group) => sum + group.expectedTitleAssignments,
        0,
      ),
    },
  };
}

export async function parseCatalogFile(file: File, partner: string) {
  return parseCatalogBook(
    readWorkbook(new Uint8Array(await file.arrayBuffer()), file.name),
    partner,
  );
}

export async function parsePlannerFile(file: File) {
  return parsePlannerBook(
    readWorkbook(new Uint8Array(await file.arrayBuffer()), file.name),
  );
}

export async function parseRuntimeFile(file: File) {
  return parseRuntimeBook(
    readWorkbook(new Uint8Array(await file.arrayBuffer()), file.name),
  );
}
