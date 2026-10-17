import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { handleAuthorized } from "../server/api.ts";
import { newRecord, recordSummary } from "../src/domain/workspace-store.ts";

const origin = "https://cti.example.test";
const actor = { email: "owner@example.test", role: "editor" };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    fs.readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
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
      sql.exec("BEGIN");
      try {
        const rows = [];
        for (const statement of statements) rows.push(await statement.run());
        sql.exec("COMMIT");
        return rows;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const call = async (path, method = "GET", body, user = actor) => {
    try {
      return await handleAuthorized(
        new Request(`${origin}/api/${path}`, {
          method,
          body,
          headers: { Origin: origin },
        }),
        db,
        user,
      );
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status || 500,
      });
    }
  };
  const record = newRecord(
    "audit",
    "Exact original report",
    { generation: 3, result: { observed: "x".repeat(150000) } },
    "course",
  );
  const bytes = new TextEncoder().encode(JSON.stringify(record.data));
  const manifest = {
    record: JSON.parse(JSON.stringify(recordSummary(record))),
    bytes: bytes.length,
    parts: Math.ceil(bytes.length / 131072),
    sha256: hash(bytes),
    allowSemanticDuplicate: false,
  };
  const prepare = (value = manifest, user = actor) =>
    call("uploads", "POST", JSON.stringify(value), user);
  const put = (
    id,
    part,
    value = bytes.slice(part * 131072, (part + 1) * 131072),
    user = actor,
  ) => call(`uploads/${id}/chunks/${part}`, "PUT", value, user);
  return { sql, call, record, bytes, manifest, prepare, put };
}

test("explicit retry and concurrent prepares reuse one exact actor-scoped upload and digest receipts", async () => {
  const f = fixture();
  const responses = await Promise.all([f.prepare(), f.prepare()]);
  const [first, concurrent] = await Promise.all(
    responses.map(async (response) => {
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    }),
  );
  assert.equal(first.id, concurrent.id);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS count FROM uploads").get().count,
    1,
  );
  assert.deepEqual(first.record, f.manifest.record);
  assert.deepEqual(first.receivedParts, []);
  assert.equal(first.allowSemanticDuplicate, false);
  assert.equal((await f.put(first.id, 0)).status, 200);
  const resumed = await (await f.prepare()).json();
  assert.equal(resumed.id, first.id);
  assert.deepEqual(resumed.receivedParts, [
    { part: 0, bytes: 131072, digest: hash(f.bytes.slice(0, 131072)) },
  ]);
  const status = await (await f.call(`uploads/${first.id}`)).json();
  assert.deepEqual(status, resumed);
  assert.equal(
    (await f.put(first.id, 0)).status,
    200,
    "lost chunk acknowledgement remains safely retryable",
  );
  const conflicting = f.bytes.slice(0, 131072);
  conflicting[2] ^= 1;
  assert.equal((await f.put(first.id, 0, conflicting)).status, 409);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS count FROM chunks").get().count,
    1,
  );
  assert.equal(
    (
      await f.call(`uploads/${first.id}`, "GET", undefined, {
        ...actor,
        email: "other@example.test",
      })
    ).status,
    404,
  );
});

test("record metadata, payload, actor and commit-option changes cannot borrow an upload", async () => {
  const f = fixture();
  const original = await (await f.prepare()).json();
  for (const changed of [
    { ...f.manifest, record: { ...f.manifest.record, title: "Changed title" } },
    { ...f.manifest, sha256: "b".repeat(64) },
    {
      ...f.manifest,
      record: { ...f.manifest.record, packageId: "other-course" },
    },
  ]) {
    const response = await f.prepare(changed);
    assert.equal(response.status, 200, await response.clone().text());
    assert.notEqual((await response.json()).id, original.id);
  }
  const other = await (
    await f.prepare(f.manifest, { ...actor, email: "other@example.test" })
  ).json();
  assert.notEqual(other.id, original.id);
  const duplicate = await (
    await f.prepare(
      { ...f.manifest, allowSemanticDuplicate: true },
      { ...actor, role: "admin" },
    )
  ).json();
  assert.notEqual(duplicate.id, original.id);
  assert.equal(duplicate.allowSemanticDuplicate, true);
  assert.equal(
    (
      await f.call(
        `uploads/${original.id}/commit`,
        "POST",
        JSON.stringify({ allowSemanticDuplicate: true }),
        { ...actor, role: "admin" },
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.prepare({ ...f.manifest, allowSemanticDuplicate: true })).status,
    403,
  );
});

test("lost commit acknowledgement is confirmed by exact upload status without creating or overwriting history", async () => {
  const f = fixture();
  const upload = await (await f.prepare()).json();
  for (let part = 0; part < f.manifest.parts; part++)
    assert.equal((await f.put(upload.id, part)).status, 200);
  const committed = await f.call(`uploads/${upload.id}/commit`, "POST", "{}");
  assert.equal(committed.status, 200, await committed.clone().text());
  // Discard the commit acknowledgement, as a lost network response would.
  const confirmed = await (await f.call(`uploads/${upload.id}`)).json();
  assert.equal(confirmed.committed, true);
  assert.equal(confirmed.sha256, f.manifest.sha256);
  assert.equal(confirmed.savedRecord.id, f.record.id);
  assert.equal(confirmed.savedRecord.version, 1);
  assert.deepEqual(
    confirmed.record,
    f.manifest.record,
    "the original prepare envelope remains bound",
  );
  const repeated = await f.prepare();
  assert.equal(repeated.status, 200, await repeated.clone().text());
  assert.equal((await repeated.json()).id, upload.id);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS count FROM uploads").get().count,
    1,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE kind='audit'")
      .get().count,
    1,
  );
  assert.equal(
    (await f.call(`uploads/${upload.id}/commit`, "POST", "{}")).status,
    409,
    "commit writes themselves are never silently repeated",
  );
});

test("legacy prepares keep the existing admin-only migration commit option behavior", async () => {
  const f = fixture();
  const legacy = { ...f.manifest };
  delete legacy.allowSemanticDuplicate;
  const admin = { ...actor, role: "admin" };
  const upload = await (await f.prepare(legacy, admin)).json();
  assert.equal(upload.allowSemanticDuplicate, null);
  for (let part = 0; part < f.manifest.parts; part++)
    assert.equal((await f.put(upload.id, part, undefined, admin)).status, 200);
  assert.equal(
    (
      await f.call(
        `uploads/${upload.id}/commit`,
        "POST",
        JSON.stringify({ allowSemanticDuplicate: true }),
        admin,
      )
    ).status,
    200,
  );
});

test("stale record versions, malformed receipts and inconsistent stored bindings stop resume", async () => {
  const f = fixture();
  const upload = await (await f.prepare()).json();
  assert.equal(
    (
      await f.prepare({
        ...f.manifest,
        record: { ...f.manifest.record, version: 1 },
      })
    ).status,
    409,
  );
  assert.equal((await f.put(upload.id, 0)).status, 200);
  f.sql
    .prepare("UPDATE chunks SET digest=? WHERE upload_id=? AND part=0")
    .run("not-a-digest", upload.id);
  assert.equal((await f.call(`uploads/${upload.id}`)).status, 409);
  f.sql
    .prepare("UPDATE uploads SET metadata=? WHERE id=?")
    .run(
      JSON.stringify({
        ...f.manifest.record,
        title: "Inconsistent stored envelope",
      }),
      upload.id,
    );
  assert.equal((await f.prepare()).status, 409);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS count FROM uploads").get().count,
    1,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
    0,
  );
});
