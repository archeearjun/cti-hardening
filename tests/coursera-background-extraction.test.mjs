import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { attachCourseraArchiveFileBytes } from "../src/domain/coursera-capture-file.ts";
import { directWidgetContractV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import {
  widgetFixture,
  WIDGET_COURSE,
  WIDGET_SLUG,
} from "./coursera-direct-widget-fixtures.mjs";
import {
  evaluateCourseraCapture,
  parseCourseraShellUrl,
} from "../src/domain/coursera-background-extraction.ts";

function directWidgetCapture() {
  const { fp, bound } = widgetFixture();
  directWidgetContractV1(fp, bound);
  const materials = {
    elements: [
      {
        id: WIDGET_COURSE,
        material: {
          elements: [
            {
              id: "widget-module",
              name: "Module",
              elements: [
                {
                  id: fp.id,
                  name: fp.name,
                  atomId: fp.atomId,
                  contentId: fp.contentId,
                  content: { typeName: "ungradedWidget", definition: {} },
                },
              ],
            },
          ],
        },
        conflictMetadata: { version: 1, courseBranchVersion: 1 },
      },
    ],
    paging: {},
  };
  const materialHash = modelHash(materials.elements[0]);
  return {
    page: {
      courseId: WIDGET_COURSE,
      url: `https://www.coursera.org/teach/${WIDGET_SLUG}/${WIDGET_COURSE}/content/edit`,
    },
    meta: {
      baseFingerprintCount: 1,
      directDataCapture: {
        mode: "BOUND_AUTHORING_DRAFT_API",
        version: 1,
        sourceStable: true,
        acquisitionComplete: true,
        wholeCourseVerified: false,
        initialMaterialHash: materialHash,
        finalMaterialHash: materialHash,
        materialVersion: 1,
        courseBranchVersion: 1,
        materials,
        finalMaterials: structuredClone(materials),
        materialsReceipt: receipt("authoringCourseMaterials.v1", WIDGET_COURSE),
        finalMaterialsReceipt: receipt(
          "authoringCourseMaterials.v1",
          WIDGET_COURSE,
        ),
      },
      captureAccounting: {
        inventoryCount: 1,
        completeCount: 0,
        unresolvedCount: 1,
        unknownCount: 0,
        unvisitedCount: 0,
        externalContentUnverifiedCount: 1,
        allInventoryAccounted: true,
        noSilentMisses: true,
        complete: false,
      },
    },
    fingerprints: [fp],
  };
}

test("bound widget configuration remains incomplete while its source proof validates independently", () => {
  const capture = directWidgetCapture(),
    verdict = evaluateCourseraCapture(capture, WIDGET_COURSE);
  assert.equal(verdict.complete, false);
  assert.ok(verdict.reasons.includes("PLUGIN_BODY_UNVERIFIED:WidgetA"));
  assert.ok(
    !verdict.reasons.some((reason) =>
      reason.includes("DIRECT_WIDGET_PROVIDER_SOURCE_INVALID"),
    ),
  );
});

test("incomplete widget source claims cannot bypass independent binding, hash or target checks", () => {
  const changes = [
    [
      "wrong finder course",
      (fp, raw) => {
        raw.final.receipt.requestQuery.find(
          (pair) => pair[0] === "courseId",
        )[1] = "other-course";
      },
    ],
    [
      "duplicate finder selector",
      (fp, raw) => {
        raw.final.receipt.requestQuery.push(["courseId", WIDGET_COURSE]);
      },
    ],
    [
      "action request",
      (fp, raw) => {
        raw.initial.receipt.requestQuery.push(["action", "getConfiguration"]);
      },
    ],
    [
      "wrong provider model",
      (fp, raw) => {
        raw.initial.model.elements[0].id = "x".repeat(22);
      },
    ],
    [
      "provider changed independently",
      (fp, raw) => {
        raw.final.model.elements[0].metadata.updatedAt++;
      },
    ],
    [
      "both provider copies edited without source hash",
      (fp, raw) => {
        for (const read of [raw.initial, raw.final])
          read.model.elements[0].draft.configuration.customSetting =
            "edited after capture";
      },
    ],
    [
      "forged target",
      (fp, raw) => {
        raw.targets[0].url = "https://other.example.test/not-observed";
      },
    ],
    [
      "linked example promoted to target",
      (fp, raw) => {
        raw.targets[0].url =
          raw.initial.model.linked[
            "authoringWidgetSummaries.v1"
          ][0].configurationExamples[0].configuration.url;
      },
    ],
    [
      "retained credentials",
      (fp, raw) => {
        raw.initial.model.elements[0].draft.configuration.access_token =
          "synthetic-secret";
      },
    ],
    [
      "failed current atom check",
      (fp) => {
        fp.payload.directResumeRevalidation = { verified: false };
      },
    ],
    [
      "source claim without retained proof",
      (fp) => {
        delete fp.payload.directWidgetProviderEvidence;
      },
    ],
    [
      "provider proof without contract",
      (fp) => {
        delete fp.captureContract;
        delete fp.payload.captureContract;
      },
    ],
    [
      "provider proof claims external body",
      (fp) => {
        fp.captureContract.externalBodyVerified = true;
      },
    ],
  ];
  for (const [name, change] of changes) {
    const capture = directWidgetCapture(),
      fp = capture.fingerprints[0];
    change(fp, fp.payload.directWidgetProviderEvidence);
    const verdict = evaluateCourseraCapture(capture, WIDGET_COURSE);
    assert.equal(verdict.complete, false, name);
    assert.ok(
      verdict.reasons.includes("DIRECT_WIDGET_PROVIDER_SOURCE_INVALID:WidgetA"),
      name,
    );
  }
});

test("Coursera shell URL is normalized and rejects non-Coursera targets", () => {
  const target = parseCourseraShellUrl(
    "https://www.coursera.org/teach/course-name/Abc_def-123/content/item/supplement/x",
  );
  assert.equal(
    target.shellUrl,
    "https://www.coursera.org/teach/course-name/Abc_def-123/content/edit",
  );
  assert.equal(target.courseId, "Abc_def-123");
  assert.throws(() =>
    parseCourseraShellUrl("https://example.com/teach/a/b/content"),
  );
});

test("strict capture cannot be complete without an explicit completeness contract", () => {
  const verdict = evaluateCourseraCapture({
    page: { courseId: "course-123" },
    meta: { baseFingerprintCount: 1 },
    fingerprints: [{ id: "r1", type: "Reading", payload: {} }],
  });
  assert.equal(verdict.complete, false);
  assert.ok(verdict.reasons.includes("EXPLICIT_COMPLETENESS_CONTRACT_MISSING"));
});

test("strict capture passes only when inventory and evidence reconcile", () => {
  const verdict = evaluateCourseraCapture(
    {
      page: { courseId: "course-123" },
      meta: {
        baseFingerprintCount: 2,
        captureAccounting: {
          inventoryCount: 2,
          completeCount: 2,
          unresolvedCount: 0,
          unknownCount: 0,
          unvisitedCount: 0,
          allInventoryAccounted: true,
          noSilentMisses: true,
          complete: true,
          terminalAccountedIncompleteCount: 0,
          externalContentUnverifiedCount: 0,
        },
        activeSpaCrawl: {
          timeBudgetExhausted: false,
          unvisitedTargetIds: [],
          unvisitedDueToBudget: 0,
        },
        wholeRunDeadlineReached: false,
      },
      fingerprints: [
        {
          id: "r1",
          type: "Reading",
          captureContract: { complete: true, status: "COMPLETE_READING" },
          payload: {},
        },
        {
          id: "a1",
          type: "Assignment",
          captureContract: { complete: true, status: "COMPLETE_ASSESSMENT" },
          payload: {
            structuredAssessment: {
              questions: [{}, {}],
              captureCompleteness: {
                declared: 2,
                captured: 2,
                questionCoverageComplete: true,
                requiredAnswerCoverageComplete: true,
              },
            },
          },
        },
      ],
    },
    "course-123",
  );
  assert.equal(verdict.complete, true);
  assert.deepEqual(verdict.reasons, []);
});

test("cross-origin plugin target is accounted but never certified complete", () => {
  const verdict = evaluateCourseraCapture({
    page: { courseId: "course-123" },
    meta: {
      captureAccounting: {
        inventoryCount: 1,
        completeCount: 0,
        unresolvedCount: 1,
        unknownCount: 0,
        unvisitedCount: 0,
        allInventoryAccounted: true,
        noSilentMisses: true,
        complete: false,
        terminalAccountedIncompleteCount: 1,
        externalContentUnverifiedCount: 1,
      },
    },
    fingerprints: [
      {
        id: "p1",
        type: "Plugin",
        captureContract: {
          complete: false,
          status: "ACCOUNTED_EXTERNAL_TARGET_ONLY",
          externalBodyVerified: false,
        },
        payload: {},
      },
    ],
  });
  assert.equal(verdict.complete, false);
  assert.ok(verdict.reasons.includes("PLUGIN_BODY_UNVERIFIED:p1"));
});

test("course identity mismatch blocks certification", () => {
  const verdict = evaluateCourseraCapture(
    {
      page: { courseId: "wrong" },
      meta: {
        captureAccounting: {
          inventoryCount: 1,
          completeCount: 1,
          unresolvedCount: 0,
          unknownCount: 0,
          unvisitedCount: 0,
          allInventoryAccounted: true,
          noSilentMisses: true,
          complete: true,
        },
      },
      fingerprints: [{ id: "r1", type: "Reading", payload: {} }],
    },
    "expected",
  );
  assert.equal(verdict.complete, false);
  assert.match(verdict.reasons.join("\n"), /COURSE_ID_MISMATCH/);
});

const sourceHash = (value) => createHash("sha256").update(value).digest("hex");
const modelHash = (value) => sourceHash(directCanonicalSourceTextV1(value));
const directCourseId = "Synthetic_course_branch_123",
  directSlug = "synthetic-course",
  directAtomId = "a".repeat(22);
function receipt(resource, id) {
  const hash = sourceHash(resource + "/" + id);
  return {
    resource,
    id,
    status: 200,
    sha256: hash,
    originalResponseSha256: hash,
    bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    requestPath:
      "/api/" + resource + "/" + encodeURIComponent(id).replace(/%40/gi, "@"),
  };
}
function attachMaterials(capture, leaf) {
  const elements =
    leaf.content === undefined
      ? [leaf]
      : [{ id: "module-1", elements: [leaf] }];
  const materials = {
    elements: [
      {
        id: directCourseId,
        material: { elements },
        conflictMetadata: { version: 1, courseBranchVersion: 1 },
      },
    ],
    paging: {},
  };
  const mode = capture.meta.directDataCapture;
  mode.materials = materials;
  mode.finalMaterials = structuredClone(materials);
  mode.initialMaterialHash = modelHash(materials.elements[0]);
  mode.finalMaterialHash = mode.initialMaterialHash;
  mode.materialsReceipt = receipt(
    "authoringCourseMaterials.v1",
    directCourseId,
  );
  mode.finalMaterialsReceipt = receipt(
    "authoringCourseMaterials.v1",
    directCourseId,
  );
  return capture;
}
function directReadingCapture() {
  const id = "reading-1",
    contentId = "atom~" + directAtomId;
  const cml = {
    typeName: "cml",
    definition: {
      dtdId: "supplement/1",
      value: "<co-content><p>Current draft body</p></co-content>",
    },
  };
  const assetId = "b".repeat(22) + "@1";
  const draft = {
    content: {
      typeName: "supplementDraft",
      definition: { assetId, content: cml },
    },
  };
  const atom = {
    id: directAtomId,
    contentId,
    status: { typeName: "draftAtomStatus" },
    draft,
    published: {
      content: {
        typeName: "supplement",
        definition: { assetId: "c".repeat(22) + "@1" },
      },
    },
    storedAtomVersion: 1,
    metadata: { updatedAt: 1700000000000 },
  };
  const relation = {
    id: directAtomId,
    atomId: directAtomId,
    branchRelationMap: {
      [directCourseId + "~" + id]: {
        courseId: directCourseId,
        itemId: id,
        courseSlug: directSlug,
      },
    },
  };
  const hash = sourceHash("full original materials");
  const capture = {
    schemaVersion: 35,
    page: {
      courseId: directCourseId,
      url: `https://www.coursera.org/teach/${directSlug}/${directCourseId}/content/edit`,
    },
    meta: {
      baseFingerprintCount: 1,
      directDataCapture: {
        mode: "BOUND_AUTHORING_DRAFT_API",
        version: 1,
        sourceStable: true,
        acquisitionComplete: true,
        wholeCourseVerified: true,
        initialMaterialHash: hash,
        finalMaterialHash: hash,
        materialVersion: 1,
        courseBranchVersion: 1,
      },
      captureAccounting: {
        inventoryCount: 1,
        completeCount: 1,
        unresolvedCount: 0,
        unknownCount: 0,
        unvisitedCount: 0,
        allInventoryAccounted: true,
        noSilentMisses: true,
        complete: true,
      },
    },
    fingerprints: [
      {
        id,
        type: "Reading",
        atomId: directAtomId,
        contentId,
        captureContract: {
          complete: true,
          status: "COMPLETE_BOUND_DRAFT_READING",
        },
        payload: {
          textSample: "Current draft body",
          textLength: "Current draft body".length,
          textSha256: sourceHash("Current draft body"),
          textScopeKind: "bound-authoring-draft-cml",
          textCaptureTruncated: false,
          directDraftCml: cml,
          directDataEvidence: {
            method: "BOUND_AUTHORING_DRAFT_API",
            courseId: directCourseId,
            itemId: id,
            atomId: directAtomId,
            contentId,
            sourceState: "AUTHORING_DRAFT",
            stableSource: true,
            draftHash: modelHash(draft),
            storedAtomVersion: 1,
            updatedAt: 1700000000000,
            dtdId: "supplement/1",
            assetId,
            rawCmlLength: cml.definition.value.length,
            rawCmlSha256: sourceHash(cml.definition.value),
            plainTextLength: "Current draft body".length,
            assetReferenceCount: 0,
            assetsBodyVerified: true,
            unresolvedAssetReferences: [],
          },
          directDataSources: {
            atom: { elements: [atom], paging: {} },
            relation: { elements: [relation], paging: {} },
            receipts: {
              atom: receipt("authoringAtoms.v2", directAtomId),
              relation: receipt(
                "authoringItemContentRelations.v1",
                directAtomId,
              ),
              stability: {
                stable: true,
                draftHash: modelHash(draft),
                storedAtomVersion: 1,
                updatedAt: 1700000000000,
                atom: { elements: [structuredClone(atom)], paging: {} },
                receipt: receipt("authoringAtoms.v2", directAtomId),
              },
            },
          },
        },
      },
    ],
  };
  return attachMaterials(capture, {
    id,
    originalName: "Original structural reading",
    atomId: directAtomId,
    contentId,
    content: {
      typeName: "supplement",
      definition: { assetId, assetTypeName: "cml" },
    },
    elements: [],
  });
}

test("direct draft reading completion requires its exact bound draft and retained original CML", () => {
  const capture = directReadingCapture();
  const before = JSON.stringify(capture);
  const verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(
    JSON.stringify(capture),
    before,
    "The import gate never modifies original evidence",
  );
});

test("direct draft reading cannot be certified from mismatched, partial or published evidence", () => {
  const changes = [
    (capture, item) => {
      item.atomId = "c".repeat(22);
    },
    (capture, item) => {
      item.payload.directDataSources.atom.elements[0].contentId = "atom~other";
    },
    (capture, item) => {
      item.payload.directDataSources.relation.elements[0].branchRelationMap[
        directCourseId + "~" + item.id
      ].courseId = "other";
    },
    (capture, item) => {
      item.payload.directDataSources.relation.elements.push(
        item.payload.directDataSources.relation.elements[0],
      );
    },
    (capture, item) => {
      item.payload.directDataSources.receipts.atom.status = 206;
    },
    (capture, item) => {
      item.payload.directDataSources.receipts.atom.sha256 =
        sourceHash("different");
    },
    (capture, item) => {
      item.payload.directDataSources.receipts.stability.updatedAt++;
    },
    (capture, item) => {
      item.payload.directDataEvidence.stableSource = false;
    },
    (capture, item) => {
      item.payload.directDataEvidence.sourceState = "PUBLISHED";
    },
    (capture, item) => {
      item.payload.directDataEvidence.assetId = "c".repeat(22) + "@1";
    },
    (capture, item) => {
      item.payload.directDataEvidence.rawCmlSha256 = sourceHash("other body");
    },
    (capture, item) => {
      item.payload.directDraftCml = {
        ...item.payload.directDraftCml,
        definition: {
          ...item.payload.directDraftCml.definition,
          value: "Older published body",
        },
      };
    },
    (capture, item) => {
      item.payload.directDataEvidence.unresolvedAssetReferences.push(
        "unresolved-attachment",
      );
    },
    (capture, item) => {
      item.payload.directDataEvidence.assetReferenceCount = 1;
    },
    (capture, item) => {
      item.payload.directDataEvidence.assetsBodyVerified = false;
    },
    (capture, item) => {
      item.payload.textSha256 = sourceHash("other normalized text");
    },
    (capture, item) => {
      item.payload.textCaptureTruncated = true;
    },
    (capture, item) => {
      item.payload.textCaptureEvidence = { method: "EXACT_READING_FIELD" };
    },
    (capture, item) => {
      item.captureContract.status = "COMPLETE_READING";
    },
    (capture) => {
      capture.meta.directDataCapture.finalMaterialHash =
        sourceHash("changed material");
    },
  ];
  for (const change of changes) {
    const capture = directReadingCapture();
    change(capture, capture.fingerprints[0]);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, String(change));
    assert(
      verdict.reasons.some((reason) => reason.startsWith("DIRECT_")),
      verdict.reasons.join("\n"),
    );
  }
});

