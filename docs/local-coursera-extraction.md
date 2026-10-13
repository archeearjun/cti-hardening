# Automatic Coursera capture in local Chrome

## Quiz definitions before question-editor rendering

The reported Technical Drawing capture was too slow to serve as a scalable team
workflow. Protocol monitor improves registration and recovery; it does not
remove question-editor rendering by itself. A real response sample supplied on
12 October 2026 now confirms that Coursera returns original native MCQ prompts,
options and explicit answer keys through read-only assessment endpoints.

The request-based fast path uses the same managed Protocol monitor setup below.
It opens a quiz once, collects its complete observed group inventory, and reads
only observed group and exact versioned question identities. Supported native
MCQs can therefore be captured without activating every question editor.
From v6.15.27, complete body parts can establish that inventory even when the
sidebar mounts fewer links. Every group ID and ordinal comes from an observed
compound DOM ID and explicit `assignment-part-N` attribute. Full coverage,
unique IDs, one assignment root and agreement with current sidebar links are
required. A body without the optional content test marker must have the same
strict observed sidebar/part association. This path needs no sidebar scrolling.
When only the sidebar can establish the inventory, bounded scrolling reads its
identities and restores its position without scrolling content or activating
questions.
Small Naptime batches are tried before bounded single-ID reads; matching uses
returned source IDs, and ordering comes from explicit observed ordinals. It
preserves original CML and maps `correctOption` to its exact option ID. Credential envelope fields
are excluded from retained evidence.

The direct path also works when Coursera opens a quiz modal while
the address stays at `/content/edit`. CTI must have opened a fresh, unique editor
through the exact course item ID. It keeps that
sidebar/content pair pinned; a generic address, matching title or earlier
network history alone cannot establish the item. No additional operator step
is required for this layout. The two fixed read resources were confirmed by the
real response sample; cached editors no longer have to emit both endpoint
requests again to enable acquisition. An exact item URL with a fresh unique
editor pair can also certify that item independently of outline-control scores.

The original sample contained ten groups and ten definitions, with eight
previously observed questions gaining explicit keys that were missing from
their older DOM capture. The later live v6.15.28 quiz check verified all 100
definitions and keys in 32.772 seconds. That confirms the direct path for this
quiz. The subsequent live v6.15.29 JSON contains 185 items, with 132 complete
and 53 unresolved, including 25 unvisited and 28 retryable items. It reports
31 of 34 assessments complete and 3,144 captured questions, all keyed, against
3,741 declared. These are partial results; whole-course acceptance remains
unverified. An incomplete outline, multiple variants, an unsupported
question type, unavailable responses or conflicting identities keep explicit
gaps and use the existing observed DOM fallback. The [feasibility assessment](coursera-extraction-feasibility.md)
details the evidence and remaining boundaries. No extension, local installation
or paid browser is required.

The progress card shows **Reading quiz definitions** when direct acquisition is
active and **Reading quiz in editor** with a reason when fallback is needed.
Denied reads and server rate limits stop the run with saved evidence rather
than repeatedly reopening editors. Direct reads use their own bounded evidence
collector, avoiding duplicate generic-network response copies.

## Less repeated work on long courses

From v6.15.31, each automatic document reads a small checkpoint manifest and
restores raw evidence for incomplete items that still need work. Completed raw
records remain in IndexedDB until final export. This avoids reloading every
previously captured definition and asset on each continuation. The writable
database upgrades to version 2 and migrates older records once; the performance
change does not truncate or delete raw observations. Read-only saved-progress
export leaves the database version and checkpoint state unchanged.

Before preparing the final JSON, CTI restores deferred raw records and
independently rechecks their strict capture contracts against the current
inventory. A manifest alone cannot certify the downloaded course. Missing or
inconsistent records stop complete export. Original retained definitions and
per-item `captureDiagnostics` are included in the final evidence.
If restoration or migration fails partway through, CTI stops before editor
visits and blocks replacement writes, preserving the saved raw records.

Global outline hydration is deferred until navigation needs a fallback;
certified direct item routes avoid that preliminary scan. Intermediate automatic
chunks save their observations and continue without another global asset pass,
course-wide normalization or final JSON preparation. Those operations remain
part of the final capture.

