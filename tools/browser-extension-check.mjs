import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { comparisonFixture } from "../tests/workflow-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";

// Real MV3 extension + built CTI app + maintained extractor. Only the external
// Coursera service is replaced by a controlled authoring DOM/API fixture.
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "cti-extension-browser-"),
);
const extension = path.resolve("src/generated/browser-extension");
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: "chromium",
  ignoreDefaultArgs: ["--disable-extensions"],
  ...(process.env.CTI_EXTENSION_CHROMIUM_PATH
    ? { executablePath: process.env.CTI_EXTENSION_CHROMIUM_PATH }
    : {}),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    ...(process.env.CTI_EXTENSION_SINGLE_PROCESS
      ? ["--no-zygote", "--single-process", "--disable-gpu"]
      : []),
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = "https://cti-hardening.pages.dev";
const itemUrl =
  "https://www.coursera.org/teach/synthetic/course/content/item/supplement/reading";
const input = comparisonFixture(),
  output = createWorkflows(workerXml).compare(input);
output.result.ownerView.items[0].status = "EVIDENCE_NEEDED";
const audit = {
  ...input.course,
  id: "extension-audit",
  packageId: input.course.id,
  kind: "audit",
  title: "Extension refresh test",
  data: output,
};
const backup = {
  kind: "CTI_BROWSER_WORKSPACE",
  schemaVersion: 1,
  records: [input.course, audit],
};
let version = 1,
  mode = "ready";
const text = () =>
  `Fresh saved reading revision ${version}. Measurement is a comparison of a quantity against a defined unit. Review this worked example carefully and use the exact units when calculating a result. This text is captured from the specific Reading Content field, not from course navigation.`;
const csp = fs
  .readFileSync("public/_headers", "utf8")
  .split("\n")
  .find((l) => l.includes("Content-Security-Policy:"))
  .split("Content-Security-Policy: ")[1];
