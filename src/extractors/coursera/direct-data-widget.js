import { sanitizeCourseraCourseDataModel } from "./direct-data-privacy.js";

// Exact finder/projection observed in the authoring widget configuration UI.
// Linked summaries contain format examples, never this item's source targets.
export const CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1 = "draft,isPublished,metadata,owners,id,authoringWidgetSummaries.v1(name,description,configurationExamples,gradingType,pluginType)";
export const CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1 = "widgetSummary";

/** The provider is selected only by this item's bound, current native draft. */
export function directDraftWidgetProviderV1(bound) {
  const providerId = bound?.draft?.content?.definition?.providerId;
  if (bound?.sourceState !== "AUTHORING_DRAFT" ||
      bound?.draft?.content?.typeName !== "widgetDraft" ||
      typeof providerId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(providerId) ||
      typeof bound.courseId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(bound.courseId) ||
      typeof bound.itemId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(bound.itemId) ||
      typeof bound.atomId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(bound.atomId))
    throw Error("DIRECT_WIDGET_PROVIDER_BINDING_FAILED");
  return {providerId, courseId: bound.courseId, itemId: bound.itemId,
    atomId: bound.atomId, sourceState: "AUTHORING_DRAFT"};
}

/** Preserve the selected native draft, separately from linked summary examples.
 * The finder course selector is receipt evidence; the response does not itself
 * assert item or course ownership. The current atom/relation supplies that join.
 */
export function directWidgetProviderSourceV1(bound, model) {
  const binding = directDraftWidgetProviderV1(bound),
    elements = model?.elements, provider = elements?.[0], paging = model?.paging,
    sanitized = sanitizeCourseraCourseDataModel(model);
  if (!Array.isArray(elements) || elements.length !== 1 ||
      !provider || provider.id !== binding.providerId ||
      !provider.draft || typeof provider.draft !== "object" || Array.isArray(provider.draft) ||
      typeof provider.metadata?.updatedAt !== "number" || !Number.isFinite(provider.metadata.updatedAt) ||
      (paging !== undefined && (!paging || typeof paging !== "object" || Array.isArray(paging) ||
        Object.keys(paging).some(key => key !== "next") || paging.next != null)) ||
      sanitized.limitReached || sanitized.removedFields || sanitized.redactedUrls ||
      (provider.courseId !== undefined && provider.courseId !== binding.courseId))
    throw Error("DIRECT_WIDGET_PROVIDER_MODEL_UNSUPPORTED");
  return {id: provider.id, draft: provider.draft, updatedAt: provider.metadata.updatedAt};
}

/** Recorded targets are not fetched, launched, or treated as external bodies. */
export function directWidgetProviderTargetsV1(bound, model) {
  const binding = directDraftWidgetProviderV1(bound),
    source = directWidgetProviderSourceV1(bound, model), targets = [];
  for (const [sourceField, value] of [
    ["draft.configuration.url", source.draft.configuration?.url],
    ["draft.pageSrc", source.draft.pageSrc],
  ]) {
    if (typeof value !== "string" || !value || value.length > 8192 || value.trim() !== value) continue;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
      targets.push({url: value, sourceField, providerId: binding.providerId,
        courseId: binding.courseId, itemId: binding.itemId, atomId: binding.atomId,
        bodyVerified: false, playbackVerified: false, launchVerified: false});
    } catch (_) { /* Unsupported target syntax remains in its raw source model. */ }
  }
  return targets;
}
