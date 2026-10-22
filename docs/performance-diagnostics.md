# Performance diagnostics (PR #105)

This is opt-in timing, not a new capture contract. It does not change requests,
retry budgets, concurrency, matching, publication, saved evidence, or verdicts.
Diagnostics have their own schema and never enter an evidence/checkpoint payload.
The engine and extractor evidence-contract versions remain unchanged; diagnostic
exports additionally identify instrumentation `pr105-v1` and their runtime build.
Refresh the bookmark from the current CTI setup page to obtain these controls.

## Current execution pipeline

| Operation | Existing execution and instrumentation |
| --- | --- |
| IMSCC | Browser iframe validates the file, hashes it in bounded chunks, indexes ZIP entries, parses manifest/hierarchy, reads/decompresses referenced files, parses QTI/PDF/text and analyzes structure. Timings separate hashing, ZIP index/read, manifest, QTI, content inventory and structure. File-read counts/expanded bytes count actual reads, not unique instructional resources. Exact duplicate paths are counted without exporting paths. |
| Brightspace | Local bookmark restores a checkpoint, reads same-origin bounded APIs, traverses native inventory, acquires definitions and originals, checks stability, saves and exports. Existing request delay, caps and per-attempt URL cache remain. Diagnostics time run, item, JSON acquisition (inventory), definition-reference processing and checkpoints; requests record header latency and HTTP outcomes. Existing sleeps are wall-clock waits, not CPU. Final topic/definition totals are observations, not completeness claims. |
| Coursera | Same-origin direct bookmark discovers material, binds atoms/relations, acquires question definitions/native and provider bodies, checks stability and checkpoints. Four existing request slots remain unchanged. Native transport timings include body/hash/sanitization. Existing 429 waiting and transient retry counts are separate. Per-item spans include provider/media work. Exact-version question reuse increments cache hits. End coverage is retained verified/expected coverage, not newly acquired item count. |
| Comparison | File/record load and validation → normalized inventory → global match plan → item parity (structured-assessment items separately timed) → owner report and content projection → UI. Worker snapshots travel as separate diagnostic messages, never comparison records. Report-paint latency is a proxy, not proof the operator saw or acted on a finding. |
| Retained evidence | Saved-record loading includes manifest, resumable chunks, final digest and parsing. Individual HTTP attempts and existing backoff are distinct. Reused partial chunks count as cache hits. The eight-request workspace queue and transfer identities/checksums are unchanged. |
| Source recovery | Original package hash/index/read, binary inspection, retained-original reuse and receipt validation are timed. Recovered bytes and verification scopes remain unchanged. |
| Focused check | Enable workspace diagnostics before generating the existing item-check script. The script separately downloads its end-to-end timing, including partial failure, without modifying the check receipt. Receipt validation and owner-report export are separately timed in CTI. |
| Cloudflare | Browser-observed HTTP elapsed time includes network, queue and service processing. It cannot distinguish Durable Object queue time, D1 time or Worker CPU. No server instrumentation or telemetry service is added. |

Existing Brightspace phase clocks and Coursera budget clocks still govern their
own UI and safety limits. The optional monotonic clock does not replace them.
No page-navigation loop is added: both current course bookmarks acquire native
APIs in the current tab. Legacy focused editor navigation remains inside its
end-to-end span; hydration versus navigation is not separately observable here.

## Enable and collect a baseline

1. Keep your current captures, source package and saved comparison. Reload CTI.
   Open **Performance diagnostics** above the workspace and enable the checkbox
   before the operation. Run one retained-record load or original IMSCC scan.
   For a scan, choose the original file; no source LMS acquisition is required.
2. Refresh the Brightspace bookmark from CTI. Open the intended NAIT course,
   click the bookmark, enable **Performance diagnostics (local)** on the capture
   panel, then use **Capture/resume** only if source evidence is needed. Keep the
   tab open. Download diagnostics even if the attempt pauses or hits an access gap.
3. Refresh the Coursera full-course bookmark. On its existing Content page card,
   enable diagnostics before **Capture/resume** or the already-supported native
   recheck. Reuse existing evidence if no fresh evidence is needed. Do not use
   Start fresh for a performance experiment. Download diagnostics before closing.
4. In CTI, run the intended TRDE120 comparison with the same retained inputs.
   Download **CTI-performance.json**. For a focused check, keep diagnostics on
   before generating its script, run it only on the existing exact item link,
   retain **CTI-performance-focused-check.json**, and import the ordinary check
   receipt into that same action card. Download workspace diagnostics again.
5. Send the performance JSON bundle, the separate source/destination/focused
   timing JSON files for operations actually run, and a short note identifying
   course, operation, whether it resumed and any operator interruption. Include
   the ordinary item-check receipt only if investigation of its findings is
   requested; no console logs, credentials, answers or capture bodies are needed
   for timing analysis. Retain original evidence locally.
6. Repeat only the relevant subset on TRDE130. Compare the same stages and counts;
   a resumed capture and a fresh capture are not equivalent workloads.

Each bookmark attempt starts a separate local trace. Download the previous one
before starting another attempt. Workspace exports retain up to 30 worker/iframe
traces plus the current session. They are memory-only: download before closing or
reloading. Pause/failure exports remain useful; a hard tab close cannot preserve
unexported diagnostics. No diagnostic data is uploaded, even when the workspace
uses shared storage. Source/Destination traces belong to their respective tabs.

