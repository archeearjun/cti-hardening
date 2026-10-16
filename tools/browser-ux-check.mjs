import { ownerAccessFixture } from "./browser-owner-fixture.mjs";
import {
  buildOwnerTasks,
  needsOwnerAction,
} from "../src/domain/owner-actions.ts";
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
import { courseraSource } from "../src/generated/extractor-sources.js";
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
await ownerAccessFixture(context);
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
// Imported source trees may have no original package fingerprint.
courses[61].data.scan.fileSha256 = "";
courses[61].data.scan.warnings = [
  "Imported historical source tree; no new scan was performed.",
];
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
    extractor: "CTI Item Fidelity Extractor v6.15.12",
    buildId: "v6.15.12-editor-identity-20261009",
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
// The copied troubleshooting summary must contain counters and codes rather
// than the private native models, source locations, or retained original bytes.
const reviewPrivateSentinels = [
  "RAW_QUESTION_SENTINEL", "RAW_ANSWER_SENTINEL", "RAW_CREDENTIAL_SENTINEL",
  "RAW_BINARY_SENTINEL", "RAW_FILENAME_SENTINEL", "RAW_COURSE_TITLE_SENTINEL",
];
const reviewCapture = {
  schemaVersion: 35,
  extractedAt: "2026-10-14T12:00:00Z",
  page: {
    courseId: "Course_id_123", title: reviewPrivateSentinels[5],
    url: "https://www.coursera.org/teach/synthetic/Course_id_123/content/edit",
  },
  meta: {
    extractor: "CTI Direct Course Capture v1.2.0",
    buildId: "v1.2.0-bound-reading-media-20261014",
    directDataCapture: {
      mode: "BOUND_AUTHORING_DRAFT_API", version: 1,
      acquisitionComplete: true, wholeCourseVerified: false, sourceStable: true,
      stopReason: "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS",
      limits: { requests: 20000, totalBytes: 64 * 1024 * 1024, writeAccessToken: reviewPrivateSentinels[2] },
      stats: {
        requests: 100, bytes: 2000, elapsedMs: 420000,
        currentAttempt: { requests: 20, bytes: 500, elapsedMs: 60000, byResource: { "assets.v1": 4 }, privateToken: reviewPrivateSentinels[2] },
        inheritedBudget: { requests: 80, bytes: 1500, elapsedMs: 360000 },
        cumulativeBudget: { requests: 100, bytes: 2000, elapsedMs: 420000 },
        media: {
          requests: 7, bytes: 64 * 1024 * 1024, bodyBudgetExhausted: true, stopReason: "DIRECT_MEDIA_BYTE_LIMIT",
          currentAttempt: { requests: 2, bytes: 1024, stopReason: "DIRECT_MEDIA_BYTE_LIMIT", bodyBudgetExhausted: true,
            limits: { bodyBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 },
            byResource: { ["https://private.example/" + reviewPrivateSentinels[2]]: 99 } },
          limits: { bodyBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 },
          url: "https://private.example/file.png?token=" + reviewPrivateSentinels[2],
        },
      },
    },
  },
  fingerprints: [
    {
      id: "reading-review", type: "Reading", name: reviewPrivateSentinels[4],
      captureContract: { status: "UNRESOLVED_DIRECT_READING", complete: false, accounted: true,
        reasons: ["DIRECT_MEDIA_BYTE_LIMIT"] },
      payload: {
        textSample: reviewPrivateSentinels[0],
        directDataSources: { atom: { elements: [{ id: "a".repeat(22), draft: { name: reviewPrivateSentinels[4] } }] } },
        directDataEvidence: { assetReferenceCount: 1, unresolvedAssetReferences: [{ id: "b".repeat(22), url: "https://private.example/" + reviewPrivateSentinels[2] }] },
        directAssetEvidence: {
          method: "BOUND_CML_ASSET_METADATA_AND_BODY", missingPointers: [],
          failures: [{ id: "b".repeat(22), reason: "DIRECT_MEDIA_BYTE_LIMIT" }],
          assets: [{
            assetId: "b".repeat(22), reason: "DIRECT_MEDIA_BYTE_LIMIT",
            metadata: { elements: [{ id: "b".repeat(22), name: reviewPrivateSentinels[4],
              url: { url: "https://private.example/file.png?token=" + reviewPrivateSentinels[2] } }] },
            metadataReceipt: { status: 200, requestPath: "/api/assets.v1", requestQuery: [["token", reviewPrivateSentinels[2]]] },
            stability: { stable: true },
            body: { base64: Buffer.from(reviewPrivateSentinels[3]).toString("base64"), size: reviewPrivateSentinels[3].length,
              mime: "image/png", sha256: "f".repeat(64), canonicalUrl: "https://private.example/file.png", receipt: { status: 200 } },
          }],
        },
      },
    },
    {
      id: "assessment-review", type: "Assignment", name: reviewPrivateSentinels[4],
      captureContract: { status: "UNRESOLVED_DIRECT_ASSESSMENT", complete: false, accounted: true,
        reasons: ["DIRECT_QUESTION_UNSUPPORTED"] },
      payload: { directDataSources: { atom: { elements: [{ id: "c".repeat(22) }] } },
        structuredAssessment: { questions: [{ prompt: reviewPrivateSentinels[0], answerKey: reviewPrivateSentinels[1] }] },
        nativeCredentials: { token: reviewPrivateSentinels[2] } },
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
  // Owner UI mounts after the server permission check and lazy bundle load.
  await page.getByRole("navigation", { name: "CTI workflows" }).waitFor();
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
  await page
    .getByRole("combobox", { name: "Filter by partner", exact: true })
    .selectOption("Partner B");
  await page.getByText("31 of 62 courses", { exact: true }).waitFor();
  await page.getByLabel("Filter by status").selectOption("QA Review");
  await page
    .getByText("No courses match your filters.", { exact: false })
    .waitFor();
  await page
    .getByRole("combobox", { name: "Filter by partner", exact: true })
    .selectOption("");
  await page.getByLabel("Filter by status").selectOption("");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("catalogue-desktop");
  await page
    .getByRole("button", { name: courses[0].title, exact: true })
    .click();
  await waitIdle();
  await page.getByRole("heading", { name: "Your next decision, with its evidence", exact: true }).waitFor();
  assert.equal(await courseSelect.inputValue(), courses[0].id, "Catalogue opens the selected assignment in its owner workspace");
  await page.getByRole("tab", { name: "Package explorer", exact: true }).click();
  await page.getByRole("heading", { name: "Explore what is inside" }).waitFor();
  await page.getByLabel("Find source content").fill("Reading");
  assert.equal(
    await page
      .locator(".source-items li > details > summary")
      .filter({ hasText: "Reading" })
      .count(),
    1,
  );
  assert.equal(
    await page.locator(".source-explorer .evidence-json").count(),
    0,
    "Closed evidence should not be formatted yet",
  );
  await page
    .locator(".source-items li > details > summary")
    .filter({ hasText: "Reading" })
    .click();
  await page
    .locator(".source-items blockquote")
    .filter({ hasText: "Learning about quantities" })
    .waitFor();
  await page.getByText("Full entry evidence", { exact: true }).click();
  await page.locator(".source-items .evidence-json").waitFor();
  await page.getByText("Full entry evidence", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("source-desktop");

  // The owner workspace is the new course landing. Keep the legacy source
  // handoff covered by entering its explicit Explore view before continuing.
  await tab("Explore");
  await page
    .getByRole("button", {
      name: "Next: capture Brightspace source",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", {
      name: "Capture the Brightspace source",
      exact: true,
    })
    .waitFor();
  const sourceDownload = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Download Brightspace extractor",
      exact: true,
    })
    .click();
  assert.match(
    fs.readFileSync(await (await sourceDownload).path(), "utf8"),
    /CTI Source LMS Ground-Truth Extractor/,
  );
  const sourceFile = page.getByLabel("Downloaded Brightspace source JSON", {
    exact: true,
  });
  await sourceFile.setInputFiles({
    name: "wrong-platform.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(localCapture)),
  });
  await page
    .getByRole("alert")
    .filter({ hasText: "Choose the full CTI Brightspace source JSON" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Use this source capture", exact: true })
      .count(),
    0,
  );
  await sourceFile.setInputFiles({
    name: "brightspace-source.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        extractor: "CTI Brightspace v1.0.8",
        schemaVersion: 2,
        capturedAt: "2026-10-05T00:00:00Z",
        course: { title: "Synthetic Brightspace source", orgUnitId: "123" },
        contentTree: [],
        quizzes: [{ name: "Quiz with unavailable definitions", questions: [] }],
        captureWarnings: [
          "Permission denied for quiz definitions; total unknown.",
        ],
      }),
    ),
  });
  await page
    .getByRole("heading", { name: "Synthetic Brightspace source", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Use this source capture", exact: true })
      .isDisabled(),
  );
  await page
    .getByRole("checkbox", { name: /^I checked that this capture belongs to/ })
    .check();
  await page
    .getByRole("button", { name: "Use this source capture", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Brightspace JSON selected for comparison" })
    .waitFor();
  await page
    .getByRole("button", { name: "Return to assignment plan", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Recommended next action", exact: true })
    .getByRole("button", { name: "Prepare and run comparison", exact: true })
    .waitFor();
  await page
    .getByText("Selected for comparison: brightspace-source.json", {
      exact: false,
    })
    .waitFor();
  await tab("Compare");
  await page
    .getByText("Selected: brightspace-source.json", { exact: false })
    .waitFor();

  await courseSelect.selectOption(courses[61].id);
  await waitIdle();
  await tab("Assignment plan");
  await page
    .getByRole("button", { name: "Scan original IMSCC", exact: true })
    .click();
  await page
    .getByText(`Rescan target: ${courses[61].title}`, { exact: true })
    .waitFor();
  await tab("Source LMS");
  assert.equal(
    await page.getByText("Source file selected:", { exact: false }).count(),
    0,
    "Source capture cannot follow a different course selection",
  );
  await courseSelect.selectOption(courses[0].id);
  await waitIdle();

  await tab("Extract");
  await page
    .getByRole("heading", { name: "Extract Coursera in your own Chrome" })
    .waitFor();
  const shellInput = page.getByLabel("Coursera authoring-shell URL", {
    exact: true,
  });
  await shellInput.fill("");
  const inferredShell =
    "https://www.coursera.org/teach/synthetic/Course_id_123/content/edit";
  await page
    .locator("#local-coursera-capture")
    .setInputFiles({
      name: "saved-first.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...localCapture,
          page: { ...localCapture.page, url: inferredShell },
          meta: { localCaptureBatch: { requiresReload: true, visits: 1 } },
          fingerprints: [
            {
              id: "reading-1",
              name: "Reading",
              type: "Reading",
              typeName: "supplement",
              payload: { captureAttempts: 1 },
            },
          ],
        }),
      ),
    });
  await page
    .getByText("BATCH SAVED — continue capture", { exact: true })
    .waitFor();
  assert.equal(
    await shellInput.inputValue(),
    inferredShell,
    "Saved JSON can fill the matching authoring URL",
  );
  await shellInput.fill("https://example.test/not-coursera");
  await page.locator('.local-extraction-card .legacy-local-extraction > summary').click();
  await page.getByText("Manual Console capture (requires reloads between batches)", {exact:true}).click();
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
  assert.equal(
    extractorText,
    courseraSource,
    "The local download must contain the complete current extractor bundle.",
  );
  const partialCapture = {
    ...localCapture,
    meta: { localCaptureBatch: { requiresReload: true, visits: 1 } },
    fingerprints: [
      {
        id: "reading-1",
        name: "Reading",
        type: "Reading",
        typeName: "supplement",
        payload: { captureAttempts: 1 },
      },
    ],
  };
  await page
    .locator("#local-coursera-capture")
    .setInputFiles({
      name: "saved-batch.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(partialCapture)),
    });
  await page
    .getByText("BATCH SAVED — continue capture", { exact: true })
    .waitFor();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", {name:"Copy automatic resume command",exact:true}).click();
  await page.getByText("automatic command copied.", {exact:false}).waitFor();
  const automatic=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
  assert.equal(automatic.cmd,"Page.addScriptToEvaluateOnNewDocument");
  assert(automatic.args.source.includes(courseraSource.slice("javascript:".length)));
  assert(automatic.args.source.includes("__CTI_LOCAL_CAPTURE_RESUME__=JSON.parse("));
  new Function(automatic.args.source);
  await page
    .getByRole("button", { name: "Copy manual resume script", exact: true })
    .click();
  await page.getByText("resume script copied.", { exact: false }).waitFor();
  const resume = await page.evaluate(() => navigator.clipboard.readText());
  assert(
    resume.includes(courseraSource.slice("javascript:".length)),
    "Resume must contain the complete current canonical extractor",
  );
  assert(resume.includes("__CTI_LOCAL_CAPTURE_RESUME__=JSON.parse("));
  new Function(resume);
  await page.evaluate(() => {
    window.fixtureNativeClipboardWrite = navigator.clipboard.writeText.bind(
      navigator.clipboard,
    );
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw Error("Synthetic permission denial");
      },
    });
  });
  await page
    .getByRole("button", { name: "Copy manual resume script", exact: true })
    .click();
  const manualResume = page.getByLabel("Saved Coursera resume script", {
    exact: true,
  });
  await manualResume.waitFor();
  assert.equal(await manualResume.inputValue(), resume);
  await manualResume.focus();
  assert.equal(
    await manualResume.evaluate((el) => el.selectionEnd - el.selectionStart),
    resume.length,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: window.fixtureNativeClipboardWrite,
    }),
  );
  const reviewFileName = "RAW_FILENAME_SENTINEL-review.json";
  await page.evaluate((fileName) => {
    window.fixtureReviewFileReads = 0;
    window.fixtureReviewFileMethods = [];
    for (const name of ["stream", "text", "arrayBuffer"]) {
      const original = File.prototype[name];
      if (typeof original !== "function") continue;
      window.fixtureReviewFileMethods.push({ name, descriptor: Object.getOwnPropertyDescriptor(File.prototype, name) });
      Object.defineProperty(File.prototype, name, {
        configurable: true, writable: true,
        value: function (...args) {
          if (this.name === fileName) window.fixtureReviewFileReads++;
          return Reflect.apply(original, this, args);
        },
      });
    }
  }, reviewFileName);
  await page.locator("#local-coursera-capture").setInputFiles({
    name: reviewFileName, mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(reviewCapture)),
  });
  const reviewSummaryButton = page.getByRole("button", { name: "Copy capture review summary", exact: true });
  await reviewSummaryButton.waitFor();
  await page.waitForFunction(() => window.fixtureReviewFileReads > 0);
  const initialReviewReads = await page.evaluate(() => window.fixtureReviewFileReads);
  await reviewSummaryButton.click();
  await page.getByText("Capture review summary copied.", { exact: false }).waitFor();
  const copiedReview = await page.evaluate(() => navigator.clipboard.readText());
  const reviewSummary = JSON.parse(copiedReview);
  assert.equal(reviewSummary.kind, "CTI_COURSERA_CAPTURE_REVIEW_SUMMARY_V1");
  assert.equal(reviewSummary.notForCourseAudit, true);
  assert.equal(reviewSummary.scope, "LOCAL_CAPTURE_METADATA_ONLY");
  assert.equal(reviewSummary.capture.version, "1.2.0");
  assert.equal(reviewSummary.capture.wholeCourseVerified, false);
  assert.equal(reviewSummary.api.currentAttempt.requests, 20);
  assert.equal(reviewSummary.api.inheritedBudget.requests, 80);
  assert.equal(reviewSummary.api.cumulativeBudget.requests, 100);
  assert.equal(reviewSummary.media.currentAttempt.stopReason, "DIRECT_MEDIA_BYTE_LIMIT");
  assert.equal(reviewSummary.media.currentAttempt.bodyBudgetExhausted, true);
  assert.equal(reviewSummary.media.limits.totalBytes, 64 * 1024 * 1024);
  assert.equal(reviewSummary.media.assetFailureCodes.DIRECT_MEDIA_BYTE_LIMIT, 1);
  assert.equal(reviewSummary.failuresByType.Reading.reasons.DIRECT_MEDIA_BYTE_LIMIT, 1);
  for (const sentinel of reviewPrivateSentinels) assert(!copiedReview.includes(sentinel), "Copied review must omit " + sentinel);
  assert(!copiedReview.includes(Buffer.from(reviewPrivateSentinels[3]).toString("base64")), "Copied review cannot contain the retained original body");
  assert(!/https?:\/\/|canonicalUrl|requestQuery|accessToken|writeAccessToken|\"base64\"/.test(copiedReview),
    "Only allowlisted counters and codes belong in the review summary");
  assert.equal(await page.evaluate(() => window.fixtureReviewFileReads), initialReviewReads,
    "Copy uses the already inspected diagnostic summary without reading the raw capture again");
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", {
    configurable: true, value: async () => { throw Error("Synthetic review clipboard denial"); },
  }));
  await reviewSummaryButton.click();
  const reviewFallback = page.getByLabel("Coursera capture review summary", { exact: true });
  await reviewFallback.waitFor();
  assert.equal(await reviewFallback.inputValue(), copiedReview,
    "Denied clipboard access reveals only the same sanitized diagnostic summary");
  await reviewFallback.focus();
  assert.equal(await reviewFallback.evaluate(element => element.selectionEnd - element.selectionStart), copiedReview.length);
  assert.equal(await page.evaluate(() => window.fixtureReviewFileReads), initialReviewReads,
    "The review copy fallback also uses the precomputed summary");
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: window.fixtureNativeClipboardWrite });
    for (const { name, descriptor } of window.fixtureReviewFileMethods) {
      if (descriptor) Object.defineProperty(File.prototype, name, descriptor);
      else delete File.prototype[name];
    }
  });
  await page.locator("#local-coursera-capture").setInputFiles({
    name: "local-schema-35.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(localCapture)),
  });
  await page
    .getByText("COMPLETE — strict capture gate passed", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Coursera capture review summary", { exact: true }).count(), 0,
    "Selecting a different capture clears the old review-copy fallback and its counters");
  assert.equal(await page.locator(".direct-capture-summary").count(), 0,
    "A newly selected legacy capture cannot display the previous direct run's media counters");
  await page
    .getByRole("button", { name: "Use this capture in Compare" })
    .click();
  await page
    .getByText(
      "Coursera capture loaded into Compare. A validated direct capture can supply its native inventory; add a matching XLSX for an independent structural export.",
      { exact: true },
    )
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
  await page.getByLabel(/^Coursera XLSX/).setInputFiles(file);
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
  await page
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(courses[1].id);
  await waitIdle();
  assert.equal(
    await page
      .getByLabel(/^Coursera XLSX/)
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
  await page
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(courses[0].id);
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
  assert(
    (
      await page
        .getByRole("region", { name: "Scrollable data table", exact: true })
        .innerText()
    ).includes("Reading"),
  );
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
    await page
      .getByRole("combobox", { name: "Selected source course", exact: true })
      .inputValue(),
    courses[1].id,
  );
  assert.equal(
    await page.getByLabel("Original IMSCC rescanned").isChecked(),
    false,
  );
  await tab("Macmillan");
  await page
    .getByRole("combobox", { name: "Resume saved workbook", exact: true })
    .selectOption(books[0].id);
  await waitIdle();
  await page.getByLabel("Row 4: Ch 1: Quantities").check();
  await page.getByLabel(/^Stage/).selectOption("Merged");
  await page.getByLabel("Output XLSX to validate").setInputFiles(file);
  await page
    .getByRole("combobox", { name: "Resume saved workbook", exact: true })
    .selectOption(books[1].id);
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

  await page
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(courses[0].id);
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

  await courseSearch.fill("");
  await courseSelect.selectOption(courses[0].id);
  await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
  await tab("Assignment plan");
  await page
    .getByRole("heading", { name: "What do I need to do next?", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Open latest item worklist", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", {
        name: "Record owner reconciliation review",
        exact: true,
      })
      .isDisabled(),
  );
  await page
    .getByLabel("Deliverable path", { exact: true })
    .selectOption("SPECIALIZATION");
  await page
    .getByText(
      "Assignment plan saved. Original audit findings remain unchanged.",
      { exact: true },
    )
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Record content map approval", exact: true })
      .isDisabled(),
  );
  await tab("Overview");
  await tab("Assignment plan");
  assert.equal(
    await page.getByLabel("Deliverable path", { exact: true }).inputValue(),
    "SPECIALIZATION",
  );
  await page
    .getByRole("button", { name: "Open latest item worklist", exact: true })
    .waitFor();
  const handoffDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download assignment handoff", exact: true })
    .click();
  const handoff = await handoffDownload;
  assert.equal(handoff.suggestedFilename(), "CTI-assignment-handoff.txt");
  assert.match(
    fs.readFileSync(await handoff.path(), "utf8"),
    /Reconciliation: NOT READY/,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("assignment-plan-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    "Overview",
    "Assignment plan",
    "Catalogue",
    "Explore",
    "Scan",
    "Source LMS",
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
  await tab("Assignment plan");
  await page
    .getByRole("heading", { name: "What do I need to do next?", exact: true })
    .scrollIntoViewIfNeeded();
  await shot("assignment-plan-mobile");
  await tab("Source LMS");
  await page
    .getByRole("heading", {
      name: "Capture the Brightspace source",
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await shot("source-capture-mobile");
  await tab("Assignment plan");
  await page
    .getByRole("heading", {
      name: "Review reconciliation readiness",
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await shot("assignment-readiness-mobile");
  await tab("Catalogue");
  await page.getByLabel("Find a course", { exact: true }).fill("");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("catalogue-mobile");
  // Separate synthetic acceptance case: every flagged item has a documented
  // human check. Exercise the actual review/approval save flow, not DOM mocks.
  const approvedCourse = structuredClone(courses[0]);
  approvedCourse.id = crypto.randomUUID();
  approvedCourse.title = "HANDOFF001 synthetic acceptance";
  approvedCourse.data.scan.fileName = "HANDOFF001.imscc";
  const acceptanceInput = comparisonFixture();
  const acceptanceCapture = JSON.parse(
    new TextDecoder().decode(acceptanceInput.json.bytes),
  );
  for (let index = 1; index <= 3; index++) {
    const id = `reading-extra-${index}`,
      name = `Additional synthetic reading ${index}`;
    approvedCourse.data.scan.courseTree[0].children.push({
      ...structuredClone(approvedCourse.data.scan.courseTree[0].children[0]),
      idref: id,
      title: name,
    });
    acceptanceCapture.fingerprints.push({
      ...structuredClone(acceptanceCapture.fingerprints[0]),
      id,
      name,
    });
  }
  approvedCourse.data.scan.stats.totalItems = 5;
  approvedCourse.data.scan.stats.webcontent = 4;
  const acceptanceRows = [
    ["Module"],
    ["***Name", "Module 1"],
    ["Lesson"],
    ["***Name", "Lesson 1"],
    ...acceptanceCapture.fingerprints.map((item) => [
      item.type,
      item.name,
      "",
      "",
      "",
      "",
      "",
      item.id,
    ]),
  ];
  const approvedAudit = structuredClone(audit);
  approvedAudit.data = workflows.compare({
    ...acceptanceInput,
    course: approvedCourse,
    excel: {
      name: "handoff.xlsx",
      bytes: writeWorkbook({
        name: "handoff",
        sheets: { "FOR IMPORT": { values: acceptanceRows } },
      }),
    },
    json: {
      name: "handoff.json",
      bytes: new TextEncoder().encode(JSON.stringify(acceptanceCapture)),
    },
  });
  assert.equal(
    approvedAudit.data.result.inputCoherence.status,
    "PASS",
    "acceptance fixture must meet real snapshot identity rules",
  );
  approvedAudit.id = crypto.randomUUID();
  approvedAudit.packageId = approvedCourse.id;
  const reviewedItems = buildOwnerTasks(
    approvedAudit.data.result,
    approvedCourse.data.scan.courseTree,
  )
    .filter(needsOwnerAction)
    .map((task) => ({
      ...structuredClone(approvedAudit),
      id: crypto.randomUUID(),
      kind: "item-review",
      title: "Synthetic documented manual check",
      data: {
        auditId: approvedAudit.id,
        itemKey: task.key,
        review: {
          status: "checked",
          note: "Synthetic owner confirmed source matching and learner behaviour for this item.",
          updatedAt: new Date().toISOString(),
          updatedBy: "Synthetic reviewer",
        },
      },
    }));
  const acceptanceRecords = [approvedCourse, approvedAudit, ...reviewedItems];
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "synthetic-assignment.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "CTI_BROWSER_WORKSPACE",
        schemaVersion: 1,
        records: acceptanceRecords,
      }),
    ),
  });
  await page
    .getByText(`${acceptanceRecords.length} records prepared.`, {
      exact: false,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Import prepared records", exact: true })
    .click();
  await page
    .getByText(`Imported ${acceptanceRecords.length} records;`, {
      exact: false,
    })
    .waitFor();
  await courseSearch.fill("");
  await courseSelect.selectOption(approvedCourse.id);
  await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
  await tab("Assignment plan");
  await page
    .getByRole("button", { name: "Open latest item worklist", exact: true })
    .waitFor();
  await page
    .getByLabel("Deliverable path", { exact: true })
    .selectOption("SPECIALIZATION");
  await page
    .getByText(
      "Assignment plan saved. Original audit findings remain unchanged.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByLabel("Reconciliation review note", { exact: true })
    .fill(
      "Synthetic acceptance: checked source matching, learner access and every recorded limitation.",
    );
  await page
    .getByRole("button", {
      name: "Record owner reconciliation review",
      exact: true,
    })
    .click();
  await page
    .getByText("Source reconciliation review recorded.", { exact: false })
    .waitFor();
  await page
    .getByLabel("Approved content map URL", { exact: true })
    .fill("https://docs.google.com/document/d/synthetic-map/edit");
  await page
    .getByLabel("Who approved it and what was approved?", { exact: true })
    .fill(
      "Synthetic partner reviewer approved the documented structure and scope.",
    );
  await page
    .getByRole("button", { name: "Record content map approval", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Approved content map ↗", exact: true })
    .waitFor();
  await tab("Overview");
  await tab("Assignment plan");
  await page
    .getByRole("link", { name: "Approved content map ↗", exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: "I changed the shell — require fresh evidence",
      exact: true,
    })
    .click();
  await page.getByText("Shell change recorded.", { exact: false }).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Approved content map ↗", exact: true })
      .count(),
    0,
  );
  assert(
    await page
      .getByRole("button", {
        name: "Record owner reconciliation review",
        exact: true,
      })
      .isDisabled(),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        checks: [
          "62-course pagination and combined filters",
          "source explorer with lazy evidence",
          "historical source guidance, direct Brightspace download/inspection, staged-file feedback and course isolation",
          "zero-cost local Coursera extractor download and strict capture verification",
          "capture review copies allowlisted diagnostic counters, omits private native content, and offers the same summary after clipboard denial without rereading the file",
          "all comparison inputs reset across courses",
          "report focus and evidence-status filtering",
          "source-only actions participate in filters and downloads remain complete",
          "queue navigation and checklist isolation",
          "before/after owner actions and separate portfolio results",
          "workbook choices and output files reset across masters",
          "portable planner/catalog/runtime operations and workflow state",
          "assignment path persistence, blocked premature approvals, scoped owner review, map approval, shell-change invalidation and handoff download",
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
