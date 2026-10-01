import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPortableWorkQueue,
  parseCatalogBook,
  parsePlannerBook,
  parseRuntimeBook,
} from "../src/domain/work-planner.ts";
import { defaultCourseWorkState } from "../src/domain/work-state.ts";
import type { BookData } from "../src/adapters/workbook.ts";

const book = (name, rows): BookData => ({
  name,
  sheets: { Sheet1: { values: rows, display: rows.map((row) => row.map(String)) } },
});

test("portable NAIT catalog preserves owner disambiguation fields", () => {
  const parsed = parseCatalogBook(
    book("catalog.xlsx", [
      [
        "Title Code",
        "Title",
        "Coursera Product Type",
        "Assignment Owner",
        "Brightspace Access",
        "CC Package Access",
        "Import Status",
      ],
      ["BORL113", "Business", "Course", "Alice Smith", "Yes", "Complete", "Complete"],
      ["BORL113", "Business duplicate", "Course", "Bob Jones", "Yes", "Complete", "Pending"],
    ]),
    "NAIT",
  );
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].titleKey, "borl113");
  assert.equal(parsed.rows[0].expectedFileName, "BORL113.imscc");
  assert.equal(parsed.rows[1].owner, "Bob Jones");
});

test("portable Marshall catalog uses Common Cartridge File Name", () => {
  const parsed = parseCatalogBook(
    book("marshall.xlsx", [
      ["Common Cartridge File Name", "Title", "Assignment Owner"],
      ["TRDE120.imscc", "Trade 120", "Owner"],
    ]),
    "Marshall",
  );
  assert.equal(parsed.rows[0].titleKey, "trde120");
  assert.equal(parsed.rows[0].expectedFileName, "TRDE120.imscc");
});

test("planner parsing preserves expected title counts and remarks", () => {
  const parsed = parsePlannerBook(
    book("planner.xlsx", [
      [
        "Assignment Date",
        "Partner",
        "Content Ingestion Method",
        "Assignment Category",
        "Assignment Sub-Category",
        "Assignment Owner",
        "Total Title Count",
        "Status",
        "Assignment Owner Remarks",
      ],
      [
        "2026-05-20",
        "NAIT",
        "Smart Ingestion",
        "Import Only",
        "",
        "Alice Smith",
        3,
        "In Progress",
        "BORL113 CITC924",
      ],
    ]),
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].assignmentDate, "2026-05-20");
  assert.equal(parsed.rows[0].totalTitleCount, 3);
  assert.match(parsed.rows[0].remarks, /BORL113/);
});

test("runtime parsing treats yes-like labels as one runtime package", () => {
  const parsed = parseRuntimeBook(
    book("runtime.xlsx", [
      ["Coursecode", "Course Title", "RISE", "Storyline", "Link"],
      ["BORL113", "Business", "Yes", "2", "Open"],
    ]),
  );
  assert.equal(parsed.rows[0].riseCount, 1);
  assert.equal(parsed.rows[0].storylineCount, 2);
});

