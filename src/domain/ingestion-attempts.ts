import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { applyLineageRepairs } from "./operations.ts";
import { courseraContentObservedAt } from "./coursera-observation-time.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

/** A receipt of the owner's declaration, not evidence of an LMS execution. */
export interface IngestionAttemptData {
  type: "ingestion-attempt";
  schemaVersion: 1;
  courseId: string;
  generation: number;
  previousGeneration: number;
  baseAuditId: string;
  previousAttemptId: string;
  declaredAt: string;
  declaredBy: string;
  scope: "OWNER_DECLARED_EXTERNAL_INGESTION";
}

export interface CurrentIngestionAttempt {
  generation: number;
  hasHistory: boolean;
  latestAuditId: string;
  latestAttemptId: string;
}

/** The recorded ingestion state used to compute an automatic comparison. */
export interface AutomaticIngestionBasis {
  schemaVersion: 1;
  courseId: string;
  generation: number;
  baseAuditId: string;
  attemptRecordId: string;
}

const idPattern = /^[A-Za-z0-9_-]{1,120}$/;
const validId = (value: unknown): value is string =>
  typeof value === "string" && idPattern.test(value);
const validGeneration = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 99;
const validDate = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(
      value,
    )
  )
    return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 19) === value.slice(0, 19)
  );
};
const validActor = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 320 &&
  !!value.trim() &&
  !/[\u0000-\u001f\u007f]/.test(value);

export function ingestionAttemptRecordId(
  courseId: string,
  generation: number,
): string {
  if (!validId(courseId) || !validGeneration(generation) || generation === 0)
    throw Error("Invalid ingestion attempt course or generation identity.");
  const readable = `ingestion-attempt_${courseId}_g${generation}`;
  return readable.length <= 120
    ? readable
    : `ingestion-attempt-hash_${bytesToHex(sha256(new TextEncoder().encode(courseId)))}_g${generation}`;
}

export function validateAutomaticIngestionBasisData(
  value: unknown,
): AutomaticIngestionBasis {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid automatic ingestion comparison basis.");
  const basis = value as AutomaticIngestionBasis;
  const fields = [
    "schemaVersion",
    "courseId",
    "generation",
    "baseAuditId",
    "attemptRecordId",
  ];
  if (
    Object.keys(basis).some((key) => !fields.includes(key)) ||
    basis.schemaVersion !== 1 ||
    !validId(basis.courseId) ||
    !validGeneration(basis.generation) ||
    !(basis.baseAuditId === "" || validId(basis.baseAuditId)) ||
    !(basis.attemptRecordId === "" || validId(basis.attemptRecordId))
  )
    throw Error(
      "Invalid automatic ingestion comparison basis identity or generation.",
    );
  return basis;
}

export function createAutomaticIngestionBasis(
  courseId: string,
  records: WorkspaceRecord[],
): AutomaticIngestionBasis {
  const current = currentIngestionAttempt(courseId, records);
  return {
    schemaVersion: 1,
    courseId,
    generation: current.generation,
    baseAuditId: current.latestAuditId,
    attemptRecordId: current.latestAttemptId,
  };
}

/** Legacy audit imports have no automatic basis and retain their own history. */
export function validateAutomaticIngestionAuditReferences(
  record: WorkspaceRecord,
  records: WorkspaceRecord[],
): void {
  if (record.kind !== "audit")
    throw Error("An automatic ingestion comparison must be an audit record.");
  if (record.data.automaticIngestion === undefined) return;
  const basis = validateAutomaticIngestionBasisData(
    record.data.automaticIngestion,
  );
  if (
    record.packageId !== basis.courseId ||
    record.data.generation !== basis.generation
  )
    throw Error(
      "Automatic ingestion comparison belongs to a different source course or generation.",
    );
  if (
    !records.some(
      (course) => course.id === basis.courseId && course.kind === "package",
    )
  )
    throw Error("Automatic ingestion comparison source course was not found.");
  const current = createAutomaticIngestionBasis(
    basis.courseId,
    records.filter((row) => row.id !== record.id),
  );
  if (
    basis.generation !== current.generation ||
    basis.baseAuditId !== current.baseAuditId ||
    basis.attemptRecordId !== current.attemptRecordId
  )
    throw Error(
      "Ingestion attempt history changed while this comparison was running; its automatic basis is stale. Run the comparison again from the current course history.",
    );
  // Compare with the receipt's pre-ingestion report. Later reports in this
  // same ingestion may reuse the fresh capture. A new media export alone
  // cannot establish that course content was observed again. Missing legacy
  // baseline facts stay unknown; they do not certify or disprove freshness.
  if (
    basis.attemptRecordId &&
    record.data.hashes?.json !== undefined &&
    record.data.hashes.json !== ""
  ) {
    const receipt = records.find((row) => row.id === basis.attemptRecordId);
    const baseAudit = records.find(
      (row) =>
        row.kind === "audit" &&
        row.packageId === basis.courseId &&
        row.id === receipt?.data.baseAuditId,
    );
    const baseHash = baseAudit?.data.hashes?.json;
    const nextHash = record.data.hashes.json;
    const baseObservedAt = courseraContentObservedAt(baseAudit || null);
    const nextObservedAt = courseraContentObservedAt(record);
    if (
      !baseAudit ||
      typeof nextHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(nextHash) ||
      (typeof baseHash === "string" &&
        /^[a-f0-9]{64}$/.test(baseHash) &&
        nextHash === baseHash) ||
      !nextObservedAt ||
      (!!baseObservedAt &&
        Date.parse(nextObservedAt) <= Date.parse(baseObservedAt))
    )
      throw Error(
        "A fresh course bookmark capture is required for this completed ingestion: use new JSON bytes with a usable content observation later than any known prior observation.",
      );
  }
}

