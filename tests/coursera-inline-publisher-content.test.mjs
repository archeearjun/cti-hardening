import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createInlinePublisherContentFixture, createInlinePublisherPartContentFixture, createInlinePublisherMediaContentFixture,
  createInlinePublicContentFixture } from "./coursera-inline-content-fixtures.mjs";
import { courseraInlineWidgetContent, courseraInlinePublisherPage, courseraInlinePublisherResource, courseraInlineWidgetContentText,
  validateCourseraInlineWidgetContent } from "../src/domain/coursera-inline-widget-content.ts";
import { buildContentSnapshot, validateContentSnapshot, contentEvidenceText } from "../src/domain/content-evidence.ts";
import { directPublisherMediaInventoryV1, directPublisherMediaEvidenceV1 } from "../src/extractors/coursera/direct-data-publisher-media.js";

const sha = raw => createHash("sha256").update(new TextEncoder().encode(raw)).digest("hex");
const publisherObservation = value => value.proof.inlineProviderEvidence.providers[0].publisherPages[0].observation;

test("publisher API JSON remains exact, separate from original HTML and native reading text across reload and exports", () => {
  const f = createInlinePublisherContentFixture({ keepHistoricalHtml: true }), before = JSON.stringify(f.raw),
    snapshot = buildContentSnapshot(undefined, undefined, f.raw), content = snapshot.coursera[0].content,
    inline = content.inlineWidgetContent, provider = inline.providers[0], page = provider.publisherPages[0];
  assert.equal(inline.scope, "INLINE_CONFIGURATION_AND_PARTIAL_PUBLISHER_CONTENT");
  assert.equal(provider.publicPages[0].status, "HISTORICAL_RETAINED_PUBLIC_HTML");
  assert.equal(page.status, "CAPTURED_PUBLISHER_API_CHAPTER");
  assert.equal(page.chapterId, 179);
  assert.equal(page.chapterLink, f.finalUrl);
  assert.equal(page.responseType, "cors");
  assert.equal(page.credentials, "omit");
  assert.equal(page.sha256, sha(f.publisherRawJson));
  assert.equal(content.text, "");
  assert.equal(content.textCoverage, "UNVERIFIED");
  assert.equal(content.questions.length, 0);
  assert.equal(f.fp.captureContract.complete, false);
  assert.equal(JSON.stringify(f.raw), before);
  assert.equal(sha(JSON.stringify(inline)), "398ac9da332102108a166b13c0cf1db828c1802cf12455fdafb36a6dc0fc0bde",
    "Chapter projections without optional new evidence remain byte-identical to the released shape");
  assert.equal(sha(courseraInlineWidgetContentText(inline)), "2a6d9fe3782a469dc427db116723f7c88a7ea7f346db3e0d685602017e84942e",
    "Existing chapter text exports remain unchanged");
  assert.equal(JSON.stringify(inline).match(/__CTI_PUBLISHER_HTML_EXECUTED__/g)?.length, 1,
    "The original JSON belongs only to the proof, not a duplicated display body");
  const original = courseraInlinePublisherPage(inline, f.providerId, f.targetUrl);
  assert.equal(original.rawJson, f.publisherRawJson);
  assert(original.rawJson.endsWith("\n"));
  assert.equal(original.chapter.content.raw, f.publisherChapter.content.raw);
  assert.equal(original.chapter.content.rendered, f.publisherChapter.content.rendered);
  assert.equal(original.historical, false);
  validateContentSnapshot(snapshot);
  validateContentSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const exported = contentEvidenceText(content);
  assert(exported.includes("Publisher API chapter content"));
  assert(exported.includes("Publisher-authored example: area = length × width."));
  assert(exported.includes(f.publisherChapter.content.raw));
  assert(exported.includes("PARTIAL_PUBLISHER_API" ) || exported.includes("CAPTURED_PUBLISHER_API_CHAPTER"));
  assert(exported.includes("no current HTML observation"));
  assert(!exported.includes("window.__CTI_PUBLISHER_HTML_EXECUTED__"));
  assert.equal(globalThis.__CTI_PUBLISHER_HTML_EXECUTED__, undefined);
});

test("old HTML-only snapshots retain the existing schema and gain no invented API source", () => {
  const f = createInlinePublicContentFixture(), inline = courseraInlineWidgetContent(f.fp, f.courseId),
    serialized = JSON.stringify(inline);
  assert.equal(inline.scope, "INLINE_CONFIGURATION_AND_PARTIAL_PUBLIC_HTML");
  assert.equal(inline.providers[0].publisherPages, undefined);
  validateCourseraInlineWidgetContent(JSON.parse(serialized), f.fp.id, f.courseId);
  assert.equal(JSON.stringify(inline), serialized);
});

