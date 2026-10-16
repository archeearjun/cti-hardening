import {
  itemLifecycleRecordId,
  validateItemLifecycleData,
  type LifecycleEvent,
} from "./item-lifecycle.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

export interface DeclaredAssignmentChange {
  eventId: string;
  platform: LifecycleEvent["platform"];
  nativeId: string;
  referenceKind?: "owner-review";
  itemKey?: string;
  recordedAt: string;
  observedAt: string;
  auditId: string;
  auditVersion: number;
  sourceScanSha256: string;
  inputHashes: Record<string, string>;
}
export interface AssignmentChangesSummary {
  schemaVersion: 1;
  status: "available" | "invalid";
  eventCount: number;
  declarationCount: number;
  /** One latest timestamp barrier per platform, never an item-completeness count. */
  latest: DeclaredAssignmentChange[];
}
const timestamp = (value: unknown) =>
  typeof value === "string" ? Date.parse(value) : Number.NaN;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const changeTime = (change: DeclaredAssignmentChange) =>
  Math.max(timestamp(change.recordedAt), timestamp(change.observedAt));

/** Listing metadata is bounded to three native-platform receipts. The original
 * append-only ledger, rather than this summary, retains every declaration. */
export function summarizeAssignmentChanges(
  value: unknown,
): AssignmentChangesSummary {
  try {
    validateItemLifecycleData(value);
    const latest = new Map<
      LifecycleEvent["platform"],
      DeclaredAssignmentChange
    >();
    let declarationCount = 0;
    for (const event of value.events) {
      if (event.kind !== "decision" || event.decision !== "changed") continue;
      declarationCount++;
      const change: DeclaredAssignmentChange = {
        eventId: event.eventId,
        platform: event.platform,
        nativeId: event.nativeId,
        recordedAt: event.recordedAt,
        observedAt: event.observedAt,
        auditId: event.basis.auditId,
        auditVersion: event.basis.auditVersion,
        sourceScanSha256: event.basis.sourceScanSha256,
        inputHashes: event.basis.inputHashes,
      };
      const previous = latest.get(event.platform);
      if (!previous || changeTime(change) >= changeTime(previous))
        latest.set(event.platform, change);
    }
    return {
      schemaVersion: 1,
      status: "available",
      eventCount: value.events.length,
      declarationCount,
      latest: [...latest.values()].sort((a, b) =>
        a.platform.localeCompare(b.platform),
      ),
    };
  } catch {
    return {
      schemaVersion: 1,
      status: "invalid",
      eventCount: 0,
      declarationCount: 0,
      latest: [],
    };
  }
}

function validSummary(value: any): value is AssignmentChangesSummary {
  return (
    value?.schemaVersion === 1 &&
    value.status === "available" &&
    Number.isSafeInteger(value.eventCount) &&
    value.eventCount >= 0 &&
    value.eventCount <= 20000 &&
    Number.isSafeInteger(value.declarationCount) &&
    value.declarationCount >= 0 &&
    value.declarationCount <= value.eventCount &&
    Array.isArray(value.latest) &&
    value.latest.length <= 3 &&
    value.latest.length <= value.declarationCount &&
    new Set(
      value.latest.map((change: DeclaredAssignmentChange) => change.platform),
    ).size === value.latest.length &&
    (value.declarationCount === 0
      ? value.latest.length === 0
      : value.latest.length > 0) &&
    value.latest.every(
      (change: DeclaredAssignmentChange) =>
        change &&
        ["coursera", "source", "brightspace"].includes(change.platform) &&
        typeof change.eventId === "string" &&
        change.eventId.length > 0 &&
        change.eventId.length <= 120 &&
        typeof change.nativeId === "string" &&
        change.nativeId.length > 0 &&
        change.nativeId.length <= 2000 &&
        Number.isFinite(changeTime(change)) &&
        typeof change.auditId === "string" &&
        change.auditId.length > 0 &&
        change.auditId.length <= 120 &&
        Number.isSafeInteger(change.auditVersion) &&
        change.auditVersion >= 1 &&
        hash(change.sourceScanSha256) &&
        change.inputHashes &&
        typeof change.inputHashes === "object" &&
        !Array.isArray(change.inputHashes) &&
        Object.keys(change.inputHashes).length <= 20 &&
        Object.values(change.inputHashes).every(hash),
    )
  );
}

/** Changed remains a capture barrier after a later checked decision. A newly
 * saved report is insufficient: its actual captured source must postdate the
 * declaration and have a different input identity from the pre-edit report. */
