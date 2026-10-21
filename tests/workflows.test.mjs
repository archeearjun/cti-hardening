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
import { gzipSync } from "node:zlib";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { create_runPostIngestionQaCore_ } from "../src/engine/comparison/course.js";
import JSZip from "jszip";
import { readCourseraCaptureFileBytes } from "../src/domain/coursera-capture-file.ts";
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
test("compressed Coursera transport keeps original JSON provenance and a separate compressed file hash", async () => {
  const input = comparisonFixture();
  const plainOutput = workflows.compare(input);
  const packed = gzipSync(input.json.bytes);
  const file = new File([packed], "course.json.gz");
  const decoded = await readCourseraCaptureFileBytes(file);
  input.json = { name: file.name, ...decoded };
  const output = workflows.compare(input);
  assert.equal(output.hashes.json, plainOutput.hashes.json);
  assert.equal(output.captureTransport.json.sha256, decoded.transport.sha256);
  assert.equal(output.captureTransport.json.name, "course.json.gz");
  assert.equal(
    output.captureTransport.json.expandedBytes,
    input.json.bytes.length,
  );
  assert.deepEqual(output.result.itemResults, plainOutput.result.itemResults);
  assert.deepEqual(output.contentEvidence, plainOutput.contentEvidence);
});

test("large expanded capture bytes reach Compare without a full Base64 copy or changing evidence decisions", () => {
  const input = comparisonFixture(),
    baseline = workflows.compare(input);
  const raw = JSON.parse(new TextDecoder().decode(input.json.bytes));
  raw.retainedUnknownModel = { originalPadding: "x".repeat(27 * 1024 * 1024) };
  input.json.bytes = encode(raw);
  assert(Math.ceil(input.json.bytes.byteLength / 3) * 4 > 35000000);
  const nativeEncode = globalThis.btoa,
    nativeDecode = globalThis.atob;
  try {
    globalThis.btoa = (text) => {
      assert(
        text.length < 1024 * 1024,
        "The selected large JSON must not become a Base64 copy",
      );
      return nativeEncode(text);
    };
    globalThis.atob = (text) => {
      assert(
        text.length < 1024 * 1024,
        "The selected large JSON must not become a decoded Base64 number array",
      );
      return nativeDecode(text);
    };
    const result = workflows.compare(input);
    assert.deepEqual(result.result, baseline.result);
    assert.deepEqual(result.contentEvidence, baseline.contentEvidence);
    assert.equal(
      result.hashes.json,
      createHash("sha256").update(input.json.bytes).digest("hex"),
    );
  } finally {
    globalThis.btoa = nativeEncode;
    globalThis.atob = nativeDecode;
  }
});

test("expanded comparison bytes are bounded before package loading, while legacy Base64 retains its bound", () => {
  const run = create_runPostIngestionQaCore_(createBrowserServices());
  let loads = 0;
  const io = {
    loadPackage() {
      loads++;
      throw Error("Unexpected package load");
    },
  };
  const input = comparisonFixture();
  const argumentsFor = (json) => [
    "AA==",
    "course.xlsx",
    json,
    "course.json",
    input.course.id,
    "raw",
    false,
    {},
    "",
    "",
    "",
    "",
    io,
  ];
  for (const bytes of [
    new Uint8Array(0),
    new Uint8Array(128 * 1024 * 1024 + 1),
  ]) {
    const result = run(...argumentsFor(bytes));
    assert.equal(result.success, false);
    assert.match(result.error, /128 MiB expanded capture limit/);
  }
  const legacy = run(...argumentsFor("A".repeat(35000001)));
  assert.equal(legacy.success, false);
  assert.match(legacy.error, /25 MB QA safety limit/);
  assert.equal(loads, 0);
});

