// One-time, syntax-aware extraction. Never splits a declaration or changes load order.
import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";

if (fs.existsSync("src/legacy/manifest.json"))
  throw new Error(
    "Source parts already exist. Edit them rather than re-splitting.",
  );
const code = fs.readFileSync("Code.gs", "utf8");
const ast = ts.createSourceFile(
  "Code.gs",
  code,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const parts = [];
let begin = 0,
  lines = 0,
  names = [];
fs.mkdirSync("src/legacy/server", { recursive: true });
function write(end) {
  const text = code.slice(begin, end);
  if (!text) return;
  const stem = (names[0] || "release")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/-$/, "");
  const file = `src/legacy/server/${String(parts.length + 1).padStart(3, "0")}-${stem}.js`;
  fs.writeFileSync(file, text);
  parts.push({ file, lines: text.split("\n").length - 1, symbols: names });
  begin = end;
  lines = 0;
  names = [];
}
for (const statement of ast.statements) {
  const len =
    code.slice(statement.getFullStart(), statement.end).split("\n").length - 1;
  if (lines && (lines + len > 360 || statement.getText(ast).length > 100000))
    write(statement.getFullStart());
  if (statement.name?.text) names.push(statement.name.text);
  if (ts.isVariableStatement(statement))
    for (const d of statement.declarationList.declarations)
      if (ts.isIdentifier(d.name)) names.push(d.name.text);
  lines += len;
  if (statement.getText(ast).length > 100000) write(statement.end);
}
write(code.length);
const browserExports = [
  "normalizeCourseraItem_",
  "qaParseSmartIngestionIntelligence_",
  "qaAssessDestinationReadiness_",
  "qaCaptureTraversalSummary_",
  "qaAssertNotDiagnosticCapture_",
  "qaBrightspaceFlattenTopics_",
  "qaNormalizeBrightspaceAssignment_",
  "ctiExtractorDelivery_",
  "qaCleanText_",
  "qaReadingEvidenceGap_",
  "compareItemFidelity_",
  "normalizeSourceItem_",
  "CTI_RELEASE_REGISTRY_",
  "CTI_FEATURE_MANIFEST_",
];
fs.writeFileSync(
  "src/legacy/manifest.json",
  JSON.stringify(
    {
      baseline: "5280adf",
      qaBuild: "v8.0.0-asset-claim-scope-20260927",
      baselineSha256: crypto.createHash("sha256").update(code).digest("hex"),
      browserExports,
      parts,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Extracted ${parts.length} ordered source parts without changing a byte.`,
);
