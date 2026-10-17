import { createAutomaticIngestionBasis } from "../../src/domain/ingestion-attempts.ts";
import { validateContentSnapshot } from "../../src/domain/content-evidence.ts";
import { validateRecord } from "../../src/domain/workspace-validation.ts";

export const runtimeFixtureBytes = 80 * 131072 + 4096;
export const runtimeFixtureQuestionCount = 4000;
export function syntheticRuntimeCourse() {
  return {
    id: "synthetic-runtime-course",
    kind: "package",
    title: "Synthetic Runtime Course.imscc",
    packageId: "",
    version: 0,
    updatedAt: "",
    updatedBy: "",
    data: {
      partner: "Synthetic Partner",
      owner: "Synthetic owner",
      scan: {
        fileName: "Synthetic Runtime Course.imscc",
        fileSha256: "a".repeat(64),
        courseTree: [
          {
            title: "Synthetic teaching module",
            type: "folder",
            children: Array.from({ length: 20 }, (_, index) => ({
              idref: `synthetic-source-reading-${index}`,
              title: `Synthetic source reading ${index}`,
              type: "webcontent",
              children: [],
            })),
          },
        ],
        stats: { totalItems: 20, webcontent: 20 },
      },
    },
  };
}
export function syntheticRuntimeAudit(course, savedCourse) {
  const content = (id, questions = []) => ({
    id,
    name: id,
    path: "Synthetic teaching module",
    content: {
      basis: "SYNTHETIC RUNTIME REGRESSION; no live course capture",
      capturedAt: "2026-10-17T00:00:00Z",
      url: `https://example.test/synthetic/${id}`,
      text: questions.length
        ? "Synthetic assessment content."
        : "Synthetic retained reading evidence. ".repeat(2500),
      textCoverage: "PARTIAL",
      textReason: "Synthetic fixture; no live source was inspected.",
      questions,
      questionCoverage: questions.length ? "COMPLETE" : "UNVERIFIED",
      expectedQuestions: questions.length || null,
      questionReason: "Only the explicitly synthetic definitions are retained.",
      references: ["https://example.test/synthetic/resource"],
      limitations: ["Synthetic integration evidence only."],
    },
  });
  const brightspace = Array.from({ length: 20 }, (_, i) =>
    content(`synthetic-source-reading-${i}`),
  );
  const coursera = Array.from({ length: 20 }, (_, i) =>
    content(`synthetic-destination-reading-${i}`),
  );
  let position = 0;
  for (let assessment = 0; assessment < 34; assessment++) {
    const count = 117 + (assessment < 22 ? 1 : 0);
    const questions = Array.from({ length: count }, (_, ordinal) => {
      const id = ++position;
      return {
        id: `synthetic-question-${id}`,
        ordinal: String(ordinal + 1),
        type: "single-select",
        prompt:
          `Synthetic runtime question ${id}: select the stated example. `.padEnd(
            400,
            "s",
          ),
        options: [
          {
            id: "a",
            text: "Synthetic stated example",
            feedback: "Synthetic authored option feedback.",
          },
          {
            id: "b",
            text: "Synthetic other example",
            feedback: "Synthetic authored alternative feedback.",
          },
        ],
        answers: ["a"],
        feedback: "Synthetic retained question feedback. ".repeat(7),
        media: [],
        limitations: ["Synthetic definition; not a real learner assessment."],
        answerCoverage: "CAPTURED",
        feedbackCoverage: "CAPTURED",
        answerKeyReliable: true,
      };
    });
    coursera.push(content(`synthetic-assessment-${assessment}`, questions));
  }
  if (position !== runtimeFixtureQuestionCount)
    throw Error("Synthetic question fixture count differs.");
  const audit = {
    id: "synthetic-runtime-10mib-audit",
    kind: "audit",
    title: "Synthetic Runtime Course · generation 0 · ops",
    packageId: course.id,
    version: 0,
    updatedAt: "",
    updatedBy: "",
    data: {
      generation: 0,
      packageId: course.id,
      sourceScanSha256: course.data.scan.fileSha256,
      automaticIngestion: createAutomaticIngestionBasis(course.id, [
        savedCourse,
      ]),
      result: { summary: { unresolved: 1 } },
      report:
        "Synthetic regression only. No live course completeness is asserted.",
      contentEvidence: { schemaVersion: 1, coursera, brightspace },
    },
  };
  let remaining =
    runtimeFixtureBytes -
    new TextEncoder().encode(JSON.stringify(audit.data)).length;
  if (remaining < 0)
    throw Error("Synthetic report exceeds its exact runtime size target.");
  for (const item of [...brightspace, ...coursera]) {
    if (!remaining || item.content.questions.length) continue;
    const characters = Math.min(remaining, 290000 - item.content.text.length);
    item.content.text += "s".repeat(characters);
    remaining -= characters;
  }
  if (
    remaining !== 0 ||
    new TextEncoder().encode(JSON.stringify(audit.data)).length !==
      runtimeFixtureBytes
  )
    throw Error(
      "Synthetic reading evidence could not meet its exact runtime size target.",
    );
  validateContentSnapshot(audit.data.contentEvidence);
  validateRecord(audit);
  return audit;
}
