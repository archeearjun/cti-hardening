# Field evidence validation

Release: Coursera v6.14.5 / schema 34; Brightspace v1.0.7 / schema 2; QA build v8.0.0-field-evidence-20260929.

This update addresses defects exposed by a fresh validation capture after the saved-corpus extraction update. Original captures remain immutable and reusable.

## Changes

- Compare narrowly recognized numeric units, square/cubic notation and fractions before older prose normalization. A historical visual/TeX/accessibility duplicate is accepted only when all three representations agree exactly. Different values, signs, units, exponents and mixed fractions retain their differences. This is representation normalization, not mathematical evaluation.
- Read one TeX annotation from a recognized math renderer and preserve superscripts in newly captured option text.
- Accept short text from the bounded production discussion prompt field. The existing caller still verifies exact item/course identity; empty and truncated fields do not become complete evidence.
- Resolve Brightspace content-page links, images and embeds against the response URL and an observed HTML base element. Retain the raw attribute and document base. Existing absolute links are not retrospectively guessed or rewritten.
- Recognize declared quiz lengths with short-answer, matching and other explicit type qualifiers. Preserve earlier incomplete-coverage receipts and distinguish described exam length from a question bank or pool.
- Show final assessment payload counts separately from intermediate question-cycle observations in owner reports.
- Localize a quoted question's ingestion-media warning to its exact assessment prompt. A shared filename or fuzzy module name cannot override that scope. Historical warnings still require checking current media availability.

## Validation and limits

Eight synthetic regression cases exercise real math mutations, contradictory duplicated representations, bounded short/empty/truncated discussions, content URL resolution (including redirects and HTML base), declared-count ambiguity, final versus intermediate report counts, and quoted-question media scope. They complement the existing regression suites.

Private validation also compares the three reported math discrepancies using captured Brightspace and Coursera answer evidence. All three now have exact option and answer agreement. Private inputs are not committed here.

The saved cohort supports 12 full comparisons and 15 capture-only reviews across 15 course titles. Capture-only reviews do not establish package fidelity. Browser and LMS acceptance of the new extractors still requires a representative live capture; local regression success is not a publication sign-off.

## Operator sequence

First regenerate the comparison from the existing source fingerprint, matching XLSX and saved JSON captures. This applies report fixes without another crawl. Keep unresolved source/destination count differences and media checks open. Validate newly captured discussion text and content-relative URLs on the representative course before requesting any wider recapture.
