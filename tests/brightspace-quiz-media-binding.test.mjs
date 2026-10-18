import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertBrightspaceCaptureIntegrity,
  attachBrightspaceArchiveFileBlobs,
  getBrightspaceOriginalBody,
} from "../src/domain/brightspace-capture-evidence.ts";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const url =
  "https://source.example.test/content/enforced/123/diagram.png?a=1&b=2";
const html = '<img src="/content/enforced/123/diagram.png?a=1&amp;b=2">';

function fixture(archive = true) {
  const hash = sha(png);
  return {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.2.0",
    page: { url: "https://source.example.test/d2l/home/123" },
    ...(archive
      ? {
          originalBodyTransport: {
            format: "CTI_BRIGHTSPACE_ARCHIVE_V1",
            version: 1,
            bodyEncoding: "archive",
            hashAlgorithm: "SHA-256",
          },
        }
      : {}),
    contentTree: [],
    quizzes: [
      {
        id: "quiz-a",
        name: "Native quiz",
        questionsStatus: "CAPTURED",
        questions: [
          {
            QuestionId: 901,
            QuestionTypeId: 2,
            QuestionText: { Text: "Use the authored diagram.", Html: html },
          },
        ],
      },
      {
        id: "quiz-b",
        name: "Another native quiz",
        questions: [{ QuestionId: 902, QuestionText: { Text: "No diagram." } }],
      },
    ],
    assignments: [],
    discussions: [],
    assetBodies: {
      [hash]: {
        encoding: archive ? "archive" : "base64",
        ...(archive
          ? { archivePath: "files/" + hash }
          : { base64: png.toString("base64") }),
        bytes: png.length,
        sha256: hash,
      },
    },
    contentAcquisition: {
      assets: [
        {
          url,
          originalRef: hash,
          status: "CAPTURED_ORIGINAL",
          bytes: png.length,
          sha256: hash,
          mediaType: "image/png",
          receipt: {
            requestUrl: url,
            responseUrl: url,
            status: 200,
            observedAt: "2026-10-18T00:00:00.000Z",
            complete: true,
            bytes: png.length,
            sha256: hash,
            contentType: "image/png",
          },
          sourceBindings: [{ kind: "QUIZ", id: "quiz-a" }],
        },
      ],
      gaps: [],
    },
  };
}

const files = (bytes = png) => [
  {
    path: "files/" + sha(png),
    sha256: sha(png),
    size: png.length,
    blob: new Blob([bytes]),
  },
];

test("native quiz question HTML binds its exact original media without promoting bank completeness", async () => {
  for (const archive of [false, true]) {
    const capture = fixture(archive),
      before = JSON.stringify(capture);
    if (archive) await attachBrightspaceArchiveFileBlobs(capture, files());
    const report = assertBrightspaceCaptureIntegrity(capture);
    assert.equal(report.originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
    assert.equal(report.counts.retainedOriginals, 1);
    assert.equal(report.counts.questionDefinitions, 2);
    assert.equal(report.wholeCourseComplete, false);
    assert.equal(report.completeness, "GAPS_OR_UNVERIFIED");
    assert.equal(JSON.stringify(capture), before);
    if (archive)
      assert.equal(
        getBrightspaceOriginalBody(capture, sha(png)).size,
        png.length,
      );
  }
});

test("known native hints, feedback and answer rich text retain their question-owned media", async () => {
  for (const field of ["Hint", "Feedback", "QuestionInfo"]) {
    const capture = fixture(),
      question = capture.quizzes[0].questions[0];
    question.QuestionText = { Text: "No image in the prompt." };
    question[field] =
      field === "QuestionInfo"
        ? { Answers: [{ Answer: { Html: html } }] }
        : { Html: html };
    await attachBrightspaceArchiveFileBlobs(capture, files());
    assert.equal(
      assertBrightspaceCaptureIntegrity(capture).counts.retainedOriginals,
      1,
    );
  }
});

test("question media cannot be rebound to another quiz or an unreferenced source URL", async () => {
  for (const alter of [
    (capture) =>
      (capture.contentAcquisition.assets[0].sourceBindings[0].id = "quiz-b"),
    (capture) => {
      const asset = capture.contentAcquisition.assets[0];
      asset.url =
        asset.receipt.requestUrl =
        asset.receipt.responseUrl =
          "https://source.example.test/content/enforced/123/unreferenced.png";
    },
    (capture) => {
      const question = capture.quizzes[0].questions[0];
      question.annotations = question.QuestionText;
      question.QuestionText = { Text: "No image." };
    },
    (capture) => {
      const quiz = capture.quizzes[0];
      quiz.raw = { questions: quiz.questions };
      quiz.questions = [];
    },
    (capture) => {
      capture.contentTree = [
        {
          kind: "TOPIC",
          id: "topic-a",
          questions: capture.quizzes[0].questions,
        },
      ];
      capture.contentAcquisition.assets[0].sourceBindings = [
        { kind: "TOPIC", id: "topic-a" },
      ];
    },
  ]) {
    const capture = fixture();
    alter(capture);
    await assert.rejects(
      attachBrightspaceArchiveFileBlobs(capture, files()),
      /not referenced by its declared native source/,
    );
  }
});

test("question binding keeps same-origin receipts and exact original byte hashes mandatory", async () => {
  const tampered = Buffer.from(png);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(
    attachBrightspaceArchiveFileBlobs(fixture(), files(tampered)),
    /SHA-256 or byte length does not match/,
  );
  const capture = fixture(),
    asset = capture.contentAcquisition.assets[0];
  asset.url =
    asset.receipt.requestUrl =
    asset.receipt.responseUrl =
      "https://other.example.test/content/enforced/123/diagram.png";
  capture.quizzes[0].questions[0].QuestionText.Html = `<img src="${asset.url}">`;
  await assert.rejects(
    attachBrightspaceArchiveFileBlobs(capture, files()),
    /invalid original-body receipt/,
  );
});

test("native question media traversal keeps the collector's bounded question inventory", async () => {
  const capture = fixture();
  capture.quizzes[0].questions = Array.from({ length: 5001 }, (_, index) => ({
    QuestionId: index + 1,
    QuestionText: { Html: html },
  }));
  await assert.rejects(
    attachBrightspaceArchiveFileBlobs(capture, files()),
    /5,000-question bound/,
  );
});

test("a native question's allowed rich-text descendants retain a finite traversal bound", async () => {
  const capture = fixture();
  capture.quizzes[0].questions[0].QuestionInfo = {
    Answers: Array.from({ length: 50001 }, () => ({ Text: "No media." })),
  };
  await assert.rejects(
    attachBrightspaceArchiveFileBlobs(capture, files()),
    /50,000-field bound/,
  );
});
