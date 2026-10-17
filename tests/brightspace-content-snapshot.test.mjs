import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildContentSnapshot,
  capturedContent,
  contentEvidenceText,
  validateContentSnapshot,
} from "../src/domain/content-evidence.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const at = "2026-10-17T08:00:00.000Z";
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
function sourceFixture(
  text = "1\r\n00:00:01,000 --> 00:00:03,000\r\nLiteral <tag> &amp; caption.\r\n",
  format = "srt",
) {
  const bytes = Buffer.from(text),
    hash = sha(bytes),
    url = `https://source.example.test/course/file.${format}`,
    receipt = {
      requestUrl: url,
      responseUrl: url,
      status: 200,
      observedAt: at,
      bytes: bytes.length,
      sha256: hash,
      complete: true,
      contentType: `text/${format}; charset=utf-8`,
    };
  return {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.1.0",
    capturedAt: "2026-10-17T09:00:00.000Z",
    page: {
      url: "https://source.example.test/d2l/le/lessons/187960/topics/5624765",
    },
    contentTree: [
      {
        kind: "TOPIC",
        id: "5624765",
        title: "Technical Drawings - 2 - Who uses…",
        path: [
          "Student Resources",
          "Video Sub-Title files",
          "Module 1 - Video Series A",
        ],
        activityType: 1,
        activityTypeLabel: "File",
        url,
        description: { text: "A separate native topic description" },
        contentEvidence: {
          status: "CAPTURED",
          url,
          rawBodyRef: hash,
          bodyReceipt: receipt,
          format,
          contentType: receipt.contentType,
          charset: "utf-8",
          html: format === "html" ? text : "",
          text,
          textLength: text.length,
          textSha256: hash,
          projectionTruncated: false,
          references: [],
          links: [],
          images: [],
          embeds: [],
        },
      },
    ],
    quizzes: [],
    assignments: [],
    discussions: [],
    assetBodies: {
      [hash]: {
        encoding: "base64",
        base64: bytes.toString("base64"),
        bytes: bytes.length,
        sha256: hash,
      },
    },
    contentAcquisition: { assets: [], gaps: [] },
  };
}
function snapshot(capture) {
  const result = buildContentSnapshot(undefined, encode(capture));
  validateContentSnapshot(result);
  return result;
}
function first(capture) {
  return snapshot(capture).brightspace[0].content;
}

const tabbedHtml = `<!doctype html><html><body>
<div class="d2l-element" data-type="horizontal"><div class="tabs-wrapper tabs-horizontal">
<div class="list-group"><a class="list-group-item"><span data-itemprop="0|0">Introduction</span></a>
<a class="list-group-item"><span data-itemprop="1|0">Hidden glossary</span></a></div>
<div class="tab-content"><div class="tab-pane active show" data-itemprop="0|1"><p>Original introduction.</p></div>
<div class="tab-pane fade" data-itemprop="1|1"><p>Static hidden words &amp; literal notation.</p>
<table><tr><th>Term</th><th>Meaning</th></tr><tr><td>Scale</td><td>Original meaning</td></tr></table>
<iframe src="/d2l/common/dialogs/quickLink/quickLink.d2l?ou=187960&amp;type=lti&amp;rCode=fixture" title="Original embedded lesson"></iframe>
<img src="drawing.png?ou=1&amp;ou=2" alt=""><script>throw Error('Never execute source');</script>
</div></div></div></div></body></html>`;