test("archive originals cross the comparison bridge explicitly, retain compact proofs, and reject tampering", async () => {
  const input = comparisonFixture();
  const original = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const sha256 = createHash("sha256").update(original).digest("hex"),
    path = "files/" + sha256;
  const capture = JSON.parse(new TextDecoder().decode(input.json.bytes));
  capture.meta.directDataCapture = {
    exportTransport: { format: "ZIP_GZIP_JSON_V1" },
  };
  capture.fingerprints[0].payload.directAssetEvidence = {
    assets: [
      {
        assetId: "ABCDEFGHIJKLMNOPQRSTUV",
        body: {
          archivePath: path,
          sha256,
          size: original.length,
          mime: "image/png",
        },
      },
    ],
  };
  const zip = new JSZip();
  zip.file("capture.json.gz", gzipSync(encode(capture)), {
    createFolders: false,
  });
  zip.file(path, original, { createFolders: false });
  const archive = new File(
    [await zip.generateAsync({ type: "uint8array", compression: "STORE" })],
    "course.cti.zip",
  );
  const decoded = await readCourseraCaptureFileBytes(archive);
  input.json = { name: archive.name, ...decoded };
  const output = workflows.compare(input);
  assert.equal(output.result.success, true);
  assert.equal(output.captureTransport.json.encoding, "zip");
  assert.equal(output.captureTransport.json.originalBodyBytes, original.length);
  assert.equal(output.archiveProof.metadataSha256, output.hashes.json);
  assert.equal(output.archiveProof.archiveSha256, decoded.transport.sha256);
  assert.equal(output.archiveProof.originalBytesStored, false);
  assert.deepEqual(output.captureTransport.json.files, [
    { path, sha256, size: original.length },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(output)).archiveProof,
    output.archiveProof,
  );
  assert.equal(output.archiveProof.files[0].size, original.length);
  assert.equal(
    output.hashes.json,
    createHash("sha256").update(decoded.bytes).digest("hex"),
  );
  assert.equal(
    JSON.stringify(output).includes('"archiveFiles"'),
    false,
    "Saved comparison is not a binary archive copy",
  );
  assert.equal(JSON.stringify(output).includes('"base64"'), false);
  const corrupted = {
    ...input.json.archiveFiles[0],
    bytes: Uint8Array.from(original),
  };
  corrupted.bytes[corrupted.bytes.length - 1] ^= 1;
  assert.throws(
    () =>
      workflows.compare({
        ...input,
        json: { ...input.json, archiveFiles: [corrupted] },
      }),
    /failed checksum/,
  );
  assert.throws(
    () =>
      workflows.compare({
        ...input,
        json: { ...input.json, archiveFiles: [] },
      }),
    /referenced original file is absent|differs from its body receipt/i,
  );
  assert.throws(
    () =>
      workflows.compare({
        ...input,
        json: {
          ...input.json,
          transport: {
            ...decoded.transport,
            files: [{ path, sha256, size: original.length + 1 }],
          },
        },
      }),
    /transport file inventory contradicts/,
  );
  assert.throws(
    () =>
      workflows.compare({
        ...input,
        json: { ...input.json, transport: undefined },
      }),
    /verified ZIP identity/,
  );
});

