import test from "node:test";
import assert from "node:assert/strict";
import { teamStore } from "../src/domain/workspace-store.ts";
import {
  decodeDownloadBatch,
  DOWNLOAD_BATCH_MAX_BYTES,
} from "../src/domain/workspace-download-batch.ts";
import { enablePerformance } from "../src/diagnostics/runtime.ts";
import {
  downloadFixture,
  CHUNK,
  hash,
} from "../tools/fixtures/workspace-download.mjs";
import { CTI_OWNER_EMAIL } from "../server/access.ts";
function fixture(t) {
  const f = downloadFixture(),
    prior = globalThis.fetch;
  globalThis.fetch = f.fetch;
  t.after(() => {
    globalThis.fetch = prior;
    f.sql.close();
    enablePerformance(false);
  });
  return f;
}
function fastWait(t) {
  const prior = globalThis.setTimeout,
    random = Math.random,
    waits = [];
  globalThis.setTimeout = (fn, ms, ...a) => {
    waits.push(ms);
    return prior(fn, 0, ...a);
  };
  Math.random = () => 0.5;
  t.after(() => {
    globalThis.setTimeout = prior;
    Math.random = random;
  });
  return waits;
}
const busy = (status = 503, delay = "1") =>
  Response.json(
    { error: "Workspace busy" },
    { status, headers: { "Retry-After": delay } },
  );
const binary = (bytes) =>
  new Response(bytes, {
    headers: { "Content-Type": "application/octet-stream" },
  });

test("single, full, final short and maximum 32 MiB records equal the prior downloader byte-for-byte", async (t) => {
  const f = fixture(t);
  for (const [i, length] of [
    100,
    8 * CHUNK,
    18 * CHUNK + 3,
    32 * 1024 * 1024,
  ].entries()) {
    const src = f.seed("record" + i, length);
    f.old = true;
    const old = await (await teamStore()).get(src.record.id);
    f.reset();
    f.old = false;
    const trace = enablePerformance(true);
    const current = await (await teamStore()).get(src.record.id);
    assert.deepEqual(current, old);
    const bytes = Buffer.from(JSON.stringify(current.data));
    assert.deepEqual(bytes, src.bytes);
    assert.equal(hash(bytes), src.sha256);
    assert.equal(f.stats.calls.length, 1 + Math.ceil(src.parts / 8));
    assert.equal(f.stats.queries, 2 + 3 * Math.ceil(src.parts / 8));
    assert(f.stats.maxRows <= 8);
    const report = trace.snapshot();
    assert.equal(report.counts.chunks_acquired, src.parts);
    assert.equal(report.counts.batch_requests, Math.ceil(src.parts / 8));
    assert(report.counts.download_bytes > length);
    assert(!JSON.stringify(report).includes("Synthetic original"));
  }
});

test("historical committed revisions remain explicitly bound even when latest record changes", async (t) => {
  const f = fixture(t),
    old = f.seed("record", CHUNK * 9 + 5);
  const latest = f.seed("record", CHUNK + 20, "new-revision", 2);
  const response = await f.fetch(
    "/api/records/record/chunk-batch?revision=" +
      old.revision +
      "&first=0&count=8",
  );
  assert.equal(response.status, 200);
  const chunks = await decodeDownloadBatch(
    new Uint8Array(await response.arrayBuffer()),
    {
      recordId: "record",
      revision: old.revision,
      sha256: old.sha256,
      bytes: old.bytes.length,
      parts: old.parts,
      first: 0,
      count: 8,
    },
  );
  assert.deepEqual(Buffer.concat(chunks), old.bytes.subarray(0, 8 * CHUNK));
  assert.deepEqual(
    (await (await teamStore()).get("record")).data,
    latest.record.data,
  );
});

test("invalid batch ranges, cross-record revisions, missing rows and unordered D1 results fail closed", async (t) => {
  const f = fixture(t),
    a = f.seed("a", 9 * CHUNK),
    b = f.seed("b", 100);
  for (const query of [
    "first=0&count=9",
    "first=0&count=0",
    "first=-1&count=1",
    "first=8&count=2",
    "first=0&count=1&count=1",
    "first=00&count=1",
    "first=1.5&count=1",
  ])
    assert.equal(
      (
        await f.fetch(
          "/api/records/a/chunk-batch?revision=" + a.revision + "&" + query,
        )
      ).status,
      400,
    );
  assert.equal(
    (await f.fetch("/api/records/a/chunk-batch?first=0&count=1")).status,
    400,
  );
  assert.equal(
    (
      await f.fetch(
        "/api/records/a/chunk-batch?revision=" +
          b.revision +
          "&first=0&count=1",
      )
    ).status,
    404,
  );
  f.rowTransform = (rows) => rows.reverse();
  assert.equal(
    (
      await f.fetch(
        "/api/records/a/chunk-batch?revision=" +
          a.revision +
          "&first=0&count=8",
      )
    ).status,
    409,
  );
  f.rowTransform = (rows) => rows;
  f.sql
    .prepare("DELETE FROM chunks WHERE upload_id=? AND part=1")
    .run(a.revision);
  assert.equal(
    (
      await f.fetch(
        "/api/records/a/chunk-batch?revision=" +
          a.revision +
          "&first=0&count=8",
      )
    ).status,
    409,
  );
});

