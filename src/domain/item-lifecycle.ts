import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { buildOwnerTasks, type OwnerTask } from "./owner-actions.ts";
import { capturedContent } from "./content-evidence.ts";
import type { EvidenceObject, WorkspaceRecord } from "./workspace-types.ts";
import type { WorkspaceStore } from "./workspace-store.ts";

export const ITEM_STAGES = [
  "inventory",
  "reconciliation",
  "transformation",
  "verification",
  "delivery",
] as const;
export const ITEM_DECISIONS = [
  "open",
  "in-progress",
  "changed",
  "checked",
  "blocked",
  "excluded",
] as const;
export interface ItemEvidenceBasis {
  auditId: string;
  auditVersion: number;
  sourceScanSha256: string;
  inputHashes: Record<string, string>;
  fingerprint: string;
}
export interface AssignmentItem {
  courseId: string;
  id: string;
  key: string;
  platform: "coursera" | "source" | "brightspace";
  nativeId: string;
  name: string;
  path: string;
  type: string;
  task?: OwnerTask;
  basis: ItemEvidenceBasis;
  captureCoverage: "complete" | "partial" | "empty" | "unverified";
  fidelity: "verified" | "differences" | "unverified";
  identityStatus: "exact" | "ambiguous";
  sourceIds: string[];
  destinationIds: string[];
  assets: { id: string; kind: string; url: string }[];
}
export interface ItemMembership {
  deliverableId: string;
  revision: number;
  kind:
    | "content-map"
    | "course-outline"
    | "specialization-outline"
    | "transformation-plan";
  memberId: string;
  state: "included" | "removed";
}
export interface ItemMapping {
  sourceIds: string[];
  destinationIds: string[];
  relation: "one-to-one" | "one-to-many" | "many-to-one" | "reuse";
}
export interface LifecycleChange {
  kind:
    | "stage"
    | "decision"
    | "membership"
    | "mapping-confirmed"
    | "mapping-rejected"
    | "transformation";
  stage?: (typeof ITEM_STAGES)[number];
  decision?: (typeof ITEM_DECISIONS)[number];
  note: string;
  membership?: ItemMembership;
  mapping?: ItemMapping;
  observedAt?: string;
}
export interface LifecycleEvent extends LifecycleChange {
  eventId: string;
  sequence: number;
  courseId: string;
  itemId: string;
  platform: AssignmentItem["platform"];
  nativeId: string;
  actor: string;
  recordedAt: string;
  observedAt: string;
  basis: ItemEvidenceBasis;
}
export interface ItemLifecycleData {
  type: "item-lifecycle";
  schemaVersion: 1;
  courseId: string;
  events: LifecycleEvent[];
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
const hash = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(canonical(value))));
const list = (value: unknown): EvidenceObject[] =>
  Array.isArray(value) ? value : [];
const native = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
function assetReference(url: string) {
  const parsed = new URL(url),
    recordingId = /\/Panopto\/Pages\/(?:Embed|Viewer)\.aspx$/i.test(
      parsed.pathname,
    )
      ? parsed.searchParams.get("id")
      : null;
  return {
    id:
      "asset-" +
      hash(
        recordingId
          ? [parsed.hostname.toLowerCase(), recordingId.toLowerCase()]
          : url,
      ),
    kind: recordingId ? "panopto-recording" : "source-reference",
    url,
  };
}
export function assignmentItemId(
  courseId: string,
  platform: AssignmentItem["platform"],
  nativeId: string,
): string {
  if (!courseId || !nativeId || nativeId.length > 2000)
    throw Error("An exact course and native item identity are required.");
  return "item-" + hash([courseId, platform, nativeId]);
}
export function itemLifecycleRecordId(courseId: string): string {
  return "item-lifecycle-" + hash(courseId);
}
export async function lifecycleAuditWithContent(
  audit: WorkspaceRecord,
  lookup: (id: string) => Promise<WorkspaceRecord | undefined>,
): Promise<WorkspaceRecord> {
  const contentEvidence = {
    schemaVersion: 1,
    coursera: [],
    brightspace: [],
    ...(audit.data.contentEvidence || {}),
  };
  for (const platform of ["coursera", "brightspace"] as const) {
    const supplement = await lookup(
      "report-content-" + hash([audit.id, platform]),
    );
    if (!supplement) continue;
    if (
      supplement.kind !== "operations" ||
      supplement.packageId !== audit.packageId ||
      supplement.data.type !== "report-content" ||
      supplement.data.runId !== audit.id ||
      supplement.data.platform !== platform ||
      supplement.data.sourceHash !==
        audit.data.hashes?.[platform === "coursera" ? "json" : "brightspace"]
    )
      throw Error(
        "Original-content supplement does not match the lifecycle report.",
      );
    contentEvidence[platform] = supplement.data.contentEvidence[platform];
  }
  return { ...audit, data: { ...audit.data, contentEvidence } };
}
function auditBasis(course: WorkspaceRecord, audit: WorkspaceRecord | null) {
  if (
    course.kind !== "package" ||
    (audit && (audit.kind !== "audit" || audit.packageId !== course.id))
  )
    throw Error("The item inventory must belong to this course.");
  const inputHashes = Object.fromEntries(
    Object.entries(audit?.data.hashes || {}).filter(
      ([, v]) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v as string),
    ),
  ) as Record<string, string>;
  return {
    auditId: audit?.id || "",
    auditVersion: audit?.version || 0,
    sourceScanSha256: String(
      audit?.data.sourceScanSha256 || course.data.scan?.fileSha256 || "",
    ),
    inputHashes,
  };
}
/** Titles and array positions are labels only. Items without a native identity
 * are deliberately absent from the durable ledger and remain audit exceptions. */
