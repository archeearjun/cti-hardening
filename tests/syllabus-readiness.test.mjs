import test from "node:test";
import assert from "node:assert/strict";
import { qaTemplatePlaceholders_ } from "../src/engine/readiness/template-placeholders.js";
import { qaObservedLiveTextPassages_ } from "../src/engine/source/live-text-review.js";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import {
  buildOwnerTasks,
  needsOwnerAction,
} from "../src/domain/owner-actions.ts";
import {
  syllabusFixture,
  passRequirement,
  aiStatement,
} from "./syllabus-readiness-fixtures.mjs";
import { encode } from "./workflow-fixtures.mjs";
const workflows = createWorkflows(workerXml);

test("explicit syllabus and existing authoring prompts require review; ordinary brackets do not", () => {
  for (const prompt of [
    "[Include your title and what you prefer to be called]",
    "[Include information for your preferred method of contact here]",
    "[Brief description of assessment 1]",
    "[add instructor name]",
    "[insert course details]",
    "[enter text here]",
  ]) {
    assert.deepEqual(qaTemplatePlaceholders_(prompt), [prompt]);
  }
  for (const text of [
    "[TRDE120 - Introduction to Trades Math]",
    "[1, 2, 3]",
    "[Smith 2026]",
    "[Include operation]",
    "[Include your answer in the discussion]",
    "Include your answer in the discussion.",
    "[x + 1]",
    "[Brief description of photosynthesis]",
  ])
    assert.deepEqual(qaTemplatePlaceholders_(text), []);
});

test("matched syllabus with inherited placeholders is an owner task, without changing its package text verdict", () => {
  const input = syllabusFixture({ live: false }),
    before = JSON.stringify(input);
  const out = workflows.compare(input),
    row = out.result.itemResults[0];
  assert.equal(row.checks.content.status, "VERIFIED");
  assert.equal(row.verdict, "VERIFIED");
  assert.equal(row.ownerAction.severity, "REVIEW");
  assert.match(row.checks.destinationReadiness[0].detail, /Include your title/);
  assert.match(out.report, /TEMPLATE_PLACEHOLDER_TEXT/);
  assert(
    needsOwnerAction(
      buildOwnerTasks(out.result, input.course.data.scan.courseTree)[0],
    ),
  );
  assert.equal(JSON.stringify(input), before);
});

test("live pass requirement and AI statement remain actionable even when the whole package/destination text matches", () => {
  const input = syllabusFixture({ placeholders: false }),
    before = JSON.stringify(input);
  const out = workflows.compare(input),
    row = out.result.itemResults[0];
  assert.equal(row.checks.content.status, "VERIFIED");
  assert.equal(row.checks.liveSourceText.completeCoverageVerified, false);
  assert(row.checks.liveSourceText.passages.includes(passRequirement));
  assert(row.checks.liveSourceText.passages.includes(aiStatement));
  assert.equal(row.ownerAction.severity, "EVIDENCE");
  assert.equal(out.result.ownerView.items[0].status, "EVIDENCE_NEEDED");
  assert.equal(out.result.liveSourceGroundTruth.status, "REVIEW");
  assert.equal(out.result.operationalPolicy.liveSourceReviewRequired, true);
  assert.match(out.report, /50% or higher/);
  assert.doesNotMatch(
    row.ownerAction.action,
    /No assignment-owner action is required/,
  );
  assert.match(row.ownerAction.action, /does not prove content loss/);
  assert.equal(JSON.stringify(input), before);
});

test("readiness and live-source review stay concurrent; neither hides the other", () => {
  const row = workflows.compare(syllabusFixture()).result.itemResults[0];
  assert.equal(row.ownerAction.severity, "REVIEW");
  assert.match(row.ownerAction.action, /50% or higher/);
  assert.match(row.ownerAction.action, /approved course information/);
});

test("a confirmed missing file keeps its stronger repair action alongside source wording review", () => {
  const input = syllabusFixture({ placeholders: false });
  input.course.data.scan.courseTree[0].children[0].sourcePayload.files = [
    {
      name: "required-guide.pdf",
      path: "required-guide.pdf",
      presentInPackage: true,
      sha256: "c".repeat(64),
      size: 100,
    },
  ];
  const capture = JSON.parse(new TextDecoder().decode(input.json.bytes));
  capture.fingerprints[0].payload.assetEvidenceConfidence = 1;
  input.json.bytes = encode(capture);
  const row = workflows.compare(input).result.itemResults[0];
  assert.equal(row.ownerAction.severity, "CRITICAL");
  assert.match(row.ownerAction.action, /required-guide.pdf/);
  assert.match(row.ownerAction.action, /50% or higher/);
  assert(row.checks.liveSourceText);
});

test("current destination wording, absent live evidence, and ambiguous live identity cannot produce this unestablished-wording review", () => {
  for (const options of [
    { updatedDestination: true },
    { live: false },
    { duplicateTopic: true },
  ]) {
    const row = workflows.compare(
      syllabusFixture({ placeholders: false, ...options }),
    ).result.itemResults[0];
    assert.equal(row.checks.liveSourceText, undefined);
  }
  const input = syllabusFixture({ placeholders: false });
  const capture = JSON.parse(new TextDecoder().decode(input.brightspace.bytes));
  capture.contentTree[0].children[0].contentEvidence.status =
    "PERMISSION_DENIED";
  input.brightspace.bytes = encode(capture);
  assert.equal(
    workflows.compare(input).result.itemResults[0].checks.liveSourceText,
    undefined,
  );
});

test("policy-exempt archive findings stay diagnostic and do not force source reconciliation", () => {
  const out = workflows.compare(
    syllabusFixture({ archive: true, placeholders: false }),
  );
  const row = out.result.itemResults[0];
  assert.equal(row.checks.liveSourceText.decisionRelevant, false);
  assert.equal(row.ownerAction.severity, "INFO");
  assert.match(row.ownerAction.action, /Policy-exempt/);
  assert.equal(out.result.operationalPolicy.liveSourceReviewRequired, false);
});

test("wording review tolerates formatting and small headings and remains bounded", () => {
  const body =
    "Learners will develop careful measurement and calculation skills using examples and activities from everyday workplace practice.";
  assert.deepEqual(
    qaObservedLiveTextPassages_(body.toUpperCase(), body, "").passages,
    [],
  );
  assert.deepEqual(
    qaObservedLiveTextPassages_("Syllabus heading " + body, body, "").passages,
    [],
  );
  assert.deepEqual(
    qaObservedLiveTextPassages_(body.replaceAll(" ", "  "), body, "").passages,
    [],
  );
  assert.deepEqual(
    qaObservedLiveTextPassages_(
      passRequirement,
      "No policy recorded.",
      passRequirement,
    ).passages,
    [],
  );
  const long = Array.from(
    { length: 20 },
    (_, i) =>
      `Additional source policy ${i} describes unique requirements for learners submitting the final project in this course.`,
  ).join(" ");
  const bounded = qaObservedLiveTextPassages_(
    long,
    "Unrelated package text.",
    "",
  );
  assert.equal(bounded.passages.length, 6);
  assert(bounded.additionalPassages > 0);
});
