import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONTENT_MAP_AGENT,
  SPECIALIZATION_AGENT,
  assignmentHandoff,
  evaluateAssignment,
  latestAssignmentAudit,
  normalizeAssignmentPlan,
  type AssignmentRoute,
} from "../src/domain/assignment-plan";
import type { WorkspaceRecord } from "../src/domain/workspace-types";
import type { WorkspaceStore } from "../src/domain/workspace-store";
import { download } from "./workspace-ui";
import {
  nextAssignmentStep,
  sourceBaseline,
  type PendingAssignmentEvidence,
  type AssignmentAction,
} from "../src/domain/assignment-evidence";
const statusLabel = (value: string) =>
  (
    ({
      CURRENT_VERSION:
        "Captured with the current extractor; review evidence coverage",
      VERSION_UNKNOWN: "Extractor version not recorded",
      SOURCE_ASSESSMENT_EVIDENCE_REVIEW:
        "Source questions or answer keys need verification",
      CAPTURE_INCOMPLETE: "Some content was not captured",
      EDITOR_TRAVERSAL_INCOMPLETE: "Some item editors were not captured",
      PASS: "Recorded checks passed",
      REVIEW: "Evidence needs review",
    }) as Record<string, string>
  )[value] || value.replaceAll("_", " ").toLowerCase();

