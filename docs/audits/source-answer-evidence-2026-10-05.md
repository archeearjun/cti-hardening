# Source question and answer evidence — 2026-10-05

## Confirmed issue and impact

The two supplied TRDE120 Decimals cards displayed 11 H5P.MultiChoice positions
and 44 choices, but every question said its answer-key coverage was unverified.
Inspection of `external-source-questions.ts` confirmed that the parser discarded
`answers[].correct`, choice hints/feedback, question behaviour and bank settings.
The count was useful, but insufficient to reconstruct an assessment. This was a
high-impact feature gap; no evidence established a missing Decimals question.

An independent publisher offline list contained the same 11 prompts but a
different distractor and a questionable rounding answer key. That is a source
reconciliation issue, not permission to calculate or silently change a key.

## Implemented

- Retain the exact authored QuestionSet `jsonContent` and its library version.
  Retain all question definitions, including unsupported types, markup, bank
  overrides, assessment introduction/end feedback and settings. This is data,
  never executable page JavaScript or a harvested browser session.
- Decode supported version-1 H5P MultiChoice, TrueFalse and Blanks formats into
  readable questions, choices, explicit marked answers, alternative blank
  answers, hints, choice-specific and score-range feedback, and question
  settings. False/zero/empty values survive; absent fields remain unknown.
- Separate question position coverage from readable text, answer-key and
  feedback coverage. Source-marked means copied from the source, not verified
  mathematically or approved. Preserve contradictory versions as separate
  observed banks instead of deduplicating different answer keys.
- Add answer coverage, feedback/hints and settings to the existing content view
  and saved report text. Add full-bank copy, individual question copy, readable
  TXT download and original-definition JSON download. Copying includes coverage
  limitations and preserves bank order independently of learner randomization.
- Show bank overrides separately from question settings. Do not infer an
  answer-correctness gate, retries, grades or platform defaults from item names.
- Validate new readable evidence against its retained definition at the storage
  boundary. Older optional-field-free captures still load and request a refresh.
  These are consistency checks, not independent authentication of imported data.
- Make retained partial/multiple-bank observations downloadable without claiming
  whole-source coverage. A failed/partial refresh still preserves an existing
  complete capture. Original audit results and scores remain unchanged.

## Reviewed scope

Inspected the public-provider fetch service and its URL/redirect/timeout limits,
source capture validation and persistence, owner content conversion, saved report
export, question count panel, content UI and clipboard/download helper. Changed
the maintained domain/service/UI modules and targeted tests; no engine rules,
frozen Apps Script code, authenticated LMS extractors or deployment settings were
changed. `h5p-definition-evidence.ts` and `source-bank-summary.ts` own the new
decoding/coverage logic.

Primary format references consulted:

- https://github.com/h5p/h5p-multi-choice/blob/master/semantics.json
- https://github.com/h5p/h5p-true-false/blob/master/semantics.json
- https://github.com/h5p/h5p-blanks/blob/master/semantics.json
- https://github.com/h5p/h5p-blanks/blob/master/js/blanks.js
- https://github.com/h5p/h5p-question-set/blob/master/semantics.json

## Verification

- Existing focused baseline: 22 tests passed.
- Added 12 regression cases: multiple correct choices; false and missing keys;
  alternative blanks and hints; unsupported types/versions; explicit zero/false
  settings; bounds and original-data retention; contradictory banks; tampered
  derived fields; old captures; source-key preservation; malformed feedback;
  safe mathematical text, snapshot validation and report exports.
- `npm test`: 314 Node tests passed, plus module/historical/parity checks.
- `npm run build`: passed, including TypeScript. Existing large-chunk warning
  remains; no build safeguard was disabled.
- Owner browser suite: passed. Exercises API-to-save-to-UI, answer/feedback
  display, full-bank and single-question clipboard, TXT/JSON downloads, failed
  refresh recovery, report exports and reload, plus 390px layout. Screenshots
  inspected locally. CI runs the remaining required browser gates before release.

## Limits and release action

The public fetch remains restricted to recorded supported-provider URLs, bounded
GETs/redirects, six requests, 20 seconds, 3 MB per document and 6 MB total. Raw
definition JSON is limited to 2 million characters. Readable fields are bounded
at 48,000 characters, choices/answers at 200, and field truncation is explicit.
Existing workspace record limits remain enforced.

Complex/unsupported H5P question types retain original definitions but do not
receive a complete decoded answer-key claim. References are not downloaded media
files; library code/defaults, authentication-dependent activities, learner launch,
interaction fidelity and source answer correctness are not established here.
Native IMSCC/QTI and Brightspace assessment capture continue through their
existing paths; this change does not certify every question type in every LMS.

Direct retrieval of the live public Decimals definition from this execution
environment returned HTTP 403. Validation therefore used actual uploaded cards,
the source package/report, primary H5P schemas and synthetic boundary fixtures;
the live Decimals keys and current Coursera learner state were not independently
replayed. The user should refresh the relevant saved item's source questions
after deployment and inspect the separately reported answer coverage.

No configuration or database migration is required. Existing reports remain
historical. Refresh source questions once to obtain richer definitions; copying
the old capture cannot reconstruct fields that were previously discarded.
