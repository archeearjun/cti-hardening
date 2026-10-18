import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import {
  directPublisherTargetV1,
  directPublisherSourceValidV1,
  directPublisherObservationValidV1,
  directPublisherEvidenceV1,
  directPublisherChapterV1,
  directPublisherJsonBytesV1,
} from "../src/extractors/coursera/direct-data-publisher.js";

const target = "https://opentextbc.ca/syntheticbook/?p=225/#main";
const endpoint =
  "https://opentextbc.ca/syntheticbook/wp-json/pressbooks/v2/chapters/225";
const binding = { itemId: "nativeItem", providerId: "p".repeat(22) + "@3" };
const secret = "SYNTHETIC_PRIVATE_PUBLISHER_DETAIL";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bytesOf = (value) => new TextEncoder().encode(value);
const hashBytes = (value) => createHash("sha256").update(value).digest("hex");
const sanitize = (data) => ({
  data,
  removedFields: 0,
  redactedUrls: 0,
  limitReached: false,
});
function chapter(extra = {}) {
  return {
    id: 225,
    status: "publish",
    type: "chapter",
    link: "https://opentextbc.ca/syntheticbook/chapter/original-lesson/",
    title: { raw: "Original raw title", rendered: "Original rendered title" },
    content: {
      raw: '[shortcode id="native-original"]',
      rendered: "<h2>Visible rendered lesson</h2><p>café 日本語 ¼</p>",
      protected: false,
    },
    excerpt: { rendered: "" },
    ...extra,
  };
}
const rawJson = "\ufeff \n" + JSON.stringify(chapter(), null, 2) + "\n";
function corsResponse(url, body = rawJson, options = {}) {
  return Object.defineProperties(
    new Response(body, {
      ...options,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...options.headers,
      },
    }),
    {
      type: { value: options.responseType || "cors" },
      url: { value: options.responseUrl || String(url) },
      redirected: { value: options.redirected || false },
    },
  );
}
function fixture(reply = (url) => corsResponse(url), options = {}) {
  const calls = [];
  const reader = createDirectDataReaderV1({
    sanitize,
    ...options,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return reply(url, init, calls.length);
    },
  });
  return { calls, reader };
}
function wrapper(result) {
  assert.equal(result.ok, true, result.reason);
  return { model: result.data, receipt: result.receipt };
}
function failed(result, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  if (reason) assert.equal(result.reason, reason);
  assert(!JSON.stringify(result).includes(secret));
}

test("publisher targets require an exact public-book numeric shortlink and derive only the observed chapter endpoint", () => {
  for (const host of ["opentextbc.ca", "pressbooks.bccampus.ca"]) {
    for (const suffix of ["?p=225", "?p=225/", "?p=225/#main"]) {
      const value = "https://" + host + "/syntheticbook/" + suffix;
      assert.deepEqual(directPublisherTargetV1(value), {
        requestedUrl: value,
        endpointUrl:
          "https://" +
          host +
          "/syntheticbook/wp-json/pressbooks/v2/chapters/225",
        chapterId: 225,
        bookUrl: "https://" + host + "/syntheticbook/",
      });
    }
  }
  for (const value of [
    "http://opentextbc.ca/syntheticbook/?p=225",
    "https://opentextbc.ca.evil.test/syntheticbook/?p=225",
    "https://127.0.0.1/syntheticbook/?p=225",
    "https://user:password@opentextbc.ca/syntheticbook/?p=225",
    "https://opentextbc.ca:8443/syntheticbook/?p=225",
    "https://opentextbc.ca/syntheticbook/chapter/name/?p=225",
    "https://opentextbc.ca/syntheticbook/?p=225&p=226",
    "https://opentextbc.ca/syntheticbook/?p=225&token=" + secret,
    "https://opentextbc.ca/syntheticbook/?p=225#other",
    "https://opentextbc.ca/syntheticbook/?p=0",
    "https://opentextbc.ca/syntheticbook/?p=0225",
    "https://opentextbc.ca/syntheticbook/?p=-225",
    "https://opentextbc.ca/syntheticbook/?p=2.25",
    "https://opentextbc.ca/syntheticbook/?p=1000000000000",
    "https://opentextbc.ca/syntheticbook/?p=225%2F",
    "https://opentextbc.ca/syntheticbook/%2e%2e/?p=225",
    "https://opentextbc.ca/syntheticbook/../other/?p=225",
    "https://opentextbc.ca/syntheticbook/\\?p=225",
    " https://opentextbc.ca/syntheticbook/?p=225",
    "https://opentextbc.ca/syntheticbook/\n?p=225",
    "https://opentextbc.ca/syntheticbook/wp-json/pressbooks/v2/front-matter/225",
    "https://opentextbc.ca/syntheticbook/",
  ])
    assert.equal(directPublisherTargetV1(value), null, value);
});

