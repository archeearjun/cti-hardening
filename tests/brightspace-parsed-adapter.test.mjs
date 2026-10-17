import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  create_qaParseBrightspaceGroundTruthCapture_,
  qaParseBrightspaceGroundTruthModel_,
} from "../src/engine/source/brightspace-matching.js";
import { create_runPostIngestionQaCore_ } from "../src/engine/comparison/course.js";
import { createBrowserServices } from "../src/adapters/browser-services.ts";
import {
  attachBrightspaceArchiveFileBlobs,
  assertBrightspaceCaptureIntegrity,
} from "../src/domain/brightspace-capture-evidence.ts";
import { buildContentSnapshot } from "../src/domain/content-evidence.ts";
import {
  buildOwnerContext,
  sourceVisibilityText,
} from "../src/domain/source-navigation.ts";

const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const at = "2026-10-17T12:00:00.000Z";
function fixture() {
  const html =
      '<html><body><div class="d2l-element" data-type="horizontal"><div class="tabs-wrapper tabs-horizontal"><div class="list-group"><a class="list-group-item"><span data-itemprop="0|0">Original tab</span></a></div><div class="tab-content"><div class="tab-pane" data-itemprop="0|1"><p>Original retained text.</p></div></div></div></div></body></html>',
    original = Buffer.from(html),
    hash = sha(original),
    url = "https://source.example.test/content/enforced/187960-DEV/guide.html";
  return {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.1.1",
    capturedAt: at,
    page: { url: "https://source.example.test/d2l/home/187960" },
    course: { orgUnitId: "187960", title: "Synthetic source" },
    contentTree: [
      {
        kind: "MODULE",
        id: "archive",
        title: "Archive",
        isHidden: true,
        isLocked: false,
        children: [
          {
            kind: "MODULE",
            id: "module-0",
            title: "Module 0",
            isHidden: false,
            isLocked: false,
            children: [
              {
                kind: "TOPIC",
                id: "guide",
                title: "Guide",
                path: ["Archive", "Module 0"],
                isHidden: false,
                isLocked: false,
                url,
                activityType: 1,
                contentEvidence: {
                  status: "CAPTURED",
                  format: "html",
                  charset: "utf-8",
                  html,
                  text: "Original retained text.",
                  textLength: "Original retained text.".length,
                  textSha256: sha("Original retained text."),
                  rawBodyRef: hash,
                  projectionTruncated: false,
                  bodyReceipt: {
                    requestUrl: url,
                    responseUrl: url,
                    status: 200,
                    complete: true,
                    observedAt: at,
                    bytes: original.length,
                    sha256: hash,
                    contentType: "text/html; charset=utf-8",
                  },
                },
              },
            ],
          },
        ],
      },
    ],
    quizzes: [],
    assignments: [],
    discussions: [],
    assetBodies: {
      [hash]: {
        encoding: "base64",
        base64: original.toString("base64"),
        bytes: original.length,
        sha256: hash,
      },
    },
    contentAcquisition: { assets: [], gaps: [] },
  };
}
function archived(input) {
  const capture = structuredClone(input),
    files = [];
  capture.originalBodyTransport = {
    format: "CTI_BRIGHTSPACE_ARCHIVE_V1",
    version: 1,
    bodyEncoding: "archive",
    hashAlgorithm: "SHA-256",
  };
  for (const [hash, body] of Object.entries(capture.assetBodies)) {
    files.push({
      path: "files/" + hash,
      sha256: hash,
      size: body.bytes,
      blob: new Blob([Buffer.from(body.base64, "base64")]),
    });
    capture.assetBodies[hash] = {
      encoding: "archive",
      archivePath: "files/" + hash,
      bytes: body.bytes,
      sha256: hash,
    };
  }
  return { capture, files };
}

test("parsed Brightspace adapter preserves the complete legacy model projection and exact manifest identity", () => {
  const capture = fixture();
  capture.quizzes = [
    { id: "same", name: "Quiz" },
    { id: "same", name: "Quiz" },
  ];
  capture.runtimeSignals = [{ activityTypeLabel: "SCORM", topicId: "guide" }];
  capture.assignments = [
    {
      id: "assignment",
      raw: { Instructions: { Text: "Original instructions." } },
    },
  ];
  const before = structuredClone(capture),
    selected = encode(capture),
    identity = { name: "source.json", sha256: sha(selected) };
  const legacy = create_qaParseBrightspaceGroundTruthCapture_(
    createBrowserServices(),
  )(Buffer.from(selected).toString("base64"), identity.name);
  const parsed = qaParseBrightspaceGroundTruthModel_(capture, identity);
  assert.deepEqual(parsed, legacy);
  assert.equal(parsed.sha256, sha(selected));
  assert.equal(parsed.quizById.same, null);
  assert.equal(parsed.quizByName.quiz, null);
  assert.equal(parsed.topics[0].id, "guide");
  assert.equal(parsed.runtimeCarriers[0].family, "SCORM");
  assert.deepEqual(capture, before);
});

