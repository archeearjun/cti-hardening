import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  deriveBrightspaceCsvBank,
  validateBrightspaceCsvBank,
} from "../src/domain/brightspace-csv-bank.ts";
import {
  buildContentSnapshot,
  validateContentSnapshot,
} from "../src/domain/content-evidence.ts";
import { prepareOwnerReportExport } from "../src/domain/owner-report-export.ts";
import { newRecord } from "../src/domain/workspace-store.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const url = "https://source.example.test/course/Module%204%20Questions.csv";
const prompt = 'What does "HSS", <tag> &amp; literal text mean?';
const correct = 'Hollow "Structural", <section> &amp; unchanged';
function block(question = prompt, answer = correct) {
  return [
    "NewQuestion,MC,",
    `QuestionText,"${question}",`,
    'Option,0,"A literal <div>, not rendered",',
    `Option,100,"${answer}",`,
    'Option,0,"Keep &lt; and \\n as text",',
    'Option,0,"Another "quoted" answer"',
    "",
  ].join("\n");
}
const literalBank =
  "\ufeff" +
  [block(), block("A separate question?", "Separate answer")]
    .join("\n")
    .replaceAll("\n", "\r\n");
function context(rawText = literalBank) {
  return {
    topicId: "5624715",
    url,
    originalRef: sha(rawText),
    bytes: Buffer.byteLength(rawText),
  };
}
function derive(rawText = literalBank) {
  const source = context(rawText);
  const result = deriveBrightspaceCsvBank(rawText, source);
  assert.ok(result, "The supported source-file bank must be recognized");
  validateBrightspaceCsvBank(result.bank, source, result.questions);
  return result;
}
function captureFixture(rawText = literalBank) {
  const source = context(rawText),
    bytes = Buffer.from(rawText),
    receipt = {
      requestUrl: url,
      responseUrl: url,
      status: 200,
      observedAt: "2026-10-17T08:00:00.000Z",
      bytes: bytes.length,
      sha256: source.originalRef,
      complete: true,
      contentType: "application/octet-stream",
    };
  return {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.1.0",
    capturedAt: "2026-10-17T09:00:00.000Z",
    page: { url: "https://source.example.test/d2l/home/187960" },
    summary: { quizzes: 1, quizQuestions: 1 },
    contentTree: [
      {
        kind: "TOPIC",
        id: source.topicId,
        title: "Module 4 Quiz Questions",
        path: ["Instructor Resources", "Question Banks - Raw Dumps"],
        activityType: 1,
        activityTypeLabel: "File",
        url,
        contentEvidence: {
          status: "CAPTURED",
          url,
          rawBodyRef: source.originalRef,
          bodyReceipt: receipt,
          format: "text",
          contentType: receipt.contentType,
          charset: "utf-8",
          html: "",
          text: rawText,
          textLength: rawText.length,
          textSha256: source.originalRef,
          projectionTruncated: false,
          references: [],
          links: [],
          images: [],
          embeds: [],
        },
      },
      {
        kind: "TOPIC",
        id: "quiz-topic",
        title: "Module 4 Assessment",
        path: ["Module 4"],
        activityType: 4,
        activityTypeLabel: "Quiz",
        toolItemId: 324442,
      },
    ],
    quizzes: [
      {
        id: 324442,
        name: "Module 4 Assessment",
        questionsStatus: "CAPTURED",
        questionCount: 1,
        questions: [
          {
            QuestionId: 32734945,
            QuestionTypeId: 1,
            QuestionText: { Text: "An independently captured native question" },
            QuestionInfo: {
              Answers: [
                { PartId: 1, Answer: { Text: "Native answer" }, Weight: 100 },
              ],
            },
          },
        ],
      },
    ],
    assignments: [],
    discussions: [],
    assetBodies: {
      [source.originalRef]: {
        encoding: "base64",
        base64: bytes.toString("base64"),
        bytes: bytes.length,
        sha256: source.originalRef,
      },
    },
    contentAcquisition: { assets: [], gaps: [] },
  };
}
function snapshot(capture) {
  const value = buildContentSnapshot(
    undefined,
    new TextEncoder().encode(JSON.stringify(capture)),
  );
  validateContentSnapshot(value);
  return value;
}

