import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runProbe, TARGETS } from "./probe-core.mjs";
import { createProbeWorker } from "./worker-core.mjs";

const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,12,23,34]);
const hash = (body) => createHash("sha256").update(body).digest("hex");
const success = (mime = "image/png") => new Response(png, { headers: { "Content-Type": mime, "Content-Length": String(png.length) } });

test("all targets are closed, public, credential-free and hash exact EOF bytes", async () => {
  const calls = [];
  const r = await runProbe({ fetcher: async (url, init) => {
    calls.push([url, init]);
    return success(url.includes("download") ? "application/epub+zip" : "image/png");
  } });
  assert.equal(r.requests, 3);
  assert.deepEqual(calls.map(([url]) => url).sort(), TARGETS.map((x) => x.url).sort());
  for (const [url, init] of calls) {
    assert.equal(init.method, "GET"); assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Cookie, undefined); assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers["User-Agent"], undefined); assert.equal(init.headers.Referer, undefined);
  }
  for (const item of r.results) { assert.equal(item.outcome, "EOF_HASHED"); assert.equal(item.sha256, hash(png)); assert.equal(item.bytes, png.length); }
});

test("challenge is not retried; a nonchallenge 403 changes only the observed public Referer", async () => {
  const calls = [];
  const r = await runProbe({ fetcher: async (url, init) => {
    calls.push([url, init]);
    if (url === TARGETS[0].url) return new Response("DO_NOT_READ_OR_LOG", { status: 403, headers: { "cf-mitigated": "challenge", "Content-Type": "text/html" } });
    if (url === TARGETS[1].url && !init.headers.Referer) return new Response("DO_NOT_READ_OR_LOG", { status: 403 });
    return success(url.includes("download") ? "application/epub+zip" : "image/png");
  } });
  assert.equal(r.requests, 4);
  assert.equal(calls.filter(([u]) => u === TARGETS[0].url).length, 1);
  const pair = calls.filter(([u]) => u === TARGETS[1].url);
  assert.equal(pair.length, 2); assert.equal(pair[1][1].headers.Referer, TARGETS[1].referrer);
  assert.deepEqual(Object.keys(pair[1][1].headers).sort(), ["Accept", "Accept-Encoding", "Referer"]);
  assert.equal(r.results[0].challenge, true); assert.equal(r.results[0].bytes, 0);
});

test("only one same-book literal EPUB redirect may be followed", async () => {
  const calls = [];
  const redirected = "https://opentextbc.ca/mathfortrades2/wp-content/uploads/sites/347/exports/book.epub";
  const r = await runProbe({ fetcher: async (url, init) => {
    calls.push(url);
    if (url === TARGETS[2].url) return new Response(null, { status: 302, headers: { Location: redirected } });
    return success(url === redirected ? "application/epub+zip" : "image/png");
  } });
  assert.equal(r.requests, 4); assert(calls.includes(redirected));
  assert.equal(r.results.at(-1).redirects, 1); assert.equal(r.results.at(-1).outcome, "EOF_HASHED");
  const blocked = await runProbe({ fetcher: async (url) => url === TARGETS[2].url
    ? new Response(null, { status: 302, headers: { Location: "https://foreign.invalid/anything.epub" } }) : success() });
  assert.equal(blocked.requests, 3); assert.equal(blocked.results.at(-1).outcome, "REDIRECT_NOT_FOLLOWED");
});

test("oversized declared response is not read or hashed", async () => {
  const r = await runProbe({ fetcher: async (url) => new Response(png, { headers: {
    "Content-Type": url.includes("download") ? "application/epub+zip" : "image/png", "Content-Length": String(65 * 1024 * 1024),
  } }) });
  for (const x of r.results) { assert.equal(x.bytes, 0); assert.equal(x.sha256, ""); assert.equal(x.outcome, "DECLARED_LENGTH_NOT_READ"); }
});

test("ephemeral worker refuses missing nonce, unknown path and credential headers", async () => {
  const nonce = "a".repeat(64), worker = createProbeWorker(nonce);
  for (const request of [
    new Request("https://preview.invalid/run", { method: "POST" }),
    new Request("https://preview.invalid/elsewhere", { method: "POST", headers: { "X-CTI-Public-Probe-Nonce": nonce } }),
    new Request("https://preview.invalid/run", { method: "POST", headers: { "X-CTI-Public-Probe-Nonce": nonce, Cookie: "NEVER_FORWARD" } }),
    new Request("https://preview.invalid/run", { method: "POST", headers: { "X-CTI-Public-Probe-Nonce": nonce, Authorization: "NEVER_FORWARD" } }),
  ]) assert.equal((await worker.fetch(request)).status, 404);
  const health = await worker.fetch(new Request("https://preview.invalid/health", { headers: { "X-CTI-Public-Probe-Nonce": nonce } }));
  assert.equal(health.status, 200); assert.equal(await health.text(), "ready");
});
