import type { BookData, Cell } from "../adapters/workbook.ts";
import {
  importCatalogWorkbook,
  importPlannerWorkbook,
  validateDateOnly,
  type CatalogRow,
  type PlannerRow,
} from "./operations.ts";

export type OperationalImportKind = "catalog" | "planner";
export const IMPORT_FIELDS = {
  catalog: [
    ["Title", "Course Title", "NAIT Title", "Marshall Title"],
    ["Title Code", "Course Code"],
    [
      "Common Cartridge File Name",
      "IMSCC Name",
      "IMSCC File Name",
      "Filename",
      "File Name",
    ],
    ["Assignment Owner", "Assigned Owner", "Owner"],
    ["Comments", "Comment", "Remarks", "Notes"],
    ["Coursera Product Type", "Product Type"],
    ["Brightspace Access"],
    ["CC Package Access"],
    ["Import Status"],
  ],
  planner: [
    ["Assignment Date", "Assignment Date [mm/dd/yyyy]"],
    ["Partner", "University"],
    ["Assignment Owner", "Assigned Owner", "Owner"],
    [
      "Course Reference",
      "Title Code",
      "Course Code",
      "Common Cartridge File Name",
      "IMSCC Name",
      "IMSCC File Name",
    ],
    ["Assignment Owner Remarks", "Remarks", "Comments", "Notes"],
    ["Total Title Count", "Title Count"],
    ["Content Ingestion Method", "Ingestion Method"],
    ["Assignment Category", "Category"],
    ["Assignment Sub-Category", "Sub-Category"],
    ["Status"],
  ],
} satisfies Record<OperationalImportKind, string[][]>;
export interface ImportSelection {
  sheet: string;
  headerRow: number;
  columns: Record<string, number>;
}
const normalize = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export function suggestImportColumns(
  kind: OperationalImportKind,
  headers: Cell[],
) {
  const mapping: Record<string, number> = {};
  for (const aliases of IMPORT_FIELDS[kind]) {
    const matches = headers.flatMap((cell, index) =>
      aliases.some((alias) => normalize(alias) === normalize(cell))
        ? [index]
        : [],
    );
    // Duplicate headings must be resolved by the operator, never first-wins.
    mapping[aliases[0]] = matches.length === 1 ? matches[0] : -1;
  }
  return mapping;
}
function plannerDate(value: Cell): string {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 2958466
  ) {
    return new Date(Math.round((value - 25569) * 86400000))
      .toISOString()
      .slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text))
    return validateDateOnly(text, "Assignment date");
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m)
    return validateDateOnly(
      `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`,
      "Assignment date",
    );
  throw Error(
    "Use an Excel date, YYYY-MM-DD, or MM/DD/YYYY for the assignment date.",
  );
}
export interface OperationalPreview {
  rows: (CatalogRow | PlannerRow)[];
  issues: { row: number; message: string }[];
  warnings: string[];
  blankRows: number;
  inputRows: number;
}
export function previewOperationalImport(
  book: BookData,
  kind: OperationalImportKind,
  selection: ImportSelection,
  partner = "",
): OperationalPreview {
  const sheet = book.sheets[selection.sheet];
  if (
    !sheet ||
    !Number.isInteger(selection.headerRow) ||
    selection.headerRow < 1 ||
    selection.headerRow >= sheet.values.length
  )
    throw Error("Choose a worksheet and a header row followed by data rows.");
  if (kind === "catalog" && !partner.trim())
    throw Error("Enter the catalogue partner.");
  const fields = IMPORT_FIELDS[kind].map((aliases) => aliases[0]);
  const headers = sheet.values[selection.headerRow - 1] || [];
  const indices = fields.map((field) => selection.columns[field] ?? -1);
  if (
    indices.some((i) => !Number.isInteger(i) || i < -1 || i >= headers.length)
  )
    throw Error("A column mapping is outside the selected header row.");
  const used = indices.filter((i) => i >= 0);
  if (new Set(used).size !== used.length)
    throw Error("Each source column can be mapped to only one field.");
  const mapped = (field: string) => (selection.columns[field] ?? -1) >= 0;
  if (
    kind === "catalog" &&
    (!mapped("Title") ||
      !(mapped("Title Code") || mapped("Common Cartridge File Name")))
  )
    throw Error(
      "Map Title and either Title Code or Common Cartridge File Name.",
    );
  if (
    kind === "planner" &&
    ["Assignment Date", "Partner", "Assignment Owner"].some((f) => !mapped(f))
  )
    throw Error("Map Assignment Date, Partner and Assignment Owner.");
  const result: OperationalPreview = {
    rows: [],
    issues: [],
    warnings: [],
    blankRows: 0,
    inputRows: 0,
  };
  for (let index = selection.headerRow; index < sheet.values.length; index++) {
    const source = sheet.values[index] || [];
    if (source.every((cell) => !String(cell ?? "").trim())) {
      result.blankRows++;
      continue;
    }
    result.inputRows++;
    const row = indices.map((i) => (i < 0 ? "" : (source[i] ?? "")));
    const cell = (field: string) => row[fields.indexOf(field)];
    try {
      if (
        kind === "catalog" &&
        (!String(cell("Title")).trim() ||
          !(
            String(cell("Title Code")).trim() ||
            String(cell("Common Cartridge File Name")).trim()
          ))
      )
        throw Error("Missing title or course code / IMSCC filename.");
      if (kind === "planner") {
        row[fields.indexOf("Assignment Date")] = plannerDate(
          cell("Assignment Date"),
        );
        if (
          !String(cell("Partner")).trim() ||
          !String(cell("Assignment Owner")).trim()
        )
          throw Error("Missing partner or assignment owner.");
        const count = cell("Total Title Count");
        if (
          String(count).trim() &&
          (typeof count === "boolean" ||
            !Number.isSafeInteger(Number(count)) ||
            Number(count) < 0)
        )
          throw Error(
            "Total Title Count must be a non-negative whole number or blank (unknown).",
          );
      }
      // Only mapped headers are passed to the legacy-compatible parsers. Missing
      // optional fields must not acquire a guessed column.
      const mappedHeaders = fields.filter((_, i) => indices[i] >= 0);
      const mappedRow = row.filter((_, i) => indices[i] >= 0);
      const normalized: BookData = {
        name: book.name,
        sheets: { input: { values: [mappedHeaders, mappedRow] } },
      };
      const parsed =
        kind === "catalog"
          ? importCatalogWorkbook(normalized, partner.trim())
          : importPlannerWorkbook(normalized);
      if (parsed.length !== 1)
        throw Error("Row could not be imported; check its required fields.");
      result.rows.push({
        ...parsed[0],
        sourceRow: index + 1,
        sourceSheet: selection.sheet,
      });
    } catch (e) {
      result.issues.push({
        row: index + 1,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const unknown = result.rows.filter(
    (row) => "totalTitleCount" in row && row.totalTitleCount === null,
  ).length;
  if (unknown)
    result.warnings.push(
      `${unknown} assignment row(s) have an unknown title count. Queue totals cannot establish that all assigned courses were identified.`,
    );
  if (
    kind === "planner" &&
    !mapped("Course Reference") &&
    !mapped("Assignment Owner Remarks")
  )
    result.warnings.push(
      "No course reference or remarks column is mapped. Assignments will remain unlinked to courses.",
    );
  return result;
}
