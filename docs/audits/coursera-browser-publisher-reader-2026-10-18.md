# Coursera browser publisher reader: v1.8.1

## Actual v1.8.0 acceptance evidence

The supplied TRDE120 capture at `2026-10-18T14:02:40.715Z` retained the same
96 item identities and native authored models as the earlier capture. Its
39 fully verified items include one newly complete CAD Drawings reading with
ten declared DWG bodies. The new manifest retains all 70 earlier original-file
declarations and adds ten more; this manifest-only audit cannot independently
recompute the new archive's binary hashes, signatures or CRCs.

The inline configuration adapter worked: 54 versioned provider configurations
across 24 readings pass current native CML, course ownership, request-selector,
source/model hash and final atom checks. No public page HTML was retained.
The 44 unique target outcomes were 42 HTTP 403 results, one timeout and one
HTTP 404 result. The source course was not rewritten to account for gaps.

An independently reviewed diagnostic branch tested the exact Area shortlink,
canonical HTML and publisher-advertised chapter API from a temporary Cloudflare
Worker, with ordinary headers and an honest CTI diagnostic user agent. All six
cases ended in HTTP 403 with `cf-mitigated: challenge`. Both cleanup jobs confirmed
deletion. The diagnostic was not merged into the application or production
deployment branch. Its result rules out the proposed server API fallback on
that Cloudflare route; changing the JSON parser cannot repair that access path.

## Browser transport and evidence boundary

The browser reader uses the publisher's public chapter API for supported native
numeric `p` URLs. The API route was advertised in the supplied HAR and its
response is independently observable as public JSON. A browser request uses
ordinary CORS with redirects rejected and no caller-supplied Cookie,
Authorization, Origin or User-Agent headers. Normal publisher cookies can be
sent only by the user's own browser under its existing policy; CTI does not read,
copy or forward them to its service.

A body can be retained only after the browser exposes a successful CORS
response and the original JSON passes bounded UTF-8, identity, public chapter
status, same-book link and independent byte/hash checks. Failed fetches without
an exposed HTTP response do not establish an upstream status or distinguish
CORS, browser policy and network errors. Publisher API JSON remains a separate
representation from original page HTML and native Coursera text.

Raw and rendered publisher fields are distinct observed fields. Neither is
reconstructed from the other. The owner view remains inert; page scripts,
iframes, image requests and interactions do not run when viewing the evidence.
Capturing chapter JSON does not establish captured image/video/caption bytes,
H5P execution, learner launch, assessment keys or complete widget fidelity.
Native question totals and whole-item completion gates remain separate.

The main bookmark also provides a bounded access diagnostic before another
whole-course attempt. A diagnostic reports access and source identity rather
than establishing course capture or changing saved progress. Actual access in
the user's browser remains unverified until that browser exposes a response;
fixture tests and the publisher's default WordPress CORS behavior cannot
certify it.

The diagnostic selects a target only from independently validated saved native
configuration proof. Its `configuredSourceObservedAt` remains the original
observation time; the check does not claim that Coursera's configuration is
fresh. Its response body is not saved or adopted into a course capture. Ordinary
capture/resume refreshes native source bindings before acquiring content.

The exact v1.8.0 build can continue through the existing enrichment path without
a fresh run. Regression coverage retains 80 distinct bound original files,
their bytes, ownership, hashes and dates, prior media budgets and completed
assessment timestamps. With unchanged native bindings, the regression makes no
original-body or assessment-definition requests. The compatibility allowance
does not cover other older builds or relax the capture's independent
completeness checks.

## Other gaps retained

The same capture still has 27 unverified readings: 24 inline widget bodies,
two current published-state reading bodies, and one external archived syllabus
PDF. Its 26 assessments comprise 17 empty native draft part arrays, four
published-state gaps, and five unsupported or incomplete draft models. Empty
draft arrays do not certify that the learner-facing assessment is empty.
Two standalone plugin bodies and two coach bodies remain unverified.

No content, question body or answer key is invented to close these gaps.
