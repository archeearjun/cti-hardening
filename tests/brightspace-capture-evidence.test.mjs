import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertBrightspaceCaptureIntegrity,
  inspectBrightspaceCaptureEvidence,
} from "../src/domain/brightspace-capture-evidence.ts";
import {
  reviewCapture,
  readCaptureReviewFile,
} from "../src/domain/capture-review.ts";
import {
  qaBrightspaceQuizQuestion_,
  qaBrightspaceQuizToAssessment_,
} from "../src/engine/source/brightspace-assessment.js";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const at = "2026-10-16T12:00:00.000Z";
function fixture(
  bodyText = '1\r\n00:00:01,000 --> 00:00:03,000\r\nLiteral <tag> & "caption".\r\n',
) {
  const bytes = Buffer.from(bodyText),
    hash = sha(bytes),
    url = "https://source.example.test/caption.srt?original=1";
  const receipt = {
    requestUrl: url,
    responseUrl: url,
    status: 200,
    observedAt: at,
    bytes: bytes.length,
    sha256: hash,
    complete: true,
  };
  return {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.1.0",
    page: { url: "https://source.example.test/d2l/home/123" },
    contentTree: [
      {
        kind: "MODULE",
        id: "m1",
        title: "Module",
        path: ["Module"],
        structureEvidence: { status: "CAPTURED", complete: true },
        children: [
          {
            kind: "TOPIC",
            id: "t1",
            title: "Literal caption",
            url,
            path: ["Module", "Literal caption"],
            contentEvidence: {
              status: "CAPTURED",
              url,
              rawBodyRef: hash,
              bodyReceipt: receipt,
              contentType: "text/srt; charset=utf-8",
              format: "srt",
              charset: "utf-8",
              html: "",
              text: bodyText,
              textLength: bodyText.length,
              textSha256: sha(Buffer.from(bodyText)),
              projectionTruncated: false,
            },
          },
        ],
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
    contentAcquisition: {
      version: 1,
      wholeCourseComplete: false,
      assets: [
        {
          url,
          status: "CAPTURED_ORIGINAL",
          originalRef: hash,
          bytes: bytes.length,
          sha256: hash,
          mediaType: "text/srt",
          receipt,
          sourceBindings: [
            { kind: "TOPIC", id: "t1", path: ["Module", "Literal caption"] },
          ],
        },
      ],
      gaps: [],
    },
    inventoryEvidence: {
      content: { complete: true },
      quizzes: { complete: true },
      assignments: { complete: true },
      discussionForums: { complete: true },
    },
  };
}

test("actual original bytes, literal SRT text, references and receipts are verified without promoting whole-course completeness", () => {
  const capture = fixture(),
    original = JSON.stringify(capture);
  const declared = inspectBrightspaceCaptureEvidence(capture);
  assert.equal(declared.originalIntegrity, "NOT_CHECKED");
  const verified = assertBrightspaceCaptureIntegrity(capture);
  assert.equal(verified.originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
  assert.equal(verified.counts.retainedOriginals, 1);
  assert.equal(
    verified.counts.retainedOriginalBytes,
    Buffer.byteLength(capture.contentTree[0].children[0].contentEvidence.text),
  );
  assert.equal(verified.wholeCourseComplete, false);
  assert.equal(verified.completeness, "GAPS_OR_UNVERIFIED");
  assert.equal(JSON.stringify(capture), original);
  assert.ok(
    verified.warnings.some((warning) => /not server attestation/.test(warning)),
  );
});

test("independent redirect policy accepts only the exact same-origin native temporary image view", () => {
  const requestUrl = "https://source.example.test/content/drawing.png",
    imagePath =
      "/d2l/lp/files/temp/synthetic-private-token.png;drawing-1.png/View",
    responseUrl = "https://source.example.test" + imagePath,
    bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
    hash = sha(bytes);
  const capture = {
    page: { url: "https://source.example.test/d2l/home/123" },
    contentTree: [
      {
        kind: "TOPIC",
        id: "image-topic",
        title: "Drawing",
        url: requestUrl,
        contentEvidence: {
          status: "CAPTURED_ORIGINAL",
          originalRef: hash,
          bodyReceipt: {
            requestUrl,
            responseUrl,
            status: 200,
            observedAt: at,
            bytes: bytes.length,
            sha256: hash,
            complete: true,
            contentType: "image/png",
            redirectPolicy: "SAME_ORIGIN_STATIC_CONTENT",
            mode: "same-origin",
            sourceResponseRedirected: true,
          },
        },
      },
    ],
    assetBodies: {
      [hash]: {
        encoding: "base64",
        base64: bytes.toString("base64"),
        bytes: bytes.length,
        sha256: hash,
      },
    },
  };
  assert.equal(
    assertBrightspaceCaptureIntegrity(capture).originalIntegrity,
    "VERIFIED_RETAINED_ORIGINALS",
  );
  for (const target of [
    "https://other.example.test" + imagePath,
    responseUrl + "?type=lti",
    responseUrl + "/extra.png",
    responseUrl.replace(";", "%3B"),
    responseUrl.replace("/temp/", "/temp%2F"),
    responseUrl.replace("drawing-1.png", "drawing-1.jpg"),
    responseUrl.replace("/d2l/lp/", "/d2l/api/"),
    responseUrl.replace("/d2l/lp/", "/login/"),
  ]) {
    const altered = structuredClone(capture);
    altered.contentTree[0].contentEvidence.bodyReceipt.responseUrl = target;
    assert.throws(
      () => assertBrightspaceCaptureIntegrity(altered),
      /Brightspace.*(?:receipt|redirect)/,
      target,
    );
  }
});

test("tampered, partial, unbound or contradictory originals fail at file intake rather than become source evidence", async () => {
  for (const alter of [
    (capture) =>
      (Object.values(capture.assetBodies)[0].base64 =
        Buffer.from("invented").toString("base64")),
    (capture) => Object.values(capture.assetBodies)[0].bytes++,
    (capture) =>
      (capture.contentTree[0].children[0].contentEvidence.bodyReceipt.complete = false),
    (capture) =>
      (capture.contentTree[0].children[0].contentEvidence.bodyReceipt.status = 206),
    (capture) =>
      (capture.contentTree[0].children[0].contentEvidence.text += "invented"),
    (capture) =>
      (capture.contentTree[0].children[0].contentEvidence.rawBodyRef =
        "b".repeat(64)),
    (capture) =>
      (capture.contentAcquisition.assets[0].sourceBindings[0].id =
        "another-native-item"),
    (capture) => {
      capture.contentTree[0].children[0].contentEvidence.url += "&different=1";
    },
    (capture) => {
      capture.contentAcquisition.assets = [];
      capture.contentTree[0].children[0].contentEvidence = {};
    },
  ]) {
    const capture = fixture();
    alter(capture);
    assert.throws(
      () => assertBrightspaceCaptureIntegrity(capture),
      /Brightspace/,
    );
    const file = new File([JSON.stringify(capture)], "source.json");
    await assert.rejects(readCaptureReviewFile(file), /Brightspace/);
  }
  const capture = fixture(),
    ev = capture.contentTree[0].children[0].contentEvidence;
  ev.text = "An invented projection with a matching projection hash";
  ev.textLength = ev.text.length;
  ev.textSha256 = sha(Buffer.from(ev.text));
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(capture),
    /differs from its original/,
  );
});

test("shared exact body references are deduplicated while native placements and query strings remain distinct", () => {
  const capture = fixture(),
    topic = structuredClone(capture.contentTree[0].children[0]);
  topic.id = "t2";
  topic.title = "A separate native placement";
  topic.url += "#later";
  topic.contentEvidence.url += "#later";
  capture.contentTree[0].children.push(topic);
  capture.contentAcquisition.assets[0].sourceBindings.push({
    kind: "TOPIC",
    id: "t2",
  });
  const report = assertBrightspaceCaptureIntegrity(capture);
  assert.equal(report.counts.topics, 2);
  assert.equal(report.counts.retainedOriginals, 1);
  assert.equal(capture.contentTree[0].children[1].url.endsWith("#later"), true);
});

test("request origins, native topic URLs and referenced asset bindings cannot be swapped between items", () => {
  for (const alter of [
    (capture) => {
      const asset = capture.contentAcquisition.assets[0];
      asset.receipt.requestUrl =
        asset.receipt.responseUrl =
        asset.url =
          "https://other.example.test/caption.srt";
    },
    (capture) => {
      const ev = capture.contentTree[0].children[0].contentEvidence;
      ev.url =
        ev.bodyReceipt.requestUrl =
        ev.bodyReceipt.responseUrl =
          "https://source.example.test/another.srt";
    },
    (capture) => {
      capture.contentAcquisition.assets[0].receipt.responseUrl +=
        "&redirected=1";
    },
    (capture) => {
      const asset = capture.contentAcquisition.assets[0];
      asset.receipt.requestUrl =
        asset.receipt.responseUrl =
        asset.url =
          "https://source.example.test/unreferenced.srt";
    },
  ]) {
    const capture = fixture();
    alter(capture);
    assert.throws(
      () => assertBrightspaceCaptureIntegrity(capture),
      /Brightspace/,
    );
  }
});

function declaredRedirect(capture, request, response) {
  const topic = capture.contentTree[0].children[0],
    asset = capture.contentAcquisition.assets[0];
  topic.url = topic.contentEvidence.url = asset.url = request;
  topic.contentEvidence.documentUrl = response;
  for (const receipt of [topic.contentEvidence.bodyReceipt, asset.receipt])
    Object.assign(receipt, {
      requestUrl: request,
      responseUrl: response,
      redirectPolicy: "SAME_ORIGIN_STATIC_CONTENT",
      mode: "same-origin",
      sourceResponseRedirected: request !== response,
    });
  return capture;
}

test("same-origin static and native course-file redirects retain requested ownership and final response provenance", () => {
  for (const request of [
    "https://source.example.test/caption.srt?original=1",
    "https://source.example.test/d2l/common/dialogs/quickLink.d2l?type=coursefile&fileId=caption.srt",
  ]) {
    const capture = declaredRedirect(
      fixture(),
      request,
      "https://source.example.test/content/123/files/caption.srt",
    );
    const report = assertBrightspaceCaptureIntegrity(capture);
    assert.equal(report.originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
    assert.equal(capture.contentTree[0].children[0].url, request);
    assert.equal(
      capture.contentAcquisition.assets[0].receipt.responseUrl,
      "https://source.example.test/content/123/files/caption.srt",
    );
  }
  const direct =
    "https://source.example.test/d2l/common/dialogs/quickLink.d2l?type=coursefile&fileId=caption.srt";
  assert.doesNotThrow(() =>
    assertBrightspaceCaptureIntegrity(
      declaredRedirect(fixture(), direct, direct),
    ),
  );
});

test("redirect declarations cannot authorize external, authentication, API, LTI or unrelated dynamic endpoints", () => {
  for (const response of [
    "https://external.example.test/caption.srt",
    "https://source.example.test/login.html",
    "https://source.example.test/%6cogin.html",
    "https://source.example.test/d2l/api/le/1.88/123/files/body.pdf",
    "https://source.example.test/d2l/le/content/123/viewContent/4/View",
    "https://source.example.test/d2l/common/dialogs/quickLink.d2l?type=lti",
    "https://source.example.test/d2l/common/dialogs/quickLink.d2l?type=coursefile&fileId=another.pdf",
  ])
    assert.throws(
      () =>
        assertBrightspaceCaptureIntegrity(
          declaredRedirect(
            fixture(),
            "https://source.example.test/caption.srt",
            response,
          ),
        ),
      /receipt|redirect/,
    );
  const capture = declaredRedirect(
    fixture(),
    "https://source.example.test/d2l/lms/quizzing/admin/quizzes_manage.d2l",
    "https://source.example.test/caption.srt",
  );
  assert.throws(() => assertBrightspaceCaptureIntegrity(capture), /redirect/);
  const noMode = declaredRedirect(
    fixture(),
    "https://source.example.test/caption.srt",
    "https://source.example.test/files/caption.srt",
  );
  delete noMode.contentTree[0].children[0].contentEvidence.bodyReceipt.mode;
  assert.throws(() => assertBrightspaceCaptureIntegrity(noMode), /redirect/);
});

test("relative media in redirected HTML resolves against the final URL and its literal authored base", () => {
  const html = '<base href="../shared/"><p>Literal</p><img src="image.png">';
  const capture = declaredRedirect(
    fixture(html),
    "https://source.example.test/old/page.html",
    "https://source.example.test/material/page.html",
  );
  const ev = capture.contentTree[0].children[0].contentEvidence;
  Object.assign(ev, {
    format: "html",
    html,
    text: "Literal\n",
    textLength: 8,
    textSha256: sha(Buffer.from("Literal\n")),
  });
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    hash = sha(bytes),
    url = "https://source.example.test/shared/image.png";
  capture.assetBodies[hash] = {
    encoding: "base64",
    base64: bytes.toString("base64"),
    bytes: bytes.length,
    sha256: hash,
  };
  capture.contentAcquisition.assets.push({
    url,
    status: "CAPTURED_ORIGINAL",
    originalRef: hash,
    bytes: bytes.length,
    sha256: hash,
    receipt: {
      requestUrl: url,
      responseUrl: url,
      status: 200,
      observedAt: at,
      bytes: bytes.length,
      sha256: hash,
      complete: true,
    },
    sourceBindings: [{ kind: "TOPIC", id: "t1" }],
  });
  const report = assertBrightspaceCaptureIntegrity(capture);
  assert.equal(report.counts.retainedOriginals, 2);
  assert.equal(
    report.findings.some(
      (finding) => finding.code === "REFERENCED_MEDIA_NOT_RETAINED",
    ),
    false,
  );
});

test("discussion topic media uses its exact parent forum and tolerates native forum/topic ID namespace collisions", () => {
  const capture = fixture(),
    asset = capture.contentAcquisition.assets[0],
    ref = asset.originalRef;
  capture.contentTree = [];
  capture.discussions = [
    {
      id: "same-id",
      description: {},
      topics: [
        {
          TopicId: "same-id",
          Description: {
            Html: `<img src="${asset.url.replaceAll("&", "&amp;")}">`,
          },
        },
      ],
    },
  ];
  asset.sourceBindings = [
    { kind: "DISCUSSION_TOPIC", id: "same-id", parentId: "same-id" },
  ];
  assert.equal(
    assertBrightspaceCaptureIntegrity(capture).counts.retainedOriginals,
    1,
  );
  asset.sourceBindings[0].parentId = "wrong-parent";
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(capture),
    /absent or ambiguous/,
  );
  asset.sourceBindings = [{ kind: "DISCUSSION", id: "same-id" }];
  assert.throws(() => assertBrightspaceCaptureIntegrity(capture), /ambiguous/);
  assert.ok(capture.assetBodies[ref]);
});

test("explicit reused module references keep traversal gaps without orphaning the original module's bytes", () => {
  const capture = fixture(),
    module = capture.contentTree[0],
    asset = capture.contentAcquisition.assets[0];
  module.description = { html: `<a href="${asset.url}">Original caption</a>` };
  asset.sourceBindings = [{ kind: "MODULE", id: module.id }];
  capture.contentTree.push({
    ...structuredClone(module),
    children: [],
    structureEvidence: { status: "REUSED_REFERENCE", complete: false },
  });
  const report = assertBrightspaceCaptureIntegrity(capture);
  assert.equal(report.originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "MODULE_STRUCTURE_UNVERIFIED",
    ),
  );
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "CONTENT_NATIVE_IDENTITY_UNVERIFIED",
    ),
  );
});

