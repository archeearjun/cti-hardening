import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runProbe } from "./probe-core.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || "runner";
if (!["runner", "both"].includes(mode)) throw Error("USE_RUNNER_OR_BOTH");
const resultPath = resolve(process.argv[3] || join(directory, "public-probe-result.json"));
let child, temporary, hardStopped = false;
const fixedFailure = (code) => ({ kind: "CTI_BOUNDED_PUBLIC_ACCESS_PROBE", outcome: code, courseCaptured: false, retainedContent: false, productionChanged: false });

async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const kill = (signal) => {
    try { process.platform === "win32" ? child.kill(signal) : process.kill(-child.pid, signal); } catch {}
  };
  kill("SIGTERM");
  await Promise.race([new Promise((r) => child.once("exit", r)), delay(1500)]);
  if (child.exitCode === null && child.signalCode === null) kill("SIGKILL");
}

async function edgeProbe() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) return fixedFailure("REMOTE_PREVIEW_CREDENTIALS_NOT_CONFIGURED");
  const nonce = randomBytes(32).toString("hex");
  temporary = await mkdtemp(join(directory, ".preview-"));
  const loader = join(temporary, "entry.mjs");
  await writeFile(loader, `import {createProbeWorker} from '../worker-core.mjs';\nexport default createProbeWorker(${JSON.stringify(nonce)});\n`);
  const config = join(temporary, "wrangler.json");
  await writeFile(config, JSON.stringify({ name: "cti-public-read-probe-" + randomBytes(6).toString("hex"), main: "entry.mjs", compatibility_date: "2026-10-01", workers_dev: false, preview_urls: false, routes: [], observability: { enabled: false } }));
  const port = 18585;
  // Wrangler logs can contain preview credentials. Buffer only in memory and
  // NEVER print, serialize, or upload their contents, including on failure.
  let logBytes = 0;
  const logChunks = [];
  child = spawn(process.platform === "win32" ? "wrangler.cmd" : "wrangler", ["dev", "--remote", "--config", config, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--log-level", "error"], {
    cwd: process.cwd(), env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  const boundedLogs = (chunk) => {
    const remaining = 262144 - logBytes;
    if (remaining > 0) { logChunks.push(chunk.subarray(0, remaining)); logBytes += Math.min(remaining, chunk.length); }
  };
  child.stdout.on("data", boundedLogs); child.stderr.on("data", boundedLogs);
  let spawnFailure = false;
  child.on("error", () => { spawnFailure = true; });
  const headers = { "X-CTI-Public-Probe-Nonce": nonce };
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline && !hardStopped) {
    if (spawnFailure || child.exitCode !== null || child.signalCode !== null) return fixedFailure("REMOTE_PREVIEW_STARTUP_FAILED");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { headers, signal: AbortSignal.timeout(1200), redirect: "error" });
      if (response.status === 200 && await response.text() === "ready") { ready = true; break; }
    } catch {}
    await delay(500);
  }
  if (!ready) return fixedFailure("REMOTE_PREVIEW_STARTUP_TIMEOUT");
  try {
    const response = await fetch(`http://127.0.0.1:${port}/run`, { method: "POST", headers, signal: AbortSignal.timeout(45000), redirect: "error" });
    if (response.status !== 200) return { ...fixedFailure("REMOTE_PREVIEW_RUN_FAILED"), previewStatus: response.status };
    const text = await response.text();
    if (text.length > 24000) return fixedFailure("REMOTE_PREVIEW_RESULT_BOUND");
    const result = JSON.parse(text);
    if (result.kind !== "CTI_BOUNDED_PUBLIC_ACCESS_PROBE" || result.schemaVersion !== 1 || result.requests > 6 || !Array.isArray(result.results) || result.results.length > 5)
      return fixedFailure("REMOTE_PREVIEW_RESULT_INVALID");
    return result;
  } catch { return fixedFailure("REMOTE_PREVIEW_NETWORK_OR_RUNTIME_FAILURE"); }
}

let timer;
try {
  const work = Promise.all([runProbe(), mode === "both" ? edgeProbe() : Promise.resolve(fixedFailure("REMOTE_PREVIEW_NOT_REQUESTED"))]);
  const bounded = new Promise((r) => { timer = setTimeout(() => { hardStopped = true; void stopChild(); r(null); }, 112000); });
  const result = await Promise.race([work, bounded]);
  const output = result ? { runner: result[0], edge: result[1] } : { runner: fixedFailure("OVERALL_DEADLINE"), edge: fixedFailure("OVERALL_DEADLINE") };
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(output, null, 2) + "\n");
  process.stdout.write(JSON.stringify(output) + "\n");
} finally {
  clearTimeout(timer); await stopChild();
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
