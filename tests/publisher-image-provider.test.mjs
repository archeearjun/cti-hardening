import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readPublisherImageProvider } from "../server/publisher-image-provider.ts";
import { createApiHandler, handleAuthorized } from "../server/api.ts";
import { CTI_OWNER_EMAIL } from "../server/access.ts";
import {
  isProviderApiPath,
  workspaceRuntimeApiRequest,
  workspaceRuntimeCaller,
} from "../server/workspace-runtime.ts";

const origin = "https://cti-hardening.pages.dev";
const targetUrl = "https://opentextbc.ca/mathfortrades2/?p=125";
const imageUrl =
  "https://pressbooks.bccampus.ca/oerdiscipline/wp-content/uploads/2020/01/Area.png";
const sourceSha256 = "a".repeat(64),
  input = { targetUrl, imageUrl, sourceSha256 };
const png = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 12, 23, 34, 45, 56,
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const secret = "SYNTHETIC_UNTRUSTED_ERROR_BODY";
function upstream(
  body = png,
  { status = 200, headers = {}, url = imageUrl, redirected = false } = {},
) {
  return Object.defineProperties(
    new Response(body, {
      status,
      headers: { "Content-Type": "image/png", ...headers },
    }),
    {
      url: { value: url },
      redirected: { value: redirected },
    },
  );
}
function fixture(reply = () => upstream()) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return reply(url, options);
    },
  };
}
async function error(response, code, status = 502) {
  assert.equal(response.status, status);
  assert.equal(
    response.headers.get("X-CTI-Provider-Transport"),
    "CTI_SERVICE_PUBLIC_IMAGE",
  );
  assert.equal(response.headers.get("X-CTI-Upstream-Sha256"), null);
  const text = await response.text();
  assert(!text.includes(secret));
  assert(text.length < 160);
  assert.deepEqual(JSON.parse(text), { error: code });
}

test("a literal cross-book raster GET retains exact bytes and actual SHA with declared source context", async () => {
  const { calls, fetcher } = fixture(() =>
    upstream(png, {
      headers: {
        "Content-Type": "Image/PNG; synthetic=original",
        "Content-Length": String(png.length),
      },
    }),
  );
  const response = await readPublisherImageProvider(input, { fetcher });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  for (const [key, value] of Object.entries({
    "Content-Type": "Image/PNG; synthetic=original",
    "Content-Encoding": "identity",
    "Content-Length": String(png.length),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-CTI-Provider-Transport": "CTI_SERVICE_PUBLIC_IMAGE",
    "X-CTI-Provider-Origin": origin,
    "X-CTI-Upstream-Status": "200",
    "X-CTI-Upstream-Bytes": String(png.length),
    "X-CTI-Upstream-Content-Length": String(png.length),
    "X-CTI-Upstream-Requests": "1",
    "X-CTI-Upstream-Sha256": hash(png),
    "X-CTI-Publisher-Source-Hash": sourceSha256,
  }))
    assert.equal(response.headers.get(key), value, key);
  assert(
    Number.isFinite(
      Date.parse(response.headers.get("X-CTI-Upstream-Observed-At")),
    ),
  );
  assert.equal(response.headers.get("X-CTI-Validation-Source-Hash"), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, imageUrl);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "manual");
  assert.deepEqual(calls[0].options.headers, {
    Accept: "image/png, image/jpeg, image/gif, image/webp",
    "Accept-Encoding": "identity",
  });
});

