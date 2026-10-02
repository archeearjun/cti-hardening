# Code.gs preservation and migration closure audit

**Verdict: MIGRATION CLOSED WITH INTENTIONAL RETIREMENTS.** The active
React/TypeScript/Cloudflare application now has a current implementation,
replacement or explicit retirement for every audited Apps Script function group
and declared legacy capability. The frozen Apps Script application remains
reference evidence under `archive/apps-script`; it is not an active runtime.

The machine-readable source of truth is
[`code-gs-parity.json`](code-gs-parity.json). The frozen `Code.gs` and
`Index.html` hashes remain unchanged. Migration closure is not a claim that the
product is bug-free, that every private LMS/plugin can be read, or that every
historical record has been recovered.

## Inventory and current disposition

| Inventory | Current result |
| --- | --- |
| 392 top-level Code.gs functions | 248 preserved rules, 3 reviewed adaptations, 131 working replacements, 8 unused archive-only helpers, 1 privacy retirement and 1 migration-only exporter |
| 10 late function overrides | Final effective rules remain covered by the parity harness |
| 40 top-level constants/aliases | Retained or explicitly adapted host/release metadata |
| Coursera extractor | Maintained v6.15.4/schema 35 with reviewed change manifest, fail-closed capture accounting and local Chrome as the zero-cost default |
| Brightspace extractor | Maintained v1.0.8/schema 2; standalone generated browser bundle |
| 81 historical capability flags | 51 available, 25 replaced, 1 safe-archive replacement, 1 zero-cost retirement, 1 privacy retirement, 1 unverified legacy claim and 1 retired unverified claim |
| Function groups | 30 replaced, 1 unused archive-only group, 1 privacy retirement and 1 migration-only exporter; no group remains partial or unmapped |

“Replaced” means the user-visible/business behavior exists in the current
architecture but is not required to retain the legacy function name or Google
host dependency. Preserved/adapted rule bodies continue to receive AST/hash
parity checks. Replacements receive focused current-domain tests instead of
pretending a host rewrite is byte-for-byte parity.

## Operational workflows restored

### Source identity, metadata and duplicate safety

- Partner + semantic filename identity is restored, including repeated download
  suffix removal, DEV/NCE normalization and the historical B0RL/BORL correction.
- New course creation, rescan and metadata edits reject an already-active
  semantic identity in the normal UI.
- Assigned date, deadline and HTTPS Google Drive/Docs link editing are restored
  with runtime validation.
- Duplicate review restores stable survivor selection, newest-scan
  preservation, metadata-conflict blocking and stale-plan/version checks.
- Duplicate cleanup is deliberately **lossless**: duplicate course records are
  soft-archived and can be restored. The old destructive delete behavior is
  replaced rather than copied.

### Planner, catalog and work-state operations

The old hard-coded Google Sheet IDs are replaced by portable XLSX inputs in
**Full CTI workspace → Operations**.

- NAIT-style Title Code catalogs and Marshall-style Common Cartridge filename
  catalogs are normalized through one portable parser.
- Planner imports retain partner/date/Smart-Ingestion filtering, owner grouping,
  declared title slots and title-code extraction from remarks.
- Catalog ambiguity is resolved only when the normalized planner owner uniquely
  identifies one candidate; CTI does not guess.
- Existing Import Only shells route to a fresh raw-shell audit before a
  re-ingestion decision.
- Scope, Coursera Redo, Course Outline, Source Audit, Specialization Outline,
  Content Map and operational notes are typed/versioned current state again.
- The restored next-action sequence keeps runtime/interactivity review ahead of
  a “keep existing shell” decision when runtime flags exist.

### Runtime inventory, preflight and source operations

- Portable RISE/Storyline inventory XLSX can be imported and explicitly applied
  to matching source courses with provenance.
- Deterministic preflight restores the legacy blockers: no valid content,
  non-administrative empty folders, or more than 50 LTI items.
- Master Manifest XLSX restores Level, Name, Assignment_Tool, System Format and
  Ingestion Status without requiring Google Sheets.
- Bulk rescan updates only one unambiguous existing semantic source match;
  missing/ambiguous files are reported rather than silently creating records.
