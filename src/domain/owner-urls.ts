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
