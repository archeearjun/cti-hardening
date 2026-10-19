import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";

export const CTI_DIRECT_AUTHORING_SNAPSHOT_PARTS_V1 = 100;
export const CTI_DIRECT_AUTHORING_SNAPSHOT_FAILURES_V1 = 301;

/** An attached draft is an observed source on a published atom. It is never
 * relabelled as the current published assignment or an editable current draft. */
export function bindDirectPublishedDraftSnapshotV1(fp, courseId, slug, material, atomData, relationData) {
  const object = value => !!value && typeof value === "object" && !Array.isArray(value),
    atomKey = value => typeof value === "string" && /^[A-Za-z0-9_-]{22}$/.test(value),
    fail = code => { throw Error("DIRECT_AUTHORING_SNAPSHOT_" + code); };
  if (!object(fp) || typeof fp.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(fp.id) ||
      typeof courseId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(courseId) ||
      typeof slug !== "string" || !slug || slug.length > 256 || /[\u0000-\u0020\u007f]/.test(slug) ||
      !atomKey(fp.atomId) || fp.contentId !== "atom~" + fp.atomId ||
      !object(material) || material.id !== fp.id || material.atomId !== fp.atomId || material.contentId !== fp.contentId ||
      material.published !== true || !object(material.content) || material.content.typeName !== fp.typeName ||
      !["staffGraded", "gradedAssignment", "ungradedAssignment"].includes(fp.typeName) ||
      !object(material.content.definition) || !object(atomData) || !object(relationData) ||
      !Array.isArray(atomData.elements) || atomData.elements.length !== 1 ||
      !Array.isArray(relationData.elements) || relationData.elements.length !== 1 ||
      atomData.paging?.next != null || relationData.paging?.next != null) fail("BINDING_FAILED");
  const atom = atomData.elements[0], relation = relationData.elements[0], relationKey = courseId + "~" + fp.id;
  if (!object(atom) || atom.id !== fp.atomId || atom.contentId !== fp.contentId ||
      !object(relation) || relation.id !== fp.atomId || relation.atomId !== fp.atomId ||
      !object(relation.branchRelationMap) || !Object.hasOwn(relation.branchRelationMap, relationKey)) fail("BINDING_FAILED");
  const branch = relation.branchRelationMap[relationKey];
  if (!object(branch) || branch.courseId !== courseId || branch.itemId !== fp.id || branch.courseSlug !== slug) fail("BINDING_FAILED");
  if (!object(atom.status) || atom.status.typeName !== "publishedAtomStatus" ||
      !object(atom.draft) || !object(atom.draft.content) || atom.draft.content.typeName !== "staffGradedDraft" ||
      !object(atom.published) || !object(atom.published.content) || atom.published.content.typeName !== "staffGraded") fail("STATE_UNSUPPORTED");
  const draft = atom.draft, published = atom.published,
    publishedAssignmentId = published.content.definition?.assignmentId;
  if (!object(draft.content.definition) || !Array.isArray(draft.content.definition.parts) ||
      !object(published.content.definition) || typeof publishedAssignmentId !== "string" ||
      !/^[A-Za-z0-9_-]{22}@[1-9]\d{0,11}$/.test(publishedAssignmentId) ||
      material.content.definition.assignmentId !== publishedAssignmentId ||
      !Number.isSafeInteger(atom.storedAtomVersion) || atom.storedAtomVersion < 1 ||
      !object(atom.metadata) || !Number.isSafeInteger(atom.metadata.updatedAt) || atom.metadata.updatedAt < 0) fail("MODEL_UNSUPPORTED");
  if (draft.content.definition.parts.length > CTI_DIRECT_AUTHORING_SNAPSHOT_PARTS_V1) fail("PART_LIMIT");
  return { atom, relation, material, courseId, itemId: fp.id, courseSlug: slug, atomId: fp.atomId, contentId: fp.contentId,
    sourceState: "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM", atomStatus: "publishedAtomStatus",
    publishedAssignmentId, storedAtomVersion: atom.storedAtomVersion, updatedAt: atom.metadata.updatedAt,
    draft, published, publishedContentVerified: false, contentCompletenessVerified: false, wholeItemVerified: false };
}

/** Literal part order and IDs only. Unsupported or repeated parts remain raw
 * source evidence and cannot create a guessed group or question request. */
