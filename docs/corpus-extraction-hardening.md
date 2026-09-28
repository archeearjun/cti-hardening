# Shared extraction fixes from saved evidence

Coursera **v6.14.4**, schema 34, build `v6.14.4-corpus-extraction-20260929`.
Brightspace **v1.0.6**, schema 2, build `v1.0.6-paged-inventory-20260929`.
QA build: `v8.0.0-corpus-extraction-20260929`.

## Changes

- Recognize Coursera's explicit Text match response type. Multiple accepted text
  values are answer variants, not evidence of a multiple-select interaction.
  Exact numeric answer labels retain digits, signs, decimals and separators.
  Explicit text-match type also takes precedence over True/False-looking values.
- Preserve raw question type, stable question IDs, observed ordinals, response
  boundaries and capture-completeness receipts through repeated QA normalization.
  Identified modern assessment structure outranks clipped flat-text fallback;
  text cannot silently reorder, duplicate or renumber that structure. Original
  uploaded evidence remains available on the normalized item's original object.
- Keep explicit incomplete question coverage unverified even when observed
  subsets match. Observed answer defects still receive their existing verdict.
  Media-only and answer-only guidance cannot hide independent coverage gaps.
- Carry non-question content-part positions into fallback assessment coverage.
  An instruction block does not become a missing question when a question's
  answer evidence remains unresolved.
- Recognize the published YouTube plugin's exact label beside its visible View
  Configuration control. Extract the item-scoped configured video ID and timing
  fields; launch and playback remain unverified. This does not bypass iframe
  origin restrictions or claim that remote plugin content was read.
- Paginate Brightspace's quiz inventory, not just its per-quiz questions.
  Deduplicate each inventory by its own ID. Retain partial results and a visible
  warning on missing pagination markers, cycles, permission failures or limits.
  Follow Next only within the same exact endpoint and origin. No learner
  attempts, grades or responses are requested.
- Increase the bounded per-quiz definition capacity from 500 to 5,000 and the
  page ceiling from 50 to 300, under the existing overall request budget. Hitting
  a ceiling remains an explicit incomplete capture, never a completeness claim.

The paginated quiz-list contract is documented in D2L's
[Quizzes reference](https://docs.valence.desire2learn.com/res/quiz.html) and
[ObjectListPage calling conventions](https://docs.valence.desire2learn.com/basic/apicall.html#object-list-pages).
Finishing API pages still does not independently verify all question-pool
membership or the complete source bank.

## Validation

Eleven new synthetic regressions execute production collector code for text
responses, answer values, mixed content/question outlines, partial coverage,
published plugin configuration, pagination beyond 500 definitions, duplicate IDs,
endpoint escapes, page loops, missing markers, permission failures and limits.
Existing assignment identity, delayed hydration, option feedback and runtime
response-copy tests remain required.

The full local suites passed: 228 fast checks, 23 source contracts, 20 hardening
checks and 98 Node tests; one Node golden fixture remains skipped. Google-service
integration/full-golden suites were not run. Type checking and production build
passed with the existing bundle-size warning.

The saved corpus can be replayed without recapturing LMS courses. It distinguishes
record count, stable question identities and explicit coverage uncertainty.
Historical files retain their actual versions. Type recovery from an explicit
stored field is not recovery of missing DOM, questions or answers.

Live DOM and API acceptance is not established by offline tests. Use one
representative check per changed mechanism when live validation is appropriate;
neither this version bump nor a historical capture requires rerunning every
title. Larger packages not available to the replay remain outside its full-source
comparison scope. No source or live course content is edited by these changes.
