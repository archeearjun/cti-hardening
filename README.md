# CTI evidence hardening

CTI inspects source packages and compares observed ingestion evidence. It preserves the existing IMSCC, Brightspace, Coursera, Macmillan, Explore, work-queue and lifecycle workflows. Content-map and outline generation remain separate workflows.

## TypeScript workspace migration

The `codex/typescript-pages-migration` branch now connects the full comparison
and workbook engines to a TypeScript/React interface. Keep the existing Apps
Script app available until shared setup, data import and parity review are done.

Available workflows:

- Catalogue-linked IMSCC/ZIP/XML scans, source Explore, file hashes, QTI questions,
  PDF evidence, dependencies, structural metrics and retained source versions.
- Full **source + Brightspace + authoritative Coursera XLSX + capture JSON**
  comparisons, optional reading recovery, complete owner text reports and an
  ordered Coursera content/action view.
- Saved immutable QA snapshots, first-raw-baseline protection, same-attempt
  lifecycle review and separately labelled cross-attempt observations.
- Course owners, status, deadlines, work queues and manual evidence checklists.
- Macmillan master XLSX inspection/splitting and the existing Metadata, Merged
  and ContentMap output-validation rules. CTI does not generate those documents.
- Portfolio IFS/workload, source diagnostics, structural vectors, pairwise
  similarity and labor estimates. These are review aids, not quality scores.
- Browser-local IndexedDB storage and an optional shared D1 service with verified
  Cloudflare Access identity, admin/editor/viewer roles and concurrent-edit guards.
- Import of existing Google records and recovery backups; complete report payloads
  and original migration sheets are preserved.

The canonical extractors are **Coursera v6.14.1/schema 34** and
**Brightspace v1.0.5/schema 2**. Processing runs locally; comparisons and Macmillan
QA use cancellable Web Workers. Saving in team mode uploads the resulting record
and evidence to the configured team database. Local records are not shared.

### Deploy on the existing free Pages project

| Field | Value |
| --- | --- |
| Repository | `archeearjun/cti-hardening` |
| Production branch | `codex/typescript-pages-migration` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank |
| Node environment | `NODE_VERSION=24` |

Cloudflare's Git integration builds the static app and the `/functions/api`
service. The service refuses access until D1 and signed-in team identity are
configured. It does not make course records public just because the code is in
a public repository. No user needs to install software on a work laptop.

**Follow [shared workspace setup](docs/shared-workspace-setup.md)** for dashboard
steps, free-plan limits, role configuration, the small Apps Script export helper,
and migration verification. Do not retire the old app based only on a successful
frontend deployment. See [migration status](docs/migration-status.md).

### Development and verification

On a development machine with Node 24:

```sh
npm ci
npm test
npm run build
npm run dev
```

The build generates compatibility code from **42 ordered legacy modules** and
rejects differences from the reviewed `Code.gs`. Rules are retained as JavaScript
inside the typed application; this is not a claim that every legacy function was
rewritten in TypeScript. Workbook and shared-storage adapters replace Google I/O.

- `src/domain/`: workflows, source/capture inspection, records and migration.
- `src/adapters/`: XLSX, byte and XML compatibility.
- `server/` and `functions/`: authenticated API, optimistic saves, immutable audit
  history, chunked artifacts and D1 schema.
- `web/`: React screens, worker clients and local package-processing document.
- `src/legacy/server/`: preserved engine; `src/legacy/manifest.json` fixes its order.
- `tools/generate-owner-report.mjs`: canonical report dependency extraction.

Edit the source modules, not generated files. After an intentional legacy edit,
run `npm run export:gas`, review the diff and update the accepted hash. The Google
entry points retain authorization; `Index.html`, `Index_COPYABLE.txt` and
`Tests.gs` are unchanged by this migration. Full-report parity and the original
regressions are documented in [validation](docs/migration-validation.md).

Browser verification (development only):

```sh
npx playwright install chromium
npm run test:browser:package
npm run test:browser:workspace
```

`CTI_CHROMIUM_PATH` can select an installed Chromium. `CTI_CITC923_FIXTURE` selects
an optional private source replay. `CTI_PRE_MIGRATION_GS` enables a full-comparison
parity test against a pre-refactor engine file. Private course data is never
checked into this public repository.

