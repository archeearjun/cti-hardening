import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleAuthorized } from "../server/api.ts";
import {
  assignmentItemId,
  buildAssignmentItems,
  appendLifecycleEvent,
  itemLifecycleRecordId,
  itemLifecycleState,
  itemDeliverableMemberships,
  lifecycleAuditWithContent,
  loadItemLifecycle,
  validateItemLifecycleData,
} from "../src/domain/item-lifecycle.ts";
import {
  validateRecord,
  validateWorkspaceTransition,
  validateOperationalReferences,
  prepareWorkspaceBackup,
} from "../src/domain/workspace-validation.ts";
import {
  digest,
  localStore,
  recordSummary,
} from "../src/domain/workspace-store.ts";
import { ownerReviewChangeDeclaration } from "../src/domain/owner-actions.ts";
import {
  assignmentDeliverableRecordId,
  deliverableArtifactHash,
  generateAssignmentDeliverable,
  makeAssignmentDeliverableData,
} from "../src/domain/assignment-deliverables.ts";
import {
  advisoryCandidatesFromAudit,
  createAdvisoryRecordData,
  reviewedMappingExample,
} from "../src/domain/advisory-learning.ts";
import {
  createAutomaticIngestionBasis,
  createIngestionAttemptRecord,
  currentIngestionAttempt,
} from "../src/domain/ingestion-attempts.ts";
import {
  assignmentBasis,
  evaluateAssignment,
  reconciliationCurrent,
} from "../src/domain/assignment-plan.ts";

function fixture() {
  const content = {
    basis: "Synthetic original",
    capturedAt: "2026-10-01T00:00:00Z",
    url: "",
    text: "Literal source content",
    textCoverage: "COMPLETE",
    textReason: "",
    questions: [],
    questionCoverage: "EMPTY",
    expectedQuestions: 0,
    questionReason: "",
    references: [],
    limitations: [],
  };
  const course = {
    id: "course",
    kind: "package",
    title: "Synthetic course",
    packageId: "",
    version: 1,
    updatedAt: "",
    updatedBy: "owner",
    data: {
      scan: {
        fileSha256: "a".repeat(64),
        stats: {},
        courseTree: [
          {
            id: "placement-1",
            idref: "resource",
            title: "Repeated",
            children: [],
          },
          {
            id: "placement-2",
            idref: "resource",
            title: "Repeated",
            children: [],
          },
        ],
      },
    },
  };
  const video =
    "https://fixture.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=00000001-0000-4000-8000-000000000001";
  const audit = {
    id: "audit",
    kind: "audit",
    title: "Synthetic comparison",
    packageId: course.id,
    version: 1,
    updatedAt: "",
    updatedBy: "owner",
    data: {
      generation: 0,
      sourceScanSha256: course.data.scan.fileSha256,
      hashes: { json: "b".repeat(64) },
      contentEvidence: {
        schemaVersion: 1,
        brightspace: [],
        coursera: [{ id: "a", name: "Repeated", path: "Module 1", content }],
      },
      result: {
        success: true,
        itemResults: [],
        ownerView: {
          items: [
            {
              id: "a",
              name: "Repeated",
              path: "Module 1",
              type: "Reading",
              status: "VERIFIED_EVIDENCE",
              pluginTargets: [video],
            },
            {
              id: "b",
              name: "Repeated",
              path: "Module 2",
              type: "Plugin",
              status: "REVIEW",
              pluginTargets: [video + "&autoplay=false"],
            },
            { name: "No native identity", path: "Module 3" },
          ],
          unmappedSource: [],
        },
      },
    },
  };
  return { course, audit };
}
function memoryStore(rows) {
  const records = new Map(rows.map((r) => [r.id, structuredClone(r)]));
  return {
    role: "admin",
    email: "owner",
    mode: "local",
    records,
    async list() {
      return [...records.values()].map(recordSummary);
    },
    async get(id) {
      const r = records.get(id);
      if (!r) throw Error("Record not found.");
      return structuredClone(r);
    },
    async save(r) {
      validateRecord(r);
      const prior = records.get(r.id);
      if ((prior?.version || 0) !== r.version)
        throw Error("Another change was saved.");
      validateWorkspaceTransition(prior, r);
      await validateOperationalReferences(
        r,
        async (id) => records.get(id),
        prior,
        [...records.values()],
      );
      const saved = { ...structuredClone(r), version: r.version + 1 };
      records.set(r.id, saved);
      return saved;
    },
  };
}

test("durable placement identity survives labels/order while reused recordings and resources share asset identity", () => {
  const { course, audit } = fixture(),
    items = buildAssignmentItems(course, audit);
  assert.equal(
    items.length,
    4,
    "native-IDless inventory rows stay exceptions, not invented durable items",
  );
  const a = items.find((i) => i.nativeId === "a"),
    b = items.find((i) => i.nativeId === "b");
  assert.notEqual(a.id, b.id);
  assert.equal(
    a.assets[0].id,
    b.assets[0].id,
    "one recording supports two distinct placements",
  );
  const source = items.filter((i) => i.platform === "source");
  assert.notEqual(source[0].id, source[1].id);
  assert.equal(source[0].assets[0].id, source[1].assets[0].id);
  audit.data.result.ownerView.items.reverse();
  audit.data.result.ownerView.items[2].name = "Renamed";
  assert.deepEqual(
    buildAssignmentItems(course, audit)
      .map((i) => i.id)
      .sort(),
    items.map((i) => i.id).sort(),
  );
  assert.notEqual(assignmentItemId("other-course", "coursera", "a"), a.id);
});

test("native duplicate identities are ambiguous and cannot receive owner decisions", async () => {
  const { course, audit } = fixture();
  audit.data.result.ownerView.items.push({ id: "a", name: "Other" });
  const item = buildAssignmentItems(course, audit).find(
      (i) => i.nativeId === "a",
    ),
    store = memoryStore([course, audit]);
  assert.equal(item.identityStatus, "ambiguous");
  await assert.rejects(
    appendLifecycleEvent(store, course, audit, item, {
      kind: "decision",
      decision: "checked",
      note: "Checked the original source.",
    }),
    /ambiguous/,
  );
});

test("checked decisions are evidence-bound, stage/history remain, and stale ledgers cannot overwrite appended events", async () => {
  const { course, audit } = fixture();
  audit.data.hashes.brightspace = "";
  audit.data.hashes.recovery = "";
  const store = memoryStore([course, audit]),
    item = buildAssignmentItems(course, audit)[0];
  let ledger = await appendLifecycleEvent(store, course, audit, item, {
    kind: "stage",
    stage: "verification",
    note: "Ready for verification.",
  });
  const first = structuredClone(ledger);
  ledger = await appendLifecycleEvent(
    store,
    course,
    audit,
    item,
    {
      kind: "decision",
      decision: "checked",
      note: "Checked the literal content and source.",
    },
    ledger,
  );
  assert.equal(itemLifecycleState(item, ledger).decision, "checked");
  assert.equal(itemLifecycleState(item, ledger).stage, "verification");
  const changed = structuredClone(audit);
  changed.id = "audit-next";
  changed.data.hashes.json = "c".repeat(64);
  const nextItem = buildAssignmentItems(course, changed).find(
      (i) => i.id === item.id,
    ),
    state = itemLifecycleState(nextItem, ledger);
  assert.equal(state.decision, "open");
  assert.equal(state.freshness, "changed");
  assert.equal(state.history.length, 2);
  assert.equal(state.stage, "verification");
  await assert.rejects(
    appendLifecycleEvent(
      store,
      course,
      audit,
      item,
      { kind: "stage", stage: "delivery", note: "Attempt stale edit." },
      first,
    ),
    /Another change/,
  );
  assert.deepEqual(await loadItemLifecycle(store, course.id), ledger);
  const summary = recordSummary(ledger);
  assert.equal(summary.data.eventCount, 2);
  assert.equal(summary.data.events, undefined);
});

