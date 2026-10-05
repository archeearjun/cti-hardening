import { useEffect, useRef, useState } from "react";
import SourceTree from "./SourceTree";
import type {
  PackageMessage,
  PackageProgress,
  PackageScan,
} from "../src/domain/package-types";

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
  onResult,
  fileInputId = "package-file",
  catalogueMode = false,
}: {
  onBusyChange: (busy: boolean) => void;
  fileInputId?: string;
  catalogueMode?: boolean;
  onResult?: (result: PackageScan | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PackageProgress>({ phase: "" });
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PackageScan | null>(null);
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
    onResult?.(null);
    setError("");
    setSeconds(0);
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
        onResult?.(data.result);
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
  return (
    <section className="package-workspace" aria-label="Package inspection">
      <div className="card">
        <h2>Inspect a source package</h2>
        <p>
          Choose an IMSCC or ZIP up to 250 MiB. XML is accepted for
          structure-only inspection. Files are processed on this computer.
        </p>
        <label className="file-picker" htmlFor={fileInputId}>
          <strong>{file?.name || "Choose an IMSCC package"}</strong>
          <span>
            {catalogueMode
              ? "Inspect first, then save the scan to the current workspace."
              : "Nothing is saved to your shared CTI catalogue."}
          </span>
        </label>
        <input
          id={fileInputId}
          type="file"
          accept=".imscc,.zip,.xml"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setResult(null);
            onResult?.(null);
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
            <SourceTree
              scan={result}
              searchLabel="Find an item"
              className="package-items"
            />
          </section>
        </>
      )}
    </section>
  );
}
