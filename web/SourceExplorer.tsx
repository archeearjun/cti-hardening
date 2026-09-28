import { useMemo, useState } from "react";
import EvidenceDetails from "./EvidenceDetails";
import type { PackageNode, PackageScan } from "../src/domain/package-types";

export default function SourceExplorer({ scan }: { scan: PackageScan }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(40);
  const rows = useMemo(() => {
    const all: { node: PackageNode; path: string; key: string }[] = [];
    const walk = (nodes: PackageNode[], path: string, prefix: string) => {
      (nodes || []).forEach((node, i) => {
        const key = `${prefix}.${i}`;
        all.push({ node, path, key });
        walk(
          node.children,
          [path, node.title].filter(Boolean).join(" / "),
          key,
        );
      });
    };
    walk(scan.courseTree, "", "source");
    return all;
  }, [scan]);
  const matches = rows.filter(
    ({ node, path }) =>
      (!type || node.type === type) &&
      `${node.title} ${path} ${node.type} ${node.idref || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
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
      <div className="metric-grid">
        <div>
          <strong>{scan.moduleCount ?? "—"}</strong>
          <span>Source modules</span>
        </div>
        <div>
          <strong>{String(scan.stats?.totalItems ?? "—")}</strong>
          <span>Source items</span>
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
      <div className="filter-bar">
        <label>
          Find source content
          <input
            value={query}
            placeholder="Title, module, type or resource ID"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(40);
            }}
          />
        </label>
        <label>
          Source content type
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setLimit(40);
            }}
          >
            <option value="">All types</option>
            {[...new Set(rows.map((r) => r.node.type))].sort().map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint" role="status">
        {matches.length} of {rows.length} hierarchy entries · source order
        preserved
      </p>
      <div className="source-items">
        {matches.slice(0, limit).map(({ node, path, key }) => {
          const payload = node.sourcePayload;
          return (
            <details key={key}>
              <summary>
                <span>
                  <strong>{node.title || "Untitled source entry"}</strong>
                  <small>{path || "Course root"}</small>
                </span>
                <span className="badge">{node.type || "Unknown type"}</span>
              </summary>
              <div className="item-evidence">
                <p className="hint">
                  Resource ID: {node.idref || "Not recorded"}
                  {node.autoDeleted
                    ? " · Marked as excluded in the source scan"
                    : ""}
                </p>
                {payload?.textSample ? (
                  <>
                    <h4>Captured source text</h4>
                    <blockquote>{payload.textSample}</blockquote>
                    <p className="hint">
                      {payload.evidenceTruncated
                        ? "This source excerpt was truncated."
                        : "Captured text does not establish complete runtime coverage."}
                    </p>
                  </>
                ) : (
                  <p>No text excerpt is recorded for this entry.</p>
                )}
                {payload?.structuredAssessment && (
                  <p>
                    <strong>
                      {payload.structuredAssessment.questionCount} questions
                      recorded.
                    </strong>{" "}
                    Expand the full entry evidence below for question and answer
                    details.
                  </p>
                )}
                {!!payload?.files?.length && (
                  <>
                    <h4>Source files</h4>
                    <ul className="file-evidence">
                      {payload.files.map((file, i) => (
                        <li key={i}>
                          <strong>
                            {file.name ||
                              file.path ||
                              file.href ||
                              "Unnamed file"}
                          </strong>
                          <small>
                            {file.presentInPackage === true
                              ? "Present in package"
                              : file.presentInPackage === false
                                ? "Not present in package"
                                : "Package presence not recorded"}
                            {file.hashStatus ? ` · ${file.hashStatus}` : ""}
                          </small>
                          {file.sha256 && <code>SHA-256: {file.sha256}</code>}
                          {(file.readError || file.pdfReadError) && (
                            <p className="error">
                              {file.readError || file.pdfReadError}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <EvidenceDetails title="Full entry evidence" value={node} />
              </div>
            </details>
          );
        })}
      </div>
      {!matches.length && (
        <p className="empty-state">No source entries match these filters.</p>
      )}
      {matches.length > limit && (
        <button className="secondary" onClick={() => setLimit(limit + 40)}>
          Show next 40 entries
        </button>
      )}
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
