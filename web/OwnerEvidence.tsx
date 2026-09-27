import { useState } from "react";
import type { EvidenceObject } from "../src/domain/workspace-types";
export default function OwnerEvidence({ result }: { result: EvidenceObject }) {
  const [query, setQuery] = useState("");
  const view = result.ownerView;
  if (!view) return null;
  const items = (view.items || []).filter((i: EvidenceObject) =>
    [
      i.name,
      i.path,
      i.type,
      i.status,
      ...(i.actions || []).map((a: EvidenceObject) => a.action),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="owner-evidence">
      <h3>Coursera content view</h3>
      <p className="hint">{view.authority}</p>
      <label>
        Find an item or action
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Title, module, status or required action"
        />
      </label>
      {items.map((item: EvidenceObject, index: number) => (
        <details key={`${item.id}-${index}`}>
          <summary>
            <strong>{item.name}</strong>
            <span>
              {item.path || "Placement unavailable"} · {item.type} ·{" "}
              {item.status}
            </span>
          </summary>
          <p>
            Publication:{" "}
            {item.published === true
              ? "Published"
              : item.published === false
                ? "Unpublished"
                : "Not captured"}
          </p>
          {item.excerpt && (
            <blockquote>
              {item.excerpt}
              <small>
                {item.excerptComplete
                  ? "Captured excerpt"
                  : "Partial captured excerpt; full content is not implied."}
              </small>
            </blockquote>
          )}
          {(item.actions || []).map((action: EvidenceObject, n: number) => (
            <p key={n}>
              <strong>
                {action.severity} · {action.verdict}
              </strong>
              <br />
              {action.sourceName}: {action.action}
            </p>
          ))}
        </details>
      ))}
      {!!view.unmappedSource?.length && (
        <>
          <h3>Source items outside the matched Coursera view</h3>
          <p>
            Check each item’s verdict and policy before making a course edit.
          </p>
          <pre className="evidence-json">
            {JSON.stringify(view.unmappedSource, null, 2)}
          </pre>
        </>
      )}
    </section>
  );
}
