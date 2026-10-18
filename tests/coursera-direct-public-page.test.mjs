import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import {
  directPublicHtmlEvidenceV1,
  directPublicPageTargetV1,
  directPublicPageSourceValidV1,
  directPublicPageHtmlBytesV1,
} from "../src/extractors/coursera/direct-data-public-page.js";
import { readPublicHtmlProvider } from "../server/public-html-provider.ts";

const targetUrl =
  "https://opentextbc.ca/syntheticbook/chapter/area/?p=179/#main";
const html =
  '\ufeff<!doctype html><html><body><main><h2>Original area lesson</h2><p>Use the authored formula.</p><iframe src="https://unread.example/activity"></iframe></main></body></html>';
const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
function provider(overrides = {}) {
  const calls = [],
    reader = createDirectDataReaderV1({
      sanitize: (value) => ({ data: value }),
      limits: overrides.limits,
      providerTransport: {
        request: async (kind, payload, signal) => {
          calls.push({ kind, payload });
          const response = await readPublicHtmlProvider(payload.targetUrl, {
            signal,
            fetcher: async (url, options) => {
              assert.equal(
                url,
                "https://opentextbc.ca/syntheticbook/chapter/area/?p=179",
              );
              assert.equal(options.method, "GET");
              assert.equal(options.credentials, "omit");
              return new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
              });
            },
          });
          return overrides.response ? overrides.response(response) : response;
        },
      },
    });
  return { reader, calls };
}
const binding = { itemId: "nativeItem", providerId: "p".repeat(22) + "@3" };

test("native reader retains exact original public HTML with source and envelope hashes/bytes separate", async () => {
  const f = provider();
  const result = await f.reader.readPublicPage(targetUrl, binding);
  assert.equal(result.ok, true, result.reason);
  const observation = { model: result.data, receipt: result.receipt },
    before = structuredClone(observation);
  assert.equal(
    directPublicHtmlEvidenceV1(observation, targetUrl, hashBytes),
    observation,
  );
  assert.equal(observation.model.html, html);
  assert.equal(observation.model.requestedUrl, targetUrl);
  assert.equal(
    observation.model.normalizedUrl,
    "https://opentextbc.ca/syntheticbook/chapter/area/?p=179",
  );
  assert.equal(
    observation.model.sha256,
    hashBytes(new TextEncoder().encode(html)),
  );
  assert.equal(observation.model.statusCoverage, "PARTIAL_PUBLIC_HTML_ONLY");
  assert.equal(
    result.receipt.bytes,
    new TextEncoder().encode(JSON.stringify(result.data)).length,
  );
  assert.equal(
    result.receipt.upstreamBytes,
    new TextEncoder().encode(html).length,
  );
  assert.equal(
    result.receipt.originalResponseSha256,
    hashBytes(new TextEncoder().encode(JSON.stringify(result.data))),
  );
  assert(result.receipt.bytes > result.receipt.upstreamBytes);
  assert.equal(result.receipt.resource, "PublicStaticHtml");
  assert.equal(result.receipt.id, targetUrl);
  assert.equal(result.receipt.method, "GET");
  assert.equal(result.receipt.bodyFormat, "PARSED_PUBLIC_HTML_ENVELOPE");
  assert.equal(f.reader.snapshot().requests, 1);
  assert.equal(f.reader.snapshot().bytes, result.receipt.bytes);
  assert.equal(f.reader.snapshot().byResource.PublicStaticHtml, 1);
  assert.deepEqual(f.calls, [
    { kind: "publicHtml", payload: { targetUrl, ...binding } },
  ]);
  assert.deepEqual(observation, before);
  assert(!JSON.stringify(observation).includes('"wholeWidgetVerified":true'));
});

