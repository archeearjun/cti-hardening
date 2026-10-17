import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildContentSnapshot,
  capturedContent,
  contentEvidenceText,
  validateContentSnapshot,
} from "../src/domain/content-evidence.ts";
import { prepareOwnerReportExport } from "../src/domain/owner-report-export.ts";
import { newRecord } from "../src/domain/workspace-store.ts";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { observeDirectNativeGrading } from "../src/engine/assessment/native-grading.js";
import { directTextFixture } from "./coursera-direct-content-fixtures.mjs";

function gradingFixture(graded = true, observed = true) {
  const base = directTextFixture(),
    sources = base.payload.directDataSources,
    atom = sources.atom.elements[0];
  atom.draft.content = {
    typeName: "staffGradedDraft",
    definition: { configuration: { isGraded: graded }, parts: [] },
  };
  const draftHash = createHash("sha256")
    .update(directCanonicalSourceTextV1(atom.draft))
    .digest("hex");
  sources.receipts.stability.draftHash = draftHash;
  sources.receipts.stability.atom.elements = [structuredClone(atom)];
  if (observed) sources.receipts.atom.observedAt = "2026-10-17T12:00:00.000Z";
  const item = {
    id: base.itemId,
    atomId: atom.id,
    contentId: atom.contentId,
    type: "GradedAssignment",
    name: "Graded title alone does not define the native setting",
    payload: {
      directDataSources: sources,
      directDataEvidence: {
        method: "BOUND_AUTHORING_DRAFT_API",
        courseId: base.payload.directDataEvidence.courseId,
        itemId: base.itemId,
        atomId: atom.id,
        contentId: atom.contentId,
        sourceState: "AUTHORING_DRAFT",
        stableSource: true,
        draftHash,
        storedAtomVersion: atom.storedAtomVersion,
        updatedAt: atom.metadata.updatedAt,
      },
    },
  };
  const capture = {
    extractedAt: "2026-10-17T13:00:00.000Z",
    page: {
      url: "https://www.coursera.org/teach/fixture-course/Direct_content_course_123/content/edit",
      courseId: item.payload.directDataEvidence.courseId,
    },
    fingerprints: [item],
  };
  return { item, capture, draftHash };
}

test("content snapshots expose only the independently rebound native grading boolean without completing the assessment", () => {
  for (const graded of [true, false]) {
    const f = gradingFixture(graded),
      before = structuredClone(f.capture),
      observation = observeDirectNativeGrading(f.item, f.capture.page.courseId),
      snapshot = buildContentSnapshot(undefined, undefined, f.capture),
      content = snapshot.coursera[0].content;
    assert(observation);
    assert.deepEqual(content.nativeGrading, observation);
    assert.equal(content.nativeGrading.graded, graded);
    assert.equal(content.nativeGrading.scope, "GRADING_SETTING_ONLY");
    assert.equal(content.nativeGrading.observedAt, "2026-10-17T12:00:00.000Z");
    assert.equal(content.nativeGrading.updatedAt, 123);
    assert.equal(content.questionCoverage, "UNVERIFIED");
    assert.equal(content.textCoverage, "UNVERIFIED");
    assert.equal(content.questions.length, 0);
    assert.equal(content.expectedQuestions, null);
    validateContentSnapshot(snapshot);
    assert.deepEqual(f.capture, before);
    const text = contentEvidenceText(content);
    assert(
      text.includes(
        `Captured grading setting: ${graded ? "Graded" : "Not graded"}`,
      ),
    );
    assert(text.includes("draft.content.definition.configuration.isGraded"));
    assert(text.includes(f.draftHash));
    assert(text.includes("GRADING_SETTING_ONLY"));
    assert(text.includes("Passing score, attempts"));
    assert.equal(
      capturedContent(f.item.payload, { basis: "Generic payload" })
        .nativeGrading,
      undefined,
      "Generic payload text projection does not invent an exact-item native binding",
    );
  }
});

