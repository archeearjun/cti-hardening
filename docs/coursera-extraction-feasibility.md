# Coursera extraction: feasibility and evidence limits

Assessment dated 12 October 2026. The requirement is complete course evidence in
the operator's authenticated local Chrome, without installing an extension,
requiring local Node/Python, or paying for a remote browser.

The v6.15.26 adapter uses the two read resources established by the real
response sample. Per-item request observation is optional metadata, rather than
an activation prerequisite. The complete live group IDs, ordinals and certified
editor still establish the inventory; every returned versioned definition and
key must satisfy the same strict coverage requirements. Fresh exact-item routes
and fresh generic-address modals have separate identity certificates.

The live workflow is **not yet proven scalable**. The latest v6.15.25 screenshot
shows 71 minutes on item 1/167, only 12/100 questions in the current document,
18 saved observations in the controller and one recovery. The corrected
structure diagnostic confirms the expected project-item route, one sidebar,
compound group IDs and real group-resource requests. These observations rule
out treating the delay as a successful full-course capture.

Two further implementation gaps were found: requiring both endpoint families
to be rediscovered can permanently fall back to editor traversal for cached or
delayed requests, and counting attempts/restorations or fluctuating current
question subsets as progress can extend a reload loop. v6.15.26 removes the
endpoint gate, preserves saved-count reporting and stops after three batches
without advancement in durable evidence. These fixes require a new authenticated
live-course result before scalability or complete extraction can be certified.

## What the existing captures establish

The supplied Technical Drawing captures were inspected locally without publishing
their question text or answer keys.

| Capture | Structural inventory | Complete items | Assessment questions captured / declared | Assessment evidence |
| --- | ---: | ---: | ---: | --- |
| v6.15.14 | 188 | 81 | 3,007 / 3,007 | 27 DOM-derived models; 62 inventory items unvisited |
| v6.15.17 | 188 | 155 | 3,825 / 4,007 | 32 DOM/editor-derived models; 33 inventory gaps |

The v6.15.17 JSON preserved substantial usable evidence. Its terminal
`INVENTORY_FINISHED` state meant the acquisition process ended, while its strict
capture accounting remained incomplete. It was not a complete 188-item course
capture. The older files contain observed question identities and positions,
but no retained original assessment response bodies or complete loaded question
definitions from which to derive an exact API parser.

Two implementation defects have been identified separately from Chrome crash
recovery: a usable selected loaded model can be rejected because unrelated graph
search reaches its budget, and question candidates are deduplicated by prompt
instead of source identity. The real v6.15.17 corpus contains 40 repeated-prompt
groups with distinct Coursera question IDs; 32 groups have different answer keys.
Equal prompts therefore cannot safely identify a question. Corrections must
preserve distinct IDs and retain conservative matching when identity is absent.
These fixes do not establish that every live quiz exposes a complete loaded model.

Coursera's **Export outline** was reported to generate an XLSX successfully. CTI
uses that workbook for item types, names, IDs, and placement. No supplied workbook
or verified public contract establishes that this export includes complete
questions, answer keys, feedback, media bytes, or external tool content.

## What the 12 October response sample establishes

The operator supplied 20 observed GET responses containing **ten question groups
and ten complete native MCQ definitions, in 51,128 bytes of response JSON**.
The group resource was `authoringAssignmentQuestionGroups.v1`; the definition
resource was `authoringAssignmentMachineEvaluableQuestions.v1`. Every group
supplied one exact versioned question reference, and all ten references matched
returned definition IDs. This is actual authenticated Coursera evidence, rather
than a synthetic API fixture or a naming convention inferred from documentation.

The MCQ definition contains the original CML prompt, an array of options with
stable option IDs and original CML displays, and a `correctOption` string that
matches one option's ID. All ten answer keys therefore have explicit API
evidence. Eight definitions match identities, prompts and options in an older
capture whose answer keys were `NOT_OBSERVED`; the new responses supply those
missing keys. The option feedback fields are present but explicitly empty in
this sample. Their presence does not establish nonempty feedback.

This proves a useful question-definition acquisition path for this observed
MCQ schema. It does **not** supply a complete assignment root, all 100 ordered
groups, an item-to-assignment relation, every quiz type, or the whole course.
All sampled groups have one variant; selection and ordering for multiple
variants remain unverified. Credential fields present in response envelopes
are unnecessary for read-only capture and must be excluded from retained or
exported evidence. Private identities, wording and credential values are not
included in this public document.

