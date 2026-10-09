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
  twoPageTeachingPdfFixture,
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
  const completeVisibleCapture = captureFixture();
  completeVisibleCapture.items[1].type = "staffGraded";
  completeVisibleCapture.items[1].assessment_capture.visible_question_headers = 1;
  completeVisibleCapture.items[1].assessment_capture.choice_controls_seen = 1;
  await page.locator("#file-input").setInputFiles([
    {
      name: "capture.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(completeVisibleCapture)),
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
  assert.equal(packet.data.coverage_audit[0].assessment_items, 1);
  assert.equal(packet.data.coverage_audit[0].assessment_items_with_text, 1);
  assert.match(
    await page.locator("#coverage-message").textContent(),
    /Assessments with text: 1\/1/,
  );
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
    a.design = {
      case_facts: [],
      learner_task: "Explain why volume uses cubed units.",
      interaction:
        "Ask for a unit choice, challenge a linear unit, stop after a justified revision.",
      success_criteria: [
        "Distinguish linear and cubic measurements.",
        "Justify the choice using dimensions.",
      ],
      comparison: [
        {
          item_id: "i2",
          difference:
            "The quiz selects a unit; this conversation asks the learner to justify and revise a mistaken unit.",
        },
      ],
    };
    a.fields.find((f) => f.label === "Purpose of activity").text =
      a.design.learner_task + " " + a.design.interaction;
    a.fields.find((f) => f.label === "Advanced").text =
      a.design.success_criteria.join(" ") +
      " Complete both independently and apply the reasoning to a changed example.";
    a.fields.find((f) => f.label === "Intermediate").text =
      "Selects cubic units but needs a prompt to connect the three measured dimensions to the choice.";
    a.fields.find((f) => f.label === "Beginner").text =
      "Still selects linear units after a hint or cannot explain how the dimensions determine volume.";
    a.why =
      "The existing quiz asks for a unit; this conversation adds explanation and revision of a mistaken choice.";
    a.objective =
      "Choose volume units and justify them from the measured dimensions.";
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
  const unsupported = structuredClone(result);
  delete unsupported.activities[0].design;
  await page.locator("#result-json").fill(JSON.stringify(unsupported));
  await page.locator("#import-result").click();
  assert.equal(
    await page
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    0,
  );
  assert(
    (await page.locator("#activity-cards").innerText()).includes(
      "Regenerate with the current AI packet",
    ),
  );
  assert(
    (await page.locator("#activity-cards").innerText()).includes(
      "Needs evidence / design review",
    ),
  );
  await page.locator("#result-json").fill(JSON.stringify(result));
  await page.locator("#import-result").click();
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
  // Canonical import reads both PDF pages under the actual PDF.js worker/CSP,
  // and ships original bytes alongside the module packet for visual review.
  const pdfPage = await context.newPage();
  pdfPage.on("pageerror", (e) => errors.push(e.message));
  await pdfPage.goto(page.url());
  await pdfPage.waitForFunction(() => !!globalThis.CoursePrepUI);
  const pdfBytes = twoPageTeachingPdfFixture();
  const sha = Buffer.from(
    await crypto.subtle.digest("SHA-256", pdfBytes),
  ).toString("hex");
  const raw = {
    extractedAt: "2026-10-08T18:00:00Z",
    page: {
      courseId: "b1",
      title: "Edit Content | Synthetic course | Coursera",
      url: "https://www.coursera.org/teach/test/b1/content/edit",
    },
    meta: { extractor: "v6.15.12" },
    documentAssets: [
      {
        sha256: sha,
        size: pdfBytes.length,
        mime: "application/pdf",
        base64: pdfBytes.toString("base64"),
      },
    ],
    fingerprints: [
      {
        id: "i1",
        name: "Teaching PDF",
        typeName: "supplement",
        ancestors: completeVisibleCapture.items[0].ancestors,
        payload: {
          textScopeKind: "document-viewer",
          textSample: "Volume viewer excerpt",
          assetDetails: [{ sha256: sha, documentRef: sha, name: "volume.pdf" }],
        },
      },
    ],
  };
  await pdfPage.locator("#file-input").setInputFiles({
    name: "cti.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(raw)),
  });
  await pdfPage.locator("#process").click();
  await pdfPage.waitForFunction(
    () =>
      document.querySelector("#progress-label").textContent ===
      "Preparation complete",
  );
  const docSession = await pdfPage.evaluate(() => CoursePrepUI.getSession());
  assert(docSession.sources[0].documents[0].text.includes("SECOND PAGE"));
  assert(
    docSession.sources[0].documents[0].note.includes(
      "diagrams were not interpreted",
    ),
  );
  assert.equal(docSession.courses[0].modules[0].id, "m1");
  const delivery = await pdfPage.evaluate(() => ({
    packet: CoursePackets.getModel().packets[0].data,
    files: Object.keys(CoursePackets.getModel().packets[0].assets),
  }));
  assert.equal(delivery.packet.teaching_attachments.length, 1);
  assert.equal(delivery.files[0], `Teaching_PDFs/${sha}.pdf`);
  await pdfPage.locator("#download-packet").click();
  const pdfLink = pdfPage.getByRole("link", {
    name: "Save AI_PACKET_P01_Unzip_First.zip",
    exact: true,
  });
  await pdfLink.waitFor();
  const pdfWait = pdfPage.waitForEvent("download");
  await pdfLink.click();
  const pdfDownload = await pdfWait;
  const packetZip = await JSZip.loadAsync(
    fs.readFileSync(await pdfDownload.path()),
  );
  assert.deepEqual(
    await packetZip.file(`Teaching_PDFs/${sha}.pdf`).async("nodebuffer"),
    pdfBytes,
  );
  assert(
    (await packetZip.file("AI_PACKET_P01.txt").async("string")).includes(
      "SECOND PAGE",
    ),
  );
  assert.match(
    await packetZip.file("READ_ME_FIRST.txt").async("string"),
    /smaller batches in the same chat/,
  );
  // Reproduce a result citing the exported PDF filename, not its parent item.
  const pdfResult = structuredClone(result);
  pdfResult.bundle_created_at = docSession.created_at;
  pdfResult.title = docSession.title;
  pdfResult.mode = docSession.phase;
  const pdfActivity = pdfResult.activities[0];
  pdfActivity.placement.after = "Teaching PDF";
  pdfActivity.placement.before = "End of lesson";
  pdfActivity.placement.before_item_id = "";
  pdfActivity.design.comparison = [];
  pdfActivity.evidence = [
    {
      source_path: `Teaching_PDFs/${sha}.pdf`,
      locator: "pages 1–2",
      purpose: "teaching",
    },
  ];
  await pdfPage.locator("#nav-activities").click();
  await pdfPage.locator("#paste-result summary").click();
  await pdfPage.locator("#result-json").fill(JSON.stringify(pdfResult));
  await pdfPage.locator("#import-result").click();
  assert.equal(await pdfPage.locator("#result-error").isVisible(), false);
  await pdfPage
    .getByRole("button", { name: "Copy all fields", exact: true })
    .waitFor();
  assert(
    !/source path is not present|No readable teaching/.test(
      await pdfPage.locator("#activity-cards").textContent(),
    ),
  );
  await pdfPage
    .getByText("Source references & export IDs", { exact: true })
    .click();
  assert(
    (await pdfPage.locator("#activity-cards").innerText()).includes(
      "Original PDF available; text layer captured",
    ),
  );
  await pdfPage
    .getByRole("button", { name: "Download cited PDF", exact: true })
    .click();
  const citedDownloadWait = pdfPage.waitForEvent("download");
  await pdfPage
    .getByRole("link", { name: `Save ${sha}.pdf`, exact: true })
    .click();
  assert.deepEqual(
    fs.readFileSync(await (await citedDownloadWait).path()),
    pdfBytes,
  );
  await pdfPage
    .locator("#activity-cards details")
    .filter({ hasText: "Evidence notes and AI checks" })
    .locator("summary")
    .click();
  const noteItems = await pdfPage
    .locator("#activity-cards details li")
    .allTextContents();
  assert(
    noteItems.length > 0 && noteItems.every((text) => text.trim().length > 0),
  );
  await pdfPage.screenshot({
    path: path.join(screenshots, "pdf-citation-desktop.png"),
    fullPage: true,
  });
  await pdfPage.setViewportSize({ width: 390, height: 844 });
  assert(
    await pdfPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await pdfPage.screenshot({
    path: path.join(screenshots, "pdf-citation-mobile.png"),
    fullPage: true,
  });
  // Empty-editor holds must show source reconciliation even with no draft fields.
  const heldSession = structuredClone(snapshot);
  heldSession.courses[0].modules[0].lessons[0].items[0].external_resources = [
    {
      url: "https://example.test/book/?p=22#main",
      status: "external_body_unread",
      action: "Review the original resource.",
    },
  ];
  const emptyItem = heldSession.courses[0].modules[0].lessons[0].items[1];
  emptyItem.body_available = false;
  emptyItem.capture_coverage = "observed_empty";
  emptyItem.link =
    "https://www.coursera.org/teach/test/b1/content/item/project/i2";
  emptyItem.assessment_capture = null;
  heldSession.sources[0].documents = heldSession.sources[0].documents.filter(
    (d) => d.id !== "i2",
  );
  heldSession.sources[0].unread.push({
    path: "coursera/b1/i2",
    kind: "Assignment",
    reason: "Observed-empty editor; source reconciliation needed.",
    capture_state: "observed_empty",
  });
  const heldResult = structuredClone(result);
  heldResult.activities[0].status = "hold";
  heldResult.activities[0].fields = [];
  heldResult.activities[0].minutes = 0;
  heldResult.module_decisions[0].decision = "hold";
  const heldPage = await context.newPage();
  heldPage.on("pageerror", (e) => errors.push(e.message));
  await heldPage.goto(page.url());
  await heldPage.waitForFunction(() => !!globalThis.CoursePrepUI);
  await heldPage.locator("#file-input").setInputFiles({
    name: "SESSION.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(heldSession)),
  });
  await heldPage.locator("#process").click();
  await heldPage.waitForFunction(
    () =>
      document.querySelector("#progress-label").textContent ===
      "Preparation complete",
  );
  await heldPage.locator("#nav-activities").click();
  await heldPage.locator("#paste-result summary").click();
  const preparedHold = await heldPage.evaluate(() => CoursePrepUI.getSession());
  heldResult.bundle_created_at = preparedHold.created_at;
  heldResult.mode = preparedHold.phase;
  heldResult.title = preparedHold.title;
  await heldPage.locator("#result-json").fill(JSON.stringify(heldResult));
  await heldPage.locator("#import-result").click();
  assert.equal(await heldPage.locator("#result-error").isVisible(), false);
  const heldText = await heldPage.locator("#activity-cards").innerText();
  assert(
    heldText.includes("What to do next") &&
      heldText.includes("Source reconciliation needed"),
  );
  assert(
    heldText.includes("Time not estimated") &&
      !heldText.includes("Estimated 0 min"),
  );
  assert.equal(
    await heldPage
      .getByRole("link", { name: "Open Quiz (i2)", exact: true })
      .getAttribute("href"),
    emptyItem.link,
  );
  assert.equal(
    await heldPage
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    0,
  );
  await heldPage
    .getByText("Embedded resources need separate review (1 items)", {
      exact: true,
    })
    .click();
  assert.equal(
    await heldPage
      .getByRole("link", { name: "Open embedded resource", exact: true })
      .getAttribute("href"),
    "https://example.test/book/?p=22#main",
  );
  await heldPage.screenshot({
    path: path.join(screenshots, "observed-empty-desktop.png"),
    fullPage: true,
  });
  await heldPage.setViewportSize({ width: 390, height: 844 });
  assert(
    await heldPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await heldPage.screenshot({
    path: path.join(screenshots, "observed-empty-mobile.png"),
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
    "PASS: gateway, strict CSP, bulk import, packet metrics/search, failed preparation recovery, stale/wrong placement, packet merging, ZIP save/restore, design gates, complete two-page PDF text/original packet, literal rendering, desktop/mobile. Synthetic course; no live Coursera verification.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
