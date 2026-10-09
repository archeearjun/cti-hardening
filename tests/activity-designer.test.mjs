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
    atob,
    btoa,
    JSZip,
    setTimeout,
    clearTimeout,
  });
  for (const name of [
    "xml-reader",
    "shell-capture",
    "cti-adapter",
    "cti-documents",
    "activity-quality",
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
  a.design = {
    case_facts: [],
    learner_task: "Explain why volume uses cubed units.",
    interaction:
      "Ask for a unit choice, challenge a linear unit, stop after a justified revision.",
    success_criteria: [
      "Distinguish linear and cubic measurements.",
      "Justify the choice using the measured dimensions.",
    ],
    comparison: [
      {
        item_id: "i2",
        difference:
          "The quiz selects a unit; this conversation asks for the reasoning and correction of a mistaken unit.",
      },
    ],
  };
  a.fields.find((f) => f.label === "Purpose of activity").text =
    a.design.learner_task + " " + a.design.interaction;
  a.fields.find((f) => f.label === "Advanced").text =
    a.design.success_criteria.join(" ") +
    " Both actions are completed independently and applied to a changed example.";
  a.fields.find((f) => f.label === "Intermediate").text =
    "Selects cubic units but needs a prompt to connect all three dimensions to the choice.";
  a.fields.find((f) => f.label === "Beginner").text =
    "Still selects a linear unit after a prompt or cannot relate dimensions to volume.";
  // This fixture is the successful path; the raw fixture deliberately models
  // missing visible prompts/options, tested separately below.
  s.courses[0].modules[0].lessons[0].items[1].assessment_capture.visible_question_headers = 1;
  s.courses[0].modules[0].lessons[0].items[1].assessment_capture.choice_controls_seen = 1;
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
      x.includes("practice lacks verified learner-text coverage"),
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

function ctiRaw() {
  return {
    extractedAt: "2026-10-08T18:00:00Z",
    page: {
      courseId: "b1",
      title: "Edit Content | Synthetic course | Coursera",
      url: "https://www.coursera.org/teach/test/b1/content/edit",
    },
    meta: { extractor: "v6.15.11" },
    fingerprints: [
      {
        id: "i1",
        name: "Teaching",
        typeName: "supplement",
        ancestors: [
          { id: "m1", title: "First module", key: "m1" },
          { id: "l1", title: "Lesson", key: "m1/l1" },
        ],
        payload: {
          textScopeKind: "reading-content-field",
          textSample:
            "Volume requires three dimensions measured in compatible units.",
          readingEditorEvidence: {
            courseId: "b1",
            itemId: "i1",
            route:
              "https://www.coursera.org/teach/test/b1/content/item/supplement/i1",
          },
        },
      },
    ],
  };
}
test("canonical adapter preserves exact hierarchy, repeated labeled choices, discussion prompts and assignment blocks", () => {
  const c = context(),
    raw = ctiRaw();
  const fp = (id, typeName, payload) => ({
    ...raw.fingerprints[0],
    id,
    name: id,
    typeName,
    payload,
  });
  raw.fingerprints.push(
    fp("i2", "ungradedAssignment", {
      structuredAssessment: {
        declaredQuestionCount: 2,
        questions: [1, 2].map(() => ({
          prompt: "Choose the units.",
          options: [
            { label: "Cubic metres", correct: true },
            { label: "Metres", description: "Linear distance", correct: false },
          ],
          correctAnswers: ["PRIVATE_KEY"],
        })),
      },
    }),
  );
  raw.fingerprints.push(
    fp("i3", "discussionPrompt", {
      textScopeKind: "discussion-prompt-field",
      textSample: "Explain a situation where units changed your estimate.",
    }),
  );
  raw.fingerprints.push(
    fp("i4", "ungradedAssignment", {
      nativeAssignment: {
        contentBlockEvidence: {
          blocks: [
            {
              title: "Directions",
              text: "Measure three dimensions and explain the estimate.",
            },
          ],
        },
        rubrics: [{ text: "PRIVATE_RUBRIC" }],
      },
    }),
  );
  const projected = c.CourseCtiAdapter.adapt(raw);
  assert.equal(projected.items[0].ancestors[0].id, "m1");
  assert.equal(projected.items[1].assessment_capture.prompts_captured, 2);
  assert.equal(projected.items[1].assessment_capture.options_captured, 4);
  assert.equal(projected.items[2].blocks[0].kind, "assessment");
  assert.equal(
    projected.items[3].blocks[0].text,
    "Measure three dimensions and explain the estimate.",
  );
  assert(!JSON.stringify(projected).includes("PRIVATE_"));
  raw.meta.activeSpaCrawl = {
    targetDiagnostics: [
      {
        id: "i2",
        route:
          "https://www.coursera.org/teach/test/b1/content/item/ungradedAssignment/i2?token=PRIVATE_TOKEN",
      },
    ],
  };
  assert.equal(
    c.CourseCtiAdapter.adapt(raw).items[1].route,
    "https://www.coursera.org/teach/test/b1/content/item/ungradedAssignment/i2",
  );
  raw.fingerprints[1].payload.structuredAssessment.questions[0].optionTextReliable = false;
  const session = c.CourseShell.toSession(
    c.CourseCtiAdapter.adapt(raw),
    "cti.json",
    c.CoursePrep,
  );
  assert(
    c.ActivityQuality.coverage(session, {
      branch_id: "b1",
      module_id: "m1",
    }).incomplete.some((i) => i.id === "i2"),
  );
});
test("known unread item references resolve as gaps, while missing identities and unsafe drafts remain blocked", () => {
  const c = context(),
    { s, r, a } = fixture(c);
  const hold = {
    ...a,
    status: "hold",
    fields: [],
    evidence: [
      ...a.evidence,
      {
        source_path: "coursera/b1/i3",
        locator: "Known unread item",
        purpose: "gap",
      },
    ],
  };
  const checks = c.ActivityReadiness.check(r, s, hold);
  assert(
    checks.warnings.some((x) => x.includes("Known item has no readable body")),
  );
  assert(!checks.blocking.some((x) => x.includes("not present")));
  assert(
    !c.ActivityDesigner.issues({ ...r, activities: [hold] }, s).cards[
      a.id
    ].some((x) => x.includes("Source path not found")),
  );
  const invented = {
    ...hold,
    evidence: [{ source_path: "coursera/b1/invented", locator: "" }],
  };
  assert(
    c.ActivityReadiness.check(r, s, invented).blocking.some((x) =>
      x.includes("not present"),
    ),
  );
  const legacy = { ...a };
  delete legacy.design;
  assert(
    c.ActivityReadiness.check(r, s, legacy).blocking.some((x) =>
      x.includes("Regenerate"),
    ),
  );
  const item = s.courses[0].modules[0].lessons[0].items[1];
  item.body_available = false;
  s.sources[0].documents = s.sources[0].documents.filter(
    (d) => d.id !== item.id,
  );
  assert(
    c.ActivityReadiness.check(r, s, a).blocking.some(
      (x) => x.includes("Read existing practice") && x.includes("i2"),
    ),
  );
});
test("self-contained original cases are permitted, missing facts and unlabelled invented data are blocked", () => {
  const c = context(),
    { s, r, a } = fixture(c);
  a.type = "role_play";
  a.fields = c.ActivityDesigner.required.role_play.map((label) => ({
    label,
    text:
      label === "Title"
        ? a.title
        : label + ": Describe and justify the unit choice.",
  }));
  a.design.case_facts = [
    {
      text: "The fictional practice slab measures 2 m by 3 m by 0.1 m.",
      origin: "fictional",
      source_path: "",
    },
  ];
  a.fields.find((f) => f.label === "Scenario definition").text =
    a.design.case_facts[0].text + " " + a.design.interaction;
  a.fields.find((f) => f.label === "Tasks").text = a.design.learner_task;
  a.fields.find((f) => f.label === "Advanced").text =
    a.design.success_criteria.join(" ");
  assert.equal(c.ActivityReadiness.check(r, s, a).canCopy, true);
  a.fields.find((f) => f.label === "Scenario definition").text =
    "Calculate the truckloads using the site plan.";
  assert.equal(c.ActivityReadiness.check(r, s, a).canCopy, false);
  assert(
    c.ActivityReadiness.check(r, s, a).blocking.some((x) =>
      x.includes("each declared case fact"),
    ),
  );
});
test("captured PDF bytes are hash verified, deduplicated, read locally and saved with exact item association", async () => {
  const c = context(),
    raw = ctiRaw(),
    pdf = Buffer.from("%PDF-1.4\nSynthetic fixture bytes"),
    sha = Buffer.from(await crypto.subtle.digest("SHA-256", pdf)).toString(
      "hex",
    );
  raw.documentAssets = [
    {
      sha256: sha,
      size: pdf.length,
      mime: "application/pdf",
      base64: pdf.toString("base64"),
    },
  ];
  raw.fingerprints[0].payload.assetDetails = [
    {
      sha256: sha,
      documentRef: sha,
      name: "teaching.pdf",
      url: "https://cdn.example/asset?Signature=PRIVATE_TOKEN",
    },
  ];
  let calls = 0;
  const s = await c.CoursePrep.processFiles([file("cti.json", raw)], {
    phase: "final",
    pdf: async () => {
      calls++;
      return {
        text: "[PAGE 1]\nVolume is length times width times depth.\n[PAGE 2]\nInclude compatible units in all measurements.",
        note: "Two text pages; diagrams not interpreted.",
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(s.visual_assets.length, 1);
  assert.equal(s.visual_assets[0].source_paths[0], "coursera/b1/i1");
  const p = c.CourseCompact.build(s).packets[0];
  assert(p.text.includes("[PAGE 2]"));
  assert(!p.text.includes("PRIVATE_TOKEN"));
  assert(!p.text.includes(pdf.toString("base64")));
  assert.equal(p.data.teaching_attachments.length, 1);
  assert.deepEqual(Buffer.from(p.assets[`Teaching_PDFs/${sha}.pdf`]), pdf);
  const citedPath = `Teaching_PDFs/${sha}.pdf`;
  const resolved = c.ActivityQuality.source(s, citedPath);
  assert.equal(resolved.known, true);
  assert.equal(resolved.teaching, true);
  assert.match(resolved.docs[0].text, /\[PAGE 2\]/);
  assert(!resolved.docs[0].text.includes("Document viewer excerpt"));
  const { r, a } = fixture(c);
  a.status = "hold";
  a.fields = [];
  a.evidence = [
    { source_path: citedPath, locator: "pages 1–2", purpose: "teaching" },
  ];
  const checked = c.ActivityReadiness.check(r, s, a);
  assert(
    !checked.blocking.some((x) => /source path|No readable teaching/.test(x)),
  );
  assert(
    !c.ActivityDesigner.issues(r, s).cards[a.id].some((x) =>
      /source path/i.test(x),
    ),
  );
  assert(checked.warnings.some((x) => /visual-review claims/.test(x)));
  for (const wrongPath of [
    `Teaching_PDFs/${"f".repeat(64)}.pdf`,
    `${sha}.pdf`,
    `other/Teaching_PDFs/${sha}.pdf`,
    `${citedPath}?download=1`,
  ])
    assert.equal(c.ActivityQuality.source(s, wrongPath).known, false);
  const restored = await c.CoursePrep.processFiles([file("SESSION.json", s)], {
    phase: "final",
  });
  assert.deepEqual(
    Buffer.from(c.CoursePrep.bundleFiles(restored)[`Teaching_PDFs/${sha}.pdf`]),
    pdf,
  );
  assert.equal(c.ActivityQuality.source(restored, citedPath).teaching, true);
  raw.documentAssets[0].sha256 = "a".repeat(64);
  await assert.rejects(
    c.CoursePrep.processFiles([file("bad.json", raw)]),
    /checksum/,
  );
});
test("PDF parsing failures keep originals as unread visual evidence; protected attachments never enter teaching packets", async () => {
  const c = context(),
    raw = ctiRaw(),
    pdf = Buffer.from("%PDF-1.4\nFixture"),
    sha = Buffer.from(await crypto.subtle.digest("SHA-256", pdf)).toString(
      "hex",
    );
  raw.documentAssets = [
    {
      sha256: sha,
      size: pdf.length,
      mime: "application/pdf",
      base64: pdf.toString("base64"),
    },
  ];
  raw.fingerprints[0].payload.assetDetails = [
    { sha256: sha, documentRef: sha, name: "teaching.pdf" },
  ];
  const failed = await c.CoursePrep.processFiles([file("cti.json", raw)], {
    pdf: async () => {
      throw Error("parse failure");
    },
  });
  assert.equal(failed.visual_assets.length, 1);
  assert.match(failed.sources[0].documents[0].note, /could not be parsed/);
  const pdfPath = `Teaching_PDFs/${sha}.pdf`;
  // The item has a readable viewer excerpt, which must not masquerade as the
  // failed PDF's own text layer.
  const resolved = c.ActivityQuality.source(failed, pdfPath);
  assert.equal(resolved.known, true);
  assert.equal(resolved.readable, false);
  assert.equal(resolved.teaching, false);
  const { r, a } = fixture(c);
  a.evidence = [
    { source_path: pdfPath, locator: "page 1", purpose: "teaching" },
  ];
  const check = c.ActivityReadiness.check(r, failed, a);
  assert.equal(check.canCopy, false);
  assert(check.blocking.some((x) => /Original PDF is present/.test(x)));
  assert(!check.blocking.some((x) => /source path is not present/.test(x)));
  const imageOnly = await c.CoursePrep.processFiles([file("cti.json", raw)], {
    pdf: async () => ({
      text: "[PAGE 1]\n[No text layer on this page]\n\n[PAGE 2]\n[No text layer on this page]",
    }),
  });
  assert.equal(imageOnly.visual_assets.length, 1);
  assert.equal(c.ActivityQuality.source(imageOnly, pdfPath).readable, false);
  assert.equal(
    c.CourseShell.textQuality("[PAGE 1]\nSubstantive teaching text.").readable,
    true,
  );
  raw.fingerprints[0].payload.assetDetails[0].name = "answer-key.pdf";
  const protectedSession = await c.CoursePrep.processFiles(
    [file("cti.json", raw)],
    {
      pdf: async () => {
        throw Error("must not parse");
      },
    },
  );
  assert.equal(protectedSession.visual_assets.length, 0);
  const bad = structuredClone(raw.documentAssets[0]);
  bad.size = 9 * 1024 * 1024;
  assert.throws(() => c.CourseCtiDocuments.validate([bad]), /8 MiB|Invalid/);
});
test("PDF evidence cannot borrow readable text from a sibling attachment or item", () => {
  const c = context(),
    { s, r, a } = fixture(c);
  const sha = "a".repeat(64),
    other = "b".repeat(64);
  s.visual_assets = [{ sha256: sha, source_paths: ["coursera/b1/i1"] }];
  s.sources[0].documents[0].text += `\n\n[TEACHING | Captured PDF ${other} (text layer)]\nReadable text from a different file.`;
  const path = `Teaching_PDFs/${sha}.pdf`;
  assert.equal(c.ActivityQuality.source(s, path).readable, false);
  s.sources[0].documents[0].text += `\n\n[TEACHING | Captured PDF ${sha} (text layer)]\nUse all three dimensions for volume.`;
  const resolved = c.ActivityQuality.source(s, path);
  assert.equal(resolved.readable, true);
  assert.equal(resolved.docs[0].text, "Use all three dimensions for volume.");
  a.evidence = [{ source_path: path, purpose: "teaching", locator: "page 1" }];
  assert.equal(c.ActivityReadiness.check(r, s, a).canCopy, true);
  a.design.case_facts = [
    {
      text: "Use all three dimensions for volume.",
      origin: "source",
      source_path: path,
    },
  ];
  a.fields.find((f) => f.label === "Purpose of activity").text +=
    " Use all three dimensions for volume.";
  assert.equal(c.ActivityReadiness.check(r, s, a).canCopy, true);
  const withoutText = structuredClone(s);
  withoutText.sources[0].documents[0].text = "Unrelated readable item text.";
  assert.equal(c.ActivityReadiness.check(r, withoutText, a).canCopy, false);
  assert.equal(
    c.ActivityReadiness.check({ ...r, bundle_created_at: "different" }, s, a)
      .canCopy,
    false,
  );
});

test("editor placeholders remain gap evidence and cannot certify learner choice coverage", async () => {
  const c = context(),
    raw = ctiRaw();
  raw.fingerprints.push({
    ...raw.fingerprints[0],
    id: "i2",
    name: "Quiz",
    typeName: "ungradedAssignment",
    payload: {
      structuredAssessment: {
        declaredQuestionCount: 1,
        questions: [
          {
            id: "1",
            courseraQuestionId: "q1",
            type: "single-select",
            prompt: "13.963 + 335.021 + 2267.123 =",
            options: [
              { label: "Enter an option..." },
              { text: "\u200bEnter an option…" },
            ],
            optionTextReliable: true,
            answerTextReliable: true,
            correctAnswers: ["PRIVATE_KEY"],
          },
        ],
        captureCompleteness: {
          declared: 1,
          captured: 1,
          uniqueQuestionIds: 1,
          questionCoverageComplete: true,
          missingQuestionOrdinals: [],
        },
      },
    },
  });
  const capture = c.CourseCtiAdapter.adapt(raw),
    item = capture.items[1];
  assert.equal(item.assessment_capture.completeness, "partial_unverified");
  assert.equal(item.assessment_capture.options_captured, 0);
  assert.equal(item.assessment_capture.placeholder_options, 2);
  assert.equal(item.assessment_capture.prompts_captured, 1);
  assert.equal(item.blocks.filter((b) => b.kind === "gap").length, 2);
  assert(!JSON.stringify(capture).includes("PRIVATE_KEY"));
  const s = c.CourseShell.toSession(capture, "cti.json", c.CoursePrep);
  const restored = await c.CoursePrep.processFiles([file("SESSION.json", s)], {
    phase: "final",
  });
  assert.equal(
    restored.courses[0].modules[0].lessons[0].items[1].assessment_capture
      .placeholder_options,
    2,
  );
  assert(
    c.ActivityQuality.recovery(s, { branch_id: "b1", module_id: "m1" }).some(
      (x) => /Choice editor placeholders/.test(x),
    ),
  );
  const { r, a } = fixture(c);
  r.bundle_created_at = s.created_at;
  assert.equal(c.ActivityReadiness.check(r, s, a).canCopy, false);
  assert(
    !c.CourseCompact.build(
      s,
    ).packets[0].data.coverage_audit[0].learner_text_captured_ids.includes(
      "i2",
    ),
  );
  // Similar prose, valid zero values and legitimate state-label choices are
  // not blanket-filtered as placeholders.
  for (const labels of [
    ["Correct", "Incorrect"],
    ["0", "1"],
    ["Enter an option to proceed", "Cancel"],
  ]) {
    raw.fingerprints[1].payload.structuredAssessment.questions[0].options =
      labels.map((label) => ({ label }));
    assert.equal(
      c.CourseCtiAdapter.adapt(raw).items[1].assessment_capture.completeness,
      "learner_text_captured",
    );
  }
});

test("graded assignment types remain assessments through projection, packet counts and draft gates", () => {
  for (const typeName of ["staffGraded", "peerGraded"]) {
    const c = context(),
      raw = ctiRaw();
    raw.fingerprints.push({
      ...raw.fingerprints[0],
      id: "i2",
      name: "Assignment",
      typeName,
      payload: {
        textSample: "Unscoped authoring text must not become teaching.",
      },
    });
    const capture = c.CourseCtiAdapter.adapt(raw);
    assert.equal(
      capture.items[1].assessment_capture.completeness,
      "partial_unverified",
    );
    assert.equal(capture.items[1].blocks.length, 0);
    assert.equal(c.CourseShell.summary(capture).quizzes, 1);
    const s = c.CourseShell.toSession(capture, "cti.json", c.CoursePrep);
    const audit = c.CourseCompact.build(s).packets[0].data.coverage_audit[0];
    assert.equal(audit.assessment_items, 1);
    assert.equal(audit.assessment_items_with_text, 0);
    assert.equal(audit.unread_practice_ids.join(), "i2");
    const { r, a } = fixture(c);
    Object.assign(r, { title: s.title, bundle_created_at: s.created_at });
    Object.assign(a.placement, { course: s.title, before: "Assignment" });
    const check = c.ActivityReadiness.check(r, s, a);
    assert.equal(check.canCopy, false);
    assert(
      check.blocking.some(
        (x) => x.includes("Read existing practice") && x.includes("i2"),
      ),
    );
    assert(
      check.warnings.some((x) => x.includes("verified learner-text coverage")),
    );
  }
});

test("file-upload learner-text coverage uses the complete question receipt without requiring choices or an answer key", () => {
  const c = context(),
    raw = ctiRaw();
  const assessment = {
    declaredQuestionCount: 1,
    questions: [
      {
        id: "1",
        courseraQuestionId: "q1",
        type: "file-upload",
        prompt: "Upload your plan and explain the resource choices.",
        options: [],
        optionTextReliable: false,
        answerTextReliable: false,
        correctAnswers: [],
        responseTypeEvidence: {
          method: "OBSERVED_EDITOR_HEADING",
          text: "AI-Graded File Upload Question",
        },
      },
    ],
    captureCompleteness: {
      declared: 1,
      declaredContentParts: 1,
      captured: 1,
      uniqueQuestionIds: 1,
      questionCoverageComplete: true,
      missingQuestionOrdinals: [],
      answerCoverageComplete: false,
      requiredAnswerCoverageComplete: true,
      answerKeyNotApplicableQuestionOrdinals: [1],
    },
  };
  raw.fingerprints.push({
    ...raw.fingerprints[0],
    id: "i2",
    name: "Task",
    typeName: "staffGraded",
    payload: { structuredAssessment: assessment },
  });
  const metrics = () =>
    c.CourseCtiAdapter.adapt(raw).items[1].assessment_capture;
  assert.equal(metrics().completeness, "learner_text_captured");
  assert.equal(metrics().options_captured, 0);
  const s = c.CourseShell.toSession(
    c.CourseCtiAdapter.adapt(raw),
    "cti.json",
    c.CoursePrep,
  );
  const audit = c.CourseCompact.build(s).packets[0].data.coverage_audit[0];
  assert.equal(audit.assessment_items_with_text, 1);
  assert.equal(audit.learner_text_captured_ids.join(), "i2");
  for (const mutate of [
    (a) => {
      a.questions[0].type = "unknown-upload-widget";
    },
    (a) => {
      a.questions[0].prompt = "";
    },
    (a) => {
      a.questions[0].promptTextReliable = false;
    },
    (a) => {
      a.captureCompleteness.questionCoverageComplete = false;
    },
    (a) => {
      a.captureCompleteness.declaredContentParts = 2;
    },
    (a) => {
      a.questions[0].options = [{ label: "Unverified choice" }];
    },
  ]) {
    const copy = structuredClone(assessment);
    mutate(copy);
    raw.fingerprints[1].payload.structuredAssessment = copy;
    assert.equal(metrics().completeness, "partial_unverified");
  }
});

test("graded assignment PDF attachments cannot be packaged as teaching", async () => {
  for (const typeName of ["staffGraded", "peerGraded"]) {
    const c = context(),
      raw = ctiRaw();
    const pdf = Buffer.from("%PDF-1.4\nSynthetic assessment attachment");
    const sha = Buffer.from(
      await crypto.subtle.digest("SHA-256", pdf),
    ).toString("hex");
    raw.documentAssets = [
      {
        sha256: sha,
        size: pdf.length,
        mime: "application/pdf",
        base64: pdf.toString("base64"),
      },
    ];
    raw.fingerprints.push({
      ...raw.fingerprints[0],
      id: "i2",
      name: "Task",
      typeName,
      payload: {
        assetDetails: [{ sha256: sha, documentRef: sha, name: "document.pdf" }],
      },
    });
    const s = await c.CoursePrep.processFiles([file("cti.json", raw)], {
      phase: "final",
      pdf: async () => {
        throw Error("Assessment PDF must not be parsed as teaching");
      },
    });
    assert.equal(s.visual_assets.length, 0);
    assert.equal(
      c.CourseCompact.build(s).packets[0].data.teaching_attachments.length,
      0,
    );
  }
});

test("XLSX placement refresh preserves same-ID capture evidence and marks new items unread", async () => {
  const c = context(),
    raw = ctiRaw();
  raw.fingerprints.push({
    ...raw.fingerprints[0],
    id: "deleted",
    name: "Removed from current export",
  });
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="FOR IMPORT" r:id="r1"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  const rows = [
    { A: "Template" },
    { A: "Title", B: "Synthetic course" },
    { A: "**Branch ID", B: "b1" },
    { A: "Module", B: "1" },
    { A: "***Name", B: "First module" },
    { A: "**Module ID", B: "m1" },
    { A: "Lesson", B: "1" },
    { A: "***Name", B: "Lesson" },
    { A: "**Lesson ID", B: "l1" },
    { A: "supplement", B: "Teaching", H: "i1" },
    { A: "ungradedAssignment", B: "New task", H: "new" },
  ];
  zip.file(
    "xl/worksheets/sheet1.xml",
    "<worksheet><sheetData>" +
      rows
        .map(
          (r, n) =>
            `<row r="${n + 1}">` +
            Object.entries(r)
              .map(
                ([col, value]) =>
                  `<c r="${col}${n + 1}" t="inlineStr"><is><t>${value}</t></is></c>`,
              )
              .join("") +
            "</row>",
        )
        .join("") +
      "</sheetData></worksheet>",
  );
  const data = await zip.generateAsync({ type: "uint8array" }),
    xlsx = {
      name: "current.xlsx",
      size: data.length,
      arrayBuffer: async () => data.buffer,
    };
  for (const inputs of [
    [file("cti.json", raw), xlsx],
    [xlsx, file("cti.json", raw)],
  ]) {
    const s = await c.CoursePrep.processFiles(inputs, { phase: "final" });
    assert.equal(s.courses[0].kind, "coursera_shell_capture");
    const items = s.courses[0].modules[0].lessons[0].items;
    assert.equal(items[0].body_available, true);
    assert.equal(items[0].row, 10);
    assert.equal(items[1].body_available, false);
    assert.equal(s.sources[0].documents.length, 1);
    assert(s.sources[0].unread.some((u) => u.path === "coursera/b1/new"));
    const packet = c.CourseCompact.build(s).packets[0];
    assert.equal(packet.data.coverage_audit[0].assessment_items_with_text, 0);
    assert(!packet.data.documents.some((d) => d.id === "deleted"));
    assert.equal(packet.data.structure[0].captured_at, raw.extractedAt);
  }
});
test("a detailed brief cannot make generic or disconnected Coursera fields copyable", () => {
  const c = context(),
    { s, r, a } = fixture(c);
  a.fields.find((f) => f.label === "Purpose of activity").text =
    "Practice and discuss the subject with an expert.";
  a.fields.find((f) => f.label === "Advanced").text =
    "Shows confident understanding.";
  const check = c.ActivityReadiness.check(r, s, a);
  assert.equal(check.canCopy, false);
  assert(check.blocking.some((x) => x.includes("actual Tasks")));
  assert(check.blocking.some((x) => x.includes("generic confidence")));
});

test("canonical learner-text receipts distinguish open response, choice gaps, unknown coverage and answer-only gaps", () => {
  const c = context();
  const raw = ctiRaw();
  const a = {
    declaredQuestionCount: 2,
    questions: [
      {
        id: "1",
        type: "text-entry",
        prompt: "Convert two metres into centimetres.",
        options: [],
        optionTextReliable: false,
        answerTextReliable: false,
        correctAnswers: ["PRIVATE_KEY"],
      },
      {
        id: "2",
        type: "single-select",
        prompt: "Which is a length unit?",
        options: [{ label: "Metre" }, { label: "Second" }],
        optionTextReliable: true,
      },
    ],
    captureCompleteness: {
      declared: 2,
      declaredContentParts: 2,
      captured: 2,
      uniqueQuestionIds: 2,
      questionCoverageComplete: true,
      missingQuestionOrdinals: [],
      requiredAnswerCoverageComplete: false,
    },
  };
  raw.fingerprints.push({
    ...raw.fingerprints[0],
    id: "i2",
    name: "Practice",
    typeName: "ungradedAssignment",
    payload: { structuredAssessment: a },
  });
  const metrics = () =>
    c.CourseCtiAdapter.adapt(raw).items[1].assessment_capture;
  assert.equal(metrics().completeness, "learner_text_captured");
  assert.equal(metrics().has_unresolved_capture_issues, false);
  const capture = c.CourseCtiAdapter.adapt(raw);
  assert(!JSON.stringify(capture).includes("PRIVATE_KEY"));
  const s = c.CourseShell.toSession(capture, "capture.json", c.CoursePrep);
  const packet = c.CourseCompact.build(s).packets[0].data;
  assert.equal(
    packet.structure[0].module.lessons[0].items[1].assessment_capture
      .completeness,
    "learner_text_captured",
  );
  assert.equal(packet.coverage_audit[0].learner_text_captured_ids.join(), "i2");
  assert.equal(
    c.ActivityQuality.coverage(s, { branch_id: "b1", module_id: "m1" })
      .incomplete.length,
    0,
  );
  assert.equal(
    c.CoursePrep.validateSession(JSON.parse(JSON.stringify(s))).courses[0]
      .modules[0].lessons[0].items[1].assessment_capture.completeness,
    "learner_text_captured",
  );
  for (const mutate of [
    (a) => {
      a.captureCompleteness.questionCoverageComplete = false;
    },
    (a) => {
      a.questions[1].optionTextReliable = false;
    },
    (a) => {
      a.questions[1].options = [];
    },
    (a) => {
      a.questions[1].options[0].label = "";
    },
    (a) => {
      a.questions[0].prompt = "";
    },
    (a) => {
      a.questions[0].promptTextReliable = false;
    },
    (a) => {
      a.questions[1].optionCaptureIssue = "TRUNCATED";
    },
  ]) {
    const next = structuredClone(a);
    mutate(next);
    raw.fingerprints[1].payload.structuredAssessment = next;
    assert.equal(metrics().has_unresolved_capture_issues, true);
    assert.equal(metrics().completeness, "partial_unverified");
  }
  for (const mutate of [
    (a) => {
      delete a.captureCompleteness;
    },
    (a) => {
      a.captureCompleteness.missingQuestionOrdinals = [2];
    },
    (a) => {
      a.captureCompleteness.uniqueQuestionIds = 1;
    },
    (a) => {
      a.questions[1].id = "1";
    },
    (a) => {
      a.questions[0].type = "unknown";
    },
    (a) => {
      a.captureCompleteness.declaredContentParts = 3;
    },
  ]) {
    const next = structuredClone(a);
    mutate(next);
    raw.fingerprints[1].payload.structuredAssessment = next;
    assert.equal(metrics().completeness, "partial_unverified");
  }
});

test("observed-empty editors keep source-reconciliation holds with exact recovery links, including held AI proposals", () => {
  const c = context(),
    raw = ctiRaw();
  const payload = {
    emptyEditorEvidence: {
      status: "OBSERVED_EMPTY_EDITOR",
      itemId: "i2",
      scope: "EXACT_ITEM_ASSIGNMENT_LAYOUT",
      marker: "Content you add will show in order here.",
      samples: 2,
      intervalMs: 1200,
      observedAt: raw.extractedAt,
      route: "https://www.coursera.org/teach/test/b1/content/item/project/i2",
    },
    captureContract: {
      itemId: "i2",
      status: "UNRESOLVED_SOURCE_REVIEW",
      reasons: ["OBSERVED_EMPTY_EDITOR_REQUIRES_SOURCE_REVIEW"],
    },
  };
  raw.fingerprints.push({
    ...raw.fingerprints[0],
    id: "i2",
    name: "Quiz",
    typeName: "ungradedAssignment",
    payload,
  });
  const capture = c.CourseCtiAdapter.adapt(raw);
  assert.equal(capture.items[1].coverage, "observed_empty");
  assert.equal(c.CourseShell.summary(capture).unread, 0);
  assert.equal(c.CourseShell.summary(capture).observed_empty, 1);
  const s = c.CourseShell.toSession(capture, "capture.json", c.CoursePrep);
  const { r, a } = fixture(c);
  r.title = s.title;
  r.bundle_created_at = s.created_at;
  a.placement.course = s.title;
  for (const status of ["draft", "hold"]) {
    a.status = status;
    const check = c.ActivityReadiness.check(r, s, a);
    assert.equal(check.canCopy, false);
    assert(
      check.blocking.some((x) => x.startsWith("Source reconciliation needed:")),
    );
    assert(!check.blocking.some((x) => x.startsWith("Read existing practice")));
  }
  const cv = c.ActivityQuality.coverage(s, a.placement);
  assert.equal(cv.empty.length, 1);
  assert.equal(cv.unread.length, 0);
  assert.equal(cv.empty[0].link, payload.emptyEditorEvidence.route);
  const p = c.CourseCompact.build(s).packets[0].data;
  assert.equal(p.coverage_audit[0].observed_empty_practice_ids.join(), "i2");
  assert.equal(
    p.gaps.find((x) => x.path === "coursera/b1/i2").capture_state,
    "observed_empty",
  );
  for (const mutate of [
    (p) => {
      p.emptyEditorEvidence.samples = 1;
    },
    (p) => {
      p.emptyEditorEvidence.itemId = "other";
    },
    (p) => {
      p.emptyEditorEvidence.route = p.emptyEditorEvidence.route.replace(
        "/b1/",
        "/b2/",
      );
    },
    (p) => {
      p.captureContract.status = "UNRESOLVED";
    },
    (p) => {
      p.structuredAssessment = { declaredQuestionCount: 1 };
    },
    (p) => {
      p.nativeAssignment = { learnerPrompt: "Explain the calculation." };
    },
  ]) {
    const next = structuredClone(payload);
    mutate(next);
    raw.fingerprints[1].payload = next;
    assert.notEqual(
      c.CourseCtiAdapter.adapt(raw).items[1].coverage,
      "observed_empty",
    );
  }
});

test("unread external resources retain safe exact links without signed URLs or false text claims", () => {
  const c = context(),
    raw = ctiRaw(),
    p = raw.fingerprints[0].payload;
  p.textSample = "";
  p.readingEditorEvidence.frames = [
    {
      url: "https://opentextbc.ca/mathfortrades2/?p=22/#main",
      documentStatus: "NOT_READABLE",
    },
    {
      url: "https://example.test/reading?token=PRIVATE_TOKEN",
      documentStatus: "NOT_READABLE",
    },
  ];
  const capture = c.CourseCtiAdapter.adapt(raw),
    s = c.CourseShell.toSession(capture, "capture.json", c.CoursePrep);
  assert.equal(capture.items[0].coverage, "unread");
  assert.equal(s.sources[0].documents.length, 0);
  const packet = c.CourseCompact.build(s).packets[0].data;
  const refs =
    packet.structure[0].module.lessons[0].items[0].external_resources;
  assert.equal(refs[0].url, p.readingEditorEvidence.frames[0].url);
  assert.equal(refs[1].url, "");
  assert(!JSON.stringify(s).includes("PRIVATE_TOKEN"));
  assert.equal(
    packet.gaps[0].external_resources[0].status,
    "external_body_unread",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://user:pass@example.test/page",
    "http://example.test/page",
    "https://example.test/page?signature=x",
  ])
    assert.equal(c.CourseCtiAdapter.externalUrl(url), "");
});

test("captured ingestion failures cannot certify learner text or clear practice gates", () => {
  const c = context(),
    raw = ctiRaw();
  const payload = {
    captureContract: { status: "INGESTION_FAILURE_CAPTURED", complete: true },
    ingestionFailure: {
      detected: true,
      codes: ["QUESTION_IMAGE_CREATION_ERROR"],
    },
    structuredAssessment: {
      declaredQuestionCount: 2,
      questions: [
        {
          id: "1",
          type: "essay",
          prompt:
            "Calculate the perimeter of the plan and justify each dimension.",
          options: [],
        },
        {
          id: "2",
          type: "essay",
          prompt: "[Error: Image could not be created]",
          options: [],
        },
      ],
      captureCompleteness: {
        declared: 2,
        declaredContentParts: 2,
        captured: 2,
        uniqueQuestionIds: 2,
        questionCoverageComplete: true,
        missingQuestionOrdinals: [],
      },
    },
  };
  raw.fingerprints.push({
    ...raw.fingerprints[0],
    id: "i2",
    name: "Quiz",
    typeName: "ungradedAssignment",
    payload,
  });
  const capture = c.CourseCtiAdapter.adapt(raw),
    s = c.CourseShell.toSession(capture, "capture.json", c.CoursePrep);
  const metric = capture.items[1].assessment_capture;
  assert.equal(metric.prompts_captured, 1);
  assert.equal(metric.declared_questions, 2);
  assert.equal(metric.completeness, "ingestion_failure");
  assert.equal(
    capture.items[1].blocks.find((b) => b.text.includes("[Error:")).kind,
    "gap",
  );
  assert.equal(
    s.courses[0].modules[0].lessons[0].items[1].assessment_capture
      .has_ingestion_failure,
    true,
  );
  const cv = c.ActivityQuality.coverage(s, {
    branch_id: "b1",
    module_id: "m1",
  });
  assert.equal(cv.failed.length, 1);
  assert.equal(cv.incomplete.length, 0);
  const { r, a } = fixture(c);
  r.title = s.title;
  r.bundle_created_at = s.created_at;
  a.placement.course = s.title;
  for (const status of ["draft", "hold"]) {
    a.status = status;
    const check = c.ActivityReadiness.check(r, s, a);
    assert.equal(check.canCopy, false);
    assert(
      check.blocking.some((x) =>
        x.startsWith("Repair captured ingestion errors:"),
      ),
    );
  }
  const p = c.CourseCompact.build(s).packets[0];
  assert.equal(p.data.coverage_audit[0].ingestion_failure_ids.join(), "i2");
  assert.equal(p.data.coverage_audit[0].learner_text_captured_ids.length, 0);
  assert.equal(
    c.CoursePrep.validateSession(JSON.parse(JSON.stringify(s))).courses[0]
      .modules[0].lessons[0].items[1].assessment_capture.completeness,
    "ingestion_failure",
  );
  payload.structuredAssessment.questions.push({
    id: "3",
    type: "essay",
    prompt: "[Error: Image could not be created]",
    options: [],
  });
  assert.equal(
    c.CourseCtiAdapter.adapt(raw).items[1].blocks.filter(
      (b) => b.kind === "gap",
    ).length,
    2,
  );
  payload.structuredAssessment.questions.pop();
  delete payload.ingestionFailure;
  delete payload.captureContract;
  assert.equal(
    c.CourseCtiAdapter.adapt(raw).items[1].assessment_capture
      .has_ingestion_failure,
    true,
  );
  payload.structuredAssessment.questions[1].prompt =
    "Explain why the selected dimensions describe the perimeter.";
  payload.ingestionFailure = { detected: true };
  assert.equal(
    c.CourseCtiAdapter.adapt(raw).items[1].assessment_capture.completeness,
    "ingestion_failure",
  );
});
