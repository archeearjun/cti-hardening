# Coursera extraction: feasibility and evidence limits

Assessment dated 12 October 2026. The requirement is complete course evidence in
the operator's authenticated local Chrome, without installing an extension,
requiring local Node/Python, or paying for a remote browser.

The present live workflow is **not proven scalable**. The operator reports about
1.5 hours without a final capture, with very slow progress through assessments.
The screenshot shows v6.15.22 at item 1/167, opening a 100-question assignment;
its per-document elapsed counter cannot establish the duration of the whole run.
A progress card, a registered Chrome command, or a downloaded JSON does not by
itself establish complete extraction. We cannot promise extraction perfection
from the evidence currently available.

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

## Options under the restrictions

| Option | Fits the restrictions? | What it can improve | Remaining limit |
| --- | --- | --- | --- |
| Native XLSX outline | Yes | Fast authoritative structural inventory | Full assessment/content export is unverified |
| Console or saved DevTools Snippet | Yes | Runs code in the existing authenticated page | Same renderer and editor workload; a Snippet must be run again after reload |
| Protocol monitor registration with checkpoints | Yes | Reinstalls the canonical program on new documents; enables automatic resume | Does not move parsing or editor rendering out of Coursera's renderer |
| Separate CTI supervisor tab | Yes | Detects lost heartbeats and navigates a crashed managed tab | Recovery preserves work; it does not make slow acquisition fast |
| Loaded quiz definitions matched to live IDs | Yes, when available | Can skip most question-editor activations | Actual model shape, identities, completeness, and answer fields must be observed |
| Authenticated API acquisition in a lightweight Coursera-origin tab | Browser mechanism proven; course path pending | Can fetch definitions without loading the large React editor | Real authoring schema, item relations, pagination, keys, and completeness remain unverified |
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

## Recommended direction and the missing evidence

The strongest remaining free direction is to acquire original definitions using
the signed-in browser's same-origin requests, in a lightweight document that
does not render the course editor. A document opened as `about:blank` by a
Coursera-origin script can inherit that origin. Same-origin `fetch` normally
sends the origin's credentials without copying the cookies into CTI. These are
documented browser capabilities, and a local browser prototype verifies the
mechanism: a loopback fixture opened a blank tab, fetched its fixture API with an
HttpOnly session cookie, and loaded no authoring application in the new tab.
That test used no real Coursera session or schema. It did not prove crash
isolation: same-origin tabs may share a renderer. A lightweight tab reduces
editor work; it is not automatically an independent crash supervisor. These
results are not evidence that a complete Coursera authoring API exists for this
account or for every content type.

The next evidence needed is **one normal quiz opening**, not another full-course
run. The bounded response-sample tool observes the page's existing fetch/XHR
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

That sample must establish which observed requests bind a course item to its
assessment and question IDs; whether complete definitions and keys arrive
together or through multiple requests; how text blocks and question order are
represented; and whether pagination, draft versions, media references, or missing
permissions prevent completeness. An implementation can then fetch only those
observed read endpoints, preserve original definitions, checkpoint each item,
and use DOM capture only for confirmed gaps. Endpoint names and relationships
must not be invented from a framework's naming convention.

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
they are not throughput benchmarks for this private course. Authenticated live
acceptance and a complete API-definition path remain unverified.

## Browser documentation and scope

- [MDN same-origin policy, inherited origins](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#inherited_origins): why a Coursera-created blank document can inherit Coursera's origin; cross-origin CTI cannot simply read authenticated Coursera responses.
- [MDN Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch): request/response processing and same-origin credentials; authentication does not itself prove an endpoint returns full definitions.
- [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers): worker execution and lack of direct DOM access.
- [Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) and [MDN origin-private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system): incremental local persistence, with API support and permission requirements.
- [Chrome remote debugging changes](https://developer.chrome.com/blog/remote-debugging-port): modern external debugging requires a non-default user-data directory; it is not an installation-free connection to any existing work profile.
- [Coursera Naptime](https://github.com/coursera/naptime): a public REST framework repository, not a supported private authoring-content API contract.

These sources establish browser mechanisms and their boundaries. They do not
guarantee complete acquisition of every Coursera assessment, plugin, external
service, or protected media resource.
