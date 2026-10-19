import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  prepareAssignmentAgentHandoff,
  MAX_ASSIGNMENT_AGENT_HANDOFF_BYTES,
} from "../src/domain/assignment-agent-handoff.ts";
import {
  generateAssignmentDeliverable,
  importAssignmentDeliverable,
} from "../src/domain/assignment-deliverables.ts";
import {
  capturedContent,
  buildContentSnapshot,
  validateContentSnapshot,
} from "../src/domain/content-evidence.ts";
import { recordSummary } from "../src/domain/workspace-store.ts";
import { directCanonicalSourceTextV1 as canonical } from "../src/extractors/coursera/direct-data-canonical.js";
import { createInlinePublisherContentFixture } from "./coursera-inline-content-fixtures.mjs";
import {
  bindDirectPublishedDraftSnapshotV1,
  directPublishedDraftSnapshotInventoryV1,
  directPublishedDraftSnapshotSourceV1,
} from "../src/extractors/coursera/direct-data-authoring-snapshot.js";
import { courseraAuthoringDraftSnapshot } from "../src/domain/coursera-authoring-draft-snapshot.ts";

const sha = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const textSha = (value) => createHash("sha256").update(value).digest("hex");
const literal =
  'Literal source example: data:image/png;base64,aGVsbG8=; {"base64":"an authored example"} <script>not executed</script>';
