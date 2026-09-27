import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  createLegacyChunkReader,
  LegacyChunkError,
} from "../src/domain/legacy-chunks.ts";
import { importLegacyWorkspace } from "../src/domain/legacy-import.ts";
import { recordSummary } from "../src/domain/workspace-store.ts";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";

const fixture = comparisonFixture();
const result = createWorkflows(workerXml).compare(fixture).result;
const packageId = fixture.course.id;
const header = [
  "Run ID",
  "Package UUID",
  "Payload Chunks",
  "Mode",
  "Timestamp",
  "Reviewer Notes",
];
const chunkHeader = ["Run ID", "Chunk Index", "Base64 Result Chunk"];
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const payload = (id) => ({ runId: id, packageUuid: packageId, result });
function migration() {
  const row = Array(20).fill("");
  row[2] = "Synthetic migration source";
  row[12] = JSON.stringify(fixture.course.data.scan.courseTree);
  row[18] = packageId;
  return {
    kind: "CTI_WORKSPACE_MIGRATION",
    schemaVersion: 1,
    sheets: {
      Packages: [[], row],
      QA_Runs: [header],
      QA_Run_Chunks: [chunkHeader],
      Unknown: [["Original evidence 🧬"]],
    },
  };
}
function addRun(value, id, count = 1) {
  value.sheets.QA_Runs.push([
    id,
    packageId,
    count,
    "SINGLE_C0",
    "2026-01-01T00:00:00Z",
    "Keep reviewer context",
  ]);
  value.sheets.QA_Run_Chunks.push([id, 0, encode(payload(id))]);
}

test("unavailable QA reports retain recovery metadata and all original evidence without becoming audits", () => {
  const source = migration();
  addRun(source, "QA-complete");
  addRun(source, "QA-missing-last", 2);
  source.sheets.QA_Runs.push(["QA-no-payload", packageId, 3]);
  const original = structuredClone(source);
  const plan = importLegacyWorkspace(source);
  assert.deepEqual(source, original);
  assert.deepEqual(
    plan.records.filter((r) => r.kind === "audit").map((r) => r.id),
    ["QA-complete"],
  );
  assert.deepEqual(
    plan.records.find((r) => r.kind === "audit").data.result,
    result,
  );
  assert.equal(plan.records.find((r) => r.kind === "package").id, packageId);
  assert.deepEqual(plan.records.at(-1).data, source);
  assert.equal(plan.issues.length, 2);
  assert.deepEqual(plan.issues[0].chunks.missingIndices, [1]);
  assert.equal(plan.issues[1].chunks.actualChunks, 0);
  assert.equal(plan.issues[1].chunks.expectedChunks, 3);
  const recovery = plan.records.find(
    (r) => r.data.sourceRunId === "QA-missing-last",
  );
  assert.equal(recovery.kind, "legacy-backup");
  assert.equal(recovery.packageId, packageId);
  assert.equal(
    recovery.data.legacyRunMetadata["Reviewer Notes"],
    "Keep reviewer context",
  );
  assert.equal(recovery.data.result, undefined);
  assert.deepEqual(recordSummary(recovery).data.issue, plan.issues[0]);
  assert.equal(recordSummary(recovery).data.legacyRunMetadata, undefined);
  assert.deepEqual(
    plan.records.map((r) => r.id),
    importLegacyWorkspace(source).records.map((r) => r.id),
  );
  source.sheets.QA_Runs[2][2] = 1;
  const repaired = importLegacyWorkspace(source);
  assert(
    repaired.records.some(
      (r) => r.kind === "audit" && r.id === "QA-missing-last",
    ),
  );
  assert.notEqual(recovery.id, "QA-missing-last");
});

test("complete shuffled zero-based chunks and legacy missing counts decode exactly", () => {
  const encoded = encode({ unicode: "🧬 résumé", value: [1, 2, 3] });
  const rows = [
    ["run", 1, encoded.slice(7)],
    ["run", 0, encoded.slice(0, 7)],
  ];
  const reader = createLegacyChunkReader({
    QA_Run_Chunks: [chunkHeader, ...rows],
  });
  assert.deepEqual(reader("QA_Run_Chunks", "run", "2"), {
    unicode: "🧬 résumé",
    value: [1, 2, 3],
  });
  assert.deepEqual(
    reader("QA_Run_Chunks", "run"),
    reader("QA_Run_Chunks", "run", 2),
  );
});