test("static tabs and table evidence derives from the same verified native HTML without changing coverage or input dates", () => {
  const input = sourceFixture(tabbedHtml, "html"),
    before = structuredClone(input),
    content = first(input),
    body = content.sourceBody,
    structure = body.htmlStructure;
  assert.equal(content.textCoverage, "PARTIAL");
  assert.equal(body.observedAt, at);
  assert.equal(body.originalUrl, input.contentTree[0].url);
  assert.equal(structure.topicId, "5624765");
  assert.equal(structure.originalRef, body.originalRef);
  assert.equal(structure.sourceUrl, body.originalUrl);
  assert.equal(structure.scope, "STATIC_MARKUP_ONLY");
  assert.equal(structure.groups.length, 1);
  assert.deepEqual(
    structure.groups[0].panels.map((p) => p.label),
    ["Introduction", "Hidden glossary"],
  );
  const panel = structure.groups[0].panels[1];
  assert.match(panel.text, /Static hidden words & literal notation/);
  assert.doesNotMatch(panel.text, /Never execute source/);
  assert.equal(panel.tables[0].rows[1].cells[0].text, "Scale");
  assert.equal(
    panel.resources.find((r) => r.tag === "iframe").title,
    "Original embedded lesson",
  );
  assert.equal(panel.resources.find((r) => r.tag === "img").alt, "");
  assert.match(panel.resources.find((r) => r.tag === "img").url, /ou=1&ou=2$/);
  const exported = contentEvidenceText(content);
  for (const retained of [
    "Hidden glossary",
    "Original meaning",
    "Original embedded lesson",
  ])
    assert(exported.includes(retained));
  assert.deepEqual(input, before);
});

test("unverified, forged or non-HTML bodies cannot supply native tab structure", () => {
  const legacy = sourceFixture(tabbedHtml, "html");
  delete legacy.contentTree[0].contentEvidence.rawBodyRef;
  delete legacy.contentTree[0].contentEvidence.bodyReceipt;
  legacy.assetBodies = {};
  assert.equal(first(legacy).sourceBody.htmlStructure, undefined);
  const forged = sourceFixture(tabbedHtml, "html");
  forged.contentTree[0].contentEvidence.html += "<p>Invented panel</p>";
  assert.throws(() => first(forged), /differs from its original/);
  for (const change of [
    { status: "NON_TEXT_ASSET" },
    { projectionStatus: "UNRESOLVED" },
  ]) {
    const unbound = sourceFixture(tabbedHtml, "html");
    Object.assign(unbound.contentTree[0].contentEvidence, change, {
      html: tabbedHtml.replace("Hidden glossary", "Invented unbound label"),
    });
    assert.equal(first(unbound).sourceBody.htmlStructure, undefined);
  }
  assert.equal(
    first(sourceFixture(tabbedHtml, "text")).sourceBody.htmlStructure,
    undefined,
  );
});

test("saved static HTML views require the same topic, original hash and source URL, while old snapshots remain valid", () => {
  const value = snapshot(sourceFixture(tabbedHtml, "html"));
  for (const [field, changed] of [
    ["topicId", "different-topic"],
    ["originalRef", "f".repeat(64)],
    ["sourceUrl", "https://foreign.example.test/guide.html"],
  ]) {
    const wrong = structuredClone(value);
    wrong.brightspace[0].content.sourceBody.htmlStructure[field] = changed;
    assert.throws(() => validateContentSnapshot(wrong));
  }
  const legacy = structuredClone(value);
  delete legacy.brightspace[0].content.sourceBody.htmlStructure;
  delete legacy.brightspace[0].content.sourceBody.originalUrl;
  validateContentSnapshot(legacy);
  const unverified = structuredClone(value);
  const body = unverified.brightspace[0].content.sourceBody;
  body.originalIntegrity = "UNVERIFIED";
  body.originalRef = body.sha256 = "";
  body.bytes = null;
  assert.throws(() => validateContentSnapshot(unverified));
});

test("matching titles do not transfer static tab evidence between native topics", () => {
  const input = sourceFixture(tabbedHtml, "html");
  input.contentTree.push({
    kind: "TOPIC",
    id: "different-topic",
    title: input.contentTree[0].title,
    path: [],
    activityType: 1,
    activityTypeLabel: "File",
    url: "https://source.example.test/course/unread.html",
    description: { text: "Original separate description" },
    contentEvidence: { status: "READ_FAILED", reason: "HTTP_403" },
  });
  const value = snapshot(input);
  assert(value.brightspace[0].content.sourceBody.htmlStructure);
  assert.equal(
    value.brightspace[1].content.sourceBody.htmlStructure,
    undefined,
  );
  assert.equal(
    value.brightspace[1].content.sourceBody.originalIntegrity,
    "UNVERIFIED",
  );
});

