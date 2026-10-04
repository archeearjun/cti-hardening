
import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectLocalCourseraCapture,
} from "../src/domain/coursera-local-extraction.ts";

const courseId = "iu5pMbTVEfG-2xL_w9lGpQ";
const shell =
  "https://www.coursera.org/teach/trde120/" +
  courseId +
  "/content/edit";

function completeCapture(id = courseId) {
  return {
    schemaVersion: 35,
    extractedAt: "2026-10-01T00:00:00.000Z",
    page: { courseId: id, title: "Course" },
    meta: {
      extractor: "CTI Item Fidelity Extractor v6.15.9",
      buildId: "v6.15.9-rendered-choice-labels-20261004",
      baseFingerprintCount: 1,
      captureAccounting: {
        inventoryCount: 1,
        completeCount: 1,
        unresolvedCount: 0,
        unknownCount: 0,
        unvisitedCount: 0,
        externalContentUnverifiedCount: 0,
        terminalAccountedIncompleteCount: 0,
        allInventoryAccounted: true,
        noSilentMisses: true,
        complete: true,
      },
    },
    fingerprints: [
      {
        id: "reading-1",
        type: "Reading",
        name: "Reading",
        payload: {},
        captureContract: {
          complete: true,
          accounted: true,
          retryable: false,
          status: "COMPLETE_READING",
        },
      },
    ],
  };
}

test("local schema 35 capture can pass the same strict completion gate", () => {
  const result = inspectLocalCourseraCapture(completeCapture(), shell);
  assert.equal(result.courseId, courseId);
  assert.equal(result.schemaVersion, 35);
  assert.equal(result.currentSchema, true);
  assert.equal(result.currentVersion, true);
  assert.equal(result.verdict.complete, true);
  assert.deepEqual(result.verdict.reasons, []);
});

test("local capture cannot silently cross course identities", () => {
  const result = inspectLocalCourseraCapture(
    completeCapture("otherCourse_123456"),
    shell,
  );
  assert.equal(result.verdict.complete, false);
  assert(
    result.verdict.reasons.some((reason) =>
      reason.startsWith("COURSE_ID_MISMATCH:"),
    ),
  );
});

test("local capture rejects future schemas and diagnostic artifacts", () => {
  assert.throws(
    () =>
      inspectLocalCourseraCapture(
        { ...completeCapture(), schemaVersion: 36 },
        shell,
      ),
    /supports schemas 1–35/,
  );
  assert.throws(
    () =>
      inspectLocalCourseraCapture(
        { ...completeCapture(), kind: "FOCUSED_EXTRACTOR_DIAGNOSTIC" },
        shell,
      ),
    /focused diagnostic capture/,
  );
});
