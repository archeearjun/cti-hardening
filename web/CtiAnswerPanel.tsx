import { useState } from "react";
import type { ContentQuestion } from "../src/domain/content-evidence";
import {
  ctiAnswerCheck,
  questionReviewBrief,
} from "../src/domain/cti-answer-check";

export default function CtiAnswerPanel({
  question,
}: {
  question: ContentQuestion;
}) {
  const check = ctiAnswerCheck(question);
  const [copyStatus, setCopyStatus] = useState("");
  return (
    <section
      className="scope cti-answer"
      aria-label={`CTI answer check for question ${question.ordinal}`}
    >
      <p>
        <strong>CTI answer: {check.answer}</strong>
      </p>
      {check.working !== check.comparisonReason && <p>{check.working}</p>}
      <p>
        <strong>
          {check.comparison === "CONFLICT"
            ? "Answer-key conflict. "
            : check.comparison === "AGREES"
              ? "Answer-key agreement. "
              : "Key comparison unverified. "}
        </strong>
        {check.comparisonReason}
      </p>
      <p className="hint">
        {check.status === "CALCULATED"
          ? "Method: exact arithmetic for supported wording. "
          : "Independent answer not established. "}
        Letters follow this capture's choice order. Match the text if shuffled.
      </p>
      <details
        open={
          check.status === "NEEDS_REVIEW" || check.comparison === "CONFLICT"
        }
      >
        <summary>What to do with this check</summary>
        <p>{check.nextAction}</p>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                questionReviewBrief(question),
              );
              setCopyStatus(
                "Independent review brief copied without the captured key or feedback. Add the relevant lesson or authoritative reference for the reviewer.",
              );
            } catch {
              setCopyStatus("Could not copy. Select the review brief below.");
            }
          }}
        >
          Copy independent review brief
        </button>
        <details>
          <summary>Independent review brief</summary>
          <p className="captured-text">{questionReviewBrief(question)}</p>
        </details>
        {copyStatus && <p role="status">{copyStatus}</p>}
      </details>
    </section>
  );
}