Virtual question-list discovery scales to the observed count and scroll
geometry, within 45 seconds and 420 steps. Exact observed identities, ordinals,
full coverage and scroll restoration remain required. Group and definition reads
are interleaved with at most two requests in flight, so a long group inventory
does not consume the entire API allowance before definitions are read.
Saved definitions are reusable only after a fresh inventory and group read
confirm the exact versioned reference and the retained definition passes its
SHA-256 integrity check. Changed versions are fetched again. Unsupported types
retain their raw evidence and fall back to editor observations.
The editor fallback does not repeatedly checkpoint API questions it merely
rediscovers; new editor answers still receive durable progress checkpoints.

The automatic plan retains cumulative bounded timing, checkpoint and request
totals, yield/fallback histograms and its latest twenty batch receipts. These
measure the remaining costs across reloads. They do not establish live private
whole-course completion or guarantee a particular extraction speed.

## Single-resource reads when batching is unavailable

A live v6.15.27 quiz check found all 100 group IDs and read their group records,
but returned zero definitions and keys. Both batch resources returned HTTP 405;
the resulting individual definition reads all returned HTTP 404. Its 202 GETs
completed in about 31 seconds. A complete inventory alone is not a complete quiz.

From v6.15.28, single reads match the working original response sample. The
exact versioned definition ID keeps its literal `@` delimiter. Group reads use
their observed `id` query parameter, while definition reads omit it. The field
selection includes `validation` and excludes credentials; returned credential
fields are still removed. HTTP failures are reported once with their actual
status, rather than repeated as an additional parsing failure.

The native unsupported-batch check now requires the raw request path to match,
instead of decoding away a version-delimiter mismatch. It verifies 100 synthetic
definitions and keys in 202 GETs without question clicks. The earlier fourteen
GET fixture remains the supported-batch case; it is not the live endpoint's
observed request count. The subsequent live v6.15.28 check verified 100 definitions
and keys in 32.772 seconds, with 202 GETs and 500,818 response bytes. Other
genuine 404s remain explicit gaps.

## Check one currently open quiz

From v6.15.27, **Copy current quiz API check** tests the direct reader before
another full-course run:

1. Stop the managed run. Open one quiz normally in the same signed-in Chrome
   profile, using its exact course item URL.
2. In CTI → Extract, click **Copy current quiz API check** and paste into that
   quiz's normal Console.
3. When its card finishes, click **Copy diagnostic result**. The result reports
   the current version, definition/key counts, inventory method, elapsed time
   and bounded error codes. Clipboard failure exposes a selectable result.

The check is limited to two minutes. It reads the open quiz's definitions without
question clicks, page reloads, course traversal or checkpoint changes. Its copied
receipt excludes raw prompts, answer wording and credentials. A successful result
means that this quiz verified; it does not certify the whole course. A failed
check gives a focused diagnostic without another prolonged course rerun.

After a request-format correction, refresh CTI before copying the check and
confirm its result reports the current version. Compare `expectedCount`,
`capturedCount` and `keyCount`; successful group reads or an established
inventory method do not replace definition and key coverage. Check the one quiz
before starting another full-course capture.

## Optional response sample for an unsupported schema

From v6.15.23, CTI → Extract includes **Copy one-quiz data check**:

1. End the earlier registration by closing DevTools, then refresh Coursera's
   Content page. Saved extractor checkpoints remain in the browser.
2. Copy the data-check script from CTI and paste into normal Coursera Console.
3. Open one quiz normally and click **Download response sample** in Coursera
   after its responses arrive. Download before refreshing or closing the page.

The observer makes no requests and captures only future matching responses.
The file is a diagnostic sample for investigating the definition schema; do not
use it as a course-audit capture. This is a troubleshooting tool; another sample
is not required before using the confirmed native MCQ adapter. Parsed/binary XHR and opaque GraphQL can be
declined. If the sample is empty or reports such declines, Chrome Network's
**Copy response** can supply the specific authoring JSON instead. There is no
need to send cookies, request headers or a full-course HAR.

The primary Extract workflow uses the operator's existing, authenticated Chrome
profile. It needs no extension, local Node/Python installation, remote browser,
or Cloudflare browser quota. Chrome's built-in DevTools Protocol monitor registers
the canonical extractor with `Page.addScriptToEvaluateOnNewDocument` and
`runImmediately: true`. The registration belongs to that open debugger session;
a Console paste or a DevTools Snippet alone cannot survive document reloads.

