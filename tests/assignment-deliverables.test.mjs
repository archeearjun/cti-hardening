import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAssignmentDeliverable,
  importAssignmentDeliverable,
  makeAssignmentDeliverableData,
  assignmentDeliverableRecordId,
  assignmentDeliverableMarkdown,
  assignmentDeliverableCsv,
  deliverableArtifactHash,
  deliverableIsStale,
  validateAssignmentDeliverableArtifact,
  validateAssignmentDeliverableData,
  rebaseAssignmentDeliverable,
} from "../src/domain/assignment-deliverables.ts";
import { assignmentItemId } from "../src/domain/item-lifecycle.ts";
import { sourceDocumentScan } from "../src/domain/source-documents.ts";
import { inspectEvidenceInput } from "../src/domain/evidence-intake.ts";

function fixture() {
  const course = {
    id: "course",
    kind: "package",
    title: "Exact source course",
    packageId: "",
    version: 1,
    updatedAt: "2026-10-01T00:00:00Z",
    updatedBy: "owner",
    data: {
      assignmentPlan: { route: "COURSE", shellChangedAt: "" },
      scan: {
        fileSha256: "a".repeat(64),
        scannedAt: "2026-10-01T00:00:00Z",
        courseTree: [
          {
            id: "placement-1",
            idref: "resource-shared",
            title: "Repeated title",
            type: "Reading",
            children: [],
            sourcePayload: { textSample: "Literal source content\n<&exact>" },
          },
          {
            id: "placement-2",
            idref: "resource-shared",
            title: "Repeated title",
            type: "Reading",
            children: [],
            sourcePayload: { textSample: "Second placement content" },
          },
        ],
      },
    },
  };
  const content = (text, coverage = "COMPLETE") => ({
    basis: "Exact native source",
    capturedAt: "2026-10-02T00:00:00Z",
    text,
    textCoverage: coverage,
    questionCoverage: "UNVERIFIED",
  });
  const audit = {
    id: "audit",
    kind: "audit",
    title: "Audit",
    packageId: course.id,
    version: 1,
    updatedAt: "2026-10-02T01:00:00Z",
    updatedBy: "owner",
    data: {
      sourceScanSha256: course.data.scan.fileSha256,
      hashes: {
        json: "b".repeat(64),
        excel: "c".repeat(64),
        brightspace: "",
        recovery: "",
      },
      result: {
        ownerView: {
          items: [
            {
              id: "same-1",
              name: "Repeated title",
              type: "Reading",
              path: "Module 1",
              status: "REVIEW",
              actions: [],
            },
            {
              id: "same-2",
              name: "Repeated title",
              type: "Reading",
              path: "Module 2",
              status: "REVIEW",
              actions: [],
            },
          ],
        },
        itemResults: [],
      },
      contentEvidence: {
        schemaVersion: 1,
        coursera: [
          {
            id: "same-1",
            name: "Repeated title",
            path: "Module 1",
            content: content("Retained first image context"),
          },
        ],
        brightspace: [],
      },
    },
  };
  return { course, audit, records: [course, audit] };
}
function draft(f = fixture(), kind = "content-map") {
  return generateAssignmentDeliverable(f.course, f.audit, f.records, kind);
}
function record(data) {
  return {
    id: assignmentDeliverableRecordId(data.deliverableId, data.revision),
    kind: "operations",
    packageId: data.courseId,
    title: "Deliverable",
    version: 1,
    updatedAt: data.createdAt,
    updatedBy: data.createdBy,
    data,
  };
}
const now = "2026-10-03T00:00:00Z";

