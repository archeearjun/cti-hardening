# Full CTI migration status

The destination is the complete CTI application at one shared URL. The current
site is an incremental migration preview, not a reduced replacement approved
for full audits. Content maps and outlines remain outside CTI’s purpose.

| Workflow | Browser site today | Remaining work |
| --- | --- | --- |
| Coursera and Brightspace extractor delivery | Existing canonical scripts can be copied or downloaded | Further extraction changes remain separate releases, tested against saved and targeted live evidence |
| Capture inspection | Coursera captured-readiness rules and Brightspace inventory | Full comparison with source evidence and XLSX-authoritative titles/structure |
| IMSCC and manifest inspection | Local source scan, QTI, file hashes, PDF evidence, dependencies and structural metrics | Broader source corpus parity; save/replace catalogue-linked rescans |
| Explore | Search and inspect the currently selected package’s structure and evidence | Connect the existing shared catalogue, owner view and cross-course analytics |
| IFS and structural metrics | Existing calculation retained in package scan; IFS displayed | Shared portfolio context, vector comparisons, full statistical presentation |
| Full owner reports | Not available | Source/destination comparison, action policy and complete report rendering |
| Before/after lifecycle | Not available | Snapshot lineage, immutable baselines, historical reports and attribution |
| Work queue and checklist | Not available | Shared records, owners, concurrency and progress tracking |
| Macmillan workflows and document QA | Not available | Port workbook handling and preserve all existing validation rules |
| Google records and permissions | Existing app only | Select/configure free shared storage and authentication, migrate records, verify role enforcement and recovery |

## Use the current site

1. **Review a capture:** select a complete Coursera or Brightspace JSON, select
   its stage and partner, then click **Review capture**. Download the result.
2. **Inspect a package:** choose the original IMSCC or ZIP, then click
   **Inspect package**. Review progress and elapsed time, explore items, and
   download package evidence. An XML manifest supplies structure only.
3. **Get an extractor:** copy the relevant script and run it in your own
   signed-in LMS, as before. The site does not sign into or crawl an LMS for you.

These operations do not upload course files or share results with teammates.
Results in this preview are temporary until downloaded. A local inspection
does not update the catalogue or replace a recorded rescan.

## Retirement criteria for Apps Script

Retire the old app only after all of the following are verified:

- Full IMSCC/Brightspace/Coursera/XLSX comparisons and owner actions agree with
  the accepted engine on the retained corpus, with differences explained.
- Existing catalogue, owners, histories and checklist records are migrated
  without losing identity or lineage, and a recovery export is retained.
- Team sign-in, roles, updates and concurrent edits are tested.
- Macmillan, lifecycle and shared portfolio workflows are available.
- A live deployment is verified on the free configuration and the team can
  complete its work without the Apps Script application.

The static Cloudflare Pages site alone does not replace Google’s shared data
and authentication services. That service configuration remains outstanding;
browser-local data must not be passed off as a shared database.
