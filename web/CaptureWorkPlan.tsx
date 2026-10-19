import { useMemo, useState } from "react";
import {
  captureWorkPlan,
  type CaptureDestination,
} from "../src/domain/capture-work-plan";
import type { WorkspaceRecord } from "../src/domain/workspace-types";
import { download } from "./workspace-ui";

export default function CaptureWorkPlan({
  records,
  disabled,
  onOpen,
}: {
  records: WorkspaceRecord[];
  disabled: boolean;
  onOpen: (id: string, destination: CaptureDestination) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const plan = useMemo(() => captureWorkPlan(records), [records]);
  const filtered = plan.filter((row) =>
    `${row.title} ${row.owner}`.toLowerCase().includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const activePage = Math.min(page, pages - 1);
  return (
    <details className="card">
      <summary>Plan bookmark captures across titles</summary>
      <p>
        Use this list to collect each title’s source and Coursera evidence. Open
        the indicated CTI tool, then run its bookmark in the matching signed-in
        LMS tab. Opening a tool does not start a capture. Saved input metadata
        does not establish complete content or a fresh recheck.
      </p>
      <label>
        Find title in capture plan
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <button
        disabled={!plan.length || disabled}
        onClick={() =>
          download(
            "CTI-bookmark-capture-plan.json",
            JSON.stringify(
              {
                kind: "CTI_OPERATOR_CAPTURE_PLAN",
                schemaVersion: 1,
                generatedAt: new Date().toISOString(),
                automaticCapture: false,
                completeContentEstablished: false,
                scope:
                  "Saved metadata for operator planning; referenced originals, source coverage and current item observations require separate validation.",
                titles: plan,
              },
              null,
              2,
            ),
            "application/json",
          )
        }
      >
        Download capture plan
      </button>
      {!filtered.length ? (
        <p>No matching saved titles. Save a source baseline to add a title.</p>
      ) : (
        <>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Title capture plan"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Recorded inputs</th>
                  <th scope="col">Next action</th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .slice(activePage * 25, (activePage + 1) * 25)
                  .map((row) => (
                    <tr key={row.courseId}>
                      <td>
                        <strong>{row.title}</strong>
                        <p>{row.owner || "Owner not recorded"}</p>
                      </td>
                      <td>
                        {row.baseline}
                        <p>{row.source}</p>
                        <p>{row.coursera}</p>
                        <small>{row.comparison}</small>
                      </td>
                      <td>
                        <button
                          disabled={disabled}
                          onClick={() => onOpen(row.courseId, row.destination)}
                        >
                          Continue {row.title}
                        </button>
                        <p>{row.next}</p>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="toolbar">
              <button
                disabled={activePage === 0}
                onClick={() => setPage(activePage - 1)}
              >
                Previous titles
              </button>
              <span>
                Page {activePage + 1} of {pages}
              </span>
              <button
                disabled={activePage + 1 >= pages}
                onClick={() => setPage(activePage + 1)}
              >
                Next titles
              </button>
            </div>
          )}
        </>
      )}
    </details>
  );
}
