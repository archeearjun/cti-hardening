import { useEffect, useRef, useState } from "react";
import {
  createSourceAssetSession,
  destinationMediaFailures,
  recoverSourceAssets,
  recoveryReceipt,
  sourceAssetBinding,
  validateRecoveryReceipt,
  type SourceAssetSession,
} from "../src/domain/source-asset-recovery";
import type { EvidenceObject } from "../src/domain/workspace-types";
import type { PackageScan } from "../src/domain/package-types";

function download(value: Blob, name: string) {
  const url = URL.createObjectURL(value),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function SourceAssetRecovery({
  report,
  auditId,
  scan,
  destination = [],
}: {
  report: EvidenceObject;
  auditId: string;
  scan?: PackageScan;
  destination?: EvidenceObject[];
}) {
  const [item, setItem] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<EvidenceObject | null>(null);
  const session = useRef<SourceAssetSession | null>(null),
    abort = useRef<AbortController | null>(null),
    inflight = useRef(false);
  useEffect(() => () => abort.current?.abort(), []);
  const rows = (report.result?.itemResults || []).filter(
    (r: EvidenceObject) =>
      r.operationalPolicy?.inDecisionGate !== false &&
      r.operationalPolicy?.classification !== "NON_LFM_POLICY_EXEMPT" &&
      scan?.sourceEvidence?.resources?.[r.sourceId]?.structuredAssessment
        ?.questions?.length,
  );
  const selected = rows.find(
    (r: EvidenceObject) => `${r.sourceId}|${r.courseraId || ""}` === item,
  );
  const failures = destinationMediaFailures(
    destination.find((i) => i.id === selected?.courseraId)?.content
      ?.questions || [],
  );
  const bound = !!scan && scan.fileSha256 === report.sourceScanSha256;
  const binding = () =>
    sourceAssetBinding(
      report,
      auditId,
      selected.sourceId,
      selected.courseraId || "",
    );
  return (
    <details className="scope">
      <summary>Check source assessment assets in the original package</summary>
      <p>
        Read-only local recovery. Select the original IMSCC used for this
        comparison. CTI checks its hash and reads only bounded media candidates.
        Live Brightspace access and learner rendering are not checked. Download
        receipts and originals to preserve this session; the saved comparison is
        unchanged.
      </p>
      {!bound ? (
        <p>
          The matching source package scan is required. Load the original
          package for this saved comparison.
        </p>
      ) : (
        <>
          <label>
            Source assessment
            <select
              aria-label="Source assessment"
              value={item}
              disabled={busy}
              onChange={(e) => {
                setItem(e.target.value);
                session.current = null;
                setReceipt(null);
                setError("");
                setMessage("");
              }}
            >
              <option value="">Choose an assessment</option>
              {rows.map((r: EvidenceObject) => (
                <option
                  key={`${r.sourceId}|${r.courseraId || ""}`}
                  value={`${r.sourceId}|${r.courseraId || ""}`}
                >
                  {r.sourceName} — {r.sourceId} →{" "}
                  {r.courseraId || "destination unresolved"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Original source package
            <input
              type="file"
              accept=".imscc,.zip"
              disabled={busy || !selected}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file || !scan || !selected || inflight.current) return;
                inflight.current = true;
                setBusy(true);
                setError("");
                abort.current = new AbortController();
                try {
                  const b = binding();
                  if (
                    !session.current ||
                    JSON.stringify(session.current.binding) !==
                      JSON.stringify(b)
                  )
                    session.current = createSourceAssetSession(b);
                  const value = await recoverSourceAssets(
                    file,
                    scan,
                    session.current,
                    { signal: abort.current.signal, progress: setMessage },
                  );
                  setReceipt(value);
                  setMessage(
                    "Package check complete. Binary identity, question association, and destination rendering are separate.",
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                  if (session.current)
                    setReceipt(recoveryReceipt(session.current));
                } finally {
                  inflight.current = false;
                  setBusy(false);
                }
              }}
            />
          </label>
          {busy && (
            <button type="button" onClick={() => abort.current?.abort()}>
              Pause after current bounded read
            </button>
          )}
          <label>
            Inspect a previous recovery receipt
            <input
              type="file"
              accept=".json"
              disabled={busy || !selected}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  if (file.size > 2 * 1024 * 1024)
                    throw Error("Receipt exceeds 2 MiB.");
                  const result = validateRecoveryReceipt(
                    JSON.parse(await file.text()),
                    binding(),
                  );
                  setMessage(
                    `Receipt matches this comparison (${result.assetCount} files). Select the original package above to independently revalidate bytes. Imported claims have not been promoted to verified evidence.`,
                  );
                  setError("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            />
          </label>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error} Original evidence is preserved.</p>}
      {selected && failures.length > 0 && (
        <div>
          <p>
            Recorded destination ingestion failures (not paired to source
            questions by position):
          </p>
          <ul>
            {failures.map((f) => (
              <li key={f.questionId}>
                {f.questionId} — {f.status}. {f.action}
              </li>
            ))}
          </ul>
        </div>
      )}
      {receipt && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              download(
                new Blob(
                  [
                    JSON.stringify(
                      { ...receipt, destinationObservations: failures },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                ),
                "CTI_source_asset_recovery.json",
              )
            }
          >
            Download recovery receipt
          </button>
          <p>
            Original reference validity in live Brightspace: unverified.
            Destination question association and learner rendering: unverified.
            No automatic LMS repair.
          </p>
          {receipt.rows.map((r: EvidenceObject, i: number) => (
            <div key={i}>
              <strong>
                {r.sourceQuestionId || "Question identity unavailable"} —{" "}
                {r.status}
              </strong>
              <p>
                Original: {r.originalRef || "Sensitive reference omitted"}
                <br />
                Expected package path: {r.expectedPath || "external/unknown"}
                <br />
                {r.action}
              </p>
              {r.caseVariants?.length > 0 && (
                <p>
                  Case-sensitive alternatives (not matches):{" "}
                  {r.caseVariants.join(", ")}
                </p>
              )}
              {r.truncated && (
                <p>Candidate limit reached; unresolved alternatives remain.</p>
              )}
              <ul>
                {r.candidates?.map((c: EvidenceObject) => (
                  <li key={c.path}>
                    {c.path} — {c.method}; {c.status}
                    {c.sha256 && (
                      <>
                        ; SHA-256 {c.sha256}; {c.size} bytes; {c.format}{" "}
                        {c.width && `${c.width} × ${c.height}`}{" "}
                        <button
                          type="button"
                          onClick={() => {
                            const a = session.current?.assets.get(c.path);
                            if (a)
                              download(
                                new Blob([new Uint8Array(a.bytes)]),
                                c.path.split("/").pop() || "original.bin",
                              );
                          }}
                        >
                          Save original bytes
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </details>
  );
}
