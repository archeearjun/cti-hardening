import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  generateAssignmentDeliverable,
  importAssignmentDeliverable,
  validateAssignmentDeliverableArtifact,
  type AssignmentDeliverableArtifact,
} from "./assignment-deliverables.ts";
import {
  assignmentBasis,
  assignmentHandoff,
  evaluateAssignment,
  latestAssignmentAudit,
  loadAssignmentEvidence,
} from "./assignment-plan.ts";
import { buildAssignmentItems } from "./item-lifecycle.ts";
import { prepareOwnerReportExport } from "./owner-report-export.ts";
import { ownerScope } from "./owner-scope.ts";
import { validateContentSnapshot } from "./content-evidence.ts";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import type { WorkspaceRecord } from "./workspace-types.ts";
import type { WorkspaceStore } from "./workspace-store.ts";

type Obj = Record<string, any>;
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(directCanonicalSourceTextV1(v))));
const textHash = (v: string) => bytesToHex(sha256(new TextEncoder().encode(v)));
export const MAX_ASSIGNMENT_AGENT_HANDOFF_BYTES = 32 * 1024 * 1024;
const failure = () =>
  Error(
    "Assignment evidence changed while preparing the agent packet. Refresh the assignment and retry.",
  );
const abort = (signal?: AbortSignal) => signal?.throwIfAborted();

export interface AgentBinaryOmission {
  path: string;
  reason: "ARCHIVED_BINARY_BODY_NOT_EMBEDDED";
  sourceSha256: string;
  declaredBytes: number | null;
}
export interface AssignmentAgentHandoffPacket {
  kind: "CTI_ASSIGNMENT_AGENT_EVIDENCE_PACKET";
  schemaVersion: 1;
  preparedAt: string;
  identity: {
    courseId: string;
    courseVersion: number;
    auditId: string;
    auditVersion: number;
    basisHash: string;
    sourceScanSha256: string;
    inputHashes: Record<string, string>;
    records: { id: string; version: number; updatedAt: string; kind: string }[];
  };
  structuralArtifact: AssignmentDeliverableArtifact;
  scope: {
    sourceInventoryKind: "package" | "document";
    sourceScope: string;
    automaticDefaultsAreOwnerApproval: false;
    entries: {
      memberId: string;
      platform: string;
      nativeId: string;
      includedInWorklist: boolean;
      origin: "OWNER_OVERRIDE" | "AUTOMATIC_DEFAULT";
      choice: string;
      reason: string;
      reviewRecordId: string;
      reviewUpdatedAt: string;
    }[];
  };
  readiness: {
    reconciliationCurrent: boolean;
    outlinePrerequisitesRecorded: boolean;
    blockers: string[];
    generatedOutputIsSource: false;
    lmsApplicationVerified: false;
  };
  originalArchives: {
    platform: string;
    inputSha256: string;
    transport: Obj | null;
    requiredForOriginalBinaryReview: true;
  }[];
  omissions: AgentBinaryOmission[];
  ownerReport: { text: string; taskHandoff: string };
  richEvidence: Obj;
  agentInstructions: {
    returnOnly: "structuralArtifact";
    allowedChanges: string[];
    immutableEvidence: true;
    generatedProposalsAreSourceOriginals: false;
    binaryBytesEmbedded: false;
    limitations: string[];
  };
  integrity: {
    structuralArtifactSha256: string;
    richEvidenceSha256: string;
    ownerReportTextSha256: string;
    packetSha256: string;
  };
}

/** Drop separately stored binary representations, never source text/raw JSON
 * strings. A literal source example/data URI remains the original source text.
 * Descriptors and the exact path of each omission stay explicit. */
