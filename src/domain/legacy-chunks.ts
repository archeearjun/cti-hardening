export interface LegacyChunkDiagnostics {
  table: string;
  id: string;
  expectedChunks: number | null;
  actualChunks: number;
  firstIndex: number | null;
  lastIndex: number | null;
  missingCount: number;
  missingIndices: number[];
  duplicateIndices: number[];
  invalidIndexRows: number[];
}
export class LegacyChunkError extends Error {
  diagnostics: LegacyChunkDiagnostics;
  constructor(message: string, diagnostics: LegacyChunkDiagnostics) {
    super(message);
    this.name = "LegacyChunkError";
    this.diagnostics = diagnostics;
  }
}

/** The GAS writers use zero-based indexes. Do not renumber damaged evidence. */
export function createLegacyChunkReader(tables: Record<string, any[][]>) {
  const cache = new Map<
    string,
    Map<string, { row: any[]; sheetRow: number }[]>
  >();
  return (table: string, id: string, declaredCount?: unknown): any => {
    let groups = cache.get(table);
    if (!groups) {
      groups = new Map();
      (tables[table] || []).slice(1).forEach((row, i) => {
        const key = String(row[0] || "");
        const list = groups!.get(key) || [];
        list.push({ row, sheetRow: i + 2 });
        groups!.set(key, list);
      });
      cache.set(table, groups);
    }
    const rows = groups.get(id) || [];
    const hasDeclared =
      declaredCount !== undefined &&
      declaredCount !== null &&
      declaredCount !== "";
    const expected = hasDeclared ? Number(declaredCount) : null;
    const indices = new Set<number>();
    const duplicateIndices: number[] = [],
      invalidIndexRows: number[] = [];
    for (const { row, sheetRow } of rows) {
      const n = Number(row[1]);
      if (
        (typeof row[1] !== "number" && typeof row[1] !== "string") ||
        String(row[1]).trim() === "" ||
        !Number.isSafeInteger(n) ||
        n < 0
      ) {
        if (invalidIndexRows.length < 20) invalidIndexRows.push(sheetRow);
      } else {
        if (indices.has(n) && duplicateIndices.length < 20)
          duplicateIndices.push(n);
        indices.add(n);
      }
    }
    const ordered = [...indices].sort((a, b) => a - b);
    const diagnostics: LegacyChunkDiagnostics = {
      table,
      id,
      expectedChunks: expected,
      actualChunks: rows.length,
      firstIndex: ordered[0] ?? null,
      lastIndex: ordered.at(-1) ?? null,
      missingCount: 0,
      missingIndices: [],
      duplicateIndices,
      invalidIndexRows,
    };
    const fail = (reason: string): never => {
      throw new LegacyChunkError(
        `Incomplete or invalid ${table} for ${id}: ${reason}`,
        diagnostics,
      );
    };
    if (
      hasDeclared &&
      (typeof declaredCount === "boolean" ||
        !Number.isSafeInteger(expected) ||
        expected! < 1)
    )
      fail("the saved Payload Chunks count is invalid.");
    const expectedSpan = expected ?? rows.length;
    // Bound diagnostics even if a corrupt count is enormous.
    const inRange = ordered.filter((n) => n < expectedSpan);
    diagnostics.missingCount = expectedSpan - inRange.length;
    let next = 0;
    for (const n of [...inRange, expectedSpan]) {
      while (next < n && diagnostics.missingIndices.length < 20)
        diagnostics.missingIndices.push(next++);
      next = n + 1;
      if (diagnostics.missingIndices.length >= 20) break;
    }
    if (!rows.length)
      fail(
        `no payload rows were found${expected === null ? "" : `; ${expected} were declared`}.`,
      );
    if (invalidIndexRows.length)
      fail(
        `invalid chunk indexes at sheet rows ${invalidIndexRows.join(", ")}.`,
      );
    if (duplicateIndices.length)
      fail(
        `duplicate indexes ${duplicateIndices.join(", ")}; chunks were not merged or discarded.`,
      );
    if (
      diagnostics.missingCount ||
      rows.length !== expectedSpan ||
      ordered.some((n, i) => n !== i)
    )
      fail(
        `expected ${expectedSpan} chunks starting at index 0; found ${rows.length}. Missing indexes: ${diagnostics.missingIndices.join(", ") || "none"}.`,
      );
    const sorted = [...rows].sort(
      (a, b) => Number(a.row[1]) - Number(b.row[1]),
    );
    if (sorted.some(({ row }) => typeof row[2] !== "string" || !row[2].length))
      fail("a payload chunk is empty or is not text.");
    const encoded = sorted.map(({ row }) => row[2]).join("");
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      fail("the payload is not valid Base64.");
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      return fail("the payload is not valid Base64.");
    }
    if (btoa(binary) !== encoded) fail("the Base64 payload is not canonical.");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      );
    } catch {
      return fail("the payload contains invalid UTF-8 bytes.");
    }
    try {
      return JSON.parse(text);
    } catch {
      return fail("the decoded payload is not complete, valid JSON.");
    }
  };
}
