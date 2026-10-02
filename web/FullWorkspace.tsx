import OwnerEvidence from "./OwnerEvidence";
import SourceExplorer from "./SourceExplorer";
import EvidenceDetails from "./EvidenceDetails";
import ReportOverview from "./ReportOverview";
import { readMigrationFiles } from "../src/domain/migration-files";
import {
  prepareWorkspaceBackup,
  validateImportRecordSizes,
} from "../src/domain/workspace-validation";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import PackageWorkspace from "./PackageWorkspace";
import { runWorkflow } from "./workflow-client";
import {
  localStore,
  teamStore,
  newRecord,
  type WorkspaceStore,
} from "../src/domain/workspace-store";
import { importLegacyWorkspace } from "../src/domain/legacy-import";
import { download, json, inputFile, Evidence, FileField } from "./workspace-ui";
const MacmillanWorkspace = lazy(() => import("./MacmillanWorkspace"));
const CourseraExtractionWorkspace = lazy(
  () => import("./CourseraExtractionWorkspace"),
);
const OperationsWorkspace = lazy(() => import("./OperationsWorkspace"));
import {
  applyLineageRepairs,
  normalizePartnerName,
  packageSemanticKey,
  validateCourseMetadata,
} from "../src/domain/operations.ts";
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
const descriptions: Record<string, string> = {
  Overview:
    "See what needs attention, resume the selected course, and jump into the next evidence task.",
  Catalogue: "Find a course, see its ownership, and pick up your review.",
  Explore: "Understand the source package before making an ingestion decision.",
  Scan: "Inspect a new package or save a fresh baseline for an existing course.",
  Extract:
    "Run the current Coursera extractor in your signed-in Chrome at zero browser-service cost, then verify its capture in CTI.",
  Compare: "Compare source evidence with what was captured in Coursera.",
  History:
    "Review saved reports and compare ingestion attempts or manual corrections.",
  "Work queue":
    "Track the evidence collection and review work for each course.",
  Macmillan:
    "Prepare source specializations and validate externally created workbooks.",
  Analytics:
    "Review portfolio structure and workload across saved source scans.",
  Operations:
    "Manage migrated planner/catalog inputs, preflight, runtime evidence, duplicates, lineage and operational workflow state.",
  Setup: "Manage your workspace connection, backups and migration recovery.",
};
const navGroups = [
  { label: "Workspace", tabs: ["Overview", "Catalogue", "Work queue"] },
  {
    label: "Course evidence",
    tabs: ["Explore", "Scan", "Extract", "Compare", "History"],
  },
  { label: "Tools & admin", tabs: ["Macmillan", "Analytics", "Operations", "Setup"] },
] as const;
const navGlyphs: Record<string, string> = {
  Overview: "⌂",
  Catalogue: "⌕",
  "Work queue": "✓",
  Explore: "≡",
  Scan: "↑",
  Extract: "↓",
  Compare: "⇄",
  History: "◷",
  Macmillan: "M",
  Analytics: "∿",
  Operations: "⚙",
  Setup: "•",
};
const dateLabel = (value: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Date not recorded";
export default function FullWorkspace({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const [store, setStore] = useState<WorkspaceStore | null>(null),
    [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [tab, setTab] = useState("Overview"),
    [courseId, setCourseId] = useState(""),
    [course, setCourse] = useState<WorkspaceRecord | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [seconds, setSeconds] = useState(0),
    [importProgress, setImportProgress] = useState("");
  const [portfolio, setPortfolio] = useState<EvidenceObject | null>(null);
  const [extractionPrefill, setExtractionPrefill] = useState("");
  const [legacyPolicyDetails, setLegacyPolicyDetails] =
    useState<EvidenceObject | null>(null);
  useEffect(() => setPortfolio(null), [records]);
  const [reportId, setReportId] = useState("");
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
    [assignedDate, setAssignedDate] = useState(""),
    [deadline, setDeadline] = useState(""),
    [driveLink, setDriveLink] = useState("");
  const [scan, setScan] = useState<PackageScan | null>(null),
    [rescan, setRescan] = useState(false),
    [checklist, setChecklist] = useState<WorkspaceRecord | null>(null);
  const [ingestionCapabilityStatus, setIngestionCapabilityStatus] = useState<
    "UNKNOWN" | "LATEST_APPLIED" | "LEGACY_OR_OUTDATED"
  >("UNKNOWN");
  const [computing, setComputing] = useState(false);
  const [importPlan, setImportPlan] = useState<ReturnType<
    typeof importLegacyWorkspace
  > | null>(null);
  const [acceptMigrationGaps, setAcceptMigrationGaps] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const reportHeading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (!report) return;
    const frame = requestAnimationFrame(() => {
      reportHeading.current?.focus({ preventScroll: true });
      reportHeading.current?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [report]);
  const [partnerFilter, setPartnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);
  const [connectionReady, setConnectionReady] = useState(false);
  useEffect(() => {
    onBusyChange?.(!!busy);
  }, [busy, onBusyChange]);
  useEffect(() => setPage(0), [query, partnerFilter, statusFilter, records]);
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
      } finally {
        if (alive) setConnectionReady(true);
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
  const migrationRecoveries = records.filter(
    (r) =>
      r.kind === "legacy-backup" &&
      r.data.kind === "CTI_MIGRATION_RECOVERY_CASE" &&
      !records.some((a) => a.kind === "audit" && a.id === r.data.sourceRunId),
  );
  const courses = records
    .filter((r) => r.kind === "package" && r.data.archived !== true)
    .sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
  const audits = records
    .filter((r) => r.kind === "audit" && r.packageId === courseId)
    .sort(
      (a, b) =>
        (Number(b.data.generation) || 0) - (Number(a.data.generation) || 0) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const filteredCourses = courses.filter(
    (r) =>
      `${r.title} ${r.data.partner || ""} ${r.data.owner || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!partnerFilter || r.data.partner === partnerFilter) &&
      (!statusFilter || r.data.status === statusFilter),
  );
  const pages = Math.max(1, Math.ceil(filteredCourses.length / 25));
  const activePage = Math.min(page, pages - 1);
  const checklistCount = steps.filter(
    ([key]) => checklist?.data.evidence?.[key],
  ).length;
  const today = new Date().toISOString().slice(0, 10);
  const blockedCourses = courses.filter((r) => r.data.status === "Blocked");
  const qaReviewCourses = courses.filter((r) => r.data.status === "QA Review");
  const overdueCourses = courses.filter(
    (r) =>
      r.data.status !== "Completed" &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(r.data.deadline || "")) &&
      String(r.data.deadline).slice(0, 10) < today,
  );
  const unownedCourses = courses.filter(
    (r) => r.data.status !== "Completed" && !String(r.data.owner || "").trim(),
  );
  const attentionCourses = [...courses]
    .filter(
      (r) =>
        r.data.status === "Blocked" ||
        r.data.status === "QA Review" ||
        overdueCourses.some((overdue) => overdue.id === r.id),
    )
    .sort((a, b) => {
      const score = (r: WorkspaceRecord) =>
        (r.data.status === "Blocked" ? 4 : 0) +
        (overdueCourses.some((overdue) => overdue.id === r.id) ? 2 : 0) +
        (r.data.status === "QA Review" ? 1 : 0);
      return (
        score(b) - score(a) ||
        String(a.data.deadline || "9999").localeCompare(
          String(b.data.deadline || "9999"),
        ) ||
        a.title.localeCompare(b.title, undefined, { numeric: true })
      );
    })
    .slice(0, 8);
  const legacyPolicyRef = records.find(
    (r) =>
      r.kind === "legacy-backup" &&
      r.data.kind === "CTI_LEGACY_ACCESS_POLICY",
  );
  const legacyScanHistoryCount = records.filter(
    (r) => r.kind === "operations" && r.data.type === "legacy-scan-history",
  ).length;
  const legacyDuplicateArchiveCount = records.filter(
    (r) =>
      r.kind === "operations" && r.data.type === "legacy-duplicate-archive",
  ).length;
  const legacyCatalogMapCount = records.filter(
    (r) => r.kind === "operations" && r.data.type === "legacy-catalog-map",
  ).length;
  function assertUniquePackageIdentity(
    candidatePartner: string,
    candidateFileName: string,
    excludeId = "",
  ) {
    const partnerKey = normalizePartnerName(candidatePartner);
    const semanticKey = packageSemanticKey(candidateFileName);
    if (!partnerKey || !semanticKey) return;
    const match = courses.find(
      (candidate) =>
        candidate.id !== excludeId &&
        normalizePartnerName(candidate.data.partner) === partnerKey &&
        packageSemanticKey(candidate.data.scan?.fileName || candidate.title) ===
          semanticKey,
    );
    if (match)
      throw new Error(
        `A course with this partner and semantic package identity already exists: ${match.title}. Select that course and rescan it, or review the duplicate group in Operations.`,
      );
  }
  function resetCourseInputs() {
    setExcel(null);
    setCapture(null);
    setSource(null);
    setRecovery(null);
    setMode("ops");
    setIngestionCapabilityStatus("UNKNOWN");
    setRescan(false);
    setScan(null);
    setGeneration(0);
    setReport(null);
    setReportId("");
    setAnalysis(null);
    setVersions([]);
    setBefore("");
    setAfter("");
  }
  function resetWorkspaceSelection() {
    resetCourseInputs();
    setCourse(null);
    setCourseId("");
    setChecklist(null);
    setImportPlan(null);
    setAcceptMigrationGaps(false);
    setLegacyPolicyDetails(null);
    setPartnerFilter("");
    setStatusFilter("");
    setQuery("");
  }
  async function openCourse(id: string, destination = "Explore") {
    await selectCourse(id);
    setTab(destination);
  }
  async function refresh(s = store) {
    if (s) setRecords(await s.list());
  }
  async function act(label: string, fn: () => Promise<void>) {
    setError("");
    setNotice("");
    setImportProgress("");
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
    resetCourseInputs();
    setCourseId(id);
    setReport(null);
    setReportId("");
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
      setAssignedDate(r.data.assignedDate || "");
      setDeadline(r.data.deadline || "");
      setDriveLink(r.data.driveLink || "");
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
      const metadata = validateCourseMetadata({
        partner,
        owner,
        status: rescan && course ? course.data.status || "In Queue" : "In Queue",
        assignedDate: rescan && course ? course.data.assignedDate || "" : "",
        deadline: rescan && course ? course.data.deadline || "" : "",
        driveLink: rescan && course ? course.data.driveLink || "" : "",
      });
      assertUniquePackageIdentity(
        metadata.partner,
        scan.fileName,
        rescan && course ? course.id : "",
      );
      const record =
        rescan && course
          ? { ...course, data: { ...course.data, ...metadata, scan } }
          : newRecord("package", scan.fileName, {
              scan,
              ...metadata,
            });
      const saved = await store.save(record);
      await refresh();
      resetCourseInputs();
      setCourseId(saved.id);
      setCourse(saved);
      setPartner(saved.data.partner || "");
      setOwner(saved.data.owner || "");
      setStatus(saved.data.status || "In Queue");
      setAssignedDate(saved.data.assignedDate || "");
      setDeadline(saved.data.deadline || "");
      setDriveLink(saved.data.driveLink || "");
      const savedChecklist = records.find(
        (r) => r.kind === "checklist" && r.packageId === saved.id,
      );
      setChecklist(
        savedChecklist
          ? await store.get(savedChecklist.id)
          : newRecord(
              "checklist",
              saved.title,
              { evidence: {}, notes: "" },
              saved.id,
            ),
      );
      setGeneration(
        Math.max(
          0,
          ...records
            .filter((r) => r.kind === "audit" && r.packageId === saved.id)
            .map((r) => Number(r.data.generation) || 0),
        ),
      );
      setTab("Explore");
      setNotice("Source scan saved. Previous saved versions are retained.");
    });
  }
  async function compare() {
    if (!store || !course || !excel) return;
    await act("Comparing full source and Coursera evidence", async () => {
      setImportProgress("Loading saved audit history");
      const history = await Promise.all(audits.map((a) => store.get(a.id)));
      const repairRefs = records.filter(
        (record) =>
          record.kind === "operations" &&
          record.packageId === course.id &&
          record.data.type === "lineage-repair",
      );
      const repairs = await Promise.all(
        repairRefs.map((record) => store.get(record.id)),
      );
      const repairedHistory = applyLineageRepairs(history, repairs);
      setImportProgress("Reading the selected evidence files");
      const input = {
        course,
        excel: (await inputFile(excel))!,
        json: await inputFile(capture),
        brightspace: await inputFile(source),
        recovery: await inputFile(recovery),
        mode,
        generation,
        history: repairedHistory,
        ingestionCapabilityStatus,
      };
      setImportProgress(
        "Checking source, placement, content and policy evidence",
      );
      const output = await job({ kind: "compare", input });
      setReport(output);
      setImportProgress(
        "Comparison complete. Saving the full report and evidence",
      );
      const saved = await store.save(
        newRecord(
          "audit",
          `${course.title} · generation ${generation} · ${mode}`,
          output,
          course.id,
        ),
      );
      setReportId(saved.id);
      await refresh();
      setNotice(
        `Full report saved (${saved.id}). Open an item below to start its review.`,
      );
    });
  }
  return (
    <section className="full-workspace">
      <aside className="workspace-sidebar">
        <p className="eyebrow">WORKSPACE</p>
        <nav aria-label="CTI workflows">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.tabs.map((t) => (
                <button
                  key={t}
                  disabled={!!busy}
                  aria-current={tab === t ? "page" : undefined}
                  onClick={() => {
                    setTab(t);
                    setNotice("");
                  }}
                >
                  <span className="nav-number" aria-hidden="true">
                    {navGlyphs[t]}
                  </span>
                  {t}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="connection-state">
          <span
            className={`connection-dot ${store?.mode === "team" ? "connected" : ""}`}
          />
          <strong>
            {store?.mode === "team"
              ? "Shared workspace"
              : store
                ? "Local workspace"
                : connectionReady
                  ? "Not connected"
                  : "Connecting…"}
          </strong>
          <small>
            {store?.mode === "team"
              ? `${store.email} · ${store.role}`
              : store
                ? "Saved in this browser only"
                : "Open Setup if connection fails."}
          </small>
        </div>
      </aside>
      <div className="workspace-content">
        <header className="workspace-heading">
          <div>
            <p className="eyebrow">CTI / {tab.toUpperCase()}</p>
            <h1>
              {tab === "Overview"
                ? "Workspace overview"
                : tab === "Catalogue"
                  ? "Your course evidence"
                  : tab}
            </h1>
            <p>{descriptions[tab]}</p>
          </div>
        </header>
        {store && store.mode !== "team" && (
          <p className="local-mode-note">
            Local records are not visible to coworkers.{" "}
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => setTab("Setup")}
            >
              Connect the shared workspace
            </button>{" "}
            or export a backup in Setup.
          </p>
        )}
        <div className="card course-context">
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
          {course ? (
            <div className="course-context-detail">
              <strong>{course.title}</strong>
              <span>
                {course.data.partner || "Partner unassigned"} ·{" "}
                {course.data.owner || "Owner unassigned"} ·{" "}
                {course.data.status || "Status not set"}
              </span>
              <small>
                {audits.length} complete saved reports · record version{" "}
                {course.version}
              </small>
              <div className="context-actions">
                {["Explore", "Compare", "History", "Work queue"]
                  .filter((t) => t !== tab)
                  .map((t) => (
                    <button
                      className="text-button"
                      key={t}
                      disabled={!!busy}
                      onClick={() => setTab(t)}
                    >
                      {t} →
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            <p className="hint">
              Choose a course to explore its source, compare evidence or resume
              its checklist.
            </p>
          )}
        </div>
        {busy && (
          <div className="status workspace-progress" role="status">
            <span className="pulse" />
            <div>
              <strong>{busy}</strong>
              {importProgress && <span>{importProgress}</span>}
              <span>
                Elapsed {Math.floor(seconds / 60)}m{" "}
                {String(seconds % 60).padStart(2, "0")}s
              </span>
            </div>
            {(computing ||
              busy === "Importing workspace records" ||
              busy === "Checking migration files") && (
              <button
                className="text-button"
                onClick={() => controller.current?.abort()}
              >
                {busy === "Importing workspace records"
                  ? "Stop import"
                  : "Cancel operation"}
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
          <p role="status" className="success-notice">
            {notice}
          </p>
        )}
        {tab === "Overview" && (
          <div className="workspace-overview">
            <section className="card overview-hero">
              <div>
                <p className="eyebrow">TODAY'S WORKSPACE</p>
                <h2>Move from evidence to the next clear action</h2>
                <p>
                  Use this page to find blockers, resume the selected course, or
                  start the next evidence step. The planner-driven operational
                  queue remains in Operations; the per-course collection
                  checklist remains in Work queue.
                </p>
              </div>
              <div className="overview-actions" aria-label="Quick actions">
                <button
                  className="primary"
                  disabled={!!busy || !editable}
                  onClick={() => setTab("Scan")}
                >
                  Scan source package
                </button>
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => setTab("Operations")}
                >
                  Open planner queue
                </button>
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => setTab("Catalogue")}
                >
                  Browse courses
                </button>
              </div>
            </section>
            <div className="overview-kpis" aria-label="Workspace status">
              <button disabled={!!busy} onClick={() => setTab("Catalogue")}>
                <strong>{courses.length}</strong>
                <span>Active courses</span>
                <small>Open catalogue →</small>
              </button>
              <button
                disabled={!!busy}
                onClick={() => {
                  setStatusFilter("QA Review");
                  setTab("Catalogue");
                }}
              >
                <strong>{qaReviewCourses.length}</strong>
                <span>In QA review</span>
                <small>Filter catalogue →</small>
              </button>
              <button
                className={blockedCourses.length ? "attention" : ""}
                disabled={!!busy}
                onClick={() => {
                  setStatusFilter("Blocked");
                  setTab("Catalogue");
                }}
              >
                <strong>{blockedCourses.length}</strong>
                <span>Blocked</span>
                <small>Review blockers →</small>
              </button>
              <button
                className={overdueCourses.length ? "attention" : ""}
                disabled={!!busy}
                onClick={() => setTab("Work queue")}
              >
                <strong>{overdueCourses.length}</strong>
                <span>Past deadline</span>
                <small>Open work queue →</small>
              </button>
              <button
                className={migrationRecoveries.length ? "attention" : ""}
                disabled={!!busy}
                onClick={() => setTab("Setup")}
              >
                <strong>{migrationRecoveries.length}</strong>
                <span>Reports to recover</span>
                <small>Review migration →</small>
              </button>
            </div>
            <div className="overview-columns">
              <section className="card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">PRIORITY</p>
                    <h2>Needs attention</h2>
                  </div>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => setTab("Work queue")}
                  >
                    All active work →
                  </button>
                </div>
                {attentionCourses.length ? (
                  <ul className="attention-list">
                    {attentionCourses.map((item) => {
                      const overdue = overdueCourses.some(
                        (candidate) => candidate.id === item.id,
                      );
                      return (
                        <li key={item.id}>
                          <button
                            className="attention-course"
                            disabled={!!busy}
                            onClick={() => void openCourse(item.id, "Explore")}
                          >
                            <span>
                              <strong>{item.title}</strong>
                              <small>
                                {item.data.partner || "Partner unassigned"} ·{" "}
                                {item.data.owner || "Owner unassigned"}
                              </small>
                            </span>
                            <span className="attention-meta">
                              <span
                                className={
                                  item.data.status === "Blocked"
                                    ? "status-pill blocked"
                                    : "status-pill"
                                }
                              >
                                {item.data.status}
                              </span>
                              {overdue && (
                                <small className="deadline-overdue">
                                  Due {item.data.deadline}
                                </small>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="empty-state">
                    No blocked, overdue, or QA-review courses are visible in
                    this workspace.
                  </p>
                )}
              </section>
              <section className="card">
                <p className="eyebrow">SELECTED COURSE</p>
                {course ? (
                  <>
                    <h2>{course.title}</h2>
                    <p>
                      {course.data.partner || "Partner unassigned"} ·{" "}
                      {course.data.owner || "Owner unassigned"}
                    </p>
                    <div className="selected-course-stats">
                      <span>
                        <strong>{audits.length}</strong> saved reports
                      </span>
                      <span>
                        <strong>{checklistCount}</strong> / {steps.length} checklist
                        steps
                      </span>
                    </div>
                    <div className="overview-actions vertical">
                      <button
                        className="primary"
                        disabled={!!busy}
                        onClick={() => setTab("Compare")}
                      >
                        Continue comparison
                      </button>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => setTab("Explore")}
                      >
                        Explore source
                      </button>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => setTab("Work queue")}
                      >
                        Open evidence checklist
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2>Select a course to resume</h2>
                    <p>
                      Choose a saved source course above. CTI will keep that
                      course in context while you move through Explore,
                      Compare, History, and the checklist.
                    </p>
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => setTab("Catalogue")}
                    >
                      Choose from catalogue
                    </button>
                  </>
                )}
                {!!unownedCourses.length && (
                  <p className="overview-footnote">
                    {unownedCourses.length} active course
                    {unownedCourses.length === 1 ? "" : "s"} still need an owner.
                  </p>
                )}
              </section>
            </div>
          </div>
        )}
        {tab === "Catalogue" && (
          <section className="card">
            <div className="section-heading">
              <h2>Course catalogue</h2>
              <button
                className="primary"
                disabled={!!busy || !editable}
                onClick={() => setTab("Scan")}
              >
                Add a source package
              </button>
            </div>
            <div className="metric-grid portfolio-counts">
              <div>
                <strong>{courses.length}</strong>
                <span>Saved courses</span>
              </div>
              <div>
                <strong>
                  {records.filter((r) => r.kind === "audit").length}
                </strong>
                <span>Complete saved reports</span>
              </div>
              <div>
                <strong>
                  {courses.filter((r) => r.data.status !== "Completed").length}
                </strong>
                <span>Courses in the work queue</span>
              </div>
              <button
                className="metric-link"
                disabled={!!busy}
                onClick={() => setTab("Setup")}
              >
                <strong>{migrationRecoveries.length}</strong>
                <span>Reports awaiting recovery →</span>
              </button>
            </div>
            <div className="filter-bar catalogue-filters">
              <label>
                Find a course
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Title, partner or owner"
                />
              </label>
              <label>
                Filter by partner
                <select
                  value={partnerFilter}
                  onChange={(e) => setPartnerFilter(e.target.value)}
                >
                  <option value="">All partners</option>
                  {[
                    ...new Set(
                      courses.map((r) => r.data.partner).filter(Boolean),
                    ),
                  ]
                    .sort()
                    .map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                </select>
              </label>
              <label>
                Filter by status
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {statuses.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint" role="status">
              {filteredCourses.length} of {courses.length} courses
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Partner / owner</th>
                    <th>Status</th>
                    <th>Deadline</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCourses
                    .slice(activePage * 25, (activePage + 1) * 25)
                    .map((r) => (
                      <tr
                        key={r.id}
                        className={
                          r.id === courseId ? "selected-course-row" : ""
                        }
                      >
                        <td>
                          <button
                            className="text-button"
                            disabled={!!busy}
                            onClick={() => void openCourse(r.id)}
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
                        <td>
                          <small>
                            {
                              records.filter(
                                (a) =>
                                  a.kind === "audit" && a.packageId === r.id,
                              ).length
                            }{" "}
                            saved reports
                          </small>
                          <button
                            className="text-button"
                            disabled={!!busy}
                            onClick={() => void openCourse(r.id, "Compare")}
                          >
                            Compare →
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!!courses.length && !filteredCourses.length && (
              <p className="empty-state">
                No courses match your filters. Try another title, partner or
                status.
              </p>
            )}
            {pages > 1 && (
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={activePage === 0 || !!busy}
                  onClick={() => setPage(activePage - 1)}
                >
                  Previous page
                </button>
                <span>
                  Page {activePage + 1} of {pages}
                </span>
                <button
                  className="secondary"
                  disabled={activePage + 1 >= pages || !!busy}
                  onClick={() => setPage(activePage + 1)}
                >
                  Next page
                </button>
              </div>
            )}
            {!courses.length && (
              <p>
                Use Scan to add a source package, or Setup to import existing
                CTI records.
              </p>
            )}
            {course && (
              <>
                <h3 className="section-divider">
                  Course details · {course.title}
                </h3>
                <fieldset disabled={!editable || !!busy}>
                  <legend className="sr-only">Course metadata</legend>
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
                      Assigned date
                      <input
                        type="date"
                        value={assignedDate.slice(0, 10)}
                        onChange={(e) => setAssignedDate(e.target.value)}
                      />
                    </label>
                    <label>
                      Deadline
                      <input
                        type="date"
                        value={deadline.slice(0, 10)}
                        onChange={(e) => setDeadline(e.target.value)}
                      />
                    </label>
                    <label>
                      Drive / Docs link
                      <input
                        type="url"
                        value={driveLink}
                        placeholder="https://drive.google.com/..."
                        onChange={(e) => setDriveLink(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    className="primary"
                    disabled={!editable || !!busy}
                    onClick={() =>
                      void act("Saving metadata", async () => {
                        const metadata = validateCourseMetadata({
                          partner,
                          owner,
                          status: status as
                            | "In Queue"
                            | "In Progress"
                            | "QA Review"
                            | "Blocked"
                            | "Completed",
                          assignedDate,
                          deadline,
                          driveLink,
                        });
                        assertUniquePackageIdentity(
                          metadata.partner,
                          course.data.scan?.fileName || course.title,
                          course.id,
                        );
                        const saved = await store!.save({
                          ...course,
                          data: {
                            ...course.data,
                            ...metadata,
                          },
                        });
                        setCourse(saved);
                        setPartner(saved.data.partner || "");
                        setOwner(saved.data.owner || "");
                        setStatus(saved.data.status || "In Queue");
                        setAssignedDate(saved.data.assignedDate || "");
                        setDeadline(saved.data.deadline || "");
                        setDriveLink(saved.data.driveLink || "");
                        await refresh();
                        setNotice("Course details saved and validated.");
                      })
                    }
                  >
                    Save course details
                  </button>
                </fieldset>
                <button className="secondary" onClick={() => setTab("Explore")}>
                  Explore saved source structure
                </button>
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
        {tab === "Explore" && (
          <section className="card">
            {course?.data.scan ? (
              <>
                <SourceExplorer
                  key={`${course.id}-${course.version}`}
                  scan={course.data.scan}
                />
                <button
                  className="secondary"
                  onClick={() =>
                    download("CTI_source_evidence.json", json(course.data.scan))
                  }
                >
                  Download saved source evidence
                </button>
                <button
                  className="secondary"
                  disabled={!!busy || !editable}
                  onClick={() => {
                    setRescan(true);
                    setTab("Scan");
                  }}
                >
                  Rescan this course
                </button>
              </>
            ) : (
              <p className="empty-state">
                Select a saved course above, or scan a source package to explore
                it.
              </p>
            )}
          </section>
        )}
        <div hidden={tab !== "Scan"}>
          {course && (
            <p className="scope">
              <strong>
                {rescan ? "Rescan target" : "Selected source"}: {course.title}
              </strong>
              <br />
              {rescan
                ? "The new scan will replace this course’s current baseline when you save. Its ID and previous history are retained."
                : "After inspection, choose whether to add a new course or replace this course’s baseline."}
            </p>
          )}
          <PackageWorkspace
            fileInputId="workspace-package-file"
            catalogueMode
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
        {tab === "Extract" && (
          <Suspense
            fallback={
              <section className="card" role="status" aria-live="polite">
                Loading extraction workspace…
              </section>
            }
          >
            <CourseraExtractionWorkspace
              enabled={store?.mode === "team"}
              editable={editable}
              disabled={!!busy}
              initialUrl={extractionPrefill}
              onUseCapture={(file) => {
                setCapture(file);
                setTab("Compare");
                setNotice(
                  "Local Coursera capture loaded into Compare. Add the matching Coursera XLSX before running the source comparison.",
                );
              }}
            />
          </Suspense>
        )}
        {tab === "Compare" && (
          <section className="card">
            <h2>Full source → Coursera comparison</h2>
            <p>
              XLSX supplies structure, titles and placement. Captures enrich it
              with observed content. The selected source scan is the comparison
              baseline.
            </p>
            {!course && (
              <p className="empty-state">
                Choose a saved source course above to begin.
              </p>
            )}
            <div className="section-heading">
              <h3>1. Add destination evidence</h3>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => setTab("Extract")}
              >
                Extract Coursera shell →
              </button>
            </div>
            <fieldset key={courseId} disabled={!course || !!busy || !editable}>
              <legend className="sr-only">Comparison inputs</legend>
              <div className="settings">
                <FileField
                  label="Coursera XLSX (required)"
                  accept=".xlsx"
                  file={excel}
                  onChange={setExcel}
                />
                <FileField
                  label="Coursera full capture JSON"
                  accept=".json"
                  file={capture}
                  onChange={setCapture}
                />
              </div>
              <p className="hint">
                Use files from the selected course and the same capture stage.
                Without a Coursera JSON capture, content evidence will be
                limited.
              </p>
              <h3>2. Add source and supplemental evidence</h3>
              <div className="settings">
                <FileField
                  label="Brightspace source JSON"
                  accept=".json"
                  file={source}
                  onChange={setSource}
                />
                <FileField
                  label="Supplemental reading recovery JSON"
                  accept=".json"
                  file={recovery}
                  onChange={setRecovery}
                />
              </div>
              <h3>3. Identify this snapshot</h3>
              <div className="settings">
                <label>
                  Snapshot stage
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                  >
                    <option value="ops">Current / manually prepared</option>
                    <option value="raw">Immediately after ingestion</option>
                    <option value="published">
                      Published / learner-facing
                    </option>
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
                Increase the generation only after a new ingestion. Another
                export or manual correction stays in the same attempt. Saving a
                new report never overwrites a prior raw baseline.
              </p>
              <button
                className="primary"
                disabled={!course || !excel || !editable || !!busy}
                onClick={() => void compare()}
              >
                Run and save full comparison
              </button>
            </fieldset>
            {course && !excel && (
              <p className="hint">
                Add the Coursera XLSX to enable the comparison.
              </p>
            )}
            {!editable && (
              <p className="hint">
                An editor or administrator can save comparisons.
              </p>
            )}
          </section>
        )}
        {tab === "History" && (
          <section className="card">
            <h2>Before / after history</h2>
            {migrationRecoveries.some((r) => r.packageId === courseId) && (
              <p role="alert">
                This course has migrated QA history entries whose full reports
                are unavailable. Open Setup for recovery details. They are
                excluded from comparisons.
              </p>
            )}
            <p>
              Saved audit snapshots are immutable. Select two reports for the
              same source course to compare their evidence.
            </p>
            {!audits.length && (
              <p className="empty-state">
                {course
                  ? "No complete reports saved for this course yet. Run a comparison to create the first snapshot."
                  : "Choose a course above to see its saved reports."}
              </p>
            )}
            <ul className="history-list">
              {audits.map((r) => (
                <li key={r.id}>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      void act("Opening full saved report", async () => {
                        setReport((await store!.get(r.id)).data);
                        setReportId(r.id);
                      })
                    }
                  >
                    {r.title}
                  </button>{" "}
                  <small>
                    {dateLabel(r.updatedAt)} · Generation{" "}
                    {r.data.generation ?? "not recorded"} ·{" "}
                    {r.data.stage || "Stage in full report"}
                  </small>
                </li>
              ))}
            </ul>
            <div className="settings">
              <label>
                Before
                <select
                  disabled={!!busy}
                  value={before}
                  onChange={(e) => {
                    setBefore(e.target.value);
                    setAnalysis(null);
                  }}
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
                <select
                  disabled={!!busy}
                  value={after}
                  onChange={(e) => {
                    setAfter(e.target.value);
                    setAnalysis(null);
                  }}
                >
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
                <p className="scope">
                  {analysis.note ||
                    "Review the observed changes below against the saved reports."}
                </p>
                {analysis.lifecycleItems && (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Source item</th>
                          <th>Before</th>
                          <th>After</th>
                          <th>Current action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.lifecycleItems.map(
                          (item: EvidenceObject, i: number) => (
                            <tr key={i}>
                              <td>
                                {item.sourceName ||
                                  item.name ||
                                  "See full evidence"}
                              </td>
                              <td>
                                {item.beforeVerdict ||
                                  item.rawVerdict ||
                                  "See full evidence"}
                              </td>
                              <td>
                                {item.afterVerdict ||
                                  item.currentVerdict ||
                                  "See full evidence"}
                              </td>
                              <td>
                                {typeof (
                                  item.currentOwnerAction || item.ownerAction
                                ) === "string"
                                  ? item.currentOwnerAction || item.ownerAction
                                  : item.currentOwnerAction?.action ||
                                    item.ownerAction?.action ||
                                    "See full evidence"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                <details>
                  <summary>Complete snapshot comparison evidence</summary>
                  <Evidence value={analysis} />
                </details>
              </>
            )}
          </section>
        )}
        {(tab === "Compare" || tab === "History") && report && (
          <section className="card">
            <h2 ref={reportHeading} tabIndex={-1}>
              Assignment owner report
            </h2>
            <p className="hint">
              <strong>{course?.title}</strong> · Generation{" "}
              {report.generation ?? "not recorded"} ·{" "}
              {report.result?.snapshotContext?.mode ||
                "Stage recorded in the complete report"}
            </p>
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
            <OwnerEvidence
              key={reportId || json(report.hashes || {})}
              result={report.result || {}}
              report={report}
              auditId={reportId}
              course={course}
              records={records}
              store={store}
              onSaved={() => refresh()}
              onOpenExtraction={(url) => {
                setExtractionPrefill(url || "");
                setTab("Extract");
                setNotice(
                  "Local Coursera extraction opened for this shell. Use the current extractor in your signed-in Chrome tab, then return its JSON here.",
                );
              }}
            />
            <details className="recorded-audit-overview">
              <summary>Recorded QA scores and publication blockers</summary>
              <ReportOverview result={report.result || {}} />
            </details>
            <details>
              <summary>Complete report and technical evidence</summary>
              <pre className="owner-report">
                {report.report || json(report.result)}
              </pre>
            </details>
            <EvidenceDetails
              title="Coursera-oriented owner view and item evidence"
              value={report.result?.ownerView || report.result}
            />
          </section>
        )}
        {tab === "Work queue" && (
          <section className="card">
            <h2>Owner work queue</h2>
            <p>
              Checklist ticks record work completed. They never alter evidence
              or QA verdicts.
            </p>
            <div className="queue-scope-note">
              <strong>This is the per-course evidence checklist.</strong>
              <span>
                For the Master Planner / catalog queue and CTI-generated next
                actions, open Operations.
              </span>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => setTab("Operations")}
              >
                Open planner queue →
              </button>
            </div>
            {course && checklist && (
              <>
                <h3 className="section-divider">{course.title}</h3>
                <div className="checklist-progress">
                  <strong>
                    {checklistCount} of {steps.length} workflow steps checked
                  </strong>
                  <progress
                    value={checklistCount}
                    max={steps.length}
                    aria-label="Checked workflow steps"
                  />
                  <small>
                    Recorded by the owner; this is not an evidence coverage
                    score.
                  </small>
                </div>
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
                    disabled={!editable || !!busy}
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
            <h3>Courses awaiting completion</h3>
            <label>
              Find queued course
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Course, partner or owner"
              />
            </label>
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
                    .filter(
                      (r) =>
                        r.data.status !== "Completed" &&
                        `${r.title} ${r.data.owner || ""} ${r.data.partner || ""}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            className="text-button"
                            disabled={!!busy}
                            onClick={() => void openCourse(r.id, "Work queue")}
                          >
                            {r.title}
                          </button>
                        </td>
                        <td>{r.data.owner || "Unassigned"}</td>
                        <td>{r.data.status}</td>
                        <td>{r.data.deadline || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {records.some((r) => r.kind === "checklist" && !r.packageId) && (
              <details>
                <summary>
                  Imported checklists awaiting course assignment
                </summary>
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
                              await store!.save({
                                ...full,
                                packageId: courseId,
                              }),
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
          <Suspense
            fallback={
              <section className="card" role="status" aria-live="polite">
                Loading Macmillan workspace…
              </section>
            }
          >
            <MacmillanWorkspace
              store={store}
              records={records}
              editable={editable}
              busy={busy}
              act={act}
              job={job}
              refresh={refresh}
              setNotice={setNotice}
            />
          </Suspense>
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
                  setPortfolio(
                    await job({ kind: "analytics", records: courses }),
                  ),
                )
              }
            >
              Analyse saved courses
            </button>
            {portfolio?.profiles && (
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
                    {portfolio.profiles.map((p: EvidenceObject) => (
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
            {portfolio && (
              <>
                <button
                  className="secondary"
                  onClick={() =>
                    download("CTI_portfolio_analysis.json", json(portfolio))
                  }
                >
                  Download analytics
                </button>
                <p className="hint">
                  {portfolio.note} Structural similarity and workload estimates
                  do not establish instructional quality or publication
                  readiness.
                </p>
                {!!portfolio.similarities?.length && (
                  <>
                    <h3>Closest structural matches</h3>
                    <p className="hint">
                      Top 20 pairs. The download includes all pairs retained by
                      the portfolio engine.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Course</th>
                            <th>Compared with</th>
                            <th>Similarity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...portfolio.similarities]
                            .sort((a, b) => b.similarity - a.similarity)
                            .slice(0, 20)
                            .map((pair: EvidenceObject, i: number) => (
                              <tr key={i}>
                                <td>
                                  {courses.find((c) => c.id === pair.left)
                                    ?.title || pair.left}
                                </td>
                                <td>
                                  {courses.find((c) => c.id === pair.right)
                                    ?.title || pair.right}
                                </td>
                                <td>
                                  {typeof pair.similarity === "number"
                                    ? pair.similarity.toFixed(3)
                                    : "Not recorded"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <details>
                  <summary>Full portfolio metrics and vectors</summary>
                  <Evidence value={portfolio} />
                </details>
              </>
            )}
          </section>
        )}
        {tab === "Operations" && (
          <Suspense
            fallback={
              <section className="card" role="status" aria-live="polite">
                Loading operations…
              </section>
            }
          >
            <OperationsWorkspace
              store={store}
              records={records}
              course={course}
              editable={editable}
              disabled={!!busy}
              onRefresh={() => refresh()}
              onCourseUpdate={(next) => {
                setCourse(next);
                setCourseId(next?.id || "");
                if (next) {
                  setPartner(next.data.partner || "");
                  setOwner(next.data.owner || "");
                  setStatus(next.data.status || "In Queue");
                  setAssignedDate(next.data.assignedDate || "");
                  setDeadline(next.data.deadline || "");
                  setDriveLink(next.data.driveLink || "");
                }
              }}
              onNotice={setNotice}
              onError={setError}
            />
          </Suspense>
        )}
        {tab === "Setup" && (
          <section className="card">
            <h2>Workspace access and migration</h2>
            <p>
              The shared service requires the D1 database and Cloudflare Access
              settings. An unconfigured service refuses access; it does not
              expose course records publicly.
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
                    resetWorkspaceSelection();
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
                    resetWorkspaceSelection();
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
            {(legacyPolicyRef ||
              legacyScanHistoryCount ||
              legacyDuplicateArchiveCount ||
              legacyCatalogMapCount) && (
              <div className="migration-continuity">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">MIGRATED APPS SCRIPT STATE</p>
                    <h3>Legacy operational history retained</h3>
                  </div>
                </div>
                <div className="migration-continuity-grid">
                  <div>
                    <strong>{legacyScanHistoryCount}</strong>
                    <span>source scan-history entries</span>
                  </div>
                  <div>
                    <strong>{legacyDuplicateArchiveCount}</strong>
                    <span>duplicate-archive entries</span>
                  </div>
                  <div>
                    <strong>{legacyCatalogMapCount}</strong>
                    <span>legacy catalog maps</span>
                  </div>
                </div>
                {legacyPolicyRef && (
                  <div className="legacy-policy-summary">
                    <strong>Previous Apps Script access rules are preserved.</strong>
                    <p>
                      Domain:{" "}
                      <code>
                        {legacyPolicyRef.data.authorizedDomain || "not set"}
                      </code>{" "}
                      · authorized-email entries:{" "}
                      {legacyPolicyRef.data.authorizedEmailCount || 0} · editor
                      entries: {legacyPolicyRef.data.editorEmailCount || 0}.
                      These values are migration evidence only; they never
                      modify Cloudflare Access automatically.
                    </p>
                    {store?.role === "admin" && (
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          void act("Loading legacy access policy", async () => {
                            const full = await store!.get(legacyPolicyRef.id);
                            setLegacyPolicyDetails(full.data);
                          })
                        }
                      >
                        Review legacy access rules
                      </button>
                    )}
                    {legacyPolicyDetails && (
                      <div className="legacy-policy-details">
                        <p>
                          <strong>Authorized emails</strong>
                          <br />
                          {(legacyPolicyDetails.authorizedEmails || []).join(", ") ||
                            "None recorded"}
                        </p>
                        <p>
                          <strong>Editors</strong>
                          <br />
                          {(legacyPolicyDetails.editorEmails || []).join(", ") ||
                            "None recorded"}
                        </p>
                        <p className="hint">
                          Map editors deliberately into <code>CTI_EDITORS</code>
                          and configure the Cloudflare Access allow policy
                          separately. CTI does not infer administrator access
                          from the old Apps Script list.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
              <strong>
                Import destination:{" "}
                {store?.mode === "team"
                  ? `Shared workspace (${store.email})`
                  : store
                    ? "This browser only — coworkers will not see these records"
                    : "Connect a workspace before importing"}
              </strong>
            </p>
            {migrationRecoveries.length > 0 && (
              <details open>
                <summary>
                  {migrationRecoveries.length} saved QA reports still need
                  recovery
                </summary>
                <p>
                  Migration remains incomplete for these reports. Keep the
                  original export. A completed import retains their available
                  original data in the migration backup.
                </p>
                <ul>
                  {migrationRecoveries.map((r) => (
                    <li key={r.id}>
                      <strong>
                        {courses.find((c) => c.id === r.packageId)?.title ||
                          "Course not linked"}
                      </strong>
                      <br />
                      <code>{r.data.sourceRunId}</code>: {r.data.issue?.reason}
                    </li>
                  ))}
                </ul>
                <button
                  className="secondary"
                  onClick={() =>
                    download(
                      "CTI_migration_recovery.json",
                      json({
                        kind: "CTI_MIGRATION_REVIEW",
                        schemaVersion: 1,
                        issues: migrationRecoveries.map((r) => r.data.issue),
                      }),
                    )
                  }
                >
                  Download saved migration issues
                </button>
              </details>
            )}
            <p>
              Use the existing app’s migration JSON or a backup from this
              workspace. Existing record IDs are preserved. Conflicts are
              skipped and reported, never overwritten.
            </p>
            <p>
              For a multipart export, select{" "}
              <strong>00_manifest.json and all part files together</strong> from
              one completed export folder. Single-file migrations and workspace
              backups are also supported.
            </p>
            <label>
              Workspace migration or backup JSON
              <input
                type="file"
                accept=".json"
                multiple
                disabled={!!busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  setImportPlan(null);
                  setAcceptMigrationGaps(false);
                  if (!files.length) return;
                  void act("Checking migration files", async () => {
                    const signal = controller.current!.signal;
                    const value = await readMigrationFiles(
                      files,
                      setImportProgress,
                      signal,
                    );
                    if (signal.aborted)
                      throw new Error(
                        "Migration check stopped. No records were saved.",
                      );
                    const plan =
                      value.kind === "CTI_BROWSER_WORKSPACE"
                        ? {
                            records: prepareWorkspaceBackup(value),
                            warnings: [],
                            issues: [],
                            legacyAccessPolicy: null,
                          }
                        : importLegacyWorkspace(value);
                    validateImportRecordSizes(plan.records);
                    if (signal.aborted)
                      throw new Error(
                        "Migration check stopped. No records were saved.",
                      );
                    setImportPlan(plan);
                  });
                }}
              />
            </label>
            {importPlan && (
              <>
                <p>
                  {importPlan.records.length} records prepared.{" "}
                  {importPlan.warnings.length} warnings.
                </p>
                <p>
                  {
                    importPlan.records.filter((r) => r.kind === "package")
                      .length
                  }{" "}
                  courses ·{" "}
                  {importPlan.records.filter((r) => r.kind === "audit").length}{" "}
                  complete QA reports ·{" "}
                  {
                    importPlan.records.filter((r) => r.kind === "workbook")
                      .length
                  }{" "}
                  workbooks · {importPlan.issues.length} unavailable QA reports.
                </p>
                {importPlan.legacyAccessPolicy && (
                  <p className="scope">
                    <strong>Legacy access policy found.</strong> CTI will retain
                    it for administrator review, but will not change Cloudflare
                    Access, <code>CTI_ADMINS</code>, or <code>CTI_EDITORS</code>
                    automatically.
                  </p>
                )}
                {importPlan.issues.length > 0 && (
                  <div className="migration-issues">
                    <h4>Some saved reports need recovery</h4>
                    <p>
                      These runs will not appear as complete reports or be used
                      in comparisons. Their history entries and available chunks
                      remain in the original-export backup. You can import the
                      valid records while keeping these issues open.
                    </p>
                    <ul>
                      {importPlan.issues.map((issue, i) => (
                        <li key={`${issue.runId}-${i}`}>
                          <strong>{issue.runId}</strong>: {issue.reason}
                        </li>
                      ))}
                    </ul>
                    <button
                      className="secondary"
                      onClick={() =>
                        download(
                          "CTI_migration_review.json",
                          json({
                            kind: "CTI_MIGRATION_REVIEW",
                            schemaVersion: 1,
                            issues: importPlan.issues,
                          }),
                        )
                      }
                    >
                      Download migration review
                    </button>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={acceptMigrationGaps}
                        disabled={!!busy}
                        onChange={(e) =>
                          setAcceptMigrationGaps(e.target.checked)
                        }
                      />
                      I understand these reports remain unavailable; import
                      valid records and retain recovery cases.
                    </label>
                  </div>
                )}
                {importPlan.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                <button
                  className="primary"
                  disabled={
                    !editable ||
                    !!busy ||
                    (importPlan.issues.length > 0 && !acceptMigrationGaps) ||
                    (store?.mode === "team" && store.role !== "admin")
                  }
                  onClick={() =>
                    void act("Importing workspace records", async () => {
                      if (importPlan.issues.length && !acceptMigrationGaps)
                        throw new Error(
                          "Review and acknowledge the unavailable reports before importing.",
                        );
                      validateImportRecordSizes(importPlan.records);
                      const existing = new Set(
                        (await store!.list()).map((r) => r.id),
                      );
                      let saved = 0,
                        skipped = 0;
                      try {
                        for (const r of importPlan.records) {
                          if (controller.current?.signal.aborted)
                            throw new Error("Import stopped by you.");
                          const position = `Record ${saved + skipped + 1} of ${importPlan.records.length}`;
                          setImportProgress(`${position}: ${r.title}`);
                          if (existing.has(r.id)) {
                            skipped++;
                            continue;
                          }
                          await store!.save(
                            { ...r, version: 0 },
                            {
                              signal: controller.current?.signal,
                              onProgress: (message) =>
                                setImportProgress(`${position}: ${message}`),
                              // Migration/backup restore must preserve historical
                              // duplicate rows so Operations can reconcile them
                              // losslessly. Normal package writes never set this.
                              allowSemanticDuplicate: true,
                            },
                          );
                          existing.add(r.id);
                          saved++;
                        }
                      } catch (e) {
                        try {
                          await refresh();
                        } catch {
                          /* Preserve the original failure. */
                        }
                        throw new Error(
                          `${e instanceof Error ? e.message : String(e)} ${saved} records saved; ${skipped} existing IDs skipped. Retry Import prepared records: saved IDs will be skipped.`,
                        );
                      }
                      await refresh();
                      setNotice(
                        `Imported ${saved} records; skipped ${skipped} existing IDs. Original backup data remains available.${importPlan.issues.length ? ` ${importPlan.issues.length} QA reports remain unavailable; see saved migration issues.` : ""}`,
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
      </div>
    </section>
  );
}
