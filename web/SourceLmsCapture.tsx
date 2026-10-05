import { useEffect, useRef, useState } from "react";
import { getExtractor } from "../src/domain/capture-review";
import { inspectBrightspaceCaptureFile } from "../src/domain/brightspace-local-extraction";
import type { ExtractorDelivery, ReviewResult } from "../src/domain/types";
import { download } from "./workspace-ui";

export default function SourceLmsCapture({
  disabled,
  partner,
  courseTitle,
  selectedFile,
  onUseCapture,
  onPlan,
  onCompare,
}: {
  disabled: boolean;
  partner: string;
  courseTitle: string;
  selectedFile: string;
  onUseCapture: (file: File) => void;
  onPlan: () => void;
  onCompare: () => void;
}) {
  const [extractor, setExtractor] = useState<ExtractorDelivery | null>(null);
  const [inspection, setInspection] = useState<{
    file: File;
    result: ReviewResult;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function prepare(copy: boolean) {
    setError("");
    try {
      const current = extractor || getExtractor("brightspace");
      setExtractor(current);
      if (copy) {
        try {
          await navigator.clipboard.writeText(current.script);
          setMessage(
            `${current.version} copied. Paste it in the Brightspace course console.`,
          );
        } catch {
          setMessage(
            "Clipboard access is unavailable. Download the extractor or use the manual-copy field.",
          );
        }
      } else {
        download(
          `CTI-brightspace-${current.version}.js`,
          current.script,
          "text/javascript",
        );
        setMessage(`${current.version} downloaded.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function inspect(file?: File) {
    const id = ++request.current;
    setInspection(null);
    setConfirmed(false);
    setError("");
    setMessage("");
    setBusy(!!file);
    if (!file) return;
    try {
      const result = await inspectBrightspaceCaptureFile(file, partner);
      if (id === request.current) setInspection({ file, result });
    } catch (e) {
      if (id === request.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <section className="card source-capture">
      <h2>Capture the Brightspace source</h2>
      <p>
        Selected CTI course:{" "}
        <strong>{courseTitle || "Choose a source course above"}</strong>
      </p>
      <p>
        Do this alongside IMSCC inspection, before deciding what to change in
        Coursera. The package may contain only a link or wrapper for content
        that is available in the live source.
      </p>
      <ol className="local-extraction-steps">
        <li>
          <strong>
            Open the matching Brightspace course in your signed-in Chrome.
          </strong>
          <span>
            The extractor uses your existing access and respects permission
            failures.
          </span>
        </li>
        <li>
          <strong>Copy the current Brightspace extractor.</strong>
          <span>
            Paste it once into that course tab’s DevTools → Console. Keep the
            tab open until the JSON downloads.
          </span>
        </li>
        <li>
          <strong>Inspect the downloaded source JSON here.</strong>
          <span>
            Check the course title and recorded gaps, then select it for
            comparison.
          </span>
        </li>
      </ol>
      <div className="action-links">
        <button
          className="primary"
          disabled={disabled || busy}
          onClick={() => void prepare(true)}
        >
          Copy current Brightspace extractor
        </button>
        <button
          className="secondary"
          disabled={disabled || busy}
          onClick={() => void prepare(false)}
        >
          Download Brightspace extractor
        </button>
      </div>
      {extractor && (
        <details>
          <summary>Manual-copy Brightspace extractor</summary>
          <textarea
            aria-label="Brightspace extractor script"
            readOnly
            value={extractor.script}
            onFocus={(e) => e.currentTarget.select()}
          />
        </details>
      )}
      <label>
        Downloaded Brightspace source JSON
        <input
          type="file"
          accept=".json"
          disabled={disabled || !courseTitle}
          onChange={(event) => void inspect(event.target.files?.[0])}
        />
      </label>
      {busy && <p role="status">Inspecting source capture…</p>}
      {error && (
        <p role="alert">
          {error} Any previously selected comparison file is unchanged.
        </p>
      )}
      {inspection && (
        <section aria-label="Brightspace capture inspection">
          <h3>{inspection.result.title}</h3>
          <p>
            {inspection.result.extractor} · Captured:{" "}
            {inspection.result.capturedAt || "Date not recorded"}
          </p>
          <p>
            <strong>{inspection.result.counts.items}</strong> captured topics ·{" "}
            <strong>{inspection.result.counts.questionDefinitions}</strong>{" "}
            captured question definitions. These are captured counts, not proof
            of the expected total.
          </p>
          <details>
            <summary>Capture limits and source checks</summary>
            <ul>
              {inspection.result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {inspection.result.findings.map((f, i) => (
                <li key={`finding-${i}`}>
                  {f.itemName}: {f.action || f.detail || f.code}
                </li>
              ))}
            </ul>
          </details>
          <label className="source-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I checked that this capture belongs to {courseTitle}.
          </label>
          <button
            className="primary"
            disabled={disabled || busy || !confirmed}
            onClick={() => {
              onUseCapture(inspection.file);
              setMessage(
                "Brightspace JSON selected for comparison. It will be saved with the next successful comparison report.",
              );
            }}
          >
            Use this source capture
          </button>
        </section>
      )}
      {message && <p role="status">{message}</p>}
      {selectedFile && (
        <p>
          Source file selected: <strong>{selectedFile}</strong>. Keep the
          downloaded file; this selection lasts for this browser session and
          course until comparison.
        </p>
      )}
      <p className="hint">
        If Brightspace is unavailable, compare the evidence you have and
        document source checks in the item worklist. Unread content remains
        unverified. Other source LMS platforms currently need their own
        supporting evidence; this extractor is for Brightspace.
      </p>
      <div className="action-links">
        <button className="secondary" onClick={onPlan}>
          Return to assignment plan
        </button>
        <button className="secondary" onClick={onCompare}>
          Continue to comparison
        </button>
      </div>
    </section>
  );
}
