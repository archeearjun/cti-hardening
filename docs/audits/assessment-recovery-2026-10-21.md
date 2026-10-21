# Assessment evidence recovery: PR 103

Baseline production/main: 886efeb16e644bc45058404c1b651beb197c97d4.
Comparison build: v8.0.5-assessment-recovery-20261021.

## Evidence identity and unchanged baseline

Archive 2.zip passes ZIP CRC validation. SHA-256:
9b4bca41dab9d9370614d7fb55251f328d6b18b2a2723d9e98fc964209ce00b9.
It contains the 108,841,037-byte CTI_QA_result (2).json and the 6,458,049-byte
CTI_owner_report (3).txt. The owner report is byte-identical to the prior upload;
the JSON's embedded report occurs verbatim in it. Saved audit:
b00f533c-91ed-4865-a2e7-97b2559d95fc. JSON SHA-256:
1809a6d05a271aab7856b5de42ee24c0a1d6666815c3ce6e8be31a481265afe3.
The repeated request is identical to the earlier PR103 instructions.

Recorded baseline: 161 core / 198 source inventory / 96 destination inventory;
5 VERIFIED, 5 PARTIAL, 111 UNVERIFIED (89 unmatched, 22 mapped), 0 MISSING,
13 REPACKAGED; 27% observed match and 27% coverage; four critical findings.
Source definitions remain 47 across seven quizzes; native capture remains v1.9.4,
62/96. No new live acquisition occurred. The comparison export does not supply
the complete original source scan and original media archive, so no new full
course verdict calculation is claimed. This change leaves saved results immutable.

## Shared mechanisms and supported changes

| Mechanism | Retained evidence | Implemented behavior |
| --- | --- | --- |
| Weekly authoring editors contain zero recorded positions | 06PMM/aKtOx/vY3GP/vwFDB/Kd5up have EMPTY coverage and expected zero; paired source definition counts 2/8/3/8/12 | Produce item-specific inspection plans distinguishing empty editors from missing material across the course. No speculative acquisition or question creation. |
| Source bank scope remains unknown | Native quizzes 324438, 347076–347081; 47 definitions | Preserve existing limits. Pagination and descriptive counts do not establish banks or draw policies. |
| Brightspace question HTML loses media references in normalization | Raw QuestionText retained separately; reference projection omitted | Extract media references from HTML into question mediaRefs without fetching or certifying originals. Preserve original HTML and question IDs. |
| QTI scoring conditions lost in owner projection | QTI wildcard and numeric-bound structures are richer than flattened answer arrays | Preserve response-processing/declaration trees and exact attribute/text values in sourceTypeEvidence; expose bounded original settings in owner content. Oversized settings remain explicitly unavailable in the projection. No wildcard/tolerance interpretation is invented. |
| Exact text candidates have unresolved parity dimensions | Nine unique pairs, three practice and six final | Report prompt/options/answer text/type/feedback dimensions separately. Scoring, structured math, rubric, attempts, media and version remain UNVERIFIED without independent contracts. Different native taxonomies are not automatically type mutations. |
| Final assessment image failure | Exact native question IDs at destination positions 2 and 4 contain image-creation error placeholders | Repair manifest retains destination failure IDs independently of source media positions; no ordinal-based source binding. Four absent-package references and one alternate-path filename candidate remain distinct. |
| Media identity uncertainty | Existing source package path receipts | Resolver accepts exact paths with verified originals or an explicitly supplied matching SHA-256; rejects hash conflicts, never resolves by filename alone. Existing saved report candidates lack hashes and remain unresolved. This does not recover bytes absent from the supplied files. |
| External question bodies not acquired | Actual OpentextBC source URLs in source content views | Report original URL/provider and distinct reference/configuration/body/runtime/learner scopes. Point to existing public-source-question recovery; do not invent widget APIs. |
| Blank owner guidance | mappingAmbiguity uses itemId; renderer read only reconciliationDiagnostic.id | Render both candidate forms as unconfirmed; missing candidates have explicit guidance. No false identity-match assertion. |
| Focused check revision ambiguity | Existing one-item workflow already binds audit/course/item and expectations | Bind new receipts to source-scan/Coursera/Brightspace input hashes, reject foreign revisions, retain legacy receipts as historical. Existing extension deduplication, progress, saved follow-ups and report append-only behavior remain in place. |

## Deliberate limits

No new Brightspace question-library/pool API has been observed. No QTI-to-native
crosswalk is invented. Source and destination question ordinals are not a mapping.
The two broken destination prompts cannot independently identify their original
source questions; repair requires confirmation using source content/transformation
evidence. Filename candidates do not identify exact original bytes.

No new Coursera acquisition endpoint or published-assessment body contract is
introduced. Existing manual-draft, empty-draft, published-reading and Coach
contracts remain unchanged. Owner intent is not a completeness receipt. Archive
and Instructor exclusions remain outside automated publication tasks.

The existing focused check captures one current item; it is not a missing-field-only
native API collector. This release does not add automatic multi-item queued recovery
or cross-browser interrupted-session adoption. Existing extension/checkpoint limits
still apply; failed checks preserve prior evidence. No new cloud/browser infrastructure
or paid service is used. No server queue, chunk transfer or original media is changed.

## Verification

All 189 local test files and seven activity suites pass; production build and
129-module binding checks pass. Thirteen new regression cases cover the actual
weekly/final evidence, candidate dimensions, source media/scoring retention,
missing mapping guidance, exclusions and focused-check revision rejection.
The unchanged capture-entry test passes on rerun; its initial suite failure was
not used to justify weakening an assertion. The parity ledger explicitly records
the reviewed source normalization/scoring projection and release metadata changes.

Replay on the exact saved comparison yields nine exact text candidate pairs:
nine matching prompt projections and three matching ordered-option/answer-key
projections. Zero whole-question pairs gain verified parity. Source settings,
bank totals, media, grading/rubric and published scopes remain independent.
Structured recovery manifests are appended to followUp.assessmentRecoveryPlans;
they do not replace original verdicts or imply any LMS repair was performed.

## Operator steps and external dependencies

1. Reload CTI and re-export the saved comparison for the new decision brief. Save
   any new comparison alongside the original; reuse the original scan/captures.
2. For a new focused check, open the saved comparison's exact item action card.
   Start with LFrHs, then the five weekly IDs. Use the manual one-item script or
   update the existing CTI extension to 1.0.23. No full-course bookmark update.
   Import the result to the same card; keep previous evidence and the original
   verdict separate from follow-up observations.
3. For source settings/media projections, reprocess the same original IMSCC and
   retained Brightspace capture. No fresh full-course extraction is required.
4. Inspect Brightspace Quizzes → Edit → Questions/Question Library for quiz IDs
   324438 and 347076–347081. Retain authored question/pool IDs, membership and draw
   policy only; omit learner attempts, session headers/cookies and credentials.
5. For practice widgets, use the item's recorded OpentextBC URL and existing public
   source-question recovery. If no supported definition response is available,
   request the underlying source body/configuration rather than fabricate questions.
6. Confirm the source question intended for each failed LFrHs prompt before any
   manual image repair. Obtain absent originals from the source owner; verify hashes
   for candidate files and inspect rendering afterward. This release edits no LMS.
7. On another course, repeat using its own saved comparison and input revisions;
   TRDE120 IDs, counts and mappings are not transferable evidence.
