export interface CourseraShellTarget {
  inputUrl: string;
  shellUrl: string;
  slug: string;
  courseId: string;
}

export type CourseraExtractionState =
  | "QUEUED"
  | "AWAITING_LOGIN"
  | "CONNECTED"
  | "RUNNING"
  | "VERIFYING"
  | "COMPLETE"
  | "INCOMPLETE"
  | "FAILED";

export interface CourseraCaptureVerdict {
  complete: boolean;
  noSilentMisses: boolean;
  inventoryCount: number;
  fingerprintCount: number;
  completeCount: number;
  unresolvedCount: number;
  unknownCount: number;
  unvisitedCount: number;
  externalContentUnverifiedCount: number;
  reasons: string[];
}

export interface CourseraExtractionStatus {
  id: string;
  kind: "connection" | "extraction";
  state: CourseraExtractionState;
  shellUrl: string;
  courseId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  phase?: string;
  ownerHash?: string;
  liveViewUrl?: string;
  artifactAvailable?: boolean;
  artifactName?: string;
  capture?: CourseraCaptureVerdict;
  error?: string;
}

const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
const number = (value: unknown, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);

export function parseCourseraShellUrl(value: string): CourseraShellTarget {
  let url: URL;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid Coursera authoring-shell URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.coursera.org" ||
    url.username ||
    url.password
  )
    throw new Error(
      "Only https://www.coursera.org/teach/... authoring-shell URLs are allowed.",
    );
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length < 4 ||
    parts[0] !== "teach" ||
    !/^[a-z0-9][a-z0-9-]{1,199}$/i.test(parts[1] || "") ||
    !/^[a-z0-9_-]{8,160}$/i.test(parts[2] || "") ||
    parts[3] !== "content"
  )
    throw new Error(
      "Paste a Coursera authoring URL containing /teach/<course>/<course-id>/content.",
    );
  const slug = parts[1],
    courseId = parts[2];
  return {
    inputUrl: url.toString(),
    shellUrl: `https://www.coursera.org/teach/${slug}/${courseId}/content/edit`,
    slug,
    courseId,
  };
}

function textBlockEvidenceValid(
  item: Record<string, unknown>,
  payload: Record<string, unknown>,
  courseId: string,
): boolean {
  const evidence = record(
    record(payload.nativeAssignment)?.contentBlockEvidence,
  );
  const blocks = array(evidence?.blocks);
  const assessment = record(payload.structuredAssessment);
  return (
    !!evidence &&
    evidence.completeTextBlockOnly === true &&
    evidence.itemId === item.id &&
    evidence.courseId === courseId &&
    Number.isInteger(evidence.declaredContentParts) &&
    evidence.declaredContentParts > 0 &&
    evidence.declaredContentParts === blocks.length &&
    evidence.observedPartCount === blocks.length &&
    evidence.observedTextBlockCount === blocks.length &&
    evidence.otherPartCount === 0 &&
    new Set(blocks.map((b) => record(b)?.id)).size === blocks.length &&
    blocks.every(
      (b) =>
        record(b) &&
        typeof b.id === "string" &&
        b.id &&
        typeof b.text === "string" &&
        b.text.trim() &&
        b.truncated === false,
    ) &&
    !array(assessment?.questions).length &&
    !number(assessment?.declaredQuestionCount) &&
    !number(record(assessment?.captureCompleteness)?.declared)
  );
}

function itemContractReasons(fingerprints: unknown[]): string[] {
  const reasons: string[] = [];
  for (const fp of fingerprints) {
    const item = record(fp),
      payload = record(item?.payload);
    const outer = record(item?.captureContract),
      inner = record(payload?.captureContract);
    const contract = outer || inner,
      id = String(item?.id || "unknown");
    if (
      !contract ||
      typeof contract.complete !== "boolean" ||
      typeof contract.status !== "string" ||
      !contract.status
    )
      reasons.push(`ITEM_CONTRACT_MISSING:${id}`);
    else if (contract.complete !== true)
      reasons.push(`ITEM_INCOMPLETE:${id}:${contract.status}`);
    if (
      outer &&
      inner &&
      (outer.complete !== inner.complete || outer.status !== inner.status)
    )
      reasons.push(`ITEM_CONTRACT_CONFLICT:${id}`);
    if (contract?.itemId != null && contract.itemId !== item?.id)
      reasons.push(`ITEM_CONTRACT_ID_MISMATCH:${id}`);
  }
  return reasons;
}

