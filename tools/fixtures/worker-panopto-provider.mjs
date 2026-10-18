import { readPanoptoProviderMetadata, readPanoptoProviderPodcast } from "../../server/panopto-provider.ts";
import { directPanoptoSourceV1, sanitizeDirectPanoptoModelV1 } from "../../src/extractors/coursera/direct-data-panopto.js";
import { directCanonicalSourceTextV1 } from "../../src/extractors/coursera/direct-data-canonical.js";
import { createDirectDataReaderV1 } from "../../src/extractors/coursera/direct-data-network.js";
import { createApiHandler } from "../../server/api.ts";
import { CTI_OWNER_EMAIL } from "../../server/access.ts";
import { forwardWorkspaceRuntime, WorkspaceRuntime } from "../../workers/coursera-extractor/workspace-runtime.ts";
import { expectedForm, mediaBytes, metadataPath, source, stateUrl,
  publicHtmlBytes, publicHtmlRaw, publicHtmlUrl, publicHtmlOrigin, publicHtmlPath } from "./worker-panopto-source.mjs";
import { publisherImageRuntimeChecks } from "./worker-publisher-image.mjs";

export { WorkspaceRuntime };

function assert(condition, message) { if (!condition) throw Error(message); }
function equal(actual, expected, message) { assert(JSON.stringify(actual) === JSON.stringify(expected), message + ": " + JSON.stringify({ actual, expected })); }
const bytesOf = value => new TextEncoder().encode(value);
async function sha256(value) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function inputFor(host) {
  const fixture = source(host), clean = sanitizeDirectPanoptoModelV1(fixture.model, fixture.targetUrl).data;
  return { fixture, input: { targetUrl: fixture.targetUrl, streamFileId: fixture.ids.D,
    sourceHash: await sha256(bytesOf(directCanonicalSourceTextV1(directPanoptoSourceV1(fixture.targetUrl, clean)))) } };
}
async function state() { const response = await fetch(stateUrl); return response.json(); }
function status(response, service, upstream, requests) {
  equal(response.status, service, "Service HTTP status");
  equal(response.headers.get("X-CTI-Upstream-Status"), String(upstream), "Actual upstream HTTP status");
  equal(response.headers.get("X-CTI-Upstream-Requests"), String(requests), "Actual upstream request count");
  equal(response.headers.get("X-CTI-Provider-Transport"), "CTI_PUBLIC_BACKEND", "Public transport declaration");
}

/** The actual Pages forwarder, private service envelope, Durable Object and
 * provider body reader run unchanged. Only Access identity is a fixture; both
 * outbound routes stay inside workerd's existing in-memory mock service. */
