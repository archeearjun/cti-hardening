# Assignment identity and published plugin capture

Coursera: **v6.14.3**, schema 34, build `v6.14.3-assignment-identity-20260928`.
QA: **v8.0.0-assignment-identity-20260928**. Brightspace and source scanning are unchanged.

## Demonstrated faults

A published reflective question was captured repeatedly from overlapping DOM
containers. Different authoring-control tails made the same prompt appear to be
several questions. The broad-parser count then overrode the observed Content(1)
outline. It was not evidence of additional question positions.

The published reflective type field and the AI-graded file-upload heading were
not supported by the applicable-answer coverage rule. Grader instructions and a
rubric viewer could also leak into the file-upload question prompt. Published
External Webpage plugins exposed View Configuration rather than Choose Plugin,
which produced an unnecessary configuration-evidence warning despite a preserved
item-scoped launch URL.

## Changes

- Parse identified assignment parts before unbounded ancestor cards. Preserve
  separate question IDs even when their prompts are identical. Mounted subsets
  remain incomplete until outline traversal resolves the other parts.
- Use the observed outline count rather than a broad-parser count hint.
- Recognise a reflective response only from its disabled, exact response-type
  field and its bounded prompt viewer. Recognise file-upload responses from the
  anchored editor heading and explicit authoring-section boundary.
- Record file uploads as `file-upload`, without inventing a correct answer.
  Grader/rubric configuration remains a separate verification concern. An unknown
  lone question is no longer sufficient to claim fully hydrated evidence.
- Recognise published External Webpage configuration controls. For existing
  captures, require matching item identity, scoped text and the exact recorded UI
  boundary; all existing exact-URL/confidence/ambiguity gates remain in force.
  Configuration verification does not verify learner launch or remote content.
- Owner diagnostics distinguish question records, unique question IDs and question
  coverage, and exclude explicitly non-applicable answer keys from required-key
  coverage. Original capture evidence is retained.

## Validation and limits

Ten regression tests exercise the full assessment collector, duplicate DOM
containers, identical prompts with separate IDs, partially mounted assessments,
unknown types, response boundaries, published plugin evidence and owner output.
Existing regression suites and the production build pass. Google-dependent
integration/full-golden suites are not run in the local runtime.

A check against the supplied capture confirms that its resource plugin target
can be verified by the updated report while launch remains unobserved. The new
extractor has not yet been run against the live course. Re-capture the affected
course once to confirm the changed DOM paths; there is no basis for re-running
all 15 titles. The separate unmatched Welcome reading still requires source and
placement review and is not declared recovered by these changes.
