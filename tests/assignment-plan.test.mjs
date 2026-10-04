import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentBasis,
  evaluateAssignment,
  normalizeAssignmentPlan,
  reconciliationCurrent,
  assignmentHandoff,
} from "../src/domain/assignment-plan.ts";
import { nextWorkAction } from "../src/domain/operations.ts";
import { validateRecord } from "../src/domain/workspace-validation.ts";
import { recordSummary } from "../src/domain/workspace-store.ts";
function fixture() {
  const course = {
    id: "course",
    kind: "package",
    title: "Synthetic title",
    packageId: "",
    version: 1,
    updatedAt: "2026-10-01T01:00:00Z",
    updatedBy: "owner",
    data: {
      scan: {
        fileSha256: "a".repeat(64),
        scannedAt: "2026-10-01T00:00:00Z",
        courseTree: [],
        stats: {},
      },
      assignmentPlan: { route: "COURSE", shellChangedAt: "" },
    },
  };
  const audit = {
    id: "audit",
    kind: "audit",
    title: "Comparison",
    packageId: course.id,
    version: 1,
    updatedAt: "2026-10-02T01:00:00Z",
    updatedBy: "owner",
    data: {
      generation: 1,
      sourceScanSha256: course.data.scan.fileSha256,
      hashes: { json: "b".repeat(64) },
      result: {
        success: true,
        inputCoherence: { status: "PASS" },
        stats: {
          extractorMeta: {
            capturedAt: "2026-10-02T00:00:00Z",
            page: {
              url: "https://www.coursera.org/teach/synthetic/course123/content/edit",
            },
          },
        },
        summary: { headlineText: "Review runtime" },
        ownerView: {
          items: [
            {
              id: "item",
              name: "Assignment",
              type: "Assignment",
              status: "REVIEW",
              actions: [
                {
                  severity: "REVIEW",
                  action: "Check source and learner access.",
                },
              ],
            },
          ],
          unmappedSource: [],
        },
        itemResults: [],
      },
    },
  };
  const review = {
    id: "review",
    kind: "item-review",
    title: "Item review",
    packageId: course.id,
    version: 1,
    updatedAt: "2026-10-02T02:00:00Z",
    updatedBy: "owner",
    data: {
      auditId: audit.id,
      itemKey: "item:item",
      review: {
        status: "checked",
        note: "Checked against the source in learner preview.",
      },
    },
  };
  return { course, audit, review, records: [course, audit, review] };
}
function sign(f) {
  f.course.data.assignmentPlan.reconciliation = {
    basis: assignmentBasis(f.course, f.audit, f.records),
    note: "I checked the source, item evidence and learner access; limitations are documented.",
    recordedAt: "2026-10-02T03:00:00Z",
    recordedBy: "owner",
  };
}

