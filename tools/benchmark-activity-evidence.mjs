// Local, synthetic benchmark; optionally audit a retained JSON.gz without exporting bodies.
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { captureFixture } from "../tests/activity-designer-fixtures.mjs";
const baseline = "611a692e8ce2e2475cc8089a0bbeb61a14e6d118";
const hash = (x) => createHash("sha256").update(x).digest("hex");
function context(old = false) {
  const c = vm.createContext({
    console,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    crypto,
    DOMParser,
    CourseCtiUnifiedCapture: { hashText: hash, pdfs: () => [] },
  });
  for (const name of [
    "xml-reader",
    "shell-capture",
    "cti-adapter",
    "core",
    "activity-quality",
    "approval",
    "compact",
  ]) {
    const path = `src/activity-designer/${name}.js`;
    vm.runInContext(
      old
        ? execFileSync("git", ["show", `${baseline}:${path}`], {
            encoding: "utf8",
            maxBuffer: 4 * 1024 ** 2,
          })
        : fs.readFileSync(path, "utf8"),
      c,
    );
  }
  return c;
}
function sample(fn, n = 30) {
  const times = [];
  let result;
  for (let i = 0; i < n + 5; i++) {
    const t = performance.now();
    result = fn();
    if (i >= 5) times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return {
    median_ms: times[Math.floor(n / 2)],
    p95_ms: times[Math.floor(n * 0.95)],
    result,
  };
}
const report = {
  kind: "local_synthetic_wall_clock",
  baseline,
  iterations: 30,
  notes: [
    "No production speed claim. Token estimates are characters / 4. Stages are independent, not additive.",
    "Heap samples are process-wide occupied heap, not isolated browser peak memory. Operator actions are prescribed, not observed.",
  ],
};
const baseContext = context(true),
  baseSession = baseContext.CourseShell.toSession(
    captureFixture(),
    "fixture.json",
    baseContext.CoursePrep,
  );
for (const [name, old] of [
  ["before", true],
  ["after", false],
]) {
  const c = context(old),
    s = structuredClone(baseSession);
  s.sources.push({
    kind: "source_package",
    filename: "fixture.imscc",
    documents: Array.from({ length: 45 }, (_, i) => ({
      id: "D" + i,
      path: `resource-${i}.html`,
      title: `Resource ${i}`,
      text: `Resource ${i}: units and measurements. `.repeat(150),
      coverage: "text",
      sha256: hash("synthetic-" + i),
    })),
    unread: [],
    warnings: [],
    external_links: [],
    manifests: [],
  });
  c.ActivityApproval.freezeSession(s);
  const heapBefore = process.memoryUsage().heapUsed;
  const timed = sample(() =>
    c.CourseCompact.build(s, {
      keys: ["C1M1"],
      includePaths: ["resource-3.html"],
    }),
  );
  const p = timed.result.packets[0];
  report[name] = {
    input_bytes: Buffer.byteLength(JSON.stringify(s)),
    packet_bytes: Buffer.byteLength(p.text),
    estimated_tokens: p.tokens,
    documents: p.data.documents.length,
    excluded_documents: p.data.scope.excluded_documents?.length || 0,
    median_ms: timed.median_ms,
    p95_ms: timed.p95_ms,
    heap_delta_bytes: process.memoryUsage().heapUsed - heapBefore,
  };
  const identity = sample(() => c.ActivityApproval.identity(s), 1000);
  report[name].cached_identity_median_ms = identity.median_ms;
}
if (process.argv[2]) {
  const bytes = fs.readFileSync(process.argv[2]),
    raw = JSON.parse(gunzipSync(bytes)),
    before = hash(JSON.stringify(raw));
  report.retained_capture = {
    input_sha256: hash(bytes),
    input_bytes: bytes.length,
    items: raw.fingerprints.length,
  };
  for (const [name, old] of [
    ["before", true],
    ["after", false],
  ]) {
    const c = context(old),
      timing = sample(() => {
        const cap = c.CourseCtiAdapter.adapt(raw);
        return {
          cap,
          s: c.CourseShell.toSession(
            cap,
            "retained-capture.json",
            c.CoursePrep,
          ),
        };
      });
    const { cap, s } = timing.result;
    report.retained_capture[name] = {
      projection_median_ms: timing.median_ms,
      projection_p95_ms: timing.p95_ms,
      documents: s.sources[0].documents.length,
      states: cap.items.reduce(
        (a, i) => ((a[i.coverage] = (a[i.coverage] || 0) + 1), a),
        {},
      ),
      items: cap.items
        .filter((i) => ["zBBdG", "SekFW", "mtHnH", "LFrHs"].includes(i.id))
        .map((i) => ({
          id: i.id,
          state: i.coverage,
          blocks: i.blocks.length,
          characters: i.blocks.reduce((n, b) => n + b.text.length, 0),
        })),
    };
  }
  report.retained_capture.original_unchanged =
    before === hash(JSON.stringify(raw)) &&
    report.retained_capture.input_sha256 ===
      hash(fs.readFileSync(process.argv[2]));
}
console.log(JSON.stringify(report, null, 2));
