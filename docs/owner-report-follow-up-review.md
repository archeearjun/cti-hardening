# Owner-report follow-up exports, 2026-10-04

## Confirmed defect

`web/FullWorkspace.tsx` exported `report.report` for text/clipboard and `report`
for JSON. `OwnerActionCard.tsx` correctly saves focused captures, plugin checks
and notes in separate `item-review` records; list summaries omit raw captures.
None of those records reached any report export. Severity: medium. The user
could save fresh evidence and still share only an older finding, causing
unnecessary repeat checks or uncertainty about whether the import worked.

The supplied owner report (6) still has v6.15.7 unknown survey types despite the
separately supplied v6.15.9 focused capture proving both types and seven options.
The text export cannot establish whether that check was actually saved in the
user's workspace or whether a different saved report was selected. Its ingestion
actionability also differs from report (5): `UNKNOWN` versus `LATEST_APPLIED`.
This export fix does not infer or silently change that business input.

## Implemented behavior

- Text and clipboard exports prepend a dated saved-follow-up section. It shows
  saved outcomes/notes, capture versions and dates, question types, prompts,
  option texts, answer-coverage uncertainty, expected-reference observations,
  and plugin-page evidence limits. The original audit follows unchanged.
- JSON exports retain the original report/result and add a separate `followUp`
  envelope containing the complete saved focused and plugin captures.
- Export reads full records from the current store with four reads at a time,
  scoped to the exact audit and package. Read failures, mismatched identity and
  versions changed since listing fail visibly instead of exporting partial work.
  Cancellation during loading prevents a completed download.
- Observational item evaluations are recomputed. Neither manual completion nor
  captured options clears an original finding or certifies publication. Plugin
  screen captures cannot assert full plugin verification.
- Zero saved follow-ups is explicit. Work on another saved report is not carried
  over, and unsaved notes are not represented as saved. UI explains that a new
  comparison is unnecessary: return to the report that generated the script.
- Export omits review-author email metadata. No source/engine rules, snapshot
  scores, extractor code, storage schema, authentication or deployment settings
  change.

## Verification

All 237 Node tests and retained legacy/module checks pass; production
build/typecheck pass (existing large-chunk advisory remains). Six new tests
cover original-evidence preservation, four/three options without answer-key
claims, scope filtering, absent follow-ups, read failures, stale versions,
malformed/misattributed evidence and manual-only/historical records.

The real-browser owner suite checks empty-state exports, saved item/plugin
captures and manual notes after reload, text/clipboard/JSON export content,
immutable original results, exact source downloads, wrong-item rejection and
390px layout. A local replay using the supplied report (6) and v6.15.9 JSON
exports all seven options with answer coverage unresolved and the original
report unchanged. This replay simulates the saved review record; it does not
establish the contents of the user's authenticated workspace.

## Operator step

After updating CTI, open the saved report that generated the focused script.
Import the downloaded item-check JSON there if it is not already saved, then
use Download complete report. Its first section should count that focused item
check. No new whole-course extraction or comparison is needed for this export.
