import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { assertBrightspaceCaptureIntegrity } from "../src/domain/brightspace-capture-evidence.ts";
import {
  createBrightspaceContentReader,
  classifyBrightspaceReferenceV110,
  readBrightspaceJsonResponse,
  readBrightspaceBoundedBodyV110,
} from "../src/extractors/brightspace/content-reader.js";

const origin = "https://lms.example.test";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encoder = new TextEncoder();
const source = (id = "123", kind = "TOPIC") => ({
  kind,
  id,
  path: ["Module", "Learn"],
});
const topic = (url, id = "123") => ({
  id,
  url,
  activityType: 1,
  path: ["Module", "Learn"],
});
const fixture = (request, options = {}) =>
  createBrightspaceContentReader({
    origin,
    request,
    sha256,
    DOMParser,
    ...options,
  });
function response(body, contentType = "text/html; charset=utf-8", extra = {}) {
  return new Response(body, {
    headers: { "content-type": contentType, ...extra },
  });
}

const imageViewPath =
  "/d2l/lp/files/temp/synthetic-private-token.png;drawing-1.png/View";
test("only the bounded native same-origin image-view shape is eligible, without guessing other tool endpoints", () => {
  assert.equal(
    classifyBrightspaceReferenceV110(imageViewPath, origin, origin).fetch,
    true,
  );
  assert.equal(
    classifyBrightspaceReferenceV110(imageViewPath, origin, origin).kind,
    "SAME_ORIGIN_FILE",
  );
  for (const raw of [
    "https://other.example.test" + imageViewPath,
    "https://user:secret@lms.example.test" + imageViewPath,
    "javascript:" + imageViewPath,
    imageViewPath.replace("drawing-1.png", "drawing-1.jpg"),
    imageViewPath.replace("synthetic-private-token", "x".repeat(161)),
    imageViewPath.replace("drawing-1", "x".repeat(201)),
    imageViewPath.replace("/View", "/Download"),
    imageViewPath + "/extra.png",
    imageViewPath + "?type=lti",
    imageViewPath.replace(";", "%3B"),
    imageViewPath.replace(";", "%253B"),
    imageViewPath.replace("drawing-1", "%2F..%2Fdrawing-1"),
    imageViewPath.replace("temp/", "temp%2F"),
    imageViewPath.replace("/View", "/%56iew"),
    imageViewPath.replace(".png;drawing-1.png", ".html;drawing-1.html"),
    "/unrelated" + imageViewPath,
    imageViewPath.replace("/d2l/lp/", "/d2l/api/"),
    imageViewPath.replace("/d2l/lp/", "/login/"),
  ])
    assert.equal(
      classifyBrightspaceReferenceV110(raw, origin, origin).fetch,
      false,
      raw,
    );
});

test("native image-view references retain bounded original bytes and pass independent origin and ownership checks", async () => {
  const htmlUrl = origin + "/content/reading.html",
    imageUrl = origin + imageViewPath,
    image = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
    calls = [];
  const reader = fixture(async (url, init) => {
    calls.push({ url, init });
    return url === htmlUrl
      ? response(
          `<html><body><p>Authored reading</p><img src="${imageViewPath}" alt="Authored drawing"/></body></html>`,
        )
      : response(image, "image/png");
  });
  const native = { ...topic(htmlUrl), kind: "TOPIC" };
  native.contentEvidence = await reader.readTopic(native);
  const snapshot = reader.snapshot(),
    assetBodies = snapshot.assetBodies;
  delete snapshot.assetBodies;
  const observed = native.contentEvidence.references[0];
  assert.equal(observed.url, imageUrl);
  assert.equal(observed.status, "CAPTURED_ORIGINAL");
  assert.equal(observed.originalRef, sha256(image));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].init.credentials, "same-origin");
  assert.equal(calls[1].init.mode, "same-origin");
  assert.equal(
    Buffer.from(assetBodies[observed.originalRef].base64, "base64").length,
    image.length,
  );
  const verified = assertBrightspaceCaptureIntegrity({
    schemaVersion: 2,
    page: { url: origin + "/d2l/home/123" },
    contentTree: [native],
    assetBodies,
    contentAcquisition: snapshot,
  });
  assert.equal(verified.originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
  assert.equal(verified.wholeCourseComplete, false);

  const limited = fixture(async () => response(image, "image/png"), {
    maxAssetBytes: 8,
  });
  const rejected = await limited.readTopic(topic(imageUrl));
  assert.equal(rejected.reason, "BODY_LIMIT_EXCEEDED");
  assert.equal(Object.keys(limited.snapshot().assetBodies).length, 0);
});

