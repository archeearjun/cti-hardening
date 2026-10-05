import test from "node:test";
import assert from "node:assert/strict";
import { fetchSourceQuestions } from "../server/source-questions.ts";
import {
  readH5PQuestionSets,
  validateSourceQuestionCapture,
} from "../src/domain/external-source-questions.ts";
import { h5pQuestionDetails } from "../src/domain/h5p-definition-evidence.ts";
import {
  sourceBankCoverage,
  sourceBankSettings,
  sourceQuestionCaptureText,
  sourceBankAnswerChecks,
} from "../src/domain/source-bank-summary.ts";
import {
  capturedContent,
  contentEvidenceText,
  validateContentSnapshot,
} from "../src/domain/content-evidence.ts";

const mc = (changes = {}) => ({
  library: "H5P.MultiChoice 1.16",
  params: {
    question: "Choose the even numbers.",
    answers: [
      {
        text: "<p>2</p>",
        correct: true,
        tipsAndFeedback: {
          tip: "Divide by two",
          chosenFeedback: "Yes",
          notChosenFeedback: "Look again",
        },
      },
      { text: "3", correct: false },
      { text: "4", correct: true },
    ],
    behaviour: { randomAnswers: false, enableRetry: true, passPercentage: 0 },
    overallFeedback: [
      { from: 0, to: 100, feedback: "Review the even numbers." },
    ],
    ...changes,
  },
});
const document = (params, id = "cid-3") =>
  `<script>H5PIntegration = ${JSON.stringify({ contents: { [id]: { library: "H5P.QuestionSet 1.17", jsonContent: JSON.stringify(params) } } }).replace(/</g, "\\u003c")};</script>`;
const capture = (params) =>
  fetchSourceQuestions(
    "synthetic-source",
    "https://opentextbc.ca/example/chapter/quiz/",
    async () =>
      new Response(document(params), {
        headers: { "Content-Type": "text/html" },
      }),
  );

test("all source choices, multiple marked answers, feedback, hints and explicit false/zero settings survive capture, serialization and readable export", async () => {
  const params = {
    questions: [mc()],
    poolSize: 1,
    randomQuestions: false,
    disableBackwardsNavigation: true,
    override: { retryButton: "off" },
    endGame: { showSolutionButton: false },
  };
  const c = JSON.parse(JSON.stringify(await capture(params)));
  validateSourceQuestionCapture(c);
  assert.deepEqual(JSON.parse(c.bank.definitionJson), params);
  assert.deepEqual(
    c.bank.questions[0].options.map((o) => o.correct),
    [true, false, true],
  );
  assert.deepEqual(c.bank.questions[0].correctAnswers, [
    "Choice 1: 2",
    "Choice 3: 4",
  ]);
  assert.deepEqual(sourceBankCoverage(c.bank), {
    total: 1,
    text: 1,
    answers: 1,
    feedback: 1,
    noFeedback: 0,
    originalRetained: true,
  });
  const out = sourceQuestionCaptureText(c);
  for (const t of [
    "Choice 1 hint: Divide by two",
    "Choice 1 when not selected: Look again",
    "Source-marked answer: Choice 3: 4",
    "randomAnswers): false",
    "passPercentage): 0",
    "endGame.showSolutionButton: false",
    "override.retryButton: off",
  ])
    assert(out.includes(t), t);
  assert.match(out, /not proof that the key is correct/);
});

test("missing answer flags and all-false banks remain unverified without treating missing as false", () => {
  for (const answers of [
    [{ text: "A", correct: true }, { text: "B" }],
    [{ text: "A", correct: false }],
    [],
  ]) {
    const q = h5pQuestionDetails(mc({ answers }));
    assert.equal(q.answerCoverage, "UNVERIFIED");
    assert.equal(q.answerTextReliable, false);
  }
  assert.equal(
    h5pQuestionDetails(mc({ answers: [{ text: "A" }] })).options[0].correct,
    null,
  );
});

