import type { BookData } from "../adapters/workbook.ts";
import type { PackageScan } from "./package-types.ts";
import type { EvidenceObject, WorkspaceRecord } from "./workspace-types.ts";

export const COURSE_STATUSES = [
  "In Queue",
  "In Progress",
  "QA Review",
  "Blocked",
  "Completed",
] as const;

export type CourseStatus = (typeof COURSE_STATUSES)[number];

export interface CourseMetadata {
  partner: string;
  owner: string;
  status: CourseStatus;
  assignedDate: string;
  deadline: string;
  driveLink: string;
}

export function normalizePartnerName(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function validateDateOnly(value: unknown, fieldName: string): string {
  const text = String(value || "").trim();
  if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new Error(`${fieldName} must use YYYY-MM-DD format.`);
  if (text) {
    const date = new Date(text + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text)
      throw new Error(`${fieldName} is not a real calendar date.`);
  }
  return text;
}

export function validateCourseStatus(value: unknown): CourseStatus {
  const status = String(value || "In Queue").trim();
  if (!COURSE_STATUSES.includes(status as CourseStatus))
    throw new Error("Invalid status value.");
  return status as CourseStatus;
}

export function validateDriveLink(value: unknown): string {
  const link = String(value || "").trim();
  if (!link) return "";
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Drive Link must be a valid HTTPS Google Drive or Google Docs URL.");
  }
  if (
    url.protocol !== "https:" ||
    !["drive.google.com", "docs.google.com"].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password
  )
    throw new Error("Drive Link must be an HTTPS Google Drive or Google Docs URL.");
  return url.toString();
}

export function validateCourseMetadata(value: Partial<CourseMetadata>): CourseMetadata {
  const partner = String(value.partner || "").trim();
  if (!partner) throw new Error("Partner name is required.");
  const owner = String(value.owner || "").trim().slice(0, 300);
  return {
    partner: partner.slice(0, 300),
    owner,
    status: validateCourseStatus(value.status),
    assignedDate: validateDateOnly(value.assignedDate, "Assigned Date"),
    deadline: validateDateOnly(value.deadline, "Deadline"),
    driveLink: validateDriveLink(value.driveLink),
  };
}

export function normalizeFileName(fileName: unknown, removeDownloadSuffix = false): string {
  const name = String(fileName || "").trim().replace(/\s+/g, " ");
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : "";
  let stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  if (removeDownloadSuffix) {
    let previous = "";
    do {
      previous = stem;
      stem = stem.replace(/\s*\(\d+\)\s*$/, "").trim();
    } while (stem !== previous);
  }
  return (stem + extension).toLowerCase();
}

export function canonicalDisplayFileName(fileName: unknown): string {
  const name = String(fileName || "").trim().replace(/\s+/g, " ");
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  let stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  let previous = "";
  do {
    previous = stem;
    stem = stem.replace(/\s*\(\d+\)\s*$/, "").trim();
  } while (stem !== previous);
  return stem + extension;
}

export function packageMatchKey(fileName: unknown): string {
  let name = String(fileName || "").trim().toLowerCase();
  name = name.replace(/\.(imscc|zip|xml|xlsx)$/, "").trim();
  let previous = "";
  do {
    previous = name;
    name = name.replace(/\s*\(\d+\)\s*$/, "").trim();
  } while (name !== previous);
  name = name
    .replace(/\s*-?\s*(dev|development)\s*\(nce\)?\s*(-?\s*clxt)?/g, "")
    .trim();
  name = name.replace(/b0rl/g, "borl");
  return name.replace(/[\s-]/g, "");
}

export function packageSemanticKey(fileName: unknown): string {
  const key = packageMatchKey(fileName);
  return key && key.length >= 3 ? key : normalizeFileName(fileName, true);
}

function timestamp(value: unknown, fallback = 0): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function comparable(value: unknown): string {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").toLowerCase();
}

function scanFingerprint(record: WorkspaceRecord): string {
  const scan = record.data.scan || {};
  const stats = scan.stats || {};
  return JSON.stringify([
    scan.fileSha256 || "",
    scan.moduleCount || 0,
    stats.webcontent || 0,
    stats.quizzes || 0,
    stats.assignments || 0,
    stats.discussions || 0,
    stats.weblinks || 0,
    stats.lti || 0,
    stats.unknown || 0,
    stats.emptyFolders || 0,
  ]);
}

export interface DuplicateGroup {
  id: string;
  partner: string;
  semanticKey: string;
  canonicalName: string;
  survivor: WorkspaceRecord;
  latestScan: WorkspaceRecord;
  duplicates: WorkspaceRecord[];
  conflictFields: string[];
  scanDataDiffers: boolean;
  safeToArchive: boolean;
}

export interface DuplicatePlan {
  groups: DuplicateGroup[];
  duplicateEntryCount: number;
  safeGroupCount: number;
  planToken: string;
}

