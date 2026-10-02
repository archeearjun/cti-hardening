import { useEffect, useState } from "react";
import {
  safeWebUrl,
  resolveSourceTopic,
  validateOwnerReview,
  type OwnerTask,
  type OwnerProgress,
  type OwnerReview,
} from "../src/domain/owner-actions";
import {
  buildItemCheckScript,
  validateItemCheck,
  type ItemCheckSpec,
} from "../src/domain/item-check";
import {
  digest,
  newRecord,
  type WorkspaceStore,
} from "../src/domain/workspace-store";
import type {
  EvidenceObject,
  WorkspaceRecord,
} from "../src/domain/workspace-types";
import EvidenceDetails from "./EvidenceDetails";
import SourceRepairEvidence from "./SourceRepairEvidence";
import PluginEvidencePanel from "./PluginEvidencePanel";
import { download } from "./workspace-ui";

const progressLabels: Record<OwnerProgress, string> = {
  open: "Not started",
  in_progress: "Working on it",
  changed: "Changed — needs verification",
  checked: "Checked manually — works as intended",
  blocked: "Blocked — need help",
};
export default function OwnerActionCard({
  task,
  label,
  auditId,
  course,
  store,
  saved,
  onSaved,
  context,
  courseLocation,
  onOpenExtraction,
}: {
  task: OwnerTask;
  label: string;
  auditId: string;
  course?: WorkspaceRecord | null;
  store?: WorkspaceStore | null;
  saved?: WorkspaceRecord;
  onSaved?: () => Promise<void>;
  context: EvidenceObject;
  courseLocation: { courseId: string; base: string } | null;
  onOpenExtraction?: (url?: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [loaded, setLoaded] = useState(!saved),
    [record, setRecord] = useState<WorkspaceRecord | null>(null);
  const [status, setStatus] = useState<OwnerProgress>(
      saved?.data.review?.status || "open",
    ),
    [note, setNote] = useState(saved?.data.review?.note || "");
  const [capture, setCapture] = useState<EvidenceObject | undefined>(),
    [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [script, setScript] = useState("");
  const [pluginCaptures, setPluginCaptures] = useState<EvidenceObject[]>([]);
  const editable = !!store && store.role !== "viewer" && !!auditId && !!course;
  useEffect(() => {
    if (!open || !saved || !store) return;
    let alive = true;
    setLoaded(false);
    store
      .get(saved.id)
      .then((r) => {
        if (!alive) return;
        setRecord(r);
        setStatus(r.data.review.status);
        setNote(r.data.review.note);
        setCapture(r.data.review.capture);
        setPluginCaptures(r.data.review.pluginCaptures || []);
        setLoaded(true);
      })
      .catch((e) => {
        if (alive) setError(String(e.message || e));
      });
    return () => {
      alive = false;
    };
  }, [open, saved?.id, saved?.version, store]);
  const spec: ItemCheckSpec | null =
    task.url && auditId && courseLocation && task.id
      ? {
          auditId,
          itemId: task.id,
          courseId: courseLocation.courseId,
          url: task.url,
          name: task.name,
          checks: task.checks,
        }
      : null;
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function copyCheck() {
    if (!spec) return;
    await act("Preparing this item’s check…", async () => {
      const { getExtractor } = await import("../src/domain/capture-review.ts");
      const text = buildItemCheckScript(getExtractor("coursera"), spec);
      setScript(text);
      try {
        await navigator.clipboard.writeText(text);
        setMessage(
          "Current v6.15.6 item check copied. Open this exact Coursera item in your normal signed-in Chrome tab, run it in DevTools → Console, then import the downloaded JSON here.",
        );
      } catch {
        setMessage(
          "Clipboard unavailable. Download the item-check script or use the manual-copy fallback below.",
        );
      }
    });
  }

  async function persist(
    nextCapture = capture,
    nextStatus = status,
    nextPlugins = pluginCaptures,
  ) {
    if (!editable || !store || !course || !loaded) return;
    const review: OwnerReview = {
      status: nextStatus,
      note,
      updatedAt: new Date().toISOString(),
      updatedBy: store.email,
      ...(nextCapture ? { capture: nextCapture } : {}),
      pluginCaptures: nextPlugins,
    };
    validateOwnerReview(review);
    const id = `item-review-${await digest(new TextEncoder().encode(JSON.stringify([auditId, task.key])))}`;
    const r = record || {
      ...newRecord("item-review", task.name.slice(0, 500), {}, course.id),
      id,
    };
    const next = await store.save({
      ...r,
      data: { auditId, itemKey: task.key, review },
    });
    setRecord(next);
    setCapture(nextCapture);
    setPluginCaptures(nextPlugins);
    setStatus(nextStatus);
    await onSaved?.();
    setMessage("Item work saved. The original report is unchanged.");
  }
  async function importCheck(text: string) {
    if (!spec)
      throw new Error("This item needs a saved report and Coursera link.");
    if (new TextEncoder().encode(text).length > 16 * 1024 * 1024)
      throw new Error(
        "This item check exceeds 16 MiB. Keep the original file; it was not truncated or imported.",
      );
    const value = validateItemCheck(JSON.parse(text), spec);
    // A new capture reopens a previous manual completion for explicit review.
    const nextStatus = status === "checked" ? "in_progress" : status;
    await persist(value, nextStatus);
    setPaste("");
    setMessage(
      "Fresh item evidence saved. Review the observations below; no finding was automatically cleared.",
    );
  }
  const sourceUrl = safeWebUrl(context.sourceCourseUrl);
  const sourceLinks = task.sources
    .map((source) => ({
      name: source.title,
      url: safeWebUrl(resolveSourceTopic(source, context)?.url),
    }))
    .filter(
      (link, i, all) =>
        link.url && all.findIndex((x) => x.url === link.url) === i,
    );
  const actionable = task.actions.filter((a) => a.severity !== "NONE");
  return (
    <details
      className="outline-item action-card"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{task.name}</strong>
          <small>
            {task.type}
            {saved?.data.review?.status && saved.data.review.status !== "open"
              ? ` · ${progressLabels[saved.data.review.status as OwnerProgress]}`
              : ""}
          </small>
        </span>
        <span className={`finding-label finding-${task.status}`}>{label}</span>
        {task.url && (
          <a
            className="button-link item-open"
            href={task.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Open item ↗
          </a>
        )}
      </summary>
      {open && (
        <div className="item-evidence action-body">
          <section className="action-focus">
            <p className="eyebrow">1 · WHAT TO DO</p>
            {task.questionSummary.map((s, i) => (
              <p className="question-location" key={i}>
                {s}
              </p>
            ))}
            {actionable.length ? (
              actionable.map((a, i) => <p key={i}>{a.action}</p>)
            ) : (
              <p>
                {task.actions[0]?.action ||
                  "Compare this item with its intended source and confirm its placement and learner access."}
              </p>
            )}
            <div className="action-links">
              {task.url ? (
                <a
                  className="button-link primary"
                  href={task.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open {task.name} in Coursera ↗
                </a>
              ) : courseLocation ? (
                <a
                  className="button-link primary"
                  href={`${courseLocation.base}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Find its destination in Coursera ↗
                </a>
              ) : (
                <p className="hint">
                  Add the course URL above to open this shell.
                </p>
              )}
              {sourceLinks.map((link) => (
                <a
                  className="button-link secondary"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={link.url}
                >
                  Open source item
                  {sourceLinks.length > 1 ? `: ${link.name}` : ""} ↗
                </a>
              ))}
              {!sourceLinks.length && (
                <p className="hint">
                  An exact source-item link is unavailable. Check the source
                  title and location below.
                </p>
              )}
              {sourceUrl && (
                <a
                  className="button-link secondary"
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open source course ↗
                </a>
              )}
            </div>
          </section>
          <div className="evidence-pair">
            <section>
              <p className="eyebrow">2 · SOURCE TO RESTORE OR COMPARE</p>
              <SourceRepairEvidence
                sources={task.sources}
                context={context}
                packageHash={course?.data.scan?.fileSha256 || ""}
              />
              {!task.sources.length && (
                <p className="hint">
                  The exact source entry is not available in this saved scan.
                  Use the source name and location in the finding; do not copy
                  from a similarly named item.
                </p>
              )}
            </section>
            <section>
              <p className="eyebrow">CAPTURED IN COURSERA</p>
              {task.excerpt ? (
                <blockquote>{task.excerpt}</blockquote>
              ) : (
                <p className="hint">No content excerpt recorded.</p>
              )}
              <p className="hint">
                This is the saved excerpt, not a live preview. Open the item to
                check its current appearance.
              </p>
              {!!task.checks.length && (
                <ul className="expected-checks">
                  {task.checks.map((c, i) => (
                    <li key={i}>
                      <strong>{c.label}</strong>
                      <span>{c.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {spec && (
            <section className="targeted-check">
              <p className="eyebrow">3 · NEED MORE EVIDENCE?</p>
              <h4>Check this item in your signed-in Chrome</h4>
              <p>
                Use the current v6.15.4 targeted check in the exact Coursera item
                above. It collects fresh evidence for this item only and never
                clears a finding automatically.
              </p>
              <div className="action-links">
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => void copyCheck()}
                >
                  Copy this item’s current check
                </button>
                {script && (
                  <button
                    className="secondary"
                    onClick={() =>
                      download(
                        "CTI_check_" + task.id + ".js",
                        script,
                        "text/javascript",
                      )
                    }
                  >
                    Download item-check script
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={!!busy || !onOpenExtraction}
                  onClick={() =>
                    onOpenExtraction?.(
                      courseLocation ? courseLocation.base + "/edit" : task.url,
                    )
                  }
                >
                  Open full-course extraction
                </button>
              </div>
              <p className="hint">
                Keep the Coursera tab open while the check runs. Protected
                cross-origin plugin bodies may remain unverified; CTI records that
                uncertainty instead of manufacturing a pass.
              </p>
              {script && (
                <details>
                  <summary>Manual-copy fallback</summary>
                  <textarea
                    aria-label="Current item-check script"
                    readOnly
                    value={script}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </details>
              )}
              <details>
                <summary>Import the downloaded item-check JSON</summary>
                <label>
                  Item-check JSON
                  <input
                    type="file"
                    aria-label="Upload this item’s check JSON"
                    accept=".json,application/json"
                    disabled={!editable || !loaded || !!busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        void act("Reading item check…", async () => {
                          if (file.size > 16 * 1024 * 1024)
                            throw new Error("Item check exceeds 16 MiB.");
                          await importCheck(await file.text());
                        });
                      e.target.value = "";
                    }}
                  />
                </label>
                <textarea
                  aria-label="Item-check JSON"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="Or paste the downloaded item-check JSON"
                />
                <button
                  className="secondary"
                  disabled={!editable || !loaded || !paste || !!busy}
                  onClick={() =>
                    void act("Reading item check…", () => importCheck(paste))
                  }
                >
                  Add item check
                </button>
              </details>
              {capture && (
                <div className="fresh-check">
                  <h4>
                    Fresh item check ·{" "}
                    {new Date(capture.finishedAt).toLocaleString()}
                  </h4>
                  <p>
                    {capture.evaluation?.editorObserved
                      ? "Item editor observed"
                      : "Editor capture incomplete"}{" "}
                    · {capture.evaluation?.questionCount ?? 0} question records
                    · {capture.evaluation?.assetReferences ?? 0} references
                  </p>
                  {capture.evaluation?.pluginReadiness && (
                    <p className="hint">
                      Plugin checked for{" "}
                      {Math.round(
                        Number(
                          capture.evaluation.pluginReadiness.elapsedMs || 0,
                        ) / 1000,
                      )}{" "}
                      seconds.{" "}
                      {(
                        {
                          FRAME_CONTENT_UNREADABLE:
                            "The embedded page is not readable from this browser context. Open the plugin to confirm its content and operation.",
                          FRAME_STILL_LOADING:
                            "The frame was still loading when the wait limit was reached. This is partial evidence; check this item again after it loads.",
                          TARGET_NOT_OBSERVED:
                            "No plugin target was observed. Inspect this item's configuration.",
                          FRAME_ACCESS_OR_ERROR_PAGE:
                            "The frame displayed an access or error page. Open it and check access.",
                          CONFIGURATION_ONLY:
                            "Configuration was observed. The plugin's operation still needs checking.",
                          READABLE_FRAME_OBSERVED:
                            "The visible frame content was captured. Hidden screens and interactions still need checking.",
                        } as Record<string, string>
                      )[capture.evaluation.pluginReadiness.status] ||
                        "Review the captured plugin evidence."}
                    </p>
                  )}
                  {(capture.evaluation?.findings || []).map(
                    (f: EvidenceObject, i: number) => (
                      <p key={i}>
                        <strong>
                          {f.status === "OBSERVED"
                            ? "Observed"
                            : "Not observed — verify"}
                          : {f.label}
                        </strong>
                        <br />
                        {f.value}
                        <br />
                        <small>{f.meaning}</small>
                      </p>
                    ),
                  )}
                  {!capture.evaluation?.findings?.length && (
                    <p className="hint">
                      This finding needs an owner judgment. The check collected
                      current item evidence without assigning a pass.
                    </p>
                  )}
                  <EvidenceDetails
                    title="Fresh payload, settings and capture diagnostics"
                    value={capture}
                  />
                  <button
                    className="secondary"
                    onClick={() =>
                      download(
                        `CTI_item_check_${task.id}.json`,
                        JSON.stringify(capture, null, 2),
                      )
                    }
                  >
                    Download saved item check
                  </button>
                </div>
              )}
              <PluginEvidencePanel
                spec={spec}
                targets={
                  capture?.editorObserved &&
                  capture.payload?.pluginEvidence?.itemId === spec.itemId
                    ? (capture.payload.pluginEvidence.targets || []).map(
                        (t: EvidenceObject) => t.url,
                      )
                    : task.pluginTargets
                }
                captures={pluginCaptures}
                editable={editable && loaded && !busy}
                onCapture={async (value) => {
                  const next = [
                    ...pluginCaptures.filter(
                      (p) => p.targetUrl !== value.targetUrl,
                    ),
                    value,
                  ].slice(-12);
                  await persist(
                    capture,
                    status === "checked" ? "in_progress" : status,
                    next,
                  );
                }}
              />
            </section>
          )}
          <section className="review-outcome">
            <p className="eyebrow">{spec ? "4" : "3"} · RECORD THE OUTCOME</p>
            <label>
              Item outcome
              <select
                value={status}
                disabled={!editable || !loaded || !!busy}
                onChange={(e) => setStatus(e.target.value as OwnerProgress)}
              >
                {Object.entries(progressLabels).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What did you check or change?
              <textarea
                value={note}
                maxLength={6000}
                disabled={!editable || !loaded || !!busy}
                onChange={(e) => setNote(e.target.value)}
                placeholder="For example: restored the source image in question 6 and confirmed it displays in learner preview."
              />
            </label>
            <button
              className="primary"
              disabled={!editable || !loaded || !!busy}
              onClick={() => void act("Saving item work…", () => persist())}
            >
              Save item outcome
            </button>
            {!editable && (
              <p className="hint">
                An editor can save item work after the report has been saved.
              </p>
            )}
            {status === "changed" && (
              <p className="hint">
                The edit is recorded, but still needs verification. Check the
                changed item, then record the result.
              </p>
            )}
          </section>
          {busy && <p role="status">{busy}</p>}
          {message && (
            <p role="status" className="success-note">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <EvidenceDetails
            title="Original finding details"
            value={task.findings.length ? task.findings : task.actions}
          />
        </div>
      )}
    </details>
  );
}
