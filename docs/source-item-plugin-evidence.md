# Source-item links and targeted plugin evidence

QA build: `v8.0.0-source-item-evidence-20260930`. Coursera remains v6.14.7,
schema 34. Brightspace is v1.0.8, schema 2.

The owner card's primary source action now opens the matched Brightspace topic.
The course-home action remains separately labelled. New comparisons retain
source-to-topic mappings, accepting only unique, high-confidence, same-title
navigation matches in the same learner/archive/instructor area. Older reports
can resolve a unique same-title topic beneath their exact module ancestry,
including an added Assess folder. Duplicate candidates remain unresolved;
an unavailable item link never silently becomes a homepage link. Original
document/Quicklink targets remain available separately.

Existing reports with source navigation context benefit after refreshing the
app. A report without a saved Brightspace context needs a new comparison using
its original source inputs. New comparison runs retain their own mappings;
old audit records are not rewritten.

For a plugin whose frame cannot be read from Coursera, the owner card offers
an optional page capture for an observed destination target:

1. Copy the page capture script and open the captured target.
2. Run the script in that page's console. If the page only works embedded,
   select its exact frame in the Coursera console's execution-context menu.
3. Keep the owner card open and upload the downloaded page-check JSON there.

The script requires the exact target URL, waits at least 10 seconds (up to 20),
and records the visible screen with bounded text and reference lists. Loading
or empty pages remain partial. A route change aborts capture. It does not click
through activities, read form values, fetch assets, or bypass frame permissions.
The import checks report, course, item, target and request identity, plus a
24-hour request age. It is stored separately with the item review and reopens
a previously checked item. It never proves course launch, interactions, hidden
screens, binary identity, or full-plugin/course fidelity. These diagnostic JSON
files are rejected as full course audit inputs.

Brightspace and QA now recognize descriptions such as “two (2) questions” and
“ten (10) long-answer (calculation) questions”. Conflicting spellings, multiple
counts and pool-selection wording remain unresolved. Matching a described
exam length to returned definitions does not certify the source question bank;
new Brightspace captures record that agreement separately from completeness.
Existing captures can be reused for a comparison to correct the displayed
description count without a fresh LMS crawl.

Unnamed ingestion warnings can now be localized when the event explicitly
names one unique source in the stated module. Original wording and subject
are retained. Generic names, duplicate matches, multiple named items and
other-module matches do not receive guessed identities.

Verification covers current and older navigation context, duplicate/archive
negatives, copied script execution, page identity and freshness, bounded and
loading captures, immutable audit separation, parser agreement, and named-claim
ambiguity. Private TRDE120 files are used locally only. Authenticated Brightspace
redirects and real plugin operation still require live acceptance in the LMS.
