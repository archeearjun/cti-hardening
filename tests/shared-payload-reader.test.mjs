import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { handleAuthorized } from "../server/api.ts";
import { recordSummary } from "../src/domain/workspace-store.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";
import {
  readWorkspacePayload,
  compactIngestionHistoryRecord,
  WORKSPACE_PAYLOAD_BATCH_PARTS,
  WORKSPACE_PAYLOAD_CHUNK_BYTES,
  WORKSPACE_PAYLOAD_MAX_BYTES,
} from "../server/workspace-payload.ts";
import {
  createAutomaticIngestionBasis,
  createIngestionAttemptRecord,
  currentIngestionAttempt,
  validateAutomaticIngestionAuditReferences,
} from "../src/domain/ingestion-attempts.ts";
import { courseraContentObservedAt } from "../src/domain/coursera-observation-time.ts";

function payloadDatabase(data, mutate = (rows) => rows) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    "CREATE TABLE chunks(upload_id TEXT,part INTEGER,bytes INTEGER,value BLOB)",
  );
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const manifest = {
    id: "observed-upload",
    bytes: bytes.length,
    parts: Math.ceil(bytes.length / WORKSPACE_PAYLOAD_CHUNK_BYTES),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  for (let part = 0; part < manifest.parts; part++) {
    const value = bytes.slice(
      part * WORKSPACE_PAYLOAD_CHUNK_BYTES,
      (part + 1) * WORKSPACE_PAYLOAD_CHUNK_BYTES,
    );
    sql
      .prepare("INSERT INTO chunks VALUES(?,?,?,?)")
      .run(manifest.id, part, value.length, value);
  }
  const calls = [];
  let active = 0,
    maxActive = 0;
  class Statement {
    constructor(query, args = []) {
      this.query = query;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.query, args);
    }
    async first() {
      return sql.prepare(this.query).get(...this.args) || null;
    }
    async all() {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        calls.push({ query: this.query, args: this.args });
        const rows = sql.prepare(this.query).all(...this.args);
        // Match D1's JSON representation of BLOB values, rather than the
        // Uint8Array returned by Node SQLite. The production reader must avoid
        // requesting those course-sized numeric arrays altogether.
        for (const row of rows)
          if (row.value instanceof Uint8Array) row.value = [...row.value];
        await Promise.resolve();
        return { results: mutate(rows, calls.length) };
      } finally {
        active--;
      }
    }
  }
  return {
    sql,
    manifest,
    bytes,
    calls,
    db: { prepare: (query) => new Statement(query) },
    maxActive: () => maxActive,
  };
}

test("shared payload reader keeps D1 byte results bounded and sequential while retaining exact JSON", async () => {
  const data = {
    title: "Original — source",
    padding: "x".repeat(4 * 1024 * 1024),
    literal: "<not active>\r\n",
  };
  const fixture = payloadDatabase(data);
  assert.deepEqual(
    await readWorkspacePayload(fixture.db, fixture.manifest, "uploaded"),
    data,
  );
  assert.equal(
    fixture.calls.length,
    Math.ceil(fixture.manifest.parts / WORKSPACE_PAYLOAD_BATCH_PARTS),
  );
  assert.equal(fixture.maxActive(), 1);
  for (const call of fixture.calls) {
    assert.match(call.query, /hex\(value\) AS value_hex/);
    assert.match(call.query, /part>=\? AND part<\? ORDER BY part ASC/);
    assert.ok(call.args[2] - call.args[1] <= 32);
    assert.ok(call.args[2] - call.args[1] > 0);
  }
});

test("maximum supported artifact uses eight bounded D1 body reads rather than a whole BLOB-array result", async () => {
  const data = { padding: "x".repeat(WORKSPACE_PAYLOAD_MAX_BYTES - 14) };
  const fixture = payloadDatabase(data);
  assert.equal(fixture.bytes.length, WORKSPACE_PAYLOAD_MAX_BYTES);
  const result = await readWorkspacePayload(
    fixture.db,
    fixture.manifest,
    "referenced",
  );
  assert.equal(result.padding.length, data.padding.length);
  assert.equal(fixture.calls.length, 8);
  assert.ok(fixture.calls.every((call) => call.args[2] - call.args[1] <= 32));
});

