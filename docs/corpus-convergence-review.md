# Corpus convergence review — 4 October 2026

Baseline: `bed2a09336802fd6b84a0e7ecad5c23a862b3b5c`.
QA build after correction: `v8.0.0-corpus-convergence-20261004`.
Coursera remains v6.15.7/schema 35; Brightspace remains v1.0.8/schema 2.

## Evidence and conclusion

Reused the existing 27 historical Coursera captures across 15 titles, with their
matching XLSX/source evidence. Twelve comparisons across seven titles completed
against retained source scans; the other fifteen cases were capture-only reviews.
Both the baseline and corrected replay finished with zero errors. Input hashes,
capture-gap categories and the six reported aggregate comparison metrics were
unchanged. These facts alone do not establish item-level equivalence.

Comparing the baseline with the preceding v6.14.6-era replay exposed five changed
item findings. Three were legitimate unresolved-widget provenance findings. One
also contaminated a shorter sibling title, and two contained false generated
grading warnings. The corrected replay removes precisely those three false
warnings. Real unresolved-widget findings remain. No item is newly VERIFIED.

The retained scans were produced using an offline XML/PDF adapter; package hashes
match seven retained source archives. This review did not rescan every private
package in a browser. Eight complete source packages remain outside full replay
coverage. Old captures cannot demonstrate that current live extraction captures
previously absent DOM, answers, plugin bodies or attachment bytes.

The evidence supports convergence in saved-evidence comparison, with remaining
cross-component correctness defects now covered by executable regressions.
It does not support certifying every title or requesting another blanket crawl.

## Confirmed defects and implemented corrections

| Severity | Location / evidence | Impact | Correction / verification |
| --- | --- | --- | --- |
| High | `src/domain/coursera-background-extraction.ts`: completion trusted summary counts despite incomplete/missing item contracts, duplicate identities or malformed counters | An internally inconsistent capture could appear complete | Require unique identities, integer counters, consistent inventory/complete/unresolved totals and matching per-item completion; negative fixtures cover missing, conflicting and incomplete evidence |
| Medium | Same boundary rejected `COMPLETE_ASSIGNMENT_TEXT_BLOCKS` introduced by the extractor | A valid text-only assignment was incomplete at the site even after extraction succeeded | Accept only a full item/course-bound text-block receipt with unique complete blocks, reconciled part counts and no mixed assessment; production DOM collector → contract → site-gate integration test |
| Medium | `src/engine/provenance/claims.js`: substring title matching after a uniquely named claim | A practice-assessment warning also attached to a separate shorter lesson title | Bind a unique exact name within its named module before fallback matching; preserve quoted-question scope and raw claims |
| Medium | Same parser: `graded` matched `ungraded`; an explicit null passing threshold became generated behavior | Spurious owner grading tasks despite an unspecified value | Word boundaries and narrow absent-threshold recognition; retain informational provenance; concrete thresholds, graders and mixed rubric events remain reviewable |

The site gate also distinguishes captured ingestion-failure evidence from a
claim that assessment questions exist. Capturing a real course defect can finish
successfully; the QA course-defect finding remains independent.

Regression owners: `tests/capture-boundary-regression.test.mjs`,
`tests/portalled-text-block.test.mjs`, `tests/corpus-provenance-regression.test.mjs`.
The parity ledger records the three changed claim functions explicitly. The
archived Apps Script files and base parser are unchanged. Current release tests
replace the obsolete archived release-literal assertion; the golden comparison
still compares every evidence decision after separately asserting both build IDs.

## Historical failure classes and present boundary

| Release family | Maintained implementation | What can be established now |
| --- | --- | --- |
| Corpus report/scanner corrections through v6.14.0 | Claim scoping, explicit assignment XML attachments, policy-adjusted headlines, retained source question uncertainty | Retained seven-source replay and existing scanner/claim regressions; original six classes remain represented in tests |
| v6.14.4 | Structured question identity/type/coverage; mixed text/question positions; Brightspace pagination | Saved fields and synthetic pagination/DOM tests; missing historical DOM cannot be reconstructed |
| v6.14.5 | Math representation, exact discussion fields, source document-relative links, quoted-question claim scope | Existing regressions and saved comparisons; actual current authenticated link access still requires the LMS |
| v6.14.6 | Evidence-gated retries and final/intermediate report distinctions | Historical replay baseline and deterministic retry tests; no retrospective claim about primary-pass timing |
| v6.14.7 and source-item update | Plugin readiness, bounded uploads, source-topic mapping and targeted plugin evidence | Navigation/upload/plugin regression suites; topic ambiguity and cross-origin bodies remain explicit |
| v6.15.4–v6.15.5 | Per-item completion/checkpoint orchestration and direct-route navigation | Current tests and supplied live handoff; old v6.13.27 files do not certify these collectors |
| v6.15.6 | Terminal source/answer reviews, version provenance, bounded discussion/plugin waits | Handoff reports a 94-target live run with one technical unresolved item; not independently recaptured here |
| v6.15.7 | Portalled text-block binding, separate traversal/content accounting, source-only answer guidance | New production DOM-to-site integration test passes; live acceptance for the affected item remains pending |

## Minimal live acceptance

1. Existing text-only assignment regression: exact-item receipt, complete blocks,
   no unnecessary retry, and zero technical unresolved items if no other course
   state changed. Do not assume source/answer/plugin reviews disappear.
2. One mixed editor: 29 content parts, 28 actual questions; visit the final question
   and exclude the text block from the question denominator.
3. One asset-heavy course: verify bounded body/hash work and explicit deadline
   failures, preserving prior results.
4. One large-bank course: compare stable question IDs and observed outline/source
   denominators, with no duplicate or silently omitted questions.

Keep the existing positive 172-question final as an offline comparison case;
recapture it only if large-bank behavior changes or the focused live test exposes
a different mechanism. Resolve actual empty assessments and source-data gaps
separately. Another destination crawl does not fix missing source definitions.

## Scope not claimed

This pass inspected the replay pipeline, capture completion boundary, current
text-block collector, provenance parser/localizer, relevant report/navigation
history and associated tests. It did not independently reread and certify every
first-party module. The earlier migration ledger covers the legacy inventory;
its dispositions are not live certification. Authenticated LMS redirects,
cross-origin interactions, unavailable source packages and production deployment
of this change need their own evidence. Private course files are not committed.
