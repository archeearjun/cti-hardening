import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  captureReviewShareUrl,
  createCaptureShareReview,
  prepareCaptureShareReview,
  MAX_CAPTURE_SHARE_REVIEW_BYTES,
} from "../src/domain/capture-share-review.ts";

const at = "2026-10-17T09:00:00.000Z";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const text =
    "Original caption, never promoted to course-completeness proof.\n";
  const bytes = Buffer.from(text),
    sha256 = hash(bytes);
  const url = "https://source.example.test/caption.srt?auth=private-value";
  const receipt = {
    requestUrl: url,
    responseUrl: url,
    status: 200,
    observedAt: at,
    bytes: bytes.length,
    sha256,
    complete: true,
  };
  return {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.1.0",
    extractedAt: at,
    orgUnitId: "123",
    course: { name: "Captured source" },
    page: { url: "https://source.example.test/d2l/home/123" },
    contentTree: [
      {
        kind: "TOPIC",
        id: "t1",
        title: "Caption",
        path: ["Module", "Caption"],
        url,
        contentEvidence: {
          status: "CAPTURED",
          url,
          rawBodyRef: sha256,
          bodyReceipt: receipt,
          contentType: "text/srt; charset=utf-8",
          format: "srt",
          charset: "utf-8",
          html: "",
          text,
          textLength: text.length,
          textSha256: sha256,
          projectionTruncated: false,
        },
      },
    ],
    quizzes: [],
    assignments: [],
    discussions: [],
    assetBodies: {
      [sha256]: {
        encoding: "base64",
        base64: bytes.toString("base64"),
        bytes: bytes.length,
        sha256,
      },
    },
    contentAcquisition: {
      version: 1,
      wholeCourseComplete: false,
      assets: [
        {
          url,
          status: "CAPTURED_ORIGINAL",
          originalRef: sha256,
          bytes: bytes.length,
          sha256,
          mediaType: "text/srt",
          receipt,
          sourceBindings: [
            { kind: "TOPIC", id: "t1", path: ["Module", "Caption"] },
          ],
        },
      ],
      gaps: [
        {
          url: "https://media.example.test/video?id=native-video&hmac=PRIVATE&expiry=98765",
          reason: "EXTERNAL_PROVIDER_UNREAD",
          sourceBinding: {
            kind: "TOPIC",
            id: "t1",
            path: ["Module", "Caption"],
          },
        },
      ],
    },
    inventoryEvidence: {
      content: { complete: true },
      quizzes: { complete: true },
      assignments: { complete: true },
      discussionForums: { complete: true },
    },
    summary: {
      topics: 1,
      wholeCourseComplete: true,
      base64: "MUST_NOT_SHARE",
      token: "MUST_NOT_SHARE",
    },
  };
}

test("local original-byte verification precedes a small share projection without changing source content", () => {
  const input = fixture(),
    unchanged = JSON.stringify(input);
  const report = createCaptureShareReview(input, "existing.json", {
    preparedAt: at,
  });
  const output = JSON.stringify(report);
  assert.equal(report.kind, "CTI_CAPTURE_SHARE_REVIEW");
  assert.equal(report.localCheck.status, "PASSED");
  assert.equal(
    report.localCheck.originalIntegrity,
    "VERIFIED_RETAINED_ORIGINALS",
  );
  assert.equal(report.wholeCourseCoverage, "UNVERIFIED");
  assert.equal(report.counts.retainedOriginals, 1);
  assert.equal(report.source.courseId, "123");
  assert.equal(report.items[0].nativeItemId, "t1");
  assert.equal(report.acquisitionGaps[0].nativeItemId, "t1");
  assert.equal(
    report.acquisitionGaps[0].url,
    "https://media.example.test/video?id=native-video",
  );
  assert.equal(report.omissions.originalBodies, "EXCLUDED_FROM_SHARE_REPORT");
  assert.doesNotMatch(output, /private-value|PRIVATE|98765|MUST_NOT_SHARE/);
  assert.doesNotMatch(output, /Original caption,|assetBodies|"base64"/);
  assert.equal(JSON.stringify(input), unchanged);
  assert.match(report.localCheck.meaning, /does not prove source completeness/);
});

test("capture-reported interruption and warnings survive as declared diagnostics without becoming verified completion", () => {
  const input = fixture();
  input.attempt = { status: "PARTIAL" };
  input.captureWarnings = [
    "Capture stopped before all planned reads: request limit",
  ];
  input.exportError = "Local save was not confirmed";
  const report = createCaptureShareReview(input, "partial.json");
  assert.equal(report.source.captureStatus, "PARTIAL");
  assert.ok(
    report.warnings.some((value) =>
      value.includes("Capture-reported warning: Capture stopped"),
    ),
  );
  assert.ok(
    report.warnings.some((value) =>
      value.includes("Capture-reported export error:"),
    ),
  );
  assert.equal(report.wholeCourseCoverage, "UNVERIFIED");
});

