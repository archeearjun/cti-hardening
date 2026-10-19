import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as fields from "../src/domain/coursera-retained-authoring-fields.ts";
import { retainedCourseraAuthoringText } from "../src/domain/coursera-retained-authoring-content.ts";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
const hash = value => createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex"),
  cml = text => ({typeName: "cml", definition: {dtdId: "", value: "<co-content>" + (text ? "<text>" + text + "</text>" : "") + "</co-content>"}});
function source(change = () => {}) {
  const model = {id: "a".repeat(22) + "~" + "q".repeat(22) + "@1", definition: {typeName: "mcq", definition: {
    prompt: cml("Original mathematical prompt: 1 + 2 ="), correctOption: "0.9040769677707357", shuffleOptions: false,
    __typename: "ObservedNativeMcqBody", options: [
      {id: "0.9040769677707357", display: cml(""), feedback: cml(""), __typename: "ObservedNativeMcqOption"},
      {id: "0.5358745486502822", display: cml(""), feedback: cml("")},
    ]}}};
  change(model);
  return {kind: "QUESTION_DEFINITION", nativeType: "mcq", nativeId: model.id, ordinal: 1,
    groupId: "a".repeat(22) + "~" + "g".repeat(22), title: "", prompt: "", options: model.definition.definition.options.map(option => ({id: option.id, text: ""})),
    formatStatus: "UNSUPPORTED_CML", nativeValidation: "UNRECORDED", originalModelSha256: hash(model), originalModelJson: JSON.stringify(model, null, 2)};
}

test("well-formed empty native MCQ choices receive a source-defect display with only literal option-ID references", () => {
  const block = source(), before = JSON.stringify(block), view = fields.retainedAuthoringFields(block);
  assert(view);
  assert.equal(view.applicability, "SOURCE_REFERENCE_ONLY");
  assert.equal(view.sourceDefect.status, "CAPTURED_SOURCE_DEFECT");
  assert.deepEqual(view.sourceDefect.emptyOptionOrdinals, [1, 2]);
  assert.equal(view.sourceDefect.nativeCorrectOption.kind, "SOURCE_REFERENCE");
  assert.equal(view.sourceDefect.nativeCorrectOption.value, "0.9040769677707357");
  assert.equal(view.sourceDefect.usableAnswerTextVerified, false);
  assert.equal(view.prompt.value, "Original mathematical prompt: 1 + 2 =");
  assert.equal(view.options[0].display.status, "EXPLICIT_EMPTY_SOURCE");
  assert.equal(view.options[0].display.literal, "<co-content></co-content>");
  assert.equal(view.options[0].feedback.status, "EXPLICIT_EMPTY");
  assert.equal(view.noChosenFeedback.status, "NOT_RECORDED");
  assert.deepEqual(view.answerRecords, []);
  for (const key of ["questions", "correctAnswers", "answerTextReliable", "complete", "questionCount"])
    assert.equal(Object.hasOwn(view, key), false, key);
  assert.equal(JSON.stringify(block), before);
  const text = fields.retainedAuthoringFieldsText(view);
  assert.match(text, /Captured source defect/);
  assert.match(text, /Explicitly empty in captured source/);
  assert.match(text, /SOURCE_REFERENCE/);
  assert(!text.includes("Authored reflection option"));
  const packet = retainedCourseraAuthoringText({schemaVersion: 1, scope: "RETAINED_AUTHORING_CONTENT_ONLY", courseId: "course", itemId: "item", atomId: "atom", draftHash: "a".repeat(64), blocks: [block], proof: {}});
  assert.match(packet, /Authored option 0.9040769677707357: \[Explicitly empty in captured source\]/);
  assert(packet.includes(block.originalModelJson));
  assert(packet.includes(block.originalModelSha256));
});

test("absent, malformed, media-bearing, unknown-dialect and unbound models cannot acquire an explicit-empty claim", () => {
  for (const change of [
    m => delete m.definition.definition.options[0].display,
    m => m.definition.definition.options[0].display.definition.value = "<co-content><text>broken</co-content>",
    m => m.definition.definition.options[0].display = cml('<img assetId="unread"/>'),
    m => m.definition.definition.options[0].display.definition.dtdId = "unknown/1",
    m => m.definition.definition.options[1].id = m.definition.definition.options[0].id,
    m => m.definition.definition.correctOption = "foreign-option",
    m => m.definition.definition.correctOptions = [],
    m => m.definition.typeName = "mcqReflect",
    m => m.definition.definition.unknownMatchingRule = true,
    m => m.definition.definition.options.forEach(option => option.display = cml("Nonempty")),
    m => m.id = "unbound-native-id",
  ]) { const block = source(change); assert.equal(fields.retainedAuthoringFields(block), null, String(change)); }
  const block = source();
  assert.equal(fields.retainedAuthoringFields({...block, nativeId: "different"}), null);
  assert.equal(fields.retainedAuthoringFields({...block, originalModelSha256: "0".repeat(64)}), null);
});

const require = createRequire(import.meta.url), componentModule = {exports: {}}, compiled = ts.transpileModule(fs.readFileSync(new URL("../web/RetainedAuthoringFields.tsx", import.meta.url), "utf8"), {fileName: "RetainedAuthoringFields.tsx", compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
new vm.Script("(function(require,module,exports){" + compiled + "\n})").runInNewContext({})(name => {
  if (name === "react/jsx-runtime") return require(name);
  if (name === "../src/domain/coursera-retained-authoring-fields.ts") return fields;
  throw Error("Unexpected authored-fields dependency: " + name);
}, componentModule, componentModule.exports);
test("owner source-defect UI distinguishes explicit emptiness and ID references without usable answers or active source markup", () => {
  const block = source(), html = renderToStaticMarkup(React.createElement(componentModule.exports.RetainedAuthoringFields, {block, showSourceDetails: true}));
  assert.match(html, /Captured source defect/);
  assert.match(html, /Explicitly empty in captured source/);
  assert.match(html, /Native correct-option ID · SOURCE_REFERENCE/);
  assert.match(html, /Usable answer text remains unverified/);
  assert(!html.includes("Authored reflection option"));
  assert(!html.includes("Choice text not captured"));
  assert(!/<script\b|<iframe\b|<form\b|<input\b|<button\b/i.test(html));
  assert(html.includes("&lt;co-content&gt;&lt;/co-content&gt;"));
});
