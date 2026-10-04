import OperationalImport, { OperationalRows } from "./OperationalImport";
import { matchesSearch } from "./SearchableSelect";
import type { BookData } from "../src/adapters/workbook";
import type {
  ImportSelection,
  OperationalPreview,
} from "../src/domain/operational-import";
import { useEffect, useMemo, useState, useRef } from "react";
import { readWorkbook, writeWorkbook } from "../src/adapters/workbook.ts";
import { scanPackage } from "../src/domain/package-scan.ts";
import {
  applyLineageRepairs,
  buildDuplicatePlan,
  buildPortableWorkQueue,
  deepArchitectureDiagnostics,
  deterministicPreflight,
  importRuntimeWorkbook,
  mergeDuplicateGroup,
  normalizePartnerName,
  normalizeWorkState,
  packageSemanticKey,
  partnerAnalytics,
  repeatedExportRepairCandidates,
  sourceManifestBook,
  systemHealth,
  validateCourseMetadata,
  validateDriveLink,
  type CatalogRow,
  type PlannerRow,
  type RuntimeInventoryRow,
} from "../src/domain/operations.ts";
import {
  newRecord,
  type WorkspaceStore,
} from "../src/domain/workspace-store.ts";
import type {
  WorkspaceRecord,
  EvidenceObject,
} from "../src/domain/workspace-types.ts";
import { CURRENT_PRODUCT_CAPABILITIES } from "../src/domain/product-capabilities.ts";
import { download, Evidence } from "./workspace-ui.tsx";

type Notice = (message: string) => void;
type Failure = (message: string) => void;
function originalSheetUrl(value: unknown) {
  try {
    return validateDriveLink(value);
  } catch {
    return "";
  }
}

