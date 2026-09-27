import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PackageMessage,
  PackageNode,
  PackageProgress,
  PackageScan,
} from "../src/domain/package-types";

function flatten(
  nodes: PackageNode[],
  path: string[] = [],
): Array<{ node: PackageNode; path: string }> {
  return nodes.flatMap((node) => [
    { node, path: path.join(" / ") },
    ...flatten(node.children || [], [...path, node.title]),
  ]);
}
function download(scan: PackageScan) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(scan, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download =
    scan.fileName.replace(/\.[^.]+$/, "") + "__CTI_PACKAGE_SCAN.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function PackageWorkspace({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PackageProgress>({ phase: "" });
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PackageScan | null>(null);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(50);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  function stop() {
    cleanup.current();
    cleanup.current = () => {};
    frame.current?.remove();
    frame.current = null;
    setBusy(false);
    onBusyChange(false);
  }
  function start() {
    if (!file) return;
    stop();
    setResult(null);
    setError("");
    setSeconds(0);
    setQuery("");
    setVisible(50);
    setBusy(true);
    onBusyChange(true);
    setProgress({ phase: "Starting package scanner" });
    const runner = document.createElement("iframe");
    runner.hidden = true;
    runner.title = "Local package scanner";
    runner.src = new URL("package-runner.html", location.href).href;
    frame.current = runner;
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    let ready = false;
    const fail = (message: string) => {
      setError(message);
      setProgress({ phase: "Scan stopped" });
      stop();
    };
    const startup = setTimeout(() => {
      if (!ready)
        fail("The package scanner could not load. Refresh the page and retry.");
    }, 20000);
    const receive = (event: MessageEvent<PackageMessage>) => {
      if (
        event.origin !== location.origin ||
        event.source !== runner.contentWindow
      )
        return;
      const data = event.data;
      if (data.kind === "package-ready") {
        if (ready) return;
        ready = true;
        clearTimeout(startup);
        runner.contentWindow?.postMessage(
          { kind: "scan-package", file },
          location.origin,
        );
      } else if (data.kind === "package-progress") setProgress(data.progress);
      else if (data.kind === "package-error") fail(data.message);
      else if (data.kind === "package-result") {
        setResult(data.result);
        setProgress({ phase: "Package inspection complete" });
        setSeconds(Math.floor((Date.now() - started) / 1000));
        stop();
      }
    };
    addEventListener("message", receive);
    cleanup.current = () => {
      clearInterval(timer);
      clearTimeout(startup);
      removeEventListener("message", receive);
      runner.remove();
    };
    document.body.append(runner);
  }
  const rows = useMemo(
    () =>
      result
        ? flatten(result.courseTree).filter(({ node, path }) =>
            `${node.title} ${node.type} ${path} ${node.idref}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
        : [],
    [result, query],
  );
  return (
    <section className="package-workspace" aria-label="Package inspection">
      <div className="card">
        <h2>Inspect a source package</h2>
        <p>
          Choose an IMSCC or ZIP up to 250 MiB. XML is accepted for
          structure-only inspection. Files are processed on this computer.
        </p>
        <label className="file-picker" htmlFor="package-file">
          <strong>{file?.name || "Choose an IMSCC package"}</strong>
          <span>Nothing is saved to your shared CTI catalogue.</span>
        </label>
        <input
          id="package-file"
          type="file"
          accept=".imscc,.zip,.xml"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setResult(null);
            setError("");
            setProgress({ phase: "" });
          }}
        />
        <button className="primary" disabled={!file || busy} onClick={start}>
          Inspect package →
        </button>
      </div>
      {progress.phase && (
        <section className="status" role="status">
          <span className={busy ? "pulse" : "status-dot"} />
          <div>
            <strong>{progress.phase}</strong>
            <span>
              Elapsed {Math.floor(seconds / 60)}m{" "}
              {String(seconds % 60).padStart(2, "0")}s
            </span>
            {busy && (
              <>
                <span>
                  {progress.detail ||
                    progress.file ||
                    "Reading package evidence."}
                </span>
                {typeof progress.total === "number" && progress.total > 0 && (
                  <>
                    <span>
                      {progress.completed ?? 0} / {progress.total} resources
                    </span>
                    <progress
                      aria-label="Source resources inspected"
                      max={progress.total}
                      value={progress.completed ?? 0}
                    />
                  </>
                )}
              </>
            )}
          </div>
          {busy && (
            <button
              className="text-button"
              onClick={() => {
                stop();
                setProgress({ phase: "Cancelled" });
              }}
            >
              Cancel
            </button>
          )}
        </section>
      )}
      {error && (
        <div className="error" role="alert">
          <strong>Package inspection could not finish</strong>
          <p>{error}</p>
        </div>
      )}
      {result && (
        <>
          <section className="card package-summary">
            <div className="section-top">
              <h2>{result.fileName}</h2>
              <button className="secondary" onClick={() => download(result)}>
                Download package evidence
              </button>
            </div>
            <p>{result.scope}</p>
            <div className="package-metrics">
              <div>
                <strong>{result.moduleCount}</strong>
                <span>Top-level entries</span>
              </div>
              <div>
                <strong>{String(result.stats.totalResources)}</strong>
                <span>Manifest resources</span>
              </div>
              <div>
                <strong>{String(result.stats.quizzes)}</strong>
                <span>QTI resources</span>
              </div>
              <div>
                <strong>{String(result.stats.ifs)}</strong>
                <span>IFS workload index</span>
              </div>
            </div>
            <p className="hint">
              IFS describes structural workload; it is not a quality score or an
              ingestion pass. Interactive content still needs runtime
              verification. Download this scan to retain it after closing the
              page.
            </p>
            {result.warnings.length > 0 && (
              <details open>
                <summary>
                  Evidence limitations ({result.warnings.length})
                </summary>
                <ul>
                  {result.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <section className="card">
            <h2>Explore source structure</h2>
            <p>
              Inspect the package hierarchy, captured text, question definitions
              and file evidence. No course content is executed.
            </p>
            <label>
              Find an item
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisible(50);
                }}
                placeholder="Title, resource ID, type or module"
              />
            </label>
            <p className="hint">
              Showing {Math.min(visible, rows.length)} of {rows.length} matching
              entries.
            </p>
            <div className="package-items">
              {rows.slice(0, visible).map(({ node, path }, index) => (
                <details key={`${node.idref}:${path}:${index}`}>
                  <summary>
                    <strong>{node.title || "Untitled entry"}</strong>
                    <span>
                      {path || "Top level"} · {node.type}
                    </span>
                  </summary>
                  <p>
                    Resource ID: {node.idref || "Folder / structural entry"}
                  </p>
                  {node.autoDeleted && (
                    <p className="hint">
                      The existing CTI flattening policy marks this empty folder
                      for omission from a projected ingestion structure. This
                      scan has not changed the package.
                    </p>
                  )}
                  {node.sourcePayload ? (
                    <>
                      <p>
                        {node.sourcePayload.files?.length || 0} file evidence
                        records ·{" "}
                        {node.sourcePayload.structuredAssessment
                          ?.questionCount ?? "No resolved"}{" "}
                        question definitions
                      </p>
                      <pre className="evidence-json">
                        {JSON.stringify(node.sourcePayload, null, 2).slice(
                          0,
                          25000,
                        )}
                      </pre>
                      <p className="hint">
                        On-screen evidence is limited to 25,000 characters per
                        entry. The download retains the complete scan, including
                        parser limits and diagnostics.
                      </p>
                    </>
                  ) : (
                    <p>
                      No content payload is attached to this structural entry.
                    </p>
                  )}
                </details>
              ))}
            </div>
            {rows.length > visible && (
              <button
                className="secondary"
                onClick={() => setVisible(visible + 50)}
              >
                Show 50 more entries
              </button>
            )}
          </section>
        </>
      )}
    </section>
  );
}
