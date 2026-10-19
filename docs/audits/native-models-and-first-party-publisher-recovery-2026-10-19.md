# Native fidelity, running exports and first-party publisher recovery

The v1.9.0 implementation addresses source models and recovery failures observed
in the supplied TRDE120 v1.8.9 capture. It does not certify every live title,
published assessment, external activity or media stream. Release checks and live
deployment evidence are recorded separately from this implementation description.

## Observed input and native assessment changes

The supplied expanded JSON has SHA-256
`69e6447c18b36ae3b9003244202ddff4e1b70e377bd2162831fcdfa923170bb7`.
Its reported 96/96 inventory entries are different from its 39/96 verified
content items. Reinterpreting retained source responses is not a new observation
of Coursera and does not rewrite the uploaded capture.

Seventeen current draft assignments contain the exact four-field definition
with `parts: []`. The empty-draft contract now recognizes the observed
`ungradedAssignment` alias as well as the existing assignment aliases. Optional
CML fields may be absent; null, unknown content fields, nonempty rubrics, changed
bindings or missing native stability evidence still fail. The collector and
importer independently check these conditions. A verified empty draft means
that the observed draft is empty, not that the course is pedagogically complete.

The strict literal `textExactMatch` parser retains native answer strings,
whitespace, identifiers, correctness flags and feedback. Unknown matching
semantics are unsupported. Instruction-only drafts retain their ordered titles
and CML without counting instructions as questions. Native ungraded reflection
models retain their original choices with `correct: null`; source-bound proof
is required before answer-key applicability is N/A. Missing or contradictory
original completeness evidence cannot be repaired by replaying a contract.
Zero applicable answer keys produce null/N/A, never a fabricated 100% score.
Independent CTI answer calculation also declines native reflection formats,
including arithmetic-looking prompts; it does not create a key-correction task
for an intentionally unkeyed response.

Explicitly blank MCQ options are displayed as a captured source defect. A native
correct-option identifier does not supply missing answer text. This display
does not promote the item to complete or invent a replacement answer.

Attached draft definitions on published items remain separate evidence. The
40 retained draft definitions are not 40 verified current published questions.

## Export during a running capture

An explicit download request waits for a committed item boundary. The collector
briefly holds acquisition while it freezes immutable per-item manifest Blobs,
then resumes acquisition while the archive is packed. The snapshot retains the
full known inventory, committed original bodies and explicitly unvisited items.
Its provisional metadata withdraws whole-course completion. Export does not
mutate the live checkpoint or claim that untouched items were read. The normal
automatic final export remains a separate, single operation.

## Guided publisher recovery with the same bookmark

Ordinary course capture remains in the signed-in Coursera tab. A publisher
challenge can require an additional explicit action: prepare recovery, open its
publisher tab, complete any normal publisher check, and click the same CTI
bookmark there. No browser extension or separate per-item script is required.
This is a guided fallback, not an unattended one-click guarantee.

The parent freezes a bounded plan from retained publisher JSON, exact native
item/provider/atom identities and ordinary image URLs. The two supported
publisher origins are `https://opentextbc.ca` and
`https://pressbooks.bccampus.ca`. Exact window/origin identities, nonce,
session, course and canonical plan SHA bind the cooperating tabs. Provider
cookies stay in the provider browser context. They are not sent to CTI or
forwarded through the public provider service. A closed, navigated, isolated or
noncooperating window fails explicitly.

Recovery rereads native Coursera items and checks the material graph before
accepting recovered images. It retains pinned publisher JSON and its original
dates rather than silently fetching a different chapter. A changed graph or
failed discovery produces a separate charged attempt and preserves the older
run. Every saved recovered body has exact plan membership, original source
hash, current native stability evidence, MIME/signature/length/SHA checks and
separate response-header and completed-body timestamps.

The transport uses two slots, pull-acknowledged 64 KiB chunks, a 16 MiB per-image
bound, a 512 MiB session body-read budget and at most 1,024 requests. Failed
reads and observed read-ahead are charged. A detected overrun stops acquisition;
its diagnostic counter may exceed the cap without retaining an oversized body.
This counts observed response-body bytes, not exact network-wire traffic.
Challenges stop further automatic reads. No Cloudflare bypass, arbitrary proxy,
alternative-URL crawl or reinterpretation of a successful login is performed.

Earlier failed reads remain in bounded history alongside later successful
originals. Explicit HTTP responses, unreadable responses and unattempted requests
stay distinct. Current and prior frozen manifests remain available when an
ordinary resume reuses recovered bodies. Browser transport declarations are
collector context, not cryptographic HTTP attestation, proof of login or proof
of playback. Independent archive validation recomputes the source joins and
plan bindings before attaching bytes.

The complete encoded bookmark is 510,906 bytes. The 512,000-byte browser bound
is unchanged. Its delivery regression benchmark is now 499 KiB, leaving at
least 1 KiB below the hard bound; the added models and recovery consumed the
earlier 75 KiB reserve. Duplicate code and redundant prose were reduced without
compression, name mangling, remote loading or removal of protocol guards. The
console delivery still retains the source-preserving program.

## Remaining evidence and workflow boundary

The input does not establish a supported response contract for current published
assessment bodies, the referenced manual-graded definitions, or all external
Kaltura activities and captions. One publisher target has an observed API 401
and HTML 404. Such responses are retained as failures rather than empty content.
The manifest alone also cannot verify original file entries omitted from the
uploaded gzip. Publisher recovery must succeed in the operator's actual browser
before its image bytes can be called captured.

The existing owner workflow provides evidence intake, immutable comparisons,
scope review, lifecycle history, owner actions, proposed-only agent handoff and
a manual multi-title capture plan. It does not launch an automatic authenticated
multi-title extraction queue or prove a new course's complete variant/pool
coverage. A 15-title pilot must measure both fidelity and owner effort before
claiming an eightfold speedup or universal extraction support. Captured absence,
source defects, inaccessible content and unsupported content remain separate.

## Validation scope

Focused checks cover native projection fidelity, independent contract replay,
source defects, partial export/checkpoint separation, recovery-plan ownership,
request and byte limits, cancellation, prior failure history and archive joins.
Generated-bookmark browser fixtures cover real cooperating origins, cookie-local
publisher access, exact original bytes, opener isolation and a changed native
graph. Controlled fixtures do not certify the user's live private titles.
