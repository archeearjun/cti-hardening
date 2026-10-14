import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import {
  evaluateCourseraCapture,
  parseCourseraShellUrl,
} from "../src/domain/coursera-background-extraction.ts";

test("Coursera shell URL is normalized and rejects non-Coursera targets", () => {
  const target = parseCourseraShellUrl(
    "https://www.coursera.org/teach/course-name/Abc_def-123/content/item/supplement/x",
  );
  assert.equal(
    target.shellUrl,
    "https://www.coursera.org/teach/course-name/Abc_def-123/content/edit",
  );
  assert.equal(target.courseId, "Abc_def-123");
  assert.throws(() =>
    parseCourseraShellUrl("https://example.com/teach/a/b/content"),
  );
});

test("strict capture cannot be complete without an explicit completeness contract", () => {
  const verdict = evaluateCourseraCapture({
    page: { courseId: "course-123" },
    meta: { baseFingerprintCount: 1 },
    fingerprints: [{ id: "r1", type: "Reading", payload: {} }],
  });
  assert.equal(verdict.complete, false);
  assert.ok(verdict.reasons.includes("EXPLICIT_COMPLETENESS_CONTRACT_MISSING"));
});

test("strict capture passes only when inventory and evidence reconcile", () => {
  const verdict = evaluateCourseraCapture(
    {
      page: { courseId: "course-123" },
      meta: {
        baseFingerprintCount: 2,
        captureAccounting: {
          inventoryCount: 2,
          completeCount: 2,
          unresolvedCount: 0,
          unknownCount: 0,
          unvisitedCount: 0,
          allInventoryAccounted: true,
          noSilentMisses: true,
          complete: true,
          terminalAccountedIncompleteCount: 0,
          externalContentUnverifiedCount: 0,
        },
        activeSpaCrawl: {
          timeBudgetExhausted: false,
          unvisitedTargetIds: [],
          unvisitedDueToBudget: 0,
        },
        wholeRunDeadlineReached: false,
      },
      fingerprints: [
        {
          id: "r1",
          type: "Reading",
          captureContract: { complete: true, status: "COMPLETE_READING" },
          payload: {},
        },
        {
          id: "a1",
          type: "Assignment",
          captureContract: { complete: true, status: "COMPLETE_ASSESSMENT" },
          payload: {
            structuredAssessment: {
              questions: [{}, {}],
              captureCompleteness: {
                declared: 2,
                captured: 2,
                questionCoverageComplete: true,
                requiredAnswerCoverageComplete: true,
              },
            },
          },
        },
      ],
    },
    "course-123",
  );
  assert.equal(verdict.complete, true);
  assert.deepEqual(verdict.reasons, []);
});

test("cross-origin plugin target is accounted but never certified complete", () => {
  const verdict = evaluateCourseraCapture({
    page: { courseId: "course-123" },
    meta: {
      captureAccounting: {
        inventoryCount: 1,
        completeCount: 0,
        unresolvedCount: 1,
        unknownCount: 0,
        unvisitedCount: 0,
        allInventoryAccounted: true,
        noSilentMisses: true,
        complete: false,
        terminalAccountedIncompleteCount: 1,
        externalContentUnverifiedCount: 1,
      },
    },
    fingerprints: [
      {
        id: "p1",
        type: "Plugin",
        captureContract: {
          complete: false,
          status: "ACCOUNTED_EXTERNAL_TARGET_ONLY",
          externalBodyVerified: false,
        },
        payload: {},
      },
    ],
  });
  assert.equal(verdict.complete, false);
  assert.ok(verdict.reasons.includes("PLUGIN_BODY_UNVERIFIED:p1"));
});

test("course identity mismatch blocks certification", () => {
  const verdict = evaluateCourseraCapture(
    {
      page: { courseId: "wrong" },
      meta: {
        captureAccounting: {
          inventoryCount: 1,
          completeCount: 1,
          unresolvedCount: 0,
          unknownCount: 0,
          unvisitedCount: 0,
          allInventoryAccounted: true,
          noSilentMisses: true,
          complete: true,
        },
      },
      fingerprints: [{ id: "r1", type: "Reading", payload: {} }],
    },
    "expected",
  );
  assert.equal(verdict.complete, false);
  assert.match(verdict.reasons.join("\n"), /COURSE_ID_MISMATCH/);
});

const sourceHash = (value) => createHash("sha256").update(value).digest("hex");
const modelHash = (value) => sourceHash(directCanonicalSourceTextV1(value));
const directCourseId = "Synthetic_course_branch_123",
  directSlug = "synthetic-course",
  directAtomId = "a".repeat(22);