test("missing, extra, corrupt and out-of-order shared chunks cannot verify evidence", async (t) => {
  for (const context of ["uploaded", "referenced"]) {
    await t.test(`${context}: missing part`, async () => {
      const fixture = payloadDatabase({ padding: "x".repeat(150000) });
      fixture.sql.prepare("DELETE FROM chunks WHERE part=1").run();
      await assert.rejects(
        readWorkspacePayload(fixture.db, fixture.manifest, context),
        /incomplete/,
      );
    });
    await t.test(`${context}: extra out-of-range part`, async () => {
      const fixture = payloadDatabase({ exact: true });
      fixture.sql
        .prepare("INSERT INTO chunks VALUES(?,?,?,?)")
        .run(fixture.manifest.id, 500, 1, new Uint8Array([1]));
      await assert.rejects(
        readWorkspacePayload(fixture.db, fixture.manifest, context),
        /incomplete/,
      );
    });
    await t.test(`${context}: tampered bytes with intact length`, async () => {
      const fixture = payloadDatabase({ exact: true });
      const changed = fixture.bytes.slice();
      changed[2] ^= 1;
      fixture.sql
        .prepare("UPDATE chunks SET value=? WHERE part=0")
        .run(changed);
      await assert.rejects(
        readWorkspacePayload(fixture.db, fixture.manifest, context),
        /checksum/,
      );
    });
    await t.test(`${context}: out-of-order results`, async () => {
      const fixture = payloadDatabase({ padding: "x".repeat(150000) }, (rows) =>
        rows.reverse(),
      );
      await assert.rejects(
        readWorkspacePayload(fixture.db, fixture.manifest, context),
        /ordering/,
      );
    });
    await t.test(`${context}: malformed hex`, async () => {
      const fixture = payloadDatabase({ exact: true }, (rows) =>
        rows.map((row) => ({
          ...row,
          value_hex: "q" + row.value_hex.slice(1),
        })),
      );
      await assert.rejects(
        readWorkspacePayload(fixture.db, fixture.manifest, context),
        /ordering or length/,
      );
    });
  }
});

const actor = "owner@example.test";
const course = {
  id: "course",
  kind: "package",
  title: "Course",
  packageId: "",
  version: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  updatedBy: actor,
  data: {},
};
const audit = (
  id,
  generation,
  capturedAt = "2026-10-02T00:00:00.000Z",
  mediaEnrichment,
) => ({
  id,
  kind: "audit",
  title: id,
  packageId: course.id,
  version: 1,
  updatedAt: capturedAt || "2026-10-02T00:00:00.000Z",
  updatedBy: actor,
  data: {
    generation,
    hashes: { json: "a".repeat(64), excel: "c".repeat(64) },
    result: {
      stats: {
        extractorMeta: { capturedAt, directDataCapture: { mediaEnrichment } },
      },
      itemResults: [{ originalText: "x".repeat(200000) }],
    },
  },
});

