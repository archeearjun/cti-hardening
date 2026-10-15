import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildCourseraArchiveProof } from "../src/domain/coursera-archive-proof.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const bytes = new Uint8Array([1, 2, 3, 4]),
    sha256 = hash(bytes),
    path = "files/" + sha256;
  const metadata = Buffer.from('{"fingerprints":[]}');
  const file = { path, sha256, size: bytes.length, bytes };
  const transport = {
    encoding: "zip",
    name: "capture.cti.zip",
    bytes: 300,
    sha256: hash("archive"),
    expandedBytes: metadata.length,
    fileCount: 1,
    originalBodyBytes: bytes.length,
    files: [{ path, sha256, size: bytes.length }],
  };
  return { metadata, file, transport };
}

test("compact archive proofs survive JSON storage without originals or unrecognized transport fields", () => {
  const { metadata, file, transport } = fixture();
  transport.files[0].bytes = new Uint8Array([99]);
  transport.files[0].token = "PRIVATE_SENTINEL";
  transport.url = "https://private.invalid/PRIVATE_SENTINEL";
  const proof = buildCourseraArchiveProof(
    hash(metadata),
    metadata.length,
    transport,
    [file],
  );
  assert.equal(proof.metadataSha256, hash(metadata));
  assert.equal(proof.archiveSha256, transport.sha256);
  assert.equal(proof.originalBytesStored, false);
  assert.deepEqual(proof.files, [
    { path: file.path, sha256: file.sha256, size: file.size },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(proof)), proof);
  assert.equal(JSON.stringify(proof).includes('"bytes"'), false);
  assert.equal(JSON.stringify(proof).includes("PRIVATE_SENTINEL"), false);
  assert.equal(Number.isSafeInteger(proof.originalBodyBytes), true);
});

test("proofs reject mismatched transport inventories and physical bounds", () => {
  const { metadata, file, transport } = fixture();
  for (const changes of [
    { files: [] },
    { files: [{ ...transport.files[0], size: 5 }] },
    { files: [{ ...transport.files[0], sha256: "a".repeat(64) }] },
    { fileCount: 0 },
    { originalBodyBytes: 5 },
    { expandedBytes: metadata.length + 1 },
    { bytes: 640 * 1024 * 1024 + 1 },
    { bytes: 1 },
  ])
    assert.throws(
      () =>
        buildCourseraArchiveProof(
          hash(metadata),
          metadata.length,
          { ...transport, ...changes },
          [file],
        ),
      /archive.*contradicts/i,
    );
  assert.throws(
    () =>
      buildCourseraArchiveProof(hash(metadata), metadata.length, undefined, [
        file,
      ]),
    /verified ZIP identity/,
  );
  assert.equal(
    buildCourseraArchiveProof(hash(metadata), metadata.length, undefined, []),
    undefined,
  );
});

test("proof descriptors independently bind actual bytes and reject duplicate or tampered originals", () => {
  const { metadata, file, transport } = fixture();
  const corrupt = { ...file, bytes: new Uint8Array([4, 3, 2, 1]) };
  assert.throws(
    () =>
      buildCourseraArchiveProof(hash(metadata), metadata.length, transport, [
        corrupt,
      ]),
    /checksum/,
  );
  assert.throws(
    () =>
      buildCourseraArchiveProof(
        hash(metadata),
        metadata.length,
        {
          ...transport,
          fileCount: 2,
          files: [transport.files[0], transport.files[0]],
        },
        [file, file],
      ),
    /checksum|invalid/,
  );
  assert.throws(
    () =>
      buildCourseraArchiveProof(hash(metadata), metadata.length, transport, [
        { ...file, size: 16 * 1024 * 1024 + 1 },
      ]),
    /size|checksum/,
  );
});

test("large archive proofs remain scoped to verified MP4 rendition bytes with ordinary file bounds unchanged", () => {
  const f=fixture(),bytes=Buffer.alloc(16*1024*1024+1);bytes.writeUInt32BE(24,0);bytes.write("ftypmp42",4,"ascii");
  const sha256=hash(bytes),file={path:"files/"+sha256,sha256,size:bytes.length,bytes,kind:"PANOPTO_PODCAST_RENDITION"},
    transport={...f.transport,bytes:bytes.length+300,originalBodyBytes:bytes.length,
      files:[{path:file.path,sha256,size:bytes.length}]};
  const proof=buildCourseraArchiveProof(hash(f.metadata),f.metadata.length,transport,[file]);
  assert.equal(proof.originalBodyBytes,bytes.length);
  assert.deepEqual(proof.files,[{path:file.path,sha256,size:bytes.length}]);
  assert.throws(()=>buildCourseraArchiveProof(hash(f.metadata),f.metadata.length,transport,[{...file,kind:undefined}]),/invalid.*size|checksum/);
  assert.throws(()=>buildCourseraArchiveProof(hash(f.metadata),f.metadata.length,transport,[{...file,size:128*1024*1024+1}]),/invalid.*size|checksum/);
  const html=Buffer.from("<html>not an MP4 rendition</html>"),fakeHash=hash(html),fake={...file,size:html.length,bytes:html,sha256:fakeHash,path:"files/"+fakeHash};
  assert.throws(()=>buildCourseraArchiveProof(hash(f.metadata),f.metadata.length,
    {...transport,originalBodyBytes:html.length,files:[{path:fake.path,sha256:fakeHash,size:html.length}]},[fake]),/invalid.*bytes|checksum/);
});
