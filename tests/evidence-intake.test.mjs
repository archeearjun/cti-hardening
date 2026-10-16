import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  inspectEvidenceInput,
  inspectEvidenceInputs,
  stageEvidenceInputs,
  evidenceInputId,
  validateEvidenceInput,
  MAX_EVIDENCE_DOCUMENT_BYTES,
} from "../src/domain/evidence-intake.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";

function course() {
  return comparisonFixture().course;
}
function file(value, name = "capture.json") {
  return new File(
    [typeof value === "string" ? value : JSON.stringify(value)],
    name,
  );
}
function capture(id = "course-one", title = "Synthetic Course") {
  const value = JSON.parse(
    new TextDecoder().decode(comparisonFixture().json.bytes),
  );
  value.page.courseId = id;
  value.page.title = title;
  value.capturedAt = "2026-10-01T11:00:00.000Z";
  return value;
}
function sourceDocument() {
  return {
    kind: "CTI_SOURCE_DOCUMENT",
    schemaVersion: 1,
    platform: "Moodle",
    course: { id: "moodle-123", title: "Original course" },
    text: "Exact source text\n",
    scope: "Copied lesson text only.",
    gaps: ["No attachment bodies supplied."],
    capturedAt: "2026-10-02T12:00:00.000Z",
  };
}
function record(input, c = course()) {
  return {
    id: evidenceInputId(c.id, input.data),
    kind: "operations",
    packageId: c.id,
    data: input.data,
  };
}

test("Markdown preserves exact source bytes, attribution and unknown completeness without inventing quiz/media inventory", async () => {
  const c = course(),
    original =
      "\uFEFF# Same title\r\n\r\nLiteral 2 + 2. No quiz is supplied.\r\n![linked](https://example.test/image.png)\r\n";
  const input = await inspectEvidenceInput(
    file(original, "brightspace.md"),
    c,
    { documentPlatform: "Brightspace" },
  );
  assert.equal(input.data.role, "source-document");
  assert.equal(input.data.platform, "Brightspace");
  assert.equal(input.data.original.text, original);
  assert.equal(input.data.document.text, original);
  assert.equal(
    input.data.sourceHash,
    bytesToHex(sha256(new TextEncoder().encode(original))),
  );
  assert.equal(input.data.nativeCourseId, "");
  assert.equal(input.data.capturedAt, "");
  assert.equal(input.data.confirmedCourseId, c.id);
  assert.equal(input.data.counts, undefined);
  assert.match(input.data.scope, /not a structured LMS capture/);
  assert(input.data.gaps.some((g) => /not fetched/.test(g)));
  const stage = stageEvidenceInputs([
    { status: "ready", input, file: input.file },
  ]);
  assert.equal(stage.source, undefined);
  assert.equal(stage.documents.length, 1);
});

test("declared other-LMS JSON keeps original JSON and scoped projection, never a Brightspace comparison input", async () => {
  const original = JSON.stringify(sourceDocument(), null, 2),
    input = await inspectEvidenceInput(file(original, "moodle.json"), course());
  assert.equal(input.data.platform, "Moodle");
  assert.equal(input.data.nativeCourseId, "moodle-123");
  assert.equal(input.data.original.text, original);
  assert.equal(input.data.document.text, sourceDocument().text);
  assert.equal(input.data.capturedAt, sourceDocument().capturedAt);
  assert.equal(
    stageEvidenceInputs([{ file: input.file, input, status: "ready" }]).source,
    undefined,
  );
  validateEvidenceInput(input.data);
  const changed = structuredClone(input.data);
  changed.document.text = "Invented content";
  assert.throws(
    () => validateEvidenceInput(changed),
    /differs from its original JSON/,
  );
});

test("only an explicit document choice becomes a scoped source baseline and preserves the supplied text", async () => {
  const c = course();
  const first = await inspectEvidenceInput(
    file(
      "# Reused title\nFirst source text.\n```md\n# Literal code\n```\n## Reused title\nSecond source text.\n",
      "brightspace.md",
    ),
    c,
    { documentPlatform: "Brightspace" },
  );
  const second = await inspectEvidenceInput(
    file("Supplement only.", "notes.txt"),
    c,
  );
  const results = [first, second].map((input) => ({
    status: "ready",
    input,
    file: input.file,
  }));
  assert.equal(stageEvidenceInputs(results).package, undefined);
  const staged = stageEvidenceInputs(results, {
    sourceDocumentHash: first.data.sourceHash,
    courseId: c.id,
  });
  assert.equal(staged.package.file, first.file);
  assert.equal(staged.documents.length, 2);
  assert.equal(staged.package.scan.fileSha256, first.data.sourceHash);
  assert.equal(
    staged.package.scan.sourceEvidence.original.text,
    first.data.original.text,
  );
  assert.equal(staged.package.scan.sourceEvidence.completeCourse, false);
  const sections = staged.package.scan.courseTree[0].children;
  assert.equal(
    sections.length,
    2,
    "Fenced headings are retained as literal source text",
  );
  assert.notEqual(
    sections[0].idref,
    sections[1].idref,
    "Repeated section titles never collapse identities",
  );
  assert.equal(
    sections.map((section) => section.sourcePayload.textSample).join(""),
    first.data.document.text,
  );
  assert(
    sections.every(
      (section) => section.sourcePayload.expectedQuestionCount === null,
    ),
  );
  assert.throws(
    () =>
      stageEvidenceInputs(results, {
        sourceDocumentHash: second.data.sourceHash,
        courseId: "another-course",
      }),
    /different selected course/,
  );
  assert.throws(
    () => stageEvidenceInputs(results, { sourceDocumentHash: "a".repeat(64) }),
    /no longer available/,
  );
});

