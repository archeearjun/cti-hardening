import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveBrightspaceHtmlStructure } from "../src/domain/brightspace-html-structure.ts";
import {
  BRIGHTSPACE_TABBED_HTML,
  BRIGHTSPACE_TABBED_SOURCE_URL,
} from "./fixtures/brightspace-tabbed-html.mjs";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(
  new URL("../web/BrightspaceHtmlStructure.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  fileName: "BrightspaceHtmlStructure.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
const componentModule = { exports: {} };
new vm.Script(
  "(function(require, module, exports) {" + compiled + "\n})",
).runInNewContext({})(
  (name) => {
    if (name === "react/jsx-runtime") return require(name);
    throw Error("Unexpected HTML structure component dependency: " + name);
  },
  componentModule,
  componentModule.exports,
);
const Component = componentModule.exports.default;
const context = {
  topicId: "1234",
  originalRef: "f".repeat(64),
  sourceUrl: "https://lms.example.test/content/course/lesson.html",
};
function group(text, extra = "", active = "") {
  return `<div class="d2l-element" data-type="horizontal">
  <div class="instruction">Choose an authored tab.</div>
  <div class="tabs-wrapper tabs-horizontal">
  <div class="list-group"><a class="list-group-item"><span data-itemprop="0|0">Repeated &lt;tab&gt; label</span></a></div>
  <div class="tab-content"><div class="tab-pane ${active}" data-itemprop="0|1"><p>${text}</p>${extra}</div></div>
  </div></div>`;
}
function fixture() {
  return deriveBrightspaceHtmlStructure(
    `<html><body>${group(
      "Hidden original &lt;script&gt;literal&lt;/script&gt; text",
      `<table><caption>Literal &lt;caption&gt;</caption><tbody><tr><th></th><th>Original header</th></tr><tr><td rowspan="2">Cell &lt;img src=x&gt;</td><td colspan="2">Second cell</td></tr></tbody></table>
       <iframe src="/d2l/common/dialogs/quickLink/quickLink.d2l?ou=99&amp;type=lti&amp;rCode=frame_a" title="Original &lt;video&gt; title"></iframe>
       <img src="lesson.png" alt="" title="">
       <img src="unobserved.png">
       <img src="ambiguous.png" alt="Literal &lt;drawing&gt;">
       <img src="javascript:alert(1)" alt="Unsafe URL remains literal">`,
    )}${group("Second group only", "", "active show")}</body></html>`,
    context,
  );
}
function reference(overrides) {
  return {
    url: "",
    rawUrl: "",
    tag: "img",
    attribute: "src",
    status: "CAPTURED",
    reason: "",
    originalRef: "",
    alt: "",
    text: "",
    ...overrides,
  };
}
function references() {
  return [
    reference({
      rawUrl:
        "/d2l/common/dialogs/quickLink/quickLink.d2l?ou=99&type=lti&rCode=frame_a",
      tag: "iframe",
      status: "EXTERNAL_LTI_NOT_FETCHED",
      reason: "External inner document was not read.",
    }),
    reference({
      url: "https://lms.example.test/content/course/lesson.png",
      rawUrl: "lesson.png",
      originalRef: "original/images/lesson.png",
    }),
    reference({ rawUrl: "ambiguous.png", status: "FIRST_MATCH_MUST_NOT_LEAK" }),
    reference({
      rawUrl: "ambiguous.png",
      status: "SECOND_MATCH_MUST_NOT_LEAK",
    }),
    reference({
      rawUrl: "lesson.png",
      tag: "iframe",
      status: "WRONG_TAG_LEAK",
    }),
    reference({
      rawUrl: "lesson.png",
      attribute: "href",
      status: "WRONG_ATTRIBUTE_LEAK",
    }),
  ];
}
function render(structure = fixture(), refs = references()) {
  assert(
    structure,
    "the synthetic fixture has a recognized authored tab group",
  );
  return renderToStaticMarkup(
    React.createElement(Component, { structure, references: refs }),
  );
}

test("shared source fixture displays the supported static tabs without running source scripts", () => {
  const structure = deriveBrightspaceHtmlStructure(BRIGHTSPACE_TABBED_HTML, {
    ...context,
    sourceUrl: BRIGHTSPACE_TABBED_SOURCE_URL,
  });
  const html = render(structure, []);
  assert.equal((html.match(/data-html-group=/g) || []).length, 2);
  assert.equal((html.match(/data-html-panel=/g) || []).length, 3);
  assert.match(html, /Hidden authored prose &amp; symbols/);
  assert.match(html, /Named synthetic activity/);
  assert.match(html, /Authored dimensions/);
  assert(!html.includes("inventedRuntimeContent"));
  assert(!html.includes("__ctiSourceScriptRan"));
});

test("static structure UI preserves hidden panel association, repeated keys and literal markup without loading resources", () => {
  const html = render();
  assert.match(html, /aria-label="Captured tabs and tables"/);
  assert.match(html, /<summary>Captured tabs and tables<\/summary>/);
  assert.match(html, /Static markup preview/);
  assert.match(html, /does not establish live layout, playback/);
  assert.match(html, /data-html-group="1"/);
  assert.match(html, /data-html-group="2"/);
  assert.match(html, /data-html-panel="1:0" data-html-panel-key="0"/);
  assert.match(html, /data-html-panel="2:0" data-html-panel-key="0"/);
  assert.equal((html.match(/Repeated &lt;tab&gt; label/g) || []).length, 2);
  assert.match(
    html,
    /Hidden original &lt;script&gt;literal&lt;\/script&gt; text/,
  );
  assert.match(html, /Second group only/);
  assert.match(html, /Initial markup state: inactive/);
  assert.match(html, /Initial markup state: active/);
  assert(!/<(?:iframe|img|script|object|embed|video|audio|a)\b/i.test(html));
  assert(!/\son(?:load|error|click)=/i.test(html));
  assert.match(html, /Authored URL: javascript:alert\(1\)/);
  assert.match(html, /No safe resolved reference is recorded/);
});

test("resource outcomes require a unique exact role and URL match; empty and absent authored attributes stay distinct", () => {
  const html = render();
  assert.match(html, /Read outcome: EXTERNAL_LTI_NOT_FETCHED/);
  assert.match(html, /External inner document was not read/);
  assert.match(html, /Read outcome: CAPTURED/);
  assert.match(
    html,
    /Retained original reference: original\/images\/lesson.png/,
  );
  assert.match(html, /Authored title: Original &lt;video&gt; title/);
  assert.match(html, /Authored title: empty attribute/);
  assert.match(html, /Authored title: attribute absent/);
  assert.match(html, /Authored image alt: empty attribute/);
  assert.match(html, /Authored image alt: attribute absent/);
  assert.match(html, /Authored image alt: Literal &lt;drawing&gt;/);
  assert.match(html, /unverified — no matching capture reference/);
  assert.match(html, /unverified — multiple matching capture references/);
  assert(
    !/FIRST_MATCH_MUST_NOT_LEAK|SECOND_MATCH_MUST_NOT_LEAK|WRONG_TAG_LEAK|WRONG_ATTRIBUTE_LEAK/.test(
      html,
    ),
  );
});

test("table preview retains header/data distinction and empty cells without interpreting authored span attributes", () => {
  const html = render();
  assert.match(html, /data-html-table="1:0:1"/);
  assert.match(html, /<caption>Literal &lt;caption&gt;<\/caption>/);
  assert.match(html, /<th class="captured-text"><\/th>/);
  assert.match(html, /<th class="captured-text">Original header<\/th>/);
  assert.match(html, /<td class="captured-text">Cell &lt;img src=x&gt;<\/td>/);
  assert.match(html, /rowspan=&quot;2&quot;/);
  assert.match(html, /colspan=&quot;2&quot;/);
  assert(!/<(?:th|td)\b[^>]*(?:rowspan|colspan)=/i.test(html));
  assert.match(html, /class="table-scroll" role="region"/);
  assert.match(html, /max-width:100%;overflow-x:auto/);
});

test("matching raw text cannot borrow a read outcome from a conflicting resolved URL or an unsafe resource", () => {
  const html = render(fixture(), [
    reference({
      rawUrl: "unobserved.png",
      url: "https://another-source.example.test/unobserved.png",
      status: "FOREIGN_RESOLVED_RESOURCE_LEAK",
      reason: "FOREIGN_REASON_MUST_NOT_LEAK",
    }),
    reference({
      rawUrl: "javascript:alert(1)",
      status: "UNSAFE_RESOURCE_READ_LEAK",
    }),
  ]);
  assert.match(html, /unverified — conflicting or unsafe reference binding/);
  assert(
    !/FOREIGN_RESOLVED_RESOURCE_LEAK|FOREIGN_REASON_MUST_NOT_LEAK|UNSAFE_RESOURCE_READ_LEAK/.test(
      html,
    ),
  );
});

test("preview truncation and unresolved mappings stay explicit without adding source text", () => {
  const structure = fixture();
  structure.truncated = true;
  structure.issues = ["Duplicate authored key remains unresolved."];
  structure.groups[0].panels[0].textTruncated = true;
  const html = render(structure, []);
  assert.match(html, /This structure preview is truncated/);
  assert.match(html, /This panel text preview is truncated/);
  assert.match(html, /Duplicate authored key remains unresolved/);
  assert.match(html, /Read outcome: unverified/);
  assert(!/Read outcome: CAPTURED/.test(html));
});
