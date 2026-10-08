# Role Play & Dialogue preview

The CTI gateway links to `/activity-designer/index.html`. The gateway displays
“The complete workflow will be operational very soon.” alongside the independent
activity preview. Existing inspection/reconciliation workspaces remain available.
This is a preview, not certification that every Coursera content layout is read.

## Boundary

`src/activity-designer/` adapts the supplied Course Activity Designer modular
browser source (app 1.0.4; independent capture 1.2.1). It runs on a separate page,
isolated from React workspace state and existing extractor globals. There is no
Apps Script runtime dependency. The supplied standalone project remains unchanged.

`tools/build-activity-designer.mjs` generates ignored public assets during the
normal build. JSZip and the compatibility PDF.js reader/worker come from the
existing lockfile, including their licenses. A bounded native XML adapter replaces
the standalone XML dependency. Scripts and workers are same-origin external files;
the existing Content Security Policy is unchanged.

There are no new API routes, database tables, paid services or automatic course
edits. Files are processed in the operator's browser and saved by download. The
operator deliberately submits packets to their own work-approved AI chat. No
partner examples, captures, credentials or saved projects are included in the build.
Deployment must retain CTI's existing hostname-wide Access policy; this change
does not provision or expand that policy. Static access configuration has not been
verified by a live authenticated test in this implementation.

## Operator flow

1. Open **Role Play & Dialogue** from CTI. Select Content Map opportunities or
   final drafting/revalidation. Opportunity mode offers concepts, not paste-ready
   authoring fields or implied partner approval.
2. Add a current bulk capture, source package, current Coursera XLSX and useful
   reference documents. Alternatively run the read-only console capture in an
   already authorized Coursera tab. The one-item test is diagnostic, not a whole
   course scan. Loading a diagnostic cannot replace a saved full-course capture.
3. Prepare evidence. Inspect the nested course/module/lesson/item tree, source
   paths, unread material, prompt counts and associated option counts. A finished
   run or a readable excerpt does not mean complete coverage. Files added or
   removed from the queue do not discard already prepared evidence.
4. Search/select modules, then download compact packets and copy the separate
   chat message. The approximately 12,000-token target is characters divided by
   four, not a tokenizer or remaining-context meter. Oversized modules stay whole
   and are flagged. Scope exclusions remain explicit.
5. Import `ACTIVITY_RESULTS.json`. Cards show exact placement, authoring fields,
   estimated minutes and review checks. Decisions may be Role Play, Dialogue,
   no addition or hold. Unreviewed modules are not implicitly approved.
6. Review learner text, then copy the supported fields into Coursera yourself.
   Only a captured, identity-matched item route is offered as a deep link.
   Save the work ZIP to retain evidence and accumulated module results. After
   shell changes, prepare fresh evidence and revalidate; old results cannot be
   silently applied to a new snapshot.

The supplied map and outline examples informed the distinction between proposed
structure, revised structure and current linked shell evidence. They are design
references, not proof of current constituent course content or partner approval.

## Evidence and state contracts

- Capture remains `coursera-activity-capture`, schema 1; session remains
  `course-context-prep`, schema 1; results remain `course-activity-design`, schema 1.
  Added optional metrics and module IDs preserve legacy inputs.
- `cti-adapter.js` imports current CTI fingerprints through an explicit field
  allowlist: assessment prompts/options and supported learner instructions or
  identity-scoped teaching text. Keys, correctness flags, feedback, arbitrary
  metadata and generic assessment page text are excluded. Original CTI data and
  reconciliation rules are untouched. Missing hierarchy IDs remain unresolved;
  a matching current export can supply placement identity.
- New captures replace a branch snapshot atomically, independent of file order.
  Conflicting new captures, malformed saved hierarchies and ambiguous module
  decisions fail explicitly. Module results accumulate by identity; revalidation
  replaces that module, preserving unrelated results for the same snapshot.
- Snapshot title, timestamp and stage must agree. Both ZIP components and module
  decisions are checked before restored state changes. Failed preparation/import
  retains previous evidence/cards. Sessions are bounded to 30 MiB serialized UTF-8
  so saved sessions fit within the restore entry limit.
