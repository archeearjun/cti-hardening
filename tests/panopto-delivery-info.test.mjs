import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  importPanoptoDeliveryInfo,
  panoptoDeliveryInfoText,
  panoptoTargetIdentity,
  validatePanoptoDeliveryInfoCapture,
} from "../src/domain/panopto-delivery-info.ts";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const importFixture = f => importPanoptoDeliveryInfo(f.responseText, f.spec, f.targetUrl);
const importModel = f => importPanoptoDeliveryInfo(JSON.stringify(f.model), f.spec, f.targetUrl);

test("Panopto targets require one exact recording identity on a supported HTTPS player route", () => {
  const f = panoptoDeliveryFixture();
  assert.deepEqual(panoptoTargetIdentity(f.targetUrl), {
    origin: "https://video.example.test", deliveryPublicId: f.ids.A,
  });
  assert.ok(panoptoTargetIdentity(f.targetUrl.replace("Embed.aspx", "Viewer.aspx")));
  for (const target of [
    f.targetUrl.replace("https:", "http:"), f.targetUrl + "&id=" + f.ids.A,
    f.targetUrl.replace(f.ids.A, "not-a-guid"), f.targetUrl + "#fragment",
    f.targetUrl.replace("Embed.aspx", "Edit.aspx"), f.targetUrl + "&access_token=secret",
    f.targetUrl.replace("https://", "https://user:secret@"),
  ]) assert.equal(panoptoTargetIdentity(target), null);
});

test("manual native metadata retains distinct reference-copy identities, source roles and literal text", async () => {
  const f = panoptoDeliveryFixture(), capture = await importFixture(f);
  assert.equal(capture.kind, "CTI_PANOPTO_DELIVERY_INFO");
  assert.equal(capture.provenance, "USER_PROVIDED_DELIVERY_RESPONSE");
  assert.deepEqual(capture.identity, { deliveryPublicId: f.ids.A, sessionPublicId: f.ids.B,
    sessionFileId: f.ids.C, viewerFileId: f.ids.D, isReferenceCopy: true });
  assert.equal(capture.nativeModel.SessionId, f.ids.B);
  assert.ok(capture.nativeModel.Delivery.Timestamps.every(entry => entry.SessionID === f.ids.C));
  assert.equal(capture.nativeModel.UnknownMetadata, f.model.UnknownMetadata);
  assert.equal(capture.title, f.model.Delivery.SessionName);
  assert.equal(capture.durationSeconds, 528.567);
  assert.deepEqual(capture.streams.map(value => value.role), ["VIEWER_STREAM", "PODCAST_STREAM"]);
  assert.equal(capture.streams[0].variants.length, 3);
  assert.equal(capture.streams[1].viewerMediaFileTypeName, "mp4");
  assert.equal(capture.captions.status, "REPORTED_NONE");
  assert.equal(capture.navigation.length, 9);
  assert.equal(capture.navigation[0].text, f.model.Delivery.Timestamps[0].Caption);
  assert.equal(capture.responseTextSha256, hash(f.responseText));
  assert.equal(capture.responseTextBytes, Buffer.byteLength(f.responseText, "utf8"));
  assert.ok(Number.isFinite(Date.parse(capture.importedAt)));
  assert.equal(capture.observedAt, undefined);
  assert.equal(capture.transcript, undefined);
});

test("wrong recording, underlying-session and session-file joins fail independently", async () => {
  const changes = [
    f => { f.model.Delivery.PublicID = f.ids.B; },
    f => { f.model.SessionId = f.ids.C; },
    f => { f.model.Delivery.Timestamps[0].SessionID = f.ids.B; },
    f => { f.model.Delivery.SessionFileId = "not-a-guid"; },
    f => { f.model.Delivery.Streams[0].PublicID = "not-a-guid"; },
  ];
  for (const change of changes) {
    const f = panoptoDeliveryFixture(); change(f);
    await assert.rejects(importModel(f));
  }
});