export function validateIngestionAttemptData(
  value: unknown,
): IngestionAttemptData {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid ingestion attempt receipt.");
  const data = value as IngestionAttemptData;
  const fields = [
    "type",
    "schemaVersion",
    "courseId",
    "generation",
    "previousGeneration",
    "baseAuditId",
    "previousAttemptId",
    "declaredAt",
    "declaredBy",
    "scope",
  ];
  if (Object.keys(data).some((key) => !fields.includes(key)))
    throw Error("Unsupported ingestion attempt receipt field.");
  if (
    data.type !== "ingestion-attempt" ||
    data.schemaVersion !== 1 ||
    !validId(data.courseId) ||
    !validGeneration(data.generation) ||
    !validGeneration(data.previousGeneration) ||
    data.generation !== data.previousGeneration + 1 ||
    !validId(data.baseAuditId) ||
    !(data.previousAttemptId === "" || validId(data.previousAttemptId)) ||
    !validDate(data.declaredAt) ||
    !validActor(data.declaredBy) ||
    data.scope !== "OWNER_DECLARED_EXTERNAL_INGESTION"
  )
    throw Error(
      "Invalid ingestion attempt receipt identity, date, scope, or consecutive generation (1–99).",
    );
  return data;
}

function validateAttemptRecord(record: WorkspaceRecord): IngestionAttemptData {
  const data = validateIngestionAttemptData(record.data);
  if (
    record.kind !== "operations" ||
    record.packageId !== data.courseId ||
    record.id !== ingestionAttemptRecordId(data.courseId, data.generation)
  )
    throw Error(
      "Ingestion attempt receipt has a different course or noncanonical record ID.",
    );
  return data;
}

/**
 * Only recorded audit generations and durable owner declarations affect the
 * count. A missing local history starts at zero; it says nothing about earlier
 * external ingestions. Legacy generation gaps are deliberately left intact.
 */
