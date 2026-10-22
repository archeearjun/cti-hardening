# Activity Studio RC1 evidence corrections

Comparison baseline: PR #108 head `611a692e8ce2e2475cc8089a0bbeb61a14e6d118`.
This is a local projection/packet evaluation, not a new LMS capture or production
completeness result. Original extractors, comparison rules and source files are
unchanged.

| Mechanism | Reproduced behavior | Correction |
| --- | --- | --- |
| Teaching gate conflated readable with instructional | Any non-receipt reference, including an outline, satisfied teaching | Explicit roles; source-bound teaching or a content-bound human instructional review; assessment and prior result exclusions |
| Adapter recognized only legacy DOM empty receipts | Native `COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT` became unread | Validate the native zero-part identity/receipt and preserve observed-empty/source reconciliation |
| Missing supported projection contracts | Current-published CML and native instruction blocks omitted | Allowlisted, identity-checked text projection with source state, hashes and original timestamp metadata |
| Packet fallback treated all unmapped files as shared | Every focused packet carried all unassociated bodies | Explicit shared/prerequisite selection, exclusions catalogue, citation-driven approved handoff |

## Retained TRDE120 replay

Retained v1.9.4 capture, dated 2026-10-20T18:18:49.759Z, 96 inventory items.
Compressed input SHA-256:
`6d7120892fb5d197b6ed75d264e1d365d095a8be56bd1eb87dea5950e0603952`.
Both original bytes and parsed original contents were checked unchanged after
projection. The benchmark emits IDs, states and counts, not question bodies.

| Projection observation | Before | After |
| --- | --- | --- |
| Documents with body text | 36 | 39 |
| Observed-empty authored assessments | 0 separately identified | 17 |
| Current-published reading bodies | 0 | 2 |
| Generic unread | 60 | 33 |
| Unsupported type | folded into unread | 7 separately identified |
| Recorded ingestion failure | item-level partial | 1 separately identified |
| Partial body projections | 36 | 36 |

`SekFW` retains 551 text characters and `hspvR` its published body. `mtHnH`
retains 429 characters of authored learner instructions. `zBBdG` remains empty,
with a source-reconciliation hold. `LFrHs` retains all ten blocks (1,638 total
characters), including two gap blocks whose source prompt literally reports
`[Error: Image could not be created]`. Ten acquired definitions do not certify
valid learner tasks. This PR does not fix those source errors or raise course
completeness. The 17 empty items are empty authored parts, not proof that their
Brightspace counterparts were absent.

## Measurement

Run from repository root:

```
node tools/benchmark-activity-evidence.mjs
node tools/benchmark-activity-evidence.mjs /path/to/retained/capture.json.gz
```

The script loads baseline code via read-only `git show`; it needs that commit in
local history. Same 260,287-byte synthetic session, one target module, 45 unmapped
documents, one explicitly selected prerequisite; 5 warmups and 30 measurements.
Both implementations receive the identical session/options; old code ignores the
new explicit selection. This tests scoped projection, not equivalent full-course
AI inspection. The selected prerequisite and target module text are retained in
full; 44 unresolved associations remain visible and recoverable.

| Independent operation | Before | After |
| --- | ---: | ---: |
| Focused packet bytes | 275,531 | 45,663 |
| Estimated input tokens (characters / 4) | 68,882 | 11,415 |
| Packet preparation median wall time | 8.14 ms | 0.46 ms |
| Packet preparation p95 | 16.46 ms | 1.52 ms |
| Cached snapshot identity median | 0.000307 ms | 0.000163 ms |
| Retained capture projection median | 18.36 ms | 19.47 ms |
| Retained capture projection p95 | 94.20 ms | 41.46 ms |

Local shared runtime; concurrent regression work and garbage collection affect
these short timings. The +1.11 ms projection median is accepted for preserving
three omitted bodies, distinct states and provenance. It is not evidence of a
production regression or improvement. No stages are added together. Process heap
deltas (0.64 MB before, 3.81 MB after) are reported in the JSON but are **not peak
memory or retained-memory measurements**; no browser memory reduction is claimed.
Existing 30 MiB session / 30-million-character capture / 8 MiB original-PDF limits
remain. Cached indexes are weakly keyed only to frozen snapshots; packet candidate
reuse retains at most one candidate. Approval changes do not reread files or run
an extractor. Shared selection adds one checkbox action per selected prerequisite;
classification requires explicit reviewer input. Active operator time is unmeasured.

Raw measurements: [JSON](activity-studio-rc1-measurements.json).

## Bounded roadmap (no changes here)

| Area | Evidence / hypothesis | Next measurement |
| --- | --- | --- |
| Brightspace acquisition | Not measured in this correction; authentication/navigation cost is a hypothesis | Existing opt-in trace on a targeted authorized run |
| Coursera acquisition | Not measured here; repeated unchanged item acquisition is a hypothesis | Existing per-item diagnostics with snapshot reuse distinguished |
| Saved evidence loading | Prior operator benchmark reported 1,048 requests; this PR did not independently rerun it | Same retained revisions, cold versus resumed loads |
| Reconciliation | Not measured here; repeated normalization is a hypothesis | Separate existing diagnostic stages |
| Activity evidence preparation | Retained 96-item projection measured above | Repeat on a second retained course without recapture |
| AI handoff | Synthetic scoped-packet measurements above | Operator review of actual dependency selections and exact packet bytes |
| Focused item rechecks | Not measured here | Existing receipt timing; unchanged empty editors require reconciliation, not recapture |

## RC1 demonstration

1. Import retained evidence. Add an outline as a reference; inspect its
   unclassified/planning role. Provisional recommendations remain possible; even
   an approved outline-only proposal cannot generate copy-ready final content.
2. Use an exact-item teaching body, retained teaching PDF, or review a genuine
   instructional document with exact excerpt/locator. Do not classify a planning
   document as teaching. Inspect practice gaps before approving a proposal.
3. Inspect `zBBdG` (or the native zero-part fixture): source reconciliation is
   required, with no unchanged-editor recapture loop. Inspect `LFrHs` source error
   blocks rather than treating capture completeness as valid instructional content.
4. Select one module and its necessary prerequisites. Check excluded/unmapped
   paths; add required sources before sending. Oversized bodies remain complete.
5. Approve one proposal and hold another. Generate the approved-only packet.
   Import final fields; change placement or revise approval and confirm stale
   fields cannot be copied. Restore a work ZIP and confirm approval is not
   manufactured. Valid fixture fields still require human semantic review.

Unit fixtures are synthetic representations of observed contracts; browser tests
exercise actual controls. Neither establishes live-course pedagogical correctness,
visual diagram interpretation, external runtime coverage or authenticated production
behavior. Engineering Lead review is required; no merge or deployment is authorized.
