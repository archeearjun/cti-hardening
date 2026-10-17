import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";
import {
  createAutomaticIngestionBasis,
  createIngestionAttemptRecord,
  currentIngestionAttempt,
  ingestionAttemptRecordId,
  validateAutomaticIngestionAuditReferences,
  validateAutomaticIngestionBasisData,
  validateIngestionAttemptData,
  validateIngestionAttemptReferences,
} from "../src/domain/ingestion-attempts.ts";

const actor = "owner@example.test";
const now = "2026-10-17T12:00:00.000Z";
const course = (id = "course-1") => ({
  id,
  kind: "package",
  title: "Example course",
  packageId: "",
  version: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  updatedBy: actor,
  data: {},
});
const audit = (id = "audit-0", generation = 0, extra = {}) => ({
  id,
  kind: "audit",
  title: id,
  packageId: "course-1",
  version: 1,
  updatedAt: "2026-10-02T00:00:00.000Z",
  updatedBy: actor,
  data: { generation, result: {}, ...extra },
});
const repair = (runId, toGeneration) => ({
  id: `repair-${runId}`,
  kind: "operations",
  title: "Confirmed repair",
  packageId: "course-1",
  version: 1,
  updatedAt: now,
  updatedBy: actor,
  data: { type: "lineage-repair", runId, toGeneration },
});
const baseline = () => [course(), audit()];
const firstAttempt = () =>
  createIngestionAttemptRecord(course(), baseline(), actor, now);

test("an unrecorded course starts at 0 without claiming complete external history", () => {
  assert.deepEqual(currentIngestionAttempt("course-1", [course()]), {
    generation: 0,
    hasHistory: false,
    latestAuditId: "",
    latestAttemptId: "",
  });
  assert.throws(
    () => createIngestionAttemptRecord(course(), [course()], actor, now),
    /first.*comparison.*0/i,
  );
  assert.deepEqual(currentIngestionAttempt("course-1", baseline()), {
    generation: 0,
    hasHistory: true,
    latestAuditId: "audit-0",
    latestAttemptId: "",
  });
});

test("new reports, fresh captures, manual corrections, publishing and build/run IDs never increment", () => {
  const records = baseline();
  for (const [i, mode] of [
    "RAW_INGESTION",
    "CORRECTED",
    "PUBLISHED",
  ].entries()) {
    records.push({
      ...audit(`report-${i}`, 0, {
        result: {
          snapshotContext: { mode },
          capture: { runId: `capture-${i}` },
        },
        capturedAt: `2026-10-0${i + 3}T00:00:00.000Z`,
        capture: { runId: `fresh-${i}` },
        buildVersion: `${i + 1}`,
      }),
      updatedAt: `2026-10-0${i + 3}T00:00:00.000Z`,
    });
  }
  records.push({
    ...repair("report-0", 0),
    id: "ordinary-build",
    data: { type: "runtime-inventory", rows: [], build: 99 },
  });
  assert.equal(currentIngestionAttempt("course-1", records).generation, 0);
  assert.equal(
    currentIngestionAttempt("course-1", records).latestAuditId,
    "report-2",
  );
});

test("legacy generation 3 remains 3 without inventing generations 0–2", () => {
  const records = [course(), audit("legacy-3", 3)];
  assert.deepEqual(currentIngestionAttempt("course-1", records), {
    generation: 3,
    hasHistory: true,
    latestAuditId: "legacy-3",
    latestAttemptId: "",
  });
  const next = createIngestionAttemptRecord(course(), records, actor, now);
  assert.equal(next.data.generation, 4);
  assert.equal(next.data.previousGeneration, 3);
  assert.equal(next.data.previousAttemptId, "");
  validateIngestionAttemptReferences(next, records);
  assert.equal(
    currentIngestionAttempt("course-1", [...records, next]).generation,
    4,
  );
  assert.equal(records.length, 2);
});

