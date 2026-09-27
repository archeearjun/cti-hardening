import OwnerEvidence from "./OwnerEvidence";
import { prepareWorkspaceBackup } from "../src/domain/workspace-validation";
import { useEffect, useRef, useState } from "react";
import PackageWorkspace from "./PackageWorkspace";
import { runWorkflow } from "./workflow-client";
import {
  localStore,
  teamStore,
  newRecord,
  type WorkspaceStore,
} from "../src/domain/workspace-store";
import { importLegacyWorkspace } from "../src/domain/legacy-import";
import { writeWorkbook, type BookData } from "../src/adapters/workbook";
import type {
  EvidenceObject,
  WorkspaceRecord,
  WorkflowJob,
} from "../src/domain/workspace-types";
import type { PackageScan } from "../src/domain/package-types";

const steps = [
  ["sourceRescanned", "Original IMSCC rescanned"],
  ["brightspaceCaptured", "Brightspace JSON saved"],
  ["beforeCourseraCaptured", "BEFORE Coursera JSON saved"],
  ["beforeExcelSaved", "BEFORE XLSX saved"],
  ["beforeQaSaved", "BEFORE QA report saved"],
  ["reingested", "Latest Smart Ingestion completed"],
  [
    "afterCourseraCaptured",
    "AFTER Coursera JSON saved before manual corrections",
  ],
  ["afterExcelSaved", "AFTER XLSX saved"],
  ["afterQaSaved", "AFTER QA report saved"],
  ["evidenceOrganized", "Evidence organised for review"],
];
const statuses = [
  "In Queue",
  "In Progress",
  "QA Review",
  "Blocked",
  "Completed",
];
function download(
  name: string,
  value: string | Uint8Array,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([value as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const json = (value: unknown) => JSON.stringify(value, null, 2);
async function inputFile(file: File | null) {
  return file
    ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
    : undefined;
}
function Evidence({ value }: { value: unknown }) {
  return <pre className="evidence-json">{json(value)}</pre>;
}
function FileField({
  label,
  accept,
  onChange,
  disabled = false,
}: {
  label: string;
  accept: string;
  onChange: (f: File | null) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
}
export default function FullWorkspace() {
  const [store, setStore] = useState<WorkspaceStore | null>(null),
    [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [tab, setTab] = useState("Catalogue"),
    [courseId, setCourseId] = useState(""),
    [course, setCourse] = useState<WorkspaceRecord | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [seconds, setSeconds] = useState(0);
  const [report, setReport] = useState<EvidenceObject | null>(null),
    [analysis, setAnalysis] = useState<EvidenceObject | null>(null),
    [versions, setVersions] = useState<EvidenceObject[]>([]);
  const [excel, setExcel] = useState<File | null>(null),
    [capture, setCapture] = useState<File | null>(null),
    [source, setSource] = useState<File | null>(null),
    [recovery, setRecovery] = useState<File | null>(null);
  const [mode, setMode] = useState<"raw" | "ops" | "published" | "auto">("ops"),
    [generation, setGeneration] = useState(0),
    [before, setBefore] = useState(""),
    [after, setAfter] = useState("");
  const [query, setQuery] = useState(""),
    [partner, setPartner] = useState("NAIT"),
    [owner, setOwner] = useState(""),
    [status, setStatus] = useState("In Queue"),
    [deadline, setDeadline] = useState("");
  const [scan, setScan] = useState<PackageScan | null>(null),
    [rescan, setRescan] = useState(false),
    [checklist, setChecklist] = useState<WorkspaceRecord | null>(null);
  const [bookRecord, setBookRecord] = useState<WorkspaceRecord | null>(null),
    [book, setBook] = useState<BookData | null>(null),
    [master, setMaster] = useState<File | null>(null),
    [masterResult, setMasterResult] = useState<EvidenceObject | null>(null);
  const [anchors, setAnchors] = useState<number[]>([]),
    [specNames, setSpecNames] = useState<Record<number, string>>({}),
    [approved, setApproved] = useState<string[]>([]),
    [triage, setTriage] = useState(false),
    [qaFile, setQaFile] = useState<File | null>(null),
    [stage, setStage] = useState("Metadata"),
    [spec, setSpec] = useState(1),
    [macResult, setMacResult] = useState<EvidenceObject | null>(null);
  const [ingestionCapabilityStatus, setIngestionCapabilityStatus] = useState<
    "UNKNOWN" | "LATEST_APPLIED" | "LEGACY_OR_OUTDATED"
  >("UNKNOWN");
  const [computing, setComputing] = useState(false);
  const [importPlan, setImportPlan] = useState<ReturnType<
    typeof importLegacyWorkspace
  > | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
    const init = async () => {
      try {
        const s =
          localStorage.getItem("cti-workspace-mode") === "team"
            ? await teamStore()
            : localStore();
        const rows = await s.list();
        if (alive) {
          setStore(s);
          setRecords(rows);
        }
      } catch (e) {
        if (alive)
          setError(
            (e instanceof Error ? e.message : String(e)) +
              " Open Setup to reconnect or choose local mode.",
          );
      }
    };
    void init();
    return () => {
      alive = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const start = Date.now();
    const t = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [busy]);
  const editable = !!store && store.role !== "viewer";
  const courses = records.filter((r) => r.kind === "package");
  const audits = records.filter(
    (r) => r.kind === "audit" && r.packageId === courseId,
  );
  async function refresh(s = store) {
    if (s) setRecords(await s.list());
  }
  async function act(label: string, fn: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(label);
    controller.current = new AbortController();
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      controller.current = null;
    }
  }
  const job = async (j: WorkflowJob) => {
    setComputing(true);
    try {
      return await runWorkflow(
        j,
        controller.current?.signal || new AbortController().signal,
      );
    } finally {
      setComputing(false);
    }
  };
  useEffect(
    () => setReport(null),
    [
      excel,
      capture,
      source,
      recovery,
      mode,
      generation,
      ingestionCapabilityStatus,
    ],
  );
  async function selectCourse(id: string) {
    setCourseId(id);
    setReport(null);
    setAnalysis(null);
    setVersions([]);
    setBefore("");
    setAfter("");
    setChecklist(null);
    setCourse(null);
    if (!id || !store) {
      setCourse(null);
      return;
    }
    await act("Loading course", async () => {
      const r = await store.get(id);
      setCourse(r);
      setPartner(r.data.partner || "");
      setOwner(r.data.owner || "");
      setStatus(r.data.status || "In Queue");
      setDeadline(r.data.deadline || "");
      const saved = records.find(
        (x) => x.kind === "checklist" && x.packageId === id,
      );
      setChecklist(
        saved
          ? await store.get(saved.id)
          : newRecord("checklist", r.title, { evidence: {}, notes: "" }, id),
      );
      const prior = records.filter(
        (x) => x.kind === "audit" && x.packageId === id,
      );
      setGeneration(
        Math.max(0, ...prior.map((x) => Number(x.data.generation) || 0)),
      );
    });
  }
  async function saveCourseScan() {
    if (!store || !scan) return;
    await act("Saving source scan", async () => {
      const record =
        rescan && course
          ? { ...course, data: { ...course.data, scan } }
          : newRecord("package", scan.fileName, {
              scan,
              partner,
              owner,
              status: "In Queue",
              assignedDate: "",
              deadline: "",
              driveLink: "",
            });
      const saved = await store.save(record);
      await refresh();
      setCourseId(saved.id);
      setCourse(saved);
      setScan(null);
      setNotice("Source scan saved. Previous saved versions are retained.");
    });
  }
  async function compare() {
    if (!store || !course || !excel) return;
    await act("Comparing full source and Coursera evidence", async () => {
      const history = await Promise.all(audits.map((a) => store.get(a.id)));
      const input = {
        course,
        excel: (await inputFile(excel))!,
        json: await inputFile(capture),
        brightspace: await inputFile(source),
        recovery: await inputFile(recovery),
        mode,
        generation,
        history,
        ingestionCapabilityStatus,
      };
      const output = await job({ kind: "compare", input });
      setReport(output);
      const saved = await store.save(
        newRecord(
          "audit",
          `${course.title} · generation ${generation} · ${mode}`,
          output,
          course.id,
        ),
      );
      await refresh();
      setNotice(`Full report saved (${saved.id}).`);
    });
  }
  async function persistBook(next: BookData) {
    if (!store) return;
    const r = bookRecord
      ? {
          ...bookRecord,
          data: { ...bookRecord.data, book: next, masterResult },
        }
      : newRecord("workbook", next.name, { book: next, masterResult });
    const saved = await store.save(r);
    setBookRecord(saved);
    setBook(next);
    await refresh();
  }
  async function split(confirmed: boolean) {
    if (!book) return;
    await act("Splitting and validating source modules", async () => {
      const out = await job({
        kind: "macmillan-split",
        book,
        anchors: [...anchors].sort((a, b) => a - b),
        names: [...anchors]
          .sort((a, b) => a - b)
          .map((a, i) => specNames[a] || `Specialization ${i + 1}`),
        approved: confirmed ? approved : null,
        partner: "Macmillan",
      });
      setMacResult(out.result);
      if (!out.result.success) throw new Error(out.result.error);
      setTriage(!!out.result.isTriage);
      if (!out.result.isTriage) {
        await persistBook(out.book);
        setNotice("Specializations and evidence context saved.");
      }
    });
  }
  return (
    <section className="full-workspace">
      <div className="card workspace-banner">
        <h2>CTI workspace</h2>
        <p>
          <strong>
            {store?.mode === "team"
              ? `Shared team workspace · ${store.email} · ${store.role}`
              : "Local workspace · saved in this browser only"}
          </strong>
        </p>
        <p>
          {store?.mode === "team"
            ? "Team permissions are enforced by the service."
            : "Local records are not visible to coworkers. Export backups regularly, or connect the shared service in Setup."}
        </p>
        <nav className="workspace-tabs" aria-label="CTI workflows">
          {[
            "Catalogue",
            "Scan",
            "Compare",
            "History",
            "Work queue",
            "Macmillan",
            "Analytics",
            "Setup",
          ].map((t) => (
            <button
              key={t}
              disabled={!!busy}
              className={tab === t ? "primary" : "secondary"}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <label>
          Selected source course
          <select
            aria-label="Selected source course"
            disabled={!!busy}
            value={courseId}
            onChange={(e) => void selectCourse(e.target.value)}
          >
            <option value="">Choose a saved course</option>
            {courses.map((r) => (
              <option value={r.id} key={r.id}>
                {r.title} · {r.data.partner}
              </option>
            ))}
          </select>
        </label>
      </div>
      {busy && (
        <div className="status" role="status">
          <span className="pulse" />
          <div>
            <strong>{busy}</strong>
            <span>
              Elapsed {Math.floor(seconds / 60)}m{" "}
              {String(seconds % 60).padStart(2, "0")}s
            </span>
          </div>
          {computing && (
            <button
              className="text-button"
              onClick={() => controller.current?.abort()}
            >
              Cancel comparison
            </button>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="scope">
          {notice}
        </p>
      )}
      {tab === "Catalogue" && (
        <section className="card">
          <h2>Course catalogue</h2>
          <label>
            Find a course
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title, partner or owner"
            />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Partner / owner</th>
                  <th>Status</th>
                  <th>Deadline</th>
                  <th>Saved version</th>
                </tr>
              </thead>
              <tbody>
                {courses
                  .filter((r) =>
                    `${r.title} ${r.data.partner} ${r.data.owner}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={() => void selectCourse(r.id)}
                        >
                          {r.title}
                        </button>
                      </td>
                      <td>
                        {r.data.partner}
                        <br />
                        {r.data.owner}
                      </td>
                      <td>{r.data.status}</td>
                      <td>{r.data.deadline || "—"}</td>
                      <td>{r.version}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!courses.length && (
            <p>
              Use Scan to add a source package, or Setup to import existing CTI
              records.
            </p>
          )}
          {course && (
            <>
              <h3>{course.title}</h3>
              <div className="settings">
                <label>
                  Partner
                  <input
                    value={partner}
                    onChange={(e) => setPartner(e.target.value)}
                  />
                </label>
                <label>
                  Owner
                  <input
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                  />
                </label>
                <label>
                  Status
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Deadline
                  <input
                    type="date"
                    value={deadline.slice(0, 10)}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </label>
              </div>
              <button
                className="primary"
                disabled={!editable || !!busy}
                onClick={() =>
                  void act("Saving metadata", async () => {
                    setCourse(
                      await store!.save({
                        ...course,
                        data: {
                          ...course.data,
                          partner,
                          owner,
                          status,
                          deadline,
                        },
                      }),
                    );
                    await refresh();
                    setNotice("Course details saved.");
                  })
                }
              >
                Save course details
              </button>
              <details>
                <summary>Explore saved source structure</summary>
                <Evidence value={course.data.scan.courseTree} />
              </details>
              <button
                className="secondary"
                onClick={() =>
                  void act("Loading saved versions", async () =>
                    setVersions(await store!.versions(course.id)),
                  )
                }
              >
                Show saved versions
              </button>
              {versions.length > 0 && <Evidence value={versions} />}
            </>
          )}
        </section>
      )}
      <div hidden={tab !== "Scan"}>
        <PackageWorkspace
          fileInputId="workspace-package-file"
          onBusyChange={(b) => setBusy(b ? "Inspecting source package" : "")}
          onResult={setScan}
        />
        {scan && (
          <section className="card">
            <h3>Save this source scan</h3>
            <div className="settings">
              <label>
                Partner
                <input
                  value={partner}
                  onChange={(e) => setPartner(e.target.value)}
                />
              </label>
              <label>
                Owner
                <input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                />
              </label>
            </div>
            {course && (
              <label>
                <input
                  type="checkbox"
                  checked={rescan}
                  onChange={(e) => setRescan(e.target.checked)}
                />{" "}
                Replace the selected course’s current scan, retaining its UUID
                and history
              </label>
            )}
            <button
              className="primary"
              disabled={!editable || !!busy || !partner.trim()}
              onClick={() => void saveCourseScan()}
            >
              Save {rescan && course ? "rescan" : "new course"}
            </button>
          </section>
        )}
      </div>
      {tab === "Compare" && (
        <section className="card">
          <h2>Full source → Coursera comparison</h2>
          <p>
            XLSX supplies structure, titles and placement. Captures enrich it
            with observed content. The selected source scan is the comparison
            baseline.
          </p>
          <div className="settings">
            <FileField
              label="Coursera XLSX (required)"
              accept=".xlsx"
              onChange={setExcel}
            />
            <FileField
              label="Coursera full capture JSON"
              accept=".json"
              onChange={setCapture}
            />
            <FileField
              label="Brightspace source JSON"
              accept=".json"
              onChange={setSource}
            />
            <FileField
              label="Supplemental reading recovery JSON"
              accept=".json"
              onChange={setRecovery}
            />
            <label>
              Snapshot stage
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="ops">Current / manually prepared</option>
                <option value="raw">Immediately after ingestion</option>
                <option value="published">Published / learner-facing</option>
                <option value="auto">Detect from evidence</option>
              </select>
            </label>
            <label>
              Ingestion generation (0 = original import)
              <input
                type="number"
                min="0"
                max="99"
                step="1"
                value={generation}
                onChange={(e) => setGeneration(Number(e.target.value))}
              />
            </label>
            <label>
              Smart Ingestion capability
              <select
                value={ingestionCapabilityStatus}
                onChange={(e) =>
                  setIngestionCapabilityStatus(
                    e.target.value as typeof ingestionCapabilityStatus,
                  )
                }
              >
                <option value="UNKNOWN">
                  Unknown — confirm before re-ingesting
                </option>
                <option value="LATEST_APPLIED">
                  Latest available Smart Ingestion already applied
                </option>
                <option value="LEGACY_OR_OUTDATED">
                  Older/import-only shell
                </option>
              </select>
            </label>
          </div>
          <p className="hint">
            Increase the generation only after a new ingestion. Another export
            or manual correction stays in the same attempt. Saving a new report
            never overwrites a prior raw baseline.
          </p>
          <button
            className="primary"
            disabled={!course || !excel || !editable || !!busy}
            onClick={() => void compare()}
          >
            Run and save full comparison
          </button>
        </section>
      )}
      {(tab === "Compare" || tab === "History") && report && (
        <section className="card">
          <h2>Assignment owner report</h2>
          <div className="workspace-tabs">
            <button
              className="secondary"
              onClick={() =>
                download(
                  "CTI_owner_report.txt",
                  String(report.report || json(report.result)),
                  "text/plain",
                )
              }
            >
              Download complete report
            </button>
            <button
              className="secondary"
              onClick={() => download("CTI_QA_result.json", json(report))}
            >
              Download full evidence
            </button>
            <button
              className="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(String(report.report || json(report.result)))
                  .then(() => setNotice("Report copied."))
                  .catch(() =>
                    setError("Copy unavailable. Download the text report."),
                  )
              }
            >
              Copy report
            </button>
          </div>
          <OwnerEvidence result={report.result || {}} />
          <details open>
            <summary>Complete report and technical evidence</summary>
            <pre className="owner-report">
              {report.report || json(report.result)}
            </pre>
          </details>
          <details>
            <summary>Coursera-oriented owner view and item evidence</summary>
            <Evidence value={report.result?.ownerView || report.result} />
          </details>
        </section>
      )}
      {tab === "History" && (
        <section className="card">
          <h2>Before / after history</h2>
          <p>
            Saved audit snapshots are immutable. Select two reports for the same
            source course to compare their evidence.
          </p>
          <ul>
            {audits.map((r) => (
              <li key={r.id}>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() =>
                    void act("Opening full saved report", async () =>
                      setReport((await store!.get(r.id)).data),
                    )
                  }
                >
                  {r.title}
                </button>{" "}
                · {r.updatedAt}
              </li>
            ))}
          </ul>
          <div className="settings">
            <label>
              Before
              <select
                value={before}
                onChange={(e) => setBefore(e.target.value)}
              >
                <option value="">Choose before report</option>
                {audits.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              After
              <select value={after} onChange={(e) => setAfter(e.target.value)}>
                <option value="">Choose after report</option>
                {audits.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="primary"
            disabled={!!busy || !before || !after || before === after}
            onClick={() =>
              void act("Comparing saved snapshots", async () =>
                setAnalysis(
                  await job({
                    kind: "lifecycle",
                    before: await store!.get(before),
                    after: await store!.get(after),
                  }),
                ),
              )
            }
          >
            Compare snapshots
          </button>
          {analysis && (
            <>
              <button
                className="secondary"
                onClick={() =>
                  download("CTI_before_after.json", json(analysis))
                }
              >
                Download comparison
              </button>
              <Evidence value={analysis} />
            </>
          )}
        </section>
      )}
      {tab === "Work queue" && (
        <section className="card">
          <h2>Owner work queue</h2>
          <p>
            Checklist ticks record work completed. They never alter evidence or
            QA verdicts.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {courses
                  .filter((r) => r.data.status !== "Completed")
                  .map((r) => (
                    <tr key={r.id}>
                      <td>{r.title}</td>
                      <td>{r.data.owner || "Unassigned"}</td>
                      <td>{r.data.status}</td>
                      <td>{r.data.deadline || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {course && checklist && (
            <>
              <h3>{course.title}</h3>
              {steps.map(([key, label]) => (
                <label className="check-row" key={key}>
                  <input
                    type="checkbox"
                    disabled={!editable || !!busy}
                    checked={!!checklist.data.evidence?.[key]}
                    onChange={(e) =>
                      setChecklist({
                        ...checklist,
                        data: {
                          ...checklist.data,
                          evidence: {
                            ...checklist.data.evidence,
                            [key]: e.target.checked,
                          },
                        },
                      })
                    }
                  />
                  {label}
                </label>
              ))}
              <label>
                Notes
                <textarea
                  value={checklist.data.notes || ""}
                  onChange={(e) =>
                    setChecklist({
                      ...checklist,
                      data: { ...checklist.data, notes: e.target.value },
                    })
                  }
                />
              </label>
              <button
                className="primary"
                disabled={!editable || !!busy}
                onClick={() =>
                  void act("Saving checklist", async () => {
                    setChecklist(await store!.save(checklist));
                    await refresh();
                    setNotice("Checklist saved.");
                  })
                }
              >
                Save checklist
              </button>
            </>
          )}
          {records.some((r) => r.kind === "checklist" && !r.packageId) && (
            <details>
              <summary>Imported checklists awaiting course assignment</summary>
              {records
                .filter((r) => r.kind === "checklist" && !r.packageId)
                .map((r) => (
                  <p key={r.id}>
                    {r.title}{" "}
                    <button
                      className="secondary"
                      disabled={!course || !editable || !!busy}
                      onClick={() =>
                        void act("Assigning imported checklist", async () => {
                          const full = await store!.get(r.id);
                          setChecklist(
                            await store!.save({ ...full, packageId: courseId }),
                          );
                          await refresh();
                        })
                      }
                    >
                      Link to selected course
                    </button>
                  </p>
                ))}
            </details>
          )}
        </section>
      )}
      {tab === "Macmillan" && (
        <section className="card">
          <h2>Macmillan workbook workflow</h2>
          <p>
            Inspect and split the source workbook, then QA externally created
            Metadata, Merged and ContentMap workbooks against the preserved
            baseline. CTI does not generate those documents.
          </p>
          <label>
            Resume saved workbook
            <select
              value={bookRecord?.id || ""}
              onChange={(e) => {
                if (e.target.value)
                  void act("Opening workbook", async () => {
                    const r = await store!.get(e.target.value);
                    setBookRecord(r);
                    setBook(r.data.book);
                    setMasterResult(r.data.masterResult);
                    setMacResult(null);
                  });
              }}
            >
              <option value="">Choose workbook</option>
              {records
                .filter((r) => r.kind === "workbook")
                .map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.title}
                  </option>
                ))}
            </select>
          </label>
          <FileField
            label="New source master XLSX"
            accept=".xlsx"
            onChange={setMaster}
          />
          <button
            className="primary"
            disabled={!master || !editable || !!busy}
            onClick={() =>
              void act("Scanning Macmillan master", async () => {
                const f = (await inputFile(master))!;
                const out = await job({ kind: "macmillan-scan", ...f });
                setBookRecord(null);
                setBook(out.book);
                setMasterResult(out.result);
                setAnchors([]);
                setSpecNames({});
                setMacResult(null);
                setTriage(false);
                const saved = await store!.save(
                  newRecord("workbook", master!.name, {
                    book: out.book,
                    masterResult: out.result,
                  }),
                );
                setBookRecord(saved);
                await refresh();
              })
            }
          >
            Scan and save master
          </button>
          {book && (
            <>
              <h3>Specialization boundaries</h3>
              <p>
                Select one to four Level 1 start rows. Source order is
                preserved.
              </p>
              {(masterResult?.filteredModules || []).map(
                (m: EvidenceObject) => (
                  <div className="anchor-row" key={m.excelRow}>
                    <label>
                      <input
                        type="checkbox"
                        checked={anchors.includes(m.excelRow)}
                        onChange={(e) =>
                          setAnchors(
                            e.target.checked
                              ? [...anchors, m.excelRow]
                              : anchors.filter((a) => a !== m.excelRow),
                          )
                        }
                      />
                      Row {m.excelRow}: {m.name}
                    </label>
                    {anchors.includes(m.excelRow) && (
                      <input
                        aria-label={`Specialization name at row ${m.excelRow}`}
                        value={specNames[m.excelRow] || ""}
                        placeholder="Specialization name"
                        onChange={(e) =>
                          setSpecNames({
                            ...specNames,
                            [m.excelRow]: e.target.value,
                          })
                        }
                      />
                    )}
                  </div>
                ),
              )}
              <button
                className="primary"
                disabled={
                  !editable || !!busy || !anchors.length || anchors.length > 4
                }
                onClick={() => void split(false)}
              >
                Review split
              </button>
              {triage && (
                <>
                  <h3>Modules needing an explicit inclusion decision</h3>
                  {Array.from(
                    new Set(
                      (macResult?.triageData || []).flatMap(
                        (x: EvidenceObject) => x.grayItems || x.items || [],
                      ),
                    ),
                  ).map((name: any) => (
                    <label className="check-row" key={String(name)}>
                      <input
                        type="checkbox"
                        checked={approved.includes(String(name))}
                        onChange={(e) =>
                          setApproved(
                            e.target.checked
                              ? [...approved, String(name)]
                              : approved.filter((n) => n !== name),
                          )
                        }
                      />
                      {String(name)}
                    </label>
                  ))}
                  <Evidence value={macResult?.triageData} />
                  <button
                    className="primary"
                    disabled={!editable || !!busy}
                    onClick={() => void split(true)}
                  >
                    Apply inclusion choices
                  </button>
                </>
              )}
              <div className="workspace-tabs">
                <button
                  className="secondary"
                  onClick={() =>
                    download(
                      "CTI_workbook.xlsx",
                      writeWorkbook(book),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                  }
                >
                  Download complete workbook
                </button>
                {[1, 2, 3, 4]
                  .filter((n) => book.sheets[`Spec${n}_Clean`])
                  .map((n) => (
                    <button
                      className="secondary"
                      key={n}
                      onClick={() => {
                        const sheets: BookData["sheets"] = {
                          export: book.sheets[`Spec${n}_Clean`],
                        };
                        for (const [suffix, title] of [
                          ["Context", "Module Context"],
                          ["Time_Policy", "Time Policy"],
                          ["Excluded", "Excluded Modules"],
                        ])
                          if (book.sheets[`Spec${n}_${suffix}`])
                            sheets[title] = book.sheets[`Spec${n}_${suffix}`];
                        download(
                          `Spec${n}.xlsx`,
                          writeWorkbook({ name: `Spec${n}`, sheets }),
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        );
                      }}
                    >
                      Download Spec {n}
                    </button>
                  ))}
              </div>
              <h3>Validate an external output</h3>
              <div className="settings">
                <label>
                  Stage
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                  >
                    {["Metadata", "Merged", "ContentMap"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Specialization
                  <select
                    value={spec}
                    onChange={(e) => setSpec(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <FileField
                  label="Output XLSX to validate"
                  accept=".xlsx"
                  onChange={setQaFile}
                />
              </div>
              <button
                className="primary"
                disabled={!editable || !!busy || !qaFile}
                onClick={() =>
                  void act("Validating workbook output", async () => {
                    const f = (await inputFile(qaFile))!;
                    const out = await job({
                      kind: "macmillan-qa",
                      book,
                      ...f,
                      stage,
                      spec,
                    });
                    setMacResult(out.result);
                    if (out.result.success) {
                      await persistBook(out.book);
                      setNotice(
                        "Validation completed; accepted output tabs were saved.",
                      );
                    }
                  })
                }
              >
                Run stage QA
              </button>
              {macResult && <Evidence value={macResult} />}
            </>
          )}
        </section>
      )}
      {tab === "Analytics" && (
        <section className="card">
          <h2>Portfolio analytics</h2>
          <p>
            Uses the existing structural vector, IFS and labor estimate rules.
            Original z-score and lexical diagnostics stay attached to each
            source scan.
          </p>
          <button
            className="primary"
            disabled={!!busy || !courses.length}
            onClick={() =>
              void act("Analysing course portfolio", async () =>
                setAnalysis(await job({ kind: "analytics", records: courses })),
              )
            }
          >
            Analyse saved courses
          </button>
          {analysis?.profiles && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Source items</th>
                    <th>IFS workload</th>
                    <th>Estimated hours</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.profiles.map((p: EvidenceObject) => (
                    <tr key={p.id}>
                      <td>{p.title}</td>
                      <td>{p.owner || "Unassigned"}</td>
                      <td>{p.status}</td>
                      <td>{p.stats.totalItems}</td>
                      <td>{p.stats.ifs}</td>
                      <td>{String(p.estimatedHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {analysis && (
            <>
              <button
                className="secondary"
                onClick={() =>
                  download("CTI_portfolio_analysis.json", json(analysis))
                }
              >
                Download analytics
              </button>
              <Evidence value={analysis} />
            </>
          )}
        </section>
      )}
      {tab === "Setup" && (
        <section className="card">
          <h2>Workspace access and migration</h2>
          <p>
            The shared service requires the D1 database and Cloudflare Access
            settings. An unconfigured service refuses access; it does not expose
            course records publicly.
          </p>
          <div className="workspace-tabs">
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                void act("Connecting to shared workspace", async () => {
                  const s = await teamStore();
                  setRecords(await s.list());
                  localStorage.setItem("cti-workspace-mode", s.mode);
                  setStore(s);
                  setCourse(null);
                  setCourseId("");
                  setReport(null);
                  setBook(null);
                  setBookRecord(null);
                  setNotice("Connected to the shared team workspace.");
                })
              }
            >
              Connect shared workspace
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                void act("Opening local workspace", async () => {
                  const s = localStore();
                  setRecords(await s.list());
                  localStorage.setItem("cti-workspace-mode", s.mode);
                  setStore(s);
                  setCourse(null);
                  setCourseId("");
                  setReport(null);
                  setBook(null);
                  setBookRecord(null);
                })
              }
            >
              Use this browser only
            </button>
          </div>
          <a
            href="https://github.com/archeearjun/cti-hardening/blob/codex/typescript-pages-migration/docs/shared-workspace-setup.md"
            target="_blank"
            rel="noreferrer"
          >
            Open shared setup instructions
          </a>
          <h3>Export a recovery backup</h3>
          <button
            className="secondary"
            disabled={!!busy || !store}
            onClick={() =>
              void act("Exporting workspace backup", async () => {
                const full = [];
                for (const r of records) full.push(await store!.get(r.id));
                download(
                  "CTI_workspace_backup.json",
                  json({
                    kind: "CTI_BROWSER_WORKSPACE",
                    schemaVersion: 1,
                    exportedAt: new Date().toISOString(),
                    records: full,
                  }),
                );
              })
            }
          >
            Download workspace backup
          </button>
          <h3>Import existing records</h3>
          <p>
            Use the existing app’s migration JSON or a backup from this
            workspace. Existing record IDs are preserved. Conflicts are skipped
            and reported, never overwritten.
          </p>
          <FileField
            label="Workspace migration or backup JSON"
            accept=".json"
            onChange={(file) => {
              if (file)
                void act("Checking migration file", async () => {
                  setImportPlan(null);
                  const value = JSON.parse(await file.text());
                  if (
                    value.kind === "CTI_BROWSER_WORKSPACE" &&
                    value.schemaVersion === 1 &&
                    Array.isArray(value.records)
                  ) {
                    setImportPlan({
                      records: prepareWorkspaceBackup(value),
                      warnings: [],
                    });
                  } else setImportPlan(importLegacyWorkspace(value));
                });
            }}
          />
          {importPlan && (
            <>
              <p>
                {importPlan.records.length} records prepared.{" "}
                {importPlan.warnings.length} warnings.
              </p>
              {importPlan.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <button
                className="primary"
                disabled={
                  !editable ||
                  !!busy ||
                  (store?.mode === "team" && store.role !== "admin")
                }
                onClick={() =>
                  void act("Importing workspace records", async () => {
                    const existing = new Set(records.map((r) => r.id));
                    let saved = 0,
                      skipped = 0;
                    for (const r of importPlan.records) {
                      if (controller.current?.signal.aborted)
                        throw new Error(
                          `Import stopped after ${saved} saves. Saved records are retained; re-import safely skips them.`,
                        );
                      if (existing.has(r.id)) {
                        skipped++;
                        continue;
                      }
                      await store!.save({ ...r, version: 0 });
                      existing.add(r.id);
                      saved++;
                    }
                    await refresh();
                    setNotice(
                      `Imported ${saved} records; skipped ${skipped} existing IDs. Original backup data remains available.`,
                    );
                    setImportPlan(null);
                  })
                }
              >
                Import prepared records
              </button>
            </>
          )}
        </section>
      )}
    </section>
  );
}
