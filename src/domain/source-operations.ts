import type { PackageNode, PackageScan } from "./package-types.ts";

const nonNegative = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
};

export function deterministicPreflight(scan: PackageScan) {
  const stats = scan.stats || {};
  const totalItems = nonNegative(stats.totalItems);
  const coreEmptyCount = nonNegative(stats.emptyFolders);
  const ltiItems = nonNegative(stats.lti);
  const reasons: string[] = [];
  if (totalItems === 0) reasons.push("the package has no valid content items");
  if (coreEmptyCount > 0)
    reasons.push(coreEmptyCount + " non-administrative empty folder(s) were found");
  if (ltiItems > 50) reasons.push(ltiItems + " LTI items exceed the limit of 50");
  const blocked = reasons.length > 0;
  return {
    verdict: blocked ? "BLOCKED" : "CLEARED_TO_INGEST",
    totalItems,
    coreEmptyCount,
    ltiItems,
    reasons,
    message: blocked
      ? "Blocked because " + reasons.join("; ") + "."
      : "Cleared by deterministic checks: " +
        totalItems +
        " valid item(s), " +
        coreEmptyCount +
        " core empty folder(s), and " +
        ltiItems +
        " LTI item(s).",
  };
}

export function sourceManifestRows(scan: PackageScan) {
  const rows: Array<{
    depth: number;
    path: string;
    title: string;
    type: string;
    idref: string;
    autoDeleted: boolean;
  }> = [];
  const walk = (nodes: PackageNode[], parents: string[], depth: number) => {
    for (const node of nodes || []) {
      const title = String(node.title || "Untitled");
      const path = [...parents, title].join(" > ");
      rows.push({
        depth,
        path,
        title,
        type: String(node.type || ""),
        idref: String(node.idref || ""),
        autoDeleted: node.autoDeleted === true,
      });
      walk(node.children || [], [...parents, title], depth + 1);
    }
  };
  walk(scan.courseTree || [], [], 0);
  return rows;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

export function sourceManifestCsv(scan: PackageScan) {
  const header = ["Depth", "Path", "Title", "Type", "IDREF", "Auto deleted"];
  const rows = sourceManifestRows(scan).map((row) => [
    row.depth,
    row.path,
    row.title,
    row.type,
    row.idref,
    row.autoDeleted ? "TRUE" : "FALSE",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
