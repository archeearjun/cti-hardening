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

The gateway also exposes an isolated [Role Play & Dialogue preview](docs/activity-designer.md):
local bulk evidence, compact packets for an approved AI chat, validated result
cards and downloadable saved work. It does not call a model API or edit Coursera.
Live capture coverage still requires verification; it is not generally certified.

The deployed site reserves the full CTI workspace for the verified Cloudflare
Access identity `aarjun@coursera.org`. Other permitted signed-in users see only
Role Play & Dialogue. The server also blocks their direct requests to private
pages, assets, downloads and APIs. See [site access](docs/site-access.md) for
configuration, verification and the limits of this restriction.

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

`npm run generate` builds the extractor, extension and activity preview delivery assets. It runs
automatically in development startup, tests and builds. Run it again after editing
an extractor during a development session. Generated assets are ignored by Git.

Browser checks are available as `test:browser:package`, `test:browser:workspace`,
`test:browser:ux`, `test:browser:owner`, and `test:browser:extractor`. Install Playwright Chromium or set `CTI_CHROMIUM_PATH`
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
Git integration then builds the app, site-wide access middleware and API service. Check its
separate deployment result before treating a commit as live.

Follow [shared workspace setup](docs/shared-workspace-setup.md) for Cloudflare
Access identity, D1, roles and data import. Public source code does not make
course records public. Local IndexedDB records are not team-shared records.

## Assignment owner workflow

The [unified Assignment workspace](docs/unified-assignment-workspace.md) provides
one course inbox, source exploration, item lifecycle/history, source-linked draft
deliverables and locally evaluated advisory learning. It preserves original evidence
and exposes unresolved scope instead of inventing content. Source Markdown/text
can form an explicitly limited document baseline. Verified native direct-capture
inventories can supply structure without an independent XLSX; legacy captures
still require the workbook. Applying changes in an LMS remains an external action
that must be recaptured and verified.

## Workflows and evidence limits

The app supports source package scanning and Explore, full source/Brightspace/
Coursera comparisons, ordered owner review, immutable before/after audits,
planner/catalog-driven work queues, operational state, duplicate reconciliation,
runtime inventories, Macmillan workbook validation, and portfolio diagnostics.
Course/specialization outlines and content maps have source-linked structural
drafts, version history and owner decisions. Narrative partner artifacts and
actual LMS changes remain separate from these retained-evidence drafts.

The owner checklist excludes instructor resources and archives by default, with
per-item relevance choices and a separate retained reference view. It follows
recorded modules and lessons and shows baseline/latest learner-time totals for
content maps. See [scope and time behavior](docs/audits/owner-scope-time-2026-10-05.md)
for refresh steps and evidence limits.

Brightspace capture is **v1.1.0/schema 2**, with **CTI Brightspace capture** as its
primary saved bookmark and a console fallback. It retains bounded original
same-origin HTML, caption text and files with native source bindings and hashes;
external/LTI/runtime content and inaccessible question banks remain explicit
gaps. Local checkpoints support recovery and download, while each current
capture/resume attempt re-reads metadata and bodies. See
[Brightspace bookmark capture](docs/brightspace-bookmark-capture.md) for setup,
limits and freshness. Earlier v1.0.8 captures and audit documents remain
historical evidence, without retroactive completeness claims.

The rendered Coursera extractor is **v6.15.33/schema 35**. The v6.15.14 release
introduced short, durable local capture batches
and requires a reload between batches to release accumulated page state. Saved
items are restored on the next paste; primary and retry visits share the same
renderer budget. Aggregate network capture remains bounded.
See [runtime stability](docs/extractor-runtime-stability.md) for the validation and
live-run limits. It retains explicitly labeled learner-time capture and rendered choice labels. It reads rendered choice labels across boxless question and option containers without inferring answer keys. Uncaptured choices remain technical capture gaps. It keeps explicit no-silent-miss accounting, bounded slow-item waits,
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

Package inspection accepts source archives up to 640 MiB using bounded file ranges
and 2 MiB fingerprint chunks, with a 24 MiB limit on each content read. Larger
media remain listed with explicit evidence gaps instead of blocking the package.
XLSX inspection is bounded to 25 MiB and two million cells; shared records to 32 MiB.
Uncaptured or inaccessible content stays an evidence gap. Navigation is separate
from fidelity, and plugin diagnostic captures cannot certify a full course.

See [migration status](docs/migration-status.md), [source-item/plugin evidence](docs/source-item-plugin-evidence.md),
and [private evidence batch replay](docs/evidence-corpus.md). Historical migration
notes describe earlier checkpoints; the development map describes current source.
