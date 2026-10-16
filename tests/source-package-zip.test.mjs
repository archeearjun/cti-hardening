import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  openSourcePackageZip,
  MAX_SOURCE_PACKAGE_ENTRY_BYTES,
  MAX_SOURCE_PACKAGE_COMPRESSED_ENTRY_BYTES,
  MAX_SOURCE_PACKAGE_ZIP_ENTRIES,
} from "../src/adapters/source-package-zip.ts";

const utf8 = (value) => new TextEncoder().encode(value);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const put16 = (bytes, at, value) =>
  new DataView(bytes.buffer).setUint16(at, value, true);
const put32 = (bytes, at, value) =>
  new DataView(bytes.buffer).setUint32(at, value, true);
const put64 = (bytes, at, value) =>
  new DataView(bytes.buffer).setBigUint64(at, BigInt(value), true);

// Independent byte-level fixtures permit corrupt CRCs, lying body sizes and
// native duplicate/path spellings that a normal ZIP writer repairs or rejects.
function archive(rows, { zip64 = false } = {}) {
  let offset = 0;
  const segments = [],
    central = [],
    metadata = [];
  for (const row of rows) {
    const name = utf8(row.name),
      localName = utf8(row.localName ?? row.name),
      data =
        typeof row.data === "string"
          ? utf8(row.data)
          : row.data || new Uint8Array();
    const method = row.method ?? 0,
      payload = row.payload || (method === 8 ? deflateRawSync(data) : data);
    const physicalSize = row.physicalSize ?? payload.length,
      compressedSize = row.compressedSize ?? physicalSize,
      uncompressedSize =
        row.uncompressedSize ?? row.physicalSize ?? data.length;
    const crc = row.crc ?? crc32(data),
      localExtra = new Uint8Array(zip64 ? 20 : 0),
      centralExtra = new Uint8Array(zip64 ? 28 : 0);
    if (zip64) {
      put16(localExtra, 0, 1);
      put16(localExtra, 2, 16);
      put64(localExtra, 4, uncompressedSize);
      put64(localExtra, 12, compressedSize);
      put16(centralExtra, 0, 1);
      put16(centralExtra, 2, 24);
      put64(centralExtra, 4, uncompressedSize);
      put64(centralExtra, 12, compressedSize);
      put64(centralExtra, 20, offset);
    }
    const local = new Uint8Array(30 + localName.length + localExtra.length);
    put32(local, 0, 0x04034b50);
    put16(local, 4, zip64 ? 45 : 20);
    put16(local, 6, 0x800);
    put16(local, 8, method);
    put32(local, 14, crc);
    put32(local, 18, zip64 ? 0xffffffff : compressedSize);
    put32(local, 22, zip64 ? 0xffffffff : uncompressedSize);
    put16(local, 26, localName.length);
    put16(local, 28, localExtra.length);
    local.set(localName, 30);
    local.set(localExtra, 30 + localName.length);
    segments.push(
      { offset, bytes: local },
      { offset: offset + local.length, bytes: payload },
    );
    metadata.push({
      name: row.name,
      offset,
      dataOffset: offset + local.length,
      physicalSize,
    });
    const header = new Uint8Array(46 + name.length + centralExtra.length);
    put32(header, 0, 0x02014b50);
    put16(header, 4, zip64 ? 45 : 20);
    put16(header, 6, zip64 ? 45 : 20);
    put16(header, 8, 0x800);
    put16(header, 10, method);
    put32(header, 16, crc);
    put32(header, 20, zip64 ? 0xffffffff : compressedSize);
    put32(header, 24, zip64 ? 0xffffffff : uncompressedSize);
    put16(header, 28, name.length);
    put16(header, 30, centralExtra.length);
    put32(header, 38, row.name.endsWith("/") ? 16 : 0);
    put32(header, 42, zip64 ? 0xffffffff : offset);
    header.set(name, 46);
    header.set(centralExtra, 46 + name.length);
    central.push(header);
    offset += local.length + physicalSize;
  }
  const directoryOffset = offset,
    directorySize = central.reduce((sum, bytes) => sum + bytes.length, 0);
  for (const bytes of central) {
    segments.push({ offset, bytes });
    offset += bytes.length;
  }
  if (zip64) {
    const end64 = new Uint8Array(56),
      locator = new Uint8Array(20);
    put32(end64, 0, 0x06064b50);
    put64(end64, 4, 44);
    put16(end64, 12, 45);
    put16(end64, 14, 45);
    put64(end64, 24, rows.length);
    put64(end64, 32, rows.length);
    put64(end64, 40, directorySize);
    put64(end64, 48, directoryOffset);
    put32(locator, 0, 0x07064b50);
    put64(locator, 8, offset);
    put32(locator, 16, 1);
    segments.push(
      { offset, bytes: end64 },
      { offset: offset + 56, bytes: locator },
    );
    offset += 76;
  }
  const end = new Uint8Array(22);
  put32(end, 0, 0x06054b50);
  put16(end, 8, zip64 ? 0xffff : rows.length);
  put16(end, 10, zip64 ? 0xffff : rows.length);
  put32(end, 12, zip64 ? 0xffffffff : directorySize);
  put32(end, 16, zip64 ? 0xffffffff : directoryOffset);
  segments.push({ offset, bytes: end });
  offset += end.length;
  return { segments, size: offset, metadata, directoryOffset };
}
function asBlob(fixture) {
  let previous = 0;
  const parts = [];
  for (const segment of fixture.segments) {
    assert.equal(
      segment.offset,
      previous,
      "A physical test Blob cannot have sparse gaps",
    );
    parts.push(segment.bytes);
    previous += segment.bytes.length;
  }
  return new Blob(parts);
}
class SparseBlob extends Blob {
  constructor(fixture) {
    super([]);
    this.fixture = fixture;
    this.ranges = [];
  }
  get size() {
    return this.fixture.size;
  }
  async arrayBuffer() {
    throw Error("Whole-package arrayBuffer is forbidden");
  }
  stream() {
    throw Error("Whole-package streaming is forbidden");
  }
  slice(start = 0, end = this.size) {
    start = Math.max(0, start < 0 ? this.size + start : start);
    end = Math.min(this.size, end < 0 ? this.size + end : end);
    assert(
      end - start <= 16 * 1024 * 1024,
      "Every source range is bounded before allocation",
    );
    this.ranges.push({ start, end });
    const result = new Uint8Array(Math.max(0, end - start));
    for (const segment of this.fixture.segments) {
      const first = Math.max(start, segment.offset),
        last = Math.min(end, segment.offset + segment.bytes.length);
      if (last > first)
        result.set(
          segment.bytes.subarray(first - segment.offset, last - segment.offset),
          first - start,
        );
    }
    return new Blob([result]);
  }
}

