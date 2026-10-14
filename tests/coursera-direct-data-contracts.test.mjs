import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser as XmlParser } from "@xmldom/xmldom";
import { webcrypto, createHash } from "node:crypto";
import JSZip from "jszip";
import {
  directReadingPayloadV1,
  directAssessmentContractV1,
  directEmptyStructureContractV1,
  directUnsupportedContractV1,
  parseCourseraCheckboxDefinitionDirectV1,
  directCmlTextV1,
  directDiscussionPayloadV1,
} from "../src/extractors/coursera/direct-data-contracts.js";
import {
  directDraftDiscussionSourceV1,
  directDraftAssessmentInventoryV1,
} from "../src/extractors/coursera/direct-data-models.js";
import { directCmlMediaInventoryV1 } from "../src/extractors/coursera/direct-data-media-contracts.js";
import { parseCourseraMcqDefinitionV61524 } from "../src/extractors/coursera/assessment-api.js";
import { assessmentCaptureCoverageV613 } from "../src/extractors/coursera/assessments-4.js";

const courseId = "Synthetic_course_123",
  slug = "synthetic-course",
  atomId = "a".repeat(22),
  localId = "g".repeat(22),
  assetId = "r".repeat(22) + "@1";
const xmlCalls = [];
class StrictXmlParser {
  parseFromString(value, mime) {
    xmlCalls.push(mime);
    if (mime !== "application/xml" && mime !== "text/html")
      throw new Error("unsupported fixture parser");
    return new XmlParser({
      onError() {
        throw new Error("invalid fixture XML");
      },
    }).parseFromString(
      value,
      mime === "text/html" ? "text/html" : "application/xml",
    );
  }
}
globalThis.DOMParser = StrictXmlParser;
if (!globalThis.crypto)
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
const cml = (text) => ({
  typeName: "cml",
  definition: {
    dtdId: "supplement/1",
    value: "<co-content><p>" + text + "</p></co-content>",
  },
});
function fixture(
  kind = "supplement",
  markup = cml("Current &amp; complete draft"),
) {
  const content =
    kind === "supplement"
      ? {
          typeName: "supplementDraft",
          definition: { assetId, content: markup },
        }
      : {
          typeName: "staffGradedDraft",
          definition: {
            parts: [
              {
                typeName: "storedQuestionGroupPart",
                definition: { id: localId },
              },
            ],
          },
        };
  const atom = {
    id: atomId,
    contentId: "atom~" + atomId,
    storedAtomVersion: 1,
    metadata: { updatedAt: 123456789 },
    status: { typeName: "draftAtomStatus", definition: {} },
    draft: { name: "Current draft", content },
    published: {
      name: "Older published snapshot",
      content: { typeName: "reading", definition: { assetId: "old@1" } },
    },
  };
  const relation = {
    id: atomId,
    atomId,
    branchRelationMap: {
      [courseId + "~item1"]: { courseId, itemId: "item1", courseSlug: slug },
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
  const sources = {
    atom: { elements: [atom], paging: {}, linked: {} },
    relation: { elements: [relation], paging: {}, linked: {} },
    receipts: {
      atom: receipt("authoringAtoms.v2"),
      relation: receipt("authoringItemContentRelations.v1"),
      stability: {
        stable: true,
        draftHash: "c".repeat(64),
        storedAtomVersion: 1,
        updatedAt: 123456789,
      },
    },
  };
  sources.receipts.stability.atom = structuredClone(sources.atom);
  sources.receipts.stability.receipt = receipt("authoringAtoms.v2");
  const fp = {
    id: "item1",
    name: "Structural title",
    type: kind === "supplement" ? "Reading" : "Assignment",
    typeName: kind,
    atomId,
    contentId: "atom~" + atomId,
    payload: { directDataSources: sources },
  };
  const bound = {
    courseId,
    itemId: fp.id,
    courseSlug: slug,
    atomId,
    contentId: fp.contentId,
    atom,
    relation,
    draft: atom.draft,
    published: atom.published,
    sourceState: "AUTHORING_DRAFT",
    storedAtomVersion: 1,
    updatedAt: 123456789,
  };
  const source = {
    cml: markup.definition.value,
    rawCML: markup,
    dtdId: "supplement/1",
    assetId,
    publishedAssetId: "old@1",
    sourceState: "AUTHORING_DRAFT",
  };
  return { fp, bound, source, sources };
}

test("reading contract keeps the whole current CML and explicit API provenance without DOM receipts", async () => {
  const f = fixture(),
    contract = await directReadingPayloadV1(f.fp, f.bound, f.source);
  assert.equal(contract.complete, true);
  assert.equal(contract.status, "COMPLETE_BOUND_DRAFT_READING");
  assert.equal(f.fp.payload.textSample, "Current & complete draft");
  assert.equal(f.fp.payload.textLength, f.fp.payload.textSample.length);
  assert.equal(f.fp.payload.directDraftCml.definition.value, f.source.cml);
  assert.equal(f.fp.payload.directDataEvidence.sourceState, "AUTHORING_DRAFT");
  assert.equal(
    f.fp.payload.directDataEvidence.rawCmlLength,
    f.source.cml.length,
  );
  assert.equal(f.fp.payload.directDataEvidence.stableSource, true);
  assert.equal(f.fp.payload.directDataEvidence.assetsBodyVerified, true);
  assert.match(f.fp.payload.directDataEvidence.rawCmlSha256, /^[a-f0-9]{64}$/);
  assert.equal(f.fp.payload.textCaptureEvidence, undefined);
  assert.equal(f.fp.payload.nativeAssignment, undefined);
  assert.strictEqual(f.fp.captureContract, f.fp.payload.captureContract);
  assert(xmlCalls.every((mime) => mime === "application/xml"));
});

test("missing stability, conflicting source identity and a published body never become a complete draft", async () => {
  for (const mode of [
    "unstable",
    "foreignItem",
    "receiptHash",
    "freshReceiptHash",
    "published",
  ]) {
    const f = fixture();
    if (mode === "unstable") f.sources.receipts.stability.stable = false;
    if (mode === "foreignItem")
      f.sources.relation.elements[0].branchRelationMap[
        courseId + "~item1"
      ].itemId = "different";
    if (mode === "receiptHash") f.sources.receipts.atom.sha256 = "d".repeat(64);
    if (mode === "freshReceiptHash")
      f.sources.receipts.stability.receipt.sha256 = "d".repeat(64);
    if (mode === "published")
      f.source.cml = "<co-content><p>Old published content</p></co-content>";
    const contract = await directReadingPayloadV1(f.fp, f.bound, f.source);
    assert.equal(contract.complete, false);
    assert.equal(contract.accounted, true);
    assert.equal(contract.needsEditor, false);
    assert.equal(contract.retryable, false);
  }
});

test("malformed XML and active declarations are rejected without mounting or fetching source resources", async () => {
  for (const value of [
    "<co-content><p>Broken</co-content>",
    '<!DOCTYPE co-content [<!ENTITY secret SYSTEM "https://fixture.invalid/private">]><co-content>&secret;</co-content>',
    "<co-content><script>danger()</script></co-content>",
  ]) {
    const f = fixture("supplement", {
      typeName: "cml",
      definition: { dtdId: "supplement/1", value },
    });
    assert.equal(
      (await directReadingPayloadV1(f.fp, f.bound, f.source)).complete,
      false,
    );
    assert.equal(directCmlTextV1(value), null);
  }
});

test("unresolved attachment labels and external frames keep explicit gaps; URL references never claim binary hashes", async () => {
  for (const value of [
    '<co-content><p>Read the attachment</p><asset assetId="observed-asset" filename="source.pdf"/></co-content>',
    '<co-content><p>Use the frame</p><iframe src="https://fixture.invalid/tool"/></co-content>',
  ]) {
    const f = fixture("supplement", {
      typeName: "cml",
      definition: { dtdId: "supplement/1", value },
    });
    const result = await directReadingPayloadV1(f.fp, f.bound, f.source);
    assert.equal(result.complete, false);
    assert(result.reasons.includes("DIRECT_READING_ASSETS_UNRESOLVED"));
    assert.equal(
      f.fp.payload.directDataEvidence.unresolvedAssetReferences.length,
      1,
    );
  }
  const f = fixture(
    "supplement",
    cml('Open <a href="https://fixture.invalid/source.pdf">the document</a>'),
  );
  assert.equal(
    (await directReadingPayloadV1(f.fp, f.bound, f.source)).complete,
    false,
  );
  assert.equal(f.fp.payload.directDataEvidence.assetsBodyVerified, false);
  assert.equal(
    f.fp.payload.assetDetails[0].hashStatus,
    "NOT_FETCHED_DIRECT_DATA",
  );
  assert.equal(f.fp.payload.assetDetails[0].sha256, undefined);
});

function capturedNativePng(id = "m".repeat(22)) {
  const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=",
      "base64",
    ),
    sha256 = createHash("sha256").update(bytes).digest("hex"),
    canonicalUrl = "https://d3c33hcgiwev3.cloudfront.net/synthetic/image.png";
  const metadata = {
    elements: [
      {
        id,
        name: "image.png",
        typeName: "image",
        url: { url: canonicalUrl, expires: 1 },
        contentVersion: 3,
      },
    ],
    paging: {},
  };
  const receipt = {
    resource: "assets.v1",
    id,
    requestPath: "/api/assets.v1",
    requestQuery: [["ids", id]],
    status: 200,
    bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    originalResponseSha256: "e".repeat(64),
    sha256: "e".repeat(64),
  };
  const fresh = structuredClone(metadata);
  fresh.elements[0].url.expires = 2;
  return {
    assetId: id,
    metadata,
    metadataReceipt: receipt,
    stability: {
      stable: true,
      metadata: fresh,
      receipt: structuredClone(receipt),
    },
    body: {
      base64: bytes.toString("base64"),
      size: bytes.length,
      sha256,
      mime: "image/png",
      canonicalUrl,
      receipt: {
        status: 200,
        bytes: bytes.length,
        sha256,
        mime: "image/png",
        canonicalUrl,
        observedAt: "2026-10-14T12:00:00.000Z",
        bodyFormat: "ORIGINAL_BINARY_BYTES_BASE64",
      },
    },
  };
}

test("bound native image IDs become complete only with scoped fresh metadata and retained original binary bytes", async () => {
  const id = "m".repeat(22),
    f = fixture("supplement", cml('Current <img assetId="' + id + '"/> image'));
  f.fp.payload.directAssetEvidence = {
    method: "BOUND_CML_ASSET_METADATA_AND_BODY",
    assets: [capturedNativePng(id)],
    missingPointers: [],
    failures: [],
  };
  const result = await directReadingPayloadV1(f.fp, f.bound, f.source);
  assert.equal(result.complete, true);
  assert.equal(f.fp.payload.directDataEvidence.assetReferenceCount, 1);
  assert.equal(f.fp.payload.directDataEvidence.assetsBodyVerified, true);
  assert.deepEqual(
    f.fp.payload.directDataEvidence.unresolvedAssetReferences,
    [],
  );
  assert.equal(f.fp.payload.assetDetails[0].assetId, id);
  assert.equal(f.fp.payload.assetDetails[0].bodyVerified, true);
  assert.equal(
    f.fp.payload.assetDetails[0].sha256,
    f.fp.payload.directAssetEvidence.assets[0].body.sha256,
  );
  assert.equal(f.fp.payload.directDraftCml.definition.value, f.source.cml);
});

function archivedNativeAsset(asset, bytes) {
  delete asset.body.base64;
  asset.body.archivePath = "files/" + asset.body.sha256;
  asset.body.receipt.bodyFormat = "ORIGINAL_BINARY_BYTES_ARCHIVE";
  Object.defineProperty(asset.body, "bytes", {
    value: new Uint8Array(bytes),
    enumerable: false,
    configurable: true,
  });
  return asset;
}

async function capturedNativePptx(id = "p".repeat(22)) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
  );
  zip.file(
    "ppt/presentation.xml",
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
  );
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Original source slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );
  const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "STORE",
    }),
    asset = capturedNativePng(id),
    sha256 = createHash("sha256").update(bytes).digest("hex"),
    canonicalUrl =
      "https://d3c33hcgiwev3.cloudfront.net/synthetic/native-slides.pptx",
    mime =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  for (const envelope of [asset.metadata, asset.stability.metadata]) {
    envelope.elements[0].name = "Native source slides.PPTX";
    envelope.elements[0].typeName = "generic";
    envelope.elements[0].url.url = canonicalUrl;
  }
  Object.assign(asset.body, { size: bytes.length, sha256, mime, canonicalUrl });
  Object.assign(asset.body.receipt, {
    bytes: bytes.length,
    sha256,
    mime,
    canonicalUrl,
  });
  return archivedNativeAsset(asset, bytes);
}

