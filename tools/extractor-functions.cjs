const ts = require('typescript');

// Select complete declarations by syntax, never by adjacent text/line order.
// Function bodies are evaluated only by the caller's controlled DOM fixture.
function extractorFunctions(source) {
  const ast = ts.createSourceFile('console.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Map();
  let main;
  function findMain(node) {
    if (!main && (ts.isFunctionExpression(node) || ts.isArrowFunction(node))) main = node;
    if (!main) ts.forEachChild(node, findMain);
  }
  findMain(ast);
  if (!main) throw Error('Missing extractor IIFE.');
  function visit(node) {
    if (ts.isFunctionDeclaration(node)) {
      if (functions.has(node.name.text)) throw Error(`Duplicate extractor function: ${node.name.text}`);
      functions.set(node.name.text, node.getText(ast));
      return;
    }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
    ts.forEachChild(node, visit);
  }
  visit(main.body);
  return functions;
}
module.exports = { extractorFunctions };
