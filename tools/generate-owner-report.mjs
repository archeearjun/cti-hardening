import fs from "node:fs";
import ts from "typescript";
const html = fs.readFileSync(new URL("../Index.html", import.meta.url), "utf8");
const code = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1])
  .join("\n");
const ast = ts.createSourceFile(
  "Index.js",
  code,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const functions = new Map(
  ast.statements
    .filter(ts.isFunctionDeclaration)
    .filter((f) => f.name)
    .map((f) => [f.name.text, f]),
);
const wanted = new Set();
function add(name) {
  if (wanted.has(name)) return;
  const fn = functions.get(name);
  if (!fn) throw new Error(`Missing owner report function ${name}`);
  wanted.add(name);
  function visit(n) {
    if (ts.isIdentifier(n) && functions.has(n.text) && n.text !== name)
      add(n.text);
    ts.forEachChild(n, visit);
  }
  visit(fn.body);
}
add("buildPostQaText_");
add("qaOwnerTasksText");
const source = [...wanted]
  .map((name) => functions.get(name).getText(ast))
  .join("\n\n");
if (/document\.|google\.script|window\./.test(source))
  throw new Error(
    "Owner text report unexpectedly depends on browser or Google state.",
  );
fs.writeFileSync(
  new URL("../src/generated/owner-report.js", import.meta.url),
  source + "\nexport {buildPostQaText_,qaOwnerTasksText};\n",
);
console.log(`Generated canonical owner report from ${wanted.size} functions.`);
