import { useState } from "react";
import type {
  SourceQuestionBank,
  SourceQuestionCapture,
} from "../src/domain/external-source-questions";
import {
  sourceBankCoverage,
  sourceBankSettings,
  sourceQuestionCaptureText,
} from "../src/domain/source-bank-summary";
import { download, json } from "./workspace-ui";

export default function SourceBankTools({
  capture,
}: {
  capture: SourceQuestionCapture;
}) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const banks = capture.bank ? [capture.bank] : capture.observedBanks || [];
  if (!banks.length) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(sourceQuestionCaptureText(capture));
      setFailed(false);
      setMessage(
        "Copied all captured source questions, answer evidence, feedback and settings. Coverage limitations are included.",
      );
    } catch {
      setFailed(true);
      setMessage(
        "Could not copy. Use Download questions and answers, or select the question text below.",
      );
    }
  }
  return (
    <section aria-label="Source question reuse" className="source-bank-tools">
      <h5>Can I recreate this assessment from CTI?</h5>
      {capture.status !== "CAPTURED" && (
        <p role="status">
          Partial source capture: whole-source coverage is not established. Each
          observed bank is shown separately. {capture.reason}
        </p>
      )}
      {banks.map((bank, index) => (
        <BankSummary
          key={`${bank.id}:${index}`}
          bank={bank}
          showId={banks.length > 1}
        />
      ))}
      <div className="button-row">
        <button type="button" className="secondary" onClick={() => void copy()}>
          Copy questions and answers
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            download(
              "CTI_source_questions_and_answers.txt",
              sourceQuestionCaptureText(capture),
              "text/plain;charset=utf-8",
            )
          }
        >
          Download questions and answers
        </button>
        {banks.some((b) => b.definitionJson) && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              download("CTI_source_definitions.json", json(capture))
            }
          >
            Download original definitions
          </button>
        )}
      </div>
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
    </section>
  );
}

function BankSummary({
  bank,
  showId,
}: {
  bank: SourceQuestionBank;
  showId: boolean;
}) {
  const settings = sourceBankSettings(bank),
    coverage = sourceBankCoverage(bank);
  return (
    <div>
      {showId && <h6>Observed bank {bank.id}</h6>}
      <p>
        Question text and choices:{" "}
        <strong>
          {coverage.text}/{coverage.total}
        </strong>{" "}
        complete in the readable view.
      </p>
      <p>
        Source-marked answer keys:{" "}
        <strong>
          {coverage.answers}/{coverage.total}
        </strong>{" "}
        captured.
      </p>
      <p>
        Feedback and hints:{" "}
        <strong>
          {coverage.feedback}/{coverage.total}
        </strong>{" "}
        inspected; {coverage.noFeedback} with none authored in the supported
        fields.
      </p>
      {!coverage.originalRetained && (
        <p role="status">
          Older capture: refresh source questions to collect answer keys,
          feedback and original definitions.
        </p>
      )}
      <details>
        <summary>What this capture verifies</summary>
        <p>
          Source-marked answers reproduce the source key; they are not
          independently checked for correctness. Flag suspected source errors
          for review.
        </p>
        <p>
          {coverage.originalRetained
            ? "Original assessment definitions are retained, including markup and settings. "
            : "Original assessment definitions were not retained in this older capture. "}
          Referenced media files and learner interactions remain unverified.
          Runtime defaults are not inferred.
        </p>
      </details>
      {settings && (
        <details>
          <summary>Authored assessment settings</summary>
          <p className="hint">
            These settings are explicitly recorded. Bank overrides can supersede
            individual question settings. Moving to another platform may require
            an intentional adaptation.
          </p>
          <p className="captured-text">{settings}</p>
        </details>
      )}
    </div>
  );
}
