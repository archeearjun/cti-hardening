import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../../extractors/coursera/direct-data-canonical.js";
import { directSourceBindingEvidenceV1 } from "../../extractors/coursera/direct-data-contracts.js";
import { bindDirectAuthoringDraftV1 } from "../../extractors/coursera/direct-data-models.js";

/** A retained, independently rebound native setting. This is neither a grader
 * capability nor proof of a complete assessment, learner playback or source
 * course policy. Published snapshots and similarly named items are not used. */
export function inspectDirectNativeGrading(item, expectedCourseId) {
  try {
    const object = (value) =>
      value && typeof value === "object" && !Array.isArray(value);
    const payload = item?.payload,
      sources = payload?.directDataSources,
      claimed = payload?.directDataEvidence;
    if (
      !object(payload) ||
      !object(sources) ||
      !object(claimed) ||
      typeof expectedCourseId !== "string" ||
      !expectedCourseId ||
      claimed.courseId !== expectedCourseId
    )
      return null;
    const relation = sources.relation?.elements?.[0],
      courseId = claimed.courseId,
      branch = relation?.branchRelationMap?.[courseId + "~" + item.id];
    const bound = bindDirectAuthoringDraftV1(
      item,
      courseId,
      branch?.courseSlug,
      sources.atom,
      sources.relation,
    );
    const proof = directSourceBindingEvidenceV1(item, bound),
      content = bound.draft.content,
      configuration = content?.definition?.configuration;
    if (
      !proof ||
      content?.typeName !== "staffGradedDraft" ||
      !object(configuration) ||
      !Object.prototype.hasOwnProperty.call(configuration, "isGraded") ||
      typeof configuration.isGraded !== "boolean" ||
      Object.keys(proof).some((key) => claimed[key] !== proof[key]) ||
      (item.courseId !== undefined && item.courseId !== courseId)
    )
      return null;
    const canonical = directCanonicalSourceTextV1(bound.draft);
    if (
      bytesToHex(sha256(new TextEncoder().encode(canonical))) !==
      proof.draftHash
    )
      return null;
    // The source model is authoritative. A conflicting convenient projection
    // invalidates this bridge rather than silently choosing either setting.
    const projected = payload.structuredAssessment?.configuration;
    let projectionConflict = false;
    if (projected !== undefined) {
      try {
        projectionConflict =
          directCanonicalSourceTextV1(projected) !==
          directCanonicalSourceTextV1(configuration);
      } catch (_) {
        projectionConflict = true;
      }
    }
    const observedAt = sources.receipts?.atom?.observedAt;
    const validObservedAt =
      typeof observedAt === "string" &&
      Number.isFinite(Date.parse(observedAt)) &&
      new Date(observedAt).toISOString() === observedAt;
    const observation = {
      ...proof,
      scope: "GRADING_SETTING_ONLY",
      field: "draft.content.definition.configuration.isGraded",
      graded: configuration.isGraded,
      ...(validObservedAt ? { observedAt } : {}),
    };
    return { observation, projectionConflict };
  } catch (_) {
    return null;
  }
}

/** Read-only display gets a setting only when the retained native binding and
 * any captured configuration projection agree. Inspection retains a distinct
 * conflict signal so comparison cannot fall back to a contradictory DOM alias. */
export function observeDirectNativeGrading(item, expectedCourseId) {
  const inspected = inspectDirectNativeGrading(item, expectedCourseId);
  return inspected && !inspected.projectionConflict
    ? inspected.observation
    : null;
}