test("source ZIP reads stored and native deflated content with exact paths and all scanner output formats", async () => {
  const original = "Literal source café 日本語\n<not-generated>",
    binary = Uint8Array.from([0, 1, 2, 255]);
  const zip = await openSourcePackageZip(
    asBlob(
      archive([
        { name: "Course/", data: "" },
        { name: "Course/Readme.HTML", data: original, method: 8 },
        { name: "course/readme.html", data: "A different native file" },
        { name: "binary.bin", data: binary },
        { name: "__proto__", data: "Native filename" },
      ]),
    ),
  );
  try {
    assert.deepEqual(Object.keys(zip.files), [
      "Course/",
      "Course/Readme.HTML",
      "course/readme.html",
      "binary.bin",
      "__proto__",
    ]);
    assert.equal(Object.getPrototypeOf(zip.files), null);
    assert.equal(zip.files["Course/"].dir, true);
    assert.equal(await zip.files["Course/"].async("string"), "");
    assert.equal(
      zip.files["Course/Readme.HTML"]._data.uncompressedSize,
      utf8(original).length,
    );
    assert.equal(
      await zip.files["Course/Readme.HTML"].async("string"),
      original,
    );
    assert.deepEqual(
      new Uint8Array(await zip.files["binary.bin"].async("arraybuffer")),
      binary,
    );
    assert.deepEqual(await zip.files["binary.bin"].async("uint8array"), binary);
    assert.equal(
      await zip.files["__proto__"].async("string"),
      "Native filename",
    );
  } finally {
    await zip.close();
  }
  await zip.close();
  await assert.rejects(zip.files["binary.bin"].async("string"), /closed/);
});

test("a sparse 450 MiB ZIP64 source retains its large media reference and seeks only the small structural files", async () => {
  const xml = '<manifest identifier="original"><resources/></manifest>',
    source = new SparseBlob(
      archive(
        [
          {
            name: "media/original.mp4",
            physicalSize: 450 * 1024 * 1024,
            uncompressedSize: 450 * 1024 * 1024,
          },
          { name: "imsmanifest.xml", data: xml, method: 8 },
          { name: "pages/intro.html", data: "<p>Exact source</p>" },
        ],
        { zip64: true },
      ),
    );
  const zip = await openSourcePackageZip(source);
  try {
    assert.equal(
      zip.files["media/original.mp4"]._data.uncompressedSize,
      450 * 1024 * 1024,
    );
    assert.equal(await zip.files["imsmanifest.xml"].async("string"), xml);
    assert.equal(
      await zip.files["pages/intro.html"].async("string"),
      "<p>Exact source</p>",
    );
    const rangesBeforeMedia = source.ranges.length;
    await assert.rejects(
      zip.files["media/original.mp4"].async("arraybuffer"),
      /24 MiB/,
    );
    assert.equal(
      source.ranges.length,
      rangesBeforeMedia,
      "Over-limit bodies fail before reading local header or payload",
    );
    assert(
      source.ranges.every(
        (range) => range.end - range.start <= 16 * 1024 * 1024,
      ),
    );
    assert(
      source.ranges.reduce((sum, range) => sum + range.end - range.start, 0) <
        256 * 1024,
      "Reading structure does not walk the media payload",
    );
    assert(
      source.ranges
        .filter((range) => range.start < source.fixture.metadata[1].offset)
        .every((range) => range.end - range.start < 128 * 1024),
      "Only bounded archive identification probes may touch sparse media",
    );
  } finally {
    await zip.close();
  }
});