function projectWithoutBinary(
  value: unknown,
  omissions: AgentBinaryOmission[],
  rootPath = "",
): any {
  const active = new WeakSet<object>();
  let nodes = 0,
    characters = 0;
  const omit = (path: string, parent: Obj | undefined) => {
    omissions.push({
      path,
      reason: "ARCHIVED_BINARY_BODY_NOT_EMBEDDED",
      sourceSha256:
        typeof parent?.sha256 === "string"
          ? parent.sha256
          : typeof parent?.originalRef === "string"
            ? parent.originalRef
            : "",
      declaredBytes: Number.isSafeInteger(parent?.size)
        ? parent!.size
        : Number.isSafeInteger(parent?.bytes)
          ? parent!.bytes
          : null,
    });
  };
  const walk = (entry: any, path: string, depth: number, parent?: Obj): any => {
    if (++nodes > 1_000_000 || depth > 64)
      throw Error(
        "Agent evidence exceeds the packet review limit; no content was truncated.",
      );
    if (typeof entry === "string") {
      characters += entry.length;
      if (characters > MAX_ASSIGNMENT_AGENT_HANDOFF_BYTES)
        throw Error(
          "Agent evidence exceeds the 32 MiB packet limit. Keep the full owner report and original archives separately; no content was truncated.",
        );
      return entry;
    }
    if (entry === undefined) return undefined;
    if (entry === null || typeof entry === "boolean") return entry;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry))
        throw Error("Invalid numeric agent evidence.");
      return entry;
    }
    if (
      ArrayBuffer.isView(entry) ||
      entry instanceof ArrayBuffer ||
      (typeof Blob !== "undefined" && entry instanceof Blob)
    ) {
      omit(path, parent);
      return undefined;
    }
    if (typeof entry !== "object" || active.has(entry))
      throw Error("Invalid or cyclic agent evidence.");
    const prototype = Object.getPrototypeOf(entry);
    if (
      (!Array.isArray(entry) &&
        prototype !== Object.prototype &&
        prototype !== null) ||
      Object.getOwnPropertySymbols(entry).length
    )
      throw Error("Unsupported agent evidence value.");
    active.add(entry);
    const out: any = Array.isArray(entry) ? [] : {};
    for (const key of Object.keys(entry)) {
      const d = Object.getOwnPropertyDescriptor(entry, key);
      if (!d || !("value" in d))
        throw Error("Unsupported agent evidence accessor.");
      const nextPath =
          path + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"),
        v = d.value;
      const binaryDescriptor =
        typeof entry.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(entry.sha256) &&
        (Number.isSafeInteger(entry.size) ||
          Number.isSafeInteger(entry.bytes)) &&
        (typeof entry.mime === "string" ||
          typeof entry.contentType === "string" ||
          /ORIGINAL_BINARY/.test(entry.receipt?.bodyFormat || ""));
      if (
        binaryDescriptor &&
        ((key === "base64" && typeof v === "string") ||
          (key === "bytes" && Array.isArray(v)))
      ) {
        omit(nextPath, entry);
        continue;
      }
      const child = walk(v, nextPath, depth + 1, entry);
      if (child !== undefined) {
        if (Array.isArray(out)) out.push(child);
        else
          Object.defineProperty(out, key, {
            value: child,
            writable: true,
            configurable: true,
            enumerable: true,
          });
      }
    }
    active.delete(entry);
    return out;
  };
  return walk(value, rootPath, 0);
}

