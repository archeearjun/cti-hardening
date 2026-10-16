import type { PackageScan } from "./package-types.ts";
import type { EvidenceObject } from "./workspace-types.ts";

const documentKind = "CTI_SOURCE_DOCUMENT_BASELINE";
const reason =
  "The source contains supplied document text and heading sections only. Its headings do not establish native LMS item boundaries, expected destination inventory, assessment definitions, original media or runtime behavior.";
const reviewAction =
  "Review this literal document section against the intended destination and confirm its native item relationship before proposing changes. An unconfirmed relationship does not establish missing or changed LMS content.";
const list = (value: unknown): EvidenceObject[] =>
  Array.isArray(value) ? value : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Document headings are observations, not source LMS inventory. Preserve the
 * engine's calculations as explicitly unapproved diagnostics, then replace its
 * package-assuming decisions before any owner tasks, reports or save occur. */
export function applyDocumentComparisonScope(
  result: EvidenceObject,
  scan: PackageScan,
): EvidenceObject {
  if (scan.sourceEvidence?.kind !== documentKind) return result;
  if (!result.success) return result;
  if (result.documentComparisonScope) {
    if (result.documentComparisonScope.sourceHash !== scan.fileSha256)
      throw Error(
        "A document-scoped comparison cannot be rebound to different source evidence.",
      );
    return result;
  }
  const observedKeys = [
    "itemResults",
    "summary",
    "ownerView",
    "operationalPolicy",
    "destinationReadiness",
    "courseLevelFailure",
    "currentStateResolution",
    "manualChangeAttribution",
    "ingestionIntelligence",
    "externalRuntimeEvidence",
    "liveSourceGroundTruth",
    "missing",
    "repackaged",
    "bundled",
    "verified",
    "mutations",
    "partial",
    "payloadUnverified",
    "moved",
    "stateMutations",
    "injected",
    "matched",
  ];
  const computedObservations = structuredClone(
    Object.fromEntries(
      observedKeys
        .filter((key) => Object.hasOwn(result, key))
        .map((key) => [key, result[key]]),
    ),
  );
  const originalItems = list(computedObservations.itemResults);
  const destinations = list(computedObservations.ownerView?.items);
  const candidateMappings = originalItems.map((item) => {
    const checks = item.checks || {},
      family =
        checks.transformationFamily || checks.oneToManyTransformation || {};
    const candidates = [
      ...(item.courseraId
        ? [
            {
              id: item.courseraId,
              name: item.courseraName,
              path: item.courseraPath,
              type: item.courseraType,
            },
          ]
        : []),
      ...list(checks.reconciliationDiagnostic?.candidates),
      ...(Array.isArray(family.childIds)
        ? family.childIds.map((id: string) => ({ id }))
        : []),
      ...list((checks.repackaging || item.repackaging)?.carriers),
    ];
    const unique = new Map<string, EvidenceObject>();
    for (const candidate of candidates) {
      const id = String(candidate.id || "");
      if (!id) continue;
      const retained = destinations.filter(
        (destination) => String(destination.id || "") === id,
      );
      unique.set(id, {
        id,
        name:
          text(candidate.name) ||
          (retained.length === 1 ? text(retained[0].name) : ""),
        path:
          text(candidate.path) ||
          (retained.length === 1 ? text(retained[0].path) : ""),
        status: "SUGGESTION",
        nativeIdentityConfirmed: false,
      });
    }
    return {
      sourceId: text(item.sourceId),
      sourceName: text(item.sourceName),
      sourcePath: text(item.sourcePath),
      status: "REVIEW",
      relationship: "DOCUMENT_SECTION_CANDIDATE",
      candidates: [...unique.values()],
    };
  });
  result.documentComparisonScope = {
    schemaVersion: 1,
    kind: "DOCUMENT_SOURCE_COMPARISON",
    sourceHash: scan.fileSha256,
    sourceName: scan.fileName,
    sourceScope: scan.scope || reason,
    reason,
    sourceInventory: "DOCUMENT_SECTIONS",
    nativeItemBoundaries: "UNKNOWN",
    fullLmsInventory: "UNKNOWN",
    fullLmsFidelity: "UNKNOWN",
    assessmentCoverage: "UNKNOWN",
    mediaCoverage: "UNKNOWN",
    runtimeCoverage: "UNKNOWN",
    ownerReviewRequired: true,
    candidateMappings,
    computedObservations: {
      ...computedObservations,
      interpretation:
        "Unapproved engine diagnostics computed with document sections in a package-shaped adapter. These do not establish whole-LMS findings or approved item relationships.",
    },
  };
  result.itemResults = originalItems.map((item, index) => ({
    sourceId: text(item.sourceId),
    sourceName: text(item.sourceName),
    sourcePath: text(item.sourcePath),
    sourceType: text(item.sourceType),
    courseraId: "",
    courseraName: "",
    courseraPath: "",
    courseraType: "",
    verdict: "UNVERIFIED",
    matchScore: null,
    fidelityPercent: null,
    evidenceCoverage: null,
    earnedPoints: null,
    possiblePoints: null,
    issues: ["DOCUMENT_SOURCE_SCOPE", "SOURCE_DESTINATION_MATCH_UNCONFIRMED"],
    checks: {
      documentScope: { status: "REVIEW", sourceHash: scan.fileSha256, reason },
      reconciliationDiagnostic: {
        ...candidateMappings[index],
        reason: reviewAction,
      },
      structure: { status: "UNVERIFIED", reason },
      type: { status: "UNVERIFIED", reason },
      placement: { status: "UNVERIFIED", reason },
      content: {
        status: "UNVERIFIED",
        mode: "DOCUMENT_TEXT_CANDIDATE",
        reason: reviewAction,
      },
      assets: {
        status: "UNKNOWN",
        reason:
          "Document references do not establish retained original files or their absence.",
      },
      questions: {
        status: "UNKNOWN",
        reason:
          "Document text does not establish captured assessment definitions or their absence.",
      },
      behavior: { status: "UNKNOWN", reason },
      runtime: { status: "UNKNOWN", reason },
    },
    ownerAction: {
      severity: "REVIEW",
      action: reviewAction,
      code: "REVIEW_DOCUMENT_SECTION",
    },
    evidenceStrength: { status: "DOCUMENT_SCOPE_ONLY", reason },
  }));
  result.ownerView = {
    schemaVersion: 1,
    authority:
      "Retained destination inventory with document-section review suggestions. No source LMS inventory equivalence is established.",
    items: destinations.map((item) => ({
      ...item,
      status: "REVIEW",
      sourceNames: [],
      actions: [
        {
          sourceName: "Supplied document scope",
          verdict: "UNVERIFIED",
          severity: "REVIEW",
          action:
            "Confirm the intended relationship to the supplied source document. Items outside this document are not established as extra, and absent document mappings are not established as missing.",
        },
      ],
    })),
    unmappedSource: result.itemResults.map((item: EvidenceObject) => ({
      sourceId: item.sourceId,
      name: item.sourceName,
      path: item.sourcePath,
      type: item.sourceType,
      verdict: "UNVERIFIED",
      action: reviewAction,
      diagnostic: item.checks.reconciliationDiagnostic,
    })),
  };
  const operationalPolicy = {
    policyId: "CTI_DOCUMENT_BASELINE_SCOPE_V1",
    recommendationCode: "REVIEW_SOURCE_DOCUMENT",
    recommendationLabel: "Review document-to-destination candidates",
    recommendationReason: reason,
    sourceScope: "DOCUMENT_SECTIONS_ONLY",
    fullLmsInventory: "UNKNOWN",
    fullLmsFidelity: "UNKNOWN",
    adjustedObservedFidelity: null,
    adjustedEvidenceCoverage: null,
    gateSourceItems: null,
    learnerFacingMissing: null,
    learnerFacingHardPayloadLoss: null,
    ingestionCapabilityStatus: "UNKNOWN",
    description:
      "No automatic re-ingestion, content repair, omission or fidelity approval follows from this document-only baseline.",
  };
  result.operationalPolicy = operationalPolicy;
  result.summary = {
    totalSourceItems: null,
    documentSectionCount: originalItems.length,
    destinationItemCount: destinations.length,
    verified: 0,
    partial: 0,
    unverified: originalItems.length,
    missing: 0,
    mutations: 0,
    moved: 0,
    observedFidelity: null,
    evidenceCoverage: null,
    ownerCritical: 0,
    ownerReview: destinations.length + originalItems.length,
    ownerEvidence: 0,
    criticalBlockers: null,
    headlineStatus: "REVIEW",
    headlineText:
      "DOCUMENT-SCOPED REVIEW — confirm item relationships; full source LMS coverage and fidelity are unknown",
    sourceScope: "DOCUMENT_SECTIONS_ONLY",
    operationalPolicy,
  };
  for (const key of [
    "missing",
    "repackaged",
    "bundled",
    "verified",
    "mutations",
    "partial",
    "moved",
    "stateMutations",
    "injected",
    "matched",
  ])
    result[key] = [];
  result.payloadUnverified = result.itemResults;
  result.destinationReadiness = {
    status: "DOCUMENT_SCOPE_REVIEW",
    reason,
    findings: [],
    criticalFindings: [],
    reviewFindings: [],
    evidenceFindings: [],
  };
  result.courseLevelFailure = { status: "UNKNOWN", detected: null, reason };
  result.currentStateResolution = {
    status: "UNKNOWN",
    reason,
    resolutions: [],
    resolvedCount: 0,
  };
  result.manualChangeAttribution = {
    status: "UNKNOWN",
    applied: false,
    reason,
  };
  result.ingestionIntelligence = {
    status: "UNKNOWN",
    detected: false,
    reason,
    claims: [],
  };
  result.externalRuntimeEvidence = { status: "UNKNOWN", reason };
  // A document-shaped source adapter cannot certify these native cross-LMS
  // mappings. Their observations stay in the explicitly scoped diagnostics.
  result.liveSourceGroundTruth = result.liveSourceGroundTruth
    ? {
        ...Object.fromEntries(
          [
            "platform",
            "fileName",
            "sha256",
            "schemaVersion",
            "extractor",
            "buildId",
            "capturedAt",
            "course",
          ]
            .filter((key) => Object.hasOwn(result.liveSourceGroundTruth, key))
            .map((key) => [key, result.liveSourceGroundTruth[key]]),
        ),
        status: "DOCUMENT_SCOPE_REVIEW",
        matchedSourceItems: null,
        matchedBundledAssetCount: null,
        sourceTopicMappings: [],
        sourceTopicCandidates: [],
        reason,
      }
    : null;
  return result;
}

