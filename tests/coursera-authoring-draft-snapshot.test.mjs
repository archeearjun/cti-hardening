import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as fields from "../src/domain/coursera-retained-authoring-fields.ts";
import { directCanonicalSourceTextV1 as canonical } from "../src/extractors/coursera/direct-data-canonical.js";
import {
  bindDirectPublishedDraftSnapshotV1,
  directPublishedDraftSnapshotInventoryV1,
  directPublishedDraftSnapshotSourceV1,
  directPublishedDraftSnapshotStableV1,
} from "../src/extractors/coursera/direct-data-authoring-snapshot.js";
import {
  courseraAuthoringDraftSnapshot,
  validateCourseraAuthoringDraftSnapshot,
  courseraAuthoringDraftSnapshotText,
  courseraAuthoringDraftSnapshotSize,
  MAX_AUTHORING_DRAFT_SNAPSHOT_CHARACTERS,
  MAX_AUTHORING_DRAFT_SNAPSHOT_HISTORY_RECORDS,
} from "../src/domain/coursera-authoring-draft-snapshot.ts";

const courseId = "Synthetic_course_123",
  slug = "synthetic-course",
  atomId = "a".repeat(22),
  localA = "b".repeat(22),
  localB = "c".repeat(22),
  groupA = atomId + "~" + localA,
  groupB = atomId + "~" + localB,
  definitionA = atomId + "~" + "q".repeat(22) + "@7",
  definitionB = atomId + "~" + "r".repeat(22) + "@3",
  pointer = "p".repeat(22) + "@2";
