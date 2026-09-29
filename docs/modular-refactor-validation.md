# Native module refactor — 30 September 2026

Reference: `e236eff4f49fbc906bd4c2583ab8e6ed1eb142af`.

## What changed

- The active engine's 266 symbols now live in independently imported feature
  modules. Only ten functions need explicitly supplied byte/XML services.
- The 42 ordered legacy chunks and their engine generator were removed.
- Late global overrides became explicit base/wrapper functions in their owning
  modules. Host service bindings remain isolated per engine instance.
- Coursera helpers moved into feature modules with per-run state in `entry.js`;
  Brightspace reusable helpers are separated from its run orchestration.
- Owner reports and ZIP/XML/QTI/PDF scanning are maintained modules, no longer
  extracted from Index.html. Source navigation has a dedicated TypeScript module.
- Code.gs, Index.html and the old tests are frozen references under `archive/`.
  Their optional export is not part of Cloudflare development or builds.
- Main is the maintained branch. Passing CI forwards it non-forcibly to the
  production branch already configured in Cloudflare.

## Verification performed

| Check | Result |
| --- | --- |
| Historical FAST assertions against current active engine functions | 228 passed |
| Retained source-contract assertions | 23 passed |
| Hardening checks, including current ZIP helpers and extractor functions | 20 passed |
| Node tests | 151 passed, none skipped |
| Full source/XLSX/JSON comparison against independent pre-refactor engine | Exact fixture result parity; mandatory Node check |
| Extractor function-body comparison at migration | All 291 Coursera and 26 Brightspace bodies unchanged |
| Explicit module binding checks and strict TypeScript app check | Passed |
| Clean production build with the entire archive absent and generated directory deleted first | Passed |
| Package browser workflow | Passed: ZIP, QTI, PDF, XML recovery, cancellation and 390px viewport |
| Workspace browser workflow | Passed: imports, worker comparison, reports, history, Macmillan, local concurrency and mobile layout |
| Owner-action browser workflow | Passed: exact item links, script compilation, invalid uploads, persistence and immutable audit |
| Optional archived Apps Script export | Passed; creates only ignored dist-gas files |

Nine XML cases that the historical Apps Script runner skips are exercised by
the Node workflow suite using the XML adapter. The retained source-contract
suite includes archived Google UI contracts; the actual Cloudflare application
is covered by the current module, workflow and browser checks above.

This validates the refactor against the available fixtures. It does not certify
all live course evidence, external plugin launch behaviour, authenticated LMS
redirects, or a complete 15-title corpus. Existing captures remain usable; the
extractor versions and evidence rules were deliberately preserved.
