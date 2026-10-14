import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import {
  CTI_DIRECT_DATA_VERSION_V1,
  CTI_DIRECT_DATA_BUILD_V1,
  CTI_DIRECT_DATA_EXPORT_BYTES_V1,
  CTI_DIRECT_DATA_MAX_PARTS_V1,
} from "../src/extractors/coursera/direct-data-config.js";

// Exercise the maintained orchestration IIFE, not a second implementation of
// its lifecycle. Network, IDB and source parsing have separate focused suites;
// the controlled boundaries here make resume/export races observable.
const entryPath = new URL(
  "../src/extractors/coursera/direct-data-entry.js",
  import.meta.url,
);
const entrySource = await readFile(entryPath, "utf8");
const parsedEntry = ts.createSourceFile(
  entryPath.pathname,
  entrySource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
assert.equal(parsedEntry.parseDiagnostics.length, 0);
const source = parsedEntry.statements
  .filter(ts.isImportDeclaration)
  .reverse()
  .reduce((text, statement) => {
    const start = statement.getStart(parsedEntry),
      end = statement.end;
    // Preserve source positions and newlines for useful entry stack traces.
    return (
      text.slice(0, start) +
      text.slice(start, end).replace(/[^\r\n]/g, " ") +
      text.slice(end)
    );
  }, entrySource);
const COURSE = "Synthetic_course",
  OTHER_COURSE = "Another_course",
  SLUG = "synthetic-course";
const clone = (value) => structuredClone(value);
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    // WebCrypto settles through libuv's worker pool. A fixed number of rapid
    // setImmediate turns can finish before that worker is scheduled on CI.
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(message);
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

function harness(options = {}) {
  let now = 1_800_000_000_000,
    nextRun = 0,
    nextReader = 0,
    activeItemReads = 0;
  const nodes = [],
    items = new Map(),
    runs = new Map(),
    urls = new Map(),
    factories = [],
    calls = [],
    alerts = [],
    downloads = [],
    events = new Map();
  const metrics = {
    itemReads: [],
    maxActiveItemReads: 0,
    listItemCalls: 0,
    saves: [],
    writes: [],
  };
  const control = {
    beforeRead: options.beforeRead,
    holdItemReads: null,
    holdPutItem: null,
    materialRevision: 1,
  };
  const ids = options.ids || ["ReadingA", "ReadingB"];
  const fingerprint = (id) => ({
    id,
    type: "reading",
    name: id,
    atomId: "Atom_" + id,
    payload: {},
    sourceIdentity: {},
  });
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.style = {};
      this.textContent = "";
      this.hidden = false;
      this.disabled = false;
      nodes.push(this);
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    append(...children) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
    }
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter(
          (node) => node !== this,
        );
      this.removed = true;
    }
    scrollIntoView() {
      this.focused = true;
    }
    click() {
      if (this.disabled) return;
      if (this.tagName === "A")
        downloads.push({ name: this.download, blob: urls.get(this.href) });
      else this.onclick?.();
    }
  }
  const body = new Element("body");
  const document = {
    body,
    title: "Synthetic Coursera course",
    createElement: (name) => new Element(name),
    getElementById: (id) =>
      nodes.find((node) => node.id === id && !node.removed),
  };
  const location = {
    origin: "https://www.coursera.org",
    pathname: `/teach/${SLUG}/${COURSE}/content/edit`,
    get href() {
      return this.origin + this.pathname;
    },
  };
  const contract = (fp, method, complete, reasons = []) => {
    fp.captureContract = {
      complete,
      method,
      reasons,
      contentPartsCaptured: complete,
    };
    return fp.captureContract;
  };
  const store = {
    available: true,
    async getActiveRun() {
      const active = [...runs.values()].filter((row) =>
        ["RUNNING", "PAUSED"].includes(row.state),
      );
      return clone(active.at(-1) || null);
    },
    async openRun(requested, metadata) {
      const runId = requested || `synthetic-run-${++nextRun}`;
      const row = {
        createdAt: now,
        ...runs.get(runId),
        ...clone(metadata),
        runId,
        updatedAt: now,
      };
      runs.set(runId, row);
      return clone(row);
    },
    async saveRun(value) {
      metrics.saves.push(clone(value));
      const row = { ...runs.get(value.runId), ...clone(value), updatedAt: now };
      runs.set(value.runId, row);
      return clone(row);
    },
    async putItem(runId, itemId, fp, state) {
      if (control.holdPutItem) await control.holdPutItem.promise;
      metrics.writes.push({ runId, itemId, state: clone(state) });
      items.set(`${runId}/${itemId}`, {
        runId,
        itemId,
        fingerprint: clone(fp),
        state: clone(state),
      });
    },
    async getItem(runId, itemId) {
      metrics.itemReads.push({ runId, itemId });
      activeItemReads++;
      metrics.maxActiveItemReads = Math.max(
        metrics.maxActiveItemReads,
        activeItemReads,
      );
      try {
        if (control.holdItemReads) await control.holdItemReads.promise;
        await turn();
        return clone(items.get(`${runId}/${itemId}`) || null);
      } finally {
        activeItemReads--;
      }
    },
    async listItems(runId) {
      metrics.listItemCalls++;
      return clone([...items.values()].filter((row) => row.runId === runId));
    },
    async putGroup() {},
    async getDefinition() {
      return null;
    },
    async putDefinition() {},
  };
  function createReader(readerOptions) {
    const limits = {
      requests: 1000,
      totalBytes: 1_000_000,
      durationMs: 60_000,
      requestMs: 30_000,
      bodyBytes: 100_000,
      concurrentRequests: 2,
      ...readerOptions.limits,
    };
    const metrics = {
      requests: 0,
      bytes: 0,
      completed: 0,
      failed: 0,
      retries: 0,
      rateLimitRetries: 0,
      active: 0,
      queued: 0,
      maxConcurrentRequests: 2,
      stopped: false,
      stopReason: "",
      byResource: {},
      limits,
    };
    const createdAt = now;
    const policyOnly = !readerOptions.sanitize;
    const readerIndex = policyOnly ? -1 : nextReader++;
    const factory = {
      options: clone(readerOptions.limits || {}),
      metrics,
      policyOnly,
    };
    factories.push(factory);
    function abort(reason) {
      metrics.stopped = true;
      metrics.stopReason ||= reason;
    }
    async function read(resource, id) {
      if (!readerOptions.assertCurrent()) abort("CONTEXT_CHANGED");
      if (metrics.requests >= limits.requests)
        abort("COURSE_API_REQUEST_LIMIT");
      if (metrics.bytes + 64 > limits.totalBytes)
        abort("COURSE_API_BYTE_LIMIT");
      if (now - createdAt >= limits.durationMs) abort("COURSE_API_TIME_LIMIT");
      if (metrics.stopped) return { ok: false, reason: metrics.stopReason };
      metrics.requests++;
      metrics.bytes += 64;
      metrics.byResource[resource] = (metrics.byResource[resource] || 0) + 1;
      const call = {
        factory: readerIndex,
        resource,
        id,
        at: now,
      };
      calls.push(call);
      now += options.readMs || 1;
      const failure =
        (await control.beforeRead?.(call, { abort, metrics })) ||
        (metrics.stopped ? metrics.stopReason : "");
      readerOptions.onStats?.();
      if (failure) {
        metrics.failed++;
        return { ok: false, reason: failure };
      }
      let element = { id };
      if (resource === "materials")
        element = { id, revision: control.materialRevision, itemIds: ids };
      if (resource === "atom")
        element = {
          id,
          storedAtomVersion: 1,
          updatedAt: 1,
          draft: {
            name: id,
            content: { typeName: "supplementDraft" },
          },
        };
      metrics.completed++;
      return {
        ok: true,
        data: { elements: [element] },
        receipt: {
          originalResponseSha256: "a".repeat(64),
          observedAt: new Date(now).toISOString(),
          status: 200,
          bytes: 64,
          resource,
        },
      };
    }
    return {
      readCourseMaterials: (id) => read("materials", id),
      readCourse: (id) => read("course", id),
      readAtom: (id) => read("atom", id),
      readRelation: (id) => read("relation", id),
      readGroup: (id) => read("group", id),
      readDefinition: (id) => read("definition", id),
      snapshot: () => ({ ...clone(metrics), elapsedMs: now - createdAt }),
      abort,
    };
  }
  class ClockDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const globals = {
    CTI_DIRECT_DATA_VERSION_V1,
    CTI_DIRECT_DATA_BUILD_V1,
    CTI_DIRECT_DATA_EXPORT_BYTES_V1,
    CTI_DIRECT_DATA_MAX_PARTS_V1,
    location,
    document,
    crypto: { subtle: webcrypto.subtle, randomUUID: webcrypto.randomUUID },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Blob,
    URL: {
      createObjectURL(blob) {
        const url = "blob:synthetic-" + (urls.size + 1);
        urls.set(url, blob);
        return url;
      },
      revokeObjectURL() {},
    },
    Date: ClockDate,
    alert: (message) => alerts.push(message),
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    createDirectDataCheckpointStoreV1: async () => store,
    createDirectDataReaderV1: createReader,
    sanitizeCourseraCourseDataModel: () => {},
    directCanonicalSourceTextV1: JSON.stringify,
    directCourseInventoryV1: async () => ({
      fingerprints: ids.map(fingerprint),
      leaves: new Map(ids.map((id) => [id, { node: { id }, ancestorIds: [] }])),
      materialVersion: 1,
      courseBranchVersion: 1,
    }),
    bindDirectAuthoringDraftV1: (fp, courseId, slug, atomData) => ({
      atomId: fp.atomId,
      ...atomData.elements[0],
    }),
    directDraftReadingSourceV1: () => ({ rawCML: "Synthetic reading" }),
    directReadingPayloadV1: async (fp) => {
      fp.payload.reading = "Synthetic reading";
      contract(fp, "DIRECT_READING", true);
      await options.readingPayload?.(fp);
    },
    applyDirectContractV1: contract,
    directEmptyStructureContractV1: (fp) =>
      contract(fp, "DIRECT_STRUCTURE", true),
    directUnsupportedContractV1: (fp, reason) =>
      contract(fp, "DIRECT_UNSUPPORTED", false, [reason]),
    captureAccountingItemsV61531: (summaries, { unvisitedTargetIds }) => ({
      complete:
        unvisitedTargetIds.length === 0 && summaries.every((fp) => fp.complete),
      noSilentMisses: true,
    }),
    directDraftAssessmentInventoryV1: () => {
      throw Error("Unexpected assessment fixture");
    },
    directAssessmentContractV1() {},
    parseCourseraCheckboxDefinitionDirectV1() {},
    directCmlTextV1() {},
    parseCourseraMcqDefinitionV61524() {},
    assessmentCaptureCoverageV613() {},
    __CTI_COURSERA_DIRECT_DATA_LIMITS__: options.limits,
    addEventListener(name, listener) {
      events.set(name, listener);
    },
  };
  globals.window = globals;
  globals.top = globals;
  const context = vm.createContext(globals);
  const execute = () =>
    new vm.Script(source, { filename: entryPath.pathname }).runInContext(
      context,
    );
  const state = () => context.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;
  const button = (label) =>
    nodes.find(
      (node) => node.tagName === "BUTTON" && node.textContent === label,
    );
  const idle = async () =>
    until(
      () =>
        state() &&
        !state().running &&
        !button("Download saved capture").disabled,
      "Entry never reached a downloadable idle state: " +
        JSON.stringify({ state: state(), alerts }),
    );
  return {
    execute,
    state,
    button,
    idle,
    context,
    location,
    nodes,
    items,
    runs,
    store,
    calls,
    factories,
    readers: () => factories.filter((factory) => !factory.policyOnly),
    metrics,
    control,
    alerts,
    downloads,
    advance: (ms) => (now += ms),
    fire: (name) => events.get(name)?.(),
  };
}

