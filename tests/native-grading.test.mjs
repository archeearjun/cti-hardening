import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectDirectNativeGrading as inspectWithCourse,
  observeDirectNativeGrading as observeWithCourse,
} from "../src/engine/assessment/native-grading.js";
import {
  normalizeCourseraItem_ as normalizeWithCourse,
  qaBehaviorComparison_,
} from "../src/engine/capture/normalization.js";
import { qaHasAiGraderPlaceholder_ } from "../src/engine/provenance/current-state.js";
import { qaMergeCourseraPayload_ } from "../src/engine/capture/recovery.js";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { writeWorkbook } from "../src/adapters/workbook.ts";
import { createHash } from "node:crypto";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { comparisonFixture, encode } from "./workflow-fixtures.mjs";
import { gradingFixture, gradingCourseId } from "./native-grading-fixtures.mjs";

const inspectDirectNativeGrading = (item) =>
  inspectWithCourse(item, gradingCourseId);
const observeDirectNativeGrading = (item) =>
  observeWithCourse(item, gradingCourseId);
const normalizeCourseraItem_ = (item) =>
  normalizeWithCourse(item, gradingCourseId);

const source = (settings) => ({
  id: "source-practice",
  type: "Assignment",
  behavior: { observed: true, settings, submission: {} },
});

test("the exact stable native draft supplies true and false without reading the title or published state", () => {
  for (const graded of [true, false]) {
    const { item, sources } = gradingFixture(graded),
      before = structuredClone(item),
      observed = observeDirectNativeGrading(item);
    assert.equal(observed.graded, graded);
    assert.equal(observed.courseId, gradingCourseId);
    assert.equal(observed.itemId, item.id);
    assert.equal(observed.atomId, item.atomId);
    assert.equal(observed.scope, "GRADING_SETTING_ONLY");
    assert.equal(observed.method, "BOUND_AUTHORING_DRAFT_API");
    assert.equal(observed.sourceState, "AUTHORING_DRAFT");
    assert.equal(
      observed.field,
      "draft.content.definition.configuration.isGraded",
    );
    assert.equal(observed.draftHash, sources.receipts.stability.draftHash);
    assert.equal(observed.updatedAt, 1792224000000);
    assert.equal(observed.storedAtomVersion, 3);
    assert.equal(observed.observedAt, sources.receipts.atom.observedAt);
    assert.deepEqual(item, before);
    item.name = graded ? "Practice [Ungraded]" : "Graded final exam";
    assert.equal(observeDirectNativeGrading(item).graded, graded);
  }
});

test("absent, null and non-boolean native graded settings never become false or true", () => {
  for (const value of [null, 0, 1, "true", "false", "", {}, []]) {
    const { item } = gradingFixture(value);
    assert.equal(observeDirectNativeGrading(item), null);
    assert.equal(normalizeCourseraItem_(item).nativeAssignment, null);
    assert.equal(
      "nativeGradingObservation" in normalizeCourseraItem_(item),
      false,
    );
  }
  const { item } = gradingFixture();
  delete item.payload.directDataSources.atom.elements[0].draft.content
    .definition.configuration.isGraded;
  assert.equal(observeDirectNativeGrading(item), null);
});

