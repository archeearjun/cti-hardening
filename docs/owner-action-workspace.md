# Item action workspace

The Pages owner view now starts with actionable Coursera items in their outline
order. Full QA scores, reports and raw evidence remain available on demand.
This layer does not change the comparison engine or either full-course extractor.

## Owner flow

1. Run a comparison or open a saved report in History.
2. Open an item from Needs attention. Its Coursera link is visible on the card.
3. Read the action and any specific unmatched-question/media positions. Compare
   captured destination text with the exact matched source entry. Copy source
   text or question prompts when appropriate. Source answers are labelled as
   recorded evidence, never reconstructed.
4. For files, select the original IMSCC on the card and choose Get source file.
   Retrieval checks the package SHA-256, exact unique entry path, size limit and
   the source file hash when recorded. No basename guessing or scan is performed.
5. If fresh evidence is needed, copy that item's check, open its Coursera link,
   run the script in the console, and upload or paste its JSON into the same card.
6. Record an outcome and note. A changed item remains pending verification.
   Checked manually is an owner attestation, distinct from automated QA.

## Evidence boundaries

- Direct editor URLs come from captured diagnostics when course and item IDs
  agree. Otherwise the known outline URL carries the exact item ID. Older reports
  without a usable URL allow the owner to supply the matching course URL.
- Source text is selected by a unique resource identity or exact name and path.
  A changed source-package hash suppresses replacement material from the newer
  scan. Ambiguous matches are not used.
- New comparisons retain observed Brightspace navigation URLs in `ownerContext`.
  Older reports remain usable without re-extraction; they may lack source links.
- Item checks reuse the v6.14.6 canonical parser, stability and question-cycle
  functions with a single fresh item target. No earlier item payload is seeded.
  The script never invokes Save or Publish. It may return to the course outline
  as part of the existing extractor's navigation routine.
- Exact course/item guards run before the extraction lock or page interaction.
  Import additionally binds the result to the report and its expected references.
- Observed reference/prompt and not observed are deliberately limited results.
  Reference presence does not establish byte identity, question placement,
  launch, playback or source fidelity. Item scripts do not hash remote binaries.
- Checks use a separate diagnostic envelope with `notForCourseAudit: true` and
  cannot replace the complete capture in Compare. Full payloads are saved with
  item work. The original audit and its critical findings remain immutable.
- `item-review` records persist independently per audit and item. Shared storage
  retains existing editor/viewer permissions, optimistic concurrency and version
  history. List summaries omit large captured payloads. Later reports start their
  own review work; earlier completion is not silently carried forward.

## Validation

`npm test` covers URL safety, source ambiguity, question localization, diagnostic
identity rejection, report isolation, script syntax, early route rejection and
review persistence boundaries, alongside the existing regression suites.

`npm run test:browser:owner` exercises the production bundle: actionable view,
links, copied script syntax, wrong-item rejection, fresh-evidence upload,
completion notes, persistence after reload, unchanged original report, and mobile
layout. This uses synthetic data and does not claim a live Coursera validation.
