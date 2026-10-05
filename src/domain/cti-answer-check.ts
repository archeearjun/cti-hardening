import type { ContentQuestion } from "./content-evidence.ts";
import {
  solvePercentagePrompt,
  type PercentageCalculation,
  type NumericCalculation,
  type BooleanCalculation,
} from "./percentage-math.ts";
import {
  equal,
  exactMath,
  formatExact,
  normalizeMath,
  operate,
  rational,
  roundExact,
  type Rational,
} from "./exact-math.ts";

export const CTI_ANSWER_VERSION = "exact-math-2";
export interface CtiAnswerCheck {
  version: string;
  status: "CALCULATED" | "NEEDS_REVIEW";
  answer: string;
  working: string;
  comparison: "AGREES" | "CONFLICT" | "UNVERIFIED";
  comparisonReason: string;
  nextAction: string;
}
export const choiceLabel = (index: number): string =>
  index < 26 ? String.fromCharCode(65 + index) : `Choice ${index + 1}`;
const reviewAction =
  "Review the question against the lesson or an authoritative reference with a subject reviewer. Record the reference, proposed answer and reason under Record the outcome; use Blocked — need help while a decision is pending.";
const conflictAction =
  "Record the captured key, CTI calculation and proposed correction under Record the outcome. Use Blocked — need help while the course owner's decision is pending; after editing, use Changed — needs verification and verify the shell. CTI does not notify the owner.";
function review(
  reason: string,
  working = "",
  nextAction = reviewAction,
): CtiAnswerCheck {
  return {
    version: CTI_ANSWER_VERSION,
    status: "NEEDS_REVIEW",
    answer: "Needs review",
    working: working || reason,
    comparison: "UNVERIFIED",
    comparisonReason: reason,
    nextAction,
  };
}
const number = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
function precision(text: string): number | null {
  const names: Record<string, number> = {
    millionth: 6,
    "hundred thousandth": 5,
    "ten thousandth": 4,
    thousandth: 3,
    hundredth: 2,
    tenth: 1,
    integer: 0,
    "whole number": 0,
    ten: -1,
    hundred: -2,
    thousand: -3,
    "ten thousand": -4,
    "hundred thousand": -5,
    million: -6,
  };
  const normalized = text.toLowerCase().replace(/-/g, " ").trim();
  if (Object.hasOwn(names, normalized)) return names[normalized];
  const match = normalized.match(/^([0-6]) decimal places?$/);
  return match ? Number(match[1]) : null;
}
/** This function sees prompt text ONLY, never keys, feedback or options. Full
 * anchored grammars prevent solving a numeric substring of a different task. */
function solvePrompt(prompt: string): PercentageCalculation | null {
  const percentage = solvePercentagePrompt(prompt);
  if (percentage) return percentage;
  let p = normalizeMath(prompt)
      .replace(/\s+/g, " ")
      .replace(/[?.]$/, "")
      .trim(),
    places: number | null = null;
  const rounding = p.match(
    /^(.+?)[.]? (?:Express|Round) (?:your |the )?answer to (?:the nearest (.+)|([0-6] decimal places?))$/i,
  );
  if (rounding) {
    p = rounding[1].replace(/\.$/, "");
    places = precision(rounding[2] || rounding[3]);
    if (places === null) return null;
  }
  let expr = "",
    match = p.match(
      new RegExp(
        `^Round (${number}) to (?:the nearest (.+)|([0-6] decimal places?))$`,
        "i",
      ),
    );
  if (match) {
    if (rounding) return null; // Two rounding instructions need reconciliation.
    expr = match[1];
    places = precision(match[2] || match[3]);
    if (places === null) return null;
  } else if (
    (match = p.match(
      new RegExp(`^(?:Multiply|Divide) (${number}) by (${number})$`, "i"),
    ))
  )
    expr = `${match[1]} ${/^Multiply/i.test(p) ? "*" : "/"} ${match[2]}`;
  else if (
    (match = p.match(
      new RegExp(`^Subtract (${number}) from (${number})$`, "i"),
    ))
  )
    expr = `${match[2]} - ${match[1]}`;
  else if ((match = p.match(/^Add (.+)$/i))) {
    // Commas here are list separators only when separated by whitespace. A
    // thousands separator or malformed list is not reinterpreted as addition.
    const parts = match[1].split(/,\s+(?:and\s+)?|\s+and\s+/i);
    if (
      parts.length < 2 ||
      !parts.every((x) => new RegExp(`^${number}$`).test(x))
    )
      return null;
    expr = parts.join(" + ");
  } else if (
    (match = p.match(
      new RegExp(`^(?:What is |Calculate )?(${number})% of (${number})$`, "i"),
    ))
  )
    expr = `${match[1]}% * ${match[2]}`;
  else if (
    (match = p.match(
      new RegExp(`^(${number}) is what percent of (${number})$`, "i"),
    ))
  ) {
    if (places !== null) return null;
    const value = exactMath(`${match[1]} / ${match[2]}`);
    return {
      kind: "number",
      value,
      percentAnswer: true,
      text: `${formatExact(operate(value, "*", rational(100n)))}%`,
      working: `${match[1]} ÷ ${match[2]} × 100 = ${formatExact(operate(value, "*", rational(100n)))}%.`,
    };
  } else {
    expr = p
      .replace(/^(?:Calculate|Evaluate|Simplify|What is)\s+/i, "")
      .replace(/\s*=\s*\??$/, "");
    // Require an operation, not a bare number or unrelated prose.
    if (!/[+*/^%-]/.test(expr) || /[^\d.\s()+*/^%-]/.test(expr)) return null;
  }
  const value = exactMath(expr);
  if (places !== null) {
    const rounded = roundExact(value, places);
    return {
      kind: "number",
      ...rounded,
      working: `${expr} = ${formatExact(value)}; rounded to ${places >= 0 ? `${places} decimal places` : `the nearest ${10 ** -places}`} gives ${rounded.text}.`,
    };
  }
  return {
    kind: "number",
    value,
    text: formatExact(value),
    working: `${expr} = ${formatExact(value)}. Standard order of operations; exact rational arithmetic.`,
  };
}
/** Only remove the exact unit established by the prompt. Other units, omitted
 * units, prose and implicit conversion remain unsupported. */
