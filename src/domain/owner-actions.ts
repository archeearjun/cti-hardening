import {
  validateSourceQuestionCapture,
  type SourceQuestionCapture,
} from "./external-source-questions.ts";
import {
  questionComparison,
  sourceContentTarget,
  type SourceContentTarget,
  validateReviewedSourceCounts,
  type QuestionComparison,
  type ReviewedSourceCount,
} from "./question-counts.ts";
import { cleanOwnerText as clean } from "./owner-text.ts";
import {
  validateCourseraLinkedCaptures,
  type CourseraLinkedCapture,
} from "./coursera-linked-content.ts";
import type { EvidenceObject } from "./workspace-types.ts";

export type OwnerProgress =
  | "open"
  | "in_progress"
  | "changed"
  | "checked"
  | "blocked";
export interface OwnerReview {
  status: OwnerProgress;
  note: string;
  updatedAt: string;
  updatedBy: string;
  capture?: EvidenceObject;
  pluginCaptures?: EvidenceObject[];
  sourceCounts?: ReviewedSourceCount[];
  sourceCaptures?: SourceQuestionCapture[];
  courseraLinkedCaptures?: CourseraLinkedCapture[];
}
export interface OwnerTask {
  key: string;
  id: string;
  name: string;
  path: string;
  type: string;
  status: string;
  actions: EvidenceObject[];
  findings: EvidenceObject[];
  sources: EvidenceObject[];
  excerpt: string;
  url: string;
  questionSummary: string[];
  questionComparisons: QuestionComparison[];
  sourceTargets: SourceContentTarget[];
  checks: ItemExpectation[];
  sourceOnly: boolean;
  pluginTargets: string[];
}
export interface ItemExpectation {
  kind: "url" | "file" | "prompt";
  value: string;
  label: string;
}
export {
  safeWebUrl,
  courseraLocation,
  ownerCourseLocation,
  courseraItemUrl,
} from "./owner-urls.ts";
import { safeWebUrl, courseraItemUrl } from "./owner-urls.ts";
export {
  normalizeOwnerContext,
  buildOwnerContext,
  resolveSourceTopic,
} from "./source-navigation.ts";