test("direct reading source media stays unverified even when its exported asset flags claim none", () => {
  for (const markup of [
    '<img src="https://example.test/unfetched.png"/>',
    '<media:image xmlns:media="urn:synthetic" src="https://example.test/unfetched.png"/>',
    '<asset id="unresolved-asset"/>',
    '<iframe src="https://example.test/body"/>',
    '<a href="https://example.test/attachment.pdf">Attachment</a>',
    '<a download="attachment" href="https://example.test/body">Attachment</a>',
    "<script>unverified source</script>",
    "<style>unverified source</style>",
    '<!DOCTYPE co-content [<!ENTITY synthetic "source">]>',
  ]) {
    const capture = directReadingCapture(),
      payload = capture.fingerprints[0].payload;
    const value =
      "<co-content><p>Current draft body</p>" + markup + "</co-content>";
    const source = payload.directDataSources.atom.elements[0].draft;
    source.content.definition.content.definition.value = value;
    payload.directDraftCml.definition.value = value;
    payload.directDataSources.receipts.stability.atom.elements[0].draft =
      structuredClone(source);
    payload.directDataSources.receipts.stability.draftHash = modelHash(source);
    payload.directDataEvidence.draftHash = modelHash(source);
    payload.directDataEvidence.rawCmlLength = value.length;
    payload.directDataEvidence.rawCmlSha256 = sourceHash(value);
    assert.equal(payload.directDataEvidence.assetReferenceCount, 0);
    assert.equal(payload.directDataEvidence.assetsBodyVerified, true);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, markup);
    assert(
      verdict.reasons.includes("DIRECT_DRAFT_READING_SOURCE_INVALID:reading-1"),
      verdict.reasons.join("\n"),
    );
  }
});