export function buildDuplicatePlan(records: WorkspaceRecord[]): DuplicatePlan {
  const grouped = new Map<string, WorkspaceRecord[]>();
  for (const record of records) {
    if (record.kind !== "package" || record.data.archived === true) continue;
    const partner = normalizePartnerName(record.data.partner);
    const semantic = packageSemanticKey(record.data.scan?.fileName || record.title);
    if (!partner || !semantic) continue;
    const key = partner + "\u0000" + semantic;
    const rows = grouped.get(key) || [];
    rows.push(record);
    grouped.set(key, rows);
  }

  const groups: DuplicateGroup[] = [];
  for (const [groupKey, rows] of grouped) {
    if (rows.length < 2) continue;
    const unsuffixed = rows.filter(
      (record) =>
        normalizeFileName(record.data.scan?.fileName || record.title, false) ===
        normalizeFileName(
          canonicalDisplayFileName(record.data.scan?.fileName || record.title),
          false,
        ),
    );
    const candidates = unsuffixed.length ? unsuffixed : rows;
    const survivor = candidates
      .slice()
      .sort(
        (a, b) =>
          timestamp(a.updatedAt, a.version) - timestamp(b.updatedAt, b.version) ||
          a.id.localeCompare(b.id),
      )[0];
    const latestScan = rows
      .slice()
      .sort(
        (a, b) =>
          timestamp(b.data.scan?.scannedAt || b.updatedAt, b.version) -
            timestamp(a.data.scan?.scannedAt || a.updatedAt, a.version) ||
          b.version - a.version,
      )[0];

    const metadataFields: Array<[keyof CourseMetadata, string]> = [
      ["assignedDate", "Assigned Date"],
      ["owner", "Owner"],
      ["deadline", "Deadline"],
      ["status", "Status"],
      ["driveLink", "Drive Link"],
    ];
    const conflictFields = metadataFields
      .filter(([field]) => {
        const values = new Set(
          rows
            .map((record) => record.data[field])
            .filter((value) => String(value || "").trim())
            .map(comparable),
        );
        return values.size > 1;
      })
      .map(([, label]) => label);
    const id = groupKey.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 100);
    groups.push({
      id,
      partner: String(survivor.data.partner || ""),
      semanticKey: packageSemanticKey(survivor.data.scan?.fileName || survivor.title),
      canonicalName: canonicalDisplayFileName(survivor.data.scan?.fileName || survivor.title),
      survivor,
      latestScan,
      duplicates: rows.filter((record) => record.id !== survivor.id),
      conflictFields,
      scanDataDiffers: new Set(rows.map(scanFingerprint)).size > 1,
      safeToArchive: conflictFields.length === 0,
    });
  }
  groups.sort(
    (a, b) =>
      a.partner.localeCompare(b.partner) ||
      a.canonicalName.localeCompare(b.canonicalName),
  );
  const planToken = groups
    .map(
      (group) =>
        group.id +
        ":" +
        [group.survivor, ...group.duplicates]
          .map((record) => record.id + "@" + record.version)
          .sort()
          .join(","),
    )
    .join("|");
  return {
    groups,
    planToken,
    duplicateEntryCount: groups.reduce((sum, group) => sum + group.duplicates.length, 0),
    safeGroupCount: groups.filter((group) => group.safeToArchive).length,
  };
}

export function mergeDuplicateGroup(group: DuplicateGroup): {
  survivor: WorkspaceRecord;
  archived: WorkspaceRecord[];
} {
  if (!group.safeToArchive)
    throw new Error(
      "Metadata conflicts must be resolved before this duplicate group can be archived.",
    );
  const all = [group.survivor, ...group.duplicates];
  const metadata = { ...group.survivor.data };
  for (const field of ["assignedDate", "owner", "deadline", "status", "driveLink"] as const) {
    if (String(metadata[field] || "").trim()) continue;
    const source = all.find((record) => String(record.data[field] || "").trim());
    if (source) metadata[field] = source.data[field];
  }
  const survivor: WorkspaceRecord = {
    ...group.survivor,
    data: {
      ...metadata,
      scan: group.latestScan.data.scan,
      duplicateReconciliation: {
        reconciledAt: new Date().toISOString(),
        archivedIds: group.duplicates.map((record) => record.id),
        latestScanSourceId: group.latestScan.id,
      },
    },
  };
  const archived = group.duplicates.map((record) => ({
    ...record,
    data: {
      ...record.data,
      archived: true,
      archivedReason: "SEMANTIC_DUPLICATE",
      archivedAt: new Date().toISOString(),
      duplicateSurvivorId: group.survivor.id,
    },
  }));
  return { survivor, archived };
}

export interface PreflightResult {
  verdict: "BLOCKED" | "CLEARED TO INGEST";
  totalItems: number;
  coreEmptyCount: number;
  ltiItems: number;
  message: string;
}

export function deterministicPreflight(scan: PackageScan): PreflightResult {
  const totalItems = Math.max(0, Number(scan.stats?.totalItems || 0));
  const coreEmptyCount = Math.max(0, Number(scan.stats?.coreEmptyCount || 0));
  const ltiItems = Math.max(0, Number(scan.stats?.lti || 0));
  const blocked = totalItems === 0 || coreEmptyCount > 0 || ltiItems > 50;
  if (blocked) {
    const reasons: string[] = [];
    if (totalItems === 0) reasons.push("the package has no valid content items");
    if (coreEmptyCount > 0)
      reasons.push(`${coreEmptyCount} non-administrative empty folder(s) were found`);
    if (ltiItems > 50) reasons.push(`${ltiItems} LTI items exceed the limit of 50`);
    return {
      verdict: "BLOCKED",
      totalItems,
      coreEmptyCount,
      ltiItems,
      message: "Blocked because " + reasons.join("; ") + ".",
    };
  }
  return {
    verdict: "CLEARED TO INGEST",
    totalItems,
    coreEmptyCount,
    ltiItems,
    message:
      `Cleared by deterministic checks: ${totalItems} valid item(s), ${coreEmptyCount} core empty folder(s), and ${ltiItems} LTI item(s).`,
  };
}

function assignmentTool(typeValue: unknown): string {
  const type = String(typeValue || "unknown").toLowerCase();
  if (type.includes("imsqti")) return "Assessment";
  if (type.includes("assignment")) return "Assignment";
  if (type.includes("imsdt")) return "Discussion";
  if (type.includes("imsbasiclti")) return "LTI";
  if (type.includes("imswl")) return "URL";
  if (type === "plugin") return "Plugin";
  if (type === "folder") return "Module";
  return "Reading";
}

export function sourceManifestRows(scan: PackageScan): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ["Level", "Name", "Assignment_Tool", "System Format", "Ingestion Status"],
  ];
  const walk = (nodes: any[], level: number) => {
    for (const node of nodes || []) {
      const type = String(node?.type || "unknown");
      rows.push([
        level,
        String(node?.title || "Untitled Resource"),
        assignmentTool(type),
        type,
        node?.autoDeleted ? "Auto-Deleted" : "Included",
      ]);
      if (Array.isArray(node?.children) && node.children.length)
        walk(node.children, level + 1);
    }
  };
  walk(scan.courseTree as any[], 1);
  return rows;
}

export function sourceManifestBook(scan: PackageScan): BookData {
  return {
    name:
      String(scan.fileName || "Course").replace(/\.[^/.]+$/, "").slice(0, 80) +
      " - Master Manifest.xlsx",
    sheets: { Manifest: { values: sourceManifestRows(scan) } },
  };
}

export interface ArchitectureDiagnostics {
  nodeCount: number;
  maxDepth: number;
  typeCounts: Record<string, number>;
  topLevelModules: Array<{ title: string; descendants: number }>;
  repeatedTitlePatterns: Array<{ pattern: string; count: number }>;
  advanced: EvidenceObject;
  note: string;
}