test("exact duplicate and unsafe paths are rejected while case-distinct native names are retained", async () => {
  for (const name of [
    "../escape",
    "safe/../escape",
    "safe\\..\\escape",
    "/absolute",
    "\\server\\file",
    "C:/absolute",
    "bad\0name",
  ]) {
    await assert.rejects(
      openSourcePackageZip(asBlob(archive([{ name, data: "x" }]))),
    );
  }
  await assert.rejects(
    openSourcePackageZip(
      asBlob(
        archive([
          { name: "same.txt", data: "one" },
          { name: "same.txt", data: "two" },
        ]),
      ),
    ),
    /duplicate|ambiguous/i,
  );
});

test("CRC, local filename and compressed-data truncation errors do not become extracted source text", async () => {
  for (const row of [
    { name: "bad.txt", data: "Native body", crc: 123 },
    { name: "native.txt", localName: "edited.txt", data: "Native body" },
    { name: "short.txt", data: "short", compressedSize: 20 },
    {
      name: "bad-deflate.txt",
      data: "Native body",
      method: 8,
      payload: Uint8Array.from([255, 255, 255]),
    },
  ]) {
    const zip = await openSourcePackageZip(asBlob(archive([row])));
    try {
      await assert.rejects(zip.files[row.name].async("string"));
    } finally {
      await zip.close();
    }
  }
  const valid = asBlob(
    archive([{ name: "imsmanifest.xml", data: "<manifest/>" }]),
  );
  await assert.rejects(openSourcePackageZip(valid.slice(0, valid.size - 7)));
});

test("declared and actual entry bounds reject compressed bombs without dropping the native inventory", async () => {
  for (const row of [
    {
      name: "declared-large.html",
      data: "x",
      uncompressedSize: MAX_SOURCE_PACKAGE_ENTRY_BYTES + 1,
    },
    {
      name: "declared-compressed.html",
      data: "x",
      compressedSize: MAX_SOURCE_PACKAGE_COMPRESSED_ENTRY_BYTES + 1,
    },
    {
      name: "lying-size.html",
      data: "x".repeat(1024 * 1024),
      method: 8,
      uncompressedSize: 1,
    },
    {
      name: "actual-large.html",
      data: "x".repeat(MAX_SOURCE_PACKAGE_ENTRY_BYTES + 1),
      method: 8,
      uncompressedSize: MAX_SOURCE_PACKAGE_ENTRY_BYTES,
    },
  ]) {
    const zip = await openSourcePackageZip(asBlob(archive([row])));
    try {
      assert.ok(
        zip.files[row.name],
        "Body-read limits retain the native reference",
      );
      await assert.rejects(
        zip.files[row.name].async("string"),
        /24 MiB|declared uncompressed size|uncompressed size/i,
      );
    } finally {
      await zip.close();
    }
  }
});

test("the full 24 MiB body boundary remains readable for STORE and DEFLATE with bounded compressed overhead", async () => {
  const data = new Uint8Array(MAX_SOURCE_PACKAGE_ENTRY_BYTES);
  let seed = 0x91e10da5;
  for (let index = 0; index < data.length; index++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[index] = seed & 255;
  }
  const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const expected = checksum(data);
  // Level zero emits valid uncompressed DEFLATE blocks, whose required framing
  // makes the compressed entry strictly larger than the original 24 MiB body.
  const payload = deflateRawSync(data, { level: 0 });
  assert(payload.length > MAX_SOURCE_PACKAGE_ENTRY_BYTES);
  assert(payload.length <= MAX_SOURCE_PACKAGE_COMPRESSED_ENTRY_BYTES);
  for (const row of [
    { name: "boundary-store.bin", data },
    { name: "boundary-deflate.bin", data, method: 8, payload },
  ]) {
    const zip = await openSourcePackageZip(asBlob(archive([row])));
    try {
      const actual = await zip.files[row.name].async("uint8array");
      assert.equal(actual.byteLength, MAX_SOURCE_PACKAGE_ENTRY_BYTES);
      assert.equal(checksum(actual), expected);
    } finally {
      await zip.close();
    }
  }
});

test("central directory ranges and native entry counts are bounded before an unbounded metadata allocation", async () => {
  const source = archive([{ name: "imsmanifest.xml", data: "<manifest/>" }]);
  put32(source.segments.at(-1).bytes, 12, 17 * 1024 * 1024);
  await assert.rejects(openSourcePackageZip(new SparseBlob(source)), /16 MiB/);
  const many = archive(
    Array.from({ length: MAX_SOURCE_PACKAGE_ZIP_ENTRIES + 1 }, (_, index) => ({
      name: "f" + index,
      data: "",
    })),
  );
  await assert.rejects(openSourcePackageZip(asBlob(many)), /50,000/);
});
