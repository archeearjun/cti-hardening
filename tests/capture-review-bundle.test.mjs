import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import JSZip from "jszip";
import {
  prepareCaptureReviewBundle,
  classifyReviewOriginal,
  MAX_CAPTURE_REVIEW_TEXT_BYTES,
} from "../src/domain/capture-review-bundle.ts";
import { readCaptureFileBytes } from "../src/domain/capture-file.ts";
import { readCourseraCaptureArchiveBlobs } from "../src/domain/coursera-capture-archive.ts";
import { directPanoptoFixture } from "./coursera-direct-panopto-fixtures.mjs";
import { directTextFixture } from "./coursera-direct-content-fixtures.mjs";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { createDirectDataMediaReaderV1 } from "../src/extractors/coursera/direct-data-media.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const at = "2026-10-18T00:00:00.000Z";
function sourceFixture(originals) {
  const capture = {
    schemaVersion: 2,
    extractor: "CTI Brightspace synthetic",
    extractedAt: at,
    page: { url: "https://source.example.test/d2l/home/123" },
    originalBodyTransport: {
      format: "CTI_BRIGHTSPACE_ARCHIVE_V1",
      version: 1,
      bodyEncoding: "archive",
      hashAlgorithm: "SHA-256",
    },
    contentTree: [],
    assetBodies: {},
    contentAcquisition: { assets: [], gaps: [{ reason: "ACTUAL_SOURCE_GAP" }] },
    quizzes: [
      {
        Id: 7,
        Questions: [
          {
            QuestionId: 4,
            QuestionText: "Original question?",
            Options: [{ Text: "Original key", IsCorrect: true }],
          },
        ],
      },
    ],
    assignments: [],
    discussions: [],
  };
  for (const [index, original] of originals.entries()) {
    const digest = hash(original.bytes),
      url = `https://source.example.test/content/enforced/123/${original.name}`;
    const receipt = {
      requestUrl: url,
      responseUrl: url,
      status: 200,
      observedAt: at,
      bytes: original.bytes.length,
      sha256: digest,
      complete: true,
      contentType: original.mime,
    };
    capture.assetBodies[digest] = {
      encoding: "archive",
      archivePath: "files/" + digest,
      sha256: digest,
      bytes: original.bytes.length,
    };
    capture.contentTree.push({
      kind: "TOPIC",
      id: "topic-" + index,
      title: original.name,
      url,
      contentEvidence: {
        status: "CAPTURED_ORIGINAL",
        originalRef: digest,
        contentType: original.mime,
        bodyReceipt: receipt,
        url,
      },
    });
    capture.contentAcquisition.assets.push({
      url,
      originalRef: digest,
      bytes: original.bytes.length,
      sha256: digest,
      mediaType: original.mime,
      receipt,
      sourceBindings: [{ kind: "TOPIC", id: "topic-" + index }],
    });
  }
  return capture;
}
async function pack(capture, originals, options = {}) {
  const zip = new JSZip(),
    json = Buffer.from(JSON.stringify(capture)),
    gz = gzipSync(json);
  zip.file("capture.json.gz", gz, { createFolders: false });
  for (const original of originals)
    zip.file("files/" + hash(original.bytes), original.bytes, {
      createFolders: false,
    });
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "STORE",
    ...options,
  });
  return { file: new File([bytes], "synthetic.cti.zip"), bytes, json, gz };
}
async function unpack(result) {
  return JSZip.loadAsync(await result.file.arrayBuffer(), { checkCRC32: true });
}

