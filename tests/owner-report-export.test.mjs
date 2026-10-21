import test from "node:test";
import assert from "node:assert/strict";
import { prepareOwnerReportExport } from "../src/domain/owner-report-export.ts";
import { newRecord, recordSummary } from "../src/domain/workspace-store.ts";
import {
  importPanoptoDeliveryInfo,
  validatePanoptoDeliveryInfoCapture,
} from "../src/domain/panopto-delivery-info.ts";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";
import { capturedContent } from "../src/domain/content-evidence.ts";
import { createHash } from "node:crypto";
import { buildOwnerContext } from "../src/domain/source-navigation.ts";

function fixture() {
  const course = {
    ...newRecord("package", "Example course", {}),
    id: "package-a",
  };
  const report = {
    packageId: course.id,
    ingestionCapabilityStatus: "LATEST_APPLIED",
    report:
      "ORIGINAL FINDINGS\nQuestion types unknown\nCritical images unresolved",
    result: {
      stats: {
        extractorMeta: {
          page: {
            url: "https://www.coursera.org/teach/example/course-a/content/edit",
          },
        },
      },
      ownerView: {
        items: [
          {
            id: "survey",
            name: "Example survey",
            status: "EVIDENCE_NEEDED",
            actions: [],
          },
        ],
      },
    },
  };
  const capture = {
    kind: "CTI_COURSERA_ITEM_CHECK",
    schemaVersion: 1,
    notForCourseAudit: true,
    auditId: "audit-a",
    itemId: "survey",
    courseId: "course-a",
    openedUrl:
      "https://www.coursera.org/teach/example/course-a/content/edit?itemId=survey",
    expectations: [],
    finishedAt: "2026-10-04T14:14:01Z",
    extractorVersion: "v6.15.10",
    extractorBuild: "test-build",
    editorObserved: true,
    payload: {
      structuredAssessment: {
        captureCompleteness: {
          questionCoverageComplete: true,
          requiredAnswerCoverageComplete: false,
        },
        questions: [
          {
            id: "q1",
            type: "single-select",
            prompt: "Preferred format?",
            optionTextReliable: true,
            answerEvidenceStatus: "NOT_OBSERVED",
            options: ["Classroom", "Live online", "Self-paced", "Hybrid"].map(
              (text) => ({ text, correct: null }),
            ),
          },
          {
            id: "q2",
            type: "multiple-select",
            prompt: "Preferred methods?",
            optionTextReliable: true,
            answerEvidenceStatus: "NOT_OBSERVED",
            options: ["Lectures", "Videos", "Reading"].map((text) => ({
              text,
              correct: null,
            })),
          },
        ],
      },
    },
    evaluation: { automatedResolution: true, answerCoverageComplete: true },
  };
  const record = {
    ...newRecord(
      "item-review",
      "Example survey",
      {
        auditId: "audit-a",
        itemKey: "item:survey",
        review: {
          status: "in_progress",
          note: "Options captured; answer applicability still needs review.",
          updatedAt: "2026-10-04T14:15:00Z",
          updatedBy: "private@example.test",
          capture,
          pluginCaptures: [
            {
              kind: "CTI_PLUGIN_PAGE_CHECK",
              notForCourseAudit: true,
              auditId: "audit-a",
              courseId: "course-a",
              itemId: "survey",
              targetUrl: "https://example.test/embed",
              text: "Example visible screen",
              finishedAt: "2026-10-04T14:15:00Z",
              status: "VISIBLE_SCREEN_OBSERVED",
              wholePluginVerified: true,
            },
          ],
        },
      },
      course.id,
    ),
    id: "review-a",
    version: 1,
  };
  const reads = [];
  const store = {
    list: async () => [
      recordSummary(record),
      {
        ...recordSummary(record),
        id: "other-audit",
        data: { ...record.data, auditId: "other" },
      },
      { ...recordSummary(record), id: "other-package", packageId: "other" },
    ],
    get: async (id) => {
      reads.push(id);
      assert.equal(id, record.id);
      return structuredClone(record);
    },
  };
  return { course, report, record, store, reads };
}