function publishedDraftContent() {
  const courseId = "NativeCourse",
    slug = "exact",
    atomId = "a".repeat(22),
    local = "b".repeat(22),
    groupId = atomId + "~" + local,
    definitionId = atomId + "~" + "q".repeat(22) + "@2",
    pointer = "p".repeat(22) + "@2";
  const item = {
    id: "item-1",
    typeName: "ungradedAssignment",
    atomId,
    contentId: "atom~" + atomId,
    payload: {},
  };
  const material = {
    id: item.id,
    atomId,
    contentId: item.contentId,
    published: true,
    content: { typeName: item.typeName, definition: { assignmentId: pointer } },
  };
  const atom = {
    id: atomId,
    contentId: item.contentId,
    storedAtomVersion: 2,
    metadata: { updatedAt: 1791189683630 },
    status: { typeName: "publishedAtomStatus", definition: {} },
    draft: {
      name: "Literal attached draft",
      content: {
        typeName: "staffGradedDraft",
        definition: {
          parts: [
            { typeName: "storedQuestionGroupPart", definition: { id: local } },
          ],
          configuration: { isGraded: false },
        },
      },
    },
    published: {
      name: "Published item",
      content: {
        typeName: "staffGraded",
        definition: { assignmentId: pointer, isGraded: true },
      },
    },
  };
  const relation = {
    id: atomId,
    atomId,
    branchRelationMap: {
      [courseId + "~" + item.id]: {
        courseId,
        itemId: item.id,
        courseSlug: slug,
      },
    },
  };
  const atomData = { elements: [atom], paging: {}, linked: {} },
    relationData = { elements: [relation], paging: {}, linked: {} },
    groupData = {
      elements: [
        {
          id: groupId,
          questions: [definitionId],
          questionReferences: [{ authoringId: definitionId }],
        },
      ],
      paging: {},
    };
  const cml = (text) => ({
    typeName: "cml",
    definition: {
      dtdId: "assess/1",
      value: "<co-content><text>" + text + "</text></co-content>",
    },
  });
  const definitionData = {
    elements: [
      {
        id: definitionId,
        definition: {
          typeName: "textExactMatch",
          definition: {
            prompt: cml("Exact original attached-draft prompt"),
            options: [
              {
                id: "answer-1",
                answer: "Literal authored answer",
                isCorrect: true,
                feedback: cml("Authored feedback"),
              },
            ],
          },
        },
        validation: { definition: { isReadyForPublish: true } },
      },
    ],
    paging: {},
  };
  const observation = (data, resource, id, second) => ({
    data: structuredClone(data),
    sourceSha256: sha(data),
    receipt: {
      resource,
      id,
      status: 200,
      bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
      requestPath: `/api/${resource}/${id}`,
      requestQuery: [["includes", "_links"]],
      observedAt: `2026-10-19T10:00:${String(second).padStart(2, "0")}.000Z`,
      bytes: 456,
      originalResponseSha256: "f".repeat(64),
      sha256: "f".repeat(64),
      credentialFieldsRemoved: 0,
      credentialUrlsRedacted: 0,
    },
  });
  const bound = bindDirectPublishedDraftSnapshotV1(
    item,
    courseId,
    slug,
    material,
    atomData,
    relationData,
  );
  item.payload.directAuthoringDraftSnapshot = {
    schemaVersion: 1,
    method: "BOUND_PUBLISHED_ATOM_DRAFT_SNAPSHOT",
    sourceState: "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM",
    courseId,
    itemId: item.id,
    courseSlug: slug,
    atomId,
    contentId: item.contentId,
    publishedAssignmentId: pointer,
    sourceSha256: sha(directPublishedDraftSnapshotSourceV1(bound)),
    sourceStable: true,
    source: {
      material,
      initialAtom: observation(atomData, "authoringAtoms.v2", atomId, 0),
      relation: observation(
        relationData,
        "authoringItemContentRelations.v1",
        atomId,
        1,
      ),
      finalAtom: observation(atomData, "authoringAtoms.v2", atomId, 8),
    },
    inventory: directPublishedDraftSnapshotInventoryV1(bound),
    groups: [
      {
        id: groupId,
        initial: observation(
          groupData,
          "authoringAssignmentQuestionGroups.v1",
          groupId,
          2,
        ),
        final: observation(
          groupData,
          "authoringAssignmentQuestionGroups.v1",
          groupId,
          4,
        ),
      },
    ],
    definitions: [
      {
        id: definitionId,
        ...observation(
          definitionData,
          "authoringAssignmentMachineEvaluableQuestions.v1",
          definitionId,
          3,
        ),
      },
    ],
    failures: [],
    publishedContentVerified: false,
    contentCompletenessVerified: false,
    wholeItemVerified: false,
  };
  const view = courseraAuthoringDraftSnapshot(item, courseId);
  assert(view);
  const content = capturedContent(
    {},
    {
      basis: "Current published body remains unverified",
      itemId: item.id,
      url: `https://www.coursera.org/teach/${slug}/${courseId}/content/item/ungradedAssignment/${item.id}`,
    },
  );
  content.authoringDraftSnapshot = view;
  return { content, view, definitionId };
}
function fixture() {
  const date = "2026-10-01T00:00:00.000Z";
  const course = {
    id: "course",
    kind: "package",
    title: "Exact source course",
    packageId: "",
    version: 1,
    updatedAt: date,
    updatedBy: "owner",
    data: {
      assignmentPlan: { route: "COURSE", shellChangedAt: "" },
      scan: {
        fileSha256: "a".repeat(64),
        scannedAt: date,
        courseTree: [
          {
            id: "source-1",
            idref: "resource-1",
            title: "Literal source",
            type: "Reading",
            children: [],
            sourcePayload: { textSample: literal },
          },
          {
            id: "archive",
            title: "Archive",
            type: "Module",
            children: [
              {
                id: "source-2",
                idref: "resource-2",
                title: "Retained reference",
                type: "Reading",
                children: [],
                sourcePayload: { textSample: "Archived source text retained." },
              },
            ],
          },
        ],
      },
    },
  };
  const content = capturedContent(
    {
      textSample: literal,
      textConfidence: "high",
      textScopeKind: "item-body",
      structuredAssessment: {
        questions: [
          {
            id: "q1",
            type: "single-select",
            prompt: "Authored prompt?",
            options: [{ text: "Literal choice", correct: null }],
            answerEvidenceStatus: "NOT_OBSERVED",
          },
        ],
      },
    },
    { basis: "Exact native capture", capturedAt: date, itemId: "item-1" },
  );
  const audit = {
    id: "audit",
    kind: "audit",
    title: "Saved comparison",
    packageId: course.id,
    version: 1,
    updatedAt: "2026-10-02T00:00:00.000Z",
    updatedBy: "owner",
    data: {
      packageId: course.id,
      sourceScanSha256: course.data.scan.fileSha256,
      hashes: { json: "b".repeat(64), brightspace: "c".repeat(64) },
      report: "ORIGINAL UNRESOLVED FINDINGS",
      result: {
        success: true,
        stats: {
          extractorMeta: {
            page: {
              url: "https://www.coursera.org/teach/exact/NativeCourse/content/edit",
            },
          },
        },
        ownerView: {
          items: [
            {
              id: "item-1",
              name: "Native title",
              path: "Module 1",
              type: "Reading",
              status: "REVIEW",
              actions: [],
            },
            {
              id: "item-2",
              name: "Destination reference",
              path: "Archive",
              type: "Reading",
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
          { id: "item-1", name: "Native title", path: "Module 1", content },
        ],
        brightspace: [],
      },
    },
  };
  const f = {
    course,
    audit,
    records: [course, audit],
    reads: [],
    lists: 0,
    saves: 0,
  };
  f.store = {
    get: async (id) => {
      f.reads.push(id);
      const record = f.records.find((r) => r.id === id);
      if (!record) throw Error("Missing record " + id);
      return structuredClone(record);
    },
    list: async () => {
      f.lists++;
      return f.records.map(recordSummary);
    },
    save: async () => {
      f.saves++;
      throw Error("No writes authorized");
    },
  };
  f.artifact = () =>
    generateAssignmentDeliverable(f.course, f.audit, f.records, "content-map");
  f.prepare = (artifact = f.artifact(), signal) =>
    prepareAssignmentAgentHandoff(f.course, f.audit, artifact, f.store, signal);
  return f;
}
function review(f, relevance = "relevant") {
  const record = {
    id: "review",
    kind: "item-review",
    title: "Native title",
    packageId: f.course.id,
    version: 1,
    updatedAt: "2026-10-03T00:00:00.000Z",
    updatedBy: "owner",
    data: {
      auditId: f.audit.id,
      itemKey: "item:item-2",
      review: {
        status: "in_progress",
        note: "Explicit source scope decision.",
        relevance,
        updatedAt: "2026-10-03T00:00:00.000Z",
        updatedBy: "owner",
      },
    },
  };
  f.records.push(record);
  return record;
}
test("one read-only packet retains the complete original evidence, inventory and unchanged proposed-only artifact", async () => {
  const f = fixture(),
    before = structuredClone(f.records),
    artifact = f.artifact();
  artifact.members[0].proposed.title = "Proposed title only";
  const { packet, json } = await f.prepare(artifact),
    saved = JSON.parse(json);
  assert.equal(packet.kind, "CTI_ASSIGNMENT_AGENT_EVIDENCE_PACKET");
  assert.deepEqual(saved, packet);
  assert.deepEqual(packet.structuralArtifact, artifact);
  assert.deepEqual(f.records, before);
  assert.equal(f.saves, 0);
  assert.equal(packet.scope.entries.length, artifact.members.length);
  assert(packet.scope.entries.some((m) => m.nativeId === "source-2"));
  assert.deepEqual(
    packet.richEvidence.contentEvidence,
    f.audit.data.contentEvidence,
  );
  validateContentSnapshot(saved.richEvidence.contentEvidence);
  assert.equal(saved.richEvidence.followUp.contentEvidence, undefined);
  assert.equal(
    saved.richEvidence.followUp.contentEvidenceRef,
    "/richEvidence/contentEvidence",
  );
  validateContentSnapshot(saved.richEvidence.contentEvidence);
  assert.equal(
    packet.richEvidence.contentEvidence.coursera[0].content.questions[0].prompt,
    "Authored prompt?",
  );
  assert.deepEqual(
    packet.richEvidence.contentEvidence.coursera[0].content.questions[0]
      .options,
    f.audit.data.contentEvidence.coursera[0].content.questions[0].options,
  );
  assert.equal(
    packet.richEvidence.contentEvidence.coursera[0].content.text,
    literal,
  );
  assert.match(packet.ownerReport.text, /ORIGINAL UNRESOLVED FINDINGS/);
  assert.match(packet.ownerReport.text, /Authored prompt/);
  assert.equal(packet.agentInstructions.returnOnly, "structuralArtifact");
  assert.equal(
    packet.agentInstructions.generatedProposalsAreSourceOriginals,
    false,
  );
  assert.equal(packet.readiness.lmsApplicationVerified, false);
  assert.equal(packet.readiness.generatedOutputIsSource, false);
  assert.deepEqual(
    packet.originalArchives.map((a) => [a.platform, a.inputSha256]),
    [
      ["source-package", "a".repeat(64)],
      ["coursera", "b".repeat(64)],
      ["brightspace", "c".repeat(64)],
    ],
  );
  assert(
    packet.originalArchives.every((a) => a.requiredForOriginalBinaryReview),
  );
  assert.equal(packet.integrity.structuralArtifactSha256, sha(artifact));
  assert.equal(packet.integrity.richEvidenceSha256, sha(packet.richEvidence));
  assert.equal(
    packet.integrity.ownerReportTextSha256,
    textSha(packet.ownerReport.text),
  );
  const { packetSha256, ...rest } = packet.integrity;
  assert.equal(packetSha256, sha({ ...packet, integrity: rest }));
  assert.deepEqual(
    importAssignmentDeliverable(packet.structuralArtifact, f.artifact()),
    artifact,
  );
  assert.throws(
    () => importAssignmentDeliverable(packet, f.artifact()),
    /Unexpected|Invalid|schema|artifact/i,
  );
});
test("automatic reference folders are retained defaults, while only exact current owner overrides are labelled approved choices", async () => {
  const f = fixture(),
    automatic = (await f.prepare()).packet.scope;
  assert.equal(automatic.automaticDefaultsAreOwnerApproval, false);
  assert.equal(
    automatic.entries.find((m) => m.nativeId === "source-2").origin,
    "AUTOMATIC_DEFAULT",
  );
  assert.equal(
    automatic.entries.find((m) => m.nativeId === "source-2").includedInWorklist,
    false,
  );
  assert.equal(
    automatic.entries.find((m) => m.nativeId === "item-2").includedInWorklist,
    false,
  );
  review(f);
  const explicit = (await f.prepare()).packet.scope.entries,
    owned = explicit.find((m) => m.nativeId === "item-2");
  assert.equal(owned.origin, "OWNER_OVERRIDE");
  assert.equal(owned.includedInWorklist, true);
  assert.equal(owned.reviewRecordId, "review");
  assert.equal(
    explicit.find((m) => m.nativeId === "source-2").origin,
    "AUTOMATIC_DEFAULT",
    "destination decisions never silently approve source members",
  );
});
test("publisher originals and partial provenance survive JSON reload alongside native reading text", async () => {
  const f = fixture(),
    p = createInlinePublisherContentFixture({ keepHistoricalHtml: true });
  f.audit.data.contentEvidence = buildContentSnapshot(
    undefined,
    undefined,
    p.raw,
  );
  const expected = structuredClone(f.audit.data.contentEvidence),
    { packet, json } = await f.prepare();
  assert.deepEqual(packet.richEvidence.contentEvidence, expected);
  validateContentSnapshot(JSON.parse(json).richEvidence.contentEvidence);
  assert(
    json.includes(p.publisherRawJson.replaceAll('"', '\\"').slice(0, 80)) ||
      json.includes("CTI_BROWSER_PUBLISHER_CHAPTER"),
  );
  const content = packet.richEvidence.contentEvidence.coursera[0].content;
  assert.equal(content.textCoverage, "UNVERIFIED");
  assert.equal(content.questions.length, 0);
  assert.equal(
    content.inlineWidgetContent.providers[0].publisherPages[0].status,
    "CAPTURED_PUBLISHER_API_CHAPTER",
  );
  assert.equal(globalThis.__CTI_PUBLISHER_HTML_EXECUTED__, undefined);
});
test("attached published-item draft groups, authored keys, raw models and proof remain separate from primary questions", async () => {
  const f = fixture(),
    draft = publishedDraftContent();
  f.audit.data.contentEvidence.coursera[0].content = draft.content;
  const { packet, json } = await f.prepare(),
    saved = JSON.parse(json),
    content = saved.richEvidence.contentEvidence.coursera[0].content;
  validateContentSnapshot(saved.richEvidence.contentEvidence);
  assert.deepEqual(content.authoringDraftSnapshot, draft.view);
  assert.equal(content.questions.length, 0);
  assert.equal(content.questionCoverage, "UNVERIFIED");
  assert.equal(content.authoringDraftSnapshot.publishedContentVerified, false);
  assert.equal(content.authoringDraftSnapshot.wholeItemVerified, false);
  assert(json.includes(draft.definitionId));
  assert(json.includes("Literal authored answer"));
  assert.match(packet.ownerReport.text, /Exact original attached-draft prompt/);
  assert.equal(
    packet.structuralArtifact.members.find((m) => m.nativeId === "item-1")
      .retainedText,
    "",
  );
});
test("separate binary bodies are omitted with descriptors while literal base64 and raw JSON source strings stay exact", async () => {
  const f = fixture();
  f.audit.data.result.archivedFiles = [
    {
      sha256: "d".repeat(64),
      size: 3,
      mime: "image/png",
      base64: "AQID",
      body: new Uint8Array([1, 2, 3]),
    },
    {
      sha256: "e".repeat(64),
      size: 2,
      contentType: "image/png",
      bytes: [8, 9],
    },
    { sha256: "f".repeat(64), bytes: 123, mime: "image/png" },
  ];
  f.audit.data.result.rawJson = JSON.stringify({
    base64: "source-authored literal",
    url: "data:image/png;base64,AAAA",
  });
  f.audit.data.captureTransport = {
    json: { encoding: "zip", sha256: "9".repeat(64), bytes: 450000000 },
  };
  const { packet, json } = await f.prepare(),
    files = packet.richEvidence.comparison.result.archivedFiles;
  assert.equal(files[0].base64, undefined);
  assert.equal(files[0].body, undefined);
  assert.equal(files[0].sha256, "d".repeat(64));
  assert.equal(files[0].size, 3);
  assert.equal(files[1].bytes, undefined);
  assert.equal(files[2].bytes, 123);
  assert.deepEqual(
    packet.omissions.map((o) => o.path),
    [
      "/richEvidence/comparison/result/archivedFiles/0/base64",
      "/richEvidence/comparison/result/archivedFiles/0/body",
      "/richEvidence/comparison/result/archivedFiles/1/bytes",
    ],
  );
  assert.equal(packet.omissions[0].sourceSha256, "d".repeat(64));
  assert.equal(packet.omissions[0].declaredBytes, 3);
  assert.equal(
    packet.richEvidence.comparison.result.rawJson,
    f.audit.data.result.rawJson,
  );
  assert(json.includes("data:image/png;base64"));
  assert.equal(packet.agentInstructions.binaryBytesEmbedded, false);
});
test("all immutable structural evidence stays protected when proposals are handed back", async () => {
  for (const mutate of [
    (a) => (a.members[0].retainedText = "invented"),
    (a) => a.members.pop(),
    (a) => (a.inputHashes.json = "9".repeat(64)),
    (a) => a.auditVersion++,
    (a) => (a.sourceScanSha256 = "9".repeat(64)),
  ]) {
    const f = fixture(),
      a = f.artifact();
    mutate(a);
    await assert.rejects(f.prepare(a));
    assert.equal(f.saves, 0);
  }
});
test("a changed source or audit version before preparation rejects stale selection", async () => {
  for (const key of ["course", "audit"]) {
    const f = fixture(),
      artifact = f.artifact(),
      selected = structuredClone(f[key]);
    f[key].version++;
    await assert.rejects(
      prepareAssignmentAgentHandoff(
        key === "course" ? selected : f.course,
        key === "audit" ? selected : f.audit,
        artifact,
        f.store,
      ),
      /changed|Refresh/,
    );
  }
});
test("a newer audit or mismatched listing identity cannot silently replace the selected basis", async () => {
  const f = fixture();
  f.records.push({
    ...structuredClone(f.audit),
    id: "newer",
    updatedAt: "2026-10-03T00:00:00.000Z",
  });
  await assert.rejects(f.prepare(), /changed/);
  const g = fixture(),
    list = g.store.list;
  g.store.list = async () => {
    const rows = await list();
    rows.find((r) => r.id === "audit").version++;
    return rows;
  };
  await assert.rejects(g.prepare(), /changed/);
});
test("a relevant record changed, added or removed during preparation rejects the racy packet", async () => {
  for (const mode of ["version", "added", "removed"]) {
    const f = fixture(),
      r = review(f),
      list = f.store.list;
    f.store.list = async () => {
      const rows = await list();
      if (f.lists >= 4) {
        if (mode === "version") rows.find((x) => x.id === r.id).version++;
        if (mode === "added")
          rows.push({ ...recordSummary(r), id: "new-review" });
        if (mode === "removed") return rows.filter((x) => x.id !== r.id);
      }
      return rows;
    };
    await assert.rejects(f.prepare(), /changed|Refresh/);
    assert.equal(f.saves, 0);
  }
});
test("wrong final record identity is rejected even if its version happens to match", async () => {
  const f = fixture(),
    get = f.store.get;
  let reads = 0;
  f.store.get = async (id) => {
    const r = await get(id);
    if (id === "course" && ++reads === 2) r.id = "other-course";
    return r;
  };
  await assert.rejects(f.prepare(), /changed/);
});
test("exact hash-bound original supplements are included and a swapped supplement is rejected", async () => {
  const f = fixture(),
    supplement = {
      id: "supplement",
      kind: "operations",
      title: "Original content",
      packageId: f.course.id,
      version: 1,
      updatedAt: "2026-10-03T00:00:00Z",
      updatedBy: "owner",
      data: {
        type: "report-content",
        runId: f.audit.id,
        platform: "coursera",
        sourceHash: f.audit.data.hashes.json,
        contentEvidence: structuredClone(f.audit.data.contentEvidence),
      },
    };
  supplement.data.contentEvidence.coursera[0].content.text =
    "Recovered exact-input text";
  f.records.push(supplement);
  const supplementedAudit = {
      ...f.audit,
      data: {
        ...f.audit.data,
        contentEvidence: supplement.data.contentEvidence,
      },
    },
    artifact = generateAssignmentDeliverable(
      f.course,
      supplementedAudit,
      f.records,
      "content-map",
    );
  const { packet } = await f.prepare(artifact);
  assert.equal(
    packet.richEvidence.contentEvidence.coursera[0].content.text,
    "Recovered exact-input text",
  );
  supplement.data.sourceHash = "9".repeat(64);
  await assert.rejects(f.prepare(), /does not match|changed/);
});
test("cancelled work does not produce a packet or write records", async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(f.prepare(undefined, controller.signal), {
    name: "AbortError",
  });
  assert.equal(f.reads.length, 0);
  assert.equal(f.saves, 0);
  const g = fixture(),
    other = new AbortController(),
    get = g.store.get;
  g.store.get = async (id) => {
    const r = await get(id);
    other.abort();
    return r;
  };
  await assert.rejects(g.prepare(undefined, other.signal), {
    name: "AbortError",
  });
  assert.equal(g.saves, 0);
});
test("oversized rich evidence fails explicitly instead of truncating source text", async () => {
  const f = fixture();
  f.audit.data.result.opaqueOriginal = "x".repeat(
    MAX_ASSIGNMENT_AGENT_HANDOFF_BYTES + 1,
  );
  await assert.rejects(
    f.prepare(),
    /32 MiB|review limit|no content was truncated/,
  );
  assert.equal(f.saves, 0);
});
test("agent download UI uses read-only packet preparation and preserves existing revision import", () => {
  const source = readFileSync(
    new URL("../web/AssignmentDeliverables.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Download agent evidence packet/);
  assert.match(
    source,
    /prepareAssignmentAgentHandoff\(\s*course,\s*loaded.audit,\s*artifact,\s*store,\s*controller.signal,?\s*\)/,
  );
  assert.match(source, /selectedHistory/);
  assert.match(source, /importAssignmentDeliverable/);
  assert.match(source, /agentSelection.current === selection/);
  assert(/agentPreparation.current\s*\)\s*return/.test(source));
  assert.match(source, /currentAgentSelection/);
});
