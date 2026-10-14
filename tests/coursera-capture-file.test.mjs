import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  MAX_COURSERA_CAPTURE_JSON_BYTES,
  MAX_COURSERA_COMPRESSED_CAPTURE_BYTES,
  isCompressedCourseraCaptureFile,
  readCourseraCaptureFileBytes,
  readCourseraCaptureFileJson,
} from "../src/domain/coursera-capture-file.ts";
import {
  readLocalCourseraCaptureFile,
  inspectLocalCourseraCapture,
} from "../src/domain/coursera-local-extraction.ts";

const capture = {
  schemaVersion: 35,
  page: { courseId: "course-test", title: "Unicode: 日本語 🎓" },
  meta: { directDataCapture: { mode: "BOUND_AUTHORING_DRAFT_API" } },
  fingerprints: [],
};
const source = Buffer.from(JSON.stringify(capture));
const compressed = gzipSync(source);
const file = (bytes, name = "capture.json.gz") => new File([bytes], name);

test("gzip delivery preserves every original JSON byte and both transport identities", async () => {
  const decoded = await readCourseraCaptureFileBytes(file(compressed));
  assert.deepEqual(Buffer.from(decoded.bytes), source);
  assert.deepEqual(decoded.transport, {
    encoding: "gzip",
    name: "capture.json.gz",
    bytes: compressed.byteLength,
    sha256: createHash("sha256").update(compressed).digest("hex"),
    expandedBytes: source.byteLength,
  });
  assert.deepEqual(
    await readCourseraCaptureFileJson(file(compressed)),
    capture,
  );
  assert.deepEqual(
    await readLocalCourseraCaptureFile(file(compressed)),
    capture,
  );
  assert.deepEqual(
    inspectLocalCourseraCapture(
      await readLocalCourseraCaptureFile(file(compressed)),
    ).verdict,
    inspectLocalCourseraCapture(capture).verdict,
    "Compression cannot turn incomplete source evidence into complete capture claims",
  );
});

test("plain JSON remains byte-exact, accepts captures above the old 40 MiB ceiling, and does not infer gzip", async () => {
  const decoded = await readCourseraCaptureFileBytes(
    file(source, "legacy.json"),
  );
  assert.deepEqual(Buffer.from(decoded.bytes), source);
  assert.equal(decoded.transport, undefined);
  const large = new File(
    ['{"padding":"', "x".repeat(40 * 1024 * 1024), '"}'],
    "large.json",
  );
  assert(large.size > 40 * 1024 * 1024);
  assert.equal(
    (await readCourseraCaptureFileBytes(large)).bytes.length,
    large.size,
  );
  assert.equal(isCompressedCourseraCaptureFile("course.JSON.GZ"), true);
  for (const name of ["archive.gz", "course.json.gz.zip", "course.json"])
    assert.equal(isCompressedCourseraCaptureFile(name), false, name);
  await assert.rejects(
    readCourseraCaptureFileJson(file(compressed, "misnamed.json")),
    /valid UTF-8 JSON/,
  );
});

test("gzip headers, truncation, checksum corruption, and trailing garbage are rejected", async () => {
  await assert.rejects(
    readCourseraCaptureFileBytes(file(source)),
    /not a gzip file/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(file(compressed.subarray(0, -4))),
    /truncated or damaged/,
  );
  const corrupt = Buffer.from(compressed);
  corrupt[corrupt.length - 8] ^= 0x80;
  await assert.rejects(
    readCourseraCaptureFileBytes(file(corrupt)),
    /truncated or damaged/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(
      file(Buffer.concat([compressed, Buffer.from("garbage")])),
    ),
    /truncated or damaged/,
  );
});

test("physical and expanded limits reject compression bombs before returning JSON bytes", async () => {
  assert.equal(MAX_COURSERA_CAPTURE_JSON_BYTES, 128 * 1024 * 1024);
  assert.equal(MAX_COURSERA_COMPRESSED_CAPTURE_BYTES, 32 * 1024 * 1024);
  await assert.rejects(
    readCourseraCaptureFileBytes(file(compressed), {
      compressedBytes: compressed.length - 1,
    }),
    /32 MiB file limit/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(file(source, "large.json"), {
      expandedBytes: source.length - 1,
    }),
    /128 MiB JSON limit/,
  );
  const bomb = gzipSync(Buffer.alloc(1024 * 1024, 120));
  assert(bomb.length < 2048);
  await assert.rejects(
    readCourseraCaptureFileBytes(file(bomb), { expandedBytes: 32 * 1024 }),
    /expanded Coursera capture exceeds/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(file(Buffer.alloc(0))),
    /empty/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(file(compressed), { compressedBytes: NaN }),
    /Invalid.*limit/,
  );
});

test("gzip cannot hide non-JSON or invalid UTF-8 content", async () => {
  for (const bytes of [
    Buffer.from("not JSON"),
    Buffer.from([0x22, 0xff, 0x22]),
  ])
    await assert.rejects(
      readCourseraCaptureFileJson(file(gzipSync(bytes))),
      /valid UTF-8 JSON/,
    );
});

test("unsupported decompression reports the browser capability instead of parsing compressed bytes", async () => {
  const native = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;
    await assert.rejects(
      readCourseraCaptureFileBytes(file(compressed)),
      /cannot open gzip captures/,
    );
    assert.deepEqual(
      Buffer.from(
        (await readCourseraCaptureFileBytes(file(source, "plain.json"))).bytes,
      ),
      source,
    );
  } finally {
    globalThis.DecompressionStream = native;
  }
});

const privateFixture = process.env.CTI_COURSERA_DIRECT_CAPTURE_FIXTURE;
test(
  "private real capture replay remains byte-exact through gzip without dropping raw source models",
  { skip: !privateFixture },
  async () => {
    const actual = fs.readFileSync(privateFixture);
    const packed = gzipSync(actual);
    const decoded = await readCourseraCaptureFileBytes(
      file(packed, "actual.json.gz"),
    );
    assert.equal(
      createHash("sha256").update(decoded.bytes).digest("hex"),
      createHash("sha256").update(actual).digest("hex"),
    );
    const original = JSON.parse(actual),
      replay = JSON.parse(new TextDecoder().decode(decoded.bytes));
    assert.equal(replay.fingerprints.length, original.fingerprints.length);
    assert.equal(
      replay.meta.directDataCapture.stopReason,
      original.meta.directDataCapture.stopReason,
    );
    assert.equal(
      replay.fingerprints.reduce(
        (sum, item) =>
          sum +
          (item.payload?.assessmentApiEvidence?.questionDefinitions?.length ||
            0),
        0,
      ),
      original.fingerprints.reduce(
        (sum, item) =>
          sum +
          (item.payload?.assessmentApiEvidence?.questionDefinitions?.length ||
            0),
        0,
      ),
    );
  },
);
