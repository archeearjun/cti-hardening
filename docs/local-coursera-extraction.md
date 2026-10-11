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
The app also offers a selectable, complete copy fallback; ChatGPT downloads and
its file viewer are not part of this workflow.

Keep Coursera and DevTools open. Every item is checkpointed to IndexedDB. At the
shared renderer boundary (20 visits, five minutes between items, 64 MiB heap
growth, or 384 MiB total reported heap), CTI automatically returns to the shell
in a new document and restores matching checkpoints. A slow assessment retains
its full item budget; these boundaries do not abort it midway. Checkpoint
failure stops continuation and prepares a partial final capture.

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

## Recovery and resource limits

Closing DevTools ends its registration. Reload the matching course and copy a
new command to resume from saved checkpoints. A renderer crash also requires
browser-level recovery: page JavaScript cannot control Chrome's crash screen.
Reload and register a new command. This implementation reduces accumulation
between editors; it cannot guarantee that a single defective or exceptionally
large Coursera editor will fit in available memory. Full raw course evidence
still needs to fit in the final document and download Blob. No evidence is
silently truncated to make an oversized capture appear complete.

Three unchanged continuation summaries, 500 batches or eight hours stop a run
with its raw partial evidence. Browser checkpoints expire after 12 hours.
The same course must not be captured concurrently in multiple tabs. A fresh
heartbeat blocks a second tab; a registration whose browser disappeared can
be replaced after the 45-second liveness window. The same tab can replace its
registration after reloading without waiting for that window.

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
