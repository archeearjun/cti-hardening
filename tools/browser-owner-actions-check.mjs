import { ownerAccessFixture } from "./browser-owner-fixture.mjs";
import { courseraPageKey } from "../src/domain/coursera-linked-content.ts";
import { fetchSourceQuestions } from "../server/source-questions.ts";
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
import { contactTemplateFixture } from "../tests/owner-guidance-fixtures.mjs";
import { syllabusFixture } from "../tests/syllabus-readiness-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { checkItemRefreshUi } from "./browser-item-refresh-ui.mjs";
import { percentages } from "../tests/cti-percentage-fixtures.mjs";
import { checkOwnerScope } from "./browser-owner-scope-check.mjs";
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
await ownerAccessFixture(context);
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
// Exercise an existing report that predates content retention.
delete output.contentEvidence;
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
item.type = "Assignment";
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
output.result.itemResults[0].checks.links.expected = [
  "https://opentextbc.ca/synthetic/chapter/quiz/",
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
  records: [
    input.course,
    audit,
    {
      ...structuredClone(audit),
      id: "unidentified-source-audit",
      title: "Historical report without source identity",
      data: { ...structuredClone(output), sourceScanSha256: "" },
    },
  ],
};
const tab = async (name) =>
  page
    .getByRole("navigation", { name: "CTI workflows" })
    .getByRole("button", { name, exact: true })
    .click();
