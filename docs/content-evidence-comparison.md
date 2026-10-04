# Source and Coursera content comparison

## Confirmed gap

`qaBuildDestinationOwnerView_` retains at most 900 characters per destination
excerpt and marks that excerpt incomplete. The owner card previously displayed
counts and diagnostics, while full extraction question definitions and text were
not retained in the saved comparison output. A complete count could therefore
hide an incomplete choice capture from the owner's normal view.

## Implemented behavior

- New comparisons retain a typed content snapshot from both supplied extraction
  files after the existing course/input checks. The source package text and
  questions also remain available. The audit engine's rules are unchanged.
- Each item shows source and destination content side by side: retained prompts,
  choice text, captured answer evidence/feedback, text bodies and media/resource
  references. Safe links open only on demand; imported HTML is never injected
  into the page and remote images/frames are not automatically loaded.
- Each text field and question set has its own coverage label. Complete means
  that the relevant explicit receipt matches the retained field or question
  positions. It does not certify answers, media, runtime behavior or the course.
  Unknown totals remain unknown; verified empty editors remain zero. Duplicate
  question identities, count discrepancies and truncation cannot become complete.
- Captured questions are searchable and paginated in groups of 50. The interface
  does not silently show only mismatched questions or pair equal ordinal numbers
  across systems. Full retained text is available, including partial captures.
- The existing authenticated public-source fetch now retains longer H5P prompts,
  choices and observed media references, plus partial static main/article text.
  Multiple banks remain separate observations. Failed embedded-resource reads
  can yield partial content without claiming a complete bank. An unsuccessful or
  partial refresh cannot replace a previously complete saved source bank.
- The Coursera capture control uses the current item-scoped Chrome extractor,
  including its existing waits and question traversal. Importing its result
  updates the displayed observation while retaining the original snapshot
  separately. The user's Coursera session is not accessible from CTI's origin.
- Older reports can load their exact original Coursera/Brightspace input JSON.
  Both the SHA-256 and saved report identity are checked. The recovered content
  is saved as a separate `operations/report-content` supplement; immutable audit
  records, scores and original report text are never updated. Repeated imports
  use a stable report/platform record ID and the existing version-conflict check.
- Text, clipboard and JSON exports load full supplements and item reviews and
  include the same content observations. Source-link identity, input hashes,
  package identity and versions are checked before export. Record lists omit
  large content bodies.

## Verification and limits

Targeted regression cases cover exact/partial/unknown/empty fields, unknown
source totals, duplicate question identities, mathematical comparison signs,
long prompts, HTML-to-text handling, choice capture, source permission failures,
input-hash rejection, repeated imports, immutable audits and stale record reads.
The browser workflow tests both panes, question filtering, old-report recovery,
reload, exports, failed source refreshes and desktop/390px layout.

Replaying the supplied TRDE120 files established 94 Coursera items and 194
Brightspace topics. Percentage (`AqZ8g`) retains the explicit empty-editor
receipt. The old survey (`QgOIm`) has two prompts and no captured choices; the
later item check has 4 and 3 choices. Final Assessment (`LFrHs`) has ten captured
question positions; that count does not clear the known media concerns.

Scope remains bounded: the public reader supports the existing two BCcampus
providers and H5P QuestionSet definitions, not arbitrary protected plugins.
Static page text cannot establish dynamically rendered content. Source provider
requests can be denied (the previous GitHub probe returned HTTP 403); login,
rate limits and unsupported content remain explicit gaps. Signed-in production
Coursera/Brightspace interactions are not validated by fixture/browser tests.

Safety limits are explicit: public prompts 48,000 characters; normalized prompt
display 100,000; body text 300,000; 5,000 question records and 200 choices per
question. Cuts are labeled, never treated as complete. Existing workspace record
size limits remain in force. No extractor version change, schema migration,
paid service or authentication change is required.
