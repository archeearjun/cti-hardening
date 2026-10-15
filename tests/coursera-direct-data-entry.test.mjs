import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import JSZip from "jszip";
import { directDraftWidgetProviderV1, directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1 } from "../src/extractors/coursera/direct-data-widget.js";
import { createDirectDataArchiveV1 } from "../src/extractors/coursera/direct-data-archive.js";
import { decodeDirectAssetBodyV1, directAssetMetadataBindingV1 } from "../src/extractors/coursera/direct-data-media.js";
import ts from "typescript";
import {
  directDataCoverageSummaryV1,
  directDataAttemptMetricsV1,
} from "../src/extractors/coursera/direct-data-summary.js";
import {
  CTI_DIRECT_DATA_VERSION_V1,
  CTI_DIRECT_DATA_BUILD_V1,
  CTI_DIRECT_DATA_EXPORT_BYTES_V1,
  CTI_DIRECT_DATA_COMPRESSED_BYTES_V1,
  CTI_DIRECT_DATA_MEDIA_BYTES_V1,
  CTI_DIRECT_DATA_ARCHIVE_BYTES_V1,
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
const bytesForMediaLabel = (label) => Buffer.from({
  "old-body": "ORIGINAL", "new-body": "UPDATED!", "new-body-with-failed-metadata": "FAILED!!",
}[label]);
const mediaSha = (label) => createHash("sha256").update(bytesForMediaLabel(label)).digest("hex");
async function exportedCapture(download) {
  assert(download.name.endsWith(".zip"));
  const zip = await JSZip.loadAsync(await download.blob.arrayBuffer(), { checkCRC32: true });
  const json = gunzipSync(await zip.file("capture.json.gz").async("nodebuffer"));
  const capture = JSON.parse(json.toString("utf8"));
  return { capture, zip };
}
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
    bodies = new Map(),
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
    bodyWrites: [],
  };
  const control = {
    beforeRead: options.beforeRead,
    holdItemReads: null,
    holdPutItem: null,
    materialRevision: 1,
  };
  const ids = options.ids || ["ReadingA", "ReadingB"];
  const widgetAtoms = new Map((options.widgetIds || []).map((id, index) => [id, String.fromCharCode(75 + index).repeat(22)]));
  const widgetProviders = new Map((options.widgetIds || []).map((id, index) => [id, String.fromCharCode(112 + index).repeat(22)]));
  const widgetItemsByAtom = new Map([...widgetAtoms].map(([id, atom]) => [atom, id]));
  const fingerprint = (id) => ({
    id,
    type: widgetAtoms.has(id) ? "Plugin" : options.assignmentIds?.includes(id) ? "assignment" : "reading",
    typeName: widgetAtoms.has(id) ? "ungradedWidget" : options.assignmentIds?.includes(id) ? "staffGraded" : "supplement",
    name: id,
    atomId: widgetAtoms.get(id) || "Atom_" + id,
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
        ["RUNNING", "PAUSED"].includes(row.state) || row.state === "INCOMPLETE" &&
          row.captureMeta?.directDataCapture?.acquisitionComplete === true &&
          row.captureMeta.directDataCapture.stopReason === "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS",
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
    async putBody(runId, sha256, blob, metadata) {
      assert.equal(createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex"), sha256);
      const key = runId + "/" + sha256;
      if (!bodies.has(key)) {
        bodies.set(key, { runId, sha256, size: blob.size, mime: metadata.mime, blob, archivePath: "files/" + sha256 });
        metrics.bodyWrites.push({ runId, sha256, size: blob.size });
      }
      return { ...bodies.get(key), blob: undefined };
    },
    async getBody(runId, sha256) {
      const body = bodies.get(runId + "/" + sha256);
      if (body) assert.equal(createHash("sha256").update(Buffer.from(await body.blob.arrayBuffer())).digest("hex"), sha256);
      return body ? { ...body } : null;
    },
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
    async function read(resource, id, courseId) {
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
        ...(courseId ? { courseId } : {}),
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
            content: clone(
              options.readingContent?.({ factory: readerIndex, id }) ||
              (widgetItemsByAtom.has(id) ? {
                typeName: "widgetDraft", definition: { providerId: widgetProviders.get(widgetItemsByAtom.get(id)), isGraded: false },
              } : {
                typeName: "supplementDraft",
              }),
            ),
          },
        };
      if (resource === "widget")
        element = { id, metadata: { updatedAt: 1 }, draft: {
          configuration: { url: "https://widget.example.test/embed?id=" + id + "&autoplay=false" },
          pageSrc: "https://widget.example.test/embed?id=" + id + "&autoplay=false",
        } };
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
      readWidgetProvider: (id, courseId) => read("widget", id, courseId),
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
    CTI_DIRECT_DATA_COMPRESSED_BYTES_V1,
    CTI_DIRECT_DATA_MEDIA_BYTES_V1,
    CTI_DIRECT_DATA_ARCHIVE_BYTES_V1,
    CTI_DIRECT_DATA_MAX_PARTS_V1,
    directDataCoverageSummaryV1,
    directDataAttemptMetricsV1,
    location,
    document,
    crypto: { subtle: webcrypto.subtle, randomUUID: webcrypto.randomUUID },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Blob,
    CompressionStream,
    createDirectDataArchiveV1,
    decodeDirectAssetBodyV1,
    directAssetMetadataBindingV1,
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
    createDirectDataMediaReaderV1: (settings) => {
      assert.equal(typeof options.mediaReaderFactory, "function");
      return options.mediaReaderFactory(settings);
    },
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
      itemId: fp.id, courseId, courseSlug: slug, contentId: fp.contentId,
      sourceState: "AUTHORING_DRAFT",
      ...atomData.elements[0],
    }),
    directDraftWidgetProviderV1,
    directWidgetProviderSourceV1,
    directWidgetProviderTargetsV1,
    directWidgetContractV1: (fp) => {
      const valid = fp.payload.directWidgetProviderEvidence?.stableSource === true;
      const result = contract(fp, "DIRECT_WIDGET", false,
        [valid ? "DIRECT_WIDGET_EXTERNAL_BODY_NOT_OBSERVED" : "DIRECT_WIDGET_PROVIDER_SOURCE_INVALID"]);
      result.sourceConfigurationVerified = valid;
      result.externalBodyVerified = false;
      return result;
    },
    directDraftReadingSourceV1: (bound) =>
      options.readingSource?.(bound) || { rawCML: "Synthetic reading" },
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
      if (options.assessmentInventory) return options.assessmentInventory();
      throw Error("Unexpected assessment fixture");
    },
    directAssessmentContractV1: (fp) => options.assessmentInventory && contract(fp, "DIRECT_ASSESSMENT", true),
    parseCourseraCheckboxDefinitionDirectV1() {},
    directCmlTextV1: options.parseCml || (() => undefined),
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
      (node) => {
        if (node.tagName !== "BUTTON" || node.textContent !== label) return false;
        for (let ancestor = node; ancestor; ancestor = ancestor.parent) if (ancestor.removed) return false;
        return true;
      },
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
    bodies,
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
  const output = (await exportedCapture(app.downloads[0])).capture;
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
  const output = (await exportedCapture(app.downloads.at(-1))).capture;
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