- Deterministic architecture diagnostics expose structure, imbalance and runtime
  indicators without turning heuristics into evidence-loss claims.

### Lineage and history

- Existing generation isolation, immutable raw baseline, provenance memory,
  source/coherence guards and lifecycle comparison remain active.
- Repeated-export repair is restored conservatively. A candidate requires
  consecutive raw snapshots, matching source identity and identical retained
  item evidence despite a changed XLSX hash.
- Confirmation creates separate lineage-repair metadata. The immutable original
  audit is not rewritten.
- Confirmed repair metadata is applied when CTI builds later comparison history.

### Health, portfolio and product truth

- Operations exposes active-package, audit, migration-recovery, duplicate and
  metadata-contract health.
- Partner aggregates include active package counts, content/assessment/runtime
  totals, IFS totals/averages, owner inventory and duplicate summary.
- A current product capability manifest now distinguishes AVAILABLE,
  OPTIONAL_CONFIGURATION, RETIRED and REFERENCE_ONLY behavior. The historical
  engine feature manifest is no longer presented as current host availability.

## Intentional retirements

Two legacy behaviors are deliberately not recreated:

1. **Visit telemetry** — the total-visit/last-visit counter is retired for
   privacy because it did not contribute to evidence integrity or business
   rules.
2. **Gemini advisory triage** — the old advisory-only external AI path is
   retired to preserve the zero-cost project constraint. Deterministic
   architecture diagnostics remain. CTI does not turn an advisory model output
   into an evidence verdict.

The old `futureMlDataset` flag is also not treated as a lost product service.
The archive contains metadata fields but no model-training service or dedicated
dataset pipeline. Historical fields remain preserved without inventing one.

## Coursera extraction architecture

The primary zero-cost path is:

**Full CTI workspace → Extract → current v6.15.4 bundle → signed-in local Chrome
Coursera tab → downloaded schema-35 JSON → local strict CTI verification → Compare**

This keeps authentication, Okta/MFA and the long-running browser on the
operator's existing machine. Cloudflare Browser Run remains an optional advanced
deployment only; the Free Browser Run allowance is not a realistic host for
v6.15.4's long-run workload.

Local execution keeps:

- the current extractor, not the old v6.14.7 release;
- per-item capture contracts and no-silent-miss accounting;
- two-attempt bounded recovery;
- long assessment/Reading/plugin waits;
- localStorage + IndexedDB checkpoints;
- strict assessment, empty-reading and external-plugin rules.

A cross-origin plugin that local page JavaScript cannot verify remains
**INCOMPLETE**. The migration does not weaken that boundary.

## Security and data-integrity hardening found during closure

The shared API previously validated the bounded upload summary before accepting
chunks, but did not reconstruct and validate the complete record payload at
commit. A client that bypassed the normal UI could therefore store a payload
whose full nested data violated the workspace record contract.

The commit path now:

1. requires all declared chunks and bytes;
2. reads them in exact part order;
3. verifies every stored chunk length;
4. recomputes the whole payload SHA-256;
5. parses the reconstructed JSON; and
6. runs the full workspace record validator **before** updating the document.

A regression test proves a malformed full source tree is rejected and never
becomes a committed document. Optimistic compare-and-swap and immutable audit
rules remain in force.

## Verification contract

`npm run audit:parity` still proves the frozen archive identity and exact
preserved/adapted rule bodies. It now additionally requires that no legacy
function group remains `gap` or `partial`, and that every declared capability
has an implementation/replacement/explicit retirement.

Focused migration tests cover semantic identity, metadata validation, preflight,
manifest mapping, duplicate conflicts/reconciliation, operational state,
catalog/planner/runtime parsing, audit-first queue decisions, conservative
lineage repair, current system health and partner aggregates.

The repository-wide deterministic pipeline remains authoritative before merge:

- extractor change audit;
- all historical and current Node tests;
- TypeScript production build;
- Cloudflare Worker dry-run.

Interactive private-course acceptance and third-party plugin behavior remain
external verification, not something synthetic tests can certify. Historical
migration recovery cases remain recovery cases: missing original payload bytes
cannot be reconstructed from code.
