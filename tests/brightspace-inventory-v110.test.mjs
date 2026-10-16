import test from "node:test";
import assert from "node:assert/strict";
import {
  brightspaceNativeIdV110,
  brightspaceModuleChildrenV110,
  fetchBrightspaceInventoryV110,
  topicEvidencePolicy,
} from "../src/extractors/brightspace/evidence.js";

const endpoint =
  "https://brightspace.example.test/d2l/api/le/1.75/123/quizzes/";
function reader(payloads, overrides = {}) {
  const calls = [];
  return {
    calls,
    options: {
      initialUrl: endpoint,
      label: "Native inventory",
      limit: 100,
      idFields: ["QuestionId"],
      fetchJson: async (url) => {
        calls.push(url);
        const value = payloads[calls.length - 1];
        if (value instanceof Error) throw value;
        return value;
      },
      ...overrides,
    },
  };
}

test("native inventory pagination retains exact duplicate and missing-ID rows with explicit identity anomalies", async () => {
  const rows = [
    { QuestionId: 1, Native: "First observed definition" },
    { QuestionId: 1, Native: "Different repeated definition" },
    { Native: "Missing native identity" },
  ];
  const h = reader([
    { Objects: [rows[0]], Next: "?bookmark=observed" },
    { Objects: rows.slice(1), Next: null },
  ]);
  const before = JSON.stringify(rows),
    result = await fetchBrightspaceInventoryV110(h.options);
  assert.deepEqual(result.objects, rows);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(result.evidence.pageTraversalComplete, true);
  assert.equal(result.evidence.complete, false);
  assert.equal(result.evidence.duplicates, 1);
  assert.equal(result.evidence.missingIdentities, 1);
  assert.deepEqual(
    result.evidence.anomalies.map((row) => row.kind),
    ["DUPLICATE_NATIVE_ID", "MISSING_NATIVE_ID"],
  );
  assert.equal(result.evidence.capturedDefinitions, 3);
  assert.equal(result.evidence.returnedDefinitions, 3);
  assert.deepEqual(h.calls, [endpoint, endpoint + "?bookmark=observed"]);
});

test("arrays and explicit final pages establish inventory traversal only, not authored empty assessment banks", async () => {
  for (const payload of [
    [],
    { Objects: [], Next: null },
    { Objects: [], PagingInfo: { HasMoreItems: false } },
  ]) {
    const h = reader([payload]),
      result = await fetchBrightspaceInventoryV110(h.options);
    assert.equal(result.evidence.complete, true);
    assert.equal(result.evidence.capturedDefinitions, 0);
    assert.equal(Object.hasOwn(result.evidence, "completenessVerified"), false);
  }
  for (const payload of [
    {},
    { Objects: [] },
    {
      Objects: [],
      PagingInfo: {
        HasMoreItems: true,
        Bookmark: "native-but-no-declared-next-route",
      },
    },
  ]) {
    const h = reader([payload]),
      result = await fetchBrightspaceInventoryV110(h.options);
    assert.equal(result.evidence.complete, false);
    assert.equal(
      h.calls.length,
      1,
      "The reader does not invent a continuation route or query contract",
    );
  }
});

test("the native inventory cap records omitted rows and never disguises a capped array as complete", async () => {
  const h = reader(
    [[{ QuestionId: 1 }, { QuestionId: 2 }, { QuestionId: 3 }]],
    { limit: 2 },
  );
  const result = await fetchBrightspaceInventoryV110(h.options);
  assert.deepEqual(result.objects, [{ QuestionId: 1 }, { QuestionId: 2 }]);
  assert.equal(result.evidence.stopReason, "DEFINITION_LIMIT");
  assert.equal(result.evidence.complete, false);
  assert.equal(result.evidence.returnedDefinitions, 3);
  assert.equal(result.evidence.capturedDefinitions, 2);
  const invalid = await fetchBrightspaceInventoryV110(
    reader([[null, null, null, null]], { limit: 2 }).options,
  );
  assert.equal(invalid.evidence.invalidRows, 2);
  assert.equal(invalid.evidence.anomalies.length, 2);
  assert.equal(invalid.evidence.stopReason, "DEFINITION_LIMIT");
});

