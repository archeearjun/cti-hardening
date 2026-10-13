# Coursera extractor runtime stability

## v6.15.32: targeted outline navigation and smaller managed documents

The operator reported a v6.15.31 crash after approximately thirteen items while
keeping the managed tabs open. The run restored itself, then crashed again
while its card showed **Expanding course outline...**, eighteen seconds in the
document and eleven seconds in that step, with batch counts 1/1. This identifies
an observed failing phase, not a confirmed memory diagnosis. Chrome error code
5 alone does not establish out-of-memory failure or its underlying cause.

Navigation now searches the target's observed path and stable identities rather
than warming or expanding the whole course outline. When no usable path is
known, it opens one safe branch at a time and restores unsuccessful branches
and scroll positions. It never invokes the mass **Expand all** control. Existing
exact item and course checks remain required; a matching title cannot override
a conflicting ID or foreign course route.

Managed documents now allow at most six item visits, reduced to four after a
renderer recovery. After a successful item checkpoint, an item with at least
100 declared assessment parts or 2 MiB of measured evidence requests a new
document before another item. Accumulated measured evidence also requests a
yield at 8 MiB. These measurements cover available retained API evidence and
text, not total renderer RSS or all native allocations. Manual/unsupervised
capture retains its twenty-visit limit. Existing time, heap and question limits
continue to apply; none is a universally safe memory threshold.

Completed editor observations are saved before returning to the outline. If
pressure already requires a document reload, the extra outline return is
skipped. During API acquisition, a pressure signal stops scheduling new reads;
the bounded in-flight reads settle and their sanitized partial raw definitions
and integrity receipts are retained. Resume still requires a fresh matching
inventory, fresh group references and exact version/checksum agreement before
reusing a definition.

When a new API receipt does not carry every prior raw record unchanged, the
earlier receipt is preserved separately as historical evidence. That history
is bounded at 32 MiB and excluded from definition-cache reuse and completeness
decisions. Reaching its bound blocks replacement with an explicit stop reason
instead of truncating or discarding the existing raw evidence. A raw-only
progress checkpoint also decrements the unfinished visit's temporary attempt
count, so preserving API observations alone does not spend a completed attempt.

Restoration now reports durably complete item counts immediately, so repeated
reading-only recoveries can recognize saved progress. Course question totals
combine the current observation with its saved counterpart without counting
both copies. This changes progress accounting, not the strict capture contract.

The native reading-recovery check exercises four real `Page.crash` events,
preservation of completed reading records, four successful recoveries and one
final JSON without reopening completed editors. Its unchanged-progress case
stops after three recovery attempts instead of looping. Targeted navigation
cases cover known and unknown paths, miss cleanup, conflicting identities,
unsafe controls and virtualized late targets. These use synthetic course
responses and do not identify the private browser's crash cause or certify its
whole-course completion.

The final v6.15.32 scale run passed three paired comparisons against released
v6.15.30 revision `b7024f5`, using the same 132 already completed item payloads
(17,457,590 bytes) and four new readings. Median total fixture time was
22,883 ms for the baseline and 11,592 ms for v6.15.32. Before the first new
reading, baseline completed-raw reads and outline scroll events were 132 and
35; both were zero in v6.15.32.

The larger v6.15.32 case combined those 132 completed items, 28 new readings and
a 609-question virtual MCQ bank. All 161 items passed the strict gate and one
JSON was produced in 88,175 ms. Document item visits were `[6, 6, 6, 6, 5, 0]`:
the last document opened no editors and performed final materialization after
the heavy bank's checkpoint-triggered reload. The run made 84 API requests
including setup, with at most two concurrent requests and zero question-editor
clicks. The original completed payloads remained deferred until final export.
A separate recovered-plan case processed ten remaining readings with document
visits `[4, 4, 2]`, confirming the smaller post-recovery visit bound.

These are measured synthetic network/editor fixtures running through the
canonical program in real Chrome, with 132 items already captured before the
measurement. They do not certify live Coursera latency, every content type,
the private crash cause or whole-course completion, and supply no private-course
completion deadline.

