import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readPanoptoProviderMetadata,
  readPanoptoProviderPodcast,
} from "../server/panopto-provider.ts";
import {
  directPanoptoSourceV1,
  sanitizeDirectPanoptoModelV1,
} from "../src/extractors/coursera/direct-data-panopto.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";
import { createApiHandler, handleAuthorized } from "../server/api.ts";
import { CTI_OWNER_EMAIL } from "../server/access.ts";

const serviceOrigin = "https://cti-hardening.pages.dev";
const mediaHost = "fixture.cloudfront.net";
const secret = "SYNTHETIC_PRIVATE_UPSTREAM_DETAIL";
const mp4 = Uint8Array.from([
  0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109,
]);
const metadataPath = "/Panopto/Pages/Viewer/DeliveryInfo.aspx";
function fixture() {
  const f = panoptoDeliveryFixture();
  f.targetUrl = f.targetUrl.replace(
    "video.example.test",
    "fixture.hosted.panopto.com",
  );
  f.model.EmbedUrl = f.model.EmbedUrl.replace(
    "video.example.test",
    "fixture.hosted.panopto.com",
  );
  f.model.Delivery.PodcastStreams[0].StreamUrl =
    "https://" +
    mediaHost +
    "/sessions/" +
    f.ids.C +
    "/podcast.mp4?token=" +
    secret +
    "&quality=high";
  f.model.Delivery.SessionName += " café 日本語";
  const clean = sanitizeDirectPanoptoModelV1(f.model, f.targetUrl).data;
  const sourceHash = createHash("sha256")
    .update(
      directCanonicalSourceTextV1(directPanoptoSourceV1(f.targetUrl, clean)),
    )
    .digest("hex");
  return {
    ...f,
    raw: " \n" + JSON.stringify(f.model) + "\n",
    sourceHash,
    request: { targetUrl: f.targetUrl, streamFileId: f.ids.D, sourceHash },
  };
}
function responseAt(url, body, options = {}) {
  return Object.defineProperty(new Response(body, options), "url", {
    value: String(url),
  });
}
function metadataResponse(url, f, options = {}) {
  return responseAt(url, f.raw, {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...options,
  });
}
function bodyResponse(url, body = mp4, headers = {}) {
  return responseAt(url, body, {
    headers: { "content-type": "video/mp4", ...(body instanceof Uint8Array ? { "content-length": String(body.length) } : {}), ...headers },
  });
}
function optionsFor(f, changes = {}) {
  const calls = [];
  return {
    calls,
    options: {
      mediaHosts: [mediaHost],
      fetcher: async (url, options) => {
        // Workers accepts follow/manual, and this reader must never follow.
        assert.equal(options.redirect, "manual");
        calls.push({ url: String(url), options });
        return new URL(url).pathname === metadataPath
          ? metadataResponse(url, f)
          : bodyResponse(url, mp4, { "content-length": String(mp4.length) });
      },
      ...changes,
    },
  };
}
function assertHeaders(
  response,
  {
    requests,
    bytes,
    validationBytes,
    status = 200,
    origin = serviceOrigin,
  } = {},
) {
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(
    response.headers.get("X-CTI-Provider-Transport"),
    "CTI_PUBLIC_BACKEND",
  );
  assert.equal(response.headers.get("X-CTI-Provider-Origin"), origin);
  assert(
    Number.isFinite(
      Date.parse(response.headers.get("X-CTI-Upstream-Observed-At")),
    ),
  );
  if (status !== undefined)
    assert.equal(response.headers.get("X-CTI-Upstream-Status"), String(status));
  if (requests !== undefined)
    assert.equal(
      response.headers.get("X-CTI-Upstream-Requests"),
      String(requests),
    );
  if (bytes !== undefined)
    assert.equal(response.headers.get("X-CTI-Upstream-Bytes"), String(bytes));
  if (validationBytes !== undefined)
    assert.equal(
      response.headers.get("X-CTI-Validation-Bytes"),
      String(validationBytes),
    );
}
async function assertSafeError(response) {
  assert.equal(response.ok, false);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(
    response.headers.get("X-CTI-Provider-Transport"),
    "CTI_PUBLIC_BACKEND",
  );
  const text = await response.text();
  assert(!text.includes(secret));
  assert(!text.includes("https://"));
  const error = JSON.parse(text);
  assert.match(error.code || error.error, /^[A-Z0-9_]+$/);
}

