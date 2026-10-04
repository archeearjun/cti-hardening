# Unknown assessment fields — 4 October 2026

QA build: `v8.0.0-unknown-assessment-evidence-20261004`.
The Coursera extractor remains v6.15.7/schema 35. This changes report
interpretation; it does not recover fields absent from a saved capture.

## Confirmed defect

A fresh two-question survey capture contained both declared question positions,
but both types were unknown and options/keys were empty. The source had choice
questions without complete key evidence. The report incorrectly described the
destination keys as complete and directed the owner only to source evidence.

Unknown types are excluded from the answerable-question denominator. Comparing
zero captured keys with zero recognized answerable questions therefore produced
a false COMPLETE result in `qaAssessmentAnswerEvidenceSide_`. If source keys
were complete, the aggregate answer coverage could also incorrectly be 100%,
despite the overall assessment remaining unverified. Severity: medium; the
misleading field status and guidance could cause a required destination check
to be skipped.

## Correction and verification

- Unknown/unsupported types leave aggregate answer coverage unknown, rather
  than claiming a percentage. The report explicitly displays that uncertainty.
- Evidence-side guidance checks observed types and explicit incomplete-key
  receipts. Independently observed source-key gaps remain visible.
- Capture readiness includes unknown field types even when all positions were
  captured. Owners receive focused field-inspection guidance. Genuine missing
  positions, source-only gaps, media reviews, and critical failures keep their
  separate guidance and safeguards.
- Four synthetic regression cases reproduce the defect, including complete
  source keys, contradictory capture receipts, unmatched unknown types,
  incomplete destination positions, and independent ingestion failures.
- Replaying the supplied capture preserves all 161 item verdicts and all four
  critical owner findings while correcting the survey guidance. No private
  course data is included in these tests or committed to this repository.

The affected survey still requires inspection of question types, options, and
answer-key applicability. A report correction cannot establish those missing
fields. Reuse the existing capture for the corrected report; another full
course crawl is not required to apply this fix.