test("review retains exact native compressed manifest and every textual original, with explicit verified binary omissions", async () => {
  const originals = [
    {
      name: "guide.html",
      mime: "text/html; charset=utf-8",
      bytes: Buffer.from(
        "<h1>Original</h1><div hidden>Second tab & exact text</div>\r\n",
      ),
    },
    {
      name: "bank.csv",
      mime: "application/octet-stream",
      bytes: Buffer.from(
        '\uFEFFNewQuestion,MC\r\nQuestionText,"Original prompt"\r\n',
      ),
    },
    {
      name: "caption.vtt",
      mime: "text/vtt",
      bytes: Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nExact caption\n"),
    },
    {
      name: "image.png",
      mime: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
    },
  ];
  const model = sourceFixture(originals),
    before = JSON.stringify(model),
    selected = await pack(model, originals);
  const result = await prepareCaptureReviewBundle(selected.file),
    zip = await unpack(result),
    manifest = JSON.parse(
      await zip.file("review-manifest.json").async("string"),
    ),
    index = JSON.parse(await zip.file("media-index.json").async("string"));
  assert.equal(result.underSharingTarget, true);
  assert.deepEqual(
    Buffer.from(
      await zip.file(manifest.nativeCapture.path).async("uint8array"),
    ),
    selected.gz,
  );
  assert.deepEqual(
    gunzipSync(await zip.file(manifest.nativeCapture.path).async("uint8array")),
    selected.json,
  );
  assert.equal(JSON.stringify(model), before);
  assert.equal(manifest.kind, "CTI_CAPTURE_REVIEW_BUNDLE");
  assert.equal(manifest.notForCourseAudit, true);
  assert.equal(manifest.original.sha256, hash(selected.bytes));
  assert.equal(manifest.nativeCapture.expandedSha256, hash(selected.json));
  assert.deepEqual(manifest.counts, {
    originalsVerified: 4,
    originalBytes: originals.reduce((n, o) => n + o.bytes.length, 0),
    includedTextOriginals: 3,
    includedTextBytes: originals
      .slice(0, 3)
      .reduce((n, o) => n + o.bytes.length, 0),
    omittedOriginals: 1,
    omittedOriginalBytes: originals[3].bytes.length,
  });
  for (const original of originals.slice(0, 3))
    assert.deepEqual(
      Buffer.from(
        await zip
          .file("original-text/files/" + hash(original.bytes))
          .async("uint8array"),
      ),
      original.bytes,
    );
  assert.equal(
    zip.file("original-text/files/" + hash(originals[3].bytes)),
    null,
  );
  const csv = index.bodies.find(
    (body) => body.sha256 === hash(originals[1].bytes),
  );
  assert.deepEqual(csv.recordedMediaTypes, ["application/octet-stream"]);
  assert.equal(
    csv.classificationBasis,
    "RECORDED_CSV_URL_WITH_GENERIC_MIME_AND_STRICT_UTF8_ROUNDTRIP",
  );
  assert(
    index.bodies.every(
      (body) =>
        body.originalVerification === "VERIFIED_BYTES" &&
        body.nativeBindings.length,
    ),
  );
  for (const entry of manifest.entries) {
    const bytes = await zip.file(entry.path).async("uint8array");
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256);
  }
  await assert.rejects(
    readCaptureFileBytes(new File([result.file], "renamed.cti.zip")),
    /unsafe|invalid|archive/i,
    "A review ZIP cannot substitute for a native capture",
  );
  const clone = structuredClone(result);
  assert.equal(clone.file.size, result.file.size);
  assert.equal(
    hash(new Uint8Array(await clone.file.arrayBuffer())),
    result.sha256,
  );
});

test("every binary original must pass CRC and native SHA before a textual bundle is offered", async () => {
  const originals = [
    {
      name: "source.txt",
      mime: "text/plain",
      bytes: Buffer.from("Retained original text"),
    },
    {
      name: "image.png",
      mime: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
    },
  ];
  const model = sourceFixture(originals),
    bad = structuredClone(originals);
  bad[1].bytes[10] = 8;
  const zip = new JSZip();
  zip.file("capture.json.gz", gzipSync(Buffer.from(JSON.stringify(model))), {
    createFolders: false,
  });
  originals.forEach((original, i) =>
    zip.file("files/" + hash(original.bytes), bad[i].bytes, {
      createFolders: false,
    }),
  );
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "STORE",
  });
  await assert.rejects(
    prepareCaptureReviewBundle(new File([bytes], "corrupt.cti.zip")),
    /SHA-256/,
  );
  const clean = await pack(model, originals),
    corruptCrc = new Uint8Array(clean.bytes),
    needle = Buffer.from(originals[1].bytes),
    position = Buffer.from(corruptCrc).indexOf(needle);
  corruptCrc[position + 10] ^= 1;
  await assert.rejects(
    prepareCaptureReviewBundle(new File([corruptCrc], "crc.cti.zip")),
    /CRC32/,
  );
});

