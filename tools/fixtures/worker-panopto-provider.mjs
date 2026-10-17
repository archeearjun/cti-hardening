import { readPanoptoProviderMetadata, readPanoptoProviderPodcast } from "../../server/panopto-provider.ts";
import { directPanoptoSourceV1, sanitizeDirectPanoptoModelV1 } from "../../src/extractors/coursera/direct-data-panopto.js";
import { directCanonicalSourceTextV1 } from "../../src/extractors/coursera/direct-data-canonical.js";
import { expectedForm, mediaBytes, metadataPath, source, stateUrl } from "./worker-panopto-source.mjs";

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

export default {
  async test() {
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
    status(cancellable, 200, 200, 2);
    const reader = cancellable.body.getReader();
    equal([...(await reader.read()).value], [...mediaBytes], "The native rendition stream starts before the pending remainder");
    await reader.cancel();
    await new Promise(resolve => setTimeout(resolve, 10));

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
