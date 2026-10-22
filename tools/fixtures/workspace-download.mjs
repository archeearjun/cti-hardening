// Synthetic immutable records, current historical D1 schema; never production data.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { handleAuthorized, createApiHandler } from "../../server/api.ts";
import { CTI_OWNER_EMAIL } from "../../server/access.ts";
export const CHUNK = 128 * 1024;
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function downloadFixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(new URL("../../server/schema.sql", import.meta.url), "utf8"),
  );
  const stats = {
    queries: 0,
    rangeQueries: 0,
    maxRows: 0,
    calls: [],
    peak: 0,
    active: 0,
  };
  const fixture = {
    sql,
    stats,
    old: false,
    d1BlobArrays: false,
    fault: async () => null,
    rowTransform: (rows) => rows,
  };
  class Statement {
    constructor(query, args = []) {
      this.query = query;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.query, args);
    }
    async first() {
      stats.queries++;
      const row = sql.prepare(this.query).get(...this.args) || null;
      if (fixture.d1BlobArrays && row?.value instanceof Uint8Array)
        row.value = Array.from(row.value);
      return row;
    }
    async all() {
      stats.queries++;
      const rows = sql.prepare(this.query).all(...this.args);
      if (this.query.includes("hex(value)")) {
        stats.rangeQueries++;
        stats.maxRows = Math.max(stats.maxRows, rows.length);
        return { results: fixture.rowTransform(rows) };
      }
      return { results: rows };
    }
    async run() {
      throw Error("Download must never write");
    }
  }
  fixture.db = { prepare: (q) => new Statement(q) };
  fixture.seed = (id, length, revision = "revision-" + id, version = 1) => {
    const prefix = JSON.stringify({
      text: "Exact original\r\n<text>π</text>",
      empty: "",
      options: ["", ""],
      padding: "",
    });
    const data = JSON.parse(prefix);
    data.padding = "x".repeat(length - Buffer.byteLength(prefix));
    const bytes = Buffer.from(JSON.stringify(data)),
      sha256 = hash(bytes),
      parts = Math.ceil(bytes.length / CHUNK);
    const record = {
      id,
      kind: "audit",
      title: "Synthetic original",
      packageId: "course",
      version,
      updatedAt: "2026-10-20T01:02:03Z",
      updatedBy: CTI_OWNER_EMAIL,
      data,
    };
    sql
      .prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(
        revision,
        id,
        version - 1,
        CTI_OWNER_EMAIL,
        record.updatedAt,
        1,
        bytes.length,
        parts,
        sha256,
        JSON.stringify({ ...record, data: {} }),
      );
    sql
      .prepare("INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        "audit",
        record.title,
        "course",
        version,
        revision,
        record.updatedAt,
        CTI_OWNER_EMAIL,
        "{}",
      );
    const put = sql.prepare("INSERT INTO chunks VALUES(?,?,?,?,?)");
    sql.exec("BEGIN");
    for (let i = 0; i < parts; i++) {
      const b = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
      put.run(revision, i, b.length, hash(b), b);
    }
    sql.exec("COMMIT");
    return { record, bytes, sha256, parts, revision };
  };
  fixture.fetch = async (path, init = {}) => {
    if ((init.method || "GET") !== "GET") throw Error("Unexpected write");
    const url = new URL(path, "https://cti.example.test");
    if (url.pathname === "/api/session")
      return Response.json({ email: CTI_OWNER_EMAIL, role: "admin" });
    const call = {
      path: url.pathname,
      first: url.searchParams.has("first")
        ? Number(url.searchParams.get("first"))
        : null,
      count: Number(url.searchParams.get("count")),
      revision: url.searchParams.get("revision"),
    };
    stats.calls.push(call);
    stats.active++;
    stats.peak = Math.max(stats.peak, stats.active);
    try {
      const fault = await fixture.fault(call, init);
      if (fault) return fault;
      if (fixture.old && call.first !== null)
        throw Error("Older server must never receive a batch");
      let response = await handleAuthorized(
        new Request(url, init),
        fixture.db,
        { email: CTI_OWNER_EMAIL, role: "admin" },
      );
      if (fixture.old && /^\/api\/records\/[^/]+$/.test(url.pathname)) {
        const m = await response.json();
        delete m.downloadBatch;
        delete m.bytes;
        response = Response.json(m);
      }
      return response;
    } catch (e) {
      if (e instanceof TypeError) throw e;
      return Response.json({ error: e.message }, { status: e.status || 500 });
    } finally {
      stats.active--;
    }
  };
  fixture.publicApi = (email) =>
    createApiHandler(async () => {
      if (!email)
        throw Object.assign(Error("Authentication required"), { status: 401 });
      return { email };
    });
  fixture.reset = () => {
    Object.assign(stats, {
      queries: 0,
      rangeQueries: 0,
      maxRows: 0,
      calls: [],
      peak: 0,
      active: 0,
    });
  };
  return fixture;
}