The package inspector has a 250 MiB archive limit and 24 MiB content-read budget;
XLSX inspection is limited to 25 MiB and two million cells. Shared records are
limited to 32 MiB. Existing extraction/read limits remain explicit evidence gaps;
a successful comparison does not certify uncaptured content or publication.

## Current review

This branch continues `cti-hardening-v8` at `ed6e4cdce588e778aaa389e0dfd1f23d60d5aa73` (CTI v8.0.0, Coursera v6.14.0/schema 34). It is not publication approval or a claim of complete live extraction.

Confirmed corrections:

- Current UI, health, delivery and test identities agree. `Index_COPYABLE.txt` is byte-identical to `Index.html`.
- There is one regression suite, `Tests.gs`. Remove the old `CTI_Regression_Tests.gs` from an Apps Script project before installing `Tests.gs`; do not install both definitions.
- Asset deadlines include response-body reads and hashing. Streamed downloads enforce byte limits. Successful hash reuse preserves rendition query parameters; failed URLs do not poison later retries.
- Assignment traversal uses declared content-part bounds rather than the mounted subset. Typed Text blocks are tracked separately from question ordinals, including the last question in mixed editors.
- Missing required dimensions remain unverified. One matching behavior field cannot conceal another unobserved field. Missing submission evidence is not a confirmed mutation. Written-answer applicability and established per-document transformations remain intact.
- Mixed-number normalization retains the whole-number boundary. Gradebook-link absence alone cannot prove an ungraded quiz.
- ZIP resolution rejects external references and ambiguous normalized paths.

## Report follow-up

QA build `v8.0.0-asset-claim-scope-20260927` corrects report interpretation without changing the embedded extractors:

- An exact XLSX and JSON hash match can replay the immutable raw baseline after later-stage runs. Missing or different hashes and unidentified supplemental recovery inputs retain the stage guard.
- Explicit current attachment failures produce one consistent owner action and a manual-remediation recommendation. Historical claims and independently observed attachments cannot demand a new repair on their own.
- Quoted filenames localize unsupported-attachment diagnostics without duplicating an unmapped task. Original claims remain in the audit trail.
- Learner-facing readiness tasks remain active even when their matching source image is policy-exempt. Destination IDs prevent identical item titles from collapsing distinct checks.
- Equivalent URL syntax is described as preserving the source target, not as literal string equality.
- CML layout adaptations remain informational. Named documents left as local paths because no asset identifier was available become attachment-access checks; a bare filename cannot resolve them. Original classifications remain auditable.
- Duplicate descriptions of the same asset event do not create duplicate repair counts. Separate item/module events remain distinct, and fresh parsing retains all events before storage limits apply.
- Observed AI-grader placeholders in native assignment authoring evidence produce targeted setup reviews even when learner-text extraction correctly excludes editor controls. The report requests inspection before changes.
- Evidence-only readiness keeps its evidence severity. Unmatched source-item guidance checks consolidation and unfinished templates before requesting restoration.

## Repeatable local checks

Use Node.js 22 or later; no packages or credentials are required.

```sh
node tools/check.cjs
node tools/hardening-check.cjs
```

The first command runs 228 FAST and 23 SOURCE_CONTRACT checks, compiles the embedded extractor, and checks the copyable Index. Nine XML-service cases are explicitly skipped. The second runs 20 focused simulations, including 172-question traversal, mixed content parts, duplicate question wording, stalled downloads, cache identity and evidence-gate negatives.

GitHub Actions runs these checks through `npm test`, plus migration tests and the production build, for pushes and pull requests. The local DOM fixture exercises production extraction functions; it does not replace a live Coursera capture.

## Remaining release validation

- Run the native Apps Script FAST and SOURCE_CONTRACT suites after copying the three canonical files into a test project.
- Run the 13 INTEGRATION and 1 FULL_GOLDEN gates with their required Google services and fixtures. These and the nine XML-service cases have not been certified by the Node runner.
- Replay the existing 15-title evidence corpus with this candidate. The repository currently contains code and generic fixtures, not that corpus. The handoff summary is not a substitute for the actual IMSCC, old/new JSON, XLSX and report evidence.
- Only then select targeted live captures for behavior that stored JSON cannot exercise (virtualized editors, fresh plugin configuration and network timing). A new version alone does not require 15 fresh crawls.

Keep deployments and merges separate from validation. The Apps Script production deployment has not been updated by this review.