function numericChoice(text: string, unit = ""): Rational | null {
  let t = normalizeMath(text);
  if (unit) {
    if (!t.toLowerCase().endsWith(" " + unit)) return null;
    t = t.slice(0, -(unit.length + 1)).trim();
  }
  if (t.includes("/") && t.includes("%")) return null;
  if (!new RegExp(`^(?:${number})(?:\\s*\/\\s*(?:${number}))?%?$`).test(t))
    return null;
  try {
    return exactMath(t);
  } catch {
    return null;
  }
}
function compareKey(
  q: ContentQuestion,
  solved: NumericCalculation | BooleanCalculation,
  selected: number | null,
): Pick<CtiAnswerCheck, "comparison" | "comparisonReason"> {
  const unknown = {
    comparison: "UNVERIFIED" as const,
    comparisonReason:
      "Captured key is missing, incomplete or not unambiguously mapped. Refresh or inspect the recorded answer evidence.",
  };
  if (
    (q.answerCoverage !== undefined
      ? q.answerCoverage !== "CAPTURED"
      : q.answerKeyReliable !== true) ||
    q.answers.length !== 1
  )
    return unknown;
  const answer = q.answers[0].trim();
  let agrees: boolean;
  if (q.options.length) {
    const h5p = answer.match(/^Choice ([1-9]\d*): ([\s\S]+)$/);
    const indices = h5p
      ? q.options.flatMap((o, i) =>
          i === Number(h5p[1]) - 1 && o.text === h5p[2] ? [i] : [],
        )
      : q.options.flatMap((o, i) =>
          o.id === answer ||
          o.text.trim() === answer ||
          (solved.kind === "boolean" &&
            /^(true|false)$/i.test(answer) &&
            o.text.trim().toLowerCase() === answer.toLowerCase())
            ? [i]
            : [],
        );
    if (indices.length !== 1 || selected === null) return unknown;
    agrees = indices[0] === selected;
  } else if (solved.kind === "boolean") {
    if (!/^(true|false)$/i.test(answer)) return unknown;
    agrees = (answer.toLowerCase() === "true") === solved.value;
  } else {
    if (solved.percentAnswer && !answer.endsWith("%")) return unknown;
    const parsed = numericChoice(answer, solved.unit);
    if (!parsed) return unknown;
    agrees = equal(parsed, solved.value);
  }
  return {
    comparison: agrees ? "AGREES" : "CONFLICT",
    comparisonReason: agrees
      ? "Captured key agrees with this independent calculation."
      : "Captured key conflicts with this independent calculation. Review before copying or publishing.",
  };
}
export function ctiAnswerCheck(q: ContentQuestion): CtiAnswerCheck {
  if (q.mathTextChecked !== true)
    return review(
      "Older saved text has not been checked for lost mathematical notation. Load the original extraction content or refresh the source questions before calculating.",
    );
  if (!q.prompt.trim() || q.prompt.length > 1200 || q.options.length > 200)
    return review(
      "Question text is missing or exceeds the independent-check limit.",
    );
  if (
    q.media.length ||
    q.limitations.some((l) =>
      /prompt.*(?:truncat|not captured)|choice.*(?:unverified|truncat)|only the first.*choices|mathematical markup|media.*incomplete/i.test(
        l,
      ),
    )
  )
    return review(
      "Question text, choices or referenced media require inspection before an independent answer can be given.",
    );
  if (/blanks|essay|matching|multiple.?response|multi.?select/i.test(q.type))
    return review(
      "This question format needs a subject review; CTI does not infer its response rules.",
    );
  let solved: ReturnType<typeof solvePrompt>;
  try {
    solved = solvePrompt(q.prompt);
  } catch (e) {
    return review(
      `CTI could not safely calculate this prompt: ${e instanceof Error ? e.message : "unsupported calculation"}`,
    );
  }
  if (!solved)
    return review(
      "CTI's independent checker does not yet support this wording or subject. This is a checking limitation, not evidence that extraction failed. The captured key is not an independent answer.",
      "",
      "Check the answer independently: use a calculation for math, or the lesson and an authoritative reference for subject questions. Record the reasoning under Record the outcome. Ask the course owner only if the answer or wording remains unclear.",
    );
  if (solved.kind === "review")
    return review(solved.reason, solved.working, solved.nextAction);
  const trueFalse = /true.?false/i.test(q.type);
  if ((solved.kind === "boolean") !== trueFalse)
    return review(
      "The prompt calculation does not establish the response rules for this question type.",
      solved.working,
    );
  let selected: number | null = null;
  if (solved.kind === "boolean") {
    const labels = q.options.map((o) => o.text.trim().toLowerCase());
    if (
      labels.length !== 2 ||
      labels.filter((v) => v === "true").length !== 1 ||
      labels.filter((v) => v === "false").length !== 1
    )
      return review(
        "True/false choices must each be explicitly captured and unambiguous; CTI does not infer localized or missing labels.",
        solved.working,
      );
    selected = labels.indexOf(String(solved.value));
  } else if (q.options.length) {
    if (
      solved.percentAnswer &&
      q.options.some((o) => !o.text.trim().endsWith("%"))
    )
      return review(
        "This question asks for a percentage, but the choices do not consistently state percent units. Review the intended format.",
        solved.working,
      );
    const values = q.options.map((o) => numericChoice(o.text, solved.unit));
    if (values.some((v) => v === null))
      return review(
        "One or more choices contain unsupported notation, units or wording; CTI cannot establish the correct choice.",
        solved.working,
        "Confirm the intended units and complete choice wording before selecting an answer. CTI does not discard units or convert choices implicitly.",
      );
    const matches = values.flatMap((v, i) =>
      v && equal(v, solved!.value) ? [i] : [],
    );
    if (matches.length !== 1) {
      const result = review(
        matches.length
          ? "More than one choice is mathematically equivalent. Review duplicated answers and response rules."
          : "No exact choice matches. CTI does not assume rounding or silently pick the closest choice.",
        solved.working,
        matches.length
          ? "Review the equivalent choices and intended response rules with the course owner before copying the key."
          : "Confirm the intended rounding precision or correct the answer choices. Record that decision before copying the source key; CTI will not silently select the nearest option.",
      );
      return { ...result, answer: `Needs review — calculated ${solved.text}` };
    }
    selected = matches[0];
  }
  const key = compareKey(q, solved, selected);
  return {
    version: CTI_ANSWER_VERSION,
    status: "CALCULATED",
    answer:
      selected === null
        ? solved.text
        : `${choiceLabel(selected)} — ${q.options[selected].text} (calculated ${solved.text})`,
    working: solved.working,
    ...key,
    nextAction:
      key.comparison === "CONFLICT"
        ? conflictAction
        : "Use the working to review your draft. Verify the destination key and learner behavior before recording the item as checked; this calculation does not approve publication.",
  };
}
export function ctiAnswerText(q: ContentQuestion): string {
  const c = ctiAnswerCheck(q);
  return [
    `CTI answer: ${c.answer}`,
    `CTI check: ${c.status} | ${c.version}`,
    `Working: ${c.working}`,
    `Key comparison: ${c.comparison} — ${c.comparisonReason}`,
    `Next action: ${c.nextAction}`,
    "Choice letters refer to the displayed capture order; match the answer text if choices are shuffled.",
  ].join("\n");
}
export function questionReviewBrief(q: ContentQuestion): string {
  // Deliberately omit captured keys and feedback for an independent first pass.
  return [
    `INDEPENDENT QUESTION REVIEW — Question ${q.ordinal}`,
    q.prompt,
    ...q.options.map((o, i) => `${choiceLabel(i)}: ${o.text}`),
    ...q.media.map((m) => `Referenced media (inspect before answering): ${m}`),
    "Solve independently before comparing the recorded key in CTI. State the proposed answer, reasoning, authoritative reference and any missing context. Do not guess. For opinion, essay or ambiguous questions, state the rubric or clarification needed. Then record the decision and reference under Record the outcome in CTI. This brief intentionally excludes the captured key and feedback.",
  ].join("\n");
}
