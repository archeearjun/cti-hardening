# CTI development map

The maintained app uses React/TypeScript for its interface, workflows and storage,
with native JavaScript modules for the retained evidence rules. Functions import
their dependencies explicitly; there is no ordered legacy manifest, engine
concatenation, or dependency on Code.gs/Index.html in the Cloudflare build.

## Where to change a feature

| Change | Maintained source | Focused check |
| --- | --- | --- |
| Site identity, owner boundary and gateway | `server/access.ts`, `server/site-access.ts`, `functions/_middleware.ts`, `web/App.tsx`, `public/activity-gateway.*` | `tests/site-access.test.mjs`; `node tools/browser-site-access-check.mjs`; [site access](site-access.md) |
| Independent Role Play & Dialogue preview | `src/activity-designer/`, `tools/build-activity-designer.mjs`, owner gateway in `web/OwnerWorkspace.tsx` | `npm run test:activities`; `npm run test:browser:activities`; [boundary and evidence limits](activity-designer.md) |
| Source/Coursera content view and original-input supplements | `src/domain/content-evidence.ts`, `owner-content.ts`, `report-content-store.ts`, `web/ContentEvidencePanel.tsx` | `tests/content-evidence.test.mjs`; `npm run test:browser:owner` |
| Static Brightspace tab/panel, table and resource relationships | `src/domain/brightspace-html-structure.ts`, `web/BrightspaceHtmlStructure.tsx` | Static HTML structure/content snapshot tests; `npm run test:browser:owner` |
| Captured native shell outline, empty containers and source names | `src/domain/capture-structure.ts`, `native-course-outline.ts`, `web/NativeCourseOutline.tsx` | `tests/unified-inputs.test.mjs`; native outline validation tests; `npm run test:browser:owner` |
| Recorded Coursera public links and separate fetched page observations | `src/domain/coursera-linked-content.ts`, `owner-content.ts`, `web/OwnerActionCard.tsx` | `tests/coursera-linked-content.test.mjs`; `npm run test:browser:owner` |
| Automatic public source question definitions | `src/domain/external-source-questions.ts`, `server/source-questions.ts` | `tests/external-source-questions.test.mjs`; `npm run test:browser:owner` |
| Source answer keys, feedback, original definitions and reuse | `src/domain/h5p-definition-evidence.ts`, `source-bank-summary.ts`, `web/SourceBankTools.tsx` | `tests/h5p-answer-evidence.test.mjs`; `npm run test:browser:owner` |
| Independent CTI answer calculations, key conflicts and subject-review briefs | `src/domain/exact-math.ts`, `percentage-math.ts`, `supported-math-text.ts`, `cti-answer-check.ts`, `web/CtiAnswerPanel.tsx` | `tests/cti-answer-check.test.mjs`, `tests/cti-percentage-check.test.mjs`; `npm run test:browser:owner` |
| Source versus Coursera question counts and reviewed references | `src/domain/question-counts.ts`, `web/QuestionCountPanel.tsx` | `tests/question-counts.test.mjs`; `npm run test:browser:owner` |
| Source item links, captured topic identity, course URLs | `src/domain/source-navigation.ts`, `owner-urls.ts` | `npm run test:navigation` |
| Assignment sequence, reconciliation review and deliverable prerequisites | `src/domain/assignment-plan.ts`, `web/AssignmentPlan.tsx`, `src/domain/operations.ts` | `tests/assignment-plan.test.mjs`; `npm run test:browser:ux` |
| Guided evidence stages, source provenance and local Brightspace input | `src/domain/assignment-evidence.ts`, `src/domain/brightspace-local-extraction.ts`, `web/SourceLmsCapture.tsx` | `tests/assignment-evidence.test.mjs`; `npm run test:browser:ux` |
| Owner checklist relevance, hierarchy and module times | `src/domain/owner-scope.ts`, `owner-time.ts`, `web/OwnerChecklistTree.tsx`, `ModuleTimeSummary.tsx`, `src/extractors/coursera/time-estimates.js` | `tests/owner-scope-time.test.mjs`; `npm run test:browser:owner`; `npm run test:browser:choices` |
| Owner tasks, manual review | `src/domain/owner-actions.ts`, `web/OwnerActionCard.tsx` | `npm run test:navigation` |
| Owner explanations, source-template readiness, relevant question controls | `src/domain/owner-guidance.ts`, `web/OwnerAssessment.tsx` | `tests/owner-guidance.test.mjs`; `npm run test:browser:owner` |
| Focused item/plugin checks | `src/domain/item-check.ts`, `plugin-check.ts` | `npm run test:navigation` |
| Panopto response metadata attached to an exact captured item | `src/domain/panopto-delivery-info.ts`, `web/PanoptoEvidencePanel.tsx`, `owner-content.ts`, `owner-report-export.ts` | `tests/panopto-delivery-info.test.mjs`; `tests/panopto-owner-evidence.test.mjs`; `npm run test:browser:owner` |
| One-click item refresh and local Chrome extension | `src/browser-extension/`, `src/domain/browser-item-refresh.ts`, `extension-item-script.ts`, `web/CourseraItemRefresh.tsx` | `tests/browser-item-refresh.test.mjs`; `npm run test:browser:owner`; `npm run test:browser:extension`; [installation and boundaries](browser-item-refresh.md) |
| Coursera capture | `src/extractors/coursera/` | `npm run test:extractors`; `npm run test:browser:choices` for rendered choice layouts |
| Full course bookmark and direct authoring drafts | `src/extractors/coursera/direct-data-*`, `src/domain/coursera-direct-data-capture.ts`, `web/CourseraDirectCaptureSetup.tsx` | `tests/coursera-direct-data-*.test.mjs`; `npm run test:browser:direct-data` |
| Panopto within the course bookmark | `src/extractors/coursera/direct-data-panopto*`, `direct-data-network.js`, `direct-data-media.js`, `src/domain/coursera-capture-archive.ts` | `tests/coursera-direct-data-panopto*.test.mjs`; `npm run test:browser:direct-data` |
| Brightspace bookmark, bounded originals and local recovery | `src/extractors/brightspace/`, `src/domain/brightspace-bookmark.ts`, `web/BrightspaceBookmarkSetup.tsx`, `web/SourceLmsCapture.tsx` | `tests/brightspace-bookmark.test.mjs`; bounded reader/checkpoint tests; `npm run test:browser:brightspace-bookmark` |
| Brightspace import integrity and explicit source gaps | `src/domain/brightspace-capture-evidence.ts`, `capture-review.ts`, `content-evidence.ts`, `brightspace-local-extraction.ts` | Brightspace evidence-integrity tests; `npm run test:browser:ux` |
| Source topic matching and source assessment definitions | `src/engine/source/brightspace-matching.js`, `brightspace-assessment.js` | `npm run test:engine` |
| Syllabus placeholders and observed live-source wording | `src/engine/readiness/template-placeholders.js`, `src/engine/source/live-text-review.js` | `tests/syllabus-readiness.test.mjs`; `npm run test:browser:owner` |
| Assessment questions, answers, behaviour, rubrics | `src/engine/assessment/` | `npm run test:engine` |
| Assets, links, text matching and repackaging | `src/engine/matching/` | `npm run test:engine` |
| Ingestion claims and current-state resolution | `src/engine/provenance/` | `npm run test:engine` |
| Automatic ingestion attempt allocation and immutable owner declarations | `src/domain/ingestion-attempts.ts`, `workspace-validation.ts`, `workspace-store.ts`, `server/api.ts`, `web/FullWorkspace.tsx` | `tests/ingestion-attempts.test.mjs`; `tests/item-lifecycle.test.mjs`; `npm run test:browser:ux` |
| Comparison orchestration and lifecycle | `src/engine/comparison/`, `lifecycle/`, `src/domain/workflows.ts` | `npm run test:engine` |
| Owner report text | `src/reporting/` | `npm run test:engine` |
| Saved item work in report exports | `src/domain/owner-report-export.ts`, `web/FullWorkspace.tsx` | `tests/owner-report-export.test.mjs`; `npm run test:browser:owner` |
| Source ZIP, XML, QTI and PDF scanning | `src/source/`, `src/domain/package-scan.ts` | `npm run test:browser:package` |
| Workbook/Macmillan checks | `src/engine/workbook/`, `src/adapters/workbook.ts` | `npm run test:engine` |
| Shared records, authentication and API | `server/`, `functions/`, `src/domain/workspace-*` | Shared-store/HTTP tests; `npm test` |
| Lossless large-capture sharing | `src/domain/capture-file-transfer.ts`, `web/CaptureFileTransferPanel.tsx`, `web/capture-transfer.worker.ts` | Transfer contract tests; `npm run test:browser:workspace` |
| Completed comparisons with unconfirmed shared saves | `src/domain/comparison-save-recovery.ts`, `web/FullWorkspace.tsx` | Comparison recovery tests; `npm run test:browser:workspace` |
| Migrated planner/catalog/runtime/duplicate operations | `src/domain/operations.ts`, `web/OperationsWorkspace.tsx` | `tests/operations-migration.test.mjs`; `npm run test:browser:ux` |
| Background Coursera browser jobs and strict completion gate | `workers/coursera-extractor/`, `src/domain/coursera-background-extraction.ts`, `web/CourseraExtractionWorkspace.tsx` | `tests/coursera-background-extraction.test.mjs`; `npm run worker:check` |

