import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import {
  directAssessmentContractV1,
  parseCourseraReflectionDefinitionDirectV1,
} from "../src/extractors/coursera/direct-data-contracts.js";
import { directDraftAssessmentInventoryV1 } from "../src/extractors/coursera/direct-data-models.js";
import {
  qaNativeReflectionEvidence_,
  qaNormalizeAssessment_,
  qaNormalizeQuestion_,
} from "../src/engine/assessment/questions.js";
import { normalizeCourseraItem_ } from "../src/engine/capture/normalization.js";
import { qaStructuredAssessmentComparison_ } from "../src/engine/assessment/comparison.js";
import { qaAssessmentAnswerEvidenceText_ } from "../src/reporting/assessment-evidence.js";
import { qaAssessmentAnswerEvidenceSide_ } from "../src/engine/assessment/rubrics.js";
import {
  buildContentSnapshot,
  capturedContent,
  contentQuestion,
  contentQuestionText,
  validateContentSnapshot,
} from "../src/domain/content-evidence.ts";

const courseId = "Native_reflection_course_123",
  atomId = "a".repeat(22),
  slug = "native-reflection";
const hash = (value) =>
  createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex");
const cml = (text) => ({
  typeName: "cml",
  definition: {
    dtdId: "assess/1",
    value: `<co-content><text>${text}</text></co-content>`,
  },
});
const receipt = (resource, id) => ({
  resource,
  id,
  status: 200,
  sha256: "b".repeat(64),
  originalResponseSha256: "b".repeat(64),
  bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
  requestPath: "/api/" + resource + "/" + id,
});

function reflectionFixture() {
  const parts = ["g", "h"].map((value) => ({
    typeName: "storedQuestionGroupPart",
    definition: { id: value.repeat(22) },
  }));
  const candidates = parts.map((part, index) => ({
    id: atomId + "~" + part.definition.id,
    ordinal: index + 1,
    label: "",
  }));
  const definitions = ["mcqReflect", "checkboxReflect"].map((kind, index) => ({
    id: atomId + "~" + (index ? "r" : "q").repeat(22) + "@1",
    definition: {
      typeName: kind,
      definition: {
        prompt: cml("Choose your preferred method " + (index + 1)),
        shuffleOptions: false,
        ...(index ? {} : { noChosenFeedback: cml("") }),
        options: ["First", "Second"].map((text, position) => ({
          id: "option-" + position,
          display: cml(text),
          feedback: cml(position ? "" : "Literal feedback"),
        })),
      },
    },
  }));
  const groups = candidates.map((candidate, index) => ({
    id: candidate.id,
    questions: [definitions[index].id],
  }));
  const draft = {
    name: "Unkeyed reflection",
    content: {
      typeName: "staffGradedDraft",
      definition: { parts, configuration: { isGraded: false } },
    },
  };
  const atom = {
    id: atomId,
    contentId: "atom~" + atomId,
    storedAtomVersion: 1,
    metadata: { updatedAt: 1700000000000 },
    status: { typeName: "draftAtomStatus" },
    draft,
  };
  const relation = {
    id: atomId,
    atomId,
    branchRelationMap: {
      [courseId + "~item1"]: { courseId, itemId: "item1", courseSlug: slug },
    },
  };
  const bound = {
    courseId,
    itemId: "item1",
    courseSlug: slug,
    atomId,
    contentId: atom.contentId,
    sourceState: "AUTHORING_DRAFT",
    storedAtomVersion: 1,
    updatedAt: atom.metadata.updatedAt,
    draft,
  };
  const inventory = directDraftAssessmentInventoryV1(bound);
  const assessment = {
    schemaVersion: 6,
    parser: "coursera-bound-authoring-draft-api-v1",
    origin: "coursera-authoring-api",
    parserConfidence: 0.98,
    declaredQuestionCount: 2,
    questionCount: 2,
    answerEvidenceQuestionCount: 0,
    configuration: draft.content.definition.configuration,
    questions: definitions.map((definition, index) =>
      parseCourseraReflectionDefinitionDirectV1(definition, candidates[index]),
    ),
  };
  const item = {
    id: "item1",
    name: "Unkeyed reflection",
    type: "Assignment",
    typeName: "ungradedAssignment",
    atomId,
    contentId: atom.contentId,
    payload: {
      directDataSources: {
        atom: { elements: [atom] },
        relation: { elements: [relation] },
        receipts: {
          atom: receipt("authoringAtoms.v2", atomId),
          relation: receipt("authoringItemContentRelations.v1", atomId),
          stability: {
            stable: true,
            draftHash: hash(draft),
            storedAtomVersion: 1,
            updatedAt: atom.metadata.updatedAt,
            atom: { elements: [structuredClone(atom)] },
            receipt: receipt("authoringAtoms.v2", atomId),
          },
        },
      },
      directAssessmentInventory: inventory,
      assessmentApiEvidence: {
        method: "BOUND_AUTHORING_DRAFT_API",
        courseId,
        itemId: "item1",
        assignmentId: atomId,
        rawParts: parts,
        unsupportedParts: [],
        failures: [],
        inventory: candidates,
        groups,
        questionDefinitions: definitions,
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
      },
    },
  };
  assert.equal(
    directAssessmentContractV1(item, assessment, inventory, bound).complete,
    true,
  );
  return {
    item,
    assessment,
    capture: {
      extractedAt: "2026-10-19T12:00:00.000Z",
      page: {
        courseId,
        url: `https://www.coursera.org/teach/${slug}/${courseId}/content/edit`,
      },
      fingerprints: [item],
    },
  };
}

