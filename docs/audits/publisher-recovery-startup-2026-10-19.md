# Publisher recovery startup investigation

Status: local changes only; no release or deployment. The reported macOS popup
closure remains unconfirmed. No live publisher image bytes were recovered.

## Findings

The original opener explicitly requested `popup,width=960,height=720`. Chrome
may omit the bookmarks bar in that window. Running the bookmark in Coursera
cannot initialize a handler in the publisher document. The opener now requests
a normal named browsing context without popup features, retaining its opener
for the narrowly bound cross-origin message protocol. Browser preferences still
control tab versus window presentation.

Neither publisher protocol cleanup function calls `window.close()`. Cleanup
removes listeners and cancels pending reads. Publisher startup does not assign
location or navigate. The bookmark's outer `void` preserves an undefined
completion value, preventing string-result document replacement. The new test
harness verifies the document, URL and window survive startup and Stop.
These checks do not rule out a browser process failure or a different saved
bookmark in the user's Chrome.

## Local changes

- Normal-tab request and explicit active-publisher-tab instructions.
- Publisher panel errors for invalid fragment, unavailable opener and startup
  exceptions; actionable terminal status text and a recovery-aware outer alert.
- Parent accepts ready only after sending a plan in response to the exact
  publisher window's hello. Origin, source window, nonce, session, course and
  plan hash remain bound. Timeouts distinguish missing hello from missing plan
  acknowledgement. A successful handshake alone proves no image bytes.
- URL encoding preserves literal square brackets in the opaque javascript path.
  Decoding remains byte-for-byte identical; query, fragment, percent literals
  and Unicode remain escaped. No code compression, loader or name mangling was
  added. Bookmark: 506368 bytes; unchanged hard limit 512000; required headroom
  threshold 510976. Existing reading-contract correction is preserved.

## Validation

32 focused test files passed (direct-data, publisher, bookmark-formatting and
Brightspace bookmark tests). Build passed, including typecheck. After the final
terminal-status wording change, generation and the two affected generated-
bookmark/startup test files passed again. Diff whitespace check passed.

The additional Chromium harness uses intercepted synthetic HTTPS documents at
Coursera and publisher origins, a real opener and real cross-origin postMessage.
No real network publisher content or cookies are used. It tries the emitted
javascript URL first. In this environment native activation does not execute;
only an explicit environment flag permits execution of the exact decoded
program through Playwright. This is executable browser coverage, NOT native
Chrome bookmark/menu validation or a passed mandatory release gate.

Reproduce:

    npm run generate
    node --test tests/coursera-publisher-bookmark-startup.test.mjs tests/coursera-publisher-first-party.test.mjs tests/coursera-publisher-first-party-media.test.mjs tests/coursera-direct-data-delivery.test.mjs tests/bookmark-program.test.mjs
    CTI_CHROMIUM_PATH=/usr/bin/chromium CTI_PUBLISHER_EXECUTION_HARNESS=1 node tools/browser-publisher-recovery-startup-check.mjs

Remove the harness flag to require native bookmark execution. A native failure
then fails the check rather than silently substituting injected execution.

## Remaining verification

Use an unmanaged Chrome/macOS browser and replace the saved bookmark from the
candidate build before testing. Keep Coursera open, prepare recovery, open the
publisher, and activate the saved bookmark in that publisher tab. Observe the
publisher panel and parent acknowledgement. If it closes again, distinguish a
closed window from Chrome's crash page and retain the crash/error details. Do
not recapture the course merely to diagnose startup. Only subsequently received
original bytes with verified hashes can establish image recovery. Mandatory
native browser and release gates remain required before deployment.

## Release gate review (continuation)

The full local `npm test` passed: 180 test files plus seven activity-designer
unit/simulation suites. The current build, extractor audit, module checks,
bookmark size check and Worker dry-run build passed. Local npm/Wrangler cache
paths were configured under writable workspace directories; no repository
release checks were changed.

`.github/workflows/cti-checks.yml:71` requires deterministic, browser,
assignment-workspace and access-configuration jobs before forwarding main to
the production branch. The browser job runs `test:browser:direct-data` at line
130. That test requires native javascript URL execution by default; its local
policy fallback reports PARTIAL, not native PASS. The added executable harness
cannot replace this gate. A macOS menu click is not itself a configured CI gate.

The current candidate has not run all hosted CI jobs. Worker provider/workspace
runtime checks, the full browser suites, assignment-workspace checks and hosted
production Access validation are not certified by the local passes above.
There is no new merged commit or verified production deployment for this patch.
All prior staged/unstaged work remains in place.

Required native verification on an unrestricted CI browser:

    npm ci
    npm run build
    npx playwright install --with-deps chromium
    npm run test:browser:direct-data

Run without `CTI_ALLOW_BOOKMARK_POLICY_BLOCKED` and without the executable
harness fallback. Require exit zero and final `status: PASS` with
`nativeBookmarkExecuted: true`, then require the remaining configured jobs.
Manual macOS verification supplements, rather than replaces, these jobs.
