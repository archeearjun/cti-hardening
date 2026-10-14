import { useState } from "react";
import { saveOriginalContent } from "../src/domain/report-content-store";
import type { WorkspaceStore } from "../src/domain/workspace-store";
import type { EvidenceObject } from "../src/domain/workspace-types";
import {
  COURSERA_CAPTURE_FILE_ACCEPT,
  readCourseraCaptureFileBytes,
} from "../src/domain/coursera-capture-file.ts";

export default function OriginalContentImport({
  report,
  auditId,
  store,
  onSaved,
}: {
  report: EvidenceObject;
  auditId: string;
  store?: WorkspaceStore | null;
  onSaved?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <details className="scope">
      <summary>Load original extraction content into an older report</summary>
      <p>
        New comparisons retain their captured content automatically. For older
        reports, import the same Coursera capture or Brightspace JSON used for
        this report. CTI verifies its original extraction identity; a different
        extraction belongs in a new comparison. Original scores and findings
        stay unchanged.
        Coursera .cti.zip and .json.gz downloads open directly without unzipping.
      </p>
      <label>
        Original extraction JSON
        <input
          type="file"
          accept={COURSERA_CAPTURE_FILE_ACCEPT}
          disabled={busy || !auditId || !store || store.role === "viewer"}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file || !store) return;
            setBusy(true);
            setMessage("");
            setError("");
            try {
              const { bytes, archiveFiles, transport } =
                await readCourseraCaptureFileBytes(file);
              const platform = await saveOriginalContent(
                bytes,
                report,
                auditId,
                store,
                { archiveFiles, transport },
              );
              await onSaved?.();
              setMessage(
                `Original ${platform === "coursera" ? "Coursera" : "Brightspace"} content loaded and saved. Original audit unchanged.`,
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {busy && (
        <p role="status">
          Checking the extraction identity and saving content…
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert">{error} Previous content has been preserved.</p>
      )}
    </details>
  );
}
