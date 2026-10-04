# Survey choice capture, 2026-10-04

Coursera release: **v6.15.9 / schema 35**

## Live acceptance follow-up

The focused v6.15.8 check completed in 26.411 seconds on 2026-10-04. Both
question prompts were clean and all seven choice controls passed the visibility
chain, but both probes failed with `OPTION_LABEL_BOUNDARY_NOT_PROVEN`. The
questions therefore still had unknown types and empty option arrays. **v6.15.8
did not finish the live capture fix.** Its fixture had a boxless question part
but an ordinary option row, so its passing result did not cover this second
layout boundary.

v6.15.9 replaces the option-row rectangle requirement with bounded rendered-text
range evidence. It retains a label only within a container owning one observed
choice control, excludes hidden feedback and controls, preserves split inline
text, and stops before any ancestor containing multiple choices. A label can be
a sibling of the control's decorative row. Hidden labels, absent labels,
oversized labels and ambiguous rows remain uncaptured. No check state is
converted into an answer key. The subsequent live v6.15.9 diagnostics identify
`DIV` option rows with `display:flex`, no row box and rendered child text; the
range-based reader successfully captures those labels.

The Chromium regression now covers ordinary, boxless, zero-height and sibling
label layouts, nested inline text, hidden feedback, missing/hidden labels,
oversized text, ambiguous rows and full question traversal. The expanded fixture
failed on v6.15.8 before the parser change. Bounded label diagnostics now retain
row layout, node/character counts and rejection reasons, without label text.

The capture contract also no longer calls unknown question types or uncaptured
choices an answer-applicability-only review. Those remain technical capture gaps
with the existing two-attempt ceiling. A Practice item reaches the separate
answer-applicability review only after question content is actually captured.
Re-evaluating the supplied v6.15.8 JSON now produces `RETRY_REQUIRED` with
`ASSESSMENT_QUESTION_CONTENT_INCOMPLETE`; no raw evidence was edited.

The tests that claimed to represent a fully observed Practice question previously
supplied only its prompt. They now supply an observed type and distinct options,
and explicitly verify unknown types, absent options and unreliable options on
both the retryable and exhausted paths. The original review assertions remain.

Live v6.15.9 acceptance passed on 2026-10-04 at 14:14:01Z. The fresh focused
check took 31.093 seconds and captured both stable question IDs, clean prompts,
single-select/multiple-select types, and all four/three option texts matching the
supplied screenshots. Both probes report `CHOICES_CAPTURED`; all seven labels
have rendered-text-range evidence. Correctness stays unknown, and the capture
contract remains `UNRESOLVED_ANSWER_APPLICABILITY_REVIEW`. This verifies the
survey choice-capture fix, not answer-key applicability or the whole course.

v6.15.9 local verification: all 231 Node tests and retained legacy checks pass;
the expanded real-browser choice regression, production build/typecheck, Worker
dry run and owner-action browser suite also pass. The browser fixture is checked
in; the supplied course capture and screenshots are not.

## Original v6.15.8 investigation

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

Existing captures cannot supply options they never recorded. The authenticated
v6.15.9 focused capture supplies new evidence for this survey only; the older
full-course snapshot stays unchanged. See
[owner-report follow-up exports](owner-report-follow-up-review.md) for how saved
item evidence accompanies that original audit without silently changing it.
