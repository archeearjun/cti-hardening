# v1.9.3: composite manual resources and published text readings

## Evidence and correction

The uploaded v1.9.2 `capture.json.gz` has SHA-256
`ddf4f75b53c06ddcf4ac991c605f27d22c6b1f0c1464fad168b654a989fdea8c`.
Its gzip/JSON parsed successfully. It records ten local-question-ID GETs,
all HTTP 404, for the ten LFrHs assignment parts. The owner separately observed
HTTP 200 for the resource and `id` query
`RwzXxrTaEfGOPAr_0ssJ-Q~R_f6cLTaEfGh5Qr_wfyFdQ`.
The successful raw response is not attached; the successful request observation
and the uploaded failure receipts are distinct evidence sources.

The v1.9.2 local-ID assumption, including its regression expectation and earlier
audit description, was incorrect. A part ID identifies the question within its
bound assignment; the manual API resource uses the assignment atom and part ID
separated by `~`. The planner now constructs this key only from an already bound
authoring draft and an actual unique manual part, preserving its local ID and
ordinal. The reader rejects local-only IDs and version suffixes, and uses the
same composite key in the path and `id` query. Returned model IDs and paired
receipts must match the exact resource. No speculative fallback is added.

All ten bindings are reproducible from retained source parts. This does not
establish ten successful live composite reads. The sanitized response fixture
uses synthetic content; it is not represented as a copied production response.
Read-only projections, credential exclusion, exact CML/rubrics/schema/empty
values and unknown-grader semantics remain unchanged. Manual acquisitions
remain current-authoring evidence, not published-body proof.

## Published reading rule

The uploaded SekFW and hspvR records each have paired HTTP 200 POST receipts,
matching models, null drafts, exact published CML and stable native atom evidence.
This verifies that the minimized GraphQL request works for those two readings.
Their v1.9.2 incomplete status was unconditional; no completion adapter existed.

The new rule supports only published readings whose CML passes the existing
bounded parser and has no media/widget/attachment dependencies. It preserves
the published CML/title/duration independently of any draft and projects text
with its own SHA-256. Readings with dependencies or unsupported CML remain
incomplete. It does not infer a historical revision or certify external links.

The import verifier independently reconstructs item/material/atom/course/parent
bindings, validates the exact read-only POST receipts and observation order,
compares both models and the final native atom, checks sanitization, and
recomputes CML text and its digest. It does not trust stable/complete flags.
Course material stability and all existing course-level gates still apply.
Previous reading observations and native recheck histories retain their dates.

## Validation and limits

Regression coverage includes the ten real part bindings and 404 receipts,
the owner-observed successful composite request, wrong/local IDs, exact
read-only projections, CML/rubric/empty-field fidelity, non-AI uncertainty,
paired published acquisition, independent import verification, null drafts,
retained history, foreign identities, failed receipts, wrong methods/queries,
changed atoms/text, unsolicited credentials and media dependencies.

The existing bookmark limit and 1 KiB headroom requirement remain unchanged.
Only local names in the touched reading adapter were shortened to fit delivery;
the observed GraphQL selection and envelope are unchanged.

No uploaded capture or previous archive is rewritten. The supplied file is
JSON.gz, not the new ZIP: this change does not independently re-audit the owner's
reported ZIP integrity or original media bytes. The reported baseline remains
59/96 complete, 20/26 assessments, 38/65 readings, 37 incomplete, with 422
original files and 343 recovered publisher URLs. No real-course increase is
claimed from fixture results.

## Next minimal live test

After production verification, replace the entire existing capture bookmark
address with v1.9.3 from CTI. In the same authorized Coursera browser profile,
launch it on TRDE120's Content page, reuse the existing checkpoint and select
**Recheck native course content**. There is no item-only recheck control.
Do not start a full capture or retry the known publisher 404s.

Export a new ZIP while retaining all originals. For LFrHs, inspect each
`directNativeRecheckAttempt.assessmentApiEvidence.manualDefinitions` entry:
composite request/returned ID, separate local ID, paired HTTP 200 receipts,
stable exact prompt/rubric/schema fields and no credentials. Record individual
failures without promoting draft evidence to published completeness.

For SekFW/hspvR, inspect fresh `directPublishedReadingEvidence`, retained history,
paired source-bound POST receipts, null drafts, exact published CML and the
independently validated `COMPLETE_BOUND_PUBLISHED_READING` contract. Any changed
source or new dependency must fail closed. Reassess real-course counts only
after inspecting this new evidence; no HAR, tokens or learner submissions are needed.