test("export retains captured inherited source hiding separately from owner review and audit findings", async () => {
  const {course, report} = fixture();
  report.ownerContext = buildOwnerContext(undefined, [], {
    page:{url:'https://lms.example/d2l/home/187960'}, course:{orgUnitId:187960},
    contentTree:[{id:5293619,title:'Archive',kind:'MODULE',isHidden:true,isLocked:false,children:[
      {id:5624618,title:'Module 0 - Asynchronous Course',kind:'MODULE',isHidden:false,isLocked:false,children:[
        {id:5624667,title:'Asynchronous Learning',kind:'TOPIC',isHidden:false,isLocked:false,url:'/content/enforced/187960/Asynchronous.html'},
      ]},
    ]}],
  });
  const original=structuredClone(report);
  const exported=await prepareOwnerReportExport(report,'audit-a',course,{list:async()=>[],get:async()=>{throw Error('No review should be loaded');}});
  assert(exported.text.startsWith('ASSIGNMENT DECISION BRIEF'));
  assert(exported.text.indexOf('ASSIGNMENT DECISION BRIEF') < exported.text.indexOf('ORIGINAL AUDIT — UNCHANGED'));
  assert(exported.text.endsWith(report.report));
  assert.match(exported.text,/CAPTURED SOURCE PLACEMENT AND VISIBILITY/);
  assert.match(exported.text,/Archive \[5293619\]/);
  assert.equal(exported.followUp.sourcePlacement[0].sourceVisibility.ownHidden,false);
  assert.equal(exported.followUp.sourcePlacement[0].sourceVisibility.hiddenByAncestor,true);
  assert.match(exported.text,/Saved item reviews: 0/);
  assert.deepEqual(report,original,'visibility context supplements but never changes audit findings');
});

test("exports full saved follow-ups for this audit only, preserving original evidence and uncertainty", async () => {
  const f = fixture(),
    before = structuredClone(f.report),
    originalReview = structuredClone(f.record);
  const exported = await prepareOwnerReportExport(
    f.report,
    "audit-a",
    f.course,
    f.store,
  );
  assert.deepEqual(f.reads, ["review-a"]);
  assert.deepEqual(f.report, before);
  assert.deepEqual(f.record, originalReview);
  assert.deepEqual(exported.evidence.result, before.result);
  assert.equal(exported.evidence.report, before.report);
  assert.equal(exported.evidence.ingestionCapabilityStatus, "LATEST_APPLIED");
  assert(exported.text.endsWith(before.report));
  assert.match(
    exported.text,
    /focused item checks: 1 \| plugin-page checks: 1/,
  );
  assert.match(exported.text, /captured type=single-select \| options=4/);
  assert.match(exported.text, /captured type=multiple-select \| options=3/);
  assert.match(exported.text, /Option 4: Hybrid/);
  assert.match(exported.text, /required answer-key coverage: not established/);
  assert.match(exported.text, /answer evidence=NOT_OBSERVED/);
  assert.match(exported.text, /Options captured; answer applicability/);
  assert(!exported.text.includes("private@example.test"));
  const r = exported.followUp.reviews[0];
  assert.equal(r.capture.evaluation.automatedResolution, false);
  assert.equal(r.capture.evaluation.answerCoverageComplete, false);
  assert.equal(r.pluginCaptures[0].wholePluginVerified, false);
  assert.equal(exported.followUp.automatedResolution, false);
  assert.equal(exported.followUp.derivedAnswers.originalKeysUnchanged, true);
  const checks = exported.followUp.derivedAnswers.items.flatMap((i) =>
    i.evidence.flatMap((e) => e.questions),
  );
  assert.equal(checks.length, 2);
  assert(checks.every((q) => q.check.status === "NEEDS_REVIEW"));
  assert.match(exported.text, /CTI answer: Needs review/);
});

test("zero follow-ups is explicit and does not imply the original audit is current", async () => {
  const f = fixture();
  f.store.list = async () => [];
  const exported = await prepareOwnerReportExport(
    f.report,
    "audit-a",
    f.course,
    f.store,
  );
  assert.match(exported.text, /NO SAVED FOLLOW-UP EVIDENCE FOR THIS REPORT/);
  assert.match(exported.text, /same saved report that generated its script/);
  assert.equal(exported.followUp.reviews.length, 0);
  assert.deepEqual(f.reads, []);
});

