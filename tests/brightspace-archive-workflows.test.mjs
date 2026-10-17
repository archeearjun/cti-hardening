import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import {
  readCaptureFileBytes,
  readCaptureFileJson,
  readBrightspaceCaptureFileBytes,
} from "../src/domain/capture-file.ts";
import { readCaptureReviewFile } from "../src/domain/capture-review.ts";
import { inspectBrightspaceCaptureFile } from "../src/domain/brightspace-local-extraction.ts";
import { inspectEvidenceInput } from "../src/domain/evidence-intake.ts";
import { prepareCaptureShareReview } from "../src/domain/capture-share-review.ts";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";
import { saveOriginalContent } from "../src/domain/report-content-store.ts";
import { newRecord } from "../src/domain/workspace-store.ts";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const body = Buffer.from("<p>Original source guide.</p>"),
    hash = sha(body);
  const text = "Original source guide.",
    url = "https://source.example.test/content/enforced/123/guide.html";
  const receipt = {
    requestUrl: url,
    responseUrl: url,
    status: 200,
    complete: true,
    observedAt: "2026-10-17T10:00:00.000Z",
    bytes: body.length,
    sha256: hash,
    contentType: "text/html",
  };
  const capture = {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.2.0",
    buildId: "v1.2.0-blob-archive-20261017",
    capturedAt: receipt.observedAt,
    page: { url: "https://source.example.test/d2l/home/123" },
    course: { orgUnitId: "123", title: "Synthetic source" },
    originalBodyTransport: {
      format: "CTI_BRIGHTSPACE_ARCHIVE_V1",
      version: 1,
      bodyEncoding: "archive",
      hashAlgorithm: "SHA-256",
    },
    contentTree: [
      {
        kind: "TOPIC",
        id: "source-reading",
        title: "Reading",
        path: ["Module 1"],
        url,
        contentEvidence: {
          status: "CAPTURED",
          format: "html",
          charset: "utf-8",
          html: body.toString(),
          text,
          textLength: text.length,
          textSha256: sha(text),
          rawBodyRef: hash,
          contentType: "text/html",
          bodyReceipt: receipt,
        },
      },
    ],
    assetBodies: {
      [hash]: {
        encoding: "archive",
        archivePath: "files/" + hash,
        bytes: body.length,
        sha256: hash,
      },
    },
    contentAcquisition: { assets: [], gaps: [] },
    quizzes: [],
    assignments: [],
    discussions: [],
  };
  const zip = new JSZip();
  zip.file("capture.json.gz", gzipSync(JSON.stringify(capture)), {
    createFolders: false,
  });
  zip.file("files/" + hash, body, { createFolders: false });
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "STORE",
  });
  return { file: new File([bytes], "source.cti.zip"), capture, body, hash };
}

test("one Brightspace archive is accepted by source inspection, unified intake and bounded sharing", async () => {
  const { file } = await fixture();
  const parsed = await readCaptureFileJson(file);
  assert.equal(parsed.extractor, "CTI Brightspace v1.2.0");
  assert.equal((await readCaptureReviewFile(file)).course.orgUnitId, "123");
  const inspected = await inspectBrightspaceCaptureFile(file, "NAIT");
  assert.equal(inspected.counts.items, 1);
  const intake = await inspectEvidenceInput(file, comparisonFixture().course);
  assert.equal(intake.data.role, "brightspace-capture");
  assert.equal(intake.data.nativeCourseId, "123");
  const shared = await prepareCaptureShareReview(file);
  assert.equal(shared.platform, "BRIGHTSPACE");
  assert.equal(shared.localCheck.status, "PASSED");
  assert.equal(shared.wholeCourseCoverage, "UNVERIFIED");
  assert.equal(shared.source.transport, "zip");
});

