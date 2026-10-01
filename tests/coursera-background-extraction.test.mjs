import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCourseraCapture,
  parseCourseraShellUrl,
} from "../src/domain/coursera-background-extraction.ts";

test("Coursera shell URL is normalized and rejects non-Coursera targets", () => {
  const target = parseCourseraShellUrl(
    "https://www.coursera.org/teach/course-name/Abc_def-123/content/item/supplement/x",
  );
  assert.equal(
    target.shellUrl,
    "https://www.coursera.org/teach/course-name/Abc_def-123/content/edit",
  );
  assert.equal(target.courseId, "Abc_def-123");
  assert.throws(() => parseCourseraShellUrl("https://example.com/teach/a/b/content"));
});

test("strict capture cannot be complete without an explicit completeness contract", () => {
  const verdict = evaluateCourseraCapture({
    page: { courseId: "course-123" },
    meta: { baseFingerprintCount: 1 },
    fingerprints: [{ id: "r1", type: "Reading", payload: {} }],
  });
  assert.equal(verdict.complete, false);
  assert.ok(verdict.reasons.includes("EXPLICIT_COMPLETENESS_CONTRACT_MISSING"));
});

test("strict capture passes only when inventory and evidence reconcile", () => {
  const verdict = evaluateCourseraCapture(
    {
      page: { courseId: "course-123" },
      meta: {
        baseFingerprintCount: 2,
        captureAccounting: {
          inventoryCount: 2,
          completeCount: 2,
          unresolvedCount: 0,
          unknownCount: 0,
          unvisitedCount: 0,
          allInventoryAccounted: true,
          noSilentMisses: true,
          complete: true,
          terminalAccountedIncompleteCount: 0,
          externalContentUnverifiedCount: 0,
        },
        activeSpaCrawl: {
          timeBudgetExhausted: false,
          unvisitedTargetIds: [],
          unvisitedDueToBudget: 0,
        },
        wholeRunDeadlineReached: false,
      },
      fingerprints: [
        {
          id: "r1",
          type: "Reading",
          captureContract: { complete: true, status: "COMPLETE_READING" },
          payload: {},
        },
        {
          id: "a1",
          type: "Assignment",
          captureContract: { complete: true, status: "COMPLETE_ASSESSMENT" },
          payload: {
            structuredAssessment: {
              questions: [{}, {}],
              captureCompleteness: {
                declared: 2,
                captured: 2,
                questionCoverageComplete: true,
                requiredAnswerCoverageComplete: true,
              },
            },
          },
        },
      ],
    },
    "course-123",
  );
  assert.equal(verdict.complete, true);
  assert.deepEqual(verdict.reasons, []);
});

test("cross-origin plugin target is accounted but never certified complete", () => {
  const verdict = evaluateCourseraCapture({
    page: { courseId: "course-123" },
    meta: {
      captureAccounting: {
        inventoryCount: 1,
        completeCount: 0,
        unresolvedCount: 1,
        unknownCount: 0,
        unvisitedCount: 0,
        allInventoryAccounted: true,
        noSilentMisses: true,
        complete: false,
        terminalAccountedIncompleteCount: 1,
        externalContentUnverifiedCount: 1,
      },
    },
    fingerprints: [
      {
        id: "p1",
        type: "Plugin",
        captureContract: {
          complete: false,
          status: "ACCOUNTED_EXTERNAL_TARGET_ONLY",
          externalBodyVerified: false,
        },
        payload: {},
      },
    ],
  });
  assert.equal(verdict.complete, false);
  assert.ok(verdict.reasons.includes("PLUGIN_BODY_UNVERIFIED:p1"));
});

test("course identity mismatch blocks certification", () => {
  const verdict = evaluateCourseraCapture(
    {
      page: { courseId: "wrong" },
      meta: {
        captureAccounting: {
          inventoryCount: 1,
          completeCount: 1,
          unresolvedCount: 0,
          unknownCount: 0,
          unvisitedCount: 0,
          allInventoryAccounted: true,
          noSilentMisses: true,
          complete: true,
        },
      },
      fingerprints: [{ id: "r1", type: "Reading", payload: {} }],
    },
    "expected",
  );
  assert.equal(verdict.complete, false);
  assert.match(verdict.reasons.join("\n"), /COURSE_ID_MISMATCH/);
});
