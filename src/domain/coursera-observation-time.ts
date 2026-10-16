import type { WorkspaceRecord } from "./workspace-types.ts";

/** Effective course-content observation time for edit reconciliation. The
 * capture/export date stays unchanged in the retained report. Media/provider
 * continuations deliberately reuse earlier readings and assessment definitions,
 * so a later export cannot establish a new observation of those sources. */
export function courseraContentObservedAt(
  audit: WorkspaceRecord | null,
): string {
  const meta = audit?.data.result?.stats?.extractorMeta;
  const exportedAt =
    typeof meta?.capturedAt === "string"
      ? Date.parse(meta.capturedAt)
      : Number.NaN;
  if (!Number.isFinite(exportedAt)) return "";
  const enrichment = meta?.directDataCapture?.mediaEnrichment;
  const retainsContent =
    enrichment &&
    typeof enrichment === "object" &&
    (enrichment.retainedAssessmentObservations === true ||
      (typeof enrichment.scope === "string" && enrichment.scope.length > 0));
  if (!retainsContent) return new Date(exportedAt).toISOString();
  const base =
    typeof enrichment.baseSourceCapturedAt === "string"
      ? Date.parse(enrichment.baseSourceCapturedAt)
      : Number.NaN;
  return Number.isFinite(base)
    ? new Date(Math.min(exportedAt, base)).toISOString()
    : "";
}
