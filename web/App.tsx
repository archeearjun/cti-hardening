import { useEffect, useMemo, useRef, useState } from "react";
import PackageWorkspace from "./PackageWorkspace";
import FullWorkspace from "./FullWorkspace";
import type {
  ReviewOptions,
  ReviewResult,
  Severity,
  WorkerRequest,
  WorkerResponse,
} from "../src/domain/types";

const severityNames: Record<Severity, string> = {
  CRITICAL: "Critical",
  REVIEW: "Review",
  EVIDENCE: "Evidence gap",
  INFO: "Information",
};
function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function elapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export default function App() {
  const [workspace, setWorkspace] = useState<"capture" | "package" | "full">(
    "full",
  );
  const [packageBusy, setPackageBusy] = useState(false);
  const [fullBusy, setFullBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<ReviewOptions>({
    partner: "NAIT",
    mode: "OPS_CURRENT",
  });
  const [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(""),
    [result, setResult] = useState<ReviewResult | null>(null);
  const [filter, setFilter] = useState("ALL"),
    [query, setQuery] = useState(""),
    [visibleItems, setVisibleItems] = useState(50);
  const worker = useRef<Worker | null>(null),
    requestId = useRef(0),
    startedAt = useRef(0);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [busy]);

  function stop() {
    requestId.current++;
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  }
  function launch(
    request: Omit<Extract<WorkerRequest, { kind: "review" }>, "id">,
  ) {
    stop();
    const id = ++requestId.current;
    setError("");
    setBusy(true);
    setSeconds(0);
    startedAt.current = Date.now();
    setPhase("Starting capture review");
    setResult(null);
    setVisibleItems(50);
    setFilter("ALL");
    setQuery("");
    try {
      const w = new Worker(
        new URL("../src/worker/evidence.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      const fail = (message: string) => {
        if (id !== requestId.current) return;
        setError(message);
        setPhase("Stopped");
        stop();
      };
      w.onerror = () =>
        fail(
          "The review worker stopped unexpectedly. You can retry this file; the existing CTI app remains available.",
        );
      w.onmessageerror = () =>
        fail("The review result could not be read. Retry this file.");
      w.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.id !== requestId.current) return;
        if (data.kind === "progress") {
          setPhase(data.phase);
          return;
        }
        if (data.kind === "error") {
          fail(data.message);
          return;
        }
        setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
        if (data.kind === "review") {
          setResult(data.result);
          setPhase("Capture review complete");
        }
        stop();
      };
      w.postMessage({ ...request, id } satisfies WorkerRequest);
    } catch (e) {
      stop();
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const findings = useMemo(
    () =>
      result?.findings.filter(
        (f) =>
          (filter === "ALL" || f.severity === filter) &&
          `${f.itemName} ${f.itemId} ${f.path} ${f.code} ${f.detail}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ) ?? [],
    [result, filter, query],
  );
  return (
    <>
      <header className="topbar">
        <a className="brand" href="#main">
          <span className="brand-icon">CTI</span>
          <span>Evidence workspace</span>
        </a>
        <span className="badge">Source → ingestion → review</span>
      </header>
      <main id="main">
        <nav className="workspace-tabs" aria-label="Choose a workspace">
          <button
            className={workspace === "full" ? "primary" : "secondary"}
            aria-pressed={workspace === "full"}
            disabled={busy || packageBusy || fullBusy}
            onClick={() => setWorkspace("full")}
          >
            Full CTI workspace
          </button>
          <button
            className={workspace === "capture" ? "primary" : "secondary"}
            aria-pressed={workspace === "capture"}
            disabled={busy || packageBusy || fullBusy}
            onClick={() => setWorkspace("capture")}
          >
            Review a capture
          </button>
          <button
            className={workspace === "package" ? "primary" : "secondary"}
            aria-pressed={workspace === "package"}
            disabled={busy || packageBusy || fullBusy}
            onClick={() => setWorkspace("package")}
          >
            Inspect a package
          </button>
        </nav>
        <div hidden={workspace !== "full"}>
          <FullWorkspace onBusyChange={setFullBusy} />
        </div>
        <div hidden={workspace !== "package"}>
          <PackageWorkspace onBusyChange={setPackageBusy} />
        </div>
        <div hidden={workspace !== "capture"}>
          <div className="workspace-grid">
            <section
              className="card import-card"
              aria-labelledby="capture-title"
            >
              <div className="section-top">
                <span className="step">01</span>
                <h2 id="capture-title">Inspect a capture</h2>
              </div>
              <p>Choose a complete CTI capture JSON. Up to 40 MiB per file.</p>
              <label className="file-picker" htmlFor="capture-file">
                <span className="file-icon" aria-hidden="true">
                  ↥
                </span>
                <strong>
                  {file ? file.name : "Choose Coursera or Brightspace JSON"}
                </strong>
                <span>
                  {file
                    ? `${(file.size / 1024 / 1024).toFixed(2)} MiB · Choose another file`
                    : "Your course data stays in this browser."}
                </span>
              </label>
              <input
                id="capture-file"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setResult(null);
                  setError("");
                  setPhase("");
                }}
              />
              <div className="settings">
                <label>
                  Partner policy
                  <select
                    disabled={busy}
                    value={options.partner}
                    onChange={(e) => {
                      setOptions({
                        ...options,
                        partner: e.target.value as ReviewOptions["partner"],
                      });
                      setResult(null);
                      setPhase("");
                    }}
                  >
                    <option value="NAIT">NAIT</option>
                    <option value="">General</option>
                  </select>
                </label>
                <label>
                  Capture stage
                  <select
                    disabled={busy}
                    value={options.mode}
                    onChange={(e) => {
                      setOptions({
                        ...options,
                        mode: e.target.value as ReviewOptions["mode"],
                      });
                      setResult(null);
                      setPhase("");
                    }}
                  >
                    <option value="OPS_CURRENT">Current course state</option>
                    <option value="RAW_INGESTION">
                      Immediately after ingestion
                    </option>
                  </select>
                </label>
              </div>
              <p className="hint">
                Choose the stage that matches this capture. It affects how
                historical ingestion warnings are interpreted.
              </p>
              <button
                className="primary"
                disabled={!file || busy}
                onClick={() =>
                  file && launch({ kind: "review", file, options })
                }
              >
                Review capture <span aria-hidden="true">→</span>
              </button>
            </section>
          </div>
          {(busy || phase) && (
            <section className="status" role="status">
              <span className={busy ? "pulse" : "status-dot"} />
              <div>
                <strong>{phase}</strong>
                <span>
                  Elapsed {elapsed(seconds)}
                  {busy ? " · Working on this computer" : ""}
                </span>
              </div>
              {busy && (
                <button
                  className="text-button"
                  onClick={() => {
                    stop();
                    setPhase("Cancelled");
                  }}
                >
                  Cancel
                </button>
              )}
            </section>
          )}
          {error && (
            <div className="error" role="alert">
              <strong>Could not complete this review</strong>
              <p>{error}</p>
            </div>
          )}
          {result && (
            <section className="results" aria-labelledby="result-title">
              <div className="result-heading">
                <div>
                  <p className="eyebrow">{result.platform} CAPTURE</p>
                  <h2 id="result-title">{result.title}</h2>
                  <p className="hint">
                    {result.extractor} · Captured{" "}
                    {result.capturedAt || "date not recorded"}
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    saveFile(
                      `${result.fileName.replace(/\.json$/i, "")}__preview-review.json`,
                      JSON.stringify(result, null, 2),
                      "application/json",
                    )
                  }
                >
                  Download review
                </button>
              </div>
              <div className="metrics">
                <div>
                  <strong>{result.counts.items}</strong>
                  <span>
                    {result.platform === "BRIGHTSPACE"
                      ? "Captured topics"
                      : "Captured items"}
                  </span>
                </div>
                <div>
                  <strong>{result.counts.questionDefinitions}</strong>
                  <span>Question definitions</span>
                </div>
                <div>
                  <strong>
                    {result.platform === "BRIGHTSPACE"
                      ? "—"
                      : result.counts.assets}
                  </strong>
                  <span>
                    {result.platform === "BRIGHTSPACE"
                      ? "Assets not evaluated"
                      : "Asset references"}
                  </span>
                </div>
                <div>
                  <strong>{result.counts.links}</strong>
                  <span>Link references</span>
                </div>
              </div>
              <div className="card evidence-notes">
                <h3>Evidence boundaries</h3>
                <p>{result.scope}</p>
                {result.traversal?.recorded && (
                  <p>
                    Observed item surfaces:{" "}
                    <strong>
                      {result.traversal.visited} / {result.traversal.eligible}
                    </strong>
                    . Unresolved: {result.traversal.unresolvedCount}. A visited
                    surface does not prove its content was completely captured.
                  </p>
                )}
                <ul>
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
              <div className="card">
                <div className="section-top">
                  <h3>Readiness findings</h3>
                  <span className="muted">
                    {result.findings.length} displayed findings
                  </span>
                </div>
                <p className="hint">
                  These findings use this capture alone. Cross-check actions
                  against the source and full CTI report before editing a
                  course.
                </p>
                <div className="filters">
                  <label className="search-label">
                    Search findings
                    <input
                      type="search"
                      placeholder="Item, ID or finding…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label>
                    Severity
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="ALL">All severities</option>
                      {Object.entries(severityNames).map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {findings.length ? (
                  <div className="findings">
                    {findings.map((f, i) => (
                      <details
                        className="finding"
                        key={`${f.code}-${f.itemId}-${i}`}
                      >
                        <summary>
                          <span
                            className={`severity ${f.severity.toLowerCase()}`}
                          >
                            {severityNames[f.severity]}
                          </span>
                          <span>
                            <strong>
                              {f.itemName || "Course-level evidence"}
                            </strong>
                            <small>{f.code.replaceAll("_", " ")}</small>
                          </span>
                          <span className="expand" aria-hidden="true">
                            +
                          </span>
                        </summary>
                        <div className="finding-body">
                          {f.path && <p className="hint">{f.path}</p>}
                          {f.itemId && (
                            <p className="hint">Item ID: {f.itemId}</p>
                          )}
                          <p>{f.detail}</p>
                          <p>
                            <strong>Next check: </strong>
                            {f.action}
                          </p>
                          {f.policyExempt && (
                            <p>Exempt under the selected partner policy.</p>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="empty">
                    {result.findings.length
                      ? "No findings match this filter."
                      : "No findings surfaced in this capture review. This is not a full QA pass or publication sign-off."}
                  </p>
                )}
              </div>
              <details className="card inventory">
                <summary>
                  Captured item inventory{" "}
                  <span className="muted">{result.items.length} items</span>
                </summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Item / ID</th>
                        <th>Type</th>
                        <th>Path</th>
                        <th>Question definitions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.slice(0, visibleItems).map((i, n) => (
                        <tr key={`${i.id}-${n}`}>
                          <td>
                            {i.name || "Unnamed item"}
                            <small>{i.id}</small>
                          </td>
                          <td>{i.type}</td>
                          <td>{i.path}</td>
                          <td>{i.questionDefinitions ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {visibleItems < result.items.length && (
                  <button
                    className="secondary"
                    onClick={() => setVisibleItems((n) => n + 50)}
                  >
                    Show next 50
                  </button>
                )}
              </details>
            </section>
          )}
        </div>
        <footer>
          <span>CTI · Evidence integrity</span>
          <span>
            Saved workspace reports retain their evidence. Quick inspections
            must be downloaded.
          </span>
        </footer>
      </main>
    </>
  );
}
