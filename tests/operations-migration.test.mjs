import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLineageRepairs,
  buildDuplicatePlan,
  buildPortableWorkQueue,
  canonicalDisplayFileName,
  deepArchitectureDiagnostics,
  deterministicPreflight,
  importCatalogWorkbook,
  importPlannerWorkbook,
  importRuntimeWorkbook,
  mergeDuplicateGroup,
  nextWorkAction,
  normalizeFileName,
  normalizeWorkState,
  packageMatchKey,
  packageSemanticKey,
  partnerAnalytics,
  repeatedExportRepairCandidates,
  sourceManifestRows,
  systemHealth,
  validateCourseMetadata,
  validateDateOnly,
  validateDriveLink,
} from "../src/domain/operations.ts";

const scan = (fileName = "BORL113.imscc", overrides = {}) => ({
  kind: "CTI_PACKAGE_SCAN",
  schemaVersion: 1,
  fileName,
  moduleCount: 2,
  courseTree: [
    {
      title: "Module 1",
      type: "folder",
      children: [
        { title: "Reading", type: "webcontent", children: [] },
        { title: "Quiz", type: "imsqti_xmlv1p2", children: [] },
      ],
    },
  ],
  stats: {
    totalItems: 2,
    coreEmptyCount: 0,
    lti: 0,
    webcontent: 1,
    quizzes: 1,
    assignments: 0,
    discussions: 0,
    weblinks: 0,
    unknown: 0,
    emptyFolders: 0,
    ifs: 2.5,
    ...overrides,
  },
  scannedAt: "2026-09-30T12:00:00.000Z",
  fileSha256: "a".repeat(64),
  unknownTypesLog: {},
  fileExtensionsLog: {},
  sourceEvidence: { schemaVersion: 8, manifestOnly: true, resources: {} },
  warnings: [],
  scope: "test",
});

const pkg = (id, fileName, extra = {}) => ({
  id,
  kind: "package",
  title: fileName,
  packageId: "",
  version: 1,
  updatedAt: "2026-09-30T12:00:00.000Z",
  updatedBy: "test",
  data: {
    scan: scan(fileName),
    partner: "NAIT",
    owner: "Arjun",
    status: "In Queue",
    assignedDate: "",
    deadline: "",
    driveLink: "",
    ...extra,
  },
});

test("legacy semantic package identity rules are preserved", () => {
  assert.equal(normalizeFileName(" BORL113 (2).imscc ", true), "borl113.imscc");
  assert.equal(canonicalDisplayFileName("BORL113 (2) (3).imscc"), "BORL113.imscc");
  assert.equal(packageMatchKey("B0RL113 - Development (NCE) - CLXT.imscc"), "borl113");
  assert.equal(packageSemanticKey("BORL113 (7).imscc"), "borl113");
});

test("metadata validation preserves blank vs value and rejects invalid dates/status/links", () => {
  assert.equal(validateDateOnly("", "Deadline"), "");
  assert.equal(validateDateOnly("2026-10-02", "Deadline"), "2026-10-02");
  assert.throws(() => validateDateOnly("2026-02-31", "Deadline"), /real calendar date/);
  assert.equal(validateDriveLink(""), "");
  assert.equal(
    validateDriveLink("https://drive.google.com/file/d/abc/view"),
    "https://drive.google.com/file/d/abc/view",
  );
  assert.throws(() => validateDriveLink("https://evil.example/drive.google.com/x"), /Google Drive/);
  assert.deepEqual(
    validateCourseMetadata({
      partner: "NAIT",
      owner: "",
      status: "In Queue",
      assignedDate: "",
      deadline: "",
      driveLink: "",
    }),
    {
      partner: "NAIT",
      owner: "",
      status: "In Queue",
      assignedDate: "",
      deadline: "",
      driveLink: "",
    },
  );
});

test("preflight preserves the deterministic legacy blocking rules", () => {
  assert.equal(deterministicPreflight(scan()).verdict, "CLEARED TO INGEST");
  assert.equal(
    deterministicPreflight(scan("x.imscc", { totalItems: 0 })).verdict,
    "BLOCKED",
  );
  assert.equal(
    deterministicPreflight(scan("x.imscc", { coreEmptyCount: 1 })).verdict,
    "BLOCKED",
  );
  assert.equal(
    deterministicPreflight(scan("x.imscc", { lti: 51 })).verdict,
    "BLOCKED",
  );
});