test("metadata returns exact validated wire JSON and a fixed credential-free POST receipt", async () => {
  const f = fixture(),
    { calls, options } = optionsFor(f);
  const response = await readPanoptoProviderMetadata(f.targetUrl, options);
  assert.equal(response.status, 200);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    Buffer.from(f.raw),
  );
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, "https://fixture.hosted.panopto.com" + metadataPath);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.credentials, "omit");
  assert.equal(call.options.redirect, "manual");
  const headers = new Headers(call.options.headers);
  assert.equal(
    headers.get("content-type"),
    "application/x-www-form-urlencoded;charset=UTF-8",
  );
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("cookie"), null);
  assert.equal(
    String(call.options.body),
    "deliveryId=" +
      f.ids.A +
      "&isLiveNotes=false&refreshAuthCookie=false&isActiveBroadcast=false&isEditing=false&isKollectiveAgentInstalled=false&isEmbed=true&responseType=json",
  );
  assert.equal(Buffer.byteLength(String(call.options.body)), 193);
  assertHeaders(response, {
    requests: 1,
    bytes: Buffer.byteLength(f.raw),
    validationBytes: 0,
  });
});

test("unsafe targets and malformed podcast selectors fail before an upstream request", async () => {
  const f = fixture();
  for (const targetUrl of [
    f.targetUrl.replace("https:", "http:"),
    f.targetUrl.replace("fixture.hosted.panopto.com", "127.0.0.1"),
    f.targetUrl.replace(
      "fixture.hosted.panopto.com",
      "fixture.hosted.panopto.com.attacker.test",
    ),
    f.targetUrl.replace("Embed.aspx", "Edit.aspx"),
    f.targetUrl + "&id=" + f.ids.A,
    f.targetUrl.replace("https://", "https://user:password@"),
    f.targetUrl + "#fragment",
    f.targetUrl.replace(
      "fixture.hosted.panopto.com",
      "fixture.hosted.panopto.com:8443",
    ),
  ]) {
    const { calls, options } = optionsFor(f);
    await assertSafeError(
      await readPanoptoProviderMetadata(targetUrl, options),
    );
    assert.equal(calls.length, 0);
  }
  for (const changes of [
    { streamFileId: "not-a-guid" },
    { sourceHash: "not-a-hash" },
  ]) {
    const { calls, options } = optionsFor(f);
    await assertSafeError(
      await readPanoptoProviderPodcast({ ...f.request, ...changes }, options),
    );
    assert.equal(calls.length, 0);
  }
});

test("metadata HTTP, redirect, MIME, native-join and parse failures expose safe codes only", async () => {
  const f = fixture(),
    badJoin = structuredClone(f.model);
  badJoin.SessionId = f.ids.C;
  for (const reply of [
    (url) => responseAt(url, secret, { status: 401 }),
    (url) => responseAt(url, secret, { status: 403 }),
    (url) =>
      responseAt(url, secret, {
        status: 302,
        headers: { Location: "https://other.example.test/" + secret },
      }),
    (url) =>
      Object.defineProperty(metadataResponse(url, f), "redirected", {
        value: true,
      }),
    (url) =>
      responseAt(url, "<html>" + secret + "</html>", {
        headers: { "content-type": "text/html" },
      }),
    (url) =>
      responseAt(url, "{invalid:" + secret, {
        headers: { "content-type": "application/json" },
      }),
    (url) =>
      responseAt(url, JSON.stringify(badJoin), {
        headers: { "content-type": "application/json" },
      }),
    () => {
      throw Error(secret);
    },
  ]) {
    let calls = 0;
    const response = await readPanoptoProviderMetadata(f.targetUrl, {
      fetcher: async (url) => {
        calls++;
        return reply(url);
      },
    });
    await assertSafeError(response);
    assert.equal(calls, 1);
  }
});

test("metadata byte bounds reject declared and streamed overflow while cancelling its body", async () => {
  const f = fixture();
  for (const declared of [false, true]) {
    let cancelled = 0;
    const response = await readPanoptoProviderMetadata(f.targetUrl, {
      limits: { metadataBytes: 64 },
      fetcher: async (url) =>
        responseAt(
          url,
          new ReadableStream({
            start(controller) {
              if (!declared) {
                controller.enqueue(new Uint8Array(40));
                controller.enqueue(new Uint8Array(40));
              }
            },
            cancel() {
              cancelled++;
            },
          }),
          {
            headers: {
              "content-type": "application/json",
              ...(declared ? { "content-length": "100" } : {}),
            },
          },
        ),
    });
    await assertSafeError(response);
    assert.equal(cancelled, 1);
  }
});

