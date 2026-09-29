import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  buildOwnerTasks,
  buildOwnerContext,
  safeWebUrl,
  courseraItemUrl,
  validateOwnerReview,
} from "../src/domain/owner-actions.ts";
import {
  buildItemCheckScript,
  validateItemCheck,
  evaluateItemEvidence,
} from "../src/domain/item-check.ts";
import { getExtractor } from "../src/domain/capture-review.ts";
import { recordSummary, newRecord } from "../src/domain/workspace-store.ts";
import { validateRecord } from "../src/domain/workspace-validation.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
const url =
  "https://www.coursera.org/teach/example/courseA/content/item/project/itemA";
const spec = {
  auditId: "audit-a",
  itemId: "itemA",
  courseId: "courseA",
  url,
  name: "Review example",
  checks: [
    {
      kind: "url",
      value: "https://example.test/file.pdf",
      label: "Expected file",
    },
  ],
};
function receipt() {
  return {
    kind: "CTI_COURSERA_ITEM_CHECK",
    schemaVersion: 1,
    notForCourseAudit: true,
    auditId: spec.auditId,
    itemId: spec.itemId,
    courseId: spec.courseId,
    openedUrl: url,
    expectations: structuredClone(spec.checks),
    finishedAt: "2026-09-29T10:00:00Z",
    editorObserved: true,
    payload: {
      links: [spec.checks[0].value],
      structuredAssessment: { questions: [] },
    },
  };
}