test("frames reject bad identity, version, reordered/duplicate/missing chunks, truncated data and corrupted digests", async (t) => {
  const f = fixture(t),
    src = f.seed("record", CHUNK * 9);
  const response = await f.fetch(
    "/api/records/record/chunk-batch?revision=" +
      src.revision +
      "&first=0&count=8",
  );
  const original = new Uint8Array(await response.arrayBuffer());
  const expected = {
    recordId: "record",
    revision: src.revision,
    sha256: src.sha256,
    bytes: src.bytes.length,
    parts: src.parts,
    first: 0,
    count: 8,
  };
  for (const key of [
    "recordId",
    "revision",
    "sha256",
    "bytes",
    "parts",
    "first",
    "count",
  ])
    await assert.rejects(
      decodeDownloadBatch(original, {
        ...expected,
        [key]: typeof expected[key] === "number" ? expected[key] + 1 : "wrong",
      }),
      /invalid/,
    );
  const offset = 12 + new DataView(original.buffer).getUint32(8);
  for (const mutate of [
    (b) => {
      b[7] = 50;
    },
    (b) => {
      new DataView(b.buffer).setUint32(offset, 1);
    },
    (b) => {
      new DataView(b.buffer).setUint32(offset + 40 + CHUNK, 0);
    },
    (b) => {
      b[offset + 8] ^= 1;
    },
    (b) => {
      b[offset + 40] ^= 1;
    },
  ]) {
    const b = original.slice();
    mutate(b);
    await assert.rejects(decodeDownloadBatch(b, expected), /invalid/);
  }
  for (const b of [
    original.subarray(0, 7),
    original.subarray(0, -1),
    original.subarray(0, offset + 40 + CHUNK),
    new Uint8Array(original.length + 1),
    new Uint8Array(DOWNLOAD_BATCH_MAX_BYTES + 1),
  ])
    await assert.rejects(decodeDownloadBatch(b, expected), /invalid/);
});

test("six-attempt budget, Retry-After, resume reuse and changed revisions preserve final evidence", async (t) => {
  const f = fixture(t),
    waits = fastWait(t),
    src = f.seed("record", 18 * CHUNK + 7);
  const store = await teamStore();
  const trace = enablePerformance(true);
  const progress = [];
  f.fault = async (c) => (c.first === 8 ? busy() : null);
  await assert.rejects(
    store.get("record", { onProgress: (m) => progress.push(m) }),
    (e) => e.attempts === 6 && /8\/19 chunks retained/.test(e.message),
  );
  assert.deepEqual(waits, [1125, 2250, 4500, 9000, 9000]);
  assert.equal(f.stats.calls.filter((c) => c.first === 0).length, 1);
  f.fault = async () => null;
  assert.deepEqual((await store.get("record")).data, src.record.data);
  assert.equal(f.stats.calls.filter((c) => c.first === 0).length, 1);
  assert.equal(trace.snapshot().counts.reused_chunks, 8);
  let failures = 0;
  f.fault = async (c) =>
    c.first === 8 && failures++ === 0 ? busy(429, "10") : null;
  await store.get("record");
  assert.equal(waits.at(-1), 10000);
  f.fault = async (c) => (c.first === 8 ? busy(503, "120") : null);
  await assert.rejects(store.get("record"), /wait 120 seconds/);
  const changed = f.seed("record", CHUNK + 5, "changed-revision", 2);
  f.fault = async () => null;
  assert.deepEqual((await store.get("record")).data, changed.record.data);
  assert(progress.some((m) => /chunks 9–16\/19.*retry/.test(m)));
});