function comparisonPair(item) {
  const destination = normalizeCourseraItem_(item, courseId);
  return {
    source: {
      isStructuredAssessment: true,
      structuredAssessment: destination.structuredAssessment,
      original: item,
      nativeGradingCourseId: courseId,
    },
    destination,
  };
}

test("native reflection normalization preserves explicit applicability, source identity and unmarked choices", () => {
  const f = reflectionFixture(),
    before = JSON.stringify(f.item);
  const native = qaNativeReflectionEvidence_(f.item, courseId);
  assert(native);
  const assessment = qaNormalizeAssessment_(
    f.assessment,
    "coursera-assignment",
  );
  assert.equal(assessment.answerableQuestionCount, 0);
  assert.equal(assessment.answerEvidenceQuestionCount, 0);
  for (const [index, question] of assessment.questions.entries()) {
    assert.equal(question.answerKeyApplicable, false);
    assert.deepEqual(
      question.answerKeyEvidence,
      f.assessment.questions[index].answerKeyEvidence,
    );
    assert.equal(
      question.sourceDefinitionId,
      f.assessment.questions[index].sourceDefinitionId,
    );
    assert.equal(
      question.observationMethod,
      "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION",
    );
    assert.deepEqual(
      question.options.map((option) => option.correct),
      [null, null],
    );
    assert.deepEqual(question.correctAnswers, []);
    assert.deepEqual(
      qaNormalizeQuestion_(question, index),
      question,
      "Repeated normalization preserves provenance",
    );
  }
  assert.equal(JSON.stringify(f.item), before);
});

test("a complete source-bound reflection comparison reports key applicability as N/A rather than 100 percent", () => {
  const f = reflectionFixture(),
    before = JSON.stringify(f.item),
    { source, destination } = comparisonPair(f.item);
  const result = qaStructuredAssessmentComparison_(source, destination);
  assert.equal(result.status, "VERIFIED", result.reason);
  assert.equal(result.unknownTypeCount, 0);
  assert.equal(result.answerEvidenceApplicable, false);
  assert.equal(result.answerEvidenceCoverage, null);
  assert.equal(result.courseraNativeReflectionQuestionCount, 2);
  assert.equal(result.sourceNativeReflectionQuestionCount, 2);
  assert.match(
    qaAssessmentAnswerEvidenceText_(result),
    /^N\/A.*native reflection/,
  );
  assert.doesNotMatch(qaAssessmentAnswerEvidenceText_(result), /100%/);
  assert.equal(JSON.stringify(f.item), before);
});

test("bare false flags and reflection labels never establish native no-key semantics", () => {
  const f = reflectionFixture(),
    normalized = qaNormalizeAssessment_(f.assessment, "coursera-assignment");
  const result = qaStructuredAssessmentComparison_(
    { isStructuredAssessment: true, structuredAssessment: normalized },
    { structuredAssessment: normalized },
  );
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(result.unknownTypeCount, 4);
  assert.equal(result.nativeReflectionKeyApplicability, false);
  assert.equal(result.answerEvidenceApplicable, true);
  assert.equal(result.answerEvidenceCoverage, null);
  const keyed = {
    type: "single-select",
    prompt: "A question with a missing key",
    options: [
      { text: "One", correct: null },
      { text: "Two", correct: null },
    ],
    correctAnswers: [],
    answerTextReliable: false,
    answerKeyApplicable: false,
    answerKeyEvidence: {
      method: "NATIVE_REFLECTION_NO_KEY",
      applicable: false,
      nativeType: "mcqReflect",
    },
  };
  const assessment = { parserConfidence: 0.98, questions: [keyed] };
  const missing = qaStructuredAssessmentComparison_(
    { isStructuredAssessment: true, structuredAssessment: assessment },
    { structuredAssessment: assessment },
  );
  assert.equal(missing.answerEvidenceApplicable, true);
  assert.equal(missing.answerEvidenceCoverage, 0);
  assert.equal(missing.status, "UNVERIFIED");
});

