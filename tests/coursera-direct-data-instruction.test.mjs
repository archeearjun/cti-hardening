import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { directDraftAssessmentInventoryV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directAssessmentContractV1, directInstructionAssessmentModelV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { evaluateCourseraCapture } from "../src/domain/coursera-background-extraction.ts";

globalThis.crypto ??= webcrypto;
const courseId = "Synthetic_course_branch_123", slug = "synthetic-course", atomId = "a".repeat(22),
  hash = value => createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex"),
  cml = text => ({typeName: "cml", definition: {dtdId: "assess/1", value: "<co-content><text>" + text + "</text></co-content>"}}),
  receipt = (resource, id) => ({resource, id, status: 200, bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    originalResponseSha256: "b".repeat(64), sha256: "b".repeat(64),
    requestPath: "/api/" + resource + "/" + encodeURIComponent(id).replace(/%40/gi, "@")});
const block = (index = 1) => ({typeName: "storedTextBlockPart", definition: {
  id: "textBlock~12345678-1234-1234-1234-" + String(index).padStart(12, "0"),
  title: "Original instruction " + index,
  body: cml("Read the original instructions " + index + ". &lt;div&gt; is literal text."),
}});
async function fixture(parts = [block()]) {
  const draft = {name: "Instruction assessment", content: {typeName: "staffGradedDraft", definition: {parts,
    configuration: {isGraded: false}, passingFraction: 0, assignmentLevelRubrics: []}}},
    atom = {id: atomId, contentId: "atom~" + atomId, storedAtomVersion: 1,
      metadata: {updatedAt: 1700000000000}, status: {typeName: "draftAtomStatus"}, draft},
    relation = {id: atomId, atomId, branchRelationMap: {[courseId + "~item1"]: {courseId, itemId: "item1", courseSlug: slug}}},
    bound = {atomId, contentId: atom.contentId, courseId, itemId: "item1", courseSlug: slug,
      sourceState: "AUTHORING_DRAFT", storedAtomVersion: 1, updatedAt: atom.metadata.updatedAt, draft},
    inventory = directDraftAssessmentInventoryV1(bound), assessment = await directInstructionAssessmentModelV1(inventory),
    fp = {id: "item1", name: "Instruction assessment", type: "Assignment", typeName: "ungradedAssignment", atomId, contentId: atom.contentId,
      payload: {directDataSources: {atom: {elements: [atom]}, relation: {elements: [relation]}, receipts: {
        atom: receipt("authoringAtoms.v2", atomId), relation: receipt("authoringItemContentRelations.v1", atomId),
        stability: {stable: true, draftHash: hash(draft), storedAtomVersion: 1, updatedAt: atom.metadata.updatedAt,
          atom: {elements: [structuredClone(atom)]}, receipt: receipt("authoringAtoms.v2", atomId)},
      }}, assessmentApiEvidence: {method: "BOUND_AUTHORING_DRAFT_API", courseId, itemId: "item1", assignmentId: atomId,
        rawParts: parts, unsupportedParts: [], failures: [], inventory: [], groups: [], questionDefinitions: [], groupStability: [], receipts: []},
        directAssessmentInventory: inventory}};
  directAssessmentContractV1(fp, assessment, inventory, bound);
  const material = {id: courseId, conflictMetadata: {version: 1, courseBranchVersion: 1}, material: {elements: [
    {id: "module1", name: "Module", elements: [{id: fp.id, name: fp.name, originalName: fp.name, atomId, contentId: atom.contentId,
      content: {typeName: "ungradedAssignment", definition: {assignmentId: "z".repeat(22) + "@2"}}, elements: []}]}]}},
    capture = {page: {courseId, url: `https://www.coursera.org/teach/${slug}/${courseId}/content/edit`}, meta: {baseFingerprintCount: 1,
      directDataCapture: {mode: "BOUND_AUTHORING_DRAFT_API", version: 1, acquisitionComplete: true, wholeCourseVerified: true, sourceStable: true,
        initialMaterialHash: hash(material), finalMaterialHash: hash(material), materialVersion: 1, courseBranchVersion: 1,
        materials: {elements: [material], paging: {}}, finalMaterials: {elements: [structuredClone(material)], paging: {}},
        materialsReceipt: receipt("authoringCourseMaterials.v1", courseId), finalMaterialsReceipt: receipt("authoringCourseMaterials.v1", courseId)},
      captureAccounting: {inventoryCount: 1, completeCount: 1, unresolvedCount: 0, unknownCount: 0, unvisitedCount: 0,
        externalContentUnverifiedCount: 0, allInventoryAccounted: true, noSilentMisses: true, complete: true}}, fingerprints: [fp]};
  return {capture, fp, bound, assessment, inventory};
}

test("instruction content parts retain exact originals and hashes without inventing questions or source emptiness", async () => {
  const parts = [block(1), block(2)], before = JSON.stringify(parts), f = await fixture(parts);
  assert.equal(f.inventory.declared, 0);
  assert.equal(f.inventory.declaredContentParts, 2);
  assert.deepEqual(f.inventory.nonQuestionPartOrdinals, [1, 2]);
  assert.equal(f.assessment.questionCount, 0);
  assert.deepEqual(f.assessment.questions, []);
  assert.equal(f.assessment.captureCompleteness.sourceEmpty, false);
  assert.equal(f.assessment.captureCompleteness.answerKeyApplicability, "NOT_APPLICABLE_NON_QUESTION_CONTENT");
  assert.equal(f.assessment.contentBlocks[0].sourcePartSha256, hash(parts[0]));
  assert.deepEqual(f.assessment.contentBlocks[0].rawCML, parts[0].definition.body);
  assert.equal(f.assessment.contentBlocks[1].title, parts[1].definition.title);
  assert.equal(f.assessment.contentBlocks[1].ordinal, 2);
  assert.equal(f.fp.captureContract.status, "COMPLETE_BOUND_DRAFT_INSTRUCTION_ASSESSMENT");
  assert.equal(f.fp.captureContract.complete, true);
  assert.match(f.fp.payload.textSample, /<div> is literal text/);
  assert.equal(f.fp.payload.explicitEmptyAssessmentEvidence, undefined);
  assert.equal(JSON.stringify(parts), before);
  const capturedBefore = JSON.stringify(f.capture), verdict = evaluateCourseraCapture(f.capture, courseId);
  assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
  assert.equal(JSON.stringify(f.capture), capturedBefore);
});

test("unknown/mixed/manual/duplicate part inventories cannot acquire instruction-only coverage", async () => {
  for (const parts of [
    [block(), {typeName: "storedQuestionGroupPart", definition: {id: "q".repeat(22)}}],
    [{typeName: "storedManualGradedQuestionPart", definition: {id: "q".repeat(22)}}],
    [block(), block()],
    [{...block(), definition: {...block().definition, body: cml("source"), unknownBody: "unread"}}],
  ]) {
    const bound = {sourceState: "AUTHORING_DRAFT", atomId, draft: {content: {typeName: "staffGradedDraft", definition: {parts}}}},
      inventory = directDraftAssessmentInventoryV1(bound);
    assert.equal(inventory.complete, false);
    await assert.rejects(directInstructionAssessmentModelV1(inventory), /UNSUPPORTED/);
  }
});

test("inert exact body reads reject unread media, active content, unknown dialects and excessive projections", async () => {
  for (const change of [
    b => b.definition.body = cml('<img assetId="missing"/>'),
    b => b.definition.body = cml('<script>active()</script>'),
    b => b.definition.body.definition.dtdId = "unknown/1",
    b => b.definition.body.definition.value = "<co-content><text>broken</co-content>",
    b => b.definition.title = "x".repeat(4000001),
  ]) {
    const source = block(); change(source);
    await assert.rejects(fixture([source]), /UNSUPPORTED/);
  }
});

test("collector and independent import reject changed source text/title/order, metadata and fabricated applicability", async () => {
  for (const change of [
    f => f.assessment.contentBlocks.reverse(),
    f => f.assessment.contentBlocks[0].title = "Invented title",
    f => f.assessment.contentBlocks[0].text = "Invented content",
    f => f.assessment.contentBlocks[0].rawCML.definition.value = "<co-content/>",
    f => f.assessment.captureCompleteness.sourceEmpty = true,
    f => f.assessment.captureCompleteness.answerKeyApplicability = "NOT_APPLICABLE_NO_QUESTIONS",
    f => f.inventory.nonQuestionPartOrdinals = [2, 1],
    f => f.assessment.questions.push({prompt: "Invented question"}),
    f => f.bound.draft.content.definition.configuration.isGraded = true,
    f => f.fp.payload.assessmentApiEvidence.groups.push({id: "unobserved"}),
  ]) {
    const f = await fixture([block(1), block(2)]); change(f);
    assert.equal(evaluateCourseraCapture(f.capture, courseId).complete, false, String(change));
    assert.equal(directAssessmentContractV1(f.fp, f.assessment, f.inventory, f.bound).complete, false, String(change));
  }
  for (const change of [
    f => f.assessment.contentBlocks[0].originalCmlSha256 = "f".repeat(64),
    f => f.assessment.contentBlocks[0].sourcePartSha256 = "f".repeat(64),
    f => f.assessment.contentBlocks[0].textSha256 = "f".repeat(64),
    f => f.fp.payload.textSample = "Invented text",
    f => f.fp.payload.directInstructionAssessmentEvidence.sourceDraftSha256 = "f".repeat(64),
    f => f.fp.payload.directDataSources.atom.elements[0].status.typeName = "publishedAtomStatus",
  ]) {
    const f = await fixture(); change(f);
    assert.equal(evaluateCourseraCapture(f.capture, courseId).complete, false, String(change));
  }
});
