import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";
import {
  createDirectDataMediaReaderV1,
  decodeDirectAssetBodyV1,
} from "../src/extractors/coursera/direct-data-media.js";
import { panoptoDeliveryFixture as basePanoptoFixture } from "./panopto-delivery-fixtures.mjs";

const endpoint =
  "https://fixture.hosted.panopto.com/Panopto/Pages/Viewer/DeliveryInfo.aspx";
const credential = "SYNTHETIC_PANOPTO_SIGNING_CREDENTIAL";
const privateError = "SYNTHETIC_PRIVATE_CORS_ERROR";
function panoptoDeliveryFixture() {
  const f = basePanoptoFixture();
  f.targetUrl = f.targetUrl.replace(
    "video.example.test",
    "fixture.hosted.panopto.com",
  );
  f.model.EmbedUrl = f.model.EmbedUrl.replace(
    "video.example.test",
    "fixture.hosted.panopto.com",
  );
  f.model.Delivery.PodcastStreams[0].StreamUrl =
    f.model.Delivery.PodcastStreams[0].StreamUrl.replace(
      "media.example.test",
      "fixture.cloudfront.net",
    );
  f.responseText = JSON.stringify(f.model);
  return f;
}
const isPanopto = (url) =>
  new URL(url).pathname === "/Panopto/Pages/Viewer/DeliveryInfo.aspx";
const json = (value, options = {}) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...options,
  });
const nativeReply = (url) =>
  json({
    elements: [
      {
        id: decodeURIComponent(
          new URL(url).pathname.split("/").filter(Boolean).at(-1),
        ),
      },
    ],
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function readerWith(fetchImpl, options = {}) {
  return createDirectDataReaderV1({
    sanitize: sanitizeCourseraCourseDataModel,
    fetchImpl,
    ...options,
  });
}

function assertLocalFailure(result, reader) {
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.equal(result.authenticationFailed, false);
  assert.equal(reader.snapshot().stopped, false);
  assert.equal(reader.snapshot().authenticationFailed, false);
  assert(!JSON.stringify(result).includes(privateError));
  assert(!JSON.stringify(result).includes(credential));
}

test("external metadata uses the fixed credential-free CORS POST and original byte receipt", async () => {
  const f = panoptoDeliveryFixture();
  f.model.access_token = credential;
  f.model.Delivery.configuration = JSON.stringify({
    password: credential,
    label: "Synthetic configuration",
  });
  f.model.Delivery.PodcastStreams[0].StreamUrl +=
    "?token=" + credential + "&quality=high";
  const raw = JSON.stringify(f.model),
    calls = [];
  const reader = readerWith(async (url, options) => {
    calls.push({ url, options });
    return new Response(raw, {
      headers: { "content-type": "application/json" },
    });
  });
  const result = await reader.readPanoptoDeliveryInfo(f.targetUrl);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, endpoint);
  assert.equal(options.method, "POST");
  assert.equal(options.mode, "cors");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  const headers = new Headers(options.headers);
  assert.equal(
    headers.get("content-type"),
    "application/x-www-form-urlencoded;charset=UTF-8",
  );
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("X-Coursera-Naptime-Fields"), null);
  assert.equal(
    String(options.body),
    "deliveryId=" +
      f.ids.A +
      "&isLiveNotes=false&refreshAuthCookie=false&isActiveBroadcast=false&isEditing=false&isKollectiveAgentInstalled=false&isEmbed=true&responseType=json",
  );
  assert.equal(Buffer.byteLength(String(options.body)), 193);
  assert.equal(result.receipt.resource, "PanoptoDeliveryInfo");
  assert.equal(
    result.receipt.requestPath,
    "/Panopto/Pages/Viewer/DeliveryInfo.aspx",
  );
  assert.equal(result.receipt.status, 200);
  assert.equal(result.receipt.bytes, Buffer.byteLength(raw));
  assert.equal(
    result.receipt.originalResponseSha256,
    createHash("sha256").update(raw).digest("hex"),
  );
  assert.equal(result.data.SessionId, f.ids.B);
  assert(
    result.data.Delivery.Timestamps.every(
      (entry) => entry.SessionID === f.ids.C,
    ),
  );
  assert.equal(result.data.Delivery.SessionName, f.model.Delivery.SessionName);
  assert.equal(
    result.data.Delivery.Timestamps[0].Caption,
    f.model.Delivery.Timestamps[0].Caption,
  );
  assert(!JSON.stringify(result).includes(credential));
  assert(result.receipt.credentialFieldsRemoved > 0);
  assert(result.receipt.credentialUrlsRedacted > 0);
  assert.equal(
    Object.getOwnPropertyDescriptor(result, "takePanoptoPodcastLocation")
      .enumerable,
    false,
  );
  assert(!Object.keys(result).includes("takePanoptoPodcastLocation"));
  assert.equal(
    result.takePanoptoPodcastLocation(f.ids.D),
    f.model.Delivery.PodcastStreams[0].StreamUrl,
  );
  assert(!result.takePanoptoPodcastLocation(f.ids.D));
  assert(!result.takePanoptoPodcastLocation(f.ids.E));
  assert.equal(reader.snapshot().requests, 1);
  assert.equal(reader.snapshot().byResource.PanoptoDeliveryInfo, 1);
  assert.equal(reader.snapshot().bytes, Buffer.byteLength(raw));
});