test("projection alone, unrelated items, unstable and contradictory native sources are rejected", () => {
  const cases = {
    "projection only": (f) => {
      delete f.item.payload.directDataSources;
    },
    "missing evidence": (f) => {
      delete f.item.payload.directDataEvidence;
    },
    "wrong item": (f) => {
      f.item.id = "otherItem";
    },
    "wrong course": (f) => {
      f.item.payload.directDataEvidence.courseId = "Other_course_123";
    },
    "contradictory item course": (f) => {
      f.item.courseId = "Other_course_123";
    },
    "wrong atom": (f) => {
      f.item.atomId = "x".repeat(22);
    },
    "extra atom": (f) => {
      f.sources.atom.elements.push(structuredClone(f.atom));
    },
    "wrong relation": (f) => {
      f.relation.atomId = "x".repeat(22);
    },
    "wrong branch": (f) => {
      f.relation.branchRelationMap[gradingCourseId + "~gradingItem"].itemId =
        "otherItem";
    },
    "wrong draft kind": (f) => {
      f.atom.draft.content.typeName = "supplementDraft";
    },
    "published-only atom": (f) => {
      delete f.atom.draft;
    },
    "stability flag only": (f) => {
      delete f.sources.receipts.stability.atom;
    },
    "source changed": (f) => {
      f.sources.receipts.stability.atom.elements[0].draft.name = "Changed";
    },
    "false stable flag": (f) => {
      f.sources.receipts.stability.stable = false;
    },
    "false resume revalidation": (f) => {
      f.item.payload.directResumeRevalidation = { verified: false };
    },
    "wrong receipt": (f) => {
      f.sources.receipts.atom.id = "x".repeat(22);
    },
    "wrong receipt resource": (f) => {
      f.sources.receipts.atom.resource = "authoringAtoms.v1";
    },
    "wrong draft SHA": (f) => {
      f.sources.receipts.stability.draftHash = "c".repeat(64);
      f.item.payload.directDataEvidence.draftHash = "c".repeat(64);
    },
    "wrong claimed proof": (f) => {
      f.item.payload.directDataEvidence.itemId = "otherItem";
    },
    "graded projection conflicts": (f) => {
      f.item.payload.structuredAssessment.configuration.isGraded = false;
    },
    "configuration projection incomplete": (f) => {
      delete f.item.payload.structuredAssessment.configuration
        .submissionLimitForEachAttempt;
    },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const f = gradingFixture();
    mutate(f);
    assert.equal(observeDirectNativeGrading(f.item), null, label);
    const normalized = normalizeCourseraItem_(f.item);
    assert.equal(normalized.nativeAssignment, null, label);
    assert.equal("nativeGradingObservation" in normalized, false, label);
  }
});

test("grading metadata does not certify question coverage or create grader/submission capabilities", () => {
  const { item } = gradingFixture();
  delete item.payload.structuredAssessment;
  item.payload.textSample = "Enter instructions for AI graders";
  const normalized = normalizeCourseraItem_(item);
  assert.equal(normalized.nativeGradingObservation.graded, true);
  assert.equal(normalized.nativeAssignment, null);
  assert.equal(qaHasAiGraderPlaceholder_(normalized), true);
  assert.equal(
    normalized.nativeGradingObservation.editorSurfaceObserved,
    undefined,
  );
  assert.equal(normalized.nativeGradingObservation.graderType, undefined);
  assert.equal(normalized.nativeGradingObservation.submission, undefined);
  assert.equal(normalized.nativeGradingObservation.attempts, undefined);
  assert.equal(normalized.nativeGradingObservation.passingThreshold, undefined);
});

test("a valid receipt acquisition timestamp is separate from native updatedAt", () => {
  for (const value of [
    undefined,
    null,
    "",
    "invalid",
    "2026-10-17",
    1792224000000,
  ]) {
    const { item, sources } = gradingFixture();
    sources.receipts.atom.observedAt = value;
    const observed = observeDirectNativeGrading(item);
    assert.equal(observed.graded, true);
    assert.equal(observed.updatedAt, 1792224000000);
    assert.equal("observedAt" in observed, false);
  }
});

test("explicit ungraded source versus explicit native graded detects the real setting change", () => {
  const normalized = normalizeCourseraItem_(gradingFixture(true).item),
    before = structuredClone(normalized),
    result = qaBehaviorComparison_(source({ graded: false }), normalized);
  assert.equal(result.status, "MUTATED");
  assert.deepEqual(result.mismatches, ["GRADED_STATE_CHANGED"]);
  assert.equal(result.coursera.settings.graded, true);
  assert.deepEqual(normalized, before);
  assert.equal(normalized.nativeAssignment, null);
  for (const graded of [true, false]) {
    const match = qaBehaviorComparison_(
      source({ graded }),
      normalizeCourseraItem_(gradingFixture(graded).item),
    );
    assert.equal(match.status, "VERIFIED");
    assert.deepEqual(match.compared, ["GRADED_STATE"]);
  }
});

