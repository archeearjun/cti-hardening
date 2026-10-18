import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildContentSnapshot,
  validateContentSnapshot,
  contentEvidenceText,
} from "../src/domain/content-evidence.ts";
import { deriveBrightspaceLinkedAssessments } from "../src/domain/brightspace-linked-assessment.ts";
import { prepareOwnerReportExport } from "../src/domain/owner-report-export.ts";
import { newRecord } from "../src/domain/workspace-store.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const origin = "https://source.example.test";
const code = "abcdefab-cdef-3333-4444-555555555555-1234";
const activity = `https://ids.brightspace.com/activities/quiz/${code}`;
const link = `/d2l/common/dialogs/quickLink/quickLink.d2l?ou=187960&type=quiz&rcode=${code}`;
const sourceUrl = origin + "/content/enforced/187960-Synthetic/Assignment.html";
const html = (href) =>
  `<!DOCTYPE html><html><body><h1>Synthetic reading</h1><a href="${href.replaceAll("&", "&amp;")}">Open native quiz</a></body></html>`;
function fixture(href = link) {
  const raw = html(href),
    bytes = Buffer.from(raw),
    ref = sha(bytes);
  return {
    schemaVersion: 2,
    extractor: "CTI Brightspace v1.2.0",
    capturedAt: "2026-10-18T08:00:00.000Z",
    page: { url: origin + "/d2l/le/lessons/187960/topics/101", origin },
    course: { orgUnitId: "187960" },
    summary: { quizzes: 1, quizQuestions: 1 },
    contentTree: [
      {
        kind: "TOPIC",
        id: "101",
        title: "Assignment reading",
        path: ["Module 1"],
        activityType: 1,
        activityTypeLabel: "File",
        url: sourceUrl,
        contentEvidence: {
          status: "CAPTURED",
          url: sourceUrl,
          rawBodyRef: ref,
          bodyReceipt: {
            requestUrl: sourceUrl,
            responseUrl: sourceUrl,
            status: 200,
            observedAt: "2026-10-18T07:59:00.000Z",
            bytes: bytes.length,
            sha256: ref,
            complete: true,
            contentType: "text/html",
          },
          format: "html",
          contentType: "text/html",
          charset: "utf-8",
          html: raw,
          text: "Synthetic reading Open native quiz",
          textLength: 34,
          textSha256: sha("Synthetic reading Open native quiz"),
          projectionTruncated: false,
          references: [],
          links: [],
          images: [],
          embeds: [],
        },
      },
    ],
    quizzes: [
      {
        id: "301",
        name: "Synthetic assignment quiz",
        raw: {
          QuizId: 301,
          Name: "Synthetic native quiz name",
          ActivityId: activity,
          Description: { Text: "Native quiz description" },
        },
        questionsStatus: "CAPTURED",
        declaredQuestionCount: null,
        questionPageEvidence: {
          complete: true,
          stopReason: "END_OF_API_PAGES",
        },
        questionCoverage: {
          completenessVerified: false,
          status: "TOTAL_UNVERIFIED",
        },
        questions: [
          {
            QuestionId: 901,
            QuestionTypeId: 1,
            QuestionText: { Text: "Synthetic native question?" },
            QuestionInfo: {
              Answers: [
                {
                  PartId: 1,
                  Answer: { Text: "Source-marked choice" },
                  Weight: 100,
                },
                { PartId: 2, Answer: { Text: "Other choice" }, Weight: 0 },
              ],
            },
          },
        ],
      },
    ],
    assignments: [],
    discussions: [],
    assetBodies: {
      [ref]: {
        encoding: "base64",
        base64: bytes.toString("base64"),
        bytes: bytes.length,
        sha256: ref,
      },
    },
    contentAcquisition: { assets: [], gaps: [] },
  };
}
function snapshot(capture = fixture()) {
  const result = buildContentSnapshot(
    undefined,
    new TextEncoder().encode(JSON.stringify(capture)),
  );
  validateContentSnapshot(result);
  return result;
}
function source(capture) {
  const topic = capture.contentTree[0],
    ce = topic.contentEvidence;
  return {
    topicId: topic.id,
    courseId: capture.course.orgUnitId,
    pageUrl: capture.page.url,
    originalUrl: ce.bodyReceipt.responseUrl,
    originalRef: ce.rawBodyRef,
    bytes: ce.bodyReceipt.bytes,
    capturedAt: capture.capturedAt,
    rawHtml: ce.html,
  };
}
const project = () => ({ syntheticTestProjection: true });