function directNativeImageCapture() {
  const capture = directReadingCapture(),
    payload = capture.fingerprints[0].payload,
    id = "m".repeat(22),
    canonicalUrl = "https://d3c33hcgiwev3.cloudfront.net/synthetic/image.png",
    bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=",
      "base64",
    ),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const value =
      '<co-content><p>Current draft body</p><img assetId="' +
      id +
      '"/></co-content>',
    draft = payload.directDataSources.atom.elements[0].draft;
  draft.content.definition.content.definition.value = value;
  payload.directDraftCml.definition.value = value;
  payload.directDataSources.receipts.stability.atom.elements[0].draft =
    structuredClone(draft);
  payload.directDataSources.receipts.stability.draftHash = modelHash(draft);
  Object.assign(payload.directDataEvidence, {
    draftHash: modelHash(draft),
    rawCmlLength: value.length,
    rawCmlSha256: sourceHash(value),
    assetReferenceCount: 1,
  });
  const metadata = {
      elements: [
        {
          id,
          name: "image.png",
          typeName: "image",
          contentVersion: 3,
          url: { url: canonicalUrl, expires: 1 },
        },
      ],
      paging: {},
    },
    receipt = {
      resource: "assets.v1",
      id,
      status: 200,
      requestPath: "/api/assets.v1",
      requestQuery: [["ids", id]],
      bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
      originalResponseSha256: "e".repeat(64),
      sha256: "e".repeat(64),
    },
    fresh = structuredClone(metadata);
  fresh.elements[0].url.expires = 2;
  const asset = {
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
  payload.directAssetEvidence = {
    method: "BOUND_CML_ASSET_METADATA_AND_BODY",
    assets: [asset],
    missingPointers: [],
    failures: [],
  };
  payload.assetDetails = [
    {
      assetId: id,
      tag: "img",
      url: canonicalUrl,
      bodyVerified: true,
      hashStatus: "HASHED_ORIGINAL_BINARY_BYTES",
      evidenceSource: "bound-native-cml-asset-body",
      sha256,
      size: bytes.length,
      mime: "image/png",
    },
  ];
  return capture;
}

