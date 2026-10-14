import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { classifyCourseraResourceProjection } from "../src/domain/coursera-resource-projection.ts";

const atomId = "Observed_atom_root_123";
const classify = (value) => classifyCourseraResourceProjection(value, atomId);
function uncertified(result) {
  assert.equal(result.contentCertified, false);
  assert.equal(result.wholeCourseVerified, false);
}

test("an exact identifier-only response distinguishes matching identity from content acquisition", () => {
  const result = classify({
    elements: [{ id: atomId }],
    paging: {},
    linked: {},
  });
  assert.equal(result.status, "IDENTIFIER_ONLY");
  assert.equal(result.schemaFieldCount, 0);
  assert.equal(result.expectedIdObserved, true);
  assert.equal(result.hasRelationMetadata, false);
  uncertified(result);
});

test("declared relation maps do not turn an ID-only row into captured content", () => {
  for (const envelope of [
    { links: { elements: { content: "authoringAtoms.v2" } } },
    {
      links: { elements: { content: "relatedResource.v1/subresource" } },
      linked: {
        "authoringAtoms.v2": [{ id: atomId, metadata: { version: 1 } }],
      },
    },
  ]) {
    const result = classify({ elements: [{ id: atomId }], ...envelope });
    assert.equal(result.status, "IDENTIFIER_ONLY_WITH_RELATION_METADATA");
    assert.equal(result.schemaFieldCount, 0);
    assert.equal(result.expectedIdObserved, true);
    assert.equal(result.hasRelationMetadata, true);
    uncertified(result);
  }
  for (const envelope of [
    { links: {} },
    { links: { elements: {} } },
    { links: { elements: { content: "" } } },
    { links: { elements: { content: "arbitrary text" } } },
    { links: { elements: { content: { resource: "authoringAtoms.v2" } } } },
    { links: [] },
    { links: null },
    { links: "not metadata" },
    { linked: { "authoringAtoms.v2": [] } },
    {
      linked: { "authoringAtoms.v2": [{ id: atomId, content: { parts: [] } }] },
    },
  ])
    assert.equal(
      classify({ elements: [{ id: atomId }], ...envelope }).status,
      "IDENTIFIER_ONLY",
    );
});

test("non-ID fields establish returned schema fields while metadata and apparent questions remain uncertified", () => {
  for (const fields of [
    { metadata: { version: 262 } },
    { content: null },
    {
      content: {
        typeName: "staffGraded",
        definition: { questionGroups: ["observed~group"] },
      },
    },
    {
      parts: [{ id: "observed~group", correctOption: "option-1" }],
      declaredCount: 1,
    },
  ]) {
    const result = classify({
      elements: [{ id: atomId, ...fields }],
      links: { elements: { relation: "related.v1" } },
    });
    assert.equal(result.status, "SCHEMA_FIELDS_RETURNED");
    assert.equal(result.schemaFieldCount, Object.keys(fields).length);
    assert.equal(result.expectedIdObserved, true);
    assert.equal(result.hasRelationMetadata, true);
    uncertified(result);
  }
});

test("a different resource ID remains explicitly unexpected even if it returns content fields", () => {
  const result = classify({
    elements: [{ id: "different-root", content: { parts: [1, 2, 3] } }],
    links: { elements: { relation: "related.v1" } },
  });
  assert.equal(result.status, "UNEXPECTED_RESOURCE_ID");
  assert.equal(result.expectedIdObserved, false);
  assert.equal(result.schemaFieldCount, 1);
  assert.equal(result.hasRelationMetadata, true);
  uncertified(result);
});

test("zero elements are empty and ambiguous or invalid resource envelopes remain unrecognized", () => {
  const empty = classify({
    elements: [],
    paging: {},
    links: { elements: { relation: "related.v1" } },
  });
  assert.equal(empty.status, "EMPTY_RESOURCE");
  assert.equal(empty.schemaFieldCount, 0);
  assert.equal(empty.expectedIdObserved, false);
  assert.equal(empty.hasRelationMetadata, true);
  uncertified(empty);
  for (const body of [
    null,
    undefined,
    "private text",
    42,
    [],
    {},
    { elements: {} },
    { elements: null },
    { elements: [null] },
    { elements: [[]] },
    { elements: [{}] },
    { elements: [{ id: "" }] },
    { elements: [{ id: 12 }] },
    { elements: [{ id: atomId }, { id: "other-root" }] },
  ]) {
    const result = classify(body);
    assert.equal(result.status, "UNRECOGNIZED_RESOURCE_BODY");
    assert.equal(result.expectedIdObserved, false);
    assert.equal(result.schemaFieldCount, 0);
    uncertified(result);
  }
  assert.equal(
    classifyCourseraResourceProjection({ elements: [{ id: atomId }] }, "")
      .status,
    "UNRECOGNIZED_RESOURCE_BODY",
  );
});

test("classification never invokes resource getters or trusts inherited identity fields", () => {
  let reads = 0;
  const root = {
    get elements() {
      reads++;
      return [{ id: atomId }];
    },
  };
  assert.equal(classify(root).status, "UNRECOGNIZED_RESOURCE_BODY");
  assert.equal(reads, 0);
  const element = {
    get id() {
      reads++;
      return atomId;
    },
  };
  assert.equal(
    classify({ elements: [element] }).status,
    "UNRECOGNIZED_RESOURCE_BODY",
  );
  assert.equal(reads, 0);
  const inherited = Object.create({ id: atomId });
  assert.equal(
    classify({ elements: [inherited] }).status,
    "UNRECOGNIZED_RESOURCE_BODY",
  );
});

test("the serialized helper runs standalone without imports and agrees with the maintained function", () => {
  const source = "(" + classifyCourseraResourceProjection.toString() + ")";
  assert.doesNotThrow(() => new vm.Script(source));
  const standalone = vm.runInNewContext(source);
  for (const body of [
    { elements: [{ id: atomId }] },
    {
      elements: [{ id: atomId }],
      links: { elements: { content: "authoringAtoms.v2" } },
    },
    { elements: [{ id: atomId, metadata: { version: 1 } }] },
    { elements: [{ id: "different" }] },
    { elements: [] },
  ])
    assert.deepEqual(
      JSON.parse(JSON.stringify(standalone(body, atomId))),
      classify(body),
    );
});

test("real v2 identifier-only models stay uncertified on replay when the uploaded fixture is available", (t) => {
  const file = process.env.CTI_COURSERA_REAL_PROJECTION_FIXTURE;
  if (!file) {
    t.skip("Private uploaded fixture is local-only");
    return;
  }
  const capture = JSON.parse(readFileSync(file, "utf8"));
  const records = capture.records.filter((record) =>
    ["authoringAtoms.v2", "authoringItemContentRelations.v1"].includes(
      record.resource,
    ),
  );
  assert.equal(records.length, 4);
  for (const record of records) {
    const result = classifyCourseraResourceProjection(
      record.data,
      record.sourceBinding.atomId,
    );
    assert.equal(result.status, "IDENTIFIER_ONLY");
    assert.equal(result.schemaFieldCount, 0);
    assert.equal(result.expectedIdObserved, true);
    assert.equal(result.hasRelationMetadata, false);
    uncertified(result);
  }
});
