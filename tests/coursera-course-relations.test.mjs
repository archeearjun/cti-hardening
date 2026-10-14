import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  parseCourseraCourseMaterialsRelations,
  planCourseraCourseRelationSample,
} from "../src/domain/coursera-course-relations.ts";

const courseId = "Synthetic_course_123";
const atom = (number) => "a".repeat(20) + String(number).padStart(2, "0");
const item = (id, type, number) => ({
  id,
  name: "Synthetic item",
  atomId: atom(number),
  contentId: "atom~" + atom(number),
  content: {
    typeName: type,
    definition:
      type === "staffGraded"
        ? { assignmentId: "s".repeat(22) + "@1" }
        : type === "supplement"
          ? { assetId: "observed-asset-" + number, assetTypeName: "cml" }
          : {},
  },
});
const fixture = () => ({
  elements: [
    {
      id: courseId,
      material: {
        elements: [
          {
            id: "module1",
            name: "Synthetic module",
            elements: [
              {
                id: "lesson1",
                name: "Synthetic lesson",
                elements: [
                  item("quiz1", "staffGraded", 1),
                  item("read1", "supplement", 2),
                ],
              },
              {
                id: "empty1",
                name: "Empty synthetic lesson",
                trackId: "empty-track",
                elements: [],
              },
              {
                id: "lesson2",
                name: "Second synthetic lesson",
                elements: [
                  item("quiz2", "staffGraded", 3),
                  item("widget1", "ungradedWidget", 4),
                ],
              },
            ],
          },
          {
            id: "module2",
            name: "Empty synthetic module",
            description: "",
            elements: [],
          },
        ],
      },
      conflictMetadata: { version: 7, courseBranchVersion: 9 },
    },
  ],
  paging: {},
  linked: {},
});

test("ordered content items and empty structural leaves remain distinct in the complete inventory", () => {
  const result = parseCourseraCourseMaterialsRelations(fixture(), courseId);
  assert.equal(result.inventoryCount, 6);
  assert.equal(result.contentItemCount, 4);
  assert.equal(result.emptyStructuralLeafCount, 2);
  assert.equal(result.boundAtomReferenceCount, 4);
  assert.equal(result.materialVersion, 7);
  assert.equal(result.courseBranchVersion, 9);
  assert.equal(result.wholeCourseVerified, false);
  assert.deepEqual(
    result.inventory.map((item) => item.itemId),
    ["quiz1", "read1", "empty1", "quiz2", "widget1", "module2"],
  );
  assert.deepEqual(
    result.inventory.map((item) => item.ordinal),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(result.inventory[0].ancestorIds, ["module1", "lesson1"]);
  assert.equal(result.inventory[0].staffAssignmentId, "s".repeat(22) + "@1");
  assert.notEqual(
    result.inventory[0].staffAssignmentId.split("@")[0],
    result.inventory[0].atomId,
  );
  assert.equal(result.inventory[1].supplementAssetId, "observed-asset-2");
  assert.equal(result.inventory[1].supplementAssetType, "cml");
  assert.equal(result.inventory[2].atomReferenceReason, "EMPTY_STRUCTURE_LEAF");
});

test("only exact observed atom/content keys become bound sample candidates", () => {
  for (const mutate of [
    (leaf) => {
      leaf.atomId = "bad/path";
    },
    (leaf) => {
      leaf.contentId = "atom~different";
    },
    (leaf) => {
      leaf.atomId = atom(1) + "@1";
      leaf.contentId = "atom~" + leaf.atomId;
    },
  ]) {
    const data = fixture();
    mutate(data.elements[0].material.elements[0].elements[0].elements[0]);
    const result = parseCourseraCourseMaterialsRelations(data, courseId);
    assert.equal(result.inventoryCount, 6);
    assert.equal(result.inventory[0].atomReferenceBound, false);
    const plan = planCourseraCourseRelationSample(result);
    assert(plan.every((request) => request.sourceBinding.itemId !== "quiz1"));
  }
});

test("sample plan emits only four fixed-family single GET paths and can prefer the current bound item", () => {
  const parsed = parseCourseraCourseMaterialsRelations(fixture(), courseId);
  const first = planCourseraCourseRelationSample(parsed);
  assert.equal(first.length, 4);
  assert.deepEqual(
    first.map((request) => request.sourceBinding.itemId),
    ["quiz1", "quiz1", "read1", "read1"],
  );
  assert.deepEqual(
    first.map((request) => request.resource),
    [
      "authoringItemContentRelations.v1",
      "authoringAtoms.v2",
      "authoringItemContentRelations.v1",
      "authoringAtoms.v2",
    ],
  );
  assert(
    first.every(
      (request) =>
        request.requestPath.endsWith("/" + request.sourceBinding.atomId) &&
        !request.requestPath.includes("atom~") &&
        request.sourceBinding.requestScope ===
          "EXPLICIT_MATERIAL_ATOM_REFERENCE_SCHEMA_SAMPLE" &&
        request.sourceBinding.assessmentRootCertified === false,
    ),
  );
  const preferred = planCourseraCourseRelationSample(parsed, "quiz2");
  assert.deepEqual(
    preferred.map((request) => request.sourceBinding.itemId),
    ["quiz2", "quiz2", "read1", "read1"],
  );
  assert.deepEqual(
    planCourseraCourseRelationSample(parsed, "foreign-item"),
    first,
  );
});

test("ambiguous roots, foreign course IDs and pagination cannot establish a complete hierarchy", () => {
  const duplicate = fixture();
  duplicate.elements.push(structuredClone(duplicate.elements[0]));
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(duplicate, courseId),
    /AMBIGUOUS_MATERIAL_RESOURCE_ROOT/,
  );
  assert.throws(
    () =>
      parseCourseraCourseMaterialsRelations(fixture(), "Different_course_456"),
    /MATERIAL_COURSE_ID_MISMATCH/,
  );
  const paged = fixture();
  paged.paging = { next: "opaque-page" };
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(paged, courseId),
    /PAGINATED_MATERIAL_RESOURCE_NOT_SUPPORTED/,
  );
});

