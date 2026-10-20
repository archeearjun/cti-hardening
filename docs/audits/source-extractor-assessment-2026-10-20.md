# Independent source LMS extraction: assessment and implementation plan

## Scope and evidence standard

This is a first-principles code and regression assessment, not a certification of
a live Brightspace course or a particular IMSCC export. No new source course or
authorized live source responses were supplied in this task. Findings below
identify current implementation boundaries; fixture success is not live-source
coverage. The source extractor was not rewritten or given new completeness
claims in this change.

CTI must establish: original source evidence → ingestion claim → independently
observed destination → supported differences → remaining acquisition/review work.
An ingestion claim is not a destination observation. A failed read is not proof
of absence. Draft content, publication state and learner accessibility are
independent dimensions on both sides.

## Architecture inspected

1. Live Brightspace: `src/extractors/brightspace/entry.js` orchestrates bounded
   authenticated GETs for content structure, assignment, quiz and discussion
   definitions. `evidence.js` handles native identity, paging and hierarchy;
   `content-reader.js` restricts original-content acquisition to supported
   course-owned routes. `body-store.js`, `checkpoint.js` and `archive.js`
   retain content-addressed originals and recoverable observations.
2. Independent intake: `src/domain/brightspace-capture-evidence.ts` validates
   original hashes, sizes, bindings and projections. A private WeakMap ties
   verified immutable Blobs to descriptors: serialized flags alone cannot
   certify originals. It emits inventory, definition, permission, runtime and
   projection gaps, and deliberately reports `wholeCourseComplete: false`.
3. Package source: `src/source/scan.js` traverses manifest resources/files and
   declared dependencies, hashes bounded originals, extracts text, parses QTI
   and samples selected PDF content. `xml.js` preserves compatibility-parser
   diagnostics; `zip.js` exposes ambiguous path resolution. `qti.js` retains
   source IDs, options, supported answer evidence and selection-scope uncertainty.
   `src/engine/source/manifest.js` supplies manifest-only fallbacks explicitly.
4. Normalization and matching: `src/engine/source/brightspace-matching.js`
   preserves native-topic and ambiguous-context decisions;
   `brightspace-assessment.js` projects supported native questions.
   `src/engine/comparison/` combines source evidence, destination observations
   and ingestion provenance. `matching/payload.js` includes substantive body
   comparison and evidence-gap gates; it is not merely a title/count matcher.
5. Raw observations and comparison projections are separate, but their coverage
   contracts are not yet uniform. Live Brightspace has conservative per-domain
   diagnostics; package evidence exposes bounded samples, hashes and warnings.
   Neither should be presented as interchangeable proof of complete live LMS
   content.

## Evidence-based gap matrix

Priority P0 means correctness of conclusions; P1 means acquisition/fidelity;
P2 means additional supported scope. “Boundary” is intentional conservatism,
not a defect to remove without source evidence.

