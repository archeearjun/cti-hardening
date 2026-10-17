import type { BrightspaceHtmlStructure } from "../src/domain/brightspace-html-structure";
import type { BrightspaceSourceBody } from "../src/domain/content-evidence";

type Panel = BrightspaceHtmlStructure["groups"][number]["panels"][number];
type Resource = Panel["resources"][number];
type SourceReference = BrightspaceSourceBody["references"][number];

function matchingReferences(resource: Resource, references: SourceReference[]) {
  const resourceUrls = [resource.url, resource.rawUrl].filter(Boolean);
  return references.filter(
    (reference) =>
      reference.tag === resource.tag &&
      reference.attribute === resource.attribute &&
      [reference.url, reference.rawUrl].some(
        (url) => !!url && resourceUrls.includes(url),
      ),
  );
}

function AuthoredAttribute({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <p className="captured-text">
      {label}:{" "}
      {value === null
        ? "attribute absent"
        : value === ""
          ? "empty attribute"
          : value}
    </p>
  );
}

function ResourceEvidence({
  resource,
  references,
  identity,
}: {
  resource: Resource;
  references: SourceReference[];
  identity: string;
}) {
  const matches = matchingReferences(resource, references);
  const unique = matches.length === 1 ? matches[0] : null;
  const reference =
    unique && resource.url && (!unique.url || unique.url === resource.url)
      ? unique
      : null;
  return (
    <li data-html-resource={identity}>
      <p>
        <code>
          {resource.tag}.{resource.attribute}
        </code>{" "}
        ·{" "}
        {reference
          ? `Read outcome: ${reference.status || "Unrecorded"}`
          : matches.length > 1
            ? "Read outcome: unverified — multiple matching capture references"
            : unique
              ? "Read outcome: unverified — conflicting or unsafe reference binding"
              : "Read outcome: unverified — no matching capture reference"}
      </p>
      <AuthoredAttribute label="Authored title" value={resource.title} />
      {resource.tag === "img" && (
        <AuthoredAttribute label="Authored image alt" value={resource.alt} />
      )}
      <p className="captured-text">Authored URL: {resource.rawUrl}</p>
      {resource.url && resource.url !== resource.rawUrl && (
        <p className="captured-text">Resolved reference: {resource.url}</p>
      )}
      {!resource.url && (
        <p className="hint">
          No safe resolved reference is recorded for this resource.
        </p>
      )}
      {reference?.reason && <p className="hint">{reference.reason}</p>}
      {reference?.originalRef && (
        <p className="captured-text">
          Retained original reference: {reference.originalRef}
        </p>
      )}
    </li>
  );
}

function CapturedTable({
  table,
  identity,
}: {
  table: Panel["tables"][number];
  identity: string;
}) {
  const spans = table.rows.flatMap((row, rowIndex) =>
    row.cells.flatMap((cell, cellIndex) =>
      cell.rowSpan !== null || cell.colSpan !== null
        ? [{ rowIndex, cellIndex, cell }]
        : [],
    ),
  );
  return (
    <details data-html-table={identity}>
      <summary>Captured table {table.ordinal}</summary>
      <p className="hint">
        Authored header and data cells, in source row order. Cell spans are
        recorded separately; this preview does not reproduce the source layout.
      </p>
      <div
        className="table-scroll"
        role="region"
        aria-label={`Captured table ${table.ordinal} cells`}
        tabIndex={0}
        style={{ maxWidth: "100%", overflowX: "auto" }}
      >
        <table>
          <caption>{table.caption}</caption>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.cells.map((cell, cellIndex) =>
                  cell.kind === "th" ? (
                    <th key={cellIndex} className="captured-text">
                      {cell.text}
                    </th>
                  ) : (
                    <td key={cellIndex} className="captured-text">
                      {cell.text}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!spans.length && (
        <details>
          <summary>Authored cell span attributes</summary>
          <ul>
            {spans.map(({ rowIndex, cellIndex, cell }) => (
              <li key={`${rowIndex}:${cellIndex}`} className="captured-text">
                Row {rowIndex + 1}, cell {cellIndex + 1} ({cell.kind})
                {cell.rowSpan !== null &&
                  ` · rowspan=${JSON.stringify(cell.rowSpan)}`}
                {cell.colSpan !== null &&
                  ` · colspan=${JSON.stringify(cell.colSpan)}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </details>
  );
}

export default function BrightspaceHtmlStructureEvidence({
  structure,
  references,
}: {
  structure: BrightspaceHtmlStructure;
  references: SourceReference[];
}) {
  return (
    <details
      aria-label="Captured tabs and tables"
      style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}
    >
      <summary>Captured tabs and tables</summary>
      <p className="hint">
        Static markup preview. This shows authored panel text, table cells and
        resource references, including panels hidden in the saved markup. It
        does not establish live layout, playback, loaded embedded content or
        runtime interaction completion.
      </p>
      <p className="hint">
        Topic {structure.topicId} · {structure.groups.length} captured tab
        groups
      </p>
      {structure.truncated && (
        <p role="status">
          This structure preview is truncated. The retained original remains the
          source for content outside the preview limits.
        </p>
      )}
      {!!structure.issues.length && (
        <details>
          <summary>Structure extraction limits and unresolved bindings</summary>
          <ul>
            {structure.issues.map((issue, index) => (
              <li key={index} className="captured-text">
                {issue}
              </li>
            ))}
          </ul>
        </details>
      )}
      {structure.groups.map((group) => (
        <section key={group.ordinal} data-html-group={String(group.ordinal)}>
          <h6>Tab group {group.ordinal}</h6>
          <p className="hint">Source-authored horizontal tabs</p>
          {group.instruction !== "" && (
            <p className="captured-text">{group.instruction}</p>
          )}
          {group.panels.map((panel) => {
            const identity = `${group.ordinal}:${panel.key}`;
            return (
              <details
                key={panel.key}
                data-html-panel={identity}
                data-html-panel-key={panel.key}
              >
                <summary>
                  {panel.label !== "" ? panel.label : `Panel key ${panel.key}`}
                </summary>
                <p className="hint">
                  Authored key: <code>{panel.key}</code> · Initial markup state:{" "}
                  {panel.activeAtCapture ? "active" : "inactive"}
                  {panel.label === "" && " · Authored label is empty"}
                </p>
                <p className="captured-text">{panel.text}</p>
                {panel.textTruncated && (
                  <p className="hint">This panel text preview is truncated.</p>
                )}
                {panel.tables.map((table) => (
                  <CapturedTable
                    key={table.ordinal}
                    table={table}
                    identity={`${identity}:${table.ordinal}`}
                  />
                ))}
                {!!panel.resources.length && (
                  <details>
                    <summary>
                      Authored resource references ({panel.resources.length})
                    </summary>
                    <p className="hint">
                      References remain text here. An iframe reference does not
                      establish that its inner content was captured, and an
                      image reference does not establish that the image loaded.
                    </p>
                    <ol>
                      {panel.resources.map((resource, index) => (
                        <ResourceEvidence
                          key={index}
                          identity={`${identity}:${index + 1}`}
                          resource={resource}
                          references={references}
                        />
                      ))}
                    </ol>
                  </details>
                )}
              </details>
            );
          })}
        </section>
      ))}
    </details>
  );
}
