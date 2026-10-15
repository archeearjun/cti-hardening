import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import { sanitizeCourseraCourseDataModel } from "./direct-data-privacy.js";
import { bindDirectAuthoringDraftV1 } from "./direct-data-models.js";
import { directReceiptSourceValidV1, directWidgetProviderReceiptValidV1 } from "./direct-data-contracts.js";
import { directDraftWidgetProviderV1, directWidgetProviderTargetsV1 } from "./direct-data-widget.js";
import { directPanoptoAutomaticTargetV1 } from "./direct-data-panopto.js";
import { directPanoptoRequestFormV1 } from "./direct-data-panopto-contracts.js";

export const CTI_PROVIDER_ACCESS_DIAGNOSTIC_MAX_BYTES_V1 = 1024 * 1024;

/** Browser fetch rejection alone does not distinguish CORS from connectivity.
 * An enforced CSP conclusion requires the reader's exact-request policy event. */
export function directProviderAccessOutcomeV1(receipt) {
  const d = receipt?.diagnostics, status = receipt?.status;
  if (!d || d.schemaVersion !== 1 || typeof d.policyEventsAvailable !== "boolean" ||
      !Number.isSafeInteger(d.httpStatus) || d.httpStatus !== status || status < 0 || status > 599 ||
      !["UNKNOWN", "HTTP_OBSERVED", "ENFORCED_CSP", "CSP_REPORTED_FOR_ORIGIN", "TIMEOUT", "ABORTED", "CORS_OR_NETWORK"].includes(d.outcome))
    throw Error("PROVIDER_ACCESS_DIAGNOSTIC_OUTCOME_INVALID");
  const csp = d.enforcedCsp, related = d.relatedEnforcedCsp ?? null;
  if (csp !== null && (!csp || csp.disposition !== "enforce" ||
      !["connect-src", "default-src"].includes(csp.effectiveDirective) || !d.policyEventsAvailable))
    throw Error("PROVIDER_ACCESS_DIAGNOSTIC_CSP_INVALID");
  if (related !== null && (!related || related.disposition !== "enforce" ||
      !["connect-src", "default-src"].includes(related.effectiveDirective) ||
      related.requestMatch !== "ORIGIN_ONLY" || !d.policyEventsAvailable))
    throw Error("PROVIDER_ACCESS_DIAGNOSTIC_CSP_INVALID");
  if ((d.outcome === "HTTP_OBSERVED" && status < 100) ||
      (d.outcome === "ENFORCED_CSP" && (!csp || status !== 0)) ||
      (d.outcome === "CSP_REPORTED_FOR_ORIGIN" && (!related || csp || status !== 0)) ||
      (["UNKNOWN", "CORS_OR_NETWORK"].includes(d.outcome) && (status !== 0 || csp)))
    throw Error("PROVIDER_ACCESS_DIAGNOSTIC_OUTCOME_CONTRADICTORY");
  const descriptions = {
    UNKNOWN: "The browser did not expose a specific access result.",
    HTTP_OBSERVED: "The browser exposed HTTP status " + status + ".",
    ENFORCED_CSP: "The browser reported an enforced " + (csp?.effectiveDirective || "") + " policy blocking this request.",
    CSP_REPORTED_FOR_ORIGIN: "The browser reported an enforced " + (related?.effectiveDirective || "") + " policy for this provider origin. The event did not identify the exact request.",
    TIMEOUT: "The bounded request timed out; this does not identify a CORS or authentication failure.",
    ABORTED: "The request was stopped before a complete result was available.",
    CORS_OR_NETWORK: "The browser could not expose the response. CORS policy and network failure cannot be distinguished from this result. An absent policy event does not rule out CSP.",
  };
  return { outcome: d.outcome, description: descriptions[d.outcome], httpStatus: status,
    enforcedCsp: csp, relatedEnforcedCsp: related, policyEventsAvailable: d.policyEventsAvailable };
}