test("manual metadata and podcast redirects are rejected without requesting their destinations", async () => {
  const f = fixture();
  for (const [kind, redirectStatus] of [["metadata", 302], ["podcast", 307]]) {
    const calls = [];
    let cancelled = 0;
    const options = {
      mediaHosts: [mediaHost],
      fetcher: async (url, init) => {
        assert.equal(init.redirect, "manual");
        calls.push(String(url));
        if (kind === "podcast" && calls.length === 1)
          return metadataResponse(url, f);
        return responseAt(url, new ReadableStream({
          cancel() { cancelled++; },
        }), {
          status: redirectStatus,
          headers: { Location: "https://unapproved.example.test/" + secret },
        });
      },
    };
    const response = kind === "metadata"
      ? await readPanoptoProviderMetadata(f.targetUrl, options)
      : await readPanoptoProviderPodcast(f.request, options);
    assert.equal(response.status, 502);
    assertHeaders(response, {
      requests: kind === "metadata" ? 1 : 2,
      status: redirectStatus,
      bytes: 0,
      validationBytes: kind === "metadata" ? 0 : Buffer.byteLength(f.raw),
    });
    assert.deepEqual(await response.json(), {
      error: "PANOPTO_PROVIDER_HTTP_" + redirectStatus,
    });
    assert.deepEqual(calls, [
      "https://fixture.hosted.panopto.com" + metadataPath,
      ...(kind === "podcast" ? [f.model.Delivery.PodcastStreams[0].StreamUrl] : []),
    ]);
    assert.equal(cancelled, 1);
    assert(!JSON.stringify([...response.headers]).includes(secret));
  }
});

test("podcast performs fresh metadata validation before its exact signed media GET and streams literal bytes", async () => {
  const f = fixture(),
    { calls, options } = optionsFor(f);
  const response = await readPanoptoProviderPodcast(f.request, options);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), mp4);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[1].url, f.model.Delivery.PodcastStreams[0].StreamUrl);
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[1].options.credentials, "omit");
  assert.equal(calls[1].options.redirect, "manual");
  assert.equal(
    new Headers(calls[1].options.headers).get("authorization"),
    null,
  );
  assert.equal(new Headers(calls[1].options.headers).get("cookie"), null);
  assertHeaders(response, {
    requests: 2,
    bytes: 0,
    validationBytes: Buffer.byteLength(f.raw),
  });
  assert.equal(
    response.headers.get("X-CTI-Validation-Source-Hash"),
    f.sourceHash,
  );
  assert(
    Number.isFinite(
      Date.parse(response.headers.get("X-CTI-Validation-Observed-At")),
    ),
  );
  assert(!JSON.stringify([...response.headers]).includes(secret));
});

test("changed metadata and foreign stream identities cannot authorize a media GET", async () => {
  const f = fixture();
  for (const request of [
    { ...f.request, sourceHash: "0".repeat(64) },
    { ...f.request, streamFileId: f.ids.E },
  ]) {
    const { calls, options } = optionsFor(f);
    await assertSafeError(await readPanoptoProviderPodcast(request, options));
    assert.equal(calls.length, 1);
  }
  const changed = { ...f, model: structuredClone(f.model) };
  changed.model.Delivery.Duration++;
  changed.raw = JSON.stringify(changed.model);
  const { calls, options } = optionsFor(changed);
  await assertSafeError(await readPanoptoProviderPodcast(f.request, options));
  assert.equal(calls.length, 1);
});

test("only exact hosted-tenant or approved CDN media destinations can be requested", async () => {
  for (const location of [
    "https://127.0.0.1/podcast.mp4",
    "http://fixture.cloudfront.net/podcast.mp4",
    "https://fixture.cloudfront.net.attacker.test/podcast.mp4",
    "https://unapproved.example.test/podcast.mp4",
    "https://fixture.cloudfront.net:8443/podcast.mp4",
    "https://user:password@fixture.cloudfront.net/podcast.mp4",
  ]) {
    const f = fixture();
    f.model.Delivery.PodcastStreams[0].StreamUrl = location;
    f.raw = JSON.stringify(f.model);
    const clean = sanitizeDirectPanoptoModelV1(f.model, f.targetUrl).data;
    f.request.sourceHash = createHash("sha256")
      .update(
        directCanonicalSourceTextV1(directPanoptoSourceV1(f.targetUrl, clean)),
      )
      .digest("hex");
    const { calls, options } = optionsFor(f);
    await assertSafeError(await readPanoptoProviderPodcast(f.request, options));
    assert.equal(calls.length, 1);
  }
});