test("only declared continuation URLs for the same exact endpoint can be requested", async () => {
  for (const next of [
    "https://other.example.test/steal",
    "/d2l/api/le/1.75/123/grades/",
    endpoint + "#fragment",
    "https://name:secret@brightspace.example.test/d2l/api/le/1.75/123/quizzes/",
    42,
  ]) {
    const h = reader([{ Objects: [{ QuestionId: 1 }], Next: next }]);
    const result = await fetchBrightspaceInventoryV110(h.options);
    assert.equal(h.calls.length, 1);
    assert.equal(result.evidence.complete, false);
    assert.match(result.evidence.stopReason, /NEXT_URL/);
  }
  const repeated = reader([{ Objects: [{ QuestionId: 1 }], Next: endpoint }]);
  assert.equal(
    (await fetchBrightspaceInventoryV110(repeated.options)).evidence.stopReason,
    "REPEATED_PAGE",
  );
  assert.equal(repeated.calls.length, 1);
});

test("an unavailable later page preserves earlier native rows and an explicit partial receipt", async () => {
  const h = reader([
    { Objects: [{ QuestionId: 1 }], Next: "?next=observed" },
    Error("HTTP 403"),
  ]);
  const result = await fetchBrightspaceInventoryV110(h.options);
  assert.deepEqual(result.objects, [{ QuestionId: 1 }]);
  assert.equal(result.evidence.stopReason, "PAGE_UNAVAILABLE");
  assert.equal(result.evidence.complete, false);
  await assert.rejects(
    fetchBrightspaceInventoryV110(reader([Error("HTTP 403")]).options),
    /HTTP 403/,
  );
});

test("native IDs used by D2L routes must be numeric and never fall back to positions or paths", () => {
  for (const id of [
    undefined,
    "",
    "../private",
    "12/grades",
    "1?scope=other",
    "source-name",
    " 1",
    1.5,
    -1,
    {},
    Infinity,
  ]) {
    assert.equal(
      brightspaceNativeIdV110({ QuestionId: id }, ["QuestionId"]),
      "",
    );
  }
  assert.equal(
    brightspaceNativeIdV110({ QuestionId: "12345" }, ["QuestionId"]),
    "12345",
  );
  assert.equal(
    brightspaceNativeIdV110({ QuestionId: 42 }, ["QuestionId"]),
    "42",
  );
});

test("TOC fallback retains native ordered children and exposes separate-array ordering limitations", () => {
  const topic = { Id: 11, Type: 1, Title: "Literal topic" },
    module = { Id: 12, Type: 0, Title: "Literal nested module", Topics: [] };
  const ordered = brightspaceModuleChildrenV110({ Structure: [topic, module] });
  assert.equal(ordered.recognized, true);
  assert.equal(ordered.ordering, "NATIVE_ORDERED_LIST");
  assert.deepEqual(
    ordered.children.map((row) => row.kind),
    ["TOPIC", "MODULE"],
  );
  assert.equal(ordered.children[0].raw, topic);
  const split = brightspaceModuleChildrenV110({
    Modules: [module],
    Topics: [topic],
  });
  assert.equal(
    split.ordering,
    "SEPARATE_NATIVE_ARRAYS_INTERLEAVING_UNVERIFIED",
  );
  assert.deepEqual(
    split.children.map((row) => row.raw),
    [module, topic],
  );
  assert.equal(brightspaceModuleChildrenV110({}).recognized, false);
  assert.equal(
    brightspaceModuleChildrenV110([{ Unknown: "Retain this raw model" }])
      .children[0].kind,
    "UNKNOWN",
  );
});

test("unimplemented tools do not claim collected API definitions or launch learner pages", () => {
  for (const activity of [10, 11, 12, 20, 21, 22, 23, 24, 25, 26, 27, 29]) {
    const policy = topicEvidencePolicy(
      activity,
      "https://brightspace.example.test/dynamic/tool",
    );
    assert.equal(policy.fetch, false);
    assert.equal(policy.status, "UNSUPPORTED_ACTIVITY_DEFINITION");
    assert.match(policy.reason, /no supported native definition reader/);
  }
  for (const activity of [3, 4, 5, 6])
    assert.equal(
      topicEvidencePolicy(activity, "https://brightspace.example.test/tool")
        .status,
      "DEFINITION_API_ONLY",
    );
});
