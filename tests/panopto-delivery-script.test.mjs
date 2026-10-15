import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildPanoptoDeliveryInfoScript } from "../src/domain/panopto-delivery-script.ts";
import { importPanoptoDeliveryInfo } from "../src/domain/panopto-delivery-info.ts";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";

const byteLimit = 512 * 1024;
const privateError = "SYNTHETIC_PRIVATE_RESPONSE_ERROR";
const credential = "SYNTHETIC_PRIVATE_CREDENTIAL";

async function execute({
  route,
  framed = false,
  model,
  responseText,
  status = 200,
  contentType = "application/json; charset=utf-8",
  contentLength,
  redirected = false,
  responseUrl,
  changeRouteAt = "",
  timeout = false,
  chunks,
  failFetch = false,
} = {}) {
  const f = panoptoDeliveryFixture();
  const calls = [],
    downloads = [],
    blobs = [],
    messages = [],
    timers = [];
  const forbidden = { storage: 0, cookies: 0, player: 0, hooks: 0, xhr: 0 };
  const location = new URL(route || f.targetUrl);
  let cancelled = 0;
  const fail = (key) => () => {
    forbidden[key]++;
    throw Error("FORBIDDEN_TEST_BOUNDARY");
  };
  const changeRoute = () => {
    location.href = f.targetUrl.replace(f.ids.A, f.ids.B);
  };
  class DownloadUrl extends URL {
    static createObjectURL(blob) {
      blobs.push(blob);
      return "blob:synthetic-delivery-download";
    }
    static revokeObjectURL() {}
  }
  const document = {
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement(tag) {
      assert.equal(tag, "a", "ONLY_A_LOCAL_DOWNLOAD_ANCHOR_MAY_BE_CREATED");
      return {
        style: {},
        remove() {},
        click() {
          downloads.push(this.download);
        },
      };
    },
    querySelectorAll: fail("player"),
    addEventListener: fail("hooks"),
  };
  Object.defineProperty(document, "cookie", {
    get: fail("cookies"),
    set: fail("cookies"),
  });
  const context = vm.createContext({
    URL: DownloadUrl,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Blob,
    Headers,
    AbortController,
    location,
    document,
    console: Object.fromEntries(
      ["log", "info", "warn", "error"].map((method) => [
        method,
        (...args) => messages.push(args),
      ]),
    ),
    setTimeout(callback, milliseconds) {
      const timer = { callback, milliseconds };
      timers.push(timer);
      if (timeout === true && milliseconds === 20000) queueMicrotask(callback);
      return timer;
    },
    clearTimeout() {},
    XMLHttpRequest: function () {
      fail("xhr")();
    },
    addEventListener: fail("hooks"),
    async fetch(input, options) {
      calls.push({ url: String(input), options });
      if (changeRouteAt === "fetch") changeRoute();
      if (failFetch) throw Error(privateError);
      if (timeout === true)
        return new Promise((resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(Error(privateError)),
            { once: true },
          );
        });
      const data = responseText ?? JSON.stringify(model ?? f.model);
      const encoded = chunks ?? [new TextEncoder().encode(data)];
      let index = 0;
      return {
        status,
        ok: status >= 200 && status < 300,
        url: responseUrl ?? String(input),
        redirected,
        headers: new Headers({
          "content-type": contentType,
          ...(contentLength === undefined
            ? {}
            : { "content-length": String(contentLength) }),
        }),
        body: {
          getReader() {
            return {
              async read() {
                if (changeRouteAt === "read") changeRoute();
                if (timeout === "body") {
                  queueMicrotask(
                    timers.find((timer) => timer.milliseconds === 20000)
                      .callback,
                  );
                  return new Promise(() => {});
                }
                return index < encoded.length
                  ? { done: false, value: encoded[index++] }
                  : { done: true };
              },
              async cancel() {
                cancelled++;
                if (timeout === "body") return new Promise(() => {});
              },
              releaseLock() {},
            };
          },
        },
      };
    },
  });
  context.window = context;
  context.self = context;
  context.top = framed ? {} : context;
  for (const key of ["localStorage", "sessionStorage", "indexedDB"])
    Object.defineProperty(context, key, { get: fail("storage") });
  const initialKeys = new Set(Object.keys(context));
  let returned, rejected;
  try {
    returned = await vm.runInContext(
      buildPanoptoDeliveryInfoScript(f.targetUrl),
      context,
      { timeout: 2000 },
    );
  } catch (error) {
    rejected = { name: error?.name, message: error?.message };
  }
  return {
    f,
    calls,
    downloads,
    blobs,
    messages,
    timers,
    forbidden,
    cancelled,
    returned,
    rejected,
    addedGlobals: Object.keys(context).filter((key) => !initialKeys.has(key)),
  };
}

