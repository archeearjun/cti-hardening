import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import JSZip from "jszip";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function checkContentReviewBundle(page) {
  const text = Buffer.from(
      "Exact source café text.\r\nHidden tab text remains retained.\r\n",
    ),
    sha = hash(text),
    url = "https://source.example.test/content/enforced/123/guide.txt",
    observedAt = "2026-10-18T00:00:00.000Z";
  const receipt = {
    requestUrl: url,
    responseUrl: url,
    status: 200,
    complete: true,
    observedAt,
    bytes: text.length,
    sha256: sha,
    contentType: "text/plain",
  };
  const capture = {
    schemaVersion: 2,
    extractor: "CTI Brightspace synthetic",
    capturedAt: observedAt,
    page: { url: "https://source.example.test/d2l/home/123" },
    originalBodyTransport: {
      format: "CTI_BRIGHTSPACE_ARCHIVE_V1",
      version: 1,
      bodyEncoding: "archive",
      hashAlgorithm: "SHA-256",
    },
    assetBodies: {
      [sha]: {
        encoding: "archive",
        archivePath: "files/" + sha,
        bytes: text.length,
        sha256: sha,
      },
    },
    contentTree: [
      {
        kind: "TOPIC",
        id: "topic-1",
        title: "Native guide",
        url,
        contentEvidence: {
          status: "CAPTURED_ORIGINAL",
          originalRef: sha,
          contentType: "text/plain",
          url,
          bodyReceipt: receipt,
        },
      },
    ],
    contentAcquisition: {
      assets: [
        {
          url,
          status: "CAPTURED_ORIGINAL",
          originalRef: sha,
          bytes: text.length,
          sha256: sha,
          mediaType: "text/plain",
          receipt,
          sourceBindings: [{ kind: "TOPIC", id: "topic-1" }],
        },
      ],
      gaps: [{ reason: "UNCHANGED_SOURCE_GAP" }],
    },
    quizzes: [],
    assignments: [],
    discussions: [],
  };
  const zip = new JSZip(),
    native = Buffer.from(JSON.stringify(capture)),
    compressed = gzipSync(native);
  zip.file("capture.json.gz", compressed, { createFolders: false });
  zip.file("files/" + sha, text, { createFolders: false });
  const source = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
  });
  const input = page.getByLabel("Original capture archive for content review", {
      exact: true,
    }),
    button = page.getByRole("button", {
      name: "Prepare content review bundle",
      exact: true,
    });
  const requests = [],
    downloads = [];
  const observeRequest = (request) => {
    if (
      request.method() !== "GET" ||
      (/^https?:/.test(request.url()) &&
        new URL(request.url()).origin !== new URL(page.url()).origin)
    )
      requests.push({ method: request.method(), url: request.url() });
  };
  const observeDownload = (download) => downloads.push(download);
  page.on("request", observeRequest);
  page.on("download", observeDownload);
  try {
    await input.setInputFiles({
      name: "synthetic-original.cti.zip",
      mimeType: "application/zip",
      buffer: source,
    });
    await button.click();
    const link = page.getByRole("link", {
      name: "Download content review bundle",
      exact: true,
    });
    await link.waitFor();
    assert.deepEqual(
      downloads,
      [],
      "Review preparation never automatically requests a download",
    );
    const firstHref = await link.getAttribute("href");
    assert(firstHref.startsWith("blob:"));
    const pending = page.waitForEvent("download");
    await link.click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    const review = await JSZip.loadAsync(
        fs.readFileSync(await download.path()),
        { checkCRC32: true },
      ),
      manifest = JSON.parse(
        await review.file("review-manifest.json").async("string"),
      );
    assert.equal(manifest.kind, "CTI_CAPTURE_REVIEW_BUNDLE");
    assert.equal(manifest.notForCourseAudit, true);
    assert.equal(manifest.original.sha256, hash(source));
    assert.equal(manifest.counts.includedTextOriginals, 1);
    assert.deepEqual(
      Buffer.from(
        await review.file("native-capture/capture.json.gz").async("uint8array"),
      ),
      compressed,
    );
    assert.deepEqual(
      gunzipSync(
        await review.file("native-capture/capture.json.gz").async("uint8array"),
      ),
      native,
    );
    assert.deepEqual(
      Buffer.from(
        await review.file("original-text/files/" + sha).async("uint8array"),
      ),
      text,
    );
    assert.equal(
      await link.getAttribute("href"),
      firstHref,
      "The successful download leaves a persistent link",
    );
    assert.deepEqual(
      requests,
      [],
      "Preparing a review never uploads the capture or visits LMS/provider URLs",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Content review controls fit a phone viewport",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await input.setInputFiles({
      name: "synthetic-original.cti.zip",
      mimeType: "application/zip",
      buffer: source,
    });
    await page.evaluate(() => {
      window.fixtureOriginalReviewWorker = window.Worker;
      window.Worker = class extends window.Worker {
        postMessage() {
          window.fixtureDelayedReviewWorker = this;
        }
        terminate() {
          window.fixtureReviewWorkerTerminated = true;
          super.terminate();
        }
      };
    });
    await button.click();
    await page
      .getByRole("button", { name: "Cancel review preparation", exact: true })
      .click();
    await page
      .getByText(
        "Review preparation cancelled. Your original capture is unchanged.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.fixtureReviewWorkerTerminated),
      true,
    );
    await page.evaluate(() => {
      window.fixtureDelayedReviewWorker.onmessage({
        data: { kind: "result", result: {} },
      });
      window.Worker = window.fixtureOriginalReviewWorker;
    });
    assert.equal(
      await link.count(),
      0,
      "Cancellation cannot publish a late worker result",
    );
    await input.setInputFiles({
      name: "wrong.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await button.click();
    await page
      .getByRole("alert")
      .filter({
        hasText: "Choose the original Brightspace or Coursera .cti.zip capture",
      })
      .waitFor();
    assert.equal(
      await link.count(),
      0,
      "A failed new selection cannot reuse a previous download URL",
    );
  } finally {
    page.off("request", observeRequest);
    page.off("download", observeDownload);
  }
}
