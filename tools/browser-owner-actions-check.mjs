import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import path from "node:path";
import JSZip from "jszip";
import { digest } from "../src/domain/workspace-store.ts";
import {
  buildOwnerTasks,
  buildOwnerContext,
} from "../src/domain/owner-actions.ts";
import { chromium } from "playwright";
import { comparisonFixture } from "../tests/workflow-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
const root = path.resolve(".");
const policy = fs
  .readFileSync(root + "/public/_headers", "utf8")
  .split("\n")
  .find((l) => l.includes("Content-Security-Policy:"))
  .split("Content-Security-Policy: ")[1];
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  try {
    const content = fs.readFileSync(
      root + "/dist" + (p === "/" ? "/index.html" : p),
    );
    res.writeHead(200, {
      "content-type": p.endsWith(".js")
        ? "text/javascript"
        : p.endsWith(".css")
          ? "text/css"
          : "text/html",
      "Content-Security-Policy": policy,
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4177, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CTI_CHROMIUM_PATH
    ? { executablePath: process.env.CTI_CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const input = comparisonFixture();
const sourceBytes = new TextEncoder().encode(
  "Synthetic source file for exact retrieval.",
);
const zip = new JSZip();
zip.file("files/guide.txt", sourceBytes);
const archiveBytes = await zip.generateAsync({ type: "uint8array" });
input.course.data.scan.fileSha256 = await digest(archiveBytes);
input.course.data.scan.courseTree[0].children[0].sourcePayload.files = [
  {
    name: "guide.txt",
    path: "files/guide.txt",
    presentInPackage: true,
    sha256: await digest(sourceBytes),
  },
];
const output = createWorkflows(workerXml).compare(input);
output.ownerContext = buildOwnerContext(
  new TextEncoder().encode(
    JSON.stringify({
      page: {
        url: "https://lms.example.test/d2l/ui/apps/smart-curriculum/v/index.html",
      },
      course: { orgUnitId: "123" },
      contentTree: [
        {
          title: "Module 1",
          children: [
            {
              title: "Assess",
              children: [
                {
                  kind: "TOPIC",
                  id: "10",
                  title: "Reading",
                  url: "/reading.html",
                },
              ],
            },
          ],
        },
        {
          title: "Archive",
          children: [
            { kind: "TOPIC", id: "11", title: "Reading", url: "/archive.html" },
          ],
        },
      ],
    }),
  ),
);
const item = output.result.ownerView.items[0];
item.pluginTargets = ["https://external.example/course/#/"];
item.status = "EVIDENCE_NEEDED";
item.actions = [
  {
    action: "Check whether the source guide opens from this reading.",
    severity: "EVIDENCE",
    verdict: "UNVERIFIED",
  },
];
output.result.itemResults[0].checks.links.missing = [
  "https://example.test/guide",
];
const audit = {
  ...input.course,
  id: "owner-action-audit",
  kind: "audit",
  packageId: input.course.id,
  title: "Owner action test",
  data: output,
};
const backup = {
  kind: "CTI_BROWSER_WORKSPACE",
  schemaVersion: 1,
  records: [input.course, audit],
};
const tab = async (name) =>
  page
    .getByRole("navigation", { name: "CTI workflows" })
    .getByRole("button", { name, exact: true })
    .click();
const openAudit = async () => {
  await page.getByLabel("Selected source course").selectOption(input.course.id);
  await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
  await tab("History");
  await page.getByRole("button", { name: audit.title, exact: true }).click();
  await page
    .getByRole("heading", { name: "Coursera content view", exact: true })
    .waitFor();
};
const capture = {
  kind: "CTI_COURSERA_ITEM_CHECK",
  schemaVersion: 1,
  notForCourseAudit: true,
  auditId: audit.id,
  itemId: "reading",
  courseId: "course",
  openedUrl:
    "https://www.coursera.org/teach/synthetic/course/content/edit?itemId=reading",
  expectations: buildOwnerTasks(
    output.result,
    input.course.data.scan.courseTree,
  )[0].checks,
  finishedAt: new Date().toISOString(),
  editorObserved: true,
  payload: {
    textSample: "Fresh reading content",
    links: ["https://example.test/guide"],
  },
};
const shots = process.env.CTI_OWNER_SCREENSHOTS || "/tmp/cti-owner-actions";
fs.mkdirSync(shots, { recursive: true });
try {
  await page.goto("http://127.0.0.1:4177");
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "synthetic.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole("button", { name: "Import prepared records" }).click();
  await page.getByText("Imported 2 records;", { exact: false }).waitFor();
  await openAudit();
  assert.equal(await page.locator(".action-card").count(), 1);
  assert.match(
    await page
      .getByRole("link", { name: "Open item", exact: false })
      .getAttribute("href"),
    /itemId=reading/,
  );
  await page.locator(".action-card > summary").click();
  assert.equal(
    await page
      .getByRole("link", { name: "Open source item", exact: false })
      .getAttribute("href"),
    "https://lms.example.test/d2l/le/content/123/viewContent/10/View",
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Open source course", exact: false })
      .getAttribute("href"),
    "https://lms.example.test/d2l/home/123",
  );
  await page
    .getByRole("button", { name: "Copy page capture script", exact: true })
    .click();
  const pluginScript = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  new Function(pluginScript);
  const pluginSpec = JSON.parse(
    pluginScript.match(/const spec=(.*?);console\.info/)[1],
  );
  const pluginCheck = {
    ...pluginSpec,
    kind: "CTI_PLUGIN_PAGE_CHECK",
    schemaVersion: 1,
    notForCourseAudit: true,
    openedUrl: pluginSpec.targetUrl,
    finishedAt: new Date().toISOString(),
    text: "A captured visible screen.",
    references: [],
    frames: [],
    captureContext: "DIRECT_PAGE",
    status: "VISIBLE_SCREEN_OBSERVED",
  };
  await page
    .getByLabel("Upload plugin-page check JSON")
    .setInputFiles({
      name: "plugin.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(pluginCheck)),
    });
  await page
    .getByText("Page evidence saved with this item.", { exact: false })
    .waitFor();
  await page
    .getByText("Retrieve files from the original IMSCC", { exact: true })
    .click();
  await page.getByLabel("Original IMSCC for source files").setInputFiles({
    name: "wrong.imscc",
    mimeType: "application/zip",
    buffer: Buffer.from("wrong package"),
  });
  await page.getByText("Source file locations (1)", { exact: true }).click();
  await page
    .getByRole("button", { name: "Get source file", exact: true })
    .click();
  await page
    .getByText("That package does not match this saved source scan.", {
      exact: false,
    })
    .waitFor();
  await page.getByLabel("Original IMSCC for source files").setInputFiles({
    name: "original.imscc",
    mimeType: "application/zip",
    buffer: Buffer.from(archiveBytes),
  });
  const sourceDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Get source file", exact: true })
    .click();
  assert.deepEqual(
    new Uint8Array(fs.readFileSync(await (await sourceDownload).path())),
    sourceBytes,
  );
  await page
    .getByRole("button", { name: "Copy this item’s current check", exact: true })
    .click();
  await page
    .getByText("Current v6.15.8 item check copied.", { exact: false })
    .waitFor();
  const script = await page.evaluate(() => navigator.clipboard.readText());
  assert(script.includes("owner-action-audit"));
  assert(script.includes("notForCourseAudit:true"));
  new Function(script);
  await page.getByLabel("Upload this item’s check JSON").setInputFiles({
    name: "wrong.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...capture, itemId: "wrong" })),
  });
  await page
    .getByRole("alert")
    .filter({ hasText: "another report, course, or item" })
    .waitFor();
  await page.getByLabel("Upload this item’s check JSON").setInputFiles({
    name: "item.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(capture)),
  });
  await page
    .getByText("Fresh item evidence saved.", { exact: false })
    .waitFor();
  assert(
    await page
      .getByText("Observed: Source link not observed", { exact: false })
      .count(),
  );
  await page.getByLabel("Item outcome").selectOption("checked");
  await page.getByRole("button", { name: "Save item outcome" }).click();
  await page.getByRole("alert").filter({ hasText: "short note" }).waitFor();
  await page
    .getByLabel("What did you check or change?")
    .fill("Confirmed source guide opens in the learner preview.");
  await page.getByRole("button", { name: "Save item outcome" }).click();
  await page
    .getByRole("button", { name: "Checked by you (1)", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Checked by you (1)", exact: true })
    .click();
  await page.locator(".action-card > summary").click();
  await page.getByLabel("What did you check or change?").waitFor();
  await page
    .getByRole("heading", { name: "Coursera content view", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "owner-desktop.png"),
    fullPage: false,
  });
  await page.reload();
  await openAudit();
  await page
    .getByRole("button", { name: "Checked by you (1)", exact: true })
    .click();
  await page.locator(".action-card > summary").click();
  await page.getByText("Fresh item check ·", { exact: false }).waitFor();
  await page.getByText("Captured page ·", { exact: false }).waitFor();
  assert.match(
    await page.getByLabel("What did you check or change?").inputValue(),
    /Confirmed source guide/,
  );
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download full evidence", exact: true })
    .click();
  const data = JSON.parse(fs.readFileSync(await (await event).path(), "utf8"));
  assert.deepEqual(
    data.result,
    output.result,
    "Item work must never rewrite the original QA result",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile overflow",
  );
  await page
    .getByRole("heading", { name: "Coursera content view", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "owner-mobile.png"),
    fullPage: false,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        checks: [
          "action-first filtering and exact item links",
          "production bundle generates a valid canonical item script",
          "wrong-item upload rejected",
          "wrong source package rejected and exact source file downloaded",
          "fresh item check persisted",
          "completion note required",
          "outcomes and payload survive reload",
          "original audit immutable",
          "390px layout",
        ],
        screenshots: shots,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server.close();
}
