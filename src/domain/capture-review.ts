import { createEngine } from "../engine/index.js";
import build from "../release.json" with { type: "json" };
import { CTI_RELEASE_REGISTRY_ } from "../engine/release.js";
import { createBrowserServices } from "../adapters/browser-services.ts";
import type {
  ExtractorDelivery,
  Finding,
  ItemEvidence,
  ReviewOptions,
  ReviewResult,
} from "./types.ts";

type RecordValue = Record<string, unknown>;
interface CaptureEngine {
  normalizeCourseraItem_(item: RecordValue): ItemEvidence;
  qaParseSmartIngestionIntelligence_(items: ItemEvidence[]): unknown;
  qaAssessDestinationReadiness_(
    items: ItemEvidence[],
    intelligence: unknown,
    meta: RecordValue,
    snapshot: { mode: string },
    resolution: null,
    partner: string,
  ): {
    findings: Finding[];
    criticalCount: number;
    reviewCount: number;
    evidenceGapCount: number;
  };
  qaCaptureTraversalSummary_(
    meta: RecordValue,
  ): NonNullable<ReviewResult["traversal"]>;
  qaAssertNotDiagnosticCapture_(capture: RecordValue): void;
  qaBrightspaceFlattenTopics_(tree: unknown[]): RecordValue[];
  qaNormalizeBrightspaceAssignment_(assignment: RecordValue): RecordValue;
  ctiExtractorDelivery_(platform: string): ExtractorDelivery;
}
const engine = createEngine(
  createBrowserServices(),
) as unknown as CaptureEngine;
export const MAX_CAPTURE_BYTES = 40 * 1024 * 1024;
function object(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function list(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
function questionCount(item: ItemEvidence): number {
  return item.structuredAssessment?.questions?.length ?? 0;
}

export function getExtractor(
  platform: "coursera" | "brightspace",
): ExtractorDelivery {
  const delivery = engine.ctiExtractorDelivery_(platform);
  if (!delivery.success || !delivery.script)
    throw new Error(delivery.error || "Extractor delivery failed.");
  return delivery;
}

export function reviewCapture(
  value: unknown,
  fileName: string,
  options: ReviewOptions,
  progress: (phase: string) => void = () => {},
): ReviewResult {
  const capture = object(value);
  if (!Object.keys(capture).length)
    throw new Error(
      "Select a complete CTI Coursera or Brightspace capture JSON.",
    );
  engine.qaAssertNotDiagnosticCapture_(capture);
  if (capture.kind === "CTI_COURSERA_READING_RECOVERY")
    throw new Error(
      "This is a supplemental reading recovery. Select the original full capture for this preview.",
    );
  const captureMeta = {
    ...object(capture.extractionMeta),
    ...object(capture.meta),
  };
  const brightspace = /brightspace/i.test(
    text(capture.extractor || captureMeta.extractor),
  );
  const platform = brightspace ? "BRIGHTSPACE" : "COURSERA";
  const page = object(capture.page),
    course = object(capture.course);
  const result: ReviewResult = {
    kind: "CTI_CAPTURE_REVIEW",
    schemaVersion: 1,
    qaBuild: build.qaBuild,
    platform,
    fileName,
    title:
      text(course.title || course.name || page.courseName || page.title) ||
      fileName,
    extractor:
      text(
        capture.extractor ||
          captureMeta.extractor ||
          capture.buildId ||
          captureMeta.buildId,
      ) || "Not recorded",
    capturedAt: text(capture.capturedAt || capture.extractedAt),
    capturedSchema: text(capture.schemaVersion),
    processedAt: new Date().toISOString(),
    options: { ...options },
    scope:
      "Capture inspection only. Source-package fidelity, XLSX-authoritative structure, shared history and publication approval are not evaluated by this migration preview.",
    warnings: [],
    counts: { items: 0, questionDefinitions: 0, assets: 0, links: 0 },
    traversal: null,
    findings: [],
    findingCounts: { critical: 0, review: 0, evidence: 0, informational: 0 },
    items: [],
  };
  if (brightspace) {
    if (![1, 2].includes(Number(capture.schemaVersion)))
      throw new Error("Supported Brightspace captures use schema 1 or 2.");
    if (!Array.isArray(capture.contentTree))
      throw new Error("The Brightspace capture has no contentTree array.");
    progress("Reading Brightspace evidence");
    const topics = engine.qaBrightspaceFlattenTopics_(capture.contentTree);
    const quizzes = list(capture.quizzes),
      assignments = list(capture.assignments).map((a) =>
        engine.qaNormalizeBrightspaceAssignment_(a),
      );
    result.counts.items = topics.length;
    result.counts.questionDefinitions = quizzes.reduce(
      (n, q) => n + count(q.questions),
      0,
    );
    result.items = topics.map((t) => ({
      id: text(t.id),
      name: text(t.title || t.name),
      type:
        text(t.activityTypeLabel || t.contentType || t.topicType) || "Topic",
      path: text(t.path),
      textLength: text(object(t.contentEvidence).text).length,
      questionDefinitions: null,
      assets: null,
      links: (t.url ? 1 : 0) + count(object(t.contentEvidence).links),
    }));
    result.counts.assets = null;
    result.counts.links = result.items.reduce((n, i) => n + i.links, 0);
    result.warnings.push(
      "This preview inventories Brightspace topics and quiz definitions. It does not evaluate Brightspace attachment evidence or assignment/discussion content.",
    );
    result.warnings.push(
      "Topic and quiz-definition counts are separate inventories; question-bank size does not establish learner exam length.",
    );
    result.warnings.push(
      `Assignment definitions: ${assignments.length}. Discussion forums: ${count(capture.discussions)}. These are separate from the topic inventory.`,
    );
    for (const warning of Array.isArray(capture.captureWarnings)
      ? capture.captureWarnings
      : [])
      result.warnings.push(
        typeof warning === "string" ? warning : JSON.stringify(warning),
      );
    const gaps = quizzes.filter(
      (q) => object(q.questionCoverage).completenessVerified !== true,
    );
    for (const q of gaps)
      result.findings.push({
        code: "QUIZ_DEFINITION_COVERAGE_UNVERIFIED",
        severity: "EVIDENCE",
        itemName: text(q.name || q.title),
        itemId: text(q.id),
        path: text(q.path),
        detail:
          "This capture does not verify complete question-definition coverage.",
        action:
          "Inspect this quiz’s questionCoverage and questionPageEvidence in the original capture before concluding that source questions are absent.",
      });
  } else {
    if (!Array.isArray(capture.fingerprints))
      throw new Error(
        "This preview accepts full Coursera fingerprint captures or Brightspace ground-truth captures.",
      );
    if (
      capture.fingerprints.some(
        (i) => !i || typeof i !== "object" || Array.isArray(i),
      )
    )
      throw new Error(
        "This capture contains an invalid fingerprint item. Select the original unmodified capture.",
      );
    if (
      !Number.isInteger(Number(capture.schemaVersion)) ||
      Number(capture.schemaVersion) < 1 ||
      Number(capture.schemaVersion) > CTI_RELEASE_REGISTRY_.courseraExtractor.schema
    )
      throw new Error(
        "This preview supports Coursera capture schemas 1–" +
          CTI_RELEASE_REGISTRY_.courseraExtractor.schema +
          ". Use a compatible full CTI capture.",
      );
    if (capture.fingerprints.length > 20000)
      throw new Error(
        "This capture exceeds the preview limit of 20,000 fingerprint items.",
      );
    progress("Normalizing captured items");
    const items = list(capture.fingerprints).map((i) =>
      engine.normalizeCourseraItem_(i),
    );
    const meta = {
      ...captureMeta,
      schemaVersion: capture.schemaVersion,
      buildId: capture.buildId || captureMeta.buildId,
      extractor: capture.extractor || captureMeta.extractor,
      capturedAt: capture.capturedAt || capture.extractedAt,
    };
    progress("Evaluating captured readiness evidence");
    const intel = engine.qaParseSmartIngestionIntelligence_(items);
    const readiness = engine.qaAssessDestinationReadiness_(
      items,
      intel,
      meta,
      { mode: options.mode },
      null,
      options.partner,
    );
    result.findings = readiness.findings;
    result.traversal = engine.qaCaptureTraversalSummary_(meta);
    result.counts = {
      items: items.length,
      questionDefinitions: items.reduce((n, i) => n + questionCount(i), 0),
      assets: items.reduce((n, i) => n + count(i.assetDetails), 0),
      links: items.reduce((n, i) => n + count(i.links), 0),
    };
    result.items = items.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      path: i.path,
      textLength: i.textSample.length,
      questionDefinitions: questionCount(i),
      assets: count(i.assetDetails),
      links: count(i.links),
    }));
    result.warnings.push(
      "Item titles and paths come from the capture. The Coursera XLSX remains the structural authority in the full CTI workflow.",
    );
    if (!items.length)
      result.warnings.push(
        "No fingerprint items were captured. An empty inventory is not evidence of a complete or empty course.",
      );
    const completeFindings =
      readiness.criticalCount +
      readiness.reviewCount +
      readiness.evidenceGapCount;
    if (
      completeFindings >
      readiness.findings.filter((f) => f.severity !== "INFO").length
    )
      result.warnings.push(
        "The compatibility engine limits displayed finding details. Use the existing full CTI report for the complete workflow.",
      );
  }
  result.findingCounts = {
    critical: result.findings.filter((f) => f.severity === "CRITICAL").length,
    review: result.findings.filter((f) => f.severity === "REVIEW").length,
    evidence: result.findings.filter((f) => f.severity === "EVIDENCE").length,
    informational: result.findings.filter((f) => f.severity === "INFO").length,
  };
  progress("Capture review complete");
  return result;
}
