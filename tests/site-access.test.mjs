import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { generateKeyPair } from "jose";
import { accessFixture } from "./access-fixtures.mjs";
import { createApiHandler } from "../server/api.ts";
import {
  createSiteBoundary,
  isSharedActivityPath,
  SITE_CSP,
} from "../server/site-access.ts";

const f = await accessFixture();
const owner = await f.token("aarjun@coursera.org"),
  colleague = await f.token("colleague@coursera.org");
test("Access verifies actual signatures, issuer, audience, expiry and a human identity; headers cannot impersonate the owner", async () => {
  assert.deepEqual(await f.authenticate(f.request("/", owner), f.env), {
    email: "aarjun@coursera.org",
  });
  const foreignKey = (await generateKeyPair("RS256")).privateKey;
  for (const jwt of [
    "not-a-token",
    await f.token("aarjun@coursera.org", {}, foreignKey),
    await f.token("aarjun@coursera.org", { aud: "other-site" }),
    await f.token("aarjun@coursera.org", {
      iss: "https://other.cloudflareaccess.com",
    }),
    await f.token("aarjun@coursera.org", { exp: 1 }),
    await f.token("aarjun@coursera.org", { exp: undefined }),
    await f.token(undefined),
    await f.token("aarjun@coursera.org", { sub: "" }),
  ])
    await assert.rejects(f.authenticate(f.request("/", jwt), f.env), {
      status: 401,
    });
  await assert.rejects(
    f.authenticate(
      f.request("/", null, {
        headers: {
          "Cf-Access-Authenticated-User-Email": "aarjun@coursera.org",
        },
      }),
      f.env,
    ),
    { status: 401 },
  );
  await assert.rejects(f.authenticate(f.request("/", owner), {}), {
    status: 503,
  });
});

test("all private API reads and writes deny colleagues, even configured admins, before DB or extraction access", async () => {
  const api = createApiHandler(f.authenticate);
  const env = {
    ...f.env,
    CTI_ADMINS: "colleague@coursera.org,aarjun@coursera.org",
    CTI_DB: {
      prepare() {
        throw Error("Database must not be touched");
      },
    },
    CTI_EXTRACTOR: {
      fetch() {
        throw Error("Extractor must not be touched");
      },
    },
  };
  for (const [path, method] of [
    ["/api/session", "GET"],
    ["/api/records", "GET"],
    ["/api/records/a/chunks/0", "GET"],
    ["/api/uploads", "POST"],
    ["/api/source-questions", "POST"],
    ["/api/extraction/jobs", "GET"],
    ["/api/extraction/jobs", "POST"],
  ])
    assert.equal(
      (
        await api(
          f.request(path, colleague, {
            method,
            headers: {
              Origin: "https://cti.example.test",
              "Cf-Access-Authenticated-User-Email": "aarjun@coursera.org",
            },
          }),
          env,
        )
      ).status,
      403,
    );
  assert.deepEqual(
    await (await api(f.request("/api/access", colleague), f.env)).json(),
    { fullCti: false },
  );
  assert.deepEqual(
    await (await api(f.request("/api/access", owner), f.env)).json(),
    { fullCti: true },
  );
  assert.equal((await api(f.request("/api/session", owner), env)).status, 200);
  assert.equal(
    (await api(f.request("/api/session", owner), f.env)).status,
    503,
  );
  assert.equal(
    (await api(f.request("/api/access", owner, { method: "POST" }), f.env))
      .status,
    503,
  );
  assert.equal((await api(f.request("/api/access", null), f.env)).status, 401);
});

test("colleagues receive only the activity gateway; direct private pages, chunks, downloads and path tricks are denied", async () => {
  const boundary = createSiteBoundary(f.authenticate);
  let forwarded = 0,
    assetPath = "";
  const env = {
    ...f.env,
    ASSETS: {
      async fetch(request) {
        assetPath = new URL(request.url).pathname;
        return new Response("activity gateway");
      },
    },
  };
  const run = (path, jwt = colleague, method = "GET") =>
    boundary({
      request: f.request(path, jwt, { method }),
      env,
      async next() {
        forwarded++;
        return new Response("private asset");
      },
    });
  for (const path of [
    "/",
    "/index.html",
    "/?workspace=full&email=aarjun%40coursera.org",
  ]) {
    const r = await run(path);
    assert.equal(await r.text(), "activity gateway");
    assert.equal(assetPath, "/activity-gateway");
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    assert.equal(r.headers.get("content-security-policy"), SITE_CSP);
  }
  assert.equal(forwarded, 0);
  for (const path of [
    "/assets/OwnerWorkspace.js",
    "/assets/main.js",
    "/package-runner.html",
    "/package-runner",
    "/downloads/cti-browser-extension.zip",
    "/owner",
    "/activity-designer/../assets/main.js",
    "/activity-designer/%2e%2e/assets/main.js",
    "/activity-designer/%2e%2e%2fassets/main.js",
    "/activity-designer/not-a-file.html",
    "/api%2fsession",
  ])
    assert.equal((await run(path)).status, 403, path);
  assert.equal(forwarded, 0);
  assert.equal((await run("/activity-designer/index.html")).status, 200);
  assert.equal((await run("/activity-designer/index.html", null)).status, 401);
  assert.equal(
    (await run("/activity-designer/index.html", colleague, "POST")).status,
    405,
  );
  assert.equal((await run("/", owner)).status, 200);
  assert.equal(await (await run("/", owner, "HEAD")).text(), "");
  assert.equal(
    await (await run("/assets/OwnerWorkspace.js", owner)).text(),
    "private asset",
  );
});

test("every generated activity file is explicitly shared, and middleware covers every deployed route", () => {
  const root = new URL("../public/activity-designer/", import.meta.url);
  for (const file of fs.readdirSync(root, { recursive: true })) {
    if (!fs.statSync(new URL(file, root)).isFile()) continue;
    assert(
      isSharedActivityPath("/activity-designer/" + file),
      file + " must be intentionally classified",
    );
  }
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(new URL("../public/_routes.json", import.meta.url)),
    ),
    { version: 1, include: ["/*"], exclude: [] },
  );
  const gateway = fs.readFileSync(
    new URL("../public/activity-gateway.html", import.meta.url),
    "utf8",
  );
  assert(!/<script|Full CTI|Inspect a package|Review a capture/.test(gateway));
  assert(
    gateway.includes("The complete workflow will be operational very soon."),
  );
});
