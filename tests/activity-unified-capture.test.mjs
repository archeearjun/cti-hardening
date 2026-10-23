import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import * as unified from "../src/activity-designer/unified-capture.ts";
import {
  courseraDirectDataSource,
  courseraDirectDataBookmarkSource,
} from "../src/generated/extractor-sources.js";
import { createCourseraDirectDataCaptureBookmark } from "../src/domain/coursera-direct-data-capture.ts";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { createDirectDataMediaReaderV1 } from "../src/extractors/coursera/direct-data-media.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";

const hash = (data) => createHash("sha256").update(data).digest("hex");
function capture() {
  return {
    schemaVersion: 35,
    extractedAt: "2026-10-16T21:00:00.000Z",
    page: {
      courseId: "branch",
      title: "Source title",
      url: "https://www.coursera.org/teach/course/branch/content/edit",
    },
    meta: {
      directDataCapture: {
        mode: "BOUND_AUTHORING_DRAFT_API",
        exportTransport: { format: "ZIP_GZIP_JSON_V1" },
      },
    },
    fingerprints: [
      {
        id: "read1",
        name: "Current reading",
        type: "Reading",
        typeName: "supplement",
        ancestors: [
          { id: "m1", title: "Module", key: "m1" },
          { id: "l1", title: "Lesson", key: "m1/l1" },
        ],
        payload: {
          textScopeKind: "bound-authoring-draft-cml",
          textSample:
            "The original teaching explains how to read measurements and compare units before selecting a formula.",
          captureContract: {
            status: "UNRESOLVED_DIRECT_READING",
            complete: false,
          },
        },
      },
      {
        id: "rp1",
        name: "Original role play",
        type: "rolePlay",
        typeName: "rolePlay",
        ancestors: [
          { id: "m1", title: "Module", key: "m1" },
          { id: "l1", title: "Lesson", key: "m1/l1" },
        ],
        payload: {
          directDataSources: {
            atom: {
              elements: [
                {
                  draft: {
                    content: {
                      typeName: "rolePlayDraft",
                      definition: {
                        title: "",
                        tasks: "<broken source>",
                        persona: null,
                        unknownNativeField: [false, "original"],
                      },
                    },
                  },
                  published: { name: "Earlier published source" },
                },
              ],
            },
          },
          captureContract: {
            status: "UNRESOLVED_DIRECT_TYPE",
            complete: false,
          },
        },
      },
    ],
  };
}
async function archive(value, files = []) {
  const zip = new JSZip();
  zip.file("capture.json.gz", gzipSync(Buffer.from(JSON.stringify(value))), {
    createFolders: false,
  });
  for (const file of files)
    zip.file("files/" + file.sha256, file.bytes, { createFolders: false });
  return new File(
    [await zip.generateAsync({ type: "uint8array", compression: "STORE" })],
    "original.cti.zip",
  );
}
function context() {
  const ctx = vm.createContext({
    console,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DOMException,
    AbortController,
    DOMParser,
    crypto,
    atob,
    btoa,
    JSZip,
    setTimeout,
    clearTimeout,
    CourseCtiUnifiedCapture: unified,
  });
  for (const name of [
    "xml-reader",
    "shell-capture",
    "cti-adapter",
    "cti-documents",
    "core",
  ])
    vm.runInContext(
      fs.readFileSync(
        new URL("../src/activity-designer/" + name + ".js", import.meta.url),
        "utf8",
      ),
      ctx,
    );
  return ctx;
}

test("activity delivery uses the exact universal bookmark without another source reader", () => {
  assert.equal(
    unified.bookmark(courseraDirectDataBookmarkSource),
    createCourseraDirectDataCaptureBookmark(),
  );
  assert.equal(
    decodeURIComponent(unified.bookmark(courseraDirectDataBookmarkSource).slice(11)),
    "void " + courseraDirectDataBookmarkSource,
  );
  const ctx = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(
      new URL("../public/activity-designer/configuration.js", import.meta.url),
      "utf8",
    ),
    ctx,
  );
  assert.equal(ctx.CourseCtiCaptureScript, courseraDirectDataSource);
  assert.equal(
    ctx.CourseCtiCaptureBookmark,
    unified.bookmark(courseraDirectDataBookmarkSource),
  );
  assert.throws(() => unified.bookmark(""), /unavailable/);
  assert.throws(() => unified.bookmark("a".repeat(500 * 1024)), /limit/);
});

test("same bookmark archive prepares current CML and keeps opaque role-play configuration unchanged", async () => {
  const original = capture(),
    file = await archive(original),
    imported = await unified.read(file);
  assert.deepEqual(imported.raw, original);
  assert.equal(imported.transport.encoding, "zip");
  const c = context(),
    projected = c.CourseCtiAdapter.adapt(imported.raw);
  assert.equal(
    projected.items[0].blocks[0].text,
    original.fingerprints[0].payload.textSample,
  );
  assert.equal(projected.items[1].coverage, "unsupported");
  assert(
    projected.items[1].notes.some((text) =>
      /native configuration remains/.test(text),
    ),
  );
  assert.deepEqual(
    imported.raw,
    original,
    "Preparation cannot repair or invent authored values.",
  );
  const session = await c.CoursePrep.processFiles([file]);
  assert.equal(session.courses.length, 1);
  assert.equal(session.input_files[0].sha256, imported.sha256);
  assert(
    session.sources[0].documents.some((doc) =>
      doc.text.includes("original teaching"),
    ),
  );
});

