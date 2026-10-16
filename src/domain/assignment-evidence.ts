import type { PackageScan } from "./package-types.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";
import type { evaluateAssignment } from "./assignment-plan.ts";
import { courseraContentObservedAt } from "./coursera-observation-time.ts";

export function sourceBaseline(scan?: Partial<PackageScan> | null) {
  if (!scan) return { status: "missing", label: "IMSCC not scanned" } as const;
  if (scan.sourceEvidence?.kind === "CTI_SOURCE_DOCUMENT_BASELINE")
    return { status: "document", label: "Source document saved — text-only scope" } as const;
  if (scan.sourceEvidence?.manifestOnly)
    return {
      status: "manifest",
      label: "Manifest only — inspect the full IMSCC",
    } as const;
  if (!scan.fileSha256)
    return {
      status: "historical",
      label: "Historical scan — original file identity not recorded",
    } as const;
  return { status: "scanned", label: "IMSCC scan saved" } as const;
}

export function sourceIdentityMessage(sourceHash?: string, auditHash?: string) {
  if (!sourceHash)
    return "The saved source has no original file identity. Rescan the original IMSCC, then compare again. This does not prove the package changed.";
  if (!auditHash)
    return "This report has no source file identity. Compare again against the saved IMSCC to establish the match.";
  return "The source package differs from this audit. Compare against the current source.";
}

/** Structure can come from an independent workbook or a separately verified
 * retained native material inventory. Neither certifies complete content. */
export function hasVerifiedComparisonStructure(audit: WorkspaceRecord | null) {
  const result = audit?.data.result;
  if (result?.inputCoherence?.status === "PASS") return true;
  const proof = result?.structuralInventoryBasis;
  return result?.inputCoherence?.status === "VERIFIED_CAPTURE_INVENTORY" &&
    proof?.kind === "VERIFIED_NATIVE_CAPTURE_INVENTORY" && proof.independentWorkbook === false &&
    proof.completeContent === false && /^[a-f0-9]{64}$/.test(proof.materialHash || "") &&
    /^[a-f0-9]{64}$/.test(audit?.data.hashes?.json || "") &&
    /^[a-f0-9]{64}$/.test(audit?.data.hashes?.derivedStructure || "") &&
    !audit?.data.hashes?.excel && proof.courseId === result?.stats?.extractorMeta?.page?.courseId;
}

/** An external application receipt is a declared change, never verification. */
export function externalApplicationNeedsCapture(courseId: string, audit: WorkspaceRecord | null, records: WorkspaceRecord[]) {
  const changes = records.filter(r => r.kind === "operations" && r.packageId === courseId &&
    r.data.type === "assignment-deliverable" && r.data.event === "external-application-recorded");
  if (!changes.length) return false;
  const latest = Math.max(...changes.map(r => Date.parse(r.updatedAt || r.data.createdAt || "")));
  const capturedAt = Date.parse(courseraContentObservedAt(audit));
  return !Number.isFinite(latest) || !Number.isFinite(capturedAt) || capturedAt <= latest;
}

export interface PendingAssignmentEvidence {
  source: string;
  coursera: string;
  excel: string;
  changed: boolean;
  courseraChanged: boolean;
}
export type AssignmentAction =
  | "scan"
  | "source"
  | "coursera"
  | "compare"
  | "worklist"
  | "review"
  | "deliverable";
export function nextAssignmentStep(
  course: WorkspaceRecord,
  audit: WorkspaceRecord | null,
  e: ReturnType<typeof evaluateAssignment>,
  pending: PendingAssignmentEvidence,
): { action: AssignmentAction; title: string; detail: string; button: string } {
  if (!["scanned", "document"].includes(sourceBaseline(course.data.scan).status))
    return {
      action: "scan",
      title: "Inspect the original IMSCC",
      detail:
        "Save a full package scan before relying on the source comparison. Opening saved evidence does not run a new scan.",
      button: "Scan original IMSCC",
    };
  if (!e.reconciled && !pending.source && !audit?.data.hashes?.brightspace && sourceBaseline(course.data.scan).status !== "document")
    return {
      action: "source",
      title: "Capture the matching Brightspace course",
      detail:
        "Add the live source before making Coursera corrections. If access is unavailable, you can compare the evidence you have and document the remaining source checks.",
      button: "Capture Brightspace source",
    };
  if (!audit?.data.hashes?.json && !pending.coursera)
    return {
      action: "coursera",
      title: "Capture the Coursera shell",
      detail:
        "Import the IMSCC if a shell does not exist. Otherwise use the existing shell. Capture it and export its XLSX before manual corrections.",
      button: "Extract Coursera shell",
    };
  if (e.applicationNeedsCapture)
    return { action: "coursera", title: "Verify the externally changed shell",
      detail: "An external application is recorded. Capture the changed shell and compare it before reusing reconciliation or approval.",
      button: "Capture changed Coursera shell" };
  const capturedAt = courseraContentObservedAt(audit);
  if (
    e.plan.shellChangedAt &&
    (!capturedAt ||
      !Number.isFinite(Date.parse(capturedAt)) ||
      Date.parse(capturedAt) <= Date.parse(e.plan.shellChangedAt)) &&
    !pending.courseraChanged
  )
    return {
      action: "coursera",
      title: "Verify the corrected shell",
      detail:
        "The saved capture predates the declared shell change or has no capture date. Capture the edited shell and export a matching XLSX, then compare again.",
      button: "Capture corrected Coursera shell",
    };
  if (
    pending.changed ||
    !audit ||
    audit.data.sourceScanSha256 !== course.data.scan?.fileSha256 ||
    !audit.data.hashes?.json ||
    !hasVerifiedComparisonStructure(audit) ||
    audit.data.result?.success !== true ||
    !e.tasks.length
  )
    return {
      action: "compare",
      title: "Run the source-to-Coursera comparison",
      detail:
        "Use the full Coursera capture and available source evidence. Direct captures with verified native inventories can supply structure; older captures require a matching XLSX. Files become comparison evidence only after the report is saved.",
      button: "Prepare and run comparison",
    };
  if (e.attention.length > e.checked.length)
    return {
      action: "worklist",
      title: "Work through the item checklist",
      detail: `${e.attention.length - e.checked.length} flagged items need a correction or documented verification. A flag is not automatically missing content.`,
      button: "Open my correction checklist",
    };
  if (!e.reconciled)
    return {
      action: "review",
      title: "Record the reconciliation review",
      detail:
        "Review the original findings, source checks and learner checks. Record the review only after the listed prerequisites are resolved.",
      button: "Review reconciliation readiness",
    };
  return {
    action: "deliverable",
    title: "Continue to your deliverable",
    detail:
      "Reuse this reconciliation while the evidence is unchanged. Choose the direct course-outline path or content map, approval and specialization outline.",
    button: "Go to deliverable prerequisites",
  };
}
