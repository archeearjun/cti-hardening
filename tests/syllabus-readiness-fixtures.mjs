import { comparisonFixture, encode } from "./workflow-fixtures.mjs";
import { writeWorkbook } from "../src/adapters/workbook.ts";

export const passRequirement =
  "An overall grade of 50% or higher is required to pass this course.";
export const aiStatement =
  "Although this course does not explicitly incorporate GenAI use into assessments, assignments, and course work the instructor recognizes students may still use AI tools as personal learning support.";
export function syllabusFixture({
  placeholders = true,
  live = true,
  updatedDestination = false,
  duplicateTopic = false,
  archive = false,
} = {}) {
  const input = comparisonFixture(),
    title = "Course Syllabus",
    module = archive ? "Archive" : "Module 1";
  input.course.data.partner = archive ? "NAIT" : "Example Partner";
  const body =
    "Course requirements describe weekly participation and practice activities. Review the learning resources and complete the scheduled assessment tasks by the announced deadlines. The course includes a sequence of examples, practice activities and assessments of the learner's understanding.";
  const template = placeholders
    ? "Instructor information Name [Include your title and what you prefer to be called] Contact info [Include information for your preferred method of contact here] Assessments [Brief description of assessment 1]. "
    : "";
  const text = template + body,
    liveText = text + " " + passRequirement + " " + aiStatement;
  input.course.data.scan.courseTree[0].title = module;
  const node = input.course.data.scan.courseTree[0].children[0];
  node.title = title;
  Object.assign(node.sourcePayload, {
    textSample: text,
    textLength: text.length,
    links: [],
    images: [],
  });
  const capture = JSON.parse(new TextDecoder().decode(input.json.bytes));
  capture.fingerprints[0].name = title;
  capture.fingerprints[0].path = module;
  Object.assign(capture.fingerprints[0].payload, {
    textSample: updatedDestination ? liveText : text,
    textLength: (updatedDestination ? liveText : text).length,
    links: [],
  });
  capture.fingerprints[1].path = module;
  input.json.bytes = encode(capture);
  input.excel.bytes = writeWorkbook({
    name: "synthetic",
    sheets: {
      "FOR IMPORT": {
        values: [
          ["Module"],
          ["***Name", module],
          ["Lesson"],
          ["***Name", "Lesson 1"],
          ["Reading", title, "", "", "", "", "", "reading"],
          ["Discussion Prompt", "Discussion", "", "", "", "", "", "discussion"],
        ],
      },
    },
  });
  if (live) {
    const topic = {
      kind: "TOPIC",
      id: "11",
      title,
      path: [module],
      activityTypeLabel: "File",
      url: "/syllabus.html",
      contentEvidence: {
        status: "CAPTURED",
        text: liveText,
        textLength: liveText.length,
      },
    };
    input.brightspace = {
      name: "synthetic-brightspace.json",
      bytes: encode({
        extractor: "CTI Brightspace v1.0.8",
        schemaVersion: 2,
        capturedAt: "2026-10-05T08:10:00.000Z",
        page: { url: "https://lms.example.test/d2l/home/7" },
        course: { orgUnitId: "7", title: "Synthetic Course" },
        contentTree: [
          {
            kind: "MODULE",
            title: module,
            children: [
              topic,
              ...(duplicateTopic ? [{ ...topic, id: "12" }] : []),
            ],
          },
        ],
        quizzes: [],
        assignments: [],
        discussions: [],
      }),
    };
  }
  return input;
}
