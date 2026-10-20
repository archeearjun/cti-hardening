import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import JSZip from "jszip";
import { ownerAccessFixture } from "./browser-owner-fixture.mjs";
import { workspaceNav } from "./browser-workspace-navigation.mjs";
import { recordSummary } from "../src/domain/workspace-store.ts";

const MAX_PART_BYTES = 24 * 1024 * 1024;
const WORKSPACE_CHUNK_BYTES = 128 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const upload = (name, buffer, mimeType = "application/json") => ({
  name,
  buffer,
  mimeType,
});

// These are synthetic transport files, not course evidence or a fidelity claim.
export async function largeCaptureSharingFixtures() {
  const json = Buffer.from(
    JSON.stringify({
      synthetic: true,
      nativeText: "Tabs\tand original CRLF\r\n🧬 Empty: <td></td>",
      originalFiles: ['<iframe title="literal only"></iframe>'.repeat(40000)],
    }) + "\r\n",
  );
  const archive = new JSZip();
  archive.file("synthetic-original.bin", randomBytes(20 * 1024 * 1024));
  const zip = await archive.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
  });
  return [
    {
      ...upload("synthetic-source.json", json),
      encoding: "GZIP",
      partCount: 1,
    },
    {
      ...upload(
        "synthetic-capture.json.gz",
        gzipSync(json),
        "application/gzip",
      ),
      encoding: "IDENTITY",
      partCount: 1,
    },
    {
      ...upload("synthetic-originals.cti.zip", zip, "application/zip"),
      encoding: "IDENTITY",
      partCount: 2,
    },
  ];
}

export function verifyDownloadedCaptureParts(manifest, files, original) {
  assert.equal(manifest.kind, "CTI_CAPTURE_TRANSFER_MANIFEST");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.notForCourseAudit, true);
  assert.equal(manifest.original.fileName, original.name);
  assert.equal(manifest.original.bytes, original.buffer.length);
  assert.equal(manifest.original.sha256, sha256(original.buffer));
  assert.equal(manifest.maxPartFileBytes, MAX_PART_BYTES);
  assert.equal(manifest.partCount, original.partCount);
  assert.equal(manifest.transport.encoding, original.encoding);
  assert.equal(files.length, manifest.partCount);
  const decoded = [];
  let offset = 0;
  for (const [index, bytes] of files.entries()) {
    const receipt = manifest.parts[index];
    assert(
      bytes.length <= MAX_PART_BYTES,
      "The JSON envelope counts toward the 24 MiB attachment limit",
    );
    assert.equal(receipt.fileBytes, bytes.length);
    assert.equal(receipt.fileSha256, sha256(bytes));
    const part = JSON.parse(bytes.toString("utf8"));
    assert.equal(part.kind, "CTI_CAPTURE_TRANSFER_PART");
    assert.equal(part.schemaVersion, 1);
    assert.equal(part.notForCourseAudit, true);
    assert.equal(part.payloadEncoding, "BASE64");
    assert.equal(part.transferId, manifest.transferId);
    assert.equal(part.index, index + 1);
    assert.equal(part.partCount, files.length);
    assert.equal(part.offset, offset);
    assert.equal(receipt.offset, offset);
    const payload = Buffer.from(part.data, "base64");
    assert.equal(part.payloadBytes, payload.length);
    assert.equal(receipt.payloadBytes, payload.length);
    assert.equal(part.payloadSha256, sha256(payload));
    assert.equal(receipt.payloadSha256, sha256(payload));
    offset += payload.length;
    decoded.push(payload);
  }
  const transport = Buffer.concat(decoded);
  assert.equal(transport.length, manifest.transport.bytes);
  assert.equal(sha256(transport), manifest.transport.sha256);
  const restored =
    manifest.transport.encoding === "GZIP" ? gunzipSync(transport) : transport;
  assert.deepEqual(
    restored,
    original.buffer,
    "Original UTF-8, whitespace, media bytes and filename are preserved losslessly",
  );
}

