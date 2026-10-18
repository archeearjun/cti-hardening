import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readPublicHtmlProvider } from "../server/public-html-provider.ts";
import {
  directPublicPageSourceValidV1,
  directPublicPageTargetV1,
} from "../src/extractors/coursera/direct-data-public-page.js";
import { createApiHandler, handleAuthorized } from "../server/api.ts";
import { CTI_OWNER_EMAIL } from "../server/access.ts";
import {
  forwardWorkspaceApi,
  isProviderApiPath,
  workspaceRuntimeApiRequest,
  workspaceRuntimeCaller,
} from "../server/workspace-runtime.ts";

const serviceOrigin = "https://cti-hardening.pages.dev";
const target = "https://opentextbc.ca/tradesmath/?p=225/#main";
const normalized = "https://opentextbc.ca/tradesmath/?p=225";
const secret = "SYNTHETIC_PRIVATE_UPSTREAM_DETAIL";
const html =
  '<!doctype html><html><body><main><h1>Exact authored text</h1><p>café 日本語 ¼</p><iframe src="/tradesmath/?h5p-embed=7"></iframe><script>throw Error("must not execute")</script></main></body></html>';
const bytesOf = (value) => new TextEncoder().encode(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function responseAt(url, body = html, options = {}) {
  return Object.defineProperty(
    new Response(body, {
      ...options,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...options.headers,
      },
    }),
    "url",
    { value: String(url) },
  );
}
function fixture(reply = (url) => responseAt(url)) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url: String(url), options });
      return reply(url, options, calls.length);
    },
  };
}
function transport(
  response,
  { requests, bytes, upstream = 200, origin = serviceOrigin } = {},
) {
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(
    response.headers.get("X-CTI-Provider-Transport"),
    "CTI_PUBLIC_BACKEND",
  );
  assert.equal(response.headers.get("X-CTI-Provider-Origin"), origin);
  if (requests !== undefined)
    assert.equal(
      response.headers.get("X-CTI-Upstream-Requests"),
      String(requests),
    );
  if (bytes !== undefined)
    assert.equal(response.headers.get("X-CTI-Upstream-Bytes"), String(bytes));
  if (upstream !== null)
    assert.equal(
      response.headers.get("X-CTI-Upstream-Status"),
      String(upstream),
    );
}
async function safeError(response, expectedCode, expectedStatus) {
  assert.equal(response.ok, false);
  if (expectedStatus !== undefined)
    assert.equal(response.status, expectedStatus);
  transport(response, { upstream: null });
  const raw = await response.text();
  assert(!raw.includes(secret));
  assert(!raw.includes("https://"));
  assert(
    raw.length < 200,
    "Provider errors contain a tiny code, never upstream HTML",
  );
  const value = JSON.parse(raw);
  assert.deepEqual(Object.keys(value), ["error"]);
  assert.match(value.error, /^PUBLIC_HTML_PROVIDER_[A-Z0-9_]{1,80}$/);
  if (expectedCode) assert.equal(value.error, expectedCode);
  return value;
}

test("one public static HTML GET preserves exact UTF-8 bytes, URL spelling and a hash-bound partial envelope", async () => {
  const { calls, fetcher } = fixture();
  const response = await readPublicHtmlProvider(target, { fetcher });
  assert.equal(response.status, 200);
  const wire = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.headers.get("Content-Length"), String(wire.length));
  assert.equal(
    response.headers.get("X-CTI-Response-Envelope-Bytes"),
    String(wire.length),
  );
  const model = JSON.parse(new TextDecoder().decode(wire));
  assert.equal(model.kind, "CTI_PUBLIC_STATIC_HTML");
  assert.equal(model.schemaVersion, 1);
  assert.equal(model.statusCoverage, "PARTIAL_PUBLIC_HTML_ONLY");
  assert.equal(model.requestedUrl, target);
  assert.equal(model.normalizedUrl, normalized);
  assert.equal(model.finalUrl, normalized);
  assert.deepEqual(model.redirects, []);
  assert.equal(model.status, 200);
  assert.equal(model.mime, "text/html");
  assert.equal(model.contentType, "text/html; charset=utf-8");
  assert.equal(model.encoding, "UTF8");
  assert.equal(model.html, html);
  assert.equal(model.bytes, bytesOf(html).length);
  assert.equal(model.sha256, sha256(bytesOf(html)));
  assert.equal(
    model.observedAt,
    response.headers.get("X-CTI-Upstream-Observed-At"),
  );
  assert.equal(new Date(model.observedAt).toISOString(), model.observedAt);
  assert.equal(directPublicPageSourceValidV1(model, target), true);
  transport(response, { requests: 1, bytes: model.bytes });
  assert.equal(
    calls.length,
    1,
    "An embedded H5P reference must not start a crawl",
  );
  const call = calls[0];
  assert.equal(call.url, normalized);
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.credentials, "omit");
  assert.equal(call.options.redirect, "manual");
  assert.equal(call.options.body, undefined);
  assert.equal(call.options.signal.aborted, false);
  assert.deepEqual(
    [...new Headers(call.options.headers)],
    [
      ["accept", "text/html, application/xhtml+xml"],
      ["accept-encoding", "identity"],
    ],
  );
});

