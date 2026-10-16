import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ownerAccessFixture } from "./browser-owner-fixture.mjs";
import { comparisonFixture } from "../tests/workflow-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDirectory = "/tmp/cti-assignment-workspace";
fs.mkdirSync(screenshotDirectory, { recursive: true });
const input = comparisonFixture();
const output = createWorkflows(workerXml).compare(input);
const audit = {
  ...input.course,
  id: "assignment-ui-audit",
  kind: "audit",
  packageId: input.course.id,
  title: "Synthetic assignment audit",
  data: output,
};
const backup = {
  kind: "CTI_BROWSER_WORKSPACE",
  schemaVersion: 1,
  records: [input.course, audit],
};
const policy = fs
  .readFileSync(path.join(root, "public/_headers"), "utf8")
  .split("\n")
  .find((line) => line.includes("Content-Security-Policy:"))
  .split("Content-Security-Policy: ")[1];
// CI fixture server only. This check does not contact any LMS or certify live
// course extraction. An externally served build may be supplied by the caller.
let server;
const suppliedBase = process.env.CTI_BROWSER_BASE_URL;
const noListen = process.env.CTI_BROWSER_NO_LISTEN === "1";
if (noListen && suppliedBase)
  throw Error(
    "Choose CTI_BROWSER_NO_LISTEN or CTI_BROWSER_BASE_URL, not both.",
  );