test("bound archive originals verify actual PNG and PPTX bytes while keeping native filenames separate from CML labels", async () => {
  const png = capturedNativePng(),
    cases = [
      {
        asset: archivedNativeAsset(png, Buffer.from(png.body.base64, "base64")),
        tag: "img",
        label: "Screenshot author label",
        name: "image.png",
      },
      {
        asset: await capturedNativePptx(),
        tag: "asset",
        label: "Module 1 handout",
        name: "Native source slides.PPTX",
      },
    ];
  for (const { asset, tag, label, name } of cases) {
    const f = fixture(
      "supplement",
      cml(
        "Read <" +
          tag +
          ' assetId="' +
          asset.assetId +
          '" filename="' +
          label +
          '"/>',
      ),
    );
    f.fp.payload.directAssetEvidence = {
      method: "BOUND_CML_ASSET_METADATA_AND_BODY",
      assets: [asset],
      missingPointers: [],
      failures: [],
    };
    const result = await directReadingPayloadV1(f.fp, f.bound, f.source);
    assert.equal(result.complete, true, name);
    assert.equal(f.fp.payload.directDataEvidence.assetsBodyVerified, true);
    assert.equal(f.fp.payload.assetDetails[0].sha256, asset.body.sha256);
    assert.equal(
      f.fp.payload.assetDetails[0].name,
      name,
      "Compare must receive the native extension, not the CML display label",
    );
    assert.equal(f.fp.payload.assetDetails[0].referenceName, label);
    assert.equal(asset.body.base64, undefined);
    assert.equal(
      asset.body.receipt.bodyFormat,
      "ORIGINAL_BINARY_BYTES_ARCHIVE",
    );
    assert.equal(JSON.parse(JSON.stringify(asset)).body.bytes, undefined);
  }
});