test("append-only transition checks reject rewrite, prune, reorder and course/type mutation", async () => {
  const { course, audit } = fixture(),
    store = memoryStore([course, audit]),
    item = buildAssignmentItems(course, audit)[0];
  let ledger = await appendLifecycleEvent(store, course, audit, item, {
    kind: "stage",
    stage: "reconciliation",
    note: "Begin.",
  });
  ledger = await appendLifecycleEvent(
    store,
    course,
    audit,
    item,
    {
      kind: "decision",
      decision: "blocked",
      note: "Provider access remains unresolved.",
    },
    ledger,
  );
  for (const mutate of [
    (r) => r.data.events.pop(),
    (r) => r.data.events.reverse(),
    (r) => (r.data.events[0].note = "rewritten"),
    (r) => (r.packageId = "other"),
    (r) => (r.data.type = "catalog"),
  ]) {
    const next = structuredClone(ledger);
    mutate(next);
    assert.throws(
      () => validateWorkspaceTransition(ledger, next),
      /append-only|cannot change|Invalid lifecycle/,
    );
  }
  const next = structuredClone(ledger);
  next.data.events.push({
    ...next.data.events[1],
    eventId: "new",
    sequence: 3,
  });
  validateWorkspaceTransition(ledger, next);
  next.data.events[2].basis.inputHashes.json = "d".repeat(64);
  await assert.rejects(
    validateOperationalReferences(
      next,
      async (id) => store.records.get(id),
      ledger,
    ),
    /hashes/,
  );
  const bad = structuredClone(ledger.data);
  bad.events[0].itemId = assignmentItemId(course.id, "coursera", "other");
  assert.throws(() => validateItemLifecycleData(bad), /identity/);
});

test("exact mapping records support one-to-many and reject cross-course or invented item IDs", async () => {
  const { course, audit } = fixture(),
    store = memoryStore([course, audit]),
    item = buildAssignmentItems(course, audit)[0];
  const ledger = await appendLifecycleEvent(store, course, audit, item, {
    kind: "mapping-confirmed",
    mapping: {
      sourceIds: ["placement-1"],
      destinationIds: ["a", "b"],
      relation: "one-to-many",
    },
    note: "One source lesson split into these exact items.",
  });
  assert.equal(
    itemLifecycleState(item, ledger).mappings[0].mapping.destinationIds.length,
    2,
  );
  await assert.rejects(
    appendLifecycleEvent(
      store,
      course,
      audit,
      item,
      {
        kind: "mapping-confirmed",
        mapping: {
          sourceIds: ["foreign-source"],
          destinationIds: ["a"],
          relation: "one-to-one",
        },
        note: "Invalid source mapping.",
      },
      ledger,
    ),
    /exact source/,
  );
});

test("mapping receipts cannot cover an unrelated item or an ambiguous native identity", async () => {
  for (const mode of ["unrelated", "ambiguous", "cross-platform-id"]) {
    const { course, audit } = fixture();
    if (mode === "ambiguous")
      course.data.scan.courseTree.push(
        structuredClone(course.data.scan.courseTree[0]),
      );
    if (mode === "cross-platform-id")
      audit.data.contentEvidence.brightspace.push({
        ...structuredClone(audit.data.contentEvidence.coursera[0]),
        id: "placement-1",
      });
    const item = buildAssignmentItems(course, audit).find(
        (row) => row.nativeId === "a",
      ),
      store = memoryStore([course, audit]);
    await assert.rejects(
      appendLifecycleEvent(store, course, audit, item, {
        kind: "mapping-confirmed",
        note: "This receipt must name this exact, unambiguous item.",
        mapping: {
          sourceIds: ["placement-1"],
          destinationIds: [mode === "unrelated" ? "b" : "a"],
          relation: "one-to-one",
        },
      }),
      /exact source/,
    );
  }
});

test("a lifecycle receipt records one kind of change and the current source identity", async () => {
  const { course, audit } = fixture(),
    store = memoryStore([course, audit]),
    item = buildAssignmentItems(course, audit)[0];
  await assert.rejects(
    appendLifecycleEvent(store, course, audit, item, {
      kind: "stage",
      stage: "delivery",
      decision: "checked",
      note: "A stage cannot silently approve content.",
    }),
    /one kind/,
  );
  store.records.get(course.id).data.scan.fileSha256 = "d".repeat(64);
  await assert.rejects(
    appendLifecycleEvent(store, course, audit, item, {
      kind: "decision",
      decision: "checked",
      note: "The source changed after this report was recorded.",
    }),
    /source hash|evidence changed/,
  );
});

test("membership receipts agree with the retained deliverable's item inclusion", async () => {
  const { course, audit } = fixture(),
    artifact = generateAssignmentDeliverable(
      course,
      audit,
      [course, audit],
      "content-map",
    );
  const data = makeAssignmentDeliverableData(
    artifact,
    [],
    "draft",
    "",
    "owner",
  );
  const deliverable = {
    id: assignmentDeliverableRecordId(data.deliverableId, 1),
    kind: "operations",
    packageId: course.id,
    data,
    version: 1,
  };
  const item = buildAssignmentItems(course, audit)[0],
    store = memoryStore([course, audit, deliverable]);
  await assert.rejects(
    appendLifecycleEvent(store, course, audit, item, {
      kind: "membership",
      note: "Cannot remove an included member by rewriting its receipt.",
      membership: {
        deliverableId: data.deliverableId,
        revision: 1,
        kind: "content-map",
        memberId: item.id,
        state: "removed",
      },
    }),
    /exact item/,
  );
});

test("source gaps and capture coverage never become fidelity approval from workflow decisions", async () => {
  const { course, audit } = fixture();
  audit.data.contentEvidence.coursera[0].content.limitations.push(
    "Original image bytes were not captured.",
  );
  const item = buildAssignmentItems(course, audit)[0],
    store = memoryStore([course, audit]);
  const ledger = await appendLifecycleEvent(store, course, audit, item, {
    kind: "decision",
    decision: "checked",
    note: "I documented the remaining original-media gap.",
  });
  assert.equal(item.captureCoverage, "partial");
  assert.equal(itemLifecycleState(item, ledger).decision, "checked");
  assert.equal(
    buildAssignmentItems(course, audit)[0].captureCoverage,
    "partial",
  );
});

test("original-content supplements use the same exact report-bound evidence for UI and persistence", async () => {
  const { course, audit } = fixture(),
    snapshot = audit.data.contentEvidence;
  delete audit.data.contentEvidence;
  const supplement = {
    id:
      "report-content-" +
      (await digest(
        new TextEncoder().encode(JSON.stringify([audit.id, "coursera"])),
      )),
    kind: "operations",
    title: "Original content",
    packageId: course.id,
    version: 1,
    updatedAt: "",
    updatedBy: "owner",
    data: {
      type: "report-content",
      runId: audit.id,
      platform: "coursera",
      sourceHash: audit.data.hashes.json,
      contentEvidence: snapshot,
    },
  };
  const store = memoryStore([course, audit, supplement]);
  const enriched = await lifecycleAuditWithContent(audit, async (id) =>
    store.records.get(id),
  );
  const item = buildAssignmentItems(course, enriched)[0];
  const ledger = await appendLifecycleEvent(store, course, enriched, item, {
    kind: "decision",
    decision: "checked",
    note: "Checked original input recovered for this exact report.",
  });
  assert.equal(itemLifecycleState(item, ledger).decision, "checked");
  store.records.get(supplement.id).data.sourceHash = "d".repeat(64);
  await assert.rejects(
    lifecycleAuditWithContent(audit, async (id) => store.records.get(id)),
    /supplement/,
  );
});

test("map and outline membership is derived separately from work stage and owner approval", () => {
  const { course, audit } = fixture(),
    item = buildAssignmentItems(course, audit)[0];
  const artifact = generateAssignmentDeliverable(
    course,
    audit,
    [course, audit],
    "content-map",
  );
  const data = makeAssignmentDeliverableData(
    artifact,
    [],
    "draft",
    "",
    "owner",
  );
  const record = {
    id: assignmentDeliverableRecordId(data.deliverableId, 1),
    kind: "operations",
    packageId: course.id,
    data,
  };
  const state = itemLifecycleState(item, null, [record]);
  assert.equal(state.stage, "inventory");
  assert.equal(state.decision, "open");
  assert.equal(state.memberships.length, 1);
  assert.equal(itemDeliverableMemberships(item, [record])[0].event, "draft");
  const removed = structuredClone(record);
  removed.data.revision = 2;
  removed.data.artifact.members.find(
    (m) => m.memberId === item.id,
  ).proposed.action = "omit";
  assert.equal(
    itemLifecycleState(item, null, [record, removed]).memberships.length,
    0,
  );
});

function apiFixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    fs.readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  let beforeBatch;
  class Statement {
    constructor(query, args = []) {
      this.query = query;
      this.args = args;
    }
    bind(...args) {
      return new Statement(
        this.query,
        args.map((a) => (a instanceof ArrayBuffer ? new Uint8Array(a) : a)),
      );
    }
    async first() {
      return sql.prepare(this.query).get(...this.args) || null;
    }
    async all() {
      return { results: sql.prepare(this.query).all(...this.args) };
    }
    async run() {
      return {
        meta: {
          changes: Number(sql.prepare(this.query).run(...this.args).changes),
        },
      };
    }
  }
  const db = {
    prepare: (query) => new Statement(query),
    async batch(statements) {
      const hook = beforeBatch;
      beforeBatch = undefined;
      hook?.();
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const call = async (
    path,
    method = "GET",
    body,
    actor = { role: "admin", email: "owner" },
  ) => {
    try {
      return await handleAuthorized(
        new Request("https://cti.example.test/api/" + path, {
          method,
          body,
          headers: { Origin: "https://cti.example.test" },
        }),
        db,
        actor,
      );
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status || 500,
      });
    }
  };
  const prepareSave = async (
    record,
    { summary = recordSummary(record), actor } = {},
  ) => {
    const bytes = new TextEncoder().encode(JSON.stringify(record.data));
    const prepare = await call(
      "uploads",
      "POST",
      JSON.stringify({
        record: summary,
        bytes: bytes.length,
        parts: 1,
        sha256: await digest(bytes),
      }),
      actor,
    );
    if (!prepare.ok) return { response: prepare };
    const { id } = await prepare.json();
    assert.equal(
      (await call("uploads/" + id + "/chunks/0", "PUT", bytes, actor)).status,
      200,
    );
    return {
      response: prepare,
      commit: () => call("uploads/" + id + "/commit", "POST", "{}", actor),
    };
  };
  const save = async (record, options) => {
    const pending = await prepareSave(record, options);
    return pending.commit ? pending.commit() : pending.response;
  };
  return {
    sql,
    call,
    save,
    prepareSave,
    setBeforeBatch(hook) {
      beforeBatch = hook;
    },
  };
}
test("shared commit independently enforces immutable history, exact audit hashes and stale versions", async () => {
  const { course, audit } = fixture(),
    memory = memoryStore([course, audit]),
    item = buildAssignmentItems(course, audit)[0];
  const ledger = await appendLifecycleEvent(memory, course, audit, item, {
    kind: "decision",
    decision: "checked",
    note: "Checked against the literal source.",
  });
  const api = apiFixture();
  for (const record of [course, audit, ledger]) {
    const response = await api.save({ ...record, version: 0 });
    assert.equal(response.status, 200, await response.text());
  }
  const tampered = structuredClone(ledger);
  tampered.data.events[0].note = "Attempt rewrite.";
  let response = await api.save(tampered);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /append-only/);
  const wrong = structuredClone(ledger);
  wrong.data.events.push({
    ...wrong.data.events[0],
    sequence: 2,
    eventId: "second",
    basis: {
      ...wrong.data.events[0].basis,
      inputHashes: { json: "f".repeat(64) },
    },
  });
  response = await api.save(wrong);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /hashes/);
  const correct = structuredClone(ledger);
  correct.data.events.push({
    ...correct.data.events[0],
    sequence: 2,
    eventId: "correct",
  });
  response = await api.save(correct);
  assert.equal(response.status, 200, await response.text());
  response = await api.save(correct);
  assert.equal(response.status, 409);
  assert.equal(
    api.sql
      .prepare("SELECT version FROM documents WHERE id=?")
      .get(itemLifecycleRecordId(course.id)).version,
    2,
  );
  api.sql.close();
});

test("a concurrent course revision atomically blocks lifecycle commit after its references were validated", async () => {
  const { course, audit } = fixture(),
    memory = memoryStore([course, audit]),
    item = buildAssignmentItems(course, audit)[0],
    api = apiFixture();
  const ledger = await appendLifecycleEvent(memory, course, audit, item, {
    kind: "decision",
    decision: "checked",
    note: "Checked against the literal source.",
  });
  for (const record of [course, audit])
    assert.equal((await api.save({ ...record, version: 0 })).status, 200);
  api.setBeforeBatch(() =>
    api.sql
      .prepare("UPDATE documents SET version=version+1 WHERE id=?")
      .run(course.id),
  );
  const response = await api.save({ ...ledger, version: 0 });
  assert.equal(response.status, 409);
  assert.equal(
    api.sql
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
      .get(ledger.id).count,
    0,
  );
  api.sql.close();
});

function insertConcurrentSummary(api, record) {
  api.sql
    .prepare(
      "INSERT INTO documents(id,kind,title,package_id,version,revision,updated_at,updated_by,summary) VALUES(?,?,?,?,1,?,?,?,?)",
    )
    .run(
      record.id,
      record.kind,
      record.title || "Concurrent evidence",
      record.packageId,
      "concurrent",
      "2026-10-02T00:00:00Z",
      "owner",
      JSON.stringify(record.data),
    );
}
test("a concurrently added original-content supplement invalidates the checked evidence basis atomically", async () => {
  const { course, audit } = fixture(),
    memory = memoryStore([course, audit]),
    api = apiFixture();
  const ledger = await appendLifecycleEvent(
    memory,
    course,
    audit,
    buildAssignmentItems(course, audit)[0],
    {
      kind: "decision",
      decision: "checked",
      note: "Checked the evidence before its supplement appeared.",
    },
  );
  for (const record of [course, audit])
    assert.equal((await api.save({ ...record, version: 0 })).status, 200);
  const supplementId =
    "report-content-" +
    (await digest(
      new TextEncoder().encode(JSON.stringify([audit.id, "coursera"])),
    ));
  api.setBeforeBatch(() =>
    insertConcurrentSummary(api, {
      id: supplementId,
      kind: "operations",
      packageId: course.id,
      data: { type: "report-content" },
    }),
  );
  assert.equal((await api.save({ ...ledger, version: 0 })).status, 409);
  assert.equal(
    api.sql
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
      .get(ledger.id).count,
    0,
  );
  api.sql.close();
});

test("a new concurrent item review cannot commit a deliverable from an obsolete assignment basis", async () => {
  const { course, audit } = fixture(),
    api = apiFixture();
  for (const record of [course, audit])
    assert.equal((await api.save({ ...record, version: 0 })).status, 200);
  const artifact = generateAssignmentDeliverable(
      course,
      audit,
      [course, audit],
      "content-map",
    ),
    data = makeAssignmentDeliverableData(artifact, [], "draft", "", "owner");
  const record = {
    id: assignmentDeliverableRecordId(data.deliverableId, 1),
    kind: "operations",
    title: "Content map",
    packageId: course.id,
    data,
    version: 0,
    updatedAt: "",
    updatedBy: "",
  };
  api.setBeforeBatch(() =>
    insertConcurrentSummary(api, {
      id: "new-owner-review",
      kind: "item-review",
      packageId: course.id,
      data: { auditId: audit.id },
    }),
  );
  assert.equal((await api.save(record)).status, 409);
  assert.equal(
    api.sql
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
      .get(record.id).count,
    0,
  );
  api.sql.close();
});

for (const change of ["insert", "edit"]) {
  test(`a concurrent historical item review ${change} cannot approve a pre-edit assignment basis`, async () => {
    const { course, audit } = fixture();
    audit.id = "audit-current";
    audit.data.result.ownerView.items =
      audit.data.result.ownerView.items.filter((item) => item.id);
    const historicalAudit = { ...structuredClone(audit), id: "audit-before" };
    const review = {
      id: "historical-owner-review",
      kind: "item-review",
      title: "Earlier report outcome",
      packageId: course.id,
      version: 0,
      updatedAt: "",
      updatedBy: "owner",
      data: {
        auditId: historicalAudit.id,
        itemKey: "item:a",
        review: {
          status: "checked",
          note: "Checked this item in the earlier comparison.",
          updatedAt: "2026-10-01T00:00:00Z",
          updatedBy: "owner",
        },
      },
    };
    const api = apiFixture();
    try {
      for (const record of [course, historicalAudit, audit]) {
        const response = await api.save({ ...record, version: 0 });
        assert.equal(response.status, 200, await response.text());
      }
      if (change === "edit") {
        const response = await api.save(review);
        assert.equal(response.status, 200, await response.text());
      }
      const artifact = generateAssignmentDeliverable(
        course,
        audit,
        [
          course,
          historicalAudit,
          audit,
          ...(change === "edit" ? [review] : []),
        ],
        "content-map",
      );
      const draftData = makeAssignmentDeliverableData(
        artifact,
        [],
        "draft",
        "",
        "owner",
      );
      const draft = {
        id: assignmentDeliverableRecordId(draftData.deliverableId, 1),
        kind: "operations",
        title: "Content map",
        packageId: course.id,
        data: draftData,
        version: 0,
        updatedAt: "",
        updatedBy: "owner",
      };
      const draftResponse = await api.save(draft);
      assert.equal(draftResponse.status, 200, await draftResponse.text());
      const approvalData = makeAssignmentDeliverableData(
        artifact,
        [draft],
        "approved",
        "Approved this exact map against its saved comparison.",
        "owner",
      );
      const approval = {
        ...draft,
        id: assignmentDeliverableRecordId(approvalData.deliverableId, 2),
        data: approvalData,
      };
      const changedReview = structuredClone(review);
      changedReview.data.review.status = "changed";
      changedReview.data.review.changeDeclaredAt = new Date().toISOString();
      api.setBeforeBatch(() => {
        if (change === "insert") insertConcurrentSummary(api, changedReview);
        else
          api.sql
            .prepare(
              "UPDATE documents SET version=version+1,summary=? WHERE id=?",
            )
            .run(JSON.stringify(recordSummary(changedReview).data), review.id);
      });
      const response = await api.save(approval);
      assert.equal(response.status, 409, await response.text());
      assert.equal(
        api.sql
          .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
          .get(approval.id).count,
        0,
      );
      assert.equal(
        api.sql
          .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
          .get(draft.id).count,
        1,
        "the previously saved draft remains intact",
      );
    } finally {
      api.sql.close();
    }
  });
}

