import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import JSZip from "jszip";
import {
  readBrightspaceCaptureArchive,
  NotBrightspaceCaptureArchiveError,
} from "../src/domain/brightspace-capture-archive.ts";
import {
  attachBrightspaceArchiveFileBlobs,
  assertBrightspaceCaptureIntegrity,
  getBrightspaceOriginalBody,
  getBrightspaceOriginalText,
} from "../src/domain/brightspace-capture-evidence.ts";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const at = "2026-10-17T00:00:00.000Z";
function fixture(
  bytes = Buffer.from("<h1>Original</h1><div role=tabpanel>Second tab</div>"),
  mime = "text/html",
) {
  const sha = hash(bytes),
    url = "https://source.example.test/content/enforced/123/guide.html";
  const receipt = {
    requestUrl: url,
    responseUrl: url,
    status: 200,
    complete: true,
    observedAt: at,
    bytes: bytes.length,
    sha256: sha,
    contentType: mime,
  };
  const textual = mime === "text/html";
  return {
    schemaVersion: 2,
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
        id: "native-topic",
        title: "A source guide",
        url,
        contentEvidence: textual
          ? {
              status: "CAPTURED",
              url,
              rawBodyRef: sha,
              bodyReceipt: receipt,
              contentType: mime,
              format: "html",
              charset: "utf-8",
              html: bytes.toString("utf8"),
              text: "Original\nSecond tab",
              textLength: 19,
              textSha256: hash(Buffer.from("Original\nSecond tab")),
            }
          : {
              status: "CAPTURED_ORIGINAL",
              url,
              originalRef: sha,
              contentType: mime,
              bodyReceipt: receipt,
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
          status: "CAPTURED_ORIGINAL",
          originalRef: sha,
          bytes: bytes.length,
          sha256: sha,
          mediaType: mime,
          receipt,
          sourceBindings: [{ kind: "TOPIC", id: "native-topic" }],
        },
      ],
      gaps: [],
    },
    quizzes: [],
    assignments: [],
    discussions: [],
  };
}
async function pack(capture, files = [], options = {}) {
  const zip = new JSZip();
  zip.file("capture.json.gz", gzipSync(Buffer.from(JSON.stringify(capture))), {
    createFolders: false,
  });
  for (const { path, bytes } of files)
    zip.file(path || "files/" + hash(bytes), bytes, { createFolders: false });
  return zip.generateAsync({
    type: "uint8array",
    compression: options.compression || "STORE",
    streamFiles: options.streamFiles === true,
  });
}
const expand = async (gzip) => new Uint8Array(gunzipSync(gzip));
const read = (bytes, limits) =>
  readBrightspaceCaptureArchive(
    new File([bytes], "source.cti.zip"),
    expand,
    limits,
  );
function entries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    result = [];
  let at = view.getUint32(bytes.length - 6, true);
  for (
    let index = 0;
    index < view.getUint16(bytes.length - 12, true);
    index++
  ) {
    const nameLength = view.getUint16(at + 28, true),
      local = view.getUint32(at + 42, true);
    result.push({
      central: at,
      local,
      path: new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      ),
      body:
        local +
        30 +
        view.getUint16(local + 26, true) +
        view.getUint16(local + 28, true),
    });
    at +=
      46 +
      nameLength +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return result;
}

test("Brightspace archive range reads retain verified immutable Blobs, original JSON and separate transport identity", async () => {
  const bytes = Buffer.alloc(3 * 1024 * 1024, 0x5a),
    capture = fixture(bytes, "application/octet-stream"),
    zipped = await pack(capture, [{ bytes }]),
    allocations = [];
  class BoundedBlob extends Blob {
    async arrayBuffer() {
      allocations.push(this.size);
      assert(this.size <= 1024 * 1024);
      return super.arrayBuffer();
    }
    slice(start, end, type) {
      return new BoundedBlob([super.slice(start, end, type)]);
    }
  }
  class RangeOnlyFile extends File {
    arrayBuffer() {
      throw Error("Never allocate the complete selected archive.");
    }
    slice(start, end, type) {
      return new BoundedBlob([super.slice(start, end, type)]);
    }
  }
  const result = await readBrightspaceCaptureArchive(
    new RangeOnlyFile([zipped], "source.cti.zip"),
    expand,
  );
  assert.equal(hash(result.bytes), hash(Buffer.from(JSON.stringify(capture))));
  assert.equal(result.archiveSha256, hash(zipped));
  assert.equal(result.archiveFiles.length, 1);
  assert.equal(result.originalBodyBytes, bytes.length);
  assert(result.archiveFiles[0].blob instanceof Blob);
  assert(!("bytes" in result.archiveFiles[0]));
  assert.equal(JSON.stringify(result.capture), JSON.stringify(capture));
  assert.equal(
    getBrightspaceOriginalBody(result.capture, hash(bytes)).size,
    bytes.length,
  );
  assert.equal(
    assertBrightspaceCaptureIntegrity(result.capture).wholeCourseComplete,
    false,
  );
  assert(allocations.length > 6);
});

