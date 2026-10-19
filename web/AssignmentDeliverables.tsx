import { useEffect, useMemo, useRef, useState } from "react";
import {
  assignmentDeliverableCsv,
  assignmentDeliverableMarkdown,
  assignmentDeliverableRecordId,
  assignmentDeliverableEvidenceHash,
  DELIVERABLE_KINDS,
  DELIVERABLE_LABELS,
  deliverableArtifactHash,
  deliverableIsStale,
  deliverableRecords,
  generateAssignmentDeliverable,
  importAssignmentDeliverable,
  makeAssignmentDeliverableData,
  rebaseAssignmentDeliverable,
  validateAssignmentDeliverableData,
  type AssignmentDeliverableArtifact,
  type AssignmentDeliverableData,
  type DeliverableEvent,
  type DeliverableKind,
  type DeliverableMember,
} from "../src/domain/assignment-deliverables";
import { loadAssignmentEvidence } from "../src/domain/assignment-plan";
import { prepareAssignmentAgentHandoff } from "../src/domain/assignment-agent-handoff";
import type { WorkspaceRecord } from "../src/domain/workspace-types";
import type { WorkspaceStore } from "../src/domain/workspace-store";
import { download } from "./workspace-ui";

export interface AssignmentDeliverablesProps {
  course: WorkspaceRecord | null;
  audit: WorkspaceRecord | null;
  records: WorkspaceRecord[];
  store: WorkspaceStore | null;
  onSaved: (record: WorkspaceRecord) => Promise<void> | void;
  disabled?: boolean;
}
const PAGE_SIZE = 25;
function MemberMappingEditor({
  member,
  members,
  disabled,
  onChange,
}: {
  member: DeliverableMember;
  members: DeliverableMember[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const eligible = members.filter(
    (other) =>
      (other.platform === "coursera") !== (member.platform === "coursera") &&
      !member.proposed.mappedMemberIds.includes(other.memberId) &&
      `${other.nativeId} ${other.title} ${other.path}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <details>
      <summary>
        Proposed {member.platform === "coursera" ? "source" : "destination"}{" "}
        mappings ({member.proposed.mappedMemberIds.length})
      </summary>
      <label>
        Find a retained member{" "}
        <input
          value={search}
          maxLength={200}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <label>
        Add exact member{" "}
        <select
          value=""
          disabled={disabled || member.proposed.mappedMemberIds.length >= 100}
          onChange={(event) => {
            if (event.target.value)
              onChange([
                ...member.proposed.mappedMemberIds,
                event.target.value,
              ]);
          }}
        >
          <option value="">
            Choose a member by its native ID and placement
          </option>
          {eligible.slice(0, 40).map((other) => (
            <option key={other.memberId} value={other.memberId}>
              {other.platform} · {other.nativeId} · {other.title} · {other.path}
            </option>
          ))}
        </select>
      </label>
      {eligible.length > 40 && (
        <p>
          Showing 40 matches. Refine the search to find the exact placement.
        </p>
      )}
      {member.proposed.mappedMemberIds.map((id) => {
        const mapped = members.find((other) => other.memberId === id);
        return (
          <p key={id}>
            {mapped?.platform} · {mapped?.nativeId} · {mapped?.title}{" "}
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange(
                  member.proposed.mappedMemberIds.filter(
                    (value) => value !== id,
                  ),
                )
              }
            >
              Remove mapping
            </button>
          </p>
        );
      })}
    </details>
  );
}
export function AssignmentDeliverables({
  course,
  audit,
  records,
  store,
  onSaved,
  disabled = false,
}: AssignmentDeliverablesProps) {
  const [kind, setKind] = useState<DeliverableKind>("content-map");
  const [loaded, setLoaded] = useState<{
    audit: WorkspaceRecord | null;
    history: WorkspaceRecord[];
    loading: boolean;
    error: string;
  }>({ audit: null, history: [], loading: false, error: "" });
  const [draft, setDraft] = useState<AssignmentDeliverableArtifact | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [selectedHistory, setSelectedHistory] = useState("");
  const agentPreparation = useRef<AbortController | null>(null);
  const agentSelection = useRef<{
    course: WorkspaceRecord | null;
    audit: WorkspaceRecord | null;
    artifact: AssignmentDeliverableArtifact | null;
    store: WorkspaceStore | null;
    kind: DeliverableKind;
    selectedHistory: string;
  } | null>(null);

  useEffect(() => {
    setDraft(null);
    setNote("");
    setSelectedHistory("");
    setPage(0);
  }, [course?.id]);

  useEffect(() => {
    let active = true;
    setPage(0);
    setMessage("");
    setError("");
    if (!course || !audit || !store) {
      setLoaded({ audit: null, history: [], loading: false, error: "" });
      return;
    }
    setLoaded({ audit: null, history: [], loading: true, error: "" });
    void (async () => {
      const [fullAudit, history] = await Promise.all([
        loadAssignmentEvidence(audit.id, store, records),
        Promise.all(
          deliverableRecords(records, course.id).map((record) =>
            store.get(record.id),
          ),
        ),
      ]);
      for (const record of history)
        validateAssignmentDeliverableData(record.data);
      if (active)
        setLoaded({ audit: fullAudit, history, loading: false, error: "" });
    })().catch((reason) => {
      if (active)
        setLoaded({
          audit: null,
          history: [],
          loading: false,
          error: String(reason instanceof Error ? reason.message : reason),
        });
    });
    return () => {
      active = false;
    };
  }, [course?.id, course?.version, audit?.id, audit?.version, records, store]);

  const basis = useMemo(() => {
    if (!course || !loaded.audit) return { artifact: null, error: "" };
    try {
      return {
        artifact: generateAssignmentDeliverable(
          course,
          loaded.audit,
          records,
          kind,
        ),
        error: "",
      };
    } catch (reason) {
      return {
        artifact: null,
        error: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }, [course, loaded.audit, records, kind]);
  const history = deliverableRecords(loaded.history, course?.id || "", kind);
  const latest = history.at(-1);
  const selected = history.find((record) => record.id === selectedHistory);
  const artifact =
    draft ||
    (selected?.data.artifact as AssignmentDeliverableArtifact | undefined) ||
    (latest?.data.artifact as AssignmentDeliverableArtifact | undefined) ||
    basis.artifact;
  const artifactCurrent =
    !!artifact &&
    !!basis.artifact &&
    assignmentDeliverableEvidenceHash(artifact) ===
      assignmentDeliverableEvidenceHash(basis.artifact);
  const latestStale =
    !!latest &&
    !!basis.artifact &&
    deliverableIsStale(
      latest.data as AssignmentDeliverableData,
      basis.artifact,
    );
  const savedExact =
    !draft &&
    !!artifact &&
    !!latest &&
    latest.data.artifactSha256 === deliverableArtifactHash(artifact) &&
    !selectedHistory;
  const readonly =
    disabled || !store || store.role === "viewer" || busy || loaded.loading;
  const currentAgentSelection = useMemo(
    () => ({
      course,
      audit: loaded.audit,
      artifact,
      store,
      kind,
      selectedHistory,
    }),
    [course, loaded.audit, artifact, store, kind, selectedHistory],
  );
  // A render changes this reference before passive cleanup runs, closing the
  // selection-switch race even if a pending store read resolves immediately.
  agentSelection.current = currentAgentSelection;
  useEffect(() => {
    if (agentPreparation.current) {
      agentPreparation.current.abort();
      agentPreparation.current = null;
      setBusy(false);
    }
    return () => agentPreparation.current?.abort();
  }, [currentAgentSelection]);

  function chooseKind(value: DeliverableKind) {
    setKind(value);
    setDraft(null);
    setPage(0);
    setSelectedHistory("");
    setMessage("");
    setError("");
    setNote("");
  }
  function editMember(
    memberId: string,
    field: "title" | "path" | "action" | "note",
    value: string,
  ) {
    if (!artifact || !artifactCurrent || readonly || selectedHistory) return;
    setDraft({
      ...artifact,
      members: artifact.members.map((member) =>
        member.memberId === memberId
          ? { ...member, proposed: { ...member.proposed, [field]: value } }
          : member,
      ),
    });
  }
  function mapMember(memberId: string, ids: string[]) {
    if (!artifact || !artifactCurrent || readonly || selectedHistory) return;
    setDraft({
      ...artifact,
      members: artifact.members.map((member) =>
        member.memberId === memberId
          ? {
              ...member,
              proposed: { ...member.proposed, mappedMemberIds: ids },
            }
          : member,
      ),
    });
  }
  function moveMember(memberId: string, offset: -1 | 1) {
    if (!artifact || !artifactCurrent || readonly || selectedHistory) return;
    const members = [...artifact.members],
      from = members.findIndex((member) => member.memberId === memberId),
      to = from + offset;
    if (from < 0 || to < 0 || to >= members.length) return;
    [members[from], members[to]] = [members[to], members[from]];
    setDraft({ ...artifact, members });
    setPage(Math.floor(to / PAGE_SIZE));
  }
  async function importRevision(file: File) {
    setError("");
    setMessage("");
    try {
      if (!basis.artifact)
        throw Error("Load a current source-linked comparison first.");
      if (file.size > 12 * 1024 * 1024)
        throw Error(
          "The JSON input exceeds its 12 MiB file limit; its validated artifact must fit 8 MiB.",
        );
      const revised = importAssignmentDeliverable(
        JSON.parse(await file.text()),
        basis.artifact,
      );
      setDraft(revised);
      setSelectedHistory("");
      setPage(0);
      setMessage(
        "Revised structure validated against exact member IDs and original evidence. Save the revision before recording a decision.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function save(event: DeliverableEvent) {
    if (!store || !course || !loaded.audit || !artifact || readonly) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const [currentCourse, currentAudit, allRecords] = await Promise.all([
        store.get(course.id),
        store.get(loaded.audit.id),
        store.list(),
      ]);
      if (
        currentCourse.version !== course.version ||
        currentAudit.version !== loaded.audit.version
      )
        throw Error(
          "The source or report changed. Refresh this assignment before saving.",
        );
      const freshAudit = await loadAssignmentEvidence(
        currentAudit.id,
        store,
        allRecords,
      );
      const freshBasis = generateAssignmentDeliverable(
        currentCourse,
        freshAudit,
        allRecords,
        kind,
      );
      const validated = importAssignmentDeliverable(artifact, freshBasis);
      const fullHistory = await Promise.all(
        deliverableRecords(allRecords, course.id, kind).map((record) =>
          store.get(record.id),
        ),
      );
      const data = makeAssignmentDeliverableData(
        validated,
        fullHistory,
        event,
        note,
        store.email || "This browser",
      );
      const record = await store.save({
        id: assignmentDeliverableRecordId(data.deliverableId, data.revision),
        kind: "operations",
        title: `${DELIVERABLE_LABELS[kind]} · revision ${data.revision} · ${event}`,
        packageId: course.id,
        version: 0,
        updatedAt: "",
        updatedBy: "",
        data,
      });
      setDraft(null);
      setNote("");
      setSelectedHistory("");
      setLoaded((previous) => ({
        ...previous,
        history: [...previous.history, record],
      }));
      await onSaved(record);
      setMessage(
        event === "external-application-recorded"
          ? "External application recorded. Recapture and compare the changed LMS; this record does not verify it."
          : `${DELIVERABLE_LABELS[kind]} revision ${data.revision} saved. Earlier revisions remain in history.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function downloadAgentPacket() {
    if (
      !course ||
      !loaded.audit ||
      !artifact ||
      !store ||
      !artifactCurrent ||
      selectedHistory ||
      busy ||
      agentPreparation.current
    )
      return;
    const controller = new AbortController(),
      selection = agentSelection.current;
    agentPreparation.current = controller;
    const current = () =>
      !controller.signal.aborted &&
      agentPreparation.current === controller &&
      agentSelection.current === selection;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const prepared = await prepareAssignmentAgentHandoff(
        course,
        loaded.audit,
        artifact,
        store,
        controller.signal,
      );
      if (!current()) return;
      download(
        `CTI-${kind}-agent-evidence.json`,
        prepared.json,
        "application/json",
      );
      setMessage(
        "Agent evidence packet prepared with the structural artifact, full owner/content evidence, scope provenance and explicit gaps. Attach this file to the agent; ask it to return only structuralArtifact with proposed fields changed. Original binary archives remain separate when byte review is needed.",
      );
    } catch (reason) {
      if (current())
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current()) setBusy(false);
      if (agentPreparation.current === controller)
        agentPreparation.current = null;
    }
  }

  if (!course)
    return (
      <section aria-label="Assignment deliverables">
        <h3>Source-linked deliverables</h3>
        <p>
          Select an assignment to prepare its content map, outlines, or
          transformation plan.
        </p>
      </section>
    );
  return (
    <section aria-label="Assignment deliverables" className="panel">
      <h3>Source-linked deliverables</h3>
      <p>
        Draft the structure from retained inventory and content. Original
        evidence stays separate from proposed changes. Drafts add no lesson
        content, answers, or learning outcomes.
      </p>
      <label>
        Deliverable{" "}
        <select
          value={kind}
          onChange={(event) =>
            chooseKind(event.target.value as DeliverableKind)
          }
          disabled={busy}
        >
          {DELIVERABLE_KINDS.map((value) => (
            <option key={value} value={value}>
              {DELIVERABLE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Each native item keeps its own identity, including repeated titles and
        shared recordings. The artifact covers identified inventory; items
        without native IDs remain audit exceptions.
      </p>
      {!audit && (
        <p>Save a source-to-destination comparison to generate a draft.</p>
      )}
      {loaded.loading && (
        <p role="status">Loading retained evidence and deliverable history…</p>
      )}
      {(loaded.error || basis.error || error) && (
        <p role="alert">{error || loaded.error || basis.error}</p>
      )}
      {message && <p role="status">{message}</p>}
      {!!history.length && (
        <label>
          Revision history{" "}
          <select
            value={selectedHistory}
            onChange={(event) => {
              setSelectedHistory(event.target.value);
              setDraft(null);
              setPage(0);
              setError("");
            }}
          >
            <option value="">Latest revision</option>
            {[...history].reverse().map((record) => (
              <option key={record.id} value={record.id}>
                Revision {record.data.revision} · {record.data.event} ·{" "}
                {record.data.createdAt}
                {basis.artifact &&
                deliverableIsStale(
                  record.data as AssignmentDeliverableData,
                  basis.artifact,
                )
                  ? " · stale evidence"
                  : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {(latestStale || selectedHistory) && (
        <p>
          {selectedHistory
            ? "Historical revision: read only. "
            : "The latest deliverable uses earlier evidence. "}
          Generate a current draft to review changes. Earlier approvals remain
          historical.
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={readonly || !basis.artifact}
          onClick={() => {
            setDraft(structuredClone(basis.artifact));
            setSelectedHistory("");
            setPage(0);
            setError("");
            setMessage(
              "Current structural draft prepared; review and save it. It is not approved or verified.",
            );
          }}
        >
          Generate current draft
        </button>
        <label>
          Import revised JSON{" "}
          <input
            aria-label="Import revised deliverable JSON"
            type="file"
            accept=".json,application/json"
            disabled={readonly || !basis.artifact}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void importRevision(file);
            }}
          />
        </label>
        {artifact && basis.artifact && !artifactCurrent && (
          <button
            type="button"
            disabled={readonly}
            onClick={() => {
              try {
                const rebased = rebaseAssignmentDeliverable(
                  artifact,
                  basis.artifact!,
                );
                setDraft(rebased.artifact);
                setSelectedHistory("");
                setPage(0);
                setNote("");
                setError("");
                setMessage(
                  `Proposals carried by exact member IDs into current evidence: ${rebased.changedMemberIds.length} changed, ${rebased.addedMemberIds.length} added, ${rebased.retiredMemberIds.length} retired, ${rebased.removedMappingIds.length} unavailable mapping targets. Retired members remain in earlier revisions. Review and save this new draft; earlier approvals do not transfer.`,
                );
              } catch (reason) {
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                );
              }
            }}
          >
            Carry proposals into current evidence
          </button>
        )}
      </div>
      {artifact && (
        <>
          <p>
            <strong>
              {draft
                ? "Unsaved draft"
                : selected
                  ? `Historical ${selected.data.event}`
                  : latest
                    ? `Recorded ${latest.data.event}`
                    : "Generated draft"}
            </strong>{" "}
            · {artifact.members.length} identified members ·{" "}
            {
              artifact.members.filter(
                (member) => member.captureCoverage !== "complete",
              ).length
            }{" "}
            with empty, partial, or unverified capture evidence. Approval
            reviews the structure; it does not certify extraction completeness.
          </p>
          <p className="hint">
            Audit {artifact.auditId} v{artifact.auditVersion} · basis{" "}
            {artifact.basisHash.slice(0, 16)}… · original text remains available
            in JSON and Markdown exports.
          </p>
          <p>
            <strong>Source inventory: {artifact.sourceInventoryKind}</strong> ·{" "}
            {artifact.sourceScope}
          </p>
          {artifact.sourceInventoryKind === "document" && (
            <p>
              Source members are literal document sections. Their identities
              describe this supplied document, not confirmed LMS item boundaries
              or a complete course inventory.
            </p>
          )}
          {kind === "specialization-outline" && (
            <p>
              Use proposed placements to group retained members into
              owner-defined courses. CTI does not invent additional courses or
              outcomes.
            </p>
          )}
          {kind === "transformation-plan" && (
            <p>
              Choose exact source/destination members to propose splits, merges,
              or reuse. These mappings are proposals; the original comparison
              remains unchanged.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              disabled={
                busy ||
                loaded.loading ||
                !store ||
                !artifactCurrent ||
                !!selectedHistory
              }
              onClick={() => void downloadAgentPacket()}
            >
              Download agent evidence packet
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  `CTI-${kind}.json`,
                  JSON.stringify(artifact, null, 2),
                  "application/json",
                )
              }
            >
              Download structured JSON
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  `CTI-${kind}.md`,
                  assignmentDeliverableMarkdown(
                    artifact,
                    draft || !latest
                      ? "Draft; not approved or verified"
                      : `Recorded decision: ${(selected || latest).data.event}. This is not LMS verification.`,
                  ),
                  "text/markdown",
                )
              }
            >
              Download Markdown
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  `CTI-${kind}.csv`,
                  assignmentDeliverableCsv(artifact),
                  "text/csv",
                )
              }
            >
              Download mapping CSV
            </button>
          </div>
          <p className="hint">
            The agent packet includes this protected structural JSON and the
            full retained owner/content evidence, including separate draft and
            provider observations. Automatic archive/instructor defaults are
            labelled separately from owner scope decisions. Binary originals are
            not embedded. The agent returns only the inner structuralArtifact
            through the existing proposed-only revision import.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <caption>
                Original inventory and proposed structure · items{" "}
                {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, artifact.members.length)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Retained item</th>
                  <th scope="col">Proposed title and placement</th>
                  <th scope="col">Action and owner note</th>
                </tr>
              </thead>
              <tbody>
                {artifact.members
                  .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                  .map((member) => (
                    <tr key={member.memberId}>
                      <td>
                        <strong>{member.title}</strong>
                        <p>
                          {member.path} · {member.platform} · {member.nativeId}
                        </p>
                        <small>
                          Identity {member.identityStatus}; capture{" "}
                          {member.captureCoverage}; fidelity {member.fidelity}
                        </small>
                        <details>
                          <summary>Retained text evidence</summary>
                          <p>
                            {member.contentBasis} · {member.textCoverage}
                          </p>
                          <pre
                            style={{
                              whiteSpace: "pre-wrap",
                              maxHeight: "16rem",
                              overflow: "auto",
                            }}
                          >
                            {member.retainedText === null
                              ? "No text body retained. This does not establish an empty source."
                              : member.retainedText === ""
                                ? "Retained text is empty; consult the coverage label."
                                : member.retainedText}
                          </pre>
                        </details>
                      </td>
                      <td>
                        <label>
                          Proposed title{" "}
                          <input
                            value={member.proposed.title}
                            maxLength={8000}
                            disabled={
                              readonly || !artifactCurrent || !!selectedHistory
                            }
                            onChange={(event) =>
                              editMember(
                                member.memberId,
                                "title",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label>
                          Proposed placement{" "}
                          <input
                            value={member.proposed.path}
                            maxLength={8000}
                            disabled={
                              readonly || !artifactCurrent || !!selectedHistory
                            }
                            onChange={(event) =>
                              editMember(
                                member.memberId,
                                "path",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <div className="actions">
                          <button
                            type="button"
                            aria-label={"Move " + member.title + " earlier"}
                            disabled={
                              readonly ||
                              !artifactCurrent ||
                              !!selectedHistory ||
                              artifact.members[0].memberId === member.memberId
                            }
                            onClick={() => moveMember(member.memberId, -1)}
                          >
                            Move earlier
                          </button>
                          <button
                            type="button"
                            aria-label={"Move " + member.title + " later"}
                            disabled={
                              readonly ||
                              !artifactCurrent ||
                              !!selectedHistory ||
                              artifact.members.at(-1)?.memberId ===
                                member.memberId
                            }
                            onClick={() => moveMember(member.memberId, 1)}
                          >
                            Move later
                          </button>
                        </div>
                      </td>
                      <td>
                        <label>
                          Action{" "}
                          <select
                            value={member.proposed.action}
                            disabled={
                              readonly || !artifactCurrent || !!selectedHistory
                            }
                            onChange={(event) =>
                              editMember(
                                member.memberId,
                                "action",
                                event.target.value,
                              )
                            }
                          >
                            {["retain", "review", "move", "rename", "omit"].map(
                              (action) => (
                                <option key={action}>{action}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          Owner note{" "}
                          <textarea
                            value={member.proposed.note}
                            maxLength={4000}
                            disabled={
                              readonly || !artifactCurrent || !!selectedHistory
                            }
                            onChange={(event) =>
                              editMember(
                                member.memberId,
                                "note",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        {kind === "transformation-plan" && (
                          <MemberMappingEditor
                            member={member}
                            members={artifact.members}
                            disabled={
                              readonly || !artifactCurrent || !!selectedHistory
                            }
                            onChange={(ids) => mapMember(member.memberId, ids)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {artifact.members.length > PAGE_SIZE && (
            <div className="actions">
              <button
                type="button"
                disabled={!page}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous items
              </button>
              <span>
                Page {page + 1} of{" "}
                {Math.ceil(artifact.members.length / PAGE_SIZE)}
              </span>
              <button
                type="button"
                disabled={(page + 1) * PAGE_SIZE >= artifact.members.length}
                onClick={() => setPage((value) => value + 1)}
              >
                Next items
              </button>
            </div>
          )}
          <label>
            Revision or decision note{" "}
            <textarea
              value={note}
              maxLength={4000}
              disabled={readonly || !!selectedHistory}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Record what you reviewed or changed. Approval, rejection, and external application need at least 20 characters."
            />
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={
                readonly ||
                !artifactCurrent ||
                !!selectedHistory ||
                (savedExact && !draft)
              }
              onClick={() => void save(latest ? "revision" : "draft")}
            >
              Save {latest ? "new revision" : "draft"}
            </button>
            <button
              type="button"
              disabled={
                readonly ||
                !artifactCurrent ||
                !savedExact ||
                !!draft ||
                note.trim().length < 20 ||
                latest?.data.event === "approved" ||
                artifact.members.some(
                  (member) => member.identityStatus !== "exact",
                )
              }
              onClick={() => void save("approved")}
            >
              Record owner approval
            </button>
            <button
              type="button"
              disabled={
                readonly ||
                !artifactCurrent ||
                !savedExact ||
                !!draft ||
                note.trim().length < 20 ||
                latest?.data.event === "rejected"
              }
              onClick={() => void save("rejected")}
            >
              Record rejection
            </button>
            <button
              type="button"
              disabled={
                readonly ||
                !artifactCurrent ||
                !savedExact ||
                !!draft ||
                latest?.data.event !== "approved" ||
                note.trim().length < 20
              }
              onClick={() => void save("external-application-recorded")}
            >
              Record external application
            </button>
          </div>
          <p className="hint">
            CTI does not apply this plan to your LMS. Recording an external
            application requires a fresh capture and comparison before its
            result can be verified.
          </p>
        </>
      )}
    </section>
  );
}

export default AssignmentDeliverables;
