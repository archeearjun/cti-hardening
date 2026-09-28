# Option row boundary correction — 28 September 2026

Coursera v6.14.1 keeps schema 34. The QA engine build is
`v8.0.0-option-boundary-20260928`; the Brightspace extractor is unchanged.

The assignment parser was replacing correctly scoped DOM option rows with a
flattened-text candidate because the latter received a higher semantic score.
Periods in units and compass abbreviations were treated as sentence boundaries.
This moved part of each answer into the previous answer's description and could
move the final `Add Variant` button into a description. Depending on similarity,
the result could produce either a false change warning or a false match.

The parser now preserves observed rows. Collapsed-badge recovery remains
available when row evidence is absent or has an explicit contamination signal.
The QA guard also recognizes the old combination of repeated shortened labels,
shifted descriptions, observed correctness states and a trailing editor control.
Affected options and answer evidence become unverified. Original text, states,
question counts and captured evidence remain intact; no answers are filled from
the source package. Unrelated clean differences continue to be compared.

Regression coverage uses synthetic content, not uploaded course material:

- Unit and compass abbreviations, with both first and last choices correct.
- Explicit descriptions and separate feedback fields.
- Browser/server guard agreement and immutable original captures.
- Old damaged captures cannot pass or manufacture option changes.
- Literal control words and independent clean option changes remain supported.

The retained core suite, source contracts, 20 hardening simulations and Node
tests are required, along with the production build. Google-service integration
cases and a skipped migration fixture are not claimed as executed. Live
acceptance still requires a fresh capture using v6.14.1; re-running a comparison
with old JSON can downgrade unreliable evidence but cannot recover missing row
boundaries. Reuse the source, Brightspace capture and unchanged XLSX. Keep the
same ingestion generation and snapshot stage when no course edits occurred.
