# Apps Script parity + workspace UX follow-up — 2026-10-02

## Scope

This follow-up compares the frozen Apps Script workspace and its migration export
contract with the maintained React/TypeScript/Cloudflare application. It focuses
on operator-visible behavior and historical workspace state, not only engine
function parity.

The Apps Script migration export contains:

- every database sheet;
- external runtime evidence keyed by package UUID;
- the previous AUTHORIZED_DOMAIN / AUTHORIZED_EMAILS / EDITOR_EMAILS policy;
- the current user's registered master workbooks; and
- a completion manifest written only after every multipart JSON fragment.

The maintained importer already restored packages, package trees, QA payloads,
work-state/checklists, external runtime evidence and registered master workbooks.
The original export was also retained losslessly as migration backup evidence.

## Gap found in this review

Several old database sheets were preserved only inside the raw migration backup,
not restored as queryable current workspace history:

1. `Package_Scan_History`
2. `Duplicate_Archive`
3. `Catalog_Map`

The previous Apps Script access policy was likewise present in the export but was
not surfaced during migration. That was not byte loss because the full export
backup remained, but it made operational history and security-transition context
harder to use after migration.

## Fix implemented

The migration importer now:

- restores package scan-history rows as typed `legacy-scan-history` operational
  records;
- restores duplicate archive rows as typed `legacy-duplicate-archive`
  operational records;
- retains the old Catalog_Map as a typed `legacy-catalog-map` provenance
  snapshot;
- keeps external runtime evidence attached to its package;
- keeps registered master workbooks as workbook records;
- preserves the old Apps Script access policy as administrator-review migration
  evidence without automatically applying it to Cloudflare Access; and
- continues to retain the complete original export as the recovery source of
  truth.

The current product capability manifest now describes this migration behavior
explicitly.

## Host-specific behavior that remains deliberately different

### Direct Google Sheets creation

The Apps Script `exportMasterManifestAsGoogleSheet` action created a new Google
Sheet directly. The Cloudflare app instead generates and downloads the same
portable Master Manifest as XLSX. This avoids adding a Google OAuth/runtime
dependency to the evidence platform. The business output remains available, but
the one-click Google-host convenience is not reproduced.

### Authorization

Apps Script domain/email/editor properties cannot safely be treated as
Cloudflare Access configuration. The migration now exposes the old policy to an
administrator for review. Cloudflare Access policy plus `CTI_ADMINS` and
`CTI_EDITORS` remain explicit deployment configuration.

### Visit telemetry and advisory Gemini triage

Visit counters remain intentionally retired for privacy. Advisory Gemini triage
remains retired under the zero-cost policy; deterministic architecture
diagnostics are the current replacement and do not become evidence verdicts.

### Destructive duplicate deletion

The current app keeps the safer replacement: duplicate reconciliation
soft-archives records and retains evidence/history rather than deleting them.

## UX findings

The migrated workspace had good evidence-level UX but weak global information
architecture:

- eleven workflows were presented as one flat sidebar;
- the per-course evidence checklist was named **Work queue** while the actual
  planner/catalog next-action queue lived in **Operations**;
- operators landed in the catalogue instead of seeing urgent blockers,
  overdue work and migration recovery status;
- migration-specific operational history and old access-policy context were not
  discoverable after import.

## UX changes implemented

- Added a new **Overview** landing page with active-course, QA-review, blocked,
  overdue and migration-recovery KPIs.
- Added a blocker/overdue/QA-review **Needs attention** list.
- Added selected-course resume actions for Compare, Explore and the evidence
  checklist.
- Grouped navigation into **Workspace**, **Course evidence**, and
  **Tools & admin** while preserving existing workflow button names.
- Clarified inside **Work queue** that it is the per-course evidence checklist
  and linked directly to the planner queue in Operations.
- Surfaced migrated scan/duplicate/catalog history in Operations.
- Surfaced migrated Apps Script access-policy counts and an administrator-only
  detail view in Setup.
- Added responsive styles for the new dashboard, priority list and migration
  continuity panels.

## Verification additions

The migration regression suite now checks that:

- legacy runtime evidence still attaches to the source package;
- scan history and duplicate archive rows become typed operational records;
- catalog-map provenance is retained;
- access-policy email lists are normalized/deduplicated;
- public record summaries expose only the policy domain and counts, not the
  complete email lists; and
- the policy is explicitly retained for review rather than automatically applied.

Browser UX checks should cover Overview on desktop/mobile in addition to the
existing Catalogue, Compare, History, Work queue, Operations, Macmillan,
Analytics and Setup flows.

## Remaining external acceptance boundaries

Automated CI can verify TypeScript, deterministic rules, browser UX and migration
contracts. It cannot certify private Coursera/Brightspace courses, SSO/MFA,
third-party cross-origin plugins, or a production Cloudflare Access policy
without those external systems. Those boundaries remain fail-closed rather than
being simulated into a pass.