test("both closed public providers and historical page-ID spelling are accepted without changing the original", async () => {
  for (const url of [
    "https://pressbooks.bccampus.ca/tradesmath/chapter/fractions/#main",
    "https://opentextbc.ca/tradesmath/?h5p-embed=7",
    "https://opentextbc.ca/tradesmath/wp-admin/admin-ajax.php?action=h5p_embed&id=7",
  ]) {
    const { calls, fetcher } = fixture();
    const response = await readPublicHtmlProvider(url, { fetcher });
    assert.equal(response.status, 200);
    const model = await response.json();
    assert.equal(model.requestedUrl, url);
    assert.equal(
      model.normalizedUrl,
      directPublicPageTargetV1(url).normalizedUrl,
    );
    assert.equal(calls.length, 1);
  }
});

test("unsafe host, credentials, port, raw path normalization and query capabilities fail before any GET", async () => {
  for (const url of [
    "http://opentextbc.ca/tradesmath/",
    "https://opentextbc.ca.evil.test/tradesmath/",
    "https://127.0.0.1/tradesmath/",
    "https://localhost/tradesmath/",
    "https://user:password@opentextbc.ca/tradesmath/",
    "https://opentextbc.ca:8443/tradesmath/",
    "https://opentextbc.ca/tradesmath/wp-login.php",
    "https://opentextbc.ca/tradesmath/wp-json/users",
    "https://opentextbc.ca/tradesmath/wp-admin/admin-ajax.php?action=delete&id=7",
    "https://opentextbc.ca/tradesmath/wp-admin/admin-ajax.php?action=h5p_embed&id=7&id=8",
    "https://opentextbc.ca/tradesmath/?p=1&p=2",
    "https://opentextbc.ca/tradesmath/?p=not-a-number",
    "https://opentextbc.ca/tradesmath/?url=https://evil.test/",
    "https://opentextbc.ca/tradesmath/?access_token=" + secret,
    "https://opentextbc.ca/tradesmath/#access_token=" + secret,
    "https://opentextbc.ca/tradesmath/#%61ccess_token=" + secret,
    "https://opentextbc.ca/tradesmath/%2e%2e/other/",
    "https://opentextbc.ca/tradesmath/../other/",
    "https://opentextbc.ca/tradesmath/./chapter/",
    "https://opentextbc.ca/tradesmath/%2Fchapter/",
    "https://opentextbc.ca/tradesmath/\\chapter/",
    " https://opentextbc.ca/tradesmath/",
    "https://opentextbc.ca/tradesmath/\nchapter/",
    "https://opentextbc.ca/",
    "https://opentextbc.ca/tradesmath/" + "a".repeat(4000),
  ]) {
    const { calls, fetcher } = fixture();
    await safeError(
      await readPublicHtmlProvider(url, { fetcher }),
      "PUBLIC_HTML_PROVIDER_INVALID_TARGET",
      400,
    );
    assert.equal(calls.length, 0, url);
  }
});

