/** Presentation counts are separate from the strict capture verdict. */
export function directDataCoverageSummaryV1(items) {
  if (!Array.isArray(items) || items.length > 20000)
    throw Error("DIRECT_COVERAGE_SUMMARY_INPUT_INVALID");
  const counts = () => ({ total: 0, read: 0, verified: 0 });
  const summary = {
    inventory: counts(),
    content: counts(),
    assessments: counts(),
    questions: 0,
    readings: counts(),
    readingMedia: { items: 0, references: 0, uniqueReferences: 0 },
    missingPointers: { items: 0, references: 0 },
    widgets: { ...counts(), configurations: 0 },
    structures: counts(),
    discussions: counts(),
  };
  const referenceIds = new Set();
  const count = (target, item) => {
    target.total++;
    if (item.processed === true) target.read++;
    if (item.contract?.complete === true) target.verified++;
  };
  const integer = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw Error("DIRECT_COVERAGE_SUMMARY_ITEM_INVALID");
    count(summary.inventory, item);
    const status = item.contract?.status || item.status || "";
    const structural =
      item.structural === true ||
      status === "COMPLETE_EMPTY_STRUCTURE" ||
      status === "UNRESOLVED_DIRECT_STRUCTURE";
    if (structural) {
      count(summary.structures, item);
      continue;
    }
    count(summary.content, item);
    summary.questions += integer(item.questions);
    if (item.retainedDraftSnapshot === true) {
      if (!summary.retainedDraftSnapshots) summary.retainedDraftSnapshots = {items: 0, definitions: 0};
      summary.retainedDraftSnapshots.items++;
      summary.retainedDraftSnapshots.definitions += integer(item.retainedDraftDefinitionCount);
      if (integer(item.retainedDraftHistoricalObservations))
        summary.retainedDraftSnapshots.historicalObservations =
          (summary.retainedDraftSnapshots.historicalObservations || 0) + integer(item.retainedDraftHistoricalObservations);
    }
    const type = String(item.type || "").toLowerCase();
    if (/^(?:assignment|assessment|quiz)$/.test(type)) {
      count(summary.assessments, item);
      const kind = status === "COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT" ? "emptyDrafts"
        : status === "COMPLETE_BOUND_DRAFT_INSTRUCTION_ASSESSMENT" ? "instructionOnly"
        : status === "COMPLETE_BOUND_DRAFT_REFLECTION_ASSESSMENT" ? "unkeyedReflections"
        : status === "COMPLETE_BOUND_DRAFT_MANUAL_ASSESSMENT" ? "manualDrafts" : "";
      if (kind && item.contract?.complete === true) {
        if (!summary.assessmentKinds) summary.assessmentKinds = {emptyDrafts: 0, instructionOnly: 0, unkeyedReflections: 0};
        summary.assessmentKinds[kind]=(summary.assessmentKinds[kind] || 0)+1;
      }
    }
    else if (type === "reading") {
      count(summary.readings, item);
      const references = integer(item.assetReferenceCount);
      if (references) summary.readingMedia.items++;
      summary.readingMedia.references += references;
      for (const id of Array.isArray(item.assetReferenceIds)
        ? item.assetReferenceIds
        : [])
        if (typeof id === "string" && id) referenceIds.add(id);
      const missing = integer(item.missingPointerCount);
      if (missing) summary.missingPointers.items++;
      summary.missingPointers.references += missing;
    } else if (/^(?:plugin|widget)$/.test(type)) {
      count(summary.widgets, item);
      if (item.contract?.sourceConfigurationVerified === true)
        summary.widgets.configurations++;
    }
    else if (type === "discussion") count(summary.discussions, item);
  }
  summary.readingMedia.uniqueReferences = referenceIds.size;
  return summary;
}

/** Keep the spent run budget while explicitly separating this attempt. */
export function directDataAttemptMetricsV1(snapshot = {}, budgetBase = {}) {
  const number = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
  const inheritedBudget = {
    requests: number(budgetBase.requests),
    bytes: number(budgetBase.bytes),
    elapsedMs: number(budgetBase.elapsedMs),
  };
  const byResource = {};
  for (const [resource, count] of Object.entries(snapshot.byResource || {}))
    if (Number.isSafeInteger(count) && count >= 0) byResource[resource] = count;
  const currentAttempt = {
    requests: number(snapshot.requests),
    bytes: number(snapshot.bytes),
    elapsedMs: number(snapshot.elapsedMs),
    completed: number(snapshot.completed),
    failed: number(snapshot.failed),
    byResource,
  };
  const cumulativeBudget = {
    requests: inheritedBudget.requests + currentAttempt.requests,
    bytes: inheritedBudget.bytes + currentAttempt.bytes,
    elapsedMs: inheritedBudget.elapsedMs + currentAttempt.elapsedMs,
  };
  return {
    ...snapshot,
    ...cumulativeBudget,
    byResource: { ...byResource },
    statScopes: {
      requests: "CUMULATIVE_RUN",
      bytes: "CUMULATIVE_RUN",
      elapsedMs: "CUMULATIVE_RUN",
      completed: "CURRENT_ATTEMPT",
      failed: "CURRENT_ATTEMPT",
      retries: "CURRENT_ATTEMPT",
      rateLimitRetries: "CURRENT_ATTEMPT",
      byResource: "CURRENT_ATTEMPT",
    },
    currentAttempt,
    inheritedBudget,
    cumulativeBudget,
  };
}
