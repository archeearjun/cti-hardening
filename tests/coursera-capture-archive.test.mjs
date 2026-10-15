import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { createDirectDataArchiveV1 } from "../src/extractors/coursera/direct-data-archive.js";
import {
  readCourseraCaptureFileBytes,
  readCourseraCaptureFileJson,
  attachCourseraArchiveFileBytes,
} from "../src/domain/coursera-capture-file.ts";
import { directPanoptoFixture } from "./coursera-direct-panopto-fixtures.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const body = (bytes) => ({
  archivePath: "files/" + hash(bytes),
  sha256: hash(bytes),
  size: bytes.length,
  mime: "image/png",
  canonicalUrl: "https://d3c33hcgiwev3.cloudfront.net/synthetic.png",
  receipt: { bodyFormat: "ORIGINAL_BINARY_BYTES_ARCHIVE" },
});
function capture(assets = []) {
  return {
    schemaVersion: 35,
    meta: {
      directDataCapture: { exportTransport: { format: "ZIP_GZIP_JSON_V1" } },
    },
    fingerprints: [
      { id: "item", payload: { directAssetEvidence: { assets } } },
    ],
  };
}
async function pack(value, originals = [], options = {}) {
  const zip = new JSZip();
  zip.file("capture.json.gz", gzipSync(Buffer.from(JSON.stringify(value))), {
    createFolders: false,
  });
  for (const file of originals)
    zip.file(file.path || "files/" + hash(file.bytes), file.bytes, {
      createFolders: false,
    });
  return zip.generateAsync({
    type: "uint8array",
    compression: options.compression || "STORE",
    streamFiles: options.streamFiles === true,
  });
}
const selected = (bytes) => new File([bytes], "capture.cti.zip");
function centralEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    footer = bytes.length - 22,
    result = [],
    count = view.getUint16(footer + 10, true);
  let offset = view.getUint32(footer + 16, true);
  for (let index = 0; index < count; index++) {
    const nameSize = view.getUint16(offset + 28, true),
      local = view.getUint32(offset + 42, true);
    result.push({
      central: offset,
      local,
      nameSize,
      path: new TextDecoder().decode(
        bytes.subarray(offset + 46, offset + 46 + nameSize),
      ),
    });
    offset +=
      46 +
      nameSize +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return result;
}

test("a range-read ZIP preserves metadata, deduplicated originals and both SHA identities without reading the whole archive", async () => {
  const original = Buffer.alloc(3 * 1024 * 1024, 0x5a),
    reference = body(original),
    value = capture([
      { assetId: "a".repeat(22), body: reference },
      { assetId: "b".repeat(22), body: structuredClone(reference) },
    ]),
    zipped = await pack(value, [{ bytes: original }]);
  const ranges = [];
  class RangeOnlyFile extends File {
    arrayBuffer() {
      throw Error("A complete archive must not be allocated in JS memory.");
    }
    slice(start, end, type) {
      ranges.push(end - start);
      return super.slice(start, end, type);
    }
  }
  const imported = await readCourseraCaptureFileBytes(
    new RangeOnlyFile([zipped], "course.cti.zip"),
  );
  assert.equal(hash(imported.bytes), hash(Buffer.from(JSON.stringify(value))));
  assert.equal(imported.archiveFiles.length, 1);
  assert.deepEqual(Buffer.from(imported.archiveFiles[0].bytes), original);
  assert.equal(imported.transport.encoding, "zip");
  assert.equal(imported.transport.sha256, hash(zipped));
  assert.equal(imported.transport.originalBodyBytes, original.length);
  assert.equal(imported.transport.fileCount, 1);
  assert(Math.max(...ranges) <= 1024 * 1024);
  const parsed = await readCourseraCaptureFileJson(selected(zipped)),
    resolved =
      parsed.fingerprints[0].payload.directAssetEvidence.assets[0].body;
  assert.equal(hash(resolved.bytes), reference.sha256);
  assert.equal(
    Object.getOwnPropertyDescriptor(resolved, "bytes").enumerable,
    false,
  );
  assert.equal(
    JSON.stringify(parsed),
    JSON.stringify(value),
    "The original metadata bytes and manifest remain unchanged.",
  );
});

test("failed refreshes can retain independently verified historical files beside current partial bodies", async () => {
  const prior = Buffer.from("original prior bytes"),
    current = Buffer.from("original newer bytes"),
    value = capture([
      {
        assetId: "a".repeat(22),
        reason: "DIRECT_ASSET_SOURCE_CHANGED",
        body: body(current),
        retainedEvidence: { body: body(prior) },
      },
    ]),
    zipped = await pack(value, [{ bytes: current }, { bytes: prior }]),
    parsed = await readCourseraCaptureFileJson(selected(zipped)),
    asset = parsed.fingerprints[0].payload.directAssetEvidence.assets[0];
  assert.equal(hash(asset.body.bytes), hash(current));
  assert.equal(hash(asset.retainedEvidence.body.bytes), hash(prior));
  assert.equal(
    asset.reason,
    "DIRECT_ASSET_SOURCE_CHANGED",
    "Retained bytes cannot erase the current-source failure.",
  );
});

