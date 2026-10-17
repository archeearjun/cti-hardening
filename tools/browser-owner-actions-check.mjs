import { ownerAccessFixture } from "./browser-owner-fixture.mjs";
import { workspaceNav } from "./browser-workspace-navigation.mjs";
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
import { comparisonFixture, encode } from "../tests/workflow-fixtures.mjs";
import { writeWorkbook } from "../src/adapters/workbook.ts";
import {
  widgetFixture,
  WIDGET_COURSE,
  WIDGET_SLUG,
} from "../tests/coursera-direct-widget-fixtures.mjs";
import { directWidgetContractV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { panoptoDeliveryFixture } from "../tests/panopto-delivery-fixtures.mjs";
import { directTextFixture } from "../tests/coursera-direct-content-fixtures.mjs";
import { contactTemplateFixture } from "../tests/owner-guidance-fixtures.mjs";
import { syllabusFixture } from "../tests/syllabus-readiness-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { checkItemRefreshUi } from "./browser-item-refresh-ui.mjs";
import { percentages } from "../tests/cti-percentage-fixtures.mjs";
import { checkOwnerScope } from "./browser-owner-scope-check.mjs";
import {
  buildContentSnapshot,
  validateContentSnapshot,
} from "../src/domain/content-evidence.ts";
import {
  gradingFixture,
  gradingCourseId,
  gradingCourseSlug,
} from "../tests/native-grading-fixtures.mjs";
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
const tab = async (name) => workspaceNav(page, name);
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
const choiceFeedback = "Keep literal <span> &amp; choice feedback.";
const imageAltText = "Keep literal <span> &amp; alt text.";
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
    ...directTextFixture({
      itemId: "reading",
      courseId: "course",
      courseSlug: "synthetic",
      textSample: "Fresh reading content",
      cmlValue:
        '<co-content><p>Fresh reading content</p><img alt=""/><img alt="Keep literal &lt;span&gt; &amp;amp; alt text."/></co-content>',
    }).payload,
    structuredAssessment: {
      questions: [
        {
          id: "q1",
          prompt: "First question",
          textFormat: "PLAIN_TEXT",
          observationMethod: "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION",
          options: [
            { id: "a", text: "First choice", feedback: choiceFeedback },
            { id: "b", text: "Second choice", feedback: "" },
          ],
        },
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

async function checkPanoptoMetadata(page, tab, shots) {
  const fixture = panoptoDeliveryFixture();
  const first = widgetFixture({ url: fixture.targetUrl });
  const secondTarget = fixture.targetUrl.replace(fixture.ids.A, fixture.ids.B);
  const second = widgetFixture({
    itemId: "WidgetB",
    atomId: "b".repeat(22),
    providerId: "q".repeat(22),
    url: secondTarget,
  });
  const source = comparisonFixture();
  const fingerprints = [first, second].map((value, index) => {
    directWidgetContractV1(value.fp, value.bound);
    return { ...value.fp, path: `Module ${index + 1}`, lesson: "Lesson 1" };
  });
  source.excel.bytes = writeWorkbook({
    name: "Synthetic widgets",
    sheets: {
      "FOR IMPORT": {
        values: fingerprints.flatMap((fp) => [
          ["Module"],
          ["***Name", fp.path],
          ["Lesson"],
          ["***Name", fp.lesson],
          ["Ungraded Plugin", fp.name, "", "", "", "", "", fp.id],
        ]),
      },
    },
  });
  source.json.bytes = encode({
    schemaVersion: 34,
    page: {
      title: "Synthetic widget course",
      url: `https://www.coursera.org/teach/${WIDGET_SLUG}/${WIDGET_COURSE}/content/edit`,
    },
    meta: { buildId: "synthetic-test-only" },
    fingerprints,
  });
  const report = createWorkflows(workerXml).compare(source);
  assert.deepEqual(
    report.contentEvidence.coursera.map((item) => item.content.references),
    [[fixture.targetUrl], [secondTarget]],
    "Same-title widgets must start with independently bound captured targets",
  );
  const savedAudit = {
    ...source.course,
    id: "panopto-metadata-audit",
    kind: "audit",
    packageId: source.course.id,
    title: "Panopto metadata evidence",
    data: report,
  };
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "panopto-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "CTI_BROWSER_WORKSPACE",
        schemaVersion: 1,
        records: [source.course, savedAudit],
      }),
    ),
  });
  await page
    .getByRole("button", { name: "Import prepared records", exact: true })
    .click();
  await page.getByText("Imported 2 records;", { exact: false }).waitFor();
  const openReport = async () => {
    await page
      .getByRole("combobox", { name: "Selected source course", exact: true })
      .selectOption(source.course.id);
    await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
    await tab("History");
    await page
      .getByRole("button", { name: savedAudit.title, exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Coursera content view", exact: true })
      .waitFor();
  };
  await openReport();
  const card = page.locator(
    '.action-card:has(a[href$="/item/plugin/WidgetA"])',
  );
  const otherCard = page.locator(
    '.action-card:has(a[href$="/item/plugin/WidgetB"])',
  );
  await card.locator(":scope > summary").click();
  await otherCard.locator(":scope > summary").click();
  const panel = card.getByRole("region", {
    name: "Panopto media metadata",
    exact: true,
  });
  const otherPanel = otherCard.getByRole("region", {
    name: "Panopto media metadata",
    exact: true,
  });
  assert.equal(
    await panel.getByLabel("Captured Panopto target").inputValue(),
    fixture.targetUrl,
  );
  assert.equal(
    await otherPanel.getByLabel("Captured Panopto target").inputValue(),
    secondTarget,
  );
  await otherPanel
    .getByLabel("Paste Panopto response JSON")
    .fill(fixture.responseText);
  await otherPanel
    .getByRole("button", { name: "Save Panopto metadata", exact: true })
    .click();
  await otherPanel
    .getByRole("status")
    .filter({ hasText: "does not identify the selected Panopto recording" })
    .waitFor();
  assert.equal(
    await otherPanel
      .getByText("Imported Panopto metadata ·", { exact: false })
      .count(),
    0,
  );
  await otherCard.locator(":scope > summary").click();
  await panel
    .getByLabel("Paste Panopto response JSON")
    .fill(fixture.responseText);
  await panel
    .getByRole("button", { name: "Save Panopto metadata", exact: true })
    .click();
  await panel
    .getByRole("status")
    .filter({ hasText: "Panopto metadata saved with this item." })
    .waitFor();
  await panel
    .getByText(
      `Imported Panopto metadata · ${fixture.model.Delivery.SessionName}`,
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await panel.getByLabel("Paste Panopto response JSON").inputValue(),
    "",
  );

  // File import replaces the same target rather than duplicating it. A failed
  // refresh must leave this successful native response available after reload.
  const fileModel = structuredClone(fixture.model);
  fileModel.UnknownMetadata += " — file import";
  fileModel.Delivery.SessionName += " — file import";
  await panel.getByLabel("Upload Panopto response JSON or text").setInputFiles({
    name: "delivery-response.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(JSON.stringify(fileModel)),
  });
  const imported = panel.getByText(
    `Imported Panopto metadata · ${fileModel.Delivery.SessionName}`,
    { exact: true },
  );
  await imported.waitFor();
  await panel.getByLabel("Upload Panopto response JSON or text").setInputFiles({
    name: "wrong-recording.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...fileModel,
        Delivery: { ...fileModel.Delivery, PublicID: fixture.ids.B },
      }),
    ),
  });
  await panel
    .getByRole("status")
    .filter({ hasText: "does not identify the selected Panopto recording" })
    .waitFor();
  await imported.click();
  await panel
    .getByText(
      "No caption tracks reported in the imported response. Caption absence has not been independently verified.",
      { exact: true },
    )
    .waitFor();
  await panel
    .getByRole("heading", {
      name: "Reported navigation and OCR labels",
      exact: true,
    })
    .waitFor();
  await panel
    .getByText(
      "These are the response’s navigation records. They do not establish caption or transcript coverage.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await panel.locator("pre.evidence-json").count(),
    fileModel.Delivery.Timestamps.length,
  );
  assert.equal(
    await panel.locator("pre.evidence-json").first().innerText(),
    fileModel.Delivery.Timestamps[0].Caption,
  );
  assert.equal(
    await panel.locator("markup,literal").count(),
    0,
    "Provider text must be rendered literally",
  );
  assert.equal(
    await panel
      .getByRole("link", {
        name: "Open reported viewer stream ↗",
        exact: true,
      })
      .getAttribute("href"),
    fileModel.Delivery.Streams[0].StreamUrl,
  );
  assert.equal(
    await panel
      .getByRole("link", {
        name: "Open reported podcast stream ↗",
        exact: true,
      })
      .getAttribute("href"),
    fileModel.Delivery.PodcastStreams[0].StreamUrl,
  );
  assert.equal(
    await panel
      .getByRole("link", {
        name: "Open reported stream variant ↗",
        exact: true,
      })
      .count(),
    3,
  );
  assert.equal(
    await panel
      .getByRole("button", {
        name: "Download saved Panopto metadata",
        exact: true,
      })
      .count(),
    1,
  );
  const metadataDownload = page.waitForEvent("download");
  await panel
    .getByRole("button", {
      name: "Download saved Panopto metadata",
      exact: true,
    })
    .click();
  const savedMetadata = JSON.parse(
    fs.readFileSync(await (await metadataDownload).path(), "utf8"),
  );
  assert.deepEqual(
    savedMetadata.nativeModel,
    fileModel,
    "Retain the complete sanitized native model, including unknown text",
  );
  assert.equal(savedMetadata.targetUrl, fixture.targetUrl);
  assert.equal(savedMetadata.auditId, savedAudit.id);
  assert.equal(savedMetadata.courseId, WIDGET_COURSE);
  assert.equal(savedMetadata.itemId, first.fp.id);
  assert.equal(savedMetadata.captions.status, "REPORTED_NONE");
  assert.equal(savedMetadata.navigation[0].eventType, "SmartOcrToc");
  for (const key of [
    "bodyVerified",
    "binaryContentVerified",
    "captionsVerified",
    "playbackVerified",
    "courseLaunchVerified",
    "wholeWidgetVerified",
    "automatedResolution",
  ])
    assert.equal(
      savedMetadata[key],
      false,
      `${key} must not be promoted by metadata import`,
    );
  await card.getByLabel("Item outcome").selectOption("in_progress");
  await card
    .getByLabel("What did you check or change?")
    .fill(
      "Retained the provider metadata; video and caption files remain unverified.",
    );
  await card
    .getByRole("button", { name: "Save item outcome", exact: true })
    .click();
  await card
    .getByRole("status")
    .filter({ hasText: "Item work saved." })
    .waitFor();
  await page.reload();
  await openReport();
  await card.locator(":scope > summary").click();
  await imported.waitFor();
  assert.equal(
    await card.getByLabel("Item outcome").inputValue(),
    "in_progress",
  );
  assert.match(
    await card.getByLabel("What did you check or change?").inputValue(),
    /video and caption files remain unverified/,
  );
  await imported.click();
  const reloadedDownload = page.waitForEvent("download");
  await panel
    .getByRole("button", {
      name: "Download saved Panopto metadata",
      exact: true,
    })
    .click();
  assert.deepEqual(
    JSON.parse(fs.readFileSync(await (await reloadedDownload).path(), "utf8")),
    savedMetadata,
    "A normal review save and reload must preserve imported metadata exactly",
  );
  const evidenceDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download full evidence", exact: true })
    .click();
  const evidence = JSON.parse(
    fs.readFileSync(await (await evidenceDownload).path(), "utf8"),
  );
  assert.deepEqual(
    evidence.result,
    report.result,
    "Panopto metadata must not rewrite or resolve the original audit",
  );
  assert.equal(evidence.followUp.reviews.length, 1);
  assert.deepEqual(evidence.followUp.reviews[0].panoptoCaptures, [
    savedMetadata,
  ]);
  assert.equal(evidence.followUp.automatedResolution, false);
  const textDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download complete report", exact: true })
    .click();
  const text = fs.readFileSync(await (await textDownload).path(), "utf8");
  assert(text.includes(fileModel.Delivery.SessionName));
  assert.match(text, /Caption inventory: REPORTED_NONE/);
  const exportedLines = text.split("\n");
  for (const entry of fileModel.Delivery.Timestamps)
    assert(
      exportedLines.some((line) =>
        line.endsWith(
          `${entry.Time}s [${entry.EventTargetType}]: ${entry.Caption}`,
        ),
      ),
      `Retain the literal time, event type and text for native timestamp ${entry.ID}`,
    );
  assert.match(
    text,
    /OCR\/navigation labels are not speech captions or a transcript/,
  );
  assert(text.includes(fileModel.Delivery.Streams[0].Variants[2].Url));
  assert.match(
    text,
    /Video bytes, original uploads, caption bodies, playback and course launch remain unverified/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Panopto metadata mobile overflow",
  );
  await page.screenshot({
    path: path.join(shots, "panopto-metadata-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function checkSourceShellEvidence(page, tab, shots) {
  // All identities, body bytes and URLs here are synthetic. Exercise the same
  // independent original-body importer used by comparisons before saving the
  // report, rather than hand-authoring a verified UI coverage label.
  const source = comparisonFixture(),
    capturedAt = "2026-10-17T09:00:00.000Z",
    observedAt = "2026-10-17T08:00:00.000Z",
    captions =
      "1\n00:00:01,000 --> 00:00:03,000\nLiteral <b> &amp; caption.\n\n2\n00:00:04,125 --> 00:00:06,750\nSecond authored line.\n",
    captionDescription =
      "Separate native metadata about these source captions.",
    alt = "Authored <span> &amp; drawing label.",
    imageUrl = "https://source.example.test/course/authenticated-drawing.png",
    externalUrl =
      "https://source.example.test/d2l/common/dialogs/quickLink/quickLink.d2l?ou=700&type=lti&rcode=synthetic-guide",
    guideHtml = [
      "<!DOCTYPE html><html><head></head><body>",
      '<div class="d2l-element" data-type="horizontal">',
      '<div class="tabs-wrapper tabs-horizontal"><div class="list-group">',
      '<a class="list-group-item active"><span data-itemprop="0|0">Overview</span></a>',
      '<a class="list-group-item"><span data-itemprop="1|0">Hidden practice</span></a>',
      '</div><div class="tab-content">',
      '<div class="tab-pane active show" data-itemprop="0|1"><p>First widget visible panel.</p>',
      '<img src="decorative-drawing.png" alt=""/><img src="unlabelled-drawing.png"/>',
      '<table><caption>Authored learning outcomes</caption><thead><tr><th scope="col">Topic</th><th scope="col">Outcome</th></tr></thead>',
      '<tbody><tr><th scope="row">Drawing</th><td>Read a drawing &amp; explain its symbols.</td></tr><tr><td></td><td colspan="2">Authored spanning cell</td></tr></tbody></table></div>',
      '<div class="tab-pane" data-itemprop="1|1" hidden="hidden"><p>Hidden panel authored content.</p>',
      '<img src="authenticated-drawing.png" alt="Authored &lt;span&gt; &amp;amp; drawing label."/>',
      `<iframe title="Named synthetic LTI activity" src="${externalUrl.replaceAll("&", "&amp;")}"></iframe></div>`,
      "</div></div></div>",
      '<div class="d2l-element" data-type="horizontal"><div class="tabs-wrapper tabs-horizontal">',
      '<div class="list-group"><a class="list-group-item"><span data-itemprop="0|0">Second widget</span></a></div>',
      '<div class="tab-content"><div class="tab-pane" data-itemprop="0|1"><p>Second widget key-zero content.</p></div></div>',
      "</div></div><p>Authored reading.</p>",
      "<script>window.__ctiGuideHtmlExecuted = true;</script>",
      "</body></html>",
    ].join(""),
    specs = [
      {
        id: "caption-item",
        topic: "1001",
        title: "Synthetic captions",
        format: "srt",
        body: captions,
        text: captions,
      },
      {
        id: "binary-item",
        topic: "1002",
        title: "Synthetic binary original",
        format: "pdf",
        body: "%PDF-1.7\nSynthetic binary original",
        text: "",
      },
      {
        id: "failed-item",
        topic: "1003",
        title: "Synthetic unavailable source",
        format: "html",
        text: "A separately captured native description.",
      },
      {
        id: "html-item",
        topic: "1004",
        title: "Synthetic authenticated resources",
        format: "html",
        body: guideHtml,
        text: "Authored reading.",
      },
    ],
    brightspace = {
      schemaVersion: 2,
      extractor: "CTI Brightspace v1.1.0",
      capturedAt,
      page: {
        url: "https://source.example.test/d2l/le/lessons/700/topics/1001",
      },
      course: { orgUnitId: "700", title: "Synthetic source shell" },
      contentTree: [
        {
          kind: "MODULE",
          id: "source-module",
          title: "Module 1",
          children: [],
        },
      ],
      quizzes: [],
      assignments: [],
      discussions: [],
      assetBodies: {},
      contentAcquisition: { assets: [], gaps: [] },
    };
  for (const spec of specs) {
    const url = `https://source.example.test/course/${spec.id}.${spec.format}`,
      topic = {
        kind: "TOPIC",
        id: spec.topic,
        title: spec.title,
        path: ["Module 1"],
        activityType: 1,
        activityTypeLabel: "File",
        url,
        description: {
          text:
            spec.id === "failed-item"
              ? spec.text
              : spec.id === "caption-item"
                ? captionDescription
                : "",
        },
        contentEvidence: {
          status: "UNRESOLVED",
          reason: "HTTP_403",
          format: spec.format,
          bodyReceipt: { observedAt, status: 403 },
        },
      };
    if (spec.body !== undefined) {
      const bytes = Buffer.from(spec.body),
        hash = await digest(bytes);
      brightspace.assetBodies[hash] = {
        encoding: "base64",
        base64: bytes.toString("base64"),
        bytes: bytes.length,
        sha256: hash,
      };
      topic.contentEvidence = {
        status: spec.id === "binary-item" ? "CAPTURED_ORIGINAL" : "CAPTURED",
        url,
        format: spec.format,
        contentType:
          spec.format === "pdf"
            ? "application/pdf"
            : `text/${spec.format}; charset=utf-8`,
        charset: "utf-8",
        projectionTruncated: false,
        bodyReceipt: {
          requestUrl: url,
          responseUrl: url,
          status: 200,
          observedAt,
          bytes: bytes.length,
          sha256: hash,
          complete: true,
          contentType:
            spec.format === "pdf"
              ? "application/pdf"
              : `text/${spec.format}; charset=utf-8`,
        },
        references: [],
        links: [],
        images: [],
        embeds: [],
        ...(spec.id === "binary-item"
          ? {
              originalRef: hash,
              projectionStatus: "UNRESOLVED",
              projectionReason: "TEXT_PROJECTION_UNAVAILABLE",
            }
          : {
              rawBodyRef: hash,
              html: spec.format === "html" ? spec.body : "",
              text: spec.text,
              textLength: spec.text.length,
              textSha256: await digest(Buffer.from(spec.text)),
            }),
      };
    }
    if (spec.id === "html-item") {
      topic.contentEvidence.images = [{ url: imageUrl, alt }];
      topic.contentEvidence.embeds = [{ url: externalUrl }];
      topic.contentEvidence.references = [
        {
          url: imageUrl,
          rawUrl: "authenticated-drawing.png",
          tag: "img",
          attribute: "src",
          status: "UNRESOLVED",
          reason: "HTTP_403",
          alt,
          text: "",
        },
        {
          url: externalUrl,
          rawUrl: externalUrl,
          tag: "iframe",
          attribute: "src",
          status: "NOT_FETCHED",
          reason: "EXTERNAL_REFERENCE_NOT_FETCHED",
          alt: "",
          text: "",
        },
      ];
    }
    brightspace.contentTree[0].children.push(topic);
  }
  brightspace.contentTree[0].children.push({
    kind: "TOPIC",
    id: "1999",
    title: specs[0].title,
    path: ["Module 1"],
    activityType: 1,
    activityTypeLabel: "File",
    url: "https://source.example.test/course/other-copy.srt",
    contentEvidence: {
      status: "CAPTURED",
      text: "DO NOT BORROW THIS SAME-TITLE TOPIC",
      textLength: 38,
    },
  });
  const htmlDecoy = structuredClone(
      brightspace.contentTree[0].children.find((topic) => topic.id === "1004"),
    ),
    decoyHtml = guideHtml.replace(
      "Hidden panel authored content.",
      "DO NOT BORROW THIS SAME-TITLE HTML PANEL",
    ),
    decoyBytes = Buffer.from(decoyHtml),
    decoyHash = await digest(decoyBytes);
  htmlDecoy.id = "1998";
  htmlDecoy.url = "https://source.example.test/course/other-copy.html";
  htmlDecoy.contentEvidence.url = htmlDecoy.url;
  htmlDecoy.contentEvidence.html = decoyHtml;
  htmlDecoy.contentEvidence.text = "DO NOT BORROW THIS SAME-TITLE HTML PANEL";
  htmlDecoy.contentEvidence.textLength = htmlDecoy.contentEvidence.text.length;
  htmlDecoy.contentEvidence.textSha256 = await digest(
    Buffer.from(htmlDecoy.contentEvidence.text),
  );
  htmlDecoy.contentEvidence.rawBodyRef = decoyHash;
  htmlDecoy.contentEvidence.bodyReceipt = {
    ...htmlDecoy.contentEvidence.bodyReceipt,
    requestUrl: htmlDecoy.url,
    responseUrl: htmlDecoy.url,
    bytes: decoyBytes.length,
    sha256: decoyHash,
  };
  brightspace.assetBodies[decoyHash] = {
    encoding: "base64",
    base64: decoyBytes.toString("base64"),
    bytes: decoyBytes.length,
    sha256: decoyHash,
  };
  brightspace.contentTree[0].children.push(htmlDecoy);
  source.course.data.scan.courseTree[0].children = specs.map((spec) => ({
    title: spec.title,
    type: "webcontent",
    idref: `source-${spec.id}`,
    children: [],
    sourcePayload: {
      textSample: spec.text,
      textLength: spec.text.length,
      links: [],
      images: [],
      files: [],
    },
  }));
  source.course.data.scan.stats = {
    webcontent: 4,
    discussions: 0,
    quizzes: 0,
    assignments: 0,
    lti: 0,
    emptyFolders: 0,
    totalItems: 4,
    ifs: 4,
  };
  source.json.bytes = encode({
    schemaVersion: 34,
    extractedAt: capturedAt,
    page: {
      title: "Synthetic destination shell",
      url: "https://www.coursera.org/teach/synthetic/shell-course/content/edit",
    },
    meta: { buildId: "synthetic-test-only" },
    fingerprints: specs.map((spec) => ({
      id: spec.id,
      name: spec.title,
      type: "Reading",
      path: "Module 1",
      lesson: "Lesson 1",
      payload: {
        textSample: spec.text,
        textLength: spec.text.length,
        textScopeKind: "item-scoped",
        textEvidenceCompleteness: 1,
        links: [],
        published: false,
      },
    })),
  });
  source.excel.bytes = writeWorkbook({
    name: "synthetic-source-shell",
    sheets: {
      "FOR IMPORT": {
        values: [
          ["Module"],
          ["***Name", "Module 1"],
          ["Lesson"],
          ["***Name", "Lesson 1"],
          ...specs.map((spec) => [
            "Reading",
            spec.title,
            "",
            "",
            "",
            "",
            "",
            spec.id,
          ]),
        ],
      },
    },
  });
  source.brightspace = {
    name: "synthetic-source-shell.json",
    bytes: encode(brightspace),
  };
  const report = createWorkflows(workerXml).compare(source);
  // This also checks that UI fixtures cannot silently promote collector labels
  // into verified originals or literal-caption coverage.
  assert.deepEqual(
    report.contentEvidence,
    buildContentSnapshot(source.json.bytes, source.brightspace.bytes),
  );
  validateContentSnapshot(report.contentEvidence);
  assert.equal(report.contentEvidence.brightspace[0].content.text, captions);
  assert.equal(
    report.contentEvidence.brightspace[0].content.textCoverage,
    "COMPLETE",
  );
  assert.equal(
    report.contentEvidence.brightspace[1].content.sourceBody.originalIntegrity,
    "VERIFIED_RETAINED_ORIGINAL",
  );
  assert.equal(
    report.contentEvidence.brightspace[2].content.sourceBody.originalIntegrity,
    "UNVERIFIED",
  );
  const importedHtml = report.contentEvidence.brightspace.find(
      (entry) => entry.id === "1004",
    ).content,
    importedStructure = importedHtml.sourceBody.htmlStructure;
  assert.equal(
    importedHtml.sourceBody.originalIntegrity,
    "VERIFIED_RETAINED_ORIGINAL",
  );
  assert.equal(importedStructure.originalRef, importedHtml.sourceBody.sha256);
  assert.equal(importedStructure.topicId, "1004");
  assert.equal(
    importedStructure.sourceUrl,
    "https://source.example.test/course/html-item.html",
  );
  assert.equal(importedStructure.method, "STATIC_AUTHORED_HTML");
  assert.equal(importedStructure.scope, "STATIC_MARKUP_ONLY");
  assert.deepEqual(
    importedStructure.groups.map((group) =>
      group.panels.map((panel) => [panel.key, panel.label]),
    ),
    [
      [
        ["0", "Overview"],
        ["1", "Hidden practice"],
      ],
      [["0", "Second widget"]],
    ],
  );
  assert.deepEqual(importedStructure.issues, []);
  assert.equal(importedStructure.truncated, false);
  assert.equal(importedHtml.textCoverage, "PARTIAL");
  assert.equal(importedHtml.capturedAt, capturedAt);
  assert.equal(importedHtml.sourceBody.observedAt, observedAt);
  report.ownerContext = buildOwnerContext(
    source.brightspace.bytes,
    specs.map((spec) => ({
      sourceName: spec.title,
      sourcePath: "Module 1",
      sourceId: `source-${spec.id}`,
      topicId: spec.topic,
      navigationEligible: true,
    })),
  );
  for (const item of report.result.ownerView.items) {
    item.status = "EVIDENCE_NEEDED";
    item.actions = [
      {
        action: "Review this synthetic source-file observation.",
        severity: "EVIDENCE",
        verdict: "UNVERIFIED",
      },
    ];
  }
  const nativeHierarchy = [
    {
      id: "native-module",
      title: "Module 1",
      kind: "module",
      ancestorIds: [],
      emptyContainer: false,
      sourceContentType: "",
    },
    {
      id: "native-lesson",
      title: "Lesson 1",
      kind: "lesson",
      ancestorIds: ["native-module"],
      emptyContainer: false,
      sourceContentType: "",
    },
    ...specs.map((spec) => ({
      id: spec.id,
      title: spec.title,
      kind: "item",
      ancestorIds: ["native-module", "native-lesson"],
      emptyContainer: false,
      sourceContentType: "supplement",
    })),
    {
      id: "future-item",
      title: "Future native content",
      kind: "item",
      ancestorIds: ["native-module", "native-lesson"],
      emptyContainer: false,
      sourceContentType: "futureNativeKind",
    },
    {
      id: "empty-lesson",
      title: "Authored empty lesson",
      kind: "lesson",
      ancestorIds: ["native-module"],
      emptyContainer: true,
      sourceContentType: "",
    },
    {
      id: "archive-module",
      title: "Archive",
      kind: "module",
      ancestorIds: [],
      emptyContainer: false,
      sourceContentType: "",
    },
    {
      id: "archive-lesson",
      title: "Lesson 1",
      kind: "lesson",
      ancestorIds: ["archive-module"],
      emptyContainer: false,
      sourceContentType: "",
    },
    {
      id: "archive-caption-copy",
      title: specs[0].title,
      kind: "item",
      ancestorIds: ["archive-module", "archive-lesson"],
      emptyContainer: false,
      sourceContentType: "supplement",
    },
  ];
  const tasksBeforeOutline = buildOwnerTasks(
    report.result,
    source.course.data.scan.courseTree,
  );
  report.result.nativeCourseOutlineEvidence = {
    kind: "VERIFIED_NATIVE_CAPTURE_INVENTORY",
    courseId: "shell-course",
    materialHash: "7".repeat(64),
    contentItemCount: 6,
    inventoryEntryCount: 7,
    moduleCount: 2,
    lessonCount: 3,
    emptyContainerCount: 1,
    nativeHierarchy,
    independentWorkbook: false,
    completeContent: false,
  };
  assert.deepEqual(
    buildOwnerTasks(report.result, source.course.data.scan.courseTree),
    tasksBeforeOutline,
    "Native shell folders and reference-only placements do not invent owner findings",
  );
  const savedAudit = {
      ...source.course,
      id: "source-shell-evidence-audit",
      kind: "audit",
      packageId: source.course.id,
      title: "Synthetic source and destination evidence",
      data: report,
    },
    invalidAudit = structuredClone(savedAudit);
  invalidAudit.id = "invalid-shell-evidence-audit";
  invalidAudit.title = "Synthetic invalid native outline";
  invalidAudit.data.result.nativeCourseOutlineEvidence.courseId =
    "different-course";
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "synthetic-shell-evidence.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "CTI_BROWSER_WORKSPACE",
        schemaVersion: 1,
        records: [source.course, savedAudit, invalidAudit],
      }),
    ),
  });
  await page
    .getByRole("button", { name: "Import prepared records", exact: true })
    .click();
  await page.getByText("Imported 3 records;", { exact: false }).waitFor();
  await page
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(source.course.id);
  await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
  const openReport = async (title) => {
    await tab("History");
    await page.getByRole("button", { name: title, exact: true }).click();
    await page
      .getByRole("heading", { name: "Coursera content view", exact: true })
      .waitFor();
  };
  const externalRequests = [],
    recordExternalRequest = (request) => {
      const url = new URL(request.url());
      if (
        url.hostname === "source.example.test" ||
        url.hostname === "external.example.test"
      )
        externalRequests.push(request.url());
    };
  page.on("request", recordExternalRequest);
  await openReport(savedAudit.title);
  const outline = page.getByTestId("native-course-outline");
  await outline.locator(":scope > summary").click();
  assert.equal(
    await outline.locator("li[data-native-id]").count(),
    nativeHierarchy.length,
  );
  assert.deepEqual(
    await outline
      .locator("li[data-native-id]")
      .evaluateAll((rows) => rows.map((row) => row.dataset.nativeId)),
    nativeHierarchy.map((node) => node.id),
    "Native modules, lessons and repeated-title items retain captured preorder",
  );
  for (const node of nativeHierarchy) {
    const row = outline.locator(`li[data-native-id="${node.id}"]`);
    assert.equal(await row.getAttribute("data-native-kind"), node.kind);
    assert((await row.innerText()).includes(node.title));
    assert((await row.innerText()).includes(node.id));
  }
  assert(
    (
      await outline.locator('li[data-native-id="empty-lesson"]').innerText()
    ).includes("0 child entries observed"),
  );
  assert.equal(
    await outline
      .locator('li[data-native-id="caption-item"] a')
      .getAttribute("href"),
    "https://www.coursera.org/teach/synthetic/shell-course/content/item/supplement/caption-item",
  );
  assert.equal(
    await outline
      .locator('li[data-native-id="archive-caption-copy"] a')
      .getAttribute("href"),
    "https://www.coursera.org/teach/synthetic/shell-course/content/item/supplement/archive-caption-copy",
  );
  assert.equal(
    await outline.locator('li[data-native-id="future-item"] a').count(),
    0,
    "Unknown native kinds retain identity without a guessed item route",
  );
  await page
    .getByRole("group", { name: "Show owner work" })
    .getByRole("button", { name: "All items (4)", exact: true })
    .click();
  assert.equal(
    await page.locator(".action-card").count(),
    4,
    "Empty lesson, Archive copy and future-kind outline rows are structural evidence, not extra owner tasks",
  );
  const cardFor = (id) =>
      page.locator(`.action-card:has(a[href$="/item/supplement/${id}"])`),
    sourceArticle = (card) =>
      card
        .getByRole("region", { name: "Source captured content", exact: true })
        .locator(".captured-content")
        .filter({
          has: page.getByRole("heading", {
            name: "Original Brightspace extraction",
            exact: true,
          }),
        });
  const captionCard = cardFor("caption-item");
  await captionCard.locator(":scope > summary").click();
  const captionContent = sourceArticle(captionCard),
    captionBody = captionContent.getByRole("region", {
      name: "Brightspace source file evidence",
      exact: true,
    });
  await captionBody
    .getByText("Original file retained and verified at import", { exact: true })
    .waitFor();
  assert.equal(
    await captionContent.locator("pre.reading-text").textContent(),
    captions,
  );
  assert.equal(
    await captionContent.locator("pre.reading-text b").count(),
    0,
    "Caption markup is retained literally rather than interpreted as HTML",
  );
  assert.equal(
    await captionContent
      .locator("pre.reading-text")
      .evaluate((node) => getComputedStyle(node).whiteSpace),
    "pre-wrap",
  );
  assert(
    (await captionContent.innerText()).includes(
      `Literal source captions (SRT) · Complete captured field · ${captions.length} retained characters`,
    ),
  );
  assert.equal(
    await captionContent
      .getByText("DO NOT BORROW THIS SAME-TITLE TOPIC", { exact: true })
      .count(),
    0,
  );
  await captionBody
    .getByText("Original file identity and text preview scope", { exact: true })
    .click();
  assert(
    (await captionBody.innerText()).includes(
      `Topic 1001 · Collector outcome: CAPTURED · Format: SRT`,
    ),
  );
  assert(
    (await captionBody.innerText()).includes(
      `Source read recorded: ${observedAt} · ${Buffer.byteLength(captions)} bytes`,
    ),
  );
  assert(
    (await captionBody.innerText()).includes(
      `SHA-256: ${await digest(Buffer.from(captions))}`,
    ),
  );
  assert.equal(
    await captionContent
      .getByRole("link", { name: "Open recorded page ↗", exact: true })
      .getAttribute("href"),
    "https://source.example.test/d2l/le/content/700/viewContent/1001/View",
    "The captured body binds to the exact native topic rather than the same-title sibling",
  );
  await captionContent
    .getByText("Native topic description (separate from file body)", {
      exact: true,
    })
    .click();
  await captionContent.getByText(captionDescription, { exact: true }).waitFor();
  assert.equal(
    await captionContent.locator("pre.reading-text").textContent(),
    captions,
    "Native description metadata does not replace or append to literal source captions",
  );
  const binaryCard = cardFor("binary-item");
  await binaryCard.locator(":scope > summary").click();
  const binaryContent = sourceArticle(binaryCard),
    binaryBody = binaryContent.getByRole("region", {
      name: "Brightspace source file evidence",
      exact: true,
    });
  await binaryBody
    .getByText("Original file retained and verified at import", { exact: true })
    .waitFor();
  assert(
    (await binaryContent.innerText()).includes("Text preview unavailable"),
  );
  await binaryContent
    .locator("details")
    .filter({
      has: page.locator("summary", { hasText: "Text preview unavailable" }),
    })
    .locator(":scope > summary")
    .click();
  await binaryContent
    .getByText(
      "The original source-file bytes were retained and verified, but a readable text projection could not be established. The file is not confirmed empty.",
      { exact: true },
    )
    .waitFor();
  await binaryBody
    .getByText("Original file identity and text preview scope", { exact: true })
    .click();
  await binaryBody
    .getByText("Text projection: UNRESOLVED", { exact: true })
    .waitFor();
  await binaryBody
    .getByText("TEXT_PROJECTION_UNAVAILABLE", { exact: true })
    .waitFor();
  assert.equal(await binaryContent.locator(".reading-text").count(), 0);
  const failedCard = cardFor("failed-item");
  await failedCard.locator(":scope > summary").click();
  const failedContent = sourceArticle(failedCard),
    failedBody = failedContent.getByRole("region", {
      name: "Brightspace source file evidence",
      exact: true,
    });
  await failedBody
    .getByText("Original file capture unresolved", { exact: true })
    .waitFor();
  await failedBody.getByText("HTTP_403", { exact: true }).waitFor();
  assert(
    (await failedContent.innerText()).includes(
      "Topic description · Partial / coverage unverified",
    ),
  );
  assert.equal(
    await failedContent.locator(".reading-text").textContent(),
    specs[2].text,
  );
  await failedBody
    .getByText("Original file identity and text preview scope", { exact: true })
    .click();
  assert.equal(
    await failedBody.getByText("SHA-256:", { exact: false }).count(),
    0,
  );
  await failedContent
    .getByText(
      "The captured native topic description is shown. The source-file body text was not captured; this description does not establish the contents or emptiness of that file.",
      { exact: true },
    )
    .waitFor();
  const htmlCard = cardFor("html-item");
  await htmlCard.locator(":scope > summary").click();
  const htmlContent = sourceArticle(htmlCard),
    htmlBody = htmlContent.getByRole("region", {
      name: "Brightspace source file evidence",
      exact: true,
    });
  const referenceReadoutSummary = htmlBody.getByText(
    "Source file references and read outcomes (2)",
    { exact: true },
  );
  await referenceReadoutSummary.click();
  const references = referenceReadoutSummary.locator("..").locator("ol > li");
  assert.equal(await references.count(), 2);
  assert(
    (await references.nth(0).innerText()).includes(
      "Image (img.src) · Read outcome: UNRESOLVED",
    ),
  );
  await references.nth(0).getByText("HTTP_403", { exact: true }).waitFor();
  assert.equal(
    await references
      .nth(0)
      .getByRole("link", { name: imageUrl, exact: true })
      .getAttribute("href"),
    imageUrl,
  );
  const displayedAlt = references
    .nth(0)
    .getByText(`Authored image alt text: ${alt}`, { exact: true });
  await displayedAlt.waitFor();
  assert.equal(
    await displayedAlt.locator("span").count(),
    0,
    "Authored image alt remains literal text even when the original resource is unavailable",
  );
  assert(
    (await references.nth(1).innerText()).includes(
      "Embedded page (iframe.src) · Read outcome: NOT_FETCHED",
    ),
  );
  await references
    .nth(1)
    .getByText("EXTERNAL_REFERENCE_NOT_FETCHED", { exact: true })
    .waitFor();
  const htmlSnapshot = report.contentEvidence.brightspace.find(
      (entry) => entry.id === "1004",
    ).content,
    structure = htmlBody.locator(
      'details[aria-label="Captured tabs and tables"]',
    );
  assert.equal(htmlSnapshot.capturedAt, capturedAt);
  assert.equal(htmlSnapshot.sourceBody.observedAt, observedAt);
  assert.equal(htmlSnapshot.sourceBody.topicId, "1004");
  assert.equal(
    htmlSnapshot.textCoverage,
    "PARTIAL",
    "A verified static structure does not certify the collector's flat text projection or full source fidelity",
  );
  assert.equal(htmlSnapshot.text, specs[3].text);
  assert.equal(htmlSnapshot.sourceBody.htmlStructure.groups.length, 2);
  await structure.locator(":scope > summary").click();
  assert.equal(await structure.locator("[data-html-group]").count(), 2);
  const firstGroup = structure.locator('[data-html-group="1"]'),
    secondGroup = structure.locator('[data-html-group="2"]'),
    overviewPanel = firstGroup.locator('[data-html-panel="1:0"]'),
    hiddenPanel = firstGroup.locator('[data-html-panel="1:1"]'),
    secondWidgetPanel = secondGroup.locator('[data-html-panel="2:0"]');
  assert.deepEqual(
    await firstGroup
      .locator("[data-html-panel]")
      .evaluateAll((panels) =>
        panels.map((panel) => panel.dataset.htmlPanelKey),
      ),
    ["0", "1"],
  );
  assert.deepEqual(
    await secondGroup
      .locator("[data-html-panel]")
      .evaluateAll((panels) =>
        panels.map((panel) => panel.dataset.htmlPanelKey),
      ),
    ["0"],
    "Repeated panel keys belong to their own D2L widget",
  );
  assert.equal(
    await overviewPanel.locator(":scope > summary").textContent(),
    "Overview",
  );
  assert.equal(
    await hiddenPanel.locator(":scope > summary").textContent(),
    "Hidden practice",
  );
  assert.equal(
    await secondWidgetPanel.locator(":scope > summary").textContent(),
    "Second widget",
  );
  await overviewPanel.locator(":scope > summary").click();
  await hiddenPanel.locator(":scope > summary").click();
  await secondWidgetPanel.locator(":scope > summary").click();
  await hiddenPanel
    .getByText("Hidden panel authored content.", { exact: true })
    .waitFor();
  await secondWidgetPanel
    .getByText("Second widget key-zero content.", { exact: true })
    .waitFor();
  assert.equal(
    await overviewPanel
      .getByText("Second widget key-zero content.", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await secondWidgetPanel
      .getByText("First widget visible panel.", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await structure
      .getByText("DO NOT BORROW THIS SAME-TITLE HTML PANEL", { exact: true })
      .count(),
    0,
    "The static HTML projection stays bound to native topic 1004 despite a same-title source copy",
  );
  const table = overviewPanel.locator('[data-html-table="1:0:1"]');
  await table.locator(":scope > summary").click();
  assert.equal(
    await table.locator("table > caption").textContent(),
    "Authored learning outcomes",
  );
  assert.deepEqual(
    await table
      .locator("table tr")
      .evaluateAll((rows) =>
        rows.map((row) =>
          Array.from(row.children).map((cell) => [
            cell.tagName.toLowerCase(),
            cell.textContent,
          ]),
        ),
      ),
    [
      [
        ["th", "Topic"],
        ["th", "Outcome"],
      ],
      [
        ["th", "Drawing"],
        ["td", "Read a drawing & explain its symbols."],
      ],
      [
        ["td", ""],
        ["td", "Authored spanning cell"],
      ],
    ],
    "Captured table headers, row order, literal cells and authored empty cells remain distinct",
  );
  await table
    .getByText("Authored cell span attributes", { exact: true })
    .click();
  await table
    .getByText('Row 3, cell 2 (td) · colspan="2"', { exact: true })
    .waitFor();
  await overviewPanel
    .getByText("Authored resource references (2)", { exact: true })
    .click();
  const overviewResources = overviewPanel.locator("[data-html-resource]");
  assert.equal(await overviewResources.count(), 2);
  await overviewResources
    .nth(0)
    .getByText("Authored image alt: empty attribute", { exact: true })
    .waitFor();
  await overviewResources
    .nth(1)
    .getByText("Authored image alt: attribute absent", { exact: true })
    .waitFor();
  await hiddenPanel
    .getByText("Authored resource references (2)", { exact: true })
    .click();
  const hiddenResources = hiddenPanel.locator("[data-html-resource]");
  assert.equal(await hiddenResources.count(), 2);
  await hiddenResources
    .nth(0)
    .getByText(`Authored image alt: ${alt}`, { exact: true })
    .waitFor();
  await hiddenResources.nth(0).getByText("HTTP_403", { exact: true }).waitFor();
  await hiddenResources
    .nth(1)
    .getByText("Authored title: Named synthetic LTI activity", { exact: true })
    .waitFor();
  assert(
    (await hiddenResources.nth(1).innerText()).includes(
      "Read outcome: NOT_FETCHED",
    ),
  );
  await hiddenResources
    .nth(1)
    .getByText("EXTERNAL_REFERENCE_NOT_FETCHED", { exact: true })
    .waitFor();
  await hiddenResources
    .nth(1)
    .getByText(`Authored URL: ${externalUrl}`, { exact: true })
    .waitFor();
  assert.equal(
    await secondWidgetPanel.locator("[data-html-resource]").count(),
    0,
    "A repeated panel key cannot borrow another group's LTI or image references",
  );
  assert.equal(
    await structure
      .locator("a, iframe, img, script, style, video, audio, object, embed")
      .count(),
    0,
    "Static HTML structure renders text and cells without source markup, executable content or runtime media nodes",
  );
  assert.equal(
    await page.evaluate(() => window.__ctiGuideHtmlExecuted),
    undefined,
    "The authored script trap stays inert",
  );
  assert.deepEqual(
    externalRequests,
    [],
    "Inspecting static source panels never requests the recorded image or LTI URLs",
  );
  assert.equal(
    await htmlContent
      .locator("iframe, img, video, audio, object, embed")
      .count(),
    0,
    "Displaying saved references never loads or executes the external resources",
  );
  await hiddenPanel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "static-source-tabs-desktop.png"),
  });
  await captionContent.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "literal-source-captions-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await table.scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Captured table cells remain within the mobile page while their own table can scroll",
  );
  await page.screenshot({
    path: path.join(shots, "static-source-table-mobile.png"),
  });
  await hiddenResources.nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shots, "static-source-tab-resources-mobile.png"),
  });
  await htmlBody.scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Source-body metadata and literal references fit mobile width",
  );
  await page.screenshot({
    path: path.join(shots, "source-body-outcomes-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const evidenceEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download full evidence", exact: true })
    .click();
  const exported = JSON.parse(
    fs.readFileSync(await (await evidenceEvent).path(), "utf8"),
  );
  assert.deepEqual(
    exported.result,
    report.result,
    "Opening shell and source evidence leaves original QA decisions unchanged",
  );
  assert.deepEqual(exported.followUp.contentEvidence, report.contentEvidence);
  const captionView = exported.followUp.contentComparisons.find(
      (entry) => entry.name === specs[0].title,
    ).view,
    boundCaption = captionView.source.filter(
      (entry) => entry.basis === "Original Brightspace extraction",
    );
  assert.equal(boundCaption.length, 1);
  assert.equal(boundCaption[0].sourceBody.topicId, "1001");
  assert.equal(boundCaption[0].text, captions);
  const htmlView = exported.followUp.contentComparisons.find(
      (entry) => entry.name === specs[3].title,
    ).view,
    boundHtml = htmlView.source.filter(
      (entry) => entry.basis === "Original Brightspace extraction",
    );
  assert.equal(boundHtml.length, 1);
  assert.equal(boundHtml[0].sourceBody.topicId, "1004");
  assert.deepEqual(
    boundHtml[0].sourceBody.htmlStructure,
    htmlSnapshot.sourceBody.htmlStructure,
    "Report exports retain the exact same native-topic-bound static HTML structure",
  );
  assert.equal(boundHtml[0].sourceBody.observedAt, observedAt);
  assert.equal(boundHtml[0].capturedAt, capturedAt);
  assert.equal(boundHtml[0].textCoverage, "PARTIAL");
  const reportEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download complete report", exact: true })
    .click();
  const text = fs.readFileSync(await (await reportEvent).path(), "utf8");
  assert(
    text.includes(captions),
    "Readable exports preserve complete source-caption timing, markup and line breaks",
  );
  assert(text.includes("Original-body integrity: VERIFIED_RETAINED_ORIGINAL"));
  assert(text.includes("Text projection: UNRESOLVED"));
  assert(text.includes("Collection outcome: EXTERNAL_REFERENCE_NOT_FETCHED"));
  assert(text.includes(alt));
  assert(!text.includes("DO NOT BORROW THIS SAME-TITLE TOPIC"));
  assert(text.includes("Hidden panel authored content."));
  assert(text.includes("Authored learning outcomes"));
  assert(text.includes("Named synthetic LTI activity"));
  assert(!text.includes("DO NOT BORROW THIS SAME-TITLE HTML PANEL"));
  await openReport(invalidAudit.title);
  await page.getByTestId("native-course-outline-error").waitFor();
  assert(
    (
      await page.getByTestId("native-course-outline-error").innerText()
    ).startsWith("Captured Coursera shell outline could not be shown:"),
  );
  assert.equal(await page.getByTestId("native-course-outline").count(), 0);
  assert.equal(
    await page.locator("[data-native-id]").count(),
    0,
    "A mismatched native course identity cannot appear as verified shell evidence",
  );
  page.off("request", recordExternalRequest);
  assert.deepEqual(
    externalRequests,
    [],
    "Read-only source-shell rendering never launches recorded external resources",
  );
}
function nativeGradingBrowserFixture() {
  const source = comparisonFixture(),
    title = gradingFixture().item.name;
  source.course.data.scan.courseTree[0].children = [
    { ...source.course.data.scan.courseTree[0].children[0], title },
  ];
  source.course.data.scan.stats = {
    webcontent: 1,
    discussions: 0,
    quizzes: 0,
    assignments: 0,
    lti: 0,
    emptyFolders: 0,
    totalItems: 1,
    ifs: 1,
  };
  source.excel.bytes = writeWorkbook({
    name: "synthetic-native-grading",
    sheets: {
      "FOR IMPORT": {
        values: [
          ["Module"],
          ["***Name", "Module 1"],
          ["Lesson"],
          ["***Name", "Lesson 1"],
          ["Graded Assignment", title, "", "", "", "", "", "gradingItem"],
        ],
      },
    },
  });
  const cases = [
    { key: "true", graded: true, expected: true },
    { key: "false", graded: false, expected: false },
    { key: "foreign-course", graded: true, expected: undefined },
    { key: "missing-proof", graded: true, expected: undefined },
  ].map((variant) => {
    // The fixture contains an exact atom/relation/stability model. In
    // particular, its published value and the title disagree with one of the
    // draft settings, so neither can substitute for the captured native field.
    const { item } = gradingFixture(variant.graded),
      courseId =
        variant.key === "foreign-course"
          ? "Foreign_grading_course_123"
          : gradingCourseId;
    item.path = "Module 1";
    item.lesson = "Lesson 1";
    if (variant.key === "missing-proof") delete item.payload.directDataSources;
    const capture = {
      schemaVersion: 34,
      extractedAt: "2026-10-17T11:00:00.000Z",
      page: {
        title: "Synthetic native grading settings",
        courseId,
        url: `https://www.coursera.org/teach/${gradingCourseSlug}/${courseId}/content/edit`,
      },
      meta: { buildId: "synthetic-test-only" },
      fingerprints: [item],
    };
    const report = createWorkflows(workerXml).compare({
      ...source,
      json: {
        name: `synthetic-grading-${variant.key}.json`,
        bytes: encode(capture),
      },
    });
    assert.deepEqual(
      report.contentEvidence,
      buildContentSnapshot(undefined, undefined, capture),
    );
    validateContentSnapshot(report.contentEvidence);
    const setting = report.contentEvidence.coursera[0].content.nativeGrading;
    assert.equal(setting?.graded, variant.expected);
    assert.equal(
      report.contentEvidence.coursera[0].content.questionCoverage,
      "UNVERIFIED",
    );
    assert.equal(
      report.contentEvidence.coursera[0].content.expectedQuestions,
      null,
    );
    assert.equal(
      report.result.ownerView.items.length,
      1,
      "A captured grading readout does not create additional owner items",
    );
    const tasksBeforeReadout = buildOwnerTasks(
      report.result,
      source.course.data.scan.courseTree,
    );
    assert.equal(tasksBeforeReadout.length, 1);
    report.result.ownerView.items[0].status = "EVIDENCE_NEEDED";
    report.result.ownerView.items[0].actions = [
      {
        action: "Review this synthetic assessment observation.",
        severity: "EVIDENCE",
        verdict: "UNVERIFIED",
      },
    ];
    return {
      ...variant,
      setting,
      report,
      audit: {
        ...source.course,
        id: `native-grading-${variant.key}-audit`,
        kind: "audit",
        packageId: source.course.id,
        title: `Synthetic native grading: ${variant.key}`,
        data: report,
      },
    };
  });
  return { source, cases };
}

