import test from "node:test";
import assert from "node:assert/strict";
import {
  createAutomaticLocalCourseraCommand,
  createSavedCourseraResumeScript,
  inspectLocalCourseraCapture,
} from "../src/domain/coursera-local-extraction.ts";

const courseId = "iu5pMbTVEfG-2xL_w9lGpQ";
const shell =
  "https://www.coursera.org/teach/trde120/" + courseId + "/content/edit";

function completeCapture(id = courseId) {
  return {
    schemaVersion: 35,
    extractedAt: "2026-10-01T00:00:00.000Z",
    page: { courseId: id, title: "Course" },
    meta: {
      extractor: "CTI Item Fidelity Extractor v6.15.33",
      buildId: "v6.15.33-bound-assessment-surface-and-body-resume-20261013",
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
  assert.equal(result.captureMode, "AUTHORING_EDITOR");
  assert.equal(result.verdict.complete, true);
  assert.deepEqual(result.verdict.reasons, []);
});

test("direct draft-API provenance does not imply current editor version or Protocol resumability", () => {
  const capture = completeCapture();
  capture.page.url = shell;
  capture.meta.directDataCapture = { mode: "BOUND_AUTHORING_DRAFT_API" };
  capture.meta.localCaptureBatch = { requiresReload: true, visits: 1 };
  capture.meta.captureAccounting.complete = false;
  capture.fingerprints[0].captureContract.complete = false;
  const result = inspectLocalCourseraCapture(capture, shell);
  assert.equal(result.captureMode, "BOUND_AUTHORING_DRAFT_API");
  assert.equal(result.currentSchema, true);
  assert.equal(
    result.currentVersion,
    false,
    "The editor version string cannot certify the different data acquisition mode",
  );
  assert.equal(result.resumeAvailable, false);
  assert.equal(result.pausedBatch, false);
  assert.equal(result.authoringShellUrl, shell);
  const currentScript = "javascript:(async function ctiCourseraCapture(){})()";
  assert.throws(
    () => createSavedCourseraResumeScript(capture, shell, currentScript),
    /direct draft-API capture cannot resume/,
  );
  assert.throws(
    () =>
      createAutomaticLocalCourseraCommand(
        shell,
        currentScript,
        "test-direct-token",
        capture,
      ),
    /direct draft-API capture cannot resume/,
  );
});

test("non-direct captures retain legacy provenance and resume decisions", () => {
  const capture = completeCapture();
  const result = inspectLocalCourseraCapture(capture, shell);
  assert.equal(result.captureMode, "AUTHORING_EDITOR");
  assert.equal(result.currentVersion, true);
  assert.equal(result.verdict.complete, true);
});

test("missing or malformed direct mode cannot expose legacy Protocol continuation", () => {
  const currentScript = "javascript:(async function ctiCourseraCapture(){})()";
  for (const mode of [
    "missing",
    "misspelled",
    "missingMetadata",
    "statusOnly",
    "methodOnly",
  ]) {
    const capture = completeCapture();
    capture.page.url = shell;
    capture.meta.localCaptureBatch = { requiresReload: true, visits: 1 };
    if (mode === "misspelled")
      capture.meta.directDataCapture = { mode: "BOUND_AUTHORING_DRAT_API" };
    else if (mode === "missing") capture.meta.directDataCapture = {};
    if (mode === "missing" || mode === "missingMetadata")
      capture.fingerprints[0].payload.directDataSources = {};
    if (mode === "statusOnly")
      capture.fingerprints[0].captureContract.status =
        "COMPLETE_BOUND_DRAFT_READING";
    if (mode === "methodOnly")
      capture.fingerprints[0].payload.directDataEvidence = {
        method: "BOUND_AUTHORING_DRAFT_API",
      };
    const inspection = inspectLocalCourseraCapture(capture, shell);
    assert.equal(inspection.captureMode, "BOUND_AUTHORING_DRAFT_API", mode);
    assert.equal(inspection.currentVersion, false, mode);
    assert.equal(inspection.resumeAvailable, false, mode);
    assert.equal(inspection.pausedBatch, false, mode);
    assert.equal(inspection.verdict.complete, false, mode);
    assert(
      inspection.verdict.reasons.includes("DIRECT_DRAFT_CAPTURE_MODE_INVALID"),
      mode,
    );
    assert.throws(
      () => createSavedCourseraResumeScript(capture, shell, currentScript),
      /direct draft-API capture cannot resume/,
      mode,
    );
    assert.throws(
      () =>
        createAutomaticLocalCourseraCommand(
          shell,
          currentScript,
          "test-direct-token",
          capture,
        ),
      /direct draft-API capture cannot resume/,
      mode,
    );
  }
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
