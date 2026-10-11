# Coursera extractor runtime stability

## v6.15.21: safe question batches and saved-progress recovery

A new live report described an Aw, Snap! crash around 18 of 165 items after a
long wait. Its screenshot shows error code 5 and retained Protocol monitor
traffic; it does not establish the crash cause. Existing renderer checks ran
between course items, so a single long assessment could occupy one renderer
for up to its full 15-minute observation budget.

Automatic local capture now yields at committed question checkpoints, after
roughly 25 new observations, two minutes, or measured heap pressure. It preserves
the unfinished-visit marker, raw observations and original editor-attempt count,
harvests accepted item-scoped network evidence, and reloads through the existing
controller. Question counts now participate in stall detection. Rediscovering
a saved prefix causes no repeated progress writes. Same-visit partial questions
must match the live outline identity, ordinal and prompt; missing keys remain
missing and a later recovery attempt can inspect them afresh. Manual and remote
capture retain their existing scheduling. Strict completeness is unchanged.

A separate saved-progress command exports the current stored observations
against the live inventory without opening editors. It reads the existing
session even after its normal resume TTL, and cannot write, import or clear the
checkpoint store. The export explicitly records that observations were not
refreshed. Empty checkpoint stores produce a visible explanation instead of a
new acquisition run. This also makes captured work available before a full
course extraction succeeds.

Verification includes partial answer evidence, more than twenty question-only
continuations, time/heap/checkpoint failure boundaries, built command delivery,
and a 165-item synthetic native Chrome course with a 609-question virtualized
assessment. The native check kills its renderer using `Page.crash`, recovers
saved observations through read-only export, and resumes to one final JSON.
External course observations are synthetic; this is not certification of the
reported private course or proof that error code 5 was caused by memory.

## v6.15.20: fresh full-course reruns

The normal automatic command restores browser checkpoints, which is useful for
recovery but cannot prove that a rerun collected fresh course observations.
CTI now offers **Copy fresh full-course command** beside that command. It ignores
selected saved JSON and gives the accepted run a separate checkpoint namespace.
The durable controller owns the namespace, so automatic reloads restore only
this run's progress rather than restarting acquisition. Its mode and checkpoint
identifier are recorded in the final JSON. Existing raw checkpoint records,
other local settings and authentication cookies are preserved.

The operator closes DevTools, refreshes Coursera and reopens Protocol monitor
before registering a fresh command. This ends previous debugger registrations.
An active capture in another tab blocks the new run before checkpoint changes.
A failed fresh namespace write stops with explicit partial evidence rather than
falling back to earlier records. Standard resume commands still recover the
currently selected course checkpoint session after an actual interruption.

The native Chromium check retains an interrupted 20-item checkpoint set, runs
all 188 items in ten automatic documents twice, and verifies one lossless final
JSON per fresh run, no repeat visits within either run, unchanged old records,
preserved cookies and blocked concurrent fresh capture. The built UI check
verifies that selecting an old JSON does not seed the fresh command, and that
clipboard denial exposes the complete command. These fixtures do not replace
an authenticated rerun of the user's course or change the strict evidence gate.

## v6.15.19: finish pending recovery visits before the final download

A first live automatic capture ran 41 batches and exported 188 accounted items,
155 complete and 33 explicitly unresolved. Five items still had a permitted
recovery attempt. A recovery time budget ended after three visits, while the
primary inventory had no unvisited items. Final checkpoint retention previously
looked only at primary unvisited items and crawl exhaustion, so the controller
declared acquisition finished and removed the resumable item store too early.

One pure continuation decision now covers both unvisited work and pending retry
contracts. The entry uses it to retain checkpoints, and the automatic controller
uses it before finalization. Completed items remain skipped. Terminal gaps such
as cross-origin content and exhausted attempts remain incomplete and do not
cause endless reloads. Existing checkpoint-failure, three-stall, two-attempt,
500-batch and eight-hour limits are preserved.

The native Chromium regression simulates a recovery budget ending after all
primary visits, verifies that two retries trigger another document without an
intermediate download, and checks that one final complete JSON follows their
successful observations. Pure tests also reproduce the aggregate 188/155/33/5
case and terminal incomplete completion. Private course content is not embedded
in fixtures. This patch does not reconstruct missing questions or answer keys
in already exported files.