function readingMediaOptions({
  failFinalAtom = false,
  failMetadata = false,
  failMetadataAfterBody = false,
  reuseRetainedOnFirst = false,
} = {}) {
  const assetId = "a".repeat(22),
    sourceAssetId = "r".repeat(22) + "@1",
    cml = '<co-content><asset id="' + assetId + '" /></co-content>',
    mediaCalls = [],
    settings = [];
  let mediaAttempt = 0,
    resumedAtomReads = 0,
    currentCml = cml;
  const record = (label) => ({
    assetId,
    metadata: { elements: [{ id: assetId, label, name: "source-" + label + ".bin", typeName: "file", url: {url: "https://fixture.cloudfront.net/" + label + ".bin"} }] },
    metadataReceipt: { retainedMarker: label },
    body: {
      base64: bytesForMediaLabel(label).toString("base64"),
      size: 8,
      mime: "application/octet-stream",
      sha256: mediaSha(label),
      receipt: { observedAt: "original-" + label, bodyFormat: "ORIGINAL_BINARY_BYTES_BASE64" },
    },
    stability: {
      stable: true,
      metadata: { elements: [{ id: assetId, label }] },
    },
  });
  const options = {
    readingContent: () => ({
      typeName: "supplementDraft",
      definition: {
        assetId: sourceAssetId,
        content: {
          typeName: "cml",
          definition: { dtdId: "supplement/1", value: currentCml },
        },
      },
    }),
    readingSource: (bound) => {
      const definition = bound.draft.content.definition;
      return {
        rawCML: definition.content,
        cml: definition.content.definition.value,
        dtdId: definition.content.definition.dtdId,
        assetId: definition.assetId,
      };
    },
    parseCml: () => ({ references: [{ id: assetId, tag: "asset" }] }),
    beforeRead: ({ factory, resource, id }, { abort }) => {
      if (factory === 0 && resource === "atom" && id === "Atom_ReadingB") {
        abort("NETWORK_FAILED");
        return "NETWORK_FAILED";
      }
      if (
        failFinalAtom &&
        factory === 1 &&
        resource === "atom" &&
        id === "Atom_ReadingA" &&
        ++resumedAtomReads === 2
      ) {
        abort("NETWORK_FAILED");
        return "NETWORK_FAILED";
      }
    },
    readingPayload(fp) {
      if (fp.payload.directAssetEvidence?.failures.length) {
        fp.captureContract.complete = false;
        fp.captureContract.contentPartsCaptured = false;
        fp.captureContract.reasons = ["DIRECT_READING_ASSETS_UNRESOLVED"];
      }
    },
    mediaReaderFactory: (configuration) => {
      const attempt = mediaAttempt++,
        metrics = { bytes: 0, requests: 0 };
      settings.push(clone(configuration.limits));
      return {
        async capture(id, retained) {
          mediaCalls.push({ attempt, id, retained: clone(retained) });
          metrics.requests++;
          if (attempt === 1 && failMetadata)
            return { assetId: id, reason: "DIRECT_ASSET_METADATA_FAILED" };
          if (attempt === 1 && failMetadataAfterBody)
            return {
              ...record("new-body-with-failed-metadata"),
              reason: "DIRECT_ASSET_STABILITY_FAILED",
              stability: { stable: false },
            };
          if (
            retained?.body &&
            (reuseRetainedOnFirst || attempt >= 2 || configuration.limits.totalBytes === 0)
          ) {
            return clone(retained);
          }
          if (configuration.limits.totalBytes === 0)
            return { assetId: id, reason: "DIRECT_MEDIA_BYTE_LIMIT" };
          metrics.bytes += 8;
          return record(attempt === 0 ? "old-body" : "new-body");
        },
        snapshot: () => clone(metrics),
        abort() {},
        release() {},
      };
    },
  };
  return {
    options,
    mediaCalls,
    settings,
    assetRecord: record,
    cml,
    changeCml: () =>
      (currentCml = cml.replace("<asset", "<text>changed</text><asset")),
  };
}

