# Owner evidence handoff and explicit native recheck

The v1.8.9 change adds a richer proposed-only agent handoff, task-specific
evidence readiness, a manual bookmark capture plan across saved titles, and an
explicit native Coursera recheck. It does not certify all live content types.

## Owner handoff

`assignment-agent-handoff.ts` loads the exact current course, comparison,
retained-content supplements and owner follow-ups. It binds the packet to input
hashes, immutable record versions and the existing structural-artifact basis,
then rechecks those bindings before returning. A changed selection cancels the
download. The existing revision import still accepts only proposed structural
fields; the outer evidence packet is not an import artifact or an LMS write.

The packet includes retained questions, separately labelled attached drafts,
provider evidence, unresolved sources, the full owner report, and per-member
scope provenance. Automatic folder rules are labelled as defaults, not owner
approval or learner visibility. Original binary bodies are omitted with explicit
descriptors; source text and raw JSON strings remain unchanged. The exact
original archives are still required for binary review. Exceeding the 32 MiB
packet limit fails explicitly instead of truncating evidence.

## Readiness and title planning

The read-only readiness view distinguishes orientation, structural drafting,
assessment review, original-media review and post-edit verification. Its states
are provisional, needs evidence or unknown. An inventory, a saved file, a
reviewed checkbox, an export timestamp and a successful content observation are
different evidence. None of these labels approves publication or changes a
historical comparison. Missing live-source evidence and observed source read
failures remain distinct.

The title capture plan navigates an operator to the appropriate existing CTI
tool. It uses saved metadata, handles newer inputs and changed source baselines,
and retains older input identities in its downloadable plan. It does not launch
bookmarks, reuse an LMS login, validate unavailable original bytes or start an
automatic multi-title extraction queue.

## Native Coursera recheck

`Recheck native course content` explicitly rereads every current native item,
its atom/relation binding and mutable question-group references. It may reuse an
exact versioned definition only through the existing receipt/hash validators;
reused definitions and normalized questions retain their original observation
dates. A changed material graph starts a separate run as before. The action
does not reset cumulative request, byte or time budgets.

The checkpoint selector can include a previously complete run only for this
explicit action and only with its existing course/run/build identity, native
completion/stability proof, matching counts and unspent budgets. Ordinary
capture/resume behavior remains separate.

Graph discovery does not checkpoint into a prior run before ownership is known.
A changed graph leaves the earlier run intact and charges its discovery reads
to the new run. Failed discovery retains originals with current verification
withdrawn. Once ownership is established, the existing hydration path restores
retained page and body budgets before new allocation.

A failed current read retains older raw observations as historical evidence,
records the failed recheck separately, and does not count the item as currently
verified. Pending-item invalidation and a per-attempt observation stamp keep
untouched old items out of current counts after a pause, exhausted budget,
interrupted storage write, export or reopen. Labelled failed attempts remain
historical evidence after later successful checks.
Published bodies do not become verified through attached drafts.
External runtime interactions, inaccessible quiz variants/pools, publisher
challenges, media bytes and playback require their own evidence. This release
does not add a source contract for those remaining gaps.

## Validation boundary

Focused domain and entry tests exercise stale bindings, scope provenance,
binary omission, evidence dates, complete-run selection and failed rechecks.
The generated-bookmark browser fixture exercises actual IndexedDB selection,
fresh native reads, exact-version reuse, changed content and retained failure
evidence. The owner browser fixture exercises the rendered workflow. Hosted
checks are controlled fixtures, not a live certification of the user's titles.