test("native iframe metadata binds both recording and origin without rendering HTML", async () => {
  const f = panoptoDeliveryFixture();
  await assert.rejects(importPanoptoDeliveryInfo(f.responseText, f.spec,
    f.targetUrl.replace("video.example.test", "other.example.test")), /origin/);
  for (const value of [
    f.model.EmbedUrl.replace(f.ids.A, f.ids.B),
    f.model.EmbedUrl.replace("<iframe ", "<iframe src='https://other.example.test/' "),
    f.model.EmbedUrl + "<script>throw Error()</script>",
    f.targetUrl,
  ]) {
    const changed = panoptoDeliveryFixture(); changed.model.EmbedUrl = value;
    await assert.rejects(importModel(changed));
  }
  delete f.model.EmbedUrl;
  const capture = await importModel(f);
  assert.ok(capture.limitations.some(value => value.includes("origin could not be compared")));
  assert.equal(capture.captureSourceVerified, false);
});

test("credential cleanup preserves only validated native content-ID exceptions", async () => {
  const f = panoptoDeliveryFixture();
  f.model.access_token = "synthetic-secret";
  f.model.Delivery.UnknownConfiguration = JSON.stringify({ password: "hidden", label: "retained" });
  f.model.Delivery.Streams[0].StreamUrl += "?token=hidden&quality=high";
  const capture = await importModel(f), saved = JSON.stringify(capture);
  assert.ok(!saved.includes("synthetic-secret"));
  assert.ok(!saved.includes("hidden"));
  assert.equal(capture.nativeModel.SessionId, f.ids.B);
  assert.equal(capture.nativeModel.Delivery.Timestamps[0].SessionID, f.ids.C);
  assert.equal(capture.sanitization.protectedContentIdFieldsRestored, 10);
  assert.ok(capture.sanitization.removedFields >= 12);
  assert.equal(capture.sanitization.redactedUrls, 1);
  assert.ok(capture.limitations.some(value => value.includes("may not be usable download addresses")));
  assert.equal(new URL(capture.streams[0].url).searchParams.get("quality"), "high");
});

test("caption inventory stays scoped and unknown entry schemas never become caption URLs or text", async () => {
  const f = panoptoDeliveryFixture();
  delete f.model.Delivery.AvailableCaptions;
  assert.equal((await importModel(f)).captions.status, "UNKNOWN");
  f.model.Delivery.AvailableCaptions = [{ UnobservedSchema: "https://example.test/should-not-be-fetched" }];
  const contradiction = await importModel(f);
  assert.equal(contradiction.captions.status, "CONTRADICTORY");
  assert.deepEqual(JSON.parse(JSON.stringify(contradiction.nativeModel.Delivery.AvailableCaptions)),
    f.model.Delivery.AvailableCaptions);
  f.model.Delivery.HasCaptions = true;
  const available = await importModel(f);
  assert.equal(available.captions.status, "REPORTED_PRESENT_UNSUPPORTED");
  assert.equal(available.captionUrls, undefined);
  assert.equal(available.transcript, undefined);
  assert.equal(available.captionsVerified, false);
});

test("unknown timestamp events remain native events and unsupported references stay unlinked", async () => {
  const f = panoptoDeliveryFixture();
  f.model.Delivery.Timestamps[0].EventTargetType = "UnknownNativeEvent";
  f.model.Delivery.Streams[0].StreamUrl = "javascript:alert(1)";
  f.model.Delivery.Streams[0].StreamHttpUrl = "blob:https://video.example.test/opaque";
  const capture = await importModel(f);
  assert.equal(capture.navigation[0].eventType, "UnknownNativeEvent");
  assert.equal(capture.navigation[0].text, f.model.Delivery.Timestamps[0].Caption);
  assert.equal(capture.streams[0].url, null);
  assert.equal(capture.streams[0].httpUrl, null);
  assert.ok(capture.limitations.some(value => value.includes("Unknown native timestamp events")));
});

