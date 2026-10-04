import test from "node:test";
import assert from "node:assert/strict";
import {
  capturedContent,
  buildContentSnapshot,
  validateContentSnapshot,
  contentText,
  contentEvidenceText,
} from "../src/domain/content-evidence.ts";
import { itemContentView } from "../src/domain/owner-content.ts";
import { buildOwnerTasks } from "../src/domain/owner-actions.ts";
import { fetchSourceQuestions } from "../server/source-questions.ts";
import { validateSourceQuestionCapture } from "../src/domain/external-source-questions.ts";
import { comparisonFixture, encode } from "./workflow-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import {
  saveOriginalContent,
  loadReportContent,
} from "../src/domain/report-content-store.ts";
import { digest, recordSummary } from "../src/domain/workspace-store.ts";
import { validateRecord } from "../src/domain/workspace-validation.ts";
const question = {
  id: "q",
  prompt: "What is 1 < 2 and 3 > 2?",
  type: "multiple-choice",
  options: [
    { id: "a", text: "Zero" },
    { id: "b", text: "One" },
  ],
  correctAnswers: [0, false],
  feedback: "Feedback",
};
const payload = {
  structuredAssessment: {
    questions: [question],
    declaredQuestionCount: 1,
    captureCompleteness: { declared: 1, questionCoverageComplete: true },
  },
};
test("question records stay complete only with matching declared coverage; missing, partial and malformed remain distinct", () => {
  const c = capturedContent(payload, { basis: "test" });
  assert.equal(c.questionCoverage, "COMPLETE");
  assert.equal(c.questions[0].prompt, question.prompt);
  assert.deepEqual(c.questions[0].answers, ["0", "false"]);
  assert.match(c.questions[0].limitations.join(), /Answer-key coverage/);
  assert.equal(
    capturedContent(
      {
        ...payload,
        structuredAssessment: {
          ...payload.structuredAssessment,
          declaredQuestionCount: 2,
          captureCompleteness: { declared: 2, questionCoverageComplete: true },
        },
      },
      { basis: "partial" },
    ).questionCoverage,
    "PARTIAL",
  );
  const unknown = capturedContent({}, { basis: "unknown" });
  assert.equal(unknown.questionCoverage, "UNVERIFIED");
  assert.equal(unknown.expectedQuestions, null);
  assert.equal(
    capturedContent(payload, { basis: "unobserved", editorObserved: false })
      .questionCoverage,
    "PARTIAL",
  );
  const snapshot = {
    schemaVersion: 1,
    coursera: [{ id: "i", name: "n", path: "m", content: c }],
    brightspace: [],
  };
  validateContentSnapshot(snapshot);
  assert.throws(
    () =>
      validateContentSnapshot({
        ...snapshot,
        coursera: [
          { ...snapshot.coursera[0], content: { ...c, expectedQuestions: 9 } },
        ],
      }),
    /contradicts/,
  );
});

test("content supplements use exact original hashes and preserve immutable audits across repeated imports and stale reads", async () => {
  const input = comparisonFixture(),
    report = createWorkflows(workerXml).compare(input);
  delete report.contentEvidence;
  const audit = {
    ...input.course,
    id: "saved-audit",
    kind: "audit",
    packageId: input.course.id,
    data: report,
    version: 1,
  };
  const records = new Map([[audit.id, structuredClone(audit)]]),
    before = structuredClone(audit);
  const store = {
    role: "editor",
    email: "test",
    list: async () => [...records.values()].map(recordSummary),
    get: async (id) => structuredClone(records.get(id)),
    save: async (r) => {
      assert.notEqual(r.kind, "audit");
      validateRecord(r);
      assert.equal(r.version, records.get(r.id)?.version || 0);
      const next = { ...r, version: r.version + 1 };
      records.set(r.id, next);
      return next;
    },
  };
  await assert.rejects(
    saveOriginalContent(encode({ fingerprints: [] }), report, audit.id, store),
    /original extraction hash/,
  );
  assert.equal(
    await saveOriginalContent(input.json.bytes, report, audit.id, store),
    "coursera",
  );
  await saveOriginalContent(input.json.bytes, report, audit.id, store);
  assert.equal(records.size, 2);
  assert.deepEqual(records.get(audit.id), before);
  const merged = await loadReportContent(
    report,
    audit.id,
    audit.packageId,
    store,
  );
  assert.equal(merged.coursera.length, 2);
  assert(merged.coursera[0].content.text);
  const supplement = [...records.values()].find((r) => r.kind === "operations");
  assert.equal(supplement.data.sourceHash, await digest(input.json.bytes));
  assert.equal(recordSummary(supplement).data.contentEvidence, undefined);
  await assert.rejects(
    loadReportContent(
      { ...report, hashes: { json: "0".repeat(64) } },
      audit.id,
      audit.packageId,
      store,
    ),
    /does not match/,
  );
  await assert.rejects(
    loadReportContent(report, audit.id, audit.packageId, {
      ...store,
      get: async (id) => ({ ...(await store.get(id)), version: 99 }),
    }),
    /changed/,
  );
});