/** @returns {{valid:boolean,reason:string,items:Array<any>}} */
export function directProviderAccessDiagnosticStructureV1(value) {
  const invalid = reason => ({ valid: false, reason, items: [] });
  try {
    if (value?.kind !== "CTI_PROVIDER_ACCESS_DIAGNOSTIC" || value.schemaVersion !== 1 ||
        value.contentCompletionVerified !== false || value.notForCourseAudit !== true ||
        value.sourceStabilityVerified !== false || value.bodyVerified !== false ||
        value.playbackVerified !== false || value.launchVerified !== false || value.wholeWidgetVerified !== false ||
        !/^[A-Z0-9_]{0,96}$/.test(value.stopReason ?? "") ||
        !Number.isFinite(Date.parse(value.checkedAt || "")) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(value.courseId || "") ||
        !/^[A-Za-z0-9-]+$/.test(value.courseSlug || "") ||
        !Array.isArray(value.items) || value.items.length > 100 ||
        !Array.isArray(value.nativeFailures) || value.nativeFailures.length > 100)
      return invalid("PROVIDER_ACCESS_DIAGNOSTIC_SCHEMA_INVALID");
    const page = new URL(value.pageUrl);
    if (page.origin !== "https://www.coursera.org" || page.username || page.password || page.hash || page.search ||
        !["/teach/" + value.courseSlug + "/" + value.courseId + "/content", "/teach/" + value.courseSlug + "/" + value.courseId + "/content/edit"]
          .includes(page.pathname.replace(/\/$/, ""))) return invalid("PROVIDER_ACCESS_DIAGNOSTIC_COURSE_INVALID");
    const sanitized = sanitizeCourseraCourseDataModel(value);
    if (sanitized.limitReached || sanitized.removedFields || sanitized.redactedUrls ||
        new TextEncoder().encode(JSON.stringify(value)).length > CTI_PROVIDER_ACCESS_DIAGNOSTIC_MAX_BYTES_V1)
      return invalid("PROVIDER_ACCESS_DIAGNOSTIC_PRIVATE_OR_OVERSIZED");
    const items = [], seen = new Set();
    for (const item of value.items) {
      const sources = item?.sources,
        fp = { id: item?.itemId, atomId: item?.atomId, contentId: "atom~" + item?.atomId },
        bound = bindDirectAuthoringDraftV1(fp, value.courseId, value.courseSlug, sources?.atom, sources?.relation),
        binding = directDraftWidgetProviderV1(bound), target = directPanoptoAutomaticTargetV1(item.targetUrl),
        request = item.request, receipt = request?.receipt;
      if (!target || binding.providerId !== item.providerId ||
          Object.keys(item).some(key => !["itemId", "atomId", "providerId", "targetUrl", "sources", "request"].includes(key)) ||
          !request || Object.keys(request).some(key => !["reason", "receipt"].includes(key)) ||
          !directReceiptSourceValidV1(sources.receipts?.atom, "authoringAtoms.v2", binding.atomId) ||
          !directReceiptSourceValidV1(sources.receipts?.relation, "authoringItemContentRelations.v1", binding.atomId) ||
          !directWidgetProviderReceiptValidV1(sources.receipts?.provider, binding) ||
          !["atom", "relation", "provider"].every(key => Number.isFinite(Date.parse(sources.receipts?.[key]?.observedAt || ""))) ||
          !["atom", "relation", "provider"].every(key => /^[a-f0-9]{64}$/.test(sources.hashes?.[key] || "")) ||
          !directWidgetProviderTargetsV1(bound, sources.provider).some(value => value.url === item.targetUrl) ||
          typeof request?.reason !== "string" || !/^[A-Z0-9_]{0,96}$/.test(request.reason))
        return invalid("PROVIDER_ACCESS_DIAGNOSTIC_SOURCE_BINDING_INVALID");
      if (receipt === null ? !request.reason :
          receipt?.resource !== "PanoptoDeliveryInfo" || receipt.id !== target.deliveryPublicId ||
          receipt.origin !== target.origin || receipt.targetUrl !== item.targetUrl || receipt.method !== "POST" ||
          receipt.requestPath !== "/Panopto/Pages/Viewer/DeliveryInfo.aspx" ||
          !Number.isFinite(Date.parse(receipt.observedAt || "")) ||
          directCanonicalSourceTextV1(receipt.requestForm) !== directCanonicalSourceTextV1(directPanoptoRequestFormV1(target.deliveryPublicId)))
        return invalid("PROVIDER_ACCESS_DIAGNOSTIC_SOURCE_BINDING_INVALID");
      const key = binding.itemId + "\n" + item.targetUrl;
      if (seen.has(key)) return invalid("PROVIDER_ACCESS_DIAGNOSTIC_DUPLICATE_TARGET");
      seen.add(key);
      items.push({ itemId: binding.itemId, atomId: binding.atomId, providerId: binding.providerId,
        targetUrl: item.targetUrl, observedAt: receipt?.observedAt || null, reason: request.reason,
        ...(receipt ? directProviderAccessOutcomeV1(receipt) : { outcome: "UNKNOWN", httpStatus: 0,
          description: "No provider request receipt was available. This does not identify an HTTP, CSP, CORS or network failure.",
          enforcedCsp: null, relatedEnforcedCsp: null, policyEventsAvailable: false }) });
    }
    for (const failed of value.nativeFailures)
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(failed?.itemId || "") ||
          !/^[A-Za-z0-9_-]{22}$/.test(failed.atomId || "") ||
          !/^[A-Z0-9_]{1,96}$/.test(failed.reason || "")) return invalid("PROVIDER_ACCESS_DIAGNOSTIC_NATIVE_FAILURE_INVALID");
    return { valid: true, reason: "", items };
  } catch (_) { return invalid("PROVIDER_ACCESS_DIAGNOSTIC_UNSUPPORTED"); }
}