async function checkNativeGradingEvidence(page, tab, shots) {
  const fixture = nativeGradingBrowserFixture();
  await tab("Setup");
  await page.getByLabel("Workspace migration or backup JSON").setInputFiles({
    name: "synthetic-native-grading.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        kind: "CTI_BROWSER_WORKSPACE",
        schemaVersion: 1,
        records: [
          fixture.source.course,
          ...fixture.cases.map((entry) => entry.audit),
        ],
      }),
    ),
  });
  await page
    .getByRole("button", { name: "Import prepared records", exact: true })
    .click();
  await page.getByText("Imported 5 records;", { exact: false }).waitFor();
  await page
    .getByRole("combobox", { name: "Selected source course", exact: true })
    .selectOption(fixture.source.course.id);
  await page.locator(".full-workspace .status").waitFor({ state: "hidden" });
  for (const entry of fixture.cases) {
    await tab("History");
    await page
      .getByRole("button", { name: entry.audit.title, exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Coursera content view", exact: true })
      .waitFor();
    await page
      .getByRole("group", { name: "Show owner work" })
      .getByRole("button", { name: "All items (1)", exact: true })
      .click();
    assert.equal(await page.locator(".action-card").count(), 1);
    const card = page.locator(".action-card");
    await card.locator(":scope > summary").click();
    const content = card.getByRole("region", {
        name: "Coursera captured content",
        exact: true,
      }),
      setting = content.getByRole("region", {
        name: "Captured grading setting",
        exact: true,
      });
    if (entry.expected === undefined) {
      assert.equal(
        await setting.count(),
        0,
        `${entry.key} cannot display an independently bound native grading setting`,
      );
    } else {
      await setting
        .getByText(entry.expected ? "Graded" : "Not graded", { exact: true })
        .waitFor();
      await setting
        .getByText(
          `Native field: draft.content.definition.configuration.isGraded = ${entry.expected}`,
          { exact: true },
        )
        .waitFor();
      await setting
        .getByText("Observed: 2026-10-17T10:00:00.000Z", { exact: true })
        .waitFor();
      await setting
        .getByText(
          "This records the grading toggle only. Passing score, attempts, complete assessment behavior, learner operation and published state are not established by this setting.",
          { exact: true },
        )
        .waitFor();
      await setting
        .getByText("Native grading source identity", { exact: true })
        .click();
      const identity = await setting.locator(".captured-text").textContent();
      for (const field of [
        `Course: ${entry.setting.courseId}`,
        `Item: ${entry.setting.itemId}`,
        `Atom: ${entry.setting.atomId}`,
        `Content: ${entry.setting.contentId}`,
        `Draft SHA-256: ${entry.setting.draftHash}`,
        "Scope: GRADING_SETTING_ONLY",
      ])
        assert(
          identity.includes(field),
          `Captured grading identity must retain ${field}`,
        );
      assert.equal(
        await card
          .getByRole("region", { name: "Source captured content", exact: true })
          .getByRole("region", {
            name: "Captured grading setting",
            exact: true,
          })
          .count(),
        0,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await setting.scrollIntoViewIfNeeded();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Native grading source identity fits mobile width",
      );
      await page.screenshot({
        path: path.join(shots, `native-grading-${entry.key}-mobile.png`),
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    assert.equal(await page.locator(".action-card").count(), 1);
    const evidenceEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download full evidence", exact: true })
      .click();
    const exported = JSON.parse(
      fs.readFileSync(await (await evidenceEvent).path(), "utf8"),
    );
    assert.deepEqual(
      exported.result,
      entry.report.result,
      "Inspecting the native grading field cannot change original owner findings",
    );
    assert.deepEqual(
      exported.followUp.contentEvidence.coursera[0].content.nativeGrading,
      entry.setting,
    );
    assert.deepEqual(
      exported.followUp.contentComparisons[0].view.coursera.nativeGrading,
      entry.setting,
    );
    assert.equal(exported.followUp.automatedResolution, false);
  }
}

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
    .getByText("Current v6.15.33 item check copied.", { exact: false })
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
    await sourceContent
      .getByText("Authored image alt text", { exact: true })
      .count(),
    0,
    "Legacy content without authored alt values adds no disclosure",
  );
  await destinationContent
    .getByText("Authored image alt text", { exact: true })
    .click();
  const displayedImageAlt = destinationContent.getByText(imageAltText, {
    exact: true,
  });
  await displayedImageAlt.waitFor();
  assert.equal(
    await displayedImageAlt.locator("span").count(),
    0,
    "Literal image alt markup stays text",
  );
  const imageAltDisclosure = displayedImageAlt.locator("..").locator("..");
  assert.equal(
    await imageAltDisclosure
      .getByText("Source image 2", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await imageAltDisclosure
      .getByText("Source image 1", { exact: true })
      .count(),
    0,
    "Empty authored alt values do not invent a visible label",
  );
  const firstQuestion = destinationContent
      .locator(".captured-questions > li")
      .first(),
    displayedChoiceFeedback = firstQuestion.getByText(
      "Captured feedback: " + choiceFeedback,
      { exact: true },
    );
  await displayedChoiceFeedback.waitFor();
  assert.equal(
    await displayedChoiceFeedback.locator("span").count(),
    0,
    "Literal feedback markup stays text",
  );
  assert.equal(
    await firstQuestion
      .getByText("Captured feedback:", { exact: true })
      .count(),
    1,
    "Empty option feedback does not add a feedback label",
  );
  await page
    .getByLabel("Find captured question text", { exact: true })
    .fill(choiceFeedback);
  assert.equal(
    await destinationContent.locator(".captured-questions > li").count(),
    1,
    "Question search includes authored choice feedback",
  );
  assert.equal(
    await sourceContent.locator(".captured-questions > li").count(),
    0,
  );
  await page
    .getByLabel("Find captured question text", { exact: true })
    .fill("");
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
  assert.deepEqual(
    data.followUp.contentComparisons[0].view.coursera.imageAltText,
    [
      { imageOrdinal: 1, text: "" },
      { imageOrdinal: 2, text: imageAltText },
    ],
    "Authored image alt values retain exact source ordinals and text in saved exports",
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
  assert(exportedText.includes(imageAltText));
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
  await checkPanoptoMetadata(page, tab, shots);
  await checkSourceShellEvidence(page, tab, shots);
  await checkNativeGradingEvidence(page, tab, shots);
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
          "Panopto response paste/file import, same-title wrong-recording rejection, failed refresh preservation, literal OCR/navigation labels, reported-only caption absence, review/reload persistence, complete metadata exports and unchanged audit at desktop and 390px",
          "verified literal source captions, retained binary versus failed-read outcomes, native topic identity, authored resource alt/read reasons, immutable exports, empty native shell folders, repeated-title Archive placements, unsupported-kind links and visible invalid-proof rejection at desktop and 390px",
          "verified source HTML: hidden tab content, scoped repeated D2L keys, table headers/cell order/empty cells/spans, named LTI and authored image-alt distinctions, exact native topic exports, unchanged partial text coverage and observation times, inert scripts and zero external resource requests at desktop and 390px",
          "independently bound native graded and not-graded settings with identity/scope/time, foreign-course and missing-proof suppression, unchanged owner item counts and original findings, exact exported readouts and 390px layout",
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
