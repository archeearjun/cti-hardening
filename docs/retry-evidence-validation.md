# Evidence-gated retry validation

Release: Coursera v6.14.6 / schema 34; QA v8.0.0-evidence-gated-retry-20260929.
Brightspace remains v1.0.7 / schema 2.

The preceding live capture reached every item editor and confirmed the short
discussion fix. It also demonstrated redundant assessment recovery caused by a
generic body-text completeness heuristic. Completing an editor visit or obtaining
all declared question records still does not establish complete course fidelity.

## Changes

- Each primary assessment visit records a bounded receipt before evidence merging.
  The generic body-text retry is omitted only for an exact item with reliable
  prompts, supported closed-answer question types, explicit complete identity and
  answer coverage, and no non-question content parts or capture warnings. Choice
  text and observed correctness must be reliable. Essay, file-upload, unknown
  types, missing fields and ambiguous coverage retain the retry. Missing visits,
  incomplete cycles, answer gaps and timeouts retain their separate reasons.
- The receipt does not increase the saved body-text completeness score or verify
  media, grading settings, learner behavior or source equivalence. Older captures
  and retry visits seeded with previous evidence cannot fabricate this receipt.
- Identical owner action text appears once per item. Original readiness findings,
  separate obligations, severities and counts remain available.
- Missing Moodle formula-rendering URLs prompt a formula-equivalence check rather
  than instructions to restore a navigation link. The missing URL and unresolved
  evidence remain recorded; the change does not assert that the formula survived.
- Exact TeX plus a matching spoken fraction compares as the same representation.
  Conflicting values or spoken copies cannot pass a fuzzy prefix match.

## Validation and limits

Six new synthetic regression cases cover retry selection, negative cases for
unreliable fields, duplicate identities, unsupported types, text-only questions,
non-question parts, historical/merged payloads, duplicate owner actions, formula
advice, and exact versus contradictory fraction representations.

The complete test suite and production build pass. The saved corpus replay covers
27 snapshots across 15 titles: 12 full comparisons across 7 titles and 15
capture-only reviews across the other 8. No replay errors or aggregate comparison
count changes were observed. Capture-only reviews are not source-fidelity tests.

Retrospective eligibility checks use final stored payloads, which may contain
recovery evidence. They cannot prove which receipts a future primary pass will
produce or establish a live speed improvement. The next naturally needed capture
can validate timing; no bulk recapture is required to apply these report fixes.

Private course captures and reports are not included in this repository.