test("podcast rejects MIME, partial responses, short signatures and declared overflow before returning binary", async () => {
  const f = fixture();
  for (const reply of [
    (url) => bodyResponse(url, mp4, { "content-type": "audio/mp4" }),
    (url) => bodyResponse(url, mp4, { "content-range": "bytes 0-11/24" }),
    (url) => bodyResponse(url, mp4.subarray(0, 11)),
    (url) => bodyResponse(url, new Uint8Array(12)),
    (url) => bodyResponse(url, mp4, { "content-length": "100" }),
  ]) {
    const response = await readPanoptoProviderPodcast(f.request, {
      mediaHosts: [mediaHost],
      limits: { podcastBytes: 64 },
      fetcher: async (url) =>
        new URL(url).pathname === metadataPath
          ? metadataResponse(url, f)
          : reply(url),
    });
    await assertSafeError(response);
  }
});

test("podcast requires an unencoded full source length and exposes it separately from streamed bytes", async () => {
  const f = fixture();
  for (const headers of [
    {}, { "content-length": "0" }, { "content-length": "12.0" },
    { "content-length": "-12" }, { "content-length": "9007199254740992" },
    { "content-length": "12", "content-encoding": "gzip" },
  ]) {
    const result = await readPanoptoProviderPodcast(f.request, {
      mediaHosts: [mediaHost], fetcher: async (url, init) => {
        if (new URL(url).pathname === metadataPath) return metadataResponse(url, f);
        assert.equal(new Headers(init.headers).get("Accept-Encoding"), "identity");
        return responseAt(url, mp4, { headers: { "content-type": "video/mp4", ...headers } });
      },
    });
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /^PANOPTO_PROVIDER_PODCAST_(?:LENGTH_UNAVAILABLE|ENCODING)$/);
  }
  const { options } = optionsFor(f);
  const result = await readPanoptoProviderPodcast(f.request, options);
  assert.equal(result.headers.get("X-CTI-Upstream-Content-Length"), String(mp4.length));
  assert.equal(result.headers.get("X-CTI-Upstream-Bytes"), "0");
  assert.equal(result.headers.get("Content-Length"), null);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), mp4);
});