test("unsafe targets make no request and cannot turn the reader into an arbitrary URL fetcher", async () => {
  const f = panoptoDeliveryFixture(),
    calls = [];
  const reader = readerWith(async (url) => {
    calls.push(url);
    return nativeReply(url);
  });
  for (const target of [
    "https://video.example.test/private-endpoint?id=" + f.ids.A,
    f.targetUrl.replace("https:", "http:"),
    f.targetUrl + "&id=" + f.ids.A,
    f.targetUrl.replace(f.ids.A, "not-a-guid"),
    f.targetUrl.replace("https://", "https://user:password@"),
    f.targetUrl + "&access_token=" + credential,
    f.targetUrl + "#fragment",
    "javascript:alert(1)",
  ])
    assert.equal((await reader.readPanoptoDeliveryInfo(target)).ok, false);
  assert.equal(calls.length, 0);
  assert.equal(reader.snapshot().requests, 0);
  assert.equal((await reader.readCourse("course")).ok, true);
});

test("CORS and provider HTTP failures remain local while native authoring reads continue", async () => {
  const f = panoptoDeliveryFixture();
  for (const status of ["CORS", 401, 403, 429, 503]) {
    const reader = readerWith(async (url) => {
      if (!isPanopto(url)) return nativeReply(url);
      if (status === "CORS")
        throw new TypeError(privateError + "?token=" + credential);
      return new Response(privateError, {
        status,
        headers: { "content-type": "application/json", "retry-after": "600" },
      });
    });
    const result = await reader.readPanoptoDeliveryInfo(f.targetUrl);
    assertLocalFailure(result, reader);
    assert.equal((await reader.readCourse("course")).ok, true);
    assert.equal(reader.snapshot().active, 0);
  }
});