test("the native bookmark ZIP writer imports through the independent range parser without binary hydration in JSON", async () => {
  const original = Buffer.from("original native attachment"),
    value = capture([{ body: body(original) }]),
    archive = await createDirectDataArchiveV1([
      {
        path: "capture.json.gz",
        blob: new Blob([gzipSync(Buffer.from(JSON.stringify(value)))]),
      },
      { path: "files/" + hash(original), blob: new Blob([original]) },
    ]),
    imported = await readCourseraCaptureFileBytes(
      new File([archive], "native.cti.zip"),
    );
  assert.equal(imported.archiveFiles.length, 1);
  assert.deepEqual(Buffer.from(imported.archiveFiles[0].bytes), original);
  assert.equal(new TextDecoder().decode(imported.bytes), JSON.stringify(value));
  const corrupt = await createDirectDataArchiveV1([
    {
      path: "capture.json.gz",
      blob: new Blob([gzipSync(Buffer.from(JSON.stringify(value)))]),
    },
    {
      path: "files/" + hash(original),
      blob: new Blob([Buffer.alloc(original.length,0x78)]),
    },
  ]);
  await assert.rejects(
    readCourseraCaptureFileBytes(new File([corrupt], "corrupt-native.cti.zip")),
    /SHA-256/,
  );
});

function podcastArchive(bytes) {
  const f = directPanoptoFixture(), reference = {
    ...f.body, archivePath: "files/" + hash(bytes), sha256: hash(bytes), size: bytes.length,
    kind: "PANOPTO_PODCAST_RENDITION",
    receipt: { ...f.body.receipt, bytes: bytes.length, sha256: hash(bytes),
      bodyFormat: "ORIGINAL_BINARY_BYTES_ARCHIVE", role: "PODCAST_STREAM_RENDITION" },
  };
  delete reference.base64;
  f.delivery.podcasts[0].body = reference;
  f.capture.meta.directDataCapture.exportTransport = { format: "ZIP_GZIP_JSON_V1" };
  return { ...f, reference };
}

test("one archive retains a native-bound large podcast rendition and ordinary originals with independent checksums", async () => {
  const bytes=Buffer.alloc(16*1024*1024+1);bytes.writeUInt32BE(24,0);bytes.write("ftypmp42",4,"ascii");
  const f=podcastArchive(bytes), ordinary=Buffer.from("synthetic ordinary original");
  f.fp.payload.directAssetEvidence={assets:[{body:body(ordinary)}]};
  const archive=await createDirectDataArchiveV1([
    {path:"capture.json.gz",blob:new Blob([gzipSync(Buffer.from(JSON.stringify(f.capture)))])},
    {path:f.reference.archivePath,blob:new Blob([bytes],{type:"video/mp4"}),kind:"PANOPTO_PODCAST_RENDITION"},
    {path:body(ordinary).archivePath,blob:new Blob([ordinary])},
  ]), imported=await readCourseraCaptureFileBytes(new File([archive],"podcast.cti.zip")),
    hydrated=attachCourseraArchiveFileBytes(JSON.parse(new TextDecoder().decode(imported.bytes)),imported.archiveFiles);
  assert.equal(imported.archiveFiles.length,2);
  assert.equal(imported.transport.originalBodyBytes,bytes.length+ordinary.length);
  assert.equal(imported.archiveFiles.find(file=>file.sha256===hash(bytes)).kind,"PANOPTO_PODCAST_RENDITION");
  const retained=hydrated.fingerprints[0].payload.directPanoptoEvidence.deliveries[0].podcasts[0].body;
  assert.deepEqual(Buffer.from(retained.bytes),bytes);
  assert(!Object.keys(retained).includes("bytes"));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(imported.bytes)),f.capture,"Metadata identity excludes hydrated byte views");
});