test("unknown source grading and per-attempt native limits remain unknown portable behavior", () => {
  const normalized = normalizeCourseraItem_(gradingFixture(true).item),
    result = qaBehaviorComparison_(
      source({ graded: null, gradeLinked: false, attempts: "unlimited" }),
      normalized,
    );
  assert.equal(result.status, "UNVERIFIED");
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(result.compared, []);
  assert.deepEqual(result.unverifiedDimensions, ["ATTEMPTS"]);
  assert.equal(result.coursera.settings.attempts, undefined);
  assert.equal(result.coursera.settings.passingThreshold, undefined);
});

test("existing DOM metadata stays intact while contradictions fail closed only inside grading comparison", () => {
  for (const settings of [
    { graded: false },
    { gradeSetting: "Practice" },
    { graded: true, gradeSetting: "Ungraded" },
  ]) {
    const { item } = gradingFixture(true);
    item.payload.nativeAssignment = {
      parser: "existing-dom-parser",
      parserConfidence: 0.95,
      settings: { ...settings, points: 5 },
      submission: { fileUpload: true },
      currentStateEvidence: { editorSurfaceObserved: true },
    };
    const before = structuredClone(item),
      normalized = normalizeCourseraItem_(item),
      expectedNative = structuredClone(normalized.nativeAssignment),
      result = qaBehaviorComparison_(source({ graded: false }), normalized);
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.reviewRequired, true);
    assert.deepEqual(result.mismatches, []);
    assert(result.issues.includes("GRADED_STATE_UNVERIFIED"));
    assert(result.issues.includes("NATIVE_GRADING_OBSERVATIONS_CONFLICT"));
    assert.equal(result.coursera.settings.graded, undefined);
    assert.equal(result.coursera.settings.gradeSetting, undefined);
    assert.equal(result.coursera.settings.points, 5);
    assert.equal(result.coursera.submission.fileUpload, true);
    assert.equal(
      result.coursera.currentStateEvidence.nativeGradingConflict.direct.graded,
      true,
    );
    assert.deepEqual(normalized.nativeAssignment, expectedNative);
    assert.deepEqual(item, before);
  }
});

test("self-declared normalized grading evidence cannot substitute for retained native models", () => {
  const normalized = normalizeCourseraItem_({
    id: "fake",
    type: "Assignment",
    payload: {},
  });
  normalized.nativeGradingObservation = observeDirectNativeGrading(
    gradingFixture(true).item,
  );
  const result = qaBehaviorComparison_(source({ graded: false }), normalized);
  assert.equal(result.status, "UNVERIFIED");
  assert.deepEqual(result.mismatches, []);
  assert(result.issues.includes("BEHAVIOR_DESTINATION_UNVERIFIED"));
});

test("legacy editor-only grading stays comparable without any direct API projection", () => {
  for (const graded of [true, false]) {
    const normalized = normalizeCourseraItem_({
      id: "legacy",
      type: "Assignment",
      payload: { nativeAssignment: { settings: { graded }, submission: {} } },
    });
    assert.equal("nativeGradingObservation" in normalized, false);
    assert.equal(
      qaBehaviorComparison_(source({ graded }), normalized).status,
      "VERIFIED",
    );
  }
});

