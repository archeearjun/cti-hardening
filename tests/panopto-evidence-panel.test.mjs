import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as panopto from "../src/domain/panopto-delivery-info.ts";
import * as panoptoScript from "../src/domain/panopto-delivery-script.ts";
import { safeWebUrl } from "../src/domain/owner-urls.ts";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";

// Exercise the maintained component with real React, domain validation and
// synthetic delivery metadata. No browser server or external player is needed.
const require = createRequire(import.meta.url);
const source = fs.readFileSync(
  new URL("../web/PanoptoEvidencePanel.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  fileName: "PanoptoEvidencePanel.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
const componentModule = { exports: {} };
const loadComponent = new vm.Script(
  "(function(require, module, exports) {" + compiled + "\n})",
  { filename: "PanoptoEvidencePanel.transpiled.cjs" },
).runInNewContext({ URL });
loadComponent(
  (name) => {
    if (name === "../src/domain/panopto-delivery-info") return panopto;
    if (name === "../src/domain/panopto-delivery-script") return panoptoScript;
    if (name === "../src/domain/owner-actions") return { safeWebUrl };
    if (name === "./workspace-ui")
      return {
        download() {
          throw Error("Server rendering must not download evidence.");
        },
      };
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw Error("Unexpected panel dependency: " + name);
  },
  componentModule,
  componentModule.exports,
);
const PanoptoEvidencePanel = componentModule.exports.default;

async function fixture() {
  const native = panoptoDeliveryFixture();
  const capture = await panopto.importPanoptoDeliveryInfo(
    native.responseText,
    native.spec,
    native.targetUrl,
  );
  return { ...native, capture };
}

function render(f, overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(PanoptoEvidencePanel, {
      spec: f.spec,
      targets: [f.targetUrl],
      captures: [f.capture],
      editable: true,
      onCapture: async () => {
        throw Error("Server rendering must not save evidence.");
      },
      ...overrides,
    }),
  );
}

test("Panopto metadata renders authored title and OCR labels as literal text", async () => {
  const f = await fixture();
  const html = render(f);
  assert(
    html.includes(
      "Synthetic &amp;lt;video&amp;gt; &amp;amp; &lt;markup&gt; literal",
    ),
  );
  assert(
    html.includes(
      "Synthetic section 1 &amp;lt;label&amp;gt; &amp;amp; &lt;literal&gt;",
    ),
  );
  assert(!html.includes("<markup>"));
  assert(!html.includes("<literal>"));

  f.model.Delivery.SessionName = 'Synthetic <img src="x" onerror="alert(1)">';
  f.model.Delivery.Timestamps[0].Caption =
    "Synthetic <script>alert(2)</script>";
  f.capture = await panopto.importPanoptoDeliveryInfo(
    JSON.stringify(f.model),
    f.spec,
    f.targetUrl,
  );
  const hostile = render(f);
  assert(
    hostile.includes(
      "Synthetic &lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;",
    ),
  );
  assert(hostile.includes("Synthetic &lt;script&gt;alert(2)&lt;/script&gt;"));
  assert(!/<(?:img|script)\b/i.test(hostile));
});

test("caption and media roles retain the limits of reported delivery metadata", async () => {
  const html = render(await fixture());
  assert(html.includes("No caption tracks reported in the imported response."));
  assert(html.includes("Caption absence has not been independently verified."));
  assert(
    html.includes("They do not establish caption or transcript coverage."),
  );
  assert.match(html, /<strong>Viewer stream<\/strong> · Reported format: hls/);
  assert.match(html, /<strong>Podcast stream<\/strong> · Reported format: mp4/);
  assert(html.includes("Open reported viewer stream ↗"));
  assert(html.includes("Open reported podcast stream ↗"));
  assert(
    html.includes(
      "These references do not establish that the media files were captured or that a stream is the original upload.",
    ),
  );
  assert(!/>Download (?:original|video|media|MP4)\b/i.test(html));
});

test("historical import time remains labelled and saved metadata survives absent current targets", async () => {
  const f = await fixture();
  f.capture.importedAt = "2021-02-03T04:05:06.000Z";
  const html = render(f, { targets: [] });
  assert.match(html, /Imported <time dateTime="2021-02-03T04:05:06\.000Z">/);
  assert(
    html.includes(
      "The response observation time was not independently recorded.",
    ),
  );
  assert(
    html.includes(
      "Previous target: this link is absent from the current captured references.",
    ),
  );
  assert(html.includes("Imported Panopto metadata"));
  assert(html.includes("Download saved Panopto metadata"));
  assert(!/<(?:input|textarea|select)\b/.test(html));
  assert(!html.includes("Save Panopto metadata</button>"));
  const unrelated = render(f, {
    targets: [
      "https://video.example.test/another-page?id=" + f.ids.A,
      "https://video.example.test/Panopto/Pages/Embed.aspx",
      "javascript:alert(1)",
    ],
  });
  assert(!/<(?:input|textarea|select)\b/.test(unrelated));
  assert.equal(render(f, { targets: [], captures: [] }), "");
});

test("read-only reviews retain metadata and disable import controls", async () => {
  const html = render(await fixture(), { editable: false });
  assert(html.includes("Imported Panopto metadata"));
  assert.match(html, /<textarea\b[^>]*\bdisabled=""/);
  assert.match(html, /<input\b[^>]*type="file"[^>]*\bdisabled=""/);
  assert.match(
    html,
    /<button\b[^>]*\bdisabled=""[^>]*>Save Panopto metadata<\/button>/,
  );
});

test("invalid saved metadata raises an alert without discarding valid or original saved evidence", async () => {
  const f = await fixture();
  const invalid = {
    ...structuredClone(f.capture),
    nativeModelSha256: "0".repeat(64),
    title: "UNTRUSTED_DERIVED_TITLE",
  };
  const captures = [f.capture, invalid];
  const before = JSON.stringify(captures);
  const html = render(f, { captures });
  assert.match(html, /role="alert"/);
  assert(
    html.includes(
      "It remains saved and has not been used as current evidence.",
    ),
  );
  assert(html.includes("Imported Panopto metadata"));
  assert(!html.includes("UNTRUSTED_DERIVED_TITLE"));
  assert.equal(JSON.stringify(captures), before);
});

test("saved display fields are recomputed from the retained native response", async () => {
  const f = await fixture();
  const tampered = {
    ...structuredClone(f.capture),
    title: "UNTRUSTED_DERIVED_TITLE",
    streams: [],
    navigation: [{ text: "UNTRUSTED_DERIVED_TRANSCRIPT", timeSeconds: 0 }],
    captions: { status: "REPORTED_PRESENT_UNSUPPORTED" },
    limitations: [],
  };
  const before = structuredClone(tampered);
  const html = render(f, { captures: [tampered] });
  assert(!html.includes("UNTRUSTED_DERIVED_TITLE"));
  assert(!html.includes("UNTRUSTED_DERIVED_TRANSCRIPT"));
  assert(html.includes("Synthetic section 1"));
  assert(html.includes("Open reported viewer stream ↗"));
  assert(html.includes("Caption absence has not been independently verified."));
  assert.deepEqual(tampered, before);
});
