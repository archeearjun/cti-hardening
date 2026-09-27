import { writeWorkbook } from "../src/adapters/workbook.ts";
import { newRecord } from "../src/domain/workspace-store.ts";
export const encode = (value) =>
  new TextEncoder().encode(JSON.stringify(value));
export function comparisonFixture() {
  const body =
    "Learning about quantities means comparing units and understanding how each measurement describes the same amount. Read the guide and discuss a worked example.";
  const course = newRecord("package", "Synthetic.imscc", {
    partner: "Example Partner",
    owner: "Owner",
    scan: {
      fileName: "Synthetic.imscc",
      fileSha256: "a".repeat(64),
      courseTree: [
        {
          title: "Module 1",
          type: "folder",
          children: [
            {
              title: "Reading",
              type: "webcontent",
              idref: "reading",
              sourcePayload: {
                textSample: body,
                textLength: body.length,
                links: ["https://example.test/guide"],
                files: [],
                images: [],
              },
              children: [],
            },
            {
              title: "Discussion",
              type: "imsdt_xmlv1p1",
              idref: "discussion",
              sourcePayload: {
                textSample: "Discuss a worked example.",
                textLength: 25,
              },
              children: [],
            },
          ],
        },
      ],
      stats: {
        webcontent: 1,
        discussions: 1,
        quizzes: 0,
        assignments: 0,
        lti: 0,
        emptyFolders: 0,
        totalItems: 2,
        ifs: 2,
      },
    },
  });
  const rows = [
    ["Module"],
    ["***Name", "Module 1"],
    ["Lesson"],
    ["***Name", "Lesson 1"],
    ["Reading", "Reading", "", "", "", "", "", "reading"],
    ["Discussion Prompt", "Discussion", "", "", "", "", "", "discussion"],
  ];
  const capture = {
    schemaVersion: 34,
    page: {
      title: "Synthetic Course",
      url: "https://www.coursera.org/teach/synthetic/course/content/edit",
    },
    meta: { buildId: "synthetic-test-only" },
    fingerprints: [
      {
        id: "reading",
        name: "Reading",
        type: "Reading",
        path: "Module 1",
        payload: {
          textSample: body,
          textLength: body.length,
          textScopeKind: "item-scoped",
          textEvidenceCompleteness: 1,
          links: ["https://example.test/guide"],
          published: false,
        },
      },
      {
        id: "discussion",
        name: "Discussion",
        type: "Discussion Prompt",
        path: "Module 1",
        payload: {
          textSample: "Discuss a worked example.",
          textLength: 25,
          published: false,
        },
      },
    ],
  };
  return {
    course,
    excel: {
      name: "synthetic.xlsx",
      bytes: writeWorkbook({
        name: "synthetic",
        sheets: { "FOR IMPORT": { values: rows } },
      }),
    },
    json: { name: "synthetic.json", bytes: encode(capture) },
    mode: "raw",
    generation: 1,
    history: [],
  };
}
export const masterRows = [
  ["level", "name", "node_type", "assignment_tool", "path"],
  [1, "Welcome to Achieve", "container", "", "Welcome"],
  [2, "Welcome note", "item", "reading", "Welcome > note"],
  [1, "Ch 1: Quantities", "container", "", "Ch 1"],
  [2, "Reasoning About Quantities", "item", "reading", "Ch 1 > Reasoning"],
  [1, "Chapter 2: Numeration", "container", "", "Chapter 2"],
  [2, "Place Value", "item", "reading", "Chapter 2 > Place Value"],
  [3, "Practice", "item", "assessment", "Chapter 2 > Practice"],
];