function assessmentReasons(fingerprints: any[], courseId: string): string[] {
  const reasons: string[] = [];
  for (const fp of fingerprints) {
    const item = record(fp);
    if (!item) continue;
    const type = String(item.type || item.typeName || "").toLowerCase();
    if (!/assignment|quiz|exam|assessment/.test(type)) continue;
    const payload = record(item.payload) || {};
    const assessment = record(payload.structuredAssessment);
    const contract = record(item.captureContract || payload.captureContract);
    if (contract && contract.complete === false) {
      reasons.push(
        `ITEM_INCOMPLETE:${String(item.id || "unknown")}:${String(contract.status || "UNRESOLVED")}`,
      );
      continue;
    }
    if (contract?.status === "COMPLETE_ASSIGNMENT_TEXT_BLOCKS") {
      if (!textBlockEvidenceValid(item, payload, courseId))
        reasons.push(
          `ASSIGNMENT_TEXT_BLOCK_EVIDENCE_INCOMPLETE:${String(item.id || "unknown")}`,
        );
      continue;
    }
    // A captured ingestion failure describes an observed defect, not a claim
    // that assessment payload exists. Preserve that separate capture outcome.
    if (
      contract?.status === "INGESTION_FAILURE_CAPTURED" &&
      record(payload.ingestionFailure)?.detected === true
    )
      continue;
    if (!assessment) {
      if (
        contract &&
        !["COMPLETE_NATIVE_ASSIGNMENT", "COMPLETE_EMPTY_ASSIGNMENT"].includes(
          String(contract.status || ""),
        )
      )
        reasons.push(
          `ASSESSMENT_EVIDENCE_MISSING:${String(item.id || "unknown")}`,
        );
      continue;
    }
    const completeness = record(assessment.captureCompleteness);
    const declared = number(
      completeness?.declared ??
        assessment.declaredQuestionCount ??
        assessment.questionCount,
      0,
    );
    if (declared > 0) {
      const captured = number(
        completeness?.captured ?? array(assessment.questions).length,
        0,
      );
      if (
        !completeness ||
        completeness.questionCoverageComplete !== true ||
        completeness.requiredAnswerCoverageComplete !== true ||
        captured < declared ||
        array(assessment.questions).length !== declared ||
        array(completeness.missingQuestionOrdinals).length > 0 ||
        array(completeness.missingRequiredAnswerOrdinals).length > 0
      )
        reasons.push(
          `ASSESSMENT_COVERAGE_INCOMPLETE:${String(item.id || "unknown")}:${captured}/${declared}`,
        );
    }
  }
  return reasons;
}

function pluginReasons(fingerprints: any[]): string[] {
  const reasons: string[] = [];
  for (const fp of fingerprints) {
    const item = record(fp);
    if (!item) continue;
    const type = String(item.type || item.typeName || "").toLowerCase();
    if (!/plugin|lti|widget/.test(type)) continue;
    const payload = record(item.payload) || {};
    const contract = record(item.captureContract || payload.captureContract);
    const status = String(contract?.status || "");
    if (
      contract?.externalBodyVerified === false ||
      status === "ACCOUNTED_EXTERNAL_TARGET_ONLY" ||
      status === "COMPLETE_EXTERNAL_TARGET_ONLY"
    )
      reasons.push(`PLUGIN_BODY_UNVERIFIED:${String(item.id || "unknown")}`);
    else if (contract && contract.complete !== true)
      reasons.push(
        `PLUGIN_INCOMPLETE:${String(item.id || "unknown")}:${status || "UNRESOLVED"}`,
      );
  }
  return reasons;
}

