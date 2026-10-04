import SearchableSelect from "./SearchableSelect";
import { useEffect, useState } from "react";
import EvidenceDetails from "./EvidenceDetails";
import { newRecord, type WorkspaceStore } from "../src/domain/workspace-store";
import { writeWorkbook, type BookData } from "../src/adapters/workbook";
import type {
  WorkspaceRecord,
  EvidenceObject,
  WorkflowJob,
} from "../src/domain/workspace-types";
import { download, inputFile, Evidence, FileField } from "./workspace-ui";

type Props = {
  store: WorkspaceStore | null;
  records: WorkspaceRecord[];
  editable: boolean;
  busy: string;
  act: (label: string, run: () => Promise<void>) => Promise<void>;
  job: (job: WorkflowJob) => Promise<EvidenceObject>;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
};
export default function MacmillanWorkspace({
  store,
  records,
  editable,
  busy,
  act,
  job,
  refresh,
  setNotice,
}: Props) {
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
  function resetBookInputs() {
    setAnchors([]);
    setSpecNames({});
    setApproved([]);
    setTriage(false);
    setQaFile(null);
    setStage("Metadata");
    setSpec(1);
    setMacResult(null);
  }

  useEffect(() => {
    resetBookInputs();
    setBook(null);
    setBookRecord(null);
    setMaster(null);
    setMasterResult(null);
  }, [store]);
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
    <section className="card">
      <h2>Macmillan workbook workflow</h2>
      <p>
        Inspect and split the source workbook, then QA externally created
        Metadata, Merged and ContentMap workbooks against the preserved
        baseline. CTI does not generate those documents.
      </p>
      <h3>1. Scan or resume a source master</h3>
      <SearchableSelect
        label="Resume saved workbook"
        value={bookRecord?.id || ""}
        disabled={!!busy}
        emptyLabel="Choose workbook"
        options={records
          .filter((r) => r.kind === "workbook")
          .map((r) => ({ value: r.id, label: r.title }))}
        onChange={(value) => {
          if (value)
            void act("Opening workbook", async () => {
              const r = await store!.get(value);
              resetBookInputs();
              setBookRecord(r);
              setBook(r.data.book);
              setMasterResult(r.data.masterResult);
              setMacResult(null);
            });
        }}
      />
      <FileField
        label="New source master XLSX"
        disabled={!!busy || !editable}
        accept=".xlsx"
        file={master}
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
            resetBookInputs();
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
          <p className="success-notice">
            <strong>
              Current source workbook: {bookRecord?.title || book.name}
            </strong>
            <br />
            {
              Object.keys(book.sheets).filter((n) => /^Spec\d_Clean$/.test(n))
                .length
            }{" "}
            prepared specialization baselines
          </p>
          <h3>2. Choose specialization boundaries</h3>
          <p>
            Select one to four Level 1 start rows. Source order is preserved.
          </p>
          {(masterResult?.filteredModules || []).map((m: EvidenceObject) => (
            <div className="anchor-row" key={m.excelRow}>
              <label>
                <input
                  type="checkbox"
                  disabled={!!busy || !editable}
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
                  disabled={!!busy || !editable}
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
          ))}
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
                    disabled={!!busy || !editable}
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
              <EvidenceDetails
                title="Full inclusion review evidence"
                value={macResult?.triageData}
              />
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
          <h3 className="section-divider">3. Validate an external output</h3>
          <p className="hint">
            Validate Metadata, then Merged, then ContentMap against the prepared
            specialization. The original source and earlier accepted tabs remain
            available in the full workbook.
          </p>
          {!book.sheets[`Spec${spec}_Clean`] && (
            <p className="scope">
              Prepare and save a specialization above before validating its
              external outputs.
            </p>
          )}
          <div className="settings">
            <label>
              Stage
              <select
                disabled={!!busy || !editable}
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value);
                  setQaFile(null);
                  setMacResult(null);
                }}
              >
                {["Metadata", "Merged", "ContentMap"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Specialization
              <select
                disabled={!!busy || !editable}
                value={spec}
                onChange={(e) => {
                  setSpec(Number(e.target.value));
                  setQaFile(null);
                  setMacResult(null);
                }}
              >
                {[1, 2, 3, 4]
                  .filter((n) => book.sheets[`Spec${n}_Clean`])
                  .map((n) => (
                    <option key={n}>{n}</option>
                  ))}
              </select>
            </label>
            <FileField
              key={`${bookRecord?.id}-${stage}-${spec}`}
              label="Output XLSX to validate"
              disabled={!!busy || !editable}
              accept=".xlsx"
              file={qaFile}
              onChange={setQaFile}
            />
          </div>
          <button
            className="primary"
            disabled={
              !editable ||
              !!busy ||
              !qaFile ||
              !book.sheets[`Spec${spec}_Clean`]
            }
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
          {macResult && (
            <section className="validation-result">
              <h3>
                {macResult.isTriage
                  ? "Inclusion review required"
                  : macResult.success
                    ? "Validation finished"
                    : "Validation needs attention"}
              </h3>
              {macResult.error && <p className="error">{macResult.error}</p>}
              {macResult.expectedCount != null && (
                <p>
                  Expected rows: {macResult.expectedCount} · Found:{" "}
                  {macResult.foundCount ?? "Not recorded"}
                </p>
              )}
              {macResult.metrics?.ctiVerdict && (
                <p>
                  <strong>{macResult.metrics.ctiVerdict}</strong>
                </p>
              )}
              {macResult.warnings?.length > 0 && (
                <ul>
                  {macResult.warnings.map((w: string, i: number) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <details>
                <summary>Complete validation evidence</summary>
                <Evidence value={macResult} />
              </details>
            </section>
          )}
        </>
      )}
    </section>
  );
}
