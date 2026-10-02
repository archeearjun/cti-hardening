# CTI evidence integrity platform

CTI inspects source course packages and compares them with Brightspace, Coursera
capture JSON and authoritative Coursera XLSX exports. It retains evidence gaps,
immutable audit history, source navigation, and owner review actions.

## Maintained application

**Start from `main`.** This is the React/TypeScript application deployed on
Cloudflare Pages. The earlier Apps Script application is frozen under
[`archive/apps-script`](archive/apps-script/README.md) for regression and migration
reference. There is no Code.gs export or legacy engine concatenation in the
normal development/build workflow.

The evidence engine now uses native JavaScript feature modules with explicit
imports. The app, workflow boundaries, shared API and storage use TypeScript.
This is a modular refactor, not a claim that every rule was rewritten in TypeScript.

Read the [development map](docs/development.md) to find the relevant source and
focused checks. [AGENTS.md](AGENTS.md) gives concise instructions for coding agents.

**Migration status:** the active application now has a working current
implementation, architecture-appropriate replacement, or explicit retirement for
every audited Apps Script function group and declared legacy capability. The
[Code.gs audit](docs/audits/code-gs-audit.md) records those dispositions and keeps
the frozen archive separate from current product availability. Run
`npm run audit:parity` to verify the ledger and retained rule bodies.

| Area | Source |
| --- | --- |
| UI and owner review | `web/`, `src/domain/owner-actions.ts` |
| Source-item navigation | `src/domain/source-navigation.ts`, `owner-urls.ts` |
| Coursera and Brightspace extractors | `src/extractors/coursera/`, `brightspace/` |
| Assessment, matching, provenance and lifecycle rules | `src/engine/` |
| Package XML/ZIP/QTI/PDF scanning | `src/source/` |
| Owner report text | `src/reporting/` |
| Typed workflows and local/shared records | `src/domain/`, `src/adapters/` |
| Authenticated Cloudflare API and D1 | `server/`, `functions/` |
| Coursera extraction | `src/domain/coursera-local-extraction.ts`, `web/LocalCourseraExtraction.tsx`, optional `workers/coursera-extractor/` |
| Migrated operations / planner / catalog / runtime | `src/domain/operations.ts`, `web/OperationsWorkspace.tsx` |
| Current product capability truth | `src/domain/product-capabilities.ts` |

## Develop and verify

Use Node 24:

```sh
npm ci
npm run dev
```

For focused edits:

```sh
npm run test:navigation
npm run test:extractors
npm run test:engine
```

Before publishing changes across feature boundaries:

```sh
npm test
npm run build
```

`npm run generate` builds only the standalone extractor delivery assets. It runs
automatically in development startup, tests and builds. Run it again after editing
an extractor during a development session. Generated assets are ignored by Git.

Browser checks are available as `test:browser:package`, `test:browser:workspace`,
`test:browser:ux`, and `test:browser:owner`. Install Playwright Chromium or set `CTI_CHROMIUM_PATH`
to an installed binary. Tests use synthetic course evidence; private course
captures are never committed to this public repository.

## Cloudflare deployment

| Setting | Value |
| --- | --- |
| Maintained development branch | `main` |
| Existing Pages production branch | `codex/typescript-pages-migration` |
| Build command | `npm run build` |
| Output | `dist` |
| Framework preset / root | None / blank |
| Node environment | `NODE_VERSION=24` |

After both deterministic and built-browser checks pass on `main`, CI
fast-forwards the same commit to the existing Pages production branch. It refuses to overwrite divergent work. Cloudflare's
Git integration then builds the app and `/functions/api` service. Check its
separate deployment result before treating a commit as live.

Follow [shared workspace setup](docs/shared-workspace-setup.md) for Cloudflare
Access identity, D1, roles and data import. Public source code does not make
course records public. Local IndexedDB records are not team-shared records.

## Workflows and evidence limits

The app supports source package scanning and Explore, full source/Brightspace/
Coursera comparisons, ordered owner review, immutable before/after audits,
planner/catalog-driven work queues, operational state, duplicate reconciliation,
runtime inventories, Macmillan workbook validation, and portfolio diagnostics.
Course/specialization outline and content-map **state tracking** is restored; CTI
does not claim to author partner content artifacts that were external to the
evidence workflow.

Coursera extraction is **v6.15.7/schema 35** and Brightspace remains
**v1.0.8/schema 2**. Coursera v6.15.7 keeps explicit no-silent-miss accounting, bounded slow-item waits,
strict assessment/plugin/empty-reading contracts and checkpointable browser traversal. Certified
direct-editor routing avoids redundant outline round-trips. Collapsed assignment text blocks are bound
to their exact visible assignment outline by fragment identity even when Coursera portals the outline
and content under different DOM branches, so learner text reaches the native-assignment payload instead
of remaining diagnostics-only. Fully traversed Practice assessments with no observed correctness markers
remain explicit answer-applicability reviews instead of identical retries. Terminal cross-origin plugin
states and failed direct Discussion routes short-circuit earlier without weakening their evidence status.
QA reporting distinguishes unreached editors from capture-contract review states and does not recommend
another Coursera extraction when only source answer evidence remains unresolved. The zero-cost normal workflow is
**Full CTI workspace → Extract → local Chrome**: run the current generated bundle
inside the signed-in Coursera authoring tab, then return the downloaded JSON to CTI.
CTI applies the same strict completion verifier locally before loading the capture
into Compare. The Cloudflare Browser Run path remains optional for deployments
that intentionally provision enough remote-browser quota; it is not required for
the normal workflow. Comparisons/workbook checks run in cancellable workers.

Package inspection is bounded to 250 MiB archives and a 24 MiB content-read budget;
XLSX inspection to 25 MiB and two million cells; shared records to 32 MiB.
Uncaptured or inaccessible content stays an evidence gap. Navigation is separate
from fidelity, and plugin diagnostic captures cannot certify a full course.

See [migration status](docs/migration-status.md), [source-item/plugin evidence](docs/source-item-plugin-evidence.md),
and [private evidence batch replay](docs/evidence-corpus.md). Historical migration
notes describe earlier checkpoints; the development map describes current source.