test("another course's audits, receipts and repairs do not affect this course", () => {
  const other = course("course-2");
  const otherAudit = { ...audit("other-audit", 20), packageId: other.id };
  const otherAttempt = createIngestionAttemptRecord(
    other,
    [other, otherAudit],
    actor,
    now,
  );
  const otherRepair = { ...repair(otherAudit.id, 19), packageId: other.id };
  assert.deepEqual(
    currentIngestionAttempt("course-1", [
      ...baseline(),
      other,
      otherAudit,
      otherAttempt,
      otherRepair,
    ]),
    {
      generation: 0,
      hasHistory: true,
      latestAuditId: "audit-0",
      latestAttemptId: "",
    },
  );
});

test("confirmed lineage repairs lower the derived maximum while raw audits remain unchanged", () => {
  const high = audit("repeated-export", 1);
  const records = [...baseline(), high, repair(high.id, 0)];
  assert.equal(currentIngestionAttempt("course-1", records).generation, 0);
  assert.equal(high.data.generation, 1);
  const next = createIngestionAttemptRecord(course(), records, actor, now);
  assert.equal(next.data.generation, 1);
  validateIngestionAttemptReferences(next, records);
});

test("attempt receipts use deterministic bounded IDs and an exact owner-declared schema", () => {
  const one = firstAttempt();
  const repeated = firstAttempt();
  assert.deepEqual(one, repeated);
  assert.equal(one.version, 0);
  assert.equal(one.kind, "operations");
  assert.equal(one.packageId, "course-1");
  assert.equal(one.data.scope, "OWNER_DECLARED_EXTERNAL_INGESTION");
  assert.equal(one.data.declaredBy, actor);
  assert.equal(one.data.declaredAt, now);
  assert.equal(one.data.baseAuditId, "audit-0");
  assert.equal(one.data.previousAttemptId, "");
  assert.equal(one.id, ingestionAttemptRecordId("course-1", 1));
  validateIngestionAttemptReferences(one, baseline());
  const longId = "x".repeat(120);
  const long = ingestionAttemptRecordId(longId, 99);
  assert.match(long, /^[A-Za-z0-9_-]{1,120}$/);
  assert.equal(long, ingestionAttemptRecordId(longId, 99));
  assert.notEqual(long, ingestionAttemptRecordId("y".repeat(120), 99));
  assert.notEqual(long, ingestionAttemptRecordId(longId, 98));
  const digest = createHash("sha256").update(longId).digest("hex");
  assert.notEqual(
    ingestionAttemptRecordId(longId, 1),
    ingestionAttemptRecordId(`sha256_${digest}`, 1),
    "hashed long IDs and valid readable course IDs occupy disjoint namespaces",
  );
});

test("completed ingestion declarations advance exactly once and survive reload without a new audit", () => {
  const records = baseline();
  const one = firstAttempt();
  records.push(one);
  assert.deepEqual(
    currentIngestionAttempt("course-1", structuredClone(records)),
    {
      generation: 1,
      hasHistory: true,
      latestAuditId: "audit-0",
      latestAttemptId: one.id,
    },
  );
  const two = createIngestionAttemptRecord(
    course(),
    records,
    actor,
    "2026-10-17T13:00:00.000Z",
  );
  assert.equal(two.data.generation, 2);
  assert.equal(two.data.previousGeneration, 1);
  assert.equal(two.data.previousAttemptId, one.id);
  assert.equal(two.data.baseAuditId, "audit-0");
  validateIngestionAttemptReferences(two, records);
  records.push(two);
  assert.equal(
    currentIngestionAttempt("course-1", structuredClone(records)).generation,
    2,
  );
  records.push({
    ...audit("new-capture", 2),
    updatedAt: "2026-10-17T14:00:00.000Z",
  });
  assert.equal(currentIngestionAttempt("course-1", records).generation, 2);
});

