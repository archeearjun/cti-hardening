import { useState } from "react";
import type { EvidenceObject } from "../src/domain/workspace-types";

const labels: Record<string, string> = {
  REPAIR_OR_CONFIRM: "Repair / confirm finding",
  REVIEW: "Review required",
  EVIDENCE_NEEDED: "Evidence needed",
  VERIFIED_EVIDENCE: "Verified evidence",
  NOT_SOURCE_VERIFIED: "Not source-verified",
};
export default function OwnerEvidence({ result }: { result: EvidenceObject }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(40);
  const view = result.ownerView;
  if (!view) return null;
  const all: EvidenceObject[] = view.items || [];
  const items = all.filter(
    (i) =>
      (!status || i.status === status) &&
      [
        i.name,
        i.path,
        i.type,
        i.status,
        labels[i.status],
        ...(i.sourceNames || []),
        ...(i.actions || []).map((a: EvidenceObject) => a.action),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="owner-evidence">
      <div className="section-heading">
        <h3>Coursera content view</h3>
        <span className="badge">{all.length} captured outline items</span>
      </div>
      <p className="hint">{view.authority}</p>
      <div className="filter-bar">
        <label>
          Find an item or action
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(40);
            }}
            placeholder="Title, module, source name or action"
          />
        </label>
        <label>
          Finding status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setLimit(40);
            }}
          >
            <option value="">All findings ({all.length})</option>
            {Object.entries(labels).map(([value, label]) => (
              <option value={value} key={value}>
                {label} ({all.filter((i) => i.status === value).length})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint" role="status">
        Showing {Math.min(items.length, limit)} of {items.length} matching items
        · Coursera order preserved
      </p>
      {items.slice(0, limit).map((item, index) => (
        <div key={`${item.id}-${index}`}>
          {(index === 0 || items[index - 1].path !== item.path) && (
            <h4 className="outline-path">
              {item.path || "Placement unavailable"}
            </h4>
          )}
          <details className="outline-item">
            <summary>
              <span>
                <strong>{item.name}</strong>
                <small>{item.type || "Type not recorded"}</small>
              </span>
              <span className={`finding-label finding-${item.status}`}>
                {labels[item.status] || item.status || "Status not recorded"}
              </span>
            </summary>
            <div className="item-evidence">
              <p>
                Publication:{" "}
                {item.published === true
                  ? "Published"
                  : item.published === false
                    ? "Unpublished"
                    : "Not captured"}
                <small>Item ID: {item.id || "Not recorded"}</small>
              </p>
              {!!item.sourceNames?.length && (
                <p>
                  <strong>Matched source:</strong> {item.sourceNames.join("; ")}
                </p>
              )}
              {(item.actions || []).map((action: EvidenceObject, n: number) => (
                <div className="owner-action" key={n}>
                  <strong>
                    {action.verdict}
                    {action.severity && action.severity !== "NONE"
                      ? ` · ${action.severity}`
                      : ""}
                  </strong>
                  <p>
                    {action.sourceName && `${action.sourceName}: `}
                    {action.action}
                  </p>
                </div>
              ))}
              {item.excerpt && (
                <details>
                  <summary>Captured content excerpt</summary>
                  <blockquote>{item.excerpt}</blockquote>
                  <p className="hint">
                    {item.excerptComplete
                      ? "Captured excerpt"
                      : "Partial captured excerpt; full content is not implied."}
                  </p>
                </details>
              )}
            </div>
          </details>
        </div>
      ))}
      {!items.length && (
        <p className="empty-state">
          No destination items match these filters. Source items without a
          confirmed destination are listed separately below.
        </p>
      )}
      {items.length > limit && (
        <button className="secondary" onClick={() => setLimit(limit + 40)}>
          Show next 40 items
        </button>
      )}
      {!!view.unmappedSource?.length && (
        <section className="unmapped-source">
          <h3>Source items outside the matched Coursera view</h3>
          <p>
            These {view.unmappedSource.length} source findings remain visible
            regardless of the destination filters. Check each verdict and policy
            before making a course edit.
          </p>
          {view.unmappedSource.map((item: EvidenceObject, i: number) => (
            <details key={i}>
              <summary>
                <span>
                  <strong>{item.name || "Unnamed source item"}</strong>
                  <small>{item.path || "Placement not recorded"}</small>
                </span>
                <span className="finding-label">{item.verdict}</span>
              </summary>
              <div className="item-evidence">
                <p>{item.action || "No owner action recorded."}</p>
                {item.diagnostic && (
                  <details>
                    <summary>Finding evidence</summary>
                    <pre className="evidence-json">
                      {JSON.stringify(item.diagnostic, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </details>
          ))}
        </section>
      )}
    </section>
  );
}
