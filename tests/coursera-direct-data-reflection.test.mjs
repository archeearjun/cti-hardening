import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { directAssessmentContractV1, directReflectionQuestionProjectionV1, parseCourseraReflectionDefinitionDirectV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { directDraftAssessmentInventoryV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { evaluateCourseraCapture } from "../src/domain/coursera-background-extraction.ts";
const courseId = "Synthetic_course_branch_123", slug = "synthetic-course", atomId = "a".repeat(22),
  hash = value => createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex"),
  cml = text => ({typeName: "cml", definition: {dtdId: "assess/1", value: "<co-content><text>" + text + "</text></co-content>"}}),
  receipt = (resource, id) => ({resource, id, status: 200, bodyFormat: "PARSED_SANITIZED_JSON_MODEL", originalResponseSha256: "b".repeat(64), sha256: "b".repeat(64), requestPath: "/api/" + resource + "/" + id});
function original(kind = "mcqReflect", id = atomId + "~" + "q".repeat(22) + "@1") {
  return {id, definition: {typeName: kind, definition: {prompt: cml("Which method do you prefer?"), shuffleOptions: false,
    ...(kind === "mcqReflect" ? {noChosenFeedback: cml("")} : {}), options: [
      {id: "one", display: cml("Original preference one"), feedback: cml("Original feedback one")},
      {id: "two", display: cml("Original preference two"), feedback: cml("")},
    ]}}};
}
function fixture() {
  const originals = [original(), original("checkboxReflect", atomId + "~" + "r".repeat(22) + "@1")],
    parts = ["g", "h"].map(id => ({typeName: "storedQuestionGroupPart", definition: {id: id.repeat(22)}})),
    candidates = parts.map((part, index) => ({id: atomId + "~" + part.definition.id, ordinal: index + 1, label: ""})),
    groups = candidates.map((candidate, index) => ({id: candidate.id, questions: [originals[index].id]})),
    draft = {name: "Unkeyed survey", content: {typeName: "staffGradedDraft", definition: {parts, configuration: {isGraded: false}}}},
    atom = {id: atomId, contentId: "atom~" + atomId, storedAtomVersion: 1, metadata: {updatedAt: 1700000000000}, status: {typeName: "draftAtomStatus"}, draft},
    relation = {id: atomId, atomId, branchRelationMap: {[courseId + "~item1"]: {courseId, itemId: "item1", courseSlug: slug}}},
    bound = {atomId, contentId: atom.contentId, courseId, itemId: "item1", courseSlug: slug, sourceState: "AUTHORING_DRAFT", storedAtomVersion: 1, updatedAt: atom.metadata.updatedAt, draft},
    inventory = directDraftAssessmentInventoryV1(bound), questions = originals.map((source, index) => parseCourseraReflectionDefinitionDirectV1(source, candidates[index])),
    assessment = {schemaVersion: 6, declaredQuestionCount: 2, questionCount: 2, answerEvidenceQuestionCount: 0, questions, configuration: draft.content.definition.configuration},
    fp = {id: "item1", name: "Unkeyed survey", type: "Assignment", typeName: "ungradedAssignment", atomId, contentId: atom.contentId, payload: {
      directDataSources: {atom: {elements: [atom]}, relation: {elements: [relation]}, receipts: {
        atom: receipt("authoringAtoms.v2", atomId), relation: receipt("authoringItemContentRelations.v1", atomId),
        stability: {stable: true, draftHash: hash(draft), storedAtomVersion: 1, updatedAt: atom.metadata.updatedAt, atom: {elements: [structuredClone(atom)]}, receipt: receipt("authoringAtoms.v2", atomId)},
      }}, directAssessmentInventory: inventory, assessmentApiEvidence: {method: "BOUND_AUTHORING_DRAFT_API", courseId, itemId: "item1", assignmentId: atomId,
        rawParts: parts, unsupportedParts: [], failures: [], inventory: candidates, groups, questionDefinitions: originals,
        groupStability: groups.map(group => ({id: group.id, stable: true, group: structuredClone(group), receipt: receipt("authoringAssignmentQuestionGroups.v1", group.id)})),
        receipts: [...groups.map(group => receipt("authoringAssignmentQuestionGroups.v1", group.id)), ...originals.map(source => receipt("authoringAssignmentMachineEvaluableQuestions.v1", source.id))]}}};
  directAssessmentContractV1(fp, assessment, inventory, bound);
  const material = {id: courseId, conflictMetadata: {version: 1, courseBranchVersion: 1}, material: {elements: [{id: "module1", name: "Module", elements: [
    {id: fp.id, name: fp.name, atomId, contentId: atom.contentId, content: {typeName: "ungradedAssignment", definition: {assignmentId: "z".repeat(22) + "@2"}}, elements: []}]}]}},
    capture = {page: {courseId, url: `https://www.coursera.org/teach/${slug}/${courseId}/content/edit`}, meta: {baseFingerprintCount: 1,
      directDataCapture: {mode: "BOUND_AUTHORING_DRAFT_API", version: 1, acquisitionComplete: true, wholeCourseVerified: true, sourceStable: true,
        initialMaterialHash: hash(material), finalMaterialHash: hash(material), materialVersion: 1, courseBranchVersion: 1,
        materials: {elements: [material], paging: {}}, finalMaterials: {elements: [structuredClone(material)], paging: {}},
        materialsReceipt: receipt("authoringCourseMaterials.v1", courseId), finalMaterialsReceipt: receipt("authoringCourseMaterials.v1", courseId)},
      captureAccounting: {inventoryCount: 1, completeCount: 1, unresolvedCount: 0, unknownCount: 0, unvisitedCount: 0, externalContentUnverifiedCount: 0, allInventoryAccounted: true, noSilentMisses: true, complete: true}}, fingerprints: [fp]};
  return {capture, fp, bound, inventory, assessment, originals};
}

test("native reflection projects literal choices and feedback with null correctness and explicitly inapplicable keys", () => {
  const f = fixture(), before = JSON.stringify(f.capture);
  assert.equal(f.fp.captureContract.status, "COMPLETE_BOUND_DRAFT_REFLECTION_ASSESSMENT");
  assert.equal(f.fp.captureContract.complete, true);
  assert.equal(f.assessment.answerEvidenceQuestionCount, 0);
  assert.deepEqual(f.assessment.questions.map(q => q.type), ["reflection-single-select", "reflection-multiple-select"]);
  for (const q of f.assessment.questions) {
    assert.deepEqual(q.options.map(o => o.correct), [null, null]);
    assert.deepEqual(q.correctAnswers, []);
    assert.equal(q.answerTextReliable, false);
    assert.equal(q.answerKeyApplicable, false);
    assert.equal(q.answerKeyEvidence.method, "NATIVE_REFLECTION_NO_KEY");
  }
  assert.equal(f.assessment.questions[0].noChosenFeedbackStatus, "EXPLICIT_EMPTY");
  assert.equal(f.assessment.questions[1].noChosenFeedbackStatus, "ABSENT");
  assert.equal(f.assessment.captureCompleteness.answerKeyApplicability, "NOT_APPLICABLE_UNKEYED_NATIVE_REFLECTION");
  assert.equal(f.assessment.captureCompleteness.requiredAnswerCoverageComplete, true);
  assert.equal(f.assessment.captureCompleteness.answerCoverageComplete, false);
  const result = evaluateCourseraCapture(f.capture, courseId);
  assert.equal(result.complete, true, result.reasons.join("\n"));
  assert.equal(JSON.stringify(f.capture), before);
});

test("reflection absence of a key cannot be inferred from labels, missing fields, media or a keyed native type", () => {
  for (const change of [
    d => d.typeName = "mcq", d => d.definition.correctOption = "one", d => d.definition.options[0].isCorrect = false,
    d => d.definition.options[0].display.definition.value = '<co-content><img assetId="unread"/></co-content>',
    d => delete d.definition.shuffleOptions, d => d.definition.noChosenFeedback = {typeName: "unknown"},
  ]) { const source = original(); change(source.definition); assert.equal(directReflectionQuestionProjectionV1(source), null, String(change)); }
});

test("collector and independent import reject invented keys, false correctness, changed body fields and unbound native proof", () => {
  for (const change of [
    f => f.assessment.questions[0].options[0].correct = false,
    f => f.assessment.questions[0].correctAnswers = ["Original preference one"],
    f => f.assessment.questions[0].answerTextReliable = true,
    f => f.assessment.questions[0].answerKeyApplicable = true,
    f => f.assessment.questions[0].answerKeyEvidence.method = "EXACT_CORRECT_OPTION_ID",
    f => f.assessment.questions[0].prompt = "Changed prompt",
    f => f.assessment.questions[0].options[0].feedback = "Invented feedback",
    f => f.assessment.questions[0].noChosenFeedbackStatus = "ABSENT",
    f => f.assessment.answerEvidenceQuestionCount = 2,
    f => f.bound.draft.content.definition.configuration.isGraded = true,
    f => f.fp.payload.assessmentApiEvidence.groupStability[0].stable = false,
    f => f.fp.payload.assessmentApiEvidence.inventory.reverse(),
    f => f.fp.typeName = "gradedAssignment",
    f => f.originals[0].definition.definition.correctOption = "one",
  ]) { const f = fixture(); change(f); assert.equal(evaluateCourseraCapture(f.capture, courseId).complete, false, String(change)); assert.equal(directAssessmentContractV1(f.fp, f.assessment, f.inventory, f.bound).complete, false, String(change)); }
  for (const change of [
    f => f.assessment.captureCompleteness.answerKeyApplicability = "VERIFIED_KEY",
    f => f.fp.payload.directReflectionAssessmentEvidence.sourceDraftSha256 = "f".repeat(64),
    f => f.fp.payload.directDataSources.atom.elements[0].status.typeName = "publishedAtomStatus",
  ]) { const f = fixture(); change(f); assert.equal(evaluateCourseraCapture(f.capture, courseId).complete, false, String(change)); }
});
