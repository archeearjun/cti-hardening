import test from "node:test";
import assert from "node:assert/strict";
import { captureWorkPlan } from "../src/domain/capture-work-plan.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";

const hash = (c) => c.repeat(64);
function setup() {
  const course = comparisonFixture().course;
  course.version = 1;
  const audit = {
    ...structuredClone(course),
    id: "capture-plan-audit",
    kind: "audit",
    packageId: course.id,
    updatedAt: "2026-10-19T00:00:00.000Z",
    data: {
      sourceScanSha256: course.data.scan.fileSha256,
      hashes: { brightspace: hash("b"), json: hash("c"), excel: hash("e") },
      result: { success: true, inputCoherence: { status: "PASS" } },
    },
  };
  const input = (
    role,
    sourceHash,
    importedAt = "2026-10-19T00:00:00.000Z",
  ) => ({
    ...structuredClone(course),
    id: `${role}-${sourceHash[0]}`,
    kind: "operations",
    packageId: course.id,
    data: {
      type: "evidence-input",
      schemaVersion: 1,
      role,
      sourceName: "original.cti.zip",
      sourceHash,
      bytes: 10,
      mediaType: "application/zip",
      importedAt,
      confirmedCourseId: course.id,
      platform: role === "coursera-capture" ? "coursera" : "brightspace",
      nativeCourseId: "native-id",
      capturedAt: "2026-10-18T00:00:00.000Z",
      title: course.title,
      scope: "Original capture with unresolved sources",
      gaps: ["Completeness unverified"],
      original: { retention: "FILE_REFERENCE" },
    },
  });
  return { course, audit, input };
}
test("capture plan routes missing evidence without starting any capture", () => {
  const { course, input } = setup();
  assert.equal(captureWorkPlan([course])[0].destination, "Source LMS");
  assert.equal(
    captureWorkPlan([course, input("brightspace-capture", hash("b"))])[0]
      .destination,
    "Extract",
  );
  const row = captureWorkPlan([
    course,
    input("brightspace-capture", hash("b")),
    input("coursera-capture", hash("c")),
  ])[0];
  assert.equal(row.destination, "Compare");
  assert.equal(row.captureStarted, false);
  assert.equal(row.completeContentEstablished, false);
  assert.match(row.coursera, /review content coverage/);
});
test("missing, historical and manifest source scans go to source inspection", () => {
  for (const scan of [
    undefined,
    { fileName: "old.imscc" },
    { fileSha256: hash("a"), sourceEvidence: { manifestOnly: true } },
  ]) {
    const { course } = setup();
    course.data.scan = scan;
    assert.equal(captureWorkPlan([course])[0].destination, "Scan");
  }
});
test("metadata-only structural comparison never asserts content or freshness", () => {
  const { course, audit } = setup();
  const row = captureWorkPlan([course, audit])[0];
  assert.equal(row.destination, "Assignment workspace");
  assert.match(row.comparison, /content and freshness require review/);
  assert.equal(row.completeContentEstablished, false);
  course.data.scan.fileSha256 = hash("f");
  assert.equal(captureWorkPlan([course, audit])[0].destination, "Compare");
});
test("latest input change requires comparison while older immutable inputs stay in plan history", () => {
  const { course, audit, input } = setup();
  const older = input(
    "coursera-capture",
    hash("d"),
    "2026-10-17T00:00:00.000Z",
  );
  const current = input("coursera-capture", hash("c"));
  const row = captureWorkPlan([course, audit, current, older])[0];
  assert.equal(row.destination, "Assignment workspace");
  assert.equal(row.inputs.length, 2);
  current.data.sourceHash = hash("f");
  assert.equal(
    captureWorkPlan([course, audit, current, older])[0].destination,
    "Compare",
  );
});
test("wrong-course, invalid and unrelated metadata cannot satisfy input presence", () => {
  const { course, input } = setup();
  for (const mutate of [
    (r) => {
      r.packageId = "other";
    },
    (r) => {
      r.data.confirmedCourseId = "other";
    },
    (r) => {
      r.data.sourceHash = "unknown";
    },
    (r) => {
      r.kind = "checklist";
    },
  ]) {
    const record = input("brightspace-capture", hash("b"));
    mutate(record);
    assert.equal(
      captureWorkPlan([course, record])[0].destination,
      "Source LMS",
    );
  }
});
test("one title's evidence never fills another title and archived titles are excluded", () => {
  const { course, audit } = setup();
  const other = structuredClone(course);
  other.id = "other-title";
  other.title = "Other";
  const archived = structuredClone(course);
  archived.id = "archive";
  archived.data.archived = true;
  const plan = captureWorkPlan([course, other, audit, archived]);
  assert.equal(plan.length, 2);
  assert.equal(
    plan.find((r) => r.courseId === other.id).destination,
    "Source LMS",
  );
  assert.equal(
    plan.find((r) => r.courseId === course.id).destination,
    "Assignment workspace",
  );
});

test("compressed original input hashes match their comparison transport, not expanded metadata bytes", () => {
  const { course, audit, input } = setup();
  audit.data.captureTransport = {
    json: { encoding: "zip", sha256: hash("f") },
    brightspace: { encoding: "gzip", sha256: hash("a") },
  };
  const files = [
    input("coursera-capture", hash("f")),
    input("brightspace-capture", hash("a")),
  ];
  const row = captureWorkPlan([course, audit, ...files])[0];
  assert.equal(row.destination, "Assignment workspace");
  assert.equal(row.audit.transportHashes.json, hash("f"));
  assert.equal(row.audit.inputHashes.json, hash("c"));
  files[0].data.sourceHash = hash("d");
  assert.equal(
    captureWorkPlan([course, audit, ...files])[0].destination,
    "Compare",
  );
});

test("a failed comparison needs another comparison even with matching recorded structure", () => {
  const { course, audit } = setup();
  audit.data.result.success = false;
  assert.equal(captureWorkPlan([course, audit])[0].destination, "Compare");
});

test("tied audit dates use the same current report as the assignment workspace", () => {
  const { course, audit } = setup();
  const laterId = structuredClone(audit);
  laterId.id = "z-current-audit";
  laterId.data.sourceScanSha256 = hash("d");
  const row = captureWorkPlan([course, audit, laterId])[0];
  assert.equal(row.audit.id, laterId.id);
  assert.equal(row.destination, "Compare");
});