function sourceEntries(tree: EvidenceObject[]) {
  const out: EvidenceObject[] = [];
  const walk = (nodes: EvidenceObject[], path: string) => {
    for (const node of nodes || []) {
      out.push({ ...node, path });
      walk(node.children, [path, node.title].filter(Boolean).join(" > "));
    }
  };
  walk(tree, "");
  return out;
}
function linkedResult(r: EvidenceObject, id: string) {
  const c = r.checks || {},
    family = c.transformationFamily || c.oneToManyTransformation || {};
  return (
    String(r.courseraId || "") === id ||
    (family.childIds || []).map(String).includes(id) ||
    (c.repackaging || r.repackaging || {}).carriers?.some(
      (x: EvidenceObject) => String(x.id) === id,
    )
  );
}
function sourceFor(r: EvidenceObject, nodes: EvidenceObject[]) {
  let matches = nodes.filter(
    (n) => r.sourceId && String(n.idref || n.id || "") === String(r.sourceId),
  );
  if (matches.length !== 1)
    matches = nodes.filter(
      (n) =>
        clean(n.title) === clean(r.sourceName) &&
        clean(n.path) === clean(r.sourcePath),
    );
  // Duplicated resource IDs or titles remain ambiguous; do not show a different
  // module's source text as a repair instruction.
  return matches.length === 1 ? matches[0] : null;
}
export function buildOwnerTasks(
  result: EvidenceObject,
  tree: EvidenceObject[] = [],
  override = "",
): OwnerTask[] {
  const nodes = sourceEntries(tree),
    results: EvidenceObject[] = result.itemResults || [];
  const make = (
    item: EvidenceObject,
    sourceOnly: boolean,
    index: number,
  ): OwnerTask => {
    const id = sourceOnly ? "" : String(item.id || "");
    const findings = sourceOnly
      ? results.filter(
          (r) =>
            clean(r.sourceName) === clean(item.name) &&
            clean(r.sourcePath) === clean(item.path),
        )
      : results.filter((r) => linkedResult(r, id));
    const sources = findings
      .map((r) => sourceFor(r, nodes))
      .filter(Boolean) as EvidenceObject[];
    const uniqueSources = sources.filter(
      (s, i) =>
        sources.findIndex(
          (n) =>
            (n.idref || n.id || "") === (s.idref || s.id || "") &&
            n.title === s.title &&
            n.path === s.path,
        ) === i,
    );
    const actions = sourceOnly
      ? [
          {
            action: item.action,
            verdict: item.verdict,
            severity: item.verdict === "MISSING" ? "CRITICAL" : "EVIDENCE",
          },
        ]
      : item.actions || [];
    const checks: ItemExpectation[] = [],
      questionSummary: string[] = [];
    const add = (
      kind: ItemExpectation["kind"],
      value: unknown,
      label: string,
    ) => {
      const v = clean(value);
      if (v && !checks.some((x) => x.kind === kind && x.value === v))
        checks.push({ kind, value: v, label });
    };
    for (const r of findings) {
      const c = r.checks || {},
        a = c.structuredAssessment;
      for (const url of c.links?.missing || [])
        if (safeWebUrl(url)) add("url", url, "Source link not observed");
      if (a) {
        if (a.unmatchedSourceQuestions?.length)
          questionSummary.push(
            `Unmatched package question(s): ${a.unmatchedSourceQuestions.join(", ")}. Check placement and intended inclusion before adding them.`,
          );
        if (
          a.sourceMediaQuestionNumbers?.length &&
          a.questionMediaStatus !== "VERIFIED"
        )
          questionSummary.push(
            `Check media in source question(s): ${a.sourceMediaQuestionNumbers.join(", ")}. Question text alignment does not verify the images.`,
          );
        const source = sourceFor(r, nodes);
        const questions =
          source?.sourcePayload?.structuredAssessment?.questions || [];
        for (const ordinal of a.unmatchedSourceQuestions || [])
          add(
            "prompt",
            questions[Number(ordinal) - 1]?.prompt,
            `Package question ${ordinal}`,
          );
        for (const ordinal of a.sourceMediaQuestionNumbers || []) {
          for (const ref of questions[Number(ordinal) - 1]?.mediaRefs || [])
            if (typeof ref === "string")
              add("file", ref, `Source question ${ordinal} media reference`);
        }
      }
      for (const missing of c.assets?.missing || [])
        add(
          "file",
          typeof missing === "string"
            ? missing
            : missing.name || missing.path || missing.href,
          "Source file not observed",
        );
    }
    for (const claim of result.currentStateResolution?.resolutions || []) {
      if (
        !id ||
        String(claim.currentItemId || "") !== id ||
        typeof claim.target !== "string"
      )
        continue;
      if (/UNRESOLVED_SOURCE_ASSET/.test(claim.claimType || ""))
        add("file", claim.target, "Attachment named in ingestion finding");
      if (/BROKEN_LINK/.test(claim.claimType || "") && safeWebUrl(claim.target))
        add("url", claim.target, "Link named in ingestion finding");
    }
    const questionComparisons = (findings.length ? findings : [{}])
      .map((r) => questionComparison(r, sourceFor(r, nodes), { ...item, id }))
      .filter((row): row is QuestionComparison => row !== null);
    return {
      sourceTargets: findings
        .map((r) => sourceContentTarget(r, sourceFor(r, nodes)))
        .filter(
          (r, i, all) =>
            r.sourceKey &&
            all.findIndex((x) => x.sourceKey === r.sourceKey) === i,
        ),
      questionComparisons,
      key: sourceOnly
        ? `source:${index}:${item.path}:${item.name}`
        : `item:${id || index}`,
      id,
      name: item.name || "Unnamed item",
      path: item.path || "Placement not recorded",
      type: item.type || "Source item",
      status: sourceOnly
        ? item.verdict === "MISSING"
          ? "REPAIR_OR_CONFIRM"
          : "EVIDENCE_NEEDED"
        : item.status,
      actions: actions.filter(
        (a: EvidenceObject, i: number, list: EvidenceObject[]) =>
          list.findIndex(
            (x) => x.action === a.action && x.verdict === a.verdict,
          ) === i,
      ),
      findings,
      sources: uniqueSources,
      excerpt: item.excerpt || "",
      url: courseraItemUrl(result, id, override),
      questionSummary,
      checks,
      sourceOnly,
      pluginTargets: [
        ...new Set(
          [
            ...(item.pluginTargets || []),
            ...findings.flatMap((r) =>
              r.checks?.externalWebpageEvidence?.configurationMarkerObserved
                ? r.checks.externalWebpageEvidence.capturedUrls || []
                : [],
            ),
          ]
            .map((x) => safeWebUrl(typeof x === "string" ? x : x?.url))
            .filter(Boolean),
        ),
      ] as string[],
    };
  };
  return [
    ...(result.ownerView?.items || []).map((x: EvidenceObject, i: number) =>
      make(x, false, i),
    ),
    ...(result.ownerView?.unmappedSource || []).map(
      (x: EvidenceObject, i: number) => make(x, true, i),
    ),
  ];
}
export function needsOwnerAction(task: OwnerTask) {
  return (
    task.status !== "VERIFIED_EVIDENCE" ||
    task.actions.some((a) => a.severity && a.severity !== "NONE")
  );
}
export function validateOwnerReview(review: OwnerReview) {
  if (review.courseraLinkedCaptures != null)
    validateCourseraLinkedCaptures(review.courseraLinkedCaptures);
  if (review.sourceCaptures != null) {
    if (
      !Array.isArray(review.sourceCaptures) ||
      review.sourceCaptures.length > 100
    )
      throw new Error("Invalid source captures.");
    const seen = new Set<string>();
    for (const capture of review.sourceCaptures) {
      validateSourceQuestionCapture(capture);
      if (seen.has(capture.sourceKey))
        throw new Error("Duplicate source capture.");
      seen.add(capture.sourceKey);
    }
  }
  if (review.sourceCounts != null)
    validateReviewedSourceCounts(review.sourceCounts);
  if (
    review.pluginCaptures != null &&
    (!Array.isArray(review.pluginCaptures) ||
      review.pluginCaptures.length > 12 ||
      review.pluginCaptures.some(
        (p) =>
          p?.kind !== "CTI_PLUGIN_PAGE_CHECK" ||
          p.notForCourseAudit !== true ||
          typeof p.text !== "string" ||
          p.text.length > 48000,
      ))
  )
    throw new Error("Invalid plugin-page evidence.");
  if (
    !["open", "in_progress", "changed", "checked", "blocked"].includes(
      review.status,
    )
  )
    throw new Error("Choose a review outcome.");
  if (review.note.length > 6000)
    throw new Error("Keep the review note under 6,000 characters.");
  if (
    ["changed", "checked", "blocked"].includes(review.status) &&
    review.note.trim().length < 10
  )
    throw new Error(
      "Add a short note describing what you checked, changed, or could not resolve.",
    );
}