test("archive references without originals, smuggled paths and byte mutations cannot verify native readings", async () => {
  for (const mode of [
    "noBytes",
    "pathTraversal",
    "encodedPath",
    "wrongHashPath",
    "size",
    "mixedTransport",
    "wrongReceiptFormat",
    "corruptAfterHash",
  ]) {
    const original = capturedNativePng(),
      asset = archivedNativeAsset(
        original,
        Buffer.from(original.body.base64, "base64"),
      ),
      f = fixture("supplement", cml('<img assetId="' + asset.assetId + '"/>'));
    if (mode === "noBytes") delete asset.body.bytes;
    if (mode === "pathTraversal")
      asset.body.archivePath = "files/../" + asset.body.sha256;
    if (mode === "encodedPath")
      asset.body.archivePath = "files/%2f" + asset.body.sha256;
    if (mode === "wrongHashPath")
      asset.body.archivePath = "files/" + "f".repeat(64);
    if (mode === "size") asset.body.size++;
    if (mode === "mixedTransport")
      asset.body.base64 = Buffer.from(asset.body.bytes).toString("base64");
    if (mode === "wrongReceiptFormat")
      asset.body.receipt.bodyFormat = "ORIGINAL_BINARY_BYTES_BASE64";
    if (mode === "corruptAfterHash")
      asset.body.bytes[asset.body.bytes.length - 1] ^= 1;
    f.fp.payload.directAssetEvidence = {
      method: "BOUND_CML_ASSET_METADATA_AND_BODY",
      assets: [asset],
      missingPointers: [],
      failures: [],
    };
    const result = await directReadingPayloadV1(f.fp, f.bound, f.source);
    assert.equal(result.complete, false, mode);
    assert.equal(
      f.fp.payload.directDataEvidence.assetsBodyVerified,
      false,
      mode,
    );
    assert.equal(f.fp.payload.assetDetails[0].bodyVerified, false, mode);
    if (mode === "corruptAfterHash")
      assert(result.reasons.includes("DIRECT_ASSET_BODY_HASH_INVALID"));
  }
});

