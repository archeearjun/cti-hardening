import test from "node:test";
import assert from "node:assert/strict";
import {
  capturedContent,
  buildContentSnapshot,
  validateContentSnapshot,
  contentText,
  contentEvidenceText,
} from "../src/domain/content-evidence.ts";
import { itemContentView } from "../src/domain/owner-content.ts";
import { buildOwnerTasks } from "../src/domain/owner-actions.ts";
import {
  loadAssignmentEvidence,
  assignmentHandoff,
} from "../src/domain/assignment-plan.ts";
import { fetchSourceQuestions } from "../server/source-questions.ts";
import { validateSourceQuestionCapture } from "../src/domain/external-source-questions.ts";
import { comparisonFixture, encode } from "./workflow-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import {
  saveOriginalContent,
  loadReportContent,
} from "../src/domain/report-content-store.ts";
import { digest, recordSummary } from "../src/domain/workspace-store.ts";
import { validateRecord } from "../src/domain/workspace-validation.ts";
import { readCourseraCaptureFileBytes } from "../src/domain/coursera-capture-file.ts";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { directTextFixture } from "./coursera-direct-content-fixtures.mjs";
const question = {
  id: "q",
  prompt: "What is 1 < 2 and 3 > 2?",
  type: "multiple-choice",
  options: [
    { id: "a", text: "Zero" },
    { id: "b", text: "One" },
  ],
  correctAnswers: [0, false],
  feedback: "Feedback",
};
const payload = {
  structuredAssessment: {
    questions: [question],
    declaredQuestionCount: 1,
    captureCompleteness: { declared: 1, questionCoverageComplete: true },
  },
};

function nativeFeedbackQuestions() {
  return [1, 2].map((ordinal) => ({
    id: String(ordinal),
    courseraQuestionId: "native-checkbox-" + ordinal,
    type: "multiple-select",
    rawType: "checkbox",
    textFormat: "PLAIN_TEXT",
    observationMethod: "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION",
    prompt: "Choose the marked examples.",
    options: [
      "Authored <div> &amp; feedback.",
      "Authored &lt;p&gt; feedback.",
      "Authored first line.\nSecond line.",
      "Authored <span> & feedback.",
    ].map((feedback, index) => ({
      id: "option-" + index,
      text: "Choice " + index,
      feedback: "Question " + ordinal + ": " + feedback,
    })),
    correctAnswers: ["Choice 0", "Choice 1"],
    feedback: "",
    answerTextReliable: true,
    optionTextReliable: true,
  }));
}

