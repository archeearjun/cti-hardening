import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import JSZip from "jszip";
import { createDirectDataArchiveV1 } from "../src/extractors/coursera/direct-data-archive.js";

const checks = [];
async function check(name, fn) { await fn(); checks.push(name); }
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = (value = { schemaVersion: 35, fingerprints: [] }) => ({
  path: "capture.json.gz", blob: new Blob([gzipSync(Buffer.from(JSON.stringify(value)))], { type: "application/gzip" }),
});
const file = (bytes) => ({ path: "files/" + sha(bytes), blob: new Blob([bytes]) });

await check("standard ZIP_STORE, UTF-8 flags, original body CRCs, and gzip manifest round trip", async () => {
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 1]);
  const attachment = Buffer.from("%PDF-1.4\nOriginal café 日本語\n%%EOF\n");
  const source = { schemaVersion: 35, fingerprints: [{ id: "image", body: file(image).path }, { id: "pdf", body: file(attachment).path }] };
  const entries = [manifest(source), file(image), file(attachment)], archive = await createDirectDataArchiveV1(entries);
  assert.equal(archive.type, "application/zip");
  const bytes = Buffer.from(await archive.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  assert.deepEqual(Object.keys(zip.files).sort(), entries.map((entry) => entry.path).sort());
  assert.deepEqual(JSON.parse(gunzipSync(await zip.file("capture.json.gz").async("nodebuffer")).toString()), source);
  assert.deepEqual(await zip.file(file(image).path).async("nodebuffer"), image);
  assert.deepEqual(await zip.file(file(attachment).path).async("nodebuffer"), attachment);
  for (const entry of entries) assert.equal(zip.file(entry.path)._data.compression.magic, "\x00\x00");
  const local = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(local.getUint32(0, true), 0x04034b50);
  assert.equal(local.getUint16(6, true), 0x0800);
  const end = bytes.byteLength - 22, centralOffset = local.getUint32(end + 16, true);
  assert.equal(local.getUint32(end, true), 0x06054b50);
  assert.equal(local.getUint16(end + 8, true), entries.length);
  assert.equal(local.getUint32(centralOffset, true), 0x02014b50);
  assert.equal(local.getUint16(centralOffset + 8, true), 0x0800);
  assert.equal(centralOffset + local.getUint32(end + 12, true), end);
  const second = await createDirectDataArchiveV1(entries);
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), bytes, "Header dates and offsets are deterministic");
});

await check("manifest references can share one SHA-named body without duplicate ZIP entries", async () => {
  const bytes = Buffer.from("one retained original"), body = file(bytes);
  const source = { assets: [{ path: body.path }, { path: body.path }] };
  const archive = await createDirectDataArchiveV1([manifest(source), body]);
  const zip = await JSZip.loadAsync(await archive.arrayBuffer(), { checkCRC32: true });
  assert.equal(Object.keys(zip.files).length, 2);
  assert.deepEqual(await zip.file(body.path).async("nodebuffer"), bytes);
  await assert.rejects(createDirectDataArchiveV1([manifest(source), body, body]), /DIRECT_ARCHIVE_DUPLICATE_PATH/);
});

await check("CRC streams mixed chunks sequentially without requesting a whole-body array buffer", async () => {
  const events = [], originals = [Buffer.from("\x00\xffcafé 日本語"), Buffer.from("another original")];
  class ChunkedBlob extends Blob {
    constructor(bytes, label) { super([bytes]); this.bytes = bytes; this.label = label; }
    arrayBuffer() { throw Error("Full original arrayBuffer is forbidden"); }
    slice(start, end) { return new ChunkedBlob(this.bytes.subarray(start, end), this.label); }
    stream() {
      events.push("start:" + this.label);
      const bytes = this.bytes, label = this.label;
      const split = [bytes.subarray(0, 1), bytes.subarray(1, 2), new Uint8Array(), bytes.subarray(2)];
      return new ReadableStream({ pull(controller) {
        const next = split.shift();
        if (next !== undefined) controller.enqueue(next);
        else { events.push("end:" + label); controller.close(); }
      } });
    }
  }
  const entries = [manifest(), ...originals.map((bytes, index) => ({ path: file(bytes).path, blob: new ChunkedBlob(bytes, index) }))];
  const archive = await createDirectDataArchiveV1(entries);
  assert.deepEqual(events, ["start:0", "end:0", "start:1", "end:1"]);
  const zip = await JSZip.loadAsync(await archive.arrayBuffer(), { checkCRC32: true });
  for (const bytes of originals) assert.deepEqual(await zip.file(file(bytes).path).async("nodebuffer"), bytes);
});

