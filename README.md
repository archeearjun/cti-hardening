# CTI evidence hardening

CTI inspects source packages and compares observed ingestion evidence. It preserves the existing IMSCC, Brightspace, Coursera, Macmillan, Explore, work-queue and lifecycle workflows. Content-map and outline generation remain separate workflows.

## Browser migration preview

The `codex/typescript-pages-migration` branch adds a TypeScript/React app for static Cloudflare Pages hosting. It is a working **package and capture inspection preview**, not a replacement for the full Apps Script application.

Available in the preview:

- Inspect local IMSCC/ZIP packages or manifest-only XML; explore the source tree and download complete scan evidence. Reuses the canonical source scanner for QTI questions, assignment attachments, PDF text, hashes, dependencies and structural metrics.

- Inspect Coursera fingerprint captures and run the existing captured-readiness rules, with an explicit capture stage and partner policy.
- Inventory Brightspace topics and question definitions while retaining uncertainty about complete question-bank coverage.
- Copy or download the exact existing Coursera v6.14.0/schema 34 and Brightspace v1.0.5/schema 2 extractors. This migration does not introduce a new extractor release.
- See processing phases and elapsed minutes, cancel processing, filter findings and download a clearly labelled preview review.
- Process captures in a Web Worker on the user's computer. No course captures are uploaded or saved by this preview.

Continue using Apps Script for catalogue-linked rescans, source/destination comparison with XLSX structure, shared course records and permissions, lifecycle and work queues, Macmillan workflows, and complete owner reports. Those workflows are retained in the repository but are **not yet connected to the new browser app**. Browser inventory does not establish source fidelity, question completeness or publication readiness. Team members can use the same deployed URL, but this preview does not share their results.

### Cloudflare Pages settings

Push the reviewed migration branch before selecting it in Cloudflare. Use these values in **Pages**, not a Workers application:

| Field | Value |
| --- | --- |
| Repository | `archeearjun/cti-hardening` |
| Production branch for this preview project | `codex/typescript-pages-migration` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank (repository root) |
| Environment variable | `NODE_VERSION=24` |

The Vite configuration uses `web/` internally; do not enter `web` as Cloudflare's root directory. Cloudflare installs dependencies from the repository's lockfile. The build exports only the `dist` directory, not course evidence or the entire repository. No Cloudflare Functions, paid database, API key or cloud compute is required for this preview. Static Pages requests are free under Cloudflare's current plan; build and deployment limits still apply. See [Git setup](https://developers.cloudflare.com/pages/get-started/git-integration/) and [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/).

Save and Deploy only after the reviewed branch is available on GitHub. A successful deployment supplies a `pages.dev` URL you can share. No software needs to be installed on users' work laptops. Future pushes to the selected production branch automatically deploy; use separate review branches for subsequent work.

### Development and verification

On a development machine with Node 24:

```sh
npm ci
npm test
npm run build
npm run dev
```

The preview adds nine migration tests to the existing 268 local checks. Google-only XML, integration and full-golden gates remain unverified in Node. Browser checks and focused private-capture replays are recorded in [migration validation](docs/migration-validation.md).

The package inspector accepts archives up to 250 MiB and retains existing scanner budgets and limitation markers. It does not save a catalogue rescan. It prefers the root manifest and rejects ambiguous cartridges; content reads over 24 MiB are bounded.

The preview accepts JSON up to 40 MiB and 20,000 Coursera fingerprints. This is an explicit preview budget, not a limit on the original application. The readiness engine caps displayed details at 160 findings; the preview reports displayed findings and warns when detail has been truncated. Results are temporary until downloaded.

### Editing without whole-file rewrites

- `src/domain/`: typed capture review and result contracts.
- `src/adapters/`: browser byte operations; unsupported Google services fail explicitly.
- `src/worker/`: background processing and progress messages.
- `web/`: React interface and styles.
- `src/legacy/server/`: 40 ordered compatibility modules reconstructing the GAS engine. The package-analysis body is shared through a pure helper; the Google entry point retains its authorization check. These remain JavaScript; they have not all been converted to TypeScript.
- `src/legacy/manifest.json`: module order, exported functions and accepted baseline hash.

`npm run generate` creates the ignored compatibility engine used by the worker and rejects differences between the module source and `Code.gs`. `npm run export:gas` rebuilds `Code.gs` from those modules after an intentional legacy change. Review that diff, update the accepted baseline metadata only for a reviewed change, then rerun all checks. Do not rerun the one-time split script or edit generated files. The initial migration left the GAS trio unchanged. The package step adds a pure analysis helper to `Code.gs` while retaining the authorized Google wrapper. `Index.html`, `Index_COPYABLE.txt` and `Tests.gs` remain unchanged. No Apps Script deployment is required to use the browser inspector.

Migrate one workflow at a time behind these contracts, with parity checks against saved captures. The package inspector now runs locally using a disposable browser document and a self-hosted PDF worker. Full comparison is the next major engine integration; shared persistence and authentication require explicit service adapters before replacing the team application.

### Browser package checks

On a development machine only (not required for users):

```sh
npm run build
npx playwright install chromium
npm run test:browser:package
```

`CTI_CHROMIUM_PATH` can select an existing Chromium executable. `CTI_CITC923_FIXTURE` optionally selects the private saved CITC923 package for the additional inventory replay. No private course data is checked into this public repository. See [migration status](docs/migration-status.md) for the remaining full-app scope.

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

The first command runs 228 FAST and 23 SOURCE_CONTRACT checks, compiles the embedded extractor, and checks the copyable Index. Nine XML-service cases are explicitly skipped. The second runs 17 focused simulations, including 172-question traversal, mixed content parts, duplicate question wording, stalled downloads, cache identity and evidence-gate negatives.

GitHub Actions runs these checks through `npm test`, plus migration tests and the production build, for pushes and pull requests. The local DOM fixture exercises production extraction functions; it does not replace a live Coursera capture.

## Remaining release validation

- Run the native Apps Script FAST and SOURCE_CONTRACT suites after copying the three canonical files into a test project.
- Run the 13 INTEGRATION and 1 FULL_GOLDEN gates with their required Google services and fixtures. These and the nine XML-service cases have not been certified by the Node runner.
- Replay the existing 15-title evidence corpus with this candidate. The repository currently contains code and generic fixtures, not that corpus. The handoff summary is not a substitute for the actual IMSCC, old/new JSON, XLSX and report evidence.
- Only then select targeted live captures for behavior that stored JSON cannot exercise (virtualized editors, fresh plugin configuration and network timing). A new version alone does not require 15 fresh crawls.

Keep deployments and merges separate from validation. The Apps Script production deployment has not been updated by this review.
