import { useState } from "react";
import type { ContentEvidence } from "../src/domain/content-evidence";
import type { ItemContentView } from "../src/domain/owner-content";
import { safeWebUrl } from "../src/domain/owner-urls";
const labels = {
  COMPLETE: "Complete captured field",
  PARTIAL: "Partial / coverage unverified",
  UNVERIFIED: "Unverified",
  EMPTY: "Confirmed empty",
};
function Evidence({
  content,
  query,
}: {
  content: ContentEvidence;
  query: string;
}) {
  const [limit, setLimit] = useState(50);
  const filtered = content.questions.filter((q) =>
    [q.ordinal, q.type, q.prompt, ...q.options.map((o) => o.text)]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <article className="captured-content">
      <h6>{content.basis}</h6>
      <p className="hint">
        {content.capturedAt || "Capture time unrecorded"}
        {safeWebUrl(content.url) && (
          <>
            {" "}
            ·{" "}
            <a
              href={safeWebUrl(content.url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open recorded page ↗
            </a>
          </>
        )}
      </p>
      <p>
        <strong>
          Question positions:{" "}
          {content.questionCoverage === "COMPLETE"
            ? "Complete captured set"
            : labels[content.questionCoverage]}
        </strong>{" "}
        · {content.questions.length} captured /{" "}
        {content.expectedQuestions ?? "unknown"} expected
      </p>
      <p className="hint">{content.questionReason}</p>
      {!!content.questions.length && (
        <>
          <p role="status">
            Showing {Math.min(limit, filtered.length)} of {filtered.length}{" "}
            matching captured questions.
          </p>
          <ol className="captured-questions">
            {filtered.slice(0, limit).map((q, i) => (
              <li key={`${q.id}:${i}`}>
                <strong>
                  Question {q.ordinal} · {q.type}
                </strong>
                <div className="captured-text">
                  {q.prompt || "Prompt not captured"}
                </div>
                {!!q.options.length && (
                  <ul aria-label={`Captured choices for question ${q.ordinal}`}>
                    {q.options.map((o, j) => (
                      <li key={j}>
                        <span className="captured-text">
                          {o.text || "Choice text not captured"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {!!q.answers.length && (
                  <details>
                    <summary>Captured answer evidence</summary>
                    {q.answers.map((a, j) => (
                      <p className="captured-text" key={j}>
                        {a}
                      </p>
                    ))}
                  </details>
                )}
                {q.feedback && (
                  <details>
                    <summary>Captured feedback</summary>
                    <p className="captured-text">{q.feedback}</p>
                  </details>
                )}
                {!!q.media.length && (
                  <details>
                    <summary>
                      Media references ({q.media.length}) — rendering unverified
                    </summary>
                    {q.media.map((r, j) => (
                      <p key={j}>
                        {safeWebUrl(r) ? (
                          <a
                            href={safeWebUrl(r)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {r}
                          </a>
                        ) : (
                          r
                        )}
                      </p>
                    ))}
                  </details>
                )}
                {!!q.limitations.length && (
                  <p className="hint">{q.limitations.join(" ")}</p>
                )}
              </li>
            ))}
          </ol>
          {filtered.length > limit && (
            <button className="secondary" onClick={() => setLimit(limit + 50)}>
              Show next 50 captured questions
            </button>
          )}
        </>
      )}
      <details open={!!content.text}>
        <summary>
          Reading / surrounding text · {labels[content.textCoverage]} ·{" "}
          {content.text.length} retained characters
        </summary>
        <p className="hint">{content.textReason}</p>
        {content.text && (
          <div className="captured-text reading-text">{content.text}</div>
        )}
      </details>
      {!!content.references.length && (
        <details>
          <summary>
            Captured resource references ({content.references.length})
          </summary>
          {content.references.map((r, i) => (
            <p key={i}>
              {safeWebUrl(r) ? (
                <a
                  href={safeWebUrl(r)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {r}
                </a>
              ) : (
                r
              )}
            </p>
          ))}
        </details>
      )}
      {content.limitations.map((l, i) => (
        <p className="hint" key={i}>
          {l}
        </p>
      ))}
    </article>
  );
}
export default function ContentEvidencePanel({
  view,
  onCapture,
  disabled,
}: {
  view: ItemContentView;
  onCapture?: () => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  return (
    <details className="content-comparison" open>
      <summary>Compare captured questions and text</summary>
      <p>
        Both sides show saved content. Complete refers to the stated field or
        question positions, not whole-course fidelity. Questions are listed in
        each capture’s order; matching numbers do not establish matching
        questions.
      </p>
      {onCapture && (
        <button className="secondary" disabled={disabled} onClick={onCapture}>
          Capture Coursera content
        </button>
      )}
      {onCapture && (
        <p className="hint">
          Copies the current item extractor. Run it in the linked Coursera item
          in your signed-in Chrome tab, then import its JSON using “Import the
          downloaded item-check JSON” below. CTI cannot read your Coursera
          session from this page.
        </p>
      )}
      <label>
        Find captured question text
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Question wording or choice text"
        />
      </label>
      <div className="content-comparison-columns">
        <section aria-label="Source captured content">
          <h5>Source content</h5>
          {view.source.map((c, i) => (
            <Evidence key={i} content={c} query={query} />
          ))}
        </section>
        <section aria-label="Coursera captured content">
          <h5>Coursera content</h5>
          <Evidence content={view.coursera} query={query} />
          {view.previousCoursera && (
            <details>
              <summary>Previous Coursera observation (kept separately)</summary>
              <Evidence content={view.previousCoursera} query={query} />
            </details>
          )}
        </section>
      </div>
      {!!view.observations.length && (
        <details>
          <summary>
            Separate plugin-page observations — launch and full-plugin coverage
            unverified
          </summary>
          {view.observations.map((c, i) => (
            <Evidence key={i} content={c} query={query} />
          ))}
        </details>
      )}
    </details>
  );
}