test("deterministic drafts retain exact placements, text and missing content without title fallback", () => {
  const f = fixture(),
    original = JSON.stringify(f),
    a = draft(f);
  assert.deepEqual(a, draft(f));
  assert.equal(a.members.length, 4);
  assert.deepEqual(a.inputHashes, {
    excel: "c".repeat(64),
    json: "b".repeat(64),
  });
  const first = a.members.find((m) => m.nativeId === "same-1"),
    second = a.members.find((m) => m.nativeId === "same-2");
  assert.notEqual(first.memberId, second.memberId);
  assert.equal(first.retainedText, "Retained first image context");
  assert.equal(second.retainedText, null);
  assert.equal(second.textCoverage, "UNVERIFIED");
  assert.equal(
    first.memberId,
    assignmentItemId(f.course.id, "coursera", "same-1"),
  );
  assert.equal(
    a.members.find((m) => m.nativeId === "placement-1").retainedText,
    "Literal source content\n<&exact>",
  );
  assert.equal(
    a.members.find((m) => m.nativeId === "placement-2").retainedText,
    "Second placement content",
  );
  assert.equal(JSON.stringify(f), original);
  for (const kind of [
    "course-outline",
    "specialization-outline",
    "transformation-plan",
  ])
    assert.equal(draft(f, kind).kind, kind);
});

test("a source document draft preserves literal text and its limited inventory scope", async () => {
  const f = fixture();
  const literal =
    "# Source reading\n\nLiteral <image> wording.\n\n## Quiz discussion\nThis is document text, not a captured quiz definition.\n";
  const file = new File([literal], "brightspace.md", { type: "text/markdown" });
  const entry = await inspectEvidenceInput(file, f.course, {
    documentPlatform: "Brightspace",
  });
  f.course.data.scan = sourceDocumentScan(entry.data);
  f.audit.data.sourceScanSha256 = f.course.data.scan.fileSha256;
  const artifact = draft(f);
  assert.equal(artifact.sourceInventoryKind, "document");
  assert.match(artifact.sourceScope, /not a complete LMS/);
  const source = artifact.members.filter(
    (member) => member.platform === "source",
  );
  assert.equal(source.map((member) => member.retainedText).join(""), literal);
  assert.ok(
    source.every((member) =>
      member.contentBasis.startsWith("Retained source document section"),
    ),
  );
  assert.ok(source.every((member) => member.fidelity === "unverified"));
  assert.match(
    assignmentDeliverableMarkdown(artifact),
    /Source inventory: document/,
  );
  const altered = structuredClone(artifact);
  altered.sourceInventoryKind = "package";
  assert.throws(
    () => importAssignmentDeliverable(altered, artifact),
    /different assignment evidence/,
  );
});

test("import permits explicit reordered structure proposals but protects every retained evidence field", () => {
  const a = draft(),
    revised = structuredClone(a);
  revised.members.reverse();
  revised.members[0].proposed = {
    title: "Owner proposed title",
    path: "Course 2 > Module 1",
    action: "move",
    note: "Proposed by the assignment owner.",
    mappedMemberIds: [],
  };
  const accepted = importAssignmentDeliverable(revised, a);
  assert.equal(accepted.members[0].memberId, revised.members[0].memberId);
  assert.equal(accepted.members[0].proposed.title, "Owner proposed title");
  assert.equal(a.members[0].proposed.title, "Repeated title");
  for (const mutate of [
    (v) => v.members.pop(),
    (v) => v.members.push(structuredClone(v.members[0])),
    (v) => v.members[0].sourceIds.push("guessed-source"),
    (v) => v.members[0].destinationIds.push("guessed-destination"),
    (v) => (v.members[0].title = "Rewritten source title"),
    (v) => (v.members[0].capturedAt = "2026-10-05T00:00:00Z"),
    (v) => {
      v.members[0].retainedText = "Invented content";
      v.members[0].textSha256 = "f".repeat(64);
    },
    (v) => (v.members[0].url = "https://untrusted.test/"),
    (v) => (v.basisHash = "d".repeat(64)),
    (v) => (v.courseId = "another-course"),
  ]) {
    const bad = structuredClone(a);
    mutate(bad);
    assert.throws(() => importAssignmentDeliverable(bad, a));
  }
  const reorderedKeys = JSON.parse(JSON.stringify(a), (key, value) =>
    value && !Array.isArray(value) && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  );
  assert.deepEqual(importAssignmentDeliverable(reorderedKeys, a), a);
});