test("recorded attempt 99 is retained and cannot be advanced", () => {
  const records = [course(), audit("last-supported", 99)];
  assert.equal(currentIngestionAttempt("course-1", records).generation, 99);
  assert.throws(
    () => createIngestionAttemptRecord(course(), records, actor, now),
    /99.*limit/,
  );
  const generation99 = createIngestionAttemptRecord(
    course(),
    [course(), audit("prior", 98)],
    actor,
    now,
  );
  assert.equal(generation99.data.generation, 99);
  validateIngestionAttemptReferences(generation99, [
    course(),
    audit("prior", 98),
  ]);
});

test("receipt validation rejects arbitrary generations, unbounded fields and false execution claims", () => {
  const valid = firstAttempt().data;
  for (const patch of [
    { generation: "1" },
    { previousGeneration: "0" },
    { generation: 2 },
    { generation: 100, previousGeneration: 99 },
    { generation: 0, previousGeneration: -1 },
    { generation: 1.5, previousGeneration: 0.5 },
    { courseId: "bad/course" },
    { baseAuditId: "" },
    { previousAttemptId: "?" },
    { schemaVersion: 2 },
    { declaredAt: "2026-02-31T12:00:00.000Z" },
    { declaredAt: "2026-10-17" },
    { declaredBy: "" },
    { declaredBy: "x".repeat(321) },
    { declaredBy: "owner\nforged" },
    { scope: "EXECUTION_VERIFIED" },
    { nativeExecutionProof: true },
  ])
    assert.throws(
      () => validateIngestionAttemptData({ ...valid, ...patch }),
      /ingestion attempt receipt/i,
    );
  for (const value of [null, [], "receipt"])
    assert.throws(() => validateIngestionAttemptData(value), /receipt/);
  assert.throws(
    () => createIngestionAttemptRecord(course(), baseline(), "", now),
    /receipt/,
  );
});

test("malformed known audit generations are rejected without numeric coercion", () => {
  for (const generation of ["3", undefined, null, -1, 1.5, 100, NaN])
    assert.throws(
      () =>
        currentIngestionAttempt("course-1", [
          { ...audit("invalid"), data: { generation, result: {} } },
        ]),
      /recorded ingestion generation/,
    );
});

test("duplicate rows, noncanonical receipts and conflicting or cross-course references fail clearly", () => {
  const one = firstAttempt();
  assert.throws(
    () => currentIngestionAttempt("course-1", [audit(), audit()]),
    /Duplicate/,
  );
  assert.throws(
    () => currentIngestionAttempt("course-1", [...baseline(), one, one]),
    /Duplicate/,
  );
  assert.throws(
    () =>
      currentIngestionAttempt("course-1", [
        ...baseline(),
        { ...one, id: "arbitrary-id" },
      ]),
    /noncanonical/,
  );
  assert.throws(
    () =>
      currentIngestionAttempt("course-1", [
        ...baseline(),
        { ...one, packageId: "course-2" },
      ]),
    /different course/,
  );
  assert.throws(
    () =>
      currentIngestionAttempt("course-1", [
        ...baseline(),
        { ...one, data: { ...one.data, baseAuditId: "missing" } },
      ]),
    /baseline/,
  );
  assert.throws(
    () =>
      currentIngestionAttempt("course-1", [
        ...baseline(),
        repair("missing", 0),
      ]),
    /unbound lineage repair/,
  );
  assert.throws(
    () =>
      currentIngestionAttempt("course-1", [
        ...baseline(),
        repair("audit-0", 0),
        { ...repair("audit-0", 1), id: "repair-2" },
      ]),
    /Conflicting lineage repairs/,
  );
});

