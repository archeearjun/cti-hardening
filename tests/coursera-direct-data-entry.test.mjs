import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto, createHash } from "node:crypto";
import { gunzipSync, crc32 } from "node:zlib";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { directDraftWidgetProviderV1, directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1, directInlineWidgetProviderSourceV1,
  directInlineWidgetProviderTargetsV1 } from "../src/extractors/coursera/direct-data-widget.js";
import { directInlineWidgetBindingsV1, directWidgetProviderReceiptValidV1,
  directInlineWidgetEvidenceV1, directReceiptSourceValidV1, directAssessmentQuestionProjectionV1,
  directAssessmentContractV1 as nativeAssessmentContract, parseCourseraCheckboxDefinitionDirectV1,
  directCmlTextV1 as parseNativeCml, directReadingPayloadV1 as nativeReadingPayload } from "../src/extractors/coursera/direct-data-contracts.js";
import { bindDirectAuthoringDraftV1 as bindNativeDraft, directDraftReadingSourceV1 as nativeReadingSource,
  directDraftAssessmentInventoryV1 as nativeAssessmentInventory } from "../src/extractors/coursera/direct-data-models.js";
import { parseCourseraMcqDefinitionV61524 } from "../src/extractors/coursera/assessment-api.js";
import { assessmentCaptureCoverageV613 } from "../src/extractors/coursera/assessments-4.js";
import { directCanonicalSourceTextV1 as canonicalSource } from "../src/extractors/coursera/direct-data-canonical.js";
import * as publishedDraftSnapshot from "../src/extractors/coursera/direct-data-authoring-snapshot.js";
import { createInlinePublicContentFixture, createInlinePublisherContentFixture, createInlinePublisherMediaContentFixture } from "./coursera-inline-content-fixtures.mjs";
import { WIDGET_COURSE, WIDGET_SLUG } from "./coursera-direct-widget-fixtures.mjs";
import { directPublicPageTargetV1, directPublicPageObservationValidV1,
  CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1, CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1 } from "../src/extractors/coursera/direct-data-public-page.js";
import { directPublisherTargetV1, directPublisherObservationValidV1, directPublisherChapterV1,
  directPublisherResourceObservationValidV1, directPublisherResourceV1, directPublisherPartResolutionValidV1, directPublisherBackMatterResolutionValidV1 } from "../src/extractors/coursera/direct-data-publisher.js";
import { directPublisherMediaInventoryV1, directPublisherMediaStructureV1, directPublisherImageBodyStructureV1 } from "../src/extractors/coursera/direct-data-publisher-media.js";
import { createDirectDataArchiveV1 } from "../src/extractors/coursera/direct-data-archive.js";
import { decodeDirectAssetBodyV1, directAssetMetadataBindingV1, createDirectDataMediaReaderV1 as createNativeMediaReader } from "../src/extractors/coursera/direct-data-media.js";
import { directPanoptoAutomaticTargetV1, directPanoptoSourceV1,
  directPanoptoPodcastBindingsV1, sanitizeDirectPanoptoModelV1,
  CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1 } from "../src/extractors/coursera/direct-data-panopto.js";