/** This is a browser access observation, not an extraction/completion verdict. */
export function directProviderAccessDiagnosticTextV1(value) {
  const checked = directProviderAccessDiagnosticStructureV1(value);
  if (!checked.valid) throw Error(checked.reason);
  const lines = ["Panopto access diagnostic only", "Checked: " + value.checkedAt,
    "Course: " + value.courseId, "No course capture, media bytes, captions, playback or whole-widget completion is established by this report."];
  if (value.stopReason) lines.push("Check stopped: " + value.stopReason);
  for (const item of checked.items)
    lines.push("", "Item: " + item.itemId + "; provider: " + item.providerId,
      "Configured target: " + item.targetUrl, "Request observed: " + (item.observedAt || "no request receipt"),
      item.description, "Reader result: " + (item.reason || "No additional reader error code; response content is omitted from this diagnostic."));
  for (const failure of value.nativeFailures)
    lines.push("", "Item: " + failure.itemId + "; native source check failed: " + failure.reason + ". No provider request was authorized for this item.");
  return lines.join("\n");
}

/** Separate download only. No response body, course checkpoint or completion
 * assertion belongs to this diagnostic. Validation recomputes the source joins. */
export function directProviderAccessDiagnosticV1(input) {
  const value = { kind: "CTI_PROVIDER_ACCESS_DIAGNOSTIC", schemaVersion: 1,
    courseId: input.courseId, courseSlug: input.courseSlug, pageUrl: input.pageUrl,
    checkedAt: input.checkedAt, stopReason: input.stopReason || "", items: input.items, nativeFailures: input.nativeFailures || [],
    notForCourseAudit: true, contentCompletionVerified: false, sourceStabilityVerified: false,
    bodyVerified: false, playbackVerified: false, launchVerified: false, wholeWidgetVerified: false };
  const checked = directProviderAccessDiagnosticStructureV1(value);
  if (!checked.valid) throw Error(checked.reason);
  return value;
}
