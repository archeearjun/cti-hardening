import SourceTree from "./SourceTree";
import EvidenceDetails from "./EvidenceDetails";
import type { PackageScan } from "../src/domain/package-types";
import { sourceBaseline } from "../src/domain/assignment-evidence";

export default function SourceExplorer({ scan }: { scan: PackageScan }) {
  const baseline = sourceBaseline(scan);
  return (
    <section className="source-explorer">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SAVED SOURCE BASELINE</p>
          <h2>Explore what is inside</h2>
        </div>
        <span className="badge">
          {scan.sourceEvidence?.manifestOnly
            ? "Manifest only"
            : scan.sourceEvidence?.manifestOnly === false
              ? "Package evidence"
              : "Saved source evidence"}
        </span>
      </div>
      <p className="hint">
        {scan.fileName} ·{" "}
        {scan.scannedAt
          ? new Date(scan.scannedAt).toLocaleString()
          : "Scan date not recorded"}
      </p>
      <p className="scope">
        <strong>{baseline.label}.</strong>{" "}
        {baseline.status === "historical"
          ? "These are imported historical results. Rescan the original IMSCC to inspect it with the current scanner."
          : "This view shows saved package evidence. Opening it does not rescan the file or check for a newer Brightspace export."}{" "}
        Coursera import results appear after the source-to-Coursera comparison.
      </p>
      <div className="metric-grid">
        <div>
          <strong>{scan.moduleCount ?? "—"}</strong>
          <span>Source modules</span>
        </div>
        <div>
          <strong>{String(scan.stats?.totalItems ?? "—")}</strong>
          <span>Source items (not question count)</span>
        </div>
        <div>
          <strong>{String(scan.stats?.ifs ?? "—")}</strong>
          <span>IFS workload indicator</span>
        </div>
      </div>
      <p className="hint">
        This is the saved source hierarchy, before ingestion. Expand an entry to
        inspect captured text, question evidence and attached files.
        Dependencies are not automatically standalone learner items.
      </p>
      {!!scan.warnings?.length && (
        <details className="scope">
          <summary>{scan.warnings.length} source scan warnings</summary>
          <ul>
            {scan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <SourceTree
        scan={scan}
        searchLabel="Find source content"
        className="source-items"
      />
      <p className="hint">
        IFS, lexical and z-score metrics are review aids, not evidence that a
        course is complete.
      </p>
      <EvidenceDetails
        title="Source diagnostics, metrics and provenance"
        value={{
          scope: scan.scope,
          fileSha256: scan.fileSha256,
          stats: scan.stats,
          unknownTypesLog: scan.unknownTypesLog,
          fileExtensionsLog: scan.fileExtensionsLog,
          sourceEvidence: scan.sourceEvidence,
        }}
      />
    </section>
  );
}