test("module rich descriptions independently bind CSS, srcset and document-base media references", () => {
  for (const html of [
    "<div style=\"background-image: url('caption.srt?original=1')\"></div>",
    '<img srcset="unused.png 1x, caption.srt?original=1 2x">',
    '<base href="https://source.example.test/"><img src="caption.srt?original=1">',
  ]) {
    const capture = fixture(),
      asset = capture.contentAcquisition.assets[0];
    capture.contentTree[0].description = { html };
    capture.page.url = "https://source.example.test/d2l/home/123";
    // Non-base descriptions are interpreted relative to the page, as the
    // collector does. Use an absolute path to preserve that native reference.
    if (!html.includes("<base"))
      capture.contentTree[0].description.html = html.replaceAll(
        "caption.srt",
        "/caption.srt",
      );
    asset.sourceBindings = [{ kind: "MODULE", id: "m1" }];
    assert.equal(
      assertBrightspaceCaptureIntegrity(capture).originalIntegrity,
      "VERIFIED_RETAINED_ORIGINALS",
    );
  }
});

test("raw HTML byte retention does not certify the collector's DOM projection or missing media", () => {
  const html =
    '\ufeff<p>Literal &amp; exact</p><img src="drawing.png"><iframe src="https://external.example.test/widget"></iframe>';
  const capture = fixture(html),
    ev = capture.contentTree[0].children[0].contentEvidence;
  ev.format = "html";
  ev.html = html;
  ev.text = "Literal & exact\n";
  ev.textLength = ev.text.length;
  ev.textSha256 = sha(Buffer.from(ev.text));
  const report = assertBrightspaceCaptureIntegrity(capture);
  assert.equal(report.originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "REFERENCED_MEDIA_NOT_RETAINED",
    ),
  );
  assert.ok(
    report.warnings.some((warning) => /collector projections/.test(warning)),
  );
  ev.html += "invented";
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(capture),
    /differs from its original/,
  );
});

