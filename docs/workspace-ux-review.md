# Workspace UX review — 28 September 2026

This change compares the original Apps Script interfaces in `Index.html` and
`Code.gs` with the migrated application. It changes presentation and input
state, not the accepted extraction or QA engine. The canonical legacy modules,
extractor delivery, schemas and report generator are unchanged.

## Original systems and their current interface

| System                    | Original workflow                                                                                                    | Migrated interface and changes                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source inspection         | Inspect an IMSCC/ZIP/XML before ingestion; retain hierarchy, QTI, file hashes, text and dependencies                 | Scan saves a new course or a rescan. Explore now renders the saved hierarchy, searchable by title/path/type, with readable excerpts, files and question counts. Original JSON and diagnostics remain downloadable.                                              |
| Course directory          | Find source packages; assign owners, status and deadlines; explore or rescan                                         | Catalogue now has partner/status filters, 25-row pages, real record counts and direct course actions. The selected course and storage mode stay visible across workflows.                                                                                       |
| Post-ingestion comparison | XLSX supplies structure, Coursera JSON supplies captured payload, Brightspace enriches source evidence               | Compare groups destination files, source evidence and snapshot context. Changing courses clears all four file inputs, stage and capability choices. It retains generation selection from that course’s saved history.                                           |
| Assignment owner review   | Ordered destination outline, policy-aware actions, unmapped source items and full report                             | Reports lead with the engine’s actual headline and separate fidelity/coverage. Coursera view preserves order and filters by finding status. Unmapped source findings remain visible under destination filters. Full report and JSON exports are never filtered. |
| Snapshot history          | Preserve original raw baselines, generations and observed before/after differences                                   | History lists readable times/generations/stages before the selected report. Opening/completing a report moves focus to it. Changing the snapshot pair clears obsolete comparison results.                                                                       |
| Owner work queue          | Checklist tracks the evidence pipeline; ticks do not change verdicts                                                 | Selected checklist appears above the queue with a labelled step count, independently of evidence coverage. Queue course names are actionable; search finds the next course.                                                                                     |
| Macmillan                 | Source master scan, one-to-four boundaries, exclusion triage, then QA of external Metadata/Merged/ContentMap outputs | Separate interface component, explicit baseline and stage context, readable validation outcome plus full evidence. Switching masters resets boundaries, inclusion choices, stage and output files. Only prepared specialization baselines can run stage QA.     |
| Portfolio analysis        | Canonical structural vectors, IFS, labor estimates, lexical and z-score diagnostics                                  | Readable profile table and closest structural matches. Explanations retain the distinction between workload/review aids and evidence of quality. Full computed output remains available.                                                                        |
| Shared data and migration | Google Sheets/Drive persistence, authorization and historical report chunks                                          | Existing local/shared storage adapters and permissions are retained. Connection state is explicit. Import progress includes elapsed time, record/chunk status and a stop control. Recovery cases show their course names and retain source run IDs.             |

## Deliberate boundaries

- CTI inspects material and verifies external work. It does not generate content
  maps or outlines and does not become the Smart Ingestion service.
- A destination outline is evidence in Coursera order, not a rendered learner
  screenshot. An excerpt is not proof of complete plugin/runtime capture.
- Source dependencies, hidden carriers, policy exemptions and incomplete
  evidence keep their canonical verdicts. This UI does not relabel them as
  missing content or manufacture a completion percentage.
- Google-only catalogue/planner integrations, Drive automations and advisory AI
  paths have not acquired equivalent new service integrations in this change.
  This review does not claim complete feature parity for every legacy button.
- Large source diagnostics and item JSON are formatted only when opened; full
  evidence downloads preserve the original values.

## Verification

- `npm run build` / TypeScript validation.
- `npm test`: retained engine, source contracts, extractor safeguards, source
  scanner, migrations, permissions, concurrency and workflow tests.
- `npm run test:browser:workspace`: real browser import/recovery, comparisons,
  full report download, checklist/history persistence, Macmillan split/export,
  analytics, concurrency and narrow-screen layout.
- `npm run test:browser:package`: real XML/PDF/QTI package inspection, malformed
  input, cancellation, search/export and mobile layout.
- `npm run test:browser:ux`: a synthetic 62-course catalogue, combined filters,
  source explorer, course/workbook input isolation, owner finding filters,
  preserved full downloads, focus and 390px layouts.

Browser checks use synthetic evidence and a temporary local Chromium binary.
They do not certify all 15 private courses, resolve the six missing historical
reports, or prove the live shared deployment has completed its team acceptance
checks. Those remain separate evidence and operational tasks.