test("publisher parts stay typed as book sections while original chapter contracts remain unchanged", () => {
  const f = createInlinePublisherPartContentFixture(), before = JSON.stringify(f.raw),
    snapshot = buildContentSnapshot(undefined, undefined, f.raw), content = snapshot.coursera[0].content,
    inline = content.inlineWidgetContent, page = inline.providers[0].publisherPages[0];
  assert.equal(page.status, "CAPTURED_PUBLISHER_API_PART");
  assert.equal(page.resourceType, "part"); assert.equal(page.resourceId, 179);
  assert.equal(page.resourceLink, f.publisherPart.link);
  assert.equal(Object.hasOwn(page, "chapterId"), false); assert.equal(Object.hasOwn(page, "chapterLink"), false);
  assert.equal(courseraInlinePublisherPage(inline, f.providerId, f.targetUrl), null, "The chapter accessor must remain chapter-only");
  const original = courseraInlinePublisherResource(inline, f.providerId, f.targetUrl);
  assert.equal(original.resourceType, "part"); assert.equal(original.resource.type, "part");
  assert.equal(original.rawJson, f.publisherRawJson); assert.equal(original.historical, false);
  assert.equal(original.resource.content.raw, f.publisherPart.content.raw);
  assert.equal(JSON.stringify(f.raw), before); assert.equal(f.fp.captureContract.complete, false);
  assert.equal(content.text, ""); assert.equal(content.textCoverage, "UNVERIFIED"); assert.equal(content.questions.length, 0);
  assert.equal(JSON.stringify(inline).match(/__CTI_PUBLISHER_HTML_EXECUTED__/g)?.length, 1, "Original publisher JSON is retained once");
  const exported = contentEvidenceText(content);
  assert(exported.includes("Publisher API book section content")); assert(exported.includes("Publisher book section ID: 179"));
  assert(!exported.includes("Publisher chapter ID:")); assert(exported.includes(f.publisherPart.content.raw));
  validateContentSnapshot(snapshot); validateContentSnapshot(JSON.parse(JSON.stringify(snapshot)));
});

test("part history retains its original source and cannot be forged into a chapter or a different native target", () => {
  const f = createInlinePublisherPartContentFixture(), entry = f.fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  entry.retainedObservation = entry.observation; entry.observation = null;
  entry.failures = [{ reason: "PUBLISHER_BROWSER_HTTP_401" }];
  const inline = courseraInlineWidgetContent(f.fp, f.courseId), page = inline.providers[0].publisherPages[0],
    original = courseraInlinePublisherResource(inline, f.providerId, f.targetUrl);
  assert.equal(page.status, "HISTORICAL_RETAINED_PUBLISHER_API_PART");
  assert.equal(page.observedAt, f.publisherPartObservation.model.observedAt);
  assert.equal(original.historical, true); assert.equal(original.rawJson, f.publisherRawJson);
  assert(courseraInlineWidgetContentText(inline).includes("no current book section response is established"));
  validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(inline)), f.fp.id, f.courseId);
  for (const mutate of [
    value => { value.providers[0].publisherPages[0].resourceId = 180; },
    value => { value.providers[0].publisherPages[0].resourceType = "chapter"; },
    value => { value.providers[0].publisherPages[0].status = "HISTORICAL_RETAINED_PUBLISHER_API_CHAPTER"; },
    value => { value.proof.inlineProviderEvidence.providers[0].publisherPages[0].targetUrl += "other"; },
    value => { value.proof.inlineProviderEvidence.providers[0].publisherPages[0].retainedObservation.receipt.resolution.chapterReceipt.status = 401; },
  ]) {
    const saved = JSON.parse(JSON.stringify(inline)); mutate(saved);
    assert.throws(() => validateCourseraInlineWidgetContent(saved, f.fp.id, f.courseId));
  }
});

