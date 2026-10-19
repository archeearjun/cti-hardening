# Exact-ID publisher back-matter sources

The supplied TRDE120 v1.8.4 capture retained 38 of 44 publisher API sources.
Five targets returned chapter 404 and part 404. Independent public navigation
resolved four exact numeric targets to back-matter pages. One also demonstrated
why an iframe title is not source identity: book 1 post 227 was labelled
“Versioning History” in the configuration but resolved to “Times Tables”.
These observations do not establish what the intended source outline requires.

Pressbooks registers a distinct `back-matter` post type, REST base and canonical
rewrite slug. Its controller uses `pressbooks/v2` and inherits the numeric
WordPress GET route. The inherited controller returns 404 when the requested
post exists with another post type, so two wrong-type 404s do not prove absence.
The implementation contract is pinned to primary source:

- [Pressbooks registration](https://github.com/pressbooks/pressbooks/blob/70053a64934a5dcffdffb2cff67b2a945db271ba/inc/posttype/namespace.php#L119-L140)
- [Controller namespace and inheritance](https://github.com/pressbooks/pressbooks/blob/70053a64934a5dcffdffb2cff67b2a945db271ba/inc/api/endpoints/controller/class-posts.php#L5-L15)
- [Numeric GET route](https://github.com/WordPress/WordPress/blob/bd3d22b035332acc9084ac4e2834ac010a2afbd8/wp-includes/rest-api/endpoints/class-wp-rest-posts-controller.php#L112-L126)
- [Wrong-type 404](https://github.com/WordPress/WordPress/blob/bd3d22b035332acc9084ac4e2834ac010a2afbd8/wp-includes/rest-api/endpoints/class-wp-rest-posts-controller.php#L552-L565)
- [Separate public raw/rendered fields](https://github.com/pressbooks/pressbooks/blob/70053a64934a5dcffdffb2cff67b2a945db271ba/inc/api/endpoints/controller/class-posts.php#L173-L200)
- [Protected-content guard](https://github.com/pressbooks/pressbooks/blob/70053a64934a5dcffdffb2cff67b2a945db271ba/inc/api/endpoints/controller/class-posts.php#L78-L96)

## v1.8.6 behavior

The existing bookmark makes a third public GET to the documented same-book
`wp-json/pressbooks/v2/back-matter/{id}` only after exposed, credential-omitting
chapter and part 404s for the identical captured numeric ID. It retains both
closed 404 receipts. Authentication failures, challenges, unreadable responses,
credential retries and invalid successful JSON never trigger this type switch.

Accepted responses must independently match the ID, `back-matter` type,
published status, unprotected fields, same-book canonical link and any retained
self-link. Original UTF-8 bytes, BOM, raw and rendered fields, SHA-256 and dates
remain separate from inert display text. Original-image ownership is recomputed
from this typed source and the native widget binding; failures remain failures.
No publisher response establishes native or whole-widget completeness.

The original chapter/part projections and historical original timestamps remain
unchanged. The lightweight diagnostic permits three requests instead of two;
existing body, total-byte, timeout and full-capture request bounds remain.
The single saved bookmark continues to use the same reader and archive path.

The official contract and browser fixtures establish reader behavior. They do
not certify that these course IDs are currently accessible. Hosted discovery
of both public API indexes received explicit Cloudflare challenges; no challenge
was retried or solved and no new course response was obtained in that probe.
The supplied v1.8.4 capture therefore remains 39/96 natively verified, with
zero of 346 selected publisher image sources saved. See the separate
[challenge audit](coursera-publisher-challenge-2026-10-19.md).
