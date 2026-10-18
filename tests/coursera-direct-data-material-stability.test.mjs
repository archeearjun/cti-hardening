import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import {
  CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1,
  directMaterialStabilityModelV1,
} from "../src/extractors/coursera/direct-data-material-stability.js";
import { evaluateCourseraCapture, verifiedCourseraCaptureInventory } from "../src/domain/coursera-background-extraction.ts";

const COURSE = "Synthetic_course_branch", FLAGS = [
  "SHOW_GRADE_ON_RELEASE", "LIMITED_SUBMISSIONS", "TAKE_LATEST_GRADE",
];
const hash = (model) => createHash("sha256").update(directCanonicalSourceTextV1(model)).digest("hex");
const comparisonHash = (model) => hash(directMaterialStabilityModelV1(model));
const item = (model) => model.material.elements[0].elements[0].elements[0];
function fixture() {
  return {
    id: COURSE, conflictMetadata: { version: 142, courseBranchVersion: 1 },
    material: { elements: [{ id: "ModuleA", name: "Module", elements: [{
      id: "LessonA", name: "Lesson", elements: ["AssignmentA", "AssignmentB"].map((id, index) => ({
        id, name: id, atomId: String.fromCharCode(97 + index).repeat(22),
        contentId: "atom~" + String.fromCharCode(97 + index).repeat(22),
        content: { typeName: "ungradedAssignment", definition: {
          assignmentFeatures: [...FLAGS], questionOrder: ["QuestionB", "QuestionA"],
        } },
      })),
    }] }] },
  };
}
function inventoryCapture(initial = fixture(), final = structuredClone(initial), policy = true) {
  const receipt = {
    resource: "authoringCourseMaterials.v1", id: COURSE, status: 200,
    sha256: "a".repeat(64), originalResponseSha256: "a".repeat(64),
    bodyFormat: "PARSED_SANITIZED_JSON_MODEL", requestPath: "/api/authoringCourseMaterials.v1/" + COURSE,
  };
  return {
    page: { courseId: COURSE },
    meta: { baseFingerprintCount: 2, directDataCapture: {
      mode: "BOUND_AUTHORING_DRAFT_API", version: 1, sourceStable: true,
      initialMaterialHash: hash(initial), finalMaterialHash: hash(final),
      ...(policy ? { materialStability: {
        policy: CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1,
        initialSha256: comparisonHash(initial), finalSha256: comparisonHash(final),
      } } : {}),
      materialVersion: 142, courseBranchVersion: 1,
      materials: { elements: [initial], paging: {} }, finalMaterials: { elements: [final], paging: {} },
      materialsReceipt: receipt, finalMaterialsReceipt: structuredClone(receipt),
    } },
    fingerprints: initial.material.elements[0].elements[0].elements.map((entry) => ({
      id: entry.id, atomId: entry.atomId, contentId: entry.contentId,
    })),
  };
}

test("only the observed assignment flag order is ignored, with native responses and hashes unchanged", () => {
  const initial = fixture(), final = structuredClone(initial), original = structuredClone(initial);
  item(final).content.definition.assignmentFeatures.reverse();
  assert.notEqual(hash(initial), hash(final));
  assert.equal(comparisonHash(initial), comparisonHash(final));
  assert.deepEqual(initial, original);
  assert.deepEqual(item(initial).content.definition.assignmentFeatures, FLAGS);
  const capture = inventoryCapture(initial, final);
  const result = verifiedCourseraCaptureInventory(capture);
  assert.equal(result.inventory.length, 2);
  assert.equal(result.materialHash, hash(initial));
  assert.equal(result.completeContent, false);
  assert.notEqual(capture.meta.directDataCapture.initialMaterialHash, capture.meta.directDataCapture.finalMaterialHash);
  assert(!evaluateCourseraCapture(capture, COURSE).reasons.includes("DIRECT_DRAFT_SOURCE_STABILITY_NOT_PROVEN"));
});

test("membership, item and question order, titles and native versions still change stability", () => {
  for (const mutate of [
    (root) => item(root).content.definition.assignmentFeatures.pop(),
    (root) => root.material.elements[0].elements[0].elements.reverse(),
    (root) => item(root).content.definition.questionOrder.reverse(),
    (root) => { item(root).name = "Changed authored title"; },
    (root) => { root.conflictMetadata.version++; },
  ]) {
    const initial = fixture(), final = structuredClone(initial);
    mutate(final);
    assert.notEqual(comparisonHash(initial), comparisonHash(final));
    assert.throws(() => verifiedCourseraCaptureInventory(inventoryCapture(initial, final)), /unstable|contradictory/);
  }
});

