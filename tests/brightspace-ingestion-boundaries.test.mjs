import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectEvidenceInput } from "../src/domain/evidence-intake.ts";
import { buildContentSnapshot } from "../src/domain/content-evidence.ts";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { comparisonFixture, encode } from "./workflow-fixtures.mjs";

function source() {
  const text =
    "1\r\n00:00:01,000 --> 00:00:03,500\r\nOriginal <word> & exact caption.\r\n";
  const bytes = Buffer.from(text),
    hash = createHash("sha256").update(bytes).digest("hex");
  const url = "https://source.example.test/content/reading.srt";
  const receipt = {
    requestUrl: url,
    responseUrl: url,
    status: 200,
    complete: true,
    bytes: bytes.length,
    sha256: hash,
    observedAt: "2026-10-16T12:00:00.000Z",
  };
  return {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.1.0",
    capturedAt: receipt.observedAt,
    page: { url: "https://source.example.test/d2l/home/123" },
    course: { orgUnitId: "123", title: "Synthetic course" },
    contentTree: [
      {
        kind: "TOPIC",
        id: "1",
        title: "Reading",
        path: ["Module 1"],
        url,
        activityType: 1,
        activityTypeLabel: "File",
        contentEvidence: {
          status: "CAPTURED",
          url,
          format: "srt",
          charset: "utf-8",
          text,
          textLength: text.length,
          textSha256: hash,
          html: "",
          rawBodyRef: hash,
          bodyReceipt: receipt,
          projectionTruncated: false,
        },
      },
    ],
    quizzes: [
      {
        id: "2",
        name: "Final assessment",
        questions: [],
        questionsStatus: "CAPTURED",
        questionPageEvidence: { complete: true },
        questionCoverage: { completenessVerified: false },
      },
    ],
    assignments: [],
    discussions: [],
    assetBodies: {
      [hash]: {
        encoding: "base64",
        base64: bytes.toString("base64"),
        bytes: bytes.length,
        sha256: hash,
      },
    },
    contentAcquisition: {
      assets: [
        {
          url,
          originalRef: hash,
          bytes: bytes.length,
          sha256: hash,
          receipt,
          sourceBindings: [{ kind: "TOPIC", id: "1" }],
        },
      ],
      gaps: [],
    },
  };
}

test("Evidence Inbox and comparison retain independent Brightspace gaps and literal source content", async () => {
  const value = source(),
    input = comparisonFixture();
  const file = new File([JSON.stringify(value)], "source.json");
  const inspected = await inspectEvidenceInput(file, input.course);
  assert.equal(inspected.data.role, "brightspace-capture");
  assert(
    inspected.data.gaps.some((gap) =>
      /Final assessment.*unverified/i.test(gap),
    ),
  );
  input.brightspace = { name: file.name, bytes: encode(value) };
  const output = createWorkflows(workerXml).compare(input);
  assert.equal(
    output.result.brightspaceEvidence.originalIntegrity,
    "VERIFIED_RETAINED_ORIGINALS",
  );
  assert.equal(output.result.brightspaceEvidence.wholeCourseComplete, false);
  assert(
    output.result.workspaceWarnings.some((gap) =>
      /Final assessment.*unverified/i.test(gap),
    ),
  );
  assert.equal(
    output.contentEvidence.brightspace[0].content.text,
    value.contentTree[0].contentEvidence.text,
  );
  assert.equal(
    output.contentEvidence.brightspace[0].content.textCoverage,
    "PARTIAL",
  );
});

test("tampered originals fail in Evidence Inbox, direct comparison and original-content supplementation", async () => {
  const value = source(),
    input = comparisonFixture();
  Object.values(value.assetBodies)[0].base64 = Buffer.from(
    "invented replacement",
  ).toString("base64");
  await assert.rejects(
    inspectEvidenceInput(
      new File([JSON.stringify(value)], "source.json"),
      input.course,
    ),
    /Brightspace/,
  );
  input.brightspace = { name: "source.json", bytes: encode(value) };
  assert.throws(() => createWorkflows(workerXml).compare(input), /Brightspace/);
  assert.throws(
    () => buildContentSnapshot(undefined, input.brightspace.bytes),
    /Brightspace/,
  );
});
