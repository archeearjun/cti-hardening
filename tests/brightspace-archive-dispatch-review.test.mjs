import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  readBrightspaceCaptureArchive,
  NotBrightspaceCaptureArchiveError,
} from "../src/domain/brightspace-capture-archive.ts";
import {
  attachBrightspaceArchiveFileBlobs,
  assertBrightspaceCaptureIntegrity,
} from "../src/domain/brightspace-capture-evidence.ts";
import { readCaptureFileBytes } from "../src/domain/capture-file.ts";
import { createDirectDataArchiveV1 } from "../src/extractors/coursera/direct-data-archive.js";
import { directPanoptoFixture } from "./coursera-direct-panopto-fixtures.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function archive(capture, bodies = []) {
  return new File(
    [
      await createDirectDataArchiveV1([
        {
          path: "capture.json.gz",
          blob: new Blob([gzipSync(Buffer.from(JSON.stringify(capture)))]),
        },
        ...bodies,
      ]),
    ],
    "review.cti.zip",
  );
}
const read = (file) =>
  readBrightspaceCaptureArchive(
    file,
    async (gzip) => new Uint8Array(gunzipSync(gzip)),
  );
function fixture() {
  const bytes = Buffer.from("<p>Retained original HTML.</p>"),
    sha = hash(bytes),
    url = "https://source.example.test/content/enforced/123/guide.html";
  const receipt = {
    requestUrl: url,
    responseUrl: url,
    status: 200,
    complete: true,
    observedAt: "2026-10-17T00:00:00.000Z",
    bytes: bytes.length,
    sha256: sha,
    contentType: "text/html",
  };
  return {
    capture: {
      schemaVersion: 2,
      extractor: "CTI Brightspace v1.2.0",
      page: { url: "https://source.example.test/d2l/home/123" },
      originalBodyTransport: {
        format: "CTI_BRIGHTSPACE_ARCHIVE_V1",
        version: 1,
        bodyEncoding: "archive",
        hashAlgorithm: "SHA-256",
      },
      contentTree: [
        {
          kind: "TOPIC",
          id: "topic",
          title: "Guide",
          url,
          contentEvidence: {
            status: "CAPTURED",
            format: "html",
            charset: "utf-8",
            rawBodyRef: sha,
            bodyReceipt: structuredClone(receipt),
            html: bytes.toString(),
            text: "Retained original HTML.",
            textLength: "Retained original HTML.".length,
            textSha256: hash("Retained original HTML."),
          },
        },
      ],
      assetBodies: {
        [sha]: {
          encoding: "archive",
          archivePath: "files/" + sha,
          bytes: bytes.length,
          sha256: sha,
        },
      },
      contentAcquisition: {
        assets: [
          {
            url,
            originalRef: sha,
            bytes: bytes.length,
            sha256: sha,
            receipt: structuredClone(receipt),
            sourceBindings: [{ kind: "TOPIC", id: "topic" }],
          },
        ],
        gaps: [],
      },
    },
    files: [
      {
        path: "files/" + sha,
        sha256: sha,
        size: bytes.length,
        blob: new Blob([bytes]),
      },
    ],
  };
}

test("generic intake preserves native Coursera Panopto originals exceeding the Brightspace 64 MiB class", async () => {
  const bytes = Buffer.alloc(64 * 1024 * 1024 + 1);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftypmp42", 4, "ascii");
  const f = directPanoptoFixture(),
    sha = hash(bytes),
    body = {
      ...f.body,
      archivePath: "files/" + sha,
      sha256: sha,
      size: bytes.length,
      receipt: {
        ...f.body.receipt,
        bytes: bytes.length,
        sha256: sha,
        bodyFormat: "ORIGINAL_BINARY_BYTES_ARCHIVE",
        role: "PODCAST_STREAM_RENDITION",
      },
    };
  delete body.base64;
  f.delivery.podcasts[0].body = body;
  f.capture.meta.directDataCapture.exportTransport = {
    format: "ZIP_GZIP_JSON_V1",
  };
  const selected = await archive(f.capture, [
    {
      path: body.archivePath,
      blob: new Blob([bytes]),
      kind: "PANOPTO_PODCAST_RENDITION",
    },
  ]);
  const imported = await readCaptureFileBytes(selected);
  assert.equal(imported.brightspaceArchiveFiles, undefined);
  assert.equal(imported.archiveFiles.length, 1);
  assert.equal(imported.archiveFiles[0].kind, "PANOPTO_PODCAST_RENDITION");
  assert.equal(imported.archiveFiles[0].size, bytes.length);
  assert.equal(imported.archiveFiles[0].sha256, sha);
});

test("malformed or conflicting Brightspace markers never authorize a Coursera fallback", async () => {
  for (const capture of [
    null,
    [],
    {},
    { extractor: "CTI Brightspace", fingerprints: [] },
    { extractor: "CTI Coursera", platform: "BRIGHTSPACE", fingerprints: [] },
    {
      originalBodyTransport: { format: "CTI_BRIGHTSPACE_ARCHIVE_V2" },
      fingerprints: [],
    },
    { assetBodies: {}, fingerprints: [] },
    { contentTree: null, fingerprints: [] },
  ]) {
    await assert.rejects(
      read(await archive(capture)),
      (error) => !(error instanceof NotBrightspaceCaptureArchiveError),
    );
  }
  await assert.rejects(
    read(await archive({ fingerprints: [] })),
    (error) => error instanceof NotBrightspaceCaptureArchiveError,
  );
});

test("a prior successful Blob attachment cannot hide mutations to receipts, native ownership, text or MIME", async () => {
  for (const mutate of [
    (c) => {
      Object.values(c.assetBodies)[0].archivePath = "files/" + "a".repeat(64);
    },
    (c) => {
      Object.values(c.assetBodies)[0].bytes++;
    },
    (c) => {
      c.contentTree[0].contentEvidence.bodyReceipt.bytes++;
    },
    (c) => {
      c.contentTree[0].contentEvidence.bodyReceipt.responseUrl =
        "https://foreign.example.test/guide.html";
    },
    (c) => {
      c.contentTree[0].contentEvidence.html += "<p>Invented</p>";
    },
    (c) => {
      c.contentAcquisition.assets[0].sourceBindings[0].id = "different-topic";
    },
    (c) => {
      c.contentAcquisition.assets[0].receipt.contentType = "image/png";
    },
    (c) => {
      c.originalBodyTransport.version = 2;
    },
  ]) {
    const { capture, files } = fixture();
    await attachBrightspaceArchiveFileBlobs(capture, files);
    mutate(capture);
    assert.throws(
      () => assertBrightspaceCaptureIntegrity(capture),
      /Brightspace/,
    );
  }
});