## Managed capture, recommended from v6.15.22

Keep CTI on its Extract page as a controller for a separate Coursera tab. It uses
normal browser windows and the same signed-in Chrome profile; there is no
extension, installed local runtime, remote browser or password transfer.

1. Close an earlier extraction tab so its debugger registration cannot compete.
2. Enter the course URL in CTI and click **Open managed Coursera tab**.
   Leave **Fresh full-course managed run** unchecked to resume saved work;
   select it before opening the tab when you need fresh observations of the whole course.
3. Return to CTI and click **Copy managed capture command**. In the opened
   Coursera tab, show Protocol monitor, turn Record off, clear its log, paste in
   its bottom command input and press Enter once.
4. Keep the CTI Extract page, the managed Coursera tab and its DevTools open.
   CTI verifies the connection and displays progress. One final automatic JSON
   is prepared in Coursera after acquisition finishes or an explicit limit stops it.

Coursera sends only small progress receipts through the verified window link.
CTI checks the sending window, origin, course and run token before accepting
receipts or acknowledging registration. Authentication and raw course evidence
remain in Coursera's origin. The controller uses browser-level window navigation
after a missing heartbeat; it can therefore navigate a crashed renderer without
running JavaScript inside that renderer. Recovery requires Chrome to retain its
registered command and the new document to send `READY`. Saved item and question
checkpoints then resume normally. The native test preserves the same
tab, controller and registration through two real renderer crashes.

The visible-tab heartbeat window is 45 seconds. A hidden Coursera tab gets
three minutes to account for Chrome's background timer throttling. The
controller never navigates an unpaired tab or a login screen. After recovery
navigation it waits at most one minute for a visible tab, or three minutes for
a hidden tab, for a new `READY` acknowledgement. If the extractor does not
reconnect, it stops instead of repeatedly reopening the course outline. It also
stops after three recoveries without new saved progress, thirty total recoveries, a lost
window link or an explicit extraction error. Existing course and batch limits
still apply. After a renderer recovery, the question budget decreases to ten,
then five observations per document. **Stop managed run** closes the managed
tab while preserving browser checkpoints.

Browser opener-isolation policies can sever the link, and managed capture
refuses to start without a verified acknowledgement. No security policy or
header is bypassed. Crash recovery also relies on Chrome's normal site isolation
keeping the CTI and Coursera sites in separate renderer processes. If browser
policy disables that isolation, a shared-process crash can stop both tabs; this
feature does not alter enterprise browser policy. Closing DevTools removes its
registration; the CTI tab cannot recreate that registration. Closing the CTI
browser tab, refreshing it or navigating to another document ends its in-memory
supervisor. These interruptions require explicit saved-run recovery.

From v6.15.29, closing the extraction panel or changing a view within the loaded
CTI application does not stop the managed runtime. The browser window owns the
supervisor, child tab, command and latest course status; the UI merely subscribes
to it. Reopen the panel to recover the same tab reference, command, URL and
counts. Keep the CTI browser tab open. **Stop managed run** is the explicit action
that closes the child and disposes supervision. A full CTI reload starts a new
browser realm and cannot restore that live window manager automatically.

A durable run that already finished or stopped is reported as an explicit error
when its old registration runs again. Export saved progress before starting a
new command; a normal-looking course outline is not evidence that capture resumed.

## Visibility pauses and a run-limit continuation

The live v6.15.29 capture stopped at `LOCAL_CAPTURE_RUN_LIMIT` after 8.2078
hours of wall time, with 117 batches, zero recorded stalls and zero recoveries.
Its last document recorded an explicit hidden-tab visibility wait of 5 hours,
2 minutes and 42 seconds. Waiting for the tab to become visible still consumed
the automatic renderer-age and eight-hour budgets.

From v6.15.30, those explicitly measured visibility waits are excluded from
renderer elapsed time and accumulated across documents for the eight-hour
active-work budget. The original start time and wall-time display remain;
batch counts, checkpoint identity and the other limits are preserved. This
does not detect every operating-system sleep interval or keep a computer awake.
Chrome cannot extract while the machine is asleep. Keep Chrome running and
the Coursera tab visible when the run should advance.

To continue the terminal v6.15.29 partial capture:

