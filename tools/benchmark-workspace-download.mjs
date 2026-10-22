import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { teamStore } from "../src/domain/workspace-store.ts";
import { enablePerformance } from "../src/diagnostics/runtime.ts";
import {
  downloadFixture,
  CHUNK,
  hash,
} from "./fixtures/workspace-download.mjs";
const fixture = downloadFixture(),
  originalFetch = globalThis.fetch;
fixture.d1BlobArrays = !process.argv.includes("--native-blobs");
const specs = Array.from({ length: 25 }, (_, i) => ({
  id: "synthetic-" + i,
  size: (i < 5 ? 39 : 38) * CHUNK - 37,
}));
const sources = specs.map((s) => {
  const f = fixture.seed(s.id, s.size);
  return { id: s.id, bytes: f.bytes.length, parts: f.parts, sha256: f.sha256 };
});
globalThis.fetch = fixture.fetch;
const trials = [];
try {
  for (let trial = 0; trial < 6; trial++) {
    const old = trial % 2 === 0;
    fixture.old = old;
    fixture.reset();
    globalThis.gc?.();
    const baseline = process.memoryUsage();
    let sampledPeak = { ...baseline };
    const sample = () => {
      const m = process.memoryUsage();
      for (const k of Object.keys(m))
        sampledPeak[k] = Math.max(sampledPeak[k], m[k]);
    };
    const timer = setInterval(sample, 5);
    const trace = enablePerformance(true);
    const store = await teamStore();
    const start = performance.now();
    const outputs = [];
    for (const src of sources) {
      const before = performance.now();
      const r = await store.get(src.id);
      outputs.push({
        id: src.id,
        data: r.data,
        elapsedMs: performance.now() - before,
      });
      sample();
    }
    const elapsedMs = performance.now() - start;
    clearInterval(timer);
    trace.finish("complete");
    const report = trace.snapshot();
    for (let i = 0; i < outputs.length; i++)
      assert.equal(
        hash(Buffer.from(JSON.stringify(outputs[i].data))),
        sources[i].sha256,
      );
    trials.push({
      mode: old ? "individual" : "batch8",
      trial,
      elapsedMs,
      recordRequests: fixture.stats.calls.length,
      sessionRequests: 1,
      d1Queries: fixture.stats.queries,
      boundedRangeQueries: fixture.stats.rangeQueries,
      maxD1Rows: fixture.stats.maxRows,
      baselineMemory: baseline,
      sampledPeakMemory: sampledPeak,
      counts: report.counts,
      stages: report.stages,
      hashEquality: true,
    });
  }
  const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const before = trials.filter((t) => t.mode === "individual"),
    after = trials.filter((t) => t.mode === "batch8");
  const receipt = {
    kind: "CTI_SYNTHETIC_DOWNLOAD_BENCHMARK",
    node: process.version,
    platform: process.platform,
    measuredAt: new Date().toISOString(),
    scope: `Actual client and server handler with in-process SQLite; ${fixture.d1BlobArrays ? "D1 BLOB-as-number-array result representation simulated" : "native SQLite BLOB byte arrays"}; no HTTP socket latency, Cloudflare CPU or production quota measured. Diagnostics enabled in both paths. Alternating modes, identical records. No artificial latency.`,
    records: sources.length,
    bytes: sources.reduce((s, r) => s + r.bytes, 0),
    chunks: sources.reduce((s, r) => s + r.parts, 0),
    individual: {
      requests: before[0].recordRequests,
      medianMs: median(before.map((t) => t.elapsedMs)),
      d1Queries: before[0].d1Queries,
    },
    batch: {
      requests: after[0].recordRequests,
      medianMs: median(after.map((t) => t.elapsedMs)),
      d1Queries: after[0].d1Queries,
    },
    requestReductionPercent:
      100 * (1 - after[0].recordRequests / before[0].recordRequests),
    memoryCaveat:
      "Process samples include the fixture database and retained output objects; not an isolated client or Worker peak. Five-millisecond sampling can miss peaks. Modes share one process; GC is requested when available.",
    trials,
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ ...receipt, trials: undefined }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  fixture.sql.close();
  enablePerformance(false);
}
