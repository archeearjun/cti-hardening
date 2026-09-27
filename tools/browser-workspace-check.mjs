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
await new Promise((r) => server.listen(4174, "127.0.0.1", r));
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
const base = "http://127.0.0.1:4174";
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
try {
  await page.goto(base);
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "synthetic-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByText("1 records prepared.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Import prepared records" }).click();
  await page.getByText("Imported 1 records;", { exact: false }).waitFor();
  await page.getByLabel("Selected source course").selectOption(input.course.id);
  await waitIdle();
  await tab("Compare");
  await page.getByLabel("Coursera XLSX (required)").setInputFiles({
    name: input.excel.name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(input.excel.bytes),
  });
  await page.getByLabel("Coursera full capture JSON").setInputFiles({
    name: input.json.name,
    mimeType: "application/json",
    buffer: Buffer.from(input.json.bytes),
  });
  await page.getByLabel("Snapshot stage").selectOption("raw");
  await page
    .getByRole("button", { name: "Run and save full comparison" })
    .click();
  await page.getByText("Full report saved (", { exact: false }).waitFor();
  assert(
    (await page.locator(".owner-report").innerText()).includes(
      "CTI SOURCE → COURSERA QA REPORT",
    ),
  );
  await page.getByRole("heading", { name: "Coursera content view" }).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete report" }).click();
  assert(
    fs.readFileSync(await (await download).path(), "utf8").includes("Reading"),
  );
  await tab("Work queue");
  await page.getByLabel("Original IMSCC rescanned").check();
  await page
    .getByRole("button", { name: "Save checklist", exact: true })
    .click();
  await page.getByText("Checklist saved.", { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Selected source course").selectOption(input.course.id);
  await waitIdle();
  await tab("Work queue");
  assert(await page.getByLabel("Original IMSCC rescanned").isChecked());
  await tab("History");
  await page
    .getByRole("button", {
      name: "Synthetic.imscc · generation 0 · raw",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Assignment owner report" })
    .waitFor();
  assert((await page.locator(".owner-report").innerText()).includes("Reading"));
  await tab("Macmillan");
  await page.getByLabel("New source master XLSX").setInputFiles({
    name: "master.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(
      writeWorkbook({
        name: "master",
        sheets: { export: { values: masterRows } },
      }),
    ),
  });
  await page.getByRole("button", { name: "Scan and save master" }).click();
  await page.getByText("Row 4: Ch 1: Quantities", { exact: false }).waitFor();
  await page.getByLabel("Row 4: Ch 1: Quantities").check();
  await page.getByRole("button", { name: "Review split" }).click();
  await page.getByRole("button", { name: "Apply inclusion choices" }).click();
  await page
    .getByText("Specializations and evidence context saved.", { exact: true })
    .waitFor();
  const bookDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Spec 1", exact: true })
    .click();
  assert(fs.statSync(await (await bookDownload).path()).size > 1000);
  await tab("Analytics");
  await page.getByRole("button", { name: "Analyse saved courses" }).click();
  await page.getByRole("button", { name: "Download analytics" }).waitFor();
  const second = await context.newPage();
  await second.goto(base);
  await second
    .getByLabel("Selected source course")
    .selectOption(input.course.id);
  await waitIdle(second);
  await tab("Catalogue");
  await page.getByLabel("Owner", { exact: true }).fill("First owner");
  await page.getByRole("button", { name: "Save course details" }).click();
  await page.getByText("Course details saved.", { exact: true }).waitFor();
  await second.getByLabel("Owner", { exact: true }).fill("Stale owner");
  await second.getByRole("button", { name: "Save course details" }).click();
  assert(
    (await second.getByRole("alert").innerText()).includes(
      "Another change was saved",
    ),
  );
  await second.close();
  await tab("Setup");
  await page.getByRole("button", { name: "Connect shared workspace" }).click();
  await page.getByRole("alert").waitFor();
  assert(
    (await page.getByRole("alert").innerText()).includes("setup is incomplete"),
  );
  assert(
    (await page.locator(".workspace-banner").innerText()).includes(
      "Local workspace",
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    "Catalogue",
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
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name + " overflows",
    );
  }
  // The real file picker must verify all files before offering Import.
  await tab("Setup");
  const migrationRow = Array(20).fill("");
  migrationRow[2] = "Multipart source";
  migrationRow[12] = "[]";
  migrationRow[18] = "multipart-browser-fixture";
  const migrationText = JSON.stringify({
    kind: "CTI_WORKSPACE_MIGRATION",
    schemaVersion: 1,
    sheets: { Packages: [[], migrationRow], Unknown: [["preserve 🧬"]] },
  });
  const fragments = [migrationText.slice(0, 80), migrationText.slice(80)];
  const exportId = "browser-test";
  const uploadFile = (name, value) => ({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  const partFiles = fragments.map((data, index) =>
    uploadFile(`part_${index}_${exportId}.json`, {
      kind: "CTI_WORKSPACE_MIGRATION_PART",
      schemaVersion: 1,
      exportId,
      index,
      data,
    }),
  );
  const manifestFile = uploadFile("00_manifest.json", {
    kind: "CTI_WORKSPACE_MIGRATION_MANIFEST",
    schemaVersion: 1,
    exportId,
    partCount: fragments.length,
    charCount: migrationText.length,
    utf8Bytes: migrationTextInfo(migrationText).utf8Bytes,
    parts: fragments.map((data, index) => ({
      index,
      fileName: partFiles[index].name,
      charCount: data.length,
      ...migrationTextInfo(data),
    })),
  });
  const migrationInput = page.getByLabel("Workspace migration or backup JSON");
  await migrationInput.setInputFiles([manifestFile, partFiles[0]]);
  await page.getByRole("alert").filter({ hasText: "Missing part_1" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Import prepared records" }).count(),
    0,
  );
  await migrationInput.setInputFiles([
    partFiles[1],
    manifestFile,
    partFiles[0],
  ]);
  await page.getByText("2 records prepared.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Import prepared records" }).click();
  await page
    .getByText("Imported 2 records; skipped 0", { exact: false })
    .waitFor();
  await migrationInput.setInputFiles([manifestFile, ...partFiles]);
  await page.getByText("2 records prepared.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Import prepared records" }).click();
  await page
    .getByText("Imported 0 records; skipped 2", { exact: false })
    .waitFor();
  await page
    .getByLabel("Selected source course")
    .selectOption(migrationRow[18]);
  await waitIdle();
  // Partial legacy history requires acknowledgement and remains visible after reload.
  const damaged = {
    kind: "CTI_WORKSPACE_MIGRATION",
    schemaVersion: 1,
    sheets: {
      Packages: [[], migrationRow],
      QA_Runs: [
        ["Run ID", "Package UUID", "Payload Chunks", "Mode"],
        ["QA-browser-recovery", migrationRow[18], 1, "SINGLE_C0"],
      ],
      QA_Run_Chunks: [["Run ID", "Chunk Index", "Base64 Result Chunk"]],
    },
  };
  await migrationInput.setInputFiles(
    uploadFile("damaged-history.json", damaged),
  );
  await page
    .getByRole("heading", { name: "Some saved reports need recovery" })
    .waitFor();
  assert.match(
    await page.getByText("Import destination:").innerText(),
    /This browser only/,
  );
  const importButton = page.getByRole("button", {
    name: "Import prepared records",
  });
  assert(await importButton.isDisabled());
  const reviewDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download migration review", exact: true })
    .click();
  const review = JSON.parse(
    fs.readFileSync(await (await reviewDownload).path(), "utf8"),
  );
  assert.equal(review.issues[0].runId, "QA-browser-recovery");
  assert.equal(review.issues[0].chunks.actualChunks, 0);
  const acknowledge = page.getByRole("checkbox", {
    name: /I understand these reports remain unavailable/,
  });
  await acknowledge.check();
  await migrationInput.setInputFiles(
    uploadFile("damaged-history-again.json", damaged),
  );
  await page
    .getByRole("heading", { name: "Some saved reports need recovery" })
    .waitFor();
  assert(await importButton.isDisabled());
  await acknowledge.check();
  await importButton.click();
  await page
    .getByText("Imported 2 records; skipped 1", { exact: false })
    .waitFor();
  await page.reload();
  await tab("Setup");
  await page
    .getByText("1 saved QA reports still need recovery", { exact: true })
    .waitFor();
  await page
    .getByLabel("Selected source course")
    .selectOption(migrationRow[18]);
  await waitIdle();
  await tab("History");
  await page
    .getByRole("alert")
    .filter({ hasText: "excluded from comparisons" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("combobox", { name: /^Before/ })
      .locator("option")
      .count(),
    1,
  );
  // A recovered full payload restores the original audit ID and clears the open warning.
  const recovered = structuredClone(damaged);
  recovered.sheets.QA_Run_Chunks.push([
    "QA-browser-recovery",
    0,
    Buffer.from(
      JSON.stringify({
        runId: "QA-browser-recovery",
        packageUuid: migrationRow[18],
        result: createWorkflows(workerXml).compare(input).result,
      }),
    ).toString("base64"),
  ]);
  await tab("Setup");
  await migrationInput.setInputFiles(
    uploadFile("recovered-history.json", recovered),
  );
  await page.getByText("3 records prepared.", { exact: false }).waitFor();
  assert(await importButton.isEnabled());
  await importButton.click();
  await page
    .getByText("Imported 2 records; skipped 1", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Download saved migration issues" })
      .count(),
    0,
  );
  await tab("History");
  assert.equal(
    await page
      .getByRole("alert")
      .filter({ hasText: "excluded from comparisons" })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "QA-browser-recovery", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("combobox", { name: /^Before/ })
      .locator("option")
      .count(),
    2,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        checks: [
          "backup import and source identity",
          "multipart picker rejects missing parts, imports shuffled files and skips reimports",
          "unavailable QA reports require acknowledgement, retain downloadable issues and stay out of comparisons",
          "recovered full payload restores the original audit ID and resolves the warning",
          "full XLSX/JSON comparison in worker",
          "complete owner report and ordered view",
          "report download",
          "checklist persistence after reload",
          "immutable report history",
          "Macmillan scan/split/XLSX export",
          "portfolio analytics",
          "local concurrent edit conflict",
          "unconfigured team service is explicit",
          "390px layouts",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error("PAGE ERROR", errors);
  console.error(
    (await page.locator(".full-workspace").innerText()).slice(-6000),
  );
  await page.screenshot({ path: "/tmp/cti-workspace-failure.png" });
  throw e;
} finally {
  await browser.close();
  server.close();
}
