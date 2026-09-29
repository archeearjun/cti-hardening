import fs from "node:fs";
import ts from "typescript";

const roots = ["src/engine", "src/source", "src/reporting", "src/extractors"];
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : entry.name.endsWith(".js")
          ? [`${dir}/${entry.name}`]
          : [],
    );
const files = roots.flatMap(walk);
const program = ts.createProgram(files, {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
});
// Enforce real JS module bindings; strict data types remain at TS boundaries.
const bindingErrors = new Set([
  2304, 2552, 2440, 2451, 2393, 2459, 2305, 2307, 2632,
]);
const errors = ts
  .getPreEmitDiagnostics(program)
  .filter(
    (d) =>
      bindingErrors.has(d.code) &&
      d.file &&
      !d.file.fileName.includes("node_modules"),
  );
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (/from\s+['"][^'"]*(?:archive\/|legacy\/|legacy-engine)/.test(source))
    throw Error(
      `Maintained module imports archived/generated engine source: ${file}`,
    );
}
if (errors.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
} else
  console.log(
    `Verified explicit bindings in ${files.length} maintained JavaScript modules.`,
  );
