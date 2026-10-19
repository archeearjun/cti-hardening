import {
  hasVerifiedComparisonStructure,
  sourceBaseline,
} from "./assignment-evidence.ts";
import type { evaluateAssignment } from "./assignment-plan.ts";
import { courseraContentObservedAt } from "./coursera-observation-time.ts";
import { MAX_COURSERA_CAPTURE_JSON_BYTES } from "./coursera-capture-file.ts";
import {
  MAX_COURSERA_ARCHIVE_BYTES,
  MAX_COURSERA_ARCHIVE_ORIGINAL_BYTES,
  MAX_COURSERA_ARCHIVE_PANOPTO_BYTES,
} from "./coursera-capture-archive.ts";
import type { ContentItem } from "./content-evidence.ts";
import type { WorkspaceRecord } from "./workspace-types.ts";

export type AssignmentReadinessPurpose =
  | "orientation"
  | "structural-agent-handoff"
  | "assessment-review"
  | "original-media-verification"
  | "post-edit-verification";
export type PurposeReadinessStatus =
  | "PROVISIONAL"
  | "NEEDS_EVIDENCE"
  | "UNKNOWN";
export interface PurposeReadiness {
  purpose: AssignmentReadinessPurpose;
  label: string;
  status: PurposeReadinessStatus;
  summary: string;
  nextAction: string;
  observations: string[];
  blockers: string[];
  unknowns: string[];
  limitation: string;
}
export interface AssignmentReadiness {
  auditId: string;
  provisional: true;
  purposes: PurposeReadiness[];
}
type Evaluation = ReturnType<typeof evaluateAssignment>;
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown) =>
  typeof v === "string" ? Date.parse(v) : Number.NaN;
const rows = (v: unknown): ContentItem[] =>
  Array.isArray(v) ? v.slice(0, 20000) : [];
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const boundedInteger = (v: unknown, maximum: number, allowZero = false) =>
  Number.isSafeInteger(v) &&
  Number(v) >= (allowZero ? 0 : 1) &&
  Number(v) <= maximum;

/** Validate a saved import-check descriptor, not the unavailable original bytes.
 * Later supplemental proofs are deliberately not loaded by this view. */
function archiveProofRecordValid(
  proof: unknown,
  metadataHash: unknown,
  transport: unknown,
): boolean {
  if (
    !object(proof) ||
    Object.keys(proof).some(
      (key) =>
        ![
          "method",
          "metadataSha256",
          "archiveSha256",
          "archiveBytes",
          "originalBytesStored",
          "originalBodyBytes",
          "fileCount",
          "files",
        ].includes(key),
    ) ||
    proof.method !== "VERIFIED_ORIGINAL_ARCHIVE_FILES" ||
    !hash(metadataHash) ||
    proof.metadataSha256 !== metadataHash ||
    !hash(proof.archiveSha256) ||
    !boundedInteger(proof.archiveBytes, MAX_COURSERA_ARCHIVE_BYTES) ||
    proof.originalBytesStored !== false ||
    !boundedInteger(
      proof.originalBodyBytes,
      MAX_COURSERA_ARCHIVE_ORIGINAL_BYTES,
      true,
    ) ||
    !boundedInteger(proof.fileCount, 20000, true) ||
    !Array.isArray(proof.files) ||
    proof.files.length !== proof.fileCount
  )
    return false;
  const files = new Map<string, { sha256: string; size: number }>();
  let total = 0;
  for (const file of proof.files) {
    if (
      !object(file) ||
      Object.keys(file).some(
        (key) => !["path", "sha256", "size"].includes(key),
      ) ||
      !hash(file.sha256) ||
      file.path !== "files/" + file.sha256 ||
      files.has(file.path) ||
      // Saved descriptors omit kind. A legitimate Panopto original may exceed
      // the ordinary image limit; native ownership is a separate check.
      !boundedInteger(file.size, MAX_COURSERA_ARCHIVE_PANOPTO_BYTES)
    )
      return false;
    total += file.size;
    if (total > MAX_COURSERA_ARCHIVE_ORIGINAL_BYTES) return false;
    files.set(file.path, { sha256: file.sha256, size: file.size });
  }
  if (total !== proof.originalBodyBytes || total > proof.archiveBytes)
    return false;
  if (transport !== undefined) {
    if (
      !object(transport) ||
      transport.encoding !== "zip" ||
      transport.sha256 !== proof.archiveSha256 ||
      transport.bytes !== proof.archiveBytes ||
      !boundedInteger(
        transport.expandedBytes,
        MAX_COURSERA_CAPTURE_JSON_BYTES,
      ) ||
      transport.originalBodyBytes !== total ||
      transport.fileCount !== files.size ||
      !Array.isArray(transport.files) ||
      transport.files.length !== files.size
    )
      return false;
    const seen = new Set<string>();
    for (const file of transport.files) {
      if (!object(file)) return false;
      const saved = files.get(file.path);
      if (
        !saved ||
        seen.has(file.path) ||
        file.sha256 !== saved.sha256 ||
        file.size !== saved.size
      )
        return false;
      seen.add(file.path);
    }
  }
  return true;
}

