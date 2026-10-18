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

/** A CML selector includes its requested version; the response has only a base
 * ID. Never turn that base ID into a claim that the response echoed a version. */
export function directInlineWidgetProviderSourceV1(binding, model) {
  const match = /^([A-Za-z0-9_-]{22})@([1-9]\d{0,11})$/.exec(binding?.providerId || ""),
    provider = model?.elements?.[0], sanitized = sanitizeCourseraCourseDataModel(model);
  if (!match || binding.providerBaseId !== match[1] || binding.requestedVersion !== match[2] ||
      binding.sourceState !== "AUTHORING_DRAFT" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(binding.courseId || "") ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(binding.itemId || "") ||
      !/^[A-Za-z0-9_-]{22}$/.test(binding.atomId || "") ||
      !Array.isArray(model?.elements) || model.elements.length !== 1 ||
      provider?.id !== match[1] || !provider.draft || typeof provider.draft !== "object" || Array.isArray(provider.draft) ||
      typeof provider.metadata?.updatedAt !== "number" || !Number.isFinite(provider.metadata.updatedAt) ||
      !Array.isArray(provider.owners) || !provider.owners.length || provider.owners.length > 64 ||
      provider.owners.some(owner => typeof owner !== "string" || owner.length > 256) ||
      new Set(provider.owners).size !== provider.owners.length ||
      !provider.owners.includes("COURSE~" + binding.courseId) ||
      provider.owners.some(owner => owner.startsWith("COURSE~") && owner !== "COURSE~" + binding.courseId) ||
      (provider.courseId !== undefined && provider.courseId !== binding.courseId) ||
      (model.paging !== undefined && (!model.paging || typeof model.paging !== "object" || Array.isArray(model.paging) ||
        Object.keys(model.paging).some(key => key !== "next") || model.paging.next != null)) ||
      sanitized.limitReached || sanitized.removedFields || sanitized.redactedUrls)
    throw Error("DIRECT_INLINE_WIDGET_PROVIDER_MODEL_UNSUPPORTED");
  return {id: provider.id, requestedProviderId: binding.providerId,
    versionBinding: "REQUEST_SELECTOR_ONLY", owners: provider.owners,
    draft: provider.draft, updatedAt: provider.metadata.updatedAt};
}

/** Inline configuration targets remain separate from page bodies and runtime. */
export function directInlineWidgetProviderTargetsV1(binding, model) {
  const source = directInlineWidgetProviderSourceV1(binding, model), targets = [];
  for (const [sourceField, value] of [
    ["draft.configuration.url", source.draft.configuration?.url],
    ["draft.pageSrc", source.draft.pageSrc],
  ]) {
    if (typeof value !== "string" || !value || value.length > 8192 || value.trim() !== value) continue;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
      targets.push({url: value, sourceField, providerId: binding.providerId,
        providerBaseId: binding.providerBaseId, requestedVersion: binding.requestedVersion,
        versionBinding: "REQUEST_SELECTOR_ONLY", courseId: binding.courseId,
        itemId: binding.itemId, atomId: binding.atomId,
        bodyVerified: false, playbackVerified: false, launchVerified: false});
    } catch (_) { /* Unrecognized values remain only in the original native model. */ }
  }
  return targets;
}