if (!suppliedBase && !noListen) {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname.startsWith("/api/")) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"error":"Synthetic local-only workspace"}');
      return;
    }
    try {
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const filename = path.resolve(root, "dist", relative);
      if (!filename.startsWith(path.join(root, "dist") + path.sep))
        throw Error("Invalid path");
      response.writeHead(200, {
        "content-type": /\.(js|mjs)$/.test(filename)
          ? "text/javascript"
          : filename.endsWith(".css")
            ? "text/css"
            : "text/html",
        "Content-Security-Policy": policy,
      });
      response.end(fs.readFileSync(filename));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
const base = noListen
  ? "https://cti-fixture.invalid"
  : suppliedBase || "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CTI_CHROMIUM_PATH
    ? { executablePath: process.env.CTI_CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const unexpectedNetwork = [];
if (noListen) {
  // This mode has no HTTP listener. Every request is fulfilled from the built
  // files or a declared local fixture, including dedicated-worker modules.
  // Register authentication afterwards so its specific mock takes precedence.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) {
      unexpectedNetwork.push(url.origin);
      await route.abort("blockedbyclient");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Synthetic local-only workspace"}',
      });
      return;
    }
    try {
      const relative =
        url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const filename = path.resolve(root, "dist", relative);
      if (!filename.startsWith(path.join(root, "dist") + path.sep))
        throw Error("Invalid path");
      const contentType = /\.(js|mjs)$/.test(filename)
        ? "text/javascript"
        : filename.endsWith(".css")
          ? "text/css"
          : filename.endsWith(".json")
            ? "application/json"
            : filename.endsWith(".svg")
              ? "image/svg+xml"
              : filename.endsWith(".woff2")
                ? "font/woff2"
                : "text/html";
      await route.fulfill({
        status: 200,
        contentType,
        headers: { "Content-Security-Policy": policy },
        body: fs.readFileSync(filename),
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
}
await ownerAccessFixture(context);
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const nav = (name) =>
  page
    .getByRole("navigation", { name: "CTI workflows" })
    .getByRole("button", { name, exact: true })
    .click();
const coursePicker = () =>
  page.getByRole("combobox", { name: "Selected source course", exact: true });
const waitLoaded = async () => {
  await page
    .getByRole("heading", { name: "Item worklist", exact: true })
    .waitFor();
  await page
    .getByText("Loading the full report and item history…", { exact: true })
    .waitFor({ state: "hidden" });
};
const reading = () =>
  page
    .locator(".assignment-item")
    .filter({ has: page.locator("small", { hasText: "coursera · reading" }) });
async function downloadedText(button) {
  const pending = page.waitForEvent("download");
  await button.click();
  const downloaded = await pending;
  return fs.readFileSync(await downloaded.path(), "utf8");
}
async function records() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("cti-workspace-v1", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("records", "readonly"),
            request = tx.objectStore("records").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
try {
  await page.goto(base);
  await page.getByRole("navigation", { name: "CTI workflows" }).waitFor();
  await page
    .getByRole("heading", { name: "Start with your course evidence" })
    .waitFor();
  // The first assignment can begin with a real source document; no package or
  // existing saved course is required. Preserve its literal text and scope.
  const sourceText =
    "# Synthetic Brightspace source\r\n\r\nOriginal café text.\r\n## Diagram lesson\r\n![unfetched](https://source.invalid/drawing.png)\r\n";
  await page
    .getByRole("button", {
      name: "Add source package or document",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Source document (Markdown or text)", { exact: true })
    .setInputFiles({
      name: "initial-brightspace.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(sourceText),
    });
  await page
    .getByRole("checkbox", {
      name: /I confirm this document is the intended source baseline/,
    })
    .check();
  await page
    .getByRole("button", { name: "Inspect source document", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Save this source scan", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Save new course", exact: true })
    .click();
  await waitLoaded();
  const documentCourse = (await records()).find(
    (record) => record.kind === "package",
  );
  assert(
    documentCourse,
    "The first source document creates a saved assignment",
  );
  assert.equal(
    documentCourse.data.scan.sourceEvidence.kind,
    "CTI_SOURCE_DOCUMENT_BASELINE",
  );
  assert.equal(
    documentCourse.data.scan.sourceEvidence.original.text,
    sourceText,
  );
  assert.equal(documentCourse.data.scan.sourceEvidence.completeCourse, false);

  await page.getByRole("tab", { name: "Evidence inbox", exact: true }).click();
  const inbox = page.getByRole("region", {
    name: "Evidence inbox",
    exact: true,
  });
  const supplemental = "## Supplement\nOwner-supplied exact source text.\n";
  await inbox
    .getByLabel("Platform attribution for Markdown or text documents")
    .fill("Brightspace");
  await inbox
    .getByLabel("Course evidence files", { exact: true })
    .setInputFiles([
      {
        name: "supplement.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(supplemental),
      },
      {
        name: "broken.json",
        mimeType: "application/json",
        buffer: Buffer.from("broken JSON"),
      },
    ]);
  await inbox.getByText("Could not inspect", { exact: false }).waitFor();
  await inbox
    .getByRole("checkbox", {
      name: /I checked that these 1 accepted inputs belong to/,
    })
    .check();
  await inbox
    .getByRole("button", {
      name: "Save and use accepted evidence",
      exact: true,
    })
    .click();
  await inbox
    .getByText(
      "Evidence retained and accepted files selected for this course.",
      { exact: false },
    )
    .waitFor();
  const retained = (await records()).filter(
    (record) => record.data.type === "evidence-input",
  );
  assert.equal(
    retained.length,
    1,
    "A failed input does not discard the valid document",
  );
  assert.equal(retained[0].packageId, documentCourse.id);
  assert.equal(retained[0].data.original.text, supplemental);
  assert.equal(
    (await records()).find((record) => record.id === documentCourse.id).version,
    documentCourse.version,
    "A supplemental Markdown upload does not silently replace the source baseline",
  );
  await inbox.getByText("1 retained evidence inputs", { exact: true }).click();
  assert.equal(
    await downloadedText(
      inbox.getByRole("button", {
        name: "Download original source document",
        exact: true,
      }),
    ),
    supplemental,
  );

  // An explicit choice may replace the baseline using the current course
  // version, while reusing the immutable input identity from the first intake.
  await inbox
    .getByLabel("Course evidence files", { exact: true })
    .setInputFiles({
      name: "supplement.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(supplemental),
    });
  await inbox
    .getByText("Exact input already retained", { exact: false })
    .waitFor();
  await inbox
    .getByRole("checkbox", { name: /Use this document as the source baseline/ })
    .check();
  await inbox
    .getByRole("checkbox", {
      name: /I checked that these 1 accepted inputs belong to/,
    })
    .check();
  await inbox
    .getByRole("button", {
      name: "Save and use accepted evidence",
      exact: true,
    })
    .click();
  await inbox
    .getByText(
      "Evidence retained and accepted files selected for this course.",
      { exact: false },
    )
    .waitFor();
  const replaced = (await records()).find(
    (record) => record.id === documentCourse.id,
  );
  assert.equal(replaced.version, documentCourse.version + 1);
  assert.equal(replaced.data.scan.sourceEvidence.original.text, supplemental);
  assert.equal(
    (await records()).filter((record) => record.data.type === "evidence-input")
      .length,
    1,
    "Repeated intake reuses the same immutable evidence identity",
  );

  await nav("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "assignment-fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByText("2 records prepared.", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "Import prepared records", exact: true })
    .click();
  await page.getByText("Imported 2 records;", { exact: false }).waitFor();
  await coursePicker().selectOption(input.course.id);
  await nav("Assignment workspace");
  await waitLoaded();
  await page.getByLabel("Show items", { exact: true }).selectOption("all");
  await reading().waitFor({ state: "visible" });
  const workSearch = page.getByLabel("Find a work item", { exact: true });
  await workSearch.fill("unmatched synthetic native identity");
  await page
    .getByText("No items match this filter.", { exact: false })
    .waitFor();
  assert.equal(await page.locator(".assignment-item").count(), 0);
  await workSearch.clear();
  await reading().waitFor({ state: "visible" });
  assert.equal(
    await reading().count(),
    1,
    "The native Coursera placement is distinct from its source item",
  );
  const originalAudit = (await records()).find(
    (record) => record.id === audit.id,
  );
  await reading().click();
  await page
    .getByLabel("Owner decision", { exact: true })
    .selectOption("checked");
  await page
    .getByLabel("Reason / evidence reference", { exact: true })
    .fill(
      "Synthetic owner checked retained evidence; no new extraction was performed.",
    );
  await page
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await page
    .getByText("History recorded. Original captures and audits are retained.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByText("Loading the full report and item history…", { exact: true })
    .waitFor({ state: "hidden" });
  assert.deepEqual(
    (await records()).find((record) => record.id === audit.id),
    originalAudit,
    "A lifecycle decision never rewrites its immutable audit",
  );
  await page.reload();
  await coursePicker().selectOption(input.course.id);
  await waitLoaded();
  await page.getByLabel("Show items", { exact: true }).selectOption("all");
  await reading().waitFor({ state: "visible" });
  assert.equal(
    await reading().count(),
    1,
    "Reload retains exactly one native Coursera reading placement",
  );
  await reading().click();
  await page
    .getByText(
      "Synthetic owner checked retained evidence; no new extraction was performed.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.getByLabel("Owner decision", { exact: true }).inputValue(),
    "checked",
  );

  // A second owner updates the course after this screen loaded. The first owner
  // must see a conflict rather than silently appending against a stale baseline.
  const second = await context.newPage();
  await second.goto(base);
  await second
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(input.course.id);
  await second
    .getByRole("navigation", { name: "CTI workflows" })
    .getByRole("button", { name: "Catalogue", exact: true })
    .click();
  await second
    .getByLabel("Owner", { exact: true })
    .fill("Second synthetic owner");
  await second
    .getByRole("button", { name: "Save course details", exact: true })
    .click();
  await second
    .getByText("Course details saved and validated.", { exact: true })
    .waitFor();
  await page
    .getByLabel("Reason / evidence reference", { exact: true })
    .fill("This stale decision must not be saved.");
  await page
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "changed" }).waitFor();
  assert(
    !(await records())
      .find((record) => record.data.type === "item-lifecycle")
      .data.events.some(
        (event) => event.note === "This stale decision must not be saved.",
      ),
  );
  await page
    .getByRole("button", { name: "Reload current evidence", exact: true })
    .click();
  await waitLoaded();
  await page.screenshot({
    path: path.join(screenshotDirectory, "assignment-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("tab", { name: "Package explorer", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Explore what is inside", exact: true })
    .waitFor();
  await page
    .getByRole("tab", { name: "Package explorer", exact: true })
    .press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "Deliverables", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  const artifactText = await downloadedText(
    page.getByRole("button", { name: "Download structured JSON", exact: true }),
  );
  const artifact = JSON.parse(artifactText);
  assert(
    artifact.members.length > 0,
    "A structural deliverable exports identified members",
  );
  assert.equal(artifact.courseId, input.course.id);
  await page.getByRole("tab", { name: "Advisory", exact: true }).click();
  const advisory = page.getByRole("region", {
    name: "Measured advisory assistance",
    exact: true,
  });
  await advisory
    .getByRole("heading", { name: "Measured advisory assistance", exact: true })
    .waitFor();
  const ifs = await advisory
    .locator("p")
    .filter({ hasText: "fixed-weight structural workload indicator" })
    .innerText();
  assert.match(ifs, /IFS\s+2\s/);
  assert.match(
    ifs,
    /not a quality percentage, completion result, learned prediction or measured owner time/,
  );
  await advisory
    .getByText("Insufficient reviewed training data", { exact: true })
    .waitFor();
  assert.equal(
    await advisory
      .getByText("Evaluated model available", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await advisory
      .getByRole("table", {
        name: "Candidate suggestions requiring an owner decision",
        exact: true,
      })
      .count(),
    0,
  );
  await advisory
    .getByText(
      "Loading the current reviewed labels before offering suggestions…",
      { exact: true },
    )
    .waitFor({ state: "hidden" });
  // These are declared synthetic owner reviews, not labels inferred from an
  // audit or content. Two examples cannot meet the model's training threshold.
  const reviewedLabels = {
    schemaVersion: 1,
    examples: ["approved", "rejected"].map((decision, index) => ({
      courseId: "synthetic-native-course",
      sourceId: "source-review-" + index,
      targetId: "destination-review-" + index,
      sourceHash: "",
      targetHash: "",
      features: Array(9).fill(0),
      decision,
      reviewerId: "synthetic-owner",
      reviewedAt: "2026-10-16T00:00:00.000Z",
      pairKind: "owner-supplied",
      basis: null,
    })),
  };
  await advisory
    .getByLabel("Import reviewed labels and evaluate", { exact: true })
    .setInputFiles({
      name: "reviewed-labels.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(reviewedLabels)),
    });
  await advisory
    .getByText(
      "Reviewed examples validated and evaluated locally. Save this version to retain it.",
      { exact: true },
    )
    .waitFor();
  await advisory
    .getByText("Insufficient reviewed training data", { exact: true })
    .waitFor();
  await advisory
    .getByRole("button", {
      name: "Save evaluated advisory version",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    (courseId) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("cti-workspace-v1", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("records", "readonly");
          const request = tx.objectStore("records").getAll();
          request.onsuccess = () =>
            resolve(
              request.result.some(
                (record) =>
                  record.packageId === courseId &&
                  record.data.type === "advisory-model",
              ),
            );
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        };
      }),
    input.course.id,
  );
  const advisoryRecords = (await records()).filter(
    (record) =>
      record.packageId === input.course.id &&
      record.data.type === "advisory-model",
  );
  assert.equal(advisoryRecords.length, 1);
  assert.equal(advisoryRecords[0].data.modelStatus, "insufficient-data");
  assert.equal(advisoryRecords[0].data.model.status, "insufficient-data");
  assert.equal(advisoryRecords[0].data.exampleCount, 2);
  assert.deepEqual(advisoryRecords[0].data.dataset, reviewedLabels);
  assert.deepEqual(
    (await records()).find((record) => record.id === audit.id),
    originalAudit,
    "Importing and evaluating declared mapping reviews never rewrites a comparison audit",
  );
  assert.equal(
    await advisory
      .getByRole("table", {
        name: "Candidate suggestions requiring an owner decision",
        exact: true,
      })
      .count(),
    0,
  );
  const exportedAdvisory = JSON.parse(
    await downloadedText(
      advisory.getByRole("button", {
        name: "Export features and model",
        exact: true,
      }),
    ),
  );
  assert.equal(exportedAdvisory.model.status, "insufficient-data");
  assert.equal(exportedAdvisory.exampleCount, 2);
  await page.screenshot({
    path: path.join(screenshotDirectory, "advisory-sparse-data.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Evidence inbox", exact: true }).click();
  await page
    .getByRole("tab", { name: "Evidence inbox", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Assignment owner UI does not overflow a narrow viewport",
  );
  await page.screenshot({
    path: path.join(screenshotDirectory, "assignment-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, [], "No browser exceptions");
  assert.deepEqual(
    unexpectedNetwork,
    [],
    "The no-listener fixture makes no external requests",
  );
  console.log(
    "CTI_ASSIGNMENT_WORKSPACE_PASS " +
      JSON.stringify({
        syntheticOnly: true,
        noListeningSocket: noListen,
        fullAudit: true,
        documentFirstAssignment: true,
        partialIntake: true,
        explicitBaseline: true,
        exactDocumentDownload: true,
        structuralDeliverableDownload: true,
        advisorySparseData: true,
        truthfulIfs: true,
        reviewedDatasetImport: true,
        advisoryHistoryPreservesAudit: true,
        screenshots: screenshotDirectory,
        durableHistory: true,
        immutableAudit: true,
        versionConflict: true,
        keyboardSections: true,
        mobile: true,
        liveExtractionCertified: false,
      }),
  );
} catch (error) {
  // Capture the rendered failure before closing Chromium. A failing selector
  // should leave evidence of the actual UI, not require another blind CI run.
  await Promise.allSettled([
    page.screenshot({
      path: path.join(screenshotDirectory, "failure.png"),
      fullPage: true,
      timeout: 10000,
    }),
    (async () => {
      fs.writeFileSync(
        path.join(screenshotDirectory, "failure.html"),
        await page.content(),
      );
    })(),
    (async () => {
      const visible = await page.evaluate(() => ({
        headings: [...document.querySelectorAll("h1, h2, h3")].map(
          (element) => element.textContent,
        ),
        alerts: [...document.querySelectorAll('[role="alert"]')].map(
          (element) => element.textContent,
        ),
        selectedTabs: [
          ...document.querySelectorAll('[role="tab"][aria-selected="true"]'),
        ].map((element) => element.textContent),
        selectedCourse: document.querySelector(
          'select[aria-label="Selected source course"]',
        )?.value,
        controls: [...document.querySelectorAll("label")].map((label) => ({
          label: label.textContent,
          control: label.control?.tagName,
          ariaLabel: label.control?.getAttribute("aria-label"),
        })),
      }));
      fs.writeFileSync(
        path.join(screenshotDirectory, "failure.json"),
        JSON.stringify(
          { error: String(error), pageErrors: errors, visible },
          null,
          2,
        ),
      );
    })(),
  ]);
  console.error("Assignment browser failure artifacts: " + screenshotDirectory);
  throw error;
} finally {
  await context.close();
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
