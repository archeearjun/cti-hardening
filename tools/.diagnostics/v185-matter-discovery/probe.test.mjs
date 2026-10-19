import test from "node:test";
import assert from "node:assert/strict";
import { BOOKS, advertisedMatterRoutes, runDiscovery } from "./probe.mjs";

const back = "/pressbooks/v2/back-matter/(?P<id>[\\d]+)";
const front = "/pressbooks/v2/front-matter/(?P<id>\\d+)";
const index = (route = back, methods = ["GET"]) => ({ namespaces: ["pressbooks/v2"], routes: {
  [route]: { namespace: "pressbooks/v2", endpoints: [{ methods }] },
  [front]: { namespace: "pressbooks/v2", endpoints: [{ methods: ["GET"] }] },
} });
const reply = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json; charset=UTF-8" } });

test("only literal declared numeric GET templates are accepted", () => {
  assert.equal(advertisedMatterRoutes(index()).length, 2);
  assert.equal(advertisedMatterRoutes(index(back, ["POST"])).filter((x) => x.kind === "back-matter").length, 0);
  assert.equal(advertisedMatterRoutes(index("/pressbooks/v2/back-matter/(?P<id>.*)")).filter((x) => x.kind === "back-matter").length, 0);
  assert.deepEqual(advertisedMatterRoutes({ ...index(), namespaces: [] }), []);
});

test("two indexes precede five exact captured-ID typed GETs without outputting source content", async () => {
  const calls = [];
  const result = await runDiscovery({ fetcher: async (url, init) => {
    calls.push(url);
    assert.equal(init.method, "GET"); assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "manual");
    assert.deepEqual(Object.keys(init.headers).sort(), ["Accept", "Accept-Encoding"]);
    if (url.endsWith("/wp-json/")) return reply(index());
    assert.equal(calls.filter((value) => value.endsWith("/wp-json/")).length, 2);
    const id = Number(url.split("/").at(-1)), book = BOOKS.find((value) => url.startsWith(value.index));
    assert(book.ids.includes(id));
    return reply({ id, type: "back-matter", status: "publish", link: "https://opentextbc.ca/" + book.id + "/back-matter/appendix/",
      title: { rendered: "Appendix &amp; Notes" }, content: { raw: "DO_NOT_LOG_SOURCE_BODY", rendered: "<p>DO_NOT_LOG_SOURCE_BODY</p>", protected: false }, _links: { self: [{ href: url }] } });
  } });
  assert.equal(result.requests, 7); assert.equal(result.typed.length, 5);
  assert(!JSON.stringify(result).includes("DO_NOT_LOG_SOURCE_BODY"));
  for (const value of result.typed) {
    assert.equal(value.identityAccepted, true); assert.equal(value.titlePlain, "Appendix & Notes");
    assert.equal(value.contentFields.length, 3); assert.deepEqual(value.selfLinks, [value.endpoint]);
    assert.match(value.sha256, /^[a-f0-9]{64}$/);
  }
});

test("unadvertised GET, foreign route and Cloudflare challenge never cause guessed typed requests", async () => {
  let calls = 0;
  const result = await runDiscovery({ fetcher: async () => {
    calls++;
    return calls === 1 ? reply(index("https://foreign.invalid/back-matter/(?P<id>[\\d]+)"))
      : new Response("DO_NOT_READ_CHALLENGE", { status: 403, headers: { "cf-mitigated": "challenge" } });
  } });
  assert.equal(result.requests, 2); assert.equal(result.typed.length, 0);
  assert.equal(result.indexes[1].challenge, true); assert.equal(result.indexes[1].bytes, 0);
  assert(!JSON.stringify(result).includes("DO_NOT_READ_CHALLENGE"));
});

test("index response size is bounded before any typed discovery", async () => {
  const result = await runDiscovery({ fetcher: async () => new Response("NO_BODY_READ", { headers: { "Content-Type": "application/json", "Content-Length": "4194305" } }) });
  assert.equal(result.requests, 2); assert.equal(result.typed.length, 0);
  assert(result.indexes.every((value) => value.outcome === "DECLARED_LENGTH_BOUND" && value.bytes === 0));
});