test("true/false preserves false keys and localized labels without guessing a missing key", () => {
  for (const correct of [false, "false"]) {
    const q = h5pQuestionDetails({
      library: "H5P.TrueFalse 1.8",
      params: {
        question: "Is this true?",
        correct,
        l10n: { trueText: "Oui", falseText: "Non" },
        behaviour: { feedbackOnWrong: "Review the statement." },
      },
    });
    assert.deepEqual(q.correctAnswers, ["false"]);
    assert.deepEqual(
      q.options.map((o) => o.correct),
      [false, true],
    );
    assert.equal(q.options[1].text, "Non");
    assert.equal(q.answerCoverage, "CAPTURED");
    assert.match(q.feedback, /Review the statement/);
  }
  assert.equal(
    h5pQuestionDetails({
      library: "H5P.TrueFalse 1.8",
      params: { question: "Unknown" },
    }).answerCoverage,
    "UNVERIFIED",
  );
});

test("fill-in-the-blanks captures every text block, ordered alternatives and hints separately from learner text", () => {
  const q = h5pQuestionDetails({
    library: "H5P.Blanks 1.14",
    params: {
      text: "Complete both lines.",
      questions: [
        "Water is H<sub>2</sub>O. Its phase is *liquid/fluid:Think of water*.",
        "Two squared is *4/four*.",
      ],
      behaviour: { caseSensitive: false },
    },
  });
  assert.match(q.prompt, /H_\(2\)O/);
  assert.match(q.prompt, /Two squared is \[Blank 2\]/);
  assert(!q.prompt.includes("liquid/fluid"));
  assert.deepEqual(q.correctAnswers, [
    "Blank 1: liquid OR fluid",
    "Blank 2: 4 OR four",
  ]);
  assert.match(q.feedback, /Blank 1 hint: Think of water/);
  assert.equal(q.answerCoverage, "CAPTURED");
  assert.equal(
    h5pQuestionDetails({
      library: "H5P.Blanks 1.14",
      params: { questions: ["*open only"] },
    }).answerCoverage,
    "UNVERIFIED",
  );
});

test("unsupported question types and versions keep original definitions without manufacturing answer coverage", async () => {
  for (const library of [
    "H5P.DragQuestion 1.15",
    "H5P.MultiChoice 2.0",
    "H5P.Essay 1.5",
  ]) {
    const c = await capture({ questions: [{ ...mc(), library }] });
    assert.equal(c.status, "CAPTURED"); // positions, not decoded answers
    assert.equal(c.bank.questions[0].answerCoverage, "UNVERIFIED");
    assert.equal(c.bank.questions[0].options.length, 3);
    assert.equal(sourceBankCoverage(c.bank).answers, 0);
    assert.equal(
      JSON.parse(c.bank.definitionJson).questions[0].library,
      library,
    );
    assert.match(
      sourceQuestionCaptureText(c),
      /has not been decoded completely/,
    );
  }
});

test("full original definitions remain available when readable prompts, choices or feedback hit bounds", async () => {
  const c = await capture({
    questions: [
      mc({
        question: "x".repeat(48001),
        answers: Array.from({ length: 201 }, (_, i) => ({
          text: String(i),
          correct: i === 0,
        })),
        overallFeedback: [{ from: 0, to: 100, feedback: "f".repeat(48001) }],
      }),
    ],
  });
  validateSourceQuestionCapture(c);
  const q = c.bank.questions[0];
  assert.equal(q.promptTruncated, true);
  assert.equal(q.optionTextReliable, false);
  assert.equal(q.feedbackCoverage, "UNVERIFIED");
  assert.equal(q.answerCoverage, "UNVERIFIED");
  assert.equal(
    JSON.parse(c.bank.definitionJson).questions[0].params.answers.length,
    201,
  );
});

test("tampered answer, feedback, prompt, identity and bank settings are rejected against retained definitions", async () => {
  const c = await capture({ questions: [mc()], randomQuestions: false });
  for (const mutate of [
    (x) => x.bank.questions[0].correctAnswers.push("invented"),
    (x) => (x.bank.questions[0].answerCoverage = "UNVERIFIED"),
    (x) => (x.bank.questions[0].feedback = "changed"),
    (x) => (x.bank.questions[0].prompt = "changed"),
    (x) => (x.bank.questions[0].id = "another"),
    (x) => (x.bank.questions[0].options[1].correct = true),
    (x) => (x.bank.randomOrder = true),
    (x) => delete x.bank.definitionJson,
  ]) {
    const changed = structuredClone(c);
    mutate(changed);
    assert.throws(() => validateSourceQuestionCapture(changed));
  }
});

