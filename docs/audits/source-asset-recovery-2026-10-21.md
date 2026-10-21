# PR104: source assessment asset recovery

Baseline main: 6dc770dbf7b9fde9712bfef671e30b403376f9ea (PR103).
Build: v8.0.6-source-asset-recovery-20261021.

## Mechanisms and scope

| Mechanism | Implemented result / remaining evidence |
| --- | --- |
| Broken path, file elsewhere | Candidate enumeration uses exact question reference, manifest dependency paths, exact archive path and case-sensitive filenames from the selected archive. No directory names are inserted. Alternate filenames remain candidates without proven association. |
| Archive original exists, live reference broken | Independent local bytes/hash receipt; live HTTP validity remains separate and unverified. No live request is attempted. |
| No file in package | SOURCE_ASSET_NOT_IN_PACKAGE, never LMS absence. |
| File accessible only through authenticated LMS | LIVE_SOURCE_ACCESS_REQUIRED; live collector remains unsupported in this release. |
| Same filename, different bytes | All bounded candidates retain separate hashes. Filename alone cannot resolve identity. |
| Working source, destination ingestion failure | Source package receipt and exact destination failure IDs displayed separately. No ordinal pairing. |
| Destination incorrectly referenced/repaired | Existing focused destination check remains necessary; no learner rendering or applied repair is inferred. |
| Known URL, unavailable bytes | URL is not binary evidence. No external fetch or guessed paths. |

Reuse: source-package ZIP adapter (CRC, overlap/name validation, bounded extraction),
streamed package hashing, saved comparison input-hash revision, PR103 original-byte
resolver and assessment recovery manifests. No second media storage service,
new database kind, browser extension, LMS endpoint or paid infrastructure.

The owner tool checks one selected source assessment from the matched saved scan.
The original selected IMSCC must independently hash to the comparison's package
hash. Reads are serial, max 128 references, 16 candidates/reference, 128 retained
files, 24 MiB/file, 64 MiB/session and 120 seconds/attempt. No network retries or
concurrent HTTP requests exist in this offline scope. Pause checks run between
bounded reads; retry retains rehashed session bytes and their original timestamps.
Reload requires selecting the original package again. Export receipts are portable;
import validates binding but requires independent package revalidation and does not
promote arbitrary JSON claims. Originals can be downloaded byte-for-byte.

PNG chunk structure, CRCs and dimensions are checked; JPEG/GIF/WebP/PDF receive
bounded format checks, not visual decoding or PDF text validation. HTML/login
responses are rejected. Original references are kept beside candidate/resolved
paths. Credential-bearing locators are omitted. Stored snapshots and parity
thresholds are unchanged. Archive/Instructor scope does not create recovery tasks.

## TRDE120 evidence and limits

The supplied operator observation distinguishes the broken root floor-plan URL
from the displayed Content/ alternative, and the displayed diffuser source from
Coursera's image-creation failures. These are reproduction observations, not binary
receipts. The supplied comparison's filename candidate already grounds discovery
of the floor-plan alternative. No production TRDE120 IDs or paths are hardcoded.

Neither Final Assessment diagram's original bytes is supplied in this task.
Verified recovery of those diagrams: **0**. Operator-observed URL candidates: **2**.
No live Brightspace read occurred. Source-to-destination question association is
still independent, including both destination failure IDs. No new real-course
comparison coverage or learner rendering is claimed.

Real archived-byte replay uses the retained public publisher PNG
c0a9dbab0d104503d32e8a9102a2fddb4c2d172a78414fd1e5d93c0eb66c8514,
1038 bytes, extracted unchanged from recovered.zip. Its original public URL and
archive entry are in tests/fixtures/source-assets/provenance.json. This validates
binary rehash/structure on a real original; it is not either missing assessment
image. The package-resolution tests use independent synthetic course structures
and this original binary; no actual source IMSCC is available for end-to-end real
source recovery. That acceptance criterion remains not demonstrated.

## Operator validation

Open the existing saved comparison and expand “Check source assessment assets in
the original package.” Select the source Final Assessment and the exact original
IMSCC. Save the receipt and any recovered original bytes. Review original and
candidate paths separately. Confirm any alternate-path question/image association
against the authorized source editor before manual repair. Run the existing
focused destination check after an authorized manual edit. No full capture or
bookmark update is required. Repeat using another course's own package/revisions.