export function evaluateCourseraCapture(
  value: unknown,
  expectedCourseId = "",
): CourseraCaptureVerdict {
  const capture = record(value);
  if (!capture)
    return {
      complete: false,
      noSilentMisses: false,
      inventoryCount: 0,
      fingerprintCount: 0,
      completeCount: 0,
      unresolvedCount: 1,
      unknownCount: 0,
      unvisitedCount: 0,
      externalContentUnverifiedCount: 0,
      reasons: ["CAPTURE_NOT_AN_OBJECT"],
    };

  const meta = record(capture.meta) || {};
  const fingerprints = array(capture.fingerprints);
  const accounting = record(meta.captureAccounting);
  const reasons: string[] = [];
  const page = record(capture.page) || {};
  const actualCourseId = String(page.courseId || "");

  if (expectedCourseId && actualCourseId !== expectedCourseId)
    reasons.push(
      `COURSE_ID_MISMATCH:${actualCourseId || "missing"}:${expectedCourseId}`,
    );
  if (!fingerprints.length) reasons.push("NO_ITEM_FINGERPRINTS");
  const ids = fingerprints.map((fp) => record(fp)?.id);
  const identitiesValid =
    ids.every((id) => typeof id === "string" && id.trim()) &&
    new Set(ids).size === ids.length;
  if (!identitiesValid) reasons.push("ITEM_IDENTITIES_MISSING_OR_DUPLICATED");

  let inventoryCount = number(meta.baseFingerprintCount, fingerprints.length),
    completeCount = 0,
    unresolvedCount = 0,
    unknownCount = 0,
    unvisitedCount = 0,
    externalContentUnverifiedCount = 0,
    noSilentMisses = false;

  if (accounting) {
    const requiredCounts = [
      "inventoryCount",
      "completeCount",
      "unresolvedCount",
      "unknownCount",
      "unvisitedCount",
    ];
    const optionalCounts = [
      "externalContentUnverifiedCount",
      "terminalAccountedIncompleteCount",
    ];
    const countersValid = [
      ...requiredCounts,
      ...optionalCounts.filter((k) => accounting[k] !== undefined),
    ].every(
      (k) =>
        typeof accounting[k] === "number" &&
        Number.isSafeInteger(accounting[k]) &&
        accounting[k] >= 0,
    );
    if (!countersValid) reasons.push("CAPTURE_ACCOUNTING_COUNTERS_INVALID");
    const totalsValid =
      accounting.completeCount + accounting.unresolvedCount ===
      accounting.inventoryCount;
    if (!totalsValid) reasons.push("CAPTURE_ACCOUNTING_TOTALS_INCONSISTENT");
    const itemCompleteCount = fingerprints.filter((fp) => {
      const item = record(fp);
      return (
        record(item?.captureContract || record(item?.payload)?.captureContract)
          ?.complete === true
      );
    }).length;
    if (itemCompleteCount !== accounting.completeCount)
      reasons.push("CAPTURE_ACCOUNTING_ITEM_COUNT_MISMATCH");
    inventoryCount = number(accounting.inventoryCount, inventoryCount);
    completeCount = number(accounting.completeCount);
    unresolvedCount = number(accounting.unresolvedCount);
    unknownCount = number(accounting.unknownCount);
    unvisitedCount = number(accounting.unvisitedCount);
    externalContentUnverifiedCount = number(
      accounting.externalContentUnverifiedCount,
    );
    noSilentMisses =
      accounting.noSilentMisses === true &&
      accounting.allInventoryAccounted === true &&
      unknownCount === 0 &&
      unvisitedCount === 0 &&
      identitiesValid &&
      countersValid &&
      totalsValid &&
      inventoryCount === fingerprints.length;

    if (inventoryCount !== fingerprints.length)
      reasons.push(
        `INVENTORY_FINGERPRINT_MISMATCH:${inventoryCount}:${fingerprints.length}`,
      );
    if (accounting.allInventoryAccounted !== true)
      reasons.push("INVENTORY_NOT_FULLY_ACCOUNTED");
    if (accounting.noSilentMisses !== true)
      reasons.push("SILENT_MISS_GUARD_NOT_PROVEN");
    if (unknownCount) reasons.push(`UNKNOWN_ITEMS:${unknownCount}`);
    if (unvisitedCount) reasons.push(`UNVISITED_ITEMS:${unvisitedCount}`);
    if (unresolvedCount) reasons.push(`UNRESOLVED_ITEMS:${unresolvedCount}`);
    if (number(accounting.terminalAccountedIncompleteCount))
      reasons.push(
        `TERMINAL_INCOMPLETE_ITEMS:${number(accounting.terminalAccountedIncompleteCount)}`,
      );
    if (externalContentUnverifiedCount)
      reasons.push(
        `EXTERNAL_CONTENT_UNVERIFIED:${externalContentUnverifiedCount}`,
      );
    if (accounting.complete !== true)
      reasons.push("CAPTURE_ACCOUNTING_NOT_COMPLETE");
  } else {
    // Older extractor releases can provide useful evidence, but they cannot
    // certify the strict background-completion contract. Never upgrade that
    // uncertainty to COMPLETE.
    reasons.push("EXPLICIT_COMPLETENESS_CONTRACT_MISSING");
    unresolvedCount = Math.max(1, number(meta.unresolvedEvidenceCount));
  }

  const crawl = record(meta.activeSpaCrawl);
  if (crawl) {
    if (crawl.timeBudgetExhausted === true)
      reasons.push("ACTIVE_CRAWL_TIME_BUDGET_EXHAUSTED");
    const unvisited = array(crawl.unvisitedTargetIds);
    if (unvisited.length)
      reasons.push(`ACTIVE_CRAWL_UNVISITED:${unvisited.length}`);
    if (number(crawl.unvisitedDueToBudget))
      reasons.push(
        `ACTIVE_CRAWL_UNVISITED_DUE_TO_BUDGET:${number(crawl.unvisitedDueToBudget)}`,
      );
  }
  if (meta.wholeRunDeadlineReached === true)
    reasons.push("WHOLE_RUN_DEADLINE_REACHED");

  reasons.push(...itemContractReasons(fingerprints));
  reasons.push(...assessmentReasons(fingerprints, actualCourseId));
  reasons.push(...pluginReasons(fingerprints));

  const uniqueReasons = [...new Set(reasons)];
  return {
    complete: uniqueReasons.length === 0 && noSilentMisses,
    noSilentMisses,
    inventoryCount,
    fingerprintCount: fingerprints.length,
    completeCount,
    unresolvedCount,
    unknownCount,
    unvisitedCount,
    externalContentUnverifiedCount,
    reasons: uniqueReasons,
  };
}