const openAudit = async () => {
  await page
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(input.course.id);
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
    structuredAssessment: {
      questions: [
        { id: "q1", prompt: "First question" },
        { id: "q2", prompt: "Second question" },
      ],
      captureCompleteness: { declared: 2, questionCoverageComplete: true },
    },
    links: [
      "https://example.test/guide",
      "https://opentextbc.ca/synthetic/chapter/destination/",
    ],
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
  await page.getByText("Imported 3 records;", { exact: false }).waitFor();
  await openAudit();
  await page
    .getByText("Load original extraction content into an older report", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Original extraction JSON", { exact: true })
    .setInputFiles({
      name: "wrong.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
  await page
    .getByRole("alert")
    .filter({ hasText: "does not match either original extraction hash" })
    .waitFor();
  await page
    .getByLabel("Original extraction JSON", { exact: true })
    .setInputFiles({
      name: input.json.name,
      mimeType: "application/json",
      buffer: Buffer.from(input.json.bytes),
    });
  await page
    .getByRole("status")
    .filter({ hasText: "Original Coursera content loaded and saved" })
    .waitFor();
  const emptyExportEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download complete report", exact: true })
    .click();
  assert.match(
    fs.readFileSync(await (await emptyExportEvent).path(), "utf8"),
    /NO SAVED FOLLOW-UP EVIDENCE FOR THIS REPORT/,
  );
  assert.equal(await page.locator(".action-card").count(), 1);
  assert.match(
    await page
      .getByRole("link", { name: "Open item", exact: false })
      .getAttribute("href"),
    /content\/item\/supplement\/reading$/,
  );
  await page.locator(".action-card > summary").click();
  assert.equal(
    await page
      .getByRole("region", { name: "Refresh Coursera item", exact: true })
      .count(),
    0,
    "A browser without the extension must not show a disabled extension refresh panel",
  );
  assert.equal(
    await page
      .getByText("Install or update the CTI extension", { exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("heading", {
      name: "Refresh this item after editing Coursera",
      exact: true,
    })
    .waitFor();
  await page.locator(".targeted-check").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "manual-item-refresh-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("heading", {
      name: "Refresh this item after editing Coursera",
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(shots, "manual-item-refresh-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  await page.getByLabel("Upload plugin-page check JSON").setInputFiles({
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
    .getByRole("button", {
      name: "Copy this item’s current check",
      exact: true,
    })
    .click();
  await page
    .getByText("Current v6.15.12 item check copied.", { exact: false })
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
  await page
    .getByText("Add or update a reviewed source count", { exact: true })
    .click();
  await page
    .getByLabel("Expected source question count", { exact: true })
    .fill("10");
  await page
    .getByLabel("Source count reference URL", { exact: true })
    .fill("javascript:alert(1)");
  await page
    .getByLabel("Source count evidence note", { exact: true })
    .fill(
      "Exact published quiz section, ten numbered question stems. Live bank unverified.",
    );
  await page
    .getByRole("button", { name: "Save source count evidence", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "safe reference URL" })
    .waitFor();
  await page
    .getByLabel("Source count reference URL", { exact: true })
    .fill("https://publisher.example/appendix#quiz");
  await page
    .getByRole("button", { name: "Save source count evidence", exact: true })
    .click();
  await page
    .getByText("8 fewer native question positions", { exact: false })
    .waitFor();
  const sourceRow = buildOwnerTasks(
    output.result,
    input.course.data.scan.courseTree,
  )[0].questionComparisons[0];
  const sourceCapture = await fetchSourceQuestions(
    sourceRow.sourceKey,
    sourceRow.sourceUrls[0],
    async () =>
      new Response(
        "<script>H5PIntegration = " +
          JSON.stringify({
            contents: {
              "cid-1": {
                library: "H5P.QuestionSet 1.17",
                jsonContent: JSON.stringify({
                  randomQuestions: false,
                  disableBackwardsNavigation: true,
                  override: { retryButton: "on" },
                  questions: Array.from({ length: 10 }, (_, i) => {
                    const f = {
                      2: percentages[0],
                      3: percentages[2],
                      4: percentages[4],
                      5: percentages[1],
                      6: percentages[7],
                      7: percentages[8],
                      8: percentages[9],
                    }[i];
                    if (f)
                      return {
                        library:
                          f.type +
                          (f.type.endsWith("TrueFalse") ? " 1.8" : " 1.16"),
                        params: f.type.endsWith("TrueFalse")
                          ? {
                              question: f.prompt,
                              correct: f.sourceKey,
                              l10n: { trueText: "True", falseText: "False" },
                            }
                          : {
                              question: f.prompt,
                              answers: f.options.map((text, n) => ({
                                text,
                                correct: f.sourceKey.startsWith(
                                  `Choice ${n + 1}:`,
                                ),
                              })),
                            },
                      };
                    return {
                      library: "H5P.MultiChoice 1.16",
                      params: {
                        question:
                          i === 0
                            ? "Round 5237.02046 to the nearest thousandth."
                            : "Source question " + (i + 1),
                        answers: [
                          {
                            text:
                              i === 0
                                ? "5237.021"
                                : "Source correct choice " + (i + 1),
                            correct: true,
                            tipsAndFeedback: {
                              tip: "Think about this question.",
                              chosenFeedback: "Recorded source feedback.",
                            },
                          },
                          {
                            text:
                              i === 0 ? "5237.02" : "Source incorrect choice",
                            correct: false,
                          },
                        ],
                        behaviour: { randomAnswers: false, enableRetry: true },
                      },
                    };
                  }),
                }),
              },
            },
          }) +
          ";</script>",
        { headers: { "Content-Type": "text/html" } },
      ),
  );
  const destinationUrl = "https://opentextbc.ca/synthetic/chapter/destination/";
  const destinationCapture = await fetchSourceQuestions(
    courseraPageKey("reading", destinationUrl),
    destinationUrl,
    async () =>
      new Response(
        "<main>Destination embedded lesson: Area = side × side.</main>",
        { headers: { "Content-Type": "text/html" } },
      ),
  );
  let destinationFails = false,
    destinationWait = false,
    releaseDestination;
  let fetchFails = false;
  await page.route("**/api/source-questions", async (route) => {
    const request = route.request().postDataJSON();
    if (request.sourceKey === courseraPageKey("reading", destinationUrl)) {
      assert.equal(request.targetUrl, destinationUrl);
      if (destinationWait)
        await new Promise((resolve) => {
          releaseDestination = resolve;
        });
      await route.fulfill({
        status: destinationFails ? 403 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          destinationFails
            ? { error: "Destination permission denied" }
            : destinationCapture,
        ),
      });
      return;
    }
    assert.equal(request.sourceKey, sourceRow.sourceKey);
    assert.equal(request.targetUrl, sourceRow.sourceUrls[0]);
    await route.fulfill({
      status: fetchFails ? 403 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        fetchFails ? { error: "Source permission denied" } : sourceCapture,
      ),
    });
  });
  await page
    .getByRole("button", { name: "Fetch source questions", exact: true })
    .click();
  await page
    .getByText("Source questions fetched and saved: 10.", { exact: false })
    .waitFor();
  await page
    .getByText("Automatically read source definitions", { exact: false })
    .waitFor();
  const sourceContent = page.getByRole("region", {
    name: "Source captured content",
    exact: true,
  });
  const destinationContent = page.getByRole("region", {
    name: "Coursera captured content",
    exact: true,
  });
  await sourceContent
    .getByText("Source question 10", { exact: true })
    .waitFor();
  await destinationContent
    .getByText("First question", { exact: true })
    .waitFor();
  assert.equal(
    await sourceContent.locator(".captured-questions > li").count(),
    10,
  );
  const reuse = page.getByRole("region", {
    name: "Source question reuse",
    exact: true,
  });
  await reuse
    .getByText("Source-marked answer keys: 10/10 captured.", { exact: false })
    .waitFor();
  await reuse
    .getByRole("button", { name: "Copy questions and answers", exact: true })
    .click();
  const copiedQuestions = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  assert.match(copiedQuestions, /CTI answer: B — 5237.02/);
  assert.match(copiedQuestions, /Key comparison: CONFLICT/);
  const mathCheck = sourceContent.getByRole("region", {
    name: "CTI answer check for question 1",
    exact: true,
  });
  await mathCheck
    .getByText("CTI answer: B — 5237.02 (calculated 5237.020)", { exact: true })
    .waitFor();
  await mathCheck.getByText("Answer-key conflict.", { exact: true }).waitFor();
  const subjectCheck = sourceContent.getByRole("region", {
    name: "CTI answer check for question 2",
    exact: true,
  });
  await subjectCheck
    .getByText("CTI answer: Needs review", { exact: true })
    .waitFor();
  await subjectCheck
    .getByRole("button", { name: "Copy independent review brief", exact: true })
    .click();
  const brief = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(brief, /INDEPENDENT QUESTION REVIEW/);
  assert(!brief.includes("Recorded source feedback"));
  assert(!brief.includes("Source-marked answer:"));
  const percentageCheck = sourceContent.getByRole("region", {
    name: "CTI answer check for question 3",
    exact: true,
  });
  await percentageCheck
    .getByText("CTI answer: B — 9.6 (calculated 9.6)", { exact: true })
    .waitFor();
  await percentageCheck
    .getByText("Answer-key agreement.", { exact: true })
    .waitFor();
  await sourceContent
    .getByRole("region", {
      name: "CTI answer check for question 4",
      exact: true,
    })
    .getByText("CTI answer: B — False (calculated False)", { exact: true })
    .waitFor();
  await sourceContent
    .getByRole("region", {
      name: "CTI answer check for question 5",
      exact: true,
    })
    .getByText("CTI answer: A — 15 hp (calculated 15 hp)", { exact: true })
    .waitFor();
  await sourceContent
    .getByRole("region", {
      name: "CTI answer check for question 6",
      exact: true,
    })
    .getByText("No exact choice matches.", { exact: false })
    .waitFor();
  const profitCheck = sourceContent.getByRole("region", {
    name: "CTI answer check for question 7",
    exact: true,
  });
  await profitCheck
    .getByText("The prompt does not say whether profit", { exact: false })
    .waitFor();
  await sourceContent
    .getByRole("region", {
      name: "CTI answer check for question 9",
      exact: true,
    })
    .getByText("297.36 rpm", { exact: false })
    .waitFor();
  for (const text of [
    "CTI answer: B — 9.6",
    "CTI answer: B — False",
    "CTI answer: A — 15 hp",
    "297.36 rpm",
    "markup on cost",
  ])
    assert(copiedQuestions.includes(text), text);
  await profitCheck.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/cti-owner-actions/percentage-review-desktop.png",
  });
  assert.match(copiedQuestions, /Source question 10/);
  assert.match(
    copiedQuestions,
    /Source-marked answer: Choice 1: Source correct choice 10/,
  );
  assert.match(copiedQuestions, /Choice 1 hint: Think about this question/);
  assert.match(copiedQuestions, /disableBackwardsNavigation\): true/);
  assert.match(
    copiedQuestions,
    /separate CTI answer check for calculation coverage/,
  );
  const definitionsEvent = page.waitForEvent("download");
  await reuse
    .getByRole("button", { name: "Download original definitions", exact: true })
    .click();
  const definitionsFile = await definitionsEvent;
  const definitions = JSON.parse(
    fs.readFileSync(await definitionsFile.path(), "utf8"),
  );
  assert.equal(
    JSON.parse(definitions.bank.definitionJson).questions[9].params.answers[0]
      .correct,
    true,
  );
  const readableEvent = page.waitForEvent("download");
  await reuse
    .getByRole("button", {
      name: "Download questions and answers",
      exact: true,
    })
    .click();
  const readableFile = await readableEvent;
  assert.equal(
    fs.readFileSync(await readableFile.path(), "utf8"),
    copiedQuestions,
  );
  await page.evaluate(() => {
    window.savedCtiClipboardWrite = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async () => {
      throw Error("Clipboard permission denied");
    };
  });
  await reuse
    .getByRole("button", { name: "Copy questions and answers", exact: true })
    .click();
  await reuse
    .getByRole("alert")
    .filter({ hasText: "Could not copy" })
    .waitFor();
  await page.evaluate(() => {
    navigator.clipboard.writeText = window.savedCtiClipboardWrite;
    delete window.savedCtiClipboardWrite;
  });
  await sourceContent
    .getByRole("button", {
      name: "Copy question 10 with captured answers",
      exact: true,
    })
    .click();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /Source-marked answer: Choice 1: Source correct choice 10/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await reuse.scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: "/tmp/cti-owner-actions/source-answer-reuse-mobile.png",
  });
  await mathCheck.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/cti-owner-actions/cti-answer-check-mobile.png",
  });
  await percentageCheck.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/cti-owner-actions/percentage-answer-mobile.png",
  });
  await profitCheck.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/cti-owner-actions/percentage-review-mobile.png",
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await destinationContent.locator(".captured-questions > li").count(),
    2,
  );
  await destinationContent
    .getByRole("button", { name: "Fetch linked Coursera page", exact: true })
    .click();
  await page
    .getByText("Coursera linked-page content fetched and saved.", {
      exact: false,
    })
    .waitFor();
  await destinationContent
    .getByText("Destination embedded lesson: Area = side × side.", {
      exact: true,
    })
    .waitFor();
  // Reading an external page does not increase native Coursera question counts.
  assert.equal(
    await destinationContent.locator(".captured-questions > li").count(),
    2,
  );
  destinationFails = true;
  await destinationContent
    .getByRole("button", { name: "Fetch linked Coursera page", exact: true })
    .click();
  await destinationContent
    .getByRole("alert")
    .filter({ hasText: "Destination permission denied" })
    .waitFor();
  await destinationContent
    .getByText("Destination embedded lesson: Area = side × side.", {
      exact: true,
    })
    .waitFor();
  destinationFails = false;
  destinationWait = true;
  await destinationContent
    .getByRole("button", { name: "Fetch linked Coursera page", exact: true })
    .click();
  await destinationContent
    .getByRole("button", { name: "Cancel Coursera page fetch", exact: true })
    .click();
  await destinationContent
    .getByRole("alert")
    .filter({ hasText: "Previous evidence was preserved" })
    .waitFor();
  releaseDestination?.();
  destinationWait = false;
  await destinationContent
    .getByText("Destination embedded lesson: Area = side × side.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByLabel("Find captured question text", { exact: true })
    .fill("Source question 10");
  assert.equal(
    await sourceContent.locator(".captured-questions > li").count(),
    1,
  );
  assert.equal(
    await destinationContent.locator(".captured-questions > li").count(),
    0,
  );
  await page
    .getByLabel("Find captured question text", { exact: true })
    .fill("");
  assert.match(
    await page.locator(".question-count-values dd").first().innerText(),
    /^10 — Automatically captured H5P question-bank definitions[\s\S]*Original audit capture: Unverified/,
    "The current automatic bank must be primary while the original unknown capture stays distinct",
  );
  fetchFails = true;
  await page
    .getByRole("button", { name: "Refresh source questions", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Source permission denied" })
    .waitFor();
  assert(
    await page
      .getByText("Automatically read source definitions", { exact: false })
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
  assert.equal(data.followUp.reviews.length, 1);
  assert.equal(data.followUp.reviews[0].sourceCounts[0].count, 10);
  assert.equal(data.followUp.reviews[0].sourceCaptures[0].bank.count, 10);
  assert.equal(
    data.followUp.reviews[0].courseraLinkedCaptures[0].courseLaunchVerified,
    false,
  );
  assert.equal(
    data.followUp.contentComparisons[0].view.linkedCoursera[0].text,
    "Destination embedded lesson: Area = side × side.",
  );
  assert.equal(
    data.followUp.contentEvidence.coursera[0].content.text,
    JSON.parse(new TextDecoder().decode(input.json.bytes)).fingerprints[0]
      .payload.textSample,
  );
  assert.equal(
    data.followUp.contentComparisons[0].view.coursera.questions[0].prompt,
    "First question",
  );
  assert.equal(
    data.followUp.contentComparisons[0].view.source.find((c) =>
      c.basis.startsWith("Fetched external"),
    ).questions.length,
    10,
  );
  assert(data.followUp.contentComparisons[0].view.previousCoursera.text);
  assert.equal(
    data.followUp.questionComparisons[0].questionComparisons[0].source.count,
    10,
  );
  assert.equal(
    data.followUp.questionComparisons[0].questionComparisons[0].coursera.count,
    2,
  );
  assert.equal(
    data.followUp.reviews[0].capture.payload.textSample,
    "Fresh reading content",
  );
  assert.equal(data.followUp.reviews[0].pluginCaptures.length, 1);
  assert.equal(data.followUp.automatedResolution, false);
  const reportEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download complete report", exact: true })
    .click();
  const exportedText = fs.readFileSync(
    await (await reportEvent).path(),
    "utf8",
  );
  assert.match(exportedText, /focused item checks: 1 \| plugin-page checks: 1/);
  assert.match(
    exportedText,
    /Confirmed source guide opens in the learner preview/,
  );
  assert.match(exportedText, /Reviewed source reference: 10/);
  assert.match(exportedText, /Automatic source capture:/);
  assert.match(exportedText, /Source question 10/);
  assert.match(exportedText, /First question/);
  assert.match(exportedText, /CONTENT COMPARISON/);
  assert.match(exportedText, /8 fewer native question positions/);
  assert(exportedText.endsWith(output.report));
  await page.getByRole("button", { name: "Copy report", exact: true }).click();
  await page
    .getByText("Report copied with 1 saved item follow-up(s).", {
      exact: false,
    })
    .waitFor();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /focused item checks: 1/,
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
  await page
    .getByRole("heading", {
      name: "Expected source vs Coursera questions",
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "question-counts-mobile.png"),
  });
  await page
    .getByText("Compare captured questions and text", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "content-comparison-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("heading", {
      name: "Expected source vs Coursera questions",
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "question-counts-desktop.png"),
  });
  await page
    .getByText("Compare captured questions and text", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "content-comparison-desktop.png"),
  });
  await checkItemRefreshUi(page, capture, shots);
  await tab("History");
  await page
    .getByRole("button", {
      name: "Historical report without source identity",
      exact: true,
    })
    .click();
  await page
    .getByText("This report has no source file identity.", { exact: false })
    .waitFor();
  await page.locator(".action-card > summary").first().click();
  assert.equal(
    await page
      .getByText("Retrieve files from the original IMSCC", { exact: true })
      .count(),
    0,
    "A report without source identity cannot offer files from the selected package as matched repair evidence",
  );
  await page
    .getByText("The exact source entry is not available in this saved scan.", {
      exact: false,
    })
    .first()
    .waitFor();
  // The contact template is text-matched but not ready to publish. Exercise
  // that distinction in the actual bundled app, including keyboard/mobile use.
  const contactInput = contactTemplateFixture();
  const contactReport = createWorkflows(workerXml).compare(contactInput);
  const contactAudit = {
    ...contactInput.course,
    id: "contact-guidance-audit",
    kind: "audit",
    packageId: contactInput.course.id,
    title: "Contact template guidance",
    data: contactReport,
  };
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "contact-guidance.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "CTI_BROWSER_WORKSPACE",
        schemaVersion: 1,
        records: [contactInput.course, contactAudit],
      }),
    ),
  });
  await page
    .getByRole("button", { name: "Import prepared records", exact: true })
    .click();
  await page.getByText("Imported 2 records;", { exact: false }).waitFor();
  await page
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(contactInput.course.id);
  await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
  await tab("History");
  await page
    .getByRole("button", { name: contactAudit.title, exact: true })
    .click();
  const contactCard = page
    .locator(".action-card")
    .filter({ hasText: "Instructor Contact Information" });
  await contactCard.waitFor({ state: "visible" });
  assert.equal(await contactCard.count(), 1);
  assert.equal(
    await page
      .getByRole("heading", { name: "Assignment owner report", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
    "Opening a report establishes heading focus before keyboard interaction",
  );
  await contactCard.locator(":scope > summary").focus();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await contactCard
      .locator(":scope > summary")
      .evaluate((el) => el === document.activeElement),
    true,
    "Report focus must not move away from the owner's next keyboard target",
  );
  await page.keyboard.press("Enter");
  await contactCard
    .getByRole("heading", { name: "Your next action", exact: true })
    .waitFor();
  assert.match(
    await contactCard.locator(":scope > summary").innerText(),
    /Review readiness/,
  );
  assert.match(
    await contactCard.locator(".owner-assessment").innerText(),
    /Comparison passed/,
  );
  assert.match(
    await contactCard.locator(".owner-readiness").innerText(),
    /also appears in the saved source package/,
  );
  assert.match(
    await contactCard.locator(".action-focus").innerText(),
    /approved facilitator/,
  );
  assert.equal(
    await contactCard
      .getByLabel("Find captured question text", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await contactCard
      .getByText("Question positions:", { exact: false })
      .count(),
    0,
  );
  assert(
    await contactCard.evaluate((el) =>
      Boolean(
        el
          .querySelector(".action-focus")
          .compareDocumentPosition(el.querySelector(".content-comparison")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  );
  await contactCard.locator(".action-focus").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "contact-guidance-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await contactCard.locator(".owner-assessment").scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "contact guidance mobile overflow",
  );
  await page.screenshot({
    path: path.join(shots, "contact-guidance-mobile.png"),
  });
  await contactCard
    .getByText("Source images to check in learner preview (2)", { exact: true })
    .click();
  assert.match(
    await contactCard.locator(".owner-assessment").innerText(),
    /instructor.jpg/,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const needsReview of [false, true]) {
    const syllabusInput = syllabusFixture({
      placeholders: needsReview,
      live: needsReview,
    });
    const syllabusReport = createWorkflows(workerXml).compare(syllabusInput);
    const syllabusAudit = {
      ...syllabusInput.course,
      id: `syllabus-${needsReview}`,
      kind: "audit",
      packageId: syllabusInput.course.id,
      title: needsReview
        ? "Syllabus requiring reconciliation"
        : "Syllabus with no action",
      data: syllabusReport,
    };
    await tab("Setup");
    await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
      name: "syllabus.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "CTI_BROWSER_WORKSPACE",
          schemaVersion: 1,
          records: [syllabusInput.course, syllabusAudit],
        }),
      ),
    });
    await page
      .getByRole("button", { name: "Import prepared records", exact: true })
      .click();
    await page.getByText("Imported 2 records;", { exact: false }).waitFor();
    await page
      .getByRole("combobox", { name: "Selected source course", exact: true })
      .selectOption(syllabusInput.course.id);
    await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
    await tab("History");
    await page
      .getByRole("button", { name: syllabusAudit.title, exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Coursera content view", exact: true })
      .waitFor();
    await page
      .getByRole("group", { name: "Show owner work" })
      .getByRole("button", { name: /^Needs attention/ })
      .click();
    await page
      .getByLabel("Find an item or action", { exact: true })
      .fill("Course Syllabus");
    const syllabusCard = page
      .locator(".action-card")
      .filter({ hasText: "Course Syllabus" });
    if (!needsReview) {
      await page
        .getByText("No items match these filters.", { exact: true })
        .waitFor();
      assert.equal(await syllabusCard.count(), 0);
      await page.getByText(/1 other matching item is hidden/).waitFor();
      await page
        .getByRole("button", {
          name: "Show all matching items (1)",
          exact: true,
        })
        .click();
      await syllabusCard.waitFor({ state: "visible" });
      assert.match(await syllabusCard.innerText(), /Evidence aligned/);
      assert.equal(
        await page
          .getByLabel("Find an item or action", { exact: true })
          .inputValue(),
        "Course Syllabus",
      );
      await page
        .getByLabel("Find an item or action", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(shots, "syllabus-all-items.png"),
      });
    } else {
      await syllabusCard.waitFor({ state: "visible" });
      await syllabusCard.locator(":scope > summary").click();
      await syllabusCard
        .getByRole("heading", { name: "Your next action", exact: true })
        .waitFor();
      assert.match(
        await syllabusCard.locator(".owner-assessment").innerText(),
        /Brightspace wording/,
      );
      assert.match(
        await syllabusCard.locator(".owner-readiness").innerText(),
        /Include your title/,
      );
      assert.match(
        await syllabusCard.locator(".action-focus").innerText(),
        /50% or higher/,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "syllabus mobile overflow",
      );
      await syllabusCard.locator(".owner-assessment").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(shots, "syllabus-review-mobile.png"),
      });
    }
  }
  await checkOwnerScope(page, tab, shots);
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
          "historical report without source identity cannot supply selected-package repair files",
          "fresh item check persisted",
          "completion note required",
          "outcomes and payload survive reload",
          "original audit immutable",
          "text, clipboard and JSON exports include saved follow-ups after reload",
          "exports explicitly identify reports without follow-ups",
          "source count reference validation, persistence, scoped counts and exports",
          "automatic source fetch, failed refresh preserving previous source evidence, and exported bank count",
          "source answer keys, hints, explicit settings, full-bank and single-question copy, original JSON and readable TXT downloads at desktop and 390px",
          "original extraction hash rejection/recovery; both content panes, question search, full content exports and previous observations",
          "390px layout",
          "contact template: passed text vs inherited readiness, actionable guidance first, no irrelevant question warnings, keyboard expansion and 390px layout",
          "hidden matched syllabus is discoverable without clearing search; template/live-source review remains visible in Needs attention",
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