test(
  "metadata timeouts release the shared slot without poisoning subsequent native reads",
  { timeout: 2000 },
  async () => {
    const f = panoptoDeliveryFixture();
    for (const bodyStalls of [false, true]) {
      let signal,
        cancelled = 0;
      const reader = readerWith(
        async (url, options) => {
          if (!isPanopto(url)) return nativeReply(url);
          signal = options.signal;
          if (!bodyStalls)
            return new Promise((resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(Error(privateError)),
                { once: true },
              );
            });
          return new Response(
            new ReadableStream({
              cancel() {
                cancelled++;
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
        { limits: { requestMs: 20, concurrentRequests: 1 } },
      );
      const pending = reader.readPanoptoDeliveryInfo(f.targetUrl);
      const next = reader.readCourse("course");
      const result = await pending;
      assertLocalFailure(result, reader);
      assert.equal(signal.aborted, true);
      assert.equal((await next).ok, true);
      if (bodyStalls) assert.equal(cancelled, 1);
      assert.equal(reader.snapshot().active, 0);
    }
  },
);

test("external body and declared-length caps cancel rejected responses and retain charged bytes", async () => {
  const f = panoptoDeliveryFixture();
  for (const advertised of [false, true]) {
    let cancelled = 0;
    const reader = readerWith(
      async (url) => {
        if (!isPanopto(url)) return nativeReply(url);
        return new Response(
          new ReadableStream({
            start(controller) {
              if (!advertised) {
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
              ...(advertised ? { "content-length": "1000" } : {}),
            },
          },
        );
      },
      { limits: { bodyBytes: 64 } },
    );
    const result = await reader.readPanoptoDeliveryInfo(f.targetUrl);
    assertLocalFailure(result, reader);
    assert.equal(cancelled, 1);
    assert.equal(result.receipt.bytes, advertised ? 0 : 80);
    assert.equal(reader.snapshot().bytes, advertised ? 0 : 80);
    assert.equal((await reader.readCourse("course")).ok, true);
  }
  let cancelled = 0;
  const hardLimit = readerWith(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(512 * 1024 + 1));
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const rejected = await hardLimit.readPanoptoDeliveryInfo(f.targetUrl);
  assertLocalFailure(rejected, hardLimit);
  assert.equal(cancelled, 1);
});

test("wrong joins, MIME, redirects and malformed JSON retain no successful body or location", async () => {
  const f = panoptoDeliveryFixture();
  const mismatched = structuredClone(f.model);
  mismatched.Delivery.Timestamps[0].SessionID = f.ids.B;
  for (const response of [
    () => json(mismatched),
    () =>
      new Response("<html>" + privateError + "</html>", {
        headers: { "content-type": "text/html" },
      }),
    () =>
      new Response("{invalid:" + privateError, {
        headers: { "content-type": "application/json" },
      }),
    () => Object.defineProperty(json(f.model), "redirected", { value: true }),
  ]) {
    const reader = readerWith(async (url) =>
      isPanopto(url) ? response() : nativeReply(url),
    );
    const result = await reader.readPanoptoDeliveryInfo(f.targetUrl);
    assertLocalFailure(result, reader);
    assert.equal(result.takePanoptoPodcastLocation, undefined);
    assert.equal((await reader.readCourse("course")).ok, true);
  }
});

test(
  "Panopto and native requests share the same bounded scheduler slots",
  { timeout: 2000 },
  async () => {
    const f = panoptoDeliveryFixture();
    for (const concurrentRequests of [1, 2]) {
      const gate = deferred(),
        started = deferred(),
        updates = [];
      let active = 0,
        maximum = 0;
      const reader = readerWith(
        async (url) => {
          active++;
          maximum = Math.max(maximum, active);
          if (active === concurrentRequests) started.resolve();
          await gate.promise;
          active--;
          return isPanopto(url) ? json(f.model) : nativeReply(url);
        },
        {
          limits: { concurrentRequests },
          onStats: (stats) => updates.push(stats),
        },
      );
      const pending = Array.from({ length: 8 }, (_, i) =>
        i % 2
          ? reader.readCourse("course" + i)
          : reader.readPanoptoDeliveryInfo(f.targetUrl),
      );
      await started.promise;
      assert.equal(reader.snapshot().active, concurrentRequests);
      assert.equal(reader.snapshot().queued, 8 - concurrentRequests);
      gate.resolve();
      const results = await Promise.all(pending);
      assert(results.every((result) => result.ok));
      assert.equal(maximum, concurrentRequests);
      assert.equal(reader.snapshot().maxConcurrentRequests, concurrentRequests);
      assert(updates.every((stats) => stats.active <= concurrentRequests));
      assert.equal(reader.snapshot().byResource.PanoptoDeliveryInfo, 4);
      assert.equal(reader.snapshot().byResource["authoringCourses.v2"], 4);
      assert.equal(reader.snapshot().completed, 8);
      assert.equal(reader.snapshot().active, 0);
    }
  },
);

test("metadata consumes the same cumulative request and byte budgets as native reads", async () => {
  const f = panoptoDeliveryFixture();
  const count = readerWith(
    async (url) => (isPanopto(url) ? json(f.model) : nativeReply(url)),
    { limits: { requests: 1 } },
  );
  assert.equal((await count.readPanoptoDeliveryInfo(f.targetUrl)).ok, true);
  assert.equal(
    (await count.readCourse("course")).reason,
    "COURSE_API_REQUEST_LIMIT",
  );
  assert.equal(count.snapshot().requests, 1);
  const bytes = readerWith(
    async (url) => (isPanopto(url) ? json(f.model) : nativeReply(url)),
    { limits: { totalBytes: 64 } },
  );
  assert.equal((await bytes.readPanoptoDeliveryInfo(f.targetUrl)).ok, false);
  assert.equal(bytes.snapshot().stopReason, "COURSE_API_BYTE_LIMIT");
  assert(bytes.snapshot().bytes > 64);
  assert.equal(
    (await bytes.readCourse("course")).reason,
    "COURSE_API_BYTE_LIMIT",
  );
});

test("transient podcast locations cannot be taken after the bound source context changes", async () => {
  const f = panoptoDeliveryFixture();
  let current = true;
  const reader = readerWith(async () => json(f.model), {
    assertCurrent: () => current,
  });
  const result = await reader.readPanoptoDeliveryInfo(f.targetUrl);
  assert.equal(result.ok, true);
  current = false;
  assert(!result.takePanoptoPodcastLocation(f.ids.D));
});

const mp4 = Uint8Array.from([
  0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109,
]);
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const assetId = "A".repeat(22);

function mixedMetadataReader(f) {
  return readerWith(async (url) => {
    if (isPanopto(url)) return json(f.model);
    const id = new URL(url).searchParams.get("ids");
    return json({
      elements: [
        {
          id,
          name: "synthetic.png",
          typeName: "image",
          url: {
            url:
              "https://fixture.cloudfront.net/" +
              id +
              ".png?token=" +
              credential,
          },
        },
      ],
    });
  });
}

test("podcast capture retains hashed MP4 rendition bytes and scoped receipts without signing credentials", async () => {
  const f = panoptoDeliveryFixture();
  f.model.Delivery.PodcastStreams[0].StreamUrl +=
    "?token=" + credential + "&quality=high";
  const apiReader = mixedMetadataReader(f),
    calls = [];
  const metadata = await apiReader.readPanoptoDeliveryInfo(f.targetUrl);
  const media = createDirectDataMediaReaderV1({
    apiReader,
    archiveMode: true,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(mp4, { headers: { "content-type": "video/mp4" } });
    },
  });
  const began = Date.now();
  const result = await media.capturePanoptoPodcast(metadata, f.ids.D);
  assert.equal(result.reason, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, f.model.Delivery.PodcastStreams[0].StreamUrl);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.mode, "cors");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Accept, "video/mp4");
  assert.equal(result.assetId, f.ids.D);
  assert.equal(result.role, "PODCAST_STREAM_RENDITION");
  assert.equal(result.body.kind, "PANOPTO_PODCAST_RENDITION");
  assert.equal(result.body.receipt.role, "PODCAST_STREAM_RENDITION");
  assert.equal(result.body.receipt.status, 200);
  assert.equal(result.body.receipt.bytes, mp4.length);
  assert(Date.parse(result.body.receipt.observedAt) >= began);
  assert(Date.parse(result.body.receipt.observedAt) <= Date.now());
  assert.equal(result.body.mime, "video/mp4");
  assert.equal(
    result.body.sha256,
    createHash("sha256").update(mp4).digest("hex"),
  );
  assert.equal(result.body.archivePath, "files/" + result.body.sha256);
  assert.equal(result.body.receipt.sha256, result.body.sha256);
  assert.deepEqual(decodeDirectAssetBodyV1(result.body), mp4);
  assert(!Object.keys(result.body).includes("bytes"));
  assert(!JSON.stringify(result).includes(credential));
  assert.equal(
    new URL(result.body.canonicalUrl).searchParams.get("quality"),
    "high",
  );
  assert.equal(media.snapshot().bytes, mp4.length);
  assert.equal(media.snapshot().completed, 1);
  assert.equal(result.body.originalUploadVerified, undefined);
});

test("each podcast attempt makes a fresh GET and ignores a prior retained rendition", async () => {
  const f = panoptoDeliveryFixture(),
    apiReader = mixedMetadataReader(f);
  const changed = new Uint8Array(mp4);
  changed[11]++;
  let calls = 0;
  const media = createDirectDataMediaReaderV1({
    apiReader,
    archiveMode: true,
    fetchImpl: async () =>
      new Response(++calls === 1 ? mp4 : changed, {
        headers: { "content-type": "video/mp4" },
      }),
  });
  const first = await media.capturePanoptoPodcast(
    await apiReader.readPanoptoDeliveryInfo(f.targetUrl),
    f.ids.D,
  );
  first.body.receipt.observedAt = "2001-02-03T04:05:06.000Z";
  const before = JSON.stringify(first);
  const began = Date.now();
  const second = await media.capturePanoptoPodcast(
    await apiReader.readPanoptoDeliveryInfo(f.targetUrl),
    f.ids.D,
    first,
  );
  assert.equal(calls, 2);
  assert.equal(first.reason, undefined);
  assert.equal(second.reason, undefined);
  assert.notEqual(first.body.sha256, second.body.sha256);
  assert(Date.parse(second.body.receipt.observedAt) >= began);
  assert(Date.parse(second.body.receipt.observedAt) <= Date.now());
  assert.deepEqual(decodeDirectAssetBodyV1(second.body), changed);
  assert.equal(JSON.stringify(first), before);
  assert.equal(media.snapshot().bytes, 2 * mp4.length);
});

test("podcast bodies require video/mp4, the MP4 signature and the exact podcast identity", async () => {
  const f = panoptoDeliveryFixture(),
    apiReader = mixedMetadataReader(f);
  for (const [bytes, mime, reason, extraHeaders] of [
    [mp4, "audio/mp4", "PANOPTO_PODCAST_MIME_UNSUPPORTED"],
    [mp4, "application/octet-stream", "PANOPTO_PODCAST_MIME_UNSUPPORTED"],
    [png, "video/mp4", "DIRECT_ASSET_BODY_MAGIC_INVALID"],
    [mp4.subarray(0, 11), "video/mp4", "DIRECT_ASSET_BODY_MAGIC_INVALID"],
    [
      mp4,
      "video/mp4",
      "PANOPTO_PODCAST_PARTIAL_RESPONSE",
      { "content-range": "bytes 0-11/24" },
    ],
  ]) {
    const media = createDirectDataMediaReaderV1({
      apiReader,
      fetchImpl: async () =>
        new Response(bytes, {
          headers: { "content-type": mime, ...extraHeaders },
        }),
    });
    const result = await media.capturePanoptoPodcast(
      await apiReader.readPanoptoDeliveryInfo(f.targetUrl),
      f.ids.D,
    );
    assert.equal(result.reason, reason);
    assert.equal(result.body, undefined);
    assert.equal(media.snapshot().stopped, false);
  }
  let calls = 0;
  const media = createDirectDataMediaReaderV1({
    apiReader,
    fetchImpl: async () => {
      calls++;
      throw Error("UNEXPECTED_BODY_FETCH");
    },
  });
  const metadata = await apiReader.readPanoptoDeliveryInfo(f.targetUrl);
  assert.equal(
    (await media.capturePanoptoPodcast(metadata, f.ids.E)).reason,
    "PANOPTO_PODCAST_IDENTITY_INVALID",
  );
  assert.equal(
    (await media.capturePanoptoPodcast({ ...metadata, ok: false }, f.ids.D))
      .reason,
    "PANOPTO_METADATA_INVALID",
  );
  assert.equal(calls, 0);
});

test("podcast size limits are distinct from ordinary originals and reject actual or advertised overflow", async () => {
  const f = panoptoDeliveryFixture(),
    apiReader = mixedMetadataReader(f);
  const media = createDirectDataMediaReaderV1({
    apiReader,
    limits: { bodyBytes: 8, podcastBodyBytes: 16 },
    fetchImpl: async (url) =>
      new Response(url.includes(".png") ? png : mp4, {
        headers: {
          "content-type": url.includes(".png") ? "image/png" : "video/mp4",
        },
      }),
  });
  assert.equal(
    (
      await media.capturePanoptoPodcast(
        await apiReader.readPanoptoDeliveryInfo(f.targetUrl),
        f.ids.D,
      )
    ).reason,
    undefined,
  );
  assert.equal(
    (await media.capture(assetId)).reason,
    "DIRECT_ASSET_BODY_BYTE_LIMIT",
  );
  for (const advertised of [false, true]) {
    let cancelled = 0;
    const limited = createDirectDataMediaReaderV1({
      apiReader,
      limits: { podcastBodyBytes: 16 },
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              if (!advertised) {
                controller.enqueue(mp4);
                controller.enqueue(mp4);
              }
            },
            cancel() {
              cancelled++;
            },
          }),
          {
            headers: {
              "content-type": "video/mp4",
              ...(advertised ? { "content-length": "24" } : {}),
            },
          },
        ),
    });
    const result = await limited.capturePanoptoPodcast(
      await apiReader.readPanoptoDeliveryInfo(f.targetUrl),
      f.ids.D,
    );
    assert.equal(result.reason, "DIRECT_ASSET_BODY_BYTE_LIMIT");
    assert.equal(result.body, undefined);
    assert.equal(cancelled, 1);
    assert.equal(limited.snapshot().bytes, advertised ? 0 : 24);
  }
  const defaults = createDirectDataMediaReaderV1({
    apiReader,
    limits: { podcastBodyBytes: 1e12 },
  });
  assert.equal(defaults.snapshot().limits.podcastBodyBytes, 128 * 1024 * 1024);
  assert.equal(defaults.snapshot().limits.bodyBytes, 16 * 1024 * 1024);
});

