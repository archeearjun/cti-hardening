import { contentText } from "./content-evidence.ts";

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const own = (v: Obj, k: string) => Object.hasOwn(v, k);
const textLimit = 48000;
export type DefinitionCoverage = "CAPTURED" | "NONE_AUTHORED" | "UNVERIFIED";
export interface H5PQuestionDetails {
  definitionVersion: 1;
  prompt: string;
  promptTruncated: boolean;
  options: { id: string; text: string; correct: boolean | null }[];
  optionTextReliable: boolean;
  correctAnswers: string[];
  answerTextReliable: boolean;
  answerCoverage: DefinitionCoverage;
  feedback: string;
  feedbackCoverage: DefinitionCoverage;
  settingsText: string;
  definitionLimitations: string[];
}

/** Preserve mathematical exponents in the readable view. The original markup
 * remains in definitionJson; neither representation is executed as HTML. */
export function h5pText(v: unknown): string {
  return contentText(
    typeof v === "string"
      ? v
          .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, "^($1)")
          .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, "_($1)")
      : "",
  );
}

const settingLabels: Record<string, string> = {
  poolSize: "Questions selected per attempt (0 means the full bank)",
  randomQuestions: "Randomize question order",
  disableBackwardsNavigation: "Disable backwards navigation",
  passPercentage: "Passing percentage",
  enableRetry: "Allow retry",
  enableSolutionsButton: "Show solution button",
  enableCheckButton: "Show check button",
  randomAnswers: "Randomize choices",
  showSolutionsRequiresInput: "Require a response before showing solutions",
  autoCheck: "Check answers automatically",
  caseSensitive: "Case sensitive",
  acceptSpellingErrors: "Accept minor spelling errors",
  singlePoint: "One point for the whole question",
};
/** Only explicitly authored settings, including false, zero and empty strings.
 * A library default is never reported as an observed course setting. */
export function explicitSettings(value: unknown): string {
  const lines: string[] = [];
  let visited = 0,
    limited = false;
  function visit(v: unknown, path: string, depth: number) {
    if (++visited > 1000 || depth > 8 || lines.length >= 200) {
      limited = true;
      return;
    }
    if (v !== null && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        if (visited > 1000 || lines.length >= 200) {
          limited = true;
          break;
        }
        visit(child, path ? path + "." + k : k, depth + 1);
      }
    } else {
      const label = settingLabels[path.split(".").at(-1) || ""];
      const rendered = typeof v === "string" ? h5pText(v) : JSON.stringify(v);
      lines.push(
        `${label ? label + " (" + path + ")" : path}: ${rendered === "" ? "[explicitly empty]" : rendered}`,
      );
    }
  }
  visit(value, "", 0);
  const result = lines.join("\n");
  return (
    result.slice(0, textLimit) +
    (limited || result.length > textLimit
      ? "\n[Readable settings limited; the original definitions retain the remaining fields.]"
      : "")
  );
}

export function bankSettings(params: Obj): string {
  return explicitSettings(
    Object.fromEntries(
      [
        "poolSize",
        "randomQuestions",
        "disableBackwardsNavigation",
        "passPercentage",
        "override",
        "endGame",
        "introPage",
        "progressType",
      ]
        .filter((k) => own(params, k))
        .map((k) => [k, params[k]]),
    ),
  );
}

/** Type-specific decoding based on the upstream H5P schemas. Unknown types
 * retain their original definition but cannot claim a decoded answer key. */
