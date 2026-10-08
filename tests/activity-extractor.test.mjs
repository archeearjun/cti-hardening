import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fingerprintsFromMaterial } from "../src/extractors/coursera/evidence.js";
import {
  hashRemoteAsset,
  uniqueAssetDetails,
} from "../src/extractors/coursera/assets.js";

test("canonical material traversal retains module/lesson IDs through reused titles and nested structures", async () => {
  const data = {
    elements: [
      {
        id: "m1",
        name: "Module",
        elements: [
          {
            id: "l1",
            name: "Lesson",
            elements: [
              {
                id: "one",
                name: "Reading",
                content: { typeName: "supplement" },
              },
            ],
          },
        ],
      },
      {
        id: "m2",
        name: "Module",
        elements: [
          {
            id: "l2",
            name: "Lesson",
            elements: [
              {
                id: "two",
                name: "Reading",
                content: { typeName: "supplement" },
              },
            ],
          },
        ],
      },
    ],
  };
  const rows = await fingerprintsFromMaterial(data);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows[0].ancestors.map((a) => a.id),
    ["m1", "l1"],
  );
  assert.deepEqual(
    rows[1].ancestors.map((a) => a.id),
    ["m2", "l2"],
  );
  assert.notEqual(rows[0].ancestors[1].key, rows[1].ancestors[1].key);
});
test("canonical PDF retention reuses bounded hash fetches and never archives an HTML login response", async () => {
  const originalFetch = globalThis.fetch,
    originalLocation = globalThis.location;
  globalThis.location = { origin: "https://www.coursera.org" };
  let calls = 0,
    body = Buffer.from("%PDF-1.4\nFixture");
  globalThis.fetch = async () => {
    calls++;
    return new Response(body, {
      headers: { "Content-Type": "application/pdf" },
    });
  };
  const budget = () => ({
    remaining: 5000,
    cache: new Map(),
    documents: new Map(),
    documentRemaining: 1000,
    deadline: Date.now() + 3000,
  });
  try {
    const b = budget(),
      a = { url: "https://a.cloudfront.net/a.pdf?Signature=one" };
    await hashRemoteAsset(a, b);
    assert.equal(b.documents.size, 1);
    assert.equal(a.documentRef, a.sha256);
    assert.deepEqual(
      Buffer.from(b.documents.get(a.sha256).base64, "base64"),
      body,
    );
    const second = { url: "https://a.cloudfront.net/a.pdf?Signature=two" };
    await hashRemoteAsset(second, b);
    assert.equal(calls, 1);
    assert.equal(second.documentRef, a.documentRef);
    assert.equal(uniqueAssetDetails([a, second])[0].documentRef, a.documentRef);
    assert.equal(b.documentRemaining, 1000 - body.length);
    const small = budget();
    small.documentRemaining = 1;
    const skip = { url: "https://cdn.example/b.pdf" };
    await hashRemoteAsset(skip, small);
    assert.equal(small.documents.size, 0);
    assert(skip.sha256);
    assert.equal(skip.documentRef, "");
    body = Buffer.from("<html>Please sign in</html>");
    const html = budget();
    await hashRemoteAsset({ url: "https://cdn.example/c.pdf" }, html);
    assert.equal(html.documents.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  }
});
test("activity primary script is byte-identical to the maintained CTI extractor delivery", () => {
  const activity = fs.readFileSync(
    "public/activity-designer/downloads/CTI_Coursera_Capture.js",
    "utf8",
  );
  const canonical = fs.readFileSync(
    "src/generated/coursera-console.js",
    "utf8",
  );
  assert.equal(activity, canonical);
});
