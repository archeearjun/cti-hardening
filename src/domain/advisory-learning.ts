import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { WorkspaceRecord } from "./workspace-types.ts";

/** Advisory scores rank candidates only. They never establish identity or fidelity. */
export const ADVISORY_VERSION = "cti-local-logistic-v1";
export const ADVISORY_FEATURES = [
  "titleTokens",
  "pathTokens",
  "titleExact",
  "typeExact",
  "hashExact",
  "titlePairPresent",
  "pathPairPresent",
  "typePairPresent",
  "hashPairPresent",
] as const;
export const MAX_ADVISORY_EXAMPLES = 2000;
export interface AdvisoryCandidate {
  courseId: string;
  sourceId: string;
  targetId: string;
  sourceTitle?: string;
  targetTitle?: string;
  sourcePath?: string;
  targetPath?: string;
  sourceType?: string;
  targetType?: string;
  sourceHash?: string;
  targetHash?: string;
  pairKind?: "coursera-payload" | "brightspace-topic" | "owner-supplied";
  basis?: { auditId: string; auditVersion: number; inputFingerprint: string };
  courseGroupId?: string;
}
export interface ReviewedMappingExample {
  courseId: string;
  sourceId: string;
  targetId: string;
  sourceHash: string;
  targetHash: string;
  features: number[];
  decision: "approved" | "rejected";
  reviewerId: string;
  reviewedAt: string;
  pairKind: "coursera-payload" | "brightspace-topic" | "owner-supplied";
  basis: {
    auditId: string;
    auditVersion: number;
    inputFingerprint: string;
  } | null;
}
export interface AdvisoryDataset {
  schemaVersion: 1;
  examples: ReviewedMappingExample[];
}
export interface AdvisoryEvaluation {
  method: "course-grouped-holdout";
  trainingCourses: string[];
  heldOutCourses: string[];
  trainingExamples: number;
  heldOutExamples: number;
  trainingPositive: number;
  heldOutPositive: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  accuracy: number;
  precision: number | null;
  recall: number;
  brierScore: number;
}
export type AdvisoryModel =
  | {
      version: typeof ADVISORY_VERSION;
      datasetFingerprint: string;
      featureNames: typeof ADVISORY_FEATURES;
      confidence: "uncalibrated-ranking-score";
      status: "insufficient-data";
      reason: string;
    }
  | {
      version: typeof ADVISORY_VERSION;
      datasetFingerprint: string;
      featureNames: typeof ADVISORY_FEATURES;
      confidence: "uncalibrated-ranking-score";
      status: "available";
      coefficients: number[];
      evaluation: AdvisoryEvaluation;
    };
