import { useState } from "react";
import {
  enablePerformance,
  performanceReports,
} from "../src/diagnostics/runtime.ts";
export default function PerformanceDiagnostics() {
  const [enabled, setEnabled] = useState(false);
  return (
    <details className="card">
      <summary>Performance diagnostics</summary>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            enablePerformance(e.target.checked);
          }}
        />{" "}
        Enable local diagnostics for subsequent operations
      </label>
      <p>
        Download before closing this tab. LMS bookmarks have their own switch
        and export. Measurements contain timings and counts, not course content.
        Running or interrupted operations are partial; timings do not certify
        evidence.
      </p>
      <button
        type="button"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob(
              [
                JSON.stringify(
                  {
                    kind: "CTI_PERFORMANCE_BUNDLE",
                    reports: performanceReports(),
                  },
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            ),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "CTI-performance.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        Download performance diagnostics
      </button>
    </details>
  );
}
