# CTI migration status

As of 2 October 2026, the maintained CTI application runs from the
React/TypeScript/Cloudflare/browser code on `main`. The original Apps Script
application is frozen under `archive/apps-script` as migration and regression
evidence; it is not an active runtime dependency.

The exhaustive [Code.gs audit](audits/code-gs-audit.md) now classifies every
audited function group and declared historical capability as a current
implementation, architecture-appropriate replacement, archive-only behavior or
explicit retirement. There are no silent `gap` / `partial` group
dispositions left in the machine-readable ledger.

This migration closure does **not** mean every live external system has been
validated. Private Coursera/Okta sessions, cross-origin plugins, real multi-user
Cloudflare Access roles, every historical title, and missing historical payload
bytes still require the evidence noted below.

## Current operator workflow

| Workflow | Current implementation | Evidence boundary / remaining live verification |
| --- | --- | --- |
| Source scan | Local bounded IMSCC/ZIP/XML scan with hashes, QTI/PDF evidence, runtime diagnostics, deterministic preflight and Master Manifest XLSX | Broader private package corpus remains a live acceptance task |
| Coursera capture | Current v6.15.4/schema 35 generated bundle runs in the operator’s signed-in Chrome; CTI validates course identity and strict completion before Compare | Cross-origin bodies that page JavaScript cannot verify remain INCOMPLETE |
| Source → Coursera comparison | Coursera XLSX is structural authority; local capture JSON enriches observed content; Brightspace/runtime/recovery evidence remain optional inputs | Use evidence from the same course/stage; incoherent inputs fail closed |
| Owner review | Ordered item/action view, exact item links where observed, item review status/notes and targeted checks | Manual review remains required where evidence is incomplete |
| Before / after | Immutable snapshots, generation isolation, raw baseline, lifecycle guards, conservative repeated-export repair metadata | Repair confirmation never rewrites original audit evidence |
| Planner / catalog operations | Portable Catalog + Master Planner XLSX inputs, partner/date/owner filtering, title-slot reconciliation, owner disambiguation and audit-existing-shell-first next actions | Portable inputs replace the old hard-coded Google Sheet IDs |
| Work-state | Scope, Coursera Redo, Course Outline, Source Audit, Specialization Outline and Content Map state + notes | State tracking does not imply CTI authors external partner artifacts |
| Runtime inventory | Portable RISE/Storyline XLSX input can be applied to matching courses with provenance | Missing inventory stays a warning, never an inferred zero |
| Duplicate handling | Semantic identity guard, conflict-aware preview, stable survivor/newest scan merge, reversible soft archive | Multi-record reconciliation is lossless/rerunnable; shared writes still use per-record optimistic versions |
| Bulk rescan | Updates only one unambiguous existing semantic match; missing/ambiguous files are reported | It never silently creates a new course from a bulk rescan |
| System health / capability view | Active package/audit/migration/duplicate/metadata checks plus current product capability manifest | Historical engine feature flags are reference metadata, not current availability |
| Macmillan | Real XLSX scan/split and retained stage contracts | Replay accepted private master/stage sets as needed |
| Shared team workspace | Access JWT roles, D1 chunked/versioned records and immutable audits | Requires deployed Cloudflare Access/D1 configuration and real-user acceptance |

## Zero-cost Coursera architecture

The default path is:

**Full CTI workspace → Extract → local signed-in Chrome → v6.15.4 capture →
strict local CTI verification → Compare**

Cloudflare Browser Run remains optional advanced infrastructure. It is not
required for the normal workflow and is not a realistic host for long Coursera
captures on the Browser Run Free allowance.

## Intentional retirements

- The old visit-count / last-visit telemetry is retired because it does not
  contribute to evidence integrity and unnecessarily tracks usage.
- The old Gemini advisory-only triage path is retired to preserve the project’s
  zero-cost architecture. Deterministic architecture diagnostics remain and are
  explicitly non-evidentiary.
- The historical `futureMlDataset` flag is not presented as a migrated ML
  service because the archive contains metadata fields but no actual training
  pipeline. Historical fields are retained.

## Historical data

The earlier owner-reported migration imported 430 prepared records, while six
historical QA reports lacked their declared payload rows. Those entries remain
recovery cases rather than fabricated audits. Code cannot reconstruct missing
source bytes. Keep the original export/backup while those cases matter.

## Verification before retiring the old deployment

The code migration is closed, but retire an old operational deployment only
after the intended team has verified:

1. real Cloudflare Access roles and simultaneous shared edits;
2. representative source scans and full comparisons against retained accepted
   evidence;
3. local v6.15.4 Coursera extraction on representative real shells, including
   slow assessments/readings/plugins;
4. required Macmillan private workbooks;
5. recovery backups and the six unavailable historical report cases.

The deterministic repository checks cover rule parity, migration boundaries,
security/storage contracts, source/extractor regressions, build/typecheck and
Worker dry-run. They do not substitute for those private-system acceptance
checks.

[Shared workspace setup](shared-workspace-setup.md)
