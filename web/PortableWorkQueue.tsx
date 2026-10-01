import { useMemo, useState } from "react";
import {
  buildPortableWorkQueue,
  parseCatalogFile,
  parsePlannerFile,
  parseRuntimeFile,
} from "../src/domain/work-planner.ts";
import {
  newRecord,
  type WorkspaceStore,
} from "../src/domain/workspace-store.ts";
import type {
  EvidenceObject,
  WorkspaceRecord,
} from "../src/domain/workspace-types.ts";
import { partnerKey } from "../src/domain/package-identity.ts";
import { download, json } from "./workspace-ui";

type Act = (label: string, fn: () => Promise<void>) => Promise<void>;

const referenceKey = (subtype: string, partner: string) =>
  subtype + "|" + (subtype === "PLANNER" ? "" : partnerKey(partner));

const dateLabel = (value: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Not recorded";

export default function PortableWorkQueue({
  store,
  records,
  editable,
  busy,
  act,
  refresh,
  openCourse,
  setNotice,
}: {
  store: WorkspaceStore | null;
  records: WorkspaceRecord[];
  editable: boolean;
  busy: string;
  act: Act;
  refresh: () => Promise<void>;
  openCourse: (id: string, destination?: string) => Promise<void>;
  setNotice: (value: string) => void;
}) {
  const [partner, setPartner] = useState("NAIT");
  const [fromDate, setFromDate] = useState("2026-05-01");
  const [toDate, setToDate] = useState("2026-06-30");
  const [scanAfter, setScanAfter] = useState("2026-09-12");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [queue, setQueue] = useState<EvidenceObject | null>(null);

  const refs = useMemo(
    () =>
      records
        .filter((record) => record.kind === "reference-data")
        .sort((a, b) =>
          String(b.data.importedAt || b.updatedAt).localeCompare(
            String(a.data.importedAt || a.updatedAt),
          ),
        ),
    [records],
  );

  const latestSummary = (subtype: string, forPartner = partner) =>
    refs.find(
      (record) =>
        record.data.subtype === subtype &&
        (subtype === "PLANNER" ||
          partnerKey(record.data.partner) === partnerKey(forPartner)),
    );

  async function saveReference(
    subtype: "CATALOG" | "PLANNER" | "RUNTIME",
    sourceName: string,
    rows: EvidenceObject[],
    forPartner = partner,
  ) {
    if (!store) throw new Error("Connect a workspace before importing reference data.");
    const summary = latestSummary(subtype, forPartner);
    const importedAt = new Date().toISOString();
    const data = {
      subtype,
      partner: subtype === "PLANNER" ? "" : forPartner,
      sourceName,
      importedAt,
      rows,
    };
    const record = summary
      ? { ...(await store.get(summary.id)), title: "Reference · " + subtype + (subtype === "PLANNER" ? "" : " · " + forPartner), data }
      : newRecord(
          "reference-data",
          "Reference · " + subtype + (subtype === "PLANNER" ? "" : " · " + forPartner),
          data,
        );
    await store.save(record);
    await refresh();
    setQueue(null);
    setNotice(
      subtype +
        " reference imported: " +
        rows.length +
        " parsed row(s). Previous versions remain recoverable.",
    );
  }

  async function buildQueue() {
    if (!store) throw new Error("Connect a workspace before building the work queue.");
    const catalogSummary = latestSummary("CATALOG");
    const plannerSummary = latestSummary("PLANNER");
    const runtimeSummary = latestSummary("RUNTIME");
    if (!catalogSummary)
      throw new Error("Import the " + partner + " catalog before building the work queue.");
    if (!plannerSummary)
      throw new Error("Import the Master Planner before building the work queue.");
    const [catalog, planner, runtime] = await Promise.all([
      store.get(catalogSummary.id),
      store.get(plannerSummary.id),
      runtimeSummary ? store.get(runtimeSummary.id) : Promise.resolve(null),
    ]);
    const built = buildPortableWorkQueue({
      records,
      catalogRows: catalog.data.rows || [],
      plannerRows: planner.data.rows || [],
      runtimeRows: runtime?.data.rows || [],
      partner,
      fromDate,
      toDate,
      scanAfter,
    });
    setQueue(built);
  }

  const filteredItems = (queue?.items || []).filter(
    (item: EvidenceObject) =>
      !ownerFilter ||
      String(item.owner || "")
        .toLowerCase()
        .includes(ownerFilter.toLowerCase()),
  );

  return (
    <section className="section-divider portable-work-queue">
      <div className="section-heading">
        <div>
          <h3>Planner/catalog redo queue</h3>
          <p>
            This is the migrated Apps Script planner workflow. It uses exported
            catalog/planner files instead of SpreadsheetApp, so the queue remains
            zero-cost and reproducible.
          </p>
        </div>
        <span className="badge">Portable reference data</span>
      </div>

      <div className="settings">
        <label>
          Partner
          <select
            value={partner}
            disabled={!!busy}
            onChange={(event) => {
              setPartner(event.target.value);
              setQueue(null);
            }}
          >
            <option value="NAIT">NAIT</option>
            <option value="Marshall">Marshall</option>
          </select>
        </label>
        <label>
          Planner from
          <input
            type="date"
            value={fromDate}
            disabled={!!busy}
            onChange={(event) => {
              setFromDate(event.target.value);
              setQueue(null);
            }}
          />
        </label>
        <label>
          Planner to
          <input
            type="date"
            value={toDate}
            disabled={!!busy}
            onChange={(event) => {
              setToDate(event.target.value);
              setQueue(null);
            }}
          />
        </label>
        <label>
          Source scan cutoff
          <input
            type="date"
            value={scanAfter}
            disabled={!!busy}
            onChange={(event) => {
              setScanAfter(event.target.value);
              setQueue(null);
            }}
          />
        </label>
      </div>

      <div className="reference-import-grid">
        <label>
          {partner} catalog XLSX/CSV
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!editable || !!busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void act("Importing catalog reference", async () => {
                const parsed = await parseCatalogFile(file, partner);
                await saveReference(
                  "CATALOG",
                  parsed.sourceName || file.name,
                  parsed.rows,
                  partner,
                );
              });
            }}
          />
          <small>
            {latestSummary("CATALOG")
              ? latestSummary("CATALOG")?.data.rowCount +
                " rows · " +
                dateLabel(latestSummary("CATALOG")?.data.importedAt)
              : "Not imported"}
          </small>
        </label>
        <label>
          Master Planner XLSX/CSV
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!editable || !!busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void act("Importing planner reference", async () => {
                const parsed = await parsePlannerFile(file);
                await saveReference(
                  "PLANNER",
                  parsed.sourceName || file.name,
                  parsed.rows,
                  "",
                );
              });
            }}
          />
          <small>
            {latestSummary("PLANNER")
              ? latestSummary("PLANNER")?.data.rowCount +
                " rows · " +
                dateLabel(latestSummary("PLANNER")?.data.importedAt)
              : "Not imported"}
          </small>
        </label>
        <label>
          SCORM/Rise inventory XLSX/CSV
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!editable || !!busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void act("Importing runtime reference", async () => {
                const parsed = await parseRuntimeFile(file);
                await saveReference(
                  "RUNTIME",
                  parsed.sourceName || file.name,
                  parsed.rows,
                  partner,
                );
              });
            }}
          />
          <small>
            {latestSummary("RUNTIME")
              ? latestSummary("RUNTIME")?.data.rowCount +
                " rows · " +
                dateLabel(latestSummary("RUNTIME")?.data.importedAt)
              : "Optional · not imported"}
          </small>
        </label>
      </div>

      <div className="action-links">
        <button
          className="primary"
          disabled={!store || !!busy}
          onClick={() => void act("Building redo work queue", buildQueue)}
        >
          Build redo work queue
        </button>
        {queue && (
          <button
            className="secondary"
            onClick={() =>
              download(
                "CTI_redo_work_queue_" + partner.toLowerCase() + ".json",
                json(queue),
              )
            }
          >
            Download queue evidence
          </button>
        )}
      </div>

      {queue && (
        <>
          <div className="metric-grid portfolio-counts">
            <div>
              <strong>{queue.summary.confirmedTitles}</strong>
              <span>Confirmed titles</span>
            </div>
            <div>
              <strong>{queue.summary.needsUpload}</strong>
              <span>Need source upload</span>
            </div>
            <div>
              <strong>{queue.summary.needsRawAudit}</strong>
              <span>Need raw audit</span>
            </div>
            <div>
              <strong>{queue.summary.unresolvedPlannerSlots}</strong>
              <span>Unresolved planner slots</span>
            </div>
          </div>

          {!!queue.unresolvedGroups?.length && (
            <div className="migration-issues" role="alert">
              <h4>Planner assignments not mapped to a catalog title</h4>
              <p>
                These are unresolved assignment slots, not missing CTI courses.
                Fix the planner remarks/reference data before treating them as
                work-queue omissions.
              </p>
              <ul>
                {queue.unresolvedGroups.map((group: EvidenceObject) => (
                  <li key={group.assignmentDate + "|" + group.owner}>
                    {group.assignmentDate} · {group.owner} ·{" "}
                    {group.unresolvedTitleCount} unresolved of{" "}
                    {group.expectedTitleAssignments}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label>
            Filter by owner
            <input
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              placeholder="Owner name"
            />
          </label>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Owner</th>
                  <th>CTI source</th>
                  <th>Source scan</th>
                  <th>Raw QA</th>
                  <th>Runtime</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item: EvidenceObject) => (
                  <tr key={item.titleKey}>
                    <td>
                      <strong>{item.displayCode || item.titleKey}</strong>
                      <br />
                      <small>{item.title}</small>
                    </td>
                    <td>{item.owner || "Unassigned"}</td>
                    <td>
                      {item.ctiUuid ? (
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={() =>
                            void openCourse(item.ctiUuid, "Work queue")
                          }
                        >
                          {item.ctiMatchStatus}
                        </button>
                      ) : (
                        item.ctiMatchStatus
                      )}
                      {item.ctiCandidateCount > 1
                        ? " · " + item.ctiCandidateCount + " candidates"
                        : ""}
                    </td>
                    <td>{item.sourceRescanned ? "Current" : "Needs rescan"}</td>
                    <td>
                      {item.rawQaFresh
                        ? item.rawQaRecommendation || "Fresh"
                        : "No fresh raw audit"}
                    </td>
                    <td>
                      {Number(item.runtime?.riseCount || 0) +
                        Number(item.runtime?.storylineCount || 0) >
                      0
                        ? Number(item.runtime?.riseCount || 0) +
                          Number(item.runtime?.storylineCount || 0) +
                          " flagged"
                        : "None flagged"}
                    </td>
                    <td>
                      <strong>{item.nextAction?.code}</strong>
                      <br />
                      <small>{item.nextAction?.label}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
