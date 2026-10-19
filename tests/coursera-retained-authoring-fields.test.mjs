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

const hash = (value) =>
  createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex");
const cml = (text, dtdId = "assess/1") => ({
  typeName: "cml",
  definition: {
    dtdId,
    value:
      "<co-content><text>" +
      text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;") +
      "</text></co-content>",
  },
});
function block(type = "textExactMatch", change = () => {}) {
  const model =
    type === "storedTextBlockPart"
      ? {
          typeName: type,
          definition: {
            id: "native-instruction",
            title: "Original instructions",
            body: cml("Submit the original work."),
          },
        }
      : {
          id: "native-question@3",
          definition: {
            typeName: type,
            definition: {
              prompt: cml("Original prompt"),
              options:
                type === "textExactMatch"
                  ? [
                      {
                        id: "authored-answer",
                        answer: " 0.50 \n",
                        isCorrect: false,
                        feedback: cml("Authored feedback"),
                      },
                    ]
                  : [
                      { id: "first", display: cml("First"), feedback: cml("") },
                      { id: "second", display: cml("Second") },
                    ],
              shuffleOptions: false,
              ...(type === "textExactMatch"
                ? { defaultIncorrectFeedback: cml("") }
                : {}),
            },
          },
        };
  change(model);
  return {
    kind: type === "storedTextBlockPart" ? "TEXT_BLOCK" : "QUESTION_DEFINITION",
    ordinal: 3,
    nativeId: type === "storedTextBlockPart" ? model.definition.id : model.id,
    groupId: "native-group",
    nativeType: type,
    title: "",
    prompt: "Existing projection",
    options: [],
    formatStatus: "KNOWN_CML",
    nativeValidation: "READY",
    originalModelSha256: hash(model),
    originalModelJson: JSON.stringify(model, null, 2),
  };
}

test("exact authored answers preserve literal whitespace, native false versus absent flags, and feedback without choice or key promotion", () => {
  const source = block("textExactMatch", (model) => {
      model.definition.definition.options.push(
        { id: "no-flag", answer: "" },
        { id: "no-answer", isCorrect: true },
      );
    }),
    before = structuredClone(source),
    view = fields.retainedAuthoringFields(source);
  assert(view);
  assert.equal(view.applicability, "AUTHORED_ANSWER_RECORDS_OBSERVED");
  assert.equal(view.answerRecords[0].answer.value, " 0.50 \n");
  assert.equal(view.answerRecords[0].answer.literal, " 0.50 \n");
  assert.equal(view.answerRecords[0].isCorrect.status, "PRESENT");
  assert.equal(view.answerRecords[0].isCorrect.value, false);
  assert.equal(view.answerRecords[1].answer.status, "EXPLICIT_EMPTY");
  assert.equal(view.answerRecords[1].answer.value, "");
  assert.equal(view.answerRecords[1].isCorrect.status, "NOT_RECORDED");
  assert.equal(view.answerRecords[2].answer.status, "NOT_RECORDED");
  assert.equal(view.answerRecords[2].isCorrect.value, true);
  assert.equal(view.answerRecords[0].feedback.value, "Authored feedback");
  assert.equal(view.defaultIncorrectFeedback.status, "EXPLICIT_EMPTY");
  assert.equal(view.options.length, 0);
  for (const name of [
    "questions",
    "correctAnswers",
    "answerTextReliable",
    "complete",
    "questionCount",
  ])
    assert.equal(
      Object.hasOwn(view, name),
      false,
      "A display must not invent primary evidence fields",
    );
  assert.match(
    view.applicabilityReason,
    /matching rules and answer validity remain unverified/,
  );
  assert.deepEqual(source, before);
});

test("literal field types and missing versus explicitly empty answer collections stay distinct", () => {
  const badBoolean = fields.retainedAuthoringFields(
    block("textExactMatch", (model) => {
      model.definition.definition.options[0].isCorrect = "false";
    }),
  );
  assert.equal(
    badBoolean.answerRecords[0].isCorrect.status,
    "UNSUPPORTED_VALUE",
  );
  assert.equal(badBoolean.answerRecords[0].isCorrect.value, null);
  const missing = fields.retainedAuthoringFields(
    block("textExactMatch", (model) => {
      delete model.definition.definition.options;
    }),
  );
  const empty = fields.retainedAuthoringFields(
    block("textExactMatch", (model) => {
      model.definition.definition.options = [];
    }),
  );
  assert.equal(missing.answerRecordsStatus, "NOT_RECORDED");
  assert.equal(missing.applicability, "UNVERIFIED");
  assert.equal(empty.answerRecordsStatus, "EXPLICIT_EMPTY");
  assert.equal(empty.answerRecords.length, 0);
});

