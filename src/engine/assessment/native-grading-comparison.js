import { inspectDirectNativeGrading } from "./native-grading.js";

/** Add only an explicit native boolean. Existing DOM metadata retains its
 * meaning; contradictory graded observations make that dimension unknown. */
export function applyDirectNativeGrading(
  item,
  nativeAssignment,
  expectedCourseId,
) {
  const inspected = inspectDirectNativeGrading(item, expectedCourseId);
  if (!inspected) return nativeAssignment;
  const observation = inspected.observation;
  const assignment = nativeAssignment || {
      schemaVersion: 1,
      parser: "bound-authoring-draft-grading",
      origin: "coursera-authoring-draft-api",
      parserConfidence: 0,
      scope: "GRADING_SETTING_ONLY",
      submission: {},
      metadataCorrections: [],
    },
    settings = { ...(assignment.settings || {}) },
    currentStateEvidence = { ...(assignment.currentStateEvidence || {}) };
  const explicit = [];
  if (typeof settings.graded === "boolean") explicit.push(settings.graded);
  const alias = String(settings.gradeSetting || "").trim();
  if (/^(?:ungraded|practice)$/i.test(alias)) explicit.push(false);
  else if (/^graded$/i.test(alias)) explicit.push(true);
  if (
    inspected.projectionConflict ||
    explicit.some((value) => value !== observation.graded)
  ) {
    currentStateEvidence.nativeGradingConflict = {
      code: "NATIVE_GRADING_OBSERVATIONS_CONFLICT",
      scope: "GRADING_SETTING_ONLY",
      reason: inspected.projectionConflict
        ? "DIRECT_GRADING_CONFIGURATION_PROJECTION_CONFLICT"
        : "NATIVE_DRAFT_AND_EDITOR_GRADING_CONFLICT",
      direct: observation,
      priorSettings: {
        ...(Object.prototype.hasOwnProperty.call(settings, "graded")
          ? { graded: settings.graded }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(settings, "gradeSetting")
          ? { gradeSetting: settings.gradeSetting }
          : {}),
      },
    };
    delete settings.graded;
    delete settings.gradeSetting;
    delete currentStateEvidence.nativeGrading;
  } else {
    settings.graded = observation.graded;
    currentStateEvidence.nativeGrading = observation;
    delete currentStateEvidence.nativeGradingConflict;
  }
  return { ...assignment, settings, currentStateEvidence };
}