| Priority | Area | Verified current behavior and evidence | Gap / acceptance criterion |
|---|---|---|---|
| P0 | Missing versus unknown | `comparison/course.js` constructs `MISSING` when matching/recovery fails, then applies `qaApplySourceTextGap_` and `qaApplyUnreachedCarrierGap_`. The latter only applies to source links and unread same-module reading/plugin carriers; the former requires reconciliation candidates. | There is no general inventory-completeness prerequisite in this branch. Establish an end-to-end failing fixture for an unmatched non-link item with incomplete destination traversal. With incomplete relevant inventory, return “not located; evidence incomplete,” not confirmed LMS absence. Keep genuine verified absence distinguishable. |
| P0 | Bilateral parity prerequisites | Body, assessment, asset and reading gaps have existing gates (`matching/payload.js`, `assessment/comparison.js`, `comparison/item.js`). Native Brightspace quiz totals remain unverified. | Audit every high-confidence verdict against explicit source **and** destination scope proofs, including truncated text and unavailable original bodies. An equal sample/hash/count must not stand in for an unverified full body or full inventory. Do not replace these gates with one global score. |
| P0 | Publication semantics | `comparison/item.js` treats unpublished state as observed-only in `RAW_INGESTION`, but adds `UNPUBLISHED` outside that mode. | Preserve useful publication-readiness reporting while separating it from instructional-content loss. Test the same complete draft under ingestion and current-state views; content fidelity must not become “missing content” solely because publication is pending. |
| P1 | Brightspace quiz completeness | `entry.js` retains returned question rows and pagination but always sets quiz `completenessVerified: false`; description-derived exam counts are explicitly insufficient. `brightspace-assessment.js` preserves missing/duplicate/conflicting IDs. | Obtain authorized response evidence for quiz section/pool/library membership and authored variants. Verify ordered inventory, selection rules and all owned definitions independently. A matching response count alone must still fail. |
| P1 | Native question types | `qaBrightspaceQuestionType_` maps native IDs 1,2,3,4,7,8 to supported choice/text/essay classes; other types remain unknown. Answer handling supports specific source structures rather than arbitrary grading logic. | Collect actual matching, ordering, numeric/calculated and other unknown models before adding adapters. Preserve native types, tolerances, choices, explicit empty values and grading rules; unsupported semantics stay explicit. Do not infer type-ID meanings. |
| P1 | QTI interaction fidelity | `qti.js` recognizes choice/response-lid, text/regex and explicit essay profiles; handles selection scopes and reports invalid/overlapping selections. It does not provide full deterministic adapters for every QTI interaction/response-processing program. | Add fixtures with declared mixed interactions, matching/order/hotspot/calculation and response-processing variants. Unknown interactions must retain raw definitions and block corresponding semantic coverage rather than silently flatten into an ordinary text/choice question. |
| P1 | Rubric structures | Live assignment/quiz native models are retained; discovery follows supported explicit URL/HTML fields. Package PDFs can be classified and sampled as rubric documents. No dedicated full native rubric-tree acquisition/coverage contract was found in the inspected Brightspace path. | Establish rubric IDs, criterion/level order, points/ranges, descriptions and assignment bindings from real responses. Exact native rubric trees and original rubric documents remain separate from semantic samples. |
| P1 | Original attachments and binaries | Brightspace independently verifies supported bounded originals, including signature-checked course-owned DWGs. Unsupported routes, implicit IDs and failed references remain gaps. Package hashing is capped per file and globally. | Add source-bound acquisition only for observed supported attachment selectors. Every discovered attachment needs an original-byte receipt or an explicit unresolved reason. MIME/name matching cannot certify binary identity or rendering. |
| P1 | Package original retention / long text | `scan.js` hashes originals but comparison resource records carry normalized samples, not a self-contained copy of every original. Limits include 1,800 file inspections, 16,000 characters per text sample, 900,000 total text characters, 12 MB per hashed file and 60 MB total hash bytes. | Verify the original uploaded ZIP remains retrievable across each save/export workflow. Add a content-addressed raw-resource resolver if that is not guaranteed. Keep full original bodies separate from normalized projections; expose budget truncation per resource and in comparison readiness. |
| P1 | PDF and document bodies | `scan.js` restricts PDF semantic extraction mainly to assignment/instruction/rubric candidates. `pdf.js` retains bounded page samples (up to 12 selected samples), not a full document model or OCR. | Ordinary reading PDFs, image-only PDFs and unsupported office formats need explicit acquisition-versus-interpretation states. Test full original preservation and page/sample limits. Do not describe extracted snippets as complete document content. |
| P1 | Hierarchy and ordering | `brightspaceModuleChildrenV110` preserves native ordered lists; separate Modules/Topics arrays report `SEPARATE_NATIVE_ARRAYS_INTERLEAVING_UNVERIFIED`. Traversal diagnoses cycles/reused identities. IMSCC retains manifest structure. | Validate repeated placements and stable order against real module responses. Do not invent an interleaving. Carry native structural IDs and ordering certainty through normalization, content maps and comparison—not just flattened path strings. |
| P1 | Time estimates | No authored-duration projection was found in the inspected Brightspace extraction, source normalization or IMSCC scanner paths; progress durations measure capture execution, not instructional time. | Discover explicit authored source time metadata and its units/scope. Preserve null/absent/zero distinctly; separate authored estimates from inferred durations and capture elapsed time. Do not derive source time from titles or media runtime by default. |
| P2 | Rise/Storyline/SCORM, LTI and plugins | Live capture identifies runtime carriers and embeds but intentionally does not launch them or fetch arbitrary external bodies. Package `sourceInteractiveSignals_` records signals; this is not exhaustive runtime content acquisition. | For an authorized supplied package, inventory assets and structured lesson/block data with original-byte evidence. For external tools, require an observed read-only contract and permission. Preserve launch configuration separately from instructional bodies; never count a launch URL as captured content. |
| P2 | YouTube/Vimeo and media | Explicit embeds/URLs are detected; live extractor declares `externalUrlsFetched: false`. A linked video is not a retained original, transcript or verified playback. | Independently track source URL, accessible metadata, authorized transcript/captions, media original/rendition and launch status. Unsupported/private media remains referenced/unverified; no authentication bypass or automatic completeness promotion. |
| P1 | HTML reference coverage | `source/content.js` extracts common links, image/source/video/audio `src`, iframe/embed `src` and object `data`. This is a finite explicit selector set, not exhaustive CSS/srcset/script/runtime discovery. | Add separately tested discovery for observed responsive/CSS references and supported dynamic packages. Each original must be owned by its exact source element; alternate renditions do not replace missing originals silently. |
| P1 | Cross-platform normalization | Source QTI/native essays and Coursera manual submissions have different grading structures. Existing manual-draft verification does not create rubric-equivalence or grader-execution proof. | Preserve raw native type and scope beside a reusable normalized submission/rubric model. Compare prompts, schemas, ordered criteria, points and authorized answers only where both sides support them. Never coerce an AI rubric into a choice answer key. |
| P1 | Targeted rechecks / history | Live Brightspace checkpoints are historical recovery; metadata and bodies are labelled fresh per attempt. Coursera supports targeted/native rechecks with separate previous observations. | Design explicit source item rechecks keyed to native identity and dependency closure. Save new observations without mutating old snapshots; failed refreshes retain old originals but withdraw current-state certification. |

