import { useEffect, useMemo, useState } from "react";
import { loadReportContent } from "../src/domain/report-content-store";
import OriginalContentImport from "./OriginalContentImport";
import {
  validateContentSnapshot,
  type ContentSnapshot,
} from "../src/domain/content-evidence";
import OwnerActionCard from "./OwnerActionCard";
import {
  buildOwnerTasks,
  needsOwnerAction,
  normalizeOwnerContext,
  ownerCourseLocation,
  safeWebUrl,
} from "../src/domain/owner-actions";
import type {
  EvidenceObject,
  WorkspaceRecord,
} from "../src/domain/workspace-types";
import type { WorkspaceStore } from "../src/domain/workspace-store";

const labels: Record<string, string> = {
  REPAIR_OR_CONFIRM: "Confirm / fix",
  REVIEW: "Check in Coursera",
  EVIDENCE_NEEDED: "Evidence needed",
  VERIFIED_EVIDENCE: "Evidence aligned",
  NOT_SOURCE_VERIFIED: "Check source match",
};
export default function OwnerEvidence({
  result,
  report = {},
  auditId = "",
  course,
  records = [],
  store,
  onSaved,
  onOpenExtraction,
}: {
  result: EvidenceObject;
  report?: EvidenceObject;
  auditId?: string;
  course?: WorkspaceRecord | null;
  records?: WorkspaceRecord[];
  store?: WorkspaceStore | null;
  onSaved?: () => Promise<void>;
  onOpenExtraction?: (url?: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [show, setShow] = useState("attention"),
    [limit, setLimit] = useState(40);
  const [courseUrl, setCourseUrl] = useState("");
  const [contentState, setContentState] = useState<{
    snapshot?: ContentSnapshot;
    error: string;
  }>({ error: "" });
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const snapshot =
          store && auditId && course
            ? await loadReportContent(
                report,
                auditId,
                course.id,
                store,
                records,
              )
            : report.contentEvidence;
        if (snapshot) validateContentSnapshot(snapshot);
        if (alive) setContentState({ snapshot, error: "" });
      } catch (e) {
        if (alive)
          setContentState((previous) => ({
            ...previous,
            error: e instanceof Error ? e.message : String(e),
          }));
      }
    };
    void read();
    return () => {
      alive = false;
    };
  }, [report, auditId, course?.id, store, records]);
  const sourceMatches =
    !report.sourceScanSha256 ||
    report.sourceScanSha256 === course?.data.scan?.fileSha256;
  const tasks = useMemo(
    () =>
      buildOwnerTasks(
        result,
        sourceMatches ? course?.data.scan?.courseTree || [] : [],
        courseUrl,
        contentState.snapshot?.coursera,
      ),
    [result, course, sourceMatches, courseUrl, contentState.snapshot],
  );
  const location = ownerCourseLocation(result, courseUrl);
  const sourceContext = useMemo(
    () => normalizeOwnerContext(report.ownerContext),
    [report.ownerContext],
  );
  const reviews = records.filter(
    (r) =>
      r.kind === "item-review" &&
      r.data.auditId === auditId &&
      r.packageId === course?.id,
  );
  const reviewFor = (key: string) =>
    reviews.find((r) => r.data.itemKey === key);
  const attention = tasks.filter(needsOwnerAction);
  const checked = attention.filter(
    (t) => reviewFor(t.key)?.data.review?.status === "checked",
  );
  const remaining = attention.length - checked.length;
  const items = tasks.filter((i) => {
    const progress = reviewFor(i.key)?.data.review?.status || "open";
    return (
      (show !== "attention" ||
        (needsOwnerAction(i) && progress !== "checked")) &&
      (show !== "checked" || progress === "checked") &&
      (!status || i.status === status) &&
      [
        i.name,
        i.path,
        i.type,
        labels[i.status],
        ...i.actions.map((a) => a.action),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  if (!result.ownerView) return null;
  return (
    <section className="owner-evidence" aria-label="Course action workspace">
      <div className="action-intro">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR NEXT STEPS</p>
            <h3>Coursera content view</h3>
          </div>
          {location && (
            <a
              className="button-link secondary"
              href={`${location.base}/edit`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open course ↗
            </a>
          )}
        </div>
        <p className="action-lead">
          {remaining
            ? `${remaining} items to work through. Start with a finding, open its Coursera item, and record what you checked or changed.`
            : attention.length
              ? "Your manual checks are recorded. Review remaining evidence gaps before publication."
              : "No item actions were raised by this comparison. Review evidence coverage before publication."}
        </p>
        <div className="action-counts">
          <span>
            <strong>
              {tasks.filter((t) => t.status === "REPAIR_OR_CONFIRM").length}
            </strong>{" "}
            flagged to confirm / fix
          </span>
          <span>
            <strong>
              {attention.length -
                tasks.filter((t) => t.status === "REPAIR_OR_CONFIRM").length}
            </strong>{" "}
            flagged for other checks
          </span>
          <span>
            <strong>{checked.length}</strong> checked by you
          </span>
          <span>
            <strong>{tasks.length - attention.length}</strong> no action raised
          </span>
        </div>
        {!!attention.length && (
          <progress
            max={attention.length}
            value={checked.length}
            aria-label="Items manually checked"
          />
        )}
        <p className="hint">
          Your work is saved against this report. Manual checks and fresh item
          captures stay separate from the original QA verdict. Marking work done
          does not change the course or certify publication.
        </p>
      </div>
      {!location && (
        <label className="course-link-entry">
          Coursera course or item URL
          <input
            value={courseUrl}
            onChange={(e) => setCourseUrl(e.target.value)}
            placeholder="Paste this course’s /teach/…/content/edit URL"
          />
          <small>
            This older report has no usable course URL. Use the matching shell
            to enable item links and targeted checks.
          </small>
        </label>
      )}
      {contentState.error && (
        <p role="alert">
          {contentState.error} Invalid content has not been shown as verified
          evidence.
        </p>
      )}
      <OriginalContentImport
        report={report}
        auditId={auditId}
        store={store}
        onSaved={onSaved}
      />
      {!sourceMatches && (
        <p className="scope">
          The saved source scan has changed since this report. Its newer content
          is not being presented as this report’s repair evidence. The original
          findings remain available.
        </p>
      )}
      <div className="action-switch" role="group" aria-label="Show owner work">
        {[
          ["attention", `Needs attention (${remaining})`],
          ["all", `All items (${tasks.length})`],
          ["checked", `Checked by you (${checked.length})`],
        ].map(([value, label]) => (
          <button
            key={value}
            className={show === value ? "primary" : "secondary"}
            aria-pressed={show === value}
            onClick={() => {
              setShow(value);
              setLimit(40);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="filter-bar">
        <label>
          Find an item or action
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(40);
            }}
            placeholder="Title, module, question or file"
          />
        </label>
        <label>
          Finding status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setLimit(40);
            }}
          >
            <option value="">All findings</option>
            {Object.entries(labels).map(([value, label]) => (
              <option value={value} key={value}>
                {label} ({tasks.filter((i) => i.status === value).length})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint" role="status">
        Showing {Math.min(items.length, limit)} of {items.length} matching items
        · Coursera order preserved · source-only findings follow the outline
      </p>
      {items.slice(0, limit).map((item, index) => (
        <div key={item.key}>
          {(index === 0 || items[index - 1].path !== item.path) && (
            <h4 className="outline-path">
              {item.sourceOnly ? "Source evidence · " : ""}
              {item.path}
            </h4>
          )}
          <OwnerActionCard
            task={item}
            label={labels[item.status] || item.status}
            auditId={auditId}
            course={course}
            store={store}
            saved={reviewFor(item.key)}
            onSaved={onSaved}
            context={sourceContext}
            courseLocation={location}
            onOpenExtraction={onOpenExtraction}
            contentSnapshot={contentState.snapshot}
          />
        </div>
      ))}
      {!items.length && (
        <p className="empty-state">
          {show === "attention" && !query && !status
            ? "No open items in this view. Use All items to revisit evidence and your recorded checks."
            : "No items match these filters."}
        </p>
      )}
      {items.length > limit && (
        <button className="secondary" onClick={() => setLimit(limit + 40)}>
          Show next 40 items
        </button>
      )}
      {!!result.liveSourceGroundTruth?.liveOnlyItems?.length && (
        <details className="scope">
          <summary>
            Additional Brightspace items to reconcile (
            {result.liveSourceGroundTruth.liveOnlyItems.length})
          </summary>
          <p>
            These source items are outside the package match. Confirm their
            intended destination before creating duplicates.
          </p>
          {result.liveSourceGroundTruth.liveOnlyItems.map(
            (i: EvidenceObject, n: number) => (
              <p key={n}>
                <strong>{i.title}</strong> · {i.path}
              </p>
            ),
          )}
          {safeWebUrl(sourceContext.sourceCourseUrl) && (
            <a
              href={safeWebUrl(sourceContext.sourceCourseUrl)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Brightspace course ↗
            </a>
          )}
        </details>
      )}
      <p className="hint">{result.ownerView.authority}</p>
    </section>
  );
}
