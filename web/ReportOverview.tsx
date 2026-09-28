import type { EvidenceObject } from "../src/domain/workspace-types";

function metric(value: unknown, suffix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}${suffix}`
    : "Not recorded";
}
export default function ReportOverview({ result }: { result: EvidenceObject }) {
  const summary = result.summary;
  if (!summary)
    return (
      <p className="hint">
        This saved report uses an earlier or lifecycle format. Its complete
        report and evidence remain available below.
      </p>
    );
  const policy = summary.operationalPolicy || result.operationalPolicy;
  return (
    <section className="report-overview" aria-label="Report summary">
      <p className="eyebrow">RECORDED AUDIT RESULT</p>
      <h3>
        {summary.headlineText ||
          summary.headlineStatus ||
          "Review the recorded findings"}
      </h3>
      <div className="metric-grid report-metrics">
        <div>
          <strong>{metric(summary.observedFidelity, "%")}</strong>
          <span>Observed fidelity</span>
          <small>Agreement within the evidence assessed</small>
        </div>
        <div>
          <strong>{metric(summary.evidenceCoverage, "%")}</strong>
          <span>Evidence coverage</span>
          <small>Coverage reported by the comparison engine</small>
        </div>
        <div>
          <strong>{metric(summary.ownerCritical)}</strong>
          <span>Critical owner findings</span>
        </div>
        <div>
          <strong>{metric(summary.ownerReview)}</strong>
          <span>Owner review findings</span>
        </div>
        <div>
          <strong>{metric(summary.ownerEvidence)}</strong>
          <span>Owner evidence gaps</span>
        </div>
      </div>
      <p className="hint">
        Fidelity and coverage answer different questions. A high fidelity score
        does not establish that all content was captured or that the course is
        ready to publish.
      </p>
      {policy?.recommendationLabel && (
        <div className="recommendation">
          <strong>{policy.recommendationLabel}</strong>
          <p>{policy.recommendationReason}</p>
        </div>
      )}
      {result.inputCoherence?.reason && (
        <p className="scope">
          <strong>Input coherence: {result.inputCoherence.status}</strong>
          <br />
          {result.inputCoherence.reason}
        </p>
      )}
      {!!result.workspaceWarnings?.length && (
        <ul className="scope">
          {result.workspaceWarnings.map((w: unknown, i: number) => (
            <li key={i}>{typeof w === "string" ? w : JSON.stringify(w)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