test("publisher image references stay owned, distinct from embedded bytes and stable across report reload", () => {
  for (const part of [false, true]) {
    const f = createInlinePublisherMediaContentFixture({ part }), before = JSON.stringify(f.raw),
      inline = courseraInlineWidgetContent(f.fp, f.courseId), page = inline.providers[0].publisherPages[0], media = page.media;
    assert(directPublisherMediaEvidenceV1(f.publisherObservation, f.targetUrl, f.publisherMedia, bytes => createHash("sha256").update(bytes).digest("hex")));
    assert.equal(page.status, part ? "CAPTURED_PUBLISHER_API_PART" : "CAPTURED_PUBLISHER_API_CHAPTER");
    assert.equal(media.scope, "ORIGINAL_FILE_REFERENCES_ONLY"); assert.equal(media.resources.length, 2);
    const [captured, blocked] = media.resources;
    assert.equal(captured.status, "CAPTURED_ORIGINAL_FILE_REFERENCE");
    assert.equal(captured.url, f.publisherImageUrls[0]); assert.equal(captured.originalRef, "files/" + captured.sha256);
    assert.equal(captured.bytes, f.publisherMediaBytes.length); assert.equal(captured.mime, "image/png");
    assert.equal(captured.observedAt, "2027-01-15T08:00:00.008Z");
    assert.equal(captured.references.length, 2, "Raw and rendered source occurrences retain their individual locations");
    assert.equal(blocked.status, "UNRESOLVED"); assert.equal(blocked.reason, "PUBLISHER_IMAGE_BLOCKED_OR_FAILED");
    assert.equal(blocked.originalRef, ""); assert.equal(blocked.bytes, null);
    assert.equal(media.bodyVerified, undefined); assert.equal(media.resources[0].body, undefined);
    assert.equal(JSON.stringify(f.raw), before); assert.equal(f.fp.captureContract.complete, false);
    validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(inline)), f.fp.id, f.courseId);
    assert.equal(directPublisherMediaEvidenceV1(f.publisherObservation, f.targetUrl, JSON.parse(JSON.stringify(f.publisherMedia)),
      bytes => createHash("sha256").update(bytes).digest("hex")), null, "Descriptor snapshots cannot attest to unavailable original bytes");
    const snapshot = buildContentSnapshot(undefined, undefined, f.raw);
    validateContentSnapshot(JSON.parse(JSON.stringify(snapshot)));
    const exported = contentEvidenceText(snapshot.coursera[0].content);
    assert(exported.includes("original bytes are not embedded in this report snapshot"));
    assert(exported.includes(captured.originalRef)); assert(exported.includes(f.publisherImageUrls[0]));
    assert(exported.includes("PUBLISHER_IMAGE_BLOCKED_OR_FAILED"));
    assert.equal(snapshot.coursera[0].content.text, ""); assert.equal(snapshot.coursera[0].content.textCoverage, "UNVERIFIED");
  }
});

test("invalid publisher media and collection failures do not hide independently verified original JSON", () => {
  for (const mutate of [
    f => { f.publisherMedia.resources[0].body.receipt.sourceSha256 = "f".repeat(64); },
    f => { f.publisherMedia.resources[0].url = "https://opentextbc.ca/foreign/wp-content/uploads/not-authored.png"; },
    f => { f.publisherMedia.resources[0].body.receipt.observedAt = "2027-01-15T08:00:00.011Z"; },
  ]) {
    const f = createInlinePublisherMediaContentFixture(); mutate(f);
    const inline = courseraInlineWidgetContent(f.fp, f.courseId), page = inline.providers[0].publisherPages[0];
    assert.equal(page.status, "CAPTURED_PUBLISHER_API_CHAPTER");
    assert.equal(courseraInlinePublisherPage(inline, f.providerId, f.targetUrl).rawJson, f.publisherRawJson);
    assert.equal(page.media.resources.length, 0); assert(page.media.failures.length > 0);
    validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(inline)), f.fp.id, f.courseId);
  }
  const f = createInlinePublisherContentFixture(), entry = f.fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  entry.mediaFailures = [{ reason: "PUBLISHER_IMAGE_INVENTORY_UNSUPPORTED" }];
  const inline = courseraInlineWidgetContent(f.fp, f.courseId), page = inline.providers[0].publisherPages[0];
  assert.equal(page.status, "CAPTURED_PUBLISHER_API_CHAPTER"); assert.equal(page.media, undefined);
  assert.deepEqual(page.mediaFailures, ["PUBLISHER_IMAGE_INVENTORY_UNSUPPORTED"]);
  assert(courseraInlineWidgetContentText(inline).includes("Publisher image collection outcome: PUBLISHER_IMAGE_INVENTORY_UNSUPPORTED"));
  validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(inline)), f.fp.id, f.courseId);
});