For example, a source navigation fix can change `source-navigation.ts` and its
focused test. It does not change any extractor, engine bundle, or Apps Script file.
Use `rg -n 'functionName' src/engine src/extractors` to locate specific rules.

## Unified assignment workflow

See [unified assignment workspace](unified-assignment-workspace.md). Its maintained
modules are `item-lifecycle.ts`, `evidence-intake.ts`, `source-documents.ts`,
`capture-structure.ts`, `assignment-deliverables.ts` and `advisory-learning.ts`;
`web/AssignmentWorkspace.tsx` integrates them through the existing workspace.
Protected operation subtypes are validated by both local storage and shared API.
`test:browser:assignment` verifies the built owner journey. Source scope, item
identity, stage, freshness and owner decisions remain separate.

## Engine and service boundaries

The native Coursera bookmark's public publisher-image fallback is documented in
[the v1.8.4 audit](audits/coursera-public-publisher-images-2026-10-19.md).
Explicit publisher challenges and deferred same-origin image reads are described
in [the v1.8.5 audit](audits/coursera-publisher-challenge-2026-10-19.md).
Exact-ID publisher back-matter resources and their two prior 404 receipts are
covered by [the v1.8.6 audit](audits/coursera-publisher-back-matter-2026-10-19.md).
Separate draft snapshots on published items and typed retained authoring fields
are covered by [the v1.8.7 audit](audits/coursera-published-draft-snapshots-2026-10-19.md).
Bounded source-ordered publisher-image prefetch is covered by
[the v1.8.8 audit](audits/coursera-bounded-image-pipeline-2026-10-19.md).
The complete proposed-only agent packet, purpose-specific readiness, manual
title capture plan and explicit all-item native recheck are described in
[the v1.8.9 audit](audits/owner-evidence-handoff-native-recheck-2026-10-19.md).
Strict empty drafts, literal exact-text answers, unkeyed reflections,
instruction-only items, running snapshots and guided publisher recovery are
described in [the v1.9.0 audit](audits/native-models-and-first-party-publisher-recovery-2026-10-19.md).
`server/publisher-image-provider.ts` owns the single bounded public GET; both
helper ends, the original-media reader and archive intake retain independent
protocol, byte and native-source checks. This route never receives publisher
cookies and cannot establish native or whole-widget completeness by itself.