test("gzip capture uses the same identity and projection path", async () => {
  const original = capture(),
    file = new File(
      [gzipSync(Buffer.from(JSON.stringify(original)))],
      "capture.json.gz",
    );
  const imported = await unified.read(file);
  assert.deepEqual(imported.raw, original);
  assert.equal(imported.transport.encoding, "gzip");
  const c = context(),
    session = await c.CoursePrep.processFiles([file]);
  assert.equal(session.courses[0].branch_id, "branch");
});

test("unified activity archive transport rejects original-byte corruption and unrelated file paths", async () => {
  const original = Buffer.from("%PDF-1.7\nOriginal source drawing\n"),
    sha256 = hash(original),
    value = capture();
  value.fingerprints[0].payload.directAssetEvidence = {
    assets: [
      {
        body: { archivePath: "files/" + sha256, sha256, size: original.length },
      },
    ],
  };
  const imported = await unified.read(
    await archive(value, [{ sha256, bytes: original }]),
  );
  assert.deepEqual(
    Buffer.from(
      imported.raw.fingerprints[0].payload.directAssetEvidence.assets[0].body
        .bytes,
    ),
    original,
  );
  assert.equal(JSON.stringify(imported.raw), JSON.stringify(value));
  await assert.rejects(
    unified.read(
      await archive(value, [
        { sha256, bytes: Buffer.alloc(original.length, 88) },
      ]),
    ),
    /SHA-256/,
  );
  await assert.rejects(
    unified.read(await archive(capture(), [{ sha256, bytes: original }])),
    /unreferenced/,
  );
});

test("diagnostics and supplemental captures cannot replace a full course snapshot", async () => {
  for (const marker of [
    { kind: "FOCUSED_EXTRACTOR_DIAGNOSTIC" },
    { notForCourseAudit: true },
    { kind: "CTI_COURSERA_READING_RECOVERY" },
  ])
    await assert.rejects(
      unified.read(await archive({ ...capture(), ...marker })),
      /full CTI course/,
    );
  await assert.rejects(
    unified.read(
      new File([new Uint8Array([0x1f, 0x8b, 0x08])], "capture.json.gz"),
    ),
    /truncated|damaged/,
  );
});

test("current source-bound PDFs enter activity packets; unbound and historical bodies cannot substitute", async () => {
  const value = capture(),
    fp = value.fingerprints[0],
    atomId = "a".repeat(22),
    assetId = "m".repeat(22),
    url = "https://fixture.cloudfront.net/original/document";
  value.page.courseId = "branch12";
  const original = Buffer.from("%PDF-1.7\nOriginal teaching drawing\n");
  const api = createDirectDataReaderV1({
    sanitize: sanitizeCourseraCourseDataModel,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          elements: [
            {
              id: assetId,
              name: "Source drawing.pdf",
              typeName: "generic",
              url: { url },
            },
          ],
          paging: {},
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  const reader = createDirectDataMediaReaderV1({
    apiReader: api,
    fetchImpl: async () =>
      new Response(original, {
        headers: { "content-type": "application/pdf" },
      }),
  });
  const asset = await reader.capture(assetId);
  const atom = {
    id: atomId,
    contentId: "atom~" + atomId,
    storedAtomVersion: 1,
    metadata: { updatedAt: 123456789 },
    status: { typeName: "draftAtomStatus", definition: {} },
    draft: {
      name: "Reading",
      content: {
        typeName: "supplementDraft",
        definition: {
          assetId: "r".repeat(22) + "@1",
          content: {
            typeName: "cml",
            definition: {
              dtdId: "supplement/1",
              value:
                '<co-content><a assetId="' +
                assetId +
                '" href="' +
                url +
                '">Original drawing</a></co-content>',
            },
          },
        },
      },
    },
  };
  const receipt = (resource) => ({
    resource,
    id: atomId,
    status: 200,
    bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    originalResponseSha256: "b".repeat(64),
    sha256: "b".repeat(64),
    requestPath: "/api/" + resource + "/" + atomId,
  });
  const source = {
    atom: { elements: [atom], paging: {}, linked: {} },
    relation: {
      elements: [
        {
          id: atomId,
          atomId,
          branchRelationMap: {
            [value.page.courseId + "~" + fp.id]: {
              courseId: value.page.courseId,
              itemId: fp.id,
              courseSlug: "course",
            },
          },
        },
      ],
      paging: {},
      linked: {},
    },
    receipts: {
      atom: receipt("authoringAtoms.v2"),
      relation: receipt("authoringItemContentRelations.v1"),
      stability: {
        stable: true,
        draftHash: "c".repeat(64),
        storedAtomVersion: 1,
        updatedAt: 123456789,
        atom: { elements: [structuredClone(atom)] },
        receipt: receipt("authoringAtoms.v2"),
      },
    },
  };
  Object.assign(fp, { atomId, contentId: atom.contentId });
  fp.payload.directDataSources = source;
  fp.payload.directAssetEvidence = {
    method: "BOUND_CML_ASSET_METADATA_AND_BODY",
    assets: [asset],
    failures: [],
    missingPointers: [],
  };
  const pdfs = unified.pdfs(value);
  assert.equal(pdfs.length, 1);
  assert.equal(pdfs[0].itemId, fp.id);
  assert.equal(pdfs[0].asset.sha256, hash(original));
  assert.deepEqual(Buffer.from(pdfs[0].asset.base64, "base64"), original);
  source.receipts.stability.stable = false;
  assert.deepEqual(unified.pdfs(value), []);
  source.receipts.stability.stable = true;
  fp.payload.directAssetEvidence.assets = [
    { assetId, retainedEvidence: { body: asset.body } },
  ];
  assert.deepEqual(unified.pdfs(value), []);
});