test("literal SRT and VTT originals retain timings, markup, native identity and body observation separately from export time", () => {
  for (const format of ["srt", "vtt", "text"]) {
    const input = sourceFixture(
        format === "vtt"
          ? "WEBVTT\n\n00:01.000 --> 00:03.000\n<v Speaker>Literal &amp; <tag>.\n"
          : undefined,
        format,
      ),
      before = structuredClone(input),
      content = first(input),
      ev = input.contentTree[0].contentEvidence;
    assert.equal(content.text, ev.text);
    assert.equal(content.textCoverage, "COMPLETE");
    assert.equal(content.sourceBody.format, format);
    assert.equal(
      content.sourceBody.originalIntegrity,
      "VERIFIED_RETAINED_ORIGINAL",
    );
    assert.equal(content.sourceBody.topicId, "5624765");
    assert.equal(content.sourceBody.observedAt, at);
    assert.notEqual(content.sourceBody.observedAt, content.capturedAt);
    assert.equal(content.sourceBody.sha256, ev.rawBodyRef);
    assert.equal(content.sourceBody.bytes, Buffer.byteLength(ev.text));
    assert.equal(content.sourceBody.textScope, "ORIGINAL_BODY");
    assert.match(
      contentEvidenceText(content),
      /Source-file collection status: CAPTURED/,
    );
    assert.match(
      contentEvidenceText(content),
      /Original-body integrity: VERIFIED_RETAINED_ORIGINAL/,
    );
    assert.deepEqual(input, before);
  }
});

