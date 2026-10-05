import { useMemo, useState } from "react";
import type { PackageScan } from "../src/domain/package-types";
import {
  sourceTreeRows,
  type SourceTreeRow,
} from "../src/domain/source-hierarchy";
import EvidenceDetails from "./EvidenceDetails";

function EntryEvidence({
  row,
  scan,
}: {
  row: SourceTreeRow;
  scan: PackageScan;
}) {
  const node = row.node;
  const payload =
    node.sourcePayload ||
    (node.idref ? scan.sourceEvidence?.resources[node.idref] : undefined);
  const assessment = payload?.structuredAssessment;
  return (
    <div className="item-evidence">
      <p className="hint">
        {row.path || "Course root"} · Resource ID:{" "}
        {node.idref || "Structural folder"}
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
        node.idref && <p>No text excerpt is recorded for this entry.</p>
      )}
      {assessment && (
        <p>
          <strong>
            {assessment.questionCount} question definitions captured
            {assessment.declaredQuestionCount != null
              ? ` of ${assessment.declaredQuestionCount} declared`
              : ""}
            .
          </strong>{" "}
          Full question and answer details are in the entry evidence below.
        </p>
      )}
      {!!payload?.files?.length && (
        <>
          <h4>Source files</h4>
          <ul className="file-evidence">
            {payload.files.map((file, i) => (
              <li key={i}>
                <strong>
                  {file.name || file.path || file.href || "Unnamed file"}
                </strong>
                <small>
                  {file.presentInPackage === true
                    ? "Present in package"
                    : file.presentInPackage === false
                      ? "Not resolved in package"
                      : /^https?:|^\/\//i.test(file.href || "")
                        ? "External reference · content not fetched"
                        : "Package presence not recorded"}
                  {file.hashStatus ? ` · ${file.hashStatus}` : ""}
                </small>
                {file.sha256 && <code>SHA-256: {file.sha256}</code>}
                {(file.readError || file.pdfReadError) && (
                  <p className="error">{file.readError || file.pdfReadError}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {node.autoDeleted && (
        <p className="hint">
          Marked for omission in the comparison projection. The source package
          is unchanged.
        </p>
      )}
      <EvidenceDetails
        title="Full entry evidence"
        value={{ ...node, sourcePayload: payload }}
      />
    </div>
  );
}

function Branch({
  row,
  childRows,
  scan,
  filtered,
  childrenByParent,
}: {
  row: SourceTreeRow;
  childRows: SourceTreeRow[];
  scan: PackageScan;
  filtered: boolean;
  childrenByParent: Map<string, SourceTreeRow[]>;
}) {
  const [open, setOpen] = useState(
    !!row.node.children?.length && (filtered || row.ancestors.length < 2),
  );
  const isFolder = !row.node.idref;
  return (
    <li data-source-key={row.key}>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <span>
            <strong>{row.node.title || "Untitled entry"}</strong>
            <small>
              {isFolder
                ? `${row.node.children?.length || 0} direct entries`
                : row.node.idref}
            </small>
          </span>
          <span className="badge">
            {isFolder ? "Folder" : row.node.type || "Unknown type"}
          </span>
        </summary>
        {open && (
          <>
            {!!childRows.length && (
              <ul className="source-tree-children">
                {childRows.map((child) => (
                  <Branch
                    key={child.key}
                    row={child}
                    childRows={childrenByParent.get(child.key) || []}
                    scan={scan}
                    filtered={filtered}
                    childrenByParent={childrenByParent}
                  />
                ))}
              </ul>
            )}
            {row.node.children?.length > childRows.length && (
              <p className="hint">
                Some entries are outside the current search or display limit.
              </p>
            )}
            {!isFolder && <EntryEvidence row={row} scan={scan} />}
            {isFolder && !row.node.children?.length && (
              <p className="hint">Empty source folder.</p>
            )}
          </>
        )}
      </details>
    </li>
  );
}

export default function SourceTree({
  scan,
  searchLabel,
  className,
}: {
  scan: PackageScan;
  searchLabel: string;
  className: string;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(50);
  const rows = useMemo(() => sourceTreeRows(scan), [scan]);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = rows.filter(
    ({ node, path }) =>
      (!type || node.type === type) &&
      `${node.title} ${path} ${node.type} ${node.idref || ""}`
        .toLowerCase()
        .includes(normalizedQuery),
  );
  const visible = matches.slice(0, limit);
  const included = new Set(
    visible.flatMap((row) => [row.key, ...row.ancestors]),
  );
  const childrenByParent = new Map<string, SourceTreeRow[]>();
  for (const row of rows)
    if (included.has(row.key)) {
      const parent = row.ancestors.at(-1) || "";
      const siblings = childrenByParent.get(parent) || [];
      siblings.push(row);
      childrenByParent.set(parent, siblings);
    }
  const filterKey = `${normalizedQuery}:${type}`;
  return (
    <>
      <p className="hint">
        {scan.sourceHierarchy
          ? "Original IMSCC hierarchy. Expand folders to see their contents; children stay under their module or week."
          : "Saved comparison structure. Rescan the original IMSCC to recover any nested folders omitted by older scans."}
      </p>
      <div className="filter-bar">
        <label>
          {searchLabel}
          <input
            type="search"
            value={query}
            placeholder="Title, module, type or resource ID"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(50);
            }}
          />
        </label>
        <label>
          Source content type
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setLimit(50);
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
        Showing {visible.length} of {matches.length} matching entries (
        {rows.length} total). Parent folders stay visible for context.
      </p>
      <ul
        className={`source-tree ${className}`}
        aria-label="Source course hierarchy"
      >
        {(childrenByParent.get("") || []).map((row) => (
          <Branch
            key={`${filterKey}:${row.key}`}
            row={row}
            childRows={childrenByParent.get(row.key) || []}
            scan={scan}
            filtered={!!filterKey.replace(":", "")}
            childrenByParent={childrenByParent}
          />
        ))}
      </ul>
      {!matches.length && (
        <p className="empty-state">No source entries match these filters.</p>
      )}
      {matches.length > limit && (
        <button className="secondary" onClick={() => setLimit(limit + 50)}>
          Show 50 more entries
        </button>
      )}
    </>
  );
}
