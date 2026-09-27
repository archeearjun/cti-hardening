import fs from "node:fs";
import ts from "typescript";

// One source of truth: reuse the complete source-evidence scanner from the
// accepted GAS client. No UI handlers, RPCs or authorisation stubs are copied.
const index = fs.readFileSync(
  new URL("../Index.html", import.meta.url),
  "utf8",
);
const begin = index.indexOf(" function normalizeZipPath_(");
const end = index.indexOf("  function readPackageManifest(", begin);
if (begin < 0 || end < 0)
  throw new Error("Canonical scanner boundaries changed.");
let source = index.slice(begin, end);
const ast = ts.createSourceFile(
  "scanner.js",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
if (
  ast.parseDiagnostics.length ||
  ast.statements.some((s) => !ts.isFunctionDeclaration(s))
) {
  throw new Error(
    "Source scanner must consist only of complete function declarations.",
  );
}
const names = ast.statements.map((s) => s.name.text);
for (const name of [
  "buildSourceEvidenceFromZip_",
  "parseXmlCompat_",
  "extractPdfTextEvidence_",
]) {
  if (!names.includes(name))
    throw new Error(`Missing scanner function: ${name}`);
}
// Host the PDF library and its worker ourselves. Keep the canonical selection
// algorithm, but accurately record the parser actually used in this environment.
function replaceOnce(before, after) {
  if (source.split(before).length !== 2)
    throw new Error(`Scanner adapter changed: ${before}`);
  source = source.replace(before, after);
}
replaceOnce(
  "'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'",
  "pdfWorkerUrl",
);
replaceOnce("parser:'pdfjs-3.11.174'", "parser:'pdfjs-' + pdfVersion");
// Destroy each PDF task after success or failure to release its worker/memory.
replaceOnce(
  "sampleStrategy:'error' };\n    }\n }",
  "sampleStrategy:'error' };\n    } finally {\n      if (typeof loadingTask !== 'undefined' && loadingTask) await loadingTask.destroy();\n    }\n }",
);
const output = `// Generated from Index.html; edit the canonical functions, not this file.\nexport function createSourceScanner({pdfjsLib, pdfWorkerUrl, pdfVersion}) {\nconst window = {crypto: globalThis.crypto, pdfjsLib};\n${source}\nreturn {buildSourceEvidenceFromZip_, parseXmlCompat_};\n}\n`;
fs.mkdirSync(new URL("../src/generated/", import.meta.url), {
  recursive: true,
});
fs.writeFileSync(
  new URL("../src/generated/source-scanner.js", import.meta.url),
  output,
);
console.log(
  `Generated source scanner from ${names.length} canonical functions.`,
);