test("portable work queue keeps audit-existing-shell-first and explicit unresolved planner slots", () => {
  const catalog = parseCatalogBook(
    book("catalog.xlsx", [
      [
        "Title Code",
        "Title",
        "Coursera Product Type",
        "Assignment Owner",
        "Brightspace Access",
        "CC Package Access",
        "Import Status",
      ],
      ["BORL113", "Business", "Course", "Alice Smith", "Yes", "Complete", "Complete"],
      ["CITC924", "CITC", "Course", "Alice Smith", "Yes", "Complete", "Complete"],
    ]),
    "NAIT",
  ).rows;
  const planner = parsePlannerBook(
    book("planner.xlsx", [
      [
        "Assignment Date",
        "Partner",
        "Content Ingestion Method",
        "Assignment Category",
        "Assignment Sub-Category",
        "Assignment Owner",
        "Total Title Count",
        "Status",
        "Assignment Owner Remarks",
      ],
      [
        "2026-05-20",
        "NAIT",
        "Smart Ingestion",
        "Import Only",
        "",
        "Alice Smith",
        3,
        "In Progress",
        "BORL113 CITC924",
      ],
    ]),
  ).rows;
  const runtime = parseRuntimeBook(
    book("runtime.xlsx", [
      ["Coursecode", "Course Title", "RISE", "Storyline", "Link"],
      ["BORL113", "Business", "1", "0", "Open"],
    ]),
  ).rows;

  const records: any[] = [
    {
      id: "pkg-borl",
      kind: "package",
      title: "BORL 113",
      packageId: "",
      version: 1,
      updatedAt: "2026-09-20T00:00:00.000Z",
      updatedBy: "test",
      data: {
        partner: "NAIT",
        status: "In Progress",
        scan: {
          fileName: "B0RL-113 (2).imscc",
          scannedAt: "2026-09-20T00:00:00.000Z",
          stats: {},
        },
      },
    },
    {
      id: "audit-borl",
      kind: "audit",
      title: "Raw",
      packageId: "pkg-borl",
      version: 1,
      updatedAt: "2026-09-21T00:00:00.000Z",
      updatedBy: "test",
      data: {
        stage: "RAW_INGESTION",
        recommendationCode: "KEEP",
      },
    },
    {
      id: "check-borl",
      kind: "checklist",
      title: "BORL",
      packageId: "pkg-borl",
      version: 1,
      updatedAt: "2026-09-21T00:00:00.000Z",
      updatedBy: "test",
      data: {
        evidence: {},
        notes: "",
        workState: defaultCourseWorkState(),
      },
    },
  ];

  const queue = buildPortableWorkQueue({
    records,
    catalogRows: catalog,
    plannerRows: planner,
    runtimeRows: runtime,
    partner: "NAIT",
    fromDate: "2026-05-01",
    toDate: "2026-06-30",
    scanAfter: "2026-09-12",
  });

  assert.equal(queue.summary.confirmedTitles, 2);
  assert.equal(queue.summary.unresolvedPlannerSlots, 1);
  const borl = queue.items.find((item) => item.titleKey === "borl113");
  const citc = queue.items.find((item) => item.titleKey === "citc924");
  assert.equal(borl?.ctiMatchStatus, "MATCH");
  assert.equal(borl?.rawQaFresh, true);
  assert.equal(borl?.rawQaRecommendation, "KEEP");
  assert.equal(borl?.nextAction.code, "REVIEW_SCORM_EXISTING");
  assert.equal(citc?.nextAction.code, "UPLOAD_SOURCE");
});

test("catalog duplicate owner is resolved from planner owner when exactly one matches", () => {
  const catalog = parseCatalogBook(
    book("catalog.xlsx", [
      [
        "Title Code",
        "Title",
        "Coursera Product Type",
        "Assignment Owner",
        "CC Package Access",
        "Import Status",
      ],
      ["BORL113", "Business A", "Course", "Alice Smith", "Complete", "Complete"],
      ["BORL113", "Business B", "Course", "Bob Jones", "Complete", "Complete"],
    ]),
    "NAIT",
  ).rows;
  const planner = parsePlannerBook(
    book("planner.xlsx", [
      [
        "Assignment Date",
        "Partner",
        "Content Ingestion Method",
        "Assignment Category",
        "Assignment Owner",
        "Total Title Count",
        "Assignment Owner Remarks",
      ],
      [
        "2026-05-20",
        "NAIT",
        "Smart Ingestion",
        "Import Only",
        "Alice Smith",
        1,
        "BORL113",
      ],
    ]),
  ).rows;
  const queue = buildPortableWorkQueue({
    records: [],
    catalogRows: catalog,
    plannerRows: planner,
    partner: "NAIT",
    fromDate: "2026-05-01",
    toDate: "2026-06-30",
    scanAfter: "2026-09-12",
  });
  assert.equal(queue.items[0].catalogStatus, "MATCH");
  assert.equal(queue.items[0].title, "Business A");
});