export function directPublishedDraftSnapshotInventoryV1(bound) {
  if (bound?.sourceState !== "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM" ||
      bound.atomStatus !== "publishedAtomStatus" || !/^[A-Za-z0-9_-]{22}$/.test(bound.atomId || "") ||
      bound.draft?.content?.typeName !== "staffGradedDraft" || !Array.isArray(bound.draft.content.definition?.parts))
    throw Error("DIRECT_AUTHORING_SNAPSHOT_MODEL_UNSUPPORTED");
  const rawParts = bound.draft.content.definition.parts;
  if (rawParts.length > CTI_DIRECT_AUTHORING_SNAPSHOT_PARTS_V1) throw Error("DIRECT_AUTHORING_SNAPSHOT_PART_LIMIT");
  const candidates = [], unsupportedParts = [], seen = new Set();
  for (let index = 0; index < rawParts.length; index++) {
    const part = rawParts[index], ordinal = index + 1,
      typeName = typeof part?.typeName === "string" && part.typeName.length <= 128 ? part.typeName : "UNKNOWN_PART_TYPE",
      id = part?.definition?.id;
    let reason = "";
    if (!part || typeof part !== "object" || Array.isArray(part) || typeName !== "storedQuestionGroupPart") reason = "DIRECT_SNAPSHOT_PART_TYPE_UNSUPPORTED";
    else if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) reason = "DIRECT_SNAPSHOT_PART_ID_INVALID";
    else if (seen.has(id)) reason = "DIRECT_SNAPSHOT_PART_ID_CONFLICT";
    if (reason) { unsupportedParts.push({ ordinal, typeName, reason }); continue; }
    seen.add(id); candidates.push({ id: bound.atomId + "~" + id, ordinal });
  }
  return { declared: rawParts.length, rawParts, candidates, unsupportedParts };
}

/** Hash this canonical source object independently of original HTTP bytes.
 * Full sanitized atom/relations are retained, including both source modes. */
export function directPublishedDraftSnapshotSourceV1(bound) {
  if (bound?.sourceState !== "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM" ||
      bound.publishedContentVerified !== false || bound.contentCompletenessVerified !== false || bound.wholeItemVerified !== false)
    throw Error("DIRECT_AUTHORING_SNAPSHOT_MODEL_UNSUPPORTED");
  const checked = bindDirectPublishedDraftSnapshotV1({ id: bound.itemId, atomId: bound.atomId, contentId: bound.contentId,
    typeName: bound.material?.content?.typeName }, bound.courseId, bound.courseSlug, bound.material,
    { elements: [bound.atom] }, { elements: [bound.relation] });
  if (checked.atomStatus !== bound.atomStatus || checked.publishedAssignmentId !== bound.publishedAssignmentId ||
      checked.storedAtomVersion !== bound.storedAtomVersion || checked.updatedAt !== bound.updatedAt ||
      directCanonicalSourceTextV1(checked.draft) !== directCanonicalSourceTextV1(bound.draft) ||
      directCanonicalSourceTextV1(checked.published) !== directCanonicalSourceTextV1(bound.published))
    throw Error("DIRECT_AUTHORING_SNAPSHOT_BINDING_FAILED");
  return { sourceState: checked.sourceState, courseId: checked.courseId, itemId: checked.itemId, courseSlug: checked.courseSlug,
    atomId: checked.atomId, contentId: checked.contentId, atomStatus: checked.atomStatus,
    publishedAssignmentId: checked.publishedAssignmentId, storedAtomVersion: checked.storedAtomVersion, updatedAt: checked.updatedAt,
    material: checked.material, atom: checked.atom, relation: checked.relation };
}

export function directPublishedDraftSnapshotStableV1(initial, final) {
  try { return directCanonicalSourceTextV1(directPublishedDraftSnapshotSourceV1(initial)) ===
    directCanonicalSourceTextV1(directPublishedDraftSnapshotSourceV1(final)); }
  catch { return false; }
}

/** The already proved authoring adapter supports one exact versioned question
 * reference per group. Variants and foreign owners remain explicit raw gaps. */
export function directPublishedDraftSnapshotQuestionIdsV1(groupData, groupId, atomId) {
  if (typeof atomId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(atomId) ||
      typeof groupId !== "string" || !groupId.startsWith(atomId + "~") ||
      !/^[A-Za-z0-9_-]{22}~[A-Za-z0-9_-]{22}$/.test(groupId) ||
      !groupData || typeof groupData !== "object" || !Array.isArray(groupData.elements) ||
      groupData.elements.length !== 1 || groupData.paging?.next != null) return null;
  const group = groupData.elements[0], questions = group?.questions;
  if (!group || typeof group !== "object" || Array.isArray(group) || group.id !== groupId ||
      !Array.isArray(questions) || questions.length !== 1 || typeof questions[0] !== "string" ||
      !questions[0].startsWith(atomId + "~") || !/^[A-Za-z0-9_-]{22}~[A-Za-z0-9_-]{22}@[1-9]\d{0,11}$/.test(questions[0])) return null;
  return questions.slice();
}
