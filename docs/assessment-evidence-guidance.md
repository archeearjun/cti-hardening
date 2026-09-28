# Assessment evidence guidance

QA build: `v8.0.0-assessment-guidance-20260928`.
Coursera remains `v6.14.2` / schema 34. Brightspace is unchanged.

An unverified assessment can have complete question/answer fields but unverified
images. Previously the owner report prescribed question-bank inspection and
recapture even for this media-only case. A source-side missing answer key could
also label a complete destination question capture `CAPTURE_INCOMPLETE`.

The report now distinguishes these findings:

- Matching prompts and answers with unverified media receive a numbered media
  rendering check. The assessment remains unverified; behavior and publication
  findings are retained.
- Source-only answer gaps with captured destination counts matching their
  declarations receive `SOURCE_ASSESSMENT_EVIDENCE_REVIEW`. The owner must inspect
  the source keys and any unaligned source questions.
- Source questions without destination matches receive placement, omission and
  selection-policy review. Counts alone do not prove deletion or a failed crawl.
- Known uncaptured destination questions retain `CAPTURE_INCOMPLETE`. Unknown
  totals, missing destination answer evidence, older versions and unresolved
  editor visits remain visible and are not promoted to complete evidence.

This changes guidance only, not matching, scoring, source evidence, ingestion
decisions or extractor behavior. Existing captures can be reused for a new QA
comparison. Saved historical reports retain the original advice.

Synthetic regression tests cover the media-only case, independent failures,
source-only keys, count differences, mixed/unknown destination evidence,
incomplete editor traversal and downloadable report wording. Private uploaded
course material is not included in fixtures.