test("retained source text, MIME, redirect scope, clocks, native request path and source hashes fail closed after changes", async () => {
  const f = provider(),
    result = await f.reader.readPublicPage(targetUrl, binding),
    original = { model: result.data, receipt: result.receipt };
  const changes = [
    (o) => {
      o.model.html += "extra";
    },
    (o) => {
      o.model.sha256 = "f".repeat(64);
    },
    (o) => {
      // A coherent same-byte-length HTML edit cannot reuse the original CTI
      // response-envelope receipt even after updating the source-body hash.
      o.model.html = o.model.html.replace(
        "Original area lesson",
        "Invented area lesson",
      );
      o.model.sha256 = hashBytes(new TextEncoder().encode(o.model.html));
    },
    (o) => {
      o.model.contentType = "text/html;charset=latin1";
    },
    (o) => {
      o.model.contentType = "text/html;charset=utf8;charset=latin1";
    },
    (o) => {
      o.model.statusCoverage = "COMPLETE";
    },
    (o) => {
      o.model.bodyVerified = true;
    },
    (o) => {
      o.model.finalUrl = "https://opentextbc.ca/anotherbook/chapter/area/";
    },
    (o) => {
      o.model.requestedUrl =
        "https://opentextbc.ca/syntheticbook/chapter/other/";
    },
    (o) => {
      o.receipt.upstreamBytes++;
    },
    (o) => {
      o.receipt.bytes = 0;
    },
    (o) => {
      o.receipt.method = "POST";
    },
    (o) => {
      o.receipt.serviceOrigin = "https://evil.example";
    },
    (o) => {
      o.receipt.observedAt = "2026-10-17T00:00:00.000Z";
    },
    (o) => {
      o.receipt.requestPath = "/other";
    },
    (o) => {
      o.receipt.requestQuery = [];
    },
    (o) => {
      o.receipt.originalResponseSha256 = "";
    },
  ];
  for (const change of changes) {
    const bad = structuredClone(original);
    change(bad);
    assert.equal(directPublicHtmlEvidenceV1(bad, targetUrl, hashBytes), null);
  }
  assert.equal(
    directPublicHtmlEvidenceV1(original, targetUrl),
    null,
    "Independent source byte hashing is mandatory",
  );
  assert.equal(
    directPublicHtmlEvidenceV1(original, targetUrl, () =>
      Promise.resolve(original.model.sha256),
    ),
    null,
  );
});

test("invalid targets and binding values trigger no helper/network read", async () => {
  const f = provider();
  for (const bad of [
    "https://evil.example/book/page/",
    "https://opentextbc.ca/book/%2e%2e/other/",
    "https://opentextbc.ca/book/page/#access_token=secret",
    "https://opentextbc.ca/book/page/?token=secret",
  ]) {
    assert.equal(directPublicPageTargetV1(bad), null);
    assert.equal((await f.reader.readPublicPage(bad, binding)).ok, false);
  }
  assert.equal(
    (await f.reader.readPublicPage(targetUrl, { providerId: "bad@1&other" }))
      .ok,
    false,
  );
  assert.equal(f.calls.length, 0);
  const bare = createDirectDataReaderV1();
  assert.equal(
    (await bare.readPublicPage(targetUrl)).reason,
    "PUBLIC_HTML_PROVIDER_HELPER_UNAVAILABLE",
  );
});

test("helper error envelopes and capped failed reads remain charged without source acquisition claims", async () => {
  const body = JSON.stringify({ error: "PUBLIC_HTML_PROVIDER_HTTP_403" });
  const f = provider({
    response: async (response) => {
      await response.body.cancel();
      return new Response(body, {
        status: 502,
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(body).length),
          "X-CTI-Provider-Transport": "CTI_PUBLIC_BACKEND",
          "X-CTI-Provider-Origin": "https://cti-hardening.pages.dev",
          "X-CTI-Upstream-Status": "403",
          "X-CTI-Upstream-Observed-At": "2026-10-18T12:00:00.000Z",
          "X-CTI-Upstream-Bytes": "0",
          "X-CTI-Upstream-Requests": "1",
        },
      });
    },
  });
  const result = await f.reader.readPublicPage(targetUrl, binding);
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.equal(result.reason, "PUBLIC_HTML_PROVIDER_HTTP_403");
  assert.equal(result.receipt.bytes, body.length);
  assert.equal(f.reader.snapshot().bytes, body.length);
  const capped = provider({ limits: { bodyBytes: 100 } });
  const failed = await capped.reader.readPublicPage(targetUrl, binding);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "API_RESPONSE_BYTE_LIMIT");
  assert.equal(failed.data, null);
});

