# Coursera extraction: local default and optional background mode

The zero-cost default runs the current Coursera extractor inside the operator's
already authenticated Chrome authoring tab. The extractor keeps item checkpoints
in local browser storage, downloads the raw JSON locally, and CTI applies the
same strict completion verifier before the capture can be called COMPLETE or
loaded into Compare.

An optional background mode still starts a durable Cloudflare Workflow and uses
a separate Worker with Browser Run/Playwright. That mode is preserved for
deployments that intentionally provision enough remote-browser quota; it is not
required for the normal Pages/shared-workspace workflow.

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

The CTI page can be closed after a job starts. Reopening the site lists recent
extraction jobs from server-side R2 metadata scoped to the signed-in CTI identity,
so a running/completed job remains discoverable even if the browser-local pointer
was cleared.

## Security and Coursera sign-in

Do not store Coursera passwords in CTI.

There is no separate Coursera connection step in the normal operator flow.
**Extract course** first tries the encrypted saved Coursera/organization-SSO
browser state. If that state is absent or expired, the same extraction job opens
a temporary Cloudflare Browser Run Live View, advances through Coursera's
organization/SSO choice where possible, and pauses only for the user's normal
Okta/MFA interaction. After the authoring shell is verified, the Worker saves the
refreshed browser state and resumes the same extraction automatically.

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
The maintained extractor can legitimately run far longer than a small free
remote-browser allowance. Use the local Chrome path for a zero-cost deployment.
Enable optional background extraction only when the organisation has deliberately
provisioned adequate Browser Run capacity. The shared CTI workspace does not
depend on that optional Worker.

Create the R2 bucket:

~~~sh
npx wrangler@4.143.0 r2 bucket create cti-extraction-artifacts
~~~

Create a strong encryption secret for the Worker:

~~~sh
npx wrangler@4.143.0 secret put CTI_SESSION_KEY --config workers/coursera-extractor/wrangler.jsonc
~~~

Keep the value in the Cloudflare secret store only. Use at least 32 random bytes.

### Automatic production deployment

The repository contains `.github/workflows/deploy-coursera-extractor.yml`.
After these two GitHub repository secrets are configured, every relevant push
to `main` deploys the background extractor automatically:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token must be scoped to the Cloudflare account and have enough permission to
deploy Workers/Workflows, create or list the R2 bucket, and update/retry the
`cti-hardening` Pages project. Store it only as a GitHub Actions secret.

The workflow:

1. creates `cti-extraction-artifacts` if it does not already exist;
2. deploys `cti-coursera-extractor` with Browser Run and the Workflow binding;
3. generates `CTI_SESSION_KEY` inside Cloudflare only if the Worker does not
   already have one (subsequent deploys preserve it);
4. merges the `CTI_EXTRACTOR` service binding into the existing production
   Pages services without replacing other bindings;
5. waits for the exact `main` commit to reach Pages production; and
6. retries that production deployment so the new service binding is active.

The workflow can also be run once manually from the `main` branch after adding
the two secrets. No Coursera password or session encryption key is stored in
GitHub.

For local/manual operator fallback only, the equivalent Worker commands remain:

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
2. Paste the exact Coursera authoring-shell URL.
3. Open that shell in the normal Chrome profile where Coursera/Okta already works.
4. Copy the current Coursera extractor from CTI and run it once in that tab's
   DevTools Console. Keep the tab open while its progress panel is active.
5. Select the downloaded JSON back in CTI.
6. CTI checks course identity and the strict no-silent-miss completion contract.
   An incomplete capture remains usable evidence but is never presented as
   certified complete.
7. Choose **Use this capture in Compare** and add the matching Coursera XLSX.
8. Optional remote background extraction remains available below the local flow
   when that deployment has sufficient Browser Run capacity.

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
