import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  newRecord,
  recordSummary,
  teamStore,
} from "../src/domain/workspace-store.ts";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const chunkSize = 131072;
function fixture(t, parts = 3) {
  const record = newRecord(
    "audit",
    "Synthetic course · generation 3 · ops",
    {
      generation: 3,
      result: { summary: { unresolved: 1 } },
      report: "Original findings remain unresolved.",
      padding: "",
    },
    "course-synthetic",
  );
  record.data.padding = "x".repeat(
    (parts - 1) * chunkSize +
      2000 -
      Buffer.byteLength(JSON.stringify(record.data)),
  );
  const uploads = new Map(),
    records = new Map(),
    events = [];
  const actor = { email: "resume-owner@example.test", role: "admin" };
  const faults = {
    prepare: false,
    chunk: -1,
    acknowledge: false,
    commit: "",
    recordRead: false,
    binary: -1,
    status: null,
  };
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const gateway = () =>
    new Response("<html>Private gateway body</html>", {
      status: 503,
      headers: {
        "retry-after": "120",
        "cf-ray": "synthetic-resume-BOM",
        "cf-error-type": "1102",
        "cf-error-origin": "worker",
      },
    });
  const status = (upload) => ({
    id: upload.id,
    ...upload.manifest,
    receivedParts: [...upload.chunks].map(([part, bytes]) => ({
      part,
      bytes: bytes.length,
      digest: hash(bytes),
    })),
    committed: !!upload.saved,
    ...(upload.saved ? { savedRecord: recordSummary(upload.saved) } : {}),
  });
  globalThis.fetch = async (path, init = {}) => {
    const url = new URL(path, "https://cti.example.test"),
      route = url.pathname.replace(/^\/api\//, ""),
      method = init.method || "GET";
    events.push({ route, method });
    if (route === "session") return Response.json(actor);
    if (route === "uploads" && method === "POST") {
      const manifest = JSON.parse(init.body);
      const id = "resume_" + hash(JSON.stringify([actor.email, manifest]));
      if (!uploads.has(id))
        uploads.set(id, {
          id,
          actor: actor.email,
          manifest,
          chunks: new Map(),
        });
      if (faults.prepare) return gateway();
      return Response.json(status(uploads.get(id)));
    }
    const uploadPath =
      /^uploads\/([^/]+)(?:\/(chunks|commit)(?:\/(\d+))?)?$/.exec(route);
    if (uploadPath) {
      const upload = uploads.get(uploadPath[1]);
      if (!upload || upload.actor !== actor.email)
        return Response.json({ error: "Upload not found." }, { status: 404 });
      if (method === "GET") {
        const result = status(upload);
        faults.status?.(result);
        return Response.json(result);
      }
      if (uploadPath[2] === "chunks") {
        const part = Number(uploadPath[3]),
          bytes = Buffer.from(init.body);
        if (part !== faults.chunk || faults.acknowledge)
          upload.chunks.set(part, bytes);
        if (part === faults.chunk) return gateway();
        return Response.json({ success: true });
      }
      if (uploadPath[2] === "commit") {
        if (faults.commit === "before") return gateway();
        const bytes = Buffer.concat(
          Array.from({ length: upload.manifest.parts }, (_, i) =>
            upload.chunks.get(i),
          ),
        );
        assert.equal(hash(bytes), upload.manifest.sha256);
        upload.saved = {
          ...upload.manifest.record,
          data: JSON.parse(bytes.toString()),
          version: upload.manifest.record.version + 1,
          updatedAt: "2026-10-17T12:00:00Z",
          updatedBy: actor.email,
        };
        records.set(upload.saved.id, upload);
        if (faults.commit === "after") return gateway();
        return Response.json({ record: recordSummary(upload.saved) });
      }
    }
    const recordPath = /^records\/([^/]+)(?:\/chunks\/(\d+))?$/.exec(route);
    if (recordPath) {
      if (faults.recordRead) return gateway();
      const upload = records.get(recordPath[1]);
      if (!upload)
        return Response.json({ error: "Record not found." }, { status: 404 });
      if (recordPath[2] !== undefined) {
        const part = Number(recordPath[2]);
        if (part === faults.binary) {
          faults.binary = -1;
          return new Response("gateway", {
            status: 503,
            headers: { "cf-ray": "binary-once-BOM" },
          });
        }
        return new Response(upload.chunks.get(part), {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      return Response.json({
        record: recordSummary(upload.saved),
        parts: upload.manifest.parts,
        sha256: upload.manifest.sha256,
        revision: upload.id,
      });
    }
    throw Error("Unexpected client fixture route " + route);
  };
  return { record, uploads, records, events, faults, actor };
}

test("chunk 53/81 interruption resumes the same upload without retransmitting acknowledged chunks", async (t) => {
  const f = fixture(t, 81),
    store = await teamStore();
  f.faults.chunk = 52;
  await assert.rejects(store.save(f.record), /chunk 53\/81.*HTTP 503/);
  const interrupted = f.events.length;
  f.faults.chunk = -1;
  const saved = await store.save(f.record);
  assert.equal(saved.id, f.record.id);
  assert.equal(saved.version, 1);
  assert.equal(f.uploads.size, 1);
  assert.equal(
    f.events.filter((e) => e.method === "POST" && e.route === "uploads").length,
    1,
  );
  const resumed = f.events.slice(interrupted);
  assert.equal(resumed[0].method, "GET");
  assert.match(resumed[0].route, /^uploads\/resume_/);
  const parts = resumed
    .filter((e) => e.method === "PUT")
    .map((e) => Number(e.route.split("/").at(-1)));
  assert.deepEqual(
    parts,
    Array.from({ length: 29 }, (_, i) => i + 52),
  );
  assert.deepEqual(saved.data, f.record.data);
});

test("a stored failed-chunk acknowledgement is verified and skipped on explicit resume", async (t) => {
  const f = fixture(t),
    store = await teamStore();
  f.faults.chunk = 1;
  f.faults.acknowledge = true;
  await assert.rejects(store.save(f.record), /HTTP 503/);
  const interrupted = f.events.length;
  f.faults.chunk = -1;
  await store.save(f.record);
  assert.deepEqual(
    f.events
      .slice(interrupted)
      .filter((e) => e.method === "PUT")
      .map((e) => e.route.split("/").at(-1)),
    ["2"],
  );
  assert.equal(f.uploads.size, 1);
});

test("a lost prepare response is not automatically repeated and explicit retry reuses its server session", async (t) => {
  const f = fixture(t),
    store = await teamStore();
  f.faults.prepare = true;
  await assert.rejects(
    store.save(f.record),
    /HTTP 503.*not automatically repeated/,
  );
  assert.equal(f.events.filter((e) => e.route === "uploads").length, 1);
  assert.equal(f.uploads.size, 1);
  f.faults.prepare = false;
  await store.save(f.record);
  assert.equal(f.events.filter((e) => e.route === "uploads").length, 2);
  assert.equal(f.uploads.size, 1);
});

test("lost commit response is read and checksummed before any second commit POST", async (t) => {
  const f = fixture(t),
    store = await teamStore();
  f.faults.commit = "after";
  await assert.rejects(store.save(f.record), /HTTP 503.*Check save \/ retry/);
  f.faults.commit = "";
  const interrupted = f.events.length;
  const saved = await store.save(f.record);
  assert.equal(saved.id, f.record.id);
  assert.equal(f.events.filter((e) => e.route.endsWith("/commit")).length, 1);
  assert.equal(f.uploads.size, 1);
  assert.equal(
    f.events.slice(interrupted).every((e) => e.method === "GET"),
    true,
  );
});

test("uncommitted finalization retries the fully uploaded session after exact-record absence", async (t) => {
  const f = fixture(t),
    store = await teamStore();
  f.faults.commit = "before";
  await assert.rejects(store.save(f.record), /HTTP 503/);
  f.faults.commit = "";
  const interrupted = f.events.length;
  await store.save(f.record);
  const resumed = f.events.slice(interrupted);
  assert.equal(resumed[0].route, "records/" + f.record.id);
  assert.equal(resumed[0].method, "GET");
  assert.match(resumed[1].route, /^uploads\//);
  assert.equal(resumed[1].method, "GET");
  assert.equal(resumed.filter((e) => e.method === "PUT").length, 0);
  assert.equal(resumed.filter((e) => e.method === "POST").length, 1);
  assert.equal(f.uploads.size, 1);
});

test("uncertain record reads and conflicting part receipts permit no resume writes", async (t) => {
  const f = fixture(t),
    store = await teamStore();
  f.faults.commit = "before";
  await assert.rejects(store.save(f.record));
  f.faults.recordRead = true;
  let checkpoint = f.events.length;
  await assert.rejects(
    store.save(f.record),
    (e) => e.status === 503 && e.phase === "download",
  );
  assert.equal(
    f.events.slice(checkpoint).every((e) => e.method === "GET"),
    true,
  );
  f.faults.recordRead = false;
  f.faults.status = (status) => {
    status.receivedParts[0].digest = "0".repeat(64);
  };
  checkpoint = f.events.length;
  await assert.rejects(store.save(f.record), /chunk receipt differs/);
  assert.equal(
    f.events.slice(checkpoint).every((e) => e.method === "GET"),
    true,
  );
});

test("changed metadata, payload, version, commit option or account never reuses another binding", async (t) => {
  const f = fixture(t),
    store = await teamStore();
  f.faults.chunk = 0;
  await assert.rejects(store.save(f.record));
  for (const change of [
    (r) => {
      r.title += " changed";
    },
    (r) => {
      r.packageId = "other-course";
    },
    (r) => {
      r.kind = "legacy-backup";
    },
    (r) => {
      r.version = 1;
    },
    (r) => {
      r.data.report += " changed";
    },
  ]) {
    const record = structuredClone(f.record);
    change(record);
    const before = f.uploads.size;
    await assert.rejects(store.save(record));
    assert.equal(f.uploads.size, before + 1);
  }
  let before = f.uploads.size;
  await assert.rejects(store.save(f.record, { allowSemanticDuplicate: true }));
  assert.equal(f.uploads.size, before + 1);
  before = f.uploads.size;
  f.actor.email = "another-owner@example.test";
  const otherStore = await teamStore();
  await assert.rejects(otherStore.save(f.record));
  assert.equal(f.uploads.size, before + 1);
});

test("saved evidence binary download retries a temporary failed chunk and verifies the complete payload", async (t) => {
  const f = fixture(t),
    store = await teamStore();
  await store.save(f.record);
  f.faults.binary = 1;
  const saved = await store.get(f.record.id);
  assert.deepEqual(saved.data, f.record.data);
  assert.equal(
    f.events.filter((e) => e.route === `records/${f.record.id}/chunks/1`)
      .length,
    2,
  );
});

test("in-flight caller mutations cannot change the prepared metadata, persisted bytes or returned receipt", async (t) => {
  const f = fixture(t),
    store = await teamStore();
  f.record.data.hashes = { json: "original-hash" };
  const expected = structuredClone(f.record);
  const options = {
    allowSemanticDuplicate: false,
    onProgress(message) {
      if (!message.startsWith("Preparing")) return;
      f.record.title = "Changed after binding";
      f.record.data.hashes.json = "changed-hash";
      f.record.data.report = "Changed after serialization";
      options.allowSemanticDuplicate = true;
    },
  };
  const saved = await store.save(f.record, options);
  const upload = [...f.uploads.values()][0];
  assert.equal(upload.manifest.record.title, expected.title);
  assert.equal(upload.manifest.record.data.hashes.json, "original-hash");
  assert.equal(upload.manifest.allowSemanticDuplicate, false);
  assert.deepEqual(saved.data, expected.data);
  assert.equal(saved.title, expected.title);
  assert.deepEqual((await store.get(expected.id)).data, expected.data);
});
