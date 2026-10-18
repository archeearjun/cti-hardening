import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  classifyBrightspaceReferenceV110,
  createBrightspaceContentReader,
} from "../src/extractors/brightspace/content-reader.js";
import { createBrightspaceArchiveV120 } from "../src/extractors/brightspace/archive.js";
import { readBrightspaceCaptureArchive } from "../src/domain/brightspace-capture-archive.ts";
import {
  assertBrightspaceCaptureIntegrity,
  getBrightspaceOriginalBody,
} from "../src/domain/brightspace-capture-evidence.ts";

const origin = "https://lms.example.test",
  courseId = "187959";
const path =
  "/content/enforced/187959-CCE-187959-DEV/Content/Original%20Drawing.dwg";
const url = origin + path;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function dwg(header = "AC1032") {
  const bytes = new Uint8Array(256);
  bytes.set(new TextEncoder().encode(header));
  bytes[128] = 0xff;
  return bytes;
}
function response(bytes, changes = {}) {
  const { finalUrl, status = 200, ...headers } = changes;
  const result = new Response(bytes, {
    status,
    headers: {
      "content-type": "image/vnd.dwg",
      "content-length": String(bytes.length),
      ...headers,
    },
  });
  if (finalUrl)
    Object.defineProperties(result, {
      url: { value: finalUrl },
      redirected: { value: finalUrl !== url },
    });
  return result;
}
function reader(request, options = {}) {
  return createBrightspaceContentReader({
    origin,
    courseId,
    sha256: hash,
    request,
    ...options,
  });
}
function captureFor(evidence, snapshot) {
  const { assetBodies, ...contentAcquisition } = snapshot;
  return {
    schemaVersion: 2,
    page: { url: origin + "/d2l/home/" + courseId },
    course: { orgUnitId: courseId },
    contentTree: [
      {
        kind: "TOPIC",
        id: "123",
        url,
        activityType: 1,
        contentEvidence: evidence,
      },
    ],
    assetBodies,
    contentAcquisition,
  };
}

test("DWG eligibility is restricted to the native static container of the explicitly selected course", () => {
  for (const target of [
    path,
    path.replace(".dwg", ".DWG"),
    path.replace(".dwg", "%2Edwg"),
  ])
    assert.equal(
      classifyBrightspaceReferenceV110(target, origin, origin, courseId).fetch,
      true,
      target,
    );
  for (const target of [
    "https://other.example.test" + path,
    "https://user:secret@lms.example.test" + path,
    path.replace("187959-CCE", "999-CCE"),
    path.replace(".dwg", ".dxf"),
    "/content/shared.dwg",
    "/login/drawing.dwg",
    "/d2l/api/le/1.88/187959/drawing.dwg",
    path.replace("Content/", "Content%2F"),
    path.replace("Drawing", "Drawing%5csecret"),
    path.replace("Content/", "%61uth/"),
    path.replace("Drawing", "%252e%252e%252fDrawing"),
    "/d2l/common/dialogs/quickLink.d2l?ou=187959&type=coursefile&fileId=drawing.dwg",
  ])
    assert.equal(
      classifyBrightspaceReferenceV110(target, origin, origin, courseId).fetch,
      false,
      target,
    );
  assert.equal(
    classifyBrightspaceReferenceV110(path, origin, origin).fetch,
    false,
  );
});

test("bounded original DWG bytes, HTTP MIME and ownership round-trip through the independent archive importer", async () => {
  const original = dwg(),
    originals = new Map();
  const collector = reader(
    async (_url, init) => {
      assert.equal(init.mode, "same-origin");
      assert.equal(init.credentials, "same-origin");
      return response(original, { "content-type": "application/octet-stream" });
    },
    {
      retainOriginal: async (bytes, sha256) => {
        originals.set(sha256, new Blob([bytes]));
        return {
          encoding: "archive",
          archivePath: "files/" + sha256,
          sha256,
          bytes: bytes.length,
        };
      },
    },
  );
  const evidence = await collector.readTopic({
    kind: "TOPIC",
    id: "123",
    url,
    activityType: 1,
  });
  assert.equal(evidence.status, "CAPTURED_ORIGINAL");
  assert.equal(evidence.contentType, "application/octet-stream");
  assert.equal(evidence.bodyReceipt.declaredBodyBytes, original.length);
  assert.equal(evidence.originalRef, hash(original));
  assert.equal(evidence.text, undefined);
  assert.equal(evidence.html, undefined);
  const capture = captureFor(evidence, collector.snapshot());
  capture.originalBodyTransport = {
    format: "CTI_BRIGHTSPACE_ARCHIVE_V1",
    version: 1,
    bodyEncoding: "archive",
    hashAlgorithm: "SHA-256",
  };
  const metadata = JSON.stringify(capture);
  const archive = await createBrightspaceArchiveV120([
    { path: "capture.json.gz", blob: new Blob([gzipSync(metadata)]) },
    { path: "files/" + hash(original), blob: originals.get(hash(original)) },
  ]);
  const restored = await readBrightspaceCaptureArchive(
    new File([archive], "source.cti.zip"),
    async (bytes) => new Uint8Array(gunzipSync(bytes)),
  );
  assert.equal(JSON.stringify(restored.capture), metadata);
  assert.equal(
    assertBrightspaceCaptureIntegrity(restored.capture).originalIntegrity,
    "VERIFIED_RETAINED_ORIGINALS",
  );
  assert.equal(
    assertBrightspaceCaptureIntegrity(restored.capture).wholeCourseComplete,
    false,
  );
  assert.deepEqual(
    new Uint8Array(
      await getBrightspaceOriginalBody(
        restored.capture,
        hash(original),
      ).arrayBuffer(),
    ),
    original,
  );
});

