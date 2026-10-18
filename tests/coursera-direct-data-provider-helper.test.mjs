import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectProviderHelperV1,
  CTI_PROVIDER_HELPER_ORIGIN_V1,
} from "../src/extractors/coursera/direct-data-provider-helper.js";

const courseId = "Vmal2bjyEfGabAr_0nhcow";
const targetUrl = "https://fixture.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=59e8c889-654e-40f2-b073-b31c006c433b&autoplay=false";
function fixture({ blocked = false, auto = true } = {}) {
  const listeners = new Set(), messages = [], opens = [], status = [];
  let nonce;
  const popup = {
    closed: false,
    close() { this.closed = true; },
    postMessage(message, origin) {
      assert.equal(origin, CTI_PROVIDER_HELPER_ORIGIN_V1);
      messages.push(message);
      if (auto && message.type === "init") queueMicrotask(() => emit({ type: "ready" }));
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