test("damaged indexes and payloads never silently become complete reports", () => {
  const good = encode({ result: {} });
  const cases = [
    { rows: [], count: 2, pattern: /no payload rows/ },
    { rows: [[0, good]], count: 2, pattern: /Missing indexes: 1/ },
    { rows: [[1, good]], count: 1, pattern: /Missing indexes: 0/ },
    {
      rows: [
        [0, good],
        [2, good],
      ],
      count: 3,
      pattern: /Missing indexes: 1/,
    },
    {
      rows: [
        [0, good],
        [0, good],
      ],
      count: 2,
      pattern: /duplicate indexes/,
    },
    {
      rows: [
        [0, good],
        [0, "different"],
      ],
      count: 2,
      pattern: /duplicate indexes/,
    },
    ...["", null, false, -1, 1.5, "nope"].map((index) => ({
      rows: [[index, good]],
      count: 1,
      pattern: /invalid chunk indexes/,
    })),
    { rows: [[0, ""]], count: 1, pattern: /empty/ },
    { rows: [[0, "****"]], count: 1, pattern: /Base64/ },
    { rows: [[0, "/w=="]], count: 1, pattern: /UTF-8/ },
    {
      rows: [[0, Buffer.from('{"result":').toString("base64")]],
      count: 1,
      pattern: /JSON/,
    },
    { rows: [[0, good]], count: "invalid", pattern: /Payload Chunks count/ },
  ];
  for (const c of cases) {
    const read = createLegacyChunkReader({
      QA_Run_Chunks: [chunkHeader, ...c.rows.map((row) => ["run", ...row])],
    });
    assert.throws(
      () => read("QA_Run_Chunks", "run", c.count),
      (e) => e instanceof LegacyChunkError && c.pattern.test(e.message),
    );
  }
  const read = createLegacyChunkReader({ QA_Run_Chunks: [chunkHeader] });
  assert.throws(
    () => read("QA_Run_Chunks", "run", Number.MAX_SAFE_INTEGER),
    (e) => e.diagnostics.missingIndices.length === 20,
  );
});

test("payload identity mismatches are retained as issues; damaged source trees still stop migration", () => {
  for (const bad of [
    { ...payload("QA-id"), runId: "wrong" },
    { ...payload("QA-id"), packageUuid: "wrong" },
    { runId: "QA-id" },
  ]) {
    const source = migration();
    addRun(source, "QA-id");
    source.sheets.QA_Run_Chunks[1][2] = encode(bad);
    const plan = importLegacyWorkspace(source);
    assert.equal(plan.issues.length, 1);
    assert.equal(plan.records.filter((r) => r.kind === "audit").length, 0);
  }
  const source = migration();
  source.sheets.Packages[1][12] = "TREE:missing-source";
  assert.throws(() => importLegacyWorkspace(source), /Package_Trees/);
});

test("actual GAS writer can leave a history row after payload write failure; migration preserves it as unavailable", () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(
      new URL(
        "../src/legacy/server/010-qabuildlongitudinaldelta.js",
        import.meta.url,
      ),
      "utf8",
    ),
    context,
  );
  let savedRows;
  const sheet = (setValues) => ({
    getLastRow: () => 1,
    getRange: () => ({ setValues }),
  });
  Object.assign(context, {
    validateUuid_: (x) => x,
    getDatabaseSheet_: () => ({ getParent: () => ({}) }),
    LockService: {
      getScriptLock: () => ({
        waitLock() {},
        hasLock: () => true,
        releaseLock() {},
      }),
    },
    getQaRunsSheet_: () =>
      sheet((rows) => {
        savedRows = rows;
      }),
    getQaRunChunksSheet_: () =>
      sheet(() => {
        throw new Error("simulated payload write failure");
      }),
    Utilities: {
      formatDate: () => "20260101-000000",
      getUuid: () => "synthetic-run",
      newBlob: (text) => ({ getBytes: () => Buffer.from(text) }),
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
    },
    Session: { getScriptTimeZone: () => "UTC" },
    qaExtractorIdentityFromResult_: () => ({}),
    qaCourseIdFromSnapshot_: () => "course",
    QA_RUN_SCHEMA_VERSION_: 1,
    QA_RUN_CHUNK_SIZE_: 40000,
    CTI_GATEWAY_RELEASE_: "test",
    CTI_QA_ENGINE_BUILD_ID_: "test",
    qaResolveLineage_: () => ({ generation: 0 }),
    qaLatestSourceScanForUuid_: () => null,
    qaCompactIngestionIntelligence_: () => ({}),
    sheetSafeText_: (x) => x,
  });
  const stored = context.persistQaRun_(packageId, "SINGLE_C0", result, {});
  assert.equal(stored.status, "FAILED");
  assert.match(stored.error, /simulated payload write failure/);
  assert(savedRows[0][25] > 0);
  const source = migration();
  source.sheets.QA_Runs.push([savedRows[0][0], packageId, savedRows[0][25]]);
  const plan = importLegacyWorkspace(source);
  assert.equal(plan.issues[0].runId, savedRows[0][0]);
  assert.equal(plan.issues[0].chunks.actualChunks, 0);
  assert.equal(plan.records.filter((r) => r.kind === "audit").length, 0);
});