test("unrelated binary evidence cannot be attached to a text-only draft to claim complete media capture", async () => {
  const f = fixture();
  f.fp.payload.directAssetEvidence = {
    method: "BOUND_CML_ASSET_METADATA_AND_BODY",
    assets: [capturedNativePng()],
    missingPointers: [],
    failures: [],
  };
  assert.equal(
    (await directReadingPayloadV1(f.fp, f.bound, f.source)).complete,
    false,
  );
});

test("forged binary flags, hashes, foreign IDs, metadata mutations and MIME mismatches never verify a reading", async () => {
  for (const mode of [
    "hash",
    "base64",
    "size",
    "mime",
    "metadataId",
    "freshContent",
    "route",
    "query",
    "bodyFormat",
    "extraAsset",
    "missingBody",
    "missingPointer",
  ]) {
    const id = "m".repeat(22),
      f = fixture(
        "supplement",
        cml('Current <img assetId="' + id + '"/> image'),
      ),
      asset = capturedNativePng(id);
    f.fp.payload.directAssetEvidence = {
      method: "BOUND_CML_ASSET_METADATA_AND_BODY",
      assets: [asset],
      missingPointers: [],
      failures: [],
    };
    if (mode === "hash")
      asset.body.sha256 = asset.body.receipt.sha256 = "f".repeat(64);
    if (mode === "base64")
      asset.body.base64 = "!".repeat(asset.body.base64.length);
    if (mode === "size") asset.body.size++;
    if (mode === "mime")
      asset.body.mime = asset.body.receipt.mime = "application/pdf";
    if (mode === "metadataId") asset.metadata.elements[0].id = "x".repeat(22);
    if (mode === "freshContent")
      asset.stability.metadata.elements[0].contentVersion++;
    if (mode === "route")
      asset.metadataReceipt.requestPath = "/api/assets.v1/" + id;
    if (mode === "query")
      asset.metadataReceipt.requestQuery[0][1] = "x".repeat(22);
    if (mode === "bodyFormat") asset.body.receipt.bodyFormat = "HASH_ONLY";
    if (mode === "extraAsset")
      f.fp.payload.directAssetEvidence.assets.push(
        capturedNativePng("x".repeat(22)),
      );
    if (mode === "missingBody") delete asset.body;
    if (mode === "missingPointer")
      f.fp.payload.directAssetEvidence.missingPointers.push({ tag: "img" });
    const result = await directReadingPayloadV1(f.fp, f.bound, f.source);
    assert.equal(result.complete, false, mode);
    assert.equal(
      f.fp.payload.directDataEvidence.assetsBodyVerified,
      false,
      mode,
    );
    assert.equal(f.fp.payload.assetDetails[0].assetId, id, mode);
  }
});

