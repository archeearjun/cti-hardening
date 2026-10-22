import { build } from "vite";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import http from "node:http";
import assert from "node:assert/strict";
import {
  downloadFixture,
  CHUNK,
  hash,
} from "./fixtures/workspace-download.mjs";
const f = downloadFixture(),
  src = f.seed("record", 17 * CHUNK + 7);
const scratch = await mkdtemp(path.join(os.tmpdir(), "cti-batch-browser-"));
const entry = path.join(scratch, "fixture.mjs");
await writeFile(
  entry,
  `import {teamStore} from ${JSON.stringify(path.resolve("src/domain/workspace-store.ts"))};import {enablePerformance} from ${JSON.stringify(path.resolve("src/diagnostics/runtime.ts"))};window.makeStore=teamStore;window.trace=enablePerformance(true);`,
);
const bundle = await build({
  configFile: false,
  logLevel: "silent",
  publicDir: false,
  build: {
    write: false,
    minify: false,
    lib: { entry, name: "ctiBatchFixture", formats: ["iife"] },
  },
});
const source = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (f) => f.type === "chunk",
).code;
let fault = false,
  malformed = false;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.end('<script src="/test.js"></script>');
      return;
    }
    if (req.url === "/test.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(source);
      return;
    }
    if (req.url.includes("first=8") && fault) {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Retry-After": "120",
      });
      res.end('{"error":"Workspace busy"}');
      return;
    }
    const response = await f.fetch(req.url);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const bytes = Buffer.from(await response.arrayBuffer());
    res.end(
      malformed && req.url.includes("chunk-batch")
        ? bytes.subarray(0, -1)
        : bytes,
    );
  } catch (e) {
    res.writeHead(500);
    res.end("Synthetic fixture failed");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CTI_CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.evaluate(async () => {
    window.store = await window.makeStore();
  });
  fault = true;
  const error = await page.evaluate(async () => {
    try {
      await window.store.get("record");
      return null;
    } catch (e) {
      return e.message;
    }
  });
  assert.match(error, /8\/18 chunks retained/);
  fault = false;
  const data = await page.evaluate(
    async () => (await window.store.get("record")).data,
  );
  assert.equal(hash(Buffer.from(JSON.stringify(data))), src.sha256);
  assert.equal(f.stats.calls.filter((c) => c.first === 0).length, 1);
  const counts = await page.evaluate(() => window.trace.snapshot().counts);
  assert.equal(counts.reused_chunks, 8);
  assert.equal(counts.chunks_acquired, 18);
  malformed = true;
  assert.match(
    await page.evaluate(async () => {
      try {
        await window.store.get("record");
        return "";
      } catch (e) {
        return e.message;
      }
    }),
    /invalid/,
  );
  malformed = false;
  // Reload discards in-memory partial buffers; server originals survive unchanged.
  fault = true;
  await page.evaluate(async () => {
    try {
      await window.store.get("record");
    } catch {}
  });
  await page.reload();
  fault = false;
  f.reset();
  const after = await page.evaluate(async () => {
    const s = await window.makeStore();
    return (await s.get("record")).data;
  });
  assert.equal(hash(Buffer.from(JSON.stringify(after))), src.sha256);
  assert.equal(f.stats.calls.filter((c) => c.first === 0).length, 1);
  console.log(
    "CTI_BROWSER_DOWNLOAD_BATCH_PASS " +
      JSON.stringify({
        chunks: 18,
        batches: 3,
        exactHash: true,
        resume: true,
        malformedRejected: true,
        reloadPreservesOriginal: true,
      }),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  f.sql.close();
  await rm(scratch, { recursive: true, force: true });
}