test("the actual entry captures drafts without navigation and exports its saved inventory", async () => {
  const app = harness();
  const initialPath = app.location.pathname;
  app.execute();
  await app.idle();
  assert.equal(app.state().state, "COMPLETE");
  assert.equal(app.location.pathname, initialPath);
  assert.equal(app.downloads.length, 1);
  const output = JSON.parse(await app.downloads[0].blob.text());
  assert.equal(output.directDataCapture, undefined);
  assert.equal(output.meta.directDataCapture.wholeCourseVerified, true);
  assert.deepEqual(
    output.fingerprints.map((fp) => fp.id),
    ["ReadingA", "ReadingB"],
  );
  assert.equal(app.metrics.listItemCalls, 0);
  assert.equal(app.metrics.maxActiveItemReads, 1);
  assert.deepEqual(app.alerts, []);
});

test("a second click focuses an active capture rather than creating another reader", async () => {
  const held = deferred();
  const app = harness({
    beforeRead: async ({ resource }) => {
      if (resource === "materials") await held.promise;
    },
  });
  app.execute();
  await until(() => app.readers().length === 1, "Reader did not start");
  app.execute();
  assert.equal(app.readers().length, 1);
  assert.equal(
    app.context.document.getElementById("cti-direct-data-capture-v1").focused,
    true,
  );
  held.resolve();
  await app.idle();
});

