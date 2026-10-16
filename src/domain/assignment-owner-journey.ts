import {
  hasVerifiedComparisonStructure,
  nextAssignmentStep,
  sourceBaseline,
  type AssignmentAction,
  type PendingAssignmentEvidence,
} from "./assignment-evidence.ts";
import type { evaluateAssignment } from "./assignment-plan.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

export type OwnerJourneyStage =
  | "understand"
  | "collect"
  | "compare"
  | "fix"
  | "verify"
  | "deliver";
export interface OwnerJourneyStep {
  id: OwnerJourneyStage;
  title: string;
  detail: string;
  status: "recorded" | "limited" | "needed" | "waiting" | "ready";
}
export type OwnerJourneyAction = {
  action: AssignmentAction;
  title: string;
  detail: string;
  button: string;
};

/** A navigation projection, never a new QA verdict or a completeness score.
 * Flags, recorded owner decisions and retained evidence remain separate. */
export function assignmentOwnerJourney(
  course: WorkspaceRecord,
  audit: WorkspaceRecord | null,
  evaluation: ReturnType<typeof evaluateAssignment>,
  pending: PendingAssignmentEvidence,
) {
  const baseline = sourceBaseline(course.data.scan);
  const sourceReady = ["scanned", "document"].includes(baseline.status);
  const hasCoursera = !!audit?.data.hashes?.json;
  const hasStructure = hasVerifiedComparisonStructure(audit);
  const sameSource =
    sourceReady &&
    !!audit &&
    audit.data.sourceScanSha256 === course.data.scan?.fileSha256;
  const comparisonRecorded =
    sameSource &&
    hasCoursera &&
    hasStructure &&
    audit?.data.result?.success === true &&
    evaluation.tasks.length > 0;
  const freshness = evaluation.changeFreshness;
  const lifecycleRecapture = freshness?.needsRecapture === true;
  const legacyRecapture = evaluation.changed.length > 0;
  const capturedAt = Date.parse(
    audit?.data.result?.stats?.extractorMeta?.capturedAt || "",
  );
  const shellCaptureStale =
    !!evaluation.plan.shellChangedAt &&
    (!Number.isFinite(capturedAt) ||
      capturedAt <= Date.parse(evaluation.plan.shellChangedAt));
  const recaptureRequired =
    lifecycleRecapture ||
    legacyRecapture ||
    evaluation.applicationNeedsCapture ||
    shellCaptureStale;
  const historyUnavailable = freshness?.status === "history-unavailable";
  const reviewCurrent =
    evaluation.reconciled &&
    !pending.changed &&
    !historyUnavailable &&
    !recaptureRequired &&
    comparisonRecorded;
  let nextAction: OwnerJourneyAction = nextAssignmentStep(
    course,
    audit,
    evaluation,
    pending,
  );
  if (sourceReady && hasCoursera && recaptureRequired) {
    const platforms = freshness?.pending.map((change) => change.platform) || [];
    const packageRefreshed = !!freshness?.pending.find(
      (change) =>
        change.platform === "source" &&
        course.data.scan?.fileSha256 &&
        course.data.scan.fileSha256 !== change.sourceScanSha256,
    );
    const needsPackage = platforms.includes("source") && !packageRefreshed;
    const needsSource = platforms.includes("brightspace") || needsPackage;
    const needsCoursera =
      legacyRecapture ||
      evaluation.applicationNeedsCapture ||
      shellCaptureStale ||
      platforms.includes("coursera");
    const replacementStaged =
      !needsPackage &&
      (!platforms.includes("brightspace") || !!pending.source) &&
      (!needsCoursera || pending.courseraChanged);
    if (replacementStaged)
      nextAction = {
        action: "compare",
        title: "Check the newly captured evidence",
        detail:
          "Save a new comparison using the staged capture. CTI will check its input identity and capture time against recorded edits; selecting a file alone does not verify a correction.",
        button: "Compare the refreshed evidence",
      };
    else if (needsSource)
      nextAction = {
        action: needsPackage ? "scan" : "source",
        title: "Refresh the edited source evidence",
        detail:
          "An edit to the source is recorded. Capture or rescan that source, then compare it again. A fresh Coursera capture alone cannot verify a Brightspace or package change.",
        button: needsPackage
          ? "Rescan the edited source"
          : "Capture the edited Brightspace source",
      };
    else
      nextAction = {
        action: "coursera",
        title: "Recapture after your Coursera changes",
        detail:
          "Your recorded edits need a capture taken after the change and a new saved comparison. Marking an item checked does not update the captured content.",
        button: "Capture corrected Coursera shell",
      };
  } else if (sourceReady && historyUnavailable) {
    nextAction = {
      action: "review",
      title: "Reload the recorded item history",
      detail:
        freshness.blockers[0] ||
        "Load the full edit history before continuing reconciliation.",
      button: "Review current assignment evidence",
    };
  }
  const currentStage: OwnerJourneyStage =
    recaptureRequired && sourceReady && hasCoursera
      ? "verify"
      : (
          {
            scan: "understand",
            source: "collect",
            coursera: "collect",
            compare: "compare",
            worklist: "fix",
            review: "verify",
            deliverable: "deliver",
          } as const
        )[nextAction.action];
  const unresolvedTasks = Math.max(
    0,
    evaluation.attention.length - evaluation.checked.length,
  );
  const steps: OwnerJourneyStep[] = [
    {
      id: "understand",
      title: "Understand the title",
      status:
        baseline.status === "document"
          ? "limited"
          : sourceReady
            ? "recorded"
            : "needed",
      detail:
        baseline.status === "document"
          ? "Your source document is retained with text-only scope. Headings do not prove native LMS boundaries, media or assessment coverage."
          : sourceReady
            ? "Inspect the retained source hierarchy, readings, activities and assessment references before making manual changes."
            : "Add the source package or an attributed source document to inspect what was provided.",
    },
    {
      id: "collect",
      title: "Collect source and Coursera evidence",
      status: !sourceReady
        ? "waiting"
        : hasCoursera && hasStructure
          ? "recorded"
          : "needed",
      detail: !hasCoursera
        ? "Capture Coursera with the course bookmark and add available source LMS evidence. Destination differences are unknown until a comparison is saved."
        : hasStructure
          ? "Source and destination inputs are recorded. Original content, provider gaps and capture coverage keep their separate status."
          : "Add a matching Coursera XLSX or a direct capture with independently verified native structure. An XLSX alone does not establish content coverage.",
    },
    {
      id: "compare",
      title: "Compare what is actually there",
      status: pending.changed
        ? "needed"
        : comparisonRecorded
          ? "recorded"
          : hasCoursera
            ? "needed"
            : "waiting",
      detail: pending.changed
        ? "New evidence is staged. The saved worklist still reflects the previous comparison."
        : comparisonRecorded
          ? "The saved comparison identifies observed differences and evidence gaps. A flag is a review task, not proof that content is missing."
          : "Run and save the source-to-Coursera comparison before treating a possible difference as a correction task.",
    },
    {
      id: "fix",
      title: "Review flags and fix Coursera",
      status: !comparisonRecorded
        ? "waiting"
        : unresolvedTasks
          ? "needed"
          : "recorded",
      detail: !comparisonRecorded
        ? "The correction checklist appears after the comparison. Source content stays as captured, including empty or broken originals."
        : `${unresolvedTasks} flagged task(s) still need an owner correction or documented verification. Follow original evidence; do not fill unknowns with invented content.`,
    },
    {
      id: "verify",
      title: "Recapture and check your changes",
      status: reviewCurrent
        ? "recorded"
        : comparisonRecorded
          ? "needed"
          : "waiting",
      detail: recaptureRequired
        ? "Recorded edits require fresh capture and comparison. Earlier findings and decisions remain in history."
        : reviewCurrent
          ? "Reconciliation is recorded for this evidence basis. It does not certify every source file, quiz pool or external provider."
          : "After corrections, capture again, compare again and record reconciliation for the current evidence.",
    },
    {
      id: "deliver",
      title: "Prepare the content map or outline",
      status:
        reviewCurrent && evaluation.outlineReady
          ? "ready"
          : reviewCurrent
            ? "needed"
            : "waiting",
      detail: reviewCurrent
        ? "Continue the selected deliverable route using source-linked drafts and an explicit owner approval. Delivery remains a separate recorded action."
        : "Resolve reconciliation prerequisites before treating a content map or outline as ready for handoff.",
    },
  ];
  return {
    steps,
    currentStage,
    nextAction,
    recaptureRequired,
    historyUnavailable,
    comparisonRecorded,
    comparisonCurrent:
      comparisonRecorded &&
      !pending.changed &&
      !recaptureRequired &&
      !historyUnavailable,
    reviewCurrent,
    sourceScope:
      baseline.status === "document"
        ? ("text-only" as const)
        : sourceReady
          ? ("retained-package" as const)
          : ("unverified" as const),
    counts: {
      retainedTasks: evaluation.tasks.length,
      flaggedTasks: evaluation.attention.length,
      documentedChecks: evaluation.checked.length,
      unresolvedTasks,
      editDeclarations: freshness?.declarationCount || 0,
    },
    scope:
      "Workflow progress and flags describe recorded evidence and owner work. They are not a quality score or a percentage of complete extraction.",
  };
}
