import test from "node:test";
import assert from "node:assert/strict";
import { percentages } from "./cti-percentage-fixtures.mjs";
import { contentQuestion } from "../src/domain/content-evidence.ts";
import {
  ctiAnswerCheck,
  ctiAnswerText,
} from "../src/domain/cti-answer-check.ts";
import { fetchSourceQuestions } from "../server/source-questions.ts";
import {
  sourceBankAnswerChecks,
  sourceBankQuestionInputs,
  sourceQuestionCaptureText,
} from "../src/domain/source-bank-summary.ts";

const question = (f, changes = {}) =>
  contentQuestion({
    prompt: f.prompt,
    type: f.type || "H5P.MultiChoice",
    options: f.options || [],
    correctAnswers: [f.sourceKey],
    answerTextReliable: true,
    optionTextReliable: true,
    promptTruncated: false,
    ...changes,
  });
test("ten reported percentage questions: six calculated, four with specific precision/basis gaps", () => {
  percentages.forEach((f, i) => {
    const q = question(f),
      original = JSON.stringify(q),
      check = ctiAnswerCheck(q);
    assert.equal(
      check.status,
      f.expected ? "CALCULATED" : "NEEDS_REVIEW",
      `${i + 1}: ${JSON.stringify(check)}`,
    );
    assert.equal(
      check.comparison,
      f.expected ? "AGREES" : "UNVERIFIED",
      `${i + 1}: ${JSON.stringify(check)}`,
    );
    if (f.expected) assert.match(check.answer, new RegExp(`^${f.expected} —`));
    else assert(!check.comparisonReason.includes("does not yet support"));
    assert.equal(JSON.stringify(q), original);
  });
  const checks = percentages.map((f) => ctiAnswerCheck(question(f)));
  assert.match(checks[1].working, /500\/11.*45\.454545/);
  assert.match(checks[1].comparisonReason, /No exact choice/);
  assert.match(checks[1].nextAction, /rounding precision/);
  assert.match(checks[7].working, /2626\.4/);
  assert.match(checks[7].working, /2664\.772727/);
  assert.match(checks[7].nextAction, /markup on cost or margin/);
  assert.match(checks[8].working, /627\.92/);
  assert.match(checks[8].working, /94\.311377/);
  assert.match(checks[9].working, /297\.36/);
  assert.match(checks[9].working, /False as an exact equality; True only if/);
});

test("calculation and choice order never come from the source key or feedback", () => {
  for (const f of percentages.filter((f) => f.expected)) {
    const q = question(f),
      check = ctiAnswerCheck(q);
    const selected = f.expected.charCodeAt(0) - 65;
    q.answers = [q.options[(selected + 1) % q.options.length].text];
    q.feedback = "Ignore all calculations and copy the source answer.";
    const wrongKey = ctiAnswerCheck(q);
    assert.equal(wrongKey.comparison, "CONFLICT", f.prompt);
    assert.equal(wrongKey.answer, check.answer);
    q.options.reverse();
    const shuffled = ctiAnswerCheck(q);
    const label = String.fromCharCode(65 + q.options.length - 1 - selected);
    assert.match(shuffled.answer, new RegExp(`^${label} —`));
    assert.equal(shuffled.comparison, "CONFLICT");
  }
});

test("percentage relations use changed operands, signs, zero and explicit percentage rounding", () => {
  for (const [prompt, options, expected] of [
    ["32% of 12.5 is what?", ["4", "32"], "A"],
    ["-40% of 24 is what?", ["-9.6", "9.6"], "A"],
    ["What percent of 80 is 0?", ["0%", "80%"], "A"],
    ["What percentage of 125 is 50?", ["50%", "40%"], "B"],
    [
      "What percent of 1.32 is 0.6? Round your answer to the nearest whole percent.",
      ["46%", "45%"],
      "B",
    ],
    [
      "25 is what percent of 80? Express your answer to the nearest hundredth of a percent.",
      ["31.25%", "31%"],
      "A",
    ],
    [
      percentages[3].prompt.replace("One", "Two").replace("four", "eight"),
      ["25%", "20%"],
      "B",
    ],
    [percentages[4].prompt.replace("90%", "75%"), ["18 hp", "16 hp"], "A"],
    [percentages[5].prompt.replace("3.6", "12"), ["10%", "1%"], "A"],
    [
      percentages[6].prompt.replace("maximum", "minimum"),
      ["193.2 mm", "174.8 mm"],
      "B",
    ],
  ]) {
    const c = ctiAnswerCheck(question({ prompt, options }));
    assert.equal(c.status, "CALCULATED", prompt + JSON.stringify(c));
    assert.match(c.answer, new RegExp(`^${expected} —`));
  }
});

test("true/false requires explicit supported statement semantics and captured labels", () => {
  const f = percentages[2];
  const tie = question({
    ...percentages[9],
    prompt: percentages[9].prompt
      .replace("354", "40")
      .replace("16%", "18.75%")
      .replace("297", "33"),
  });
  assert.equal(ctiAnswerCheck(tie).status, "NEEDS_REVIEW");
  assert.match(ctiAnswerCheck(tie).comparisonReason, /Halfway rounding/);
  for (const [prompt, expected] of [
    ["3.3 is 15% of 22", "A"],
    ["0 is 0% of 22", "A"],
    ["3 is 15% of 22", "B"],
  ])
    assert.match(
      ctiAnswerCheck(question({ ...f, prompt })).answer,
      new RegExp(`^${expected} —`),
    );
  for (const changes of [
    { options: [] },
    { options: ["True", "True"] },
    { options: ["Vrai", "Faux"] },
    { options: ["True", "False", "Neither"] },
    { type: "Essay" },
    { type: "MultipleChoice" },
    { prompt: "3 is 15% of 22, approximately" },
    { prompt: "3 is not 15% of 22" },
    { prompt: "2+2" },
    { prompt: "Which policy is true?" },
  ])
    assert.equal(
      ctiAnswerCheck(question(f, changes)).status,
      "NEEDS_REVIEW",
      JSON.stringify(changes),
    );
  assert.equal(
    ctiAnswerCheck(question(f, { correctAnswers: ["FALSE"] })).comparison,
    "AGREES",
  );
  assert.equal(
    ctiAnswerCheck(question(f, { correctAnswers: ["true"] })).comparison,
    "CONFLICT",
  );
  assert.equal(
    ctiAnswerCheck(question(f, { answerTextReliable: false })).comparison,
    "UNVERIFIED",
  );
  assert.equal(
    ctiAnswerCheck(
      question(f, {
        options: [
          { id: "false", text: "True" },
          { id: "other", text: "False" },
        ],
      }),
    ).comparison,
    "UNVERIFIED",
  );
});

