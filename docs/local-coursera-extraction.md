# Automatic Coursera capture in local Chrome

## Quiz definitions before question-editor rendering

The reported Technical Drawing capture was too slow to serve as a scalable team
workflow. Protocol monitor improves registration and recovery; it does not
remove question-editor rendering by itself. A real response sample supplied on
12 October 2026 now confirms that Coursera returns original native MCQ prompts,
options and explicit answer keys through read-only assessment endpoints.

The request-based fast path uses the same managed Protocol monitor setup below.
It opens a quiz once, collects its complete ordered live outline, and reads
only observed group and exact versioned question identities. Supported native
MCQs can therefore be captured without activating every question editor.
For a virtualized outline, bounded scrolling reads the sidebar identities and
restores its position without scrolling the content or activating questions.
Small Naptime batches are tried before bounded single-ID reads; matching uses
returned source IDs, and ordering comes from the outline. It preserves original
CML and maps `correctOption` to its exact option ID. Credential envelope fields
are excluded from retained evidence.

From v6.15.26 the direct path also works when Coursera opens a quiz modal while
the address stays at `/content/edit`. CTI must have opened a fresh, unique editor
through the exact course item ID. It keeps that
sidebar/content pair pinned; a generic address, matching title or earlier
network history alone cannot establish the item. No additional operator step
is required for this layout. The two fixed read resources were confirmed by the
real response sample; cached editors no longer have to emit both endpoint
requests again to enable acquisition. An exact item URL with a fresh unique
editor pair can also certify that item independently of outline-control scores.

The supplied sample contained ten groups and ten definitions, with eight
previously observed questions gaining explicit keys that were missing from
their older DOM capture. It does not establish a complete 100-question quiz or
whole-course acceptance. An incomplete outline, multiple variants, an unsupported
question type, unavailable responses or conflicting identities keep explicit
gaps and use the existing observed DOM fallback. The [feasibility assessment](coursera-extraction-feasibility.md)
details the evidence and remaining boundaries. No extension, local installation
or paid browser is required.

The progress card shows **Reading quiz definitions** when direct acquisition is
active and **Reading quiz in editor** with a reason when fallback is needed.
Denied reads and server rate limits stop the run with saved evidence rather
than repeatedly reopening editors. Direct reads use their own bounded evidence
collector, avoiding duplicate generic-network response copies.

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
running JavaScript inside that renderer. The existing debugger registration is
restored on the new document while its session remains attached. Saved item and
question checkpoints then resume normally. The native test preserves the same
tab, controller and registration through two real renderer crashes.

The visible-tab heartbeat window is 45 seconds. A hidden Coursera tab gets
three minutes to account for Chrome's background timer throttling. The
controller never navigates an unpaired tab or a login screen. It stops after
three recoveries without new saved progress, thirty total recoveries, a lost
window link or an explicit extraction error. Existing course and batch limits
still apply. After a renderer recovery, the question budget decreases to ten,
then five observations per document. **Stop managed run** closes the managed
tab while preserving browser checkpoints.

Browser opener-isolation policies can sever the link, and managed capture
refuses to start without a verified acknowledgement. No security policy or
header is bypassed. Crash recovery also relies on Chrome's normal site isolation
keeping the CTI and Coursera sites in separate renderer processes. If browser
policy disables that isolation, a shared-process crash can stop both tabs; this
feature does not alter enterprise browser policy. Closing DevTools removes its registration; the CTI tab
cannot recreate that registration. Closing, refreshing or leaving CTI's Extract
page also ends its supervisor. These interruptions require a new command.

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
After an interruption, use the normal automatic command to resume this run;
copying another fresh command intentionally starts a separate rerun.

## Recovery and resource limits

Closing DevTools ends its registration. Reload the matching course and copy a
new command to resume from saved checkpoints. For standalone capture, a renderer crash requires
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

Three unchanged continuation summaries, 500 batches or eight hours stop a run
with its raw partial evidence. Normal resume selects a new checkpoint namespace
after 12 hours; saved rows remain accessible through the recovery command.
The same course must not be captured concurrently in multiple tabs. A fresh
heartbeat blocks a second tab; a registration whose browser disappeared can
be replaced after the 45-second liveness window. The same tab can replace its
registration after reloading without waiting for that window.

Use **Copy saved-progress export command** after an interruption. Close DevTools,
reload the matching authoring shell, reopen Protocol monitor, turn Record off,
clear its log and paste the command into the bottom command input. It uses a
single `Runtime.evaluate` execution to match saved observations to the current
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
