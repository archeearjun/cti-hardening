# LFrHs published assessment evidence boundary

Historical investigation record, before the subsequent unpublished-item UI
evidence and draft-contract implementation. See
[the follow-up contract](manual-draft-contract-2026-10-20.md) for the current
decision: published acquisition remains blocked, but authoring-draft verification
does not require a published version. Statements below describe that earlier
investigation stage and its then-current tests and release status.

## Source and scope

Inspected the v1.9.3 uploaded `capture.json.gz`, compressed SHA-256
`c8a15a912edc715a2dc693b2567664a8a06826e34a9bec7a69a7503b9738e17a`.
Fetched remote main identity `e94bf83db094af0aa2dcb67c6ff409d93f0ec315`;
its tree `e6786104ccfc6acf8134d7a2645844c77ed9f0a6` exactly matches the
clean local implementation inspected before adding these tests and notes.
No runtime source, thresholds, capture files or original media were changed.

## Findings

The latest evidence is in LFrHs's
`payload.directNativeRecheckAttempt`, not just its older primary payload.
Its course/item relation binds course `iu5pMbTVEfG-2xL_w9lGpQ`, item
`LFrHs`, and atom `RwzXxrTaEfGOPAr_0ssJ-Q`.

The atom has `draftAtomStatus`, `storedAtomVersion: 1`, and a current
`staffGradedDraft` named **Final Assessment** with `isGraded: true`.
Its ten ordered `storedManualGradedQuestionPart` local IDs resolve to
the ten composite authoring resource IDs retained in the new regression
fixture. All ten have paired HTTP 200 receipts, matching canonical model
hashes and source-bound stable responses. Independent
`directManualObservationV1` validation passed on all ten actual records.
`directManualQuestionV1` preserves all their retained model fields exactly.
All ten actual API literals are `graderType: "AI"`, with rich-text submission
schemas. Their rubric point values, in order, are
`[2,3,2,3,5,5,4,3,4,4]`. No staff-grading enum is established.

The same atom's **separate retained published reference** is:

- `published.name: "Untitled"`
- `published.content.typeName: "staffGraded"`
- `published.content.definition.assignmentId: "SPnBUGLKT0i5wVBiyj9IGQ@1"`
- `published.content.definition.isGraded: false`

The initial and final material inventories also retain this assignment ID.
The `@1` identifies the referenced assignment version; the authoring atom's
`storedAtomVersion: 1` does not equate these different identities.
Neither readiness-for-publication flags nor repeated stable authoring reads
prove that the ten current questions belong to that published version.
This reference alone also does not establish which version a learner can
currently reach in the course's new branch.

`directDraftAssessmentInventoryV1` supports `storedQuestionGroupPart`
for the general assessment verification path (and a separate instruction-only
case). It therefore reports ten unsupported manual parts. The manual adapter
separately recognizes and retains their content, but deliberately does not
produce a complete published assessment. Thus “unsupported” here describes
the completeness contract, not failure to download or recognize the bodies.
Renaming the reason alone would not resolve published fidelity.

Searched the new capture and both existing independent-audit JSON records.
Every occurrence of `SPnBUGLKT0i5wVBiyj9IGQ@1` is a material/atom reference;
none resolves it into a published question inventory or bodies.
The maintained direct reader and editor assessment adapter have no observed,
validated transport contract for this published manual assignment.
No guessed endpoint was requested.

## Regression coverage and limits

Added `manual-published-gap-v193.json` with observed IDs, statuses, model
hashes, structural facts and published reference. It contains no question text,
learner data or authentication material.
Added eleven tests in `coursera-manual-published-gap.test.mjs`: the separate
published identity plus each of the ten observed manual shapes. Synthetic
question text/receipts are explicitly labelled; they are not live evidence.
Tests check authoring acceptance without published promotion, grading/rubric
retention, and rejection of substituted version identities or changed bodies.

Focused checks passed:

- `coursera-manual-published-gap.test.mjs`
- `coursera-native-observations.test.mjs`
- `coursera-retained-authoring-content.test.mjs`
- `coursera-native-model-entry.test.mjs`

The actual uploaded ten records were additionally checked directly with the
production binding, canonical hashing and manual-observation functions.
This establishes authoring retention, not published completeness. No full CI,
new PR, merge or deployment was initiated for this evidence-blocked branch.
The test and audit additions remain local for review.

## Minimal next operator action

In the authorized Coursera authoring Content page for this course, select
**Final Assessment (LFrHs)**. Open its **published/learner preview**, if
available, explicitly avoiding the current draft-question editor. With
DevTools Network open, load only this assessment's instructions/questions.
Do not publish changes, start/submit an attempt, or open learner submissions.
If the preview would require creating an attempt, stop and report that barrier.

Identify the response resolving the course/item to a published assignment,
especially `SPnBUGLKT0i5wVBiyj9IGQ@1`, and its ordered question IDs/versions.
Provide only sanitized request method, endpoint, non-secret query or GraphQL
document/variables, response status, and relevant assignment/question fields.
Include source IDs/version, course/item binding, question type, CML, rubrics
and submission schema when returned. If question bodies require a separate
read, provide one observed example plus the complete published ID list.
Do not export a HAR, cookies, authorization headers, write/conflict tokens,
signed URLs, learner answers, grades or personal identifiers.

If only an empty/Untitled published preview exists, or no published preview is
available, report that observation and the sanitized identity response.
Do not publish the draft simply to satisfy extraction. That result may explain
the mismatch and must remain distinct from proof about the ten draft bodies.

Only after that evidence establishes a read-only transport and version-binding
contract should a published-manual adapter be implemented and released.
No additional full-course capture is needed for this evidence request.
