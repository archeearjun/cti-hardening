import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleApi, handleAuthorized } from "../server/api.ts";
import { newRecord, digest, teamStore } from "../src/domain/workspace-store.ts";
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
  const original = comparisonFixture().course;
  const u = await upload(call, original);
  await u.chunks();
  const saved = (await (await u.commit()).json()).record;
  // Commit responses intentionally contain only a bounded summary. A real
  // editor retains/loads the complete evidence payload before writing another
  // version; never promote a list summary into the next full record.
  const current = {
    ...structuredClone(original),
    version: saved.version,
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
  };
  const a = await upload(call, { ...current, title: "Winner" }),
    b = await upload(call, { ...current, title: "Conflict" });
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

test("team client safely retries a stored chunk whose acknowledgement was lost", async (t) => {
  const db = database(),
    call = client(db);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.sql.close();
  });
  const requests = [],
    progress = [];
  let loseAcknowledgement = true;
  globalThis.fetch = async (path, init = {}) => {
    requests.push({ path, method: init.method || "GET" });
    const response = await call(
      path.replace(/^\/api\//, ""),
      init.method || "GET",
      init.body,
    );
    if (init.method === "PUT" && loseAcknowledgement) {
      loseAcknowledgement = false;
      assert.equal(response.status, 200);
      return new Response("<html>Temporary gateway failure</html>", {
        status: 502,
        headers: { "cf-ray": "synthetic-test" },
      });
    }
    return response;
  };
  const store = await teamStore();
  const course = comparisonFixture().course;
  course.data.padding = "x".repeat(150000);
  const saved = await store.save(course, {
    onProgress: (message) => progress.push(message),
  });
  assert.equal(saved.version, 1);
  const puts = requests.filter((r) => r.method === "PUT");
  assert.equal(puts.length, 3);
  assert.equal(puts[0].path, puts[1].path);
  assert.equal(requests.filter((r) => r.path === "/api/uploads").length, 1);
  assert.equal(requests.filter((r) => r.path.endsWith("/commit")).length, 1);
  assert.equal((await store.list()).length, 1);
  assert.deepEqual((await store.get(course.id)).data, course.data);
  assert(progress.some((p) => /HTTP 502.*retry 2\/3/.test(p)));
});

test("failed evidence upload leaves earlier records committed; retry skips them and saves only the remaining ID", async (t) => {
  const db = database(),
    call = client(db);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.sql.close();
  });
  let failChunks = false;
  globalThis.fetch = async (path, init = {}) => {
    if (failChunks && init.method === "PUT")
      return new Response("<html>Unavailable</html>", {
        status: 503,
        headers: { "retry-after": "120", "cf-ray": "synthetic-ray" },
      });
    return call(path.replace(/^\/api\//, ""), init.method || "GET", init.body);
  };
  const store = await teamStore();
  const first = comparisonFixture().course,
    second = comparisonFixture().course;
  await store.save(first);
  failChunks = true;
  await assert.rejects(
    store.save(second),
    (e) =>
      e.message.includes(second.id) &&
      /chunk 1\/1.*HTTP 503.*synthetic-ray.*120 seconds/.test(e.message),
  );
  assert.deepEqual(
    (await store.list()).map((r) => r.id),
    [first.id],
  );
  failChunks = false;
  const existing = new Set((await store.list()).map((r) => r.id));
  let skipped = 0;
  for (const r of [first, second]) {
    if (existing.has(r.id)) {
      skipped++;
      continue;
    }
    await store.save(r);
  }
  assert.equal(skipped, 1);
  assert.equal((await store.list()).length, 2);
  assert.equal((await store.versions(first.id)).length, 1);
  assert.deepEqual((await store.get(second.id)).data, second.data);
});

test("item review records round-trip separately, retain versions and reject viewer writes", async () => {
  const db = database(),
    call = client(db);
  const record = newRecord(
    "item-review",
    "Synthetic item",
    {
      auditId: "audit-a",
      itemKey: "item:reading",
      review: {
        status: "checked",
        note: "Checked the exact source and learner preview.",
        updatedAt: new Date().toISOString(),
        updatedBy: actor.email,
        capture: {
          kind: "CTI_COURSERA_ITEM_CHECK",
          payload: { textSample: "Fresh evidence" },
        },
      },
    },
    "package-a",
  );
  const u = await upload(call, record);
  await u.chunks();
  const committed = await u.commit();
  assert.equal(committed.status, 200, await committed.clone().text());
  const saved = (await committed.json()).record;
  assert.equal(saved.kind, "item-review");
  assert.equal(saved.version, 1);
  const changed = {
    ...record,
    version: 1,
    data: {
      ...record.data,
      review: { ...record.data.review, status: "in_progress" },
    },
  };
  const next = await upload(call, changed);
  await next.chunks();
  assert.equal((await next.commit()).status, 200);
  const versions = await (await call(`records/${record.id}/versions`)).json();
  assert.equal(versions.versions.length, 2);
  const data = new TextEncoder().encode(JSON.stringify(record.data));
  const denied = await client(db, { ...actor, role: "viewer" })(
    "uploads",
    "POST",
    JSON.stringify({
      record: recordSummary(record),
      bytes: data.length,
      parts: 1,
      sha256: await digest(data),
    }),
  );
  assert.equal(denied.status, 403);
});

