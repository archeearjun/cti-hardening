import { useEffect, useMemo, useState } from "react";
import { loadReportContent } from "../src/domain/report-content-store";
import { sourceIdentityMessage } from "../src/domain/assignment-evidence";
import OriginalContentImport from "./OriginalContentImport";
import {
  validateContentSnapshot,
  type ContentSnapshot,
} from "../src/domain/content-evidence";
import OwnerActionCard from "./OwnerActionCard";
import OwnerChecklistTree from "./OwnerChecklistTree";
import ModuleTimeSummary from "./ModuleTimeSummary";
import { ownerScope, ownerHierarchy, referenceArea } from "../src/domain/owner-scope";
import { moduleTimes } from "../src/domain/owner-time";
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
    !!report.sourceScanSha256 &&
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
    reviews.filter((r) => r.data.itemKey === key).length === 1 ? reviews.find((r) => r.data.itemKey === key) : undefined;
  const included = tasks.filter(t => ownerScope(t, reviewFor(t.key)?.data.review).included);
  const excluded = tasks.filter(t => !ownerScope(t, reviewFor(t.key)?.data.review).included);
  const attention = included.filter(t => needsOwnerAction(t, reviewFor(t.key)?.data.review));
  const groups = ownerHierarchy(tasks);
  const checked = attention.filter(
    (t) => reviewFor(t.key)?.data.review?.status === "checked",
  );
  const remaining = attention.length - checked.length;
  const matchingTasks = tasks.filter((i) => {
    return (
      (ownerScope(i, reviewFor(i.key)?.data.review).included === (show !== "excluded")) &&
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
  const items = matchingTasks.filter((i) => {
    const progress = reviewFor(i.key)?.data.review?.status || "open";
    if (show === "excluded") return !ownerScope(i, reviewFor(i.key)?.data.review).included;
    if (!ownerScope(i, reviewFor(i.key)?.data.review).included) return false;
    return (
      (show !== "attention" ||
        (needsOwnerAction(i, reviewFor(i.key)?.data.review) && progress !== "checked")) &&
      (show !== "checked" || progress === "checked")
    );
  });
  const hiddenMatches = matchingTasks.length - items.length;
  const viewLabel =
    show === "attention"
      ? "Needs attention"
      : show === "checked"
        ? "Checked by you"
        : show === "excluded" ? "Excluded / reference only" : "All items";
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
              {included.filter((t) => t.status === "REPAIR_OR_CONFIRM").length}
            </strong>{" "}
            flagged to confirm / fix
          </span>
          <span>
            <strong>
              {attention.length -
                included.filter((t) => t.status === "REPAIR_OR_CONFIRM").length}
            </strong>{" "}
            flagged for other checks
          </span>
          <span>
            <strong>{checked.length}</strong> checked by you
          </span>
          <span>
            <strong>{included.length - attention.length}</strong> no action raised
          </span>
          <span><strong>{excluded.length}</strong> reference only / excluded</span>
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
          {sourceIdentityMessage(
            course?.data.scan?.fileSha256,
            report.sourceScanSha256,
          )}{" "}
          The selected package is not being presented as this report’s matched
          repair evidence. The original findings remain available.
        </p>
      )}
      <div className="action-switch" role="group" aria-label="Show owner work">
        {[
          ["attention", `Needs attention (${remaining})`],
          ["all", `All items (${included.length})`],
          ["checked", `Checked by you (${checked.length})`],
          ["excluded", `Excluded / reference only (${excluded.length})`],
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
      <p className="hint">Instructor/instructional resources, archives and items marked not relevant are excluded from the checklist and learner-time totals. Use “Excluded / reference only” to inspect or restore them. Relevance is saved with this report; it does not delete or publish anything in Coursera.</p>
      <ModuleTimeSummary rows={moduleTimes(tasks, reviews)} />
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
        · View: {viewLabel} · Coursera order preserved · source-only findings
        follow the outline
      </p>
      {!!hiddenMatches && (
        <div className="scope">
          <p>
            {hiddenMatches} other matching item
            {hiddenMatches === 1 ? " is" : "s are"} hidden by the “{viewLabel}”
            view. “All findings” applies within this view; it does not show the
            whole course.
          </p>
          <button
            className="secondary"
            onClick={() => {
              setShow("all");
              setLimit(40);
            }}
          >
            Show all matching items ({matchingTasks.length})
          </button>
        </div>
      )}
      <OwnerChecklistTree groups={groups} visible={new Set(items.slice(0, limit).map(t => t.key))} reviewFor={key => reviewFor(key)?.data.review} renderItem={item => (
          <OwnerActionCard
            task={item}
            label={ownerScope(item, reviewFor(item.key)?.data.review).included ? labels[item.status] || item.status : "Reference only"}
            auditId={auditId}
            course={course}
            store={store}
            saved={reviewFor(item.key)}
            onSaved={async (nextStatus, relevance) => {
              // Keep a reopened item visible when its previous outcome was
              // the reason it appeared in the current filter.
              if (show === "checked" && nextStatus !== "checked")
                setShow("all");
              if (!ownerScope(item, { relevance }).included) setShow("excluded");
              else if (show === "excluded") setShow("all");
              await onSaved?.();
            }}
            context={sourceContext}
            courseLocation={location}
            onOpenExtraction={onOpenExtraction}
            contentSnapshot={contentState.snapshot}
          />
      )} />
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
      {!!result.liveSourceGroundTruth?.liveOnlyItems?.filter((i: EvidenceObject) => !referenceArea(String(i.path || ""))).length && (
        <details className="scope">
          <summary>
            Additional Brightspace items to reconcile (
            {result.liveSourceGroundTruth.liveOnlyItems.filter((i: EvidenceObject) => !referenceArea(String(i.path || ""))).length})
          </summary>
          <p>
            These source items are outside the package match. Confirm their
            intended destination before creating duplicates.
          </p>
          {result.liveSourceGroundTruth.liveOnlyItems.filter((i: EvidenceObject) => !referenceArea(String(i.path || ""))).map(
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