test("direct importer independently verifies retained media bytes and exact bound native IDs", () => {
  assert.equal(
    evaluateCourseraCapture(directNativeImageCapture(), directCourseId)
      .complete,
    true,
  );
  for (const mode of [
    "hash",
    "base64",
    "missingBytes",
    "size",
    "mime",
    "magic",
    "metadataId",
    "freshContent",
    "route",
    "query",
    "bodyFormat",
    "extraAsset",
    "detailHash",
    "hiddenReference",
    "sourceMissingPointer",
  ]) {
    const capture = directNativeImageCapture(),
      payload = capture.fingerprints[0].payload,
      asset = payload.directAssetEvidence.assets[0];
    if (mode === "hash")
      asset.body.sha256 =
        asset.body.receipt.sha256 =
        payload.assetDetails[0].sha256 =
          "f".repeat(64);
    if (mode === "base64")
      asset.body.base64 = "!".repeat(asset.body.base64.length);
    if (mode === "missingBytes") delete asset.body.base64;
    if (mode === "size")
      asset.body.size =
        asset.body.receipt.bytes =
        payload.assetDetails[0].size =
          999999;
    if (mode === "mime")
      asset.body.mime =
        asset.body.receipt.mime =
        payload.assetDetails[0].mime =
          "application/pdf";
    if (mode === "magic") {
      const bytes = Buffer.from(asset.body.base64, "base64");
      bytes[0] = 0;
      asset.body.base64 = bytes.toString("base64");
      asset.body.sha256 =
        asset.body.receipt.sha256 =
        payload.assetDetails[0].sha256 =
          createHash("sha256").update(bytes).digest("hex");
    }
    if (mode === "metadataId") asset.metadata.elements[0].id = "x".repeat(22);
    if (mode === "freshContent")
      asset.stability.metadata.elements[0].contentVersion++;
    if (mode === "route")
      asset.metadataReceipt.requestPath = "/api/assets.v1/" + asset.assetId;
    if (mode === "query")
      asset.metadataReceipt.requestQuery[0][1] = "x".repeat(22);
    if (mode === "bodyFormat") asset.body.receipt.bodyFormat = "HASH_ONLY";
    if (mode === "extraAsset")
      payload.directAssetEvidence.assets.push(structuredClone(asset));
    if (mode === "detailHash") payload.assetDetails[0].sha256 = "f".repeat(64);
    if (mode === "hiddenReference" || mode === "sourceMissingPointer") {
      const draft = payload.directDataSources.atom.elements[0].draft,
        old = draft.content.definition.content.definition.value,
        value = old.replace(
          "</co-content>",
          (mode === "hiddenReference"
            ? '<img assetId="' + "x".repeat(22) + '"/>'
            : '<img alt=""/>') + "</co-content>",
        );
      draft.content.definition.content.definition.value = value;
      payload.directDraftCml.definition.value = value;
      payload.directDataSources.receipts.stability.atom.elements[0].draft =
        structuredClone(draft);
      payload.directDataSources.receipts.stability.draftHash =
        payload.directDataEvidence.draftHash = modelHash(draft);
      payload.directDataEvidence.rawCmlLength = value.length;
      payload.directDataEvidence.rawCmlSha256 = sourceHash(value);
    }
    const result = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(result.complete, false, mode);
    assert(
      result.reasons.includes("DIRECT_DRAFT_READING_SOURCE_INVALID:reading-1"),
      mode + ": " + result.reasons.join(", "),
    );
  }
});

test("archive manifests require original byte hydration through worker transport and cannot verify after JSON-only persistence", () => {
  const capture = directNativeImageCapture(),
    body = capture.fingerprints[0].payload.directAssetEvidence.assets[0].body,
    bytes = new Uint8Array(Buffer.from(body.base64, "base64")),
    original = {
      path: "files/" + body.sha256,
      sha256: body.sha256,
      size: body.size,
      bytes,
    };
  body.archivePath = original.path;
  body.receipt.bodyFormat = "ORIGINAL_BINARY_BYTES_ARCHIVE";
  delete body.base64;
  assert.equal(
    evaluateCourseraCapture(capture, directCourseId).complete,
    false,
    "File descriptors and hashes alone cannot verify binary content.",
  );
  attachCourseraArchiveFileBytes(capture, [original]);
  assert.equal(evaluateCourseraCapture(capture, directCourseId).complete, true);
  assert.equal(
    Object.getOwnPropertyDescriptor(body, "bytes").enumerable,
    false,
  );
  const cloned = structuredClone({ capture, archiveFiles: [original] });
  assert.equal(
    evaluateCourseraCapture(cloned.capture, directCourseId).complete,
    false,
    "A worker must explicitly resolve the transmitted file inventory.",
  );
  attachCourseraArchiveFileBytes(cloned.capture, cloned.archiveFiles);
  assert.equal(
    evaluateCourseraCapture(cloned.capture, directCourseId).complete,
    true,
  );
  const metadataOnly = JSON.parse(JSON.stringify(capture));
  assert.equal(
    evaluateCourseraCapture(metadataOnly, directCourseId).complete,
    false,
    "JSON-only history does not claim to retain or reverify original binary files.",
  );
  assert.throws(
    () =>
      attachCourseraArchiveFileBytes(metadataOnly, [
        { ...original, bytes: new Uint8Array(bytes.length) },
      ]),
    /checksum/,
  );
});

test("empty structural completion requires a bound material receipt and an explicitly empty known structure", () => {
  const capture = directReadingCapture(),
    item = capture.fingerprints[0];
  delete item.atomId;
  delete item.contentId;
  item.type = "Module";
  item.captureContract.status = "COMPLETE_EMPTY_STRUCTURE";
  item.payload = {
    directDataEvidence: {
      method: "BOUND_AUTHORING_DRAFT_API",
      courseId: directCourseId,
      itemId: item.id,
      sourceState: "AUTHORING_DRAFT",
      stableSource: true,
      structural: true,
      noContent: true,
      childCount: 0,
    },
    directDataSources: {
      materials: {
        rootCourseId: directCourseId,
        leaf: {
          id: item.id,
          originalName: "Original empty module",
          elements: [],
          description: "",
          learningObjectives: [],
          timeCommitment: 0,
        },
        ancestorIds: [],
      },
      receipts: {
        materials: receipt("authoringCourseMaterials.v1", directCourseId),
        stability: { stable: true },
      },
    },
  };
  attachMaterials(capture, item.payload.directDataSources.materials.leaf);
  assert.equal(evaluateCourseraCapture(capture, directCourseId).complete, true);
  for (const mutate of [
    (sources) => {
      sources.materials.leaf.content = null;
    },
    (sources) => {
      delete sources.materials.leaf.elements;
    },
    (sources) => {
      sources.materials.leaf.elements.push({ id: "unaccounted-child" });
    },
    (sources) => {
      sources.materials.rootCourseId = "other";
    },
    (sources) => {
      sources.materials.leaf.id = "other";
    },
    (sources) => {
      sources.materials.ancestorIds.push("module", "lesson");
    },
    (sources) => {
      delete sources.materials.leaf.description;
    },
    (sources) => {
      sources.receipts.materials.id = "other";
    },
  ]) {
    const modified = structuredClone(capture);
    mutate(modified.fingerprints[0].payload.directDataSources);
    assert.equal(
      evaluateCourseraCapture(modified, directCourseId).complete,
      false,
      String(mutate),
    );
  }
});

