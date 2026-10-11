import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { ownerAccessFixture } from "./browser-owner-fixture.mjs";

const root = path.resolve(import.meta.dirname, "..");
const server = http.createServer((req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    res.setHeader(
      "content-type",
      pathname.endsWith(".js")
        ? "text/javascript"
        : pathname.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(
      fs.readFileSync(
        root + "/dist" + (pathname === "/" ? "/index.html" : pathname),
      ),
    );
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CTI_CHROMIUM_PATH
      ? { executablePath: process.env.CTI_CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext();
  await ownerAccessFixture(context);
  await context.addInitScript(() => {
    if (/^https?:$/.test(location.protocol))
      localStorage.setItem("cti-workspace-mode", "team");
  });
  const jobs = [],
    downloads = [],
    errors = [];
  let sessionConnected = true,
    startFails = false;
  let current,
    failArtifact = false,
    artifactRequests = 0;
  const raw = JSON.stringify({
    schemaVersion: 35,
    page: { courseId: "Course_id_123" },
    meta: { captureAccounting: { complete: false, unvisitedCount: 2 } },
    fingerprints: [],
  });
  await context.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/access")
      return route.fulfill({ json: { fullCti: true } });
    if (pathname === "/api/session")
      return route.fulfill({
        json: { role: "admin", email: "synthetic@example.test" },
      });
    if (pathname === "/api/records")
      return route.fulfill({ json: { records: [] } });
    if (pathname === "/api/extraction/session")
      return route.fulfill({
        json: {
          connected: sessionConnected,
          connectedAt: "2026-10-11T00:00:00Z",
          verifiedCourseId: "Course_id_123",
        },
      });
    if (pathname === "/api/extraction/jobs") {
      if (route.request().method() === "POST") {
        if (startFails)
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic startup failure" },
          });
        current = {
          id: "synthetic-job-" + jobs.length,
          kind: "extraction",
          state: "QUEUED",
          courseId: "Course_id_123",
          shellUrl:
            "https://www.coursera.org/teach/synthetic/Course_id_123/content/edit",
          createdAt: "2026-10-11T00:00:00Z",
          updatedAt: "2026-10-11T00:00:00Z",
          artifactAvailable: false,
        };
        jobs.unshift(current);
        return route.fulfill({ json: { status: current } });
      }
      return route.fulfill({ json: { statuses: jobs } });
    }
    if (pathname.endsWith("/artifact")) {
      artifactRequests++;
      if (failArtifact)
        return route.fulfill({
          status: 503,
          json: { error: "temporary artifact failure" },
        });
      return route.fulfill({
        body: raw,
        contentType: "application/json",
        headers: {
          "Content-Disposition": 'attachment; filename="final-synthetic.json"',
        },
      });
    }
    if (pathname.startsWith("/api/extraction/jobs/")) {
      const id = pathname.split("/").at(-1);
      return route.fulfill({
        json: { status: jobs.find((job) => job.id === id) },
      });
    }
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.on("download", (download) => downloads.push(download));
  page.on("pageerror", (error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  const open = async () => {
    await page.goto(base);
    await page
      .getByRole("navigation", { name: "CTI workflows" })
      .getByRole("button", { name: "Extract", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Automatic full-course capture" })
      .waitFor();
  };
  const start = async () => {
    await page
      .getByLabel("Coursera authoring-shell URL", { exact: true })
      .first()
      .fill(
        "https://www.coursera.org/teach/synthetic/Course_id_123/content/edit",
      );
    await page
      .getByRole("button", { name: "Start full-course capture", exact: true })
      .click();
    await page.getByText("QUEUED", { exact: true }).first().waitFor();
  };
  await open();
  await start();
  // A browser chunk may already have a raw checkpoint; it must not be downloaded.
  current.state = "RUNNING";
  current.phase = "Automatically continuing saved work";
  current.artifactAvailable = true;
  await page.getByText(current.phase, { exact: true }).waitFor();
  current.state = "VERIFYING";
  current.phase = "Checking final evidence";
  await page.getByText(current.phase, { exact: true }).waitFor();
  assert.equal(downloads.length, 0);
  assert.equal(artifactRequests, 0);
  const firstDownload = page.waitForEvent("download");
  current.state = "INCOMPLETE";
  current.capture = {
    complete: false,
    inventoryCount: 3,
    completeCount: 1,
    unresolvedCount: 2,
    unvisitedCount: 2,
    reasons: ["ITEM_NOT_VISITED:synthetic-reading"],
  };
  const file = await firstDownload;
  assert.equal(fs.readFileSync(await file.path(), "utf8"), raw);
  await page.getByRole("heading", { name: "Not certified complete" }).waitFor();
  await page
    .getByText("ITEM_NOT_VISITED:synthetic-reading", { exact: true })
    .waitFor();
  await page
    .getByText("Final JSON download requested.", { exact: false })
    .waitFor();
  await open();
  await page
    .getByRole("link", { name: "Download final capture JSON", exact: true })
    .waitFor();
  assert.equal(downloads.length, 1);
  assert.equal(artifactRequests, 1);

  // Closing the view while running must preserve the final download intent.
  await start();
  current.state = "RUNNING";
  await page.goto("about:blank");
  current.state = "COMPLETE";
  current.artifactAvailable = true;
  const reopenedDownload = page.waitForEvent("download");
  await open();
  await reopenedDownload;
  await page
    .getByText("Final JSON download requested.", { exact: false })
    .waitFor();
  assert.equal(downloads.length, 2);

  // A failed artifact fetch is visible and retryable after reopening CTI.
  await start();
  failArtifact = true;
  current.state = "FAILED";
  current.artifactAvailable = true;
  current.error = "Synthetic browser failure";
  await page
    .getByRole("alert")
    .filter({ hasText: "Automatic final download failed" })
    .waitFor();
  assert.equal(downloads.length, 2);
  failArtifact = false;
  const retriedDownload = page.waitForEvent("download");
  await open();
  await retriedDownload;
  await page
    .getByText("Final JSON download requested.", { exact: false })
    .waitFor();
  assert.equal(downloads.length, 3);
  // Failed startup must close the temporary blank SSO window as well.
  sessionConnected = false;
  startFails = true;
  await open();
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByLabel("Coursera authoring-shell URL", { exact: true })
    .first()
    .fill(
      "https://www.coursera.org/teach/synthetic/Course_id_123/content/edit",
    );
  await page
    .getByRole("button", { name: "Start full-course capture", exact: true })
    .click();
  const popup = await popupPromise;
  await page
    .getByRole("alert")
    .filter({ hasText: "Synthetic startup failure" })
    .waitFor();
  assert.equal(popup.isClosed(), true);
  assert.equal(downloads.length, 3);
  assert.equal(jobs.length, 3);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "PASS",
      checks: [
        "website-only start",
        "no interim downloads",
        "final JSON preserves evidence gaps",
        "one download across reloads",
        "capture finishes while CTI is closed",
        "failed artifact fetch retries on reopen",
      ],
      downloads: downloads.length,
    }),
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
