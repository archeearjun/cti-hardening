import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCourseraCapture } from "../src/domain/coursera-background-extraction.ts";
import {
  captureContractV6150,
  finalCaptureAccountingV6150,
} from "../src/extractors/coursera/completion.js";
const courseId = "fixture-course-123";
function capture(fp) {
  const fingerprints = [structuredClone(fp)];
  fingerprints[0].captureContract = captureContractV6150(fingerprints[0]);
  const captureAccounting = finalCaptureAccountingV6150(fingerprints, {
    unvisitedTargetIds: [],
  });
  return {
    schemaVersion: 35,
    page: { courseId },
    meta: { captureAccounting },
    fingerprints,
  };
}
function textBlock() {
  return {
    id: "assignment-1",
    type: "Assignment",
    payload: {
      captureAttempts: 1,
      nativeAssignment: {
        contentBlockEvidence: {
          itemId: "assignment-1",
          courseId,
          declaredContentParts: 1,
          observedPartCount: 1,
          observedTextBlockCount: 1,
          otherPartCount: 0,
          completeTextBlockOnly: true,
          blocks: [
            {
              id: "part~textBlock!~one",
              text: "Submit your response through the associated dropbox.",
              truncated: false,
            },
          ],
        },
      },
    },
  };
}
test("extractor-produced text-only assignment remains complete at the site boundary", () => {
  const fp = textBlock();
  assert.equal(
    captureContractV6150(fp).status,
    "COMPLETE_ASSIGNMENT_TEXT_BLOCKS",
  );
  const value = capture(fp);
  assert.equal(value.meta.captureAccounting.complete, true);
  assert.deepEqual(evaluateCourseraCapture(value, courseId).reasons, []);
});
test("a text-only status cannot conceal missing, mixed, truncated or wrong-item block evidence", () => {
  for (const mutate of [
    (b) => (b.blocks = []),
    (b) => (b.otherPartCount = 1),
    (b) => (b.declaredContentParts = 2),
    (b) => (b.blocks[0].truncated = true),
    (b) => (b.itemId = "different-item"),
    (b) => (b.courseId = "different-course"),
  ]) {
    const value = capture(textBlock());
    mutate(value.fingerprints[0].payload.nativeAssignment.contentBlockEvidence);
    assert.equal(evaluateCourseraCapture(value, courseId).complete, false);
  }
});
const reading = {
  id: "reading-1",
  type: "Reading",
  payload: {
    textSample: "A complete reading.",
    textConfidence: "high",
    textEvidenceCompleteness: 1,
    textCaptureTruncated: false,
  },
};
test("strict capture accounting refuses incomplete per-item evidence even when the summary claims complete", () => {
  const value = capture(reading);
  value.fingerprints[0].captureContract = {
    complete: false,
    accounted: true,
    status: "UNRESOLVED_AFTER_MAX_ATTEMPTS",
  };
  value.fingerprints[0].payload.captureContract =
    value.fingerprints[0].captureContract;
  assert.equal(evaluateCourseraCapture(value, courseId).complete, false);
});
test("strict capture accounting refuses duplicate identities, inconsistent counts and malformed counters", () => {
  for (const mutate of [
    (v) => (v.fingerprints[0].id = ""),
    (v) => {
      v.fingerprints.push(structuredClone(v.fingerprints[0]));
      v.meta.captureAccounting.inventoryCount = 2;
      v.meta.captureAccounting.completeCount = 2;
    },
    (v) => (v.meta.captureAccounting.completeCount = 0),
    (v) => (v.meta.captureAccounting.unresolvedCount = -1),
    (v) => (v.meta.captureAccounting.unknownCount = null),
    (v) => (v.meta.captureAccounting.inventoryCount = "1"),
    (v) => {
      delete v.fingerprints[0].captureContract;
      delete v.fingerprints[0].payload.captureContract;
    },
    (v) => (v.fingerprints[0].captureContract.itemId = "wrong-item"),
    (v) => (v.fingerprints[0].payload.captureContract = { complete: false, status: "UNRESOLVED" }),
  ]) {
    const value = capture(reading);
    mutate(value);
    assert.equal(evaluateCourseraCapture(value, courseId).complete, false);
  }
});

test("capturing an observed ingestion failure does not require inventing question evidence", () => {
  const value = capture({ id: "failed-quiz", type: "Assignment", payload: { ingestionFailure: { detected: true } } });
  assert.equal(evaluateCourseraCapture(value, courseId).complete, true);
  assert.equal(value.fingerprints[0].captureContract.status, "INGESTION_FAILURE_CAPTURED");
  value.fingerprints[0].payload.ingestionFailure.detected = false;
  assert.equal(evaluateCourseraCapture(value, courseId).complete, false);
});