## v6.15.18: efficient assessment traversal and durable question progress

A reported 100-question capture showed question-level progress while its course
visit counter remained at zero. The progress card now identifies the active item
and finished visits separately, and reports saved question observations.

Refreshing a live question previously repeated visibility/layout checks for the
entire outline. Refresh now limits those checks to the requested identity. DOM
hydration caches its parsed question while rendered text, markup, field values
and ancestor visibility remain unchanged; it still observes loading and answer
evidence within the original budget. A completely observed, identified mounted
assessment returns directly instead of traversing it again. Missing questions,
keys and uncertain types remain explicit gaps.

The collector persists incremental identified question observations to the
existing IndexedDB checkpoint store. Interrupted visits stay incomplete and do
not spend a completed attempt. Resume validates each saved question against the
live outline. Earlier saved questions survive another interruption before their
entire prefix is rediscovered. The raw preexisting model is preserved separately.
Automatic planned reloads and the single final course JSON are unchanged.

Deterministic regressions cover delayed 100-question hydration, bounded rail
layout/parsing counts, matching and changed question identities, partial-save
failure and complete mounted assessments. A real Chromium check commits 31
questions, interrupts the document, and finishes all 100 after restoring them
without repeated clicks. This is synthetic editor verification; the reported
private course must still be rerun in the user's authenticated browser.

## v6.15.17: automatic local Chrome continuation

Local Chrome is the primary workflow again, including when the optional remote
service is configured. The built-in DevTools debugger registers the current
extractor across document reloads. Short checkpointed batches continue without
manual pastes or intermediate downloads; one final raw JSON preserves every
completion gap. No extension or separate automation runtime is required.

Intermediate local batches avoid full JSON serialization. Final export builds
a compact Blob item by item, and Console logging no longer retains the entire
result object. Unused setup API roots are released after item probes. The
shared per-editor observation bounds and strict completion rules remain intact.
Read [local capture setup and limits](local-coursera-extraction.md), including
DevTools recording settings and the distinction between automatic planned
reloads and a renderer crash that needs browser-level recovery.

## v6.15.16: automatic cloud continuation and one final download

The console workaround deliberately yields and asks the operator to reload.
That preserves evidence but does not scale to a team that cannot install an
extension. Automatic full-course capture now uses CTI's existing remote browser
controller, with organization SSO only when needed and manual local capture
retained as a no-service-cost fallback.

The remote path no longer bypasses the shared renderer visit/time/heap guard.
The controller saves encrypted IndexedDB/storage state and resumes in a fresh
browser, without downloading intermediate JSON or showing continuation panels.
Large assessments retain their full item budgets. SSO completes in a separate
Workflow step so the user's login does not consume evidence acquisition time.
The bounded continuation limit is 60 chunks; three unchanged progress summaries
stop a stalled capture. The latest raw checkpoint remains downloadable if the
job fails. Completion and evidence rules are unchanged.

Starting a job records final-download intent in the operator's browser. CTI
requests one download at terminal status, including when Extract is reopened
after the job finishes. Fetch failures retain the intent for retry; old jobs do
not auto-download and browser policy may still require the final download link.
No extension install or console copy is involved in the automatic flow.

The independent browser checks cover 45 synthetic items across three fresh
contexts with restored IndexedDB, no repeated visits, no intermediate downloads,
and no false completion. Built website checks cover terminal downloads, reopened
views, preserved gaps and artifact fetch recovery. Authenticated live Coursera
coverage and funded Browser Run capacity remain deployment acceptance checks.
See [background capture](background-coursera-extraction.md) for official
Cloudflare limits, billing boundaries and recovery details.

## v6.15.15: stable empty Readings and resume from a saved JSON

A supplied schema 35 capture retained 125 checkpoints and captured one new item
before the v6.15.14 absolute 256 MiB guard yielded. The observed heap was about
292 MiB, including the course application and restored evidence. Its inventory
had 81 complete items, 62 unvisited items and 23 empty Reading observations without
stable-empty receipts. The original file is private diagnostic input and is not
included in this repository.

