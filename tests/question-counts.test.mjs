import test from "node:test";
import assert from "node:assert/strict";
import {
  questionComparison,
  questionDifference,
  withQuestionFollowUp,
  validateReviewedSourceCounts,
  questionComparisonsText,
} from "../src/domain/question-counts.ts";
import {
  buildOwnerTasks,
  validateOwnerReview,
} from "../src/domain/owner-actions.ts";
import { validateRecord } from "../src/domain/workspace-validation.ts";
import { prepareOwnerReportExport } from "../src/domain/owner-report-export.ts";
import { newRecord, recordSummary } from "../src/domain/workspace-store.ts";
const item = { id: "quiz", type: "Assignment", name: "External quiz" };
const finding = {
  sourceId: "source-a",
  sourceName: "External quiz",
  sourcePath: "Module A",
  courseraId: "quiz",
  checks: {
    links: { expected: ["https://publisher.test/quiz"] },
    destinationReadiness: [
      { code: "EMPTY_ASSESSMENT_EDITOR_OBSERVED", itemId: "quiz" },
    ],
  },
};
function row() {
  return questionComparison(finding, null, item);
}
function reference() {
  return {
    sourceKey: row().sourceKey,
    count: 10,
    basis: "published_list",
    referenceUrl: "https://publisher.test/appendix#quiz",
    checkedAt: "2026-10-04",
    note: "Exact Percentage section, ten numbered question stems; live bank not inspected.",
  };
}

