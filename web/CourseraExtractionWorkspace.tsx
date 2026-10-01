import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseraExtractionStatus } from "../src/domain/coursera-background-extraction.ts";
import {
  courseraCaptureDownloadUrl,
  courseraCaptureFile,
  courseraConnection,
  disconnectCoursera,
  readCourseraConnectionJob,
  readCourseraExtractionJob,
  startCourseraConnection,
  startCourseraExtraction,
  type CourseraConnectionSummary,
} from "../src/domain/coursera-extraction-http.ts";

const connectionKey = "cti-coursera-connection-job";
const extractionKey = "cti-coursera-extraction-job";
const running = (status: CourseraExtractionStatus | null) =>
  !!status &&
  ["QUEUED", "AWAITING_LOGIN", "RUNNING", "VERIFYING"].includes(status.state);
const terminal = (status: CourseraExtractionStatus | null) =>
  !!status && ["CONNECTED", "COMPLETE", "INCOMPLETE", "FAILED"].includes(status.state);
const dateLabel = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Not recorded";

export default function CourseraExtractionWorkspace({
  enabled,
  editable,
  disabled = false,
  onUseCapture,
  initialUrl = "",
}: {
  enabled: boolean;
  editable: boolean;
  disabled?: boolean;
  onUseCapture?: (file: File) => void;
  initialUrl?: string;
}) {
  const [shellUrl, setShellUrl] = useState(initialUrl);
  const [session, setSession] = useState<CourseraConnectionSummary | null>(null);
  const [connectionJob, setConnectionJob] =
    useState<CourseraExtractionStatus | null>(null);
  const [extractionJob, setExtractionJob] =
    useState<CourseraExtractionStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (initialUrl) setShellUrl(initialUrl);
  }, [initialUrl]);

  async function refreshSession(signal?: AbortSignal) {
    if (!enabled) {
      setSession(null);
      return;
    }
    const next = await courseraConnection(signal);
    if (mounted.current) setSession(next);
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      try {
        await refreshSession(controller.signal);
        const connectionId = localStorage.getItem(connectionKey);
        if (connectionId) {
          const status = await readCourseraConnectionJob(
            connectionId,
            controller.signal,
          );
          if (mounted.current) setConnectionJob(status);
        }
        const extractionId = localStorage.getItem(extractionKey);
        if (extractionId) {
          const status = await readCourseraExtractionJob(
            extractionId,
            controller.signal,
          );
          if (mounted.current) setExtractionJob(status);
        }
      } catch (e) {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          e instanceof Error
        )
          setError(e.message);
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !connectionJob || !running(connectionJob)) return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const status = await readCourseraConnectionJob(
          connectionJob.id,
          controller.signal,
        );
        if (!mounted.current) return;
        setConnectionJob(status);
        if (status.state === "CONNECTED") {
          localStorage.removeItem(connectionKey);
          await refreshSession(controller.signal);
          setNotice("Coursera connection verified. You can run background extraction.");
        } else if (status.state === "FAILED") {
          localStorage.removeItem(connectionKey);
          setError(status.error || "Coursera connection failed.");
        }
      } catch (e) {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          e instanceof Error
        )
          setError(e.message);
      }
    };
    const timer = setInterval(() => void poll(), 2500);
    void poll();
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [enabled, connectionJob?.id, connectionJob?.state]);

  useEffect(() => {
    if (!enabled || !extractionJob || !running(extractionJob)) return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const status = await readCourseraExtractionJob(
          extractionJob.id,
          controller.signal,
        );
        if (!mounted.current) return;
        setExtractionJob(status);
        if (terminal(status)) {
          localStorage.removeItem(extractionKey);
          if (status.state === "COMPLETE")
            setNotice(
              "Background Coursera capture passed the strict no-miss completion gate.",
            );
          else if (status.state === "INCOMPLETE")
            setNotice(
              "Capture finished and was preserved, but CTI did not certify it as complete. Review the unresolved evidence below.",
            );
          else if (status.state === "FAILED")
            setError(status.error || "Background Coursera extraction failed.");
        }
      } catch (e) {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          e instanceof Error
        )
          setError(e.message);
      }
    };
    const timer = setInterval(() => void poll(), 4000);
    void poll();
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [enabled, extractionJob?.id, extractionJob?.state]);

  const reasons = useMemo(
    () => extractionJob?.capture?.reasons || [],
    [extractionJob?.capture?.reasons],
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
      if (mounted.current) setBusy("");
    }
  }

  if (!enabled)
    return (
      <section className="card">
        <h2>Background Coursera extraction</h2>
        <p className="empty-state">
          Background extraction uses the authenticated shared CTI service. Connect
          the shared workspace in Setup before using it.
        </p>
      </section>
    );

  const locked = disabled || !!busy || !editable,
    connectionActive = running(connectionJob),
    extractionActive = running(extractionJob);

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <h2>Background Coursera extraction</h2>
          <p>
            Paste an authoring-shell URL. CTI opens an authenticated background
            browser, runs the Coursera evidence extractor, preserves the raw
            capture, and reports Complete only after the no-miss gate passes.
          </p>
        </div>
        <span className="badge">
          {session?.connected ? "Coursera connected" : "Coursera not connected"}
        </span>
      </div>

      <label>
        Coursera authoring-shell URL
        <input
          type="url"
          value={shellUrl}
          disabled={disabled || !!busy || extractionActive}
          onChange={(event) => setShellUrl(event.target.value)}
          placeholder="https://www.coursera.org/teach/.../.../content/edit"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="hint">
        CTI accepts only www.coursera.org/teach/... authoring URLs. Your Coursera
        password is never submitted to CTI; sign-in happens inside the remote
        Coursera browser.
      </p>

      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="success-notice">
          {notice}
        </p>
      )}

      <div className="context-actions">
        {!session?.connected && (
          <button
            className="secondary"
            disabled={locked || !shellUrl.trim() || connectionActive}
            onClick={() =>
              void act("Starting Coursera sign-in", async () => {
                const status = await startCourseraConnection(shellUrl);
                localStorage.setItem(connectionKey, status.id);
                setConnectionJob(status);
              })
            }
          >
            {connectionActive ? "Connecting Coursera…" : "Connect Coursera"}
          </button>
        )}
        {session?.connected && (
          <>
            <button
              className="primary"
              disabled={locked || !shellUrl.trim() || extractionActive}
              onClick={() =>
                void act("Starting extraction", async () => {
                  const status = await startCourseraExtraction(shellUrl);
                  localStorage.setItem(extractionKey, status.id);
                  setExtractionJob(status);
                })
              }
            >
              {extractionActive ? "Extraction running…" : "Extract course"}
            </button>
            <button
              className="text-button"
              disabled={locked || extractionActive}
              onClick={() =>
                void act("Disconnecting Coursera", async () => {
                  await disconnectCoursera();
                  localStorage.removeItem(connectionKey);
                  setConnectionJob(null);
                  setSession({
                    connected: false,
                    connectedAt: "",
                    verifiedCourseId: "",
                  });
                  setNotice("Coursera connection removed.");
                })
              }
            >
              Disconnect Coursera
            </button>
          </>
        )}
      </div>

      {session?.connected && (
        <p className="hint">
          Connected {dateLabel(session.connectedAt)}
          {session.verifiedCourseId
            ? " · last verified shell " + session.verifiedCourseId
            : ""}
        </p>
      )}

      {connectionJob && connectionJob.state !== "CONNECTED" && (
        <div className="status workspace-progress" role="status">
          <span className="pulse" />
          <div>
            <strong>{connectionJob.state.replaceAll("_", " ")}</strong>
            <span>{connectionJob.phase || "Preparing Coursera sign-in"}</span>
            <span>Updated {dateLabel(connectionJob.updatedAt)}</span>
          </div>
          {connectionJob.liveViewUrl && (
            <a
              className="primary"
              href={connectionJob.liveViewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Coursera sign-in
            </a>
          )}
        </div>
      )}

      {extractionJob && (
        <>
          <div
            className={
              extractionJob.state === "FAILED"
                ? "error"
                : "status workspace-progress"
            }
            role="status"
          >
            {extractionActive && <span className="pulse" />}
            <div>
              <strong>{extractionJob.state.replaceAll("_", " ")}</strong>
              <span>{extractionJob.phase || "Background extraction"}</span>
              <span>
                Course {extractionJob.courseId} · updated{" "}
                {dateLabel(extractionJob.updatedAt)}
              </span>
            </div>
          </div>

          {extractionJob.capture && (
            <div className="metric-grid portfolio-counts">
              <div>
                <strong>{extractionJob.capture.inventoryCount}</strong>
                <span>Inventory items</span>
              </div>
              <div>
                <strong>{extractionJob.capture.completeCount}</strong>
                <span>Fully complete</span>
              </div>
              <div>
                <strong>{extractionJob.capture.unresolvedCount}</strong>
                <span>Unresolved</span>
              </div>
              <div>
                <strong>{extractionJob.capture.unvisitedCount}</strong>
                <span>Unvisited</span>
              </div>
            </div>
          )}

          {extractionJob.state === "COMPLETE" && (
            <p className="success-notice">
              Certified complete: the discovered inventory reconciled, no item was
              unvisited or unknown, and required assessment/plugin evidence passed
              the strict completion gate.
            </p>
          )}

          {extractionJob.state === "INCOMPLETE" && (
            <div className="migration-issues" role="alert">
              <h3>Not certified complete</h3>
              <p>
                CTI saved the raw capture but will not call this extraction
                complete while any required evidence is unresolved.
              </p>
              {!!reasons.length && (
                <ul>
                  {reasons.slice(0, 20).map((reason) => (
                    <li key={reason}>
                      <code>{reason}</code>
                    </li>
                  ))}
                </ul>
              )}
              {reasons.length > 20 && (
                <p className="hint">
                  {reasons.length - 20} additional reasons are retained in the job
                  result and capture.
                </p>
              )}
            </div>
          )}

          {extractionJob.artifactAvailable && (
            <div className="context-actions">
              <a
                className="secondary"
                href={courseraCaptureDownloadUrl(extractionJob.id)}
                download
              >
                Download raw capture JSON
              </a>
              {onUseCapture && (
                <button
                  className="primary"
                  disabled={disabled || !!busy}
                  onClick={() =>
                    void act("Loading capture into Compare", async () => {
                      const file = await courseraCaptureFile(extractionJob);
                      onUseCapture(file);
                    })
                  }
                >
                  Use this capture in Compare
                </button>
              )}
            </div>
          )}
        </>
      )}

      {!editable && (
        <p className="hint">
          Your CTI account is read-only. An editor or administrator can connect
          Coursera and start extraction jobs.
        </p>
      )}
    </section>
  );
}
