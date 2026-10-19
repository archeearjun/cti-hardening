import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  directAssessmentContractV1, directAssessmentQuestionProjectionV1,
  parseCourseraTextExactMatchDefinitionDirectV1,
} from "../src/extractors/coursera/direct-data-contracts.js";
import { directDraftAssessmentInventoryV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { assessmentCaptureCoverageV613 } from "../src/extractors/coursera/assessments-4.js";
import { evaluateCourseraCapture } from "../src/domain/coursera-background-extraction.ts";

const courseId = "Synthetic_course_branch_123", slug = "synthetic-course", atomId = "a".repeat(22),
  localId = "g".repeat(22), definitionId = atomId + "~" + "q".repeat(22) + "@1";
const hash = value => createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex");
const cml = value => ({typeName: "cml", definition: {dtdId: "assess/1", value: "<co-content><text>" + value + "</text></co-content>"}});
const receipt = (resource, id) => ({resource, id, status: 200, bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
  originalResponseSha256: "b".repeat(64), sha256: "b".repeat(64),
  requestPath: "/api/" + resource + "/" + encodeURIComponent(id).replace(/%40/gi, "@")});
function rawDefinition() {
  return {id: definitionId, definition: {typeName: "textExactMatch", definition: {
    prompt: cml("Complete the source phrase: Learn, ______, Succeed"),
    options: [{id: "key", answer: "  To Do\n", isCorrect: true, feedback: cml("Literal source feedback")},
      {id: "rejected", answer: "to do", isCorrect: false, feedback: cml("Rejected source spelling")}],
    defaultIncorrectFeedback: cml("Original default feedback"),
  }}};
}
function fixture(sourceType = "ungradedAssignment") {
  const original = rawDefinition(), candidate = {id: atomId + "~" + localId, ordinal: 1, label: ""},
    parts = [{typeName: "storedQuestionGroupPart", definition: {id: localId}}],
    draft = {name: "Exact text", content: {typeName: "staffGradedDraft", definition: {parts}}},
    atom = {id: atomId, contentId: "atom~" + atomId, storedAtomVersion: 1,
      metadata: {updatedAt: 1700000000000}, status: {typeName: "draftAtomStatus"}, draft},
    relation = {id: atomId, atomId, branchRelationMap: {[courseId + "~item1"]: {courseId, itemId: "item1", courseSlug: slug}}},
    bound = {atomId, contentId: atom.contentId, courseId, itemId: "item1", courseSlug: slug,
      sourceState: "AUTHORING_DRAFT", storedAtomVersion: 1, updatedAt: atom.metadata.updatedAt, draft},
    inventory = directDraftAssessmentInventoryV1(bound),
    question = parseCourseraTextExactMatchDefinitionDirectV1(original, candidate),
    group = {id: candidate.id, questions: [original.id]},
    fp = {id: "item1", name: "Exact text", type: "Assignment", typeName: sourceType, atomId, contentId: atom.contentId,
      payload: {directDataSources: {atom: {elements: [atom]}, relation: {elements: [relation]}, receipts: {
        atom: receipt("authoringAtoms.v2", atomId), relation: receipt("authoringItemContentRelations.v1", atomId),
        stability: {stable: true, draftHash: hash(draft), storedAtomVersion: 1, updatedAt: atom.metadata.updatedAt,
          atom: {elements: [structuredClone(atom)]}, receipt: receipt("authoringAtoms.v2", atomId)},
      }}, assessmentApiEvidence: {method: "BOUND_AUTHORING_DRAFT_API", courseId, itemId: "item1", assignmentId: atomId,
        rawParts: parts, unsupportedParts: [], failures: [], inventory: [candidate], groups: [group],
        questionDefinitions: [original], groupStability: [{id: group.id, stable: true, group: structuredClone(group),
          receipt: receipt("authoringAssignmentQuestionGroups.v1", group.id)}], receipts: [
            receipt("authoringAssignmentQuestionGroups.v1", group.id), receipt("authoringAssignmentMachineEvaluableQuestions.v1", original.id)]},
        directAssessmentInventory: inventory}},
    assessment = {schemaVersion: 6, declaredQuestionCount: 1, questionCount: 1, answerEvidenceQuestionCount: 1,
      questions: [question], captureCompleteness: assessmentCaptureCoverageV613([question], 1, "AUTHORING_API", {declaredContentParts: 1})};
  directAssessmentContractV1(fp, assessment, inventory, bound);
  const material = {id: courseId, conflictMetadata: {version: 1, courseBranchVersion: 1}, material: {elements: [
    {id: "module1", name: "Module", elements: [{id: fp.id, name: fp.name, originalName: fp.name, atomId, contentId: atom.contentId,
      content: {typeName: sourceType, definition: {assignmentId: "z".repeat(22) + "@2"}}, elements: []}]}]}},
    capture = {page: {courseId, url: `https://www.coursera.org/teach/${slug}/${courseId}/content/edit`},
      meta: {baseFingerprintCount: 1, directDataCapture: {mode: "BOUND_AUTHORING_DRAFT_API", version: 1,
        acquisitionComplete: true, wholeCourseVerified: true, sourceStable: true,
        initialMaterialHash: hash(material), finalMaterialHash: hash(material), materialVersion: 1, courseBranchVersion: 1,
        materials: {elements: [material], paging: {}}, finalMaterials: {elements: [structuredClone(material)], paging: {}},
        materialsReceipt: receipt("authoringCourseMaterials.v1", courseId), finalMaterialsReceipt: receipt("authoringCourseMaterials.v1", courseId)},
      captureAccounting: {inventoryCount: 1, completeCount: 1, unresolvedCount: 0, unknownCount: 0, unvisitedCount: 0,
        externalContentUnverifiedCount: 0, allInventoryAccounted: true, noSilentMisses: true, complete: true}}, fingerprints: [fp]};
  return {capture, fp, bound, assessment, inventory, original, question};
}

test("exact-text projection preserves literal keyed and rejected answers, feedback and native identities", () => {
  const source = rawDefinition(), before = JSON.stringify(source),
    result = parseCourseraTextExactMatchDefinitionDirectV1(source, {id: atomId + "~" + localId, ordinal: 4});
  assert.equal(result.type, "text-entry");
  assert.equal(result.id, "4");
  assert.deepEqual(result.correctAnswers, ["  To Do\n"]);
  assert.deepEqual(result.options.map(option => [option.text, option.correct]), [["  To Do\n", true], ["to do", false]]);
  assert.equal(result.options[0].feedback, "Literal source feedback");
  assert.equal(result.defaultIncorrectFeedback, "Original default feedback");
  assert.deepEqual(result.answerKeyEvidence, {method: "EXPLICIT_TEXT_EXACT_MATCH_OPTIONS", correctOptionIds: ["key"]});
  assert.equal(result.answerMatchingTested, undefined);
  assert.equal(JSON.stringify(source), before);
});

test("one-answer native exact-text records are supported without inventing distractors or text normalization", () => {
  const source = rawDefinition(); source.definition.definition.options.pop();
  assert.deepEqual(directAssessmentQuestionProjectionV1(source).correctAnswers, ["  To Do\n"]);
  assert.equal(directAssessmentQuestionProjectionV1(source).options.length, 1);
});

test("unknown matching rules, absent keys, ambiguous records and source media remain unsupported", () => {
  for (const change of [
    d => d.typeName = "textRegex", d => d.definition.caseInsensitive = true,
    d => d.definition.numericTolerance = 0.1, d => delete d.definition.options[0].isCorrect,
    d => d.definition.options.forEach(option => option.isCorrect = false),
    d => d.definition.options[1].id = "key", d => d.definition.options[1].answer = "  To Do\n",
    d => d.definition.options[0].isCorrect = "true", d => delete d.definition.defaultIncorrectFeedback,
    d => d.definition.options[0].feedback.definition.value = '<co-content><img assetId="missing"/></co-content>',
    d => d.definition.defaultIncorrectFeedback.definition.dtdId = "unknown/1",
  ]) {
    const source = rawDefinition(); change(source.definition);
    assert.equal(directAssessmentQuestionProjectionV1(source), null, String(change));
  }
  assert.equal(parseCourseraTextExactMatchDefinitionDirectV1(rawDefinition(), {id: "foreign~group", ordinal: 1}), null);
});

test("collector and independent importer verify exact-text keys only under stable bound assignment evidence", () => {
  for (const type of ["staffGraded", "gradedAssignment", "ungradedAssignment"]) {
    const f = fixture(type);
    assert.equal(f.fp.captureContract.complete, true, type);
    const before = JSON.stringify(f.capture), verdict = evaluateCourseraCapture(f.capture, courseId);
    assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
    assert.equal(JSON.stringify(f.capture), before);
  }
});

test("independent importer and collector reject changed literal keys, feedback, identities and invented aliases", () => {
  for (const change of [
    f => f.question.correctAnswers[0] = "To Do", f => f.question.options[0].text = "To Do",
    f => f.question.options[0].correct = false, f => f.question.options[0].aliases.push("To Do"),
    f => f.question.options[0].feedback = "Invented feedback", f => f.question.defaultIncorrectFeedback = "Invented",
    f => f.question.answerKeyEvidence.correctOptionIds = ["rejected"], f => f.question.sourceDefinitionId = "foreign@1",
    f => f.question.rawType = "mcq", f => f.fp.payload.assessmentApiEvidence.groupStability[0].stable = false,
  ]) {
    const f = fixture(); change(f);
    assert.equal(evaluateCourseraCapture(f.capture, courseId).complete, false, String(change));
    assert.equal(directAssessmentContractV1(f.fp, f.assessment, f.inventory, f.bound).complete, false, String(change));
  }
  for (const change of [f => f.fp.typeName = "supplement", f => f.fp.payload.directDataSources.atom.elements[0].status.typeName = "publishedAtomStatus"]) {
    const f = fixture(); change(f);
    assert.equal(evaluateCourseraCapture(f.capture, courseId).complete, false, String(change));
  }
});