test("large podcast exceptions require native delivery and exact rendition ownership rather than a supplied kind flag", async () => {
  const bytes=Buffer.alloc(16*1024*1024+1);bytes.writeUInt32BE(24,0);bytes.write("ftypmp42",4,"ascii");
  for(const mutate of [
    f=>{f.delivery.podcasts[0].role="VIEWER_STREAM";},
    f=>{f.reference.canonicalUrl="https://media.example.test/unrelated.mp4";},
    f=>{f.delivery.initial.receipt.method="GET";},
    f=>{f.fp.payload.directPanoptoEvidence.itemId="another-item";},
    f=>{f.fp.payload.directAssetEvidence={assets:[{body:f.reference}]};delete f.fp.payload.directPanoptoEvidence;},
  ]) {
    const f=podcastArchive(bytes);mutate(f);
    await assert.rejects(readCourseraCaptureFileBytes(selected(await pack(f.capture,[{bytes}]))),/binding|16 MiB/);
  }
  const f=podcastArchive(bytes), file={path:f.reference.archivePath,sha256:hash(bytes),size:bytes.length,bytes,kind:"PANOPTO_PODCAST_RENDITION"};
  assert.throws(()=>attachCourseraArchiveFileBytes(capture([{body:f.reference}]),[file]),/16 MiB/);
  const wrong=Buffer.from("<html>not an MP4 rendition</html>"), invalid=podcastArchive(wrong);
  await assert.rejects(readCourseraCaptureFileBytes(selected(await pack(invalid.capture,[{bytes:wrong}]))),/MP4/);
});

test("historical native podcast bodies survive failed current reads without becoming current captured media", async () => {
  const bytes=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]),f=podcastArchive(bytes),podcast=f.delivery.podcasts[0];
  podcast.retainedEvidence={targetUrl:f.delivery.targetUrl,initial:structuredClone(f.delivery.initial),
    final:structuredClone(f.delivery.final),stableSource:true,podcast:{...f.candidate,body:podcast.body}};
  delete podcast.body;podcast.reason="DIRECT_PANOPTO_BODY_READ_FAILED";
  const imported=await readCourseraCaptureFileJson(selected(await pack(f.capture,[{bytes}]))),
    saved=imported.fingerprints[0].payload.directPanoptoEvidence.deliveries[0].podcasts[0];
  assert.equal(saved.body,undefined);
  assert.equal(saved.reason,"DIRECT_PANOPTO_BODY_READ_FAILED");
  assert.deepEqual(Buffer.from(saved.retainedEvidence.podcast.body.bytes),bytes);
});

test("ZIP path, inventory, compression and encryption claims cannot substitute unrelated original files", async () => {
  const original = Buffer.from("bound original"),
    other = Buffer.from("unrelated original"),
    value = capture([{ body: body(original) }]);
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(await pack(value, []))),
    /referenced original file is absent/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(
      selected(await pack(value, [{ bytes: original }, { bytes: other }])),
    ),
    /unreferenced original files/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(
      selected(
        await pack(value, [{ path: "files/../outside", bytes: original }]),
      ),
    ),
    /unsafe/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(
      selected(
        await pack(value, [{ bytes: original }], { compression: "DEFLATE" }),
      ),
    ),
    /compressed/,
  );
  const encrypted = await pack(value, [{ bytes: original }]),
    view = new DataView(encrypted.buffer);
  for (const entry of centralEntries(encrypted)) {
    view.setUint16(entry.central + 8, 1, true);
    view.setUint16(entry.local + 6, 1, true);
  }
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(encrypted)),
    /encrypted/,
  );
  const duplicated = await pack(
      capture([{ body: body(original) }, { body: body(other) }]),
      [{ bytes: original }, { bytes: other }],
    ),
    originals = centralEntries(duplicated).filter((entry) =>
      entry.path.startsWith("files/"),
    );
  duplicated.set(
    new TextEncoder().encode(originals[0].path),
    originals[1].central + 46,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(duplicated)),
    /duplicated/,
  );
});

test("CRC, original-byte SHA, declared size and explicit source ownership are independently required", async () => {
  const original = Buffer.from("bound original"),
    value = capture([{ body: body(original) }]),
    zipped = await pack(value, [{ bytes: original }]);
  const crcCorrupt = Uint8Array.from(zipped),
    entry = centralEntries(crcCorrupt).find((candidate) =>
      candidate.path.startsWith("files/"),
    ),
    view = new DataView(crcCorrupt.buffer),
    bodyStart =
      entry.local +
      30 +
      view.getUint16(entry.local + 26, true) +
      view.getUint16(entry.local + 28, true);
  crcCorrupt[bodyStart] ^= 1;
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(crcCorrupt)),
    /CRC32/,
  );
  const falseHash = "a".repeat(64),
    badValue = capture([
      {
        body: {
          ...body(original),
          archivePath: "files/" + falseHash,
          sha256: falseHash,
        },
      },
    ]);
  await assert.rejects(
    readCourseraCaptureFileBytes(
      selected(
        await pack(badValue, [{ path: "files/" + falseHash, bytes: original }]),
      ),
    ),
    /SHA-256/,
  );
  const badSize = capture([
    { body: { ...body(original), size: original.length + 1 } },
  ]);
  await assert.rejects(
    readCourseraCaptureFileBytes(
      selected(await pack(badSize, [{ bytes: original }])),
    ),
    /differs from its body receipt/,
  );
  assert.throws(
    () =>
      attachCourseraArchiveFileBytes(value, [
        {
          path: body(original).archivePath,
          sha256: hash(original),
          size: original.length,
          bytes: Buffer.from("wrong"),
        },
      ]),
    /checksum/,
  );
  assert.throws(
    () => attachCourseraArchiveFileBytes(value, []),
    /referenced original file is absent/,
  );
});