`src/engine/index.js` composes the existing public API from independently imported
feature modules. Most functions operate directly on supplied evidence. The ten
functions needing byte/XML services use explicit factories; `bind-services.js`
caches bindings separately for each supplied service object. No engine instance
can replace another instance's XML parser.

The old late overrides have become ordinary base functions and explicit wrapper
functions in their owning modules. Their call order no longer depends on the
position of a source file. `npm run check:modules` checks missing imports,
undeclared names, duplicate bindings and illegal import assignments. It does not
pretend all retained JavaScript has complete static data types. Strict TypeScript
checks continue at the app and API boundaries.

## Extractors

Source LMS and destination LMS extraction are independent, equally important
evidence tracks. Each owns its inventories, raw observations, type-specific
coverage contracts and uncertainty. A failed acquisition is not LMS absence.
High-confidence comparison requires verified evidence on both sides, with
ambiguous mappings retained for review. Draft fidelity, publication state and
runtime access remain separate. See the
[source extractor assessment and plan](audits/source-extractor-assessment-2026-10-20.md)
and [manual draft contract](audits/manual-draft-contract-2026-10-20.md).

Each platform has `entry.js` for its per-run state, orchestration, guards and
cleanup. Coursera helpers are grouped into assessment, asset, plugin, navigation,
retry, evidence and text/DOM modules. Brightspace separates reusable helpers from
its bounded API/page traversal. Configuration literals are normal source code.

The local Chrome workflow, optional Coursera background Worker and retained
regression checks need one self-contained browser bundle. `npm run generate`
follows the explicit import graph and links the module declarations into that
artifact. The
restricted linker preserves function text used by targeted checks; it rejects
aliases, unresolved exports, side-effectful initializers and imports outside the
platform directory. The zero-cost operator flow can copy or download this current bundle from CTI
and run it in the already authenticated Coursera authoring tab.

Generated standalone browser bundles and delivery strings live under ignored
`src/generated/`. Do not paste encoded strings or generated scripts back into
source control. Run `npm run generate` after changing extractor modules,
including during `npm run dev`.

## Brightspace browser extraction

Current Brightspace delivery is v1.2.1/schema 2; see
[Brightspace bookmark capture](brightspace-bookmark-capture.md). The primary UI
saves **CTI Brightspace capture** once and runs it on the signed-in course Home or
Content page. Console copy/download remains an optional fallback. Both Source
LMS and the capture tool panel use `BrightspaceBookmarkSetup.tsx` and the same
exact standalone source. The URI-safe `javascript:void` address stays strictly
below the same 500 KiB bound as Coursera, without eval, a remote loader or an
extension. Generation rejects oversized addresses rather than truncating them.

`content-reader.js` retains original same-origin HTML/text, SRT/VTT and supported
file bytes separately from text projections. Original hashes, receipts and
native source bindings remain distinct from acquisition status and independent
coverage findings. Original bodies commit as immutable scoped IndexedDB Blobs
before a successful receipt is published. Its current bounds are 4 MiB per text
original, 64 MiB per file, 512 MiB unique retained bodies, 768 MiB observed
response-body bytes and 16 MiB
combined projections. The observed byte counter includes failed reads and is
not network-wire accounting. References to external providers and dynamic/LTI
tools remain gaps and are not launched. Question-definition pagination does not
establish full pool/bank coverage; the supplied historical capture’s 18 quiz
banks remain unverified.

