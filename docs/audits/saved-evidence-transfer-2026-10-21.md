# Saved-evidence transfer contention and recovery

Baseline: deployed main b20e703e06c683fea6e329e04a5c0b34149178d0.
Operator report: record ddc3b05a-1a39-4218-8149-93b6c12da357, chunk 2/27,
HTTP 503, Cloudflare Ray a4dab7dfc92d9094-BOM, workspace busy and one-second retry.

The quoted message is produced by WorkspaceRuntime when its serialized workspace
queue has eight pending requests. It rejects before executing the evidence handler
and supplies Retry-After: 1. This identifies application backpressure, not evidence
corruption or proof of a Cloudflare CPU failure. No production request log was
available to identify the exact competing operations. Client audit-history loading
used unbounded Promise.all reads and can itself create this contention.

workspace-http.ts already retried safe GETs and digest-checked chunk PUTs three
times, at fixed exponential intervals without jitter. workspace-store.ts pins
chunk URLs to a saved revision and checks the final SHA-256 and JSON, but discarded
all downloaded chunks on failure. get() did not expose transfer progress options.

## Corrections and boundaries

- Saved-evidence GETs use at most six attempts per manifest/chunk, a 45-second
  per-attempt timeout, exponential backoff (1, 2, 4, 8, 8 seconds) and additive
  jitter below 25%. Retry-After seconds or HTTP dates set a minimum delay. Delays
  over 30 seconds stop with a clear message rather than retrying before permitted.
  Other operations retain three attempts. Creation and commit POSTs remain
  non-retried; existing exact-ID reconciliation and digest-checked PUTs are intact.
- Each authenticated teamStore serializes saved-record downloads. Comparison
  history loads sequentially and stops on failure instead of leaving a fan-out
  of active reads. The server's eight-request limit is unchanged.
- Up to two interrupted records retain ordered chunks in memory (each bounded
  by the existing 256 x 128 KiB limits). Retry re-fetches the manifest and requires
  the same record envelope, revision, part count and complete-payload checksum.
  A changed manifest starts a separate complete read; bytes cannot be mixed.
- Interrupted chunk bodies never enter the retained prefix. Every completed
  record still requires its full checksum and strict UTF-8/JSON validation.
  Integrity failures discard the partial cache. Partial bytes are never imported,
  written to disk or exposed as complete evidence. Original records are untouched.
- Main workspace progress shows chunk, retry/delay and checksum-verification
  stages. Exhaustion reports attempts, HTTP diagnostics and retained chunk count.
  Retention is local to the store instance: reload, close or reconnect loses partial
  progress, not server evidence; a third partial record evicts the oldest.

## Verification

Focused regressions reproduce repeated 503s at chunk 2/27, budget exhaustion and
same-chunk resume, Retry-After dates/seconds, interrupted response streams, abort,
12 concurrent reads, changed revisions, checksum corruption, bounded retention
and isolation between store instances. Production runtime-class tests reproduce
its eight-request rejection and recovery. Existing upload tests check duplicate
prevention and uncertain commits. The maintained Chromium workspace journey also
injects a chunk-2 503, verifies visible retry status and confirms chunk 1 was read
once. Final mandatory CI and exact-commit deployment results are recorded in the PR.

## Operator recovery

After deployment, reload CTI once to receive the patch and repeat the same action
that read the saved record. The pre-patch failure did not retain chunk 1 in memory,
so that first post-update attempt starts a new read of existing evidence; no new
extraction or import is needed. Subsequent transient failures retry automatically.
If exhausted, keep the tab open and repeat the same action: retained chunks resume
only after the saved revision is rechecked. Avoid repeated clicks and concurrent
heavy saves in other tabs. Never clear checkpoints or workspace storage.