test("failed body checks remain visible in shareable diagnostics and cannot produce a passing integrity claim", () => {
  const input = fixture();
  Object.values(input.assetBodies)[0].base64 =
    Buffer.from("Altered content").toString("base64");
  const report = createCaptureShareReview(input, "tampered.json");
  assert.equal(report.localCheck.status, "FAILED");
  assert.equal(report.localCheck.originalIntegrity, "FAILED");
  assert.ok(report.localCheck.errors.length);
  assert.equal(report.counts.retainedOriginalBytes, null);
  assert.equal(report.wholeCourseCoverage, "UNVERIFIED");
  assert.doesNotMatch(JSON.stringify(report), /Altered content/);
});

test("large detail inventories have an explicit byte bound and omission counts, never clipped JSON", () => {
  const input = fixture();
  input.assetBodies = {};
  input.contentAcquisition.assets = [];
  input.contentTree = Array.from({ length: 1200 }, (_, index) => ({
    kind: "TOPIC",
    id: String(index),
    title: "Title " + "long ".repeat(100),
    path: ["Module", "deep ".repeat(100)],
    url: "https://source.example.test/item/" + index,
    contentEvidence: { status: "EXTERNAL_RUNTIME_UNREAD" },
  }));
  input.contentAcquisition.gaps = input.contentTree.map((item) => ({
    url: item.url,
    reason: "UNREAD " + "reason ".repeat(90),
    sourceBinding: { kind: "TOPIC", id: item.id, path: item.path },
  }));
  const report = createCaptureShareReview(input, "large.json");
  const rendered = JSON.stringify(report, null, 2);
  assert.ok(Buffer.byteLength(rendered) <= MAX_CAPTURE_SHARE_REVIEW_BYTES);
  assert.equal(report.items.length + report.omissions.items, 1200);
  assert.equal(
    report.acquisitionGaps.length + report.omissions.acquisitionGaps,
    1200,
  );
  assert.ok(report.omissions.findings > 0);
  assert.ok(report.omissions.textFieldsClipped > 0);
  assert.deepEqual(JSON.parse(rendered), report);
  assert.equal(report.wholeCourseCoverage, "UNVERIFIED");
});

test("share URL projection removes credential parameters while preserving observed native identity parameters", () => {
  assert.equal(
    captureReviewShareUrl(
      "/item?itemId=correct&token=secret#access",
      "https://source.test/course",
    ),
    "https://source.test/item?itemId=correct",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://user:secret@source.test/item",
    "data:text/plain,private",
    "https://source.test/" + "x".repeat(20000),
  ])
    assert.equal(captureReviewShareUrl(url), "");
  const input = fixture();
  input.contentAcquisition.gaps[0].reason =
    "Failed https://source.test/video?id=ok&Signature=SECRET\nAuthorization: Bearer PRIVATE";
  const rendered = JSON.stringify(createCaptureShareReview(input, "test.json"));
  assert.doesNotMatch(rendered, /SECRET|PRIVATE/);
});

test("allowed query keys cannot carry nested signed URLs or access payloads", () => {
  const signed = "https://cdn.test/file.pdf?Signature=PRIVATE_SIGNED_VALUE";
  for (const key of ["fileId", "id", "itemId", "type"]) {
    const url =
      "https://source.test/quickLink.d2l?type=coursefile&" +
      key +
      "=" +
      encodeURIComponent(signed);
    const projected = captureReviewShareUrl(url);
    assert.doesNotMatch(
      projected,
      /PRIVATE_SIGNED_VALUE|cdn\.test|Signature|https%3A/i,
    );
  }
  for (const value of [
    signed,
    "data:text/plain;base64,UFJJVkFURQ==",
    "../private.pdf",
    "//cdn.test/private.pdf",
    "file.pdf?token=PRIVATE",
    "%68%74%74%70%73%3A%2F%2Fcdn.test",
  ]) {
    const projected = captureReviewShareUrl(
      "https://source.test/quickLink.d2l?type=coursefile&fileId=" +
        encodeURIComponent(value),
    );
    assert.equal(new URL(projected).searchParams.has("fileId"), false);
  }
  const legitimate = captureReviewShareUrl(
    "https://source.test/quickLink.d2l?type=coursefile&fileId=" +
      encodeURIComponent("Course Files/Week 1/drawing (original).pdf") +
      "&itemId=native_ID-123",
  );
  assert.equal(new URL(legitimate).searchParams.get("type"), "coursefile");
  assert.equal(
    new URL(legitimate).searchParams.get("fileId"),
    "Course Files/Week 1/drawing (original).pdf",
  );
  assert.equal(new URL(legitimate).searchParams.get("itemId"), "native_ID-123");
  const input = fixture();
  input.contentAcquisition.gaps[0].url =
    "https://source.test/quickLink.d2l?type=coursefile&fileId=" +
    encodeURIComponent(signed);
  const unchanged = JSON.stringify(input);
  assert.doesNotMatch(
    JSON.stringify(createCaptureShareReview(input, "test.json")),
    /PRIVATE_SIGNED_VALUE/,
  );
  assert.equal(JSON.stringify(input), unchanged);
});

