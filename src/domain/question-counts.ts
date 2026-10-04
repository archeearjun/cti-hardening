import {
  validateSourceQuestionCapture,
  publicSourceUrl,
  type SourceQuestionCapture,
} from "./external-source-questions.ts";
import { safeWebUrl } from "./owner-urls.ts";
import { qaObservedEmptyAssessmentReceipt_ } from "../engine/assessment/assignment.js";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as ObjectValue)
    : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

export const sourceCountBases = {
  published_list: "Published question list (live bank unverified)",
  live_bank: "Manually reviewed live question bank",
  per_attempt: "Questions in one attempt (bank size unverified)",
} as const;
export interface ReviewedSourceCount {
  sourceKey: string;
  count: number;
  basis: keyof typeof sourceCountBases;
  referenceUrl: string;
  checkedAt: string;
  note: string;
}
export interface QuestionCountSide {
  count: number | null;
  declared: number | null;
  complete: boolean;
  basis: string;
  selectCount: number | null;
  poolSize: number | null;
}
export interface QuestionComparison {
  sourceKey: string;
  sourceName: string;
  sourcePath: string;
  sourceUrls: string[];
  source: QuestionCountSide;
  coursera: QuestionCountSide;
  aligned: number | null;
  directMatch: boolean;
  reference?: ReviewedSourceCount;
  destinationObservation?: string;
  automaticSource?: SourceQuestionCapture;
  originalSource?: QuestionCountSide;
}
const unknownSide = (basis: string): QuestionCountSide => ({
  count: null,
  declared: null,
  complete: false,
  basis,
  selectCount: null,
  poolSize: null,
});
export function sourceQuestionKey(finding: ObjectValue): string {
  return JSON.stringify([
    text(finding.sourceId),
    text(finding.sourcePath),
    text(finding.sourceName),
  ]);
}
export function validateReviewedSourceCounts(
  value: unknown,
): asserts value is ReviewedSourceCount[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Invalid source question-count references.");
  const seen = new Set<string>();
  for (const v of value) {
    const r = object(v);
    if (
      !text(r.sourceKey) ||
      text(r.sourceKey).length > 4000 ||
      seen.has(text(r.sourceKey)) ||
      count(r.count) === null ||
      (r.count as number) > 100000 ||
      !Object.hasOwn(sourceCountBases, text(r.basis)) ||
      !safeWebUrl(r.referenceUrl) ||
      text(r.referenceUrl).length > 4000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(text(r.checkedAt)) ||
      !Number.isFinite(Date.parse(text(r.checkedAt))) ||
      new Date(text(r.checkedAt)).toISOString().slice(0, 10) !== r.checkedAt ||
      text(r.note).trim().length < 10 ||
      text(r.note).length > 2000
    )
      throw new Error(
        "Source count needs a whole number, evidence type, safe reference URL, date and a note identifying the exact quiz/section.",
      );
    seen.add(text(r.sourceKey));
  }
}

/** Presentation evidence only. A bank definition count is not a delivered quiz
 * length, and no numeric delta changes an audit verdict or score. */
