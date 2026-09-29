import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  inventory,
  digest,
  functionTokens,
  tokens,
  extractorParts,
  parse,
  walkFiles,
} from "../tools/code-gs-inventory.mjs";
import { createBrowserServices } from "../src/adapters/browser-services.ts";
import { bundleConsole } from "../tools/console-bundle.mjs";
import path from "node:path";

const ledger = JSON.parse(
  fs.readFileSync("docs/audits/code-gs-parity.json", "utf8"),
);
const code = inventory();
const original = { ...createBrowserServices() };
vm.createContext(original);
vm.runInContext(code.source, original);
const sorted = (a) => [...a].sort();

test("every Code.gs function, constant, override and declared capability has an explicit audit disposition", () => {
  assert.equal(
    digest(code.source),
    ledger.archiveSha256,
    "The reference archive must remain immutable.",
  );
  assert.deepEqual(
    sorted(ledger.functions.map((f) => f.name)),
    sorted(code.original.keys()),
  );
  assert.deepEqual(
    sorted(ledger.constants.map((f) => f.name)),
    sorted(code.constants.keys()),
  );
  assert.deepEqual(
    sorted(
      ledger.functions.filter((f) => f.effectiveOverride).map((f) => f.name),
    ),
    sorted(code.overrides.keys()),
  );
  assert.deepEqual(
    sorted(ledger.features.map((f) => f.name)),
    sorted(
      Object.entries(original.CTI_FEATURE_MANIFEST_).flatMap(([g, flags]) =>
        Object.keys(flags).map((f) => `${g}.${f}`),
      ),
    ),
  );
  for (const row of ledger.functions) {
    assert(row.status, `Missing status: ${row.name}`);
    if (row.group)
      assert.equal(row.status, ledger.groups[row.group]?.status, row.name);
  }
  for (const obj of [
    ...Object.values(ledger.groups),
    ...ledger.functions,
    ...ledger.constants,
    ...ledger.features,
  ])
    for (const file of [obj.path, obj.basePath, ...(obj.paths || [])].filter(
      Boolean,
    ))
      assert(fs.existsSync(file), `Missing audit owner: ${file}`);
  assert.equal(
    ledger.verdict,
    "NOT_FEATURE_COMPLETE",
    "A complete inventory is not a feature-parity sign-off.",
  );
  assert(ledger.features.some((f) => f.status === "gap"));
  console.log(
    `Audit covers ${ledger.functions.length} functions, ${code.overrides.size} overrides, ${ledger.constants.length} constants and ${ledger.features.length} declared capabilities. Product verdict: ${ledger.verdict}.`,
  );
});

test("all retained effective rules and used base definitions match Code.gs; delivery-only differences are reviewed", () => {
  for (const row of ledger.functions.filter((r) =>
    ["preserved", "adapted"].includes(r.status),
  )) {
    const actual = code.current.get(row.name);
    assert(actual, `Missing native function: ${row.name}`);
    const expected =
      code.overrides.get(row.name) || code.original.get(row.name);
    if (row.status === "preserved")
      assert.equal(
        functionTokens(actual.node),
        functionTokens(expected),
        `Effective rule changed: ${row.name}`,
      );
    else
      assert.equal(
        digest(functionTokens(actual.node)),
        row.reviewedCurrentHash,
        `Review adapted function: ${row.name}`,
      );
    if (row.basePath)
      assert.equal(
        functionTokens(code.current.get(`base_${row.name}`).node),
        functionTokens(code.original.get(row.name)),
        `Base rule changed: ${row.name}`,
      );
  }
  for (const row of ledger.constants.filter((r) =>
    ["preserved", "reference-metadata"].includes(r.status),
  ))
    assert.equal(
      tokens(code.currentConstants.get(row.name).node.initializer),
      tokens(code.constants.get(row.name).initializer),
      `Constant changed: ${row.name}`,
    );
});

for (const platform of ["coursera", "brightspace"])
  test(`${platform}: every helper, relocated constant and remaining execution statement matches the archived extractor`, () => {
    const title = platform[0].toUpperCase() + platform.slice(1);
    const moved =
      platform === "coursera"
        ? parse(
            fs.readFileSync("src/extractors/coursera/config.js", "utf8"),
          ).statements.map((n) => n.declarationList.declarations[0].name.text)
        : [];
    const a = extractorParts(
      original[`ctiCanonical${title}ExtractorSource_`](),
      moved,
    );
    const b = extractorParts(
      bundleConsole(path.resolve(`src/extractors/${platform}/entry.js`)),
      moved,
    );
    assert.deepEqual(sorted(b.functions.keys()), sorted(a.functions.keys()));
    for (const [name, text] of a.functions)
      assert.equal(
        b.functions.get(name),
        text,
        `${platform} helper changed: ${name}`,
      );
    assert.deepEqual([...b.constants].sort(), [...a.constants].sort());
    assert.equal(b.entry, a.entry, `${platform} execution code changed`);
  });

test("source scanning and owner reporting retain every migrated Index.html function with reviewed host adaptations", () => {
  const index = fs.readFileSync("archive/apps-script/Index.html", "utf8");
  assert.equal(digest(index), ledger.indexSha256);
  const ast = parse(
    [...index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1])
      .join("\n"),
  );
  const original = new Map(
    ast.statements
      .filter(ts.isFunctionDeclaration)
      .map((n) => [n.name.text, n]),
  );
  const current = new Map();
  for (const dir of ["src/source", "src/reporting"])
    for (const file of walkFiles(dir)) {
      const s = parse(fs.readFileSync(file, "utf8"));
      function visit(n) {
        if (
          (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) &&
          original.has(n.name?.text)
        )
          current.set(n.name.text, n);
        ts.forEachChild(n, visit);
      }
      visit(s);
    }
  assert.deepEqual(
    sorted(current.keys()),
    sorted(ledger.indexFunctions.map((f) => f.name)),
  );
  for (const row of ledger.indexFunctions) {
    if (row.status === "preserved")
      assert.equal(
        functionTokens(current.get(row.name)),
        functionTokens(original.get(row.name)),
        row.name,
      );
    else
      assert.equal(
        digest(functionTokens(current.get(row.name))),
        row.reviewedCurrentHash,
        `Review host adapter: ${row.name}`,
      );
  }
});