test("parsed adapter rejects a missing manifest identity and does not grant original-body integrity", () => {
  for (const identity of [
    undefined,
    {},
    { sha256: "a".repeat(63) },
    { sha256: "G".repeat(64) },
  ])
    assert.throws(
      () => qaParseBrightspaceGroundTruthModel_(fixture(), identity),
      /manifest identity/,
    );
  const { capture } = archived(fixture());
  qaParseBrightspaceGroundTruthModel_(capture, {
    name: "source.cti.zip",
    sha256: sha(encode(capture)),
  });
  assert.throws(
    () => assertBrightspaceCaptureIntegrity(capture),
    /Brightspace/,
  );
  assert.throws(
    () => buildContentSnapshot(undefined, undefined, undefined, capture),
    /Brightspace/,
  );
});

test("verified archive Blobs supply exactly the legacy content and original HTML structure without Base64 restoration", async () => {
  const legacy = fixture(),
    { capture, files } = archived(legacy),
    before = structuredClone(capture);
  await attachBrightspaceArchiveFileBlobs(capture, files);
  const expected = buildContentSnapshot(undefined, encode(legacy));
  const actual = buildContentSnapshot(undefined, undefined, undefined, capture);
  assert.deepEqual(actual, expected);
  assert.deepEqual(capture, before);
  assert.equal(
    actual.brightspace[0].content.sourceBody.htmlStructure.groups[0].panels[0]
      .label,
    "Original tab",
  );
  assert.equal(actual.brightspace[0].content.sourceBody.observedAt, at);
  assert.equal(actual.brightspace[0].content.textCoverage, "PARTIAL");
  assert.equal(JSON.stringify(capture).includes('"base64"'), false);
  const forged = structuredClone(capture);
  assert.throws(
    () => buildContentSnapshot(undefined, undefined, undefined, forged),
    /Brightspace/,
  );
});

test("Brightspace byte input is bounded before package loading and its parsed callback receives the exact bytes", () => {
  const run = create_runPostIngestionQaCore_(createBrowserServices());
  let loads = 0,
    reads = 0;
  const io = {
    loadPackage() {
      loads++;
      return { success: true, tree: [], packageMeta: {} };
    },
    readBrightspaceCapture(bytes) {
      reads++;
      assert.equal(bytes, selected);
      throw Error("exact parsed source reached");
    },
  };
  const args = (source) => [
    "AA==",
    "outline.xlsx",
    "",
    "",
    "11111111-1111-4111-8111-111111111111",
    "raw",
    false,
    {},
    source,
    "source.json",
    "",
    "",
    io,
  ];
  for (const source of [
    new Uint8Array(0),
    new Uint8Array(128 * 1024 * 1024 + 1),
  ]) {
    const result = run(...args(source));
    assert.equal(result.success, false);
    assert.match(result.error, /128 MiB/);
  }
  assert.equal(loads, 0);
  const selected = encode(fixture());
  const result = run(...args(selected));
  assert.equal(loads, 1);
  assert.equal(reads, 1);
  assert.match(result.error, /exact parsed source reached/);
});

test("owner navigation uses the parsed model and retains exact ancestor flags without inferring learner availability", () => {
  const capture = fixture(),
    before = structuredClone(capture);
  const parsed = buildOwnerContext(undefined, [], capture);
  const legacy = buildOwnerContext(encode(capture));
  assert.deepEqual(parsed, legacy);
  const topic = parsed.sourceTopics[0],
    visibility = topic.sourceVisibility;
  assert.equal(topic.path, "Archive > Module 0");
  assert.equal(visibility.ownHidden, false);
  assert.equal(visibility.hiddenByAncestor, true);
  assert.equal(visibility.hiddenByCapturedFlags, true);
  assert.deepEqual(
    visibility.ancestors.map((a) => a.id),
    ["archive", "module-0"],
  );
  assert.equal(visibility.lockedByCapturedFlags, false);
  assert.match(
    sourceVisibilityText(topic).join("\n"),
    /Archive \[archive\]; hidden=true/,
  );
  assert.match(
    sourceVisibilityText(topic).join("\n"),
    /Actual learner access.*remain unverified/,
  );
  assert.deepEqual(capture, before);
  const unknown = structuredClone(capture);
  delete unknown.contentTree[0].isHidden;
  const uncertain = buildOwnerContext(undefined, [], unknown).sourceTopics[0]
    .sourceVisibility;
  assert.equal(uncertain.hiddenByAncestor, null);
  assert.equal(uncertain.hiddenByCapturedFlags, null);
  assert.deepEqual(sourceVisibilityText({}), []);
});
