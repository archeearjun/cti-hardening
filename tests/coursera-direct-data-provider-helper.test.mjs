import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createDirectProviderHelperV1,
  CTI_PROVIDER_HELPER_ORIGIN_V1,
} from "../src/extractors/coursera/direct-data-provider-helper.js";

const courseId = "Vmal2bjyEfGabAr_0nhcow";
const targetUrl = "https://fixture.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=59e8c889-654e-40f2-b073-b31c006c433b&autoplay=false";
const operations = ["metadata", "podcast", "publicHtml", "publisherImage"];
const imagePayload = {
  targetUrl: "https://opentextbc.ca/syntheticbook/?p=225/#main",
  imageUrl: "https://opentextbc.ca/syntheticbook/wp-content/uploads/2026/01/original.png",
  sourceSha256: "a".repeat(64),
  itemId: "nativeItem",
  providerId: "p".repeat(22) + "@3",
};
const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const imageHash = createHash("sha256").update(imageBytes).digest("hex");
function imageHeaders(changes = {}) {
  const headers = {
    "content-type": "image/png",
    "content-encoding": "identity",
    "content-length": String(imageBytes.length),
    "x-cti-provider-transport": "CTI_SERVICE_PUBLIC_IMAGE",
    "x-cti-provider-origin": CTI_PROVIDER_HELPER_ORIGIN_V1,
    "x-cti-upstream-content-length": String(imageBytes.length),
    "x-cti-upstream-sha256": imageHash,
    "x-cti-publisher-source-hash": imagePayload.sourceSha256,
    ...changes,
  };
  return Object.entries(headers).filter(([, value]) => value !== null);
}
function fixture({ blocked = false, auto = true, operations } = {}) {
  const listeners = new Set(), messages = [], opens = [], status = [];
  let nonce;
  const popup = {
    closed: false,
    close() { this.closed = true; },
    postMessage(message, origin) {
      assert.equal(origin, CTI_PROVIDER_HELPER_ORIGIN_V1);
      messages.push(message);
      if (auto && message.type === "init") queueMicrotask(() => emit({ type: "ready", ...(operations === undefined ? {} : { operations }) }));
    },
  };
  const host = {
    location: { origin: "https://www.coursera.org" },
    open(url, name, features) {
      opens.push({ url, name, features });
      nonce = new URLSearchParams(new URL(url).hash.slice(1)).get("nonce");
      return blocked ? null : popup;
    },
    addEventListener(type, listener) { assert.equal(type, "message"); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, "message"); listeners.delete(listener); },
  };
  function emit(data, overrides = {}) {
    const event = { data: { protocol: "CTI_PROVIDER_HELPER_V1", nonce, courseId, ...data },
      origin: CTI_PROVIDER_HELPER_ORIGIN_V1, source: popup, ...overrides };
    for (const listener of listeners) listener(event);
  }
  const helper = createDirectProviderHelperV1({ courseId, windowImpl: host, onStatus: message => status.push(message) });
  return { helper, emit, messages, opens, popup, listeners, status };
}
function binding(message) {
  return { id: message.id, itemId: message.itemId, providerId: message.providerId };
}
function respondHead(f, request, headers = [["content-type", "application/json"]]) {
  f.emit({ type: "head", ...binding(request), status: 200, headers });
}
async function nextTurn() { await new Promise(resolve => setImmediate(resolve)); }

