import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { formatJavaScriptBookmarkProgram } from "../tools/bookmark-program.mjs";
import { encodeJavaScriptBookmarkPayload } from "../src/domain/bookmark-address.js";

function execute(source) {
  const messages = [],
    context = vm.createContext({ console: { log: (value) => messages.push(value) } });
  const address = "javascript:" + encodeJavaScriptBookmarkPayload("void " + source),
    parsed = new URL(address);
  assert.equal(parsed.href, address);
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  const decoded = decodeURIComponent(parsed.pathname);
  assert.equal(decoded, "void " + source);
  assert.equal(new vm.Script(decoded).runInContext(context), undefined);
  return { observed: JSON.parse(JSON.stringify(context.observed)), messages };
}

test("bookmark formatting preserves literals, regexes, template raw text, ASI, strict mode and reflected names", () => {
  const source = [
    '(() => { "use strict";',
    "// Comments can contain /regex/ and `template` delimiters.",
    'const literal = "Unicode 測試 🧪 /* string */ // string ?#%";',
    "const expression = /https?:\\/\\/[^/?#]+|\\/\\*|[?#%]/gu;",
    "const raw = String.raw`a\\nb\\u0041\\x42`;",
    "const template = `first\\nsecond ${literal}`;",
    "const nested = `outer ${`inner ${2 + 3}`} done`;",
    'function StableFunctionName() { "use strict"; return this; }',
    "class StableClassName {}",
    "function RetainedUnusedFunction() { return 17; }",
    "function separatedReturn() {",
    "  return",
    "  { authored: true }",
    "}",
    "let first = 1, second = 1",
    "first",
    "++second",
    "if (false) { globalThis.unreachedStatementMustRemain = true; }",
    "debugger;",
    'console.log("retained console call");',
    "globalThis.observed = { literal, raw, template, nested, first, second,",
    "  regexSource: expression.source, matches: literal.match(expression),",
    "  strictThis: StableFunctionName() === undefined,",
    "  functionName: StableFunctionName.name, className: StableClassName.name,",
    "  returnUndefined: separatedReturn() === undefined, negativeZero: Object.is(-0, -0) };",
    'return "must not replace the document";',
    "})()",
  ].join("\n");
  const formatted = formatJavaScriptBookmarkProgram(source);
  assert(formatted.length < source.length);
  assert.deepEqual(execute(formatted), execute(source));
  assert.equal(execute(formatted).observed.raw, "a\\nb\\u0041\\x42");
  assert.equal(execute(formatted).observed.returnUndefined, true);
  assert.equal(execute(formatted).observed.first, 1);
  assert.equal(execute(formatted).observed.second, 2);
  assert.equal(execute(formatted).observed.strictThis, true);
  assert.match(formatted, /function RetainedUnusedFunction\(/);
  assert.match(formatted, /unreachedStatementMustRemain/);
  assert.match(formatted, /debugger/);
  assert.match(formatted, /console\.log/);
  assert.equal(formatted, formatJavaScriptBookmarkProgram(source));
});

test("the build-time parser formats without evaluating the program", () => {
  const key = "__CTI_BOOKMARK_FORMAT_BUILD_EXECUTED__";
  assert.equal(Object.hasOwn(globalThis, key), false);
  const source = `(() => { globalThis.${key} = true; })()`;
  const formatted = formatJavaScriptBookmarkProgram(source);
  assert.equal(Object.hasOwn(globalThis, key), false);
  const context = vm.createContext({});
  new vm.Script("void " + formatted).runInContext(context);
  assert.equal(context[key], true);
});

test("shortened local bindings preserve closures, shorthand evidence keys and dynamic property names", () => {
  const source = `(() => {
    const sourceIdentity = "original", observationProvenance = {sourceIdentity};
    const {sourceIdentity: retainedIdentity} = observationProvenance;
    function OriginalReceiptFactory() {
      const originalResponseSha256 = "a".repeat(64);
      return () => ({originalResponseSha256, sourceIdentity: retainedIdentity});
    }
    globalThis.observed = {
      observationProvenance, receipt: OriginalReceiptFactory()(),
      name: OriginalReceiptFactory.name,
      dynamic: observationProvenance["sourceIdentity"]
    };
  })()`;
  assert.deepEqual(execute(formatJavaScriptBookmarkProgram(source)), execute(source));
});

test("classic-script syntax errors and empty inputs cannot become bookmark deliveries", () => {
  for (const source of ["", " \n\t ", null, undefined])
    assert.throws(() => formatJavaScriptBookmarkProgram(source), /non-empty/);
  for (const source of ["const = ;", "return 1;", "export const value = 1;"])
    assert.throws(() => formatJavaScriptBookmarkProgram(source));
});

test("formatting retains one asynchronous invocation and an undefined bookmark completion", async () => {
  const source = "(async () => { globalThis.executions = (globalThis.executions || 0) + 1; await Promise.resolve(); globalThis.finished = true; return 'replacement'; })()";
  for (const program of [source, formatJavaScriptBookmarkProgram(source)]) {
    const context = vm.createContext({});
    assert.equal(new vm.Script("void " + program).runInContext(context), undefined);
    await Promise.resolve();
    assert.equal(context.executions, 1);
    assert.equal(context.finished, true);
  }
});

test('literal brackets reduce delivery size without changing percent literals, fragments or queries', () => {
  const program='void(globalThis.observed=["[literal]","%5B","%5D","?#","日本語"]);';
  const encoded=encodeJavaScriptBookmarkPayload(program);
  assert(encoded.includes('["') === false); // Quotes remain percent encoded.
  assert(encoded.includes('['));assert(encoded.includes(']'));
  assert(encoded.includes('%255B'));assert(encoded.includes('%255D'));
  assert.equal(decodeURIComponent(encoded),program);
  const parsed=new URL('javascript:'+encoded);
  assert.equal(parsed.search,'');assert.equal(parsed.hash,'');
  assert.equal(decodeURIComponent(parsed.pathname),program);
  assert(encoded.length < encodeURI(program).replace(/[?#]/g,encodeURIComponent).length);
});

 test('literal braces preserve opaque javascript URL programs and percent-encoded literals',()=>{
  const program='void(()=>{globalThis.value={text:"{literal} %7B %7D ?# 日本語"};})()';
  const encoded=encodeJavaScriptBookmarkPayload(program),url=new URL('javascript:'+encoded);
  assert(encoded.includes('{'));assert(encoded.includes('}'));assert(encoded.includes('%257B'));assert(encoded.includes('%257D'));
  assert.equal(url.search,'');assert.equal(url.hash,'');assert.equal(decodeURIComponent(url.pathname),program);
  const context=vm.createContext({});assert.equal(new vm.Script(decodeURIComponent(url.pathname)).runInContext(context),undefined);
  assert.equal(context.value.text,'{literal} %7B %7D ?# 日本語');
});
