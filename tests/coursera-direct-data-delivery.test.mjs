import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { bundleConsole } from "../tools/console-bundle.mjs";
import { CTI_RELEASE_REGISTRY_ } from "../src/engine/release.js";
import {
  courseraDirectDataSource,
  courseraDirectDataBookmarkSource,
} from "../src/generated/extractor-sources.js";
import { formatJavaScriptBookmarkProgram } from "../tools/bookmark-program.mjs";
import {
  COURSERA_DIRECT_DATA_CAPTURE_VERSION,
  COURSERA_DIRECT_DATA_CAPTURE_BUILD,
  COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES,
  createCourseraDirectDataCaptureScript,
  createCourseraDirectDataCaptureBookmark,
} from "../src/domain/coursera-direct-data-capture.ts";

const decode = (address) => {
  assert(address.startsWith("javascript:"));
  return decodeURIComponent(address.slice("javascript:".length));
};

test("the universal bookmark carries the parser-formatted current program while console delivery retains its exact source", () => {
  const script = createCourseraDirectDataCaptureScript();
  const address = createCourseraDirectDataCaptureBookmark();
  assert.equal(script, "void " + courseraDirectDataSource);
  assert(
    courseraDirectDataSource ===
      bundleConsole(fileURLToPath(new URL("../src/extractors/coursera/direct-data-entry.js", import.meta.url)), { onlyReachable: true }),
    "Console delivery retains the source-preserving linker's exact output.",
  );
  assert(
    fs.readFileSync(new URL("../src/generated/coursera-direct-data.js", import.meta.url), "utf8") === courseraDirectDataSource,
    "The downloadable console program keeps the original linked source.",
  );
  assert.equal(decode(address), "void " + courseraDirectDataBookmarkSource);
  assert(
    courseraDirectDataBookmarkSource === formatJavaScriptBookmarkProgram(courseraDirectDataSource),
    "The bookmark is the parser-formatted copy of the same linked source.",
  );
  assert(courseraDirectDataBookmarkSource.length < courseraDirectDataSource.length);
  assert(address.length < 410 * 1024, "Parser formatting retains at least 90 KiB headroom below the unchanged 500 KiB browser limit.");
  assert.equal(COURSERA_DIRECT_DATA_CAPTURE_VERSION, "1.8.6");
  assert.equal(
    COURSERA_DIRECT_DATA_CAPTURE_BUILD,
    "v1.8.6-publisher-back-matter-20261019",
  );
  assert.deepEqual(CTI_RELEASE_REGISTRY_.directDataCourseraExtractor, {
    version: "v" + COURSERA_DIRECT_DATA_CAPTURE_VERSION,
    schema: 35,
    build: COURSERA_DIRECT_DATA_CAPTURE_BUILD,
    delivery: "GENERATED_BROWSER_BUNDLE",
  });
  assert.equal(CTI_RELEASE_REGISTRY_.courseraExtractor.version, "v6.15.33");
  assert(
    courseraDirectDataSource.includes(COURSERA_DIRECT_DATA_CAPTURE_VERSION),
  );
  assert(courseraDirectDataSource.includes(COURSERA_DIRECT_DATA_CAPTURE_BUILD));
  assert(
    new TextEncoder().encode(address).byteLength <
      COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES,
  );
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotThrow(() => new vm.Script(decode(address)));
});

test("bookmark delivery preserves Unicode and prevents a string result from replacing Coursera", () => {
  const source =
    "(()=>{globalThis.observed='Synthetic 測試 🧪 #?%';return '<html>replace</html>';})()";
  const address = createCourseraDirectDataCaptureBookmark(source);
  assert.equal(decode(address), "void " + source);
  const context = vm.createContext({});
  assert.equal(new vm.Script(decode(address)).runInContext(context), undefined);
  assert.equal(context.observed, "Synthetic 測試 🧪 #?%");
});

test("async bookmark programs execute once and leave an undefined completion value", async () => {
  const source =
    "(async()=>{globalThis.executions=(globalThis.executions||0)+1;await Promise.resolve();globalThis.finished=true;return 'replace';})()";
  const context = vm.createContext({});
  const result = new vm.Script(
    decode(createCourseraDirectDataCaptureBookmark(source)),
  ).runInContext(context);
  assert.equal(result, undefined);
  await Promise.resolve();
  assert.equal(context.executions, 1);
  assert.equal(context.finished, true);
});

test("URI-safe punctuation remains compact without creating a query or fragment", () => {
  const literal = "Synthetic 測試 🧪 #?% ;:/@&=+$,\\\"\n\t";
  const source = "(()=>{globalThis.observed=" + JSON.stringify(literal) +
    ";globalThis.match=/[?#%]/.test(globalThis.observed);})()";
  const address = createCourseraDirectDataCaptureBookmark(source);
  const canonical = new URL(address);
  assert.equal(canonical.href, address);
  assert.equal(canonical.search, "");
  assert.equal(canonical.hash, "");
  assert.equal(decode(canonical.href), "void " + source);
  assert(address.length < ("javascript:" + encodeURIComponent("void " + source)).length);
  const context = vm.createContext({});
  new vm.Script(decode(canonical.href)).runInContext(context);
  assert.equal(context.observed, literal);
  assert.equal(context.match, true);
});

test("large fallback addresses retain every character below the browser size bound", () => {
  const source =
    '(()=>"' +
    "x".repeat(COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES - 100) +
    '")()';
  const address = createCourseraDirectDataCaptureBookmark(source);
  assert(address.length > COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES - 100);
  assert(address.length < COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES);
  assert.equal(decode(address), createCourseraDirectDataCaptureScript(source));
});

test("oversized bookmark programs fail explicitly instead of truncating source", () => {
  const source =
    '(()=>"' + "x".repeat(COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES) + '")()';
  assert.throws(
    () => createCourseraDirectDataCaptureBookmark(source),
    /too large.*complete script copy fallback/i,
  );
  assert.equal(createCourseraDirectDataCaptureScript(source), "void " + source);
  for (const source of ["", " \n\t "])
    assert.throws(
      () => createCourseraDirectDataCaptureBookmark(source),
      /unavailable in this build/i,
    );
});
