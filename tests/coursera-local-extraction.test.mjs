import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  createAutomaticLocalCourseraCommand,
  createSavedCourseraResumeScript,
  inspectLocalCourseraCapture,
  buildLocalCourseraCaptureReviewSummary,
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

function reviewCapture() {
  const capture = completeCapture();
  capture.meta.extractor = "CTI Direct Course Capture v1.2.0";
  capture.meta.buildId = "v1.2.0-bound-reading-media-20261014";
  capture.meta.directDataCapture = {
    mode: "BOUND_AUTHORING_DRAFT_API",
    acquisitionComplete: true,
    wholeCourseVerified: false,
    sourceStable: true,
    stopReason: "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS",
    limits: {
      exportBytes: 128 * 1024 * 1024,
      mediaBytes: 64 * 1024 * 1024,
      mediaBodyBytes: 16 * 1024 * 1024,
    },
    stats: {
      requests: 17332,
      bytes: 700,
      elapsedMs: 110000,
      currentAttempt: {
        requests: 332,
        bytes: 300,
        elapsedMs: 104000,
        failed: 35,
        byResource: { "assets.v1": 35, "authoringAtoms.v2": 297 },
      },
      inheritedBudget: { requests: 17000, bytes: 400, elapsedMs: 6000 },
      cumulativeBudget: { requests: 17332, bytes: 700, elapsedMs: 110000 },
      stopReason: "COURSE_API_REQUEST_TIMEOUT",
      stopped: true,
      media: {
        requests: 18,
        bytes: 64 * 1024 * 1024 + 1,
        stopReason: "DIRECT_MEDIA_REQUEST_TIMEOUT",
        bodyBudgetExhausted: true,
        limits: { totalBytes: 64 * 1024 * 1024, requestMs: 30000 },
        currentAttempt: {
          requests: 17,
          bytes: 64 * 1024 * 1024,
          elapsedMs: 100000,
          stopReason: "DIRECT_MEDIA_REQUEST_TIMEOUT",
          bodyBudgetExhausted: true,
        },
      },
    },
  };
  capture.fingerprints[0].captureContract = {
    complete: false,
    status: "UNRESOLVED_DIRECT_READING",
    reasons: ["DIRECT_MEDIA_BYTE_LIMIT", "DIRECT_MEDIA_BYTE_LIMIT"],
  };
  capture.fingerprints[0].payload = {
    directDataSources: { atom: {} },
    directDataEvidence: { assetReferenceCount: 2 },
    directAssetEvidence: {
      missingPointers: [{}],
      failures: [{ reason: "DIRECT_MEDIA_BYTE_LIMIT" }],
      assets: [
        {
          assetId: "ABCDEFGHIJKLMNOPQRSTUV",
          reason: "DIRECT_MEDIA_BYTE_LIMIT",
          metadataReceipt: { status: 200 },
          stability: { stable: false },
          body: {
            size: 12345,
            mime: "application/pdf",
            sha256: "a".repeat(64),
            receipt: { status: 200 },
          },
        },
        {
          assetId: "ZYXWVUTSRQPONMLKJIHGFE",
          reason: "DIRECT_ASSET_BODY_ABORTED",
          retainedEvidence: { body: { size: 100 } },
        },
      ],
    },
  };
  return capture;
}

test("capture review copies exact recorded attempt budgets, bounds and grouped media failures without changing evidence", () => {
  const capture = reviewCapture(),
    before = JSON.stringify(capture);
  const summary = buildLocalCourseraCaptureReviewSummary(capture);
  assert.equal(summary.kind, "CTI_COURSERA_CAPTURE_REVIEW_SUMMARY_V1");
  assert.equal(summary.notForCourseAudit, true);
  assert.equal(summary.capture.version, "1.2.0");
  assert.equal(summary.capture.acquisitionComplete, true);
  assert.equal(summary.capture.wholeCourseVerified, false);
  assert.equal(summary.api.currentAttempt.requests, 332);
  assert.deepEqual(summary.api.inheritedBudget, {
    requests: 17000,
    bytes: 400,
    elapsedMs: 6000,
  });
  assert.deepEqual(summary.api.cumulativeBudget, {
    requests: 17332,
    bytes: 700,
    elapsedMs: 110000,
  });
  assert.equal(
    summary.api.recordedSnapshot.stopReason,
    "COURSE_API_REQUEST_TIMEOUT",
  );
  assert.equal(summary.media.currentAttempt.requests, 17);
  assert.deepEqual(summary.media.inheritedBudget, { requests: 1, bytes: 1 });
  assert.equal(summary.media.cumulativeBudget.bytes, 64 * 1024 * 1024 + 1);
  assert.equal(summary.media.limits.totalBytes, 64 * 1024 * 1024);
  assert.equal(summary.media.stopReason, "DIRECT_MEDIA_REQUEST_TIMEOUT");
  assert.equal(summary.media.bodyBudgetExhausted, true);
  assert.deepEqual(summary.media.assetFailureCodes, {
    DIRECT_ASSET_BODY_ABORTED: 1,
    DIRECT_MEDIA_BYTE_LIMIT: 1,
  });
  assert.deepEqual(summary.media.declaredFailureCodes, {
    DIRECT_MEDIA_BYTE_LIMIT: 1,
  });
  assert.deepEqual(summary.failuresByType.Reading.reasons, {
    DIRECT_MEDIA_BYTE_LIMIT: 1,
  });
  assert.equal(summary.media.items[0].assets[0].size, 12345);
  assert.equal(summary.media.items[0].assets[0].mime, "application/pdf");
  assert.equal(summary.media.items[0].assets[0].hashPresent, true);
  assert.equal(summary.media.items[0].assets[1].retainedBodyPresent, true);
  assert.equal(summary.media.bodyBytes, 12345);
  assert.equal(JSON.stringify(capture), before);
  assert.deepEqual(
    inspectLocalCourseraCapture(capture, shell).reviewSummary,
    summary,
  );
  assert.throws(
    () => inspectLocalCourseraCapture(summary),
    /focused diagnostic/,
  );
});

