import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
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
  assert.equal(result.directSummary, null);
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

test("old resumed direct captures separate current read timestamps from cumulative time", () => {
  const capture = completeCapture();
  capture.page.url = shell;
  capture.extractedAt = "2026-10-14T12:30:46.441Z";
  capture.meta.directDataCapture = {
    mode: "BOUND_AUTHORING_DRAFT_API",
    resumed: true,
    acquisitionComplete: true,
    wholeCourseVerified: false,
    materialsReceipt: {
      resource: "materials",
      id: courseId,
      observedAt: "2026-10-14T12:20:49.424Z",
    },
    courseReceipt: {
      resource: "course",
      id: courseId,
      observedAt: "2026-10-14T12:20:49.425Z",
    },
    finalMaterialsReceipt: {
      resource: "materials",
      id: courseId,
      observedAt: "2026-10-14T12:30:45.654Z",
    },
    stats: {
      requests: 16269,
      elapsedMs: 2543601,
      byResource: { groups: 4608, definitions: 601, other: 498 },
    },
  };
  capture.fingerprints[0].payload.directDataSources = {
    atom: {},
    receipts: {
      atom: {
        resource: "atom",
        id: "reading-1",
        observedAt: "2026-10-14T12:20:50.000Z",
      },
    },
  };
  capture.fingerprints[0].payload.assessmentApiEvidence = {
    receipts: [
      {
        resource: "definition",
        id: "retained-definition",
        observedAt: "2026-10-14T10:51:43.308Z",
      },
    ],
  };
  const result = inspectLocalCourseraCapture(capture, shell);
  assert.equal(result.verdict.complete, false);
  assert.equal(result.directSummary.timingSource, "RECEIPT_SPAN");
  assert.deepEqual(result.directSummary.currentAttempt, {
    requests: 5707,
    elapsedMs: 596230,
  });
  assert.deepEqual(result.directSummary.cumulativeBudget, {
    requests: 16269,
    elapsedMs: 2543601,
  });
  assert.equal(result.directSummary.inheritedBudget.requests, 10562);
});

test("new direct captures use their explicitly scoped attempt metrics", () => {
  const capture = completeCapture();
  capture.meta.directDataCapture = {
    mode: "BOUND_AUTHORING_DRAFT_API",
    stats: {
      requests: 16269,
      elapsedMs: 2543601,
      currentAttempt: { requests: 5707, elapsedMs: 596790 },
      inheritedBudget: { requests: 10562, elapsedMs: 1946811 },
      cumulativeBudget: { requests: 16269, elapsedMs: 2543601 },
    },
  };
  const summary = inspectLocalCourseraCapture(capture, shell).directSummary;
  assert.equal(summary.timingSource, "RECORDED_ATTEMPT");
  assert.deepEqual(summary.currentAttempt, {
    requests: 5707,
    elapsedMs: 596790,
  });
  assert.deepEqual(summary.inheritedBudget, {
    requests: 10562,
    elapsedMs: 1946811,
  });
});

test("missing attempt timestamps do not relabel cumulative time as a fresh run", () => {
  const capture = completeCapture();
  capture.meta.directDataCapture = {
    mode: "BOUND_AUTHORING_DRAFT_API",
    stats: { requests: 16269, elapsedMs: 2543601 },
  };
  const summary = inspectLocalCourseraCapture(capture, shell).directSummary;
  assert.equal(summary.timingSource, "UNAVAILABLE");
  assert.deepEqual(summary.currentAttempt, { requests: null, elapsedMs: null });
  assert.deepEqual(summary.cumulativeBudget, {
    requests: 16269,
    elapsedMs: 2543601,
  });
});