test("worker comparison revalidates cloned Blob originals and keeps exact source manifest identity", async () => {
  const { file, capture } = await fixture(),
    workflows = createWorkflows(workerXml);
  const decoded = await readBrightspaceCaptureFileBytes(file);
  const input = comparisonFixture();
  input.brightspace = structuredClone({ name: file.name, ...decoded });
  assert.throws(() => workflows.compare(input), /archive|verified|original/i);
  const output = await workflows.executeAsync({ kind: "compare", input });
  assert.equal(output.hashes.brightspace, sha(decoded.bytes));
  assert.equal(
    output.captureTransport.brightspace.sha256,
    decoded.transport.sha256,
  );
  assert.equal(
    output.contentEvidence.brightspace[0].content.text,
    capture.contentTree[0].contentEvidence.text,
  );
  assert.equal(output.ownerContext.sourceTopics[0].id, "source-reading");
  const corrupted = structuredClone(input);
  corrupted.brightspace.brightspaceArchiveFiles[0].blob = new Blob([
    "not the original",
  ]);
  await assert.rejects(
    workflows.executeAsync({ kind: "compare", input: corrupted }),
    /length|size|hash|bytes|invalid/i,
  );
  const mutable = structuredClone(input),
    originalHash = sha(mutable.brightspace.bytes);
  const pending = workflows.executeAsync({ kind: "compare", input: mutable });
  const altered = new TextDecoder()
    .decode(mutable.brightspace.bytes)
    .replace('"title":"Reading"', '"title":"Changed"');
  mutable.brightspace.bytes.set(new TextEncoder().encode(altered));
  mutable.brightspace.brightspaceArchiveFiles[0].path =
    "files/" + "f".repeat(64);
  mutable.brightspace.transport.sha256 = "f".repeat(64);
  const stable = await pending;
  assert.equal(stable.hashes.brightspace, originalHash);
  assert.equal(stable.ownerContext.sourceTopics[0].name, "Reading");
  assert.equal(
    stable.captureTransport.brightspace.sha256,
    decoded.transport.sha256,
  );
});

test("Brightspace original-content supplements stay report-bound and reject a different archive identity", async () => {
  const { file } = await fixture(),
    decoded = await readBrightspaceCaptureFileBytes(file);
  const input = comparisonFixture();
  input.brightspace = { name: file.name, ...decoded };
  const output = await createWorkflows(workerXml).executeAsync({
    kind: "compare",
    input,
  });
  const audit = newRecord("audit", "Saved QA", output, output.packageId),
    records = new Map([[audit.id, audit]]);
  const store = {
    role: "admin",
    list: async () => [...records.values()],
    get: async (id) => records.get(id),
    save: async (record) => {
      records.set(record.id, record);
      return record;
    },
  };
  const options = {
    brightspaceArchiveFiles: decoded.brightspaceArchiveFiles,
    transport: decoded.transport,
  };
  assert.equal(
    await saveOriginalContent(decoded.bytes, output, audit.id, store, options),
    "brightspace",
  );
  assert.equal(
    records.get(audit.id),
    audit,
    "The original saved audit is unchanged",
  );
  const supplement = [...records.values()].find(
    (r) => r.data.type === "report-content",
  );
  assert.equal(
    supplement.data.contentEvidence.brightspace[0].content.text,
    "Original source guide.",
  );
  await assert.rejects(
    saveOriginalContent(decoded.bytes, output, audit.id, store, {
      ...options,
      transport: { ...decoded.transport, sha256: "f".repeat(64) },
    }),
    /original Brightspace ZIP hash/,
  );
  await assert.rejects(
    saveOriginalContent(decoded.bytes, output, audit.id, store, {
      brightspaceArchiveFiles: decoded.brightspaceArchiveFiles,
    }),
    /original Brightspace ZIP archive/,
  );
});

test("valid Coursera archives retain their own platform reader and cannot become Brightspace inputs", async () => {
  const input = comparisonFixture(),
    zip = new JSZip();
  const capture = JSON.parse(new TextDecoder().decode(input.json.bytes));
  capture.meta.directDataCapture = {
    exportTransport: { format: "ZIP_GZIP_JSON_V1" },
  };
  const original = new TextEncoder().encode(JSON.stringify(capture));
  zip.file("capture.json.gz", gzipSync(original), { createFolders: false });
  const file = new File(
    [await zip.generateAsync({ type: "uint8array", compression: "STORE" })],
    "destination.cti.zip",
  );
  const decoded = await readCaptureFileBytes(file);
  assert.equal(decoded.brightspaceArchiveFiles, undefined);
  assert.deepEqual(decoded.bytes, original);
  await assert.rejects(
    readBrightspaceCaptureFileBytes(file),
    /Brightspace source capture/,
  );
});