const hash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const cml = (value) => ({
  typeName: "cml",
  definition: {
    dtdId: "assess/1",
    value: `<co-content><text>${value}</text></co-content>`,
  },
});
const receipt = (resource, id, second) => ({
  resource,
  id,
  status: 200,
  bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
  requestPath: `/api/${resource}/${id}`,
  requestQuery: [["includes", "_links"]],
  observedAt: `2026-10-19T10:00:${String(second).padStart(2, "0")}.000Z`,
  bytes: 456,
  originalResponseSha256: "f".repeat(64),
  sha256: "f".repeat(64),
  credentialFieldsRemoved: 0,
  credentialUrlsRedacted: 0,
});
const obs = (data, resource, id, second) => ({
  data: structuredClone(data),
  receipt: receipt(resource, id, second),
  sourceSha256: hash(data),
});
function fixture() {
  const item = {
    id: "item-1",
    typeName: "ungradedAssignment",
    atomId,
    contentId: "atom~" + atomId,
    payload: {},
  };
  const material = {
    id: item.id,
    atomId,
    contentId: item.contentId,
    published: true,
    content: { typeName: item.typeName, definition: { assignmentId: pointer } },
  };
  const atom = {
    id: atomId,
    contentId: item.contentId,
    storedAtomVersion: 2,
    metadata: { updatedAt: 1791189683630 },
    status: { typeName: "publishedAtomStatus", definition: {} },
    draft: {
      name: "Literal retained draft",
      content: {
        typeName: "staffGradedDraft",
        definition: {
          parts: [localA, localB].map((id) => ({
            typeName: "storedQuestionGroupPart",
            definition: { id },
          })),
          configuration: { isGraded: false, submissionLimitForEachAttempt: 2 },
        },
      },
    },
    published: {
      name: "Published title",
      content: {
        typeName: "staffGraded",
        definition: { assignmentId: pointer, isGraded: true },
      },
    },
  };
  const relation = {
    id: atomId,
    atomId,
    branchRelationMap: {
      [courseId + "~" + item.id]: {
        courseId,
        itemId: item.id,
        courseSlug: slug,
      },
    },
  };
  const atomData = { elements: [atom], paging: {}, linked: {} },
    relationData = { elements: [relation], paging: {}, linked: {} };
  const groupData = (id, definition) => ({
    elements: [
      {
        id,
        questions: [definition],
        questionReferences: [{ authoringId: definition }],
      },
    ],
    paging: {},
  });
  const definitionData = (id, typeName) => ({
    elements: [
      {
        id,
        definition: {
          typeName,
          definition: {
            prompt: cml("Literal draft prompt"),
            options:
              typeName === "mcq"
                ? [
                    {
                      id: "o1",
                      display: cml("Original choice 1"),
                      feedback: cml("Original feedback"),
                    },
                    { id: "o2", display: cml("Original choice 2") },
                  ]
                : [
                    {
                      id: "answer-1",
                      answer: "Literal exact answer",
                      isCorrect: true,
                      feedback: cml("Authored feedback"),
                    },
                  ],
            ...(typeName === "mcq" ? { correctOption: "o2" } : {}),
          },
        },
        validation: { definition: { isReadyForPublish: true } },
      },
    ],
    paging: {},
  });
  const p = {
    schemaVersion: 1,
    method: "BOUND_PUBLISHED_ATOM_DRAFT_SNAPSHOT",
    sourceState: "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM",
    courseId,
    itemId: item.id,
    courseSlug: slug,
    atomId,
    contentId: item.contentId,
    publishedAssignmentId: pointer,
    sourceSha256: "",
    sourceStable: true,
    source: {
      material,
      initialAtom: obs(atomData, "authoringAtoms.v2", atomId, 0),
      relation: obs(
        relationData,
        "authoringItemContentRelations.v1",
        atomId,
        1,
      ),
      finalAtom: obs(atomData, "authoringAtoms.v2", atomId, 8),
    },
    inventory: {},
    groups: [
      {
        id: groupA,
        initial: obs(
          groupData(groupA, definitionA),
          "authoringAssignmentQuestionGroups.v1",
          groupA,
          2,
        ),
        final: obs(
          groupData(groupA, definitionA),
          "authoringAssignmentQuestionGroups.v1",
          groupA,
          4,
        ),
      },
      {
        id: groupB,
        initial: obs(
          groupData(groupB, definitionB),
          "authoringAssignmentQuestionGroups.v1",
          groupB,
          2,
        ),
        final: obs(
          groupData(groupB, definitionB),
          "authoringAssignmentQuestionGroups.v1",
          groupB,
          4,
        ),
      },
    ],
    definitions: [
      {
        id: definitionA,
        ...obs(
          definitionData(definitionA, "mcq"),
          "authoringAssignmentMachineEvaluableQuestions.v1",
          definitionA,
          3,
        ),
      },
      {
        id: definitionB,
        ...obs(
          definitionData(definitionB, "textExactMatch"),
          "authoringAssignmentMachineEvaluableQuestions.v1",
          definitionB,
          3,
        ),
      },
    ],
    failures: [],
    publishedContentVerified: false,
    contentCompletenessVerified: false,
    wholeItemVerified: false,
  };
  item.payload.directAuthoringDraftSnapshot = p;
  const bind = (data) =>
    bindDirectPublishedDraftSnapshotV1(
      item,
      courseId,
      slug,
      p.source.material,
      data,
      p.source.relation.data,
    );
  function refresh() {
    for (const o of [
      p.source.initialAtom,
      p.source.relation,
      p.source.finalAtom,
      ...p.groups.flatMap((g) => [g.initial, g.final]),
      ...p.definitions,
    ].filter(Boolean))
      o.sourceSha256 = hash(o.data);
    const initial = bind(p.source.initialAtom.data);
    p.sourceSha256 = hash(directPublishedDraftSnapshotSourceV1(initial));
    p.inventory = structuredClone(
      directPublishedDraftSnapshotInventoryV1(initial),
    );
    try {
      p.sourceStable =
        !!p.source.finalAtom &&
        directPublishedDraftSnapshotStableV1(
          initial,
          bind(p.source.finalAtom.data),
        );
    } catch {
      p.sourceStable = false;
    }
  }
  refresh();
  return { item, p, refresh, bind };
}
const derive = (f) => courseraAuthoringDraftSnapshot(f.item, courseId);