test("a failed final atom check retains fresh media bytes for the same bound reading without certifying them", async () => {
  const fixture = readingMediaOptions({ failFinalAtom: true }),
    app = harness(fixture.options);
  app.execute();
  await app.idle();
  const runId = app.state().runId,
    first = app.items.get(runId + "/ReadingA").fingerprint;
  assert.equal(
    first.payload.directAssetEvidence.assets[0].body.sha256,
    mediaSha("old-body"),
  );
  assert.equal(first.payload.directDataSources.receipts.stability.stable, true);
  app.state().resume();
  await app.idle();
  assert.equal(app.state().state, "PAUSED");
  const interrupted = app.items.get(runId + "/ReadingA").fingerprint;
  assert.equal(
    interrupted.payload.directAssetEvidence.assets[0].body.sha256,
    mediaSha("new-body"),
    "new raw bytes survive a failed final source read",
  );
  assert.equal(
    interrupted.payload.directDataSources.receipts.stability.stable,
    false,
  );
  assert.equal(interrupted.captureContract.complete, false);
  assert.equal(interrupted.payload.directResumeRevalidation.verified, false);
  assert.equal(
    interrupted.payload.directResumeRevalidation.reason,
    "NETWORK_FAILED",
  );
  assert.equal(app.runs.get(runId).budget.media.bytes, 16);
  assert.equal(fixture.mediaCalls[1].retained.body.sha256, mediaSha("old-body"));
  app.state().resume();
  await app.idle();
  assert.equal(app.state().state, "COMPLETE");
  assert.equal(app.state().runId, runId);
  assert.equal(
    fixture.mediaCalls.find((call) => call.attempt === 2).retained.body.sha256,
    mediaSha("new-body"),
    "a later fresh source check can reuse the interrupted native media proof",
  );
  assert.equal(app.runs.get(runId).budget.media.bytes, 24);
});

