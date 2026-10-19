import { useEffect, useMemo, useRef, useState } from "react";
import EvidenceInbox from "./EvidenceInbox";
import { AssignmentDeliverables } from "./AssignmentDeliverables";
import AssignmentAdvisory from "./AssignmentAdvisory";
import AssignmentReadiness from "./AssignmentReadiness";
import SourceExplorer from "./SourceExplorer";
import EvidenceDetails from "./EvidenceDetails";
import {
  evaluateAssignment,
  latestAssignmentAudit,
  loadAssignmentEvidence,
} from "../src/domain/assignment-plan";
import { type PendingAssignmentEvidence } from "../src/domain/assignment-evidence";
import { assignmentOwnerJourney } from "../src/domain/assignment-owner-journey";
import { assignmentReadiness } from "../src/domain/assignment-readiness";
import {
  appendLifecycleEvent,
  buildAssignmentItems,
  itemLifecycleState,
  loadItemLifecycle,
  type AssignmentItem,
  type LifecycleChange,
} from "../src/domain/item-lifecycle";
import type { EvidenceStage } from "../src/domain/evidence-intake";
import type { WorkspaceStore } from "../src/domain/workspace-store";
import type { WorkspaceRecord } from "../src/domain/workspace-types";
import { safeWebUrl } from "../src/domain/owner-urls";
import "./assignment-workspace.css";

const sections = [
  "Worklist",
  "Evidence inbox",
  "Package explorer",
  "Deliverables",
] as const;
type AssignmentSection = (typeof sections)[number] | "Advisory";
const label = (value: string) =>
  value.replaceAll("-", " ").replaceAll("_", " ");