test("original archive supplements verify bodies and archive identity while saving compact proofs only", async () => {
  const input = comparisonFixture();
  const original = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const sha256 = createHash("sha256").update(original).digest("hex"),
    path = "files/" + sha256;
  const capture = JSON.parse(new TextDecoder().decode(input.json.bytes));
  capture.meta.directDataCapture = {
    exportTransport: { format: "ZIP_GZIP_JSON_V1" },
  };
  capture.fingerprints[0].payload.directAssetEvidence = {
    assets: [
      {
        assetId: "ABCDEFGHIJKLMNOPQRSTUV",
        body: {
          archivePath: path,
          sha256,
          size: original.length,
          mime: "image/png",
        },
      },
    ],
  };
  const zip = new JSZip();
  zip.file("capture.json.gz", gzipSync(encode(capture)), {
    createFolders: false,
  });
  zip.file(path, original, { createFolders: false });
  const selected = new File(
    [await zip.generateAsync({ type: "uint8array", compression: "STORE" })],
    "original.cti.zip",
  );
  const decoded = await readCourseraCaptureFileBytes(selected);
  input.json = { name: selected.name, ...decoded };
  const report = createWorkflows(workerXml).compare(input);
  delete report.contentEvidence;
  const audit = {
    ...input.course,
    id: "archive-audit",
    kind: "audit",
    packageId: input.course.id,
    data: report,
    version: 1,
  };
  const before = structuredClone(audit),
    records = new Map([[audit.id, structuredClone(audit)]]);
  let writes = 0;
  const store = {
    role: "editor",
    email: "test",
    list: async () => [...records.values()].map(recordSummary),
    get: async (id) => structuredClone(records.get(id)),
    save: async (row) => {
      writes++;
      validateRecord(row);
      const next = { ...row, version: row.version + 1 };
      records.set(row.id, next);
      return next;
    },
  };
  const options = {
    archiveFiles: decoded.archiveFiles,
    transport: decoded.transport,
  };
  const corrupted = {
    ...decoded.archiveFiles[0],
    bytes: Uint8Array.from(original),
  };
  corrupted.bytes[corrupted.bytes.length - 1] ^= 1;
  await assert.rejects(
    saveOriginalContent(decoded.bytes, report, audit.id, store, {
      ...options,
      archiveFiles: [corrupted],
    }),
    /failed checksum/,
  );
  await assert.rejects(
    saveOriginalContent(decoded.bytes, report, audit.id, store),
    /referenced original file is absent/,
  );
  await assert.rejects(
    saveOriginalContent(decoded.bytes, report, audit.id, store, {
      ...options,
      transport: { ...decoded.transport, sha256: "b".repeat(64) },
    }),
    /original ZIP hash/,
  );
  await assert.rejects(
    saveOriginalContent(decoded.bytes, report, audit.id, store, {
      archiveFiles: decoded.archiveFiles,
    }),
    /verified ZIP identity/,
  );
  assert.equal(writes, 0, "Failed identities must not create a supplement");
  assert.equal(
    await saveOriginalContent(decoded.bytes, report, audit.id, store, options),
    "coursera",
  );
  const supplement = [...records.values()].find(
    (row) => row.kind === "operations",
  );
  assert.equal(supplement.data.archiveProof.metadataSha256, report.hashes.json);
  assert.equal(
    supplement.data.archiveProof.archiveSha256,
    decoded.transport.sha256,
  );
  assert.equal(supplement.data.archiveProof.archiveIdentityMatchedReport, true);
  assert.equal(supplement.data.archiveProof.originalBytesStored, false);
  assert.deepEqual(supplement.data.archiveProof.files, [
    { path, sha256, size: original.length },
  ]);
  assert.equal(
    JSON.stringify(supplement).includes(original.toString("base64")),
    false,
  );
  assert.equal(JSON.stringify(supplement).includes('"archiveFiles"'), false);
  assert.equal(
    (await loadReportContent(report, audit.id, input.course.id, store)).coursera
      .length,
    2,
  );
  assert.deepEqual(
    records.get(audit.id),
    before,
    "The original audit remains immutable",
  );
});
test("question records stay complete only with matching declared coverage; missing, partial and malformed remain distinct", () => {
  const c = capturedContent(payload, { basis: "test" });
  assert.equal(c.questionCoverage, "COMPLETE");
  assert.equal(c.questions[0].prompt, question.prompt);
  assert.deepEqual(c.questions[0].answers, ["0", "false"]);
  assert.match(c.questions[0].limitations.join(), /Answer-key coverage/);
  assert.equal(
    capturedContent(
      {
        ...payload,
        structuredAssessment: {
          ...payload.structuredAssessment,
          declaredQuestionCount: 2,
          captureCompleteness: { declared: 2, questionCoverageComplete: true },
        },
      },
      { basis: "partial" },
    ).questionCoverage,
    "PARTIAL",
  );
  const unknown = capturedContent({}, { basis: "unknown" });
  assert.equal(unknown.questionCoverage, "UNVERIFIED");
  assert.equal(unknown.expectedQuestions, null);
  assert.equal(
    capturedContent(payload, { basis: "unobserved", editorObserved: false })
      .questionCoverage,
    "PARTIAL",
  );
  const snapshot = {
    schemaVersion: 1,
    coursera: [{ id: "i", name: "n", path: "m", content: c }],
    brightspace: [],
  };
  validateContentSnapshot(snapshot);
  assert.throws(
    () =>
      validateContentSnapshot({
        ...snapshot,
        coursera: [
          { ...snapshot.coursera[0], content: { ...c, expectedQuestions: 9 } },
        ],
      }),
    /contradicts/,
  );
});

