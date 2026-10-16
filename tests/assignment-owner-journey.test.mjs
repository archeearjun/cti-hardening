import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentChangeFreshness,
  summarizeAssignmentChanges,
} from "../src/domain/assignment-change-freshness.ts";
import { assignmentOwnerJourney } from "../src/domain/assignment-owner-journey.ts";
import {
  assignmentBasis,
  evaluateAssignment,
  loadAssignmentEvidence,
  reconciliationCurrent,
} from "../src/domain/assignment-plan.ts";
import {
  assignmentItemId,
  itemLifecycleRecordId,
} from "../src/domain/item-lifecycle.ts";
import { recordSummary } from "../src/domain/workspace-store.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";

const pending = {
  source: "",
  coursera: "",
  excel: "",
  changed: false,
  courseraChanged: false,
};
const day = (n) => `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`;
function setup() {
  const course = comparisonFixture().course;
  course.version = 1;
  const audit = {
    ...structuredClone(course),
    id: "before-audit",
    kind: "audit",
    packageId: course.id,
    updatedAt: day(2),
    data: {
      sourceScanSha256: course.data.scan.fileSha256,
      hashes: {
        json: "b".repeat(64),
        brightspace: "c".repeat(64),
        excel: "e".repeat(64),
      },
      result: {
        success: true,
        inputCoherence: { status: "PASS" },
        stats: { extractorMeta: { capturedAt: day(1) } },
        ownerView: {
          items: [
            {
              id: "reading",
              name: "Reading",
              type: "Reading",
              status: "REVIEW",
              actions: [
                { severity: "REVIEW", action: "Inspect the original source." },
              ],
            },
          ],
        },
      },
    },
  };
  function event(
    decision = "changed",
    platform = "coursera",
    recordedAt = day(3),
    nativeId = "reading",
  ) {
    return {
      kind: "decision",
      decision,
      eventId: crypto.randomUUID(),
      sequence: 1,
      courseId: course.id,
      itemId: assignmentItemId(course.id, platform, nativeId),
      platform,
      nativeId,
      actor: "Fixture owner",
      recordedAt,
      observedAt: recordedAt,
      note: "Observed and recorded this exact source item.",
      basis: {
        auditId: audit.id,
        auditVersion: audit.version,
        sourceScanSha256: audit.data.sourceScanSha256,
        inputHashes: structuredClone(audit.data.hashes),
        fingerprint: "d".repeat(64),
      },
    };
  }
  function ledger(events = [event()]) {
    return {
      id: itemLifecycleRecordId(course.id),
      kind: "operations",
      title: "Item lifecycle",
      packageId: course.id,
      version: 1,
      updatedAt: events.at(-1)?.recordedAt || day(3),
      updatedBy: "Fixture owner",
      data: {
        type: "item-lifecycle",
        schemaVersion: 1,
        courseId: course.id,
        events: events.map((value, index) => ({
          ...value,
          sequence: index + 1,
        })),
      },
    };
  }
  function after() {
    const refreshed = structuredClone(audit);
    refreshed.id = "after-audit";
    refreshed.updatedAt = day(5);
    refreshed.data.hashes.json = "f".repeat(64);
    refreshed.data.result.stats.extractorMeta.capturedAt = day(4);
    return refreshed;
  }
  const journey = (report = audit, history = [], inputs = pending) => {
    const records = [course, report, ...history].filter(Boolean);
    return assignmentOwnerJourney(
      course,
      report,
      evaluateAssignment(course, report, records),
      inputs,
    );
  };
  return { course, audit, event, ledger, after, journey };
}

test("owner journey separates source inspection, capture, comparison, correction, verification and delivery", () => {
  const f = setup();
  const result = f.journey();
  assert.deepEqual(
    result.steps.map((step) => step.id),
    ["understand", "collect", "compare", "fix", "verify", "deliver"],
  );
  assert.equal(result.currentStage, "fix");
  assert.equal(result.comparisonRecorded, true);
  assert.equal(result.reviewCurrent, false);
  assert.equal(result.counts.flaggedTasks, 1);
  assert.match(result.scope, /not a quality score/);
  assert.equal(Object.hasOwn(result, "extractionPercent"), false);
  const noDestination = f.journey(null);
  assert.equal(noDestination.comparisonRecorded, false);
  assert.match(
    noDestination.steps.find((step) => step.id === "collect").detail,
    /Destination differences are unknown/,
  );
  assert.equal(
    noDestination.steps.find((step) => step.id === "fix").status,
    "waiting",
  );
});

