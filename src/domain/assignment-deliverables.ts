import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assignmentBasis } from "./assignment-plan.ts";
import { capturedContent, type ContentEvidence } from "./content-evidence.ts";
import {
  assignmentItemId,
  buildAssignmentItems,
  type AssignmentItem,
} from "./item-lifecycle.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

export const DELIVERABLE_KINDS = [
  "content-map",
  "course-outline",
  "specialization-outline",
  "transformation-plan",
] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];
export const DELIVERABLE_EVENTS = [
  "draft",
  "revision",
  "approved",
  "rejected",
  "external-application-recorded",
] as const;
export type DeliverableEvent = (typeof DELIVERABLE_EVENTS)[number];
export const DELIVERABLE_LABELS: Record<DeliverableKind, string> = {
  "content-map": "Content map",
  "course-outline": "Course outline",
  "specialization-outline": "Specialization outline",
  "transformation-plan": "Transformation plan",
};
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const hash = (value: string) => bytesToHex(sha256(encoder.encode(value)));
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? "[" + value.map(canonical).join(",") + "]"
    : value !== null && typeof value === "object"
      ? "{" +
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => JSON.stringify(key) + ":" + canonical(value))
          .join(",") +
        "}"
      : (JSON.stringify(value) ?? "null");
const object = (value: unknown): Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const hashValid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const short = (value: unknown, max = 4000): value is string =>
  typeof value === "string" && value.length <= max;
