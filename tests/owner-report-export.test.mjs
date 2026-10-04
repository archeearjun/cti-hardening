import test from "node:test";
import assert from "node:assert/strict";
import { prepareOwnerReportExport } from "../src/domain/owner-report-export.ts";
import { newRecord, recordSummary } from "../src/domain/workspace-store.ts";

function fixture() {
  const course = {
    ...newRecord("package", "Example course", {}),
    id: "package-a",
  };
  const report = {
    packageId: course.id,
    ingestionCapabilityStatus: "LATEST_APPLIED",
    report:
      "ORIGINAL FINDINGS\nQuestion types unknown\nCritical images unresolved",
    result: {
      stats: {
        extractorMeta: {
          page: {
            url: "https://www.coursera.org/teach/example/course-a/content/edit",
          },
        },
      },
      ownerView: {
        items: [
          {
            id: "survey",
            name: "Example survey",
            status: "EVIDENCE_NEEDED",
            actions: [],
          },
        ],
      },
    },
  };
  const capture = {
    kind: "CTI_COURSERA_ITEM_CHECK",
    schemaVersion: 1,
    notForCourseAudit: true,
    auditId: "audit-a",
    itemId: "survey",
    courseId: "course-a",
    openedUrl:
      "https://www.coursera.org/teach/example/course-a/content/edit?itemId=survey",
    expectations: [],
    finishedAt: "2026-10-04T14:14:01Z",
    extractorVersion: "v6.15.9",
    extractorBuild: "test-build",
    editorObserved: true,
    payload: {
      structuredAssessment: {
        captureCompleteness: {
          questionCoverageComplete: true,
          requiredAnswerCoverageComplete: false,
        },
        questions: [
          {
            id: "q1",
            type: "single-select",
            prompt: "Preferred format?",
            optionTextReliable: true,
            answerEvidenceStatus: "NOT_OBSERVED",
            options: ["Classroom", "Live online", "Self-paced", "Hybrid"].map(
              (text) => ({ text, correct: null }),
            ),
          },
          {
            id: "q2",
            type: "multiple-select",
            prompt: "Preferred methods?",
            optionTextReliable: true,
            answerEvidenceStatus: "NOT_OBSERVED",
            options: ["Lectures", "Videos", "Reading"].map((text) => ({
              text,
              correct: null,
            })),
          },
        ],
      },
    },
    evaluation: { automatedResolution: true, answerCoverageComplete: true },
  };
  const record = {
    ...newRecord(
      "item-review",
      "Example survey",
      {
        auditId: "audit-a",
        itemKey: "item:survey",
        review: {
          status: "in_progress",
          note: "Options captured; answer applicability still needs review.",
          updatedAt: "2026-10-04T14:15:00Z",
          updatedBy: "private@example.test",
          capture,
          pluginCaptures: [
            {
              kind: "CTI_PLUGIN_PAGE_CHECK",
              notForCourseAudit: true,
              auditId: "audit-a",
              courseId: "course-a",
              itemId: "survey",
              targetUrl: "https://example.test/embed",
              text: "Example visible screen",
              finishedAt: "2026-10-04T14:15:00Z",
              status: "VISIBLE_SCREEN_OBSERVED",
              wholePluginVerified: true,
            },
          ],
        },
      },
      course.id,
    ),
    id: "review-a",
    version: 1,
  };
  const reads = [];
  const store = {
    list: async () => [
      recordSummary(record),
      {
        ...recordSummary(record),
        id: "other-audit",
        data: { ...record.data, auditId: "other" },
      },
      { ...recordSummary(record), id: "other-package", packageId: "other" },
    ],
    get: async (id) => {
      reads.push(id);
      assert.equal(id, record.id);
      return structuredClone(record);
    },
  };
  return { course, report, record, store, reads };
}

