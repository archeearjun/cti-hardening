// An executable answer to "would a known historical defect slip through?"
// Expected outcomes are curated from evidence, never learned from current output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const operators = new Set(['equals', 'oneOf', 'contains', 'excludes', 'notEquals']);
const safeKey = k => (typeof k === 'string' && k.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(k)) || (Number.isSafeInteger(k) && k >= 0);

export function validateExpectations(manifest) {
  if (manifest?.kind !== 'CTI_CORPUS_EXPECTATIONS' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.checks) || !manifest.checks.length)
    throw Error('Expected nonempty CTI_CORPUS_EXPECTATIONS schema 1.');
  const ids = new Set();
  for (const c of manifest.checks) {
    if (!safeId.test(c.id || '') || ids.has(c.id) || !safeId.test(c.caseId || '')) throw Error('Check/case IDs must be safe and check IDs unique.');
    ids.add(c.id);
    if (!['capture', 'comparison'].includes(c.target) || typeof c.description !== 'string' || !c.description.trim()) throw Error('Each check needs a target and evidence-based description.');
    if (!c.inputHashes || !/^[a-f0-9]{64}$/i.test(c.inputHashes.coursera || '') || Object.values(c.inputHashes).some(h => !/^[a-f0-9]{64}$/i.test(h))) throw Error('Pin the expected input hashes, including Coursera.');
    if (c.match && (typeof c.match !== 'object' || Array.isArray(c.match) || !Object.keys(c.match).length || !Object.keys(c.match).every(safeKey))) throw Error('Invalid exact item selector.');
    if (!Array.isArray(c.assertions) || !c.assertions.length) throw Error('Checks must contain explicit assertions.');
    for (const a of c.assertions) {
      if (!Array.isArray(a.path) || !a.path.length || !a.path.every(safeKey) || !operators.has(a.operator) || !Object.hasOwn(a, 'value')) throw Error('Invalid assertion.');
      if (a.operator === 'oneOf' && (!Array.isArray(a.value) || !a.value.length)) throw Error('oneOf needs a nonempty expected-value list.');
    }
  }
  return manifest;
}

function assertionPasses(root, a) {
  let actual = root;
  for (const key of a.path) {
    // Missing evidence cannot pass a negative assertion either.
    if (actual == null || typeof actual !== 'object' || !Object.hasOwn(actual, key)) return false;
    actual = actual[key];
  }
  if (a.operator === 'equals') return isDeepStrictEqual(actual, a.value);
  if (a.operator === 'notEquals') return !isDeepStrictEqual(actual, a.value);
  if (a.operator === 'oneOf') return a.value.some(v => isDeepStrictEqual(actual, v));
  if (!Array.isArray(actual)) return false;
  const found = actual.some(v => isDeepStrictEqual(v, a.value));
  return a.operator === 'contains' ? found : !found;
}

export function checkCorpusExpectations(manifest, review, loadComparison) {
  validateExpectations(manifest);
  if (review?.kind !== 'CTI_EVIDENCE_CORPUS_REVIEW' || !Array.isArray(review.cases)) throw Error('Expected a corpus replay review.');
  const cases = new Map();
  for (const c of review.cases) {
    if (!safeId.test(c.id || '') || cases.has(c.id)) throw Error('Replay case identity is invalid or duplicated.');
    cases.set(c.id, c);
  }
  const checks = manifest.checks.map(c => {
    const result = { id: c.id, caseId: c.caseId, description: c.description, status: 'FAIL', failures: [] };
    const row = cases.get(c.caseId);
    if (!row || row.status === 'ERROR') return { ...result, failures: ['Replay missing or failed.'] };
    if (!isDeepStrictEqual(Object.keys(c.inputHashes).sort(), Object.keys(row.hashes || {}).sort()) || !Object.entries(c.inputHashes).every(([k, hash]) => row.hashes?.[k] === hash)) return { ...result, failures: ['Historical input hashes differ. Review the evidence before changing expectations.'] };
    if (c.target === 'comparison' && row.status !== 'REPLAYED') return { ...result, status: 'BLOCKED', failures: ['Full source comparison unavailable; capture review cannot establish this outcome.'] };
    try {
      let target = c.target === 'comparison' ? loadComparison(c.caseId)?.result : row.capture;
      if (!target) throw Error('Requested evidence is missing.');
      if (c.match) {
        const collection = c.target === 'comparison' ? target.itemResults : target.assessments;
        if (!Array.isArray(collection)) throw Error('Expected item collection is missing.');
        const matches = collection.filter(item => Object.entries(c.match).every(([key, value]) => isDeepStrictEqual(item?.[key], value)));
        if (matches.length !== 1) throw Error('Exact item selector matched ' + matches.length + ' items; expected one.');
        target = matches[0];
      }
      result.failures = c.assertions.filter(a => !assertionPasses(target, a)).map(a => ({ path: a.path, operator: a.operator, expected: a.value }));
      if (!result.failures.length) result.status = 'PASS';
    } catch (error) { result.failures = [error.message]; }
    return result;
  });
  const passed = checks.filter(c => c.status === 'PASS').length, failed = checks.filter(c => c.status === 'FAIL').length, blocked = checks.filter(c => c.status === 'BLOCKED').length;
  return { kind: 'CTI_CORPUS_EXPECTATION_RESULT', schemaVersion: 1, qaBuild: review.qaBuild, passed, failed, blocked,
    status: failed ? 'FAIL' : blocked ? 'INCOMPLETE' : 'PASS',
    scope: 'Only the explicitly enumerated historical expectations; not certification of all course behavior or current live extraction.', checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestFile, directory] = process.argv.slice(2);
  if (!manifestFile || !directory) throw Error('Usage: node tools/check-corpus-expectations.mjs expectations.json replay-directory');
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = checkCorpusExpectations(read(manifestFile), read(path.join(directory, 'review.json')), id => read(path.join(directory, id + '.json')));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.failed ? 1 : result.blocked ? 2 : 0;
}