function assertNoSideEffects(result) {
  for (const [key, count] of Object.entries(result.forbidden))
    assert.equal(count, 0, key);
  assert.deepEqual(result.addedGlobals, []);
}

function assertSafeFailure(result, expectedCalls) {
  assert.equal(result.calls.length, expectedCalls);
  assert.equal(result.downloads.length, 0);
  assert.equal(result.blobs.length, 0);
  assertNoSideEffects(result);
  assert.equal(result.rejected, undefined);
  assert.equal(result.returned?.ok, false);
  assert.equal(result.returned?.notForCourseAudit, true);
  assert(
    !JSON.stringify({
      returned: result.returned,
      rejected: result.rejected,
      messages: result.messages,
    }).includes(privateError),
  );
}

test("the generated reader sends only the exact observed POST and downloads importable native JSON", async () => {
  const result = await execute();
  assert.equal(result.rejected, undefined);
  assert.equal(result.returned?.ok, true);
  assertNoSideEffects(result);
  assert.equal(result.calls.length, 1);
  const { url, options } = result.calls[0];
  assert.equal(
    url,
    "https://video.example.test/Panopto/Pages/Viewer/DeliveryInfo.aspx",
  );
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.redirect, "error");
  const headers = new Headers(options.headers);
  assert.equal(
    headers.get("content-type"),
    "application/x-www-form-urlencoded;charset=UTF-8",
  );
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("cookie"), null);
  const expected =
    "deliveryId=" +
    result.f.ids.A +
    "&isLiveNotes=false&refreshAuthCookie=false&isActiveBroadcast=false&isEditing=false&isKollectiveAgentInstalled=false&isEmbed=true&responseType=json";
  assert.equal(String(options.body), expected);
  assert.equal(new TextEncoder().encode(String(options.body)).length, 193);
  assert.deepEqual(
    [...new URLSearchParams(options.body).keys()],
    [
      "deliveryId",
      "isLiveNotes",
      "refreshAuthCookie",
      "isActiveBroadcast",
      "isEditing",
      "isKollectiveAgentInstalled",
      "isEmbed",
      "responseType",
    ],
  );
  assert.equal(result.downloads.length, 1);
  assert.equal(result.blobs.length, 1);
  const text = await result.blobs[0].text();
  const native = JSON.parse(text);
  assert.equal(native.SessionId, result.f.ids.B);
  assert(
    native.Delivery.Timestamps.every(
      (entry) => entry.SessionID === result.f.ids.C,
    ),
  );
  const imported = await importPanoptoDeliveryInfo(
    text,
    result.f.spec,
    result.f.targetUrl,
  );
  assert.equal(imported.title, result.f.model.Delivery.SessionName);
  assert.equal(imported.navigation.length, 9);
  assert.equal(imported.bodyVerified, false);
  assert.equal(imported.wholePluginVerified, false);
  assert(result.timers.some((timer) => timer.milliseconds === 20000));
});

