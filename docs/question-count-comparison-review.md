# Source versus Coursera question counts

## Confirmed defect and correction

Owner cards buried native source/destination counts in a sentence and omitted
count comparisons entirely for external source quizzes represented by a wrapper
page. Numeric zero defaults in historical structured-comparison records could
also be mistaken for a confirmed empty destination. Impact: owners could see an
empty quiz without knowing whether CTI had established the expected source
questions. Severity: medium (incomplete and potentially misleading remediation
information); existing audit gates still identified unresolved items.

`src/domain/question-counts.ts` now adapts existing saved evidence into typed
question-count comparisons. `owner-actions.ts`, `QuestionCountPanel.tsx`,
`workflows.ts` and `owner-report-export.ts` use these in owner cards, new reports,
and exports of old saved reports. Zero requires a confirmed empty-editor finding
or valid focused empty-editor receipt; absent evidence remains null/unverified.
Source definition totals, captured destination positions, declared counts,
completeness, source references, and question-selection settings remain distinct.
Counts never change an audit score, clear a finding, or assert course-wide loss.
Shared carriers are not treated as directly matched assessments or summed.

A review can save an exact-source count reference with count, evidence type,
URL, date and section/counting note. Published lists, manually reviewed live
banks, and per-attempt counts have distinct labels. Reference scope is bound to
the saved report's source ID/path/name. Counts conflicting with captured source
counts demand reconciliation. Validation runs through normal workspace record
validation on both browser and shared-store writes, and again during export.
Unsafe URLs, invalid counts/dates, duplicate source references, and wrong source
bindings are rejected. Full stored records are read before export; read failures
abort it. The original report and raw evidence are preserved.

## Verification

Targeted tests cover unknown versus confirmed zero, partial source/destination
captures, question pools, external references, source conflicts, malformed input,
focused updates, shared carriers, scope checks and immutable exports. The owner
browser check saves a reviewed count, rejects an unsafe URL, reloads the page,
and checks text/clipboard/JSON exports and responsive layouts at 1440 and 390px.
Existing item-gap and media assertions remain in place; the removed count-only
summary sentence is replaced by assertions on the new typed comparison.

The existing TRDE120 saved evidence was inspected with the adapter: Week 1 has
2 source definitions / 0 destination positions; Survey has 2 / 2; Final has
10 / 10. Matching counts do not resolve Final's broken image prompts. Percentage,
Decimals and Working with Units have unverified source totals / confirmed empty
destinations. Their source evidence consists of external wrapper URLs.

## Limits and operation

The initial count-presentation change did not automatically crawl external quiz
banks. The subsequent [automatic source fetch](automatic-source-questions.md)
now reads supported public BCcampus H5P definitions from the recorded source URL.
Counts are never inferred from titles, screenshots or generic page text. It does not insert course-specific
counts into code. The initial publisher-list research established 10 Percentage, 11 Decimals and
9 Units questions. The later automatic-source probe independently read these
H5P banks and also observed that Decimals selects 10 from its bank of 11. Saved
automatic source captures can now supply these expectations; the earlier
research alone remains separate from the original saved audit. Existing
saved reports can be opened and exported without a full-course recrawl. Users
can fetch supported source definitions from the item card; reviewed references
remain a fallback for unsupported sources. A working embedded
activity remains a legitimate way to preserve questions without native question
records. No deployment configuration, database migration, or extractor version
change is required.
