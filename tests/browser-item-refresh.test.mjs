import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import JSZip from "jszip";
import {
  trustedCtiSender,
  validateRequest,
  itemLocation,
  ownsJob,
  CTI_ORIGIN,
} from "../src/browser-extension/protocol.js";
import { buildExtensionItemScript } from "../src/domain/extension-item-script.ts";
import { ctiExtractorDelivery_ } from "../src/engine/extractor-delivery.js";
import {
  validateRefreshCapture,
  refreshedItemSummary,
  EXTENSION_VERSION,
} from "../src/domain/browser-item-refresh.ts";
const id = "f57b32f4-3ff1-4f38-a8f3-ddd7c2b95335";
const spec = {
  auditId: "audit",
  courseId: "course",
  itemId: "item",
  name: "Quiz",
  url: "https://www.coursera.org/teach/example/course/content/item/assignment/item",
  checks: [{ kind: "prompt", value: "2+2", label: "First question" }],
};
const sender = {
  frameId: 0,
  tab: { id: 7 },
  documentId: "cti-doc",
  url: CTI_ORIGIN + "/",
};
const receipt = () => ({
  kind: "CTI_COURSERA_ITEM_CHECK",
  schemaVersion: 1,
  notForCourseAudit: true,
  ...spec,
  openedUrl: spec.url,
  expectations: spec.checks,
  extractorVersion: "v6.15.11",
  extractorBuild: "v6.15.11-activity-evidence-20261008",
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  editorObserved: true,
  payload: {
    structuredAssessment: {
      questions: [
        { id: "q1", prompt: "2+2" },
        { id: "q2", prompt: "3+3" },
      ],
      captureCompleteness: { questionCoverageComplete: true },
    },
  },
  crawl: { targetDiagnostics: [{ id: "item", stabilityTimedOut: false }] },
});

