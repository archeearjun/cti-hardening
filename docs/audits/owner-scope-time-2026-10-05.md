# Owner checklist scope, hierarchy and learner time

Implemented for the assignment-owner workflow. Coursera extractor v6.15.10,
schema 35; QA build v8.0.2-owner-time-evidence-20261005.

## Confirmed problems and corrections

| Location / evidence | Impact | Correction / verification |
| --- | --- | --- |
| OwnerEvidence, assignment-plan and handoff previously counted every flagged task, including Instructor Resources / Archive. Existing NAIT re-ingestion policy did not define owner checklist scope. | Medium: unnecessary publishing work and handoff requirements. | Shared owner-scope rules exclude exact named reference ancestors; preserve original findings. Owner can override per item. Domain and browser tests cover automatic exclusion, restoration, persisted choices and changed handoff basis. |
| Coursera path was displayed as a flat heading; normalizeCourseraItem_ dropped the XLSX parser's lesson field. | Medium: module/lesson relationships were lost before rendering. | Preserve lesson metadata into the owner view without changing module-level source matching. Accessible disclosures follow recorded order. Older reports can recover a deeper path from their exact item snapshot within the same module. Repeated later module names stay separate; missing placement is labeled. Browser test checks the actual import pipeline, nesting and 390px layout. |
| Retained payload duration was not projected into owner content evidence, review summaries or handoffs. | Medium: no usable module totals before/after edits. | Dated baseline and latest available time estimates; saved focused captures update totals. Reference/source-only items are excluded. Clipboard gives module totals and coverage without item links. Domain/browser tests cover a 25 to 40 minute module change after reload. |
| Number(null), Number('') and Number(false) could be treated as zero during normalization, merge, readiness or transformation evidence counting. | Medium: false zero-minute-video findings and misleading evidence coverage. | Require explicit finite nonnegative numeric evidence; preserve explicit zero. Targeted tests exercise unknown, malformed, zero and positive values and preserve preexisting data during missing observations. |
| Outline substring duration matching could read prose and item titles; exact editor time controls were not consistently captured. | Medium: inaccurate or stale time estimates. | Strict whole-field unit parsing and labeled editor controls, scoped to the observed editor, excluding learner prose/question parts. Explicit editor settings replace earlier outline values. Conflicting settings remain unknown. Real-browser tests cover labels, adjacent units, hours, zero, blank/hidden/unlabeled values and conflicts. |

## Product behavior and limits

- Default reference names: Instructor Resource(s), Instruction / Instructional
  Resource(s), Archive(s). Match ancestor names, not arbitrary title/body words.
  Student Resources remains included. Source-only tasks may inherit source
  reference scope; a learner-facing destination cannot be hidden solely by an
  archived source match.
- Every owner item has Automatic / Relevant / Not relevant choices, with an
  explicit save. Excluded items remain accessible in a separate view and retain
  raw findings and prior review evidence. They have no publishing checklist task.
- Choices are saved for the current report. A new full comparison starts with
  automatic scope; its independent evidence is not silently assigned a prior
  report's exclusions. Changing a choice invalidates prior handoff sign-off.
- Both duration columns use current relevance. Baseline is the report capture;
  latest available combines that baseline with newer saved item checks. An older
  check cannot supersede the baseline. Missing/failed fresh observations become
  unknown, never a manufactured zero or an unmarked reused baseline. Partial
  totals carry captured/total counts. These are learner estimates, not repair
  labor estimates or Macmillan's separate deterministic planning-time model.
- Import a fresh item-check JSON after editing Coursera, or run a new full
  comparison. This is not an automatic live connection. Historical captures
  without duration evidence remain unknown; importing their original extraction
  can recover durations only if those values were actually recorded.
- No source content, Coursera publishing state, raw audit decision or global
  source/capture identity safeguard is changed by an exclusion. The original
  report export remains historical evidence, while its follow-up scope and
  module totals explain the current publishing work.
- The extractor recognizes explicit supported settings/outline fields. No claim
  of universal live Coursera layout coverage, elapsed media duration, inferred
  source study time, or authenticated LMS acceptance is made.

## Regression coverage

`tests/owner-scope-time.test.mjs`, `tests/assignment-plan.test.mjs`,
`tools/browser-owner-scope-check.mjs` (part of the owner browser gate), and the
time-control cases in `tools/browser-assessment-choices-check.mjs` cover the
changed rules. Existing full engine, extraction, export, storage and browser
checks remain required. Reviewed engine/extractor hashes are recorded in the
migration ledger; the Apps Script archive is unchanged.

Local verification: 346 Node tests pass, as do retained legacy checks (222 fast
and 20 source-contract checks), production build/typecheck, owner browser checks,
responsive workflow checks, real-browser choice/time-control checks and the
Worker deployment dry run. Desktop and 390px screenshots were inspected. These
are fixture and build checks, not authentication against a real course.
