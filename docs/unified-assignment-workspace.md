# Unified assignment workspace

The Assignment workspace joins intake, source exploration, item work, history,
deliverables and advisory analysis for one selected course. Existing Explore,
Compare, History and operational tools remain available. It uses the existing
local IndexedDB/shared D1 workspace and preserves immutable audit snapshots.

## Assignment owner path

The default owner view follows six evidence-based stages:

1. **Understand the title.** Inspect the original source package or attributed
   source document before making manual changes. Package hierarchy and literal
   source text stay separate from proposed curriculum changes.
2. **Collect evidence.** Add the live Brightspace capture, the Coursera course
   bookmark capture, and a matching Coursera XLSX when available. The XLSX is
   an independent structural export; a verified native capture inventory can
   supply structure without certifying complete content.
3. **Compare what is actually there.** Save a comparison before treating flags
   as correction instructions. Confirmed differences, unresolved identity and
   failed or unsupported source reads remain distinct.
4. **Review and fix.** Open the exact Coursera item from its worklist where a
   bound destination is known. Record the action and its reason. Empty, broken,
   duplicated or unexpected source content stays as captured; extraction does
   not silently repair it or invent a replacement.
5. **Recapture and verify.** A recorded LMS edit requires capture after the edit
   and a new saved comparison. A later checked decision cannot make an old
   capture current. Changes to Brightspace or the source package require fresh
   evidence for that source, not only a new Coursera capture.
6. **Prepare the deliverable.** Reconciliation, content maps, outlines and owner
   approval use the current evidence basis. Historic findings and decisions
   remain available after new captures.

Workflow stages describe recorded progress, not an extraction-completeness or
quality percentage. The primary sidebar keeps the assignment, source inspection,
source LMS, Coursera capture, comparison and history accessible. Catalogue,
portfolio overview and the detailed plan remain under **More workspace tools**;
administration, analytics and partner-specific operations remain under
**Advanced tools**. Advisory learning is under **Advanced analysis** in the
assignment. Activity creation and standalone diagnostics are under **More
tools** at the top. These tools remain available without competing with the
daily inspect–fix–verify path.

## Sharing an extraction problem without file downloads

Open `https://cti-hardening.pages.dev/?tool=share` in a regular Chrome tab, or
choose **More tools → Share a large capture**. The same panel is also available
under the source LMS capture screen. Select the existing JSON, gzip or Coursera
archive; the local worker checks it using the maintained capture readers and
Brightspace original-body validator. It does not rerun the LMS extractor or
upload the capture.

**Copy review text** produces a bounded review with counts, native identities,
findings, original-body-check status and explicit omissions. A visible textarea
and **Select all review text** remain available when clipboard access fails.
This is the primary path in embedded browsers that block Blob downloads. An
optional small download reports only that a download was requested.

The review excludes original media and complete course/question bodies, strips
access parameters from shared URLs, and is capped at 96 KiB with truncation
counts. It is a local diagnostic observation, not a server attestation or a full
capture. Keep the original file; the small report alone cannot independently
reverify omitted media or certify course completeness. Failed consistency checks
remain visible and copyable for investigation.

## Evidence intake and source scope

The inbox inspects multiple files sequentially, hashes originals, identifies
Coursera archives/JSON/gzip, Brightspace JSON, source packages/manifests, XLSX
and attributed Markdown/text/structured source documents. Per-file failures and
same-role conflicts remain visible; file order never chooses a baseline.
Duplicates reuse their recorded identity. Unsupported JSON is rejected.

A source document can explicitly become a text-only baseline. Literal heading
sections and original text remain retained; headings are not certified LMS item
boundaries. Assessment definitions, original media and complete source-course
coverage stay unknown. Document-based comparisons present candidate observations
for owner review, not automatic missing-content repair or whole-course scores.

Ordinary comparison accepts its independent Coursera XLSX as before. A direct
capture can instead supply structure when its retained initial/final native
material inventories, hashes, source receipts, stable versions and ordered item /
atom identities independently agree. The engine's internal workbook adapter is
labelled derived native structure, never an independent export. Legacy, unstable,
unsupported or incomplete inventories still require XLSX. Structure verification
does not certify content capture.

Small source-document originals are retained as text. Large original archives and
capture binaries remain local files: workspace records retain identities and
scope, not an unbounded Base64 copy. Keep original files for future reopening.
The existing capture/archive and workspace size limits remain enforced.

## Identity and item history

Coursera payload enrichment requires a unique, case-sensitive native item ID on
both sides. Name-only candidates and duplicate/conflicting IDs remain review
items; their bodies are not borrowed. Brightspace correspondence requires exact
recorded identity or unique reciprocal title/type/placement context. Quiz,
assignment and runtime details require their exact native references.

Each item retains native platform identity, placements, shared resource identity,
evidence basis and append-only lifecycle events. Stage, owner disposition,
mappings, deliverable membership, text/question coverage, source fidelity and
freshness are separate. A changed evidence basis invalidates current approval
without deleting its historical receipt. Mapping and transformation events can
record one-to-many or many-to-one intent; recording intent does not rewrite an
extraction or certify a comparison.

Local saves validate before opening the write transaction, then atomically
recheck the validated reference snapshot. Shared commits check exact versions,
missing dependencies and review insertion races. Neither store accepts edited,
pruned or reordered history. Actor declarations remain distinct from the
workspace service's authenticated record updatedBy identity.

## Deliverables and transformation

The workspace creates deterministic, source-linked draft content maps, course /
specialization outlines and transformation plans. Original evidence stays separate
from proposed titles, placements and mapping edges. Drafts can be reordered,
exported or imported as validated structured revisions. No curriculum content,
answers, media or learning outcomes are invented.

Revisions and decisions are immutable and bind to exact inventory/evidence.
Approval is an owner decision; declared external application requires recapture
and verification. CTI does not perform LMS writes or treat an external application
receipt as proof that the learner-visible content changed. Existing external
agent handoffs remain available alongside the integrated structural drafts.

## IFS and advisory learning

IFS remains the versioned deterministic workload/friction index, not content
quality or a failure probability. Current counts are recorded observations,
not a measured claim about time saved.

Advisory learning runs locally with no model API. Explicit owner-reviewed native
candidate pairs become feature-only labels. Sufficient positive/negative labels
across multiple courses are required; training uses course-grouped holdout and
recomputes coefficients, dataset fingerprints and evaluation. Sparse evidence
returns insufficient-data. New pooled labels make old rankings stale until
reevaluation. Saved historical evaluations remain visible.

Suggestions never attach source payload, alter QA verdicts, create missing
content or automatically apply LMS changes. Owner-supplied review datasets are
labelled declarations; in-workspace labels are checked against exact saved audit
candidates. Real labor savings require measured use across representative courses.

## Verification

Focused regressions cover exact/ambiguous identity, source-document scope,
verified native structural intake, immutable revisions/history, stale evidence,
local/shared concurrency, reviewed-feature provenance and holdout leakage.
The built-app assignment browser check covers first-document setup, mixed intake,
original text downloads, explicit baseline changes, duplicate reuse, lifecycle
save/reload/conflicts, source exploration, deliverable export, keyboard access and
mobile layout. CTI_BROWSER_NO_LISTEN=1 uses browser-intercepted fixture responses
without opening a local server or contacting an LMS.

Full deterministic and browser CI gates remain required before the production
mirror is forwarded. Fixture verification is not live Coursera/Brightspace,
Panopto playback or blanket extraction-completeness certification.