test("separate bound draft snapshots retain all original observations without current published claims or question-count promotion", () => {
  const f = fixture(),
    before = structuredClone(f.item),
    view = derive(f);
  assert(view);
  assert.deepEqual(f.item, before);
  assert.equal(view.scope, "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM");
  assert.equal(view.sourceStability, "STABLE");
  assert.equal(view.publishedAssignmentId, pointer);
  for (const field of [
    "publishedContentVerified",
    "contentCompletenessVerified",
    "wholeItemVerified",
  ])
    assert.equal(view[field], false);
  assert.equal(
    view.draftConfiguration.isGraded,
    false,
    "The exact draft false flag cannot borrow the published true flag",
  );
  assert.equal(view.draftConfiguration.isGradedStatus, "RECORDED");
  assert.equal(
    view.initialAtom.draftSha256,
    hash(f.p.source.initialAtom.data.elements[0].draft),
  );
  assert.equal(
    view.initialAtom.publishedSha256,
    hash(f.p.source.initialAtom.data.elements[0].published),
  );
  assert.notEqual(
    view.sourceSha256,
    f.p.source.initialAtom.receipt.originalResponseSha256,
  );
  assert.equal(view.parts.length, 2);
  assert.equal(view.parts[0].group.status, "STABLE");
  assert.equal(view.parts[0].definition.id, definitionA);
  assert.equal(view.parts[1].definition.id, definitionB);
  assert.deepEqual(
    view.parts[0].definition.readableChoices.options.map(
      (o) => o.authoredCorrect,
    ),
    [false, true],
  );
  assert.equal(view.parts[1].definition.readableChoices, null);
  assert(!("questions" in view));
  assert(!("questionCount" in view));
  validateCourseraAuthoringDraftSnapshot(view, f.item.id, courseId);
  validateCourseraAuthoringDraftSnapshot(
    JSON.parse(JSON.stringify(view)),
    f.item.id,
    courseId,
  );
  const exported = courseraAuthoringDraftSnapshotText(view);
  assert.match(exported, /CURRENT PUBLISHED BODY UNVERIFIED/);
  assert.match(exported, /Draft isGraded: false/);
  assert(exported.includes(view.parts[1].definition.originalModelJson));
  assert.equal(MAX_AUTHORING_DRAFT_SNAPSHOT_CHARACTERS, 8_000_000);
  assert.equal(
    courseraAuthoringDraftSnapshotSize(view),
    JSON.stringify(view).length,
  );
});

