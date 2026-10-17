import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  deriveBrightspaceHtmlStructure,
  validateBrightspaceHtmlStructure,
  brightspaceHtmlStructureText,
} from "../src/domain/brightspace-html-structure.ts";
import {
  BRIGHTSPACE_TABBED_HTML as html,
  BRIGHTSPACE_TABBED_SOURCE_URL as sourceUrl,
} from "./fixtures/brightspace-tabbed-html.mjs";

const context = (body = html) => ({
  topicId: "topic-tabs",
  originalRef: createHash("sha256").update(body).digest("hex"),
  sourceUrl,
});
function widget(labels, panels, prefix = "") {
  return `<div class="d2l-element" data-type="horizontal">${prefix}<div class="tabs-wrapper tabs-horizontal"><div class="list-group">${labels.map(([key, label]) => `<a class="list-group-item"><span data-itemprop="${key}|0">${label}</span></a>`).join("")}</div><div class="tab-content">${panels.map(([key, body]) => `<div class="tab-pane" data-itemprop="${key}|1">${body}</div>`).join("")}</div></div></div>`;
}
function derive(body = html) {
  const original = /<html(?:\s|>)/i.test(body)
    ? body
    : `<html><body>${body}</body></html>`;
  const result = deriveBrightspaceHtmlStructure(original, context(original));
  if (result) validateBrightspaceHtmlStructure(result, context(original));
  return result;
}

test("all static hidden panels retain exact scoped bindings; parser never executes scripts", () => {
  delete globalThis.__ctiSourceScriptRan;
  const actual = derive();
  assert.equal(globalThis.__ctiSourceScriptRan, undefined);
  assert.deepEqual(
    actual.groups.map((group) => group.panels.map((panel) => panel.key)),
    [["0", "1"], ["0"]],
  );
  assert.equal(
    actual.groups[0].instruction,
    "Choose a tab & inspect its source content.\n",
  );
  assert.equal(actual.groups[0].panels[0].label, "Introduction & purpose");
  assert.equal(actual.groups[0].panels[0].activeAtCapture, true);
  assert.equal(actual.groups[0].panels[1].activeAtCapture, false);
  assert.match(
    actual.groups[0].panels[1].text,
    /Hidden authored prose & symbols\./,
  );
  assert.doesNotMatch(
    actual.groups[0].panels[1].text,
    /inventedRuntimeContent/,
  );
  assert.equal(actual.groups[1].panels[0].label, "Second widget label");
  assert.deepEqual(actual.issues, []);
  assert.equal(actual.truncated, false);
  assert.equal(actual.scope, "STATIC_MARKUP_ONLY");
});

test("resource titles and literal empty versus absent alt survive; base cannot override original response URL", () => {
  const resources = derive().groups[0].panels[1].resources;
  assert.equal(resources[0].title, "Named synthetic activity");
  assert.equal(
    resources[0].url,
    "https://source.example.test/d2l/common/dialogs/quickLink/quickLink.d2l?type=lti&rCode=synthetic",
  );
  assert.equal(
    resources[1].url,
    "https://source.example.test/content/drawing.png?version=3",
  );
  assert.equal(resources[1].alt, "");
  assert.equal(resources[2].alt, null);
  assert.equal(resources[2].title, null);
});

test("tables retain authored row/cell order, headers, empty cells and unexpanded spans", () => {
  const [table] = derive().groups[0].panels[1].tables;
  assert.equal(table.caption, "Authored dimensions");
  assert.deepEqual(table.rows, [
    {
      cells: [
        { kind: "th", text: "Type", rowSpan: "2", colSpan: null },
        { kind: "th", text: "Value", rowSpan: null, colSpan: "2" },
      ],
    },
    {
      cells: [
        { kind: "td", text: "", rowSpan: null, colSpan: null },
        { kind: "td", text: "42", rowSpan: null, colSpan: null },
        { kind: "td", text: "mm", rowSpan: null, colSpan: null },
      ],
    },
  ]);
});

test("nested widget indices are isolated from their parent and separate sibling groups", () => {
  const nested = widget([["0", "Inner label"]], [["0", "<p>Inner only.</p>"]]);
  const body =
    widget([["0", "Outer label"]], [["0", `<p>Outer only.</p>${nested}`]]) +
    widget([["0", "Sibling label"]], [["0", "Sibling only."]]);
  const actual = derive(body);
  assert.equal(actual.groups.length, 3);
  assert.deepEqual(
    actual.groups.map((group) => group.panels[0].label),
    ["Outer label", "Inner label", "Sibling label"],
  );
  assert.match(actual.groups[0].panels[0].text, /Outer only/);
  assert.doesNotMatch(
    actual.groups[0].panels[0].text,
    /Inner only|Inner label|Sibling/,
  );
  assert.equal(actual.groups[1].panels[0].text.includes("Outer"), false);
});

