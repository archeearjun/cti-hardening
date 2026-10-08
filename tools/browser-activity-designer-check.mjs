import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import JSZip from "jszip";
import {
  captureFixture,
  pdfFixture,
} from "../tests/activity-designer-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const policy = fs
  .readFileSync(path.join(root, "public/_headers"), "utf8")
  .split("\n")
  .find((x) => x.includes("Content-Security-Policy:"))
  .split("Content-Security-Policy: ")[1];
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const target = path.resolve(
    root,
    "dist",
    "." + (pathname === "/" ? "/index.html" : pathname),
  );
  if (!target.startsWith(path.join(root, "dist") + path.sep)) {
    res.writeHead(400).end();
    return;
  }
  try {
    const body = fs.readFileSync(target);
    res.writeHead(200, {
      "content-type": /\.(js|mjs)$/.test(target)
        ? "text/javascript"
        : target.endsWith(".css")
          ? "text/css"
          : "text/html",
      "Content-Security-Policy": policy,
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(4188, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CTI_CHROMIUM_PATH
      ? { executablePath: process.env.CTI_CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method() }),
  );
  await page.goto("http://127.0.0.1:4188/");
  assert.equal(
    await page
      .getByText("The complete workflow will be operational very soon.", {
        exact: true,
      })
      .count(),
    1,
  );
  await page
    .getByRole("link", { name: "Open Role Play & Dialogue", exact: true })
    .click();
  await page.waitForFunction(
    () => !!globalThis.CoursePrepUI && !!globalThis.CoursePackets,
  );
  const upload = async (name, value) =>
    page.locator("#file-input").setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
  await page.locator("#file-input").setInputFiles([
    {
      name: "capture.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(captureFixture())),
    },
    {
      name: "instructions.pdf",
      mimeType: "application/pdf",
      buffer: pdfFixture(),
    },
  ]);
  await page.locator("#process").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#progress-label").textContent ===
      "Preparation complete",
  );
  const snapshot = await page.evaluate(() => CoursePrepUI.getSession());
  assert(
    snapshot.references.some(
      (r) =>
        r.filename === "instructions.pdf" &&
        r.text.includes("Assignment instructions"),
    ),
    JSON.stringify({
      references: snapshot.references,
      issues: snapshot.issues,
    }),
  );
  const packet = await page.evaluate(() => CoursePackets.getModel().packets[0]);
  assert.equal(packet.data.structure.length, 2);
  assert.equal(
    packet.data.structure[0].module.lessons[0].items[1].assessment_capture
      .options_captured,
    1,
  );
  assert(
    (await page.locator("#packet-chat-message").inputValue()).includes(
      "ACTIVITY_RESULTS.json",
    ),
  );
  await page
    .locator("#packet-modules")
    .locator("..")
    .locator("summary")
    .click();
  await page.locator("#module-search").fill("second");
  assert.equal(await page.locator("#packet-modules label:visible").count(), 1);
  await page.locator("#module-search").fill("");
  // Invalid new files leave the last successful prepared evidence available.
  await page.locator("#file-input").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await page.locator("#process").click();
  await page.locator("#error").waitFor({ state: "visible" });
  assert.equal(
    (await page.evaluate(() => CoursePrepUI.getSession())).created_at,
    snapshot.created_at,
  );
  await page
    .getByRole("button", { name: "Remove broken.json", exact: true })
    .click();
  const result = await page.evaluate(() => {
    const s = CoursePrepUI.getSession(),
      r = structuredClone(ActivityDesigner.template),
      a = r.activities[0];
    Object.assign(r, {
      title: s.title,
      bundle_created_at: s.created_at,
      mode: s.phase,
    });
    a.type = "dialogue";
    a.title = "Explain the units";
    a.fields = ActivityDesigner.required.dialogue.map((label) => ({
      label,
      text:
        label === "Title"
          ? a.title
          : "Review the unit choice through observable explanations. " + label,
    }));
    a.context = { text: "", filename: "" };
    a.checks = [];
    a.placement = {
      course: s.title,
      module: "First module",
      lesson: "Lesson",
      after: "Teaching",
      before: "Quiz",
      branch_id: "b1",
      module_id: "m1",
      lesson_id: "l1",
      after_item_id: "i1",
      before_item_id: "i2",
      row: null,
      export_file: "",
      notes: "",
    };
    a.evidence = [{ source_path: "coursera/b1/i1", locator: "item i1" }];
    r.module_decisions = [
      {
        course: s.title,
        module: "First module",
        branch_id: "b1",
        module_id: "m1",
        decision: "dialogue",
        reason: "Explain the choice.",
      },
    ];
    return r;
  });
  await page.locator("#nav-activities").click();
  await page.locator("#paste-result summary").click();
  await page.locator("#result-json").fill(JSON.stringify(result));
  await page.locator("#import-result").click();
  await page
    .getByRole("heading", { name: "Explain the units", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Open preceding Coursera item" })
      .getAttribute("href"),
    captureFixture().items[0].route,
  );
  const stale = { ...result, bundle_created_at: "2020-01-01T00:00:00Z" };
  await page.locator("#result-json").fill(JSON.stringify(stale));
  await page.locator("#import-result").click();
  assert(
    (await page.locator("#result-error").innerText()).includes(
      "previous cards are unchanged",
    ),
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Explain the units", exact: true })
      .count(),
    1,
  );
  // A second packet accumulates without replacing the first module.
  const next = {
    ...result,
    activities: [],
    module_decisions: [
      {
        course: snapshot.title,
        module: "Second module",
        branch_id: "b1",
        module_id: "m2",
        decision: "hold",
        reason: "Teaching is unread.",
      },
    ],
  };
  await page.locator("#result-json").fill(JSON.stringify(next));
  await page.locator("#import-result").click();
  assert.equal(
    await page.locator("#module-decisions .module-decision").count(),
    2,
  );
  await page.locator("#save-results").click();
  const workLink = page.getByRole("link", {
    name: "Save Course_Activity_Designer_Work.zip",
    exact: true,
  });
  await workLink.waitFor();
  const downloadWait = page.waitForEvent("download");
  await workLink.click();
  const download = await downloadWait;
  const bytes = fs.readFileSync(await download.path()),
    zip = await JSZip.loadAsync(bytes);
  assert(zip.file("SESSION.json"));
  assert.equal(
    JSON.parse(await zip.file("ACTIVITY_RESULTS.json").async("string"))
      .module_decisions.length,
    2,
  );
  // Restore the complete saved session and cards in a new tab.
  const restored = await context.newPage();
  await restored.goto(page.url());
  await restored.waitForFunction(() => !!globalThis.CoursePrepUI);
  await restored.locator("#nav-activities").click();
  await restored.locator("#result-file").setInputFiles({
    name: "work.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await restored
    .getByRole("heading", { name: "Explain the units", exact: true })
    .waitFor();
  assert.equal(
    (await restored.evaluate(() => CoursePrepUI.getSession())).created_at,
    snapshot.created_at,
  );
  // A well-formed ZIP with invalid module decisions must not replace either state.
  const badSession = structuredClone(snapshot);
  badSession.title = "Another saved course";
  badSession.created_at = "2026-10-08T17:00:00.000Z";
  const badResult = structuredClone(result);
  badResult.title = badSession.title;
  badResult.bundle_created_at = badSession.created_at;
  badResult.module_decisions[0].module_id = "not-in-this-snapshot";
  const badZip = new JSZip();
  badZip.file("SESSION.json", JSON.stringify(badSession));
  badZip.file("ACTIVITY_RESULTS.json", JSON.stringify(badResult));
  await restored.locator("#result-file").setInputFiles({
    name: "invalid-work.zip",
    mimeType: "application/zip",
    buffer: await badZip.generateAsync({ type: "nodebuffer" }),
  });
  await restored.locator("#result-error").waitFor({ state: "visible" });
  assert.equal(
    (await restored.evaluate(() => CoursePrepUI.getSession())).created_at,
    snapshot.created_at,
  );
  assert.equal(
    await restored.locator("#module-decisions .module-decision").count(),
    2,
  );
  // Return to the valid view for the screenshots.
  await restored.locator("#result-file").setInputFiles({
    name: "work.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await restored.locator("#result-error").waitFor({ state: "hidden" });
  // Incorrect placement is visible, with copy disabled; literal HTML stays text.
  const bad = structuredClone(result);
  bad.activities[0].placement.before_item_id = "wrong";
  bad.activities[0].fields[1].text =
    "<img src=x onerror=alert(1)> Literal evidence";
  await page.locator("#result-json").fill(JSON.stringify(bad));
  await page.locator("#import-result").click();
  assert.equal(
    await page
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.locator("#activity-cards img").count(), 0);
  assert.equal(await page.locator("#activity-cards button:enabled").count(), 0);
  const screenshots = "/tmp/cti-activity-screenshots";
  fs.mkdirSync(screenshots, { recursive: true });
  await restored.screenshot({
    path: path.join(screenshots, "desktop.png"),
    fullPage: true,
  });
  await restored.setViewportSize({ width: 390, height: 844 });
  assert(
    await restored.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await restored.screenshot({
    path: path.join(screenshots, "mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert(
    requests
      .filter((r) => r.url.includes("/activity-designer/"))
      .every((r) => r.method === "GET"),
  );
  assert(!requests.some((r) => /openai|gemini|coursera\.org/.test(r.url)));
  console.log(
    "PASS: gateway, strict CSP, bulk import, packet metrics/search, failed preparation recovery, stale/wrong placement, packet merging, ZIP save/restore, literal rendering, desktop/mobile. Synthetic course; no live Coursera verification.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
