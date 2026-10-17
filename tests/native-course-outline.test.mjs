import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as outline from "../src/domain/native-course-outline.ts";

const courseId = "native_course_123";
const courseUrl = `https://www.coursera.org/teach/native-course/${courseId}/content/edit`;
function fixture() {
  const node = (
    id,
    title,
    kind,
    ancestorIds,
    emptyContainer,
    sourceContentType = "",
  ) => ({ id, title, kind, ancestorIds, emptyContainer, sourceContentType });
  return {
    kind: "VERIFIED_NATIVE_CAPTURE_INVENTORY",
    courseId,
    materialHash: "a".repeat(64),
    contentItemCount: 3,
    inventoryEntryCount: 5,
    moduleCount: 3,
    lessonCount: 2,
    emptyContainerCount: 2,
    nativeHierarchy: [
      node("module_a", "Learning Objectives", "module", [], false),
      node("lesson_a", "Explore", "lesson", ["module_a"], true),
      node("lesson_b", "Explore", "lesson", ["module_a"], false),
      node(
        "reading_a",
        "Current <reading> title",
        "item",
        ["module_a", "lesson_b"],
        false,
        "supplement",
      ),
      node("module_b", "Archive", "module", [], true),
      node("module_c", "Learning Objectives", "module", [], false),
      node(
        "reading_b",
        "Current <reading> title",
        "item",
        ["module_c"],
        false,
        "supplement",
      ),
      node(
        "future_item",
        "Native future type",
        "item",
        ["module_c"],
        false,
        "futureWidget",
      ),
    ],
    independentWorkbook: false,
    completeContent: false,
  };
}
function result(evidence = fixture()) {
  return {
    stats: { extractorMeta: { page: { url: courseUrl } } },
    nativeCourseOutlineEvidence: evidence,
  };
}

test("text report keeps the full captured outline, exact identities and structural scope", () => {
  const text = outline.nativeCourseOutlineText(result());
  assert.match(
    text,
    /3 modules; 2 lessons; 3 content items; 2 zero-child containers; 5 native inventory entries/,
  );
  assert.match(text, /LESSON \[lesson_a\] Explore \[observed zero children\]/);
  assert.match(text, /MODULE \[module_b\] Archive \[observed zero children\]/);
  assert.match(text, /ITEM \[reading_a\] Current <reading> title/);
  assert.match(text, /ITEM \[reading_b\] Current <reading> title/);
  assert.match(text, /native type: futureWidget/);
  assert.match(text, /zero-child container is not an empty content body/);
  assert.equal(outline.nativeCourseOutlineText({}), "");
  assert.throws(
    () =>
      outline.nativeCourseOutlineText(
        result({ ...fixture(), emptyContainerCount: 0 }),
      ),
    /counts contradict/,
  );
});

test("native shell hierarchy retains current titles, native IDs, repeated names and exact empty structures", () => {
  const evidence = fixture(),
    original = structuredClone(evidence);
  const valid = outline.validateNativeCourseOutlineEvidence(evidence, courseId);
  assert.deepEqual(valid, original);
  assert.deepEqual(
    evidence,
    original,
    "display validation does not alter retained evidence",
  );
  assert.deepEqual(
    valid.nativeHierarchy.map((node) => node.id),
    [
      "module_a",
      "lesson_a",
      "lesson_b",
      "reading_a",
      "module_b",
      "module_c",
      "reading_b",
      "future_item",
    ],
  );
  assert.equal(
    valid.nativeHierarchy.filter((node) => node.title === "Explore").length,
    2,
  );
  assert.deepEqual(
    valid.nativeHierarchy
      .filter((node) => node.emptyContainer)
      .map((node) => node.id),
    ["lesson_a", "module_b"],
  );
  assert.equal(valid.completeContent, false);
  assert.equal(valid.independentWorkbook, false);
});

test("outline validation rejects reopened subtrees, missing parents, item parents and duplicate native IDs", () => {
  const mutations = [
    (evidence) => {
      evidence.nativeHierarchy.push({
        ...evidence.nativeHierarchy[3],
        id: "reopened_reading",
      });
    },
    (evidence) => {
      evidence.nativeHierarchy[3].ancestorIds = ["module_a", "missing_lesson"];
    },
    (evidence) => {
      evidence.nativeHierarchy[4].ancestorIds = [
        "module_a",
        "lesson_b",
        "reading_a",
      ];
    },
    (evidence) => {
      evidence.nativeHierarchy[6].id = "reading_a";
    },
    (evidence) => {
      evidence.nativeHierarchy[3].ancestorIds = ["lesson_b"];
    },
    (evidence) => {
      evidence.nativeHierarchy[1].kind = "module";
    },
    (evidence) => {
      evidence.nativeHierarchy[0].kind = "lesson";
    },
  ];
  for (const mutate of mutations) {
    const evidence = fixture();
    mutate(evidence);
    assert.throws(
      () => outline.validateNativeCourseOutlineEvidence(evidence),
      /invalid captured native outline/i,
    );
  }
});