test("reflection types retain native option order and explicit empty, missing and unsupported feedback without inferred correctness", () => {
  for (const type of ["mcqReflect", "checkboxReflect"]) {
    const view = fields.retainedAuthoringFields(
      block(type, (model) => {
        model.definition.definition.noChosenFeedback = cml("");
        model.definition.definition.options.push({
          id: "third",
          display: cml("Third"),
          feedback: cml("Unknown original", "unknown/9"),
        });
      }),
    );
    assert.equal(view.applicability, "UNKEYED_NATIVE_REFLECTION");
    assert.deepEqual(
      view.options.map((option) => option.id.value),
      ["first", "second", "third"],
    );
    assert.equal(view.options[0].feedback.status, "EXPLICIT_EMPTY");
    assert.equal(view.options[1].feedback.status, "NOT_RECORDED");
    assert.equal(view.options[2].feedback.status, "UNSUPPORTED_CML");
    assert.match(view.options[2].feedback.literal, /Unknown original/);
    assert.equal(view.options[2].feedback.dtdId, "unknown/9");
    assert.equal(view.noChosenFeedback.status, "EXPLICIT_EMPTY");
    assert.equal(view.shuffleOptions.value, false);
    assert.equal(view.answerRecords.length, 0);
    assert(
      view.options.every(
        (option) =>
          !Object.hasOwn(option, "isCorrect") &&
          !Object.hasOwn(option, "correct"),
      ),
    );
    assert.match(view.applicabilityReason, /No answer key has been inferred/);
  }
});

test("unexpected reflection key fields never receive the unkeyed applicability claim", () => {
  for (const change of [
    (model) => {
      model.definition.definition.correctOption = "first";
    },
    (model) => {
      model.definition.definition.correctOptions = [];
    },
    (model) => {
      model.definition.definition.options[0].isCorrect = false;
    },
  ])
    assert.equal(
      fields.retainedAuthoringFields(block("mcqReflect", change)).applicability,
      "UNVERIFIED",
    );
});

test("instruction title and body remain an instruction-only display with no answer records or questions", () => {
  const source = block("storedTextBlockPart"),
    view = fields.retainedAuthoringFields(source);
  assert(view);
  assert.equal(view.kind, "TEXT_BLOCK");
  assert.equal(view.ordinal, 3);
  assert.equal(view.nativeId, "native-instruction");
  assert.equal(view.title.value, "Original instructions");
  assert.equal(view.prompt.path, "body");
  assert.equal(view.prompt.value, "Submit the original work.");
  assert.equal(view.applicability, "NOT_APPLICABLE_INSTRUCTION");
  assert.equal(view.answerRecords.length, 0);
  assert.equal(view.options.length, 0);
  assert.equal(view.originalModelSha256, source.originalModelSha256);
  assert.equal(view.originalModelJson, source.originalModelJson);
});

test("unknown CML dialects and media-bearing CML stay literal unsupported fields instead of invented readable content", () => {
  const unknown = fields.retainedAuthoringFields(
    block("textExactMatch", (model) => {
      model.definition.definition.prompt = cml("Uninterpreted", "");
    }),
  );
  assert.equal(unknown.prompt.status, "UNSUPPORTED_CML");
  assert.equal(unknown.prompt.value, null);
  assert.equal(unknown.prompt.dtdId, "");
  assert.match(unknown.prompt.literal, /Uninterpreted/);
  const media = fields.retainedAuthoringFields(
    block("storedTextBlockPart", (model) => {
      model.definition.body.definition.value =
        '<co-content><img src="https://example.test/original.png"/></co-content>';
    }),
  );
  assert.equal(media.prompt.status, "UNSUPPORTED_CML");
  assert.equal(media.prompt.value, null);
  assert.match(media.prompt.literal, /original.png/);
});