test("a document source baseline cannot silently override a source package in the same intake", async () => {
  const c = course();
  const document = await inspectEvidenceInput(
    file("Exact source", "source.md"),
    c,
  );
  const packageFile = file(
    '<manifest identifier="source"></manifest>',
    "imsmanifest.xml",
  );
  const packageInput = await inspectEvidenceInput(packageFile, c, {
    scanPackage: async () => ({
      ...c.data.scan,
      fileSha256: bytesToHex(
        sha256(new Uint8Array(await packageFile.arrayBuffer())),
      ),
      scope: "Manifest structure only.",
      warnings: [],
      moduleCount: 1,
    }),
  });
  const results = [document, packageInput].map((input) => ({
    status: "ready",
    input,
    file: input.file,
  }));
  assert.throws(
    () =>
      stageEvidenceInputs(results, {
        sourceDocumentHash: document.data.sourceHash,
      }),
    /not both/,
  );
});

test("Brightspace capture preserves native source identity and permission gaps without verifying a zero question total", async () => {
  const input = await inspectEvidenceInput(
    file({
      extractor: "CTI Brightspace v1.0.8",
      schemaVersion: 2,
      course: { title: "Example source", orgUnitId: "123" },
      contentTree: [],
      quizzes: [{ id: "q", name: "Quiz", questions: [] }],
      permissionBlocks: [{ status: 403 }],
      captureWarnings: ["Quiz API access denied; questions remain unverified."],
    }),
    course(),
  );
  assert.equal(input.data.role, "brightspace-capture");
  assert.equal(input.data.nativeCourseId, "123");
  assert.equal(input.data.counts.questionDefinitions, 0);
  assert(input.data.gaps.some((g) => /access denied/.test(g)));
  assert.equal(
    stageEvidenceInputs([{ status: "ready", input, file: input.file }]).source,
    input.file,
  );
});

test("a source document beginning with JSON remains literal text rather than a synthetic LMS capture", async () => {
  const original = '{"example":"literal document content"}\n';
  const input = await inspectEvidenceInput(
    file(original, "example.md"),
    course(),
  );
  assert.equal(input.data.role, "source-document");
  assert.equal(input.data.original.text, original);
});

test("arbitrary JSON and access diagnostics cannot become course evidence", async () => {
  await assert.rejects(
    inspectEvidenceInput(
      file({ items: [{ title: "Unattributed item" }] }),
      course(),
    ),
    /fingerprint|full|capture/i,
  );
  await assert.rejects(
    inspectEvidenceInput(
      file({ kind: "CTI_PROVIDER_ACCESS_DIAGNOSTIC", notForCourseAudit: true }),
      course(),
    ),
    /diagnostic|capture/i,
  );
  await assert.rejects(
    inspectEvidenceInput(
      file({ kind: "CTI_SOURCE_DOCUMENT", schemaVersion: 1, text: "Unscoped" }),
      course(),
    ),
    /scope|Unknown JSON format/,
  );
});

test("native captures use maintained inspection and preserve their original observation time", async () => {
  const value = capture(),
    input = await inspectEvidenceInput(file(value), course());
  assert.equal(input.data.role, "coursera-capture");
  assert.equal(input.data.nativeCourseId, "course-one");
  assert.equal(input.data.capturedAt, value.capturedAt);
  assert.equal(input.data.original.retention, "FILE_REFERENCE");
  assert.equal(input.data.original.text, undefined);
  assert.equal(input.data.counts.items, 2);
  assert(
    input.data.gaps.some((g) => /not copied into workspace storage/.test(g)),
  );
});