test("XLSX enrichment retains minimal raw grading bindings only for the exact case-sensitive item", () => {
  const { item } = gradingFixture(),
    live = normalizeCourseraItem_(item),
    excel = normalizeCourseraItem_({
      id: item.id,
      type: "Assignment",
      name: item.name,
      payload: {},
    }),
    originalWorkbookItem = excel.original,
    merged = qaMergeCourseraPayload_(excel, live);
  assert.equal(merged.original, originalWorkbookItem);
  assert.equal(merged.nativeAssignment, null);
  assert.equal(merged.nativeGradingObservation.graded, true);
  assert.equal(
    merged.nativeGradingSource.payload.assessmentApiEvidence,
    undefined,
  );
  assert.equal(
    merged.nativeGradingSource.payload.structuredAssessment.questions,
    undefined,
  );
  assert.equal(
    observeDirectNativeGrading(merged.nativeGradingSource).graded,
    true,
  );
  assert.deepEqual(
    qaBehaviorComparison_(source({ graded: false }), merged).mismatches,
    ["GRADED_STATE_CHANGED"],
  );
  for (const id of ["differentItem", item.id.toUpperCase(), ""]) {
    const other = qaMergeCourseraPayload_(
      normalizeCourseraItem_({ id, type: "Assignment", name: item.name }),
      live,
    );
    assert.equal(other.nativeGradingSource, undefined);
    assert.equal(other.nativeGradingObservation, undefined);
    assert.deepEqual(
      qaBehaviorComparison_(source({ graded: false }), other).mismatches,
      [],
    );
  }
  merged.id = "differentItem";
  assert.deepEqual(
    qaBehaviorComparison_(source({ graded: false }), merged).mismatches,
    [],
  );
});

function gradingWorkflowInput({
  workbookId = "gradingItem",
  duplicateCapture = false,
  duplicateWorkbook = false,
  nativeOnly = false,
  projectionConflict = false,
  captureCourseId = gradingCourseId,
  materialCourseId = gradingCourseId,
  omitCourseId = false,
} = {}) {
  const input = comparisonFixture(),
    { item } = gradingFixture(true),
    body =
      "The practice exercise has an explicit source grade setting retained without interpreting its title.";
  input.course.data.scan.courseTree[0].children = [
    {
      title: item.name,
      type: "assignment",
      idref: "sourcePractice",
      sourcePayload: {
        textSample: body,
        textLength: body.length,
        textFormat: "learner-text",
        behavior: source({ graded: false }).behavior,
      },
      children: [],
    },
  ];
  input.course.data.scan.stats = {
    webcontent: 0,
    discussions: 0,
    quizzes: 0,
    assignments: 1,
    lti: 0,
    emptyFolders: 0,
    totalItems: 1,
    ifs: 2,
  };
  item.path = "Module 1";
  item.payload.textSample = body;
  item.payload.textLength = body.length;
  item.payload.textScopeKind = "authoring-api-draft";
  item.payload.textEvidenceCompleteness = 1;
  if (projectionConflict) {
    item.payload.nativeAssignment = {
      settings: { graded: false, gradeSetting: "Practice" },
    };
    item.payload.structuredAssessment.configuration.isGraded = false;
  }
  const leaf = {
      id: item.id,
      name: item.name,
      atomId: item.atomId,
      contentId: item.contentId,
      content: { typeName: "staffGraded", definition: {} },
    },
    model = {
      elements: [
        {
          id: materialCourseId,
          material: {
            elements: [{ id: "module_1", name: "Module 1", elements: [leaf] }],
          },
          conflictMetadata: { version: 1, courseBranchVersion: 1 },
        },
      ],
    },
    hash = (value) => createHash("sha256").update(value).digest("hex"),
    receipt = {
      resource: "authoringCourseMaterials.v1",
      id: materialCourseId,
      status: 200,
      sha256: hash(JSON.stringify(model)),
      originalResponseSha256: hash(JSON.stringify(model)),
      requestPath: "/api/authoringCourseMaterials.v1/" + materialCourseId,
      bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    },
    materialHash = hash(directCanonicalSourceTextV1(model.elements[0]));
  const capture = {
    schemaVersion: 35,
    page: {
      courseId: gradingCourseId,
      url:
        "https://www.coursera.org/teach/synthetic-grading-course/" +
        captureCourseId +
        "/content/edit",
    },
    meta: {
      baseFingerprintCount: 1,
      directDataCapture: {
        mode: "BOUND_AUTHORING_DRAFT_API",
        version: 1,
        sourceStable: true,
        acquisitionComplete: true,
        wholeCourseVerified: false,
        materialVersion: 1,
        courseBranchVersion: 1,
        initialMaterialHash: materialHash,
        finalMaterialHash: materialHash,
        materials: model,
        finalMaterials: structuredClone(model),
        materialsReceipt: receipt,
        finalMaterialsReceipt: structuredClone(receipt),
      },
    },
    fingerprints: [item],
  };
  if (duplicateCapture) capture.fingerprints.push(structuredClone(item));
  capture.page.courseId = captureCourseId;
  if (omitCourseId) delete capture.page.courseId;
  input.json = { name: "native-grading.json", bytes: encode(capture) };
  if (nativeOnly) delete input.excel;
  else {
    const row = ["Assignment", item.name, "", "", "", "", "", workbookId],
      rows = [["Module"], ["***Name", "Module 1"], row];
    if (duplicateWorkbook) rows.push(row);
    input.excel = {
      name: "native-grading.xlsx",
      bytes: writeWorkbook({
        name: "native-grading",
        sheets: { "FOR IMPORT": { values: rows } },
      }),
    };
  }
  return input;
}

