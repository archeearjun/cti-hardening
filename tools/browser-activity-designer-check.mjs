import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import JSZip from "jszip";
import { gzipSync } from "node:zlib";
import { courseraDirectDataSource } from "../src/generated/extractor-sources.js";
import { createCourseraDirectDataCaptureBookmark } from "../src/domain/coursera-direct-data-capture.ts";
import { clickDisclosedControl } from "./browser-workspace-navigation.mjs";
import {
  captureFixture,
  pdfFixture,
  twoPageTeachingPdfFixture,
} from "../tests/activity-designer-fixtures.mjs";

// File selection dispatches change before resolving. The chooser is re-enabled
// only in importFile's finally block, after restoration AND result validation.
async function importResultFile(page, file) {
  await page.waitForFunction(
    () => !document.getElementById("choose-result").disabled,
  );
  await page.locator("#result-file").setInputFiles(file);
  await page.waitForFunction(
    () => !document.getElementById("choose-result").disabled,
  );
  for (const id of [
    "result-file",
    "import-result",
    "restore-human-decisions",
    "result-merge-mode",
  ])
    assert.equal(await page.locator("#" + id).isDisabled(), false);
}
async function importedState(page) {
  return page.evaluate(() => ({
    session: JSON.stringify(CoursePrepUI.getSession()),
    plan: JSON.stringify(CourseResults.getPlan()),
    storedPlan: localStorage.getItem(
      "cti.activity.approval.v1:" + CourseResults.getPlan().plan_id,
    ),
    cards: document.getElementById("activity-cards").innerHTML,
    decisions: document.getElementById("module-decisions").innerHTML,
  }));
}