test("extension accepts only top-frame CTI production senders and exact Coursera authoring item URLs", () => {
  assert(trustedCtiSender(sender));
  for (const change of [
    { url: "https://evil.example/" },
    { url: "https://cti-hardening.pages.dev.evil.example/" },
    { url: "https://preview.cti-hardening.pages.dev/" },
    { frameId: 1 },
    { documentId: undefined },
    { tab: {} },
  ])
    assert.equal(trustedCtiSender({ ...sender, ...change }), false);
  assert(itemLocation(spec.url));
  for (const url of [
    spec.url.replace("www.coursera.org", "www.coursera.org.evil.example"),
    spec.url.replace("https:", "http:"),
    spec.url.replace("www.coursera.org", "user:pass@www.coursera.org"),
    "https://www.coursera.org/learn/example",
    spec.url + "#changed",
    "https://www.coursera.org/teach/example/course/content/edit",
  ])
    assert.equal(itemLocation(url), null);
});
test("refresh request identity, size and protocol are enforced independently of the page", () => {
  assert(validateRequest({ type: "START", protocol: 1, id, spec }));
  for (const changes of [
    { protocol: 2 },
    { type: "EXECUTE_CODE" },
    { id: "other" },
    { spec: { ...spec, itemId: "other" } },
    { spec: { ...spec, courseId: "other" } },
    {
      spec: {
        ...spec,
        checks: [{ kind: "eval", value: "secret", label: "x" }],
      },
    },
    { spec: { ...spec, name: "x".repeat(2001) } },
  ])
    assert.throws(() =>
      validateRequest({ type: "START", protocol: 1, id, spec, ...changes }),
    );
  const job = { id, ctiTabId: 7, ctiDocumentId: "cti-doc" };
  assert(ownsJob(job, sender, id));
  assert(!ownsJob(job, { ...sender, documentId: "reloaded" }, id));
  assert(!ownsJob(job, { ...sender, tab: { id: 8 } }, id));
});
test("packaged runner reuses the canonical item extractor with no runtime code string or automatic download", async () => {
  const script = buildExtensionItemScript(ctiExtractorDelivery_("coursera"));
  new vm.Script(script);
  assert.match(
    script,
    /activeSpaCrawl\(\[fp\],id,\{onlyIds:\[expected.itemId\],maxItems:1/,
  );
  assert(!script.includes("downloadJson('CTI_ITEM_CHECK_"));
  assert.match(script, /CTI_CAPTURE_FINISHED/);
  assert(!script.includes("const expected={"));
  let done;
  const finished = new Promise((r) => (done = r));
  const window = {
    __CTI_EXTENSION_JOB: { state: "RUNNING", spec, id },
    postMessage: done,
  };
  vm.runInNewContext(script, {
    window,
    URL,
    location: {
      href: spec.url.replace("assignment/item", "assignment/wrong"),
      origin: "https://www.coursera.org",
    },
  });
  await finished;
  assert.equal(window.__CTI_EXTENSION_JOB.state, "FAILED");
  assert.match(window.__CTI_EXTENSION_JOB.error, /exact Coursera item/);
  assert.equal(window.__CTI_ITEM_FIDELITY_RUN_LOCK, undefined);
});
test("fresh receipt is validated and recomputed; source keys and original audit approval are never inferred", () => {
  const c = receipt();
  c.evaluation = { automatedResolution: true, questionCount: 999 };
  const checked = validateRefreshCapture(JSON.stringify(c), spec, Date.now());
  assert.equal(checked.problem, "");
  assert.equal(checked.capture.evaluation.questionCount, 2);
  assert.equal(checked.capture.evaluation.automatedResolution, false);
  assert.match(
    refreshedItemSummary(checked.capture, 1),
    /2 question records \(previously 1\)/,
  );
});
test("partial captures retain prior evidence rather than silently replacing a complete item", () => {
  for (const mutate of [
    (c) => (c.editorObserved = false),
    (c) => (c.crawl.targetDiagnostics = []),
    (c) => (c.crawl.targetDiagnostics[0].id = "wrong"),
    (c) => (c.crawl.targetDiagnostics[0].stabilityTimedOut = true),
    (c) => (c.crawl.targetDiagnostics[0].itemAttemptDeadlineReached = true),
    (c) => (c.crawl.timeBudgetExhausted = true),
    (c) => (c.payload.textCaptureTruncated = true),
    (c) => (c.crawl.targetDiagnostics[0].captureContract = { complete: false }),
    (c) =>
      (c.payload.structuredAssessment.captureCompleteness.questionCoverageComplete = false),
  ]) {
    const c = receipt();
    mutate(c);
    assert(validateRefreshCapture(JSON.stringify(c), spec, Date.now()).problem);
  }
  const c = receipt();
  c.payload.structuredAssessment = { questions: [] };
  assert(
    validateRefreshCapture(JSON.stringify(c), spec, Date.now(), 2).problem,
  );
  c.payload.structuredAssessment = {
    questions: [],
    declaredQuestionCount: 2,
    captureCompleteness: { questionCoverageComplete: true },
  };
  assert(validateRefreshCapture(JSON.stringify(c), spec, Date.now()).problem);
});
test("stale, mismatched, malformed and oversized responses cannot be imported as a successful refresh", () => {
  for (const mutate of [
    (c) => (c.itemId = "wrong"),
    (c) => (c.auditId = "other"),
    (c) => (c.expectations = []),
    (c) => (c.extractorBuild = "old"),
    (c) => (c.startedAt = "2020-01-01"),
    (c) => (c.finishedAt = "bad"),
    (c) => (c.payload.structuredAssessment.questions = {}),
    (c) => (c.finishedAt = "2099-01-01"),
  ]) {
    const c = receipt();
    mutate(c);
    assert.throws(() =>
      validateRefreshCapture(JSON.stringify(c), spec, Date.now()),
    );
  }
  assert.throws(() => validateRefreshCapture("broken json", spec, Date.now()));
  assert.throws(
    () =>
      validateRefreshCapture(
        "x".repeat(16 * 1024 * 1024 + 1),
        spec,
        Date.now(),
      ),
    /16 MiB/,
  );
});
test("install ZIP contains the same tested packaged runner and narrow permissions, with no remote executable resource", async () => {
  const zip = await JSZip.loadAsync(
    fs.readFileSync("public/downloads/cti-browser-extension.zip"),
  );
  const root = "CTI-browser-extension/";
  const manifest = JSON.parse(
    await zip.file(root + "manifest.json").async("string"),
  );
  assert.equal(manifest.version, EXTENSION_VERSION);
  assert.deepEqual(manifest.permissions, ["scripting", "storage", "alarms"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.coursera.org/*",
    CTI_ORIGIN + "/*",
  ]);
  assert.deepEqual(manifest.content_scripts[0].matches, [CTI_ORIGIN + "/*"]);
  assert.equal(
    await zip.file(root + "coursera-item.js").async("string"),
    buildExtensionItemScript(ctiExtractorDelivery_("coursera")),
  );
  const background = await zip.file(root + "background.js").async("string");
  assert(!background.includes("eval("));
  assert(!background.includes("new Function"));
  assert(!background.includes("chrome.cookies"));
  assert(!background.includes("fetch("));
});