test("ambiguous or missing bindings are diagnosed without inventing or borrowing panels", () => {
  const body = widget(
    [
      ["0", "First"],
      ["0", "Duplicate"],
      ["1", "Missing"],
      ["3", "Good"],
    ],
    [
      ["0", "Ambiguous body"],
      ["2", "Orphan body"],
      ["3", "Known body"],
    ],
  );
  const actual = derive(body);
  assert.deepEqual(
    actual.groups[0].panels.map((panel) => panel.key),
    ["3"],
  );
  assert.equal(actual.issues.length, 3);
  assert.match(actual.issues.join(" "), /KEY_0_AMBIGUOUS_OR_MISSING_PAIR/);
  assert.match(actual.issues.join(" "), /KEY_1_AMBIGUOUS_OR_MISSING_PAIR/);
  assert.match(actual.issues.join(" "), /KEY_2_AMBIGUOUS_OR_MISSING_PAIR/);
  assert.equal(actual.truncated, false);
});

test("multiple wrappers in one widget never supply a fabricated mapping", () => {
  const body =
    '<div class="d2l-element" data-type="horizontal"><div class="tabs-wrapper tabs-horizontal"></div><div class="tabs-wrapper tabs-horizontal"></div></div>';
  const actual = derive(body);
  assert.equal(actual.groups.length, 1);
  assert.deepEqual(actual.groups[0].panels, []);
  assert.deepEqual(actual.issues, ["GROUP_1_AMBIGUOUS_WRAPPER"]);
});

test("malformed nested panes cannot lend text, resources or tables to their outer panel", () => {
  const nested =
    '<div class="tab-pane" data-itemprop="1|1"><p>Nested unbound prose</p><table><tr><td>Nested table</td></tr></table><iframe src="nested.html"></iframe></div>';
  const body = widget(
    [
      ["0", "Outer"],
      ["1", "Malformed nested"],
    ],
    [["0", `<p>Outer prose</p>${nested}`]],
  );
  const actual = derive(body);
  assert.deepEqual(
    actual.groups[0].panels.map((panel) => panel.key),
    ["0"],
  );
  assert.match(actual.issues.join(" "), /NESTED_PANEL_UNRESOLVED/);
  assert.doesNotMatch(actual.groups[0].panels[0].text, /Nested/);
  assert.deepEqual(actual.groups[0].panels[0].tables, []);
  assert.deepEqual(actual.groups[0].panels[0].resources, []);
});

test("unsafe resource schemes and credentials retain only authored URL; ordinary query strings remain exact", () => {
  const urls = [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///private",
    "https://user:secret@external.example.test/frame",
    "//safe.example.test/frame?a=1&amp;b=2",
  ];
  const body = widget(
    [["0", "Resources"]],
    [
      [
        "0",
        urls.map((url) => `<iframe src="${url}" title=""></iframe>`).join(""),
      ],
    ],
  );
  const resources = derive(body).groups[0].panels[0].resources;
  assert.deepEqual(
    resources.map((resource) => resource.url),
    ["", "", "", "", "https://safe.example.test/frame?a=1&b=2"],
  );
  assert.equal(resources[0].rawUrl, urls[0]);
  assert.equal(resources[0].title, "");
});

test("invalid or missing provenance never derives a structure", () => {
  for (const invalid of [
    { ...context(), topicId: "" },
    { ...context(), originalRef: "not-a-hash" },
    { ...context(), sourceUrl: "file:///private/guide.html" },
    {
      ...context(),
      sourceUrl: "https://user:secret@source.example.test/guide.html",
    },
    { ...context(), sourceUrl: "https://source.example.test/\nprivate" },
  ]) {
    assert.equal(deriveBrightspaceHtmlStructure(html, invalid), null);
    assert.throws(() => validateBrightspaceHtmlStructure(derive(), invalid));
  }
});

test("old/plain/unsupported HTML has no fabricated tab structure", () => {
  assert.equal(derive("<p>Existing legacy prose only.</p>"), null);
  assert.equal(
    derive('<div role="tab">Unsupported independently unbound label.</div>'),
    null,
  );
  assert.equal(derive('<script>"d2l-element tabs-horizontal"</script>'), null);
  assert.equal(
    derive(
      '<template><div class="d2l-element" data-type="horizontal"><div class="tabs-wrapper tabs-horizontal"></div></div></template>',
    ),
    null,
  );
});