test("failed and changed record reads prevent a misleading complete export", async () => {
  for (const failure of ["permission", "interrupted", "stale", "wrong-scope"]) {
    const f = fixture();
    f.store.get = async () => {
      if (["permission", "interrupted"].includes(failure))
        throw new Error(failure);
      return {
        ...f.record,
        ...(failure === "stale" ? { version: 2 } : { packageId: "other" }),
      };
    };
    await assert.rejects(
      prepareOwnerReportExport(f.report, "audit-a", f.course, f.store),
    );
  }
});

test("mismatched or malformed item evidence is never attributed to this report", async () => {
  for (const mutate of [
    (c) => {
      c.courseId = "other";
    },
    (c) => {
      c.itemId = "other";
    },
    (c) => {
      c.auditId = "other";
    },
    (c) => {
      c.expectations = [null];
    },
    (c) => {
      c.payload.structuredAssessment.questions = {};
    },
  ]) {
    const f = fixture();
    mutate(f.record.data.review.capture);
    await assert.rejects(
      prepareOwnerReportExport(f.report, "audit-a", f.course, f.store),
    );
  }
});

test("cancellation during evidence loading prevents a completed export", async () => {
  const f = fixture(),
    controller = new AbortController();
  f.store.get = async () => {
    controller.abort();
    return f.record;
  };
  await assert.rejects(
    prepareOwnerReportExport(
      f.report,
      "audit-a",
      f.course,
      f.store,
      controller.signal,
    ),
    { name: "AbortError" },
  );
});

test("manual-only reviews and historical checks without an original course URL remain exportable", async () => {
  const f = fixture();
  delete f.report.result.stats;
  let exported = await prepareOwnerReportExport(
    f.report,
    "audit-a",
    f.course,
    f.store,
  );
  assert.match(exported.text, /Course identity comes from the saved check/);
  delete f.record.data.review.capture;
  f.record.data.review.pluginCaptures = [];
  f.record.data.review.status = "checked";
  exported = await prepareOwnerReportExport(
    f.report,
    "audit-a",
    f.course,
    f.store,
  );
  assert.match(exported.text, /Recorded owner outcome: checked/);
  assert.match(exported.text, /No finding is automatically cleared/);
  assert.equal(exported.followUp.reviews.length, 1);
});

async function panoptoFixture() {
  const f = fixture(),
    native = panoptoDeliveryFixture(),
    spec = {
      ...native.spec,
      auditId: "audit-a",
      courseId: "course-a",
      itemId: "survey",
      url: f.record.data.review.capture.openedUrl,
    },
    metadata = await importPanoptoDeliveryInfo(
      native.responseText,
      spec,
      native.targetUrl,
    );
  f.record.data.review.capture.payload.embeddedRefs = [native.targetUrl];
  f.record.data.review.panoptoCaptures = [metadata];
  return { ...f, native, spec, metadata };
}

test("exports separately saved Panopto metadata with exact report binding and unchanged original audit", async () => {
  const f = await panoptoFixture(),
    before = structuredClone(f.report),
    saved = JSON.stringify(f.record),
    exported = await prepareOwnerReportExport(
      f.report,
      "audit-a",
      f.course,
      f.store,
    ),
    review = exported.followUp.reviews[0],
    metadata = review.panoptoCaptures[0];
  assert.deepEqual(f.report, before);
  assert.equal(JSON.stringify(f.record), saved);
  assert.deepEqual(exported.evidence.result, before.result);
  assert.equal(exported.evidence.report, before.report);
  assert.equal(exported.evidence.ingestionCapabilityStatus, "LATEST_APPLIED");
  assert(exported.text.endsWith(before.report));
  assert.equal(review.pluginCaptures.length, 1);
  assert.equal(review.panoptoCaptures.length, 1);
  assert.deepEqual(
    metadata,
    validatePanoptoDeliveryInfoCapture(f.metadata, f.spec),
  );
  assert.deepEqual(metadata.nativeModel, f.metadata.nativeModel);
  assert.equal(metadata.nativeModelSha256, f.metadata.nativeModelSha256);
  assert.equal(metadata.responseTextSha256, f.metadata.responseTextSha256);
  assert.equal(metadata.importedAt, f.metadata.importedAt);
  assert.equal(metadata.provenance, "USER_PROVIDED_DELIVERY_RESPONSE");
  assert.equal(metadata.auditId, "audit-a");
  assert.equal(metadata.courseId, "course-a");
  assert.equal(metadata.itemId, "survey");
  assert.equal(metadata.targetUrl, f.native.targetUrl);
  assert.equal(metadata.identity.deliveryPublicId, f.native.ids.A);
  assert.equal(metadata.identity.sessionPublicId, f.native.ids.B);
  assert.equal(metadata.identity.sessionFileId, f.native.ids.C);
  assert.equal(metadata.navigation.length, 9);
  assert.equal(exported.followUp.automatedResolution, false);
  assert.equal(exported.followUp.originalAuditUnchanged, true);
  assert.match(exported.text, /Panopto metadata imports: 1/);
  assert.match(exported.text, /Manually imported Panopto metadata/);
  assert.match(exported.text, /Import time is not a new player observation/);
  assert.match(exported.text, /No finding is automatically cleared/);
  const observations =
    exported.followUp.contentComparisons[0].view.observations;
  assert(observations.some((entry) => /Panopto metadata/.test(entry.basis)));
  assert(!observations.some((entry) => /Previous.*Panopto/.test(entry.basis)));
});

