import {
  capturedContent,
  contentEvidenceText,
  contentQuestion,
  contentObject,
} from "./content-evidence.ts";
import { ctiAnswerCheck } from "./cti-answer-check.ts";
import { bankSettings } from "./h5p-definition-evidence.ts";
import {
  validateSourceQuestionCapture,
  type SourceQuestionBank,
  type SourceQuestionCapture,
} from "./external-source-questions.ts";

export function sourceBankCoverage(bank: SourceQuestionBank) {
  return {
    total: bank.count,
    text: bank.questions.filter(
      (q) =>
        q.prompt &&
        q.promptTruncated === false &&
        q.optionTextReliable === true,
    ).length,
    answers: bank.questions.filter(
      (q) => q.answerCoverage === "CAPTURED" && q.answerTextReliable === true,
    ).length,
    feedback: bank.questions.filter(
      (q) =>
        q.feedbackCoverage === "CAPTURED" ||
        q.feedbackCoverage === "NONE_AUTHORED",
    ).length,
    noFeedback: bank.questions.filter(
      (q) => q.feedbackCoverage === "NONE_AUTHORED",
    ).length,
    originalRetained: typeof bank.definitionJson === "string",
  };
}
export function sourceBankSummary(bank: SourceQuestionBank): string {
  const c = sourceBankCoverage(bank);
  const checks = sourceBankAnswerChecks(bank);
  return [
    `Question text and choices: ${c.text}/${c.total} complete in the readable view.`,
    `Source-marked answer keys: ${c.answers}/${c.total} captured.`,
    `CTI independent checks: ${checks.calculated}/${c.total} calculated; ${checks.review} need review; ${checks.conflicts} captured-key conflicts.`,
    `Authored feedback and hints: ${c.feedback}/${c.total} inspected (${c.noFeedback} with none authored in the supported fields).`,
    c.originalRetained
      ? "Original assessment definitions retained, including markup and settings. Referenced media files are not downloaded."
      : "Older capture: refresh source questions to collect answer keys, feedback and original definitions.",
    "Source-marked answers are evidence of the source key, not proof that the key is correct. No runtime defaults are inferred. Learner interaction remains unverified.",
  ].join("\n");
}
export function sourceBankAnswerChecks(bank: SourceQuestionBank) {
  const checks = sourceBankQuestionInputs(bank).map((q, i) =>
    ctiAnswerCheck(contentQuestion(q, i)),
  );
  return {
    calculated: checks.filter((c) => c.status === "CALCULATED").length,
    review: checks.filter((c) => c.status === "NEEDS_REVIEW").length,
    conflicts: checks.filter((c) => c.comparison === "CONFLICT").length,
  };
}
/** Raw math markup must not become an apparently plain arithmetic expression
 * after text stripping. Inspect original definitions without modifying them. */
export function sourceBankQuestionInputs(bank: SourceQuestionBank) {
  const raw: unknown = bank.definitionJson
    ? contentObject(JSON.parse(bank.definitionJson)).questions
    : undefined;
  return bank.questions.map((q, i) => ({
    ...q,
    mathNotationRisk:
      !Array.isArray(raw) ||
      !raw[i] ||
      /<(?:math|svg)\b|\\\\[([]|\$\$/i.test(JSON.stringify(raw[i])),
  }));
}
export function sourceBankSettings(bank: SourceQuestionBank): string {
  return bank.definitionJson
    ? bankSettings(JSON.parse(bank.definitionJson))
    : "";
}
export function sourceQuestionCaptureText(
  capture: SourceQuestionCapture,
): string {
  validateSourceQuestionCapture(capture);
  const lines = [
    "SAVED SOURCE QUESTIONS AND ANSWERS",
    `Source: ${capture.targetUrl}`,
    `Captured: ${capture.capturedAt}`,
    `Capture status: ${capture.status}`,
    capture.reason,
  ];
  for (const bank of capture.bank
    ? [capture.bank]
    : capture.observedBanks || []) {
    const content = capturedContent(
      {
        structuredAssessment: {
          questions: sourceBankQuestionInputs(bank),
          declaredQuestionCount:
            capture.status === "CAPTURED" ? bank.count : undefined,
          definitionCoverage: {
            completenessVerified: capture.status === "CAPTURED",
          },
        },
      },
      {
        basis: `Source bank ${bank.id}`,
        source: true,
        capturedAt: capture.capturedAt,
        url: capture.targetUrl,
      },
    );
    lines.push(
      sourceBankSummary(bank),
      "Explicit assessment settings (bank overrides can supersede question settings):",
      sourceBankSettings(bank) || "Not recorded.",
      contentEvidenceText(content),
    );
  }
  return lines.join("\n\n");
}
