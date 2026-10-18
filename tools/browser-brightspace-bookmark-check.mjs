import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import JSZip from "jszip";
import { gunzipSync } from "node:zlib";

// Synthetic, authenticated source fixtures only. This verifies the maintained
// bookmark and browser mechanics, not the completeness of any private course.
// CI requires actual javascript: navigation. An explicit local diagnostic flag
// permits the identical source through the debugger only after a no-CSP canary
// proves that managed Chromium policy blocks even a trivial bookmark.
const allowPolicyBlockedReader =
  process.env.CTI_ALLOW_BOOKMARK_POLICY_BLOCKED === "1";
const outputDirectory = "/tmp/cti-brightspace-bookmark";
fs.mkdirSync(outputDirectory, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cti-brightspace-"));
const orgUnitId = "187960";
const coursePath = `/d2l/le/lessons/${orgUnitId}`;
const fixturePath = "/__cti_brightspace_bookmark__.html";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5B8AAAAASUVORK5CYII=",
  "base64",
);
const pdf = Buffer.from("%PDF-1.4\n% CTI original outline fixture\n%%EOF\n");
// Synthetic original-file header; this does not certify CAD rendering.
const dwg = Buffer.alloc(512);
dwg.write("AC1032");
dwg.write("Original opaque drawing fixture", 128);
const dwgPath = `/content/enforced/${orgUnitId}-DEV/Content/original-plan.dwg`;
const captions =
  "1\n00:00:00,000 --> 00:00:01,200\nUse <valve> & keep 10 > 5.\n\n2\n00:00:02,000 --> 00:00:03,500\nOriginal résumé, untouched.\n\n";
const plainText =
  "  Original <drawing> & literal text.\n10 > 5\n\nKeep this final space. \n";
