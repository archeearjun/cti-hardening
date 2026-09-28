import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { comparisonFixture, masterRows } from "../tests/workflow-fixtures.mjs";
import { migrationTextInfo } from "../src/domain/migration-files.ts";
import { writeWorkbook } from "../src/adapters/workbook.ts";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = fs
  .readFileSync(root + "/public/_headers", "utf8")
  .split("\n")
  .find((l) => l.includes("Content-Security-Policy:"))
  .split("Content-Security-Policy: ")[1];
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end('{"error":"Shared workspace setup is incomplete."}');
    return;
  }
  try {
    const f = root + "/dist" + (pathname === "/" ? "/index.html" : pathname);
    res.writeHead(200, {
      "content-type": /\.(js|mjs)$/.test(pathname)
        ? "text/javascript"
        : pathname.endsWith(".css")
          ? "text/css"
          : "text/html",
      "Content-Security-Policy": policy,
    });
    res.end(fs.readFileSync(f));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4176, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CTI_CHROMIUM_PATH
    ? { executablePath: process.env.CTI_CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = "http://127.0.0.1:4176";
const input = comparisonFixture(),
  backup = {
    kind: "CTI_BROWSER_WORKSPACE",
    schemaVersion: 1,
    records: [input.course],
  };
async function tab(name, p = page) {
  await p
    .getByRole("navigation", { name: "CTI workflows" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function waitIdle(p = page) {
  await p.locator(".full-workspace .status").waitFor({ state: "hidden" });
}
// Synthetic records only. This verifies navigation and input isolation, not course completeness.
const courses = Array.from({ length: 62 }, (_, i) => ({
  ...structuredClone(input.course),
  id: crypto.randomUUID(),
  title: `Course ${String(i + 1).padStart(3, "0")} · Source evidence (synthetic)`,
  data: {
    ...structuredClone(input.course.data),
    partner: i % 2 ? "Partner B" : "Partner A",
    owner: i % 3 ? "Review team" : "Assignment owner",
    status: i % 4 ? "In Queue" : "QA Review",
  },
}));
const workflows = createWorkflows(workerXml);
const audited = workflows.compare({ ...input, course: courses[0] });
audited.result.ownerView.items[1].status = "EVIDENCE_NEEDED";
audited.result.ownerView.items[1].actions = [
  {
    sourceName: "Discussion",
    verdict: "UNVERIFIED",
    severity: "EVIDENCE",
    action: "Confirm the captured prompt (synthetic).",
  },
];
audited.result.ownerView.unmappedSource = [
  {
    name: "External interaction (synthetic)",
    path: "Module 2",
    verdict: "HIDDEN_DEPENDENCY_REVIEW",
    action: "Review the runtime carrier before adding another item.",
  },
];
const audit = {
  ...structuredClone(input.course),
  id: "ux-audit",
  kind: "audit",
  packageId: courses[0].id,
  title: "Saved owner review (synthetic)",
  data: audited,
};
const master = workflows.execute({
  kind: "macmillan-scan",
  name: "Master A.xlsx",
  bytes: writeWorkbook({
    name: "Master A",
    sheets: { Sheet1: { values: masterRows } },
  }),
});
const books = ["A", "B"].map((name) => ({
  ...structuredClone(input.course),
  kind: "workbook",
  id: `ux-book-${name}`,
  title: `Master ${name}.xlsx`,
  data: {
    book: { ...structuredClone(master.book), name: `Master ${name}.xlsx` },
    masterResult: master.result,
  },
}));
const afterAudit = {
  ...structuredClone(audit),
  id: "ux-after-audit",
  title: "Later ingestion review (synthetic)",
  data: { ...structuredClone(audited), generation: 2 },
};
backup.records = [...courses, audit, afterAudit, ...books];
const capturePath = process.env.CTI_UX_SCREENSHOTS || "/tmp/cti-ux-screenshots";
fs.mkdirSync(capturePath, { recursive: true });
const shot = async (name) => {
  await page.screenshot({
    path: path.join(capturePath, `${name}.png`),
    fullPage: false,
  });
};
try {
  await page.goto(base);
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "synthetic-ux.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByText("66 records prepared.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Import prepared records" }).click();
  await page.getByText("Imported 66 records;", { exact: false }).waitFor();
  await tab("Catalogue");
  assert.equal(await page.locator(".table-wrap tbody tr").count(), 25);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByText("Page 2 of 3", { exact: true }).waitFor();
  await page.getByLabel("Find a course", { exact: true }).fill("Course 062");
  assert.equal(await page.locator(".table-wrap tbody tr").count(), 1);
  await page.getByLabel("Find a course", { exact: true }).fill("");
  await page.getByLabel("Filter by partner").selectOption("Partner B");
  await page.getByText("31 of 62 courses", { exact: true }).waitFor();
  await page.getByLabel("Filter by status").selectOption("QA Review");
  await page
    .getByText("No courses match your filters.", { exact: false })
    .waitFor();
  await page.getByLabel("Filter by partner").selectOption("");
  await page.getByLabel("Filter by status").selectOption("");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("catalogue-desktop");
  await page
    .getByRole("button", { name: courses[0].title, exact: true })
    .click();
  await waitIdle();
  await page.getByRole("heading", { name: "Explore what is inside" }).waitFor();
  await page.getByLabel("Find source content").fill("Reading");
  assert.equal(await page.locator(".source-items > details").count(), 1);
  assert.equal(
    await page.locator(".source-explorer .evidence-json").count(),
    0,
    "Closed evidence should not be formatted yet",
  );
  await page.locator(".source-items > details > summary").click();
  assert(
    (await page.locator(".source-items").innerText()).includes(
      "Learning about quantities",
    ),
  );
  await page.getByText("Full entry evidence", { exact: true }).click();
  await page.locator(".source-items .evidence-json").waitFor();
  await page.getByText("Full entry evidence", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("source-desktop");
  await tab("Compare");
  const file = {
    name: "old-course.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(input.excel.bytes),
  };
  const capture = {
    name: "old-course.json",
    mimeType: "application/json",
    buffer: Buffer.from(input.json.bytes),
  };
  await page.getByLabel("Coursera XLSX (required)").setInputFiles(file);
  for (const label of [
    "Coursera full capture JSON",
    "Brightspace source JSON",
    "Supplemental reading recovery JSON",
  ])
    await page.getByLabel(label).setInputFiles(capture);
  await page.getByLabel("Snapshot stage").selectOption("raw");
  await page.getByLabel("Ingestion generation").fill("3");
  await page
    .getByLabel("Smart Ingestion capability")
    .selectOption("LATEST_APPLIED");
  await page.getByLabel("Selected source course").selectOption(courses[1].id);
  await waitIdle();
  assert.equal(
    await page
      .getByLabel("Coursera XLSX (required)")
      .evaluate((e) => e.files.length),
    0,
  );
  assert.equal(
    await page
      .getByLabel("Coursera full capture JSON")
      .evaluate((e) => e.files.length),
    0,
  );
  assert.equal(await page.locator(".selected-file").count(), 0);
  assert(
    await page
      .getByRole("button", { name: "Run and save full comparison" })
      .isDisabled(),
  );
  assert.equal(await page.getByLabel("Snapshot stage").inputValue(), "ops");
  assert.equal(await page.getByLabel("Ingestion generation").inputValue(), "0");
  assert.equal(
    await page.getByLabel("Smart Ingestion capability").inputValue(),
    "UNKNOWN",
  );
  await page.getByLabel("Selected source course").selectOption(courses[0].id);
  await waitIdle();
  await tab("History");
  await page.getByRole("button", { name: audit.title, exact: true }).click();
  await waitIdle();
  await page
    .getByRole("heading", { name: "Assignment owner report", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("heading", { name: "Assignment owner report", exact: true })
      .evaluate((e) => document.activeElement === e),
  );
  await page.getByLabel("Finding status").selectOption("EVIDENCE_NEEDED");
  assert.equal(await page.locator(".outline-item").count(), 1);
  assert(
    (await page.locator(".outline-item").innerText()).includes("Discussion"),
  );
  await page
    .getByText("External interaction (synthetic)", { exact: true })
    .waitFor();
  await page.locator(".outline-item > summary").click();
  await page
    .getByText("Confirm the captured prompt (synthetic).", { exact: false })
    .waitFor();
  await page
    .getByRole("heading", { name: "Assignment owner report", exact: true })
    .scrollIntoViewIfNeeded();
  await shot("owner-report-desktop");
  await page.getByLabel("Find an item or action").fill("nonexistent");
  assert.equal(await page.locator(".outline-item").count(), 0);
  await page
    .getByText("External interaction (synthetic)", { exact: true })
    .waitFor();
  const evidence = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download full evidence", exact: true })
    .click();
  const downloaded = JSON.parse(
    fs.readFileSync(await (await evidence).path(), "utf8"),
  );
  assert.equal(
    downloaded.result.ownerView.items.length,
    2,
    "Filters must not reduce evidence exports",
  );
  assert.equal(downloaded.result.ownerView.unmappedSource.length, 1);
  await page.getByLabel(/^Before/).selectOption(audit.id);
  await page.getByLabel(/^After/).selectOption(afterAudit.id);
  await page
    .getByRole("button", { name: "Compare snapshots", exact: true })
    .click();
  await waitIdle();
  await page
    .getByRole("button", { name: "Download comparison", exact: true })
    .waitFor();
  assert((await page.locator(".table-wrap").innerText()).includes("Reading"));
  await tab("Analytics");
  assert.equal(
    await page
      .getByRole("button", { name: "Download analytics", exact: true })
      .count(),
    0,
    "Lifecycle output must not appear as portfolio analytics",
  );
  await tab("Work queue");
  await page.getByLabel("Original IMSCC rescanned").check();
  await page
    .getByText("1 of 10 workflow steps checked", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Save checklist", exact: true })
    .click();
  await waitIdle();
  await page.getByLabel("Find queued course").fill("Course 002");
  await page
    .getByRole("button", { name: courses[1].title, exact: true })
    .click();
  await waitIdle();
  assert.equal(
    await page.getByLabel("Selected source course").inputValue(),
    courses[1].id,
  );
  assert.equal(
    await page.getByLabel("Original IMSCC rescanned").isChecked(),
    false,
  );
  await tab("Macmillan");
  await page.getByLabel("Resume saved workbook").selectOption(books[0].id);
  await waitIdle();
  await page.getByLabel("Row 4: Ch 1: Quantities").check();
  await page.getByLabel(/^Stage/).selectOption("Merged");
  await page.getByLabel("Output XLSX to validate").setInputFiles(file);
  await page.getByLabel("Resume saved workbook").selectOption(books[1].id);
  await waitIdle();
  assert.equal(
    await page.getByLabel("Row 4: Ch 1: Quantities").isChecked(),
    false,
  );
  assert.equal(await page.getByLabel(/^Stage/).inputValue(), "Metadata");
  assert.equal(
    await page
      .getByLabel("Output XLSX to validate")
      .evaluate((e) => e.files.length),
    0,
  );
  assert(await page.getByRole("button", { name: "Run stage QA" }).isDisabled());
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    "Catalogue",
    "Explore",
    "Compare",
    "History",
    "Work queue",
    "Macmillan",
    "Analytics",
    "Setup",
  ]) {
    await tab(name);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${name} overflows at 390px`,
    );
  }
  await tab("Catalogue");
  await page.getByLabel("Find a course", { exact: true }).fill("");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("catalogue-mobile");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        checks: [
          "62-course pagination and combined filters",
          "source explorer with lazy evidence",
          "all comparison inputs reset across courses",
          "report focus and evidence-status filtering",
          "unmapped source remains visible and downloads remain complete",
          "queue navigation and checklist isolation",
          "before/after owner actions and separate portfolio results",
          "workbook choices and output files reset across masters",
          "390px layouts",
        ],
        screenshots: capturePath,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    (await page.locator(".full-workspace").innerText()).slice(-6000),
  );
  await shot("failure");
  throw error;
} finally {
  await browser.close();
  server.close();
}
