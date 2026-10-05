import { comparisonFixture, encode } from "./workflow-fixtures.mjs";
import { writeWorkbook } from "../src/adapters/workbook.ts";

// Template wording supplied in the item screenshots, with synthetic identities.
export function contactTemplateFixture() {
  const input = comparisonFixture();
  const body =
    "Facilitator Bio The Meet Your Facilitator page can serve many different purposes. Among these uses, it is great as a dedicated space to present your expertise, experience and personality. Recommended image size: at least 600 pixels wide. Contact Info Email: first.last.@email.com Phone: (000)000-0000 Office Hours: 8:00 a.m. - 5 p.m.";
  const name = "Instructor Contact Information";
  const node = input.course.data.scan.courseTree[0].children[0];
  node.title = name;
  Object.assign(node.sourcePayload, {
    textSample: "Meet Your Facilitator Meet Your Facilitator " + body,
    textLength: 377,
    links: ["mailto:first.last.@email.com"],
    images: ["/shared/template/instructor.jpg", "/shared/template/logo.png"],
  });
  const capture = JSON.parse(new TextDecoder().decode(input.json.bytes));
  capture.fingerprints[0].name = name;
  Object.assign(capture.fingerprints[0].payload, {
    textSample: body.replace("Phone:", "Opens in a new tab Phone:"),
    textLength: 352,
    links: ["mailto:first.last.@email.com"],
  });
  input.json.bytes = encode(capture);
  input.excel.bytes = writeWorkbook({
    name: "synthetic",
    sheets: {
      "FOR IMPORT": {
        values: [
          ["Module"],
          ["***Name", "Module 1"],
          ["Lesson"],
          ["***Name", "Lesson 1"],
          ["Reading", name, "", "", "", "", "", "reading"],
          ["Discussion Prompt", "Discussion", "", "", "", "", "", "discussion"],
        ],
      },
    },
  });
  return input;
}
