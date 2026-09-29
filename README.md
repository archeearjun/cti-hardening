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
and `test:browser:owner`. Install Playwright Chromium or set `CTI_CHROMIUM_PATH`
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

After checks pass on `main`, CI fast-forwards the same commit to the existing
Pages production branch. It refuses to overwrite divergent work. Cloudflare's
Git integration then builds the app and `/functions/api` service. Check its
separate deployment result before treating a commit as live.

Follow [shared workspace setup](docs/shared-workspace-setup.md) for Cloudflare
Access identity, D1, roles and data import. Public source code does not make
course records public. Local IndexedDB records are not team-shared records.

## Workflows and evidence limits

The app supports source package scanning and Explore, full source/Brightspace/
Coursera comparisons, ordered owner review, immutable before/after audits,
work queues, Macmillan workbook validation, and portfolio diagnostics. It does
not generate partner content maps or specialization outlines.

Coursera extraction remains **v6.14.7/schema 34** and Brightspace remains
**v1.0.8/schema 2**. The module refactor preserves their capture rules; new captures
are not required simply because the code layout changed. Extractors run in the
user's signed-in LMS. Comparisons/workbook checks run in cancellable workers.

Package inspection is bounded to 250 MiB archives and a 24 MiB content-read budget;
XLSX inspection to 25 MiB and two million cells; shared records to 32 MiB.
Uncaptured or inaccessible content stays an evidence gap. Navigation is separate
from fidelity, and plugin diagnostic captures cannot certify a full course.

See [migration status](docs/migration-status.md), [source-item/plugin evidence](docs/source-item-plugin-evidence.md),
and [private evidence batch replay](docs/evidence-corpus.md). Historical migration
notes describe earlier checkpoints; the development map describes current source.
