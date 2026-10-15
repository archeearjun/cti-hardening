import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  directCmlMediaInventoryV1,
  directMediaEvidenceStructureV1,
} from "../src/extractors/coursera/direct-data-media-contracts.js";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { createDirectDataMediaReaderV1 } from "../src/extractors/coursera/direct-data-media.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";

const assetId = "m".repeat(22),
  canonicalUrl = "https://fixture.cloudfront.net/original/document";
const inventory = (body) =>
  directCmlMediaInventoryV1("<co-content>" + body + "</co-content>");

test("CML text preserves block boundaries, inline text, entities and literal markup without turning text into media", () => {
  const result = inventory(
    "<text>First<strong>word</strong> &amp; &#x1f642;</text>" +
      "<p>Second<br/>line</p><ul><li>One</li><li>Two</li></ul>" +
      "<table><tr><td>Left</td><td>Right</td></tr></table>" +
      "<!-- invisible comment --><text>&amp;lt; &lt;img/&gt; " +
      '<![CDATA[<img assetId="literal"/> &unexpanded;]]></text>',
  );
  assert.equal(result.valid, true);
  assert.equal(
    result.text,
    'Firstword & 🙂 Second line One Two Left Right &lt; <img/> <img assetId="literal"/> &unexpanded;',
  );
  assert.deepEqual(result.references, []);
});

test("CML plain text rejects unsupported entities and malformed XML characters instead of certifying a different projection", () => {
  for (const body of [
    "<text>bare & text</text>",
    "<text>&unknown;</text>",
    "<text>&#0;</text>",
    "<text>&#x1;</text>",
    "<text>&#xD800;</text>",
    "<text>&#xFFFF;</text>",
    "<text>&#x110000;</text>",
    "<text>illegal \u0001</text>",
    "<text>unpaired \ud800</text>",
    "<text>unpaired \udfff</text>",
    "<text>literal ]]></text>",
    "<!-- invalid -- comment -->",
    "<!-- trailing dash --->",
    "<text/ >",
  ])
    assert.equal(inventory(body).valid, false, JSON.stringify(body));
  assert.equal(inventory("<text>&#9;&#10;&#13;valid</text>").text, "valid");
  assert.equal(
    directCmlMediaInventoryV1(
      "\ufeff<co-content><text>Valid BOM</text></co-content>",
    ).text,
    "Valid BOM",
  );
});

test("namespace declarations bind native media and attributes with scoped inheritance while malformed prefixes cannot certify XML", () => {
  const result = inventory(
    '<media:img assetId="' +
      assetId +
      '" xmlns:media="urn:synthetic"/>' +
      '<section xmlns:copy="urn:source"><copy:text xml:lang="en">First</copy:text>' +
      '<copy:text xmlns:copy="urn:override">Second</copy:text></section>' +
      '<text xmlns="">Third</text>',
  );
  assert.equal(result.valid, true);
  assert.equal(result.references[0].id, assetId);
  assert.equal(result.text, "First Second Third");
  assert.equal(
    inventory(
      '<text xmlns:xml="http://www.w3.org/XML/1998/namespace" xml:lang="en">Valid</text>',
    ).valid,
    true,
  );
  for (const body of [
    '<media:img assetId="' + assetId + '"/>',
    '<text missing:lang="en">Unbound attribute</text>',
    '<section xmlns:local="urn:scoped"/><local:text>Out of scope</local:text>',
    '<a:b:c xmlns:a="urn:one" xmlns:b="urn:two"/>',
    '<text a:b:c="invalid" xmlns:a="urn:one"/>',
    '<text xmlns:xmlns="urn:forbidden"/>',
    '<text xmlns:xml="urn:wrong"/>',
    '<text xmlns:another="http://www.w3.org/XML/1998/namespace"/>',
    '<text xmlns="http://www.w3.org/2000/xmlns/"/>',
    '<text xmlns:empty=""/>',
    '<text xmlns:first="urn:same" xmlns:second="urn:same" first:name="a" second:name="b"/>',
  ])
    assert.equal(inventory(body).valid, false, body);
});

test("unsupported interactive and notation markup stays unresolved while escaped literal code remains text", () => {
  for (const tag of [
    "input",
    "select",
    "option",
    "textarea",
    "button",
    "form",
    "canvas",
    "svg",
    "math",
    "equation",
    "latex",
    "formula",
    "template",
    "noscript",
    "base",
    "meta",
  ]) {
    assert.equal(
      inventory("<" + tag + ' value="unrepresented content"/>').valid,
      false,
      tag,
    );
    assert.equal(
      inventory("<custom:" + tag + ' xmlns:custom="urn:synthetic"/>').valid,
      false,
      tag,
    );
  }
  const literal = inventory(
    '<text>&lt;input value="literal"/&gt;<![CDATA[<math>literal</math>]]></text>',
  );
  assert.equal(literal.valid, true);
  assert.equal(literal.text, '<input value="literal"/><math>literal</math>');
  const track = inventory('<track src="https://example.test/transcript.vtt"/>');
  assert.equal(track.valid, true);
  assert.equal(track.references[0].tag, "track");
  assert.equal(
    directMediaEvidenceStructureV1(null, track.references).complete,
    false,
  );
});

