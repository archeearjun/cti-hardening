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
| Brightspace capture | `src/extractors/brightspace/` | `npm run test:extractors` |
| Source topic matching and source assessment definitions | `src/engine/source/brightspace-matching.js`, `brightspace-assessment.js` | `npm run test:engine` |
| Syllabus placeholders and observed live-source wording | `src/engine/readiness/template-placeholders.js`, `src/engine/source/live-text-review.js` | `tests/syllabus-readiness.test.mjs`; `npm run test:browser:owner` |
| Assessment questions, answers, behaviour, rubrics | `src/engine/assessment/` | `npm run test:engine` |
| Assets, links, text matching and repackaging | `src/engine/matching/` | `npm run test:engine` |
| Ingestion claims and current-state resolution | `src/engine/provenance/` | `npm run test:engine` |
| Comparison orchestration and lifecycle | `src/engine/comparison/`, `lifecycle/`, `src/domain/workflows.ts` | `npm run test:engine` |
| Owner report text | `src/reporting/` | `npm run test:engine` |
| Saved item work in report exports | `src/domain/owner-report-export.ts`, `web/FullWorkspace.tsx` | `tests/owner-report-export.test.mjs`; `npm run test:browser:owner` |
| Source ZIP, XML, QTI and PDF scanning | `src/source/`, `src/domain/package-scan.ts` | `npm run test:browser:package` |
| Workbook/Macmillan checks | `src/engine/workbook/`, `src/adapters/workbook.ts` | `npm run test:engine` |
| Shared records, authentication and API | `server/`, `functions/`, `src/domain/workspace-*` | Shared-store/HTTP tests; `npm test` |
| Migrated planner/catalog/runtime/duplicate operations | `src/domain/operations.ts`, `web/OperationsWorkspace.tsx` | `tests/operations-migration.test.mjs`; `npm run test:browser:ux` |
| Background Coursera browser jobs and strict completion gate | `workers/coursera-extractor/`, `src/domain/coursera-background-extraction.ts`, `web/CourseraExtractionWorkspace.tsx` | `tests/coursera-background-extraction.test.mjs`; `npm run worker:check` |

For example, a source navigation fix can change `source-navigation.ts` and its
focused test. It does not change any extractor, engine bundle, or Apps Script file.
Use `rg -n 'functionName' src/engine src/extractors` to locate specific rules.

## Engine and service boundaries

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

The older managed Protocol monitor and diagnostic tools remain available inside
closed disclosures. They are separate workflows and do not resume a direct
capture file.

The automatic background path remains a separate service-bound Worker because
Browser Run and durable Workflows are Worker capabilities. It is intended only
for deployments that provision sufficient remote-browser quota; it is not a
requirement for the Pages application or shared workspace.

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
