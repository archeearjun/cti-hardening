# Coursera inline-widget reader: observed request and bounded public HTML

The supplied complete HAR contains 168 requests and 162 response bodies. The
exact configuration GET for the current Area reading uses the existing
`authoringWidgetSessionProviders.v1` `getWithCourseId` finder with the full
versioned CML widget reference as `widgetSessionProviderId`. The current bound
draft CML independently contains that reference. The response returns its base
provider ID, explicit course ownership, and actual configuration/page URLs.
Linked summary examples are unrelated template content and are excluded.

The HAR contains one configuration GET, not a stable acquisition pair. It is
engineering evidence for the request format; it is not inserted into an older
capture or presented as a completed new course extraction. No preview POST is
necessary or reproduced. Credentials, session IDs, account identities and
request headers from the HAR are excluded from committed fixtures and reports.

## Version 1.8.0 behavior

The main bookmark discovers supported inline widget references inside current,
identity-bound reading and discussion CML. It keeps each full requested selector,
including its version, and each owning course/item/atom placement. Two current
provider GETs and the final atom check guard reuse. Returned base IDs do not
independently assert the requested provider revision. Import and content review
recompute native model hashes and rederive exact target URLs from the proof.
Repeated placements keep their own identities. Unsupported or missing native
selectors remain explicit gaps.

For exact configured public-book URLs on `opentextbc.ca` and
`pressbooks.bccampus.ca`, the same capture can request the original static HTML
through CTI's existing authenticated provider window and private service route.
The upstream read uses public GETs without cookies or forwarded authorization,
with a closed URL policy, at most three redirects inside the same book, a
20-second deadline and a 1 MiB decoded HTML limit. Strict UTF-8 round-trip, exact
decoded byte count and SHA-256 are required; unsupported encodings, login pages,
credential-bearing content and failed reads stay unresolved.

Original HTML is retained losslessly as a separate field inside the compressed
capture manifest, with an 8 MiB retained-HTML budget across course placements.
It is not counted as an archived image/video or an additional original binary
file. The provider JSON envelope length/hash and the upstream HTML length/hash
remain distinct. Provider and client clocks are recorded separately; transport
declarations are context, not cryptographic attestation.
The service declares the canonical decoded envelope length separately from
HTTP wire length, so browser compression and private-runtime stream forwarding
cannot substitute a different framing identity.

The owner view keeps this content separate from the native Coursera text field.
It displays static text and literal original HTML without running page scripts
or mounting the original page. Saved projections independently rederive their
course/item ownership, configuration, original HTML bytes and hashes before
showing content. Readable reports include the partial static content; JSON keeps
the source proof.

## Limits retained

Static HTML does not establish captured image/video/caption bytes, executed
H5P or other activities, course launch, learner behavior or whole-widget
completion. It cannot increase normalized Coursera question totals or turn an
unverified reading into a complete item. External providers outside the closed
scope remain configured targets with explicit acquisition gaps. Current
published asset bodies, manual question bodies and unsupported CML are separate
reader gaps.

Historical captures keep their original data, statuses, builds and observation
times. New configuration and public-page observations require a fresh capture
with this bookmark; importing the earlier file cannot create them. The existing
Brightspace capture remains a valid comparison baseline.

## Bookmark delivery

The source-preserving console program remains unchanged by delivery formatting.
A parser generates a separate compact bookmark copy at build time, with
compression, dead-code removal and name/property mangling disabled. The program
is never executed by that formatter. There is no runtime decompressor, dynamic
code loader or extension requirement. The existing strict 500 KiB bookmark
address limit remains in force.

Synthetic collector, importer, backend and browser tests are engineering checks.
They do not certify a new private live-course capture or complete external
provider coverage.
