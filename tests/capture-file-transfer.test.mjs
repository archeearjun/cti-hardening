import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  MAX_CAPTURE_TRANSFER_SOURCE_BYTES,
  MAX_CAPTURE_TRANSFER_PART_BYTES,
  prepareCaptureFileTransfer,
  validateCaptureTransferFile,
} from "../src/domain/capture-file-transfer.ts";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mib = 1024 * 1024;

/** Independently restore the downloadable files exactly as their recipient
 * must, checking file envelopes as well as decoded binary payloads. */
async function restore(prepared) {
  const manifestBytes = Buffer.from(await prepared.manifestFile.arrayBuffer());
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(manifest, prepared.manifest);
  assert.equal(manifest.kind, "CTI_CAPTURE_TRANSFER_MANIFEST");
  assert.equal(manifest.notForCourseAudit, true);
  assert.equal(manifest.partCount, prepared.partFiles.length);
  assert.equal(manifest.parts.length, manifest.partCount);
  const chunks = [];
  let offset = 0;
  for (const [index, file] of prepared.partFiles.entries()) {
    const detail = manifest.parts[index];
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(file.name, detail.fileName);
    assert.equal(bytes.length, detail.fileBytes);
    assert(bytes.length <= manifest.maxPartFileBytes);
    assert(bytes.length <= MAX_CAPTURE_TRANSFER_PART_BYTES);
    assert.equal(hash(bytes), detail.fileSha256);
    const part = JSON.parse(bytes);
    assert.equal(part.kind, "CTI_CAPTURE_TRANSFER_PART");
    assert.equal(part.schemaVersion, 1);
    assert.equal(part.notForCourseAudit, true);
    assert.equal(part.transferId, manifest.transferId);
    assert.equal(part.index, index + 1);
    assert.equal(part.index, detail.index);
    assert.equal(part.partCount, manifest.partCount);
    assert.equal(part.offset, offset);
    assert.equal(part.offset, detail.offset);
    assert.equal(part.payloadEncoding, "BASE64");
    const payload = Buffer.from(part.data, "base64");
    assert.equal(payload.length, part.payloadBytes);
    assert.equal(payload.length, detail.payloadBytes);
    assert.equal(hash(payload), detail.payloadSha256);
    assert.equal(part.payloadSha256, detail.payloadSha256);
    chunks.push(payload);
    offset += payload.length;
  }
  const transport = Buffer.concat(chunks);
  assert.equal(transport.length, manifest.transport.bytes);
  assert.equal(hash(transport), manifest.transport.sha256);
  const original =
    manifest.transport.encoding === "GZIP" ? gunzipSync(transport) : transport;
  assert.equal(original.length, manifest.original.bytes);
  assert.equal(hash(original), manifest.original.sha256);
  return original;
}

test("existing large Brightspace JSON compresses losslessly without JSON rewriting or another extraction", async () => {
  const content =
    '\ufeff {\r\n  "originalHtml": "<div hidden>Exact source</div>",\r\n  "media": "' +
    'original bytes: 😀 " spaced " \\ '.repeat(120000) +
    '"\r\n}\r\n';
  const file = new File(
    [content],
    "CTI__BRIGHTSPACE__SOURCE_GROUND_TRUTH.json",
  );
  const phases = [];
  const result = await prepareCaptureFileTransfer(
    file,
    (phase) => phases.push(phase),
    { partFileBytes: 16384, preparedAt: "2026-10-17T10:30:00.000Z" },
  );
  assert.equal(result.manifest.original.fileName, file.name);
  assert.equal(result.manifest.transport.encoding, "GZIP");
  assert.equal(result.manifest.transport.fileName, `${file.name}.gz`);
  assert(result.manifest.transport.bytes < file.size);
  assert.deepEqual(await restore(result), Buffer.from(content));
  assert(phases.some((phase) => /Compressing/.test(phase)));
  assert.equal(result.manifest.preparedAt, "2026-10-17T10:30:00.000Z");
});

