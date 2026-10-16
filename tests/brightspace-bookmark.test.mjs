import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { brightspaceSource } from "../src/generated/extractor-sources.js";
import { CTI_RELEASE_REGISTRY_ } from "../src/engine/release.js";
import {
  BRIGHTSPACE_BOOKMARK_NAME,
  BRIGHTSPACE_BOOKMARK_MAX_BYTES,
  createBrightspaceCaptureScript,
  createBrightspaceCaptureBookmark,
} from "../src/domain/brightspace-bookmark.ts";

function decode(address) {
  assert(address.startsWith("javascript:"));
  return decodeURIComponent(address.slice("javascript:".length));
}

test("current Brightspace release preserves the read-only source and learner-data boundaries", () => {
  const release = CTI_RELEASE_REGISTRY_.brightspaceExtractor;
  assert.equal(release.schema, 2);
  assert(brightspaceSource.includes(release.version));
  assert(brightspaceSource.includes(release.build));
  assert.match(brightspaceSource, /methodsUsed\s*:\s*\[\s*['"]GET['"]\s*\]/);
  assert.doesNotMatch(
    brightspaceSource,
    /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
  );
  assert.match(brightspaceSource, /401\/403/);
  for (const excluded of [
    "learner submissions",
    "quiz attempts",
    "discussion posts",
    "grades",
    "classlist/user roster",
  ])
    assert(brightspaceSource.includes(excluded));
  assert.doesNotThrow(() => new vm.Script(brightspaceSource));
});

test("Brightspace bookmark retains the exact maintained standalone source", () => {
  const script = createBrightspaceCaptureScript();
  const address = createBrightspaceCaptureBookmark();
  assert.equal(BRIGHTSPACE_BOOKMARK_NAME, "CTI Brightspace capture");
  assert.equal(script, "void " + brightspaceSource);
  assert.equal(decode(address), script);
  assert(
    new TextEncoder().encode(address).byteLength <
      BRIGHTSPACE_BOOKMARK_MAX_BYTES,
  );
  assert.doesNotThrow(() => new vm.Script(script));
});

test("Brightspace bookmark preserves literal Unicode and URL punctuation without replacing the document", () => {
  const literal = "Original café 日本語 🧪 #?% ;:/@&=+$,\n\t";
  const source =
    "(()=>{globalThis.observed=" +
    JSON.stringify(literal) +
    ";return '<html>must not replace the course</html>';})()";
  const address = createBrightspaceCaptureBookmark(source);
  const canonical = new URL(address);
  assert.equal(canonical.href, address);
  assert.equal(canonical.search, "");
  assert.equal(canonical.hash, "");
  assert.equal(decode(canonical.href), "void " + source);
  const context = vm.createContext({});
  assert.equal(new vm.Script(decode(address)).runInContext(context), undefined);
  assert.equal(context.observed, literal);
});

test("an async Brightspace bookmark runs once with an undefined completion value", async () => {
  const source =
    "(async()=>{globalThis.started=(globalThis.started||0)+1;await Promise.resolve();globalThis.finished=true;return 'replace';})()";
  const context = vm.createContext({});
  assert.equal(
    new vm.Script(
      decode(createBrightspaceCaptureBookmark(source)),
    ).runInContext(context),
    undefined,
  );
  await Promise.resolve();
  assert.equal(context.started, 1);
  assert.equal(context.finished, true);
});

test("Brightspace bookmark refuses truncation at the same strict Chrome bound as Coursera", () => {
  const sourceFor = (length) => '(()=>"' + "x".repeat(length) + '")()';
  const overhead = createBrightspaceCaptureBookmark(sourceFor(0)).length;
  const largest = sourceFor(BRIGHTSPACE_BOOKMARK_MAX_BYTES - overhead - 1);
  const address = createBrightspaceCaptureBookmark(largest);
  assert.equal(address.length, BRIGHTSPACE_BOOKMARK_MAX_BYTES - 1);
  assert.equal(decode(address), createBrightspaceCaptureScript(largest));
  for (const extra of [0, 1, 1024]) {
    const oversized = sourceFor(
      BRIGHTSPACE_BOOKMARK_MAX_BYTES - overhead + extra,
    );
    assert.throws(
      () => createBrightspaceCaptureBookmark(oversized),
      /too large.*complete script copy fallback/i,
    );
    assert.equal(
      createBrightspaceCaptureScript(oversized),
      "void " + oversized,
    );
  }
  for (const unavailable of ["", " \r\n\t ", null, 17, {}])
    assert.throws(
      () => createBrightspaceCaptureBookmark(unavailable),
      /unavailable in this build/i,
    );
});

test("the production-minified Brightspace bookmark creator keeps its delivered source independent of module bindings", async () => {
  const entry = "cti-brightspace-bookmark-delivery",
    virtual = "\0" + entry;
  const source = fileURLToPath(
    new URL("../src/domain/brightspace-bookmark.ts", import.meta.url),
  );
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    plugins: [
      {
        name: entry,
        resolveId(id) {
          if (id === entry) return virtual;
        },
        load(id) {
          if (id === virtual)
            return (
              "import {createBrightspaceCaptureBookmark} from " +
              JSON.stringify(source) +
              ";globalThis.__brightspaceBookmark=createBrightspaceCaptureBookmark();"
            );
        },
      },
    ],
    build: {
      write: false,
      minify: true,
      target: "es2022",
      rollupOptions: { input: entry, output: { format: "iife" } },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((value) => value.output)
    .filter((value) => value.type === "chunk");
  assert.equal(chunks.length, 1);
  const context = vm.createContext({ TextEncoder });
  new vm.Script(chunks[0].code).runInContext(context);
  const address = context.__brightspaceBookmark;
  assert.equal(address, createBrightspaceCaptureBookmark());
  assert.equal(decode(address), "void " + brightspaceSource);
  assert.doesNotThrow(() => new vm.Script(decode(address)));
});
