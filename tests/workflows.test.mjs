import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { createBrowserServices } from "../src/adapters/browser-services.ts";
import {
  readWorkbook,
  writeWorkbook,
  workbookAdapter,
} from "../src/adapters/workbook.ts";
import { newRecord } from "../src/domain/workspace-store.ts";
import { importLegacyWorkspace } from "../src/domain/legacy-import.ts";
import { prepareWorkspaceBackup } from "../src/domain/workspace-validation.ts";
import { comparisonFixture, encode, masterRows } from "./workflow-fixtures.mjs";
const require = createRequire(import.meta.url),
  c = require("../tools/check.cjs");
const workflows = createWorkflows(workerXml),
  plain = (x) => JSON.parse(JSON.stringify(x));
for (const name of [
  "legacyWebLinkXml",
  "assignmentXml",
  "discussionXml",
  "imsccSyntheticManifest",
  "imsccAdvancedMetrics",
  "imsccZScoreLexical",
  "imsccInvalidRoot",
  "imsccMalformedInputs",
  "imsccDepthLimit",
])
  test(`XML recovery and scanner: ${name}`, () => {
    c.XmlService = workerXml;
    c.authorize_ = () => {};
    c["CTI_TEST_" + name + "_"]();
  });

test("full source/XLSX/JSON comparison and complete canonical owner report", () => {
  const result = workflows.compare(comparisonFixture());
  assert.equal(result.result.success, true);
  assert.equal(result.result.itemResults.length, 2);
  assert.match(result.report, /Reading/);
  assert.match(result.report, /Discussion/);
  assert.equal(result.hashes.excel.length, 64);
  assert.equal(result.result.snapshotContext.mode, "RAW_INGESTION");
});
test("XLSX remains structural authority; JSON mismatch is not silently accepted", () => {
  const input = comparisonFixture();
  const data = JSON.parse(new TextDecoder().decode(input.json.bytes));
  data.fingerprints = data.fingerprints.map((x, i) => ({
    ...x,
    id: "different-" + i,
    name: "Unrelated title " + i,
  }));
  input.json.bytes = encode(data);
  assert.equal(
    workflows.compare(input).result.inputCoherence.status,
    "UNVERIFIED",
  );
  const noJson = comparisonFixture();
  delete noJson.json;
  const result = workflows.compare(noJson);
  assert.equal(result.result.itemResults.length, 2);
  assert.match(result.report, /evidence|coverage/i);
});
test("first raw baseline is immutable, chronologically ordered and isolated by ingestion attempt", () => {
  const input = comparisonFixture(),
    output = workflows.compare(input);
  const first = newRecord(
    "audit",
    "First",
    { ...output, capturedAt: "2026-01-01T00:00:00Z" },
    input.course.id,
  );
  first.updatedAt = "2026-09-27T00:00:00Z";
  const later = newRecord(
    "audit",
    "Later",
    { ...output, capturedAt: "2026-02-01T00:00:00Z" },
    input.course.id,
  );
  later.updatedAt = "2026-01-01T00:00:00Z";
  const ctx = workflows.generationContext([later, first], input.course.id, 1);
  assert.equal(ctx.rawBaselineRunId, first.id);
  assert.deepEqual(ctx.rawBaselineEvidence, {
    excelSha256: output.hashes.excel,
    jsonSha256: output.hashes.json,
    hasReadingRecovery: false,
  });
  assert.equal(
    workflows.generationContext([first], input.course.id, 2).rawBaselineRunId,
    "",
  );
  const replay = workflows.compare({ ...input, history: [first] });
  assert.equal(replay.result.snapshotContext.mode, "RAW_INGESTION");
});
test("original-import generation zero and latest-ingestion actionability are preserved", () => {
  const input = {
    ...comparisonFixture(),
    generation: 0,
    ingestionCapabilityStatus: "LATEST_APPLIED",
  };
  const result = workflows.compare(input);
  assert.equal(result.generation, 0);
  assert.equal(
    result.result.operationalPolicy.ingestionCapabilityStatus,
    "LATEST_APPLIED",
  );
  const saved = newRecord("audit", "Original", result, input.course.id);
  assert.equal(
    workflows.generationContext([saved], input.course.id, 0).rawBaselineRunId,
    saved.id,
  );
});
test("lifecycle rejects different sources and identifies cross-attempt comparisons", () => {
  const input = comparisonFixture(),
    output = workflows.compare(input);
  const before = newRecord("audit", "Before", output, input.course.id),
    after = newRecord(
      "audit",
      "After",
      { ...output, generation: 2 },
      input.course.id,
    );
  assert.equal(
    workflows.execute({ kind: "lifecycle", before, after }).comparisonScope,
    "CROSS_ATTEMPT_OBSERVATIONS",
  );
  after.data = { ...after.data, sourceScanSha256: "b".repeat(64) };
  assert.throws(
    () => workflows.execute({ kind: "lifecycle", before, after }),
    /hashes differ/,
  );
});
test("Macmillan real XLSX source scan and split preserve source context and exclusion policy", () => {
  const bytes = writeWorkbook({
    name: "master",
    sheets: { export: { values: masterRows } },
  });
  const scan = workflows.execute({
    kind: "macmillan-scan",
    bytes,
    name: "master.xlsx",
  });
  assert.equal(scan.result.totalRows, 7);
  assert.equal(scan.result.primaryCount, 2);
  assert.equal(scan.result.totalL2, 3);
  const split = workflows.execute({
    kind: "macmillan-split",
    book: scan.book,
    anchors: [4],
    names: ["Quantities"],
    approved: [],
    partner: "Macmillan",
  });
  assert.equal(split.result.success, true, split.result.error);
  assert(split.book.sheets.Spec1_Clean);
  assert(split.book.sheets.Spec1_Context);
  assert(split.book.sheets.Spec1_Time_Policy);
  assert(split.book.sheets.Spec1_Excluded);
  assert.equal(
    readWorkbook(writeWorkbook(split.book), "result.xlsx").sheets.Spec1_Clean
      .values.length,
    3,
  );
});
test("canonical Macmillan Metadata, Merged, ContentMap stage integration contracts through actual XLSX adapter", () => {
  const books = new Map();
  c.SpreadsheetApp = {
    create(name) {
      const id = crypto.randomUUID(),
        book = { name, sheets: {} };
      books.set(id, book);
      return { ...workbookAdapter(book), getId: () => id };
    },
  };
  c.DriveApp = { getFileById: () => ({ setTrashed() {} }) };
  c.registerWorkflowFileId_ = () => {};
  c.CTI_TEST_unregisterWorkflowFileId_ = () => {};
  c.CTI_TEST_rowsToXlsxBase64_ = (rows, name) => ({
    base64: Buffer.from(
      writeWorkbook({ name, sheets: { export: { values: plain(rows) } } }),
    ).toString("base64"),
  });
  c.qaCompareGptOutput = (base64, name, id, stage, spec) => {
    const out = workflows.execute({
      kind: "macmillan-qa",
      book: books.get(id),
      bytes: Buffer.from(base64, "base64"),
      name,
      stage,
      spec,
    });
    if (out.result.success)
      Object.assign(books.get(id).sheets, out.book.sheets);
    return out.result;
  };
  c.CTI_TEST_macmillanStageContractsIntegration_();
});
test("legacy imports are idempotent and retain all original sheets and explicit boilerplate metrics", () => {
  const row = Array(20).fill("");
  row[2] = "Boilerplate";
  row[7] = 2;
  row[12] = "[]";
  row[18] = crypto.randomUUID();
  const work = Array(14).fill("");
  work[0] = "PARTNER|COURSE";
  work[13] = '{"beforeQaSaved":true}';
  const input = {
    kind: "CTI_WORKSPACE_MIGRATION",
    schemaVersion: 1,
    exportedAt: "2026-01-01",
    sheets: {
      Packages: [[], row],
      Work_State: [[], work],
      Unrecognised: [[1, 2, 3]],
    },
  };
  const a = importLegacyWorkspace(input),
    b = importLegacyWorkspace(input);
  assert.deepEqual(
    a.records.map((r) => r.id),
    b.records.map((r) => r.id),
  );
  assert.equal(a.records[0].data.scan.stats.ifs, 100);
  assert.deepEqual(a.records.at(-1).data.sheets.Unrecognised, [[1, 2, 3]]);
  assert.throws(
    () =>
      prepareWorkspaceBackup({
        kind: "CTI_BROWSER_WORKSPACE",
        schemaVersion: 1,
        records: [{ id: "bad" }],
      }),
    /Invalid/,
  );
  const bad = structuredClone(input);
  bad.sheets.Packages[1][12] = "TREE:missing";
  assert.throws(() => importLegacyWorkspace(bad), /Incomplete/);
});
test(
  "full engine equals the pre-migration GAS result",
  { skip: !process.env.CTI_PRE_MIGRATION_GS },
  () => {
    const input = comparisonFixture(),
      books = new Map(),
      s = createBrowserServices();
    const old = { console, URL, ...s, XmlService: workerXml };
    vm.createContext(old);
    vm.runInContext(
      fs.readFileSync(process.env.CTI_PRE_MIGRATION_GS, "utf8"),
      old,
    );
    old.authorize_ = () => {};
    old.fetchPackageStructureDb = () => ({
      success: true,
      tree: input.course.data.scan.courseTree,
      packageMeta: {
        partner: input.course.data.partner,
        owner: "Owner",
        fileName: "Synthetic.imscc",
      },
    });
    old.qaLoadGenerationEvidenceContext_ = () =>
      workflows.generationContext([], input.course.id, 1);
    old.qaExternalRuntimeEvidenceForPackage_ = () => ({
      checked: false,
      required: false,
      source: "",
      warning: "External runtime inventory has not been imported.",
    });
    old.ctiImportXlsxAsSheet_ = (blob, name) => {
      const id = crypto.randomUUID();
      books.set(id, readWorkbook(Uint8Array.from(blob.getBytes()), name));
      return { id };
    };
    old.SpreadsheetApp = { openById: (id) => workbookAdapter(books.get(id)) };
    old.DriveApp = {
      getFileById: (id) => ({ setTrashed: () => books.delete(id) }),
    };
    const result = old.runPostIngestionQa(
      Buffer.from(input.excel.bytes).toString("base64"),
      input.excel.name,
      Buffer.from(input.json.bytes).toString("base64"),
      input.json.name,
      input.course.id,
      "raw",
      false,
      { generation: 1 },
      "",
      "",
      "",
      "",
    );
    const actual = plain(workflows.compare(input).result);
    delete actual.workspaceWarnings;
    assert.deepEqual(actual, plain(result));
  },
);
