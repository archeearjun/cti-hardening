# TRDE120 recovery accounting and native acquisition review

Base: fetched `origin/main` at `9669216fe46590320f15eebc328eedf7711b377a`
(PR #94), preserving its saved-capture selection and export behavior.

Evidence: independent audit `/workspace/cti-evidence-audit/evidence-audit.txt`,
`failed-images.json`, `retained-inline-images.json`, and the original archives.
Earlier ZIP: 34,799,097 bytes, SHA-256
`540bcc7729adc0c0ddf348f20185db0475bd57504d6b27c6084f47fad2c9a904`.
Recovered ZIP: 52,534,691 bytes, SHA-256
`bb989242083e93133021f0858019dfd6d08fabad5ace3d3772456eee5afbd457`.
Neither archive is modified or committed. Public publisher slices and the exact
source-empty question definition are checked in under `tests/fixtures/cti-audit`.
This work does not repeat the full audit or retry the seven known 404s.

## Recovery defects

The planner previously pinned page observations only while adding pending image
jobs. Five pages with no image inventory therefore lost their recovery-plan
entry and acquired `PAGE_NOT_PLANNED` failures. Pinning validated page evidence
independently of jobs preserves those original observations and timestamps.
Recovery records `NOT_REFETCHED`, and carries forward earlier failure receipts.
A skipped duplicate cannot hide an actual failed read of the same target.

Summary accounting separates source URLs, content-addressed files, retained
bodies, skipped reads, reused observations and attempted failures. First-party
404 classification requires the validated attempt, not just a reason string.
Authored wrapped inline images are derived as supplemental relationships;
they never replace failed full-size originals or alter the inventory.

Read-only replay of the unchanged recovered capture produces:

| Measure | Old accounting | New accounting on existing evidence |
| --- | --- | --- |
| Publisher targets | 44 | 44 |
| Stored successful observations | 38 | 38 |
| Historical bodies | 5 | 5 |
| Current publisher page failures | 6 | 0 |
| Explicit skipped publisher reads | not separated | 6 |
| HTML reads during recovery | incorrectly failed | 0; 44 skipped |
| Saved image source URLs | 343/350 | 343/350 |
| Distinct publisher files | not separated | 342 |
| Missing full-size sources | 7 | 7 validated HTTP 404s |
| Missing originals with saved authored inline evidence | not linked | 7 |

The old archive has no explicit read-scope field on its 38 successful observations;
these are preserved historical observations, not newly fetched pages. A new
recovery marks every page as not refetched. The five zero-image fixtures now
produce five pinned page entries, zero image jobs and zero false failures.
No-body page 104 remains unavailable, with its earlier 401 receipt retained.
All 80 native originals and 59/96 real-course verified items remain unchanged.

## Native scope and limitations

The ten literal manual part IDs in `LFrHs` now have bounded supplementary
acquisition code using the manual-question resource name already recognized
by the renderer. It does not route manual parts through machine question groups
or invent a version suffix. Two matching observations are required for the
supplementary view, with exact owner/part identity, timestamps, status, raw-model
hashes and a final native stability observation. Full sanitized JSON retains
original prompts, choices, empty fields and grading metadata. Unsupported
semantics still prevent completion.

**The exact manual endpoint and response contract are not established by the
provided archives. This is a candidate acquisition path tested with synthetic
responses, not a verified live acquisition improvement. Keep this PR in draft
until an authenticated request/response from the actual manual editor confirms
its route, identity and schema.** Ten-part fixture improvement: zero raw manual
definitions to ten pairs of stable observations (20 bounded reads); zero
machine question/group reads; zero new complete questions or items.

The eight published-state items (`SekFW`, `hspvR`, `4ERR6`, `VF1sb`, `ygwPJ`,
`AqZ8g`, `v4SeI`, `4u4Kk`) still lack source-bound current published bodies.
Draft snapshots cannot establish current published content. No speculative
published route or promotion is added. The exact `1fv6W` fixture continues to
retain two explicitly empty choices and its literal answer-key reference;
usable answer text remains unverified.

Remaining real-course blockers: 24 inline-widget readings, eight published-state
items, `LFrHs`, `1fv6W`, external PDF `NGwET`, and plugins `PqH4G`/`9vHC7`.
No fixture result changes the real-course 59/96 verification count.

## Validation and next test

Local `npm test`: all 181 files pass, plus seven activity-designer suites.
`npm run build`, `npm run test:extractors`, `npm run audit:extractor-changes`,
and `npm run worker:check` pass. Archive-slice regressions cover seven 404s,
seven inline relationships, five zero-image pages, deduplicated file counts,
skipped/attempted distinction and exact empty choices. The bookmark preserves
literal braces through lossless URL encoding to stay below its unchanged
500 KiB limit. Local managed Chromium rejects even the no-CSP bookmark canary;
local bookmark/direct-data browser failures are not waived. Hosted CI must pass.

Next source-evidence test (no full capture and no publisher retries):

1. Open TRDE120's authoring editor for `LFrHs`. In Chrome Network, preserve the
   request path and response for one manual part; include its exact owner/part
   IDs, question text, choices, rubric/manual grading fields, and observation
   time. Do not send cookies, authorization headers, access tokens or a raw HAR.
2. Open one outstanding published-state item, preferably `SekFW`, and preserve
   the source response actually supplying its current published question body,
   alongside its atom/relation identity and version. Keep any draft response
   separately identified.
3. Review these source-bound samples before enabling/finalizing acquisition.
   After that change passes CI and is released, use the existing targeted native
   recheck for `LFrHs` and the eight published-state items, then export the saved
   capture. Retain the previous ZIP and compare unchanged originals and contracts.
4. Do not rerun publisher recovery merely to exercise this patch: the seven
   remaining full-size URLs have known 404 receipts. Accounting regression tests
   use the preserved evidence without network requests.

Release status: candidate v1.9.1, draft pending live acquisition evidence and
hosted CI. No merge, deployment or production verification is claimed.

## PR #95 browser regression correction

Hosted run 39402445646 exposed a valid BOM-prefixed back-matter fixture whose
image bytes, archive path and source binding passed independent validation,
but whose report media array was empty. The new optional inline-alternative
helper used plain `JSON.parse` instead of the existing BOM-aware typed publisher
parser. Its exception reached the report's fail-closed media handler and replaced
the valid references with `PUBLISHER_IMAGE_MEDIA_EVIDENCE_INVALID`. Acquisition
and archived originals were intact; the report projection was defective.

The helper now uses `directPublisherResourceV1` with the observed chapter, part
or back-matter type. Original JSON (including BOM), SHA-256, byte lengths,
receipts and timestamps remain unchanged. The hosted assertion at line 2129 is
retained. Added regression coverage validates original image bytes first, then
checks preserved `originalRef`, image hash and report round-trip for all three
resource types. No recovery planner, native assessment or completion contract
changes are included in this correction.