import { directPanoptoRequestFormV1 } from "../src/extractors/coursera/direct-data-panopto-contracts.js";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";
import { widgetFixture } from "./coursera-direct-widget-fixtures.mjs";
import { directProviderAccessDiagnosticV1, directProviderAccessDiagnosticTextV1 } from "../src/extractors/coursera/direct-data-provider-diagnostic.js";
import { CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1, directMaterialStabilityModelV1 } from "../src/extractors/coursera/direct-data-material-stability.js";
import ts from "typescript";
import {
  directDataCoverageSummaryV1,
  directDataAttemptMetricsV1,
} from "../src/extractors/coursera/direct-data-summary.js";
import {
  CTI_DIRECT_DATA_VERSION_V1,
  CTI_DIRECT_DATA_BUILD_V1,
  directRecoverablePublisherBuildV1,
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
    groups = new Map(), definitions = new Map(),
    bodies = new Map(),
    runs = new Map(),
    urls = new Map(),
    factories = [],
    calls = [],
    alerts = [],
    downloads = [],
    events = new Map();
  const metrics = {
    storeOpens: 0,
    itemReads: [],
    maxActiveItemReads: 0,
    listItemCalls: 0,
    saves: [],
    writes: [],
    bodyWrites: [],
    helperOpens: [],
    helperCloses: 0,
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
  const fingerprint = (id) => options.fingerprints?.[id] ? clone(options.fingerprints[id]) : ({
    id,
    type: widgetAtoms.has(id) ? "Plugin" : options.assignmentIds?.includes(id) ? "assignment" : "reading",
    typeName: widgetAtoms.has(id) ? "ungradedWidget" : options.assignmentIds?.includes(id) ? "staffGraded" : "supplement",
    name: options.itemNames?.[id] || id,
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
    pathname: `/teach/${options.courseSlug || SLUG}/${options.courseId || COURSE}/content/edit`,
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
    async getActiveRun(settings = {}) {
      const active = [...runs.values()].filter((row) =>
        ["RUNNING", "PAUSED"].includes(row.state) || row.state === "INCOMPLETE" &&
          row.captureMeta?.directDataCapture?.acquisitionComplete === true &&
          row.captureMeta.directDataCapture.stopReason === "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS" ||
          settings.recheckCompleted === true && row.state === "COMPLETE" &&
          row.captureMeta?.directDataCapture?.wholeCourseVerified === true,
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
    async putGroup(runId,itemId,id,value) {groups.set(runId+"/"+itemId+"/"+id,clone({value}));},
    async getGroup(runId,itemId,id) {return clone(groups.get(runId+"/"+itemId+"/"+id)||null);},
    async getDefinition(runId,id) {return clone(definitions.get(runId+"/"+id)||null);},
    async putDefinition(runId,id,value) {definitions.set(runId+"/"+id,clone({value}));},
    async putBody(runId, sha256, blob, metadata) {
      assert.equal(createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex"), sha256);
      await options.beforePutBody?.({runId,sha256,blob,metadata});
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
      hasSanitizer: typeof readerOptions.sanitize === "function",
      providerTransport: readerOptions.providerTransport,
    };
    factories.push(factory);
    function abort(reason) {
      metrics.stopped = true;
      metrics.stopReason ||= reason;
    }
    async function read(resource, id, courseId) {
      if (typeof readerOptions.sanitize !== "function")
        return { ok: false, reason: "SANITIZER_UNAVAILABLE" };
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
      const supplied = options.readResult?.(call);
      if (supplied) {
        metrics[supplied.ok ? "completed" : "failed"]++;
        return clone(supplied);
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
            name: options.itemNames?.[widgetItemsByAtom.get(id)] || id,
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
        {
          const target = options.widgetTarget?.({ factory: readerIndex, id }) || "https://widget.example.test/embed?id=" + id + "&autoplay=false";
          element = { id, metadata: { updatedAt: 1 }, draft: {
            configuration: { url: target }, pageSrc: target,
          } };
        }
      metrics.completed++;
      return {
        ok: true,
        data: resource === "panopto" ? clone(options.panoptoModel(call)) : { elements: [element] },
        receipt: {
          originalResponseSha256: "a".repeat(64),
          observedAt: new Date(now).toISOString(),
          status: 200,
          bytes: 64,
          resource: resource === "panopto" ? "PanoptoDeliveryInfo" : resource,
          ...(resource === "panopto" ? {
            targetUrl: id, origin: new URL(id).origin,
            method: "POST", mime: "application/json",
            requestPath: "/Panopto/Pages/Viewer/DeliveryInfo.aspx",
            requestForm: directPanoptoRequestFormV1(new URL(id).searchParams.get("id")),
            bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
          } : {}),
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
      readPanoptoDeliveryInfo: (url) => read("panopto", url),
      readPublicPage: (url) => read("public", url),
      readPublisherPage: (url) => read("publisher", url),
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
    directRecoverablePublisherBuildV1,
    CTI_DIRECT_DATA_EXPORT_BYTES_V1,
    CTI_DIRECT_DATA_COMPRESSED_BYTES_V1,
    CTI_DIRECT_DATA_MEDIA_BYTES_V1,
    CTI_DIRECT_DATA_ARCHIVE_BYTES_V1,
    CTI_DIRECT_DATA_MAX_PARTS_V1,
    directDataCoverageSummaryV1,
    directDataAttemptMetricsV1,
    ...publishedDraftSnapshot,
    location,
    document,
    crypto: { subtle: webcrypto.subtle, randomUUID: webcrypto.randomUUID },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    structuredClone,
    Blob,
    CompressionStream,
    createDirectDataArchiveV1,
    decodeDirectAssetBodyV1,
    directAssetMetadataBindingV1,
    directPanoptoAutomaticTargetV1,
    directPanoptoSourceV1,
    directPanoptoPodcastBindingsV1,
    directProviderAccessDiagnosticV1,
    directProviderAccessDiagnosticTextV1,
    CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1,
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
    createDirectDataCheckpointStoreV1: async () => { metrics.storeOpens++; return store; },
    createDirectDataReaderV1: createReader,
    createDirectProviderHelperV1: (settings) => {
      metrics.helperOpens.push({courseId: settings.courseId, storeOpens: metrics.storeOpens});
      return {ready: async () => {}, request: async () => {throw Error("UNEXPECTED_HELPER_REQUEST");},
        close: () => {metrics.helperCloses++;}};
    },
    createDirectDataMediaReaderV1: (settings) => {
      assert.equal(typeof options.mediaReaderFactory, "function");
      return options.mediaReaderFactory(settings);
    },
    sanitizeCourseraCourseDataModel: () => {},
    directCanonicalSourceTextV1: options.nativeCml ? canonicalSource : JSON.stringify,
    CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1,
    directMaterialStabilityModelV1,
    directCourseInventoryV1: async () => ({
      fingerprints: ids.map(fingerprint),
      leaves: new Map(ids.map((id) => [id, { node: clone(options.materialNodes?.[id] || { id }), ancestorIds: [] }])),
      materialVersion: 1,
      courseBranchVersion: 1,
    }),
    bindDirectAuthoringDraftV1: options.nativeCml ? bindNativeDraft : (fp, courseId, slug, atomData) => ({
      atomId: fp.atomId,
      itemId: fp.id, courseId, courseSlug: slug, contentId: fp.contentId,
      sourceState: "AUTHORING_DRAFT",
      ...atomData.elements[0],
    }),
    directDraftWidgetProviderV1,
    directWidgetProviderSourceV1,
    directWidgetProviderTargetsV1,
    directInlineWidgetProviderSourceV1,
    directInlineWidgetProviderTargetsV1,
    directInlineWidgetBindingsV1,
    directInlineWidgetEvidenceV1,
    directWidgetProviderReceiptValidV1,
    directReceiptSourceValidV1,
    directAssessmentQuestionProjectionV1,
    directPublicPageTargetV1,
    directPublicPageObservationValidV1,
    CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1,
    CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1,
    directPublisherTargetV1,
    directPublisherObservationValidV1,
    directPublisherChapterV1,
    directPublisherResourceObservationValidV1,
    directPublisherResourceV1,
    directPublisherPartResolutionValidV1,
    directPublisherBackMatterResolutionValidV1,
    directPublisherMediaInventoryV1,
    directPublisherMediaStructureV1,
    directPublisherImageBodyStructureV1,
    directWidgetContractV1: (fp) => {
      const valid = fp.payload.directWidgetProviderEvidence?.stableSource === true;
      const result = contract(fp, "DIRECT_WIDGET", false,
        [valid ? "DIRECT_WIDGET_EXTERNAL_BODY_NOT_OBSERVED" : "DIRECT_WIDGET_PROVIDER_SOURCE_INVALID"]);
      result.sourceConfigurationVerified = valid;
      result.externalBodyVerified = false;
      return result;
    },
    directDraftReadingSourceV1: options.nativeCml ? nativeReadingSource : (bound) =>
      options.readingSource?.(bound) || { rawCML: "Synthetic reading" },
    directReadingPayloadV1: options.nativeCml ? nativeReadingPayload : async (fp) => {
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
    directDraftAssessmentInventoryV1: (bound) => {
      if(options.nativeAssessment) return nativeAssessmentInventory(bound);
      if (options.assessmentInventory) return options.assessmentInventory();
      throw Error("Unexpected assessment fixture");
    },
    directAssessmentContractV1: (...args) => options.nativeAssessment ? nativeAssessmentContract(...args) : options.assessmentInventory && contract(args[0], "DIRECT_ASSESSMENT", true),
    parseCourseraCheckboxDefinitionDirectV1,
    directCmlTextV1: options.nativeCml ? parseNativeCml : options.parseCml || (() => undefined),
    parseCourseraMcqDefinitionV61524,
    assessmentCaptureCoverageV613,
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
  const launch = () => {
    execute();
    if (["READY", "PAUSED"].includes(state()?.state)) button("Capture/resume course")?.click();
  };
  return {
    execute,
    launch,
    state,
    button,
    idle,
    context,
    location,
    nodes,
    items,
    groups, definitions,
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
  app.launch();
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
  assert.equal(app.metrics.helperOpens.length, 1);
  assert.equal(app.metrics.helperOpens[0].storeOpens, 0, "open the helper in the capture click before awaiting storage");
  assert(app.readers().every(factory => typeof factory.providerTransport?.request === "function"));
  assert.equal(app.metrics.helperCloses, 1, "close the owned helper after the run");
  assert(app.nodes.some(node => node.textContent.includes("2/2 content items verified")));
  assert(app.nodes.some(node => node.textContent.includes("0/0 empty structures verified")));
  assert(app.nodes.some(node => node.textContent.includes("0 question occurrences")));
  assert.deepEqual(app.alerts, []);
});

function publishedDraftEntryFixture({ sharedDefinition = false } = {}) {
  const itemId = "PublishedAssessment", atomId = "A".repeat(22),
    localIds = ["b".repeat(22), "c".repeat(22)], pointer = "p".repeat(22) + "@2",
    groupIds = localIds.map(id => atomId + "~" + id),
    definitionIds = ["q".repeat(22), (sharedDefinition ? "q" : "r").repeat(22)].map(id => atomId + "~" + id + "@3");
  const fp = { id: itemId, type: "assignment", typeName: "ungradedAssignment", name: "Published assignment",
    atomId, contentId: "atom~" + atomId, payload: {}, sourceIdentity: {} },
    material = { id: itemId, name: fp.name, atomId, contentId: fp.contentId, published: true,
      content: { typeName: fp.typeName, definition: { assignmentId: pointer } } },
    atom = { id: atomId, contentId: fp.contentId, status: { typeName: "publishedAtomStatus", definition: {} },
      storedAtomVersion: 2, metadata: { updatedAt: 1791189683630 },
      draft: { name: "Attached authored draft", content: { typeName: "staffGradedDraft", definition: {
        parts: localIds.map(id => ({ typeName: "storedQuestionGroupPart", definition: { id } })),
        configuration: { isGraded: false, gradeSelectionStrategy: "KEEP_LATEST" },
      } } },
      published: { name: "Current published assignment pointer", content: { typeName: "staffGraded",
        definition: { assignmentId: pointer, isGraded: true } } } },
    relation = { id: atomId, atomId, branchRelationMap: {
      [COURSE + "~" + itemId]: { courseId: COURSE, itemId, courseSlug: SLUG },
    } },
    cml = value => ({ typeName: "cml", definition: { dtdId: "assess/1", value: "<co-content><text>" + value + "</text></co-content>" } }),
    groups = new Map(groupIds.map((id, index) => [id, { id, questions: [definitionIds[index]],
      questionReferences: [{ authoringId: definitionIds[index] }] }])),
    definitions = new Map([...new Set(definitionIds)].map((id, index) => [id, { id,
      definition: { typeName: "mcq", definition: { prompt: cml("Original draft question " + index),
        options: [{ id: "yes", display: cml("Original choice yes"), feedback: cml("") },
          { id: "no", display: cml("Original choice no"), feedback: cml("Original feedback") }],
        correctOption: "no", shuffleOptions: false } },
      validation: { definition: { isReadyForPublish: true } } }]));
  let failure = "";
  const options = { ids: [itemId], fingerprints: { [itemId]: fp }, materialNodes: { [itemId]: material }, nativeCml: true,
    readResult(call) {
      const nativeResources = { atom: "authoringAtoms.v2", relation: "authoringItemContentRelations.v1",
        group: "authoringAssignmentQuestionGroups.v1", definition: "authoringAssignmentMachineEvaluableQuestions.v1" };
      const failed = failure === "atom-503" && call.resource === "atom" ||
        failure === "definition-b-503" && call.resource === "definition" && call.id === definitionIds[1] ||
        failure === "group-a-503" && call.resource === "group" && call.id === groupIds[0];
      if (failed) return { ok: false, reason: "COURSE_API_HTTP_503", receipt: {
        resource: nativeResources[call.resource], id: call.id, status: 503, observedAt: new Date(call.at).toISOString(),
      } };
      const value = call.resource === "atom" ? atom : call.resource === "relation" ? relation :
        call.resource === "group" ? groups.get(call.id) : call.resource === "definition" ? definitions.get(call.id) : null;
      if (!value) return undefined;
      return { ok: true, data: { elements: [clone(value)], paging: {}, linked: {} }, receipt: {
        resource: nativeResources[call.resource], id: call.id, status: 200,
        requestPath: "/api/" + nativeResources[call.resource] + "/" + call.id,
        bodyFormat: "PARSED_SANITIZED_JSON_MODEL", originalResponseSha256: "a".repeat(64),
        observedAt: new Date(call.at).toISOString(), bytes: 64,
      } };
    } };
  return { options, fp, atom, relation, material, groupIds, definitionIds, definitions, groups,
    fail: value => { failure = value; } };
}

function nativeRecheckEntryFixture() {
  const fixture = publishedDraftEntryFixture();
  fixture.fp.typeName = "staffGraded";
  fixture.material.published = false;
  fixture.material.content.typeName = "staffGraded";
  fixture.atom.status.typeName = "draftAtomStatus";
  fixture.options.nativeAssessment = true;
  return fixture;
}

test("explicit native recheck selects a completed unchanged run after reopening and freshly checks every native item within saved budgets", async () => {
  const app = harness(); app.launch(); await app.idle();
  const runId=app.state().runId, budget=clone(app.runs.get(runId).budget), before=app.calls.length;
  app.advance(1000); app.execute();
  assert.equal(app.state().state,"READY"); assert.equal(app.calls.length,before);
  app.button("Recheck native course content").click(); await app.idle();
  assert.equal(app.state().runId,runId); assert.equal(app.state().state,"COMPLETE");
  const calls=app.calls.slice(before);
  assert.equal(calls.filter(call=>call.resource==="materials").length,2);
  for(const id of ["ReadingA","ReadingB"]){
    assert.equal(calls.filter(call=>call.resource==="atom"&&call.id==="Atom_"+id).length,2);
    assert.equal(calls.filter(call=>call.resource==="relation"&&call.id==="Atom_"+id).length,1);
  }
  assert.equal(app.readers().at(-1).options.requests,1000-budget.requests);
  assert.equal(app.readers().at(-1).options.totalBytes,1_000_000-budget.bytes);
  assert.equal(app.readers().at(-1).options.concurrentRequests,2);
  const capture=(await exportedCapture(app.downloads.at(-1))).capture;
  assert.equal(capture.meta.directDataCapture.resumed,true);
  assert.deepEqual(capture.meta.directDataCapture.nativeRecheck,{
    scope:"ALL_NATIVE_ITEMS",requestedAt:capture.meta.directDataCapture.nativeRecheck.requestedAt,
    retainedDefinitionObservations:true,externalRuntimeVerified:false,allMediaRefetched:false,
  });
  assert.equal(capture.meta.directDataCapture.mediaEnrichment,undefined);
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified,true);
  assert(app.nodes.some(node=>node.textContent.includes("External runtime content and all media bytes are not certified")));
  assert.equal(app.downloads.length,2);
});

test("native recheck reuses only unchanged exact-version definitions and their dates, then acquires a newly referenced version",async t=>{
  const previousParser=globalThis.DOMParser;globalThis.DOMParser=DOMParser;
  t.after(()=>{if(previousParser)globalThis.DOMParser=previousParser;else delete globalThis.DOMParser;});
  const fixture=nativeRecheckEntryFixture(),app=harness(fixture.options);
  app.launch();await app.idle();assert.equal(app.state().state,"COMPLETE",JSON.stringify(app.state()));
  const runId=app.state().runId, old=clone(app.items.get(runId+"/"+fixture.fp.id).fingerprint),
    oldDefinitions=clone([...app.definitions]),before=app.calls.length;
  app.advance(1000);app.state().recheckNative();await app.idle();
  let calls=app.calls.slice(before),current=app.items.get(runId+"/"+fixture.fp.id).fingerprint;
  assert.equal(app.state().runId,runId);assert.equal(app.state().state,"COMPLETE");
  assert.equal(calls.filter(call=>call.resource==="atom").length,2);
  assert.equal(calls.filter(call=>call.resource==="relation").length,1);
  assert.equal(calls.filter(call=>call.resource==="group").length,2);
  assert.equal(calls.filter(call=>call.resource==="definition").length,0);
  assert.deepEqual(current.payload.structuredAssessment.questions,old.payload.structuredAssessment.questions);
  assert.deepEqual([...app.definitions],oldDefinitions,"Exact cached model bodies and receipt dates are immutable");
  const previousId=fixture.definitionIds[0],nextId=previousId.replace(/@3$/,"@4"),nextDefinition=clone(fixture.definitions.get(previousId));
  nextDefinition.id=nextId;nextDefinition.definition.definition.prompt.definition.value="<co-content><text>Observed new version prompt</text></co-content>";
  fixture.definitions.set(nextId,nextDefinition);fixture.groups.get(fixture.groupIds[0]).questions=[nextId];
  const changedStart=app.calls.length;app.advance(1000);app.state().recheckNative();await app.idle();
  calls=app.calls.slice(changedStart);current=app.items.get(runId+"/"+fixture.fp.id).fingerprint;
  assert.equal(app.state().state,"COMPLETE");
  assert.deepEqual(calls.filter(call=>call.resource==="definition").map(call=>call.id),[nextId]);
  assert.equal(calls.filter(call=>call.resource==="group").length,3,"Changed mapping has two current reads; unchanged group has one");
  assert.deepEqual(current.payload.assessmentApiEvidence.questionDefinitions.find(value=>value.id===nextId),nextDefinition);
  assert.equal(current.payload.structuredAssessment.questions[0].prompt,"Observed new version prompt");
  assert(current.payload.structuredAssessment.questions[0].observedAtMs>old.payload.structuredAssessment.questions[0].observedAtMs);
  assert.equal(current.payload.structuredAssessment.questions[1].observedAtMs,old.payload.structuredAssessment.questions[1].observedAtMs);
  assert.deepEqual(app.definitions.get(runId+"/"+previousId),oldDefinitions.find(([key])=>key===runId+"/"+previousId)[1]);
});

test("failed native group recheck retains old primary originals and separate partial attempts without current completeness",async t=>{
  const previousParser=globalThis.DOMParser;globalThis.DOMParser=DOMParser;
  t.after(()=>{if(previousParser)globalThis.DOMParser=previousParser;else delete globalThis.DOMParser;});
  const fixture=nativeRecheckEntryFixture(),app=harness(fixture.options);
  app.launch();await app.idle();assert.equal(app.state().state,"COMPLETE");
  const runId=app.state().runId,old=clone(app.items.get(runId+"/"+fixture.fp.id).fingerprint);
  fixture.fail("group-a-503");app.advance(1000);app.state().recheckNative();await app.idle();
  const current=app.items.get(runId+"/"+fixture.fp.id).fingerprint;
  assert.equal(current.captureContract.complete,false);assert.equal(current.payload.directResumeRevalidation.verified,false);
  assert.deepEqual(current.payload.assessmentApiEvidence,old.payload.assessmentApiEvidence);
  assert.deepEqual(current.payload.structuredAssessment,old.payload.structuredAssessment);
  assert.deepEqual(current.payload.directDataSources,old.payload.directDataSources);
  const attempt=current.payload.directNativeRecheckAttempt;
  assert.equal(attempt.currentNativeVerified,false);assert.equal(attempt.reason,"DIRECT_NATIVE_RECHECK_INCOMPLETE");
  assert.equal(attempt.assessmentApiEvidence.questionDefinitions.length,1);
  assert(attempt.assessmentApiEvidence.failures.some(value=>value.reason==="COURSE_API_HTTP_503"));
  assert(Date.parse(attempt.sources.receipts.atom.observedAt)>Date.parse(old.payload.directDataSources.receipts.atom.observedAt));
  const capture=(await exportedCapture(app.downloads.at(-1))).capture;
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified,false);assert.equal(capture.meta.directDataCapture.coverage.assessments.verified,0);
  fixture.fail("atom-503");app.advance(1000);app.state().recheckNative();await app.idle();
  const failed=app.items.get(runId+"/"+fixture.fp.id).fingerprint;
  assert.deepEqual(failed.payload.directNativeRecheckAttemptHistory,[attempt]);
  assert.deepEqual(failed.payload.assessmentApiEvidence,old.payload.assessmentApiEvidence);
  assert.equal(failed.captureContract.complete,false);assert.equal(failed.payload.directNativeRecheckAttempt.reason,"COURSE_API_HTTP_503");
  const lastFailed=clone(failed.payload.directNativeRecheckAttempt);
  fixture.fail("");app.advance(1000);app.state().recheckNative();await app.idle();
  const recovered=app.items.get(runId+"/"+fixture.fp.id).fingerprint;
  assert.equal(recovered.captureContract.complete,true);
  assert.equal(recovered.payload.directResumeRevalidation,undefined);
  assert.equal(recovered.payload.directNativeRecheckAttempt,undefined);
  assert.deepEqual(recovered.payload.directNativeRecheckAttemptHistory,[attempt,lastFailed],
    "A successful current check moves the failed raw observations into flat historical records");
  assert.deepEqual(recovered.payload.structuredAssessment.questions,old.payload.structuredAssessment.questions);
  assert(recovered.payload.directNativeRecheckAttemptHistory.every(value=>value.currentNativeVerified===false));
});

test("interrupted native recheck withdraws unvisited saved proof across export, reload and ordinary Resume",async t=>{
  for(const stopReason of ["COURSE_API_REQUEST_LIMIT","NETWORK_FAILED"]){
    await t.test(stopReason,async()=>{
      const app=harness();app.launch();await app.idle();
      const runId=app.state().runId,old=clone(app.items.get(runId+"/ReadingB").fingerprint),before=app.calls.length;
      app.control.beforeRead=(call,{abort})=>{
        if(call.resource==="atom"&&call.id==="Atom_ReadingA"){abort(stopReason);return stopReason;}
      };
      app.advance(1000);app.state().recheckNative();await app.idle();
      const capture=(await exportedCapture(app.downloads.at(-1))).capture,
        untouched=capture.fingerprints.find(fp=>fp.id==="ReadingB"),saved=app.items.get(runId+"/ReadingB");
      assert(!app.calls.slice(before).some(call=>call.resource==="atom"&&call.id==="Atom_ReadingB"));
      assert.equal(app.state().counts.complete,0);assert.equal(capture.meta.directDataCapture.coverage.readings.verified,0);
      assert.equal(untouched.captureContract.complete,false);assert.equal(saved.fingerprint.captureContract.complete,false);
      assert.equal(saved.state.processed,false);
      assert.equal(untouched.payload.directResumeRevalidation.reason,"DIRECT_NATIVE_RECHECK_NOT_READ");
      assert.deepEqual(untouched.payload.directDataSources,old.payload.directDataSources);
      assert.equal(untouched.payload.reading,old.payload.reading);
      assert.equal(capture.meta.directDataCapture.acquisitionComplete,false);
      app.execute();
      const checkpointRun=app.runs.get(runId);
      // A paused continuation is selectable without resetting its budget. A
      // terminal safety limit remains separate; old rows stay unverified.
      if(stopReason==="NETWORK_FAILED"){
        app.button("Capture/resume course").click();await app.idle();
        assert.equal(app.state().runId,runId);
        assert.equal(app.state().counts.complete,0);
        const resumed=(await exportedCapture(app.downloads.at(-1))).capture;
        assert.equal(resumed.fingerprints.find(fp=>fp.id==="ReadingB").captureContract.complete,false);
        assert.equal(resumed.meta.directDataCapture.coverage.readings.verified,0);
      }
      assert.equal(checkpointRun.captureMeta.directDataCapture.wholeCourseVerified,false);
      assert.equal(app.items.get(runId+"/ReadingB").fingerprint.captureContract.complete,false);
    });
  }
});

test("failed pending checkpoint writes still export and later hydrate old native rows as unverified",async()=>{
  const app=harness();app.launch();await app.idle();
  const runId=app.state().runId,old=clone(app.items.get(runId+"/ReadingB").fingerprint),put=app.store.putItem;
  app.store.putItem=async(...args)=>{if(args[1]==="ReadingB")throw Error("SYNTHETIC_PENDING_WRITE_FAILED");return put(...args);};
  app.advance(1000);app.state().recheckNative();await app.idle();
  assert.equal(app.state().counts.complete,0);
  const capture=(await exportedCapture(app.downloads.at(-1))).capture,
    untouched=capture.fingerprints.find(fp=>fp.id==="ReadingB");
  assert.equal(untouched.captureContract.complete,false);
  assert.deepEqual(untouched.payload.directDataSources,old.payload.directDataSources);
  assert.equal(capture.meta.directDataCapture.coverage.readings.verified,0);
  app.store.putItem=put;
  app.control.beforeRead=(call,{abort})=>{if(call.resource==="atom"){abort("NETWORK_FAILED");return "NETWORK_FAILED";}};
  app.execute();app.button("Capture/resume course").click();await app.idle();
  assert.equal(app.state().runId,runId);assert.equal(app.state().counts.complete,0);
  assert.equal(app.items.get(runId+"/ReadingB").fingerprint.captureContract.complete,false);
});

test("reopened native recheck keeps discovery read-only until a changed graph receives its own charged run",async()=>{
  const app=harness();app.launch();await app.idle();
  const oldRunId=app.state().runId,oldRun=clone(app.runs.get(oldRunId)),
    oldItems=clone([...app.items].filter(([key])=>key.startsWith(oldRunId+"/"))),savesBefore=app.metrics.saves.length;
  app.advance(6000);app.execute();app.control.materialRevision++;
  app.state().recheckNative();await app.idle();
  assert.notEqual(app.state().runId,oldRunId);assert.equal(app.state().state,"COMPLETE");
  assert.deepEqual(app.runs.get(oldRunId),oldRun,"Discovery must not change old state, dates or cumulative budgets");
  assert.deepEqual([...app.items].filter(([key])=>key.startsWith(oldRunId+"/")),oldItems);
  assert(!app.metrics.saves.slice(savesBefore).some(save=>save.runId===oldRunId));
  const capture=(await exportedCapture(app.downloads.at(-1))).capture;
  assert.equal(capture.meta.directDataCapture.resumed,false);
  assert.equal(capture.meta.directDataCapture.stats.inheritedBudget.requests,2,
    "The separate run owns the two actual graph discovery reads, without inheriting earlier attempts");
});

test("failed initial material discovery withdraws old native completion and retains exact raw originals with charged probe reads",async()=>{
  const app=harness();app.launch();await app.idle();
  const runId=app.state().runId,budget=clone(app.runs.get(runId).budget),old=clone([...app.items]),before=app.calls.length;
  app.advance(6000);app.execute();
  app.control.beforeRead=call=>call.resource==="materials"?"COURSE_API_HTTP_503":"";
  app.state().recheckNative();await app.idle();
  assert.equal(app.state().runId,runId);assert.equal(app.state().state,"PAUSED");
  assert.deepEqual(app.calls.slice(before).map(call=>call.resource),["materials","course"]);
  assert.equal(app.state().counts.complete,0);assert.equal(app.state().counts.processed,0);
  const capture=(await exportedCapture(app.downloads.at(-1))).capture;
  assert.equal(capture.meta.directDataCapture.nativeRecheck.scope,"ALL_NATIVE_ITEMS");
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified,false);
  assert.equal(capture.meta.directDataCapture.sourceStable,false);
  assert.equal(capture.meta.directDataCapture.coverage.readings.verified,0);
  assert.equal(capture.meta.directDataCapture.stats.requests,budget.requests+2);
  for(const [key,row]of old){
    const retained=app.items.get(key),exported=capture.fingerprints.find(fp=>fp.id===row.itemId);
    assert.equal(retained.state.processed,false);assert.equal(exported.captureContract.complete,false);
    assert.deepEqual(exported.payload.directDataSources,row.fingerprint.payload.directDataSources);
    assert.equal(exported.payload.reading,row.fingerprint.payload.reading);
    assert.equal(exported.payload.directResumeRevalidation.reason,"DIRECT_NATIVE_RECHECK_NOT_READ");
  }
  const savedBudget=clone(app.runs.get(runId).budget);
  app.execute();app.button("Capture/resume course").click();await app.idle();
  assert.equal(app.state().runId,runId);assert.equal(app.state().counts.complete,0);
  assert(app.runs.get(runId).budget.requests>=savedBudget.requests+2);
});

function assertSupplementalPublishedDraft(capture, itemId, count) {
  const fp = capture.fingerprints.find(item => item.id === itemId), snapshot = fp.payload.directAuthoringDraftSnapshot;
  assert(snapshot); assert.equal(snapshot.method, "BOUND_PUBLISHED_ATOM_DRAFT_SNAPSHOT");
  assert.equal(snapshot.sourceState, "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM");
  assert.equal(snapshot.definitions.length, count); assert.equal(fp.captureContract.complete, false);
  assert.equal(snapshot.publishedContentVerified, false); assert.equal(snapshot.contentCompletenessVerified, false);
  assert.equal(snapshot.wholeItemVerified, false);
  assert.equal(fp.payload.structuredAssessment, undefined); assert.equal(fp.payload.assessmentApiEvidence, undefined);
  assert.equal(capture.meta.directDataCapture.coverage.questions, 0);
  assert.equal(capture.meta.directDataCapture.coverage.assessments.verified, 0);
  assert.equal(capture.meta.directDataCapture.coverage.retainedDraftSnapshots.definitions, count);
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified, false);
  return snapshot;
}

test("the actual entry retains a published atom's separate draft observations and deduplicates one exact definition shared by concurrent groups", async () => {
  const fixture = publishedDraftEntryFixture({ sharedDefinition: true }), app = harness(fixture.options);
  app.launch(); await app.idle();
  const capture = (await exportedCapture(app.downloads[0])).capture, snapshot = assertSupplementalPublishedDraft(capture, fixture.fp.id, 1);
  assert.equal(app.state().state, "INCOMPLETE"); assert.equal(snapshot.sourceStable, true); assert.deepEqual(snapshot.failures, []);
  assert.deepEqual(snapshot.inventory.rawParts, fixture.atom.draft.content.definition.parts);
  assert.equal(snapshot.groups.length, 2);
  for (const group of snapshot.groups) {
    assert.deepEqual(group.initial.data, group.final.data);
    assert.equal(group.initial.data.elements[0].questions[0], fixture.definitionIds[0]);
    assert.equal(group.initial.sourceSha256, createHash("sha256").update(canonicalSource(group.initial.data)).digest("hex"));
  }
  assert.deepEqual(snapshot.definitions[0].data.elements[0], fixture.definitions.get(fixture.definitionIds[0]));
  assert.equal(app.calls.filter(call => call.resource === "definition" && call.id === fixture.definitionIds[0]).length, 1,
    "Both actual concurrent group workers share one exact definition GET and retain both source placements");
  assert.equal(app.calls.filter(call => call.resource === "group").length, 4);
  assert.equal(app.calls.filter(call => call.resource === "atom").length, 2);
  assert.deepEqual(snapshot.source.initialAtom.data, snapshot.source.finalAtom.data);
  assert.equal(capture.fingerprints[0].payload.directDataSources.atom.elements[0].status.typeName, "publishedAtomStatus");
  assert.equal(capture.fingerprints[0].payload.directAuthoringDraftSnapshotHistory, undefined);
  assert(app.nodes.some(node => node.textContent.includes("Additional draft definitions 1 retained across 1 published items")));
  assert.deepEqual(app.alerts, []);
});

test("actual partial draft-snapshot resume preserves earlier raw records after HTTP failures and never combines history into current coverage", async () => {
  const fixture = publishedDraftEntryFixture(), app = harness(fixture.options);
  fixture.fail("definition-b-503"); app.launch(); await app.idle();
  const firstCapture = (await exportedCapture(app.downloads[0])).capture,
    first = clone(assertSupplementalPublishedDraft(firstCapture, fixture.fp.id, 1)), runId = app.state().runId;
  assert.equal(first.sourceStable, true);
  assert(first.failures.some(value => value.scope === "DEFINITION" && value.id === fixture.definitionIds[1] && value.reason === "COURSE_API_HTTP_503"));
  assert.equal(first.definitions[0].id, fixture.definitionIds[0]);

  fixture.fail("atom-503"); app.advance(1000); app.button("Capture/resume course").click(); await app.idle();
  const failedSourceCapture = (await exportedCapture(app.downloads.at(-1))).capture,
    preserved = assertSupplementalPublishedDraft(failedSourceCapture, fixture.fp.id, 1),
    preservedItem = failedSourceCapture.fingerprints[0];
  assert.equal(app.state().runId, runId); assert.deepEqual(preserved, first,
    "An unsuccessful fresh atom read retains every old draft model and its observation timestamps");
  assert.equal(preservedItem.payload.directResumeRevalidation.verified, false);
  assert.equal(preservedItem.payload.directResumeRevalidation.reason, "COURSE_API_HTTP_503");
  assert.equal(preservedItem.payload.directAuthoringDraftSnapshotHistory, undefined,
    "A source read that never acquired a new snapshot does not invent a historical observation");

  fixture.fail("group-a-503"); app.advance(1000); app.button("Capture/resume course").click(); await app.idle();
  const secondCapture = (await exportedCapture(app.downloads.at(-1))).capture,
    second = clone(assertSupplementalPublishedDraft(secondCapture, fixture.fp.id, 1));
  assert.equal(second.definitions[0].id, fixture.definitionIds[1]);
  assert(second.failures.some(value => value.scope === "GROUP" && value.id === fixture.groupIds[0] && value.reason === "COURSE_API_HTTP_503"));
  assert.deepEqual(secondCapture.fingerprints[0].payload.directAuthoringDraftSnapshotHistory, [first],
    "Old successful raw definition A remains historical while only current definition B is counted");
  assert.notEqual(second.source.initialAtom.receipt.observedAt, first.source.initialAtom.receipt.observedAt);

  fixture.fail(""); app.advance(1000); const before = app.calls.length;
  app.button("Capture/resume course").click(); await app.idle();
  const finalCapture = (await exportedCapture(app.downloads.at(-1))).capture,
    final = assertSupplementalPublishedDraft(finalCapture, fixture.fp.id, 2);
  assert.equal(app.state().runId, runId); assert.equal(final.sourceStable, true); assert.deepEqual(final.failures, []);
  assert.deepEqual(finalCapture.fingerprints[0].payload.directAuthoringDraftSnapshotHistory, [first, second]);
  assert.equal(app.calls.slice(before).filter(call => call.resource === "definition").length, 2,
    "Only fresh accepted definition reads supply the recovered current snapshot; old bodies do not fill current gaps");
  assert.deepEqual(firstCapture.fingerprints[0].payload.directAuthoringDraftSnapshot, first);
  assert.equal(app.downloads.length, 4); assert.deepEqual(app.alerts, []);
});

test("inline page refresh replaces its own near-limit allocation and preserves the last verified original after a failed refresh", async (t) => {
  const previousParser = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  t.after(() => { if (previousParser) globalThis.DOMParser = previousParser; else delete globalThis.DOMParser; });
  const fixtures = Array.from({ length: 8 }, (_, index) => createInlinePublicContentFixture({
    itemId: "InlineReading" + index, atomId: String.fromCharCode(65 + index).repeat(22),
  })), originals = new Map(fixtures.map(f => [f.fp.atomId, f])),
    first = fixtures[0], provider = first.fp.payload.directInlineWidgetProviderEvidence.providers[0],
    fingerprints = Object.fromEntries(fixtures.map(f => [f.fp.id, { ...clone(f.fp), payload: {}, sourceIdentity: {} }]));
  let html = "<!doctype html><html><body><main>" + "x".repeat(1024 * 1024 - 1024) + "</main></body></html>", fail = false;
  const app = harness({ ids: fixtures.map(f => f.fp.id), fingerprints, nativeCml: true,
    courseId: WIDGET_COURSE, courseSlug: WIDGET_SLUG,
    mediaReaderFactory: () => ({ snapshot: () => ({ bytes: 0, requests: 0 }), abort() {}, release() {} }),
    readResult(call) {
      if (["atom", "relation"].includes(call.resource)) {
        const f = originals.get(call.id), sources = f.fp.payload.directDataSources;
        return { ok: true, data: clone(sources[call.resource]), receipt: {
          ...clone(sources.receipts[call.resource]), observedAt: new Date(call.at).toISOString(),
        } };
      }
      if (call.resource === "widget") {
        const receipt = { ...clone(provider.initial.receipt), id: call.id, observedAt: new Date(call.at).toISOString() };
        receipt.requestQuery.find(pair => pair[0] === "widgetSessionProviderId")[1] = call.id;
        return { ok: true, data: clone(provider.initial.model), receipt };
      }
      if (call.resource === "public") {
        if (fail) return { ok: false, data: null, reason: "PUBLIC_HTML_PROVIDER_HTTP_403", receipt: {
          ...clone(first.observation.receipt), status: 403, serviceStatus: 502, upstreamRequests: 1, upstreamBytes: 0,
          observedAt: new Date(call.at).toISOString(), receivedAt: new Date(call.at + 1).toISOString(),
          bytes: 64, declaredEnvelopeBytes: 64, originalResponseSha256: "",
          cookie: "MUST_NOT_BE_RETAINED", responseBody: "<html>MUST_NOT_BE_RETAINED</html>", headers: { authorization: "MUST_NOT_BE_RETAINED" },
        } };
        const observation = clone(first.observation), model = observation.model;
        model.html = html; model.bytes = Buffer.byteLength(html); model.sha256 = createHash("sha256").update(html).digest("hex");
        model.observedAt = new Date(call.at).toISOString();
        const envelope = Buffer.from(canonicalSource(model));
        Object.assign(observation.receipt, { observedAt: model.observedAt, receivedAt: new Date(call.at + 1).toISOString(),
          bytes: envelope.length, declaredEnvelopeBytes: envelope.length,
          originalResponseSha256: createHash("sha256").update(envelope).digest("hex"), upstreamBytes: model.bytes });
        return { ok: true, data: model, receipt: observation.receipt };
      }
    },
  });
  const pages = () => fixtures.map(f => app.items.get(app.state().runId + "/" + f.fp.id).fingerprint.payload.directInlineWidgetProviderEvidence.providers[0].publicPages[0]);
  app.launch(); await app.idle();
  assert.equal(app.state().state, "INCOMPLETE");
  assert(app.items.get(app.state().runId + "/" + fixtures[0].fp.id).fingerprint.payload.directInlineWidgetProviderEvidence,
    JSON.stringify(app.items.get(app.state().runId + "/" + fixtures[0].fp.id).fingerprint.captureContract));
  assert(pages().every(page => page.observation?.model.html === html));
  assert.equal(app.calls.filter(call => call.resource === "public").length, 1, "Repeated native placements share only the current page read");
  assert.equal(app.runs.get(app.state().runId).captureMeta.directDataCapture.stats.publicPages.retainedUtf8Bytes, 8 * Buffer.byteLength(html));
  assert.equal(app.state().inlineExternalContent.settings.captured, 8);
  assert.equal(app.state().inlineExternalContent.readings, 8);
  assert.equal(app.state().inlineExternalContent.pages.unique, 1);
  assert.equal(app.state().inlineExternalContent.pages.saved, 1);
  const runId = app.state().runId;
  html = html.replace("</main>", "A larger newly observed authored sentence.</main>");
  app.advance(60000); app.launch(); await app.idle();
  assert.equal(app.state().runId, runId);
  assert(pages().every(page => page.observation?.model.html === html && !page.retainedObservation && page.failures.length === 0),
    "A fresh replacement can use its own old reservation instead of spuriously exhausting the course cap");
  const previous = pages().map(page => clone(page.observation));
  fail = true; app.advance(60000); app.launch(); await app.idle();
  assert.equal(app.state().runId, runId);
  for (const [index, page] of pages().entries()) {
    assert.equal(page.observation, null); assert(page.failures.length > 0);
    assert.deepEqual(page.retainedObservation, previous[index], "Historical bytes, hashes and original source times survive a failed current refresh");
    assert.equal(page.failures[0].receipt.status, 403);
    assert.equal(page.failures[0].receipt.serviceStatus, 502, "Service failure and observed upstream HTTP status stay separate");
    assert.equal(page.failures[0].receipt.declaredEnvelopeBytes, 64);
    assert.equal(page.failures[0].receipt.cookie, undefined);
    assert.equal(page.failures[0].receipt.responseBody, undefined);
    assert.equal(page.failures[0].receipt.headers, undefined);
  }
  assert.equal(app.state().inlineExternalContent.settings.captured, 8, "HTTP failures cannot erase valid native settings or raise content completeness");
  assert.equal(app.state().inlineExternalContent.pages.saved, 0);
  assert.equal(app.state().inlineExternalContent.pages.historical, 1);
  assert.deepEqual(clone(app.state().inlineExternalContent.failures.upstreamHttp), { "403": 1 }, "Repeated placements count one failed source URL, using upstream HTTP status");
  assert(app.nodes.some(node => node.textContent.includes("HTML fallbacks 0/1 saved (1 HTTP 403)")), "The existing overlay identifies the transport that failed");
  assert.equal(app.calls.filter(call => call.resource === "public").length, 3, "A new attempt refreshes the public source once");
  assert.equal(app.runs.get(runId).captureMeta.directDataCapture.stats.publicPages.retainedUtf8Bytes, 8 * Buffer.byteLength(html));
  assert(app.items.get(runId + "/" + fixtures[0].fp.id).fingerprint.captureContract.complete === false);
  const retainedHtml=html;
  fail=false;html="<!doctype html><html><body><main>"+"y".repeat(2*1024*1024-1024)+"</main></body></html>";
  app.advance(60000);app.state().recheckNative();await app.idle();
  assert.equal(app.state().runId,runId);
  assert(pages().every((page,index)=>!page.observation&&canonicalSource(page.retainedObservation)===canonicalSource(previous[index])),
    "Native recheck reserves all eight retained originals before the first larger page read, so no placement displaces another original");
  assert.equal(app.runs.get(runId).captureMeta.directDataCapture.stats.publicPages.retainedUtf8Bytes,8*Buffer.byteLength(retainedHtml));
  html=retainedHtml;fail=true;
  for (const f of fixtures)
    f.fp.payload.directDataSources.atom.elements[0].draft.content.definition.content.definition.value =
      f.fp.payload.directDataSources.atom.elements[0].draft.content.definition.content.definition.value.replace(provider.providerId, provider.providerBaseId + "@2");
  app.advance(60000); app.launch(); await app.idle();
  assert(pages().every(page => page.observation === null && !page.retainedObservation && page.failures.length > 0),
    "A different native widget version cannot inherit the earlier selector's historical page");
});

function publisherEntryFixture(count = 1) {
  const fixtures = Array.from({ length: count }, (_, index) => createInlinePublisherContentFixture({
    itemId: "PublisherReading" + index, atomId: String.fromCharCode(65 + index).repeat(22),
  })), control = { api: "success", html: "success" }, mediaCalls = [],
    fingerprints = Object.fromEntries(fixtures.map(f => [f.fp.id, { ...clone(f.fp), payload: {}, sourceIdentity: {} }]));
  const options = { ids: fixtures.map(f => f.fp.id), fingerprints, nativeCml: true,
    courseId: WIDGET_COURSE, courseSlug: WIDGET_SLUG,
    mediaReaderFactory: () => ({ snapshot: () => ({ bytes: 0, requests: 0 }), abort() {}, release() {} }),
    readResult(call) {
      if (["atom", "relation"].includes(call.resource)) {
        const f = fixtures.find(value => value.fp.atomId === call.id);
        if (!f) return;
        const sources = f.fp.payload.directDataSources;
        return { ok: true, data: clone(sources[call.resource]), receipt: {
          ...clone(sources.receipts[call.resource]), observedAt: new Date(call.at).toISOString(),
        } };
      }
      if (call.resource === "widget") {
        const provider = fixtures[0].fp.payload.directInlineWidgetProviderEvidence.providers[0],
          receipt = { ...clone(provider.initial.receipt), id: call.id, observedAt: new Date(call.at).toISOString() };
        receipt.requestQuery.find(pair => pair[0] === "widgetSessionProviderId")[1] = call.id;
        return { ok: true, data: clone(provider.initial.model), receipt };
      }
      if (call.resource === "publisher") {
        const observation = clone(fixtures[0].publisherObservation), observedAt = new Date(call.at).toISOString();
        observation.model.observedAt = observation.receipt.observedAt = observedAt;
        observation.receipt.receivedAt = new Date(call.at + 1).toISOString();
        observation.receipt.attempts[0].observedAt = observedAt;
        if (control.api === "blocked") return { ok: false, data: null, reason: "PUBLISHER_BROWSER_BLOCKED_OR_FAILED", receipt: {
          ...observation.receipt, status: 0, responseType: "unreadable", bytes: 0, originalResponseSha256: "", credentials: "include",
          attempts: ["omit", "include"].map(credentials => ({ credentials, observedAt, status: 0, responseType: "unreadable", bytes: 0,
            reason: "PUBLISHER_BROWSER_BLOCKED_OR_FAILED" })), cookie: "NEVER_RETAIN", rawJson: "NEVER_RETAIN",
        } };
        if (control.api === "wrong-chapter") {
          observation.model.rawJson = observation.model.rawJson.replace('"id": 179', '"id": 180');
          observation.model.bytes = Buffer.byteLength(observation.model.rawJson);
          observation.model.sha256 = createHash("sha256").update(observation.model.rawJson).digest("hex");
          observation.receipt.bytes = observation.receipt.attempts[0].bytes = observation.model.bytes;
          observation.receipt.originalResponseSha256 = observation.model.sha256;
        }
        return { ok: true, data: observation.model, receipt: observation.receipt };
      }
      if (call.resource === "public") {
        if (control.html === "blocked") return { ok: false, reason: "PUBLIC_HTML_PROVIDER_HTTP_403", data: null,
          receipt: { ...clone(fixtures[0].observation.receipt), status: 403, serviceStatus: 502 } };
        const observation = clone(fixtures[0].observation);
        if (typeof control.htmlText === "string") {
          observation.model.html = control.htmlText;
          observation.model.bytes = Buffer.byteLength(control.htmlText);
          observation.model.sha256 = createHash("sha256").update(control.htmlText).digest("hex");
          observation.receipt.upstreamBytes = observation.model.bytes;
        }
        observation.model.observedAt = observation.receipt.observedAt = new Date(call.at).toISOString();
        observation.receipt.receivedAt = new Date(call.at + 1).toISOString();
        const bytes = Buffer.from(canonicalSource(observation.model));
        Object.assign(observation.receipt, { bytes: bytes.length, declaredEnvelopeBytes: bytes.length,
          originalResponseSha256: createHash("sha256").update(bytes).digest("hex") });
        return { ok: true, data: observation.model, receipt: observation.receipt };
      }
    },
  };
  return { fixtures, options, control, mediaCalls };
}
function useNativeCml(t) {
  const previousParser = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  t.after(() => { if (previousParser) globalThis.DOMParser = previousParser; else delete globalThis.DOMParser; });
}

function publisherPipelineEntryFixture(width = 2) {
  const f=publisherEntryFixture(), original=f.fixtures[0], image=createInlinePublisherMediaContentFixture({
    itemId:original.fp.id,atomId:original.fp.atomId,outcomes:Array(4).fill("CAPTURED"),
  }), gates=Array.from({length:4},deferred), control={reject:new Set(),stagingFailure:false},
    calls=[],returned=[],stages=[],metrics={active:0,maxConcurrentRequests:0,requests:0,bytes:0,stopped:false,stopReason:""};
  f.fixtures[0]=image;
  const bodies=image.publisherMedia.resources.map((resource,index)=>{
    const text=Buffer.from("Fixture\0Original "+index),type=Buffer.from("tEXt"),chunk=Buffer.alloc(text.length+12);
    chunk.writeUInt32BE(text.length,0);type.copy(chunk,4);text.copy(chunk,8);chunk.writeUInt32BE(crc32(Buffer.concat([type,text])),text.length+8);
    const bytes=Buffer.concat([Buffer.from(image.publisherMediaBytes).subarray(0,-12),chunk,Buffer.from(image.publisherMediaBytes).subarray(-12)]),sha256=createHash("sha256").update(bytes).digest("hex"),
      body={...clone(resource.body),archivePath:"files/"+sha256,sha256,size:bytes.length,
        receipt:{...clone(resource.body.receipt),bytes:bytes.length,sha256}};
    return{body,bytes};
  });
  let app,activeStages=0;
  f.options.beforePutBody=async ({sha256})=>{
    assert.equal(activeStages,0,"Only the ordered owner stages immutable original Blobs");activeStages++;
    try{await turn();if(control.stagingFailure&&calls.length>4){control.stagingFailure=false;throw Error("SYNTHETIC_PUBLISHER_STAGE_FAILED");}stages.push(sha256);}
    finally{activeStages--;}
  };
  f.options.mediaReaderFactory=settings=>{
    Object.assign(metrics,{active:0,maxConcurrentRequests:0,requests:0,bytes:0,stopped:false,stopReason:""});
    return{
    snapshot:()=>({...metrics,limits:{concurrentRequests:width,bodyBytes:16*1024*1024,totalBytes:settings.limits.totalBytes}}),
    abort(reason){metrics.stopped=true;metrics.stopReason=reason;},release(){},
    async readPublisherImage(observation,targetUrl,resource){
      const index=image.publisherImageUrls.indexOf(resource.url);assert(index>=0);assert.equal(observation.model.rawJson,image.publisherRawJson);
      if(index>=width){assert.equal(Object.hasOwn(returned[index-width],"bytes"),false,"Starting a replacement waits for the earlier original's Blob staging");}
      calls.push(index);metrics.active++;metrics.requests++;metrics.maxConcurrentRequests=Math.max(metrics.maxConcurrentRequests,metrics.active);
      try{await gates[index].promise;
        if(control.reject.has(index))throw Error("SYNTHETIC_PUBLISHER_IMAGE_READ_FAILED");
        if(metrics.stopped)return{reason:metrics.stopReason};
        const body=clone(bodies[index].body);Object.defineProperty(body,"bytes",{value:new Uint8Array(bodies[index].bytes),configurable:true});returned[index]=body;metrics.bytes+=body.size;
        return{body};
      }finally{metrics.active--;}
    },
  };};
  app=harness(f.options);
  return{...f,app,image,gates,control,calls,returned,stages,metrics,bodies};
}

test("actual entry pipelines at most two image reads, commits literal order and halves a controlled two-wave delay without changing originals",async t=>{
  useNativeCml(t);const captures=[];
  for(const width of [1,2]){
    const f=publisherPipelineEntryFixture(width);let controlledElapsedMs=0;f.app.launch();
    await until(()=>f.calls.length===width,"The first bounded image window never started");
    if(width===2){
      assert.deepEqual(f.calls,[0,1]);f.gates[1].resolve();await turn();await turn();
      assert.equal(f.stages.length,0,"An earlier pending source owns commit order even when its sibling finishes first");
      assert.deepEqual(f.calls,[0,1],"A third result cannot be prefetched while two originals are pending or unstaged");
      controlledElapsedMs+=100;f.app.advance(100);f.gates[0].resolve();
      await until(()=>f.calls.length===4,"Two staged originals did not release the next bounded window");
      controlledElapsedMs+=100;f.app.advance(100);f.gates[3].resolve();f.gates[2].resolve();
    }else for(let index=0;index<4;index++){
      await until(()=>f.calls.length===index+1,"The one-slot control did not honor its configured width");
      controlledElapsedMs+=100;f.app.advance(100);f.gates[index].resolve();
    }
    await f.app.idle();assert.equal(f.metrics.maxConcurrentRequests,width);assert.equal(f.metrics.active,0);
    assert.deepEqual(f.stages,f.bodies.map(value=>value.body.sha256));
    const {capture,zip}=await exportedCapture(f.app.downloads[0]),page=capture.fingerprints[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
    assert.equal(page.observation.model.rawJson,f.image.publisherRawJson);assert.equal(page.media.resources.length,4);
    assert.deepEqual(page.media.resources.map(value=>value.url),f.image.publisherImageUrls);
    for(const [index,resource]of page.media.resources.entries()){
      assert.equal(resource.body.sha256,f.bodies[index].body.sha256);assert.equal(resource.body.receipt.sourceSha256,page.observation.model.sha256);
      assert.deepEqual(await zip.file(resource.body.archivePath).async("nodebuffer"),f.bodies[index].bytes);
    }
    assert.equal(capture.fingerprints[0].captureContract.complete,false);assert.equal(capture.meta.directDataCapture.wholeCourseVerified,false);
    captures.push({controlledElapsedMs,resources:page.media.resources,rawJson:page.observation.model.rawJson});
  }
  assert.equal(captures[0].controlledElapsedMs,400);assert.equal(captures[1].controlledElapsedMs,200);
  assert.deepEqual(captures[1].resources,captures[0].resources,"Pipeline scheduling preserves original proof and literal resource order");
  assert.equal(captures[1].rawJson,captures[0].rawJson);
});

test("image pipeline handles early prefetched rejection and drains a pending read before final item ownership",async t=>{
  useNativeCml(t);
  for(const failedIndex of [0,1]){
    const f=publisherPipelineEntryFixture();f.control.reject.add(failedIndex);f.app.launch();await until(()=>f.calls.length===2,"Two pending image reads required");
    f.gates[failedIndex].resolve();await turn();await turn();
    assert.equal(f.app.items.size,0);assert.equal(f.app.state().running,true,"An item cannot finish while a prefetched read is unresolved");
    f.gates[1-failedIndex].resolve();await f.app.idle();assert.equal(f.metrics.active,0);assert.deepEqual(f.calls,[0,1]);
    const {capture}=await exportedCapture(f.app.downloads[0]),page=capture.fingerprints[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
    assert.deepEqual(page.media.resources.map(resource=>resource.url),f.image.publisherImageUrls);
    assert.equal(page.media.resources[failedIndex].reason,"SYNTHETIC_PUBLISHER_IMAGE_READ_FAILED");
    assert.equal(page.media.resources[2].reason,"PUBLISHER_IMAGE_NOT_ATTEMPTED_AFTER_CAPTURE_FAILURE");
    if(failedIndex===0)assert.equal(page.media.resources[1].reason,"PUBLISHER_IMAGE_NOT_RETAINED_AFTER_CAPTURE_FAILURE");
    assert.equal(capture.fingerprints[0].captureContract.complete,false);
    const writes=f.app.metrics.writes.length;await turn();assert.equal(f.app.metrics.writes.length,writes,"No drained read may write after terminal state");
  }
});

test("image pipeline staging failure keeps current gaps and original historical image ownership",async t=>{
  useNativeCml(t);const f=publisherPipelineEntryFixture();f.app.launch();
  for(let index=0;index<4;index++){await until(()=>f.calls.includes(index),"Original image read was not scheduled");f.gates[index].resolve();}
  await f.app.idle();const runId=f.app.state().runId,old=clone(f.app.items.get(runId+"/"+f.image.fp.id).fingerprint.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0]);
  f.control.stagingFailure=true;f.app.advance(60000);f.app.launch();await f.app.idle();
  assert.equal(f.app.downloads.length,2);assert.equal(f.app.state().exportError,"");
  const {capture}=await exportedCapture(f.app.downloads.at(-1)),page=capture.fingerprints[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  assert.equal(page.media.resources.length,4);assert(page.media.resources.every(resource=>!resource.body&&resource.reason));
  assert.equal(page.media.resources[0].reason,"SYNTHETIC_PUBLISHER_STAGE_FAILED");
  assert.equal(page.media.resources[1].reason,"PUBLISHER_IMAGE_NOT_RETAINED_AFTER_CAPTURE_FAILURE");
  assert.deepEqual(page.media.retained[0].observation,old.observation);assert.deepEqual(page.media.retained[0].resources,old.media.resources);
  assert.equal(f.metrics.active,0);assert.equal(f.calls.length,6,"A staging failure drains the first two reads and schedules no third refresh");
});

test("image pipeline cancellation drains both reads without scheduling or staging later sources",async t=>{
  useNativeCml(t);const f=publisherPipelineEntryFixture();f.app.launch();await until(()=>f.calls.length===2,"Two active image reads required");
  f.app.state().stop();await turn();assert.equal(f.app.state().running,true);
  f.gates[1].resolve();f.gates[0].resolve();await f.app.idle();
  assert.deepEqual(f.calls,[0,1]);assert.equal(f.metrics.active,0);assert.equal(f.stages.length,0);assert.equal(f.app.state().state,"PAUSED");
});

test("actual entry's two image reads retain the existing shared-reader byte budget under concurrent stream completion",async t=>{
  useNativeCml(t);const f=publisherPipelineEntryFixture(),gates=[deferred(),deferred()],fetches=[];
  const budget=f.bodies[0].bytes.length+Math.floor(f.bodies[1].bytes.length/2);let media;
  f.options.mediaReaderFactory=settings=>media=createNativeMediaReader({...settings,
    limits:{...settings.limits,totalBytes:budget},
    async fetchImpl(url){
      const index=f.image.publisherImageUrls.indexOf(url);fetches.push(index);assert(index<2,"Exhausted shared media budget prevents a later source GET");
      let sent=false,cancelled=false;
      const stream=new ReadableStream({async pull(controller){
        if(sent)return;sent=true;await gates[index].promise;
        if(!cancelled){controller.enqueue(new Uint8Array(f.bodies[index].bytes));controller.close();}
      },cancel(){cancelled=true;}});
      const response=new Response(stream,{status:200,headers:{"Content-Type":"image/png"}});
      Object.defineProperties(response,{url:{value:url},type:{value:"cors"}});return response;
    },
  });
  f.app.launch();await until(()=>fetches.length===2,"The actual shared media pool did not overlap two bounded streams");
  gates[1].resolve();gates[0].resolve();await f.app.idle();
  const stats=media.snapshot();assert.equal(stats.limits.totalBytes,budget);assert.equal(stats.maxConcurrentRequests,2);
  assert.equal(stats.active,0);assert.equal(stats.bodyBudgetExhausted,true);assert.deepEqual(fetches,[0,1]);
  const {capture}=await exportedCapture(f.app.downloads[0]),page=capture.fingerprints[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  assert.equal(page.media.resources.length,4);assert(page.media.resources.reduce((sum,resource)=>sum+(resource.body?.size||0),0)<=budget);
  assert(page.media.resources.some(resource=>resource.reason?.includes("BYTE_LIMIT")));
  assert.equal(capture.fingerprints[0].captureContract.complete,false);
});

test("native publisher JSON is acquired once across placements and failed refresh keeps its original proof", async t => {
  useNativeCml(t);
  const f = publisherEntryFixture(2), app = harness(f.options);
  const providers = () => f.fixtures.map(item => app.items.get(app.state().runId + "/" + item.fp.id).fingerprint.payload.directInlineWidgetProviderEvidence.providers[0]);
  app.launch(); await app.idle();
  assert.equal(app.state().state, "INCOMPLETE");
  assert.equal(app.calls.filter(call => call.resource === "publisher").length, 1);
  assert.equal(app.calls.filter(call => call.resource === "public").length, 0, "Accepted API JSON skips a redundant HTML request");
  const originals = providers().map(provider => clone(provider.publisherPages[0].observation));
  assert(originals.every(o => o.model.rawJson === f.fixtures[0].publisherRawJson), "Original spacing and trailing newline survive");
  assert(providers().every(provider => provider.wholeWidgetVerified === false && provider.publicPages[0].failures[0].reason === "PUBLIC_HTML_NOT_READ_PUBLISHER_API_SELECTED"));
  assert.equal(app.state().inlineExternalContent.pages.saved, 1);
  assert.equal(app.state().inlineExternalContent.publisherApi.saved, 1);
  const runId = app.state().runId, stats = app.runs.get(runId).captureMeta.directDataCapture.stats;
  assert.equal(stats.externalSources.logicalTargets, 1);
  assert.equal(stats.externalSources.retainedUtf8Bytes, 2 * originals[0].model.bytes);
  f.control.api = "blocked"; f.control.html = "blocked";
  app.advance(60000); app.launch(); await app.idle();
  for (const [index, provider] of providers().entries()) {
    const page = provider.publisherPages[0];
    assert.equal(page.observation, null); assert.deepEqual(page.retainedObservation, originals[index]);
    assert.equal(page.failures[0].reason, "PUBLISHER_BROWSER_BLOCKED_OR_FAILED");
    assert.equal(page.failures[0].receipt.status, 0, "A browser rejection does not invent an upstream HTTP status");
    assert.equal(page.failures[0].receipt.attempts.length, 2);
    assert.equal(page.failures[0].receipt.cookie, undefined); assert.equal(page.failures[0].receipt.rawJson, undefined);
  }
  assert.equal(app.calls.filter(call => call.resource === "public").length, 1, "Failed API permits the existing HTML fallback once");
  assert.equal(app.state().inlineExternalContent.publisherApi.historical, 1);
  assert.equal(app.state().inlineExternalContent.publisherApi.browserUnavailable, 1);
  assert.equal(app.items.get(runId + "/" + f.fixtures[0].fp.id).fingerprint.captureContract.complete, false);
  for (const item of f.fixtures) item.fp.payload.directDataSources.atom.elements[0].draft.content.definition.content.definition.value =
    item.fp.payload.directDataSources.atom.elements[0].draft.content.definition.content.definition.value.replace(f.fixtures[0].providerId, "p".repeat(22) + "@2");
  app.advance(60000); app.launch(); await app.idle();
  assert(providers().every(provider => !provider.publisherPages[0].retainedObservation), "Another native selector version cannot inherit old JSON");
});

test("API-first continuation preserves prior HTML separately and rejects a different publisher chapter", async t => {
  useNativeCml(t);
  const f = publisherEntryFixture(), app = harness(f.options);
  f.control.api = "blocked";
  app.launch(); await app.idle();
  const provider = () => app.items.get(app.state().runId + "/" + f.fixtures[0].fp.id).fingerprint.payload.directInlineWidgetProviderEvidence.providers[0],
    html = clone(provider().publicPages[0].observation);
  f.control.api = "success"; app.advance(60000); app.launch(); await app.idle();
  assert.deepEqual(provider().publicPages[0].retainedObservation, html);
  assert.equal(provider().publicPages[0].observation, null);
  assert.equal(provider().publicPages[0].failures[0].reason, "PUBLIC_HTML_NOT_READ_PUBLISHER_API_SELECTED");
  assert.equal(app.calls.filter(call => call.resource === "public").length, 1);
  const api = clone(provider().publisherPages[0].observation), stats = app.runs.get(app.state().runId).captureMeta.directDataCapture.stats;
  assert.equal(stats.externalSources.retainedUtf8Bytes, html.model.bytes + api.model.bytes);
  f.control.api = "wrong-chapter"; f.control.html = "blocked";
  app.advance(60000); app.launch(); await app.idle();
  assert.equal(provider().publisherPages[0].observation, null);
  assert.equal(provider().publisherPages[0].failures[0].reason, "DIRECT_PUBLISHER_SOURCE_INVALID");
  assert.deepEqual(provider().publisherPages[0].retainedObservation, api);
  assert.deepEqual(provider().publicPages[0].retainedObservation, html);
});

test("publisher acquisition shares the eight MiB retained budget and cannot displace historical HTML", async t => {
  useNativeCml(t);
  const f = publisherEntryFixture(8), app = harness(f.options);
  f.control.api = "blocked";
  f.control.htmlText = "<!doctype html><html><body><main>" + "x".repeat(1024 * 1024 - 80) + "</main></body></html>";
  app.launch(); await app.idle();
  const runId = app.state().runId, original = f.fixtures.map(item => clone(app.items.get(runId + "/" + item.fp.id).fingerprint.payload.directInlineWidgetProviderEvidence.providers[0].publicPages[0].observation));
  assert(original.every(Boolean));
  assert(8 * original[0].model.bytes < 8 * 1024 * 1024);
  assert(8 * original[0].model.bytes + f.fixtures[0].publisherObservation.model.bytes > 8 * 1024 * 1024,
    "The fresh JSON would exceed the cap while the eight original HTML placements remain retained");
  f.control.api = "success"; f.control.html = "blocked";
  app.advance(60000); app.launch(); await app.idle();
  for (const [index, item] of f.fixtures.entries()) {
    const provider = app.items.get(runId + "/" + item.fp.id).fingerprint.payload.directInlineWidgetProviderEvidence.providers[0];
    assert.equal(provider.publisherPages[0].observation, null);
    assert.equal(provider.publisherPages[0].failures[0].reason, "DIRECT_PUBLISHER_RETAINED_LIMIT");
    assert(provider.publisherPages[0].failures[0].receipt, "The successful response receipt remains diagnostic evidence without its over-budget body");
    assert.deepEqual(provider.publicPages[0].retainedObservation, original[index]);
  }
  const stats = app.runs.get(runId).captureMeta.directDataCapture.stats;
  assert.equal(stats.externalSources.retainedUtf8Bytes, 8 * original[0].model.bytes);
  assert.equal(stats.externalSources.logicalTargets, 1);
  assert.equal(app.calls.filter(call => call.resource === "publisher").length, 2);
});

test("embedded page access diagnostic validates recorded native proof without changing capture or retaining its body", async t => {
  useNativeCml(t);
  const f = publisherEntryFixture(), app = harness(f.options);
  app.launch(); await app.idle();
  const rows = clone([...app.items]), runs = clone([...app.runs]), bodies = [...app.bodies], before = app.calls.length,
    writes = app.metrics.writes.length, saves = app.metrics.saves.length, downloads = app.downloads.length,
    helpers = app.metrics.helperOpens.length, runId = app.state().runId,
    provider = app.items.get(runId + "/" + f.fixtures[0].fp.id).fingerprint.payload.directInlineWidgetProviderEvidence.providers[0];
  app.advance(60000); app.button("Check embedded page access").click();
  await until(() => app.state().accessDiagnostic && !app.state().diagnosing, "Embedded page diagnostic did not finish");
  let diagnostic = clone(app.state().accessDiagnostic);
  assert.equal(diagnostic.kind, "CTI_PUBLISHER_ACCESS_DIAGNOSTIC"); assert.equal(diagnostic.accepted, true);
  assert.equal(diagnostic.source.configuredSourceObservedAt, provider.final.receipt.observedAt, "Old native proof remains explicitly dated");
  assert.equal(diagnostic.chapter.id, 179); assert.equal(diagnostic.body.sha256, f.fixtures[0].publisherObservation.model.sha256);
  assert.equal(diagnostic.requests, 1); assert.equal(diagnostic.progressChanged, false); assert.equal(diagnostic.courseCaptured, false);
  assert.deepEqual(app.calls.slice(before).map(call => call.resource), ["publisher"]);
  assert(!JSON.stringify(diagnostic).includes("Publisher authored raw field"));
  assert(!JSON.stringify(diagnostic).includes("Synthetic publisher area"));
  assert.equal(diagnostic.rawJson, undefined); assert.equal(diagnostic.model, undefined);
  assert.deepEqual([...app.items], rows); assert.deepEqual([...app.runs], runs); assert.deepEqual([...app.bodies], bodies);
  assert.equal(app.metrics.writes.length, writes); assert.equal(app.metrics.saves.length, saves);
  assert.equal(app.downloads.length, downloads); assert.equal(app.metrics.helperOpens.length, helpers);
  assert.equal(app.state().runId, runId);
  f.control.api = "blocked"; app.button("Check embedded page access").click();
  await until(() => app.state().accessDiagnostic && !app.state().diagnosing, "Blocked diagnostic did not finish");
  diagnostic = clone(app.state().accessDiagnostic);
  assert.equal(diagnostic.accepted, false); assert.equal(diagnostic.reason, "PUBLISHER_BROWSER_BLOCKED_OR_FAILED");
  assert.equal(diagnostic.receipt.status, 0); assert.equal(diagnostic.body, undefined);
  assert.deepEqual([...app.items], rows); assert.deepEqual([...app.runs], runs);
});

test("embedded access check refuses a mismatched inventory row or an oversized native proof before issuing requests", async t => {
  useNativeCml(t);
  const f = publisherEntryFixture(), app = harness(f.options);
  app.launch(); await app.idle();
  const key = app.state().runId + "/" + f.fixtures[0].fp.id, row = app.items.get(key), original = clone(row), before = app.calls.length;
  row.fingerprint = createInlinePublisherContentFixture({ itemId: "OutsideInventory", atomId: "Z".repeat(22) }).fp;
  app.button("Check embedded page access").click();
  await until(() => app.state().accessDiagnostic && !app.state().diagnosing, "Mismatched checkpoint diagnostic did not finish");
  assert.equal(app.state().accessDiagnostic.reason, "PUBLISHER_CHECK_NO_RECORDED_SOURCE");
  assert.equal(app.calls.length, before);
  app.items.set(key, original);
  original.fingerprint.payload.directInlineWidgetProviderEvidence.providers[0].initial.model.elements[0].draft.configuration.publicPages = "x".repeat(2 * 1024 * 1024);
  app.button("Check embedded page access").click();
  await until(() => app.state().accessDiagnostic && !app.state().diagnosing, "Oversized proof diagnostic did not finish");
  assert.equal(app.state().accessDiagnostic.reason, "PUBLISHER_CHECK_NO_RECORDED_SOURCE");
  assert.equal(app.calls.length, before);
  original.fingerprint.payload.directInlineWidgetProviderEvidence.providers[0].initial.model.elements[0].draft.configuration.publicPages = { ["x".repeat(2 * 1024 * 1024)]: false };
  app.button("Check embedded page access").click();
  await until(() => app.state().accessDiagnostic && !app.state().diagnosing, "Oversized native key diagnostic did not finish");
  assert.equal(app.state().accessDiagnostic.reason, "PUBLISHER_CHECK_NO_RECORDED_SOURCE");
  assert.equal(app.calls.length, before);
});

test("Stop during diagnostic response hashing prevents acceptance and leaves saved evidence unchanged", async t => {
  useNativeCml(t);
  const f = publisherEntryFixture(), app = harness(f.options), held = deferred();
  app.launch(); await app.idle();
  const rows = clone([...app.items]), runs = clone([...app.runs]);
  let hashingResponse = false;
  app.context.crypto.subtle = { async digest(algorithm, value) {
    if (Buffer.from(value).toString("utf8") === f.fixtures[0].publisherRawJson) {
      hashingResponse = true; await held.promise;
    }
    return webcrypto.subtle.digest(algorithm, value);
  } };
  app.button("Check embedded page access").click();
  await until(() => hashingResponse, "Diagnostic never reached its final raw source hash");
  app.state().stop(); held.resolve();
  await until(() => app.state().accessDiagnostic && !app.state().diagnosing, "Stopped diagnostic never settled");
  assert.equal(app.state().accessDiagnostic.accepted, false);
  assert.equal(app.state().accessDiagnostic.reason, "PUBLISHER_CHECK_STOPPED_OR_CONTEXT_CHANGED");
  assert.equal(app.state().accessDiagnostic.body, undefined);
  assert.deepEqual([...app.items], rows); assert.deepEqual([...app.runs], runs);
});

test("the bounded inline overlay summary distinguishes configuration from unique public source failures", () => {
  const names = ["publicPageFailureOutcome", "summarizeInlineItem", "inlineExternalContentSummary"];
  const declarations = names.map(name => {
    let declaration;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
      else ts.forEachChild(node, visit);
    }
    visit(parsedEntry); assert(declaration); return declaration.getText(parsedEntry);
  }).join("\n");
  const context = vm.createContext({ itemStates: new Map(), courseId: COURSE });
  new vm.Script(declarations).runInContext(context);
  let position = 0;
  for (let index = 0; index < 24; index++) {
    const fp = { id: "Reading" + index, atomId: String.fromCharCode(65 + index).repeat(22), payload: {
      directDataSources: { receipts: { stability: { stable: true } } },
      directInlineWidgetProviderEvidence: { method: "BOUND_INLINE_CML_WIDGET_PROVIDERS", providers: [] },
    } };
    for (let providerIndex = 0; providerIndex < (index < 6 ? 3 : 2); providerIndex++, position++) {
      const target = position % 44, reason = target < 42 ? "PUBLIC_HTML_PROVIDER_HTTP_403" : target === 42 ? "PROVIDER_HELPER_REQUEST_TIMEOUT" : "PUBLIC_HTML_PROVIDER_HTTP_404";
      fp.payload.directInlineWidgetProviderEvidence.providers.push({ courseId: COURSE, itemId: fp.id, atomId: fp.atomId,
        stableSource: true, failures: [], initial: { modelHash: "a".repeat(64), sourceHash: "b".repeat(64) },
        final: { modelHash: "a".repeat(64), sourceHash: "b".repeat(64) },
        publicPages: [{ targetUrl: "https://opentextbc.ca/synthetic-book/?p=" + target,
          observation: null, failures: [{ reason }] }],
      });
    }
    context.itemStates.set(fp.id, { inlineExternalContent: context.summarizeInlineItem(fp) });
  }
  const summary = clone(context.inlineExternalContentSummary());
  assert.equal(summary.readings, 24); assert.deepEqual(summary.settings, { captured: 54, total: 54 });
  assert.deepEqual(summary.pages, { saved: 0, unique: 44, historical: 0 });
  assert.deepEqual(summary.failures, { upstreamHttp: { "403": 42, "404": 1 }, timeouts: 1, unsupported: 0, other: 0, unclassified: 0, mixed: 0 });
  assert.equal(summary.wholeWidgetVerified, false); assert.equal(summary.limited, false);
  context.itemStates.clear();
  for (let item = 0; item < 3; item++) context.itemStates.set(item, { inlineExternalContent: {
    total: 1, captured: 1, limited: false,
    pages: Array.from({ length: 128 }, (_, offset) => ({ targetUrl: "https://opentextbc.ca/synthetic-book/?p=" + (item * 128 + offset),
      saved: false, historical: false, outcomes: ["TIMEOUT"] })),
  } });
  const bounded = context.inlineExternalContentSummary();
  assert.equal(bounded.pages.unique, 256); assert.equal(bounded.failures.timeouts, 256); assert.equal(bounded.limited, true);
});

test("inline progress separates exposed publisher API HTTP outcomes from HTML fallback failures", () => {
  const declarations = ["publicPageFailureOutcome", "summarizeInlineItem", "inlineExternalContentSummary"].map(name => {
    let declaration;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
      else ts.forEachChild(node, visit);
    }
    visit(parsedEntry); assert(declaration); return declaration.getText(parsedEntry);
  }).join("\n"), context = vm.createContext({ itemStates: new Map(), courseId: COURSE });
  new vm.Script(declarations).runInContext(context);
  const fingerprints = [];
  let position = 0;
  for (let index = 0; index < 24; index++) {
    const fp = { id: "Reading" + index, atomId: String.fromCharCode(65 + index).repeat(22), payload: {
      directDataSources: { receipts: { stability: { stable: true } } },
      directInlineWidgetProviderEvidence: { method: "BOUND_INLINE_CML_WIDGET_PROVIDERS", providers: [] },
    } };
    for (let providerIndex = 0; providerIndex < (index < 6 ? 3 : 2); providerIndex++, position++) {
      const target = position % 44, targetUrl = "https://opentextbc.ca/synthetic-book/?p=" + (target + 1),
        saved = target < 29, apiStatus = target < 43 ? 404 : 401, htmlStatus = target < 43 ? 403 : 404;
      fp.payload.directInlineWidgetProviderEvidence.providers.push({ courseId: COURSE, itemId: fp.id, atomId: fp.atomId,
        stableSource: true, failures: [], initial: { modelHash: "a".repeat(64), sourceHash: "b".repeat(64) },
        final: { modelHash: "a".repeat(64), sourceHash: "b".repeat(64) },
        publisherPages: [{ targetUrl, observation: saved ? { model: { sha256: "c".repeat(64) } } : null,
          failures: saved ? [] : [{ reason: "PUBLISHER_BROWSER_HTTP_" + apiStatus, receipt: {
            transport: "BROWSER_PUBLISHER_API", resource: "PublisherChapter", observedAtBasis: "BROWSER_RESPONSE",
            responseType: "cors", status: apiStatus,
          } }] }],
        publicPages: [{ targetUrl, observation: null, failures: [{ reason: saved
          ? "PUBLIC_HTML_NOT_READ_PUBLISHER_API_SELECTED" : "PUBLIC_HTML_PROVIDER_HTTP_" + htmlStatus }] }],
      });
    }
    fingerprints.push(fp);
    context.itemStates.set(fp.id, { inlineExternalContent: context.summarizeInlineItem(fp) });
  }
  const original = JSON.stringify(fingerprints), summary = clone(context.inlineExternalContentSummary());
  assert.equal(summary.readings, 24); assert.deepEqual(summary.settings, { captured: 54, total: 54 });
  assert.deepEqual(summary.pages, { saved: 29, unique: 44, historical: 0 });
  assert.equal(summary.publisherApi.saved, 29); assert.equal(summary.publisherApi.unique, 44);
  assert.deepEqual(summary.publisherApi.failures.observedHttp, { "401": 1, "404": 14 });
  assert.equal(summary.publisherApi.failures.other, 0); assert.equal(summary.publisherApi.failures.unclassified, 0);
  assert.equal(summary.htmlPages.saved, 0); assert.equal(summary.htmlPages.unique, 44);
  assert.equal(summary.htmlPages.readTargets, 15); assert.equal(summary.htmlPages.skipped, 29);
  assert.deepEqual(summary.htmlPages.failures.upstreamHttp, { "403": 14, "404": 1 });
  assert.deepEqual(summary.failures.upstreamHttp, { "403": 14, "404": 1 }, "Legacy failures retain their HTML scope");
  assert.equal(summary.htmlPages.failures.other, 0, "Selecting the API is not an HTML failure");
  assert.equal(JSON.stringify(fingerprints), original, "Summaries cannot change captured source or completeness");
  const renderStart = source.indexOf("      const inline = stats.inlineExternalContent;"),
    renderEnd = source.indexOf("      count.hidden =", renderStart),
    renderContext = vm.createContext({ stats: { inlineExternalContent: summary }, state: {}, count: { textContent: "" } });
  assert(renderStart >= 0 && renderEnd > renderStart);
  new vm.Script(source.slice(renderStart, renderEnd)).runInContext(renderContext);
  const text = renderContext.count.textContent;
  assert(text.includes("External pages 29/44 saved · Publisher API sources 29/44 saved (1 HTTP 401; 14 HTTP 404)"));
  assert(text.includes("HTML fallbacks 0/15 saved (14 HTTP 403; 1 HTTP 404)"));
  assert(!text.includes("External pages 29/44 saved ("), "Combined counts cannot imply that HTML errors are API errors");
  context.itemStates.clear();
  const opaque = clone(fingerprints[0]), provider = opaque.payload.directInlineWidgetProviderEvidence.providers[0];
  opaque.payload.directInlineWidgetProviderEvidence.providers = [provider];
  provider.publicPages = [];
  provider.publisherPages[0].observation = null;
  provider.publisherPages[0].failures = [{ reason: "PUBLISHER_BROWSER_BLOCKED_OR_FAILED", receipt: {
    transport: "BROWSER_PUBLISHER_API", resource: "PublisherChapter", observedAtBasis: "BROWSER_RESPONSE",
    responseType: "unreadable", status: 0,
  } }];
  context.itemStates.set(opaque.id, { inlineExternalContent: context.summarizeInlineItem(opaque) });
  const blocked = clone(context.inlineExternalContentSummary());
  assert.deepEqual(blocked.publisherApi.failures.observedHttp, {});
  assert.equal(blocked.publisherApi.failures.browserUnavailable, 1);
  assert.equal(blocked.publisherApi.browserUnavailable, 1);
  provider.publisherPages[0].failures[0].reason = "PUBLISHER_BROWSER_HTTP_404";
  provider.publisherPages[0].failures[0].receipt.status = 404;
  context.itemStates.set(opaque.id, { inlineExternalContent: context.summarizeInlineItem(opaque) });
  assert.deepEqual(clone(context.inlineExternalContentSummary()).publisherApi.failures.observedHttp, {},
    "An unreadable response cannot establish an observed HTTP status even if a code or stored number says 404");
  assert.equal(context.publicPageFailureOutcome({ reason: "PUBLISHER_BROWSER_HTTP_401", receipt: {
    transport: "BROWSER_PUBLISHER_API", resource: "PublisherPart", observedAtBasis: "BROWSER_RESPONSE",
    responseType: "cors", status: 401,
  } }), "HTTP_401", "An exposed book-section response retains its own observed HTTP outcome");
  provider.publisherPages[0].failures[0].reason = "PUBLISHER_BROWSER_RESOURCE_RESOLUTION_LIMIT";
  provider.publisherPages[0].failures[0].receipt.responseType = "cors";
  context.itemStates.set(opaque.id, { inlineExternalContent: context.summarizeInlineItem(opaque) });
  const limited = clone(context.inlineExternalContentSummary());
  assert.equal(limited.publisherApi.failures.limits, 1);
  assert.deepEqual(limited.publisherApi.failures.observedHttp, {}, "A bounded route-resolution stop is labelled separately from an ordinary 404");
});

test("publisher image progress deduplicates owned originals and distinguishes blocked reads from historical files", () => {
  const declarations = ["publicPageFailureOutcome", "summarizeInlineItem", "inlineExternalContentSummary"].map(name => {
    let declaration;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
      else ts.forEachChild(node, visit);
    }
    visit(parsedEntry); assert(declaration); return declaration.getText(parsedEntry);
  }).join("\n"), context = vm.createContext({ itemStates: new Map(), courseId: WIDGET_COURSE, directPublisherMediaStructureV1 }),
    outcomes = ["CAPTURED", "PUBLISHER_IMAGE_BLOCKED_OR_FAILED", "PUBLISHER_IMAGE_HTTP_404"],
    fixtures = [createInlinePublisherMediaContentFixture({ itemId: "ImageReadingA", atomId: "A".repeat(22), outcomes }),
      createInlinePublisherMediaContentFixture({ itemId: "ImageReadingB", atomId: "B".repeat(22), outcomes })],
    previous = createInlinePublisherMediaContentFixture({ outcomes: ["CAPTURED", "CAPTURED", "CAPTURED"] });
  fixtures[0].publisherMedia.retained = [{ observation: previous.publisherObservation, resources: [previous.publisherMedia.resources[1]] }];
  new vm.Script(declarations).runInContext(context);
  const before = fixtures.map(f => JSON.stringify(f.raw));
  for (const f of fixtures) context.itemStates.set(f.fp.id, { inlineExternalContent: context.summarizeInlineItem(f.fp) });
  const summary = clone(context.inlineExternalContentSummary());
  assert.deepEqual(summary.publisherImages, { unique: 3, saved: 1, historical: 1, browserUnavailable: 1, failed: 1, unverified: 0 });
  assert.equal(summary.pages.saved, 1); assert.equal(summary.publisherApi.saved, 1);
  assert.deepEqual(summary.settings, { captured: 2, total: 2 });
  assert.equal(summary.wholeWidgetVerified, false);
  assert.deepEqual(fixtures.map(f => JSON.stringify(f.raw)), before);
  assert(fixtures.every(f => f.fp.captureContract.complete === false));
  const start = source.indexOf("      const inline = stats.inlineExternalContent;"), end = source.indexOf("      count.hidden =", start),
    renderContext = vm.createContext({ stats: { inlineExternalContent: summary }, state: {}, count: { textContent: "" } });
  new vm.Script(source.slice(start, end)).runInContext(renderContext);
  assert(renderContext.count.textContent.includes("Publisher image sources 1/3 saved (1 browser-blocked or unreadable; 1 other uncaptured image sources)"));
  assert(renderContext.count.textContent.includes("1 historical image originals retained"));
  context.itemStates.clear();
  const metadataOnly = createInlinePublisherMediaContentFixture({ outcomes: ["CAPTURED"] });
  delete metadataOnly.publisherMedia.resources[0].body;
  context.itemStates.set(metadataOnly.fp.id, { inlineExternalContent: context.summarizeInlineItem(metadataOnly.fp) });
  const metadataSummary = context.inlineExternalContentSummary().publisherImages;
  assert.equal(metadataSummary.saved, 0); assert.equal(metadataSummary.unique, 0);
  assert.equal(metadataSummary.sourceGaps, 1, "A discovered image URL without an original body or read outcome stays an explicit evidence gap");
  context.itemStates.clear();
  const responsive = createInlinePublisherMediaContentFixture({ responsive: true, outcomes }),
    responsiveOriginal = JSON.stringify(responsive.raw);
  context.itemStates.set(responsive.fp.id, { inlineExternalContent: context.summarizeInlineItem(responsive.fp) });
  const responsiveSummary = clone(context.inlineExternalContentSummary());
  assert.equal(responsiveSummary.publisherImages.responsiveImageSets, 3,
    "Repeated raw/rendered srcset occurrences describe the same three responsive image sets");
  assert.equal(responsiveSummary.publisherImages.sourceGaps, undefined,
    "Unselected responsive alternatives are not additional missing primary image sources");
  assert.equal(responsiveSummary.publisherImages.unique, 3);
  assert.equal(responsiveSummary.publisherImages.saved, 1);
  assert.equal(JSON.stringify(responsive.raw), responsiveOriginal);
  assert.equal(responsive.fp.captureContract.complete, false);
  const responsiveRenderContext = vm.createContext({ stats: { inlineExternalContent: responsiveSummary },
    state: {}, count: { textContent: "" } });
  new vm.Script(source.slice(start, end)).runInContext(responsiveRenderContext);
  assert(responsiveRenderContext.count.textContent.includes("Responsive alternatives listed for 3 images"));
  assert(!responsiveRenderContext.count.textContent.includes("image source gaps"));
});

test("publisher image progress distinguishes observed publisher failures from CTI wrapper failures without trusting reason codes", () => {
  const declarations = ["publicPageFailureOutcome", "summarizeInlineItem", "inlineExternalContentSummary"].map(name => {
    let declaration;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
      else ts.forEachChild(node, visit);
    }
    visit(parsedEntry); assert(declaration); return declaration.getText(parsedEntry);
  }).join("\n"), context = vm.createContext({ itemStates: new Map(), courseId: WIDGET_COURSE, directPublisherMediaStructureV1 }),
    outcomes = ["PUBLISHER_IMAGE_UPSTREAM_HTTP_403", "PUBLISHER_IMAGE_SERVICE_HTTP_502", "PUBLISHER_IMAGE_UPSTREAM_HTTP_403"],
    fixtures = [createInlinePublisherMediaContentFixture({ itemId: "ImageReadingA", atomId: "A".repeat(22), outcomes }),
      createInlinePublisherMediaContentFixture({ itemId: "ImageReadingB", atomId: "B".repeat(22), outcomes })];
  new vm.Script(declarations).runInContext(context);
  const attempts = (reason, upstreamStatus, serviceStatus) => [{
    transport: "BROWSER_PUBLISHER_IMAGE", observedAt: "2026-10-18T20:50:08.994Z", status: 0,
    responseType: "unreadable", reason: "PUBLISHER_IMAGE_BLOCKED_OR_FAILED",
  }, {
    transport: "CTI_SERVICE_PUBLIC_IMAGE", observedAt: "2026-10-18T20:50:10.250Z",
    serviceOrigin: "https://cti-hardening.pages.dev", serviceStatus, upstreamStatus,
    // These clocks belong to different machines; their order is not evidence
    // that a browser received the response before its upstream observation.
    upstreamObservedAt: upstreamStatus ? "2026-10-18T20:50:10.267Z" : "",
    upstreamRequests: 1, upstreamBytes: 0, reason,
  }];
  for (const f of fixtures) {
    const resources = f.publisherMedia.resources;
    resources[0].attempts = attempts(resources[0].reason, 403, 502);
    resources[1].attempts = attempts(resources[1].reason, 0, 502);
    resources[2].attempts = attempts(resources[2].reason, 0, 0);
  }
  const before = fixtures.map(f => JSON.stringify(f.raw)), summarize = () => {
    context.itemStates.clear();
    for (const f of fixtures) context.itemStates.set(f.fp.id, { inlineExternalContent: context.summarizeInlineItem(f.fp) });
    return clone(context.inlineExternalContentSummary());
  }, summary = summarize();
  assert.deepEqual(summary.publisherImages, { unique: 3, saved: 0, historical: 0, browserUnavailable: 0,
    failed: 1, unverified: 0, publisherHttp: { "403": 1 }, serviceHttp: { "502": 1 } });
  assert.equal(summary.wholeWidgetVerified, false);
  assert(fixtures.every(f => f.fp.captureContract.complete === false));
  assert.deepEqual(fixtures.map(f => JSON.stringify(f.raw)), before, "Reporting cannot rewrite original observations or native completeness");
  const start = source.indexOf("      const inline = stats.inlineExternalContent;"), end = source.indexOf("      count.hidden =", start),
    renderContext = vm.createContext({ stats: { inlineExternalContent: summary }, state: {}, count: { textContent: "" } });
  new vm.Script(source.slice(start, end)).runInContext(renderContext);
  assert(renderContext.count.textContent.includes("Publisher image sources 0/3 saved (1 publisher HTTP 403; 1 CTI service HTTP 502; 1 other uncaptured image sources)"));
  assert(!renderContext.count.textContent.includes("2 CTI service HTTP 502"), "A service 502 wrapping the observed publisher 403 is the same failed image read");
  assert(!renderContext.count.textContent.includes("Cloudflare check"),"A generic 403 reason or status is not an observed Cloudflare challenge");
  assert.equal(summary.publisherImages.publisherHttp["403"], 1,
    "An unreadable status-zero record with a 403 reason string cannot establish another observed publisher 403");

  const first = fixtures[0].publisherMedia.resources[0];
  first.reason = "PUBLISHER_IMAGE_SERVICE_HTTP_502";
  first.attempts = attempts(first.reason, 0, 502);
  const repeated = summarize();
  assert.deepEqual(repeated.publisherImages.publisherHttp, { "403": 1 },
    "An observed publisher failure takes precedence across duplicate placements of the same image URL");
  assert.deepEqual(repeated.publisherImages.serviceHttp, { "502": 1 });

  const trigger = fixtures[1].publisherMedia.resources[0].attempts[1];
  trigger.reason = fixtures[1].publisherMedia.resources[0].reason = "PUBLISHER_IMAGE_UPSTREAM_CHALLENGE";
  trigger.upstreamChallenge = "cloudflare";
  for (const f of fixtures) {
    const deferred = f.publisherMedia.resources[1], service = deferred.attempts[1];
    deferred.reason = service.reason = "PUBLISHER_IMAGE_SERVICE_ORIGIN_CHALLENGE_NOT_ATTEMPTED";
    Object.assign(service,{serviceStatus:0,upstreamStatus:0,upstreamObservedAt:"",upstreamRequests:0,upstreamBytes:0,
      notAttempted:"ORIGIN_CHALLENGE",blockedBy:{url:f.publisherMedia.resources[0].url,observedAt:trigger.observedAt}});
  }
  const challenge = summarize();
  assert.deepEqual(challenge.publisherImages.publisherHttp,{"403":1});
  assert.equal(challenge.publisherImages.serviceHttp,undefined,"Deferred images have no observed service HTTP status");
  assert.equal(challenge.publisherImages.challengeDeferred,1);
  assert.equal(challenge.publisherImages.publisherChallenges,1);
  const deferredRender = vm.createContext({stats:{inlineExternalContent:challenge},state:{},count:{textContent:""}});
  new vm.Script(source.slice(start,end)).runInContext(deferredRender);
  assert(deferredRender.count.textContent.includes("1 deferred after publisher challenge"));
  assert(deferredRender.count.textContent.includes("Publisher requested a Cloudflare check; image bytes remain uncaptured. Further service reads to that origin are deferred for this attempt."));

  for (const f of fixtures) Object.assign(f.publisherMedia.resources[0].attempts[1], {
    upstreamStatus: 403, upstreamObservedAt: "2026-10-18T20:50:10.267Z", upstreamRequests: 0,
  });
  const invalid = summarize();
  assert.equal(invalid.publisherImages.unique, 0, "Invalid attempt metadata cannot establish any image outcome");
  assert.equal(invalid.publisherImages.publisherHttp, undefined);
  assert.equal(invalid.publisherImages.serviceHttp, undefined);
  assert.equal(invalid.publisherImages.sourceGaps, 1);
});

test("the actual entry records separate native and flag-set comparison hashes without calling a flag reorder a course edit", async () => {
  let materialReads = 0;
  const app = harness({ readResult(call) {
    if (call.resource !== "materials") return;
    const flags = ["SHOW_GRADE_ON_RELEASE", "LIMITED_SUBMISSIONS", "TAKE_LATEST_GRADE"];
    if (materialReads++) flags.reverse();
    return { ok: true, data: { elements: [{ id: COURSE, material: { elements: [{
      id: "ModuleA", elements: [{ id: "LessonA", elements: [{ id: "ReadingA", content: {
        typeName: "ungradedAssignment", definition: { assignmentFeatures: flags },
      } }] }],
    }] } }] }, receipt: { status: 200, bytes: 64,
      originalResponseSha256: "a".repeat(64), observedAt: new Date(call.at).toISOString(),
    } };
  } });
  app.launch(); await app.idle();
  assert.equal(app.state().state, "COMPLETE");
  const output = (await exportedCapture(app.downloads[0])).capture;
  const mode = output.meta.directDataCapture;
  assert.equal(mode.sourceStable, true);
  assert.notEqual(mode.initialMaterialHash, mode.finalMaterialHash);
  assert.equal(mode.materialStability.policy, CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1);
  assert.equal(mode.materialStability.initialSha256, mode.materialStability.finalSha256);
  assert.notEqual(mode.stopReason, "DIRECT_COURSE_CHANGED_DURING_CAPTURE");
});

test("the actual entry still stops completion when the native material version changes", async () => {
  let materialReads = 0;
  const app = harness({ beforeRead(call) {
    if (call.resource === "materials" && materialReads++) app.control.materialRevision++;
  } });
  app.launch(); await app.idle();
  assert.equal(app.state().state, "INCOMPLETE");
  const mode = (await exportedCapture(app.downloads[0])).capture.meta.directDataCapture;
  assert.equal(mode.sourceStable, false);
  assert.notEqual(mode.materialStability.initialSha256, mode.materialStability.finalSha256);
  assert.equal(mode.stopReason, "DIRECT_COURSE_CHANGED_DURING_CAPTURE");
});

test("a second click focuses an active capture rather than creating another reader", async () => {
  const held = deferred();
  const app = harness({
    beforeRead: async ({ resource }) => {
      if (resource === "materials") await held.promise;
    },
  });
  app.launch();
  await until(() => app.readers().length === 1, "Reader did not start");
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch(); await app.idle();
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
  app.launch(); await app.idle();
  assert.equal(app.state().runId, runId);
  assert.equal(app.calls.slice(before).filter(call => call.resource === "atom" && call.id === "Atom_ReadingA").length, 2,
    "Rechecking retained text cannot skip both fresh bound atom reads for an unresolved item");
  assert.equal(app.state().state, "COMPLETE");
});

test("missing local original bodies allow a bound current media read to recover", async () => {
  const fixture = readingMediaOptions(), app = harness(fixture.options);
  app.launch(); await app.idle();
  const runId = app.state().runId;
  app.bodies.clear();
  const before = app.calls.length;
  app.launch(); await app.idle();
  assert.equal(app.state().runId, runId);
  assert(app.calls.slice(before).some(call => call.resource === "atom" && call.id === "Atom_ReadingA"));
  assert(fixture.mediaCalls.some(call => call.attempt === 1), "Missing local bytes must not abort before media acquisition");
  assert.equal(app.state().state, "COMPLETE");
  assert.equal(app.downloads.length, 2);
});

test("readable legacy originals still export in one ZIP when quota prevents body checkpoint migration", async () => {
  const fixture = readingMediaOptions(), app = harness(fixture.options);
  app.launch();await app.idle();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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
  app.launch();
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

function panoptoEntryOptions() {
  const native = panoptoDeliveryFixture();
  const targetUrl = native.targetUrl.replace("video.example.test", "fixture.hosted.panopto.com");
  native.model.EmbedUrl = native.model.EmbedUrl.replace("video.example.test", "fixture.hosted.panopto.com");
  native.model.Delivery.PodcastStreams[0].StreamUrl = native.model.Delivery.PodcastStreams[0].StreamUrl.replace("media.example.test", "fixture.cloudfront.net");
  const model = sanitizeDirectPanoptoModelV1(native.model, targetUrl).data;
  const candidate = directPanoptoPodcastBindingsV1(model, targetUrl)[0];
  const mediaCalls = [], settings = [], metadataReads = new Map(), providerReads = new Map();
  const control = { failBodyAttempt: -1, failProviderAttempt: -1, changeSourceAttempt: -1 };
  let mediaAttempt = 0;
  const bytes = (attempt) => Uint8Array.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,0,0,0,attempt]);
  const sha = (attempt) => createHash("sha256").update(bytes(attempt)).digest("hex");
  const options = {
    ids: ["WidgetA", "WidgetB"], widgetIds: ["WidgetA", "WidgetB"],
    itemNames: { WidgetA: "Synthetic repeated widget title", WidgetB: "Synthetic repeated widget title" },
    widgetTarget: () => targetUrl,
    panoptoModel(call) {
      const count = (metadataReads.get(call.factory) || 0) + 1;
      metadataReads.set(call.factory, count);
      const value = clone(model);
      if (call.factory === control.changeSourceAttempt && count >= 2)
        value.Delivery.SessionName = "Synthetic changed source title";
      return value;
    },
    beforeRead(call) {
      if (call.resource !== "widget") return;
      const key = call.factory + "/" + call.id;
      const count = (providerReads.get(key) || 0) + 1;
      providerReads.set(key, count);
      if (call.factory === control.failProviderAttempt && call.id === "p".repeat(22) && count === 2)
        return "WIDGET_PROVIDER_FINAL_READ_FAILED";
    },
    mediaReaderFactory(configuration) {
      const attempt = mediaAttempt++, metrics = { bytes: 0, requests: 0 };
      settings.push(clone(configuration.limits));
      return {
        async capture() { throw Error("Unexpected ordinary asset in Panopto entry fixture"); },
        async capturePanoptoPodcast(initial, streamFileId, retained) {
          mediaCalls.push({ attempt, streamFileId, retained, targetUrl: initial.receipt.targetUrl });
          metrics.requests++;
          const binding = { ...candidate, assetId: streamFileId };
          if (attempt === control.failBodyAttempt)
            return { ...binding, reason: "DIRECT_ASSET_BODY_FETCH_FAILED" };
          const bodyBytes = bytes(attempt);
          metrics.bytes += bodyBytes.length;
          return { ...binding, body: {
            kind: "PANOPTO_PODCAST_RENDITION", base64: Buffer.from(bodyBytes).toString("base64"),
            size: bodyBytes.length, mime: "video/mp4", sha256: sha(attempt), canonicalUrl: candidate.canonicalUrl,
            receipt: { role: "PODCAST_STREAM_RENDITION", status: 200, bytes: bodyBytes.length,
              mime: "video/mp4", sha256: sha(attempt), canonicalUrl: candidate.canonicalUrl,
              observedAt: initial.receipt.observedAt, bodyFormat: "ORIGINAL_BINARY_BYTES_BASE64" },
          } };
        },
        snapshot: () => clone(metrics), abort() {}, release() {},
      };
    },
  };
  return { options, control, targetUrl, model, candidate, bytes, sha, mediaCalls, settings };
}

test("the entry binds repeated-title widgets separately while deduplicating a shared Panopto body within one attempt", async () => {
  const fixture = panoptoEntryOptions(), app = harness(fixture.options);
  app.launch(); await app.idle();
  assert.equal(app.state().state, "INCOMPLETE");
  assert.equal(app.state().exportError, "");
  assert.equal(app.downloads.length, 1);
  assert.equal(app.calls.filter(call => call.resource === "panopto").length, 4,
    "each item retains its own initial and final metadata observations");
  assert.equal(fixture.mediaCalls.length, 1, "one stable shared target needs one body GET per attempt");
  assert.equal(fixture.mediaCalls[0].retained, null);
  assert.equal(app.metrics.bodyWrites.length, 1);
  const runId = app.state().runId, budget = app.runs.get(runId).budget;
  assert.equal(budget.media.requests, 1);
  assert.equal(budget.media.bytes, fixture.bytes(0).length);
  assert.equal(budget.requests, app.calls.length);
  assert.equal(budget.bytes, app.calls.length * 64);
  const { capture, zip } = await exportedCapture(app.downloads[0]);
  assert.equal(capture.fingerprints[0].name, capture.fingerprints[1].name);
  for (const [index, fp] of capture.fingerprints.entries()) {
    const providerId = String.fromCharCode(112 + index).repeat(22);
    const providerReads = app.calls.map((call, position) => ({ ...call, position }))
      .filter(call => call.resource === "widget" && call.id === providerId);
    assert.equal(providerReads.length, 2);
    assert(providerReads.every(call => call.courseId === COURSE));
    assert.equal(app.calls.slice(providerReads[0].position, providerReads[1].position)
      .filter(call => call.resource === "panopto").length, 2,
    "the final provider read follows both external source observations");
    const evidence = fp.payload.directPanoptoEvidence, delivery = evidence.deliveries[0];
    assert.equal(evidence.itemId, fp.id);
    assert.equal(evidence.providerId, providerId);
    assert.equal(delivery.targetUrl, fixture.targetUrl);
    assert.equal(delivery.stableSource, true);
    assert.equal(delivery.initial.sourceHash, delivery.final.sourceHash);
    assert.equal(delivery.podcasts[0].body.sha256, fixture.sha(0));
    assert.equal(delivery.podcasts[0].body.kind, "PANOPTO_PODCAST_RENDITION");
    assert.equal(evidence.wholeWidgetVerified, false);
    assert.equal(fp.captureContract.complete, false);
  }
  assert.deepEqual(Object.keys(zip.files).sort(), ["capture.json.gz", "files/" + fixture.sha(0)].sort());
  assert.deepEqual(await zip.file("files/" + fixture.sha(0)).async("nodebuffer"), Buffer.from(fixture.bytes(0)));
});

test("Panopto continuation fetches the rendition again while preserving assessment models and observation times", async () => {
  const fixture = panoptoEntryOptions(), app = harness({ ...fixture.options,
    ids: ["WidgetA", "WidgetB", "AssessmentZ"], assignmentIds: ["AssessmentZ"], assessmentInventory: () => ({}) });
  app.launch(); await app.idle();
  const runId = app.state().runId, assessment = app.items.get(runId + "/AssessmentZ").fingerprint;
  const observedAt = assessment.payload.directDataSources.receipts.atom.observedAt;
  assessment.payload.assessmentApiEvidence = { questionDefinitions: [{ id: "saved-question@1", definition: "Synthetic saved native definition" }],
    receipts: [{ observedAt }] };
  assessment.payload.structuredAssessment = { questions: [{ id: "saved-question@1", prompt: "Synthetic saved prompt", answerKey: "Synthetic saved key" }] };
  const originalAssessment = clone(assessment.payload), before = app.calls.length;
  app.advance(60000);
  app.state().resume(); await app.idle();
  assert.equal(app.state().runId, runId);
  assert.equal(app.state().exportError, "");
  assert.equal(app.downloads.length, 2);
  assert.equal(fixture.mediaCalls.filter(call => call.attempt === 1).length, 1,
    "a new attempt cannot reuse a previous remote rendition observation");
  assert.equal(app.calls.slice(before).filter(call => call.resource === "panopto").length, 4);
  assert.equal(app.calls.slice(before).filter(call => call.resource === "widget").length, 4);
  assert(!app.calls.slice(before).some(call => call.id === "Atom_AssessmentZ" || ["group", "definition"].includes(call.resource)));
  assert.deepEqual(app.items.get(runId + "/AssessmentZ").fingerprint.payload, originalAssessment);
  assert.equal(fixture.settings[1].totalBytes, CTI_DIRECT_DATA_MEDIA_BYTES_V1 - fixture.bytes(0).length);
  assert.equal(app.runs.get(runId).budget.media.requests, 2);
  assert.equal(app.runs.get(runId).budget.media.bytes, fixture.bytes(0).length + fixture.bytes(1).length);
  const { capture, zip } = await exportedCapture(app.downloads.at(-1));
  assert.deepEqual(capture.fingerprints.find(fp => fp.id === "AssessmentZ").payload, originalAssessment);
  const delivery = capture.fingerprints[0].payload.directPanoptoEvidence.deliveries[0];
  assert.equal(delivery.podcasts[0].body.sha256, fixture.sha(1));
  assert(Date.parse(delivery.podcasts[0].body.receipt.observedAt) > Date.parse(observedAt));
  assert.deepEqual(await zip.file("files/" + fixture.sha(1)).async("nodebuffer"), Buffer.from(fixture.bytes(1)));
});

test("failed fresh podcast acquisition retains historical proof and its original ZIP bytes", async () => {
  const fixture = panoptoEntryOptions(), app = harness({ ...fixture.options, ids: ["WidgetA"], widgetIds: ["WidgetA"] });
  app.launch(); await app.idle();
  const runId = app.state().runId;
  const previous = clone(app.items.get(runId + "/WidgetA").fingerprint.payload.directPanoptoEvidence.deliveries[0]);
  fixture.control.failBodyAttempt = 1;
  app.advance(60000); app.state().resume(); await app.idle();
  assert.equal(app.state().exportError, "");
  assert.equal(fixture.mediaCalls.length, 2);
  assert.equal(app.metrics.bodyWrites.length, 1);
  const { capture, zip } = await exportedCapture(app.downloads.at(-1));
  const fp = capture.fingerprints[0], delivery = fp.payload.directPanoptoEvidence.deliveries[0], podcast = delivery.podcasts[0];
  assert.equal(podcast.body, undefined);
  assert.equal(podcast.reason, "DIRECT_ASSET_BODY_FETCH_FAILED");
  assert.equal(podcast.retainedEvidence.podcast.body.sha256, fixture.sha(0));
  assert.deepEqual(podcast.retainedEvidence.initial, previous.initial);
  assert.deepEqual(podcast.retainedEvidence.final, previous.final);
  assert.equal(podcast.retainedEvidence.podcast.body.receipt.observedAt, previous.podcasts[0].body.receipt.observedAt);
  assert.equal(fp.captureContract.complete, false);
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified, false);
  assert.deepEqual(await zip.file("files/" + fixture.sha(0)).async("nodebuffer"), Buffer.from(fixture.bytes(0)));
});

test("a failed final provider read preserves fresh podcast bytes without seeding the next item's shared-target cache", async () => {
  const fixture = panoptoEntryOptions(), app = harness(fixture.options);
  app.launch(); await app.idle();
  fixture.control.failProviderAttempt = 1;
  app.advance(60000); app.state().resume(); await app.idle();
  assert.equal(app.state().exportError, "");
  assert.equal(app.downloads.length, 2);
  assert.equal(fixture.mediaCalls.filter(call => call.attempt === 1).length, 2,
    "a failed item's source binding must not seed the next item's byte cache");
  const { capture, zip } = await exportedCapture(app.downloads.at(-1));
  const first = capture.fingerprints[0], second = capture.fingerprints[1];
  assert.equal(first.payload.directResumeRevalidation.verified, false);
  assert.equal(first.payload.directResumeRevalidation.reason, "WIDGET_PROVIDER_FINAL_READ_FAILED");
  assert.equal(first.captureContract.complete, false);
  assert.equal(first.payload.directPanoptoEvidence.deliveries[0].podcasts[0].body.sha256, fixture.sha(1));
  assert.equal(second.payload.directWidgetProviderEvidence.stableSource, true);
  assert.equal(second.payload.directPanoptoEvidence.deliveries[0].podcasts[0].body.sha256, fixture.sha(1));
  assert.deepEqual(await zip.file("files/" + fixture.sha(1)).async("nodebuffer"), Buffer.from(fixture.bytes(1)));
  assert.equal(app.metrics.bodyWrites.filter(value => value.sha256 === fixture.sha(1)).length, 1,
    "separate current reads still share content-addressed body storage");
});

test("completed v1.5 and v1.6 gap captures continue in the original run without rereading saved assessment banks", async () => {
  for (const buildId of ["v1.5.0-bound-widget-configuration-20261015", "v1.6.0-integrated-panopto-bookmark-20261015", "v1.6.1-provider-access-diagnostics-20261015", "v1.7.2-content-and-structure-coverage-20261017", "v1.7.3-panopto-exact-body-length-20261017"]) {
    const app = harness({ ids: ["WidgetA", "AssessmentZ"], widgetIds: ["WidgetA"],
      assignmentIds: ["AssessmentZ"], assessmentInventory: () => ({}) });
    app.launch(); await app.idle();
    const runId = app.state().runId, saved = app.runs.get(runId);
    const assessment = app.items.get(runId + "/AssessmentZ").fingerprint;
    const observedAt = assessment.payload.directDataSources.receipts.atom.observedAt;
    assessment.payload.assessmentApiEvidence = { questionDefinitions: [{ id: "saved-question@1", native: "Synthetic saved native definition" }],
      receipts: [{ observedAt }] };
    assessment.payload.structuredAssessment = { questions: [{ id: "saved-question@1", prompt: "Synthetic saved prompt", answerKey: "Synthetic saved key" }] };
    const original = clone(assessment.payload);
    saved.state = "INCOMPLETE";
    saved.buildId = buildId;
    saved.captureMeta.buildId = buildId;
    Object.assign(saved.captureMeta.directDataCapture, { acquisitionComplete: true, sourceStable: true,
      wholeCourseVerified: false, stopReason: "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS" });
    const baseObservedAt = saved.captureMeta.directDataCapture.finalMaterialsReceipt.observedAt;
    const before = app.calls.length;
    app.advance(60000); app.launch(); await app.idle();
    assert.equal(app.state().runId, runId, buildId + " must remain the same capture run");
    assert.equal(app.state().exportError, "");
    assert.equal(app.state().state, "INCOMPLETE");
    assert.equal(app.calls.slice(before).filter(call => call.resource === "widget").length, 2);
    assert(!app.calls.slice(before).some(call => call.id === "Atom_AssessmentZ" || ["group", "definition"].includes(call.resource)));
    assert.deepEqual(app.items.get(runId + "/AssessmentZ").fingerprint.payload, original);
    const { capture } = await exportedCapture(app.downloads.at(-1));
    assert.equal(capture.meta.directDataCapture.runId, runId);
    assert.equal(capture.meta.directDataCapture.mediaEnrichment.baseBuildId, buildId);
    assert.equal(capture.meta.directDataCapture.mediaEnrichment.baseSourceCapturedAt, baseObservedAt);
    assert.deepEqual(capture.fingerprints.find(fp => fp.id === "AssessmentZ").payload, original);
  }
});

for (const [version, originalBuild] of [
  ["v1.8.0", "v1.8.0-inline-widget-public-html-20261018"],
  ["v1.8.1", "v1.8.1-browser-publisher-api-20261018"],
  ["v1.8.2", "v1.8.2-historical-publisher-checkpoint-20261018"],
  ["v1.8.3", "v1.8.3-publisher-sections-original-images-20261018"],
  ["v1.8.4", "v1.8.4-public-publisher-images-20261019"],
  ["v1.8.5", "v1.8.5-publisher-challenge-aware-20261019"],
  ["v1.8.6", "v1.8.6-publisher-back-matter-20261019"],
]) test("exact " + version + " continuation preserves 80 bound originals and completed assessment history while acquiring fresh publisher JSON", async t => {
  useNativeCml(t);
  const f = publisherEntryFixture(), source = f.fixtures[0],
    assetIds = Array.from({ length: 80 }, (_, index) => "Original" + String(index).padStart(14, "0")),
    definition = source.fp.payload.directDataSources.atom.elements[0].draft.content.definition.content.definition;
  definition.value = definition.value.replace("<co-content>", "<co-content>" + assetIds.map(id => '<asset id="' + id + '"/>').join(""));
  const assessmentFixture = widgetFixture({ itemId: "AssessmentZ", atomId: "Z".repeat(22) }),
    assessmentSources = assessmentFixture.fp.payload.directDataSources;
  assessmentSources.atom.elements[0].draft.content = { typeName: "staffGradedDraft", definition: {} };
  const assessmentFp = { ...clone(assessmentFixture.fp), type: "Assignment", typeName: "staffGraded", payload: {}, sourceIdentity: {} };
  f.options.ids.push(assessmentFp.id); f.options.fingerprints[assessmentFp.id] = assessmentFp;
  f.options.assessmentInventory = () => ({ declared: 0, candidates: [], rawParts: [], unsupportedParts: [] });
  const readResult = f.options.readResult, mediaCalls = [], mediaSettings = [], actualBodies = new Map();
  f.options.readResult = call => {
    if (["atom", "relation"].includes(call.resource) && call.id === assessmentFp.atomId)
      return { ok: true, data: clone(assessmentSources[call.resource]), receipt: {
        ...clone(assessmentSources.receipts[call.resource]), observedAt: new Date(call.at).toISOString(),
      } };
    return readResult(call);
  };
  let mediaAttempt = 0;
  f.options.mediaReaderFactory = configuration => {
    const attempt = mediaAttempt++, stats = { bytes: 0, requests: 0 };
    mediaSettings.push(clone(configuration.limits));
    return { async capture(assetId, retained) {
      mediaCalls.push({ attempt, assetId, retained: clone(retained) });
      if (retained?.body) return clone(retained);
      stats.requests++;
      assert.equal(attempt, 0, "Continuation must hand every matching original to the media reader");
      const index = assetIds.indexOf(assetId), bytes = Buffer.alloc(512);
      bytes.write("AC1032", "ascii"); bytes.writeUInt32LE(index, 128);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      actualBodies.set(sha256, bytes); stats.bytes += bytes.length;
      return { assetId, metadata: { elements: [{ id: assetId, name: "native-plan-" + index + ".dwg", typeName: "file",
        url: { url: "https://fixture.cloudfront.net/native-plan-" + index + ".dwg" } }] },
        metadataReceipt: { observedAt: "2027-01-15T08:00:00.000Z", resource: "assets.v1", id: assetId },
        body: { base64: bytes.toString("base64"), size: bytes.length, mime: "application/acad", sha256,
          receipt: { observedAt: "2027-01-15T08:00:00.000Z", bodyFormat: "ORIGINAL_BINARY_BYTES_BASE64" } },
        stability: { stable: true } };
    }, snapshot: () => clone(stats), abort() {}, release() {} };
  };
  f.control.api = "blocked"; f.control.html = "blocked";
  const app = harness(f.options);
  app.launch(); await app.idle();
  const runId = app.state().runId, run = app.runs.get(runId),
    reading = app.items.get(runId + "/" + source.fp.id).fingerprint,
    originalAssets = clone(reading.payload.directAssetEvidence.assets),
    assessment = app.items.get(runId + "/AssessmentZ").fingerprint;
  assert.equal(originalAssets.length, 80); assert.equal(app.bodies.size, 80);
  assert.equal(app.metrics.bodyWrites.length, 80);
  assert.deepEqual(originalAssets.map(asset => asset.assetId), assetIds, "Every original came from an actual native CML reference");
  assessment.captureContract = { complete: true, method: "DIRECT_ASSESSMENT", reasons: [], contentPartsCaptured: true };
  const originalAssessmentObservedAt = assessment.payload.directDataSources.receipts.atom.observedAt;
  assessment.payload.assessmentApiEvidence = { questionDefinitions: [{ id: "saved-native-question@1", definition: "Exact previously captured native question" }],
    receipts: [{ observedAt: originalAssessmentObservedAt }] };
  assessment.payload.structuredAssessment = { questions: [{ id: "saved-native-question@1", prompt: "Original prompt", answerKey: "Original answer evidence" }] };
  const originalAssessmentPayload = clone(assessment.payload), originalBudget = clone(run.budget);
  if (version === "v1.8.0") delete reading.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages;
  run.buildId = run.captureMeta.buildId = originalBuild;
  run.captureMeta.directDataCapture.extractorBuildId = originalBuild;
  const baseSourceTime = run.captureMeta.directDataCapture.finalMaterialsReceipt.observedAt, before = app.calls.length;
  f.control.api = "success";
  app.advance(60000); app.launch(); await app.idle();
  assert.equal(app.state().runId, runId, "Migration keeps the exact existing capture run");
  assert.equal(app.state().state, "INCOMPLETE"); assert.equal(app.state().exportError, "");
  const resumed = app.runs.get(runId), current = app.items.get(runId + "/" + source.fp.id).fingerprint,
    freshApi = current.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0].observation;
  assert(freshApi, JSON.stringify(current.captureContract));
  assert.equal(freshApi.model.rawJson, source.publisherRawJson);
  assert(Date.parse(freshApi.model.observedAt) > Date.parse(baseSourceTime));
  assert.equal(resumed.captureMeta.directDataCapture.mediaEnrichment.baseBuildId, originalBuild);
  assert.equal(resumed.captureMeta.directDataCapture.mediaEnrichment.baseSourceCapturedAt, baseSourceTime);
  assert.equal(app.calls.slice(before).filter(call => call.resource === "widget").length, 2, "Current native provider observations precede fresh API capture");
  assert.equal(app.calls.slice(before).filter(call => call.resource === "publisher").length, 1);
  assert(!app.calls.slice(before).some(call => call.id === assessmentFp.atomId || ["group", "definition"].includes(call.resource)));
  assert.deepEqual(app.items.get(runId + "/AssessmentZ").fingerprint.payload, originalAssessmentPayload);
  assert.equal(app.items.get(runId + "/AssessmentZ").fingerprint.payload.directDataSources.receipts.atom.observedAt, originalAssessmentObservedAt);
  assert.equal(mediaCalls.filter(call => call.attempt === 1).length, 80, "Each bound asset is handed to the media helper for current metadata validation");
  assert(mediaCalls.filter(call => call.attempt === 1).every(call => call.retained?.body?.sha256 && call.retained.body.archivePath));
  assert.deepEqual(current.payload.directAssetEvidence.assets, originalAssets, "Body receipts, source observations, hashes and archive references stay unchanged");
  assert.equal(app.metrics.bodyWrites.length, 80, "No matching original body is downloaded or re-stored");
  assert.equal(app.bodies.size, 80);
  assert.equal(mediaSettings[1].totalBytes, CTI_DIRECT_DATA_MEDIA_BYTES_V1 - originalBudget.media.bytes);
  assert.equal(resumed.budget.media.bytes, originalBudget.media.bytes);
  assert.equal(resumed.budget.media.requests, originalBudget.media.requests, "Reusing retained bytes does not add binary download requests");
  assert.equal(resumed.budget.requests, originalBudget.requests + app.calls.length - before);
  assert.equal(resumed.budget.bytes, originalBudget.bytes + 64 * (app.calls.length - before));
  assert(resumed.budget.elapsedMs >= originalBudget.elapsedMs);
  const { capture, zip } = await exportedCapture(app.downloads.at(-1));
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified, false);
  assert.deepEqual(capture.fingerprints.find(fp => fp.id === "AssessmentZ").payload, originalAssessmentPayload);
  for (const [sha256, bytes] of actualBodies) assert.deepEqual(await zip.file("files/" + sha256).async("nodebuffer"), bytes);
});

function providerDiagnosticOptions() {
  const native = panoptoDeliveryFixture(), widgetIds = Array.from({ length: 6 }, (_, index) => "Widget" + index);
  const fixtures = widgetIds.map((itemId, index) => {
    const targetUrl = native.targetUrl.replace("video.example.test", "fixture.hosted.panopto.com")
      .replace(native.ids.A, [native.ids.A, native.ids.B, native.ids.C][Math.floor(index / 2)]);
    const f = widgetFixture({ itemId, atomId: String.fromCharCode(75 + index).repeat(22),
      providerId: String.fromCharCode(112 + index).repeat(22), url: targetUrl });
    f.relation.branchRelationMap = { [COURSE + "~" + itemId]: { courseId: COURSE, itemId, courseSlug: SLUG } };
    f.providerReceipt.requestQuery.find(pair => pair[0] === "courseId")[1] = COURSE;
    return f;
  });
  const options = {
    ids: [...widgetIds, "ReadingZ", "AssessmentZ"], widgetIds,
    assignmentIds: ["AssessmentZ"], assessmentInventory: () => ({}),
    readResult(call) {
      const f = fixtures.find(value => call.resource === "widget" ? value.providerReceipt.id === call.id : value.atom.id === call.id);
      const observedAt = new Date(call.at).toISOString();
      if (call.resource === "atom" || call.resource === "relation") {
        const data = { elements: [f[call.resource]] };
        const receipt = { ...f.fp.payload.directDataSources.receipts[call.resource], observedAt };
        return { ok: true, data, receipt };
      }
      if (call.resource === "widget")
        return { ok: true, data: f.model, receipt: { ...f.providerReceipt, observedAt } };
      if (call.resource === "panopto") {
        const id = new URL(call.id).searchParams.get("id");
        return { ok: false, data: null, reason: "PANOPTO_ACCESS_BLOCKED_OR_FAILED", receipt: {
          resource: "PanoptoDeliveryInfo", id, targetUrl: call.id, origin: new URL(call.id).origin,
          method: "POST", requestPath: "/Panopto/Pages/Viewer/DeliveryInfo.aspx",
          requestForm: directPanoptoRequestFormV1(id), observedAt, status: 0, bytes: 0,
          bodyFormat: "PARSED_SANITIZED_JSON_MODEL", originalResponseSha256: "",
          diagnostics: { schemaVersion: 1, outcome: "CORS_OR_NETWORK", httpStatus: 0,
            policyEventsAvailable: true, enforcedCsp: null, relatedEnforcedCsp: null },
        } };
      }
    },
  };
  return { options, fixtures };
}

test("opening the bookmark waits for an explicit capture or access-check action", async () => {
  const app = harness();
  app.execute(); await turn();
  assert.equal(app.state().state, "READY");
  assert.equal(app.state().running, false);
  assert.equal(app.state().diagnosing, false);
  assert.equal(app.metrics.storeOpens, 0);
  assert.equal(app.factories.length, 0);
  assert.equal(app.calls.length, 0);
  assert.equal(app.runs.size, 0);
  assert.equal(app.downloads.length, 0);
  app.button("Capture/resume course").click(); await app.idle();
  assert.equal(app.state().state, "COMPLETE");
  assert.equal(app.downloads.length, 1);
});

test("provider-only diagnostics deduplicate three targets across six native placements without capture writes or bank reads", async () => {
  const fixture = providerDiagnosticOptions(), app = harness(fixture.options);
  app.execute();
  app.button("Check Panopto access").click();
  await until(() => app.state().accessDiagnostic && !app.state().diagnosing, "Provider-only diagnostic did not finish: " + JSON.stringify(app.alerts));
  const diagnostic = app.state().accessDiagnostic;
  assert.equal(app.factories.length, 1);
  assert.equal(app.factories[0].hasSanitizer, true, "native source reads require the credential sanitizer");
  assert.equal(app.metrics.helperOpens[0].storeOpens, 0);
  assert.equal(typeof app.factories[0].providerTransport?.request, "function");
  assert.equal(app.metrics.helperCloses, 1);
  assert.equal(diagnostic.items.length, 6);
  assert.equal(diagnostic.nativeFailures.length, 0);
  assert.equal(new Set(diagnostic.items.map(item => item.targetUrl)).size, 3);
  assert.equal(app.calls.filter(call => call.resource === "panopto").length, 3);
  assert.equal(app.calls.filter(call => call.resource === "materials").length, 1);
  assert.equal(app.calls.filter(call => call.resource === "widget").length, 6);
  assert.equal(app.calls.filter(call => call.resource === "atom").length, 6);
  assert.equal(app.calls.filter(call => call.resource === "relation").length, 6);
  assert(!app.calls.some(call => ["group", "definition", "course"].includes(call.resource) || /ReadingZ|AssessmentZ/.test(call.id)));
  assert.equal(app.metrics.storeOpens, 0);
  assert.equal(app.metrics.writes.length + app.metrics.bodyWrites.length + app.metrics.saves.length, 0);
  assert.equal(app.items.size + app.bodies.size + app.runs.size, 0);
  assert.equal(app.downloads.length, 0, "the access check never downloads a course or report automatically");
  for (const key of ["contentCompletionVerified", "sourceStabilityVerified", "bodyVerified", "playbackVerified", "launchVerified", "wholeWidgetVerified"])
    assert.equal(diagnostic[key], false);
  assert(diagnostic.items.every(item => item.request.data === undefined));
  const firstPair = diagnostic.items.slice(0, 2);
  assert.notEqual(firstPair[0].itemId, firstPair[1].itemId);
  assert.notEqual(firstPair[0].providerId, firstPair[1].providerId);
  assert.equal(firstPair[0].targetUrl, firstPair[1].targetUrl);
  app.button("Download access report").click();
  assert.equal(app.downloads.length, 1);
  const saved = JSON.parse(await app.downloads[0].blob.text());
  assert.equal(saved.kind, "CTI_PROVIDER_ACCESS_DIAGNOSTIC");
  assert.equal(saved.items.length, 6);
  assert.equal(saved.fingerprints, undefined);
});

test("a stopped provider-only diagnostic can be checked again without starting capture", async () => {
  const fixture = providerDiagnosticOptions(), held = deferred(), app = harness(fixture.options);
  app.control.beforeRead = async ({ resource }) => { if (resource === "materials") await held.promise; };
  app.execute(); app.button("Check Panopto access").click();
  await until(() => app.calls.some(call => call.resource === "materials"), "Diagnostic did not begin its outline read");
  app.state().stop(); held.resolve();
  await until(() => app.state().accessDiagnostic && !app.state().diagnosing, "Stopped diagnostic never settled");
  app.control.beforeRead = undefined;
  const before = app.factories.length;
  app.button("Check Panopto access").click();
  await until(() => app.factories.length > before && app.state().accessDiagnostic && !app.state().diagnosing, "Stopped diagnostic could not be retried");
  assert.equal(app.state().accessDiagnostic.items.length, 6);
  assert.equal(app.metrics.storeOpens, 0);
  assert.equal(app.metrics.writes.length + app.metrics.bodyWrites.length + app.metrics.saves.length, 0);
  assert.equal(app.downloads.length, 0);
});