export function assignmentChangeFreshness(
  courseId: string,
  audit: WorkspaceRecord | null,
  records: WorkspaceRecord[],
) {
  const ledgers = records.filter(
    (record) =>
      record.kind === "operations" &&
      record.packageId === courseId &&
      record.data.type === "item-lifecycle",
  );
  const blocked = (detail: string) => ({
    status: "history-unavailable" as const,
    declarationCount: 0,
    latest: [] as DeclaredAssignmentChange[],
    pending: [] as DeclaredAssignmentChange[],
    needsRecapture: false,
    blockers: [detail],
  });
  if (ledgers.length > 1)
    return blocked(
      "Multiple item histories exist for this assignment. Resolve their identity before recording reconciliation.",
    );
  let summary: AssignmentChangesSummary = {
    schemaVersion: 1,
    status: "available",
    eventCount: 0,
    declarationCount: 0,
    latest: [],
  };
  if (ledgers.length) {
    const record = ledgers[0];
    if (
      record.id !== itemLifecycleRecordId(courseId) ||
      record.data.courseId !== courseId
    )
      return blocked(
        "The item history has a different course identity. Reload the current assignment history.",
      );
    if (Array.isArray(record.data.events))
      summary = summarizeAssignmentChanges(record.data);
    else if (validSummary(record.data.declaredChanges))
      summary = record.data.declaredChanges;
    else {
      // Old shared listing rows predate the bounded declaration summary. A loaded
      // full ledger can supply it only while the exact listed version still agrees.
      const loaded = audit?.data.assignmentLifecycleEvidence as
        | WorkspaceRecord
        | null
        | undefined;
      if (
        !loaded ||
        loaded.id !== record.id ||
        loaded.version !== record.version ||
        loaded.packageId !== courseId ||
        loaded.data.courseId !== courseId ||
        !Array.isArray(loaded.data.events)
      )
        return blocked(
          "Load the full item history before recording reconciliation. Its edit declarations are not present in this saved listing.",
        );
      summary = summarizeAssignmentChanges(loaded.data);
    }
    if (
      !validSummary(summary) ||
      (Number.isSafeInteger(record.data.eventCount) &&
        summary.eventCount !== record.data.eventCount)
    )
      return blocked(
        "The item edit history could not be verified. Reload the current assignment history before handoff.",
      );
  }
  const latest = new Map(
    summary.latest.map((change) => [change.platform, change]),
  );
  let declarationCount = summary.declarationCount;
  // Legacy owner report outcomes remain bound to their original report. Their
  // sticky edit receipt survives checked/fetch/import saves and new reports.
  for (const reviewRecord of records.filter(
    (record) => record.kind === "item-review" && record.packageId === courseId,
  )) {
    const review = reviewRecord.data.review;
    if (!review?.changeDeclaredAt && review?.status !== "changed") continue;
    const dates = [
      review.changeDeclaredAt,
      ...(review.status === "changed"
        ? [reviewRecord.updatedAt, review.updatedAt]
        : []),
    ].filter(
      (value) => typeof value === "string" && Number.isFinite(timestamp(value)),
    );
    const changedAt = dates.length
      ? Math.max(...dates.map(timestamp))
      : Number.NaN;
    if (
      !Number.isFinite(changedAt) ||
      !reviewRecord.data.auditId ||
      !reviewRecord.data.itemKey
    )
      return blocked(
        "A recorded item edit has no usable date or report identity. Review its original item outcome before handoff.",
      );
    const original = records.find(
      (record) =>
        record.kind === "audit" &&
        record.id === reviewRecord.data.auditId &&
        record.packageId === courseId,
    );
    const change: DeclaredAssignmentChange = {
      eventId: "review:" + reviewRecord.id,
      platform: "coursera",
      nativeId: "",
      referenceKind: "owner-review",
      itemKey: reviewRecord.data.itemKey,
      recordedAt: new Date(changedAt).toISOString(),
      observedAt: new Date(changedAt).toISOString(),
      auditId: reviewRecord.data.auditId,
      auditVersion: original?.version || 1,
      sourceScanSha256: original?.data.sourceScanSha256 || "",
      inputHashes: Object.fromEntries(
        Object.entries(original?.data.hashes || {}).filter(([, value]) =>
          hash(value),
        ),
      ) as Record<string, string>,
    };
    declarationCount++;
    const previous = latest.get("coursera");
    if (!previous || changedAt >= changeTime(previous))
      latest.set("coursera", change);
  }
  const latestChanges = [...latest.values()].sort((a, b) =>
    a.platform.localeCompare(b.platform),
  );
  const reportTime = timestamp(audit?.updatedAt);
  const pending = latestChanges.filter((change) => {
    const changedAt = changeTime(change);
    if (
      !audit ||
      audit.kind !== "audit" ||
      audit.packageId !== courseId ||
      audit.id === change.auditId ||
      !Number.isFinite(reportTime) ||
      reportTime <= changedAt
    )
      return true;
    if (change.platform === "coursera") {
      const capturedAt = timestamp(
        audit.data.result?.stats?.extractorMeta?.capturedAt,
      );
      return (
        !Number.isFinite(capturedAt) ||
        capturedAt <= changedAt ||
        !hash(audit.data.hashes?.json) ||
        audit.data.hashes.json === change.inputHashes.json
      );
    }
    if (change.platform === "brightspace") {
      const capturedAt = timestamp(
        audit.data.contentEvidence?.brightspaceMeta?.capturedAt ||
          audit.data.result?.liveSourceGroundTruth?.capturedAt,
      );
      return (
        !Number.isFinite(capturedAt) ||
        capturedAt <= changedAt ||
        !hash(audit.data.hashes?.brightspace) ||
        audit.data.hashes.brightspace === change.inputHashes.brightspace
      );
    }
    return (
      !hash(audit.data.sourceScanSha256) ||
      audit.data.sourceScanSha256 === change.sourceScanSha256
    );
  });
  return {
    status: pending.length
      ? ("recapture-required" as const)
      : ("current" as const),
    declarationCount,
    latest: latestChanges,
    pending,
    needsRecapture: pending.length > 0,
    blockers: pending.map((change) =>
      change.platform === "coursera"
        ? "A Coursera item was recorded as changed. Capture the edited shell and save a new comparison; a later checked decision does not refresh captured content."
        : change.platform === "brightspace"
          ? "A Brightspace item was recorded as changed. Capture the updated source and save a new comparison before handoff."
          : "A source item was recorded as changed. Rescan the updated source package and save a new comparison before handoff.",
    ),
  };
}
