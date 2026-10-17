import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { reviewCapture } from "../src/domain/capture-review.ts";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";

const options = { partner: "NAIT", mode: "OPS_CURRENT" };
const courseId = "Synthetic_course";
const digest = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const fingerprints = [],
    leaves = [];
  const add = (type, count, completeCount, typeName) => {
    for (let index = 0; index < count; index++) {
      const id = type + index;
      const structural = type === "Unknown";
      const atomId = (fingerprints.length.toString(36) + "a".repeat(22)).slice(
        0,
        22,
      );
      const contract = {
        itemId: id,
        complete: index < completeCount,
        status: structural
          ? "COMPLETE_EMPTY_STRUCTURE"
          : index < completeCount
            ? "COMPLETE_BOUND_DRAFT_" + type.toUpperCase()
            : "UNRESOLVED_DIRECT_ITEM",
      };
      const leaf = {
        id,
        name: id,
        ...(structural
          ? { elements: [] }
          : {
              atomId,
              contentId: "atom~" + atomId,
              content: { typeName, definition: {} },
            }),
      };
      leaves.push(leaf);
      fingerprints.push({
        id,
        name: id,
        type,
        typeName: typeName || "",
        path: "Module",
        ...(structural ? {} : { atomId, contentId: "atom~" + atomId }),
        sourceIdentity: { structural },
        captureContract: contract,
        payload: {
          textSample: "",
          captureContract: { ...contract },
          // Reused ordinal IDs across retained placements are occurrences,
          // never evidence of one globally unique question bank.
          ...(type === "Assignment" && index === 0
            ? {
                structuredAssessment: {
                  questions: Array.from({ length: 4007 }, () => ({
                    id: "1",
                    type: "essay",
                    prompt: "Retained question",
                  })),
                },
              }
            : {}),
        },
      });
    }
  };
  add("Reading", 123, 80, "supplement");
  add("Assignment", 34, 34, "staffGraded");
  add("Plugin", 6, 0, "ungradedWidget");
  add("Discussion", 2, 2, "discussionPrompt");
  add("Unknown", 20, 20, "");
  const materials = {
    elements: [
      {
        id: courseId,
        conflictMetadata: { version: 1, courseBranchVersion: 1 },
        material: {
          elements: [{ id: "module", name: "Module", elements: leaves }],
        },
      },
    ],
    paging: {},
  };
  const hash = digest(directCanonicalSourceTextV1(materials.elements[0]));
  const receipt = {
    resource: "authoringCourseMaterials.v1",
    id: courseId,
    status: 200,
    sha256: hash,
    originalResponseSha256: hash,
    bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    requestPath: "/api/authoringCourseMaterials.v1/" + courseId,
  };
  return {
    schemaVersion: 35,
    page: { courseId, title: "Synthetic coverage fixture" },
    meta: {
      extractor: "CTI Direct Course Capture fixture",
      baseFingerprintCount: 185,
      directDataCapture: {
        mode: "BOUND_AUTHORING_DRAFT_API",
        version: 1,
        sourceStable: true,
        materialVersion: 1,
        courseBranchVersion: 1,
        initialMaterialHash: hash,
        finalMaterialHash: hash,
        materials,
        finalMaterials: structuredClone(materials),
        materialsReceipt: receipt,
        finalMaterialsReceipt: { ...receipt },
      },
    },
    fingerprints,
  };
}

test("capture review separates 165 content items from 20 empty structures without changing retained counts or claims", () => {
  const capture = fixture(),
    original = JSON.stringify(capture);
  const review = reviewCapture(capture, "capture.json", options);
  assert.deepEqual(review.courseraCoverage, {
    inventoryEntries: 185,
    contentItems: 165,
    emptyStructures: 20,
    reportedCompleteContent: 116,
    reportedCompleteEmptyStructures: 20,
    basis: "VERIFIED_NATIVE_MATERIAL_INVENTORY",
  });
  assert.equal(
    review.counts.items,
    185,
    "Backward-compatible inventory count retains empty structures",
  );
  assert.equal(
    review.counts.questionDefinitions,
    4007,
    "Repeated occurrences are not deduplicated by ordinal or prompt",
  );
  assert.equal(review.items.length, 185);
  assert.equal(
    review.items.filter((item) => item.type === "Empty structure").length,
    20,
  );
  assert(
    review.warnings.some((w) => w.includes("not a unique question-bank total")),
  );
  assert(review.warnings.some((w) => w.includes("capture's per-entry claims")));
  assert.equal(
    JSON.stringify(capture),
    original,
    "Inspection does not rewrite historical captures",
  );
});

test("claimed structural flags or conflicting completion contracts cannot increase reported content coverage", () => {
  for (const mutate of [
    (capture) => {
      capture.fingerprints[0].sourceIdentity.structural = true;
      capture.fingerprints[0].captureContract.status =
        "COMPLETE_EMPTY_STRUCTURE";
      capture.fingerprints[0].payload.captureContract.status =
        "COMPLETE_EMPTY_STRUCTURE";
    },
    (capture) => {
      capture.fingerprints[0].payload.captureContract.complete = false;
    },
    (capture) => {
      capture.fingerprints[0].captureContract.itemId = "other-item";
    },
    (capture) => {
      capture.fingerprints[0].captureContract.status = "UNRESOLVED_DIRECT_ITEM";
      capture.fingerprints[0].payload.captureContract.status =
        "UNRESOLVED_DIRECT_ITEM";
    },
  ]) {
    const capture = fixture();
    mutate(capture);
    const review = reviewCapture(capture, "capture.json", options);
    assert.equal(review.courseraCoverage.contentItems, 165);
    assert.equal(review.courseraCoverage.emptyStructures, 20);
    assert.equal(review.courseraCoverage.reportedCompleteContent, 115);
  }
});

test("unstable native inventories and legacy unknown items do not acquire an empty-structure count", () => {
  const capture = fixture();
  capture.meta.directDataCapture.sourceStable = false;
  const uncertain = reviewCapture(capture, "capture.json", options);
  assert.equal(uncertain.courseraCoverage, undefined);
  assert.equal(uncertain.counts.items, 185);
  assert(
    uncertain.warnings.some((w) =>
      w.includes("unknown items are not assumed empty"),
    ),
  );
  const legacy = reviewCapture(
    {
      schemaVersion: 34,
      fingerprints: [
        {
          id: "unknown",
          type: "Unknown",
          name: "Empty-looking item",
          payload: { textSample: "" },
          captureContract: {
            complete: true,
            status: "COMPLETE_EMPTY_STRUCTURE",
          },
        },
      ],
    },
    "legacy.json",
    options,
  );
  assert.equal(legacy.courseraCoverage, undefined);
  assert.equal(legacy.counts.items, 1);
  assert.equal(legacy.counts.questionDefinitions, 0);
  assert.equal(legacy.items[0].type, "Unknown");
});

test("Brightspace review keeps source definition counts separate from Coursera occurrence terminology", () => {
  const review = reviewCapture(
    {
      schemaVersion: 2,
      extractor: "CTI Brightspace",
      contentTree: [],
      quizzes: [
        {
          id: "quiz",
          questions: [{ id: "1" }, { id: "2" }],
          questionCoverage: { completenessVerified: false },
        },
      ],
    },
    "source.json",
    options,
  );
  assert.equal(review.platform, "BRIGHTSPACE");
  assert.equal(review.courseraCoverage, undefined);
  assert.equal(review.counts.questionDefinitions, 2);
  assert(!review.warnings.some((w) => w.includes("Question occurrences")));
});