test("native grading requires an independent enclosing course ID rather than its own claimed course", () => {
  const { item } = gradingFixture();
  for (const expected of [undefined, null, "", "Foreign_course_123", 1]) {
    assert.equal(observeWithCourse(item, expected), null);
    assert.equal(inspectWithCourse(item, expected), null);
    const normalized = normalizeWithCourse(item, expected),
      behavior = qaBehaviorComparison_(source({ graded: false }), normalized);
    assert.equal(normalized.nativeAssignment, null);
    assert.equal("nativeGradingCourseId" in normalized, false);
    assert.equal("nativeGradingObservation" in normalized, false);
    assert.equal(behavior.status, "UNVERIFIED");
    assert.deepEqual(behavior.mismatches, []);
  }
  const workflows = createWorkflows(workerXml);
  for (const options of [
    { captureCourseId: "Foreign_course_123" },
    { captureCourseId: "" },
    { omitCourseId: true },
  ]) {
    const output = workflows.compare(gradingWorkflowInput(options));
    assert.equal(output.result.success, true);
    const row = output.result.itemResults.find(
      (row) => row.sourceId === "sourcePractice",
    );
    assert.equal(row.checks.behavior.status, "UNVERIFIED");
    assert.deepEqual(row.checks.behavior.mismatches, []);
    assert(
      row.checks.behavior.issues.includes("BEHAVIOR_DESTINATION_UNVERIFIED"),
    );
    assert.throws(
      () =>
        workflows.compare(
          gradingWorkflowInput({ ...options, nativeOnly: true }),
        ),
      /course|identity/i,
    );
  }
});

test("actual XLSX plus direct-capture workflow and capture-only inventory both compare the native graded flag", () => {
  const workflows = createWorkflows(workerXml);
  for (const nativeOnly of [false, true]) {
    const output = workflows.compare(gradingWorkflowInput({ nativeOnly }));
    assert.equal(output.result.success, true);
    const item = output.result.itemResults.find(
      (row) => row.sourceId === "sourcePractice",
    );
    assert.equal(item.courseraId, "gradingItem");
    assert.equal(item.checks.behavior.status, "MUTATED");
    assert.deepEqual(item.checks.behavior.mismatches, ["GRADED_STATE_CHANGED"]);
    assert.equal(item.checks.behavior.coursera.settings.graded, true);
    assert.equal(
      item.checks.behavior.coursera.currentStateEvidence.nativeGrading.scope,
      "GRADING_SETTING_ONLY",
    );
    if (nativeOnly)
      assert.equal(
        output.result.structuralInventoryBasis.kind,
        "VERIFIED_NATIVE_CAPTURE_INVENTORY",
      );
  }
});