async function downloadBytes(page, link) {
  const pending = page.waitForEvent("download");
  await link.click();
  const file = await pending;
  assert.equal(await file.failure(), null);
  return {
    name: file.suggestedFilename(),
    bytes: fs.readFileSync(await file.path()),
  };
}

export async function checkLargeCaptureSharing(browser, base) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  await ownerAccessFixture(context);
  const page = await context.newPage();
  const errors = [],
    outside = [],
    writes = [],
    downloads = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["http:", "https:"].includes(url.protocol) &&
      url.origin !== new URL(base).origin
    )
      outside.push(url.origin);
    if (
      url.pathname.startsWith("/api/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      writes.push(request.method() + " " + url.pathname);
  });
  try {
    await page.goto(base + "/?tool=share");
    const panel = page.getByRole("region", {
      name: "Send the complete file to this chat",
      exact: true,
    });
    await panel.waitFor();
    const picker = panel.getByLabel("Existing complete file to share", {
      exact: true,
    });
    const prepare = panel.getByRole("button", {
      name: "Prepare complete file for chat",
      exact: true,
    });
    for (const file of await largeCaptureSharingFixtures()) {
      const before = downloads.length;
      await picker.setInputFiles(upload(file.name, file.buffer, file.mimeType));
      assert.equal(
        await panel
          .getByRole("link", { name: "Download manifest", exact: true })
          .count(),
        0,
        "Choosing a replacement clears old download URLs immediately",
      );
      await prepare.click();
      const manifestLink = panel.getByRole("link", {
        name: "Download manifest",
        exact: true,
      });
      await manifestLink.waitFor({ timeout: 120000 });
      assert.equal(
        downloads.length,
        before,
        "Preparing files never starts an automatic download loop",
      );
      assert.equal(
        await panel
          .getByRole("link", { name: /^Download part \d+ of \d+$/ })
          .count(),
        file.partCount,
      );
      const firstManifest = await downloadBytes(page, manifestLink);
      const manifest = JSON.parse(firstManifest.bytes.toString("utf8"));
      assert(firstManifest.name.endsWith(".manifest.json"));
      const partFiles = [];
      for (let index = 0; index < file.partCount; index++) {
        const downloaded = await downloadBytes(
          page,
          panel.getByRole("link", {
            name: `Download part ${index + 1} of ${file.partCount}`,
            exact: true,
          }),
        );
        assert.equal(downloaded.name, manifest.parts[index].fileName);
        partFiles.push(downloaded.bytes);
      }
      verifyDownloadedCaptureParts(manifest, partFiles, file);
      const repeatedManifest = await downloadBytes(page, manifestLink);
      assert.deepEqual(
        repeatedManifest,
        firstManifest,
        "A user can retry a persistent download link without preparing or rescanning again",
      );
      assert.equal(downloads.length, before + file.partCount + 2);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Large capture filenames and part links fit a phone viewport",
    );
    assert.deepEqual(
      writes,
      [],
      "File transfer packaging never writes to a shared workspace or LMS",
    );
    assert.deepEqual(
      outside,
      [],
      "File packaging never contacts an LMS, media host or other external service",
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(
      "LARGE CAPTURE SHARING",
      await page.locator("main").innerText(),
    );
    await page.screenshot({
      path: "/tmp/cti-large-intake-sharing-failure.png",
    });
    throw error;
  } finally {
    await context.close();
  }

  // A deterministic stopped worker retains its old callback so that a late
  // message can be exercised even after terminate(). Real worker packaging and
  // downloads are independently verified above.
  const cancelledContext = await browser.newContext();
  await ownerAccessFixture(cancelledContext);
  await cancelledContext.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__ctiTransferWorkers = [];
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes("capture-transfer"))
          return new NativeWorker(url, options);
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
        window.__ctiTransferWorkers.push(this);
      }
      postMessage(data) {
        this.fileName = data.file.name;
      }
      terminate() {
        this.terminated = true;
      }
    };
  });
  const cancelledPage = await cancelledContext.newPage();
  const cancelledErrors = [];
  cancelledPage.on("pageerror", (error) => cancelledErrors.push(error.message));
  try {
    await cancelledPage.goto(base + "/?tool=share");
    const panel = cancelledPage.getByRole("region", {
      name: "Send the complete file to this chat",
      exact: true,
    });
    const picker = panel.getByLabel("Existing complete file to share", {
      exact: true,
    });
    const prepare = panel.getByRole("button", {
      name: "Prepare complete file for chat",
      exact: true,
    });
    await picker.setInputFiles(upload("cancelled.json", Buffer.from("{}")));
    await prepare.click();
    await panel
      .getByRole("button", { name: "Cancel file preparation", exact: true })
      .click();
    await panel
      .getByRole("status")
      .filter({ hasText: "Preparation cancelled" })
      .waitFor();
    await cancelledPage.evaluate(() => {
      const old = window.__ctiTransferWorkers[0];
      if (!old.terminated) throw Error("Cancel must terminate its worker");
      old.onmessage({
        data: { kind: "progress", phase: "STALE_CANCELLED_PROGRESS" },
      });
      old.onmessage({
        data: { kind: "error", message: "STALE_CANCELLED_ERROR" },
      });
      old.onmessage({
        data: {
          kind: "result",
          result: {
            manifest: {
              original: { bytes: 1 },
              transport: { bytes: 1 },
              warnings: [],
            },
            manifestFile: new File(["{}"], "STALE.manifest.json"),
            partFiles: [new File(["{}"], "STALE.part.json")],
          },
        },
      });
    });
    assert.equal(await panel.getByText(/STALE_CANCELLED/).count(), 0);
    assert.equal(
      await panel
        .getByRole("link", { name: "Download manifest", exact: true })
        .count(),
      0,
    );
    await picker.setInputFiles(upload("replacement.json", Buffer.from("{}")));
    await prepare.click();
    await cancelledPage.evaluate(() => {
      window.__ctiTransferWorkers[0].onmessage({
        data: { kind: "error", message: "STALE_REPLACED_ERROR" },
      });
      window.__ctiTransferWorkers[1].onmessage({
        data: { kind: "progress", phase: "Current replacement is preparing" },
      });
    });
    await panel
      .getByRole("status")
      .filter({ hasText: "Current replacement is preparing" })
      .waitFor();
    assert.equal(await panel.getByText(/STALE_REPLACED/).count(), 0);
    await panel
      .getByRole("button", { name: "Cancel file preparation", exact: true })
      .click();
    assert(await prepare.isEnabled());
    assert.deepEqual(cancelledErrors, []);
  } finally {
    await cancelledContext.close();
  }
}

