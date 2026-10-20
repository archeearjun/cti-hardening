# Independent source and destination evidence — targeted hardening

## Baseline and claim boundaries

New comparison reports identify engine build `v8.0.3-bilateral-evidence-20261021`.
Implementation starts from deployed main `7de171178f67273e0a1baec86024b75018cf3392`.
The uploaded v1.9.4 `capture.json.gz` has SHA-256
`6d7120892fb5d197b6ed75d264e1d365d095a8be56bd1eb87dea5950e0603952`.
The original upload is unchanged. It records 96 inventory items, 62 complete
items, 21/26 assessments and 40/65 readings. There are 34 incomplete items.
LFrHs records ten complete AI/rich-text **draft** questions; SekFW and hspvR
record complete current published readings. The independent capture validator
reports no new invalid manual-draft or published-reading proof.

This upload contains no embedded original files and is not the companion ZIP.
The validator consequently cannot replay 22 complete-reading original-media
proofs from this JSON alone. That is an evidence-input limitation, not proof of
lost media. The 343 historical publisher source observations, 342 unique
publisher originals, seven full-size 404 receipts and 422 previously validated
original files remain the prior evidence baseline. They were not re-downloaded,
modified or independently byte-validated again in this change.

No new authorized live Brightspace response or original IMSCC was supplied.
Source conclusions below distinguish code/fixture verification from live-course
verification. The earlier detailed matrix remains applicable:
`source-extractor-assessment-2026-10-20.md`.

## Confirmed defects and implemented corrections

1. **Source sample hashes could certify complete text parity.** Package resource
   hashes cover collected normalized fragments; they need not cover the entire
   original body. The comparison's equal-hash shortcut did not first honor
   `evidenceTruncated`. The new source scanner, v6.8.9, records versioned text
   coverage and explicit hash scope. Original-file hashes remain separate.
   Text read failures are explicitly incomplete, and a failed HTML parse no
   longer falls back to treating raw markup as verified learner prose.
2. **Destination incompleteness disappeared during normalization.** Native
   incomplete-body contracts were omitted from the normalized comparison item
   and XLSX enrichment. The new negative-evidence projection retains exact item
   identity, capture status and reasons. All 34 observed incomplete contracts
   survive. It never grants completeness from a saved `complete: true` flag.
   Exact-ID enrichment is required. Existing positive asset/link evidence stays
   available, but an incomplete native body cannot supply an exhaustive-absence
   confidence score.
3. **Unread destinations could produce confirmed missing items.** The previous
   recovery exception only covered certain link carriers or reconciliation
   candidates. An unmatched non-link item could be `MISSING` during incomplete
   editor traversal. It now remains `UNVERIFIED`, with `standaloneMatch:
   NOT_FOUND`, unresolved destination IDs and a separate evidence-availability
   check. Known incomplete source text likewise prevents that definitive absence
   claim. Independently observed type, placement and publication differences
   are retained.

These are bounded verification/comparison corrections. They add no LMS endpoint,
transport, automatic publication or external challenge bypass. Coursera capture
v1.9.4 and Brightspace capture v1.2.1 remain unchanged. Raw evidence remains
separate from the derived version-1 limitation records. Old snapshots are not
rewritten; new scans/comparisons apply the current rules.
Deployment verification now also triggers for source-extractor, package scanner
and comparison-engine changes. It uses the same existing mandatory CI,
production-mirror and private Worker/Pages verification gates.

## Before/after, independently exercised against deployed main

| Case | Before | After | Evidence level |
|---|---|---|---|
| Equal text hashes, source explicitly truncated | `VERIFIED` | `UNVERIFIED` | Same deterministic fixture run against deployed-main worktree and changed worktree |
| Native incomplete-body contracts retained by normalization | 0/34 | 34/34 | Actual uploaded capture; contract-only sanitized regression fixture |
| Unmatched non-link source with unread destination editor | `MISSING` | `UNVERIFIED` | Full source/XLSX/JSON comparison fixture against both worktrees |
| Complete equal text without these gaps | `VERIFIED` | `VERIFIED` | Positive fixture |
| TRDE120 acquired/complete item count | Recorded 62/96 | Unchanged | No new live capture; JSON alone lacks original-media bytes |

## Source LMS coverage and gap matrix

