import {
  hasVerifiedComparisonStructure,
  sourceBaseline,
} from "./assignment-evidence.ts";
import { validateEvidenceInput } from "./evidence-input-record.ts";
import { latestAssignmentAudit } from "./assignment-plan.ts";
import type { EvidenceInputData } from "./evidence-input-record.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

export type CaptureDestination =
  | "Scan"
  | "Source LMS"
  | "Extract"
  | "Compare"
  | "Assignment workspace";

/** An operator plan over saved metadata. It neither starts a browser nor
 * establishes that a referenced original is present or complete. */
export function captureWorkPlan(records: WorkspaceRecord[]) {
  const byCourse = new Map<string, WorkspaceRecord[]>();
  for (const record of records) {
    const rows = byCourse.get(record.packageId) || [];
    rows.push(record);
    byCourse.set(record.packageId, rows);
  }
  return records
    .filter((r) => r.kind === "package" && r.data.archived !== true)
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true }) ||
        a.id.localeCompare(b.id),
    )
    .map((course) => {
      const related = byCourse.get(course.id) || [];
      const inputs: {
        recordId: string;
        recordVersion: number;
        data: EvidenceInputData;
      }[] = [];
      for (const record of related) {
        if (
          record.kind !== "operations" ||
          record.packageId !== course.id ||
          record.data.type !== "evidence-input"
        )
          continue;
        try {
          validateEvidenceInput(record.data);
          if (record.data.confirmedCourseId !== course.id) continue;
          inputs.push({
            recordId: record.id,
            recordVersion: record.version,
            data: record.data as EvidenceInputData,
          });
        } catch {
          /* Invalid metadata cannot become a recorded input. */
        }
      }
      const audit = latestAssignmentAudit(course.id, related);
      const hash = (value: unknown) =>
        typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
      const baseline = sourceBaseline(course.data.scan);
      const latestInput = (role: EvidenceInputData["role"]) =>
        inputs
          .filter((r) => r.data.role === role)
          .sort(
            (a, b) =>
              Date.parse(b.data.importedAt) - Date.parse(a.data.importedAt) ||
              b.recordId.localeCompare(a.recordId),
          )[0];
      const sourceInput = inputs.some(
        (r) => r.data.role === "brightspace-capture",
      );
      const courseraInput = inputs.some(
        (r) => r.data.role === "coursera-capture",
      );
      const sourceCompared = hash(audit?.data.hashes?.brightspace);
      const courseraCompared = hash(audit?.data.hashes?.json);
      const sourceMatches =
        hash(course.data.scan?.fileSha256) &&
        audit?.data.sourceScanSha256 === course.data.scan.fileSha256;
      const structureRecorded =
        !!audit &&
        sourceMatches &&
        courseraCompared &&
        hasVerifiedComparisonStructure(audit);
      let destination: CaptureDestination = "Assignment workspace";
      let next = "Review saved evidence and item exceptions";
      if (!["scanned", "document"].includes(baseline.status)) {
        destination = "Scan";
        next = "Inspect and save the source baseline";
      } else if (
        !sourceInput &&
        !sourceCompared &&
        baseline.status !== "document"
      ) {
        destination = "Source LMS";
        next = "Capture the matching source in its signed-in tab";
      } else if (!courseraInput && !courseraCompared) {
        destination = "Extract";
        next = "Capture Coursera in its signed-in tab";
      } else if (
        !structureRecorded ||
        audit?.data.result?.success !== true ||
        ["brightspace-capture", "coursera-capture"].some((role) => {
          const latest = latestInput(role as EvidenceInputData["role"]);
          const key = role === "brightspace-capture" ? "brightspace" : "json";
          return (
            latest &&
            latest.data.sourceHash !== audit?.data.hashes?.[key] &&
            latest.data.sourceHash !==
              audit?.data.captureTransport?.[key]?.sha256
          );
        })
      ) {
        destination = "Compare";
        next = "Choose current inputs and run the comparison";
      }
      return {
        courseId: course.id,
        courseVersion: course.version,
        title: course.title,
        owner: String(course.data.owner || ""),
        recordedStatus: String(course.data.status || ""),
        baseline: baseline.label,
        source:
          sourceInput || sourceCompared
            ? "Input recorded; review source coverage"
            : "Source capture not recorded",
        coursera:
          courseraInput || courseraCompared
            ? "Input recorded; review content coverage"
            : "Coursera capture not recorded",
        comparison: structureRecorded
          ? "Structural comparison recorded; content and freshness require review"
          : "Current structural comparison not established",
        audit: audit
          ? {
              id: audit.id,
              version: audit.version,
              inputHashes: { ...audit.data.hashes },
              transportHashes: Object.fromEntries(
                ["json", "brightspace"].flatMap((key) => {
                  const sha256 = audit.data.captureTransport?.[key]?.sha256;
                  return hash(sha256) ? [[key, sha256]] : [];
                }),
              ),
            }
          : null,
        inputs: inputs.map(({ recordId, recordVersion, data }) => ({
          recordId,
          recordVersion,
          role: data.role,
          sourceName: data.sourceName,
          sourceHash: data.sourceHash,
          nativeCourseId: data.nativeCourseId,
          capturedAt: data.capturedAt,
          importedAt: data.importedAt,
        })),
        next,
        destination,
        captureStarted: false,
        completeContentEstablished: false,
      };
    });
}