[Chrome's memory guidance](https://developer.chrome.com/docs/devtools/memory-problems)
distinguishes JavaScript heap from OS memory footprint, which includes DOM
nodes, and says there are no universal hard numbers for excessive memory use.
The new document budgets reduce retained work before navigation; they do not
prove that every Coursera editor fits every workplace machine. The v6.15.31
benchmark below remains evidence for that version: v6.15.32's smaller managed
budgets change renderer batch counts, so its two-batch and 84-second result
must not be presented as a v6.15.32 measurement.

## v6.15.31: reduce repeated work across automatic batches

Automatic documents now read a small IndexedDB checkpoint manifest first and
load raw payloads for incomplete items that still need work. Completed raw
payloads stay in storage until final materialization, avoiding repeated copies
of all previously captured course content on every reload. The writable
checkpoint database uses version 2; existing version-1 records migrate once
without truncating or deleting their raw observations. Read-only saved-progress
export does not upgrade the database or write checkpoint state.

A manifest is an intermediate scheduling receipt, not final evidence of
completion. Before export, deferred raw records are restored and their strict
capture contracts are independently checked against the live inventory. A
missing or inconsistent raw record cannot produce a complete export. Original
observations, keys, source identities and diagnostic receipts remain in the
downloaded capture.

Whole-outline hydration now runs on demand when a navigation fallback needs it;
certified direct routes avoid warming the outline first. Intermediate automatic
chunks checkpoint progress and continue without repeating the course-wide asset
pass, global normalization or final JSON preparation. Those final operations
run after acquisition completes or a bounded stop is reached.

Large virtual question rails receive a discovery allowance based on the
observed part count and scroll geometry, capped at 45 seconds and 420 steps.
This replaces a fixed small allowance that could not span long rails such as
609- or 2,000-part outlines. Discovery still observes exact group identities and
ordinals, restores scrolling and requires complete, unambiguous coverage.

API work interleaves group reads with their exact versioned definitions instead
of spending an entire item deadline on group records alone. At most two requests
are in flight. Resume can reuse an immutable definition only when the freshly
observed inventory agrees, a fresh group read returns the same exact versioned
reference and its retained definition passes SHA-256 integrity checks. Changed
versions need new reads. Unsupported definitions remain raw evidence and use
the existing DOM fallback; cached data does not relax completeness checks.
During that fallback, rediscovered API questions keep their original provenance
and do not trigger repeated full-model checkpoint writes. New observed editor
answers continue to be checkpointed.

The durable automatic plan accumulates bounded phase timings, checkpoint and
request totals, yield/fallback histograms and the most recent twenty batch
receipts. Exported items retain `captureDiagnostics`, so reloads no longer erase
the useful per-item acquisition explanation. Resource, identity and completion
guards remain in place; only the bounded rail-discovery allowance scales with
large inventories.

The native scale check passed three paired runs using the identical 132-item
completed corpus (17,457,590 payload bytes) and four remaining readings:

| Measurement | Released v6.15.30 | v6.15.31 |
| --- | ---: | ---: |
| Median total fixture time | 21,676 ms | 9,952 ms |
| Completed raw rows loaded before the first reading | 132 | 0 |
| Outline scroll events before the first reading | 35 | 0 |
| Setup time, approximately | 12.5 s | 0.15 s |

A larger v6.15.31 fixture retained the same completed corpus, added 28 readings and a
609-question virtual MCQ bank, and finished all 161 items through the strict
gate in two renderer batches with one JSON. Its measured time was 84,363 ms,
with 84 API requests including setup, at most two concurrent requests and zero
question-editor clicks. The original 132 completed payloads stayed deferred
during both initial restores and were read once at final materialization;
their rich original wrappers were preserved. A collapsed-outline case also
passed, exercising the on-demand navigation fallback.

A separate mixed-bank regression retains all 609 original definitions while
certifying 596 supported keyed questions and preserving thirteen unsupported
gaps. It does not invent a text-entry schema or turn retained raw data into
complete normalized evidence.

The native mixed-bank check then supplies thirteen observed text-match editor
answers for those opaque unsupported API wrappers. A forced interruption after
six answers preserves all 596 API questions and 602 durable questions in one
item record. Reloading captures only the remaining seven editor answers, reuses
596 verified definitions and finishes the strict 609-question contract. The
two documents used four progress saves each and thirteen total question clicks;
measured cycle times were 21,047 ms and 51,944 ms. All 609 sanitized original
definition wrappers were preserved. This verifies DOM recovery without asserting
an actual Coursera text-entry API schema.

These are synthetic network and editor fixtures running in real Chrome. Their
timings are descriptive measurements, not a live Coursera latency estimate or
certification of every content type. The supplied private v6.15.29 capture
remains partial; the 84-second fixture does not establish that the private
course will finish in that time.

## v6.15.30: exclude observed visibility pauses from active budgets

The supplied live v6.15.29 JSON contains 185 course items: 132 complete and
53 unresolved, including 25 unvisited items and 28 retryable items. It reports
31 of 34 assessments complete, with 3,144 captured questions against 3,741
declared; every captured question has an observed key. This is substantial
partial evidence, not complete course acceptance. The run used 117 batches,
with zero recorded stalls and zero recoveries, and stopped at
`LOCAL_CAPTURE_RUN_LIMIT` after 8.2078 hours of wall time. The last document
alone recorded an explicit hidden-tab visibility wait of 5 hours, 2 minutes
and 42 seconds.

The extractor already paused while waiting for the Coursera document to become
visible. In the automatic path, that measured wait still consumed the renderer
age budget and the eight-hour run budget. v6.15.30 excludes only these explicitly
observed visibility-wait intervals from renderer elapsed time and accumulates
them across documents for the eight-hour active-work budget. The original
`startedAt`, wall-time reporting, batch counts, checkpoint identity and other
limits remain intact. Returning from a long measured pause no longer spends
the renderer's work allowance merely because the tab was hidden.

This is not general operating-system sleep detection. A gap in the clock alone
does not establish a visibility pause, and unobserved sleep is not subtracted.
The browser cannot execute extraction while the computer is asleep. This change
does not keep the machine awake or guarantee background execution; keep Chrome
running and the Coursera tab visible when capture should advance.

The terminal v6.15.29 run remains terminal. To continue its partial observations,
select its JSON in CTI's **Check the downloaded capture**, leave **Fresh
full-course managed run** unchecked, and choose **Open managed Coursera tab**.
Register the newly prepared managed command once. This starts a new bounded
run that imports the saved observations and skips items already complete.
**Resume saved managed run** preserves the original plan and limits, so it still
rejects the old `LOCAL_CAPTURE_RUN_LIMIT` plan. The old file and checkpoint
observations remain evidence of the earlier run; v6.15.30 does not retroactively
certify its missing items.

## v6.15.29: explicitly resume the saved run after a lost registration

The live v6.15.28 quiz check verified 100 definitions and 100 explicit keys in
32.772 seconds, using 202 GETs and 500,818 response bytes. Definition acquisition
is now demonstrated for that quiz. A later full-course attempt reportedly
reached Module 6 before an outline page appeared without an extractor card or
run lock. Its shared durable plan still said `RUNNING`, 41 batches, zero stalled
batches, `FRESH_FULL_COURSE`, and about 50 minutes elapsed.

That diagnostic establishes that the inspected page was not running the script.
It does not prove the managed child stopped: Coursera tabs share the plan in
local storage. **Show managed Coursera tab** focuses the child CTI actually
supervises. Check that tab and the controller status before interrupting a
connected capture. A handoff or registration loss is a possible explanation;
the exact Chrome cause remains unconfirmed.

The operator also reported that CTI's status panel disappeared. A separate
concrete lifecycle defect was found: the extraction component's React cleanup
disposed the supervisor when that component unmounted. The managed runtime now
belongs to the loaded browser window and owns the supervisor, child tab,
command, course URL and latest status. The UI only subscribes or unsubscribes.
Closing the extraction panel therefore leaves acknowledgements and recovery
active; reopening it restores the same child, command, course and counts without
starting another run. **Stop managed run** still disposes the supervisor and
closes the child. A full CTI page reload creates a new runtime and still needs
explicit saved-run recovery. This fixes a reproduced lifecycle boundary; it
does not prove that it caused the reported private-browser interruption.

For confirmed execution loss, **Resume saved managed run** opens a replacement
managed tab and prepares an explicit recovery command. The standalone equivalent
is **Copy saved-run recovery command**. A new command token adopts only the
active same-course plan and matching browser checkpoint pointer. It preserves
the original checkpoint namespace and fresh owner, start time, batch count,
evidence progress and safety limits. The old command becomes `SUPERSEDED`.
An ordinary namespace remains pinned across its normal resume TTL rather than
being silently replaced.

Recovery rejects a still-live competing run, unrelated or terminal plans,
mismatched namespaces, and elapsed/batch/stall/recovery limits. A previously
started run whose checkpoints restore zero matching item observations stops
before editor visits with `LOCAL_CAPTURE_RESUME_EVIDENCE_UNAVAILABLE`; it cannot
fall back to a fresh capture. Raw saved observations remain available for
read-only export.

Page JavaScript cannot reinstall Chrome's debugger registration. Once it is
lost, the operator copies and registers the new recovery command once. The
managed supervisor still requires a verified `READY` acknowledgement after
navigation; normal appearance of the course outline is not a resume certificate.

The native recovery check saves forty complete items across two fresh batches,
removes the real CDP registration, then resumes under a new managed token. It
finishes a 168-item fixture with a 100-question keyed quiz and one final JSON,
without revisiting completed items or resetting the namespace, clock or budgets.
Empty matching checkpoints produce zero editor visits and no fresh fallback.
These are continuity checks with synthetic course content. Private whole-course
completion and the reported browser stop remain unverified.

The lifecycle regression closes the built extraction panel while its managed
child remains open, sends a real cross-origin `READY` receipt with 79 saved
observations, and requires an acknowledgement while the panel is unmounted.
Reopening the panel must restore the same command, child, course URL and counts.
Runtime unit checks also cover listener cleanup, replacement and explicit stop.

## v6.15.28: match the observed single-resource request format

The live v6.15.27 quiz check established the complete 100-part body inventory
and read all 100 group records, but captured zero definitions and zero keys.
It made 202 GETs in about 31 seconds: both batch routes returned HTTP 405,
then every individual definition read returned HTTP 404. Inventory success
therefore did not establish successful question acquisition.

The working original response sample used a literal `@` before the definition
version. The request builder instead percent-encoded that delimiter as `%40`.
Single reads now preserve the literal delimiter in the already validated exact
versioned ID returned by the group. Group singles also repeat their exact
group key in the observed `id` query parameter; definition singles omit that
parameter, matching the sample. Positive fields include `validation`.
Credential exclusion and sanitization remain in place. No question ID or
revision is guessed, and strict key/coverage checks are unchanged.

Earlier native fixtures decoded the request pathname before matching it and
therefore masked the wire-format difference. The regression server now rejects
a raw `%40` version delimiter before decoding. Its unsupported-batch case uses
HTTP 405 and verifies 100 definitions and keys in 202 GETs with zero question
clicks, including the actual copied Console check. HTTP failures are recorded
once; semantic failures are recorded only for successful HTTP responses with
their actual status. A separate regression preserves genuine definition 404s
as incomplete evidence.

This fixes an evidenced request-format mismatch. A new bounded live quiz result
is still required; the change does not promise to resolve every 404 or certify
the user's full private course.

## v6.15.27: observed body inventories and bounded recovery

The next live run failed with 79 saved question observations, zero finished
visits and two recoveries. A focused read of a normally opened quiz then showed
one sidebar, no `item-layout-content` marker, 27 compound question links and
100 connected body parts. All 100 parts had unique compound group IDs and explicit
`assignment-part-0` through `assignment-part-99` ordinals. The API certificate
had required the missing content marker even though the existing DOM observer
already supported that body layout. The API inventory had also treated the
small virtual sidebar window as the only source of ordered group identities.

The certificate now accepts the existing observed sidebar/body association
with strict uniqueness and freshness checks. A complete body inventory can
supply the exact observed group IDs and explicit ordinals without scrolling
the sidebar. It must cover the declared count, contain one assignment root,
and agree with current sidebar identities. Unhydrated parts carry no invented
prompt label. Definitions still follow exact returned versioned references;
keys still require an exact `correctOption` to option-ID relation. Reused or
replaced bodies, duplicate IDs or ordinals, foreign groups and competing layouts
cannot certify a complete capture.

API checkpoints now include their sanitized original definitions and a bounded
diagnostic receipt before continuing. The receipt preserves the extractor
version, certification flags, stop codes and request/error counts, excluding
raw question text, URLs and credentials. A registered command encountering an
already stopped durable run reports that state instead of silently returning.

After recovery navigation, the supervisor waits for a new `READY` acknowledgement.
If it does not arrive within one minute for a visible tab or three minutes for
a hidden tab, recovery stops with saved-progress instructions. It does not keep
reopening a normal course outline after Chrome loses the registered command.

CTI provides **Copy current quiz API check** for a normally open quiz. Its
Console script runs only the maintained API reader for up to two minutes, with
no question clicks, reloads, full-course crawl or checkpoint writes. The copied
result contains aggregate definition/key counts and error codes, not raw
question content. **Copy saved-progress Console script** separately recovers
stored observations through the existing read-only export path.

Native HTTPS fixtures reproduce the reported unmarked layout with 27 compound
question links and 100 body parts:
100 questions and explicit keys, fourteen GETs, zero question clicks and zero
sidebar scrolling. They also reject ambiguous inventories and body replacements.
These checks establish the corrected code path. The user's authenticated
whole-course extraction remains unverified.

## v6.15.26: cached editor reads and meaningful restart progress

A live v6.15.25 run remained on the first 100-question quiz after 71 minutes.
Its corrected structural diagnostic showed the expected exact project-item
route, one editor sidebar and compound authoring group IDs. The API adapter
unnecessarily required both known resource families to be observed again in
each item session. A cached or delayed request could therefore select DOM
fallback for the entire visit. The adapter now has fixed same-origin GET bases
for the two empirically verified resources. No group or definition ID is
constructed from a question number: live outline IDs and returned versioned
references still supply every identity, with full coverage rechecked afterward.

The actual caller can certify a fresh unique editor on the exact course/item
route independently of outline-control confidence. Generic-address modals still
require the exact item-ID activation and pinned fresh regions. Fallback reasons
remain visible while question counters update and are saved before DOM traversal.
Checkpoint status reports the durable union rather than a smaller rediscovered
prefix. Automatic continuation uses monotone evidence high-water marks, excluding
attempts, restoration flags and temporary count regressions; three batches without
new durable evidence stop the run with partial observations retained.

Native browser checks cover cached definitions, exact project routes, full
controller orchestration, preserved keys and zero question clicks. These are
synthetic authenticated-origin fixtures, not a claim that the private 167-item
course has completed.


## v6.15.25: quiz modals that keep the course-shell address

Coursera can show an assignment while its address remains `/content/edit`.
The API path now supports this layout with a separate fresh-editor certificate:
an exact item-ID control must open the only visible sidebar/content pair, and
both regions must be new relative to all regions present before activation.
Title-only matches and reused regions cannot create this certificate. The
adapter uses only explicit GET records captured for that item's session, rather
than global resource history, and binds their assignment IDs to the live outline.

Course, URL, paired regions and global uniqueness are checked throughout reads
and acceptance. Partial editor fallback remains pinned to the same sidebar;
question-anchor fragment changes are allowed, while replacement regions stop
that visit before generic page harvesting. Original definitions and strict
coverage requirements remain unchanged. Native checks validate 100 questions
without question clicks on the generic route and reject stale, reused,
non-unique, mismatched and performance-only contexts.

## v6.15.24: native MCQ definitions before question rendering

The 12 October response sample exposed a concrete failure of DOM-only capture:
eight matching older observations had prompts and options but no reliable keys,
while their current versioned definitions supplied explicit `correctOption` IDs.
The new path first requires a certified course-item editor with every live
outline ID and ordinal. It reads group references and exact versioned MCQ
definitions through observed authoring resources, trying batches of fifteen with
at most two requests in flight. Unsupported batch routes fall back to single-ID
reads. Responses are matched by ID rather than arrival order.

The adapter retains original CML, option identity, independent option feedback,
shuffle settings and the explicit key relation. It rejects ambiguous identity,
missing keys, unsupported question types and groups containing multiple variants.
Credential fields are removed before checkpointing. Byte, request and item-time
limits remain explicit; denied authoring reads stop automatic continuation.
The live editor inventory is checked again before accepting the result.
Virtualized outlines are discovered by bounded sidebar-only scrolling and
restored afterward. Dedicated reads use the pre-recorder fetch caller to avoid
duplicate clones and false generic-network gaps in single-ID fallback. Valid
partial API observations keep their provenance during editor fallback and do
not consume the renderer's question-activation budget. Server rate limits halt
both editor traversal and automatic continuation after a bounded permitted retry.

The native 100-question fixture exercises the real cycle and HTTPS responses:
fourteen batch reads, bounded concurrency, every key preserved and zero question
clicks. Single-read fallback and incomplete/access/identity failures are also
checked. This validates the implementation against the observed schema; it does
not certify a new authenticated run of the user's full course.

## v6.15.23: selected-model retention and one-quiz response sampling

A live v6.15.22 report describes roughly 1.5 hours of slowly advancing quiz
capture without a final JSON. Crash recovery alone has not established a
scalable course extractor. See [feasibility and evidence](coursera-extraction-feasibility.md)
for the researched alternatives and the missing live API contract.

A fully parsed and raw-copied selected array now remains eligible even when
unrelated React/query-cache traversal later reaches its time or node budget.
Interrupted selected arrays remain ineligible. Candidate rows retain distinct
source IDs even when prompt wording repeats; missing or conflicting identities
still require observed DOM evidence. Rich-cache and repeated-prompt regressions
exercise these boundaries, and the native loaded-data case now includes 10,000
unrelated cache records. Raw-copy, text/key and live-outline checks remain.

The progress card shows whole-run wall time across automatic documents, with
the current document time separately. Batch item counts are labelled as such.
This changes reporting, not acquisition limits or completeness decisions.

CTI also offers a passive one-quiz response sample through a normal Console
paste. It observes existing scoped fetch/text-XHR JSON bodies without initiating
requests. Complete raw text is bounded by 6 MiB per body, 12 MiB total, 40 bodies
and five minutes. Authentication headers and secret query fields are omitted;
raw bodies remain private course data. Unsupported or oversized bodies are
explicitly declined. It is diagnostic evidence, not a full-course capture.

Native checks verify unmodified caller responses, request counts, limits,
conditional restoration and the built copy/fallback. A separate inherited-origin
blank-tab fixture verifies authenticated fetching without loading the authoring
application. Real Coursera response schemas and full private-course acceptance
remain unverified; no API-only extraction or universal perfection is claimed.

## v6.15.22: CTI-tab supervision and loaded question definitions

The next live report crashed during the first quiz around 1/168 visits. The
operator can open that quiz normally with the extractor stopped. This rejects
any claim that v6.15.21 solved the private-course crash. Error code 5 alone does
not identify memory exhaustion, and simulated content is not a live acceptance
certificate.

Two changes address the extraction architecture. A normal CTI tab now holds a
verified supervisor for the Coursera tab it opens. It navigates an unresponsive
renderer back to the course and relies on the attached debugger's retained
registration to restart the canonical program and restore checkpoints. Progress
receipts contain no cookies or raw question data. The supervisor checks window,
origin, token and course; it does not navigate before pairing, during login, or
after explicit errors. It stops at repeated failures without saved progress.
A browser policy that severs the opener link prevents managed acquisition;
there is no silent downgrade or security-header bypass.

The assessment flow previously traversed the outline before its supposedly
pre-click React-state probe. Safe question yields therefore prevented that
probe from running on many large items. The bounded loaded-model probe now runs
first for a certified live editor. It retains the original JSON-compatible
question fields, then binds eligible definitions to observed outline IDs,
positions and prompts while scrolling the outline. It does not infer ordinal
identity from array position or manufacture missing answers. Missing/ambiguous
definitions retain DOM recovery. Eligible loaded definitions do not consume a
renderer activation budget; time and heap checks still apply. After managed
crash recovery, remaining DOM question batches decrease to ten then five.

Native verification forces two renderer crashes in a 168-item synthetic course,
then completes its 100-question quiz with the same controller, tab and debugger
registration and one final JSON. A loaded-model case has zero question-editor
clicks, complete strict coverage and preserved math/unknown raw fields. A COOP
case stops before editor visits. See [local workflow](local-coursera-extraction.md)
for official references, limitations and operator setup. No extension or local
software installation is required.

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
