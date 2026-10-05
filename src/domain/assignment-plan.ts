import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { buildOwnerTasks, needsOwnerAction } from "./owner-actions.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";
import { sourceIdentityMessage } from "./assignment-evidence.ts";

export const CONTENT_MAP_AGENT =
  "https://chatgpt.com/g/g-69a5fdc3d3c081918683edd8a3c13e90-course-to-specialization-content-map-creator";
export const SPECIALIZATION_AGENT =
  "https://chatgpt.com/g/g-69ac8b614c9c81919f1d0a08dce99e0a-specialization-curriculum-outline-builder";
export type AssignmentRoute = "UNDECIDED" | "COURSE" | "SPECIALIZATION";
export interface ReviewReceipt {
  basis: string;
  note: string;
  recordedAt: string;
  recordedBy: string;
}
export interface AssignmentPlan {
  route: AssignmentRoute;
  shellChangedAt: string;
  reconciliation?: ReviewReceipt;
  mapApproval?: ReviewReceipt & { url: string };
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
export function normalizeAssignmentPlan(value: unknown): AssignmentPlan {
  if (value != null && (typeof value !== "object" || Array.isArray(value)))
    throw Error("Invalid assignment plan.");
  const v = object(value);
  const route = v.route ?? "UNDECIDED";
  if (
    typeof route !== "string" ||
    !["UNDECIDED", "COURSE", "SPECIALIZATION"].includes(route)
  )
    throw Error("Choose a course outline or specialization workflow.");
  if (
    v.shellChangedAt != null &&
    v.shellChangedAt !== "" &&
    !date(v.shellChangedAt)
  )
    throw Error("Invalid shell-change date.");
  const out: AssignmentPlan = {
    route: route as AssignmentRoute,
    shellChangedAt: String(v.shellChangedAt || ""),
  };
  for (const key of ["reconciliation", "mapApproval"] as const) {
    if (v[key] == null) continue;
    const r = object(v[key]);
    if (
      typeof r.basis !== "string" ||
      !/^[a-f0-9]{64}$/.test(r.basis) ||
      typeof r.note !== "string" ||
      r.note.trim().length < 20 ||
      r.note.length > 4000 ||
      !date(r.recordedAt) ||
      typeof r.recordedBy !== "string" ||
      !r.recordedBy ||
      r.recordedBy.length > 320
    )
      throw Error(
        "A review needs its evidence reference, reviewer, date and a meaningful note.",
      );
    const receipt: ReviewReceipt = {
      basis: r.basis,
      note: r.note,
      recordedAt: String(r.recordedAt),
      recordedBy: r.recordedBy,
    };
    if (key === "mapApproval") {
      let u: URL;
      try {
        u = new URL(String(r.url || ""));
      } catch {
        throw Error("Add the approved content map URL.");
      }
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.href.length > 2048
      )
        throw Error("Use an HTTPS content map URL without credentials.");
      out.mapApproval = { ...receipt, url: u.href };
    } else out.reconciliation = receipt;
  }
  return out;
}

export function latestAssignmentAudit(
  courseId: string,
  records: WorkspaceRecord[],
) {
  return (
    records
      .filter((r) => r.kind === "audit" && r.packageId === courseId)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      )[0] || null
  );
}
function reviewsFor(
  course: WorkspaceRecord,
  audit: WorkspaceRecord,
  records: WorkspaceRecord[],
) {
  return records.filter(
    (r) =>
      r.kind === "item-review" &&
      r.packageId === course.id &&
      r.data.auditId === audit.id,
  );
}
// Content identity, not course record version: saving a map/owner must not undo
// reconciliation. A changed scan, report, item review or declared shell edit does.
export function assignmentBasis(
  course: WorkspaceRecord,
  audit: WorkspaceRecord,
  records: WorkspaceRecord[],
) {
  const plan = normalizeAssignmentPlan(course.data.assignmentPlan);
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([
          course.id,
          course.data.scan?.fileSha256,
          course.data.scan?.scannedAt,
          audit.id,
          audit.version,
          audit.data.sourceScanSha256,
          Object.entries(audit.data.hashes || {}).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
          plan.shellChangedAt,
          reviewsFor(course, audit, records)
            .map((r) => [
              r.id,
              r.version,
              r.updatedAt,
              r.data.itemKey,
              r.data.review?.status,
              r.data.review?.note,
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ]),
      ),
    ),
  );
}
export function reconciliationCurrent(
  course: WorkspaceRecord,
  audit: WorkspaceRecord | null,
  records: WorkspaceRecord[],
) {
  const plan = normalizeAssignmentPlan(course.data.assignmentPlan);
  const latest = latestAssignmentAudit(course.id, records);
  return (
    !!audit &&
    latest?.id === audit.id &&
    latest.version === audit.version &&
    !!plan.reconciliation &&
    !!course.data.scan?.fileSha256 &&
    audit.data.sourceScanSha256 === course.data.scan.fileSha256 &&
    plan.reconciliation.basis === assignmentBasis(course, audit, records)
  );
}

