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
import {
  assignmentDeliverableRecordId,
  generateAssignmentDeliverable,
  makeAssignmentDeliverableData,
} from "../src/domain/assignment-deliverables.ts";
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
function specialization(f) {
  f.course.data.assignmentPlan.route = "SPECIALIZATION";
  f.audit.data.contentEvidence = {
    schemaVersion: 1,
    brightspace: [],
    coursera: [
      {
        id: "item",
        name: "Assignment",
        path: "",
        content: {
          url: "https://www.coursera.org/teach/synthetic/course123/content/item/supplement/item",
          text: "Literal retained content",
          textCoverage: "COMPLETE",
          questionCoverage: "EMPTY",
          basis: "Synthetic capture",
          capturedAt: "2026-10-02T00:00:00Z",
        },
      },
    ],
  };
  sign(f);
}
function mapRevision(f, event) {
  const artifact = generateAssignmentDeliverable(
    f.course,
    f.audit,
    f.records,
    "content-map",
  );
  const data = makeAssignmentDeliverableData(
    artifact,
    f.records,
    event,
    event === "draft"
      ? ""
      : "Owner reviewed this exact source-linked structural artifact.",
    "owner",
  );
  const record = {
    id: assignmentDeliverableRecordId(data.deliverableId, data.revision),
    kind: "operations",
    packageId: f.course.id,
    title: "Content map",
    version: 1,
    updatedAt: "2026-10-02T03:00:00Z",
    updatedBy: "owner",
    data,
  };
  f.records.push(record);
  return record;
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

test("approved integrated content maps enable specialization without an external document URL and identify their immutable record", () => {
  const f = fixture();
  specialization(f);
  const original = JSON.stringify(f.audit);
  mapRevision(f, "draft");
  const approval = mapRevision(f, "approved");
  for (const records of [f.records, f.records.map(recordSummary)]) {
    const e = evaluateAssignment(f.course, f.audit, records);
    assert.equal(e.reconciled, true);
    assert.equal(e.mapApproved, true);
    assert.equal(e.approvedMapRecordId, approval.id);
    assert.equal(e.outlineReady, true);
    const handoff = assignmentHandoff(f.course, f.audit, records);
    assert.ok(
      handoff.includes("Content map approval: CTI saved record " + approval.id),
    );
    assert.doesNotMatch(handoff, /Content map approval: undefined/);
  }
  assert.equal(
    JSON.stringify(f.audit),
    original,
    "Owner approval never rewrites QA evidence",
  );
  delete f.course.data.assignmentPlan.reconciliation;
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    false,
  );
});

test("latest internal drafts, revisions and rejection supersede older internal and legacy external map approval", () => {
  const f = fixture();
  specialization(f);
  f.course.data.assignmentPlan.mapApproval = {
    ...f.course.data.assignmentPlan.reconciliation,
    url: "https://docs.google.com/document/d/legacy/edit",
  };
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    true,
  );
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).hasIntegratedMapHistory,
    false,
  );
  mapRevision(f, "draft");
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).hasIntegratedMapHistory,
    true,
  );
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    false,
    "A new internal draft cannot inherit the old external receipt",
  );
  const approved = mapRevision(f, "approved");
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).approvedMapRecordId,
    approved.id,
  );
  mapRevision(f, "revision");
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    false,
  );
  mapRevision(f, "approved");
  mapRevision(f, "rejected");
  const e = evaluateAssignment(f.course, f.audit, f.records);
  assert.equal(e.reconciled, true);
  assert.equal(e.mapApproved, false);
  assert.equal(e.approvedMapRecordId, undefined);
  assert.equal(e.outlineReady, false);
  assert.match(
    assignmentHandoff(f.course, f.audit, f.records),
    /Content map approval: Not recorded for this evidence/,
  );
});

test("newly reconciled source, audit and owner evidence cannot inherit an approval from an older basis", () => {
  for (const change of [
    (f) => {
      f.course.data.scan.fileSha256 = "c".repeat(64);
      f.audit.data.sourceScanSha256 = "c".repeat(64);
    },
    (f) => {
      f.course.data.scan.scannedAt = "2026-10-02T00:30:00Z";
    },
    (f) => {
      f.audit.id = "new-audit";
      f.review.data.auditId = f.audit.id;
    },
    (f) => {
      f.audit.version++;
    },
    (f) => {
      f.audit.data.hashes.json = "d".repeat(64);
    },
    (f) => {
      f.review.version++;
    },
    (f) => {
      f.course.data.assignmentPlan.shellChangedAt = "2026-10-03T00:00:00Z";
      f.audit.data.result.stats.extractorMeta.capturedAt =
        "2026-10-04T00:00:00Z";
    },
  ]) {
    const f = fixture();
    specialization(f);
    mapRevision(f, "draft");
    mapRevision(f, "approved");
    change(f);
    sign(f);
    const e = evaluateAssignment(f.course, f.audit, f.records);
    assert.equal(
      e.reconciled,
      true,
      "The current evidence was independently reconciled",
    );
    assert.equal(
      e.mapApproved,
      false,
      "A different basis needs a new map approval",
    );
    assert.equal(e.approvedMapRecordId, undefined);
  }
});