test("content supplements use exact original hashes and preserve immutable audits across repeated imports and stale reads", async () => {
  const input = comparisonFixture();
  const raw = JSON.parse(new TextDecoder().decode(input.json.bytes));
  raw.fingerprints[0].payload.timeEstimateMinutes = 12;
  const feedbackQuestions = nativeFeedbackQuestions();
  raw.fingerprints[1].payload.structuredAssessment = {
    questions: feedbackQuestions,
    declaredQuestionCount: 2,
    captureCompleteness: { declared: 2, questionCoverageComplete: true },
  };
  input.json.bytes = encode(raw);
  const report = createWorkflows(workerXml).compare(input);
  delete report.contentEvidence;
  const audit = {
    ...input.course,
    id: "saved-audit",
    kind: "audit",
    packageId: input.course.id,
    data: report,
    version: 1,
  };
  const records = new Map([[audit.id, structuredClone(audit)]]),
    before = structuredClone(audit);
  const store = {
    role: "editor",
    email: "test",
    list: async () => [...records.values()].map(recordSummary),
    get: async (id) => structuredClone(records.get(id)),
    save: async (r) => {
      assert.notEqual(r.kind, "audit");
      validateRecord(r);
      assert.equal(r.version, records.get(r.id)?.version || 0);
      const next = { ...r, version: r.version + 1 };
      records.set(r.id, next);
      return next;
    },
  };
  await assert.rejects(
    saveOriginalContent(encode({ fingerprints: [] }), report, audit.id, store),
    /original extraction hash/,
  );
  assert.equal(
    await saveOriginalContent(input.json.bytes, report, audit.id, store),
    "coursera",
  );
  await saveOriginalContent(input.json.bytes, report, audit.id, store);
  assert.equal(records.size, 2);
  assert.deepEqual(records.get(audit.id), before);
  const merged = await loadReportContent(
    report,
    audit.id,
    audit.packageId,
    store,
  );
  assert.equal(merged.coursera.length, 2);
  assert(merged.coursera[0].content.text);
  assert.deepEqual(
    merged.coursera[1].content.questions.flatMap((q) =>
      q.options.map((o) => o.feedback),
    ),
    feedbackQuestions.flatMap((q) => q.options.map((o) => o.feedback)),
    "All eight authored option-feedback fields survive saving and loading original content",
  );
  const supplement = [...records.values()].find((r) => r.kind === "operations");
  assert.equal(supplement.data.sourceHash, await digest(input.json.bytes));
  assert.equal(recordSummary(supplement).data.contentEvidence, undefined);
  const assignmentEvidence = await loadAssignmentEvidence(audit.id, store);
  assert.equal(
    assignmentEvidence.data.contentEvidence.coursera[0].content.timeEstimate
      .minutes,
    12,
  );
  assert.match(
    assignmentHandoff(input.course, assignmentEvidence, await store.list()),
    /baseline 12 min.*latest available 12 min/,
  );
  assert.deepEqual(
    records.get(audit.id),
    before,
    "handoff projection must not rewrite the original audit",
  );
  await assert.rejects(
    loadReportContent(
      { ...report, hashes: { json: "0".repeat(64) } },
      audit.id,
      audit.packageId,
      store,
    ),
    /does not match/,
  );
  await assert.rejects(
    loadReportContent(report, audit.id, audit.packageId, {
      ...store,
      get: async (id) => ({ ...(await store.get(id)), version: 99 }),
    }),
    /changed/,
  );
});