const iso = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw Error(
      "Unexpected deliverable field. Import the CTI structured artifact without extra fields.",
    );
}
export interface DeliverableProposal {
  title: string;
  path: string;
  action: "retain" | "review" | "move" | "rename" | "omit";
  note: string;
  mappedMemberIds: string[];
}
export interface DeliverableMember {
  memberId: string;
  itemKey: string;
  platform: "coursera" | "source" | "brightspace";
  nativeId: string;
  sourceIds: string[];
  destinationIds: string[];
  title: string;
  type: string;
  path: string;
  identityStatus: "exact" | "ambiguous";
  captureCoverage: string;
  fidelity: string;
  retainedText: string | null;
  textCoverage: string;
  textSha256: string | null;
  contentBasis: string;
  capturedAt: string;
  proposed: DeliverableProposal;
}
export interface AssignmentDeliverableArtifact {
  schemaVersion: 1;
  kind: DeliverableKind;
  courseId: string;
  auditId: string;
  auditVersion: number;
  basisHash: string;
  sourceScanSha256: string;
  sourceInventoryKind: "package" | "document";
  sourceScope: string;
  inputHashes: Record<string, string>;
  members: DeliverableMember[];
}
export interface AssignmentDeliverableData {
  type: "assignment-deliverable";
  schemaVersion: 1;
  courseId: string;
  auditId: string;
  auditVersion: number;
  basisHash: string;
  sourceScanSha256: string;
  inputHashes: Record<string, string>;
  deliverableId: string;
  deliverableKind: DeliverableKind;
  revision: number;
  previousRecordId: string | null;
  event: DeliverableEvent;
  createdAt: string;
  createdBy: string;
  note: string;
  artifactSha256: string;
  artifact: AssignmentDeliverableArtifact;
}
function inputHashes(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw Error("Deliverable input identities must be an object.");
  const hashes = object(value);
  if (
    Object.keys(hashes).length > 32 ||
    Object.entries(hashes).some(
      ([key, value]) => !short(key, 120) || (value !== "" && !hashValid(value)),
    )
  )
    throw Error("Deliverable input identities must be SHA-256 hashes.");
  return Object.fromEntries(
    Object.entries(hashes)
      .filter(([, value]) => value !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<string, string>;
}
export function deliverableIdentity(courseId: string, kind: DeliverableKind) {
  return hash(JSON.stringify([courseId, kind]));
}
export function assignmentDeliverableRecordId(
  deliverableId: string,
  revision: number,
) {
  return "deliverable-" + hash(JSON.stringify([deliverableId, revision]));
}
export function deliverableArtifactHash(
  artifact: AssignmentDeliverableArtifact,
) {
  return hash(JSON.stringify(artifact));
}
export function assignmentDeliverableEvidenceHash(
  artifact: AssignmentDeliverableArtifact,
) {
  const { members, ...header } = artifact;
  // The retained body's independently validated SHA-256 binds its literal text;
  // avoid repeatedly hashing multi-megabyte strings while editing proposals.
  return hash(
    canonical([
      header,
      members
        .map(
          ({ proposed: _proposal, retainedText: _body, ...retained }) =>
            retained,
        )
        .sort((a, b) => a.memberId.localeCompare(b.memberId)),
    ]),
  );
}

function retainedContent(
  item: AssignmentItem,
  course: WorkspaceRecord,
  audit: WorkspaceRecord,
): ContentEvidence | null {
  if (item.platform === "coursera" || item.platform === "brightspace") {
    const list = audit.data.contentEvidence?.[item.platform];
    const matches = Array.isArray(list)
      ? list.filter((entry: any) => entry.id === item.nativeId)
      : [];
    return matches.length === 1 ? matches[0].content : null;
  }
  const nodes: any[] = [];
  const walk = (list: any[]) => {
    for (const node of list || []) {
      if (String(node.id || node.idref || "") === item.nativeId)
        nodes.push(node);
      walk(node.children);
    }
  };
  walk(course.data.scan?.courseTree || []);
  return nodes.length === 1
    ? capturedContent(nodes[0].sourcePayload, {
        source: true,
        basis:
          (course.data.scan?.sourceEvidence?.kind ===
          "CTI_SOURCE_DOCUMENT_BASELINE"
            ? "Retained source document section · "
            : "Retained source package · ") + item.nativeId,
      })
    : null;
}

/** A deterministic structural draft, never generated lesson content or a claim
 * that unseen source text, media, assessments or outcomes were captured. */
export function generateAssignmentDeliverable(
  course: WorkspaceRecord,
  audit: WorkspaceRecord,
  records: WorkspaceRecord[],
  kind: DeliverableKind,
): AssignmentDeliverableArtifact {
  if (
    course.kind !== "package" ||
    audit.kind !== "audit" ||
    audit.packageId !== course.id ||
    !DELIVERABLE_KINDS.includes(kind)
  )
    throw Error(
      "Choose this assignment's saved comparison before drafting a deliverable.",
    );
  if (
    !hashValid(course.data.scan?.fileSha256) ||
    audit.data.sourceScanSha256 !== course.data.scan.fileSha256
  )
    throw Error(
      "The comparison must use the current source package before a source-linked draft can be created.",
    );
  const items = buildAssignmentItems(course, audit);
  if (!items.length)
    throw Error(
      "This comparison has no identified item inventory to draft from.",
    );
  const artifact: AssignmentDeliverableArtifact = {
    schemaVersion: 1,
    kind,
    courseId: course.id,
    auditId: audit.id,
    auditVersion: audit.version,
    basisHash: assignmentBasis(course, audit, records),
    sourceScanSha256: course.data.scan.fileSha256,
    sourceInventoryKind:
      course.data.scan.sourceEvidence?.kind === "CTI_SOURCE_DOCUMENT_BASELINE"
        ? "document"
        : "package",
    sourceScope:
      typeof course.data.scan.scope === "string"
        ? course.data.scan.scope
        : "Retained source package inventory. Content completeness is evaluated separately.",
    inputHashes: inputHashes(audit.data.hashes),
    members: items.map((item) => {
      const content = retainedContent(item, course, audit);
      const text = typeof content?.text === "string" ? content.text : null;
      if (text !== null && text.length > 300000)
        throw Error(
          "An item's retained text exceeds the deliverable limit. Keep the full source evidence and resolve this item separately.",
        );
      return {
        memberId: item.id,
        itemKey: item.key,
        platform: item.platform,
        nativeId: item.nativeId,
        sourceIds: item.sourceIds,
        destinationIds: item.destinationIds,
        title: item.name,
        type: item.type,
        path: item.path,
        identityStatus: item.identityStatus,
        captureCoverage: item.captureCoverage,
        fidelity: item.fidelity,
        retainedText: text,
        textCoverage: content?.textCoverage || "UNVERIFIED",
        textSha256: text === null ? null : hash(text),
        contentBasis:
          content?.basis || "Content body not retained in this evidence",
        capturedAt: content?.capturedAt || "",
        proposed: {
          title: item.name,
          path: item.path,
          action:
            item.identityStatus === "ambiguous" || item.fidelity !== "verified"
              ? "review"
              : "retain",
          note: "",
          mappedMemberIds: [],
        },
      };
    }),
  };
  validateAssignmentDeliverableArtifact(artifact);
  return artifact;
}

export function validateAssignmentDeliverableArtifact(
  value: unknown,
): asserts value is AssignmentDeliverableArtifact {
  const a = object(value);
  keys(a, [
    "schemaVersion",
    "kind",
    "courseId",
    "auditId",
    "auditVersion",
    "basisHash",
    "sourceScanSha256",
    "sourceInventoryKind",
    "sourceScope",
    "inputHashes",
    "members",
  ]);
  if (
    a.schemaVersion !== 1 ||
    !DELIVERABLE_KINDS.includes(a.kind) ||
    !short(a.courseId, 200) ||
    !a.courseId ||
    !short(a.auditId, 200) ||
    !a.auditId ||
    !Number.isSafeInteger(a.auditVersion) ||
    a.auditVersion < 1 ||
    !hashValid(a.basisHash) ||
    !hashValid(a.sourceScanSha256) ||
    !["package", "document"].includes(a.sourceInventoryKind) ||
    !short(a.sourceScope, 8000) ||
    !a.sourceScope.trim() ||
    !Array.isArray(a.members) ||
    !a.members.length ||
    a.members.length > 20000
  )
    throw Error("Invalid source-linked deliverable artifact.");
  inputHashes(a.inputHashes);
  const identities = new Set<string>();
  for (const value of a.members) {
    const member = object(value),
      p = object(member.proposed);
    keys(member, [
      "memberId",
      "itemKey",
      "platform",
      "nativeId",
      "sourceIds",
      "destinationIds",
      "title",
      "type",
      "path",
      "identityStatus",
      "captureCoverage",
      "fidelity",
      "retainedText",
      "textCoverage",
      "textSha256",
      "contentBasis",
      "capturedAt",
      "proposed",
    ]);
    keys(p, ["title", "path", "action", "note", "mappedMemberIds"]);
    if (
      !short(member.memberId, 200) ||
      identities.has(member.memberId) ||
      !short(member.itemKey, 300) ||
      member.itemKey !== member.memberId ||
      !["coursera", "source", "brightspace"].includes(member.platform) ||
      !short(member.nativeId, 2000) ||
      !member.nativeId ||
      ![member.sourceIds, member.destinationIds].every(
        (list) =>
          Array.isArray(list) &&
          list.length <= 20000 &&
          list.every((id) => short(id, 2000) && !!id) &&
          new Set(list).size === list.length,
      ) ||
      ![member.title, member.type, member.path, member.contentBasis].every(
        (field) => short(field, 8000),
      ) ||
      !["exact", "ambiguous"].includes(member.identityStatus) ||
      !["complete", "partial", "empty", "unverified"].includes(
        member.captureCoverage,
      ) ||
      !["verified", "differences", "unverified"].includes(member.fidelity) ||
      !["COMPLETE", "PARTIAL", "EMPTY", "UNVERIFIED"].includes(
        member.textCoverage,
      ) ||
      !(member.retainedText === null
        ? member.textSha256 === null
        : short(member.retainedText, 300000) &&
          member.textSha256 === hash(member.retainedText)) ||
      !(member.capturedAt === "" || iso(member.capturedAt)) ||
      !short(p.title, 8000) ||
      !p.title.trim() ||
      !short(p.path, 8000) ||
      !short(p.note, 4000) ||
      !["retain", "review", "move", "rename", "omit"].includes(p.action) ||
      !Array.isArray(p.mappedMemberIds) ||
      p.mappedMemberIds.length > 100 ||
      new Set(p.mappedMemberIds).size !== p.mappedMemberIds.length ||
      !p.mappedMemberIds.every((id: unknown) => short(id, 200) && !!id)
    )
      throw Error(
        "Invalid or duplicated deliverable member. Preserve exact member identities and evidence.",
      );
    if (
      member.memberId !==
      assignmentItemId(a.courseId, member.platform, member.nativeId)
    )
      throw Error(
        "Deliverable member identity does not match its course and native item.",
      );
    identities.add(member.memberId);
  }
  const members = new Map<string, DeliverableMember>(
    a.members.map((member: DeliverableMember) => [member.memberId, member]),
  );
  for (const member of a.members as DeliverableMember[])
    for (const mappedId of member.proposed.mappedMemberIds) {
      const mapped = members.get(mappedId);
      if (
        !mapped ||
        member.memberId === mappedId ||
        (member.platform === "coursera") === (mapped.platform === "coursera")
      )
        throw Error(
          "Proposed mappings must explicitly reference other retained source and destination members.",
        );
    }
  if (encoder.encode(JSON.stringify(value)).byteLength > MAX_ARTIFACT_BYTES)
    throw Error(
      "The deliverable exceeds its 8 MiB bound. No source text was silently truncated.",
    );
}

/** Revised structures may reorder members and change proposals. All retained
 * identities, original text and evidence fields must match the current basis. */
export function importAssignmentDeliverable(
  value: unknown,
  basis: AssignmentDeliverableArtifact,
): AssignmentDeliverableArtifact {
  validateAssignmentDeliverableArtifact(value);
  const { members: expected, ...header } = basis,
    { members: supplied, ...received } = value;
  if (
    Object.keys(header).some(
      (key) =>
        JSON.stringify(
          key === "inputHashes"
            ? inputHashes(received.inputHashes)
            : received[key as keyof typeof received],
        ) !==
        JSON.stringify(
          key === "inputHashes"
            ? inputHashes(header.inputHashes)
            : header[key as keyof typeof header],
        ),
    )
  )
    throw Error(
      "The revised artifact belongs to different assignment evidence. Start from this comparison's current JSON draft.",
    );
  if (supplied.length !== expected.length)
    throw Error(
      "Retain every member ID; use the explicit omit proposal instead of deleting an inventory member.",
    );
  const originals = new Map(
    expected.map((member) => [member.memberId, member]),
  );
  return {
    ...basis,
    members: supplied.map((member) => {
      const original = originals.get(member.memberId);
      if (!original)
        throw Error(
          "An imported member does not match this assignment's exact inventory.",
        );
      const { proposed: _a, ...immutable } = member,
        { proposed: _b, ...protectedFields } = original;
      // Normalize property order before comparison; user JSON object key order is immaterial.
      if (
        Object.keys(protectedFields).some(
          (key) =>
            JSON.stringify(immutable[key as keyof typeof immutable]) !==
            JSON.stringify(
              protectedFields[key as keyof typeof protectedFields],
            ),
        )
      )
        throw Error(
          "A revised artifact changed retained source evidence. Edit proposed fields only.",
        );
      return {
        ...original,
        proposed: {
          title: member.proposed.title,
          path: member.proposed.path,
          action: member.proposed.action,
          note: member.proposed.note,
          mappedMemberIds: [...member.proposed.mappedMemberIds],
        },
      };
    }),
  };
}

/** An explicit rebase copies proposals only. Current evidence always comes from
 * the fresh basis; superseded source observations remain in earlier revisions. */
export function rebaseAssignmentDeliverable(
  previous: AssignmentDeliverableArtifact,
  current: AssignmentDeliverableArtifact,
) {
  validateAssignmentDeliverableArtifact(previous);
  validateAssignmentDeliverableArtifact(current);
  if (previous.courseId !== current.courseId || previous.kind !== current.kind)
    throw Error(
      "Only this assignment's same deliverable kind can carry proposals into current evidence.",
    );
  const oldMembers = new Map(
    previous.members.map((member) => [member.memberId, member]),
  );
  const currentIds = new Set(current.members.map((member) => member.memberId));
  const addedMemberIds: string[] = [],
    changedMemberIds: string[] = [],
    removedMappingIds: string[] = [];
  const members = current.members.map((member) => {
    const old = oldMembers.get(member.memberId);
    if (!old) {
      addedMemberIds.push(member.memberId);
      return structuredClone(member);
    }
    const { proposed: _old, ...oldEvidence } = old,
      { proposed: _current, ...newEvidence } = member;
    if (canonical(oldEvidence) !== canonical(newEvidence))
      changedMemberIds.push(member.memberId);
    const retainedMappings = old.proposed.mappedMemberIds.filter((id) =>
      currentIds.has(id),
    );
    removedMappingIds.push(
      ...old.proposed.mappedMemberIds.filter((id) => !currentIds.has(id)),
    );
    return {
      ...member,
      proposed: { ...old.proposed, mappedMemberIds: retainedMappings },
    };
  });
  // Preserve the owner's proposed order for existing members and append newly
  // identified inventory in its native order, without binding by title.
  const positions = new Map(
    previous.members.map((member, index) => [member.memberId, index]),
  );
  members.sort(
    (a, b) =>
      (positions.get(a.memberId) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(b.memberId) ?? Number.MAX_SAFE_INTEGER),
  );
  const artifact = { ...current, members };
  validateAssignmentDeliverableArtifact(artifact);
  return {
    artifact,
    addedMemberIds,
    changedMemberIds,
    retiredMemberIds: previous.members
      .filter((member) => !currentIds.has(member.memberId))
      .map((member) => member.memberId),
    removedMappingIds: [...new Set(removedMappingIds)],
  };
}

export function validateAssignmentDeliverableData(
  value: unknown,
): asserts value is AssignmentDeliverableData {
  const d = object(value);
  keys(d, [
    "type",
    "schemaVersion",
    "courseId",
    "auditId",
    "auditVersion",
    "basisHash",
    "sourceScanSha256",
    "inputHashes",
    "deliverableId",
    "deliverableKind",
    "revision",
    "previousRecordId",
    "event",
    "createdAt",
    "createdBy",
    "note",
    "artifactSha256",
    "artifact",
  ]);
  validateAssignmentDeliverableArtifact(d.artifact);
  if (
    d.type !== "assignment-deliverable" ||
    d.schemaVersion !== 1 ||
    d.deliverableKind !== d.artifact.kind ||
    d.deliverableId !== deliverableIdentity(d.courseId, d.deliverableKind) ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 1 ||
    !(
      d.previousRecordId === null ||
      (short(d.previousRecordId, 200) && !!d.previousRecordId)
    ) ||
    (d.revision === 1) !== (d.previousRecordId === null) ||
    !DELIVERABLE_EVENTS.includes(d.event) ||
    !iso(d.createdAt) ||
    !short(d.createdBy, 320) ||
    !d.createdBy ||
    !short(d.note, 4000) ||
    (!["draft", "revision"].includes(d.event) && d.note.trim().length < 20) ||
    d.artifactSha256 !== deliverableArtifactHash(d.artifact)
  )
    throw Error("Invalid append-only deliverable revision or decision.");
  if (
    d.event === "approved" &&
    d.artifact.members.some(
      (member: DeliverableMember) => member.identityStatus !== "exact",
    )
  )
    throw Error(
      "Ambiguous native identities cannot receive a structure approval.",
    );
  for (const key of [
    "courseId",
    "auditId",
    "auditVersion",
    "basisHash",
    "sourceScanSha256",
    "inputHashes",
  ] as const)
    if (JSON.stringify(d[key]) !== JSON.stringify(d.artifact[key]))
      throw Error("Deliverable provenance does not match its artifact.");
}

export function deliverableRecords(
  records: WorkspaceRecord[],
  courseId: string,
  kind?: DeliverableKind,
) {
  return records
    .filter(
      (record) =>
        record.kind === "operations" &&
        record.packageId === courseId &&
        record.data.type === "assignment-deliverable" &&
        (!kind || record.data.deliverableKind === kind),
    )
    .sort(
      (a, b) =>
        Number(a.data.revision) - Number(b.data.revision) ||
        a.id.localeCompare(b.id),
    );
}
export function makeAssignmentDeliverableData(
  artifact: AssignmentDeliverableArtifact,
  records: WorkspaceRecord[],
  event: DeliverableEvent,
  note: string,
  createdBy: string,
  createdAt = new Date().toISOString(),
): AssignmentDeliverableData {
  validateAssignmentDeliverableArtifact(artifact);
  const previous = deliverableRecords(
    records,
    artifact.courseId,
    artifact.kind,
  ).at(-1);
  if (!previous && event !== "draft")
    throw Error("Save a draft before recording a revision or owner decision.");
  if (previous && event === "draft")
    throw Error("This deliverable already has a history. Save a new revision.");
  if (
    ["approved", "rejected", "external-application-recorded"].includes(event) &&
    (!previous ||
      previous.data.artifactSha256 !== deliverableArtifactHash(artifact))
  )
    throw Error("Save the revised draft before recording a decision for it.");
  if (
    event === "external-application-recorded" &&
    previous?.data.event !== "approved"
  )
    throw Error(
      "Approve this plan before recording external application. Application still requires a fresh capture and comparison.",
    );
  if (
    event === "approved" &&
    artifact.members.some((member) => member.identityStatus !== "exact")
  )
    throw Error(
      "Resolve ambiguous native identities in the source evidence before approving this structure.",
    );
  const data: AssignmentDeliverableData = {
    type: "assignment-deliverable",
    schemaVersion: 1,
    courseId: artifact.courseId,
    auditId: artifact.auditId,
    auditVersion: artifact.auditVersion,
    basisHash: artifact.basisHash,
    sourceScanSha256: artifact.sourceScanSha256,
    inputHashes: artifact.inputHashes,
    deliverableId: deliverableIdentity(artifact.courseId, artifact.kind),
    deliverableKind: artifact.kind,
    revision: previous ? Number(previous.data.revision) + 1 : 1,
    previousRecordId: previous?.id || null,
    event,
    createdAt,
    createdBy,
    note,
    artifactSha256: deliverableArtifactHash(artifact),
    artifact,
  };
  validateAssignmentDeliverableData(data);
  return data;
}
export function deliverableIsStale(
  data: AssignmentDeliverableData,
  current: AssignmentDeliverableArtifact,
) {
  return (
    data.basisHash !== current.basisHash ||
    data.auditId !== current.auditId ||
    data.auditVersion !== current.auditVersion ||
    assignmentDeliverableEvidenceHash(data.artifact) !==
      assignmentDeliverableEvidenceHash(current)
  );
}

const md = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]{}()#!|])/g, "\\$1");
export function assignmentDeliverableMarkdown(
  artifact: AssignmentDeliverableArtifact,
  decision = "Draft; not approved or verified",
) {
  validateAssignmentDeliverableArtifact(artifact);
  return [
    "# " + DELIVERABLE_LABELS[artifact.kind],
    "",
    md(decision),
    "",
    "Source-linked structural plan. It adds no lesson content or learning outcomes. Owner approval and recorded external application do not verify LMS content. Recapture and compare after any LMS edit.",
    "",
    `Assignment: ${md(artifact.courseId)} · audit: ${md(artifact.auditId)} v${artifact.auditVersion}`,
    `Evidence basis: ${artifact.basisHash}`,
    `Source scan SHA-256: ${artifact.sourceScanSha256}`,
    `Source inventory: ${artifact.sourceInventoryKind} · ${md(artifact.sourceScope)}`,
    ...Object.entries(artifact.inputHashes).map(
      ([key, value]) => `Input ${md(key)} SHA-256: ${value}`,
    ),
    "",
    ...artifact.members.flatMap((member, index) => [
      `## ${index + 1}. ${md(member.proposed.title)}`,
      "",
      `Proposed placement: ${md(member.proposed.path)}`,
      `Proposed action: ${member.proposed.action}${member.proposed.note ? " · " + md(member.proposed.note) : ""}`,
      `Proposed mapping member IDs: ${member.proposed.mappedMemberIds.join(", ") || "No new mapping proposed"}`,
      `Original: ${md(member.title)} · ${md(member.path)} · ${md(member.type)}`,
      `Member: ${member.memberId} · ${member.platform} native ID: ${md(member.nativeId)}`,
      `Source IDs: ${member.sourceIds.map(md).join(", ") || "None bound"} · destination IDs: ${member.destinationIds.map(md).join(", ") || "None bound"}`,
      `Identity: ${member.identityStatus} · capture: ${member.captureCoverage} · fidelity: ${member.fidelity} · text: ${member.textCoverage}`,
      `Text evidence: ${md(member.contentBasis)} · captured at: ${md(member.capturedAt || "Unknown")}`,
      `Retained text SHA-256: ${member.textSha256 || "No text body retained"}`,
      "",
      member.retainedText === null
        ? "No text body retained. This is not evidence that the source was empty."
        : member.retainedText === ""
          ? "Retained text is empty; consult its coverage label."
          : md(member.retainedText),
      "",
    ]),
  ].join("\n");
}
function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function assignmentDeliverableCsv(
  artifact: AssignmentDeliverableArtifact,
) {
  validateAssignmentDeliverableArtifact(artifact);
  const rows = [
    [
      "memberId",
      "platform",
      "nativeId",
      "sourceIds",
      "destinationIds",
      "originalTitle",
      "originalPath",
      "proposedTitle",
      "proposedPath",
      "proposedAction",
      "proposedMappingMemberIds",
      "ownerNote",
      "captureCoverage",
      "fidelity",
      "auditId",
      "basisHash",
    ],
    ...artifact.members.map((member) => [
      member.memberId,
      member.platform,
      member.nativeId,
      member.sourceIds.join(";"),
      member.destinationIds.join(";"),
      member.title,
      member.path,
      member.proposed.title,
      member.proposed.path,
      member.proposed.action,
      member.proposed.mappedMemberIds.join(";"),
      member.proposed.note,
      member.captureCoverage,
      member.fidelity,
      artifact.auditId,
      artifact.basisHash,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