test("a source document remains text-only and an old report does not replace missing package provenance", () => {
  const f = setup();
  f.course.data.scan.sourceEvidence = { kind: "CTI_SOURCE_DOCUMENT_BASELINE" };
  const result = f.journey();
  assert.equal(result.sourceScope, "text-only");
  assert.equal(result.steps[0].status, "limited");
  assert.match(result.steps[0].detail, /do not prove native LMS boundaries/);
  delete f.course.data.scan.sourceEvidence;
  f.course.data.scan.fileSha256 = "";
  assert.equal(f.journey().currentStage, "understand");
  assert.equal(f.journey().nextAction.action, "scan");
});

test("changed followed by checked retains the edit barrier and bounded listing receipt", () => {
  const f = setup();
  const ledger = f.ledger([f.event(), f.event("checked", "coursera", day(4))]);
  const before = structuredClone(ledger);
  const summary = recordSummary(ledger);
  assert.equal(summary.data.declaredChanges.declarationCount, 1);
  assert.equal(summary.data.declaredChanges.latest.length, 1);
  assert.equal(Object.hasOwn(summary.data, "events"), false);
  assert.deepEqual(ledger, before);
  for (const history of [ledger, summary]) {
    const result = assignmentChangeFreshness(f.course.id, f.audit, [history]);
    assert.equal(result.needsRecapture, true);
    assert.match(result.blockers[0], /later checked decision does not refresh/);
    assert.equal(f.journey(f.audit, [history]).currentStage, "verify");
    assert.equal(f.journey(f.audit, [history]).nextAction.action, "coursera");
  }
});

test("checked alone is documented review and never declares an unseen edit", () => {
  const f = setup();
  const ledger = f.ledger([f.event("checked")]);
  assert.equal(
    assignmentChangeFreshness(f.course.id, f.audit, [recordSummary(ledger)])
      .needsRecapture,
    false,
  );
  assert.equal(f.journey(f.audit, [ledger]).counts.editDeclarations, 0);
});

test("recapture requires a new audit, a different capture hash and actual capture after the edit", () => {
  const f = setup();
  const ledger = f.ledger();
  const current = f.after();
  assert.equal(
    assignmentChangeFreshness(f.course.id, current, [ledger]).needsRecapture,
    false,
  );
  const invalid = [
    { id: f.audit.id },
    { updatedAt: day(3) },
    { capturedAt: day(2) },
    { capturedAt: day(3) },
    { capturedAt: "unknown" },
    { hash: f.audit.data.hashes.json },
    { hash: "missing-source-identity" },
  ];
  for (const mutation of invalid) {
    const changed = structuredClone(current);
    if (mutation.id) changed.id = mutation.id;
    if (mutation.updatedAt) changed.updatedAt = mutation.updatedAt;
    if (mutation.capturedAt)
      changed.data.result.stats.extractorMeta.capturedAt = mutation.capturedAt;
    if (mutation.hash) changed.data.hashes.json = mutation.hash;
    assert.equal(
      assignmentChangeFreshness(f.course.id, changed, [ledger]).needsRecapture,
      true,
      JSON.stringify(mutation),
    );
  }
});

test("fresh comparisons clear historical declarations without deleting their history", () => {
  const f = setup();
  const ledger = f.ledger([f.event(), f.event("checked", "coursera", day(4))]);
  const fresh = f.after();
  fresh.updatedAt = day(7);
  fresh.data.result.stats.extractorMeta.capturedAt = day(6);
  const result = f.journey(fresh, [recordSummary(ledger)]);
  assert.equal(result.recaptureRequired, false);
  assert.equal(result.counts.editDeclarations, 1);
  assert.equal(result.comparisonCurrent, true);
  assert.equal(ledger.data.events.length, 2);
  assert.equal(
    result.reviewCurrent,
    false,
    "new audit does not inherit reconciliation",
  );
});

test("staged refreshed captures lead to comparison while saved evidence remains stale", () => {
  const f = setup();
  const result = f.journey(f.audit, [f.ledger()], {
    ...pending,
    coursera: "after.cti.zip",
    courseraChanged: true,
    changed: true,
  });
  assert.equal(result.nextAction.action, "compare");
  assert.equal(result.comparisonCurrent, false);
  assert.equal(result.recaptureRequired, true);
  assert.match(
    result.nextAction.detail,
    /selecting a file alone does not verify/,
  );
});

test("a fresh Coursera capture cannot clear a changed Brightspace source", () => {
  const f = setup();
  const ledger = f.ledger([f.event("changed", "brightspace")]);
  const fresh = f.after();
  assert.equal(
    assignmentChangeFreshness(f.course.id, fresh, [ledger]).needsRecapture,
    true,
  );
  assert.equal(f.journey(fresh, [ledger]).nextAction.action, "source");
  fresh.data.hashes.brightspace = "1".repeat(64);
  fresh.data.result.liveSourceGroundTruth = { capturedAt: day(4) };
  assert.equal(
    assignmentChangeFreshness(f.course.id, fresh, [ledger]).needsRecapture,
    false,
  );
  fresh.data.result.liveSourceGroundTruth.capturedAt = day(2);
  assert.equal(
    assignmentChangeFreshness(f.course.id, fresh, [ledger]).needsRecapture,
    true,
  );
});

