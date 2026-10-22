# Verified saved-evidence download batches (PR #106)

Baseline: `6b511904f4b784a53549c125a95a576389a2638d` (PR #105).
This change is read-only transport. It does not change stored records, uploads,
access policy, either LMS extractor, source recovery, comparison or focused checks.
No production deployment is authorized by this PR; Engineering Lead review comes first.

## Confirmed path and cause

`teamStore.get` serializes downloads within an authenticated store, fetches an
immutable manifest, then previously made one GET per 128 KiB stored chunk. Each
GET passes Pages authentication/owner policy, the private Worker front door and
WorkspaceRuntime's existing eight-request queue. The shared API resolves the
record and exact committed upload, then reads its chunk from D1. Each chunk cost
three D1 queries (document, committed revision, chunk). A manifest costs two.
Final bytes are assembled, SHA-256 checked and strict UTF-8/JSON decoded before
returning evidence. PR100 retains at most two interrupted records in memory and
rechecks manifest identity on explicit retry. PR105 measures load/request/backoff.

The change uses those same authorization, queue, retry and final validation paths.
No parallel request pool, background fetch, new cache or persistent partial file
is introduced. A failed read cannot create an upload or import.

## Protocol and bounds

New manifests advertise `downloadBatch: {version: 1, maxParts: 8}` plus original
`bytes`. The client requests:

`GET /api/records/{id}/chunk-batch?revision={revision}&first={first}&count={count}`

The revision must be explicit, committed and owned by the requested record.
Ranges must be canonical nonnegative integers, consecutive, at most eight parts,
and entirely inside that upload. Repeated query parameters are rejected.
Historical committed revisions remain readable; nothing is migrated or rewritten.

Binary framing, network byte order:

1. Eight ASCII bytes `CTIBATC1`.
2. Four-byte unsigned header length, bounded to 1,024 bytes.
3. Strict UTF-8 JSON header with exactly `recordId`, `revision`, `sha256`, `bytes`,
   `parts`, `first`, `count`, all matched against the requested manifest/range.
4. Each consecutive part: four-byte index, four-byte length, 32 original stored
   SHA-256 digest bytes, then the exact original chunk bytes.
5. Exact EOF; extra, truncated, reordered, duplicated or missing bytes/parts fail.

All chunk digests must pass before any bytes from a batch enter the resume buffer.
The final complete-record SHA-256 and UTF-8/JSON checks remain mandatory. Per-chunk
checks are additional integrity evidence, never a substitute for that final hash.

Eight chunks carry at most 1,048,576 original bytes; absolute framed limit is
1,049,932 bytes (12 + 1,024 + 8 × 40 + 8 × 131,072). D1 reads one range with an
explicit `LIMIT 8`, returning at most 2 MiB of hex plus small metadata. Each row's
hex is at most 256 KiB. This avoids retaining eight BLOB number arrays. The server
retains one bounded range/frame at a time inside the unchanged serial queue.
The 32 MiB record limit, two interrupted-record slots and final assembly remain;
batching adds bounded transient framing buffers, not an entire additional record.
The actual local Worker/D1 fixture exercises both an 81-chunk record and the full
256-chunk maximum. Local workerd success does not attest production CPU quotas.

## Compatibility and recovery

- Missing capability on an older manifest: use the unchanged individual endpoint.
- Older clients: continue using individual chunks; new manifest fields are additive.
- Advertised but unknown/malformed capability: fail closed.
- Advertised endpoint returns JSON, 404, 401/403, oversized/malformed bytes, or
  digest failure: fail; never hide the error by switching to individual chunks.
- Partial rollout after an advertised manifest: fail explicitly. Retrying the
  operation rereads the manifest, which can legitimately select the old path.
- Network stream failure: retry that whole batch within existing six-attempt
  download budgets, exponential jitter/backoff and Retry-After limits. A clean EOF
  with a truncated frame is an integrity failure, not an automatic downgrade.
- Stop: no partial batch is retained. Previously completed batches remain for the
  same manifest. Changed revision/hash/metadata/byte length discards incompatible
  partial state. Protocol/checksum failure clears partial state as before PR106.
- Reload/close: in-memory partial progress is lost; stored originals are untouched.

## Diagnostics

Existing `evidence_load`, `transfer_request`, `backoff`, retries and errors remain.
Added fixed counters: `batch_requests` (including attempts), `chunks_acquired`
(validated new chunks), `download_bytes` (binary body bytes read, including framing
and partial/repeated attempts), `reused_chunks`, `batches_1` through `batches_8`
(successful batch-size histogram). `batch_validate` includes framing, per-chunk
hashing and payload-copy wall time. It is not a CPU measurement. Error/login body
bytes, HTTP headers and wire compression are not included in `download_bytes`.
No IDs, URLs, original bodies, answers or credentials enter these diagnostics.

## Controlled TRDE120 comparison after review

1. Keep the PR105 timing files and select the exact same retained comparison and
   evidence revisions. Record the operator actions and record/byte/chunk counts.
2. On production PR105, open a fresh tab, enable Performance diagnostics **before**
   loading the stored comparison, perform one predefined load sequence and export
   `CTI-performance.json`. Do not capture the course or alter any saved record.
3. After an approved release, repeat that sequence in a fresh tab on PR106. Confirm
   the same record versions, original byte totals and unchanged report findings.
   A different input set or resumed partial cache is not a comparable workload.
4. Repeat a few alternating baseline/candidate trials only on authorized builds
   serving the same immutable records, if both are available. Do not change the
   production deployment just for benchmarking. Otherwise label the sequential
   before/after test and note network/time differences.
5. Send both diagnostic JSONs with build, action sequence, whether interrupted,
   and cold/resumed state. Compare batch/individual request counts, binary bytes,
   validation/backoff/load durations and reused chunks separately. Do not add
   nested/overlapping stage durations. No course bodies or console logs required.

Expected request count is one manifest plus `ceil(parts/8)` per successful record,
versus one manifest plus `parts`; session, listings, retries and other workspace
requests are separate. The previous TRDE120 benchmark's 1,048 requests is not the
955-chunk synthetic workload. No live TRDE120 elapsed-time gain is claimed.

## Reproduce tests and measurements

- `node tests/workspace-download-batch.test.mjs`
- `node --test tests/workspace-download-resume.test.mjs tests/workspace-http.test.mjs tests/shared-store.test.mjs tests/shared-upload-resume.test.mjs tests/provider-runtime.test.mjs tests/performance-diagnostics.test.mjs`
- `node tools/browser-workspace-download-check.mjs` (optional `CTI_CHROMIUM_PATH`)
- `npm run test:worker:workspace` (isolated local workerd/D1; no production access)
- `node --expose-gc tools/benchmark-workspace-download.mjs receipt.json`
- Add `--native-blobs` after the filename to reproduce the native-byte counterexample.
- Full `npm test`, build, worker build and mandatory hosted browser gates.

Benchmarks and actual outcomes are recorded in the PR and accompanying receipts.

## Measured results

The exact modeled workload contains 25 records, 125,172,835 bytes and 955 chunks
(5 records with 39 chunks, 20 with 38). Each record has one manifest. Session
initialization is one additional request in each run, excluded from this table.

| Measurement | Individual | Batch 8 |
| --- | ---: | ---: |
| Record HTTP request calls | 980 | 150 |
| Counted D1 statements in SQLite fixture | 2,915 | 425 |
| Median elapsed, D1 BLOB number-array representation | 7,037.488 ms | 3,902.836 ms |
| Median elapsed, native SQLite BLOB byte arrays | 963.649 ms | 5,505.259 ms |

Request reduction is **84.69%**. Both six-trial receipts are retained; three
alternating trials per mode. The in-process fixture has no socket/network delay.
The first run's cheap native BLOB representation is explicitly retained as a
counterexample: batch framing/hex processing can lose on a low-overhead backend.
D1's number-array representation is simulated in the second fixture, not claimed
as a remote D1 measurement. Batch validation median there is **549.145 ms** across
all 25 records. Original SHA-256 matches in every trial. Diagnostics are enabled
in both modes; existing retry/resume invariants are tested separately.

Sampled process RSS in the D1-shaped fixture was 612.7–647.2 MB for individual and
555.9–575.3 MB for batch modes (decimal MB). ArrayBuffer samples peaked between
28.7–33.7 MB and 25.1–36.1 MB respectively. These include SQLite fixture data and
retained output objects, are not isolated client/Worker peaks, and 5 ms sampling
can miss transient peaks. They do not establish production memory headroom.

The separate **actual local HTTP/workerd/Durable Object/D1** paired run measured:

| Original | Individual requests / elapsed | Batch requests / elapsed |
| --- | ---: | ---: |
| 10,489,856 bytes / 81 chunks | 82 / 1,525.853 ms | 12 / 406.286 ms |
| 33,554,432 bytes / 256 chunks | 257 / 4,913.683 ms | 33 / 1,243.339 ms |

These include manifest and full hash, exclude JSON interpretation, run individual
first, and are one paired local run rather than a live-course speed guarantee.
Largest observed frame: 1,049,163 bytes. Per-request D1 statements are bounded at
three; runtime CPU and per-request heap were not reliably observable. The existing
maximum-size upload/commit, access, stale-basis and optimistic-conflict checks also
passed through the same runtime. No account or production database was contacted.

Receipts:
- [Native-byte SQLite counterexample](audits/download-batching-native-bytes-pr106.json)
- [D1-shaped alternating fixture](audits/download-batching-d1-shape-pr106.json)
- [Actual local Workers/D1 run](audits/download-batching-workerd-pr106.json)

The observed benchmark request reduction supports this narrowly scoped change.
The added client digest work and bounded memory costs remain real. A controlled
live comparison is required before claiming the earlier 260.65/282.37-second
TRDE120 measurements have improved.
