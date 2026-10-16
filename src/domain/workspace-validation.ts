import type { WorkspaceRecord } from "./workspace-types.ts";
import { normalizeAssignmentPlan } from "./assignment-plan.ts";
import { validateOwnerReview } from "./owner-actions.ts";
import { validateContentSnapshot } from "./content-evidence.ts";
import { validateStoredCourseMetadata } from "./operations.ts";
import {
  buildAssignmentItems,
  itemLifecycleRecordId,
  lifecycleAuditWithContent,
  validateItemLifecycleData,
} from "./item-lifecycle.ts";
import {
  evidenceInputId,
  validateEvidenceInput,
} from "./evidence-input-record.ts";
import {
  assignmentDeliverableRecordId,
  generateAssignmentDeliverable,
  importAssignmentDeliverable,
  validateAssignmentDeliverableData,
} from "./assignment-deliverables.ts";
import { latestAssignmentAudit } from "./assignment-plan.ts";
import {
  validateAdvisoryRecordData,
  validateAdvisoryAuditExample,
} from "./advisory-learning.ts";
const kinds = [
  "package",
  "audit",
  "workbook",
  "checklist",
  "legacy-backup",
  "item-review",
  "operations",
];
export function validateRecord(record: WorkspaceRecord, full = true): void {
  if (
    !record ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(record.id) ||
    !kinds.includes(record.kind) ||
    !Number.isInteger(record.version) ||
    record.version < 0 ||
    typeof record.title !== "string" ||
    record.title.length > 500 ||
    typeof record.packageId !== "string" ||
    record.packageId.length > 120 ||
    !record.data ||
    typeof record.data !== "object" ||
    Array.isArray(record.data)
  )
    throw new Error("Invalid workspace record.");
  if (!full) return;
  if (record.kind === "audit" && record.data.contentEvidence !== undefined)
    validateContentSnapshot(record.data.contentEvidence);
  if (record.kind === "item-review") {
    if (
      !record.packageId ||
      typeof record.data.auditId !== "string" ||
      !record.data.auditId ||
      typeof record.data.itemKey !== "string" ||
      !record.data.itemKey ||
      !record.data.review ||
      typeof record.data.review.note !== "string"
    )
      throw new Error("Invalid item review.");
    validateOwnerReview(record.data.review);
    if (
      record.data.review.panoptoCaptures?.some(
        (c: { itemId: string; auditId: string }) =>
          record.data.itemKey !== `item:${c.itemId}` ||
          record.data.auditId !== c.auditId,
      )
    )
      throw Error("Panopto metadata belongs to a different report or item.");
    if (
      record.data.review.courseraLinkedCaptures?.some(
        (c: { itemId: string }) => record.data.itemKey !== `item:${c.itemId}`,
      )
    )
      throw new Error(
        "Coursera linked-page evidence belongs to a different item.",
      );
  }
  if (record.kind === "package") {
    if (record.data.assignmentPlan !== undefined)
      normalizeAssignmentPlan(record.data.assignmentPlan);
    if (
      !Array.isArray(record.data.scan?.courseTree) ||
      !record.data.scan?.stats
    )
      throw new Error(
        "A source record must contain a complete source tree and scan statistics.",
      );
    const hasMetadata = [
      "partner",
      "owner",
      "status",
      "assignedDate",
      "deadline",
      "driveLink",
    ].some((key) => Object.prototype.hasOwnProperty.call(record.data, key));
    if (hasMetadata) {
      // Historical workspace exports may legitimately have a blank partner.
      // Preserve them on import, but validate every other supplied field. New
      // CTI course creation still requires a partner in the active UI.
      validateStoredCourseMetadata({
        partner: record.data.partner || "Legacy unassigned",
        owner: record.data.owner,
        status: record.data.status,
        assignedDate: record.data.assignedDate,
        deadline: record.data.deadline,
        driveLink: record.data.driveLink,
      });
    }
    if (
      record.data.archived !== undefined &&
      typeof record.data.archived !== "boolean"
    )
      throw new Error("Package archived state must be boolean.");
  }
  if (
    record.kind === "audit" &&
    (!record.packageId ||
      !record.data.result ||
      !Number.isInteger(record.data.generation) ||
      record.data.generation < 0)
  )
    throw new Error(
      "An audit must include its source course, result and ingestion attempt.",
    );
  if (
    record.kind === "workbook" &&
    (!record.data.book?.sheets ||
      !Object.values(record.data.book.sheets).every((s: any) =>
        Array.isArray(s?.values),
      ))
  )
    throw new Error("Invalid saved workbook.");
  if (
    record.kind === "checklist" &&
    (!record.data.evidence ||
      typeof record.data.evidence !== "object" ||
      Array.isArray(record.data.evidence) ||
      !Object.values(record.data.evidence).every((v) => typeof v === "boolean"))
  )
    throw new Error("Invalid saved checklist.");
  if (record.kind === "operations") {
    const type = String(record.data.type || "");
    if (
      ![
        "catalog",
        "planner",
        "runtime-inventory",
        "lineage-repair",
        "report-content",
        "legacy-scan-history",
        "legacy-duplicate-archive",
        "legacy-catalog-map",
        "item-lifecycle",
        "evidence-input",
        "assignment-deliverable",
        "advisory-model",
      ].includes(type)
    )
      throw new Error("Invalid operations record type.");
    if (type === "item-lifecycle") {
      validateItemLifecycleData(record.data);
      if (
        record.packageId !== record.data.courseId ||
        record.id !== itemLifecycleRecordId(record.packageId)
      )
        throw Error("Invalid lifecycle course identity.");
    } else if (type === "evidence-input") {
      validateEvidenceInput(record.data);
      if (
        !record.packageId ||
        record.packageId !== record.data.confirmedCourseId ||
        record.id !== evidenceInputId(record.packageId, record.data)
      )
        throw Error("Invalid evidence input course or original-file identity.");
    } else if (type === "assignment-deliverable") {
      validateAssignmentDeliverableData(record.data);
      if (
        !record.packageId ||
        record.packageId !== record.data.courseId ||
        record.id !==
          assignmentDeliverableRecordId(
            record.data.deliverableId,
            record.data.revision,
          )
      )
        throw Error("Invalid deliverable course or revision identity.");
    } else if (type === "advisory-model") {
      validateAdvisoryRecordData(record.data);
      if (!record.packageId || record.packageId !== record.data.courseId)
        throw Error("Advisory model belongs to a different course.");
    } else if (type === "report-content") {
      if (
        !record.packageId ||
        typeof record.data.runId !== "string" ||
        !record.data.runId ||
        !["coursera", "brightspace"].includes(record.data.platform) ||
        !/^[a-f0-9]{64}$/.test(record.data.sourceHash)
      )
        throw Error("Invalid report content identity.");
      validateContentSnapshot(record.data.contentEvidence);
    } else if (type === "lineage-repair") {
      if (
        !record.packageId ||
        typeof record.data.runId !== "string" ||
        !record.data.runId ||
        !Number.isInteger(record.data.toGeneration) ||
        record.data.toGeneration < 0
      )
        throw new Error("Invalid lineage repair record.");
    } else if (!Array.isArray(record.data.rows)) {
      throw new Error("Operations input records must contain normalized rows.");
    }
  }
}