test("large nested QA findings stay in chunks and never overflow the preparation envelope", async (t) => {
  const db = database(),
    call = client(db),
    originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.sql.close();
  });
  let manifestBytes = 0;
  globalThis.fetch = async (path, init = {}) => {
    if (path === "/api/uploads")
      manifestBytes = new TextEncoder().encode(init.body).length;
    return call(path.replace(/^\/api\//, ""), init.method || "GET", init.body);
  };
  const r = newRecord(
    "audit",
    "synthetic course · generation 2 · raw",
    {
      generation: 2,
      result: {
        summary: {
          totalSourceItems: 161,
          evidenceCoverage: 55,
          headlineStatus: "REVIEW",
          operationalPolicy: {
            items: Array.from({ length: 1800 }, (_, i) => ({
              id: i,
              evidence: "é".repeat(90),
            })),
          },
          destinationReadiness: { details: "x".repeat(150000) },
        },
      },
    },
    "package-fixture",
  );
  const old = await call("uploads", "POST", JSON.stringify({ record: r }));
  assert.equal(old.status, 413); // reproduces the original prepare-stage failure
  const store = await teamStore();
  await store.save(r);
  assert(manifestBytes < 4096);
  const listed = (await store.list())[0];
  assert.equal(listed.data.summary.totalSourceItems, 161);
  assert.equal(listed.data.summary.headlineStatus, "REVIEW");
  assert.equal(listed.data.summary.operationalPolicy, undefined);
  assert.deepEqual((await store.get(r.id)).data, r.data); // full evidence survives byte-for-byte JSON round trip
  assert.equal(r.data.result.summary.operationalPolicy.items.length, 1800);
});


test("authenticated extraction proxy forwards only trusted CTI identity to the service binding", async () => {
  const db = database(),
    seen = [];
  const extractor = {
    async fetch(request) {
      seen.push({
        url: request.url,
        method: request.method,
        user: request.headers.get("x-cti-user"),
        role: request.headers.get("x-cti-role"),
        access: request.headers.get("cf-access-jwt-assertion"),
        body: request.method === "POST" ? await request.text() : "",
      });
      return new Response(
        JSON.stringify({ status: { id: "extract-test", state: "QUEUED" } }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    },
  };
  const request = new Request(url + "/api/extraction/jobs?view=compact", {
    method: "POST",
    headers: {
      Origin: url,
      "Content-Type": "application/json",
      "Cf-Access-Jwt-Assertion": "must-not-be-forwarded",
    },
    body: JSON.stringify({
      url: "https://www.coursera.org/teach/course/Course_id_123/content/edit",
    }),
  });
  const response = await handleAuthorized(request, db, actor, extractor);
  assert.equal(response.status, 202);
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].url,
    "https://cti-coursera-extractor.internal/jobs?view=compact",
  );
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].user, actor.email);
  assert.equal(seen[0].role, actor.role);
  assert.equal(seen[0].access, null);
  assert.match(seen[0].body, /coursera\.org/);
  db.sql.close();
});

test("extraction proxy fails closed when the service binding is absent and still enforces write roles", async () => {
  const db = database(),
    editorRequest = new Request(url + "/api/extraction/jobs", {
      method: "POST",
      headers: { Origin: url, "Content-Type": "application/json" },
      body: "{}",
    });
  assert.equal(
    (await handleAuthorized(editorRequest, db, actor)).status,
    503,
  );
  const viewerRequest = new Request(url + "/api/extraction/jobs", {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: "{}",
  });
  await assert.rejects(
    handleAuthorized(
      viewerRequest,
      db,
      { ...actor, role: "viewer" },
      { fetch: async () => new Response("{}") },
    ),
    (error) => error.status === 403,
  );
  db.sql.close();
});


test("server validates the reconstructed full payload before commit", async () => {
  const db = database(),
    call = client(db),
    valid = comparisonFixture().course;
  const malformed = {
    ...valid,
    data: {
      ...valid.data,
      scan: {
        ...valid.data.scan,
        courseTree: "not-an-array",
      },
    },
  };
  const u = await upload(call, malformed);
  await u.chunks();
  const response = await u.commit();
  assert.equal(response.status, 400);
  assert.match(await response.text(), /complete source tree/i);
  assert.equal(
    (await (await call("records")).json()).records.some((r) => r.id === malformed.id),
    false,
    "invalid payload must not become a committed document",
  );
});
