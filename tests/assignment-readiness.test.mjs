import test from "node:test";
import assert from "node:assert/strict";
import { assignmentReadiness } from "../src/domain/assignment-readiness.ts";
import {
  assignmentBasis,
  evaluateAssignment,
} from "../src/domain/assignment-plan.ts";
import {
  assignmentItemId,
  itemLifecycleRecordId,
} from "../src/domain/item-lifecycle.ts";
import { courseraContentObservedAt } from "../src/domain/coursera-observation-time.ts";
import { readFileSync } from "node:fs";

const day = (n) => `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`;
const archiveProof = (
  metadataSha256,
  files = [
    { path: "files/" + "f".repeat(64), sha256: "f".repeat(64), size: 10 },
  ],
) => ({
  method: "VERIFIED_ORIGINAL_ARCHIVE_FILES",
  metadataSha256,
  archiveSha256: "e".repeat(64),
  archiveBytes: files.reduce((sum, file) => sum + file.size, 0) + 1000,
  originalBytesStored: false,
  originalBodyBytes: files.reduce((sum, file) => sum + file.size, 0),
  fileCount: files.length,
  files,
});
function fixture() {
  const course = {
    id: "readiness-course",
    kind: "package",
    title: "Observed title",
    packageId: "",
    version: 1,
    updatedAt: day(1),
    updatedBy: "owner",
    data: {
      assignmentPlan: { route: "COURSE", shellChangedAt: "" },
      scan: {
        fileSha256: "a".repeat(64),
        scannedAt: day(1),
        courseTree: [
          {
            id: "source-item",
            title: "Literal source",
            type: "webcontent",
            children: [],
          },
        ],
        sourceEvidence: { manifestOnly: false },
        stats: {},
      },
    },
  };
  const evidence = {
    basis: "Retained Coursera source",
    capturedAt: day(2),
    url: "",
    text: "",
    textCoverage: "UNVERIFIED",
    textReason: "",
    questions: [],
    questionCoverage: "UNVERIFIED",
    questionReason: "",
    expectedQuestions: null,
    references: [],
    limitations: [],
  };
  const audit = {
    id: "readiness-audit",
    kind: "audit",
    title: "Saved comparison",
    packageId: course.id,
    version: 1,
    updatedAt: day(3),
    updatedBy: "owner",
    data: {
      sourceScanSha256: course.data.scan.fileSha256,
      hashes: { json: "b".repeat(64) },
      result: {
        success: true,
        inputCoherence: { status: "PASS" },
        stats: {
          extractorMeta: {
            capturedAt: day(2),
            page: { courseId: "native-course" },
          },
        },
        ownerView: {
          items: [
            {
              id: "item",
              name: "Literal assessment",
              type: "Assignment",
              path: "Module 1",
              status: "VERIFIED_EVIDENCE",
              actions: [],
            },
          ],
        },
      },
      contentEvidence: {
        schemaVersion: 1,
        coursera: [
          {
            id: "item",
            name: "Literal assessment",
            path: "Module 1",
            content: evidence,
          },
        ],
        brightspace: [],
      },
    },
  };
  const records = [course, audit];
  const evaluate = () => evaluateAssignment(course, audit, records);
  const result = (options) =>
    assignmentReadiness(course, audit, evaluate(), records, options);
  const purpose = (id, options) =>
    result(options).purposes.find((p) => p.purpose === id);
  const sign = () => {
    course.data.assignmentPlan.reconciliation = {
      basis: assignmentBasis(course, audit, records),
      recordedAt: day(4),
      recordedBy: "owner",
      note: "Reviewed the exact retained source, scope and comparison evidence.",
    };
  };
  return { course, audit, evidence, records, evaluate, result, purpose, sign };
}

test("orientation can use retained evidence without turning absent source inputs into empty content", () => {
  const f = fixture(),
    before = JSON.stringify([f.course, f.audit, f.records]);
  const orientation = f.purpose("orientation");
  assert.equal(orientation.status, "PROVISIONAL");
  assert(
    orientation.unknowns.includes(
      "No live Brightspace capture is attached to this comparison.",
    ),
  );
  assert(
    !orientation.observations.some((v) =>
      /zero bytes|failed|empty source/i.test(v),
    ),
  );
  assert.equal(f.purpose("structural-agent-handoff").status, "UNKNOWN");
  assert.equal(f.purpose("assessment-review").status, "UNKNOWN");
  assert.equal(
    JSON.stringify([f.course, f.audit, f.records]),
    before,
    "Derived readiness never rewrites an old report or decision",
  );
});