export function evaluateAssignment(
  course: WorkspaceRecord,
  audit: WorkspaceRecord | null,
  records: WorkspaceRecord[],
) {
  const plan = normalizeAssignmentPlan(course.data.assignmentPlan);
  const result = audit?.data.result;
  const sameSource =
    !!audit &&
    !!course.data.scan?.fileSha256 &&
    audit.data.sourceScanSha256 === course.data.scan.fileSha256;
  const tasks = result
    ? buildOwnerTasks(
        result,
        sameSource ? course.data.scan.courseTree || [] : [],
        "",
        audit?.data.contentEvidence?.coursera || [],
      )
    : [];
  const attention = tasks.filter(needsOwnerAction);
  const reviews = audit ? reviewsFor(course, audit, records) : [];
  const reviewFor = (key: string) => {
    const matches = reviews.filter((r) => r.data.itemKey === key);
    return matches.length === 1 ? matches[0].data.review : undefined;
  };
  const checked = attention.filter((t) => {
    const r = reviewFor(t.key);
    return (
      r?.status === "checked" &&
      typeof r.note === "string" &&
      r.note.trim().length >= 10
    );
  });
  const changed = attention.filter(
    (t) => reviewFor(t.key)?.status === "changed",
  );
  const blockers: string[] = [];
  if (!audit)
    blockers.push(
      "Import or inspect the Coursera shell, capture it, then save a source-to-Coursera comparison.",
    );
  else {
    const latest = latestAssignmentAudit(course.id, records);
    if (latest?.id !== audit.id || latest.version !== audit.version)
      blockers.push(
        "A newer report is available. Review the latest comparison.",
      );
    if (!sameSource)
      blockers.push(
        sourceIdentityMessage(
          course.data.scan?.fileSha256,
          audit.data.sourceScanSha256,
        ),
      );
    if (!result?.ownerView || !tasks.length || result.success !== true)
      blockers.push(
        "This report has no complete, actionable item inventory. Save a full comparison.",
      );
    if (result?.inputCoherence?.status !== "PASS")
      blockers.push(
        "Source/destination input identity requires review before handoff.",
      );
    if (!audit.data.hashes?.json)
      blockers.push(
        "Add the full Coursera capture; an XLSX alone does not verify content.",
      );
    const capturedAt = result?.stats?.extractorMeta?.capturedAt;
    if (
      plan.shellChangedAt &&
      (!date(capturedAt) ||
        Date.parse(capturedAt) <= Date.parse(plan.shellChangedAt))
    )
      blockers.push(
        "The shell was changed after the captured evidence, or its capture time is unknown. Extract the corrected shell and compare again.",
      );
    if (changed.length)
      blockers.push(
        `${changed.length} item(s) marked changed need a fresh post-edit comparison.`,
      );
    if (attention.length > checked.length)
      blockers.push(
        `${attention.length - checked.length} item(s) still need reconciliation or documented manual verification.`,
      );
  }
  const basis = audit ? assignmentBasis(course, audit, records) : "";
  const reconciled =
    !blockers.length && reconciliationCurrent(course, audit, records);
  const mapApproved = reconciled && plan.mapApproval?.basis === basis;
  const outlineLinks = tasks.filter((t) => !t.sourceOnly);
  const missingLinks = outlineLinks.filter(
    (t) => !t.url || !/\/content\/item\/[^/]+\/[^/?#]+/.test(t.url),
  );
  const outlineReady =
    reconciled &&
    !!outlineLinks.length &&
    !missingLinks.length &&
    (plan.route === "COURSE" ||
      (plan.route === "SPECIALIZATION" && mapApproved));
  return {
    plan,
    tasks,
    attention,
    checked,
    changed,
    blockers,
    basis,
    reconciled,
    mapApproved,
    missingLinks,
    outlineReady,
    canRecordReview: !!audit && !blockers.length,
    captureStatus: result?.captureReadiness?.status || "Not recorded",
    sourceStatus: result?.liveSourceGroundTruth?.status || "Not captured",
    headline: result?.summary?.headlineText || "No comparison saved",
  };
}

export function assignmentHandoff(
  course: WorkspaceRecord,
  audit: WorkspaceRecord | null,
  records: WorkspaceRecord[],
) {
  const e = evaluateAssignment(course, audit, records);
  return [
    `CTI assignment handoff — ${course.title}`,
    `Route: ${e.plan.route}`,
    `Audit: ${audit?.id || "not saved"} · source SHA-256: ${course.data.scan?.fileSha256 || "unknown"}`,
    `Reconciliation: ${e.reconciled ? "Owner review recorded for this evidence" : "NOT READY"}`,
    `Content map approval: ${e.mapApproved ? e.plan.mapApproval?.url : "Not recorded for this evidence"}`,
    `Outline: ${e.outlineReady ? "Prerequisites recorded; verify links in learner preview" : "NOT READY"}`,
    `Recorded audit: ${e.headline}`,
    `Capture: ${e.captureStatus}; source LMS: ${e.sourceStatus}`,
    "Manual review does not change the original audit or certify complete extraction. Do not invent unseen content, answers or links.",
    ...e.blockers.map((b) => `Outstanding: ${b}`),
    ...(e.plan.reconciliation
      ? [`Owner review: ${e.plan.reconciliation.note}`]
      : []),
    "",
    "Item inventory and reconciliation tasks (source-only entries have no destination link):",
    ...e.tasks.flatMap((t) => [
      `${t.path} / ${t.name} [${t.type}] — ${t.status}`,
      t.url
        ? `Coursera item: ${t.url}`
        : "Coursera item link unavailable — resolve before a linked outline.",
      ...t.actions.map((a) => `Action: ${String(a.action || "")}`),
      ...t.questionSummary,
    ]),
    "",
    "Attach CTI's complete owner report with saved follow-ups and the approved content map when required. This handoff is a task inventory, not a generated content map or outline.",
  ].join("\n");
}