export interface AdvisoryRecordData {
  type: "advisory-model";
  schemaVersion: 1;
  courseId: string;
  createdAt: string;
  datasetFingerprint: string;
  modelStatus: AdvisoryModel["status"];
  exampleCount: number;
  dataset: AdvisoryDataset;
  model: AdvisoryModel;
}
const digest = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected an advisory object.");
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw Error(
      "Advisory data contains unsupported fields. Retain features and IDs, never source bodies.",
    );
}
function id(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 240 ||
    /[\x00-\x1f]/.test(value)
  )
    throw Error(`Invalid advisory ${label}.`);
  return value.trim();
}
function hash(value: unknown): string {
  if (value === "" || value == null) return "";
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw Error("Source bindings must use SHA-256 or an empty string.");
  return value;
}
function iso(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error("Add a valid reviewed/created ISO timestamp.");
  return value;
}
const normalized = (value?: string) =>
  String(value || "")
    .slice(0, 4000)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function overlap(a: string, b: string) {
  if (!a || !b) return 0;
  const left = new Set(a.split(" ")),
    right = new Set(b.split(" "));
  return (
    [...left].filter((token) => right.has(token)).length /
    new Set([...left, ...right]).size
  );
}
export function advisoryFeatures(candidate: AdvisoryCandidate): number[] {
  const a = normalized(candidate.sourceTitle),
    b = normalized(candidate.targetTitle);
  const c = normalized(candidate.sourcePath),
    d = normalized(candidate.targetPath);
  const e = normalized(candidate.sourceType),
    f = normalized(candidate.targetType);
  const h = hash(candidate.sourceHash),
    j = hash(candidate.targetHash);
  return [
    overlap(a, b),
    overlap(c, d),
    Number(!!a && a === b),
    Number(!!e && e === f),
    Number(!!h && h === j),
    Number(!!a && !!b),
    Number(!!c && !!d),
    Number(!!e && !!f),
    Number(!!h && !!j),
  ];
}
/** Call only after an explicit owner mapping decision. Text is discarded here. */
export function reviewedMappingExample(
  candidate: AdvisoryCandidate,
  decision: ReviewedMappingExample["decision"],
  reviewerId: string,
  reviewedAt: string,
): ReviewedMappingExample {
  return normalizeAdvisoryDataset({
    schemaVersion: 1,
    examples: [
      {
        courseId: candidate.courseGroupId || candidate.courseId,
        sourceId: candidate.sourceId,
        targetId: candidate.targetId,
        sourceHash: hash(candidate.sourceHash),
        targetHash: hash(candidate.targetHash),
        features: advisoryFeatures(candidate),
        decision,
        reviewerId,
        reviewedAt,
        pairKind: candidate.pairKind || "owner-supplied",
        basis: candidate.basis || null,
      },
    ],
  }).examples[0];
}
export function normalizeAdvisoryDataset(value: unknown): AdvisoryDataset {
  const data = object(value);
  keys(data, ["schemaVersion", "examples"]);
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.examples) ||
    data.examples.length > MAX_ADVISORY_EXAMPLES
  )
    throw Error(
      `Use advisory schemaVersion 1 with at most ${MAX_ADVISORY_EXAMPLES} explicitly reviewed examples.`,
    );
  const seen = new Set<string>();
  const examples = data.examples.map((input) => {
    const row = object(input);
    keys(row, [
      "courseId",
      "sourceId",
      "targetId",
      "sourceHash",
      "targetHash",
      "features",
      "decision",
      "reviewerId",
      "reviewedAt",
      "pairKind",
      "basis",
    ]);
    if (
      !Array.isArray(row.features) ||
      row.features.length !== ADVISORY_FEATURES.length ||
      row.features.some(
        (n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1,
      )
    )
      throw Error(
        "Advisory features must be nine finite numbers between zero and one.",
      );
    const f = row.features as number[];
    if (
      f.slice(2).some((n) => n !== 0 && n !== 1) ||
      f[2] > f[5] ||
      f[3] > f[7] ||
      f[0] > f[5] ||
      f[1] > f[6] ||
      (f[2] === 1 && f[0] !== 1)
    )
      throw Error(
        "Advisory exact/presence features must be binary and internally consistent.",
      );
    if (!["approved", "rejected"].includes(String(row.decision)))
      throw Error(
        "Every example needs an explicit approved or rejected owner decision.",
      );
    const pairKind = row.pairKind || "owner-supplied";
    if (
      !["coursera-payload", "brightspace-topic", "owner-supplied"].includes(
        String(pairKind),
      )
    )
      throw Error("Invalid advisory pair kind.");
    let basis: ReviewedMappingExample["basis"] = null;
    if (row.basis != null) {
      const b = object(row.basis);
      keys(b, ["auditId", "auditVersion", "inputFingerprint"]);
      if (
        !Number.isSafeInteger(b.auditVersion) ||
        Number(b.auditVersion) < 1 ||
        !hash(b.inputFingerprint)
      )
        throw Error("Invalid advisory audit basis.");
      basis = {
        auditId: id(b.auditId, "audit ID"),
        auditVersion: Number(b.auditVersion),
        inputFingerprint: hash(b.inputFingerprint),
      };
    }
    if (pairKind !== "owner-supplied" && !basis)
      throw Error("An in-workspace mapping label needs its audit basis.");
    const result: ReviewedMappingExample = {
      courseId: id(row.courseId, "course ID"),
      sourceId: id(row.sourceId, "source ID"),
      targetId: id(row.targetId, "target ID"),
      sourceHash: hash(row.sourceHash),
      targetHash: hash(row.targetHash),
      features: [...row.features] as number[],
      decision: row.decision as ReviewedMappingExample["decision"],
      reviewerId: id(row.reviewerId, "reviewer ID"),
      reviewedAt: iso(row.reviewedAt),
      pairKind: pairKind as ReviewedMappingExample["pairKind"],
      basis,
    };
    // Repeated reviews must not inflate either training or held-out scores.
    const key = JSON.stringify([
      result.courseId,
      result.pairKind,
      result.sourceId,
      result.targetId,
    ]);
    if (seen.has(key))
      throw Error(
        "A source/destination pair may appear only once per course in a reviewed dataset.",
      );
    seen.add(key);
    // Equal hashes require both native hashes; an unbound equality feature is invalid.
    if (
      result.features[4] !==
        Number(
          !!result.sourceHash && result.sourceHash === result.targetHash,
        ) ||
      result.features[8] !== Number(!!result.sourceHash && !!result.targetHash)
    )
      throw Error("Hash features disagree with the retained source bindings.");
    return result;
  });
  examples.sort((a, b) =>
    JSON.stringify([
      a.courseId,
      a.pairKind,
      a.sourceId,
      a.targetId,
    ]).localeCompare(
      JSON.stringify([b.courseId, b.pairKind, b.sourceId, b.targetId]),
    ),
  );
  return { schemaVersion: 1, examples };
}
export function advisoryDatasetFingerprint(value: unknown): string {
  return digest(normalizeAdvisoryDataset(value));
}
export function mergeAdvisoryDatasets(values: unknown[]): AdvisoryDataset {
  const rows = new Map<string, ReviewedMappingExample>();
  for (const value of values)
    for (const row of normalizeAdvisoryDataset(value).examples) {
      const key = JSON.stringify([
          row.courseId,
          row.pairKind,
          row.sourceId,
          row.targetId,
        ]),
        prior = rows.get(key);
      if (
        prior &&
        Date.parse(row.reviewedAt) === Date.parse(prior.reviewedAt) &&
        digest(row) !== digest(prior)
      )
        throw Error(
          "Conflicting reviews share a timestamp. Record an explicit newer owner decision before training.",
        );
      if (!prior || Date.parse(row.reviewedAt) > Date.parse(prior.reviewedAt))
        rows.set(key, row);
    }
  if (rows.size > MAX_ADVISORY_EXAMPLES)
    throw Error(
      "The combined reviewed dataset exceeds 2,000 pairs. Export a smaller explicitly selected dataset.",
    );
  return normalizeAdvisoryDataset({
    schemaVersion: 1,
    examples: [...rows.values()],
  });
}
/** Ambiguous title candidates are review inputs, never authority to attach bodies. */
export function advisoryCandidatesFromAudit(
  courseId: string,
  audit: WorkspaceRecord | null | undefined,
): AdvisoryCandidate[] {
  if (!audit || audit.kind !== "audit" || audit.packageId !== courseId)
    return [];
  const result = audit.data.result || {},
    basis = {
      auditId: audit.id,
      auditVersion: audit.version,
      inputFingerprint: digest([
        audit.id,
        audit.version,
        audit.data.sourceScanSha256 || "",
        Object.entries(audit.data.hashes || {}).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ]),
    };
  let courseGroupId = courseId;
  try {
    const page = new URL(String(result.stats?.extractorMeta?.page?.url || ""));
    const match = page.pathname.match(
      /^\/teach\/[^/]+\/([A-Za-z0-9_-]+)\/content(?:\/|$)/,
    );
    if (page.hostname === "www.coursera.org" && match)
      courseGroupId = "coursera:" + match[1];
  } catch {
    /* No native course declaration: retain the assignment's stable ID. */
  }
  const candidates: AdvisoryCandidate[] = [];
  const rows = (value: unknown): Record<string, any>[] =>
    Array.isArray(value)
      ? value.filter((row) => row && typeof row === "object")
      : [];
  for (const row of rows(
    result.stats?.extractorMeta?.payloadBindingDiagnostics,
  )) {
    if (row.status !== "REVIEW" || !row.itemId) continue;
    for (const target of rows(row.candidates))
      if (target.id)
        candidates.push({
          courseId,
          sourceId: String(row.itemId),
          targetId: String(target.id),
          sourceTitle: String(row.itemName || ""),
          targetTitle: String(target.name || ""),
          sourcePath: String(row.itemPath || ""),
          targetPath: String(target.path || ""),
          sourceType: String(row.itemType || ""),
          targetType: String(target.type || ""),
          pairKind: "coursera-payload",
          basis,
        });
  }
  for (const row of rows(result.liveSourceGroundTruth?.sourceTopicCandidates)) {
    if (row.status !== "REVIEW" || !row.sourceId) continue;
    for (const target of rows(row.candidates))
      if (target.topicId)
        candidates.push({
          courseId,
          sourceId: String(row.sourceId),
          targetId: String(target.topicId),
          sourceTitle: String(row.sourceName || ""),
          targetTitle: String(target.title || ""),
          sourcePath: String(row.sourcePath || ""),
          targetPath: String(target.path || ""),
          sourceType: String(row.sourceType || ""),
          targetType: String(target.type || ""),
          pairKind: "brightspace-topic",
          basis,
        });
  }
  const unique = new Map<string, AdvisoryCandidate>();
  for (const candidate of candidates.slice(0, 1000))
    unique.set(
      JSON.stringify([
        candidate.pairKind,
        candidate.sourceId,
        candidate.targetId,
      ]),
      candidate,
    );
  return [...unique.values()]
    .slice(0, 100)
    .map((candidate) => ({ ...candidate, courseGroupId }));
}
/** Workspace labels are recomputed from their retained diagnostic pair. An
 * owner declaration may train a model, but cannot impersonate this receipt. */
