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
  checks: ItemExpectation[];
  sourceOnly: boolean;
}
export interface ItemExpectation {
  kind: "url" | "file" | "prompt";
  value: string;
  label: string;
}
export function safeWebUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export function courseraLocation(value: unknown) {
  const url = safeWebUrl(value);
  if (!url) return null;
  const u = new URL(url);
  if (u.protocol !== "https:" || !/^(www\.)?coursera\.org$/.test(u.hostname))
    return null;
  const match = u.pathname.match(
    /^\/teach\/([^/]+)\/([A-Za-z0-9_-]+)\/content(?:\/|$)/,
  );
  if (!match) return null;
  const item = u.pathname.match(
    /\/content\/item\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\/?$/,
  );
  return {
    courseId: match[2],
    base: `${u.origin}/teach/${match[1]}/${match[2]}/content`,
    itemId: item?.[1] || u.searchParams.get("itemId") || "",
    url,
  };
}
export function ownerCourseLocation(result: EvidenceObject, override = "") {
  const m = result.stats?.extractorMeta || {};
  return (
    courseraLocation(m.page?.url) ||
    courseraLocation(m.activeSpaCrawl?.originalUrl) ||
    courseraLocation(override)
  );
}
export function courseraItemUrl(
  result: EvidenceObject,
  id: string,
  override = "",
) {
  const course = ownerCourseLocation(result, override);
  if (!course || !/^[A-Za-z0-9_-]+$/.test(id)) return "";
  const crawl = result.stats?.extractorMeta?.activeSpaCrawl || {};
  for (const diag of [
    ...(crawl.targetDiagnostics || []),
    ...(crawl.retryDiagnostics || []),
  ]) {
    if (String(diag.id) !== id) continue;
    for (const value of [
      diag.route,
      diag.typedEditorRecovery?.route,
      diag.readingRouteRecovery?.route,
    ]) {
      const route = courseraLocation(value);
      if (route?.courseId === course.courseId && route.itemId === id)
        return route.url;
    }
  }
  // Observed authoring outline route accepts the stable item ID, including item
  // types whose typed editor path was not captured. Never guess an editor type.
  return `${course.base}/edit?itemId=${encodeURIComponent(id)}`;
}
const clean = (v: unknown) =>
  String(v || "")
    .replace(/\s+/g, " ")
    .trim();
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
        questionSummary.push(
          `${r.sourceName}: ${a.alignedQuestionCount ?? "?"} aligned · ${a.sourceQuestionCount ?? "?"} package questions · ${a.courseraQuestionCount ?? "?"} Coursera questions`,
        );
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
    return {
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

/** Small navigation context only; the full source capture remains independent. */
export function buildOwnerContext(brightspace?: Uint8Array) {
  if (!brightspace) return undefined;
  const data = JSON.parse(new TextDecoder().decode(brightspace));
  const base = safeWebUrl(data.page?.url);
  const topics: EvidenceObject[] = [];
  const walk = (nodes: EvidenceObject[], path: string) => {
    for (const node of nodes || []) {
      let url = "";
      try {
        url = safeWebUrl(
          new URL(
            node.contentEvidence?.documentUrl || node.url || "",
            base || undefined,
          ).href,
        );
      } catch {
        /* No observed source URL. */
      }
      if (node.url || node.contentEvidence?.documentUrl)
        topics.push({
          id: String(node.id || ""),
          name: node.title || node.name || "",
          path,
          url,
        });
      walk(
        node.children || node.topics || [],
        [path, node.title || node.name].filter(Boolean).join(" > "),
      );
    }
  };
  walk(data.contentTree || [], "");
  return { schemaVersion: 1, sourceCourseUrl: base, sourceTopics: topics };
}