test("manual same-book redirects retain every hop, never fetch bodies or embedded links on the redirect", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const next = "https://opentextbc.ca/tradesmath/chapter/fractions/";
    let cancelled = false;
    const { calls, fetcher } = fixture((url, _options, count) =>
      count === 1
        ? responseAt(
            url,
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { status, headers: { Location: next } },
          )
        : responseAt(url),
    );
    const response = await readPublicHtmlProvider(target, { fetcher });
    assert.equal(response.status, 200);
    const model = await response.json();
    assert.deepEqual(model.redirects, [{ from: normalized, to: next, status }]);
    assert.equal(model.finalUrl, next);
    assert.equal(model.sha256, sha256(bytesOf(html)));
    assert.equal(cancelled, true);
    assert.equal(calls.length, 2);
    assert(calls.every(({ options }) => options.redirect === "manual"));
    transport(response, { requests: 2, bytes: bytesOf(html).length });
    assert.equal(directPublicPageSourceValidV1(model, target), true);
  }
});

test("cross-book, cross-host, credential-bearing, absent and looping redirects stop without following", async () => {
  for (const location of [
    "https://opentextbc.ca/other-book/",
    "https://pressbooks.bccampus.ca/tradesmath/",
    "https://evil.test/tradesmath/",
    "https://127.0.0.1/tradesmath/",
    "https://user:password@opentextbc.ca/tradesmath/",
    "https://opentextbc.ca/tradesmath/?token=" + secret,
    normalized,
    null,
  ]) {
    const { calls, fetcher } = fixture((url) =>
      responseAt(url, secret, {
        status: 302,
        headers: location === null ? {} : { Location: location },
      }),
    );
    await safeError(
      await readPublicHtmlProvider(target, { fetcher }),
      "PUBLIC_HTML_PROVIDER_REDIRECT_SCOPE",
      502,
    );
    assert.equal(calls.length, 1);
  }
  const threeRedirects = fixture((url, _options, count) =>
    count < 4
      ? responseAt(url, "", {
          status: 302,
          headers: { Location: "/tradesmath/chapter/page-" + count + "/" },
        })
      : responseAt(url),
  );
  const allowed = await readPublicHtmlProvider(target, {
    fetcher: threeRedirects.fetcher,
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).redirects.length, 3);
  assert.equal(threeRedirects.calls.length, 4);
  const tooMany = fixture((url, _options, count) =>
    responseAt(url, "", {
      status: 302,
      headers: { Location: "/tradesmath/chapter/page-" + count + "/" },
    }),
  );
  await safeError(
    await readPublicHtmlProvider(target, { fetcher: tooMany.fetcher }),
    "PUBLIC_HTML_PROVIDER_REDIRECT_SCOPE",
    502,
  );
  assert.equal(
    tooMany.calls.length,
    4,
    "Three redirects plus one final attempted response is the entire budget",
  );
});

test("unexpected auto-follow, non-200 and partial-range responses never become captured HTML", async () => {
  for (const reply of [
    (url) =>
      Object.defineProperty(responseAt(url), "redirected", { value: true }),
    () => responseAt("https://opentextbc.ca/tradesmath/other/"),
    (url) => responseAt(url, secret, { status: 401 }),
    (url) => responseAt(url, secret, { status: 403 }),
    (url) => responseAt(url, secret, { status: 500 }),
    (url) => responseAt(url, html, { status: 206 }),
    (url) =>
      responseAt(url, html, { headers: { "Content-Range": "bytes 0-20/400" } }),
  ]) {
    const { calls, fetcher } = fixture(reply);
    await safeError(
      await readPublicHtmlProvider(target, { fetcher }),
      undefined,
      502,
    );
    assert.equal(calls.length, 1);
  }
});

test("HTML MIME and explicit UTF-8 framing reject binary, nonidentity and invalid charset responses", async () => {
  for (const headers of [
    { "Content-Type": "application/json" },
    { "Content-Type": "video/mp4" },
    { "Content-Type": "text/plain" },
    { "Content-Type": "text/html; charset=iso-8859-1" },
    { "Content-Type": "text/html; charset=utf-16le" },
    { "Content-Type": "text/html; charset=utf-8; charset=iso-8859-1" },
    { "Content-Type": "text/html; charset=utf-8; charset=utf-8" },
    { "Content-Type": "text/html; " + "a".repeat(260) },
    { "Content-Encoding": "gzip" },
    { "Content-Encoding": "br" },
  ]) {
    const { fetcher } = fixture((url) => responseAt(url, html, { headers }));
    await safeError(
      await readPublicHtmlProvider(target, { fetcher }),
      undefined,
      502,
    );
  }
  for (const contentType of [
    "application/xhtml+xml; charset=UTF-8",
    'text/html; charset="utf8"',
    "text/html; charset=us-ascii",
  ]) {
    const { fetcher } = fixture((url) =>
      responseAt(url, "<html><main>ASCII source</main></html>", {
        headers: {
          "Content-Type": contentType,
          "Content-Encoding": "identity",
        },
      }),
    );
    assert.equal(
      (await readPublicHtmlProvider(target, { fetcher })).status,
      200,
    );
  }
});