test("historical image references retain their exact earlier JSON owner and timestamps after source changes", () => {
  const f = createInlinePublisherMediaContentFixture({ outcomes: ["CAPTURED"] }),
    previousObservation = structuredClone(f.publisherObservation), previousResources = f.publisherMedia.resources,
    resource = structuredClone(f.publisherResource);
  resource.content.raw += "<p>Newly observed publisher wording.</p>";
  resource.content.rendered += "<p>Newly observed publisher wording.</p>";
  const rawJson = JSON.stringify(resource, null, 2) + "\n", model = f.publisherObservation.model, receipt = f.publisherObservation.receipt;
  Object.assign(model, { rawJson, bytes: Buffer.byteLength(rawJson), sha256: sha(rawJson), observedAt: "2027-01-15T08:00:00.009Z" });
  Object.assign(receipt, { bytes: model.bytes, originalResponseSha256: model.sha256,
    observedAt: model.observedAt, receivedAt: model.observedAt });
  Object.assign(receipt.attempts[0], { observedAt: model.observedAt, bytes: model.bytes });
  const inventory = directPublisherMediaInventoryV1(f.publisherObservation, f.targetUrl),
    media = { ...inventory, resources: inventory.resources.map(value => ({ ...value, reason: "PUBLISHER_IMAGE_BLOCKED_OR_FAILED" })),
      retained: [{ observation: previousObservation, resources: previousResources }] };
  f.fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0].media = media;
  const inline = courseraInlineWidgetContent(f.fp, f.courseId), projected = inline.providers[0].publisherPages[0].media,
    historical = projected.retainedSources[0];
  assert.equal(projected.sourceSha256, model.sha256); assert.equal(projected.resources[0].status, "UNRESOLVED");
  assert.equal(historical.sourceSha256, previousObservation.model.sha256);
  assert.equal(historical.observedAt, previousObservation.model.observedAt);
  assert.equal(historical.resources[0].observedAt, previousResources[0].body.receipt.observedAt);
  assert.notEqual(historical.sourceSha256, projected.sourceSha256);
  assert.equal(courseraInlinePublisherPage(inline, f.providerId, f.targetUrl).rawJson, rawJson);
  validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(inline)), f.fp.id, f.courseId);
  media.retained[0].observation = f.publisherObservation;
  const mismatched = courseraInlineWidgetContent(f.fp, f.courseId);
  assert.equal(mismatched.providers[0].publisherPages[0].media.resources.length, 0);
  assert(mismatched.providers[0].publisherPages[0].media.failures.length);
});