test("verified authored same-course quickLink joins a separate native quiz without changing reading questions or coverage", () => {
  const capture = fixture(),
    before = structuredClone(capture),
    result = snapshot(capture),
    content = result.brightspace[0].content,
    linked = content.linkedSourceAssessments;
  assert.ok(linked);
  assert.deepEqual(content.questions, []);
  assert.equal(content.questionCoverage, "UNVERIFIED");
  assert.equal(capture.contentTree[0].activityType, 1);
  assert.equal(
    linked.source.originalRef,
    capture.contentTree[0].contentEvidence.rawBodyRef,
  );
  assert.equal(linked.assessments.length, 1);
  const assessment = linked.assessments[0];
  assert.equal(assessment.quizId, "301");
  assert.equal(assessment.quizName, "Synthetic native quiz name");
  assert.equal(assessment.activityId, activity);
  assert.equal(assessment.authoredUrl, link);
  assert.equal(assessment.resolvedUrl, origin + link);
  assert.equal(assessment.content.questions[0].id, "901");
  assert.equal(
    assessment.content.questions[0].prompt,
    "Synthetic native question?",
  );
  assert.deepEqual(assessment.content.questions[0].answers, [
    "Source-marked choice",
  ]);
  assert.equal(assessment.content.expectedQuestions, null);
  assert.equal(assessment.content.questionCoverage, "PARTIAL");
  assert.match(
    contentEvidenceText(content),
    /LINKED SOURCE NATIVE ASSESSMENTS/,
  );
  assert.match(contentEvidenceText(content), /Source-marked choice/);
  assert.deepEqual(capture, before);
});

test("linked native empty lists retain uncertainty unless the existing explicit empty contract is complete", () => {
  const capture = fixture();
  capture.quizzes[0].questions = [];
  const unknown =
    snapshot(capture).brightspace[0].content.linkedSourceAssessments
      .assessments[0].content;
  assert.equal(unknown.expectedQuestions, null);
  assert.equal(unknown.questionCoverage, "UNVERIFIED");
  capture.quizzes[0].questionCoverage.completenessVerified = true;
  capture.quizzes[0].questionCount = 0;
  const empty =
    snapshot(capture).brightspace[0].content.linkedSourceAssessments
      .assessments[0].content;
  assert.equal(empty.expectedQuestions, 0);
  assert.equal(empty.questionCoverage, "EMPTY");
});

test("relationship derives from original HTML, not stale links, projections, titles or native list positions", () => {
  const capture = fixture();
  capture.contentTree[0].contentEvidence.links = [
    { href: origin + link.replace("187960", "999") },
  ];
  capture.contentTree[0].contentEvidence.text =
    "No quiz referenced in the stale text projection";
  capture.contentTree[0].contentEvidence.textLength =
    capture.contentTree[0].contentEvidence.text.length;
  capture.contentTree[0].contentEvidence.textSha256 = sha(
    capture.contentTree[0].contentEvidence.text,
  );
  capture.quizzes.unshift({
    id: "300",
    name: capture.quizzes[0].name,
    raw: { QuizId: 300, ActivityId: activity + "0" },
    questions: [],
  });
  assert.equal(
    snapshot(capture).brightspace[0].content.linkedSourceAssessments
      .assessments[0].quizId,
    "301",
  );
  const absent = fixture("https://external.example.test/quiz");
  absent.contentTree[0].contentEvidence.links = [{ href: origin + link }];
  assert.equal(
    snapshot(absent).brightspace[0].content.linkedSourceAssessments,
    undefined,
  );
});