test("a failed media metadata revalidation retains historical bytes separately and keeps the reading incomplete", async () => {
  const fixture = readingMediaOptions({ failMetadata: true }),
    app = harness(fixture.options);
  app.execute();
  await app.idle();
  const runId = app.state().runId;
  app.state().resume();
  await app.idle();
  const failed = app.items.get(runId + "/ReadingA").fingerprint,
    asset = failed.payload.directAssetEvidence.assets[0];
  assert.equal(asset.reason, "DIRECT_ASSET_METADATA_FAILED");
  assert.equal(
    asset.body,
    undefined,
    "failed current evidence cannot look verified",
  );
  assert.equal(asset.retainedEvidence.body.sha256, mediaSha("old-body"));
  assert.equal(failed.captureContract.complete, false);
  assert.equal(failed.payload.directAssetEvidence.failures.length, 1);
  // The controlled store exposes normal PAUSED work; real checkpoint selection
  // separately tests completed media-gap recovery from INCOMPLETE runs.
  app.runs.get(runId).state = "PAUSED";
  app.state().resume();
  await app.idle();
  assert.equal(app.state().state, "COMPLETE");
  assert(
    app.nodes.some((node) =>
      node.textContent.includes("inventory entries retained"),
    ),
    "a media-only continuation identifies retained inventory",
  );
  assert(
    app.nodes.some((node) =>
      node.textContent.includes(
        "Saved questions retain their original capture timestamps",
      ),
    ),
    "the card must distinguish historical question observations",
  );
  assert.equal(
    fixture.mediaCalls.find((call) => call.attempt === 2).retained.body.sha256,
    mediaSha("old-body"),
  );
  assert.equal(app.runs.get(runId).budget.media.bytes, 16);
});

test("exhausted binary budgets still allow the media helper to validate matching retained bodies", async () => {
  const fixture = readingMediaOptions(),
    app = harness(fixture.options);
  app.execute();
  await app.idle();
  const runId = app.state().runId;
  app.runs.get(runId).budget.media.bytes = CTI_DIRECT_DATA_MEDIA_BYTES_V1;
  app.state().resume();
  await app.idle();
  assert.equal(fixture.settings[1].totalBytes, 0);
  assert.equal(
    fixture.mediaCalls.find((call) => call.attempt === 1).retained.body.sha256,
    mediaSha("old-body"),
    "entry delegates strict metadata-only reuse instead of rejecting saved bytes",
  );
  assert.equal(app.runs.get(runId).budget.media.bytes, CTI_DIRECT_DATA_MEDIA_BYTES_V1);
});

