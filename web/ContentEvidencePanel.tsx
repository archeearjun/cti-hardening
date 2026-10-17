import { useState } from "react";
import {
  contentQuestionText,
  type BrightspaceSourceBody,
  type ContentEvidence,
} from "../src/domain/content-evidence";
import type { ItemContentView } from "../src/domain/owner-content";
import { safeWebUrl } from "../src/domain/owner-urls";
import PublicContentFetch from "./PublicContentFetch";
import CtiAnswerPanel from "./CtiAnswerPanel";
import { choiceLabel, ctiAnswerCheck } from "../src/domain/cti-answer-check";
const labels = {
  COMPLETE: "Complete captured field",
  PARTIAL: "Partial / coverage unverified",
  UNVERIFIED: "Unverified",
  EMPTY: "Confirmed empty",
};
function SourceBodyEvidence({ body }: { body: BrightspaceSourceBody }) {
  const originalVerified =
    body.originalIntegrity === "VERIFIED_RETAINED_ORIGINAL";
  const outcome = originalVerified
    ? "Original file retained and verified at import"
    : body.textScope === "ORIGINAL_BODY"
      ? "Source text captured; original file unverified"
      : /NOT_FETCHED|NOT_READ|EXTERNAL/.test(body.status)
        ? "Source file not fetched"
        : "Original file capture unresolved";
  const referenceRole = (tag: string, attribute: string) => {
    const roles: Record<string, string> = {
      img: "Image",
      iframe: "Embedded page",
      video: "Video",
      audio: "Audio",
      source: "Media source",
      track: "Caption or text track",
      a: "Link",
      object: "Embedded object",
      embed: "Embedded content",
    };
    return `${roles[tag.toLowerCase()] || "Resource"}${tag ? ` (${tag}${attribute ? `.${attribute}` : ""})` : ""}`;
  };
  return (
    <section className="scope" aria-label="Brightspace source file evidence">
      <h6>Source file evidence</h6>
      <p>
        <strong>{outcome}</strong>
      </p>
      <p className="hint">
        Topic {body.topicId} · Collector outcome: {body.status || "Unrecorded"}
        {body.format && ` · Format: ${body.format.toUpperCase()}`}
        {body.contentType && ` · Content type: ${body.contentType}`}
      </p>
      {body.reason && <p className="hint">{body.reason}</p>}
      <details>
        <summary>Original file identity and text preview scope</summary>
        <p className="hint">
          Source read recorded: {body.observedAt || "Unrecorded"}
          {body.bytes !== null && ` · ${body.bytes.toLocaleString()} bytes`}
        </p>
        {body.sha256 && <p className="captured-text">SHA-256: {body.sha256}</p>}
        {body.originalRef && (
          <p className="captured-text">
            Retained original reference: {body.originalRef}
          </p>
        )}
        <p className="hint">
          {body.textScope === "ORIGINAL_BODY"
            ? "The text below is the captured source body or its recorded text projection."
            : body.textScope === "DESCRIPTION_FALLBACK"
              ? "The text below is the topic description. It does not stand in for the source file."
              : "This snapshot has no source body text preview. A binary file or an unresolved projection does not establish missing source content."}
        </p>
        {body.projectionStatus && (
          <p className="hint">Text projection: {body.projectionStatus}</p>
        )}
        {body.projectionReason && (
          <p className="hint">{body.projectionReason}</p>
        )}
        <p className="hint">
          This snapshot keeps file evidence and references, not downloadable
          original bytes. File verification does not establish playback,
          interactions or whole-course completeness.
        </p>
      </details>
      {!!body.references.length && (
        <details>
          <summary>
            Source file references and read outcomes ({body.references.length})
          </summary>
          <p className="hint">
            These are recorded references. CTI does not load embedded pages or
            media while displaying this evidence.
          </p>
          <ol>
            {body.references.map((reference, index) => (
              <li key={index}>
                <p>
                  <strong>
                    {referenceRole(reference.tag, reference.attribute)}
                  </strong>{" "}
                  · Read outcome: {reference.status || "Unrecorded"}
                </p>
                <p className="captured-text">
                  {safeWebUrl(reference.url) ? (
                    <a
                      href={safeWebUrl(reference.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {reference.url}
                    </a>
                  ) : (
                    reference.url || reference.rawUrl || "URL unrecorded"
                  )}
                </p>
                {reference.rawUrl && reference.rawUrl !== reference.url && (
                  <p className="captured-text">
                    Authored reference: {reference.rawUrl}
                  </p>
                )}
                {reference.reason && <p className="hint">{reference.reason}</p>}
                {reference.alt !== "" && (
                  <p className="captured-text">
                    Authored image alt text: {reference.alt}
                  </p>
                )}
                {reference.text !== "" && (
                  <p className="captured-text">
                    Authored reference text: {reference.text}
                  </p>
                )}
                {reference.originalRef && (
                  <p className="captured-text">
                    Retained original reference: {reference.originalRef}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
function Evidence({
  content,
  query,
  showQuestions,
}: {
  content: ContentEvidence;
  query: string;
  showQuestions: boolean;
}) {
  const [limit, setLimit] = useState(50);
  const [copyStatus, setCopyStatus] = useState("");
  const imageAltText = (content.imageAltText || []).filter(
    (image) => image.text !== "",
  );
  const literalCaptions =
    content.sourceBody?.textScope === "ORIGINAL_BODY" &&
    /^(srt|vtt)$/i.test(content.sourceBody.format);
  const filtered = content.questions.filter(
    (q) =>
      !query.trim() ||
      [
        q.ordinal,
        q.type,
        q.prompt,
        ...q.options.flatMap((o) => [o.text, o.feedback || ""]),
        ...q.answers,
        q.feedback,
        ctiAnswerCheck(q).answer,
        ctiAnswerCheck(q).comparison,
      ]
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
      {content.sourceBody && <SourceBodyEvidence body={content.sourceBody} />}
      {content.nativeGrading && (
        <section className="scope" aria-label="Captured grading setting">
          <h6>Captured grading setting</h6>
          <p>
            <strong>
              {content.nativeGrading.graded ? "Graded" : "Not graded"}
            </strong>{" "}
            · Native authoring draft
          </p>
          <p className="hint">
            Native field: {content.nativeGrading.field} ={" "}
            {String(content.nativeGrading.graded)}
          </p>
          <p className="hint">
            Observed: {content.nativeGrading.observedAt || "Unrecorded"}
          </p>
          <p className="hint">
            This records the grading toggle only. Passing score, attempts,
            complete assessment behavior, learner operation and published state
            are not established by this setting.
          </p>
          <details>
            <summary>Native grading source identity</summary>
            <p className="captured-text">
              Course: {content.nativeGrading.courseId}
              {"\n"}Item: {content.nativeGrading.itemId}
              {"\n"}Atom: {content.nativeGrading.atomId}
              {"\n"}Content: {content.nativeGrading.contentId}
              {"\n"}Stored atom version:{" "}
              {content.nativeGrading.storedAtomVersion}
              {"\n"}Native modification value: {content.nativeGrading.updatedAt}
              {"\n"}Draft SHA-256: {content.nativeGrading.draftHash}
              {"\n"}Method: {content.nativeGrading.method}
              {"\n"}Scope: {content.nativeGrading.scope}
            </p>
          </details>
        </section>
      )}
      {showQuestions && (
        <>
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
        </>
      )}
      {!!content.questions.length && (
        <>
          <p role="status">
            Showing {Math.min(limit, filtered.length)} of {filtered.length}{" "}
            matching captured questions.
          </p>
          <p className="hint">
            CTI independently calculates supported arithmetic, rounding and
            percentage questions. Non-math, ambiguous or unsupported questions
            need a subject review. These checks do not change the captured keys
            or approve the item.
          </p>
          <ol className="captured-questions">
            {filtered.slice(0, limit).map((q, i) => (
              <li key={`${q.id}:${i}`}>
                <strong>
                  Question {q.ordinal} · {q.type}
                </strong>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Copy question ${q.ordinal} with captured answers`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        contentQuestionText(q),
                      );
                      setCopyStatus(
                        `Question ${q.ordinal} copied with its captured evidence and limitations.`,
                      );
                    } catch {
                      setCopyStatus(
                        "Could not copy. Select the displayed text or use the question-bank download.",
                      );
                    }
                  }}
                >
                  Copy question and answer
                </button>
                <div className="captured-text">
                  {q.prompt || "Prompt not captured"}
                </div>
                {!!q.options.length && (
                  <ul aria-label={`Captured choices for question ${q.ordinal}`}>
                    {q.options.map((o, j) => (
                      <li key={j}>
                        <span className="captured-text">
                          <strong>{choiceLabel(j)}: </strong>
                          {o.text || "Choice text not captured"}
                        </span>
                        {o.feedback && (
                          <div className="captured-text">
                            <strong>Captured feedback: </strong>
                            {o.feedback}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {q.answerCoverage && (
                  <p className="hint">
                    Source answer key:{" "}
                    {q.answerCoverage === "CAPTURED"
                      ? "Captured from definitions; see the separate CTI check below"
                      : "Incomplete / unverified"}
                  </p>
                )}
                {!!q.answers.length && (
                  <details open={!!q.answerCoverage}>
                    <summary>
                      {q.answerCoverage
                        ? "Source-marked answers"
                        : "Captured answer evidence"}
                    </summary>
                    {q.answers.map((a, j) => (
                      <p className="captured-text" key={j}>
                        {a}
                      </p>
                    ))}
                  </details>
                )}
                <CtiAnswerPanel question={q} />
                {q.feedback && (
                  <details>
                    <summary>Captured feedback and hints</summary>
                    <p className="captured-text">{q.feedback}</p>
                  </details>
                )}
                {q.feedbackCoverage === "NONE_AUTHORED" && (
                  <p className="hint">
                    No feedback or hints authored in the supported definition
                    fields.
                  </p>
                )}
                {q.feedbackCoverage === "UNVERIFIED" && (
                  <p className="hint">Feedback and hint coverage unverified.</p>
                )}
                {q.settingsText && (
                  <details>
                    <summary>Explicit question settings</summary>
                    <p className="captured-text">{q.settingsText}</p>
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
          {copyStatus && <p role="status">{copyStatus}</p>}
          {filtered.length > limit && (
            <button className="secondary" onClick={() => setLimit(limit + 50)}>
              Show next 50 captured questions
            </button>
          )}
        </>
      )}
      <details open={!!content.text}>
        <summary>
          {literalCaptions
            ? `Literal source captions (${content.sourceBody?.format.toUpperCase()})`
            : content.sourceBody?.textScope === "DESCRIPTION_FALLBACK"
              ? "Topic description"
              : "Reading / surrounding text"}{" "}
          ·{" "}
          {content.sourceBody?.textScope === "NO_TEXT"
            ? "Text preview unavailable"
            : content.textCoverage === "EMPTY"
              ? "Empty captured text field"
              : labels[content.textCoverage]}{" "}
          · {content.text.length} retained characters
        </summary>
        <p className="hint">{content.textReason}</p>
        {content.text &&
          (literalCaptions ? (
            <pre
              className="captured-text reading-text"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {content.text}
            </pre>
          ) : (
            <div className="captured-text reading-text">{content.text}</div>
          ))}
      </details>
      {content.sourceBody?.descriptionText &&
        content.sourceBody.textScope !== "DESCRIPTION_FALLBACK" && (
          <details>
            <summary>
              Native topic description (separate from file body)
            </summary>
            <p className="hint">
              This is the captured topic-description text projection. It does
              not replace the source file above.
              {content.sourceBody.descriptionTruncated &&
                " The description exceeds this snapshot’s text limit; only the retained portion is shown."}
            </p>
            <div className="captured-text reading-text">
              {content.sourceBody.descriptionText}
            </div>
          </details>
        )}
      {!!imageAltText.length && (
        <details>
          <summary>Authored image alt text</summary>
          {imageAltText.map((image) => (
            <div key={image.imageOrdinal}>
              <p className="hint">Source image {image.imageOrdinal}</p>
              <div className="captured-text">{image.text}</div>
            </div>
          ))}
        </details>
      )}
      {!!content.references.length && (
        <details>
          <summary>
            Captured resource references ({content.references.length})
          </summary>
          <p className="hint">
            Reference totals can include package pages, template resources and
            links. Comparing these totals does not establish how many learner
            assets are missing.
          </p>
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
  onFetchLinked,
  showQuestions = true,
}: {
  view: ItemContentView;
  showQuestions?: boolean;
  onCapture?: () => void;
  disabled: boolean;
  onFetchLinked?: (url: string, signal: AbortSignal) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  return (
    <details className="content-comparison" open>
      <summary>
        {showQuestions
          ? "Compare captured questions and text"
          : "Compare captured text and references"}
      </summary>
      <p>
        Both sides show saved content. Complete refers to the stated field or
        question positions, not whole-course fidelity.{" "}
        {showQuestions &&
          "Questions are listed in each capture’s order; matching numbers do not establish matching questions."}
      </p>
      {onCapture && (
        <button className="secondary" disabled={disabled} onClick={onCapture}>
          Copy manual Coursera capture script
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
      {showQuestions && (
        <label>
          Find captured question text
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Question wording or choice text"
          />
        </label>
      )}
      <div className="content-comparison-columns">
        <section aria-label="Source captured content">
          <h5>Source content</h5>
          {view.source.map((c, i) => (
            <Evidence
              key={i}
              content={c}
              query={query}
              showQuestions={showQuestions}
            />
          ))}
        </section>
        <section aria-label="Coursera captured content">
          <h5>Coursera content</h5>
          {!!view.courseraTargets.length && (
            <div className="scope">
              <p>
                This Coursera item contains recorded public links. Fetch their
                text and questions separately; this does not verify that they
                load inside Coursera.
              </p>
              {view.courseraTargets.map((url) => (
                <div key={url}>
                  <p>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  </p>
                  {onFetchLinked && (
                    <PublicContentFetch
                      sourceKey="coursera-linked-page"
                      url={url}
                      disabled={disabled}
                      label="Fetch linked Coursera page"
                      cancelLabel="Cancel Coursera page fetch"
                      onFetch={(_, target, signal) =>
                        onFetchLinked(target, signal)
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {view.coursera.basis === "Older report excerpt" &&
            !view.courseraTargets.length && (
              <p className="hint">
                To recover this item’s captured text and embedded links, use
                “Load original extraction content into an older report” above
                the item list. Upload the original Coursera extraction JSON used
                for this report.
              </p>
            )}
          {view.linkedCoursera.map((c, i) => (
            <Evidence
              key={i}
              content={c}
              query={query}
              showQuestions={showQuestions}
            />
          ))}
          <Evidence
            content={view.coursera}
            query={query}
            showQuestions={showQuestions}
          />
          {!!view.previousLinkedCoursera.length && (
            <details>
              <summary>
                Previous linked-page content — current reference unverified
              </summary>
              {view.previousLinkedCoursera.map((c, i) => (
                <Evidence
                  key={i}
                  content={c}
                  query={query}
                  showQuestions={showQuestions}
                />
              ))}
            </details>
          )}
          {view.previousCoursera && (
            <details>
              <summary>Previous Coursera observation (kept separately)</summary>
              <Evidence
                content={view.previousCoursera}
                query={query}
                showQuestions={showQuestions}
              />
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
            <Evidence
              key={i}
              content={c}
              query={query}
              showQuestions={showQuestions}
            />
          ))}
        </details>
      )}
    </details>
  );
}