export default function OperationsWorkspace({
  store,
  records,
  course,
  editable,
  disabled,
  onRefresh,
  onCourseUpdate,
  onNotice,
  onError,
}: {
  store: WorkspaceStore | null;
  records: WorkspaceRecord[];
  course: WorkspaceRecord | null;
  editable: boolean;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onCourseUpdate: (record: WorkspaceRecord | null) => void;
  onNotice: Notice;
  onError: Failure;
}) {
  const importSaving = useRef(false);
  const [pendingImport, setPendingImport] = useState<{
    book: BookData;
    type: "catalog" | "planner";
    partner: string;
    sourceHash: string;
  } | null>(null);
  const [inputQuery, setInputQuery] = useState("");
  const [queueQuery, setQueueQuery] = useState("");
  const [archiveQuery, setArchiveQuery] = useState("");
  const [duplicateQuery, setDuplicateQuery] = useState("");
  const [inspectedInput, setInspectedInput] = useState<WorkspaceRecord | null>(
    null,
  );
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [queue, setQueue] = useState<ReturnType<
    typeof buildPortableWorkQueue
  > | null>(null);
  const [partner, setPartner] = useState(course?.data.partner || "NAIT");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [scanAfter, setScanAfter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [repairCandidates, setRepairCandidates] = useState<
    ReturnType<typeof repeatedExportRepairCandidates>
  >([]);
  const [workState, setWorkState] = useState(() =>
    normalizeWorkState(course?.data.workState || {}),
  );

  useEffect(() => {
    setPartner(course?.data.partner || "NAIT");
    setWorkState(normalizeWorkState(course?.data.workState || {}));
  }, [course?.id, course?.version]);

  const activePackages = useMemo(
    () =>
      records.filter(
        (record) => record.kind === "package" && record.data.archived !== true,
      ),
    [records],
  );
  const archivedPackages = useMemo(
    () =>
      records.filter(
        (record) => record.kind === "package" && record.data.archived === true,
      ),
    [records],
  );
  const duplicatePlan = useMemo(() => buildDuplicatePlan(records), [records]);
  const health = useMemo(() => systemHealth(records), [records]);
  const analytics = useMemo(() => partnerAnalytics(records), [records]);
  const legacyOperationalRecords = useMemo(
    () =>
      records.filter(
        (record) =>
          record.kind === "operations" &&
          [
            "legacy-scan-history",
            "legacy-duplicate-archive",
            "legacy-catalog-map",
          ].includes(String(record.data.type || "")),
      ),
    [records],
  );
  const legacyScanHistoryCount = legacyOperationalRecords.filter(
    (record) => record.data.type === "legacy-scan-history",
  ).length;
  const legacyDuplicateArchiveCount = legacyOperationalRecords.filter(
    (record) => record.data.type === "legacy-duplicate-archive",
  ).length;
  const legacyCatalogMapCount = legacyOperationalRecords.filter(
    (record) => record.data.type === "legacy-catalog-map",
  ).length;
  const preflight = course?.data.scan
    ? deterministicPreflight(course.data.scan)
    : null;
  const architecture = course?.data.scan
    ? deepArchitectureDiagnostics(course.data.scan)
    : null;

  async function act(label: string, fn: () => Promise<void>) {
    if (!store) return;
    setBusy(label);
    setProgress("");
    onError("");
    try {
      await fn();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  async function importOperationFile(
    file: File,
    type: "catalog" | "planner" | "runtime-inventory",
    inputPartner = "",
  ) {
    await act("Importing operational input", async () => {
      if (file.size > 25 * 1024 * 1024)
        throw Error("Workbook exceeds the 25 MiB limit.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const book = readWorkbook(bytes, file.name);
      if (type !== "runtime-inventory") {
        if (type === "catalog" && !inputPartner.trim())
          throw Error("Enter the catalogue partner before importing.");
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const sourceHash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        setPendingImport({
          book,
          type,
          partner: inputPartner.trim(),
          sourceHash,
        });
        onNotice("Workbook loaded for review. No rows have been saved yet.");
        return;
      }
      const rows = importRuntimeWorkbook(book);
      if (!rows.length)
        throw new Error("The workbook contained no usable operational rows.");
      const saved = await store!.save(
        newRecord("operations", file.name, {
          type,
          partner: inputPartner.trim(),
          sourceName: file.name,
          importedAt: new Date().toISOString(),
          rows,
        }),
      );
      await onRefresh();
      onNotice(
        `Runtime inventory imported: ${rows.length} normalized row(s) · ${saved.id}.`,
      );
    });
  }

  async function saveReviewedImport(
    selection: ImportSelection,
    preview: OperationalPreview,
    sourceUrl: string,
  ) {
    if (!pendingImport || !editable || importSaving.current) return;
    importSaving.current = true;
    try {
      await act("Saving reviewed operational input", async () => {
        const { book, type, partner: inputPartner, sourceHash } = pendingImport;
        const url = validateDriveLink(sourceUrl);
        await store!.save(
          newRecord("operations", book.name, {
            type,
            partner: inputPartner,
            sourceName: book.name,
            sourceSheet: selection.sheet,
            sourceUrl: url,
            sourceHash,
            headerRow: selection.headerRow,
            columnMapping: selection.columns,
            importedAt: new Date().toISOString(),
            rows: preview.rows,
            importReview: {
              inputRows: preview.inputRows,
              skippedRows: preview.issues,
              warnings: preview.warnings,
            },
          }),
        );
        setPendingImport(null);
        await onRefresh();
        onNotice(
          `${type === "catalog" ? "Catalog" : "Planner"} imported: ${preview.rows.length} reviewed row(s).`,
        );
      });
    } finally {
      importSaving.current = false;
    }
  }

  async function latestOperations(type: string, inputPartner = "") {
    const candidates = records
      .filter(
        (record) =>
          record.kind === "operations" &&
          record.data.type === type &&
          (!inputPartner ||
            !record.data.partner ||
            normalizePartnerName(record.data.partner) ===
              normalizePartnerName(inputPartner)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!candidates.length) return null;
    return store!.get(candidates[0].id);
  }

  async function buildQueue() {
    await act("Building planner redo queue", async () => {
      const [catalogRecord, plannerRecord, runtimeRecord] = await Promise.all([
        latestOperations("catalog", partner),
        latestOperations("planner"),
        latestOperations("runtime-inventory", partner),
      ]);
      if (!catalogRecord)
        throw new Error("Import a catalog workbook for this partner first.");
      if (!plannerRecord)
        throw new Error("Import the Master Planner workbook first.");
      const fullAudits = await Promise.all(
        records
          .filter((record) => record.kind === "audit")
          .map((record) => store!.get(record.id)),
      );
      const fullPackages = await Promise.all(
        records
          .filter((record) => record.kind === "package")
          .map((record) => store!.get(record.id)),
      );
      const operations = records.filter(
        (record) =>
          record.kind === "operations" && record.data.type === "lineage-repair",
      );
      const fullRepairs = await Promise.all(
        operations.map((record) => store!.get(record.id)),
      );
      const repairedAudits = applyLineageRepairs(fullAudits, fullRepairs);
      const next = buildPortableWorkQueue({
        records: [
          ...fullPackages,
          ...repairedAudits,
          ...records.filter((record) => record.kind === "item-review"),
        ],
        catalog: catalogRecord.data.rows || [],
        planner: plannerRecord.data.rows || [],
        runtime: runtimeRecord?.data.rows || [],
        partner,
        fromDate,
        toDate,
        scanAfter,
        ownerFilter,
      });
      setQueue(next);
      onNotice(
        `Planner queue rebuilt from saved inputs: ${next.items.length} confirmed title(s), ${next.summary.unresolvedPlannerSlots || 0} unresolved planner slot(s).`,
      );
    });
  }

  async function saveWorkState() {
    if (!course) return;
    await act("Saving operational work state", async () => {
      const fresh = await store!.get(course.id);
      const saved = await store!.save({
        ...fresh,
        data: { ...fresh.data, workState: normalizeWorkState(workState) },
      });
      onCourseUpdate(saved);
      await onRefresh();
      onNotice("Operational workflow state saved with the course record.");
    });
  }

  async function reconcileDuplicate(
    groupId: string,
    expectedPlanToken: string,
  ) {
    await act("Reconciling duplicate package records", async () => {
      const freshSummaries = await store!.list();
      const freshPlan = buildDuplicatePlan(freshSummaries);
      if (freshPlan.planToken !== expectedPlanToken)
        throw new Error(
          "The package catalogue changed after this duplicate preview loaded. Review duplicates again.",
        );
      const summaryGroup = freshPlan.groups.find(
        (group) => group.id === groupId,
      );
      if (!summaryGroup)
        throw new Error("This duplicate group no longer exists.");
      if (!summaryGroup.safeToArchive)
        throw new Error(
          "Resolve the listed metadata conflicts before reconciling this group.",
        );
      const ids = [
        summaryGroup.survivor.id,
        ...summaryGroup.duplicates.map((record) => record.id),
      ];
      const full = await Promise.all(ids.map((id) => store!.get(id)));
      const fullPlan = buildDuplicatePlan(full);
      const group = fullPlan.groups[0];
      if (!group || group.id !== groupId)
        throw new Error("Duplicate identities changed during verification.");
      const merged = mergeDuplicateGroup(group);
      const savedSurvivor = await store!.save(merged.survivor);
      for (const archived of merged.archived) await store!.save(archived);
      if (course && ids.includes(course.id))
        onCourseUpdate(
          course.id === savedSurvivor.id ? savedSurvivor : savedSurvivor,
        );
      await onRefresh();
      onNotice(
        `Duplicate reconciliation preserved ${savedSurvivor.id} and soft-archived ${merged.archived.length} duplicate record(s). Nothing was deleted.`,
      );
    });
  }

  async function setArchived(record: WorkspaceRecord, archived: boolean) {
    await act(archived ? "Archiving course" : "Restoring course", async () => {
      const fresh = await store!.get(record.id);
      const saved = await store!.save({
        ...fresh,
        data: {
          ...fresh.data,
          archived,
          archivedAt: archived ? new Date().toISOString() : "",
          archivedReason: archived ? "OPERATOR_ARCHIVE" : "",
        },
      });
      if (course?.id === saved.id) onCourseUpdate(archived ? null : saved);
      await onRefresh();
      onNotice(
        archived
          ? "Course archived without deleting its evidence or history."
          : "Course restored to the active catalogue.",
      );
    });
  }

  async function applyRuntimeEvidence() {
    await act("Applying runtime inventory evidence", async () => {
      const runtimeRecord = await latestOperations(
        "runtime-inventory",
        partner,
      );
      if (!runtimeRecord)
        throw new Error("Import a runtime inventory for this partner first.");
      const rows = runtimeRecord.data.rows as RuntimeInventoryRow[];
      const byKey = new Map(rows.map((row) => [row.titleKey, row]));
      const matches = activePackages.filter(
        (record) =>
          normalizePartnerName(record.data.partner) ===
            normalizePartnerName(partner) &&
          byKey.has(
            packageSemanticKey(record.data.scan?.fileName || record.title),
          ),
      );
      let savedCount = 0;
      for (const summary of matches) {
        const fresh = await store!.get(summary.id);
        const key = packageSemanticKey(
          fresh.data.scan?.fileName || fresh.title,
        );
        const row = byKey.get(key)!;
        await store!.save({
          ...fresh,
          data: {
            ...fresh.data,
            externalRuntimeEvidence: {
              checked: true,
              required: row.riseCount + row.storylineCount > 0,
              riseCount: row.riseCount,
              storylineCount: row.storylineCount,
              linkLabel: row.linkLabel,
              courseCode: row.courseCode,
              title: row.title,
              source: runtimeRecord.data.sourceName || runtimeRecord.title,
              importedAt: runtimeRecord.data.importedAt,
              warning: "",
            },
          },
        });
        savedCount++;
      }
      await onRefresh();
      onNotice(
        `Applied explicit runtime inventory evidence to ${savedCount} matching active course(s).`,
      );
    });
  }

  async function bulkRescan(files: File[]) {
    await act("Bulk rescanning source packages", async () => {
      if (!files.length) return;
      const current = await store!.list();
      const active = current.filter(
        (record) => record.kind === "package" && record.data.archived !== true,
      );
      const results: string[] = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const key = packageSemanticKey(file.name);
        const matches = active.filter(
          (record) =>
            packageSemanticKey(record.data.scan?.fileName || record.title) ===
            key,
        );
        if (matches.length !== 1) {
          results.push(
            `${file.name}: ${matches.length ? "ambiguous match" : "no existing course match"}`,
          );
          continue;
        }
        setProgress(`${index + 1}/${files.length} · ${file.name}`);
        const scan = await scanPackage(file, (state) =>
          setProgress(
            `${index + 1}/${files.length} · ${file.name} · ${state.phase}`,
          ),
        );
        const fresh = await store!.get(matches[0].id);
        await store!.save({
          ...fresh,
          data: { ...fresh.data, scan },
        });
        results.push(`${file.name}: rescanned`);
      }
      await onRefresh();
      onNotice("Bulk rescan finished. " + results.join(" · "));
    });
  }

  async function loadRepairCandidates() {
    await act("Checking lineage repair candidates", async () => {
      if (!course) throw new Error("Select a source course first.");
      const audits = await Promise.all(
        records
          .filter(
            (record) =>
              record.kind === "audit" && record.packageId === course.id,
          )
          .map((record) => store!.get(record.id)),
      );
      const candidates = repeatedExportRepairCandidates(audits);
      setRepairCandidates(candidates);
      onNotice(
        candidates.length
          ? `${candidates.length} conservative repeated-export repair candidate(s) found. Nothing has been changed.`
          : "No conservative repeated-export repair candidates were found.",
      );
    });
  }

  async function confirmRepair(candidate: (typeof repairCandidates)[number]) {
    if (!course) return;
    await act("Recording lineage repair", async () => {
      const audits = await Promise.all(
        records
          .filter(
            (record) =>
              record.kind === "audit" && record.packageId === course.id,
          )
          .map((record) => store!.get(record.id)),
      );
      const fresh = repeatedExportRepairCandidates(audits).find(
        (entry) => entry.runId === candidate.runId,
      );
      if (!fresh)
        throw new Error(
          "This run is no longer eligible for conservative repeated-export repair.",
        );
      await store!.save(
        newRecord(
          "operations",
          "Lineage repair · " + candidate.runId,
          {
            type: "lineage-repair",
            runId: candidate.runId,
            previousRunId: candidate.previousRunId,
            fromGeneration: candidate.fromGeneration,
            toGeneration: candidate.toGeneration,
            confirmedAt: new Date().toISOString(),
            reason:
              "Operator confirmed no Smart Ingestion reimport occurred. Original immutable audit payload retained.",
          },
          course.id,
        ),
      );
      setRepairCandidates((current) =>
        current.filter((entry) => entry.runId !== candidate.runId),
      );
      await onRefresh();
      onNotice(
        "Lineage repair recorded as separate metadata. The original audit snapshot was not modified.",
      );
    });
  }

  function downloadManifest() {
    if (!course?.data.scan) return;
    const book = sourceManifestBook(course.data.scan);
    download(
      book.name,
      writeWorkbook(book),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  }

  if (!store)
    return (
      <section className="card">
        <h2>Operations</h2>
        <p className="empty-state">
          Connect a workspace before using operations.
        </p>
      </section>
    );

  return (
    <div className="operations-workspace">
      {(busy || progress) && (
        <div
          className="status workspace-progress"
          role="status"
          aria-live="polite"
        >
          <span className="pulse" />
          <div>
            <strong>{busy}</strong>
            {progress && <span>{progress}</span>}
          </div>
        </div>
      )}

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MIGRATION / OPERATIONS</p>
            <h2>Operational readiness</h2>
          </div>
          <span className="badge">{health.status}</span>
        </div>
        <p>
          These checks describe the active Cloudflare/TypeScript workspace. The
          frozen Apps Script files are reference evidence, not runtime code.
        </p>
        <div className="metric-grid">
          <div>
            <strong>{activePackages.length}</strong>
            <span>Active courses</span>
          </div>
          <div>
            <strong>{archivedPackages.length}</strong>
            <span>Archived courses</span>
          </div>
          <div>
            <strong>{duplicatePlan.groups.length}</strong>
            <span>Duplicate groups</span>
          </div>
          <div>
            <strong>{records.filter((r) => r.kind === "audit").length}</strong>
            <span>Immutable audits</span>
          </div>
        </div>
        <ul className="health-list">
          {health.checks.map((check) => (
            <li key={check.name}>
              <strong>
                {check.status} · {check.name}
              </strong>
              <span>{check.detail}</span>
            </li>
          ))}
        </ul>
        {!!legacyOperationalRecords.length && (
          <details>
            <summary>
              Migrated Apps Script operational history (
              {legacyOperationalRecords.length})
            </summary>
            <p className="hint">
              These records are historical provenance from the old workspace.
              They remain queryable and downloadable through workspace backups,
              but current planner/catalog inputs still control new operational
              decisions.
            </p>
            <div className="metric-grid">
              <div>
                <strong>{legacyScanHistoryCount}</strong>
                <span>Source scan-history rows</span>
              </div>
              <div>
                <strong>{legacyDuplicateArchiveCount}</strong>
                <span>Duplicate-archive rows</span>
              </div>
              <div>
                <strong>{legacyCatalogMapCount}</strong>
                <span>Catalog-map snapshots</span>
              </div>
            </div>
            {course && (
              <ul className="health-list">
                {legacyOperationalRecords
                  .filter((record) => record.packageId === course.id)
                  .slice(0, 20)
                  .map((record) => (
                    <li key={record.id}>
                      <strong>
                        {record.data.type} · {record.data.runId || record.title}
                      </strong>
                      <span>
                        {record.data.importedAt || "Date not recorded"} ·{" "}
                        {record.title}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </details>
        )}
        <details>
          <summary>Current product capability manifest</summary>
          <p className="hint">
            This describes the active product, not the historical engine feature
            flags retained for migration parity.
          </p>
          <ul className="health-list">
            {CURRENT_PRODUCT_CAPABILITIES.map((capability) => (
              <li key={capability.id}>
                <strong>
                  {capability.state} · {capability.label}
                </strong>
                <span>{capability.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="card">
        <h2>Portable operational inputs</h2>
        <p>
          Export the official catalogue or daily planner as XLSX, then review
          its worksheet and column mapping here. Imports are dated snapshots in
          this workspace; they do not change or automatically sync the original
          Sheet. Catalogue owners and comments remain separate from daily
          planner assignments.
        </p>
        <div className="settings">
          <label>
            Catalog partner
            <input
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
            />
          </label>
          <label>
            Partner catalog XLSX
            <input
              type="file"
              accept=".xlsx"
              disabled={!editable || disabled || !!busy || !!pendingImport}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importOperationFile(file, "catalog", partner);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <label>
            Master Planner XLSX
            <input
              type="file"
              accept=".xlsx"
              disabled={!editable || disabled || !!busy || !!pendingImport}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importOperationFile(file, "planner");
                e.currentTarget.value = "";
              }}
            />
          </label>
          <label>
            Runtime / RISE / Storyline inventory XLSX
            <input
              type="file"
              accept=".xlsx"
              disabled={!editable || disabled || !!busy || !!pendingImport}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void importOperationFile(file, "runtime-inventory", partner);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {pendingImport && (
          <OperationalImport
            book={pendingImport.book}
            kind={pendingImport.type}
            partner={pendingImport.partner}
            disabled={disabled || !!busy || !editable}
            onCancel={() => setPendingImport(null)}
            onSave={saveReviewedImport}
          />
        )}
        <button
          className="secondary"
          disabled={!editable || disabled || !!busy}
          onClick={() => void applyRuntimeEvidence()}
        >
          Apply latest runtime evidence to matching courses
        </button>
        <details>
          <summary>Saved operational inputs</summary>
          <label>
            Search saved operational inputs
            <input
              type="search"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="File, partner, worksheet or input type"
            />
          </label>
          <ul>
            {records
              .filter(
                (record) =>
                  record.kind === "operations" &&
                  matchesSearch(
                    inputQuery,
                    record.title,
                    record.data.type,
                    record.data.partner,
                    record.data.sourceSheet,
                  ),
              )
              .map((record) => (
                <li key={record.id}>
                  <strong>{record.data.type}</strong> · {record.title} ·{" "}
                  {record.data.rowCount ?? "metadata"} row(s) ·{" "}
                  {record.updatedAt || "not yet timestamped"}
                  {["catalog", "planner"].includes(record.data.type) && (
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() =>
                        void act("Opening imported rows", async () =>
                          setInspectedInput(await store!.get(record.id)),
                        )
                      }
                    >
                      Inspect {record.title}
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </details>
        {inspectedInput && (
          <section aria-label="Saved input details">
            <h3>{inspectedInput.title}</h3>
            <p>
              Imported{" "}
              {inspectedInput.data.importedAt || inspectedInput.updatedAt}. This
              is a saved snapshot.
            </p>
            {originalSheetUrl(inspectedInput.data.sourceUrl) && (
              <a
                href={originalSheetUrl(inspectedInput.data.sourceUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original sheet ↗
              </a>
            )}
            <OperationalRows
              key={inspectedInput.id}
              label="saved input"
              rows={inspectedInput.data.rows || []}
            />
            <button
              className="secondary"
              onClick={() => setInspectedInput(null)}
            >
              Close saved input
            </button>
          </section>
        )}
      </section>

      <section className="card">
        <h2>Planner redo queue</h2>
        <div className="settings">
          <label>
            Partner
            <input
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
            />
          </label>
          <label>
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <label>
            Rescan cutoff
            <input
              type="date"
              value={scanAfter}
              onChange={(e) => setScanAfter(e.target.value)}
            />
          </label>
          <label>
            Owner filter
            <input
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              placeholder="Optional exact owner"
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={disabled || !!busy || !fromDate || !toDate || !scanAfter}
          onClick={() => void buildQueue()}
        >
          Build queue from saved inputs
        </button>
        {queue && (
          <>
            <div className="metric-grid">
              {Object.entries(queue.summary).map(([key, value]) => (
                <div key={key}>
                  <strong>{value}</strong>
                  <span>{key.replace(/([A-Z])/g, " $1")}</span>
                </div>
              ))}
            </div>
            {!!queue.summary.plannerUnknownTitleCounts && (
              <p className="scope" role="status">
                Some planner title counts are unknown. The expected-assignment
                total includes only recorded counts and cannot prove that all
                assigned courses were identified.
              </p>
            )}
            {queue.unresolvedGroups.length > 0 && (
              <div className="migration-issues" role="status">
                <strong>Planner title slots remain unresolved</strong>
                <ul>
                  {queue.unresolvedGroups.map((group, index) => (
                    <li key={index}>
                      {group.assignmentDate} · {group.owner}:{" "}
                      {group.unresolvedTitleCount} unresolved of{" "}
                      {group.expectedTitleAssignments}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label>
              Search planner queue
              <input
                type="search"
                value={queueQuery}
                onChange={(e) => setQueueQuery(e.target.value)}
                placeholder="Course, filename, owner, comments or next action"
              />
            </label>
            <p role="status">
              {
                queue.items.filter((item) =>
                  matchesSearch(
                    queueQuery,
                    item.title,
                    item.displayCode,
                    item.expectedFileName,
                    item.owner,
                    item.catalogOwner,
                    item.catalogComments,
                    item.nextAction.label,
                  ),
                ).length
              }{" "}
              of {queue.items.length} queue items
            </p>
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Scrollable data table"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Owner</th>
                    <th scope="col">CTI source</th>
                    <th scope="col">Raw QA</th>
                    <th scope="col">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items
                    .filter((item) =>
                      matchesSearch(
                        queueQuery,
                        item.title,
                        item.displayCode,
                        item.expectedFileName,
                        item.owner,
                        item.catalogOwner,
                        item.catalogComments,
                        item.nextAction.label,
                      ),
                    )
                    .map((item) => (
                      <tr key={item.titleKey}>
                        <td>
                          <strong>{item.displayCode}</strong>
                          <br />
                          <small>{item.title}</small>
                          <small>{item.expectedFileName}</small>
                          {item.catalogComments && (
                            <p className="preserve-lines">
                              Catalogue comments: {item.catalogComments}
                            </p>
                          )}
                          <small>
                            {item.catalogSourceRow
                              ? `${item.catalogSourceSheet || "Catalogue"} · row ${item.catalogSourceRow}`
                              : "Catalogue row unresolved"}
                          </small>
                        </td>
                        <td>
                          Planner: {item.owner}
                          <small>
                            Catalogue: {item.catalogOwner || "Unassigned"}
                          </small>
                          {item.catalogOwner &&
                            item.owner.trim().toLowerCase() !==
                              item.catalogOwner.trim().toLowerCase() && (
                              <small>Owners differ — review assignment</small>
                            )}
                        </td>
                        <td>
                          {item.ctiMatchStatus}
                          {item.ctiCandidateCount > 1
                            ? ` · ${item.ctiCandidateCount} candidates`
                            : ""}
                        </td>
                        <td>
                          {item.rawQaFresh
                            ? item.rawQaRecommendation.code
                            : "No fresh raw audit"}
                        </td>
                        <td>
                          <strong>{item.nextAction.label}</strong>
                          {item.ctiUuid && (
                            <>
                              <br />
                              <code>{item.ctiUuid}</code>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Selected course operations</h2>
        {!course ? (
          <p className="empty-state">
            Select an active course above to run preflight, export its manifest,
            manage workflow state or inspect lineage.
          </p>
        ) : (
          <>
            <h3>{course.title}</h3>
            {preflight && (
              <div
                className={
                  preflight.verdict === "BLOCKED"
                    ? "migration-issues"
                    : "success-notice"
                }
                role="status"
              >
                <strong>{preflight.verdict}</strong>
                <p>{preflight.message}</p>
              </div>
            )}
            <div className="action-links">
              <button
                className="secondary"
                disabled={!!busy}
                onClick={downloadManifest}
              >
                Download Master Manifest XLSX
              </button>
              <button
                className="secondary"
                disabled={!editable || !!busy}
                onClick={() => void setArchived(course, true)}
              >
                Archive course
              </button>
            </div>
            {architecture && (
              <details>
                <summary>Deterministic architecture diagnostics</summary>
                <p className="hint">
                  These are structural diagnostics, not an AI verdict and not
                  evidence that content was lost.
                </p>
                <Evidence value={architecture} />
              </details>
            )}

            <h3>Workflow state</h3>
            <p className="hint">
              Use Assignment plan for source reconciliation and content-map
              approval. These operational statuses record progress; a legacy
              PASS or DONE does not establish current evidence readiness.
              Specializations follow content map → approval → linked outline.
              Direct course outlines skip the map.
            </p>
            <div className="settings">
              <label>
                Scope
                <select
                  aria-label="Scope"
                  value={workState.scope}
                  onChange={(e) =>
                    setWorkState(
                      normalizeWorkState({
                        ...workState,
                        scope: e.target.value,
                      }),
                    )
                  }
                >
                  <option>ACTIVE</option>
                  <option>EXCLUDED</option>
                </select>
              </label>
              <label>
                Coursera redo
                <select
                  aria-label="Coursera redo"
                  value={workState.courseraRedo}
                  onChange={(e) =>
                    setWorkState(
                      normalizeWorkState({
                        ...workState,
                        courseraRedo: e.target.value,
                      }),
                    )
                  }
                >
                  {[
                    "NOT_STARTED",
                    "IN_PROGRESS",
                    "DONE",
                    "NOT_REQUIRED",
                    "BLOCKED",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Course outline
                <select
                  aria-label="Course outline"
                  value={workState.courseOutline}
                  onChange={(e) =>
                    setWorkState(
                      normalizeWorkState({
                        ...workState,
                        courseOutline: e.target.value,
                      }),
                    )
                  }
                >
                  {["NOT_STARTED", "DRAFT", "SECURED", "BLOCKED"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Source audit
                <select
                  aria-label="Source audit"
                  value={workState.sourceAudit}
                  onChange={(e) =>
                    setWorkState(
                      normalizeWorkState({
                        ...workState,
                        sourceAudit: e.target.value,
                      }),
                    )
                  }
                >
                  {["NOT_STARTED", "PASS", "REVIEW", "BLOCKED"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Specialization outline
                <select
                  aria-label="Specialization outline"
                  value={workState.specializationOutline}
                  onChange={(e) =>
                    setWorkState(
                      normalizeWorkState({
                        ...workState,
                        specializationOutline: e.target.value,
                      }),
                    )
                  }
                >
                  {["NOT_STARTED", "DRAFT", "SECURED", "BLOCKED"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Content map
                <select
                  aria-label="Content map"
                  value={workState.contentMap}
                  onChange={(e) =>
                    setWorkState(
                      normalizeWorkState({
                        ...workState,
                        contentMap: e.target.value,
                      }),
                    )
                  }
                >
                  {["NOT_STARTED", "IN_PROGRESS", "DONE", "BLOCKED"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <label>
              Operational notes
              <textarea
                aria-label="Operational notes"
                maxLength={4000}
                value={workState.notes}
                onChange={(e) =>
                  setWorkState({ ...workState, notes: e.target.value })
                }
              />
            </label>
            <button
              className="primary"
              disabled={!editable || disabled || !!busy}
              onClick={() => void saveWorkState()}
            >
              Save workflow state
            </button>

            <h3>Lineage repair</h3>
            <p className="hint">
              CTI only proposes a repair when two consecutive raw snapshots have
              different XLSX hashes but identical retained item evidence. The
              original audit remains immutable; confirmation creates separate
              repair metadata.
            </p>
            <button
              className="secondary"
              disabled={!editable || !!busy}
              onClick={() => void loadRepairCandidates()}
            >
              Check repeated-export candidates
            </button>
            {repairCandidates.map((candidate) => (
              <div className="migration-issues" key={candidate.runId}>
                <strong>
                  {candidate.runId}: G{candidate.fromGeneration} → G
                  {candidate.toGeneration}
                </strong>
                <p>{candidate.reason}</p>
                <button
                  className="secondary"
                  disabled={!editable || !!busy}
                  onClick={() => void confirmRepair(candidate)}
                >
                  Confirm no Smart Ingestion reimport
                </button>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="card">
        <h2>Duplicate reconciliation</h2>
        <p>
          CTI groups active source records by partner and the legacy semantic
          filename rules. Reconciliation is previewed, version checked and
          lossless: duplicates are soft-archived rather than deleted.
        </p>
        <label>
          Search duplicate groups
          <input
            type="search"
            value={duplicateQuery}
            onChange={(e) => setDuplicateQuery(e.target.value)}
          />
        </label>
        {!duplicatePlan.groups.length ? (
          <p className="success-notice">
            No active semantic duplicate groups found.
          </p>
        ) : (
          duplicatePlan.groups
            .filter((group) =>
              matchesSearch(duplicateQuery, group.partner, group.canonicalName),
            )
            .map((group) => (
              <details key={group.id}>
                <summary>
                  {group.partner} · {group.canonicalName} ·{" "}
                  {group.duplicates.length + 1} records
                </summary>
                <p>
                  Survivor: <code>{group.survivor.id}</code> · latest scan:{" "}
                  <code>{group.latestScan.id}</code>
                </p>
                <p>
                  Scan evidence differs: {group.scanDataDiffers ? "yes" : "no"}.
                </p>
                {group.conflictFields.length > 0 && (
                  <p role="alert">
                    Metadata conflicts: {group.conflictFields.join(", ")}.
                    Resolve these before reconciliation.
                  </p>
                )}
                <button
                  className="secondary"
                  disabled={!editable || !!busy || !group.safeToArchive}
                  onClick={() =>
                    void reconcileDuplicate(group.id, duplicatePlan.planToken)
                  }
                >
                  Preserve survivor and archive duplicates
                </button>
              </details>
            ))
        )}
        {archivedPackages.length > 0 && (
          <details>
            <summary>
              {archivedPackages.length} archived course record(s)
            </summary>
            <label>
              Search archived courses
              <input
                type="search"
                value={archiveQuery}
                onChange={(e) => setArchiveQuery(e.target.value)}
              />
            </label>
            <ul>
              {archivedPackages
                .filter((record) =>
                  matchesSearch(
                    archiveQuery,
                    record.title,
                    record.id,
                    record.data.partner,
                    record.data.owner,
                  ),
                )
                .map((record) => (
                  <li key={record.id}>
                    {record.title} · <code>{record.id}</code>{" "}
                    <button
                      className="text-button"
                      disabled={!editable || !!busy}
                      onClick={() => void setArchived(record, false)}
                    >
                      Restore {record.title}
                    </button>
                  </li>
                ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <h2>Bulk rescan</h2>
        <p>
          Select existing IMSCC/ZIP/XML files. CTI only updates files with one
          unambiguous active semantic course match; missing or ambiguous files
          are reported and never create or overwrite a course automatically.
        </p>
        <label>
          Source packages to rescan
          <input
            type="file"
            multiple
            accept=".imscc,.zip,.xml"
            disabled={!editable || disabled || !!busy}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) void bulkRescan(files);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </section>

      <section className="card">
        <h2>Partner portfolio</h2>
        <div className="metric-grid">
          <div>
            <strong>{analytics.totalPackages}</strong>
            <span>Active packages</span>
          </div>
          <div>
            <strong>{analytics.duplicateSummary.groupCount}</strong>
            <span>Duplicate groups</span>
          </div>
          <div>
            <strong>{analytics.duplicateSummary.duplicateEntryCount}</strong>
            <span>Duplicate records</span>
          </div>
          <div>
            <strong>{analytics.owners.length}</strong>
            <span>Owners</span>
          </div>
        </div>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Scrollable data table"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Partner</th>
                <th scope="col">Packages</th>
                <th scope="col">Items</th>
                <th scope="col">Assessments</th>
                <th scope="col">LTI</th>
                <th scope="col">Avg IFS</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(analytics.partners).map(([name, value]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{value.packageCount}</td>
                  <td>{value.totalWebContent}</td>
                  <td>{value.totalAssessments}</td>
                  <td>{value.totalLtiRisk}</td>
                  <td>{value.avgIFS}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
