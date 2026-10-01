export type Platform = "COURSERA" | "BRIGHTSPACE";
export type Severity = "CRITICAL" | "REVIEW" | "EVIDENCE" | "INFO";
export type SnapshotMode = "RAW_INGESTION" | "OPS_CURRENT";
export interface ReviewOptions {
  partner: "NAIT" | "";
  mode: SnapshotMode;
}
export interface Finding {
  code: string;
  severity: Severity;
  itemName: string;
  path: string;
  detail: string;
  action: string;
  itemId?: string;
  policyExempt?: boolean;
}
export interface ItemEvidence {
  id: string;
  name: string;
  type: string;
  path: string;
  textSample: string;
  assetDetails: unknown[];
  links: unknown[];
  textEvidenceCompleteness?: number;
  structuredAssessment?: { questions?: unknown[]; questionCount?: number };
}
export interface ReviewResult {
  kind: "CTI_CAPTURE_REVIEW";
  schemaVersion: 1;
  qaBuild: string;
  platform: Platform;
  fileName: string;
  title: string;
  extractor: string;
  capturedAt: string;
  capturedSchema: string;
  processedAt: string;
  options: ReviewOptions;
  scope: string;
  warnings: string[];
  counts: {
    items: number;
    questionDefinitions: number;
    assets: number | null;
    links: number;
  };
  traversal: {
    recorded: boolean;
    visited: number;
    eligible: number;
    unresolvedCount: number;
  } | null;
  findings: Finding[];
  findingCounts: {
    critical: number;
    review: number;
    evidence: number;
    informational: number;
  };
  items: Array<{
    id: string;
    name: string;
    type: string;
    path: string;
    textLength: number;
    questionDefinitions: number | null;
    assets: number | null;
    links: number;
  }>;
}
export interface ExtractorDelivery {
  success: boolean;
  platform: Platform;
  version: string;
  schemaVersion: number;
  buildId: string;
  delivery?: string;
  script: string;
  error?: string;
}
export type WorkerRequest =
  | { id: number; kind: "review"; file: File; options: ReviewOptions }
  | { id: number; kind: "extractor"; platform: "coursera" | "brightspace" };
export type WorkerResponse =
  | { id: number; kind: "progress"; phase: string }
  | { id: number; kind: "review"; result: ReviewResult }
  | { id: number; kind: "extractor"; result: ExtractorDelivery }
  | { id: number; kind: "error"; message: string };
