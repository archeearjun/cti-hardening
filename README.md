# CTI evidence hardening

CTI inspects source packages and compares observed ingestion evidence. It preserves the existing IMSCC, Brightspace, Coursera, Macmillan, Explore, work-queue and lifecycle workflows. Content-map and outline generation remain separate workflows.

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

## Repeatable local checks

Use Node.js 22 or later; no packages or credentials are required.

```sh
node tools/check.cjs
node tools/hardening-check.cjs
```

The first command runs 200 FAST and 23 SOURCE_CONTRACT checks, compiles the embedded extractor, and checks the copyable Index. Nine XML-service cases are explicitly skipped. The second runs 17 focused simulations, including 172-question traversal, mixed content parts, duplicate question wording, stalled downloads, cache identity and evidence-gate negatives.

GitHub Actions runs these commands for pushes and pull requests. The local DOM fixture exercises production extraction functions; it does not replace a live Coursera capture.

## Remaining release validation

- Run the native Apps Script FAST and SOURCE_CONTRACT suites after copying the three canonical files into a test project.
- Run the 13 INTEGRATION and 1 FULL_GOLDEN gates with their required Google services and fixtures. These and the nine XML-service cases have not been certified by the Node runner.
- Replay the existing 15-title evidence corpus with this candidate. The repository currently contains code and generic fixtures, not that corpus. The handoff summary is not a substitute for the actual IMSCC, old/new JSON, XLSX and report evidence.
- Only then select targeted live captures for behavior that stored JSON cannot exercise (virtualized editors, fresh plugin configuration and network timing). A new version alone does not require 15 fresh crawls.

Keep deployments and merges separate from validation. The Apps Script production deployment has not been updated by this review.