test("bounded text originals preserve literal hidden HTML and require reattachment after structured cloning", async () => {
  const bytes = Buffer.from(
      "<h1>Original</h1><div role=tabpanel>Second tab</div>",
    ),
    capture = fixture(bytes),
    result = await read(await pack(capture, [{ bytes }]));
  assert.equal(
    getBrightspaceOriginalText(result.capture, hash(bytes)),
    bytes.toString(),
  );
  assert.equal(
    assertBrightspaceCaptureIntegrity(result.capture).originalIntegrity,
    "VERIFIED_RETAINED_ORIGINALS",
  );
  const clone = structuredClone(result.capture);
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(clone),
    /independently verified/,
  );
  await attachBrightspaceArchiveFileBlobs(
    clone,
    structuredClone(result.archiveFiles),
  );
  assert.equal(
    getBrightspaceOriginalText(clone, hash(bytes)),
    bytes.toString(),
  );
  clone.contentTree[0].contentEvidence.html += "invented";
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(clone),
    /differs from its original/,
  );
  const mimeClone = structuredClone(result.capture);
  await attachBrightspaceArchiveFileBlobs(mimeClone, result.archiveFiles);
  mimeClone.contentTree[0].contentEvidence.contentType = "image/png";
  mimeClone.contentTree[0].contentEvidence.bodyReceipt.contentType =
    "image/png";
  mimeClone.contentAcquisition.assets[0].mediaType = "image/png";
  mimeClone.contentAcquisition.assets[0].receipt.contentType = "image/png";
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(mimeClone),
    /MIME signature/,
  );
});

test("zero-byte referenced originals, duplicate placements and streaming data descriptors are supported", async () => {
  const bytes = Buffer.alloc(0),
    capture = fixture(bytes, "text/plain"),
    duplicate = structuredClone(capture.contentTree[0]);
  duplicate.id = "second-placement";
  capture.contentTree.push(duplicate);
  capture.contentAcquisition.assets[0].sourceBindings.push({
    kind: "TOPIC",
    id: duplicate.id,
  });
  const result = await read(
    await pack(capture, [{ bytes }], { streamFiles: true }),
  );
  assert.equal(result.originalBodyBytes, 0);
  assert.equal(
    assertBrightspaceCaptureIntegrity(result.capture).counts.retainedOriginals,
    1,
  );
  assert.equal(
    assertBrightspaceCaptureIntegrity(result.capture).counts.topics,
    2,
  );
});

test("a static file beyond the legacy 16 MiB ceiling fits the separate archive class without BASE64 hydration", async () => {
  const bytes = Buffer.alloc(17 * 1024 * 1024, 0x78),
    capture = fixture(bytes, "application/octet-stream"),
    result = await read(await pack(capture, [{ bytes }]));
  assert.equal(result.archiveFiles[0].blob.size, bytes.length);
  assert.equal(
    assertBrightspaceCaptureIntegrity(result.capture).counts
      .retainedOriginalBytes,
    bytes.length,
  );
});

test("native ownership, byte receipts, descriptor identity and MIME signatures remain independent checks", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  for (const alter of [
    (c) => {
      c.contentAcquisition.assets[0].sourceBindings[0].id = "unrelated-item";
    },
    (c) => {
      c.contentTree[0].contentEvidence.bodyReceipt.complete = false;
    },
    (c) => {
      Object.values(c.assetBodies)[0].archivePath = "files/" + "a".repeat(64);
    },
    (c) => {
      Object.values(c.assetBodies)[0].base64 = png.toString("base64");
    },
    (c) => {
      c.contentAcquisition.assets[0].mediaType = "application/pdf";
    },
    (c) => {
      c.contentAcquisition.assets[0].receipt.contentType = "image/png\ninvalid";
    },
  ]) {
    const c = fixture(png, "image/png");
    alter(c);
    await assert.rejects(read(await pack(c, [{ bytes: png }])), /Brightspace/);
  }
  const wrong = Buffer.from("not a PNG"),
    invalid = fixture(wrong, "image/png");
  await assert.rejects(
    read(await pack(invalid, [{ bytes: wrong }])),
    /MIME signature/,
  );
});

