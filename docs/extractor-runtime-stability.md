# Coursera v6.14.2 runtime stability

A live run showed Chrome's `Aw, Snap!` page and repeated skipped ViewTransition
errors during editor traversal. This establishes a failed run, not its browser
crash cause. No Chrome crash dump or heap profile was available. Animation
overlap alone does not establish memory exhaustion or a renderer defect.

The review identified two concrete resource/navigation issues:

- Returning to the outline dispatched popstate even when the URL was unchanged.
  Close and history fallback also ran back-to-back. The extractor now allows
  Close to navigate before fallback, avoids duplicate route dispatches, avoids
  broadcasting Escape from an idle outline, and uses bounded history for its
  own route changes. Existing exact editor identity and hydration checks remain.
- The response recorder used `clone().text()` before checking the actual body
  size. It now reads the clone incrementally under the existing character limit,
  cancels stalled copies after 12 seconds, and cancels outstanding copies when
  their item is released. The site's original request/response is untouched.
  Oversize, timeout, release and unreadable counters are retained in
  `networkRecorderMemory.responseCopyLimits`. A rejected copy is not parsed as
  partial valid JSON, and no missing evidence is filled from the source.

The schema stays at 34. The v6.14.1 option-boundary correction, QA engine and
Brightspace extractor remain unchanged. Seven runtime regression tests exercise
real Response/ReadableStream objects, Unicode preservation, original-response
isolation, body limits, stalled reads, item release and route fallback behavior.

This is a tested hardening change, not a claim that the observed Chrome crash has
been reproduced or eliminated. Live acceptance is still required. A crashed
renderer cannot execute cleanup or export unsaved in-memory results; only a
completed downloaded JSON should be used as a completed capture.