const longText = "Original architectural drawing details. ".repeat(2600);
const longHtml = `<!doctype html><html><head><title>Original reading</title></head><body><h1>Architectural drawings</h1><p>${longText}</p><pre>&lt;beam&gt; &amp; original notation</pre><img src="/content/shared.png" alt="Original drawing"><img src="/content/cross-origin.jpg" alt="Blocked redirect"><img src="https://external-source.invalid/original.jpg" alt="External reference"><a href="/content/outline.pdf">Original course outline</a><iframe src="/d2l/common/dialogs/quickLink/quickLink.d2l?ou=${orgUnitId}&type=lti&rCode=fixture-lti"></iframe><iframe src="https://nait.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=59e8c889-654e-40f2-b073-b31c006c433b"></iframe><iframe src="https://fixture.yuja.com/Embed/fixture"></iframe></body></html>`;
const courseFilePath = `/d2l/common/dialogs/quickLink/quickLink.d2l?ou=${orgUnitId}&type=coursefile&fileId=Outline.pdf`;
const moduleDefinition = {
  Id: 9001,
  Type: 0,
  Title: "Original module",
  Description: {
    Html:
      '<p>Original module description.</p><img src="/content/shared.png" alt="Module drawing"><a href="/content/outline.pdf">Course outline</a>' +
      `<a href="${courseFilePath.replace(/&/g, "&amp;")}">Native course-file redirect</a>`,
  },
};
const topics = [
  { Id: 101, Title: "Long original reading", Url: "/content/long.html" },
  { Id: 102, Title: "Original captions", Url: "/content/captions.srt" },
  { Id: 103, Title: "Original drawing", Url: "/content/shared.png" },
  { Id: 104, Title: "Repeated original reading", Url: "/content/long.html" },
  {
    Id: 105,
    Title: "Native quiz placement",
    Url: `/d2l/lms/quizzing/user/quiz_summary.d2l?qi=201&ou=${orgUnitId}`,
    ActivityType: 4,
    ActivityId: 201,
  },
  {
    Id: 106,
    Title: "External source placement",
    Url: "https://external-source.invalid/original",
    ActivityType: 2,
  },
  { Id: 107, Title: "Original plain text", Url: "/content/literal.txt" },
  { Id: 108, Title: "Original CAD drawing", Url: dwgPath },
].map((topic) => ({ Type: 1, TopicType: 1, ParentModuleId: 9001, ...topic }));
const requests = [];
const unexpectedRequests = [];
const errors = [];
let retainedOriginals = new Map();
let origin = "";
let foreignOrigin = "";
let foreignRequests = 0;
const foreignServer = http.createServer((_request, response) => {
  foreignRequests++;
  response.writeHead(200, { "Content-Type": "image/png" });
  response.end(image);
});
let slowNextReading = false;
const json = (response, value) => {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
};
const sourceServer = http.createServer((request, response) => {
  const url = new URL(request.url, origin || "http://127.0.0.1");
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (url.pathname === coursePath) {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader(
      "Set-Cookie",
      "fixtureSession=original-read-access; HttpOnly; SameSite=Lax; Path=/",
    );
    response.end(
      '<!doctype html><title>Content - Original Brightspace fixture</title><h1 data-testid="course-title">Original Brightspace fixture</h1><main>Existing course content page.</main>',
    );
    return;
  }
  const receipt = {
    path: url.pathname,
    query: url.search,
    method: request.method,
    authenticated: request.headers.cookie?.includes(
      "fixtureSession=original-read-access",
    ),
  };
  requests.push(receipt);
  if (request.method !== "GET") unexpectedRequests.push(receipt);
  const prefix = `/d2l/api/le/1.75/${orgUnitId}`;
  if (url.pathname === "/d2l/api/le/versions/")
    return json(response, { LatestVersion: "1.75" });
  if (url.pathname === `${prefix}/content/root/`)
    return json(response, [moduleDefinition]);
  if (url.pathname === `${prefix}/content/modules/9001/structure/`)
    return json(response, topics);
  const topicId = url.pathname.match(
    new RegExp(`^${prefix}/content/topics/(\\d+)/?$`),
  )?.[1];
  if (topicId) {
    const topic = topics.find((candidate) => String(candidate.Id) === topicId);
    if (topic) return json(response, topic);
  }
  if (url.pathname === `${prefix}/dropbox/folders/`)
    return json(
      response,
      url.searchParams.has("page")
        ? {
            Objects: [{ Id: 302, Name: "Second native assignment" }],
            Next: null,
          }
        : {
            Objects: [
              {
                Id: 301,
                Name: "First native assignment",
                Instructions: {
                  Html: "<p>Original assignment instructions.</p>",
                },
              },
            ],
            Next: `${prefix}/dropbox/folders/?page=2`,
          },
    );
  if (url.pathname === `${prefix}/quizzes/`)
    return json(
      response,
      url.searchParams.has("page")
        ? {
            Objects: [{ QuizId: 202, Name: "Observed question subset" }],
            Next: null,
          }
        : {
            Objects: [
              {
                QuizId: 201,
                Name: "Final Assessment",
                Description: { Text: "This quiz contains 70 questions." },
              },
            ],
            Next: `${prefix}/quizzes/?page=2`,
          },
    );
  if (url.pathname === `${prefix}/quizzes/201/questions/`)
    return json(response, { Objects: [], Next: null });
  if (url.pathname === `${prefix}/quizzes/202/questions/`)
    return json(response, {
      Objects: [
        {
          QuestionId: 7001,
          QuestionTypeId: 1,
          QuestionText: { Text: "Original question <symbol>?" },
          QuestionInfo: {
            Answers: [
              { Answer: { Text: "Original A" }, Weight: 100 },
              { Answer: { Text: "Original B" }, Weight: 0 },
            ],
          },
        },
      ],
      Next: null,
    });
  if (url.pathname === `${prefix}/discussions/forums/`)
    return json(
      response,
      url.searchParams.has("page")
        ? { Objects: [{ ForumId: 402, Name: "Second forum" }], Next: null }
        : {
            Objects: [{ ForumId: 401, Name: "First forum" }],
            Next: `${prefix}/discussions/forums/?page=2`,
          },
    );
  if (/\/discussions\/forums\/(401|402)\/topics\/$/.test(url.pathname))
    return json(response, {
      Objects: [
        {
          TopicId: Number(url.pathname.includes("401") ? 801 : 802),
          Name: "Original discussion definition",
          Description: { Html: "<p>Original discussion prompt.</p>" },
        },
      ],
      Next: null,
    });
  if (
    url.pathname === "/d2l/common/dialogs/quickLink/quickLink.d2l" &&
    url.searchParams.get("type") === "coursefile" &&
    url.searchParams.get("fileId") === "Outline.pdf"
  ) {
    response.writeHead(302, { Location: "/content/outline.pdf" });
    response.end();
    return;
  }
  if (url.pathname === "/content/cross-origin.jpg") {
    response.writeHead(302, { Location: foreignOrigin + "/original.png" });
    response.end();
    return;
  }
  const originals = {
    "/content/long.html": ["text/html; charset=utf-8", Buffer.from(longHtml)],
    "/content/captions.srt": ["text/srt; charset=utf-8", Buffer.from(captions)],
    "/content/literal.txt": [
      "text/plain; charset=utf-8",
      Buffer.from(plainText),
    ],
    "/content/shared.png": ["image/png", image],
    "/content/outline.pdf": ["application/pdf", pdf],
    [dwgPath]: ["application/acad", dwg],
  };
  if (originals[url.pathname]) {
    const [type, body] = originals[url.pathname];
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": body.length,
    });
    if (url.pathname === "/content/long.html" && slowNextReading) {
      slowNextReading = false;
      setTimeout(() => response.end(body), 1200);
    } else response.end(body);
    return;
  }
  unexpectedRequests.push(receipt);
  response.writeHead(404);
  response.end("Unexpected synthetic source request");
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function checkpointFingerprint(json) {
  const chunks = [];
  for (let start = 0; start < json.length; ) {
    let end = Math.min(json.length, start + 1048576);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(sha256(Buffer.from(json.slice(start, end))));
    start = end;
  }
  return sha256(Buffer.from(JSON.stringify(chunks)));
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function poll(read, message, milliseconds = 20_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await pause(30);
  }
  throw Error(message);
}
function flatten(tree) {
  return tree.flatMap((node) => [node, ...flatten(node.children || [])]);
}
function assertOriginal(capture, reference, original) {
  const digest = sha256(original);
  assert.equal(
    reference,
    digest,
    "Original reference must be its actual SHA-256",
  );
  const body = capture.assetBodies[reference];
  assert(body, "Capture must include the referenced original body");
  assert.equal(body.encoding, "archive");
  assert.equal(body.archivePath, "files/" + digest);
  const bytes = retainedOriginals.get(digest);
  assert(bytes, "An archive descriptor must resolve to its committed original Blob");
  assert.deepEqual(
    bytes,
    original,
    "Archived bytes must equal the source bytes",
  );
  assert.equal(body.bytes, original.length);
  assert.equal(body.sha256, digest);
}
function verifyCapture(capture) {
  assert.match(capture.extractor, /Brightspace/i);
  assert.equal(capture.course.orgUnitId, orgUnitId);
  const nodes = flatten(capture.contentTree);
  assert.equal(nodes.filter((node) => node.kind === "MODULE").length, 1);
  assert.equal(
    nodes.filter((node) => node.kind === "TOPIC").length,
    topics.length,
  );
  const reading = nodes.find((node) => node.id === "101").contentEvidence;
  assert.equal(reading.status, "CAPTURED");
  assert.equal(reading.html, longHtml);
  assert(
    reading.text.length > 80_000,
    "A reading must survive the former text cap",
  );
  assert(reading.text.includes(longText));
  assert(reading.text.includes("<beam> & original notation"));
  assert.equal(reading.textLength, reading.text.length);
  assert.equal(reading.textSha256, sha256(Buffer.from(reading.text)));
  assert.equal(reading.projectionTruncated, false);
  assertOriginal(capture, reading.rawBodyRef, Buffer.from(longHtml));
  for (const [id, text, format] of [
    ["102", captions, "srt"],
    ["107", plainText, "text"],
  ]) {
    const evidence = nodes.find((node) => node.id === id).contentEvidence;
    assert.equal(evidence.status, "CAPTURED");
    assert.equal(evidence.format, format);
    assert.equal(
      evidence.text,
      text,
      "Plain text must not be parsed as HTML or normalized",
    );
    assert.equal(evidence.textSha256, sha256(Buffer.from(text)));
    assertOriginal(capture, evidence.rawBodyRef, Buffer.from(text));
  }
  const drawing = nodes.find((node) => node.id === "103").contentEvidence;
  assert.equal(drawing.status, "CAPTURED_ORIGINAL");
  assertOriginal(capture, drawing.originalRef, image);
  const cad = nodes.find((node) => node.id === "108").contentEvidence;
  assert.equal(cad.status, "CAPTURED_ORIGINAL");
  assert.equal(cad.contentType, "application/acad");
  assertOriginal(capture, cad.originalRef, dwg);
  const assets = capture.contentAcquisition.assets;
  const shared = assets.find(
    (asset) => asset.url === origin + "/content/shared.png",
  );
  assert(shared, "Module/page image reference must be inventoried");
  assert.equal(shared.status, "CAPTURED_ORIGINAL");
  assertOriginal(capture, shared.originalRef, image);
  for (const id of ["9001", "101", "103", "104"])
    assert(
      shared.sourceBindings.some((binding) => String(binding.id) === id),
      "Repeated asset must preserve each exact source placement: " + id,
    );
  const outline = assets.find(
    (asset) => asset.url === origin + "/content/outline.pdf",
  );
  assertOriginal(capture, outline.originalRef, pdf);
  assert(
    outline.sourceBindings.some(
      (binding) => binding.kind === "MODULE" && String(binding.id) === "9001",
    ),
  );
  const redirected = assets.find(
    (asset) => asset.url === origin + courseFilePath,
  );
  assert(
    redirected,
    "Native course-file quicklinks must retain their original bytes",
  );
  assertOriginal(capture, redirected.originalRef, pdf);
  assert.equal(redirected.receipt.requestUrl, origin + courseFilePath);
  assert.equal(redirected.receipt.responseUrl, origin + "/content/outline.pdf");
  assert.equal(redirected.receipt.mode, "same-origin");
  assert.equal(
    foreignRequests,
    0,
    "Cross-origin redirects must be blocked before an external HTTP request",
  );
  const crossOrigin = assets.find(
    (asset) => asset.url === origin + "/content/cross-origin.jpg",
  );
  assert.equal(crossOrigin.status, "UNRESOLVED");
  assert(!crossOrigin.originalRef);
  assert.equal(
    capture.assignments.length,
    2,
    "Assignment continuation must not disappear",
  );
  assert.equal(
    capture.discussions.length,
    2,
    "Forum continuation must not disappear",
  );
  assert.equal(capture.quizzes.length, 2);
  const empty = capture.quizzes.find((quiz) => quiz.id === "201");
  assert.equal(empty.questions.length, 0);
  assert.equal(empty.declaredQuestionCount, 70);
  assert.equal(empty.questionCoverage.completenessVerified, false);
  assert.equal(
    capture.quizzes.find((quiz) => quiz.id === "202").questions[0].QuestionText
      .Text,
    "Original question <symbol>?",
  );
  assert(
    capture.quizzes.every(
      (quiz) => quiz.questionCoverage.completenessVerified === false,
    ),
    "Completed API pages must not certify unknown bank/pool coverage",
  );
  assert(
    capture.captureWarnings.length > 0,
    "Unresolved source coverage must remain visible",
  );
  assert(
    !JSON.stringify(capture).includes("fixtureSession=original-read-access"),
    "Browser credentials must not enter the exported evidence",
  );
}

