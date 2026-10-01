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


test("Coursera extraction is single-click and organization SSO is on-demand", () => {
  const background = read("workers/coursera-extractor/index.ts");
  const workspace = read("web/CourseraExtractionWorkspace.tsx");

  assert.doesNotMatch(
    background,
    /Connect Coursera before starting a background extraction/,
  );
  assert.match(background, /completeInteractiveOrganizationSso/);
  assert.match(background, /advanceToOrganizationSso/);
  assert.match(
    background,
    /organization.*sign|single\\s\\*sign|\\bsso\\b|work\\s\\*account/i,
  );
  assert.match(background, /Complete Okta SSO\/MFA/);
  assert.match(
    background,
    /context\.storageState\(\{ indexedDB: true \}\)/,
  );

  assert.match(workspace, />\s*\{extractionActive \? "Extraction running…" : "Extract course"\}\s*</);
  assert.doesNotMatch(workspace, />Connect Coursera</);
  assert.match(workspace, /Continue with Okta SSO/);
  assert.match(workspace, /Okta only if needed/);
});

test("SSO automation never types credentials or submits forms", () => {
  const background = read("workers/coursera-extractor/index.ts");
  assert.doesNotMatch(background, /\.fill\s*\(/);
  assert.doesNotMatch(background, /\.type\s*\(/);
  assert.doesNotMatch(background, /keyboard\.type/);
  assert.doesNotMatch(background, /input\[type=["']password/);
});


test("Workflow extraction step never exceeds Cloudflare's 30 minute timeout limit", () => {
  const background = read("workers/coursera-extractor/index.ts");
  assert.doesNotMatch(background, /timeout:\s*["']2 hours 10 minutes["']/);
  assert.match(background, /timeout:\s*["']30 minutes["']/);
  assert.match(
    background,
    /limit:\s*4[\s\S]*delay:\s*["']10 seconds["'][\s\S]*backoff:\s*["']constant["']/,
  );
  assert.match(background, /loadRuntimeState\(/);
  assert.match(background, /saveRuntimeState\(/);
  assert.match(background, /storageState\(\{ indexedDB: true \}\)/);
});
