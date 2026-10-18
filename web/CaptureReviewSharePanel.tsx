import { useEffect, useRef, useState } from "react";
import type { CaptureShareReview } from "../src/domain/capture-share-review";
import { COURSERA_CAPTURE_FILE_ACCEPT } from "../src/domain/coursera-capture-file";
import { download } from "./workspace-ui";
import CaptureFileTransferPanel from "./CaptureFileTransferPanel";
import CaptureContentReviewBundlePanel from "./CaptureContentReviewBundlePanel";

/** No upload, external requests, or persistent storage: only the bounded review
 * returns from the worker. The user's existing capture stays on their device. */
export default function CaptureReviewSharePanel({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const [review, setReview] = useState<CaptureShareReview | null>(null),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const worker = useRef<Worker | null>(null),
    textarea = useRef<HTMLTextAreaElement | null>(null),
    sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
      worker.current?.terminate();
    },
    [],
  );
  const reviewText = review ? JSON.stringify(review, null, 2) : "";
  function stop() {
    sequence.current++;
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  }
  function inspect(file?: File) {
    stop();
    setReview(null);
    setMessage("");
    setError("");
    setPhase("");
    if (!file) return;
    const id = sequence.current;
    setBusy(true);
    setPhase("Starting local capture review…");
    try {
      const current = new Worker(
        new URL("./capture-share.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = current;
      current.onmessage = ({ data }) => {
        if (id !== sequence.current) return;
        if (data.kind === "progress") {
          setPhase(data.phase);
          return;
        }
        if (data.kind === "result") setReview(data.report);
        else
          setError(
            data.message || "The capture could not be reviewed locally.",
          );
        setBusy(false);
        current.terminate();
        worker.current = null;
      };
      current.onerror = () => {
        if (id !== sequence.current) return;
        setError(
          "Local inspection could not start. Open CTI in Chrome and select the same existing capture.",
        );
        setBusy(false);
        current.terminate();
        worker.current = null;
      };
      current.postMessage({ file });
    } catch {
      setError(
        "This browser cannot run local inspection. Open CTI in Chrome and select the same existing capture.",
      );
      setBusy(false);
    }
  }
  function select() {
    textarea.current?.focus();
    textarea.current?.select();
    setMessage(
      "Review text selected. Copy it, then paste it into your support chat.",
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(reviewText);
      setMessage("Review text copied. Paste it into your support chat.");
    } catch {
      textarea.current?.focus();
      textarea.current?.select();
      setMessage(
        "Clipboard access is unavailable here. The text is selected; use Copy from your browser or keyboard, then paste it into your support chat.",
      );
    }
  }
  return (
    <section
      className="card capture-share-review"
      aria-labelledby="capture-share-title"
    >
      <h2 id="capture-share-title">Share a capture review</h2>
      <p>
        Prepare a smaller content review bundle, share the full original file,
        or copy a small diagnostic review. These run on this device without
        uploading anything or extracting the course again.
      </p>
      <p className="hint">
        If CTI is open inside ChatGPT, copy this address into Chrome's address
        bar, then select your existing capture there:
      </p>
      <label>
        CTI capture review address
        <input
          type="url"
          readOnly
          value="https://cti-hardening.pages.dev/?tool=share"
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <p className="hint">
        <a
          href="https://cti-hardening.pages.dev/?tool=share"
          target="_blank"
          rel="noreferrer"
        >
          Open capture review
        </a>
        . Use Chrome to prepare and download the content review bundle or
        complete original-file parts.
      </p>
      <CaptureContentReviewBundlePanel disabled={disabled} />
      <CaptureFileTransferPanel disabled={disabled} />
      <h3>Small diagnostic review (optional)</h3>
      <p className="hint">
        This separate review excludes original media and full content bodies. It
        can help diagnose a capture but cannot replace the complete file.
      </p>
      <label>
        Existing capture JSON, JSON.gz or CTI ZIP
        <input
          type="file"
          accept={COURSERA_CAPTURE_FILE_ACCEPT}
          disabled={disabled}
          onChange={(event) => inspect(event.target.files?.[0])}
        />
      </label>
      {busy && (
        <div>
          <p role="status">{phase}</p>
          <button
            className="secondary"
            onClick={() => {
              stop();
              setPhase("");
              setMessage(
                "Local inspection cancelled. Your original capture is unchanged.",
              );
            }}
          >
            Cancel local inspection
          </button>
        </div>
      )}
      {error && <p role="alert">{error} Your original capture is unchanged.</p>}
      {review && (
        <>
          <p role="status">
            Local check:{" "}
            <strong>
              {review.localCheck.status === "PASSED"
                ? "passed within the stated scope"
                : "failed — details retained in the review"}
            </strong>
            . Whole-course coverage: <strong>unverified</strong>.
          </p>
          <p className="hint">
            This small report includes counts, source item identities, findings
            and omissions. Original media and full course/question bodies are
            excluded; findings may contain short excerpts. A local consistency
            check is not proof that the course is fully extracted.
          </p>
          <div className="action-links">
            <button className="primary" onClick={() => void copy()}>
              Copy review text
            </button>
            <button className="secondary" onClick={select}>
              Select all review text
            </button>
          </div>
          <label>
            Review text to paste into your chat
            <textarea
              ref={textarea}
              readOnly
              rows={12}
              value={reviewText}
              aria-label="Capture review text to copy"
            />
          </label>
          <details>
            <summary>Optional review file</summary>
            <p>
              The copied text is sufficient for a first review. Keep the full
              capture for original-file verification or a complete comparison.
            </p>
            <button
              className="secondary"
              onClick={() => {
                try {
                  download(
                    `CTI_CAPTURE_SHARE_REVIEW_${review.platform}.json`,
                    reviewText,
                  );
                  setMessage(
                    "Download requested. Check your browser's downloads. If nothing saves, use Copy review text or Select all review text above.",
                  );
                } catch {
                  setMessage(
                    "The browser could not request a download. Use Copy review text or Select all review text above.",
                  );
                }
              }}
            >
              Download small review JSON
            </button>
          </details>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