test("wrong native source ownership is rejected rather than reclassified as a harmless omission", async () => {
  const originals = [
      {
        name: "source.txt",
        mime: "text/plain",
        bytes: Buffer.from("Native owner"),
      },
    ],
    model = sourceFixture(originals);
  model.contentAcquisition.assets[0].sourceBindings[0].id = "another-topic";
  await assert.rejects(
    prepareCaptureReviewBundle((await pack(model, originals)).file),
    /absent or ambiguous native source/,
  );
});

test("text classification rejects ambiguity, invalid UTF8 and oversized declared text; generic filenames do not change MIME", async () => {
  const classify = (mime, url, bytes) =>
    classifyReviewOriginal(
      { recordedMediaTypes: mime, recordedUrls: [url], bytes: bytes.length },
      new Blob([bytes]),
    );
  assert.equal(
    (
      await classify(
        ["application/octet-stream"],
        "https://source.test/unknown.html",
        Buffer.from("<p>looks textual</p>"),
      )
    ).included,
    false,
  );
  assert.equal(
    (
      await classify(
        ["application/octet-stream"],
        "https://source.test/bank.csv",
        Buffer.from("QuestionText,Exact\r\n"),
      )
    ).included,
    true,
  );
  await assert.rejects(
    classify(
      ["text/plain", "image/png"],
      "https://source.test/a",
      Buffer.from("x"),
    ),
    /contradictory/,
  );
  await assert.rejects(
    classify(
      ["text/plain"],
      "https://source.test/a",
      Uint8Array.of(0xc3, 0x28),
    ),
    /strict UTF-8/,
  );
  await assert.rejects(
    classifyReviewOriginal(
      {
        recordedMediaTypes: ["text/plain"],
        recordedUrls: [],
        bytes: MAX_CAPTURE_REVIEW_TEXT_BYTES + 1,
      },
      new Blob([new Uint8Array(MAX_CAPTURE_REVIEW_TEXT_BYTES + 1)]),
    ),
    /4 MiB/,
  );
  await assert.rejects(
    prepareCaptureReviewBundle(new File(["{}"], "capture.json")),
    /original.*cti.zip/i,
  );
});

test("Coursera Blob path shares full native Panopto ownership checks and does not retain binary heap arrays", async () => {
  const f = directPanoptoFixture(),
    body =
      f.capture.fingerprints[0].payload.directPanoptoEvidence.deliveries[0]
        .podcasts[0].body;
  body.archivePath = "files/" + body.sha256;
  delete body.base64;
  body.receipt.bodyFormat = "ORIGINAL_BINARY_BYTES_ARCHIVE";
  f.capture.meta.directDataCapture.exportTransport = {
    format: "ZIP_GZIP_JSON_V1",
  };
  const selected = await pack(f.capture, [{ bytes: Buffer.from(f.bytes) }]);
  class RangeOnlyFile extends File {
    arrayBuffer() {
      throw Error("No whole archive allocation");
    }
    slice(start, end, type) {
      assert(end - start <= 1024 * 1024);
      return super.slice(start, end, type);
    }
  }
  const input = await readCourseraCaptureArchiveBlobs(
    new RangeOnlyFile([selected.bytes], "range.cti.zip"),
    async (bytes) => new Uint8Array(gunzipSync(bytes)),
  );
  assert.equal(input.archiveFiles.length, 0);
  assert.equal(input.archiveBlobs.length, 1);
  assert.equal(input.archiveBlobs[0].blob.size, f.bytes.length);
  assert.deepEqual(Buffer.from(input.compressedMetadata), selected.gz);
  assert.equal(
    Object.hasOwn(
      input.capture.fingerprints[0].payload.directPanoptoEvidence.deliveries[0]
        .podcasts[0].body,
      "bytes",
    ),
    false,
  );
  const result = await prepareCaptureReviewBundle(selected.file);
  assert.equal(result.manifest.platform, "COURSERA");
  assert.equal(result.manifest.counts.omittedOriginals, 1);
  body.receipt.canonicalUrl = "https://different.cdn.example.test/wrong.mp4";
  await assert.rejects(
    prepareCaptureReviewBundle(
      (await pack(f.capture, [{ bytes: Buffer.from(f.bytes) }])).file,
    ),
    /native source binding/,
  );
});