test("older saved captures remain readable and explicitly require refresh for answer keys", async () => {
  const c = await capture({ questions: [mc()] });
  delete c.bank.definitionJson;
  delete c.bank.definitionLibrary;
  for (const q of c.bank.questions) {
    for (const k of [
      "definitionVersion",
      "correctAnswers",
      "answerTextReliable",
      "answerCoverage",
      "feedback",
      "feedbackCoverage",
      "settingsText",
      "definitionLimitations",
    ])
      delete q[k];
    for (const o of q.options) delete o.correct;
  }
  validateSourceQuestionCapture(c);
  assert.match(sourceQuestionCaptureText(c), /Older capture: refresh/);
  assert.equal(sourceBankCoverage(c.bank).answers, 0);
});

test("conflicting answer keys for the same bank are not deduplicated into one successful capture", async () => {
  const html =
    document({ questions: [mc()] }) +
    document({
      questions: [
        mc({
          answers: [
            { text: "2", correct: false },
            { text: "3", correct: true },
          ],
        }),
      ],
    });
  assert.equal(readH5PQuestionSets(html).banks.length, 2);
  const c = await fetchSourceQuestions(
    "source",
    "https://opentextbc.ca/example/",
    async () =>
      new Response(html, { headers: { "Content-Type": "text/html" } }),
  );
  assert.equal(c.status, "PARTIAL");
  assert.equal(c.bank, null);
  assert.equal(c.observedBanks.length, 2);
});

test("source key is preserved even when a mathematical answer appears wrong; no generated correction", async () => {
  const c = await capture({
    questions: [
      mc({
        question: "Round 5237.02046 to the nearest thousandth.",
        answers: [
          { text: "5237.02", correct: false },
          { text: "5237.021", correct: true },
        ],
      }),
    ],
  });
  assert.deepEqual(c.bank.questions[0].correctAnswers, ["Choice 2: 5237.021"]);
  assert.match(
    sourceQuestionCaptureText(c),
    /not proof that the key is correct/,
  );
});

test("malformed feedback does not become none-authored; absent settings do not acquire defaults", async () => {
  for (const overallFeedback of [null, "hidden", [{ feedback: 5 }]]) {
    assert.equal(
      h5pQuestionDetails(mc({ overallFeedback })).feedbackCoverage,
      "UNVERIFIED",
    );
  }
  const q = h5pQuestionDetails(
    mc({ behaviour: undefined, overallFeedback: [] }),
  );
  assert.match(q.settingsText, /not recorded/);
  const c = await capture({ questions: [mc()] });
  assert.equal(sourceBankSettings(c.bank), "");
});

test("readable snapshot and report preserve rich evidence, mathematical notation and safe text", async () => {
  const c = await capture({
    questions: [
      mc({ question: "<p>x<sup>2</sup> &lt; 9</p><script>alert(1)</script>" }),
    ],
  });
  const content = capturedContent(
    { structuredAssessment: { questions: c.bank.questions } },
    { basis: "Source", source: true },
  );
  validateContentSnapshot({
    schemaVersion: 1,
    coursera: [],
    brightspace: [{ id: "source", name: "Quiz", path: "Module", content }],
  });
  assert.match(content.questions[0].prompt, /x\^\(2\) < 9/);
  assert(!content.questions[0].prompt.includes("alert"));
  assert.match(
    contentEvidenceText(content),
    /Source-marked answer: Choice 1: 2/,
  );
  assert.match(contentEvidenceText(content), /Explicit question settings/);
});

test("independent H5P math checks inspect original notation without changing saved definitions", async () => {
  for (const question of [
    "2+2",
    "<math><mn>2</mn><msup><mn>2</mn><mn>2</mn></msup></math>+2",
  ]) {
    const c = await capture({
      questions: [
        mc({
          question,
          answers: [
            { text: "4", correct: true },
            { text: "5", correct: false },
          ],
        }),
      ],
    });
    const original = JSON.stringify(c);
    const checks = sourceBankAnswerChecks(c.bank);
    assert.equal(checks.calculated, question === "2+2" ? 1 : 0);
    assert.equal(JSON.stringify(c), original);
    assert.match(
      sourceQuestionCaptureText(c),
      question === "2+2" ? /CTI answer: A/ : /CTI answer: Needs review/,
    );
  }
});