test("API and browser proof mutations cannot forge a chapter, source type or source observation", () => {
  const mutations = [
    value => { value.providers[0].publisherPages[0].chapterId = 180; },
    value => { value.providers[0].publisherPages[0].endpointUrl += "/other"; },
    value => { value.providers[0].publisherPages[0].chapterLink = "https://opentextbc.ca/other-book/"; },
    value => { publisherObservation(value).model.rawJson += " "; },
    value => { publisherObservation(value).model.sha256 = "f".repeat(64); },
    value => { publisherObservation(value).receipt.originalResponseSha256 = "f".repeat(64); },
    value => { publisherObservation(value).receipt.responseType = "opaque"; },
    value => { publisherObservation(value).receipt.responseType = "basic"; },
    value => { publisherObservation(value).receipt.credentials = "same-origin"; },
    value => { publisherObservation(value).receipt.transport = "CTI_PUBLIC_BACKEND"; },
    value => { publisherObservation(value).receipt.serviceOrigin = "https://cti-hardening.pages.dev"; },
    value => { publisherObservation(value).receipt.requestPath += "0"; },
    value => { publisherObservation(value).receipt.requestQuery = [["context", "edit"]]; },
    value => { publisherObservation(value).receipt.requestedUrl = "https://opentextbc.ca/synthetic-book/?p=180"; },
    value => { publisherObservation(value).receipt.attempts[0].status = 403; },
    value => { publisherObservation(value).receipt.attempts[0].bytes++; },
    value => { publisherObservation(value).receipt.receivedAt = "2027-01-15T08:00:00.011Z"; },
    value => { const observation = publisherObservation(value); observation.model.observedAt = observation.receipt.observedAt =
      observation.receipt.attempts[0].observedAt = "2027-01-15T08:00:00.011Z"; },
    value => { value.proof.inlineProviderEvidence.providers[0].publisherPages[0].sourceFields = ["linked.configurationExamples"]; },
    value => { value.proof.inlineProviderEvidence.providers[0].publisherPages[0].targetUrl += "other"; },
    value => { value.proof.inlineProviderEvidence.providers[0].providerId += "2"; },
    value => { value.proof.sources.receipts.stability.stable = false; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = createInlinePublisherContentFixture(), saved = courseraInlineWidgetContent(f.fp, f.courseId);
    mutate(saved);
    assert.throws(() => validateCourseraInlineWidgetContent(saved, f.fp.id, f.courseId), /source evidence/, "mutation " + index);
  }
});

test("wrong, unpublished, protected and foreign-book publisher bodies fail even when their original-byte hashes agree", () => {
  for (const mutate of [
    chapter => { chapter.id = 180; },
    chapter => { chapter.status = "draft"; },
    chapter => { chapter.type = "page"; },
    chapter => { chapter.link = "https://opentextbc.ca/other-book/chapter/area/"; },
    chapter => { chapter.content.protected = true; },
  ]) {
    const f = createInlinePublisherContentFixture(), observation = f.publisherObservation,
      chapter = structuredClone(f.publisherChapter);
    mutate(chapter);
    observation.model.rawJson = JSON.stringify(chapter);
    observation.model.bytes = new TextEncoder().encode(observation.model.rawJson).length;
    observation.model.sha256 = sha(observation.model.rawJson);
    observation.receipt.bytes = observation.receipt.attempts[0].bytes = observation.model.bytes;
    observation.receipt.originalResponseSha256 = observation.model.sha256;
    assert.equal(courseraInlineWidgetContent(f.fp, f.courseId), null);
  }
});

test("a rewritten API JSON and body hash cannot pass the unchanged browser response hash", () => {
  const f = createInlinePublisherContentFixture(), saved = courseraInlineWidgetContent(f.fp, f.courseId),
    observation = publisherObservation(saved);
  observation.model.rawJson = observation.model.rawJson.replace("original publisher wording", "changed publisher wording");
  observation.model.bytes = new TextEncoder().encode(observation.model.rawJson).length;
  observation.model.sha256 = sha(observation.model.rawJson);
  observation.receipt.bytes = observation.receipt.attempts[0].bytes = observation.model.bytes;
  saved.providers[0].publisherPages[0].bytes = observation.model.bytes;
  saved.providers[0].publisherPages[0].sha256 = observation.model.sha256;
  assert.throws(() => validateCourseraInlineWidgetContent(saved, f.fp.id, f.courseId));
});

test("a failed current browser read retains old API JSON with its original timestamp and explicit historical status", () => {
  const f = createInlinePublisherContentFixture(), page = f.fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0],
    originalTime = page.observation.model.observedAt;
  page.retainedObservation = page.observation;
  page.observation = null;
  page.failures = [{ reason: "PUBLISHER_BROWSER_BLOCKED_OR_FAILED" }];
  const inline = courseraInlineWidgetContent(f.fp, f.courseId), projected = inline.providers[0].publisherPages[0];
  assert.equal(projected.status, "HISTORICAL_RETAINED_PUBLISHER_API_CHAPTER");
  assert.equal(projected.observedAt, originalTime);
  assert.equal(courseraInlinePublisherPage(inline, f.providerId, f.targetUrl).historical, true);
  assert.equal(courseraInlinePublisherPage(inline, f.providerId, f.targetUrl).rawJson, f.publisherRawJson);
  assert(courseraInlineWidgetContentText(inline).includes("no current chapter response is established"));
  validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(inline)), f.fp.id, f.courseId);
  page.observation = page.retainedObservation;
  assert.equal(courseraInlineWidgetContent(f.fp, f.courseId), null, "Current success must not duplicate historical JSON");
});

test("actual CORS mode fallback stays declared browser context and failed API reads retain known native targets", () => {
  const f = createInlinePublisherContentFixture(), receipt = f.publisherObservation.receipt;
  receipt.credentials = "include";
  receipt.attempts[0].credentials = "include";
  receipt.attempts.unshift({ credentials: "omit", observedAt: "2027-01-15T08:00:00.005Z", status: 0,
    responseType: "unreadable", bytes: 0, reason: "PUBLISHER_BROWSER_BLOCKED_OR_FAILED" });
  const inline = courseraInlineWidgetContent(f.fp, f.courseId);
  assert.equal(inline.providers[0].publisherPages[0].credentials, "include");
  const page = f.fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  page.observation = null;
  page.failures = [{ reason: "PUBLISHER_BROWSER_BLOCKED_OR_FAILED" }];
  const failed = courseraInlineWidgetContent(f.fp, f.courseId);
  assert.equal(failed.providers[0].publisherPages[0].status, "UNRESOLVED");
  assert.equal(failed.providers[0].configuredTargets[0].url, f.targetUrl);
  assert.equal(f.fp.captureContract.complete, false);
});