test("gzip magic is detected without relying on file extension and routed through maintained bounded reader", async () => {
  const source = new Blob([JSON.stringify(capture())]);
  const compressed = await new Response(
    source.stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  const input = await inspectEvidenceInput(
    new File([compressed], "download.bin"),
    course(),
  );
  assert.equal(input.data.role, "coursera-capture");
  assert.match(input.file.name, /\.json\.gz$/);
  assert.equal(
    input.data.sourceHash,
    bytesToHex(sha256(new Uint8Array(compressed))),
  );
});

test("same-title native course mismatch is rejected; selected course confirmation cannot override it", async () => {
  const c = course(),
    prior = await inspectEvidenceInput(file(capture("course-one")), c);
  const results = await inspectEvidenceInputs(
    [file(capture("course-two"))],
    c,
    [record(prior, c)],
  );
  assert.equal(results[0].status, "error");
  assert.match(results[0].message, /Native course ID differs/);
  assert.deepEqual(stageEvidenceInputs(results), {});
});

test("different native course IDs in a single batch conflict even without saved evidence", async () => {
  const results = await inspectEvidenceInputs(
    [
      file(capture("course-one"), "one.json"),
      file(capture("course-two"), "two.json"),
    ],
    course(),
    [],
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["conflict", "conflict"],
  );
  assert.deepEqual(stageEvidenceInputs(results), {});
});

test("same-role distinct versions require a choice and never select the first input", async () => {
  const results = await inspectEvidenceInputs(
    [
      file(capture(), "first.json"),
      file(capture("course-one", "Changed title"), "second.json"),
      file("Source notes", "notes.md"),
    ],
    course(),
    [],
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["conflict", "conflict", "ready"],
  );
  const stage = stageEvidenceInputs(results);
  assert.equal(stage.capture, undefined);
  assert.equal(stage.documents.length, 1);
});

test("exact duplicate intake is idempotent but can restage the local original", async () => {
  const c = course(),
    f = file(capture()),
    input = await inspectEvidenceInput(f, c);
  const results = await inspectEvidenceInputs(
    [f, file(capture(), "renamed.json")],
    c,
    [record(input, c)],
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["duplicate", "duplicate"],
  );
  assert.equal(
    evidenceInputId(c.id, results[0].input.data),
    evidenceInputId(c.id, results[1].input.data),
  );
  assert.equal(stageEvidenceInputs(results).capture, f);
  assert.notEqual(
    evidenceInputId("another-course", input.data),
    evidenceInputId(c.id, input.data),
  );
});

test("per-file failures do not discard valid supplemental evidence", async () => {
  const results = await inspectEvidenceInputs(
    [file("broken JSON", "bad.json"), file("Exact source", "source.txt")],
    course(),
    [],
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["error", "ready"],
  );
  assert.equal(stageEvidenceInputs(results).documents[0].text, "Exact source");
});

test("workbook input uses maintained workbook validation and stays separate from content evidence", async () => {
  const excel = comparisonFixture().excel,
    input = await inspectEvidenceInput(
      new File([excel.bytes], excel.name),
      course(),
    );
  assert.equal(input.data.role, "coursera-workbook");
  assert.equal(input.data.counts.sheets, 1);
  assert.equal(input.data.nativeCourseId, "");
  assert.match(input.data.scope, /still require comparison/);
});

test("source package scan is reused for staging while original binary bytes are never embedded", async () => {
  const f = file('<manifest identifier="test"></manifest>', "imsmanifest.xml"),
    c = course();
  const scan = {
    ...c.data.scan,
    kind: "CTI_PACKAGE_SCAN",
    schemaVersion: 1,
    fileSha256: bytesToHex(sha256(new Uint8Array(await f.arrayBuffer()))),
    scope: "Manifest structure only.",
    warnings: ["Files not inspected."],
    moduleCount: 1,
  };
  let calls = 0;
  const input = await inspectEvidenceInput(f, c, {
    scanPackage: async () => {
      calls++;
      return scan;
    },
  });
  assert.equal(calls, 1);
  const stage = stageEvidenceInputs([{ status: "ready", input, file: f }]);
  assert.equal(stage.package.scan, scan);
  assert.equal(stage.package.file, f);
  assert.equal(input.data.original.retention, "FILE_REFERENCE");
});

test("oversized documents, missing attribution, tampered original hashes and aborted intake fail closed", async () => {
  await assert.rejects(
    inspectEvidenceInput(
      new File([new Uint8Array(MAX_EVIDENCE_DOCUMENT_BYTES + 1)], "large.md"),
      course(),
    ),
    /4 MiB/,
  );
  await assert.rejects(
    inspectEvidenceInputs(
      Array.from({ length: 13 }, () => file("x", "x.md")),
      course(),
      [],
    ),
    /1 and 12/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    inspectEvidenceInputs([file("x", "x.md")], course(), [], {
      signal: controller.signal,
    }),
    /abort/i,
  );
  const input = await inspectEvidenceInput(
    file("Exact source", "notes.md"),
    course(),
  );
  input.data.original.text = "Different source";
  assert.throws(
    () => validateEvidenceInput(input.data),
    /original file identity/,
  );
});
