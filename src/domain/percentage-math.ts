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

export interface NumericCalculation {
  kind: "number";
  value: Rational;
  text: string;
  working: string;
  percentAnswer?: boolean;
  unit?: string;
}
export interface BooleanCalculation {
  kind: "boolean";
  value: boolean;
  text: string;
  working: string;
}
export interface CalculationReview {
  kind: "review";
  reason: string;
  working: string;
  nextAction: string;
}
export type PercentageCalculation =
  | NumericCalculation
  | BooleanCalculation
  | CalculationReview;
const num = "(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const signed = `[+-]?${num}`;
const hundred = rational(100n);
const one = rational(1n);
const rx = (pattern: string) => new RegExp(`^${pattern}$`, "i");
const percent = (v: Rational) => `${formatExact(operate(v, "*", hundred))}%`;
function numeric(
  expr: string,
  unit = "",
  asPercent = false,
): NumericCalculation {
  const value = exactMath(expr);
  const text = asPercent
    ? percent(value)
    : `${formatExact(value)}${unit ? " " + unit : ""}`;
  return {
    kind: "number",
    value,
    text,
    unit,
    percentAnswer: asPercent,
    working: `${expr} = ${text}. Exact arithmetic; no rounding assumed.`,
  };
}
function truth(value: boolean, working: string): BooleanCalculation {
  return { kind: "boolean", value, text: value ? "True" : "False", working };
}
function roundingReview(working: string): CalculationReview {
  return {
    kind: "review",
    reason:
      "The truth value changes if rounding is assumed; the prompt does not state a rounding rule.",
    working,
    nextAction:
      "Confirm the intended precision with the course owner and make it explicit in the question. Record the decision under Record the outcome before using the source key.",
  };
}
function roundsTo(value: Rational, stated: string): boolean {
  const places = stated.includes(".") ? stated.split(".")[1].length : 0;
  // Propagate unsupported precision or halfway conventions as Needs review,
  // rather than misclassifying them as a definite False statement.
  return equal(roundExact(value, places).value, exactMath(stated));
}
function validRate(rate: string, allowZero = true): void {
  const r = exactMath(rate);
  if (r.n < 0n || (!allowZero && r.n === 0n) || r.n > 100n * r.d)
    throw Error("The stated rate is outside the supported 0–100% range.");
}

/** Full prompt grammars only. No access to choices, source keys or feedback.
 * These cover percentage relations and explicit trades-math word problems;
 * unfamiliar wording is deliberately left for review. */