test("transformation proposals support exact split/reuse mappings and reject unretained or same-platform targets", () => {
  const a = draft(fixture(), "transformation-plan"),
    revised = structuredClone(a);
  const source = revised.members.find((member) => member.platform === "source"),
    destinations = revised.members.filter(
      (member) => member.platform === "coursera",
    );
  source.proposed.mappedMemberIds = destinations.map(
    (member) => member.memberId,
  );
  const accepted = importAssignmentDeliverable(revised, a);
  assert.deepEqual(
    accepted.members.find((member) => member.memberId === source.memberId)
      .proposed.mappedMemberIds,
    destinations.map((member) => member.memberId),
  );
  for (const ids of [
    ["unknown-member"],
    [source.memberId],
    [
      revised.members.filter((member) => member.platform === "source")[1]
        .memberId,
    ],
  ]) {
    source.proposed.mappedMemberIds = ids;
    assert.throws(() => importAssignmentDeliverable(revised, a), /mapping/i);
  }
});

test("append-only decisions preserve revisions and external application cannot become verification", () => {
  const a = draft(),
    original = JSON.stringify(a);
  assert.throws(() =>
    makeAssignmentDeliverableData(
      a,
      [],
      "approved",
      "Reviewed the exact retained structure.",
      "owner",
      now,
    ),
  );
  const d1 = makeAssignmentDeliverableData(a, [], "draft", "", "owner", now),
    r1 = record(d1);
  const d2 = makeAssignmentDeliverableData(
      a,
      [r1],
      "approved",
      "Reviewed the retained structure and explicit evidence gaps.",
      "owner",
      now,
    ),
    r2 = record(d2);
  const d3 = makeAssignmentDeliverableData(
    a,
    [r1, r2],
    "external-application-recorded",
    "Applied the approved moves in the destination LMS.",
    "owner",
    now,
  );
  for (const d of [d1, d2, d3]) validateAssignmentDeliverableData(d);
  assert.equal(d2.previousRecordId, r1.id);
  assert.equal(d3.previousRecordId, r2.id);
  assert.deepEqual([d1.revision, d2.revision, d3.revision], [1, 2, 3]);
  assert.equal(d3.event, "external-application-recorded");
  assert.equal("verified" in d3, false);
  assert.equal(JSON.stringify(a), original);
  assert.throws(() =>
    makeAssignmentDeliverableData(
      a,
      [r1],
      "external-application-recorded",
      "Attempted external application before structure approval.",
      "owner",
      now,
    ),
  );
  const modified = structuredClone(a);
  modified.members[0].proposed.action = "omit";
  assert.throws(() =>
    makeAssignmentDeliverableData(
      modified,
      [r1],
      "approved",
      "Should not approve an unsaved revised structure.",
      "owner",
      now,
    ),
  );
  const revision = makeAssignmentDeliverableData(
    modified,
    [r1, r2, record(d3)],
    "revision",
    "Explicit omission proposed; original item retained.",
    "owner",
    now,
  );
  assert.equal(revision.revision, 4);
  assert.equal(revision.artifact.members.length, a.members.length);
});

test("new audit or review basis makes old decisions stale without deleting their source-linked artifacts", () => {
  const f = fixture(),
    a = draft(f),
    saved = makeAssignmentDeliverableData(a, [], "draft", "", "owner", now);
  assert.equal(deliverableIsStale(saved, a), false);
  const supplement = structuredClone(a);
  supplement.members.find(
    (member) => member.nativeId === "same-2",
  ).contentBasis = "New exact-input supplement available";
  assert.equal(deliverableIsStale(saved, supplement), true);
  const proposalOnly = structuredClone(a);
  proposalOnly.members.reverse();
  proposalOnly.members[0].proposed.path = "Owner-defined placement";
  assert.equal(deliverableIsStale(saved, proposalOnly), false);
  f.audit.version = 2;
  const current = draft(f);
  assert.equal(deliverableIsStale(saved, current), true);
  assert.equal(saved.artifact.auditVersion, 1);
  f.audit.data.sourceScanSha256 = "f".repeat(64);
  assert.throws(() => draft(f), /current source package/);
});