function directAssessmentCapture() {
  const capture = directReadingCapture(),
    item = capture.fingerprints[0],
    payload = item.payload;
  item.type = "Graded Assignment";
  item.captureContract.status = "COMPLETE_BOUND_DRAFT_ASSESSMENT";
  const partIds = ["c".repeat(22), "b".repeat(22)],
    definitionIds = ["d".repeat(22), "e".repeat(22)];
  const cml = (text) => ({
    typeName: "cml",
    definition: {
      dtdId: "staffGraded/1",
      value: "<co-content><p>" + text + "</p></co-content>",
    },
  });
  const groups = partIds.map((part, index) => ({
    id: directAtomId + "~" + part,
    questions: [directAtomId + "~" + definitionIds[index] + "@1"],
  }));
  const definitions = definitionIds.map((id, index) => ({
    id: directAtomId + "~" + id + "@1",
    definition: {
      typeName: index ? "checkbox" : "mcq",
      definition: {
        prompt: cml("Original question " + (index + 1)),
        options: ["alpha", "beta", "gamma"].map((option) => ({
          id: option,
          display: cml(option),
          feedback: cml("feedback " + option),
        })),
        ...(index
          ? { correctOptions: ["alpha", "gamma"] }
          : { correctOption: "beta" }),
      },
    },
  }));
  const questions = definitions.map((source, index) => {
    const native = source.definition.definition,
      correct = index ? native.correctOptions : [native.correctOption];
    const options = native.options.map((option) => ({
      id: option.id,
      sourceOptionId: option.id,
      text: option.id,
      label: option.id,
      feedback: "feedback " + option.id,
      correct: correct.includes(option.id),
    }));
    return {
      id: String(index + 1),
      courseraQuestionId: groups[index].id,
      sourceDefinitionId: source.id,
      questionOrdinalObserved: true,
      rawType: source.definition.typeName,
      observationMethod: "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION",
      type: index ? "multiple-select" : "single-select",
      prompt: "Original question " + (index + 1),
      textFormat: "PLAIN_TEXT",
      feedback: "",
      shuffleOptions: null,
      ...(index ? { allowPartialScoring: null } : {}),
      answerTextReliable: true,
      optionTextReliable: true,
      options,
      correctAnswers: options
        .filter((option) => option.correct)
        .map((option) => option.text),
      answerKeyEvidence: index
        ? {
            method: "EXACT_CORRECT_OPTION_ID_SET",
            correctOptions: [...correct],
          }
        : { method: "EXACT_CORRECT_OPTION_ID", correctOption: correct[0] },
    };
  });
  const parts = partIds.map((id) => ({
    typeName: "storedQuestionGroupPart",
    definition: { id },
  }));
  const draft = {
    content: { typeName: "staffGradedDraft", definition: { parts } },
  };
  payload.directDataSources.atom.elements[0].draft = draft;
  payload.directDataSources.receipts.stability.draftHash = modelHash(draft);
  payload.directDataSources.receipts.stability.atom.elements[0].draft =
    structuredClone(draft);
  payload.directDataEvidence = {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId: directCourseId,
    itemId: item.id,
    atomId: directAtomId,
    contentId: item.contentId,
    sourceState: "AUTHORING_DRAFT",
    stableSource: true,
    draftHash: modelHash(draft),
    storedAtomVersion: 1,
    updatedAt: 1700000000000,
    declaredContentParts: 2,
    orderedGroupIds: groups.map((group) => group.id),
  };
  payload.assessmentApiEvidence = {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId: directCourseId,
    itemId: item.id,
    assignmentId: directAtomId,
    rawParts: parts,
    unsupportedParts: [],
    failures: [],
    inventory: groups.map((group, index) => ({
      id: group.id,
      ordinal: index + 1,
    })),
    groups: groups.toReversed(),
    questionDefinitions: definitions.toReversed(),
    groupStability: groups.map((group) => ({
      id: group.id,
      stable: true,
      group: structuredClone(group),
      receipt: receipt("authoringAssignmentQuestionGroups.v1", group.id),
    })),
    receipts: [
      ...groups.map((group) =>
        receipt("authoringAssignmentQuestionGroups.v1", group.id),
      ),
      ...definitions.map((definition) =>
        receipt(
          "authoringAssignmentMachineEvaluableQuestions.v1",
          definition.id,
        ),
      ),
    ],
  };
  payload.structuredAssessment = {
    declaredQuestionCount: 2,
    questionCount: 2,
    questions,
    captureCompleteness: {
      declared: 2,
      captured: 2,
      questionCoverageComplete: true,
      requiredAnswerCoverageComplete: true,
      missingQuestionOrdinals: [],
      missingRequiredAnswerOrdinals: [],
    },
  };
  payload.directAssessmentInventory = { complete: true, rawParts: parts };
  delete payload.directDraftCml;
  return attachMaterials(capture, {
    id: item.id,
    originalName: "Original assessment",
    atomId: directAtomId,
    contentId: item.contentId,
    content: {
      typeName: "staffGraded",
      definition: { assignmentId: "z".repeat(22) + "@3" },
    },
    elements: [],
  });
}

test("direct assessments require native source order, exact versioned definition references and explicit native keys", () => {
  const capture = directAssessmentCapture(),
    before = JSON.stringify(capture);
  const verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
  assert.equal(JSON.stringify(capture), before);
  assert.notEqual(
    capture.fingerprints[0].payload.structuredAssessment.questions[0]
      .sourceDefinitionId,
    capture.meta.directDataCapture.materials.elements[0].material.elements[0]
      .elements[0].content.definition.assignmentId,
    "The retained published assignment reference is not used to infer draft question ownership",
  );
});

test("direct assessment importer recomputes projected learner text and exact checkbox key sets", () => {
  for (const mutate of [
    (p) => {
      p.structuredAssessment.questions[0].prompt = "Unrelated prompt";
    },
    (p) => {
      const q = p.structuredAssessment.questions[0];
      q.options[1].text = q.options[1].label = "Other answer";
      q.correctAnswers = ["Other answer"];
    },
    (p) => {
      delete p.structuredAssessment.questions[0].options[0].feedback;
    },
    (p) => {
      p.structuredAssessment.questions[0].options[0].feedback =
        "Other feedback";
    },
    (p) => {
      p.structuredAssessment.questions[0].shuffleOptions = true;
    },
    (p) => {
      delete p.structuredAssessment.questions[0].textFormat;
    },
    (p) => {
      p.structuredAssessment.questions[1].answerKeyEvidence.correctOptions = [
        "alpha",
        "alpha",
      ];
    },
    (p) => {
      p.assessmentApiEvidence.questionDefinitions[0].definition.definition.prompt.definition.value =
        "<co-content><p>Malformed</co-content>";
    },
  ]) {
    const capture = directAssessmentCapture();
    mutate(capture.fingerprints[0].payload);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, String(mutate));
    assert(
      verdict.reasons.some((reason) =>
        reason.startsWith("DIRECT_DRAFT_ASSESSMENT_SOURCE_INVALID:"),
      ),
    );
  }
});