test("helper opens the fixed CTI page synchronously and rejects blocked windows explicitly", async () => {
  const f = fixture({ blocked: true });
  assert.equal(f.opens.length, 1);
  const url = new URL(f.opens[0].url);
  assert.equal(url.origin, CTI_PROVIDER_HELPER_ORIGIN_V1);
  assert.equal(url.pathname, "/provider-helper.html");
  assert.equal(url.search, "");
  assert.match(url.hash, /^#nonce=[a-f0-9]{64}&courseId=/);
  assert(!f.opens[0].features.includes("noopener"));
  await assert.rejects(f.helper.ready(), { code: "PROVIDER_HELPER_POPUP_BLOCKED" });
  await assert.rejects(f.helper.request("metadata", { targetUrl }), { code: "PROVIDER_HELPER_POPUP_BLOCKED" });
  assert.equal(f.listeners.size, 0);
});

test("handshake and data messages require exact source, origin, nonce and course", async () => {
  const f = fixture({ auto: false });
  let ready = false;
  f.helper.ready().then(() => { ready = true; });
  try {
    for (const overrides of [{ origin: "https://evil.test" }, { source: {} },
      { data: { protocol: "CTI_PROVIDER_HELPER_V1", nonce: "wrong", courseId, type: "ready" } }]) {
      f.emit({ type: "ready" }, overrides);
    }
    f.emit({ type: "ready", courseId: "another_course" });
    await nextTurn();
    assert.equal(ready, false);
    f.emit({ type: "ready" });
    await f.helper.ready();
    assert.equal(ready, true);
  } finally { f.helper.close(); }
});

test("stream is pulled one bounded chunk at a time and retains request identity and safe headers", async () => {
  const f = fixture();
  try {
    await f.helper.ready();
    const responsePromise = f.helper.request("metadata", { targetUrl, itemId: "swhBE", providerId: "native_provider" });
    const request = f.messages.find(message => message.type === "request");
    assert.equal(request.kind, "metadata");
    assert.equal(request.payload.targetUrl, targetUrl);
    assert.equal(request.itemId, "swhBE");
    respondHead(f, request, [["content-type", "application/json"], ["x-cti-provider-transport", "CTI_PUBLIC_BACKEND"],
      ["x-cti-upstream-status", "200"], ["x-cti-validation-source-hash", "a".repeat(64)]]);
    const response = await responsePromise;
    assert.equal(response.url, "");
    assert.equal(response.headers.get("x-cti-upstream-status"), "200");
    assert.equal(f.messages.filter(message => message.type === "pull").length, 0);
    const reader = response.body.getReader();
    const first = reader.read();
    await nextTurn();
    assert.equal(f.messages.filter(message => message.type === "pull").length, 1);
    f.emit({ type: "chunk", ...binding(request), seq: 0, offset: 0,
      bytes: new TextEncoder().encode("one").buffer }, { origin: "https://evil.test" });
    f.emit({ type: "chunk", ...binding(request), providerId: "wrong", seq: 0, offset: 0,
      bytes: new TextEncoder().encode("one").buffer });
    f.emit({ type: "chunk", ...binding(request), seq: 0, offset: 0,
      bytes: new TextEncoder().encode("one").buffer });
    assert.equal(new TextDecoder().decode((await first).value), "one");
    assert.equal(f.messages.filter(message => message.type === "pull").length, 1);
    const end = reader.read();
    await nextTurn();
    const pull = f.messages.filter(message => message.type === "pull").at(-1);
    assert.equal(pull.seq, 1);
    assert.equal(pull.offset, 3);
    f.emit({ type: "end", ...binding(request), seq: 1, offset: 3 });
    assert.equal((await end).done, true);
  } finally { f.helper.close(); }
});

test("at most two requests run while queued and aborted requests release their slot", async () => {
  const f = fixture();
  try {
    await f.helper.ready();
    const one = new AbortController(), two = new AbortController(), three = new AbortController();
    const pending = [one, two, three].map(controller => f.helper.request("metadata", { targetUrl }, controller.signal));
    pending.forEach(promise => promise.catch(() => {}));
    assert.equal(f.messages.filter(message => message.type === "request").length, 2);
    one.abort();
    await assert.rejects(pending[0], { code: "PROVIDER_HELPER_ABORTED" });
    assert.equal(f.messages.filter(message => message.type === "request").length, 3);
    two.abort(); three.abort();
    await Promise.all(pending.map(promise => assert.rejects(promise, { code: "PROVIDER_HELPER_ABORTED" })));
  } finally { f.helper.close(); }
});

test("request kinds, addresses, methods, credentials and native podcast bindings are closed", async () => {
  const f = fixture();
  try {
    await f.helper.ready();
    for (const [kind, payload] of [
      ["anything", { targetUrl }], ["metadata", { targetUrl: "https://evil.test/" }],
      ["metadata", { targetUrl, method: "POST" }], ["metadata", { targetUrl, cookie: "secret" }],
      ["metadata", { targetUrl, itemId: "bad&id" }],
      ["podcast", { targetUrl, streamFileId: "missing", sourceHash: "a".repeat(64) }],
    ]) await assert.rejects(f.helper.request(kind, payload), { code: "PROVIDER_HELPER_INVALID_REQUEST" });
    assert.equal(f.messages.filter(message => message.type === "request").length, 0);
  } finally { f.helper.close(); }
});

test("public HTML is a separate closed operation retaining the exact versioned inline-provider binding", async () => {
  const f = fixture(), publicTarget = "https://opentextbc.ca/syntheticbook/chapter/area/#main", providerId = "p".repeat(22) + "@3";
  try {
    await f.helper.ready();
    for (const payload of [{ targetUrl: "https://evil.test/book/page/" }, { targetUrl: publicTarget, method: "GET" },
      { targetUrl: publicTarget, cookie: "PRIVATE" }, { targetUrl: publicTarget, providerId: "bad@1&extra" }])
      await assert.rejects(f.helper.request("publicHtml", payload), { code: "PROVIDER_HELPER_INVALID_REQUEST" });
    const pending = f.helper.request("publicHtml", { targetUrl: publicTarget, itemId: "nativeItem", providerId });
    const request = f.messages.find(message => message.type === "request");
    assert.equal(request.kind, "publicHtml");
    assert.equal(request.providerId, providerId);
    assert.deepEqual(request.payload, { targetUrl: publicTarget, itemId: "nativeItem", providerId });
    respondHead(f, request, [["content-type", "application/json"], ["content-length", "2"], ["x-cti-response-envelope-bytes", "2"]]);
    const response = await pending, reading = response.arrayBuffer();
    await nextTurn();
    f.emit({ type: "chunk", ...binding(request), seq: 0, offset: 0, bytes: new TextEncoder().encode("{}").buffer });
    await nextTurn();
    f.emit({ type: "end", ...binding(request), seq: 1, offset: 2 });
    assert.equal(new TextDecoder().decode(await reading), "{}");
  } finally { f.helper.close(); }
});

test("public HTML relay requires decoded framing and rejects truncated EOF while permitting compressed wire-length differences", async () => {
  for (const framing of [null, "bad", "2", "3"]) {
    const f = fixture();
    try {
      await f.helper.ready();
      const pending = f.helper.request("publicHtml", {targetUrl:"https://opentextbc.ca/syntheticbook/chapter/area/"});
      const request = f.messages.find(message => message.type === "request");
      respondHead(f, request, [["content-type","application/json"],["content-encoding","gzip"],["content-length","20"],
        ...(framing===null?[]:[["x-cti-response-envelope-bytes",framing]])]);
      if (framing===null || framing==="bad") { await assert.rejects(pending,{code:"PROVIDER_HELPER_INVALID_RESPONSE"});continue; }
      const response=await pending, reading=response.arrayBuffer();
      await nextTurn();f.emit({type:"chunk",...binding(request),seq:0,offset:0,bytes:new TextEncoder().encode("{}").buffer});
      await nextTurn();f.emit({type:"end",...binding(request),seq:1,offset:2});
      if (framing==="2") assert.equal(new TextDecoder().decode(await reading),"{}");
      else await assert.rejects(reading,{code:"PROVIDER_HELPER_PUBLIC_HTML_LENGTH_MISMATCH"});
    }finally{f.helper.close();}
  }
});

test("invalid sequence, offset, chunk size and unsafe response headers fail closed", async () => {
  for (const variant of ["sequence", "offset", "large", "header"]) {
    const f = fixture();
    try {
      await f.helper.ready();
      const pending = f.helper.request("metadata", { targetUrl });
      const request = f.messages.find(message => message.type === "request");
      if (variant === "header") {
        respondHead(f, request, [["set-cookie", "PRIVATE_VALUE"]]);
        await assert.rejects(pending, { code: "PROVIDER_HELPER_INVALID_RESPONSE" });
      } else {
        respondHead(f, request);
        const response = await pending;
        const reading = response.body.getReader().read();
        await nextTurn();
        f.emit({ type: "chunk", ...binding(request), seq: variant === "sequence" ? 1 : 0,
          offset: variant === "offset" ? 1 : 0, bytes: new ArrayBuffer(variant === "large" ? 65537 : 1) });
        await assert.rejects(reading, { code: "PROVIDER_HELPER_INVALID_RESPONSE" });
      }
    } finally { f.helper.close(); }
  }
});

test("metadata body limit is enforced across chunks and cancellation stops the stream", async () => {
  const f = fixture();
  try {
    await f.helper.ready();
    const pending = f.helper.request("metadata", { targetUrl });
    const request = f.messages.find(message => message.type === "request");
    respondHead(f, request);
    const reader = (await pending).body.getReader();
    for (let seq = 0; seq < 9; seq++) {
      const reading = reader.read();
      await nextTurn();
      f.emit({ type: "chunk", ...binding(request), seq, offset: seq * 65536, bytes: new ArrayBuffer(65536) });
      if (seq === 8) await assert.rejects(reading, { code: "PROVIDER_HELPER_BYTE_LIMIT" });
      else assert.equal((await reading).value.byteLength, 65536);
    }
    assert(f.messages.some(message => message.type === "cancel"));
  } finally { f.helper.close(); }
});

test("helper shutdown rejects pending work and removes its listener", async () => {
  const f = fixture({ auto: false });
  const pending = f.helper.request("metadata", { targetUrl });
  pending.catch(() => {});
  f.helper.close();
  await assert.rejects(f.helper.ready(), { code: "PROVIDER_HELPER_CLOSED" });
  await assert.rejects(pending, { code: "PROVIDER_HELPER_CLOSED" });
  assert.equal(f.popup.closed, true);
  assert.equal(f.listeners.size, 0);
});

test("publisher image operation requires an advertised capability while old ready frames retain legacy operations", async () => {
  const legacy = fixture();
  try {
    await legacy.helper.ready();
    assert.equal(legacy.helper.supports("metadata"), true);
    assert.equal(legacy.helper.supports("podcast"), true);
    assert.equal(legacy.helper.supports("publicHtml"), true);
    assert.equal(legacy.helper.supports("publisherImage"), false);
    await assert.rejects(legacy.helper.request("publisherImage", imagePayload), { code: "PROVIDER_HELPER_OPERATION_UNSUPPORTED" });
    assert.equal(legacy.messages.filter(message => message.type === "request").length, 0);
    legacy.emit({ type: "ready", operations });
    assert.equal(legacy.helper.supports("publisherImage"), false, "A later ready frame does not rewrite the negotiated capabilities");
  } finally { legacy.helper.close(); }
  const current = fixture({ operations });
  try {
    await current.helper.ready();
    assert(operations.every(kind => current.helper.supports(kind)));
    assert.equal(current.helper.supports("arbitraryFetch"), false);
  } finally { current.helper.close(); }
});

test("malformed capability advertisements fail closed before any request is sent", async () => {
  for (const advertised of [null, "publisherImage", ["publisherImage", "publisherImage"], ["metadata", "unknown"], [...operations, "unknown"], [42]]) {
    const f = fixture({ auto: false });
    try {
      f.emit({ type: "ready", operations: advertised });
      await assert.rejects(f.helper.ready(), { code: "PROVIDER_HELPER_INVALID_CAPABILITIES" });
      await assert.rejects(f.helper.request("publisherImage", imagePayload), { code: "PROVIDER_HELPER_INVALID_CAPABILITIES" });
      assert.equal(f.messages.filter(message => message.type === "request").length, 0);
      assert.equal(f.listeners.size, 0);
    } finally { f.helper.close(); }
  }
});

test("publisher images queued before a legacy handshake fail without blocking legacy metadata work", async () => {
  const f = fixture({ auto: false });
  const image = f.helper.request("publisherImage", imagePayload);
  image.catch(() => {});
  const controller = new AbortController();
  const metadata = f.helper.request("metadata", { targetUrl }, controller.signal);
  metadata.catch(() => {});
  try {
    assert.equal(f.messages.filter(message => message.type === "request").length, 0);
    f.emit({ type: "ready" });
    await f.helper.ready();
    await assert.rejects(image, { code: "PROVIDER_HELPER_OPERATION_UNSUPPORTED" });
    assert.deepEqual(f.messages.filter(message => message.type === "request").map(message => message.kind), ["metadata"]);
    controller.abort();
    await assert.rejects(metadata, { code: "PROVIDER_HELPER_ABORTED" });
  } finally { f.helper.close(); }
});

test("publisher image payloads preserve the literal upload/source hash and reject generic URLs, credentials and extra fields", async () => {
  const f = fixture({ operations });
  try {
    await f.helper.ready();
    for (const changes of [
      { targetUrl: "https://opentextbc.ca/syntheticbook/chapter/slug/" },
      { targetUrl: imagePayload.targetUrl.replace("https://", "HTTPS://") },
      { targetUrl: imagePayload.targetUrl.replace("opentextbc.ca", "OPENTEXTBC.CA") },
      { targetUrl: imagePayload.targetUrl.replace("opentextbc.ca/", "opentextbc.ca:443/") },
      { targetUrl: imagePayload.targetUrl.replace("opentextbc.ca/", "opentextbc.ca:/") },
      { imageUrl: "https://evil.test/original.png" },
      { imageUrl: "http://opentextbc.ca/syntheticbook/wp-content/uploads/original.png" },
      { imageUrl: "https://user:password@opentextbc.ca/syntheticbook/wp-content/uploads/original.png" },
      { imageUrl: imagePayload.imageUrl.replace("https://", "HTTPS://") },
      { imageUrl: imagePayload.imageUrl.replace("opentextbc.ca", "OPENTEXTBC.CA") },
      { imageUrl: imagePayload.imageUrl.replace("opentextbc.ca/", "opentextbc.ca:443/") },
      { imageUrl: imagePayload.imageUrl.replace("opentextbc.ca/", "opentextbc.ca:/") },
      { imageUrl: "/syntheticbook/wp-content/uploads/original.png" },
      { imageUrl: imagePayload.imageUrl + "?" },
      { imageUrl: imagePayload.imageUrl + "#" },
      { imageUrl: imagePayload.imageUrl + "?token=PRIVATE" },
      { imageUrl: imagePayload.imageUrl + "#fragment" },
      { imageUrl: imagePayload.imageUrl.replace("original.png", "original.svg") },
      { imageUrl: imagePayload.imageUrl.replace("original.png", "%6friginal.png") },
      { sourceSha256: "A".repeat(64) },
      { sourceSha256: "short" },
      { sourceSha256: null },
      { sourceHash: imagePayload.sourceSha256 },
      { method: "GET" },
      { headers: { Authorization: "PRIVATE" } },
      { cookie: "PRIVATE" },
      { itemId: "wrong&item" },
      { providerId: "wrong@3&extra" },
    ]) await assert.rejects(f.helper.request("publisherImage", { ...imagePayload, ...changes }), { code: "PROVIDER_HELPER_INVALID_REQUEST" });
    const longBook = "b".repeat(3900);
    await assert.rejects(f.helper.request("publisherImage", {
      ...imagePayload,
      targetUrl: "https://opentextbc.ca/" + longBook + "/?p=225#main",
      imageUrl: "https://opentextbc.ca/" + longBook + "/wp-content/uploads/a.png",
    }), { code: "PROVIDER_HELPER_INVALID_REQUEST" });
    assert.equal(f.messages.filter(message => message.type === "request").length, 0);
    const controller = new AbortController();
    const pending = f.helper.request("publisherImage", imagePayload, controller.signal);
    const request = f.messages.find(message => message.type === "request");
    assert.equal(request.kind, "publisherImage");
    assert.deepEqual(request.payload, imagePayload);
    assert.equal(request.itemId, imagePayload.itemId);
    assert.equal(request.providerId, imagePayload.providerId);
    controller.abort();
    await assert.rejects(pending, { code: "PROVIDER_HELPER_ABORTED" });
  } finally { f.helper.close(); }
});

test("publisher image heads require decoded framing, service identity and source-bound SHA headers", async () => {
  for (const changes of [
    { "x-cti-upstream-content-length": null },
    { "x-cti-upstream-content-length": "0" },
    { "x-cti-upstream-content-length": "8.0" },
    { "x-cti-upstream-content-length": "9007199254740992" },
    { "x-cti-upstream-content-length": String(16 * 1024 * 1024 + 1) },
    { "x-cti-upstream-sha256": null },
    { "x-cti-upstream-sha256": "short" },
    { "x-cti-upstream-sha256": "A".repeat(64) },
    { "x-cti-publisher-source-hash": null },
    { "x-cti-publisher-source-hash": "b".repeat(64) },
    { "x-cti-provider-transport": "CTI_PUBLIC_BACKEND" },
    { "x-cti-provider-origin": "https://evil.test" },
    { "content-range": "bytes 0-7/100" },
    { "content-length": "9" },
    { "content-length": "8.0" },
    { "set-cookie": "PRIVATE" },
  ]) {
    const f = fixture({ operations });
    try {
      await f.helper.ready();
      const pending = f.helper.request("publisherImage", imagePayload);
      const request = f.messages.find(message => message.type === "request");
      respondHead(f, request, imageHeaders(changes));
      await assert.rejects(pending, { code: "PROVIDER_HELPER_INVALID_RESPONSE" });
      assert(f.messages.some(message => message.type === "cancel"));
    } finally { f.helper.close(); }
  }
});

test("publisher image relay preserves binary bytes and safe hash headers using authoritative decoded length", async () => {
  for (const framing of [
    {},
    { "content-encoding": "gzip", "content-length": "99999999" },
    { "content-encoding": null, "content-length": "99999999" },
    { "content-length": null },
  ]) {
    const f = fixture({ operations });
    try {
      await f.helper.ready();
      const pending = f.helper.request("publisherImage", imagePayload);
      const request = f.messages.find(message => message.type === "request");
      respondHead(f, request, imageHeaders(framing));
      const response = await pending;
      assert.equal(response.headers.get("x-cti-upstream-sha256"), imageHash);
      assert.equal(response.headers.get("x-cti-publisher-source-hash"), imagePayload.sourceSha256);
      assert.equal(response.headers.get("x-cti-provider-transport"), "CTI_SERVICE_PUBLIC_IMAGE");
      assert.equal(f.messages.filter(message => message.type === "pull").length, 0);
      const reading = response.arrayBuffer();
      await nextTurn();
      f.emit({ type: "chunk", ...binding(request), providerId: "wrong", seq: 0, offset: 0, bytes: imageBytes.slice().buffer });
      f.emit({ type: "chunk", ...binding(request), seq: 0, offset: 0, bytes: imageBytes.slice().buffer });
      await nextTurn();
      f.emit({ type: "end", ...binding(request), seq: 1, offset: imageBytes.length });
      assert.deepEqual(new Uint8Array(await reading), imageBytes);
      assert.equal(f.messages.filter(message => message.type === "pull").length, 2);
    } finally { f.helper.close(); }
  }
});

test("publisher image truncated EOF and bytes beyond the declaration cannot become a completed stream", async () => {
  for (const declared of [imageBytes.length - 1, imageBytes.length + 1]) {
    const f = fixture({ operations });
    try {
      await f.helper.ready();
      const pending = f.helper.request("publisherImage", imagePayload);
      const request = f.messages.find(message => message.type === "request");
      respondHead(f, request, imageHeaders({ "content-length": null, "x-cti-upstream-content-length": String(declared) }));
      const reading = (await pending).arrayBuffer();
      reading.catch(() => {});
      await nextTurn();
      f.emit({ type: "chunk", ...binding(request), seq: 0, offset: 0, bytes: imageBytes.slice().buffer });
      if (declared > imageBytes.length) {
        await nextTurn();
        f.emit({ type: "end", ...binding(request), seq: 1, offset: imageBytes.length });
      }
      await assert.rejects(reading, { code: declared < imageBytes.length ? "PROVIDER_HELPER_BYTE_LIMIT" : "PROVIDER_HELPER_PUBLISHER_IMAGE_LENGTH_MISMATCH" });
    } finally { f.helper.close(); }
  }
});

test("one publisher image runs at a time while metadata bypasses queued images within two total slots", async () => {
  const f = fixture({ operations });
  try {
    await f.helper.ready();
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const first = f.helper.request("publisherImage", imagePayload, controllers[0].signal);
    const second = f.helper.request("publisherImage", { ...imagePayload, itemId: "queuedImage" }, controllers[1].signal);
    assert.equal(f.messages.filter(message => message.type === "request").length, 1);
    const third = f.helper.request("metadata", { targetUrl }, controllers[2].signal);
    [first, second, third].forEach(pending => pending.catch(() => {}));
    assert.equal(f.messages.filter(message => message.type === "request").length, 2);
    assert.deepEqual(f.messages.filter(message => message.type === "request").map(message => message.kind), ["publisherImage", "metadata"]);
    const imageRequest = f.messages.find(message => message.type === "request" && message.kind === "publisherImage");
    respondHead(f, imageRequest, imageHeaders());
    const reader = (await first).body.getReader();
    const reading = reader.read();
    await nextTurn();
    controllers[0].abort();
    await assert.rejects(reading, { code: "PROVIDER_HELPER_ABORTED" });
    const requests = f.messages.filter(message => message.type === "request");
    assert.deepEqual(requests.map(message => message.kind), ["publisherImage", "metadata", "publisherImage"]);
    assert.equal(requests[2].itemId, "queuedImage");
    assert(!f.messages.some(message => message.type === "cancel" && message.id === requests[1].id), "The metadata request stays active when the image permit is released");
    controllers[1].abort();
    controllers[2].abort();
    await assert.rejects(second, { code: "PROVIDER_HELPER_ABORTED" });
    await assert.rejects(third, { code: "PROVIDER_HELPER_ABORTED" });
    assert(f.messages.some(message => message.type === "cancel" && message.id === imageRequest.id));
    const active = new Map();
    for (const message of f.messages) {
      if (message.type === "request") active.set(message.id, message.kind);
      else if (message.type === "cancel") active.delete(message.id);
      assert(active.size <= 2);
      assert([...active.values()].filter(kind => kind === "publisherImage").length <= 1);
    }
  } finally { f.helper.close(); }
});

test("an exact image EOF releases the single image permit while metadata remains active", async () => {
  const f = fixture({ operations });
  const queuedController = new AbortController(), coreController = new AbortController();
  try {
    await f.helper.ready();
    const first = f.helper.request("publisherImage", imagePayload);
    const queued = f.helper.request("publisherImage", { ...imagePayload, itemId: "afterEof" }, queuedController.signal);
    const core = f.helper.request("metadata", { targetUrl }, coreController.signal);
    queued.catch(() => {});core.catch(() => {});
    const firstRequest = f.messages.find(message => message.type === "request" && message.kind === "publisherImage");
    assert.deepEqual(f.messages.filter(message => message.type === "request").map(message => message.kind), ["publisherImage", "metadata"]);
    respondHead(f, firstRequest, imageHeaders());
    const reading = (await first).arrayBuffer();
    await nextTurn();
    f.emit({ type: "chunk", ...binding(firstRequest), seq: 0, offset: 0, bytes: imageBytes.slice().buffer });
    await nextTurn();
    f.emit({ type: "end", ...binding(firstRequest), seq: 1, offset: imageBytes.length });
    assert.deepEqual(new Uint8Array(await reading), imageBytes);
    const requests = f.messages.filter(message => message.type === "request");
    assert.equal(requests.length, 3);
    assert.equal(requests[2].itemId, "afterEof");
    assert(!f.messages.some(message => message.type === "cancel" && message.id === requests[1].id));
    queuedController.abort();coreController.abort();
    await assert.rejects(queued, { code: "PROVIDER_HELPER_ABORTED" });
    await assert.rejects(core, { code: "PROVIDER_HELPER_ABORTED" });
  } finally { f.helper.close(); }
});

test("the 1,024 image and 128 core request budgets remain independent while request IDs remain unique", async () => {
  const f = fixture({ operations });
  try {
    await f.helper.ready();
    for (const [kind, count] of [["metadata", 3], ["publisherImage", 1024], ["metadata", 125]]) {
      for (let i = 0; i < count; i++) {
        const controller = new AbortController();
        const pending = f.helper.request(kind, kind === "publisherImage" ? imagePayload : { targetUrl }, controller.signal);
        controller.abort();
        await assert.rejects(pending, { code: "PROVIDER_HELPER_ABORTED" });
      }
    }
    await assert.rejects(f.helper.request("publisherImage", imagePayload), { code: "PROVIDER_HELPER_REQUEST_LIMIT" });
    await assert.rejects(f.helper.request("metadata", { targetUrl }), { code: "PROVIDER_HELPER_REQUEST_LIMIT" });
    const requests = f.messages.filter(message => message.type === "request");
    assert.equal(requests.filter(message => message.kind === "publisherImage").length, 1024);
    assert.equal(requests.filter(message => message.kind === "metadata").length, 128);
    assert.equal(new Set(requests.map(message => message.id)).size, 1152);
  } finally { f.helper.close(); }
});

test("publisher image streams retain the existing aggregate 512 MiB decoded transfer cap", async () => {
  const f = fixture({ operations });
  const chunk = new ArrayBuffer(65536);
  try {
    await f.helper.ready();
    for (let image = 0; image < 33; image++) {
      const pending = f.helper.request("publisherImage", imagePayload);
      const request = f.messages.filter(message => message.type === "request").at(-1);
      respondHead(f, request, imageHeaders({ "content-length": null, "x-cti-upstream-content-length": String(16 * 1024 * 1024) }));
      const reader = (await pending).body.getReader();
      if (image === 32) {
        const reading = reader.read();
        await nextTurn();
        f.emit({ type: "chunk", ...binding(request), seq: 0, offset: 0, bytes: chunk });
        await assert.rejects(reading, { code: "PROVIDER_HELPER_BYTE_LIMIT" });
        break;
      }
      for (let seq = 0; seq < 256; seq++) {
        const reading = reader.read();
        await nextTurn();
        // Reuse one synthetic message buffer: test aggregate accounting without
        // allocating or retaining 512 MiB of fixture media in the test process.
        f.emit({ type: "chunk", ...binding(request), seq, offset: seq * chunk.byteLength, bytes: chunk });
        assert.equal((await reading).value.byteLength, chunk.byteLength);
      }
      const ended = reader.read();
      await nextTurn();
      f.emit({ type: "end", ...binding(request), seq: 256, offset: 16 * 1024 * 1024 });
      assert.equal((await ended).done, true);
    }
    assert(f.messages.some(message => message.type === "cancel"));
  } finally { f.helper.close(); }
});
