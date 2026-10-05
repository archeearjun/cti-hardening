import test from "node:test";
import assert from "node:assert/strict";
import {
  validateStoredDate,
  validateStoredCourseMetadata,
  validateCourseMetadataUpdate,
  validateCourseMetadata,
} from "../src/domain/operations.ts";
import { validateRecord } from "../src/domain/workspace-validation.ts";
import { mergeStructuredAssessment_ } from "../src/source/qti.js";
import { sourceTreeRows } from "../src/domain/source-hierarchy.ts";

test("rescans accept serialized legacy dates without changing their day or original offset", () => {
  const metadata = {
    partner: "NAIT",
    owner: "Owner",
    status: "In Queue",
    assignedDate: "2026-09-20T18:30:00.000Z",
    deadline: "2026-10-06T00:00:00+05:30",
    driveLink: "",
  };
  assert.deepEqual(validateStoredCourseMetadata(metadata), metadata);
  assert.equal(
    validateCourseMetadataUpdate({ ...metadata, owner: "Changed" }, metadata)
      .assignedDate,
    metadata.assignedDate,
  );
  assert.throws(
    () =>
      validateCourseMetadataUpdate(
        { ...metadata, assignedDate: "2026-10-03T00:00:00Z" },
        metadata,
      ),
    /YYYY-MM-DD/,
  );
  validateRecord({
    id: "course",
    kind: "package",
    title: "Course",
    packageId: "",
    version: 1,
    data: { ...metadata, scan: { courseTree: [], stats: {} } },
  });
  assert.throws(() => validateCourseMetadata(metadata), /YYYY-MM-DD/);
  for (const invalid of [
    "2026-02-31T00:00:00Z",
    "2026-09-20T24:00:00Z",
    "2026-09-20garbage",
    "10/05/2026",
    "yesterday",
  ])
    assert.throws(() => validateStoredDate(invalid, "Date"));
});

test("merging dependency assessments preserves identity, incomplete counts and the original banks", () => {
  const bank = (file, declared = 1) => ({
    questionCount: 1,
    declaredQuestionCount: declared,
    questions: [
      { id: "same", prompt: "Same?", sourceFile: file, sourceOrdinal: 1 },
    ],
    sourceCounts: [{ sourceFile: file, declared, captured: 1 }],
    captureCompleteness: { questionCoverageComplete: declared === 1 },
    selectionPolicy: { observed: false, selectCount: null },
  });
  const a = bank("a.xml"),
    b = bank("b.xml", 300),
    original = structuredClone(a);
  const parent = mergeStructuredAssessment_(
    mergeStructuredAssessment_(null, a),
    b,
  );
  assert.deepEqual(a, original);
  assert.equal(b.questions.length, 1);
  assert.equal(parent.questionCount, 2);
  assert.equal(parent.declaredQuestionCount, 301);
  assert.equal(parent.captureCompleteness.questionCoverageComplete, false);
  assert.equal(mergeStructuredAssessment_(parent, b).questionCount, 2);
  assert.equal(
    mergeStructuredAssessment_(parent, b).declaredQuestionCount,
    301,
  );
  assert.equal(mergeStructuredAssessment_(null, a).questions.length, 1);
});

test("source navigation uses authored nested folders, with distinct positional paths for repeated references", () => {
  const item = {
    title: "Reading",
    idref: "r",
    type: "webcontent",
    children: [],
  };
  const module = (title) => ({
    title,
    idref: null,
    type: "folder",
    children: [
      { title: "Week 1", type: "folder", idref: null, children: [item] },
    ],
  });
  const rows = sourceTreeRows({
    sourceHierarchy: [module("Module A"), module("Module B")],
    courseTree: [item],
  });
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map((r) => r.key)).size, 6);
  assert.equal(rows[2].path, "Module A / Week 1");
  assert.deepEqual(rows[2].ancestors, [rows[0].key, rows[1].key]);
  assert.equal(rows[5].path, "Module B / Week 1");
});
