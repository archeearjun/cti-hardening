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
  pluginTargets: string[];
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

/** Navigation URLs are separate from the captured document/launch evidence. */
export function normalizeOwnerContext(context: EvidenceObject = {}) {
  const captured = safeWebUrl(context.sourcePageUrl || context.sourceCourseUrl);
  const origin = safeWebUrl(context.sourceOrigin) || captured;
  if (!origin) return context;
  const host = new URL(origin).origin;
  const topics: EvidenceObject[] = context.sourceTopics || [];
  const ids = new Set<string>();
  const explicit = String(context.sourceOrgUnitId || "");
  if (/^\d+$/.test(explicit)) ids.add(explicit);
  // Older saved reports retained topic URLs but not the org-unit ID. Recover
  // only an unambiguous same-origin ID; never guess from course titles.
  for (const value of [
    captured,
    ...topics.map((t) => t.documentUrl || t.url),
  ]) {
    try {
      const u = new URL(value);
      if (u.origin !== host) continue;
      const id =
        u.searchParams.get("ou") ||
        u.pathname.match(
          /^\/d2l\/(?:home|le\/(?:content|lessons))\/(\d+)(?:\/|$)/,
        )?.[1] ||
        u.pathname.match(/^\/content\/enforced\/(\d+)[-/]/)?.[1];
      if (id && /^\d+$/.test(id)) ids.add(id);
    } catch {
      /* This field is not a navigable URL. */
    }
  }
  const org = ids.size === 1 ? [...ids][0] : "";
  const genericApp = /\/d2l\/ui\/apps\//.test(captured);
  const courseUrl = org
    ? `${host}/d2l/home/${org}`
    : genericApp
      ? ""
      : captured;
  return {
    ...context,
    schemaVersion: 2,
    sourcePageUrl: captured,
    sourceOrigin: host,
    sourceOrgUnitId: org,
    sourceCourseUrl: courseUrl,
    sourceTopics: topics.map((t) => {
      const documentUrl = safeWebUrl(t.documentUrl || t.url);
      const id = String(t.id || "");
      // A content topic opens with its LMS context, including Quicklinks and
      // relative dependencies. Keep the original file/target available too.
      const url =
        org && /^\d+$/.test(id)
          ? `${host}/d2l/le/content/${org}/viewContent/${id}/View`
          : documentUrl;
      return {
        ...t,
        url,
        documentUrl,
        navigationEvidence:
          org && /^\d+$/.test(id)
            ? "CAPTURED_ORG_AND_TOPIC_IDS"
            : "CAPTURED_DOCUMENT_URL",
      };
    }),
  };
}

/** Small navigation context only; the full source capture remains independent. */
export function buildOwnerContext(
  brightspace?: Uint8Array,
  mappings: EvidenceObject[] = [],
) {
  if (!brightspace) return undefined;
  const data = JSON.parse(new TextDecoder().decode(brightspace));
  const base = safeWebUrl(data.page?.url);
  const topics: EvidenceObject[] = [];
  const walk = (nodes: EvidenceObject[], path: string) => {
    for (const node of nodes || []) {
      let documentUrl = "";
      const raw = node.contentEvidence?.documentUrl || node.url;
      if (raw)
        try {
          // Resolve from the document URL when present, never an empty string
          // which would silently turn a missing link into the generic app URL.
          documentUrl = safeWebUrl(new URL(raw, base || undefined).href);
        } catch {
          /* No observed source URL. */
        }
      if (node.kind === "TOPIC" || raw)
        topics.push({
          id: String(node.id || ""),
          name: node.title || node.name || "",
          path,
          url: documentUrl,
          documentUrl,
        });
      walk(
        node.children || node.topics || [],
        [path, node.title || node.name].filter(Boolean).join(" > "),
      );
    }
  };
  walk(data.contentTree || [], "");
  return normalizeOwnerContext({
    schemaVersion: 2,
    sourcePageUrl: base,
    sourceCourseUrl: base,
    sourceOrigin: data.page?.origin,
    sourceOrgUnitId: String(data.course?.orgUnitId || ""),
    sourceTopics: topics,
    sourceTopicMappings: mappings,
  });
}

/** Navigation identity is separate from fidelity. Never pick the first same-title
 * item, or turn an unresolved item link into a course-home link. */
export function resolveSourceTopic(
  source: EvidenceObject,
  context: EvidenceObject,
) {
  const topics: EvidenceObject[] = context.sourceTopics || [];
  const key = (value: unknown) => clean(value).toLowerCase();
  const path = (value: unknown) =>
    String(value || "")
      .split(">")
      .map(key)
      .filter(Boolean);
  const sourcePath = path(source.path);
  const area = (value: unknown) =>
    path(value).find((p) => p === "archive" || p === "instructor resources") ||
    "learner";
  const sourceId = String(source.idref || source.id || "");
  const mappings = (context.sourceTopicMappings || []).filter(
    (m: EvidenceObject) =>
      m.navigationEligible === true &&
      key(m.sourceName) === key(source.title) &&
      key(m.sourcePath) === key(source.path) &&
      (!sourceId || !m.sourceId || String(m.sourceId) === sourceId),
  );
  if (mappings.length) {
    const ids = new Set(mappings.map((m: EvidenceObject) => String(m.topicId)));
    const matches = topics.filter((t) => ids.has(String(t.id)));
    return ids.size === 1 && matches.length === 1 ? matches[0] : null;
  }
  const candidates = topics.filter(
    (t) =>
      key(t.name) === key(source.title) && area(t.path) === area(source.path),
  );
  const exact = candidates.filter((t) => key(t.path) === key(source.path));
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  // Older reports: accept one matching title beneath the exact module ancestry.
  // This covers an inserted Assess folder without mixing in Archive copies.
  const descendants = candidates.filter((t) => {
    const parts = path(t.path);
    return (
      sourcePath.length > 0 &&
      parts.length > sourcePath.length &&
      sourcePath.every((p, i) => parts[i] === p)
    );
  });
  if (descendants.length)
    return descendants.length === 1 ? descendants[0] : null;
  return candidates.length === 1 ? candidates[0] : null;
}
