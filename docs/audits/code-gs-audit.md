# Code.gs preservation and feature audit

**Verdict: NOT FEATURE COMPLETE.** The native module refactor preserved the active
QA/extractor logic, but the Cloudflare application does not yet replace every
operational workflow in Apps Script. Archiving a function preserves its source;
it does not make that feature available to users.

Audited application baseline: `01d7d0d8f663509e2b290c99e396ec098003b77a`.
The frozen Code.gs and Index.html hashes are recorded in the
[complete machine-readable ledger](code-gs-parity.json). Neither archive was edited.
This audit includes a small lifecycle boundary fix, described below. Other gaps
remain explicitly open; this is not a release claiming complete migration.

## What was checked

| Inventory | Result |
| --- | --- |
| 392 top-level Code.gs functions | Every function assigned a disposition and a maintained owner or explicit gap |
| 10 late function overrides | Final effective bodies match; all nine base bodies actually used by overrides also match |
| 40 top-level constants/aliases | All accounted for; active rule constants match; old host/configuration metadata identified |
| 251 original functions present in the native engine | 248 effective rule bodies match exactly after AST normalization; three extractor delivery adapters have reviewed differences |
| Coursera extractor | All 291 helpers, 13 relocated literal constants and remaining execution code match |
| Brightspace extractor | All 26 helpers and remaining execution code match |
| Source scanning / owner reporting from Index.html | 42 migrated functions match; four reviewed host adaptations use worker-compatible crypto, explicit PDF services and PDF cleanup |
| 81 historical capability flags | 51 implemented/source-traced, five platform replacements, eight partial, 16 gaps, one unverified historical claim |

These are inventory counts, not a percentage of product completion. Functions and
flags differ substantially in size and importance. “Available” means a current
implementation was traced; it does not certify all real courses, private LMS
sessions, redirects, runtime plugins or deployed account configuration.

The 141 functions without a same-name native engine implementation break down
into 38 replacements, 33 partial replacements, 61 gaps, eight previously unused
helpers, and one old-host migration exporter. They are **not** 141 lost QA rules.
The original behavior-comparison declaration is superseded completely by its
final archived override; that effective override is preserved, and its unused
base is not artificially reactivated.

## Remaining gaps and their practical effect

| Priority / area | Finding | Required replacement |
| --- | --- | --- |
| P1 — Package identity and duplicates | New records use random UUIDs without the old partner + normalized filename identity guard. Duplicate preview, metadata conflict checks, stable survivor selection, newest-scan merge and recoverable archive are absent. | Restore semantic identity at the save boundary and add transactional, previewed duplicate reconciliation without losing histories. |
| P1 — Planner/catalog work queue | Current queue lists saved courses and checklists. NAIT/Marshall catalog refresh, planner campaigns, owner disambiguation, unresolved title slots and audit-existing-shell-first next actions are absent. | Portable catalog/planner inputs, original resolution rules and a full queue UI. Do not infer missing titles or reimport need from checklist ticks. |
| P1 — Work state and runtime inventory | Only evidence checklist/notes are editable. The old Scope / Coursera Redo / Course Outline / Source Audit / Specialization Outline / Content Map states survive in imported legacy rows only. Fresh SCORM/Rise inventory cannot be refreshed; imported inventory is consumed with explicit missing-inventory warnings. | Restore typed state transitions and inventory input with provenance/freshness checks. |
| P1 — History semantics | Generation grouping, immutable raw baseline and provenance memory work. Explicit import-event provenance, destination-ID-change warnings, automatic parent/source-scan links, summary deltas and conservative v6.12.0 repeated-export repair are incomplete. | Port the remaining lineage policy and operator-confirmed repair without rewriting evidence or inferring reingestion from export changes. |
| P2 — Source operations | No deterministic preflight action, tabular master-manifest export, bulk rescan or course delete/archive action. | Restore preflight thresholds and table fields; identity-safe bulk processing and version-checked archive/delete. A Google dependency is not required. |
| P2 — Metadata / portfolio | Owner/partner/status editing and core metric functions work. Assigned-date/deadline/Drive-link editing and validation, partner aggregate totals, catalog owner refresh and duplicate summary are not equivalent. | Complete metadata editing/validation and partner-level projections. |
| P2 — Advisory / diagnostics | Gemini triage, bounded deep-architecture summary/advisory, aggregated operator system health and persistent visit count are absent. | Separate deterministic diagnostics from optional advisory service configuration; restore an honest runtime capability/health view. |
| P2 — Capability / review contracts | The copied all-true engine manifest and CODE_GS_CANONICAL delivery label describe the old host. Item-level review notes/status exist, but they are not a complete run-level label/dataset workflow. | Modernize host metadata and explicitly distinguish supported, partial and unavailable product capabilities. |