test("manifest export retains legacy columns and tool mapping", () => {
  const rows = sourceManifestRows(scan());
  assert.deepEqual(rows[0], [
    "Level",
    "Name",
    "Assignment_Tool",
    "System Format",
    "Ingestion Status",
  ]);
  assert.deepEqual(rows[1].slice(0, 3), [1, "Module 1", "Module"]);
  assert.deepEqual(rows[2].slice(0, 3), [2, "Reading", "Reading"]);
  assert.deepEqual(rows[3].slice(0, 3), [2, "Quiz", "Assessment"]);
});

test("duplicate planning preserves oldest unsuffixed survivor and blocks metadata conflicts", () => {
  const a = pkg("a", "BORL113.imscc");
  const b = {
    ...pkg("b", "BORL113 (2).imscc"),
    updatedAt: "2026-10-01T12:00:00.000Z",
    data: {
      ...pkg("b", "BORL113 (2).imscc").data,
      scan: {
        ...scan("BORL113 (2).imscc"),
        scannedAt: "2026-10-01T12:00:00.000Z",
        fileSha256: "b".repeat(64),
      },
    },
  };
  const plan = buildDuplicatePlan([a, b]);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].survivor.id, "a");
  assert.equal(plan.groups[0].latestScan.id, "b");
  assert.equal(plan.groups[0].scanDataDiffers, true);
  const merged = mergeDuplicateGroup(plan.groups[0]);
  assert.equal(merged.survivor.id, "a");
  assert.equal(merged.survivor.data.scan.fileSha256, "b".repeat(64));
  assert.equal(merged.archived[0].data.archived, true);
  assert.equal(merged.archived[0].data.duplicateSurvivorId, "a");

  const conflict = buildDuplicatePlan([
    a,
    { ...b, data: { ...b.data, owner: "Different owner" } },
  ]);
  assert.deepEqual(conflict.groups[0].conflictFields, ["Owner"]);
  assert.equal(conflict.groups[0].safeToArchive, false);
  assert.throws(() => mergeDuplicateGroup(conflict.groups[0]), /conflicts/);
});

test("work-state transitions retain audit-first and runtime review decisions", () => {
  const state = normalizeWorkState({});
  assert.equal(state.scope, "ACTIVE");
  assert.equal(
    nextWorkAction(
      {
        hasSource: true,
        sourceRescanned: true,
        existingCourseraShell: true,
        rawQaFresh: false,
      },
      state,
    ).code,
    "AUDIT_EXISTING_RAW",
  );
  assert.equal(
    nextWorkAction(
      {
        hasSource: true,
        sourceRescanned: true,
        existingCourseraShell: true,
        rawQaFresh: true,
        rawQaRecommendation: { code: "KEEP" },
        hasRuntimeFlag: true,
      },
      state,
    ).code,
    "REVIEW_SCORM_EXISTING",
  );
});

test("portable catalog, planner and runtime parsers normalize expected columns", () => {
  const catalog = importCatalogWorkbook(
    {
      name: "catalog.xlsx",
      sheets: {
        Sheet1: {
          values: [
            ["Title Code", "Title", "Coursera Product Type", "Assignment Owner", "Import Status"],
            ["BORL113", "Business", "Course", "Arjun", "Complete"],
          ],
        },
      },
    },
    "NAIT",
  );
  assert.equal(catalog[0].titleKey, "borl113");
  assert.equal(catalog[0].expectedFileName, "BORL113.imscc");

  const planner = importPlannerWorkbook({
    name: "planner.xlsx",
    sheets: {
      Sheet1: {
        values: [
          ["Assignment Date", "Partner", "Content Ingestion Method", "Assignment Category", "Assignment Owner", "Total Title Count", "Assignment Owner Remarks"],
          ["2026-09-01", "NAIT", "Smart Ingestion", "Import Only", "Arjun", 1, "Please process BORL113"],
        ],
      },
    },
  });
  assert.equal(planner[0].assignmentDate, "2026-09-01");

  const runtime = importRuntimeWorkbook({
    name: "runtime.xlsx",
    sheets: {
      Sheet1: {
        values: [
          ["Coursecode", "Course Title", "RISE", "Storyline", "Link"],
          ["BORL113", "Business", 2, "No", "source"],
        ],
      },
    },
  });
  assert.equal(runtime[0].riseCount, 2);
  assert.equal(runtime[0].storylineCount, 0);
});

