import { useEffect, useId, useRef, useState } from "react";
import {
  validateCaptureTransferFile,
  type CaptureTransferManifest,
  type PreparedCaptureTransfer,
} from "../src/domain/capture-file-transfer";
import { COURSERA_CAPTURE_FILE_ACCEPT } from "../src/domain/coursera-capture-file";

type DownloadFile = { name: string; bytes: number; url: string };
type ReadyTransfer = {
  manifest: CaptureTransferManifest;
  manifestFile: DownloadFile;
  parts: DownloadFile[];
};

/** Direct, persistent user-click downloads. No upload, auto-download loop or
 * request to the LMS occurs; a cancelled generation cannot replace new state. */
export default function CaptureFileTransferPanel({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const headingId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [ready, setReady] = useState<ReadyTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const objectUrls = useRef<string[]>([]);
  function clearDownloads() {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
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
      clearDownloads();
    },
    [],
  );

  function select(next: File | null) {
    stop();
    clearDownloads();
    setReady(null);
    setFile(next);
    setPhase("");
    setError("");
    setMessage("");
  }
  function prepare() {
    stop();
    clearDownloads();
    setReady(null);
    setError("");
    setMessage("");
    if (!file) return;
    try {
      validateCaptureTransferFile(file);
      const id = sequence.current;
      const current = new Worker(
        new URL("./capture-transfer.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = current;
      setBusy(true);
      setPhase("Preparing your existing file locally…");
      current.onmessage = ({ data }) => {
        if (id !== sequence.current) return;
        if (data.kind === "progress") {
          setPhase(data.phase);
          return;
        }
        try {
          if (data.kind !== "result")
            throw Error(
              data.message || "The complete file could not be prepared.",
            );
          const result: PreparedCaptureTransfer = data.result;
          function link(blob: File): DownloadFile {
            const url = URL.createObjectURL(blob);
            objectUrls.current.push(url);
            return { name: blob.name, bytes: blob.size, url };
          }
          setReady({
            manifest: result.manifest,
            manifestFile: link(result.manifestFile),
            parts: result.partFiles.map(link),
          });
          setPhase("");
        } catch (failure) {
          clearDownloads();
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
          "File preparation could not finish in this browser. Open CTI directly in current Chrome and choose the same existing file.",
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
    <section className="capture-file-transfer" aria-labelledby={headingId}>
      <h3 id={headingId}>Send the complete file to this chat</h3>
      <p>
        Choose the Brightspace capture, Coursera archive or QA report already on
        your laptop. No rescan is needed. CTI prepares a lossless copy locally,
        compressing JSON when useful and splitting it into attachment files no
        larger than 24 MiB each. Original content and media stay intact.
      </p>
      <p className="hint">
        Use this page directly in Chrome. Nothing is uploaded by this tool. Keep
        using the original file in CTI comparison inputs; the manifest and parts
        are for sharing with this chat.
      </p>
      <label>
        Existing complete file to share
        <input
          type="file"
          accept={COURSERA_CAPTURE_FILE_ACCEPT}
          disabled={disabled}
          onChange={(event) => select(event.target.files?.[0] || null)}
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
          Prepare complete file for chat
        </button>
        {busy && (
          <button
            className="secondary"
            onClick={() => {
              stop();
              setPhase("");
              setMessage(
                "Preparation cancelled. Your original file is unchanged.",
              );
            }}
          >
            Cancel file preparation
          </button>
        )}
      </div>
      {busy && <p role="status">{phase}</p>}
      {error && <p role="alert">{error} Your original file is unchanged.</p>}
      {ready && (
        <>
          <p role="status">
            Ready:{" "}
            <strong>
              {ready.parts.length} part{ready.parts.length === 1 ? "" : "s"}
            </strong>{" "}
            plus one manifest. {mib(ready.manifest.original.bytes)} original →{" "}
            {mib(ready.manifest.transport.bytes)} transfer payload.
          </p>
          <p>
            <strong>
              Download the manifest and every part below, then attach all those
              files together in this chat.
            </strong>{" "}
            Keep them as files; do not open or paste the part text. The links
            stay available here until you choose another file or leave this
            page.
          </p>
          {ready.manifest.warnings.map((warning) => (
            <p className="hint" key={warning}>
              {warning}
            </p>
          ))}
          <ul>
            <li>
              <a
                className="secondary"
                href={ready.manifestFile.url}
                download={ready.manifestFile.name}
                onClick={() =>
                  setMessage(
                    "Manifest download requested. Check Chrome’s downloads; also download every part below.",
                  )
                }
              >
                Download manifest
              </a>{" "}
              · Original filename, checksums and ordered part list.
            </li>
            {ready.parts.map((part, index) => (
              <li key={part.name}>
                <a
                  className="secondary"
                  href={part.url}
                  download={part.name}
                  onClick={() =>
                    setMessage(
                      `Part ${index + 1} download requested. Check Chrome’s downloads and keep every part with the manifest.`,
                    )
                  }
                >
                  Download part {index + 1} of {ready.parts.length}
                </a>{" "}
                · {mib(part.bytes)} · JSON attachment
              </li>
            ))}
          </ul>
          <p className="hint">
            If a click saves nothing, check Chrome’s downloads and
            blocked-download notice. Open the CTI address above directly in
            Chrome if you are viewing it inside another app.
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
