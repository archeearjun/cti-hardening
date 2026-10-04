# Item links, accessible selection and operational mapping review

Reviewed against main `5965b737cb915b3115422c776888fc5363e3ad5a` on 2026-10-04.
This increment addresses the reported authoring links, UI access and operational
spreadsheet integration. It is not a new certification of the entire audit engine
or every external LMS.

## Confirmed problems and implemented changes

| Location | Evidence and impact | Severity | Correction and verification |
| --- | --- | --- | --- |
| `owner-urls.ts` | `/content/edit?itemId=…` can stop at the course shell; a generic diagnostic route was accepted before a typed recovery route. | High: broken item workflow | Accept matching typed routes first, including original content snapshots. Use established Reading/Plugin/Discussion route families for older reports. Unknown editor types have a labelled course fallback and an exact course/item validated manual editor URL for focused checks. Navigation tests cover wrong hosts, wrong identities, query-only routes and arbitrary observed editor types. |
| `content-evidence.ts`, `OwnerEvidence.tsx` | Original content retained only the course page URL; navigation did not consume saved item routes. | Medium | Save typed item locations in new/hash-bound supplemental content; owner cards consume them without mutating audit findings. Existing snapshots remain readable. |
| Course, workbook, partner and before/after selectors | Long option lists had no search. | Medium | Labelled search with native selects; title/filename/owner/partner/ID terms, result announcements, Escape clearing, no implicit selection changes. Static short status/mode menus remain native. |
| History, operations, archived courses and extraction jobs | Large lists were hard to locate; saved operational inputs silently stopped at 50. | Medium | Add searches and saved catalogue/planner row inspection; preview/detail tables paginate by 50. Existing source, findings, course catalogue, question and checklist searches retained. |
| `App.tsx`, CSS, tables, Operations bulk upload | Missing dedicated skip link; weak secondary text/focus contrast; overflow tables lacked keyboard focus; bulk rescan file input lacked a label. | Medium | Skip-to-main, darker focus/secondary text, larger coarse-pointer targets, explicit upload label, table header scopes and focusable overflow regions. Existing reduced-motion and responsive rules retained. |
| `OperationsWorkspace.tsx`, operational parsers | Imports assumed first tab/first row and fixed headers; no mapping preview; invalid planner rows could silently disappear; catalogue comments were dropped. | High: misleading work queue | Choose sheet/header/columns, inspect searchable preview, reject malformed rows visibly, explicit acknowledgement before skipping, preserve comments and source rows. Save file hash, sheet, column map, optional original Sheet URL and import diagnostics. |
| Planner count parsing | Blank count became zero. | Medium | Preserve unknown as null; display unknown count and warn that known totals do not establish complete assignment coverage. Zero remains zero. |
| `buildPortableWorkQueue` | Explicit course-reference columns were ignored; matching only catalogue code could miss a differently named IMSCC. Same-date owners were last-row-wins. | High: wrong ownership or source match | Join explicit reference/filename within partner, retain ambiguity, expose catalogue and planner owners separately, show catalogue comments/source row. Conflicting latest-date owners require review. Do not change saved course metadata or QA conclusions. |

## Review coverage

- Traced owner task construction, source/destination navigation, item-check identity
  guards, content snapshot creation/loading and owner-card links. Inspected actual
  captured route evidence across **all 94 TRDE120 items**: 65 supplement, 26 project,
  2 plugin, 1 discussionPrompt. All resolve to their exact IDs; Area resolves to
  `/content/item/supplement/ReprH`. This is route-evidence verification, not a live
  authenticated opening test of 94 pages.
- Inventoried selection/input controls across every first-party `web/*.tsx` file.
  Reviewed the main workspace, Macmillan, operations, source explorer, owner report,
  capture/extraction and shared styles at their interactive boundaries. Applied
  targeted changes above. This is not a line-by-line re-audit of unchanged backend
  authentication, extraction algorithms or audit rules.
- Traced catalogue/planner imports through saved operation records, list summaries
  and work-queue matching. Regression tests cover non-first worksheets, shifted
  headers, duplicate headings, invalid dates/counts, missing owners, retained
  comments, zero versus unknown, explicit filenames, duplicate packages and
  conflicting same-day owners.
- Browser UX checks exercise keyboard course selection, filtering without losing
  selection, clear/no-match states, visible-control labels, import review and
  desktop/mobile journeys. CI also runs the existing package, workspace, owner
  evidence and assessment-choice browser suites. Local browser execution was not
  available in this session; use the PR CI results for browser outcomes.
- No change to frozen Apps Script, source-fidelity rules, publication gates,
  extraction completeness rules, or permissions. Catalogue/planner matches are
  operational evidence, not proof of course-content completeness.

## Official spreadsheets and remaining limits

All three user-supplied Google Sheets returned `403 PERMISSION_DENIED` through the
connected Google account. Their tab names, headers, values, owners and comments
were **not read or validated**. Header aliases in this change are general import
conveniences, not assertions about those private workbooks. No private sheet data
is checked into this repository.

To validate the real mapping, export each catalogue and the daily planner as XLSX
and import it via Operations, or provide those files for review. XLSX preserves
multiple tabs. Choose the correct sheet/header, confirm the columns, inspect the
rejected rows, then save. Keep NAIT and Marshall catalogues under their respective
partner names; retain the planner's Partner column. Use the optional original
Sheet URL for provenance. Imports are dated snapshots, not live Google sync, and
never write back to the official sheets. Reimport after planner changes.

Further verification requires authenticated LMS access, the actual workbooks,
and manual screen-reader use (for example NVDA/VoiceOver). Automated checks do not
establish full WCAG conformance. Formula recalculation, merged-cell layouts and
unrecognized institution-specific course references need real-workbook review.

No database migration or new environment secret is required. Existing imported
records remain readable; reimport is needed to retain newly supported comments,
column provenance and explicit course references.