test("an empty original file remains observed empty rather than being replaced by its topic description", () => {
  const input = sourceFixture(""),
    content = first(input);
  assert.equal(content.text, "");
  assert.equal(content.textCoverage, "EMPTY");
  assert.equal(content.sourceBody.bytes, 0);
  assert.equal(content.sourceBody.textScope, "ORIGINAL_BODY");
  assert.match(content.textReason, /this file's empty text only/);
  assert.equal(
    content.sourceBody.descriptionText,
    input.contentTree[0].description.text,
  );
  assert.match(
    contentEvidenceText(content),
    /Native topic description \(plain-text projection\)/,
  );
});

test("native descriptions remain separate from original body text and disclose their independent display bound", () => {
  const input = sourceFixture("");
  input.contentTree[0].description.text = "a".repeat(300001);
  const content = first(input);
  assert.equal(content.text, "");
  assert.equal(content.textCoverage, "EMPTY");
  assert.equal(content.sourceBody.descriptionText.length, 300000);
  assert.equal(content.sourceBody.descriptionTruncated, true);
  assert.match(
    contentEvidenceText(content),
    /Native topic description \(plain-text projection; display truncated\)/,
  );
});

test("legacy text/status declarations without originals remain unverified or partial, with description scope explicit", () => {
  const input = sourceFixture(),
    topic = input.contentTree[0];
  input.assetBodies = {};
  topic.contentEvidence = {
    status: "CAPTURED",
    format: "srt",
    text: "Legacy text",
    textLength: 11,
    projectionTruncated: false,
  };
  let content = first(input);
  assert.equal(content.textCoverage, "PARTIAL");
  assert.equal(content.sourceBody.originalIntegrity, "UNVERIFIED");
  assert.equal(content.sourceBody.bytes, null);
  assert.equal(content.sourceBody.sha256, "");
  topic.contentEvidence.text = "";
  content = first(input);
  assert.equal(content.textCoverage, "UNVERIFIED");
  assert.equal(content.text, "");
  delete topic.contentEvidence.text;
  content = first(input);
  assert.equal(content.text, topic.description.text);
  assert.equal(content.sourceBody.textScope, "DESCRIPTION_FALLBACK");
  assert.match(content.textReason, /description does not establish/);
});

test("verified binary bodies, failed text projection and unavailable source files remain separate outcomes", () => {
  const input = sourceFixture("%PDF-1.7\nbinary", "pdf"),
    topic = input.contentTree[0],
    ev = topic.contentEvidence;
  topic.description = {};
  delete ev.text;
  delete ev.textLength;
  delete ev.textSha256;
  ev.status = "CAPTURED_ORIGINAL";
  ev.originalRef = ev.rawBodyRef;
  delete ev.rawBodyRef;
  let content = first(input);
  assert.equal(
    content.sourceBody.originalIntegrity,
    "VERIFIED_RETAINED_ORIGINAL",
  );
  assert.equal(content.textCoverage, "UNVERIFIED");
  assert.match(content.textReason, /binary file/);
  ev.projectionStatus = "UNRESOLVED";
  ev.projectionReason = "INVALID_TEXT_ENCODING";
  content = first(input);
  assert.match(content.textReason, /projection could not be established/);
  assert.equal(content.sourceBody.projectionReason, "INVALID_TEXT_ENCODING");
  input.assetBodies = {};
  topic.contentEvidence = {
    status: "UNRESOLVED",
    reason: "HTTP_404",
    bodyReceipt: { observedAt: at, status: 404 },
  };
  content = first(input);
  assert.equal(content.sourceBody.status, "UNRESOLVED");
  assert.equal(content.sourceBody.reason, "HTTP_404");
  assert.equal(content.sourceBody.originalIntegrity, "UNVERIFIED");
  assert.match(content.textReason, /does not establish an empty or broken/);
});

test("an original HTML body does not certify the collector's readable text projection or its empty field", () => {
  const input = sourceFixture("<p>Actual authored HTML</p>", "html"),
    ev = input.contentTree[0].contentEvidence;
  ev.text = "Different collector projection";
  ev.textLength = ev.text.length;
  ev.textSha256 = sha(ev.text);
  let content = first(input);
  assert.equal(
    content.sourceBody.originalIntegrity,
    "VERIFIED_RETAINED_ORIGINAL",
  );
  assert.equal(content.textCoverage, "PARTIAL");
  assert.match(content.textReason, /correspondence to rendered HTML/);
  ev.text = "";
  ev.textLength = 0;
  ev.textSha256 = sha("");
  content = first(input);
  assert.equal(content.textCoverage, "UNVERIFIED");
});

test("source references retain raw/resolved URLs, collection outcomes, media roles and authored alt without borrowing unrelated bodies", () => {
  const input = sourceFixture(
      '<p>Reading</p><img src="drawing.png" alt="Authored drawing"><iframe src="https://external.example.test/player"></iframe>',
      "html",
    ),
    topic = input.contentTree[0],
    ev = topic.contentEvidence,
    bytes = Buffer.from("retained image bytes"),
    hash = sha(bytes),
    url = "https://source.example.test/course/drawing.png";
  ev.text = "Reading\n";
  ev.textLength = ev.text.length;
  ev.textSha256 = sha(ev.text);
  ev.images = [{ url, alt: "Authored drawing" }];
  ev.references = [
    {
      url,
      rawUrl: "drawing.png",
      tag: "img",
      attribute: "src",
      alt: "Authored drawing",
      text: "",
      status: "CAPTURED_ORIGINAL",
      originalRef: hash,
    },
    {
      url: "https://external.example.test/player",
      rawUrl: "https://external.example.test/player",
      tag: "iframe",
      attribute: "src",
      status: "NOT_FETCHED",
      reason: "EXTERNAL_REFERENCE_NOT_FETCHED",
    },
  ];
  input.assetBodies[hash] = {
    encoding: "base64",
    base64: bytes.toString("base64"),
    bytes: bytes.length,
    sha256: hash,
  };
  input.contentAcquisition.assets = [
    {
      url,
      status: "CAPTURED_ORIGINAL",
      originalRef: hash,
      bytes: bytes.length,
      sha256: hash,
      sourceBindings: [{ kind: "TOPIC", id: topic.id }],
      receipt: {
        requestUrl: url,
        responseUrl: url,
        status: 200,
        observedAt: at,
        bytes: bytes.length,
        sha256: hash,
        complete: true,
      },
    },
  ];
  const content = first(input),
    refs = content.sourceBody.references;
  assert.equal(refs[0].originalRef, hash);
  assert.equal(refs[0].rawUrl, "drawing.png");
  assert.equal(refs[0].attribute, "src");
  assert.equal(refs[1].status, "NOT_FETCHED");
  assert.equal(refs[1].reason, "EXTERNAL_REFERENCE_NOT_FETCHED");
  assert.equal(refs[1].originalRef, "");
  assert.deepEqual(content.imageAltText, [
    { imageOrdinal: 1, text: "Authored drawing" },
  ]);
  assert.match(contentEvidenceText(content), /Raw reference: drawing.png/);
  assert.match(
    contentEvidenceText(content),
    /Collection outcome: EXTERNAL_REFERENCE_NOT_FETCHED/,
  );
  ev.references[0].originalRef = ev.rawBodyRef;
  assert.equal(
    first(input).sourceBody.references[0].originalRef,
    "",
    "A sibling original hash cannot substitute for the referenced file",
  );
});

test("quiz definitions require a matching native quiz type as well as tool-item ID", () => {
  const input = {
    contentTree: [
      {
        kind: "TOPIC",
        id: "assignment",
        activityType: 3,
        activityTypeLabel: "Dropbox",
        toolItemId: 23,
      },
      {
        kind: "TOPIC",
        id: "discussion",
        activityType: 5,
        activityTypeLabel: "DiscussionForum",
        toolItemId: 23,
      },
      { kind: "TOPIC", id: "unknown", toolItemId: 23 },
      {
        kind: "TOPIC",
        id: "quiz",
        activityType: 4,
        activityTypeLabel: "Quiz",
        toolItemId: 23,
      },
    ],
    quizzes: [
      {
        id: 23,
        name: "Same title",
        questions: [
          {
            QuestionId: 1,
            QuestionTypeId: 3,
            QuestionText: { Text: "Only the quiz owns this question" },
          },
        ],
        questionCount: 1,
        questionsStatus: "CAPTURED",
      },
    ],
  };
  const result = snapshot(input);
  assert.deepEqual(
    result.brightspace.map((item) => item.content.questions.length),
    [0, 0, 0, 1],
  );
});

test("saved source-body metadata is bounded, validates retained identity and leaves older snapshots compatible", () => {
  const result = snapshot(sourceFixture()),
    content = result.brightspace[0].content;
  for (const mutate of [
    (c) => (c.sourceBody.topicId = "a".repeat(161)),
    (c) => (c.sourceBody.originalRef = "b".repeat(64)),
    (c) => (c.sourceBody.bytes = -1),
    (c) => (c.sourceBody.observedAt = "invalid date"),
    (c) => (c.sourceBody.references = new Array(2001).fill({})),
    (c) => (c.sourceBody.originalIntegrity = "UNVERIFIED"),
    (c) => (c.sourceBody.topicId = "different-topic"),
    (c) => (c.sourceBody.descriptionText = "a".repeat(300001)),
    (c) => (c.sourceBody.descriptionTruncated = "false"),
  ]) {
    const altered = structuredClone(result);
    mutate(altered.brightspace[0].content);
    assert.throws(() => validateContentSnapshot(altered), /Brightspace/);
  }
  const wrongPlatform = structuredClone(result);
  wrongPlatform.coursera = wrongPlatform.brightspace;
  wrongPlatform.brightspace = [];
  assert.throws(
    () => validateContentSnapshot(wrongPlatform),
    /different native item or platform/,
  );
  delete content.sourceBody;
  validateContentSnapshot(result);
  assert.equal(
    capturedContent({}, { basis: "Older snapshot" }).sourceBody,
    undefined,
  );
});