test("a new concurrent report-content record cannot commit a deliverable from an obsolete supplement basis", async () => {
  const { course, audit } = fixture(),
    api = apiFixture();
  for (const record of [course, audit])
    assert.equal((await api.save({ ...record, version: 0 })).status, 200);
  const artifact = generateAssignmentDeliverable(
      course,
      audit,
      [course, audit],
      "content-map",
    ),
    data = makeAssignmentDeliverableData(artifact, [], "draft", "", "owner");
  const record = {
    id: assignmentDeliverableRecordId(data.deliverableId, 1),
    kind: "operations",
    title: "Content map",
    packageId: course.id,
    data,
    version: 0,
    updatedAt: "",
    updatedBy: "",
  };
  // Count every report-bound supplement used by assignmentBasis, not only the
  // canonical ID whose absence is already checked by the content reader.
  api.setBeforeBatch(() =>
    insertConcurrentSummary(api, {
      id: "historical-content-supplement",
      kind: "operations",
      packageId: course.id,
      data: {
        type: "report-content",
        runId: audit.id,
        platform: "coursera",
        sourceHash: audit.data.hashes.json,
      },
    }),
  );
  assert.equal((await api.save(record)).status, 409);
  assert.equal(
    api.sql
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
      .get(record.id).count,
    0,
  );
  api.sql.close();
});

// This transaction fake deliberately closes request scheduling when a callback
// returns. Awaiting validation after getAll therefore cannot silently pass on
// platforms that auto-commit an idle IndexedDB transaction.
function strictIndexedDb(initial, beforeWrite = () => {}) {
  const tables = new Map([
    ["records", new Map(initial.map((row) => [row.id, structuredClone(row)]))],
    ["versions", new Map()],
  ]);
  let writes = 0;
  const db = {
    transaction(names, mode) {
      if (mode === "readwrite") {
        beforeWrite(tables);
        writes++;
      }
      const writable = mode === "readwrite",
        working = new Map(
          [...tables].map(([name, rows]) => [name, new Map(rows)]),
        );
      let active = true,
        pending = 0,
        finished = false;
      const tx = {
        objectStore(name) {
          const rows = working.get(name);
          const request = (operation) => {
            if (!active || finished) throw Error("TransactionInactiveError");
            const req = {};
            pending++;
            setImmediate(() => {
              if (finished) return;
              active = true;
              pending--;
              req.result = structuredClone(operation());
              req.onsuccess?.();
              active = false;
              if (!pending && !finished)
                setImmediate(() => {
                  if (pending || finished) return;
                  finished = true;
                  if (writable)
                    for (const [name, values] of working)
                      tables.set(name, values);
                  tx.oncomplete?.();
                });
            });
            return req;
          };
          return {
            get: (key) => request(() => rows.get(key)),
            getAll: () => request(() => [...rows.values()]),
            put: (row) =>
              request(() => {
                rows.set(
                  name === "versions" ? row.key : row.id,
                  structuredClone(row),
                );
                return row.id;
              }),
          };
        },
        abort() {
          finished = true;
          tx.onabort?.();
        },
      };
      return tx;
    },
  };
  return {
    tables,
    get writes() {
      return writes;
    },
    open() {
      const req = { result: db };
      setImmediate(() => req.onsuccess?.());
      return req;
    },
  };
}
test("local item outcome writes preserve changed declarations and reject stale checked saves that erase them", async () => {
  const previous = globalThis.indexedDB;
  try {
    const { course, audit } = fixture();
    const changed = {
      id: "owner-outcome-local",
      kind: "item-review",
      title: "Owner outcome",
      packageId: course.id,
      version: 1,
      updatedAt: "2026-10-03T00:00:00.000Z",
      updatedBy: "Owner",
      data: {
        auditId: audit.id,
        itemKey: "item:a",
        review: {
          status: "changed",
          note: "Edited this exact Coursera item in the source shell.",
          updatedAt: "2026-10-03T00:00:00.000Z",
          updatedBy: "Owner",
          changeDeclaredAt: "2026-10-03T00:00:00.000Z",
        },
      },
    };
    const fake = strictIndexedDb([course, audit, changed]);
    globalThis.indexedDB = fake;
    const store = localStore();
    const erased = structuredClone(changed);
    erased.data.review.status = "checked";
    delete erased.data.review.changeDeclaredAt;
    await assert.rejects(store.save(erased), /declaration cannot be cleared/);
    assert.equal(fake.tables.get("records").get(changed.id).version, 1);
    const checked = structuredClone(changed);
    checked.data.review.status = "checked";
    checked.data.review.changeDeclaredAt = ownerReviewChangeDeclaration(
      changed,
      "checked",
      new Date().toISOString(),
    );
    const saved = await store.save(checked);
    assert.equal(saved.version, 2);
    assert.equal(
      saved.data.review.changeDeclaredAt,
      changed.data.review.changeDeclaredAt,
    );
    assert.equal((await store.versions(changed.id)).length, 1);
  } finally {
    globalThis.indexedDB = previous;
  }
});