test("missing source image pointers and unresolved native attachment IDs remain visible, without guessed URLs", async () => {
  for (const markup of [
    '<img alt=""/>',
    '<asset id="' +
      "m".repeat(22) +
      '" name="Original deck" extension="pptx"/>',
  ]) {
    const f = fixture("supplement", cml(markup)),
      result = await directReadingPayloadV1(f.fp, f.bound, f.source);
    assert.equal(result.complete, false);
    assert.equal(f.fp.payload.assetDetails.length, 1);
    assert.equal(f.fp.payload.assetDetails[0].url, "");
    if (markup.includes("alt"))
      assert(result.reasons.includes("DIRECT_CML_MEDIA_REFERENCE_MISSING"));
    else {
      assert.equal(f.fp.payload.assetDetails[0].assetId, "m".repeat(22));
      assert.equal(f.fp.payload.assetDetails[0].name, "Original deck");
    }
  }
});

test("independent CML media inventory ignores comments and CDATA while retaining namespaced native IDs", () => {
  const id = "m".repeat(22),
    result = directCmlMediaInventoryV1(
      '<co-content><!-- <img assetId="wrong"/> --><text><![CDATA[<img assetId="wrong"/>]]></text><media:img xmlns:media="urn:synthetic" assetId="' +
        id +
        '"/></co-content>',
    );
  assert.equal(result.valid, true);
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].id, id);
  for (const invalid of [
    '<co-content><img assetId="x" assetId="y"/></co-content>',
    "<co-content><text></co-content>",
    "<!DOCTYPE co-content><co-content/>",
    "<co-content/><co-content/>",
  ])
    assert.equal(directCmlMediaInventoryV1(invalid).valid, false, invalid);
});

function nativeDefinition(kind = "mcq") {
  return {
    id: atomId + "~" + "q".repeat(22) + "@1",
    definition: {
      typeName: kind,
      definition: {
        prompt: cml("Choose the exact source answer"),
        options: [
          { id: "left", display: cml("Left"), feedback: cml("Feedback") },
          {
            id: "right",
            display: cml("Right"),
            feedback: cml("Other feedback"),
          },
        ],
        ...(kind === "mcq"
          ? { correctOption: "left" }
          : { correctOptions: ["left", "right"], allowPartialScoring: true }),
        shuffleOptions: false,
      },
    },
  };
}
function assessmentFixture(kind = "mcq") {
  const f = fixture("staffGraded"),
    candidate = { id: atomId + "~" + localId, ordinal: 1, label: "" };
  const definition = nativeDefinition(kind),
    parser =
      kind === "mcq"
        ? parseCourseraMcqDefinitionV61524
        : parseCourseraCheckboxDefinitionDirectV1;
  const question = parser(definition, candidate);
  question.observationMethod = "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION";
  const coverage = assessmentCaptureCoverageV613(
    [question],
    1,
    "EXACT_AUTHORING_DRAFT_PARTS",
    { declaredContentParts: 1 },
  );
  const assessment = {
    declaredQuestionCount: 1,
    questionCount: 1,
    questions: [question],
    captureCompleteness: coverage,
  };
  f.fp.payload.assessmentApiEvidence = {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId,
    itemId: f.fp.id,
    assignmentId: atomId,
    inventory: [candidate],
    groups: [{ id: candidate.id, questions: [definition.id] }],
    groupStability: [
      {
        id: candidate.id,
        stable: true,
        group: { id: candidate.id, questions: [definition.id] },
        receipt: {
          resource: "authoringAssignmentQuestionGroups.v1",
          id: candidate.id,
          status: 200,
          bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
          originalResponseSha256: "b".repeat(64),
          sha256: "b".repeat(64),
          requestPath:
            "/api/authoringAssignmentQuestionGroups.v1/" + candidate.id,
        },
      },
    ],
    questionDefinitions: [definition],
    receipts: [
      {
        resource: "authoringAssignmentQuestionGroups.v1",
        id: candidate.id,
        status: 200,
        bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
        originalResponseSha256: "b".repeat(64),
        sha256: "b".repeat(64),
        requestPath:
          "/api/authoringAssignmentQuestionGroups.v1/" + candidate.id,
      },
      {
        resource: "authoringAssignmentMachineEvaluableQuestions.v1",
        id: definition.id,
        status: 200,
        bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
        originalResponseSha256: "b".repeat(64),
        sha256: "b".repeat(64),
        requestPath:
          "/api/authoringAssignmentMachineEvaluableQuestions.v1/" +
          definition.id,
      },
    ],
  };
  return {
    ...f,
    assessment,
    inventory: {
      complete: true,
      candidates: [candidate],
      unsupportedParts: [],
    },
  };
}

