import type { OwnerTask } from "../src/domain/owner-actions";
import { ownerGuidance } from "../src/domain/owner-guidance";

export default function OwnerAssessment({
  task,
  hasFollowUp,
}: {
  task: OwnerTask;
  hasFollowUp: boolean;
}) {
  const guidance = ownerGuidance(task);
  return (
    <section
      className="owner-assessment"
      aria-label="What CTI knows about this item"
    >
      <h4>What CTI knows</h4>
      <p className="hint">
        Saved audit comparison. A passed field does not certify every image,
        setting or learner interaction.
      </p>
      {hasFollowUp && (
        <p className="scope">
          New follow-up evidence is available below. These audit findings
          describe the original comparison; review the newer evidence before
          recording your outcome.
        </p>
      )}
      {guidance.checks.length ? (
        <dl className="owner-checks">
          {guidance.checks.map((c, i) => (
            <div key={i}>
              <dt>
                {task.findings.length > 1 ? `${c.source} · ` : ""}
                {c.field}
              </dt>
              <dd>
                <strong>{c.status}</strong>
                <p className="hint">{c.detail}</p>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>
          No field-level comparison is available for this item. Use the finding
          and saved evidence below to establish what is preserved.
        </p>
      )}
      {!!guidance.readiness.length && (
        <div className="owner-readiness">
          <h4>Readiness before publication</h4>
          {guidance.readiness.map((r, i) => (
            <p key={i}>{r.detail}</p>
          ))}
        </div>
      )}
      {!!guidance.sourceImages.length && (
        <details>
          <summary>
            Source images to check in learner preview (
            {guidance.sourceImages.length})
          </summary>
          <p className="hint">
            These are image references, not confirmed missing files. Verify
            intended images and their appearance; different URLs or reference
            totals do not prove content loss.
          </p>
          <ul>
            {guidance.sourceImages.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