test("a failed second media metadata read preserves both the current raw attempt and older complete proof", async () => {
  const fixture = readingMediaOptions({ failMetadataAfterBody: true }),
    app = harness(fixture.options);
  app.execute();
  await app.idle();
  const runId = app.state().runId;
  app.state().resume();
  await app.idle();
  const failed = app.items.get(runId + "/ReadingA").fingerprint,
    asset = failed.payload.directAssetEvidence.assets[0];
  assert.equal(asset.reason, "DIRECT_ASSET_STABILITY_FAILED");
  assert.equal(asset.body.sha256, mediaSha("new-body-with-failed-metadata"));
  assert.equal(asset.stability.stable, false);
  assert.equal(asset.retainedEvidence.body.sha256, mediaSha("old-body"));
  assert.equal(failed.captureContract.complete, false);
  app.runs.get(runId).state = "PAUSED";
  app.state().resume();
  await app.idle();
  assert.equal(
    fixture.mediaCalls.find((call) => call.attempt === 2).retained.body.sha256,
    mediaSha("old-body"),
    "only the older complete asset proof is proposed for metadata-only reuse",
  );
});

test("changed CML cannot reuse an earlier reading's media proof", async () => {
  const fixture = readingMediaOptions(),
    app = harness(fixture.options);
  app.execute();
  await app.idle();
  fixture.changeCml();
  app.state().resume();
  await app.idle();
  assert.equal(
    fixture.mediaCalls.find((call) => call.attempt === 1).retained,
    undefined,
    "the exact bound CML must match before passing any historical bytes",
  );
});

test("a completed v1.2 media-gap run upgrades its 64 MiB budget and migrates retained originals once without rereading questions", async () => {
  const fixture = readingMediaOptions({ reuseRetainedOnFirst: true }),
    app = harness({ ...fixture.options, ids: ["ReadingA", "AssessmentZ"], assignmentIds: ["AssessmentZ"], assessmentInventory: () => ({}) });
  app.execute();
  await app.idle();
  const runId = app.state().runId, saved = app.runs.get(runId);
  assert.equal(app.downloads.length, 1, "The pre-upgrade fixture must itself export: " + app.state().exportError);
  const reading = app.items.get(runId + "/ReadingA");
  reading.fingerprint.captureContract.complete = false;
  reading.fingerprint.captureContract.contentPartsCaptured = false;
  reading.fingerprint.captureContract.reasons = ["DIRECT_MEDIA_BYTE_LIMIT"];
  reading.fingerprint.payload.directAssetEvidence.assets = [fixture.assetRecord("old-body")];
  reading.fingerprint.payload.directAssetEvidence.failures = [{ id: "a".repeat(22), reason: "DIRECT_MEDIA_BYTE_LIMIT" }];
  reading.fingerprint.payload.assetDetails = [{ assetId: "a".repeat(22), name: "Old CML attachment label", bodyVerified: true }];
  const nativeAssessment = {
    ...app.items.get(runId + "/AssessmentZ").fingerprint,
    type: "assignment", typeName: "staffGraded",
    captureContract: { complete: true, method: "DIRECT_ASSESSMENT", contentPartsCaptured: true, reasons: [] },
    payload: {
      directDataSources: { atom: { elements: [{ id: "Atom_AssessmentZ", draft: { content: { typeName: "staffGradedDraft", definition: { parts: ["exact-old-part"] } } } }] } },
      assessmentApiEvidence: { groups: [{ id: "old-group", questions: ["old-question@1"] }], questionDefinitions: [{ id: "old-question@1", native: "original definition" }] },
      structuredAssessment: { questions: [{ id: "old-question@1", prompt: "Original captured question", answerKey: "original captured key" }] },
    },
  };
  app.items.set(runId + "/AssessmentZ", { runId, itemId: "AssessmentZ", fingerprint: clone(nativeAssessment), state: { processed: true } });
  saved.state = "INCOMPLETE";
  saved.reason = "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS";
  saved.buildId = "v1.2.0-bound-reading-media-20261014";
  saved.captureMeta.buildId = saved.buildId;
  Object.assign(saved.captureMeta.directDataCapture, {
    acquisitionComplete: true, sourceStable: true, wholeCourseVerified: false,
    stopReason: saved.reason,
  });
  saved.budget.media = { bytes: 64 * 1024 * 1024, requests: 88 };
  app.bodies.clear();app.metrics.bodyWrites.length = 0;
  const initialCalls = app.calls.length, initialBudget = clone(saved.budget);
  app.execute();
  await app.idle();
  assert.equal(app.state().runId, runId);
  assert.equal(app.state().state, "COMPLETE");
  assert.equal(fixture.settings.at(-1).totalBytes, CTI_DIRECT_DATA_MEDIA_BYTES_V1 - 64 * 1024 * 1024,
    "The old charged bytes remain spent while the new archive policy permits the additional 448 MiB");
  assert.equal(app.runs.get(runId).budget.media.bytes, 64 * 1024 * 1024);
  assert(app.runs.get(runId).budget.requests >= initialBudget.requests);
  assert(!app.calls.slice(initialCalls).some(call => ["group", "definition"].includes(call.resource)),
    "Media continuation must not rerun any saved question definition or group");
  assert(!app.calls.slice(initialCalls).some(call => call.resource === "atom" && call.id === "Atom_AssessmentZ"));
  assert.deepEqual(app.items.get(runId + "/AssessmentZ").fingerprint.payload, nativeAssessment.payload,
    "Original question models, keys and source snapshot are preserved unchanged");
  assert.equal(app.metrics.bodyWrites.length, 1, "The old inline original migrates once to SHA-deduplicated Blob storage");
  assert.equal(app.metrics.bodyWrites[0].sha256, mediaSha("old-body"));
  assert.equal(app.bodies.size, 1);
  const { capture, zip } = await exportedCapture(app.downloads.at(-1));
  assert.equal(capture.meta.directDataCapture.exportTransport.format, "ZIP_GZIP_JSON_V1");
  assert.equal(capture.meta.directDataCapture.runId, runId);
  assert(!JSON.stringify(capture).includes('"base64"'));
  const bodyPath = "files/" + mediaSha("old-body");
  assert.deepEqual(Object.keys(zip.files).sort(), ["capture.json.gz", bodyPath].sort());
  assert.deepEqual(await zip.file(bodyPath).async("nodebuffer"), bytesForMediaLabel("old-body"));
  const migratedDetail = capture.fingerprints.find(fp => fp.id === "ReadingA").payload.assetDetails[0];
  assert.equal(migratedDetail.name, "source-old-body.bin", "Migration uses the bound native filename for the retained original");
  assert.equal(migratedDetail.referenceName, "Old CML attachment label", "The older CML display label remains separately recorded");
  assert.equal(app.downloads.length, 2, "Each acquisition attempt emits one ZIP file");
});