test("recomputes saved Panopto projections and verification claims during export", async () => {
  const f = await panoptoFixture(),
    p = f.record.data.review.panoptoCaptures[0];
  p.title = "Invented title";
  p.durationSeconds = 9999;
  p.streams = [];
  p.navigation = [{ text: "Invented transcript", kind: "TRANSCRIPT" }];
  for (const key of [
    "bodyVerified",
    "binaryContentVerified",
    "captionsVerified",
    "playbackVerified",
    "courseLaunchVerified",
    "wholePluginVerified",
    "wholeWidgetVerified",
    "automatedResolution",
  ])
    p[key] = true;
  const exported = await prepareOwnerReportExport(
      f.report,
      "audit-a",
      f.course,
      f.store,
    ),
    recomputed = exported.followUp.reviews[0].panoptoCaptures[0];
  assert.equal(recomputed.title, f.native.model.Delivery.SessionName);
  assert.equal(recomputed.durationSeconds, f.native.model.Delivery.Duration);
  assert(recomputed.streams.length > 0);
  assert.equal(recomputed.navigation.length, 9);
  assert(
    !JSON.stringify(recomputed.navigation).includes("Invented transcript"),
  );
  for (const key of [
    "bodyVerified",
    "binaryContentVerified",
    "captionsVerified",
    "playbackVerified",
    "courseLaunchVerified",
    "wholePluginVerified",
    "wholeWidgetVerified",
    "automatedResolution",
  ])
    assert.equal(recomputed[key], false, key);
  assert(!exported.text.includes("Invented title"));
  assert(!exported.text.includes("Invented transcript"));
});

test("retains historical Panopto metadata when the current item no longer references its target", async () => {
  const f = await panoptoFixture();
  f.record.data.review.capture.payload.embeddedRefs = [];
  const exported = await prepareOwnerReportExport(
      f.report,
      "audit-a",
      f.course,
      f.store,
    ),
    observations = exported.followUp.contentComparisons[0].view.observations;
  assert.equal(exported.followUp.reviews[0].panoptoCaptures.length, 1);
  assert(observations.some((entry) => /Previous.*Panopto/.test(entry.basis)));
  assert(
    observations.some((entry) =>
      /current.*reference.*unverified/i.test(entry.basis),
    ),
  );
  assert.match(exported.text, /No finding is automatically cleared/);
});

test("rejects altered native metadata and cross-report or same-title cross-item Panopto attribution", async () => {
  for (const mutate of [
    (p) => {
      p.auditId = "another-audit";
    },
    (p) => {
      p.courseId = "another-course";
    },
    (p) => {
      p.itemId = "same-title-other-item";
    },
    (p) => {
      p.nativeModel.Delivery.SessionName = "Altered source";
    },
    (p) => {
      p.nativeModelSha256 = "f".repeat(64);
    },
    (p) => {
      p.targetUrl = p.targetUrl.replace("00000001-", "00000009-");
    },
  ]) {
    const f = await panoptoFixture();
    mutate(f.record.data.review.panoptoCaptures[0]);
    await assert.rejects(
      prepareOwnerReportExport(f.report, "audit-a", f.course, f.store),
    );
  }
});