export function h5pQuestionDetails(value: unknown): H5PQuestionDetails {
  const q = object(value),
    p = object(q.params);
  const library = typeof q.library === "string" ? q.library : "";
  const supported = /^H5P\.(MultiChoice|TrueFalse|Blanks) 1\.\d+$/.test(
    library,
  );
  let prompt = h5pText(
    p.question ?? p.text ?? p.taskDescription ?? p.introduction,
  );
  const options: H5PQuestionDetails["options"] = [];
  const answers: string[] = [],
    feedback: string[] = [],
    limitations: string[] = [];
  let keyComplete = false,
    choicesComplete = false,
    feedbackValid = supported;
  function addFeedback(label: string, v: unknown) {
    if (v === undefined) return;
    if (typeof v !== "string") {
      feedbackValid = false;
      return;
    }
    const t = h5pText(v);
    if (t) feedback.push(label + ": " + t);
  }
  if (library.startsWith("H5P.MultiChoice ")) {
    const authored = Array.isArray(p.answers) ? p.answers : [];
    if (!Array.isArray(p.answers) || authored.length > 200)
      feedbackValid = false;
    choicesComplete =
      authored.length > 0 &&
      authored.length <= 200 &&
      authored.every(
        (v) =>
          typeof object(v).text === "string" &&
          !!h5pText(object(v).text) &&
          h5pText(object(v).text).length <= textLimit,
      );
    for (const [i, v] of authored.slice(0, 200).entries()) {
      const a = object(v),
        t = h5pText(a.text);
      options.push({
        id: String(i + 1),
        text: t.slice(0, textLimit),
        correct: typeof a.correct === "boolean" ? a.correct : null,
      });
      if (a.correct === true && t) answers.push(`Choice ${i + 1}: ${t}`);
      const f = object(a.tipsAndFeedback);
      if (
        a.tipsAndFeedback !== undefined &&
        (a.tipsAndFeedback === null ||
          typeof a.tipsAndFeedback !== "object" ||
          Array.isArray(a.tipsAndFeedback))
      )
        feedbackValid = false;
      addFeedback(`Choice ${i + 1} hint`, f.tip);
      addFeedback(`Choice ${i + 1} when selected`, f.chosenFeedback);
      addFeedback(`Choice ${i + 1} when not selected`, f.notChosenFeedback);
    }
    keyComplete =
      supported &&
      choicesComplete &&
      answers.length > 0 &&
      authored.every((v) => typeof object(v).correct === "boolean");
  } else if (supported && library.startsWith("H5P.TrueFalse ")) {
    const valid =
      p.correct === "true" ||
      p.correct === "false" ||
      typeof p.correct === "boolean";
    const correct = p.correct === "true" || p.correct === true;
    const labels = object(p.l10n);
    for (const [i, v] of [true, false].entries()) {
      const label = h5pText(labels[v ? "trueText" : "falseText"]) || String(v);
      options.push({
        id: String(i + 1),
        text: label.slice(0, textLimit),
        correct: valid ? v === correct : null,
      });
      if (label.length > textLimit)
        limitations.push(
          "True/false choice label truncated; see original definitions.",
        );
    }
    choicesComplete = !limitations.length;
    keyComplete = valid && choicesComplete;
    if (valid) answers.push(String(correct));
  } else if (supported && library.startsWith("H5P.Blanks ")) {
    const blocks = Array.isArray(p.questions) ? p.questions : [];
    let valid = blocks.length > 0 && blocks.every((v) => typeof v === "string");
    let position = 0;
    const rendered = blocks.map((block) =>
      h5pText(block).replace(/\*([^*]+)\*/g, (_all, entry: string) => {
        position++;
        const colon = entry.indexOf(":"),
          answer = colon < 0 ? entry : entry.slice(0, colon);
        const alternatives = answer.split("/").map((s) => s.trim());
        if (alternatives.some((s) => !s)) valid = false;
        answers.push(`Blank ${position}: ${alternatives.join(" OR ")}`);
        if (colon >= 0)
          addFeedback(`Blank ${position} hint`, entry.slice(colon + 1));
        return `[Blank ${position}]`;
      }),
    );
    // Unpaired delimiters must not silently produce a complete answer claim.
    if (rendered.some((s) => s.includes("*"))) valid = false;
    prompt = [prompt, ...rendered].filter(Boolean).join("\n");
    keyComplete = valid && position > 0;
    choicesComplete = true; // text-entry question: no authored choices
  } else {
    // Preserve the previous generic choice-text view even when this type's
    // answer semantics are unsupported. Its full structure remains in JSON.
    const authored = Array.isArray(p.answers) ? p.answers : [];
    for (const [i, v] of authored.slice(0, 200).entries())
      options.push({
        id: String(i + 1),
        text: h5pText(object(v).text).slice(0, textLimit),
        correct: null,
      });
    choicesComplete =
      authored.length > 0 &&
      authored.length <= 200 &&
      authored.every(
        (v) =>
          typeof object(v).text === "string" &&
          !!h5pText(object(v).text) &&
          h5pText(object(v).text).length <= textLimit,
      );
  }
  const ranges = Array.isArray(p.overallFeedback)
    ? p.overallFeedback
    : object(p.overallFeedback).overallFeedback;
  if (
    p.overallFeedback !== undefined &&
    !Array.isArray(p.overallFeedback) &&
    (p.overallFeedback === null ||
      typeof p.overallFeedback !== "object" ||
      !own(object(p.overallFeedback), "overallFeedback"))
  )
    feedbackValid = false;
  if (ranges !== undefined && !Array.isArray(ranges)) feedbackValid = false;
  if (Array.isArray(ranges)) {
    if (ranges.length > 200) feedbackValid = false;
    for (const r of ranges.slice(0, 200)) {
      const f = object(r);
      if (r === null || typeof r !== "object" || Array.isArray(r))
        feedbackValid = false;
      addFeedback(
        `Score feedback (${f.from ?? "unknown"}–${f.to ?? "unknown"}%)`,
        f.feedback,
      );
    }
  }
  const behaviour = object(p.behaviour);
  if (
    p.behaviour !== undefined &&
    (p.behaviour === null ||
      typeof p.behaviour !== "object" ||
      Array.isArray(p.behaviour))
  )
    feedbackValid = false;
  addFeedback("Correct-response feedback", behaviour.feedbackOnCorrect);
  addFeedback("Incorrect-response feedback", behaviour.feedbackOnWrong);
  const feedbackText = feedback.join("\n");
  if (feedbackText.length > textLimit) feedbackValid = false;
  if (answers.some((a) => a.length > textLimit) || answers.length > 200)
    keyComplete = false;
  if (!supported)
    limitations.push(
      "This question type/version has not been decoded completely. Download its original definitions; do not infer an answer from the displayed text.",
    );
  if (!keyComplete)
    limitations.push(
      "Source answer-key coverage is incomplete or unverified. Captured answer values below may be partial.",
    );
  if (!feedbackValid)
    limitations.push(
      "Feedback coverage is unverified; inspect the retained original definitions.",
    );
  if (prompt.length > textLimit)
    limitations.push(
      "Readable prompt is limited; the original definitions retain the full markup.",
    );
  return {
    definitionVersion: 1,
    prompt: prompt.slice(0, textLimit),
    promptTruncated: prompt.length > textLimit,
    options,
    optionTextReliable: choicesComplete,
    correctAnswers: answers.slice(0, 200).map((a) => a.slice(0, textLimit)),
    answerTextReliable: keyComplete,
    answerCoverage: keyComplete ? "CAPTURED" : "UNVERIFIED",
    feedback: feedbackText.slice(0, textLimit),
    feedbackCoverage: !feedbackValid
      ? "UNVERIFIED"
      : feedbackText
        ? "CAPTURED"
        : "NONE_AUTHORED",
    settingsText:
      p.behaviour !== undefined
        ? explicitSettings(p.behaviour) ||
          "Behaviour group explicitly empty; runtime defaults unverified."
        : "Behaviour settings not recorded; runtime defaults unverified.",
    definitionLimitations: limitations,
  };
}