function receipt(resource, id) {
  const hash = sourceHash(resource + "/" + id);
  return {
    resource,
    id,
    status: 200,
    sha256: hash,
    originalResponseSha256: hash,
    bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    requestPath:
      "/api/" + resource + "/" + encodeURIComponent(id).replace(/%40/gi, "@"),
  };
}
function attachMaterials(capture, leaf) {
  const elements =
    leaf.content === undefined
      ? [leaf]
      : [{ id: "module-1", elements: [leaf] }];
  const materials = {
    elements: [
      {
        id: directCourseId,
        material: { elements },
        conflictMetadata: { version: 1, courseBranchVersion: 1 },
      },
    ],
    paging: {},
  };
  const mode = capture.meta.directDataCapture;
  mode.materials = materials;
  mode.finalMaterials = structuredClone(materials);
  mode.initialMaterialHash = modelHash(materials.elements[0]);
  mode.finalMaterialHash = mode.initialMaterialHash;
  mode.materialsReceipt = receipt(
    "authoringCourseMaterials.v1",
    directCourseId,
  );
  mode.finalMaterialsReceipt = receipt(
    "authoringCourseMaterials.v1",
    directCourseId,
  );
  return capture;
}
function directReadingCapture() {
  const id = "reading-1",
    contentId = "atom~" + directAtomId;
  const cml = {
    typeName: "cml",
    definition: {
      dtdId: "supplement/1",
      value: "<co-content><p>Current draft body</p></co-content>",
    },
  };
  const assetId = "b".repeat(22) + "@1";
  const draft = {
    content: {
      typeName: "supplementDraft",
      definition: { assetId, content: cml },
    },
  };
  const atom = {
    id: directAtomId,
    contentId,
    status: { typeName: "draftAtomStatus" },
    draft,
    published: {
      content: {
        typeName: "supplement",
        definition: { assetId: "c".repeat(22) + "@1" },
      },
    },
    storedAtomVersion: 1,
    metadata: { updatedAt: 1700000000000 },
  };
  const relation = {
    id: directAtomId,
    atomId: directAtomId,
    branchRelationMap: {
      [directCourseId + "~" + id]: {
        courseId: directCourseId,
        itemId: id,
        courseSlug: directSlug,
      },
    },
  };
  const hash = sourceHash("full original materials");
  const capture = {
    schemaVersion: 35,
    page: {
      courseId: directCourseId,
      url: `https://www.coursera.org/teach/${directSlug}/${directCourseId}/content/edit`,
    },
    meta: {
      baseFingerprintCount: 1,
      directDataCapture: {
        mode: "BOUND_AUTHORING_DRAFT_API",
        version: 1,
        sourceStable: true,
        acquisitionComplete: true,
        wholeCourseVerified: true,
        initialMaterialHash: hash,
        finalMaterialHash: hash,
        materialVersion: 1,
        courseBranchVersion: 1,
      },
      captureAccounting: {
        inventoryCount: 1,
        completeCount: 1,
        unresolvedCount: 0,
        unknownCount: 0,
        unvisitedCount: 0,
        allInventoryAccounted: true,
        noSilentMisses: true,
        complete: true,
      },
    },
    fingerprints: [
      {
        id,
        type: "Reading",
        atomId: directAtomId,
        contentId,
        captureContract: {
          complete: true,
          status: "COMPLETE_BOUND_DRAFT_READING",
        },
        payload: {
          textSample: "Current draft body",
          textLength: "Current draft body".length,
          textSha256: sourceHash("Current draft body"),
          textScopeKind: "bound-authoring-draft-cml",
          textCaptureTruncated: false,
          directDraftCml: cml,
          directDataEvidence: {
            method: "BOUND_AUTHORING_DRAFT_API",
            courseId: directCourseId,
            itemId: id,
            atomId: directAtomId,
            contentId,
            sourceState: "AUTHORING_DRAFT",
            stableSource: true,
            draftHash: modelHash(draft),
            storedAtomVersion: 1,
            updatedAt: 1700000000000,
            dtdId: "supplement/1",
            assetId,
            rawCmlLength: cml.definition.value.length,
            rawCmlSha256: sourceHash(cml.definition.value),
            plainTextLength: "Current draft body".length,
            assetReferenceCount: 0,
            assetsBodyVerified: true,
            unresolvedAssetReferences: [],
          },
          directDataSources: {
            atom: { elements: [atom], paging: {} },
            relation: { elements: [relation], paging: {} },
            receipts: {
              atom: receipt("authoringAtoms.v2", directAtomId),
              relation: receipt(
                "authoringItemContentRelations.v1",
                directAtomId,
              ),
              stability: {
                stable: true,
                draftHash: modelHash(draft),
                storedAtomVersion: 1,
                updatedAt: 1700000000000,
                atom: { elements: [structuredClone(atom)], paging: {} },
                receipt: receipt("authoringAtoms.v2", directAtomId),
              },
            },
          },
        },
      },
    ],
  };
  return attachMaterials(capture, {
    id,
    originalName: "Original structural reading",
    atomId: directAtomId,
    contentId,
    content: {
      typeName: "supplement",
      definition: { assetId, assetTypeName: "cml" },
    },
    elements: [],
  });
}