test("image-view HTML responses and final external or malformed wrapper targets remain unresolved", async () => {
  const requested = origin + imageViewPath;
  const htmlReader = fixture(async () =>
    response("<p>Provider error page</p>"),
  );
  assert.equal(
    (await htmlReader.readTopic(topic(requested))).reason,
    "UNEXPECTED_HTML_FOR_ORIGINAL_FILE",
  );
  assert.equal(Object.keys(htmlReader.snapshot().assetBodies).length, 0);
  for (const target of [
    "https://other.example.test" + imageViewPath,
    requested + "?type=lti",
    requested + "/extra.png",
    requested.replace(";", "%3B"),
  ]) {
    const reader = fixture(async () => {
      const result = response(Uint8Array.from([137, 80, 78, 71]), "image/png");
      Object.defineProperties(result, {
        url: { value: target },
        redirected: { value: true },
      });
      return result;
    });
    const evidence = await reader.readTopic(topic(requested));
    assert.equal(evidence.reason, "OUT_OF_SCOPE_CONTENT_REDIRECT", target);
    assert.equal(Object.keys(reader.snapshot().assetBodies).length, 0);
  }
});

test("HTML source longer than 80k retains full original and complete text instead of a success-labelled clipped sample", async () => {
  const literal = "A source sentence with café and 日本語. ".repeat(3500);
  const html =
    "<html><body><h1>Original title</h1><p>" +
    literal +
    "</p><p>ACTUAL LAST PARAGRAPH</p></body></html>";
  const reader = fixture(async () => response(html));
  const captured = await reader.readTopic(
    topic(origin + "/content/enforced/187960/long.html"),
  );
  assert.equal(captured.status, "CAPTURED");
  assert.equal(captured.html, html);
  assert(captured.text.length > 80000);
  assert(captured.text.endsWith("ACTUAL LAST PARAGRAPH\n"));
  assert.equal(captured.projectionTruncated, false);
  assert.equal(captured.textSha256, sha256(encoder.encode(captured.text)));
  const saved = reader.snapshot(),
    body = saved.assetBodies[captured.rawBodyRef];
  assert.equal(Buffer.from(body.base64, "base64").toString(), html);
  assert.equal(body.sha256, sha256(encoder.encode(html)));
  assert.equal(body.bytes, encoder.encode(html).length);
  assert.equal(captured.bodyReceipt.sha256, body.sha256);
  assert.equal(captured.bodyReceipt.charset, "utf-8");
  assert.equal(saved.wholeCourseComplete, false);
});

test("SRT and VTT remain literal source text including timestamps, angle brackets, BOM and line endings", async () => {
  for (const [name, mime, content] of [
    [
      "caption.srt",
      "text/srt",
      "\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\n<b>Literal caption</b> & exact text\r\n",
    ],
    [
      "caption.vtt",
      "text/vtt",
      "WEBVTT\n\n00:01.000 --> 00:03.500\n<v Speaker>Original <word>\n",
    ],
  ]) {
    const reader = fixture(async () => response(content, mime));
    const captured = await reader.readTopic(topic(origin + "/content/" + name));
    assert.equal(captured.status, "CAPTURED");
    assert.equal(captured.text, content);
    assert.equal(captured.format, name.endsWith("srt") ? "srt" : "vtt");
    assert.equal(captured.textSha256, sha256(encoder.encode(content)));
    assert.equal(
      Buffer.from(
        reader.snapshot().assetBodies[captured.rawBodyRef].base64,
        "base64",
      ).toString(),
      content,
    );
  }
});

