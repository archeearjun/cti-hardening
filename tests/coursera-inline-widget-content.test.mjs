import test from "node:test";
import assert from "node:assert/strict";
import { createInlinePublicContentFixture } from "./coursera-inline-content-fixtures.mjs";
import {
  courseraInlineWidgetContent,
  courseraInlineWidgetContentSize,
  courseraInlineWidgetContentText,
  courseraInlineWidgetPage,
  inlineWidgetStaticHtmlText,
  validateCourseraInlineWidgetContent,
  MAX_INLINE_WIDGET_ITEM_BYTES,
} from "../src/domain/coursera-inline-widget-content.ts";
import { buildContentSnapshot, validateContentSnapshot, contentEvidenceText } from "../src/domain/content-evidence.ts";
import { createHash } from "node:crypto";

test("separate native configuration and verified public HTML survive snapshot, JSON reload and readable export without upgrading the native reading", () => {
  const f = createInlinePublicContentFixture(), before = JSON.stringify(f.raw),
    snapshot = buildContentSnapshot(undefined, undefined, f.raw),
    content = snapshot.coursera[0].content,
    inline = content.inlineWidgetContent;
  assert(inline);
  assert.equal(inline.providers.length, 1);
  assert.equal(inline.providers[0].providerId, f.providerId);
  assert.equal(inline.providers[0].configuredTargets.length, 2);
  assert.equal(inline.providers[0].publicPages[0].finalUrl, f.finalUrl);
  assert.equal(inline.providers[0].publicPages[0].status, "CAPTURED_PARTIAL_PUBLIC_HTML");
  assert.equal(content.text, "");
  assert.equal(content.textCoverage, "UNVERIFIED");
  assert.equal(content.questions.length, 0);
  assert.equal(f.fp.captureContract.complete, false);
  assert.equal(JSON.stringify(f.raw), before, "Projection must not rewrite the capture's original records");
  validateContentSnapshot(snapshot);
  const saved = JSON.parse(JSON.stringify(snapshot));
  validateContentSnapshot(saved);
  assert.equal(JSON.stringify(inline).match(/__CTI_INLINE_HTML_EXECUTED__/g)?.length, 1,
    "HTML belongs only to its retained proof, never a duplicated display field");
  const original = courseraInlineWidgetPage(inline, f.providerId, f.targetUrl);
  assert.equal(original.html, f.observation.model.html);
  assert(original.text.includes("area = length × width"));
  assert(original.text.includes("<drawing> label & original wording"));
  assert(!original.text.includes("__CTI_INLINE_HTML_EXECUTED__"));
  assert(!original.text.includes("__CTI_INLINE_IMAGE_EXECUTED__"));
  const exported = contentEvidenceText(content);
  assert(exported.includes("CAPTURED EMBEDDED PAGES"));
  assert(exported.includes(f.targetUrl));
  assert(exported.includes(f.finalUrl));
  assert(exported.includes("area = length × width"));
  assert(exported.includes("PARTIAL_PUBLIC_HTML"));
  assert(!exported.includes("window.__CTI_INLINE_HTML_EXECUTED__"));
  assert.equal(globalThis.__CTI_INLINE_HTML_EXECUTED__, undefined);
});

test("public page failure keeps the independently bound configured target and an explicit unresolved page", () => {
  const f = createInlinePublicContentFixture(), page = f.fp.payload.directInlineWidgetProviderEvidence.providers[0].publicPages[0];
  page.observation = null;
  page.failures = [{ reason: "PROVIDER_HELPER_REQUEST_FAILED" }];
  const content = courseraInlineWidgetContent(f.fp, f.courseId);
  assert(content);
  assert.equal(content.providers[0].configuredTargets[0].url, f.targetUrl);
  assert.equal(content.providers[0].publicPages[0].status, "UNRESOLVED");
  assert.deepEqual(content.providers[0].publicPages[0].failures, ["PROVIDER_HELPER_REQUEST_FAILED"]);
  assert.equal(courseraInlineWidgetPage(content, f.providerId, f.targetUrl), null);
  validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(content)), f.fp.id, f.courseId);
  assert(courseraInlineWidgetContentText(content).includes("PROVIDER_HELPER_REQUEST_FAILED"));
});

