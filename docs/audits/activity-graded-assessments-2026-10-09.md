# Graded assessment recognition in activity preparation

Reviewed the supplied Operations Section v6.15.11/schema-35 capture (11 items,
2026-10-09T07:44:54.320Z), its P01 packet and the displayed activity card. The
raw capture and partner document bodies are not committed to the repository.

## Confirmed defects and corrections

| Location | Evidence and impact | Correction | Verification |
| --- | --- | --- | --- |
| `shell-capture.js`, `compact.js`, `app.js`, `activity-quality.js`, `readiness.js` | High: the packet counted zero assessments for two `staffGraded` items. The unread assignment was absent from deterministic practice recovery, even though the AI identified it. | Shared assessment/practice type classification includes `staffGraded` and `peerGraded`, with consistent counts, recovery and comparison gates. | Regression verifies counts, unread item IDs, coverage warnings and refusal to copy an otherwise valid draft. Browser check covers the displayed assessment count. |
| `cti-adapter.js` | Medium: one complete declared `file-upload` question became `partial_unverified` because its response type was outside the adapter allowlist. | Recognize file-upload questions for learner-text coverage, preserving question-count, identity, prompt-reliability and receipt checks. No choice options or answer key is required for this response type. | Positive canonical receipt and negative unknown type, missing prompt, unreliable prompt, incomplete/mixed receipt and unverified choices. |
| `cti-documents.js`, `cti-adapter.js`, `shell-runner.js` | High: the same type omission could classify staff-graded or peer-graded material as teaching, including retaining assessment PDFs in a teaching packet. This was reproduced with synthetic attachments, not observed in the supplied packet's two PDFs. | Apply the shared classification before learner-text projection and PDF packaging. Keep assessment attachments only in the original input. | Regression verifies no assessment PDF is parsed or retained as teaching. Existing key/feedback exclusion tests remain. |

## Actual capture verification

The revised adapter processed the supplied raw JSON and both captured PDFs with
the installed PDF.js parser: 11 items, 2 originals, 82 PDF pages processed for
text (not visual interpretation). The learner-facing module now reports two
assessments, one with captured learner text. `woE7c` has one of one declared
file-upload prompts and receives `learner_text_captured`; `blyBd` remains unread
and is the explicit practice recovery item. Both packet PDF hashes match their
original bytes. No missing workbook or assignment text was inferred.

## Remaining limits

- The participant workbook has an unresolved asset identifier, not its teaching
  body. The first assignment has no structured learner body or observed-empty
  receipt. Neither establishes missing course/source content.
- All 11 items were visited, but the raw completion contract reports only one
  complete item. Four retry attempts left six items retryable; this is not a
  successful full-content extraction. Live published-item navigation and asset
  recovery need separate diagnosis; this patch does not change the canonical
  extractor or claim to fix those gaps.
- No item route is recorded in this snapshot. The app continues to report the
  missing verified deep link rather than fabricate a visited route.
- Existing summative task text supports the overlap concern for a tactics-meeting
  proposal. Better counts cannot establish non-duplication with the unread task.
- The pasted card omits the bodies of collapsed notes/references. It is not
  sufficient evidence of a rendering defect or the exact imported result JSON.

Preparation version: 2.2.4. Re-import the raw capture and prepare a new packet;
an existing AI packet or saved session retains its previous computed evidence.
Reprocessing improves classification, not extraction of absent bodies. No
production course content or approval decisions are modified.