test("side-specific reporting exempts only the comparator's bound native reflection proof", () => {
  const f = reflectionFixture(),
    destination = normalizeCourseraItem_(f.item, courseId);
  const questions = f.assessment.questions.map((question) => ({
    ...question,
    type: "single-select",
    rawType: "mcq",
    answerTextReliable: true,
    correctAnswers: ["First"],
    options: question.options.map((option, index) => ({
      ...option,
      correct: index === 0,
    })),
  }));
  const source = {
    isStructuredAssessment: true,
    structuredAssessment: {
      parserConfidence: 0.98,
      declaredQuestionCount: 2,
      questions,
    },
  };
  const result = qaStructuredAssessmentComparison_(source, destination);
  assert.equal(
    result.answerEvidenceApplicable,
    true,
    "A native reflection cannot exempt the keyed source side",
  );
  assert.equal(result.answerEvidenceCoverage, null);
  assert.equal(qaAssessmentAnswerEvidenceSide_(result, "source"), "COMPLETE");
  assert.equal(
    qaAssessmentAnswerEvidenceSide_(result, "coursera"),
    "NOT_APPLICABLE",
  );
  assert.match(
    qaAssessmentAnswerEvidenceText_(result),
    /not comparable.*native reflection/,
  );
  assert.notEqual(result.status, "VERIFIED");
  for (const change of [
    (q) => {
      q.courseraNativeReflectionEvidence = null;
    },
    (q) => {
      q.courseraNativeReflectionEvidence.sourceDraftSha256 = "unknown";
    },
    (q) => {
      q.courseraNativeReflectionQuestionCount = 1;
    },
    (q) => {
      q.courseraNativeReflectionEvidence.method = "GUESS_FROM_UNGRADED_TITLE";
    },
  ]) {
    const invalid = structuredClone(result);
    change(invalid);
    assert.equal(
      qaAssessmentAnswerEvidenceSide_(invalid, "coursera"),
      "UNKNOWN",
      String(change),
    );
  }
});

test("source changes, invented keys, stale rechecks and unrelated provenance withdraw reflection applicability", () => {
  const mutations = [
    (f) => {
      f.item.payload.directReflectionAssessmentEvidence.sourceDraftSha256 =
        "f".repeat(64);
    },
    (f) => {
      f.item.payload.directDataSources.receipts.stability.atom.elements[0].draft.content.definition.configuration.isGraded = true;
    },
    (f) => {
      f.item.payload.structuredAssessment.questions[0].options[0].correct = false;
    },
    (f) => {
      f.item.payload.structuredAssessment.questions[0].correctAnswers = [
        "First",
      ];
    },
    (f) => {
      f.item.payload.directDataSources.relation.elements[0].branchRelationMap[
        courseId + "~item1"
      ].itemId = "foreign";
    },
    (f) => {
      f.item.payload.directResumeRevalidation = { verified: false };
    },
    (f) => {
      f.item.payload.assessmentApiEvidence.groupStability[0].stable = false;
    },
    (f) => {
      f.item.typeName = "gradedAssignment";
    },
    (f) => {
      f.item.payload.captureContract = {
        ...f.item.captureContract,
        complete: false,
      };
    },
    (f) => {
      delete f.item.payload.structuredAssessment.captureCompleteness;
    },
    (f) => {
      f.item.payload.structuredAssessment.captureCompleteness.requiredAnswerCoverageComplete = false;
    },
    (f) => {
      f.item.payload.directDataEvidence.orderedGroupIds = ["foreign"];
    },
    (f) => {
      f.item.payload.directDataEvidence.declaredContentParts = 999;
    },
    (f) => {
      f.item.payload.directDataEvidence.answerKeyApplicability = "UNVERIFIED";
    },
  ];
  for (const mutate of mutations) {
    const f = reflectionFixture();
    mutate(f);
    const before = JSON.stringify(f.item);
    assert.equal(
      qaNativeReflectionEvidence_(f.item, courseId),
      null,
      String(mutate),
    );
    const { source, destination } = comparisonPair(f.item);
    const comparison = qaStructuredAssessmentComparison_(source, destination);
    assert.notEqual(comparison.status, "VERIFIED", String(mutate));
    assert.equal(
      comparison.nativeReflectionKeyApplicability,
      false,
      String(mutate),
    );
    const snapshot = buildContentSnapshot(undefined, undefined, f.capture);
    assert(
      snapshot.coursera[0].content.questions.every(
        (question) =>
          !question.limitations.some((text) =>
            text.startsWith("Source-bound native reflection:"),
          ),
      ),
      String(mutate),
    );
    assert.equal(JSON.stringify(f.item), before);
  }
  const f = reflectionFixture();
  assert.equal(
    qaNativeReflectionEvidence_(f.item, "Foreign_native_course"),
    null,
  );
  const { source, destination } = comparisonPair(f.item);
  destination.structuredAssessment.questions[0].prompt =
    "Changed after the native observation";
  const changed = qaStructuredAssessmentComparison_(source, destination);
  assert.notEqual(changed.status, "VERIFIED");
  assert.equal(changed.courseraNativeReflectionQuestionCount, 0);
});