test("paused runs keep request, byte and time budgets across Resume", async () => {
  const resumedItem = deferred();
  let reachedResumedItem = false;
  const app = harness({
    limits: { requests: 100, totalBytes: 10_000, durationMs: 60_000 },
    readMs: 100,
    beforeRead: async ({ factory, resource, id }, { abort }) => {
      if (factory === 0 && resource === "atom" && id === "Atom_ReadingB") {
        abort("NETWORK_FAILED");
        return "NETWORK_FAILED";
      }
      if (factory === 1 && resource === "atom" && id === "Atom_ReadingA") {
        reachedResumedItem = true;
        await resumedItem.promise;
      }
    },
  });
  app.execute();
  await app.idle();
  assert.equal(app.state().state, "PAUSED");
  const first = app.readers()[0].metrics;
  const firstRun = app.state().runId;
  const savedBudget = clone(app.runs.get(firstRun).budget);
  const before = clone(app.state().counts);
  assert.equal(before.processed, 1);
  app.advance(1000);
  app.state().resume();
  await until(
    () => reachedResumedItem,
    "Resumed capture never reached the current draft check",
  );
  assert.equal(app.state().counts.processed, before.processed);
  assert.equal(app.state().counts.complete, before.complete);
  assert.equal(app.state().counts.total, before.total);
  resumedItem.resolve();
  await app.idle();
  assert.equal(app.state().runId, firstRun);
  assert.equal(app.readers().length, 2);
  assert.equal(app.readers()[1].options.requests, 100 - savedBudget.requests);
  assert.equal(app.readers()[1].options.totalBytes, 10_000 - savedBudget.bytes);
  assert.equal(
    app.readers()[1].options.durationMs,
    60_000 - savedBudget.elapsedMs,
  );
  const output = JSON.parse(await app.downloads.at(-1).blob.text());
  assert.equal(
    output.meta.directDataCapture.stats.requests,
    first.requests + app.readers()[1].metrics.requests,
  );
  assert.equal(
    output.meta.directDataCapture.stats.bytes,
    first.bytes + app.readers()[1].metrics.bytes,
  );
  assert.equal(output.meta.directDataCapture.resumed, true);
  assert.equal(
    app.metrics.listItemCalls,
    0,
    "Resume must hydrate saved items one at a time",
  );
  assert.equal(app.metrics.maxActiveItemReads, 1);
});