test("a clean short upstream EOF after a valid MP4 prefix errors the returned service stream", async () => {
  const f = fixture();
  const result = await readPanoptoProviderPodcast(f.request, {
    mediaHosts: [mediaHost], fetcher: async url => new URL(url).pathname === metadataPath
      ? metadataResponse(url, f) : bodyResponse(url, mp4, { "content-length": String(mp4.length + 1) }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("X-CTI-Upstream-Content-Length"), String(mp4.length + 1));
  await assert.rejects(result.arrayBuffer(), /PANOPTO_PROVIDER_PODCAST_LENGTH/);
});

test(
  "streamed podcast overflow errors the consumer and cancels the source instead of buffering an oversized body",
  { timeout: 2000 },
  async () => {
    const f = fixture();
    let cancelled = 0;
    const response = await readPanoptoProviderPodcast(f.request, {
      mediaHosts: [mediaHost],
      limits: { podcastBytes: 16 },
      fetcher: async (url) =>
        new URL(url).pathname === metadataPath
          ? metadataResponse(url, f)
          : bodyResponse(
              url,
              new ReadableStream({
                start(controller) {
                  controller.enqueue(mp4);
                  controller.enqueue(mp4);
                },
                cancel() {
                  cancelled++;
                },
              }),
              { "content-length": "16" },
            ),
    });
    assert.equal(response.status, 200);
    await assert.rejects(response.arrayBuffer());
    assert.equal(cancelled, 1);
  },
);

test(
  "a podcast response becomes available before the upstream remainder and consumer cancellation aborts its fetch",
  { timeout: 2000 },
  async () => {
    const f = fixture();
    let reads = 0,
      cancelled = 0,
      signal;
    const response = await readPanoptoProviderPodcast(f.request, {
      mediaHosts: [mediaHost],
      fetcher: async (url, options) => {
        if (new URL(url).pathname === metadataPath)
          return metadataResponse(url, f);
        signal = options.signal;
        return bodyResponse(
          url,
          new ReadableStream({
            pull(controller) {
              if (++reads === 1) controller.enqueue(mp4);
              else return new Promise(() => {});
            },
            cancel() {
              cancelled++;
            },
          }),
          { "content-length": String(mp4.length * 2) },
        );
      },
    });
    assert.equal(response.status, 200);
    await response.body.cancel();
    assert.equal(cancelled, 1);
    assert.equal(signal.aborted, true);
  },
);

test(
  "deadlines and external cancellation bound metadata work without exposing upstream exceptions",
  { timeout: 2000 },
  async () => {
    const f = fixture();
    for (const stop of [false, true]) {
      const controller = new AbortController();
      let began;
      const started = new Promise((resolve) => {
        began = resolve;
      });
      const pending = readPanoptoProviderMetadata(f.targetUrl, {
        signal: controller.signal,
        limits: { requestMs: 20 },
        fetcher: (url, options) => {
          began();
          return new Promise(() => {});
        },
      });
      await started;
      if (stop) controller.abort();
      await assertSafeError(await pending);
    }
  },
);

test(
  "podcast streaming deadlines and external abort cancel the source after headers without returning partial success",
  { timeout: 2000 },
  async () => {
    const f = fixture();
    for (const stop of [false, true]) {
      const external = new AbortController();
      let cancelled = 0,
        signal;
      const response = await readPanoptoProviderPodcast(f.request, {
        signal: external.signal,
        mediaHosts: [mediaHost],
        limits: { requestMs: 30 },
        fetcher: async (url, options) => {
          if (new URL(url).pathname === metadataPath)
            return metadataResponse(url, f);
          signal = options.signal;
          let sent = false;
          return bodyResponse(
            url,
            new ReadableStream({
              pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(mp4);
                } else return new Promise(() => {});
              },
              cancel() {
                cancelled++;
              },
            }),
            { "content-length": String(mp4.length * 2) },
          );
        },
      });
      assert.equal(response.status, 200);
      const consuming = response.arrayBuffer();
      if (stop) external.abort();
      await assert.rejects(consuming, (error) =>
        /^PANOPTO_PROVIDER_(?:TIMEOUT|ABORTED)$/.test(error.message),
      );
      assert.equal(cancelled, 1);
      assert.equal(signal.aborted, true);
    }
  },
);

const apiRequest = (
  path,
  body,
  { origin = serviceOrigin, method = "POST" } = {},
) =>
  new Request(serviceOrigin + "/api/provider/panopto/" + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: "synthetic=" + secret,
      Authorization: "Bearer " + secret,
    },
    ...(method === "GET"
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const noDatabase = {
  prepare() {
    throw Error("Provider requests must not read workspace records.");
  },
};
const apiEnvironment = { CTI_DB: noDatabase, CTI_ADMINS: CTI_OWNER_EMAIL };

test("API rejects unauthenticated, non-owner, cross-origin and viewer requests before provider access", async () => {
  const f = fixture();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error("Unexpected provider access");
  };
  const unsigned = createApiHandler(async () => {
    throw Object.assign(Error("Sign in required."), { status: 401 });
  }, fetcher);
  assert.equal(
    (
      await unsigned(
        apiRequest("metadata", { targetUrl: f.targetUrl }),
        apiEnvironment,
      )
    ).status,
    401,
  );
  const colleague = createApiHandler(
    async () => ({ email: "synthetic-colleague@example.test" }),
    fetcher,
  );
  assert.equal(
    (
      await colleague(
        apiRequest("metadata", { targetUrl: f.targetUrl }),
        apiEnvironment,
      )
    ).status,
    403,
  );
  const owner = createApiHandler(
    async () => ({ email: CTI_OWNER_EMAIL }),
    fetcher,
  );
  assert.equal(
    (
      await owner(
        apiRequest(
          "metadata",
          { targetUrl: f.targetUrl },
          { origin: "https://other.example.test" },
        ),
        apiEnvironment,
      )
    ).status,
    403,
  );
  await assert.rejects(
    handleAuthorized(
      apiRequest("metadata", { targetUrl: f.targetUrl }),
      noDatabase,
      { email: "synthetic-viewer@example.test", role: "viewer" },
      undefined,
      fetcher,
    ),
    { status: 403 },
  );
  assert.equal(calls, 0);
});