function sourceBodyFixture() {
  const f = fixture(),
    literal =
      '1\r\n00:00:01,000 --> 00:00:03,500\r\nOriginal <word> & "exact caption".\r\n',
    hash = createHash("sha256").update(literal).digest("hex"),
    url = "https://source.example.test/captions/original.srt",
    imageUrl = "https://source.example.test/protected/blueprint.png",
    alt = 'North <south> & "original drawing".',
    content = {
      ...capturedContent({}, { basis: "Original Brightspace extraction" }),
      text: literal,
      textCoverage: "COMPLETE",
      textReason:
        "Complete literal source-file text verified against its retained original bytes.",
      references: [imageUrl],
      imageAltText: [{ imageOrdinal: 1, text: alt }],
      sourceBody: {
        platform: "BRIGHTSPACE",
        topicId: "topic-a",
        status: "CAPTURED",
        format: "srt",
        contentType: "application/x-subrip; charset=utf-8",
        observedAt: "2026-10-17T11:14:42.000Z",
        bytes: Buffer.byteLength(literal),
        sha256: hash,
        originalRef: hash,
        originalIntegrity: "VERIFIED_RETAINED_ORIGINAL",
        textScope: "ORIGINAL_BODY",
        descriptionText: "Native topic description kept separately.",
        descriptionTruncated: false,
        reason: "",
        projectionStatus: "",
        projectionReason: "",
        references: [
          {
            url: imageUrl,
            rawUrl: "../protected/blueprint.png",
            tag: "img",
            attribute: "src",
            status: "NOT_FETCHED",
            reason: "AUTHENTICATED_RESOURCE_NOT_READ",
            originalRef: "",
            alt,
            text: "",
          },
        ],
      },
    };
  f.course.data.scan = {
    courseTree: [
      {
        title: "Module 1",
        type: "folder",
        children: [
          {
            title: "Source caption",
            idref: "source-a",
            type: "webcontent",
            sourcePayload: {},
            children: [],
          },
        ],
      },
    ],
  };
  f.report.result.itemResults = [
    {
      sourceId: "source-a",
      sourceName: "Source caption",
      sourcePath: "Module 1",
      courseraId: "survey",
      checks: {},
    },
  ];
  f.report.ownerContext = {
    sourceTopics: [
      { id: "topic-a", name: "Source caption", path: "Module 1", url },
    ],
    sourceTopicMappings: [
      {
        sourceId: "source-a",
        sourceName: "Source caption",
        sourcePath: "Module 1",
        topicId: "topic-a",
        navigationEligible: true,
      },
    ],
  };
  f.report.contentEvidence = {
    schemaVersion: 1,
    coursera: [],
    brightspace: [
      { id: "topic-a", name: "Source caption", path: "Module 1", content },
    ],
  };
  f.store.list = async () => [];
  return { ...f, content, literal, hash, alt, imageUrl };
}

test("owner exports retain literal caption timing, source-file identity and per-reference outcomes without original bytes", async () => {
  const f = sourceBodyFixture(),
    original = structuredClone(f.report),
    exported = await prepareOwnerReportExport(
      f.report,
      "audit-a",
      f.course,
      f.store,
    ),
    source = exported.followUp.contentComparisons[0].view.source.find(
      (c) => c.sourceBody,
    );
  assert.deepEqual(f.report, original);
  assert.equal(source.text, f.literal);
  assert.deepEqual(source.sourceBody, f.content.sourceBody);
  assert.deepEqual(exported.evidence.contentEvidence, original.contentEvidence);
  assert(
    exported.text.includes(f.literal),
    "SRT line endings and literal markup survive text export",
  );
  for (const value of [
    "topic-a",
    "CAPTURED",
    "srt",
    "application/x-subrip; charset=utf-8",
    "2026-10-17T11:14:42.000Z",
    f.hash,
    "VERIFIED_RETAINED_ORIGINAL",
    "ORIGINAL_BODY",
    "img",
    "src",
    f.imageUrl,
    "../protected/blueprint.png",
    "NOT_FETCHED",
    "AUTHENTICATED_RESOURCE_NOT_READ",
    f.alt,
    "Native topic description kept separately.",
  ])
    assert(
      exported.text.includes(value),
      `Source-file export retains ${value}`,
    );
  assert(
    !JSON.stringify(exported.followUp.contentEvidence).includes('"base64"'),
  );
  assert.equal(exported.followUp.automatedResolution, false);
  assert(exported.text.endsWith(original.report));
});