test("integrated approval requires the exact course, audit ID/version and an unambiguous latest saved revision", () => {
  for (const change of [
    (r) => {
      r.data.courseId = "other-course";
    },
    (r) => {
      r.data.auditId = "other-audit";
    },
    (r) => {
      r.data.auditVersion++;
    },
    (r) => {
      r.data.basisHash = "f".repeat(64);
    },
    (r) => {
      r.version = 0;
    },
  ]) {
    const f = fixture();
    specialization(f);
    mapRevision(f, "draft");
    const approved = mapRevision(f, "approved");
    change(approved);
    assert.equal(
      evaluateAssignment(f.course, f.audit, f.records).mapApproved,
      false,
    );
  }
  const f = fixture();
  specialization(f);
  mapRevision(f, "draft");
  const approved = mapRevision(f, "approved");
  f.records.push({
    ...structuredClone(approved),
    id: "duplicate-latest-revision",
  });
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    false,
  );
});

test("integrated map approval does not bypass recapture after external application", () => {
  const f = fixture();
  specialization(f);
  mapRevision(f, "draft");
  mapRevision(f, "approved");
  mapRevision(f, "external-application-recorded");
  const e = evaluateAssignment(f.course, f.audit, f.records);
  assert.equal(e.applicationNeedsCapture, true);
  assert.equal(e.reconciled, false);
  assert.equal(e.mapApproved, false);
  assert.equal(e.outlineReady, false);
});

test("exact-input content supplement additions and updates invalidate reconciliation and internal approvals in full records and summaries", () => {
  const f = fixture();
  specialization(f);
  mapRevision(f, "draft");
  mapRevision(f, "approved");
  const initial = assignmentBasis(f.course, f.audit, f.records);
  const supplement = {
    id: "original-content",
    kind: "operations",
    packageId: f.course.id,
    version: 1,
    updatedAt: "2026-10-02T04:00:00Z",
    updatedBy: "owner",
    title: "Original Coursera input",
    data: {
      type: "report-content",
      runId: f.audit.id,
      platform: "coursera",
      sourceHash: f.audit.data.hashes.json,
    },
  };
  for (const other of [
    {
      ...supplement,
      id: "different-audit",
      data: { ...supplement.data, runId: "other-audit" },
    },
    { ...supplement, id: "different-course", packageId: "other-course" },
  ])
    f.records.push(other);
  assert.equal(
    assignmentBasis(f.course, f.audit, f.records),
    initial,
    "Unrelated supplements do not change current evidence",
  );
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    true,
  );
  f.records.push(supplement);
  assert.notEqual(assignmentBasis(f.course, f.audit, f.records), initial);
  for (const records of [f.records, f.records.map(recordSummary)]) {
    assert.equal(
      assignmentBasis(f.course, f.audit, records),
      assignmentBasis(f.course, f.audit, f.records),
    );
    const e = evaluateAssignment(f.course, f.audit, records);
    assert.equal(e.reconciled, false);
    assert.equal(e.mapApproved, false);
    assert.equal(e.approvedMapRecordId, undefined);
  }
  sign(f);
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).reconciled,
    true,
  );
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    false,
    "New reconciliation cannot resurrect the old map approval",
  );
  mapRevision(f, "revision");
  mapRevision(f, "approved");
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    true,
  );
  supplement.version++;
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).reconciled,
    false,
  );
  sign(f);
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).mapApproved,
    false,
  );
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

test("reference scope and explicit relevance govern work and invalidate signed handoffs without changing the report", () => {
  const f = fixture();
  f.audit.data.result.ownerView.items.push({
    id: "archive",
    name: "Old material",
    path: "Archive > Lesson",
    type: "Reading",
    status: "REVIEW",
    actions: [{ severity: "REVIEW", action: "Old diagnostic" }],
  });
  const original = JSON.stringify(f.audit);
  let e = evaluateAssignment(f.course, f.audit, f.records);
  assert.equal(e.excluded.length, 1);
  assert.equal(e.attention.length, 1);
  assert.equal(e.canRecordReview, true);
  sign(f);
  const oldBasis = assignmentBasis(f.course, f.audit, f.records);
  f.review.data.review.relevance = "not_relevant";
  e = evaluateAssignment(f.course, f.audit, f.records);
  assert.equal(e.attention.length, 0);
  assert.equal(e.excluded.length, 2);
  assert.notEqual(e.basis, oldBasis);
  assert.equal(e.reconciled, false);
  assert.equal(JSON.stringify(f.audit), original);
  const handoff = assignmentHandoff(f.course, f.audit, f.records);
  assert.match(handoff, /Reference only \/ excluded from publishing work: 2/);
  assert.doesNotMatch(handoff, /Action: Old diagnostic/);
  f.review.data.review.relevance = "auto";
  f.audit.data.result.ownerView.items[0].path = "Instructor Resources";
  f.review.data.review.status = "open";
  f.review.data.review.note = "";
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).attention.length,
    0,
  );
  f.review.data.review.relevance = "relevant";
  assert.equal(
    evaluateAssignment(f.course, f.audit, f.records).canRecordReview,
    false,
  );
});