test("transient ingestion history projection preserves allocation, repairs and exact media-continuation freshness", () => {
  const base = audit("base", 0);
  const receipt = createIngestionAttemptRecord(
    course,
    [course, base],
    actor,
    "2026-10-04T00:00:00.000Z",
  );
  const later = audit("later", 1, "2026-10-05T00:00:00.000Z");
  const repaired = audit("repaired", 3, "2026-10-03T00:00:00.000Z");
  const repair = {
    id: "repair",
    kind: "operations",
    title: "Owner repair",
    packageId: course.id,
    version: 2,
    updatedAt: "2026-10-05T01:00:00.000Z",
    updatedBy: actor,
    data: {
      type: "lineage-repair",
      runId: repaired.id,
      toGeneration: 0,
      rows: [{ preservedOnlyInOriginal: true }],
    },
  };
  const records = [course, base, receipt, later, repaired, repair];
  const compact = records.map(compactIngestionHistoryRecord);
  assert.deepEqual(
    currentIngestionAttempt(course.id, compact),
    currentIngestionAttempt(course.id, records),
  );
  assert.deepEqual(
    createAutomaticIngestionBasis(course.id, compact),
    createAutomaticIngestionBasis(course.id, records),
  );
  assert.equal(
    compact.find((row) => row.id === base.id).data.result.itemResults,
    undefined,
  );
  assert.equal(
    base.data.result.itemResults[0].originalText.length,
    200000,
    "original evidence is unchanged",
  );
  assert.equal(compact.find((row) => row.id === repair.id).version, 2);
  for (const enrichment of [
    undefined,
    {
      scope: "media",
      retainedAssessmentObservations: true,
      baseSourceCapturedAt: "2026-10-02T00:00:00.000Z",
    },
    { scope: "media" },
    { retainedAssessmentObservations: true },
    { scope: "", baseSourceCapturedAt: "2026-10-02T00:00:00.000Z" },
    {
      retainedAssessmentObservations: false,
      baseSourceCapturedAt: "2026-10-02T00:00:00.000Z",
    },
  ]) {
    const original = audit(
      "observation",
      1,
      "2026-10-05T00:00:00.000Z",
      enrichment,
    );
    assert.equal(
      courseraContentObservedAt(compactIngestionHistoryRecord(original)),
      courseraContentObservedAt(original),
    );
  }
  const next = audit("next", 1, "2026-10-06T00:00:00.000Z");
  next.data.hashes.json = "b".repeat(64);
  next.data.automaticIngestion = createAutomaticIngestionBasis(
    course.id,
    records,
  );
  validateAutomaticIngestionAuditReferences(next, compact);
  const stale = structuredClone(next);
  stale.data.result.stats.extractorMeta.directDataCapture.mediaEnrichment = {
    scope: "media",
    retainedAssessmentObservations: true,
    baseSourceCapturedAt: "2026-10-01T00:00:00.000Z",
  };
  assert.throws(
    () => validateAutomaticIngestionAuditReferences(stale, compact),
    /fresh course bookmark/,
  );
  assert.throws(
    () =>
      validateAutomaticIngestionAuditReferences(next, [
        ...compact,
        audit("concurrent", 1, "2026-10-07T00:00:00.000Z"),
      ]),
    /history changed/,
  );
  assert.throws(
    () =>
      compactIngestionHistoryRecord({
        ...receipt,
        data: { ...receipt.data, unsupportedClaim: true },
      }),
    /Unsupported ingestion attempt receipt field/,
  );
});

