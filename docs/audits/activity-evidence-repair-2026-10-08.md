# Activity evidence repair — 2026-10-08

Scope: the maintained Coursera extractor's delivery/evidence handoff, activity
imports, packets, returned designs, saved work, UI feedback, and the existing
owner/colleague access boundary. The supplied live capture and two AI outputs
were inspected locally. No partner content, real captures or generated activities
are committed. This is not a fresh audit of the unchanged platform or every LMS.

## Confirmed defects and fixes

| Location | Evidence / user impact | Severity | Implemented correction / verification |
| --- | --- | --- | --- |
| `app.js`, build | Primary capture button used an independent reader instead of the requested maintained CTI extractor. | High | Build both delivery surfaces from the exact canonical source; byte equality regression. Existing diagnostic/old-input support remains. |
| `cti-adapter.js` | Discussion scope spelling differed from production; learner assignment blocks were omitted; canonical choices may use `label` rather than `text`. | High | Explicit supported-field projection, ordered repeated prompt/choice preservation, reliability flags. Sentinels confirm correctness, key, rubric and arbitrary metadata fields stay excluded. Scoped plugin bodies remain internal comparison evidence. |
| canonical `evidence.js` | Title path existed but module/lesson IDs were discarded. Same titles cannot establish exact identity. | High | Preserve ancestor IDs/keys in schema 35; nested/duplicate-title regression. Old snapshots still need matching placement evidence. |
| canonical `assets.js`, `entry.js`; `cti-documents.js` | Asset hashing discarded PDF bytes; downstream only had viewer excerpts. | High | Retain already-fetched PDF bytes within 8 MiB aggregate limit, SHA-256 addressed/deduplicated. Verify bytes before local parsing. Parse all supported pages and attach originals for visual review. Failed fetch/size limit is still a gap; no extra credential-bearing network path. Actual two-page PDF.js/browser ZIP test, checksum/limit/failure/protected-document tests. |
| `core.js` | XLSX for the same branch replaced the capture course and erased coverage metrics; stale captured documents could become shared unmapped evidence. | High | Join by branch and exact item ID, preserve capture timestamp, use current export placement, remove deleted capture rows and mark new items unread. Both file-order variants tested. This does not certify unchanged bodies after live edits. |
| `readiness.js`, `designer.js` | A cited unread item was incorrectly reported as nonexistent, twice. | Medium | Resolve documents, gaps and inventory separately. Known unread is valid gap evidence; invented path remains blocked. Actual supplied result/gap reproduction and synthetic regression. |
| `activity-quality.js`, prompts, `results.js` | AI draft asked for calculations using an unavailable plan/capacity, supplied a generic rubric and had unread practice. Copy buttons were nevertheless available. | High | Draft brief requires supplied case facts, learner deliverable, adaptive interaction, observable criteria, practice comparison. Known unread/missing question evidence blocks copying. New fictional examples explicitly permitted and labelled. Old result JSON remains importable, with regeneration guidance. Human semantic review remains required. |
| `results.js`, packets | AI confidence/no-addition language looked definitive; technical warnings obscured the action. PDF originals could not accompany compact handoff. | Medium | System readiness count, concrete next actions and available deep links, collapsed AI/technical notes, incomplete no-addition label. Selected packet ZIP includes originals and attachment instructions; text-only copy explicitly warns about omitted visuals. Desktop/mobile and saved-work tests. |

## Feature and trust boundaries retained

- IMSCC/ZIP, XLSX, JSON, PDF and supported reference import; local-only processing;
  opportunity versus final mode; selected module packets; complete text rather than
  silent truncation; previous proposals/feedback; item hierarchy and deep links;
  module result accumulation; failed import preserves previous state; ZIP recovery.
- No automatic Coursera write, publication, model/API call, database or D1 migration.
- Only the verified owner retains full CTI access. Shared static activity files
  include the capture helper necessary for this workflow; private APIs, workspace
  pages, unrelated downloads and assets remain denied to colleagues.
- Raw CTI inputs remain unchanged. The projection omits explicit key/feedback and
  credential metadata. Internal source bodies can contain worked examples; they
  are not automatically made learner context. Existing leak guards remain.

## Extractor review disposition

The archived Apps Script baseline is untouched. Coursera release becomes
`v6.15.11/schema35`, build `v6.15.11-activity-evidence-20261008`. Additive ancestry
and document archive fields preserve old capture imports. `assetDescriptor` retains
the document reference; `hashRemoteAsset` reuses successful bounded fetched bytes,
retains PDF magic-verified data only, and preserves existing time/byte/cache rules.
`fingerprintsFromMaterial` carries ancestry without changing item selection.
`activeSpaCrawl`, lock metadata and export names change release identifiers only.
The entry creates the bounded archive and includes it in the final result.
Exact version guards for item refresh and their current-release fixtures advance
with the release; historical capture fixtures remain historical. The reviewed
manifest and release metadata hashes record these intentional changes.

## Evidence and limits

The supplied capture contains 96 items, 47 unread, and text for only 4 of 26
assessment items. Twelve readings were viewer excerpts. These are capture gaps,
not evidence that the actual course is missing that content. The supplied final
AI proposal is now blocked on unread practice plus its missing design brief.
A known unread assignment is correctly resolved as an existing gap.

Local checks: 17 focused Node regressions, full deterministic suites, production
build and Worker dry-run. GitHub also runs the complete browser suite before merge. The real Chromium activity checks exercise
actual PDF.js parsing of both pages, original-byte packet ZIP, import failures,
stale results, design gates, JSON/ZIP restoration, search and desktop/mobile
layouts under the production CSP. Access tests use signed synthetic JWTs and
verify owner/colleague separation; they do not claim authenticated production use.

Unverified: a fresh canonical live capture of the user's course, inaccessible
frames/LMS documents, diagram/formula interpretation, hidden question pools,
semantic teaching fit, all facts in future GPT/Gemini output, and publication
approval. Structured checks reduce unsupported drafts; they cannot prove AI prose
is correct. Readiness is not approval. No claim of perfect extraction is made.

Deployment: normal verified-main → Pages mirror pipeline; worker release follows
the existing workflow. No new configuration or storage migration is required.