test("complete CTI ZIP bytes and media survive actual 24 MiB attachment boundaries", async () => {
  const bytes = Buffer.alloc(25 * mib + 137);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 97 + 11) % 251;
  const ranges = [];
  class FileBackedArchive extends File {
    arrayBuffer() {
      throw Error("Whole-archive reads are prohibited");
    }
    slice(start, end, type) {
      ranges.push([start, end]);
      assert(end - start <= 18 * mib);
      return super.slice(start, end, type);
    }
  }
  const file = new FileBackedArchive(
    [bytes],
    "CTI__COURSERA__FINGERPRINT.cti.zip",
  );
  const result = await prepareCaptureFileTransfer(file);
  assert.equal(result.manifest.transport.encoding, "IDENTITY");
  assert.equal(
    result.manifest.transport.sha256,
    result.manifest.original.sha256,
  );
  assert.equal(result.partFiles.length, 2);
  assert(result.partFiles[0].size > 23 * mib);
  assert(result.partFiles[0].size < 24 * mib);
  assert.deepEqual(await restore(result), bytes);
  assert(ranges.length > 10);
});

test("an existing gzip remains byte-for-byte identical, including its original gzip header", async () => {
  const original = gzipSync(
    Buffer.from('{ "course": "retained", "media": [1,2,3] }\r\n'),
  );
  const file = new File([original], "capture.json.gz");
  const result = await prepareCaptureFileTransfer(file);
  assert.equal(result.manifest.transport.encoding, "IDENTITY");
  assert.equal(result.manifest.transport.fileName, file.name);
  assert.deepEqual(await restore(result), original);
});

test("part order, offsets, binary hashes and filename safety remain explicit with multiple JSON parts", async () => {
  const bytes = Buffer.alloc(18000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const file = new File([bytes], "../Coursera shell 🧭.cti.zip");
  const result = await prepareCaptureFileTransfer(file, () => {}, {
    partFileBytes: 8192,
  });
  assert(result.partFiles.length > 3);
  assert.equal(result.manifest.original.fileName, file.name);
  assert.deepEqual(await restore(result), bytes);
  for (const part of result.partFiles) {
    assert.match(part.name, /^CTI_TRANSFER_[A-Za-z0-9._-]+\.json$/);
    assert(!part.name.includes("/"));
    assert(part.size <= 8192);
  }
  const corrupted = structuredClone(result.manifest);
  corrupted.parts.reverse();
  await assert.rejects(
    restore({
      ...result,
      manifest: corrupted,
      manifestFile: new File([JSON.stringify(corrupted)], "manifest.json"),
    }),
    /Expected values to be strictly equal/,
  );
});

test("files inside existing CTI and chat-transfer size limits do not require a rescan", () => {
  for (const size of [
    95_500_000,
    170_400_000,
    MAX_CAPTURE_TRANSFER_SOURCE_BYTES,
  ])
    assert.doesNotThrow(() =>
      validateCaptureTransferFile({ name: "existing.cti.zip", size }),
    );
  for (const value of [
    { name: "capture.json", size: 0 },
    { name: "capture.json", size: NaN },
    { name: "capture.json", size: MAX_CAPTURE_TRANSFER_SOURCE_BYTES + 1 },
    { name: "capture.exe", size: 100 },
    { name: "bad\u0000.json", size: 100 },
  ])
    assert.throws(() => validateCaptureTransferFile(value));
});

test("missing browser compression falls back to exact original parts, with an explicit explanation", async () => {
  const previous = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const content = '{"raw":"no body removal"}\r\n';
    const result = await prepareCaptureFileTransfer(
      new File([content], "source.json"),
    );
    assert.equal(result.manifest.transport.encoding, "IDENTITY");
    assert.match(
      result.manifest.warnings.join(" "),
      /cannot compress.*split losslessly/,
    );
    assert.deepEqual(await restore(result), Buffer.from(content));
  } finally {
    globalThis.CompressionStream = previous;
  }
});

test("short file reads, cancellation and invalid part bounds never return a seemingly complete transfer", async () => {
  const shortFile = {
    name: "capture.cti.zip",
    size: 100,
    slice: () => new Blob(["short"]),
  };
  await assert.rejects(
    prepareCaptureFileTransfer(shortFile),
    /could not be read completely/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    prepareCaptureFileTransfer(new File(["{}"], "source.json"), () => {}, {
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  for (const partFileBytes of [
    0,
    8191,
    NaN,
    MAX_CAPTURE_TRANSFER_PART_BYTES + 1,
  ])
    await assert.rejects(
      prepareCaptureFileTransfer(new File(["{}"], "source.json"), () => {}, {
        partFileBytes,
      }),
      /Invalid file-sharing part limit/,
    );
});