async function publicHtmlRuntimeChecks(env) {
  assert(env.PRIVATE_RUNTIME && env.WORKSPACE_RUNTIME, "The private service and actual Durable Object namespace are bound");
  let pagesProviderCalls = 0;
  const api = createApiHandler(async () => ({ email: CTI_OWNER_EMAIL }), async () => {
    pagesProviderCalls++; throw Error("Pages cannot parse or fetch public HTML");
  });
  const origin = "https://cti-hardening.pages.dev",
    environment = { CTI_EDITORS: CTI_OWNER_EMAIL, CTI_EXTRACTOR: env.PRIVATE_RUNTIME,
      CTI_DB: { prepare() { throw Error("Provider reads must not reach D1"); } } };
  function read(targetUrl, changes = {}) {
    const { role = "editor", extraInput = {}, requestOrigin = origin } = changes;
    return api(new Request(origin + "/api/provider/public-html", { method: "POST",
      headers: { Origin: requestOrigin, "Content-Type": "application/json", Cookie: "synthetic=must-not-forward",
        Authorization: "Bearer synthetic-must-not-forward", "x-cti-user": "forged@example.test" },
      body: JSON.stringify({ targetUrl, ...extraInput }) }),
    role === "viewer" ? { ...environment, CTI_EDITORS: "" } : environment);
  }
  for (const name of ["success", "chunked", "same-book-redirect"]) {
    const targetUrl = publicHtmlUrl(name), response = await read(targetUrl);
    status(response, 200, 200, name === "same-book-redirect" ? 2 : 1);
    equal(response.headers.get("X-CTI-Provider-Origin"), origin, "The public receipt belongs to the actual service origin");
    equal(response.headers.get("X-CTI-Upstream-Bytes"), String(publicHtmlBytes.length), "Public UTF-8 body byte receipt");
    const wire = new Uint8Array(await response.arrayBuffer()), model = JSON.parse(new TextDecoder().decode(wire));
    equal(Number(response.headers.get("X-CTI-Response-Envelope-Bytes")), wire.length, "The canonical decoded JSON envelope retains exact framing through the private DO");
    if (response.headers.get("Content-Encoding")?.trim().toLowerCase() === "identity" && response.headers.has("Content-Length"))
      equal(Number(response.headers.get("Content-Length")), wire.length, "An explicitly identity-encoded HTTP length agrees with decoded framing");
    equal(model.requestedUrl, targetUrl, "The authored public URL stays separate");
    equal(model.normalizedUrl, targetUrl, "The normalized GET target is explicit");
    equal(model.finalUrl, name === "same-book-redirect" ? publicHtmlUrl("success") : targetUrl, "The observed final same-book URL is explicit");
    equal(model.redirects.length, name === "same-book-redirect" ? 1 : 0, "Every followed redirect is retained");
    equal(model.html, publicHtmlRaw, "Public HTML retains exact original markup, Unicode and BOM");
    equal([...bytesOf(model.html)], [...publicHtmlBytes], "UTF-8 decode/encode preserves every original byte");
    equal(model.sha256, await sha256(publicHtmlBytes), "The public original's SHA-256 is recomputed from actual bytes");
    equal(model.statusCoverage, "PARTIAL_PUBLIC_HTML_ONLY", "HTML alone cannot certify an entire widget");
  }
  const networkReader = createDirectDataReaderV1({ providerTransport: { async request(kind, input) {
    equal(kind, "publicHtml", "The bookmark requests the closed public operation");
    equal(input.itemId, "SyntheticReading", "The item binding crosses the helper operation");
    return read(input.targetUrl);
  } } });
  const observed = await networkReader.readPublicPage(publicHtmlUrl("success"), {
    itemId: "SyntheticReading", providerId: "p".repeat(22) + "@1",
  });
  assert(observed.ok, "The maintained bookmark reader accepts the actual private runtime response: " + observed.reason);
  equal(observed.data.html, publicHtmlRaw, "The bookmark stores the unchanged public original");
  equal(observed.receipt.upstreamBytes, publicHtmlBytes.length, "Bookmark receipt distinguishes source bytes from JSON envelope bytes");
  equal(observed.receipt.method, "GET", "The retained public source method is GET");
  equal(observed.receipt.transport, "CTI_PUBLIC_BACKEND", "Bookmark receipt records the observed transport");
  const decodedServiceReader = createDirectDataReaderV1({ providerTransport: { async request(_kind, input) {
    const response = await read(input.targetUrl), headers = new Headers(response.headers);
    // Model what browser fetch exposes after HTTP decompression. This is a
    // client framing case, not a claim that the mock sent a gzip wire stream.
    headers.set("Content-Encoding", "gzip"); headers.set("Content-Length", "17");
    return new Response(response.body, { status: response.status, headers });
  } } });
  const decoded = await decodedServiceReader.readPublicPage(publicHtmlUrl("success"));
  assert(decoded.ok, "Canonical decoded framing survives differing compressed wire length: " + decoded.reason);
  equal(decoded.data.html, publicHtmlRaw, "Service compression context does not alter the captured original HTML");
  equal(globalThis.__CTI_PUBLIC_HTML_EXECUTED__, undefined, "Captured HTML scripts are never executed");

  const forbidden = await read("https://never-follow.invalid/not-an-approved-book/");
  status(forbidden, 400, 0, 0);
  equal((await forbidden.json()).error, "PUBLIC_HTML_PROVIDER_INVALID_TARGET", "Arbitrary URLs cannot become a generic proxy");
  for (const [name, expected] of [
    ["foreign-redirect", "PUBLIC_HTML_PROVIDER_REDIRECT_SCOPE"],
    ["other-book-redirect", "PUBLIC_HTML_PROVIDER_REDIRECT_SCOPE"],
    ["invalid-utf8", "PUBLIC_HTML_PROVIDER_INVALID_UTF8"],
    ["wrong-charset", "PUBLIC_HTML_PROVIDER_MIME_OR_CHARSET"],
    ["range", "PUBLIC_HTML_PROVIDER_HTTP_200"],
    ["encoded", "PUBLIC_HTML_PROVIDER_ENCODING"],
    ["too-large", "PUBLIC_HTML_PROVIDER_BODY_LIMIT_OR_LENGTH"],
    ["stream-too-large", "PUBLIC_HTML_PROVIDER_BODY_LIMIT_OR_LENGTH"],
  ]) {
    const response = await read(publicHtmlUrl(name));
    status(response, 502, name === "foreign-redirect" ? 302 : name === "other-book-redirect" ? 308 : 200, 1);
    equal(await response.json(), { error: expected }, "Native public source failure stays structured and contains no source/error page: " + name);
  }
  const short = await read(publicHtmlUrl("short-framed"));
  status(short, 502, 200, 1);
  assert(/^PUBLIC_HTML_PROVIDER_/.test((await short.json()).error), "A native short framed EOF cannot become a captured HTML page");
  equal((await read(publicHtmlUrl("success"), { role: "viewer" })).status, 403, "Read-only CTI users cannot launch a provider read");
  equal((await read(publicHtmlUrl("success"), { requestOrigin: "https://untrusted.example.test" })).status, 403, "The provider still requires the same-origin boundary");
  equal((await read(publicHtmlUrl("success"), { extraInput: { headers: { Cookie: "forbidden" } } })).status, 400, "Caller headers cannot enter the closed input shape");
  equal(pagesProviderCalls, 0, "All public HTML parsing and source fetching ran inside the private DO, outside Pages");
  const observedCalls = (await state()).calls.filter(call => call.url.startsWith(publicHtmlOrigin + publicHtmlPath));
  assert(observedCalls.length >= 12 && observedCalls.every(call => call.method === "GET" && !call.body), "Every public source acquisition is a bodyless native GET");
  assert(observedCalls.every(call => call.headers.every(([name]) => !["cookie", "authorization", "referer", "x-cti-user", "x-cti-role"].includes(name.toLowerCase()))), "Neither caller credentials nor CTI delegation identity reaches a public book");
  console.log("CTI_WORKERD_PUBLIC_HTML_PROVIDER_PASS " + JSON.stringify({ actualWorkersRuntime: true,
    actualPrivateDurableObject: true, pagesParsesSource: false, nativePublicGet: true,
    rawUtf8BomAndHash: true, serviceEnvelopeFraming: true, decodedServiceFraming: true, sameBookRedirectsOnly: true,
    malformedUtf8Rejected: true, sizeLimits: true, shortFramingRejected: true,
    credentialsForwarded: false, livePublicAccessVerified: false, sockets: 0, externalNetwork: false }));
}

