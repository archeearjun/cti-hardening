import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { comparisonFixture } from "../tests/workflow-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { startExtensionFixture } from "./extension-fixture-server.mjs";

// Real MV3 extension + built CTI app + maintained extractor. Only the external
// Coursera service is replaced by a controlled authoring DOM/API fixture.
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "cti-extension-browser-"),
);
const extension = path.resolve("src/generated/browser-extension");
const state = { version: 1, mode: "ready" };
const fixture = await startExtensionFixture(profile, state);
const context = await chromium
  .launchPersistentContext(profile, {
    proxy: { server: fixture.proxy },
    ignoreHTTPSErrors: true,
    headless: true,
    channel: "chromium",
    ignoreDefaultArgs: ["--disable-extensions"],
    ...(process.env.CTI_EXTENSION_CHROMIUM_PATH
      ? { executablePath: process.env.CTI_EXTENSION_CHROMIUM_PATH }
      : {}),
    args: [
      "--no-sandbox",
      // Test-only TLS certificate; the proxy rejects all non-fixture origins.
      "--ignore-certificate-errors",
      "--disable-dev-shm-usage",
      ...(process.env.CTI_EXTENSION_SINGLE_PROCESS
        ? ["--no-zygote", "--single-process", "--disable-gpu"]
        : []),
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  })
  .catch(async (error) => {
    await fixture.close();
    fs.rmSync(profile, { recursive: true, force: true });
    throw error;
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
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
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
  state.version = 2;
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
  state.mode = "denied";
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
  state.mode = "slow";
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
} catch (error) {
  // This test uses synthetic pages only; retain bounded diagnostics rather
  // than concealing an extension or extractor failure behind a UI timeout.
  console.error(
    "CTI refresh UI:",
    await page.locator(".item-refresh").allTextContents(),
  );
  for (const p of context.pages()) {
    console.error(
      "Capture state:",
      await p
        .evaluate(() => {
          const j = window.__CTI_EXTENSION_JOB;
          return {
            url: location.href,
            visibility: document.visibilityState,
            state: j?.state,
            phase: j?.phase,
            detail: j?.detail,
            error: j?.error,
            result: j?.result?.slice(0, 3000),
          };
        })
        .catch(() => "page unavailable"),
    );
  }
  throw error;
} finally {
  await context.close();
  await fixture.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