/** A synthetic team API deliberately loses commit responses. It implements
 * the real chunked client protocol, including byte hashes and stable IDs; it
 * neither calls a production service nor bypasses the comparison worker. */
function comparisonSaveApi(input, mode) {
  const actor = { email: "synthetic-owner@example.test", role: "editor" };
  const course = {
    ...structuredClone(input.course),
    version: 1,
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: actor.email,
  };
  if (mode === "lost-saved") course.data.transferPadding = "x".repeat(270000);
  let downloadBusy = mode === "lost-saved";
  const records = new Map([[course.id, course]]);
  const uploads = new Map();
  const uploadBindings = new Map();
  const events = [];
  const faults = { session: false, list: false };
  const json = (route, value, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  const uploadStatus = (upload) => ({
    id: upload.id,
    ...upload.manifest,
    receivedParts: [...upload.chunks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([part, bytes]) => ({
        part,
        bytes: bytes.length,
        digest: sha256(bytes),
      })),
    committed: upload.committed,
    ...(upload.savedRecord ? { savedRecord: upload.savedRecord } : {}),
  });
  let commits = 0;
  async function route(route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\//, "");
    const method = request.method();
    events.push({ path, method });
    if (method === "GET" && path === "session") {
      if (faults.session)
        return json(route, { error: "Synthetic session unavailable." }, 503);
      return json(route, actor);
    }
    if (method === "GET" && path === "records") {
      if (faults.list)
        return json(
          route,
          { error: "Synthetic record listing unavailable." },
          503,
        );
      return json(route, { records: [...records.values()].map(recordSummary) });
    }
    const recordPath =
      /^records\/([^/]+)(?:\/(chunks|versions)(?:\/(\d+))?)?$/.exec(path);
    if (method === "GET" && recordPath) {
      const id = decodeURIComponent(recordPath[1]);
      const saved = records.get(id);
      if (id !== course.id && mode === "transient")
        return json(route, { error: "Synthetic temporary read failure." }, 503);
      if (!saved) return json(route, { error: "Record not found." }, 404);
      if (recordPath[2] === "versions") return json(route, { versions: [] });
      const bytes = Buffer.from(JSON.stringify(saved.data));
      if (recordPath[2] === "chunks") {
        const part = Number(recordPath[3]);
        if (id === course.id && part === 1 && downloadBusy) {
          downloadBusy = false;
          return route.fulfill({status:503,contentType:"application/json",
            headers:{"Retry-After":"1"},body:JSON.stringify({error:"The workspace is processing other evidence."})});
        }
        assert(part < Math.ceil(bytes.length / WORKSPACE_CHUNK_BYTES));
        return route.fulfill({
          contentType: "application/octet-stream",
          body: bytes.subarray(
            part * WORKSPACE_CHUNK_BYTES,
            (part + 1) * WORKSPACE_CHUNK_BYTES,
          ),
        });
      }
      return json(route, {
        record: recordSummary(saved),
        parts: Math.ceil(bytes.length / WORKSPACE_CHUNK_BYTES),
        sha256: sha256(bytes),
        revision: "fixture-saved-revision",
      });
    }
    if (method === "POST" && path === "uploads") {
      const manifest = request.postDataJSON();
      assert.equal(manifest.record.kind, "audit");
      assert.equal(manifest.record.packageId, course.id);
      assert.equal(manifest.record.version, 0);
      assert.equal(
        manifest.parts,
        Math.ceil(manifest.bytes / WORKSPACE_CHUNK_BYTES),
      );
      assert.equal(manifest.allowSemanticDuplicate, false);
      const binding = JSON.stringify([
        actor.email,
        manifest.record,
        manifest.bytes,
        manifest.parts,
        manifest.sha256,
        manifest.allowSemanticDuplicate,
      ]);
      let id = uploadBindings.get(binding);
      if (!id) {
        id = `fixture-upload-${uploads.size + 1}`;
        uploads.set(id, {
          id,
          manifest,
          chunks: new Map(),
          committed: false,
        });
        uploadBindings.set(binding, id);
      }
      return json(route, uploadStatus(uploads.get(id)));
    }
    const uploadPath = /^uploads\/([^/]+)$/.exec(path);
    if (method === "GET" && uploadPath) {
      const upload = uploads.get(uploadPath[1]);
      if (!upload) return json(route, { error: "Upload not found." }, 404);
      return json(route, uploadStatus(upload));
    }
    const chunkPath = /^uploads\/([^/]+)\/chunks\/(\d+)$/.exec(path);
    if (method === "PUT" && chunkPath) {
      const upload = uploads.get(chunkPath[1]);
      assert(upload);
      const part = Number(chunkPath[2]);
      const bytes = request.postDataBuffer();
      assert(part < upload.manifest.parts);
      assert.equal(
        bytes.length,
        Math.min(
          WORKSPACE_CHUNK_BYTES,
          upload.manifest.bytes - part * WORKSPACE_CHUNK_BYTES,
        ),
      );
      if (upload.chunks.has(part))
        assert.deepEqual(upload.chunks.get(part), bytes);
      upload.chunks.set(part, bytes);
      return json(route, { success: true });
    }
    const commitPath = /^uploads\/([^/]+)\/commit$/.exec(path);
    if (method === "POST" && commitPath) {
      const upload = uploads.get(commitPath[1]);
      assert(upload);
      assert.equal(request.postDataJSON().allowSemanticDuplicate, false);
      const { manifest, chunks } = upload;
      assert.equal(chunks.size, manifest.parts);
      const bytes = Buffer.concat(
        Array.from({ length: manifest.parts }, (_, index) => chunks.get(index)),
      );
      assert.equal(bytes.length, manifest.bytes);
      assert.equal(sha256(bytes), manifest.sha256);
      const saved = {
        ...manifest.record,
        data: JSON.parse(bytes.toString("utf8")),
        version: manifest.record.version + 1,
        updatedAt: "2026-10-01T01:00:00.000Z",
        updatedBy: actor.email,
      };
      commits++;
      if (commits > 1 || mode === "lost-saved") {
        records.set(saved.id, saved);
        upload.committed = true;
        upload.savedRecord = recordSummary(saved);
      }
      if (commits === 1)
        return route.fulfill({
          status: 503,
          contentType: "text/html",
          headers: {
            "cf-ray": "synthetic-intake-BOM",
            "cf-error-type": "synthetic-finalization",
            "cf-error-origin": "synthetic-workspace",
          },
          body: "<html><body>Synthetic temporary finalization error</body></html>",
        });
      return json(route, { record: recordSummary(saved) });
    }
    throw Error(`Unexpected synthetic comparison request: ${method} ${path}`);
  }
  return {
    route,
    course,
    records,
    uploads,
    events,
    faults,
    commits: () => commits,
  };
}

function assertRecoveryEvidenceUnchanged(current, original, message) {
  const currentEvidence = JSON.parse(current.toString("utf8"));
  const originalEvidence = JSON.parse(original.toString("utf8"));
  const diagnostic = currentEvidence.localComparisonRecovery.lastSaveFailure;
  delete currentEvidence.localComparisonRecovery.lastSaveFailure;
  delete originalEvidence.localComparisonRecovery.lastSaveFailure;
  assert.deepEqual(currentEvidence, originalEvidence, message);
  return diagnostic;
}

export async function checkUnconfirmedComparisonRecovery(browser, base, input) {
  for (const mode of ["lost-saved", "missing", "transient"]) {
    const api = comparisonSaveApi(input, mode);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    });
    await context.addInitScript(() =>
      localStorage.setItem("cti-workspace-mode", "team"),
    );
    await context.route("**/api/**", (route) => api.route(route));
    await ownerAccessFixture(context);
    let fullCti = true;
    await context.route("**/api/access", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ fullCti }),
      }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(base + (mode === "lost-saved" ? "/?tool=share" : ""));
      if (mode === "lost-saved") {
        await page
          .getByRole("button", { name: "Full CTI workspace", exact: true })
          .click();
      }
      const coursePicker = page.getByRole("combobox", {
        name: "Selected source course",
        exact: true,
      });
      await coursePicker
        .locator(`option[value="${api.course.id}"]`)
        .waitFor({ state: "attached" });
      await coursePicker.selectOption(api.course.id);
      if (mode === "lost-saved")
        await page.getByText(/chunk 2\/3: temporary failure.*HTTP 503.*retry 2\/6/).waitFor();
      await page
        .locator(".full-workspace .status")
        .waitFor({ state: "hidden" });
      if (mode === "lost-saved") {
        assert.equal(api.events.filter(e=>e.path===`records/${api.course.id}/chunks/0`).length,1);
        assert.equal(api.events.filter(e=>e.path===`records/${api.course.id}/chunks/1`).length,2);
      }
      await workspaceNav(page, "Source LMS");
      const sourceShare = page.getByRole("link", {
        name: "Share or split a large capture",
        exact: true,
      });
      assert.equal(await sourceShare.getAttribute("href"), "?tool=share");
      assert.equal(await sourceShare.getAttribute("target"), "_blank");
      await workspaceNav(page, "Compare");
      const shareLinks = page.getByRole("link", {
        name: "Share or split this capture",
        exact: true,
      });
      assert.equal(
        await shareLinks.count(),
        2,
        "Both source and destination inputs expose the large-file tool",
      );
      for (const link of await shareLinks.all())
        assert.equal(await link.getAttribute("href"), "?tool=share");
      await page
        .getByLabel(/^Coursera XLSX/)
        .setInputFiles(
          upload(
            input.excel.name,
            Buffer.from(input.excel.bytes),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ),
        );
      await page
        .getByLabel("Coursera full capture JSON")
        .setInputFiles(upload(input.json.name, Buffer.from(input.json.bytes)));
      await page.getByLabel("Snapshot stage").selectOption("raw");
      const run = page.getByRole("button", {
        name: "Run and save full comparison",
        exact: true,
      });
      await run.click();
      const pending = page.getByTestId("pending-comparison-save");
      await pending
        .getByRole("heading", {
          name: "Comparison completed; shared save unconfirmed",
          exact: true,
        })
        .waitFor();
      await page.getByRole("alert").filter({ hasText: "HTTP 503" }).waitFor();
      assert.equal(
        api.commits(),
        1,
        "A non-JSON commit response is never automatically repeated",
      );
      assert.equal(await page.getByText(/^Full report saved \(/).count(), 0);
      assert(
        await run.isDisabled(),
        "An unresolved computed report cannot silently allocate a replacement ID",
      );
      assert(
        await coursePicker.isDisabled(),
        "Pending evidence stays bound to its original course",
      );
      const exportJson = pending.getByRole("button", {
        name: "Download unsaved comparison JSON",
        exact: true,
      });
      assert(await exportJson.isEnabled());
      const downloaded = await downloadBytes(page, exportJson);
      const evidence = JSON.parse(downloaded.bytes.toString("utf8"));
      const receipt = evidence.localComparisonRecovery;
      assert.equal(receipt.status, "SAVE_UNCONFIRMED");
      assert.equal(receipt.sharedSaveConfirmed, false);
      assert.equal(receipt.packageId, api.course.id);
      assert.equal(receipt.savedFollowUpsIncluded, false);
      assert.equal(receipt.lastSaveFailure.code, "WORKSPACE_RESPONSE_INVALID");
      assert.equal(receipt.lastSaveFailure.phase, "finalize");
      assert.equal(receipt.lastSaveFailure.status, 503);
      assert.equal(receipt.lastSaveFailure.attempts, 1);
      assert.match(receipt.lastSaveFailure.context, /^Finalizing /);
      assert(receipt.lastSaveFailure.context.includes(receipt.auditId));
      assert.deepEqual(receipt.lastSaveFailure.cloudflare, {
        rayId: "synthetic-intake-BOM",
        errorType: "synthetic-finalization",
        errorOrigin: "synthetic-workspace",
      });
      assert.equal(
        JSON.stringify(receipt).includes("<html>"),
        false,
        "Recovery metadata retains bounded diagnostics without the HTML response body",
      );
      delete evidence.localComparisonRecovery;
      assert.equal(
        sha256(Buffer.from(JSON.stringify(evidence))),
        receipt.payloadSha256,
      );
      const firstUpload = [...api.uploads.values()][0];
      assert.equal(receipt.auditId, firstUpload.manifest.record.id);
      assert.equal(receipt.payloadSha256, firstUpload.manifest.sha256);
      assert(
        evidence.result.ownerView.items.length > 0,
        "The JSON contains the complete computed comparison, not an error-only stub",
      );
      const text = await downloadBytes(
        page,
        pending.getByRole("button", {
          name: "Download unsaved comparison text",
          exact: true,
        }),
      );
      assert.match(
        text.bytes.toString("utf8"),
        /^COMPARISON COMPLETED; SHARED SAVE UNCONFIRMED/,
      );
      assert(text.bytes.toString("utf8").includes(receipt.auditId));
      assert(
        await page.getByLabel("Coursera full capture JSON").isDisabled(),
        "Pending report inputs cannot replace the retained computed evidence",
      );
      assert(
        await page
          .locator("button")
          .filter({ hasText: /^\s*Review a capture\s*$/ })
          .isDisabled(),
        "Outer workspace navigation cannot hide the unconfirmed report",
      );
      assert(
        await page
          .locator("button")
          .filter({ hasText: /^\s*Share a large capture\s*$/ })
          .isDisabled(),
        "The separate sharing tool cannot replace the unsaved report workspace",
      );
      await workspaceNav(page, "History");
      assert.deepEqual(
        (await downloadBytes(page, exportJson)).bytes,
        downloaded.bytes,
        "Navigating to history does not replace or hide the completed recovery copy",
      );
      await workspaceNav(page, "Compare");
      if (mode === "lost-saved") {
        // A protected UI recheck unmounts the workspace without a page reload.
        // The memory-only copy must remain hidden until the original account
        // authenticates, then restore through explicit Setup reconnect even
        // when the following record listing still fails.
        fullCti = false;
        await page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        );
        await page
          .getByRole("heading", { name: "Role Play & Dialogue", exact: true })
          .waitFor();
        api.faults.session = true;
        const sessionUnavailable = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/session" &&
            response.status() === 503,
        );
        fullCti = true;
        await page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        );
        await sessionUnavailable;
        const returnToWorkspace = page.getByRole("button", {
          name: "Full CTI workspace",
          exact: true,
        });
        await returnToWorkspace.waitFor();
        assert(
          await page
            .locator("button")
            .filter({ hasText: /^\s*Share a large capture\s*$/ })
            .isDisabled(),
          "Initial session recovery locks outgoing tool navigation",
        );
        assert(
          await returnToWorkspace.isEnabled(),
          "Auth restoration on a sharing URL still permits returning to the retained full workspace",
        );
        await returnToWorkspace.click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Synthetic session unavailable" })
          .waitFor({ timeout: 15000 });
        assert.equal(
          await pending.count(),
          0,
          "Unverified session access cannot reveal the held comparison",
        );
        api.faults.session = false;
        api.faults.list = true;
        await workspaceNav(page, "Setup");
        await page
          .getByRole("button", {
            name: "Connect shared workspace",
            exact: true,
          })
          .click();
        await pending
          .getByRole("heading", {
            name: "Comparison completed; shared save unconfirmed",
            exact: true,
          })
          .waitFor();
        await page
          .getByRole("alert")
          .filter({ hasText: "Synthetic record listing unavailable" })
          .waitFor({ timeout: 15000 });
        const reconnectDiagnostic = assertRecoveryEvidenceUnchanged(
          (await downloadBytes(page, exportJson)).bytes,
          downloaded.bytes,
          "Authenticated reconnect restores the same audit ID, payload hash and complete export before listing succeeds",
        );
        assert.equal(reconnectDiagnostic.code, "WORKSPACE_HTTP_ERROR");
        assert.equal(reconnectDiagnostic.phase, "read");
        assert.equal(reconnectDiagnostic.status, 503);
        assert.equal(reconnectDiagnostic.attempts, 3);
        assert.match(
          reconnectDiagnostic.message,
          /Synthetic record listing unavailable/,
        );
        assert.equal(api.uploads.size, 1);
        assert.equal(api.commits(), 1);
        api.faults.list = false;
      }
      const beforeCheck = api.events.length;
      await pending
        .getByRole("button", { name: "Check save / retry", exact: true })
        .click();
      if (mode === "transient") {
        await page
          .getByRole("alert")
          .filter({ hasText: "Synthetic temporary read failure" })
          // Six attempts allow up to 28.75s backoff plus local request time.
          .waitFor({ timeout: 40000 });
        assert.equal(
          api.uploads.size,
          1,
          "An uncertain GET never permits another upload or commit",
        );
        assert.equal(api.commits(), 1);
        assert.equal(
          api.events
            .slice(beforeCheck)
            .filter(
              (event) =>
                event.method === "GET" &&
                event.path === `records/${receipt.auditId}`,
            ).length,
          6,
          "Only the safe read follows the bounded saved-evidence retry policy",
        );
        const readDiagnostic = assertRecoveryEvidenceUnchanged(
          (await downloadBytes(page, exportJson)).bytes,
          downloaded.bytes,
          "A failed recovery read updates its diagnostic while preserving the complete computed evidence",
        );
        assert.equal(readDiagnostic.code, "WORKSPACE_HTTP_ERROR");
        assert.equal(readDiagnostic.phase, "download");
        assert.equal(readDiagnostic.status, 503);
        assert.equal(readDiagnostic.attempts, 6);
        assert(readDiagnostic.context.includes(receipt.auditId));
        assert.match(readDiagnostic.message, /Synthetic temporary read failure/);
      } else {
        await page
          .getByRole("status")
          .filter({
            hasText: `Full report save confirmed (${receipt.auditId})`,
          })
          .waitFor();
        assert.equal(await pending.count(), 0);
        assert.equal(
          [...api.records.values()].filter((record) => record.kind === "audit")
            .length,
          1,
        );
        assert.equal(
          sha256(
            Buffer.from(JSON.stringify(api.records.get(receipt.auditId).data)),
          ),
          receipt.payloadSha256,
          "The recovered save retains the original audit ID and exact payload SHA-256",
        );
        const afterCheck = api.events.slice(beforeCheck);
        assert.equal(afterCheck[0].method, "GET");
        assert.equal(afterCheck[0].path, `records/${receipt.auditId}`);
        if (mode === "lost-saved") {
          assert.equal(
            api.uploads.size,
            1,
            "An exact saved ID and payload hash are adopted without any second POST",
          );
          assert.equal(
            afterCheck.filter((event) => event.method === "POST").length,
            0,
          );
          assert.equal(api.commits(), 1);
        } else {
          assert.equal(
            api.uploads.size,
            1,
            "A definite missing save resumes the original upload without an orphan",
          );
          assert.equal(api.commits(), 2);
          assert.equal(firstUpload.manifest.record.id, receipt.auditId);
          assert.equal(firstUpload.manifest.sha256, receipt.payloadSha256);
          assert.equal(
            afterCheck.filter(
              (event) => event.method === "POST" && event.path === "uploads",
            ).length,
            0,
            "Recovery does not prepare a second upload for the same computed report",
          );
          assert.equal(
            afterCheck.filter((event) => event.method === "PUT").length,
            0,
            "Verified receipts skip all chunks already held by the original upload",
          );
          const notFoundRead = afterCheck.findIndex(
            (event) => event.path === `records/${receipt.auditId}`,
          );
          const historyRead = afterCheck.findIndex(
            (event) => event.path === "records",
          );
          const write = afterCheck.findIndex(
            (event) => event.method === "POST",
          );
          const uploadRead = afterCheck.findIndex(
            (event) =>
              event.method === "GET" &&
              event.path === `uploads/${firstUpload.id}`,
          );
          assert(
            notFoundRead < historyRead &&
              historyRead < uploadRead &&
              uploadRead < write,
            "Known absence, refreshed history and the original upload status precede finalization",
          );
          assert.equal(
            afterCheck[write].path,
            `uploads/${firstUpload.id}/commit`,
            "Finalization retries the same fully uploaded ID",
          );
        }
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      console.error(
        "UNCONFIRMED COMPARISON",
        mode,
        api.events,
        await page.locator(".full-workspace").innerText(),
      );
      await page.screenshot({
        path: `/tmp/cti-large-intake-save-${mode}-failure.png`,
      });
      throw error;
    } finally {
      await context.close();
    }
  }
}