- `readiness.js` disables copying for missing/wrong placement IDs, false next-item
  boundaries, unresolved supporting paths and absent readable teaching support.
  Assessment-only evidence and capture receipts do not justify learner drafts.
  Assessment coverage uncertainty is a separate review warning, not a fabricated
  completeness claim or a blanket ban caused by unrelated administrative gaps.
- Learner fields/context are separate result fields, never an automatic dump of
  raw evidence. Container/key detection blocks obvious leakage and whole internal
  context documents. This is not semantic answer-leak detection: a human must
  review generated prose for indirect answers, invented facts and suitability.

## Validation and release limits

Confirmed issues addressed in this integration:

| Location | Evidence and impact | Severity | Correction and verification |
| --- | --- | --- | --- |
| `app.js`, `core.js` | Starting new preparation discarded useful prior state; capture merging could depend on file order. | High: lost work/stale evidence | Build a candidate before committing; replace captures by branch; failed-input and replacement tests. |
| `results.js`, `readiness.js` | A parseable result could expose copy controls despite stale/wrong placement; saved ZIP validation could occur after state replacement. | High: wrong course edits | Snapshot/boundary gates and pre-restore decision validation; stale-ID and invalid-ZIP browser tests. |
| `cti-adapter.js`, `readiness.js` | Rich CTI assessment data and whole internal documents are unsuitable learner context. | High: assessment disclosure | Explicit allowlist plus separate learner-result fields and copy gates; sentinel-key/raw-context tests. Semantic review remains manual. |
| `designer.js`, `compact.js` | Module names alone are ambiguous across repeated titles. | Medium: overwritten decisions | Optional exact IDs, ambiguity rejection and identity-based replacement; duplicate-name/packet-merge tests. |
| `app.js`, build tool | Real PDF import failed with `toHex` and document-cleanup API errors under the installed PDF.js version. | High: missing teaching | Existing CTI compatibility build and loading-task cleanup; actual PDF worker/text-layer browser test. |
| `shell-capture.js`, `compact.js`, evidence UI | Prompt/option metrics were lost during projection and packaging. | Medium: misleading coverage | Retain structural metrics and source dates through import, packets and saved work; round-trip tests. |
| `results.js` | Empty activities on hold implied no activity was needed. | Medium: misleading next action | Separate hold empty state; no-addition and held-result suites. |

All new first-party activity modules, retained standalone tests, build boundary,
gateway changes and relevant existing capture/package/authentication code were
inspected. This is a focused integration review, not a new comprehensive audit of
the unchanged CTI platform or vendor source. The original and frozen Apps Script
code and existing CTI extractors were not modified.

Run `npm run test:activities`, `npm run build`, then
`npm run test:browser:activities`. The normal `npm test` includes the new Node
checks and retained standalone suites. CI runs the browser checks too.

Coverage includes adapters, identity/order, parsing limits, malformed input,
capture replacement, cancellation, stale results, module accumulation, source/key
separation, placement gates and save/restore. Real Chromium tests use synthetic
Coursera routes and an actual local page under the production CSP. They exercise
rendered prompts/options, read-only traversal, wrong redirects, actual PDF.js
text extraction, packet search, ZIP recovery, literal HTML rendering and desktop/
mobile layouts. They do not authenticate to Coursera or certify live extraction.

The supplied live regression context remains unresolved: Percentage Quiz's
earlier one-item capture read 10 prompts and zero options. A prior diagnostic
observed 34 radio controls. The 1.2.1 option reader needs a new authorized one-item
capture to verify association counts and question text, followed by a representative
full-course capture to verify navigation. Do not describe that issue as fixed on
the basis of synthetic tests. PDFs provide text layers/link annotations only;
diagrams, scanned images, plugins, hidden/randomized questions and external media
may need bulk supplementation or review. No OCR/video understanding is claimed.

The supplied Earthquakes IMSCC was unavailable, and current constituent-course
XLSX/capture exports were not supplied. No live source equivalence or actual
Earthquakes activity placements were verified. Keep the feature isolated for
review until the live capture check and deployment Access check are completed.