test("zero child structures must agree with the complete retained hierarchy, not empty content assumptions", () => {
  for (const mutate of [
    (evidence) => {
      evidence.nativeHierarchy[0].emptyContainer = true;
    },
    (evidence) => {
      evidence.nativeHierarchy[1].emptyContainer = false;
    },
    (evidence) => {
      evidence.nativeHierarchy[3].emptyContainer = true;
    },
    (evidence) => {
      evidence.nativeHierarchy[1].sourceContentType = "supplement";
    },
    (evidence) => {
      evidence.nativeHierarchy[3].sourceContentType = "";
    },
  ]) {
    const evidence = fixture();
    mutate(evidence);
    assert.throws(
      () => outline.validateNativeCourseOutlineEvidence(evidence),
      /empty|container|content/i,
    );
  }
  for (const key of [
    "contentItemCount",
    "inventoryEntryCount",
    "moduleCount",
    "lessonCount",
    "emptyContainerCount",
  ]) {
    const evidence = fixture();
    evidence[key]++;
    assert.throws(
      () => outline.validateNativeCourseOutlineEvidence(evidence),
      /count/i,
    );
  }
});

test("saved outlines reject malformed identity, unbounded values and a forged content-completion scope", () => {
  const mutations = [
    (evidence) => {
      evidence.materialHash = "not-a-material-hash";
    },
    (evidence) => {
      evidence.courseId = "wrong/id";
    },
    (evidence) => {
      evidence.kind = "INFERRED_FROM_FINDINGS";
    },
    (evidence) => {
      evidence.completeContent = true;
    },
    (evidence) => {
      evidence.independentWorkbook = true;
    },
    (evidence) => {
      evidence.inventoryEntryCount = 20001;
    },
    (evidence) => {
      evidence.contentItemCount = 1.5;
    },
    (evidence) => {
      evidence.moduleCount = -1;
    },
    (evidence) => {
      evidence.nativeHierarchy[0].id = "../unsafe";
    },
    (evidence) => {
      evidence.nativeHierarchy[0].title = " ";
    },
    (evidence) => {
      evidence.nativeHierarchy[0].title = "x".repeat(20001);
    },
    (evidence) => {
      evidence.nativeHierarchy[3].ancestorIds = Array(33).fill("module_a");
    },
    (evidence) => {
      evidence.nativeHierarchy[3].sourceContentType = "x".repeat(513);
    },
    (evidence) => {
      evidence.nativeHierarchy = Array(50001).fill(evidence.nativeHierarchy[0]);
    },
  ];
  for (const mutate of mutations) {
    const evidence = fixture();
    mutate(evidence);
    assert.throws(
      () => outline.validateNativeCourseOutlineEvidence(evidence),
      /invalid captured native outline/i,
    );
  }
});

test("a present outline binds to the recorded Coursera course or supplied older-report location", () => {
  assert.equal(
    outline.nativeCourseOutlineEvidence(result()).courseId,
    courseId,
  );
  const wrong = result();
  wrong.nativeCourseOutlineEvidence.courseId = "other_course_123";
  assert.throws(
    () => outline.nativeCourseOutlineEvidence(wrong),
    /different Coursera course/,
  );
  const olderLocation = { nativeCourseOutlineEvidence: fixture() };
  assert.equal(
    outline.nativeCourseOutlineEvidence(olderLocation, courseUrl).courseId,
    courseId,
  );
  assert.throws(
    () =>
      outline.nativeCourseOutlineEvidence(
        olderLocation,
        courseUrl.replace(courseId, "wrong_course_123"),
      ),
    /different Coursera course/,
  );
  assert.equal(
    outline.nativeCourseOutlineEvidence(olderLocation).courseId,
    courseId,
    "unknown location does not invent a conflicting course binding",
  );
});