test("nonempty assessment import checks retained instructions, settings, criteria and unsupported rubric bodies", () => {
  for (const mode of [
    "valid",
    "settings",
    "missingIntroduction",
    "introductionMedia",
    "criteriaMedia",
    "rubric",
  ]) {
    const capture = directAssessmentCapture(),
      payload = capture.fingerprints[0].payload,
      definition = structuredClone(
        payload.directDataSources.atom.elements[0].draft.content.definition,
      ),
      cml = (value) => ({
        typeName: "cml",
        definition: {
          dtdId: "staffGraded/1",
          value: "<co-content><p>" + value + "</p></co-content>",
        },
      });
    Object.assign(definition, {
      configuration: { isGraded: true },
      introduction: cml("Instructions"),
      reviewCriteria: cml("Criteria"),
      passingFraction: 0.8,
      assignmentLevelRubrics: [],
    });
    if (mode === "introductionMedia" || mode === "criteriaMedia")
      definition[
        mode === "introductionMedia" ? "introduction" : "reviewCriteria"
      ] = cml('<img assetId="' + "m".repeat(22) + '"/>');
    if (mode === "rubric")
      definition.assignmentLevelRubrics.push({ unknown: "Original rubric" });
    replaceDirectFixtureDraft(capture, {
      content: { typeName: "staffGradedDraft", definition },
    });
    for (const field of [
      "configuration",
      "introduction",
      "reviewCriteria",
      "passingFraction",
      "assignmentLevelRubrics",
    ])
      payload.structuredAssessment[field] = payload.directAssessmentInventory[
        field
      ] = structuredClone(definition[field]);
    if (mode === "settings")
      payload.structuredAssessment.configuration.isGraded = false;
    if (mode === "missingIntroduction")
      delete payload.structuredAssessment.introduction;
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(
      verdict.complete,
      mode === "valid",
      mode + " " + verdict.reasons.join("\n"),
    );
  }
});

test("raw native source and ordered questions cannot silently disagree in a direct assessment", () => {
  const changes = [
    (payload) => {
      payload.directDataEvidence.orderedGroupIds.reverse();
    },
    (payload) => {
      payload.assessmentApiEvidence.inventory[0].ordinal = 2;
    },
    (payload) => {
      payload.assessmentApiEvidence.groups[0].questions.push("other~version@1");
    },
    (payload) => {
      payload.assessmentApiEvidence.groups[0].questions[0] =
        payload.assessmentApiEvidence.groups[0].questions[0].replace(
          "@1",
          "@2",
        );
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].id =
        payload.assessmentApiEvidence.questionDefinitions[1].id;
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].definition.typeName =
        "unknownType";
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[1].definition.definition.correctOption =
        "missing-option";
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].definition.definition.prompt.definition.value =
        '<co-content><p>Prompt</p><img src="https://example.test/unfetched.png"/></co-content>';
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].definition.definition.options[0].feedback.definition.value =
        '<co-content><a href="https://example.test/attachment.pdf">Attachment</a></co-content>';
    },
    (payload) => {
      payload.assessmentApiEvidence.receipts[0].id = "other~group";
    },
    (payload) => {
      payload.assessmentApiEvidence.receipts = [];
    },
    (payload) => {
      delete payload.assessmentApiEvidence.groupStability;
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability.pop();
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[1].id =
        payload.assessmentApiEvidence.groupStability[0].id;
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].stable = false;
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].group.questions[0] =
        payload.assessmentApiEvidence.groupStability[0].group.questions[0].replace(
          "@1",
          "@2",
        );
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].group.typeName =
        "changed-type";
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].receipt.id =
        "other~group";
    },
    (payload) => {
      payload.assessmentApiEvidence.groupStability[0].receipt.originalResponseSha256 =
        sourceHash("other receipt");
    },
    (payload) => {
      payload.assessmentApiEvidence.questionDefinitions[0].definition.definition.correctOptions.push(
        "alpha",
      );
    },
    (payload) => {
      payload.structuredAssessment.questions.reverse();
    },
    (payload) => {
      payload.structuredAssessment.questions[0].sourceDefinitionId =
        "other~definition@1";
    },
    (payload) => {
      payload.structuredAssessment.questions[0].options[0].correct = true;
    },
    (payload) => {
      payload.structuredAssessment.questions[0].options[1].sourceOptionId =
        "alpha";
    },
    (payload) => {
      payload.structuredAssessment.questions[0].correctAnswers = [
        "guessed answer",
      ];
    },
    (payload) => {
      payload.structuredAssessment.questions[1].answerKeyEvidence.correctOptions =
        ["alpha"];
    },
    (payload) => {
      payload.structuredAssessment.captureCompleteness.requiredAnswerCoverageComplete = false;
    },
    (payload) => {
      payload.directDataSources.atom.elements[0].draft.content.definition.parts.reverse();
    },
  ];
  for (const change of changes) {
    const capture = directAssessmentCapture();
    change(capture.fingerprints[0].payload);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, String(change));
    assert(
      verdict.reasons.some((reason) => reason.startsWith("DIRECT_")),
      verdict.reasons.join("\n"),
    );
  }
});

test("direct capture inventory remains bound to the complete material hierarchy even if exported counts agree", () => {
  const capture = directReadingCapture();
  const leaf =
    capture.meta.directDataCapture.materials.elements[0].material.elements[0]
      .elements[0];
  for (const envelope of [
    capture.meta.directDataCapture.materials,
    capture.meta.directDataCapture.finalMaterials,
  ])
    envelope.elements[0].material.elements[0].elements.push({
      ...structuredClone(leaf),
      id: "missing-leaf",
    });
  const verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(
    verdict.inventoryCount,
    1,
    "Existing accounting is retained as supplied",
  );
  assert.equal(verdict.complete, false);
  assert(verdict.reasons.includes("DIRECT_DRAFT_MATERIAL_INVENTORY_INVALID"));
});

test("direct source evidence cannot bypass strict verification by downgrading its mode or completion flags", () => {
  for (const [change, expectedReason] of [
    [
      (capture) => {
        delete capture.meta.directDataCapture.mode;
      },
      "DIRECT_DRAFT_CAPTURE_MODE_INVALID",
    ],
    [
      (capture) => {
        capture.meta.directDataCapture.mode = "BOUND_AUTHORING_DRAF_API";
      },
      "DIRECT_DRAFT_CAPTURE_MODE_INVALID",
    ],
    [
      (capture) => {
        capture.meta.directDataCapture.acquisitionComplete = false;
      },
      "DIRECT_DRAFT_ACQUISITION_NOT_COMPLETE",
    ],
    [
      (capture) => {
        capture.meta.directDataCapture.wholeCourseVerified = false;
      },
      "DIRECT_DRAFT_WHOLE_COURSE_NOT_VERIFIED",
    ],
    [
      (capture) => {
        delete capture.meta.directDataCapture;
      },
      "DIRECT_DRAFT_CAPTURE_MODE_INVALID",
    ],
  ]) {
    const capture = directReadingCapture();
    change(capture);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, String(change));
    assert(
      verdict.reasons.includes(expectedReason),
      verdict.reasons.join("\n"),
    );
  }
});

