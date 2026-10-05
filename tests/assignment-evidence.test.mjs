import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceBaseline,
  sourceIdentityMessage,
  nextAssignmentStep,
} from "../src/domain/assignment-evidence.ts";
import { evaluateAssignment } from "../src/domain/assignment-plan.ts";
import { inspectBrightspaceCaptureFile } from "../src/domain/brightspace-local-extraction.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";
const pending = {
  source: "",
  coursera: "",
  excel: "",
  changed: false,
  courseraChanged: false,
};
function setup() {
  const course = comparisonFixture().course;
  const audit = {
    ...structuredClone(course),
    id: "report",
    kind: "audit",
    packageId: course.id,
    data: {
      sourceScanSha256: course.data.scan.fileSha256,
      hashes: { json: "coursera", brightspace: "source" },
      result: {
        success: true,
        inputCoherence: { status: "PASS" },
        stats: { extractorMeta: { capturedAt: "2026-10-01T00:00:00Z" } },
        ownerView: {
          items: [
            {
              id: "reading",
              name: "Reading",
              type: "Reading",
              status: "REVIEW",
              actions: [{ severity: "REVIEW", action: "Inspect the source." }],
            },
          ],
        },
      },
    },
  };
  const next = (inputs = pending, report = audit) =>
    nextAssignmentStep(
      course,
      report,
      evaluateAssignment(course, report, [course, audit]),
      inputs,
    );
  return { course, audit, next };
}
test("source provenance distinguishes historical, manifest-only and saved scans without claiming latest export", () => {
  assert.equal(sourceBaseline().status, "missing");
  assert.equal(sourceBaseline({ fileSha256: "" }).status, "historical");
  assert.equal(
    sourceBaseline({
      fileSha256: "hash",
      sourceEvidence: { manifestOnly: true },
    }).status,
    "manifest",
  );
  assert.equal(sourceBaseline({ fileSha256: "hash" }).status, "scanned");
  assert.match(
    sourceIdentityMessage("", ""),
    /does not prove the package changed/,
  );
  assert.match(
    sourceIdentityMessage("hash", ""),
    /report has no source file identity/,
  );
  assert.match(sourceIdentityMessage("new", "old"), /package differs/);
});
test("historical baseline takes precedence over a populated old report", () => {
  const f = setup();
  f.course.data.scan.fileSha256 = "";
  assert.equal(f.next().action, "scan");
  assert.equal(
    evaluateAssignment(f.course, f.audit, [f.audit]).canRecordReview,
    false,
  );
});
test("pre-import guidance collects source, then destination, then comparison", () => {
  const f = setup();
  assert.equal(f.next(pending, null).action, "source");
  assert.equal(
    f.next({ ...pending, source: "source.json", changed: true }, null).action,
    "coursera",
  );
  assert.equal(
    f.next(
      {
        ...pending,
        source: "source.json",
        coursera: "coursera.json",
        changed: true,
      },
      null,
    ).action,
    "compare",
  );
});
test("newly selected evidence and wrong source cannot masquerade as a completed comparison", () => {
  const f = setup();
  assert.equal(f.next().action, "worklist");
  assert.equal(
    f.next({ ...pending, source: "new-source.json", changed: true }).action,
    "compare",
  );
  f.audit.data.sourceScanSha256 = "old";
  assert.equal(f.next().action, "compare");
});
test("declared shell changes prompt fresh capture, not just manual checklist completion", () => {
  const f = setup();
  f.course.data.assignmentPlan = {
    route: "COURSE",
    shellChangedAt: "2026-10-02T00:00:00Z",
  };
  assert.equal(f.next().action, "coursera");
  assert.equal(
    f.next({
      ...pending,
      coursera: "corrected.json",
      changed: true,
      courseraChanged: true,
    }).action,
    "compare",
  );
  delete f.audit.data.result.stats.extractorMeta.capturedAt;
  assert.equal(f.next().action, "coursera");
  assert.equal(
    f.next({
      ...pending,
      coursera: "already-compared.json",
      source: "new-source.json",
      changed: true,
    }).action,
    "coursera",
  );
});
const source = () => ({
  extractor: "CTI Brightspace v1.0.8",
  schemaVersion: 2,
  course: { title: "Example source", orgUnitId: "123" },
  contentTree: [],
  quizzes: [{ id: "q", name: "Quiz", questions: [] }],
  permissionBlocks: [{ status: 403 }],
  captureWarnings: ["Quiz API access denied; questions remain unverified."],
});
const file = (value) =>
  new File([JSON.stringify(value)], "source.json", {
    type: "application/json",
  });
test("Brightspace inspection keeps zero captured questions distinct from verified source totals", async () => {
  const result = await inspectBrightspaceCaptureFile(file(source()), "NAIT");
  assert.equal(result.counts.questionDefinitions, 0);
  assert(result.warnings.some((w) => /access denied/.test(w)));
  assert(
    result.findings.some(
      (f) => f.code === "QUIZ_DEFINITION_COVERAGE_UNVERIFIED",
    ),
  );
});
test("source input rejects wrong-platform, malformed, empty, oversized and diagnostic evidence", async () => {
  for (const input of [
    file({ fingerprints: [], schemaVersion: 35 }),
    file({ ...source(), contentTree: null }),
    file({
      ...source(),
      kind: "FOCUSED_EXTRACTOR_DIAGNOSTIC",
      notForCourseAudit: true,
    }),
    new File(["{"], "bad.json"),
    new File([], "empty.json"),
  ]) {
    await assert.rejects(inspectBrightspaceCaptureFile(input, ""));
  }
  await assert.rejects(
    inspectBrightspaceCaptureFile(
      {
        size: 40 * 1024 * 1024 + 1,
        text: () => {
          throw Error("must not read oversized file");
        },
      },
      "",
    ),
    /40 MiB/,
  );
});
