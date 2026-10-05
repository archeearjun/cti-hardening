# IMSCC source hierarchy and rescan repair

## Confirmed findings and implemented corrections

| Location | Evidence and impact | Severity | Correction and verification |
| --- | --- | --- | --- |
| `operations.ts`, `workspace-validation.ts`, `FullWorkspace.tsx` | Apps Script import serializes stored assignment/deadline dates as timestamps. Strict date-only validation blocks rescans and unrelated owner edits. | High: blocked save | Validate known serialized timestamp formats without changing their value or timezone; retain date-only validation for new date edits. Browser regression saves a rescan, preserves metadata/UUID and all audit records; malformed dates remain rejected. |
| `source/manifest.js`, source views | Comparison projection removes nested folders. Both views also flattened the remaining hierarchy. TRDE120 contains 261 manifest items. | High: misleading source structure | Preserve a separate, lightweight `sourceHierarchy` from the authored manifest. Keep the established comparison projection. Both views share a nested list with keyboard-operable disclosures, retained search ancestors, pagination and lazy evidence rendering. |
| `source/manifest.js` | The engine selected the first organization even when another was explicitly marked default. | High: wrong comparison source | Honor the default identifier; fail on unresolved defaults. Browser fixture verifies original hierarchy and comparison select the same organization. |
| `PackageWorkspace.tsx` | Replacing/failing/cancelling an input left the previous pending result in its parent save form. | High: stale save | Clear pending scan on input/start; reset runner when selected course changes. Browser regression verifies a failed replacement cannot save the old scan; saved course/report evidence is retained. |
| `source/qti.js` | Parsing stops at 250 definitions but reported the captured count as the declared count. | High: false coverage | Preserve total declared count and explicit incomplete coverage. A 260-question fixture records 250/260 and shows a warning. |
| `source/qti.js` | Merging a dependency mutates its shared assessment and uses question ID/prompt without file identity. Equal draw sizes were deduplicated. | High: incorrect questions/counts | Clone merges, retain source file/ordinal identity and unique file counts; compute only non-overlapping selection scopes. Two distinct banks remain separate; shared siblings are unchanged; two independent draws of two produce four, not two. Merged-bank learner selection remains unknown. |
| `source/scan.js`, `source/pdf.js` | Text sampling/size limits and unrequested PDFs were not consistently explicit; external references looked like missing package files. Orphan rescue could infer uniqueness after read failures. | Medium: misleading evidence | Mark truncation and uninspected PDF/text evidence, keep external presence unknown, retain file presence beyond content-read limits, and bound orphan search. Do not associate an orphan after an incomplete search. |
| `package-scan.ts` | Current PDF worker requires newer typed-array APIs; Chromium 138 failed with `toHex is not a function`. | Medium: PDF extraction unavailable | Use PDF.js's bundled compatibility build and matching worker, retaining the locked dependency version and local-only execution. Real browser PDF extraction now passes. |

## Verification

- `npm test`: 287 tests pass, including the retained legacy/regression harness and explicitly reviewed function dispositions.
- `npm run build`: passes strict typechecking and production build. Existing chunk-size advisory remains.
- Browser package suite: real ZIP/XML/QTI/PDF parsing, nested/default hierarchy, large-bank coverage, bank identity, selection scopes, external references, bounded orphan recovery, duplicate IDs, malformed XML, cancellation, keyboard controls, 390px layout, no external requests.
- Browser workspace suite: legacy timestamp rescan and unrelated owner edits; optimistic-concurrency rejection; no stale save; UUID, metadata and report preservation; existing comparison/history/import/export workflows.
- Browser UX and owner suites: saved-source browsing, lazy evidence, guided assignment flow, report content and follow-ups, responsive layouts.
- Private original TRDE120 IMSCC: 261 hierarchy entries and 220 resources. An independent Python XML traversal matches every source parent path, order and resource reference (empty titles use a display fallback). All eight QTI files independently match captured/declared counts: 2, 8, 3, 8, 12, 10, 4, 2 (49 definitions).
- Private original CITC923 IMSCC: 29 resources, 3 assignments, 2 discussions, 6 weblinks, 63 file evidence records. Original packages and private scan output are not committed.

## Inspected scope and remaining limits

Read all maintained `src/source/` scanner modules, the package domain/types, manifest projection, affected metadata/storage validation and import paths, both source views, runner lifecycle and relevant browser tests. Changed the locations above and added `source-hierarchy.ts`/`SourceTree.tsx` and focused tests. This is a scanner/rescan repair, not a new certification of the entire product or every historical LMS/plugin case.

Original hierarchy is optional for backwards compatibility. Previously saved scans cannot recover already omitted folders until the original IMSCC is rescanned. No shared course records are rewritten automatically. Existing saved versions and audits remain intact.

Package evidence is bounded and is not live LMS verification. QTI definitions beyond 250 per XML, unsupported question semantics, external plugins, and sampled/omitted text require review. PDF extraction currently targets assignment/instruction/rubric documents, with byte/page/text limits; it does not OCR image-only PDFs. TRDE120 explicitly reports one truncated resource and 39 PDF references outside that text-extraction scope; its 49 packaged definitions are not a claim about externally hosted question banks or the Coursera learner count.

Deployment uses the existing verified-main → Cloudflare production branch pipeline. No dependency upgrade, database migration, new secret or configuration change is required. Reload CTI, inspect the original IMSCC, and save the rescan against the selected course to receive the new hierarchy/evidence.
