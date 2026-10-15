import { useRef, useState } from "react";
import type { ItemCheckSpec } from "../src/domain/item-check";
import {
  panoptoTargetIdentity,
  importPanoptoDeliveryInfo,
  validatePanoptoDeliveryInfoCapture,
} from "../src/domain/panopto-delivery-info";
import { safeWebUrl } from "../src/domain/owner-actions";
import { download } from "./workspace-ui";
import { buildPanoptoDeliveryInfoScript } from "../src/domain/panopto-delivery-script";

type Capture = Awaited<ReturnType<typeof importPanoptoDeliveryInfo>>;
const responseByteLimit = 512 * 1024;
const captionLabels = {
  REPORTED_NONE: "No caption tracks reported in the imported response. Caption absence has not been independently verified.",
  REPORTED_PRESENT_UNSUPPORTED: "Caption tracks reported. Caption files and text have not been imported.",
  CONTRADICTORY: "Caption fields disagree in the imported response. Caption availability remains unverified.",
  UNKNOWN: "The imported response does not establish caption availability.",
};

export default function PanoptoEvidencePanel({
  spec, targets, captures, editable, onCapture,
}: {
  spec: ItemCheckSpec;
  targets: string[];
  captures: Capture[];
  editable: boolean;
  onCapture: (value: Capture) => Promise<void>;
}) {
  const [target, setTarget] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [script, setScript] = useState("");
  const [scriptTarget, setScriptTarget] = useState("");
  const importing = useRef(false);
  const urls = [...new Set(targets.filter((url) => panoptoTargetIdentity(url)))].slice(0, 12);
  const currentTargets = useRef(urls);
  currentTargets.current = urls;
  const selected = urls.includes(target) ? target : urls[0] || "";
  const accepted: Capture[] = [];
  let invalid = 0;
  for (const capture of captures) {
    try { accepted.push(validatePanoptoDeliveryInfoCapture(capture, spec)); }
    catch { invalid++; }
  }
  if (!urls.length && !captures.length) return null;

  async function saveResponse(response: string) {
    if (!editable || !selected || importing.current) return;
    importing.current = true;
    setBusy(true);
    setMessage("");
    try {
      const capture = await importPanoptoDeliveryInfo(response, spec, selected);
      const checked = validatePanoptoDeliveryInfoCapture(capture, spec, currentTargets.current);
      await onCapture(checked);
      setPaste("");
      setMessage("Panopto metadata saved with this item. Video and caption files remain unverified; the course audit is unchanged.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Panopto response could not be imported. Previous evidence has been preserved.");
    } finally {
      importing.current = false;
      setBusy(false);
    }
  }

  async function copyMetadataScript() {
    if (!editable || !selected || busy) return;
    const program = buildPanoptoDeliveryInfoScript(selected);
    setScript(program); setScriptTarget(selected);
    try {
      await navigator.clipboard.writeText(program);
      setMessage("Script copied. Run it in the captured Panopto page’s console, then upload its metadata JSON here. Video and caption files remain unverified.");
    } catch {
      setMessage("Copy the script below or download it. Run it in the captured Panopto page’s console, then upload its metadata JSON here.");
    }
  }

  return (
    <section className="plugin-page-check" aria-label="Panopto media metadata">
      <h4>Import Panopto video metadata</h4>
      <p>
        Save the copied Panopto response for this item’s captured link. This
        records its reported video details and media references. Video and
        caption files are separate evidence.
      </p>
      {urls.length > 0 && (
        <>
          <label>
            Captured Panopto target
            <select value={selected} disabled={busy} onChange={(event) => setTarget(event.target.value)}>
              {urls.map((url) => <option key={url} value={url}>{url}</option>)}
            </select>
          </label>
          <p><a href={selected} target="_blank" rel="noopener noreferrer">Open captured Panopto page ↗</a></p>
          <button className="secondary" disabled={!editable || busy} onClick={() => void copyMetadataScript()}>Copy Panopto metadata script</button>
          <p className="hint">Run this script in that Panopto page’s console. It reads the reported metadata for this recording and downloads JSON to import below. It does not play or download video or caption files.</p>
          {script && scriptTarget === selected && <details>
            <summary>Panopto script copy and download fallback</summary>
            <textarea aria-label="Panopto metadata script" readOnly value={script} />
            <button className="secondary" onClick={() => download(`CTI_Panopto_metadata_${spec.itemId}.js`, script, "text/javascript")}>Download Panopto metadata script</button>
          </details>}
          <p className="hint">
            You can also use that page’s DevTools → Network, select DeliveryInfo.aspx and
            choose Copy → Copy response. Paste the JSON below or upload the
            copied response saved as a .json or .txt file.
          </p>
          <label>
            Paste Panopto response JSON
            <textarea value={paste} maxLength={responseByteLimit} disabled={!editable || busy} onChange={(event) => setPaste(event.target.value)} />
          </label>
          <button className="secondary" disabled={!editable || busy || !paste.trim()} onClick={() => void saveResponse(paste)}>
            {busy ? "Saving Panopto metadata…" : "Save Panopto metadata"}
          </button>
          <label>
            Upload Panopto response JSON or text
            <input type="file" accept=".json,.txt,application/json,text/plain" disabled={!editable || busy} onChange={(event) => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (!file) return;
              if (file.size > responseByteLimit) { setMessage("Panopto response exceeds 512 KiB. Previous evidence has been preserved."); return; }
              void file.text().then(saveResponse).catch(() => setMessage("The response file could not be read. Previous evidence has been preserved."));
            }} />
          </label>
        </>
      )}
      {invalid > 0 && <p role="alert">Saved Panopto metadata could not be matched to this item. It remains saved and has not been used as current evidence.</p>}
      {accepted.map((capture) => (
        <details key={`${capture.targetUrl}-${capture.importedAt}`}>
          <summary>Imported Panopto metadata · {capture.title}</summary>
          <p>Imported <time dateTime={capture.importedAt}>{new Date(capture.importedAt).toLocaleString()}</time>. The response observation time was not independently recorded.</p>
          {!urls.includes(capture.targetUrl) && <p className="hint">Previous target: this link is absent from the current captured references.</p>}
          <p>{capture.targetUrl}</p>
          {capture.durationSeconds !== null && <p>Reported duration: {capture.durationSeconds} seconds.</p>}
          <p>{captionLabels[capture.captions.status]}</p>
          {capture.identity.isReferenceCopy === true && <p>Panopto reports a reference copy. Its delivery and underlying session identities are retained separately.</p>}
          <details>
            <summary>Source identity</summary>
            <dl>
              <dt>Configured delivery ID</dt><dd>{capture.identity.deliveryPublicId}</dd>
              <dt>Underlying session ID</dt><dd>{capture.identity.sessionPublicId}</dd>
            </dl>
          </details>
          {capture.streams.length > 0 && <div>
            <h5>Reported media references</h5>
            <p className="hint">These references do not establish that the media files were captured or that a stream is the original upload.</p>
            {capture.streams.map((stream, index) => {
              const role = stream.role === "PODCAST_STREAM" ? "Podcast stream" : "Viewer stream";
              const references = [...new Set([stream.url, stream.httpUrl].map(safeWebUrl).filter(Boolean))];
              return <div key={`${stream.role}-${index}`}>
                <p><strong>{role}</strong>{stream.viewerMediaFileTypeName ? ` · Reported format: ${stream.viewerMediaFileTypeName}` : ""}{stream.streamTypeName ? ` · Panopto stream type: ${stream.streamTypeName}` : ""}</p>
                {references.map((url) => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">Open reported {role.toLowerCase()} ↗</a><br /><code>{url}</code></p>)}
                {stream.variants.map((variant, ordinal) => {
                  const url = safeWebUrl(variant.url);
                  return <p key={ordinal}>{variant.bandwidth !== null ? `Reported bandwidth: ${variant.bandwidth}. ` : ""}{url && <a href={url} target="_blank" rel="noopener noreferrer">Open reported stream variant ↗</a>}</p>;
                })}
              </div>;
            })}
          </div>}
          {capture.navigation.length > 0 && <div>
            <h5>Reported navigation and OCR labels</h5>
            <p className="hint">These are the response’s navigation records. They do not establish caption or transcript coverage.</p>
            {capture.navigation.map((entry, index) => <div key={index}>
              <p>{entry.timeSeconds !== null ? `${entry.timeSeconds} seconds` : ""}{entry.eventType ? ` · ${entry.eventType}` : ""}</p>
              {entry.text !== null && <pre className="evidence-json">{entry.text}</pre>}
            </div>)}
          </div>}
          <ul>{capture.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
          <button className="secondary" onClick={() => download(`CTI_Panopto_${spec.itemId}_${capture.identity.deliveryPublicId}.json`, JSON.stringify(capture, null, 2))}>Download saved Panopto metadata</button>
        </details>
      ))}
      {message && <p role="status" className="hint">{message}</p>}
    </section>
  );
}
