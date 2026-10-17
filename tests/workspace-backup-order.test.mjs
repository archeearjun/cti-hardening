import test from "node:test";
import assert from "node:assert/strict";
import { prepareWorkspaceBackup } from "../src/domain/workspace-validation.ts";
import { ingestionAttemptRecordId } from "../src/domain/ingestion-attempts.ts";

const course = {
  id: "course-backup", kind: "package", title: "Source course", packageId: "",
  version: 5, updatedAt: "2026-10-03T00:00:00.000Z", updatedBy: "owner@example.test",
  data: { scan: { courseTree: [], stats: {} } },
};
const audit = (id, generation, basis) => ({
  ...course, id, kind: "audit", packageId: course.id,
  data: { generation, result: {}, ...(basis ? { automaticIngestion: basis } : {}) },
});
const basis = (generation, baseAuditId = "", attemptRecordId = "") => ({
  schemaVersion: 1, courseId: course.id, generation, baseAuditId, attemptRecordId,
});
const baseline = audit("baseline", 0, basis(0));
const receipt = {
  ...course, id: ingestionAttemptRecordId(course.id, 1), kind: "operations", packageId: course.id,
  data: {
    type: "ingestion-attempt", schemaVersion: 1, courseId: course.id,
    generation: 1, previousGeneration: 0, baseAuditId: baseline.id,
    previousAttemptId: "", declaredAt: "2026-09-29T00:00:00.000Z",
    declaredBy: "owner@example.test", scope: "OWNER_DECLARED_EXTERNAL_INGESTION",
  },
};
const after = audit("after", 1, basis(1, baseline.id, receipt.id));
const backup = (records) => ({ kind: "CTI_BROWSER_WORKSPACE", schemaVersion: 1, records });

test("reversed automatic history restores by causal references without rewriting evidence", () => {
  const input = [after, receipt, baseline, course];
  const ordered = prepareWorkspaceBackup(backup(input));
  assert.deepEqual(ordered.map((r) => r.id), [course.id, baseline.id, receipt.id, after.id]);
  for (const record of ordered) {
    assert.equal(record.version, 0);
    assert.deepEqual(record.data, input.find((r) => r.id === record.id).data);
    assert.equal(record.updatedAt, input.find((r) => r.id === record.id).updatedAt);
  }
  assert.ok(input.every((r) => r.version === 5));
});

test("a corrected legacy baseline restores its repair before a dependent receipt", () => {
  const legacy = audit("baseline", 3);
  const repair = {
    ...course, id: "repair-baseline", kind: "operations", packageId: course.id,
    data: { type: "lineage-repair", runId: legacy.id, toGeneration: 0 },
  };
  const ordered = prepareWorkspaceBackup(backup([receipt, repair, legacy, course]));
  assert.deepEqual(ordered.map((r) => r.id), [course.id, legacy.id, repair.id, receipt.id]);
  assert.equal(ordered.find((r) => r.id === legacy.id).data.generation, 3);
});

test("legacy-only backups retain their original ordering", () => {
  const legacy = [audit("newer", 3), audit("older", 0), course];
  assert.deepEqual(prepareWorkspaceBackup(backup(legacy)).map((r) => r.id), legacy.map((r) => r.id));
});

test("unrelated backup records keep their relative order", () => {
  const other = (id) => ({ ...course, id, kind: "legacy-backup", data: { retained: id } });
  const ordered = prepareWorkspaceBackup(backup([other("first"), after, other("second"), receipt, baseline, course]));
  assert.deepEqual(ordered.filter((r) => r.kind === "legacy-backup").map((r) => r.id), ["first", "second"]);
});

test("missing automatic history fails before any restore saves", () => {
  assert.throws(() => prepareWorkspaceBackup(backup([after, course])), /missing.*ingestion-history reference/i);
  assert.throws(() => prepareWorkspaceBackup(backup([receipt, baseline])), /missing.*ingestion-history reference/i);
});

test("cyclic automatic references fail before any restore saves", () => {
  const cyclicBaseline = audit(baseline.id, 0, basis(0, after.id));
  assert.throws(() => prepareWorkspaceBackup(backup([after, receipt, cyclicBaseline, course])), /cyclic ingestion-history/i);
});
