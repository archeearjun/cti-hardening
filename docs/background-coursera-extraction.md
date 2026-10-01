# Background Coursera extraction

The background extractor removes the normal DevTools/console step from Coursera
capture. A signed-in CTI editor pastes a Coursera authoring-shell URL, CTI starts
a durable Cloudflare Workflow, and a separate Worker controls Cloudflare Browser
Run with Playwright.

This feature is deliberately fail-closed. A browser run producing JSON is **not**
the same as a complete extraction. CTI stores the raw capture and runs an
independent completion gate. The UI shows **COMPLETE** only when the discovered
inventory reconciles, there are no unknown or unvisited items, required
assessment evidence reconciles, the extractor reports no unresolved evidence,
and required plugin bodies are verified. Otherwise the artifact is retained as
**INCOMPLETE** with explicit reasons.

## Architecture

- Cloudflare Pages remains the CTI control plane.
- /functions/api still verifies Cloudflare Access and editor/admin roles.
- Pages sends /api/extraction/* requests through a Service Binding named
  CTI_EXTRACTOR.
- workers/coursera-extractor owns Browser Run, the durable Workflow and R2.
- The browser Worker is configured with workers_dev = false; it is not intended
  to be a public arbitrary-browser endpoint.
- R2 stores job state, encrypted Coursera browser storage state and complete raw
  capture JSON.
- The current modular Coursera extractor is generated at deploy time and injected
  into the authenticated authoring page.
- src/domain/coursera-background-extraction.ts independently evaluates the
  resulting capture before CTI can call it complete.

The CTI page can be closed after a job starts. Reopening the site restores the
latest job ID from local storage and reads durable status from R2.

## Security and Coursera sign-in

Do not store Coursera passwords in CTI.

The first **Connect Coursera** operation opens a temporary Cloudflare Browser Run
Live View. The user signs into Coursera using the normal authorised SSO/MFA flow
inside that browser and chooses Done. The Worker then verifies that the requested
authoring shell can be opened.

Playwright storage state is encrypted with AES-GCM before R2 storage. The
encryption secret is a Worker secret and must never be committed. CTI stores only
a SHA-256 hash of the normalised CTI email in R2 paths.

The temporary Live View URL grants access to that browser session while valid.
Do not log, paste or share it.

Cloudflare Browser Run identifies itself as browser automation. If Coursera or an
organisation policy blocks server-side browser automation, do not add stealth,
CAPTCHA bypass or bot-control circumvention. Use an approved internal/service
authentication or approved browser automation path instead.

## Cloudflare resources

Long course extractions are not a realistic Browser Run Free-plan workload.
Cloudflare's current Browser Run Free allocation is limited to 10 browser
minutes per day. Use this optional feature only after the organisation has
approved the required Workers/Browser Run plan and cost. The existing shared CTI
workspace can continue using its current free D1/Pages setup without enabling
background extraction.

Create the R2 bucket:

~~~sh
npx wrangler@4.143.0 r2 bucket create cti-extraction-artifacts
~~~

Create a strong encryption secret for the Worker:

~~~sh
npx wrangler@4.143.0 secret put CTI_SESSION_KEY --config workers/coursera-extractor/wrangler.jsonc
~~~

Keep the value in the Cloudflare secret store only. Use at least 32 random bytes.

Validate and deploy the Worker:

~~~sh
npm ci
npm run worker:check
npm run worker:deploy
~~~

The Worker configuration declares:

- Browser Run binding: BROWSER
- R2 binding: ARTIFACTS → cti-extraction-artifacts
- Workflow binding: EXTRACTION_WORKFLOW
- Workflow class: CourseraExtractionWorkflow

In the existing Pages project, add a **Service Binding**:

| Pages binding | Worker |
| --- | --- |
| CTI_EXTRACTOR | cti-coursera-extractor |

Then redeploy Pages. Missing binding configuration is reported as HTTP 503 and
the UI does not pretend background extraction exists.

## Operator flow

1. Open **Full CTI workspace → Extract**.
2. Paste a Coursera URL containing /teach/<course>/<course-id>/content/....
3. Choose **Connect Coursera** if this CTI identity has no saved Coursera
   session.
4. Open the temporary Coursera sign-in view, complete normal SSO/MFA, open the
   authoring shell and choose Done.
5. After CTI reports Coursera connected, choose **Extract course**.
6. The job continues in the Worker/Workflow. Closing the CTI page does not
   cancel it.
7. A completed raw JSON artifact is downloadable whether the strict verdict is
   COMPLETE or INCOMPLETE.
8. Use **Use this capture in Compare** to load the artifact into the existing
   source/XLSX comparison flow.

## Completion contract

A background job cannot be COMPLETE merely because navigation ended or a
download exists.

The independent verifier blocks certification when any of these are present:

- capture has no explicit completeness/accounting contract;
- capture course ID differs from the requested shell;
- inventory count and fingerprint count disagree;
- allInventoryAccounted or noSilentMisses is not proven;
- unknown, unvisited, unresolved or terminal-incomplete items remain;
- active crawl or whole-run deadline was exhausted;
- a declared assessment does not have complete question and required-answer
  coverage;
- a required plugin body is cross-origin/unverified;
- an item capture contract says the item is incomplete.

This makes false green results harder, but it is not a mathematical guarantee
that every external system can be extracted. If an authorised browser cannot
read a required third-party body, CTI must remain INCOMPLETE until that evidence
becomes available through an approved API/same-origin integration or equivalent
source.

## Current extractor

The maintained modular Coursera extractor on this branch is **v6.15.4/schema 35**.
It now emits the explicit per-item capture contracts and `meta.captureAccounting`
used by the independent background completion gate.

The normal operator flow is site-only: the Worker injects the generated extractor
bundle into the authenticated Coursera authoring browser. The bundle is still
generated because Browser Run and targeted developer checks need a self-contained
program; it is not the intended end-user interaction.

The strict gate remains independent from the extractor. A v6.15.4 run is still
INCOMPLETE if any required item/channel is unresolved, unvisited, unknown, timed
out without proof, settings-only, or an external plugin body remains unverified.
Do not weaken those states to obtain a green result.

The automated regression/build suite validates the modular port. A real
authenticated Coursera shell run is still required before treating the new
background path as production-validated against a specific live course.

## Recovery

During an extraction the Worker periodically serializes Playwright storage state
with IndexedDB enabled and stores it encrypted under that job in R2. The
v6.15.4 item checkpoint run ID is kept in localStorage with a 12-hour TTL, so a
Workflow retry can recreate the browser context, restore completed-item
IndexedDB checkpoints and continue the remaining queue. Successful artifact
creation deletes the per-job runtime state.

This is crash recovery, not a reason to accept partial evidence: the final
capture still has to satisfy the same strict completion gate.

- A failed browser run leaves its job state and any already-persisted raw
  artifact in R2.
- Coursera session expiry returns a clear reconnect error; reconnect and submit a
  new extraction job.
- Deleting the Coursera connection removes encrypted storage state and metadata.
- Job status is retained independently from the CTI browser tab.
- The Worker never writes to the Coursera shell.

Cloudflare references:

- Browser Run Playwright:
  https://developers.cloudflare.com/browser-run/
- Human in the Loop / Live View:
  https://developers.cloudflare.com/browser-run/features/human-in-the-loop/
- Browser Run limits and pricing:
  https://developers.cloudflare.com/browser-run/limits/
  https://developers.cloudflare.com/browser-run/pricing/
- Workflows:
  https://developers.cloudflare.com/workflows/
- Pages Service bindings:
  https://developers.cloudflare.com/pages/functions/bindings/#service-bindings