test("known declaration chains cannot skip their prior receipt or invent a missing baseline", () => {
  const one = firstAttempt();
  const two = createIngestionAttemptRecord(
    course(),
    [...baseline(), one],
    actor,
    now,
  );
  assert.throws(
    () =>
      currentIngestionAttempt("course-1", [
        ...baseline(),
        one,
        { ...two, data: { ...two.data, previousAttemptId: "" } },
      ]),
    /previous declaration/,
  );
  assert.throws(
    () => currentIngestionAttempt("course-1", [...baseline(), two]),
    /baseline/,
  );
  const forged = {
    ...one,
    id: ingestionAttemptRecordId("course-1", 3),
    data: { ...one.data, generation: 3, previousGeneration: 2 },
  };
  assert.throws(
    () => currentIngestionAttempt("course-1", [...baseline(), forged]),
    /baseline/,
  );
  const higherLegacy = audit("higher-legacy-history", 3);
  assert.equal(
    currentIngestionAttempt("course-1", [...baseline(), one, higherLegacy])
      .generation,
    3,
  );
  assert.throws(
    () =>
      validateIngestionAttemptReferences(one, [...baseline(), higherLegacy]),
    /stale/,
  );
  const simultaneous = {
    ...audit("same-millisecond-report", 1),
    updatedAt: now,
  };
  assert.equal(
    currentIngestionAttempt("course-1", [...baseline(), one, simultaneous])
      .generation,
    1,
  );
});

test("reference validation rejects stale audit bases, stale receipt bases and unbound courses", () => {
  const one = firstAttempt();
  const newer = {
    ...audit("latest-same-generation", 0),
    updatedAt: "2026-10-16T00:00:00.000Z",
  };
  assert.throws(
    () => validateIngestionAttemptReferences(one, [...baseline(), newer]),
    /stale/,
  );
  assert.throws(
    () => validateIngestionAttemptReferences(one, [audit()]),
    /course.*not found/,
  );
  assert.throws(
    () =>
      validateIngestionAttemptReferences(
        { ...one, id: "wrong-id" },
        baseline(),
      ),
    /noncanonical/,
  );
  const competing = {
    ...one,
    data: { ...one.data, declaredBy: "other-owner@example.test" },
  };
  assert.throws(
    () => validateIngestionAttemptReferences(one, [...baseline(), competing]),
    /different ingestion declaration/,
  );
  const two = createIngestionAttemptRecord(
    course(),
    [...baseline(), one],
    actor,
    now,
  );
  assert.throws(
    () => validateIngestionAttemptReferences(one, [...baseline(), one, two]),
    /baseline|stale/,
  );
});

test("reference validation applies repairs and rejects an outdated pre-repair declaration", () => {
  const repeated = audit("repeated", 1);
  const beforeRepair = [...baseline(), repeated];
  const stale = createIngestionAttemptRecord(
    course(),
    beforeRepair,
    actor,
    now,
  );
  assert.equal(stale.data.generation, 2);
  assert.throws(
    () =>
      validateIngestionAttemptReferences(stale, [
        ...beforeRepair,
        repair(repeated.id, 0),
      ]),
    /stale/,
  );
  const corrected = createIngestionAttemptRecord(
    course(),
    [...beforeRepair, repair(repeated.id, 0)],
    actor,
    now,
  );
  assert.equal(corrected.data.generation, 1);
  validateIngestionAttemptReferences(corrected, [
    ...beforeRepair,
    repair(repeated.id, 0),
  ]);
});

test("owner declaration timestamps remain statements rather than proof of cross-device or restore ordering", () => {
  const earlyClock = createIngestionAttemptRecord(
    course(),
    baseline(),
    actor,
    "2026-10-01T12:00:00.000Z",
  );
  validateIngestionAttemptReferences(earlyClock, baseline());
  assert.equal(
    currentIngestionAttempt("course-1", [...baseline(), earlyClock]).generation,
    1,
  );
  const one = firstAttempt();
  const earlierDevice = createIngestionAttemptRecord(
    course(),
    [...baseline(), one],
    actor,
    "2026-10-17T11:59:59.000Z",
  );
  validateIngestionAttemptReferences(earlierDevice, [...baseline(), one]);
  assert.equal(earlierDevice.data.previousAttemptId, one.id);
  const saved = { ...one, version: 1, updatedAt: "2026-10-17T12:00:01.000Z" };
  validateIngestionAttemptReferences(
    createIngestionAttemptRecord(course(), [...baseline(), saved], actor, now),
    [...baseline(), saved],
  );
  const unknownDate = [course(), { ...audit(), updatedAt: "" }];
  const next = createIngestionAttemptRecord(
    course(),
    unknownDate,
    actor,
    "2020-01-01T00:00:00.000Z",
  );
  validateIngestionAttemptReferences(next, unknownDate);
});