const largeCaptureFixture = process.env.CTI_COURSERA_LARGE_COMPARE_FIXTURE;
test(
  "private large gzip capture reaches the full comparison with all retained questions and original JSON identity",
  { skip: !largeCaptureFixture },
  async () => {
    const physical = fs.readFileSync(largeCaptureFixture);
    const expanded =
      physical[0] === 0x1f && physical[1] === 0x8b
        ? gunzipSync(physical)
        : physical;
    assert(
      Math.ceil(expanded.byteLength / 3) * 4 > 35000000,
      "The real fixture must exercise the former Compare limit",
    );
    const capture = JSON.parse(expanded),
      input = comparisonFixture();
    const types = {
      Reading: "Reading",
      Assignment: "Graded Assignment",
      Widget: "Ungraded Plugin",
      Plugin: "Ungraded Plugin",
      Discussion: "Discussion Prompt",
    };
    const rows = capture.fingerprints
      .filter((item) => types[item.type])
      .map((item) => [
        types[item.type],
        item.name,
        "",
        "",
        "",
        "",
        "",
        item.id,
      ]);
    input.excel = {
      name: "matching-structural-inventory.xlsx",
      bytes: writeWorkbook({
        name: "matching",
        sheets: { "FOR IMPORT": { values: rows } },
      }),
    };
    const decoded = await readCourseraCaptureFileBytes(
      new File(
        [physical],
        largeCaptureFixture.endsWith(".gz") ? "actual.json.gz" : "actual.json",
      ),
    );
    input.json = { name: "actual.json.gz", ...decoded };
    const nativeEncode = globalThis.btoa;
    let output;
    try {
      globalThis.btoa = (text) => {
        assert(
          text.length < 1024 * 1024,
          "Real expanded JSON must not be Base64 encoded",
        );
        return nativeEncode(text);
      };
      output = workflows.compare(input);
    } finally {
      globalThis.btoa = nativeEncode;
    }
    assert.equal(output.result.success, true);
    assert.equal(output.result.inputCoherence.status, "PASS");
    assert.equal(
      output.hashes.json,
      createHash("sha256").update(expanded).digest("hex"),
    );
    assert.equal(
      output.captureTransport.json.sha256,
      createHash("sha256").update(physical).digest("hex"),
    );
    assert.equal(
      output.contentEvidence.coursera.reduce(
        (total, item) => total + item.content.questions.length,
        0,
      ),
      capture.fingerprints.reduce(
        (total, item) =>
          total + (item.payload?.structuredAssessment?.questions?.length || 0),
        0,
      ),
    );
    assert.equal(
      output.result.stats.extractorMeta.captureAccounting.complete,
      capture.meta.captureAccounting.complete,
      "Transport cannot change the capture's evidence gaps",
    );
    const savedBytes = new TextEncoder().encode(
      JSON.stringify(output),
    ).byteLength;
    assert(
      savedBytes < 32 * 1024 * 1024,
      "The real comparison report must fit the shared record bound",
    );
    if (process.env.CTI_COMPARE_PRINT_SIZE === "1")
      process.stderr.write(
        JSON.stringify({
          captureMetadataBytes: expanded.byteLength,
          comparisonRecordBytes: savedBytes,
          sharedRecordLimitBytes: 32 * 1024 * 1024,
        }) + "\n",
      );
  },
);
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
test("lifecycle retains the entry-point guards for incoherent and incomplete evidence", () => {
  const input = comparisonFixture();
  const raw = workflows.compare(input);
  const current = workflows.compare({ ...input, mode: "ops" });
  const before = newRecord("audit", "Raw", raw, input.course.id);
  const after = newRecord("audit", "Current", current, input.course.id);
  assert.equal(
    workflows.execute({ kind: "lifecycle", before, after }).comparisonScope,
    "SAME_ATTEMPT_RAW_TO_CURRENT",
  );
  for (const field of ["before", "after"]) {
    const pair = structuredClone({ before, after });
    pair[field].data.result.inputCoherence = {
      status: "FAIL",
      reason: "Wrong destination course",
    };
    assert.throws(
      () => workflows.execute({ kind: "lifecycle", ...pair }),
      /incoherent.*Wrong destination course/,
    );
    const incomplete = structuredClone({ before, after });
    incomplete[field].data.hashes.json = "";
    assert.throws(
      () => workflows.execute({ kind: "lifecycle", ...incomplete }),
      /capture JSON for both snapshots/,
    );
    const summaryOnly = structuredClone({ before, after });
    delete summaryOnly[field].data.result.itemResults;
    assert.throws(
      () => workflows.execute({ kind: "lifecycle", ...summaryOnly }),
      /full item evidence/,
    );
  }
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
test("full engine equals the pre-migration GAS result", {}, () => {
  const input = comparisonFixture(),
    books = new Map(),
    s = createBrowserServices();
  const old = { console, URL, ...s, XmlService: workerXml };
  vm.createContext(old);
  vm.runInContext(
    fs.readFileSync(
      process.env.CTI_PRE_MIGRATION_GS ||
        new URL("../archive/apps-script/Code.gs", import.meta.url),
      "utf8",
    ),
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
  const actual = plain(workflows.compare(input).result),
    expected = plain(result);
  delete actual.workspaceWarnings;
  // This unchanged fixture must preserve every evidence decision. Explicitly
  // assert the distinct release identities before comparing its behavior.
  assert.equal(actual.engineBuildId, "v8.0.6-source-asset-recovery-20261021");
  assert.equal(expected.engineBuildId, "v8.0.0-source-item-evidence-20260930");
  delete actual.engineBuildId;
  delete expected.engineBuildId;
  // The available extractor release is separately tested deployment metadata.
  if (actual.captureReadiness) delete actual.captureReadiness.expectedVersion;
  if (expected.captureReadiness)
    delete expected.captureReadiness.expectedVersion;
  // Owner display now retains the XLSX lesson, while the comparable module
  // path and every matching/readiness decision remain identical.
  assert.deepEqual(
    actual.ownerView.items.map((item) => item.lesson),
    ["Lesson 1", "Lesson 1"],
  );
  expected.ownerView.items.forEach((item) => {
    item.lesson = "Lesson 1";
  });
  assert.deepEqual(actual, expected);
});
