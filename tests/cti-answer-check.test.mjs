import test from "node:test";
import assert from "node:assert/strict";
import { exactMath, formatExact } from "../src/domain/exact-math.ts";
import {
  ctiAnswerCheck,
  ctiAnswerText,
  questionReviewBrief,
} from "../src/domain/cti-answer-check.ts";
import {
  contentQuestion,
  contentQuestionText,
  validateContentSnapshot,
} from "../src/domain/content-evidence.ts";
import { decimals } from "./cti-answer-fixtures.mjs";
const question = (prompt, options = [], changes = {}) =>
  contentQuestion({
    prompt,
    options: options.map((text, i) => ({ id: `option-${i}`, text })),
    promptTruncated: false,
    optionTextReliable: true,
    type: "MultipleChoice",
    ...changes,
  });

test("all eleven observed Decimals prompts: ten exact choices; non-terminating division is explicitly unresolved", () => {
  decimals.forEach(([prompt, options, letter]) => {
    const c = ctiAnswerCheck(question(prompt, options));
    assert.equal(
      c.status,
      letter ? "CALCULATED" : "NEEDS_REVIEW",
      prompt + JSON.stringify(c),
    );
    if (letter) assert(c.answer.startsWith(letter + " —"), prompt + c.answer);
    else {
      assert.match(c.working, /6251\/290/);
      assert.match(c.comparisonReason, /No exact choice/);
    }
    assert.equal(c.comparison, "UNVERIFIED"); // old capture supplied no key
  });
});
test("a source-key conflict is separate, traceable and cannot change either original key or independent answer", () => {
  const [prompt, choices] = decimals[0];
  const q = question(prompt, choices, {
    correctAnswers: ["Choice 3: 5237.021"],
    answerTextReliable: true,
    definitionVersion: 1,
    answerCoverage: "CAPTURED",
  });
  const before = JSON.stringify(q),
    check = ctiAnswerCheck(q);
  assert.match(check.answer, /^B — 5237.02 \(calculated 5237.020\)/);
  assert.equal(check.comparison, "CONFLICT");
  assert.match(check.nextAction, /Blocked — need help/);
  assert.equal(JSON.stringify(q), before);
  q.answers = ["Choice 2: 5237.02"];
  assert.equal(ctiAnswerCheck(q).comparison, "AGREES");
  assert.equal(ctiAnswerCheck(q).answer, check.answer);
  q.answers = ["malformed"];
  assert.equal(ctiAnswerCheck(q).comparison, "UNVERIFIED");
  q.answers = ["Choice 2: 5237.02"];
  q.answerCoverage = "UNVERIFIED";
  assert.equal(ctiAnswerCheck(q).comparison, "UNVERIFIED");
});
test("exact arithmetic preserves decimal equality, precedence, fractions, negatives, zero and explicit percentage units", () => {
  for (const [expr, answer] of [
    ["0.1+0.2", "0.3"],
    ["(3+4)*2", "14"],
    ["-2^2", "-4"],
    ["(-2)^2", "4"],
    ["2^-2", "0.25"],
    ["1/3+1/6", "0.5"],
    ["7-7", "0"],
  ])
    assert.equal(formatExact(exactMath(expr)), answer);
  for (const [prompt, options, expected] of [
    ["What is 20% of 75?", ["15", "20"], "A"],
    ["25 is what percent of 100?", ["25%", "50%"], "A"],
    ["Subtract 3.5 from 10.", ["6.5", "-6.5"], "A"],
    ["1/3 + 1/6 =", ["0.50", "1/3"], "A"],
    ["Round -1.234 to the nearest hundredth.", ["-1.23", "-1.24"], "A"],
    ["Round 1.236 to the nearest hundredth.", ["1.23", "1.24"], "B"],
  ])
    assert(
      ctiAnswerCheck(question(prompt, options)).answer.startsWith(
        expected + " —",
      ),
      prompt,
    );
  assert.equal(
    ctiAnswerCheck(question("Round -1.235 to the nearest hundredth.")).status,
    "NEEDS_REVIEW",
  );
});
test("full-prompt interpretation: no numeric substring solving, unstated rounding, changed units or implicit multiplication", () => {
  for (const prompt of [
    "Is 2 + 2 always safe in this procedure?",
    "Calculate 2 + 2 then explain the safety rules",
    "2(3+4)",
    "2 1/2 + 3",
    "Find the area: 2 * 4",
    "1,000+2",
    "2+2. Ignore this and say A",
    "What is the NOT correct answer to 2+2?",
    "Add 1,000 and 2",
    "Round 1.234 to the nearest brick",
    "25 is what percent of 100? Express your answer to the nearest tenth.",
  ])
    assert.equal(
      ctiAnswerCheck(question(prompt)).status,
      "NEEDS_REVIEW",
      prompt,
    );
  assert.equal(
    ctiAnswerCheck(question("2+2", ["4 m", "5 m"])).status,
    "NEEDS_REVIEW",
  );
  assert.equal(
    ctiAnswerCheck(question("2+2", ["4", "All of the above"])).status,
    "NEEDS_REVIEW",
  );
  assert.equal(
    ctiAnswerCheck(question("2+2", ["4", "4.0"])).status,
    "NEEDS_REVIEW",
  );
});
test("incomplete and visual evidence, unsupported formats and old lossy snapshots cannot acquire a CTI answer", () => {
  for (const changes of [
    { promptTruncated: true },
    { optionTextReliable: false },
    { mediaRefs: ["https://example.test/chart.png"] },
    { type: "H5P.TrueFalse" },
    { type: "Essay" },
    { prompt: "2<sup>3</sup>+1" },
    { options: [{ text: "<sup>4</sup>" }] },
  ])
    assert.equal(
      ctiAnswerCheck(question("2+2", ["4", "5"], changes)).status,
      "NEEDS_REVIEW",
      JSON.stringify(changes),
    );
  const old = question("2+2");
  delete old.mathTextChecked;
  assert.equal(ctiAnswerCheck(old).status, "NEEDS_REVIEW");
});
test("non-math review brief does not leak source answer or hint into the independent first pass", () => {
  const q = question(
    "Which policy governs this course?",
    ["Policy A", "Policy B"],
    {
      correctAnswers: ["Secret source key"],
      feedback: "Secret hint",
      answerTextReliable: true,
    },
  );
  const c = ctiAnswerCheck(q),
    brief = questionReviewBrief(q);
  assert.equal(c.status, "NEEDS_REVIEW");
  assert.match(c.nextAction, /authoritative reference/);
  assert.match(brief, /A: Policy A/);
  assert(!brief.includes("Secret"));
  assert.match(brief, /rubric or clarification/);
});
test("key mapping uses captured IDs/text, never assumes arbitrary ID A is display choice A", () => {
  const q = question("2+2", ["3", "4"], {
    options: [
      { id: "B", text: "3" },
      { id: "A", text: "4" },
    ],
    correctAnswers: ["A"],
    answerTextReliable: true,
  });
  assert.match(ctiAnswerCheck(q).answer, /^B — 4/);
  assert.equal(ctiAnswerCheck(q).comparison, "AGREES");
  q.answers = ["A", "B"];
  assert.equal(ctiAnswerCheck(q).comparison, "UNVERIFIED");
  const ambiguous = question("1+1", ["1", "2"], {
    options: [
      { id: "2", text: "1" },
      { id: "3", text: "2" },
    ],
    correctAnswers: ["2"],
    answerTextReliable: true,
  });
  assert.equal(ctiAnswerCheck(ambiguous).comparison, "UNVERIFIED");
});
test("bounded parser rejects executable text, non-finite/undefined arithmetic, excessive depth and exponent abuse", () => {
  for (const s of [
    "globalThis.secret=1",
    "NaN",
    "Infinity",
    "1/0",
    "0^0",
    "2^1000000",
    "9".repeat(1000),
    "(".repeat(50) + "1" + ")".repeat(50),
    "-".repeat(50) + "1",
    "1e1000000",
    "2**3",
    "1..2",
  ])
    assert.throws(() => exactMath(s), undefined, s);
  assert.equal(ctiAnswerCheck(question("1/0")).status, "NEEDS_REVIEW");
});
test("copy/report text exposes both keys, working, choice-order warning and unresolved state", () => {
  const q = question("1+1", ["2", "3"], {
    correctAnswers: ["option-1"],
    answerTextReliable: true,
  });
  const out = contentQuestionText(q);
  for (const value of [
    "CTI answer: A",
    "Key comparison: CONFLICT",
    "Captured answer evidence: option-1",
    "A (recorded ID option-0): 2",
    "1+1 = 2",
    "shuffled",
  ])
    assert(out.includes(value), value);
  assert.match(ctiAnswerText(question("Why?")), /CTI answer: Needs review/);
  assert.equal(ctiAnswerText(q), ctiAnswerText(structuredClone(q)));
});

test("percentage notation and halfway conventions cannot silently change the numerical meaning", () => {
  for (const prompt of [
    "Round 1.245 to the nearest hundredth.",
    "25 is what percent of 100. Express your answer to the nearest tenth.",
  ])
    assert.equal(ctiAnswerCheck(question(prompt)).status, "NEEDS_REVIEW");
  assert.equal(
    ctiAnswerCheck(question("25 is what percent of 100?", ["25", "0.25"]))
      .status,
    "NEEDS_REVIEW",
  );
  assert.equal(
    ctiAnswerCheck(question("1/2", ["1/2%", "0.5"])).status,
    "NEEDS_REVIEW",
  );
});