export function deepArchitectureDiagnostics(scan: PackageScan): ArchitectureDiagnostics {
  const typeCounts: Record<string, number> = {};
  const titleCounts: Record<string, number> = {};
  const topLevelModules: Array<{ title: string; descendants: number }> = [];
  let nodeCount = 0;
  let maxDepth = 0;
  const descendants = (node: any): number =>
    (node?.children || []).reduce(
      (sum: number, child: any) => sum + 1 + descendants(child),
      0,
    );
  const walk = (nodes: any[], depth: number) => {
    maxDepth = Math.max(maxDepth, depth);
    for (const node of nodes || []) {
      nodeCount++;
      const title = String(node?.title || "Untitled");
      const type = String(node?.type || "unknown");
      typeCounts[type] = (typeCounts[type] || 0) + 1;
      const key = title
        .toLowerCase()
        .replace(/\d+/g, "#")
        .replace(/[^a-z#]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (key) titleCounts[key] = (titleCounts[key] || 0) + 1;
      if (depth === 1 && type === "folder")
        topLevelModules.push({ title, descendants: descendants(node) });
      walk(node?.children || [], depth + 1);
    }
  };
  walk(scan.courseTree as any[], 1);
  return {
    nodeCount,
    maxDepth,
    typeCounts,
    topLevelModules,
    repeatedTitlePatterns: Object.keys(titleCounts)
      .filter((key) => titleCounts[key] > 1)
      .sort((a, b) => titleCounts[b] - titleCounts[a])
      .slice(0, 20)
      .map((pattern) => ({ pattern, count: titleCounts[pattern] })),
    advanced: {
      orphans: scan.stats?.orphans || 0,
      lexicalTTR: scan.stats?.lexicalTTR || 0,
      lexicalTokenCount: scan.stats?.lexicalTokenCount || 0,
      lexicalContextReliable: scan.stats?.lexicalContextReliable === true,
      repeatedTitleRatio: scan.stats?.repeatedTitleRatio || 0,
      zScoreImbalances: scan.stats?.zScoreImbalances || [],
      interactiveRuntimeCandidates: scan.stats?.interactiveRuntimeCandidates || 0,
      scormLikeCandidates: scan.stats?.scormLikeCandidates || 0,
      practiceJsonDependencies: scan.stats?.practiceJsonDependencies || 0,
    },
    note:
      "These are deterministic diagnostics. Orphans, lexical diversity, module imbalance and workload scores do not by themselves prove ingestion failure.",
  };
}

export type WorkScope = "ACTIVE" | "EXCLUDED";
export type CourseraRedoState =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "DONE"
  | "NOT_REQUIRED"
  | "BLOCKED";
export type OutlineState = "NOT_STARTED" | "DRAFT" | "SECURED" | "BLOCKED";
export type AuditState = "NOT_STARTED" | "PASS" | "REVIEW" | "BLOCKED";
export type ContentMapState = "NOT_STARTED" | "IN_PROGRESS" | "DONE" | "BLOCKED";

export interface WorkState {
  scope: WorkScope;
  courseraRedo: CourseraRedoState;
  courseOutline: OutlineState;
  sourceAudit: AuditState;
  specializationOutline: OutlineState;
  contentMap: ContentMapState;
  notes: string;
}

export function defaultWorkState(): WorkState {
  return {
    scope: "ACTIVE",
    courseraRedo: "NOT_STARTED",
    courseOutline: "NOT_STARTED",
    sourceAudit: "NOT_STARTED",
    specializationOutline: "NOT_STARTED",
    contentMap: "NOT_STARTED",
    notes: "",
  };
}

const WORK_ALLOWED = {
  scope: ["ACTIVE", "EXCLUDED"],
  courseraRedo: ["NOT_STARTED", "IN_PROGRESS", "DONE", "NOT_REQUIRED", "BLOCKED"],
  courseOutline: ["NOT_STARTED", "DRAFT", "SECURED", "BLOCKED"],
  sourceAudit: ["NOT_STARTED", "PASS", "REVIEW", "BLOCKED"],
  specializationOutline: ["NOT_STARTED", "DRAFT", "SECURED", "BLOCKED"],
  contentMap: ["NOT_STARTED", "IN_PROGRESS", "DONE", "BLOCKED"],
} as const;

export function normalizeWorkState(value: any): WorkState {
  const base = defaultWorkState();
  const out: any = { ...base };
  for (const field of Object.keys(WORK_ALLOWED) as Array<keyof typeof WORK_ALLOWED>) {
    const candidate = String(value?.[field] || base[field]);
    if (!(WORK_ALLOWED[field] as readonly string[]).includes(candidate))
      throw new Error("Invalid work-state value for " + field + ".");
    out[field] = candidate;
  }
  out.notes = String(value?.notes || "").slice(0, 4000);
  return out as WorkState;
}

export interface WorkNextAction {
  code: string;
  label: string;
  tone: "muted" | "warning" | "danger" | "primary" | "success";
}

export interface WorkItemContext {
  catalogStatus?: string;
  ctiMatchStatus?: string;
  hasSource?: boolean;
  sourceRescanned?: boolean;
  existingCourseraShell?: boolean;
  rawQaFresh?: boolean;
  rawQaRecommendation?: { code?: string };
  hasRuntimeFlag?: boolean;
  productType?: string;
  plannerCategories?: string[];
}

export function nextWorkAction(item: WorkItemContext, stateValue: any): WorkNextAction {
  const state = normalizeWorkState(stateValue);
  if (state.scope === "EXCLUDED")
    return { code: "EXCLUDED", label: "Excluded from this redo campaign", tone: "muted" };
  if (item.catalogStatus === "AMBIGUOUS")
    return { code: "RESOLVE_CATALOG", label: "Resolve duplicate catalog assignment before work begins", tone: "warning" };
  if (item.ctiMatchStatus === "AMBIGUOUS")
    return { code: "RESOLVE_CTI_DUPLICATE", label: "Review duplicate CTI package records", tone: "warning" };
  if (item.hasSource === false)
    return { code: "UPLOAD_SOURCE", label: "Upload the source IMSCC package", tone: "danger" };
  if (!item.sourceRescanned)
    return { code: "RESCAN_SOURCE", label: "Re-scan source IMSCC with the current CTI parser", tone: "primary" };
  if (state.courseraRedo === "BLOCKED")
    return { code: "COURSERA_BLOCKED", label: "Resolve Coursera reimport blocker", tone: "danger" };
  if (
    state.courseraRedo !== "DONE" &&
    state.courseraRedo !== "NOT_REQUIRED" &&
    item.existingCourseraShell
  ) {
    if (!item.rawQaFresh)
      return {
        code: "AUDIT_EXISTING_RAW",
        label: "Audit the existing Coursera shell against the refreshed source before re-ingesting",
        tone: "warning",
      };
    const rec = item.rawQaRecommendation?.code || "NONE";
    if (rec === "KEEP")
      return item.hasRuntimeFlag
        ? {
            code: "REVIEW_SCORM_EXISTING",
            label: "Verify flagged runtime/interactivity manually before keeping the existing shell",
            tone: "warning",
          }
        : {
            code: "CONFIRM_KEEP_EXISTING",
            label: "Evidence supports the existing raw shell — mark reimport Not required to proceed",
            tone: "success",
          };
    if (rec === "REVIEW")
      return { code: "REVIEW_EXISTING_RAW", label: "Review existing raw-shell QA findings before deciding whether to re-ingest", tone: "warning" };
    if (rec === "REINGEST")
      return { code: "REDO_COURSERA", label: "Re-run Smart Ingestion; current evidence found material fidelity issues", tone: "danger" };
  }
  if (state.courseraRedo !== "DONE" && state.courseraRedo !== "NOT_REQUIRED")
    return { code: "REDO_COURSERA", label: "Redo Smart Ingestion in Coursera", tone: "primary" };
  if (state.courseOutline === "BLOCKED")
    return { code: "OUTLINE_BLOCKED", label: "Resolve course-outline blocker", tone: "danger" };
  if (state.courseOutline === "NOT_STARTED")
    return { code: "BUILD_COURSE_OUTLINE", label: "Create the course outline", tone: "primary" };
  if (state.courseOutline === "DRAFT" && state.sourceAudit !== "PASS")
    return { code: "AUDIT_SOURCE", label: "Audit the course outline against the source LMS", tone: "warning" };
  if (state.sourceAudit === "BLOCKED" || state.sourceAudit === "REVIEW")
    return { code: "AUDIT_REVIEW", label: "Resolve source-LMS audit findings", tone: "warning" };
  if (state.sourceAudit === "PASS" && state.courseOutline !== "SECURED")
    return { code: "SECURE_COURSE_OUTLINE", label: "Secure/finalize the audited course outline", tone: "primary" };

  const needsSpecialization =
    String(item.productType || "").toLowerCase().includes("specialization") ||
    (item.plannerCategories || []).some((category) =>
      String(category || "").toLowerCase().includes("course-to-specialization"),
    );
  if (needsSpecialization) {
    if (state.specializationOutline === "BLOCKED")
      return { code: "SPEC_OUTLINE_BLOCKED", label: "Resolve specialization-outline blocker", tone: "danger" };
    if (state.specializationOutline === "NOT_STARTED")
      return { code: "BUILD_SPEC_OUTLINE", label: "Create the specialization outline", tone: "primary" };
    if (state.specializationOutline === "DRAFT")
      return { code: "SECURE_SPEC_OUTLINE", label: "Review and secure the specialization outline", tone: "warning" };
    if (state.contentMap === "BLOCKED")
      return { code: "CONTENT_MAP_BLOCKED", label: "Resolve content-map blocker", tone: "danger" };
    if (state.contentMap !== "DONE")
      return { code: "BUILD_CONTENT_MAP", label: "Create/finalize the content map", tone: "primary" };
  }
  return { code: "COMPLETE", label: "Redo workflow complete", tone: "success" };
}

function normalizeHeader(value: unknown): string {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function headerIndex(headers: unknown[], names: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const name of names) {
    const index = normalized.indexOf(normalizeHeader(name));
    if (index >= 0) return index;
  }
  return -1;
}

function firstSheet(book: BookData): any[][] {
  const name = Object.keys(book.sheets)[0];
  if (!name) throw new Error("Workbook has no sheets.");
  return book.sheets[name].values as any[][];
}

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

function displayCode(value: unknown): string {
  const text = String(value || "").trim();
  const match = text.match(/[A-Za-z]{2,8}\d{2,4}/);
  return match
    ? match[0].toUpperCase()
    : text.replace(/\.(imscc|zip|xml)$/i, "").trim();
}

export function importCatalogWorkbook(book: BookData, partner: string): CatalogRow[] {
  const data = firstSheet(book);
  if (data.length < 2) throw new Error("Catalog contains no title rows.");
  const headers = data[0] || [];
  const fileIdx = headerIndex(headers, ["Common Cartridge File Name"]);
  const codeIdx = headerIndex(headers, ["Title Code"]);
  const titleIdx = headerIndex(headers, ["Title"]);
  const ownerIdx = headerIndex(headers, ["Assignment Owner"]);
  const typeIdx = headerIndex(headers, ["Coursera Product Type"]);
  const brightIdx = headerIndex(headers, ["Brightspace Access"]);
  const ccIdx = headerIndex(headers, ["CC Package Access"]);
  const importIdx = headerIndex(headers, ["Import Status"]);
  if (titleIdx < 0 || (fileIdx < 0 && codeIdx < 0))
    throw new Error(
      "Catalog must contain Title plus Title Code or Common Cartridge File Name.",
    );
  const rows: CatalogRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const source = data[i] || [];
    const fileName = fileIdx >= 0 ? String(source[fileIdx] || "").trim() : "";
    const titleCode = codeIdx >= 0 ? String(source[codeIdx] || "").trim() : fileName;
    const title = String(source[titleIdx] || "").trim();
    if (!fileName && !titleCode && !title) continue;
    const code = displayCode(titleCode || fileName || title);
    const titleKey = packageMatchKey(titleCode || fileName || code || title);
    if (!titleKey) continue;
    rows.push({
      sourceRow: i + 1,
      partner,
      titleCode,
      displayCode: code,
      titleKey,
      title,
      productType: typeIdx >= 0 ? String(source[typeIdx] || "").trim() : "",
      owner: ownerIdx >= 0 ? String(source[ownerIdx] || "").trim() : "",
      brightspaceAccess: brightIdx >= 0 ? String(source[brightIdx] || "").trim() : "",
      ccPackageAccess: ccIdx >= 0 ? String(source[ccIdx] || "").trim() : "",
      importStatus: importIdx >= 0 ? String(source[importIdx] || "").trim() : "",
      expectedFileName:
        fileName && /\.imscc$/i.test(fileName)
          ? fileName
          : fileName
            ? fileName + ".imscc"
            : code
              ? code + ".imscc"
              : "",
    });
  }
  return rows;
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

function workbookDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(epoch);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
  }
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validateDateOnly(text, "Assignment Date");
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

export function importPlannerWorkbook(book: BookData): PlannerRow[] {
  const data = firstSheet(book);
  if (data.length < 2) throw new Error("Planner contains no assignment rows.");
  const headers = data[0] || [];
  const dateIdx = headerIndex(headers, ["Assignment Date [mm/dd/yyyy]", "Assignment Date"]);
  const partnerIdx = headerIndex(headers, ["Partner"]);
  const methodIdx = headerIndex(headers, ["Content Ingestion Method"]);
  const categoryIdx = headerIndex(headers, ["Assignment Category"]);
  const subCategoryIdx = headerIndex(headers, ["Assignment Sub-Category"]);
  const ownerIdx = headerIndex(headers, ["Assignment Owner"]);
  const totalIdx = headerIndex(headers, ["Total Title Count"]);
  const statusIdx = headerIndex(headers, ["Status"]);
  const remarksIdx = headerIndex(headers, ["Assignment Owner Remarks"]);
  if (dateIdx < 0 || partnerIdx < 0 || ownerIdx < 0)
    throw new Error("Planner must contain Assignment Date, Partner and Assignment Owner.");
  const rows: PlannerRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const source = data[i] || [];
    const assignmentDate = workbookDate(source[dateIdx]);
    const partner = String(source[partnerIdx] || "").trim();
    const owner = String(source[ownerIdx] || "").trim();
    if (!assignmentDate || !partner || !owner) continue;
    rows.push({
      sourceRow: i + 1,
      assignmentDate,
      partner,
      method: methodIdx >= 0 ? String(source[methodIdx] || "").trim() : "",
      category: categoryIdx >= 0 ? String(source[categoryIdx] || "").trim() : "",
      subCategory: subCategoryIdx >= 0 ? String(source[subCategoryIdx] || "").trim() : "",
      owner,
      totalTitleCount:
        totalIdx >= 0 ? Math.max(0, Math.trunc(Number(source[totalIdx]) || 0)) : 0,
      status: statusIdx >= 0 ? String(source[statusIdx] || "").trim() : "",
      remarks: remarksIdx >= 0 ? String(source[remarksIdx] || "") : "",
    });
  }
  return rows;
}