test("invalid UTF-8 is an explicit gap while a valid BOM survives byte-for-byte", async () => {
  for (const invalid of [
    Uint8Array.from([
      ...bytesOf("<html><main>"),
      0xc3,
      0x28,
      ...bytesOf("</main></html>"),
    ]),
    Uint8Array.from([...bytesOf("<html>"), 0xe2, 0x82]),
  ]) {
    const { fetcher } = fixture((url) => responseAt(url, invalid));
    await safeError(
      await readPublicHtmlProvider(target, { fetcher }),
      "PUBLIC_HTML_PROVIDER_INVALID_UTF8",
      502,
    );
  }
  const original = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf(html)]);
  const { fetcher } = fixture((url) =>
    responseAt(url, original, {
      headers: { "Content-Length": String(original.length) },
    }),
  );
  const response = await readPublicHtmlProvider(target, { fetcher });
  assert.equal(response.status, 200);
  const model = await response.json();
  assert.equal(model.html.charCodeAt(0), 0xfeff);
  assert.deepEqual(bytesOf(model.html), original);
  assert.equal(model.sha256, sha256(original));
  assert.equal(model.bytes, original.length);
});

test("login, credential-bearing, non-HTML and control-byte originals are rejected without redaction", async () => {
  for (const body of [
    '<html><form action="/tradesmath/wp-login.php"><input type="text"></form></html>',
    '<html><input type="password" value="' + secret + '"></html>',
    '<html><script>const access_token="' + secret + '";</script></html>',
    "<html><p>Bearer AAAAAAAAAAAAAAAAAAAA</p></html>",
    '<html><a href="https://other.test/file?signature=' +
      secret +
      '">file</a></html>',
    '{"not":"an HTML document"}',
    "<html><main>prefix\u0000suffix</main></html>",
    "",
  ]) {
    const { fetcher } = fixture((url) => responseAt(url, body));
    await safeError(
      await readPublicHtmlProvider(target, { fetcher }),
      undefined,
      502,
    );
  }
});

test("declared length, streamed bytes and JSON-envelope limits are independently bounded", async () => {
  for (const length of [
    "0",
    "-1",
    "1.5",
    "1e3",
    "9007199254740992",
    String(bytesOf(html).length - 1),
    String(bytesOf(html).length + 1),
    "1048577",
  ]) {
    const { fetcher } = fixture((url) =>
      responseAt(url, html, { headers: { "Content-Length": length } }),
    );
    await safeError(
      await readPublicHtmlProvider(target, { fetcher }),
      "PUBLIC_HTML_PROVIDER_BODY_LIMIT_OR_LENGTH",
      502,
    );
  }
  const exact = fixture((url) =>
    responseAt(url, html, {
      headers: { "Content-Length": String(bytesOf(html).length) },
    }),
  );
  assert.equal(
    (await readPublicHtmlProvider(target, { fetcher: exact.fetcher })).status,
    200,
  );
  let cancelled = false;
  const oversized = fixture((url) =>
    responseAt(
      url,
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytesOf("<html>"));
          controller.enqueue(new Uint8Array(100));
        },
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await safeError(
    await readPublicHtmlProvider(target, {
      fetcher: oversized.fetcher,
      limits: { bodyBytes: 64 },
    }),
    "PUBLIC_HTML_PROVIDER_BODY_LIMIT_OR_LENGTH",
    502,
  );
  assert.equal(cancelled, true);
  const normal = fixture();
  await safeError(
    await readPublicHtmlProvider(target, {
      fetcher: normal.fetcher,
      limits: { envelopeBytes: 200 },
    }),
    "PUBLIC_HTML_PROVIDER_ENVELOPE_LIMIT",
    502,
  );
  const expansion = fixture((url) =>
    responseAt(url, "<html>" + '"'.repeat(1_048_560) + "</html>"),
  );
  await safeError(
    await readPublicHtmlProvider(target, { fetcher: expansion.fetcher }),
    "PUBLIC_HTML_PROVIDER_ENVELOPE_LIMIT",
    502,
  );
  // The same raw-body cap applies even if an internal caller requests more.
  const absolute = fixture((url) =>
    responseAt(url, "<html>" + "a".repeat(1_048_577) + "</html>"),
  );
  await safeError(
    await readPublicHtmlProvider(target, {
      fetcher: absolute.fetcher,
      limits: { bodyBytes: 1e9 },
    }),
    "PUBLIC_HTML_PROVIDER_BODY_LIMIT_OR_LENGTH",
    502,
  );
});