const immutableOperationTypes = [
  "evidence-input",
  "assignment-deliverable",
  "advisory-model",
];
const protectedOperation = (r: WorkspaceRecord | undefined) =>
  r?.kind === "operations" &&
  [...immutableOperationTypes, "item-lifecycle"].includes(r.data.type);
/** Called at both persistence boundaries, after optimistic version validation.
 * Keeping a previous version is not permission to rewrite its declared history. */
export function validateWorkspaceTransition(
  prior: WorkspaceRecord | undefined,
  next: WorkspaceRecord,
): void {
  if (!prior) return;
  if (
    (protectedOperation(prior) || protectedOperation(next)) &&
    (prior.kind !== next.kind ||
      prior.packageId !== next.packageId ||
      prior.data.type !== next.data.type)
  )
    throw Error("The operation's course and type cannot change.");
  if (
    prior.kind === "operations" &&
    immutableOperationTypes.includes(prior.data.type)
  )
    throw Error(
      "Saved evidence inputs, deliverables and advisory models are immutable. Create a new revision.",
    );
  if (prior.kind === "operations" && prior.data.type === "item-lifecycle") {
    validateItemLifecycleData(prior.data);
    validateItemLifecycleData(next.data);
    if (
      next.data.events.length <= prior.data.events.length ||
      prior.data.events.some(
        (event: unknown, i: number) =>
          JSON.stringify(event) !== JSON.stringify(next.data.events[i]),
      )
    )
      throw Error(
        "Lifecycle history is append-only. Earlier events cannot be rewritten, reordered or removed.",
      );
  }
}

