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
const courses = Array.from({ length: 62 }, (_, i) => {
  const code = `COURSE${String(i + 1).padStart(3, "0")}`;
  const cloned = structuredClone(input.course);
  return {
    ...cloned,
    id: crypto.randomUUID(),
    title: `Course ${String(i + 1).padStart(3, "0")} · Source evidence (synthetic)`,
    data: {
      ...cloned.data,
      scan: {
        ...cloned.data.scan,
        fileName: code + ".imscc",
        scannedAt: "2026-09-15T12:00:00.000Z",
      },
      partner: i % 2 ? "Partner B" : "Partner A",
      owner: i % 3 ? "Review team" : "Assignment owner",
      status: i % 4 ? "In Queue" : "QA Review",
      assignedDate: "",
      deadline: "",
      driveLink: "",
    },
  };
});
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
const localCapture = {
  schemaVersion: 35,
  extractedAt: "2026-10-01T00:00:00.000Z",
  page: { courseId: "Course_id_123", title: "Synthetic Course" },
  meta: {
    extractor: "CTI Item Fidelity Extractor v6.15.9",
    buildId: "v6.15.9-rendered-choice-labels-20261004",
    baseFingerprintCount: 1,
    captureAccounting: {
      inventoryCount: 1,
      completeCount: 1,
      unresolvedCount: 0,
      unknownCount: 0,
      unvisitedCount: 0,
      externalContentUnverifiedCount: 0,
      terminalAccountedIncompleteCount: 0,
      allInventoryAccounted: true,
      noSilentMisses: true,
      complete: true,
    },
  },
  fingerprints: [
    {
      id: "reading-1",
      type: "Reading",
      name: "Reading",
      payload: {},
      captureContract: {
        complete: true,
        accounted: true,
        retryable: false,
        status: "COMPLETE_READING",
      },
    },
  ],
};
const capturePath = process.env.CTI_UX_SCREENSHOTS || "/tmp/cti-ux-screenshots";
fs.mkdirSync(capturePath, { recursive: true });
const shot = async (name) => {
  const unnamed = await page
    .locator("input, select, textarea, progress")
    .evaluateAll((elements) =>
      elements
        .filter(
          (e) =>
            e.getClientRects().length &&
            !e.closest("[hidden]") &&
            !e.getAttribute("aria-label") &&
            !e.getAttribute("aria-labelledby") &&
            !Array.from(e.labels || []).some((l) => l.textContent.trim()),
        )
        .map((e) => e.outerHTML.slice(0, 100)),
    );
  assert.deepEqual(
    unnamed,
    [],
    `${name}: visible controls need accessible labels`,
  );
  await page.screenshot({
    path: path.join(capturePath, `${name}.png`),
    fullPage: false,
  });
};
try {
  await page.goto(base);
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .getByRole("link", { name: "Skip to main content" })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("#main").evaluate((e) => e === document.activeElement),
    true,
  );
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "synthetic-ux.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByText("66 records prepared.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Import prepared records" }).click();
  await page.getByText("Imported 66 records;", { exact: false }).waitFor();
  await tab("Overview");
  await page
    .getByRole("heading", { name: "Workspace overview", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Needs attention", exact: true })
    .waitFor();
  await shot("overview-desktop");
  await tab("Catalogue");
  const courseSearch = page.getByLabel("Search selected source course", {
    exact: true,
  });
  const courseSelect = page.getByLabel("Selected source course", {
    exact: true,
  });
  await courseSearch.fill("COURSE062.imscc");
  assert.equal(await courseSelect.locator("option").count(), 2);
  await courseSearch.press("Tab");
  assert.equal(
    await courseSelect.evaluate((e) => e === document.activeElement),
    true,
  );
  await courseSelect.press("ArrowDown");
  await courseSelect.press("Enter");
  await waitIdle();
  assert.equal(await courseSelect.inputValue(), courses[61].id);
  await courseSearch.fill("No such course");
  assert.equal(
    await courseSelect.inputValue(),
    courses[61].id,
    "search must preserve selected course",
  );
  await page
    .getByText("No matching options. Clear search to see all.", {
      exact: false,
    })
    .waitFor();
  await courseSearch.press("Escape");
  assert.equal(await courseSearch.inputValue(), "");
  assert.equal(await courseSelect.locator("option").count(), 63);
  assert.equal(await page.locator(".table-wrap tbody tr").count(), 25);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByText("Page 2 of 3", { exact: true }).waitFor();
  await page.getByLabel("Find a course", { exact: true }).fill("Course 062");
  assert.equal(await page.locator(".table-wrap tbody tr").count(), 1);
  await page.getByLabel("Find a course", { exact: true }).fill("");
  await page.getByRole("combobox", { name: "Filter by partner", exact: true }).selectOption("Partner B");
  await page.getByText("31 of 62 courses", { exact: true }).waitFor();
  await page.getByLabel("Filter by status").selectOption("QA Review");
  await page
    .getByText("No courses match your filters.", { exact: false })
    .waitFor();
  await page.getByRole("combobox", { name: "Filter by partner", exact: true }).selectOption("");
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

  await tab("Extract");
  await page
    .getByRole("heading", { name: "Extract Coursera in your own Chrome" })
    .waitFor();
  const shellInput = page.getByLabel("Coursera authoring-shell URL", {
    exact: true,
  });
  await shellInput.fill("https://example.test/not-coursera");
  assert(
    await page
      .getByRole("button", { name: "Copy current Coursera extractor" })
      .isDisabled(),
    "invalid shell must not enable local extraction",
  );
  await shellInput.fill(
    "https://www.coursera.org/teach/synthetic/Course_id_123/content/edit",
  );
  assert(
    await page
      .getByRole("button", { name: "Copy current Coursera extractor" })
      .isEnabled(),
  );
  assert.equal(
    await page
      .getByRole("link", {
        name: "Open Coursera authoring shell",
        exact: false,
      })
      .getAttribute("href"),
    "https://www.coursera.org/teach/synthetic/Course_id_123/content/edit",
  );
  const extractorDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download extractor", exact: true })
    .click();
  const extractorText = fs.readFileSync(
    await (await extractorDownload).path(),
    "utf8",
  );
  assert.match(extractorText, /CTI Item Fidelity Extractor v6\.15\.9/);
  await page.locator("#local-coursera-capture").setInputFiles({
    name: "local-schema-35.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(localCapture)),
  });
  await page
    .getByText("COMPLETE — strict capture gate passed", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Use this capture in Compare" })
    .click();
  await page
    .getByText("Local Coursera capture loaded into Compare.", { exact: false })
    .waitFor();
  // Browsers do not permit application code to populate another native
  // <input type=file>. CTI carries the validated File in React state and shows
  // the selected-file indicator used by the comparison workflow.
  await page
    .getByText("Selected: local-schema-35.json", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Coursera full capture JSON")
      .evaluate((element) => element.files?.length || 0),
    0,
  );

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
  await page.getByRole("combobox", { name: "Selected source course", exact: true }).selectOption(courses[1].id);
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
  await page.getByRole("combobox", { name: "Selected source course", exact: true }).selectOption(courses[0].id);
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
  assert.equal(await page.locator(".outline-item").count(), 2);
  assert(
    (await page.locator(".outline-item").first().innerText()).includes(
      "Discussion",
    ),
  );
  await page
    .getByText("External interaction (synthetic)", { exact: true })
    .waitFor();
  await page.locator(".outline-item > summary").first().click();
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
    .getByText("No items match these filters.", { exact: true })
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
    await page.getByRole("combobox", { name: "Selected source course", exact: true }).inputValue(),
    courses[1].id,
  );
  assert.equal(
    await page.getByLabel("Original IMSCC rescanned").isChecked(),
    false,
  );
  await tab("Macmillan");
  await page.getByRole("combobox", { name: "Resume saved workbook", exact: true }).selectOption(books[0].id);
  await waitIdle();
  await page.getByLabel("Row 4: Ch 1: Quantities").check();
  await page.getByLabel(/^Stage/).selectOption("Merged");
  await page.getByLabel("Output XLSX to validate").setInputFiles(file);
  await page.getByRole("combobox", { name: "Resume saved workbook", exact: true }).selectOption(books[1].id);
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

  await page.getByRole("combobox", { name: "Selected source course", exact: true }).selectOption(courses[0].id);
  await waitIdle();
  await tab("Operations");
  await page
    .getByRole("heading", { name: "Operational readiness", exact: true })
    .waitFor();
  await page
    .getByText("PASS · Course metadata contract", { exact: true })
    .waitFor();
  await page
    .getByText("Current product capability manifest", { exact: true })
    .click();
  await page
    .getByText("AVAILABLE · Coursera extraction · local Chrome", {
      exact: true,
    })
    .waitFor();

  const catalogWorkbook = Buffer.from(
    writeWorkbook({
      name: "catalog.xlsx",
      sheets: {
        Catalog: {
          values: [
            [
              "Title Code",
              "Title",
              "Coursera Product Type",
              "Assignment Owner",
              "Brightspace Access",
              "CC Package Access",
              "Import Status",
            ],
            [
              "COURSE001",
              "Synthetic Course 001",
              "Course",
              "Assignment owner",
              "Complete",
              "Complete",
              "Complete",
            ],
          ],
        },
      },
    }),
  );
  const plannerWorkbook = Buffer.from(
    writeWorkbook({
      name: "planner.xlsx",
      sheets: {
        Planner: {
          values: [
            [
              "Assignment Date",
              "Partner",
              "Content Ingestion Method",
              "Assignment Category",
              "Assignment Owner",
              "Total Title Count",
              "Status",
              "Assignment Owner Remarks",
            ],
            [
              "2026-09-20",
              "Partner A",
              "Smart Ingestion",
              "Import Only",
              "Assignment owner",
              1,
              "Assigned",
              "COURSE001",
            ],
          ],
        },
      },
    }),
  );
  const runtimeWorkbook = Buffer.from(
    writeWorkbook({
      name: "runtime.xlsx",
      sheets: {
        Runtime: {
          values: [
            ["Coursecode", "Course Title", "RISE", "Storyline", "Link"],
            ["COURSE001", "Synthetic Course 001", 1, 0, "source inventory"],
          ],
        },
      },
    }),
  );

  await page.getByLabel("Catalog partner", { exact: true }).fill("Partner A");
  await page.getByLabel("Partner catalog XLSX", { exact: true }).setInputFiles({
    name: "catalog.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: catalogWorkbook,
  });
  await page
    .getByRole("heading", { name: "Review catalogue import" })
    .waitFor();
  await page
    .getByRole("button", { name: "Save reviewed import", exact: true })
    .click();
  await page
    .getByText("Catalog imported: 1 reviewed row(s)", { exact: false })
    .waitFor();
  await page.getByLabel("Master Planner XLSX", { exact: true }).setInputFiles({
    name: "planner.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: plannerWorkbook,
  });
  await page.getByRole("heading", { name: "Review planner import" }).waitFor();
  await page
    .getByRole("button", { name: "Save reviewed import", exact: true })
    .click();
  await page
    .getByText("Planner imported: 1 reviewed row(s)", { exact: false })
    .waitFor();
  await page
    .getByLabel("Runtime / RISE / Storyline inventory XLSX", { exact: true })
    .setInputFiles({
      name: "runtime.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: runtimeWorkbook,
    });
  await page
    .getByText("Runtime inventory imported: 1 normalized row(s)", {
      exact: false,
    })
    .waitFor();

  await page.getByLabel("Partner", { exact: true }).fill("Partner A");
  await page.getByLabel("From", { exact: true }).fill("2026-09-01");
  await page.getByLabel("To", { exact: true }).fill("2026-09-30");
  await page.getByLabel("Rescan cutoff", { exact: true }).fill("2026-09-01");
  await page
    .getByLabel("Owner filter", { exact: true })
    .fill("Assignment owner");
  await page
    .getByRole("button", { name: "Build queue from saved inputs", exact: true })
    .click();
  await page
    .getByText("Planner queue rebuilt from saved inputs:", { exact: false })
    .waitFor();
  await page.getByText("COURSE001", { exact: true }).waitFor();

  await page
    .getByRole("button", {
      name: "Apply latest runtime evidence to matching courses",
      exact: true,
    })
    .click();
  await page
    .getByText(
      "Applied explicit runtime inventory evidence to 1 matching active course(s).",
      {
        exact: true,
      },
    )
    .waitFor();

  await page.getByText("CLEARED TO INGEST", { exact: true }).waitFor();
  const manifestDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Master Manifest XLSX", exact: true })
    .click();
  const manifestPath = await (await manifestDownload).path();
  assert(
    fs.statSync(manifestPath).size > 100,
    "manifest export should not be empty",
  );

  await page.getByLabel("Coursera redo", { exact: true }).selectOption("DONE");
  await page
    .getByLabel("Operational notes", { exact: true })
    .fill("Synthetic browser verification of migrated work-state persistence.");
  await page
    .getByRole("button", { name: "Save workflow state", exact: true })
    .click();
  await page
    .getByText("Operational workflow state saved with the course record.", {
      exact: true,
    })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("operations-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    "Overview",
    "Catalogue",
    "Explore",
    "Scan",
    "Extract",
    "Compare",
    "History",
    "Work queue",
    "Macmillan",
    "Analytics",
    "Operations",
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
          "zero-cost local Coursera extractor download and strict capture verification",
          "all comparison inputs reset across courses",
          "report focus and evidence-status filtering",
          "source-only actions participate in filters and downloads remain complete",
          "queue navigation and checklist isolation",
          "before/after owner actions and separate portfolio results",
          "workbook choices and output files reset across masters",
          "portable planner/catalog/runtime operations and workflow state",
          "Master Manifest XLSX export",
          "390px layouts across Scan, Extract and Operations",
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