test("a failed refresh retains earlier HTML separately with its original timestamp and current failure", () => {
  const f = createInlinePublicContentFixture(), page = f.fp.payload.directInlineWidgetProviderEvidence.providers[0].publicPages[0],
    originalHtml = page.observation.model.html, originalTime = page.observation.model.observedAt;
  page.retainedObservation = page.observation;
  page.observation = null;
  page.failures = [{ reason: "PROVIDER_HELPER_REQUEST_FAILED" }];
  const content = courseraInlineWidgetContent(f.fp, f.courseId);
  assert(content);
  const projected = content.providers[0].publicPages[0];
  assert.equal(projected.status, "HISTORICAL_RETAINED_PUBLIC_HTML");
  assert.equal(projected.observedAt, originalTime);
  assert.deepEqual(projected.failures, ["PROVIDER_HELPER_REQUEST_FAILED"]);
  const retained = courseraInlineWidgetPage(content, f.providerId, f.targetUrl);
  assert.equal(retained.historical, true);
  assert.equal(retained.html, originalHtml);
  assert.equal(JSON.stringify(content).match(/__CTI_INLINE_HTML_EXECUTED__/g)?.length, 1);
  validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(content)), f.fp.id, f.courseId);
  assert(courseraInlineWidgetContentText(content).includes("current read failed; content freshness unverified"));
  assert.equal(f.fp.captureContract.complete, false);
  const wrongTarget = structuredClone(content);
  wrongTarget.proof.inlineProviderEvidence.providers[0].publicPages[0].retainedObservation.model.requestedUrl += "other";
  assert.throws(() => validateCourseraInlineWidgetContent(wrongTarget, f.fp.id, f.courseId));
  const duplicate = createInlinePublicContentFixture();
  const freshPage = duplicate.fp.payload.directInlineWidgetProviderEvidence.providers[0].publicPages[0];
  freshPage.retainedObservation = structuredClone(freshPage.observation);
  assert.equal(courseraInlineWidgetContent(duplicate.fp, duplicate.courseId), null,
    "A successful current read cannot also duplicate an older body in its projection");
});