function replaceDirectFixtureDraft(capture, draft) {
  const payload = capture.fingerprints[0].payload,
    hash = modelHash(draft);
  payload.directDataSources.atom.elements[0].draft = draft;
  payload.directDataSources.receipts.stability.atom.elements[0].draft =
    structuredClone(draft);
  payload.directDataSources.receipts.stability.draftHash = hash;
  payload.directDataEvidence.draftHash = hash;
}
function directDiscussionCapture() {
  const capture = directReadingCapture(),
    item = capture.fingerprints[0],
    payload = item.payload;
  item.type = "Discussion";
  item.typeName = "discussionPrompt";
  item.captureContract.status = "COMPLETE_BOUND_DRAFT_DISCUSSION";
  const raw = {
    title: "Source discussion title",
    promptPermissions: { viewAnswersBeforeReplying: false },
    prompt: {
      typeName: "cml",
      definition: {
        dtdId: "discussion/1",
        value:
          "<co-content><text>Discuss the observed topic</text></co-content>",
      },
    },
  };
  replaceDirectFixtureDraft(capture, {
    content: {
      typeName: "discussionPromptDraft",
      definition: {
        promptType: { typeName: "questionPerSession", definition: raw },
      },
    },
  });
  payload.directDraftDiscussion = raw;
  payload.directDraftCml = raw.prompt;
  payload.discussionTitle = raw.title;
  payload.discussionPromptPermissions = raw.promptPermissions;
  payload.textSample = "Discuss the observed topic";
  payload.textLength = payload.textSample.length;
  payload.textSha256 = sourceHash(payload.textSample);
  payload.textScopeKind = "bound-authoring-draft-discussion-cml";
  Object.assign(payload.directDataEvidence, {
    discussionPromptType: "questionPerSession",
    dtdId: "discussion/1",
    rawCmlLength: raw.prompt.definition.value.length,
    rawCmlSha256: sourceHash(raw.prompt.definition.value),
    plainTextLength: payload.textLength,
  });
  delete payload.directDataEvidence.assetId;
  return attachMaterials(capture, {
    id: item.id,
    originalName: "Original discussion",
    atomId: directAtomId,
    contentId: item.contentId,
    content: { typeName: "discussionPrompt", definition: {} },
    elements: [],
  });
}

test("direct CML import verifies versioned native heading projections while preserving historical text and source receipts", () => {
  for (const createCapture of [directReadingCapture, directDiscussionCapture]) {
    for (const version of [1, 2]) {
      const capture = createCapture(),
        payload = capture.fingerprints[0].payload,
        draft = structuredClone(
          payload.directDataSources.atom.elements[0].draft,
        ),
        cml =
          draft.content.typeName === "supplementDraft"
            ? draft.content.definition.content
            : draft.content.definition.promptType.definition.prompt;
      cml.definition.value =
        '<co-content><heading level="1">Technical Drawings</heading>' +
        '<heading level="2">Introduction</heading><text>Original body.</text></co-content>';
      replaceDirectFixtureDraft(capture, draft);
      payload.directDraftCml = cml;
      if (draft.content.typeName !== "supplementDraft")
        payload.directDraftDiscussion =
          draft.content.definition.promptType.definition;
      payload.textSample =
        version === 1
          ? "Technical DrawingsIntroduction Original body."
          : "Technical Drawings Introduction Original body.";
      payload.textLength = payload.directDataEvidence.plainTextLength =
        payload.textSample.length;
      payload.textSha256 = sourceHash(payload.textSample);
      payload.directDataEvidence.rawCmlLength = cml.definition.value.length;
      payload.directDataEvidence.rawCmlSha256 = sourceHash(
        cml.definition.value,
      );
      if (version === 2) payload.directDataEvidence.textProjectionVersion = 2;
      const before = JSON.stringify(capture),
        verdict = evaluateCourseraCapture(capture, directCourseId);
      assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
      assert.equal(JSON.stringify(capture), before);
      payload.directDataEvidence.textProjectionVersion = version === 1 ? 2 : 1;
      assert.equal(
        evaluateCourseraCapture(capture, directCourseId).complete,
        false,
        "An observation cannot claim a different projection version without recomputing the exact source text",
      );
    }
  }
});

test("direct discussion importer verifies observed draft prompt, permissions and original CML independently", () => {
  const capture = directDiscussionCapture(),
    before = JSON.stringify(capture);
  const verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
  assert.equal(JSON.stringify(capture), before);
});

test("discussion import independently verifies original image bodies without relaxing prompt or permission binding", () => {
  const makeCapture = () => {
    const capture = directDiscussionCapture(),
      payload = capture.fingerprints[0].payload,
      image = directNativeImageCapture().fingerprints[0].payload,
      draft = structuredClone(payload.directDataSources.atom.elements[0].draft);
    draft.content.definition.promptType.definition.prompt.definition.value =
      image.directDraftCml.definition.value;
    replaceDirectFixtureDraft(capture, draft);
    payload.directDraftDiscussion =
      draft.content.definition.promptType.definition;
    payload.directDraftCml = payload.directDraftDiscussion.prompt;
    for (const field of [
      "textSample",
      "textLength",
      "textSha256",
      "directAssetEvidence",
      "assetDetails",
    ])
      payload[field] = image[field];
    for (const field of [
      "rawCmlLength",
      "rawCmlSha256",
      "plainTextLength",
      "assetReferenceCount",
      "assetsBodyVerified",
      "unresolvedAssetReferences",
    ])
      payload.directDataEvidence[field] = image.directDataEvidence[field];
    return capture;
  };
  const capture = makeCapture(),
    verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
  for (const mutate of [
    (p) => {
      delete p.directAssetEvidence;
    },
    (p) => {
      p.assetDetails[0].sha256 = "f".repeat(64);
    },
    (p) => {
      const asset = p.directAssetEvidence.assets[0];
      asset.body.sha256 =
        asset.body.receipt.sha256 =
        p.assetDetails[0].sha256 =
          "f".repeat(64);
    },
    (p) => {
      p.discussionPromptPermissions = { viewAnswersBeforeReplying: true };
    },
  ]) {
    const changed = makeCapture();
    mutate(changed.fingerprints[0].payload);
    assert.equal(
      evaluateCourseraCapture(changed, directCourseId).complete,
      false,
      String(mutate),
    );
  }
});

test("direct reading and discussion cannot certify coordinated empty or unrelated text projections", () => {
  for (const createCapture of [directReadingCapture, directDiscussionCapture]) {
    for (const text of ["", "A self-consistent but unrelated projection"]) {
      const capture = createCapture(),
        payload = capture.fingerprints[0].payload;
      payload.textSample = text;
      payload.textLength = payload.directDataEvidence.plainTextLength =
        text.length;
      payload.textSha256 = sourceHash(text);
      const verdict = evaluateCourseraCapture(capture, directCourseId);
      assert.equal(verdict.complete, false, createCapture.name + ": " + text);
      assert(
        verdict.reasons.some((reason) =>
          /DIRECT_DRAFT_(?:READING|DISCUSSION)_SOURCE_INVALID:/.test(reason),
        ),
      );
    }
  }
});

test("failed current resume revalidation overrides historical stable source receipts at import", () => {
  for (const createCapture of [
    directReadingCapture,
    directAssessmentCapture,
    directDiscussionCapture,
  ]) {
    const capture = createCapture(),
      payload = capture.fingerprints[0].payload;
    payload.directResumeRevalidation = {
      verified: false,
      reason: "DIRECT_REQUEST_HTTP_403",
    };
    assert.equal(payload.directDataSources.receipts.stability.stable, true);
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, createCapture.name);
    assert(
      verdict.reasons.some((reason) =>
        reason.startsWith("DIRECT_DRAFT_SOURCE_BINDING_INVALID:"),
      ),
    );
  }
});

