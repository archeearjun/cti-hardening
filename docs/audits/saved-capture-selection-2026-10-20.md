# Saved capture selection and read-only export

## Observed production failure

The operator's read-only diagnostic found two newer RUNNING captures (15 and 10
processed items) ahead of the retained 96-item/59-verified capture. The latter
contained 96 item records and 80 body records and passed all seven recovery
metadata predicates. Both newer runs failed acquisitionComplete, sourceStable,
and finalCourseMatches. Record counts establish presence, not byte integrity.

PR #92 and #93 used the same getActiveRun recovery call and eligibility guards.
The resume selector picked the newest unfinished run, so preparation rejected it
without considering the older eligible capture. Separately, Download was disabled
on startup until in-memory metadata existed, despite readable checkpoints.

## Correction

- Add explicit savedCapture selection: filter by the same build, run, acquisition,
  source-stability, stability-policy and initial/final course predicates before
  selecting the newest eligible row. Ordinary resume selection is unchanged.
- Preserve the seven-day storage selection window and course/run identity checks.
  Read-only selection is independent of acquisition budget headroom. A recovery
  attempt still validates its original budget and native/material proofs.
- Pin recovery's subsequent selection to the prepared run ID. Newer interrupted
  runs cannot replace its source, and changed material proof remains rejected.
- Keep bounded predicate diagnostics free of source content and credentials.
- Enable Download on a reopened bookmark. With no loaded capture, read the eligible
  saved snapshot, require every expected processed item, and export without a scan
  or saveRun call. Retain original contracts, source models, timestamps and stats.
  Packaging metadata may describe the newly built archive; checkpoint rows do not
  change. Existing body reads independently verify SHA-256 and byte size.
- Retain visible export errors and show when a download has been requested.

## Validation

The store regression recreates newer interrupted runs masking a completed v1.9.0
acquisition and verifies read-only selection, exact pinning, failed predicates,
budget-independent export selection and rejection of unstable source metadata.
Entry regressions verify preserved fingerprints/metadata, zero course requests,
zero checkpoint writes and a visible missing-item failure.
The existing mandatory browser suite now reloads the generated bookmark with two
newer interrupted runs, exports the historical capture, compares all checkpoint
records including original body hashes, then runs the existing publisher handshake
and source-bound byte-recovery assertions. No release gate or size limit changed.

Local execution-harness coverage is supplemental: hosted CI must independently
pass native javascript bookmark activation before merge. Synthetic recovery does
not establish successful recovery of the operator's real publisher image bytes.