const when = (value: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Time not recorded";
const stages = [
  "inventory",
  "reconciliation",
  "transformation",
  "verification",
  "delivery",
];
const decisions = [
  "open",
  "in-progress",
  "changed",
  "checked",
  "blocked",
  "excluded",
];

export default function AssignmentWorkspace({
  course,
  records,
  store,
  disabled,
  pending,
  onSaved,
  onNavigate,
  onStage,
  onCompare,
  onAudit,
  onRescan,
}: {
  course: WorkspaceRecord | null;
  records: WorkspaceRecord[];
  store: WorkspaceStore | null;
  disabled?: boolean;
  pending: PendingAssignmentEvidence;
  onSaved: (record?: WorkspaceRecord) => Promise<void>;
  onNavigate: (view: string) => void;
  onStage: (stage: EvidenceStage) => Promise<void>;
  onCompare: () => Promise<void>;
  onAudit: (audit: WorkspaceRecord) => void;
  onRescan: () => void;
}) {
  const [section, setSection] = useState<AssignmentSection>("Worklist");
  const [audit, setAudit] = useState<WorkspaceRecord | null>(null);
  const [ledger, setLedger] = useState<WorkspaceRecord | null>(null);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [evidenceLoadError, setEvidenceLoadError] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("exceptions");
  const [selected, setSelected] = useState("");
  const [stage, setStage] =
      useState<NonNullable<LifecycleChange["stage"]>>("reconciliation"),
    [decision, setDecision] =
      useState<NonNullable<LifecycleChange["decision"]>>("open"),
    [note, setNote] = useState("");
  const [sourceIds, setSourceIds] = useState(""),
    [destinationIds, setDestinationIds] = useState("");
  const [relation, setRelation] = useState<
    "one-to-one" | "one-to-many" | "many-to-one" | "reuse"
  >("one-to-one");
  const [reload, setReload] = useState(0);
  const drawer = useRef<HTMLElement | null>(null);
  const saveLock = useRef(false);
  const selectionEpoch = useRef(0);
  const latest = course ? latestAssignmentAudit(course.id, records) : null;

  useEffect(() => {
    setSelected("");
    setQuery("");
    setNote("");
    setMessage("");
  }, [course?.id]);

  useEffect(() => {
    let active = true;
    selectionEpoch.current++;
    setAudit(null);
    setLedger(null);
    setError("");
    setEvidenceLoadError("");
    setLoading(!!course && !!store);
    if (course && store)
      void Promise.all([
        latest
          ? loadAssignmentEvidence(latest.id, store, records)
          : Promise.resolve(null),
        loadItemLifecycle(store, course.id),
      ])
        .then(([full, history]) => {
          if (active) {
            setAudit(full);
            setLedger(history);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (active) {
            const detail = e instanceof Error ? e.message : String(e);
            setError(detail);
            setEvidenceLoadError(detail);
            setLoading(false);
          }
        });
    return () => {
      active = false;
    };
  }, [
    course?.id,
    course?.version,
    latest?.id,
    latest?.version,
    records,
    store,
    reload,
  ]);

  const evaluation = useMemo(
    () => (course ? evaluateAssignment(course, audit, records) : null),
    [course, audit, records],
  );
  const items = useMemo(
    () => (course ? buildAssignmentItems(course, audit) : []),
    [course, audit],
  );
  const journey = useMemo(
    () =>
      course && evaluation
        ? assignmentOwnerJourney(course, audit, evaluation, pending)
        : null,
    [course, audit, evaluation, pending],
  );
  const next = journey?.nextAction || null;
  const readiness = useMemo(
    () =>
      course && evaluation
        ? assignmentReadiness(course, audit, evaluation, records, {
            loading,
            loadError: evidenceLoadError,
            pendingChanged: pending.changed,
          })
        : null,
    [
      course,
      audit,
      evaluation,
      records,
      loading,
      evidenceLoadError,
      pending.changed,
    ],
  );
  const states = useMemo(
    () =>
      new Map(
        items.map((item) => [item.key, itemLifecycleState(item, ledger)]),
      ),
    [items, ledger],
  );
  const exception = (item: AssignmentItem) => {
    const state = states.get(item.key)!;
    return (
      item.captureCoverage !== "complete" ||
      item.fidelity !== "verified" ||
      item.identityStatus !== "exact" ||
      state.freshness !== "current" ||
      state.decision === "blocked" ||
      state.decision === "changed"
    );
  };
  const exceptionCount = items.filter(exception).length;
  const visible = items.filter((item) => {
    const state = states.get(item.key)!;
    return (
      [item.name, item.path, item.nativeId, item.type]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()) &&
      (filter === "all" ||
        (filter === "exceptions" && exception(item)) ||
        (filter === "ambiguous" && item.identityStatus === "ambiguous") ||
        (filter === "capture" && item.captureCoverage !== "complete") ||
        (filter === "blocked" && state.decision === "blocked") ||
        (filter === "changed" &&
          (state.freshness !== "current" || state.decision === "changed")))
    );
  });
  const item = items.find((candidate) => candidate.key === selected);
  const state = item ? states.get(item.key)! : null;
  const courseraItemUrl =
    item?.platform === "coursera" && item.identityStatus === "exact"
      ? safeWebUrl(item.task?.url)
      : "";
  const readonly =
    !!disabled || loading || saving || !store || store.role === "viewer";
  const itemReadonly = readonly || !audit || item?.identityStatus !== "exact";

  function openItem(value: AssignmentItem) {
    const current = states.get(value.key)!;
    setSelected(value.key);
    setNote("");
    setStage(current.stage);
    setDecision(current.decision);
    setSourceIds(value.sourceIds.join(", "));
    setDestinationIds(value.destinationIds.join(", "));
    setError("");
    setMessage("");
    requestAnimationFrame(() => drawer.current?.focus());
  }
  async function save(
    kind:
      | "stage"
      | "decision"
      | "mapping-confirmed"
      | "mapping-rejected"
      | "transformation",
  ) {
    if (
      !store ||
      !course ||
      !audit ||
      !item ||
      item.identityStatus !== "exact" ||
      readonly ||
      saveLock.current
    )
      return;
    if (!note.trim()) {
      setError(
        "Add a reason or evidence reference before recording this decision.",
      );
      return;
    }
    const epoch = selectionEpoch.current;
    saveLock.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const ids = (value: string) => [
        ...new Set(
          value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      const changed = await appendLifecycleEvent(
        store,
        course,
        audit,
        item,
        {
          kind,
          note: note.trim(),
          ...(kind === "stage" ? { stage } : {}),
          ...(kind === "decision" ? { decision } : {}),
          ...(kind.startsWith("mapping-") || kind === "transformation"
            ? {
                mapping: {
                  sourceIds: ids(sourceIds),
                  destinationIds: ids(destinationIds),
                  relation,
                },
              }
            : {}),
        },
        ledger || undefined,
      );
      if (epoch !== selectionEpoch.current) return;
      setLedger(changed);
      setNote("");
      setMessage(
        "History recorded. Original captures and audits are retained.",
      );
      await onSaved(changed);
    } catch (e) {
      if (epoch === selectionEpoch.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  function nextAction() {
    if (!next) return;
    if (next.action === "scan") onRescan();
    else if (next.action === "source") onNavigate("Source LMS");
    else if (next.action === "coursera") onNavigate("Extract");
    else if (next.action === "compare") {
      if (pending.excel || pending.coursera) void onCompare();
      else setSection("Evidence inbox");
    } else if (next.action === "worklist") setSection("Worklist");
    else if (next.action === "deliverable") setSection("Deliverables");
    else onNavigate("Assignment plan");
  }
  async function reloadCurrent() {
    setError("");
    try {
      if (course && store) await onSaved(await store.get(course.id));
      setReload((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div
      className="assignment-workspace"
      aria-label="Assignment owner workspace"
    >
      <section className="card assignment-summary">
        <div>
          <p className="eyebrow">ASSIGNMENT OWNER</p>
          <h2>
            {course
              ? "Understand, correct and verify your title"
              : "Inspect your title before making changes"}
          </h2>
          <p>
            {course
              ? "Follow the captured source, compare it with Coursera, and verify each recorded change with fresh evidence. Empty, broken and unexpected source content stays visible as captured."
              : "Start with the source package or an attributed LMS document. Inspect its structure and content, then add the Coursera capture, XLSX and available source LMS extraction before deciding what to fix."}
          </p>
          {!course && (
            <button className="primary" onClick={() => onNavigate("Scan")}>
              Add source package or document
            </button>
          )}
        </div>
        {course && (
          <div className="assignment-next">
            <span className="eyebrow">NEXT ACTION</span>
            <strong>
              {loading
                ? "Loading the current evidence…"
                : next?.title || "Review the current evidence"}
            </strong>
            {next && <p>{next.detail}</p>}
            <button
              className="primary"
              disabled={!!disabled || loading}
              onClick={nextAction}
            >
              {next?.button || "Open assignment plan"}
            </button>
          </div>
        )}
      </section>
      {journey && (
        <section
          className="card assignment-journey"
          aria-label="Your assignment workflow"
        >
          <div className="section-heading">
            <div>
              <h2>Your path through this title</h2>
              <p>{journey.scope}</p>
            </div>
          </div>
          <ol>
            {journey.steps.map((step, index) => (
              <li key={step.id}>
                <button
                  title={step.detail}
                  className={
                    journey.currentStage === step.id ? "journey-current" : ""
                  }
                  aria-current={
                    journey.currentStage === step.id ? "step" : undefined
                  }
                  disabled={!!disabled || loading}
                  onClick={() => {
                    if (step.id === "understand") onNavigate("Explore");
                    else if (step.id === "collect")
                      setSection("Evidence inbox");
                    else if (step.id === "compare") onNavigate("Compare");
                    else if (step.id === "fix") setSection("Worklist");
                    else if (step.id === "verify")
                      journey.recaptureRequired
                        ? nextAction()
                        : onNavigate("Assignment plan");
                    else setSection("Deliverables");
                  }}
                >
                  <span className="journey-step-title">
                    {index + 1}. {step.title}
                  </span>
                  <span className="journey-step-status">
                    {step.status === "recorded"
                      ? "Recorded"
                      : step.status === "limited"
                        ? "Limited evidence"
                        : step.status === "ready"
                          ? "Ready for handoff"
                          : step.status === "needed"
                            ? "Needs attention"
                            : "Later step"}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="hint">
            {
              journey.steps.find((step) => step.id === journey.currentStage)
                ?.detail
            }
          </p>
          {journey.recaptureRequired && (
            <p className="scope" role="status">
              <strong>Changes are waiting for verification.</strong> Use the
              next action above to capture the changed course and save a fresh
              comparison. An owner checkmark does not update captured content.
            </p>
          )}
        </section>
      )}
      {readiness && <AssignmentReadiness value={readiness} />}
      {course && (
        <div className="assignment-metrics" aria-label="Assignment status">
          <div>
            <strong>
              {journey
                ? {
                    understand: "Inspect the title",
                    collect: "Collect evidence",
                    compare: "Compare sources",
                    fix: "Review corrections",
                    verify: "Recapture and verify",
                    deliver: "Prepare deliverables",
                  }[journey.currentStage]
                : evaluation?.outlineReady
                  ? "Delivery preparation"
                  : evaluation?.reconciled
                    ? "Deliverable preparation"
                    : audit
                      ? "Reconciliation"
                      : "Evidence collection"}
            </strong>
            <span>Current assignment stage</span>
          </div>
          <div>
            <strong>{items.length}</strong>
            <span>Retained item identities</span>
          </div>
          <div>
            <strong>{exceptionCount}</strong>
            <span>Items with evidence or review exceptions</span>
          </div>
          <div>
            <strong>{evaluation?.blockers.length || 0}</strong>
            <span>Handoff prerequisites unresolved</span>
          </div>
        </div>
      )}
      {store?.role === "viewer" && (
        <p className="scope">
          Read-only workspace. You can inspect evidence and history; an editor
          records changes.
        </p>
      )}
      {loading && (
        <p role="status">Loading the full report and item history…</p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            disabled={saving}
            onClick={() => void reloadCurrent()}
          >
            Reload current evidence
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="success-notice">
          {message}
        </p>
      )}
      {course && !!evaluation?.blockers.length && (
        <details className="card assignment-blockers">
          <summary>
            {evaluation.blockers.length} prerequisites before handoff
          </summary>
          <ul>
            {evaluation.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </details>
      )}
      <div
        className="assignment-sections"
        role="tablist"
        aria-label="Assignment sections"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const index = sections.indexOf(section as (typeof sections)[number]);
          const nextIndex =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? sections.length - 1
                : (index +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    sections.length) %
                  sections.length;
          setSection(sections[nextIndex]);
          event.currentTarget
            .querySelectorAll<HTMLButtonElement>("[role=tab]")
            [nextIndex]?.focus();
        }}
      >
        {sections.map((value) => (
          <button
            key={value}
            id={`assignment-tab-${value.replaceAll(" ", "-")}`}
            role="tab"
            tabIndex={
              section === value ||
              (section === "Advisory" && value === "Worklist")
                ? 0
                : -1
            }
            aria-selected={section === value}
            aria-controls="assignment-panel"
            onClick={() => setSection(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <details
        className="assignment-advanced"
        open={section === "Advisory" ? true : undefined}
      >
        <summary>Advanced analysis</summary>
        <p className="hint">
          Advisory learning and matching experiments are optional. They do not
          change captured source content, QA findings or approval.
        </p>
        <button
          className="secondary"
          disabled={!!disabled}
          onClick={() => setSection("Advisory")}
        >
          Open advisory analysis
        </button>
      </details>
      <section
        id="assignment-panel"
        role="tabpanel"
        aria-labelledby={
          section === "Advisory"
            ? undefined
            : `assignment-tab-${section.replaceAll(" ", "-")}`
        }
        aria-label={
          section === "Advisory" ? "Advanced advisory analysis" : undefined
        }
      >
        {section === "Evidence inbox" && (
          <EvidenceInbox
            course={course}
            records={records}
            store={store}
            disabled={readonly}
            onSaved={async () => onSaved()}
            onStage={onStage}
            onNavigate={onNavigate}
          />
        )}
        {section === "Package explorer" &&
          (course?.data.scan ? (
            <SourceExplorer scan={course.data.scan} />
          ) : (
            <p className="card">
              Save a source package scan to explore its hierarchy and retained
              content.
            </p>
          ))}
        {section === "Deliverables" && (
          <AssignmentDeliverables
            course={course}
            audit={audit}
            records={records}
            store={store}
            disabled={readonly}
            onSaved={onSaved}
          />
        )}
        {section === "Advisory" &&
          (store ? (
            <AssignmentAdvisory
              course={course}
              audit={audit}
              records={records}
              store={store}
              disabled={readonly}
              onSaved={onSaved}
            />
          ) : (
            <p>Connect a workspace to inspect advisory evidence.</p>
          ))}
        {section === "Worklist" && (
          <>
            <section className="card">
              <div className="section-heading">
                <div>
                  <h2>Item worklist</h2>
                  <p>
                    Check the original evidence before changing Coursera. A
                    confirmed difference, a capture gap and an owner decision
                    are different things.
                  </p>
                </div>
                <div className="context-actions">
                  <button
                    className="secondary"
                    disabled={readonly}
                    onClick={() => setSection("Evidence inbox")}
                  >
                    Add evidence
                  </button>
                  <button
                    className="secondary"
                    disabled={!!disabled}
                    onClick={() => onNavigate("Extract")}
                  >
                    Capture Coursera
                  </button>
                  {audit && (
                    <button
                      className="secondary"
                      disabled={!!disabled || loading}
                      onClick={() => onAudit(audit)}
                    >
                      Open evidence review
                    </button>
                  )}
                </div>
              </div>
              {pending.changed && (
                <p className="scope">
                  New files are staged. Save a comparison to evaluate them; the
                  worklist still reflects the saved evidence.{" "}
                  <button
                    className="secondary"
                    disabled={readonly || (!pending.excel && !pending.coursera)}
                    onClick={() => void onCompare()}
                  >
                    Compare staged evidence
                  </button>
                </p>
              )}
              <div className="assignment-filters">
                <label>
                  Find a work item
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Title, module or exact native ID"
                  />
                </label>
                <label>
                  Show items
                  <select
                    aria-label="Show items"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  >
                    <option value="exceptions">
                      Evidence and review exceptions
                    </option>
                    <option value="all">All items</option>
                    <option value="ambiguous">Ambiguous identity</option>
                    <option value="capture">
                      Text / question gaps or unknowns
                    </option>
                    <option value="blocked">Owner blocked</option>
                    <option value="changed">Changed or stale evidence</option>
                  </select>
                </label>
              </div>
              {!items.length && !loading && (
                <p className="empty-state">
                  {course
                    ? "No retained item inventory is available yet. Add course evidence to build the worklist."
                    : "Choose or create a course to begin."}
                </p>
              )}
              {!!items.length && (
                <p className="hint">
                  {visible.length} of {items.length} items shown. Empty and
                  unverified are different states; neither adds missing content.
                  Items without a native ID remain in the original evidence
                  review and do not receive a guessed durable identity.
                </p>
              )}
              {!!items.length && !visible.length && (
                <p className="empty-state">
                  No items match this filter. Choose All items to inspect the
                  retained inventory.
                </p>
              )}
              <ul className="assignment-item-list">
                {visible.map((value) => {
                  const current = states.get(value.key)!;
                  return (
                    <li key={value.key}>
                      <button
                        className="assignment-item"
                        aria-expanded={selected === value.key}
                        onClick={() => openItem(value)}
                      >
                        <span className="assignment-item-title">
                          <strong>{value.name || value.nativeId}</strong>
                          <small>
                            {value.path || "Module not recorded"} ·{" "}
                            {value.platform} · {value.nativeId}
                          </small>
                        </span>
                        <span className="assignment-item-state">
                          <span>
                            Text / questions: {label(value.captureCoverage)}
                          </span>
                          <span>Fidelity: {label(value.fidelity)}</span>
                          <span>Identity: {label(value.identityStatus)}</span>
                          <span>
                            Work: {label(current.stage)} /{" "}
                            {label(current.decision)}
                          </span>
                          {current.freshness !== "current" && (
                            <span className="assignment-warning">
                              Evidence: {label(current.freshness)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
            {item && state && (
              <section
                className="card assignment-item-detail"
                ref={drawer}
                tabIndex={-1}
                aria-label={`Item history: ${item.name}`}
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">ITEM RECORD</p>
                    <h2>{item.name}</h2>
                    <p>
                      {item.platform} · {item.nativeId} · {item.path}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelected("");
                      setNote("");
                    }}
                  >
                    Close item
                  </button>
                </div>
                <p className="scope">
                  Recording work does not certify a capture or change an audit.
                  Changed evidence requires fresh verification before handoff.
                </p>
                {courseraItemUrl && (
                  <p>
                    <a
                      className="secondary"
                      href={courseraItemUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open this item in Coursera
                    </a>
                  </p>
                )}
                <p className="hint">
                  Text / question coverage: {label(item.captureCoverage)}.
                  Original media, external widget content and whole-item
                  completion require their separate capture evidence. A complete
                  text projection does not establish a complete video or widget.
                </p>
                {(!audit || item.identityStatus !== "exact") && (
                  <p className="scope">
                    {!audit
                      ? "Save a comparison before recording item work."
                      : "This native identity is ambiguous. Resolve it in the source evidence before recording item work."}
                  </p>
                )}
                {item.task?.actions.length ? (
                  <div>
                    <h3>Evidence-based actions</h3>
                    <ul>
                      {item.task.actions.map((action, i) => (
                        <li key={i}>
                          {String(
                            action.action ||
                              action.verdict ||
                              "Review the retained finding",
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p>No automated correction is established for this item.</p>
                )}
                {audit && (
                  <button
                    className="secondary"
                    disabled={!!disabled}
                    onClick={() => onAudit(audit)}
                  >
                    Inspect original content and findings
                  </button>
                )}
                <div className="assignment-edit-grid">
                  <label>
                    Work stage
                    <select
                      aria-label="Work stage"
                      disabled={itemReadonly}
                      value={stage}
                      onChange={(event) =>
                        setStage(event.target.value as typeof stage)
                      }
                    >
                      {stages.map((value) => (
                        <option key={value} value={value}>
                          {{
                            inventory: "Source inspection",
                            reconciliation: "Corrections and reconciliation",
                            transformation: "Content map / outline work",
                            verification: "Fresh evidence verification",
                            delivery: "Handoff",
                          }[value] || label(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Owner decision
                    <select
                      aria-label="Owner decision"
                      disabled={itemReadonly}
                      value={decision}
                      onChange={(event) =>
                        setDecision(event.target.value as typeof decision)
                      }
                    >
                      {decisions.map((value) => (
                        <option key={value} value={value}>
                          {{
                            open: "Needs review",
                            "in-progress": "Working on it",
                            changed: "Changed in LMS — needs fresh capture",
                            checked: "Checked against the evidence",
                            blocked: "Blocked",
                            excluded: "Excluded from scope",
                          }[value] || label(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="assignment-note">
                    Reason / evidence reference
                    <textarea
                      disabled={itemReadonly}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      maxLength={4000}
                      placeholder="What did you observe, decide or change?"
                    />
                  </label>
                </div>
                {decision === "changed" && (
                  <p className="hint">
                    After recording this change, capture the edited LMS item or
                    course again and save a new comparison. Earlier checkmarks
                    stay in history and do not verify the edited content.
                  </p>
                )}
                <div className="context-actions">
                  <button
                    className="secondary"
                    disabled={itemReadonly || !note.trim()}
                    onClick={() => void save("stage")}
                  >
                    Record stage
                  </button>
                  <button
                    className="primary"
                    disabled={itemReadonly || !note.trim()}
                    onClick={() => void save("decision")}
                  >
                    Record decision
                  </button>
                  <button
                    className="secondary"
                    disabled={itemReadonly || !note.trim()}
                    onClick={() => void save("transformation")}
                  >
                    Record transformation note
                  </button>
                </div>
                <details>
                  <summary>
                    Record an explicit source / destination relationship
                  </summary>
                  <p>
                    Use native item IDs from the evidence. Reused media and
                    repeated titles do not establish a mapping.
                  </p>
                  <div className="assignment-edit-grid">
                    <label>
                      Source IDs (comma-separated)
                      <input
                        disabled={itemReadonly}
                        value={sourceIds}
                        onChange={(event) => setSourceIds(event.target.value)}
                      />
                    </label>
                    <label>
                      Destination IDs (comma-separated)
                      <input
                        disabled={itemReadonly}
                        value={destinationIds}
                        onChange={(event) =>
                          setDestinationIds(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Relationship
                      <select
                        aria-label="Relationship"
                        disabled={itemReadonly}
                        value={relation}
                        onChange={(event) =>
                          setRelation(event.target.value as typeof relation)
                        }
                      >
                        {[
                          "one-to-one",
                          "one-to-many",
                          "many-to-one",
                          "reuse",
                        ].map((value) => (
                          <option key={value} value={value}>
                            {label(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="context-actions">
                    <button
                      className="secondary"
                      disabled={itemReadonly || !note.trim()}
                      onClick={() => void save("mapping-confirmed")}
                    >
                      Confirm relationship
                    </button>
                    <button
                      className="secondary"
                      disabled={itemReadonly || !note.trim()}
                      onClick={() => void save("mapping-rejected")}
                    >
                      Reject relationship
                    </button>
                  </div>
                </details>
                <h3>Historical record</h3>
                {!state.history.length ? (
                  <p>No owner events recorded for this item.</p>
                ) : (
                  <ol className="assignment-timeline">
                    {state.history
                      .slice()
                      .reverse()
                      .map((event, index) => (
                        <li key={String(event.eventId || index)}>
                          <strong>
                            {label(String(event.kind || "Observation"))}
                            {event.stage
                              ? `: ${label(String(event.stage))}`
                              : ""}
                            {event.decision
                              ? `: ${label(String(event.decision))}`
                              : ""}
                          </strong>
                          <p>{String(event.note || "")}</p>
                          <small>
                            {when(
                              String(
                                event.recordedAt || event.observedAt || "",
                              ),
                            )}{" "}
                            · {String(event.actor || "Owner not recorded")}
                          </small>
                        </li>
                      ))}
                  </ol>
                )}
                <EvidenceDetails
                  title="Identity, evidence basis and deliverable membership"
                  value={{
                    identity: item.id,
                    basis: item.basis,
                    textQuestionCoverage: item.captureCoverage,
                    fidelity: item.fidelity,
                    assets: item.assets,
                    memberships: state.memberships,
                    mappings: state.mappings,
                  }}
                />
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}
