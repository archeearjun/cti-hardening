# Plugin readiness, upload preparation and source navigation

Coursera extractor v6.14.7, schema 34. Brightspace stays at v1.0.7 and the
QA comparison engine is unchanged. Full and action-card item captures use the
same canonical extractor. Existing captures remain valid historical evidence.

## Confirmed defects

- Typed plugin recovery treated an iframe URL as meaningful content and could
  finish after two seconds of stable authoring chrome. It did not include the
  readable frame's loading/content state in its stability signal.
- Upload preparation included `result.summary` wholesale, including large nested
  policy, readiness and resolution findings. The initial POST has a 128 KiB
  limit. This could reject a report before its existing 128 KiB chunk upload
  began; the archive's compressed size was not the relevant size.
- Source navigation used the extractor's page URL directly. A Brightspace
  smart-curriculum internal application URL has no course context. Direct file
  URLs also bypass the LMS topic context.

## Changes

Plugin recovery gives the observed editor at least 10 seconds, samples every
400 ms and requires three stable samples without observed loading. It uses a
20-second initial budget, with bounded extensions on new scoped evidence up to
40 seconds and always respects the remaining course budget. Readable frame
state and content now participate in stability. The generic editor fallback
uses the same readiness gate. A deadline retains explicitly partial evidence
only while the exact course/item editor identity still matches.

A cross-origin iframe's target can be captured even when its contents cannot
be read. Waiting does not remove that browser boundary. The capture records
unreadable, loading, error, configuration-only or readable-frame status; none
proves interaction, playback or completion of hidden Rise screens. Readable
frame text is retained separately (24,000 characters per frame, truncation
reported) and never substituted for the plugin's main learner text. Existing
frame-count and depth limits still apply.

Listing/preparation summaries retain bounded scalar metrics. The complete
nested report remains in the checksummed chunks; tests assert an exact data
round trip. No evidence is discarded and no upload limits are raised. Existing
saved IDs and write retry semantics are unchanged.

Owner links use captured numeric Brightspace org/topic IDs to construct course
home and contextual content routes, with the original document/target as a
separate alternative. Saved reports can infer a unique same-origin org ID from
their retained source URLs. Conflicting IDs do not generate guessed links.
Source evidence and immutable audit findings are not rewritten. Authenticated
LMS access is still required; these route fixes are not a claim that an external
source website works.

## Verification and live acceptance

Regression coverage includes delayed 8- and 18-second plugin content, permanent
loading, cross-origin frames, course deadlines, stop requests, route changes,
readable-frame text limits, a prepare-stage 413 reproduction and full chunk
round trip, and fresh/older/ambiguous source navigation contexts.

After deployment, retry Import prepared records so saved IDs are checked first.
For plugin timing acceptance, use the NAIT Student Resources action card's
single-item check. Retain the full existing course captures. A parent-page
capture reporting CROSS_ORIGIN_UNREADABLE requires a direct visual/plugin check;
it is not a reason to rerun all titles. Live Coursera rendering and authenticated
Brightspace navigation cannot be established by the local regression tests.