test("duplicate positions and unknown Brightspace totals cannot claim complete coverage", () => {
  const duplicate = capturedContent(
    {
      structuredAssessment: {
        questions: [question, question],
        captureCompleteness: { declared: 2, questionCoverageComplete: true },
      },
    },
    { basis: "duplicate" },
  );
  assert.equal(duplicate.questions.length, 2);
  assert.equal(duplicate.questionCoverage, "PARTIAL");
  const source = capturedContent(
    {
      structuredAssessment: {
        questions: [question],
        declaredQuestionCount: 1,
        definitionCoverage: {
          observedDeclaredQuestionCount: null,
          completenessVerified: false,
        },
      },
    },
    { basis: "source", source: true },
  );
  assert.equal(source.expectedQuestions, null);
  assert.equal(source.questionCoverage, "PARTIAL");
});
test("all retained text is displayed, explicit field receipts govern complete and empty, truncation remains visible", () => {
  const text = "Long reading ".repeat(3000);
  const p = {
    textSample: text,
    textCaptureEvidence: {
      method: "EXACT_READING_FIELD",
      itemId: "i",
      capturedCharacters: text.length,
      observedCharacters: text.length,
      truncated: false,
    },
  };
  const complete = capturedContent(p, { basis: "reading", itemId: "i" });
  assert.equal(complete.textCoverage, "COMPLETE");
  assert.equal(complete.text, text);
  assert.equal(
    capturedContent(
      { ...p, textCaptureTruncated: true },
      { basis: "reading", itemId: "i" },
    ).textCoverage,
    "PARTIAL",
  );
  assert.equal(
    capturedContent(p, { basis: "wrong-item", itemId: "wrong" }).textCoverage,
    "PARTIAL",
  );
  const empty = capturedContent(
    {
      textSample: "",
      textCaptureEvidence: {
        ...p.textCaptureEvidence,
        capturedCharacters: 0,
        observedCharacters: 0,
      },
    },
    { basis: "empty", itemId: "i" },
  );
  assert.equal(empty.textCoverage, "EMPTY");
  assert.equal(
    capturedContent({ textSample: "" }, { basis: "unknown" }).textCoverage,
    "UNVERIFIED",
  );
  assert.equal(
    contentText("<p>&#49; &lt; 2</p><script>bad()</script>"),
    "1 < 2",
  );
  assert.equal(contentText("1 < 2 and 3 > 2"), "1 < 2 and 3 > 2");
  assert.match(contentEvidenceText(complete), /Long reading/);
});
test("new comparisons retain original Coursera content and later partial checks do not erase the previous observation", () => {
  const input = comparisonFixture(),
    original = structuredClone(input.course.data.scan.courseTree);
  const output = createWorkflows(workerXml).compare(input);
  validateContentSnapshot(output.contentEvidence);
  assert.equal(
    output.contentEvidence.coursera[0].content.text,
    JSON.parse(new TextDecoder().decode(input.json.bytes)).fingerprints[0]
      .payload.textSample,
  );
  const task = buildOwnerTasks(
    output.result,
    input.course.data.scan.courseTree,
  )[0];
  const view = itemContentView(
    task,
    output.contentEvidence,
    {},
    { payload, editorObserved: false, finishedAt: "2026-10-04T18:00:00Z" },
  );
  assert.equal(view.coursera.questionCoverage, "PARTIAL");
  assert.equal(
    view.previousCoursera.text,
    output.contentEvidence.coursera[0].content.text,
  );
  assert(view.source[0].text);
  assert.deepEqual(input.course.data.scan.courseTree, original);
  const duplicate = structuredClone(output.contentEvidence);
  duplicate.coursera.push(duplicate.coursera[0]);
  assert.equal(
    itemContentView(task, duplicate).coursera.basis,
    "Older report excerpt",
  );
});
test("Brightspace definition content joins by tool identity, never by duplicate quiz title", () => {
  const bs = {
    capturedAt: "2026-10-04T18:00:00Z",
    contentTree: [
      {
        kind: "TOPIC",
        id: 12,
        title: "Quiz",
        toolItemId: 23,
        contentEvidence: { text: "Source wrapper" },
      },
    ],
    quizzes: [
      {
        id: 99,
        name: "Quiz",
        questions: [{ QuestionText: { Text: "WRONG" } }],
      },
      {
        id: 23,
        name: "Quiz",
        questions: [
          {
            QuestionText: { Text: "Right source prompt" },
            QuestionType: "ShortAnswer",
          },
        ],
        questionCount: 1,
        questionsStatus: "CAPTURED",
      },
    ],
  };
  const s = buildContentSnapshot(undefined, encode(bs));
  assert.equal(s.brightspace.length, 1);
  assert.match(s.brightspace[0].content.questions[0].prompt, /Right source/);
  assert(!JSON.stringify(s).includes("WRONG"));
  assert.equal(s.brightspace[0].content.textCoverage, "PARTIAL");
});
test("public source returns useful partial text and banks without claiming a complete quiz", async () => {
  const target = "https://opentextbc.ca/example/chapter/quiz/";
  const html =
    '<main><p>First part of the reading.</p><iframe src="/example/?h5p-embed=4"></iframe></main>';
  let calls = 0;
  const capture = await fetchSourceQuestions(
    "key",
    target,
    async () =>
      new Response(++calls === 1 ? html : "Forbidden", {
        status: calls === 1 ? 200 : 403,
        headers: { "Content-Type": "text/html" },
      }),
  );
  validateSourceQuestionCapture(capture);
  assert.equal(capture.status, "PARTIAL");
  assert.equal(capture.bank, null);
  assert.match(capture.pages[0].text, /First part/);
  assert.match(capture.reason, /HTTP 403/);
});
test("H5P captures long prompts and choices with explicit truncation and safely readable markup", async () => {
  const prompt = "A long prompt ".repeat(800),
    h5p = {
      contents: {
        "cid-1": {
          library: "H5P.QuestionSet 1.17",
          jsonContent: JSON.stringify({
            questions: [
              {
                library: "H5P.MultiChoice 1.16",
                params: {
                  question: prompt,
                  answers: [
                    { text: "<p>Choice &amp; one</p>", correct: true },
                    { text: "Choice two", correct: false },
                  ],
                },
              },
            ],
          }),
        },
      },
    };
  const capture = await fetchSourceQuestions(
    "key",
    "https://opentextbc.ca/example/",
    async () =>
      new Response(
        "<script>H5PIntegration = " + JSON.stringify(h5p) + "</script>",
        { headers: { "Content-Type": "text/html" } },
      ),
  );
  assert.equal(capture.status, "CAPTURED");
  assert.equal(capture.bank.questions[0].prompt, prompt.trim());
  assert.equal(capture.bank.questions[0].promptTruncated, false);
  assert.equal(capture.bank.questions[0].options[0].text, "Choice & one");
  validateSourceQuestionCapture(capture);
});