test("stream interruption retries whole batch; abort preserves only completed batches; concurrent reads serialize", async (t) => {
  const f = fixture(t);
  fastWait(t);
  const src = f.seed("record", 17 * CHUNK);
  let once = true;
  f.fault = async (c) => {
    if (c.first !== 8 || !once) return null;
    once = false;
    let n = 0;
    return new Response(
      new ReadableStream({
        pull(out) {
          if (n++ === 0) out.enqueue(new Uint8Array([1]));
          else out.error(new TypeError("interrupted"));
        },
      }),
      { headers: { "Content-Type": "application/octet-stream" } },
    );
  };
  const store = await teamStore();
  assert.deepEqual((await store.get("record")).data, src.record.data);
  assert.equal(f.stats.calls.filter((c) => c.first === 8).length, 2);
  const stop = new AbortController();
  f.reset();
  f.fault = async (c) => (c.first === 8 ? busy() : null);
  await assert.rejects(
    store.get("record", {
      signal: stop.signal,
      onProgress: (m) => {
        if (m.includes("retry")) stop.abort();
      },
    }),
    /stopped by you/,
  );
  f.fault = async () => {
    await new Promise((r) => setImmediate(r));
    return null;
  };
  await Promise.all([store.get("record"), store.get("record")]);
  assert.equal(f.stats.peak, 1);
  assert.equal(f.stats.calls.filter((c) => c.first === 0).length, 2);
});

test("unsupported old manifests use individual reads; advertised failures never downgrade or import", async (t) => {
  const f = fixture(t);
  fastWait(t);
  const src = f.seed("record", CHUNK + 3);
  f.old = true;
  assert.deepEqual(
    (await (await teamStore()).get("record")).data,
    src.record.data,
  );
  assert(f.stats.calls.every((c) => c.first === null));
  f.old = false;
  for (const status of [401, 403, 404, 409, 501]) {
    f.reset();
    f.fault = async (c) =>
      c.first !== null
        ? Response.json({ error: "denied or unsupported" }, { status })
        : null;
    await assert.rejects((await teamStore()).get("record"));
    assert(!f.stats.calls.some((c) => /\/chunks\//.test(c.path)));
  }
  f.reset();
  f.fault = async (c) =>
    c.first !== null ? Response.json({ record: { id: "record" } }) : null;
  await assert.rejects((await teamStore()).get("record"), /HTTP 200/);
  assert(!f.stats.calls.some((c) => /\/chunks\//.test(c.path)));
  f.fault = async (c) =>
    c.first !== null
      ? binary(new Uint8Array(DOWNLOAD_BATCH_MAX_BYTES + 1))
      : null;
  await assert.rejects((await teamStore()).get("record"), /exceeds/);
});

test("Pages owner authentication precedes any batch access or delegation", async (t) => {
  const f = fixture(t);
  f.seed("record", 100);
  let forwarded = 0;
  const env = {
    CTI_DB: f.db,
    CTI_ADMINS: CTI_OWNER_EMAIL,
    CTI_EXTRACTOR: {
      fetch: async () => {
        forwarded++;
        return new Response("unused");
      },
    },
  };
  const req = () =>
    new Request(
      "https://cti.example.test/api/records/record/chunk-batch?revision=revision-record&first=0&count=1",
    );
  assert.equal(
    (await f.publicApi("other@example.test")(req(), env)).status,
    403,
  );
  assert.equal((await f.publicApi(null)(req(), env)).status, 401);
  assert.equal(forwarded, 0);
  assert.equal((await f.publicApi(CTI_OWNER_EMAIL)(req(), env)).status, 200);
  assert.equal(forwarded, 1);
});

test("valid chunk digests cannot bypass the final complete-original SHA-256 check", async (t) => {
  const f = fixture(t),
    src = f.seed("record", CHUNK + 5),
    store = await teamStore();
  f.sql
    .prepare("UPDATE uploads SET sha256=? WHERE id=?")
    .run("a".repeat(64), src.revision);
  await assert.rejects(store.get("record"), /checksum failed/);
  f.sql
    .prepare("UPDATE uploads SET sha256=? WHERE id=?")
    .run(src.sha256, src.revision);
  assert.deepEqual((await store.get("record")).data, src.record.data);
  assert.equal(f.stats.calls.filter((c) => c.first === 0).length, 2);
});

test("abort during a streamed batch cancels acquisition and never retains a prefix", async (t) => {
  const f = fixture(t),
    src = f.seed("record", CHUNK * 9),
    stop = new AbortController();
  let cancelled = false;
  f.fault = async (c) =>
    c.first === 0
      ? new Response(
          new ReadableStream({
            pull(out) {
              out.enqueue(new Uint8Array([1, 2, 3]));
              stop.abort();
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "application/octet-stream" } },
        )
      : null;
  const store = await teamStore();
  await assert.rejects(
    store.get("record", { signal: stop.signal }),
    /stopped by you/,
  );
  assert(cancelled);
  f.fault = async () => null;
  assert.deepEqual((await store.get("record")).data, src.record.data);
  assert.equal(f.stats.calls.filter((c) => c.first === 0).length, 2);
});
