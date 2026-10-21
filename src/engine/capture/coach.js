import { sanitizeCourseraCourseDataModel } from "../../extractors/coursera/direct-data-privacy.js";
/** A retained Coach observation, never a content-completeness certificate.
 * Native inventory verification remains independent of these body observations. */
export function retainedNativeCoachEvidence(item, courseId) {
  var p = (item && item.payload) || {},
    s = p.directDataSources;
  if (
    String((item && (item.typeName || item.type)) || "").toLowerCase() !==
      "coach" ||
    !courseId ||
    !s
  )
    return null;
  var atoms = s.atom && s.atom.elements,
    relations = s.relation && s.relation.elements;
  if (
    !Array.isArray(atoms) ||
    atoms.length !== 1 ||
    !Array.isArray(relations) ||
    relations.length !== 1
  )
    return null;
  var atom = atoms[0],
    relation = relations[0],
    id = String(item.id || ""),
    atomId = String(item.atomId || "");
  var branch =
    relation.branchRelationMap &&
    relation.branchRelationMap[courseId + "~" + id];
  if (
    !id ||
    !atomId ||
    item.contentId !== "atom~" + atomId ||
    atom.id !== atomId ||
    atom.contentId !== item.contentId ||
    relation.id !== atomId ||
    relation.atomId !== atomId ||
    !branch ||
    branch.itemId !== id ||
    branch.courseId !== courseId
  )
    return null;
  var receipts = s.receipts || {};
  if (
    !["atom", "relation"].every(function (k) {
      return (
        receipts[k] && receipts[k].status === 200 && receipts[k].id === atomId
      );
    })
  )
    return null;
  var draft = atom.draft,
    published = atom.published;
  if (
    (draft && draft.content && draft.content.typeName !== "coachDraft") ||
    (published && published.content && published.content.typeName !== "coach")
  )
    return null;
  var activity =
    draft &&
    draft.content &&
    draft.content.definition &&
    draft.content.definition.coachActivity;
  // Retain authoring values and published pointers separately. The display
  // override is an observation, not proof of the referenced published body.
  var clean = sanitizeCourseraCourseDataModel({
    draft: draft,
    published: published,
  });
  if (clean.limitReached) return null;
  return {
    schemaVersion: 1,
    scope: "RETAINED_COACH_OBSERVATION",
    itemId: id,
    atomId: atomId,
    courseId: courseId,
    bindingStatus: "CONSISTENT_RETAINED_IDS",
    completeContent: false,
    publishedBodyVerified: false,
    draftSchemaId: (activity && activity.coachActivitySchemaId) || null,
    publishedDisplayType:
      (published && published.customDisplayTypenameOverride) || null,
    draftFieldPresent: Object.hasOwn(atom, "draft"),
    publishedFieldPresent: Object.hasOwn(atom, "published"),
    storedAtomVersion: atom.storedAtomVersion,
    status: atom.status ? JSON.parse(JSON.stringify(atom.status)) : null,
    draft: draft === undefined ? undefined : clean.data.draft,
    published: published === undefined ? undefined : clean.data.published,
    observedAt: receipts.atom.observedAt || "",
    captureStatus: (p.captureContract && p.captureContract.status) || "",
    privacy: {
      removedFields: clean.removedFields,
      redactedUrls: clean.redactedUrls,
    },
    reasons: (p.captureContract && Array.isArray(p.captureContract.reasons)
      ? p.captureContract.reasons
      : []
    ).filter(function (r) {
      return typeof r === "string";
    }),
  };
}