test("wrong host, route, recording, duplicate identity, HTTP and nested frames make no request", async () => {
  const f = panoptoDeliveryFixture();
  for (const route of [
    f.targetUrl.replace("video.example.test", "other.example.test"),
    f.targetUrl.replace("Embed.aspx", "Edit.aspx"),
    f.targetUrl.replace(f.ids.A, f.ids.B),
    f.targetUrl + "&id=" + f.ids.A,
    f.targetUrl.replace("https:", "http:"),
  ])
    assertSafeFailure(await execute({ route }), 0);
  assertSafeFailure(await execute({ framed: true }), 0);
  const viewer = await execute({
    route: f.targetUrl.replace("Embed.aspx", "Viewer.aspx"),
  });
  assert.equal(viewer.downloads.length, 1);
});

test("route changes during the response prevent saving observations", async () => {
  for (const changeRouteAt of ["fetch", "read"])
    assertSafeFailure(await execute({ changeRouteAt }), 1);
});

test("invalid native identity joins cannot restore credential-named content IDs", async () => {
  for (const mutate of [
    (f) => {
      f.model.Delivery.PublicID = f.ids.B;
    },
    (f) => {
      f.model.SessionId = f.ids.C;
    },
    (f) => {
      f.model.Delivery.Timestamps[0].SessionID = f.ids.B;
    },
    (f) => {
      f.model.Delivery.SessionFileId = "not-a-guid";
    },
  ]) {
    const f = panoptoDeliveryFixture();
    mutate(f);
    assertSafeFailure(await execute({ model: f.model }), 1);
  }
});

test("credential sanitization retains native content IDs, literal labels and ordinary URL selectors", async () => {
  const f = panoptoDeliveryFixture();
  f.model.access_token = credential;
  f.model.Delivery.configuration = JSON.stringify({
    password: credential,
    label: "Synthetic ordinary configuration",
  });
  f.model.Delivery.Streams[0].StreamUrl +=
    "?token=" + credential + "&quality=high";
  const result = await execute({ model: f.model });
  assert.equal(result.downloads.length, 1);
  const text = await result.blobs[0].text();
  assert(!text.includes(credential));
  assert(!JSON.stringify(result.messages).includes(credential));
  const native = JSON.parse(text);
  assert.equal(native.SessionId, f.ids.B);
  assert(
    native.Delivery.Timestamps.every((entry) => entry.SessionID === f.ids.C),
  );
  assert.equal(native.Delivery.SessionName, f.model.Delivery.SessionName);
  assert.equal(
    native.Delivery.Timestamps[0].Caption,
    f.model.Delivery.Timestamps[0].Caption,
  );
  assert.equal(
    new URL(native.Delivery.Streams[0].StreamUrl).searchParams.get("quality"),
    "high",
  );
  assertNoSideEffects(result);
});

test("only successful JSON responses are accepted and raw error content remains private", async () => {
  for (const options of [
    { status: 403, responseText: privateError },
    { status: 201 },
    { redirected: true },
    { responseUrl: "https://other.example.test/private-redirect" },
    {
      contentType: "text/html",
      responseText: "<html>" + privateError + "</html>",
    },
    { responseText: "{invalid:" + privateError },
    { failFetch: true },
  ])
    assertSafeFailure(await execute(options), 1);
});

test("the byte cap counts streamed UTF-8 bytes and cancels overflow without a download", async () => {
  const result = await execute({
    chunks: [new Uint8Array(byteLimit), new Uint8Array(1)],
  });
  assertSafeFailure(result, 1);
  assert(result.cancelled > 0);
  assert.equal(result.returned.code, "METADATA_BODY_UNAVAILABLE_OR_OVERSIZED");
  assertSafeFailure(await execute({ contentLength: byteLimit + 1 }), 1);
});

test(
  "the 20-second timeout aborts the single in-flight POST without exposing its error",
  { timeout: 2000 },
  async () => {
    for (const timeout of [true, "body"]) {
      const result = await execute({ timeout });
      assertSafeFailure(result, 1);
      assert.equal(result.returned.code, "METADATA_READ_TIMEOUT");
      assert.equal(result.calls[0].options.signal.aborted, true);
    }
  },
);