## Prioritized implementation sequence

1. **Conclusion safety first.** Reproduce the unmatched-item/incomplete-inventory
   branch and incomplete-body parity cases at the full comparison boundary.
   Add source/destination inventory and per-body proof prerequisites to relevant
   verdicts. Preserve stable IDs, ambiguity candidates and explicit exclusions.
   Acceptance: removing a response cannot turn “unknown” into “missing” or
   “equivalent”; a fully verified negative inventory can still establish absence.
2. **Source evidence corpus and contracts.** Request one minimal authorized
   example per unsupported native schema, plus a representative original IMSCC.
   Build per-type source contracts for text readings, attachments, assignments,
   discussions and assessments. Inventory completeness, body integrity,
   semantics and runtime coverage remain separately counted.
3. **Quiz/rubric fidelity.** Implement only observed pool, question and rubric
   contracts. Test complete and incomplete inventories, changed definitions,
   duplicate IDs, authorized keys, empty values and unresolved assets. Retain
   whole raw models and original timestamps before normalization.
4. **Original bodies and structure.** Close raw package retention, long-document,
   hierarchy-order and authored-time gaps with source-bound fixtures. Keep
   bounded acquisition and resumability; budget limits produce explicit gaps.
5. **Runtime content by provider/package.** Separate Rise/SCORM package adapters
   from external YouTube/LTI/plugin acquisition. Require authorized real evidence
   and provider-specific acceptance criteria; no generic “iframe captured”
   completion rule.
6. **Bilateral comparison.** Introduce shared pure concepts—identity, immutable
   observation receipts, byte/hash validation, coverage categories, ambiguity
   and dependency gaps—without sharing Coursera endpoint/ID assumptions.
   Cross-platform adapters own their schemas and feed separately validated
   comparison projections.

Each change should be independently reviewable, run focused regressions first,
then mandatory CI/browser and deployment gates. Do not couple source transport
changes to unrelated Coursera acquisition changes.

## Validation performed

Eight existing source test files passed: Brightspace capture evidence,
definition coverage, inventory v1.1.0, content reader, quiz-media binding,
ingestion boundaries, source ZIP handling and package-scan integrity.
These tests exercise supported contracts and rejection behavior; they do not
establish live-source completeness. The current task made no source-extractor
behavior changes. The P0 comparison branches above are prioritized investigation
targets, not claims that every current missing verdict is wrong.
