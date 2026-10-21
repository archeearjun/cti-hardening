# Explicit Coach inventory in native-capture comparisons

Baseline is main ae2bdabb860cddcb032c85337b3570f1245803bd (PR #100).
The existing uploaded JSON has extractedAt 2026-10-20T18:18:49.759Z,
matching the operator's selected archive timestamp. Its unchanged SHA-256 is
6d7120892fb5d197b6ed75d264e1d365d095a8be56bd1eb87dea5950e0603952.
The screenshot's apparent v4Sel is the captured ID v4SeI (capital I).

## Reproduced defect

Running the deployed captureStructureWorkbook against that JSON reproduces:
`Native inventory item v4SeI has unsupported type coach. Supply a matching Coursera XLSX; this type cannot be inferred as Reading.`
The native material inventory independently validates all 96 entries. The
structural adapter lacked the explicit Coach mapping, and the workbook-shaped
engine input had a second allowlist that also omitted Coach. Neither is a reason
to call the item Reading or require another export.

## Observed evidence

Both items are under module OEmBn / lesson cTF9Q, Archive > Archive Content,
and have exact course/item/atom relation entries for course
iu5pMbTVEfG-2xL_w9lGpQ.

| Item | Atom | Retained states |
| --- | --- | --- |
| v4SeI | K5Y4fcF3EfGSsRL_ziS-2w | storedAtomVersion 2; publishedAtomStatus; coachDraft with rolePlay@1 and roleplayFields; published display Role Play and reference AvsYOhW5S9C7GDoVuZvQpA@2 |
| 4u4Kk | Y3w3UsF3EfGLaA7_-bntkw | storedAtomVersion 1; publishedAtomStatus; draft field absent; published display Dialogue and reference 5MxEwU_ZR82MRMFP2ffN3Q@1 |

The Role Play observation retains exact cover instructions, persona, scenario,
tasks, rubric prompt parameters, empty communication modes and asset arrays.
Published references do not contain the actual versioned Coach activity bodies.
Both retain UNRESOLVED_DIRECT_TYPE / DIRECT_AUTHORING_ATOM_STATE_UNSUPPORTED.
The source recheck does not certify current Coach content. Stored atom versions,
versioned activity references, draft schemas and publication status are distinct.

## Change and acceptance boundaries

- Recognize native coach as Coach and accept Coach/Role Play/Dialogue inventory
  rows explicitly. Unknown native kinds still fail instead of becoming readings.
- Retain Coach draft and published observations separately after exact retained
  item/atom/course/relation checks and successful source receipt IDs. This is
  CONSISTENT_RETAINED_IDS, not a cryptographic body or completeness certificate.
  Original response hashes are not reinterpreted as hashes of sanitized models.
- Preserve literal configuration, IDs, statuses, observation dates and reason
  arrays. The existing credential sanitizer also protects the derived projection;
  original capture input is never rewritten.
- Keep Coach content unverified even if an input claims complete=true. Equal
  text hashes cannot certify it. Only exact-item enrichment transfers its model.
- Unmatched Coaches are PRESENT_UNVERIFIED with explicit reasons, not inferred
  administrative extras, missing items, or instructions to delete content.
  Independently observed source type/placement differences remain reportable.
- Existing bilateral MISSING versus UNVERIFIED guards remain in effect.

## Tests and claim limits

The regression fixture is an inventory/Coach subset of the uploaded JSON, not
another full capture. It retains the original native material models and Coach
configuration, omits other instructional bodies/media, and removes actor/edit
metadata. End-to-end comparison uses a synthetic source baseline with this subset.
Tests cover all 96 inventory entries, both Coaches, exact placement/configuration,
absent drafts and synthetic explicit-null drafts, foreign bindings, false completion flags, credential stripping,
ID-bound enrichment, source-absence guards, known item types and unknown types.
The deployed-versus-patched inventory check uses the actual uploaded JSON.

The companion 50.48 MB ZIP and the selected TRDE120 source/Brightspace inputs
were not newly supplied for this task. JSON alone cannot replay missing original
media bytes; that separate integrity check remains unchanged. Do not claim a full
real-course comparison or higher extraction completeness from these tests.
Final CI/deployment evidence is recorded in the release PR.

## Minimal operator check

Reload CTI after deployment. Reuse the same source scan, existing Coursera
ITEM_FINGERPRINT ZIP and Brightspace capture; leave Coursera XLSX blank. Run and
save a new comparison, retaining the previous report. Confirm all 96 destination
entries remain represented, with v4SeI and 4u4Kk typed Coach and their content
unverified. No new extraction, XLSX export or checkpoint reset is required.