test("node, depth, group and input limits yield bounded explicit diagnostics", () => {
  const base = widget([["0", "Known"]], [["0", "Static body"]]);
  const cases = [
    [base + "x".repeat(4 * 1024 * 1024), "HTML_INPUT_LIMIT_EXCEEDED"],
    [base + "<p></p>".repeat(50000), "HTML_DOM_LIMIT_EXCEEDED"],
    [
      base + "<div>".repeat(121) + "x" + "</div>".repeat(121),
      "HTML_DOM_LIMIT_EXCEEDED",
    ],
    [base.repeat(51), "WIDGET_LIMIT_EXCEEDED"],
  ];
  for (const [body, code] of cases) {
    const actual = derive(body);
    assert.equal(actual.truncated, true, code);
    assert.ok(actual.issues.includes(code), code);
    assert.ok(Buffer.byteLength(JSON.stringify(actual)) <= 1024 * 1024);
  }
});

test("panel preview and total saved projection budgets are bounded across all nested strings", () => {
  const body = widget([["0", "Long"]], [["0", "x".repeat(110000)]]);
  const actual = derive(body);
  assert.equal(actual.truncated, true);
  assert.equal(actual.groups[0].panels[0].textTruncated, true);
  assert.equal(actual.groups[0].panels[0].text.length, 100000);
  const mutated = derive();
  mutated.groups[0].panels[0].text = "x".repeat(70000);
  mutated.groups[0].panels[1].text = "y".repeat(70000);
  assert.throws(
    () => validateBrightspaceHtmlStructure(mutated, context()),
    /Invalid/,
  );
});

test("entity declaration markup is not expanded into captured content", () => {
  const body =
    '<!DOCTYPE html [<!ENTITY custom "invented">]>' +
    widget([["0", "Known"]], [["0", "&custom;"]]);
  const actual = derive(body);
  assert.equal(actual.truncated, true);
  assert.deepEqual(actual.groups, []);
  assert.ok(actual.issues.includes("HTML_ENTITY_DECLARATION_UNSUPPORTED"));
});

test("saved mutation validation binds topic/hash/exact response URL and rejects shape, unsafe URL and duplicate keys", () => {
  const original = derive();
  const mutations = [
    (value) => {
      value.topicId = "different-native-item";
    },
    (value) => {
      value.originalRef = "0".repeat(64);
    },
    (value) => {
      value.sourceUrl = sourceUrl + "&changed=1";
    },
    (value) => {
      value.scope = "RUNTIME_VERIFIED";
    },
    (value) => {
      value.groups[0].panels[0].unexpected = "unvalidated";
    },
    (value) => {
      value.groups[0].panels[1].resources[0].url = "javascript:injected()";
    },
    (value) => {
      value.groups[0].panels[1].resources[0].url =
        "https://wrong.example.test/";
    },
    (value) => {
      value.groups[0].panels[1].key = "0";
    },
    (value) => {
      value.groups[0].panels[1].tables[0].rows[0].cells[0].kind =
        "inferred-heading";
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(original);
    mutate(value);
    assert.throws(
      () => validateBrightspaceHtmlStructure(value, context()),
      /Invalid/,
    );
  }
  validateBrightspaceHtmlStructure(structuredClone(original), context());
});

test("static report export preserves table associations, literal reference titles and runtime caveat", () => {
  const text = brightspaceHtmlStructureText(derive());
  assert.match(text, /static authored HTML only/);
  assert.match(text, /Tab 1: Hidden source panel/);
  assert.match(text, /Authored title: Named synthetic activity/);
  assert.match(text, /Authored alt text: \[empty attribute\]/);
  assert.match(text, /Authored alt text: \[attribute absent\]/);
  assert.match(text, /Row 1: th rowspan=2: Type \| th colspan=2: Value/);
  assert.match(text, /Row 2: td:  \| td: 42 \| td: mm/);
  assert.match(
    text,
    /do not establish rendered visibility, playback or loaded external activity content/,
  );
  assert.doesNotMatch(text, /inventedRuntimeContent/);
});

test("many empty candidate widgets cannot induce quadratic wrapper discovery", () => {
  const body =
    '<div class="d2l-element" data-type="horizontal"></div>'.repeat(10000) +
    widget([["0", "Only supported"]], [["0", "Native prose"]]);
  const start = performance.now();
  const actual = derive(body);
  assert.equal(actual.groups.length, 1);
  assert.equal(actual.groups[0].panels[0].label, "Only supported");
  // A generous ceiling catches the previously observed ~10s quadratic scan.
  assert.ok(performance.now() - start < 5000);
});