test("overlapping local ranges and contradictory streaming data descriptors are rejected before source parsing", async () => {
  const original = Buffer.from("bound original"),
    value = capture([{ body: body(original) }]),
    overlapped = await pack(value, [{ bytes: original }]),
    metadata = centralEntries(overlapped)[0],
    view = new DataView(overlapped.buffer),
    size = view.getUint32(metadata.central + 24, true) + 1;
  view.setUint32(metadata.central + 20, size, true);
  view.setUint32(metadata.central + 24, size, true);
  view.setUint32(metadata.local + 18, size, true);
  view.setUint32(metadata.local + 22, size, true);
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(overlapped)),
    /entry ranges overlap/,
  );
  const streamed = await pack(value, [{ bytes: original }], {
    streamFiles: true,
  });
  assert.equal(
    (await readCourseraCaptureFileBytes(selected(streamed))).archiveFiles
      .length,
    1,
  );
  const entries = centralEntries(streamed),
    entry = entries.find((item) => item.path.startsWith("files/")),
    streamedView = new DataView(streamed.buffer),
    dataStart =
      entry.local +
      30 +
      streamedView.getUint16(entry.local + 26, true) +
      streamedView.getUint16(entry.local + 28, true),
    dataEnd = dataStart + streamedView.getUint32(entry.central + 24, true);
  streamed[dataEnd + 4] ^= 1;
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(streamed)),
    /data descriptor disagrees/,
  );
});

test("unsupported extraction versions and contradictory streaming local fields are rejected", async () => {
  const original = Buffer.from("bound original"),
    value = capture([{ body: body(original) }]);
  for (const needed of [0, 45, 51]) {
    const zipped = await pack(value, [{ bytes: original }]),
      view = new DataView(zipped.buffer),
      entry = centralEntries(zipped)[0];
    view.setUint16(entry.central + 6, needed, true);
    view.setUint16(entry.local + 4, needed, true);
    await assert.rejects(
      readCourseraCaptureFileBytes(selected(zipped)),
      /unsupported/,
      String(needed),
    );
  }
  const mismatch = await pack(value, [{ bytes: original }]),
    entry = centralEntries(mismatch)[0],
    view = new DataView(mismatch.buffer);
  const centralVersion = view.getUint16(entry.central + 6, true);
  view.setUint16(entry.local + 4, centralVersion === 10 ? 20 : 10, true);
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(mismatch)),
    /local entry header is invalid/,
  );
  for (const offset of [14, 18, 22]) {
    const streamed = await pack(value, [{ bytes: original }], {
        streamFiles: true,
      }),
      streamedEntry = centralEntries(streamed)[0],
      streamedView = new DataView(streamed.buffer);
    streamedView.setUint32(streamedEntry.local + offset, 1, true);
    await assert.rejects(
      readCourseraCaptureFileBytes(selected(streamed)),
      /streaming local checksums and sizes must be zero/,
      String(offset),
    );
  }
});

test("archive and expanded metadata bounds apply before allocating original bodies and cannot be overridden upward", async () => {
  const original = Buffer.alloc(1024),
    value = capture([{ body: body(original) }]),
    zipped = await pack(value, [{ bytes: original }]);
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(zipped), {
      archiveBytes: zipped.length - 1,
    }),
    /archive bound/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(zipped), { originalBytes: 1000 }),
    /original files exceed/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(zipped), { expandedBytes: 100 }),
    /metadata|expanded/,
  );
  await assert.rejects(
    readCourseraCaptureFileBytes(selected(zipped), { archiveBytes: 0 }),
    /invalid transport limits/,
  );
  assert.equal(
    (
      await readCourseraCaptureFileBytes(selected(zipped), {
        archiveBytes: 1024 * 1024 * 1024,
      })
    ).archiveFiles.length,
    1,
  );
  const extra = Buffer.concat([
    Buffer.from(zipped),
    Buffer.from("unaccounted"),
  ]);
  await assert.rejects(readCourseraCaptureFileBytes(selected(extra)), /footer/);
});