test("native MCQ and checkbox keys complete only with exact ordered root/group/versioned definition joins", () => {
  for (const kind of ["mcq", "checkbox"]) {
    const f = assessmentFixture(kind),
      contract = directAssessmentContractV1(
        f.fp,
        f.assessment,
        f.inventory,
        f.bound,
      );
    assert.equal(contract.status, "COMPLETE_BOUND_DRAFT_ASSESSMENT");
    assert.equal(contract.complete, true);
    assert.deepEqual(f.fp.payload.directDataEvidence.orderedGroupIds, [
      atomId + "~" + localId,
    ]);
    assert.equal(
      f.fp.payload.directDataEvidence.sourceState,
      "AUTHORING_DRAFT",
    );
  }
});

test("partial orders, wrong keys, missing records and unsupported variants never pass the assessment contract", () => {
  for (const mode of [
    "wrongOrder",
    "wrongKey",
    "missingRaw",
    "variant",
    "wrongProvenance",
    "missingFreshGroup",
    "changedFreshGroup",
    "freshGroupUnstable",
    "freshGroupReceipt",
    "missingDefinitionReceipt",
  ]) {
    const f = assessmentFixture();
    if (mode === "wrongOrder") f.inventory.candidates[0].ordinal = 2;
    if (mode === "wrongKey")
      f.assessment.questions[0].correctAnswers = ["A fabricated answer"];
    if (mode === "missingRaw")
      f.fp.payload.assessmentApiEvidence.questionDefinitions = [];
    if (mode === "variant")
      f.fp.payload.assessmentApiEvidence.groups[0].questions.push(
        "unexpected@1",
      );
    if (mode === "wrongProvenance")
      f.assessment.questions[0].observationMethod =
        "AUTHORING_API_MATCHED_TO_LIVE_OUTLINE";
    if (mode === "missingFreshGroup")
      f.fp.payload.assessmentApiEvidence.groupStability = [];
    if (mode === "changedFreshGroup")
      f.fp.payload.assessmentApiEvidence.groupStability[0].group.questions = [
        atomId + "~" + "q".repeat(22) + "@2",
      ];
    if (mode === "freshGroupUnstable")
      f.fp.payload.assessmentApiEvidence.groupStability[0].stable = false;
    if (mode === "freshGroupReceipt")
      f.fp.payload.assessmentApiEvidence.groupStability[0].receipt.sha256 =
        "d".repeat(64);
    if (mode === "missingDefinitionReceipt")
      f.fp.payload.assessmentApiEvidence.receipts.pop();
    assert.equal(
      directAssessmentContractV1(f.fp, f.assessment, f.inventory, f.bound)
        .complete,
      false,
    );
  }
});

test("checkbox source keys must be unique exact option IDs; media-only or unsupported definitions remain unparsed", () => {
  const candidate = { id: atomId + "~" + localId, ordinal: 1, label: "" };
  const correct = parseCourseraCheckboxDefinitionDirectV1(
    nativeDefinition("checkbox"),
    candidate,
  );
  assert.deepEqual(correct.answerKeyEvidence, {
    method: "EXACT_CORRECT_OPTION_ID_SET",
    correctOptions: ["left", "right"],
  });
  for (const mode of ["unknownKey", "duplicateKey", "wrongTag", "image"]) {
    const raw = nativeDefinition("checkbox");
    if (mode === "unknownKey")
      raw.definition.definition.correctOptions = ["absent"];
    if (mode === "duplicateKey")
      raw.definition.definition.correctOptions = ["left", "left"];
    if (mode === "wrongTag") raw.definition.typeName = "unverified-type";
    if (mode === "image")
      raw.definition.definition.prompt = cml(
        '<img src="https://fixture.invalid/prompt.png"/>',
      );
    assert.equal(parseCourseraCheckboxDefinitionDirectV1(raw, candidate), null);
  }
});