test("failed source acquisition and verified zero-byte originals stay separate from an absent capture", () => {
  const f = fixture();
  f.audit.data.hashes.brightspace = "c".repeat(64);
  const source = (id, body) => ({
    id,
    content: { ...structuredClone(f.evidence), sourceBody: body },
  });
  f.audit.data.contentEvidence.brightspace = [
    source("unread", {
      status: "UNAVAILABLE",
      bytes: null,
      reason: "HTTP_403",
      originalIntegrity: "UNVERIFIED",
      references: [],
    }),
    source("empty", {
      status: "CAPTURED_ORIGINAL",
      bytes: 0,
      reason: "",
      originalIntegrity: "VERIFIED_RETAINED_ORIGINAL",
      references: [],
    }),
  ];
  const view = f.purpose("orientation");
  assert(
    view.observations.includes("1 source body has recorded acquisition gaps."),
  );
  assert(
    view.observations.includes(
      "1 retained source body is explicitly zero bytes.",
    ),
  );
  assert(!view.unknowns.some((v) => v.includes("No live Brightspace")));
  assert(view.limitation.includes("failed source read"));
});

test("actual attached draft observations support assessment review without becoming published questions", () => {
  const f = fixture();
  f.evidence.authoringDraftSnapshot = {
    scope: "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM",
    itemId: "item",
    publishedContentVerified: false,
    contentCompletenessVerified: false,
    wholeItemVerified: false,
    parts: [
      { definition: { id: "exact-version@2", nativeType: "textExactMatch" } },
      { definition: { id: "exact-version@2", nativeType: "textExactMatch" } },
    ],
  };
  const before = JSON.stringify(f.audit),
    assessment = f.purpose("assessment-review");
  assert.equal(assessment.status, "PROVISIONAL");
  assert(
    assessment.observations.includes("0 normalized question observations."),
  );
  assert(
    assessment.observations.includes(
      "2 definition references in separately retained attached drafts.",
    ),
  );
  assert(
    assessment.unknowns.some((v) =>
      v.includes("Current published bodies remain unverified"),
    ),
  );
  assert.equal(f.evidence.questions.length, 0);
  assert.equal(JSON.stringify(f.audit), before);
  assert(
    f.result().purposes.every((p) => !["READY", "COMPLETE"].includes(p.status)),
  );
});

test("empty or failed assessment projections cannot establish a source-empty assessment", () => {
  const f = fixture();
  f.evidence.questionCoverage = "EMPTY";
  f.evidence.questionReason =
    "No definitions returned; bank coverage is unverified.";
  const view = f.purpose("assessment-review");
  assert.equal(view.status, "UNKNOWN");
  assert(view.limitation.includes("do not prove an empty assessment"));
  f.evidence.retainedAuthoringContent = {
    blocks: [{ kind: "TEXT_BLOCK", nativeType: "storedTextBlockPart" }],
  };
  assert.equal(
    f.purpose("assessment-review").status,
    "PROVISIONAL",
    "An instruction body can be inspected without inventing a question",
  );
  assert.equal(f.evidence.questions.length, 0);
});

test("a structural inventory alone does not confirm intended scope or agent handoff", () => {
  const f = fixture();
  assert.equal(f.purpose("structural-agent-handoff").status, "UNKNOWN");
  f.audit.data.result.ownerView.items[0].path = "Archive";
  f.sign();
  assert.equal(f.evaluate().reconciled, true);
  let view = f.purpose("structural-agent-handoff");
  assert.equal(view.status, "UNKNOWN");
  assert(view.unknowns.some((v) => v.includes("default folder rules")));
  const key = f.evaluate().tasks[0].key;
  f.records.push({
    id: "scope-review",
    kind: "item-review",
    packageId: f.course.id,
    version: 1,
    updatedAt: day(4),
    data: {
      auditId: f.audit.id,
      itemKey: key,
      review: { relevance: "not_relevant" },
    },
  });
  f.sign();
  view = f.purpose("structural-agent-handoff");
  assert.equal(view.status, "PROVISIONAL");
  assert(view.limitation.includes("not the complete content corpus"));
});

test("new staged evidence or a mismatched source produces an observable structural barrier", () => {
  const f = fixture();
  f.sign();
  assert.equal(
    f.purpose("structural-agent-handoff", { pendingChanged: true }).status,
    "NEEDS_EVIDENCE",
  );
  f.audit.data.sourceScanSha256 = "d".repeat(64);
  const view = f.purpose("structural-agent-handoff");
  assert.equal(view.status, "NEEDS_EVIDENCE");
  assert(
    view.blockers.includes(
      "The saved comparison does not match the current source identity.",
    ),
  );
});