test("unknown flags, duplicate or malformed values and lookalike paths remain order-sensitive", () => {
  for (const flags of [
    ["UNKNOWN_FEATURE", "LIMITED_SUBMISSIONS"],
    ["LIMITED_SUBMISSIONS", "LIMITED_SUBMISSIONS", "TAKE_LATEST_GRADE"],
    ["LIMITED_SUBMISSIONS", { typeName: "TAKE_LATEST_GRADE" }],
    ["LIMITED_SUBMISSIONS", 1],
  ]) {
    const initial = fixture(); item(initial).content.definition.assignmentFeatures = flags;
    const final = structuredClone(initial); item(final).content.definition.assignmentFeatures.reverse();
    assert.notEqual(comparisonHash(initial), comparisonHash(final));
  }
  for (const mutate of [
    (root) => { item(root).content.typeName = "supplement"; },
    (root) => { root.assignmentFeatures = [...FLAGS]; delete item(root).content.definition.assignmentFeatures; },
    (root) => { root.material.elements = [root.material.elements[0].elements[0]]; },
  ]) {
    const initial = fixture(); mutate(initial); const final = structuredClone(initial);
    if (final.assignmentFeatures) final.assignmentFeatures.reverse();
    else {
      const leaf = final.material.elements[0].elements[0];
      (leaf.content ? leaf : leaf.elements[0]).content.definition.assignmentFeatures.reverse();
    }
    assert.notEqual(comparisonHash(initial), comparisonHash(final));
  }
});

test("the independent inventory verifier rejects unsupported policies, missing or forged signatures and raw tampering", () => {
  for (const mutate of [
    (mode) => { mode.materialStability.policy = "UNKNOWN_POLICY"; },
    (mode) => { mode.materialStability.initialSha256 = "0".repeat(64); mode.materialStability.finalSha256 = "0".repeat(64); },
    (mode) => { delete mode.materialStability.finalSha256; },
    (mode) => { mode.materialStability = null; },
    (mode) => { mode.initialMaterialHash = "0".repeat(64); },
    (mode) => { item(mode.finalMaterials.elements[0]).name = "Unhashed change"; },
  ]) {
    const capture = inventoryCapture(); mutate(capture.meta.directDataCapture);
    assert.throws(() => verifiedCourseraCaptureInventory(capture), /unstable|contradictory/);
    assert(evaluateCourseraCapture(capture, COURSE).reasons.includes("DIRECT_DRAFT_SOURCE_STABILITY_NOT_PROVEN"));
  }
});

test("unmarked historical captures require original hash equality and their sourceStable declaration remains binding", () => {
  const legacy = inventoryCapture(fixture(), fixture(), false);
  assert.equal(verifiedCourseraCaptureInventory(legacy).inventory.length, 2);
  const initial = fixture(), final = fixture(); item(final).content.definition.assignmentFeatures.reverse();
  assert.throws(() => verifiedCourseraCaptureInventory(inventoryCapture(initial, final, false)), /unstable|contradictory/);
  const changed = inventoryCapture(initial, final);
  changed.meta.directDataCapture.sourceStable = false;
  assert.throws(() => verifiedCourseraCaptureInventory(changed), /stable native/);
});

test("private historical material replay remains immutable while the narrow future comparison recognizes its flag reorder", {
  skip: !process.env.CTI_MATERIAL_STABILITY_PRIVATE_CAPTURE,
}, () => {
  const capture = JSON.parse(readFileSync(process.env.CTI_MATERIAL_STABILITY_PRIVATE_CAPTURE, "utf8"));
  const before = JSON.stringify(capture), mode = capture.meta.directDataCapture;
  assert.equal(mode.sourceStable, false);
  assert.equal(mode.stopReason, "DIRECT_COURSE_CHANGED_DURING_CAPTURE");
  assert.notEqual(hash(mode.materials.elements[0]), hash(mode.finalMaterials.elements[0]));
  assert.equal(comparisonHash(mode.materials.elements[0]), comparisonHash(mode.finalMaterials.elements[0]));
  assert.throws(() => verifiedCourseraCaptureInventory(capture), /stable native/);
  assert.equal(JSON.stringify(capture), before);
});