export function buildAssignmentItems(
  course: WorkspaceRecord,
  audit: WorkspaceRecord | null,
): AssignmentItem[] {
  const basis = auditBasis(course, audit),
    result = audit?.data.result || {},
    content = audit?.data.contentEvidence || {};
  const tasks = buildOwnerTasks(
    result,
    course.data.scan?.courseTree || [],
    "",
    list(content.coursera) as any,
  );
  const rows = new Map<string, AssignmentItem>();
  const add = (
    platform: AssignmentItem["platform"],
    nativeId: string,
    label: EvidenceObject,
    task?: OwnerTask,
    captured?: EvidenceObject,
    duplicate = false,
  ) => {
    if (!nativeId || nativeId.length > 2000) return;
    const id = assignmentItemId(course.id, platform, nativeId),
      previous = rows.get(id);
    const sources =
      task?.findings.flatMap((f) =>
        native(f.sourceId) ? [native(f.sourceId)] : [],
      ) || [];
    const refs = [
      ...(Array.isArray(captured?.content?.references)
        ? captured.content.references
        : []),
      ...(task?.pluginTargets || []),
    ];
    const assets = refs
      .filter(
        (url): url is string =>
          typeof url === "string" && /^https?:\/\//.test(url),
      )
      .flatMap((url) => {
        try {
          return [assetReference(url)];
        } catch {
          return [];
        }
      });
    const coverages = [
      captured?.content?.textCoverage,
      captured?.content?.questionCoverage,
    ].filter(Boolean);
    const captureCoverage = !coverages.length
      ? "unverified"
      : coverages.includes("PARTIAL") ||
          coverages.includes("UNVERIFIED") ||
          captured?.content?.limitations?.length
        ? "partial"
        : coverages.every((x) => x === "EMPTY")
          ? "empty"
          : "complete";
    const fingerprint = hash({
      courseId: course.id,
      platform,
      nativeId,
      sourceScanSha256: basis.sourceScanSha256,
      inputHashes: basis.inputHashes,
      evidence: captured || null,
      findings: task?.findings || [],
      checks: task?.checks || [],
      status: task?.status || "",
    });
    rows.set(id, {
      courseId: course.id,
      id,
      key: id,
      platform,
      nativeId,
      name: String(label.name || label.title || "Unnamed item"),
      path: String(label.path || ""),
      type: String(label.type || "Source item"),
      task,
      basis: { ...basis, fingerprint },
      captureCoverage,
      fidelity:
        task?.status === "VERIFIED_EVIDENCE"
          ? "verified"
          : task?.findings.some((f) =>
                ["MISSING", "MISMATCH", "FAIL"].includes(String(f.verdict)),
              )
            ? "differences"
            : "unverified",
      identityStatus: previous || duplicate ? "ambiguous" : "exact",
      sourceIds: platform === "coursera" ? [...new Set(sources)] : [nativeId],
      destinationIds: platform === "coursera" ? [nativeId] : [],
      assets,
    });
  };
  const coursera = list(content.coursera),
    inventory = list(result.ownerView?.items);
  for (const row of inventory) {
    const matches = coursera.filter((c) => native(c.id) === native(row.id));
    add(
      "coursera",
      native(row.id),
      row,
      tasks.find((t) => !t.sourceOnly && t.id === native(row.id)),
      matches.length === 1 ? matches[0] : undefined,
      matches.length > 1,
    );
  }
  for (const row of coursera)
    if (!inventory.some((i) => native(i.id) === native(row.id)))
      add("coursera", native(row.id), row, undefined, row);
  const sourceNodes: EvidenceObject[] = [];
  const walk = (nodes: EvidenceObject[], path: string) => {
    for (const node of nodes) {
      sourceNodes.push({ ...node, path });
      walk(list(node.children), [path, node.title].filter(Boolean).join(" > "));
    }
  };
  walk(list(course.data.scan?.courseTree), "");
  for (const node of sourceNodes) {
    // IMS resource references can be shared. A native organization item ID is
    // the placement identity; idref remains the separate shared resource ID.
    const nativeId = native(node.id) || native(node.idref);
    add(
      "source",
      nativeId,
      node,
      undefined,
      node.sourcePayload
        ? {
            content: capturedContent(node.sourcePayload, {
              source: true,
              basis: "Retained source package",
            }),
          }
        : undefined,
    );
    const item = nativeId
      ? rows.get(assignmentItemId(course.id, "source", nativeId))
      : undefined;
    if (item && node.idref)
      item.assets = [
        {
          id: "source-resource-" + hash([course.id, native(node.idref)]),
          kind: "package-resource",
          url: String(node.href || ""),
        },
      ];
  }
  for (const row of list(content.brightspace))
    add("brightspace", native(row.id), row, undefined, row);
  return [...rows.values()];
}