export interface RuntimeInventoryRow {
  courseCode: string;
  titleKey: string;
  title: string;
  riseCount: number;
  storylineCount: number;
  linkLabel: string;
}

function runtimeCount(value: unknown): number {
  const text = String(value == null ? "" : value).trim();
  if (!text || /^n\/?a$/i.test(text) || /^none$/i.test(text) || /^no$/i.test(text))
    return 0;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : 1;
}

export function importRuntimeWorkbook(book: BookData): RuntimeInventoryRow[] {
  const data = firstSheet(book);
  if (!data.length) return [];
  const headers = data[0] || [];
  const codeIdx = headerIndex(headers, ["Coursecode", "Course Code"]);
  const titleIdx = headerIndex(headers, ["Course Title", "Title"]);
  const riseIdx = headerIndex(headers, ["RISE"]);
  const storylineIdx = headerIndex(headers, ["Storyline"]);
  const linkIdx = headerIndex(headers, ["Link"]);
  if (codeIdx < 0 && titleIdx < 0)
    throw new Error("Runtime inventory needs Course Code or Course Title.");
  const rows: RuntimeInventoryRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const source = data[i] || [];
    const courseCode = codeIdx >= 0 ? String(source[codeIdx] || "").trim() : "";
    const title = titleIdx >= 0 ? String(source[titleIdx] || "").trim() : "";
    if (!courseCode && !title) continue;
    rows.push({
      courseCode,
      titleKey: packageMatchKey(courseCode || title),
      title,
      riseCount: riseIdx >= 0 ? runtimeCount(source[riseIdx]) : 0,
      storylineCount: storylineIdx >= 0 ? runtimeCount(source[storylineIdx]) : 0,
      linkLabel: linkIdx >= 0 ? String(source[linkIdx] || "").trim() : "",
    });
  }
  return rows;
}