test("the server refuses normalized authorities, nonliteral images and caller-supplied request controls before fetching", async () => {
  const { calls, fetcher } = fixture();
  const images = [
    imageUrl + "?",
    imageUrl + "#",
    imageUrl + "?download=1",
    imageUrl + "#x",
    imageUrl.replace("https:", "http:"),
    imageUrl.replace(".ca/", ".ca:443/"),
    imageUrl.replace(".ca/", ".ca:0443/"),
    imageUrl.replace(".ca/", ".ca:/"),
    imageUrl.replace(".ca/", ".ca:8443/"),
    imageUrl.replace("https://", "https://user@"),
    imageUrl.replace("pressbooks.bccampus.ca", "foreign.invalid"),
    imageUrl.replace("Area.png", "%41rea.png"),
    imageUrl.replace("Area.png", "../Area.png"),
    imageUrl.replace("Area.png", "Area.svg"),
    imageUrl.replace("uploads/", "uploads\\"),
    "/oerdiscipline/wp-content/uploads/Area.png",
    imageUrl.replace("https:", ""),
    imageUrl.replace("https://pressbooks", "https://PRESSBOOKS"),
  ];
  const invalid = images.map((imageUrl) => ({ ...input, imageUrl }));
  invalid.push(
    ...[":443", ":0443", ":000443", ":", ":8443"].map((port) => ({
      ...input,
      targetUrl: targetUrl.replace(".ca/", ".ca" + port + "/"),
    })),
  );
  invalid.push(
    { ...input, targetUrl: targetUrl + "&other=1" },
    { ...input, targetUrl: imageUrl },
    { ...input, sourceSha256: "A".repeat(64) },
    { ...input, sourceSha256: "a".repeat(63) },
    { ...input, headers: { Cookie: secret } },
    { ...input, sourceHash: sourceSha256 },
  );
  for (const request of invalid)
    await error(
      await readPublisherImageProvider(request, { fetcher }),
      "PUBLISHER_IMAGE_PROVIDER_INVALID_REQUEST",
      400,
    );
  assert.equal(calls.length, 0);
});

test("no redirects, challenges, authentication failures, partial ranges or unvalidated raster MIME become media", async () => {
  const cases = [
    ...[301, 302, 303, 307, 308].map((status) => [
      {
        status,
        headers: { Location: "https://never-follow.invalid/image.png" },
      },
      "REDIRECT",
    ]),
    [{ redirected: true }, "REDIRECT"],
    [{ url: imageUrl + "other" }, "REDIRECT"],
    [{ status: 403, headers: { "cf-mitigated": "challenge" } }, "CHALLENGE"],
    [{ status: 401 }, "HTTP_401"],
    [{ status: 404 }, "HTTP_404"],
    [{ status: 206 }, "HTTP_206"],
    [{ headers: { "Content-Range": "" } }, "HTTP_200"],
    [{ headers: { "Content-Type": "text/html" } }, "MIME"],
    [{ headers: { "Content-Type": "image/svg+xml" } }, "MIME"],
    [{ headers: { "Content-Type": "image/jpeg" } }, "SIGNATURE"],
    [{ headers: { "Content-Encoding": "gzip" } }, "ENCODING"],
  ];
  for (const [options, code] of cases) {
    const { calls, fetcher } = fixture(() =>
      upstream(code === "MIME" ? secret : png, options),
    );
    const response = await readPublisherImageProvider(input, { fetcher });
    assert.equal(
      response.headers.get("X-CTI-Upstream-Status"),
      String(options.status || 200),
    );
    await error(response, "PUBLISHER_IMAGE_PROVIDER_" + code);
    assert.equal(calls.length, 1);
  }
  const response = await readPublisherImageProvider(input, {
    fetcher: async () => {
      throw Error(secret);
    },
  });
  assert.equal(response.headers.get("X-CTI-Upstream-Status"), "0");
  assert.equal(response.headers.get("X-CTI-Upstream-Observed-At"), "");
  await error(response, "PUBLISHER_IMAGE_PROVIDER_REQUEST_FAILED");
});