test("item URLs require an exact Coursera host and match the course and item", () => {
  for (const u of [
    "javascript:alert(1)",
    "data:text/html,x",
    "https://u:p@example.test",
  ])
    assert.equal(safeWebUrl(u), "");
  const r = {
    stats: {
      extractorMeta: {
        page: { url },
        activeSpaCrawl: {
          targetDiagnostics: [
            {
              id: "itemA",
              route:
                "https://www.coursera.org/teach/other/wrongCourse/content/item/project/itemA",
            },
            { id: "itemA", route: url },
          ],
        },
      },
    },
  };
  assert.equal(courseraItemUrl(r, "itemA"), url);
  assert.equal(
    courseraItemUrl(r, "other"),
    "https://www.coursera.org/teach/example/courseA/content/edit?itemId=other",
  );
  assert.equal(courseraItemUrl(r, "../bad"), "");
  assert.equal(
    courseraItemUrl(
      {
        stats: {
          extractorMeta: {
            page: {
              url: "https://coursera.org.evil.test/teach/x/courseA/content/edit",
            },
          },
        },
      },
      "itemA",
    ),
    "",
  );
});
test("owner tasks localize assessment gaps and never invent source matches for duplicate IDs", () => {
  const r = {
    ownerView: {
      items: [
        {
          id: "itemA",
          name: "Assessment",
          path: "Module 3",
          status: "EVIDENCE_NEEDED",
          actions: [],
        },
      ],
      unmappedSource: [],
    },
    itemResults: [
      {
        sourceId: "q",
        sourceName: "Quiz",
        sourcePath: "Module 3",
        courseraId: "itemA",
        checks: {
          structuredAssessment: {
            sourceQuestionCount: 2,
            courseraQuestionCount: 1,
            alignedQuestionCount: 1,
            unmatchedSourceQuestions: [1],
            sourceMediaQuestionNumbers: [2],
          },
        },
      },
    ],
  };
  const tree = [
    {
      title: "Module 3",
      children: [
        {
          title: "Quiz",
          idref: "q",
          sourcePayload: {
            structuredAssessment: {
              questions: [
                { prompt: "Exact absent prompt" },
                { prompt: "Image prompt", mediaRefs: ["images/sling.jpg"] },
              ],
            },
          },
        },
      ],
    },
  ];
  const task = buildOwnerTasks(r, tree)[0];
  assert.equal(task.sources.length, 1);
  assert.equal(task.checks[0].value, "Exact absent prompt");
  assert.equal(task.checks[1].value, "images/sling.jpg");
  assert.match(task.questionSummary[1], /question\(s\): 1/);
  tree[0].children.push(structuredClone(tree[0].children[0]));
  assert.equal(buildOwnerTasks(r, tree)[0].sources.length, 0);
});
test("merged items retain distinct source resources from the same module", () => {
  const sources = [
    { id: "sourceA", title: "Reading A" },
    { id: "sourceB", title: "Reading B" },
  ];
  const result = {
    ownerView: {
      items: [{ id: "itemA", name: "Merged reading", actions: [] }],
    },
    itemResults: sources.map((s) => ({
      sourceId: s.id,
      sourceName: s.title,
      sourcePath: "Module",
      courseraId: "itemA",
    })),
  };
  const task = buildOwnerTasks(result, [
    { title: "Module", children: sources },
  ])[0];
  assert.deepEqual(
    task.sources.map((s) => s.id),
    ["sourceA", "sourceB"],
  );
});
test("fresh item evidence records observations without claiming absence or clearing findings", () => {
  const c = receipt(),
    original = structuredClone(c);
  assert.equal(
    validateItemCheck(c, spec).evaluation.findings[0].status,
    "OBSERVED",
  );
  assert.deepEqual(c, original);
  c.payload.links = [];
  let e = evaluateItemEvidence(spec, c);
  assert.equal(e.findings[0].status, "NOT_OBSERVED");
  assert.equal(e.automatedResolution, false);
  assert.match(e.findings[0].meaning, /does not establish/);
  c.payload.links = [spec.checks[0].value];
  c.editorObserved = false;
  assert.equal(
    evaluateItemEvidence(spec, c).findings[0].status,
    "NOT_OBSERVED",
  );
});
test("reject wrong report, course, item, expected finding and diagnostic format", () => {
  for (const key of ["auditId", "courseId", "itemId", "openedUrl"]) {
    const c = receipt();
    c[key] = "wrong";
    assert.throws(() => validateItemCheck(c, spec));
  }
  const c = receipt();
  c.expectations = [];
  assert.throws(() => validateItemCheck(c, spec), /different findings/);
  assert.throws(
    () => validateItemCheck({ kind: "full-capture" }, spec),
    /item-check/,
  );
});
test("item script reuses canonical parsers with one fresh target and cannot be used as a course audit", () => {
  const script = buildItemCheckScript(getExtractor("coursera"), spec);
  new vm.Script(script);
  assert(
    script.includes(
      "activeSpaCrawl([fp],id,{onlyIds:[expected.itemId],maxItems:1",
    ),
  );
  assert(script.includes("notForCourseAudit:true"));
  assert(!script.includes("const knownCalls ="));
  const input = comparisonFixture();
  input.json.bytes = new TextEncoder().encode(JSON.stringify(receipt()));
  assert.throws(
    () => createWorkflows(workerXml).compare(input),
    /not a full Coursera capture/,
  );
  assert.throws(
    () =>
      buildItemCheckScript(
        { ...getExtractor("coursera"), version: "future" },
        spec,
      ),
    /compatible/,
  );
});
test("item script rejects another item before touching the page or starting extraction", async () => {
  const script = buildItemCheckScript(getExtractor("coursera"), spec);
  const c = { URL, location: { href: url.replace("itemA", "other") } };
  await assert.rejects(vm.runInNewContext(script, c), /exact Coursera item/);
});
test("manual completion requires a meaningful note, persists separately and list summaries omit raw payloads", () => {
  assert.throws(
    () => validateOwnerReview({ status: "checked", note: "done" }),
    /short note/,
  );
  const r = newRecord(
    "item-review",
    "Item",
    {
      auditId: "audit-a",
      itemKey: "item:itemA",
      review: {
        status: "checked",
        note: "I checked the source image and learner preview.",
        updatedAt: "2026-09-29",
        updatedBy: "Owner",
        capture: receipt(),
      },
    },
    "package-a",
  );
  validateRecord(r);
  const s = recordSummary(r);
  assert.equal(s.data.review.hasCapture, true);
  assert.equal(s.data.review.capture, undefined);
  assert.equal(r.data.review.capture.kind, "CTI_COURSERA_ITEM_CHECK");
});
test("source navigation preserves observed URLs and handles missing source capture", () => {
  assert.equal(buildOwnerContext(), undefined);
  const context = buildOwnerContext(
    new TextEncoder().encode(
      JSON.stringify({
        page: { url: "https://lms.example.test/course" },
        contentTree: [
          {
            title: "Module",
            children: [{ id: 1, title: "Source", url: "/source/file.html" }],
          },
        ],
      }),
    ),
  );
  assert.equal(
    context.sourceTopics[0].url,
    "https://lms.example.test/source/file.html",
  );
  assert.equal(context.sourceTopics[0].path, "Module");
});