/** The package report prints numeric fidelity unconditionally. Keep a separate
 * document report so a null/unknown scope never becomes a fabricated 0% score. */
export function documentComparisonText(result: EvidenceObject): string | null {
  const scope = result.documentComparisonScope;
  if (scope?.kind !== "DOCUMENT_SOURCE_COMPARISON") return null;
  return [
    "CTI DOCUMENT → COURSERA REVIEW",
    "",
    result.summary.headlineText,
    scope.reason,
    `Source document: ${scope.sourceName}`,
    `Source SHA-256: ${scope.sourceHash}`,
    `Scope: ${scope.sourceScope}`,
    `Retained document sections: ${result.summary.documentSectionCount} | Retained destination inventory entries: ${result.summary.destinationItemCount}`,
    "Whole source LMS inventory, fidelity, assessment, original-media and runtime coverage: UNKNOWN. No percentage is established.",
    "The original document text remains in source evidence. Unapproved engine calculations remain separately labelled diagnostic observations.",
    "",
    ...list(result.itemResults).flatMap((item) => {
      const mapping = list(scope.candidateMappings).find(
        (row) =>
          row.sourceId === item.sourceId &&
          row.sourcePath === item.sourcePath &&
          row.sourceName === item.sourceName,
      );
      return [
        `DOCUMENT SECTION: ${item.sourceName} [${item.sourceId}]${item.sourcePath ? " @ " + item.sourcePath : ""}`,
        "Status: UNVERIFIED; explicit owner mapping review required.",
        `Destination suggestions: ${
          list(mapping?.candidates)
            .map(
              (candidate) =>
                `${candidate.name || candidate.id} [${candidate.id}]`,
            )
            .join("; ") ||
          "None observed; this does not prove missing LMS content."
        }`,
        "Owner action: " + reviewAction,
        "",
      ];
    }),
    "Items outside the supplied document are not established as extra. Do not invent content, add items or rerun ingestion solely from this scoped comparison.",
  ].join("\n");
}