test("complete bounded EOF is required and observed failure bytes remain charged", async () => {
  for (const length of [
    "0",
    "-1",
    "01",
    "NaN",
    "9007199254740992",
    String(png.length - 1),
    String(png.length + 1),
    "16777217",
  ]) {
    const response = await readPublisherImageProvider(input, {
      fetcher: async () =>
        upstream(png, { headers: { "Content-Length": length } }),
    });
    await error(response, "PUBLISHER_IMAGE_PROVIDER_BODY_LIMIT_OR_LENGTH");
    if ([String(png.length - 1), String(png.length + 1)].includes(length))
      assert.equal(
        response.headers.get("X-CTI-Upstream-Bytes"),
        String(png.length),
      );
  }
  await error(
    await readPublisherImageProvider(input, {
      fetcher: async () => upstream(new Uint8Array()),
    }),
    "PUBLISHER_IMAGE_PROVIDER_BODY_LIMIT_OR_LENGTH",
  );
  for (const n of [16 * 1024 * 1024, 16 * 1024 * 1024 + 1]) {
    const bytes = new Uint8Array(n);
    bytes.set(png);
    const response = await readPublisherImageProvider(input, {
      fetcher: async () => upstream(bytes),
    });
    if (n === 16 * 1024 * 1024) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-CTI-Upstream-Sha256"), hash(bytes));
      assert.equal((await response.arrayBuffer()).byteLength, n);
    } else {
      assert.equal(response.headers.get("X-CTI-Upstream-Bytes"), String(n));
      await error(response, "PUBLISHER_IMAGE_PROVIDER_BODY_LIMIT_OR_LENGTH");
    }
  }
});

test("chunked framing and split signatures are valid; empty/chunk floods are bounded", async () => {
  function chunks(parts) {
    return new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(p);
        c.close();
      },
    });
  }
  const response = await readPublisherImageProvider(input, {
    fetcher: async () =>
      upstream(chunks([...png].map((n) => Uint8Array.of(n)))),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  for (const [parts, code] of [
    [Array.from({ length: 9 }, () => new Uint8Array()), "INVALID_STREAM"],
    [Array.from({ length: 8193 }, () => Uint8Array.of(1)), "BODY_CHUNK_LIMIT"],
  ])
    await error(
      await readPublisherImageProvider(input, {
        fetcher: async () => upstream(chunks(parts)),
      }),
      "PUBLISHER_IMAGE_PROVIDER_" + code,
    );
});

