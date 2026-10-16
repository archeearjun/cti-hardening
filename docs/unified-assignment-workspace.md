# Unified assignment workspace

The Assignment workspace joins intake, source exploration, item work, history,
deliverables and advisory analysis for one selected course. Existing Explore,
Compare, History and operational tools remain available. It uses the existing
local IndexedDB/shared D1 workspace and preserves immutable audit snapshots.

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
