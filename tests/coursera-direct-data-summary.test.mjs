import test from "node:test";
import assert from "node:assert/strict";
import {
  directDataAttemptMetricsV1,
  directDataCoverageSummaryV1,
} from "../src/extractors/coursera/direct-data-summary.js";

test("verified empty drafts, instructions and unkeyed reflections stay distinct from keyed questions", () => {
  const summary = directDataCoverageSummaryV1([
    {type: "Assignment", processed: true, questions: 0, contract: {complete: true, status: "COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT"}},
    {type: "Assignment", processed: true, questions: 0, contract: {complete: true, status: "COMPLETE_BOUND_DRAFT_INSTRUCTION_ASSESSMENT"}},
    {type: "Assignment", processed: true, questions: 2, contract: {complete: true, status: "COMPLETE_BOUND_DRAFT_REFLECTION_ASSESSMENT"}},
    {type: "Assignment", processed: true, questions: 0, contract: {complete: false, status: "COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT"}},
  ]);
  assert.deepEqual(summary.assessmentKinds, {emptyDrafts: 1, instructionOnly: 1, unkeyedReflections: 1});
  assert.equal(summary.assessments.verified, 3);
  assert.equal(summary.questions, 2);
  assert.equal(summary.structures.total, 0);
});

test("coverage separates a complete question bank from reading media and empty structures", () => {
  const items = [
    ...Array.from({ length: 20 }, () => ({
      type: "Unknown",
      processed: true,
      contract: { status: "COMPLETE_EMPTY_STRUCTURE", complete: true },
    })),
    ...Array.from({ length: 34 }, (_, index) => ({
      type: "Assignment",
      processed: true,
      contract: { complete: true },
      questions: index < 30 ? 100 : index === 30 ? 398 : index === 31 ? 609 : 0,
    })),
    ...Array.from({ length: 123 }, (_, index) => ({
      type: "Reading",
      processed: true,
      contract: { complete: index < 25 },
      assetReferenceCount: index < 25 ? 0 : 1,
      assetReferenceIds: index < 25 ? [] : ["media-" + (index % 49)],
      missingPointerCount: index > 119 ? 1 : 0,
    })),
    ...Array.from({ length: 6 }, () => ({
      type: "Plugin",
      processed: true,
      contract: { complete: false },
    })),
    ...Array.from({ length: 2 }, () => ({
      type: "Discussion",
      processed: true,
      contract: { complete: true },
    })),
  ];
  const summary = directDataCoverageSummaryV1(items);
  assert.deepEqual(summary.inventory, { total: 185, read: 185, verified: 81 });
  assert.deepEqual(summary.content, { total: 165, read: 165, verified: 61 });
  assert.deepEqual(summary.assessments, { total: 34, read: 34, verified: 34 });
  assert.equal(summary.questions, 4007);
  assert.deepEqual(summary.readings, { total: 123, read: 123, verified: 25 });
  assert.deepEqual(summary.readingMedia, {
    items: 98,
    references: 98,
    uniqueReferences: 49,
  });
  assert.deepEqual(summary.missingPointers, { items: 3, references: 3 });
  assert.deepEqual(summary.widgets, { total: 6, read: 6, verified: 0, configurations: 0 });
  assert.deepEqual(summary.structures, { total: 20, read: 20, verified: 20 });
  assert.deepEqual(summary.discussions, { total: 2, read: 2, verified: 2 });
});

test("unknown content and unvisited records cannot be presented as empty or acquired", () => {
  const summary = directDataCoverageSummaryV1([
    {
      type: "Unknown",
      processed: false,
      contract: { status: "UNVISITED_DIRECT_ITEM", complete: false },
    },
    {
      type: "Unknown",
      structural: true,
      processed: true,
      contract: { complete: false },
    },
  ]);
  assert.deepEqual(summary.inventory, { total: 2, read: 1, verified: 0 });
  assert.deepEqual(summary.content, { total: 1, read: 0, verified: 0 });
  assert.deepEqual(summary.structures, { total: 1, read: 1, verified: 0 });
  assert.throws(() => directDataCoverageSummaryV1([null]), /ITEM_INVALID/);
  assert.throws(() => directDataCoverageSummaryV1({}), /INPUT_INVALID/);
});

