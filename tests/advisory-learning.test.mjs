import test from "node:test";
import assert from "node:assert/strict";
import {
  ADVISORY_FEATURES,
  advisoryFeatures,
  reviewedMappingExample,
  normalizeAdvisoryDataset,
  advisoryDatasetFingerprint,
  trainAdvisoryModel,
  createAdvisoryRecordData,
  validateAdvisoryRecordData,
  advisorySuggestion,
  assignmentWorkMetrics,
  advisoryCandidatesFromAudit,
  mergeAdvisoryDatasets,
  validateAdvisoryAuditExample,
} from "../src/domain/advisory-learning.ts";
const at = "2026-10-16T00:00:00.000Z";
function candidate(courseId = "course-a", n = 0, matches = true) {
  return {
    courseId,
    sourceId: "source-" + n,
    targetId: "target-" + n,
    sourceTitle: "Source drawing " + n,
    targetTitle: matches ? "Source drawing " + n : "Unrelated language task",
    sourcePath: "Module one Drawing",
    targetPath: matches ? "Module one Drawing" : "Module other Language",
    sourceType: "reading",
    targetType: matches ? "reading" : "quiz",
    sourceHash: "a".repeat(64),
    targetHash: (matches ? "a" : "b").repeat(64),
  };
}
function dataset() {
  return {
    schemaVersion: 1,
    examples: Array.from({ length: 4 }, (_, c) =>
      Array.from({ length: 16 }, (_, i) =>
        reviewedMappingExample(
          candidate("native-course-" + c, i, i % 2 === 0),
          i % 2 === 0 ? "approved" : "rejected",
          "owner-id",
          at,
        ),
      ),
    ).flat(),
  };
}
test("feature extraction is interpretable and discards raw content", () => {
  const row = reviewedMappingExample(candidate(), "approved", "owner-id", at);
  assert.equal(row.features.length, ADVISORY_FEATURES.length);
  assert.deepEqual(row.features, [1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(JSON.stringify(row).includes("Source drawing"), false);
  assert.equal("sourceTitle" in row, false);
  assert.deepEqual(
    advisoryFeatures({ courseId: "c", sourceId: "s", targetId: "t" }),
    Array(9).fill(0),
  );
});
test("sparse data and one-class labels never manufacture an available model", () => {
  const data = dataset();
  assert.equal(
    trainAdvisoryModel({
      schemaVersion: 1,
      examples: data.examples.slice(0, 10),
    }).status,
    "insufficient-data",
  );
  assert.equal(
    trainAdvisoryModel({
      schemaVersion: 1,
      examples: data.examples.map((row) => ({ ...row, decision: "approved" })),
    }).status,
    "insufficient-data",
  );
  const single = data.examples.map((row, i) => ({
    ...row,
    courseId: "one-native-course",
    sourceId: "source-" + i,
    targetId: "target-" + i,
  }));
  assert.equal(
    trainAdvisoryModel({ schemaVersion: 1, examples: single }).status,
    "insufficient-data",
  );
});
test("evaluation holds out whole courses and is invariant to input ordering", () => {
  const data = dataset(),
    model = trainAdvisoryModel(data);
  assert.equal(model.status, "available");
  const evaluation = model.evaluation;
  assert.equal(evaluation.trainingExamples, 48);
  assert.equal(evaluation.heldOutExamples, 16);
  assert.equal(evaluation.heldOutPositive, 8);
  assert.equal(
    evaluation.trainingCourses.some((course) =>
      evaluation.heldOutCourses.includes(course),
    ),
    false,
  );
  assert.deepEqual(
    model,
    trainAdvisoryModel({ ...data, examples: data.examples.toReversed() }),
  );
  assert.equal(evaluation.accuracy, 1); // Deliberately separable synthetic fixture, not a live quality claim.
  assert.ok(model.coefficients.some((weight) => Math.abs(weight) > 0.1));
  const approved = advisorySuggestion(
    model,
    candidate("new-course", 1, true),
    model.datasetFingerprint,
  );
  const rejected = advisorySuggestion(
    model,
    candidate("new-course", 1, false),
    model.datasetFingerprint,
  );
  assert.ok(approved.score > rejected.score);
  assert.equal(approved.automaticApplication, false);
  assert.equal(approved.confidence, "uncalibrated-ranking-score");
});
test("held-out labels do not leak into fitted coefficients", () => {
  const data = dataset(),
    original = trainAdvisoryModel(data);
  const heldOut = new Set(original.evaluation.heldOutCourses);
  const changed = {
    ...data,
    examples: data.examples.map((row) =>
      heldOut.has(row.courseId)
        ? {
            ...row,
            decision: row.decision === "approved" ? "rejected" : "approved",
          }
        : row,
    ),
  };
  const evaluated = trainAdvisoryModel(changed);
  assert.equal(evaluated.status, "available");
  assert.deepEqual(evaluated.coefficients, original.coefficients);
  assert.equal(evaluated.evaluation.accuracy, 0);
  assert.notEqual(evaluated.datasetFingerprint, original.datasetFingerprint);
});
test("duplicate reviewed pairs, conflicting hash features and raw body imports fail closed", () => {
  const data = dataset();
  assert.throws(
    () =>
      normalizeAdvisoryDataset({
        ...data,
        examples: [...data.examples, data.examples[0]],
      }),
    /only once/,
  );
  assert.throws(
    () =>
      normalizeAdvisoryDataset({
        ...data,
        examples: [{ ...data.examples[0], body: "private source content" }],
      }),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      normalizeAdvisoryDataset({
        ...data,
        examples: [{ ...data.examples[0], decision: "automatic" }],
      }),
    /explicit/,
  );
  assert.throws(
    () =>
      normalizeAdvisoryDataset({
        ...data,
        examples: [{ ...data.examples[0], sourceHash: "b".repeat(64) }],
      }),
    /Hash features/,
  );
  assert.throws(
    () =>
      normalizeAdvisoryDataset({
        ...data,
        examples: [{ ...data.examples[0], features: Array(9).fill(NaN) }],
      }),
    /finite/,
  );
  const inconsistent = [...data.examples[0].features];
  inconsistent[5] = 0;
  assert.throws(
    () =>
      normalizeAdvisoryDataset({
        ...data,
        examples: [{ ...data.examples[0], features: inconsistent }],
      }),
    /consistent/,
  );
  assert.throws(
    () =>
      normalizeAdvisoryDataset({
        ...data,
        examples: Array(2001).fill(data.examples[0]),
      }),
    /at most/,
  );
});
test("fingerprints bind labels/provenance and stale datasets cannot produce suggestions", () => {
  const data = dataset(),
    model = trainAdvisoryModel(data);
  const changed = {
    ...data,
    examples: data.examples.map((row, i) =>
      i ? row : { ...row, reviewerId: "another-owner" },
    ),
  };
  const fingerprint = advisoryDatasetFingerprint(changed);
  assert.notEqual(model.datasetFingerprint, fingerprint);
  assert.equal(
    advisorySuggestion(model, candidate(), fingerprint).status,
    "stale",
  );
  const record = createAdvisoryRecordData("assignment", data, at);
  assert.deepEqual(validateAdvisoryRecordData(record), record);
  assert.throws(
    () =>
      validateAdvisoryRecordData({
        ...record,
        datasetFingerprint: "0".repeat(64),
      }),
    /changed/,
  );
  const forged = structuredClone(record);
  forged.model.coefficients[0] += 10;
  assert.throws(() => validateAdvisoryRecordData(forged), /changed/);
  const metric = structuredClone(record);
  metric.model.evaluation.accuracy = 0.123;
  assert.throws(() => validateAdvisoryRecordData(metric), /changed/);
});
test("recorded-work metrics do not invent owner time or success rates", () => {
  const records = [
    { kind: "item-review", packageId: "a", data: {} },
    { kind: "audit", packageId: "a", data: {} },
    { kind: "audit", packageId: "other", data: {} },
  ];
  assert.deepEqual(assignmentWorkMetrics("a", records), {
    ownerReviewRecords: 1,
    comparisonRecords: 1,
    evidenceIntakeRecords: 0,
    lifecycleEvents: 0,
    mappingReviewEvents: 0,
    ownerReviewsPerComparison: 1,
    elapsedOwnerMinutes: null,
    automaticResolutionRate: null,
  });
});
test("normal-work candidates retain native identities and an exact audit basis without attaching content", () => {
  const audit = {
    id: "audit-one",
    version: 2,
    kind: "audit",
    packageId: "workspace-course",
    data: {
      sourceScanSha256: "c".repeat(64),
      hashes: { json: "d".repeat(64) },
      result: {
        stats: {
          extractorMeta: {
            page: {
              url: "https://www.coursera.org/teach/test/native-course/content/edit",
            },
            payloadBindingDiagnostics: [
              {
                status: "REVIEW",
                itemId: "xlsx-native-id",
                itemName: "Repeated title",
                candidates: [
                  {
                    id: "capture-native-id",
                    name: "Repeated title",
                    payload: { body: "Do not retain this" },
                  },
                ],
              },
              {
                status: "REVIEW",
                itemId: "",
                candidates: [{ id: "candidate" }],
              },
            ],
          },
        },
        liveSourceGroundTruth: {
          sourceTopicCandidates: [
            {
              status: "REVIEW",
              sourceId: "package-native-id",
              sourceName: "Reading",
              candidates: [
                { topicId: "brightspace-native-id", title: "Reading" },
              ],
            },
          ],
        },
      },
    },
  };
  const before = JSON.stringify(audit),
    candidates = advisoryCandidatesFromAudit("workspace-course", audit);
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((row) => [row.sourceId, row.targetId]),
    [
      ["xlsx-native-id", "capture-native-id"],
      ["package-native-id", "brightspace-native-id"],
    ],
  );
  assert.equal(candidates[0].courseGroupId, "coursera:native-course");
  const label = reviewedMappingExample(
    candidates[0],
    "approved",
    "owner-id",
    at,
  );
  assert.equal(label.courseId, "coursera:native-course");
  assert.equal(label.basis.auditId, "audit-one");
  assert.equal(label.basis.auditVersion, 2);
  assert.equal(JSON.stringify(label).includes("Repeated title"), false);
  assert.equal(JSON.stringify(label).includes("Do not retain"), false);
  assert.equal(JSON.stringify(audit), before);
  const later = structuredClone(audit);
  later.version++;
  assert.notEqual(
    advisoryCandidatesFromAudit("workspace-course", later)[0].basis
      .inputFingerprint,
    candidates[0].basis.inputFingerprint,
  );
  assert.deepEqual(advisoryCandidatesFromAudit("another-workspace", audit), []);
});
test("pooling keeps an explicit latest pair decision without inflating reviews", () => {
  const first = reviewedMappingExample(candidate(), "approved", "owner", at);
  const second = {
    ...first,
    decision: "rejected",
    reviewedAt: "2026-10-17T00:00:00.000Z",
  };
  const data = mergeAdvisoryDatasets([
    { schemaVersion: 1, examples: [first] },
    { schemaVersion: 1, examples: [second] },
  ]);
  assert.equal(data.examples.length, 1);
  assert.equal(data.examples[0].decision, "rejected");
  assert.deepEqual(
    data,
    mergeAdvisoryDatasets([
      { schemaVersion: 1, examples: [second] },
      { schemaVersion: 1, examples: [first] },
    ]),
  );
  assert.throws(
    () =>
      mergeAdvisoryDatasets([
        { schemaVersion: 1, examples: [first] },
        { schemaVersion: 1, examples: [{ ...first, decision: "rejected" }] },
      ]),
    /Conflicting reviews/,
  );
});

test("workspace learning receipts reproduce the exact audit candidate and cannot forge feature evidence", () => {
  const audit = {
    id: "retained-audit",
    version: 3,
    kind: "audit",
    packageId: "assignment",
    data: {
      sourceScanSha256: "c".repeat(64),
      hashes: { json: "d".repeat(64) },
      result: {
        stats: {
          extractorMeta: {
            payloadBindingDiagnostics: [
              {
                status: "REVIEW",
                itemId: "native-source",
                itemName: "Literal reading",
                itemPath: "Module 1",
                itemType: "reading",
                candidates: [
                  {
                    id: "native-target",
                    name: "Literal reading",
                    path: "Module 1",
                    type: "reading",
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };
  const pair = advisoryCandidatesFromAudit("assignment", audit)[0];
  const row = reviewedMappingExample(pair, "approved", "reviewer", at);
  assert.doesNotThrow(() => validateAdvisoryAuditExample(row, audit));
  for (const alter of [
    (value) => (value.courseId = "another-native-course"),
    (value) => (value.sourceId = "unretained-source"),
    (value) => (value.targetId = "unretained-target"),
    (value) => (value.features[0] = 0.5),
    (value) => (value.basis.inputFingerprint = "f".repeat(64)),
  ]) {
    const forged = structuredClone(row);
    alter(forged);
    assert.throws(
      () => validateAdvisoryAuditExample(forged, audit),
      /candidate|basis/,
    );
  }
  assert.throws(
    () => validateAdvisoryAuditExample(row, { ...audit, version: 4 }),
    /changed/,
  );
  const changed = structuredClone(audit);
  changed.data.hashes.json = "e".repeat(64);
  assert.throws(
    () => validateAdvisoryAuditExample(row, changed),
    /candidate|basis/,
  );
  assert.throws(
    () => validateAdvisoryAuditExample(row, undefined),
    /unavailable/,
  );
  assert.doesNotThrow(() =>
    validateAdvisoryAuditExample(
      reviewedMappingExample(candidate(), "approved", "reviewer", at),
      undefined,
    ),
  );
});

test("a newer pooled owner review invalidates an older evaluated model without replacing its history", () => {
  const data = dataset(),
    original = JSON.stringify(data),
    model = trainAdvisoryModel(data);
  const newer = {
    ...data.examples[0],
    decision:
      data.examples[0].decision === "approved" ? "rejected" : "approved",
    reviewedAt: "2026-10-17T00:00:00.000Z",
  };
  const pooled = mergeAdvisoryDatasets([
    data,
    { schemaVersion: 1, examples: [newer] },
  ]);
  assert.equal(pooled.examples.length, data.examples.length);
  assert.equal(
    advisorySuggestion(
      model,
      candidate("current-course"),
      advisoryDatasetFingerprint(pooled),
    ).status,
    "stale",
  );
  assert.equal(JSON.stringify(data), original);
});
