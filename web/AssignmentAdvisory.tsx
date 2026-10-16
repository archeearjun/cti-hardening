import { useEffect, useMemo, useRef, useState } from "react";
import {
  ADVISORY_FEATURES,
  ADVISORY_VERSION,
  MAX_ADVISORY_EXAMPLES,
  advisorySuggestion,
  advisoryCandidatesFromAudit,
  advisoryDatasetFingerprint,
  assignmentWorkMetrics,
  createAdvisoryRecordData,
  normalizeAdvisoryDataset,
  validateAdvisoryRecordData,
  mergeAdvisoryDatasets,
  reviewedMappingExample,
  validateAdvisoryAuditExample,
  type AdvisoryCandidate,
  type AdvisoryRecordData,
  type AdvisoryDataset,
} from "../src/domain/advisory-learning.ts";
import type { WorkspaceRecord } from "../src/domain/workspace-types.ts";
import {
  newRecord,
  type WorkspaceStore,
} from "../src/domain/workspace-store.ts";

function downloadJson(value: unknown, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function AssignmentAdvisory({
  course,
  audit,
  records,
  store,
  onSaved,
  disabled = false,
  candidates = [],
}: {
  course: WorkspaceRecord | null;
  audit?: WorkspaceRecord | null;
  records: WorkspaceRecord[];
  store: WorkspaceStore;
  onSaved: (record: WorkspaceRecord) => Promise<void> | void;
  disabled?: boolean;
  candidates?: AdvisoryCandidate[];
}) {
  const [saved, setSaved] = useState<AdvisoryRecordData | null>(null);
  const [draft, setDraft] = useState<AdvisoryRecordData | null>(null);
  const [pooled, setPooled] = useState<AdvisoryDataset>({
    schemaVersion: 1,
    examples: [],
  });
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedCourse = useRef(course?.id);
  selectedCourse.current = course?.id;
  const latest = records
    .filter(
      (record) =>
        record.kind === "operations" &&
        record.packageId === course?.id &&
        record.data.type === "advisory-model",
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
    )[0];
  useEffect(() => {
    let active = true;
    setSaved(null);
    setDraft(null);
    setMessage("");
    if (latest)
      void store
        .get(latest.id)
        .then((record) => {
          const data = validateAdvisoryRecordData(record.data);
          if (active) setSaved(data);
        })
        .catch((error) => {
          if (active) setMessage(String(error));
        });
    return () => {
      active = false;
    };
  }, [course?.id, latest?.id, latest?.version, store]);
  const latestModels = useMemo(() => {
    const byCourse = new Map<string, WorkspaceRecord>();
    for (const record of records
      .filter(
        (row) =>
          row.kind === "operations" && row.data.type === "advisory-model",
      )
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      ))
      if (!byCourse.has(record.packageId))
        byCourse.set(record.packageId, record);
    return [...byCourse.values()].slice(0, 100);
  }, [records]);
  useEffect(() => {
    let active = true;
    setPooled({ schemaVersion: 1, examples: [] });
    setPoolLoading(true);
    setPoolError("");
    // Pool only reviewed feature datasets; fitting every historical model here
    // would repeat expensive work and is unnecessary for a later explicit fit.
    void Promise.all(
      latestModels.map((record) =>
        store.get(record.id).then((full) => {
          if (
            full.kind !== "operations" ||
            full.data.type !== "advisory-model" ||
            full.packageId !== full.data.courseId
          )
            throw Error("Invalid reviewed-dataset identity.");
          const dataset = normalizeAdvisoryDataset(full.data.dataset);
          if (
            advisoryDatasetFingerprint(dataset) !== full.data.datasetFingerprint
          )
            throw Error("Reviewed dataset fingerprint changed.");
          return dataset;
        }),
      ),
    )
      .then((datasets) => {
        if (active) setPooled(mergeAdvisoryDatasets(datasets));
      })
      .catch((error) => {
        if (active)
          setPoolError("Reviewed-dataset loading failed: " + String(error));
      })
      .finally(() => {
        if (active) setPoolLoading(false);
      });
    return () => {
      active = false;
    };
  }, [latestModels, store]);
  const reviewCandidates = useMemo(
    () =>
      course
        ? [...candidates, ...advisoryCandidatesFromAudit(course.id, audit)]
            .filter((candidate) => candidate.courseId === course.id)
            .slice(0, 100)
        : [],
    [course?.id, audit, candidates],
  );
  const metrics = useMemo(
    () => (course ? assignmentWorkMetrics(course.id, records) : null),
    [course?.id, records],
  );
  const active =
    draft?.courseId === course?.id
      ? draft
      : saved?.courseId === course?.id
        ? saved
        : null;
  const reviewed = useMemo(() => {
    try {
      const dataset = mergeAdvisoryDatasets([
        pooled,
        active?.dataset || { schemaVersion: 1, examples: [] },
      ]);
      return {
        dataset,
        fingerprint: advisoryDatasetFingerprint(dataset),
        error: "",
      };
    } catch (error) {
      return { dataset: null, fingerprint: "", error: String(error) };
    }
  }, [pooled, active]);
  if (!course || !metrics)
    return (
      <section className="card">
        <h2>Advisory assistance</h2>
        <p>
          Select an assignment to inspect its recorded work and optional mapping
          model.
        </p>
      </section>
    );
  const model = active?.model;
  const labelsReady = !poolLoading && !poolError && !reviewed.error;
  const modelStale =
    !!model && labelsReady && model.datasetFingerprint !== reviewed.fingerprint;
  const suggestions =
    model && labelsReady
      ? reviewCandidates
          .map((candidate) =>
            advisorySuggestion(model, candidate, reviewed.fingerprint),
          )
          .filter((suggestion) => suggestion.status === "suggestion")
          .sort((a, b) => b.score - a.score)
      : [];
  async function importLabels(file: File) {
    if (!labelsReady || disabled || busy || store.role === "viewer") return;
    const scope = course!.id;
    setMessage("");
    setBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024)
        throw Error("Reviewed-label imports must be at most 2 MiB.");
      const dataset = mergeAdvisoryDatasets([
        reviewed.dataset || pooled,
        normalizeAdvisoryDataset(JSON.parse(await file.text())),
      ]);
      const data = createAdvisoryRecordData(scope, dataset);
      if (selectedCourse.current === scope) {
        setDraft(data);
        setMessage(
          "Reviewed examples validated and evaluated locally. Save this version to retain it.",
        );
      }
    } catch (error) {
      if (selectedCourse.current === scope) setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (
      !draft ||
      disabled ||
      busy ||
      !labelsReady ||
      modelStale ||
      store.role === "viewer"
    )
      return;
    const scope = course!.id;
    setBusy(true);
    setMessage("");
    try {
      const record = await store.save(
        newRecord(
          "operations",
          "Reviewed mapping advisory · " + draft.createdAt,
          draft,
          course!.id,
        ),
      );
      await onSaved(record);
      if (selectedCourse.current === record.packageId) {
        setSaved(draft);
        setDraft(null);
        setMessage(
          "Saved a new immutable advisory version. No mappings or content were changed.",
        );
      }
    } catch (error) {
      if (selectedCourse.current === scope) setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function review(
    candidate: AdvisoryCandidate,
    decision: "approved" | "rejected",
  ) {
    if (busy || disabled || !labelsReady || store.role === "viewer") return;
    const scope = course!.id;
    setBusy(true);
    setMessage("");
    try {
      const row = reviewedMappingExample(
        candidate,
        decision,
        store.email || "local-owner",
        new Date().toISOString(),
      );
      if (row.pairKind !== "owner-supplied")
        validateAdvisoryAuditExample(row, await store.get(row.basis!.auditId));
      const dataset = mergeAdvisoryDatasets([
        pooled,
        active?.dataset || { schemaVersion: 1, examples: [] },
        { schemaVersion: 1, examples: [row] },
      ]);
      const data = createAdvisoryRecordData(course!.id, dataset);
      const record = await store.save(
        newRecord(
          "operations",
          "Owner mapping review · " + data.createdAt,
          data,
          course!.id,
        ),
      );
      await onSaved(record);
      if (selectedCourse.current === record.packageId) {
        setPooled(dataset);
        setSaved(data);
        setDraft(null);
        setMessage(
          "Saved the explicit " +
            decision +
            " mapping label with its evidence basis. Course payloads and audit findings were not changed.",
        );
      }
    } catch (error) {
      if (selectedCourse.current === scope) setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="card assignment-advisory"
      aria-labelledby="assignment-advisory-heading"
    >
      <h2 id="assignment-advisory-heading">Measured advisory assistance</h2>
      <p>
        IFS{" "}
        <strong>
          {String(course.data.scan?.stats?.ifs ?? "not recorded")}
        </strong>{" "}
        (
        {String(
          course.data.scan?.stats?.ifsVersion || "rule version not recorded",
        )}
        ) is the saved fixed-weight structural workload indicator. It is not a
        quality percentage, completion result, learned prediction or measured
        owner time.
      </p>
      <dl className="metric-grid">
        <div>
          <dt>Owner review records</dt>
          <dd>{metrics.ownerReviewRecords}</dd>
        </div>
        <div>
          <dt>Saved comparisons</dt>
          <dd>{metrics.comparisonRecords}</dd>
        </div>
        <div>
          <dt>Evidence intake records</dt>
          <dd>{metrics.evidenceIntakeRecords}</dd>
        </div>
        <div>
          <dt>Lifecycle events</dt>
          <dd>{metrics.lifecycleEvents}</dd>
        </div>
      </dl>
      <p>
        Recorded reviews per saved comparison:{" "}
        {metrics.ownerReviewsPerComparison === null
          ? "not available"
          : metrics.ownerReviewsPerComparison.toFixed(2)}
        . Explicit lifecycle mapping decisions: {metrics.mappingReviewEvents}.
      </p>
      <p className="hint">
        Counts describe retained records, not individual clicks, successful
        extraction or verified completion. Owner minutes and automation savings
        are not measured yet.
      </p>
      <h3>Optional local mapping model</h3>
      <p>
        This trainable model ranks possible source/destination mappings from
        explicit approved and rejected owner reviews. It runs in this browser
        without an external AI service. It never writes course content, applies
        mappings or certifies fidelity.
      </p>
      {reviewCandidates.length > 0 && (
        <div>
          <h3>Review ambiguous candidate pairs</h3>
          <p>
            Approve only when you have checked that the two native IDs represent
            the intended relationship. These buttons save learning labels only;
            they do not attach another item's content or resolve the audit
            automatically.
          </p>
          <table>
            <caption>
              Current audit candidates; labels remain tied to this audit version
            </caption>
            <thead>
              <tr>
                <th>Source</th>
                <th>Candidate destination</th>
                <th>Review label</th>
              </tr>
            </thead>
            <tbody>
              {reviewCandidates.map((candidate) => {
                const prior = reviewed.dataset?.examples.find(
                  (row) =>
                    row.courseId ===
                      (candidate.courseGroupId || candidate.courseId) &&
                    row.pairKind === (candidate.pairKind || "owner-supplied") &&
                    row.sourceId === candidate.sourceId &&
                    row.targetId === candidate.targetId &&
                    row.basis?.inputFingerprint ===
                      candidate.basis?.inputFingerprint,
                );
                return (
                  <tr
                    key={
                      (candidate.pairKind || "owner-supplied") +
                      ":" +
                      candidate.sourceId +
                      ":" +
                      candidate.targetId
                    }
                  >
                    <td>
                      {candidate.sourceTitle || candidate.sourceId}
                      <br />
                      <small>
                        {candidate.sourceId} · {candidate.sourcePath}
                      </small>
                    </td>
                    <td>
                      {candidate.targetTitle || candidate.targetId}
                      <br />
                      <small>
                        {candidate.targetId} · {candidate.targetPath}
                      </small>
                    </td>
                    <td>
                      {prior
                        ? prior.decision + " on this evidence basis"
                        : "Not reviewed"}
                      <div>
                        <button
                          disabled={
                            disabled ||
                            busy ||
                            !labelsReady ||
                            store.role === "viewer"
                          }
                          onClick={() => void review(candidate, "approved")}
                        >
                          Approve mapping label
                        </button>
                        <button
                          disabled={
                            disabled ||
                            busy ||
                            !labelsReady ||
                            store.role === "viewer"
                          }
                          onClick={() => void review(candidate, "rejected")}
                        >
                          Reject mapping label
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {poolLoading && (
        <p role="status">
          Loading the current reviewed labels before offering suggestions…
        </p>
      )}
      {(poolError || reviewed.error) && (
        <p role="alert">{poolError || reviewed.error}</p>
      )}
      <p>
        <strong>
          {modelStale
            ? "Saved model needs reevaluation"
            : model?.status === "available"
              ? "Evaluated model available"
              : "Insufficient reviewed training data"}
        </strong>
        {model?.status === "insufficient-data"
          ? ": " + model.reason
          : !model
            ? ". No reviewed-label dataset has been trained."
            : ""}
      </p>
      {modelStale && (
        <p>
          Owner labels changed since this model was evaluated. Ranking
          suggestions are withheld. Train and evaluate the current reviewed
          mappings to create a new version.
        </p>
      )}
      <p className="hint">
        Scores are uncalibrated ranking scores, not probabilities of a correct
        match. Holdout evaluation groups native courses; repeated exports of the
        same course must use the same course ID. Owner-supplied labels and
        features are recorded provenance, not independently attested source
        observations.
      </p>
      <div className="button-row">
        <button
          type="button"
          disabled={disabled || busy || !labelsReady || store.role === "viewer"}
          onClick={() => {
            try {
              setDraft(createAdvisoryRecordData(course.id, reviewed.dataset));
              setMessage(
                "Trained/evaluated the retained explicit owner labels locally. Save to retain this evaluated version.",
              );
            } catch (error) {
              setMessage(String(error));
            }
          }}
        >
          Train and evaluate reviewed mappings
        </button>
        <label className="secondary">
          Import reviewed labels and evaluate
          <input
            type="file"
            accept=".json,application/json"
            disabled={
              disabled || busy || !labelsReady || store.role === "viewer"
            }
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importLabels(file);
            }}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            downloadJson(
              { schemaVersion: 1, examples: [] },
              "CTI_REVIEWED_MAPPING_LABELS.json",
            )
          }
        >
          Download empty label template
        </button>
        <button
          type="button"
          disabled={
            !draft ||
            disabled ||
            busy ||
            !labelsReady ||
            modelStale ||
            store.role === "viewer"
          }
          onClick={() => void save()}
        >
          Save evaluated advisory version
        </button>
        {active && (
          <button
            type="button"
            onClick={() => downloadJson(active, "CTI_ADVISORY_MODEL.json")}
          >
            Export features and model
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {model?.status === "available" && (
        <div>
          <h3>
            {modelStale
              ? "Historical evaluation on withheld courses"
              : "Evaluation on withheld courses"}
          </h3>
          <p>
            {model.evaluation.trainingExamples} training examples across{" "}
            {model.evaluation.trainingCourses.length} courses;{" "}
            {model.evaluation.heldOutExamples} held-out examples across{" "}
            {model.evaluation.heldOutCourses.length} courses. Held-out labels
            were not used to fit this saved model.
          </p>
          <table>
            <caption>
              Decisions at an uncalibrated score threshold of 0.5
            </caption>
            <thead>
              <tr>
                <th>Accuracy</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>Brier score</th>
                <th>False positive / negative</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{(model.evaluation.accuracy * 100).toFixed(1)}%</td>
                <td>
                  {model.evaluation.precision === null
                    ? "No positive predictions"
                    : (model.evaluation.precision * 100).toFixed(1) + "%"}
                </td>
                <td>{(model.evaluation.recall * 100).toFixed(1)}%</td>
                <td>{model.evaluation.brierScore.toFixed(3)}</td>
                <td>
                  {model.evaluation.falsePositive} /{" "}
                  {model.evaluation.falseNegative}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="hint">
            Small, selected owner datasets may not represent other courses.
            These metrics do not establish content completeness, extraction
            accuracy or deployment readiness.
          </p>
          <details>
            <summary>
              Inspect the learned logistic-regression coefficients
            </summary>
            <p>
              Positive weights raise a candidate's ranking score; negative
              weights lower it. Correlated features and selected review samples
              limit causal interpretation.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {["Intercept", ...ADVISORY_FEATURES].map((name, index) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{model.coefficients[index].toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {suggestions.length > 0 ? (
            <table>
              <caption>
                Candidate suggestions requiring an owner decision
              </caption>
              <thead>
                <tr>
                  <th>Source ID</th>
                  <th>Destination ID</th>
                  <th>Ranking score</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((suggestion) => (
                  <tr key={suggestion.sourceId + ":" + suggestion.targetId}>
                    <td>{suggestion.sourceId}</td>
                    <td>{suggestion.targetId}</td>
                    <td>{suggestion.score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            labelsReady &&
            !modelStale && (
              <p>
                No candidate pairs were supplied for this assignment. Training
                alone does not create or apply a mapping.
              </p>
            )
          )}
        </div>
      )}
      <details>
        <summary>Reviewed-label format and privacy</summary>
        <p>
          Use schemaVersion 1 and an examples array, maximum{" "}
          {MAX_ADVISORY_EXAMPLES}. Each example needs courseId, sourceId,
          targetId, sourceHash and targetHash (SHA-256 or empty), features,
          decision (approved/rejected), reviewerId and reviewedAt (ISO date).
          In-workspace labels also retain pairKind and an audit
          ID/version/fingerprint basis. Use native course identities, including
          across repeated captures. Do not paste content bodies or learner data.
          Imported examples are explicit owner declarations.
        </p>
        <p>
          Feature order: {ADVISORY_FEATURES.join(", ")}. Values range from 0 to
          1. Title/path token overlap is intersection divided by union;
          exact/present features are 0 or 1. Hash features are checked against
          retained hashes. Model version: {ADVISORY_VERSION}. At least 40
          reviewed pairs from four courses are required, including 12 approvals
          and 12 rejections; the course holdout must also contain both
          decisions.
        </p>
        <p>
          The dataset retains feature values, native IDs, source hashes and
          review provenance. Titles, source bodies, questions and original media
          are not retained by this advisory record. Each save creates a new
          historical version. The latest saved dataset per assignment is pooled
          for explicit training, at most 100 assignments and 2,000 unique pairs.
          A new owner label supersedes an older label for the same pair in the
          training projection; old records remain intact.
        </p>
      </details>
    </section>
  );
}