test("wrong-course, duplicate or unknown parameters, external URLs, userinfo, fragments and ambiguous identities never join", () => {
  for (const href of [
    link.replace("187960", "999"),
    link + "&ou=187960",
    link + "&OU=187960",
    link + "&unexpected=1",
    link + "#elsewhere",
    "https://external.example.test" + link,
    "https://someone@source.example.test" + link,
    link.replace("type=quiz", "type=survey"),
    link.replace(code, code.toUpperCase()),
  ]) {
    const capture = fixture(href);
    if (href === link) continue;
    assert.equal(
      deriveBrightspaceLinkedAssessments(
        source(capture),
        capture.quizzes,
        project,
      ),
      undefined,
      href,
    );
  }
  for (const mutate of [
    (capture) => capture.quizzes.push(structuredClone(capture.quizzes[0])),
    (capture) =>
      capture.quizzes.push({
        ...structuredClone(capture.quizzes[0]),
        id: "302",
        raw: { ...capture.quizzes[0].raw, QuizId: 302 },
      }),
    (capture) =>
      capture.quizzes.push({
        ...structuredClone(capture.quizzes[0]),
        raw: { ...capture.quizzes[0].raw, ActivityId: activity + "0" },
      }),
    (capture) => (capture.quizzes[0].raw.QuizId = 999),
    (capture) => (capture.quizzes[0].raw.ActivityId += "?guessed=1"),
    (capture) => (capture.course.orgUnitId = "999"),
    (capture) =>
      (capture.page.url = "https://external.example.test/d2l/home/187960"),
  ]) {
    const capture = fixture();
    mutate(capture);
    assert.equal(
      deriveBrightspaceLinkedAssessments(
        source(capture),
        capture.quizzes,
        project,
      ),
      undefined,
    );
  }
});

test("unverified originals and unsupported markup cannot acquire linked native evidence", () => {
  const capture = fixture();
  delete capture.contentTree[0].contentEvidence.rawBodyRef;
  delete capture.contentTree[0].contentEvidence.bodyReceipt;
  capture.assetBodies = {};
  assert.equal(
    snapshot(capture).brightspace[0].content.linkedSourceAssessments,
    undefined,
  );
  for (const body of [
    html(link).replace(
      "<body>",
      '<body><base href="https://external.example.test/">',
    ),
    `<html><body><script>${html(link)}</script></body></html>`,
    `<html><body><template>${html(link)}</template></body></html>`,
  ]) {
    const capture = fixture(),
      context = {
        ...source(capture),
        rawHtml: body,
        originalRef: sha(body),
        bytes: Buffer.byteLength(body),
      };
    assert.equal(
      deriveBrightspaceLinkedAssessments(context, capture.quizzes, project),
      undefined,
    );
  }
});

test("the optional linked projection fails closed at its aggregate native-question bound", () => {
  const capture = fixture();
  const secondCode = code.replace("-1234", "-1235");
  capture.quizzes[0].questions = Array.from({ length: 3000 }, (_, index) => ({
    QuestionId: 1000 + index,
  }));
  capture.quizzes.push({
    ...structuredClone(capture.quizzes[0]),
    id: "302",
    raw: { QuizId: 302, ActivityId: activity.replace(code, secondCode) },
  });
  const raw = html(link).replace(
    "</body>",
    `<a href="${link.replace(code, secondCode).replaceAll("&", "&amp;")}">Second quiz</a></body>`,
  );
  const context = {
    ...source(capture),
    rawHtml: raw,
    originalRef: sha(raw),
    bytes: Buffer.byteLength(raw),
  };
  assert.equal(
    deriveBrightspaceLinkedAssessments(context, capture.quizzes, project),
    undefined,
  );
});