test("DWG authentication/error bodies, unsupported headers, ranges, wrong redirects and byte limits retain gaps without originals", async () => {
  const cases = [
    {
      bytes: new TextEncoder().encode("<html><input type=password></html>"),
      headers: { "content-type": "text/html" },
    },
    {
      bytes: new TextEncoder().encode("Unauthorized"),
      headers: { "content-type": "text/plain" },
    },
    { bytes: dwg("AC9999") },
    { bytes: dwg().subarray(0, 127) },
    { bytes: dwg(), headers: { "content-length": "" } },
    { bytes: dwg(), headers: { "content-length": "257" } },
    { bytes: dwg(), headers: { "content-range": "bytes 0-255/1024" } },
    { bytes: dwg(), headers: { "content-encoding": "gzip" } },
    {
      bytes: dwg(),
      headers: { finalUrl: origin + path.replace("187959-CCE", "999-CCE") },
    },
    {
      bytes: dwg(),
      headers: { finalUrl: "https://other.example.test" + path },
    },
  ];
  for (const { bytes, headers } of cases) {
    const collector = reader(async () => response(bytes, headers));
    const evidence = await collector.readTopic({
      id: "123",
      url,
      activityType: 1,
    });
    assert.equal(evidence.status, "UNRESOLVED");
    assert.equal(Object.keys(collector.snapshot().assetBodies).length, 0);
    assert(collector.snapshot().gaps.length > 0);
  }
  const collector = reader(async () => response(dwg()), { maxAssetBytes: 128 });
  assert.equal(
    (await collector.readTopic({ id: "123", url, activityType: 1 })).reason,
    "BODY_LIMIT_EXCEEDED",
  );
  assert.equal(Object.keys(collector.snapshot().assetBodies).length, 0);
});

test("a different static file cannot acquire a DWG through a redirect outside the DWG reader scope", async () => {
  const requested = url.replace(".dwg", ".pdf"),
    collector = reader(async () => response(dwg(), { finalUrl: url })),
    evidence = await collector.readTopic({
      id: "123",
      url: requested,
      activityType: 1,
    });
  assert.equal(evidence.status, "UNRESOLVED");
  assert.equal(evidence.reason, "DWG_ORIGINAL_RESPONSE_UNSUPPORTED");
  assert.equal(Object.keys(collector.snapshot().assetBodies).length, 0);
  const capture = captureFor(evidence, collector.snapshot());
  capture.contentTree[0].url = requested;
  assert.equal(
    assertBrightspaceCaptureIntegrity(capture).originalIntegrity,
    "NO_ORIGINAL_BODIES",
  );
});

test("import independently rejects forged DWG scope, framing and file signatures while historical uncollected references remain gaps", async () => {
  const collector = reader(async () => response(dwg()));
  const evidence = await collector.readTopic({
    id: "123",
    url,
    activityType: 1,
  });
  const capture = captureFor(evidence, collector.snapshot());
  assert.equal(
    assertBrightspaceCaptureIntegrity(capture).originalIntegrity,
    "VERIFIED_RETAINED_ORIGINALS",
  );
  for (const change of [
    (value) => {
      value.course.orgUnitId = "999";
    },
    (value) => {
      value.contentTree[0].contentEvidence.bodyReceipt.declaredBodyBytes--;
    },
    (value) => {
      value.contentTree[0].contentEvidence.bodyReceipt.contentType =
        "text/html";
    },
    (value) => {
      value.contentTree[0].contentEvidence.bodyReceipt.contentRange =
        "bytes 0-255/1024";
    },
    (value) => {
      value.contentTree[0].contentEvidence.bodyReceipt.contentEncoding = "gzip";
    },
    (value) => {
      value.contentAcquisition.assets[0].sourceBindings[0].id = "999";
    },
  ]) {
    const forged = structuredClone(capture);
    change(forged);
    assert.throws(
      () => assertBrightspaceCaptureIntegrity(forged),
      /DWG|native source/,
    );
  }
  const corrupt = structuredClone(capture),
    originalRef = evidence.originalRef,
    bytes = dwg("AC9999"),
    ref = hash(bytes);
  corrupt.assetBodies = {
    [ref]: {
      ...corrupt.assetBodies[originalRef],
      sha256: ref,
      base64: Buffer.from(bytes).toString("base64"),
    },
  };
  corrupt.contentTree[0].contentEvidence.originalRef = ref;
  corrupt.contentTree[0].contentEvidence.bodyReceipt.sha256 = ref;
  corrupt.contentAcquisition.assets[0].originalRef = ref;
  corrupt.contentAcquisition.assets[0].sha256 = ref;
  corrupt.contentAcquisition.assets[0].receipt.sha256 = ref;
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(corrupt),
    /DWG original bytes/,
  );
  const historical = captureFor(
      { status: "NOT_FETCHED", url, reason: "NO_SUPPORTED_STATIC_RESOURCE" },
      {
        assetBodies: {},
        assets: [],
        gaps: [
          {
            url,
            reason: "NO_SUPPORTED_STATIC_RESOURCE",
            sourceBinding: { kind: "TOPIC", id: "123" },
          },
        ],
      },
    ),
    before = JSON.stringify(historical);
  const result = assertBrightspaceCaptureIntegrity(historical);
  assert.equal(result.originalIntegrity, "NO_ORIGINAL_BODIES");
  assert.equal(result.wholeCourseComplete, false);
  assert(
    result.findings.some((finding) =>
      JSON.stringify(finding).includes("NO_SUPPORTED_STATIC_RESOURCE"),
    ),
  );
  assert.equal(JSON.stringify(historical), before);
});