1. Stop the old managed run and refresh CTI to load the current extractor.
2. In the same Chrome profile, leave **Fresh full-course managed run** unchecked.
   The ordinary managed command can reuse the retained active browser
   checkpoint session before its twelve-hour expiry; its new plan then pins
   that session across subsequent documents. This avoids embedding the large
   downloaded capture in the command.
3. Click **Open managed Coursera tab**, then **Copy managed capture command**.
   Paste the command once into that tab's Protocol monitor with Record off and
   its log cleared. Keep CTI and the managed tab's DevTools open.

This creates a new bounded run using the saved observations; completed items
are skipped and missing evidence remains subject to the normal checks.
**Resume saved managed run** is for continuing an eligible original plan with
its original limits. It still rejects a terminal `LOCAL_CAPTURE_RUN_LIMIT`
plan, so use the ordinary managed action for this result. If the earlier
browser checkpoints are unavailable or expired, select the downloaded JSON
in **Check the downloaded capture** first and repeat the same nonfresh
managed action. This validated file import is a fallback; it includes the
capture in a larger registered command. The downloaded file does not become
complete merely because the new extractor is installed.

## Resume after a lost connection or registration

From v6.15.29, first use **Show managed Coursera tab** on CTI's Extract page to
focus the tab the controller actually supervises. If the extraction panel was
closed, reopen it first; this reconnects its UI to the existing managed runtime.
Another Coursera tab can show
the outline without a card while the managed tab is still capturing. Durable
run metadata is shared between tabs, so a `RUNNING` plan alone does not establish
which page is executing. If the managed tab is connected and advancing, let it
continue.

When the managed extractor has stopped or failed to reconnect:

1. Click **Stop managed run** and allow its 45-second liveness window to expire.
2. Refresh CTI and click **Resume saved managed run** for the same course. This
   uses the existing browser checkpoints; do not choose a fresh full-course run.
3. Click **Copy managed capture command**. Paste it once into the replacement
   Coursera tab's Protocol monitor with Record off and the log cleared, then
   press Enter. Keep CTI and the tab's DevTools open.

Standalone capture can use **Copy saved-run recovery command** in the matching
Coursera tab's Protocol monitor. This is an explicit continuation of the active
saved plan, without importing a JSON or creating a fresh capture.

Recovery uses a new command token while preserving the original checkpoint
namespace, start time, batches, evidence progress and safety limits. Completed
items remain skipped; the old command is superseded. The active checkpoint
pointer must match the saved plan, including its original fresh owner when
applicable. An ordinary checkpoint namespace stays pinned across its normal TTL.
Recovery cannot reset the eight-hour active-work, 500-batch, three-stall or thirty-recovery
limits, revive unrelated terminal states, or override a live competing capture.
If a previously started run restores no matching item evidence, it stops before
editor visits instead of starting fresh. Use the read-only saved-progress export
to inspect retained observations if recovery is rejected.

A Coursera page cannot reinstall a lost debugger command itself. The one-time
operator re-registration above restores execution; it does not establish why
Chrome stopped the earlier registration. The reported Module 6 interruption
and private full-course completion still require live verification.

## Loaded quiz data before question rendering

A certified editor now checks its bounded, already-loaded React model before
traversing questions. Eligible definitions are matched to observed live outline
identities, positions and prompt text. Unique prompt matches can be used only
when the model does not supply a conflicting source ID. Array positions alone
do not establish Coursera positions. Ambiguous matches or missing keys fall
back to normal observed DOM capture. Complete models can avoid opening each
question, substantially reducing editor rendering work.

Original question-definition fields are retained separately, including markup,
math and unknown fields. The copier reads data properties without invoking
getters and declines cyclic, non-JSON or oversized models. It never truncates
raw data and calls the result complete. Strict capture completeness is unchanged.

The following standalone workflow remains available when window supervision
is unavailable. Its crash recovery requires an operator.

## Once per Chrome profile

In a Coursera authoring tab, open DevTools Settings → Experiments and enable
**Protocol Monitor**. Reopen DevTools. Use its command menu (Ctrl+Shift+P,
Command+Shift+P on macOS) and choose **Show Protocol monitor**. Turn off Preserve
log in Console and Network. In Protocol monitor, turn **Record** off and clear
its log before a long capture. Its traffic log is unnecessary for extraction
and otherwise retains every recorded protocol message.

