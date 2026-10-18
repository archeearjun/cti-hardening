# TRDE120 and TRDE130 capture corrections

This review used both courses' 18 October retained source and Coursera captures.
Private course bodies and questions are not repository fixtures. The changes
below correct application behavior; they do not repair an LMS or rewrite saved
capture observations.

## Reproduced application defects

- TRDE120 has 59 identity-bound supplement drafts with `assess/1` CML. The old
  supplement reader rejected that format before discovering its media. Support
  now preserves literal authored content and reference identities. Widgets
  inside readings are explicit unresolved sources, not complete reading bodies.
- Seven valid quiz-owned source images could not pass Brightspace import because
  the original-URL binding walker skipped the native quiz's questions array.
  The bounded native-question traversal now checks those references without
  accepting unrelated arbitrary strings as ownership evidence.
- TRDE120's initial and final native material models differed only in the order
  of known assignment-feature flags. New captures use a narrow, versioned
  comparison for those flags, retaining both exact raw hashes. The historical
  unstable capture remains historical; reimport does not change its status.
- TRDE130 reading 5624702 links to captured native quiz 347162 through an exact
  same-course QuickLink and the quiz ActivityId. Its ten captured native
  questions were retained but absent from the reading view. CTI now presents
  independently checked linked quiz evidence separately. Reading 5624703 links
  to quiz 347163 with no captured definitions; this remains unverified.
- A content review bundle can retain the exact compressed native manifest,
  textual originals and a verified original-media index in a smaller file.
  It explicitly omits binary originals, is not a comparison input, and never
  replaces the full capture. A sharing-size target does not permit truncation.

## Remaining evidence limits

TRDE120's old Coursera file contains 96 entries but only five collector-verified
content items and three projected questions. A fresh capture is needed to read
the 59 formerly unsupported drafts and their referenced files. Two readings have
published atom status and different draft/published asset versions; treating the
older draft as the current published body would be incorrect. Published-only,
manual-question and coach models still require additional acquisition support.

The TRDE120 source retains 47 native question definitions and 167 original
bodies. Its 72 external textbook iframe placements retain their local wrappers,
not the complete external lessons. Five final-assessment image requests reached
an observed Brightspace 404 page. Those are broken-source observations, not
invented replacement paths or proof that the images do not exist elsewhere.

TRDE130 retains 185 Coursera inventory entries and 4,007 question occurrences.
The 43 readings with pointerless native image nodes remain unresolved. Another
item's image cannot fill those blanks as if it were that draft's evidence.
The rescan recovered all 31 prior source collection-limit bindings. Other
external/runtime sources remain unresolved. A large Panopto body was unavailable
to this review's download tools, so complete playback/media coverage was not
established by this review.

Use the active source outline as the delivery baseline. Hidden archived Module 0
remains retained evidence; it does not become required delivery content merely
because a same-title Coursera module exists. Scope and mapping decisions remain
separate from acquisition proof and source-marked answer keys.

## Verification

Focused regressions use synthetic native models for exact ownership, unknown
formats, unchanged historical observations, widget gaps, reordered feature sets,
changed course order, linked quiz proof tampering and original-byte validation.
Browser checks execute the generated bookmark and the review download worker.
Passing fixtures do not establish completeness for every live LMS or plugin.
