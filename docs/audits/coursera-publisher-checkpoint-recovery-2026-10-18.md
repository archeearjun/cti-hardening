# Coursera publisher checkpoint recovery: v1.8.2

The v1.8.1 access diagnostic returned `PUBLISHER_CHECK_NO_RECORDED_SOURCE`
with zero requests for the supplied TRDE120 v1.8.0 capture. This did not establish
a publisher access failure: selection stopped before the publisher reader ran.

The real checkpoint store's completed-run recovery filter omitted v1.8.0.
Entry orchestration already allowed that build, but never received the stored
run. Earlier entry tests mocked `getActiveRun`, so the 80-original continuation
test missed this storage boundary.

Replaying the supplied manifest found 96 matching native inventory identities
and 24 valid inline reading proofs. Its exact run metadata was rejected by the
real store filter; changing only the build to the then-current version selected
the same row. The fixed real store selects the original v1.8.0 row with no writes.
These replays establish the defect and valid recorded sources; they do not
establish that the user's current Chrome profile contains the saved database.

Version 1.8.2 shares the two exact publisher-capable historical build IDs between
entry adoption and completed checkpoint selection: v1.8.0 and v1.8.1. Existing
course ownership, state, acquisition, source-stability, TTL, counters and budget
checks still apply. Other older builds are not newly admitted. Reading a run
does not migrate, rewrite or refresh its historical content or observations.

Regression coverage exercises the actual checkpoint store and historical rows,
including original bodies, definitions, dates and cumulative budgets. The
browser integration seeds completed historical metadata in real IndexedDB and
then runs the generated bookmark's access diagnostic before a new capture can
replace it. Publisher requests must occur while saved records remain unchanged;
no question, original-media or course recapture is performed by that check.

The publisher reader and its CORS, identity, privacy, byte, hash and completeness
rules are unchanged. Actual publisher access in the user's browser remains
unobserved until the corrected diagnostic exposes a response there.