The Reading recovery loop created `emptyReadingEvidence`, but the exact-evidence
merge discarded that receipt. The merge now preserves only a receipt for the
same exact item/course observation, with at least ten seconds of stable field
observation, settled network samples, no attachment labels or frames, and zero
untruncated observed/captured characters. A later exact observation replaces the
receipt. Approximate editor snapshots cannot end an empty capture after the
shorter two-second nonempty dwell. Existing files without the receipt are not
retroactively declared empty: those fields must be observed again in Coursera.

Local batches retain the shared 20-visit/five-minute bounds. Heap checks now yield
at either 64 MiB of growth from the first editor's starting baseline or 384 MiB
of total used heap. A repeat paste cannot reset the baseline or a yielded session;
the limits are checked between checkpointed items. This permits useful progress
when restored evidence already exceeds 256 MiB while bounding new renderer
growth. Missing Chrome memory readings still use the visit/time bounds. These
are acquisition guards, not a reproduction or guarantee against browser crashes.

The **Extract** panel accepts a saved JSON before URL entry and can fill its
matching recorded authoring URL. Incomplete schema 35 captures offer **Copy resume
script**. The program contains the current complete extractor plus literal saved
observations; it never sends the file to a remote browser. Clipboard denial offers
a full selectable textarea. Paste after reloading the matching Coursera authoring
tab. The extractor consumes the snapshot once, verifies origin/course identity
before capture or storage work, and seeds only observed items matching the current
inventory's IDs, names and raw types. Newer browser checkpoints take precedence;
untouched, renamed or removed items are not seeded. It recalculates completion
from restored payload evidence instead of importing accounting claims. Saved
observations keep their timestamps and do not prove that old content is unchanged.
Partial batches are labelled **BATCH SAVED — continue capture**, with detailed
evidence reasons under a disclosure. External and untyped gaps remain explicit;
similar titles with distinct item/ancestor identities are preserved.

Regression checks exercise the real ten-second Reading recovery loop, its merge,
IndexedDB reload, saved-file import with newer/renamed/unvisited items, wrong-course
program guards, and built UI copy/fallback equality. Run `npm test`, `npm run build`,
`npm run worker:check`, and the browser extractor/UX/choice checks. The item-refresh
extension is version 1.0.4 and uses the same current v6.15.15 parsers.

## v6.15.14: local batches with reload and durable continuation

The follow-up v6.15.13 log stops at primary item 126/188 at 1,691 seconds,
still with repeated skipped ViewTransition errors. The earlier fixture corrections
did not resolve this live renderer failure. Neither log supplies a Chrome crash
code or a heap profile, so they do not establish its exact cause.

Full-course local capture now yields between items after 20 editor visits, five
minutes from the first visit, or an observed JavaScript heap of at least 256 MiB.
The time and memory checks do not interrupt an in-progress slow item: its existing
attempt budget still applies. A high starting heap allows one visit so a reload
cannot create an endless sequence of empty batches; unavailable memory readings
fall back to the visit/time bounds. The same renderer budget covers primary,
retry and repeat invocations. A second paste cannot reset it. Background Worker
chunks retain their existing deadline-based behavior and are not limited by the
local renderer budget.

Each finished item is committed to IndexedDB before the next visit. A failed or
unavailable checkpoint stops further visits and reports a storage error; it is
not counted as a successful checkpoint write. The batch exports its full inventory
with explicit incomplete/unvisited states, keeps checkpoints for continuation,
and skips optional asset hashing until the final batch. The user saves the batch
JSON, clicks **Copy continuation script**, reloads Coursera, and pastes again.
The continuation contains the entire current standalone script, including its
helpers; clipboard failure provides a manual-copy field. The controls live in a
closed shadow outside the body and cannot become learner content evidence.

On reload, the same durable checkpoint run is restored. Completed and terminal
items are not revisited; untouched items go first and recoverable first attempts
enter the normal retry pass afterward. Existing compatible v6.15.13 checkpoints
remain usable within their existing 12-hour retention period. Do not clear browser
site data while recovering a capture. Each finished run closes its IndexedDB
connection, and checkpoints are cleared only after final JSON preparation.