await check("empty manifests and bodies cannot be mistaken for captured originals", async () => {
  await assert.rejects(createDirectDataArchiveV1([{path:"capture.json.gz",blob:new Blob([])}]), /DIRECT_ARCHIVE_ENTRY_INVALID/);
  await assert.rejects(createDirectDataArchiveV1([manifest(), file(Buffer.alloc(0))]), /DIRECT_ARCHIVE_ENTRY_INVALID/);
});

await check("paths, duplicates, missing manifest, non-Blob values and accessors fail before reading", async () => {
  for (const path of ["../capture.json.gz", "files/../capture.json.gz", "/capture.json.gz", "capture.json", "https://private.example/file",
    "files/" + "A".repeat(64), "files/" + "a".repeat(64) + "/extra", "files\\" + "a".repeat(64), "capture.json.gz\0"]) {
    await assert.rejects(createDirectDataArchiveV1([manifest(), { path, blob: new Blob(["x"]) }]), /DIRECT_ARCHIVE_PATH_INVALID/);
  }
  await assert.rejects(createDirectDataArchiveV1([]), /DIRECT_ARCHIVE_ENTRY_LIMIT/);
  await assert.rejects(createDirectDataArchiveV1([file(Buffer.from("x"))]), /DIRECT_ARCHIVE_MANIFEST_MISSING/);
  await assert.rejects(createDirectDataArchiveV1([manifest(), manifest()]), /DIRECT_ARCHIVE_DUPLICATE_PATH/);
  await assert.rejects(createDirectDataArchiveV1([{ path: "capture.json.gz", blob: { size: 1, stream() {} } }]), /DIRECT_ARCHIVE_ENTRY_INVALID/);
  let invoked = false;
  const accessor = { blob: new Blob(["x"]), get path() { invoked = true; return "capture.json.gz"; } };
  await assert.rejects(createDirectDataArchiveV1([accessor]), /DIRECT_ARCHIVE_ENTRY_INVALID/);
  assert.equal(invoked, false);
});

await check("metadata, individual body, cumulative body and artifact bounds include ZIP overhead", async () => {
  const data = file(Buffer.from("12345")), metadata = manifest();
  await assert.rejects(createDirectDataArchiveV1([metadata], { metadataBytes: metadata.blob.size - 1 }), /DIRECT_ARCHIVE_METADATA_BYTE_LIMIT/);
  await assert.rejects(createDirectDataArchiveV1([metadata, data], { bodyBytes: 4 }), /DIRECT_ARCHIVE_BODY_BYTE_LIMIT/);
  await assert.rejects(createDirectDataArchiveV1([metadata, data, file(Buffer.from("67890"))], { totalBodyBytes: 9 }), /DIRECT_ARCHIVE_TOTAL_BODY_BYTE_LIMIT/);
  await assert.rejects(createDirectDataArchiveV1([metadata, data], { entries: 1 }), /DIRECT_ARCHIVE_ENTRY_LIMIT/);
  const archive = await createDirectDataArchiveV1([metadata, data]);
  await assert.rejects(createDirectDataArchiveV1([metadata, data], { artifactBytes: archive.size - 1 }), /DIRECT_ARCHIVE_ARTIFACT_BYTE_LIMIT/);
  assert.equal((await createDirectDataArchiveV1([metadata, data], { artifactBytes: archive.size })).size, archive.size);
});