function recordToken(records: WorkspaceRecord[], courseId: string): string {
  const relevant = records.filter(
    (r) => r.id === courseId || r.packageId === courseId,
  );
  const ids = new Set<string>();
  for (const record of relevant) {
    if (
      !record.id ||
      ids.has(record.id) ||
      !Number.isSafeInteger(record.version) ||
      record.version < 1
    )
      throw failure();
    ids.add(record.id);
  }
  // Store listings deliberately omit large bodies. Immutable record versions
  // identify those bodies; selected relation fields bind this listing's scope.
  return hash(
    JSON.parse(
      JSON.stringify(
        relevant
          .map((r) => ({
            id: r.id,
            kind: r.kind,
            packageId: r.packageId,
            version: r.version,
            updatedAt: r.updatedAt,
            data: {
              type: r.data.type,
              runId: r.data.runId,
              auditId: r.data.auditId,
              auditVersion: r.data.auditVersion,
              platform: r.data.platform,
              sourceHash: r.data.sourceHash,
              basisHash: r.data.basisHash,
              sourceScanSha256: r.data.sourceScanSha256,
              hashes: r.data.hashes,
              deliverableKind: r.data.deliverableKind,
              revision: r.data.revision,
              event: r.data.event,
              generation: r.data.generation,
              declaredAt: r.data.declaredAt,
              scanSha256: r.data.scan?.fileSha256,
            },
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    ),
  );
}
function recordIdentity(record: WorkspaceRecord) {
  return {
    id: record.id,
    version: record.version,
    updatedAt: record.updatedAt,
    kind: record.kind,
  };
}
function packetDigest(packet: AssignmentAgentHandoffPacket): string {
  const { packetSha256: _digest, ...other } = packet.integrity;
  return hash({ ...packet, integrity: other });
}

/** A read-only transport packet. It is not the import format, source archive,
 * approval or LMS application. The agent returns the inner structural artifact
 * using the existing proposed-only revision contract. */
export async function prepareAssignmentAgentHandoff(
  course: WorkspaceRecord,
  audit: WorkspaceRecord,
  artifact: AssignmentDeliverableArtifact,
  store: Pick<WorkspaceStore, "get" | "list">,
  signal?: AbortSignal,
): Promise<{ packet: AssignmentAgentHandoffPacket; json: string }> {
  abort(signal);
  validateAssignmentDeliverableArtifact(artifact);
  const requested = structuredClone(artifact),
    expected = {
      courseId: course.id,
      courseVersion: course.version,
      auditId: audit.id,
      auditVersion: audit.version,
    };
  const [courseRead, auditRead, recordsRead] = await Promise.all([
    store.get(course.id),
    store.get(audit.id),
    store.list(),
  ]);
  abort(signal);
  const currentCourse = structuredClone(courseRead),
    currentAudit = structuredClone(auditRead),
    records = structuredClone(recordsRead);
  const listedCourse = records.filter((r) => r.id === currentCourse.id),
    listedAudit = records.filter((r) => r.id === currentAudit.id);
  if (
    currentCourse.kind !== "package" ||
    currentAudit.kind !== "audit" ||
    currentCourse.id !== expected.courseId ||
    currentAudit.id !== expected.auditId ||
    currentCourse.version !== expected.courseVersion ||
    currentAudit.version !== expected.auditVersion ||
    currentAudit.packageId !== currentCourse.id ||
    listedCourse.length !== 1 ||
    listedAudit.length !== 1 ||
    listedCourse[0].version !== currentCourse.version ||
    listedAudit[0].version !== currentAudit.version ||
    listedCourse[0].updatedAt !== currentCourse.updatedAt ||
    listedAudit[0].updatedAt !== currentAudit.updatedAt ||
    latestAssignmentAudit(currentCourse.id, records)?.id !== currentAudit.id ||
    latestAssignmentAudit(currentCourse.id, records)?.version !==
      currentAudit.version
  )
    throw failure();
  const token = recordToken(records, currentCourse.id),
    fullAudit = await loadAssignmentEvidence(currentAudit.id, store, records);
  abort(signal);
  if (
    fullAudit.id !== currentAudit.id ||
    fullAudit.version !== currentAudit.version ||
    fullAudit.packageId !== currentCourse.id ||
    hash((fullAudit.data as Obj).hashes || {}) !==
      hash(currentAudit.data.hashes || {})
  )
    throw failure();
  const freshBasis = generateAssignmentDeliverable(
      currentCourse,
      fullAudit,
      records,
      requested.kind,
    ),
    structuralArtifact = importAssignmentDeliverable(requested, freshBasis);
  const exported = await prepareOwnerReportExport(
    currentAudit.data,
    currentAudit.id,
    currentCourse,
    store,
    signal,
  );
  abort(signal);
  validateContentSnapshot(exported.followUp.contentEvidence);
  const items = buildAssignmentItems(currentCourse, fullAudit),
    itemMap = new Map(items.map((item) => [item.id, item]));
  const scope = structuralArtifact.members.map((member) => {
    const item = itemMap.get(member.memberId);
    if (
      !item ||
      item.nativeId !== member.nativeId ||
      item.platform !== member.platform
    )
      throw failure();
    const matches = item.task
      ? exported.followUp.reviews.filter((r) => r.itemKey === item.task!.key)
      : [];
    if (matches.length > 1)
      throw Error(
        "Conflicting saved owner scope decisions. Resolve the exact item reviews before preparing the packet.",
      );
    const review = matches[0],
      observed = ownerScope(
        item.task || {
          path: item.path,
          findings: [],
          sourceOnly: item.platform !== "coursera",
        },
        review,
      );
    const explicit =
      review?.relevance === "relevant" || review?.relevance === "not_relevant";
    return {
      memberId: member.memberId,
      platform: member.platform,
      nativeId: member.nativeId,
      includedInWorklist: observed.included,
      origin: explicit
        ? ("OWNER_OVERRIDE" as const)
        : ("AUTOMATIC_DEFAULT" as const),
      choice: observed.choice,
      reason: observed.reason,
      reviewRecordId: explicit ? review.recordId : "",
      reviewUpdatedAt: explicit ? review.updatedAt : "",
    };
  });
  const evaluation = evaluateAssignment(currentCourse, fullAudit, records),
    omissions: AgentBinaryOmission[] = [];
  const { contentEvidence, ...followUps } = exported.followUp;
  const richEvidence = projectWithoutBinary(
    {
      contentEvidence,
      followUp: {
        ...followUps,
        contentEvidenceRef: "/richEvidence/contentEvidence",
      },
      comparison: {
        result: currentAudit.data.result,
        ownerContext: currentAudit.data.ownerContext || null,
      },
      lifecycle: fullAudit.data.assignmentLifecycleEvidence || null,
    },
    omissions,
    "/richEvidence",
  );
  // Binary omission must not invalidate any retained question/provider/source
  // proof. Refuse an unusable packet instead of exporting a misleading subset.
  validateContentSnapshot(richEvidence.contentEvidence);
  const originalArchives = [
    {
      platform:
        freshBasis.sourceInventoryKind === "document"
          ? "source-document"
          : "source-package",
      inputSha256: freshBasis.sourceScanSha256,
      transport: null,
      requiredForOriginalBinaryReview: true as const,
    },
    ...["coursera", "brightspace"].flatMap((platform) => {
      const key = platform === "coursera" ? "json" : "brightspace",
        inputSha256 = freshBasis.inputHashes[key];
      return inputSha256
        ? [
            {
              platform,
              inputSha256,
              transport: currentAudit.data.captureTransport?.[key] || null,
              requiredForOriginalBinaryReview: true as const,
            },
          ]
        : [];
    }),
  ];
  const packet: AssignmentAgentHandoffPacket = {
    kind: "CTI_ASSIGNMENT_AGENT_EVIDENCE_PACKET",
    schemaVersion: 1,
    preparedAt: new Date().toISOString(),
    identity: {
      courseId: currentCourse.id,
      courseVersion: currentCourse.version,
      auditId: currentAudit.id,
      auditVersion: currentAudit.version,
      basisHash: freshBasis.basisHash,
      sourceScanSha256: freshBasis.sourceScanSha256,
      inputHashes: freshBasis.inputHashes,
      records: records
        .filter(
          (r) => r.id === currentCourse.id || r.packageId === currentCourse.id,
        )
        .map(recordIdentity)
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
    structuralArtifact,
    scope: {
      sourceInventoryKind: freshBasis.sourceInventoryKind,
      sourceScope: freshBasis.sourceScope,
      automaticDefaultsAreOwnerApproval: false,
      entries: scope,
    },
    readiness: {
      reconciliationCurrent: evaluation.reconciled,
      outlinePrerequisitesRecorded: evaluation.outlineReady,
      blockers: [...evaluation.blockers],
      generatedOutputIsSource: false,
      lmsApplicationVerified: false,
    },
    originalArchives,
    omissions,
    ownerReport: {
      text: exported.text,
      taskHandoff: assignmentHandoff(currentCourse, fullAudit, records),
    },
    richEvidence,
    agentInstructions: {
      returnOnly: "structuralArtifact",
      allowedChanges: [
        "members order",
        "members[].proposed.title",
        "members[].proposed.path",
        "members[].proposed.action",
        "members[].proposed.note",
        "members[].proposed.mappedMemberIds",
      ],
      immutableEvidence: true,
      generatedProposalsAreSourceOriginals: false,
      binaryBytesEmbedded: false,
      limitations: [
        "Return only the inner structuralArtifact using CTI's existing proposed-only revision format; the outer packet is read-only evidence and is not an import artifact.",
        "Every inventory member remains, including excluded/reference items. Automatic folder defaults are not owner-approved active source scope or learner visibility; request owner review before treating them as approved omission.",
        "Preserve source original, attached authoring draft, current published body and derived CTI checks as separate observations. Draft definitions and calculated checks do not become current published questions or authored source keys.",
        "Unknown, unsupported, access-failed, source-authored placeholder and explicit empty observations remain distinct. Do not invent unseen content, outcomes, answers, links or media.",
        "This packet contains validated retained evidence and original-file descriptors, not a complete raw capture archive. Original binary bytes are not embedded; attach the exact original archives separately when byte review is required.",
        "Owner review and recorded reconciliation do not certify whole extraction, keys, media playback, interaction, learner access or applied LMS changes. Post-edit verification requires fresh evidence and comparison.",
      ],
    },
    integrity: {
      structuralArtifactSha256: hash(structuralArtifact),
      richEvidenceSha256: hash(richEvidence),
      ownerReportTextSha256: textHash(exported.text),
      packetSha256: "",
    },
  };
  const projectedPacket = projectWithoutBinary(
    packet,
    omissions,
  ) as AssignmentAgentHandoffPacket;
  projectedPacket.integrity.packetSha256 = packetDigest(projectedPacket);
  const json = JSON.stringify(projectedPacket, null, 2);
  if (
    new TextEncoder().encode(json).length > MAX_ASSIGNMENT_AGENT_HANDOFF_BYTES
  )
    throw Error(
      "Agent evidence exceeds the 32 MiB packet limit. Keep the complete owner report and original archives separately; no packet was truncated.",
    );
  const [lastRecords, lastCourse, lastAudit] = await Promise.all([
    store.list(),
    store.get(currentCourse.id),
    store.get(currentAudit.id),
  ]);
  abort(signal);
  if (
    recordToken(lastRecords, currentCourse.id) !== token ||
    lastCourse.version !== currentCourse.version ||
    lastAudit.version !== currentAudit.version ||
    lastCourse.id !== currentCourse.id ||
    lastAudit.id !== currentAudit.id ||
    lastCourse.kind !== "package" ||
    lastAudit.kind !== "audit" ||
    lastAudit.packageId !== currentCourse.id ||
    lastCourse.updatedAt !== currentCourse.updatedAt ||
    lastAudit.updatedAt !== currentAudit.updatedAt ||
    lastCourse.data.scan?.fileSha256 !== currentCourse.data.scan?.fileSha256 ||
    hash(lastAudit.data.hashes || {}) !==
      hash(currentAudit.data.hashes || {}) ||
    assignmentBasis(lastCourse, fullAudit, lastRecords) !== freshBasis.basisHash
  )
    throw failure();
  return { packet: projectedPacket, json };
}