test("exports full saved follow-ups for this audit only, preserving original evidence and uncertainty", async () => {
  const f = fixture(),
    before = structuredClone(f.report),
    originalReview = structuredClone(f.record);
  const exported = await prepareOwnerReportExport(
    f.report,
    "audit-a",
    f.course,
    f.store,
  );
  assert.deepEqual(f.reads, ["review-a"]);
  assert.deepEqual(f.report, before);
  assert.deepEqual(f.record, originalReview);
  assert.deepEqual(exported.evidence.result, before.result);
  assert.equal(exported.evidence.report, before.report);
  assert.equal(exported.evidence.ingestionCapabilityStatus, "LATEST_APPLIED");
  assert(exported.text.endsWith(before.report));
  assert.match(
    exported.text,
    /focused item checks: 1 \| plugin-page checks: 1/,
  );
  assert.match(exported.text, /captured type=single-select \| options=4/);
  assert.match(exported.text, /captured type=multiple-select \| options=3/);
  assert.match(exported.text, /Option 4: Hybrid/);
  assert.match(exported.text, /required answer-key coverage: not established/);
  assert.match(exported.text, /answer evidence=NOT_OBSERVED/);
  assert.match(exported.text, /Options captured; answer applicability/);
  assert(!exported.text.includes("private@example.test"));
  const r = exported.followUp.reviews[0];
  assert.equal(r.capture.evaluation.automatedResolution, false);
  assert.equal(r.capture.evaluation.answerCoverageComplete, false);
  assert.equal(r.pluginCaptures[0].wholePluginVerified, false);
  assert.equal(exported.followUp.automatedResolution, false);
});

test("zero follow-ups is explicit and does not imply the original audit is current", async () => {
  const f = fixture();
  f.store.list = async () => [];
  const exported = await prepareOwnerReportExport(
    f.report,
    "audit-a",
    f.course,
    f.store,
  );
  assert.match(exported.text, /NO SAVED FOLLOW-UP EVIDENCE FOR THIS REPORT/);
  assert.match(exported.text, /same saved report that generated its script/);
  assert.equal(exported.followUp.reviews.length, 0);
  assert.deepEqual(f.reads, []);
});

test("failed and changed record reads prevent a misleading complete export", async () => {
  for (const failure of ["permission", "interrupted", "stale", "wrong-scope"]) {
    const f = fixture();
    f.store.get = async () => {
      if (["permission", "interrupted"].includes(failure))
        throw new Error(failure);
      return {
        ...f.record,
        ...(failure === "stale" ? { version: 2 } : { packageId: "other" }),
      };
    };
    await assert.rejects(
      prepareOwnerReportExport(f.report, "audit-a", f.course, f.store),
    );
  }
});

test("mismatched or malformed item evidence is never attributed to this report", async () => {
  for (const mutate of [
    (c) => {
      c.courseId = "other";
    },
    (c) => {
      c.itemId = "other";
    },
    (c) => {
      c.auditId = "other";
    },
    (c) => {
      c.expectations = [null];
    },
    (c) => {
      c.payload.structuredAssessment.questions = {};
    },
  ]) {
    const f = fixture();
    mutate(f.record.data.review.capture);
    await assert.rejects(
      prepareOwnerReportExport(f.report, "audit-a", f.course, f.store),
    );
  }
});

test("cancellation during evidence loading prevents a completed export", async () => {
  const f = fixture(),
    controller = new AbortController();
  f.store.get = async () => {
    controller.abort();
    return f.record;
  };
  await assert.rejects(
    prepareOwnerReportExport(
      f.report,
      "audit-a",
      f.course,
      f.store,
      controller.signal,
    ),
    { name: "AbortError" },
  );
});

test("manual-only reviews and historical checks without an original course URL remain exportable", async () => {
  const f = fixture();
  delete f.report.result.stats;
  let exported = await prepareOwnerReportExport(
    f.report,
    "audit-a",
    f.course,
    f.store,
  );
  assert.match(exported.text, /Course identity comes from the saved check/);
  delete f.record.data.review.capture;
  f.record.data.review.pluginCaptures = [];
  f.record.data.review.status = "checked";
  exported = await prepareOwnerReportExport(
    f.report,
    "audit-a",
    f.course,
    f.store,
  );
  assert.match(exported.text, /Recorded owner outcome: checked/);
  assert.match(exported.text, /No finding is automatically cleared/);
  assert.equal(exported.followUp.reviews.length, 1);
});