const automaticAudit = (id, records) => {
  const automaticIngestion = createAutomaticIngestionBasis("course-1", records);
  return {
    ...audit(id, automaticIngestion.generation),
    updatedAt: "2026-10-17T13:00:00.000Z",
    data: {
      generation: automaticIngestion.generation,
      result: {},
      automaticIngestion,
    },
  };
};

test("automatic comparisons bind the first saved attempt 0 and exclude their own record", () => {
  assert.deepEqual(createAutomaticIngestionBasis("course-1", [course()]), {
    schemaVersion: 1,
    courseId: "course-1",
    generation: 0,
    baseAuditId: "",
    attemptRecordId: "",
  });
  const first = automaticAudit("first-auto-audit", [course()]);
  validateAutomaticIngestionAuditReferences(first, [course()]);
  validateAutomaticIngestionAuditReferences(first, [course(), first]);
  assert.equal(first.data.generation, 0);
});

test("automatic basis validation keeps a bounded exact schema and validates audit course/generation", () => {
  const valid = createAutomaticIngestionBasis("course-1", baseline());
  assert.deepEqual(validateAutomaticIngestionBasisData(valid), valid);
  for (const patch of [
    { schemaVersion: 2 },
    { courseId: "bad/course" },
    { generation: "0" },
    { generation: -1 },
    { generation: 100 },
    { generation: 0.5 },
    { baseAuditId: undefined },
    { baseAuditId: "x".repeat(121) },
    { attemptRecordId: null },
    { attemptRecordId: "bad/id" },
    { verifiedExecution: true },
  ])
    assert.throws(
      () => validateAutomaticIngestionBasisData({ ...valid, ...patch }),
      /automatic ingestion comparison basis/,
    );
  for (const value of [null, [], "basis"])
    assert.throws(() => validateAutomaticIngestionBasisData(value), /basis/);
  const next = automaticAudit("automatic-audit", baseline());
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(
        { ...next, kind: "operations" },
        baseline(),
      ),
    /must be an audit/,
  );
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(
        { ...next, packageId: "course-2" },
        baseline(),
      ),
    /different source course/,
  );
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(
        { ...next, data: { ...next.data, generation: 1 } },
        baseline(),
      ),
    /different.*generation/,
  );
  assert.throws(
    () => validateAutomaticIngestionAuditReferences(next, [audit()]),
    /source course was not found/,
  );
});

test("another owner declaring a completed ingestion invalidates an in-flight automatic report", () => {
  const next = automaticAudit("computed-before-ingestion", baseline());
  validateAutomaticIngestionAuditReferences(next, baseline());
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(next, [
        ...baseline(),
        firstAttempt(),
      ]),
    /history changed.*stale/,
  );
});

test("another saved audit invalidates an automatic report even at the same generation", () => {
  const next = automaticAudit("in-flight", baseline());
  const concurrent = {
    ...audit("concurrent", 0),
    updatedAt: "2026-10-17T12:30:00.000Z",
  };
  assert.equal(
    currentIngestionAttempt("course-1", [...baseline(), concurrent]).generation,
    0,
  );
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(next, [
        ...baseline(),
        concurrent,
      ]),
    /history changed.*stale/,
  );
});

