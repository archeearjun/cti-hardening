import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";

test("nested object key order yields identical source hashes while source array order remains significant", async () => {
  const first = {
    updatedAt: 1700000000000,
    draft: {
      parts: [
        { id: "owner~second", metadata: { z: 2, a: 1 } },
        { id: "owner~first" },
      ],
      content: { value: "Original text", typeName: "cml" },
    },
  };
  const reordered = {
    draft: {
      content: { typeName: "cml", value: "Original text" },
      parts: [
        { metadata: { a: 1, z: 2 }, id: "owner~second" },
        { id: "owner~first" },
      ],
    },
    updatedAt: 1700000000000,
  };
  const a = directCanonicalSourceTextV1(first),
    b = directCanonicalSourceTextV1(reordered);
  assert.equal(a, b);
  assert.deepEqual(JSON.parse(a), first);
  const bytes = new TextEncoder().encode(a);
  const browserDigest = Buffer.from(
    await webcrypto.subtle.digest("SHA-256", bytes),
  ).toString("hex");
  assert.equal(browserDigest, Buffer.from(sha256(bytes)).toString("hex"));
  assert.equal(
    browserDigest,
    createHash("sha256").update(a, "utf8").digest("hex"),
  );
  reordered.draft.parts.reverse();
  assert.notEqual(directCanonicalSourceTextV1(reordered), a);
});

test("JSON string escaping preserves controls, supplementary characters, lone surrogates and non-ASCII source", () => {
  const value = {
    "\u0000key": '"\\\n\r\t\b\f\u0001',
    unicode: "é漢😀\ud800x\udfff\u2028",
    numeric: [-0, 1e-7, 1e21],
    empty: [],
  };
  const canonical = directCanonicalSourceTextV1(value);
  assert.deepEqual(JSON.parse(canonical), JSON.parse(JSON.stringify(value)));
  assert(canonical.includes("\\ud800"));
  assert(canonical.includes("\\udfff"));
  assert.equal(canonical, directCanonicalSourceTextV1(JSON.parse(canonical)));
});

test("shared JSON-shaped values serialize twice while actual reference cycles fail", () => {
  const shared = { b: 2, a: 1 };
  assert.equal(
    directCanonicalSourceTextV1([shared, shared]),
    '[{"a":1,"b":2},{"a":1,"b":2}]',
  );
  const object = {};
  object.self = object;
  const array = [];
  array.push(array);
  for (const value of [object, array])
    assert.throws(() => directCanonicalSourceTextV1(value), {
      message: "DIRECT_DATA_CANONICAL_CYCLE",
    });
});

test("non-JSON values, sparse arrays, class instances and accessors cannot silently disappear from source hashing", () => {
  class Model {
    constructor() {
      this.id = "source";
    }
  }
  const sparse = Array(1),
    extra = [1];
  extra.metadata = 1;
  for (const value of [
    undefined,
    () => {},
    Symbol("id"),
    1n,
    NaN,
    Infinity,
    -Infinity,
    new Date(),
    new Map(),
    new Set(),
    new Uint8Array([1]),
    new Model(),
    sparse,
    extra,
    { id: "source", unsupported: undefined },
    { id: "source", unsupported: () => {} },
    [undefined],
  ])
    assert.throws(() => directCanonicalSourceTextV1(value), {
      message: "DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE",
    });
  let reads = 0;
  const accessor = {
    get content() {
      reads++;
      return "Not JSON";
    },
  };
  assert.throws(() => directCanonicalSourceTextV1(accessor), {
    message: "DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE",
  });
  assert.equal(reads, 0);
  const symbolKey = {};
  symbolKey[Symbol("id")] = "value";
  assert.throws(() => directCanonicalSourceTextV1(symbolKey), {
    message: "DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE",
  });
});

test("depth and node bounds reject excessive source graphs before allocating an unbounded output", () => {
  let allowed = null;
  for (let i = 0; i < 64; i++) allowed = [allowed];
  assert.doesNotThrow(() => directCanonicalSourceTextV1(allowed));
  assert.throws(() => directCanonicalSourceTextV1([allowed]), {
    message: "DIRECT_DATA_CANONICAL_DEPTH_LIMIT",
  });
  assert.throws(
    () => directCanonicalSourceTextV1(new Array(1000000).fill(null)),
    { message: "DIRECT_DATA_CANONICAL_NODE_LIMIT" },
  );
});

test("the byte bound includes JSON escaping and UTF-8 rather than just UTF-16 string length", () => {
  const maxBytes = 32 * 1024 * 1024;
  for (const value of [
    "x".repeat(maxBytes),
    "\u0000".repeat(Math.ceil(maxBytes / 6)),
    "😀".repeat(maxBytes / 4),
  ])
    assert.throws(() => directCanonicalSourceTextV1(value), {
      message: "DIRECT_DATA_CANONICAL_BYTE_LIMIT",
    });
});

test("the serialized helper has no external bindings and accepts JSON objects from another realm", () => {
  const standalone = vm.runInNewContext(
    "(" + directCanonicalSourceTextV1.toString() + ")",
  );
  const nullPrototype = Object.assign(Object.create(null), {
    z: 1,
    a: "source",
  });
  for (const value of [
    { z: 1, a: { b: 2, a: 1 } },
    nullPrototype,
    ["é", null, { id: "owner~part" }],
  ])
    assert.equal(standalone(value), directCanonicalSourceTextV1(value));
});