test("v1.3 enrichment freshly reads widget configuration while retaining assessment evidence and its original timestamps", async () => {
  const app = harness({ ids: ["WidgetA", "AssessmentZ"], widgetIds: ["WidgetA"],
    assignmentIds: ["AssessmentZ"], assessmentInventory: () => ({}) });
  app.execute();
  await app.idle();
  const runId = app.state().runId, saved = app.runs.get(runId),
    widget = app.items.get(runId + "/WidgetA");
  assert.equal(app.state().state, "INCOMPLETE");
  assert.equal(widget.fingerprint.payload.directWidgetProviderEvidence.stableSource, true);
  // This saved fixture predates native provider capture. Its item was fully
  // accounted, but no source configuration or external body was captured.
  delete widget.fingerprint.payload.directWidgetProviderEvidence;
  widget.fingerprint.captureContract.sourceConfigurationVerified = false;
  widget.fingerprint.captureContract.reasons = ["DIRECT_DRAFT_TYPE_UNSUPPORTED"];
  const originalObservedAt = "2026-10-14T12:00:00.000Z";
  const assessment = {
    ...app.items.get(runId + "/AssessmentZ").fingerprint,
    captureContract: { complete: true, method: "DIRECT_ASSESSMENT", contentPartsCaptured: true, reasons: [] },
    payload: {
      directDataSources: {
        atom: { elements: [{ id: "Atom_AssessmentZ", draft: { content: { typeName: "staffGradedDraft", definition: { parts: ["saved-part"] } } } }] },
        receipts: { atom: { observedAt: originalObservedAt }, relation: { observedAt: originalObservedAt } },
      },
      assessmentApiEvidence: { questionDefinitions: [{ id: "saved-question@1", native: "original model" }],
        receipts: [{ observedAt: originalObservedAt }] },
      structuredAssessment: { questions: [{ id: "saved-question@1", prompt: "Saved question", answerKey: "Saved key" }] },
    },
  };
  app.items.set(runId + "/AssessmentZ", { runId, itemId: "AssessmentZ", fingerprint: clone(assessment), state: { processed: true } });
  saved.state = "INCOMPLETE";
  saved.buildId = "v1.3.0-deduplicated-original-archive-20261014";
  saved.captureMeta.buildId = saved.buildId;
  Object.assign(saved.captureMeta.directDataCapture, {
    acquisitionComplete: true, sourceStable: true, wholeCourseVerified: false,
    stopReason: "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS",
  });
  const baseObservedAt = saved.captureMeta.directDataCapture.finalMaterialsReceipt.observedAt;
  const callsBefore = app.calls.length;
  app.advance(60_000);
  app.execute();
  await app.idle();
  assert.equal(app.state().runId, runId);
  assert.equal(app.state().state, "INCOMPLETE", "configured targets cannot complete an external widget");
  const currentCalls = app.calls.slice(callsBefore), providerReads = currentCalls.filter((call) => call.resource === "widget");
  assert.equal(providerReads.length, 2, "the current provider is read twice independently of retained observations");
  assert(providerReads.every((call) => call.id === "p".repeat(22) && call.courseId === COURSE));
  assert.equal(currentCalls.filter((call) => call.resource === "atom" && call.id === widget.fingerprint.atomId).length, 2,
    "fresh widget draft binding and final atom stability remain required");
  assert(!currentCalls.some((call) => call.id === "Atom_AssessmentZ" || ["group", "definition"].includes(call.resource)),
    "widget enrichment must not reread preserved assessment sources");
  assert.deepEqual(app.items.get(runId + "/AssessmentZ").fingerprint.payload, assessment.payload);
  const fresh = app.items.get(runId + "/WidgetA").fingerprint;
  assert.equal(fresh.payload.directWidgetProviderEvidence.stableSource, true);
  assert.equal(fresh.captureContract.sourceConfigurationVerified, true);
  assert.equal(fresh.captureContract.externalBodyVerified, false);
  assert.equal(fresh.captureContract.complete, false);
  assert(Date.parse(fresh.payload.directWidgetProviderEvidence.initial.receipt.observedAt) > Date.parse(baseObservedAt));
  const { capture } = await exportedCapture(app.downloads.at(-1));
  const exportedAssessment = capture.fingerprints.find((fp) => fp.id === "AssessmentZ");
  assert.deepEqual(exportedAssessment.payload, assessment.payload,
    "new file export time must not replace saved question or receipt timestamps");
  assert.equal(capture.meta.directDataCapture.mediaEnrichment.baseSourceCapturedAt, baseObservedAt);
  assert.equal(capture.meta.directDataCapture.mediaEnrichment.retainedAssessmentObservations, true);
  assert.equal(capture.meta.directDataCapture.mediaEnrichment.scope, "REFERENCED_CML_MEDIA_AND_WIDGET_SOURCES");
});