export function currentIngestionAttempt(
  courseId: string,
  records: WorkspaceRecord[],
): CurrentIngestionAttempt {
  if (!validId(courseId)) throw Error("Invalid ingestion attempt course ID.");
  const audits = records.filter(
    (record) => record.kind === "audit" && record.packageId === courseId,
  );
  const auditById = new Map<string, WorkspaceRecord>();
  const seenIds = new Set<string>();
  const unique = (record: WorkspaceRecord) => {
    if (!validId(record.id) || seenIds.has(record.id))
      throw Error(
        "Duplicate or invalid record ID in ingestion attempt history.",
      );
    seenIds.add(record.id);
  };
  for (const audit of audits) {
    unique(audit);
    if (!validGeneration(audit.data?.generation))
      throw Error(
        `Invalid recorded ingestion generation on audit ${audit.id}; expected a whole number from 0 through 99.`,
      );
    auditById.set(audit.id, audit);
  }

  const repairs = records.filter(
    (record) =>
      record.kind === "operations" &&
      record.data?.type === "lineage-repair" &&
      (record.packageId === courseId || auditById.has(record.data.runId)),
  );
  const repairedGenerations = new Map<string, number>();
  for (const repair of repairs) {
    unique(repair);
    const data = repair.data;
    if (
      repair.packageId !== courseId ||
      !validId(data.runId) ||
      !auditById.has(data.runId) ||
      !validGeneration(data.toGeneration)
    )
      throw Error(
        "Invalid or unbound lineage repair in ingestion attempt history.",
      );
    const previous = repairedGenerations.get(data.runId);
    if (previous !== undefined && previous !== data.toGeneration)
      throw Error("Conflicting lineage repairs in ingestion attempt history.");
    repairedGenerations.set(data.runId, data.toGeneration);
  }
  // Persisted lineage-repair operations are the existing owner confirmation
  // contract; retain its semantics instead of inventing a new repair signal.
  const correctedAudits = applyLineageRepairs(audits, repairs);
  const correctedById = new Map(
    correctedAudits.map((audit) => [audit.id, audit]),
  );
  const latestAudit = correctedAudits
    .slice()
    .sort(
      (a, b) =>
        b.data.generation - a.data.generation ||
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) ||
        b.id.localeCompare(a.id),
    )[0];

  const attempts = records.filter(
    (record) =>
      record.kind === "operations" &&
      record.data?.type === "ingestion-attempt" &&
      (record.packageId === courseId || record.data.courseId === courseId),
  );
  for (const attempt of attempts) {
    unique(attempt);
    validateAttemptRecord(attempt);
  }
  attempts.sort(
    (a, b) => a.data.generation - b.data.generation || a.id.localeCompare(b.id),
  );
  let previousAttempt: WorkspaceRecord | undefined;
  for (const attempt of attempts) {
    const data = attempt.data as IngestionAttemptData;
    const baseAudit = correctedById.get(data.baseAuditId);
    if (
      !baseAudit ||
      data.previousAttemptId !== (previousAttempt?.id || "") ||
      data.generation <= (previousAttempt?.data.generation ?? 0) ||
      Math.max(
        baseAudit.data.generation,
        previousAttempt?.data.generation ?? 0,
      ) !== data.previousGeneration
    )
      throw Error(
        "Conflicting ingestion attempt history: receipt baseline or previous declaration does not match known corrected history.",
      );
    // Dependency identities and generations establish the recorded chain.
    // Client declaration clocks and mutable restore timestamps do not prove
    // causal order between this receipt and other saved reports.
    previousAttempt = attempt;
  }
  return {
    generation: Math.max(
      latestAudit?.data.generation ?? 0,
      previousAttempt?.data.generation ?? 0,
    ),
    hasHistory: !!latestAudit || !!previousAttempt,
    latestAuditId: latestAudit?.id || "",
    latestAttemptId: previousAttempt?.id || "",
  };
}

export function createIngestionAttemptRecord(
  course: WorkspaceRecord,
  records: WorkspaceRecord[],
  actor: string,
  now: string,
): WorkspaceRecord {
  if (course.kind !== "package" || !validId(course.id))
    throw Error(
      "An ingestion attempt must belong to an existing source course.",
    );
  const current = currentIngestionAttempt(course.id, records);
  if (!current.hasHistory)
    throw Error(
      "Save the first course comparison at ingestion attempt 0 before declaring another completed ingestion.",
    );
  if (current.generation === 99)
    throw Error(
      "Ingestion attempt 99 is the supported limit; another completed ingestion cannot be recorded.",
    );
  const data: IngestionAttemptData = {
    type: "ingestion-attempt",
    schemaVersion: 1,
    courseId: course.id,
    generation: current.generation + 1,
    previousGeneration: current.generation,
    baseAuditId: current.latestAuditId,
    previousAttemptId: current.latestAttemptId,
    declaredAt: now,
    declaredBy: actor,
    scope: "OWNER_DECLARED_EXTERNAL_INGESTION",
  };
  validateIngestionAttemptData(data);
  return {
    id: ingestionAttemptRecordId(course.id, data.generation),
    kind: "operations",
    title: `Ingestion attempt ${data.generation} · ${course.title}`.slice(
      0,
      500,
    ),
    packageId: course.id,
    version: 0,
    updatedAt: "",
    updatedBy: "",
    data,
  };
}

export function validateIngestionAttemptReferences(
  record: WorkspaceRecord,
  records: WorkspaceRecord[],
): void {
  const data = validateAttemptRecord(record);
  const existing = records.find((row) => row.id === record.id);
  if (existing) {
    const saved = validateAttemptRecord(existing);
    if (
      Object.keys(data).some(
        (key) =>
          data[key as keyof IngestionAttemptData] !==
          saved[key as keyof IngestionAttemptData],
      )
    )
      throw Error(
        "A different ingestion declaration already occupies this course attempt. Reload the saved history.",
      );
  }
  if (
    !records.some(
      (course) => course.id === data.courseId && course.kind === "package",
    )
  )
    throw Error("Ingestion attempt source course was not found.");
  const current = currentIngestionAttempt(
    data.courseId,
    records.filter((row) => row.id !== record.id),
  );
  if (
    !current.hasHistory ||
    data.generation !== current.generation + 1 ||
    data.previousGeneration !== current.generation ||
    data.baseAuditId !== current.latestAuditId ||
    data.previousAttemptId !== current.latestAttemptId
  )
    throw Error(
      "Ingestion attempt history changed or the declaration is stale. Review the current course history and declare the next completed ingestion again.",
    );
}
