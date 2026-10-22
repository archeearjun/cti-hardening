# Role Play & Dialogue preview

The CTI gateway links to `/activity-designer/index.html`. The gateway displays
“The complete workflow will be operational very soon.” alongside the activity preview. Full CTI inspection/reconciliation is owner-only;
other Access-permitted users can use the isolated activity workflow.
This is a preview, not certification that every Coursera content layout is read.

## Boundary

`src/activity-designer/` adapts the supplied Course Activity Designer modular
browser source. The current preparation app is 2.3.0; it saves the same universal
**CTI course capture** bookmark used by inspection and reconciliation. There is
no separate Role Play or Dialogue course extractor. Its `.cti.zip`, JSON and
`.json.gz` files are read directly. The separate 1.2.1 reader remains only
as an optional one-item diagnostic and backward-compatible input. It runs on a separate page,
isolated from React workspace state and existing extractor globals. There is no
Apps Script runtime dependency. The supplied standalone project remains unchanged.

`tools/build-activity-designer.mjs` generates ignored public assets during the
normal build. JSZip and the compatibility PDF.js reader/worker come from the
existing lockfile, including their licenses. A bounded native XML adapter replaces
the standalone XML dependency. Scripts and workers are same-origin external files;
the existing Content Security Policy is unchanged.

There are no new API routes, server database tables, paid services or automatic course
edits. Files are processed in the operator's browser and saved by download. The
operator deliberately submits packets to their own work-approved AI chat. No
partner examples, captures, credentials or saved projects are included in the build.
Deployment must retain CTI's existing hostname-wide Access policy; this change
does not provision or expand that policy. On 2026-10-08, a signed-out browser
reached the existing Cloudflare Access login screen at the production hostname.
An authenticated production journey remains unverified.

## Activity Studio RC1 operator flow

1. **Prepare evidence.** Reuse the current CTI capture, source package, Coursera
   XLSX and available outline/map. No new capture is needed just for approval.
2. **Review recommendations.** Send the existing compact packet to an approved
   external AI chat. All ordinary packets now request `mode: opportunity`, even
   if the UI stage says final. Each proposal describes one ungraded Role Play or
   Dialogue, its learning goal, placement, source evidence, existing-practice
   comparison, incremental value, learner time, confidence and limitations. Zero
   activities is valid; module decisions can recommend neither.
3. **Approve plan.** Import `ACTIVITY_RESULTS.json`, enter your reviewer name and
   explicitly Approve, Reject or Hold each proposal. Revise changes the proposal
   and resets only its approval; unchanged decisions survive packet merges.
   Provisional map/outline placements retain missing IDs and their reference path.
   They can receive concept approval but cannot generate final fields yet.
4. **Generate content.** Select **Prepare approved content handoff**. The ZIP
   contains only approved activity proposals and their module evidence, existing
   practice, relevant PDFs and shared references. Unmapped source documents remain
   shared to avoid hiding evidence; this is not a guarantee of minimal token size.
   Send this packet to the external AI. It must copy proposal metadata and
   `approval_ref` unchanged, add complete fields and the detailed design brief,
   and return final `ACTIVITY_RESULTS.json`. A blocked approved proposal requires
   evidence/revision or an explicit Hold decision before the remaining plan can
   be handed off. Held/rejected/unreviewed proposals are never generation targets.
5. **Review fields.** Import the final result. Approval gates are additional to
   placement, source, duplication, design and detectable answer-leakage checks.
   Review semantic correctness and interaction quality yourself. Copy supported
   fields into Coursera manually; no publishing occurs.
6. **Save work ZIP before closing.** It includes the unchanged prepared evidence,
   result, recommendations and approval record. To resume, use **Choose result
   file** and explicitly check **Restore my saved human decisions**. Never treat
   an AI-generated ZIP as your own human approval. The smaller **Download approval
   record** is a review receipt; restore uses the full work ZIP, not that receipt
   alone. For changed evidence, keep the old work ZIP and start a new review in a
   fresh tab. Adding a saved ZIP to Prepare files creates a new evidence basis;
   it is not the same operation as restoring unchanged work.

## RC1 approval and compatibility contract

`ACTIVITY_APPROVAL.json` is a separate `cti-activity-approval`, schema 1 artifact
(maximum 8 MiB; 1,200 entries; 2,000 decision-history events). It binds the plan
ID, course title, original session timestamp and SHA-256 of canonical prepared
session data to exact normalized proposals, their hashes/revisions, and explicit
reviewer decisions. History retains earlier human decisions after revisions or
removal. No source body or original file is changed to attach approval. Snapshot
hashing excludes only the UI phase and app version; changing phase no longer
rewrites `created_at`. Changed source text, hierarchy, references or timestamps
invalidate approval. Frozen prepared sessions cache their hash; mutable imports
are rehashed. Hashing uses the already bundled SHA-256 implementation.

