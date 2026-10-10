# Coursera extractor runtime stability

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
