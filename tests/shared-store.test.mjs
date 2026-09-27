import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleApi, handleAuthorized } from "../server/api.ts";
import { newRecord, digest } from "../src/domain/workspace-store.ts";
import { recordSummary } from "../src/domain/workspace-store.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";
function database() {
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
  return {
    prepare: (q) => new Statement(q),
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const r = [];
        for (const s of statements) r.push(await s.run());
        sql.exec("COMMIT");
        return r;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
    sql,
  };
}
const actor = { email: "editor@example.test", role: "editor" },
  url = "https://cti.example.test";
function client(db, user = actor) {
  return async (path, method = "GET", body, origin = url) => {
    const req = new Request(url + "/api/" + path, {
      method,
      headers: {
        ...(origin ? { Origin: origin } : {}),
        ...(typeof body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body,
    });
    try {
      return await handleAuthorized(req, db, user);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status || 500,
      });
    }
  };
}
async function upload(call, record) {
  const data = new TextEncoder().encode(JSON.stringify(record.data));
  const res = await call(
    "uploads",
    "POST",
    JSON.stringify({
      record: recordSummary(record),
      bytes: data.length,
      parts: Math.ceil(data.length / 131072),
      sha256: await digest(data),
    }),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const { id } = await res.json();
  return {
    id,
    data,
    async chunks() {
      for (let i = 0; i < Math.ceil(data.length / 131072); i++)
        assert.equal(
          (
            await call(
              `uploads/${id}/chunks/${i}`,
              "PUT",
              data.slice(i * 131072, (i + 1) * 131072),
            )
          ).status,
          200,
        );
    },
    commit: () => call(`uploads/${id}/commit`, "POST", "{}"),
  };
}
test("deployed API fails closed without team configuration or verified identity", async () => {
  assert.equal(
    (await handleApi(new Request(url + "/api/session"), {})).status,
    503,
  );
  const env = {
    CTI_DB: database(),
    CTI_ACCESS_ISSUER: "https://example.cloudflareaccess.com",
    CTI_ACCESS_AUD: "aud",
    CTI_ADMINS: "admin@example.test",
  };
  assert.equal(
    (await handleApi(new Request(url + "/api/session"), env)).status,
    401,
  );
  assert.equal(
    (
      await handleApi(
        new Request(url + "/api/session", {
          headers: { "Cf-Access-Jwt-Assertion": "bad" },
        }),
        env,
      )
    ).status,
    401,
  );
});
test("viewer cannot write; same-origin requirement and admin-only backup imports enforced", async () => {
  const db = database(),
    r = comparisonFixture().course;
  assert.equal(
    (await client(db, { ...actor, role: "viewer" })("uploads", "POST", "{}"))
      .status,
    403,
  );
  assert.equal(
    (await client(db)("uploads", "POST", "{}", "https://other.test")).status,
    403,
  );
  const record = newRecord("legacy-backup", "backup", {});
  const data = new TextEncoder().encode("{}");
  const req = { record, bytes: 2, parts: 1, sha256: await digest(data) };
  assert.equal(
    (await client(db)("uploads", "POST", JSON.stringify(req))).status,
    403,
  );
});
test("chunk uploads are invisible until complete and checksummed data round-trips", async () => {
  const db = database(),
    call = client(db),
    r = comparisonFixture().course;
  r.data.padding = "x".repeat(150000);
  const u = await upload(call, r);
  assert.equal((await u.commit()).status, 409);
  assert.equal((await (await call("records")).json()).records.length, 0);
  await u.chunks();
  const committed = await u.commit();
  assert.equal(committed.status, 200);
  const manifest = await (await call("records/" + r.id)).json();
  const pieces = [];
  for (let i = 0; i < manifest.parts; i++)
    pieces.push(
      new Uint8Array(
        await (
          await call(
            `records/${r.id}/chunks/${i}?revision=${manifest.revision}`,
          )
        ).arrayBuffer(),
      ),
    );
  const joined = Buffer.concat(pieces);
  assert.equal(await digest(joined), manifest.sha256);
  assert.deepEqual(JSON.parse(joined), r.data);
  assert.equal(
    (await call(`uploads/${u.id}/chunks/0`, "PUT", u.data.slice(0, 131072)))
      .status,
    409,
  );
});
test("concurrent edits use compare-and-swap and retain saved versions", async () => {
  const db = database(),
    call = client(db);
  const u = await upload(call, comparisonFixture().course);
  await u.chunks();
  const saved = (await (await u.commit()).json()).record;
  const a = await upload(call, { ...saved, title: "Winner" }),
    b = await upload(call, { ...saved, title: "Conflict" });
  await a.chunks();
  await b.chunks();
  assert.equal((await a.commit()).status, 200);
  assert.equal((await b.commit()).status, 409);
  assert.equal(
    (await (await call("records/" + saved.id)).json()).record.title,
    "Winner",
  );
  assert.equal(
    (await (await call(`records/${saved.id}/versions`)).json()).versions.length,
    2,
  );
});
test("immutable audit history and checklist course assignment survive storage", async () => {
  const db = database(),
    call = client(db),
    courseId = crypto.randomUUID();
  const r = newRecord(
    "audit",
    "snapshot",
    { result: { success: true }, generation: 1 },
    courseId,
  );
  const u = await upload(call, r);
  await u.chunks();
  const saved = (await (await u.commit()).json()).record;
  const bad = await call(
    "uploads",
    "POST",
    JSON.stringify({
      record: saved,
      bytes: u.data.length,
      parts: 1,
      sha256: await digest(u.data),
    }),
  );
  assert.equal(bad.status, 409);
  const list = newRecord("checklist", "Checklist", { evidence: {}, notes: "" });
  const v = await upload(call, list);
  await v.chunks();
  const unlinked = (await (await v.commit()).json()).record;
  const w = await upload(call, { ...unlinked, packageId: courseId });
  await w.chunks();
  assert.equal((await w.commit()).status, 200);
  assert.equal(
    (await (await call("records")).json()).records.find((x) => x.id === list.id)
      .packageId,
    courseId,
  );
});