test("a reading-media continuation labels retained assessments and separates body requests from authoring API reads", () => {
  const capture = completeCapture();
  capture.page.url = shell;
  capture.fingerprints[0].type = "Assignment";
  capture.fingerprints[0].payload = {
    structuredAssessment: { questions: [{ id: "q1" }, { id: "q2" }] },
    directDataSources: {
      atom: {},
      receipts: {
        atom: { observedAt: "2026-10-14T12:20:50.000Z" },
      },
    },
  };
  capture.meta.directDataCapture = {
    mode: "BOUND_AUTHORING_DRAFT_API",
    mediaEnrichment: {
      scope: "REFERENCED_READING_MEDIA_ONLY",
      baseAcquisitionComplete: true,
      baseSourceCapturedAt: "2026-10-14T12:30:45.654Z",
      retainedAssessmentObservations: true,
    },
    stats: {
      requests: 16669,
      elapsedMs: 2843601,
      currentAttempt: { requests: 400, elapsedMs: 300000 },
      inheritedBudget: { requests: 16269, elapsedMs: 2543601 },
      media: {
        requests: 120,
        bytes: 7340032,
        currentAttempt: { requests: 98, bytes: 5242880 },
      },
    },
  };
  const original = JSON.stringify(capture);
  const result = inspectLocalCourseraCapture(capture, shell);
  assert.deepEqual(result.directSummary.mediaContinuation, {
    retainedAssessmentObservations: true,
    baseSourceCapturedAt: "2026-10-14T12:30:45.654Z",
  });
  assert.equal(result.directSummary.currentAttempt.requests, 400);
  assert.deepEqual(result.directSummary.media, {
    currentAttempt: { requests: 98, bytes: 5242880 },
    cumulativeBudget: { requests: 120, bytes: 7340032 },
  });
  assert.equal(result.directSummary.coverage.questions, 2);
  assert.equal(result.directSummary.coverage.assessments.total, 1);
  assert.equal(
    result.verdict.complete,
    false,
    "Presentation does not replace the fidelity gate",
  );
  assert.equal(
    JSON.stringify(capture),
    original,
    "Original assessment receipts and raw observations remain unchanged",
  );
});

test("an unrecognized continuation scope cannot imply assessments were retained", () => {
  const capture = completeCapture();
  capture.meta.directDataCapture = {
    mode: "BOUND_AUTHORING_DRAFT_API",
    mediaEnrichment: {
      scope: "READING_MEDIA_AND_QUESTIONS",
      retainedAssessmentObservations: true,
    },
  };
  assert.equal(
    inspectLocalCourseraCapture(capture, shell).directSummary.mediaContinuation,
    null,
  );
});

const metricsFixture = process.env.CTI_COURSERA_DIRECT_METRICS_FIXTURE;
test(
  "private full capture exposes assessment success and old/new attempt times without changing its fidelity verdict",
  { skip: !metricsFixture },
  () => {
    const bytes = readFileSync(metricsFixture),
      decoded =
        bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes,
      capture = JSON.parse(decoded),
      inspection = inspectLocalCourseraCapture(capture),
      summary = inspection.directSummary;
    assert.equal(inspection.verdict.complete, false);
    assert.equal(inspection.verdict.noSilentMisses, true);
    assert.equal(inspection.verdict.unresolvedCount, 104);
    assert.equal(inspection.verdict.unvisitedCount, 0);
    assert.deepEqual(summary.coverage.inventory, {
      total: 185,
      read: 185,
      verified: 81,
    });
    assert.deepEqual(summary.coverage.content, {
      total: 165,
      read: 165,
      verified: 61,
    });
    assert.deepEqual(summary.coverage.assessments, {
      total: 34,
      read: 34,
      verified: 34,
    });
    assert.equal(summary.coverage.questions, 4007);
    assert.equal(summary.coverage.readingMedia.items, 98);
    assert.equal(summary.coverage.widgets.total, 6);
    assert.equal(summary.currentAttempt.requests, 5707);
    assert.equal(summary.currentAttempt.elapsedMs, 596230);
    assert.equal(summary.cumulativeBudget.requests, 16269);
    assert.equal(summary.cumulativeBudget.elapsedMs, 2543601);
    assert.equal(summary.mediaContinuation, null);
    assert.equal(summary.media, null);
  },
);
