# Public publisher-image fallback: v1.8.4

The supplied TRDE120 v1.8.3 capture retains all 96 inventory entries and 38
unique publisher originals: 29 chapters and nine book sections. The 29 chapter
response strings remain byte-identical to the previous v1.8.2 capture. Native
completion remains 39/96, including 38/65 readings and 0/26 assessments.

Its 346 distinct literal image URLs have no downloaded original bodies. Every
image attempt reports an unreadable browser result without an exposed HTTP
response. Those observations cannot distinguish CORS, CSP and network failure.
The 191 distinct srcset notices concern responsive alternatives to selected
primary images; they are not 191 additional missing primary image originals.

## Acquisition and ownership

The maintained bookmark still tries the ordinary credential-free browser image
GET first. Only a blocked or unreadable result can select the existing CTI
helper tab. An exposed HTTP failure, redirect, MIME mismatch or invalid file
signature cannot trigger the service fallback.

The authenticated helper adds one closed `publisherImage` operation. It sends
only the observed numeric-book target, literal public upload URL and publisher
JSON hash to `/api/provider/publisher-image`. The service accepts two existing
publisher hosts and supported raster upload paths, rejects redirects and query
or fragment-bearing image URLs, and sends no publisher cookies or caller
headers. A challenge remains a failed source read. The supplied publisher hash
is client context, not server attestation of native ownership or source content.

One bounded public GET must complete within 20 seconds and 16 MiB. The service
requires supported MIME, identity encoding, complete framing and a matching
file signature, then hashes the actual bytes before sending a successful media
response. The bookmark independently checks the source hash, declared size,
actual EOF, signature and SHA-256 before saving an original in the existing
IndexedDB and ZIP paths. Archive intake independently reconstructs native
provider ownership and verifies the actual file bytes. A successful service
HTTP response alone never establishes a saved image.

The service allows one image transfer alongside the existing global provider
limit. Both helper ends serialize image work, retain the two-job mixed limit,
and enforce separate core/image request caps with the existing 512 MiB relay
budget. The original-media 16 MiB/file and 512 MiB/course limits remain. A
validated completed service read is charged once even when the relay later
fails or a media check rejects its body. Cancellation releases held work.

Successful receipts retain the browser completion time and service/upstream
context separately. A failed fallback retains its unreadable browser attempt
and the subsequently exposed service result without manufacturing upstream
HTTP observations. No Panopto, Coursera or publisher login is sent to the
publisher-image service. The operation is unavailable on stale helpers rather
than silently sending requests through an incompatible protocol.

## History and presentation

The exact released v1.8.3 build joins the reviewed checkpoint recovery list.
Continuation rechecks current native bindings before reusing captured content,
preserves prior assessment observations and dates, and keeps older image
originals with their original source JSON when a refresh fails. A failed final
native check cannot attach new images to an item. Existing browser-image
projections and the supplied v1.8.3 inline projections remain byte-compatible.

The progress card separates responsive-alternative notices from missing image
sources. Content views show service acquisition context as a partial observed
source, without silently loading remote images or upgrading whole-widget or
native completion. Raw source strings and warning codes remain retained.

## Remaining observed gaps

Six publisher URLs remain unresolved in the supplied capture. Five returned
API HTTP 404 and one HTTP 401; attempted HTML fallbacks did not recover them.
These responses do not establish that lesson content is absent.

The native assessment gaps also remain distinct from image acquisition.
Seventeen have no established complete assessment source, five have incomplete
source/coverage and four have unsupported authoring atom state. Four question
definition models are already retained but unsupported by normalization.
Twenty-seven readings are unverified, including 24 unsupported CML media
references, one unfetched external attachment and two unsupported atom states.
Nothing in this release invents replacements or certifies those items.

## Validation scope

Focused tests exercise closed request scope, authentication/delegation,
redirect/challenge/MIME/signature failures, exact byte/hash/context checks,
request and byte limits, cancellation, history and source revalidation.
The maintained no-network workerd fixture includes the new image provider;
the maintained browser fixture follows the real helper protocol into archive
intake, including malformed headers, changed bytes and failed final bindings.
Hosted release receipts record actual execution and publication separately.
Synthetic fixture success cannot establish that all live publisher images are
publicly available; that requires a subsequent retained user capture.
