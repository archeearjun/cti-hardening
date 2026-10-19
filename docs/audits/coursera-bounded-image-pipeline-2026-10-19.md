# Bounded publisher-image prefetch

The supplied TRDE120 v1.8.7 manifest records 402,513 milliseconds for its fresh
course attempt. Its media pool permits two concurrent reads, but the observed
peak is one. The 370 publisher-image browser-start to failure-result intervals
sum to 166,551 milliseconds in the serial orchestration. These are reconstructed
receipt intervals, not a complete network trace or a prediction of live savings.
The 451 media-reader operations are not 451 upstream network requests.

## v1.8.8 boundary

Publisher-image collection prefetches at most two source-ordered reads, bounded
by the existing media reader's configured concurrency. URL admission happens in
source order. A single ordered loop commits each resource and awaits immutable
Blob staging before advancing that window. At most two pending reads or results
are held by the pipeline. Started reads settle before collection leaves the item.

This changes orchestration only. The native API pool, publisher helper,
per-origin public-service gate, source binding, byte limits, URL limits and
completion checks retain their existing contracts. In particular, an exposed
publisher challenge still defers later public-service reads for that origin in
the attempt; it does not skip the independent browser reads or invent HTTP
statuses for requests that were not sent. Failed or interrupted resources remain
explicit gaps. Prior observations retain their own source hashes and dates.

Exact v1.8.7 checkpoint recovery is allowed alongside the previously reviewed
publisher builds. Recovery is not a fresh observation of completed native
questions after an LMS edit. Owners must start a fresh course capture to verify
changed course content.

Controlled delayed-response fixtures test overlap and source-order retention,
including original lengths and hashes, serialized staging, rejection and stop
cleanup, unchanged limits and the single-challenge service gate. Passing these
fixtures does not establish a percentage improvement on a private live course,
access to blocked images or whole-course extraction completeness.