## Each course

Enter the exact authoring-shell URL in CTI → Extract. Click **Copy automatic
local capture command**, select the Coursera page in Protocol monitor's target
dropdown, then paste into its bottom command input and press Enter. This JSON
command goes in Protocol monitor, not Console.
An `identifier` response confirms that Chrome registered the program; it does
not certify that the matching course capture started. The CTI progress card in
Coursera confirms startup. If it does not appear, refresh Coursera once with
DevTools still open and verify that the authoring URL entered in CTI matches
the open course. Recording can be enabled briefly to inspect a command response,
then turned off and cleared before a long capture.
The app also offers a selectable, complete copy fallback; ChatGPT downloads and
its file viewer are not part of this workflow.

Keep Coursera and DevTools open. Every item is checkpointed to IndexedDB. At the
shared renderer boundary (20 visits, five minutes between items, 64 MiB heap
growth, or 384 MiB total reported heap), CTI automatically returns to the shell
in a new document and restores matching checkpoints. Automatic long assessments
also yield at a committed question checkpoint after roughly 25 new observations,
two minutes of renderer work while collecting questions, or the same heap limits. An unfinished visit does not
spend an editor attempt. Checkpoint
failure stops continuation and prepares a partial final capture.

The progress card distinguishes the active item from finished visits. A
100-question assessment remains one active course item while its question count
advances. Its normal observation budget still applies. The collector refreshes
only the requested question's live outline link, reuses unchanged parsed DOM
evidence, and avoids a second traversal when all identified question parts are
already observed and complete. It does not shorten loading waits or infer keys.

Question observations are saved after the first new question, then after five newly
collected questions or five seconds when new questions arrive, and at the end
of outline collection. An unfinished visit remains explicitly incomplete, even
if its last question was saved. An interruption does not consume a completed
editor attempt. On resume, saved questions must match the current outline's ID,
ordinal and prompt before reuse. A new partial checkpoint retains previous
identified observations, rather than overwriting them with a shorter prefix.

Intermediate batches do not serialize or download the course. After acquisition
finishes, CTI requests one final JSON download, serializing fingerprint items
separately without retaining another course-sized UTF-16 JSON string. A physical
**Download CTI JSON** button remains available if Chrome blocks the automatic
save. Unknown types, missing keys and inaccessible external content remain
explicitly incomplete; automatic navigation does not weaken completion rules.

To recover a previous partial JSON, select it in **Check the downloaded capture**
and use **Copy automatic resume command**. The initial import matches the live
inventory and keeps newer checkpoints; subsequent automatic documents restore
IndexedDB rather than parsing the old file again.

## Test the whole course again

From v6.15.20, use **Copy fresh full-course command** for a complete rerun.
It collects fresh course observations without importing a selected JSON or
earlier browser checkpoints. Close DevTools, refresh Coursera, and reopen
Protocol monitor before pasting, so an earlier registration cannot compete
with the new run. Keep DevTools open after pressing Enter once.

The fresh run has its own checkpoint namespace. It restores that progress across
automatic reloads and requests one final JSON download. Earlier checkpoint
records, downloaded files and login cookies remain intact. The final JSON records
`meta.automaticLocalCapture.captureMode: "FRESH_FULL_COURSE"` and the new run's
checkpoint identifier. A fresh rerun still reports incomplete evidence when an
editor or external item cannot provide everything required by the strict gate.
After an interruption, use **Resume saved managed run** or
**Copy saved-run recovery command** to continue this run and its original limits;
copying another fresh command intentionally starts a separate rerun.

## Recovery and resource limits

Closing DevTools ends its registration. Use the explicit saved-run recovery
workflow above to register a new command against the matching checkpoints.
For standalone capture, a renderer crash requires
browser-level recovery: page JavaScript cannot control its own crash screen.
Reload and register a new command. This implementation reduces accumulation
between editors and within long assessments; it cannot guarantee that a single defective or exceptionally
large Coursera editor will fit in available memory. Full raw course evidence
still needs to fit in the final document and download Blob. No evidence is
silently truncated to make an oversized capture appear complete.

Question observations count toward continuation progress, so a large assessment
can span more than three documents while its course item remains unfinished.
Matching observations from the same unfinished visit retain explicit missing
keys and advance to later questions; a separate recovery attempt can inspect
those gaps again. Rediscovering a saved prefix does not rewrite it repeatedly.

