# Activity PDF citation repair — 9 October 2026

Scope: activity preview 2.2.3. The canonical v6.15.11 extractor, owner access
boundary, Worker, reconciliation engine, course contents and raw captures are
unchanged. This is a focused follow-up to the TRDE120 result, not a whole-platform
audit or a certification of the AI's instructional recommendations.

## Confirmed defects and corrections

| Location | Evidence / user impact | Severity | Correction / verification |
| --- | --- | --- | --- |
| `activity-quality.js`, `designer.js`, `readiness.js` | All six `Teaching_PDFs/<sha>.pdf` citations in the supplied result referred to retained originals, but both validators searched only document/reference paths. Cards incorrectly reported missing files and no teaching support. | High: false blockers and repeated extraction/upload work | Resolve the exact retained hash and its associated PDF text block. Share that resolver between both checks. Test successful citations, unknown hashes, wrong paths, stale snapshots, saved-work restore, sibling files and failed parsing. |
| `shell-capture.js` | PDF page labels and the app's own `[No text layer on this page]` marker could be counted as readable teaching. Two cited reference diagrams have no text layer. | High: unsupported content confidence | Ignore those exact generated markers for text-quality assessment. Keep originals available for visual review without certifying diagrams. |
| `cti-adapter.js`, `shell-capture.js`, `activity-quality.js` | Raw item `1fv6W` contains one arithmetic prompt and two `Enter an option...` choices, with a successful raw receipt. The activity projection treated them as two substantive choices. | High: false learner-text coverage | Preserve placeholders as gap blocks, record their count, exclude them from substantive choices, and keep the practice comparison unresolved. Do not infer whether the live editor was empty or had failed to load. Tests retain valid zero/state-label choices and similar real prose. |
| `designer.js` | Older duplicate warnings still called observed-empty editors unread and used their own path checks. | Medium: contradictory recovery advice | Reuse the current practice recovery states and exact source resolver. Preserve the separate warning for genuinely unread item bodies. Resolve module decisions by IDs where present. |
| `results.js`, `compact-ui.js` | Users could not retrieve a cited original directly; packet instructions did not explain attachment batch limits. | Medium: avoidable owner work | Add a local download of each exact cited PDF and same-chat batching instructions in the page and ZIP. No files are sent automatically. |

## Verification

- Existing baseline: 18 activity Node tests and seven retained activity suites
  passed before edits. Final local `npm test`: 373 Node tests plus retained
  legacy/hardening checks and seven activity suites passed. Build passed.
- Imported the user's entire raw capture through the maintained processing path,
  using real PDF.js text extraction: 96 items, 38 retained original PDFs, 83 pages
  processed. All six cited PDFs resolve. The four main teaching PDFs have text;
  the two reference diagrams remain known originals without readable text layers.
- All three proposals still have source-reconciliation holds. Item `1fv6W` has
  one prompt, zero substantive choices and two placeholders. The stale-snapshot
  check still rejects applying the old result to a newly prepared snapshot.
- Added browser regressions under production CSP for a PDF-cited result, copy
  gating, exact downloaded bytes, populated expanded notes, desktop/mobile
  rendering and the batch README. Local Chromium launch is blocked by the host's
  socket permissions; the repository's browser CI must pass before release.
- The supplied paste's blank bullet list was not reproduced as empty data: the
  JSON checks and DOM construction contain text. The browser regression checks
  the expanded details. Do not claim a blank-rendering defect without evidence.

## Remaining limits / operator recovery

Actual source-LMS equivalence, unread external frames, the 17 observed-empty
editors and final-assessment image failures are not repaired by this validator
change. No live Coursera/source editing or new extraction was performed. AI
claims that pages were visually inspected are not independently verified here.
No held proposal was promoted or given invented authoring fields.

Save the existing work ZIP before refreshing the app. Restoring that ZIP through
the result importer preserves the matching snapshot and reruns the corrected
PDF checks. Reprepare the existing raw JSON to obtain corrected placeholder
metrics; this creates a new snapshot, so generate a new packet and revalidate
the AI result rather than changing its timestamp to bypass the guard. Rerun the
extractor only after source/Coursera content changes or a loading gap is resolved.