test("direct draft reading completion requires its exact bound draft and retained original CML", () => {
  const capture = directReadingCapture();
  const before = JSON.stringify(capture);
  const verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(
    JSON.stringify(capture),
    before,
    "The import gate never modifies original evidence",
  );
});

test("direct draft reading cannot be certified from mismatched, partial or published evidence", () => {
  const changes = [
    (capture, item) => {
      item.atomId = "c".repeat(22);
    },
    (capture, item) => {
      item.payload.directDataSources.atom.elements[0].contentId = "atom~other";
    },
    (capture, item) => {
      item.payload.directDataSources.relation.elements[0].branchRelationMap[
        directCourseId + "~" + item.id
      ].courseId = "other";
    },
    (capture, item) => {
      item.payload.directDataSources.relation.elements.push(
        item.payload.directDataSources.relation.elements[0],
      );
    },
    (capture, item) => {
      item.payload.directDataSources.receipts.atom.status = 206;
    },
    (capture, item) => {
      item.payload.directDataSources.receipts.atom.sha256 =
        sourceHash("different");
    },
    (capture, item) => {
      item.payload.directDataSources.receipts.stability.updatedAt++;
    },
    (capture, item) => {
      item.payload.directDataEvidence.stableSource = false;
    },
    (capture, item) => {
      item.payload.directDataEvidence.sourceState = "PUBLISHED";
    },
    (capture, item) => {
      item.payload.directDataEvidence.assetId = "c".repeat(22) + "@1";
    },
    (capture, item) => {
      item.payload.directDataEvidence.rawCmlSha256 = sourceHash("other body");
    },
    (capture, item) => {
      item.payload.directDraftCml = {
        ...item.payload.directDraftCml,
        definition: {
          ...item.payload.directDraftCml.definition,
          value: "Older published body",
        },
      };
    },
    (capture, item) => {
      item.payload.directDataEvidence.unresolvedAssetReferences.push(
        "unresolved-attachment",
      );
    },
    (capture, item) => {
      item.payload.directDataEvidence.assetReferenceCount = 1;
    },
    (capture, item) => {
      item.payload.directDataEvidence.assetsBodyVerified = false;
    },
    (capture, item) => {
      item.payload.textSha256 = sourceHash("other normalized text");
    },
    (capture, item) => {
      item.payload.textCaptureTruncated = true;
    },
    (capture, item) => {
      item.payload.textCaptureEvidence = { method: "EXACT_READING_FIELD" };
    },
    (capture, item) => {
      item.captureContract.status = "COMPLETE_READING";
    },
    (capture) => {
      capture.meta.directDataCapture.finalMaterialHash =
        sourceHash("changed material");
    },
  ];
  for (const change of changes) {
    const capture = directReadingCapture();
    change(capture, capture.fingerprints[0]);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, String(change));
    assert(
      verdict.reasons.some((reason) => reason.startsWith("DIRECT_")),
      verdict.reasons.join("\n"),
    );
  }
});

