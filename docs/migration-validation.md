# TypeScript migration preview validation

Validated locally on 2026-09-27 against the accepted Apps Script baseline `5280adf`.

## Automated checks

| Check | Result |
| --- | --- |
| Existing FAST checks | 228 passed |
| Existing SOURCE_CONTRACT checks | 23 passed |
| Existing extractor and evidence hardening simulations | 17 passed |
| New migration checks | 9 passed |
| Strict TypeScript checking | Passed |
| Production Vite build | Passed |
| Original GAS engine reconstructed from 40 ordered modules | Byte-identical |
| Coursera and Brightspace extractor delivery | Byte-identical to canonical scripts |
| Changes to Code.gs, Index.html, Index_COPYABLE.txt, Tests.gs | None |

`npm test` reproduces the 277 local automated checks. Nine Google XML cases are explicitly skipped. The 13 Google-service integration cases and one full-golden gate have not been run or certified by this preview.

## Saved-capture parity

Focused, private replays used existing CITC924, CITC923 and CITC932 Coursera captures in both `OPS_CURRENT` and `RAW_INGESTION` modes. All six produced identical captured-readiness findings through the browser compatibility adapter and original GAS engine when given the same capture-only inputs. The three previously identified CITC924 AI-grader review items remain present. CITC924 Brightspace inventory retained its unverified quiz-bank coverage warning.

These are capture-only parity checks, not full IMSCC/XLSX/source-fidelity QA. Structural item titles were not substituted from external reports. Private course captures were not added to the repository.

## Browser smoke check

The production build was served locally and exercised in headless Chromium with the intended Content Security Policy applied. Checks passed for:

- Desktop rendering and a 390-pixel mobile viewport, with no horizontal overflow.
- Real Coursera capture processing in a Web Worker, retaining all three known CITC924 grader reviews.
- Review JSON download, finding search and expandable detail.
- Clipboard copying of the canonical Coursera v6.14.0 extractor.
- Malformed JSON errors followed by successful processing of a valid Brightspace capture.
- Brightspace counts of 27 captured topics and four captured question definitions; asset evaluation correctly shown as unavailable.
- Cancellation during a synthetic 19,000-item review, with the interface responsive and ready to restart.
- Zero page errors and no external requests from the preview during the tested flow.

The test does not run the copied extractor inside an LMS, verify a Cloudflare deployment, or certify every browser. The preview does not provide shared team persistence or Google authentication. Existing Apps Script workflows remain required for full QA.

## Deployment state

Prepared locally only. No Cloudflare deployment, public GitHub push, production replacement or paid service has been performed by this migration step. Use the settings in the README after publishing the reviewed branch.
