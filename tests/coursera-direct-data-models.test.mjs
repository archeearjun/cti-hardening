import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  bindDirectAuthoringDraftV1,
  directDraftAssessmentInventoryV1,
  directDraftReadingSourceV1,
  directDraftReadingDtdSupportedV1,
  directDraftDiscussionSourceV1,
} from "../src/extractors/coursera/direct-data-models.js";

const courseId = "Synthetic_course_branch_123",
  slug = "synthetic-course";
const atomId = "a".repeat(22),
  partA = "b".repeat(22),
  partB = "c".repeat(22);
const referenceId = "d".repeat(22) + "@1";
const part = (id) => ({
  typeName: "storedQuestionGroupPart",
  definition: { id },
});
function fixture(kind = "staffGradedDraft") {
  const fp = {
    id: "item-1",
    atomId,
    contentId: "atom~" + atomId,
    name: "Structural name",
  };
  const definition =
    kind === "staffGradedDraft"
      ? {
          parts: [part(partB), part(partA)],
          configuration: {
            isGraded: true,
            attemptConfiguration: { submissionLimitForEachAttempt: 1 },
          },
          introduction: {
            typeName: "cml",
            definition: {
              dtdId: "staffGraded/1",
              value: "<co-content><p>Original introduction</p></co-content>",
            },
          },
          reviewCriteria: {
            typeName: "cml",
            definition: {
              dtdId: "staffGraded/1",
              value: "<co-content><p>Original criteria</p></co-content>",
            },
          },
          passingFraction: 0.8,
          assignmentLevelRubrics: [],
        }
      : {
          assetId: referenceId,
          content: {
            typeName: "cml",
            definition: {
              dtdId: "supplement/1",
              value:
                "<co-content><p>Original &amp; exact reading</p></co-content>",
            },
          },
        };
  const atom = {
    id: atomId,
    contentId: fp.contentId,
    storedAtomVersion: 1,
    metadata: { updatedAt: 1700000000000 },
    draft: {
      name: "Different editable draft name",
      timeCommitment: 10800000,
      content: { typeName: kind, definition },
    },
    published: {
      name: "Older published name",
      timeCommitment: 1800000,
      content: {
        typeName: kind === "staffGradedDraft" ? "staffGraded" : "reading",
        definition:
          kind === "staffGradedDraft"
            ? { assignmentId: "e".repeat(22) + "@1" }
            : { assetId: "f".repeat(22) + "@2" },
      },
    },
    status: { typeName: "draftAtomStatus", definition: {} },
  };
  const relation = {
    id: atomId,
    atomId,
    branchRelationMap: {
      [courseId + "~" + fp.id]: { courseId, itemId: fp.id, courseSlug: slug },
    },
  };
  const atomData = { elements: [atom], paging: {}, linked: {} },
    relationData = { elements: [relation], paging: {}, linked: {} };
  return {
    fp,
    atom,
    relation,
    atomData,
    relationData,
    bind: () =>
      bindDirectAuthoringDraftV1(fp, courseId, slug, atomData, relationData),
  };
}
function frozen(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(frozen);
  }
  return value;
}

test("exact material and relation IDs bind a current draft while retaining its separate published snapshot", () => {
  const f = fixture();
  frozen(f.fp);
  frozen(f.atomData);
  frozen(f.relationData);
  const bound = f.bind();
  assert.equal(bound.atom, f.atom);
  assert.equal(bound.relation, f.relation);
  assert.equal(bound.atomId, atomId);
  assert.equal(bound.contentId, f.fp.contentId);
  assert.equal(bound.courseId, courseId);
  assert.equal(bound.itemId, f.fp.id);
  assert.equal(bound.courseSlug, slug);
  assert.equal(bound.sourceState, "AUTHORING_DRAFT");
  assert.equal(bound.draft, f.atom.draft);
  assert.equal(bound.published, f.atom.published);
  assert.equal(bound.storedAtomVersion, 1);
  assert.equal(bound.updatedAt, 1700000000000);
  assert.equal(bound.draftTimeCommitment, 10800000);
  assert.equal(bound.publishedTimeCommitment, 1800000);
  assert.notEqual(bound.draft.name, f.fp.name);
  assert.notEqual(bound.draft.name, bound.published.name);
  assert.equal(bound.stabilityVerified, undefined);
  assert.equal(bound.publishedBodyVerified, undefined);
});

