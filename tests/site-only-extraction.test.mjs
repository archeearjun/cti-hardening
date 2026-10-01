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


test("background plugin evidence is passive and item-scoped", () => {
  const background = read("workers/coursera-extractor/index.ts");
  const entry = read("src/extractors/coursera/entry.js");
  assert.match(entry, /__CTI_ACTIVE_ITEM_ID/);
  assert.match(background, /collectExternalFramesForItem/);
  assert.match(background, /page\.frames\(\)/);
  assert.match(background, /PLAYWRIGHT_CROSS_ORIGIN_FRAME/);
  assert.match(background, /interactionVerified:\s*false/);
  assert.doesNotMatch(background, /\.play\s*\(/);
  assert.doesNotMatch(background, /frame\.click\s*\(/);
});


test("site can rediscover recent extraction jobs server-side", () => {
  const background = read("workers/coursera-extractor/index.ts");
  const client = read("src/domain/coursera-extraction-http.ts");
  const workspace = read("web/CourseraExtractionWorkspace.tsx");
  assert.match(background, /ownerJobPrefix/);
  assert.match(background, /path\[0\] === "jobs".*method === "GET"/s);
  assert.match(client, /recentCourseraExtractions/);
  assert.match(workspace, /Recent background extractions/);
  assert.match(workspace, /recentCourseraExtractions/);
});
