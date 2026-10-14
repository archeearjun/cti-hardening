# Coursera extraction: feasibility and evidence limits

Assessment dated 13 October 2026. The requirement is complete course evidence in
the operator's authenticated local Chrome, without installing an extension,
requiring local Node/Python, or paying for a remote browser.

The v6.15.29 adapter uses the two read resources established by the real
response sample. Complete observed body parts can supply the ordered group
inventory when the sidebar mounts fewer links. Each group ID and ordinal must
be present in the DOM, unique, within the declared count, associated with one
assignment root and consistent with the current sidebar. No identity or order
is invented from a question number. Every returned versioned definition and
key must satisfy the strict coverage requirements. Fresh exact-item routes and
fresh generic-address modals have separate identity certificates; a missing
optional content test marker no longer rejects a structurally verified body.

The live v6.15.28 check verified **100 definitions and 100 explicit keys in
32.772 seconds**, using 202 GETs and 500,818 response bytes. Native quiz extraction
is therefore demonstrated within the stated restrictions. This establishes the
tested quiz's definitions and keys, rather than just its group inventory.

The full-course workflow is **not yet proven scalable**. A later run reportedly
reached Module 6 before an outline page appeared without a card or active run
lock. Its shared saved plan remained `RUNNING`, with 41 batches, zero stalled
batches, `FRESH_FULL_COURSE` and about 50 minutes elapsed. This establishes that
the inspected page was not executing the extractor, but does not establish
whether the actual managed child stopped. Plan metadata is shared across
Coursera tabs. CTI's **Show managed Coursera tab** and verified controller status
identify the supervised page. The exact Chrome cause remains unconfirmed.

The operator also reported the CTI status panel disappearing. The application
had a concrete lifecycle defect: unmounting the extraction component disposed
its supervisor. v6.15.29 moves that runtime to the loaded browser window. Panel
closure now only removes the UI subscription; acknowledgements and recovery
continue, and remounting restores the same child, command, course and status.
Explicit stop still closes the child. A full page reload destroys the runtime
and requires explicit saved-run recovery. The lifecycle defect is independently
reproduced; its role in the reported private-course stop remains unconfirmed.

The earlier bounded v6.15.27 check had found 100 groups but zero definitions and
keys, with rejected batch routes and individual definition 404s. Aligning the
single-resource request format in v6.15.28 resolved that quiz acquisition failure
in the reported live check.

The preceding managed run failed with 79 saved question observations, zero
finished visits and two recoveries.
A normally opened quiz subsequently showed one sidebar, zero marked content
bodies, 27 compound question links and 100 unique compound body group IDs with explicit
`assignment-part-0` through `assignment-part-99` ordinals. This establishes a
concrete mismatch with the certificate's old mandatory content marker and the
inventory's reliance on the smaller sidebar window. It does not establish that
all private definitions or the full course have been captured.

An earlier v6.15.25 run took 71 minutes on item 1/167. v6.15.26 removed repeated
endpoint discovery as an activation prerequisite and made continuation depend
on durable evidence progress. v6.15.27 adds the observed body inventory and
stops a recovery navigation that receives no new `READY` acknowledgement.
CTI now offers a bounded one-quiz Console API check and read-only saved-progress
Console export. v6.15.28 aligns single-resource requests with the working
original sample, including its literal version delimiter and query/field form.
v6.15.29 adds explicit saved-run recovery after confirmed execution loss. A new
managed command adopts the active same-course plan and matching checkpoints,
preserving its original namespace, clock, progress and limits. It does not start
fresh or silently reset a safety stop. The operator must register that replacement
command once because page JavaScript cannot reinstall Chrome's debugger command.
The next acceptance evidence is continuation from retained work, followed by
strict final-file verification. Full-course scalability remains an authenticated
live-course acceptance requirement.

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