test("manual Pause preserves saved reads and Resume can restart the same course", async () => {
  const held = deferred();
  let reachedItem = false;
  const app = harness({
    beforeRead: async ({ factory, resource }) => {
      if (factory === 0 && resource === "atom") {
        reachedItem = true;
        await held.promise;
      }
    },
  });
  app.execute();
  await until(() => reachedItem, "Capture never began reading an item");
  app.state().stop();
  held.resolve();
  await app.idle();
  assert.equal(app.state().state, "PAUSED");
  assert.equal(
    app.downloads.length,
    0,
    "Manual Pause keeps export under operator control",
  );
  const runId = app.state().runId;
  app.state().resume();
  await until(
    () => app.readers().length === 2,
    "Manual Pause incorrectly prevented Resume",
  );
  await app.idle();
  assert.equal(app.state().state, "COMPLETE");
  assert.equal(app.state().runId, runId);
});

test("an already exhausted saved run restores its partial inventory without starting network reads", async () => {
  const app = harness({
    limits: { requests: 100 },
    beforeRead: ({ factory, resource, id }, { abort }) => {
      if (factory === 0 && resource === "atom" && id === "Atom_ReadingB") {
        abort("NETWORK_FAILED");
        return "NETWORK_FAILED";
      }
    },
  });
  app.execute();
  await app.idle();
  const runId = app.state().runId,
    row = app.runs.get(runId),
    readerCount = app.readers().length,
    callCount = app.calls.length;
  row.budget.requests = row.budget.limits.requests;
  app.state().resume();
  await app.idle();
  assert.equal(app.readers().length, readerCount);
  assert.equal(app.calls.length, callCount);
  assert.equal(app.state().terminal, true);
  assert.equal(app.state().state, "INCOMPLETE");
  assert.equal(app.state().counts.processed, 1);
  const output = JSON.parse(await app.downloads.at(-1).blob.text());
  assert.equal(output.meta.directDataCapture.runId, runId);
  assert.equal(output.meta.directDataCapture.wholeCourseVerified, false);
  assert.equal(
    output.meta.directDataCapture.stopReason,
    "COURSE_API_REQUEST_LIMIT",
  );
  assert.equal(output.fingerprints[0].payload.reading, "Synthetic reading");
  assert.deepEqual(
    output.fingerprints.map((fp) => fp.id),
    ["ReadingA", "ReadingB"],
  );
});