test("direct reading source media stays unverified even when its exported asset flags claim none", () => {
  for (const markup of [
    '<img src="https://example.test/unfetched.png"/>',
    '<media:image xmlns:media="urn:synthetic" src="https://example.test/unfetched.png"/>',
    '<asset id="unresolved-asset"/>',
    '<iframe src="https://example.test/body"/>',
    '<a href="https://example.test/attachment.pdf">Attachment</a>',
    '<a download="attachment" href="https://example.test/body">Attachment</a>',
    "<script>unverified source</script>",
    "<style>unverified source</style>",
    '<!DOCTYPE co-content [<!ENTITY synthetic "source">]>',
  ]) {
    const capture = directReadingCapture(),
      payload = capture.fingerprints[0].payload;
    const value =
      "<co-content><p>Current draft body</p>" + markup + "</co-content>";
    const source = payload.directDataSources.atom.elements[0].draft;
    source.content.definition.content.definition.value = value;
    payload.directDraftCml.definition.value = value;
    payload.directDataSources.receipts.stability.atom.elements[0].draft =
      structuredClone(source);
    payload.directDataSources.receipts.stability.draftHash = modelHash(source);
    payload.directDataEvidence.draftHash = modelHash(source);
    payload.directDataEvidence.rawCmlLength = value.length;
    payload.directDataEvidence.rawCmlSha256 = sourceHash(value);
    assert.equal(payload.directDataEvidence.assetReferenceCount, 0);
    assert.equal(payload.directDataEvidence.assetsBodyVerified, true);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, markup);
    assert(
      verdict.reasons.includes("DIRECT_DRAFT_READING_SOURCE_INVALID:reading-1"),
      verdict.reasons.join("\n"),
    );
  }
});

test("empty structural completion requires a bound material receipt and an explicitly empty known structure", () => {
  const capture = directReadingCapture(),
    item = capture.fingerprints[0];
  delete item.atomId;
  delete item.contentId;
  item.type = "Module";
  item.captureContract.status = "COMPLETE_EMPTY_STRUCTURE";
  item.payload = {
    directDataEvidence: {
      method: "BOUND_AUTHORING_DRAFT_API",
      courseId: directCourseId,
      itemId: item.id,
      sourceState: "AUTHORING_DRAFT",
      stableSource: true,
      structural: true,
      noContent: true,
      childCount: 0,
    },
    directDataSources: {
      materials: {
        rootCourseId: directCourseId,
        leaf: {
          id: item.id,
          originalName: "Original empty module",
          elements: [],
          description: "",
          learningObjectives: [],
          timeCommitment: 0,
        },
        ancestorIds: [],
      },
      receipts: {
        materials: receipt("authoringCourseMaterials.v1", directCourseId),
        stability: { stable: true },
      },
    },
  };
  attachMaterials(capture, item.payload.directDataSources.materials.leaf);
  assert.equal(evaluateCourseraCapture(capture, directCourseId).complete, true);
  for (const mutate of [
    (sources) => {
      sources.materials.leaf.content = null;
    },
    (sources) => {
      delete sources.materials.leaf.elements;
    },
    (sources) => {
      sources.materials.leaf.elements.push({ id: "unaccounted-child" });
    },
    (sources) => {
      sources.materials.rootCourseId = "other";
    },
    (sources) => {
      sources.materials.leaf.id = "other";
    },
    (sources) => {
      sources.materials.ancestorIds.push("module", "lesson");
    },
    (sources) => {
      delete sources.materials.leaf.description;
    },
    (sources) => {
      sources.receipts.materials.id = "other";
    },
  ]) {
    const modified = structuredClone(capture);
    mutate(modified.fingerprints[0].payload.directDataSources);
    assert.equal(
      evaluateCourseraCapture(modified, directCourseId).complete,
      false,
      String(mutate),
    );
  }
});