/** A purpose-specific navigation aid over already loaded, validated evidence.
 * It performs no acquisition, writes no decision, and grants no completeness,
 * publication approval, original-byte availability or runtime certification. */
export function assignmentReadiness(
  course: WorkspaceRecord,
  audit: WorkspaceRecord | null,
  evaluation: Evaluation,
  records: WorkspaceRecord[],
  options: {
    loading?: boolean;
    loadError?: string;
    pendingChanged?: boolean;
  } = {},
): AssignmentReadiness {
  const boundAudit =
    audit?.kind === "audit" && audit.packageId === course.id ? audit : null;
  const baseline = sourceBaseline(course.data.scan);
  const sourceInventory =
    Array.isArray(course.data.scan?.courseTree) &&
    course.data.scan.courseTree.length > 0;
  const snapshot = boundAudit?.data.contentEvidence;
  const coursera = rows(snapshot?.coursera);
  const brightspace = rows(snapshot?.brightspace);
  const content = [...coursera, ...brightspace];
  const ownerRows = Array.isArray(boundAudit?.data.result?.ownerView?.items)
    ? boundAudit.data.result.ownerView.items
    : [];
  const structure = hasVerifiedComparisonStructure(boundAudit);
  const sameSource =
    !!boundAudit &&
    hash(course.data.scan?.fileSha256) &&
    boundAudit.data.sourceScanSha256 === course.data.scan.fileSha256;
  const sourceCapture = hash(boundAudit?.data.hashes?.brightspace);
  const sourceBodyGaps = brightspace.filter(
    (item) =>
      item.content?.sourceBody?.status &&
      !["CAPTURED_ORIGINAL", "CAPTURED"].includes(
        item.content.sourceBody.status,
      ),
  ).length;
  const zeroByteBodies = brightspace.filter(
    (item) =>
      item.content?.sourceBody?.originalIntegrity ===
        "VERIFIED_RETAINED_ORIGINAL" && item.content.sourceBody.bytes === 0,
  ).length;
  const sharedUnknowns = [
    ...(baseline.status === "document"
      ? ["The source baseline is text only; native LMS boundaries are unknown."]
      : []),
    ...(!sourceCapture
      ? ["No live Brightspace capture is attached to this comparison."]
      : []),
  ];
  const loadingUnknown = options.loading
    ? "Evidence and item history are still loading."
    : options.loadError
      ? "Current evidence or item history could not be loaded."
      : "";
  const purposes: PurposeReadiness[] = [];
  function add(value: PurposeReadiness) {
    purposes.push(
      loadingUnknown
        ? {
            ...value,
            status: "UNKNOWN",
            summary: "Current evidence availability is not established.",
            nextAction:
              "Load the current evidence before relying on this view.",
            unknowns: [loadingUnknown, ...value.unknowns],
          }
        : value,
    );
  }

  const canOrient =
    sourceInventory || ownerRows.length > 0 || content.length > 0;
  add({
    purpose: "orientation",
    label: "Understand this title",
    status: canOrient ? "PROVISIONAL" : "UNKNOWN",
    summary: canOrient
      ? "Retained structure or content is available to inspect."
      : "A usable title inventory has not been established.",
    nextAction: canOrient
      ? "Inspect the retained source and the existing item worklist."
      : "Add or inspect the original source evidence.",
    observations: [
      ...(sourceInventory ? ["A source hierarchy is retained."] : []),
      ...(ownerRows.length
        ? [`${ownerRows.length} destination inventory rows are recorded.`]
        : []),
      ...(sourceBodyGaps
        ? [
            `${sourceBodyGaps} source ${sourceBodyGaps === 1 ? "body has" : "bodies have"} recorded acquisition gaps.`,
          ]
        : []),
      ...(zeroByteBodies
        ? [
            `${zeroByteBodies} retained source ${zeroByteBodies === 1 ? "body is" : "bodies are"} explicitly zero bytes.`,
          ]
        : []),
    ],
    blockers: [],
    unknowns: [
      ...(!sourceInventory ? ["The source hierarchy is not recorded."] : []),
      ...sharedUnknowns,
    ],
    limitation:
      "An inventory, an absent capture and a failed source read are different observations. This is not a content-completeness finding.",
  });

  const structuralBlockers = [
    ...(audit && !boundAudit
      ? ["The selected report belongs to another assignment."]
      : []),
    ...(boundAudit && hash(course.data.scan?.fileSha256) && !sameSource
      ? ["The saved comparison does not match the current source identity."]
      : []),
    ...(options.pendingChanged
      ? ["New evidence is staged outside the saved comparison."]
      : []),
    ...(evaluation.ingestionComparisonRequired
      ? ["The current ingestion attempt needs its own saved comparison."]
      : []),
  ];
  const scopeReviews = new Map<string, WorkspaceRecord[]>();
  for (const record of records)
    if (
      record.kind === "item-review" &&
      record.packageId === course.id &&
      record.data.auditId === boundAudit?.id
    ) {
      const key = String(record.data.itemKey || "");
      scopeReviews.set(key, [...(scopeReviews.get(key) || []), record]);
    }
  const defaultExclusions = evaluation.excluded.filter((task) => {
    const reviews = scopeReviews.get(task.key) || [];
    return (
      reviews.length !== 1 ||
      reviews[0].data.review?.relevance !== "not_relevant"
    );
  }).length;
  const structuralUnknowns = [
    ...(!boundAudit ? ["No saved comparison is selected."] : []),
    ...(!sameSource
      ? ["The comparison's source binding is not established."]
      : []),
    ...(!structure
      ? ["Independent destination structure is not verified."]
      : []),
    ...(!evaluation.reconciled
      ? [
          "Owner reconciliation and intended scope are not recorded for this evidence.",
        ]
      : []),
    ...(defaultExclusions
      ? [
          `${defaultExclusions} exclusions still use default folder rules rather than explicit owner scope decisions.`,
        ]
      : []),
  ];
  add({
    purpose: "structural-agent-handoff",
    label: "Send structure to the map or outline agent",
    status: structuralBlockers.length
      ? "NEEDS_EVIDENCE"
      : structuralUnknowns.length
        ? "UNKNOWN"
        : "PROVISIONAL",
    summary:
      structuralBlockers.length || structuralUnknowns.length
        ? "The evidence or intended scope still needs confirmation."
        : "A source-linked structural draft can be shared provisionally.",
    nextAction:
      structuralBlockers.length || structuralUnknowns.length
        ? "Use the existing reconciliation and deliverable prerequisites."
        : "Attach the structured draft and complete owner report to the agent.",
    observations: structure
      ? ["Destination structure has an independent comparison basis."]
      : [],
    blockers: structuralBlockers,
    unknowns: structuralUnknowns,
    limitation:
      "A structural draft is not the complete content corpus. Keep questions, original files, source gaps and proposed changes separate; opening an agent transfers no evidence.",
  });

  let questions = 0,
    draftDefinitions = 0,
    draftItems = 0,
    nativeBlocks = 0;
  for (const item of content) {
    questions += Array.isArray(item.content?.questions)
      ? item.content.questions.length
      : 0;
    nativeBlocks += item.content?.retainedAuthoringContent?.blocks?.length || 0;
    const draft = item.content?.authoringDraftSnapshot;
    if (
      draft?.scope === "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM" &&
      draft.itemId === item.id &&
      draft.publishedContentVerified === false
    ) {
      draftItems++;
      draftDefinitions += draft.parts.filter(
        (part) => !!part.definition,
      ).length;
    }
  }
  const assessmentEvidence = questions + draftDefinitions + nativeBlocks;
  add({
    purpose: "assessment-review",
    label: "Review assessment content",
    status: assessmentEvidence ? "PROVISIONAL" : "UNKNOWN",
    summary: assessmentEvidence
      ? "Retained assessment observations can be reviewed now."
      : "Usable question or instruction bodies are not established here.",
    nextAction: assessmentEvidence
      ? "Open the existing assessment content view and its literal originals."
      : "Inspect the exact assessment's retained source and acquisition gaps.",
    observations: [
      `${questions} normalized question observations.`,
      ...(draftDefinitions
        ? [
            `${draftDefinitions} definition references in separately retained attached drafts.`,
          ]
        : []),
      ...(nativeBlocks
        ? [`${nativeBlocks} additional native question or instruction blocks.`]
        : []),
    ],
    blockers: [],
    unknowns: [
      ...(draftItems
        ? [
            `Current published bodies remain unverified for ${draftItems} attached draft snapshots.`,
          ]
        : []),
      "Full question banks, variants, answer-key validity and learner behavior are not established by these counts.",
      ...sharedUnknowns,
    ],
    limitation:
      "Draft definitions, instruction blocks, normalized occurrences and current published questions are separate. Empty or unread API results do not prove an empty assessment.",
  });

  const proof = boundAudit?.data.archiveProof;
  const archiveBound = archiveProofRecordValid(
    proof,
    boundAudit?.data.hashes?.json,
    boundAudit?.data.captureTransport?.json,
  );
  let missingMedia = 0,
    sourceOriginals = 0;
  for (const item of content) {
    if (
      item.content?.sourceBody?.originalIntegrity ===
      "VERIFIED_RETAINED_ORIGINAL"
    )
      sourceOriginals++;
    for (const ref of item.content?.sourceBody?.references || [])
      if (
        ["img", "video", "audio", "source", "track"].includes(ref.tag) &&
        !ref.originalRef
      )
        missingMedia++;
    for (const provider of item.content?.inlineWidgetContent?.providers || [])
      for (const page of provider.publisherPages || [])
        for (const resource of page.media?.resources || [])
          if (resource.status === "UNRESOLVED") missingMedia++;
  }
  const mediaBlockers = [
    ...(proof && !archiveBound
      ? [
          "Saved archive proof is invalid, unsupported or does not match this capture input.",
        ]
      : []),
    ...(missingMedia
      ? [
          `${missingMedia} media ${missingMedia === 1 ? "reference has" : "references have"} no verified current original body.`,
        ]
      : []),
  ];
  const hasRetainedOriginals =
    (archiveBound && proof.fileCount > 0) || sourceOriginals > 0;
  add({
    purpose: "original-media-verification",
    label: "Verify retained original files",
    status: mediaBlockers.length
      ? "NEEDS_EVIDENCE"
      : hasRetainedOriginals
        ? "PROVISIONAL"
        : "UNKNOWN",
    summary: mediaBlockers.length
      ? "Recorded byte or reference gaps prevent a full media claim."
      : hasRetainedOriginals
        ? "Import integrity checks are recorded for retained originals."
        : "Original-file integrity is not established by this saved view.",
    nextAction: mediaBlockers.length
      ? "Review the exact original-source gaps and keep the full input archive."
      : "Keep the full original archives; verify required media scope separately.",
    observations: [
      ...(archiveBound
        ? [
            `An import check is recorded for ${proof.fileCount} Coursera archive ${proof.fileCount === 1 ? "file" : "files"}; original bytes are not stored in this report.`,
          ]
        : []),
      ...(sourceOriginals
        ? [
            `${sourceOriginals} source bodies have recorded original-byte integrity checks.`,
          ]
        : []),
    ],
    blockers: mediaBlockers,
    unknowns: [
      "Required media scope, current provider availability and playback remain separate and unverified.",
    ],
    limitation:
      "A saved URL or descriptor is not original bytes. An import check is historical byte integrity, not a new provider read, a playable video or complete interactive content.",
  });

  const freshness = evaluation.changeFreshness;
  const observedAt = courseraContentObservedAt(boundAudit);
  const shellStale =
    !!evaluation.plan.shellChangedAt &&
    (!Number.isFinite(time(observedAt)) ||
      time(observedAt) <= time(evaluation.plan.shellChangedAt));
  const postEditBlockers = [
    ...(freshness.needsRecapture ? freshness.blockers : []),
    ...(evaluation.applicationNeedsCapture
      ? ["A recorded external application still needs a post-edit capture."]
      : []),
    ...(shellStale
      ? [
          "The retained content observation does not postdate the declared shell edit.",
        ]
      : []),
    ...(evaluation.changed.length
      ? ["Recorded changed items still need a fresh comparison."]
      : []),
  ];
  add({
    purpose: "post-edit-verification",
    label: "Verify changes after editing",
    status: postEditBlockers.length ? "NEEDS_EVIDENCE" : "UNKNOWN",
    summary: postEditBlockers.length
      ? "A recorded edit has an unresolved evidence barrier."
      : freshness.declarationCount
        ? "Recorded date and input barriers clear; item-level verification still needs review."
        : "No completed post-edit verification scope is established.",
    nextAction: postEditBlockers.length
      ? "Follow the current recapture and comparison action above."
      : "Review evidence-specific native observations and the exact edited items.",
    observations: observedAt
      ? [`Effective Coursera content observation: ${observedAt}.`]
      : [],
    blockers: postEditBlockers,
    unknowns: [
      ...(freshness.status === "history-unavailable" ? freshness.blockers : []),
      ...(!freshness.declarationCount
        ? ["No item edit declaration is available for this scope."]
        : []),
      "Current native body revalidation, published-item scope and learner checks cannot be certified from an export date or owner checkmark.",
    ],
    limitation:
      "A resumed export can retain older questions and text. Cleared workflow barriers and an attached draft do not certify a current published body or runtime behavior.",
  });
  return { auditId: boundAudit?.id || "", provisional: true, purposes };
}