test("file, structure and numeric limits reject partial or malformed response inputs", async () => {
  const f = panoptoDeliveryFixture();
  for (const text of ["{\\rtf1 rich text}", "{}", "[]", "null", "{", " "])
    await assert.rejects(importPanoptoDeliveryInfo(text, f.spec, f.targetUrl));
  f.model.extra = "x".repeat(512 * 1024);
  await assert.rejects(importModel(f), /512 KiB/);
  for (const change of [
    f => { f.model.Delivery.Streams = {}; },
    f => { f.model.Delivery.Streams[0].Variants = {}; },
    f => { f.model.Delivery.Duration = -1; },
    f => { f.model.Delivery.Timestamps[0].Time = "6"; },
    f => { f.model.Delivery.Streams[0].Variants[0].Bandwidth = "high"; },
  ]) {
    const next = panoptoDeliveryFixture(); change(next);
    await assert.rejects(importModel(next));
  }
});

test("saved metadata is rehashed and bound to its report and currently recorded target", async () => {
  const f = panoptoDeliveryFixture(), capture = await importFixture(f);
  for (const key of ["auditId", "courseId", "itemId"])
    assert.throws(() => validatePanoptoDeliveryInfoCapture(capture, { ...f.spec, [key]: "other" }));
  assert.throws(() => validatePanoptoDeliveryInfoCapture(capture, f.spec, []));
  assert.deepEqual(validatePanoptoDeliveryInfoCapture(capture, f.spec), capture);
  const changed = structuredClone(capture); changed.nativeModel.Delivery.SessionName = "edited";
  assert.throws(() => validatePanoptoDeliveryInfoCapture(changed), /changed/);
  changed.nativeModelSha256 = capture.nativeModelSha256;
  changed.nativeModel = structuredClone(capture.nativeModel);
  changed.nativeModel.password = "injected";
  assert.throws(() => validatePanoptoDeliveryInfoCapture(changed), /changed/);
  const wrongOrigin = structuredClone(capture);
  wrongOrigin.targetUrl = wrongOrigin.targetUrl.replace("video.example.test", "other.example.test");
  assert.throws(() => validatePanoptoDeliveryInfoCapture(wrongOrigin), /origin/);
});

test("revalidation rebuilds projections and drops invented transcripts, URLs and completion claims", async () => {
  const f = panoptoDeliveryFixture(), capture = await importFixture(f), altered = structuredClone(capture);
  altered.title = "invented"; altered.streams[0].url = "https://other.example.test/forged";
  altered.navigation[0].text = "invented transcript"; altered.transcript = "invented speech";
  altered.captions.status = "VERIFIED";
  for (const key of ["bodyVerified", "binaryContentVerified", "captionsVerified", "playbackVerified",
    "launchVerified", "courseLaunchVerified", "captureSourceVerified", "wholeWidgetVerified",
    "wholePluginVerified", "automatedResolution"]) altered[key] = true;
  assert.deepEqual(validatePanoptoDeliveryInfoCapture(altered), capture);
});

test("shared display/export text preserves literal source labels and states metadata limits", async () => {
  const f = panoptoDeliveryFixture(), capture = await importFixture(f), text = panoptoDeliveryInfoText(capture);
  assert.ok(text.includes(f.model.Delivery.SessionName));
  assert.ok(text.includes(f.model.Delivery.Timestamps[0].Caption));
  assert.ok(text.includes("VIEWER_STREAM"));
  assert.ok(text.includes("PODCAST_STREAM"));
  assert.ok(text.includes("SmartOcrToc"));
  assert.ok(text.includes("not source observation time"));
  assert.ok(text.includes("not speech captions or a transcript"));
  assert.ok(text.includes("original uploads"));
});

test("metadata import performs no requests or player actions", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw Error("Unexpected network request"); };
  try { await importFixture(panoptoDeliveryFixture()); }
  finally { globalThis.fetch = original; }
});