let vite, browser;
try {
  await new Promise((resolve) => foreignServer.listen(0, "127.0.0.1", resolve));
  foreignOrigin = "http://127.0.0.1:" + foreignServer.address().port;
  await new Promise((resolve) => sourceServer.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + sourceServer.address().port;
  vite = await createServer({
    configFile: path.resolve("vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    optimizeDeps: {
      entries: [path.resolve("web/SourceLmsCapture.tsx")],
      include: [
        "react",
        "react-dom/client",
        "react/jsx-dev-runtime",
        "@noble/hashes/sha2.js",
      ],
    },
    plugins: [
      {
        name: "cti-brightspace-bookmark-component-fixture",
        configureServer(viteServer) {
          viteServer.middlewares.use(async (request, response, next) => {
            if (request.url?.split("?")[0] !== fixturePath) return next();
            try {
              const html = await viteServer.transformIndexHtml(
                fixturePath,
                `<!doctype html><title>CTI Brightspace bookmark setup fixture</title><div id="root"></div><script type="module">
                import React,{useState} from 'react';
                import {createRoot} from 'react-dom/client';
                import SourceLmsCapture from '/SourceLmsCapture.tsx';
                function Fixture(){const[disabled,setDisabled]=useState(false);return React.createElement(React.Fragment,null,
                  React.createElement('button',{id:'fixture-toggle',onClick:()=>setDisabled(value=>!value)},'Toggle fixture disabled'),
                  React.createElement(SourceLmsCapture,{disabled,partner:'nce',courseTitle:'Original Brightspace fixture',selectedFile:'',onUseCapture:()=>{},onPlan:()=>{},onCompare:()=>{}}));}
                createRoot(document.getElementById('root')).render(React.createElement(Fixture));
              </script>`,
              );
              response.setHeader("Content-Type", "text/html; charset=utf-8");
              response.end(html);
            } catch (error) {
              next(error);
            }
          });
        },
      },
    ],
  });
  await vite.listen();
  const setupOrigin = "http://127.0.0.1:" + vite.httpServer.address().port;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CTI_CHROMIUM_PATH
      ? { executablePath: process.env.CTI_CHROMIUM_PATH }
      : { channel: "chromium" }),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: setupOrigin,
  });
  const externalRequests = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (
      /^https?:/.test(url) &&
      !url.startsWith(origin + "/") &&
      !url.startsWith(setupOrigin + "/")
    ) {
      externalRequests.push(url);
      return route.abort();
    }
    return route.continue();
  });
  const setup = await context.newPage();
  setup.on("pageerror", (error) => errors.push(error.message));
  await setup.goto(setupOrigin + fixturePath);
  const component = setup.getByRole("region", {
    name: "Brightspace bookmark setup",
    exact: true,
  });
  const bookmark = component.getByRole("link", {
    name: "CTI Brightspace capture",
    exact: true,
  });
  await bookmark.waitFor();
  assert.equal(await bookmark.getAttribute("draggable"), "true");
  const emitted = await bookmark.getAttribute("href");
  assert(emitted.startsWith("javascript:"));
  assert(Buffer.byteLength(emitted) < 500 * 1024);
  assert.equal(
    await component
      .getByRole("textbox", {
        name: "CTI Brightspace capture bookmark address",
        includeHidden: true,
      })
      .inputValue(),
    emitted,
  );
  await bookmark.click();
  assert.equal(
    requests.length,
    0,
    "Clicking CTI's installation link must not run the extractor in CTI",
  );
  assert.equal(
    await setup.evaluate(() => window.__CTI_BRIGHTSPACE_PROGRESS__),
    undefined,
  );
  await component
    .getByRole("button", {
      name: "Copy Brightspace bookmark address",
      exact: true,
    })
    .click();
  assert.equal(
    await setup.evaluate(() => navigator.clipboard.readText()),
    emitted,
  );
  await setup.locator("#fixture-toggle").click();
  assert.equal(
    await component
      .getByRole("link", { name: "CTI Brightspace capture", exact: true })
      .count(),
    0,
  );
  assert(
    await component
      .getByRole("button", {
        name: "Copy Brightspace bookmark address",
        exact: true,
      })
      .isDisabled(),
  );
  await setup.locator("#fixture-toggle").click();
  assert.equal(await bookmark.getAttribute("href"), emitted);
  await setup.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("Synthetic clipboard denial")),
    }),
  );
  await component
    .getByRole("button", {
      name: "Copy Brightspace bookmark address",
      exact: true,
    })
    .click();
  await component
    .getByText("Complete Brightspace bookmark address copy fallback", {
      exact: true,
    })
    .click();
  await component
    .getByRole("textbox", {
      name: "CTI Brightspace capture bookmark address",
      exact: true,
    })
    .focus();
  assert.deepEqual(
    await component
      .getByRole("textbox", {
        name: "CTI Brightspace capture bookmark address",
        exact: true,
      })
      .evaluate((field) => [
        field.selectionStart,
        field.selectionEnd,
        field.value.length,
      ]),
    [0, emitted.length, emitted.length],
  );

  let nativeBookmarkExecuted = true;
  let canary;
  async function invoke(page) {
    const session = await context.newCDPSession(page);
    const navigation = await session.send("Page.navigate", {
      url: emitted,
      transitionType: "auto_bookmark",
    });
    let observed = false;
    try {
      await poll(
        () => page.evaluate(() => Boolean(window.__CTI_BRIGHTSPACE_PROGRESS__)),
        "Native bookmark did not open the Brightspace capture card",
        2000,
      );
      observed = true;
    } catch {
      /* Diagnose native policy with a separately observed canary below. */
    }
    if (!observed) {
      if (!canary) {
        const canaryPage = await context.newPage();
        await canaryPage.goto(origin + coursePath);
        const canarySession = await context.newCDPSession(canaryPage);
        const result = await canarySession.send("Page.navigate", {
          url: "javascript:void(window.__CTI_BOOKMARK_CANARY=true)",
          transitionType: "auto_bookmark",
        });
        await pause(250);
        canary = {
          error: result.errorText || null,
          executed: await canaryPage.evaluate(
            () => window.__CTI_BOOKMARK_CANARY === true,
          ),
        };
        await canarySession.detach();
        await canaryPage.close();
      }
      assert(
        allowPolicyBlockedReader &&
          process.env.CTI_CHROMIUM_PATH === "/usr/bin/chromium" &&
          navigation.errorText === "net::ERR_ABORTED" &&
          canary.error === "net::ERR_ABORTED" &&
          !canary.executed,
        "Native bookmark navigation failed; debugger-only fallback is not enabled or its policy canary did not establish the restriction",
      );
      nativeBookmarkExecuted = false;
      const result = await session.send("Runtime.evaluate", {
        expression: decodeURIComponent(emitted.slice("javascript:".length)),
        userGesture: true,
        returnByValue: true,
      });
      assert.equal(result.exceptionDetails, undefined);
    }
    return session;
  }
  async function clickControl(page, session, label) {
    const { root } = await session.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    let button;
    const nodeText = (node) =>
      (node.nodeValue || "") + (node.children || []).map(nodeText).join("");
    function walk(node) {
      if (["BUTTON", "A"].includes(node.nodeName) && nodeText(node) === label) button = node;
      for (const child of [
        ...(node.children || []),
        ...(node.shadowRoots || []),
      ])
        walk(child);
    }
    walk(root);
    assert(button, "Closed-shadow capture control must exist: " + label);
    const { model } = await session.send("DOM.getBoxModel", {
      nodeId: button.nodeId,
    });
    const box = model.content;
    await page.mouse.click(
      (box[0] + box[2] + box[4] + box[6]) / 4,
      (box[1] + box[3] + box[5] + box[7]) / 4,
    );
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + coursePath);
  let session = await invoke(page);
  assert.equal(
    requests.length,
    0,
    "Opening the bookmark must not initiate a capture",
  );
  const secondSession = await invoke(page);
  await secondSession.detach();
  assert.equal(
    await page.locator('[data-cti-progress="true"]').count(),
    1,
    "Repeated bookmark activation must reveal the same launcher",
  );
  assert.equal(requests.length, 0);
  slowNextReading = true;
  await clickControl(page, session, "Capture/resume");
  await poll(
    () => requests.some((request) => request.path === "/content/long.html"),
    "Capture must read the original source page",
  );
  await clickControl(page, session, "Pause");
  await poll(
    () =>
      page.evaluate(
        () => window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__ === false,
      ),
    "Pause must settle the active source capture",
  );
  assert.equal(
    await page.evaluate(
      () => window.__CTI_BRIGHTSPACE_PROGRESS__.snapshot().phase,
    ),
    "Paused",
  );
  const checkpoint = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cti-brightspace-source-v110", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("runs", "readonly");
        const request = transaction.objectStore("runs").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
  assert(
    checkpoint.length > 0,
    "Pause must retain a durable course checkpoint",
  );
  assert(checkpoint.some((record) => record.status === "PAUSED"));
  for (const record of checkpoint) {
    assert.equal(record.origin, origin);
    assert.equal(String(record.courseId), orgUnitId);
    assert.equal(record.fingerprintAlgorithm, "SHA256_CHUNKS_V1");
    assert.equal(record.payloadFingerprint, checkpointFingerprint(record.json));
  }
  await session.detach();
  await page.reload();
  const pausedRequestCount = requests.length;
  session = await invoke(page);
  assert.equal(
    requests.length,
    pausedRequestCount,
    "Reloading the launcher must not silently start source requests",
  );
  await clickControl(page, session, "Capture/resume");
  await poll(
    () =>
      page.evaluate(
        () =>
          window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__ === false &&
          Boolean(window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_LAST__),
      ),
    "Resumed capture must finish",
    45_000,
  );
  const capture = await page.evaluate(
    () => window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_LAST__,
  );
  const terminal = await page.evaluate(() =>
    window.__CTI_BRIGHTSPACE_PROGRESS__.snapshot(),
  );
  assert.equal(terminal.phase, "Capture finished");
  assert.match(terminal.count, /original files retained/);
  assert.match(terminal.count, /unresolved references/);
  const blobs = await page.evaluate(async (runId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cti-brightspace-originals-v120", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction("bodies", "readonly"), request = tx.objectStore("bodies").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const retained = [];
      for (const row of rows) if (JSON.parse(row.scope)[3] === runId)
        retained.push([row.sha256, Array.from(new Uint8Array(await row.blob.arrayBuffer()))]);
      return retained;
    } finally { db.close(); }
  }, capture.attempt.id);
  retainedOriginals = new Map(blobs.map(([hash, bytes]) => [hash, Buffer.from(bytes)]));
  assert.equal(capture.originalBodyTransport.format, "CTI_BRIGHTSPACE_ARCHIVE_V1");
  assert.equal(capture.originalBodyTransport.runId, capture.attempt.id);
  assert(!JSON.stringify(capture.assetBodies).includes("base64"));
  verifyCapture(capture);
  const downloadEvent = page.waitForEvent("download");
  await clickControl(page, session, "Download saved capture");
  const download = await downloadEvent;
  const downloadedPath = path.join(scratch, download.suggestedFilename());
  await download.saveAs(downloadedPath);
  assert.match(
    download.suggestedFilename(),
    new RegExp(
      `^CTI__BRIGHTSPACE__.+__ORG_${orgUnitId}__\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z__v1\\.2\\.0_s2__SOURCE_GROUND_TRUTH\\.cti\\.zip$`,
    ),
  );
  assert.equal(download.suggestedFilename(), capture.exportFileName);
  const archive = await JSZip.loadAsync(fs.readFileSync(downloadedPath), { checkCRC32: true }),
    downloaded = JSON.parse(gunzipSync(await archive.file("capture.json.gz").async("uint8array")));
  assert.equal(Object.keys(archive.files).length, Object.keys(capture.assetBodies).length + 1);
  for (const [hash, bytes] of retainedOriginals)
    assert.deepEqual(Buffer.from(await archive.file("files/" + hash).async("uint8array")), bytes);
  verifyCapture(downloaded);
  assert.equal(downloaded.exportFileName, capture.exportFileName);
  assert.deepEqual(downloaded.contentTree, capture.contentTree);
  const resumedRequests = requests.slice(pausedRequestCount);
  assert.equal(
    resumedRequests.filter((request) => request.path === "/content/shared.png")
      .length,
    1,
    "Repeated exact image URLs must share one body read per attempt",
  );
  assert(resumedRequests.every((request) => request.method === "GET"));
  assert(resumedRequests.every((request) => request.authenticated));
  assert.equal(
    unexpectedRequests.length,
    0,
    "Capture must not launch LTI or read dynamic/learner endpoints",
  );
  assert.equal(
    externalRequests.length,
    0,
    "Provider references must not trigger cross-origin source reads",
  );
  await page.screenshot({
    path: path.join(outputDirectory, "finished-capture.png"),
    fullPage: true,
  });
  await session.detach();

  // A closed/reopened page must resolve persisted archive descriptors to the
  // same original Blobs without rereading native definitions or file bodies.
  await page.reload();
  const recoveryRequestCount = requests.length;
  session = await invoke(page);
  const recoveredDownload = page.waitForEvent("download");
  await clickControl(page, session, "Download saved capture");
  const recovered = await recoveredDownload;
  const recoveredPath = path.join(scratch, "recovered-" + recovered.suggestedFilename());
  await recovered.saveAs(recoveredPath);
  assert.equal(sha256(fs.readFileSync(recoveredPath)), sha256(fs.readFileSync(downloadedPath)));
  assert.equal(requests.length, recoveryRequestCount, "Historical archive download must not create fresh source observations");
  await pause(2200);
  const linkDownload = page.waitForEvent("download");
  await clickControl(page, session, "Save prepared capture file");
  const linkSaved = await linkDownload;
  assert.equal(linkSaved.suggestedFilename(), capture.exportFileName);
  await session.detach();

  // Browser storage denial must become a visible pause, never an unsupported
  // claim that the current source observations are durably retained.
  const deniedPage = await context.newPage();
  deniedPage.on("pageerror", (error) => errors.push(error.message));
  await deniedPage.addInitScript(() => {
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value() {
        throw new DOMException("Synthetic storage denial", "SecurityError");
      },
    });
  });
  await deniedPage.goto(origin + coursePath);
  const deniedSession = await invoke(deniedPage);
  await clickControl(deniedPage, deniedSession, "Capture/resume");
  const failedStorage = await poll(
    () =>
      deniedPage.evaluate(() => {
        const progress = window.__CTI_BRIGHTSPACE_PROGRESS__?.snapshot();
        return progress?.storageError && !progress.running ? progress : null;
      }),
    "Storage denial must leave a visible error and settle capture",
  );
  assert.match(failedStorage.storageError, /checkpoint|storage|saved/i);
  const afterStorageFailure = requests.length;
  await pause(300);
  assert.equal(
    requests.length,
    afterStorageFailure,
    "Storage failure must not silently continue new source reads",
  );
  assert.equal(
    await deniedPage.evaluate(
      () => window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__,
    ),
    false,
  );
  await deniedPage.screenshot({
    path: path.join(outputDirectory, "checkpoint-storage-denied.png"),
    fullPage: true,
  });
  await deniedSession.detach();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      check: "Brightspace bookmark",
      nativeBookmarkExecuted,
      policyCanary: nativeBookmarkExecuted ? undefined : canary,
      captureTopics: capture.summary.topics,
      capturedDefinitions: capture.summary.quizQuestions,
      originalBodies: Object.keys(capture.assetBodies).length,
      verified: [
        "setup copy and disabled boundary",
        "on-page start and pause",
        "durable checkpoint reload",
        "visible pause on storage denial",
        "actual archive download, exact original files, persistent download link and page-reload recovery",
        "long HTML and literal captions",
        "original asset bytes and exact source placements",
        "inventory pagination",
        "quiz uncertainty",
        "read-only request scope",
        "same-origin course-file redirects and blocked cross-origin redirects",
      ],
      limitation:
        "Synthetic source fixtures do not certify completeness of live Brightspace courses or external providers.",
    }),
  );
} finally {
  await browser?.close();
  await vite?.close();
  await new Promise((resolve) => sourceServer.close(resolve));
  if (foreignServer.listening)
    await new Promise((resolve) => foreignServer.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
}