test("shared item outcome commits reject erased edit receipts and recompute untrusted listing summaries", async () => {
  const { course, audit } = fixture();
  const api = apiFixture();
  try {
    for (const record of [course, audit]) {
      const response = await api.save({ ...record, version: 0 });
      assert.equal(response.status, 200, await response.text());
    }
    const changed = {
      id: "owner-outcome-api",
      kind: "item-review",
      title: "Owner outcome",
      packageId: course.id,
      version: 0,
      updatedAt: "",
      updatedBy: "Owner",
      data: {
        auditId: audit.id,
        itemKey: "item:a",
        review: {
          status: "changed",
          note: "Edited this exact Coursera item in the source shell.",
          updatedAt: "2026-10-03T00:00:00.000Z",
          updatedBy: "Owner",
          changeDeclaredAt: "2026-10-03T00:00:00.000Z",
        },
      },
    };
    const initialResponse = await api.save(changed);
    assert.equal(
      initialResponse.status,
      200,
      await initialResponse.clone().text(),
    );
    const service = (await initialResponse.json()).record;
    const original = {
      ...changed,
      version: service.version,
      updatedAt: service.updatedAt,
    };
    const erased = structuredClone(original);
    erased.data.review.status = "checked";
    delete erased.data.review.changeDeclaredAt;
    const rejected = await api.save(erased);
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /declaration cannot be cleared/);
    const checked = structuredClone(original);
    checked.data.review.status = "checked";
    checked.data.review.changeDeclaredAt = ownerReviewChangeDeclaration(
      original,
      "checked",
      new Date().toISOString(),
    );
    const bytes = new TextEncoder().encode(JSON.stringify(checked.data));
    const forgedSummary = recordSummary(checked);
    delete forgedSummary.data.review.changeDeclaredAt;
    const prepared = await api.call(
      "uploads",
      "POST",
      JSON.stringify({
        record: forgedSummary,
        bytes: bytes.length,
        parts: 1,
        sha256: await digest(bytes),
      }),
    );
    assert.equal(prepared.status, 200);
    const { id } = await prepared.json();
    assert.equal(
      (await api.call("uploads/" + id + "/chunks/0", "PUT", bytes)).status,
      200,
    );
    const committed = await api.call("uploads/" + id + "/commit", "POST", "{}");
    assert.equal(committed.status, 200, await committed.clone().text());
    const listing = JSON.parse(
      api.sql
        .prepare("SELECT summary FROM documents WHERE id=?")
        .get(changed.id).summary,
    );
    assert.equal(
      listing.review.changeDeclaredAt,
      checked.data.review.changeDeclaredAt,
    );
    const rebound = structuredClone(checked);
    rebound.version = 2;
    rebound.data.itemKey = "item:another";
    const reboundResponse = await api.save(rebound);
    assert.equal(reboundResponse.status, 400);
    assert.match(await reboundResponse.text(), /item identity/);
  } finally {
    api.sql.close();
  }
});
test("local lifecycle validation finishes before the write transaction and rechecks concurrent references", async () => {
  const previous = globalThis.indexedDB;
  try {
    const { course, audit } = fixture(),
      item = buildAssignmentItems(course, audit)[0];
    const fake = strictIndexedDb([course, audit]);
    globalThis.indexedDB = fake;
    const store = localStore(),
      saved = await appendLifecycleEvent(store, course, audit, item, {
        kind: "decision",
        decision: "checked",
        note: "Checked through an auto-closing local transaction.",
      });
    assert.equal(saved.version, 1);
    assert.equal((await store.get(saved.id)).data.events.length, 1);
    assert.equal((await store.versions(saved.id)).length, 1);
    const racing = strictIndexedDb([course, audit], (tables) => {
      const changed = structuredClone(tables.get("records").get(course.id));
      changed.version++;
      tables.get("records").set(course.id, changed);
    });
    globalThis.indexedDB = racing;
    await assert.rejects(
      appendLifecycleEvent(localStore(), course, audit, item, {
        kind: "decision",
        decision: "checked",
        note: "The concurrent course edit must block this write.",
      }),
      /changed during validation/,
    );
    assert.equal(
      racing.tables.get("records").has(itemLifecycleRecordId(course.id)),
      false,
    );
    assert.equal(racing.tables.get("versions").size, 0);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});

async function saveIngestionFixture(api, records) {
  const saved = [];
  for (const record of records) {
    const response = await api.save({ ...record, version: 0 });
    assert.equal(response.status, 200, await response.clone().text());
    const { record: metadata } = await response.json();
    saved.push({
      ...record,
      version: metadata.version,
      updatedAt: metadata.updatedAt,
      updatedBy: metadata.updatedBy,
    });
  }
  return saved;
}

function modernIngestionBackup() {
  const { course, audit } = fixture();
  course.updatedAt = "2026-10-01T00:00:00.000Z";
  audit.updatedAt = "2026-10-03T00:00:00.000Z";
  audit.data.automaticIngestion = createAutomaticIngestionBasis(course.id, [
    course,
  ]);
  audit.data.result.stats = {
    extractorMeta: { capturedAt: "2026-10-01T00:00:00.000Z" },
  };
  const receipt = createIngestionAttemptRecord(
    course,
    [course, audit],
    "original owner",
    "2026-09-29T00:00:00.000Z",
  );
  receipt.version = 1;
  receipt.updatedAt = "2026-10-04T00:00:00.000Z";
  const nextAudit = structuredClone(audit);
  nextAudit.id = "audit-after-ingestion";
  nextAudit.updatedAt = "2026-10-06T00:00:00.000Z";
  nextAudit.data.generation = 1;
  nextAudit.data.hashes.json = "c".repeat(64);
  nextAudit.data.result.stats.extractorMeta.capturedAt =
    "2026-10-05T00:00:00.000Z";
  nextAudit.data.automaticIngestion = createAutomaticIngestionBasis(course.id, [
    course,
    audit,
    receipt,
  ]);
  return {
    kind: "CTI_BROWSER_WORKSPACE",
    schemaVersion: 1,
    records: [nextAudit, receipt, audit, course],
  };
}

test("local backup restore orders modern ingestion dependencies and preserves original declaration metadata", async () => {
  const previous = globalThis.indexedDB;
  try {
    const backup = modernIngestionBackup();
    const prepared = prepareWorkspaceBackup(backup);
    assert.deepEqual(
      prepared.map((record) => record.id),
      backup.records.map((record) => record.id).reverse(),
    );
    assert.ok(prepared.every((record) => record.version === 0));
    const fake = strictIndexedDb([]);
    globalThis.indexedDB = fake;
    const store = localStore();
    for (const record of prepared) {
      const restored = await store.save(record);
      const original = backup.records.find((row) => row.id === restored.id);
      assert.deepEqual(restored.data, original.data);
      assert.notEqual(restored.updatedAt, original.updatedAt);
    }
    const restored = await Promise.all(
      prepared.map((record) => store.get(record.id)),
    );
    const listed = await store.list();
    assert.deepEqual(
      currentIngestionAttempt("course", restored),
      currentIngestionAttempt("course", backup.records),
    );
    assert.deepEqual(
      currentIngestionAttempt("course", listed),
      currentIngestionAttempt("course", restored),
    );
    const receipt = restored.find(
      (record) => record.data.type === "ingestion-attempt",
    );
    assert.equal(receipt.data.declaredAt, "2026-09-29T00:00:00.000Z");
    assert.equal(receipt.data.declaredBy, "original owner");
    assert.equal(fake.tables.get("records").size, 4);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});

test("shared backup restore orders modern ingestion dependencies while retaining checksummed original payloads", async () => {
  const api = apiFixture();
  try {
    const backup = modernIngestionBackup();
    const prepared = prepareWorkspaceBackup(backup);
    assert.deepEqual(
      prepared.map((record) => record.id),
      backup.records.map((record) => record.id).reverse(),
    );
    const saved = await saveIngestionFixture(api, prepared);
    const restored = [];
    for (const record of saved) {
      const metadataResponse = await api.call("records/" + record.id);
      assert.equal(metadataResponse.status, 200);
      const { record: metadata } = await metadataResponse.json();
      const payloadResponse = await api.call(
        "records/" + record.id + "/chunks/0",
      );
      assert.equal(payloadResponse.status, 200);
      const data = await payloadResponse.json();
      const original = backup.records.find((row) => row.id === record.id);
      assert.deepEqual(data, original.data);
      assert.notEqual(metadata.updatedAt, original.updatedAt);
      restored.push({ ...metadata, data });
    }
    assert.deepEqual(
      currentIngestionAttempt("course", restored),
      currentIngestionAttempt("course", backup.records),
    );
    const receipt = restored.find(
      (record) => record.data.type === "ingestion-attempt",
    );
    assert.equal(receipt.data.declaredAt, "2026-09-29T00:00:00.000Z");
    assert.equal(receipt.data.declaredBy, "original owner");
    assert.equal(
      api.sql.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
      4,
    );
  } finally {
    api.sql.close();
  }
});

test("local ingestion declarations persist immutable receipts without creating comparison reports", async () => {
  const previous = globalThis.indexedDB;
  try {
    for (const generation of [0, 3]) {
      const { course, audit } = fixture();
      audit.data.generation = generation;
      audit.updatedAt = "2026-10-01T00:00:00.000Z";
      const fake = strictIndexedDb([course, audit]);
      globalThis.indexedDB = fake;
      const store = localStore();
      const receipt = createIngestionAttemptRecord(
        course,
        [course, audit],
        "owner",
        "2026-10-02T00:00:00.000Z",
      );
      assert.equal(receipt.version, 0);
      const saved = await store.save(receipt);
      assert.equal(saved.version, 1);
      assert.deepEqual((await store.get(saved.id)).data, receipt.data);
      assert.equal(
        currentIngestionAttempt(course.id, [course, audit, saved]).generation,
        generation + 1,
      );
      assert.equal(
        [...fake.tables.get("records").values()].filter(
          (r) => r.kind === "audit",
        ).length,
        1,
      );
      const rewritten = structuredClone(saved);
      rewritten.data.declaredBy = "another owner";
      await assert.rejects(store.save(rewritten), /immutable/);
      const recast = { ...saved, data: { type: "catalog", rows: [] } };
      await assert.rejects(store.save(recast), /cannot change/);
      const rebound = { ...receipt, id: "noncanonical-ingestion-receipt" };
      await assert.rejects(
        store.save(rebound),
        /identity|noncanonical|record ID/i,
      );
      const backdated = createIngestionAttemptRecord(
        course,
        [course, audit, saved],
        "owner",
        new Date().toISOString(),
      );
      backdated.data.declaredAt = "2026-09-30T00:00:00.000Z";
      const savedBackdated = await store.save(backdated);
      assert.equal(savedBackdated.data.declaredAt, backdated.data.declaredAt);
      const redated = structuredClone(savedBackdated);
      redated.data.declaredAt = "2026-09-29T00:00:00.000Z";
      await assert.rejects(store.save(redated), /immutable/);
      assert.equal(fake.tables.get("versions").size, 2);
      assert.deepEqual(
        fake.tables.get("records").get(saved.id).data,
        receipt.data,
      );
    }
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});

test("listed ingestion receipts preserve strict schema and the reloaded assignment evidence basis", () => {
  const { course, audit } = fixture();
  audit.data.generation = 3;
  audit.updatedAt = "2026-10-01T00:00:00.000Z";
  const repair = {
    id: "listed-lineage-repair",
    kind: "operations",
    title: "Confirmed repeated export",
    packageId: course.id,
    version: 1,
    updatedAt: "2026-10-02T00:00:00.000Z",
    updatedBy: "owner",
    data: {
      type: "lineage-repair",
      runId: audit.id,
      toGeneration: 0,
      note: "The owner confirmed this was another export of the same ingestion.",
    },
  };
  const baseline = [course, audit, repair];
  const previousBasis = assignmentBasis(course, audit, baseline);
  course.data.assignmentPlan = {
    route: "COURSE",
    shellChangedAt: "",
    reconciliation: {
      basis: previousBasis,
      note: "Reviewed the comparison before declaring another completed ingestion.",
      recordedAt: "2026-10-02T00:00:00.000Z",
      recordedBy: "owner",
    },
  };
  assert.equal(reconciliationCurrent(course, audit, baseline), true);
  const receipt = createIngestionAttemptRecord(
    course,
    baseline,
    "owner",
    "2026-10-03T00:00:00.000Z",
  );
  receipt.version = 1;
  receipt.updatedAt = receipt.data.declaredAt;
  assert.deepEqual(recordSummary(receipt).data, receipt.data);
  const full = [...baseline, receipt];
  const listed = full.map(recordSummary);
  assert.deepEqual(
    currentIngestionAttempt(course.id, listed),
    currentIngestionAttempt(course.id, full),
  );
  assert.notEqual(assignmentBasis(course, audit, full), previousBasis);
  assert.equal(
    assignmentBasis(course, audit, listed),
    assignmentBasis(course, audit, full),
  );
  assert.equal(reconciliationCurrent(course, audit, listed), false);
  assert.deepEqual(
    evaluateAssignment(course, audit, listed).blockers,
    evaluateAssignment(course, audit, full).blockers,
  );
});

test("shared ingestion receipts keep checksummed payloads and regenerate forged listing metadata", async () => {
  const api = apiFixture();
  try {
    const [course, audit] = await saveIngestionFixture(
      api,
      Object.values(fixture()),
    );
    const receipt = createIngestionAttemptRecord(
      course,
      [course, audit],
      "owner",
      new Date().toISOString(),
    );
    const summary = recordSummary(receipt);
    delete summary.data.generation;
    delete summary.data.declaredAt;
    summary.data.previousGeneration = 88;
    summary.data.declaredBy = "forged listing actor";
    summary.data.type = "catalog";
    summary.data.rows = [];
    const response = await api.save(receipt, { summary });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = { ...receipt, version: 1 };
    const listing = JSON.parse(
      api.sql.prepare("SELECT summary FROM documents WHERE id=?").get(saved.id)
        .summary,
    );
    for (const [field, value] of Object.entries(receipt.data))
      assert.deepEqual(listing[field], value, `listing receipt field ${field}`);
    const metadataResponse = await api.call("records/" + saved.id);
    assert.equal(metadataResponse.status, 200);
    const metadata = await metadataResponse.json();
    for (const [field, value] of Object.entries(receipt.data))
      assert.deepEqual(
        metadata.record.data[field],
        value,
        `saved metadata ${field}`,
      );
    const payload = await api.call("records/" + saved.id + "/chunks/0");
    assert.deepEqual(await payload.json(), receipt.data);
    assert.equal(
      api.sql
        .prepare("SELECT COUNT(*) AS count FROM documents WHERE kind='audit'")
        .get().count,
      1,
    );
    const rewritten = structuredClone(saved);
    rewritten.data.declaredBy = "another owner";
    const rejected = await api.save(rewritten);
    assert.equal(rejected.status, 400, await rejected.clone().text());
    assert.match(await rejected.text(), /immutable/);
    const recast = { ...saved, data: { type: "catalog", rows: [] } };
    const typeResponse = await api.save(recast);
    assert.equal(typeResponse.status, 400);
    assert.match(await typeResponse.text(), /cannot change/);
    const identityResponse = await api.save({
      ...receipt,
      id: "wrong-receipt-id",
    });
    assert.equal(identityResponse.status, 400);
    const backdated = createIngestionAttemptRecord(
      course,
      [course, audit, saved],
      "owner",
      new Date().toISOString(),
    );
    backdated.data.declaredAt = "2020-01-01T00:00:00.000Z";
    const dateResponse = await api.save(backdated);
    assert.equal(dateResponse.status, 200, await dateResponse.clone().text());
    const redated = { ...backdated, version: 1, data: { ...backdated.data } };
    redated.data.declaredAt = "2020-01-02T00:00:00.000Z";
    const redatedResponse = await api.save(redated);
    assert.equal(redatedResponse.status, 400);
    assert.match(await redatedResponse.text(), /immutable/);
    assert.equal(
      JSON.parse(
        api.sql
          .prepare("SELECT summary FROM documents WHERE id=?")
          .get(backdated.id).summary,
      ).declaredAt,
      backdated.data.declaredAt,
    );
  } finally {
    api.sql.close();
  }
});

test("local automatic comparisons start at zero and cannot commit after a new ingestion declaration", async () => {
  const previous = globalThis.indexedDB;
  try {
    const { course, audit } = fixture();
    audit.version = 0;
    audit.data.automaticIngestion = createAutomaticIngestionBasis(course.id, [
      course,
    ]);
    const initial = strictIndexedDb([course]);
    globalThis.indexedDB = initial;
    const first = await localStore().save(audit);
    assert.equal(first.data.generation, 0);
    assert.equal(first.data.automaticIngestion.baseAuditId, "");
    const receipt = createIngestionAttemptRecord(
      course,
      [course, first],
      "owner",
      new Date().toISOString(),
    );
    const stale = {
      ...structuredClone(audit),
      id: "automatic-comparison-before-declaration",
    };
    stale.data.automaticIngestion = createAutomaticIngestionBasis(course.id, [
      course,
      first,
    ]);
    const racing = strictIndexedDb([course, first], (tables) => {
      tables.get("records").set(receipt.id, { ...receipt, version: 1 });
    });
    globalThis.indexedDB = racing;
    await assert.rejects(localStore().save(stale), /changed during validation/);
    assert.equal(racing.tables.get("records").has(stale.id), false);
    assert.equal(racing.tables.get("versions").size, 0);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});

for (const change of [
  "new ingestion declaration",
  "existing repair revision",
]) {
  test(`shared automatic comparison atomically rejects ${change} after computing generation zero`, async () => {
    const api = apiFixture();
    try {
      const input = fixture();
      const [course] = await saveIngestionFixture(api, [input.course]);
      input.audit.data.automaticIngestion = createAutomaticIngestionBasis(
        course.id,
        [course],
      );
      const [audit] = await saveIngestionFixture(api, [input.audit]);
      assert.equal(audit.data.generation, 0);
      assert.equal(audit.data.automaticIngestion.baseAuditId, "");
      const records = [course, audit];
      const repair = {
        id: "automatic-comparison-repair",
        kind: "operations",
        title: "Confirmed export correction",
        packageId: course.id,
        version: 0,
        updatedAt: "",
        updatedBy: "owner",
        data: { type: "lineage-repair", runId: audit.id, toGeneration: 0 },
      };
      if (change === "existing repair revision") {
        const [savedRepair] = await saveIngestionFixture(api, [repair]);
        records.push(savedRepair);
      }
      const stale = {
        ...structuredClone(audit),
        id: "automatic-comparison-stale",
        version: 0,
      };
      stale.data.automaticIngestion = createAutomaticIngestionBasis(
        course.id,
        records,
      );
      const receipt = createIngestionAttemptRecord(
        course,
        records,
        "owner",
        new Date().toISOString(),
      );
      api.setBeforeBatch(() => {
        if (change === "new ingestion declaration")
          insertConcurrentSummary(api, receipt);
        else
          api.sql
            .prepare("UPDATE documents SET version=version+1 WHERE id=?")
            .run(repair.id);
      });
      const response = await api.save(stale);
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal(
        api.sql
          .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
          .get(stale.id).count,
        0,
      );
      assert.equal(
        api.sql
          .prepare(
            "SELECT COUNT(*) AS count FROM uploads WHERE document_id=? AND committed=1",
          )
          .get(stale.id).count,
        0,
      );
    } finally {
      api.sql.close();
    }
  });
}

for (const timing of ["already saved", "inserted during repair"]) {
  test(`local lineage correction preserves an ingestion declaration ${timing}`, async () => {
    const previous = globalThis.indexedDB;
    try {
      const { course, audit } = fixture();
      audit.data.generation = 1;
      const receipt = createIngestionAttemptRecord(
        course,
        [course, audit],
        "owner",
        new Date().toISOString(),
      );
      receipt.version = 1;
      const repair = {
        id: "repair-after-declaration",
        kind: "operations",
        title: "Repeated export correction",
        packageId: course.id,
        version: 0,
        updatedAt: "",
        updatedBy: "owner",
        data: { type: "lineage-repair", runId: audit.id, toGeneration: 0 },
      };
      const fake = strictIndexedDb(
        [course, audit, ...(timing === "already saved" ? [receipt] : [])],
        (tables) => {
          if (timing === "inserted during repair")
            tables.get("records").set(receipt.id, receipt);
        },
      );
      globalThis.indexedDB = fake;
      await assert.rejects(
        localStore().save(repair),
        timing === "already saved"
          ? /contradict recorded ingestion history/
          : /changed during validation/,
      );
      assert.equal(fake.tables.get("records").has(repair.id), false);
      assert.equal(fake.tables.get("records").get(audit.id).data.generation, 1);
      assert.deepEqual(
        fake.tables.get("records").get(receipt.id).data,
        receipt.data,
      );
      assert.equal(fake.tables.get("versions").size, 0);
    } finally {
      if (previous === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = previous;
    }
  });

  test(`shared lineage correction preserves an ingestion declaration ${timing}`, async () => {
    const api = apiFixture();
    try {
      const input = fixture();
      input.audit.data.generation = 1;
      const [course, audit] = await saveIngestionFixture(
        api,
        Object.values(input),
      );
      const receipt = createIngestionAttemptRecord(
        course,
        [course, audit],
        "owner",
        new Date().toISOString(),
      );
      if (timing === "already saved") {
        const response = await api.save(receipt);
        assert.equal(response.status, 200, await response.clone().text());
      } else {
        api.setBeforeBatch(() => insertConcurrentSummary(api, receipt));
      }
      const repair = {
        id: "repair-after-declaration",
        kind: "operations",
        title: "Repeated export correction",
        packageId: course.id,
        version: 0,
        updatedAt: "",
        updatedBy: "owner",
        data: { type: "lineage-repair", runId: audit.id, toGeneration: 0 },
      };
      const response = await api.save(repair);
      assert.equal(
        response.status,
        timing === "already saved" ? 400 : 409,
        await response.clone().text(),
      );
      if (timing === "already saved")
        assert.match(
          await response.text(),
          /contradict recorded ingestion history/,
        );
      assert.equal(
        api.sql
          .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
          .get(repair.id).count,
        0,
      );
      assert.equal(
        JSON.parse(
          api.sql
            .prepare("SELECT summary FROM documents WHERE id=?")
            .get(audit.id).summary,
        ).generation,
        1,
      );
      assert.deepEqual(
        JSON.parse(
          api.sql
            .prepare("SELECT summary FROM documents WHERE id=?")
            .get(receipt.id).summary,
        ),
        receipt.data,
      );
    } finally {
      api.sql.close();
    }
  });
}

for (const tail of ["audit", "lineage-repair", "ingestion-attempt"]) {
  test(`local ingestion allocation rejects a concurrent ${tail} insertion atomically`, async () => {
    const previous = globalThis.indexedDB;
    try {
      const { course, audit } = fixture();
      const receipt = createIngestionAttemptRecord(
        course,
        [course, audit],
        "owner",
        new Date().toISOString(),
      );
      const concurrent =
        tail === "audit"
          ? { ...structuredClone(audit), id: "concurrent-audit" }
          : tail === "lineage-repair"
            ? {
                id: "concurrent-repair",
                kind: "operations",
                title: "Repair",
                packageId: course.id,
                version: 1,
                updatedAt: "",
                updatedBy: "owner",
                data: {
                  type: "lineage-repair",
                  runId: audit.id,
                  toGeneration: 0,
                },
              }
            : { ...structuredClone(receipt), version: 1 };
      const fake = strictIndexedDb([course, audit], (tables) => {
        tables.get("records").set(concurrent.id, concurrent);
      });
      globalThis.indexedDB = fake;
      await assert.rejects(
        localStore().save(receipt),
        /changed during validation|Another change was saved/,
      );
      assert.equal(fake.tables.get("versions").size, 0);
      assert.equal(
        fake.tables.get("records").has(receipt.id),
        tail === "ingestion-attempt",
      );
    } finally {
      if (previous === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = previous;
    }
  });

  test(`shared ingestion allocation rejects a concurrent ${tail} insertion atomically`, async () => {
    const api = apiFixture();
    try {
      const [course, audit] = await saveIngestionFixture(
        api,
        Object.values(fixture()),
      );
      const receipt = createIngestionAttemptRecord(
        course,
        [course, audit],
        "owner",
        new Date().toISOString(),
      );
      const concurrent =
        tail === "audit"
          ? { ...structuredClone(audit), id: "concurrent-audit" }
          : tail === "lineage-repair"
            ? {
                id: "concurrent-repair",
                kind: "operations",
                title: "Repair",
                packageId: course.id,
                data: {
                  type: "lineage-repair",
                  runId: audit.id,
                  toGeneration: 0,
                },
              }
            : {
                ...structuredClone(receipt),
                data: { ...receipt.data, declaredBy: "other owner" },
              };
      api.setBeforeBatch(() => insertConcurrentSummary(api, concurrent));
      const response = await api.save(receipt);
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal(
        api.sql
          .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
          .get(receipt.id).count,
        tail === "ingestion-attempt" ? 1 : 0,
      );
      assert.equal(
        api.sql
          .prepare(
            "SELECT COUNT(*) AS count FROM uploads WHERE document_id=? AND committed=1",
          )
          .get(receipt.id).count,
        0,
      );
    } finally {
      api.sql.close();
    }
  });
}

test("shared ingestion allocation follows repaired retained history and pins existing repair revisions", async () => {
  const api = apiFixture();
  try {
    const fixtureRecords = fixture();
    fixtureRecords.audit.data.generation = 3;
    const [course, audit] = await saveIngestionFixture(
      api,
      Object.values(fixtureRecords),
    );
    const repair = {
      id: "confirmed-lineage-repair",
      kind: "operations",
      title: "Confirmed repeated export correction",
      packageId: course.id,
      version: 0,
      updatedAt: "",
      updatedBy: "owner",
      data: { type: "lineage-repair", runId: audit.id, toGeneration: 0 },
    };
    const forgedSummary = recordSummary(repair);
    forgedSummary.data.toGeneration = 88;
    const repairResponse = await api.save(repair, { summary: forgedSummary });
    assert.equal(
      repairResponse.status,
      200,
      await repairResponse.clone().text(),
    );
    const receipt = createIngestionAttemptRecord(
      course,
      [course, audit, { ...repair, version: 1 }],
      "owner",
      new Date().toISOString(),
    );
    assert.equal(receipt.data.previousGeneration, 0);
    assert.equal(receipt.data.generation, 1);
    api.setBeforeBatch(() =>
      api.sql
        .prepare("UPDATE documents SET version=version+1 WHERE id=?")
        .run(repair.id),
    );
    const stale = await api.save(receipt);
    assert.equal(stale.status, 409, await stale.clone().text());
    assert.equal(
      api.sql
        .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
        .get(receipt.id).count,
      0,
    );
    const response = await api.save(receipt);
    assert.equal(response.status, 200, await response.clone().text());
    const history = JSON.parse(
      api.sql.prepare("SELECT summary FROM documents WHERE id=?").get(repair.id)
        .summary,
    );
    assert.equal(history.toGeneration, 0);
    assert.equal(
      audit.data.generation,
      3,
      "the original report remains unchanged",
    );
  } finally {
    api.sql.close();
  }
});

test("two owners preparing the same ingestion generation can save only one canonical receipt", async () => {
  const api = apiFixture();
  try {
    const [course, audit] = await saveIngestionFixture(
      api,
      Object.values(fixture()),
    );
    const receipts = ["first-owner", "second-owner"].map((owner) =>
      createIngestionAttemptRecord(
        course,
        [course, audit],
        owner,
        new Date().toISOString(),
      ),
    );
    assert.equal(receipts[0].id, receipts[1].id);
    const uploads = [];
    for (let index = 0; index < receipts.length; index++) {
      const pending = await api.prepareSave(receipts[index], {
        actor: { role: "admin", email: receipts[index].data.declaredBy },
      });
      assert.equal(pending.response.status, 200);
      uploads.push(pending);
    }
    assert.equal((await uploads[0].commit()).status, 200);
    const loser = await uploads[1].commit();
    assert.ok([400, 409].includes(loser.status), await loser.clone().text());
    const row = api.sql
      .prepare("SELECT version,summary FROM documents WHERE id=?")
      .get(receipts[0].id);
    assert.equal(row.version, 1);
    assert.equal(JSON.parse(row.summary).declaredBy, "first-owner");
    assert.equal(
      api.sql
        .prepare(
          "SELECT COUNT(*) AS count FROM uploads WHERE document_id=? AND committed=1",
        )
        .get(receipts[0].id).count,
      1,
    );
  } finally {
    api.sql.close();
  }
});

for (const timing of ["before approval", "during approval commit"]) {
  test(`an ingestion declaration ${timing} blocks a decision on the previous comparison basis`, async () => {
    const api = apiFixture();
    try {
      const [course, audit] = await saveIngestionFixture(
        api,
        Object.values(fixture()),
      );
      const records = [course, audit];
      const basis = assignmentBasis(course, audit, records);
      course.data.assignmentPlan = {
        route: "COURSE",
        shellChangedAt: "",
        reconciliation: {
          basis,
          note: "Reviewed the complete comparison before declaring another ingestion.",
          recordedAt: new Date().toISOString(),
          recordedBy: "owner",
        },
      };
      assert.equal(reconciliationCurrent(course, audit, records), true);
      const artifact = generateAssignmentDeliverable(
        course,
        audit,
        records,
        "content-map",
      );
      const draftData = makeAssignmentDeliverableData(
        artifact,
        [],
        "draft",
        "",
        "owner",
      );
      const draft = {
        id: assignmentDeliverableRecordId(draftData.deliverableId, 1),
        kind: "operations",
        title: "Content map",
        packageId: course.id,
        version: 0,
        updatedAt: "",
        updatedBy: "owner",
        data: draftData,
      };
      const draftResponse = await api.save(draft);
      assert.equal(
        draftResponse.status,
        200,
        await draftResponse.clone().text(),
      );
      const approvalData = makeAssignmentDeliverableData(
        artifact,
        [draft],
        "approved",
        "Approved this exact map against its saved comparison.",
        "owner",
      );
      const approval = {
        ...draft,
        id: assignmentDeliverableRecordId(approvalData.deliverableId, 2),
        data: approvalData,
      };
      const receipt = createIngestionAttemptRecord(
        course,
        records,
        "owner",
        new Date().toISOString(),
      );
      assert.notEqual(
        assignmentBasis(course, audit, [...records, receipt]),
        basis,
      );
      assert.equal(
        reconciliationCurrent(course, audit, [...records, receipt]),
        false,
      );
      if (timing === "before approval") {
        const response = await api.save(receipt);
        assert.equal(response.status, 200, await response.clone().text());
      } else {
        api.setBeforeBatch(() => insertConcurrentSummary(api, receipt));
      }
      const response = await api.save(approval);
      assert.equal(
        response.status,
        timing === "before approval" ? 400 : 409,
        await response.clone().text(),
      );
      assert.equal(
        api.sql
          .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
          .get(approval.id).count,
        0,
      );
      assert.equal(
        api.sql
          .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
          .get(draft.id).count,
        1,
        "the prior draft remains available for a later revised comparison",
      );
    } finally {
      api.sql.close();
    }
  });
}

test("shared deliverable persistence reconstructs original evidence and rejects forged text even with recomputed hashes", async () => {
  const { course, audit } = fixture(),
    api = apiFixture();
  for (const record of [course, audit])
    assert.equal((await api.save({ ...record, version: 0 })).status, 200);
  const artifact = generateAssignmentDeliverable(
    course,
    audit,
    [course, audit],
    "content-map",
  );
  const data = makeAssignmentDeliverableData(
    artifact,
    [],
    "draft",
    "",
    "owner",
  );
  const record = {
    id: assignmentDeliverableRecordId(data.deliverableId, data.revision),
    kind: "operations",
    title: "Content map",
    packageId: course.id,
    version: 0,
    updatedAt: "",
    updatedBy: "",
    data,
  };
  const forged = structuredClone(record);
  forged.data.artifact.members[0].title = "Fabricated original title";
  forged.data.artifactSha256 = deliverableArtifactHash(forged.data.artifact);
  let response = await api.save(forged);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /retained source evidence/);
  response = await api.save(record);
  assert.equal(response.status, 200, await response.text());
  const rewrite = structuredClone(record);
  rewrite.version = 1;
  response = await api.save(rewrite);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /immutable/);
  const fakeApproval = makeAssignmentDeliverableData(
    artifact,
    [{ ...record, version: 1 }],
    "approved",
    "Owner reviewed this exact structure and evidence.",
    "owner",
  );
  fakeApproval.artifact.members[0].proposed.title = "Unsaved proposed title";
  fakeApproval.artifactSha256 = deliverableArtifactHash(fakeApproval.artifact);
  response = await api.save({
    ...record,
    id: assignmentDeliverableRecordId(data.deliverableId, 2),
    data: fakeApproval,
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /exact revised artifact/);
  api.sql.close();
});

test("pooled workspace advisory labels require their saved historical audit and exact candidate features", async () => {
  const { course } = fixture(),
    historical = fixture().audit;
  historical.id = "historical-audit";
  historical.packageId = "historical-course";
  historical.data.result.stats = {
    extractorMeta: {
      payloadBindingDiagnostics: [
        {
          status: "REVIEW",
          itemId: "original-native",
          itemName: "Repeated lesson",
          itemType: "reading",
          candidates: [
            { id: "captured-native", name: "Repeated lesson", type: "reading" },
          ],
        },
      ],
    },
  };
  const candidate = advisoryCandidatesFromAudit(
    historical.packageId,
    historical,
  )[0];
  const example = reviewedMappingExample(
    candidate,
    "approved",
    "owner",
    "2026-10-16T00:00:00Z",
  );
  const record = {
    id: "model-one",
    kind: "operations",
    title: "Advisory model",
    packageId: course.id,
    version: 0,
    updatedAt: "",
    updatedBy: "",
    data: createAdvisoryRecordData(
      course.id,
      { schemaVersion: 1, examples: [example] },
      "2026-10-16T00:00:00Z",
    ),
  };
  const rows = new Map([
    [course.id, course],
    [historical.id, historical],
  ]);
  validateRecord(record);
  await validateOperationalReferences(record, async (id) => rows.get(id));
  rows.delete(historical.id);
  await assert.rejects(
    validateOperationalReferences(record, async (id) => rows.get(id)),
    /audit changed or is unavailable/,
  );
  rows.set(historical.id, { ...historical, version: historical.version + 1 });
  await assert.rejects(
    validateOperationalReferences(record, async (id) => rows.get(id)),
    /audit changed or is unavailable/,
  );
  const api = apiFixture();
  for (const row of [course, historical])
    assert.equal((await api.save({ ...row, version: 0 })).status, 200);
  const forged = structuredClone(record),
    fakeExample = { ...example, features: Array(9).fill(0) };
  forged.data = createAdvisoryRecordData(
    course.id,
    { schemaVersion: 1, examples: [fakeExample] },
    "2026-10-16T00:00:00Z",
  );
  validateRecord(forged); // Recomputed model/hash alone cannot establish audit provenance.
  const response = await api.save(forged);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /retained audit candidate/);
  assert.equal((await api.save(record)).status, 200);
  api.sql.close();
});
