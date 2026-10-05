import test from "node:test";
import assert from "node:assert/strict";
import {
  ownerGuidance,
  questionEvidenceRelevant,
} from "../src/domain/owner-guidance.ts";
import { buildOwnerTasks } from "../src/domain/owner-actions.ts";
import { itemContentView } from "../src/domain/owner-content.ts";
import { capturedContent } from "../src/domain/content-evidence.ts";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { contactTemplateFixture } from "./owner-guidance-fixtures.mjs";
const input = contactTemplateFixture();
const report = createWorkflows(workerXml).compare(input);
const task = buildOwnerTasks(
  report.result,
  input.course.data.scan.courseTree,
)[0];

test("copied template text can pass comparison while readiness still requires approved contact details", () => {
  const before = JSON.stringify({ task, report });
  const g = ownerGuidance(task);
  assert.equal(task.findings[0].checks.content.status, "VERIFIED");
  assert.equal(task.status, "REVIEW");
  assert.equal(g.readinessOnly, true);
  assert.equal(
    g.checks.find((c) => c.field === "Text").status,
    "Comparison passed",
  );
  assert.match(
    g.readiness[0].detail,
    /also appears in the saved source package/,
  );
  assert.match(g.nextActions.join(" "), /approved facilitator/);
  assert.match(
    g.nextActions.join(" "),
    /only if the course requirements allow/,
  );
  assert.match(g.nextActions.join(" "), /Blocked/);
  assert.deepEqual(g.sourceImages, [
    "/shared/template/instructor.jpg",
    "/shared/template/logo.png",
  ]);
  assert.equal(task.findings[0].checks.assets.status, "NOT_APPLICABLE");
  assert.equal(JSON.stringify({ task, report }), before);
});

test("a confirmed missing file and contact readiness stay concurrent, without a readiness-only badge", () => {
  const mixed = structuredClone(task);
  mixed.status = "REPAIR_OR_CONFIRM";
  mixed.findings[0].verdict = "PARTIAL";
  mixed.findings[0].checks.assets = {
    status: "PARTIAL",
    missing: ["required-guide.pdf"],
    reason: "Expected file not observed with strong destination evidence.",
  };
  mixed.actions.push({
    severity: "CRITICAL",
    verdict: "PARTIAL",
    action: "Restore missing asset(s): required-guide.pdf.",
  });
  const g = ownerGuidance(mixed);
  assert.equal(g.readinessOnly, false);
  assert.match(g.nextActions.join(), /required-guide.pdf/);
  assert.match(g.nextActions.join(), /approved facilitator/);
  assert.equal(
    g.checks.find((c) => c.field === "Files").status,
    "Partly matched — review gaps",
  );
});

test("missing source evidence cannot establish that the placeholder was inherited", () => {
  const noSource = { ...task, sources: [] };
  assert.match(
    ownerGuidance(noSource).readiness[0].detail,
    /origin is not established/,
  );
  const unmatched = {
    ...noSource,
    findings: [],
    actions: [
      {
        sourceName: "Destination readiness",
        verdict: "PLACEHOLDER_CONTACT_INFO",
        action:
          "Replace with the intended facilitator/contact details or remove the placeholder fields.",
        severity: "REVIEW",
      },
    ],
  };
  assert.equal(ownerGuidance(unmatched).readinessOnly, false);
  assert.match(
    ownerGuidance(unmatched).readiness[0].detail,
    /origin is not established/,
  );
});

test("partial, unverified and unknown checks never appear passed; all source rows and actions survive", () => {
  const multi = structuredClone(task);
  multi.findings[0].checks.content = {
    status: "UNVERIFIED",
    reason: "Editor not observed.",
  };
  multi.findings[0].verdict = "UNVERIFIED";
  multi.findings.push({
    sourceName: "Second source",
    checks: {
      content: { status: "NEW_UNKNOWN_STATE", reason: "Needs review." },
      structuredAssessment: { status: "DRIFT" },
    },
  });
  multi.actions.push({
    severity: "EVIDENCE",
    action: "Capture the unread editor.",
  });
  const g = ownerGuidance(multi);
  assert.equal(g.readinessOnly, false);
  assert.deepEqual(
    g.checks.filter((c) => c.field === "Text").map((c) => c.status),
    ["Not verified", "NEW UNKNOWN STATE"],
  );
  assert.match(g.nextActions.join(), /Capture the unread editor/);
});

test("ordinary readings hide irrelevant question controls without hiding recorded or expected questions", () => {
  const view = itemContentView(task, report.contentEvidence);
  assert.equal(questionEvidenceRelevant(task, view), false);
  const q = capturedContent(
    {
      structuredAssessment: {
        questions: [{ prompt: "Question in a reading" }],
      },
    },
    { basis: "Captured" },
  );
  assert.equal(questionEvidenceRelevant(task, { ...view, coursera: q }), true);
  assert.equal(
    questionEvidenceRelevant(task, { ...view, previousCoursera: q }),
    true,
  );
  assert.equal(
    questionEvidenceRelevant(task, { ...view, linkedCoursera: [q] }),
    true,
  );
  assert.equal(
    questionEvidenceRelevant(task, {
      ...view,
      coursera: { ...view.coursera, expectedQuestions: 0 },
    }),
    true,
  );
});

test("assessments and embedded activities retain question uncertainty with no captured questions", () => {
  for (const type of ["Quiz", "Assignment", "Assessment", "LTI"]) {
    assert.equal(questionEvidenceRelevant({ ...task, type }), true);
  }
  assert.equal(
    questionEvidenceRelevant({ ...task, name: "Percentage Quiz" }),
    true,
  );
  assert.equal(
    questionEvidenceRelevant({
      ...task,
      pluginTargets: ["https://example.test/activity"],
    }),
    true,
  );
  const interactive = structuredClone(task);
  interactive.sources[0].sourcePayload.interactiveSignals = { detected: true };
  assert.equal(questionEvidenceRelevant(interactive), true);
});

test("follow-up text does not silently clear or recalculate the original audit", () => {
  const before = ownerGuidance(task);
  const view = itemContentView(
    task,
    report.contentEvidence,
    {},
    {
      payload: { textSample: "Real approved contact details." },
      editorObserved: true,
    },
  );
  assert.match(view.coursera.text, /Real approved/);
  assert.deepEqual(ownerGuidance(task), before);
  assert.equal(task.status, "REVIEW");
});