Three unchanged continuation summaries, 500 batches or eight hours of active
work stop a run with its raw partial evidence. From v6.15.30, only explicitly
measured visibility waits are excluded from that time budget; unobserved sleep
or other clock gaps remain counted. Normal resume selects a new checkpoint namespace
after 12 hours; saved rows remain accessible through the recovery command.
The same course must not be captured concurrently in multiple tabs. A fresh
heartbeat blocks a second tab; a registration whose browser disappeared can
be replaced after the 45-second liveness window. The same tab can replace its
registration after reloading without waiting for that window.

Use **Copy saved-progress Console script** after an interruption. Stop the managed
run, open the matching authoring shell normally, then copy that script from CTI
and paste into its normal Console. The alternative **Copy saved-progress export
command** runs the same recovery through Protocol monitor: close DevTools, reload
the matching shell, reopen Protocol monitor, turn Record off, clear its log and
paste into the bottom command input. Both use a single execution to match saved
observations to the current
course inventory, with no item editor visits. Read-only recovery can access the
existing checkpoint namespace after its normal 12-hour resume TTL, and cannot
save, import, clear or refresh checkpoint state. The exported JSON is explicitly
`SAVED_PROGRESS_ONLY`; it preserves observation dates and unfinished question
models. If no matching saved items exist, the progress card reports that instead
of starting another extraction. To resume expired checkpoints, select the
recovered JSON in CTI and copy the automatic resume command.

Chrome's Protocol monitor documentation states that recording starts when the
panel opens and continues across refreshes and DevTools closure. Turn Record off
and clear old traffic before each command. The crash error code alone does not
establish memory exhaustion; renderer, DevTools and operating-system evidence
are distinct. Page JavaScript cannot recover Chrome's crash screen.

The managed path supplies its outside controller in the normal CTI tab. An
external installed automation tool is a separate option only if workplace policy
permits local automation. Chrome 136+ requires a non-default `--user-data-dir` for remote
debugging flags, so an external tool cannot simply attach to the ordinary work
profile using a debugging port. This feature does not change that security rule.

## Official references and verification