await context.route(origin + "/**", async (route) => {
  const u = new URL(route.request().url());
  try {
    const file = path.resolve(
      "dist",
      u.pathname === "/" ? "index.html" : "." + u.pathname,
    );
    if (!file.startsWith(path.resolve("dist") + path.sep)) throw Error("Path");
    await route.fulfill({
      body: fs.readFileSync(file),
      contentType: file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".zip")
            ? "application/zip"
            : "text/html",
      headers: { "Content-Security-Policy": csp },
    });
  } catch {
    await route.fulfill({ status: 404, body: "Not found" });
  }
});
await context.route("https://www.coursera.org/**", async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/api/authoringCourseMaterials.v1/")) {
    if (mode === "denied")
      return route.fulfill({ status: 403, body: "Forbidden" });
    return route.fulfill({
      json: {
        elements: [
          {
            id: "reading",
            name: "Reading",
            content: { typeName: "supplement" },
          },
        ],
      },
    });
  }
  if (u.pathname.startsWith("/api/"))
    return route.fulfill({ status: 404, json: {} });
  if (mode === "slow")
    await new Promise((resolve) => setTimeout(resolve, 3000));
  await route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><title>Reading</title></head><body><main><h1>Reading</h1><div contenteditable="true" role="textbox" aria-label="Reading Content" data-testid="course+reading" style="display:block;min-height:200px;padding:20px">${text()}</div></main></body></html>`,
  });
});
const workflow = async (name) =>
  page
    .getByRole("navigation", { name: "CTI workflows" })
    .getByRole("button", { name, exact: true })
    .click();
const request = (p, body) =>
  p.evaluate(
    (body) =>
      new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          window.removeEventListener("message", listener);
          reject(Error("Extension response timeout"));
        }, 15000);
        function listener(e) {
          if (
            e.source === window &&
            e.origin === location.origin &&
            e.data?.channel === "CTI_EXTENSION_RESPONSE" &&
            e.data.requestId === requestId
          ) {
            clearTimeout(timer);
            window.removeEventListener("message", listener);
            resolve(e.data.response);
          }
        }
        window.addEventListener("message", listener);
        window.postMessage(
          {
            channel: "CTI_EXTENSION_REQUEST",
            requestId,
            body: { ...body, protocol: 1 },
          },
          location.origin,
        );
      }),
    body,
  );
async function openReport() {
  await page
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(input.course.id);
  await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
  await workflow("History");
  await page.getByRole("button", { name: audit.title, exact: true }).click();
  // There is one attention item in this fixture; preserving this filter also
  // verifies that the refresh stays attached to the selected saved report.
  await page.locator(".action-card > summary").first().click();
}
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  assert(worker.url().startsWith("chrome-extension://"));
  await page.goto(origin);
  assert.equal((await request(page, { type: "PING" })).version, "1.0.0");
  await workflow("Setup");
  await page
    .getByLabel("Workspace migration or backup JSON")
    .setInputFiles({
      name: "test.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await page.getByRole("button", { name: "Import prepared records" }).click();
  await page.getByText("Imported 2 records;", { exact: false }).waitFor();
  await openReport();
  const refresh = page
    .getByRole("region", { name: "Refresh Coursera item", exact: true })
    .first();
  await refresh
    .getByText("CTI extension connected.", { exact: true })
    .waitFor();
  const editTab = await context.newPage();
  await editTab.goto(itemUrl);
  await page.bringToFront();
  await refresh
    .getByRole("button", { name: "Refresh this Coursera item", exact: true })
    .click();
  await refresh
    .getByRole("status")
    .filter({ hasText: "Refreshed" })
    .waitFor({ timeout: 90000 });
  assert(!editTab.isClosed(), "The original editing tab must remain open");
  await page
    .getByRole("region", { name: "Coursera captured content", exact: true })
    .getByText(/Fresh saved reading revision 1\./)
    .waitFor();
  for (
    let n = 0;
    n < 50 &&
    (await worker.evaluate(() => chrome.storage.session.get("ctiItemRefresh")))
      .ctiItemRefresh;
    n++
  )
    await page.waitForTimeout(100);
  assert.equal(
    (await worker.evaluate(() => chrome.storage.session.get("ctiItemRefresh")))
      .ctiItemRefresh,
    undefined,
  );
  // A second refresh really reads newly saved content, rather than replaying a
  // previous result or seeding the extractor with old payloads.
  version = 2;
  await refresh
    .getByRole("button", { name: "Refresh this Coursera item", exact: true })
    .click();
  await refresh
    .getByRole("status")
    .filter({ hasText: "Refreshed" })
    .waitFor({ timeout: 90000 });
  await page
    .getByRole("region", { name: "Coursera captured content", exact: true })
    .getByText(/Fresh saved reading revision 2\./)
    .waitFor();
  const exportEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download full evidence", exact: true })
    .click();
  const exported = JSON.parse(
    fs.readFileSync(await (await exportEvent).path(), "utf8"),
  );
  assert.deepEqual(exported.result, output.result);
  assert.equal(exported.followUp.automatedResolution, false);
  assert.match(
    JSON.stringify(exported.followUp.reviews),
    /Fresh saved reading revision 2/,
  );
  // Permission failure retains saved revision 2 and returns to CTI.
  mode = "denied";
  await refresh
    .getByRole("button", { name: "Refresh this Coursera item", exact: true })
    .click();
  await refresh
    .getByRole("alert")
    .filter({ hasText: "course structure could not be read" })
    .waitFor({ timeout: 45000 });
  await page
    .getByRole("region", { name: "Coursera captured content", exact: true })
    .getByText(/Fresh saved reading revision 2\./)
    .waitFor();
  mode = "slow";
  await refresh
    .getByRole("button", { name: "Refresh this Coursera item", exact: true })
    .click();
  await page.bringToFront();
  await refresh
    .getByRole("button", { name: "Cancel item refresh", exact: true })
    .click();
  await refresh
    .getByRole("alert")
    .filter({ hasText: /cancelled/i })
    .waitFor();
  await page
    .getByRole("region", { name: "Coursera captured content", exact: true })
    .getByText(/Fresh saved reading revision 2\./)
    .waitFor();
  // A second CTI document cannot read or cancel another tab's capture.
  const other = await context.newPage();
  await other.goto(origin);
  const id = crypto.randomUUID(),
    spec = {
      auditId: audit.id,
      courseId: "course",
      itemId: "reading",
      name: "Reading",
      url: itemUrl,
      checks: [],
    };
  assert.equal((await request(page, { type: "START", id, spec })).ok, true);
  for (const type of ["STATUS", "RESULT", "CANCEL", "ACK"])
    assert.equal((await request(other, { type, id })).ok, false);
  assert.equal(
    (await request(other, { type: "START", id: crypto.randomUUID(), spec })).ok,
    false,
  );
  const active = await worker.evaluate(() =>
    chrome.storage.session.get("ctiItemRefresh"),
  );
  await worker.evaluate(
    (id) => chrome.tabs.remove(id),
    active.ctiItemRefresh.captureTabId,
  );
  assert.equal((await request(page, { type: "STATUS", id })).state, "FAILED");
  await request(page, { type: "CANCEL", id });
  await other.close();
  await editTab.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await refresh.scrollIntoViewIfNeeded();
  fs.mkdirSync("/tmp/cti-extension-screenshots", { recursive: true });
  await page.screenshot({
    path: "/tmp/cti-extension-screenshots/refresh-mobile.png",
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        checks: [
          "actual MV3 bridge and packaged extractor",
          "new reading evidence saved after two refreshes",
          "original editing tab preserved",
          "audit unchanged and follow-up export",
          "permission failure and cancellation retain prior evidence",
          "cross-tab ownership and overlap rejection",
          "closed capture detected",
          "390px layout",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
