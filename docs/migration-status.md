# CTI migration status

The migrated code supports the requested core workflow areas. On 28 September
2026, the owner reported **430 prepared records imported** (308 saved earlier
plus 122 on retry), with **six historical QA reports still unavailable** because
the export did not contain their declared payload rows. The import retains
recovery cases and available original data; it does not turn those entries into
complete reports. Keep the original export and the Apps Script app available.

This is an owner-reported import result, not an independent live audit of every
record or a completed multi-user acceptance test. The interface now follows the
source → comparison → owner review workflow; see the
[UX review and verification](workspace-ux-review.md).

| Workflow                         | Implemented                                                                                             | Remaining verification                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Source/Coursera/XLSX comparisons | Complete retained engine, Brightspace enrichment, optional reading recovery, XLSX structural authority  | Accepted full course-set parity using original XLSX files                        |
| Owner reports                    | Complete canonical report, copy/download, ordered Coursera item/action view, full evidence              | Owner review on retained course findings                                         |
| Source scan and Explore          | Catalogue save/rescan, native XML/PDF scan, hashes, QTI, diagnostics                                    | Broader package corpus parity                                                    |
| Catalogue and permissions        | Local records; shared signed Access JWT, viewer/editor/admin roles, concurrency                         | Verify live role enforcement and simultaneous edits with two real users          |
| Work queue                       | Owner/status/deadline plus ten-step evidence checklist; old checklist linking                           | Reconcile imported work-state records                                            |
| Before/after history             | Immutable audits, first-raw baseline, same-attempt lifecycle, separate cross-attempt observations       | Reconcile imported generations and original source identity                      |
| Macmillan                        | Real XLSX master scan/split, inclusion triage, all three stage contracts, persisted validated workbooks | Replay accepted real master/stage set; import other owners' registered books     |
| Portfolio analytics              | Canonical IFS, vectors, similarity, labor estimates; retained source diagnostics                        | Review populated shared catalogue                                                |
| Existing Google data             | One-time private export, stable-ID import, original-sheet backup, existing-ID skip                      | Reconcile reported import counts and identities; recover six unavailable reports |

Start in **Full CTI workspace → Scan** for a new source, or **Setup** to import
existing records. Select a source course, then use **Compare** with its Coursera
XLSX and capture JSON, attaching Brightspace and reading recovery when available.
Save raw captures under the correct ingestion attempt. Increment the attempt
only after a new ingestion, not a repeated export.

Do not rerun all 15 titles simply because the hosting changed. First reuse one
complete retained set and compare it against the accepted Apps Script report.
Use differences to decide targeted follow-up. Extraction remains in the user's
signed-in LMS; the website does not crawl LMS accounts on their behalf.

## Retire Apps Script only after

1. The intended team can sign in with the correct roles, read shared records and
   save without losing simultaneous edits.
2. Catalogue IDs, owners, source trees, QA runs, generation history and checklist
   records reconcile with the export; inaccessible Macmillan books are resolved.
3. Full report parity is reviewed on the retained course evidence and Macmillan
   output chain. Fixture parity alone is not a 15-title certification.
4. Recovery exports and original evidence files are retained, and a live Pages
   deployment completes the team's workflow.

[Dashboard setup and migration instructions](shared-workspace-setup.md)