## Options under the restrictions

| Option | Fits the restrictions? | What it can improve | Remaining limit |
| --- | --- | --- | --- |
| Native XLSX outline | Yes | Fast authoritative structural inventory | Full assessment/content export is unverified |
| Console or saved DevTools Snippet | Yes | Runs code in the existing authenticated page | Same renderer and editor workload; a Snippet must be run again after reload |
| Protocol monitor registration with checkpoints | Yes | Reinstalls the canonical program on new documents; enables automatic resume | Does not move parsing or editor rendering out of Coursera's renderer |
| Separate CTI supervisor tab | Yes | Detects lost heartbeats and navigates a crashed managed tab | Recovery preserves work; it does not make slow acquisition fast |
| Loaded quiz definitions matched to live IDs | Yes, when available | Can skip most question-editor activations | Actual model shape, identities, completeness, and answer fields must be observed |
| Observed group/question API reads after opening a quiz once | Yes; native MCQ schema confirmed by the real sample | Can obtain original prompts, options and explicit keys without activating every question editor | Requires a complete live ordered group inventory; batch support, other types and multiple variants still need verification |
| Authenticated API acquisition in a lightweight Coursera-origin tab | Browser mechanism proven; full-course path pending | Can fetch confirmed definitions without loading the large React editor | Full course-to-item-to-assignment relations, ordering and unsupported content remain unverified |
| Web Worker and browser file storage | Yes, where supported | Offloads suitable parsing; writes evidence incrementally | Neither supplies missing definitions nor reads editor DOM; storage and permissions still apply |
| Local Playwright/CDP automation | Free software, but outside the confirmed restrictions | More direct browser orchestration | Requires a permitted local runtime/tool and an appropriate debugging profile |
| Extension or paid remote browser | Outside the requirement | Alternative orchestration environment | Not a solution within the operator's stated restrictions |