test("duplicate identities, ambiguous content containers and malformed descendants fail explicitly", () => {
  const duplicated = fixture();
  duplicated.elements[0].material.elements[0].elements[1].id = "quiz1";
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(duplicated, courseId),
    /DUPLICATE_MATERIAL_NODE_ID/,
  );
  const container = fixture();
  container.elements[0].material.elements[0].content = {
    typeName: "supplement",
    definition: {},
  };
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(container, courseId),
    /AMBIGUOUS_CONTENT_CONTAINER/,
  );
  const malformed = fixture();
  malformed.elements[0].material.elements[0].elements = "not-an-array";
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(malformed, courseId),
    /MATERIAL_CHILDREN_INVALID/,
  );
  const child = fixture();
  child.elements[0].material.elements[0].elements.push(null);
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(child, courseId),
    /MATERIAL_HIERARCHY_NODE_INVALID/,
  );
});

test("hierarchy depth, cycles and leaf count stay bounded", () => {
  const deep = fixture();
  let node = deep.elements[0].material;
  for (let number = 0; number < 34; number++) {
    const child = {
      id: "deep" + number,
      name: "Synthetic container",
      elements: [],
    };
    node.elements = [child];
    node = child;
  }
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(deep, courseId),
    /MATERIAL_HIERARCHY_LIMIT/,
  );
  const cyclic = fixture();
  const branch = cyclic.elements[0].material.elements[0];
  branch.elements.push(branch);
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(cyclic, courseId),
    /MATERIAL_HIERARCHY_CYCLE/,
  );
  const large = fixture();
  large.elements[0].material.elements = Array.from(
    { length: 20001 },
    (_, number) => ({
      id: "item" + number,
      name: "Synthetic leaf",
      elements: [],
    }),
  );
  assert.throws(
    () => parseCourseraCourseMaterialsRelations(large, courseId),
    /MATERIAL_INVENTORY_LIMIT/,
  );
});

test("parser and planner execute from their serialized functions without module bindings", () => {
  const context = vm.createContext({ fixture: fixture(), courseId });
  vm.runInContext(
    "globalThis.parsed=(" +
      parseCourseraCourseMaterialsRelations.toString() +
      ")(fixture,courseId);" +
      "globalThis.plan=(" +
      planCourseraCourseRelationSample.toString() +
      ')(parsed,"quiz2");',
    context,
  );
  assert.equal(context.parsed.inventoryCount, 6);
  assert.equal(context.plan.length, 4);
  assert.equal(context.plan[0].sourceBinding.itemId, "quiz2");
});
