import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createEngine } from "../src/engine/index.js";
import { createBrowserServices } from "../src/adapters/browser-services.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { resolveZipEntryV8_ } from "../src/source/zip.js";
import { ctiDeclaredQuizCountFromText_ } from "../src/extractors/brightspace/text-and-dom.js";
import { normalizeName } from "../src/extractors/coursera/text-and-dom.js";
import { bundleConsole } from "../tools/console-bundle.mjs";

test("independent feature imports work without a shared engine", () => {
  assert.equal(
    normalizeName("  Introduction  to  Math "),
    "introduction to math",
  );
  assert.equal(
    ctiDeclaredQuizCountFromText_("There are eight (8) questions."),
    8,
  );
  assert.equal(
    resolveZipEntryV8_(
      {},
      ["docs/guide.pdf"],
      "imsmanifest.xml",
      "docs/guide.pdf",
    ).path,
    "docs/guide.pdf",
  );
  assert.equal(
    resolveZipEntryV8_(
      {},
      ["guide.pdf"],
      "imsmanifest.xml",
      "https://elsewhere.test/guide.pdf",
    ).method,
    "EXTERNAL_REFERENCE",
  );
});

test("engine instances retain their own XML service through interleaved calls", () => {
  const counts = [0, 0];
  const engines = counts.map((_, i) =>
    createEngine({
      ...createBrowserServices(),
      XmlService: {
        parse(xml) {
          counts[i]++;
          return workerXml.parse(xml);
        },
      },
    }),
  );
  const xml =
    '<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1"><organizations><organization><item identifier="root"><title>Course</title></item></organization></organizations><resources/></manifest>';
  for (const i of [0, 1, 0])
    assert.equal(
      engines[i].analyzeImsccCore_(xml, "fixture.xml", "").success,
      true,
    );
  assert.deepEqual(counts, [2, 1]);
  for (const e of engines)
    for (const name of [
      "authorize_",
      "doGet",
      "persistQaRun_",
      "getDatabaseSheet_",
    ])
      assert.equal(e[name], undefined);
});

test("console modules link without executing the entry point during build", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cti-console-test-"));
  try {
    fs.writeFileSync(path.join(dir, "config.js"), "export const VALUE = 3;");
    fs.writeFileSync(
      path.join(dir, "helper.js"),
      'import {VALUE} from "./config.js";\nexport function value() {return VALUE;}',
    );
    fs.writeFileSync(
      path.join(dir, "entry.js"),
      'import {value} from "./helper.js";\n(function(){"use strict"; globalThis.answer=value();})();',
    );
    const script = bundleConsole(path.join(dir, "entry.js")),
      context = {};
    assert.equal(globalThis.answer, undefined);
    vm.runInNewContext(script, context);
    assert.equal(context.answer, 3);
    fs.writeFileSync(
      path.join(dir, "helper.js"),
      'export const VALUE = fetch("https://example.test");',
    );
    assert.throws(() => bundleConsole(path.join(dir, "entry.js")), /literal/);
    fs.writeFileSync(
      path.join(dir, "helper.js"),
      "export function other() {return 1;}",
    );
    assert.throws(
      () => bundleConsole(path.join(dir, "entry.js")),
      /Missing console export/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