test("no audit, empty inventory, wrong source and XLSX-only comparisons cannot enable owner handoff", () => {
  const f = fixture();
  assert.equal(
    evaluateAssignment(f.course, null, f.records).canRecordReview,
    false,
  );
  for (const change of [
    (a) => (a.data.result.ownerView.items = []),
    (a) => (a.data.sourceScanSha256 = "c".repeat(64)),
    (a) => delete a.data.hashes.json,
    (a) => (a.data.result.inputCoherence.status = "REVIEW"),
  ]) {
    const g = fixture();
    change(g.audit);
    assert.equal(
      evaluateAssignment(g.course, g.audit, g.records).canRecordReview,
      false,
    );
  }
});
test("an item changed, unresolved, or lacking a meaningful manual note never counts as checked", () => {
  for (const [status, note] of [
    ["open", ""],
    ["changed", "Restored the source document."],
    ["blocked", "Needs source access."],
    ["checked", "done"],
  ]) {
    const f = fixture();
    f.review.data.review = { status, note };
    const e = evaluateAssignment(f.course, f.audit, f.records);
    assert.equal(e.checked.length, 0);
    assert.equal(e.canRecordReview, false);
  }
  const f = fixture();
  f.records.push({ ...structuredClone(f.review), id: "duplicate" });
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).canRecordReview,
    false,
  );
});
test("manual reconciliation is explicitly separate from original audit and reused across deliverable paths", () => {
  const f = fixture();
  const original = JSON.stringify(f.audit);
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).reconciled,
    false,
  );
  sign(f);
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).reconciled,
    true,
  );
  f.course.data.assignmentPlan.route = "SPECIALIZATION";
  f.course.version++;
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).reconciled,
    true,
  );
  assert.equal(JSON.stringify(f.audit), original);
  assert.match(
    assignmentHandoff(f.course, f.audit, f.records),
    /does not change the original audit/,
  );
});
test("new source scan, audit, review or shell change invalidates recorded handoff readiness", () => {
  for (const change of [
    (f) => (f.course.data.scan.fileSha256 = "d".repeat(64)),
    (f) => (f.course.data.scan.scannedAt = "2026-10-02T00:00:00Z"),
    (f) => f.review.version++,
    (f) =>
      (f.course.data.assignmentPlan.shellChangedAt = "2026-10-03T00:00:00Z"),
    (f) =>
      f.records.push({
        ...structuredClone(f.audit),
        id: "new",
        updatedAt: "2026-10-04T00:00:00Z",
      }),
  ]) {
    const f = fixture();
    sign(f);
    change(f);
    assert.equal(reconciliationCurrent(f.course, f.audit, f.records), false);
    assert.equal(
      evaluateAssignment(f.course, f.audit, f.records).reconciled,
      false,
    );
  }
});
test("re-uploading old capture after a declared shell edit cannot permit sign-off", () => {
  const f = fixture();
  f.course.data.assignmentPlan.shellChangedAt = "2026-10-03T00:00:00Z";
  f.audit.updatedAt = "2026-10-04T00:00:00Z";
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).canRecordReview,
    false,
  );
  delete f.audit.data.result.stats.extractorMeta.capturedAt;
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).canRecordReview,
    false,
  );
  f.audit.data.result.stats.extractorMeta.capturedAt = "2026-10-04T00:00:00Z";
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).canRecordReview,
    true,
  );
});
test("linked outline needs specific item URLs and specialization additionally needs map approval", () => {
  const f = fixture();
  sign(f);
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).outlineReady,
    false,
  );
  f.audit.data.contentEvidence = {
    coursera: [
      {
        id: "item",
        content: {
          url: "https://www.coursera.org/teach/synthetic/course123/content/item/supplement/item",
        },
      },
    ],
  };
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).outlineReady,
    true,
  );
  f.course.data.assignmentPlan.route = "SPECIALIZATION";
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).outlineReady,
    false,
  );
  f.course.data.assignmentPlan.mapApproval = {
    ...f.course.data.assignmentPlan.reconciliation,
    url: "https://docs.google.com/document/d/example/edit",
  };
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).outlineReady,
    true,
  );
});
test("server record validation rejects malformed approval URLs and keeps receipts in summaries", () => {
  const f = fixture();
  sign(f);
  validateRecord(f.course);
  assert.deepEqual(
    recordSummary(f.course).data.assignmentPlan,
    f.course.data.assignmentPlan,
  );
  for (const url of [
    "javascript:alert(1)",
    "http://example.test",
    "https://user:password@example.test",
  ]) {
    f.course.data.assignmentPlan.mapApproval = {
      ...f.course.data.assignmentPlan.reconciliation,
      url,
    };
    assert.throws(() => validateRecord(f.course));
  }
  assert.throws(() => normalizeAssignmentPlan({ route: "invented" }));
});
test("legacy PASS/DONE cannot bypass reconciliation and specialization follows map then approval then outline", () => {
  const context = {
    hasSource: true,
    sourceRescanned: true,
    deliverableRoute: "SPECIALIZATION",
  };
  const state = {
    courseraRedo: "DONE",
    sourceAudit: "PASS",
    courseOutline: "NOT_STARTED",
  };
  assert.equal(nextWorkAction(context, state).code, "AUDIT_SOURCE");
  context.reconciliationReviewed = true;
  assert.equal(nextWorkAction(context, state).code, "BUILD_CONTENT_MAP");
  state.contentMap = "DONE";
  assert.equal(nextWorkAction(context, state).code, "APPROVE_CONTENT_MAP");
  context.contentMapApproved = true;
  assert.equal(nextWorkAction(context, state).code, "BUILD_SPEC_OUTLINE");
  state.specializationOutline = "SECURED";
  assert.equal(nextWorkAction(context, state).code, "COMPLETE");
  context.deliverableRoute = "COURSE";
  assert.equal(nextWorkAction(context, state).code, "BUILD_COURSE_OUTLINE");
});