export function validateAdvisoryAuditExample(
  example: ReviewedMappingExample,
  audit: WorkspaceRecord | null | undefined,
): void {
  if (example.pairKind === "owner-supplied") return;
  if (
    !audit ||
    !example.basis ||
    audit.id !== example.basis.auditId ||
    audit.version !== example.basis.auditVersion
  )
    throw Error(
      "The reviewed mapping audit changed or is unavailable. Review the current native candidate again.",
    );
  const candidate = advisoryCandidatesFromAudit(audit.packageId, audit).find(
    (pair) =>
      pair.pairKind === example.pairKind &&
      pair.sourceId === example.sourceId &&
      pair.targetId === example.targetId,
  );
  if (
    !candidate ||
    digest(
      reviewedMappingExample(
        candidate,
        example.decision,
        example.reviewerId,
        example.reviewedAt,
      ),
    ) !== digest(example)
  )
    throw Error(
      "The reviewed mapping label does not reproduce its retained audit candidate and feature basis.",
    );
}
const positive = (row: ReviewedMappingExample) =>
  Number(row.decision === "approved");
const logistic = (n: number) =>
  1 / (1 + Math.exp(-Math.max(-30, Math.min(30, n))));
function score(coefficients: number[], features: number[]) {
  return logistic(
    coefficients[0] +
      features.reduce(
        (sum, value, index) => sum + value * coefficients[index + 1],
        0,
      ),
  );
}
function fit(rows: ReviewedMappingExample[]): number[] {
  const weights = Array.from({ length: ADVISORY_FEATURES.length + 1 }, () => 0);
  for (let pass = 0; pass < 350; pass++) {
    const gradients = weights.map(() => 0);
    for (const row of rows) {
      const error = score(weights, row.features) - positive(row);
      gradients[0] += error;
      row.features.forEach((value, i) => {
        gradients[i + 1] += error * value;
      });
    }
    weights.forEach((weight, i) => {
      weights[i] -=
        0.25 * (gradients[i] / rows.length + (i ? 0.02 * weight : 0));
    });
  }
  // Quantization makes the persisted model independent of insignificant
  // Math.exp rounding differences between browser and service V8 builds.
  return weights.map((value) => Number(value.toFixed(8)));
}
export function trainAdvisoryModel(value: unknown): AdvisoryModel {
  const dataset = normalizeAdvisoryDataset(value),
    rows = dataset.examples;
  const base = {
    version: ADVISORY_VERSION as typeof ADVISORY_VERSION,
    datasetFingerprint: digest(dataset),
    featureNames: ADVISORY_FEATURES,
    confidence: "uncalibrated-ranking-score" as const,
  };
  const insufficient = (reason: string): AdvisoryModel => ({
    ...base,
    status: "insufficient-data",
    reason,
  });
  const courses = [...new Set(rows.map((row) => row.courseId))].sort((a, b) =>
    digest(a).localeCompare(digest(b)),
  );
  const positives = rows.reduce((sum, row) => sum + positive(row), 0);
  if (
    rows.length < 40 ||
    positives < 12 ||
    rows.length - positives < 12 ||
    courses.length < 4
  )
    return insufficient(
      "Need at least 40 explicit reviews, 12 approved, 12 rejected, and four distinct native courses. Repeated captures of one course are not independent courses.",
    );
  const heldOutCourses = courses.slice(
      0,
      Math.max(1, Math.floor(courses.length / 4)),
    ),
    trainingCourses = courses.filter((c) => !heldOutCourses.includes(c));
  const heldOut = rows.filter((row) => heldOutCourses.includes(row.courseId)),
    training = rows.filter((row) => !heldOutCourses.includes(row.courseId));
  const trainPositive = training.reduce((n, row) => n + positive(row), 0),
    testPositive = heldOut.reduce((n, row) => n + positive(row), 0);
  if (
    training.length < 24 ||
    trainPositive < 8 ||
    training.length - trainPositive < 8 ||
    heldOut.length < 8 ||
    testPositive < 2 ||
    heldOut.length - testPositive < 2
  )
    return insufficient(
      "The deterministic course holdout needs at least 24 training reviews (eight of each decision) and eight held-out reviews (two of each). Add balanced reviewed courses; do not move examples across courses.",
    );
  const coefficients = fit(training);
  let truePositive = 0,
    falsePositive = 0,
    trueNegative = 0,
    falseNegative = 0,
    brier = 0;
  for (const row of heldOut) {
    const prediction = score(coefficients, row.features),
      expected = positive(row);
    brier += (prediction - expected) ** 2;
    if (prediction >= 0.5 && expected) truePositive++;
    else if (prediction >= 0.5) falsePositive++;
    else if (expected) falseNegative++;
    else trueNegative++;
  }
  return {
    ...base,
    status: "available",
    coefficients,
    evaluation: {
      method: "course-grouped-holdout",
      trainingCourses,
      heldOutCourses,
      trainingExamples: training.length,
      heldOutExamples: heldOut.length,
      trainingPositive: trainPositive,
      heldOutPositive: testPositive,
      truePositive,
      falsePositive,
      trueNegative,
      falseNegative,
      accuracy: Number(
        ((truePositive + trueNegative) / heldOut.length).toFixed(8),
      ),
      precision:
        truePositive + falsePositive
          ? Number((truePositive / (truePositive + falsePositive)).toFixed(8))
          : null,
      recall: Number((truePositive / testPositive).toFixed(8)),
      brierScore: Number((brier / heldOut.length).toFixed(8)),
    },
  };
}
export function createAdvisoryRecordData(
  courseId: string,
  value: unknown,
  createdAt = new Date().toISOString(),
): AdvisoryRecordData {
  const dataset = normalizeAdvisoryDataset(value),
    model = trainAdvisoryModel(dataset);
  return {
    type: "advisory-model",
    schemaVersion: 1,
    courseId: id(courseId, "course ID"),
    createdAt: iso(createdAt),
    datasetFingerprint: model.datasetFingerprint,
    modelStatus: model.status,
    exampleCount: dataset.examples.length,
    dataset,
    model,
  };
}
export function validateAdvisoryRecordData(value: unknown): AdvisoryRecordData {
  const input = object(value);
  keys(input, [
    "type",
    "schemaVersion",
    "courseId",
    "createdAt",
    "datasetFingerprint",
    "modelStatus",
    "exampleCount",
    "dataset",
    "model",
  ]);
  if (input.type !== "advisory-model" || input.schemaVersion !== 1)
    throw Error("Invalid advisory record version.");
  const normalized = createAdvisoryRecordData(
    String(input.courseId || ""),
    input.dataset,
    String(input.createdAt || ""),
  );
  if (
    JSON.stringify(input.model) !== JSON.stringify(normalized.model) ||
    input.datasetFingerprint !== normalized.datasetFingerprint ||
    input.modelStatus !== normalized.modelStatus ||
    input.exampleCount !== normalized.exampleCount
  )
    throw Error(
      "Advisory model, dataset fingerprint, or evaluation was changed; train and evaluate the reviewed dataset again.",
    );
  return normalized;
}
export function advisorySuggestion(
  model: AdvisoryModel,
  candidate: AdvisoryCandidate,
  currentDatasetFingerprint: string,
) {
  if (model.status !== "available")
    return { status: "unavailable" as const, reason: model.reason };
  if (model.datasetFingerprint !== currentDatasetFingerprint)
    return {
      status: "stale" as const,
      reason: "Reviewed labels changed. Train and evaluate again.",
    };
  return {
    status: "suggestion" as const,
    courseId: candidate.courseId,
    sourceId: candidate.sourceId,
    targetId: candidate.targetId,
    score: score(model.coefficients, advisoryFeatures(candidate)),
    confidence: model.confidence,
    features: advisoryFeatures(candidate),
    automaticApplication: false as const,
  };
}
/** Counts describe recorded work, not verified quality or elapsed owner time. */
export function assignmentWorkMetrics(
  courseId: string,
  records: WorkspaceRecord[],
) {
  const scoped = records.filter((record) => record.packageId === courseId);
  const reviews = scoped.filter((record) => record.kind === "item-review");
  const comparisons = scoped.filter((record) => record.kind === "audit");
  const captures = scoped.filter(
    (record) =>
      record.kind === "operations" && record.data.type === "evidence-input",
  );
  const ledgers = scoped.filter(
    (record) =>
      record.kind === "operations" && record.data.type === "item-lifecycle",
  );
  const eventCount = ledgers.reduce(
    (sum, record) =>
      sum +
      (Array.isArray(record.data.events)
        ? record.data.events.length
        : Number(record.data.eventCount || 0)),
    0,
  );
  const mappingReviews = ledgers.reduce(
    (sum, record) =>
      sum +
      (Array.isArray(record.data.events)
        ? record.data.events.filter((event: any) =>
            ["mapping-confirmed", "mapping-rejected"].includes(event.kind),
          ).length
        : Number(record.data.mappingReviewCount || 0)),
    0,
  );
  return {
    ownerReviewRecords: reviews.length,
    comparisonRecords: comparisons.length,
    evidenceIntakeRecords: captures.length,
    lifecycleEvents: eventCount,
    mappingReviewEvents: mappingReviews,
    ownerReviewsPerComparison: comparisons.length
      ? reviews.length / comparisons.length
      : null,
    elapsedOwnerMinutes: null,
    automaticResolutionRate: null,
  };
}