test("raw-model reuse checks identity, canonical original hash and bounded input without rewriting source or persisted blocks", () => {
  const source = block(),
    model = JSON.parse(source.originalModelJson);
  assert.deepEqual(
    fields.retainedRawAuthoringFields(source.originalModelJson, source),
    fields.retainedAuthoringFields(source),
  );
  const compact = fields.retainedRawAuthoringFields(
    JSON.stringify(model),
    source,
  );
  assert(compact);
  assert.equal(compact.originalModelJson, JSON.stringify(model));
  for (const invalid of [
    { ...source, nativeId: "different" },
    { ...source, nativeType: "mcqReflect" },
    { ...source, kind: "TEXT_BLOCK" },
    { ...source, originalModelSha256: "0".repeat(64) },
    { ...source, ordinal: 0 },
    { ...source, originalModelJson: "{" },
    {
      ...source,
      originalModelJson: " ".repeat(
        fields.MAX_RETAINED_AUTHORING_FIELD_JSON_CHARACTERS + 1,
      ),
    },
  ])
    assert.equal(fields.retainedAuthoringFields(invalid), null);
  const tooMany = block("mcqReflect", (value) => {
    value.definition.definition.options = Array.from(
      { length: 201 },
      () => ({}),
    );
  });
  assert.equal(fields.retainedAuthoringFields(tooMany), null);
  let deep = {};
  for (let i = 0; i < 101; i++) deep = { child: deep };
  const excessiveDepth = block(),
    deepModel = JSON.parse(excessiveDepth.originalModelJson);
  deepModel.unknownOriginal = deep;
  excessiveDepth.originalModelJson = JSON.stringify(deepModel);
  assert.equal(fields.retainedAuthoringFields(excessiveDepth), null);
  assert.equal(
    fields.retainedAuthoringFields(block("mcq")),
    null,
    "Unsupported models remain in their existing literal-original view",
  );
});

test("additional typed text exports retain exact originals and hashes while preserving the existing source block shape", () => {
  const source = block(),
    before = structuredClone(source),
    originalKeys = Object.keys(source);
  const text = retainedCourseraAuthoringText({
    schemaVersion: 1,
    scope: "RETAINED_AUTHORING_CONTENT_ONLY",
    courseId: "native-course",
    itemId: "native-item",
    atomId: "native-atom",
    draftHash: "a".repeat(64),
    blocks: [source],
    proof: {},
  });
  assert.match(text, /TYPED AUTHORED SOURCE FIELDS/);
  assert(text.includes("Literal authored answer [PRESENT]:  0.50 \n"));
  assert.match(text, /Native isCorrect field \[PRESENT\]: false/);
  assert.match(text, /Default incorrect feedback \[EXPLICIT_EMPTY\]/);
  assert(text.includes(source.originalModelJson));
  assert(text.includes(source.originalModelSha256));
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(source), originalKeys);
});

// Render the maintained component with React and the real domain helper.
const require = createRequire(import.meta.url),
  componentModule = { exports: {} };
const compiled = ts.transpileModule(
  fs.readFileSync(
    new URL("../web/RetainedAuthoringFields.tsx", import.meta.url),
    "utf8",
  ),
  {
    fileName: "RetainedAuthoringFields.tsx",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  },
).outputText;
new vm.Script(
  "(function(require,module,exports){" + compiled + "\n})",
).runInNewContext({})(
  (name) => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "../src/domain/coursera-retained-authoring-fields.ts")
      return fields;
    throw Error("Unexpected authored-fields component dependency: " + name);
  },
  componentModule,
  componentModule.exports,
);
const Component = componentModule.exports.RetainedAuthoringFields;
test("owner UI shows literal authored values and distinct field states as inert text without grading controls", () => {
  const source = block("textExactMatch", (model) => {
      model.definition.definition.options[0].answer =
        '  <script>alert("original")</script>  \n';
    }),
    html = renderToStaticMarkup(
      React.createElement(Component, {
        block: source,
        showSourceDetails: true,
      }),
    );
  assert.match(html, /Authored text-answer fields/);
  assert.match(html, /Native isCorrect field/);
  assert.match(html, />false<\/pre>/);
  assert.match(html, /Explicitly empty supported CML text/);
  assert(
    html.includes(
      "  &lt;script&gt;alert(&quot;original&quot;)&lt;/script&gt;  \n",
    ),
  );
  assert(!/<script\b|<iframe\b|<form\b|<input\b|<button\b/i.test(html));
  assert(html.includes(source.originalModelSha256));
  assert(html.includes(source.nativeId));
  const reflection = renderToStaticMarkup(
    React.createElement(Component, { block: block("mcqReflect") }),
  );
  assert.match(reflection, /No answer key has been inferred/);
  assert.match(reflection, /Explicitly empty supported CML text/);
  assert.match(reflection, /Not recorded in this native model/);
  assert(!reflection.includes("Literal original native model"));
  const instruction = renderToStaticMarkup(
    React.createElement(Component, {
      view: fields.retainedAuthoringFields(block("storedTextBlockPart")),
    }),
  );
  assert.match(instruction, /Authored instruction fields/);
  assert(!instruction.includes("Authored answer record"));
  assert.equal(
    renderToStaticMarkup(
      React.createElement(Component, {
        block: { ...source, originalModelSha256: "0".repeat(64) },
      }),
    ),
    "",
  );
});