test("API accepts only exact data fields and cannot expose fetch, host, header or limit overrides", async () => {
  const f = fixture(),
    { calls, options } = optionsFor(f);
  const api = createApiHandler(
    async () => ({ email: CTI_OWNER_EMAIL }),
    options.fetcher,
  );
  for (const [path, input] of [
    ["metadata", "{invalid"],
    ["metadata", []],
    ["metadata", {}],
    [
      "metadata",
      { targetUrl: f.targetUrl, url: "https://unapproved.example.test/" },
    ],
    [
      "metadata",
      { targetUrl: f.targetUrl, mediaHosts: ["unapproved.example.test"] },
    ],
    ["metadata", { targetUrl: f.targetUrl, headers: { Cookie: secret } }],
    ["metadata", { targetUrl: f.targetUrl, limits: { metadataBytes: 1e12 } }],
    ["podcast", { targetUrl: f.targetUrl, streamFileId: f.ids.D }],
    [
      "podcast",
      { ...f.request, serviceOrigin: "https://unapproved.example.test" },
    ],
  ]) {
    const response = await api(apiRequest(path, input), apiEnvironment);
    assert.equal(response.status, 400);
    await assertSafeError(response);
  }
  const wrongMethod = await api(
    apiRequest("metadata", undefined, { method: "GET" }),
    apiEnvironment,
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(calls.length, 0);
  const accepted = await api(
    apiRequest("metadata", { targetUrl: f.targetUrl }),
    apiEnvironment,
  );
  assert.equal(accepted.status, 200);
  assert.equal(await accepted.text(), f.raw);
  assertHeaders(accepted, {
    requests: 1,
    bytes: Buffer.byteLength(f.raw),
    validationBytes: 0,
  });
  assert.equal(calls.length, 1);
  assert(!JSON.stringify(calls[0].options).includes(secret));
});

test("CTI authorization failure remains distinct from an upstream Panopto HTTP 401", async () => {
  const f = fixture();
  const deniedApi = createApiHandler(
    async () => {
      throw Object.assign(Error("Sign in required."), { status: 401 });
    },
    async () => {
      throw Error("Unexpected fetch");
    },
  );
  const denied = await deniedApi(
    apiRequest("metadata", { targetUrl: f.targetUrl }),
    apiEnvironment,
  );
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("X-CTI-Provider-Transport"), null);
  const upstreamApi = createApiHandler(
    async () => ({ email: CTI_OWNER_EMAIL }),
    async (url) => responseAt(url, secret, { status: 401 }),
  );
  const upstream = await upstreamApi(
    apiRequest("metadata", { targetUrl: f.targetUrl }),
    apiEnvironment,
  );
  assert.equal(upstream.status, 502);
  assert.equal(upstream.headers.get("X-CTI-Upstream-Status"), "401");
  assert.equal(upstream.headers.get("X-CTI-Upstream-Requests"), "1");
  await assertSafeError(upstream);
});

test("owner provider reads work without D1 for admin or editor roles while records still require workspace setup", async () => {
  const f = fixture(),
    { calls, options } = optionsFor(f);
  const api = createApiHandler(
    async () => ({ email: CTI_OWNER_EMAIL }),
    options.fetcher,
  );
  for (const env of [
    { CTI_ADMINS: CTI_OWNER_EMAIL },
    { CTI_EDITORS: CTI_OWNER_EMAIL },
  ]) {
    const before = calls.length;
    const metadata = await api(
      apiRequest("metadata", { targetUrl: f.targetUrl }),
      env,
    );
    assert.equal(metadata.status, 200);
    assert.equal(await metadata.text(), f.raw);
    assertHeaders(metadata, {
      requests: 1,
      bytes: Buffer.byteLength(f.raw),
      validationBytes: 0,
    });
    assert.equal(calls.length, before + 1);
    const records = await api(new Request(serviceOrigin + "/api/records"), env);
    assert.equal(records.status, 503);
    assert.equal(calls.length, before + 1);
  }
});

test("a signed-in owner without an allowed provider role is denied before any upstream request even without D1", async () => {
  const f = fixture();
  let calls = 0;
  const api = createApiHandler(
    async () => ({ email: CTI_OWNER_EMAIL }),
    async () => {
      calls++;
      throw Error("Viewer requests must not reach the provider.");
    },
  );
  for (const env of [
    {},
    { CTI_ADMINS: "synthetic-other@example.test" },
    { CTI_EDITORS: "synthetic-other@example.test" },
  ]) {
    const denied = await api(
      apiRequest("metadata", { targetUrl: f.targetUrl }),
      env,
    );
    assert.equal(denied.status, 403);
  }
  assert.equal(calls, 0);
});
