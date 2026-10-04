import test from "node:test";
import assert from "node:assert/strict";
import {
  previewOperationalImport,
  suggestImportColumns,
} from "../src/domain/operational-import.ts";
import { buildPortableWorkQueue } from "../src/domain/operations.ts";
import { newRecord } from "../src/domain/workspace-store.ts";
const book = {
  name: "official-export.xlsx",
  sheets: {
    Readme: { values: [["Read this first"]] },
    Catalogue: {
      values: [
        ["Catalogue export"],
        [
          "Course Code",
          "NAIT Title",
          "IMSCC Name",
          "Assigned Owner",
          "Comments",
        ],
        [
          "TRDE120",
          "Introduction to Trades Math",
          "TRDE120_DEV_(NCE)_Introduction_to_Trades_Math.imscc",
          "Catalogue owner",
          "Review\nembedded resources",
        ],
        ["TRDE121", "Measurements", "TRDE121.imscc", "", false],
        ["TRDE122", "", "TRDE122.imscc", "", "Missing title"],
        [],
      ],
    },
  },
};
const selection = {
  sheet: "Catalogue",
  headerRow: 2,
  columns: suggestImportColumns("catalog", book.sheets.Catalogue.values[1]),
};
const planner = {
  name: "daily.xlsx",
  sheets: {
    Today: {
      values: [
        [
          "Assignment Date",
          "Partner",
          "Owner",
          "Course Code",
          "Title Count",
          "Remarks",
        ],
        ["10/04/2026", "NAIT", "Daily owner", "TRDE120", "", "Follow up"],
        ["2026-10-04", "NAIT", "Daily owner", "TRDE121", 0, ""],
        ["02/30/2026", "NAIT", "Daily owner", "TRDE122", 1, ""],
        ["2026-10-04", "NAIT", "Daily owner", "TRDE123", 1.5, ""],
        ["2026-10-04", "NAIT", "", "TRDE124", 1, ""],
      ],
    },
  },
};
const pselection = {
  sheet: "Today",
  headerRow: 1,
  columns: suggestImportColumns("planner", planner.sheets.Today.values[0]),
};
test("catalogue preview selects the actual sheet/header and preserves filename, comments and source rows", () => {
  const p = previewOperationalImport(book, "catalog", selection, "NAIT");
  assert.equal(p.rows.length, 2);
  assert.equal(p.inputRows, 3);
  assert.equal(p.blankRows, 1);
  assert.deepEqual(
    p.issues.map((x) => x.row),
    [5],
  );
  assert.equal(p.rows[0].sourceRow, 3);
  assert.equal(p.rows[0].sourceSheet, "Catalogue");
  assert.equal(p.rows[0].comments, "Review\nembedded resources");
  assert.equal(p.rows[1].comments, "false");
  assert.equal(p.rows[0].expectedFileName, book.sheets.Catalogue.values[2][2]);
  assert.equal(
    book.sheets.Catalogue.values[2][3],
    "Catalogue owner",
    "source workbook stays unchanged",
  );
});
test("ambiguous headings and invalid mappings never choose a silent first column", () => {
  assert.equal(
    suggestImportColumns("catalog", ["Title", "Course Title"])["Title"],
    -1,
  );
  assert.throws(
    () =>
      previewOperationalImport(
        book,
        "catalog",
        { ...selection, sheet: "Missing" },
        "NAIT",
      ),
    /worksheet/,
  );
  assert.throws(
    () =>
      previewOperationalImport(
        book,
        "catalog",
        { ...selection, headerRow: 0 },
        "NAIT",
      ),
    /header row/,
  );
  assert.throws(
    () =>
      previewOperationalImport(
        book,
        "catalog",
        { ...selection, columns: { ...selection.columns, Title: 99 } },
        "NAIT",
      ),
    /outside/,
  );
  assert.throws(
    () =>
      previewOperationalImport(
        book,
        "catalog",
        { ...selection, columns: { ...selection.columns, Title: 0 } },
        "NAIT",
      ),
    /only one/,
  );
  assert.throws(
    () => previewOperationalImport(book, "catalog", selection, ""),
    /partner/,
  );
});
test("planner preview rejects malformed dates, counts and missing owners; zero is distinct from unknown", () => {
  const p = previewOperationalImport(planner, "planner", pselection);
  assert.equal(p.rows.length, 2);
  assert.deepEqual(
    p.issues.map((x) => x.row),
    [4, 5, 6],
  );
  assert.equal(p.rows[0].assignmentDate, "2026-10-04");
  assert.equal(p.rows[0].totalTitleCount, null);
  assert.equal(p.rows[1].totalTitleCount, 0);
  assert.equal(p.rows[0].courseReference, "TRDE120");
  assert.match(p.warnings[0], /unknown title count/);
});
test("queue joins the explicit planner reference and catalogue IMSCC filename without overwriting owners", () => {
  const catalog = previewOperationalImport(
    book,
    "catalog",
    selection,
    "NAIT",
  ).rows;
  const planned = previewOperationalImport(planner, "planner", pselection).rows;
  const course = newRecord("package", "Internal title", {
    partner: "NAIT",
    owner: "Saved owner",
    scan: {
      fileName: catalog[0].expectedFileName,
      scannedAt: "2026-10-04T12:00:00Z",
    },
  });
  const queue = buildPortableWorkQueue({
    records: [course],
    catalog,
    planner: planned,
    runtime: [],
    partner: "NAIT",
    fromDate: "2026-10-04",
    toDate: "2026-10-04",
    scanAfter: "2026-10-01",
  });
  const item = queue.items.find((x) => x.displayCode === "TRDE120");
  assert.equal(item.ctiUuid, course.id);
  assert.equal(item.owner, "Daily owner");
  assert.equal(item.catalogOwner, "Catalogue owner");
  assert.equal(item.catalogComments, catalog[0].comments);
  assert.equal(item.catalogSourceRow, 3);
  assert.equal(course.data.owner, "Saved owner");
  assert.equal(queue.summary.plannerUnknownTitleCounts, 1);
  assert.equal(item.rawQaFresh, false, "mapping is not QA evidence");
  const duplicate = { ...course, id: "another" };
  const ambiguous = buildPortableWorkQueue({
    records: [course, duplicate],
    catalog,
    planner: planned,
    runtime: [],
    partner: "NAIT",
    fromDate: "2026-10-04",
    toDate: "2026-10-04",
    scanAfter: "2026-10-01",
  });
  assert.equal(ambiguous.items[0].ctiMatchStatus, "AMBIGUOUS");
  assert.equal(ambiguous.items[0].ctiUuid, "");
});

test("same-day conflicting planner owners remain a review task, regardless of row order", () => {
  const catalog = previewOperationalImport(
    book,
    "catalog",
    selection,
    "NAIT",
  ).rows;
  const row = previewOperationalImport(planner, "planner", pselection).rows[0];
  const args = {
    records: [],
    catalog,
    runtime: [],
    partner: "NAIT",
    fromDate: "2026-10-04",
    toDate: "2026-10-04",
    scanAfter: "2026-10-01",
  };
  for (const rows of [
    [row, { ...row, owner: "Other owner" }],
    [{ ...row, owner: "Other owner" }, row],
  ]) {
    const item = buildPortableWorkQueue({
      ...args,
      planner: rows,
      ownerFilter: "Daily owner",
    }).items[0];
    assert.equal(item.plannerOwnerConflict, true);
    assert.equal(item.nextAction.code, "RESOLVE_PLANNER_OWNER");
    assert.equal(item.owner, "Daily owner / Other owner");
  }
});