test("mixed keyed and unkeyed claims stay conservative while ordinary keyed and essay behavior survives", () => {
  const keyed = {
    id: "key",
    type: "single-select",
    prompt: "Which direction is north?",
    options: [
      { text: "Up", correct: true },
      { text: "Down", correct: false },
    ],
    correctAnswers: ["Up"],
    answerTextReliable: true,
  };
  const standard = { parserConfidence: 0.98, questions: [keyed] };
  const ordinary = qaStructuredAssessmentComparison_(
    { isStructuredAssessment: true, structuredAssessment: standard },
    { structuredAssessment: standard },
  );
  assert.equal(ordinary.status, "VERIFIED");
  assert.equal(ordinary.answerEvidenceCoverage, 1);
  const essay = {
    parserConfidence: 0.98,
    questions: [
      {
        id: "written",
        type: "essay",
        prompt: "Explain your approach in writing.",
        options: [],
        correctAnswers: [],
        points: 1,
      },
    ],
  };
  const written = qaStructuredAssessmentComparison_(
    { isStructuredAssessment: true, structuredAssessment: essay },
    { structuredAssessment: essay },
  );
  assert.equal(written.status, "VERIFIED", written.reason);
  assert.equal(written.answerEvidenceApplicable, false);
  assert.equal(
    written.answerEvidenceCoverage,
    1,
    "The legacy all-essay numeric sentinel remains unchanged while its displayed key applicability stays N/A",
  );
  assert.match(qaAssessmentAnswerEvidenceText_(written), /written-response/);
  const f = reflectionFixture(),
    { source, destination } = comparisonPair(f.item);
  source.structuredAssessment.questions = [
    source.structuredAssessment.questions[0],
    keyed,
  ];
  destination.structuredAssessment.questions = [
    destination.structuredAssessment.questions[0],
    keyed,
  ];
  const mixed = qaStructuredAssessmentComparison_(source, destination);
  assert.equal(mixed.status, "UNVERIFIED");
  assert.equal(mixed.answerEvidenceCoverage, null);
  assert.equal(mixed.sourceAnswerEvidenceQuestionCount, 1);
  assert.equal(mixed.courseraAnswerEvidenceQuestionCount, 1);
});

test("content labels native key inapplicability only with complete context and retains original literal evidence", () => {
  const f = reflectionFixture(),
    before = JSON.stringify(f.capture),
    snapshot = buildContentSnapshot(undefined, undefined, f.capture);
  validateContentSnapshot(snapshot);
  for (const question of snapshot.coursera[0].content.questions) {
    assert.deepEqual(question.answers, []);
    assert.equal(question.answerKeyReliable, false);
    assert(
      question.limitations.some((text) =>
        text.startsWith("Source-bound native reflection:"),
      ),
    );
    assert.match(
      contentQuestionText(question),
      /no authored correct-answer key/,
    );
    assert.equal(question.options[0].feedback, "Literal feedback");
  }
  const generic = contentQuestion(f.assessment.questions[0]);
  assert(
    !generic.limitations.some((text) =>
      text.startsWith("Source-bound native reflection:"),
    ),
  );
  const unbound = capturedContent(f.item.payload, { basis: "Unbound input" });
  assert(
    unbound.questions.every(
      (q) =>
        !q.limitations.some((text) =>
          text.startsWith("Source-bound native reflection:"),
        ),
    ),
  );
  assert.equal(JSON.stringify(f.capture), before);
});
