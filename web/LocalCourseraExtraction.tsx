import { useEffect, useMemo, useState } from "react";
import { parseCourseraShellUrl } from "../src/domain/coursera-background-extraction.ts";
import {
  inspectLocalCourseraCaptureFile,
  readLocalCourseraCaptureFile,
  createSavedCourseraResumeScript,
  createAutomaticLocalCourseraCommand,
  type LocalCourseraCaptureInspection,
} from "../src/domain/coursera-local-extraction.ts";
import type { ExtractorDelivery } from "../src/domain/types.ts";
import { download } from "./workspace-ui";

export default function LocalCourseraExtraction({
  disabled = false,
  onUseCapture,
  initialUrl = "",
  onUrlChange,
  captureInputId = "local-coursera-capture",
}: {
  disabled?: boolean;
  onUseCapture?: (file: File) => void;
  initialUrl?: string;
  onUrlChange?: (url: string) => void;
  captureInputId?: string;
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
  const [resumeSource, setResumeSource] = useState("");
  const [automaticCommand, setAutomaticCommand] = useState("");

  useEffect(() => {
    if (initialUrl) setShellUrl(initialUrl);
  }, [initialUrl]);

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
            CTI runs the current extractor inside the Coursera tab where you are
            already signed in. Chrome's built-in debugger continues across
            automatic reloads. One final JSON downloads when capture finishes.
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
          aria-invalid={!!shellUrl.trim() && !shellTarget}
          onChange={(event) => {
            const value = event.target.value;
            setShellUrl(value);
            onUrlChange?.(value);
            setInspection(null);
            setCapture(null);
            setResumeSource("");
            setAutomaticCommand("");
            setCopyStatus("");
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
      {!shellTarget && shellUrl.trim() && (
        <p className="hint" role="alert">
          Enter a valid Coursera authoring URL containing
          <code> /teach/&lt;course&gt;/&lt;course-id&gt;/content </code>
          before copying the extractor or selecting a capture.
        </p>
      )}

      <ol className="local-extraction-steps">
        <li>
          <strong>Open the authoring shell in normal Chrome.</strong>
          <span>Use the Chrome profile where Coursera/Okta already works.</span>
        </li>
        <li>
          <strong>Enable Protocol monitor once in Chrome.</strong>
          <span>
            In the Coursera tab, open DevTools → Settings → Experiments →
            Protocol Monitor. Reopen DevTools, then use its command menu
            (Ctrl+Shift+P; Mac: Command+Shift+P) to show Protocol monitor.
            Turn off Preserve log in Console and Network. This is built into
            Chrome; no extension or software install.
          </span>
        </li>
        <li>
          <strong>Copy the automatic local capture command.</strong>
          <span>
            In Protocol monitor, turn Record off and clear its log to avoid
            retaining browser traffic. Select the Coursera page in its target
            dropdown. Paste the command into the command input
            at the bottom and press Enter. Keep that tab and DevTools open.
            Paste this command in Protocol monitor, not Console.
          </span>
        </li>
        <li>
          <strong>Return the downloaded JSON to CTI.</strong>
          <span>
            CTI independently applies the strict no-silent-miss completion gate.
          </span>
        </li>
      </ol>
      <p className="hint">
        CTI checkpoints each item and reloads between short renderer batches;
        slow assessments finish before that boundary. It restores saved work
        without intermediate downloads or repeated pastes. If Chrome actually
        shows “Aw, Snap!”, reload the tab and copy a new command to resume from
        checkpoints. Closing DevTools also requires a new command.
        {" "}<a href="https://developer.chrome.com/docs/devtools/protocol-monitor"
          target="_blank" rel="noopener noreferrer">Chrome's official instructions ↗</a>
      </p>

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
          disabled={disabled || !!busy || !shellTarget}
          onClick={() => void act("Preparing automatic local capture", async () => {
            const current = await currentExtractor();
            const command = createAutomaticLocalCourseraCommand(shellUrl, current.script,
              crypto.randomUUID(), capture && inspection?.resumeAvailable ?
                await readLocalCourseraCaptureFile(capture) : undefined);
            setAutomaticCommand(command);
            try {
              await navigator.clipboard.writeText(command);
              setCopyStatus(current.version + " automatic command copied. Paste into Protocol monitor's bottom command input, press Enter, and keep DevTools open.");
            } catch {
              setCopyStatus("Select the full automatic command in the fallback below, copy it, and paste into Protocol monitor.");
            }
          })}
        >
          {capture && inspection?.resumeAvailable ? "Copy automatic resume command" : "Copy automatic local capture command"}
        </button>
      </div>
      <details className="scope">
        <summary>Manual Console capture (requires reloads between batches)</summary>
      <div className="action-links">
        <button
          className="secondary"
          disabled={disabled || !!busy || !shellTarget}
          onClick={() =>
            void act("Preparing local extractor", async () => {
              const current = await currentExtractor();
              try {
                await navigator.clipboard.writeText(current.script);
                setCopyStatus(
                  current.version +
                    " copied. Paste in Coursera's DevTools Console, keep that tab open, and follow the reload instructions between batches.",
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
          disabled={disabled || !!busy || !shellTarget}
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
      </details>

      {copyStatus && (
        <p className="success-notice" role="status">
          {copyStatus}
        </p>
      )}
      {automaticCommand && (
        <details className="scope">
          <summary>Automatic command copy fallback</summary>
          <p className="hint">Click inside, then Ctrl+A and Ctrl+C (Mac: Command+A and Command+C). Paste into Protocol monitor's command input.</p>
          <textarea className="extractor-source" aria-label="Automatic local capture command"
            readOnly value={automaticCommand} onFocus={event => event.currentTarget.select()} />
        </details>
      )}

      {extractor && (
        <details className="scope">
          <summary>Manual-copy fallback</summary>
          <p className="hint">
            This is the same generated {extractor.version} program. Use this
            only when clipboard permissions block the Copy button.
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
        <label className="file-picker" htmlFor={captureInputId}>
          <span className="file-icon" aria-hidden="true">
            ↥
          </span>
          <strong>
            {capture
              ? capture.name
              : "Choose the Coursera JSON downloaded by the extractor"}
          </strong>
          <span id={captureInputId + "-help"}>
            {capture
              ? (capture.size / 1024 / 1024).toFixed(2) + " MiB"
              : shellTarget
                ? "Inspection happens in this browser before the file enters Compare."
                : "Choose your saved JSON. CTI can fill the authoring URL from its recorded course identity."}
          </span>
        </label>
        <input
          id={captureInputId}
          className="visually-hidden-file"
          type="file"
          accept=".json,application/json"
          disabled={disabled || !!busy}
          aria-describedby={captureInputId + "-help"}
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            setCapture(file);
            setInspection(null);
            setResumeSource("");
            setCopyStatus("");
            setError("");
            setNotice("");
            if (file)
              void act("Checking local Coursera capture", async () => {
                const checked = await inspectLocalCourseraCaptureFile(
                  file,
                  shellUrl,
                );
                if (!shellUrl.trim() && checked.authoringShellUrl) {
                  setShellUrl(checked.authoringShellUrl);
                  onUrlChange?.(checked.authoringShellUrl);
                }
                setInspection(checked);
                setNotice(
                  checked.verdict.complete
                    ? "Local capture passed CTI's strict no-miss completion gate."
                    : checked.pausedBatch
                      ? "This batch saved your progress. Resume from this JSON to capture the remaining items."
                      : "Local capture is usable evidence, but required evidence remains unresolved.",
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
                : inspection.pausedBatch
                  ? "BATCH SAVED — continue capture"
                  : "INCOMPLETE — evidence retained, certification withheld"}
            </strong>
            <p>
              Course <code>{inspection.courseId}</code> · schema{" "}
              {inspection.schemaVersion} · {inspection.extractor}
            </p>
            {inspection.resumeAvailable && (
              <p>
                Use Copy automatic resume command above in Protocol monitor.
                CTI restores saved observations and continues missing evidence
                across automatic reloads. External content can still require review.
              </p>
            )}
            {!inspection.currentSchema && (
              <p className="hint">
                This is an older compatible schema. Existing evidence remains
                usable, but only the current extractor can satisfy the newest
                capture contract.
              </p>
            )}
            {!inspection.currentVersion && (
              <p className="hint" role="alert">
                This capture was not produced by the current Coursera extractor
                release. Keep the evidence, but rerun the current extractor when
                you need a fresh certification attempt.
              </p>
            )}
            {!!reasons.length && (
              <details>
                <summary>Evidence gaps ({reasons.length})</summary>
                <ul>
                  {reasons.slice(0, 30).map((reason) => (
                    <li key={reason}>
                      <code>{reason}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="action-links">
            {inspection.resumeAvailable && capture && (
              <button
                className="secondary"
                disabled={disabled || !!busy || courseMismatch || !shellTarget}
                onClick={() =>
                  void act("Preparing saved capture resume", async () => {
                    const current = await currentExtractor();
                    const source = createSavedCourseraResumeScript(
                      await readLocalCourseraCaptureFile(capture),
                      shellUrl,
                      current.script,
                    );
                    try {
                      await navigator.clipboard.writeText(source);
                      setResumeSource("");
                      setCopyStatus(
                        current.version +
                          " resume script copied. Reload the matching Coursera tab, then paste in Console.",
                      );
                    } catch {
                      setResumeSource(source);
                      setCopyStatus(
                        "Clipboard access is unavailable. Select and copy the full resume script below.",
                      );
                    }
                  })
                }
              >
                Copy manual resume script
              </button>
            )}
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
          {resumeSource && (
            <label>
              Resume script — click inside, select all, and copy
              <textarea
                className="extractor-source"
                aria-label="Saved Coursera resume script"
                readOnly
                value={resumeSource}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
        </>
      )}
    </section>
  );
}