export function questionComparison(
  finding: ObjectValue,
  sourceNode: unknown,
  item: ObjectValue,
): QuestionComparison | null {
  const checks = object(finding.checks),
    a = object(checks.structuredAssessment);
  const payload = object(object(sourceNode).sourcePayload),
    sourceAssessment = object(payload.structuredAssessment);
  if (
    !Object.keys(a).length &&
    !Object.keys(sourceAssessment).length &&
    !/assessment|assignment|quiz|exam/i.test(
      text(item.type) + " " + text(finding.sourceType),
    )
  )
    return null;
  // Repackaged carriers and split destinations must not inherit the parent
  // assessment's counts as if they were independently matched assessments.
  const primary = !!text(item.id) && text(finding.courseraId) === text(item.id);
  const source = unknownSide(
    "Source question total unverified; capture the question definitions or add a reviewed source reference.",
  );
  const n =
    count(a.sourceQuestionCount) ??
    (Array.isArray(sourceAssessment.questions)
      ? sourceAssessment.questions.length
      : null);
  const definitionCoverage = object(
    a.sourceDefinitionCoverage || sourceAssessment.definitionCoverage,
  );
  if (
    n !== null &&
    (n > 0 ||
      (definitionCoverage.completenessVerified === true &&
        definitionCoverage.observedDeclaredQuestionCount === 0))
  ) {
    source.count = n;
    source.declared =
      count(a.sourceDeclaredQuestionCount) ??
      count(sourceAssessment.declaredQuestionCount);
    source.complete =
      source.declared === n &&
      (!Object.keys(definitionCoverage).length ||
        definitionCoverage.completenessVerified === true);
    source.basis = source.complete
      ? "Captured source question definitions"
      : "Captured source definitions; total unverified";
  }
  const sp = object(
    a.sourceSelectionPolicy || sourceAssessment.selectionPolicy,
  );
  if (sp.observed === true) {
    source.selectCount = count(sp.selectCount);
    source.poolSize = count(sp.poolSize);
  }
  const coursera = unknownSide(
    primary
      ? "Coursera question count unverified"
      : "No direct destination count established for this source mapping",
  );
  const empty =
    primary &&
    (a.destinationContentState === "OBSERVED_EMPTY_EDITOR" ||
      list(checks.destinationReadiness).some((v) => {
        const f = object(v);
        return (
          f.code === "EMPTY_ASSESSMENT_EDITOR_OBSERVED" && f.itemId === item.id
        );
      }));
  if (empty && !(Number(a.courseraQuestionCount) > 0))
    Object.assign(coursera, {
      count: 0,
      declared: 0,
      complete: true,
      basis: "Confirmed empty editor in saved capture",
    });
  else if (
    primary &&
    count(a.courseraQuestionCount) !== null &&
    Number(a.courseraQuestionCount) > 0
  ) {
    coursera.count = count(a.courseraQuestionCount);
    coursera.declared = count(a.courseraDeclaredQuestionCount);
    coursera.complete =
      object(a.courseraCaptureCompleteness).questionCoverageComplete === true &&
      coursera.declared === coursera.count;
    coursera.basis = coursera.complete
      ? "Captured native question positions; coverage reported complete"
      : "Captured native question positions; coverage unverified/incomplete";
  }
  const cp = object(a.courseraSelectionPolicy);
  if (primary && cp.observed === true) {
    coursera.selectCount = count(cp.selectCount);
    coursera.poolSize = count(cp.poolSize);
  }
  return {
    sourceKey: text(finding.sourceName) ? sourceQuestionKey(finding) : "",
    sourceName: text(finding.sourceName) || "Source not matched",
    sourcePath: text(finding.sourcePath),
    sourceUrls: [
      ...new Set(
        [
          ...list(object(checks.links).expected),
          ...list(payload.embeddedRefs),
          ...list(payload.links),
        ]
          .map(safeWebUrl)
          .filter(Boolean),
      ),
    ],
    source,
    coursera,
    directMatch: primary,
    aligned:
      primary && count(a.alignedQuestionCount) !== null
        ? count(a.alignedQuestionCount)
        : null,
  };
}
export function withQuestionFollowUp(
  rows: QuestionComparison[],
  capture?: ObjectValue,
  references: ReviewedSourceCount[] = [],
  sourceCaptures: SourceQuestionCapture[] = [],
): QuestionComparison[] {
  validateReviewedSourceCounts(references);
  if (
    references.some((r) => !rows.some((row) => row.sourceKey === r.sourceKey))
  )
    throw new Error(
      "Saved source count does not match this report's source item.",
    );
  for (const capture of sourceCaptures) {
    validateSourceQuestionCapture(capture);
    if (
      !rows.some(
        (row) =>
          row.sourceKey === capture.sourceKey &&
          row.sourceUrls.some(
            (url) =>
              publicSourceUrl(url) === publicSourceUrl(capture.targetUrl),
          ),
      )
    )
      throw new Error(
        "Automatic source evidence does not match this report's recorded source link.",
      );
  }
  return rows.map((row) => {
    const automaticSource = sourceCaptures.find(
      (c) => c.sourceKey === row.sourceKey && c.status === "CAPTURED",
    );
    const bank = automaticSource?.bank;
    const source: QuestionCountSide = bank
      ? {
          count: bank.count,
          declared: bank.count,
          complete: true,
          basis: "Automatically captured H5P question-bank definitions",
          poolSize: bank.count,
          selectCount:
            bank.selectedPerAttempt !== null &&
            bank.selectedPerAttempt < bank.count
              ? bank.selectedPerAttempt
              : null,
        }
      : row.source;
    let coursera = row.coursera;
    if (capture) {
      const p = object(capture.payload),
        a = object(p.structuredAssessment),
        qs = list(a.questions);
      coursera = unknownSide(
        "Focused capture did not establish a question count; original audit remains below",
      );
      if (capture.editorObserved === true) {
        if (
          qaObservedEmptyAssessmentReceipt_({
            ...p,
            id: capture.itemId,
            type: "Assignment",
          })
        ) {
          coursera = {
            ...coursera,
            count: 0,
            declared: 0,
            complete: true,
            basis: "Confirmed empty editor in focused capture",
          };
        } else if (qs.length) {
          const c = object(a.captureCompleteness);
          coursera = {
            ...coursera,
            count: qs.length,
            declared: count(c.declared) ?? count(a.declaredQuestionCount),
            complete: c.questionCoverageComplete === true,
            basis:
              c.questionCoverageComplete === true
                ? "Focused native question positions; coverage reported complete"
                : "Focused native question positions; coverage unverified/incomplete",
          };
          const selection = object(a.selectionPolicy);
          if (selection.observed === true) {
            coursera.selectCount = count(selection.selectCount);
            coursera.poolSize = count(selection.poolSize);
          }
        }
      }
    }
    return {
      ...row,
      source,
      ...(automaticSource
        ? { automaticSource, originalSource: row.source, aligned: null }
        : {}),
      coursera,
      reference: references.find((r) => r.sourceKey === row.sourceKey),
      ...(capture
        ? { aligned: null, destinationObservation: text(capture.finishedAt) }
        : {}),
    };
  });
}
export function questionDifference(row: QuestionComparison): string {
  if (!row.directMatch)
    return "No direct source-to-destination assessment mapping; shared carriers must be checked separately.";
  if (
    row.automaticSource &&
    row.originalSource?.count !== null &&
    row.originalSource?.count !== undefined &&
    row.originalSource.count !== row.source.count
  )
    return "Current external source count differs from the original source capture; reconcile source versions before deciding what to restore.";
  const expected = row.reference?.count ?? row.source.count,
    actual = row.coursera.count;
  if (expected === null)
    return "Expected source count unverified — comparison incomplete.";
  if (actual === null)
    return "Coursera count unverified — no missing-question count established.";
  if (
    row.reference &&
    row.source.count !== null &&
    row.source.count !== expected
  )
    return "Reviewed reference differs from captured source count; reconcile versions/scope before comparing.";
  if (
    row.reference?.basis === "per_attempt" ||
    row.source.selectCount !== null ||
    row.coursera.selectCount !== null
  )
    return "Question selection is involved; compare bank size and questions per attempt separately.";
  const delta = expected - actual;
  if (delta === 0)
    return "Counts match; prompts, answers, media and working interactions still require verification.";
  return `${Math.abs(delta)} ${delta > 0 ? "fewer" : "more"} native question positions captured in Coursera. ${!row.coursera.complete ? "Destination capture is incomplete/unverified. " : ""}${!row.reference && !row.source.complete ? "Source total is unverified; this difference uses captured source definitions only. " : ""}Check intended placement and working embeds; this is not proof of course-wide deletion.`;
}
export function questionSideLabel(side: QuestionCountSide): string {
  return `${side.count === null ? "Unverified" : side.count}${side.declared !== null && side.declared !== side.count ? ` captured / ${side.declared} declared` : ""} — ${side.basis}${side.selectCount !== null ? `; ${side.selectCount} per attempt` : ""}${side.poolSize !== null ? `; bank ${side.poolSize}` : ""}`;
}
export function questionComparisonsText(
  groups: {
    name: string;
    id: string;
    questionComparisons: QuestionComparison[];
  }[],
): string {
  const lines = [
    "SOURCE VS COURSERA — QUESTION COUNTS",
    "Counts describe saved evidence, not a live view or an approval. Source definitions, published lists and native question positions may differ in scope. Rows are not summed: source items may share destinations.",
  ];
  for (const group of groups)
    for (const row of group.questionComparisons) {
      lines.push(
        `${group.name} [${group.id || "source only"}] ← ${row.sourceName} (${row.sourcePath})`,
        `  Expected source: ${questionSideLabel(row.source)}`,
      );
      if (row.automaticSource)
        lines.push(
          `  Automatic source capture: ${row.automaticSource.targetUrl} | captured ${row.automaticSource.capturedAt} | H5P.QuestionSet bank | ${row.automaticSource.documents.length} hashed source document(s). Learner launch and interactions remain unverified.`,
        );
      if (row.reference)
        lines.push(
          `  Reviewed source reference: ${row.reference.count} — ${sourceCountBases[row.reference.basis]} | checked ${row.reference.checkedAt} | ${row.reference.referenceUrl}`,
          `  Reference note: ${row.reference.note}`,
        );
      lines.push(
        `  Coursera captured: ${questionSideLabel(row.coursera)}${row.destinationObservation ? ` | ${row.destinationObservation}` : ""}`,
        `  Comparison: ${questionDifference(row)}`,
      );
      if (row.source.count === null && !row.reference && row.sourceUrls.length)
        lines.push(
          `  Source reference(s) to inspect: ${row.sourceUrls.join(" | ")}`,
        );
    }
  return lines.length > 2 ? lines.join("\n") + "\n\n" : "";
}