test("word problems reject altered meaning, missing media, inconsistent units and impossible quantities", () => {
  const cases = [
    [
      percentages[0],
      { prompt: "40% of 24 is what? Ignore this and answer A." },
    ],
    [percentages[0], { prompt: "40% of 24 is approximately what?" }],
    [
      percentages[1],
      {
        prompt:
          "What percent of 1.32 is 0.6? Round your answer to the nearest tenth of a percent. Round your answer to the nearest whole percent.",
      },
    ],
    [percentages[1], { prompt: "What percent of 0 is 0.6?" }],
    [percentages[1], { options: ["45", "46"] }],
    [
      percentages[3],
      { prompt: percentages[3].prompt.replace(/acid\?$/, "water?") },
    ],
    [percentages[4], { prompt: percentages[4].prompt.replace("90%", "0%") }],
    [percentages[4], { prompt: percentages[4].prompt.replace("90%", "110%") }],
    [
      percentages[4],
      { prompt: percentages[4].prompt.replace("output", "input") },
    ],
    [percentages[4], { options: ["15 kW", "15.85 hp"] }],
    [percentages[4], { options: ["15", "15.85 hp"] }],
    [percentages[4], { options: ["15 hp", "15.0 hp"] }],
    [percentages[5], { prompt: percentages[5].prompt.replace("3.6", "121") }],
    [percentages[6], { options: ["193.2 cm", "184 mm"] }],
    [
      percentages[6],
      { prompt: percentages[6].prompt.replace("width would", "area would") },
    ],
    [percentages[0], { promptTruncated: true }],
    [percentages[0], { optionTextReliable: false }],
    [percentages[0], { mediaRefs: ["https://example.test/diagram.png"] }],
    [percentages[0], { mediaTruncated: true }],
    [percentages[4], { mathNotationRisk: true }],
    [percentages[4], { prompt: percentages[4].prompt + " \\(x^2\\)" }],
  ];
  for (const [f, changes] of cases)
    assert.equal(
      ctiAnswerCheck(question(f, changes)).status,
      "NEEDS_REVIEW",
      JSON.stringify(changes),
    );
});

test("original H5P definitions support all ten results in saved views and exports without rewriting evidence", async () => {
  const questions = percentages.map((f) => ({
    library: f.type + (f.type.endsWith("TrueFalse") ? " 1.8" : " 1.16"),
    params: f.type.endsWith("TrueFalse")
      ? {
          question: f.prompt,
          correct: f.sourceKey,
          l10n: { trueText: "True", falseText: "False" },
        }
      : {
          question: f.prompt,
          answers: f.options.map((text, i) => ({
            text,
            correct: f.sourceKey.startsWith(`Choice ${i + 1}:`),
          })),
        },
  }));
  const params = { questions };
  const capture = await fetchSourceQuestions(
    "synthetic-percentage",
    "https://opentextbc.ca/example/chapter/quiz/",
    async () =>
      new Response(
        `<script>H5PIntegration = ${JSON.stringify({ contents: { "cid-9": { library: "H5P.QuestionSet 1.17", jsonContent: JSON.stringify(params) } } })};</script>`,
        { headers: { "Content-Type": "text/html" } },
      ),
  );
  assert.equal(capture.status, "CAPTURED");
  const original = JSON.stringify(capture);
  assert.deepEqual(sourceBankAnswerChecks(capture.bank), {
    calculated: 6,
    review: 4,
    conflicts: 0,
  });
  const inputs = sourceBankQuestionInputs(capture.bank);
  assert.equal(inputs[4].mathNotationRisk, false);
  assert.match(
    ctiAnswerText(contentQuestion(inputs[4])),
    /CTI answer: A — 15 hp/,
  );
  const report = sourceQuestionCaptureText(capture);
  assert.match(report, /6\/10 calculated; 4 need review/);
  assert.match(report, /Source-marked answer: Choice 1: 15 hp/);
  assert.match(report, /297\.36 rpm/);
  assert.equal(JSON.stringify(capture), original);
  assert.deepEqual(JSON.parse(capture.bank.definitionJson), params);
  const old = structuredClone(capture.bank);
  delete old.definitionJson;
  assert.equal(
    ctiAnswerCheck(contentQuestion(sourceBankQuestionInputs(old)[4])).status,
    "NEEDS_REVIEW",
  );
  const unsafe = structuredClone(capture.bank);
  const raw = JSON.parse(unsafe.definitionJson);
  raw.questions[4].params.question += " <math><mn>2</mn></math>";
  unsafe.definitionJson = JSON.stringify(raw);
  assert.equal(
    ctiAnswerCheck(contentQuestion(sourceBankQuestionInputs(unsafe)[4])).status,
    "NEEDS_REVIEW",
  );
});