export async function validateOperationalReferences(
  next: WorkspaceRecord,
  lookup: (id: string) => Promise<WorkspaceRecord | undefined>,
  prior?: WorkspaceRecord,
  records: WorkspaceRecord[] = [],
): Promise<void> {
  if (!protectedOperation(next)) return;
  const course = await lookup(next.packageId);
  if (!course || course.kind !== "package")
    throw Error("The operation must reference a saved source course.");
  if (next.data.type === "advisory-model") {
    for (const example of next.data.dataset.examples)
      if (example.pairKind !== "owner-supplied")
        validateAdvisoryAuditExample(
          example,
          await lookup(example.basis.auditId),
        );
    return;
  }
  if (next.data.type === "evidence-input") return;
  const validateBasis = async (basis: any) => {
    const audit = await lookup(basis.auditId);
    const hashes = Object.entries(audit?.data.hashes || {})
      .filter(
        ([, value]) =>
          typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
      )
      .sort();
    if (
      !audit ||
      audit.kind !== "audit" ||
      audit.packageId !== next.packageId ||
      audit.version !== basis.auditVersion ||
      course.data.scan?.fileSha256 !== basis.sourceScanSha256 ||
      audit.data.sourceScanSha256 !== basis.sourceScanSha256 ||
      JSON.stringify(hashes) !==
        JSON.stringify(Object.entries(basis.inputHashes || {}).sort())
    )
      throw Error(
        "The operation's report, source hash or input hashes do not match its saved audit.",
      );
    return audit;
  };
  if (next.data.type === "assignment-deliverable") {
    const audit = await lifecycleAuditWithContent(
      await validateBasis(next.data),
      lookup,
    );
    const baseline = generateAssignmentDeliverable(
      course,
      audit,
      records,
      next.data.deliverableKind,
    );
    importAssignmentDeliverable(next.data.artifact, baseline);
    if (
      ["approved", "external-application-recorded"].includes(next.data.event) &&
      latestAssignmentAudit(course.id, records)?.id !== audit.id
    )
      throw Error(
        "A stale report cannot receive a current deliverable approval or application record.",
      );
    if (next.data.previousRecordId) {
      const previous = await lookup(next.data.previousRecordId);
      if (
        !previous ||
        previous.kind !== "operations" ||
        previous.packageId !== next.packageId ||
        previous.data.type !== "assignment-deliverable" ||
        previous.data.deliverableId !== next.data.deliverableId ||
        previous.data.revision + 1 !== next.data.revision
      )
        throw Error(
          "The deliverable revision does not continue its saved lineage.",
        );
      if (next.data.event === "draft")
        throw Error(
          "A saved deliverable needs a revision, not a new draft event.",
        );
      if (
        ["approved", "rejected", "external-application-recorded"].includes(
          next.data.event,
        ) &&
        previous.data.artifactSha256 !== next.data.artifactSha256
      )
        throw Error(
          "Save the exact revised artifact before recording a decision.",
        );
      if (
        next.data.event === "external-application-recorded" &&
        previous.data.event !== "approved"
      )
        throw Error(
          "Approve this exact deliverable before recording external application.",
        );
    } else if (next.data.revision !== 1 || next.data.event !== "draft")
      throw Error(
        "The first deliverable revision must start with a saved draft.",
      );
    return;
  }
  const inventories = new Map<
    string,
    ReturnType<typeof buildAssignmentItems>
  >();
  for (const event of next.data.events.slice(prior?.data.events?.length || 0)) {
    const audit = await lifecycleAuditWithContent(
      await validateBasis(event.basis),
      lookup,
    );
    if (!inventories.has(audit.id))
      inventories.set(audit.id, buildAssignmentItems(course, audit));
    const items = inventories.get(audit.id)!;
    const item = items.find((row) => row.id === event.itemId);
    if (
      !item ||
      item.identityStatus !== "exact" ||
      item.nativeId !== event.nativeId ||
      item.basis.fingerprint !== event.basis.fingerprint
    )
      throw Error(
        "The lifecycle event's native item or evidence basis does not match the saved report.",
      );
    if (event.mapping) {
      const exactIds = (source: boolean) => {
        const group = items.filter(
          (row) => (row.platform !== "coursera") === source,
        );
        return new Set(
          group
            .filter(
              (row) =>
                row.identityStatus === "exact" &&
                group.filter((candidate) => candidate.nativeId === row.nativeId)
                  .length === 1,
            )
            .map((row) => row.nativeId),
        );
      };
      const sourceIds = exactIds(true),
        destinationIds = exactIds(false);
      if (
        event.mapping.sourceIds.some((id: string) => !sourceIds.has(id)) ||
        event.mapping.destinationIds.some(
          (id: string) => !destinationIds.has(id),
        ) ||
        !(
          item.platform === "coursera"
            ? event.mapping.destinationIds
            : event.mapping.sourceIds
        ).includes(item.nativeId)
      )
        throw Error(
          "Mappings must reference exact source and destination items in this course.",
        );
    }
    if (event.membership) {
      const m = event.membership;
      const deliverable = await lookup(
        assignmentDeliverableRecordId(m.deliverableId, m.revision),
      );
      if (
        !deliverable ||
        deliverable.kind !== "operations" ||
        deliverable.packageId !== next.packageId ||
        deliverable.data.type !== "assignment-deliverable" ||
        deliverable.data.deliverableKind !== m.kind ||
        !deliverable.data.artifact?.members?.some(
          (member: any) =>
            member.memberId === m.memberId &&
            member.itemKey === event.itemId &&
            m.state ===
              (member.proposed?.action === "omit" ? "removed" : "included"),
        )
      )
        throw Error(
          "Membership must reference this exact item in a saved deliverable revision.",
        );
    }
  }
}
export function prepareWorkspaceBackup(value: any): WorkspaceRecord[] {
  if (
    value?.kind !== "CTI_BROWSER_WORKSPACE" ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records)
  )
    throw new Error("Invalid workspace backup.");
  const seen = new Set<string>();
  return value.records.map((r: WorkspaceRecord) => {
    validateRecord(r);
    if (seen.has(r.id)) throw new Error("Duplicate record IDs in backup.");
    seen.add(r.id);
    return { ...r, version: 0 };
  });
}

export const MAX_WORKSPACE_RECORD_BYTES = 32 * 1024 * 1024;
// Run before the first save, not after importing an arbitrary subset.
export function validateImportRecordSizes(records: WorkspaceRecord[]): void {
  const ids = new Set<string>();
  for (const record of records) {
    validateRecord(record);
    if (ids.has(record.id))
      throw new Error(`Duplicate import record ID: ${record.id}.`);
    ids.add(record.id);
    const bytes = new TextEncoder().encode(JSON.stringify(record.data)).length;
    if (bytes > MAX_WORKSPACE_RECORD_BYTES)
      throw new Error(
        `Import stopped before saving: "${record.title}" (${record.id}) is ${(bytes / 1024 / 1024).toFixed(1)} MiB, above the 32 MiB per-record limit. Its data has not been truncated. Keep the export for a targeted migration fix.`,
      );
  }
}
