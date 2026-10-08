import { captureFixture } from "./activity-designer-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

function context() {
  const ctx = vm.createContext({
    console,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DOMException,
    AbortController,
    DOMParser,
    crypto,
    JSZip,
    setTimeout,
    clearTimeout,
  });
  for (const name of [
    "xml-reader",
    "shell-capture",
    "cti-adapter",
    "core",
    "designer",
    "readiness",
    "compact",
  ])
    vm.runInContext(
      fs.readFileSync(
        new URL("../src/activity-designer/" + name + ".js", import.meta.url),
        "utf8",
      ),
      ctx,
    );
  return ctx;
}
const file = (name, data) => {
  const bytes = Buffer.from(
    typeof data === "string" ? data : JSON.stringify(data),
  );
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
};

function fixture(ctx) {
  const s = ctx.CourseShell.toSession(
    captureFixture(),
    "capture.json",
    ctx.CoursePrep,
  );
  const r = JSON.parse(JSON.stringify(ctx.ActivityDesigner.template));
  Object.assign(r, { title: s.title, bundle_created_at: s.created_at });
  const a = r.activities[0];
  a.type = "dialogue";
  a.title = "Explain the units";
  a.fields = ctx.ActivityDesigner.required.dialogue.map((label) => ({
    label,
    text:
      label === "Title"
        ? a.title
        : "A complete, original " + label + " for reasoning about units.",
  }));
  a.context = { text: "", filename: "" };
  a.placement = {
    course: s.title,
    module: "First module",
    lesson: "Lesson",
    after: "Teaching",
    before: "Quiz",
    branch_id: "b1",
    module_id: "m1",
    lesson_id: "l1",
    after_item_id: "i1",
    before_item_id: "i2",
    row: null,
    export_file: "",
    notes: "",
  };
  a.evidence = [{ source_path: "coursera/b1/i1", locator: "item i1" }];
  a.checks = [];
  r.module_decisions = [
    {
      course: s.title,
      module: "First module",
      branch_id: "b1",
      module_id: "m1",
      decision: "dialogue",
      reason: "Explain the choice.",
    },
  ];
  return { s, r, a };
}
test("CTI adapter allowlists prompt/option text and retains uncertainty without keys or unrelated metadata", () => {
  const c = context(),
    raw = {
      extractedAt: "2026-10-08T16:00:00Z",
      page: {
        courseId: "b1",
        title: "Edit Content | Course | Coursera",
        url: "https://www.coursera.org/teach/test/b1/content/edit",
      },
      meta: { extractor: "v6.15.10", secret: "PRIVATE_TOKEN" },
      fingerprints: [
        {
          id: "i1",
          name: "Quiz",
          typeName: "ungradedAssignment",
          path: "M > L",
          payload: {
            textSample: "SECRET_AUTHORING_KEY",
            structuredAssessment: {
              declaredQuestionCount: 3,
              questions: [
                {
                  prompt: "Choose a unit.",
                  options: [
                    { text: "Metres", correct: true },
                    { text: "Seconds", correct: false },
                  ],
                  correctAnswers: ["SECRET_KEY"],
                  feedback: "SECRET_FEEDBACK",
                },
              ],
            },
          },
        },
      ],
    };
  const result = c.CourseCtiAdapter.adapt(raw),
    serial = JSON.stringify(result);
  assert(!serial.includes("SECRET_") && !serial.includes("PRIVATE_TOKEN"));
  assert.equal(result.items[0].blocks.length, 3);
  assert.equal(result.items[0].assessment_capture.declared_questions, 3);
  assert.equal(result.items[0].assessment_capture.options_captured, 2);
  assert.equal(result.items[0].coverage, "partial");
  assert.equal(result.items[0].ancestors[0].id, "");
  assert.equal(
    c.CourseCtiAdapter.route(
      "https://evil.example/teach/test/b1/content/item/project/i1",
      "b1",
      "i1",
    ),
    "",
  );
  assert.equal(
    c.CourseCtiAdapter.route(
      "https://www.coursera.org/teach/test/b2/content/item/project/i1",
      "b1",
      "i1",
    ),
    "",
  );
});
test("prompt/option metrics and exact paths survive capture import, packets and restore", async () => {
  const c = context(),
    s = await c.CoursePrep.processFiles(
      [file("capture.json", captureFixture())],
      { phase: "final" },
    ),
    p = c.CourseCompact.build(s).packets[0];
  const q = p.data.structure[0].module.lessons[0].items[1];
  assert.equal(q.assessment_capture.prompts_captured, 1);
  assert.equal(q.assessment_capture.options_captured, 1);
  assert.equal(q.assessment_capture.choice_controls_seen, 4);
  assert.equal(q.assessment_capture.completeness, "partial_unverified");
  const restored = c.CoursePrep.validateSession(JSON.parse(JSON.stringify(s)));
  assert.equal(
    restored.sources[0].documents[1].assessment_capture
      .visible_question_headers,
    2,
  );
});
test("capture replacement is file-order-independent, never blends old bodies, and rejects conflicting or diagnostic replacement", async () => {
  const c = context(),
    { s } = fixture(c),
    fresh = captureFixture();
  fresh.created_at = "2026-10-09T00:00:00Z";
  fresh.items[0].blocks[0].text = "Fresh teaching.";
  for (const files of [
    [file("SESSION.json", s), file("fresh.json", fresh)],
    [file("fresh.json", fresh), file("SESSION.json", s)],
  ]) {
    const merged = await c.CoursePrep.processFiles(files, { phase: "final" });
    assert.equal(merged.sources.length, 1);
    assert(merged.sources[0].documents[0].text.includes("Fresh teaching."));
    assert(
      !merged.sources[0].documents[0].text.includes("Measured dimensions"),
    );
  }
  await assert.rejects(
    c.CoursePrep.processFiles([
      file("one.json", fresh),
      file("two.json", captureFixture()),
    ]),
    /one current capture/,
  );
  fresh.capture_scope = "current_item";
  await assert.rejects(
    c.CoursePrep.processFiles([
      file("SESSION.json", s),
      file("test.json", fresh),
    ]),
    /one-item diagnostic/,
  );
});
test("malformed saved hierarchy, invalid dates, missing content and cancellation fail explicitly", async () => {
  const c = context(),
    { s } = fixture(c);
  const malformed = structuredClone(s);
  malformed.courses[0].modules[0].lessons = null;
  assert.throws(() => c.CoursePrep.validateSession(malformed), /lessons/);
  const capture = captureFixture();
  capture.created_at = "invalid";
  assert.throws(() => c.CourseShell.validate(capture), /timestamp/);
  await assert.rejects(
    c.CoursePrep.processFiles([file("bad.json", "{invalid")]),
    /bad.json/,
  );
  await assert.rejects(
    c.CoursePrep.processFiles([file("unsupported.exe", "binary")]),
    /No readable/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    c.CoursePrep.processFiles([file("capture.json", captureFixture())], {
      signal: abort.signal,
    }),
    { name: "AbortError" },
  );
});
test("readiness rejects stale snapshots, wrong IDs and false end boundaries while keeping a supported draft reviewable", () => {
  const c = context(),
    { s, r, a } = fixture(c);
  assert.equal(c.ActivityReadiness.check(r, s, a).canCopy, true);
  assert(
    c.ActivityReadiness.check(r, s, a).warnings.some((x) =>
      x.includes("assessment"),
    ),
  );
  assert.equal(
    c.ActivityReadiness.itemLink(s, a),
    captureFixture().items[0].route,
  );
  const stale = { ...r, bundle_created_at: "2026-10-01T00:00:00Z" };
  assert.equal(c.ActivityReadiness.check(stale, s, a).canCopy, false);
  for (const patch of [
    { before_item_id: "", before: "End of lesson" },
    { module_id: "wrong" },
    { after_item_id: "wrong" },
    { lesson: "Wrong lesson" },
  ])
    assert.equal(
      c.ActivityReadiness.check(r, s, {
        ...a,
        placement: { ...a.placement, ...patch },
      }).canCopy,
      false,
    );
  assert.throws(
    () => c.ActivityDesigner.parse({ ...r, mode: "opportunity" }),
    /Content Map/,
  );
  for (const path of ["coursera/b1/i2", "Shell_capture_receipt_b1.txt"])
    assert.equal(
      c.ActivityReadiness.check(r, s, {
        ...a,
        evidence: [{ source_path: path, locator: "" }],
      }).canCopy,
      false,
      "assessment-only or receipt evidence cannot justify a learner draft",
    );
});
test("raw evidence and explicit answer keys cannot become copyable learner activity context", () => {
  const c = context(),
    { s, r, a } = fixture(c);
  for (const text of [
    '{"format":"course-context-prep","schema_version":1}',
    "Correct answer: B",
    s.sources[0].documents[0].text.repeat(2),
  ])
    assert.equal(
      c.ActivityReadiness.check(r, s, { ...a, context: { text } }).canCopy,
      false,
    );
  assert.equal(
    c.ActivityReadiness.check(r, s, {
      ...a,
      context: {
        text: "Discuss the importance of clear units. Do not reveal quiz answers.",
      },
    }).canCopy,
    true,
  );
});
test("module identity resolves duplicate names, and revalidation preserves unrelated packet results", () => {
  const c = context(),
    { s, r } = fixture(c);
  s.courses[0].modules[1].title = "First module";
  const bad = structuredClone(r);
  delete bad.module_decisions[0].module_id;
  assert.throws(
    () => c.ActivityReadiness.resolveDecisions(bad, s),
    /ambiguous/,
  );
  c.ActivityReadiness.resolveDecisions(r, s);
  const next = structuredClone(r);
  next.activities = [];
  next.module_decisions = [
    {
      course: s.title,
      module: "First module",
      branch_id: "b1",
      module_id: "m2",
      decision: "hold",
      reason: "Unread.",
    },
  ];
  const combined = c.ActivityDesigner.merge(r, next);
  assert.equal(combined.activities.length, 1);
  assert.equal(combined.module_decisions.length, 2);
});