test("original bytes can survive a failed text projection and legacy source captures remain accepted with evidence gaps", () => {
  const capture = fixture(),
    ev = capture.contentTree[0].children[0].contentEvidence;
  ev.status = "CAPTURED_ORIGINAL";
  ev.projectionStatus = "UNRESOLVED";
  delete ev.text;
  delete ev.textSha256;
  delete ev.textLength;
  const report = assertBrightspaceCaptureIntegrity(capture);
  assert.equal(report.originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "TOPIC_TEXT_PROJECTION_UNVERIFIED",
    ),
  );
  const legacy = {
    schemaVersion: 1,
    contentTree: [
      {
        kind: "MODULE",
        id: "m",
        children: [
          {
            kind: "TOPIC",
            id: "t",
            contentEvidence: { status: "CAPTURED", text: "x".repeat(80000) },
          },
          {
            kind: "TOPIC",
            id: "b",
            contentEvidence: {
              status: "NON_TEXT_ASSET",
              contentType: "image/png",
            },
          },
        ],
      },
    ],
    quizzes: [],
  };
  const checked = assertBrightspaceCaptureIntegrity(legacy);
  assert.equal(checked.originalIntegrity, "NO_ORIGINAL_BODIES");
  for (const code of [
    "LEGACY_PAGE_TEXT_MAY_BE_CLIPPED",
    "NON_TEXT_ASSET_BODY_NOT_RETAINED",
    "MODULE_STRUCTURE_UNVERIFIED",
    "LEGACY_SOURCE_INVENTORY_UNVERIFIED",
  ])
    assert.ok(
      checked.findings.some((finding) => finding.code === code),
      code,
    );
  assert.doesNotThrow(() =>
    assertBrightspaceCaptureIntegrity({ contentTree: [], quizzes: [] }),
  );
});