test("module and topic references preserve native bindings while exact URL cache and body hashes remove duplicate transfers", async () => {
  const calls = [],
    bytes = Uint8Array.from([255, 216, 255, 224, 0, 1, 2, 3]);
  const reader = fixture(async (url, init) => {
    calls.push({ url, init });
    return response(bytes, "image/jpeg");
  });
  const html =
    '<html><body><img src="/content/image.jpg#first"><img src="/content/image.jpg#second"></body></html>';
  const moduleRefs = reader.discoverReferences(
    html,
    source("55", "MODULE"),
    origin + "/content/module.html",
  );
  await reader.readReferences(moduleRefs);
  const topicRefs = reader.discoverReferences(
    '<img src="/content/image.jpg">',
    source("66"),
    origin + "/content/topic.html",
  );
  await reader.readReferences(topicRefs);
  const saved = reader.snapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, origin + "/content/image.jpg");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.redirect, "follow");
  assert.equal(calls[0].init.mode, "same-origin");
  assert.equal(calls[0].init.purpose, "COURSE_ORIGINAL_BODY");
  assert.equal(saved.assets.length, 1);
  assert.deepEqual(saved.assets[0].sourceBindings, [
    source("55", "MODULE"),
    source("66"),
  ]);
  assert.deepEqual(saved.assets[0].receipt, {
    requestUrl: origin + "/content/image.jpg",
    responseUrl: origin + "/content/image.jpg",
    status: 200,
    observedAt: saved.assets[0].receipt.observedAt,
    contentType: "image/jpeg",
    redirectPolicy: "SAME_ORIGIN_STATIC_CONTENT",
    mode: "same-origin",
    sourceResponseRedirected: false,
    complete: true,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
  assert.equal(Object.keys(saved.assetBodies).length, 1);
  assert.equal(saved.retainedBytes, bytes.length);
  assert.equal(moduleRefs[0].rawUrl, "/content/image.jpg#first");
  assert.equal(moduleRefs[1].url, origin + "/content/image.jpg#second");
});

test("different exact file URLs may share retained body bytes without merging their native source placements", async () => {
  const bytes = encoder.encode("%PDF-1.7\nSynthetic original\n"),
    calls = [];
  const reader = fixture(
    async (url) => {
      calls.push(url);
      return response(bytes, "application/pdf");
    },
    { maxRetainedBytes: bytes.length },
  );
  const a = await reader.readTopic(topic(origin + "/content/a.pdf", "101"));
  const b = await reader.readTopic(topic(origin + "/content/b.pdf", "102"));
  assert.equal(a.status, "CAPTURED_ORIGINAL");
  assert.equal(b.status, "CAPTURED_ORIGINAL");
  assert.equal(a.originalRef, b.originalRef);
  const saved = reader.snapshot();
  assert.equal(calls.length, 2);
  assert.equal(saved.assets.length, 2);
  assert.equal(Object.keys(saved.assetBodies).length, 1);
  assert.deepEqual(
    saved.assets.map((a) => a.sourceBindings[0].id),
    ["101", "102"],
  );
});

test("native module, quiz, assignment and discussion HTML references are discovered without launching LTI or external players", async () => {
  const calls = [],
    pdf = encoder.encode("%PDF-1.7\nCourse outline\n");
  const reader = fixture(async (url) => {
    calls.push(url);
    return response(pdf, "application/pdf");
  });
  const html =
    '<html><body><a href="/d2l/common/dialogs/quickLink/quickLink.d2l?ou=187960&amp;type=coursefile&amp;fileId=Outline.pdf">Outline</a>' +
    '<iframe src="/d2l/common/dialogs/quickLink/quickLink.d2l?ou=187960&amp;type=lti&amp;rCode=exact-lti"></iframe>' +
    '<iframe src="https://nait.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=exact"></iframe>' +
    '<iframe src="https://nait.video.yuja.com/V/Video?v=1"></iframe></body></html>';
  for (const kind of ["MODULE", "QUIZ", "ASSIGNMENT", "DISCUSSION"]) {
    const refs = reader.discoverReferences(
      html,
      source("123", kind),
      origin + "/content/topic.html",
    );
    assert.deepEqual(
      refs.map((r) => r.kind),
      ["COURSE_FILE", "LTI", "PANOPTO", "YUJA"],
    );
    const result = await reader.readReferences(refs);
    assert.deepEqual(
      result.map((r) => r.status),
      ["CAPTURED_ORIGINAL", "NOT_FETCHED", "NOT_FETCHED", "NOT_FETCHED"],
    );
  }
  assert.equal(calls.length, 1);
  assert(calls[0].includes("type=coursefile"));
  assert.equal(reader.snapshot().assets[0].sourceBindings.length, 4);
  assert.throws(
    () => reader.discoverReferences(html, { kind: "TOPIC", id: "" }, origin),
    /NATIVE_SOURCE_BINDING_REQUIRED/,
  );
});

