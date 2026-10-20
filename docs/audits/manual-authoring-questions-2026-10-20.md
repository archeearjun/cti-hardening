# Manual-submission authoring questions · v1.9.2

## Evidence and scope

The owner observed an authorized HTTP 200 from
`authoringAssignmentManualGradedQuestions.v1/{questionId}` in the actual
Coursera authoring editor. The reported `elements` member contained an AI
grader, assess/1 CML, richText submission schema, multiLineInput rubric criteria
with two points, and publish-readiness validation. No live response body or
credential is committed. The sanitized fixture mirrors this reported shape;
its IDs and question/rubric text are synthetic. Nested empty configuration
objects are synthetic test values, not claims about the actual configuration.

The independent recovered archive binds ten literal manual-question IDs to
LFrHs's draft assignment. Its raw parts are sufficient to resolve all ten
request IDs. A single observed response does not establish that all ten work.
LFrHs's missing question bodies and the eight separate published-state gaps
(including SekFW) remain distinct limitations.

## Correction

The previous candidate prepended the assignment atom ID to the question ID
and requested ALL fields. The adapter now uses the literal bound 22-character
question ID in the path and `id` query, and requests only:

`id,plagiarismConfig,graderType,graderInstructions,academicIntegrityConfiguration,prompt,rubrics,schema,submissionSchema,validation`

No ALL header, includes expansion or write token is requested. The existing
same-origin authorized browser reader supplies bounded GETs; no authentication
material is copied into CTI. Mandatory credential sanitization applies even
when an injected reader sanitizer is permissive. Only the original response
hash and byte count survive alongside sanitized JSON, never the raw wire body.

Two matching source reads preserve exact CML (including renderable metadata),
rubrics, points, schemas, literal grader configuration, validation, and explicit
empty values. The manual-submission adapter is independent of graderType: AI
and non-AI values remain literal; it does not emulate or infer grader behavior.
The staff grader enum and live staff acquisition remain unobserved. Missing
optional fields are not synthesized. Unknown shapes remain raw evidence.

A native recheck retains prior originals and timestamps and stores new manual
observations in `payload.directNativeRecheckAttempt.assessmentApiEvidence.manualDefinitions`.
It does not replace a prior assessment merely because some bodies were acquired.
New acquisitions carry `CURRENT_AUTHORING_QUESTION` and
`publishedBodyVerified: false`. Publish readiness is source validation, not
proof of a published learner-facing body. No normalized questions, answer
keys, published versions or real-course verification counts are invented.

## Acceptance and preservation

Focused tests cover the ten audited IDs, exact read-only projection, unsolicited
credential removal, CML and rubric fidelity, richText schemas, literal AI/non-AI
classification, optional/empty values, wrong identity, source order, source
mutation, receipt timestamps and recheck history. Retained-content snapshot
round trips keep exact JSON and explicitly unverified published status.
The existing source-empty-choice, recovery/404/historical-page and BOM original
byte regressions remain required. No original capture files are modified.

Before/after fixture changes: ten manufactured composite paths become ten
literal bound paths; ALL becomes an explicit ten-field projection; ten
stable source records now identify supported manual content rather than only
unknown grading semantics. Two observations per ID remain mandatory. Fully
verified item counts do not increase from these fixture tests.

## Minimal next live test

Update the existing CTI capture bookmark to v1.9.2 after production verification.
In the same authorized Coursera browser profile, reopen the existing TRDE120
checkpoint and run **Recheck native course content** (the existing recheck action;
there is no item-only manual recheck control). Do not start another full capture
or retry publisher images. Export a new saved ZIP while preserving both originals.
Inspect LFrHs's separate native-recheck attempt for the ten literal bound IDs,
paired status-200 receipts, matching sanitized models, exact prompt/rubric/schema
fields, and no credential fields. Record each individual failure as such.
A successful draft read does not resolve SekFW's published-body gap or certify
whole-course completeness. No HAR, cookies, headers, learner submissions or
write tokens are needed.

## SekFW published reading: response contract, request still missing

The owner's subsequent real array-wrapped `ItemAuthoringFrameworkData` response
has `draftItemContent: null` and typed `publishedItemContent` containing exact
assess/1 CML, title and `PT5M`. The recovered archive independently maps SekFW
to atom `GKCvb7TaEfGg4wr_4_HHGw` through the exact
`iu5pMbTVEfG-2xL_w9lGpQ~SekFW` relation, with published native atom state.
This establishes the identity association, not a current successful CTI read.

The reusable response-only adapter validates inventory/material, atom, relation,
course, published state, GraphQL identities and the unique latest parent branch.
It retains supported published fields and meaningful null draft separately,
keeps observation provenance and never assigns a historical version. An allowlist
omits editing and permission fields; the shared sanitizer additionally removes
`conflictDetectionToken`. Synthetic fixtures mirror the observed wrapper/types.

The repository has no request document or variables for this operation. The
older crawl watches generic GraphQL responses; that is not an authorized request
definition for deterministic replay. This adapter is therefore not wired into
native network acquisition or completeness. The minimum outstanding evidence
is the exact HTTP method, GraphQL document/operationName and variables from this
request's Payload tab, excluding headers, cookies, credentials and learner data.
No request is invented. Once safely acquired with fresh matching bindings and
source stability, this body contract could address SekFW's reading gap and other
readings that meet the same contract. It does not apply to arbitrary published
assignments or prove historical published versions.
