import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCorpusExpectations } from '../tools/check-corpus-expectations.mjs';
const hash = 'a'.repeat(64);
function fixtures() {
  return {
    manifest: { kind: 'CTI_CORPUS_EXPECTATIONS', schemaVersion: 1, checks: [{ id: 'empty-final', caseId: 'course-before', target: 'comparison', description: 'A documented failed ingestion must remain actionable.', inputHashes: { coursera: hash }, match: { sourceId: 's1' }, assertions: [{ path: ['verdict'], operator: 'equals', value: 'INGESTION_FAILURE' }, { path: ['ownerAction', 'severity'], operator: 'equals', value: 'CRITICAL' }] }] },
    review: { kind: 'CTI_EVIDENCE_CORPUS_REVIEW', cases: [{ id: 'course-before', status: 'REPLAYED', hashes: { coursera: hash } }] },
    comparison: { result: { itemResults: [{ sourceId: 's1', verdict: 'INGESTION_FAILURE', ownerAction: { severity: 'CRITICAL' } }] } },
  };
}
const run = f => checkCorpusExpectations(f.manifest, f.review, () => f.comparison);
test('known defects require both the expected decision and owner action', () => {
  const f = fixtures(); assert.equal(run(f).status, 'PASS');
  f.comparison.result.itemResults[0].verdict = 'VERIFIED'; assert.equal(run(f).failed, 1);
  f.comparison.result.itemResults[0].verdict = 'INGESTION_FAILURE';
  f.comparison.result.itemResults[0].ownerAction.severity = 'NONE'; assert.equal(run(f).failed, 1);
});
test('missing source comparison is blocked rather than passed', () => {
  const f = fixtures(); f.review.cases[0].status = 'CAPTURE_REVIEW_ONLY';
  const result = run(f); assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.blocked, 1); assert.equal(result.passed, 0);
});
test('changed inputs, missing and ambiguous items cannot pass', () => {
  for (const mutate of [f => f.review.cases[0].hashes.coursera = 'b'.repeat(64), f => f.comparison.result.itemResults = [], f => f.comparison.result.itemResults.push(f.comparison.result.itemResults[0])]) {
    const f = fixtures(); mutate(f); assert.equal(run(f).failed, 1);
  }
});
test('missing evidence does not satisfy excludes or notEquals, but false and zero remain real values', () => {
  const f = fixtures();
  f.manifest.checks[0].assertions = [{ path: ['issues'], operator: 'excludes', value: 'FALSE_WARNING' }];
  assert.equal(run(f).failed, 1); f.comparison.result.itemResults[0].issues = []; assert.equal(run(f).passed, 1);
  f.manifest.checks[0].assertions = [{ path: ['count'], operator: 'notEquals', value: 1 }];
  assert.equal(run(f).failed, 1); f.comparison.result.itemResults[0].count = 0; assert.equal(run(f).passed, 1);
});
test('unsafe case IDs, duplicate checks and empty assertions fail validation', () => {
  for (const mutate of [f => f.manifest.checks[0].caseId = '../secret', f => f.manifest.checks.push(f.manifest.checks[0]), f => f.manifest.checks[0].assertions = [], f => f.manifest.checks[0].assertions[0].path = ['__proto__']]) {
    const f = fixtures(); mutate(f); assert.throws(() => run(f));
  }
});
