import assert from "node:assert/strict";
import { access, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
async function executable(candidate) {
  try { await access(candidate, constants.X_OK); return candidate; } catch { return null; }
}
async function runtime() {
  const selected = process.env.CTI_WORKERD_PATH;
  let binary = selected ? await executable(path.resolve(selected)) : null;
  if (selected && !binary) throw Error("CTI_WORKERD_PATH does not identify an executable workerd binary.");
  if (!selected) for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    binary = await executable(path.join(directory, process.platform === "win32" ? "workerd.exe" : "workerd"));
    if (binary) break;
  }
  if (!binary) throw Error("workerd is required. Run npx --yes --package=wrangler@4.143.0 -- node tools/worker-panopto-provider-check.mjs, or set CTI_WORKERD_PATH.");
  for (const initial of [binary, await realpath(binary)]) {
    let directory = path.dirname(initial);
    for (let count = 0; count < 8; count++) {
      for (const suffix of ["workerd.capnp", "workerd/workerd.capnp", "node_modules/workerd/workerd.capnp"]) {
        const schema = path.join(directory, suffix);
        try { await access(schema, constants.R_OK); return { binary, schema }; } catch {}
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw Error("The workerd package schema could not be located beside the executable. Use the workerd installed by Wrangler.");
}
const { binary, schema } = await runtime();
const scratch = await mkdtemp(path.join(os.tmpdir(), "cti-panopto-workerd-"));
try {
  const built = await build({ root, configFile: false, publicDir: false, logLevel: "silent",
    build: { write: false, emptyOutDir: false, minify: false, target: "esnext",
      lib: { entry: { providerCheck: path.join(root, "tools/fixtures/worker-panopto-provider.mjs"),
        mockUpstream: path.join(root, "tools/fixtures/worker-panopto-upstream.mjs") }, formats: ["es"] },
      rollupOptions: { output: { entryFileNames: "[name].mjs", chunkFileNames: "[name]-[hash].mjs" } } } });
  const output = (Array.isArray(built) ? built : [built]).flatMap(result => result.output);
  assert(output.length > 0 && output.every(item => item.type === "chunk"), "The runtime fixture must contain only bundled JavaScript modules.");
  for (const item of output) {
    assert.equal(path.basename(item.fileName), item.fileName);
    await writeFile(path.join(scratch, item.fileName), item.code);
  }
  // Both outbound routes are explicitly in-memory services. There are no
  // listening sockets and no implicit internet capability, even for bad URLs.
  function modules(entry) {
    const ordered = [...output].sort((a, b) => Number(b.fileName === entry) - Number(a.fileName === entry));
    assert.equal(ordered[0].fileName, entry);
    return ordered.map(item => `(name = ${JSON.stringify(item.fileName)}, esModule = embed ${JSON.stringify(item.fileName)})`).join(",");
  }
  const config = `using Workerd = import ${JSON.stringify(schema)};
const config :Workerd.Config = (services = [
  (name = "provider", worker = (compatibilityDate = "2026-10-01", modules = [${modules("providerCheck.mjs")}], globalOutbound = "mock")),
  (name = "mock", worker = (compatibilityDate = "2026-10-01", modules = [${modules("mockUpstream.mjs")}], globalOutbound = "deny")),
  (name = "deny", network = (allow = []))
], sockets = []);
`;
  const configFile = path.join(scratch, "config.capnp");
  await writeFile(configFile, config);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, ["test", configFile, "provider", "-I", path.parse(schema).root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 45000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.timedOut, false, "The no-network workerd regression exceeded its deadline.");
  assert.equal(result.code, 0, "The actual Cloudflare runtime provider regression failed.");
  assert.match(result.stdout + result.stderr, /CTI_WORKERD_PANOPTO_PROVIDER_PASS/);
} finally { await rm(scratch, { recursive: true, force: true }); }
