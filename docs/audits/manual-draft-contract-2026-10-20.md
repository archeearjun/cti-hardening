# Manual-submission authoring-draft contract — v1.9.4

## Evidence and identity

The independently inspected v1.9.3 capture has compressed SHA-256
`c8a15a912edc715a2dc693b2567664a8a06826e34a9bec7a69a7503b9738e17a`.
All ten LFrHs manual authoring records have correctly bound composite IDs,
paired HTTP 200 receipts, matching canonical hashes, AI grader literals and
rich-text submission schemas. No published question bodies were established.

The operator subsequently observed **Unpublished**, only **Draft v.1** in
version history, and disabled learner preview. The API timestamp agrees with
the reported September 20, 2026, 3:31 PM IST edit time.
The material response explicitly says `published: false`. Its separate
`SPnBUGLKT0i5wVBiyj9IGQ@1` reference is source-supplied and remains preserved;
its internal lifecycle is unresolved. A field named `published` in an atom
does not override the item's publication state or establish learner access.

This corrects the framing in the preceding investigation:
`manual-published-gap-2026-10-20.md` stopped the **published** acquisition branch.
That gap does not prohibit independently verifying complete **draft** evidence.

## Contract and implementation

`direct-data-manual-draft.js` introduces
`COMPLETE_BOUND_DRAFT_MANUAL_ASSESSMENT`. It requires:

- Bound course, item, atom, draft version/hash and unchanged final atom.
- Explicit unpublished inventory state; importer independently checks the
  material leaf rather than trusting the projected sourceIdentity flag.
- A complete ordered inventory consisting only of supported manual parts.
- Every initial/final manual observation independently validated for identity,
  receipt, read-only projection, sanitized model, canonical hash and stability.
  Question observations must fall within the initial/final atom observation
  interval; historical stable records cannot silently become current proof.
- Observed AI/rich-text schema, exact supported CML and rubric structures,
  finite nonnegative point values, unique criterion identities, and no unresolved
  media or unsupported submission/grader-instruction structures.
- Exact assignment configuration, introduction/review criteria where supported,
  passing fraction and assignment-level rubric metadata.

Unknown grader enums, file-upload schemas, unsupported metadata/media and partial
or changed responses remain incomplete. Validation flags are retained; readiness
for publication is not treated as publication or successful AI execution.
No answer key is invented. A manual-submission projection preserves native type,
local/composite IDs, original fields and rubric data separately from plain text.

The independent capture importer replays the contract using recomputed hashes
and compares the claimed normalized model and proof. It does not trust a
completion flag or silently repair a forged projection.
Successful rechecks retain prior manual originals and timestamps in separate
history; failed rechecks retain the existing historical-attempt behavior.
The exact v1.9.3 checkpoint build is explicitly eligible for recovery. Old saved
captures are not retroactively relabelled as complete.

The general assessment inventory now understands homogeneous manual-part lists
without falsely routing their IDs to the question-group endpoint. Mixed lists
and other unsupported structures remain outside this contract.
Capture summaries label verified manual-submission drafts and explicitly state
that published bodies remain unverified. Content views retain the same scope
limitation. This adds no new rubric-equivalence or cross-platform answer-key
comparison claim.

## Delivery constraint

The added contract exceeded Chrome's existing 500 KiB bookmark limit under
whitespace-only formatting. The parser now shortens local lexical bindings in
the Coursera bookmark copy only, with compression/dead-code elimination off,
top-level bindings unchanged, property names unchanged, and reflected
function/class names preserved. The linked console source remains intact.
The existing browser size limit and 1 KiB headroom test are unchanged.
Brightspace delivery is unchanged.

Regression tests compare execution for closures, shorthand evidence properties,
dynamic property access, Unicode, regexes, ASI, async completion and reflected
names. Native hosted browser execution remains a mandatory release gate.

## Validation and claims

Local validation passed all 183 test files and seven activity-designer suites,
the focused manual/importer regression checks, and the production build.
The final generated bookmark measured 425,394 encoded bytes before release.
Hosted mandatory checks and deployment status are recorded in the release PR;
these local results alone do not authorize a claim of production deployment.

The synthetic ten-question fixture changes from zero normalized manual questions
and incomplete status to ten preserved manual-submission projections and complete
**draft** status. Unsupported manual models remain retained and incomplete.
Tests reject forged prompt/proof fields, missing records, HTTP failures,
stale observations outside the atom window, unknown graders, unsupported schemas,
invalid rubric points, unresolved media, changed bodies and credential fields.
Original receipts, raw models and historical observations remain retained.

The actual ten uploaded records passed the source-bound observation validator;
the draft model was additionally evaluated on an in-memory copy. This is not a
new real-course capture and does not change the recorded baseline of 61/96,
20/26 assessments and 40/65 readings.

The separate source-extractor assessment is
`source-extractor-assessment-2026-10-20.md`. Source-side completeness remains an
equal architectural requirement. No source acquisition behavior was changed.

## Minimal post-release operator check

After a verified deployment, replace the existing CTI bookmark with the current
bookmark from CTI. Open the existing course Content page and use the existing
saved capture's **native recheck**; do not start a fresh full-course extraction.
Keep the original archive and download the resulting new archive separately.
Inspect LFrHs for ten source-bound draft questions, exact rubric structures,
`COMPLETE_BOUND_DRAFT_MANUAL_ASSESSMENT`, explicit unpublished state and
`publishedBodyVerified: false`. Check that historical originals remain present.
Do not publish the assignment or start a learner attempt for this test.
Any live completeness increase requires inspection of that new evidence.
