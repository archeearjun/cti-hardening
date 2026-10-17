import { useEffect, useRef, useState } from "react";
import {
  evidenceInputId,
  inspectEvidenceInputs,
  stageEvidenceInputs,
  assertEvidenceCourseBinding,
  validateEvidenceInput,
  type EvidenceStage,
  type EvidenceIntakeResult,
  type EvidenceInputData,
} from "../src/domain/evidence-intake.ts";
import type { WorkspaceStore } from "../src/domain/workspace-store.ts";
import type { WorkspaceRecord } from "../src/domain/workspace-types.ts";
import { download } from "./workspace-ui";

export interface EvidenceInboxProps {
  course: WorkspaceRecord | null;
  store: WorkspaceStore | null;
  records: WorkspaceRecord[];
  onSaved: (saved?: WorkspaceRecord[]) => void | Promise<void>;
  onStage: (stage: EvidenceStage) => void | Promise<void>;
  onNavigate: (view: string) => void;
  disabled?: boolean;
}
export default function EvidenceInbox({
  course,
  store,
  records,
  onSaved,
  onStage,
  onNavigate,
  disabled = false,
}: EvidenceInboxProps) {
  const [results, setResults] = useState<EvidenceIntakeResult[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [documentPlatform, setDocumentPlatform] = useState(
    "Source LMS document",
  );
  const [baselineDocument, setBaselineDocument] = useState("");
  const controller = useRef<AbortController | null>(null);
  const operation = useRef(0);
  useEffect(() => {
    operation.current++;
    controller.current?.abort();
    setResults([]);
    setBaselineDocument("");
    setConfirmed(false);
    setError("");
    setMessage("");
    setBusy(false);
    setProgress("");
    return () => {
      operation.current++;
      controller.current?.abort();
    };
  }, [course?.id]);
  async function inspect(files: File[]) {
    const id = ++operation.current;
    controller.current?.abort();
    const run = new AbortController();
    controller.current = run;
    setResults([]);
    setBaselineDocument("");
    setConfirmed(false);
    setError("");
    setMessage("");
    if (!course || !files.length) return;
    setBusy(true);
    try {
      const inspected = await inspectEvidenceInputs(files, course, records, {
        signal: run.signal,
        documentPlatform,
        progress: (value) => {
          if (id === operation.current) setProgress(value);
        },
      });
      if (id === operation.current) setResults(inspected);
    } catch (e) {
      if (id === operation.current)
        setError(
          run.signal.aborted
            ? "Inspection cancelled. No comparison inputs were changed."
            : e instanceof Error
              ? e.message
              : String(e),
        );
    } finally {
      if (id === operation.current) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  async function save() {
    if (!store || !course || !confirmed || busy || disabled) return;
    const accepted = results.filter(
      (r) => r.input && ["ready", "duplicate"].includes(r.status),
    );
    if (!accepted.length) return;
    const id = ++operation.current;
    const run = new AbortController();
    controller.current = run;
    setBusy(true);
    setError("");
    setMessage("");
    const saved: WorkspaceRecord[] = [];
    try {
      // Resolve the explicit baseline choice before any records are written.
      // A bad or conflicting choice must not leave a partially selected course.
      stageEvidenceInputs(accepted, {
        sourceDocumentHash: baselineDocument,
        courseId: course.id,
      });
      // Refresh IDs before saving so repeat intake remains idempotent across tabs.
      const existing = await store.list();
      const known = new Set(existing.map((r) => r.id));
      for (const result of accepted) {
        run.signal.throwIfAborted();
        const data = result.input!.data;
        assertEvidenceCourseBinding(data, course.id, existing);
        const recordId = evidenceInputId(course.id, data);
        if (known.has(recordId)) {
          // Reuse the original attribution as well as the byte identity. In
          // particular, a repeated Markdown upload cannot silently relabel a
          // previously retained source document with a new platform name.
          const prior = await store.get(recordId);
          validateEvidenceInput(prior.data);
          if (
            prior.packageId !== course.id ||
            prior.data.sourceHash !== data.sourceHash
          )
            throw Error("Retained evidence identity differs from this input.");
          result.input!.data = prior.data;
          continue;
        }
        setProgress("Saving evidence identity: " + data.sourceName);
        try {
          const record = await store.save(
            {
              id: recordId,
              kind: "operations",
              title: ("Evidence: " + data.sourceName).slice(0, 500),
              packageId: course.id,
              version: 0,
              updatedAt: "",
              updatedBy: "",
              data,
            },
            { signal: run.signal },
          );
          saved.push(record);
          known.add(recordId);
        } catch (e) {
          // A concurrent successful intake of the exact deterministic ID is
          // reuse, not a new revision of immutable source evidence.
          const concurrent = (await store.list()).find(
            (r) =>
              r.id === recordId &&
              r.packageId === course.id &&
              r.data.sourceHash === data.sourceHash,
          );
          if (!concurrent) throw e;
          known.add(recordId);
        }
      }
      run.signal.throwIfAborted();
      if (id !== operation.current) return;
      await onSaved(saved);
      run.signal.throwIfAborted();
      if (id !== operation.current) return;
      const stage = stageEvidenceInputs(accepted, {
        sourceDocumentHash: baselineDocument,
        courseId: course.id,
      });
      await onStage(stage);
      if (id === operation.current)
        setMessage(
          "Evidence retained and accepted files selected for this course. Run comparison to evaluate differences and coverage. Keep original binary files for later use.",
        );
    } catch (e) {
      // Earlier per-file commits remain visible and can be reused on retry.
      if (saved.length) await onSaved(saved);
      if (id === operation.current)
        setError(
          (run.signal.aborted
            ? "Import cancelled."
            : e instanceof Error
              ? e.message
              : String(e)) +
            " Previously saved evidence identities remain retained; retrying skips them.",
        );
    } finally {
      if (id === operation.current) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  async function openDocument(record: WorkspaceRecord) {
    if (!store) return;
    setError("");
    try {
      const full = await store.get(record.id),
        data = full.data as EvidenceInputData;
      if (
        data.original?.retention !== "TEXT" ||
        typeof data.original.text !== "string"
      )
        throw Error(
          "The exact original local file is required to reopen this binary input.",
        );
      download(data.sourceName, data.original.text, "text/plain;charset=utf-8");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const accepted = results.filter(
    (r) => r.input && ["ready", "duplicate"].includes(r.status),
  );
  const savedInputs = records.filter(
    (r) =>
      r.packageId === course?.id &&
      r.kind === "operations" &&
      r.data.type === "evidence-input",
  );
  return (
    <section className="card evidence-inbox" aria-label="Evidence inbox">
      <h2>Add course evidence</h2>
      <p>
        Add the files together. CTI detects Coursera and Brightspace captures,
        source packages, XLSX and source documents, then selects the accepted
        inputs for comparison.
      </p>
      <p>
        Selected course:{" "}
        <strong>
          {course?.title || "Create or choose an assignment first"}
        </strong>
        . Source content, confirmed absence and unread content remain distinct.
      </p>
      {!course && (
        <button className="primary" onClick={() => onNavigate("Scan")}>
          Create assignment from source evidence
        </button>
      )}
      <label>
        Platform attribution for Markdown or text documents
        <input
          value={documentPlatform}
          maxLength={100}
          disabled={busy || disabled}
          onChange={(e) => setDocumentPlatform(e.target.value)}
          placeholder="For example: Brightspace"
        />
      </label>
      <label>
        Course evidence files
        <input
          type="file"
          multiple
          accept=".cti.zip,.zip,.imscc,.xml,.xlsx,.json,.json.gz,.gz,.md,.markdown,.txt"
          disabled={!course || busy || disabled || store?.role === "viewer"}
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            void inspect(files);
          }}
        />
      </label>
      <p className="hint">
        Up to 12 files and 1 GiB per intake. Markdown/text is retained as an
        attributed source document; it does not certify an LMS inventory,
        questions or media. Binary originals remain in your local files; their
        hashes and inspection receipts are saved here.
      </p>
      {busy && (
        <div role="status">
          <p>{progress || "Preparing evidence…"}</p>
          <button
            className="secondary"
            onClick={() => controller.current?.abort()}
          >
            Cancel intake
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!!results.length && (
        <ul className="evidence-intake-results">
          {results.map((result, i) => (
            <li key={i}>
              <strong>{result.file.name}</strong> —{" "}
              {result.status === "ready"
                ? "Ready"
                : result.status === "duplicate"
                  ? "Exact input already retained"
                  : result.status === "conflict"
                    ? "Resolve input conflict"
                    : "Could not inspect"}
              <p>{result.message}</p>
              {result.input && (
                <details>
                  <summary>Source identity and inspection scope</summary>
                  <p>
                    {result.input.data.platform} · {result.input.data.role} ·{" "}
                    {result.input.data.nativeCourseId
                      ? "Native course ID: " + result.input.data.nativeCourseId
                      : "Native course ID not recorded"}
                  </p>
                  <p>
                    Captured: {result.input.data.capturedAt || "Not recorded"}.
                    Original SHA-256:{" "}
                    <code>{result.input.data.sourceHash}</code>
                  </p>
                  <p>{result.input.data.scope}</p>
                  <ul>
                    {result.input.data.gaps.map((gap, j) => (
                      <li key={j}>{gap}</li>
                    ))}
                  </ul>
                </details>
              )}
              {result.input?.data.role === "source-document" &&
                ["ready", "duplicate"].includes(result.status) && (
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        baselineDocument === result.input.data.sourceHash
                      }
                      disabled={
                        busy ||
                        disabled ||
                        accepted.some(
                          (r) => r.input?.data.role === "source-package",
                        )
                      }
                      onChange={(e) =>
                        setBaselineDocument(
                          e.target.checked ? result.input!.data.sourceHash : "",
                        )
                      }
                    />
                    Use this document as the source baseline for comparison.
                    Only its supplied text and literal sections will be
                    evaluated; LMS inventory, assessment and media completeness
                    remain unknown.
                  </label>
                )}
              <button
                className="text-button"
                disabled={busy || disabled}
                onClick={() =>
                  void inspect(
                    results
                      .filter((_, index) => index !== i)
                      .map((r) => r.file),
                  )
                }
              >
                Remove this file
              </button>
            </li>
          ))}
        </ul>
      )}
      {!!accepted.length && (
        <>
          {baselineDocument && (
            <p className="hint">
              The chosen document will replace this course’s current source
              baseline when you save and use this evidence. Previous audits
              remain historical snapshots.
            </p>
          )}
          <label className="source-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || disabled}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I checked that these {accepted.length} accepted inputs belong to{" "}
            {course?.title}.
          </label>
          <button
            className="primary"
            disabled={
              busy ||
              disabled ||
              !confirmed ||
              !store ||
              store.role === "viewer"
            }
            onClick={() => void save()}
          >
            Save and use accepted evidence
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {!!savedInputs.length && (
        <details>
          <summary>{savedInputs.length} retained evidence inputs</summary>
          <ul>
            {savedInputs.map((record) => (
              <li key={record.id}>
                <strong>{record.data.sourceName || record.title}</strong> ·{" "}
                {record.data.role || "Evidence input"} · Added{" "}
                {record.data.importedAt || record.updatedAt}
                {record.data.role === "source-document" ? (
                  <button
                    className="text-button"
                    onClick={() => void openDocument(record)}
                  >
                    Download original source document
                  </button>
                ) : (
                  <span> · Keep the exact original local file to reopen.</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="action-links">
        <button className="secondary" onClick={() => onNavigate("Compare")}>
          Review comparison inputs
        </button>
        <button className="secondary" onClick={() => onNavigate("Explore")}>
          Explore source evidence
        </button>
      </div>
    </section>
  );
}