test("native question IDs cannot be replaced by anonymous ordinals or silently deduplicated", () => {
  const question = {
    QuestionTypeId: 1,
    QuestionText: { Text: "Literal question" },
    QuestionInfo: {
      Answers: [
        { Answer: { Text: "A" }, Weight: 100 },
        { Answer: { Text: "B" }, Weight: 0 },
      ],
    },
  };
  const projected = qaBrightspaceQuizQuestion_(question, 0);
  assert.equal(projected.id, "cti-brightspace-question-projection:1");
  assert.equal(projected.nativeQuestionId, null);
  assert.equal(projected.syntheticProjectionIdentity, true);
  assert.equal(projected.prompt, "Literal question");
  for (const questions of [
    [question],
    [
      { ...question, QuestionId: 1 },
      { ...question, QuestionId: 1 },
    ],
    [{ ...question, QuestionId: 1, questionId: 2 }],
  ]) {
    const quiz = {
      id: "quiz",
      declaredQuestionCount: questions.length,
      questions,
      questionsStatus: "CAPTURED",
      questionCoverage: { completenessVerified: true },
      questionPageEvidence: { complete: true },
    };
    const before = JSON.stringify(quiz),
      assessment = qaBrightspaceQuizToAssessment_(quiz);
    assert.equal(assessment.definitionCoverage.completenessVerified, false);
    assert.equal(assessment.definitionCoverage.nativeIdentityComplete, false);
    assert.equal(assessment.questions.length, questions.length);
    assert.equal(JSON.stringify(quiz), before);
    const report = inspectBrightspaceCaptureEvidence({
      schemaVersion: 2,
      contentTree: [],
      quizzes: [quiz],
    });
    assert.ok(
      report.findings.some(
        (finding) =>
          finding.code === "QUIZ_NATIVE_QUESTION_IDENTITY_UNVERIFIED",
      ),
    );
  }
  const normalized = qaBrightspaceQuizToAssessment_({
    id: "quiz",
    questions: [question],
  });
  assert.equal(
    normalized.questions[0].sourceTypeEvidence.syntheticProjectionIdentity,
    true,
  );
});

test("capture review reports independent gaps and keeps legacy zero-question counts uncertain", () => {
  const result = reviewCapture(
    {
      extractor: "CTI Brightspace v1.0.8",
      schemaVersion: 2,
      contentTree: [],
      quizzes: [
        {
          id: "q",
          questions: [],
          questionCoverage: { completenessVerified: false },
        },
      ],
    },
    "source.json",
    { partner: "", mode: "OPS_CURRENT" },
  );
  assert.equal(result.findings[0].code, "QUIZ_DEFINITION_COVERAGE_UNVERIFIED");
  assert.equal(result.counts.questionDefinitions, 0);
  assert.equal(result.counts.assets, null);
  assert.ok(
    result.warnings.some((warning) =>
      /Whole-course completeness remains unverified/.test(warning),
    ),
  );
});