test("one browser CORS GET retains the exact raw JSON, BOM, source fields, hashes and endpoint receipt", async () => {
  const f = fixture(undefined, {
    sanitize() {
      throw Error(
        "Original publisher JSON is never sanitized into an original",
      );
    },
    providerTransport: {
      request() {
        throw Error("Publisher calls never use CTI's public backend");
      },
    },
  });
  const result = await f.reader.readPublisherPage(target, binding);
  const observation = wrapper(result);
  assert.equal(observation.model.kind, "CTI_BROWSER_PUBLISHER_CHAPTER");
  assert.equal(observation.model.schemaVersion, 1);
  assert.equal(observation.model.statusCoverage, "PARTIAL_PUBLISHER_API_ONLY");
  assert.equal(observation.model.requestedUrl, target);
  assert.equal(observation.model.endpointUrl, endpoint);
  assert.equal(observation.model.rawJson, rawJson);
  assert.equal(observation.model.rawJson.charCodeAt(0), 0xfeff);
  assert.equal(observation.model.bytes, bytesOf(rawJson).length);
  assert.equal(observation.model.sha256, hashBytes(bytesOf(rawJson)));
  assert.notEqual(
    observation.model.sha256,
    hashBytes(bytesOf(JSON.stringify(chapter()))),
  );
  assert.deepEqual(directPublisherChapterV1(rawJson, target), chapter());
  assert.equal(
    directPublisherChapterV1(rawJson, target).content.raw,
    '[shortcode id="native-original"]',
  );
  assert.equal(directPublisherSourceValidV1(result.data, target), true);
  assert.equal(directPublisherObservationValidV1(observation, target), true);
  assert.equal(
    directPublisherEvidenceV1(observation, target, hashBytes),
    observation,
  );
  const receipt = observation.receipt;
  assert.equal(receipt.transport, "BROWSER_PUBLISHER_API");
  assert.equal(receipt.resource, "PublisherChapter");
  assert.equal(receipt.id, target);
  assert.equal(receipt.requestedUrl, target);
  assert.equal(receipt.endpointUrl, endpoint);
  assert.equal(receipt.origin, "https://opentextbc.ca");
  assert.equal(
    receipt.requestPath,
    "/syntheticbook/wp-json/pressbooks/v2/chapters/225",
  );
  assert.deepEqual(receipt.requestQuery, []);
  assert.equal(receipt.method, "GET");
  assert.equal(receipt.bodyFormat, "ORIGINAL_PUBLISHER_JSON");
  assert.equal(receipt.responseType, "cors");
  assert.equal(receipt.credentials, "omit");
  assert.equal(receipt.observedAtBasis, "BROWSER_RESPONSE");
  assert.equal(receipt.observedAt, result.data.observedAt);
  assert.equal(new Date(receipt.receivedAt).toISOString(), receipt.receivedAt);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.bytes, bytesOf(rawJson).length);
  assert.equal(receipt.originalResponseSha256, result.data.sha256);
  assert.deepEqual(receipt.attempts, [
    {
      credentials: "omit",
      observedAt: receipt.observedAt,
      status: 200,
      responseType: "cors",
      bytes: receipt.bytes,
      reason: "",
    },
  ]);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.url, endpoint);
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.mode, "cors");
  assert.equal(call.init.redirect, "error");
  assert.equal(call.init.credentials, "omit");
  assert.equal(call.init.referrerPolicy, "no-referrer");
  assert.equal(call.init.body, undefined);
  assert.deepEqual(
    [...new Headers(call.init.headers)],
    [["accept", "application/json"]],
  );
  assert.equal(f.reader.snapshot().requests, 1);
  assert.equal(f.reader.snapshot().bytes, receipt.bytes);
  assert.equal(f.reader.snapshot().byResource.PublisherChapter, 1);
});