test("wrong source IDs, ambiguous resources and mismatched branch ownership fail with a fixed reason", () => {
  for (const mutate of [
    (f) => {
      f.fp.atomId = "short";
    },
    (f) => {
      f.fp.contentId = "other";
    },
    (f) => {
      f.atom.id = "other";
    },
    (f) => {
      f.atom.contentId = "atom~other";
    },
    (f) => {
      f.relation.id = "other";
    },
    (f) => {
      f.relation.atomId = "other";
    },
    (f) => {
      f.atomData.elements = [];
    },
    (f) => {
      f.atomData.elements.push({ ...f.atom });
    },
    (f) => {
      f.relationData.elements = [];
    },
    (f) => {
      f.relationData.elements.push({ ...f.relation });
    },
    (f) => {
      f.relation.branchRelationMap = {};
    },
    (f) => {
      f.relation.branchRelationMap[courseId + "~" + f.fp.id].courseId =
        "other-course";
    },
    (f) => {
      f.relation.branchRelationMap[courseId + "~" + f.fp.id].itemId =
        "other-item";
    },
    (f) => {
      f.relation.branchRelationMap[courseId + "~" + f.fp.id].courseSlug =
        "other-slug";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(f.bind, {
      message: "DIRECT_AUTHORING_SOURCE_BINDING_FAILED",
    });
  }
});

test("a shared atom can retain other branch relations but only the exact requested branch mapping binds it", () => {
  const f = fixture();
  f.relation.branchRelationMap.Other_course_456__other = {
    courseId: "Other_course_456",
    itemId: "other",
    courseSlug: "other",
  };
  assert.equal(f.bind().itemId, f.fp.id);
  const selected = f.relation.branchRelationMap[courseId + "~" + f.fp.id];
  delete f.relation.branchRelationMap[courseId + "~" + f.fp.id];
  f.relation.branchRelationMap["Other_course_456~" + f.fp.id] = selected;
  assert.throws(f.bind, { message: "DIRECT_AUTHORING_SOURCE_BINDING_FAILED" });
});

test("a published or unknown atom state is not relabelled as current draft content", () => {
  for (const mutate of [
    (f) => {
      f.atom.status = { typeName: "publishedAtomStatus", definition: {} };
    },
    (f) => {
      delete f.atom.status;
    },
    (f) => {
      f.atom.draft = null;
    },
    (f) => {
      f.atom.draft.content = null;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(f.bind, {
      message: "DIRECT_AUTHORING_ATOM_STATE_UNSUPPORTED",
    });
  }
});

test("assessment parts supply exact group ownership and source order without using the published assignment reference", () => {
  const f = fixture(),
    bound = f.bind(),
    inventory = directDraftAssessmentInventoryV1(bound);
  assert.equal(inventory.complete, true);
  assert.equal(inventory.reason, "EXACT_AUTHORING_DRAFT_PARTS");
  assert.equal(inventory.assignmentId, atomId);
  assert.deepEqual(inventory.candidates, [
    { id: atomId + "~" + partB, ordinal: 1, label: "" },
    { id: atomId + "~" + partA, ordinal: 2, label: "" },
  ]);
  assert.equal(inventory.declared, 2);
  assert.equal(inventory.declaredContentParts, 2);
  assert.equal(inventory.rawParts, f.atom.draft.content.definition.parts);
  assert.deepEqual(inventory.unsupportedParts, []);
  assert.equal(
    inventory.configuration,
    f.atom.draft.content.definition.configuration,
  );
  assert.equal(inventory.passingFraction, 0.8);
  assert.equal(
    inventory.introduction,
    f.atom.draft.content.definition.introduction,
  );
  assert.equal(
    inventory.reviewCriteria,
    f.atom.draft.content.definition.reviewCriteria,
  );
  assert.equal(
    inventory.configuration.attemptConfiguration.submissionLimitForEachAttempt,
    1,
  );
  assert.equal(inventory.attempts, undefined);
  assert.equal(inventory.totalAttempts, undefined);
  assert.notEqual(
    inventory.assignmentId,
    bound.published.content.definition.assignmentId,
  );
});

test("unknown, malformed and duplicate parts retain every raw slot and leave the inventory incomplete", () => {
  const f = fixture();
  const parts = f.atom.draft.content.definition.parts;
  parts.push({
    typeName: "unrecognizedTextPart",
    definition: { value: "Original unsupported source" },
  });
  parts.push(part("invalid-short-id"));
  parts.push(part(partB));
  parts.push(null);
  const inventory = directDraftAssessmentInventoryV1(f.bind());
  assert.equal(inventory.complete, false);
  assert.equal(inventory.reason, "AUTHORING_DRAFT_PARTS_INCOMPLETE");
  assert.equal(inventory.rawParts, parts);
  assert.equal(inventory.rawParts.length, 6);
  assert.equal(inventory.candidates.length, 2);
  assert.equal(inventory.declared, 6);
  assert.equal(inventory.declaredContentParts, 6);
  assert.deepEqual(
    inventory.unsupportedParts.map((p) => [p.ordinal, p.reason]),
    [
      [3, "DIRECT_ASSESSMENT_PART_TYPE_UNSUPPORTED"],
      [4, "DIRECT_ASSESSMENT_PART_ID_INVALID"],
      [5, "DIRECT_ASSESSMENT_PART_ID_CONFLICT"],
      [6, "DIRECT_ASSESSMENT_PART_TYPE_UNSUPPORTED"],
    ],
  );
});

test("only an explicitly present empty parts array establishes an empty draft inventory", () => {
  const f = fixture();
  f.atom.draft.content.definition.parts = [];
  const inventory = directDraftAssessmentInventoryV1(f.bind());
  assert.equal(inventory.complete, true);
  assert.equal(inventory.reason, "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS");
  assert.equal(inventory.declared, 0);
  assert.deepEqual(inventory.candidates, []);
  delete f.atom.draft.content.definition.parts;
  assert.throws(() => directDraftAssessmentInventoryV1(f.bind()), {
    message: "DIRECT_AUTHORING_ASSESSMENT_MODEL_UNSUPPORTED",
  });
  assert.throws(
    () => directDraftAssessmentInventoryV1(fixture("supplementDraft").bind()),
    { message: "DIRECT_AUTHORING_ASSESSMENT_MODEL_UNSUPPORTED" },
  );
});

test("reading returns exact draft CML and its own reference separately from the published source", () => {
  const f = fixture("supplementDraft"),
    bound = f.bind(),
    source = directDraftReadingSourceV1(bound);
  assert.equal(
    source.cml,
    f.atom.draft.content.definition.content.definition.value,
  );
  assert.equal(source.rawCML, f.atom.draft.content.definition.content);
  assert.equal(source.dtdId, "supplement/1");
  assert.equal(source.assetId, referenceId);
  assert.equal(source.publishedAssetId, "f".repeat(22) + "@2");
  assert.equal(source.sourceState, "AUTHORING_DRAFT");
  assert.equal(source.draftTimeCommitment, 10800000);
  assert.equal(source.publishedTimeCommitment, 1800000);
  assert.equal(source.textCaptureEvidence, undefined);
  assert.equal(source.editorObserved, undefined);
  assert.equal(source.publishedBodyVerified, undefined);
  f.atom.published = null;
  assert.equal(directDraftReadingSourceV1(f.bind()).publishedAssetId, null);
  f.atom.draft.content.definition.content.definition.value = "";
  assert.equal(directDraftReadingSourceV1(f.bind()).cml, "");
});

test("unobserved reading models and incomplete CML stay unsupported rather than becoming empty bodies", () => {
  for (const mutate of [
    (f) => {
      f.atom.draft.content.typeName = "reading";
    },
    (f) => {
      f.atom.draft.content.definition.content.typeName = "html";
    },
    (f) => {
      f.atom.draft.content.definition.content.definition.dtdId = "different/1";
    },
    (f) => {
      f.atom.draft.content.definition.content.definition.value = null;
    },
    (f) => {
      delete f.atom.draft.content.definition.assetId;
    },
  ]) {
    const f = fixture("supplementDraft");
    mutate(f);
    assert.throws(() => directDraftReadingSourceV1(f.bind()), {
      message: "DIRECT_AUTHORING_READING_MODEL_UNSUPPORTED",
    });
  }
});

test("observed assess/1 CML remains an exact supplementDraft reading rather than an assessment", () => {
  const f = fixture("supplementDraft"),
    raw = f.atom.draft.content.definition.content;
  raw.definition.dtdId = "assess/1";
  raw.definition.value =
    '<co-content><heading level="1">Units</heading><text>π × r² = A; $x/2$</text>' +
    '<list bulletType="bullets"><li><text>Measure exactly</text></li></list>' +
    '<table rows="1" columns="1"><tr><td><text>25 mm</text></td></tr></table>' +
    '<asset id="' +
    "m".repeat(22) +
    '" name="Original plan" extension="pdf" assetType="pdf"/>' +
    '<widget id="' +
    "w".repeat(22) +
    '@1"/></co-content>';
  const source = directDraftReadingSourceV1(f.bind());
  assert.equal(source.rawCML, raw);
  assert.equal(source.cml, raw.definition.value);
  assert.equal(source.dtdId, "assess/1");
  assert.equal(f.atom.draft.content.typeName, "supplementDraft");
  assert.throws(() => directDraftAssessmentInventoryV1(f.bind()), {
    message: "DIRECT_AUTHORING_ASSESSMENT_MODEL_UNSUPPORTED",
  });
  for (const dtd of [
    undefined,
    null,
    "staffGraded/1",
    "discussion/1",
    "assess/2",
    "different/1",
  ])
    assert.equal(directDraftReadingDtdSupportedV1(dtd), false);
  assert.equal(directDraftReadingDtdSupportedV1("assess/1"), true);
  assert.equal(directDraftReadingDtdSupportedV1("supplement/1"), true);
});

test("the native helper declarations run independently of imports and preserve readonly source models", () => {
  const helpers = vm.runInNewContext(
    "const directDraftReadingDtdSupportedV1 = " +
      directDraftReadingDtdSupportedV1.toString() +
      "; ({bind:(" +
      bindDirectAuthoringDraftV1.toString() +
      "),inventory:(" +
      directDraftAssessmentInventoryV1.toString() +
      "),reading:(" +
      directDraftReadingSourceV1.toString() +
      ")})",
  );
  for (const kind of ["staffGradedDraft", "supplementDraft"]) {
    const f = fixture(kind);
    frozen(f.fp);
    frozen(f.atomData);
    frozen(f.relationData);
    const bound = helpers.bind(
      f.fp,
      courseId,
      slug,
      f.atomData,
      f.relationData,
    );
    const result =
      kind === "staffGradedDraft"
        ? helpers.inventory(bound)
        : helpers.reading(bound);
    const expected =
      kind === "staffGradedDraft"
        ? directDraftAssessmentInventoryV1(f.bind())
        : directDraftReadingSourceV1(f.bind());
    assert.deepEqual(
      JSON.parse(JSON.stringify(result)),
      JSON.parse(JSON.stringify(expected)),
    );
  }
});

test("the real v3 paired draft models bind on local replay without exposing their content in test output", (t) => {
  const file = process.env.CTI_COURSERA_REAL_DRAFT_FIXTURE;
  if (!file) {
    t.skip("Private uploaded fixture is local-only");
    return;
  }
  const capture = JSON.parse(readFileSync(file, "utf8"));
  const course = capture.records.find(
    (r) => r.resource === "authoringCourses.v2",
  ).data.elements[0].course;
  const atoms = capture.records.filter(
    (r) => r.resource === "authoringAtoms.v2",
  );
  assert.equal(atoms.length, 2);
  for (const row of atoms) {
    const binding = row.sourceBinding,
      relation = capture.records.find(
        (r) =>
          r.resource === "authoringItemContentRelations.v1" &&
          r.sourceBinding.atomId === binding.atomId,
      );
    const fp = {
      id: binding.itemId,
      atomId: binding.atomId,
      contentId: binding.sourceContentId,
    };
    const bound = bindDirectAuthoringDraftV1(
      fp,
      capture.courseId,
      course.slug,
      row.data,
      relation.data,
    );
    assert.equal(bound.sourceState, "AUTHORING_DRAFT");
    assert.equal(bound.storedAtomVersion, 1);
    if (binding.sourceContentType === "staffGraded") {
      const inventory = directDraftAssessmentInventoryV1(bound);
      assert.equal(inventory.complete, true);
      assert.equal(inventory.candidates.length, 3);
      assert.deepEqual(
        inventory.candidates.map((c) => c.ordinal),
        [1, 2, 3],
      );
    } else {
      const source = directDraftReadingSourceV1(bound);
      assert.equal(source.dtdId, "supplement/1");
      assert.equal(source.cml.length, 3753);
    }
  }
});

test("observed discussion drafts retain exact prompt, title and permissions without published response inference", () => {
  const f = fixture();
  f.atom.draft.content = {
    typeName: "discussionPromptDraft",
    definition: {
      promptType: {
        typeName: "questionPerSession",
        definition: {
          title: "Observed prompt title",
          promptPermissions: { viewAnswersBeforeReplying: false },
          prompt: {
            typeName: "cml",
            definition: {
              dtdId: "discussion/1",
              value: "<co-content><text>Discuss the topic</text></co-content>",
            },
          },
        },
      },
    },
  };
  const source = directDraftDiscussionSourceV1(f.bind());
  assert.equal(source.title, "Observed prompt title");
  assert.equal(source.dtdId, "discussion/1");
  assert.equal(source.promptPermissions.viewAnswersBeforeReplying, false);
  assert.strictEqual(
    source.rawDefinition,
    f.atom.draft.content.definition.promptType.definition,
  );
  for (const mutate of [
    (a) => {
      a.typeName = "unknownDraft";
    },
    (a) => {
      a.definition.promptType.typeName = "unobservedPromptType";
    },
    (a) => {
      delete a.definition.promptType.definition.promptPermissions;
    },
    (a) => {
      a.definition.promptType.definition.prompt.definition.dtdId =
        "supplement/1";
    },
    (a) => {
      a.definition.promptType.definition.prompt.definition.value = {};
    },
  ]) {
    const bound = f.bind(),
      copy = structuredClone(bound);
    mutate(copy.draft.content);
    assert.throws(() => directDraftDiscussionSourceV1(copy), {
      message: "DIRECT_AUTHORING_DISCUSSION_MODEL_UNSUPPORTED",
    });
  }
});
