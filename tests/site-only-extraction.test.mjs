import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) =>
  fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("normal CTI operator flow has no manual extractor delivery path", () => {
  const app = read("web/App.tsx");
  const workspace = read("web/FullWorkspace.tsx");
  const ownerAction = read("web/OwnerActionCard.tsx");
  const worker = read("src/worker/evidence.worker.ts");
  const types = read("src/domain/types.ts");

  for (const [name, source] of [
    ["App", app],
    ["FullWorkspace", workspace],
    ["OwnerActionCard", ownerAction],
  ]) {
    assert.doesNotMatch(source, /Get extractor scripts/i, name);
    assert.doesNotMatch(source, /Copy Script/i, name);
    assert.doesNotMatch(source, /Download Script/i, name);
    assert.doesNotMatch(source, /copyScript\s*\(/, name);
    assert.doesNotMatch(source, /navigator\.clipboard\.writeText\([^)]*extractor/i, name);
    assert.doesNotMatch(source, /browser console/i, name);
    assert.doesNotMatch(source, /Download item script/i, name);
    assert.doesNotMatch(source, /Copy this item.?s check/i, name);
  }

  assert.match(ownerAction, /Open background extraction/);
  assert.doesNotMatch(ownerAction, /buildItemCheckScript/);
  assert.doesNotMatch(worker, /data\.kind\s*===\s*["']extractor["']/);
  assert.doesNotMatch(types, /kind:\s*["']extractor["']/);
});

test("site background worker owns internal extractor injection", () => {
  const background = read("workers/coursera-extractor/index.ts");
  assert.match(
    background,
    /import\s*\{\s*courseraSource\s*\}\s*from\s*["']\.\.\/\.\.\/src\/generated\/extractor-sources\.js["']/,
  );
  assert.match(background, /page\.addScriptTag\(\{\s*content:\s*courseraSource\s*\}\)/);
  assert.match(background, /evaluateCourseraCapture\(/);
});


test("background extraction persists browser checkpoints for workflow restart", () => {
  const background = read("workers/coursera-extractor/index.ts");
  const completion = read("src/extractors/coursera/completion.js");
  assert.match(background, /runtimeStateKey/);
  assert.match(background, /context\.storageState\(\{ indexedDB: true \}\)/);
  assert.match(background, /saveRuntimeState\(/);
  assert.match(background, /loadRuntimeState\(/);
  assert.match(background, /await env\.ARTIFACTS\.delete\(runtimeStateKey\(payload\.id\)\)/);
  assert.match(completion, /localStorage\.getItem\(key\)/);
  assert.match(completion, /CTI_CHECKPOINT_TTL_MS/);
});
