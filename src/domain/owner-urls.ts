import type { EvidenceObject } from "./workspace-types.ts";

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
    typedItem: !!item,
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
  evidence?: EvidenceObject,
) {
  const course = ownerCourseLocation(result, override);
  if (!course || !/^[A-Za-z0-9_-]+$/.test(id)) return "";
  const item =
    evidence ||
    (result.ownerView?.items || []).find(
      (row: EvidenceObject) => String(row.id) === id,
    ) ||
    {};
  const crawl = result.stats?.extractorMeta?.activeSpaCrawl || {};
  const diagnostics = [crawl.targetDiagnostics, crawl.retryDiagnostics]
    .flatMap((rows) => (Array.isArray(rows) ? rows : []))
    .filter((row) => row && String(row.id) === id);
  const payload = item.payload || {};
  const routes = [
    item.url,
    payload.readingEditorEvidence?.route,
    payload.pluginEvidence?.route,
    payload.nativeAssignment?.route,
    ...diagnostics.flatMap((diag) => [
      diag.typedEditorRecovery?.route,
      diag.readingRouteRecovery?.route,
      diag.route,
    ]),
    course.url,
  ];
  // A query-string itemId can leave Coursera on the outline. Only typed,
  // course-and-item-bound routes qualify as observed item destinations.
  for (const value of routes) {
    const route = courseraLocation(value);
    if (
      route?.typedItem &&
      route.courseId === course.courseId &&
      route.itemId === id
    )
      return route.url;
  }
  // These route families are established by extractor navigation/captures.
  // A generic Assignment may be several editor types: do not guess it.
  const types: Record<string, string> = {
    supplement: "supplement",
    reading: "supplement",
    ungradedWidget: "plugin",
    plugin: "plugin",
    discussionPrompt: "discussionPrompt",
    discussion: "discussionPrompt",
    ungradedAssignment: "project",
  };
  const key = [
    String(item.typeName || ""),
    String(item.type || "").toLowerCase(),
  ].find((value) => Object.hasOwn(types, value));
  const type = key ? types[key] : "";
  return type ? `${course.base}/item/${type}/${id}` : "";
}
