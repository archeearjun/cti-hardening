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
} from "../src/domain/workspace-validation.ts";
import {
  digest,
  localStore,
  recordSummary,
} from "../src/domain/workspace-store.ts";
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
  const call = async (path, method = "GET", body) => {
    try {
      return await handleAuthorized(
        new Request("https://cti.example.test/api/" + path, {
          method,
          body,
          headers: { Origin: "https://cti.example.test" },
        }),
        db,
        { role: "admin", email: "owner" },
      );
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status || 500,
      });
    }
  };
  const save = async (record) => {
    const bytes = new TextEncoder().encode(JSON.stringify(record.data));
    const prepare = await call(
      "uploads",
      "POST",
      JSON.stringify({
        record: recordSummary(record),
        bytes: bytes.length,
        parts: 1,
        sha256: await digest(bytes),
      }),
    );
    if (!prepare.ok) return prepare;
    const { id } = await prepare.json();
    assert.equal(
      (await call("uploads/" + id + "/chunks/0", "PUT", bytes)).status,
      200,
    );
    return call("uploads/" + id + "/commit", "POST", "{}");
  };
  return {
    sql,
    call,
    save,
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
