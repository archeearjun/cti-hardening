# Independent CTI answer checks

## Evidence and scope

The retained source key previously had no independent calculation alongside it.
The user's Decimals card contains eleven arithmetic/rounding questions. A separate
publisher appendix marked C for rounding 5237.02046 to the nearest thousandth;
the mathematical answer is 5237.020, equivalent to choice B's 5237.02. This is
evidence for a discrepancy check, not proof that the current live H5P key marks C.
The test suite simulates a conflicting key and preserves it verbatim.

The existing source/Coursera content panel, package repair panel, full-question
copy, bank TXT export and owner-report text now show `CTI answer` with working,
method version, key agreement/conflict/unverified and a next action. Owner-report
JSON includes separate `followUp.derivedAnswers` keyed by item, evidence side,
capture time and question identity. Raw definitions and the original audit remain
unchanged. No automatic resolution, key edits or publication approvals are added.

## Implemented decisions

| Issue | Impact / priority | Correction and verification |
| --- | --- | --- |
| Source keys could be copied without an independent check | Incorrect course answers / high | Calculate from the complete prompt without consulting choices, feedback or keys, then map the result to choices and compare the key. Wrong-key and source-immutability tests. |
| Closest-choice matching would mask missing rounding instructions | Incorrect results / high | Exact rational equality only. Question 7, 18.753 / 0.87, returns 6251/290 and needs review; 21.555 is not silently accepted. |
| Text stripping and incomplete captures can change math | Incorrect results / high | Inspect available original H5P notation; abstain for missing original definitions, MathML/SVG, native rich notation, media references, truncation and unreliable choices. Old normalized snapshots without the new notation receipt stay readable but require original JSON re-import or source refresh to calculate. |
| Non-math answer generation lacks grounding in the course/reference | False assurance / high | Explicit Needs review, subject-review instructions and an independent review brief excluding keys/feedback. No external model service or invented confidence score. |
| Arbitrary option IDs and shuffled positions can misidentify A/B/C | Incorrect edits / high | Visible letter labels refer only to captured order; retain original IDs and answer text. Key mapping requires a unique recorded ID/text or explicit H5P Choice N definition. Ambiguous mappings stay unverified. |

`exact-math-1` supports complete English prompts for arithmetic (+, -, *, /,
integer powers, parentheses, decimal/fraction/percentage values), explicit Add,
Subtract/from, Multiply/by, Divide/by, rounding to named places or 0–6 decimal
places, percentage-of and simple percentage-ratio questions with explicit percent
choices. Arithmetic uses bounded BigInt fractions, not floating-point equality,
eval, or a language model. Full anchored prompt grammars prevent solving an
unrelated numeric substring. The matching answer is shown only after calculation.

Unsupported word problems, equations with variables, units/diagrams, significant
figures, mixed-number notation, ambiguous/malformed choices, multiple equivalent
choices, rounding ties with no convention, unsupported response formats and
subject-knowledge questions remain Needs review. Original source correctness,
learner interaction and the fidelity of upstream extraction are not certified.
This is useful coverage, not a general mathematical theorem prover or subject
expert. Negative/missing/zero fields remain distinct. Non-math review briefs
include reference/rubric requirements; CTI sends no messages or approval requests.

## Verification and operations

- Replayed the eleven user-supplied Decimals prompts and 44 choices: ten unique
  exact choices, one unresolved rounding/choice issue. Live answer keys were not
  fetched as part of this replay.
- Regression cases cover exact decimals and fractions, precedence, negatives,
  zero, percent units, rounding, malformed expressions, bounded depth/exponents,
  wrong keys, ambiguous IDs, duplicated choices, notation/media limitations,
  unsupported/non-math questions, legacy snapshots and exports.
- Full local suite: 325 tests pass, including module/historical/parity gates.
  TypeScript and production build pass; existing large-chunk warning remains.
- Owner browser workflow passes at desktop and 390px, covering a synthetic key
  conflict, non-math review brief, copy/download output, failed clipboard recovery,
  source refresh preservation, saved evidence and immutable audit.
- No credentials, model billing, dependency, database or Cloudflare binding changes.
  Existing rich H5P captures recalculate on display; earlier captures need Refresh
  source questions. For older normalized Coursera/Brightspace snapshots, import
  the matching original JSON via Load original extraction content into an older
  report, or use the existing fresh item/full comparison workflow.

All calculations are derived when displayed/exported. Updating CTI's math rules
does not rewrite historical capture evidence. Original JSON downloads intentionally
contain only original source observations, without derived CTI answers.

## Percentage follow-up (`exact-math-2`)

The user's ten Percentage questions exposed a confirmed checker-coverage defect,
not missing extraction: every prompt, choice and source key was present in the
pasted view, but the v1 full-prompt grammar rejected alternate percentage wording,
word problems and all true/false formats. Its generic subject-review instruction
also obscured ordinary math and specific ambiguity. This affects answer review
and copying (high priority); it does not prove that other extraction is complete.

`percentage-math.ts` now calculates supported percentage relations, parts of a
total, waste, motor efficiency with an explicit formula, and dimensional
tolerances. All operands come from the full prompt, never from choices/keys.
Units must match the prompt; no implicit conversions or closest-option selection.
True/false statements require supported semantics and two explicit English
labels; shuffled letters and false source keys are mapped without defaulting.
`supported-math-text.ts` recognizes only the complete efficiency TeX formula.
Unknown notation and missing original H5P definitions still block calculation.
`cti-answer-check.ts` also now blocks explicitly incomplete media capture.

| Supplied question | Independent result / remaining action |
| --- | --- |
| 1: 40% of 24 | B, 9.6 |
| 2: 0.6 as a percent of 1.32 | 500/11% (about 45.4545%); no exact option. State rounding before accepting 45%. |
| 3: 3 is 15% of 22 | B, False: the product is 3.3. |
| 4: 1 part acid and 4 parts water | B, 20% of the total stated parts. |
| 5: 90% efficiency, 13.5 hp output | A, 15 hp input. |
| 6: 3.6 of 120 spoiled | A, 3%. |
| 7: maximum width at 5% variation | C, 193.2 mm. |
| 8: 12% profit, $2345 cost | Clarify markup ($2626.40) versus margin (about $2664.77). |
| 9: 630 rpm is 94% of 668 rpm | 94% gives 627.92 rpm; the actual ratio is about 94.3114%. False exactly, potentially True if percentage rounding is intended. Clarify precision. |
| 10: 354 rpm loses 16%, becoming 297 rpm | Exact result 297.36 rpm. False exactly, True after rounding to whole rpm. Clarify precision. |

Six questions receive independent choices; four retain an explicit explanation
and next action. Unknown wording is labelled a checker limitation, without
claiming extraction failed or requiring a subject expert for every calculation.
This remains a deterministic set of supported grammars, not a general natural
language solver. Original captured keys and definitions remain unchanged.

Regression fixtures replay all ten questions through content normalization and
H5P capture, saved-bank input, answer comparison and exports. Variants exercise
changed operands, zero, signs, explicit percentage rounding, shuffled choices,
wrong/missing keys, incompatible units, duplicate answers, incomplete capture,
extra/negated wording, unsafe notation and repeated rounding instructions.
The owner browser check covers actual rendered answer panels, review reasons,
copy/export text and desktop/390px layout with controlled fixtures. No live
authenticated source/Coursera capture is certified by these checks.

Existing rich saved banks recalculate when reopened after reloading CTI. Earlier
captures missing raw definitions still require the existing source refresh;
no database migration, new dependency, paid model, credentials or binding change.