test("tool pages, unrelated ASPX, authentication/API references and external URLs are never fetched", async () => {
  let calls = 0;
  const reader = fixture(async () => {
    calls++;
    throw Error("Must not fetch.");
  });
  for (const url of [
    "/d2l/lms/quizzing/user/quiz_attempt_page.d2l?qi=1",
    "/unrelated.aspx",
    "/login/page.html",
    "/d2l/api/le/1.100/187960/content/123.html",
    "https://other.example.test/file.pdf",
  ]) {
    const ref = classifyBrightspaceReferenceV110(url, origin, origin);
    assert.equal(ref.fetch, false, url);
    await reader.readTopic(topic(new URL(url, origin).href));
  }
  await reader.readTopic({
    ...topic(origin + "/content/quiz.html"),
    activityType: 5,
  });
  assert.equal(calls, 0);
  assert(reader.snapshot().gaps.length >= 6);
});
test("discussion topic bindings retain their native forum scope even when topic IDs repeat", async () => {
  let calls = 0;
  const reader = fixture(async () => {
    calls++;
    return response("%PDF-1.7\nShared source\n", "application/pdf");
  });
  const html = '<a href="/content/shared.pdf">Original</a>';
  const bindings = [
    { ...source("123", "DISCUSSION_TOPIC"), parentId: "81" },
    { ...source("123", "DISCUSSION_TOPIC"), parentId: "82" },
  ];
  for (const binding of bindings)
    await reader.readReferences(
      reader.discoverReferences(html, binding, origin + "/content/topic.html"),
    );
  assert.equal(calls, 1);
  assert.deepEqual(reader.snapshot().assets[0].sourceBindings, bindings);
  const external =
    '<iframe src="https://nait.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=source"></iframe>';
  await reader.readReferences(
    reader.discoverReferences(external, bindings[0], origin),
  );
  assert.equal(reader.snapshot().gaps.at(-1).sourceBinding.parentId, "81");
  assert.equal(
    reader.snapshot().referenceInventories.at(-1).sourceBinding.parentId,
    "81",
  );
  assert.throws(
    () =>
      reader.discoverReferences(
        html,
        source("123", "DISCUSSION_TOPIC"),
        origin,
      ),
    /NATIVE_SOURCE_BINDING_REQUIRED/,
  );
});

test("declared, streamed and cumulative response limits yield explicit gaps without retaining partial bodies", async () => {
  let cancelled = 0;
  const oversized = fixture(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "content-type": "image/jpeg", "content-length": "999" } },
      ),
    { maxAssetBytes: 8 },
  );
  const a = await oversized.readTopic(topic(origin + "/content/large.jpg"));
  assert.equal(a.status, "UNRESOLVED");
  assert.equal(a.reason, "BODY_LIMIT_EXCEEDED");
  assert.equal(cancelled, 1);
  assert.equal(oversized.snapshot().observedBytes, 0);
  assert.equal(Object.keys(oversized.snapshot().assetBodies).length, 0);
  const streamed = fixture(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(10));
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "content-type": "image/jpeg" } },
      ),
    { maxAssetBytes: 8 },
  );
  const b = await streamed.readTopic(topic(origin + "/content/stream.jpg"));
  assert.equal(b.reason, "BODY_LIMIT_EXCEEDED");
  assert.equal(streamed.snapshot().observedBytes, 10);
  assert.equal(Object.keys(streamed.snapshot().assetBodies).length, 0);
  const total = fixture(async () => response(new Uint8Array(8), "image/jpeg"), {
    maxTotalBytes: 12,
  });
  assert.equal(
    (await total.readTopic(topic(origin + "/content/a.jpg"))).status,
    "CAPTURED_ORIGINAL",
  );
  assert.equal(
    (await total.readTopic(topic(origin + "/content/b.jpg"))).reason,
    "TOTAL_BODY_BUDGET_EXCEEDED",
  );
  assert.equal(
    (await total.readTopic(topic(origin + "/content/c.jpg"))).reason,
    "TOTAL_BODY_BUDGET_EXCEEDED",
  );
  assert.equal(total.snapshot().requests, 2);
  assert.equal(total.snapshot().observedBytes, 16);
});