`checkpoint.js` retains up to three scoped metadata attempts for recovery and download,
with a 128 MiB manifest bound and explicit quota errors. Original Blobs remain
separate, including older attempts; quota failures stay explicit and automatic
orphan cleanup is deliberately absent. Capture/resume performs
current metadata and body reads again; saved observations keep their original
dates and are not promoted to fresh cached evidence. Export writes one bounded
640 MiB `.cti.zip` containing `capture.json.gz` and `files/<sha256>`, without
BASE64 original bodies. Archive intake retains file slices and validates original
body ownership, CRC, length, SHA-256 and receipts. Earlier JSON and `.json.gz`
inputs retain the 128 MiB bound and independent legacy validation.
`brightspace-capture-evidence.ts` independently checks
retained body lengths, SHA-256, receipts and native source ownership. These checks
do not certify whole-course completeness or external runtime behavior. Historical
v1.0.8 capture facts and dated migration documents retain their original scope.

## Coursera browser extraction

The normal zero-cost path executes the current extractor in the operator's
already authenticated Chrome tab. The generated program keeps its item
checkpoints in that browser and downloads one capture archive locally. CTI
independently evaluates the returned capture with the same strict completion contract before
it can be labelled COMPLETE.

The primary workflow saves the universal **CTI course capture** bookmark once.
`direct-data-entry.js` reads the complete material tree and exact item/atom
relations from the open Content page, without opening editors or navigating.
It requests known authoring resources with `X-Coursera-Naptime-Fields: ALL`
and `includes=_links`; the header overrides query projections, so every retained
model passes the shared credential sanitizer. The projection behavior is from
Coursera's [Naptime source](https://github.com/coursera/naptime/blob/33c50c5df657f41661b95eb9e1743af9f3f5473f/naptime/src/main/scala/org/coursera/naptime/models.scala)
and was confirmed by an authenticated course-data sample.

Direct capture retains authoring drafts and published snapshots separately.
Draft parts supply ordered group identities; exact versioned definitions supply
supported MCQ/checkbox keys. Fresh atom and group reads and a final material
read check source stability. Bound source IDs permit retaining original referenced
image and attachment bodies in the same capture, including native file anchors
and supported discussion prompts. Exact `assets.v1` metadata is
checked again after downloading supported original bytes; the importer checks
their IDs, receipts, MIME, signature, length and SHA-256 independently. Media
uses two download slots, a 16 MiB per-file bound and a 512 MiB cumulative
download bound. Failed or repeated body reads remain charged to the saved
run's wire budget. The archive separately permits up to 512 MiB of unique
original files; duplicate SHA-256 bodies occupy one entry.
Completed captures with gaps can continue media acquisition while preserving
assessment observations and their original timestamps; this scoped continuation
does not reread question definitions or present them as newly observed.
Version 1.4 verifies projected question prompts, options, keys and feedback
against their retained native definitions, and checks observed assignment-level
metadata. Plain-text projections retain escaped code and paragraph boundaries.
Reading and discussion text is independently recomputed from raw CML; text
coverage is reported separately from missing original files. Existing saved
observations are rechecked under these rules without changing their receipts
or claiming a new source observation. Imported item counters are labelled as
capture-reported; the whole-course completion gate remains independent.
Version 1.5 also reads each widget's exact draft provider through the observed
`authoringWidgetSessionProviders.v1` `getWithCourseId` finder. The capture retains
sanitized provider models and receipts, checks provider stability independently
of atom stability, and records actual draft configuration targets. Linked widget
summary examples are not course content. Repeated titles keep their distinct
item and provider identities. Resuming finished progress refreshes widget
settings while retaining saved assessment timestamps. Configured external links
do not establish archived video, captions, playback or complete widget content.
Missing sources, unsupported notation or interactive CML, unknown models,
variants and external widget bodies remain explicit gaps. Four shared request slots, request/time/byte bounds,
and incremental IndexedDB transactions replace repeated editor traversal.
The dedicated `cti-coursera-direct-data-v1` database isolates runs and courses
from legacy checkpoints. Resuming revalidates current sources before reusing
matching versioned definitions. Unchanged saved groups need one current read,
while changed groups receive two current reads. Version 1.3 exports one
`.cti.zip` containing a losslessly compressed `capture.json.gz` manifest and
original binary bodies under `files/<sha256>`. The manifest retains source
models, file references and receipts without embedding binary bodies as base64.
It is serialized one item at a time, with a 128 MiB expanded manifest bound and
a 128 MiB compressed manifest bound. The final archive has a 640 MiB artifact
bound. ZIP assembly streams checksums and retains original Blobs without
joining all files into another course-sized byte array.