await check("caller overrides cannot increase the hard 16/128/512/640 MiB or entry bounds", async () => {
  class SizedBlob extends Blob { constructor(size) { super([]); this.declaredSize = size; } get size() { return this.declaredSize; } }
  const mib = 1024 * 1024, huge = Number.MAX_SAFE_INTEGER;
  await assert.rejects(createDirectDataArchiveV1([{ path: "capture.json.gz", blob: new SizedBlob(128 * mib + 1) }], { metadataBytes: huge }), /DIRECT_ARCHIVE_METADATA_BYTE_LIMIT/);
  await assert.rejects(createDirectDataArchiveV1([manifest(), { path: "files/" + "a".repeat(64), blob: new SizedBlob(16 * mib + 1) }], { bodyBytes: huge }), /DIRECT_ARCHIVE_BODY_BYTE_LIMIT/);
  const bodies = Array.from({ length: 33 }, (_, index) => ({ path: "files/" + index.toString(16).padStart(64, "0"), blob: new SizedBlob(16 * mib) }));
  await assert.rejects(createDirectDataArchiveV1([manifest(), ...bodies], { totalBodyBytes: huge, artifactBytes: huge }), /DIRECT_ARCHIVE_TOTAL_BODY_BYTE_LIMIT/);
  await assert.rejects(createDirectDataArchiveV1([{ path: "capture.json.gz", blob: new SizedBlob(128 * mib) }, ...bodies.slice(0, 32)], { artifactBytes: huge }), /DIRECT_ARCHIVE_ARTIFACT_BYTE_LIMIT/);
  const many = Array.from({ length: 20001 }, (_, index) => ({ path: "files/" + index.toString(16).padStart(64, "0"), blob: new Blob([]) }));
  await assert.rejects(createDirectDataArchiveV1(many, { entries: huge }), /DIRECT_ARCHIVE_ENTRY_LIMIT/);
});

await check("incorrect streamed sizes, unsupported chunks and stream failures cannot create a ZIP", async () => {
  class BrokenBlob extends Blob {
    constructor(bytes, chunks) { super([bytes]); this.chunks = chunks; }
    slice() { return this; }
    stream() { const chunks = this.chunks.slice(); return new ReadableStream({ pull(controller) {
      const value = chunks.shift();
      if (value === undefined) controller.close(); else controller.enqueue(value);
    } }); }
  }
  const original = Buffer.from("abc"), path = file(original).path;
  for (const chunks of [[new Uint8Array([1, 2])], [new Uint8Array([1, 2, 3, 4])]])
    await assert.rejects(createDirectDataArchiveV1([manifest(), { path, blob: new BrokenBlob(original, chunks) }]), /DIRECT_ARCHIVE_SOURCE_SIZE_MISMATCH/);
  await assert.rejects(createDirectDataArchiveV1([manifest(), { path, blob: new BrokenBlob(original, ["not bytes"]) }]), /DIRECT_ARCHIVE_SOURCE_CHUNK_INVALID/);
  const tinyChunks = await createDirectDataArchiveV1([manifest(), file(Buffer.from("abc"))], { streamChunkBytes: 1 });
  assert.deepEqual(await (await JSZip.loadAsync(await tinyChunks.arrayBuffer(), {checkCRC32:true})).file(file(Buffer.from("abc")).path).async("nodebuffer"), Buffer.from("abc"));
  class ThrowingBlob extends Blob { slice() { return this; } stream() { throw Error("Private source URL must not escape"); } }
  await assert.rejects(createDirectDataArchiveV1([manifest(), { path, blob: new ThrowingBlob([original]) }]), /^Error: DIRECT_ARCHIVE_SOURCE_READ_FAILED$/);
  let cancelled = false;
  class NoProgressBlob extends Blob { slice() { return this; } stream() { return new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array()); }, cancel() { cancelled = true; },
  }); } }
  await assert.rejects(createDirectDataArchiveV1([manifest(), { path, blob: new NoProgressBlob([original]) }]), /DIRECT_ARCHIVE_SOURCE_CHUNK_INVALID/);
  assert.equal(cancelled, true, "A source producing no bytes is cancelled rather than looped indefinitely");
});

console.log("PASS " + checks.length + " direct archive writer checks");
