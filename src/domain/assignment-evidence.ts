import type { PackageScan } from "./package-types.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";
import type { evaluateAssignment } from "./assignment-plan.ts";

export function sourceBaseline(scan?: Partial<PackageScan> | null) {
  if (!scan) return { status: "missing", label: "IMSCC not scanned" } as const;
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
  if (sourceBaseline(course.data.scan).status !== "scanned")
    return {
      action: "scan",
      title: "Inspect the original IMSCC",
      detail:
        "Save a full package scan before relying on the source comparison. Opening saved evidence does not run a new scan.",
      button: "Scan original IMSCC",
    };
  if (!e.reconciled && !pending.source && !audit?.data.hashes?.brightspace)
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
  const capturedAt = audit?.data.result?.stats?.extractorMeta?.capturedAt;
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
    audit.data.result?.inputCoherence?.status !== "PASS" ||
    audit.data.result?.success !== true ||
    !e.tasks.length
  )
    return {
      action: "compare",
      title: "Run the source-to-Coursera comparison",
      detail:
        "Use the matching Coursera XLSX and full JSON, plus Brightspace JSON when available. Selected files are not saved comparison evidence until the report is successfully saved.",
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