test("external source wrapper is unknown, while exact empty destination is zero; no title-based counts", () => {
  const r = row();
  assert.equal(r.source.count, null);
  assert.equal(r.coursera.count, 0);
  assert.match(questionDifference(r), /source count unverified/);
  assert.deepEqual(r.sourceUrls, ["https://publisher.test/quiz"]);
  const absent = questionComparison({ ...finding, checks: {} }, null, item);
  assert.equal(absent.coursera.count, null);
  assert.equal(
    questionComparison({ ...finding, checks: {} }, null, {
      ...item,
      type: "Reading",
    }),
    null,
  );
});
test("native counts retain declared capture gaps, unknown definition totals and question-pool scope", () => {
  const a = {
    sourceQuestionCount: 10,
    sourceDeclaredQuestionCount: 15,
    sourceDefinitionCoverage: { completenessVerified: false },
    courseraQuestionCount: 6,
    courseraDeclaredQuestionCount: 10,
    courseraCaptureCompleteness: { questionCoverageComplete: false },
  };
  const r = questionComparison(
    { ...finding, checks: { structuredAssessment: a } },
    null,
    item,
  );
  assert.equal(r.source.count, 10);
  assert.equal(r.source.declared, 15);
  assert.equal(r.source.complete, false);
  assert.equal(r.coursera.count, 6);
  assert.equal(r.coursera.complete, false);
  assert.match(questionDifference(r), /4 fewer.*incomplete\/unverified/);
  const pool = questionComparison(
    {
      ...finding,
      checks: {
        structuredAssessment: {
          ...a,
          sourceSelectionPolicy: {
            observed: true,
            selectCount: 5,
            poolSize: 15,
          },
        },
      },
    },
    null,
    item,
  );
  assert.equal(pool.source.selectCount, 5);
  assert.match(questionDifference(pool), /per attempt separately/);
  const missing = questionComparison(
    {
      ...finding,
      checks: {
        structuredAssessment: {
          sourceQuestionCount: 10,
          courseraQuestionCount: 0,
        },
      },
    },
    null,
    item,
  );
  assert.equal(missing.coursera.count, null);
});
test("reviewed references are evidence-qualified, cannot rewrite captures, and flag conflicting scope", () => {
  const original = row(),
    before = structuredClone(original),
    ref = reference();
  const r = withQuestionFollowUp([original], undefined, [ref])[0];
  assert.equal(r.source.count, null);
  assert.equal(r.reference.count, 10);
  assert.match(questionDifference(r), /10 fewer/);
  assert.deepEqual(original, before);
  assert.match(
    questionComparisonsText([{ ...item, questionComparisons: [r] }]),
    /Published question list \(live bank unverified\)/,
  );
  assert.match(
    questionDifference({ ...r, source: { ...r.source, count: 11 } }),
    /reconcile/,
  );
  assert.match(
    questionDifference({ ...r, reference: { ...ref, basis: "per_attempt" } }),
    /separately/,
  );
  assert.throws(
    () =>
      withQuestionFollowUp([original], undefined, [
        { ...ref, sourceKey: "another-source" },
      ]),
    /does not match/,
  );
});
test("malformed, duplicate, credential-bearing or unsafe source references are rejected at record validation", () => {
  for (const changed of [
    { count: -1 },
    { count: null },
    { count: NaN },
    { count: 1.2 },
    { count: "10" },
    { count: 100001 },
    { basis: "automatic" },
    { referenceUrl: "javascript:alert(1)" },
    { referenceUrl: "https://u:p@publisher.test" },
    { checkedAt: "2026-02-30" },
    { note: "guess" },
  ]) {
    const sourceCounts = [{ ...reference(), ...changed }];
    assert.throws(() => validateReviewedSourceCounts(sourceCounts));
    assert.throws(() =>
      validateRecord({
        ...newRecord(
          "item-review",
          "test",
          {
            auditId: "audit-a",
            itemKey: "item:quiz",
            review: { status: "open", note: "", sourceCounts },
          },
          "package-a",
        ),
      }),
    );
  }
  assert.throws(() => validateReviewedSourceCounts([reference(), reference()]));
  assert.doesNotThrow(() =>
    validateOwnerReview({
      status: "open",
      note: "",
      sourceCounts: [{ ...reference(), count: 0 }],
    }),
  );
});
test("focused counts replace old displayed destination evidence without inventing zero or source alignment", () => {
  const r = withQuestionFollowUp(
    [row()],
    {
      editorObserved: true,
      finishedAt: "2026-10-04T00:00:00Z",
      payload: {
        structuredAssessment: {
          questions: [{ id: "1" }, { id: "2" }],
          captureCompleteness: { questionCoverageComplete: true },
        },
      },
    },
    [reference()],
  )[0];
  assert.equal(r.coursera.count, 2);
  assert.equal(r.aligned, null);
  assert.match(questionDifference(r), /8 fewer/);
  for (const capture of [
    { editorObserved: false, payload: {} },
    {
      editorObserved: true,
      payload: { structuredAssessment: { questions: [] } },
    },
  ]) {
    const unresolved = withQuestionFollowUp([row()], capture, [reference()])[0];
    assert.equal(unresolved.coursera.count, null);
    assert.match(questionDifference(unresolved), /no missing-question count/);
  }
});
test("shared carriers do not inherit parent assessment counts; unrelated source mappings remain distinct", () => {
  const f = {
    ...finding,
    checks: {
      structuredAssessment: {
        sourceQuestionCount: 10,
        courseraQuestionCount: 10,
      },
      repackaging: { carriers: [{ id: "child" }] },
    },
  };
  const tasks = buildOwnerTasks({
    ownerView: {
      items: [item, { id: "child", name: "Child", type: "Assignment" }],
    },
    itemResults: [f],
  });
  assert.equal(tasks[1].questionComparisons[0].coursera.count, null);
  assert.match(
    questionDifference(tasks[1].questionComparisons[0]),
    /shared carriers/,
  );
});
test("exports saved source references, scoped comparisons and immutable original audit", async () => {
  const course = { ...newRecord("package", "Course", {}), id: "package-a" };
  const report = {
    packageId: course.id,
    report: "Original report bytes",
    result: { ownerView: { items: [item] }, itemResults: [finding] },
  };
  const review = {
    ...newRecord(
      "item-review",
      "External quiz",
      {
        auditId: "audit-a",
        itemKey: "item:quiz",
        review: { status: "open", note: "", sourceCounts: [reference()] },
      },
      course.id,
    ),
    id: "review-a",
  };
  const store = {
    list: async () => [recordSummary(review)],
    get: async () => structuredClone(review),
  };
  const before = structuredClone(report);
  const exported = await prepareOwnerReportExport(
    report,
    "audit-a",
    course,
    store,
  );
  assert.match(exported.text, /Reviewed source reference: 10/);
  assert.match(exported.text, /10 fewer/);
  assert.equal(
    exported.followUp.questionComparisons[0].questionComparisons[0].coursera
      .count,
    0,
  );
  assert.equal(exported.followUp.reviews[0].sourceCounts.length, 1);
  assert(exported.text.endsWith(report.report));
  assert.deepEqual(report, before);
  review.data.review.sourceCounts[0].sourceKey = "wrong-source";
  await assert.rejects(
    prepareOwnerReportExport(report, "audit-a", course, store),
    /does not match/,
  );
});