test("shared audit finalization validates large original history sequentially and retains atomic stale-version protection", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    fs.readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  let active = 0,
    maxActive = 0,
    bodyReads = 0,
    beforeBatch;
  const rowsRead = new Set();
  class Statement {
    constructor(query, args = []) {
      this.query = query;
      this.args = args;
    }
    bind(...args) {
      return new Statement(
        this.query,
        args.map((value) =>
          value instanceof ArrayBuffer ? new Uint8Array(value) : value,
        ),
      );
    }
    async first() {
      return sql.prepare(this.query).get(...this.args) || null;
    }
    async all() {
      if (this.query.includes("FROM chunks")) {
        assert.match(
          this.query,
          /hex\(value\)/,
          "no full D1 numeric BLOB arrays",
        );
        bodyReads++;
        rowsRead.add(this.args[0]);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      try {
        return { results: sql.prepare(this.query).all(...this.args) };
      } finally {
        if (this.query.includes("FROM chunks")) active--;
      }
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
      beforeBatch?.();
      beforeBatch = undefined;
      sql.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const source = { ...comparisonFixture().course, id: course.id, version: 1 };
  const originals = [
    source,
    ...Array.from({ length: 4 }, (_, index) =>
      audit(`history-${index}`, 3, `2026-10-0${index + 2}T00:00:00.000Z`),
    ),
  ];
  const seed = (record, committed = 1) => {
    const uploadId = `upload-${record.id}`;
    const bytes = new TextEncoder().encode(JSON.stringify(record.data));
    const parts = Math.ceil(bytes.length / WORKSPACE_PAYLOAD_CHUNK_BYTES);
    sql
      .prepare(
        "INSERT INTO uploads(id,document_id,expected_version,actor,created_at,committed,bytes,parts,sha256,metadata) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        uploadId,
        record.id,
        committed ? record.version - 1 : 0,
        actor,
        record.updatedAt,
        committed,
        bytes.length,
        parts,
        createHash("sha256").update(bytes).digest("hex"),
        JSON.stringify(recordSummary(record)),
      );
    for (let part = 0; part < parts; part++) {
      const value = bytes.slice(
        part * WORKSPACE_PAYLOAD_CHUNK_BYTES,
        (part + 1) * WORKSPACE_PAYLOAD_CHUNK_BYTES,
      );
      sql
        .prepare("INSERT INTO chunks VALUES(?,?,?,?,?)")
        .run(
          uploadId,
          part,
          value.length,
          createHash("sha256").update(value).digest("hex"),
          value,
        );
    }
    if (committed)
      sql
        .prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          record.id,
          record.kind,
          record.title,
          record.packageId,
          record.version,
          uploadId,
          record.updatedAt,
          actor,
          JSON.stringify(recordSummary(record).data),
        );
    return uploadId;
  };
  originals.forEach((record) => seed(record));
  const next = audit("new-report", 3, "2026-10-08T00:00:00.000Z");
  next.version = 0;
  next.data.automaticIngestion = createAutomaticIngestionBasis(
    course.id,
    originals,
  );
  const commit = async (uploadId) => {
    try {
      return await handleAuthorized(
        new Request(`https://cti.example.test/api/uploads/${uploadId}/commit`, {
          method: "POST",
          body: "{}",
          headers: { Origin: "https://cti.example.test" },
        }),
        db,
        { role: "editor", email: actor },
      );
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status || 500,
      });
    }
  };
  const uploadId = seed(next, 0);
  const saved = await commit(uploadId);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(maxActive, 1, "large prior payloads are not read concurrently");
  assert.equal(
    rowsRead.size,
    originals.length + 1,
    "every original basis is still read and independently checksummed",
  );
  assert.ok(bodyReads > 1);
  assert.equal(
    sql.prepare("SELECT committed FROM uploads WHERE id=?").get(uploadId)
      .committed,
    1,
  );

  const concurrent = audit("stale-report", 3, "2026-10-09T00:00:00.000Z");
  concurrent.version = 0;
  concurrent.data.automaticIngestion = createAutomaticIngestionBasis(
    course.id,
    [...originals, { ...next, version: 1 }],
  );
  const staleUpload = seed(concurrent, 0);
  beforeBatch = () =>
    sql
      .prepare("UPDATE documents SET version=version+1 WHERE id=?")
      .run(originals[1].id);
  const stale = await commit(staleUpload);
  assert.equal(stale.status, 409, await stale.clone().text());
  assert.equal(
    sql.prepare("SELECT committed FROM uploads WHERE id=?").get(staleUpload)
      .committed,
    0,
  );
  assert.equal(
    sql
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
      .get(concurrent.id).count,
    0,
  );

  const corruptBasis = audit(
    "corrupt-basis-report",
    3,
    "2026-10-10T00:00:00.000Z",
  );
  corruptBasis.version = 0;
  corruptBasis.data.automaticIngestion = createAutomaticIngestionBasis(
    course.id,
    [...originals, { ...next, version: 1 }],
  );
  const corruptUpload = seed(corruptBasis, 0);
  const changed = new Uint8Array(
    sql
      .prepare("SELECT value FROM chunks WHERE upload_id=? AND part=0")
      .get("upload-history-0").value,
  );
  changed[2] ^= 1;
  sql
    .prepare("UPDATE chunks SET value=? WHERE upload_id=? AND part=0")
    .run(changed, "upload-history-0");
  const rejected = await commit(corruptUpload);
  assert.equal(rejected.status, 400, await rejected.clone().text());
  assert.match(await rejected.text(), /Referenced evidence checksum failed/);
  assert.equal(
    sql.prepare("SELECT committed FROM uploads WHERE id=?").get(corruptUpload)
      .committed,
    0,
  );
  assert.equal(
    sql
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE id=?")
      .get(corruptBasis.id).count,
    0,
  );
});
