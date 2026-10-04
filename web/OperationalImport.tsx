import { useMemo, useState } from "react";
import type { BookData } from "../src/adapters/workbook";
import {
  IMPORT_FIELDS,
  previewOperationalImport,
  suggestImportColumns,
  type ImportSelection,
  type OperationalImportKind,
  type OperationalPreview,
} from "../src/domain/operational-import";
import type { CatalogRow, PlannerRow } from "../src/domain/operations";
import SearchableSelect, { matchesSearch } from "./SearchableSelect";

export function OperationalRows({
  rows,
  label,
}: {
  rows: (CatalogRow | PlannerRow)[];
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const found = rows.filter((row) =>
    matchesSearch(query, ...Object.values(row)),
  );
  return (
    <div>
      <label>
        Search {label}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(50);
          }}
          placeholder="Course, filename, partner, owner or comments"
        />
      </label>
      <p role="status">
        {found.length} of {rows.length} rows match. Showing{" "}
        {Math.min(limit, found.length)}.
      </p>
      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label={`${label} rows`}
      >
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Source row</th>
              <th scope="col">Course / assignment</th>
              <th scope="col">Owner</th>
              <th scope="col">Comments / remarks</th>
            </tr>
          </thead>
          <tbody>
            {found.slice(0, limit).map((row, index) => (
              <tr key={`${row.sourceRow}-${index}`}>
                <td>
                  {row.sourceSheet || "Worksheet not recorded"} ·{" "}
                  {row.sourceRow}
                </td>
                <td>
                  {"title" in row ? (
                    <>
                      <strong>{row.title}</strong>
                      <small>
                        {row.displayCode} · {row.expectedFileName}
                      </small>
                      <small>
                        {row.partner} ·{" "}
                        {row.importStatus || "Import status not recorded"}
                      </small>
                    </>
                  ) : (
                    <>
                      <strong>
                        {row.assignmentDate} · {row.partner}
                      </strong>
                      <small>
                        {row.courseReference || "Course references in remarks"}
                      </small>
                      <small>
                        {row.totalTitleCount ?? "Unknown"} titles ·{" "}
                        {row.category} · {row.status}
                      </small>
                    </>
                  )}
                </td>
                <td>{row.owner || "Unassigned"}</td>
                <td className="preserve-lines">
                  {"title" in row
                    ? row.comments || "No comments recorded"
                    : row.remarks || "No remarks recorded"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {found.length > limit && (
        <button className="secondary" onClick={() => setLimit((n) => n + 50)}>
          Show 50 more rows
        </button>
      )}
    </div>
  );
}
export default function OperationalImport({
  book,
  kind,
  partner,
  disabled,
  onCancel,
  onSave,
}: {
  book: BookData;
  kind: OperationalImportKind;
  partner: string;
  disabled: boolean;
  onCancel: () => void;
  onSave: (
    selection: ImportSelection,
    preview: OperationalPreview,
    sourceUrl: string,
  ) => Promise<void>;
}) {
  const [sheet, setSheet] = useState(Object.keys(book.sheets)[0]);
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState(() =>
    suggestImportColumns(kind, book.sheets[sheet].values[0] || []),
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [acceptSkipped, setAcceptSkipped] = useState(false);
  const selection = useMemo(
    () => ({ sheet, headerRow, columns }),
    [sheet, headerRow, columns],
  );
  const check = useMemo(() => {
    try {
      return {
        preview: previewOperationalImport(book, kind, selection, partner),
        error: "",
      };
    } catch (e) {
      return {
        preview: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [book, kind, selection, partner]);
  const headers = book.sheets[sheet]?.values[headerRow - 1] || [];
  function chooseSheet(value: string, row: number) {
    setSheet(value);
    setHeaderRow(row);
    setColumns(
      suggestImportColumns(kind, book.sheets[value]?.values[row - 1] || []),
    );
    setAcceptSkipped(false);
  }
  return (
    <section className="import-preview" aria-label="Operational import preview">
      <h3>Review {kind === "catalog" ? "catalogue" : "planner"} import</h3>
      <p>
        {book.name}
        {kind === "catalog" ? ` · ${partner}` : ""}. Choose the worksheet and
        confirm its columns. This saves an imported snapshot; the original
        Google Sheet is unchanged and does not sync automatically.
      </p>
      <fieldset disabled={disabled}>
        <legend>Worksheet and column mapping</legend>
        <div className="settings">
          <SearchableSelect
            label="Import worksheet"
            options={Object.keys(book.sheets).map((name) => ({
              value: name,
              label: name,
            }))}
            value={sheet}
            onChange={(name) => {
              if (name) chooseSheet(name, 1);
            }}
          />
          <label>
            Header row
            <input
              type="number"
              min="1"
              max={book.sheets[sheet]?.values.length || 1}
              value={headerRow}
              onChange={(e) => chooseSheet(sheet, Number(e.target.value))}
            />
          </label>
          <label>
            Original Google Sheet URL (optional)
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
            />
          </label>
        </div>
        <p className="hint">
          Suggested mappings use recognised header names. Duplicate or
          unfamiliar headings require your selection. Dates use YYYY-MM-DD,
          MM/DD/YYYY or Excel date cells.
        </p>
        <div className="mapping-grid">
          {IMPORT_FIELDS[kind].map(([field]) => (
            <SearchableSelect
              key={field}
              label={`Column for ${field}`}
              value={columns[field] >= 0 ? String(columns[field]) : ""}
              emptyLabel="Not mapped"
              options={headers.map((header, index) => ({
                value: String(index),
                label: `${index + 1}: ${String(header ?? "") || "Blank heading"}`,
              }))}
              onChange={(value) => {
                setColumns({
                  ...columns,
                  [field]: value === "" ? -1 : Number(value),
                });
                setAcceptSkipped(false);
              }}
            />
          ))}
        </div>
        {check.error && <p role="alert">{check.error}</p>}
        {check.preview && (
          <>
            <p role="status">
              {check.preview.rows.length} usable rows ·{" "}
              {check.preview.issues.length} rejected rows ·{" "}
              {check.preview.blankRows} blank rows.
            </p>
            {check.preview.warnings.map((warning) => (
              <p className="scope" key={warning}>
                {warning}
              </p>
            ))}
            {check.preview.issues.length > 0 && (
              <div className="migration-issues">
                <p>These rows will not be imported:</p>
                <ul>
                  {check.preview.issues.slice(0, 50).map((issue) => (
                    <li key={issue.row}>
                      Row {issue.row}: {issue.message}
                    </li>
                  ))}
                </ul>
                {check.preview.issues.length > 50 && (
                  <p>
                    {check.preview.issues.length - 50} additional rejected rows.
                    Correct the workbook before importing to inspect them all.
                  </p>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={acceptSkipped}
                    onChange={(e) => setAcceptSkipped(e.target.checked)}
                  />
                  Import only the usable rows; I have reviewed the rejected
                  rows.
                </label>
              </div>
            )}
            <OperationalRows
              key={`${sheet}-${headerRow}`}
              label="import preview"
              rows={check.preview.rows}
            />
          </>
        )}
        <div className="button-row">
          <button
            className="primary"
            disabled={
              !check.preview?.rows.length ||
              (!!check.preview.issues.length && !acceptSkipped)
            }
            onClick={() => {
              if (check.preview)
                void onSave(selection, check.preview, sourceUrl);
            }}
          >
            Save reviewed import
          </button>
          <button className="secondary" onClick={onCancel}>
            Cancel import
          </button>
        </div>
      </fieldset>
    </section>
  );
}