test("source bytes/hash and generic service receipt cannot contradict the returned JSON envelope", async () => {
  for (const mode of [
    "source-hash",
    "service-origin",
    "upstream-bytes",
    "envelope-length",
    "missing-custom-length",
    "invalid-custom-length",
    "bad-model",
    "bad-json",
  ]) {
    const f = provider({
      response: async (response) => {
        const data = await response.json(),
          headers = new Headers(response.headers);
        if (mode === "source-hash") data.sha256 = "f".repeat(64);
        if (mode === "bad-model") data.mime = "application/json";
        if (mode === "service-origin")
          headers.set("X-CTI-Provider-Origin", "https://evil.example");
        if (mode === "upstream-bytes") headers.set("X-CTI-Upstream-Bytes", "1");
        if (mode === "missing-custom-length")
          headers.delete("X-CTI-Response-Envelope-Bytes");
        if (mode === "invalid-custom-length")
          headers.set("X-CTI-Response-Envelope-Bytes", "not-a-number");
        const json = mode === "bad-json" ? "malformed" : JSON.stringify(data);
        headers.set(
          "content-length",
          String(
            new TextEncoder().encode(json).length +
              (mode === "envelope-length" ? 1 : 0),
          ),
        );
        if (mode === "envelope-length")
          headers.set(
            "X-CTI-Response-Envelope-Bytes",
            String(new TextEncoder().encode(json).length + 1),
          );
        return new Response(json, { headers });
      },
    });
    const result = await f.reader.readPublicPage(targetUrl, binding);
    assert.equal(result.ok, false, mode);
    assert.equal(result.data, null, mode);
  }
});

test("mandatory canonical decoded-envelope bytes survive compression or missing wire-length headers", async () => {
  for (const encoding of ["gzip", null]) {
    const f = provider({
      response: async (response) => {
        const bytes = new Uint8Array(await response.arrayBuffer()),
          headers = new Headers(response.headers);
        if (encoding) {
          headers.set("content-encoding", encoding);
          headers.set("content-length", "20");
        } else headers.delete("content-length");
        return new Response(bytes, { headers });
      },
    });
    const result = await f.reader.readPublicPage(targetUrl, binding);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.receipt.declaredEnvelopeBytes, result.receipt.bytes);
    assert.equal(result.data.html, html);
    assert(
      directPublicHtmlEvidenceV1(
        { model: result.data, receipt: result.receipt },
        targetUrl,
        hashBytes,
      ),
    );
  }
  const explicitIdentity = provider({
    response: async (response) => {
      const bytes = await response.arrayBuffer(),
        headers = new Headers(response.headers);
      headers.set("content-encoding", "identity");
      headers.set("content-length", "20");
      return new Response(bytes, { headers });
    },
  });
  assert.equal(
    (await explicitIdentity.reader.readPublicPage(targetUrl, binding)).reason,
    "PUBLIC_HTML_ENVELOPE_LENGTH",
  );
});

test("a helper ignoring cancellation cannot hold the public read beyond the existing native request deadline", async () => {
  const reader = createDirectDataReaderV1({
    limits: { requestMs: 15 },
    providerTransport: { request: () => new Promise(() => {}) },
  });
  const result = await reader.readPublicPage(targetUrl, binding);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "PROVIDER_HELPER_REQUEST_TIMEOUT");
  assert.equal(reader.snapshot().requests, 1);
});

test("large overlapping unclosed tags cannot cause quadratic login/privacy scanning", () => {
  for (const fragment of ["<input x ", '<form action="']) {
    const malformed =
      "<html><body>" +
      fragment.repeat(Math.floor(1000000 / fragment.length)) +
      "</body></html>";
    const began = performance.now();
    assert(directPublicPageHtmlBytesV1(malformed));
    assert(
      performance.now() - began < 2000,
      "One bounded HTML scan must remain linear across nested unclosed tag starts",
    );
  }
  assert.equal(
    directPublicPageHtmlBytesV1(
      '<html><body><input type="password"></body></html>',
    ),
    null,
  );
  assert.equal(
    directPublicPageHtmlBytesV1(
      '<html><form action="/wp-login.php"></form></html>',
    ),
    null,
  );
});
