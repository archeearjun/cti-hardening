import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";

export const archivePath = "archive/apps-script/Code.gs";
export const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const parse = (text, file = "source.js") =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
// AST leaf tokens preserve literal values/regular expressions and ignore only
// comments, whitespace and quote style. No code is evaluated by this audit.
export function tokens(node) {
  if (typeof node === "string") node = parse(node);
  const result = [];
  function visit(n) {
    const children = n.getChildren();
    if (children.length) return children.forEach(visit);
    const text = n.text === undefined ? n.getText() : n.text;
    result.push([
      n.kind,
      ts.isIdentifier(n) ? text.replace(/^CTI_V7931_/, "base_") : text,
    ]);
  }
  visit(node);
  return JSON.stringify(result);
}
export const functionSignature = (n) => [
  !!n.asteriskToken,
  !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
  n.parameters.map(tokens),
];
export const functionTokens = (n) =>
  JSON.stringify([...functionSignature(n), tokens(n.body)]);
export const walkFiles = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walkFiles(`${dir}/${e.name}`)
        : e.name.endsWith(".js")
          ? [`${dir}/${e.name}`]
          : [],
    );
export function inventory() {
  const source = fs.readFileSync(archivePath, "utf8"),
    ast = parse(source);
  const original = new Map(),
    overrides = new Map(),
    constants = new Map(),
    current = new Map(),
    currentConstants = new Map();
  for (const n of ast.statements) {
    if (ts.isFunctionDeclaration(n)) original.set(n.name.text, n);
    if (ts.isVariableStatement(n))
      for (const d of n.declarationList.declarations)
        constants.set(d.name.getText(), d);
    if (ts.isExpressionStatement(n) && ts.isBinaryExpression(n.expression)) {
      const { left, right, operatorToken } = n.expression;
      if (
        ts.isIdentifier(left) &&
        operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isFunctionExpression(right)
      )
        overrides.set(left.text, right);
    }
  }
  for (const file of walkFiles("src/engine")) {
    const s = parse(fs.readFileSync(file, "utf8"), file);
    function visit(n) {
      if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name)
        current.set(n.name.text, { node: n, file });
      ts.forEachChild(n, visit);
    }
    visit(s);
    for (const n of s.statements)
      if (ts.isVariableStatement(n))
        for (const d of n.declarationList.declarations)
          currentConstants.set(d.name.getText(), { node: d, file });
  }
  return {
    source,
    ast,
    original,
    overrides,
    constants,
    current,
    currentConstants,
  };
}
export function extractorParts(source, relocatedConstants = []) {
  const ast = parse(source),
    functions = new Map(),
    constants = new Map(),
    removals = [];
  let main;
  function find(n) {
    if (!main && (ts.isFunctionExpression(n) || ts.isArrowFunction(n)))
      main = n;
    if (!main) ts.forEachChild(n, find);
  }
  find(ast);
  if (!main) throw Error("Missing extractor entry point");
  function visit(n) {
    if (ts.isFunctionDeclaration(n)) {
      if (functions.has(n.name.text))
        throw Error(`Duplicate extractor function: ${n.name.text}`);
      functions.set(n.name.text, functionTokens(n));
      removals.push([n.getStart(), n.end]);
      return;
    }
    if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return;
    if (
      ts.isVariableStatement(n) &&
      n.declarationList.declarations.length === 1
    ) {
      const d = n.declarationList.declarations[0];
      if (relocatedConstants.includes(d.name.getText())) {
        constants.set(d.name.getText(), tokens(d.initializer));
        removals.push([n.getStart(), n.end]);
        return;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(main.body);
  let remainder = source.slice(main.body.getStart(), main.body.end),
    offset = main.body.getStart();
  for (const [start, end] of removals.sort((a, b) => b[0] - a[0]))
    remainder =
      remainder.slice(0, start - offset) + remainder.slice(end - offset);
  return {
    functions,
    constants,
    entry: JSON.stringify([functionSignature(main), tokens(remainder)]),
  };
}