test("complete original bytes remain retained when text decoding or projection limits fail", async () => {
  for (const [body, mime, options, reason] of [
    [
      Uint8Array.from([0xff, 0xfe, 0xff]),
      "text/plain; charset=utf-8",
      {},
      null,
    ],
    [
      "<html><body>Full original preserved.</body></html>",
      "text/html",
      { maxTextProjectionBytes: 1 },
      "TEXT_PROJECTION_BUDGET_EXCEEDED",
    ],
  ]) {
    const reader = fixture(async () => response(body, mime), options);
    const captured = await reader.readTopic(
      topic(origin + "/content/source.txt"),
    );
    assert.equal(captured.status, "CAPTURED_ORIGINAL");
    assert.equal(captured.projectionStatus, "UNRESOLVED");
    if (reason) assert.equal(captured.projectionReason, reason);
    const bytes = typeof body === "string" ? encoder.encode(body) : body;
    const saved = reader.snapshot(),
      original = saved.assetBodies[captured.rawBodyRef];
    assert.deepEqual(
      new Uint8Array(Buffer.from(original.base64, "base64")),
      bytes,
    );
    assert.equal(captured.bodyReceipt.complete, true);
    assert.equal(captured.bodyReceipt.sha256, sha256(bytes));
    assert.equal(captured.text, undefined);
  }
});
test("projection budget counts each emitted native placement while shared original bytes and reference-only HTML remain deduplicated", async () => {
  const html = "<html><body><p>Original full page.</p></body></html>",
    calls = [];
  const first = fixture(async () => response(html));
  const projected = await first.readTopic(
    topic(origin + "/content/shared.html"),
  );
  const projectionBytes =
    encoder.encode(projected.html).length +
    encoder.encode(projected.text).length;
  const reader = fixture(
    async (url) => {
      calls.push(url);
      return response(html);
    },
    { maxTextProjectionBytes: projectionBytes },
  );
  const references = reader.discoverReferences(
    '<a href="/content/shared.html">Original</a>',
    source("90", "MODULE"),
    origin,
  );
  await reader.readReferences(references);
  assert.equal(reader.snapshot().textProjectionBytes, 0);
  const a = await reader.readTopic(
    topic(origin + "/content/shared.html", "101"),
  );
  const b = await reader.readTopic(
    topic(origin + "/content/shared.html", "102"),
  );
  assert.equal(calls.length, 1);
  assert.equal(a.status, "CAPTURED");
  assert.equal(b.status, "CAPTURED_ORIGINAL");
  assert.equal(b.projectionStatus, "UNRESOLVED");
  assert.equal(b.projectionReason, "TEXT_PROJECTION_BUDGET_EXCEEDED");
  assert.equal(b.html, undefined);
  assert.equal(b.text, undefined);
  assert.equal(a.rawBodyRef, b.rawBodyRef);
  assert.equal(Object.keys(reader.snapshot().assetBodies).length, 1);
  assert.equal(reader.snapshot().textProjectionBytes, projectionBytes);
  assert.deepEqual(reader.snapshot().assets[0].sourceBindings, [
    source("90", "MODULE"),
    source("101"),
    source("102"),
  ]);
  assert.equal(reader.snapshot().gaps.at(-1).sourceBinding.id, "102");
});