test("a valid foreign-course page and material inventory cannot borrow another course's grading proof", () => {
  for (const nativeOnly of [false, true]) {
    const output = createWorkflows(workerXml).compare(
      gradingWorkflowInput({
        nativeOnly,
        captureCourseId: "Foreign_course_123",
        materialCourseId: "Foreign_course_123",
      }),
    );
    assert.equal(output.result.success, true);
    if (nativeOnly)
      assert.equal(
        output.result.structuralInventoryBasis.courseId,
        "Foreign_course_123",
      );
    const row = output.result.itemResults.find(
      (row) => row.sourceId === "sourcePractice",
    );
    assert.equal(row.checks.behavior.status, "UNVERIFIED");
    assert.deepEqual(row.checks.behavior.mismatches, []);
    assert(
      row.checks.behavior.issues.includes("BEHAVIOR_DESTINATION_UNVERIFIED"),
    );
  }
});

test("actual workbook comparison cannot borrow grading by title, case-folded ID or duplicate ID", () => {
  const workflows = createWorkflows(workerXml);
  for (const options of [
    { workbookId: "differentItem" },
    { workbookId: "GRADINGITEM" },
    { duplicateCapture: true },
    { duplicateWorkbook: true },
  ]) {
    const output = workflows.compare(gradingWorkflowInput(options));
    assert.equal(output.result.success, true);
    const item = output.result.itemResults.find(
      (row) => row.sourceId === "sourcePractice",
    );
    assert.equal(item.checks.behavior.status, "UNVERIFIED");
    assert.deepEqual(item.checks.behavior.mismatches, []);
    assert(
      item.checks.behavior.issues.includes("BEHAVIOR_DESTINATION_UNVERIFIED"),
    );
  }
});

test("contradictory projected configuration cannot hide a proven native-versus-DOM conflict", () => {
  const f = gradingFixture(true);
  f.item.payload.nativeAssignment = {
    settings: { graded: false, gradeSetting: "Practice" },
  };
  f.item.payload.structuredAssessment.configuration.isGraded = false;
  const inspected = inspectDirectNativeGrading(f.item),
    normalized = normalizeCourseraItem_(f.item),
    result = qaBehaviorComparison_(source({ graded: false }), normalized);
  assert.equal(inspected.observation.graded, true);
  assert.equal(inspected.projectionConflict, true);
  assert.equal(observeDirectNativeGrading(f.item), null);
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(result.reviewRequired, true);
  assert.equal(result.coursera.settings.graded, undefined);
  assert.equal(result.coursera.settings.gradeSetting, undefined);
  assert.equal(
    result.coursera.currentStateEvidence.nativeGradingConflict.reason,
    "DIRECT_GRADING_CONFIGURATION_PROJECTION_CONFLICT",
  );
  assert(result.issues.includes("NATIVE_GRADING_OBSERVATIONS_CONFLICT"));
  assert.deepEqual(result.mismatches, []);
  assert.equal(normalized.nativeAssignment.settings.graded, false);
  for (const nativeOnly of [false, true]) {
    const output = createWorkflows(workerXml).compare(
      gradingWorkflowInput({ nativeOnly, projectionConflict: true }),
    );
    assert.equal(output.result.success, true);
    const item = output.result.itemResults.find(
      (row) => row.sourceId === "sourcePractice",
    );
    assert.equal(item.checks.behavior.status, "UNVERIFIED");
    assert.equal(item.checks.behavior.reviewRequired, true);
    assert(
      item.checks.behavior.issues.includes(
        "NATIVE_GRADING_OBSERVATIONS_CONFLICT",
      ),
    );
    assert.deepEqual(item.checks.behavior.mismatches, []);
  }
});
