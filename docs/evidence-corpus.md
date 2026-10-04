# Reuse saved evidence across releases

QA build: **v8.0.0-corpus-review-20260928**. The Coursera and Brightspace
extractors are unchanged. This release does not require a fresh extraction.

## Batch replay

`tools/replay-evidence-corpus.mjs` reviews a private collection of historical
captures in one run. It uses the current canonical normalizers and, where a
source scan and XLSX are supplied, the complete comparison and owner-report
workflow. It does not contact Coursera, Brightspace, Google, or the team database.

Keep the input collection and output directory outside this public repository.
Use explicit case labels and snapshot modes; file names such as `new` do not
prove current ingestion capability or establish before/after lineage.

```json
{
  "kind": "CTI_EVIDENCE_CORPUS",
  "schemaVersion": 1,
  "cases": [
    {
      "id": "example-before",
      "course": "EXAMPLE101",
      "label": "Saved before capture",
      "partner": "Example Partner",
      "coursera": "before.json",
      "brightspace": "source.json",
      "excel": "before.xlsx",
      "sourceScan": "package-scan.json",
      "historicalReport": "before-report.txt",
      "mode": "raw"
    }
  ]
}
```

Run after `npm run generate`:

```sh
node tools/replay-evidence-corpus.mjs /private/evidence/manifest.json /private/evidence/review-current
```

The output includes input hashes, original capture build/time, observed editor
coverage, grouped question-evidence gaps, full comparison JSON and owner text
reports. A case without a source scan is explicitly `CAPTURE_REVIEW_ONLY` and
gets no source-fidelity verdict. One failed case does not discard later cases;
the command exits nonzero when any case failed. Supplied inputs are never written.

Each comparison is independent, using no historical memory and unknown current
ingestion capability. Historical report bytes are retained by hash, not treated
as a verdict from the current engine. Counts are not summed into a portfolio
quality score. Original captures are not relabelled as a new extractor version.

## Shared verifier correction

Brightspace captures can explicitly report an unknown question-definition total
even after reaching the end of API pagination. The old adapter discarded that
receipt, substituted the captured count for an unknown declaration, and allowed
matching captured subsets to produce `VERIFIED`.

The adapter now retains the observed declaration separately and carries the
definition-coverage receipt through repeated normalization. Unknown, partial,
contradictory and legacy API totals block complete assessment verification.
Observed answer defects remain actionable. Independently captured package QTI
definitions retain their own evidence and are not downgraded by an unrelated
Brightspace API gap. Owner guidance points to the source definition gap rather
than requesting another identical destination crawl.

## Lesson containers in older captures

Older captures can queue empty lesson containers as unknown items. The QA engine
now recognizes exact `**Lesson ID` and `**Module ID` rows from the paired XLSX.
It excludes those IDs from the editor denominator only when at least five stable
item IDs establish strong exact overlap with the capture. Conflicting item IDs,
name-only matches, and incoherent exports do not qualify. Original target and
visited counts are retained beside the adjusted inventory.

This correction works on saved captures: it does not require visiting the course
again. It does not assert that every observed editor has complete payload, that
an external plugin works, or that an actually missing item was recovered.

## Validation boundary

Offline replay tests comparison and interpretation of saved evidence. It cannot
test new live DOM routes, remote plugin playback, current learner visibility, or
content that was never captured. After a relevant extractor change, choose a
representative affected item for live validation and retain the rest of the
collection as regression evidence. A newer version by itself is not a reason to
recapture every course.

## Check whether known historical errors still get through

A successful replay only proves that processing completed. Use a separate,
evidence-authored expectation manifest to assert what the current verdict,
evidence dimension and owner action must say for each known historical case.
Include positive controls so "flag everything" cannot pass.

```sh
node tools/check-corpus-expectations.mjs /private/evidence/expectations.json /private/evidence/review-current
```

The private manifest has `kind: "CTI_CORPUS_EXPECTATIONS"`, `schemaVersion: 1`
and a nonempty `checks` array. Each check has a unique `id`, replay `caseId`,
evidence-based `description`, `target` (`comparison` or `capture`), the complete
`inputHashes` from that historical case, and explicit `assertions`. An optional
`match` object selects exactly one result item (prefer `sourceId`) or captured
assessment (prefer `id`) by exact fields. Without it, assertions target the
whole comparison result or capture review.

Each assertion has a `path` array, an `operator` (`equals`, `notEquals`, `oneOf`,
`contains`, `excludes`) and an expected `value`. Array indices are numbers.
Missing evidence fails negative assertions too; an absent field is not a
successful "not VERIFIED" check. Zero/false are retained as real values.

For example, a documented failed assessment should require both
`["verdict"] equals "INGESTION_FAILURE"` and
`["ownerAction", "severity"] equals "CRITICAL"`. A preserved renamed attachment
should require its exact hash-match receipt and no false missing-asset warning.
Do not generate expected outcomes by copying current verdicts.

Missing/ambiguous items, changed inputs, missing fields and wrong decisions fail.
A missing full source comparison is `BLOCKED`, never a pass. Exit codes are 0
for all explicit checks passing, 1 for failures, and 2 for incomplete coverage.
This gate does not certify unenumerated errors or current live collection.

The private 15-title set currently has 63 explicit checks: known failed/empty
assessments, grading changes, unresolved and preserved attachments, positive
question/answer controls, source-total uncertainty, mixed-editor gaps and three
report false positives. Baseline main fails those three false-positive checks;
the corpus-convergence correction passes 59 with zero failures and four blocked
full-source grading cases. Counts describe assertions, not 63 distinct bugs.