test("unfollowed redirects and login forms never become archived course-file bodies", async () => {
  for (const make of [
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example.test/file.pdf" },
      }),
    () =>
      response(
        '<html><body><form><input type="password"></form></body></html>',
      ),
  ]) {
    const reader = fixture(async () => make());
    const captured = await reader.readTopic(
      topic(origin + "/content/source.html"),
    );
    assert.equal(captured.status, "UNRESOLVED");
    assert.equal(Object.keys(reader.snapshot().assetBodies).length, 0);
  }
  const reader = fixture(async () => response("<html>Login</html>"));
  assert.equal(
    (await reader.readTopic(topic(origin + "/content/source.jpg"))).reason,
    "UNEXPECTED_HTML_FOR_ORIGINAL_FILE",
  );
  assert.equal(Object.keys(reader.snapshot().assetBodies).length, 0);
});
test("same-origin coursefile redirects retain requested and final identity, while final dynamic or external targets remain unresolved", async () => {
  const requested =
    origin +
    "/d2l/common/dialogs/quickLink/quickLink.d2l?ou=187960&type=coursefile&fileId=Outline.pdf";
  const final = origin + "/content/enforced/187960/Outline.pdf";
  const native = topic(requested, "101");
  const reader = fixture(async (url, init) => {
    assert.equal(init.mode, "same-origin");
    assert.equal(init.redirect, "follow");
    const res = response("%PDF-1.7\nOriginal outline\n", "application/pdf");
    Object.defineProperties(res, {
      url: { value: final },
      redirected: { value: true },
    });
    return res;
  });
  native.kind = "TOPIC";
  native.contentEvidence = await reader.readTopic(native);
  assert.equal(native.contentEvidence.status, "CAPTURED_ORIGINAL");
  assert.equal(native.contentEvidence.bodyReceipt.requestUrl, requested);
  assert.equal(native.contentEvidence.bodyReceipt.responseUrl, final);
  assert.equal(
    native.contentEvidence.bodyReceipt.sourceResponseRedirected,
    true,
  );
  const snapshot = reader.snapshot(),
    assetBodies = snapshot.assetBodies;
  delete snapshot.assetBodies;
  assert.equal(
    assertBrightspaceCaptureIntegrity({
      schemaVersion: 2,
      page: { url: origin + "/d2l/home/187960" },
      contentTree: [native],
      assetBodies,
      contentAcquisition: snapshot,
    }).originalIntegrity,
    "VERIFIED_RETAINED_ORIGINALS",
  );
  for (const target of [
    "https://other.example.test/Outline.pdf",
    origin + "/d2l/lms/quizzing/user/quiz_attempt_page.d2l",
    origin +
      "/d2l/common/dialogs/quickLink/quickLink.d2l?type=coursefile&fileId=Other.pdf",
  ]) {
    const rejected = fixture(async () => {
      const res = response("%PDF-1.7\nWrong source\n", "application/pdf");
      Object.defineProperties(res, {
        url: { value: target },
        redirected: { value: true },
      });
      return res;
    });
    const evidence = await rejected.readTopic(topic(requested));
    assert.equal(evidence.status, "UNRESOLVED");
    assert.equal(evidence.reason, "OUT_OF_SCOPE_CONTENT_REDIRECT");
    assert.equal(Object.keys(rejected.snapshot().assetBodies).length, 0);
  }
});
test("redirected HTML resolves its explicit authored base against the final source URL", async () => {
  const requested = origin + "/content/start.html",
    final = origin + "/content/final/page.html";
  const html =
      '<html><head><base href="../assets/"></head><body><img src="diagram.jpg"></body></html>',
    calls = [];
  const reader = fixture(async (url, init) => {
    calls.push(url);
    assert.equal(init.mode, "same-origin");
    if (url === requested) {
      const res = response(html);
      Object.defineProperties(res, {
        url: { value: final },
        redirected: { value: true },
      });
      return res;
    }
    return response(Uint8Array.from([255, 216, 255, 1]), "image/jpeg");
  });
  const evidence = await reader.readTopic(topic(requested));
  assert.equal(evidence.html, html);
  assert.equal(evidence.documentUrl, final);
  assert.equal(evidence.documentBase, origin + "/content/assets/");
  assert.equal(
    evidence.referenceInventory.documentBase,
    origin + "/content/assets/",
  );
  assert.equal(evidence.images[0].url, origin + "/content/assets/diagram.jpg");
  assert.deepEqual(calls, [requested, origin + "/content/assets/diagram.jpg"]);
});