test("capture review excludes native content, credentials, URLs, filenames, arbitrary strings and complete receipts", () => {
  const capture = reviewCapture(),
    forbidden = "PRIVATE_COURSE_CONTENT_SENTINEL";
  capture.page.url = "https://private.invalid/" + forbidden;
  capture.meta.cookies = forbidden;
  capture.fingerprints[0].name = forbidden;
  const payload = capture.fingerprints[0].payload;
  payload.structuredAssessment = {
    questions: [{ prompt: forbidden, correctAnswers: [forbidden] }],
  };
  payload.directDataSources.atom = {
    cookies: forbidden,
    draft: { secret: forbidden },
  };
  const asset = payload.directAssetEvidence.assets[0];
  asset.body.base64 = forbidden;
  asset.body.canonicalUrl = "https://private.invalid/" + forbidden;
  asset.body.receipt.authorization = forbidden;
  asset.metadata = {
    name: forbidden,
    url: "https://private.invalid/" + forbidden,
  };
  asset.metadataReceipt.requestQuery = { token: forbidden };
  capture.meta.directDataCapture.stats.currentAttempt.token = forbidden;
  capture.meta.directDataCapture.stats.currentAttempt.byResource[
    "https://private.invalid/" + forbidden
  ] = 1;
  capture.fingerprints.push({
    id: "https://private.invalid/" + forbidden,
    type: forbidden,
    payload: {
      directAssetEvidence: {
        assets: [
          {
            assetId: forbidden + "?token=x",
            reason: forbidden + "?token=x",
            body: { mime: forbidden + "?token=x", size: forbidden },
          },
        ],
      },
    },
    captureContract: {
      status: "https://private.invalid/" + forbidden,
      reasons: ["https://private.invalid/" + forbidden],
    },
  });
  const summary = buildLocalCourseraCaptureReviewSummary(capture),
    text = JSON.stringify(summary);
  assert.equal(text.includes(forbidden), false);
  for (const key of [
    "base64",
    "correctAnswers",
    "canonicalUrl",
    "requestQuery",
    "authorization",
    "cookies",
    "prompt",
    "token",
  ])
    assert.equal(text.includes('"' + key + '"'), false, key);
  assert.equal(
    summary.coverage.questions,
    1,
    "Only the question count is retained",
  );
  assert.equal(summary.media.items[1].itemId, null);
  assert.equal(summary.media.items[1].assets[0].assetId, null);
  assert.equal(summary.media.items[1].assets[0].mime, null);
  assert.equal(summary.media.items[1].assets[0].size, null);
  assert.deepEqual(summary.failuresByType.Other.statuses, {
    UNRECOGNIZED_CODE: 1,
  });
});

test("capture review does not infer missing recorded counters and bounds media detail without losing totals", () => {
  const capture = reviewCapture();
  capture.meta.directDataCapture.stats = {};
  const item = capture.fingerprints[0];
  capture.fingerprints = Array.from({ length: 600 }, (_, index) => ({
    ...item,
    id: "reading-" + index,
  }));
  const summary = buildLocalCourseraCaptureReviewSummary(capture);
  assert.equal(summary.api.currentAttempt, null);
  assert.deepEqual(summary.api.cumulativeBudget, {
    requests: null,
    bytes: null,
    elapsedMs: null,
  });
  assert.equal(summary.media.bodyBudgetExhausted, null);
  assert.equal(summary.media.itemCount, 600);
  assert.equal(summary.media.items.length, 500);
  assert.equal(summary.media.assetCount, 1200);
  assert.equal(summary.media.bodyCount, 600);
  assert.equal(summary.media.detailTruncated, true);
  assert.equal(summary.media.assetFailureCodes.DIRECT_MEDIA_BYTE_LIMIT, 600);
});

test("ZIP review distinguishes declared body records from original bytes resolved from the selected artifact", () => {
  const capture = reviewCapture(),
    asset = capture.fingerprints[0].payload.directAssetEvidence.assets[0],
    body = asset.body;
  capture.meta.directDataCapture.exportTransport = {
    format: "ZIP_GZIP_JSON_V1",
    originalFilesLimitBytes: 512 * 1024 * 1024,
    archiveLimitBytes: 640 * 1024 * 1024,
    uniqueOriginalFiles: 1,
    uniqueOriginalBytes: body.size,
  };
  body.archivePath = "files/" + body.sha256;
  let summary = buildLocalCourseraCaptureReviewSummary(capture);
  assert.equal(summary.capture.exportTransport.format, "ZIP_GZIP_JSON_V1");
  assert.equal(
    summary.media.bodyCount,
    1,
    "Historical declared body counts remain compatible.",
  );
  assert.equal(summary.media.bodyBytesPresentCount, 0);
  assert.equal(summary.media.items[0].assets[0].bodyBytesPresent, false);
  Object.defineProperty(body, "bytes", {
    value: new Uint8Array(body.size),
    enumerable: false,
    configurable: true,
  });
  summary = buildLocalCourseraCaptureReviewSummary(capture);
  assert.equal(summary.media.bodyBytesPresentCount, 1);
  assert.equal(summary.media.items[0].assets[0].bodyBytesPresent, true);
  assert.equal(summary.media.retainedBodyBytesPresentCount, 0);
  const metadataOnly = JSON.parse(JSON.stringify(capture));
  assert.equal(
    buildLocalCourseraCaptureReviewSummary(metadataOnly).media
      .bodyBytesPresentCount,
    0,
  );
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