test("lineage repairs invalidate automatic bases when generation or the same-generation audit base changes", () => {
  const high = audit("high-generation", 3);
  const records = [...baseline(), high];
  const next = automaticAudit("in-flight-high", records);
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(next, [
        ...records,
        repair(high.id, 0),
      ]),
    /history changed.*stale/,
  );
  const earlier = {
    ...audit("earlier-1", 1),
    updatedAt: "2026-10-03T00:00:00.000Z",
  };
  const later = {
    ...audit("later-1", 1),
    updatedAt: "2026-10-04T00:00:00.000Z",
  };
  const sameGenerationRecords = [...baseline(), earlier, later];
  const sameGenerationNext = automaticAudit(
    "in-flight-same-generation",
    sameGenerationRecords,
  );
  const repaired = [...sameGenerationRecords, repair(later.id, 0)];
  assert.equal(currentIngestionAttempt("course-1", repaired).generation, 1);
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(sameGenerationNext, repaired),
    /history changed.*stale/,
  );
});

test("automatic retries bind the durable receipt and remain in its generation", () => {
  const records = [...baseline(), firstAttempt()];
  const first = automaticAudit("first-report-after-declaration", records);
  assert.equal(
    first.data.automaticIngestion.attemptRecordId,
    records.at(-1).id,
  );
  assert.equal(first.data.generation, 1);
  validateAutomaticIngestionAuditReferences(first, records);
  const missingReceipt = {
    ...first,
    data: {
      ...first.data,
      automaticIngestion: {
        ...first.data.automaticIngestion,
        attemptRecordId: "",
      },
    },
  };
  assert.throws(
    () => validateAutomaticIngestionAuditReferences(missingReceipt, records),
    /history changed.*stale/,
  );
  records.push(first);
  const retry = automaticAudit("retried-report", records);
  assert.equal(retry.data.generation, 1);
  assert.equal(retry.data.automaticIngestion.baseAuditId, first.id);
  validateAutomaticIngestionAuditReferences(retry, records);
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(
        { ...first, id: "replayed-old-basis" },
        records,
      ),
    /history changed.*stale/,
  );
});

test("historical imports without automatic metadata keep their existing ingestion generation", () => {
  const legacy = audit("historical-import", 3);
  validateAutomaticIngestionAuditReferences(legacy, [
    ...baseline(),
    firstAttempt(),
  ]);
  assert.equal(legacy.data.generation, 3);
  assert.equal(Object.hasOwn(legacy.data, "automaticIngestion"), false);
});

const withJsonCapture = (record, hash, capturedAt, directDataCapture) => ({
  ...record,
  data: {
    ...record.data,
    hashes: { json: hash },
    result: {
      stats: {
        extractorMeta: {
          capturedAt,
          ...(directDataCapture ? { directDataCapture } : {}),
        },
      },
    },
  },
});
const freshCaptureFixture = () => {
  const base = withJsonCapture(
    audit(),
    "a".repeat(64),
    "2026-10-02T00:00:00.000Z",
  );
  const records = [course(), base];
  records.push(createIngestionAttemptRecord(course(), records, actor, now));
  const next = withJsonCapture(
    automaticAudit("fresh-capture-report", records),
    "b".repeat(64),
    "2026-10-10T00:00:00.000Z",
  );
  return { records, base, next };
};

test("explicit-ingestion JSON comparisons require fresh content relative to the receipt base, independent of declaration date", () => {
  const { records, next } = freshCaptureFixture();
  assert.ok(
    Date.parse(next.data.result.stats.extractorMeta.capturedAt) <
      Date.parse(records.at(-1).data.declaredAt),
  );
  validateAutomaticIngestionAuditReferences(next, records);
  const xlsxOnly = {
    ...next,
    data: { ...next.data, hashes: { excel: "c".repeat(64) } },
  };
  validateAutomaticIngestionAuditReferences(xlsxOnly, records);
});

