import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { captureStructureWorkbook } from "../src/domain/capture-structure.ts";
import { readWorkbook } from "../src/adapters/workbook.ts";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { comparisonFixture, encode } from "./workflow-fixtures.mjs";
import { normalizeCourseraItem_ } from "../src/engine/capture/normalization.js";
import { qaMergeCourseraPayload_ } from "../src/engine/capture/recovery.js";
import { qaTextComparison_ } from "../src/engine/matching/payload.js";
import { retainedNativeCoachEvidence } from "../src/engine/capture/coach.js";
import { qaCourseraExcelItemTypes_ } from "../src/engine/provenance/current-state.js";
import { qaApplyIncompleteTraversalGap_ } from "../src/engine/capture/evidence-limitations.js";
const fixture = JSON.parse(
  fs.readFileSync(
    new URL(
      "./fixtures/coursera/trde120-native-coach-inventory.json",
      import.meta.url,
    ),
  ),
);
const courseId = fixture.page.courseId;
const coach = () =>
  structuredClone(fixture.fingerprints.find((f) => f.id === "v4SeI"));

test("observed TRDE120 native inventory projects all 96 items including both Coaches without XLSX", () => {
  const before = JSON.stringify(fixture),
    workbook = captureStructureWorkbook(fixture);
  const rows = readWorkbook(workbook.bytes, workbook.name).sheets.Inventory
    .values;
  assert.equal(workbook.proof.contentItemCount, 96);
  assert.equal(workbook.proof.completeContent, false);
  assert.deepEqual(
    rows.filter((r) => r[0] === "Coach").map((r) => r[7]),
    ["v4SeI", "4u4Kk"],
  );
  const node = workbook.proof.nativeHierarchy.find((n) => n.id === "v4SeI");
  assert.deepEqual(node.ancestorIds, ["OEmBn", "cTF9Q"]);
  assert.equal(node.sourceContentType, "coach");
  assert.equal(JSON.stringify(fixture), before);
});

test("no-XLSX comparison retains present unverified Coaches and exact Role Play versus Dialogue observations", () => {
  const input = comparisonFixture();
  delete input.excel;
  input.json = {
    name: "TRDE120-native-inventory-Coach-subset.json",
    bytes: encode(fixture),
  };
  const output = createWorkflows(workerXml).compare(input);
  assert.equal(output.result.success, true);
  assert.equal(output.result.structuralInventoryBasis.contentItemCount, 96);
  assert.equal(
    output.result.inputCoherence.status,
    "VERIFIED_CAPTURE_INVENTORY",
  );
  const coaches = output.result.injected.filter((i) => i.type === "Coach");
  assert.equal(coaches.length, 2);
  assert(
    coaches.every(
      (i) =>
        i.classification === "PRESENT_UNVERIFIED" &&
        i.evidenceAvailability.reasons.includes(
          "DIRECT_AUTHORING_ATOM_STATE_UNSUPPORTED",
        ),
    ),
  );
  assert.deepEqual(
    coaches.map((i) => i.nativeCoachEvidence.publishedDisplayType),
    ["Role Play", "Dialogue"],
  );
  assert.equal(coaches[0].nativeCoachEvidence.draftSchemaId, "rolePlay@1");
  assert.equal(coaches[0].nativeCoachEvidence.atomId, "K5Y4fcF3EfGSsRL_ziS-2w");
  assert.equal(
    coaches[0].nativeCoachEvidence.published.content.definition.coachActivityId,
    "AvsYOhW5S9C7GDoVuZvQpA@2",
  );
  assert.equal(
    coaches[1].nativeCoachEvidence.published.content.definition.coachActivityId,
    "5MxEwU_ZR82MRMFP2ffN3Q@1",
  );
  assert.equal(coaches[1].nativeCoachEvidence.draft, undefined);
  assert.equal(coaches[1].nativeCoachEvidence.draftFieldPresent, false);
  assert.equal(coaches[1].nativeCoachEvidence.draftSchemaId, null);
  assert(
    coaches.every(
      (i) =>
        i.nativeCoachEvidence.completeContent === false &&
        i.nativeCoachEvidence.publishedBodyVerified === false,
    ),
  );
  assert(
    output.result.ownerView.items.some(
      (i) => i.id === "v4SeI" && i.type === "Coach",
    ),
  );
});

