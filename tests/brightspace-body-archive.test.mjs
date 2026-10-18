import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { createBrightspaceBodyStoreV120 } from "../src/extractors/brightspace/body-store.js";
import { createBrightspaceArchiveV120 } from "../src/extractors/brightspace/archive.js";
import { createBrightspaceContentReader } from "../src/extractors/brightspace/content-reader.js";
import { readBrightspaceCaptureArchive } from "../src/domain/brightspace-capture-archive.ts";
import { assertBrightspaceCaptureIntegrity } from "../src/domain/brightspace-capture-evidence.ts";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function storageFixture() {
  const rows = new Map();
  let created = false, failWrites = false;
  function connection() {
    return { objectStoreNames: { contains: () => created }, close() {},
      createObjectStore() { created = true; },
      transaction(_name, mode) {
        const pending = [], tx = { error: null }, changes = new Map(rows);
        queueMicrotask(() => queueMicrotask(() => {
          try {
            for (const job of pending) job();
            if (mode === "readwrite") {
              if (failWrites) throw Error("Synthetic storage quota exhausted");
              rows.clear(); for (const entry of changes) rows.set(...entry);
            }
            tx.oncomplete?.();
          } catch (error) { tx.error = error; tx.onabort?.(); }
        }));
        tx.objectStore = () => ({
          get(key) { const request = {}; pending.push(() => {
            request.result = changes.get(key); request.onsuccess?.();
          }); return request; },
          add(row) { pending.push(() => {
            if (changes.has(row.key)) throw Error("Duplicate immutable key");
            changes.set(row.key, structuredClone(row));
          }); },
        });
        return tx;
      },
    };
  }
  return { rows, failWrites(value) { failWrites = value; },
    indexedDB: { open() {
      const request = {};
      queueMicrotask(() => {
        request.result = connection(); if (!created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    } },
  };
}
const scope = { origin: "https://lms.example.test", courseId: "187960",
  buildId: "v1.2.0-blob-archive-20261017", runId: "synthetic-attempt" };
function store(db, change = {}) {
  return createBrightspaceBodyStoreV120({ ...scope, indexedDB: db.indexedDB, sha256: hash, ...change });
}

test("original Blob storage commits exact hashes before references, survives reopening and isolates courses/attempts", async () => {
  const db = storageFixture(), session = store(db), original = new TextEncoder().encode("Original café 日本語");
  const descriptor = await session.put(original, hash(original));
  assert.deepEqual(descriptor, { encoding: "archive", archivePath: "files/" + hash(original),
    bytes: original.length, sha256: hash(original) });
  assert(!JSON.stringify(descriptor).includes("base64"));
  assert.equal(db.rows.size, 1);
  assert.deepEqual(await session.put(original, hash(original)), descriptor);
  session.close();
  assert.deepEqual(new Uint8Array(await (await store(db).get(descriptor)).arrayBuffer()), original);
  for (const changed of [{ courseId: "999" }, { runId: "another-attempt" }, { origin: "https://other.example.test" }])
    await assert.rejects(store(db, changed).get(descriptor), /MISSING_OR_CHANGED/);
  await assert.rejects(store(db).put(original, "a".repeat(64)), /HASH_MISMATCH/);
  const row = [...db.rows.values()][0]; row.blob = new Blob([new Uint8Array(original.length)]);
  await assert.rejects(store(db).get(descriptor), /MISSING_OR_CHANGED/);
});

test("quota failure leaves no successful original receipt and does not delete prior committed files", async () => {
  const db = storageFixture(), session = store(db), first = Uint8Array.from([1, 2, 3]);
  const original = await session.put(first, hash(first));
  db.failWrites(true);
  const reader = createBrightspaceContentReader({ origin: scope.origin, DOMParser, sha256: hash,
    retainOriginal: (bytes, digest) => session.put(bytes, digest),
    request: async () => new Response(Uint8Array.from([4, 5, 6]), { headers: { "content-type": "image/png" } }),
  });
  const evidence = await reader.readTopic({ id: "123", kind: "TOPIC", url: scope.origin + "/content/new.png", activityType: 1 });
  assert.equal(evidence.status, "UNRESOLVED");
  assert.equal(evidence.reason, "BRIGHTSPACE_BODY_WRITE_FAILED");
  assert.equal(Object.keys(reader.snapshot().assetBodies).length, 0);
  assert.equal(db.rows.size, 1);
  assert.deepEqual(new Uint8Array(await (await session.get(original)).arrayBuffer()), first);
});

test("an original receipt retains the entry bytes when the caller reuses its buffer during asynchronous hashing", async () => {
  const db = storageFixture(), bytes = Uint8Array.from([1, 2, 3]), original = bytes.slice();
  let release, hashing;
  const gate = new Promise((resolve) => { release = resolve; }),
    reachedHash = new Promise((resolve) => { hashing = resolve; }),
    session = store(db, { sha256: async (owned) => { hashing(); await gate; return hash(owned); } });
  const pending = session.put(bytes, hash(original));
  await reachedHash;
  bytes.fill(9); release();
  const descriptor = await pending;
  assert.deepEqual(new Uint8Array(await (await session.get(descriptor)).arrayBuffer()), original);
});

test("archive-backed reading retains a file larger than the legacy16MiB body cap without BASE64 in its checkpoint", async () => {
  const db = storageFixture(), session = store(db), bytes = new Uint8Array(17 * 1024 * 1024).fill(0x5a);
  const reader = createBrightspaceContentReader({ origin: scope.origin, DOMParser, sha256: hash,
    maxAssetBytes: 64 * 1024 * 1024, maxRetainedBytes: 512 * 1024 * 1024,
    maxTotalBytes: 768 * 1024 * 1024, retainOriginal: (body, digest) => session.put(body, digest),
    request: async () => new Response(bytes, { headers: { "content-type": "application/pdf" } }),
  });
  const evidence = await reader.readTopic({ id: "123", kind: "TOPIC", url: scope.origin + "/content/original.pdf", activityType: 1 });
  assert.equal(evidence.status, "CAPTURED_ORIGINAL");
  const snapshot = reader.snapshot();
  assert.equal(snapshot.retainedBytes, bytes.length);
  assert.equal(snapshot.assetBodies[hash(bytes)].encoding, "archive");
  assert(JSON.stringify(snapshot).length < 5000, "The JSON checkpoint must describe, rather than contain, the17MiB original");
  assert.equal((await session.get(snapshot.assetBodies[hash(bytes)])).size, bytes.length);
});

test("ZIP_STORE export round-trips original binary/empty bytes with bounded range reads and one compressed manifest", async () => {
  const original = new Uint8Array(2 * 1024 * 1024 + 137).fill(0x5a), ranges = [],
    empty = new Uint8Array(), metadata = { schemaVersion: 2, extractor: "CTI Brightspace v1.2.0", original: hash(original) };
  class RangeOnlyBlob extends Blob {
    arrayBuffer() { throw Error("Whole original allocation is forbidden during archive assembly"); }
    slice(start, end, type) { ranges.push(end - start); return super.slice(start, end, type); }
  }
  const archive = await createBrightspaceArchiveV120([
    { path: "capture.json.gz", blob: new Blob([gzipSync(JSON.stringify(metadata))]) },
    { path: "files/" + hash(original), blob: new RangeOnlyBlob([original]) },
    { path: "files/" + hash(empty), blob: new Blob([empty]) },
  ]);
  const zip = await JSZip.loadAsync(await archive.arrayBuffer(), { checkCRC32: true });
  assert.deepEqual(Object.keys(zip.files).sort(), ["capture.json.gz", "files/" + hash(original), "files/" + hash(empty)].sort());
  assert.deepEqual(JSON.parse(gunzipSync(await zip.file("capture.json.gz").async("uint8array"))), metadata);
  assert.deepEqual(await zip.file("files/" + hash(original)).async("uint8array"), original);
  assert.equal((await zip.file("files/" + hash(empty)).async("uint8array")).length, 0);
  assert(Math.max(...ranges) <= 1024 * 1024);
});

test("archive bounds reject duplicate/unsafe paths and excessive bodies before reading any body stream", async () => {
  const entry = { path: "capture.json.gz", blob: new Blob([gzipSync("{}")]) },
    original = { path: "files/" + "a".repeat(64), blob: new Blob([Uint8Array.from([1, 2, 3])]) };
  await assert.rejects(createBrightspaceArchiveV120([entry, entry]), /DUPLICATE_PATH/);
  await assert.rejects(createBrightspaceArchiveV120([entry, { ...original, path: "../escape" }]), /PATH_INVALID/);
  await assert.rejects(createBrightspaceArchiveV120([entry, original], { totalBodyBytes: 2 }), /TOTAL_BODY_BYTE_LIMIT/);
  await assert.rejects(createBrightspaceArchiveV120([entry, original], { bodyBytes: 2 }), /BODY_BYTE_LIMIT/);
  await assert.rejects(createBrightspaceArchiveV120([entry], { artifactBytes: 1 }), /ARTIFACT_BYTE_LIMIT/);
  let reads = 0;
  class UnreadableSizedBlob extends Blob {
    constructor(size) { super([]); this.declaredSize = size; }
    get size() { return this.declaredSize; }
    stream() { reads++; throw Error("A rejected source must not be opened"); }
  }
  await assert.rejects(createBrightspaceArchiveV120([entry, {
    ...original, blob: new UnreadableSizedBlob(64 * 1024 * 1024 + 1),
  }]), /BODY_BYTE_LIMIT/);
  const excessiveTotal = Array.from({ length: 9 }, (_, index) => ({
    path: "files/" + (index + 1).toString(16).padStart(64, "0"),
    blob: new UnreadableSizedBlob(index < 8 ? 64 * 1024 * 1024 : 1),
  }));
  await assert.rejects(createBrightspaceArchiveV120([entry, ...excessiveTotal]), /TOTAL_BODY_BYTE_LIMIT/);
  assert.equal(reads, 0);
});

test("the bookmark's IDB original, compact manifest and ZIP writer pass the application's independent archive/native-ownership reader", async () => {
  const db = storageFixture(), session = store(db),
    original = new TextEncoder().encode("%PDF-1.4\nOriginal architectural drawing\n%%EOF\n"),
    descriptor = await session.put(original, hash(original)),
    url = scope.origin + "/content/enforced/187960/drawing.pdf",
    receipt = { requestUrl: url, responseUrl: url, status: 200, complete: true,
      observedAt: "2026-10-17T00:00:00.000Z", bytes: original.length,
      sha256: hash(original), contentType: "application/pdf" },
    capture = {
      schemaVersion: 2, extractor: "CTI Source LMS Ground-Truth Extractor — Brightspace v1.2.0",
      buildId: scope.buildId, page: { url: scope.origin + "/d2l/home/187960", origin: scope.origin },
      course: { orgUnitId: scope.courseId }, attempt: { id: scope.runId },
      originalBodyTransport: { format: "CTI_BRIGHTSPACE_ARCHIVE_V1", version: 1,
        bodyEncoding: "archive", hashAlgorithm: "SHA-256", runId: scope.runId },
      contentTree: [{ kind: "TOPIC", id: "123", title: "Drawing", url,
        contentEvidence: { status: "CAPTURED_ORIGINAL", url, originalRef: descriptor.sha256,
          contentType: "application/pdf", bodyReceipt: receipt } }],
      assetBodies: { [descriptor.sha256]: descriptor }, contentAcquisition: { assets: [] },
    },
    metadata = new TextEncoder().encode(JSON.stringify(capture)),
    archive = await createBrightspaceArchiveV120([
      { path: "capture.json.gz", blob: new Blob([gzipSync(metadata)]) },
      { path: descriptor.archivePath, blob: await session.get(descriptor) },
    ]),
    restored = await readBrightspaceCaptureArchive(new File([archive], "source.cti.zip"),
      async (gzip) => new Uint8Array(gunzipSync(gzip)));
  assert.deepEqual(restored.bytes, metadata);
  assert.equal(restored.originalBodyBytes, original.length);
  assert.equal(restored.archiveSha256, hash(new Uint8Array(await archive.arrayBuffer())));
  assert.equal(restored.archiveFiles.length, 1);
  assert.equal(assertBrightspaceCaptureIntegrity(restored.capture).originalIntegrity, "VERIFIED_RETAINED_ORIGINALS");
  assert.equal(JSON.stringify(restored.capture), JSON.stringify(capture), "Independent attachment cannot rewrite native manifest evidence");
});