test("invalid item/provider bindings and unsupported target routes make zero network or helper requests", async () => {
  const f = fixture();
  for (const value of [
    "https://evil.test/book/?p=225",
    "https://opentextbc.ca/syntheticbook/chapter/slug/",
    "https://opentextbc.ca/syntheticbook/?p=225&x=1",
  ]) {
    failed(
      await f.reader.readPublisherPage(value, binding),
      "INVALID_PUBLISHER_TARGET",
    );
  }
  for (const bad of [
    null,
    [],
    { url: endpoint },
    { itemId: "../item" },
    { itemId: 42 },
    { providerId: "bad@3" },
    { providerId: "p".repeat(22) + "@0" },
    { providerId: "p".repeat(22) + "@1&x=2" },
  ]) {
    failed(
      await f.reader.readPublisherPage(target, bad),
      "INVALID_PUBLISHER_TARGET",
    );
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.reader.snapshot().requests, 0);
});

test("only an unreadable first fetch or a readable exact 403 permits one credentialed browser retry", async () => {
  for (const first of ["unreadable", "403"]) {
    let cancelled = false;
    let readErrorBody = false;
    const f = fixture((url, _init, count) => {
      if (count !== 1) return corsResponse(url);
      if (first === "unreadable") throw Error(secret);
      return corsResponse(
        url,
        new ReadableStream(
          {
            pull() {
              readErrorBody = true;
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { status: 403 },
      );
    });
    const result = await f.reader.readPublisherPage(target, binding);
    const observation = wrapper(result);
    assert.deepEqual(
      f.calls.map(({ init }) => init.credentials),
      ["omit", "include"],
    );
    assert(f.calls.every(({ url }) => url === endpoint));
    assert.equal(result.receipt.credentials, "include");
    assert.equal(result.receipt.attempts.length, 2);
    assert.deepEqual(
      { ...result.receipt.attempts[0], observedAt: "time" },
      {
        credentials: "omit",
        observedAt: "time",
        status: first === "403" ? 403 : 0,
        responseType: first === "403" ? "cors" : "unreadable",
        bytes: 0,
        reason:
          first === "403"
            ? "PUBLISHER_BROWSER_HTTP_403"
            : "PUBLISHER_BROWSER_BLOCKED_OR_FAILED",
      },
    );
    assert.equal(
      directPublisherEvidenceV1(observation, target, hashBytes),
      observation,
    );
    assert.equal(readErrorBody, false);
    if (first === "403") assert.equal(cancelled, true);
    assert.equal(f.reader.snapshot().requests, 2);
    assert.equal(
      f.reader.snapshot().retries,
      0,
      "The fixed credential attempt is not the native transient retry loop",
    );
    assert.equal(f.reader.snapshot().bytes, bytesOf(rawJson).length);
    assert(!JSON.stringify(result).includes(secret));
  }
});

test("other HTTP statuses, non-CORS responses, redirects and MIME failures never trigger a credential retry", async () => {
  const cases = [
    ...[401, 404, 405, 429, 500, 503].map((status) => [
      (url) => corsResponse(url, secret, { status }),
      "PUBLISHER_BROWSER_HTTP_" + status,
    ]),
    [
      (url) => corsResponse(url, rawJson, { responseType: "basic" }),
      "PUBLISHER_BROWSER_RESPONSE_TYPE",
    ],
    [
      (url) => corsResponse(url, rawJson, { responseType: "opaque" }),
      "PUBLISHER_BROWSER_RESPONSE_TYPE",
    ],
    [
      (url) =>
        corsResponse(url, rawJson, { responseUrl: endpoint + "?different=1" }),
      "PUBLISHER_BROWSER_RESPONSE_URL",
    ],
    [
      (url) => corsResponse(url, rawJson, { redirected: true }),
      "PUBLISHER_BROWSER_RESPONSE_URL",
    ],
    [
      (url) =>
        corsResponse(url, secret, { headers: { "Content-Type": "text/html" } }),
      "PUBLISHER_BROWSER_MIME",
    ],
    [
      (url) =>
        corsResponse(url, rawJson, {
          headers: { "Content-Type": "application/json;charset=latin1" },
        }),
      "PUBLISHER_BROWSER_MIME",
    ],
    [
      (url) =>
        corsResponse(url, rawJson, {
          headers: {
            "Content-Type": "application/json;charset=utf8;charset=utf8",
          },
        }),
      "PUBLISHER_BROWSER_MIME",
    ],
  ];
  for (const [reply, reason] of cases) {
    const f = fixture(reply);
    failed(await f.reader.readPublisherPage(target, binding), reason);
    assert.equal(f.calls.length, 1, reason);
    assert.equal(f.reader.snapshot().stopped, false);
    assert.equal(f.reader.snapshot().authenticationFailed, false);
  }
});

test("two unreadable attempts stop without a backend, slug, frontmatter or third-request fallback", async () => {
  const f = fixture(() => {
    throw Error(secret);
  });
  const result = await f.reader.readPublisherPage(target, binding);
  failed(result, "PUBLISHER_BROWSER_BLOCKED_OR_FAILED");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(
    f.calls.map(({ init }) => init.credentials),
    ["omit", "include"],
  );
  assert(f.calls.every(({ url }) => url === endpoint));
  assert.equal(result.receipt.attempts.length, 2);
  assert.equal(result.receipt.bytes, 0);
  assert.equal(f.reader.snapshot().requests, 2);
  assert.equal(f.reader.snapshot().bytes, 0);
  assert.equal(f.reader.snapshot().stopped, false);
});

test("an unreadable include attempt cannot inherit the first readable 403 status or claim a browser response", async () => {
  const f = fixture((url, _init, count) => {
    if (count === 1) return corsResponse(url, secret, { status: 403 });
    throw Error(secret);
  });
  const result = await f.reader.readPublisherPage(target, binding);
  failed(result, "PUBLISHER_BROWSER_BLOCKED_OR_FAILED");
  assert.equal(f.calls.length, 2);
  assert.equal(result.receipt.status, 0);
  assert.equal(result.receipt.responseType, "unreadable");
  assert.equal(result.receipt.credentials, "include");
  assert.equal(result.receipt.observedAtBasis, "BROWSER_ATTEMPT");
  assert.equal(result.receipt.bytes, 0);
  assert.equal(result.receipt.originalResponseSha256, "");
  assert.equal(result.receipt.receivedAt, "");
  assert.equal(result.receipt.attempts[0].status, 403);
  assert.equal(result.receipt.attempts[1].status, 0);
  assert.equal(result.receipt.attempts[1].bytes, 0);
  assert.equal(f.reader.snapshot().bytes, 0);
});

test("chapter IDs, publication type, canonical book ownership and protected content are validated before retaining JSON", async () => {
  for (const extra of [
    { id: 226 },
    { id: "225" },
    { status: "draft" },
    { type: "front-matter" },
    { link: "https://opentextbc.ca/otherbook/chapter/lesson/" },
    { link: "https://pressbooks.bccampus.ca/syntheticbook/chapter/lesson/" },
    {
      link: "https://user:password@opentextbc.ca/syntheticbook/chapter/lesson/",
    },
    { link: "https://opentextbc.ca/syntheticbook/wp-admin/edit.php" },
    {
      link:
        "https://opentextbc.ca/syntheticbook/chapter/lesson/?token=" + secret,
    },
    { content: { rendered: "protected content", protected: true } },
    { title: { raw: 12 } },
    { content: { rendered: [] } },
  ]) {
    const raw = JSON.stringify(chapter(extra));
    assert.equal(directPublisherChapterV1(raw, target), null);
    const f = fixture((url) => corsResponse(url, raw));
    failed(
      await f.reader.readPublisherPage(target, binding),
      "PUBLISHER_BROWSER_SOURCE_INVALID",
    );
    assert.equal(f.calls.length, 1);
    assert.equal(
      f.reader.snapshot().bytes,
      bytesOf(raw).length,
      "Rejected original bytes remain charged",
    );
  }
  const empty = JSON.stringify(
    chapter({
      content: { raw: "", rendered: "", protected: false },
      excerpt: { rendered: "" },
    }),
  );
  const f = fixture((url) => corsResponse(url, empty));
  const result = await f.reader.readPublisherPage(target, binding);
  assert.equal(wrapper(result).model.rawJson, empty);
  assert.equal(
    directPublisherChapterV1(empty, target).content.rendered,
    "",
    "An authored empty body remains empty",
  );
});

test("malformed JSON and credential-bearing originals remain failed reads without sanitized replacements", async () => {
  const raws = [
    "{invalid",
    "[]",
    "null",
    JSON.stringify(chapter({ password: secret })),
    JSON.stringify(chapter({ nested: { authorization: secret } })),
    JSON.stringify(chapter({ nested: { access_token: secret } })),
    JSON.stringify(
      chapter({
        content: {
          rendered:
            '<a href="https://example.test/file?signature=' +
            secret +
            '">file</a>',
        },
      }),
    ),
    JSON.stringify(
      chapter({ content: { rendered: "Bearer AAAAAAAAAAAAAAAAAAAAAAA" } }),
    ),
    JSON.stringify(chapter()).replace('"id":225', '"__proto__":{},"id":225'),
  ];
  for (const raw of raws) {
    assert.equal(directPublisherChapterV1(raw, target), null);
    const f = fixture((url) => corsResponse(url, raw));
    failed(
      await f.reader.readPublisherPage(target, binding),
      "PUBLISHER_BROWSER_SOURCE_INVALID",
    );
    assert.equal(f.calls.length, 1);
  }
});

test("escaped credential names and values are rejected after JSON parsing, with bounded depth and node traversal", async () => {
  let tooDeep = {};
  for (let depth = 0; depth < 65; depth++) tooDeep = { next: tooDeep };
  const raws = [
    JSON.stringify(chapter({ metadata: { access_token: secret } })).replace(
      "access_token",
      "access_\\u0074oken",
    ),
    JSON.stringify(chapter({ metadata: { _wpnonce: secret } })).replace(
      "_wpnonce",
      "_wpn\\u006fnce",
    ),
    JSON.stringify(
      chapter({
        content: {
          rendered:
            '<a href="https://example.test/file?signature=' +
            secret +
            '">file</a>',
        },
      }),
    ).replace("?signature=", "?\\u0073ignature="),
    JSON.stringify(chapter({ metadata: tooDeep })),
    JSON.stringify(chapter({ metadata: Array(100_001).fill(null) })),
  ];
  for (const raw of raws) {
    assert(bytesOf(raw).length < 1024 * 1024);
    assert.equal(directPublisherChapterV1(raw, target), null);
    const f = fixture((url) => corsResponse(url, raw));
    failed(
      await f.reader.readPublisherPage(target, binding),
      "PUBLISHER_BROWSER_SOURCE_INVALID",
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.reader.snapshot().bytes, bytesOf(raw).length);
  }
});

test("publisher originals require a readable byte stream and do not fall back to unbounded arrayBuffer reads", async () => {
  let fallbackCalled = false;
  const f = fixture((url) => {
    const response = corsResponse(url, null);
    response.arrayBuffer = async () => {
      fallbackCalled = true;
      throw Error(secret);
    };
    return response;
  });
  failed(
    await f.reader.readPublisherPage(target, binding),
    "PUBLISHER_BROWSER_STREAM_UNAVAILABLE",
  );
  assert.equal(fallbackCalled, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reader.snapshot().bytes, 0);
});

test("UTF-8 failures, invalid Unicode and the 1 MiB original-body boundary fail explicitly", async () => {
  const malformed = new Uint8Array([
    ...bytesOf('{"id":225,"content":"'),
    0xc3,
    0x28,
  ]);
  const invalid = fixture((url) => corsResponse(url, malformed));
  failed(
    await invalid.reader.readPublisherPage(target, binding),
    "PUBLISHER_BROWSER_UTF8",
  );
  assert.equal(invalid.reader.snapshot().bytes, malformed.length);
  assert.equal(directPublisherJsonBytesV1("\ud800"), null);
  assert.equal(directPublisherJsonBytesV1(""), null);
  assert.equal(directPublisherJsonBytesV1("x\u0000y"), null);
  const large = JSON.stringify(
    chapter({ content: { rendered: "a".repeat(600_000) } }),
  );
  assert(bytesOf(large).length > 512 * 1024);
  assert(bytesOf(large).length < 1024 * 1024);
  const accepted = fixture((url) => corsResponse(url, large));
  assert.equal(
    wrapper(await accepted.reader.readPublisherPage(target, binding)).model
      .rawJson,
    large,
  );
  const oversize = JSON.stringify(
    chapter({ content: { rendered: "a".repeat(1_048_577) } }),
  );
  assert.equal(directPublisherJsonBytesV1(oversize), null);
  const rejected = fixture((url) => corsResponse(url, oversize));
  failed(
    await rejected.reader.readPublisherPage(target, binding),
    "API_RESPONSE_BYTE_LIMIT",
  );
  assert.equal(rejected.reader.snapshot().bytes, bytesOf(oversize).length);
  assert.equal(rejected.reader.snapshot().stopped, false);
});

test("publisher and native resource reads share the same concurrency queue and observed request accounting", async () => {
  let active = 0,
    maximum = 0;
  const f = fixture(
    async (url) => {
      active++;
      maximum = Math.max(maximum, active);
      await pause(3);
      active--;
      return String(url).startsWith("https://www.coursera.org/")
        ? new Response(
            JSON.stringify({
              elements: [{ id: new URL(url).pathname.split("/").at(-1) }],
            }),
            { headers: { "Content-Type": "application/json" } },
          )
        : corsResponse(url);
    },
    { limits: { concurrentRequests: 2 } },
  );
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0
        ? f.reader.readCourse("course" + i)
        : f.reader.readPublisherPage(target, {
            ...binding,
            itemId: "item" + i,
          }),
    ),
  );
  assert(results.every((result) => result.ok));
  assert.equal(maximum, 2);
  assert.equal(f.reader.snapshot().maxConcurrentRequests, 2);
  assert.equal(f.reader.snapshot().requests, 12);
  assert.equal(f.reader.snapshot().completed, 12);
  assert.equal(f.reader.snapshot().byResource.PublisherChapter, 8);
  assert.equal(f.reader.snapshot().active, 0);
  assert.equal(f.reader.snapshot().queued, 0);
});

test("both credential attempts charge the global request limit and source bytes charge the shared course budget", async () => {
  const requestBound = fixture(
    () => {
      throw Error(secret);
    },
    { limits: { requests: 1, concurrentRequests: 1 } },
  );
  failed(
    await requestBound.reader.readPublisherPage(target, binding),
    "COURSE_API_REQUEST_LIMIT",
  );
  assert.equal(requestBound.calls.length, 1);
  assert.equal(requestBound.reader.snapshot().requests, 1);
  assert.equal(
    requestBound.reader.snapshot().stopReason,
    "COURSE_API_REQUEST_LIMIT",
  );
  const byteBound = fixture(undefined, {
    limits: { totalBytes: bytesOf(rawJson).length - 1, concurrentRequests: 1 },
  });
  failed(
    await byteBound.reader.readPublisherPage(target, binding),
    "COURSE_API_BYTE_LIMIT",
  );
  assert.equal(byteBound.reader.snapshot().bytes, bytesOf(rawJson).length);
  failed(await byteBound.reader.readCourse("later"), "COURSE_API_BYTE_LIMIT");
  assert.equal(byteBound.calls.length, 1);
  const expired = fixture(undefined, { limits: { durationMs: 5 } });
  await pause(10);
  failed(
    await expired.reader.readPublisherPage(target, binding),
    "COURSE_API_TIME_LIMIT",
  );
  assert.equal(expired.calls.length, 0);
});

test("changed source context and operator stop prevent queued or credential-retry work", async () => {
  const changed = fixture(undefined, { assertCurrent: () => false });
  failed(
    await changed.reader.readPublisherPage(target, binding),
    "SOURCE_CONTEXT_CHANGED",
  );
  assert.equal(changed.calls.length, 0);
  let f;
  f = fixture(() => {
    f.reader.abort("OPERATOR_STOPPED");
    throw Error(secret);
  });
  failed(await f.reader.readPublisherPage(target, binding), "OPERATOR_STOPPED");
  assert.equal(
    f.calls.length,
    1,
    "An aborted unreadable fetch cannot advance to include",
  );
});

test("one publisher job deadline covers a hung fetch without starting the credential attempt or stopping native reads", async () => {
  let observedSignal, deliver;
  const f = fixture(
    (url, init) => {
      if (String(url).startsWith("https://www.coursera.org/"))
        return new Response('{"elements":[{"id":"course"}]}', {
          headers: { "Content-Type": "application/json" },
        });
      observedSignal = init.signal;
      return new Promise((resolve) => {
        deliver = resolve;
      });
    },
    { limits: { requestMs: 10, concurrentRequests: 1 } },
  );
  failed(
    await f.reader.readPublisherPage(target, binding),
    "PUBLISHER_BROWSER_TIMEOUT",
  );
  assert.equal(observedSignal.aborted, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reader.snapshot().stopped, false);
  assert.equal((await f.reader.readCourse("course")).ok, true);
  let cancelled = false;
  deliver(
    corsResponse(
      endpoint,
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await pause(0);
  assert.equal(cancelled, true);
});

test("publisher body timeout and operator abort cancel partial streams and drain the shared queue", async () => {
  for (const operator of [false, true]) {
    let started;
    const began = new Promise((resolve) => {
      started = resolve;
    });
    let cancelled = false;
    const f = fixture(
      (url) =>
        corsResponse(
          url,
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytesOf('{"id":'));
              started();
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      { limits: { requestMs: operator ? 1000 : 10, concurrentRequests: 1 } },
    );
    const first = f.reader.readPublisherPage(target, binding);
    const queued = operator
      ? f.reader.readPublisherPage(target, { itemId: "queued" })
      : null;
    await began;
    if (operator) f.reader.abort("OPERATOR_STOPPED");
    failed(
      await first,
      operator ? "OPERATOR_STOPPED" : "PUBLISHER_BROWSER_TIMEOUT",
    );
    if (queued) failed(await queued, "OPERATOR_STOPPED");
    await pause(0);
    assert.equal(cancelled, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.reader.snapshot().active, 0);
    assert.equal(f.reader.snapshot().queued, 0);
  }
});

test("tiny publisher chunks cannot grow an unbounded array, and the refused observed chunk is still charged", async () => {
  let chunks = 0,
    cancelled = false;
  const prefix = bytesOf('{"id":');
  const f = fixture((url) =>
    corsResponse(
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
  failed(
    await f.reader.readPublisherPage(target, binding),
    "PUBLISHER_BROWSER_CHUNK_LIMIT",
  );
  assert.equal(chunks, 8193);
  assert.equal(cancelled, true);
  assert.equal(
    f.reader.snapshot().bytes,
    prefix.length + 8192,
    "All actually observed bytes remain charged on chunk-limit failure",
  );
});

test("retained model, endpoint, native response hashes and credential-attempt receipts fail closed after tampering", async () => {
  const f = fixture((url, _init, count) => {
    if (count === 1) throw Error(secret);
    return corsResponse(url);
  });
  const original = wrapper(await f.reader.readPublisherPage(target, binding));
  const before = structuredClone(original);
  const changes = [
    (o) => {
      o.model.rawJson += " ";
    },
    (o) => {
      o.model.rawJson = o.model.rawJson.replace(
        "Original raw title",
        "Invented raw title",
      );
      o.model.sha256 = hashBytes(bytesOf(o.model.rawJson));
    },
    (o) => {
      o.model.sha256 = "f".repeat(64);
    },
    (o) => {
      o.model.endpointUrl += "?other=1";
    },
    (o) => {
      o.model.requestedUrl = "https://opentextbc.ca/syntheticbook/?p=226";
    },
    (o) => {
      o.model.contentType = "application/json;charset=utf8;charset=latin1";
    },
    (o) => {
      o.model.statusCoverage = "COMPLETE";
    },
    (o) => {
      o.model.bodyVerified = true;
    },
    (o) => {
      o.model.bytes++;
    },
    (o) => {
      o.receipt.origin = "https://other.example";
    },
    (o) => {
      o.receipt.requestPath = "/other/chapters/225";
    },
    (o) => {
      o.receipt.requestQuery = [["p", "225"]];
    },
    (o) => {
      o.receipt.method = "POST";
    },
    (o) => {
      o.receipt.bodyFormat = "PARSED_SANITIZED_JSON_MODEL";
    },
    (o) => {
      o.receipt.transport = "CTI_PUBLIC_BACKEND";
    },
    (o) => {
      o.receipt.responseType = "basic";
    },
    (o) => {
      o.receipt.credentials = "omit";
    },
    (o) => {
      o.receipt.observedAtBasis = "UPSTREAM";
    },
    (o) => {
      o.receipt.observedAt = "2026-10-17T00:00:00.000Z";
    },
    (o) => {
      o.receipt.receivedAt = "not-a-date";
    },
    (o) => {
      o.receipt.receivedAt = new Date(
        Date.parse(o.model.observedAt) - 1,
      ).toISOString();
    },
    (o) => {
      o.receipt.originalResponseSha256 = "0".repeat(64);
    },
    (o) => {
      o.receipt.cookie = secret;
    },
    (o) => {
      o.receipt.attempts[0].status = 401;
    },
    (o) => {
      o.receipt.attempts[0].bytes = 1;
    },
    (o) => {
      o.receipt.attempts[0].credentials = "include";
    },
    (o) => {
      o.receipt.attempts[0].reason = "PUBLISHER_BROWSER_HTTP_401";
    },
    (o) => {
      o.receipt.attempts[0].observedAt = new Date(
        Date.parse(o.receipt.receivedAt) + 1,
      ).toISOString();
    },
    (o) => {
      o.receipt.attempts[1].bytes--;
    },
    (o) => {
      o.receipt.attempts[1].observedAt = "2026-10-17T00:00:00.000Z";
    },
    (o) => {
      o.receipt.attempts.push({ ...o.receipt.attempts[1] });
    },
    (o) => {
      o.receipt.attempts.reverse();
    },
    (o) => {
      o.extraProof = true;
    },
  ];
  for (const change of changes) {
    const bad = structuredClone(original);
    change(bad);
    assert.equal(directPublisherEvidenceV1(bad, target, hashBytes), null);
  }
  assert.equal(directPublisherEvidenceV1(original, target), null);
  assert.equal(
    directPublisherEvidenceV1(original, target, () =>
      Promise.resolve(original.model.sha256),
    ),
    null,
  );
  assert.equal(
    directPublisherEvidenceV1(original, target, () => "0".repeat(64)),
    null,
  );
  assert.deepEqual(
    original,
    before,
    "Validation does not rewrite retained content or receipts",
  );
});
