import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) =>
  fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("normal CTI operator flow defaults to current local Chrome extraction", () => {
  const app = read("web/OwnerWorkspace.tsx");
  const workspace = read("web/CourseraExtractionWorkspace.tsx");
  const local = read("web/LocalCourseraExtraction.tsx");
  const ownerAction = read("web/OwnerActionCard.tsx");
  const worker = read("src/worker/evidence.worker.ts");
  const types = read("src/domain/types.ts");
  const delivery = read("src/engine/extractor-delivery.js");

  assert.match(local, /ZERO-COST CAPTURE/);
  assert.match(local, /Extract Coursera in your own Chrome/);
  assert.match(local, /getExtractor\("coursera"\)/);
  assert.match(local, /navigator\.clipboard\.writeText\(current\.script\)/);
  assert.match(local, /inspectLocalCourseraCaptureFile/);
  assert.match(local, /Use this capture in Compare/);
  assert.match(workspace, /LocalCourseraExtraction/);
  assert.match(workspace, /Optional remote background extraction/);

  assert.match(app, /Get a current extractor/);
  assert.match(app, /kind:\s*"extractor"/);
  assert.match(worker, /data\.kind\s*===\s*["']extractor["']/);
  assert.match(types, /kind:\s*["']extractor["']/);
  assert.match(delivery, /ctiCanonicalCourseraExtractorSource_/);

  assert.match(ownerAction, /buildItemCheckScript/);
  assert.match(ownerAction, /Copy this item’s current check/);
  assert.match(ownerAction, /Open full-course extraction/);
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
  assert.match(background, /ARTIFACTS\.delete\(runtimeStateKey\(payload\.id\)\)/);
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


test("remote Coursera extraction remains optional and organization SSO is on-demand", () => {
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

  assert.match(workspace, /Optional remote background extraction/);
  assert.match(workspace, /Start remote extraction/);
  assert.match(workspace, /Continue with Okta SSO/);
  assert.doesNotMatch(workspace, />Connect Coursera</);
});

test("SSO automation never types credentials or submits forms", () => {
  const background = read("workers/coursera-extractor/index.ts");
  assert.doesNotMatch(background, /\.fill\s*\(/);
  assert.doesNotMatch(background, /\.type\s*\(/);
  assert.doesNotMatch(background, /keyboard\.type/);
  assert.doesNotMatch(background, /input\[type=["']password/);
});


test("Workflow extraction cooperatively chunks below Cloudflare's 30 minute timeout", () => {
  const background = read("workers/coursera-extractor/index.ts");
  const entry = read("src/extractors/coursera/entry.js");
  const navigation = read("src/extractors/coursera/navigation.js");

  assert.doesNotMatch(background, /timeout:\s*["']2 hours 10 minutes["']/);
  assert.match(background, /EXTRACTION_CHUNK_ACTIVE_MS\s*=\s*25\s*\*\s*60\s*\*\s*1000/);
  assert.match(background, /EXTRACTION_CHUNK_MONITOR_MS\s*=\s*27\s*\*\s*60\s*\*\s*1000/);
  assert.match(background, /MAX_EXTRACTION_CHUNKS\s*=\s*9/);
  assert.match(background, /timeout:\s*["']30 minutes["']/);
  assert.match(
    background,
    /limit:\s*1[\s\S]*delay:\s*["']30 seconds["'][\s\S]*backoff:\s*["']constant["']/,
  );
  assert.doesNotMatch(background, /limit:\s*4/);
  assert.match(background, /runExtractionChunk\(/);
  assert.match(background, /chunkResult\.state\s*===\s*["']DONE["']/);
  assert.match(background, /state:\s*["']CONTINUE["']/);

  assert.match(entry, /__CTI_BACKGROUND_CHUNK_DEADLINE_MS/);
  assert.match(entry, /cooperativeChunkYielded/);
  assert.match(entry, /NEXT_ITEM_REQUIRES_FULL_ATTEMPT_BUDGET/);
  const boundaryGuard = entry.indexOf(
    "remainingCrawlBudgetMs<requiredAttemptBudgetMs",
  );
  const attemptIncrement = entry.indexOf(
    "fp.payload.captureAttempts=Math.min",
    boundaryGuard,
  );
  assert.ok(boundaryGuard >= 0, "item-aware cooperative boundary guard is missing");
  assert.ok(
    attemptIncrement > boundaryGuard,
    "capture attempt must not be incremented before a safe chunk boundary is proven",
  );

  assert.match(entry, /Number\(contract\.attempts\s*\|\|\s*0\)===0/);
  assert.match(
    entry,
    /attempts>0\s*&&\s*attempts<CTI_MAX_ITEM_ATTEMPTS/,
  );
  assert.match(entry, /boundedBudgetMs/);
  assert.doesNotMatch(entry, /options\.budgetMs\s*\|\|\s*Infinity/);
  assert.match(
    entry,
    /CTI_BACKGROUND_FINALIZE_RESERVE_MS=backgroundChunkMode\?3\*60\*1000:0/,
  );
  assert.match(entry, /evidenceWorkDeadline/);
  assert.match(entry, /cooperativePartialCapture/);
  assert.match(
    entry,
    /targetedItemPayloadProbes\([^;]*probeOptions\)/s,
  );
  assert.match(
    entry,
    /automaticDeepVerify\([^;]*probeOptions\)/s,
  );
  assert.match(navigation, /hydrateOutlineSurfaceForCrawl\(options\)/);
  assert.match(navigation, /Date\.now\(\)>=deadline/);
  assert.match(background, /loadRuntimeState\(/);
  assert.match(background, /saveRuntimeState\(/);
  assert.match(background, /storageState\(\{ indexedDB: true \}\)/);
});

test("cross-origin plugin observations survive cooperative chunk boundaries", () => {
  const background = read("workers/coursera-extractor/index.ts");
  assert.match(background, /backgroundFrameEvidenceKey/);
  assert.match(background, /loadBackgroundFrameEvidence\(/);
  assert.match(background, /saveBackgroundFrameEvidence\(/);
  assert.match(
    background,
    /saveRuntimeState\([\s\S]*saveBackgroundFrameEvidence\(/,
  );
  assert.match(
    background,
    /ARTIFACTS\.delete\(backgroundFrameEvidenceKey\(payload\.id\)\)/,
  );
});


test("Browser Run acquisition backpressure converts temporary 429s into waits", () => {
  const background = read("workers/coursera-extractor/index.ts");

  assert.match(
    background,
    /import\s*\{[^}]*limits\s+as\s+playwrightLimits[^}]*\}\s*from\s*["']@cloudflare\/playwright["']/s,
  );
  assert.match(background, /playwrightLimits\(env\.BROWSER\)/);
  assert.doesNotMatch(background, /env\.BROWSER\?\.limits/);
  assert.doesNotMatch(background, /env\.BROWSER\.limits\(/);
  assert.match(background, /allowedBrowserAcquisitions/);
  assert.match(background, /maxConcurrentSessions/);
  assert.match(background, /timeUntilNextAllowedBrowserAcquisition/);
  assert.match(background, /waitForBrowserRunCapacity\(/);
  assert.match(background, /wait for Browser Run capacity chunk/);
  assert.match(background, /launchBrowserWithRateLimitRecovery\(/);
  assert.match(background, /attempt <= 3/);
  assert.match(background, /fallbackMs = 25_000/);
  assert.match(background, /maxWaitMs = 11 \* 60 \* 1000/);
  assert.equal(
    (background.match(/timeout:\s*["']12 minutes["']/g) || []).length,
    2,
    "both Browser Run capacity waits must outlast orphaned 10-minute keep-alive sessions",
  );
  assert.match(background, /browserRunCapacitySummary/);
  assert.match(
    background,
    /Cloudflare Browser Run rate-limited browser startup · retrying in/,
  );
  assert.match(
    background,
    /browser time limit exceeded for today/i,
  );
  assert.match(
    background,
    /Workers Free, Browser Run is limited to 10 browser minutes per UTC day/,
  );
  assert.doesNotMatch(
    background,
    /const browser = await launch\(env\.BROWSER, \{ keep_alive: 600_000 \}\);/,
  );
  assert.doesNotMatch(
    background,
    /return await launch\(env\.BROWSER, \{ keep_alive: 600_000 \}\)/,
  );
  assert.match(
    background,
    /return await launch\(env\.BROWSER, \{[\s\S]*keep_alive:\s*600_000,[\s\S]*outboundByHost:\s*\{\},[\s\S]*\}\)/,
  );
  assert.match(
    background,
    /newer Browser Binding RPC launch\(\) path/,
  );
});

test("Browser Run launch is forced onto the RPC binding path", () => {
  const background = read("workers/coursera-extractor/index.ts");
  assert.match(background, /outboundByHost:\s*\{\}/);
  assert.match(background, /RPC-backed launch/);
  assert.doesNotMatch(
    background,
    /launch\(env\.BROWSER, \{\s*keep_alive:\s*600_000\s*\}\)/,
  );
});