test("supported file grammar preserves literal interior quotes, HTML, commas, BOM and CRLF with source-file identities", () => {
  const source = context(),
    before = structuredClone(source),
    { bank, questions } = deriveBrightspaceCsvBank(literalBank, source);
  validateBrightspaceCsvBank(bank, source, questions);
  assert.equal(bank.schemaVersion, 1);
  assert.equal(bank.format, "BRIGHTSPACE_NEWQUESTION_MC_LINES_V1");
  assert.equal(bank.scope, "SOURCE_FILE_BANK");
  assert.equal(bank.nativeQuizMembership, "UNVERIFIED");
  assert.equal(bank.status, "COMPLETE");
  assert.equal(bank.encounteredQuestions, 2);
  assert.deepEqual(bank.gaps, []);
  assert.deepEqual(bank.source, { ...source, rawText: literalBank });
  assert.equal(questions[0].prompt, prompt);
  assert.deepEqual(
    questions[0].options.map((option) => option.text),
    [
      "A literal <div>, not rendered",
      correct,
      "Keep &lt; and \\n as text",
      'Another "quoted" answer',
    ],
  );
  assert.deepEqual(questions[0].answers, [correct]);
  assert.equal(questions[0].answerKeyReliable, true);
  assert.equal(questions[0].answerCoverage, "CAPTURED");
  assert.deepEqual(
    questions.map(({ sourceFile }) => ({
      topicId: sourceFile.topicId,
      url: sourceFile.url,
      originalRef: sourceFile.originalRef,
      ordinal: sourceFile.ordinal,
      identityBasis: sourceFile.identityBasis,
    })),
    [1, 2].map((ordinal) => ({
      topicId: source.topicId,
      url,
      originalRef: source.originalRef,
      ordinal,
      identityBasis: "SOURCE_FILE_ORDINAL",
    })),
  );
  assert.equal(new Set(questions.map((question) => question.id)).size, 2);
  assert.deepEqual(derive().questions, questions);
  assert.deepEqual(source, before);
});

test("unsupported, ambiguous and multiline blocks remain gaps while later source ordinals stay stable", () => {
  const malformed = [
    block("Unsupported row").replace(
      'Option,0,"Another "quoted" answer"',
      'Feedback,"An unsupported record",',
    ),
    block('Ambiguous "," separate field'),
    block('Ambiguous ",foo," extra field'),
    block('Ambiguous " ,foo," extra field'),
    block('Unpaired " interior quote'),
    block('Ambiguous ""escaped"" quote dialect'),
    block("A physical\nmultiline question"),
    block("Only three options").replace(
      'Option,0,"Another "quoted" answer"\n',
      "",
    ),
    block("Two weighted answers").replace(
      'Option,0,"A literal <div>, not rendered",',
      'Option,100,"A literal <div>, not rendered",',
    ),
  ];
  for (const invalid of malformed) {
    const rawText = [
        block("First supported question", "First key"),
        invalid,
        block("Last supported question", "Last key"),
      ].join("\n"),
      { bank, questions } = derive(rawText);
    assert.equal(bank.status, "PARTIAL");
    assert.equal(bank.encounteredQuestions, 3);
    assert.deepEqual(
      questions.map((question) => question.prompt),
      ["First supported question", "Last supported question"],
    );
    assert.deepEqual(
      questions.map((question) => question.sourceFile.ordinal),
      [1, 3],
    );
    assert.ok(bank.gaps.length > 0);
    assert.ok(bank.gaps.some((gap) => gap.ordinal === 2));
    for (const gap of bank.gaps) {
      assert.ok(Number.isSafeInteger(gap.line) && gap.line > 0);
      assert.ok(typeof gap.reason === "string" && gap.reason.length > 0);
    }
  }
});

test("an entirely unsupported bank never fabricates a question or complete coverage", () => {
  const { bank, questions } = derive(block('Ambiguous "," field boundary'));
  assert.equal(bank.status, "UNVERIFIED");
  assert.equal(bank.encounteredQuestions, 1);
  assert.deepEqual(questions, []);
  assert.ok(bank.gaps.length > 0);
  const prose = "Ordinary prose without bank records";
  assert.equal(deriveBrightspaceCsvBank(prose, context(prose)), undefined);
  const lossyUtf16 = block("Unpaired UTF-16 surrogate \ud800");
  assert.throws(() =>
    deriveBrightspaceCsvBank(lossyUtf16, context(lossyUtf16)),
  );
});

test("saved bank validation rejects changed source identity, literal payloads, keys and independently changed raw text", () => {
  const original = derive();
  for (const mutate of [
    (value) => (value.bank.source.topicId = "other-topic"),
    (value) => (value.bank.source.url = url + "?other=1"),
    (value) => (value.bank.source.originalRef = "f".repeat(64)),
    (value) => value.bank.source.bytes++,
    (value) => (value.bank.source.rawText += "\r\n"),
    (value) => (value.bank.nativeQuizMembership = "VERIFIED"),
    (value) => (value.questions[0].prompt = "Invented question"),
    (value) => (value.questions[0].options[1].text = "Invented choice"),
    (value) => (value.questions[0].answers = ["Invented key"]),
    (value) => (value.questions[0].sourceFile.ordinal = 2),
    (value) => (value.questions[0].sourceFile.topicId = "other-topic"),
    (value) => value.questions.pop(),
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() =>
      validateBrightspaceCsvBank(changed.bank, context(), changed.questions),
    );
  }
  const changed = structuredClone(original),
    rawText = literalBank.replace("HSS", "RHS"),
    source = context(rawText);
  changed.bank.source = { ...source, rawText };
  for (const question of changed.questions)
    question.sourceFile.originalRef = source.originalRef;
  assert.throws(
    () => validateBrightspaceCsvBank(changed.bank, source, changed.questions),
    "Even a coherent replacement hash cannot validate stale question payloads",
  );
});

