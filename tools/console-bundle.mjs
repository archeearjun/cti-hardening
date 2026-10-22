import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Restricted, source-preserving linker for pasted console programs.
 * Feature files are real ESM, independently importable in tests. They may only
 * export named functions and literal constants: no module initialization or
 * mutable shared state. State and effects stay in the per-run entry IIFE.
 * Keeping function text intact preserves diagnostic/check script boundaries.
 */
export function bundleConsole(entryPath, options = {}) {
  const root = path.dirname(entryPath),
    seen = new Set(),
    definitions = new Map();
  const imports = [];
  const parse = (file, source) => {
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    if (ast.parseDiagnostics.length)
      throw Error(`Invalid console source: ${file}`);
    return ast;
  };
  const resolve = (file, specifier) => {
    // One shared, effect-free diagnostic helper uses the same restricted parser.
    const diagnosticHelper = new URL("../src/diagnostics/performance.js", import.meta.url).pathname;
    const candidate = path.resolve(path.dirname(file), specifier);
    if (specifier === "../../diagnostics/performance.js" && candidate === diagnosticHelper) return candidate;
    if (!specifier.startsWith("./"))
      throw Error(
        `Console import must stay in its feature directory: ${specifier}`,
      );
    const target = path.resolve(path.dirname(file), specifier);
    if (!target.startsWith(root + path.sep))
      throw Error("Console import escaped its feature directory.");
    return target;
  };
  const visitImport = (file, node) => {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || node.importClause.name)
      throw Error("Console modules require explicit named imports.");
    const target = resolve(file, node.moduleSpecifier.text);
    for (const binding of bindings.elements) {
      if (binding.propertyName)
        throw Error("Console import aliases are unsupported.");
      imports.push({ target, name: binding.name.text });
    }
    visit(target);
  };
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8"),
      ast = parse(file, source);
    for (const node of ast.statements) {
      if (ts.isImportDeclaration(node)) {
        visitImport(file, node);
        continue;
      }
      if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
        throw Error(`Console module has a non-export statement: ${file}`);
      let name;
      if (ts.isFunctionDeclaration(node)) name = node.name?.text;
      else if (
        ts.isVariableStatement(node) &&
        node.declarationList.flags & ts.NodeFlags.Const
      ) {
        if (node.declarationList.declarations.length !== 1)
          throw Error("Use one exported constant per statement.");
        const decl = node.declarationList.declarations[0],
          init = decl.initializer;
        if (
          !ts.isIdentifier(decl.name) ||
          !init ||
          !(
            ts.isStringLiteral(init) ||
            init.kind === ts.SyntaxKind.TrueKeyword ||
            init.kind === ts.SyntaxKind.FalseKeyword ||
            /^[\d\s+*.-]+$/.test(init.getText(ast))
          )
        )
          throw Error(`Console constants must be literals: ${file}`);
        name = decl.name.text;
      } else throw Error(`Unsupported console export in ${file}`);
      if (!name || definitions.has(name))
        throw Error(`Duplicate console binding: ${name}`);
      definitions.set(name, {
        file,
        text: node.getText(ast).replace(/^export\s+/, ""),
      });
    }
  };
  let entry = fs.readFileSync(entryPath, "utf8");
  const ast = parse(entryPath, entry),
    removals = [];
  for (const node of ast.statements)
    if (ts.isImportDeclaration(node)) {
      visitImport(entryPath, node);
      removals.push([node.getStart(ast), node.end]);
    }
  for (const { target, name } of imports)
    if (definitions.get(name)?.file !== target)
      throw Error(`Missing console export ${name} from ${target}`);
  for (const [start, end] of removals.reverse())
    entry = entry.slice(0, start) + entry.slice(end);
  const marker = /(["'])use strict\1;/;
  if (!marker.test(entry))
    throw Error("Console entry needs an explicit strict-mode IIFE.");
  let selected = [...definitions.values()];
  if (options.onlyReachable === true) {
    // Preserve declaration text while following actual lexical symbols. A
    // property name or shadowed local identifier cannot pull in an unrelated
    // helper, and referenced imports retain their original declarations.
    const program = ts.createProgram([...seen, entryPath], {
      allowJs: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    });
    const checker = program.getTypeChecker(),
      reachable = new Set(),
      queue = [],
      declarationNames = new Map();
    for (const [name, binding] of definitions) {
      const fileAst = program.getSourceFile(binding.file);
      for (const statement of fileAst.statements) {
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === name
        )
          declarationNames.set(statement, name);
        if (ts.isVariableStatement(statement))
          for (const declaration of statement.declarationList.declarations)
            if (
              ts.isIdentifier(declaration.name) &&
              declaration.name.text === name
            )
              declarationNames.set(declaration, name);
      }
    }
    function references(node) {
      if (ts.isIdentifier(node)) {
        let symbol =
          ts.isShorthandPropertyAssignment(node.parent) &&
          node.parent.name === node
            ? checker.getShorthandAssignmentValueSymbol(node.parent)
            : checker.getSymbolAtLocation(node);
        if (symbol?.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        for (const declaration of symbol?.declarations || []) {
          const name = declarationNames.get(declaration);
          if (!name || reachable.has(name)) continue;
          reachable.add(name);
          queue.push(declaration);
        }
      }
      ts.forEachChild(node, references);
    }
    const entryAst = program.getSourceFile(entryPath);
    for (const statement of entryAst.statements)
      if (!ts.isImportDeclaration(statement)) references(statement);
    while (queue.length) references(queue.shift());
    selected = [...definitions]
      .filter(([name]) => reachable.has(name))
      .map(([, definition]) => definition);
  }
  const source = selected.map((d) => "  " + d.text).join("\n\n");
  return entry
    .replace(marker, (match) => match + "\n\n" + source + "\n")
    .trimStart();
}