test("course, material, atom and versioned definition ownership cannot be borrowed across items or versions", () => {
  for (const mutate of [
    (f) => (f.p.courseId = "Other_course_123"),
    (f) => (f.p.itemId = "another-item"),
    (f) => (f.p.atomId = "x".repeat(22)),
    (f) => (f.p.source.material.id = "another-item"),
    (f) => (f.p.source.material.published = false),
    (f) =>
      (f.p.source.material.content.definition.assignmentId =
        "p".repeat(22) + "@1"),
    (f) =>
      (f.p.source.initialAtom.data.elements[0].contentId =
        "atom~" + "x".repeat(22)),
    (f) =>
      (f.p.source.relation.data.elements[0].branchRelationMap[
        courseId + "~item-1"
      ].itemId = "another-item"),
    (f) => (f.p.groups[0].id = atomId + "~" + "x".repeat(22)),
    (f) => (f.p.definitions[0].id = definitionA.replace("@7", "@8")),
    (f) =>
      (f.p.definitions[0].data.elements[0].id = definitionA.replace(
        "@7",
        "@8",
      )),
    (f) =>
      f.p.definitions[0].data.elements.push(
        structuredClone(f.p.definitions[0].data.elements[0]),
      ),
    (f) => f.p.groups.push(structuredClone(f.p.groups[0])),
    (f) => f.p.definitions.push(structuredClone(f.p.definitions[0])),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(derive(f), null);
  }
  const f = fixture();
  assert.equal(
    courseraAuthoringDraftSnapshot(f.item, "Other_course_123"),
    null,
  );
});

test("canonical data hashes, full initial/final draft and published models, receipts and chronology are rechecked", () => {
  for (const mutate of [
    (f) => (f.p.sourceSha256 = "0".repeat(64)),
    (f) => (f.p.source.initialAtom.data.elements[0].draft.name += " changed"),
    (f) =>
      (f.p.source.initialAtom.data.elements[0].published.name += " changed"),
    (f) =>
      (f.p.source.finalAtom.data.elements[0].published.content.definition.assignmentId =
        "p".repeat(22) + "@3"),
    (f) => (f.p.groups[0].initial.sourceSha256 = "0".repeat(64)),
    (f) =>
      (f.p.definitions[0].data.elements[0].definition.definition.prompt =
        cml("tampered")),
    (f) => (f.p.definitions[0].receipt.id = definitionA.replace("@7", "@8")),
    (f) => (f.p.definitions[0].receipt.requestPath += "/other"),
    (f) => (f.p.definitions[0].receipt.status = 403),
    (f) => (f.p.definitions[0].receipt.originalResponseSha256 = "bad"),
    (f) => (f.p.definitions[0].receipt.sha256 = "0".repeat(64)),
    (f) => (f.p.definitions[0].receipt.authorization = "unaccepted-field"),
    (f) =>
      (f.p.groups[0].initial.receipt.observedAt = "2026-10-19T10:00:00.500Z"),
    (f) => (f.p.definitions[0].receipt.observedAt = "2026-10-19T10:00:01.500Z"),
    (f) =>
      (f.p.groups[0].final.receipt.observedAt = "2026-10-19T10:00:02.500Z"),
    (f) =>
      (f.p.source.finalAtom.receipt.observedAt = "2026-10-19T10:00:03.500Z"),
    (f) => (f.p.source.initialAtom.receipt.observedAt = "not-a-date"),
    (f) => f.p.inventory.rawParts.reverse(),
    (f) => (f.p.sourceStable = false),
    (f) => (f.p.publishedContentVerified = true),
    (f) => (f.p.contentCompletenessVerified = true),
    (f) => (f.p.wholeItemVerified = true),
    (f) => (f.p.unknownProjection = true),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(derive(f), null);
  }
});

test("changed or missing final atom/group reads retain partial originals with exact unresolved records", () => {
  for (const mode of [
    "source-changed",
    "source-pointer-changed",
    "source-draft-removed",
    "source-missing",
    "group-changed",
    "group-missing",
    "group-not-read",
    "definition-missing",
  ]) {
    const f = fixture();
    if (mode === "source-changed") {
      f.p.source.finalAtom.data.elements[0].draft.name += " changed";
      f.p.failures.push({
        scope: "SOURCE",
        id: atomId,
        reason: "DIRECT_SNAPSHOT_SOURCE_CHANGED",
      });
    }
    if (mode === "source-pointer-changed") {
      f.p.source.finalAtom.data.elements[0].published.content.definition.assignmentId =
        "p".repeat(22) + "@3";
      f.p.failures.push({
        scope: "SOURCE",
        id: atomId,
        reason: "DIRECT_SNAPSHOT_SOURCE_CHANGED",
      });
    }
    if (mode === "source-draft-removed") {
      delete f.p.source.finalAtom.data.elements[0].draft;
      f.p.failures.push({
        scope: "SOURCE",
        id: atomId,
        reason: "DIRECT_SNAPSHOT_SOURCE_CHANGED",
      });
    }
    if (mode === "source-missing") {
      f.p.source.finalAtom = null;
      f.p.failures.push({
        scope: "SOURCE",
        id: atomId,
        reason: "DIRECT_API_BUDGET_EXHAUSTED",
      });
    }
    if (mode === "group-changed") {
      f.p.groups[0].final.data.elements[0].questions[0] = definitionA.replace(
        "@7",
        "@8",
      );
      f.p.failures.push({
        scope: "GROUP",
        id: groupA,
        reason: "DIRECT_SNAPSHOT_GROUP_CHANGED",
      });
    }
    if (mode === "group-missing") {
      f.p.groups[0].final = null;
      f.p.failures.push({
        scope: "GROUP",
        id: groupA,
        reason: "DIRECT_API_BUDGET_EXHAUSTED",
      });
    }
    if (mode === "group-not-read") {
      f.p.groups.shift();
      f.p.definitions.shift();
      f.p.failures.push({
        scope: "GROUP",
        id: groupA,
        reason: "DIRECT_API_BUDGET_EXHAUSTED",
      });
    }
    if (mode === "definition-missing") {
      f.p.definitions.shift();
      f.p.failures.push({
        scope: "DEFINITION",
        id: definitionA,
        reason: "DIRECT_API_403",
      });
    }
    f.refresh();
    const view = derive(f);
    assert(view, mode);
    assert.equal(view.publishedContentVerified, false);
    assert.equal(view.wholeItemVerified, false);
    if (mode.startsWith("source"))
      assert.equal(
        view.sourceStability,
        mode === "source-missing" ? "FINAL_READ_MISSING" : "CHANGED",
      );
    else
      assert.equal(
        view.sourceStability,
        "STABLE",
        "Group stability is separate from full atom source stability",
      );
    if (mode === "group-changed") {
      assert.equal(view.parts[0].group.status, "CHANGED");
      assert.equal(view.parts[0].definition.id, definitionA);
    }
    if (mode === "group-not-read")
      assert.equal(view.parts[0].group.status, "NOT_READ");
    if (mode === "source-draft-removed") {
      assert.equal(view.finalAtom.draftSha256, "");
      assert(
        !("draft" in JSON.parse(view.finalAtom.sanitizedModelJson).elements[0]),
      );
    }
    validateCourseraAuthoringDraftSnapshot(
      JSON.parse(JSON.stringify(view)),
      f.item.id,
      courseId,
    );
    f.p.failures = [];
    assert.equal(
      derive(f),
      null,
      "Missing/changed observations require their own unresolved record",
    );
  }
});

test("unsupported group variants stay literal without guessed definitions or false completeness", () => {
  const f = fixture();
  f.p.groups[0].initial.data.elements[0].questions.push(
    definitionA.replace("@7", "@8"),
  );
  f.p.groups[0].final.data = structuredClone(f.p.groups[0].initial.data);
  f.p.definitions.shift();
  f.p.failures.push({
    scope: "GROUP",
    id: groupA,
    reason: "DIRECT_SNAPSHOT_GROUP_UNSUPPORTED",
  });
  f.refresh();
  const view = derive(f);
  assert(view);
  assert.equal(view.parts[0].definition, null);
  assert.equal(view.parts[0].group.status, "STABLE");
  assert.match(view.parts[0].group.initial.sanitizedModelJson, /@8/);
  assert.equal(view.contentCompletenessVerified, false);
  f.p.definitions.push(fixture().p.definitions[0]);
  assert.equal(
    derive(f),
    null,
    "A raw unsupported group cannot own a guessed definition",
  );
});

test("literal instructions, malformed parts, explicit empty arrays and missing draft flags are retained without invented content", () => {
  const f = fixture(),
    instruction = {
      typeName: "storedTextBlockPart",
      definition: {
        id: "instruction",
        title: "Read first",
        body: cml("Original instructions"),
      },
    };
  for (const o of [f.p.source.initialAtom, f.p.source.finalAtom])
    o.data.elements[0].draft.content.definition.parts.push(instruction, {
      typeName: "unknownPart",
      definition: { native: "unchanged" },
    });
  f.refresh();
  let view = derive(f);
  assert(view);
  assert.equal(view.declaredDraftParts, 4);
  assert.equal(view.parts[2].nativeType, "storedTextBlockPart");
  assert.equal(view.parts[2].definition, null);
  assert.equal(view.parts[3].group, null);
  const empty = fixture();
  for (const o of [empty.p.source.initialAtom, empty.p.source.finalAtom]) {
    o.data.elements[0].draft.content.definition.parts = [];
    delete o.data.elements[0].draft.content.definition.configuration.isGraded;
  }
  empty.p.groups = [];
  empty.p.definitions = [];
  empty.refresh();
  view = derive(empty);
  assert(view);
  assert.equal(view.parts.length, 0);
  assert.equal(view.draftConfiguration.isGraded, null);
  assert.equal(view.draftConfiguration.isGradedStatus, "ABSENT");
  assert.equal(view.wholeItemVerified, false);
  assert.equal(view.contentCompletenessVerified, false);
});

test("saved views are independently rederived and reject altered readable fields, originals, ownership, proof and claims", () => {
  const view = derive(fixture());
  assert(view);
  for (const mutate of [
    (v) => (v.itemId = "different"),
    (v) => (v.publishedAssignmentId = pointer.replace("@2", "@1")),
    (v) => (v.draftConfiguration.isGraded = true),
    (v) => (v.initialAtom.draftSha256 = "0".repeat(64)),
    (v) => (v.initialAtom.publishedSha256 = "0".repeat(64)),
    (v) => (v.parts[0].definition.originalModelJson = "{}"),
    (v) => (v.parts[0].definition.readableChoices.prompt = "invented"),
    (v) =>
      (v.parts[0].definition.readableChoices.options[0].authoredCorrect = true),
    (v) => (v.parts[0].group.status = "CHANGED"),
    (v) => (v.sourceStability = "CHANGED"),
    (v) => (v.publishedContentVerified = true),
    (v) =>
      (v.proof.snapshot.source.initialAtom.data.elements[0].metadata.newField = true),
    (v) =>
      (v.proof.snapshot.source.finalAtom.data.elements[0].published.name +=
        " changed"),
    (v) => (v.proof.snapshot.definitions[0].sourceSha256 = "0".repeat(64)),
    (v) => v.failures.push({ scope: "GROUP", id: "foreign", reason: "FORGED" }),
  ]) {
    const bad = structuredClone(view);
    mutate(bad);
    assert.throws(() =>
      validateCourseraAuthoringDraftSnapshot(bad, "item-1", courseId),
    );
  }
  assert.throws(() =>
    validateCourseraAuthoringDraftSnapshot(view, "different", courseId),
  );
  assert.throws(() =>
    validateCourseraAuthoringDraftSnapshot(view, "item-1", "Other_course_123"),
  );
});

test("proof, fields and aggregate limits run before serialization and source hashing", () => {
  const f = fixture();
  f.p.source.initialAtom.data.elements[0].draft.tooLarge = "x".repeat(
    2_000_001,
  );
  assert.equal(derive(f), null);
  const oversized = { value: "x".repeat(8_000_001) };
  assert.throws(
    () => courseraAuthoringDraftSnapshotSize(oversized),
    /review limit/,
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => courseraAuthoringDraftSnapshotSize(cyclic),
    /review limit/,
  );
  const getter = {};
  Object.defineProperty(getter, "value", {
    enumerable: true,
    get() {
      throw Error("must not execute");
    },
  });
  assert.throws(
    () => courseraAuthoringDraftSnapshotSize(getter),
    /review limit/,
  );
  for (const mutate of [
    (f) =>
      f.p.failures.push({ scope: "GROUP", id: "foreign", reason: "FORGED" }),
    (f) =>
      f.p.failures.push({
        scope: "DEFINITION",
        id: definitionA.replace("@7", "@8"),
        reason: "FORGED",
      }),
    (f) =>
      f.p.failures.push({ scope: "SOURCE", id: atomId, reason: "bad\nreason" }),
    (f) => (f.p.source.initialAtom.receipt.bytes = -1),
    (f) =>
      (f.p.source.initialAtom.receipt.requestQuery = [
        ["includes", "_links", "unaccepted"],
      ]),
  ]) {
    const bad = fixture();
    mutate(bad);
    assert.equal(derive(bad), null);
  }
});

test("a failed resumed attempt preserves independently bound earlier drafts and their original definition proof without borrowing current content", () => {
  const f = fixture(),
    earlierRaw = structuredClone(f.p),
    earlierDefinition = structuredClone(earlierRaw.definitions[0]);
  f.item.payload.directAuthoringDraftSnapshotHistory = [earlierRaw];
  f.p.publishedAssignmentId = "p".repeat(22) + "@3";
  f.p.source.material.content.definition.assignmentId =
    f.p.publishedAssignmentId;
  for (const o of [f.p.source.initialAtom, f.p.source.finalAtom])
    o.data.elements[0].published.content.definition.assignmentId =
      f.p.publishedAssignmentId;
  for (const o of [
    f.p.source.initialAtom,
    f.p.source.relation,
    f.p.source.finalAtom,
  ])
    o.receipt.observedAt = o.receipt.observedAt.replace("T10:", "T11:");
  f.p.source.finalAtom = null;
  f.p.groups = [];
  f.p.definitions = [];
  f.p.failures = [
    { scope: "SOURCE", id: atomId, reason: "DIRECT_API_BUDGET_EXHAUSTED" },
    ...[groupA, groupB].map((id) => ({
      scope: "GROUP",
      id,
      reason: "DIRECT_API_BUDGET_EXHAUSTED",
    })),
  ];
  f.refresh();
  const before = structuredClone(f.item),
    view = derive(f);
  assert(view);
  assert.deepEqual(f.item, before);
  assert.equal(view.sourceStability, "FINAL_READ_MISSING");
  assert.equal(view.parts[0].definition, null);
  assert.equal(view.publishedAssignmentId, "p".repeat(22) + "@3");
  const old = view.earlierDraftObservations[0];
  assert(old);
  assert.equal(old.publishedAssignmentId, pointer);
  assert.equal(old.sourceStability, "STABLE");
  assert.equal(
    old.initialAtom.observedAt,
    earlierRaw.source.initialAtom.receipt.observedAt,
  );
  assert.equal(
    old.parts[0].definition.originalModelSha256,
    hash(earlierDefinition.data.elements[0]),
  );
  assert.equal(
    old.parts[0].definition.observedAt,
    earlierDefinition.receipt.observedAt,
  );
  assert.deepEqual(old.proof.snapshot.definitions[0], earlierDefinition);
  assert(!("earlierDraftObservations" in old));
  assert(!("history" in old.proof));
  assert.equal(view.wholeItemVerified, false);
  assert.equal(old.wholeItemVerified, false);
  assert(!("questions" in view));
  assert(!("questions" in old));
  validateCourseraAuthoringDraftSnapshot(
    JSON.parse(JSON.stringify(view)),
    "item-1",
    courseId,
  );
  const output = courseraAuthoringDraftSnapshotText(view);
  assert.match(
    output,
    /EARLIER DRAFT OBSERVATION; CURRENT PUBLISHED BODY UNVERIFIED/,
  );
  assert.match(output, /does not establish the current authoring draft/);
  assert(output.includes(old.parts[0].definition.originalModelJson));
  for (const mutate of [
    (v) =>
      (v.earlierDraftObservations[0].parts[0].definition.originalModelJson =
        "{}"),
    (v) =>
      (v.earlierDraftObservations[0].publishedAssignmentId =
        v.publishedAssignmentId),
    (v) =>
      (v.proof.history[0].source.initialAtom.data.elements[0].published.content.definition.assignmentId =
        v.publishedAssignmentId),
    (v) =>
      (v.proof.history[0].source.relation.data.elements[0].branchRelationMap[
        courseId + "~item-1"
      ].itemId = "foreign"),
    (v) =>
      (v.earlierDraftObservations[0].earlierDraftObservations = [
        v.earlierDraftObservations[0],
      ]),
  ]) {
    const bad = structuredClone(view);
    mutate(bad);
    assert.throws(() =>
      validateCourseraAuthoringDraftSnapshot(bad, "item-1", courseId),
    );
  }
});

test("history stays flat and bounded while each old source binds its own material type and published pointer", () => {
  const f = fixture(),
    old = structuredClone(f.p);
  old.source.material.content.typeName = "staffGraded";
  const oldItem = { ...f.item, typeName: "staffGraded" },
    bound = bindDirectPublishedDraftSnapshotV1(
      oldItem,
      courseId,
      slug,
      old.source.material,
      old.source.initialAtom.data,
      old.source.relation.data,
    );
  old.sourceSha256 = hash(directPublishedDraftSnapshotSourceV1(bound));
  f.item.payload.directAuthoringDraftSnapshotHistory = [old];
  assert(
    derive(f),
    "A historical material type need not borrow the latest material type",
  );
  old.history = [structuredClone(f.p)];
  assert.equal(
    derive(f),
    null,
    "Nested raw history is not an approved snapshot field",
  );
  delete old.history;
  f.item.payload.directAuthoringDraftSnapshotHistory = Array.from(
    { length: MAX_AUTHORING_DRAFT_SNAPSHOT_HISTORY_RECORDS + 1 },
    () => structuredClone(old),
  );
  const before = structuredClone(f.item);
  assert.equal(derive(f), null);
  assert.deepEqual(f.item, before, "Review limits never prune raw history");
  assert.equal(MAX_AUTHORING_DRAFT_SNAPSHOT_HISTORY_RECORDS, 32);
  f.item.payload.directAuthoringDraftSnapshotHistory = [structuredClone(old)];
  f.item.payload.directAuthoringDraftSnapshotHistory[0].itemId = "foreign";
  assert.equal(derive(f), null);
  const large = fixture();
  for (const o of [large.p.source.initialAtom, large.p.source.finalAtom])
    o.data.elements[0].draft.retainedLiteral = "x".repeat(90_000);
  large.refresh();
  assert(
    derive(large),
    "Each individual observation fits the per-record bound",
  );
  large.item.payload.directAuthoringDraftSnapshotHistory = Array.from(
    { length: 32 },
    () => structuredClone(large.p),
  );
  const rawCount =
    large.item.payload.directAuthoringDraftSnapshotHistory.length;
  assert.equal(
    derive(large),
    null,
    "Duplicated proof/display projections stay within the cumulative 8M review limit",
  );
  assert.equal(
    large.item.payload.directAuthoringDraftSnapshotHistory.length,
    rawCount,
  );
});

test("one exact versioned definition shared by nonoverlapping group intervals uses one actual owning receipt", () => {
  const f = fixture();
  for (const o of [f.p.groups[1].initial, f.p.groups[1].final]) {
    o.data.elements[0].questions = [definitionA];
    o.data.elements[0].questionReferences = [{ authoringId: definitionA }];
  }
  f.p.groups[1].initial.receipt.observedAt = "2026-10-19T10:00:05.000Z";
  f.p.groups[1].final.receipt.observedAt = "2026-10-19T10:00:07.000Z";
  f.p.definitions.pop();
  f.refresh();
  const view = derive(f);
  assert(view);
  assert.equal(view.parts.length, 2);
  assert.equal(view.proof.snapshot.definitions.length, 1);
  assert.equal(view.parts[0].definition.id, definitionA);
  assert.equal(view.parts[1].definition.id, definitionA);
  assert.equal(
    view.parts[0].definition.originalModelSha256,
    view.parts[1].definition.originalModelSha256,
  );
  assert.equal(view.parts[1].definition.observedAt, "2026-10-19T10:00:03.000Z");
  assert.equal(view.wholeItemVerified, false);
  validateCourseraAuthoringDraftSnapshot(
    JSON.parse(JSON.stringify(view)),
    "item-1",
    courseId,
  );
  f.p.definitions[0].receipt.observedAt = "2026-10-19T10:00:04.500Z";
  assert.equal(
    derive(f),
    null,
    "A receipt outside every owning interval is not witnessed",
  );
  f.p.definitions[0].receipt.observedAt = "2026-10-19T10:00:06.000Z";
  assert(
    derive(f),
    "Either independently bound owning interval may witness the one actual versioned GET",
  );
  f.p.definitions[0].receipt.observedAt = "2026-10-19T10:00:09.000Z";
  assert.equal(derive(f), null, "The top source interval remains mandatory");
});

test("snapshot component renders native text inertly with draft-only labels and readable authored fields", () => {
  const require = createRequire(import.meta.url);
  const component = (fileName, dependencies) => {
    const module = { exports: {} },
      compiled = ts.transpileModule(
        readFileSync(new URL("../web/" + fileName, import.meta.url), "utf8"),
        {
          fileName,
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
        if (name in dependencies) return dependencies[name];
        throw Error("Unexpected draft snapshot component dependency: " + name);
      },
      module,
      module.exports,
    );
    return module.exports;
  };
  const authoredFields = component("RetainedAuthoringFields.tsx", {
    "../src/domain/coursera-retained-authoring-fields.ts": fields,
    "../src/domain/coursera-retained-authoring-fields.js": fields,
  });
  const { CourseraAuthoringDraftSnapshotView } = component(
    "CourseraAuthoringDraftSnapshot.tsx",
    {
      "../src/domain/coursera-retained-authoring-fields.js": fields,
      "./RetainedAuthoringFields.js": authoredFields,
    },
  );
  const f = fixture();
  f.item.payload.directAuthoringDraftSnapshotHistory = [structuredClone(f.p)];
  for (const d of f.p.definitions)
    d.data.elements[0].definition.definition.prompt = cml(
      "&lt;img src=x onerror=alert(1)&gt;literal",
    );
  f.p.definitions[1].data.elements[0].definition.definition.options[0].answer =
    "<script>original answer</script>";
  f.refresh();
  const view = derive(f);
  assert(view);
  const html = renderToStaticMarkup(
    React.createElement(CourseraAuthoringDraftSnapshotView, { snapshot: view }),
  );
  assert.match(
    html,
    /Draft snapshot on published item; current published body unverified/,
  );
  assert.match(
    html,
    /Earlier draft observation; current published body unverified/,
  );
  assert.match(
    html,
    /historical observation does not establish the current authoring draft/,
  );
  assert.match(html, /Literal authored answer/);
  assert.match(html, /Draft isGraded/);
  assert.match(html, /&lt;script&gt;original answer&lt;\/script&gt;/);
  assert(!/<script[\s>]|<img[\s>]|<iframe[\s>]|<form[\s>]/i.test(html));
  assert.match(html, /Referenced as correct in this draft/);
  assert(
    !/dangerouslySetInnerHTML/.test(
      readFileSync(
        new URL("../web/CourseraAuthoringDraftSnapshot.tsx", import.meta.url),
        "utf8",
      ),
    ),
  );
});
