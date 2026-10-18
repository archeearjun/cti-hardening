# Publisher sections, original images and stable continuation: v1.8.3

## Observed TRDE120 evidence

The supplied v1.8.2 manifest contains 96 native inventory items, 39 verified
content items and 38/65 verified readings. Its native assessments remain
unverified (0/26); their observed models and three normalized question
occurrences are unchanged from the previous v1.8.0 capture.

There are 54 stable inline widget configurations across 24 readings. The new
capture retains 32 publisher response placements for 29 unique source URLs.
Independent checks reproduce each original UTF-8 JSON length and SHA-256 and
validate its native item/provider/source binding. These are partial publisher
observations, separate from native reading text and whole-widget completeness.

The screenshot's 14 HTTP 403 and one HTTP 404 refer to HTML fallback attempts.
Publisher API failures are different: 14 unique chapter-route HTTP 404 results
and one HTTP 401. Neither response set proves source content absent. Eight of
the failed numeric shortlinks have exact same-book `part` links in the retained
chapter originals: book 1 IDs 29, 75, 158, 199; book 2 IDs 22, 96, 125, 184.

The user subsequently supplied the real public part-125 JSON. It explicitly
reports `id:125`, `type:"part"`, `status:"publish"`, the canonical Perimeter and
Area part link, four authored outcomes and one literal JPEG reference under
`/oerdiscipline/wp-content/uploads/`. The observed payload is retained as a
regression fixture. It is user-pasted schema/content evidence, not an
independently verified original HTTP-byte receipt. A server-side public probe
received a Cloudflare challenge and obtained no part JSON. Neither event
establishes Coursera-origin CORS access to that part.

The 29 captured chapters contain 338 unique selected raster image/file URLs
(filename hints: 263 PNG, 74 JPG, one GIF). Their literal URLs are retained in
the source JSON, but the supplied capture has no owned publisher-image bodies.
Responsive `srcset` alternatives and 91 distinct Kaltura entry references do
not establish additional downloaded images, videos, captions or interactions.
One captured chapter is a video wrapper with no rendered lesson text.

The JSON upload declares 80 native original files totaling 34,178,798 bytes.
Their binary archive bodies were not included in this upload, so this audit
does not independently recertify those original files.

## Focused changes

The publisher reader retains the strict released chapter contract and adds a
separate part representation. Only an exposed chapter HTTP 404 can select the
same book's observed part API for the same native numeric ID. A part must have
the exact returned ID/type, published status, safe canonical book link and a
consistent self endpoint when provided. The chapter 404 receipt remains in a
bounded resolution history. This shares the existing two-GET and 20-second
job budget; it does not bypass a 401 or manufacture a status for an unreadable
browser response. A part remains partial API content, rather than a chapter,
an inferred set of child chapters or a completed widget.

Original image collection uses a separate publisher ownership contract. A
bounded inert tokenizer derives only actual `img.src` and linked raster-file
attributes from verified retained `content.raw` and `content.rendered`.
Comments and raw-text contexts cannot invent image owners. An image URL is
bound to the exact source JSON hash and literal occurrences. Cross-book upload
paths present in the source are allowed; guessed larger images and responsive
alternatives are not requested.

Image reads use ordinary browser CORS GETs with omitted credentials, no
referrer, redirects or retries. A readable 200 response, supported raster MIME,
matching file signature, actual byte size and SHA-256 are required before
the existing checkpoint/archive path retains an original. The unchanged
16 MiB file and 512 MiB shared original-media limits apply, alongside explicit
reference bounds. Captured images use the existing `files/<sha256>` Blob
storage and ZIP format. Archive import independently reconstructs source
ownership and validates actual file bytes before accepting those originals.

Each verified image is staged as an immutable local Blob before the next read,
and its temporary byte view is released. Staging does not assign accepted item
ownership. If the final native proof fails, an unreferenced local Blob can
remain in the bounded run store, but no new file reference or ZIP entry is
accepted for that item. The prior stable originals remain owned by their exact
historical source observations.

Mutable image URLs are freshly read on continuation. Failed refreshes preserve
older successful images with their original source JSON and observation dates;
old bytes cannot be rebound to a new publisher hash. A failed native final
check cannot displace the prior stable source tuple or attach an unowned new
image to it. Unretained attempt metadata remains an explicit diagnostic gap.
Report snapshots show owned file references and read outcomes; they do not
embed image binaries, silently load remote images or claim that rendering was
verified. Images and parts do not promote native completion.

Progress summaries now distinguish publisher API responses, attempted HTML
fallbacks and image sources. An HTML request skipped because an API original
was selected is not counted as a failed request. Original chapter projections
and text exports remain byte-compatible when new media evidence is absent.

The actual v1.8.2 run was fresh despite unchanged native identities and item
models. Four assignment-feature arrays arrived in another order. The existing
stability policy already treats those known flag sets as order-independent,
but resume selection compared only the raw root hash. Continuation now keeps
the raw-hash fast path and permits a narrow completed-gap fallback only after
recomputing retained initial/final raw hashes, their existing policy hashes and
the current normalized root. Real graph changes, unknown field changes,
invalid historical proofs and incomplete source envelopes still reject reuse.
Raw observations and historical timestamps are preserved.

The shared reviewed historical-build predicate also admits the exact released
v1.8.2 build. The update must not repeat the earlier historical-store exclusion.
Legacy renderer and Brightspace release families remain unchanged.

## Verification and remaining scope

Focused regressions cover the real observed part schema, unchanged released
chapter originals, exact source/image ownership, body and archive tampering,
historical retention, failed native validation, transport-specific summaries,
old snapshot compatibility and flag-order-only continuation. The generated
bookmark remains subject to the unchanged size guard. Real browser fixtures
exercise generated bookmark execution, CORS enforcement, real IndexedDB and
archive round-trips; full release checks must pass before publication.

These checks do not certify live image access, every remaining source URL,
video/caption retrieval, mathematical rendering, learner interactions or
whole-course completeness. Unknown, denied, missing and unverified sources
remain distinct. No authored content, image, question or answer is generated
to fill a source gap.