test("portable planner queue preserves import-only audit-first behavior", () => {
  const course = pkg("course-1", "BORL113.imscc", {
    scan: {
      ...scan(),
      scannedAt: "2026-09-30T12:00:00.000Z",
    },
  });
  const result = buildPortableWorkQueue({
    records: [course],
    catalog: [
      {
        sourceRow: 2,
        partner: "NAIT",
        titleCode: "BORL113",
        displayCode: "BORL113",
        titleKey: "borl113",
        title: "Business",
        productType: "Course",
        owner: "Arjun",
        brightspaceAccess: "",
        ccPackageAccess: "Complete",
        importStatus: "Complete",
        expectedFileName: "BORL113.imscc",
      },
    ],
    planner: [
      {
        sourceRow: 2,
        assignmentDate: "2026-09-01",
        partner: "NAIT",
        method: "Smart Ingestion",
        category: "Import Only",
        subCategory: "",
        owner: "Arjun",
        totalTitleCount: 1,
        status: "",
        remarks: "BORL113",
      },
    ],
    runtime: [],
    partner: "NAIT",
    fromDate: "2026-09-01",
    toDate: "2026-09-30",
    scanAfter: "2026-09-01",
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].existingCourseraShell, true);
  assert.equal(result.items[0].nextAction.code, "AUDIT_EXISTING_RAW");
});

test("lineage repair candidates are conservative and applied as separate metadata", () => {
  const items = [{ sourceId: "s1", verdict: "MATCH", courseraId: "c1", checks: { text: "MATCH" } }];
  const baseResult = {
    snapshotContext: { mode: "RAW_INGESTION" },
    summary: {
      observedFidelity: 100,
      evidenceCoverage: 100,
      ingestionFailures: 0,
      missing: 0,
      partial: 0,
      unverified: 0,
      behaviorMutations: 0,
      runtimeReviews: 0,
    },
    itemResults: items,
  };
  const first = {
    id: "r1",
    kind: "audit",
    title: "r1",
    packageId: "p1",
    version: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "x",
    data: {
      generation: 0,
      hashes: { excel: "a" },
      sourceScanSha256: "same",
      result: baseResult,
    },
  };
  const second = {
    ...structuredClone(first),
    id: "r2",
    title: "r2",
    updatedAt: "2026-09-02T00:00:00.000Z",
    data: {
      ...structuredClone(first.data),
      generation: 1,
      hashes: { excel: "b" },
    },
  };
  const candidates = repeatedExportRepairCandidates([first, second]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].toGeneration, 0);
  const op = {
    id: "op1",
    kind: "operations",
    title: "repair",
    packageId: "p1",
    version: 1,
    updatedAt: "2026-09-03T00:00:00.000Z",
    updatedBy: "x",
    data: { type: "lineage-repair", runId: "r2", toGeneration: 0 },
  };
  const repaired = applyLineageRepairs([first, second], [op]);
  assert.equal(repaired[1].data.generation, 0);
  assert.equal(second.data.generation, 1, "immutable original remains unchanged");
});

test("system health and partner analytics expose duplicates without deleting evidence", () => {
  const records = [pkg("a", "BORL113.imscc"), pkg("b", "BORL113 (2).imscc")];
  const health = systemHealth(records);
  assert.equal(health.status, "WARN");
  assert.match(health.checks.find((x) => x.name === "Semantic duplicate guard").detail, /1 duplicate/);
  const analytics = partnerAnalytics(records);
  assert.equal(analytics.totalPackages, 2);
  assert.equal(analytics.duplicateSummary.groupCount, 1);
});

test("deterministic architecture diagnostics do not claim evidence loss", () => {
  const result = deepArchitectureDiagnostics(scan());
  assert.equal(result.nodeCount, 3);
  assert.match(result.note, /do not by themselves prove ingestion failure/);
});