The operator now permits one-time Chrome bookmark setup. A saved bookmark can
start a program in Coursera's own page context; a CTI hyperlink cannot inject
into that different origin. The universal **Bookmark course data check** reads
the two existing course resources without quiz visits and retains sanitized
original relation models. Version 3 follows with at most four bounded item
resource samples for one assessment and one reading using the exact atom IDs
declared by that validated material root. It is explicitly diagnostic and does not claim that
the missing full-course API path is implemented. See the
[setup and remaining prerequisite](local-coursera-extraction.md#bookmark-setup-and-the-full-course-data-prerequisite).

The actual 14 October bookmark check returned both course resources in **682 ms**,
72,478 bytes, with no failures. It retained 165 content items: 34 assessments,
123 CML reading references, six widget references and two discussion prompts.
The previous 185-item inventory contains the same leaf IDs, plus 18 empty tracks
and two empty modules. All 165 content items explicitly bind their item ID to
an atom ID and `contentId = atom~<atomId>`. For 26 older assessment API records,
the question-group owner matches the same item's fresh atom ID; the separate
versioned staff assignment reference does not match that owner. Historical
reading request paths also establish the two item-resource families with that
plain atom ID. Their bodies and query projections were not retained. The root
material supplies no question-group inventory, question ordering or content
bodies for those references. A fast course inventory therefore establishes a
promising data path, not yet a fast complete-course capture.

The second actual check completed all six GETs in **1.619 seconds**, with no HTTP
failures. However, the four atom/relation responses were **70-byte ID-only
projections**. They provide neither question lists nor reading bodies. The
updated reader requests the official Naptime `X-Coursera-Naptime-Fields: ALL`
header with `includes=_links`; the latter supplies declared relationship
metadata rather than automatically reading related content. Its
[documented selector and remaining live prerequisite](local-coursera-extraction.md#bookmark-setup-and-the-full-course-data-prerequisite)
are distinct from verified private authoring support. Returned fields may be
metadata only; their presence is never treated as complete content acquisition.

| Option | Fits the restrictions? | What it can improve | Remaining limit |
| --- | --- | --- | --- |
| Native XLSX outline | Yes | Fast authoritative structural inventory | Full assessment/content export is unverified |
| Console or saved DevTools Snippet | Yes | Runs code in the existing authenticated page | Same renderer and editor workload; a Snippet must be run again after reload |
| Protocol monitor registration with checkpoints | Yes | Reinstalls the canonical program on new documents; enables automatic resume | Does not move parsing or editor rendering out of Coursera's renderer |
| Separate CTI supervisor tab | Yes | Detects lost heartbeats, focuses the actual managed tab and navigates an unresponsive tab | Reconnection needs the registered command; confirmed registration loss requires explicit operator re-registration |
| Loaded quiz definitions matched to live IDs | Yes, when available | Can skip most question-editor activations | Actual model shape, identities, completeness, and answer fields must be observed |
| Observed group/question API reads after opening a quiz once | Yes; native MCQ schema confirmed by the real sample | Can obtain original prompts, options and explicit keys without activating every question editor; complete DOM group/ordinal wrappers can avoid sidebar scrolling | Requires a complete item-bound ordered group inventory; live batch support, other types and multiple variants still need verification |
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

The maintained implementation uses the existing managed local-browser workflow.
It opens a quiz once, certifies the active editor against the course item, and
collects its complete observed group inventory. A complete set of body part IDs
and explicit ordinals takes precedence over virtual sidebar discovery; current
sidebar links must agree with those body identities. Otherwise, a complete
ordered live outline supplies the identities and positions. It then reads the
group endpoint, follows
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

The live v6.15.27 result confirms that both resources rejected batching with
HTTP 405; complete group records were available through single GETs. The
definition builder's percent-encoded `%40` version delimiter differed from the
literal `@` used in the original successful sample. v6.15.28 preserves that
delimiter in the exact returned, validated versioned ID, repeats the group key
in the observed group `id` query parameter, omits that parameter for definitions,
and includes the observed `validation` field. This corrects the evidenced wire
format. The later v6.15.28 live check verified all 100 definitions and keys;
it does not establish that every definition 404 has the same cause.

Naptime combines requested fields with default fields. Its documented negative
field selection can exclude `writeAccessToken`; reads request the content fields
and explicitly exclude that credential field. Returned credential fields must
still be removed before retention, even if a server ignores the projection.

The API fast path requires a complete observed inventory, matching returned
identities,
one supported question definition per group, and complete required fields and
keys. Multiple variants, unsupported types, conflicting identities, unavailable
responses or an incomplete inventory keep explicit gaps and use the existing
observed DOM fallback. Missing source inventory cannot be repaired by sorting
response arrays or assuming that ten sampled definitions represent 100
questions. Item checkpoints and the strict final completion gate still apply.

The **Copy current quiz API check** Console script reads one normally opened
quiz for at most two minutes, without question clicks, reloads, a course crawl
or checkpoint writes. Its result reports aggregate definition/key counts,
inventory method, elapsed time and bounded error codes; it excludes raw question
content and credentials. `VERIFIED_CURRENT_QUIZ` means that quiz satisfied the
reader's checks. It explicitly leaves whole-course verification false.
**Copy saved-progress Console script** separately recovers stored observations
without refreshing their evidence or changing checkpoints.

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

A further native Chromium check exposed an additional lifecycle boundary.
A callback parsed in the original page and installed with the inherited blank
tab's `setInterval` ran while that original document was active, then stopped
after the original page navigated. A directly called retained function remained
callable; that did not keep timer orchestration alive. An injected renderer crash
also crashed both same-origin pages in that run. These results rule out claiming
that simply transplanting the current reload-driven program into a blank tab
creates a reliable supervisor. They do not rule out a data-only program that
keeps its defining document active and performs no editor navigation.
The [HTML script execution rules](https://html.spec.whatwg.org/multipage/webappapis.html#check-if-we-can-run-script)
and [JavaScript URL navigation rules](https://html.spec.whatwg.org/multipage/browsing-the-web.html#the-javascript:-url-special-case)
describe the active-document and initiating-origin boundaries.

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
supervision, crashes, and final-file behavior. Whole-course fixtures supply
synthetic responses and substitute Coursera navigation and stability boundaries.
The dedicated API fixture executes the maintained reader and cycle against
HTTPS responses, including the reported unmarked body with 27 compound question
links and 100 body parts. It captures 100 synthetic definitions and explicit keys in
fourteen GETs without question clicks or sidebar scrolling, and rejects
ambiguous inventories and replaced bodies. The copied one-quiz Console script
also verifies 100 synthetic keys in fourteen GETs. These counts and crash recoveries
demonstrate the tested mechanisms; they are not private-course throughput
benchmarks or authenticated acceptance. The real sample
confirms the native MCQ definition schema and explicit keys; authenticated
whole-course acceptance and an editor-free course inventory remain unverified.

The v6.15.28 request regression corrects a fixture limitation: the earlier server
decoded pathnames before matching IDs, masking the `%40`/literal-`@` distinction.
The server now checks the raw wire path before decoding. With both batch routes
returning HTTP 405, the maintained reader and copied Console probe obtain all
100 synthetic definitions and keys in 202 GETs with zero question clicks.
Separate genuine-404 coverage remains incomplete. These are request-format
regressions, not a replacement for a successful live quiz or full-course result.

The v6.15.29 continuity fixture commits forty complete items across two fresh
batches, removes the real debugger registration, and resumes through a new
managed token. It completes 168 synthetic items, the 100-question keyed quiz
and one final JSON without revisiting completed items, changing the checkpoint
namespace or resetting the original clock and budgets. A previously started
run with no matching restored observations stops before editor visits. This
checks recovery after confirmed registration loss. It does not identify the
reported Chrome stop or establish private whole-course completeness.

The built UI lifecycle check also closes the extraction panel, requires the
same runtime to acknowledge a real cross-origin `READY` message with 79 saved
observations while unmounted, and reopens the same command, child, URL and
counts. This verifies that ordinary component unmounting does not end browser
supervision. It does not make the runtime survive a full page reload or browser
closure.

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
