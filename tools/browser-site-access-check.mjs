import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { accessFixture } from "../tests/access-fixtures.mjs";
import { createSiteBoundary } from "../server/site-access.ts";
import { createApiHandler } from "../server/api.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const f = await accessFixture();
const tokens = {
  owner: await f.token("aarjun@coursera.org"),
  colleague: await f.token("colleague@coursera.org"),
};
const boundary = createSiteBoundary(f.authenticate),
  api = createApiHandler(f.authenticate);
async function asset(request) {
  let pathname = new URL(request.url).pathname;
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/activity-gateway") pathname += ".html";
  const target = path.resolve(root, "dist", "." + pathname);
  if (!target.startsWith(path.join(root, "dist") + path.sep))
    return new Response("Invalid path", { status: 400 });
  try {
    const content = fs.readFileSync(target);
    const type = /\.(js|mjs)$/.test(target)
      ? "text/javascript"
      : /\.css$/.test(target)
        ? "text/css"
        : /\.html$/.test(target)
          ? "text/html"
          : "application/octet-stream";
    return new Response(content, { headers: { "Content-Type": type } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
const env = {
  ...f.env,
  CTI_ADMINS: "aarjun@coursera.org,colleague@coursera.org",
  ASSETS: { fetch: asset },
  CTI_DB: {
    prepare() {
      throw Error("This browser check must not access shared records");
    },
  },
};
const server = http.createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    headers.delete("Cf-Access-Jwt-Assertion");
    // Test server only: this cookie chooses a real signed fixture, not an auth
    // bypass in the application. Production always receives the Access assertion.
    const persona = /(?:^|;\s*)fixture-person=(owner|colleague)(?:;|$)/.exec(
      req.headers.cookie || "",
    )?.[1];
    if (persona) headers.set("Cf-Access-Jwt-Assertion", tokens[persona]);
    const request = new Request("http://127.0.0.1:4189" + req.url, {
      headers,
      method: req.method,
    });
    const response = await boundary({
      request,
      env,
      next: () =>
        new URL(request.url).pathname.startsWith("/api/")
          ? api(request, env)
          : asset(request),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500).end("Fixture server failed");
  }
});
await new Promise((r) => server.listen(4189, "127.0.0.1", r));
const origin = "http://127.0.0.1:4189";
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CTI_CHROMIUM_PATH
      ? { executablePath: process.env.CTI_CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const colleague = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  });
  await colleague.addCookies([
    { name: "fixture-person", value: "colleague", url: origin },
  ]);
  const p = await colleague.newPage(),
    scripts = [],
    errors = [];
  p.on("request", (r) => {
    if (/\/assets\//.test(r.url())) scripts.push(r.url());
  });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(origin);
  await p
    .getByRole("link", { name: "Open Role Play & Dialogue", exact: true })
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Full CTI workspace", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(
    scripts,
    [],
    "the colleague gateway must not load any full-workspace JavaScript",
  );
  for (const privatePath of [
    "/package-runner.html",
    "/downloads/cti-browser-extension.zip",
    "/api/session",
    "/api/records",
    "/api/extraction/jobs",
  ])
    assert.equal(
      (
        await colleague.request.get(origin + privatePath, {
          headers: {
            "Cf-Access-Authenticated-User-Email": "aarjun@coursera.org",
          },
        })
      ).status(),
      403,
      privatePath,
    );
  assert.deepEqual(
    await (await colleague.request.get(origin + "/api/access")).json(),
    { fullCti: false },
  );
  const screenshots = "/tmp/cti-site-access";
  fs.mkdirSync(screenshots, { recursive: true });
  await p.screenshot({
    path: screenshots + "/colleague-desktop.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  assert(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await p.screenshot({
    path: screenshots + "/colleague-mobile.png",
    fullPage: true,
  });
  await p
    .getByRole("link", { name: "Open Role Play & Dialogue", exact: true })
    .click();
  await p
    .getByRole("heading", {
      name: "Where it belongs. What to paste.",
      exact: true,
    })
    .waitFor();
  await p.getByRole("link", { name: "CTI gateway" }).click();
  await p
    .getByRole("link", { name: "Open Role Play & Dialogue", exact: true })
    .waitFor();
  const owner = await browser.newContext();
  await owner.addCookies([
    { name: "fixture-person", value: "owner", url: origin },
  ]);
  const o = await owner.newPage();
  await o.goto(origin);
  await o
    .getByRole("button", { name: "Full CTI workspace", exact: true })
    .waitFor();
  assert.equal(
    (await owner.request.get(origin + "/package-runner.html")).status(),
    200,
  );
  assert.equal(
    (await owner.request.get(origin + "/api/session")).status(),
    200,
  );
  const privateReply = await owner.request.get(origin + "/");
  assert.equal(privateReply.headers()["cache-control"], "private, no-store");
  await o
    .getByRole("button", { name: "Inspect a package", exact: true })
    .click();
  await o.screenshot({ path: screenshots + "/owner.png", fullPage: true });
  // An already-open owner tab loses controls when its verified identity changes.
  await owner.clearCookies();
  await owner.addCookies([
    { name: "fixture-person", value: "colleague", url: origin },
  ]);
  await o.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await o
    .getByRole("button", { name: "Full CTI workspace", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    (await owner.request.get(origin + "/api/records")).status(),
    403,
  );
  const unsigned = await browser.newContext();
  assert.equal((await unsigned.request.get(origin + "/")).status(), 401);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real JWT owner/colleague gateway, no colleague owner assets, direct API/page/download denial, activity navigation, owner workflow, identity-change unmount, unsigned denial, no-store, desktop/mobile. Synthetic identities; production login is not simulated as verified.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