test("a hard exhausted budget blocks same-run Resume and a new bookmark click starts a separate run", async () => {
  const app = harness({ limits: { requests: 5 } });
  app.execute();
  await app.idle();
  assert.notEqual(app.state().state, "COMPLETE");
  const readers = app.readers().length,
    runId = app.state().runId;
  assert.equal(
    app.button("Resume").hidden || app.button("Resume").disabled,
    true,
  );
  app.state().resume();
  await turn();
  await turn();
  assert.equal(
    app.readers().length,
    readers,
    "Exhausted same-run allowances may not reset",
  );
  app.execute();
  await app.idle();
  assert.notEqual(app.state().runId, runId);
  assert.equal(app.readers().length, readers + 1);
});

test("asynchronous export blocks Resume and captures one stable run snapshot", async () => {
  const app = harness({
    beforeRead: ({ factory, resource, id }, { abort }) => {
      if (factory === 0 && resource === "atom" && id === "Atom_ReadingB") {
        abort("NETWORK_FAILED");
        return "NETWORK_FAILED";
      }
    },
  });
  app.execute();
  await app.idle();
  assert.equal(app.state().state, "PAUSED");
  const runId = app.state().runId,
    readers = app.readers().length,
    held = deferred(),
    initialReads = app.metrics.itemReads.length;
  app.control.holdItemReads = held;
  app.state().export();
  await until(
    () => app.metrics.itemReads.length > initialReads,
    "Export did not begin reading its saved item",
  );
  assert.equal(
    app.button("Resume").hidden || app.button("Resume").disabled,
    true,
  );
  app.state().resume();
  await turn();
  assert.equal(app.readers().length, readers);
  held.resolve();
  await app.idle();
  assert.equal(app.state().runId, runId);
  const output = JSON.parse(await app.downloads.at(-1).blob.text());
  assert.equal(output.meta.directDataCapture.runId, runId);
  assert.deepEqual(
    output.fingerprints.map((fp) => fp.id),
    ["ReadingA", "ReadingB"],
  );
});

