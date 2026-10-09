# Role Play & Dialogue preview

The CTI gateway links to `/activity-designer/index.html`. The gateway displays
“The complete workflow will be operational very soon.” alongside the activity preview. Full CTI inspection/reconciliation is owner-only;
other Access-permitted users can use the isolated activity workflow.
This is a preview, not certification that every Coursera content layout is read.

## Boundary

`src/activity-designer/` adapts the supplied Course Activity Designer modular
browser source. The current preparation app is 2.2.4; its default capture is the
maintained CTI Coursera v6.15.12 extractor. The separate 1.2.1 reader remains only
as an optional one-item diagnostic and backward-compatible input. It runs on a separate page,
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
does not provision or expand that policy. On 2026-10-08, a signed-out browser
reached the existing Cloudflare Access login screen at the production hostname.
An authenticated production journey remains unverified.

## Operator flow

1. Open **Role Play & Dialogue** from CTI. Select Content Map opportunities or
   final drafting/revalidation. Opportunity mode offers concepts, not paste-ready
   authoring fields or implied partner approval.
2. Add a current bulk capture, source package, current Coursera XLSX and useful
   reference documents. The primary Copy capture script button delivers the same
maintained CTI extractor used by reconciliation, including bounded waits, retries
and identity scoping. Run it in an
   already authorized Coursera tab. The one-item test is diagnostic, not a whole
   course scan. Loading a diagnostic cannot replace a saved full-course capture.
3. Prepare evidence. Inspect the nested course/module/lesson/item tree, source
   paths, unread material, prompt counts and associated option counts. A finished
   run or a readable excerpt does not mean complete coverage. Files added or
   removed from the queue do not discard already prepared evidence.
4. Search/select modules, then download compact packets and copy the separate
   chat message. The approximately 12,000-token target is characters divided by
   four, not a tokenizer or remaining-context meter. Oversized modules stay whole
   and are flagged. Scope exclusions remain explicit. If a packet includes teaching
   PDFs, download and unzip its packet ZIP, then attach the listed originals with
   the text packet; copying text alone does not transmit the diagrams. If the chat
   limits attachments, upload smaller batches in the same chat, ask the AI to wait,
   and send the review request only after the final batch.
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
  `Teaching_PDFs/<sha256>.pdf` citations resolve against retained hash-verified
  assets and their exact associated PDF text blocks, without borrowing viewer
  excerpts or another attachment's text. Image-only/failed-parse originals are
  available for visual review, not nonexistent files or verified teaching text.
  Cards offer the cited original PDF for download; AI page-review claims still
  need human content review. Both validation paths use the same source resolver.
  Exact `Enter an option...` editor placeholders are preserved as gap evidence,
  excluded from substantive choice counts and cannot receive learner-text
  certification. Reprepare old raw captures to update those derived metrics;
  this does not change the canonical extractor or its saved raw receipts.
  Unread practice in the proposed module, known missing prompts/options and
  unresolved capture defects block copying until comparison is possible. Mere
  partial/unknown completeness remains a review warning, never a completeness
  claim or a blanket ban caused by unrelated administrative gaps. Final drafts
  also need a self-contained case, concrete deliverable, adaptive interaction,
  observable criteria and explicit comparison with existing practice.
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
the unchanged CTI platform or vendor source. The frozen Apps Script reference is unchanged. The current repair changes the
maintained Coursera extractor only to retain exact ancestry and bounded original
PDF bytes; reconciliation business rules remain unchanged. See the dated repair
record for the latest scope and verified behavior.

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

The previously supplied 1.2.1 capture contains 96 items: 49 with readable text and
47 unread; only 4 of 26 assessment items have text. Its inspected quiz has 10
captured prompts and 34 captured option texts matching 34 visible choice
controls. This verifies those visible counts in that supplied capture, not all
hidden/randomized questions. A later user-supplied canonical capture was reviewed in the semantics follow-up linked below; the implementation session did not itself sign into the live LMS.

PDFs provide text layers/link annotations; original PDFs are now preserved where
already fetched successfully (8 MiB aggregate byte archive, 30 MiB saved-session
limit). Hash verification binds originals to exact item IDs. Assessment/key PDFs
are excluded from teaching attachment packets; the original CTI JSON is unchanged.
Parser failures preserve originals with an explicit warning. Diagrams, scans,
plugins, hidden/randomized questions and media still require actual visual or
external-content review. No OCR/video understanding or semantic AI verification
is claimed. New drafts may use clearly labelled fictional case data where the
method is substantively taught; they must not invent source diagram facts.

The Earthquakes IMSCC could not be read in the implementation session. It is now
listed among the supplied files, but retrieval has not completed. Current
constituent-course XLSX/capture exports were not supplied. No live source
equivalence or actual Earthquakes activity placements were verified.

The initial PR workflow passed all deterministic and browser checks. The tested
workspace may ship as the explicitly labelled preview through CTI's normal checked
pipeline, retaining existing Access and all evidence/copy gates. Live capture
verification is required before describing option recovery or representative
course coverage as established; preview availability does not imply that claim.

Latest implementation findings and checks: [Activity evidence repair, 2026-10-08](audits/activity-evidence-repair-2026-10-08.md).

Latest capture-state follow-up: [Activity capture semantics, 2026-10-08](audits/activity-capture-semantics-2026-10-08.md). Observed-empty destination practice needs source reconciliation; a learner-text receipt is separate from answer/configuration and source-equivalence checks.