test("old reports stay quiet without manufacturing a shell hierarchy from findings or workbook scope", () => {
  assert.equal(outline.nativeCourseOutlineEvidence({}), null);
  assert.equal(
    outline.nativeCourseOutlineEvidence({
      structuralInventoryBasis: fixture(),
      ownerView: { items: [{ id: "module_a" }] },
    }),
    null,
  );
  assert.throws(
    () =>
      outline.nativeCourseOutlineEvidence({
        nativeCourseOutlineEvidence: null,
      }),
    /invalid/i,
  );
  const empty = fixture();
  for (const key of [
    "contentItemCount",
    "inventoryEntryCount",
    "moduleCount",
    "lessonCount",
    "emptyContainerCount",
  ])
    empty[key] = 0;
  empty.nativeHierarchy = [];
  assert.deepEqual(
    outline.validateNativeCourseOutlineEvidence(empty).nativeHierarchy,
    [],
  );
});

test("native type and exact ID enable only established item routes; future types and containers stay unlinked", () => {
  const evidence = fixture(),
    report = result(evidence);
  const [module, , , reading, , , copy, future] = evidence.nativeHierarchy;
  assert.equal(
    outline.nativeOutlineItemUrl(report, reading),
    `${courseUrl.replace(/\/edit$/, "")}/item/supplement/reading_a`,
  );
  assert.equal(
    outline.nativeOutlineItemUrl(report, copy),
    `${courseUrl.replace(/\/edit$/, "")}/item/supplement/reading_b`,
  );
  assert.equal(outline.nativeOutlineItemUrl(report, module), "");
  report.stats.extractorMeta.activeSpaCrawl = {
    targetDiagnostics: [
      {
        id: future.id,
        route: `${courseUrl.replace(/\/edit$/, "")}/item/plugin/${future.id}`,
      },
    ],
  };
  assert.equal(
    outline.nativeOutlineItemUrl(report, future),
    "",
    "an unsupported native kind is not guessed from a diagnostic route",
  );
  assert.equal(outline.nativeOutlineItemUrl({}, reading), "");
  assert.equal(
    outline.nativeOutlineItemUrl({}, reading, courseUrl),
    `${courseUrl.replace(/\/edit$/, "")}/item/supplement/reading_a`,
  );
});

// Render the maintained TSX with React and the real domain boundary. This
// verifies the evidence shown to owners without opening a live LMS or browser.
const require = createRequire(import.meta.url);
const source = fs.readFileSync(
  new URL("../web/NativeCourseOutline.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  fileName: "NativeCourseOutline.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
const componentModule = { exports: {} };
const loadComponent = new vm.Script(
  "(function(require, module, exports) {" + compiled + "\n})",
).runInNewContext({ URL });
loadComponent(
  (name) => {
    if (name === "../src/domain/native-course-outline") return outline;
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw Error("Unexpected outline component dependency: " + name);
  },
  componentModule,
  componentModule.exports,
);
const NativeCourseOutline = componentModule.exports.default;
const render = (report, courseUrl = "") =>
  renderToStaticMarkup(
    React.createElement(NativeCourseOutline, { result: report, courseUrl }),
  );

test("owner shell disclosure shows literal source titles, empty lesson and archive identities without raising tasks", () => {
  const html = render(result());
  assert.match(html, /Captured Coursera shell outline/);
  assert.match(
    html,
    /3 modules · 2 lessons · 3 content items · 2 containers with 0 child entries/,
  );
  assert.match(html, /data-native-id="lesson_a" data-native-kind="lesson"/);
  assert.match(html, /data-native-id="module_b" data-native-kind="module"/);
  assert.equal((html.match(/0 child entries observed/g) || []).length, 2);
  assert.equal((html.match(/Current &lt;reading&gt; title/g) || []).length, 2);
  assert(!html.includes("<reading>"));
  assert.match(html, /native type: <code>futureWidget<\/code>/);
  assert.match(html, /Native ID: <code>reading_a<\/code>/);
  assert.match(html, /Native ID: <code>reading_b<\/code>/);
  assert(!html.includes("/item/plugin/future_item"));
  assert.match(
    html,
    /does not establish complete item content, media or live playback/,
  );
  assert.match(
    html,
    /does not add owner tasks or change the comparison verdict/,
  );
  assert(!html.includes("Mark checked"));
});

test("invalid explicit outline is visibly rejected while missing historical proof stays quiet", () => {
  const wrong = result();
  wrong.nativeCourseOutlineEvidence.nativeHierarchy[1].emptyContainer = false;
  const html = render(wrong);
  assert.match(html, /role="alert" data-testid="native-course-outline-error"/);
  assert.match(html, /could not be shown/);
  assert(!html.includes('data-native-id="lesson_a"'));
  assert.equal(render({ structuralInventoryBasis: fixture() }), "");
  const crossCourse = result();
  crossCourse.nativeCourseOutlineEvidence.courseId = "wrong_course_123";
  assert.match(render(crossCourse), /different Coursera course/);
});