test("thousands of tiny positive chunks stop at the bounded allocation count and cancel the source", async () => {
  let chunks = 0;
  let cancelled = false;
  const prefix = bytesOf("<html>");
  const { calls, fetcher } = fixture((url) =>
    responseAt(
      url,
      new ReadableStream(
        {
          pull(controller) {
            chunks++;
            controller.enqueue(chunks === 1 ? prefix : Uint8Array.of(97));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    ),
  );
  const response = await readPublicHtmlProvider(target, { fetcher });
  await safeError(response, "PUBLIC_HTML_PROVIDER_BODY_CHUNK_LIMIT", 502);
  assert.equal(chunks, 8193);
  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
  transport(response, { requests: 1, bytes: prefix.length + 8192 });
});

test("missing bodies, errored streams and endless empty chunks fail safely", async () => {
  for (const reply of [
    (url) => responseAt(url, null),
    (url) =>
      responseAt(
        url,
        new ReadableStream({
          start(controller) {
            controller.error(Error(secret));
          },
        }),
      ),
    (url) =>
      responseAt(
        url,
        new ReadableStream({
          start(controller) {
            controller.enqueue("not bytes");
            controller.close();
          },
        }),
      ),
    (url) =>
      responseAt(
        url,
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array());
          },
        }),
      ),
  ]) {
    const { fetcher } = fixture(reply);
    await safeError(
      await readPublicHtmlProvider(target, { fetcher }),
      undefined,
      502,
    );
  }
});

test("deadline and cancellation settle even when upstream fetch ignores AbortSignal", async () => {
  for (const explicitAbort of [false, true]) {
    const controller = new AbortController();
    let observedSignal;
    const pending = readPublicHtmlProvider(target, {
      signal: controller.signal,
      limits: { requestMs: explicitAbort ? 1000 : 10 },
      fetcher: async (_url, options) => {
        observedSignal = options.signal;
        return new Promise(() => {});
      },
    });
    if (explicitAbort) controller.abort();
    const response = await pending;
    await safeError(
      response,
      explicitAbort
        ? "PUBLIC_HTML_PROVIDER_ABORTED"
        : "PUBLIC_HTML_PROVIDER_TIMEOUT",
      explicitAbort ? 499 : 504,
    );
    assert.equal(observedSignal.aborted, true);
  }
  const preAborted = new AbortController();
  preAborted.abort();
  const { calls, fetcher } = fixture();
  await safeError(
    await readPublicHtmlProvider(target, {
      fetcher,
      signal: preAborted.signal,
    }),
    "PUBLIC_HTML_PROVIDER_ABORTED",
    499,
  );
  assert.equal(calls.length, 0);
});

