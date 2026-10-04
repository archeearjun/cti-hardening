import test from "node:test";
import assert from "node:assert/strict";
import {
  capturedContent,
  buildContentSnapshot,
} from "../src/domain/content-evidence.ts";
import {
  courseraLinkedTargets,
  courseraPageKey,
  bindCourseraLinkedCapture,
  validateCourseraLinkedCaptures,
} from "../src/domain/coursera-linked-content.ts";
import {
  itemContentView,
  itemContentText,
} from "../src/domain/owner-content.ts";
import { fetchSourceQuestions } from "../server/source-questions.ts";
import { validateOwnerReview } from "../src/domain/owner-actions.ts";
import { validateRecord } from "../src/domain/workspace-validation.ts";
import { newRecord } from "../src/domain/workspace-store.ts";

const url = "https://opentextbc.ca/mathfortrades2/?p=179";
const task = {
  id: "area",
  key: "item:area",
  sourceOnly: false,
  sources: [],
  sourceTargets: [],
  pluginTargets: [],
  excerpt: "",
  url: "",
};
const payload = {
  textSample: "",
  textLength: 0,
  textCaptureEvidence: {
    method: "EXACT_READING_FIELD",
    itemId: "area",
    observedCharacters: 0,
    capturedCharacters: 0,
    truncated: false,
  },
  readingEditorEvidence: {
    frames: [{ url: url + "/#main", documentStatus: "NOT_READABLE" }],
    unreadFrameCount: 1,
  },
};
const snapshot = () =>
  buildContentSnapshot(
    new TextEncoder().encode(
      JSON.stringify({ fingerprints: [{ id: "area", payload }] }),
    ),
  );
const fetched = () =>
  fetchSourceQuestions(
    courseraPageKey("area", url),
    url,
    async () =>
      new Response("<main>Area of a square = side × side.</main>", {
        headers: { "Content-Type": "text/html" },
      }),
  );

test("empty text fields retain unread embedded URLs and do not establish empty lessons", () => {
  const evidence = capturedContent(payload, {
    basis: "Coursera",
    itemId: "area",
  });
  assert.equal(evidence.textCoverage, "EMPTY"); // Only the observed editor text field.
  assert.match(evidence.textReason, /lesson is not confirmed empty/);
  assert.match(
    evidence.limitations.join(),
    /could not be read inside Coursera/,
  );
  assert.deepEqual(courseraLinkedTargets(task, snapshot()), [url]);
});

test("destination links come only from recorded Coursera evidence; an observed newer item supersedes old references", () => {
  assert.deepEqual(
    courseraLinkedTargets({
      ...task,
      sourceTargets: [{ sourceUrls: [url] }],
      sources: [{ sourcePayload: { links: [url] } }],
    }),
    [],
  );
  assert.deepEqual(
    courseraLinkedTargets({
      ...task,
      pluginTargets: [url, url + "/#main", "https://127.0.0.1/private"],
    }),
    [url],
  );
  assert.deepEqual(
    courseraLinkedTargets(task, snapshot(), {
      editorObserved: true,
      payload: { links: [] },
    }),
    [],
  );
  assert.deepEqual(
    courseraLinkedTargets(task, snapshot(), {
      editorObserved: false,
      payload: { links: [] },
    }),
    [url],
  );
  assert.deepEqual(
    courseraLinkedTargets({ ...task, sourceOnly: true }, snapshot()),
    [],
  );
  const duplicate = snapshot();
  duplicate.coursera.push(duplicate.coursera[0]);
  assert.deepEqual(courseraLinkedTargets(task, duplicate), []);
});

test("public content remains separate from native content and counts, while old observations survive changed links", async () => {
  const response = await fetched(),
    before = snapshot(),
    bound = bindCourseraLinkedCapture("area", [url], response);
  const view = itemContentView(task, before, {}, undefined, [], [], [bound]);
  assert.equal(view.linkedCoursera[0].text, "Area of a square = side × side.");
  assert.equal(view.linkedCoursera[0].textCoverage, "PARTIAL");
  assert.match(
    view.linkedCoursera[0].limitations.join(),
    /does not verify loading inside Coursera/,
  );
  assert.equal(view.coursera.questions.length, 0);
  assert.equal(view.coursera.expectedQuestions, null);
  assert.equal(view.coursera.text, "");
  assert.match(itemContentText("Area", view), /Fetched Coursera linked page/);
  assert.deepEqual(before, snapshot());
  const stale = itemContentView(
    task,
    before,
    {},
    { editorObserved: true, payload: { links: [] } },
    [],
    [],
    [bound],
  );
  assert.equal(stale.linkedCoursera.length, 0);
  assert.equal(stale.previousLinkedCoursera.length, 1);
  assert.match(
    stale.previousLinkedCoursera[0].limitations.join(),
    /absent from the current captured references/,
  );
  assert.throws(
    () => bindCourseraLinkedCapture("area", [], response),
    /not recorded/,
  );
  assert.throws(
    () => bindCourseraLinkedCapture("another", [url], response),
    /identity/,
  );
  assert.throws(
    () => validateCourseraLinkedCaptures([bound, bound]),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateCourseraLinkedCaptures([
        { ...bound, courseLaunchVerified: true },
      ]),
    /identify/,
  );
  assert.throws(
    () =>
      itemContentView(
        { ...task, id: "other" },
        before,
        {},
        undefined,
        [],
        [],
        [bound],
      ),
    /identify/,
  );
  const review = {
    status: "open",
    note: "",
    updatedAt: "2026-10-04T00:00:00Z",
    updatedBy: "test",
    courseraLinkedCaptures: [bound],
  };
  validateOwnerReview(review);
  const record = newRecord(
    "item-review",
    "Area",
    { auditId: "audit", itemKey: "item:area", review },
    "course",
  );
  validateRecord(record);
  assert.throws(
    () =>
      validateRecord({
        ...record,
        data: { ...record.data, itemKey: "item:other" },
      }),
    /different item/,
  );
});