test("duplicate positions and unknown Brightspace totals cannot claim complete coverage", () => {
  const duplicate = capturedContent(
    {
      structuredAssessment: {
        questions: [question, question],
        captureCompleteness: { declared: 2, questionCoverageComplete: true },
      },
    },
    { basis: "duplicate" },
  );
  assert.equal(duplicate.questions.length, 2);
  assert.equal(duplicate.questionCoverage, "PARTIAL");
  const source = capturedContent(
    {
      structuredAssessment: {
        questions: [question],
        declaredQuestionCount: 1,
        definitionCoverage: {
          observedDeclaredQuestionCount: null,
          completenessVerified: false,
        },
      },
    },
    { basis: "source", source: true },
  );
  assert.equal(source.expectedQuestions, null);
  assert.equal(source.questionCoverage, "PARTIAL");
});
test("all retained text is displayed, explicit field receipts govern complete and empty, truncation remains visible", () => {
  const text = "Long reading ".repeat(3000);
  const p = {
    textSample: text,
    textCaptureEvidence: {
      method: "EXACT_READING_FIELD",
      itemId: "i",
      capturedCharacters: text.length,
      observedCharacters: text.length,
      truncated: false,
    },
  };
  const complete = capturedContent(p, { basis: "reading", itemId: "i" });
  assert.equal(complete.textCoverage, "COMPLETE");
  assert.equal(complete.text, text);
  assert.equal(
    capturedContent(
      { ...p, textCaptureTruncated: true },
      { basis: "reading", itemId: "i" },
    ).textCoverage,
    "PARTIAL",
  );
  assert.equal(
    capturedContent(p, { basis: "wrong-item", itemId: "wrong" }).textCoverage,
    "PARTIAL",
  );
  const empty = capturedContent(
    {
      textSample: "",
      textCaptureEvidence: {
        ...p.textCaptureEvidence,
        capturedCharacters: 0,
        observedCharacters: 0,
      },
    },
    { basis: "empty", itemId: "i" },
  );
  assert.equal(empty.textCoverage, "EMPTY");
  assert.equal(
    capturedContent({ textSample: "" }, { basis: "unknown" }).textCoverage,
    "UNVERIFIED",
  );
  assert.equal(
    contentText("<p>&#49; &lt; 2</p><script>bad()</script>"),
    "1 < 2",
  );
  assert.equal(contentText("1 < 2 and 3 > 2"), "1 < 2 and 3 > 2");
  assert.match(contentEvidenceText(complete), /Long reading/);
  const limited = capturedContent(
    { ...p, textSample: "x".repeat(300001), textLength: 300001 },
    { basis: "display-bound", itemId: "i" },
  );
  assert.equal(limited.text.length, 300000);
  assert.equal(limited.textCoverage, "PARTIAL");
  assert.match(limited.textReason, /available excerpt/);
});
test("direct definition plain text preserves literal tags, entities and answer keys without a second HTML decode", () => {
  const direct = {
    ...question,
    textFormat: "PLAIN_TEXT",
    observationMethod: "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION",
    prompt: "Which <div> contains literal &lt;p&gt;?",
    options: [
      { id: "a", text: "<div>" },
      { id: "b", text: "&lt;p&gt;" },
    ],
    correctAnswers: ["<div>"],
    feedback: "Keep <span> and &amp; literally.",
    answerTextReliable: true,
  };
  const view = capturedContent(
    {
      structuredAssessment: {
        ...payload.structuredAssessment,
        questions: [direct],
      },
    },
    { basis: "direct" },
  ).questions[0];
  assert.equal(view.prompt, direct.prompt);
  assert.deepEqual(
    view.options.map((option) => option.text),
    ["<div>", "&lt;p&gt;"],
  );
  assert.deepEqual(view.answers, ["<div>"]);
  assert.equal(view.feedback, direct.feedback);
  assert.equal(view.answerKeyReliable, true);
  for (const unproven of [
    { ...direct, observationMethod: "EDITOR" },
    { ...direct, textFormat: undefined },
  ]) {
    const legacy = capturedContent(
      { structuredAssessment: { questions: [unproven] } },
      { basis: "legacy" },
    ).questions[0];
    assert.deepEqual(
      legacy.answers,
      [],
      "Unproven fields keep the existing HTML projection",
    );
    assert.notEqual(legacy.prompt, direct.prompt);
  }
});
test("authored option feedback is retained exactly in snapshots and copied exports; missing and empty stay distinct", () => {
  const questions = nativeFeedbackQuestions();
  const bytes = encode({
    fingerprints: [
      {
        id: "assessment",
        payload: {
          structuredAssessment: {
            questions,
            declaredQuestionCount: questions.length,
            captureCompleteness: {
              declared: questions.length,
              questionCoverageComplete: true,
            },
          },
        },
      },
    ],
  });
  const snapshot = buildContentSnapshot(bytes),
    saved = JSON.parse(JSON.stringify(snapshot)),
    content = saved.coursera[0].content,
    expected = questions.flatMap((q) => q.options.map((o) => o.feedback));
  validateContentSnapshot(saved);
  assert.equal(expected.length, 8);
  assert.deepEqual(
    content.questions.flatMap((q) => q.options.map((o) => o.feedback)),
    expected,
  );
  for (const feedback of expected)
    assert(contentEvidenceText(content).includes(feedback));
  assert(
    content.questions.every((q) => q.feedback === ""),
    "Choice feedback is never replaced by question-level text",
  );
  const older = structuredClone(saved);
  for (const q of older.coursera[0].content.questions)
    for (const o of q.options) delete o.feedback;
  validateContentSnapshot(older);
  const bad = structuredClone(saved);
  bad.coursera[0].content.questions[0].options[0].feedback = {
    text: "invalid",
  };
  assert.throws(
    () => validateContentSnapshot(bad),
    /Invalid saved question evidence/,
  );
  const empty = nativeFeedbackQuestions()[0];
  empty.options[0].feedback = "";
  delete empty.options[1].feedback;
  const projected = capturedContent(
    { structuredAssessment: { questions: [empty] } },
    { basis: "empty-feedback" },
  ).questions[0];
  assert.equal(projected.options[0].feedback, "");
  assert.equal(Object.hasOwn(projected.options[1], "feedback"), false);
});
test("bound draft reading and discussion text is verified separately from unresolved media", () => {
  for (const discussion of [false, true]) {
    const fixture = directTextFixture({ discussion });
    fixture.payload.captureContract = {
      complete: false,
      status: "UNRESOLVED_DIRECT_READING",
    };
    fixture.payload.directDataEvidence.assetsBodyVerified = false;
    fixture.payload.directDataEvidence.unresolvedAssetReferences = [
      { id: "missing-media" },
    ];
    const result = capturedContent(fixture.payload, {
      basis: "direct",
      itemId: fixture.itemId,
    });
    assert.equal(result.textCoverage, "COMPLETE");
    assert.equal(result.text, "Draft <div> &amp; text");
    assert.match(result.textReason, /media coverage is separate/);
    const empty = directTextFixture({ discussion, empty: true });
    const emptyResult = capturedContent(empty.payload, {
      basis: "direct",
      itemId: empty.itemId,
    });
    assert.equal(emptyResult.textCoverage, "EMPTY");
    assert.match(
      emptyResult.textReason,
      /bound authoring draft text was empty/,
    );
    const snapshot = buildContentSnapshot(
      encode({
        fingerprints: [{ id: fixture.itemId, payload: fixture.payload }],
      }),
    );
    assert.equal(snapshot.coursera[0].content.textCoverage, "COMPLETE");
    validateContentSnapshot(snapshot);
  }
});
test("authored image alt text stays separate, source-bound and exact through snapshots and exports", () => {
  const fixture = directTextFixture({
    cmlValue:
      '<co-content><p>Bound reading.</p><img alt=""/><img title="Not authored alt" name="Not alt"/><image alt="Keep &lt;span&gt; &amp;amp; &#x1F4D0; exactly."/></co-content>',
    textSample: "Bound reading.",
  });
  fixture.payload.captureContract = {
    complete: false,
    status: "UNRESOLVED_DIRECT_READING",
  };
  const before = structuredClone(fixture.payload),
    content = capturedContent(fixture.payload, {
      basis: "direct",
      itemId: fixture.itemId,
    });
  assert.deepEqual(content.imageAltText, [
    { imageOrdinal: 1, text: "" },
    { imageOrdinal: 3, text: "Keep <span> &amp; 📐 exactly." },
  ]);
  assert.equal(content.text, "Bound reading.");
  assert.equal(
    content.textCoverage,
    "COMPLETE",
    "Alt metadata cannot change text-field coverage",
  );
  assert.deepEqual(
    fixture.payload,
    before,
    "Raw CML, text hashes, source proofs and capture status remain unchanged",
  );
  const snapshot = buildContentSnapshot(
      encode({
        fingerprints: [{ id: fixture.itemId, payload: fixture.payload }],
      }),
    ),
    saved = JSON.parse(JSON.stringify(snapshot));
  validateContentSnapshot(saved);
  assert.deepEqual(
    saved.coursera[0].content.imageAltText,
    content.imageAltText,
  );
  const exported = contentEvidenceText(saved.coursera[0].content);
  assert(
    exported.includes(
      "Authored image alt text (source image 3): Keep <span> &amp; 📐 exactly.",
    ),
  );
  assert(!exported.includes("Authored image alt text (source image 1)"));
  assert(
    !exported.includes("Not authored alt"),
    "Titles and names never substitute for alt text",
  );
  const older = structuredClone(saved);
  delete older.coursera[0].content.imageAltText;
  validateContentSnapshot(older);
  for (const invalid of [
    [{ imageOrdinal: 0, text: "bad" }],
    [{ imageOrdinal: 1, text: false }],
    [
      { imageOrdinal: 1, text: "one" },
      { imageOrdinal: 1, text: "duplicate" },
    ],
  ]) {
    const bad = structuredClone(saved);
    bad.coursera[0].content.imageAltText = invalid;
    assert.throws(
      () => validateContentSnapshot(bad),
      /Invalid saved image alt text/,
    );
  }
});
test("empty, missing and unbound image alt text cannot create invented source labels", () => {
  const empty = directTextFixture({
      cmlValue: '<co-content><img alt=""/></co-content>',
      textSample: "",
    }),
    emptyContent = capturedContent(empty.payload, {
      basis: "direct",
      itemId: empty.itemId,
    });
  assert.deepEqual(emptyContent.imageAltText, [{ imageOrdinal: 1, text: "" }]);
  assert(
    !contentEvidenceText(emptyContent).includes("Authored image alt text"),
  );
  const missing = directTextFixture({
    cmlValue:
      '<co-content><img title="A filename cannot supply alt"/></co-content>',
    textSample: "",
  });
  assert.equal(
    capturedContent(missing.payload, {
      basis: "direct",
      itemId: missing.itemId,
    }).imageAltText,
    undefined,
  );
  const changed = directTextFixture();
  changed.payload.directDraftCml.definition.value =
    '<co-content><img alt="Unbound label"/></co-content>';
  assert.equal(
    capturedContent(changed.payload, {
      basis: "unbound",
      itemId: changed.itemId,
    }).imageAltText,
    undefined,
  );
  assert.equal(
    capturedContent(
      {
        directDraftCml: changed.payload.directDraftCml,
        imageAltText: [{ imageOrdinal: 1, text: "Unproven" }],
      },
      { basis: "unproven" },
    ).imageAltText,
    undefined,
  );
});
test("direct text coverage recomputes raw CML, source stability and text hashes instead of trusting flags", () => {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const mutations = [
    (p) => {
      p.textSample = "Changed text";
      p.textLength = p.textSample.length;
      p.textSha256 = hash(p.textSample);
      p.directDataEvidence.plainTextLength = p.textSample.length;
    },
    (p) => {
      p.directDraftCml.definition.value =
        "<co-content><p>Changed</p></co-content>";
      p.directDataEvidence.rawCmlLength =
        p.directDraftCml.definition.value.length;
      p.directDataEvidence.rawCmlSha256 = hash(
        p.directDraftCml.definition.value,
      );
    },
    (p) => {
      p.directDataSources.atom.elements[0].draft.content.definition.content.definition.value +=
        " ";
    },
    (p) => {
      p.directDataSources.receipts.stability.atom.elements[0].draft.content.definition.content.definition.value +=
        " ";
    },
    (p) => {
      p.directDataSources.receipts.stability.draftHash = "0".repeat(64);
    },
    (p) => {
      p.directDataSources.receipts.atom.requestPath += "wrong";
    },
    (p) => {
      p.directDataEvidence.itemId = "wrong-item";
    },
    (p) => {
      p.textCaptureTruncated = true;
    },
    (p) => {
      delete p.directDraftCml;
    },
  ];
  for (const mutate of mutations) {
    const fixture = directTextFixture();
    mutate(fixture.payload);
    const result = capturedContent(fixture.payload, {
      basis: "direct",
      itemId: fixture.itemId,
    });
    assert.equal(result.textCoverage, "PARTIAL", String(mutate));
  }
  const fixture = directTextFixture();
  assert.equal(
    capturedContent(fixture.payload, { basis: "direct", itemId: "wrong-item" })
      .textCoverage,
    "PARTIAL",
  );
  const empty = directTextFixture({ empty: true });
  empty.payload.textSha256 = "0".repeat(64);
  assert.equal(
    capturedContent(empty.payload, { basis: "direct", itemId: empty.itemId })
      .textCoverage,
    "UNVERIFIED",
  );
});
test("new comparisons retain original Coursera content and later partial checks do not erase the previous observation", () => {
  const input = comparisonFixture(),
    original = structuredClone(input.course.data.scan.courseTree);
  const output = createWorkflows(workerXml).compare(input);
  validateContentSnapshot(output.contentEvidence);
  assert.equal(
    output.contentEvidence.coursera[0].content.text,
    JSON.parse(new TextDecoder().decode(input.json.bytes)).fingerprints[0]
      .payload.textSample,
  );
  const task = buildOwnerTasks(
    output.result,
    input.course.data.scan.courseTree,
  )[0];
  const view = itemContentView(
    task,
    output.contentEvidence,
    {},
    { payload, editorObserved: false, finishedAt: "2026-10-04T18:00:00Z" },
  );
  assert.equal(view.coursera.questionCoverage, "PARTIAL");
  assert.equal(
    view.previousCoursera.text,
    output.contentEvidence.coursera[0].content.text,
  );
  assert(view.source[0].text);
  assert.deepEqual(input.course.data.scan.courseTree, original);
  const duplicate = structuredClone(output.contentEvidence);
  duplicate.coursera.push(duplicate.coursera[0]);
  assert.equal(
    itemContentView(task, duplicate).coursera.basis,
    "Older report excerpt",
  );
});
test("Brightspace definition content joins by tool identity, never by duplicate quiz title", () => {
  const bs = {
    capturedAt: "2026-10-04T18:00:00Z",
    contentTree: [
      {
        kind: "TOPIC",
        id: 12,
        title: "Quiz",
        toolItemId: 23,
        contentEvidence: { text: "Source wrapper" },
      },
    ],
    quizzes: [
      {
        id: 99,
        name: "Quiz",
        questions: [{ QuestionText: { Text: "WRONG" } }],
      },
      {
        id: 23,
        name: "Quiz",
        questions: [
          {
            QuestionText: { Text: "Right source prompt" },
            QuestionType: "ShortAnswer",
          },
        ],
        questionCount: 1,
        questionsStatus: "CAPTURED",
      },
    ],
  };
  const s = buildContentSnapshot(undefined, encode(bs));
  assert.equal(s.brightspace.length, 1);
  assert.match(s.brightspace[0].content.questions[0].prompt, /Right source/);
  assert(!JSON.stringify(s).includes("WRONG"));
  assert.equal(s.brightspace[0].content.textCoverage, "PARTIAL");
});
test("public source returns useful partial text and banks without claiming a complete quiz", async () => {
  const target = "https://opentextbc.ca/example/chapter/quiz/";
  const html =
    '<main><p>First part of the reading.</p><iframe src="/example/?h5p-embed=4"></iframe></main>';
  let calls = 0;
  const capture = await fetchSourceQuestions(
    "key",
    target,
    async () =>
      new Response(++calls === 1 ? html : "Forbidden", {
        status: calls === 1 ? 200 : 403,
        headers: { "Content-Type": "text/html" },
      }),
  );
  validateSourceQuestionCapture(capture);
  assert.equal(capture.status, "PARTIAL");
  assert.equal(capture.bank, null);
  assert.match(capture.pages[0].text, /First part/);
  assert.match(capture.reason, /HTTP 403/);
});
test("H5P captures long prompts and choices with explicit truncation and safely readable markup", async () => {
  const prompt = "A long prompt ".repeat(800),
    h5p = {
      contents: {
        "cid-1": {
          library: "H5P.QuestionSet 1.17",
          jsonContent: JSON.stringify({
            questions: [
              {
                library: "H5P.MultiChoice 1.16",
                params: {
                  question: prompt,
                  answers: [
                    { text: "<p>Choice &amp; one</p>", correct: true },
                    { text: "Choice two", correct: false },
                  ],
                },
              },
            ],
          }),
        },
      },
    };
  const capture = await fetchSourceQuestions(
    "key",
    "https://opentextbc.ca/example/",
    async () =>
      new Response(
        "<script>H5PIntegration = " + JSON.stringify(h5p) + "</script>",
        { headers: { "Content-Type": "text/html" } },
      ),
  );
  assert.equal(capture.status, "CAPTURED");
  assert.equal(capture.bank.questions[0].prompt, prompt.trim());
  assert.equal(capture.bank.questions[0].promptTruncated, false);
  assert.equal(capture.bank.questions[0].options[0].text, "Choice & one");
  validateSourceQuestionCapture(capture);
});
