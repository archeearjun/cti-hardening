# Refresh one Coursera item

After saving an edit in Coursera, open the item's action card in a saved CTI
report. The normal workflow is **3 · REFRESH ITEM EVIDENCE**: copy the current
item check, run it in the exact signed-in Coursera item's DevTools Console, and
return the downloaded JSON to the same card. File selection validates and saves
immediately; pasted JSON is saved by **Add item check**. Review the refreshed
comparison, then record and save the item outcome in step 4. No extension
installation is required for this workflow.

Only a browser with a compatible extension already connected sees the optional
**Refresh this Coursera item** button. Unavailable/incompatible extensions show
no installation panel or disabled refresh control. The optional Chrome extension
opens a temporary authoring tab in the same signed-in browser profile. Keep that
tab visible until CTI returns you to the report. The existing editing tab stays
open. Refresh replaces the item's saved follow-up evidence, updates its content
comparison and question counts, and reopens a checked outcome for review. It
does not rewrite the original audit or approve publication.

## One-time installation

For browsers where installation is permitted by the administrator:

1. Download `/downloads/cti-browser-extension.zip` from CTI and extract it to a
   folder you will keep. Installation instructions are intentionally outside
   the normal item workflow.
2. Open `chrome://extensions` in Chrome and enable Developer mode.
3. Select **Load unpacked**, then the `CTI-browser-extension` folder containing
   `manifest.json`.
4. Reload CTI in the same Chrome profile used for Coursera.

To update, replace that folder's files, reload the extension, and reload CTI.
If organizational policy prevents installation, use the existing manual script
and JSON import or ask the browser administrator. Do not bypass browser policy.
The extension currently supports the production `cti-hardening.pages.dev` origin
only; previews and other CTI hosts do not receive access.

## Evidence and failure behavior

- Only one refresh can run at a time. Requests/results belong to the exact CTI
  tab, document, run, report, course and item. A second tab cannot read, cancel,
  or acknowledge another tab's capture.
- Refresh uses the same maintained targeted extractor as manual item checks.
  It visits one current item without seeding its payload from old evidence.
  Dynamic question traversal and visibility requirements are unchanged.
- CTI validates freshness, extractor version, scope, editor diagnostics and
  question coverage before saving. Incomplete observations can be downloaded
  for review, but do not replace the last saved evidence. Wrong-item, stale,
  malformed, oversized and failed captures are rejected.
- Cancel closes the owned temporary authoring tab. Closing/reloading CTI,
  closing the capture tab, and the 21-minute expiry also terminate the job.
  A temporary tab navigated outside its expected course is left alone.
- Cancellation is disabled during the short, version-checked workspace save.
  Save failures retain the previous stored record and leave the new observation
  available to download. Concurrent workspace changes follow the existing
  conflict detection contract.
- Cross-origin embedded tools, inaccessible resources, learner behavior and
  answer-key correctness still need their existing checks. A refreshed item is
  evidence, not a claim that the course is complete. It does not recapture the
  whole course or change the source LMS evidence.

## Implementation and data boundaries

`src/browser-extension/` owns the MV3 service worker, isolated bridge, protocol
and installation instructions. Permissions are scripting, session storage,
alarms and the two exact CTI/Coursera hosts; there is no cookies API, analytics,
password export or remote executable resource. CTI requests contain data only.
The packaged runner is built from `buildItemCheckScript` through explicit,
exact-once transport substitutions in `src/domain/extension-item-script.ts`.
An incompatible extractor build fails generation instead of silently drifting.

`chrome.storage.session` holds request metadata, not captured bodies. Bodies
stay in the temporary Coursera page until returned to CTI. Successful saves use
the normal browser/shared workspace path. Acknowledgement closes the temporary
tab and clears job metadata. Discarding a tab destroys the page-held result.
The production CTI page is trusted to request extraction within these scopes;
the extension does not add a separate user identity or authorization system.

`npm run generate` creates ignored packaged files and a deterministic ZIP;
`npm run build` includes the ZIP in Pages. Bump manifest version and
`EXTENSION_VERSION` together when changing the extension or embedded extractor.

## Verification boundary

Unit tests check guards, freshness, scope, malformed/partial responses and ZIP
contents. The owner browser test covers a newly added question, review reopening,
partial/wrong-item results, cancellation and the mobile UI with a controlled
transport. `npm run test:browser:extension` runs the actual MV3 extension and
packaged extractor against a controlled Coursera authoring DOM/API, covering
two fresh captures, permission failure, cancellation, tab ownership and cleanup.
The extension test is a mandatory browser CI step before production publishing.
These fixtures do not establish successful extraction from every authenticated
Coursera course or embedded question type.