test("source-file exports distinguish a retained binary with no preview from an unfetched body and description fallback", async () => {
  for (const mode of ["binary", "description"]) {
    const f = sourceBodyFixture(),
      body = f.content.sourceBody;
    body.format = "";
    body.references = [];
    f.content.imageAltText = [];
    f.content.references = [];
    if (mode === "binary") {
      body.status = "CAPTURED_ORIGINAL";
      body.contentType = "application/pdf";
      body.textScope = "NO_TEXT";
      body.projectionStatus = "UNRESOLVED";
      body.projectionReason = "BINARY_TEXT_PREVIEW_NOT_AVAILABLE";
      f.content.text = "";
      f.content.textCoverage = "UNVERIFIED";
      f.content.textReason =
        "The original source-file bytes were retained and verified; this file is not confirmed empty.";
    } else {
      body.status = "NOT_FETCHED";
      body.reason = "AUTHENTICATED_RESOURCE_NOT_READ";
      body.originalIntegrity = "UNVERIFIED";
      body.textScope = "DESCRIPTION_FALLBACK";
      body.bytes = null;
      body.sha256 = "";
      body.originalRef = "";
      f.content.text = "Native topic description only.";
      body.descriptionText = f.content.text;
      f.content.textCoverage = "PARTIAL";
      f.content.textReason =
        "Description only; source-file contents and emptiness remain unverified.";
    }
    const exported = await prepareOwnerReportExport(
        f.report,
        "audit-a",
        f.course,
        f.store,
      ),
      source = exported.followUp.contentComparisons[0].view.source.find(
        (c) => c.sourceBody,
      );
    assert.deepEqual(source.sourceBody, body);
    assert(exported.text.includes(body.status));
    assert(exported.text.includes(body.textScope));
    assert(exported.text.includes(body.originalIntegrity));
    assert(
      exported.text.includes(
        mode === "binary" ? body.projectionReason : f.content.text,
      ),
    );
    assert(!exported.text.includes("Text: EMPTY"));
  }
});

test("older source snapshots without source-file fields keep their original export scope", async () => {
  const f = sourceBodyFixture();
  delete f.content.sourceBody;
  const exported = await prepareOwnerReportExport(
      f.report,
      "audit-a",
      f.course,
      f.store,
    ),
    source = exported.followUp.contentComparisons[0].view.source.find(
      (c) => c.text === f.literal,
    );
  assert.equal(source.sourceBody, undefined);
  assert.equal(source.text, f.literal);
  assert(!exported.text.includes("VERIFIED_RETAINED_ORIGINAL"));
});

test("an empty source body stays empty while its separate native topic description remains exportable", async () => {
  const f = sourceBodyFixture();
  f.content.text = "";
  f.content.textCoverage = "EMPTY";
  f.content.textReason = "The retained source file has an empty text field.";
  const emptyHash = createHash("sha256").update("").digest("hex");
  f.content.sourceBody.bytes = 0;
  f.content.sourceBody.sha256 = emptyHash;
  f.content.sourceBody.originalRef = emptyHash;
  const exported = await prepareOwnerReportExport(
      f.report,
      "audit-a",
      f.course,
      f.store,
    ),
    source = exported.followUp.contentComparisons[0].view.source.find(
      (c) => c.sourceBody,
    );
  assert.equal(source.text, "");
  assert.equal(source.textCoverage, "EMPTY");
  assert.equal(source.sourceBody.textScope, "ORIGINAL_BODY");
  assert.equal(
    source.sourceBody.descriptionText,
    "Native topic description kept separately.",
  );
  assert(exported.text.includes("Text: EMPTY"));
  assert(exported.text.includes(source.sourceBody.descriptionText));
});

test("an incomplete saved original-file identity prevents a misleading owner export", async () => {
  const f = sourceBodyFixture();
  f.content.sourceBody.sha256 = "";
  await assert.rejects(
    prepareOwnerReportExport(f.report, "audit-a", f.course, f.store),
    /original-body identity/,
  );
});
