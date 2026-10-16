import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import { directCourseInventoryV1 } from "../src/extractors/coursera/direct-data-inventory.js";
import { CTI_DIRECT_DATA_BUILD_V1 } from "../src/extractors/coursera/direct-data-config.js";

const entry = fs.readFileSync(
  new URL("../src/extractors/coursera/direct-data-entry.js", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "entry.js",
  entry,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
let runNode;
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "run")
    runNode = node;
  ts.forEachChild(node, find);
}
find(ast);
assert(runNode);

/** Exercise the maintained run orchestrator without network or a browser.
 * Item acquisition and storage are controlled seams; the hosted browser test
 * additionally executes the native reader and actual button with real IDB. */
function fixture() {
  const courseId = "syntheticBranch",
    atom = "a".repeat(22),
    other = "b".repeat(22);
  const material = {
    elements: [
      {
        id: courseId,
        material: {
          elements: [
            {
              id: "module",
              name: "Module",
              elements: [
                {
                  id: "lesson",
                  name: "Lesson",
                  elements: [
                    {
                      id: "quiz",
                      name: "Quiz",
                      atomId: atom,
                      contentId: "atom~" + atom,
                      content: { typeName: "staffGraded" },
                    },
                    {
                      id: "reading",
                      name: "Missing original",
                      atomId: other,
                      contentId: "atom~" + other,
                      content: { typeName: "supplement" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
    paging: {},
  };
  const runs = new Map(),
    rows = new Map(),
    downloads = [],
    questionReads = [];
  let activeLookups = 0,
    next = 0,
    revision = "Original question";
  const policy = {
    requests: 1000,
    totalBytes: 10000000,
    durationMs: 60000,
    concurrentRequests: 4,
  };
  const store = {
    available: true,
    getActiveRun: async () => {
      activeLookups++;
      return structuredClone([...runs.values()].at(-1) || null);
    },
    openRun: async (id, metadata) => {
      const runId = id || "run-" + ++next;
      runs.set(runId, { ...runs.get(runId), ...metadata, runId });
      return { runId };
    },
    getItem: async (runId, id) =>
      structuredClone(rows.get(runId + "/" + id) || null),
  };
  const state = {
    running: false,
    diagnosing: false,
    terminal: false,
    runId: "",
    counts: {},
  };
  const ctx = vm.createContext({
    console,
    Map,
    Set,
    Date,
    JSON,
    Number,
    Object,
    Array,
    state,
    courseId,
    initialPath: "/content/edit",
    location: { origin: "https://www.coursera.org", pathname: "/content/edit" },
    window: {},
    encoder: new TextEncoder(),
    exporting: false,
    operatorStopped: false,
    fatalReason: "",
    providerTransport: null,
    items: [],
    inventory: null,
    meta: null,
    itemStates: new Map(),
    retainedSizes: new Map(),
    reader: null,
    frozenStats: null,
    budgetBase: {},
    materialHash: "",
    checkpointReady: false,
    mediaReader: null,
    panoptoSources: new Map(),
    mediaBase: {},
    frozenMediaStats: null,
    budgetLimits: null,
    metadataReserveBytes: 0,
    store: null,
    CTI_DIRECT_DATA_BUILD_V1,
    CTI_DIRECT_DATA_VERSION_V1: "1.7.1",
    CTI_DIRECT_DATA_EXPORT_BYTES_V1: 128 * 1024 * 1024,
    CTI_DIRECT_DATA_MAX_PARTS_V1: 5000,
    CTI_DIRECT_DATA_MEDIA_BYTES_V1: 512 * 1024 * 1024,
    CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1: 128 * 1024 * 1024,
    setInterval: () => 1,
    clearInterval() {},
    render() {},
    checkpointBudget() {},
    assertContext: () => true,
    createDirectProviderHelperV1: () => ({ close() {} }),
    createDirectDataCheckpointStoreV1: async () => store,
    createDirectDataReaderV1: () => {
      let requests = 0;
      const snapshot = () => ({
        requests,
        bytes: requests * 100,
        elapsedMs: requests,
        limits: policy,
      });
      return {
        abort() {},
        snapshot,
        readCourseMaterials: async () => {
          requests++;
          return {
            ok: true,
            data: structuredClone(material),
            receipt: { observedAt: new Date().toISOString() },
          };
        },
        readCourse: async () => {
          requests++;
          return { ok: true, data: {}, receipt: {} };
        },
      };
    },
    sanitizeCourseraCourseDataModel: (value) => value,
    remainingLimits: () => policy,
    directCourseInventoryV1,
    requireRead: (read) => read.data,
    hash: async (value) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    receipt: (read) => read.receipt,
    terminalBudgetReason: () => false,
    coverageSummary: () => ({}),
  });
  const summarize = () => {
    const values = [...ctx.itemStates.values()];
    state.counts.processed = values.length;
    state.counts.complete = values.filter(
      (row) => row.contract.complete,
    ).length;
    state.counts.questions = values.filter((row) => row.questions).length;
  };
  ctx.hydrateSavedItems = async () => {
    for (const fp of ctx.items) {
      const row = rows.get(state.runId + "/" + fp.id);
      if (row) ctx.itemStates.set(fp.id, row.state);
    }
    summarize();
  };
  ctx.captureItem = async (fp) => {
    const quiz = fp.id === "quiz";
    fp.captureContract = { complete: quiz };
    fp.payload.directDataSources = {
      atom: {
        elements: [
          {
            draft: {
              content: {
                typeName: quiz ? "staffGradedDraft" : "supplementDraft",
              },
            },
          },
        ],
      },
    };
    if (quiz) {
      questionReads.push(revision);
      fp.payload.structuredAssessment = {
        questions: [
          {
            id: "native-question",
            prompt: revision,
            observedAt: "read-" + questionReads.length,
          },
        ],
      };
    }
    const saved = {
      fingerprint: structuredClone(fp),
      state: {
        processed: true,
        contract: fp.captureContract,
        questions: quiz ? 1 : 0,
      },
    };
    rows.set(state.runId + "/" + fp.id, saved);
    ctx.itemStates.set(fp.id, saved.state);
    summarize();
  };
  ctx.saveRun = async (status) => {
    if (!ctx.meta || !state.runId) return;
    const stats = ctx.reader?.snapshot() || ctx.frozenStats;
    const budget = {
      requests: (ctx.budgetBase.requests || 0) + (stats?.requests || 0),
      bytes: (ctx.budgetBase.bytes || 0) + (stats?.bytes || 0),
      elapsedMs: (ctx.budgetBase.elapsedMs || 0) + (stats?.elapsedMs || 0),
      limits: policy,
    };
    const captureMeta = structuredClone(ctx.meta);
    if (status === "INCOMPLETE")
      Object.assign(captureMeta.directDataCapture, {
        acquisitionComplete: true,
        stopReason: "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS",
      });
    runs.set(state.runId, {
      runId: state.runId,
      state: status,
      materialHash: ctx.materialHash,
      buildId: CTI_DIRECT_DATA_BUILD_V1,
      budget,
      captureMeta,
    });
  };
  ctx.budgetSnapshot = () => ({
    ...ctx.reader?.snapshot(),
    inheritedBudget: { ...ctx.budgetBase },
  });
  ctx.download = async () =>
    downloads.push({
      runId: state.runId,
      question: structuredClone(
        rows.get(state.runId + "/quiz").fingerprint.payload.structuredAssessment
          .questions[0],
      ),
    });
  vm.runInContext(runNode.getText(ast) + ";globalThis.run = run;", ctx);
  return {
    ctx,
    state,
    runs,
    rows,
    questionReads,
    downloads,
    activeLookups: () => activeLookups,
    edit: () => {
      revision = "Edited native question";
    },
  };
}

test("explicit fresh capture rereads questions in a separate run while continuation retains old receipts and budgets", async () => {
  const f = fixture();
  assert.equal(
    f.questionReads.length,
    0,
    "Opening the capture controls initiates no network or acquisition.",
  );
  await f.ctx.run();
  const firstId = f.state.runId,
    firstQuestion = structuredClone(f.downloads[0].question);
  f.edit();
  await f.ctx.run();
  assert.equal(f.state.runId, firstId);
  assert.deepEqual(f.questionReads, ["Original question"]);
  assert.deepEqual(f.downloads.at(-1).question, firstQuestion);
  assert.equal(
    f.runs.get(firstId).captureMeta.directDataCapture.mediaEnrichment
      .retainedAssessmentObservations,
    true,
  );
  const before = structuredClone(f.runs.get(firstId)),
    rowsBefore = structuredClone([...f.rows]),
    lookups = f.activeLookups();
  f.state.terminal = true;
  await f.ctx.run(true);
  assert.notEqual(
    f.state.runId,
    firstId,
    "Fresh is available even after a terminal prior run.",
  );
  assert.equal(
    f.activeLookups(),
    lookups,
    "Explicit fresh does not select an existing run.",
  );
  assert.deepEqual(f.questionReads, [
    "Original question",
    "Edited native question",
  ]);
  assert.equal(
    f.runs.get(f.state.runId).captureMeta.directDataCapture.resumed,
    false,
  );
  assert.equal(
    f.runs.get(f.state.runId).captureMeta.directDataCapture.mediaEnrichment,
    undefined,
  );
  assert.equal(f.runs.get(f.state.runId).budget.requests, 3);
  assert.deepEqual(f.runs.get(firstId), before);
  for (const [key, row] of rowsBefore) assert.deepEqual(f.rows.get(key), row);
  assert.deepEqual(
    f.downloads[0].question,
    firstQuestion,
    "Prior export retains its actual observation.",
  );
});

test("fresh capture cannot start while another operation, diagnostic or export is active", async () => {
  for (const busy of ["running", "diagnosing", "exporting"]) {
    const f = fixture();
    if (busy === "exporting") f.ctx.exporting = true;
    else f.state[busy] = true;
    await f.ctx.run(true);
    assert.equal(f.runs.size, 0);
    assert.equal(f.activeLookups(), 0);
    assert.equal(f.questionReads.length, 0);
  }
  assert.match(entry, /freshButton\.onclick = state\.startFresh/);
  assert.match(entry, /state\.startFresh = \(\) => void run\(true\)/);
  assert.match(entry, /freshButton\.disabled = busy/);
});
