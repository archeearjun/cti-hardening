import { questionIdentityCandidates } from "../engine/assessment/identity-candidates.js";
import { assessmentRecoveryText } from "./assessment-recovery.js";
/** Read-only presentation of saved decisions. Never recalculates or clears proof. */
export function evidenceDecisionBrief(res = {}, snapshot = {}, contentComparisons = []) {
  res = res || {};
  snapshot = snapshot || {};
  const s = res.summary || {},
    readiness = res.destinationReadiness || {};
  const rows = res.itemResults || [],
    extras = res.injected || [];
  const inScope = (row) =>
    row.operationalPolicy?.inDecisionGate !== false &&
    row.operationalPolicy?.classification !== "NON_LFM_POLICY_EXEMPT";
  const unresolved = rows.filter((r) => r.verdict === "UNVERIFIED");
  const unmatched = unresolved.filter((r) => !r.courseraId);
  const sourceGaps = unresolved.filter(
    (r) => r.checks?.evidenceAvailability?.source,
  );
  const destination = new Set(
    unresolved.flatMap(
      (r) =>
        r.checks?.evidenceAvailability?.destination?.unresolvedItemIds || [],
    ),
  );
  const links = new Map(
    (snapshot.coursera || []).map((i) => [i.id, i.content?.url]),
  );
  const lines = [
    "ASSIGNMENT DECISION BRIEF — SAVED EVIDENCE",
    `Readiness: ${s.headlineText || s.headlineStatus || "NOT ESTABLISHED"}`,
    `Comparison scope: ${res.stats?.originalCore ?? s.totalSourceItems ?? 0} core source items of ${res.stats?.original ?? 0} inventoried; ${res.stats?.coursera ?? 0} destination items.`,
    `Comparison verdicts: VERIFIED ${s.verified || 0}; PARTIAL ${s.partial || 0}; UNVERIFIED ${s.unverified || 0}; MISSING ${s.missing || 0}; REPACKAGED ${s.repackaged || 0}.`,
    `Observed match ${s.observedFidelity ?? 0}%; evidence coverage ${s.evidenceCoverage ?? 0}%. These are comparison measures, not extractor completion percentages.`,
    `Critical counts: comparison/owner ${s.criticalBlockers ?? s.ownerCritical ?? 0}; destination-readiness checks ${readiness.criticalCount ?? 0}; unmatched ingestion artifacts ${res.operationalPolicy?.learnerFacingExtraIngestionFailures ?? 0}. Different check sets, not additive counts.`,
    "Draft evidence, published evidence, retained original bytes and instructional fidelity have separate proof scopes.",
    "",
    "1. Confirmed findings requiring review or correction",
  ];
  const critical = rows.filter(
    (r) => inScope(r) && r.ownerAction?.severity === "CRITICAL",
  );
  function describe(row, action, mode) {
    const id = row.courseraId || row.id || "",
      source = row.sourceId || "";
    return `${mode} | source ${source || "unmapped"} (${row.sourceName || ""}) → destination ${id || "unmapped"} (${row.courseraName || row.name || ""}) | ${row.courseraPath || row.sourcePath || row.path || "placement unrecorded"} | ${row.verdict || row.classification || "REVIEW"}\n  ${action || "Inspect the retained item evidence; no correction has been established."}${links.get(id) ? "\n  " + links.get(id) : ""}`;
  }
  critical.forEach((r) =>
    lines.push(describe(r, r.ownerAction.action, "MANUAL REVIEW")),
  );
  extras
    .filter((r) => inScope(r) && r.severity === "CRITICAL")
    .forEach((r) => lines.push(describe(r, r.ownerAction, "MANUAL REVIEW")));
  if (
    !critical.length &&
    !extras.some((r) => inScope(r) && r.severity === "CRITICAL")
  )
    lines.push(
      "No critical item-level finding recorded. This is not publication approval.",
    );
  lines.push(
    "",
    "2. Captured content awaiting verification",
    `${unresolved.length} source comparisons remain UNVERIFIED: ${unmatched.length} without a direct destination match; ${unresolved.length - unmatched.length} with a match but unresolved fidelity.`,
    "Captured definitions or bytes are usable evidence; they do not establish missing content or whole-item equivalence.",
    "",
    "3. Source extraction gaps",
    `${sourceGaps.length} unresolved comparisons carry an explicit source-content limitation. Other unknown source totals remain separate; zero here does not certify source completeness.`,
  );
  const quiz = res.liveSourceGroundTruth?.quizCapture;
  if (quiz) {
    lines.push(
      `${quiz.capturedQuestionDefinitions} captured definitions across ${quiz.quizzes} source quizzes; bank totals, selection rules and runtime counts are separate.`,
    );
    for (const q of quiz.items || [])
      lines.push(
        `SOURCE ACCESS / EVIDENCE | quiz ${q.id} ${q.name}: ${q.capturedQuestionDefinitions} definitions; ${q.status}. Inspect authored fixed-question and pool membership; do not infer a bank total from pagination or the description.`,
      );
  }
  lines.push(
    "",
    "4. Coursera extraction gaps",
    `${destination.size} distinct destination IDs cited as incomplete by unmatched-source checks: ${[...destination].join(", ") || "none recorded"}. This is a diagnostic set, not a new completeness denominator.`,
    "Retain verified authoring drafts independently; obtain published bodies only where published fidelity is required. Reuse existing originals and target the missing contract.",
    "",
    "5. Mapping and comparison uncertainties",
    `${extras.length} destination items have no direct one-to-one match. This includes retained carriers and excluded/reference items, not proof they are unwanted extras.`,
    "AUTOMATED RECOMPARISON | Use the same source scan and captures after supported normalization fixes. Titles and counts identify candidates only; parity requires independent bodies and structures.",
    "",
    "6. Partner decisions",
    "PARTNER REVIEW | Confirm intended consolidations, authored transformations and publication scope. Owner explanations do not establish completeness or source absence.",
    "",
    "7. Exact item follow-up",
  );
  for (const row of rows.filter(
    (r) =>
      inScope(r) &&
      ["PARTIAL", "UNVERIFIED", "REPACKAGED", "TYPE_MUTATION"].includes(
        r.verdict,
      ),
  ))
    lines.push(
      describe(
        row,
        row.ownerAction?.action,
        row.verdict === "REPACKAGED"
          ? "PARTNER REVIEW"
          : !row.courseraId
            ? "MAPPING / EVIDENCE"
            : "ITEM EVIDENCE REVIEW",
      ),
    );
  const candidates = questionIdentityCandidates(snapshot);
  const recovery=assessmentRecoveryText(res,snapshot,contentComparisons);
  if(recovery) lines.push('',recovery);
  if (candidates.length) {
    lines.push(
      "",
      "Exact question-text candidates — not verified assessment mappings (at most 2000 pairs listed)",
    );
    for (const c of candidates)
      lines.push(
        `${c.status} | Brightspace topic ${c.source.itemId}, question ${c.source.questionId} → Coursera item ${c.destination.itemId}, question ${c.destination.questionId} | ${c.reason}\n  Projection dimensions: ${Object.entries(c.parity.dimensions).map(([name,value])=>name+'='+value.status).join('; ')}. Overall parity: ${c.parity.status}; published and learner-visible parity unverified.`,
      );
  }
  lines.push(
    "",
    `Reference-only: ${rows.filter((r) => !inScope(r)).length} source comparisons and ${extras.filter((r) => !inScope(r)).length} additional destination items excluded by the recorded policy. Historical findings remain in the evidence appendix; no publication task is inferred.`,
    "Original report, observations, hashes and receipts follow unchanged. No finding is cleared by this brief.",
  );
  return lines.join("\n");
}
