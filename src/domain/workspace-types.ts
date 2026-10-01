import type { PackageScan } from "./package-types.ts";
import type { BookData } from "../adapters/workbook.ts";
// The retained QA engine has a large versioned JSON contract. Keep its complete
// payload at this boundary; never reduce it to the fields used by a UI card.
export type EvidenceObject = Record<string, any>;
export type RecordKind =
  | "package"
  | "audit"
  | "workbook"
  | "checklist"
  | "item-review"
  | "legacy-backup"
  | "operations";
export interface WorkspaceRecord {
  id: string;
  kind: RecordKind;
  title: string;
  packageId: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  data: EvidenceObject;
}
export interface CourseData {
  scan: PackageScan;
  partner: string;
  owner: string;
  status: string;
  assignedDate: string;
  deadline: string;
  driveLink: string;
}
export interface ComparisonInput {
  course: WorkspaceRecord;
  excel: { name: string; bytes: Uint8Array };
  json?: { name: string; bytes: Uint8Array };
  brightspace?: { name: string; bytes: Uint8Array };
  recovery?: { name: string; bytes: Uint8Array };
  mode: "raw" | "ops" | "published" | "auto";
  generation: number;
  history: WorkspaceRecord[];
  ingestionCapabilityStatus?:
    | "UNKNOWN"
    | "LATEST_APPLIED"
    | "LEGACY_OR_OUTDATED";
}
export interface ComparisonOutput {
  ownerContext?: EvidenceObject;
  ingestionCapabilityStatus: string;
  result: EvidenceObject;
  report: string;
  hashes: Record<string, string>;
  generation: number;
  packageId: string;
  sourceScanSha256: string;
}
export type WorkflowJob =
  | { kind: "compare"; input: ComparisonInput }
  | { kind: "macmillan-scan"; bytes: Uint8Array; name: string }
  | {
      kind: "macmillan-split";
      book: BookData;
      anchors: number[];
      names: string[];
      approved: string[] | null;
      partner: string;
    }
  | {
      kind: "macmillan-qa";
      book: BookData;
      bytes: Uint8Array;
      name: string;
      stage: string;
      spec: number;
    }
  | { kind: "analytics"; records: WorkspaceRecord[] }
  | { kind: "lifecycle"; before: WorkspaceRecord; after: WorkspaceRecord };