test("changed package sources require a different source identity as well as a new comparison", () => {
  const f = setup();
  const ledger = f.ledger([f.event("changed", "source")]);
  const fresh = f.after();
  assert.equal(
    assignmentChangeFreshness(f.course.id, fresh, [ledger]).needsRecapture,
    true,
  );
  assert.equal(f.journey(fresh, [ledger]).nextAction.action, "scan");
  fresh.data.sourceScanSha256 = "2".repeat(64);
  assert.equal(
    assignmentChangeFreshness(f.course.id, fresh, [ledger]).needsRecapture,
    false,
  );
  f.course.data.scan.fileSha256 = fresh.data.sourceScanSha256;
  assert.equal(
    f.journey(f.audit, [ledger]).nextAction.action,
    "compare",
    "a saved replacement scan should lead to comparison rather than another scan",
  );
});

test("a summary retains at most one latest barrier per platform and every change declaration count", () => {
  const f = setup();
  const ledger = f.ledger([
    f.event("changed", "coursera", day(3), "first"),
    f.event("changed", "coursera", day(4), "second"),
    f.event("changed", "brightspace", day(3), "third"),
    f.event("changed", "source", day(3), "fourth"),
  ]);
  const result = summarizeAssignmentChanges(ledger.data);
  assert.equal(result.declarationCount, 4);
  assert.equal(result.latest.length, 3);
  assert.equal(
    result.latest.find((change) => change.platform === "coursera").nativeId,
    "second",
  );
});

test("old summaries can use the exact loaded full ledger; stale and ambiguous history remain blocked", () => {
  const f = setup();
  const ledger = f.ledger();
  const oldSummary = recordSummary(ledger);
  delete oldSummary.data.declaredChanges;
  assert.equal(
    assignmentChangeFreshness(f.course.id, f.audit, [oldSummary]).status,
    "history-unavailable",
  );
  f.audit.data.assignmentLifecycleEvidence = ledger;
  assert.equal(
    assignmentChangeFreshness(f.course.id, f.audit, [oldSummary]).status,
    "recapture-required",
  );
  oldSummary.version++;
  assert.equal(
    assignmentChangeFreshness(f.course.id, f.audit, [oldSummary]).status,
    "history-unavailable",
  );
  assert.equal(
    assignmentChangeFreshness(f.course.id, f.audit, [ledger, ledger]).status,
    "history-unavailable",
  );
  const wrong = structuredClone(ledger);
  wrong.data.events[0].basis.fingerprint = "invalid";
  assert.equal(
    assignmentChangeFreshness(f.course.id, f.audit, [wrong]).status,
    "history-unavailable",
  );
  assert.equal(
    assignmentChangeFreshness("different-course", f.audit, [ledger]).status,
    "current",
  );
});

test("edit declarations block plan review and invalidate a matching old reconciliation receipt", () => {
  const f = setup();
  const ledger = recordSummary(
    f.ledger([f.event(), f.event("checked", "coursera", day(4))]),
  );
  const records = [f.course, f.audit, ledger];
  const e = evaluateAssignment(f.course, f.audit, records);
  assert.equal(e.canRecordReview, false);
  assert(e.blockers.some((blocker) => /recorded as changed/.test(blocker)));
  f.course.data.assignmentPlan = {
    route: "COURSE",
    shellChangedAt: "",
    reconciliation: {
      basis: assignmentBasis(f.course, f.audit, records),
      note: "This explicit review cannot replace a new source observation.",
      recordedAt: day(5),
      recordedBy: "Fixture owner",
    },
  };
  assert.equal(reconciliationCurrent(f.course, f.audit, records), false);
  assert.equal(f.journey(f.audit, [ledger]).reviewCurrent, false);
});

test("loadAssignmentEvidence obtains full edit history for legacy shared listing rows", async () => {
  const f = setup();
  const ledger = f.ledger();
  const oldSummary = recordSummary(ledger);
  delete oldSummary.data.declaredChanges;
  const store = {
    get: async (id) => {
      if (id === f.audit.id) return f.audit;
      if (id === ledger.id) return ledger;
      throw Error("not found");
    },
    list: async () => [recordSummary(f.audit), oldSummary],
  };
  const loaded = await loadAssignmentEvidence(f.audit.id, store);
  assert.equal(loaded.data.assignmentLifecycleEvidence.id, ledger.id);
  assert.equal(
    assignmentChangeFreshness(f.course.id, loaded, [oldSummary]).needsRecapture,
    true,
  );
  assert.equal(
    Object.hasOwn(f.audit.data, "assignmentLifecycleEvidence"),
    false,
  );
});