function directAssessmentCapture() {
  const capture = directReadingCapture(),
    item = capture.fingerprints[0],
    payload = item.payload;
  item.type = "Graded Assignment";
  item.captureContract.status = "COMPLETE_BOUND_DRAFT_ASSESSMENT";
  const partIds = ["c".repeat(22), "b".repeat(22)],
    definitionIds = ["d".repeat(22), "e".repeat(22)];
  const cml = (text) => ({
    typeName: "cml",
    definition: {
      dtdId: "staffGraded/1",
      value: "<co-content><p>" + text + "</p></co-content>",
    },
  });
  const groups = partIds.map((part, index) => ({
    id: directAtomId + "~" + part,
    questions: [directAtomId + "~" + definitionIds[index] + "@1"],
  }));
  const definitions = definitionIds.map((id, index) => ({
    id: directAtomId + "~" + id + "@1",
    definition: {
      typeName: index ? "checkbox" : "mcq",
      definition: {
        prompt: cml("Original question " + (index + 1)),
        options: ["alpha", "beta", "gamma"].map((option) => ({
          id: option,
          display: cml(option),
          feedback: cml("feedback " + option),
        })),
        ...(index
          ? { correctOptions: ["alpha", "gamma"] }
          : { correctOption: "beta" }),
      },
    },
  }));
  const questions = definitions.map((source, index) => {
    const native = source.definition.definition,
      correct = index ? native.correctOptions : [native.correctOption];
    const options = native.options.map((option) => ({
      id: option.id,
      sourceOptionId: option.id,
      text: option.id,
      correct: correct.includes(option.id),
    }));
    return {
      id: String(index + 1),
      courseraQuestionId: groups[index].id,
      sourceDefinitionId: source.id,
      questionOrdinalObserved: true,
      rawType: source.definition.typeName,
      observationMethod: "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION",
      type: index ? "multiple-select" : "single-select",
      prompt: "Original question " + (index + 1),
      answerTextReliable: true,
      optionTextReliable: true,
      options,
      correctAnswers: options
        .filter((option) => option.correct)
        .map((option) => option.text),
      answerKeyEvidence: index
        ? {
            method: "EXACT_CORRECT_OPTION_ID_SET",
            correctOptions: [...correct],
          }
        : { method: "EXACT_CORRECT_OPTION_ID", correctOption: correct[0] },
    };
  });
  const parts = partIds.map((id) => ({
    typeName: "storedQuestionGroupPart",
    definition: { id },
  }));
  const draft = {
    content: { typeName: "staffGradedDraft", definition: { parts } },
  };
  payload.directDataSources.atom.elements[0].draft = draft;
  payload.directDataSources.receipts.stability.draftHash = modelHash(draft);
  payload.directDataSources.receipts.stability.atom.elements[0].draft =
    structuredClone(draft);
  payload.directDataEvidence = {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId: directCourseId,
    itemId: item.id,
    atomId: directAtomId,
    contentId: item.contentId,
    sourceState: "AUTHORING_DRAFT",
    stableSource: true,
    draftHash: modelHash(draft),
    storedAtomVersion: 1,
    updatedAt: 1700000000000,
    declaredContentParts: 2,
    orderedGroupIds: groups.map((group) => group.id),
  };
  payload.assessmentApiEvidence = {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId: directCourseId,
    itemId: item.id,
    assignmentId: directAtomId,
    inventory: groups.map((group, index) => ({
      id: group.id,
      ordinal: index + 1,
    })),
    groups: groups.toReversed(),
    questionDefinitions: definitions.toReversed(),
    groupStability: groups.map((group) => ({
      id: group.id,
      stable: true,
      group: structuredClone(group),
      receipt: receipt("authoringAssignmentQuestionGroups.v1", group.id),
    })),
    receipts: [
      ...groups.map((group) =>
        receipt("authoringAssignmentQuestionGroups.v1", group.id),
      ),
      ...definitions.map((definition) =>
        receipt(
          "authoringAssignmentMachineEvaluableQuestions.v1",
          definition.id,
        ),
      ),
    ],
  };
  payload.structuredAssessment = {
    declaredQuestionCount: 2,
    questionCount: 2,
    questions,
    captureCompleteness: {
      declared: 2,
      captured: 2,
      questionCoverageComplete: true,
      requiredAnswerCoverageComplete: true,
      missingQuestionOrdinals: [],
      missingRequiredAnswerOrdinals: [],
    },
  };
  delete payload.directDraftCml;
  return attachMaterials(capture, {
    id: item.id,
    originalName: "Original assessment",
    atomId: directAtomId,
    contentId: item.contentId,
    content: {
      typeName: "staffGraded",
      definition: { assignmentId: "z".repeat(22) + "@3" },
    },
    elements: [],
  });
}

test("direct assessments require native source order, exact versioned definition references and explicit native keys", () => {
  const capture = directAssessmentCapture(),
    before = JSON.stringify(capture);
  const verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
  assert.equal(JSON.stringify(capture), before);
  assert.notEqual(
    capture.fingerprints[0].payload.structuredAssessment.questions[0]
      .sourceDefinitionId,
    capture.meta.directDataCapture.materials.elements[0].material.elements[0]
      .elements[0].content.definition.assignmentId,
    "The retained published assignment reference is not used to infer draft question ownership",
  );
});

