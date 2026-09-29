import { cleanOwnerText as clean } from "./owner-text.ts";
import type { EvidenceObject } from "./workspace-types.ts";
import { safeWebUrl } from "./owner-urls.ts";

/** Navigation URLs are separate from captured document and launch evidence. */
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