test("empty structures require actual empty module/lesson source nodes, not arbitrary missing content", () => {
  for (const role of ["module", "lesson", "unknown", "contentPresent"]) {
    const node =
      role === "lesson"
        ? {
            id: "empty1",
            name: "Empty lesson",
            trackId: "track1",
            elements: [],
          }
        : {
            id: "empty1",
            name: "Empty module",
            description: "",
            learningObjectives: [],
            timeCommitment: 0,
            elements: [],
          };
    if (role === "unknown") delete node.timeCommitment;
    if (role === "contentPresent")
      node.content = { typeName: "unknown", definition: {} };
    const fp = {
      id: "empty1",
      type: "Unknown",
      typeName: "",
      payload: {
        directDataSources: {
          materials: {
            rootCourseId: courseId,
            leaf: node,
            ancestorIds: role === "lesson" ? ["module1"] : [],
          },
          receipts: {
            materials: {
              resource: "authoringCourseMaterials.v1",
              id: courseId,
              status: 200,
              bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
              requestPath: "/api/authoringCourseMaterials.v1/" + courseId + "/",
              originalResponseSha256: "d".repeat(64),
            },
            stability: { stable: true },
          },
        },
      },
    };
    const contract = directEmptyStructureContractV1(
      fp,
      { courseId, stableSource: true },
      node,
    );
    assert.equal(contract.complete, role === "module" || role === "lesson");
    if (contract.complete)
      assert.equal(contract.status, "COMPLETE_EMPTY_STRUCTURE");
  }
});

test("widgets are accounted without inventing body verification or editor observations", () => {
  const f = fixture();
  f.fp.typeName = "ungradedWidget";
  f.fp.type = "Plugin";
  const contract = directUnsupportedContractV1(
    f.fp,
    "DIRECT_WIDGET_BODY_UNVERIFIED",
    f.bound,
  );
  assert.equal(contract.status, "ACCOUNTED_EXTERNAL_TARGET_ONLY");
  assert.equal(contract.complete, false);
  assert.equal(contract.externalBodyVerified, false);
  assert.equal(contract.accounted, true);
  assert.equal(f.fp.payload.nativeAssignment, undefined);
});

function discussionFixture(
  markup = "<co-content><text>Discuss the observed topic</text></co-content>",
) {
  const f = fixture();
  f.fp.type = "Discussion";
  f.fp.typeName = "discussionPrompt";
  f.bound.atom.draft.content = {
    typeName: "discussionPromptDraft",
    definition: {
      promptType: {
        typeName: "questionPerSession",
        definition: {
          title: "Observed discussion title",
          promptPermissions: { viewAnswersBeforeReplying: false },
          prompt: {
            typeName: "cml",
            definition: { dtdId: "discussion/1", value: markup },
          },
        },
      },
    },
  };
  f.sources.receipts.stability.atom = structuredClone(f.sources.atom);
  return f;
}

test("bound discussions capture exact authoring prompt and permissions without responses or editor receipts", async () => {
  const f = discussionFixture();
  const source = directDraftDiscussionSourceV1(f.bound);
  const result = await directDiscussionPayloadV1(f.fp, f.bound, source);
  assert.equal(result.status, "COMPLETE_BOUND_DRAFT_DISCUSSION");
  assert.equal(result.complete, true);
  assert.equal(f.fp.payload.discussionTitle, source.title);
  assert.strictEqual(
    f.fp.payload.discussionPromptPermissions,
    source.promptPermissions,
  );
  assert.strictEqual(f.fp.payload.directDraftDiscussion, source.rawDefinition);
  assert.equal(f.fp.payload.textSample, "Discuss the observed topic");
  assert.equal(
    f.fp.payload.textScopeKind,
    "bound-authoring-draft-discussion-cml",
  );
  assert.equal(f.fp.payload.directDataEvidence.assetsBodyVerified, true);
  assert.equal(f.fp.payload.textCaptureEvidence, undefined);
  assert.equal(f.fp.payload.responses, undefined);
});

test("discussion media, changed permissions and foreign source bindings stay incomplete", async () => {
  for (const mode of [
    "media",
    "changedPermissions",
    "foreignRelation",
    "missingReceipt",
    "malformedXml",
  ]) {
    const f = discussionFixture(
      mode === "media"
        ? '<co-content><img src="https://example.test/unfetched.png"/></co-content>'
        : mode === "malformedXml"
          ? "<co-content><text>Broken</co-content>"
          : undefined,
    );
    const source = structuredClone(directDraftDiscussionSourceV1(f.bound));
    if (mode === "changedPermissions")
      source.rawDefinition.promptPermissions.viewAnswersBeforeReplying = true;
    if (mode === "foreignRelation")
      f.sources.relation.elements[0].branchRelationMap[
        courseId + "~item1"
      ].itemId = "other";
    if (mode === "missingReceipt") delete f.sources.receipts.stability.receipt;
    const result = await directDiscussionPayloadV1(f.fp, f.bound, source);
    assert.equal(result.complete, false, mode);
    if (mode === "media") {
      assert(result.reasons.includes("DIRECT_DISCUSSION_ASSETS_UNRESOLVED"));
      assert.equal(f.fp.payload.directDataEvidence.assetsBodyVerified, false);
    }
  }
});