- [MDN window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open): window references and opener-isolation policies.
- [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage): verify origin, source and target origin.
- [Chrome background timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88): hidden-page heartbeat limits.
- [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API): document visibility is an observed browser state; it does not identify every operating-system sleep interval.
- [Chrome Protocol monitor](https://developer.chrome.com/docs/devtools/protocol-monitor): enabling the panel and sending parameterized `cmd`/`args` JSON commands.
- [Chrome DevTools Protocol Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument): registration on every new frame, `runImmediately`, and the registration identifier.
- [Chrome memory problems](https://developer.chrome.com/docs/devtools/memory-problems): heap growth, detached DOM trees and browser Task Manager.
- [Chrome 136 remote debugging changes](https://developer.chrome.com/blog/remote-debugging-port): custom profile requirement for external debugging tools.
- [Coursera Naptime multiGet](https://github.com/coursera/naptime/blob/gh-pages/gettingstarted/index.md#multi-get): collection GET requests with comma-separated `ids`; support on each observed authoring resource must still be checked.
- [Naptime field projection](https://github.com/coursera/naptime/blob/master/naptime/src/main/scala/org/coursera/naptime/models.scala): fields are combined with defaults, and negative selections can exclude default credential fields.

`npm run test:browser:local-capture` executes the maintained extractor entry,
IndexedDB store, completion gate and export through real Chromium CDP commands.
The authenticated external editor observations are synthetic. It verifies 188
items across ten automatic documents, no repeated visits, one lossless final
JSON, finished-registration suppression, course guards and a failed-checkpoint
stop. It also checks debugger-disconnect recovery, automatic startup after a
manual renderer yield, saved-file import only in the first document, and an
unavailable inventory. This is not a live authenticated Coursera acceptance test.

`npm run test:browser:assessment-progress` additionally uses a real virtualized
100-question DOM and IndexedDB, reloads the document after at least 31 questions were
committed, and verifies restoration without repeated question clicks. It checks
raw and Unicode preservation and the strict distinction between an unfinished
visit and the completed assessment. External content remains synthetic.

`npm run test:browser:assessment-slices` exercises the canonical entry against
a local HTTPS fixture with 165 items and a virtualized 609-question assessment.
It forces a real renderer crash, opens the same course in the same browser
profile, exports even expired saved progress without editor visits or checkpoint
mutations, and resumes across question batches to one automatic final JSON.
Durably saved questions are not clicked again. The last few observations that
had not been committed before a crash may need to be read again.

From v6.15.19, a fully visited inventory continues automatically while any item
has a recovery attempt available. Recovery budget exhaustion therefore retains
the checkpoint store and proceeds in a new document. The final download follows
completion of those visits or an explicit safety stop. Terminal incomplete
items remain reported gaps and do not trigger repeated capture. The native
local-capture check verifies this recovery-budget boundary and one final JSON.

`npm run test:browser:supervised-capture` runs the canonical entry and the actual
CTI supervisor in separate HTTPS origins using full Chromium, with normal desktop
site isolation, rather than the headless-shell build. Its 168-item course has a 100-question
quiz. It forces two renderer crashes and verifies automatic recovery with the
same tab and debugger registration, matching checkpoints and one final JSON. A
second case captures loaded definitions without question-editor clicks and
preserves raw math and unknown fields. An opener-isolation case stops before
editor visits. Diagram references from matched definitions are fetched and hashed,
and login navigation pauses recovery. Course responses are synthetic; private Coursera acceptance
still requires verification with the operator's account.

Coursera's native **Export** button was reported to produce an Excel outline.
An outline alone does not establish complete question, answer-key or media
coverage, so CTI does not treat that export as a replacement for content capture.

The v6.15.27 native API check reproduces the reported unmarked body with 27
compound question links and 100 observed group/ordinal wrappers. It verifies all 100
synthetic definitions and keys in fourteen GETs, without question clicks or
sidebar scrolling, and rejects ambiguous or replaced bodies. The prior live
run with 79 saved observations, zero finished visits and two recoveries failed;
these fixture results do not establish private whole-course completion.

The v6.15.29 native recovery fixture removes a real debugger registration after
forty items have been completed across two fresh batches. A replacement managed
token restores that namespace and finishes 168 synthetic items, a 100-question
keyed quiz and one final JSON without revisiting completed items. Empty matching
checkpoints stop before editor visits. This proves the tested handoff behavior,
not the cause of the reported private-browser interruption.

The built UI lifecycle regression closes and reopens the extraction panel during
a managed run. A real cross-origin `READY` message with 79 saved observations
must still receive an acknowledgement while the component is unmounted; the
same child, command, course URL and counts must reappear afterward. It does not
start a replacement capture merely because the UI view changed.

`npm run test:browser:scale-capture` passed three paired runs against an
identical 132-item completed corpus of 17,457,590 payload bytes and four remaining
readings. Median fixture time fell from 21,676 ms for released v6.15.30 to
9,952 ms for v6.15.31. Completed raw reads before the first reading fell from
132 to zero, preliminary outline scroll events from 35 to zero, and setup from
approximately 12.5 seconds to 0.15 seconds.

Its larger case added 28 readings and a 609-question virtual MCQ bank to the
same completed corpus: 161 strictly complete items, two renderer batches,
one JSON, 84,363 ms, 84 API requests including setup, at most two concurrent
requests and zero question-editor clicks. The 132 completed raw payloads
remained deferred during initial restores and were read once at final
materialization, with their original rich wrappers preserved. A collapsed
outline also passed the on-demand fallback check. Separate API regressions
retain all 609 original mixed-bank definitions while leaving thirteen
unsupported parts as explicit gaps and verifying 596 supported keyed questions.

`npm run test:browser:mixed-bank` also passed a native 609-question mixed bank:
596 API questions plus thirteen observed text-match editor answers. An
interruption after six editor answers retained 602 durable questions; reload
captured only the remaining seven. Each document used four progress saves,
all 609 original sanitized wrappers survived, and completeness stayed false
until all required keys were observed. The resumed API reused 596 exact
definitions with one definition request. Cycle times were 21,047 ms and
51,944 ms; the unsupported API wrappers are opaque synthetic data.

Network responses and editor content in these checks are synthetic, running
through real Chrome. These measurements establish the tested performance and
preservation behavior, not live private-course latency, support for every
content type or an 84-second Coursera completion promise.