test("retained proof cannot promote an unresolved item before fresh current source reads", async () => {
  const app = harness({ids: ["ReadingA"]});
  app.execute(); await app.idle();
  const runId = app.state().runId, saved = app.runs.get(runId), row = app.items.get(runId + "/ReadingA");
  row.fingerprint.captureContract.complete = false;
  row.fingerprint.captureContract.reasons = ["DIRECT_READING_ASSETS_UNRESOLVED"];
  saved.state = "INCOMPLETE";
  saved.buildId = "v1.3.0-deduplicated-original-archive-20261014";
  Object.assign(saved.captureMeta.directDataCapture, {
    acquisitionComplete: true, sourceStable: true, wholeCourseVerified: false,
    stopReason: "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS",
  });
  const before = app.calls.length;
  app.execute(); await app.idle();
  assert.equal(app.state().runId, runId);
  assert.equal(app.calls.slice(before).filter(call => call.resource === "atom" && call.id === "Atom_ReadingA").length, 2,
    "Rechecking retained text cannot skip both fresh bound atom reads for an unresolved item");
  assert.equal(app.state().state, "COMPLETE");
});

test("missing local original bodies allow a bound current media read to recover", async () => {
  const fixture = readingMediaOptions(), app = harness(fixture.options);
  app.execute(); await app.idle();
  const runId = app.state().runId;
  app.bodies.clear();
  const before = app.calls.length;
  app.execute(); await app.idle();
  assert.equal(app.state().runId, runId);
  assert(app.calls.slice(before).some(call => call.resource === "atom" && call.id === "Atom_ReadingA"));
  assert(fixture.mediaCalls.some(call => call.attempt === 1), "Missing local bytes must not abort before media acquisition");
  assert.equal(app.state().state, "COMPLETE");
  assert.equal(app.downloads.length, 2);
});

