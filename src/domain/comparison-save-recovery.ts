import { digest, newRecord, type WorkspaceStore } from "./workspace-store.ts";
import type { EvidenceObject, WorkspaceRecord } from "./workspace-types.ts";
import {
  workspaceFailureDiagnostic,
  type WorkspaceFailureDiagnostic,
} from "./workspace-http.ts";

/** One computed audit retains one identity until its save is confirmed. This is
 * only a browser-session recovery copy, never a shared persistence receipt. */
export interface PendingComparison {
  record: WorkspaceRecord;
  payloadSha256: string;
  computedAt: string;
  course: WorkspaceRecord;
  historyVersion: string;
  actor: { mode: WorkspaceStore["mode"]; email: string };
  lastSaveFailure?: WorkspaceFailureDiagnostic;
}

/** Diagnostics supplement the local recovery copy, never its computed audit. */
export function recordComparisonSaveFailure(
  pending: PendingComparison,
  error: unknown,
): boolean {
  const diagnostic = workspaceFailureDiagnostic(error);
  if (!diagnostic) return false;
  pending.lastSaveFailure = diagnostic;
  return true;
}

// Protected UI may remount after an access recheck. Retain the recovery copy in
// memory only, and reveal it again only after the same workspace actor connects.
// Closing/reloading the page still requires the owner's downloaded local copy.
const sessionComparisons = new Map<string, PendingComparison>();
const actorKey = (actor: PendingComparison["actor"]) =>
  JSON.stringify([actor.mode, actor.email]);
export function rememberPendingComparison(pending: PendingComparison) {
  sessionComparisons.set(actorKey(pending.actor), pending);
}
export function sessionPendingComparison(
  actor: Pick<WorkspaceStore, "mode" | "email">,
): PendingComparison | null {
  return sessionComparisons.get(actorKey(actor)) || null;
}
export function forgetPendingComparison(pending: PendingComparison) {
  const key = actorKey(pending.actor);
  if (sessionComparisons.get(key)?.record.id === pending.record.id)
    sessionComparisons.delete(key);
}

const payloadHash = (data: EvidenceObject) =>
  digest(new TextEncoder().encode(JSON.stringify(data)));

export async function pendingComparison(
  output: EvidenceObject,
  title: string,
  course: WorkspaceRecord,
  store: Pick<WorkspaceStore, "mode" | "email">,
  historyVersion: string,
): Promise<PendingComparison> {
  // Detach the original computed output from later UI work. Do not allocate a
  // second audit ID when a commit response is lost.
  const data = JSON.parse(JSON.stringify(output));
  return {
    record: newRecord("audit", title, data, course.id),
    payloadSha256: await payloadHash(data),
    computedAt: new Date().toISOString(),
    course: { ...course },
    historyVersion,
    actor: { mode: store.mode, email: store.email },
  };
}

async function matchingReceipt(
  pending: PendingComparison,
  saved: WorkspaceRecord,
): Promise<WorkspaceRecord> {
  const expected = pending.record;
  if (
    saved.id !== expected.id ||
    saved.kind !== "audit" ||
    saved.packageId !== expected.packageId ||
    saved.title !== expected.title ||
    saved.version !== expected.version + 1 ||
    !saved.updatedAt ||
    !saved.updatedBy ||
    (await payloadHash(saved.data)) !== pending.payloadSha256
  )
    throw Error(
      "This report ID exists with different evidence or an invalid save receipt. Your completed comparison remains downloadable. Do not overwrite it; download the local copy and ask an administrator to inspect this ID.",
    );
  return saved;
}

/** GET first. An uncertain read is not evidence of absence and never permits a
 * write. Only an explicit not-found followed by fresh history allows a retry. */
export async function recoverComparisonSave(
  pending: PendingComparison,
  store: WorkspaceStore,
  historyVersion: (records: WorkspaceRecord[], courseId: string) => string,
  onRecords?: (records: WorkspaceRecord[]) => void,
  signal?: AbortSignal,
): Promise<WorkspaceRecord> {
  if (pending.actor.mode !== store.mode || pending.actor.email !== store.email)
    throw Error(
      "Reconnect the workspace account that computed this comparison before checking its save. The local downloads remain available.",
    );
  signal?.throwIfAborted();
  if ((await payloadHash(pending.record.data)) !== pending.payloadSha256)
    throw Error(
      "The browser recovery copy changed after comparison. No shared write was attempted. Preserve its local download and run a fresh comparison after discarding this recovery copy.",
    );
  let existing: WorkspaceRecord | undefined;
  try {
    existing = await store.get(pending.record.id);
    if (!existing)
      throw Error("The service did not provide a valid saved report response.");
  } catch (error) {
    const absent =
      ((error as { status?: number })?.status === 404 &&
        error instanceof Error &&
        /(?:^|HTTP 404\. )Record not found\.(?: Cloudflare Ray ID: [A-Za-z0-9-]{1,100}\.)?$/.test(
          error.message,
        )) ||
      (store.mode === "local" &&
        error instanceof Error &&
        error.message === "Record not found.");
    if (!absent) throw error;
  }
  signal?.throwIfAborted();
  if (existing) return matchingReceipt(pending, existing);
  if (store.role === "viewer")
    throw Error(
      "The saved report was not found. An editor or administrator must retry this same comparison ID; your account is read-only.",
    );
  const records = await store.list();
  signal?.throwIfAborted();
  onRecords?.(records);
  const course = records.find((record) => record.id === pending.course.id);
  if (
    !course ||
    course.kind !== "package" ||
    course.version !== pending.course.version ||
    historyVersion(records, pending.course.id) !== pending.historyVersion
  )
    throw Error(
      "Saved course evidence or ingestion history changed after this comparison. Its local downloads remain available. Keep this result for reference, then discard this local recovery copy before running a fresh comparison against the updated history.",
    );
  const saved = await store.save(pending.record, { signal });
  return matchingReceipt(pending, saved);
}

export function unconfirmedComparisonExport(pending: PendingComparison) {
  const saveStatus = {
    status: "SAVE_UNCONFIRMED",
    sharedSaveConfirmed: false,
    auditId: pending.record.id,
    packageId: pending.record.packageId,
    payloadSha256: pending.payloadSha256,
    computedAt: pending.computedAt,
    savedFollowUpsIncluded: false,
    unsavedItemEditsIncluded: false,
    ...(pending.lastSaveFailure
      ? { lastSaveFailure: workspaceFailureDiagnostic(pending.lastSaveFailure) }
      : {}),
  };
  return {
    evidence: { ...pending.record.data, localComparisonRecovery: saveStatus },
    text: [
      "COMPARISON COMPLETED; SHARED SAVE UNCONFIRMED",
      `Course: ${pending.course.title}`,
      `Report ID: ${pending.record.id}`,
      `Computed: ${pending.computedAt}`,
      `Computed payload SHA-256: ${pending.payloadSha256}`,
      "This is the computed comparison retained in this browser session. It is not confirmation of a shared save. Saved follow-ups and unsaved item edits are not included.",
      "The JSON download retains the complete computed evidence.",
      ...(pending.lastSaveFailure
        ? [
            `Last save/read failure: ${pending.lastSaveFailure.code} | phase: ${pending.lastSaveFailure.phase}`,
            pending.lastSaveFailure.message,
          ]
        : []),
      "",
      typeof pending.record.data.report === "string"
        ? pending.record.data.report
        : JSON.stringify(pending.record.data.result || {}, null, 2),
    ].join("\n"),
  };
}