test("saved linked evidence independently rejects changed keys, native identity, body, provenance, counts and unknown fields", () => {
  const original = snapshot();
  for (const mutate of [
    (value) =>
      (value.assessments[0].content.questions[0].answers = ["Invented key"]),
    (value) =>
      (value.assessments[0].content.questions[0].prompt = "Invented prompt"),
    (value) =>
      (value.assessments[0].content.questions[0].options[0].id =
        "guessed-native-key"),
    (value) => (value.assessments[0].content.questionCoverage = "COMPLETE"),
    (value) => (value.assessments[0].content.expectedQuestions = 1),
    (value) =>
      (value.assessments[0].content.capturedAt = "2026-10-19T08:00:00.000Z"),
    (value) => (value.assessments[0].quizId = "999"),
    (value) => (value.assessments[0].rcode += "0"),
    (value) => (value.assessments[0].nativeRecord += " "),
    (value) => (value.assessments[0].nativeRecordSha256 = "f".repeat(64)),
    (value) => (value.source.rawHtml += " "),
    (value) => (value.source.topicId = "999"),
    (value) => (value.source.courseId = "999"),
    (value) => (value.source.extra = "unrecognized provenance"),
    (value) =>
      value.nativeQuizInventory.push({ id: "302", activityId: activity }),
    (value) => (value.nativeQuizInventorySha256 = "f".repeat(64)),
    (value) => (value.extra = "unrecognized claim"),
    (value) => (value.assessments[0].content.wholeLibraryComplete = true),
  ]) {
    const changed = structuredClone(original);
    mutate(changed.brightspace[0].content.linkedSourceAssessments);
    assert.throws(() => validateContentSnapshot(changed));
  }
  const removed = structuredClone(original);
  delete removed.brightspace[0].content.linkedSourceAssessments;
  assert.throws(() => validateContentSnapshot(removed));
  const historical = structuredClone(original);
  delete historical.brightspace[0].content.linkedSourceAssessments;
  historical.brightspace[0].content.basis = "Original Brightspace extraction";
  assert.doesNotThrow(
    () => validateContentSnapshot(historical),
    "Older snapshots remain valid without the optional relationship field",
  );
});

test("saved linked records enforce the aggregate byte budget before parsing every individually bounded record", () => {
  const changed = snapshot(),
    group = changed.brightspace[0].content.linkedSourceAssessments;
  const assessment = group.assessments[0],
    native = JSON.parse(assessment.nativeRecord);
  native.syntheticLargeField = "a".repeat(4 * 1024 * 1024 + 1);
  assessment.nativeRecord = JSON.stringify(native);
  assessment.nativeRecordSha256 = sha(assessment.nativeRecord);
  group.assessments.push(structuredClone(assessment));
  assert.throws(
    () => validateContentSnapshot(changed),
    /aggregate native record bound/,
  );
});

test("owner export includes separately linked native questions without changing original audit statistics", async () => {
  const course = {
      ...newRecord("package", "Synthetic course", {}),
      id: "linked-course",
    },
    report = {
      packageId: course.id,
      report: "Original synthetic audit",
      result: { stats: { quizQuestions: 1 }, ownerView: { items: [] } },
      contentEvidence: snapshot(),
    },
    before = structuredClone(report);
  const exported = await prepareOwnerReportExport(
    report,
    "linked-audit",
    course,
    {
      list: async () => [],
      get: async () => {
        throw Error("No saved review");
      },
    },
  );
  assert.equal(exported.followUp.linkedSourceAssessments.length, 1);
  assert.equal(exported.followUp.linkedSourceAssessments[0].topicId, "101");
  assert.match(
    exported.text,
    /READINGS WITH CAPTURED LINKED SOURCE NATIVE ASSESSMENTS/,
  );
  assert.match(exported.text, /Synthetic native question\?/);
  assert.match(exported.text, /Source-marked choice/);
  assert.equal(exported.evidence.result.stats.quizQuestions, 1);
  assert.deepEqual(report, before);
});
