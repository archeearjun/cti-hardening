# Brightspace bookmark capture

The current Brightspace collector is **v1.2.0, schema 2**. Its primary delivery
is a saved **CTI Brightspace capture** bookmark. It reads supported source
evidence in the operator’s existing signed-in Chrome tab and downloads one `.cti.zip`
file containing a compressed manifest and the retained original files. It does not change the course or create replacement content.

## Operator workflow

1. Open **Source LMS** in CTI, or choose **Brightspace extractor** in the capture
   tools. Both locations offer the same maintained bookmark.
2. Show Chrome’s bookmarks bar with Command+Shift+B on Mac or Ctrl+Shift+B on
   Windows. Drag **CTI Brightspace capture** onto it. Alternatively, use **Copy
   Brightspace bookmark address**, create or edit a bookmark, and paste the
   complete address into its URL field. Update an older bookmark’s URL once.
3. Open the matching Brightspace course Home or Content page in the Chrome
   profile already signed in to that course. Use the saved bookmark, choose
   **Capture/resume** on its card, and keep
   the course tab open while capture runs. DevTools can stay closed.
4. Return the downloaded source `.cti.zip` to CTI. Inspect the course identity,
   retained sources and gaps before selecting it for comparison. Earlier source JSON
   captures remain accepted as historical inputs; leave the new archive zipped.

Clipboard denial does not shorten or remove the address. **Complete Brightspace
bookmark address copy fallback** contains the full selectable address. The
separate **Console fallback (optional)** retains the script copy and download
controls for browsers that block bookmark execution. An extension is not
required.

## Retained evidence and its boundaries

Supported same-origin HTML and text topics retain their original response bytes
and a separate decoded projection. HTML source remains separate from extracted
text; SRT and VTT retain their original caption text and timing syntax. Source
characters, empty responses and failed reads must not be replaced with generated
content. A projection can remain unresolved even when its original body was
retained successfully.

The reader inventories references from HTML, including images, file links,
embedded media, tracks, posters, source sets and inline style URLs. Supported
same-origin file references can retain their binary originals within the
bounds below. Each acquisition records its requested and observed response URL,
HTTP status, observation time, actual byte length and SHA-256. Native source
bindings identify the relevant topic, module, quiz, assignment or discussion.
When an unencoded response supplies Content-Length, the reader requires the
received body to match that declared length before retaining it as complete.
Compressed wire lengths are not compared to Fetch's decoded response bytes;
responses without a length still receive actual byte counting and bounds.
The same body may be stored once by hash while its distinct course placements
and source bindings remain separate. Matching titles do not supply identity.

Version 1.1.1 also reads the specific same-origin Brightspace temporary image
view route ending in an image extension, semicolon filename and `/View`.
Malformed or encoded wrappers, unexpected query strings and HTML error pages
remain rejected. This adds a supported source location; successful body reads,
original identity, visible appearance and media fidelity remain separate checks.

Static tab panels already present in an HTML document are included in its text
projection even when CSS hides them. The flattened projection does not preserve
tab-to-panel relationships, media position or content loaded by a later click.
External tool interiors require their own evidence.

External URLs, Panopto, Yuja, LTI quicklinks and unsupported dynamic tools remain
recorded references or gaps. The Brightspace collector does not launch an LTI
tool, navigate assessment pages, request learner attempts or retrieve an
external provider’s media. A captured wrapper or configured URL does not
establish its runtime content, playable video, caption completeness or learner
behavior. Coursera’s separate supported Panopto reader does not change this
Brightspace boundary.

Native quiz definitions and their API pagination receipts remain separate from
described exam lengths, pools and full question banks. In the supplied historical
capture examined during this work, **all 18 quiz banks remained unverified**:
16 quizzes returned no definitions and only 14 definitions were observed across
the other two. These are genuine source gaps. This release does not fill those
banks, infer that they are empty, or turn the reported exam length into captured
questions. An accessible definition API and current source evidence are needed
to resolve them.

## Original-file storage and archive delivery

Version 1.2.0 removes the all-bodies-in-one-JSON bottleneck. Each original is
verified and committed as an immutable IndexedDB Blob before its successful
receipt is published. The compact JSON checkpoint retains its SHA-256, length,
explicit archive path, native placement bindings and original observation dates;
it does not contain large BASE64 copies. The storage scope includes the exact
origin, native course ID, extractor build and attempt ID.

