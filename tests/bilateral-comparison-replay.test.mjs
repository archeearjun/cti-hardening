import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { retainedNativeNameEvidence } from "../src/engine/capture/native-name.js";
import {
  normalizeCourseraItem_,
  qaBuildGlobalMatchPlan_,
} from "../src/engine/capture/normalization.js";
import { qaMergeCourseraPayload_ } from "../src/engine/capture/recovery.js";
import { qaBrightspaceQuizToAssessment_ } from "../src/engine/source/brightspace-assessment.js";
import { parseQtiAssessmentStructure_ } from "../src/source/qti.js";
import { evidenceDecisionBrief } from "../src/reporting/evidence-decision-brief.js";
import { qaOwnerTasksText } from "../src/reporting/owner-tasks.js";
const f = JSON.parse(
  fs.readFileSync(
    new URL(
      "./fixtures/coursera/trde120-bilateral-comparison.json",
      import.meta.url,
    ),
  ),
);
function inventory(fp, level = "native-capture-structure") {
  return normalizeCourseraItem_({
    id: fp.id,
    name: fp.sourceIdentity.materialName,
    type: fp.typeName,
    path: fp.path.split(" > ")[0],
    evidenceLevel: level,
  });
}
test("real report baseline and six retained native identity bindings remain immutable", () => {
  assert.equal(f.auditId, "60a3a3df-9212-47d4-8c3b-e04068fd0c41");
  assert.equal(f.summary.unverified, 125);
  assert.equal(
    f.itemResults.filter((r) => r.verdict === "UNVERIFIED" && !r.courseraId)
      .length,
    124,
  );
  const before = JSON.stringify(f);
  for (const fp of f.fingerprints.filter((fp) =>
    ["6eUE7", "QgOIm", "LFrHs", "06PMM"].includes(fp.id),
  )) {
    const observation = retainedNativeNameEvidence(fp, f.courseId);
    assert.equal(observation.name, fp.name);
    assert.equal(observation.completeContent, false);
    const live = normalizeCourseraItem_(fp, f.courseId),
      native = qaMergeCourseraPayload_(inventory(fp), live);
    assert.equal(native.name, fp.name);
    assert.equal(native.materialInventoryName, "Untitled");
    const xlsx = qaMergeCourseraPayload_(
      inventory(fp, "excel-structure"),
      live,
    );
    assert.equal(xlsx.name, "Untitled");
    assert.equal(xlsx.nativeNameEvidence.name, fp.name);
    const foreign = structuredClone(fp);
    foreign.payload.directDataSources.relation.elements[0].atomId = "foreign";
    assert.equal(retainedNativeNameEvidence(foreign, f.courseId), null);
    assert.equal(retainedNativeNameEvidence(fp, "foreign-course"), null);
    assert.equal(
      qaMergeCourseraPayload_({ ...inventory(fp), id: "foreign" }, live)
        .nativeNameEvidence,
      undefined,
    );
  }
  assert.equal(JSON.stringify(f), before);
});
test("retained authored names recover structural candidates, never certify question parity", () => {
  const fp = f.fingerprints.find((x) => x.id === "LFrHs"),
    source = {
      name: "Final Assessment",
      type: "Assessment",
      path: fp.path.split(" > ")[0],
    };
  assert.equal(
    Object.keys(qaBuildGlobalMatchPlan_([source], [inventory(fp)])).length,
    0,
  );
  const merged = qaMergeCourseraPayload_(
    inventory(fp),
    normalizeCourseraItem_(fp, f.courseId),
  );
  assert.equal(
    Object.keys(qaBuildGlobalMatchPlan_([source], [merged])).length,
    1,
  );
  assert.equal(
    merged.nativeNameEvidence.scope,
    "RETAINED_AUTHORING_DRAFT_NAME",
  );
  assert.equal(merged.nativeNameEvidence.completeContent, false);
});
test("Brightspace retains empty options and exact scoring/feedback definitions without certifying unknown banks", () => {
  const raw = {
    id: "quiz-native",
    questionsStatus: "CAPTURED",
    questionPageEvidence: { complete: true },
    questionCoverage: { completenessVerified: false },
    questions: [
      {
        QuestionId: 7,
        QuestionTypeId: 1,
        QuestionText: {
          Text: "Exact <b>prompt</b>",
          Html: "<p>Exact <b>prompt</b></p>",
        },
        Points: 0,
        QuestionInfo: {
          Answers: [
            {
              PartId: 1,
              Answer: { Text: "" },
              Weight: 0,
              Feedback: { Text: "" },
            },
            { PartId: 2, Answer: { Text: "A" }, Weight: 100 },
          ],
          Tolerance: 0,
        },
        Feedback: { Text: "" },
      },
    ],
  };
  const before = JSON.stringify(raw),
    a = qaBrightspaceQuizToAssessment_(raw);
  assert.equal(a.questions[0].options.length, 2);
  assert.equal(a.questions[0].options[0].text, "");
  assert.equal(a.questions[0].points, 0);
  assert.deepEqual(
    a.questions[0].sourceTypeEvidence.definition.QuestionInfo,
    raw.questions[0].QuestionInfo,
  );
  assert.equal(a.questions[0].sourceTypeEvidence.quizId, "quiz-native");
  assert.equal(a.definitionCoverage.completenessVerified, false);
  assert.equal(JSON.stringify(raw), before);
});
test("QTI retains fixed and selected membership in local identifier namespace", () => {
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  try {
    const q = (id) =>
      `<item ident="${id}"><presentation><material><mattext>Question ${id}</mattext></material></presentation></item>`;
    const a = parseQtiAssessmentStructure_(
      `<questestinterop><assessment ident="A">${q("fixed")}<section ident="pool"><selection_ordering><selection><selection_number>1</selection_number></selection></selection_ordering>${q("p1")}${q("p2")}</section></assessment></questestinterop>`,
      "assessment.xml",
    );
    assert.deepEqual(a.selectionPolicy.fixedQuestionIds, ["fixed"]);
    assert.deepEqual(a.selectionPolicy.scopes, [
      { scopeId: "pool", selectedPerAttempt: 1, questionIds: ["p1", "p2"] },
    ]);
    assert.equal(a.selectionPolicy.selectCount, 2);
    assert.equal(a.selectionPolicy.membershipScope, "DOCUMENT_LOCAL_QTI");
  } finally {
    globalThis.DOMParser = previous;
  }
});
test("owner brief separates denominators, matching uncertainty and source bank limits", () => {
  const r = {
    ...f,
    liveSourceGroundTruth: { quizCapture: f.quizCapture },
    destinationReadiness: { criticalCount: 0 },
    injected: [],
  };
  const before = JSON.stringify(r),
    text = evidenceDecisionBrief(r);
  assert.match(
    text,
    /125 source comparisons.*124 without a direct destination match; 1 with a match/,
  );
  assert.match(text, /47 captured definitions across 7 source quizzes/);
  assert.match(text, /comparison\/owner 2; destination-readiness checks 0/);
  assert.match(text, /source i.*destination/);
  assert.equal(JSON.stringify(r), before);
  const excluded = {
    sourceName: "Archive Coach",
    courseraId: "v4SeI",
    operationalPolicy: { inDecisionGate: false },
    ownerAction: { severity: "CRITICAL", action: "Do not publish" },
  };
  assert.doesNotMatch(
    qaOwnerTasksText({ itemResults: [excluded] }),
    /Do not publish/,
  );
});
test("equal duplicate matches remain unresolved instead of using array order", () => {
  const s = { name: "Same quiz", type: "Assessment", path: "Week 1" };
  assert.deepEqual(
    Object.keys(
      qaBuildGlobalMatchPlan_(
        [s],
        [
          { ...s, id: "a" },
          { ...s, id: "b" },
        ],
      ),
    ),
    [],
  );
  assert.deepEqual(
    Object.keys(qaBuildGlobalMatchPlan_([s, { ...s }], [{ ...s, id: "a" }])),
    [],
  );
});
test("actual retained questions nominate source-bound text pairs without certifying assessment coverage", async () => {
  const { questionIdentityCandidates } = await import(
    "../src/engine/assessment/identity-candidates.js"
  );
  const before = JSON.stringify(f.questionSnapshot),
    pairs = questionIdentityCandidates(f.questionSnapshot);
  assert(
    pairs.some(
      (p) => p.source.itemId === "5623907" && p.destination.itemId === "LFrHs",
    ),
  );
  assert(
    pairs.some(
      (p) => p.source.itemId === "5293607" && p.destination.itemId === "6eUE7",
    ),
  );
  assert(
    pairs.every(
      (p) =>
        p.completeContent === false &&
        p.scope === "PROMPT_AND_ORDERED_OPTION_TEXT_ONLY",
    ),
  );
  const duplicate = structuredClone(f.questionSnapshot);
  duplicate.brightspace.push(duplicate.brightspace[0]);
  assert(
    questionIdentityCandidates(duplicate).some(
      (p) => p.status === "AMBIGUOUS_TEXT_CANDIDATE",
    ),
  );
  assert.equal(JSON.stringify(f.questionSnapshot), before);
});
test("short published readings use independently verified full CML coverage, never a saved complete flag", () => {
  for (const fp of f.publishedReadings) {
    const n = normalizeCourseraItem_(fp, f.courseId);
    assert.equal(n.textEvidenceCompleteness, 1);
    assert.equal(n.textEvidenceCompletenessObserved, true);
    const bad = structuredClone(fp);
    bad.payload.textSample += " forged";
    assert.notEqual(
      normalizeCourseraItem_(bad, f.courseId).textEvidenceCompleteness,
      1,
    );
    const changed = structuredClone(fp);
    changed.payload.directPublishedReadingEvidence.final.model.publishedItemContent.content.cmlValue +=
      " changed";
    assert.notEqual(
      normalizeCourseraItem_(changed, f.courseId).textEvidenceCompleteness,
      1,
    );
    assert.notEqual(
      normalizeCourseraItem_(fp, "foreign-course").textEvidenceCompleteness,
      1,
    );
  }
});
