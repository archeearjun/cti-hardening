# Bilateral comparison implementation and evidence boundaries

Baseline: production main 04f9b57c0f1c464d17f10e24f07ef0bd39962e92,
including PRs 99–101. New comparison build: v8.0.4-bound-native-comparison-20261021.
Neither browser collector/version changes; no new extraction or paid service.

## Exact evidence identity

Archive.zip SHA-256 cb02dd921b4dbe9337b388b47f2c3a55d1c675adb619aa6bf996e3ccade7402e
passes ZIP CRC validation. It contains the 108,207,121-byte structured JSON and
6,066,268-byte owner report. The latter is byte-identical to the separate upload.
The embedded original report occurs verbatim within the owner export. Both identify
saved audit 60a3a3df-9212-47d4-8c3b-e04068fd0c41, package
8bddd977-eda0-46ed-a312-7c3d13358f1f, generation 8.
The original Coursera JSON already supplied in this task has SHA-256
fc49502ce97e24fd6c246b98d6fadc8cd1b428115698ef7427c06263fa7037c0,
exactly matching this report's capture hash and archive metadata hash. This is not
an older substituted capture. The comparison records 422 original files; this
report archive does not contain those original media bytes and does not reverify them.

## Root-cause matrix

| Shared mechanism | Exact saved scope | Finding and correction |
| --- | --- | --- |
| No direct match plus incomplete destination inventory bodies | 124 of 125 UNVERIFIED: 115 readings, eight assessments, one assignment | Native workbook-shaped enrichment overwrote authored names with Untitled/New Reading. Source body absence was not established: 34 unresolved destination IDs correctly prevented MISSING. Preserve independently bound authored-name observations and material names separately; exact name/placement yields candidates only. Equal duplicate candidates remain explicit UNVERIFIED, never arbitrary matches. |
| Length-based text coverage instead of the existing bound reading contract | One matched UNVERIFIED: hspvR | The full published CML is 333 characters, with no explicit legacy completeness score. The old heuristic assigned 0.60. Share the independent published-reading verifier between intake and comparison; exact binding, paired receipts, unchanged observations, CML/text hash and no-media conditions remain mandatory. SekFW also uses this proof. |
| Partial content or detected differences | Three PARTIAL | Welcome content drift and two unresolved runtime assessments are not disproved by a name fix. No automatic verdict upgrade. |
| Positive partial relocation evidence | 31 REPACKAGED | 21 asset-based, seven link-based, three semantic recoveries. A retained file/link is not whole instructional parity. Preserve these scopes. |
| No direct one-to-one source match | 90 additional destination items | 47 placeholder classifications, 18 source-asset carriers, 12 admin items, nine consolidation carriers, two present/unverified Coaches, one content extra, one ingestion-failure extra. These are not 90 proven unnecessary items. |
| Source definitions versus source totals | 47 definitions in seven Brightspace quizzes | Pagination and descriptive exam length do not prove all bank/pool members. Preserve raw instructional question fields, weights, feedback and explicit empty choices through normalization. Retain QTI document-local item/ancestor identities and fixed/selected memberships independently of native LMS identifiers; preserve separate file policies on merge. |
| Different readiness scopes | Comparison critical=2; destination readiness critical=0; unmatched ingestion artifact=1 | The two critical source comparisons are VF1sb/AqZ8g. LFrHs has a retained QUESTION_IMAGE_CREATION_ERROR, which a matching-name repair must not erase. Explain each denominator; do not sum them or suppress evidence. |
| Owner summary buried behind originals | Summary at approximately line 128,015 in supplied export | Put a read-only decision brief first, retain original report verbatim afterward, show exact IDs/available item links, question-text candidates, separate source/destination gaps and scope exclusions. Excluded Archive/Instructor items do not become publication tasks. |

The result's `verified` array contains 37 SHA256_EXACT asset entries; it is not
37 verified core instructional items. The summary's VERIFIED=0 is a different
scope. Original file integrity never establishes PDF text or visual fidelity.

## Measured replay, not a new course verdict

The same 161 core source identities and 96 native destination entries were used
for a structural-candidate replay. The saved algorithm had six direct matches.
The tightened duplicate policy alone leaves three candidates with old names;
with bound authored names, 58 candidates survive. Of the 124 formerly unmatched
UNVERIFIED rows, 38 gain a candidate and 86 do not. The remaining one matched
UNVERIFIED reading receives independently verified text coverage, not automatic
source parity. No full source scan was reconstructed from report projections.

Exact retained prompt/ordered-option text yields nine unique question candidates:
three Brightspace topic 5293607 → Coursera 6eUE7, six topic 5623907 → LFrHs.
All original question IDs remain distinct. These do not certify the remaining
questions, grading, media, rubrics, bank counts or published-state equality.
The 47/7 source definition count and 62/96 native capture completion remain
unchanged. New whole-course comparison metrics require an operator replay with
the original saved source scan and archives.

## Supported implementation and limits

- Native authored-name evidence is rebound to item/atom/course/relation and
  successful receipts. Independent XLSX names remain authoritative when supplied.
- Short complete published CML uses the exact existing verifier, including
  foreign identity, changed final response and forged text rejection.
- Brightspace selected definition fields preserve raw HTML and exact scoring
  structures alongside normalized comparison text. Empty options survive; no
  key, answer or staff-grading enum is invented.
- QTI scopes retain fixed IDs, per-scope selected counts and member IDs with
  document-local identities. They are not native quiz IDs. Multiple QTI files
  retain individual selection policies without inventing an aggregate runtime total.
- Duplicate structural candidates and duplicate question-text candidates remain
  explicit ambiguity. Exact question-text candidates do not mutate saved mapping
  or verdicts and are not definitive many-to-one/one-to-many transformations.
- Summary/report changes do not alter original records, capture media, timestamps,
  history or the eight-request/chunk-resume workspace protections.

No observed source response here establishes a QTI-to-Brightspace native ID
crosswalk or complete library/pool membership. For that branch, inspect the
existing Brightspace quiz editor's Questions and Question Library/pool settings
for quiz IDs 324438 and 347076–347081, retaining authored membership, selections
and original identifiers; avoid attempts/submissions and learner records. If an
IMSCC rescan is needed, use the same original package, not a fresh course capture.

For unresolved published assessments, inspect the exact item's authoring version
history first; only an actually published version may supply published-body
proof. LFrHs's verified authoring draft does not require publication. Existing
runtime-widget references and Kaltura/caption pointers remain evidence gaps until
a supported response with original bodies is supplied; no endpoint is invented.
Coach intentional incompleteness is an owner explanation until corroborated by
source state. Role Play/Dialogue configurations and Archive exclusion remain intact.

## Operator check

Reload CTI; reuse the existing TRDE120 source scan, Coursera ZIP and Brightspace
capture, with XLSX blank. Save a new comparison alongside the old one. Confirm
engine v8.0.4, authored names, explicit duplicate ambiguity, separate draft and
published evidence, and the decision brief before raw evidence in the owner
export. Inspect question candidates without approving parity solely from text.
Do not delete checkpoints or start a new course extraction. No bookmark update.
For a second course, repeat with that course's own source scan/captures and assess
its candidate ambiguities and evidence scopes independently; TRDE120 mappings
and totals are not reusable evidence for another course.
