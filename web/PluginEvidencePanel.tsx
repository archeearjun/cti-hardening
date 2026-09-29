import { useState } from "react";
import {
  buildPluginCheckScript,
  validatePluginCheck,
  type PluginCheckSpec,
} from "../src/domain/plugin-check";
import { safeWebUrl } from "../src/domain/owner-actions";
import type { ItemCheckSpec } from "../src/domain/item-check";
import type { EvidenceObject } from "../src/domain/workspace-types";
import { download } from "./workspace-ui";

export default function PluginEvidencePanel({
  spec,
  targets,
  captures,
  editable,
  onCapture,
}: {
  spec: ItemCheckSpec;
  targets: string[];
  captures: EvidenceObject[];
  editable: boolean;
  onCapture: (value: EvidenceObject) => Promise<void>;
}) {
  const [pending, setPending] = useState<PluginCheckSpec | null>(null);
  const [script, setScript] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const urls = [...new Set(targets.map(safeWebUrl).filter(Boolean))].slice(
    0,
    12,
  );
  if (!urls.length && !captures.length) return null;
  async function prepare(url: string) {
    const request = {
      ...spec,
      targetUrl: url,
      requestId: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
    };
    const text = buildPluginCheckScript(request);
    setPending(request);
    setScript(text);
    try {
      await navigator.clipboard.writeText(text);
      setMessage(
        "Script copied. Keep this card open, capture the linked page, then upload its JSON here.",
      );
    } catch {
      setMessage(
        "Download the script below and copy its contents into the linked page's browser console.",
      );
    }
  }
  return (
    <section className="plugin-page-check">
      <h4>Capture an unreadable embedded page</h4>
      <p>
        Open the captured target below and run its script in that page’s
        console. If it only works inside Coursera, select that exact embedded
        frame in the console’s execution-context menu. The script checks the
        page address and records its visible screen.
      </p>
      <p className="hint">
        This does not verify that the page launches inside the course, its
        hidden screens, or its interactions. Check those separately. Keep this
        card open while capturing.
      </p>
      {urls.map((url) => (
        <div className="action-links" key={url}>
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open captured plugin target ↗
          </a>
          <span>{url}</span>
          <button
            className="secondary"
            disabled={!editable || busy}
            onClick={() => void prepare(url)}
          >
            Copy page capture script
          </button>
        </div>
      ))}
      {pending && (
        <>
          <button
            className="secondary"
            onClick={() =>
              download(
                `CTI_plugin_${spec.itemId}.js`,
                script,
                "text/javascript",
              )
            }
          >
            Download page script
          </button>
          <label>
            Upload plugin-page check JSON
            <input
              type="file"
              accept=".json,application/json"
              disabled={!editable || busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setMessage("");
                void (async () => {
                  if (file.size > 512 * 1024)
                    throw Error("Plugin-page check exceeds 512 KiB.");
                  await onCapture(
                    validatePluginCheck(JSON.parse(await file.text()), pending),
                  );
                  setMessage(
                    "Page evidence saved with this item. The course audit remains unchanged.",
                  );
                })()
                  .catch((e) => setMessage(e.message || String(e)))
                  .finally(() => setBusy(false));
              }}
            />
          </label>
        </>
      )}
      {captures.map((value, i) => (
        <details key={`${value.requestId}-${i}`}>
          <summary>
            Captured page · {value.text?.length || 0} characters ·{" "}
            {value.status === "PARTIAL_OR_LOADING"
              ? "Partial or still loading"
              : "Visible screen observed"}
          </summary>
          <p>
            {value.targetUrl} · {new Date(value.finishedAt).toLocaleString()}
          </p>
          <blockquote>{value.text}</blockquote>
          <p className="hint">
            {value.textTruncated ? "Text was truncated. " : ""}Other screens,
            frame contents, media and interactions remain unverified.
          </p>
        </details>
      ))}
      {message && (
        <p role="status" className="hint">
          {message}
        </p>
      )}
    </section>
  );
}
