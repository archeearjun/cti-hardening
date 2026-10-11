# Automatic Coursera capture in local Chrome

The primary Extract workflow uses the operator's existing, authenticated Chrome
profile. It needs no extension, local Node/Python installation, remote browser,
or Cloudflare browser quota. Chrome's built-in DevTools Protocol monitor registers
the canonical extractor with `Page.addScriptToEvaluateOnNewDocument` and
`runImmediately: true`. The registration belongs to that open debugger session;
a Console paste or a DevTools Snippet alone cannot survive document reloads.

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
new command to resume from saved checkpoints. A renderer crash also requires
browser-level recovery: page JavaScript cannot control Chrome's crash screen.
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

Fully automatic recovery from an actual renderer crash requires an outside
browser controller. That is a separate option only if workplace policy permits
local automation. Chrome 136+ requires a non-default `--user-data-dir` for remote
debugging flags, so an external tool cannot simply attach to the ordinary work
profile using a debugging port. This feature does not change that security rule.

## Official references and verification

- [Chrome Protocol monitor](https://developer.chrome.com/docs/devtools/protocol-monitor): enabling the panel and sending parameterized `cmd`/`args` JSON commands.
- [Chrome DevTools Protocol Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument): registration on every new frame, `runImmediately`, and the registration identifier.
- [Chrome memory problems](https://developer.chrome.com/docs/devtools/memory-problems): heap growth, detached DOM trees and browser Task Manager.
- [Chrome 136 remote debugging changes](https://developer.chrome.com/blog/remote-debugging-port): custom profile requirement for external debugging tools.

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