test("verified CSV originals supply file-scoped snapshot questions without changing native quiz definitions", () => {
  const capture = captureFixture(),
    before = structuredClone(capture),
    result = snapshot(capture),
    bankItem = result.brightspace.find((item) => item.id === "5624715"),
    quizItem = result.brightspace.find((item) => item.id === "quiz-topic");
  assert.equal(bankItem.content.sourceFileBank.status, "COMPLETE");
  assert.equal(bankItem.content.sourceFileBank.source.rawText, literalBank);
  assert.equal(
    bankItem.content.sourceBody.originalIntegrity,
    "VERIFIED_RETAINED_ORIGINAL",
  );
  assert.equal(bankItem.content.questions.length, 2);
  assert.equal(bankItem.content.questionCoverage, "COMPLETE");
  assert.equal(bankItem.content.expectedQuestions, 2);
  assert.equal(quizItem.content.sourceFileBank, undefined);
  assert.equal(quizItem.content.questions.length, 1);
  assert.equal(
    quizItem.content.questions[0].prompt,
    "An independently captured native question",
  );
  assert.equal(capture.summary.quizQuestions, 1);
  assert.deepEqual(capture, before);
  for (const mutate of [
    (content) => (content.questions[0].answers = ["Invented key"]),
    (content) => (content.questions[0].prompt = "Invented prompt"),
    (content) => (content.sourceBody.originalRef = "e".repeat(64)),
    (content) => (content.sourceFileBank.source.topicId = "quiz-topic"),
    (content) => (content.url = "https://invented.invalid/other.csv"),
    (content) => (content.textCoverage = "EMPTY"),
    (content) => (content.textReason = "Invented coverage claim"),
    (content) => delete content.sourceFileBank,
  ]) {
    const changed = structuredClone(result);
    mutate(changed.brightspace.find((item) => item.id === "5624715").content);
    assert.throws(() => validateContentSnapshot(changed));
  }
});

test("unverified file projections cannot certify source-bank questions from a status label", () => {
  const capture = captureFixture();
  capture.assetBodies = {};
  delete capture.contentTree[0].contentEvidence.rawBodyRef;
  delete capture.contentTree[0].contentEvidence.bodyReceipt;
  const result = snapshot(capture),
    content = result.brightspace.find((item) => item.id === "5624715").content;
  assert.equal(content.sourceBody.originalIntegrity, "UNVERIFIED");
  assert.equal(content.sourceFileBank, undefined);
  assert.deepEqual(content.questions, []);
  assert.notEqual(content.questionCoverage, "COMPLETE");
});

test("owner export keeps CSV bank totals separate from original native quiz metadata and comparisons", async () => {
  const capture = captureFixture();
  const originalQuestion = capture.quizzes[0].questions[0];
  capture.quizzes[0].questions = Array.from({ length: 14 }, (_, index) => ({
    ...structuredClone(originalQuestion),
    QuestionId: 32734945 + index,
    QuestionText: { Text: `Synthetic native question ${index + 1}` },
  }));
  capture.summary.quizQuestions = 14;
  capture.quizzes[0].questionCount = 14;
  const course = {
      ...newRecord("package", "Synthetic course", {}),
      id: "csv-course",
    },
    report = {
      packageId: course.id,
      report: "Original synthetic native audit: 14 question definitions.",
      result: { stats: { quizQuestions: 14 }, ownerView: { items: [] } },
      contentEvidence: snapshot(capture),
    },
    before = structuredClone(report),
    exported = await prepareOwnerReportExport(report, "csv-audit", course, {
      list: async () => [],
      get: async () => {
        throw Error("No saved review is needed");
      },
    });
  assert.equal(exported.followUp.sourceFileBanks.length, 1);
  assert.equal(exported.followUp.sourceFileBanks[0].capturedQuestions, 2);
  assert.equal(
    exported.followUp.sourceFileBanks[0].nativeQuizMembership,
    "UNVERIFIED",
  );
  assert.deepEqual(exported.followUp.questionComparisons, []);
  assert.equal(exported.evidence.result.stats.quizQuestions, 14);
  assert.equal(capture.summary.quizQuestions, 14);
  assert.equal(
    report.contentEvidence.brightspace.find((item) => item.id === "quiz-topic")
      .content.questions.length,
    14,
  );
  assert.match(
    exported.text,
    /1 original CSV bank files \| 2 structured source-file questions/,
  );
  assert.match(exported.text, /separate from native quiz question lists/);
  assert.match(exported.text, /deployed quiz membership.*unverified/);
  assert.deepEqual(report, before);
});