test("missing observation times stay unknown and titles or unbound, changed and contradictory drafts cannot supply grading settings", () => {
  const untimed = gradingFixture(false, false),
    content = buildContentSnapshot(undefined, undefined, untimed.capture)
      .coursera[0].content;
  assert.equal(content.nativeGrading.observedAt, undefined);
  assert.match(contentEvidenceText(content), /Grading observation: unrecorded/);
  for (const mutate of [
    (item) => {
      delete item.payload.directDataSources;
    },
    (item) => {
      item.id = "different-item";
    },
    (item) => {
      item.payload.directDataEvidence.draftHash = "f".repeat(64);
    },
    (item) => {
      item.payload.directDataSources.atom.elements[0].draft.content.definition.configuration.isGraded = false;
    },
    (item) => {
      item.payload.structuredAssessment = {
        configuration: { isGraded: false },
      };
    },
    (item) => {
      delete item.payload.directDataSources.atom.elements[0].draft.content
        .definition.configuration.isGraded;
    },
  ]) {
    const f = gradingFixture();
    mutate(f.item);
    const snapshot = buildContentSnapshot(undefined, undefined, f.capture);
    assert.equal(snapshot.coursera[0].content.nativeGrading, undefined);
  }
  const legacy = buildContentSnapshot(undefined, undefined, {
    fingerprints: [
      {
        id: "title-only",
        type: "GradedAssignment",
        name: "Graded quiz",
        payload: {},
      },
    ],
  });
  assert.equal(legacy.coursera[0].content.nativeGrading, undefined);
});

test("an internally bound grading draft needs the same enclosing capture course and cannot supply its own expected course", () => {
  for (const courseId of [undefined, "Foreign_course_123", ""]) {
    const f = gradingFixture();
    if (courseId === undefined) delete f.capture.page.courseId;
    else f.capture.page.courseId = courseId;
    assert.equal(
      buildContentSnapshot(undefined, undefined, f.capture).coursera[0].content
        .nativeGrading,
      undefined,
    );
  }
});

test("saved native grading projections reject widened claims, malformed identity, times and cross-item or source attribution", () => {
  for (const mutate of [
    (setting) => {
      setting.graded = "false";
    },
    (setting) => {
      setting.scope = "WHOLE_ASSESSMENT";
    },
    (setting) => {
      setting.wholeAssessmentVerified = true;
    },
    (setting) => {
      setting.itemId = "different-item";
    },
    (setting) => {
      setting.courseId = "bad/course";
    },
    (setting) => {
      setting.atomId = "bad";
    },
    (setting) => {
      setting.contentId = "atom~" + "z".repeat(22);
    },
    (setting) => {
      setting.draftHash = "f".repeat(63);
    },
    (setting) => {
      setting.storedAtomVersion = -1;
    },
    (setting) => {
      setting.updatedAt = "2026-10-17T12:00:00.000Z";
    },
    (setting) => {
      setting.observedAt = "not a date";
    },
    (setting) => {
      setting.observedAt = "2026-10-17T12:00:00Z";
    },
  ]) {
    const snapshot = buildContentSnapshot(
      undefined,
      undefined,
      gradingFixture().capture,
    );
    mutate(snapshot.coursera[0].content.nativeGrading);
    assert.throws(() => validateContentSnapshot(snapshot), /native grading/);
  }
  const source = buildContentSnapshot(
    undefined,
    undefined,
    gradingFixture().capture,
  );
  source.brightspace = source.coursera;
  source.coursera = [];
  assert.throws(
    () => validateContentSnapshot(source),
    /different item or platform/,
  );
});

test("owner text and JSON exports preserve the captured setting separately from unchanged original report findings", async () => {
  const f = gradingFixture(false),
    snapshot = buildContentSnapshot(undefined, undefined, f.capture),
    course = newRecord("package", "Synthetic course", {}),
    report = {
      packageId: course.id,
      report: "Original findings remain unresolved.",
      contentEvidence: snapshot,
      result: {
        ownerView: {
          items: [
            {
              id: f.item.id,
              name: f.item.name,
              status: "EVIDENCE_NEEDED",
              actions: [],
            },
          ],
        },
      },
    },
    before = structuredClone(report),
    exported = await prepareOwnerReportExport(report, "audit-a", course, {
      list: async () => [],
      get: async () => {
        throw Error("No follow-ups expected");
      },
    });
  const setting =
    exported.followUp.contentComparisons[0].view.coursera.nativeGrading;
  assert.deepEqual(setting, snapshot.coursera[0].content.nativeGrading);
  assert.equal(setting.graded, false);
  assert.match(exported.text, /Captured grading setting: Not graded/);
  assert.match(exported.text, /Passing score, attempts/);
  assert.equal(exported.followUp.automatedResolution, false);
  assert.deepEqual(exported.evidence.contentEvidence, before.contentEvidence);
  assert.deepEqual(report, before);
  assert(exported.text.endsWith(before.report));
});