test(
  "podcast and ordinary originals share media slots and cumulative wire-byte accounting",
  { timeout: 2000 },
  async () => {
    const f = panoptoDeliveryFixture(),
      apiReader = mixedMetadataReader(f);
    const metadata = await Promise.all([
      apiReader.readPanoptoDeliveryInfo(f.targetUrl),
      apiReader.readPanoptoDeliveryInfo(f.targetUrl),
    ]);
    const gate = deferred(),
      started = deferred();
    let active = 0,
      maximum = 0;
    const media = createDirectDataMediaReaderV1({
      apiReader,
      archiveMode: true,
      fetchImpl: async (url) => {
        active++;
        maximum = Math.max(maximum, active);
        if (active === 2) started.resolve();
        await gate.promise;
        active--;
        return new Response(url.includes(".png") ? png : mp4, {
          headers: {
            "content-type": url.includes(".png") ? "image/png" : "video/mp4",
          },
        });
      },
    });
    const pending = [
      media.capturePanoptoPodcast(metadata[0], f.ids.D),
      media.capture(assetId),
      media.capturePanoptoPodcast(metadata[1], f.ids.D),
      media.capture("B".repeat(22)),
    ];
    await started.promise;
    assert.equal(media.snapshot().active, 2);
    assert.equal(media.snapshot().queued, 2);
    gate.resolve();
    const results = await Promise.all(pending);
    assert(results.every((result) => !result.reason && result.body));
    assert.equal(maximum, 2);
    assert.equal(media.snapshot().maxConcurrentRequests, 2);
    assert.equal(media.snapshot().bytes, 48);
    assert.equal(media.snapshot().requests, 4);
    assert.equal(media.snapshot().completed, 4);

    const budget = createDirectDataMediaReaderV1({
      apiReader,
      limits: { totalBytes: 20 },
      fetchImpl: async (url) =>
        new Response(url.includes(".png") ? png : mp4, {
          headers: {
            "content-type": url.includes(".png") ? "image/png" : "video/mp4",
          },
        }),
    });
    assert.equal(
      (
        await budget.capturePanoptoPodcast(
          await apiReader.readPanoptoDeliveryInfo(f.targetUrl),
          f.ids.D,
        )
      ).reason,
      undefined,
    );
    assert.equal(
      (await budget.capture(assetId)).reason,
      "DIRECT_MEDIA_BYTE_LIMIT",
    );
    assert.equal(budget.snapshot().bytes, 24);
    assert.equal(budget.snapshot().bodyBudgetExhausted, true);
  },
);