test("an archive import proof supports historical byte integrity only and missing current media stays a barrier", () => {
  const f = fixture();
  f.audit.data.archiveProof = archiveProof(f.audit.data.hashes.json);
  let view = f.purpose("original-media-verification");
  assert.equal(view.status, "PROVISIONAL");
  assert(view.observations.some((v) => v.includes("1 Coursera archive file")));
  assert(view.limitation.includes("not a new provider read"));
  f.evidence.inlineWidgetContent = {
    providers: [
      {
        publisherPages: [
          {
            media: {
              resources: [
                {
                  status: "UNRESOLVED",
                  reason:
                    "PUBLISHER_IMAGE_SERVICE_ORIGIN_CHALLENGE_NOT_ATTEMPTED",
                },
              ],
            },
          },
        ],
      },
    ],
  };
  view = f.purpose("original-media-verification");
  assert.equal(view.status, "NEEDS_EVIDENCE");
  assert(
    view.blockers.includes(
      "1 media reference has no verified current original body.",
    ),
  );
  f.audit.data.archiveProof.metadataSha256 = "0".repeat(64);
  assert(
    f
      .purpose("original-media-verification")
      .blockers.includes(
        "Saved archive proof is invalid, unsupported or does not match this capture input.",
      ),
  );
});

test("a URL-only item and a zero-file archive do not verify original media", () => {
  const f = fixture();
  f.evidence.references = ["https://example.test/video.mp4"];
  assert.equal(f.purpose("original-media-verification").status, "UNKNOWN");
  f.audit.data.archiveProof = archiveProof(f.audit.data.hashes.json, []);
  assert.equal(f.purpose("original-media-verification").status, "UNKNOWN");
});

test("malformed saved archive descriptors cannot claim an import check", () => {
  const changes = [
    (p) => {
      p.files = [{}];
    },
    (p) => {
      delete p.archiveBytes;
    },
    (p) => {
      p.files[0].path = "files/../" + p.files[0].sha256;
    },
    (p) => {
      p.files[0].sha256 = "0".repeat(64);
    },
    (p) => {
      p.files[0].size = 0;
    },
    (p) => {
      p.files[0].size = 128 * 1024 * 1024 + 1;
    },
    (p) => {
      p.files.push({ ...p.files[0] });
      p.fileCount = 2;
      p.originalBodyBytes = 20;
    },
    (p) => {
      p.fileCount = 0;
    },
    (p) => {
      p.originalBodyBytes = 11;
    },
    (p) => {
      p.archiveBytes = 9;
    },
    (p) => {
      p.archiveBytes = 640 * 1024 * 1024 + 1;
    },
    (p) => {
      p.originalBytesStored = true;
    },
    (p) => {
      p.metadataSha256 = "x".repeat(64);
    },
  ];
  for (const change of changes) {
    const f = fixture();
    const proof = archiveProof(f.audit.data.hashes.json);
    change(proof);
    f.audit.data.archiveProof = proof;
    const view = f.purpose("original-media-verification");
    assert.equal(view.status, "NEEDS_EVIDENCE");
    assert(!view.observations.some((v) => v.includes("Coursera archive")));
  }
  const f = fixture();
  f.audit.data.archiveProof = archiveProof(
    f.audit.data.hashes.json,
    [1, 2, 3, 4, 5].map((n) => ({
      path: "files/" + String(n).repeat(64),
      sha256: String(n).repeat(64),
      size: 128 * 1024 * 1024,
    })),
  );
  assert.equal(
    f.purpose("original-media-verification").status,
    "NEEDS_EVIDENCE",
  );
});

test("saved archive proof must match its optional ZIP transport and permits historical large-file descriptors", () => {
  const f = fixture();
  const proof = archiveProof(f.audit.data.hashes.json, [
    {
      path: "files/" + "f".repeat(64),
      sha256: "f".repeat(64),
      size: 32 * 1024 * 1024,
    },
  ]);
  f.audit.data.archiveProof = proof;
  const transport = {
    encoding: "zip",
    name: "capture.cti.zip",
    sha256: proof.archiveSha256,
    bytes: proof.archiveBytes,
    expandedBytes: 1000,
    originalBodyBytes: proof.originalBodyBytes,
    fileCount: proof.fileCount,
    files: structuredClone(proof.files),
  };
  f.audit.data.captureTransport = { json: structuredClone(transport) };
  let view = f.purpose("original-media-verification");
  assert.equal(view.status, "PROVISIONAL");
  assert(
    view.observations.some((v) => v.startsWith("An import check is recorded")),
  );
  assert(view.unknowns.some((v) => v.includes("playback")));
  const changes = [
    (t) => {
      t.encoding = "gzip";
    },
    (t) => {
      t.sha256 = "0".repeat(64);
    },
    (t) => {
      t.bytes++;
    },
    (t) => {
      t.expandedBytes = 0;
    },
    (t) => {
      t.expandedBytes = 128 * 1024 * 1024 + 1;
    },
    (t) => {
      t.originalBodyBytes++;
    },
    (t) => {
      t.fileCount++;
    },
    (t) => {
      t.files[0].size++;
    },
    (t) => {
      t.files[0].path = "files/" + "0".repeat(64);
    },
    (t) => {
      t.files = [null];
    },
  ];
  for (const change of changes) {
    const changed = structuredClone(transport);
    change(changed);
    f.audit.data.captureTransport.json = changed;
    view = f.purpose("original-media-verification");
    assert.equal(view.status, "NEEDS_EVIDENCE");
    assert(!view.observations.some((v) => v.includes("Coursera archive")));
  }
});

