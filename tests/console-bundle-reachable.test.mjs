import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { bundleConsole } from "../tools/console-bundle.mjs";

function fixture(files, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cti-console-reachable-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source);
    }
    return check(path.join(dir, "entry.js"), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const program = (body) => '(() => { "use strict"; ' + body + " })();";
function execute(source) {
  const context = {};
  vm.runInNewContext(source, context);
  return context.answer;
}

test("reachable linking follows imported transitive helpers and literal constants without including unrelated exports", () => {
  fixture(
    {
      "entry.js":
        'import {start} from "./start.js";\n' +
        program("globalThis.answer=start(4);"),
      "start.js":
        'import {leaf,OFFSET,unused} from "./leaf.js";\nexport function start(value) {return leaf(value) + OFFSET;}',
      "leaf.js":
        'export const OFFSET = 7;\nexport function leaf(value) {return value * 2;}\nexport function unused() {return "OMIT_UNRELATED_EXPORT";}',
    },
    (entry) => {
      const selected = bundleConsole(entry, { onlyReachable: true }),
        full = bundleConsole(entry);
      assert.equal(execute(selected), 15);
      assert.equal(execute(full), 15);
      assert(selected.includes("function start("));
      assert(selected.includes("function leaf("));
      assert(selected.includes("const OFFSET = 7;"));
      assert(!selected.includes("OMIT_UNRELATED_EXPORT"));
      assert(full.includes("OMIT_UNRELATED_EXPORT"));
      assert.equal(bundleConsole(entry, { onlyReachable: false }), full);
    },
  );
});

test("same-file nested function, constant and parameter shadows cannot pull in top-level exports", () => {
  fixture(
    {
      "entry.js":
        'import {run} from "./helpers.js";\n' +
        program("globalThis.answer=run(5);"),
      "helpers.js": [
        "export const LOCAL = 1000;",
        'export function nested() {return "OMIT_SHADOWED_FUNCTION";}',
        'export function argument() {return "OMIT_SHADOWED_PARAMETER";}',
        "export function run(argument) {",
        "  const LOCAL = 3;",
        "  function nested() {return argument + LOCAL;}",
        "  return nested();",
        "}",
      ].join("\n"),
    },
    (entry) => {
      const source = bundleConsole(entry, { onlyReachable: true });
      assert.equal(execute(source), 8);
      assert(!source.includes("OMIT_SHADOWED_FUNCTION"));
      assert(!source.includes("OMIT_SHADOWED_PARAMETER"));
      assert(!source.includes("const LOCAL = 1000;"));
      assert(source.includes("const LOCAL = 3;"));
    },
  );
});

test("shorthand properties retain imported value bindings needed by the returned object", () => {
  fixture(
    {
      "entry.js":
        'import {build} from "./helpers.js";\n' +
        program(
          "const services=build(); globalThis.answer=services.adjust(services.OFFSET);",
        ),
      "helpers.js":
        'import {adjust,OFFSET,unrelated} from "./values.js";\nexport function build() {return {adjust,OFFSET};}',
      "values.js":
        'export const OFFSET = 11;\nexport function adjust(value) {return value + 1;}\nexport function unrelated() {return "OMIT_SHORTHAND_UNRELATED";}',
    },
    (entry) => {
      const source = bundleConsole(entry, { onlyReachable: true });
      assert.equal(execute(source), 12);
      assert(source.includes("function adjust("));
      assert(source.includes("const OFFSET = 11;"));
      assert(!source.includes("OMIT_SHORTHAND_UNRELATED"));
    },
  );
});

test("actual template interpolations retain dependencies while property names and literal text do not", () => {
  fixture(
    {
      "entry.js":
        'import {render} from "./helpers.js";\n' +
        program("globalThis.answer=render({unused:2});"),
      "helpers.js": [
        'import {adjust,OFFSET} from "./values.js";',
        'export function unused() {return "OMIT_PROPERTY_OR_TEXT";}',
        "export function render(value) {return `${adjust(OFFSET)}:${value.unused}:${({unused:4}).unused}:unused()`;}",
      ].join("\n"),
      "values.js":
        "export const OFFSET = 9;\nexport function adjust(value) {return value * 2;}",
    },
    (entry) => {
      const source = bundleConsole(entry, { onlyReachable: true });
      assert.equal(execute(source), "18:2:4:unused()");
      assert(source.includes("function adjust("));
      assert(source.includes("const OFFSET = 9;"));
      assert(!source.includes("OMIT_PROPERTY_OR_TEXT"));
    },
  );
});

test("selected function declarations preserve their original text instead of minifying or rewriting their bodies", () => {
  const original = [
    "function preserved(value) {",
    "  // This spacing and comment are part of the source-preserving boundary.",
    '  const literal = "two  spaces";',
    "  return `${value} :: ${literal}`;",
    "}",
  ].join("\n");
  fixture(
    {
      "entry.js":
        'import {preserved} from "./helpers.js";\n' +
        program('globalThis.answer=preserved("exact");'),
      "helpers.js":
        "export " + original + "\nexport function unrelated() {return 1;}",
    },
    (entry) => {
      const source = bundleConsole(entry, { onlyReachable: true });
      assert(source.includes(original));
      assert.equal(execute(source), "exact :: two  spaces");
      assert(!source.includes("function unrelated("));
    },
  );
});

test("import aliases and missing exports remain rejected even when the imported name is unused", () => {
  for (const onlyReachable of [false, true]) {
    fixture(
      {
        "entry.js":
          'import {value as renamed} from "./helpers.js";\n' +
          program("globalThis.answer=1;"),
        "helpers.js": "export function value() {return 2;}",
      },
      (entry) =>
        assert.throws(
          () => bundleConsole(entry, { onlyReachable }),
          /aliases are unsupported/,
        ),
    );
    fixture(
      {
        "entry.js":
          'import {missing} from "./helpers.js";\n' +
          program("globalThis.answer=1;"),
        "helpers.js": "export function value() {return 2;}",
      },
      (entry) =>
        assert.throws(
          () => bundleConsole(entry, { onlyReachable }),
          /Missing console export/,
        ),
    );
  }
});

test("unreachable module side effects and nonliteral state remain forbidden", () => {
  for (const onlyReachable of [false, true])
    for (const invalid of [
      "globalThis.effect = true;",
      "const privateValue = 1;",
      'export const mutable = fetch("https://example.test");',
    ])
      fixture(
        {
          "entry.js":
            'import {valid} from "./helpers.js";\n' +
            program("globalThis.answer=1;"),
          "helpers.js": "export function valid() {return 2;}\n" + invalid,
        },
        (entry) =>
          assert.throws(
            () => bundleConsole(entry, { onlyReachable }),
            /non-export statement|constants must be literals/,
          ),
      );
});
test('the shared diagnostic helper does not permit arbitrary parent-directory imports',()=>{
 fixture({'entry.js':'import {bad} from "../../diagnostics/private.js";\n'+program('bad();')},entry=>assert.throws(()=>bundleConsole(entry),/feature directory/));
});