const text = (v: unknown, max: number, allowEmpty = false): v is string =>
  typeof v === "string" && (allowEmpty || !!v.trim()) && v.length <= max;
const iso = (v: unknown) =>
  typeof v === "string" &&
  v.length <= 40 &&
  /^\d{4}-\d\d-\d\dT/.test(v) &&
  Number.isFinite(Date.parse(v));
function keys(value: object, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw Error(
      "Unsupported lifecycle field. Retain only bounded lifecycle receipts and exact references.",
    );
}
export function validateItemLifecycleData(
  value: unknown,
): asserts value is ItemLifecycleData {
  const d = value as ItemLifecycleData;
  if (
    !d ||
    d.type !== "item-lifecycle" ||
    d.schemaVersion !== 1 ||
    !text(d.courseId, 120) ||
    !Array.isArray(d.events) ||
    d.events.length > 20000
  )
    throw Error("Invalid item lifecycle ledger.");
  keys(d, ["type", "schemaVersion", "courseId", "events"]);
  const ids = new Set<string>();
  for (const [i, e] of d.events.entries()) {
    if (
      !e ||
      !text(e.eventId, 120) ||
      ids.has(e.eventId) ||
      e.sequence !== i + 1 ||
      e.courseId !== d.courseId ||
      !["coursera", "source", "brightspace"].includes(e.platform) ||
      !text(e.nativeId, 2000) ||
      e.itemId !== assignmentItemId(d.courseId, e.platform, e.nativeId) ||
      !text(e.actor, 320) ||
      !iso(e.recordedAt) ||
      !iso(e.observedAt) ||
      !text(e.note, 4000, true) ||
      ![
        "stage",
        "decision",
        "membership",
        "mapping-confirmed",
        "mapping-rejected",
        "transformation",
      ].includes(e.kind)
    )
      throw Error("Invalid lifecycle event identity or receipt.");
    ids.add(e.eventId);
    keys(e, [
      "kind",
      "stage",
      "decision",
      "note",
      "membership",
      "mapping",
      "eventId",
      "sequence",
      "courseId",
      "itemId",
      "platform",
      "nativeId",
      "actor",
      "recordedAt",
      "observedAt",
      "basis",
    ]);
    const b = e.basis;
    if (
      !b ||
      !text(b.auditId, 120) ||
      !Number.isInteger(b.auditVersion) ||
      b.auditVersion < 1 ||
      !/^[a-f0-9]{64}$/.test(b.sourceScanSha256) ||
      !/^[a-f0-9]{64}$/.test(b.fingerprint) ||
      !b.inputHashes ||
      typeof b.inputHashes !== "object" ||
      Array.isArray(b.inputHashes) ||
      Object.keys(b.inputHashes).length > 20 ||
      Object.entries(b.inputHashes).some(
        ([k, v]) =>
          !text(k, 80) || typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v),
      )
    )
      throw Error("Invalid lifecycle evidence basis.");
    keys(b, [
      "auditId",
      "auditVersion",
      "sourceScanSha256",
      "inputHashes",
      "fingerprint",
    ]);
    if (
      (e.stage !== undefined && !ITEM_STAGES.includes(e.stage)) ||
      (e.decision !== undefined && !ITEM_DECISIONS.includes(e.decision)) ||
      (e.kind === "stage" && !e.stage) ||
      (e.kind === "decision" && !e.decision)
    )
      throw Error("Invalid lifecycle stage or decision.");
    if (
      (e.stage !== undefined && e.kind !== "stage") ||
      (e.decision !== undefined && e.kind !== "decision") ||
      (e.membership !== undefined && e.kind !== "membership") ||
      (e.mapping !== undefined &&
        !["mapping-confirmed", "mapping-rejected", "transformation"].includes(
          e.kind,
        ))
    )
      throw Error("A lifecycle event records one kind of change at a time.");
    if (
      ["checked", "changed", "blocked", "excluded"].includes(
        e.decision || "",
      ) &&
      e.note.trim().length < 10
    )
      throw Error("Record what was checked, changed, excluded or blocked.");
    if (e.membership !== undefined) {
      const m = e.membership;
      if (
        !text(m.deliverableId, 120) ||
        !text(m.memberId, 200) ||
        !Number.isInteger(m.revision) ||
        m.revision < 1 ||
        ![
          "content-map",
          "course-outline",
          "specialization-outline",
          "transformation-plan",
        ].includes(m.kind) ||
        !["included", "removed"].includes(m.state)
      )
        throw Error("Invalid deliverable membership.");
      keys(m, ["deliverableId", "revision", "kind", "memberId", "state"]);
    }
    if (e.kind === "membership" && !e.membership)
      throw Error("A membership event needs an exact deliverable reference.");
    if (e.mapping !== undefined) {
      const m = e.mapping;
      if (
        !m ||
        !["one-to-one", "one-to-many", "many-to-one", "reuse"].includes(
          m.relation,
        ) ||
        ![m.sourceIds, m.destinationIds].every(
          (a) =>
            Array.isArray(a) &&
            a.length > 0 &&
            a.length <= 100 &&
            new Set(a).size === a.length &&
            a.every((id) => text(id, 2000)),
        ) ||
        (m.relation === "one-to-one" &&
          (m.sourceIds.length !== 1 || m.destinationIds.length !== 1)) ||
        (m.relation === "one-to-many" && m.sourceIds.length !== 1) ||
        (m.relation === "many-to-one" && m.destinationIds.length !== 1)
      )
        throw Error("Invalid exact item transformation or mapping.");
      keys(m, ["sourceIds", "destinationIds", "relation"]);
    }
    if (
      ["mapping-confirmed", "mapping-rejected", "transformation"].includes(
        e.kind,
      ) &&
      !e.mapping
    )
      throw Error("An exact source and destination mapping is required.");
  }
}
export function itemDeliverableMemberships(
  item: AssignmentItem,
  records: WorkspaceRecord[],
) {
  const latest = new Map<string, WorkspaceRecord>();
  for (const record of records)
    if (
      record.kind === "operations" &&
      record.packageId === item.courseId &&
      record.data.type === "assignment-deliverable" &&
      Array.isArray(record.data.artifact?.members)
    ) {
      const previous = latest.get(record.data.deliverableId);
      if (!previous || record.data.revision > previous.data.revision)
        latest.set(record.data.deliverableId, record);
    }
  return [...latest.values()].flatMap((record) => {
    const member = record.data.artifact.members.find(
      (m: EvidenceObject) => m.itemKey === item.id,
    );
    return member
      ? [
          {
            deliverableId: record.data.deliverableId,
            revision: record.data.revision,
            kind: record.data.deliverableKind,
            memberId: member.memberId,
            state:
              member.proposed.action === "omit"
                ? ("removed" as const)
                : ("included" as const),
            event: record.data.event,
            auditId: record.data.auditId,
            basisHash: record.data.basisHash,
          },
        ]
      : [];
  });
}
export function itemLifecycleState(
  item: AssignmentItem,
  ledger: WorkspaceRecord | null,
  deliverables: WorkspaceRecord[] = [],
) {
  const history = (ledger?.data.events || []).filter(
    (e: LifecycleEvent) => e.itemId === item.id,
  ) as LifecycleEvent[];
  const current = history.filter(
    (e) => e.basis.fingerprint === item.basis.fingerprint,
  );
  const stages = history.filter((e) => e.kind === "stage"),
    decisions = current.filter((e) => e.kind === "decision");
  const memberships = new Map<string, ItemMembership>();
  for (const event of history)
    if (event.membership)
      memberships.set(
        event.membership.deliverableId + ":" + event.membership.memberId,
        event.membership,
      );
  for (const membership of itemDeliverableMemberships(item, deliverables))
    memberships.set(
      membership.deliverableId + ":" + membership.memberId,
      membership,
    );
  return {
    stage: stages.at(-1)?.stage || "inventory",
    decision: decisions.at(-1)?.decision || "open",
    freshness:
      history.length && !current.length
        ? ("changed" as const)
        : ("current" as const),
    memberships: [...memberships.values()].filter(
      (m) => m.state === "included",
    ),
    mappings: current.filter((e) => e.mapping),
    history,
  };
}
export async function loadItemLifecycle(
  store: Pick<WorkspaceStore, "list" | "get">,
  courseId: string,
): Promise<WorkspaceRecord | null> {
  const candidates = (await store.list()).filter(
    (r) =>
      r.kind === "operations" &&
      r.packageId === courseId &&
      r.data.type === "item-lifecycle",
  );
  if (candidates.length > 1)
    throw Error(
      "Multiple lifecycle ledgers exist for this course. Resolve their identity before continuing.",
    );
  if (!candidates.length) return null;
  const record = await store.get(candidates[0].id);
  validateItemLifecycleData(record.data);
  if (
    record.packageId !== courseId ||
    record.data.courseId !== courseId ||
    record.id !== itemLifecycleRecordId(courseId)
  )
    throw Error("The lifecycle ledger belongs to a different course.");
  return record;
}
export async function appendLifecycleEvent(
  store: WorkspaceStore,
  course: WorkspaceRecord,
  audit: WorkspaceRecord,
  item: AssignmentItem,
  change: LifecycleChange,
  existing?: WorkspaceRecord | null,
): Promise<WorkspaceRecord> {
  if (store.role === "viewer")
    throw Error("Your account has read-only access.");
  const currentCourse = await store.get(course.id),
    savedAudit = await store.get(audit.id);
  const currentAudit = await lifecycleAuditWithContent(
    savedAudit,
    async (id) => {
      try {
        return await store.get(id);
      } catch {
        return undefined;
      }
    },
  );
  if (
    currentCourse.version !== course.version ||
    currentAudit.version !== audit.version ||
    currentAudit.packageId !== course.id
  )
    throw Error(
      "The course or report changed. Refresh before recording this decision.",
    );
  const fresh = buildAssignmentItems(currentCourse, currentAudit).find(
    (i) => i.id === item.id,
  );
  if (
    !fresh ||
    fresh.identityStatus !== "exact" ||
    fresh.basis.fingerprint !== item.basis.fingerprint
  )
    throw Error(
      "This native item is ambiguous or its evidence changed. Refresh before recording a decision.",
    );
  const ledger =
    existing === undefined
      ? await loadItemLifecycle(store, course.id)
      : existing;
  const now = new Date().toISOString();
  const event: LifecycleEvent = {
    ...change,
    eventId: crypto.randomUUID(),
    sequence: (ledger?.data.events?.length || 0) + 1,
    courseId: course.id,
    itemId: item.id,
    platform: item.platform,
    nativeId: item.nativeId,
    actor: store.email || "This browser",
    recordedAt: now,
    observedAt: change.observedAt || now,
    basis: item.basis,
  };
  const data: ItemLifecycleData = {
    type: "item-lifecycle",
    schemaVersion: 1,
    courseId: course.id,
    events: [...(ledger?.data.events || []), event],
  };
  validateItemLifecycleData(data);
  return store.save({
    ...(ledger || {
      id: itemLifecycleRecordId(course.id),
      kind: "operations",
      title: "Item lifecycle",
      packageId: course.id,
      version: 0,
      updatedAt: "",
      updatedBy: "",
    }),
    data,
  });
}

/** Reconciliation is a projection. Old receipts remain present, while approvals
 * against a different evidence fingerprint are excluded from current state. */
export function reconcileItemLifecycle(
  course: WorkspaceRecord,
  audit: WorkspaceRecord | null,
  ledger: WorkspaceRecord | null,
) {
  return buildAssignmentItems(course, audit).map((item) => ({
    ...item,
    lifecycle: itemLifecycleState(item, ledger),
  }));
}