test("incomplete native material declarations remain shareable and unchanged, while arbitrary archivePath-shaped data cannot add owners", async () => {
  const f = directPanoptoFixture(),
    body =
      f.capture.fingerprints[0].payload.directPanoptoEvidence.deliveries[0]
        .podcasts[0].body;
  body.archivePath = "files/" + body.sha256;
  delete body.base64;
  body.receipt.bodyFormat = "ORIGINAL_BINARY_BYTES_ARCHIVE";
  f.capture.meta.directDataCapture.exportTransport = {
    format: "ZIP_GZIP_JSON_V1",
  };
  f.capture.meta.directDataCapture.sourceStable = false;
  f.capture.meta.directDataCapture.acquisitionComplete = false;
  f.capture.fingerprints[0].payload.arbitraryUnvalidatedExtra = {
    archivePath: body.archivePath,
    sha256: body.sha256,
    size: body.size,
    mime: "text/plain",
    canonicalUrl: "https://forged.example.test/bank.csv",
  };
  const selected = await pack(f.capture, [{ bytes: Buffer.from(f.bytes) }]);
  const result = await prepareCaptureReviewBundle(selected.file),
    zip = await unpack(result),
    index = JSON.parse(await zip.file("media-index.json").async("string"));
  assert.equal(index.bodies[0].nativeBindings.length, 1);
  assert.deepEqual(index.bodies[0].recordedMediaTypes, ["video/mp4"]);
  assert.equal(index.bodies[0].includedInReviewBundle, false);
  assert.deepEqual(
    gunzipSync(
      await zip.file("native-capture/capture.json.gz").async("uint8array"),
    ),
    selected.json,
  );
  assert.equal(result.manifest.wholeCourseCompletenessCertified, false);
});