test("a later supplemental archive proof is not silently treated as a base import check", () => {
  const f = fixture();
  f.records.push({
    id: "supplemental-content",
    kind: "report-content",
    packageId: f.course.id,
    data: {
      auditId: f.audit.id,
      archiveProof: archiveProof(f.audit.data.hashes.json),
    },
  });
  const view = f.purpose("original-media-verification");
  assert.equal(view.status, "UNKNOWN");
  assert(!view.observations.some((v) => v.includes("Coursera archive")));
});

test("a newer resumed export and checked label cannot verify content predating a declared edit", () => {
  const f = fixture();
  f.course.data.assignmentPlan.shellChangedAt = day(5);
  f.audit.updatedAt = day(9);
  f.audit.data.result.stats.extractorMeta = {
    capturedAt: day(8),
    directDataCapture: {
      sourceStable: true,
      mediaEnrichment: {
        retainedAssessmentObservations: true,
        baseSourceCapturedAt: day(2),
        scope: "MEDIA_ONLY",
      },
    },
  };
  f.records.push({
    id: "checked",
    kind: "item-review",
    packageId: f.course.id,
    data: {
      auditId: f.audit.id,
      itemKey: "item:item",
      review: {
        status: "checked",
        note: "Checked this visible item in the owner browser.",
      },
    },
  });
  assert.equal(courseraContentObservedAt(f.audit), day(2));
  const view = f.purpose("post-edit-verification");
  assert.equal(view.status, "NEEDS_EVIDENCE");
  assert(view.blockers.some((v) => v.includes("does not postdate")));
  assert(view.observations.some((v) => v.includes(day(2))));
  assert(!view.observations.some((v) => v.includes(day(8))));
});

test("cleared edit-date barriers remain unknown without evidence-specific body revalidation", () => {
  const f = fixture(),
    event = {
      kind: "decision",
      decision: "changed",
      eventId: "edit-event",
      sequence: 1,
      courseId: f.course.id,
      itemId: assignmentItemId(f.course.id, "coursera", "item"),
      platform: "coursera",
      nativeId: "item",
      actor: "owner",
      recordedAt: day(4),
      observedAt: day(4),
      note: "Changed the exact authored item after source review.",
      basis: {
        auditId: "previous-audit",
        auditVersion: 1,
        sourceScanSha256: f.course.data.scan.fileSha256,
        inputHashes: { json: "9".repeat(64) },
        fingerprint: "8".repeat(64),
      },
    };
  f.records.push({
    id: itemLifecycleRecordId(f.course.id),
    kind: "operations",
    packageId: f.course.id,
    version: 1,
    updatedAt: day(4),
    data: {
      type: "item-lifecycle",
      schemaVersion: 1,
      courseId: f.course.id,
      events: [event],
    },
  });
  f.audit.updatedAt = day(7);
  f.audit.data.result.stats.extractorMeta.capturedAt = day(6);
  assert.equal(f.evaluate().changeFreshness.status, "current");
  const view = f.purpose("post-edit-verification");
  assert.equal(view.status, "UNKNOWN");
  assert.equal(view.blockers.length, 0);
  assert(
    view.unknowns.some((v) => v.includes("Current native body revalidation")),
  );
});

test("loading or unavailable item history cannot grant provisional readiness", () => {
  const f = fixture();
  f.evidence.questions = [{ prompt: "Retained prompt" }];
  for (const options of [
    { loading: true },
    { loadError: "Record access failed" },
  ])
    assert(f.result(options).purposes.every((p) => p.status === "UNKNOWN"));
});

test("the owner UI remains an inert purpose summary beside the existing next-action workflow", () => {
  const component = readFileSync(
    new URL("../web/AssignmentReadiness.tsx", import.meta.url),
    "utf8",
  );
  const workspace = readFileSync(
    new URL("../web/AssignmentWorkspace.tsx", import.meta.url),
    "utf8",
  );
  assert(component.includes("Purpose-specific evidence readiness"));
  assert(component.includes("Evidence and limits"));
  assert(!component.includes("dangerouslySetInnerHTML"));
  assert(!component.includes("onClick"));
  assert(workspace.includes("<AssignmentReadiness value={readiness} />"));
  assert(workspace.includes("nextAction"));
});
