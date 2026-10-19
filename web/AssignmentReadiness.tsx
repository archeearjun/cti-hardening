import type { AssignmentReadiness as Readiness } from "../src/domain/assignment-readiness";

export default function AssignmentReadiness({ value }: { value: Readiness }) {
  return (
    <details className="card" aria-label="Purpose-specific evidence readiness">
      <summary>
        <strong>What this evidence supports</strong> · provisional
      </summary>
      <p className="hint">
        Each purpose has different prerequisites. These labels describe
        available evidence; they do not change the saved audit, certify complete
        extraction or approve publication. Continue with the next action above.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <caption>
            Provisional purpose readiness for the selected evidence
          </caption>
          <thead>
            <tr>
              <th>Purpose</th>
              <th>Status</th>
              <th>Next check</th>
            </tr>
          </thead>
          <tbody>
            {value.purposes.map((purpose) => (
              <tr key={purpose.purpose}>
                <th scope="row">{purpose.label}</th>
                <td>
                  {purpose.status === "PROVISIONAL"
                    ? "Provisional"
                    : purpose.status === "NEEDS_EVIDENCE"
                      ? "Needs evidence"
                      : "Unknown"}
                </td>
                <td>
                  <p>{purpose.summary}</p>
                  <p>{purpose.nextAction}</p>
                  <details>
                    <summary>Evidence and limits</summary>
                    {purpose.observations.map((text) => (
                      <p key={text}>{text}</p>
                    ))}
                    {!!purpose.blockers.length && (
                      <p>
                        <strong>Observed barriers:</strong>{" "}
                        {purpose.blockers.join(" ")}
                      </p>
                    )}
                    {!!purpose.unknowns.length && (
                      <p>
                        <strong>Still unknown:</strong>{" "}
                        {purpose.unknowns.join(" ")}
                      </p>
                    )}
                    <p className="hint">{purpose.limitation}</p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