function emptyAssessmentFixture() {
  const f = fixture("staffGraded"),
    sourceCml = (text) => ({
      typeName: "cml",
      definition: {
        dtdId: "assess/1",
        value: "<co-content><text>" + text + "</text></co-content>",
      },
    });
  const definition = {
    parts: [],
    configuration: {
      isGraded: true,
      attemptConfiguration: { submissionLimitForEachAttempt: 1 },
    },
    introduction: sourceCml("Instructions retained"),
    reviewCriteria: sourceCml("Criteria retained"),
    passingFraction: 0.8,
    assignmentLevelRubrics: [],
  };
  f.bound.atom.draft.content = { typeName: "staffGradedDraft", definition };
  f.sources.receipts.stability.atom = structuredClone(f.sources.atom);
  const inventory = directDraftAssessmentInventoryV1(f.bound);
  f.fp.payload.directAssessmentInventory = inventory;
  f.fp.payload.assessmentApiEvidence = {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId,
    itemId: f.fp.id,
    assignmentId: atomId,
    inventory: [],
    rawParts: [],
    unsupportedParts: [],
    groups: [],
    questionDefinitions: [],
    receipts: [],
    groupStability: [],
    failures: [],
  };
  const assessment = {
    declaredQuestionCount: 0,
    questionCount: 0,
    answerEvidenceQuestionCount: 0,
    questions: [],
    ...Object.fromEntries(
      [
        "configuration",
        "introduction",
        "reviewCriteria",
        "passingFraction",
        "assignmentLevelRubrics",
      ].map((key) => [key, definition[key]]),
    ),
    captureCompleteness: assessmentCaptureCoverageV613([], 0, "AUTHORING_API", {
      declaredContentParts: 0,
    }),
  };
  return { ...f, inventory, assessment };
}

test("explicit zero-part assessments retain complete source emptiness without fabricating question or answer coverage", () => {
  const f = emptyAssessmentFixture();
  assert.equal(
    f.assessment.captureCompleteness.questionCoverageComplete,
    false,
    "The generic zero-count parser does not establish source emptiness",
  );
  const result = directAssessmentContractV1(
    f.fp,
    f.assessment,
    f.inventory,
    f.bound,
  );
  assert.equal(result.complete, true);
  assert.equal(result.status, "COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT");
  assert.equal(f.fp.payload.explicitEmptyAssessmentEvidence.sourceEmpty, true);
  assert.equal(
    f.fp.payload.explicitEmptyAssessmentEvidence.answerKeyApplicable,
    false,
  );
  assert.equal(
    f.assessment.captureCompleteness.answerKeyApplicability,
    "NOT_APPLICABLE_NO_QUESTIONS",
  );
  assert.deepEqual(f.assessment.questions, []);
  assert.deepEqual(f.fp.payload.directDataEvidence.orderedGroupIds, []);
  assert.equal(f.assessment.configuration.isGraded, true);
});

test("missing parts, discarded settings, hidden questions and unfetched introduction media cannot claim explicit empty capture", () => {
  for (const mode of [
    "missingParts",
    "freshParts",
    "question",
    "settings",
    "failure",
    "media",
    "rubric",
    "missingRawParts",
    "wrongItem",
  ]) {
    const f = emptyAssessmentFixture();
    if (mode === "missingParts")
      delete f.bound.atom.draft.content.definition.parts;
    if (mode === "freshParts")
      f.sources.receipts.stability.atom.elements[0].draft.content.definition.parts.push(
        { typeName: "storedQuestionGroupPart", definition: { id: localId } },
      );
    if (mode === "question") f.assessment.questions.push({ id: "1" });
    if (mode === "settings") f.assessment.configuration = { isGraded: false };
    if (mode === "failure")
      f.fp.payload.assessmentApiEvidence.failures.push({
        reason: "SOURCE_READ_FAILED",
      });
    if (mode === "media")
      f.bound.atom.draft.content.definition.introduction.definition.value =
        '<co-content><img src="https://example.test/body.png"/></co-content>';
    if (mode === "rubric")
      f.bound.atom.draft.content.definition.assignmentLevelRubrics.push({
        unknown: "source rubric",
      });
    if (mode === "missingRawParts")
      delete f.fp.payload.assessmentApiEvidence.rawParts;
    if (mode === "wrongItem")
      f.fp.payload.assessmentApiEvidence.itemId = "other";
    assert.equal(
      directAssessmentContractV1(f.fp, f.assessment, f.inventory, f.bound)
        .complete,
      false,
      mode,
    );
  }
});
