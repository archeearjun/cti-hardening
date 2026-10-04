# Assignment workflow and historical extraction acceptance

Reviewed 5 October 2026 against main `e69afa2` (Coursera v6.15.9,
Brightspace v1.0.8). This change adds owner workflow guidance and scoped human
review records. It does not change the extractor or automatically edit an LMS.

## Owner journey

Before import, inspect the IMSCC and source LMS to establish requirements and
identify package/runtime limitations. If a shell exists, compare its captured
content before deciding to reimport. Without a destination, CTI cannot determine
what is missing from that destination.

After import, retain a raw baseline: Coursera full JSON and structural XLSX,
source package and Brightspace evidence. Review the item worklist before manual
edits. Restore, modify, relocate or remove content only after resolving its source
identity and intended inclusion. An unread body is not an absent body; a matching
count does not prove matching questions, answers, media or behavior.

After edits, capture the corrected shell and compare again. Reconciliation is
shared by both deliverable paths:

- Direct course: reconciliation → linked course outline.
- Specialization: reconciliation → content map → recorded approval → linked
  specialization outline. No intermediate course outline is mandatory.

The two supplied GPT links are external handoff destinations. No CTI data is sent
when opening them; the owner attaches the handoff and full report. Their private
instructions were not available to this review. CTI does not claim to implement
those agents or generate their documents.

## Confirmed defects and changes

| Location | Evidence / impact | Correction |
| --- | --- | --- |
| `src/domain/operations.ts`, `nextWorkAction` | Requested a course outline before the source audit; requested specialization outline before content map | Source reconciliation precedes both paths; map approval precedes specialization outline; direct course path skips map |
| Same queue, raw QA freshness | Timestamp alone could accept an audit of a different source package | Require the current source hash as well |
| Main navigation / report view | Evidence tools and operational states did not describe deliverable prerequisites | Add Assignment plan with sequential steps, actionable blockers, agent links and a downloadable inventory |
| Existing manual PASS/DONE states | Unscoped states cannot establish current content readiness | Keep legacy values but use a distinct evidence-bound owner review and map-approval receipt for next-action decisions |

`src/domain/assignment-plan.ts` evaluates the plan. Receipts bind to the course,
source SHA and scan time, latest audit identity/version/input hashes, item-review
versions/status/notes, and declared shell edits. Owner/catalog metadata edits do
not invalidate reconciliation. Source rescans, later audits, review changes and
reported shell edits do. A post-edit audit with an old/unknown capture timestamp
cannot enable a new review. Duplicate item reviews remain unresolved.

A review requires a successful comparison, coherent input identity, a full
Coursera capture, an actionable item inventory, and documented checks for all
flagged items. Items marked changed remain unresolved until post-edit verification.
The whole-course note explicitly records learner checks and accepted limitations.
This is a **human attestation**, not a new engine verdict: the original report and
all its unresolved evidence remain intact. It is not a publication permission or
an automatic claim that every question/plugin is correct. Existing server roles
and optimistic record versions apply; receipt shape and approval URLs are
validated on the server. The planner includes item-review summaries in the same
receipt calculation.

Outlines additionally require specific item routes; course homepages are
insufficient. A valid route format still does not prove authenticated learner
access. Unknown course size never selects a deliverable automatically. Shell
edits made outside CTI cannot be detected without a declaration or fresh capture.

## What the 15-title replay proves

Replayed **27 historical Coursera JSON/XLSX captures across 15 titles** using the
current comparison code: **12 full comparisons across seven source packages**,
**15 capture-only reviews**, **zero replay errors**. The independently curated,
input-hash-pinned expectations returned **59 passed, zero failed, four blocked**.
The four blocked comparisons are practice-grading cases whose full source scans
are unavailable (CITC935, BORL113, BORL111, FDRO150). They are not passes.

| Title | Available source comparison | Historical issue / current acceptance boundary |
| --- | --- | --- |
| CITC935 | Capture-only | Practice grading still needs full source comparison; one historically unvisited editor cannot be recovered offline |
| WWWT112 | Capture-only | Mixed 29-part / 28-question editor and answer boundaries remain a focused live acceptance case |
| CITC932 | Full | Required DOCX attachments remain unverified when destination proof is absent; unrelated ingestion warnings do not become repairs |
| MELT522 | Full | 58-question final versus captured failed/empty destination remains an actionable ingestion failure |
| FDRO140 | Full | 25-question final versus captured failed/empty destination remains actionable; matching self-check evidence is retained |
| BORL113 | Capture-only | Empty self-check evidence retained; practice grading blocked pending full source |
| TRDE130 | Capture-only, old capture only | Large-bank identity/coverage and long traversal need a current live acceptance run; old record counts are not unique-question certification |
| CITC924 | Capture-only | Asset-heavy body/hash timeouts are covered in deterministic tests; current live timing remains unverified |
| CITC926 | Capture-only | Recorded eight-question pre-assessment becoming empty warrants source/placement investigation |
| CITC923 | Full | Renamed attachment's exact hash match remains verified; do not recreate a preserved file |
| BORL111 | Capture-only | Practice grading and full-source fidelity remain unverified |
| FDRO150 | Capture-only | Practice grading and final preservation need full-source evidence |
| SCRS200 | Full | Practice-grading warning retained; null thresholds do not become invented settings; explicit attachment scanning retained |
| MELT521 | Full | 348 core questions, including 172 in the final, retain alignment; attempts/settings remain separate checks |
| TRDE120 | Full | Failed final and empty weekly assessments remain visible; unrelated sibling asset claims are excluded; source/plugin limitations remain explicit |

The baseline corpus captures are v6.13.27. Replaying them cannot prove that
v6.15.9 captures new DOM, private iframe bodies, permissions-dependent source
banks or live attachment bytes. The code already contains bounded plugin waits,
question identity/coverage receipts, source pagination, asset deadlines,
checkpoint/resume behavior and rendered-choice fixes; their deterministic tests
are not a replacement for current authenticated LMS acceptance.

The supplied Percentages text illustrates the boundary: both sides fetched the
same 504-character public static document, while the Coursera iframe remained
unreadable. That corroborates the recorded external target, **not** complete
lesson capture, native quiz totals or learner access. No source count should be
invented from that page. Missing source definitions require source evidence;
failed ingestion requires course remediation; another identical extraction
cannot fix either automatically.

Minimal remaining live cases: WWWT112 mixed editor, CITC924 asset-heavy capture,
TRDE130 large bank, and a representative delayed/cross-origin plugin. Compare
fresh evidence with source expectations and retain unknowns. No blanket rerun of
all 15 titles is justified solely by a version change.

## Verification

- Baseline: 269 Node tests passed. Updated suite: 277 passed, zero failures;
  type checking and production build passed. Targeted tests cover workflow ordering,
  incomplete/empty evidence, manual review, stale source/audit/reviews, duplicate
  outcomes, old post-edit capture, exact links, map approval and server validation.
- The private corpus and input hashes remain outside the public repository.
- Browser UX checks exercise route persistence, blocked premature approval,
  handoff download, actual review/approval save and reload, shell-change
  invalidation, labels/keyboard navigation, and desktop/mobile layout.
- Existing owner actions, source/Coursera content and question evidence,
  exports and immutable reports remain in their existing browser regression suite.