export default {
  async fetch(request, env) { return forwardWorkspaceRuntime(request, env); },
  async test(_controller, env) {
    equal(bytesOf(expectedForm).byteLength, 193, "The observed eight-field form remains exact");
    const { fixture, input } = await inputFor("success.hosted.panopto.com");
    // No fetcher injection: these maintained readers call native workerd fetch.
    const metadata = await readPanoptoProviderMetadata(fixture.targetUrl);
    status(metadata, 200, 200, 1);
    const raw = new Uint8Array(await metadata.arrayBuffer());
    equal([...raw], [...bytesOf(fixture.raw)], "Native JSON response bytes survive unchanged");
    equal(JSON.parse(new TextDecoder().decode(raw)), fixture.model, "Native metadata model survives unchanged");
    equal(metadata.headers.get("X-CTI-Upstream-Bytes"), String(raw.length), "Native metadata response byte receipt");
    const podcast = await readPanoptoProviderPodcast(input);
    status(podcast, 200, 200, 2);
    equal(podcast.headers.get("X-CTI-Validation-Source-Hash"), input.sourceHash, "Fresh native source hash is bound to media");
    equal(podcast.headers.get("X-CTI-Validation-Bytes"), String(raw.length), "Fresh validation response bytes are counted");
    equal(podcast.headers.get("X-CTI-Upstream-Content-Length"), String(mediaBytes.length), "The full source length survives streaming headers");
    const body = new Uint8Array(await podcast.arrayBuffer());
    equal([...body], [...mediaBytes], "Native rendition bytes survive unchanged");
    equal(await sha256(body), await sha256(mediaBytes), "Native rendition byte hash");

    for (const code of [301, 302, 303, 307, 308]) {
      const redirected = await readPanoptoProviderMetadata(source("redirect-" + code + ".hosted.panopto.com").targetUrl);
      status(redirected, 502, code, 1);
      const error = await redirected.json();
      assert(["PANOPTO_PROVIDER_REDIRECT", "PANOPTO_PROVIDER_HTTP_" + code].includes(error.error), "A real manual redirect is rejected explicitly");
    }
    const redirectedMedia = await readPanoptoProviderPodcast((await inputFor("redirect-media.hosted.panopto.com")).input);
    status(redirectedMedia, 502, 307, 2);
    assert(["PANOPTO_PROVIDER_REDIRECT", "PANOPTO_PROVIDER_HTTP_307"].includes((await redirectedMedia.json()).error), "A real media redirect is rejected explicitly");
    const denied = await readPanoptoProviderMetadata(source("denied.hosted.panopto.com").targetUrl);
    status(denied, 502, 401, 1);
    equal(await denied.json(), { error: "PANOPTO_PROVIDER_HTTP_401" }, "Native authentication failure is not a local fetch failure or raw error body");

    const controller = new AbortController();
    const pending = readPanoptoProviderMetadata(source("cancel-metadata.hosted.panopto.com").targetUrl, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    const interrupted = await pending;
    status(interrupted, 499, 200, 1);
    equal(await interrupted.json(), { error: "PANOPTO_PROVIDER_ABORTED" }, "Cancelled metadata cannot become partial success");
    const cancellable = await readPanoptoProviderPodcast((await inputFor("cancel-media.hosted.panopto.com")).input);
    if (cancellable.status !== 200) {
      const diagnostic = await cancellable.json().catch(() => ({}));
      throw Error("Cancellable native media setup failed: " + JSON.stringify({
        status: cancellable.status,
        upstreamStatus: cancellable.headers.get("X-CTI-Upstream-Status"),
        upstreamRequests: cancellable.headers.get("X-CTI-Upstream-Requests"),
        error: /^PANOPTO_PROVIDER_[A-Z0-9_]{1,80}$/.test(diagnostic?.error || "")
          ? diagnostic.error : "PANOPTO_PROVIDER_UNEXPECTED_ERROR_RESPONSE",
      }));
    }
    status(cancellable, 200, 200, 2);
    const reader = cancellable.body.getReader();
    equal([...(await reader.read()).value], [...mediaBytes], "The native rendition stream starts before the pending remainder");
    await reader.cancel();
    await new Promise(resolve => setTimeout(resolve, 10));

    await publicHtmlRuntimeChecks(env);
    await publisherImageRuntimeChecks(env);

    const observed = await state();
    assert(observed.calls.every(call => !call.url.startsWith("https://never-follow.invalid/")), "Neither metadata nor media redirects are followed");
    assert(observed.calls.every(call => call.headers.every(([name]) => !["cookie", "authorization"].includes(name.toLowerCase()))), "No upstream request receives credentials");
    const posts = observed.calls.filter(call => new URL(call.url).pathname === metadataPath);
    assert(posts.length >= 10 && posts.every(call => call.method === "POST" && call.body === expectedForm), "Every native metadata request uses the exact observed form");
    console.log("CTI_WORKERD_PANOPTO_PROVIDER_PASS " + JSON.stringify({ nativeCloudflareRuntime: true,
      maintainedProvider: true, metadataAndPodcast: true, redirectsNeverFollowed: true,
      metadataCancellation: true, streamConsumerCancellation: true, credentialsForwarded: false, sockets: 0, externalNetwork: false,
      livePanoptoAccessVerified: false }));
  },
};