export function solvePercentagePrompt(
  prompt: string,
): PercentageCalculation | null {
  const p = normalizeMath(prompt)
    .replace(/\s+/g, " ")
    .replace(/[?.]$/, "")
    .trim();
  // Percentage precision is applied to the percentage number, not its ratio.
  const rounding = p.match(
    /^(.+?)[?.]? (?:Express|Round) (?:your |the )?answer to the nearest (whole percent|tenth of a percent|hundredth of a percent)$/i,
  );
  if (rounding) {
    // Repeated instructions can change the result through double rounding.
    if (/\b(?:Express|Round)\b/i.test(rounding[1])) return null;
    const base = solvePercentagePrompt(rounding[1]);
    if (!base || base.kind !== "number" || !base.percentAnswer) return null;
    const places = /whole/i.test(rounding[2])
      ? 0
      : /hundredth/i.test(rounding[2])
        ? 2
        : 1;
    const rounded = roundExact(operate(base.value, "*", hundred), places);
    return {
      ...base,
      value: operate(rounded.value, "/", hundred),
      text: `${rounded.text}%`,
      working: `${base.working} Rounded to the nearest ${rounding[2]}: ${rounded.text}%.`,
    };
  }
  let m: RegExpMatchArray | null;
  if (
    (m = p.match(
      rx(`(?:What is |Calculate )?(${signed})% of (${signed})(?: is what)?`),
    ))
  )
    return numeric(`${m[1]}% * ${m[2]}`);
  if (
    (m = p.match(
      rx(`What (?:percent|percentage) of (${signed}) is (${signed})`),
    ))
  )
    return numeric(`${m[2]} / ${m[1]}`, "", true);
  if (
    (m = p.match(
      rx(`(${signed}) is what (?:percent|percentage) of (${signed})`),
    ))
  )
    return numeric(`${m[1]} / ${m[2]}`, "", true);
  if ((m = p.match(rx(`(${signed}) is (${signed})% of (${signed})`)))) {
    const result = exactMath(`${m[2]}% * ${m[3]}`);
    return truth(
      equal(exactMath(m[1]), result),
      `${m[2]}% × ${m[3]} = ${formatExact(result)}; compare exactly with ${m[1]}.`,
    );
  }
  // Parts must share a basis. Do not generalize this to volumes of reacting
  // substances, percentages of one component, or a different asked component.
  const count = `(?:${num}|one|two|three|four|five|six|seven|eight|nine|ten)`;
  if (
    (m = p.match(
      rx(
        `(${count}) parts? acid and (${count}) parts? water are mixed as an electrolyte for a storage battery\\. What (?:percent|percentage) of the electrolyte is acid`,
      ),
    ))
  ) {
    const words: Record<string, string> = {
      one: "1",
      two: "2",
      three: "3",
      four: "4",
      five: "5",
      six: "6",
      seven: "7",
      eight: "8",
      nine: "9",
      ten: "10",
    };
    const a = words[m[1].toLowerCase()] ?? m[1],
      b = words[m[2].toLowerCase()] ?? m[2];
    const result = numeric(`${a} / (${a} + ${b})`, "", true);
    return {
      ...result,
      working: `${result.working} The denominator is all stated parts, on the same parts basis.`,
    };
  }
  if (
    (m = p.match(
      rx(
        `What (?:percent|percentage) is wasted when (${num}) of every (${num}) sheets of metal are spoiled`,
      ),
    ))
  ) {
    const result = numeric(`${m[1]} / ${m[2]}`, "", true);
    if (result.value.n > result.value.d)
      throw Error("Spoiled quantity exceeds the stated total.");
    return result;
  }
  if (
    (m = p.match(
      rx(
        `The efficiency of a motor is (${num})%\\. If the motor delivers (${num}) horsepower, what is the input\\? \\(efficiency = output / input\\)`,
      ),
    ))
  ) {
    validRate(m[1], false);
    const result = numeric(`${m[2]} / (${m[1]}%)`, "hp");
    return {
      ...result,
      working: `From efficiency = output / input, input = output / efficiency. ${result.working}`,
    };
  }
  if (
    (m = p.match(
      rx(
        `A floor joist is allowed to vary (${num})% of its stated width of (${num}) (mm|cm|m)\\. The (maximum|minimum) width would be what`,
      ),
    ))
  ) {
    validRate(m[1]);
    return numeric(
      `${m[2]} * (1 ${m[4].toLowerCase() === "maximum" ? "+" : "-"} ${m[1]}%)`,
      m[3].toLowerCase(),
    );
  }
  if (
    (m = p.match(
      rx(
        `A contractor wants to make a profit of (${num})% on a job\\. If the break-even cost is \\$(${num}), what should the total job price be, including the profit`,
      ),
    ))
  ) {
    validRate(m[1]);
    const rate = exactMath(`${m[1]}%`),
      cost = exactMath(m[2]);
    const markup = formatExact(operate(cost, "*", operate(one, "+", rate)));
    const margin = equal(rate, one)
      ? "No finite selling price gives a 100% margin with positive cost."
      : `If it means a margin on selling price: $${m[2]} ÷ (1 − ${m[1]}%) = $${formatExact(operate(cost, "/", operate(one, "-", rate)))}.`;
    return {
      kind: "review",
      reason:
        "The prompt does not say whether profit is a percentage of cost or selling price.",
      working: `If it means markup on cost: $${m[2]} × (1 + ${m[1]}%) = $${markup}. ${margin}`,
      nextAction:
        "Confirm whether the course intends markup on cost or margin on selling price. State that basis in the question and record the decision before choosing an answer.",
    };
  }
  if (
    (m = p.match(
      rx(
        `The minimum idle speed for a particular engine is (${num}) rpm\\. This is (${num})% of the maximum idle speed of (${num}) rpm`,
      ),
    ))
  ) {
    validRate(m[2]);
    const expected = exactMath(`${m[2]}% * ${m[3]}`),
      actual = exactMath(m[1]);
    const ratio = exactMath(`${m[1]} / ${m[3]} * 100`);
    const working = `${m[2]}% × ${m[3]} rpm = ${formatExact(expected)} rpm. ${m[1]} ÷ ${m[3]} × 100 = ${formatExact(ratio)}%.`;
    if (!equal(expected, actual) && roundsTo(ratio, m[2]))
      return roundingReview(
        `${working} False as an exact equality; True only if the percentage is rounded to the stated precision.`,
      );
    return truth(equal(expected, actual), working);
  }
  if (
    (m = p.match(
      rx(
        `The operating spindle speed of a lathe spindle that rotates freely is (${num}) rpm\\. When (${num})% is lost through slippage and cutting pressure, the new speed is (${num}) rpm`,
      ),
    ))
  ) {
    validRate(m[2]);
    const expected = exactMath(`${m[1]} * (1 - ${m[2]}%)`),
      actual = exactMath(m[3]);
    const working = `${m[1]} × (1 − ${m[2]}%) = ${formatExact(expected)} rpm.`;
    if (!equal(expected, actual) && roundsTo(expected, m[3]))
      return roundingReview(
        `${working} False as an exact equality; True only if the speed is rounded to the stated precision (${m[3]} rpm).`,
      );
    return truth(equal(expected, actual), working);
  }
  return null;
}
