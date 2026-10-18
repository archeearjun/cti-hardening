import { useEffect, useId, useRef, useState } from "react";
import type {
  CaptureReviewBundleManifest,
  PreparedCaptureReviewBundle,
} from "../src/domain/capture-review-bundle";

type Ready = {
  url: string;
  name: string;
  bytes: number;
  sha256: string;
  underSharingTarget: boolean;
  manifest: CaptureReviewBundleManifest;
};

/** The worker verifies originals; only the finished review Blob and its explicit
 * scope cross back to the UI. Persistent downloads require the owner's click. */
export default function CaptureContentReviewBundlePanel({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const titleId = useId();
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [error, setError] = useState(""),
    [ready, setReady] = useState<Ready | null>(null),
    [message, setMessage] = useState("");
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0),
    downloadUrl = useRef("");
  function release() {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = "";
  }
  function stop() {
    sequence.current++;
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  }
  useEffect(
    () => () => {
      sequence.current++;
      worker.current?.terminate();
      release();
    },
    [],
  );
  function select(next: File | null) {
    stop();
    release();
    setReady(null);
    setFile(next);
    setPhase("");
    setError("");
    setMessage("");
  }
  function prepare() {
    stop();
    release();
    setReady(null);
    setError("");
    setMessage("");
    if (!file) return;
    const id = sequence.current;
    try {
      const current = new Worker(
        new URL("./capture-review-bundle.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = current;
      setBusy(true);
      setPhase("Verifying your original capture locally…");
      current.onmessage = ({ data }) => {
        if (id !== sequence.current) return;
        if (data.kind === "progress") {
          setPhase(data.phase);
          return;
        }
        try {
          if (data.kind !== "result")
            throw Error(
              data.message ||
                "The content review bundle could not be prepared.",
            );
          const result: PreparedCaptureReviewBundle = data.result;
          if (
            !(result.file instanceof Blob) ||
            !result.file.size ||
            result.manifest?.kind !== "CTI_CAPTURE_REVIEW_BUNDLE" ||
            result.manifest.notForCourseAudit !== true
          )
            throw Error("The local worker returned an invalid review result.");
          const url = URL.createObjectURL(result.file);
          downloadUrl.current = url;
          setReady({
            url,
            name: result.file.name,
            bytes: result.file.size,
            sha256: result.sha256,
            underSharingTarget: result.underSharingTarget,
            manifest: result.manifest,
          });
          setPhase("");
        } catch (failure) {
          release();
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
        }
        setBusy(false);
        current.terminate();
        worker.current = null;
      };
      current.onerror = () => {
        if (id !== sequence.current) return;
        setError(
          "Local review preparation could not finish. Open CTI directly in current Chrome and choose the same existing capture.",
        );
        setBusy(false);
        current.terminate();
        worker.current = null;
      };
      current.postMessage({ file });
    } catch (failure) {
      stop();
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  const mib = (bytes: number) => `${(bytes / 1048576).toFixed(2)} MiB`;
  return (
    <section
      className="capture-content-review-bundle"
      aria-labelledby={titleId}
    >
      <h3 id={titleId}>Content review bundle</h3>
      <p>
        Prepare one smaller file for a detailed content review. CTI keeps the
        exact native manifest with captured questions, source-marked answers,
        settings and gaps, plus all supported textual originals. Large binary
        originals stay in your full capture and are listed with their verified
        hashes, sizes and item identities.
      </p>
      <p className="hint">
        Runs locally without uploading, creating a public link or rescanning.
        Keep using the original capture for CTI comparisons and media
        inspection. This review copy excludes binary originals and cannot
        establish whole-course completeness.
      </p>
      <label>
        Original capture archive for content review
        <input
          type="file"
          accept=".cti.zip,application/zip"
          disabled={disabled}
          onChange={(event) => select(event.target.files?.[0] ?? null)}
        />
      </label>
      {file && (
        <p style={{ overflowWrap: "anywhere" }}>
          Selected: <strong>{file.name}</strong> · {mib(file.size)}
        </p>
      )}
      <div className="action-links">
        <button
          className="primary"
          disabled={disabled || busy || !file}
          onClick={prepare}
        >
          Prepare content review bundle
        </button>
        {busy && (
          <button
            className="secondary"
            onClick={() => {
              stop();
              setPhase("");
              setMessage(
                "Review preparation cancelled. Your original capture is unchanged.",
              );
            }}
          >
            Cancel review preparation
          </button>
        )}
      </div>
      {busy && <p role="status">{phase}</p>}
      {error && <p role="alert">{error} Your original capture is unchanged.</p>}
      {ready && (
        <>
          <p role="status">
            Content review ready: <strong>{mib(ready.bytes)}</strong> ·{" "}
            {ready.manifest.counts.includedTextOriginals} unchanged textual
            originals · {ready.manifest.counts.omittedOriginals} binary or
            unrecognized originals indexed and omitted.
          </p>
          {ready.underSharingTarget ? (
            <p>
              Download this one review file and attach it to your chat. It
              contains no cropped native text or question models. Upload limits
              can vary by chat or account.
            </p>
          ) : (
            <p role="status">
              The complete review file exceeds the 24 MiB sharing target.
              Nothing was trimmed. You can download it intact below and share a
              restricted storage link, or use complete-file sharing below for
              attachment parts. Your chat's upload limits still apply.
            </p>
          )}
          <a
            className="primary"
            href={ready.url}
            download={ready.name}
            onClick={() =>
              setMessage(
                "Review download requested. Check Chrome’s downloads. This link remains available until you select another file or leave this page.",
              )
            }
          >
            Download content review bundle
          </a>
          <p className="hint">
            Review only — not a CTI comparison input. The original native
            manifest is unchanged. Every original in the selected archive passed
            byte and identity checks; this does not verify playback or source
            correctness.
          </p>
          <details>
            <summary>Review identity and scope</summary>
            <p style={{ overflowWrap: "anywhere" }}>SHA-256: {ready.sha256}</p>
            <p>
              {ready.manifest.platform} ·{" "}
              {ready.manifest.counts.originalsVerified} verified originals ·{" "}
              {mib(ready.manifest.counts.omittedOriginalBytes)} original binary
              or unrecognized bytes deliberately absent. The archive contains an
              explicit media index and review manifest.
            </p>
          </details>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