The historical `qaGlossary` flag is classified as an **unverified legacy claim**:
there is inline guidance, but no separately named glossary panel/endpoint was
found in the archived UI. Likewise, the old human-label/future-ML flags refer to
stored metadata; they are not evidence of a training service or a dedicated label
write endpoint. The audit does not invent lost features from flags alone.

## Verified replacements

- Cloudflare Access / editor roles, atomic D1 version checks, local IndexedDB
  transactions and immutable audits replace Google session/properties/locks.
- Versioned/chunked records and loss-aware migration backups replace Google
  database sheets, tree cells, payload chunks and temporary Drive conversions.
- Single-snapshot QA calls the preserved core with explicit source, workbook,
  history and runtime services. Full structured results are retained.
- Same-attempt raw/current comparison uses the original lifecycle engine.
  Cross-attempt comparisons remain explicitly observational.
- Owner reports and item actions replace the older deterministic remediation HTML
  list, preserving exclusions, repackaging, manual-removal review, mutations,
  partial/moved/unverified evidence and extra destination items.
- Macmillan scanning, split/exclusion rules and stage contracts are preserved.
  Specialization XLSX downloads retain the export, Module Context, Time Policy
  and Excluded Modules sheets.

## Omission repaired during this audit

The old `runPostIngestionLifecycleQa` wrapper rejected incoherent XLSX/JSON pairs
and required full capture JSON for both raw/current snapshots. The pure delta
engine did not contain these checks. The new saved-report wrapper had omitted
them even though it called the unchanged engine.

`src/domain/workflows.ts` now rejects incoherent snapshots and summary-only
records, and requires both capture identities before raw-to-current lifecycle
attribution. Regression tests cover each side of the pair plus a valid comparison.
This changes the workflow input boundary; it does not change item fidelity rules.

## Verification and limits

`npm run audit:parity` checks the complete ledger and independently compares AST
bodies, arguments, async/generator markers, literal values, constants and whole
extractor execution code. Only whitespace/comments, quote spelling and explicit
base-alias renaming are normalized. It does not load current rules into an old
shared global scope to establish parity.

The historical `tools/check.cjs` harness **does** overlay active modules onto an
archived environment. Archive-only functions and old UI contract tests remain
there. Passing those historical tests cannot establish Cloudflare availability
for duplicate cleanup, planner queues or other missing features. The audit ledger
and direct workflow tests close that reporting blind spot; they do not pretend to
implement the outstanding workflows.

The audit fixture also protects migrated source scanner and owner-report bodies.
Reviewed host adaptations are fingerprinted separately so later changes require
an explicit review. Intentional future engine changes must update their audit
disposition with evidence; the archive remains frozen.

Current data in old backup tables is preserved, but inactive data is not counted
as a usable workflow. No production course data, labels or stored history were
rewritten by this audit. Full feature-parity sign-off remains withheld until the
listed gaps have working replacements and their own regression coverage.

Validation for this change: `npm test` passed 228 historical FAST assertions,
23 archived UI/source-contract assertions, 20 hardening checks and 157 Node tests
(428 total, zero failures). The production build/typecheck passed. The built
browser workspace check passed migration/reopen, XLSX+JSON comparison, workers,
checklists, immutable history, workbook export, analytics and concurrent-edit
checks with no page errors. These synthetic checks do not change the incomplete
feature-parity verdict above.