test("readable legacy originals still export in one ZIP when quota prevents body checkpoint migration", async () => {
  const fixture = readingMediaOptions(), app = harness(fixture.options);
  app.execute();await app.idle();
  const runId = app.state().runId, saved = app.runs.get(runId), row = app.items.get(runId + "/ReadingA");
  row.fingerprint.payload.directAssetEvidence.assets = [fixture.assetRecord("old-body")];
  saved.buildId = "v1.2.0-bound-reading-media-20261014";
  saved.captureMeta.buildId = saved.buildId;
  app.bodies.clear();
  const original = clone(row.fingerprint), writesBefore = app.metrics.bodyWrites.length;
  let failedWrites = 0;
  app.store.putBody = async () => { failedWrites++; throw Error("QuotaExceededError"); };
  app.state().resume();await app.idle();
  assert.equal(app.state().runId, runId);
  assert.equal(app.state().state, "PAUSED");
  assert(failedWrites > 0, "The interrupted migration actually encounters the body-store quota boundary");
  assert.equal(app.metrics.bodyWrites.length, writesBefore);
  assert.equal(app.bodies.size, 0);
  assert.deepEqual(app.items.get(runId + "/ReadingA").fingerprint, original,
    "The readable legacy checkpoint remains intact when migration cannot commit");
  const {capture,zip} = await exportedCapture(app.downloads.at(-1));
  const sourceBody = capture.fingerprints[0].payload.directAssetEvidence.assets[0].body;
  assert.equal(sourceBody.archivePath, "files/" + mediaSha("old-body"));
  assert.equal(sourceBody.base64, undefined);
  assert.deepEqual(await zip.file(sourceBody.archivePath).async("nodebuffer"), bytesForMediaLabel("old-body"));
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified, false);
  assert.equal(app.downloads.length, 2, "Quota recovery offers one new ZIP rather than split files");
  assert.deepEqual(app.alerts, []);
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
  const output = (await exportedCapture(app.downloads.at(-1))).capture;
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
  const output = (await exportedCapture(app.downloads.at(-1))).capture;
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
  const output = (await exportedCapture(app.downloads.at(-1))).capture;
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
  const output = (await exportedCapture(app.downloads[0])).capture;
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

test("another bookmark click cannot replace a terminal run while its export is reading saved rows", async () => {
  const app = harness({
    readingPayload: (fp) => {
      fp.payload.oversize = "x".repeat(600 * 1024);
    },
  });
  app.context.CTI_DIRECT_DATA_EXPORT_BYTES_V1 = 512 * 1024;
  app.execute();
  await app.idle();
  assert.equal(app.state().state, "INCOMPLETE");
  const original = app.state(),
    readers = app.readers().length,
    held = deferred(),
    initialReads = app.metrics.itemReads.length;
  app.control.holdItemReads = held;
  original.export();
  await until(
    () => app.metrics.itemReads.length > initialReads,
    "Terminal export did not begin",
  );
  assert.equal(original.exporting, true);
  app.execute();
  await turn();
  assert.equal(
    app.state(),
    original,
    "One snapshot owns the global until its export finishes",
  );
  assert.equal(
    app.readers().length,
    readers,
    "No new capture may write to the exporting run",
  );
  held.resolve();
  await app.idle();
  assert.equal(original.exporting, false);
});