export interface SystemHealth {
  status: "PASS" | "WARN" | "FAIL";
  checks: Array<{ name: string; status: "PASS" | "WARN" | "FAIL"; detail: string }>;
}

export function systemHealth(records: WorkspaceRecord[]): SystemHealth {
  const checks: SystemHealth["checks"] = [];
  const packages = records.filter((record) => record.kind === "package" && record.data.archived !== true);
  const audits = records.filter((record) => record.kind === "audit");
  const recoveries = records.filter(
    (record) =>
      record.kind === "legacy-backup" &&
      record.data.kind === "CTI_MIGRATION_RECOVERY_CASE",
  );
  const duplicatePlan = buildDuplicatePlan(records);
  checks.push({
    name: "Package records",
    status: packages.length ? "PASS" : "WARN",
    detail: packages.length + " active source package(s).",
  });
  checks.push({
    name: "Saved QA evidence",
    status: audits.length ? "PASS" : "WARN",
    detail: audits.length + " immutable audit snapshot(s).",
  });
  checks.push({
    name: "Migration recovery",
    status: recoveries.length ? "WARN" : "PASS",
    detail: recoveries.length
      ? recoveries.length + " migrated report(s) still require recovery."
      : "No unresolved migrated report payloads are recorded.",
  });
  checks.push({
    name: "Semantic duplicate guard",
    status: duplicatePlan.groups.length ? "WARN" : "PASS",
    detail: duplicatePlan.groups.length
      ? duplicatePlan.groups.length + " duplicate package group(s) require review."
      : "No active semantic duplicate package groups detected.",
  });
  const invalidPackages = packages.filter((record) => {
    try {
      validateCourseMetadata(record.data as CourseMetadata);
      return false;
    } catch {
      return true;
    }
  });
  checks.push({
    name: "Course metadata contract",
    status: invalidPackages.length ? "FAIL" : "PASS",
    detail: invalidPackages.length
      ? invalidPackages.length + " active package(s) violate the current metadata contract."
      : "Active package metadata passes current validation.",
  });
  const failed = checks.some((check) => check.status === "FAIL");
  const warned = checks.some((check) => check.status === "WARN");
  return { status: failed ? "FAIL" : warned ? "WARN" : "PASS", checks };
}