The runtime browser regression uses the maintained crawl driver and real IndexedDB
over three fresh documents to capture 45 synthetic Reading items (20/20/5), with
no repeated completed visits. It checks partial versus final completion/export,
failed checkpoint writes, the actual pasted bundle's repeat-run guard, standalone
continuation copying, manual fallback, and canonical built Copy script delivery.
Only the external authenticated editor observation is substituted; this does not
reproduce or certify elimination of the live Coursera renderer crash. A single
very large or defective editor may still exceed the browser's resources.

Run the validation commands listed below. The packaged item-refresh extension is
now version 1.0.3; it retains its focused one-item workflow.

## v6.15.13: duplicate scroll notifications and bounded network acquisition

The supplied v6.15.12 console log stopped during primary item 16/167 at 427
seconds, before export. It repeatedly reported `AbortError: Transition was
skipped. New ViewTransition started` during editor opening, question scrolling
and outline restoration. No renderer crash code or heap profile was supplied.

An independent Chromium fixture reproduced that exact transition rejection:
setting `scrollTop` and then dispatching a synthetic bubbling scroll event caused
two notifications for one movement. The extractor now relies on the native event,
does not signal no-op scrolls, and retains the hydration wait after a movement.
Browser regression checks confirm that virtualized question rows mount and restore
without duplicate notifications or transition rejections in this fixture.

The recorder also previously retained every accepted response until the item
finished. Sixty-four synthetic responses below its individual 2.5-million-character
limit retained 153,597,952 characters, with approximately 148 MiB of JavaScript heap
after collection. An unrelated POST was copied despite failing request eligibility.
The fixed recorder checks eligibility before copying and enforces aggregate limits
at acquisition: 16 Mi characters, 48 records, eight pending requests and four active
response copies. In-flight copies reserve capacity before reading a body. Original
fetch/XHR behavior is preserved, and release frees reservations and stored data.

Resource-limited observations are recorded in `payload.networkCaptureGap` and
prevent the item from being certified complete. Retries and checkpoint resume
retain missed observations as an explicit technical gap for that run.
Checkpoint deletion now follows JSON serialization and download-fallback setup,
so an export exception leaves persistent item checkpoints available for recovery.
Preparing a download cannot prove Chrome saved the file; retain the downloaded
JSON as the evidence artifact.

Run `npm test`, `npm run build`, `npm run worker:check`,
`CTI_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser:choices`, and
`CTI_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser:extractor`.
The latter also checks that the built Copy script, download and manual-copy paths
deliver the current canonical v6.15.13 bundle. The packaged item-refresh extension
is version 1.0.2; older installed copies must be updated to use this extractor.
These synthetic checks do not claim
the authenticated Coursera renderer crash has been reproduced or eliminated.

## v6.14.2: earlier navigation and response-copy hardening

A live run showed Chrome's `Aw, Snap!` page and repeated skipped ViewTransition
errors during editor traversal. This establishes a failed run, not its browser
crash cause. No Chrome crash dump or heap profile was available. Animation
overlap alone does not establish memory exhaustion or a renderer defect.

The review identified two concrete resource/navigation issues:

- Returning to the outline dispatched popstate even when the URL was unchanged.
  Close and history fallback also ran back-to-back. The extractor now allows
  Close to navigate before fallback, avoids duplicate route dispatches, avoids
  broadcasting Escape from an idle outline, and uses bounded history for its
  own route changes. Existing exact editor identity and hydration checks remain.
- The response recorder used `clone().text()` before checking the actual body
  size. It now reads the clone incrementally under the existing character limit,
  cancels stalled copies after 12 seconds, and cancels outstanding copies when
  their item is released. The site's original request/response is untouched.
  Oversize, timeout, release and unreadable counters are retained in
  `networkRecorderMemory.responseCopyLimits`. A rejected copy is not parsed as
  partial valid JSON, and no missing evidence is filled from the source.

The schema stays at 34. The v6.14.1 option-boundary correction, QA engine and
Brightspace extractor remain unchanged. Seven runtime regression tests exercise
real Response/ReadableStream objects, Unicode preservation, original-response
isolation, body limits, stalled reads, item release and route fallback behavior.

This is a tested hardening change, not a claim that the observed Chrome crash has
been reproduced or eliminated. Live acceptance is still required. A crashed
renderer cannot execute cleanup or export unsaved in-memory results; only a
completed downloaded JSON should be used as a completed capture.
