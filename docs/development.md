# CTI development map

The maintained app uses React/TypeScript for its interface, workflows and storage,
with native JavaScript modules for the retained evidence rules. Functions import
their dependencies explicitly; there is no ordered legacy manifest, engine
concatenation, or dependency on Code.gs/Index.html in the Cloudflare build.

## Where to change a feature

| Change | Maintained source | Focused check |
| --- | --- | --- |
| Source item links, captured topic identity, course URLs | `src/domain/source-navigation.ts`, `owner-urls.ts` | `npm run test:navigation` |
| Owner tasks, manual review | `src/domain/owner-actions.ts`, `web/OwnerActionCard.tsx` | `npm run test:navigation` |
| Focused item/plugin checks | `src/domain/item-check.ts`, `plugin-check.ts` | `npm run test:navigation` |
| Coursera capture | `src/extractors/coursera/` | `npm run test:extractors` |
| Brightspace capture | `src/extractors/brightspace/` | `npm run test:extractors` |
| Source topic matching and source assessment definitions | `src/engine/source/brightspace-matching.js`, `brightspace-assessment.js` | `npm run test:engine` |
| Assessment questions, answers, behaviour, rubrics | `src/engine/assessment/` | `npm run test:engine` |
| Assets, links, text matching and repackaging | `src/engine/matching/` | `npm run test:engine` |
| Ingestion claims and current-state resolution | `src/engine/provenance/` | `npm run test:engine` |
| Comparison orchestration and lifecycle | `src/engine/comparison/`, `lifecycle/`, `src/domain/workflows.ts` | `npm run test:engine` |
| Owner report text | `src/reporting/` | `npm run test:engine` |
| Source ZIP, XML, QTI and PDF scanning | `src/source/`, `src/domain/package-scan.ts` | `npm run test:browser:package` |
| Workbook/Macmillan checks | `src/engine/workbook/`, `src/adapters/workbook.ts` | `npm run test:engine` |
| Shared records, authentication and API | `server/`, `functions/`, `src/domain/workspace-*` | Shared-store/HTTP tests; `npm test` |\n| Background Coursera browser jobs and strict completion gate | `workers/coursera-extractor/`, `src/domain/coursera-background-extraction.ts`, `web/CourseraExtractionWorkspace.tsx` | `tests/coursera-background-extraction.test.mjs`; `npm run worker:check` |

For example, a source navigation fix can change `source-navigation.ts` and its
focused test. It does not change any extractor, engine bundle, or Apps Script file.
Use `rg -n 'functionName' src/engine src/extractors` to locate specific rules.

## Engine and service boundaries

`src/engine/index.js` composes the existing public API from independently imported
feature modules. Most functions operate directly on supplied evidence. The ten
functions needing byte/XML services use explicit factories; `bind-services.js`
caches bindings separately for each supplied service object. No engine instance
can replace another instance's XML parser.

The old late overrides have become ordinary base functions and explicit wrapper
functions in their owning modules. Their call order no longer depends on the
position of a source file. `npm run check:modules` checks missing imports,
undeclared names, duplicate bindings and illegal import assignments. It does not
pretend all retained JavaScript has complete static data types. Strict TypeScript
checks continue at the app and API boundaries.

## Extractors

Each platform has `entry.js` for its per-run state, orchestration, guards and
cleanup. Coursera helpers are grouped into assessment, asset, plugin, navigation,
retry, evidence and text/DOM modules. Brightspace separates reusable helpers from
its bounded API/page traversal. Configuration literals are normal source code.

The local Chrome workflow, optional Coursera background Worker and retained
regression checks need one self-contained browser bundle. `npm run generate`
follows the explicit import graph and links the module declarations into that
artifact. The
restricted linker preserves function text used by targeted checks; it rejects
aliases, unresolved exports, side-effectful initializers and imports outside the
platform directory. The zero-cost operator flow can copy or download this current bundle from CTI
and run it in the already authenticated Coursera authoring tab.

Generated standalone browser bundles and delivery strings live under ignored
`src/generated/`. Do not paste encoded strings or generated scripts back into
source control. Run `npm run generate` after changing extractor modules,
including during `npm run dev`.

## Coursera browser extraction

The normal zero-cost path executes the current extractor in the operator's
already authenticated Chrome tab. The generated program keeps its item
checkpoints in that browser and downloads the raw JSON locally. CTI independently
evaluates the returned capture with the same strict completion contract before
it can be labelled COMPLETE.

The optional background path remains a separate service-bound Worker because
Browser Run and durable Workflows are Worker capabilities. It is intended only
for deployments that provision sufficient remote-browser quota; it is not a
requirement for the Pages application or shared workspace.

The Pages API authenticates the CTI user first and forwards only the verified
email/role to the Worker. Coursera login occurs in a temporary remote Live View;
encrypted Playwright storage state is scoped to that CTI identity. The Worker
stores large raw captures in R2 and the domain-level strict verifier independently
decides whether a job may be labelled COMPLETE.

Do not weaken the strict verifier to make a job green. Improve the maintained
Coursera extractor until its evidence satisfies the completion contract. Run
npm run worker:check in addition to the normal app tests when editing this
boundary. Deployment and security details are in
docs/background-coursera-extraction.md.

## Regression and publishing

Use the focused commands above while implementing. Before publishing changes
across feature boundaries, run `npm test` and `npm run build`. The full suite runs
historical assertions against the current engine and independently compares a
complete source/XLSX/JSON workflow with the frozen reference. DOM simulations
exercise the current extractor functions by syntax/name, independent of file order.

The historical harness also retains archive-only functions and old UI contract
tests. Its passing count is not a claim that those workflows exist in Cloudflare.
Read [the full Code.gs audit](audits/code-gs-audit.md) before claiming parity.
`npm run audit:parity` accounts for every original function/constant/override and
declared capability, compares active rule bodies independently of that harness,
and checks both extractor programs including their execution code. The ledger
deliberately records unresolved gaps. Intentional future rule changes require an
explicit reviewed disposition; do not edit the frozen archive to pass parity.

`main` is the source of truth. Its passing GitHub checks forward the exact commit
to `codex/typescript-pages-migration`, the existing Cloudflare production branch.
The forward is non-forced and fails on divergence rather than overwriting work.
Cloudflare then performs its own build/deployment. Check both GitHub and Pages
results before claiming an update is live. The old branch name is a deployment
setting only; future work starts from `main`.

`npm run export:gas` is optional recovery of the frozen Apps Script snapshot to
ignored `dist-gas/`. It does not export current Cloudflare features back to Google.
See `archive/apps-script/README.md` for the reference boundary.
