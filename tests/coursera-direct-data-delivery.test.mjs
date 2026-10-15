import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { courseraDirectDataSource } from "../src/generated/extractor-sources.js";
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

test("the universal capture bookmark carries the exact standalone current program", () => {
  const script = createCourseraDirectDataCaptureScript();
  const address = createCourseraDirectDataCaptureBookmark();
  assert.equal(script, "void " + courseraDirectDataSource);
  assert.equal(decode(address), script);
  assert.equal(COURSERA_DIRECT_DATA_CAPTURE_VERSION, "1.6.1");
  assert.equal(
    COURSERA_DIRECT_DATA_CAPTURE_BUILD,
    "v1.6.1-provider-access-diagnostics-20261015",
  );
  assert(
    courseraDirectDataSource.includes(COURSERA_DIRECT_DATA_CAPTURE_VERSION),
  );
  assert(courseraDirectDataSource.includes(COURSERA_DIRECT_DATA_CAPTURE_BUILD));
  assert(
    new TextEncoder().encode(address).byteLength <
      COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES,
  );
  assert.doesNotThrow(() => new vm.Script(script));
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