test("deadline cancels a hung body and cancels a response that arrives after timeout", async () => {
  let bodyCancelled = false;
  const hangingBody = fixture((url) =>
    responseAt(
      url,
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytesOf("<html>partial"));
        },
        cancel() {
          bodyCancelled = true;
        },
      }),
    ),
  );
  const timed = await readPublicHtmlProvider(target, {
    fetcher: hangingBody.fetcher,
    limits: { requestMs: 10 },
  });
  await safeError(timed, "PUBLIC_HTML_PROVIDER_TIMEOUT", 504);
  assert.equal(bodyCancelled, true);
  transport(timed, { requests: 1, bytes: bytesOf("<html>partial").length });
  const abortController = new AbortController();
  let explicitBodyCancelled = false;
  const explicitBody = readPublicHtmlProvider(target, {
    signal: abortController.signal,
    fetcher: async (url) =>
      responseAt(
        url,
        new ReadableStream({
          pull() {
            abortController.abort();
          },
          cancel() {
            explicitBodyCancelled = true;
          },
        }),
      ),
  });
  await safeError(await explicitBody, "PUBLIC_HTML_PROVIDER_ABORTED", 499);
  assert.equal(explicitBodyCancelled, true);
  let deliver,
    lateCancelled = false;
  const late = readPublicHtmlProvider(target, {
    limits: { requestMs: 10 },
    fetcher: () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  });
  await safeError(await late, "PUBLIC_HTML_PROVIDER_TIMEOUT", 504);
  deliver(
    responseAt(
      normalized,
      new ReadableStream({
        cancel() {
          lateCancelled = true;
        },
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lateCancelled, true);
});

const noDatabase = {
  prepare() {
    throw Error("Public provider reads must not access D1");
  },
};
const environment = { CTI_DB: noDatabase, CTI_ADMINS: CTI_OWNER_EMAIL };
function apiRequest(
  body,
  { origin = serviceOrigin, method = "POST", signal } = {},
) {
  return new Request(serviceOrigin + "/api/provider/public-html", {
    method,
    signal,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: "synthetic=" + secret,
      Authorization: "Bearer " + secret,
      "x-cti-user": "spoofed@example.test",
      "x-cti-role": "admin",
      "x-cti-public-origin": "https://spoofed.example.test",
    },
    ...(["GET", "HEAD"].includes(method)
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
function providerApi(authenticate, fetcher, observeDelegation = () => {}) {
  const api = createApiHandler(authenticate);
  return (request, env = environment) =>
    api(request, {
      ...env,
      CTI_EXTRACTOR: {
        fetch: (delegated) => {
          observeDelegation(delegated);
          const user = workspaceRuntimeCaller(delegated);
          return handleAuthorized(
            workspaceRuntimeApiRequest(delegated),
            env.CTI_DB,
            user,
            undefined,
            fetcher,
          );
        },
      },
    });
}

test("owner-only Pages delegation preserves service origin, strips incoming credentials and bypasses D1", async () => {
  const { calls, fetcher } = fixture();
  const delegated = [];
  const api = providerApi(
    async () => ({ email: CTI_OWNER_EMAIL }),
    fetcher,
    (request) =>
      delegated.push({
        url: request.url,
        headers: new Headers(request.headers),
        reconstructedUrl: workspaceRuntimeApiRequest(request.clone()).url,
      }),
  );
  for (const env of [
    { CTI_ADMINS: CTI_OWNER_EMAIL },
    { CTI_EDITORS: CTI_OWNER_EMAIL },
    environment,
  ]) {
    const response = await api(apiRequest({ targetUrl: target }), env);
    assert.equal(response.status, 200);
    const model = await response.json();
    assert.equal(model.requestedUrl, target);
    transport(response, { requests: 1, bytes: bytesOf(html).length });
  }
  assert.equal(calls.length, 3);
  assert.equal(delegated.length, 3);
  for (const request of delegated) {
    assert.equal(
      request.url,
      "https://cti-coursera-extractor.internal/workspace/api/provider/public-html",
    );
    assert.equal(request.headers.get("x-cti-user"), CTI_OWNER_EMAIL);
    assert.equal(
      request.headers.get("x-cti-role") === "admin" ||
        request.headers.get("x-cti-role") === "editor",
      true,
    );
    assert.equal(request.headers.get("x-cti-public-origin"), serviceOrigin);
    assert.equal(request.headers.get("Cookie"), null);
    assert.equal(request.headers.get("Authorization"), null);
    assert.equal(
      request.reconstructedUrl,
      serviceOrigin + "/api/provider/public-html",
    );
  }
  assert(
    calls.every(({ options }) => !JSON.stringify(options).includes(secret)),
  );
});

test("unauthenticated, non-owner, wrong-origin and viewer calls are rejected before delegation or public reads", async () => {
  let calls = 0,
    delegates = 0;
  const fetcher = async () => {
    calls++;
    throw Error("Unexpected public GET");
  };
  const options = [
    {
      authenticate: async () => {
        throw Object.assign(Error("Sign in required"), { status: 401 });
      },
      status: 401,
    },
    {
      authenticate: async () => ({ email: "colleague@example.test" }),
      status: 403,
    },
    {
      authenticate: async () => ({ email: CTI_OWNER_EMAIL }),
      origin: "https://other.example.test",
      status: 403,
    },
    {
      authenticate: async () => ({ email: CTI_OWNER_EMAIL }),
      env: {},
      status: 403,
    },
  ];
  for (const row of options) {
    const api = providerApi(row.authenticate, fetcher, () => {
      delegates++;
    });
    const response = await api(
      apiRequest({ targetUrl: target }, { origin: row.origin }),
      row.env || environment,
    );
    assert.equal(response.status, row.status);
  }
  assert.equal(calls, 0);
  assert.equal(delegates, 0);
  await assert.rejects(
    handleAuthorized(
      apiRequest({ targetUrl: target }),
      noDatabase,
      { email: CTI_OWNER_EMAIL, role: "viewer" },
      undefined,
      fetcher,
    ),
    { status: 403 },
  );
});

test("public HTML API accepts only one exact target field and a bounded JSON POST", async () => {
  const { calls, fetcher } = fixture();
  const api = providerApi(async () => ({ email: CTI_OWNER_EMAIL }), fetcher);
  for (const input of [
    "{invalid",
    "null",
    [],
    {},
    { targetUrl: 42 },
    { targetUrl: target, headers: { Cookie: secret } },
    { targetUrl: target, mediaHosts: ["evil.test"] },
    { targetUrl: target, fetcher: "override" },
    { targetUrl: target, limits: { bodyBytes: 1e9 } },
    { targetUrl: target, serviceOrigin: "https://evil.test" },
    " ".repeat(8193) + JSON.stringify({ targetUrl: target }),
  ]) {
    await safeError(
      await api(apiRequest(input)),
      "PUBLIC_HTML_PROVIDER_INVALID_REQUEST",
      400,
    );
  }
  for (const method of ["GET", "PUT", "DELETE"]) {
    await safeError(
      await api(apiRequest({ targetUrl: target }, { method })),
      "PUBLIC_HTML_PROVIDER_METHOD_NOT_ALLOWED",
      405,
    );
  }
  assert.equal(calls.length, 0);
  const accepted = await api(apiRequest({ targetUrl: target }));
  assert.equal(accepted.status, 200);
  assert.equal(calls.length, 1);
});

test("missing private runtime is distinct from an observed upstream denial", async () => {
  const missing = createApiHandler(async () => ({ email: CTI_OWNER_EMAIL }));
  const unavailable = await missing(apiRequest({ targetUrl: target }), {
    CTI_ADMINS: CTI_OWNER_EMAIL,
  });
  await safeError(unavailable, "PUBLIC_HTML_PROVIDER_RUNTIME_UNAVAILABLE", 503);
  transport(unavailable, { requests: 0, bytes: 0, upstream: 0 });
  const denied = providerApi(
    async () => ({ email: CTI_OWNER_EMAIL }),
    async (url) => responseAt(url, secret, { status: 401 }),
  );
  const response = await denied(apiRequest({ targetUrl: target }));
  await safeError(response, "PUBLIC_HTML_PROVIDER_HTTP_401", 502);
  transport(response, { requests: 1, bytes: 0, upstream: 401 });
});

test("the private public-HTML route cannot be caller-spoofed or reconstructed under an invalid origin", async () => {
  assert.equal(isProviderApiPath("/api/provider/public-html"), true);
  assert.equal(isProviderApiPath("/api/provider/public-html/other"), false);
  let delegated;
  await forwardWorkspaceApi(
    apiRequest({ targetUrl: target }),
    { email: CTI_OWNER_EMAIL, role: "admin" },
    {
      fetch: async (request) => {
        delegated = request;
        return new Response("ok");
      },
    },
  );
  assert.equal(workspaceRuntimeCaller(delegated).email, CTI_OWNER_EMAIL);
  for (const change of [
    { "x-cti-workspace-runtime": null },
    { "x-cti-user": "colleague@example.test" },
    { "x-cti-role": "viewer" },
    { "x-cti-public-origin": "https://user:password@evil.test" },
    { "x-cti-public-origin": serviceOrigin + "/not-an-origin" },
    { Origin: serviceOrigin },
  ]) {
    const headers = new Headers(delegated.headers);
    for (const [name, value] of Object.entries(change)) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
    const invalid = new Request(delegated.url, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.throws(() => workspaceRuntimeCaller(invalid));
    assert.throws(() => workspaceRuntimeApiRequest(invalid));
  }
});