The result schema remains `course-activity-design`, version 1, with two validated
optional extensions: `recommendation` and `approval_ref`. Unknown AI approval
flags do not become decisions. An approval reference binds the exact plan,
snapshot, proposal and decision revisions. Final imports with approval references
are rejected atomically when any reference, type, placement, objective, evidence
or recommendation differs. New field wording and its design brief still undergo
the existing checks. Revoking approval immediately disables copy/export fields. Work ZIP restoration
retains an older generated draft after revision or revocation as review-only; it
never reinstates that draft’s approval. New final-result imports remain strict.

Legacy sessions and results still parse. Legacy final results without approval
references are **review-only**, with an explicit missing-human-approval message;
no copy-ready field files are exported. Migration: restore the old evidence,
request recommendations with the current packet, review each one, then generate
new finals through the approved handoff. Do not relabel an old AI draft approved.
Older app versions do not enforce this boundary; use RC1 to resume approved work.

Decisions are saved synchronously in local browser storage under a dedicated
`cti.activity.approval.v1:` key before they can authorize a handoff. No original
course bodies are added to that store. Quota/disabled-storage failures do not
apply a new decision. Generation, final import and copy controls check that the
saved plan still matches; a change from another tab blocks the stale plan. Work
ZIPs remain the portable restore path, including the evidence itself. Clearing
site storage removes local decisions, so keep work ZIPs.

This is a local human workflow record, **not a signed approval or authorization
system**. A checksum detects mismatches, not a maliciously rewritten artifact.
The app requires explicit confirmation before restoring declared human decisions;
it cannot independently identify the person who edited a local file. Access and
the owner-only full workspace remain unchanged. Generated semantic claims,
source visual interpretation and originality still require human review. Existing
answer-key patterns detect some leakage, not all paraphrased protected answers.
Graded Role Play is unsupported.

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
- `unified-capture.ts` compiles the maintained ZIP/gzip transport importer into
  this isolated page. Archive paths, CRC, body SHA-256 and reference ownership
  use the same checks as CTI inspection. JSON retains the 128 MiB transport
  bound; original archive bytes remain separate from the activity session.
  Bound draft CML reading/discussion projections can be prepared directly.
  Native Role Play/Dialogue or other unknown item configuration stays in the
  original capture exactly as retained; unknown field semantics, empty values
  and runtime dialogue are never invented or promoted to readable teaching.
  Current, identity-bound reading PDF originals enter existing teaching packets
  only after integrity checks and within the separate 8 MiB saved-work limit.
  Other originals remain in the full capture with an explicit packet-limit note.
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

| Location                                      | Evidence and impact                                                                                                                    | Severity                       | Correction and verification                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `app.js`, `core.js`                           | Starting new preparation discarded useful prior state; capture merging could depend on file order.                                     | High: lost work/stale evidence | Build a candidate before committing; replace captures by branch; failed-input and replacement tests.                                   |
| `results.js`, `readiness.js`                  | A parseable result could expose copy controls despite stale/wrong placement; saved ZIP validation could occur after state replacement. | High: wrong course edits       | Snapshot/boundary gates and pre-restore decision validation; stale-ID and invalid-ZIP browser tests.                                   |
| `cti-adapter.js`, `readiness.js`              | Rich CTI assessment data and whole internal documents are unsuitable learner context.                                                  | High: assessment disclosure    | Explicit allowlist plus separate learner-result fields and copy gates; sentinel-key/raw-context tests. Semantic review remains manual. |
| `designer.js`, `compact.js`                   | Module names alone are ambiguous across repeated titles.                                                                               | Medium: overwritten decisions  | Optional exact IDs, ambiguity rejection and identity-based replacement; duplicate-name/packet-merge tests.                             |
| `app.js`, build tool                          | Real PDF import failed with `toHex` and document-cleanup API errors under the installed PDF.js version.                                | High: missing teaching         | Existing CTI compatibility build and loading-task cleanup; actual PDF worker/text-layer browser test.                                  |
| `shell-capture.js`, `compact.js`, evidence UI | Prompt/option metrics were lost during projection and packaging.                                                                       | Medium: misleading coverage    | Retain structural metrics and source dates through import, packets and saved work; round-trip tests.                                   |
| `results.js`                                  | Empty activities on hold implied no activity was needed.                                                                               | Medium: misleading next action | Separate hold empty state; no-addition and held-result suites.                                                                         |

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
