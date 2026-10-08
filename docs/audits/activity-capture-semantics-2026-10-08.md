# Activity capture semantics follow-up — 8 October 2026

Scope: the new user-supplied v6.15.11/schema35 Coursera capture, its AI packet ZIP,
and pasted five-hold AI result. This is a focused evidence-flow repair, not a
certification of all CTI features, live Coursera or source equivalence. No partner
course bodies, answers, PDFs or uploads are committed.

## Evidence and corrections

| Confirmed issue | Location | User impact / severity | Correction | Verification |
| --- | --- | --- | --- | --- |
| Open-response questions have `optionTextReliable:false` because there are no choices; adapter treated that as missing choices. | `cti-adapter.js` | False blockers for Working with Units and Volume; medium | Check choice reliability only where choices apply; retain real missing prompts, choices and explicit capture issues. | Regression cases for text-entry, choice gaps, missing prompts, unknown types and malformed receipts; replay of supplied JSON. |
| All assessment receipts became `partial_unverified`, including matching declared/captured/unique counts. | Adapter, shell/session/packet projection, UI | Complete learner tasks misreported as unverified; medium | Narrow `learner_text_captured` status verifies counts, IDs, prompt projection and applicable choices. Does not certify keys, configuration, media, source matching or approval. | Packet/session round trip and missing/contradictory receipt tests. |
| Stable exact-item empty-editor evidence was flattened into “unread”; suggested repeating capture. | Adapter, quality/readiness, result cards | Unproductive rescan loop and hidden source reconciliation work; medium | Preserve observed-empty state only with matching item/route, stable samples and source-review contract. Keep source reconciliation holds; show exact item links on held proposals as well as drafts. | Contradictory identity/content/stability tests; held-result browser test; actual capture replay. |
| Unread frame URL was dropped from the design packet. | Adapter, compact packet, result cards | Owner cannot locate the resource that requires separate review; medium | Preserve recorded HTTPS URLs with supported simple locator queries; omit credentials/signed query or token-like fragments. Show a separate resource review section; no automatic fetch. | URL rejection and identity tests; real browser link rendering. |
| Held output with minutes=0 displayed “Estimated 0 min”. | Result cards | Misleading estimate; low | Display “Time not estimated”. | Browser assertion. |

The latest raw capture accounts for 96 inventory items and has no unvisited items,
but its strict overall capture contract is incomplete. It retains 39 PDF archives
(8,252,305 bytes, close to the 8 MiB bound). The supplied activity ZIP includes 38
PDFs; all included PDF bytes match their recorded SHA-256. Presence is not visual
or teaching completeness. One excavation page was rendered for spot inspection;
no claim is made to have reviewed every diagram or to independently verify the
AI's claimed visual review of every page.

Replaying the new adapter identifies 17 observed-empty practice editors, and
learner-text receipts for eight assessments (1, 2, 4, 9, 10, 10, 10 and 11 declared
prompts). Working with Units has 9 prompts / 8 choice texts; Volume has 10 prompts /
12 choice texts. Their text-entry questions legitimately have no choices. Two
other assessments still have answer-evidence gaps in canonical extraction; this
release does not change that contract, publishability or answer checking.

## Remaining evidence limits

- Empty destination practice is not proof of absent source practice. Reconcile
  the source LMS/IMSCC and the destination before approving additional activities.
  This patch deliberately preserves the hold rather than manufacturing drafts.
- The preview-week assignment `mtHnH` has instruction text in a broad authoring
  diagnostic, but its exact text-block parser returned no block. The supplied
  file lacks the original DOM needed to establish a safe parser correction.
  That body remains unread in the activity projection; generic page diagnostics
  are not substituted as verified learner instructions.
- Cross-origin teaching frames and interactive plugins remain unread where the
  capture could not access their bodies. Recorded links guide separate review.
- The PDF archive is bounded; it is not an archive of every linked resource. No
  OCR, automatic visual interpretation, new external fetch service or paid model
  call was added.
- AI task-specific wording and non-duplication still require content review. A
  clean automated receipt cannot establish pedagogy or approval.

## Verification and release

`npm test`: 370 Node tests plus 7 activity unit/simulation suites passed.
`npm run build`: passed (existing bundle-size warnings).
Browser verification uses actual Chromium and PDF.js under production CSP, with
synthetic routes: canonical PDF import, hash-identical ZIP originals, saved-work
restore, malformed/stale result recovery, copy gates, held-item next steps and
390px/1440px layouts. It does not sign into the live LMS.

No extractor runtime, reconciliation engine, authentication policy, database or
Worker configuration changed. The extractor remains v6.15.11/schema35; activity
preview becomes v2.2.1. Re-import the existing raw JSON to regenerate corrected
packet semantics. Previously exported packets/results are not rewritten by
refreshing the site. After shell edits, obtain a fresh capture as usual.

Publish through the repository's deterministic/browser/access checks and
fast-forward production mirror. Confirm Cloudflare success before saying live.
