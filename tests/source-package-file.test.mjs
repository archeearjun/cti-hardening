import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MAX_SOURCE_PACKAGE_BYTES,
  MAX_SOURCE_MANIFEST_BYTES,
  SOURCE_PACKAGE_HASH_CHUNK_BYTES,
  validateSourcePackageFile,
  hashSourcePackageFile,
} from "../src/domain/source-package-file.ts";

const mib = 1024 * 1024;

test("the reported 450 MB IMSCC is accepted while file, XML and capture limits stay explicit", () => {
  for (const size of [450_000_000, 450 * mib, MAX_SOURCE_PACKAGE_BYTES])
    assert.doesNotThrow(() =>
      validateSourcePackageFile({ name: "trde130.imscc", size }),
    );
  assert.throws(
    () => validateSourcePackageFile({ name: "trde130.imscc", size: 0 }),
    /trde130\.imscc is empty \(0 bytes\)/,
  );
  assert.throws(
    () =>
      validateSourcePackageFile({
        name: "trde130.imscc",
        size: MAX_SOURCE_PACKAGE_BYTES + 1,
      }),
    /trde130\.imscc is.*640 MiB/,
  );
  assert.throws(
    () => validateSourcePackageFile({ name: "trde130.imscc", size: NaN }),
    /size could not be read/,
  );
  assert.throws(
    () =>
      validateSourcePackageFile({
        name: "imsmanifest.xml",
        size: MAX_SOURCE_MANIFEST_BYTES + 1,
      }),
    /manifest exceeds the 12 MB limit/,
  );
  assert.throws(
    () =>
      validateSourcePackageFile({ name: "capture.cti.zip", size: 450 * mib }),
    /Coursera capture archive.*Evidence inbox/,
  );
});

test("package fingerprint matches original bytes without a whole-file read", async () => {
  const bytes = new Uint8Array(5 * mib + 137);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + 31) % 251;
  const ranges = [];
  class TrackedBlob extends Blob {
    arrayBuffer() {
      throw Error("A whole-archive read must not occur");
    }
    slice(start, end, type) {
      ranges.push([start, end]);
      assert(end - start <= SOURCE_PACKAGE_HASH_CHUNK_BYTES);
      return super.slice(start, end, type);
    }
  }
  const file = new TrackedBlob([bytes]);
  const progress = [];
  const actual = await hashSourcePackageFile(file, (completed, total) =>
    progress.push([completed, total]),
  );
  assert.equal(actual, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(ranges, [
    [0, 2 * mib],
    [2 * mib, 4 * mib],
    [4 * mib, bytes.length],
  ]);
  assert.deepEqual(progress.at(-1), [bytes.length, bytes.length]);
});

test("short and unavailable local file reads do not produce fingerprints", async () => {
  await assert.rejects(
    hashSourcePackageFile({ size: 33, slice: () => new Blob(["short"]) }),
    /not read completely/,
  );
  await assert.rejects(
    hashSourcePackageFile({
      size: 33,
      slice: () => ({
        arrayBuffer: async () => {
          throw Error("File is not downloaded");
        },
      }),
    }),
    /fully downloaded/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    hashSourcePackageFile(new Blob(["not read"]), () =>
      controller.signal.throwIfAborted(),
    ),
    { name: "AbortError" },
  );
});
