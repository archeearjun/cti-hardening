import {
  publicSourceUrl,
  type SourceQuestionCapture,
} from "../src/domain/external-source-questions";
import { useEffect, useRef, useState } from "react";
import {
  sourceCountBases,
  questionDifference,
  questionSideLabel,
  withQuestionFollowUp,
  type QuestionComparison,
  type ReviewedSourceCount,
} from "../src/domain/question-counts";
import type { EvidenceObject } from "../src/domain/workspace-types";

export default function QuestionCountPanel({
  rows,
  capture,
  references,
  sourceCaptures = [],
  onFetch,
  editable,
  onSave,
}: {
  rows: QuestionComparison[];
  capture?: EvidenceObject;
  references: ReviewedSourceCount[];
  sourceCaptures?: SourceQuestionCapture[];
  onFetch?: (
    sourceKey: string,
    targetUrl: string,
    signal: AbortSignal,
  ) => Promise<void>;
  editable: boolean;
  onSave: (references: ReviewedSourceCount[]) => Promise<void>;
}) {
  const [sourceKey, setSourceKey] = useState(rows[0]?.sourceKey || "");
  const [count, setCount] = useState("");
  const [basis, setBasis] =
    useState<ReviewedSourceCount["basis"]>("published_list");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [checkedAt, setCheckedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [error, setError] = useState("");
  const [fetching, setFetching] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function fetchQuestions(sourceKey: string, url: string) {
    if (!onFetch || controller.current) return;
    const control = new AbortController();
    controller.current = control;
    setFetching(true);
    setElapsed(0);
    setError("");
    const started = Date.now(),
      timer = setInterval(
        () => setElapsed(Math.floor((Date.now() - started) / 1000)),
        1000,
      );
    try {
      await onFetch(sourceKey, url, control.signal);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(timer);
      controller.current = null;
      setFetching(false);
    }
  }
  if (!rows.length) return null;
  let comparisons: QuestionComparison[];
  try {
    comparisons = withQuestionFollowUp(
      rows,
      capture,
      references,
      sourceCaptures,
    );
  } catch (e) {
    return <p role="alert">{e instanceof Error ? e.message : String(e)}</p>;
  }
  const sourceChoices = rows.filter(
    (r, i) =>
      r.sourceKey && rows.findIndex((x) => x.sourceKey === r.sourceKey) === i,
  );
  return (
    <section
      className="question-counts"
      aria-label="Source versus Coursera question counts"
    >
      <h4>Expected source vs Coursera questions</h4>
      {fetching && (
        <p role="status">
          Fetching source definitions… {elapsed}s. The source fetch has a
          20-second limit.{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => controller.current?.abort()}
          >
            Cancel source fetch
          </button>
        </p>
      )}
      {error && (
        <p role="alert">{error} Previous saved evidence has been preserved.</p>
      )}
      {comparisons.map((row, i) => (
        <div className="question-count-row" key={`${row.sourceKey}:${i}`}>
          <strong>{row.sourceName}</strong>
          <small>{row.sourcePath}</small>
          <dl className="question-count-values">
            <div>
              <dt>Expected source</dt>
              <dd>
                {row.reference && !row.automaticSource ? (
                  <>
                    <strong>{row.reference.count}</strong> —{" "}
                    {sourceCountBases[row.reference.basis]}
                    <br />
                    <small>
                      Original capture: {questionSideLabel(row.source)}
                    </small>
                  </>
                ) : (
                  questionSideLabel(row.source)
                )}
                {row.automaticSource && row.originalSource && (
                  <small>
                    Original audit capture:{" "}
                    {questionSideLabel(row.originalSource)}
                  </small>
                )}
              </dd>
            </div>
            <div>
              <dt>Coursera captured</dt>
              <dd>
                {questionSideLabel(row.coursera)}
                {row.destinationObservation && (
                  <small>
                    Focused observation: {row.destinationObservation}
                  </small>
                )}
              </dd>
            </div>
          </dl>
          <p>{questionDifference(row)}</p>
          {row.automaticSource && (
            <p className="hint">
              <a
                href={row.automaticSource.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Automatically read source definitions ↗
              </a>{" "}
              · {row.automaticSource.capturedAt}
              <br />
              {row.automaticSource.bank?.count} question definitions; learner
              launch and interactions remain unverified.
            </p>
          )}
          {onFetch &&
            (row.source.count === null || row.automaticSource) &&
            row.sourceUrls.filter(publicSourceUrl).map((url, index, urls) => (
              <button
                key={url}
                type="button"
                className="primary"
                disabled={!editable || fetching}
                onClick={() => void fetchQuestions(row.sourceKey, url)}
              >
                {row.automaticSource
                  ? "Refresh source questions"
                  : "Fetch source questions"}
                {urls.length > 1 ? ` — source link ${index + 1}` : ""}
              </button>
            ))}
          {row.aligned !== null && (
            <p className="hint">
              Original audit: {row.aligned} aligned question positions. A count
              match alone does not verify fidelity.
            </p>
          )}
          {row.reference ? (
            <p className="hint">
              <a
                href={row.reference.referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Reviewed source reference ↗
              </a>{" "}
              · {row.reference.count} — {sourceCountBases[row.reference.basis]}
              {" · "}
              {row.reference.checkedAt}
              <br />
              {row.reference.note}
            </p>
          ) : (
            row.source.count === null &&
            row.sourceUrls.map((u) => (
              <p className="hint" key={u}>
                <a href={u} target="_blank" rel="noopener noreferrer">
                  Inspect source activity ↗
                </a>
              </p>
            ))
          )}
        </div>
      ))}
      <p className="hint">
        Saved evidence, not a live view. A working embedded quiz can preserve
        questions without native Coursera question records. Counts do not
        establish learner access, correct answers or approval. Shared
        destinations are not summed.
      </p>
      {!!sourceChoices.length && (
        <details>
          <summary>Add or update a reviewed source count</summary>
          <p className="hint">
            Use this when you have checked the exact source quiz or its
            published question list. Record the section and counting method.
            This supplements the saved audit; it does not claim automatic
            extraction.
          </p>
          <fieldset disabled={!editable}>
            <label>
              Source activity
              <select
                value={sourceKey}
                onChange={(e) => setSourceKey(e.target.value)}
              >
                {sourceChoices.map((r) => (
                  <option key={r.sourceKey} value={r.sourceKey}>
                    {r.sourceName} — {r.sourcePath}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expected source question count
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </label>
            <label>
              Source count evidence type
              <select
                value={basis}
                onChange={(e) =>
                  setBasis(e.target.value as ReviewedSourceCount["basis"])
                }
              >
                {Object.entries(sourceCountBases).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source count reference URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              Source count checked on
              <input
                type="date"
                value={checkedAt}
                onChange={(e) => setCheckedAt(e.target.value)}
              />
            </label>
            <label>
              Source count evidence note
              <textarea
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Exact quiz/section, how you counted, and any version or question-pool limits"
              />
            </label>
            <button
              type="button"
              onClick={async () => {
                setError("");
                try {
                  if (!count.trim() || !checkedAt)
                    throw new Error(
                      "Enter the count and the date you checked the source.",
                    );
                  const next = [
                    ...references.filter((r) => r.sourceKey !== sourceKey),
                    {
                      sourceKey,
                      count: Number(count),
                      basis,
                      referenceUrl: url.trim(),
                      checkedAt,
                      note: note.trim(),
                    },
                  ];
                  withQuestionFollowUp(rows, capture, next, sourceCaptures);
                  await onSave(next);
                  setCount("");
                  setUrl("");
                  setNote("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Save source count evidence
            </button>
          </fieldset>
        </details>
      )}
    </section>
  );
}