test("old JSON bytes, old observations and media-only continuations cannot become a new ingestion baseline", () => {
  const { records, next } = freshCaptureFixture();
  const oldBytes = withJsonCapture(
    next,
    "a".repeat(64),
    "2026-10-10T00:00:00.000Z",
  );
  assert.throws(
    () => validateAutomaticIngestionAuditReferences(oldBytes, records),
    /fresh course bookmark capture/,
  );
  for (const capturedAt of [
    "2026-10-02T00:00:00.000Z",
    "2026-10-01T00:00:00.000Z",
  ])
    assert.throws(
      () =>
        validateAutomaticIngestionAuditReferences(
          withJsonCapture(next, "b".repeat(64), capturedAt),
          records,
        ),
      /fresh course bookmark capture/,
    );
  const mediaOnly = withJsonCapture(
    next,
    "c".repeat(64),
    "2026-10-18T00:00:00.000Z",
    {
      mediaEnrichment: {
        scope: "original-media",
        retainedAssessmentObservations: true,
        baseSourceCapturedAt: "2026-10-02T00:00:00.000Z",
      },
    },
  );
  assert.throws(
    () => validateAutomaticIngestionAuditReferences(mediaOnly, records),
    /fresh course bookmark capture/,
  );
});

test("invalid new JSON hashes or unknown new content observations cannot establish a fresh capture", () => {
  const { records, base, next } = freshCaptureFixture();
  for (const hash of ["not-a-sha256", null])
    assert.throws(
      () =>
        validateAutomaticIngestionAuditReferences(
          withJsonCapture(next, hash, "2026-10-10T00:00:00.000Z"),
          records,
        ),
      /fresh course bookmark capture/,
    );
  for (const capturedAt of [undefined, "invalid"])
    assert.throws(
      () =>
        validateAutomaticIngestionAuditReferences(
          withJsonCapture(next, "b".repeat(64), capturedAt),
          records,
        ),
      /fresh course bookmark capture/,
    );
  for (const unknownBase of [
    { ...base, data: { ...base.data, hashes: {} } },
    { ...base, data: { ...base.data, hashes: { json: "invalid" } } },
    { ...base, data: { ...base.data, result: {} } },
  ]) {
    const unknownRecords = records.map((row) =>
      row.id === base.id ? unknownBase : row,
    );
    const retained = structuredClone(unknownBase);
    validateAutomaticIngestionAuditReferences(next, unknownRecords);
    assert.deepEqual(
      unknownBase,
      retained,
      "unknown historical hash or observation is not filled in",
    );
  }
  const unboundMedia = withJsonCapture(
    next,
    "c".repeat(64),
    "2026-10-18T00:00:00.000Z",
    {
      mediaEnrichment: {
        scope: "original-media",
        retainedAssessmentObservations: true,
      },
    },
  );
  assert.throws(
    () => validateAutomaticIngestionAuditReferences(unboundMedia, records),
    /fresh course bookmark capture/,
  );
});

test("a structural legacy baseline permits a new JSON capture while its missing history stays unknown", () => {
  const base = {
    ...audit(),
    data: { ...audit().data, hashes: { excel: "a".repeat(64) } },
  };
  const records = [course(), base];
  const receipt = createIngestionAttemptRecord(course(), records, actor, now);
  records.push(receipt);
  const next = withJsonCapture(
    automaticAudit("first-json-after-ingestion", records),
    "b".repeat(64),
    "2026-10-10T00:00:00.000Z",
  );
  validateAutomaticIngestionAuditReferences(next, records);
  assert.equal(receipt.data.scope, "OWNER_DECLARED_EXTERNAL_INGESTION");
  assert.equal(base.data.hashes.json, undefined);
  assert.equal(base.data.result.stats, undefined);
  assert.equal(next.data.generation, 1);
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(
        next,
        records.filter((row) => row.id !== base.id),
      ),
    /baseline/,
  );
  const noNewObservation = withJsonCapture(next, "b".repeat(64), undefined);
  assert.throws(
    () => validateAutomaticIngestionAuditReferences(noNewObservation, records),
    /fresh course bookmark capture/,
  );
});