test("a prior global from another course does not hijack this bookmark's capture", async () => {
  const app = harness();
  let resumed = 0,
    focused = 0;
  app.context.__CTI_COURSERA_DIRECT_DATA_CAPTURE__ = {
    courseId: OTHER_COURSE,
    running: false,
    state: "PAUSED",
    resume: () => resumed++,
    focus: () => focused++,
  };
  app.execute();
  await app.idle();
  assert.equal(resumed, 0);
  assert.equal(focused, 0);
  assert.equal(app.state().courseId, COURSE);
  assert.equal(app.state().state, "COMPLETE");
  assert.equal(app.readers().length, 1);
});

test("interrupted resume revalidation preserves the saved item body as unverified evidence", async () => {
  const app = harness({
    beforeRead: ({ factory, resource, id }, { abort }) => {
      if (
        resource === "atom" &&
        ((factory === 0 && id === "Atom_ReadingB") ||
          (factory === 1 && id === "Atom_ReadingA"))
      ) {
        abort("NETWORK_FAILED");
        return "NETWORK_FAILED";
      }
    },
  });
  app.execute();
  await app.idle();
  const runId = app.state().runId,
    savedKey = `${runId}/ReadingA`,
    earlier = clone(app.items.get(savedKey).fingerprint);
  assert.equal(earlier.payload.reading, "Synthetic reading");
  assert.equal(earlier.captureContract.complete, true);
  app.state().resume();
  await app.idle();
  assert.equal(app.state().state, "PAUSED");
  assert.equal(app.state().runId, runId);
  const retained = app.items.get(savedKey);
  assert.equal(retained.fingerprint.payload.reading, earlier.payload.reading);
  assert.deepEqual(
    retained.fingerprint.payload.directDataSources,
    earlier.payload.directDataSources,
    "Previously observed source models and receipts must survive a failed revalidation",
  );
  assert.equal(retained.state.processed, false);
  assert.equal(retained.fingerprint.captureContract.complete, false);
  assert.equal(
    retained.fingerprint.payload.directResumeRevalidation.verified,
    false,
  );
  assert.equal(
    retained.fingerprint.payload.directResumeRevalidation.reason,
    "NETWORK_FAILED",
  );
  const output = JSON.parse(await app.downloads.at(-1).blob.text());
  const first = output.fingerprints.find((fp) => fp.id === "ReadingA");
  assert.equal(first.payload.reading, "Synthetic reading");
  assert.equal(first.captureContract.complete, false);
  assert.equal(output.meta.directDataCapture.wholeCourseVerified, false);
  assert.equal(output.meta.directDataCapture.acquisitionComplete, false);
});

test("an oversized unpersisted item exports only a fresh lightweight inventory stub", async () => {
  const exportLimit = 512 * 1024;
  const app = harness({
    readingPayload: (fp) => {
      fp.payload.unpersistedOversizedBody = "x".repeat(exportLimit + 1);
    },
  });
  app.context.CTI_DIRECT_DATA_EXPORT_BYTES_V1 = exportLimit;
  app.execute();
  await app.idle();
  assert.equal(app.state().state, "INCOMPLETE");
  assert.equal(app.state().terminal, true);
  assert.equal(app.state().counts.processed, 0);
  assert.equal(
    app.items.size,
    0,
    "The oversized item must not reach the checkpoint store",
  );
  assert.equal(app.downloads.length, 1);
  assert(app.downloads[0].blob.size < exportLimit);
  const output = JSON.parse(await app.downloads[0].blob.text());
  assert.equal(output.meta.directDataCapture.wholeCourseVerified, false);
  assert.equal(output.meta.directDataCapture.acquisitionComplete, false);
  assert.equal(
    output.meta.directDataCapture.stopReason,
    "DIRECT_CAPTURE_EXPORT_BYTE_LIMIT",
  );
  assert.deepEqual(
    output.fingerprints.map((fp) => fp.id),
    ["ReadingA", "ReadingB"],
  );
  assert.equal(
    output.fingerprints[0].payload.unpersistedOversizedBody,
    undefined,
  );
  assert.equal(output.fingerprints[0].payload.reading, undefined);
  assert.equal(output.fingerprints[0].captureContract.complete, false);
  assert.equal(output.meta.captureAccounting.complete, false);
});