One ZIP_STORE archive contains `capture.json.gz` and deduplicated
`files/<sha256>` originals. Its checksums are written from bounded 1 MiB ranges;
export does not join all original bodies into one JavaScript byte array. Before
export, each saved Blob is checked against its descriptor and SHA-256. Missing,
changed or unreadable storage fails visibly rather than exporting a falsely
complete original. The capture card keeps a real **Save prepared capture file**
link available after preparation for browsers that block an automatic download.

The larger file, retention and read budgets below apply to this Blob/archive
transport only. They allow supported static files previously omitted at the
16 MiB file, 64 MiB retention and 96 MiB read bounds to be attempted without
bloating the 128 MiB JSON. This is a storage/transport change, not evidence that
those previously missing sources were captured. Update the bookmark and run a
new current capture to make fresh observations. Individual limits, unavailable
source URLs, dynamic tools, external providers and definition gaps remain
explicit. No content is generated or borrowed from similarly named items.

Original Blob storage is local to this browser and origin. Quota failures stop
the current attempt and retain prior committed originals; no failed write is
labelled successful. Browser storage availability is not guaranteed. Immutable
originals from older attempts are not automatically deleted, including when
old metadata checkpoints age out, so download captures and manage browser
site storage when space is needed. Clearing that storage removes local recovery.

## Recovery and freshness

Checkpoints are local to the Brightspace origin, native course ID, extractor
build and Chrome profile. They retain partial, paused or finished observations
for recovery and download, with their original observation dates and payload
hashes. Up to three attempts are retained per scope. Storage failures are
reported; the operator should download the in-memory evidence before closing
the tab if checkpoint storage is unavailable or full.

When the current build has no saved history, its recovery controls can offer
the exact known v1.1.1 checkpoint, or the v1.1.0 checkpoint when no v1.1.1 checkpoint exists as a historical download. That fallback is
read-only: original build identities, payloads and dates remain unchanged, and
current captures write into the new build's scope. An earlier checkpoint
remains a JSON download; it is not relabelled or rewritten as a v1.2 archive.

**Capture/resume re-reads metadata and original bodies on each current attempt.**
The saved checkpoint is not a cache that certifies unchanged sources or makes
historical reads newly observed. It provides recovery evidence and a saved
download; this release does not claim a fast cached refresh or reuse complete
question banks without checking them.

Earlier v1.0.8 captures remain historical evidence. They do not acquire missing
original bytes, fresh dates or stronger coverage claims when imported with this
release. Earlier audit and migration documents describe the versions tested at
their own checkpoints.

## Independent bounds

| Limit | Current bound |
| --- | --- |
| Complete encoded bookmark address | Strictly below 500 KiB |
| One retained text original | 4 MiB |
| One retained file original | 64 MiB (archive); legacy JSON remains 16 MiB |
| Unique retained original bodies | 512 MiB (archive), deduplicated by SHA-256; legacy JSON remains 64 MiB |
| Original-content reader observed response bodies per attempt | 768 MiB (archive collector) |
| Decoded HTML and text projections combined | 16 MiB |
| Original-content reader requests / discovered references | 800 / 2,000 |
| Original-content request deadline | 30 seconds |
| Expanded manifest JSON and checkpoint payload | 128 MiB |
| Complete archive artifact | 640 MiB |

The content reader counts bytes exposed by the browser’s decoded response-body
stream, including failed reads and the chunk that crosses a limit. This is not
compressed transfer or network-wire accounting. Retained bodies, projections,
metadata/API traversal and serialized JSON have separate bounds. Hitting one
bound leaves an explicit gap; a partial body is not saved as a complete original.
Checkpoint success also depends on available browser storage.

## Import and verification

CTI validates referenced original bodies against their actual archive bytes (or legacy BASE64), SHA-256,
length, receipts and native source bindings. It checks retained text metadata
and original-body consistency before accepting current evidence. A valid body
hash establishes consistency of the retained bytes; it is not a server
attestation, proof of a particular login, or proof of whole-course completeness.
Coverage, projection status, source fidelity and workflow approval remain
separate measurements.

The delivery helpers in `src/domain/brightspace-bookmark.ts` preserve the exact
generated standalone program using the shared URI-safe encoder and `void`.
There is no external JavaScript loader, runtime `eval`, compression bootstrap or
new extension dependency. `tools/generate-assets.mjs` validates the complete
address size before the app builds; the copy fallback is not truncated.

Relevant checks include `tests/brightspace-bookmark.test.mjs`, `tests/brightspace-body-archive.test.mjs`, the bounded
content-reader and checkpoint tests, import-integrity tests, and
`tools/browser-brightspace-bookmark-check.mjs`. Browser fixtures verify delivery,
retention and failure behavior. They do not certify a private course’s coverage,
SSO policy, question banks or external tool behavior.
