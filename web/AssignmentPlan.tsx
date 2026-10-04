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
}: {
  course: WorkspaceRecord | null;
  records: WorkspaceRecord[];
  store: WorkspaceStore | null;
  disabled: boolean;
  onSaved: (course: WorkspaceRecord) => Promise<void>;
  onNavigate: (tab: string) => void;
  onAudit: (audit: WorkspaceRecord) => void;
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
      <ol className="assignment-steps">
        <li>
          <h3>Understand the source before import</h3>
          <p>
            Inspect the IMSCC, capture the source LMS, and identify expected
            readings, questions, answer keys, attachments and interactive
            resources. If a shell already exists, audit it before deciding to
            reimport.
          </p>
          <button className="secondary" onClick={() => onNavigate("Explore")}>
            Explore source
          </button>
        </li>
        <li>
          <h3>Capture and compare the imported shell</h3>
          <p>
            Import the IMSCC in Coursera if needed. Capture the shell and export
            its XLSX before manual edits; compare both with the source. Keep
            this baseline.
          </p>
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
          <h3>Reconcile source and Coursera</h3>
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
          <h3>Review reconciliation readiness</h3>
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
          <h3>
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
