import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseraExtractionStatus } from "../src/domain/coursera-background-extraction.ts";
import {
  courseraCaptureDownloadUrl,
  courseraCaptureFile,
  courseraConnection,
  disconnectCoursera,
  readCourseraExtractionJob,
  recentCourseraExtractions,
  startCourseraExtraction,
  type CourseraConnectionSummary,
} from "../src/domain/coursera-extraction-http.ts";

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
  const [extractionJob, setExtractionJob] =
    useState<CourseraExtractionStatus | null>(null);
  const [recentJobs, setRecentJobs] = useState<CourseraExtractionStatus[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const authPopup = useRef<Window | null>(null);
  const authPopupUrl = useRef("");

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
        const recent = await recentCourseraExtractions(controller.signal);
        if (mounted.current) {
          setRecentJobs(recent);
          if (!localStorage.getItem(extractionKey) && recent[0])
            setExtractionJob(recent[0]);
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
        if (
          status.state === "AWAITING_LOGIN" &&
          status.liveViewUrl &&
          authPopup.current &&
          !authPopup.current.closed &&
          authPopupUrl.current !== status.liveViewUrl
        ) {
          try {
            authPopup.current.location.replace(status.liveViewUrl);
            authPopupUrl.current = status.liveViewUrl;
          } catch {}
        }
        if (
          status.state === "RUNNING" &&
          authPopup.current &&
          !authPopup.current.closed &&
          authPopupUrl.current
        ) {
          try { authPopup.current.close(); } catch {}
          authPopup.current = null;
          authPopupUrl.current = "";
        }
        if (terminal(status)) {
          localStorage.removeItem(extractionKey);
          try {
            if (authPopup.current && !authPopup.current.closed)
              authPopup.current.close();
          } catch {}
          authPopup.current = null;
          authPopupUrl.current = "";
          try {
            await refreshSession(controller.signal);
            const recent = await recentCourseraExtractions(controller.signal);
            if (mounted.current) setRecentJobs(recent);
          } catch (_) {}
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
    extractionActive = running(extractionJob);

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <h2>Background Coursera extraction</h2>
          <p>
            Paste an authoring-shell URL and start extraction. CTI reuses your
            saved Coursera/Okta session automatically. If SSO has expired, the
            same extraction pauses at Okta/MFA and resumes after you finish it.
          </p>
        </div>
        <span className="badge">
          {session?.connected ? "SSO session saved" : "Okta only if needed"}
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
        CTI accepts only www.coursera.org/teach/... authoring URLs. There is no
        separate Coursera login setup: click Extract course. If authentication
        is required, CTI routes the remote browser into your organization SSO
        flow and asks you only for the Okta/MFA step.
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
        <button
          className="primary"
          disabled={locked || !shellUrl.trim() || extractionActive}
          onClick={() => {
            if (!session?.connected) {
              const popup = window.open(
                "",
                "cti-coursera-okta",
                "popup=yes,width=1120,height=820",
              );
              if (popup) {
                try {
                  popup.document.title = "CTI · preparing Okta SSO";
                  popup.document.body.innerHTML =
                    "<main style='font-family:system-ui;padding:32px'><h2>CTI is checking your Coursera session…</h2><p>If Okta is required, this window will switch to the secure sign-in view automatically.</p></main>";
                } catch {}
                authPopup.current = popup;
                authPopupUrl.current = "";
              }
            }
            void act("Starting extraction", async () => {
              const status = await startCourseraExtraction(shellUrl);
              localStorage.setItem(extractionKey, status.id);
              setExtractionJob(status);
              setRecentJobs((current) => [
                status,
                ...current.filter((job) => job.id !== status.id),
              ].slice(0, 20));
            });
          }}
        >
          {extractionActive ? "Extraction running…" : "Extract course"}
        </button>
        {session?.connected && (
          <button
            className="text-button"
            disabled={locked || extractionActive}
            onClick={() =>
              void act("Forgetting saved sign-in", async () => {
                await disconnectCoursera();
                setSession({
                  connected: false,
                  connectedAt: "",
                  verifiedCourseId: "",
                });
                setNotice("Saved Coursera/Okta browser session removed.");
              })
            }
          >
            Forget saved sign-in
          </button>
        )}
      </div>

      {session?.connected && (
        <p className="hint">
          Encrypted Coursera/Okta browser session saved {dateLabel(session.connectedAt)}
          {session.verifiedCourseId
            ? " · last verified shell " + session.verifiedCourseId
            : ""}
        </p>
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
            {extractionJob.state === "AWAITING_LOGIN" &&
              extractionJob.liveViewUrl && (
                <a
                  className="primary"
                  href={extractionJob.liveViewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Continue with Okta SSO
                </a>
              )}
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

      {!!recentJobs.length && (
        <details className="scope">
          <summary>Recent background extractions ({recentJobs.length})</summary>
          <p className="hint">
            These jobs are stored server-side for your CTI identity, so you can
            reopen a running or completed extraction even if this browser lost
            its local job pointer.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>State</th>
                  <th>Started</th>
                  <th>Evidence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td><code>{job.courseId}</code></td>
                    <td>{job.state.replaceAll("_", " ")}</td>
                    <td>{dateLabel(job.startedAt || job.createdAt)}</td>
                    <td>
                      {job.capture
                        ? `${job.capture.completeCount}/${job.capture.inventoryCount} complete · ${job.capture.unresolvedCount} unresolved`
                        : job.phase || "Pending"}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => {
                          setExtractionJob(job);
                          setShellUrl(job.shellUrl);
                          if (running(job))
                            localStorage.setItem(extractionKey, job.id);
                        }}
                      >
                        Open job
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {!editable && (
        <p className="hint">
          Your CTI account is read-only. An editor or administrator can start
          background extraction jobs.
        </p>
      )}
    </section>
  );
}