test("discussion source tampering, hidden media and unrelated editor receipts never pass the direct gate", () => {
  for (const mode of [
    "title",
    "permissions",
    "rawPrompt",
    "rawHash",
    "sourceType",
    "media",
    "receipt",
    "foreignRelation",
    "editorReceipt",
  ]) {
    const capture = directDiscussionCapture(),
      payload = capture.fingerprints[0].payload;
    if (mode === "title") payload.discussionTitle = "Different title";
    if (mode === "permissions")
      payload.discussionPromptPermissions = { viewAnswersBeforeReplying: true };
    if (mode === "rawPrompt")
      payload.directDraftDiscussion = {
        ...payload.directDraftDiscussion,
        prompt: {
          typeName: "cml",
          definition: {
            dtdId: "discussion/1",
            value: "<co-content><text>Other prompt</text></co-content>",
          },
        },
      };
    if (mode === "rawHash")
      payload.directDataEvidence.rawCmlSha256 = sourceHash("different source");
    if (mode === "sourceType") {
      const draft = structuredClone(
        payload.directDataSources.atom.elements[0].draft,
      );
      draft.content.definition.promptType.typeName = "unknownPrompt";
      replaceDirectFixtureDraft(capture, draft);
    }
    if (mode === "media") {
      const draft = structuredClone(
          payload.directDataSources.atom.elements[0].draft,
        ),
        value =
          '<co-content><text>Discuss</text><img src="https://example.test/unfetched.png"/></co-content>';
      draft.content.definition.promptType.definition.prompt.definition.value =
        value;
      replaceDirectFixtureDraft(capture, draft);
      payload.directDraftDiscussion =
        draft.content.definition.promptType.definition;
      payload.directDraftCml = payload.directDraftDiscussion.prompt;
      payload.directDataEvidence.rawCmlLength = value.length;
      payload.directDataEvidence.rawCmlSha256 = sourceHash(value);
      assert.equal(
        payload.directDataEvidence.assetReferenceCount,
        0,
        "Forged zero media counters cannot override actual source markup",
      );
    }
    if (mode === "receipt")
      payload.directDataSources.receipts.stability.receipt.status = 206;
    if (mode === "foreignRelation")
      payload.directDataSources.relation.elements[0].branchRelationMap[
        directCourseId + "~" + capture.fingerprints[0].id
      ].itemId = "foreign";
    if (mode === "editorReceipt")
      payload.textCaptureEvidence = { editorOpened: true, textObserved: true };
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, mode);
    assert.match(
      verdict.reasons.join("\n"),
      /DIRECT_DRAFT_(?:DISCUSSION_SOURCE|SOURCE_BINDING)_INVALID/,
      mode,
    );
  }
});

function directEmptyAssessmentCapture() {
  const capture = directAssessmentCapture(),
    item = capture.fingerprints[0],
    payload = item.payload;
  item.captureContract.status = "COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT";
  const cml = (value) => ({
    typeName: "cml",
    definition: {
      dtdId: "assess/1",
      value: "<co-content><text>" + value + "</text></co-content>",
    },
  });
  const definition = {
    parts: [],
    configuration: { isGraded: true },
    introduction: cml("Instructions"),
    reviewCriteria: cml("Criteria"),
    passingFraction: 0.8,
    assignmentLevelRubrics: [],
  };
  replaceDirectFixtureDraft(capture, {
    content: { typeName: "staffGradedDraft", definition },
  });
  Object.assign(payload.directDataEvidence, {
    declaredContentParts: 0,
    orderedGroupIds: [],
    sourceEmpty: true,
  });
  payload.assessmentApiEvidence = {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId: directCourseId,
    itemId: item.id,
    assignmentId: directAtomId,
    inventory: [],
    rawParts: [],
    unsupportedParts: [],
    groups: [],
    questionDefinitions: [],
    receipts: [],
    groupStability: [],
    failures: [],
  };
  payload.directAssessmentInventory = {
    complete: true,
    reason: "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS",
    assignmentId: directAtomId,
    candidates: [],
    declared: 0,
    declaredContentParts: 0,
    rawParts: [],
    unsupportedParts: [],
    ...definition,
  };
  payload.structuredAssessment = {
    declaredQuestionCount: 0,
    questionCount: 0,
    answerEvidenceQuestionCount: 0,
    questions: [],
    ...definition,
    captureCompleteness: {
      declared: 0,
      declaredContentParts: 0,
      captured: 0,
      questionCoverageComplete: true,
      requiredAnswerCoverageComplete: true,
      missingQuestionOrdinals: [],
      missingRequiredAnswerOrdinals: [],
      sourceEmpty: true,
      answerKeyApplicability: "NOT_APPLICABLE_NO_QUESTIONS",
    },
  };
  payload.explicitEmptyAssessmentEvidence = {
    method: "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS",
    courseId: directCourseId,
    itemId: item.id,
    atomId: directAtomId,
    sourceEmpty: true,
    declaredContentParts: 0,
    answerKeyApplicable: false,
  };
  return capture;
}

test("the importer accepts bound stable explicit empty assessment drafts without claiming answer keys exist", () => {
  const capture = directEmptyAssessmentCapture(),
    before = JSON.stringify(capture),
    verdict = evaluateCourseraCapture(capture, directCourseId);
  assert.equal(verdict.complete, true, verdict.reasons.join("\n"));
  assert.equal(
    capture.fingerprints[0].payload.explicitEmptyAssessmentEvidence
      .answerKeyApplicable,
    false,
  );
  assert.equal(JSON.stringify(capture), before);
});

test("zero-count flags cannot conceal source parts, lost settings, failed reads or answer applicability", () => {
  for (const mode of [
    "missingParts",
    "hiddenPart",
    "lostSettings",
    "question",
    "failure",
    "missingRawParts",
    "foreignEmptyScope",
    "answerApplicable",
    "media",
    "rubric",
    "ordinaryStatus",
    "freshSourceChanged",
  ]) {
    const capture = directEmptyAssessmentCapture(),
      item = capture.fingerprints[0],
      payload = item.payload;
    if (["missingParts", "hiddenPart", "media", "rubric"].includes(mode)) {
      const draft = structuredClone(
        payload.directDataSources.atom.elements[0].draft,
      );
      if (mode === "missingParts") delete draft.content.definition.parts;
      if (mode === "hiddenPart")
        draft.content.definition.parts.push({
          typeName: "storedQuestionGroupPart",
          definition: { id: "c".repeat(22) },
        });
      if (mode === "media")
        draft.content.definition.introduction.definition.value =
          '<co-content><img src="https://example.test/unfetched.png"/></co-content>';
      if (mode === "rubric")
        draft.content.definition.assignmentLevelRubrics.push({
          unknown: "rubric",
        });
      replaceDirectFixtureDraft(capture, draft);
    }
    if (mode === "lostSettings")
      payload.structuredAssessment.configuration = { isGraded: false };
    if (mode === "question")
      payload.structuredAssessment.questions.push({ id: "1" });
    if (mode === "failure")
      payload.assessmentApiEvidence.failures.push({ reason: "READ_FAILED" });
    if (mode === "missingRawParts")
      delete payload.assessmentApiEvidence.rawParts;
    if (mode === "foreignEmptyScope")
      payload.explicitEmptyAssessmentEvidence.itemId = "foreign";
    if (mode === "answerApplicable")
      payload.explicitEmptyAssessmentEvidence.answerKeyApplicable = true;
    if (mode === "ordinaryStatus")
      item.captureContract.status = "COMPLETE_BOUND_DRAFT_ASSESSMENT";
    if (mode === "freshSourceChanged")
      payload.directDataSources.receipts.stability.atom.elements[0].draft.content.definition.parts.push(
        { typeName: "unknownPart" },
      );
    const verdict = evaluateCourseraCapture(capture, directCourseId);
    assert.equal(verdict.complete, false, mode);
    assert.match(
      verdict.reasons.join("\n"),
      /DIRECT_DRAFT_(?:EMPTY_ASSESSMENT_SOURCE|ASSESSMENT_SOURCE|SOURCE_BINDING)_INVALID/,
      mode,
    );
  }
});
