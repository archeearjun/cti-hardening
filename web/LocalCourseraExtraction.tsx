
import { useMemo, useState } from "react";
import { parseCourseraShellUrl } from "../src/domain/coursera-background-extraction.ts";
import {
  inspectLocalCourseraCaptureFile,
  type LocalCourseraCaptureInspection,
} from "../src/domain/coursera-local-extraction.ts";
import type { ExtractorDelivery } from "../src/domain/types.ts";
import { download } from "./workspace-ui";

export default function LocalCourseraExtraction({
  disabled = false,
  onUseCapture,
  initialUrl = "",
  onUrlChange,
}: {
  disabled?: boolean;
  onUseCapture?: (file: File) => void;
  initialUrl?: string;
  onUrlChange?: (url: string) => void;
}) {
  const [shellUrl, setShellUrl] = useState(initialUrl);
  const [extractor, setExtractor] = useState<ExtractorDelivery | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [capture, setCapture] = useState<File | null>(null);
  const [inspection, setInspection] =
    useState<LocalCourseraCaptureInspection | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const shellTarget = useMemo(() => {
    if (!shellUrl.trim()) return null;
    try {
      return parseCourseraShellUrl(shellUrl);
    } catch {
      return null;
    }
  }, [shellUrl]);

  const reasons = inspection?.verdict.reasons || [];
  const courseMismatch = reasons.some((reason) =>
    reason.startsWith("COURSE_ID_MISMATCH:"),
  );

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function currentExtractor() {
    if (extractor) return extractor;
    const { getExtractor } = await import("../src/domain/capture-review.ts");
    const next = getExtractor("coursera");
    setExtractor(next);
    return next;
  }

  return (
    <section className="card local-extraction-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ZERO-COST CAPTURE</p>
          <h2>Extract Coursera in your own Chrome</h2>
          <p>
            CTI runs the current v6.15.4/schema 35 extractor inside the
            Coursera tab where you are already signed in. Your computer supplies
            the browser runtime; Cloudflare Browser Run is not required.
          </p>
        </div>
        <span className="badge">No paid browser service</span>
      </div>

      <label>
        Coursera authoring-shell URL
        <input
          type="url"
          value={shellUrl}
          disabled={disabled || !!busy}
          onChange={(event) => {
            const value = event.target.value;
            setShellUrl(value);
            onUrlChange?.(value);
            setInspection(null);
            setCapture(null);
          }}
          placeholder="https://www.coursera.org/teach/.../.../content/edit"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="hint">
        Use the exact shell you intend to capture. CTI checks the downloaded
        JSON against this course ID before moving it into Compare.
      </p>

      <ol className="local-extraction-steps">
        <li>
          <strong>Open the authoring shell in normal Chrome.</strong>
          <span>Use the Chrome profile where Coursera/Okta already works.</span>
        </li>
        <li>
          <strong>Copy the current extractor.</strong>
          <span>
            Paste it once in DevTools → Console. The extractor shows its own
            progress panel and saves per-item checkpoints in this browser.
          </span>
        </li>
        <li>
          <strong>Keep the Coursera tab open while it runs.</strong>
          <span>
            Slow Readings, assessments and plugins can legitimately take time.
          </span>
        </li>
        <li>
          <strong>Return the downloaded JSON to CTI.</strong>
          <span>
            CTI independently applies the strict no-silent-miss completion gate.
          </span>
        </li>
      </ol>

      <div className="action-links">
        {shellTarget ? (
          <a
            className="button-link secondary"
            href={shellTarget.shellUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Coursera authoring shell ↗
          </a>
        ) : (
          <button className="secondary" disabled>
            Open Coursera authoring shell
          </button>
        )}
        <button
          className="primary"
          disabled={disabled || !!busy}
          onClick={() =>
            void act("Preparing local extractor", async () => {
              const current = await currentExtractor();
              try {
                await navigator.clipboard.writeText(current.script);
                setCopyStatus(
                  current.version +
                    " copied. Paste once in the Coursera tab's DevTools Console and keep that tab open while it runs.",
                );
              } catch {
                setCopyStatus(
                  "Clipboard access is unavailable. Download the extractor or expand the manual-copy fallback.",
                );
              }
            })
          }
        >
          Copy current Coursera extractor
        </button>
        <button
          className="secondary"
          disabled={disabled || !!busy}
          onClick={() =>
            void act("Preparing local extractor", async () => {
              const current = await currentExtractor();
              download(
                "CTI-coursera-" + current.version + ".js",
                current.script,
                "text/javascript",
              );
              setCopyStatus(current.version + " downloaded.");
            })
          }
        >
          Download extractor
        </button>
      </div>

      {copyStatus && (
        <p className="success-notice" role="status">
          {copyStatus}
        </p>
      )}

      {extractor && (
        <details className="scope">
          <summary>Manual-copy fallback</summary>
          <p className="hint">
            This is the same generated v6.15.4 program. Use this only when
            clipboard permissions block the Copy button.
          </p>
          <textarea
            className="extractor-source"
            aria-label="Current Coursera extractor source"
            readOnly
            value={extractor.script}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      )}

      <div className="section-divider">
        <h3>Check the downloaded capture</h3>
        <label className="file-picker" htmlFor="local-coursera-capture">
          <span className="file-icon" aria-hidden="true">
            ↥
          </span>
          <strong>
            {capture
              ? capture.name
              : "Choose the Coursera JSON downloaded by the extractor"}
          </strong>
          <span>
            {capture
              ? (capture.size / 1024 / 1024).toFixed(2) + " MiB"
              : "Inspection happens in this browser before the file enters Compare."}
          </span>
        </label>
        <input
          id="local-coursera-capture"
          className="visually-hidden-file"
          type="file"
          accept=".json,application/json"
          disabled={disabled || !!busy}
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            setCapture(file);
            setInspection(null);
            setError("");
            setNotice("");
            if (file)
              void act("Checking local Coursera capture", async () => {
                const checked = await inspectLocalCourseraCaptureFile(
                  file,
                  shellUrl,
                );
                setInspection(checked);
                setNotice(
                  checked.verdict.complete
                    ? "Local capture passed CTI's strict no-miss completion gate."
                    : "Local capture is usable evidence, but CTI will not certify it as complete while required evidence remains unresolved.",
                );
              });
          }}
        />
      </div>

      {error && (
        <div role="alert" className="error">
          <strong>Could not complete this step</strong>
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <p role="status" className="success-notice">
          {notice}
        </p>
      )}

      {inspection && (
        <>
          <div className="metric-grid portfolio-counts">
            <div>
              <strong>{inspection.verdict.inventoryCount}</strong>
              <span>Inventory items</span>
            </div>
            <div>
              <strong>{inspection.verdict.completeCount}</strong>
              <span>Fully complete</span>
            </div>
            <div>
              <strong>{inspection.verdict.unresolvedCount}</strong>
              <span>Unresolved</span>
            </div>
            <div>
              <strong>{inspection.verdict.unvisitedCount}</strong>
              <span>Unvisited</span>
            </div>
          </div>

          <div
            className={
              inspection.verdict.complete
                ? "success-notice"
                : "migration-issues"
            }
            role="status"
          >
            <strong>
              {inspection.verdict.complete
                ? "COMPLETE — strict capture gate passed"
                : "INCOMPLETE — evidence retained, certification withheld"}
            </strong>
            <p>
              Course <code>{inspection.courseId}</code> · schema{" "}
              {inspection.schemaVersion} · {inspection.extractor}
            </p>
            {!inspection.currentSchema && (
              <p className="hint">
                This is an older compatible schema. Existing evidence remains
                usable, but only the current extractor can satisfy the newest
                capture contract.
              </p>
            )}
            {!!reasons.length && (
              <ul>
                {reasons.slice(0, 30).map((reason) => (
                  <li key={reason}>
                    <code>{reason}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="action-links">
            {onUseCapture && capture && (
              <button
                className="primary"
                disabled={disabled || !!busy || courseMismatch}
                onClick={() => onUseCapture(capture)}
              >
                Use this capture in Compare
              </button>
            )}
            {courseMismatch && (
              <p className="hint" role="alert">
                This capture belongs to a different Coursera course than the URL
                above. Select the matching JSON before continuing.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
