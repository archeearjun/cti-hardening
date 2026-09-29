# Working on CTI

`main` is the maintained application. Read `docs/development.md` before editing.
Cloudflare currently builds `codex/typescript-pages-migration`; CI forwards
verified `main` commits to that branch without force-pushing. Treat it as a
deployment mirror, not a second development line.

## Keep edits focused

- Find the owning feature with the table in `docs/development.md` and `rg`.
  Read the function and its imports rather than loading the full repository.
- Edit maintained `src/`, `web/`, `server/`, or `functions/` files. Do not edit
  generated delivery strings, concatenate engine files, or regenerate Code.gs.
- `archive/apps-script/` is a frozen test/migration reference. It is not current
  source and is not needed to build or run Cloudflare. Do not update it to make
  a current regression pass.
- Engine rules are native JavaScript modules. Keep imports explicit. Byte/XML
  services are bound per engine instance; do not add process-global service state.
- Extractor helpers are native ESM. Put run state and side effects in their
  `entry.js`, with only named functions/literal constants in helper modules.
  Run `npm run generate` after extractor changes. The source-preserving console
  linker is intentionally restricted; do not silently accept unsupported syntax.
- Preserve evidence uncertainty, raw snapshots, source identity, diagnostic-only
  checks, limits, and the separation between navigation and fidelity.
- Keep architecture-only changes separate from changes in audit decisions.

## Verify the affected behaviour

Start with `npm run test:navigation`, `test:extractors`, or `test:engine` as
appropriate. For changes spanning the engine, run `npm test` and `npm run build`.
Browser checks are available for package/PDF scanning, workspace workflows, and
owner actions; use the relevant one after changing those boundaries.
`CTI_CHROMIUM_PATH` can select an installed Chromium for local checks.

Report actual checks and remaining limits. Fixture parity is not a certification
of every live course, external plugin, or authenticated LMS redirect.