Console and Protocol monitor execute the **same canonical extractor**. Protocol
monitor is a registration/control surface, not a separate extraction engine.
Moving the command there addresses document lifetime; it cannot remove the cost
of opening and rendering thousands of question editors. Chrome documents
[Snippets](https://developer.chrome.com/docs/devtools/javascript/snippets) and
[Protocol monitor](https://developer.chrome.com/docs/devtools/protocol-monitor)
as ways to execute page code or send protocol commands. Neither promises complete
Coursera content acquisition.

## Request-based acquisition and the remaining evidence

The next implementation uses the existing managed local-browser workflow. It
opens a quiz once, certifies the active editor against the course item, and
collects its complete ordered live outline. That outline supplies actual group
identities and positions. It then reads the observed group endpoint, follows
the group's exact versioned question references, and reads the observed
definition endpoint. For the confirmed MCQ schema, `correctOption` resolves
against option IDs and original CML is retained. It does not need to open each
question to infer its answer key from rendered badges.

Small batches of up to 15 observed IDs use Naptime's documented collection GET
syntax, `?ids=<comma-separated-identities>&fields=<selected-fields>`. A returned
array is not an ordering contract: results are matched by exact ID and ordered
using the live outline. Naptime documents the batch route, but that does not
prove every private authoring resource implements it. Unsupported batching or
missing batch members fall back to the observed single-resource GET shape with
bounded retries; they cannot be treated as complete responses. No unobserved
question ID, revision, finder or collection-wide enumeration is invented.

Naptime combines requested fields with default fields. Its documented negative
field selection can exclude `writeAccessToken`; reads request the content fields
and explicitly exclude that credential field. Returned credential fields must
still be removed before retention, even if a server ignores the projection.

The API fast path requires the full live outline, matching returned identities,
one supported question definition per group, and complete required fields and
keys. Multiple variants, unsupported types, conflicting identities, unavailable
responses or an incomplete outline keep explicit gaps and use the existing
observed DOM fallback. Missing source inventory cannot be repaired by sorting
response arrays or assuming that ten sampled definitions represent 100
questions. Item checkpoints and the strict final completion gate still apply.

The response-sample tool is now a troubleshooting aid for a missing or changed
schema. The supplied sample is sufficient to implement this native MCQ adapter;
another diagnostic rerun is not a prerequisite for using that adapter.

A further direction is to acquire the whole course using the signed-in browser's
same-origin requests in a lightweight document that does not render the course
editor. A document opened as `about:blank` by a
Coursera-origin script can inherit that origin. Same-origin `fetch` normally
sends the origin's credentials without copying the cookies into CTI. These are
documented browser capabilities, and a local browser prototype verifies the
mechanism: a loopback fixture opened a blank tab, fetched its fixture API with an
HttpOnly session cookie, and loaded no authoring application in the new tab.
That test used no real Coursera session or schema. It did not prove crash
isolation: same-origin tabs may share a renderer. A lightweight tab reduces
editor work; it is not automatically an independent crash supervisor. These
results do not establish complete item relations or definitions for every
content type. The real sample separately confirms the two native assessment
resources described above.

For unsupported or changed schemas, the bounded response-sample tool observes
the page's existing fetch/XHR
traffic while the operator opens one quiz. It makes no additional requests,
does not collect cookies, request/response headers, or request bodies, and is
limited to five minutes, 40 bodies, 6 MiB per body, and 12 MiB total. It retains
complete JSON response text from fetch streams and text-mode XHR within those
limits. Parsed `responseType="json"` and binary XHR are declined because their
original text is unavailable; reserialization is not claimed to be lossless.
Opaque GraphQL endpoints whose operation and course identity appear only in the
request body are excluded without verified endpoint/course scope.

The observer cannot recover past responses. Install it before opening one quiz
through the course's normal in-page navigation, and download the sample before
reloading or leaving the page. An empty sample or declined bodies may require
Chrome Network's **Copy response** as a focused fallback. The sample stays
local and contains selected bodies plus scoped route metadata. Response bodies
can still contain private course content or other sensitive fields; omitting
headers is not a universal sanitization guarantee. This is diagnostic evidence,
not a course-audit capture.

For an editor-free whole-course path, the remaining evidence must bind every
course item to its assignment and ordered groups, account for text blocks and
other native question types, and establish how pagination, drafts, variants,
media references and permissions affect completeness. The confirmed MCQ
resources do not supply those missing relations by themselves. Endpoint names
and relationships must not be invented from a framework's naming convention.

Acceptance requires the actual course to finish with every inventory item
accounted for, exact observed question identities/counts, required keys or an
explicitly observed reason they do not apply, and retained content/media gaps.
Course mutation during capture, inaccessible external tools, and unavailable
media must remain explicit. They cannot be turned into a complete result by
raising a confidence score or weakening the verifier.

## What the tests establish

The Chromium fixtures exercise the canonical parsing/checkpoint program,
supervision, crashes, and final-file behavior. They supply synthetic course
responses and substitute actual Coursera navigation and stability boundaries.
Their question counts and crash recoveries demonstrate those tested mechanisms;
they are not throughput benchmarks for this private course. The real sample
confirms the native MCQ definition schema and explicit keys; authenticated
whole-course acceptance and an editor-free course inventory remain unverified.

## Browser documentation and scope

- [MDN same-origin policy, inherited origins](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#inherited_origins): why a Coursera-created blank document can inherit Coursera's origin; cross-origin CTI cannot simply read authenticated Coursera responses.
- [MDN Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch): request/response processing and same-origin credentials; authentication does not itself prove an endpoint returns full definitions.
- [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers): worker execution and lack of direct DOM access.
- [Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) and [MDN origin-private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system): incremental local persistence, with API support and permission requirements.
- [Chrome remote debugging changes](https://developer.chrome.com/blog/remote-debugging-port): modern external debugging requires a non-default user-data directory; it is not an installation-free connection to any existing work profile.
- [Coursera Naptime multiGet documentation](https://github.com/coursera/naptime/blob/gh-pages/gettingstarted/index.md#multi-get) and [request builder source](https://github.com/coursera/naptime/blob/master/naptime/src/main/scala/org/coursera/naptime/actions/RestActionBuilderTerminators.scala): collection GET requests with comma-separated `ids`; framework support does not certify an individual authoring resource.
- [Naptime routing test](https://github.com/coursera/naptime/blob/master/naptime/src/test/scala/org/coursera/naptime/router2/NestingCollectionResourceRouterTest.scala): multiGet binds IDs to a set, so returned array order must not be used as the course's question order.
- [Naptime field projection source](https://github.com/coursera/naptime/blob/master/naptime/src/main/scala/org/coursera/naptime/models.scala) and [field tests](https://github.com/coursera/naptime/blob/master/naptime/src/test/scala/org/coursera/naptime/ResourceFieldsTest.scala): requested fields are combined with defaults; negative selections remove default fields.

These sources establish browser mechanisms and their boundaries. They do not
guarantee complete acquisition of every Coursera assessment, plugin, external
service, or protected media resource.
