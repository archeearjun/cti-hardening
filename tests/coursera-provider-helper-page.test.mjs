import test from "node:test";
import assert from "node:assert/strict";
import { startProviderHelperV1 } from "../web/provider-helper.ts";

const courseId = "Vmal2bjyEfGabAr_0nhcow", nonce = "a".repeat(64);
const targetUrl = "https://fixture.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=59e8c889-654e-40f2-b073-b31c006c433b";
const identity = { id: "1", itemId: "swhBE", providerId: "native_provider" };
function fixture({ opener = true, access = true, fetcher } = {}) {
  const messages = [], calls = [], listeners = new Map();
  const status = { textContent: "" }, retry = { disabled: false, addEventListener() {} };
  const parent = { closed: false, postMessage(message, origin, transfer) {
    assert.equal(origin, "https://www.coursera.org"); messages.push({ ...message, transfer });
  } };
  const host = {
    opener: opener ? parent : null,
    location: { origin: "https://cti-hardening.pages.dev", hash: "#nonce=" + nonce + "&courseId=" + courseId },
    document: { getElementById(id) { return id === "status" ? status : retry; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const close = startProviderHelperV1(host, async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/access") return Response.json({ fullCti: access });
    return fetcher ? fetcher(url, options) : Response.json({ observed: true });
  });
  function emit(message, extra = {}) {
    listeners.get("message")?.({ source: parent, origin: "https://www.coursera.org",
      data: { protocol: "CTI_PROVIDER_HELPER_V1", nonce, courseId, ...message }, ...extra });
  }
  return { messages, calls, close, emit, status, retry, listeners, parent };
}
async function nextTurn() { await new Promise(resolve => setImmediate(resolve)); }
function request(changes = {}) {
  return { type: "request", ...identity, kind: "metadata", payload: { targetUrl, ...identity, id: undefined }, ...changes };
}
function metadataRequest() {
  return request({ payload: { targetUrl, itemId: identity.itemId, providerId: identity.providerId } });
}

test("a standalone or severed helper has no access or provider requests", () => {
  const f = fixture({ opener: false });
  assert.equal(f.calls.length, 0);
  assert.equal(f.close, undefined);
  assert.match(f.status.textContent, /No valid Coursera capture connection/);
  assert.equal(f.retry.disabled, true);
});

test("the actual helper page checks CTI access and binds only the exact Coursera opener", async () => {
  const f = fixture();
  try {
    await nextTurn();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "/api/access");
    assert.equal(f.calls[0].options.credentials, "same-origin");
    assert.equal(f.calls[0].options.redirect, "error");
    for (const extra of [{ origin: "https://evil.test" }, { source: {} }]) f.emit({ type: "init" }, extra);
    f.emit({ type: "init", nonce: "wrong" });
    f.emit({ type: "init", courseId: "different_course" });
    f.emit(metadataRequest());
    await nextTurn();
    assert.equal(f.messages.length, 0);
    assert.equal(f.calls.length, 1);
    f.emit({ type: "init" });
    assert.equal(f.messages.at(-1).type, "ready");
  } finally { f.close(); }
});

test("failed CTI authorization never initiates a provider request", async () => {
  const f = fixture({ access: false });
  try {
    await nextTurn();
    f.emit({ type: "init" });
    assert.equal(f.messages.at(-1).code, "PROVIDER_HELPER_ACCESS_REQUIRED");
    f.emit(metadataRequest());
    await nextTurn();
    assert.equal(f.calls.length, 1);
    assert.equal(f.messages.at(-1).code, "PROVIDER_HELPER_INVALID_REQUEST");
    assert.match(f.status.textContent, /Sign into CTI/);
  } finally { f.close(); }
});

test("metadata operation sends only its fixed body and streams headers and bounded chunks on explicit pull", async () => {
  const source = new Uint8Array(100000).fill(47);
  const f = fixture({ fetcher: async () => new Response(source, { headers: {
    "content-type": "application/json", "set-cookie": "PRIVATE_CTI_COOKIE",
    "x-cti-provider-transport": "CTI_PUBLIC_BACKEND", "x-cti-upstream-status": "200",
  } }) });
  try {
    await nextTurn();
    f.emit({ type: "init" });
    f.emit(metadataRequest());
    await nextTurn();
    const call = f.calls[1];
    assert.equal(call.url, "/api/provider/panopto/metadata");
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.redirect, "error");
    assert.deepEqual(JSON.parse(call.options.body), { targetUrl });
    assert(!JSON.stringify(call.options.headers).includes("Cookie"));
    const head = f.messages.at(-1);
    assert.equal(head.type, "head");
    assert.equal(head.id, identity.id);
    assert.equal(head.itemId, identity.itemId);
    assert(!JSON.stringify(head).includes("PRIVATE_CTI_COOKIE"));
    assert.equal(f.messages.filter(m => m.type === "chunk").length, 0);
    for (const [seq, offset, expected] of [[0, 0, 65536], [1, 65536, 34464]]) {
      f.emit({ type: "pull", ...identity, seq, offset });
      await nextTurn();
      const chunk = f.messages.at(-1);
      assert.equal(chunk.type, "chunk");
      assert.equal(chunk.seq, seq);
      assert.equal(chunk.offset, offset);
      assert.equal(chunk.bytes.byteLength, expected);
      assert.equal(chunk.transfer[0], chunk.bytes);
    }
    f.emit({ type: "pull", ...identity, seq: 2, offset: 100000 });
    await nextTurn();
    assert.equal(f.messages.at(-1).type, "end");
    assert.equal(f.messages.at(-1).offset, 100000);
  } finally { f.close(); }
});

test("arbitrary operations, URLs, headers and oversized envelopes do not reach the authenticated API", async () => {
  const f = fixture();
  try {
    await nextTurn();
    f.emit({ type: "init" });
    for (const change of [
      { kind: "anything" }, { payload: { targetUrl: "https://evil.test/" } },
      { payload: { targetUrl, cookie: "private" } },
      { payload: { targetUrl, headers: { Authorization: "private" } } },
      { payload: { targetUrl, itemId: "wrong" } },
      { extra: "x".repeat(8192) },
    ]) f.emit(request(change));
    await nextTurn();
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("parent cancellation aborts the API request and closing the helper removes the channel", async () => {
  let activeSignal;
  const f = fixture({ fetcher: async (url, options) => {
    activeSignal = options.signal;
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(Error("PRIVATE_NETWORK_DETAIL")), { once: true }));
  } });
  try {
    await nextTurn();
    f.emit({ type: "init" });
    f.emit(metadataRequest());
    await nextTurn();
    assert.equal(activeSignal.aborted, false);
    f.emit({ type: "cancel", ...identity });
    await nextTurn();
    assert.equal(activeSignal.aborted, true);
    assert(!JSON.stringify(f.messages).includes("PRIVATE_NETWORK_DETAIL"));
    f.emit({ type: "close" });
    assert.equal(f.listeners.has("message"), false);
  } finally { f.close(); }
});