test("explicit native file anchors remain media without an extension while ordinary anchor ids remain navigation", () => {
  for (const attribute of ["assetId", "assetid"]) {
    const result = inventory(
      '<a id="navigation-section" ' +
        attribute +
        '="' +
        assetId +
        '" href="' +
        canonicalUrl +
        '">Original file</a>',
    );
    assert.equal(result.valid, true);
    assert.equal(result.references.length, 1);
    assert.equal(result.references[0].tag, "a");
    assert.equal(result.references[0].id, assetId);
    assert.equal(result.references[0].url, canonicalUrl);
  }
  assert.deepEqual(
    inventory(
      '<a id="' + assetId + '" href="https://example.test/page">A page</a>',
    ).references,
    [],
  );
  assert.equal(
    inventory(
      '<a assetId="' +
        assetId +
        '" assetid="' +
        "x".repeat(22) +
        '">Conflicting file</a>',
    ).valid,
    false,
  );
  for (const attrs of [
    'href="https://example.test/file.pdf"',
    'download="source" href="https://example.test/original"',
    'assetId="" href="https://example.test/original"',
  ]) {
    const result = inventory(
      '<a id="' + assetId + '" ' + attrs + ">A file</a>",
    );
    assert.equal(result.references.length, 1);
    assert.equal(result.references[0].id, "");
    assert.equal(
      directMediaEvidenceStructureV1(null, result.references).complete,
      false,
    );
  }
});

async function captureOriginal({ archiveMode = false } = {}) {
  const bytes = new TextEncoder().encode(
      "%PDF-1.7\nOriginal authored attachment\n",
    ),
    api = createDirectDataReaderV1({
      sanitize: sanitizeCourseraCourseDataModel,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            elements: [
              {
                id: assetId,
                name: "Source file.pdf",
                typeName: "generic",
                url: { url: canonicalUrl },
              },
            ],
            paging: {},
          }),
          { headers: { "content-type": "application/json" } },
        ),
    }),
    reader = createDirectDataMediaReaderV1({
      archiveMode,
      apiReader: api,
      fetchImpl: async (url) => {
        assert.equal(url, canonicalUrl);
        return new Response(bytes, {
          headers: { "content-type": "application/pdf" },
        });
      },
    }),
    asset = await reader.capture(assetId);
  assert.equal(asset.reason, undefined);
  return {
    asset,
    bytes,
    media: {
      method: "BOUND_CML_ASSET_METADATA_AND_BODY",
      assets: [asset],
      missingPointers: [],
      failures: [],
    },
  };
}

test("native file anchors verify owned original PDF bytes and archive proof with the same metadata checks as native assets", async () => {
  for (const archiveMode of [false, true]) {
    const { asset, bytes, media } = await captureOriginal({ archiveMode });
    for (const href of [' href="' + canonicalUrl + '"', ""]) {
      const references = inventory(
          '<a assetId="' + assetId + '"' + href + ">Original attachment</a>",
        ).references,
        result = directMediaEvidenceStructureV1(media, references);
      assert.equal(result.complete, true, result.reason);
      assert.equal(result.resolved[0].kind, "PDF");
      assert.deepEqual(result.decoded[0].bytes, bytes);
      assert.equal(
        createHash("sha256").update(result.decoded[0].bytes).digest("hex"),
        asset.body.sha256,
      );
    }
    if (archiveMode) {
      const saved = JSON.parse(JSON.stringify(asset));
      assert.equal(saved.body.archivePath, "files/" + asset.body.sha256);
      assert.equal(saved.body.bytes, undefined);
      assert.equal(
        directMediaEvidenceStructureV1(
          { ...media, assets: [saved] },
          inventory('<a assetId="' + assetId + '">File</a>').references,
        ).complete,
        false,
        "An archive reference without hydrated original bytes is incomplete",
      );
    }
  }
});

test("native anchor validation rejects foreign URLs, wrong owners, MIME, receipts and changed metadata", async () => {
  const { media } = await captureOriginal(),
    references = inventory(
      '<a assetId="' + assetId + '" href="' + canonicalUrl + '">File</a>',
    ).references;
  for (const mutate of [
    (copy) => {
      copy.assets[0].assetId = "x".repeat(22);
    },
    (copy) => {
      copy.assets[0].body.mime = "text/html";
    },
    (copy) => {
      copy.assets[0].body.receipt.sha256 = "0".repeat(64);
    },
    (copy) => {
      copy.assets[0].body.receipt.bytes++;
    },
    (copy) => {
      copy.assets[0].metadataReceipt.requestQuery = [["ids", "x".repeat(22)]];
    },
    (copy) => {
      copy.assets[0].stability.metadata.elements[0].name = "Changed source.pdf";
    },
  ]) {
    const copy = structuredClone(media);
    mutate(copy);
    assert.equal(
      directMediaEvidenceStructureV1(copy, references).complete,
      false,
      String(mutate),
    );
  }
  assert.equal(
    directMediaEvidenceStructureV1(
      media,
      inventory(
        '<a assetId="' +
          assetId +
          '" href="https://other.cloudfront.net/original">File</a>',
      ).references,
    ).complete,
    false,
  );
  assert.equal(
    directMediaEvidenceStructureV1(
      media,
      inventory(
        '<a id="' +
          assetId +
          '" download="source" href="' +
          canonicalUrl +
          '">File</a>',
      ).references,
    ).complete,
    false,
    "A download anchor DOM id does not establish native ownership",
  );
});
