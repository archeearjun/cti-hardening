import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { directCourseInventoryV1 } from "../src/extractors/coursera/direct-data-inventory.js";
import {
  CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1,
  directMaterialStabilityModelV1,
} from "../src/extractors/coursera/direct-data-material-stability.js";
import {
  CTI_DIRECT_DATA_BUILD_V1,
  CTI_DIRECT_DATA_VERSION_V1,
  directRecoverablePublisherBuildV1,
} from "../src/extractors/coursera/direct-data-config.js";

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
let runNode, hydrateNode;
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "run")
    runNode = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "hydrateSavedItems")
    hydrateNode = node;
  ts.forEachChild(node, find);
}
find(ast);
assert(runNode);
assert(hydrateNode);

/** Exercise the maintained run orchestrator without network or a browser.
 * Item acquisition and storage are controlled seams; the hosted browser test
 * additionally executes the native reader and actual button with real IDB. */
function fixture({ assignmentFlags = false, originalCount = 0 } = {}) {
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
    questionReads = [],
    originalBodies = new Map(),
    originalDownloads = [];
  if (assignmentFlags) {
    const leaves = material.elements[0].material.elements[0].elements[0].elements;
    leaves[0].content = { typeName: "ungradedAssignment", definition: {
      assignmentFeatures: ["LIMITED_SUBMISSIONS", "TAKE_LATEST_GRADE"], isGraded: false,
    } };
    for (let index = 1; index < 4; index++) {
      const atomId = String.fromCharCode(99 + index).repeat(22);
      leaves.push({ id: "quiz" + index, name: "Quiz " + index, atomId, contentId: "atom~" + atomId,
        content: { typeName: "ungradedAssignment", definition: {
          assignmentFeatures: ["SHOW_GRADE_ON_RELEASE", "LIMITED_SUBMISSIONS", "TAKE_LATEST_GRADE"],
          isGraded: false,
        } } });
    }
  }
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
    publisherImageTargets: new Set(),
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
    directRecoverablePublisherBuildV1,
    CTI_DIRECT_DATA_VERSION_V1,
    CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1,
    directMaterialStabilityModelV1,
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
      createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex"),
    receipt: (read) => read.receipt,
    terminalBudgetReason: () => false,
    coverageSummary: () => ({
      content: { verified: state.counts.complete, total: state.counts.total },
      structures: { verified: 0, total: 0 },
    }),
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
    const quiz = fp.typeName !== "supplement";
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
    } else if (originalCount) {
      const retained = rows.get(state.runId + "/" + fp.id)?.fingerprint.payload.directAssetEvidence;
      if (retained) fp.payload.directAssetEvidence = structuredClone(retained);
      else fp.payload.directAssetEvidence = { assets: Array.from({ length: originalCount }, (_, index) => {
        const bytes = Buffer.alloc(512); bytes.write("AC1032"); bytes.writeUInt32LE(index, 128);
        const sha256 = createHash("sha256").update(bytes).digest("hex"), archivePath = "files/" + sha256;
        originalBodies.set(state.runId + "/" + archivePath, bytes);
        originalDownloads.push({ runId: state.runId, bytes: bytes.length });
        return { assetId: "Original" + String(index).padStart(14, "0"), body: {
          sha256, archivePath, size: bytes.length, mime: "application/acad",
          receipt: { observedAt: "2026-10-18T14:02:40.102Z", bodyFormat: "ORIGINAL_BINARY_BYTES_ARCHIVE" },
        } };
      }) };
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
      ...(originalCount ? { media: {
        requests: originalDownloads.filter(value => value.runId === state.runId).length,
        bytes: originalDownloads.filter(value => value.runId === state.runId).reduce((n, value) => n + value.bytes, 0),
      } } : {}),
    };
    const captureMeta = structuredClone(ctx.meta);
    if (status === "INCOMPLETE")
      Object.assign(captureMeta.directDataCapture, {
        acquisitionComplete: true,
        wholeCourseVerified: false,
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
    material,
    originalBodies,
    originalDownloads,
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

function reorderFourNativeFlagSets(material) {
  const leaves = material.elements[0].material.elements[0].elements[0].elements;
  for (const leaf of leaves)
    if (leaf.content.typeName === "ungradedAssignment") leaf.content.definition.assignmentFeatures.reverse();
  return leaves;
}

test("four observed assignment flag reorders resume the eligible historical run with 80 originals and prior assessment receipts", async () => {
  for (const buildId of ["v1.8.0-inline-widget-public-html-20261018", "v1.8.1-browser-publisher-api-20261018", "v1.8.2-historical-publisher-checkpoint-20261018", "v1.8.3-publisher-sections-original-images-20261018", CTI_DIRECT_DATA_BUILD_V1]) {
    const f = fixture({ assignmentFlags: true, originalCount: 80 });
    await f.ctx.run();
    const runId = f.state.runId, prior = f.runs.get(runId), priorMeta = prior.captureMeta,
      priorMetaJson = JSON.stringify(priorMeta), priorBudget = structuredClone(prior.budget),
      priorAssessments = structuredClone([...f.rows].filter(([key]) => key.startsWith(runId + "/quiz"))),
      priorOriginals = structuredClone(f.rows.get(runId + "/reading").fingerprint.payload.directAssetEvidence),
      priorBodies = [...f.originalBodies].map(([key, bytes]) => [key, Buffer.from(bytes)]);
    assert.equal(priorOriginals.assets.length, 80); assert.equal(f.originalDownloads.length, 80);
    assert.equal(f.questionReads.length, 4);
    prior.buildId = buildId;
    const oldRawHash = prior.materialHash;
    reorderFourNativeFlagSets(f.material);
    assert.notEqual(await f.ctx.hash(f.material.elements[0]), oldRawHash);
    assert.equal(await f.ctx.hash(directMaterialStabilityModelV1(f.material.elements[0])),
      priorMeta.directDataCapture.materialStability.initialSha256);
    f.edit(); await f.ctx.run();
    assert.equal(f.state.runId, runId, buildId);
    assert.equal(f.runs.size, 1);
    assert.equal(f.runs.get(runId).captureMeta.directDataCapture.resumed, true);
    assert.equal(f.runs.get(runId).captureMeta.directDataCapture.mediaEnrichment.retainedAssessmentObservations, true);
    assert.equal(f.questionReads.length, 4, "An unchanged native inventory retains actual assessment observations");
    for (const [key, value] of priorAssessments) assert.deepEqual(f.rows.get(key), value);
    assert.deepEqual(f.rows.get(runId + "/reading").fingerprint.payload.directAssetEvidence, priorOriginals);
    assert.deepEqual([...f.originalBodies], priorBodies);
    assert.equal(f.originalDownloads.length, 80, "Matching original byte bodies are not downloaded again");
    assert.deepEqual(f.runs.get(runId).budget.media, priorBudget.media);
    assert.deepEqual(structuredClone(f.ctx.mediaBase), priorBudget.media);
    assert(f.runs.get(runId).budget.requests > priorBudget.requests);
    assert(f.runs.get(runId).budget.bytes > priorBudget.bytes);
    assert.equal(JSON.stringify(priorMeta), priorMetaJson, "The comparison never normalizes a retained response in place");
    const current = f.runs.get(runId).captureMeta.directDataCapture;
    assert.equal(current.initialMaterialHash, await f.ctx.hash(f.material.elements[0]));
    assert.deepEqual(current.materials, f.material, "The new native response keeps its original flag order");
  }
});

test("semantic native changes and invalid historical comparison proof cannot use flag-order-only continuation", async () => {
  const changes = [
    ["item ID", (f, leaves) => { leaves[2].id = "ChangedQuizId"; }],
    ["atom ID", (f, leaves) => { leaves[1].atomId = "z".repeat(22); leaves[1].contentId = "atom~" + leaves[1].atomId; }],
    ["title", (f, leaves) => { leaves[1].name = "Changed reading title"; }],
    ["time", (f, leaves) => { leaves[1].timeCommitment = 900; }],
    ["graded setting", (f, leaves) => { leaves[0].content.definition.isGraded = true; }],
    ["feature membership", (f, leaves) => { leaves[0].content.definition.assignmentFeatures.pop(); }],
    ["unknown feature", (f, leaves) => { leaves[0].content.definition.assignmentFeatures.push("FUTURE_FEATURE"); }],
    ["material version", f => { f.material.elements[0].conflictMetadata = { version: 2 }; }],
    ["retained raw initial hash", (f, leaves, capture) => { capture.initialMaterialHash = "0".repeat(64); }],
    ["retained raw final hash", (f, leaves, capture) => { capture.finalMaterialHash = "0".repeat(64); }],
    ["retained comparison hash", (f, leaves, capture) => { capture.materialStability.finalSha256 = "0".repeat(64); }],
    ["missing final snapshot", (f, leaves, capture) => { delete capture.finalMaterials; }],
    ["truncated final snapshot", (f, leaves, capture) => { capture.finalMaterials.paging.next = "opaque-page"; }],
    ["duplicate final root", (f, leaves, capture) => { capture.finalMaterials.elements.push(structuredClone(capture.finalMaterials.elements[0])); }],
    ["unknown comparison policy", (f, leaves, capture) => { capture.materialStability.policy = "UNKNOWN_POLICY"; }],
    ["unstable prior capture", (f, leaves, capture) => { capture.sourceStable = false; }],
    ["partial prior capture", (f, leaves, capture) => { capture.acquisitionComplete = false; }],
    ["verified prior capture", (f, leaves, capture) => { capture.wholeCourseVerified = true; }],
  ];
  for (const [name, change] of changes) {
    const f = fixture({ assignmentFlags: true });
    await f.ctx.run();
    const firstId = f.state.runId, oldRows = structuredClone([...f.rows]),
      capture = f.runs.get(firstId).captureMeta.directDataCapture,
      leaves = reorderFourNativeFlagSets(f.material);
    change(f, leaves, capture);
    const oldRun = structuredClone(f.runs.get(firstId));
    await f.ctx.run();
    assert.notEqual(f.state.runId, firstId, name);
    assert.equal(f.runs.get(f.state.runId).captureMeta.directDataCapture.resumed, false, name);
    assert.deepEqual(f.runs.get(firstId), oldRun, name + " preserves old run history");
    for (const [key, value] of oldRows) assert.deepEqual(f.rows.get(key), value, name);
  }
});


test("retained hydration preserves unchanged checkpoint rows but persists real verifier and archive changes", async () => {
  for (const mode of ["unchanged", "object-key-reorder", "transient-body-hydration", "comparison-fallback", "verifier-withdrawal", "derived-projection", "native-array-reorder", "archive-migration"]) {
    const row = { createdAt: 100, updatedAt: 200, state: { processed: true, draftHash: "original-draft" },
      fingerprint: { id: "quiz", atomId: "a".repeat(22), captureContract: { complete: true }, payload: {
        directDataSources: { atom: { original: true, flags: ["first", "second"] }, relation: { original: true }, receipts: { observedAt: "2026-10-18T11:00:00.000Z" } },
        assessmentApiEvidence: { questionDefinitions: [{ id: "original-definition" }] },
        structuredAssessment: { questions: [{ sourceDefinitionId: "original-definition", prompt: "Exact retained question" }] },
        directAssetEvidence: { assets: [{ body: { sha256: "b".repeat(64), size: 1 } }] },
      } } }, before = structuredClone(row), writes = [], summaries = [];
    const ctx = vm.createContext({ directCanonicalSourceTextV1: value => {
      if (mode === "comparison-fallback") throw Error("DIRECT_DATA_CANONICAL_BYTE_LIMIT");
      return directCanonicalSourceTextV1(value);
    }, items: [{ id: "quiz" }], state: { runId: "same-run" }, courseId: "same-course", slug: "same-slug",
      encoder: new TextEncoder(), inventory: { leaves: new Map([["quiz", { structural: false }]]) },
      publicPageStats: { retainedUtf8Bytes: 0 }, publicPageRetainedByItem: new Map(),
      CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1: 8388608,
      store: { getItem: async () => structuredClone(row), putItem: async (runId, itemId, fingerprint, itemState) => {
        writes.push({ runId, itemId, fingerprint: structuredClone(fingerprint), state: structuredClone(itemState) });
        row.fingerprint = structuredClone(fingerprint); row.state = structuredClone(itemState); row.updatedAt++;
      } }, retainedPublicPageBytes: () => 0,
      hydrateItemBodies: async retained => {
        if (mode === "transient-body-hydration") Object.defineProperty(retained.payload.directAssetEvidence.assets[0].body,
          "bytes", { value: new Uint8Array([1]), configurable: true });
        return true;
      }, bindDirectAuthoringDraftV1: () => ({ draft: { content: { typeName: "staffGradedDraft" } } }),
      directAssessmentQuestionProjectionV1: () => ({ prompt: mode === "derived-projection" ? "Rebuilt literal native projection" : "Exact retained question" }),
      directDraftAssessmentInventoryV1: () => ({}),
      directAssessmentContractV1: retained => {
        if (mode === "verifier-withdrawal") retained.captureContract = { complete: false, reasons: ["CURRENT_VERIFIER_REJECTED"] };
        if (mode === "object-key-reorder") retained.payload.directDataSources.atom = { flags: ["first", "second"], original: true };
        if (mode === "native-array-reorder") retained.payload.directDataSources.atom.flags.reverse();
      }, directUnsupportedContractV1: () => { throw Error("Unexpected unsupported contract branch"); },
      archiveItemBodies: async retained => {
        const body = retained.payload.directAssetEvidence.assets[0].body;
        delete body.bytes;
        if (mode === "archive-migration") body.archivePath = "files/" + body.sha256;
      }, summarizeItem: (fingerprint, processed, size) => summaries.push({ fingerprint: structuredClone(fingerprint), processed, size }),
      render() {},
    });
    vm.runInContext(hydrateNode.getText(ast), ctx); await ctx.hydrateSavedItems();
    assert.equal(summaries.length, 1); assert.equal(summaries[0].processed, true); assert(summaries[0].size > 0);
    if (["unchanged", "object-key-reorder", "transient-body-hydration", "comparison-fallback"].includes(mode)) {
      assert.equal(writes.length, 0, mode + " cannot relabel a saved checkpoint with a new updatedAt");
      assert.deepEqual(row, before); assert.deepEqual(summaries[0].fingerprint, before.fingerprint);
    } else {
      assert.equal(writes.length, 1, mode + " must persist the genuine current verifier/archive change");
      assert.equal(row.createdAt, before.createdAt); assert.equal(row.updatedAt, before.updatedAt + 1);
      assert.deepEqual(row.state, before.state);
      if (mode === "native-array-reorder") assert.deepEqual(row.fingerprint.payload.directDataSources.atom.flags, ["second", "first"]);
      else assert.deepEqual(row.fingerprint.payload.directDataSources, before.fingerprint.payload.directDataSources);
      assert.deepEqual(row.fingerprint.payload.assessmentApiEvidence, before.fingerprint.payload.assessmentApiEvidence);
      if (mode === "derived-projection") assert.equal(row.fingerprint.payload.structuredAssessment.questions[0].prompt, "Rebuilt literal native projection");
      else assert.deepEqual(row.fingerprint.payload.structuredAssessment, before.fingerprint.payload.structuredAssessment);
      if (mode === "verifier-withdrawal") assert.equal(row.fingerprint.captureContract.complete, false);
      if (mode === "archive-migration") assert.equal(row.fingerprint.payload.directAssetEvidence.assets[0].body.archivePath, "files/" + "b".repeat(64));
    }
  }
});