test("repeating a current-ingestion capture is valid because freshness is measured against the receipt's prior-generation audit", () => {
  const { records, next } = freshCaptureFixture();
  validateAutomaticIngestionAuditReferences(next, records);
  records.push(next);
  const retry = withJsonCapture(
    automaticAudit("same-capture-new-report", records),
    next.data.hashes.json,
    next.data.result.stats.extractorMeta.capturedAt,
  );
  assert.equal(retry.data.automaticIngestion.baseAuditId, next.id);
  assert.equal(
    retry.data.automaticIngestion.attemptRecordId,
    records.find((row) => row.data.type === "ingestion-attempt").id,
  );
  validateAutomaticIngestionAuditReferences(retry, records);
  assert.equal(retry.data.generation, 1);
});

test("generation 0 and legacy generations without a durable declaration preserve existing capture behavior", () => {
  for (const generation of [0, 3]) {
    const records = [
      course(),
      withJsonCapture(
        audit("legacy-base", generation),
        "a".repeat(64),
        undefined,
      ),
    ];
    const next = withJsonCapture(
      automaticAudit("same-legacy-capture", records),
      "a".repeat(64),
      undefined,
    );
    validateAutomaticIngestionAuditReferences(next, records);
    assert.equal(next.data.generation, generation);
  }
});

test("real XLSX-only workflow output keeps empty JSON hashes structural after a new ingestion", () => {
  const workflows = createWorkflows(workerXml);
  const input = comparisonFixture();
  delete input.json;
  input.generation = 0;
  const baselineOutput = workflows.compare(input);
  assert.equal(baselineOutput.hashes.json, "");
  const base = {
    ...audit("xlsx-base", 0),
    packageId: input.course.id,
    data: baselineOutput,
  };
  const records = [input.course, base];
  const receipt = createIngestionAttemptRecord(
    input.course,
    records,
    actor,
    now,
  );
  records.push(receipt);
  input.generation = 1;
  input.history = records;
  const output = workflows.compare(input);
  assert.equal(output.result.success, true);
  assert.equal(output.hashes.json, "");
  assert.match(output.hashes.excel, /^[a-f0-9]{64}$/);
  const next = {
    ...audit("xlsx-after-ingestion", 1),
    packageId: input.course.id,
    data: {
      ...output,
      automaticIngestion: createAutomaticIngestionBasis(
        input.course.id,
        records,
      ),
    },
  };
  validateAutomaticIngestionAuditReferences(next, records);
});

test("a modern audit referencing a skewed client-clock receipt remains valid after saving", () => {
  const records = baseline();
  const receipt = {
    ...createIngestionAttemptRecord(
      course(),
      records,
      actor,
      "2026-10-17T10:05:00.000Z",
    ),
    updatedAt: "2026-10-17T10:00:00.000Z",
    version: 1,
  };
  records.push(receipt);
  const next = {
    ...automaticAudit("server-saved-before-client-time", records),
    updatedAt: "2026-10-17T10:01:00.000Z",
  };
  validateAutomaticIngestionAuditReferences(next, records);
  records.push(next);
  assert.equal(currentIngestionAttempt("course-1", records).generation, 1);
  assert.equal(
    currentIngestionAttempt("course-1", records).latestAuditId,
    next.id,
  );
  assert.equal(next.data.automaticIngestion.attemptRecordId, receipt.id);
});

test("restoring record timestamps preserves historical receipt identities and declaration dates", () => {
  const originalBase = { ...audit(), updatedAt: "2026-10-01T00:00:00.000Z" };
  const originalRecords = [course(), originalBase];
  const receipt = createIngestionAttemptRecord(
    course(),
    originalRecords,
    actor,
    "2026-10-02T00:00:00.000Z",
  );
  const restored = [...originalRecords, receipt].map((record) => ({
    ...record,
    updatedAt: now,
    version: record.version + 1,
  }));
  validateIngestionAttemptReferences(receipt, restored);
  assert.equal(currentIngestionAttempt("course-1", restored).generation, 1);
  assert.equal(
    currentIngestionAttempt("course-1", restored).latestAttemptId,
    receipt.id,
  );
  assert.equal(restored.at(-1).data.declaredAt, "2026-10-02T00:00:00.000Z");
});
