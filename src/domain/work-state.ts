export type WorkScope = "ACTIVE" | "EXCLUDED";
export type RedoState =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "DONE"
  | "NOT_REQUIRED"
  | "BLOCKED";
export type OutlineState = "NOT_STARTED" | "DRAFT" | "SECURED" | "BLOCKED";
export type AuditState = "NOT_STARTED" | "PASS" | "REVIEW" | "BLOCKED";
export type ContentMapState =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "DONE"
  | "BLOCKED";

export interface CourseWorkState {
  scope: WorkScope;
  courseraRedo: RedoState;
  courseOutline: OutlineState;
  sourceAudit: AuditState;
  specializationOutline: OutlineState;
  contentMap: ContentMapState;
  notes: string;
}

export const WORK_STATE_OPTIONS = {
  scope: ["ACTIVE", "EXCLUDED"],
  courseraRedo: ["NOT_STARTED", "IN_PROGRESS", "DONE", "NOT_REQUIRED", "BLOCKED"],
  courseOutline: ["NOT_STARTED", "DRAFT", "SECURED", "BLOCKED"],
  sourceAudit: ["NOT_STARTED", "PASS", "REVIEW", "BLOCKED"],
  specializationOutline: ["NOT_STARTED", "DRAFT", "SECURED", "BLOCKED"],
  contentMap: ["NOT_STARTED", "IN_PROGRESS", "DONE", "BLOCKED"],
} as const;

export function defaultCourseWorkState(): CourseWorkState {
  return {
    scope: "ACTIVE",
    courseraRedo: "NOT_STARTED",
    courseOutline: "NOT_STARTED",
    sourceAudit: "NOT_STARTED",
    specializationOutline: "NOT_STARTED",
    contentMap: "NOT_STARTED",
    notes: "",
  };
}

export function validateCourseWorkState(value: unknown): CourseWorkState {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fallback = defaultCourseWorkState();
  const result: Record<string, string> = {};
  for (const [field, allowed] of Object.entries(WORK_STATE_OPTIONS)) {
    const candidate = String(input[field] || fallback[field as keyof CourseWorkState]);
    if (!(allowed as readonly string[]).includes(candidate))
      throw new Error("Invalid work-state value for " + field + ".");
    result[field] = candidate;
  }
  result.notes = String(input.notes || "").slice(0, 4000);
  return result as unknown as CourseWorkState;
}

export interface WorkActionInput {
  hasSourcePackage: boolean;
  sourceRescanned: boolean;
  existingImportOnlyShell: boolean;
  rawQaFresh: boolean;
  rawQaRecommendation?: "KEEP" | "REVIEW" | "REINGEST" | "NONE";
  runtimeFlagged?: boolean;
  needsSpecialization?: boolean;
  duplicateAmbiguous?: boolean;
}

export function nextCourseWorkAction(
  item: WorkActionInput,
  stateInput: unknown,
) {
  const state = validateCourseWorkState(stateInput);
  if (state.scope === "EXCLUDED")
    return { code: "EXCLUDED", label: "Excluded from this redo campaign", tone: "muted" };
  if (item.duplicateAmbiguous)
    return { code: "RESOLVE_CTI_DUPLICATE", label: "Review duplicate CTI package records", tone: "warning" };
  if (!item.hasSourcePackage)
    return { code: "UPLOAD_SOURCE", label: "Upload the source package", tone: "danger" };
  if (!item.sourceRescanned)
    return { code: "RESCAN_SOURCE", label: "Re-scan the source package with the current CTI parser", tone: "primary" };
  if (state.courseraRedo === "BLOCKED")
    return { code: "COURSERA_BLOCKED", label: "Resolve Coursera reimport blocker", tone: "danger" };
  if (
    state.courseraRedo !== "DONE" &&
    state.courseraRedo !== "NOT_REQUIRED" &&
    item.existingImportOnlyShell
  ) {
    if (!item.rawQaFresh)
      return { code: "AUDIT_EXISTING_RAW", label: "Audit the existing Coursera shell against the refreshed source before re-ingesting", tone: "warning" };
    if (item.rawQaRecommendation === "KEEP") {
      if (item.runtimeFlagged)
        return { code: "REVIEW_SCORM_EXISTING", label: "Structural evidence supports the shell, but runtime/interactivity still needs manual launch verification", tone: "warning" };
      return { code: "CONFIRM_KEEP_EXISTING", label: "Evidence supports the existing raw shell — mark Coursera reimport Not required to proceed", tone: "success" };
    }
    if (item.rawQaRecommendation === "REINGEST")
      return { code: "REDO_COURSERA", label: "Re-run Smart Ingestion; CTI found material fidelity issues", tone: "danger" };
    return { code: "REVIEW_EXISTING_RAW", label: "Review the existing raw-shell QA findings before deciding whether to re-ingest", tone: "warning" };
  }
  if (state.courseraRedo !== "DONE" && state.courseraRedo !== "NOT_REQUIRED")
    return { code: "REDO_COURSERA", label: "Redo Smart Ingestion in Coursera", tone: "primary" };
  if (state.courseOutline === "BLOCKED")
    return { code: "OUTLINE_BLOCKED", label: "Resolve course-outline blocker", tone: "danger" };
  if (state.courseOutline === "NOT_STARTED")
    return { code: "BUILD_COURSE_OUTLINE", label: "Create the course outline", tone: "primary" };
  if (state.courseOutline === "DRAFT" && state.sourceAudit !== "PASS")
    return { code: "AUDIT_SOURCE", label: "Audit the course outline against the source LMS", tone: "warning" };
  if (state.sourceAudit === "BLOCKED" || state.sourceAudit === "REVIEW")
    return { code: "AUDIT_REVIEW", label: "Resolve source-LMS audit findings", tone: "warning" };
  if (state.sourceAudit === "PASS" && state.courseOutline !== "SECURED")
    return { code: "SECURE_COURSE_OUTLINE", label: "Secure/finalize the audited course outline", tone: "primary" };
  if (item.needsSpecialization) {
    if (state.specializationOutline === "BLOCKED")
      return { code: "SPEC_OUTLINE_BLOCKED", label: "Resolve specialization-outline blocker", tone: "danger" };
    if (state.specializationOutline === "NOT_STARTED")
      return { code: "BUILD_SPEC_OUTLINE", label: "Create the specialization outline", tone: "primary" };
    if (state.specializationOutline === "DRAFT")
      return { code: "SECURE_SPEC_OUTLINE", label: "Review and secure the specialization outline", tone: "warning" };
    if (state.contentMap === "BLOCKED")
      return { code: "CONTENT_MAP_BLOCKED", label: "Resolve content-map blocker", tone: "danger" };
    if (state.contentMap !== "DONE")
      return { code: "BUILD_CONTENT_MAP", label: "Create/finalize the content map", tone: "primary" };
  }
  return { code: "COMPLETE", label: "Redo workflow complete", tone: "success" };
}