test("request and body deadlines are bounded and cancellation cannot produce partial success", async () => {
  const reader = fixture(
    async (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
    { timeoutMs: 10 },
  );
  assert.equal(
    (await reader.readTopic(topic(origin + "/content/deadline.html"))).reason,
    "REQUEST_TIMEOUT",
  );
  let cancelled = false;
  const bodyReader = fixture(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(encoder.encode("partial"));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/plain" } },
      ),
    { timeoutMs: 10 },
  );
  const result = await bodyReader.readTopic(
    topic(origin + "/content/pending.txt"),
  );
  assert.equal(result.reason, "REQUEST_TIMEOUT");
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(cancelled, true);
  assert.equal(bodyReader.snapshot().observedBytes, 7);
  assert.equal(Object.keys(bodyReader.snapshot().assetBodies).length, 0);
});
test("pausing after a nested original was retained leaves its full HTML parent and native ownership valid in a partial capture", async () => {
  const controller = new AbortController(),
    html =
      '<html><body><p>Full parent source.</p><img src="/content/first.jpg"><img src="/content/pending.jpg"></body></html>';
  const reader = fixture(
    async (url) => {
      if (url.endsWith("parent.html")) return response(html);
      if (url.endsWith("first.jpg"))
        return response(Uint8Array.from([255, 216, 255, 1]), "image/jpeg");
      controller.abort(Error("PAUSED_BY_OWNER"));
      throw controller.signal.reason;
    },
    { signal: controller.signal },
  );
  const node = {
    kind: "TOPIC",
    ...topic(origin + "/content/parent.html", "101"),
    title: "Original",
    contentEvidence: { status: "NOT_READ" },
  };
  const pending = reader.readTopic(node, {
    onEvidence: (evidence) => {
      node.contentEvidence = evidence;
    },
  });
  // The request adapter aborts as the second child starts. The partial native
  // item already owns its original HTML and both exact referenced URLs.
  try {
    await pending;
  } catch (error) {
    assert.equal(error.message, "PAUSED_BY_OWNER");
  }
  assert.equal(node.contentEvidence.html, html);
  assert.equal(node.contentEvidence.status, "CAPTURED");
  assert(
    node.contentEvidence.references.some((ref) =>
      ref.url.endsWith("/first.jpg"),
    ),
  );
  const snapshot = reader.snapshot(),
    assetBodies = snapshot.assetBodies;
  delete snapshot.assetBodies;
  assert(
    snapshot.assets.some(
      (asset) => asset.url.endsWith("/first.jpg") && asset.originalRef,
    ),
  );
  const capture = {
    schemaVersion: 2,
    extractor: "CTI Brightspace",
    page: { url: origin + "/d2l/home/187960" },
    course: { orgUnitId: "187960" },
    contentTree: [node],
    quizzes: [],
    assignments: [],
    discussions: [],
    assetBodies,
    contentAcquisition: snapshot,
  };
  const proof = assertBrightspaceCaptureIntegrity(capture);
  assert.equal(proof.originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
  assert.equal(proof.wholeCourseComplete, false);
  assert(
    proof.findings.some((f) => f.code === "SOURCE_ORIGINAL_ACQUISITION_GAP"),
  );
});

test("bounded JSON response reading charges exposed bytes even when parsing or body limits fail", async () => {
  let count = 0;
  assert.deepEqual(
    await readBrightspaceJsonResponse(
      response('{"Objects":[]}', "application/json"),
      { maxBytes: 100, onBytes: (n) => (count += n) },
    ),
    { Objects: [] },
  );
  assert.equal(count, 14);
  await assert.rejects(
    readBrightspaceJsonResponse(response("not JSON", "application/json"), {
      maxBytes: 100,
      onBytes: (n) => (count += n),
    }),
    /INVALID_JSON_RESPONSE/,
  );
  assert.equal(count, 22);
  await assert.rejects(
    readBrightspaceBoundedBodyV110(response("0123456789", "text/plain"), {
      maxBytes: 5,
      onBytes: (n) => (count += n),
    }),
    /BODY_LIMIT_EXCEEDED/,
  );
  assert.equal(count, 32);
});