export function partnerAnalytics(records: WorkspaceRecord[]) {
  const duplicatePlan = buildDuplicatePlan(records);
  const partners: Record<string, any> = {};
  const owners = new Set<string>();
  for (const record of records) {
    if (record.kind !== "package" || record.data.archived === true) continue;
    const partner = String(record.data.partner || "Unassigned");
    const stats = record.data.scan?.stats || {};
    const target =
      partners[partner] ||
      (partners[partner] = {
        packageCount: 0,
        totalModules: 0,
        totalWebContent: 0,
        totalAssessments: 0,
        totalDiscussions: 0,
        totalWebLinks: 0,
        totalLtiRisk: 0,
        totalUnknown: 0,
        totalEmpty: 0,
        totalIFS: 0,
        avgIFS: 0,
      });
    target.packageCount++;
    target.totalModules += Number(record.data.scan?.moduleCount || 0);
    target.totalWebContent += Number(stats.webcontent || 0);
    target.totalAssessments += Number(stats.quizzes || 0) + Number(stats.assignments || 0);
    target.totalDiscussions += Number(stats.discussions || 0);
    target.totalWebLinks += Number(stats.weblinks || 0);
    target.totalLtiRisk += Number(stats.lti || 0);
    target.totalUnknown += Number(stats.unknown || 0);
    target.totalEmpty += Number(stats.emptyFolders || 0);
    target.totalIFS += Number(stats.ifs || 0);
    if (record.data.owner) owners.add(String(record.data.owner));
  }
  for (const value of Object.values(partners) as any[])
    value.avgIFS = value.packageCount ? Math.round(value.totalIFS / value.packageCount) : 0;
  return {
    partners,
    owners: [...owners].sort(),
    totalPackages: Object.values(partners).reduce(
      (sum: number, value: any) => sum + value.packageCount,
      0,
    ),
    duplicateSummary: {
      groupCount: duplicatePlan.groups.length,
      duplicateEntryCount: duplicatePlan.duplicateEntryCount,
      safeGroupCount: duplicatePlan.safeGroupCount,
    },
  };
}

export interface RepeatedExportRepairCandidate {
  runId: string;
  previousRunId: string;
  fromGeneration: number;
  toGeneration: number;
  reason: string;
}

function stableAuditSummary(record: WorkspaceRecord): string {
  const result = record.data.result || {};
  const summary = result.summary || {};
  const keys = [
    "observedFidelity",
    "evidenceCoverage",
    "ingestionFailures",
    "missing",
    "partial",
    "unverified",
    "behaviorMutations",
    "runtimeReviews",
  ];
  return JSON.stringify(keys.map((key) => Number(summary[key] || 0)));
}

export function repeatedExportRepairCandidates(
  audits: WorkspaceRecord[],
): RepeatedExportRepairCandidate[] {
  const rows = audits
    .filter((record) => record.kind === "audit")
    .slice()
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const out: RepeatedExportRepairCandidate[] = [];
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1];
    const current = rows[i];
    if (previous.packageId !== current.packageId) continue;
    const beforeGeneration = Number(previous.data.generation);
    const generation = Number(current.data.generation);
    const beforeMode = String(previous.data.result?.snapshotContext?.mode || "");
    const mode = String(current.data.result?.snapshotContext?.mode || "");
    if (
      mode !== "RAW_INGESTION" ||
      beforeMode !== "RAW_INGESTION" ||
      generation !== beforeGeneration + 1 ||
      stableAuditSummary(previous) !== stableAuditSummary(current) ||
      !previous.data.hashes?.excel ||
      !current.data.hashes?.excel ||
      previous.data.hashes.excel === current.data.hashes.excel ||
      (previous.data.sourceScanSha256 &&
        current.data.sourceScanSha256 &&
        previous.data.sourceScanSha256 !== current.data.sourceScanSha256)
    )
      continue;
    const priorItems = previous.data.result?.itemResults;
    const currentItems = current.data.result?.itemResults;
    if (!Array.isArray(priorItems) || !Array.isArray(currentItems)) continue;
    const signature = (items: any[]) =>
      JSON.stringify(
        items.map((item) => [
          item.sourceId || item.sourceName,
          item.verdict,
          item.courseraId,
          item.checks,
        ]),
      );
    if (signature(priorItems) !== signature(currentItems)) continue;
    out.push({
      runId: current.id,
      previousRunId: previous.id,
      fromGeneration: generation,
      toGeneration: beforeGeneration,
      reason:
        "Two consecutive raw snapshots have different XLSX hashes but identical full item evidence and summary metrics. This is only a repair candidate; confirm that no Smart Ingestion reimport occurred.",
    });
  }
  return out;
}

export function applyLineageRepairs(
  audits: WorkspaceRecord[],
  operations: WorkspaceRecord[],
): WorkspaceRecord[] {
  const repairs = new Map<string, number>();
  for (const record of operations) {
    if (
      record.kind === "operations" &&
      record.data.type === "lineage-repair" &&
      typeof record.data.runId === "string" &&
      Number.isInteger(record.data.toGeneration)
    )
      repairs.set(record.data.runId, record.data.toGeneration);
  }
  return audits.map((record) =>
    repairs.has(record.id)
      ? {
          ...record,
          data: {
            ...record.data,
            generation: repairs.get(record.id),
            lineageRepair: {
              applied: true,
              sourceRecordId: operations.find(
                (op) => op.kind === "operations" && op.data.runId === record.id,
              )?.id,
            },
          },
        }
      : record,
  );
}


export interface PortableWorkQueueItem {
  titleKey: string;
  displayCode: string;
  title: string;
  productType: string;
  owner: string;
  catalogOwner: string;
  catalogStatus: "MATCH" | "MISSING" | "AMBIGUOUS";
  catalogCandidateCount: number;
  plannerLatestDate: string;
  plannerCategories: string[];
  expectedFileName: string;
  ctiMatchStatus: "MATCH" | "MISSING" | "AMBIGUOUS";
  ctiCandidateCount: number;
  ctiUuid: string;
  sourceRescanned: boolean;
  rawQaFresh: boolean;
  rawQaRecommendation: { code: string; label: string; tone: string };
  existingCourseraShell: boolean;
  runtime: RuntimeInventoryRow | null;
  state: WorkState;
  nextAction: WorkNextAction;
}

export interface PortableWorkQueue {
  items: PortableWorkQueueItem[];
  unresolvedGroups: Array<{
    assignmentDate: string;
    owner: string;
    expectedTitleAssignments: number;
    parsedTitleCount: number;
    unresolvedTitleCount: number;
  }>;
  summary: Record<string, number>;
}