async function approveResult(page, result, exercisePartial = false) {
  const rec = structuredClone(result);
  rec.mode = "opportunity";
  for (const a of rec.activities) {
    a.status = "idea";
    a.fields = [];
    a.context = { text: "" };
    delete a.approval_ref;
    a.recommendation = {
      confidence: "medium",
      limitations: "Text-only fixture; human semantic review required.",
      placement_status: "exact",
      placement_source: "",
      existing_practice: a.design.comparison,
    };
  }
  if (exercisePartial)
    for (const id of ["Held", "Rejected", "Pending"])
      rec.activities.push({ ...structuredClone(rec.activities[0]), id });
  await page.locator("#result-merge-mode").selectOption("replace");
  await page.locator("#result-json").fill(JSON.stringify(rec));
  await page.locator("#import-result").click();
  assert.equal(await page.locator("#result-error").isVisible(), false);
  await page.locator("#reviewer-name").fill("Browser fixture reviewer");
  const card = page.locator(
    '[data-proposal-id="' + rec.activities[0].id + '"]',
  );
  if (exercisePartial) {
    await page
      .locator('[data-proposal-id="Held"]')
      .getByRole("button", { name: "Hold for evidence", exact: true })
      .click();
    await page
      .locator('[data-proposal-id="Rejected"]')
      .getByRole("button", { name: "Reject", exact: true })
      .click();
    await card.getByText("Revise recommendation", { exact: true }).click();
    await card
      .getByLabel("Incremental instructional value", { exact: true })
      .fill(rec.activities[0].why + " Reviewed by a human.");
    await card
      .getByRole("button", { name: "Save revision for review", exact: true })
      .click();
    assert.match(await card.innerText(), /Decision: pending/);
  }
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  assert.match(await card.innerText(), /Decision: approved/);
  const originalDate = await page.evaluate(
    () => CoursePrepUI.getSession().created_at,
  );
  await page.locator("#nav-prepare").click();
  await page.locator("#phase").selectOption("final");
  assert.equal(
    await page.evaluate(() => CoursePrepUI.getSession().created_at),
    originalDate,
  );
  await page.locator("#nav-activities").click();
  await page.locator("#generate-approved").click();
  const link = page.getByRole("link", {
    name: "Save Approved_Activity_Handoff.zip",
    exact: true,
  });
  await link.waitFor();
  const downloadWait = page.waitForEvent("download");
  await link.click();
  const zip = await JSZip.loadAsync(
    fs.readFileSync(await (await downloadWait).path()),
  );
  const handoff = await zip
    .file("APPROVED_CONTENT_HANDOFF.txt")
    .async("string");
  const data = JSON.parse(handoff.slice(handoff.lastIndexOf("\n") + 1));
  assert.equal(data.approved_proposals.length, result.activities.length);
  for (const a of result.activities)
    Object.assign(
      a,
      data.approved_proposals.find((p) => p.id === a.id),
    );
  result.mode = "final";
  await page.locator("#result-merge-mode").selectOption("merge");
}

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
  await clickDisclosedControl(
    page.getByRole("link", {
      name: "Open Role Play & Dialogue",
      exact: true,
      includeHidden: true,
    }),
  );
  await page.waitForFunction(
    () => !!globalThis.CoursePrepUI && !!globalThis.CoursePackets,
  );
  assert.equal(
    await page.locator("#capture-bookmark").getAttribute("href"),
    createCourseraDirectDataCaptureBookmark(),
  );
  assert.equal(
    await page.locator("#capture-script-text").inputValue(),
    courseraDirectDataSource,
    "The activity console fallback keeps the original readable source.",
  );
  assert.equal(
    await page.locator("#capture-bookmark-address").inputValue(),
    await page.locator("#capture-bookmark").getAttribute("href"),
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
  assert(
    packet.data.scope.excluded_references.some(
      (r) => r.source_path === "instructions.pdf",
    ),
  );
  assert(
    !packet.data.references.some((r) => r.source_path === "instructions.pdf"),
  );
  assert.equal(
    await page.evaluate(
      () =>
        ActivityQuality.source(CoursePrepUI.getSession(), "instructions.pdf")
          .teaching,
    ),
    false,
  );
  // Explicit shared selection changes only the handoff, not the evidence snapshot.
  const evidenceHash = await page.evaluate(
    () => ActivityApproval.identity(CoursePrepUI.getSession()).sha256,
  );
  await page.getByText("Choose modules to review", { exact: true }).click();
  await page
    .getByText("Shared references and cross-module prerequisites", {
      exact: true,
    })
    .click();
  await page.locator('#packet-shared input[value="instructions.pdf"]').check();
  await page.getByText("Choose modules to review", { exact: true }).click();
  const shared = await page.evaluate(
    () => CoursePackets.getModel().packets[0].data,
  );
  assert(
    shared.references.some(
      (r) =>
        r.source_path === "instructions.pdf" &&
        r.evidence_role === "unclassified_context",
    ),
  );
  assert.equal(
    await page.evaluate(
      () => ActivityApproval.identity(CoursePrepUI.getSession()).sha256,
    ),
    evidenceHash,
  );

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
    .locator(":scope > summary")
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
      mode: "final",
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
  // Legacy drafts remain visible but cannot be copied before explicit human review.
  await page.locator("#result-json").fill(JSON.stringify(result));
  await page.locator("#import-result").click();
  assert.equal(
    await page
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    0,
  );
  assert.match(
    await page.locator("#activity-cards").innerText(),
    /Human approval is missing/,
  );
  await approveResult(page, result, true);
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
  // Changing the preparation view must not export old results against new evidence.
  await page.locator("#nav-prepare").click();
  await page.locator("#title").fill("Different preparation title");
  await page.locator("#title").dispatchEvent("change");
  await page.locator("#nav-activities").click();
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
    JSON.parse(await zip.file("SESSION.json").async("string")).title,
    snapshot.title,
  );
  await page.locator("#nav-prepare").click();
  await page.locator("#title").fill(snapshot.title);
  await page.locator("#title").dispatchEvent("change");
  await page.locator("#nav-activities").click();
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
  await restored.locator("#restore-human-decisions").check();
  await importResultFile(restored, {
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
  assert.match(
    await restored.locator("#approval-status").innerText(),
    /1 approved/,
  );
  // Another tab losing/changing the local approval must revoke copy controls.
  await page.evaluate(() =>
    localStorage.removeItem(
      "cti.activity.approval.v1:" + CourseResults.getPlan().plan_id,
    ),
  );
  await restored.waitForFunction(() =>
    document
      .getElementById("approval-status")
      .textContent.includes("unavailable"),
  );
  assert.equal(
    await restored
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    0,
  );
  await importResultFile(restored, {
    name: "work.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await restored
    .getByRole("button", { name: "Copy all fields", exact: true })
    .waitFor();
  // A saved plan remains restorable after holding an already generated draft.
  const revocation = await context.newPage();
  await revocation.goto(page.url());
  await revocation.waitForFunction(() => !!globalThis.CoursePrepUI);
  await revocation.locator("#nav-activities").click();
  await revocation.locator("#restore-human-decisions").check();
  await importResultFile(revocation, {
    name: "work.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await revocation
    .getByRole("button", { name: "Copy all fields", exact: true })
    .waitFor();
  await revocation.locator("#reviewer-name").fill("Second reviewer");
  await revocation
    .locator('[data-proposal-id="A01"]')
    .getByRole("button", { name: "Hold for evidence", exact: true })
    .click();
  await revocation.locator("#save-results").click();
  const heldLink = revocation.getByRole("link", {
    name: "Save Course_Activity_Designer_Work.zip",
    exact: true,
  });
  await heldLink.waitFor();
  const heldWait = revocation.waitForEvent("download");
  await heldLink.click();
  const heldBytes = fs.readFileSync(await (await heldWait).path());
  const heldZip = await JSZip.loadAsync(heldBytes);
  assert.equal(
    heldZip.file("A01_Coursera_fields.txt"),
    null,
    "Held drafts do not export copy-ready field files",
  );
  await importResultFile(revocation, {
    name: "held-work.zip",
    mimeType: "application/zip",
    buffer: heldBytes,
  });
  await revocation.waitForFunction(
    () => !document.getElementById("choose-result").disabled,
  );
  assert.equal(await revocation.locator("#result-error").isVisible(), false);
  assert.match(
    await revocation.locator("#approval-status").innerText(),
    /0 approved/,
  );
  assert.equal(
    await revocation
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    0,
  );
  assert.match(
    await revocation.locator("#activity-cards").innerText(),
    /no current human approval/,
  );
  await revocation.close();
  // Hold the actual async restore boundary: old Copy buttons are not completion.
  await restored.evaluate(() => {
    const restore = CoursePrepUI.restoreSession;
    CoursePrepUI.restoreSession = async function (saved) {
      await restore(saved);
      await new Promise((resolve) => {
        globalThis.releaseImportRestore = resolve;
      });
      CoursePrepUI.restoreSession = restore;
    };
  });
  const pendingRestore = importResultFile(restored, {
    name: "work.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await restored.waitForFunction(() => !!globalThis.releaseImportRestore);
  assert.equal(
    await restored
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    1,
    "Copy may already be visible while the import is still running",
  );
  for (const id of [
    "choose-result",
    "result-file",
    "import-result",
    "restore-human-decisions",
    "result-merge-mode",
  ])
    assert.equal(await restored.locator("#" + id).isDisabled(), true);
  // Programmatic change models an already dispatched second selection. Normal
  // operator controls are disabled; neither this nor a pasted import may race.
  await restored.evaluate(() => {
    const input = document.getElementById("result-file");
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["invalid JSON"], "overlapping.json", {
        type: "application/json",
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.match(
    await restored.locator("#result-import-status").innerText(),
    /additional request was not imported/i,
  );
  await restored.evaluate(() => {
    document.getElementById("result-json").value = "invalid pasted JSON";
    document
      .getElementById("import-result")
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await restored.evaluate(() => globalThis.releaseImportRestore());
  await pendingRestore;
  assert.match(
    await restored.locator("#result-import-status").innerText(),
    /Import complete.*additional request was not imported/s,
  );
  assert.equal(await restored.locator("#result-error").isVisible(), false);
  const beforeRejectedImport = await importedState(restored);
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
  await importResultFile(restored, {
    name: "invalid-work.zip",
    mimeType: "application/zip",
    buffer: await badZip.generateAsync({ type: "nodebuffer" }),
  });
  await restored.locator("#result-error").waitFor({ state: "visible" });
  assert.match(
    await restored.locator("#result-error").innerText(),
    /Module decision is unresolved or ambiguous/,
  );
  assert.deepEqual(
    await importedState(restored),
    beforeRejectedImport,
    "Invalid module IDs cannot replace session, approval, stored decision history or cards",
  );
  // A complete work ZIP with a malformed approval record must also be atomic.
  const invalidApprovalZip = await JSZip.loadAsync(bytes);
  const invalidApproval = JSON.parse(
    await invalidApprovalZip.file("ACTIVITY_APPROVAL.json").async("string"),
  );
  invalidApproval.schema_version = "invalid-approval-version";
  invalidApprovalZip.file(
    "ACTIVITY_APPROVAL.json",
    JSON.stringify(invalidApproval),
  );
  await importResultFile(restored, {
    name: "invalid-approval.zip",
    mimeType: "application/zip",
    buffer: await invalidApprovalZip.generateAsync({ type: "nodebuffer" }),
  });
  assert.match(
    await restored.locator("#result-error").innerText(),
    /Could not import/,
  );
  assert.deepEqual(
    await importedState(restored),
    beforeRejectedImport,
    "Invalid approval restoration preserves all previous evidence and decision state",
  );

  assert.equal(
    (await restored.evaluate(() => CoursePrepUI.getSession())).created_at,
    snapshot.created_at,
  );
  assert.equal(
    await restored.locator("#module-decisions .module-decision").count(),
    2,
  );
  // Return to the valid view for the screenshots.
  await importResultFile(restored, {
    name: "work.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await restored.locator("#result-error").waitFor({ state: "hidden" });
  // Incorrect placement is visible, with copy disabled; literal HTML stays text.
  const bad = structuredClone(result);
  bad.activities[0].placement.before_item_id = "wrong";
  await page.locator("#result-json").fill(JSON.stringify(bad));
  await page.locator("#import-result").click();
  assert.match(
    await page.locator("#result-error").innerText(),
    /changed after approval/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Copy all fields", exact: true })
      .count(),
    1,
    "Invalid approved placement does not replace valid cards",
  );
  delete bad.activities[0].approval_ref; // Legacy review-only path still renders literal text safely.
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
  pdfResult.mode = "final";
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
  await approveResult(pdfPage, pdfResult);
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
    .locator(":scope > summary")
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
  heldResult.mode = "opportunity";
  delete heldResult.activities[0].approval_ref;
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
  const archivePage = await context.newPage();
  archivePage.on("pageerror", (e) => errors.push(e.message));
  await archivePage.goto("http://127.0.0.1:4188/activity-designer/index.html");
  await archivePage.waitForFunction(
    () => !!globalThis.CourseCtiUnifiedCapture && !!globalThis.CoursePrepUI,
  );
  const universal = {
    schemaVersion: 35,
    extractedAt: "2026-10-16T21:00:00.000Z",
    page: {
      courseId: "syntheticBranch",
      title: "Universal bookmark input",
      url: "https://www.coursera.org/teach/synthetic/syntheticBranch/content/edit",
    },
    meta: {
      directDataCapture: {
        mode: "BOUND_AUTHORING_DRAFT_API",
        exportTransport: { format: "ZIP_GZIP_JSON_V1" },
      },
    },
    fingerprints: [
      {
        id: "reading",
        name: "Original teaching",
        type: "Reading",
        typeName: "supplement",
        ancestors: [
          { id: "m1", title: "Module", key: "m1" },
          { id: "l1", title: "Lesson", key: "m1/l1" },
        ],
        payload: {
          textScopeKind: "bound-authoring-draft-cml",
          textSample:
            "The original source explains how to identify dimensions and choose the appropriate measurement units.",
          captureContract: {
            status: "UNRESOLVED_DIRECT_READING",
            complete: false,
          },
        },
      },
    ],
  };
  universal.fingerprints.push({
    id: "emptyNative",
    name: "Native empty editor",
    typeName: "ungradedAssignment",
    ancestors: universal.fingerprints[0].ancestors,
    payload: {
      captureContract: {
        itemId: "emptyNative",
        complete: true,
        status: "COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT",
      },
      directDataEvidence: {
        method: "BOUND_AUTHORING_DRAFT_API",
        courseId: "syntheticBranch",
        itemId: "emptyNative",
        atomId: "emptyAtom",
        sourceState: "AUTHORING_DRAFT",
        stableSource: true,
        draftHash: "a".repeat(64),
        sourceEmpty: true,
        declaredContentParts: 0,
      },
      explicitEmptyAssessmentEvidence: {
        method: "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS",
        courseId: "syntheticBranch",
        itemId: "emptyNative",
        atomId: "emptyAtom",
        sourceEmpty: true,
        declaredContentParts: 0,
      },
      directDataSources: {
        atom: {
          elements: [
            {
              id: "emptyAtom",
              draft: {
                content: {
                  typeName: "staffGradedDraft",
                  definition: { parts: [] },
                },
              },
            },
          ],
        },
      },
      structuredAssessment: {
        declaredQuestionCount: 0,
        questionCount: 0,
        questions: [],
        captureCompleteness: {
          sourceEmpty: true,
          questionCoverageComplete: true,
        },
      },
    },
  });
  const universalZip = new JSZip();
  universalZip.file(
    "capture.json.gz",
    gzipSync(Buffer.from(JSON.stringify(universal))),
    { createFolders: false },
  );
  await archivePage.locator("#file-input").setInputFiles({
    name: "same-bookmark.cti.zip",
    mimeType: "application/zip",
    buffer: await universalZip.generateAsync({
      type: "nodebuffer",
      compression: "STORE",
    }),
  });
  await archivePage.locator("#process").click();
  await archivePage.waitForFunction(
    () =>
      document.querySelector("#progress-label").textContent ===
      "Preparation complete",
  );
  const universalSession = await archivePage.evaluate(() =>
    CoursePrepUI.getSession(),
  );
  assert.equal(universalSession.courses[0].branch_id, "syntheticBranch");
  assert.equal(
    universalSession.sources[0].unread.find((x) =>
      x.path.endsWith("emptyNative"),
    ).capture_state,
    "observed_empty",
  );
  assert(
    (await archivePage.locator("#tree").textContent()).includes(
      "Coursera editor observed empty",
    ),
  );
  const nativePacket = await archivePage.evaluate(
    () => CoursePackets.getModel().packets[0].data,
  );
  assert(
    nativePacket.coverage_audit[0].observed_empty_practice_ids.includes(
      "emptyNative",
    ),
  );

  assert(
    universalSession.sources[0].documents.some((d) =>
      d.text.includes("original source explains"),
    ),
  );
  assert.deepEqual(errors, []);
  assert(
    requests
      .filter((r) => r.url.includes("/activity-designer/"))
      .every((r) => r.method === "GET"),
  );
  assert(!requests.some((r) => /openai|gemini|coursera\.org/.test(r.url)));
  console.log(
    "PASS: gateway, same universal bookmark and .cti.zip import under strict CSP, bulk import, packet metrics/search, failed preparation recovery, stale/wrong placement, packet merging, ZIP save/restore, delayed restore with overlapping file/paste rejection, atomic invalid-module/approval rejection and import control recovery, design gates, complete two-page PDF text/original packet, literal rendering, desktop/mobile. Synthetic course; no live Coursera verification.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
