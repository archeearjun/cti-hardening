import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  bindDirectPublishedDraftSnapshotV1, directPublishedDraftSnapshotInventoryV1,
  directPublishedDraftSnapshotSourceV1, directPublishedDraftSnapshotStableV1,
  directPublishedDraftSnapshotQuestionIdsV1, CTI_DIRECT_AUTHORING_SNAPSHOT_PARTS_V1,
  CTI_DIRECT_AUTHORING_SNAPSHOT_FAILURES_V1,
} from "../src/extractors/coursera/direct-data-authoring-snapshot.js";
import { bindDirectAuthoringDraftV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";

const courseId = "Synthetic_course_123", slug = "synthetic-course", atomId = "a".repeat(22),
  groupA = "b".repeat(22), groupB = "c".repeat(22), questionId = atomId + "~" + "q".repeat(22) + "@7";
const part = id => ({ typeName: "storedQuestionGroupPart", definition: { id } });
function fixture() {
  const fp = { id: "item-1", atomId, contentId: "atom~" + atomId, typeName: "ungradedAssignment" },
    assignmentId = "p".repeat(22) + "@2",
    material = { id: fp.id, atomId, contentId: fp.contentId, published: true,
      content: { typeName: "ungradedAssignment", definition: { assignmentId } } },
    atom = { id: atomId, contentId: fp.contentId, storedAtomVersion: 2, metadata: { updatedAt: 1791189683630 },
      status: { typeName: "publishedAtomStatus", definition: {} },
      draft: { name: "Literal retained draft", content: { typeName: "staffGradedDraft", definition: {
        parts: [part(groupB), part(groupA)], configuration: { isGraded: false },
        introduction: { typeName: "cml", definition: { dtdId: "staffGraded/1", value: "<co-content>Original draft only.</co-content>" } },
      } } },
      published: { name: "Current published metadata", content: { typeName: "staffGraded", definition: { assignmentId, isGraded: false } } } },
    relation = { id: atomId, atomId, branchRelationMap: { [courseId + "~" + fp.id]: { courseId, itemId: fp.id, courseSlug: slug } } },
    atomData = { elements: [atom], paging: {}, linked: {} }, relationData = { elements: [relation], paging: {}, linked: {} };
  return { fp, material, atom, relation, atomData, relationData,
    bind() { return bindDirectPublishedDraftSnapshotV1(fp, courseId, slug, material, atomData, relationData); } };
}
const hashSource = bound => createHash("sha256").update(directCanonicalSourceTextV1(directPublishedDraftSnapshotSourceV1(bound))).digest("hex");

test("published atoms retain an explicitly separate draft snapshot with unchanged literal fields and false current-content claims", () => {
  const f = fixture(), before = JSON.stringify(f), bound = f.bind();
  assert.equal(bound.sourceState, "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM");
  assert.equal(bound.atomStatus, "publishedAtomStatus"); assert.equal(bound.publishedAssignmentId, f.material.content.definition.assignmentId);
  assert.equal(bound.draft, f.atom.draft); assert.equal(bound.published, f.atom.published);
  for (const key of ["publishedContentVerified", "contentCompletenessVerified", "wholeItemVerified"]) assert.equal(bound[key], false);
  assert.equal(JSON.stringify(f), before); assert.match(hashSource(bound), /^[a-f0-9]{64}$/);
  assert.throws(() => bindDirectAuthoringDraftV1(f.fp, courseId, slug, f.atomData, f.relationData),
    { message: "DIRECT_AUTHORING_ATOM_STATE_UNSUPPORTED" }, "The existing current-draft binder still rejects this actual published status");
});

test("item, material, atom and exact course relation identities cannot borrow another published pointer", () => {
  for (const mutate of [
    f => f.material.id = "another-item", f => f.material.atomId = "x".repeat(22),
    f => f.material.contentId = "atom~" + "x".repeat(22), f => f.material.published = false,
    f => f.material.content.typeName = "supplement", f => f.atom.id = "x".repeat(22),
    f => f.atom.contentId = "atom~" + "x".repeat(22), f => f.relation.atomId = "x".repeat(22),
    f => f.relation.branchRelationMap[courseId + "~item-1"].courseId = "Other_course_456",
    f => f.relation.branchRelationMap[courseId + "~item-1"].itemId = "another-item",
    f => f.relation.branchRelationMap[courseId + "~item-1"].courseSlug = "another-slug",
    f => delete f.relation.branchRelationMap[courseId + "~item-1"],
    f => f.atomData.elements.push(f.atom), f => f.relationData.elements.push(f.relation),
    f => f.atomData.paging.next = "unread", f => f.relationData.paging.next = "unread",
  ]) {
    const f = fixture(); mutate(f); assert.throws(f.bind, { message: "DIRECT_AUTHORING_SNAPSHOT_BINDING_FAILED" });
  }
  for (const mutate of [
    f => f.material.content.definition.assignmentId = "p".repeat(22) + "@1",
    f => f.atom.published.content.definition.assignmentId = "p".repeat(22),
    f => f.atom.published.content.definition.assignmentId = "p".repeat(22) + "@0",
    f => f.atom.published.content.definition.assignmentId = "p".repeat(22) + "@2/other",
    f => f.atom.storedAtomVersion = 0, f => f.atom.storedAtomVersion = "2",
    f => f.atom.storedAtomVersion = 1.5, f => f.atom.metadata.updatedAt = NaN,
    f => f.atom.metadata.updatedAt = "1791189683630", f => delete f.atom.metadata,
  ]) {
    const f = fixture(); mutate(f); assert.throws(f.bind, { message: "DIRECT_AUTHORING_SNAPSHOT_MODEL_UNSUPPORTED" });
  }
});

test("a draft, missing draft, reading or coach state is not silently accepted as this assessment snapshot mode", () => {
  for (const mutate of [
    f => f.atom.status.typeName = "draftAtomStatus", f => delete f.atom.status,
    f => delete f.atom.draft, f => f.atom.draft.content.typeName = "coachDraft",
    f => f.atom.draft.content.typeName = "supplementDraft", f => f.atom.published.content.typeName = "reading",
    f => delete f.atom.published,
  ]) {
    const f = fixture(); mutate(f); assert.throws(f.bind, { message: "DIRECT_AUTHORING_SNAPSHOT_STATE_UNSUPPORTED" });
  }
});

test("literal part inventory preserves order, flags duplicate/unsupported/invalid parts and stops above the deliberate snapshot bound", () => {
  const f = fixture(), bound = f.bind(), before = JSON.stringify(bound), inventory = directPublishedDraftSnapshotInventoryV1(bound);
  assert.deepEqual(inventory.candidates, [{ id: atomId + "~" + groupB, ordinal: 1 }, { id: atomId + "~" + groupA, ordinal: 2 }]);
  assert.equal(inventory.rawParts, bound.draft.content.definition.parts); assert.equal(JSON.stringify(bound), before);
  bound.draft.content.definition.parts.push(part(groupB), { typeName: "storedTextBlockPart", definition: { value: "Literal instruction" } }, part("invalid"));
  const partial = directPublishedDraftSnapshotInventoryV1(bound);
  assert.equal(partial.declared, 5); assert.equal(partial.candidates.length, 2);
  assert.deepEqual(partial.unsupportedParts.map(value => value.reason), ["DIRECT_SNAPSHOT_PART_ID_CONFLICT", "DIRECT_SNAPSHOT_PART_TYPE_UNSUPPORTED", "DIRECT_SNAPSHOT_PART_ID_INVALID"]);
  bound.draft.content.definition.parts = [];
  assert.deepEqual(directPublishedDraftSnapshotInventoryV1(bound), { declared: 0, rawParts: [], candidates: [], unsupportedParts: [] });
  assert.equal(bound.wholeItemVerified, false, "An observed empty array never certifies the published assignment empty");
  bound.draft.content.definition.parts = Array.from({ length: 101 }, () => part(groupA));
  assert.throws(() => directPublishedDraftSnapshotInventoryV1(bound), { message: "DIRECT_AUTHORING_SNAPSHOT_PART_LIMIT" });
  assert.throws(f.bind, { message: "DIRECT_AUTHORING_SNAPSHOT_PART_LIMIT" });
  assert.equal(CTI_DIRECT_AUTHORING_SNAPSHOT_PARTS_V1, 100); assert.equal(CTI_DIRECT_AUTHORING_SNAPSHOT_FAILURES_V1, 301);
});

test("source hashes and first-final checks bind full sanitized atom, both source modes, material and relations", () => {
  const initial = fixture(), same = fixture(), before = hashSource(initial.bind());
  assert(directPublishedDraftSnapshotStableV1(initial.bind(), same.bind()));
  assert.equal(before, hashSource(same.bind()));
  for (const mutate of [
    f => f.atom.draft.content.definition.parts.reverse(), f => f.atom.draft.name += " edited",
    f => f.atom.published.name += " edited", f => f.atom.metadata.updatedAt++, f => f.atom.storedAtomVersion++,
    f => f.atom.metadata.newObservedField = "changed", f => f.material.name = "changed",
    f => f.relation.branchRelationMap[courseId + "~item-1"].branchName = "changed",
    f => { f.atom.published.content.definition.assignmentId = f.material.content.definition.assignmentId = "p".repeat(22) + "@3"; },
  ]) {
    const fresh = fixture(); mutate(fresh);
    assert.equal(directPublishedDraftSnapshotStableV1(initial.bind(), fresh.bind()), false);
    assert.notEqual(hashSource(fresh.bind()), before);
  }
  const forged = initial.bind(); forged.publishedContentVerified = true;
  assert.throws(() => directPublishedDraftSnapshotSourceV1(forged), { message: "DIRECT_AUTHORING_SNAPSHOT_MODEL_UNSUPPORTED" });
  assert.equal(directPublishedDraftSnapshotStableV1(initial.bind(), forged), false);
  const changedContext = initial.bind(); changedContext.publishedAssignmentId = "p".repeat(22) + "@4";
  assert.throws(() => directPublishedDraftSnapshotSourceV1(changedContext), { message: "DIRECT_AUTHORING_SNAPSHOT_BINDING_FAILED" });
});

test("group definitions use only the exact returned owned version and reject variants, foreign IDs and pagination", () => {
  const groupId = atomId + "~" + groupA, data = { elements: [{ id: groupId, questions: [questionId] }], paging: {} }, before = JSON.stringify(data);
  assert.deepEqual(directPublishedDraftSnapshotQuestionIdsV1(data, groupId, atomId), [questionId]);
  assert.equal(JSON.stringify(data), before);
  for (const mutate of [
    value => value.elements[0].id = atomId + "~" + groupB,
    value => value.elements[0].questions = [], value => value.elements[0].questions.push(questionId),
    value => value.elements[0].questions[0] = questionId.replace(atomId, "x".repeat(22)),
    value => value.elements[0].questions[0] = questionId.replace("@7", ""),
    value => value.elements[0].questions[0] = questionId.replace("@7", "@0"),
    value => value.elements[0].questions[0] = questionId.replace("@7", "@7/other"),
    value => value.elements.push(value.elements[0]), value => value.paging.next = "unread",
  ]) {
    const invalid = structuredClone(data); mutate(invalid);
    assert.equal(directPublishedDraftSnapshotQuestionIdsV1(invalid, groupId, atomId), null);
  }
  assert.equal(directPublishedDraftSnapshotQuestionIdsV1(data, "x".repeat(22) + "~" + groupA, atomId), null);
});
