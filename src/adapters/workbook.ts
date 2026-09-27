import * as XLSX from "xlsx";

export type Cell = string | number | boolean | null;
export interface BookData {
  name: string;
  sheets: Record<string, { values: Cell[][]; display?: string[][] }>;
}
export function readWorkbook(bytes: Uint8Array, name: string): BookData {
  if (bytes.byteLength > 25 * 1024 * 1024)
    throw new Error("Workbook exceeds the 25 MiB limit.");
  const wb = XLSX.read(bytes, {
    type: "array",
    cellText: true,
    cellFormula: true,
  });
  const sheets: BookData["sheets"] = {};
  let cells = 0;
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
    cells += (range.e.r + 1) * (range.e.c + 1);
    if (cells > 2000000)
      throw new Error(
        "Workbook exceeds the two-million-cell inspection budget.",
      );
    for (const [key, cell] of Object.entries(sheet))
      if (!key.startsWith("!") && cell?.f && cell.v === undefined)
        throw new Error(
          `Formula ${sheetName}!${key} has no saved result. Recalculate and save the workbook first.`,
        );
    sheets[sheetName] = {
      values: XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: true,
      }),
      display: XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
      }),
    };
  }
  if (!wb.SheetNames.length) throw new Error("Workbook has no sheets.");
  return { name, sheets };
}
export function writeWorkbook(book: BookData): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(book.sheets))
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sheet.values),
      name,
    );
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
export function workbookAdapter(book: BookData) {
  function sheet(name: string) {
    const s = book.sheets[name];
    const range = (
      row = 1,
      col = 1,
      n = s.values.length,
      m = s.values.reduce((max, r) => Math.max(max, r.length), 1),
    ) => {
      const chain = {
        getValues: () =>
          Array.from({ length: n }, (_, i) =>
            Array.from(
              { length: m },
              (_, j) => s.values[row - 1 + i]?.[col - 1 + j] ?? "",
            ),
          ),
        getDisplayValues: () =>
          Array.from({ length: n }, (_, i) =>
            Array.from(
              { length: m },
              (_, j) =>
                s.display?.[row - 1 + i]?.[col - 1 + j] ??
                String(s.values[row - 1 + i]?.[col - 1 + j] ?? ""),
            ),
          ),
        setValues(values: Cell[][]) {
          for (let i = 0; i < values.length; i++) {
            s.values[row - 1 + i] ??= [];
            for (let j = 0; j < values[i].length; j++)
              s.values[row - 1 + i][col - 1 + j] = values[i][j];
          }
          delete s.display;
          return chain;
        },
        setFontWeight: (_value: string) => chain,
        setBackground: (_value: string) => chain,
      };
      return chain;
    };
    return {
      getDataRange: () => range(),
      getRange: range,
      clear() {
        s.values = [];
        delete s.display;
      },
      autoResizeColumns() {},
      getName: () => name,
    };
  }
  return {
    getSheetByName: (name: string) => (book.sheets[name] ? sheet(name) : null),
    getSheets: () => Object.keys(book.sheets).map(sheet),
    insertSheet(name: string) {
      book.sheets[name] = { values: [] };
      return sheet(name);
    },
  };
}