The importer accepts `.cti.zip`, JSON and `.json.gz` directly. It validates ZIP
paths, entry ownership, lengths, checksums and body SHA-256 values before
attaching the original bytes to the manifest's exact references. It expands
the manifest within the existing 128 MiB bound and records archive/gzip transport
identity separately from the original JSON hash. Existing comparisons and
original-content supplements keep their manifest hash as report identity.
Interrupted v1.0.0 export-limit runs
can resume without clearing their cumulative budgets or definition caches.
Progress and imported summaries separate current-attempt time and requests from
cumulative budgets, and distinguish assessment, reading and structural coverage.
The importer independently validates its source receipts
and ordered inventory. Native fixture checks verify delivery separately from
browser policy restrictions; fixtures do not certify every live private course.

Version 1.6 dispatches configured hosted Panopto targets inside the same bookmark
run. It uses the observed eight-field, read-only `DeliveryInfo.aspx` POST through
the existing four-slot API scheduler, with normal CORS and credentials omitted.
It binds reference-copy delivery, session and file identities independently,
retains sanitized native metadata, and reads only supported native MP4 podcast
renditions. Initial and final provider, delivery and atom reads remain separate
stability checks. Two media slots and the cumulative 512 MiB wire budget are
shared with reading originals. A Panopto rendition has a scoped 128 MiB bound;
ordinary originals retain their 16 MiB bound. Both use the same resumable body
store and single archive. Matching video sources share one body download within
an attempt; later attempts fetch the bytes again, preserving saved assessment
observations and any historical media when a current read fails. Import checks
native ownership before attaching video bytes, then independently checks source
hashes, MP4 signature, byte length and SHA-256. CORS, CSP, authorization and
unsupported provider models become item gaps, with no proxy, extension or
per-item script required. Native OCR navigation remains distinct from captions;
an empty caption inventory applies only to that delivery. An archived podcast
rendition does not establish uploaded-original identity, HLS completeness,
playback, course launch or complete widget content.

Version 1.6.1 opens the bookmark card without starting network or checkpoint
work until the operator chooses Capture/resume course or Check Panopto access.
The separate diagnostic reads the current outline and bound plugin sources,
then tests at most twelve configured Panopto targets, deduplicating repeated
placements. It does not reread assessment definitions, readings or video bytes,
open editors, or mutate saved course checkpoints. The card shows and copies a
plain result and can download a separate `CTI_PROVIDER_ACCESS_DIAGNOSTIC` JSON
report. HTTP observations, timeouts and enforced CSP events remain distinct;
an origin-only CSP event is explicitly qualified, and an unclassified fetch
failure does not distinguish CORS from network failure. No absence of a policy
event establishes that CSP permits access. Reports retain scoped native source
models, hashes and receipts without provider bodies, raw error strings, policy
text or credential values. Source binding and derived classifications are
recomputed independently. The capture launcher and checkpoint recovery both
accept saved v1.5 and v1.6 builds without resetting budgets or assessment dates.

Version 1.7 opens one cooperating CTI helper tab synchronously from the same
Capture/resume or access-check action. The Coursera tab retains its existing
native source reads, local checkpoints, budgets and single archive. The helper
performs normal CTI authentication and calls the same-origin, owner/editor
provider endpoints; it never receives or forwards the operator's Panopto cookies.
The endpoints accept only hosted Panopto metadata identities and declared MP4
stream identities. A fresh metadata read must reproduce the expected stable
source hash before a media request. Media destinations are restricted to the
same captured tenant or the observed `d2y36twrtb17ty.cloudfront.net` CDN.
Other providers, CDNs and unavailable public sources remain explicit gaps.

The helper uses exact origins, opener identity, course identity, a random nonce
and per-request bindings. Bounded 64 KiB messages use pull acknowledgements;
cancellation, navigation, popup rejection and lost opener connections fail
closed. The service applies a 30-second request deadline, 512 KiB metadata and
128 MiB rendition bounds; the parent independently validates source identity,
MP4 signature, byte length and SHA-256. Additional metadata validation reads are
charged to the media request/received-byte budget, while the body hash covers
only media bytes. These counters cover observed response bytes, not unobservable
TCP buffering or service bytes lost when a connection terminates. The service
independently bounds every upstream read. Receipts distinguish
`CTI_PUBLIC_BACKEND` from direct course-tab requests
and retain service status separately from actual upstream HTTP observations.
They record provenance declarations, not a cryptographic attestation or provider
login. Prior failed requests remain separately labelled history and cannot
verify the current source. Public metadata/MP4 success never proves uploaded
original identity, captions, HLS coverage, playback or whole-widget completion.

`direct-data-provider-helper.js` contains the small parent transport;
`web/provider-helper.*` supplies the cooperating page, and
`server/panopto-provider.ts` supplies the fixed public reader. No arbitrary
fetch URL, method, headers or credentials cross this API. Bookmark delivery uses
URI-safe punctuation while escaping query/fragment markers, whitespace, percent
signs and Unicode; decoding yields the exact linked program without eval,
compression or a remote script loader. Generation and UI delivery enforce the
same 500 KiB bound. Saved v1.6.1 progress remains recoverable.

