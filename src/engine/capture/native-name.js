import { bindDirectIdentityV1 } from "../../extractors/coursera/direct-data-models.js";

// An authored name is a matching observation, never proof of content parity.
// Keep the material inventory name and draft/published namespaces independent.
export function retainedNativeNameEvidence(item, courseId) {
  try {
    const sources = item?.payload?.directDataSources;
    const branch =
      sources?.relation?.elements?.[0]?.branchRelationMap?.[
        courseId + "~" + item.id
      ];
    const bound = bindDirectIdentityV1(
      item,
      courseId,
      branch?.courseSlug,
      sources?.atom,
      sources?.relation,
    );
    if (
      !["atom", "relation"].every(
        (k) =>
          sources.receipts?.[k]?.status === 200 &&
          sources.receipts[k].id === item.atomId,
      )
    )
      return null;
    const draftName = bound.atom.draft?.name;
    if (
      typeof draftName !== "string" ||
      !draftName.trim() ||
      item.name !== draftName
    )
      return null;
    return {
      itemId: item.id,
      atomId: item.atomId,
      courseId,
      name: draftName,
      scope: "RETAINED_AUTHORING_DRAFT_NAME",
      materialName: item.sourceIdentity?.materialName ?? null,
      publishedName: bound.atom.published?.name ?? null,
      observedAt: sources.receipts.atom.observedAt ?? null,
      completeContent: false,
    };
  } catch {
    return null;
  }
}
