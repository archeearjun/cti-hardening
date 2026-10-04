# Survey choice capture, 2026-10-04

Coursera release: **v6.15.8 / schema 35**

The supplied TRDE120 capture declared and captured two survey question positions,
but returned unknown types and no options. Both unmarked-choice probes reported
`CHOICE_CONTROL_COUNT`; the retained surface summary marked both assignment parts
invisible. The supplied screenshots show four radio-style choices and three
checkbox-style choices. Therefore the absent option evidence is a capture gap,
not proof that the destination questions have no options or answer keys.

## Confirmed defects and corrections

| Location | Evidence and impact | Correction and regression check |
| --- | --- | --- |
| `text-and-dom-2.js`: `choiceControlVisibilityV61320` | High: it required a positive rectangle on the structural assignment part. A real Chromium `display:contents` fixture reproduces the unknown-type/empty-options failure while child choices remain rendered. The exact live CSS was not supplied. | Permit a boxless structural part; require rendered custom controls and visible option rows. Check hidden ancestry through the document, including above the part. Native inputs may be transparent only when their option row proves visible text. |
| `assessments-2.js` and `assessments-3.js`: prompt extraction | Medium: the supplied second prompt included `Answers *`, all three choices and `Add Variant`. | Bound fallback prompts at the explicit required `Answers *` heading. An ordinary word “Answers” within prompt prose remains intact. |
| `text-and-dom-2.js`: unmarked question points | Medium: `Number(...) || null` turned an observed zero into unknown. | Preserve zero; absence remains null. |
| `completion.js`: compact diagnostics | Medium: diagnostics discarded all control rejection reasons, preventing a distinction between absent controls and rejected controls. | Retain at most 16 control summaries per probe, with type, acceptance, reason and ancestry depth; omit option text and DOM dumps. |

The new Chromium regression runs the actual maintained parsers and complete
outline traversal. It checks disabled radio-style controls, transparent native
checkboxes, zero-size part containers, four/three distinct options, stable question
identity, hidden ancestors, mixed controls, missing controls, prompt boundaries,
and bounded diagnostics. It reproduced the old `unknown` result before the fix.

Local verification passed: 41 pre-change extractor tests, all 231 post-change
Node tests plus the retained legacy checks, production build/typecheck, Worker
deployment dry run, the new Chromium choice regression, and the owner-action
browser suite (including focused script generation, evidence import, persistence
and 390px layout). The owner UI now takes its copied-script version from the
actual delivery metadata after that check exposed a stale hardcoded label. Vite's existing
large-chunk advisory remains; it did not fail the build.

Checked/disabled presentation **does not establish correctness**. Options retain
`correct: null`; answer reliability remains false, and the strict completion
contract continues to require answer-applicability review. Neither “Practice” nor
the word “survey” waives this requirement.

## Release and verification boundary

The console bundle, filename, run-lock/checkpoint metadata, release registry and
focused item-check compatibility gate advance together. The browser regression
is a required CI gate. Reviewed extractor hashes cover only the four parser/DOM
functions, diagnostic compaction, export filename, run lock, crawl version
metadata, entry metadata and release registry. The frozen Apps Script reference
and historical captures remain unchanged.

Existing captures cannot supply options they never recorded. Live acceptance
still needs a fresh focused check of the affected survey with v6.15.8, then an
inspection of its two question types, four/three options, clean prompts and
remaining answer-key uncertainty. Screenshots and synthetic browser fixtures are
not a new authenticated Coursera extraction.
