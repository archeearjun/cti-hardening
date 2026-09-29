# Frozen Apps Script reference

These files preserve the accepted application at commit
`e236eff4f49fbc906bd4c2583ab8e6ed1eb142af` before the native module refactor.
They are reference fixtures for regression and migration checks, not maintained
application source. Cloudflare development and builds do not read this directory.

`Code.gs` retains its accepted SHA-256 in `reference-manifest.json`.
`Tests.gs` supplies historical assertions; `tools/check.cjs` runs their active
evidence decisions against the current modules. `tools/legacy-reference.cjs`
provides an independent old engine for parity checks.

The two small helper files retain the original Google migration/export contracts.
The old ordered module paths recorded in the reference manifest are historical;
there is no active legacy manifest or source concatenation.

`npm run export:gas` copies the frozen Code, Index and Tests to ignored `dist-gas/`.
It does not transpile the current app back to Apps Script or claim feature parity
with future Cloudflare changes. No export is needed for normal edits.