export default function AssignmentPlanView({
  course,
  records,
  store,
  disabled,
  onSaved,
  onNavigate,
  onAudit,
  pending,
  onRescan,
}: {
  course: WorkspaceRecord | null;
  records: WorkspaceRecord[];
  store: WorkspaceStore | null;
  disabled: boolean;
  onSaved: (course: WorkspaceRecord) => Promise<void>;
  onNavigate: (tab: string) => void;
  onAudit: (audit: WorkspaceRecord) => void;
  pending: PendingAssignmentEvidence;
  onRescan: () => void;
}) {
  const latest = course ? latestAssignmentAudit(course.id, records) : null;
  const [loaded, setLoaded] = useState<{
    audit: WorkspaceRecord | null;
    loading: boolean;
    error: string;
  }>({ audit: null, loading: false, error: "" });
  const [note, setNote] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [mapNote, setMapNote] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setLoaded({ audit: null, loading: !!latest, error: "" });
    if (latest && store)
      void store
        .get(latest.id)
        .then((audit) => {
          if (active) setLoaded({ audit, loading: false, error: "" });
        })
        .catch((e) => {
          if (active)
            setLoaded({ audit: null, loading: false, error: String(e) });
        });
    return () => {
      active = false;
    };
  }, [latest?.id, latest?.version, store]);
  const e = useMemo(
    () => (course ? evaluateAssignment(course, loaded.audit, records) : null),
    [course, loaded.audit, records],
  );
  if (!course || !e)
    return (
      <section className="card">
        <h2>Start your assignment</h2>
        <p>
          Choose a saved course above, or scan the original IMSCC first. Before
          a Coursera shell exists, CTI can inspect source requirements; it
          cannot yet say what Coursera is missing.
        </p>
        <button className="primary" onClick={() => onNavigate("Scan")}>
          Scan source IMSCC
        </button>
      </section>
    );
  const audit = loaded.audit;
  const baseline = sourceBaseline(course.data.scan);
  const next = nextAssignmentStep(course, audit, e, pending);
  function openAction(action: AssignmentAction) {
    if (action === "scan") onRescan();
    else if (action === "source") onNavigate("Source LMS");
    else if (action === "coursera") onNavigate("Extract");
    else if (action === "compare") onNavigate("Compare");
    else if (action === "worklist" && audit) onAudit(audit);
    else {
      const target = document.getElementById(
        action === "review" ? "assignment-review" : "assignment-deliverable",
      );
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    }
  }
  const readonly =
    disabled || saving || loaded.loading || !store || store.role === "viewer";
  async function save(
    action: "route" | "review" | "approval" | "changed" | "reopen" | "withdraw",
    route?: AssignmentRoute,
  ) {
    if (!course || !e || !store || readonly || lock.current) return;
    lock.current = true;
    setSaving(true);
    setMessage("");
    try {
      if ((action === "review" || action === "approval") && pending.changed)
        throw Error(
          "Compare the selected files before recording a review or approval for the new evidence.",
        );
      const currentRecords = await store.list();
      const currentAudit = latestAssignmentAudit(course.id, currentRecords);
      if (
        currentAudit?.id !== audit?.id ||
        currentAudit?.version !== audit?.version
      )
        throw Error(
          "The latest report changed. Reopen Assignment plan before saving.",
        );
      const current = evaluateAssignment(course, audit, currentRecords);
      if (current.basis !== e.basis)
        throw Error(
          "Item reviews changed. Refresh the workspace before recording review.",
        );
      const plan = { ...current.plan };
      const now = new Date().toISOString();
      if (action === "route" && route) plan.route = route;
      if (action === "changed") {
        plan.shellChangedAt = now;
        delete plan.reconciliation;
        delete plan.mapApproval;
      }
      if (action === "reopen") {
        delete plan.reconciliation;
        delete plan.mapApproval;
      }
      if (action === "withdraw") delete plan.mapApproval;
      if (action === "review") {
        if (!current.canRecordReview)
          throw Error("Resolve the listed reconciliation prerequisites first.");
        plan.reconciliation = {
          basis: current.basis,
          note: note.trim(),
          recordedAt: now,
          recordedBy: store.email || "Local workspace owner",
        };
        delete plan.mapApproval;
      }
      if (action === "approval") {
        if (!current.reconciled || current.plan.route !== "SPECIALIZATION")
          throw Error(
            "Record source reconciliation before content map approval.",
          );
        plan.mapApproval = {
          basis: current.basis,
          note: mapNote.trim(),
          url: mapUrl.trim(),
          recordedAt: now,
          recordedBy: store.email || "Local workspace owner",
        };
      }
      const saved = await store.save({
        ...course,
        data: { ...course.data, assignmentPlan: normalizeAssignmentPlan(plan) },
      });
      await onSaved(saved);
      setMessage(
        action === "changed"
          ? "Shell change recorded. Capture the corrected shell and run a new comparison; previous audits are preserved."
          : "Assignment plan saved. Original audit findings remain unchanged.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <section className="card assignment-plan" aria-label="Assignment plan">
      <h2>What do I need to do next?</h2>
      <p>
        Reconcile the imported Coursera content with the source once, then reuse
        that review for your deliverables while the source and shell remain
        unchanged. CTI identifies work; you make and verify course edits in
        Coursera.
      </p>
      {loaded.loading && (
        <p role="status">Loading the latest saved comparison…</p>
      )}
      {loaded.error && (
        <p role="alert">
          Could not load the latest comparison: {loaded.error}. Readiness is
          unverified.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!loaded.loading &&
        !loaded.error &&
        (!latest ||
          (audit?.id === latest.id && audit.version === latest.version)) && (
          <section
            className="assignment-next"
            aria-label="Recommended next action"
          >
            <p className="eyebrow">YOUR NEXT ACTION</p>
            <h3>{next.title}</h3>
            <p>{next.detail}</p>
            <button className="primary" onClick={() => openAction(next.action)}>
              {next.button}
            </button>
          </section>
        )}
      <label>
        Deliverable path
        <select
          aria-label="Deliverable path"
          value={e.plan.route}
          disabled={readonly}
          onChange={(event) =>
            void save("route", event.target.value as AssignmentRoute)
          }
        >
          <option value="UNDECIDED">Choose the required deliverable</option>
          <option value="COURSE">Course outline — direct path</option>
          <option value="SPECIALIZATION">
            Content map → approval → specialization outline
          </option>
        </select>
      </label>
      <p className="hint">
        A course outline and a specialization outline need specific item links.
        A content map precedes the specialization outline; it does not require a
        separate repeat of source reconciliation.
      </p>
      <ol className="assignment-steps">
        <li>
          <h3>Inspect what CTI obtained from the IMSCC</h3>
          <p>
            <strong>{baseline.label}.</strong>{" "}
            {course.data.scan?.fileName || "No package selected"}
            {course.data.scan?.scannedAt
              ? ` · Scan recorded: ${new Date(course.data.scan.scannedAt).toLocaleString()}`
              : ""}
          </p>
          <p>
            Explore the saved structure, text, question evidence and files.
            Opening this view does not rescan the IMSCC or establish that it is
            the latest source export. Coursera import results become available
            after comparison.
          </p>
          {course.data.scan && (
            <p>
              {course.data.scan.moduleCount ?? "Unknown"} modules ·{" "}
              {course.data.scan.stats?.totalItems ?? "Unknown"} source items
              (not question count) · {course.data.scan.warnings?.length ?? 0}{" "}
              scan warnings.
            </p>
          )}
          <button className="secondary" onClick={() => onNavigate("Explore")}>
            Explore source
          </button>
          <button className="secondary" disabled={disabled} onClick={onRescan}>
            Rescan original IMSCC
          </button>
        </li>
        <li>
          <h3>Capture and inspect Brightspace</h3>
          <p>
            <strong>
              {pending.source
                ? `Selected for comparison: ${pending.source}`
                : audit?.data.hashes?.brightspace
                  ? "Source capture included in the latest saved comparison"
                  : "No source capture recorded in the latest comparison"}
              .
            </strong>
          </p>
          <p>
            Capture the matching source course before making manual Coursera
            corrections. Use it to check live readings, questions, attachments
            and interactive content that may be absent from the package. A
            captured wrapper does not establish that its plugin was read.
          </p>
          {audit?.data.result?.liveSourceGroundTruth?.capturedAt && (
            <p>
              Saved source capture date:{" "}
              {String(audit.data.result.liveSourceGroundTruth.capturedAt)} ·{" "}
              {statusLabel(e.sourceStatus)}.
            </p>
          )}
          <button
            className="secondary"
            onClick={() => onNavigate("Source LMS")}
          >
            Capture / inspect Brightspace
          </button>
        </li>
        <li>
          <h3>Capture and compare the imported shell</h3>
          <p>
            <strong>
              {pending.coursera
                ? `Selected Coursera JSON: ${pending.coursera}`
                : audit?.data.hashes?.json
                  ? "Coursera capture included in the latest saved comparison"
                  : "No full Coursera capture recorded in the latest comparison"}
              .
            </strong>
          </p>
          {pending.excel && <p>Selected XLSX: {pending.excel}.</p>}
          <p>
            Import the IMSCC in Coursera if needed. Capture the shell and export
            its XLSX before manual edits; compare both with the source. Keep
            this baseline.
          </p>
          {pending.changed && (
            <p className="scope">
              The selected files have not been saved in a new comparison. Keep
              the downloaded files; a selection alone does not complete this
              step.
            </p>
          )}
          <div className="action-links">
            <button className="secondary" onClick={() => onNavigate("Extract")}>
              Extract Coursera
            </button>
            <button className="secondary" onClick={() => onNavigate("Compare")}>
              Run comparison
            </button>
          </div>
        </li>
        <li>
          <h3>Your correction checklist</h3>
          <p>
            This is where CTI turns the comparison into item-specific work: what
            to restore, correct, locate or verify, with source and Coursera
            evidence where available. Flagged items are not automatically
            confirmed defects.
          </p>
          <p>
            Use the item worklist to decide what to restore, modify, relocate or
            inspect. Confirm the intended source match before deleting or
            recreating anything. An unread plugin is an evidence gap, not proof
            of missing content.
          </p>
          <p>
            <strong>
              {e.checked.length} of {e.attention.length} flagged items have
              documented owner checks.
            </strong>{" "}
            {e.changed.length > 0 &&
              `${e.changed.length} changed item(s) await a new comparison.`}
          </p>
          {audit && (
            <button className="primary" onClick={() => onAudit(audit)}>
              Open latest item worklist
            </button>
          )}
          <p className="hint">
            After making edits, capture the corrected shell and compare again.
            Marking an item “changed” does not prove its repair worked.
          </p>
          <button
            className="secondary"
            disabled={readonly || !audit}
            onClick={() => void save("changed")}
          >
            I changed the shell — require fresh evidence
          </button>
        </li>
        <li>
          <h3 id="assignment-review" tabIndex={-1}>
            Review reconciliation readiness
          </h3>
          <dl className="assignment-evidence">
            <div>
              <dt>Capture assessment</dt>
              <dd>{statusLabel(e.captureStatus)}</dd>
            </div>
            <div>
              <dt>Source LMS evidence</dt>
              <dd>{statusLabel(e.sourceStatus)}</dd>
            </div>
            <div>
              <dt>Original audit</dt>
              <dd>{e.headline}</dd>
            </div>
            <div>
              <dt>Owner review</dt>
              <dd>
                {e.reconciled
                  ? "Recorded for the current evidence"
                  : "Not recorded / needs review"}
              </dd>
            </div>
          </dl>
          {!!e.blockers.length && (
            <ul>
              {e.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {pending.changed && (
            <p className="scope">
              Compare the selected files before recording a new review or
              approval. The readiness shown above refers to the latest saved
              report.
            </p>
          )}
          {e.reconciled ? (
            <div>
              <p className="success-notice">
                Source reconciliation review recorded. This same review supports
                the content map and subsequent outline. It does not replace the
                original audit or certify unseen content.
              </p>
              <p>{e.plan.reconciliation?.note}</p>
              <button
                className="secondary"
                disabled={readonly}
                onClick={() => void save("reopen")}
              >
                Reopen reconciliation review
              </button>
            </div>
          ) : (
            <>
              <label>
                Reconciliation review note
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={4000}
                  placeholder="Describe source matching, learner checks, and any explicitly accepted limitations or exceptions."
                />
              </label>
              <button
                className="primary"
                disabled={
                  readonly ||
                  !!loaded.error ||
                  !e.canRecordReview ||
                  pending.changed ||
                  note.trim().length < 20
                }
                onClick={() => void save("review")}
              >
                Record owner reconciliation review
              </button>
            </>
          )}
          <p className="hint">
            Check learner access, interactive behaviour, media, attachments and
            assessment settings where extraction cannot establish them. A new
            source scan, audit, item review or declared shell edit invalidates
            the prior handoff readiness.
          </p>
        </li>
        <li>
          <h3 id="assignment-deliverable" tabIndex={-1}>
            {e.plan.route === "SPECIALIZATION"
              ? "Create and approve the content map, then build the outline"
              : "Prepare the course outline"}
          </h3>
          {e.plan.route === "UNDECIDED" ? (
            <p>
              Choose a deliverable path above. CTI will not infer it from course
              size.
            </p>
          ) : e.plan.route === "SPECIALIZATION" ? (
            <>
              <p>
                <strong>
                  Content map:{" "}
                  {e.reconciled
                    ? "Owner reconciliation prerequisite recorded"
                    : "Reconciliation required"}
                  .
                </strong>
              </p>
              <a
                href={CONTENT_MAP_AGENT}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open content map agent ↗
              </a>
              <p>
                Opening an agent does not transfer CTI evidence. Download the
                handoff and complete owner report, then attach them yourself.
              </p>
              {e.mapApproved ? (
                <div>
                  <p>
                    Approval recorded:{" "}
                    <a
                      href={e.plan.mapApproval!.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Approved content map ↗
                    </a>
                  </p>
                  <p>{e.plan.mapApproval?.note}</p>
                  <button
                    className="secondary"
                    disabled={readonly}
                    onClick={() => void save("withdraw")}
                  >
                    Withdraw content map approval
                  </button>
                </div>
              ) : (
                <fieldset>
                  <legend>Record an approval already received</legend>
                  <label>
                    Approved content map URL
                    <input
                      type="url"
                      disabled={readonly || !e.reconciled}
                      value={mapUrl}
                      onChange={(event) => setMapUrl(event.target.value)}
                    />
                  </label>
                  <label>
                    Who approved it and what was approved?
                    <input
                      type="text"
                      disabled={readonly || !e.reconciled}
                      value={mapNote}
                      onChange={(event) => setMapNote(event.target.value)}
                      maxLength={4000}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={
                      readonly ||
                      !e.reconciled ||
                      pending.changed ||
                      mapNote.trim().length < 20 ||
                      !mapUrl.trim()
                    }
                    onClick={() => void save("approval")}
                  >
                    Record content map approval
                  </button>
                </fieldset>
              )}
              <p>
                Specialization outline:{" "}
                {e.outlineReady
                  ? "Prerequisites recorded"
                  : "Awaiting reconciliation, map approval, or item links"}
                .
              </p>
              <a
                href={SPECIALIZATION_AGENT}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open specialization outline agent ↗
              </a>
            </>
          ) : (
            <p>
              <strong>
                Course outline:{" "}
                {e.outlineReady
                  ? "Prerequisites recorded"
                  : "Awaiting reconciliation or item links"}
                .
              </strong>{" "}
              Build it directly from the reconciled source and Coursera
              inventory. No content map or specialization outline is required
              for this path.
            </p>
          )}
          {!!e.missingLinks.length && (
            <p>
              {e.missingLinks.length} destination item(s) have no specific item
              URL. Resolve those before building a linked outline; course
              homepage links are insufficient.
            </p>
          )}
          <p className="hint">
            Captured item URLs still need an access check. CTI cannot detect
            edits made outside CTI until you record a shell change or import
            fresh evidence.
          </p>
          <button
            className="secondary"
            disabled={!audit || loaded.loading || !!loaded.error}
            onClick={() =>
              download(
                "CTI-assignment-handoff.txt",
                assignmentHandoff(course, audit, records),
                "text/plain",
              )
            }
          >
            Download assignment handoff
          </button>
        </li>
      </ol>
    </section>
  );
}
