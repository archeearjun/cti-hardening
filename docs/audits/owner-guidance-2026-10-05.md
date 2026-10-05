# Owner guidance: text preservation and publication readiness

## Evidence and scope

Reviewed the five supplied Instructor Contact Information screenshots, the
original TRDE120 package's scanned item, and the maintained code for destination
readiness, readiness-to-owner aggregation, text/file/link comparison, owner task
mapping, saved content presentation, focused follow-ups, source-file retrieval,
and owner browser checks. The screenshots show the main body and dummy contact
fields in both systems. Brightspace also shows a facilitator heading and a
placeholder portrait that are not visible in the Coursera editor screenshot.

The original package records 377 text characters, dummy contact fields, and
references to instructor.jpg and logo.png under a shared Brightspace template
path. These image references alone do not establish image bytes in the package,
successful rendering, or confirmed destination loss. The source text includes
the heading twice. The shown Coursera capture retains 352 characters, including
an “Opens in a new tab” UI phrase. Character ratios are not completion scores.

A synthetic-identity workflow fixture reproduces the supplied text and image
references through the actual comparison engine. Text passes its similarity
check, while PLACEHOLDER_CONTACT_INFO produces a separate readiness review.
The latest authenticated source/Coursera pages and original October 5 capture
JSONs were not available for an end-to-end live re-audit in this change. The
fixture is a reproduction, not a claim to have rerun that saved production audit.

## Confirmed issues and corrections

| Location | Evidence and owner impact | Severity | Correction and verification |
| --- | --- | --- | --- |
| OwnerActionCard | Long capture panels preceded “What to do”; a generic review badge hid whether the issue was content loss or readiness. | Medium, usability | Put action and field-level comparison first; label explicitly readiness-only reviews. Test the real comparison fixture in Chromium. |
| Owner action presentation | Contact placeholders inherited from source were presented without their source origin or a clear path when approved details were unavailable. | Medium, product clarity | Show the source-template origin when saved source text supports it; request approved details, condition removal on course requirements, and explain Blocked/Changed/Checked outcomes. Test absent source and mixed-defect cases. |
| ContentEvidencePanel | Plain readings showed unknown question totals despite no assessment expectation. | Low, usability | Hide irrelevant question controls for readings; retain uncertainty for assessments, activities, recorded questions, expected zero, and previous/fetched question observations. Test each boundary. |
| ContentEvidencePanel / SourceRepairEvidence | Raw reference counts could be mistaken for missing-file totals; adjacent source links ran together. | Low, clarity/accessibility | Explain reference-count limits, surface source image references for visual review, and space links using existing action-link layout. |

## Preserved behavior

No engine, extraction, scoring, matching, dimensional gate, policy, or persistence
rule changed. Existing actions remain concurrent: a missing file is not replaced
by a contact-readiness task. Unknown checks do not become passes. All mapped
source rows remain represented. Follow-up captures do not recalculate or clear
the original audit; the interface explicitly distinguishes them. Raw evidence,
exact item links, plugin/source fetches, package identity checks, manual outcomes,
and exports remain available.

## Verification

- Full `npm test`: historical checks, module validation and 294 Node tests pass.
- `npm run build`: TypeScript and production build pass; existing bundle-size
  warnings remain.
- Focused guidance/navigation/content tests: 29 pass.
- Owner and responsive UX browser suites run against the built app, including
  wrong-item and wrong-package rejection, failed refresh preservation, review
  persistence, immutable audits, exports, keyboard expansion, and the new
  contact-template case at desktop and 390px widths.

This is a scoped owner-guidance correction. It does not certify every live
course, learner rendering, external plugin, or the complete historical corpus.
No data migration, configuration change, or repeat extraction is required to
display the new guidance on existing reports.