test("one deadline covers hung fetch/body and cancellation, including ignored abort and late replies", async () => {
  const timed = await readPublisherImageProvider(input, {
    fetcher: () => new Promise(() => {}),
    limits: { requestMs: 5 },
  });
  assert.equal(timed.headers.get("X-CTI-Upstream-Status"), "0");
  await error(timed, "PUBLISHER_IMAGE_PROVIDER_TIMEOUT", 504);
  let cancelled = false;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(png.subarray(0, 5));
    },
    cancel() {
      cancelled = true;
    },
  });
  const stalled = await readPublisherImageProvider(input, {
    fetcher: async () => upstream(body),
    limits: { requestMs: 5 },
  });
  assert.equal(stalled.headers.get("X-CTI-Upstream-Bytes"), "5");
  await error(stalled, "PUBLISHER_IMAGE_PROVIDER_TIMEOUT", 504);
  assert(cancelled);
  let resolveLate,
    lateCancelled = false;
  const pending = readPublisherImageProvider(input, {
    fetcher: () =>
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
    limits: { requestMs: 5 },
  });
  await error(await pending, "PUBLISHER_IMAGE_PROVIDER_TIMEOUT", 504);
  resolveLate(
    upstream(
      new ReadableStream({
        cancel() {
          lateCancelled = true;
        },
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(lateCancelled);
  const controller = new AbortController();
  controller.abort();
  const { calls, fetcher } = fixture();
  await error(
    await readPublisherImageProvider(input, {
      fetcher,
      signal: controller.signal,
    }),
    "PUBLISHER_IMAGE_PROVIDER_ABORTED",
    499,
  );
  assert.equal(calls.length, 0);
});

const noDatabase = {
  prepare() {
    throw Error("Publisher images must not touch D1");
  },
};
function request(
  body = input,
  { method = "POST", requestOrigin = origin } = {},
) {
  return new Request(origin + "/api/provider/publisher-image", {
    method,
    headers: {
      Origin: requestOrigin,
      Cookie: secret,
      Authorization: secret,
      "Content-Type": "application/json",
      "x-cti-public-origin": "https://forged.invalid",
    },
    ...(["GET", "HEAD"].includes(method)
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
function apiWith(
  fetcher,
  authenticate = async () => ({ email: CTI_OWNER_EMAIL }),
) {
  const delegated = [],
    api = createApiHandler(authenticate, () => {
      throw Error("Pages cannot read source bytes");
    });
  const env = {
    CTI_ADMINS: CTI_OWNER_EMAIL,
    CTI_DB: noDatabase,
    CTI_EXTRACTOR: {
      fetch: async (req) => {
        delegated.push({ url: req.url, headers: new Headers(req.headers) });
        const user = workspaceRuntimeCaller(req);
        return handleAuthorized(
          workspaceRuntimeApiRequest(req),
          noDatabase,
          user,
          undefined,
          fetcher,
        );
      },
    },
  };
  return {
    delegated,
    env,
    read: (req = request(), changes = {}) => api(req, { ...env, ...changes }),
  };
}
test("owner/editor Pages delegation preserves exact proof origin and strips caller credentials without D1", async () => {
  const { calls, fetcher } = fixture(),
    { read, delegated } = apiWith(fetcher);
  const response = await read(undefined, {
    CTI_ADMINS: "",
    CTI_EDITORS: CTI_OWNER_EMAIL,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  assert.equal(delegated.length, 1);
  const req = delegated[0];
  assert.equal(
    req.url,
    "https://cti-coursera-extractor.internal/workspace/api/provider/publisher-image",
  );
  assert.equal(req.headers.get("Cookie"), null);
  assert.equal(req.headers.get("Authorization"), null);
  assert.equal(req.headers.get("x-cti-public-origin"), origin);
  assert.equal(response.headers.get("X-CTI-Provider-Origin"), origin);
  assert.equal(calls.length, 1);
  assert(!JSON.stringify(calls[0].options.headers).includes(secret));
});
test("Access, owner role, origin, exact route and closed body all precede a public GET", async () => {
  const { calls, fetcher } = fixture();
  const { read, delegated } = apiWith(fetcher);
  for (const req of [
    request(input, { requestOrigin: "https://other.invalid" }),
    request(input, { method: "GET" }),
  ])
    assert([403, 405].includes((await read(req)).status));
  assert.equal((await read(request(), { CTI_ADMINS: "" })).status, 403);
  assert.equal(delegated.length, 0);
  for (const body of [
    "not-json",
    "[1]",
    JSON.stringify({ ...input, headers: { Cookie: secret } }),
    " ".repeat(16385),
    '{"targetUrl":"x"}',
  ])
    await error(
      await read(request(body)),
      "PUBLISHER_IMAGE_PROVIDER_INVALID_REQUEST",
      400,
    );
  await error(
    await read(request(), { CTI_EXTRACTOR: undefined }),
    "PUBLISHER_IMAGE_PROVIDER_RUNTIME_UNAVAILABLE",
    503,
  );
  assert.equal(
    (
      await apiWith(fetcher, async () => ({
        email: "other@example.test",
      })).read()
    ).status,
    403,
  );
  assert.equal(
    (
      await apiWith(fetcher, async () => {
        throw Object.assign(Error("Sign in"), { status: 401 });
      }).read()
    ).status,
    401,
  );
  assert.equal(calls.length, 0);
  assert(isProviderApiPath("/api/provider/publisher-image"));
  for (const path of [
    "/api/provider/publisher-image/",
    "/api/provider/publisher-image/extra",
    "/api/provider/publisher-images",
  ])
    assert.equal(isProviderApiPath(path), false);
});