function ownerKey(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[.\s]+/g, " ").trim();
}

function extractCatalogKeys(text: unknown, byKey: Map<string, CatalogRow[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const source = String(text || "");
  const regex = /\b[A-Za-z]{2,8}\d{2,4}\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const key = packageMatchKey(match[0]);
    if (!key || !byKey.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function resolveCatalogCandidate(
  candidates: CatalogRow[],
  plannerOwner: string,
): { status: "MATCH" | "MISSING" | "AMBIGUOUS"; row: CatalogRow | null } {
  if (!candidates.length) return { status: "MISSING", row: null };
  if (candidates.length === 1) return { status: "MATCH", row: candidates[0] };
  const key = ownerKey(plannerOwner);
  const ownerMatches = candidates.filter(
    (row) => key && ownerKey(row.owner) === key,
  );
  if (ownerMatches.length === 1)
    return { status: "MATCH", row: ownerMatches[0] };
  const completeMatches = candidates.filter(
    (row) =>
      String(row.ccPackageAccess || "").toLowerCase() === "complete" &&
      String(row.importStatus || "").toLowerCase() !== "pending",
  );
  if (!key && completeMatches.length === 1)
    return { status: "MATCH", row: completeMatches[0] };
  return { status: "AMBIGUOUS", row: null };
}

function rawQaRecommendation(audit: WorkspaceRecord | null) {
  if (!audit)
    return {
      code: "NONE",
      label: "No raw-ingestion audit has been run",
      tone: "muted",
    };
  const result = audit.data.result || {};
  const summary = result.summary || {};
  const policy = result.operationalPolicy || summary.operationalPolicy || null;
  if (policy?.recommendationCode) {
    const code = String(policy.recommendationCode);
    return {
      code,
      label:
        String(policy.recommendationLabel || "") ||
        (code === "KEEP"
          ? "Keep existing raw shell"
          : code === "REINGEST"
            ? "Re-ingest recommended"
            : "Review existing raw shell"),
      tone: code === "KEEP" ? "success" : code === "REINGEST" ? "danger" : "warning",
    };
  }
  const critical = Number(summary.ownerCritical || 0);
  const missing = Number(summary.missing || 0);
  const mutations = Number(summary.mutations || 0);
  const partial = Number(summary.partial || 0);
  const unverified = Number(summary.unverified || 0);
  const review = Number(summary.ownerReview || 0);
  const evidenceOnly = Number(summary.ownerEvidence || 0);
  const extras = Number(summary.extraCourseraItems || 0);
  const moved = Number(summary.moved || 0);
  const stateMutations = Number(summary.stateMutations || 0);
  const exclusions = Number(summary.intentionalExclusions || 0);
  const fidelity =
    result.sourceFidelity == null
      ? Number(summary.observedFidelity || 0)
      : Number(result.sourceFidelity || 0);
  const coverage = Number(summary.evidenceCoverage || 0);
  if (critical > 0 || missing > 0)
    return {
      code: "REINGEST",
      label: "Material source-fidelity issues found — re-ingest recommended",
      tone: "danger",
    };
  if (
    mutations > 0 ||
    partial > 0 ||
    unverified > 0 ||
    review > 0 ||
    evidenceOnly > 0 ||
    extras > 0 ||
    moved > 0 ||
    stateMutations > 0 ||
    exclusions > 0 ||
    coverage < 80 ||
    fidelity < 95
  )
    return {
      code: "REVIEW",
      label: "Existing raw shell needs review before deciding whether to re-ingest",
      tone: "warning",
    };
  return {
    code: "KEEP",
    label: "Existing raw shell is strongly supported by CTI evidence",
    tone: "success",
  };
}

export function buildPortableWorkQueue(args: {
  records: WorkspaceRecord[];
  catalog: CatalogRow[];
  planner: PlannerRow[];
  runtime: RuntimeInventoryRow[];
  partner: string;
  fromDate: string;
  toDate: string;
  scanAfter: string;
  ownerFilter?: string;
}): PortableWorkQueue {
  const partnerKey = normalizePartnerName(args.partner);
  const fromDate = validateDateOnly(args.fromDate, "From date");
  const toDate = validateDateOnly(args.toDate, "To date");
  const scanAfter = validateDateOnly(args.scanAfter, "Redo scan cutoff");
  if (!fromDate || !toDate || toDate < fromDate)
    throw new Error("To date must be on or after From date.");
  if (!scanAfter) throw new Error("Redo scan cutoff is required.");

  const catalog = args.catalog.filter(
    (row) => normalizePartnerName(row.partner) === partnerKey,
  );
  const byKey = new Map<string, CatalogRow[]>();
  for (const row of catalog) {
    const rows = byKey.get(row.titleKey) || [];
    rows.push(row);
    byKey.set(row.titleKey, rows);
  }

  const groups = new Map<
    string,
    {
      assignmentDate: string;
      owner: string;
      expectedTitleAssignments: number;
      codes: Set<string>;
      categories: Set<string>;
    }
  >();
  for (const row of args.planner) {
    if (
      normalizePartnerName(row.partner) !== partnerKey ||
      row.assignmentDate < fromDate ||
      row.assignmentDate > toDate ||
      (row.method &&
        !row.method.toLowerCase().includes("smart ingestion"))
    )
      continue;
    const key = row.assignmentDate + "|" + ownerKey(row.owner);
    const group =
      groups.get(key) ||
      {
        assignmentDate: row.assignmentDate,
        owner: row.owner || "Unassigned",
        expectedTitleAssignments: 0,
        codes: new Set<string>(),
        categories: new Set<string>(),
      };
    group.expectedTitleAssignments += Math.max(0, row.totalTitleCount || 0);
    if (row.category) group.categories.add(row.category);
    for (const code of extractCatalogKeys(row.remarks, byKey))
      group.codes.add(code);
    groups.set(key, group);
  }

  const titleEvidence = new Map<
    string,
    { owner: string; latestDate: string; categories: Set<string> }
  >();
  for (const group of groups.values()) {
    for (const key of group.codes) {
      const prior = titleEvidence.get(key);
      if (!prior || group.assignmentDate >= prior.latestDate)
        titleEvidence.set(key, {
          owner: group.owner,
          latestDate: group.assignmentDate,
          categories: new Set(group.categories),
        });
      else
        for (const category of group.categories) prior.categories.add(category);
    }
  }

  const packages = args.records.filter(
    (record) =>
      record.kind === "package" &&
      record.data.archived !== true &&
      normalizePartnerName(record.data.partner) === partnerKey,
  );
  const packagesByKey = new Map<string, WorkspaceRecord[]>();
  for (const record of packages) {
    const key = packageSemanticKey(record.data.scan?.fileName || record.title);
    const rows = packagesByKey.get(key) || [];
    rows.push(record);
    packagesByKey.set(key, rows);
  }
  const runtimeByKey = new Map(args.runtime.map((row) => [row.titleKey, row]));
  const audits = args.records.filter((record) => record.kind === "audit");
  const scanCutoff = Date.parse(scanAfter + "T00:00:00Z");
  const items: PortableWorkQueueItem[] = [];

  for (const [titleKey, evidence] of titleEvidence) {
    if (
      args.ownerFilter &&
      ownerKey(evidence.owner) !== ownerKey(args.ownerFilter)
    )
      continue;
    const candidates = byKey.get(titleKey) || [];
    const resolved = resolveCatalogCandidate(candidates, evidence.owner);
    const catalogRow =
      resolved.row ||
      ({
        displayCode: titleKey.toUpperCase(),
        title: "Catalog title unresolved",
        productType: "",
        owner: "",
        expectedFileName: titleKey.toUpperCase() + ".imscc",
        importStatus: "",
      } as CatalogRow);
    const matches = packagesByKey.get(titleKey) || [];
    const ctiMatchStatus: PortableWorkQueueItem["ctiMatchStatus"] =
      matches.length === 0
        ? "MISSING"
        : matches.length === 1
          ? "MATCH"
          : "AMBIGUOUS";
    const course = matches.length === 1 ? matches[0] : null;
    const scanTime = course
      ? Date.parse(String(course.data.scan?.scannedAt || course.updatedAt || ""))
      : NaN;
    const sourceRescanned = Number.isFinite(scanTime) && scanTime >= scanCutoff;
    const rawAudits = course
      ? audits
          .filter(
            (record) =>
              record.packageId === course.id &&
              record.data.result?.snapshotContext?.mode === "RAW_INGESTION",
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : [];
    const latestRaw = rawAudits[0] || null;
    const rawTime = latestRaw ? Date.parse(latestRaw.updatedAt) : NaN;
    const rawQaFresh =
      sourceRescanned &&
      Number.isFinite(rawTime) &&
      (!Number.isFinite(scanTime) || rawTime >= scanTime);
    const recommendation = rawQaFresh
      ? rawQaRecommendation(latestRaw)
      : {
          code: "NONE",
          label: "No fresh raw-ingestion audit after the current source scan",
          tone: "muted",
        };
    const categories = [...evidence.categories];
    const importOnly = categories.some(
      (category) => category.trim().toLowerCase() === "import only",
    );
    const importStatus = String(catalogRow.importStatus || "").trim().toLowerCase();
    const existingCourseraShell =
      importOnly &&
      ["complete", "completed", "imported"].includes(importStatus);
    const runtime = runtimeByKey.get(titleKey) || null;
    const stats = course?.data.scan?.stats || {};
    const hasRuntimeFlag =
      Number(runtime?.riseCount || 0) + Number(runtime?.storylineCount || 0) > 0 ||
      Number(stats.interactiveRuntimeCandidates || 0) > 0 ||
      Number(stats.scormLikeCandidates || 0) > 0 ||
      Number(stats.practiceJsonDependencies || 0) > 0;
    const state = course
      ? normalizeWorkState(course.data.workState || {})
      : defaultWorkState();
    const itemContext: WorkItemContext = {
      catalogStatus: resolved.status,
      ctiMatchStatus,
      hasSource: !!course,
      sourceRescanned,
      existingCourseraShell,
      rawQaFresh,
      rawQaRecommendation: recommendation,
      hasRuntimeFlag,
      productType: catalogRow.productType,
      plannerCategories: categories,
    };
    items.push({
      titleKey,
      displayCode: catalogRow.displayCode || displayCode(catalogRow.titleCode || titleKey),
      title: catalogRow.title || "",
      productType: catalogRow.productType || "",
      owner: evidence.owner || "Unassigned",
      catalogOwner: catalogRow.owner || "",
      catalogStatus: resolved.status,
      catalogCandidateCount: candidates.length,
      plannerLatestDate: evidence.latestDate,
      plannerCategories: categories,
      expectedFileName: catalogRow.expectedFileName || titleKey.toUpperCase() + ".imscc",
      ctiMatchStatus,
      ctiCandidateCount: matches.length,
      ctiUuid: course?.id || "",
      sourceRescanned,
      rawQaFresh,
      rawQaRecommendation: recommendation,
      existingCourseraShell,
      runtime,
      state,
      nextAction: nextWorkAction(itemContext, state),
    });
  }

  items.sort(
    (a, b) =>
      a.owner.localeCompare(b.owner) ||
      a.plannerLatestDate.localeCompare(b.plannerLatestDate) ||
      a.displayCode.localeCompare(b.displayCode),
  );
  const unresolvedGroups = [...groups.values()]
    .filter((group) => group.expectedTitleAssignments > group.codes.size)
    .map((group) => ({
      assignmentDate: group.assignmentDate,
      owner: group.owner,
      expectedTitleAssignments: group.expectedTitleAssignments,
      parsedTitleCount: group.codes.size,
      unresolvedTitleCount: Math.max(
        0,
        group.expectedTitleAssignments - group.codes.size,
      ),
    }));
  return {
    items,
    unresolvedGroups,
    summary: {
      confirmedTitles: items.length,
      needsUpload: items.filter((item) => item.nextAction.code === "UPLOAD_SOURCE").length,
      needsRescan: items.filter((item) => item.nextAction.code === "RESCAN_SOURCE").length,
      needsRawAudit: items.filter((item) => item.nextAction.code === "AUDIT_EXISTING_RAW").length,
      reingestRecommended: items.filter(
        (item) => item.rawQaFresh && item.rawQaRecommendation.code === "REINGEST",
      ).length,
      complete: items.filter((item) => item.nextAction.code === "COMPLETE").length,
      excluded: items.filter((item) => item.state.scope === "EXCLUDED").length,
      unresolvedPlannerSlots: unresolvedGroups.reduce(
        (sum, group) => sum + group.unresolvedTitleCount,
        0,
      ),
      plannerExpectedAssignments: [...groups.values()].reduce(
        (sum, group) => sum + group.expectedTitleAssignments,
        0,
      ),
    },
  };
}