test("inline data URLs are removed before diagnostic clipping so original body bytes never enter shared text", () => {
  const input = fixture();
  const body = "UkFXX09SSUdJTkFMX0JPRFlfQlVURVM=";
  const image = "data:image/png;base64," + body;
  input.captureWarnings = [
    "Before " + image + " after",
    "Large data:image/png;base64," + body.repeat(500) + " after",
  ];
  input.contentAcquisition.gaps[0].reason = "Could not read " + image;
  input.contentTree[0].title = "Inline " + image;
  const unchanged = JSON.stringify(input);
  const report = createCaptureShareReview(input, "test.json");
  const rendered = JSON.stringify(report);
  assert.doesNotMatch(
    rendered,
    /UkFXX09SSUdJTkFMX0JPRFlfQlVURVM|data:image|base64,/,
  );
  assert.ok(
    report.warnings.some((warning) =>
      warning.endsWith("Before [inline data omitted] after"),
    ),
  );
  assert.ok(
    report.warnings.some((warning) =>
      warning.endsWith("Large [inline data omitted] after"),
    ),
  );
  assert.equal(JSON.stringify(input), unchanged);
});

test("neither diagnostic reports nor share reports are accepted as full capture input", () => {
  for (const value of [
    {},
    { kind: "CTI_CAPTURE_SHARE_REVIEW" },
    { kind: "FOCUSED_EXTRACTOR_DIAGNOSTIC", fingerprints: [] },
    { fingerprints: [], notForCourseAudit: true },
  ])
    assert.throws(
      () => createCaptureShareReview(value, "report.json"),
      /original full capture|full CTI/,
    );
});

test("existing JSON and gzip captures are read locally with manifest identity, without refetching or changing input", async () => {
  const bytes = Buffer.from(JSON.stringify(fixture())),
    expected = hash(bytes);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("A local share review must not use network access.");
  };
  try {
    for (const [name, body] of [
      ["source.json", bytes],
      ["source.json.gz", gzipSync(bytes)],
    ]) {
      const file = new File([body], name),
        phases = [];
      const report = await prepareCaptureShareReview(file, (phase) =>
        phases.push(phase),
      );
      assert.equal(report.source.jsonSha256, expected);
      assert.equal(report.source.jsonBytes, bytes.length);
      assert.equal(report.source.fileBytes, file.size);
      assert.equal(report.localCheck.status, "PASSED");
      assert.equal(
        report.source.transport,
        name.endsWith("gz") ? "gzip" : undefined,
      );
      assert.match(phases.at(-1), /ready to copy/);
      assert.ok(
        Buffer.byteLength(JSON.stringify(report, null, 2)) <=
          MAX_CAPTURE_SHARE_REVIEW_BYTES,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coursera captures use their maintained local review and retain conservative integrity scope", () => {
  const report = createCaptureShareReview(
    {
      schemaVersion: 34,
      extractor: "CTI Coursera fixture",
      page: {
        title: "Destination",
        url: "https://www.coursera.org/teach/example/course/content/edit",
      },
      fingerprints: [
        {
          id: "native-reading",
          name: "Original Reading",
          type: "Reading",
          path: "Week 1",
          url: "https://www.coursera.org/teach/example/course/content/item/supplement/native-reading?auth=secret",
          payload: {
            textSample:
              "Private course text is not included in this share report.",
            textLength: 61,
          },
        },
      ],
    },
    "coursera.json",
  );
  assert.equal(report.platform, "COURSERA");
  assert.equal(report.localCheck.status, "PASSED");
  assert.equal(report.localCheck.originalIntegrity, "NOT_CHECKED");
  assert.equal(report.wholeCourseCoverage, "UNVERIFIED");
  assert.equal(report.items[0].nativeItemId, "native-reading");
  assert.doesNotMatch(
    JSON.stringify(report),
    /Private course text is not included|auth=secret/,
  );
});