test("ordinary Coursera original bytes retain exact asset metadata and CML ownership; cross-item moves fail", async () => {
  const assetId = "ABCDEFGHIJKLMNOPQRSTUV",
    png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const apiReader = createDirectDataReaderV1({
    sanitize: sanitizeCourseraCourseDataModel,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          elements: [
            {
              id: assetId,
              name: "source.png",
              typeName: "image",
              url: { url: "https://fixture.cloudfront.net/source.png" },
            },
          ],
          paging: {},
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  const media = createDirectDataMediaReaderV1({
    apiReader,
    archiveMode: true,
    fetchImpl: async () =>
      new Response(png, { headers: { "content-type": "image/png" } }),
  });
  const asset = await media.capture(assetId);
  assert(asset.body?.archivePath);
  const f = directTextFixture({
    cmlValue: `<co-content><img assetId="${assetId}"/></co-content>`,
    textSample: "",
  });
  const evidence = f.payload.directDataEvidence,
    capture = {
      page: {
        courseId: evidence.courseId,
        url: `https://www.coursera.org/teach/fixture-course/${evidence.courseId}/content/edit`,
      },
      meta: {
        directDataCapture: {
          exportTransport: { format: "ZIP_GZIP_JSON_V1" },
          sourceStable: false,
        },
      },
      fingerprints: [
        {
          id: f.itemId,
          atomId: evidence.atomId,
          contentId: evidence.contentId,
          payload: {
            ...f.payload,
            directAssetEvidence: {
              method: "BOUND_CML_ASSET_METADATA_AND_BODY",
              assets: [asset],
              failures: [],
              missingPointers: [],
            },
          },
        },
      ],
    };
  const selected = await pack(capture, [{ bytes: png }]),
    before = JSON.stringify(capture),
    result = await prepareCaptureReviewBundle(selected.file);
  assert.equal(result.manifest.counts.originalsVerified, 1);
  assert.equal(result.manifest.counts.omittedOriginals, 1);
  assert.equal(JSON.stringify(capture), before);
  const bad = structuredClone(capture);
  bad.fingerprints[0].payload.directDataEvidence.itemId = "other-item";
  await assert.rejects(
    prepareCaptureReviewBundle((await pack(bad, [{ bytes: png }])).file),
    /exact native item/,
  );
  const wrongReference = structuredClone(capture),
    sources = wrongReference.fingerprints[0].payload.directDataSources;
  sources.atom.elements[0].draft.content.definition.content.definition.value =
    '<co-content><img assetId="ZZZZZZZZZZZZZZZZZZZZZZ"/></co-content>';
  sources.receipts.stability.atom = structuredClone(sources.atom);
  await assert.rejects(
    prepareCaptureReviewBundle(
      (await pack(wrongReference, [{ bytes: png }])).file,
    ),
    /exact native item/,
    "Editing both native draft copies cannot reuse an unchanged recorded draft hash",
  );
  const updatedDraftHash = hash(
    directCanonicalSourceTextV1(sources.atom.elements[0].draft),
  );
  sources.receipts.stability.draftHash = updatedDraftHash;
  wrongReference.fingerprints[0].payload.directDataEvidence.draftHash =
    updatedDraftHash;
  // A legitimate source edit can leave an old asset descriptor behind. Never
  // attribute its bytes to the new original CML merely because a hash matches.
  await assert.rejects(
    prepareCaptureReviewBundle(
      (await pack(wrongReference, [{ bytes: png }])).file,
    ),
    /different native item's CML/,
  );
});

test("an over-target complete bundle stays intact rather than cropping native content", async () => {
  const capture = sourceFixture([]);
  capture.retainedNativeText = randomBytes(25 * 1024 * 1024).toString("base64");
  const selected = await pack(capture, []),
    result = await prepareCaptureReviewBundle(selected.file);
  assert.equal(result.underSharingTarget, false);
  assert(result.file.size > 24 * 1024 * 1024);
  const zip = await unpack(result);
  assert.deepEqual(
    Buffer.from(
      await zip.file("native-capture/capture.json.gz").async("uint8array"),
    ),
    selected.gz,
  );
  assert.equal(
    result.manifest.nativeCapture.expandedSha256,
    hash(selected.json),
  );
  assert.equal(result.manifest.noSilentTruncation, true);
});

test("arbitrary nested source contentEvidence does not manufacture native MIME or ownership", async () => {
  const original = {
      name: "source.txt",
      mime: "text/plain",
      bytes: Buffer.from("Exact native original"),
    },
    capture = sourceFixture([original]);
  capture.contentTree[0].arbitrary = {
    id: "forged-owner",
    contentEvidence: {
      originalRef: hash(original.bytes),
      contentType: "image/png",
      url: "https://forged.example.test/asset",
    },
  };
  const result = await prepareCaptureReviewBundle(
      (await pack(capture, [original])).file,
    ),
    zip = await unpack(result),
    index = JSON.parse(await zip.file("media-index.json").async("string"));
  assert.equal(index.bodies[0].nativeBindings.length, 2);
  assert.deepEqual(index.bodies[0].recordedMediaTypes, ["text/plain"]);
  assert.equal(index.bodies[0].includedInReviewBundle, true);
  await assert.rejects(
    classifyReviewOriginal(
      { bytes: 1, recordedMediaTypes: ["text/plain"], recordedUrls: [] },
      new Blob(["too long"]),
    ),
    /byte length differs/,
  );
});

test("a self-consistent original from another course cannot acquire the page's ownership", async () => {
  const f = directPanoptoFixture(),
    body =
      f.capture.fingerprints[0].payload.directPanoptoEvidence.deliveries[0]
        .podcasts[0].body;
  body.archivePath = "files/" + body.sha256;
  delete body.base64;
  body.receipt.bodyFormat = "ORIGINAL_BINARY_BYTES_ARCHIVE";
  f.capture.meta.directDataCapture.exportTransport = {
    format: "ZIP_GZIP_JSON_V1",
  };
  const foreign = structuredClone(f.capture);
  foreign.page.url = foreign.page.url.replace(
    foreign.page.courseId,
    "Other_synthetic_course",
  );
  await assert.rejects(
    prepareCaptureReviewBundle(
      (await pack(foreign, [{ bytes: f.bytes }])).file,
    ),
    /different native course/,
  );
  foreign.page.courseId = "Other_synthetic_course";
  await assert.rejects(
    prepareCaptureReviewBundle(
      (await pack(foreign, [{ bytes: f.bytes }])).file,
    ),
    /material ownership belongs to a different course/,
  );
});
