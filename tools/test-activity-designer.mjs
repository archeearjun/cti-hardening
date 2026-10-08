import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Exercise the imported browser IIFEs in a temporary CommonJS harness.
// Application code stays modular and ungenerated in src/activity-designer.
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cti-activity-tests-"));
try {
  fs.cpSync(path.join(root, "src/activity-designer"), path.join(dir, "src"), {
    recursive: true,
  });
  fs.cpSync(
    path.join(root, "tests/activity-designer"),
    path.join(dir, "tests"),
    { recursive: true },
  );
  fs.cpSync(
    path.join(root, "public/activity-designer"),
    path.join(dir, "dist"),
    { recursive: true },
  );
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(dir, "node_modules"),
    "dir",
  );
  const browser = process.argv.includes("--browser");
  const names = fs
    .readdirSync(path.join(dir, "tests"))
    .filter(
      (n) => n.endsWith(".test.cjs") && n.includes(".browser.") === browser,
    );
  for (const name of names) {
    const run = spawnSync(process.execPath, [path.join(dir, "tests", name)], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_PRIMARY_RUNTIME_NODE_MODULES: path.join(root, "node_modules"),
      },
    });
    process.stdout.write(run.stdout || "");
    process.stderr.write(run.stderr || "");
    if (run.status !== 0) throw Error(name + " failed");
  }
  console.log(
    `Passed ${names.length} activity designer ${browser ? "browser" : "unit/simulation"} suites.`,
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
