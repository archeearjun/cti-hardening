# Syllabus visibility and source wording review

QA release: `v8.0.1-source-wording-readiness-20261005`.

## Evidence and confirmed defects

The uploaded October 5 owner report contains TRDE120 - Course Syllabus, item
E4mY0 under Welcome - Start Here!, marked VERIFIED with no owner action. Its
captured text is retained in the same report. The screenshot's item gap is
consistent with the default Needs attention view: that view filters out items
with no owner action. The All findings dropdown operates inside that view.

Reading the actual source/package/Coursera excerpts revealed two additional
problems. Coursera contains five explicit authoring prompts beginning with
“Include your”, “Include information”, or “Brief description of assessment”.
The readiness regex only recognized Add/Insert/Enter. Also, the Brightspace
capture includes an overall 50% pass requirement, a GenAI statement and other
course-policy wording not established by the package/Coursera excerpts. The
existing broad package/live similarity threshold did not flag these localized
differences, and package fidelity passing was presented with no owner action.

| Area | Impact / severity | Implemented correction |
| --- | --- | --- |
| OwnerEvidence filters | A captured item appears absent; medium usability | Name the active work view beside the result count and expose hidden matching items with a one-click All items action that preserves the query/status filters. |
| Destination readiness | Unfilled syllabus prompts escape review; medium correctness | Recognize explicit syllabus authoring prompts, include bounded examples in the finding, and require approved information rather than invented policies. Normal brackets/citations remain valid. |
| Live source reconciliation | Localized policy wording can be overlooked despite matching package text; high correctness | Add a separate evidence review for substantive observed live-source wording not established in the package or mapped destination capture. Preserve the package comparison verdict and require reconciliation of intended source versions. |

## Scope and safeguards

Reviewed the uploaded screenshots/report, owner filtering and task mapping,
readiness aggregation, Brightspace text enrichment/matching, course comparison
orchestration, policy exemptions, report generation and associated tests.
Changed the filter UI, narrow readiness rule and new live-text review module,
plus explicit release/parity metadata and targeted tests.

The new live-text check is a bounded wording heuristic, not semantic equivalence
or proof of missing content. It requires one exact, unambiguous mapped topic
with captured page text and one mapped Reading destination. It does not use
permission failures, fuzzy/duplicate topic mappings, composite families or a
source baseline that was itself populated from live text. It compares normalized
five-word windows for candidate passages (8+ words, 50–1600 characters, at least
three novel windows and 30% novelty), considering at most 40,000 characters and
256 candidate passages, with six retained examples and an additional count.
These conservative bounds leave other cases unverified; they are not a
completeness guarantee. Paraphrases, intended edits and source-version changes
are explicitly possible. Existing stronger defects remain concurrent. NAIT
Archive/Instructor Resources policy exemptions remain diagnostic.

No raw report or capture is rewritten, no content is changed on an LMS, and no
re-ingestion is automatically requested. Existing reports gain clearer filtering
immediately. Applying changed audit rules requires a new comparison; the same
input files can be reused to re-evaluate the same captured state. Verifying later
course edits requires current evidence. The frozen Apps Script reference is
unchanged; intentional native rule changes have reviewed ledger hashes.

## Verification and remaining limits

Regression tests exercise explicit/ordinary brackets, source and destination
identity, changed vs already-preserved source wording, absent/permission-limited
captures, archive policy, concurrent readiness findings, immutable input and
bounded output. A separate field-level replay of the supplied report identified
the five authoring prompts and substantive source policy/schedule passages.
Synthetic identities are used in checked-in fixtures; private reports are not
committed. Browser checks exercise a filtered-out syllabus, search-preserving
recovery, a new actionable syllabus, and mobile rendering. Full test/build and
affected owner/responsive suites are release gates.
Local verification passed: 302 Node tests plus historical/module/parity checks,
production build/typecheck, owner browser suite and responsive UX suite.

The current authenticated LMS pages and full original extraction JSONs were not
rerun for this change. The report records observations at 08:10/08:15 UTC; the
09:29 export is not a new capture. This is not an audit of every live title or a
certification of publication readiness.
