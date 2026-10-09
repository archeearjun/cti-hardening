# Assignment navigation correction — 2026-10-09

## Confirmed defect and evidence

The Operations Section capture from 2026-10-09 07:44:54 UTC (v6.15.11,
schema 35) retained a module description as item `blyBd`, named `Assignment`.
The diagnostic recorded an editor score of 0.95, no route change, no assignment
parts and zero direct React navigation attempts. Its strict assessment receipt
correctly remained incomplete; the activity designer consequently held the
proposal for missing assessment evidence.

The user's subsequent published Assignment screenshots show an AI-graded file
upload prompt: preparing an ICS 234 before a Tactics Meeting, group directions,
expectations and an Agency Administrator briefing. Rubric controls are visible,
but their full contents were not established by these screenshots. The separate
Summative Assessment concerns ICS 215. These observations establish readable
current assignment content, not that the entire capture is complete or that a
proposed Role Play is non-duplicative.

`scoreSurfaceForFingerprint` in `src/extractors/coursera/evidence-2.js` gave
0.93 to the substring `Assignment` in module prose mentioning `assignments`,
plus 0.02 for an input. `isGenericSmartIngestionName` did not recognize the
plain label `Assignment`. This made a failed native interaction appear to open
an editor, suppressing the existing navigation fallback. Severity: high for
capture reliability and downstream activity grounding; no evidence of lost or
modified Coursera content.

## Implemented correction

Coursera extractor v6.15.12 / schema 35 treats common item labels as generic.
Generic body/heading text alone cannot prove an item editor. Existing strong
item-session plus independent editor signals remain available; a mounted
published assessment layout on the exact course/item route is also accepted
without editable inputs or repeated activation. A missing surface therefore
continues through the existing bounded, read-only navigation fallback.

The console bundle, item refresh/version guards and delivered release identity
are updated together. The frozen Apps Script reference, assessment completeness
contract and activity evidence gates are unchanged. Reviewed parity changes
cover the two navigation helpers plus export name, run lock, crawl metadata,
entry version and release registry; no legacy feature was removed.

## Verification and remaining limits

The pre-change focused extractor baseline passed 41 tests. A new reproduction
failed against the old scorer with the observed 0.95 false acceptance, then
passed after the correction. Regression cases also exercise bare generic
headings, genuine published layouts, another item's route, disconnected
editors, and the strong-session requirement for generic reading dialogs.
A rendered, offline Chromium reproduction is included in the browser gate.
Local verification: `npm test` passed all 379 native tests and seven activity
simulation suites, plus the retained regression harness and module checks;
`npm run build` passed type checking and production compilation;
`npm run worker:check` passed the packaging dry run. The legacy harness adapter
loads current helper dependencies while preserving its original assertions.

The original JSON cannot recover the missing body retrospectively. A fresh live
capture is required to establish whether `blyBd` now contains its complete
question, briefing and rubric evidence. This patch does not certify the unread
participant workbook, external documents, every course, or the pedagogical
non-duplication decision. It must not automatically release held proposals.