test("explicit rebase carries only exact member proposals and retains fresh source evidence", () => {
  const f = fixture(),
    old = draft(f);
  old.members.reverse();
  old.members[0].proposed.path = "Owner chosen grouping";
  old.members[0].proposed.mappedMemberIds = [
    old.members.find((member) => member.nativeId === "same-2").memberId,
  ];
  const unchanged = JSON.stringify(old);
  f.audit.version++;
  f.audit.data.result.ownerView.items =
    f.audit.data.result.ownerView.items.filter((item) => item.id !== "same-2");
  f.audit.data.contentEvidence.coursera[0].content.text =
    "Newly retained original text";
  const current = draft(f),
    rebased = rebaseAssignmentDeliverable(old, current);
  assert.equal(rebased.artifact.auditVersion, 2);
  assert.equal(rebased.artifact.members[0].memberId, old.members[0].memberId);
  assert.equal(
    rebased.artifact.members[0].proposed.path,
    "Owner chosen grouping",
  );
  assert.equal(
    rebased.artifact.members.find((member) => member.nativeId === "same-1")
      .retainedText,
    "Newly retained original text",
  );
  assert.equal(rebased.retiredMemberIds.length, 1);
  assert.equal(rebased.removedMappingIds.length, 1);
  assert.deepEqual(rebased.artifact.members[0].proposed.mappedMemberIds, []);
  assert.equal(JSON.stringify(old), unchanged);
  assert.deepEqual(
    importAssignmentDeliverable(rebased.artifact, current),
    rebased.artifact,
  );
});

test("exported Markdown is inert text and CSV protects formula-prefixed fields", () => {
  const a = draft();
  a.members[0].proposed.title = '=HYPERLINK("https://example.test","Open")';
  a.members[0].proposed.note =
    "<script>alert(1)</script> ![remote](https://example.test/pixel)";
  const markdown = assignmentDeliverableMarkdown(a);
  assert(!markdown.includes("<script>"));
  assert(!markdown.includes("![remote]("));
  assert(markdown.includes("not approved or verified"));
  assert(
    markdown.includes(
      "No text body retained. This is not evidence that the source was empty.",
    ),
  );
  assert(assignmentDeliverableCsv(a).includes("\"'=HYPERLINK("));
});

test("invalid identities, oversized notes and fabricated approval states are rejected at the persistence boundary", () => {
  const a = draft(),
    d = makeAssignmentDeliverableData(a, [], "draft", "", "owner", now);
  for (const mutate of [
    (v) => (v.event = "verified"),
    (v) => (v.revision = 0),
    (v) => (v.previousRecordId = "prior"),
    (v) => (v.note = "x".repeat(4001)),
    (v) => (v.inputHashes = null),
    (v) => (v.artifactSha256 = "0".repeat(64)),
  ]) {
    const invalid = structuredClone(d);
    mutate(invalid);
    assert.throws(() => validateAssignmentDeliverableData(invalid));
  }
  const ambiguous = structuredClone(a);
  ambiguous.members[0].identityStatus = "ambiguous";
  const initial = makeAssignmentDeliverableData(
    ambiguous,
    [],
    "draft",
    "",
    "owner",
    now,
  );
  assert.throws(
    () =>
      makeAssignmentDeliverableData(
        ambiguous,
        [record(initial)],
        "approved",
        "An ambiguous member must not be approved.",
        "owner",
        now,
      ),
    /ambiguous/i,
  );
  const fabricated = structuredClone(initial);
  fabricated.event = "approved";
  fabricated.note = "A fabricated approval should also be rejected.";
  assert.throws(
    () => validateAssignmentDeliverableData(fabricated),
    /ambiguous/i,
  );
  const large = structuredClone(a);
  large.members[0].proposed.note = "x".repeat(4001);
  assert.throws(() => validateAssignmentDeliverableArtifact(large));
  assert.equal(deliverableArtifactHash(a).length, 64);
});