test("captured widget settings do not increase verified content or widget body counts", () => {
  const summary = directDataCoverageSummaryV1([
    { type: "Plugin", processed: true, contract: { complete: false, sourceConfigurationVerified: true } },
    { type: "Plugin", processed: true, contract: { complete: false, sourceConfigurationVerified: false } },
  ]);
  assert.deepEqual(summary.widgets, { total: 2, read: 2, verified: 0, configurations: 1 });
  assert.equal(summary.inventory.verified, 0);
  assert.equal(summary.content.verified, 0);
});

test("resumed metrics preserve spent limits while showing the ten-minute attempt separately", () => {
  const snapshot = {
    requests: 5707,
    bytes: 7617607,
    elapsedMs: 596790,
    completed: 5707,
    failed: 0,
    maxConcurrentRequests: 4,
    byResource: { groups: 4608, definitions: 601, other: 498 },
  };
  const base = { requests: 10562, bytes: 21770372, elapsedMs: 1946811 };
  const metrics = directDataAttemptMetricsV1(snapshot, base);
  assert.deepEqual(metrics.cumulativeBudget, {
    requests: 16269,
    bytes: 29387979,
    elapsedMs: 2543601,
  });
  assert.deepEqual(metrics.inheritedBudget, base);
  assert.equal(metrics.currentAttempt.elapsedMs, 596790);
  assert.equal(metrics.currentAttempt.requests, 5707);
  assert.equal(
    metrics.requests,
    16269,
    "The original budget counter is retained",
  );
  assert.equal(metrics.completed, 5707, "Completion belongs to this attempt");
  assert.equal(metrics.statScopes.requests, "CUMULATIVE_RUN");
  assert.equal(metrics.statScopes.completed, "CURRENT_ATTEMPT");
  assert.equal(metrics.statScopes.byResource, "CURRENT_ATTEMPT");
  metrics.currentAttempt.byResource.groups = 0;
  assert.equal(snapshot.byResource.groups, 4608);
  assert.equal(metrics.byResource.groups, 4608);
});

test("the first attempt has zero inherited work and never displays non-finite metrics", () => {
  const metrics = directDataAttemptMetricsV1({
    requests: 3,
    elapsedMs: NaN,
    bytes: -1,
    byResource: { material: 3, invalid: -1 },
  });
  assert.deepEqual(metrics.inheritedBudget, {
    requests: 0,
    bytes: 0,
    elapsedMs: 0,
  });
  assert.deepEqual(metrics.cumulativeBudget, {
    requests: 3,
    bytes: 0,
    elapsedMs: 0,
  });
  assert.deepEqual(metrics.byResource, { material: 3 });
});

test("additional published-item draft definitions stay separate from primary question and verification counts", () => {
  const summary = directDataCoverageSummaryV1([
    { type: "Assignment", processed: true, questions: 3, contract: { complete: true } },
    { type: "Assignment", processed: true, questions: 0, contract: { complete: false },
      retainedDraftSnapshot: true, retainedDraftDefinitionCount: 11, retainedDraftHistoricalObservations: 1 },
    { type: "Assignment", processed: true, questions: 0, contract: { complete: false },
      retainedDraftSnapshot: true, retainedDraftDefinitionCount: 9 },
  ]);
  assert.deepEqual(summary.retainedDraftSnapshots, { items: 2, definitions: 20, historicalObservations: 1 });
  assert.equal(summary.questions, 3);
  assert.equal(summary.assessments.verified, 1);
  assert.equal(summary.content.verified, 1);
  assert.equal(summary.content.total, 3);
});