| Area | Supported evidence | Remaining boundary and next acceptance criterion |
|---|---|---|
| Inventory and hierarchy | Native Brightspace inventories; IMSCC manifest structure; explicit ordering uncertainty | Confirm real pool/library and repeated-placement membership; never invent interleaving |
| Text and discussions | Supported native bodies and discussion XML; bounded normalized text | **Implemented:** explicit sample/hash scope and parse/read failure propagation. Full original and complete semantic body remain distinct |
| Assessment definitions | Supported native/QTI structures, IDs, choices and authorized keys | Unknown interactions, randomization and pool completeness require actual source models; no flattening into generic questions |
| Rubrics | Retained native/configuration observations and original rubric documents where acquired | Dedicated criterion/level/point inventory needs source-bound response evidence |
| Attachments and binaries | Bounded hashes/originals, known course-owned routes, signature-checked DWG | Unsupported routes, encrypted/unreadable files and budget limits stay unresolved; original ZIP retrieval is separate from samples |
| PDF/office content | Original bytes where available; bounded PDF semantic samples | Full-document interpretation/OCR is not established by snippets |
| Rise/SCORM/media/plugins | Runtime markers, URLs and embed configuration | Reference presence is not runtime body, captions or playback; obtain one authorized original package/provider response |
| Learning time | Existing explicit metadata retained where supported | No established authored source-duration contract in inspected source paths; never substitute capture elapsed time |
| Rechecks/history | Checkpoints and immutable stored input versions | Dependency-aware source item refresh remains a separate acquisition workstream |

The source pass improves verification on existing supported inputs. It does not
claim a newly supported native rubric, numeric-question, time or runtime API.

## Coursera coverage and gap matrix

| Mechanism | Observed current coverage | Remaining boundary |
|---|---|---|
| Manual draft | LFrHs: ten acquired AI/rich-text definitions, complete draft | Published learner body unavailable; original published-pointer lifecycle remains unresolved |
| Published readings | SekFW, hspvR: supported source-bound published CML | Do not equate published/draft/historical content |
| Inline widgets | 54 provider configurations across 24 incomplete readings | External instructional bodies not certified; the 108 initial/final target observations in this capture point to opentextbc.ca |
| Standalone plugins | PqH4G, 9vHC7: configurations retained | External bodies/launch/playback unverified |
| Native recheck | 1fv6W incomplete | Preserve both explicitly empty source choices; do not invent answers |
| Unsupported state | Assignments 4ERR6, VF1sb, ygwPJ, AqZ8g; coaches v4SeI, 4u4Kk | Need current source-bound model/request evidence, not guessed authoring contracts |
| External attachment | NGwET remains incomplete | Original attachment acquisition unresolved |
| Publisher media | Historical observations retained during current challenge | No known404 retries or challenge bypass; current failed/skipped reads do not erase history |
| Kaltura, Role Play, Dialogue | No new source-bound response establishing acquisition in this upload | Existing tools/configuration are not a verified external-content contract; collect minimal authorized evidence before implementation |

**Implemented:** native negative evidence survives comparison normalization and
cannot support false full-body parity or an exhaustive missing-asset claim.
No acquisition count or completeness threshold was relaxed.

## Canonical comparison and artifact readiness

Derived limitation records are versioned, identify the platform/item and retain
the original reason codes. Platform-specific validators remain responsible for
positive completeness. This is not a universal complete-content flag.

Existing structural matching, ambiguity review, transformed-content evidence,
native question comparisons and publication reporting remain operational.
The patch closes the demonstrated negative-evidence losses; it is not an audit
certificate for every high-confidence verdict or matching heuristic.
Additional/duplicate-item conclusions and all remaining transformation branches
still require dedicated proof-boundary regressions before claiming exhaustive
bilateral parity.

No global media-complete requirement was added to outline/content-map generation.
Available verified instructional text and hierarchy can support their applicable
fields; unread widget bodies, unknown questions and uncertain ordering must be
disclosed wherever they affect the artifact. Whole-item parity remains unavailable
when relevant evidence is incomplete. Artifact readiness is purpose-specific.

## Validation and minimal operator steps

`tests/bilateral-evidence-coverage.test.mjs` covers positive equality, truncated
source equality, unread originals, HTML parser failure, exact-ID enrichment,
all 34 observed destination gaps, independent draft/published statuses and the
full unmatched-item comparison workflow. Existing native/manual/privacy and
source tests remain mandatory. Final CI and deployment results are recorded in
the release PR.

After deployment:

1. Reopen the existing source and destination evidence and run a **new comparison**;
   preserve the previous report. No fresh LMS capture is required for these
   comparison corrections.
2. For the new source text-coverage fields, rescan the **same original IMSCC** into
   a new evidence revision, preserving the old scan/package. Do not re-export a
   course merely to exercise these rules.
3. Use the companion latest CTI ZIP when validating original-media proofs.
   Supplying that existing archive is sufficient; do not repeat known404 reads.
4. For the next acquisition increment, provide one existing original IMSCC or
   Brightspace evidence archive with an identified unsupported item. For a native
   rubric/pool, include only the authorized definition response and its course,
   item and version binding—no learner submissions, cookies, headers or tokens.
5. For a Coursera coach/Kaltura acquisition contract, inspect one exact authoring
   editor and retain the read-only operation/method, safe field projection,
   variables and sanitized response with item/atom/course/version binding. Do
   not start a learner attempt or include signed URLs, editing credentials or
   private learner data. This capture does not establish those APIs.

The system is suitable for bounded evidence review on additional titles with
supported inputs and explicit gaps. It is not yet justified to promise complete
source extraction, arbitrary runtime acquisition or migration parity across all
course types.
