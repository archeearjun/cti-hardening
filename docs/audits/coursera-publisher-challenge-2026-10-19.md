# Publisher image challenges in the TRDE120 capture

The supplied v1.8.4 manifest retained all 96 inventory entries, with 39 native
items verified, 38 publisher JSON originals and no publisher image originals.
All 366 distinct (publisher JSON hash, literal image URL) service jobs recorded
an actual upstream HTTP 403. They represent 346 image URLs in 408 placements.
The service HTTP 502 was the error envelope, not the publisher's response.

An isolated, credential-free public diagnostic at commit
`cf3e2e27f9278235bd54287668914fb5d1f74b91`, Actions run `39201775480`,
job `117896062403`, checked two literal image URLs and the EPUB download
explicitly linked by the publisher's book page. Both an ordinary runner and an
ephemeral Cloudflare preview received HTTP 403 with `cf-mitigated: challenge`
for all three targets. Only six public GETs were made. No challenge was retried,
solved or read as course content; no publisher cookie or browser identity was
forwarded. The preview changed no production deployment.

This establishes those diagnostic responses, not a challenge header on every
historical 403. The supplied earlier browser HAR contains a successful original
for one exact selected image. A refusal does not establish missing source
content, and a browser preview is not a captured image original.

## v1.8.5 behavior

The service reports an explicit challenge only when its actual image response
is HTTP 403 with the publisher's challenge marker. Generic 403s remain generic.
The bookmark records the observed challenge separately from the browser's
unreadable response. Subsequent same-origin service image reads in that capture
are deferred, retaining every literal image reference and the earlier challenge
context. Their records explicitly state that no service request or publisher
HTTP result was observed. Direct browser image reads and publisher API/text
reads continue. A new capture/resume permits a new service attempt.

Reports distinguish observed publisher statuses, CTI service failures and
deferred reads. Existing capture metadata, raw JSON, original timestamps,
historical original files and completeness decisions remain separate. A
challenge never creates an original-file reference or a verified item.

This release improves failure handling and avoids hundreds of repeated service
requests. It does not remove the publisher's challenge or certify full content.
The publisher must make the original files available through an approved route
before CTI can retain those bytes. An EPUB is a separate publisher snapshot and
cannot silently replace the selected live image URLs.