test("ZIP traversal, missing or unreferenced originals, CRC and SHA failures never become source evidence", async () => {
  const bytes = Buffer.from("source bytes"),
    capture = fixture(bytes, "application/octet-stream");
  await assert.rejects(read(await pack(capture)), /inventory|absent/);
  await assert.rejects(
    read(await pack(capture, [{ bytes }, { bytes: Buffer.from("extra") }])),
    /unreferenced/,
  );
  await assert.rejects(
    read(await pack(capture, [{ path: "../escape", bytes }])),
    /unsafe/,
  );
  await assert.rejects(
    read(
      await pack(capture, [
        { path: "files/" + hash(bytes), bytes: Buffer.from("altered body") },
      ]),
    ),
    /SHA-256|differs/,
  );
  const zipped = await pack(capture, [{ bytes }]),
    original = entries(zipped).find((entry) => entry.path.startsWith("files/"));
  zipped[original.body] ^= 1;
  await assert.rejects(read(zipped), /CRC32/);
});

test("local and central ZIP identity, ranges, transport bounds and compression are checked", async () => {
  const bytes = Buffer.from("source bytes"),
    capture = fixture(bytes, "application/octet-stream");
  for (const alter of [
    (z, e, v) => {
      z[e.local + 30] ^= 1;
    },
    (z, e, v) => {
      v.setUint32(e.local + 18, bytes.length + 1, true);
    },
    (z, e, v) => {
      v.setUint32(e.central + 42, 0, true);
    },
    (z, e, v) => {
      v.setUint16(e.central + 8, 1, true);
    },
  ]) {
    const zipped = await pack(capture, [{ bytes }]),
      entry = entries(zipped).find((e) => e.path.startsWith("files/"));
    alter(
      zipped,
      entry,
      new DataView(zipped.buffer, zipped.byteOffset, zipped.byteLength),
    );
    await assert.rejects(read(zipped), /Brightspace/);
  }
  await assert.rejects(
    read(await pack(capture, [{ bytes }], { compression: "DEFLATE" })),
    /compressed/,
  );
  const zipped = await pack(capture, [{ bytes }]);
  await assert.rejects(
    read(zipped, { archiveBytes: zipped.length - 1 }),
    /archive bound/,
  );
  await assert.rejects(
    read(zipped, { originalBytes: bytes.length - 1 }),
    /original files/,
  );
  await assert.rejects(read(zipped, { metadataBytes: 8 }), /metadata/);
});

test("only a parsed non-Brightspace manifest produces the typed platform-dispatch signal", async () => {
  const other = await pack({ schemaVersion: 35, fingerprints: [] });
  await assert.rejects(
    read(other),
    (error) =>
      error instanceof NotBrightspaceCaptureArchiveError &&
      error.code === "NOT_BRIGHTSPACE_CAPTURE_ARCHIVE",
  );
  const malformed = fixture();
  malformed.originalBodyTransport.version = 2;
  await assert.rejects(
    read(await pack(malformed)),
    (error) => !(error instanceof NotBrightspaceCaptureArchiveError),
  );
  await assert.rejects(
    read(Buffer.from("not a zip")),
    (error) => !(error instanceof NotBrightspaceCaptureArchiveError),
  );
});

test("archive descriptors alone cannot bypass the original validation or text/file ceilings", async () => {
  const bytes = Buffer.from("source bytes"),
    capture = fixture(bytes, "application/octet-stream");
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(capture),
    /independently verified/,
  );
  const file = {
    path: "files/" + hash(bytes),
    sha256: hash(bytes),
    size: bytes.length,
    blob: new Blob([Buffer.from("tampered")]),
  };
  await assert.rejects(
    attachBrightspaceArchiveFileBlobs(capture, [file]),
    /Blob descriptor|SHA-256/,
  );
  const big = Buffer.alloc(4 * 1024 * 1024 + 1, 0x78),
    largeText = fixture(big, "text/plain");
  await assert.rejects(read(await pack(largeText, [{ bytes: big }])), /4 MiB/);
  const body = Object.values(capture.assetBodies)[0];
  body.bytes = 64 * 1024 * 1024 + 1;
  await assert.rejects(read(await pack(capture)), /descriptor/);
});
