import { useState } from "react";
import { formatMinutes, moduleTimesText, type moduleTimes } from "../src/domain/owner-time";

export default function ModuleTimeSummary({ rows }: { rows: ReturnType<typeof moduleTimes> }) {
  const [message, setMessage] = useState("");
  const included = rows.filter(r => r.latest.total > 0);
  return <details className="scope" open>
    <summary>Module time estimates for the content map</summary>
    <p className="hint">Coursera learner-time estimates, not the time needed to complete this checklist. Both columns include only currently relevant items. “Latest available” combines baseline estimates with saved item refreshes; it is not a live connection to Coursera. Missing values remain unknown.</p>
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Module time estimates"><table>
      <thead><tr><th>Module</th><th>Baseline</th><th>Latest available</th><th>Coverage</th></tr></thead>
      <tbody>{included.map(r => <tr key={r.key}>
        <th scope="row">{r.module}</th>
        <td>{r.baseline.captured ? formatMinutes(r.baseline.minutes) : "Not captured"}{r.baseline.missing && r.baseline.captured ? " (partial)" : ""}</td>
        <td>{r.latest.captured ? formatMinutes(r.latest.minutes) : "Not captured"}{r.latest.missing && r.latest.captured ? " (partial)" : ""}</td>
        <td>{r.latest.captured}/{r.latest.total} captured · {r.refreshed} refreshed{r.excluded ? ` · ${r.excluded} excluded` : ""}</td>
      </tr>)}</tbody>
    </table></div>
    {!included.length && <p>No relevant Coursera items to total.</p>}
    <p className="hint">After editing Coursera, use the existing “Refresh this item” check and import its JSON, or run a fresh full comparison. Expand an item to see the dates and evidence. A partial total is not a complete module estimate.</p>
    <button className="secondary" disabled={!included.length} onClick={async () => {
      try { await navigator.clipboard.writeText(moduleTimesText(rows)); setMessage("Module totals copied with coverage notes; no item links included."); }
      catch { setMessage("Could not copy. Select the module totals from the table or export the owner report."); }
    }}>Copy module time totals</button>
    {message && <p role="status">{message}</p>}
  </details>;
}