test("raw native source and ordered questions cannot silently disagree in a direct assessment", () => {
  const changes = [
    (payload) => {
      payload.directDataEvidence.orderedGroupIds.reverse();
    },
    (payload) => {
      payload.assessmentApiEvidence.inventory[0].ordinal = 2;
    },
    (payload) => {
      payload.assessmentApiEvidence.groups[0].questions.push("other~version@1");
    },
    (payload) => {
      payload.assessmentApiEvidence.groups[0].questions[0] =
        payload.assessmentApiEvidence.groups[0].questions[0].replace(
          "@1",
          "@2",
        );
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].id =
        payload.assessmentApiEvidence.questionDefinitions[1].id;
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].definition.typeName =
        "unknownType";
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[1].definition.definition.correctOption =
        "missing-option";
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].definition.definition.prompt.definition.value =
        '<co-content><p>Prompt</p><img src="https://example.test/unfetched.png"/></co-content>';
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].definition.definition.options[0].feedback.definition.value =
        '<co-content><a href="https://example.test/attachment.pdf">Attachment</a></co-content>';
    },
    (payload) => {
      payload.assessmentApiEvidence.receipts[0].id = "other~group";
    },
    (payload) => {
      payload.assessmentApiEvidence.receipts = [];
    },
    (payload) => {
      delete payload.assessmentApiEvidence.groupStability;
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability.pop();
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[1].id =
        payload.assessmentApiEvidence.groupStability[0].id;
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].stable = false;
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].group.questions[0] =
        payload.assessmentApiEvidence.groupStability[0].group.questions[0].replace(
          "@1",
          "@2",
        );
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].group.typeName =
        "changed-type";
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].receipt.id =
        "other~group";
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].receipt.originalResponseSha256 =
        sourceHash("other receipt");
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].definition.definition.correctOptions.push(
        "alpha",
      );
    },
    (payload) => {
      payload.structuredAssessment.questions.reverse();
    },
    (payload) => {
      payload.structuredAssessment.questions[0].sourceDefinitionId =
        "other~definition@1";
    },
    (payload) => {
      payload.structuredAssessment.questions[0].options[0].correct = true;
    },
    (payload) => {
      payload.structuredAssessment.questions[0].options[1].sourceOptionId =
        "alpha";
    },
    (payload) => {
      payload.structuredAssessment.questions[0].correctAnswers = [
        "guessed answer",
      ];
    },
    (payload) => {
      payload.structuredAssessment.questions[1].answerKeyEvidence.correctOptions =
        ["alpha"];
    },
    (payload) => {
      payload.structuredAssessment.captureCompleteness.requiredAnswerCoverageComplete = false;
    },
    (payload) => {
      payload.directDataSources.atom.elements[0].draft.content.definition.parts.reverse();
    },
  ];
  for (const change of changes) {
    const capture = directAssessmentCapture();
    change(capture.fingerprints[0].payload);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, String(change));
    assert(
      verdict.reasons.some((reason) => reason.startsWith("DIRECT_")),
      verdict.reasons.join("\n"),
    );
  }
});

test("direct capture inventory remains bound to the complete material hierarchy even if exported counts agree", () => {
  const capture = directReadingCapture();
  const leaf =
    capture.meta.directDataCapture.materials.elements[0].material.elements[0]
      .elements[0];
  for (const envelope of [
    capture.meta.directDataCapture.materials,
    capture.meta.directDataCapture.finalMaterials,
  ])
    envelope.elements[0].material.elements[0].elements.push({
      ...structuredClone(leaf),
      id: "missing-leaf",
    });
  const verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(
    verdict.inventoryCount,
    1,
    "Existing accounting is retained as supplied",
  );
  assert.equal(verdict.complete, false);
  assert(verdict.reasons.includes("DIRECT_DRAFT_MATERIAL_INVENTORY_INVALID"));
});

test("direct source evidence cannot bypass strict verification by downgrading its mode or completion flags", () => {
  for (const [change, expectedReason] of [
    [(capture) => { delete capture.meta.directDataCapture.mode; }, "DIRECT_DRAFT_CAPTURE_MODE_INVALID"],
    [(capture) => { capture.meta.directDataCapture.mode = "BOUND_AUTHORING_DRAF_API"; }, "DIRECT_DRAFT_CAPTURE_MODE_INVALID"],
    [(capture) => { capture.meta.directDataCapture.acquisitionComplete = false; }, "DIRECT_DRAFT_ACQUISITION_NOT_COMPLETE"],
    [(capture) => { capture.meta.directDataCapture.wholeCourseVerified = false; }, "DIRECT_DRAFT_WHOLE_COURSE_NOT_VERIFIED"],
    [(capture) => { delete capture.meta.directDataCapture; }, "DIRECT_DRAFT_CAPTURE_MODE_INVALID"],
  ]) {
    const capture = directReadingCapture();
    change(capture);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, String(change));
    assert(verdict.reasons.includes(expectedReason), verdict.reasons.join("\n"));
  }
});
