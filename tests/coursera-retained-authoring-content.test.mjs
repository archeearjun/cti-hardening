import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  gradingFixture,
  gradingCourseId,
  gradingCourseSlug,
} from "./native-grading-fixtures.mjs";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { bindDirectAuthoringDraftV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directSourceBindingEvidenceV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import {
  retainedCourseraAuthoringContent,
  validateRetainedCourseraAuthoringContent,
} from "../src/domain/coursera-retained-authoring-content.ts";
import {
  buildContentSnapshot,
  validateContentSnapshot,
  contentEvidenceText,
} from "../src/domain/content-evidence.ts";
import { prepareOwnerReportExport } from "../src/domain/owner-report-export.ts";
import { newRecord } from "../src/domain/workspace-store.ts";

const cml = (value, dtdId = "assess/1") => ({
  typeName: "cml",
  definition: {
    dtdId,
    value: `<co-content><text>${value}</text></co-content>`,
  },
});
const receipt = (resource, id) => ({
  resource,
  id,
  status: 200,
  bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
  originalResponseSha256: "b".repeat(64),
  sha256: "b".repeat(64),
  requestPath: `/api/${resource}/${id}`,
  observedAt: "2026-10-18T12:00:00.000Z",
});

function fixture(type = "mcqReflect", projected = false) {
  const f = gradingFixture(false),
    p = f.item.payload,
    atomId = f.item.atomId;
  const local = "p".repeat(22),
    groupId = atomId + "~" + local,
    definitionId = atomId + "~" + "q".repeat(22) + "@1";
  const part = {
    typeName: "storedQuestionGroupPart",
    definition: { id: local },
  };
  f.atom.draft.content.definition.parts = [part];
  f.atom.published.content.definition.parts = [
    {
      typeName: "storedTextBlockPart",
      definition: { id: "stale", body: cml("STALE PUBLISHED CONTENT") },
    },
  ];
  const group = {
    id: groupId,
    questions: [definitionId],
    questionReferences: [
      { internalId: "native-internal", authoringId: definitionId },
    ],
  };
  const definition = {
    id: definitionId,
    definition: {
      typeName: type,
      definition: {
        prompt: cml("Which topic do you want to practise?"),
        options: [
          type === "textExactMatch"
            ? { id: "exact", answer: "original text", isCorrect: true }
            : { id: "source-option", display: cml("Authored choice") },
        ],
      },
    },
    validation: { definition: { isReadyForPublish: true, invalidMembers: [] } },
  };
  p.assessmentApiEvidence = {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId: gradingCourseId,
    itemId: f.item.id,
    assignmentId: atomId,
    rawParts: [part],
    groups: [group],
    questionDefinitions: [definition],
    groupStability: [
      {
        id: groupId,
        stable: true,
        group: structuredClone(group),
        receipt: receipt("authoringAssignmentQuestionGroups.v1", groupId),
      },
    ],
    receipts: [
      receipt("authoringAssignmentQuestionGroups.v1", groupId),
      receipt("authoringAssignmentMachineEvaluableQuestions.v1", definitionId),
    ],
  };
  p.structuredAssessment.questions = projected
    ? [
        {
          id: "1",
          courseraQuestionId: groupId,
          prompt: "Already projected",
          options: [],
        },
      ]
    : [];
  p.structuredAssessment.declaredQuestionCount = 1;
  p.structuredAssessment.captureCompleteness = {
    declared: 1,
    questionCoverageComplete: false,
  };
  function finalize() {
    const draftHash = createHash("sha256")
      .update(directCanonicalSourceTextV1(f.atom.draft))
      .digest("hex");
    f.sources.receipts.stability.draftHash = draftHash;
    f.sources.receipts.stability.atom.elements = [structuredClone(f.atom)];
    p.directDataEvidence = directSourceBindingEvidenceV1(
      f.item,
      bindDirectAuthoringDraftV1(
        f.item,
        gradingCourseId,
        gradingCourseSlug,
        f.sources.atom,
        f.sources.relation,
      ),
    );
  }
  finalize();
  return {
    ...f,
    part,
    groupId,
    definitionId,
    group,
    definition,
    finalize,
    capture: {
      page: {
        courseId: gradingCourseId,
        url: `https://www.coursera.org/teach/${gradingCourseSlug}/${gradingCourseId}/content/edit`,
      },
      extractedAt: "2026-10-18T12:00:00.000Z",
      fingerprints: [f.item],
    },
  };
}

test("retained exact-match and reflection definitions remain separate from normalized questions and keys", () => {
  for (const type of ["textExactMatch", "mcqReflect", "checkboxReflect"]) {
    const f = fixture(type),
      before = structuredClone(f.capture);
    const snapshot = buildContentSnapshot(undefined, undefined, f.capture),
      c = snapshot.coursera[0].content;
    const supplemental = c.retainedAuthoringContent;
    assert(supplemental);
    assert.equal(supplemental.blocks.length, 1);
    assert.equal(supplemental.blocks[0].nativeType, type);
    assert.equal(supplemental.blocks[0].nativeId, f.definitionId);
    assert.equal(supplemental.blocks[0].groupId, f.groupId);
    assert.equal(
      supplemental.blocks[0].prompt,
      "Which topic do you want to practise?",
    );
    assert.equal(c.questions.length, 0);
    assert.equal(c.questionCoverage, "UNVERIFIED");
    assert.equal(c.expectedQuestions, 1);
    assert.equal(c.textCoverage, "UNVERIFIED");
    assert(!("answers" in supplemental.blocks[0]));
    if (type === "textExactMatch")
      assert.deepEqual(supplemental.blocks[0].options, []);
    else
      assert.deepEqual(supplemental.blocks[0].options, [
        { id: "source-option", text: "Authored choice" },
      ]);
    assert(
      !JSON.stringify(supplemental.blocks).includes("STALE PUBLISHED CONTENT"),
    );
    validateContentSnapshot(snapshot);
    const output = contentEvidenceText(c);
    assert.match(output, /ADDITIONAL RETAINED AUTHORING CONTENT/);
    assert.match(
      output,
      /Keys, complete assessment coverage and learner behavior are not established/,
    );
    assert.deepEqual(f.capture, before);
  }
});

test("text blocks show literal instructions and never become questions; manual question IDs without bodies stay unknown", () => {
  const f = fixture();
  f.atom.draft.content.definition.parts = [
    {
      typeName: "storedTextBlockPart",
      definition: {
        id: "textBlock~synthetic",
        title: "Submission instructions",
        body: cml("Submit through the associated dropbox."),
      },
    },
    {
      typeName: "storedManualGradedQuestionPart",
      definition: { id: "m".repeat(22) },
    },
  ];
  f.finalize();
  const snapshot = buildContentSnapshot(undefined, undefined, f.capture),
    c = snapshot.coursera[0].content;
  assert.equal(c.retainedAuthoringContent.blocks.length, 1);
  assert.equal(c.retainedAuthoringContent.blocks[0].kind, "TEXT_BLOCK");
  assert.equal(
    c.retainedAuthoringContent.blocks[0].prompt,
    "Submit through the associated dropbox.",
  );
  assert.equal(c.questions.length, 0);
  assert.equal(c.questionCoverage, "UNVERIFIED");
  validateContentSnapshot(snapshot);
  f.atom.draft.content.definition.parts.shift();
  f.finalize();
  assert.equal(retainedCourseraAuthoringContent(f.item, gradingCourseId), null);
});

test("unsupported dialect and invalid native model remain literal raw evidence without invented text, answers or validity", () => {
  const f = fixture("mcq");
  f.definition.definition.definition.prompt = cml("13 + 4 =", "");
  f.definition.definition.definition.options = [
    { id: "blank", display: cml("", "") },
  ];
  f.definition.validation.definition = {
    isReadyForPublish: false,
    invalidMembers: [{ path: "/options/0/display", status: "EMPTY" }],
  };
  const supplemental = retainedCourseraAuthoringContent(
      f.item,
      gradingCourseId,
    ),
    block = supplemental.blocks[0];
  assert.equal(block.formatStatus, "UNSUPPORTED_CML");
  assert.equal(block.nativeValidation, "NOT_READY");
  assert.equal(block.prompt, "");
  assert.deepEqual(block.options, [{ id: "blank", text: "" }]);
  assert.match(block.originalModelJson, /13 \+ 4/);
  assert.match(block.originalModelJson, /invalidMembers/);
});

test("only native item, course, draft, exact group and versioned definition ownership can supply additional content", () => {
  const cases = {
    "wrong expected course": (f) => {
      f.expectedCourse = "Other_course_123";
    },
    "wrong claimed course": (f) => {
      f.item.payload.directDataEvidence.courseId = "Other_course_123";
    },
    "wrong claimed item": (f) => {
      f.item.payload.directDataEvidence.itemId = "other";
    },
    "source changed": (f) => {
      f.sources.receipts.stability.atom.elements[0].draft.name = "Changed";
    },
    "false resume": (f) => {
      f.item.payload.directResumeRevalidation = { verified: false };
    },
    "published status": (f) => {
      f.atom.status.typeName = "publishedAtomStatus";
    },
    "wrong draft hash": (f) => {
      f.item.payload.directDataEvidence.draftHash = "f".repeat(64);
      f.sources.receipts.stability.draftHash = "f".repeat(64);
    },
    "unrelated part": (f) => {
      f.part.definition.id = "z".repeat(22);
      f.finalize();
    },
    "wrong group": (f) => {
      f.group.id = "x".repeat(22) + "~" + "p".repeat(22);
    },
    "multiple group questions": (f) => {
      f.group.questions.push(f.definitionId);
    },
    "wrong group reference": (f) => {
      f.group.questionReferences[0].authoringId = "other";
    },
    "wrong definition": (f) => {
      f.definition.id = "other";
    },
    "no group receipt": (f) => {
      f.item.payload.assessmentApiEvidence.receipts.shift();
    },
    "no definition receipt": (f) => {
      f.item.payload.assessmentApiEvidence.receipts.pop();
    },
    "no stable group": (f) => {
      f.item.payload.assessmentApiEvidence.groupStability = [];
    },
    "changed group": (f) => {
      f.item.payload.assessmentApiEvidence.groupStability[0].group.scoringWeight = 9;
    },
    "wrong raw owner": (f) => {
      f.item.payload.assessmentApiEvidence.assignmentId = "other";
    },
    "duplicate definition": (f) => {
      f.item.payload.assessmentApiEvidence.questionDefinitions.push(
        structuredClone(f.definition),
      );
    },
    "duplicate group": (f) => {
      f.item.payload.assessmentApiEvidence.groups.push(
        structuredClone(f.group),
      );
    },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const f = fixture();
    mutate(f);
    assert.equal(
      retainedCourseraAuthoringContent(
        f.item,
        f.expectedCourse || gradingCourseId,
      ),
      null,
      label,
    );
  }
  const projected = fixture("mcq", true);
  assert.equal(
    retainedCourseraAuthoringContent(projected.item, gradingCourseId),
    null,
    "Do not duplicate projected questions",
  );
});

test("saved supplemental projections independently rederive literal text, scope, bindings and hashes; legacy snapshots remain valid", () => {
  const f = fixture(),
    snapshot = buildContentSnapshot(undefined, undefined, f.capture);
  for (const mutate of [
    (c) => {
      c.retainedAuthoringContent.blocks[0].prompt = "invented";
    },
    (c) => {
      c.retainedAuthoringContent.blocks[0].originalModelJson = "{}";
    },
    (c) => {
      c.retainedAuthoringContent.blocks[0].originalModelSha256 = "f".repeat(64);
    },
    (c) => {
      c.retainedAuthoringContent.itemId = "other";
    },
    (c) => {
      c.retainedAuthoringContent.scope = "COMPLETE";
    },
    (c) => {
      c.retainedAuthoringContent.proof.assessment.groupStability[0].stable = false;
    },
    (c) => {
      c.retainedAuthoringContent.proof.projectedGroupIds = ["invented"];
    },
  ]) {
    const invalid = structuredClone(snapshot);
    mutate(invalid.coursera[0].content);
    assert.throws(
      () => validateContentSnapshot(invalid),
      /retained Coursera authoring content/i,
    );
  }
  assert.throws(
    () =>
      validateRetainedCourseraAuthoringContent(
        snapshot.coursera[0].content.retainedAuthoringContent,
        "other",
        [],
        gradingCourseId,
      ),
    /native source evidence/,
  );
  const otherCourse = structuredClone(snapshot);
  otherCourse.coursera[0].content.retainedAuthoringContent = JSON.parse(
    JSON.stringify(
      snapshot.coursera[0].content.retainedAuthoringContent,
    ).replaceAll(gradingCourseId, "Another_captured_course_123"),
  );
  assert.throws(
    () => validateContentSnapshot(otherCourse),
    /native source evidence/,
  );
  const wrongRoute = structuredClone(snapshot);
  wrongRoute.coursera[0].content.url = `https://www.coursera.org/teach/${gradingCourseSlug}/${gradingCourseId}/content/item/project/otherItem`;
  assert.throws(
    () => validateContentSnapshot(wrongRoute),
    /recorded course item URL/,
  );
  const legacy = structuredClone(snapshot);
  delete legacy.coursera[0].content.retainedAuthoringContent;
  validateContentSnapshot(legacy);
});

test("additional source records remain bounded and never silently truncate an original model", () => {
  for (const mutate of [
    (f) => {
      f.definition.extra = "x".repeat(2000001);
    },
    (f) => {
      f.definition.extra = "x".repeat(300001);
    },
    (f) => {
      f.item.payload.assessmentApiEvidence.questionDefinitions = Array.from(
        { length: 101 },
        (_, i) => ({ ...f.definition, id: f.definitionId + i }),
      );
    },
    (f) => {
      f.definition.extra = {};
      f.definition.extra.recursive = f.definition.extra;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(
      retainedCourseraAuthoringContent(f.item, gradingCourseId),
      null,
    );
  }
});

test("snapshot cumulative limits apply before rehashing and building stops supplemental work with an explicit limitation", () => {
  const f = fixture(),
    snapshot = buildContentSnapshot(undefined, undefined, f.capture);
  const oversized = structuredClone(snapshot);
  // Every per-item object fits its local bound. Deliberately altered source
  // proof would otherwise fail replay first: aggregate rejection must precede it.
  oversized.coursera = Array.from({ length: 9 }, () => {
    const entry = structuredClone(snapshot.coursera[0]);
    entry.content.retainedAuthoringContent.proof.sources.padding = "x".repeat(
      1000000,
    );
    return entry;
  });
  assert.throws(
    () => validateContentSnapshot(oversized),
    /snapshot review limit/,
  );
  const large = fixture();
  large.definition.extra = "z".repeat(150000);
  large.capture.fingerprints = Array(60).fill(large.item);
  const bounded = buildContentSnapshot(undefined, undefined, large.capture);
  assert(
    bounded.coursera.some((entry) => entry.content.retainedAuthoringContent),
  );
  const omitted = bounded.coursera.filter(
    (entry) => !entry.content.retainedAuthoringContent,
  );
  assert(omitted.length > 0);
  assert(
    omitted.every((entry) =>
      entry.content.limitations.some((reason) =>
        /review limit.*original extraction/.test(reason),
      ),
    ),
  );
  assert(
    bounded.coursera.every(
      (entry) =>
        entry.content.questions.length === 0 &&
        entry.content.questionCoverage === "UNVERIFIED",
    ),
  );
  validateContentSnapshot(bounded);
});

test("complete readable owner reports export exact additional native content separately from unchanged findings and question totals", async () => {
  const f = fixture("textExactMatch"),
    snapshot = buildContentSnapshot(undefined, undefined, f.capture),
    course = newRecord("package", "Synthetic retained authoring course", {}),
    report = {
      packageId: course.id,
      report: "Original assessment findings remain unresolved.",
      contentEvidence: snapshot,
      result: {
        ownerView: {
          items: [
            {
              id: f.item.id,
              name: f.item.name,
              status: "EVIDENCE_NEEDED",
              actions: [],
            },
          ],
        },
      },
    },
    before = structuredClone(report);
  const exported = await prepareOwnerReportExport(
    report,
    "synthetic-retained-audit",
    course,
    {
      list: async () => [],
      get: async () => {
        throw Error("No saved follow-ups expected");
      },
    },
  );
  const block = snapshot.coursera[0].content.retainedAuthoringContent.blocks[0];
  assert.match(exported.text, /ADDITIONAL RETAINED AUTHORING CONTENT/);
  assert.match(
    exported.text,
    /Keys, complete assessment coverage and learner behavior are not established/,
  );
  assert(exported.text.includes(block.originalModelJson));
  assert(exported.text.includes(block.nativeId));
  assert(exported.text.includes(block.originalModelSha256));
  assert.deepEqual(exported.followUp.contentEvidence, snapshot);
  const exportedContent = exported.followUp.contentComparisons[0].view.coursera;
  assert.deepEqual(
    exportedContent.retainedAuthoringContent,
    snapshot.coursera[0].content.retainedAuthoringContent,
  );
  assert.equal(exportedContent.questions.length, 0);
  assert.equal(exportedContent.questionCoverage, "UNVERIFIED");
  assert.equal(exported.followUp.automatedResolution, false);
  assert.deepEqual(report, before);
  assert(exported.text.endsWith(before.report));
});

test('source-bound manual authoring content round trips exact AI fields without asserting published coverage',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {CTI_DIRECT_MANUAL_FIELDS_V1}=await import('../src/extractors/coursera/direct-data-native-observations.js');
 const data=JSON.parse(await readFile(new URL('./fixtures/coursera/manual-authoring-observed.json',import.meta.url),'utf8'));
 const f=fixture(),p=f.item.payload,localId=data.elements[0].id.split("~")[1],id=f.atom.id+"~"+localId; data.elements[0].id=id;
 f.atom.draft.content.definition.parts=[{typeName:'storedManualGradedQuestionPart',definition:{id:localId}}];f.finalize();
 const hash=value=>createHash('sha256').update(directCanonicalSourceTextV1(value)).digest('hex');
 const observation={data,modelSha256:hash(data),receipt:{...receipt('authoringAssignmentManualGradedQuestions.v1',id),observedAt:'2026-10-17T10:00:00.000Z',requestQuery:[['id',id],['fields',CTI_DIRECT_MANUAL_FIELDS_V1]]}};
 p.assessmentApiEvidence.rawParts=structuredClone(f.atom.draft.content.definition.parts);
 p.assessmentApiEvidence.manualDefinitions=[{id,localId,ordinal:1,initial:observation,final:structuredClone(observation),stable:true}];
 const retained=retainedCourseraAuthoringContent(f.item,gradingCourseId);
 assert.equal(retained.blocks.length,1);const block=retained.blocks[0];
 assert.deepEqual(block.manualSubmission.fields,data.elements[0]);assert.equal(block.nativeValidation,'READY');
 assert.equal(block.manualSubmission.publishedBodyVerified,false);assert.deepEqual(JSON.parse(block.originalModelJson),data.elements[0]);
 const snapshot=buildContentSnapshot(undefined,undefined,f.capture);validateContentSnapshot(snapshot);
 assert.equal(snapshot.coursera[0].content.questions.length,0);assert.equal(snapshot.coursera[0].content.questionCoverage,'UNVERIFIED');
 assert(contentEvidenceText(snapshot.coursera[0].content).includes('published body unverified'));
 p.assessmentApiEvidence.manualDefinitions[0].final.data.elements[0].id='X'.repeat(22);
 assert.equal(retainedCourseraAuthoringContent(f.item,gradingCourseId),null);
});