test("exact draft configuration, empty values, stored state and observation timestamps survive normalization and ID-bound enrichment", () => {
  const original = coach(),
    before = JSON.stringify(original),
    atom = original.payload.directDataSources.atom.elements[0];
  const n = normalizeCourseraItem_(original, courseId),
    merged = qaMergeCourseraPayload_({ id: original.id, type: "Coach" }, n);
  assert.equal(n.type, "Coach");
  assert.equal(
    JSON.stringify(n.nativeCoachEvidence.draft),
    JSON.stringify(atom.draft),
  );
  assert.equal(
    JSON.stringify(n.nativeCoachEvidence.published),
    JSON.stringify(atom.published),
  );
  assert.deepEqual(n.nativeCoachEvidence.status, atom.status);
  assert.deepEqual(
    n.nativeCoachEvidence.draft.content.definition.coachActivity
      .allowedCommunicationModes,
    [],
  );
  assert.equal(n.nativeCoachEvidence.storedAtomVersion, 2);
  assert.equal(
    n.nativeCoachEvidence.observedAt,
    original.payload.directDataSources.receipts.atom.observedAt,
  );
  assert.equal(
    JSON.stringify(merged.nativeCoachEvidence),
    JSON.stringify(n.nativeCoachEvidence),
  );
  assert.equal(
    qaMergeCourseraPayload_({ id: "different", type: "Coach" }, n)
      .nativeCoachEvidence,
    undefined,
  );
  assert.equal(JSON.stringify(original), before);
});

test("foreign course, item, atom or failed receipt cannot acquire a retained-ID binding", () => {
  for (const change of [
    (f) => (f.id = "foreign"),
    (f) => (f.atomId = "foreign"),
    (f) => (f.contentId = "foreign"),
    (f) =>
      (f.payload.directDataSources.relation.elements[0].branchRelationMap[
        courseId + "~v4SeI"
      ].courseId = "foreign"),
    (f) => (f.payload.directDataSources.receipts.atom.status = 403),
  ]) {
    const f = coach();
    change(f);
    assert.equal(retainedNativeCoachEvidence(f, courseId), null);
  }
  assert.equal(retainedNativeCoachEvidence(coach(), "foreign"), null);
});

test("Coach configuration never certifies full content, even with a forged complete flag or equal text hash", () => {
  const f = coach();
  f.payload.captureContract.complete = true;
  f.payload.textSample = "same";
  f.payload.textSha256 = "a".repeat(64);
  const n = normalizeCourseraItem_(f, courseId);
  assert.equal(
    n.directCaptureLimitation.reasonCode,
    "COACH_CONTENT_VERIFICATION_UNSUPPORTED",
  );
  assert.equal(
    qaTextComparison_(
      { type: "Coach", textSample: "same", textSha256: "a".repeat(64) },
      n,
    ).status,
    "UNVERIFIED",
  );
  const missing = { verdict: "MISSING", checks: {}, issues: ["MISSING_ITEM"] };
  qaApplyIncompleteTraversalGap_(missing, { complete: true }, null, [n]);
  assert.equal(missing.verdict, "UNVERIFIED");
  delete f.payload.captureContract;
  assert(normalizeCourseraItem_(f, courseId).directCaptureLimitation);
});

test("Coach projection excludes editing credentials without mutating source observations", () => {
  const f = coach(),
    activity =
      f.payload.directDataSources.atom.elements[0].draft.content.definition
        .coachActivity;
  activity.writeAccessToken = "synthetic-private";
  activity.clientSecret = "synthetic-private";
  const p = retainedNativeCoachEvidence(f, courseId);
  assert(!JSON.stringify(p).includes("synthetic-private"));
  assert.equal(p.privacy.removedFields, 2);
  assert.equal(activity.writeAccessToken, "synthetic-private");
});

test("accepted structural kinds include Coach beside independent Reading, assessment, discussion and LTI rows", () => {
  const types = qaCourseraExcelItemTypes_();
  for (const t of [
    "coach",
    "role play",
    "dialogue",
    "reading",
    "assignment",
    "quiz",
    "discussion prompt",
    "lti",
    "plugin",
  ])
    assert(types.includes(t));
  assert(!types.includes("future-coach"));
  assert(!types.includes("constructor"));
});

 test("explicit null drafts remain distinct from absent draft fields",()=>{
 const f=coach();f.payload.directDataSources.atom.elements[0].draft=null;
 const p=retainedNativeCoachEvidence(f,courseId);assert.equal(p.draft,null);assert.equal(p.draftFieldPresent,true);
 });
