import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";
import {
  createDirectDataMediaReaderV1,
  decodeDirectAssetBodyV1,
  directAssetBodyKindV1,
  directRetainedAssetBodyV1,
} from "../src/extractors/coursera/direct-data-media.js";
import {
  directCmlMediaInventoryV1,
  directMediaEvidenceStructureV1,
} from "../src/extractors/coursera/direct-data-media-contracts.js";

const assetId = "D".repeat(22),
  canonicalUrl = "https://synthetic.cloudfront.net/original/plan.dwg",
  originalName = "Synthetic plan.dwg";

// A header-shaped synthetic original exercises retention, not DWG semantics.
function drawingBytes(version = "AC1027") {
  const bytes = new Uint8Array(256);
  bytes.set(new TextEncoder().encode(version));
  bytes[128] = 42;
  return bytes;
}

function setup({
  archiveMode = false,
  bytes = drawingBytes(),
  mime = "image/vnd.dwg",
  headers = {},
  metadata = {},
  freshMetadata = {},
} = {}) {
  let metadataReads = 0,
    bodyReads = 0;
  const apiReader = createDirectDataReaderV1({
    sanitize: sanitizeCourseraCourseDataModel,
    fetchImpl: async () => {
      metadataReads++;
      return new Response(
        JSON.stringify({
          elements: [
            {
              id: assetId,
              typeName: "generic",
              name: originalName,
              filename: originalName,
              fileExtension: "dwg",
              sourcePath: "original/plan.dwg",
              url: { url: canonicalUrl },
              ...metadata,
              ...(metadataReads % 2 === 0 ? freshMetadata : {}),
            },
          ],
          paging: {},
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  const reader = createDirectDataMediaReaderV1({
    apiReader,
    archiveMode,
    fetchImpl: async (url, options) => {
      bodyReads++;
      assert.equal(url, canonicalUrl);
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "omit");
      const responseHeaders = new Headers({
        "content-type": mime,
        "content-length": String(bytes.length),
      });
      for (const [key, value] of Object.entries(headers))
        if (value === null) responseHeaders.delete(key);
        else responseHeaders.set(key, value);
      return new Response(bytes, { headers: responseHeaders });
    },
  });
  return {
    reader,
    bodyReads: () => bodyReads,
    metadataReads: () => metadataReads,
  };
}

function mediaFor(asset) {
  return {
    method: "BOUND_CML_ASSET_METADATA_AND_BODY",
    assets: [asset],
    failures: [],
    missingPointers: [],
  };
}

const references = (tag = "asset") =>
  directCmlMediaInventoryV1(
    "<co-content><" +
      tag +
      ' assetId="' +
      assetId +
      '" name="Synthetic plan"/></co-content>',
  ).references;

test("DWG recognition requires an exact native extension, known complete header family and non-contradictory MIME", () => {
  for (const version of [
    "AC1015",
    "AC1018",
    "AC1021",
    "AC1024",
    "AC1027",
    "AC1032",
  ])
    assert.equal(
      directAssetBodyKindV1(
        drawingBytes(version),
        "image/vnd.dwg",
        originalName,
      ),
      "DWG",
    );
  for (const [bytes, mime, name, source] of [
    [drawingBytes("AC1099"), "image/vnd.dwg", originalName],
    [drawingBytes().subarray(0, 11), "image/vnd.dwg", originalName],
    [
      new TextEncoder().encode("<html>Sign in</html>"),
      "image/vnd.dwg",
      originalName,
    ],
    [drawingBytes(), "image/png", originalName],
    [drawingBytes(), "text/plain", originalName],
    [drawingBytes(), "image/vnd.dwg", "plan.pdf"],
    [drawingBytes(), "application/octet-stream", "plan"],
    [
      drawingBytes(),
      "application/octet-stream",
      originalName,
      { fileExtension: "pdf" },
    ],
    [
      drawingBytes(),
      "application/octet-stream",
      originalName,
      { filename: "plan.pdf" },
    ],
    [
      drawingBytes(),
      "application/octet-stream",
      originalName,
      { sourcePath: "plan.pdf" },
    ],
    [
      Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
      "application/octet-stream",
      originalName,
    ],
  ])
    assert.equal(directAssetBodyKindV1(bytes, mime, name, source), "");
  const altered = drawingBytes();
  altered[6] = 1;
  assert.equal(
    directAssetBodyKindV1(altered, "application/octet-stream", originalName),
    "",
  );
});

test("native DWG originals retain exact bytes and declared MIME in both archive and base64 transport", async () => {
  for (const archiveMode of [false, true]) {
    for (const mime of [
      "image/vnd.dwg",
      "application/octet-stream",
      "application/acad",
      "image/x-dwg",
    ]) {
      const { reader, metadataReads } = setup({ archiveMode, mime });
      const asset = await reader.capture(assetId);
      assert.equal(asset.reason, undefined);
      assert.equal(metadataReads(), 2);
      assert.equal(asset.body.mime, mime);
      assert.equal(asset.body.receipt.mime, mime);
      assert.equal(asset.body.receipt.originalContentType, mime);
      assert.equal(asset.body.receipt.declaredBodyBytes, drawingBytes().length);
      assert.equal(
        asset.body.sha256,
        createHash("sha256").update(drawingBytes()).digest("hex"),
      );
      assert.deepEqual(decodeDirectAssetBodyV1(asset.body), drawingBytes());
      assert(await directRetainedAssetBodyV1(asset, assetId));
      for (const tag of ["asset", "a"]) {
        const checked = directMediaEvidenceStructureV1(
          mediaFor(asset),
          references(tag),
        );
        assert.equal(checked.complete, true, checked.reason);
        assert.equal(checked.resolved[0].kind, "DWG");
      }
      assert.equal(
        directMediaEvidenceStructureV1(mediaFor(asset), references("img"))
          .complete,
        false,
        "A retained drawing cannot verify an authored image element",
      );
    }
  }
  const originalContentType = "Image/Vnd.Dwg; profile=opaque";
  const parameterized = await setup({
    mime: originalContentType,
  }).reader.capture(assetId);
  assert.equal(parameterized.body.mime, "image/vnd.dwg");
  assert.equal(
    parameterized.body.receipt.originalContentType,
    originalContentType,
  );
  assert(await directRetainedAssetBodyV1(parameterized, assetId));
});

test("DWG transport rejects partial, encoded, undeclared, truncated, overlong and disguised responses", async () => {
  for (const [options, reason] of [
    [
      { headers: { "content-length": null } },
      "DIRECT_ASSET_BODY_LENGTH_UNAVAILABLE",
    ],
    [
      { headers: { "content-length": "0" } },
      "DIRECT_ASSET_BODY_LENGTH_UNAVAILABLE",
    ],
    [
      { headers: { "content-length": "0256" } },
      "DIRECT_ASSET_BODY_LENGTH_UNAVAILABLE",
    ],
    [
      { headers: { "content-length": "257" } },
      "DIRECT_ASSET_BODY_LENGTH_MISMATCH",
    ],
    [
      { headers: { "content-length": "255" } },
      "DIRECT_ASSET_BODY_LENGTH_MISMATCH",
    ],
    [
      { headers: { "content-range": "bytes 0-255/1024" } },
      "DIRECT_ASSET_BODY_PARTIAL_RESPONSE",
    ],
    [
      { headers: { "content-encoding": "gzip" } },
      "DIRECT_ASSET_BODY_ENCODING_UNSUPPORTED",
    ],
    [{ mime: "text/html" }, "DIRECT_ASSET_BODY_MIME_UNSUPPORTED"],
    [{ mime: "image/png" }, "DIRECT_ASSET_BODY_MIME_UNSUPPORTED"],
    [
      { bytes: new TextEncoder().encode("<html>Sign in</html>") },
      "DIRECT_ASSET_BODY_MAGIC_INVALID",
    ],
    [{ bytes: drawingBytes("AC1099") }, "DIRECT_ASSET_BODY_MAGIC_INVALID"],
    [
      { metadata: { fileExtension: "pdf" } },
      "DIRECT_ASSET_BODY_MIME_UNSUPPORTED",
    ],
  ]) {
    const result = await setup(options).reader.capture(assetId);
    assert.equal(result.reason, reason, JSON.stringify(options));
    assert.equal(result.body, undefined);
  }
});

test("resume and import require DWG framing proof, unchanged metadata, correct owner and exact hashed body", async () => {
  const original = await setup().reader.capture(assetId);
  for (const mutate of [
    (asset) => {
      delete asset.body.receipt.declaredBodyBytes;
    },
    (asset) => {
      asset.body.receipt.declaredBodyBytes++;
    },
    (asset) => {
      delete asset.body.receipt.originalContentType;
    },
    (asset) => {
      asset.body.receipt.originalContentType = "image/png";
    },
    (asset) => {
      asset.metadataReceipt.id = "F".repeat(22);
    },
    (asset) => {
      asset.metadata.elements[0].fileExtension = "pdf";
    },
    (asset) => {
      asset.stability.metadata.elements[0].name = "Changed.dwg";
    },
    (asset) => {
      asset.body.base64 = Buffer.from(drawingBytes("AC1099")).toString(
        "base64",
      );
    },
    (asset) => {
      asset.body.mime = asset.body.receipt.mime = "image/png";
    },
  ]) {
    const altered = structuredClone(original);
    mutate(altered);
    assert.equal(await directRetainedAssetBodyV1(altered, assetId), null);
    assert.equal(
      directMediaEvidenceStructureV1(mediaFor(altered), references()).complete,
      false,
    );
  }
  const historical = {
    ...original,
    reason: "DIRECT_ASSET_BODY_MIME_UNSUPPORTED",
  };
  assert.equal(await directRetainedAssetBodyV1(historical, assetId), null);
  const fresh = setup();
  assert.equal(
    (await fresh.reader.capture(assetId, historical)).reason,
    undefined,
  );
  assert.equal(
    fresh.bodyReads(),
    1,
    "Old unresolved evidence cannot manufacture newly captured bytes",
  );
});

test("an authored external attachment URL stays unverified without being called a missing image pointer", () => {
  const cml =
    '<co-content><a href="https://external.example/observed.pdf">Published policy</a>' +
    '<a href="mailto:contact@example.org">Contact</a></co-content>';
  const parsed = directCmlMediaInventoryV1(cml);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.references.length, 1);
  assert.equal(
    parsed.references[0].url,
    "https://external.example/observed.pdf",
  );
  assert.equal(parsed.references[0].id, "");
  const checked = directMediaEvidenceStructureV1(null, parsed.references);
  assert.equal(checked.complete, false);
  assert.equal(checked.reason, "DIRECT_CML_EXTERNAL_ATTACHMENT_UNFETCHED");
  assert.deepEqual(checked.unresolvedAssetReferences, parsed.references);
  const missing = directCmlMediaInventoryV1(
    cml.replace("</co-content>", "<img/></co-content>"),
  );
  assert.equal(
    directMediaEvidenceStructureV1(null, missing.references).reason,
    "DIRECT_CML_MEDIA_REFERENCE_MISSING",
    "A separate genuinely pointerless image remains a missing pointer",
  );
});