## Interpretation and limits

- `measurementStatus: complete` means instrumented execution finished, **not**
  evidence completeness. `items_verified` is only populated from existing
  Coursera coverage; HTTP 200 never increments it. Source `items_observed` and
  `questions_observed` use existing observation summaries.
- All durations are monotonic wall time. `cpuMs` is null. Processing stages can
  include I/O and scheduling. Header time does not include Brightspace body reads.
- Stages show both sum of spans and union of active intervals. Concurrent request
  sums can exceed total duration. Stages and nested slowest spans overlap; never
  add them to estimate total wall time. Slow items use run-local ordinal numbers.
- `repeated_reads` means the exact request/path was seen again within bounded
  tracking. Initial/final stability reads are intentional. These counts cannot
  independently establish unnecessary work. Cache hits count observed reuse at
  instrumented boundaries, not every cache in the application.
- Records are capped at 4,000 spans. Dropped spans force partial status and are
  counted. Numeric counters continue. Worker snapshots are throttled to one per
  second; an abrupt stop can lose the last interval. Fixed stage/counter labels
  and ordinals prevent content, exception messages and URLs from entering traces.
- Not separately measured: pre-enable startup/login, provider/media transport
  subrequests, detailed legacy editor hydration, PDF parser versus rendering,
  total unique files across operations, server CPU/D1/queue time, all cache paths,
  operator reading/editing time, or time until the operator actually uses a finding.
  A `first_report` span measures report commit-to-frame readiness from comparison
  start; it is explicitly not an actionable-finding acknowledgement.
- Diagnostics do not judge the support status of content. Existing evidence keeps
  exact unsupported-contract reasons; exported counters contain unresolved totals
  only. Consult the existing capture/report for per-item reasons. No additional
  scanning of private bodies is performed to manufacture diagnostic metrics.

## Instrumentation decisions and suspected bottlenecks

Before each group, the seven design questions were applied:

| Group | Utility / reuse | Cost / concurrency | Failure, proof and operator boundary |
| --- | --- | --- | --- |
| Scan / recovery | Distinguish full-file hashing, decompression and parsing; reuse existing hash/ZIP/scanner calls. | Constant-time start/end, bounded spans; nested durations explicitly non-additive. No extra reads/hashes. | `finally` closes failed spans; checksums and receipts unchanged; export via UI. |
| LMS APIs / items | Find wait-heavy and expensive items; reuse current reader, progress and coverage boundaries. | No intercepting global fetch, extra network work, or changed concurrency. Only existing requests/sleeps observed. | HTTP/authentication/429/503 counters; partial spans survive pause; observed != verified; per-card switch/download. |
| Comparison / reporting | Separate normalization, matching, parity and owner formatting. | Optional per-workflow hook, no changed rule inputs; worker messages throttled. | Same fixtures must produce identical verdicts/hashes/reports; failure snapshots separate from results. |
| Storage / focused checks | Identify chunk waits, resume reuse, package revalidation and targeted latency. | Existing serialized transfers and retry budgets; no new polling/acquisition. | No mutations to stored evidence or check receipts. Local diagnostic export works on interrupted attempts. |
| CPU, hydration, server queue, true first action | No reliable existing observable boundary. | Avoid expensive profilers, DOM polling, speculative browser automation and global interception. | Explicitly unmeasured; do not present invented zeroes or infer completion. |

Hypotheses until measured on TRDE120/TRDE130: large record transfer and validation;
repeated package hashing/decompression; comparison normalization/projection of large
captures; provider/media waits; deliberate initial/final native stability reads;
legacy focused editor hydration. This PR implements no optimizations.

## Validation

`node tools/benchmark-performance-diagnostics.mjs` alternates enabled/disabled
warm trials of real ZIP validation/reads, hashing, 100 original-binary inspections
and 100 mocked native responses. It exports raw paired timings and separately
measures snapshot/JSON export. These are synthetic local overhead measurements,
not real-course speed or completeness claims. The checked benchmark receipt and
release report record actual results after competing tests finish.

Focused tests cover disabled behavior, overlap/partial bounds, privacy, auth,
429/backoff, 503 retry invariance, aborted requests, real binary/hash equality,
and unchanged comparison verdicts/hashes/owner reports. Browser package tests
exercise the operator switch, separate JSON download, stage timings and identical
source evidence. Existing source recovery, native extraction, focused checks,
activity checks and mandatory hosted gates remain required.

Measured receipt: [11 alternating warm trials](audits/performance-overhead-pr105.json)
on Node v24.19.0/Linux: disabled median **54.997 ms**, enabled **62.852 ms**,
difference **+7.855 ms (+14.28%)**. Diagnostic snapshot/JSON export median was
**0.541 ms**, measured separately. The workload processed 32 compressed entries
(2,293,760 expanded bytes), 100 original-binary inspections and 100 mocked native
responses. No other test workload was launched during this measurement. This
short local workload has scheduling/JIT variance; the result is not a claim of
negligible overhead or a measured overhead percentage for a live LMS capture.