The server reader uses `redirect: "manual"` and rejects 3xx responses without
following them. Cloudflare's Workers runtime does not implement the browser
`redirect: "error"` value; Node-only fetch fixtures do not detect this runtime
difference. `npm run test:worker:provider` bundles the maintained provider reader
and exercises it in workerd with only in-memory outbound services and no
listening sockets or external requests. This check is a required CI step;
native metadata and rendition bytes, source identity and redirect rejection
remain separate from live public provider availability.

An item's captured Panopto target can also receive a manually copied
`DeliveryInfo.aspx` response in its owner card. This is a separate, report-bound
metadata supplement, not a rewritten course capture or a newly observed source
timestamp. The importer checks the configured delivery ID independently of the
underlying session and file IDs used by reference copies. It preserves native
viewer/podcast stream roles, variants, duration and navigation labels. OCR table
of contents labels do not become a transcript. An explicit empty caption
inventory is reported for that delivery only; unknown caption models remain
unresolved. Copied-text and sanitized-model hashes identify retained evidence,
not original HTTP wire bytes. Video bytes, uploaded-original identity, playback,
course launch and complete widget content remain unverified. Import, persistence
and report export recompute the metadata projections and keep previous targets
separate when the current captured reference changes.
The card can copy a bounded metadata reader for the exact standalone Panopto
page. It uses the observed same-origin form POST with live/editing and auth-cookie
refresh disabled, retains sanitized native JSON, and stops on page changes,
wrong identities, redirects, unsupported responses or size/time limits. It does
not request media files or synthesize captions. The returned file uses the same
manual metadata-import path and does not gain an authenticated-source claim.
The direct bundle preserves the text of reachable native declarations using
TypeScript's lexical symbol bindings. It excludes unrelated editor helpers,
while the legacy bundle retains its original linking behavior. Delivery must
fit the stricter [500 KiB Bookmark Manager input limit](https://github.com/chromium/chromium/blob/main/chrome/browser/resources/bookmarks/constants.ts#L109),
so neither the saved URL nor the full copy fallback is silently truncated.

Version 1.7.1 adds **Start a fresh course capture** for verification after edits.
This explicit action opens a separate scoped run and rereads native content;
previous runs, their source observations and their cumulative budgets stay
unchanged within normal checkpoint retention. **Capture/resume course** retains
its existing recovery and media-enrichment behavior, including saved question
timestamps. Both controls wait for an operator click. Assignment reconciliation
uses the retained base-content date for enrichment captures, so a later export
date alone cannot verify an edit. Role Play & Dialogue receive the same complete
bookmark source and use the same original capture file.

Version 1.7.2 presents content-item coverage separately from empty structural
entries. The unchanged completion contract still covers the complete inventory;
an empty folder does not count as captured lesson content. Question totals are
retained occurrences across placements, not unique bank definitions. The capture
review labels collector completion declarations separately from independently
verified native structure and original-body checks.

Version 1.7.3 requires an exact, positive full-source Content-Length for Panopto
MP4 acquisition. The public service and helper relay it separately from their
own HTTP framing; the helper and bookmark each compare the final byte count
before retaining a body. Missing lengths, ranges, encoded responses and short
or excessive EOF remain explicit gaps. New receipts record `declaredBodyBytes`;
historical receipts without that field remain historical evidence. This checks
transport framing, not playback or complete MP4 semantics. Replace the saved
v1.7.2 bookmark: its strict helper header allowlist cannot accept the new relay
header. Capture/resume refreshes mutable provider sources while retaining prior
assessment observations and their timestamps.

Version 1.7.4 records native CML heading/list boundaries in reading and discussion
plain-text projection version 2. Adjacent Coursera `<heading>` nodes no longer
concatenate their words. The original CML, hashes and observation times remain
separate; import independently recomputes the explicitly recorded projection
version. Historical captures without that field retain the original version-1
projection and remain immutable. A native `<img/>` without an asset ID or URL
remains an observed missing pointer. Another item, the published snapshot or a
same-title source original cannot fill that blank as if it were draft evidence.
The release registry keeps `directDataCourseraExtractor` separate from the
retained renderer's `courseraExtractor` v6.x family. Report readiness selects the
bookmark release only for the exact native `BOUND_AUTHORING_DRAFT_API` version-1
marker; captured build metadata and unmarked historical reports are preserved.

Version 1.7.5 accepts both observed `supplement/1` and `assess/1` CML inside an
identity-bound supplement draft. It preserves the authored CML and discovers
its original asset references; unknown content formats still fail closed.
Embedded `<widget>` references remain explicit gaps until their own content is
captured. An old unsupported reading cannot gain final stability receipts or
media merely by being imported with a newer parser: capture it again with the
updated bookmark.

New captures also record a versioned material-stability comparison. Exact initial
and final source models and hashes remain separate. Only validated, known
assignment-feature flag sets at the native material-item path may be reordered
for that comparison; lesson, item, question and all other array order remains
significant. The importer independently repeats the comparison. Historical
unstable captures retain their original status.

Version 1.7.6 adds signature-checked, identity-framed original DWG files from
bound native assets. It preserves the server MIME declaration, original bytes
and hashes without generating a rendering or interpreting CAD content. Import
and resume require the same proof. An authored external attachment URL remains
unverified but receives a separate unfetched-source reason instead of being
described as a missing native media pointer.

The older managed Protocol monitor and diagnostic tools remain available inside
closed disclosures. They are separate workflows and do not resume a direct
capture file.

Version 1.8.0 reads exact versioned inline CML widget configuration selectors
through the observed provider finder. Supported configured public-book pages
can retain separate original static HTML through the existing provider window;
native text, media and whole-widget completeness remain separate. Saved views
revalidate native ownership and original byte/hash proof. Only the bookmark
delivery copy receives parser-backed whitespace formatting; console source
remains source-preserving and the 500 KiB bookmark limit is unchanged. See
[inline-widget evidence and limits](audits/coursera-inline-widget-reader-2026-10-18.md).

Version 1.8.1 adds a distinct browser CORS reader for supported publisher chapter
JSON and a bounded access check in the same bookmark. Original API JSON and its
raw/rendered authored fields stay separate from page HTML, native Coursera text
and completeness. The capture summary reports inline settings and external-page
outcomes independently. The TRDE120 v1.8.0 audit and actual Cloudflare challenge
diagnostic explain this transport change; real access in the user's browser
still requires an exposed response. See
[browser publisher evidence and limits](audits/coursera-browser-publisher-reader-2026-10-18.md).

Version 1.8.3 adds typed publisher book-section responses, separately owned
original image files and transport-specific progress. Exact native shortlink
identity, original publisher JSON, CORS and archive ownership remain required;
parts and image retention do not raise native completion. Known assignment-flag
ordering alone can preserve a proof-checked completed checkpoint, including
the released v1.8.2 build. See
[the publisher resource audit](audits/coursera-publisher-resources-images-2026-10-18.md).

Version 1.8.2 repairs the real completed-checkpoint selection filter for the
exact v1.8.0/v1.8.1 publisher builds. Entry adoption and storage selection share
the same historical build list. Real-store and real-IndexedDB diagnostic checks
cover this boundary; the earlier mocked entry store did not. Saved originals,
observations, ownership and budget gates keep their existing meaning. See
[publisher checkpoint recovery](audits/coursera-publisher-checkpoint-recovery-2026-10-18.md).

The automatic background path uses a service-bound Worker because Browser Run
and durable Workflows are Worker capabilities. Launch it only when sufficient
remote-browser quota has been provisioned. The same private Worker now hosts
the required shared-record Durable Object route; that route runs independently
of Browser Run and does not consume a browser session. Local browser storage
and bookmark capture do not require a shared-record runtime.

The legacy local workflow uses Chrome's built-in Protocol monitor to register
`Page.addScriptToEvaluateOnNewDocument`. The canonical entry owns durable run
metadata, IndexedDB checkpoints and automatic reloads. Intermediate documents
skip JSON serialization/download; the final capture uses item-by-item Blob
serialization. A closed debugger or real renderer crash requires re-registering
a local command. See [local setup and limits](local-coursera-extraction.md).
`npm run test:browser:local-capture` checks this boundary in Chromium.

The authenticated remote service remains an optional disclosure, even when
configured. Service availability and editor permission are checked independently
of local/shared record storage. No paid browser is a prerequisite for local
capture.

The Pages API authenticates the CTI user first and forwards only the verified
email/role to the Worker. Coursera login occurs in a temporary remote Live View;
encrypted Playwright storage state is scoped to that CTI identity. The Worker
stores large raw captures in R2 and the domain-level strict verifier independently
decides whether a job may be labelled COMPLETE.

Do not weaken the strict verifier to make a job green. Improve the maintained
Coursera extractor until its evidence satisfies the completion contract. Run
npm run worker:check in addition to the normal app tests when editing this
boundary. Deployment and security details are in
docs/background-coursera-extraction.md.

## Regression and publishing

The capture sharing page (`?tool=share`) accepts an existing JSON, JSON.gz or
CTI ZIP up to 640 MiB. A dedicated worker computes original-byte checksums,
compresses plain JSON only when smaller, and prepares lossless JSON attachment
envelopes no larger than 24 MiB each. The manifest preserves original identity,
transport identity, ordered offsets and both payload and attachment checksums.
The operator downloads the manifest and every part through persistent links;
the tool never uploads files, recaptures a course, or substitutes reduced review
diagnostics for the complete capture. Transfer files are not audit inputs.

Shared record commits and referenced-record checks reconstruct at most 32 MiB
from bounded D1 hex batches instead of retaining complete BLOB number arrays.
Checks still validate all chunk sizes, order, byte count, SHA-256 and JSON before
using original records. Automatic ingestion checks read history sequentially,
retaining a temporary projection only after validating each original. Stored
evidence and version dependency guards remain unchanged.
These bounded reads still count toward D1's per-request query limit. The Free
plan is not unlimited history capacity: very large records across a long audit
history can exceed that limit and leave a save unconfirmed. Recovery downloads
remain available; no history is deleted or accepted without validation to fit.

A completed comparison keeps its audit ID and computed evidence while a shared
save is unconfirmed. Local downloads identify that state and exclude saved
follow-ups. Explicit recovery checks the same record ID first, adopts only an
exact matching save receipt, and retries that same ID only after a definite
not-found and unchanged course history. An uncertain read never permits a
blind write. This recovery copy lasts for the current browser session, so it
must be downloaded before closing or refreshing the page.

Shared transfers now bind an upload session to the exact actor, record envelope,
version, full payload checksum/length, chunk count and commit options. Repeated
preparations deduplicate atomically; received chunk digests are checked against
the selected payload before skipping them. Recovery reuses that same upload and
does not retransmit earlier verified chunks. An uncertain commit first requires
an exact saved-record readback, or a definite not-found before an explicit retry.
Binary saved-record chunk reads use the same bounded retry policy. Pending local
exports retain allowlisted HTTP status, phase and Cloudflare diagnostic headers
outside the immutable comparison payload. This does not remove runtime quotas.

Production shared-record routes use a private service binding to
`WorkspaceRuntime`, a SQLite-backed Durable Object in the existing extractor
Worker. Pages still verifies Access, owner identity, current role and the
same-origin write boundary before forwarding. The non-public Worker front door
forwards without parsing report bytes. The object serializes bounded requests
and runs the same original-payload validator and atomic D1 writes; it never
launches Browser Run. This moves expensive validation from the ordinary Free
10 ms HTTP CPU allowance to the documented Durable Object 30-second allowance.
The existing production `CTI_DB` binding is copied from Pages configuration
during deployment; no database, paid plan or replacement evidence store is
created. Local/test handlers still exercise the same maintained implementation.
Memory, D1 query/storage limits and Free Durable Object quotas still apply.

Panopto metadata and podcast endpoints also delegate to that private runtime,
using a separate object instance so media transfers do not hold the workspace
save queue. Public-provider requests retain the verified Pages service origin
in their receipt headers. No Panopto cookies or browser session is forwarded.
Stream read/count/framing work remains inside the Durable Object until EOF,
error or cancellation, with bounded active streams; Pages and the Worker front
door forward the response without running a JavaScript loop over media bytes.

Use the focused commands above while implementing. Before publishing changes
across feature boundaries, run `npm test` and `npm run build`. CI additionally
runs the built app in Chromium for package scanning, workspace workflows,
responsive UX and owner actions; production publishing waits for both the
deterministic and browser jobs. The full suite runs
historical assertions against the current engine and independently compares a
complete source/XLSX/JSON workflow with the frozen reference. DOM simulations
exercise the current extractor functions by syntax/name, independent of file order.

The historical harness also retains archive-only functions and old UI contract
tests. Its passing count is not a claim that those workflows exist in Cloudflare.
Read [the full Code.gs audit](audits/code-gs-audit.md) before claiming parity.
`npm run audit:parity` accounts for every original function/constant/override and
declared capability, compares active rule bodies independently of that harness,
and checks both extractor programs including their execution code. The ledger
requires every historical capability to remain explicitly implemented, replaced,
archive-only, unverified, or intentionally retired; silent gap/partial
dispositions fail the parity test. Intentional future rule changes require an
explicit reviewed disposition; do not edit the frozen archive to pass parity.

`main` is the source of truth. Its passing GitHub checks forward the exact commit
to `codex/typescript-pages-migration`, the existing Cloudflare production branch.
The forward is non-forced and fails on divergence rather than overwriting work.
Cloudflare then performs its own build/deployment. Check both GitHub and Pages
results before claiming an update is live. The old branch name is a deployment
setting only; future work starts from `main`.

`npm run export:gas` is optional recovery of the frozen Apps Script snapshot to
ignored `dist-gas/`. It does not export current Cloudflare features back to Google.
See `archive/apps-script/README.md` for the reference boundary.


## Migrated operations

Portable replacements for the legacy Apps Script operational layer live in
`src/domain/operations.ts` and `web/OperationsWorkspace.tsx`. They own
semantic package identity, metadata validation, preflight, manifest export,
catalog/planner/runtime inputs, typed work-state, duplicate reconciliation,
bulk rescan, lineage repair, system health and partner aggregates.

`src/domain/product-capabilities.ts` is the truthful current product capability
manifest. Do not use the historical `CTI_FEATURE_MANIFEST_` as evidence that a
host feature is currently available.

The normal zero-cost Coursera path is local Chrome. Browser Run code remains
optional infrastructure and must never become a prerequisite for local capture
or comparison.