test("tampered native selector, owner, current draft, target, HTML, SHA and saved projections cannot survive independent saved-source rederivation", () => {
  const mutations = [
    value => { value.providers[0].providerId += "2"; },
    value => { value.providers[0].configuredTargets[0].url = "https://opentextbc.ca/other-book/"; },
    value => { value.providers[0].publicPages[0].sha256 = "a".repeat(64); },
    value => { value.providers[0].publicPages[0].finalUrl = "https://opentextbc.ca/other-book/"; },
    value => { value.proof.inlineProviderEvidence.providers[0].initial.model.elements[0].owners = ["COURSE~ForeignCourse"]; },
    value => { value.proof.inlineProviderEvidence.providers[0].providerId += "2"; },
    value => { value.proof.inlineProviderEvidence.providers[0].initial.receipt.requestQuery[1][1] += "2"; },
    value => { value.proof.inlineProviderEvidence.providers[0].publicPages[0].targetUrl = "https://opentextbc.ca/other-book/"; },
    value => { value.proof.inlineProviderEvidence.providers[0].publicPages[0].sourceFields = ["linked.configurationExamples"]; },
    value => { value.proof.inlineProviderEvidence.providers[0].publicPages[0].observation.model.html += "<p>Invented later</p>"; },
    value => { value.proof.inlineProviderEvidence.providers[0].publicPages[0].observation.model.sha256 = "a".repeat(64); },
    value => { value.proof.inlineProviderEvidence.providers[0].publicPages[0].observation.receipt.requestQuery = []; },
    value => { delete value.proof.inlineProviderEvidence.providers[0].publicPages[0].observation.receipt.declaredEnvelopeBytes; },
    value => { value.proof.inlineProviderEvidence.providers[0].publicPages[0].observation.receipt.declaredEnvelopeBytes++; },
    value => { value.proof.inlineProviderEvidence.providers[0].wholeWidgetVerified = true; },
    value => { value.proof.sources.receipts.stability.stable = false; },
    value => { value.proof.sources.receipts.stability.atom.elements[0].draft.name = "Changed current draft"; },
    value => { value.proof.item.id = "AnotherItem"; },
    value => { value.proof.courseId = "ForeignCourse"; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = createInlinePublicContentFixture(), content = courseraInlineWidgetContent(f.fp, f.courseId),
      saved = JSON.parse(JSON.stringify(content));
    mutate(saved);
    assert.throws(() => validateCourseraInlineWidgetContent(saved, f.fp.id, f.courseId), /source evidence/, "mutation " + index);
  }
});

test("snapshot course URLs and item placement remain bound to the retained native proof", () => {
  for (const mutate of [
    snapshot => { snapshot.coursera[0].id = "AnotherItem"; },
    snapshot => { snapshot.coursera[0].content.url = snapshot.coursera[0].content.url.replace("Synthetic_widget_course", "ForeignCourse"); },
    snapshot => { snapshot.brightspace.push(snapshot.coursera.pop()); },
  ]) {
    const f = createInlinePublicContentFixture(), snapshot = buildContentSnapshot(undefined, undefined, f.raw);
    mutate(snapshot);
    assert.throws(() => validateContentSnapshot(snapshot));
  }
});

test("a coherent HTML and body-hash rewrite still fails its unchanged original response-envelope hash", () => {
  const f = createInlinePublicContentFixture(), saved = courseraInlineWidgetContent(f.fp, f.courseId),
    page = saved.proof.inlineProviderEvidence.providers[0].publicPages[0].observation;
  page.model.html += "<p>Changed after source receipt</p>";
  const bytes = new TextEncoder().encode(page.model.html);
  page.model.sha256 = createHash("sha256").update(bytes).digest("hex");
  page.model.bytes = bytes.length;
  page.receipt.upstreamBytes = bytes.length;
  saved.providers[0].publicPages[0].sha256 = page.model.sha256;
  saved.providers[0].publicPages[0].bytes = bytes.length;
  assert.throws(() => validateCourseraInlineWidgetContent(saved, f.fp.id, f.courseId));
});

test("HTML previews remain inert and explicit when scripts, attributes, unsupported entities or unclosed script source are present", () => {
  const html = '<html><body><script>window.bad=true</script><style>.bad{}</style><main>' +
    '<p onclick="bad()">A &amp; B &#215; &lt;img&gt; &unknown;</p><iframe src="https://no.example/"></iframe>' +
    '<script>unclosed dangerous source';
  const text = inlineWidgetStaticHtmlText(html);
  assert(text.includes("A & B × <img> &unknown;"));
  assert(!text.includes("window.bad"));
  assert(!text.includes("bad()"));
  assert(!text.includes("unclosed dangerous"));
  assert.equal(globalThis.bad, undefined);
});

test("malformed angle-bracket runs scale with input size while useful authored text remains inert", () => {
  // Keep the run entirely without '>' so an unterminated opener cannot borrow
  // a later real tag terminator and hide the rescan regression.
  const tail = 'Useful &lt;drawing&gt; &amp; original wording.',
    measure = input => {
      const started = performance.now();
      for (let iteration = 0; iteration < 10; iteration++) inlineWidgetStaticHtmlText(input);
      return performance.now() - started;
    },
    median = values => values.sort((a, b) => a - b)[1];
  for (const prefix of ["<script ", "<div ", "<!--"]) {
    const close = prefix === "<!--" ? "-->" : "",
      small = prefix.repeat(8192) + close + tail,
      large = prefix.repeat(32768) + close + tail;
    for (let warmup = 0; warmup < 10; warmup++) inlineWidgetStaticHtmlText(small);
    const smallTime = median([measure(small), measure(small), measure(small)]),
      largeTime = median([measure(large), measure(large), measure(large)]);
    assert(largeTime < smallTime * 9,
      `Four times the malformed ${prefix} input must not grow quadratically (${largeTime / smallTime}×)`);
    assert(inlineWidgetStaticHtmlText(large).includes("Useful <drawing> & original wording."));
    const boundedOriginal = prefix.repeat(Math.floor((1024 * 1024 - 256) / prefix.length)) + close + tail;
    assert(inlineWidgetStaticHtmlText(boundedOriginal).includes("Useful <drawing> & original wording."));
  }
  assert.equal(globalThis.__CTI_INLINE_HTML_EXECUTED__, undefined);
});

test("per-item and aggregate review bounds are checked before deriving any saved supplemental source", () => {
  assert.throws(() => courseraInlineWidgetContentSize({ padding: "x".repeat(MAX_INLINE_WIDGET_ITEM_BYTES + 1) }), /review limit/);
  const f = createInlinePublicContentFixture(), snapshot = buildContentSnapshot(undefined, undefined, f.raw),
    item = snapshot.coursera[0];
  item.content.inlineWidgetContent.proof.padding = "x".repeat(6 * 1024 * 1024);
  snapshot.coursera = Array.from({ length: 4 }, () => item);
  assert.throws(() => validateContentSnapshot(snapshot), /snapshot review limit/,
    "The cumulative bound must run before source rederivation rejects a modified proof");
});

test("old captures without inline source proof do not gain content and an oversized raw proof remains deferred", () => {
  const f = createInlinePublicContentFixture();
  delete f.fp.payload.directInlineWidgetProviderEvidence;
  const old = buildContentSnapshot(undefined, undefined, f.raw);
  assert.equal(old.coursera[0].content.inlineWidgetContent, undefined);
  assert.equal(old.coursera[0].content.text, "");
  const large = createInlinePublicContentFixture();
  large.fp.payload.directInlineWidgetProviderEvidence.padding = "x".repeat(MAX_INLINE_WIDGET_ITEM_BYTES + 1);
  const deferred = buildContentSnapshot(undefined, undefined, large.raw);
  assert.equal(deferred.coursera[0].content.inlineWidgetContent, undefined);
  assert(deferred.coursera[0].content.limitations.some(value => value.includes("review limit")));
});
