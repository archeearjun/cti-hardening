# Automatic external source question definitions

## Evidence and change

TRDE120's Percentage, Decimals and Working with Units source activities are
Brightspace HTML wrappers embedding BCcampus pages. The existing Brightspace
extractor deliberately reads same-origin course/API definitions only. It records
external URLs without fetching them. Native Brightspace quiz definitions already
feed the comparison; these external activities had no captured bank total.
Requiring owners to type their expected count was a fallback, not an adequate
normal workflow. This was a confirmed feature gap in the source-count workflow.

The item card now offers **Fetch source questions** for supported recorded public
source links. The authenticated Pages endpoint reads H5P QuestionSet definition
JSON from the exact link, follows bounded same-book redirects and explicit H5P
frames, and derives the bank count and configured selection size. No counts or
course IDs are hardcoded in the parser. The read-only public probe uses three
observed source URLs solely as integration examples.

Live probe on 2026-10-04 read the actual H5P JSON:

| Source | Bank definitions | Configured subset size |
| --- | ---: | ---: |
| Percentage | 10 | 10 |
| Decimals | 11 | 10 |
| Working with Units | 9 | Not declared |

These are source-definition observations, not proof of learner launch, correct
answer fidelity or working interactions. In particular, Decimals has an
11-question bank and a 10-question selection setting. The previous offline-list
count alone did not establish its delivered length.

## Boundaries

- Existing verified Cloudflare Access authentication, editor/admin role and
  same-origin POST guard apply. No anonymous proxy or new credential handling.
- Public HTTPS providers are limited to `opentextbc.ca` and
  `pressbooks.bccampus.ca`; redirects stay in the same book. Only public chapter
  URLs and the explicit read-only H5P embed endpoint are allowed. Arbitrary
  queries, hosts, ports, credentials, private IPs and other admin actions fail.
- Outbound requests are GET-only with no cookies, tokens or incoming headers.
  JavaScript from source pages is never executed. Only standard JSON assignment
  data emitted by the H5P WordPress integration is parsed.
- Limit: 20 seconds, six requests, 3 MB per document / 6 MB total, 1,000 question
  positions, bounded prompts. Unsupported, inaccessible, incomplete, conflicting
  or multiple banks do not become zero or a complete count. Question selection
  settings remain separate from bank length.
- Successful evidence stores source identity/link, timestamp, parsed positions,
  library types, selection setting and document hashes. It stays scoped to the
  exact saved report/source link. It does not alter the original audit or clear
  findings. Failed/cancelled refreshes preserve prior saved evidence.
- The UI offers elapsed time and cancellation. Text/JSON/clipboard exports read
  full saved records and include the automatic source observation.

Native Brightspace definition extraction remains unchanged. Other external
providers and dynamically created/runtime-only H5P data remain unverified. Team
API configuration and existing authentication are required for the public fetch;
no paid Browser Run infrastructure is involved. Manual references remain a
fallback. Existing source captures can be reused; a new full-course extraction
is not required for these already-recorded URLs.

## Verification

The [content comparison](content-evidence-comparison.md) extends this reader to
retain longer prompts, choices, observed media references and partial static page
text. `PARTIAL` responses expose useful captured content without declaring a
complete bank. A complete saved bank survives a failed or partial refresh.

Regression checks cover typed JSON parsing, bank versus selection count, explicit
zero, unsupported and multiple banks, safe redirects/hosts/query routes, denied
access, response size/request limits, cancellation, record scope and source
identity, and existing authentication/role/origin enforcement. The owner browser
check exercises automatic fetching, persistence/reload/exports, and a failed
refresh preserving a previously successful source bank. The public probe reports
real provider outcomes separately from deterministic test assertions.

Schema reference: `h5p/h5p-question-set/semantics.json` (questions, poolSize and
randomQuestions) and `h5p/h5p-wordpress-plugin/public/class-h5p-plugin.php`
(H5PIntegration.contents and jsonContent). `poolSize` is the selected subset size,
not the number of stored definitions.
