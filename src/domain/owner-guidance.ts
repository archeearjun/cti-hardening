import type { OwnerTask } from "./owner-actions.ts";
import type { ItemContentView } from "./owner-content.ts";
import type { EvidenceObject } from "./workspace-types.ts";

export interface OwnerCheckSummary {
  source: string;
  field: string;
  status: string;
  detail: string;
}

const fields = [
  ["content", "Text"],
  ["assets", "Files"],
  ["links", "Links"],
  ["structuredAssessment", "Questions"],
  ["behavior", "Activity settings"],
  ["runtime", "Interactive activity"],
  ["liveSourceText", "Brightspace wording"],
] as const;
const statuses: Record<string, string> = {
  VERIFIED: "Comparison passed",
  UNVERIFIED: "Not verified",
  DRIFT: "Differences to review",
  CHANGED: "Differences to review",
  PARTIAL: "Partly matched — review gaps",
  RELOCATED: "Found elsewhere — confirm placement",
  TRANSFORMED: "Preserved in a different format",
  REVIEW: "Review the observed differences",
};
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Describe saved decisions, never recompute or clear them from a follow-up
 * capture. Passing one field must not turn into a whole-item completion claim. */
export function ownerGuidance(task: OwnerTask) {
  const checks: OwnerCheckSummary[] = [];
  const readiness: EvidenceObject[] = [];
  for (const finding of task.findings) {
    for (const [key, label] of fields) {
      const check = finding.checks?.[key];
      const status = text(check?.status);
      if (!status || status === "NOT_APPLICABLE") continue;
      const reason =
        key === "content" &&
        check.reason ===
          "Ensemble text similarity is strong with sufficient captured coverage."
          ? "The captured text closely matches the source. Small wording or heading differences may remain."
          : text(check.reason);
      checks.push({
        source: text(finding.sourceName),
        field:
          key === "content" && finding.checks?.liveSourceText
            ? "Package text"
            : label,
        status: Object.hasOwn(statuses, status)
          ? statuses[status]
          : status.replaceAll("_", " "),
        detail:
          reason ||
          (key === "links"
            ? "This checks captured link targets; opening them as a learner still needs verification."
            : key === "assets"
              ? "This checks recorded file evidence; learner access and appearance are separate."
              : "See the saved comparison details for the scope of this check."),
      });
    }
    for (const findingReadiness of list(finding.checks?.destinationReadiness)) {
      if (!findingReadiness || typeof findingReadiness !== "object") continue;
      const r = findingReadiness as EvidenceObject;
      if (!readiness.some((p) => p.code === r.code && p.detail === r.detail))
        readiness.push(r);
    }
  }
  // Unmatched destination items can have readiness actions without source rows.
  for (const action of task.actions) {
    if (
      action.sourceName === "Destination readiness" &&
      !readiness.some((r) => r.code === action.verdict)
    ) {
      readiness.push({
        code: action.verdict,
        action: action.action,
        severity: action.severity,
      });
    }
  }
  const sourceText = task.sources
    .map((s) => text(s.sourcePayload?.textSample))
    .join("\n");
  const contact = readiness.some((r) => r.code === "PLACEHOLDER_CONTACT_INFO");
  const sourceContact =
    contact &&
    /first\.last\.?@email\.com|\(000\)\s*000[-\s]?0000|000[-\s]?000[-\s]?0000/i.test(
      sourceText,
    );
  const active = task.actions.filter((a) => a.severity !== "NONE");
  const actions = (active.length ? active : task.actions)
    .map((a) => text(a.action))
    .filter(Boolean);
  const contactAction =
    "Replace with the intended facilitator/contact details or remove the placeholder fields.";
  const clearContactAction =
    "Obtain the approved facilitator/contact details and replace the dummy fields. Review any template bio or image-size instructions against the intended learner content too. Remove a field only if the course requirements allow it. If the intended details are unavailable, record Blocked — need help and state what you need.";
  const nextActions = [
    ...new Set(
      actions.map((a) =>
        a
          .replace(
            /^Source fidelity and destination readiness are separate checks\.\s*/,
            "",
          )
          .replace(contactAction, clearContactAction),
      ),
    ),
  ];
  // Only relabel an explicitly readiness-only review. Keep mixed defects,
  // policy exemptions, uncertain source matches and unknown states visible.
  const readinessOnly =
    task.status === "REVIEW" &&
    task.findings.length > 0 &&
    task.findings.every((r) => r.verdict === "VERIFIED") &&
    active.length > 0 &&
    active.every((a) =>
      text(a.action).startsWith(
        "Source fidelity and destination readiness are separate checks. ",
      ),
    );
  const sourceImages = [
    ...new Set(
      task.sources
        .flatMap((s) => list(s.sourcePayload?.images))
        .filter((r): r is string => typeof r === "string"),
    ),
  ];
  return {
    checks,
    readinessOnly,
    nextActions,
    sourceImages,
    readiness: readiness.map((r) => ({
      code: text(r.code),
      detail:
        r.code === "PLACEHOLDER_CONTACT_INFO"
          ? sourceContact
            ? "Dummy contact information is present in Coursera and also appears in the saved source package. This is a source-template readiness issue, not by itself evidence of failed ingestion."
            : "Dummy contact information was detected in Coursera. Its origin is not established by the saved source text."
          : text(r.detail) || text(r.action) || text(r.code),
    })),
  };
}

export function questionEvidenceRelevant(
  task: OwnerTask,
  view?: ItemContentView,
): boolean {
  if (
    task.questionComparisons.length ||
    task.pluginTargets.length ||
    /quiz|assessment|assignment|question|practice|interactive|h5p|lti|scorm/i.test(
      `${task.type} ${task.name}`,
    ) ||
    task.sources.some(
      (s) =>
        /quiz|assessment|assignment|imsqti|imsdt|h5p|lti|scorm/i.test(
          `${s.type} ${s.title}`,
        ) || s.sourcePayload?.interactiveSignals?.detected === true,
    )
  )
    return true;
  if (!view) return false;
  return [
    ...view.source,
    view.coursera,
    ...view.linkedCoursera,
    ...view.previousLinkedCoursera,
    ...view.observations,
    ...(view.previousCoursera ? [view.previousCoursera] : []),
  ].some(
    (c) =>
      c.questions.length > 0 ||
      c.expectedQuestions !== null ||
      c.questionCoverage !== "UNVERIFIED",
  );
}
