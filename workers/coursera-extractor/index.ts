import { launch, limits as playwrightLimits } from "@cloudflare/playwright";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { courseraSource } from "../../src/generated/extractor-sources.js";
import { CTI_RELEASE_REGISTRY_ } from "../../src/engine/release.js";
import {
  captureContractSummaryV6150,
  finalCaptureAccountingV6150,
} from "../../src/extractors/coursera/completion.js";
import {
  evaluateCourseraCapture,
  parseCourseraShellUrl,
  type CourseraExtractionStatus,
} from "../../src/domain/coursera-background-extraction.ts";

type Env = {
  BROWSER: any;
  ARTIFACTS: any;
  EXTRACTION_WORKFLOW: any;
  CTI_SESSION_KEY?: string;
};

type WorkflowPayload =
  | {
      kind: "connect";
      id: string;
      ownerHash: string;
      shellUrl: string;
      courseId: string;
    }
  | {
      kind: "extract";
      id: string;
      ownerHash: string;
      shellUrl: string;
      courseId: string;
    };

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const now = () => new Date().toISOString();
const statusKey = (id: string) => `jobs/${id}/status.json`;
const artifactKey = (id: string) => `jobs/${id}/capture.json`;
const runtimeStateKey = (id: string) => `jobs/${id}/runtime-state.json`;
const backgroundFrameEvidenceKey = (id: string) =>
  `jobs/${id}/background-frame-evidence.json`;
const sessionKey = (ownerHash: string) => `sessions/${ownerHash}/state.json`;
const EXTRACTION_CHUNK_ACTIVE_MS = 25 * 60 * 1000;
const EXTRACTION_CHUNK_MONITOR_MS = 27 * 60 * 1000;
const MAX_EXTRACTION_CHUNKS = 9;
const sessionMetaKey = (ownerHash: string) => `sessions/${ownerHash}/meta.json`;
const ownerJobPrefix = (ownerHash: string) => `owners/${ownerHash}/jobs/`;
const ownerJobKey = (ownerHash: string, createdAt: string, id: string) =>
  ownerJobPrefix(ownerHash) +
  createdAt.replace(/[^0-9]/g, "") +
  "-" +
  id +
  ".json";

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

async function readBody(request: Request, limit = 64 * 1024) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > limit) fail("Request body is too large.", 413);
  try {
    return bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
  } catch {
    fail("Request body must be valid JSON.");
  }
}

async function ownerHash(email: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.toLowerCase().trim()),
  );
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

function requireCaller(request: Request) {
  const email = request.headers.get("x-cti-user")?.trim().toLowerCase() || "";
  const role = request.headers.get("x-cti-role") || "";
  if (!email) fail("Trusted CTI user identity is missing.", 401);
  return { email, role };
}

async function putJson(env: Env, key: string, value: unknown) {
  await env.ARTIFACTS.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function getJson<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.ARTIFACTS.get(key);
  if (!object) return null;
  try {
    return (await object.json()) as T;
  } catch {
    return null;
  }
}

async function writeStatus(
  env: Env,
  value: CourseraExtractionStatus,
  patch: Partial<CourseraExtractionStatus> = {},
) {
  const next = { ...value, ...patch, updatedAt: now() };
  await putJson(env, statusKey(value.id), next);
  return next;
}

type BrowserRunLimits = {
  activeSessions?: Array<{ id?: string }>;
  allowedBrowserAcquisitions?: number;
  maxConcurrentSessions?: number;
  timeUntilNextAllowedBrowserAcquisition?: number;
};

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

function browserRunErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

function browserRunDailyQuotaExceeded(error: unknown) {
  return /browser time limit exceeded for today/i.test(
    browserRunErrorMessage(error),
  );
}

function browserRunRateLimited(error: unknown) {
  const status = Number((error as { status?: number })?.status || 0);
  return (
    status === 429 ||
    /(?:code:\s*429|rate limit exceeded|too many requests|browser instance limit reached)/i.test(
      browserRunErrorMessage(error),
    )
  );
}

async function browserRunLimits(env: Env): Promise<BrowserRunLimits | null> {
  try {
    // @cloudflare/playwright exposes limits() as a package function that takes
    // the browser binding. It is not a method on env.BROWSER.
    return (await playwrightLimits(env.BROWSER)) as BrowserRunLimits;
  } catch {
    return null;
  }
}

function browserRunCapacitySummary(limits: BrowserRunLimits | null) {
  if (!limits) return "limits unavailable";
  const active = Array.isArray(limits.activeSessions)
    ? limits.activeSessions.length
    : 0;
  const max = Number(limits.maxConcurrentSessions || 0);
  const allowed = Number(limits.allowedBrowserAcquisitions || 0);
  const next = Number(limits.timeUntilNextAllowedBrowserAcquisition || 0);
  return `active=${active}/${max || "?"}, acquisitionAllowed=${allowed}, nextAcquisition=${next}`;
}

function browserRunHasCapacity(limits: BrowserRunLimits | null) {
  if (!limits) return true;
  const allowed = Number(limits.allowedBrowserAcquisitions);
  const max = Number(limits.maxConcurrentSessions);
  const active = Array.isArray(limits.activeSessions)
    ? limits.activeSessions.length
    : 0;
  const acquisitionAvailable = !Number.isFinite(allowed) || allowed > 0;
  const concurrencyAvailable =
    !Number.isFinite(max) || max <= 0 || active < max;
  return acquisitionAvailable && concurrencyAvailable;
}

function browserRunWaitMs(limits: BrowserRunLimits | null, fallbackMs = 25_000) {
  const raw = Number(limits?.timeUntilNextAllowedBrowserAcquisition || 0);
  if (!Number.isFinite(raw) || raw <= 0) return fallbackMs;
  // Browser Run exposes a waiting period. Older clients have represented
  // sub-minute values differently, so accept both seconds and milliseconds.
  const interpretedMs = raw <= 60 ? raw * 1000 : raw;
  return Math.max(1_000, Math.min(30_000, interpretedMs + 1_000));
}

async function waitForBrowserRunCapacity(
  env: Env,
  payload: WorkflowPayload,
  maxWaitMs = 11 * 60 * 1000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const limits = await browserRunLimits(env);
    if (!limits || browserRunHasCapacity(limits)) return;
    const active = Array.isArray(limits.activeSessions)
      ? limits.activeSessions.length
      : 0;
    const max = Number(limits.maxConcurrentSessions || 0);
    const waitMs =
      Number.isFinite(max) && max > 0 && active >= max
        ? 5_000
        : browserRunWaitMs(limits, 5_000);
    const current = await getJson<CourseraExtractionStatus>(
      env,
      statusKey(payload.id),
    );
    if (current)
      await writeStatus(env, current, {
        state: "RUNNING",
        phase:
          Number.isFinite(max) && max > 0
            ? `Waiting for Cloudflare Browser Run capacity · ${active}/${max} browsers active`
            : "Waiting for Cloudflare Browser Run capacity",
        liveViewUrl: "",
      });
    await sleep(Math.min(waitMs, maxWaitMs - (Date.now() - startedAt)));
  }
  const finalLimits = await browserRunLimits(env);
  throw new Error(
    `Cloudflare Browser Run has no browser capacity available after CTI waited for existing sessions to clear. No extraction work was started. Capacity: ${browserRunCapacitySummary(finalLimits)}.`,
  );
}

async function launchBrowserWithRateLimitRecovery(
  env: Env,
  status: CourseraExtractionStatus,
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // @cloudflare/playwright 1.3.6 normally acquires through its legacy
      // HTTP /v1/devtools/browser path. Supplying an outboundByHost map makes
      // the package use the newer Browser Binding RPC launch() path instead.
      // An empty map does not route any hostname through another Worker.
      return await launch(env.BROWSER, {
        keep_alive: 600_000,
        outboundByHost: {},
      });
    } catch (error) {
      lastError = error;
      if (browserRunDailyQuotaExceeded(error))
        throw new Error(
          "Cloudflare Browser Run reports that today's browser-time quota is exhausted. CTI did not start extraction. If this account uses Workers Free, Browser Run is limited to 10 browser minutes per UTC day; use Workers Paid or retry after the quota resets.",
        );
      if (!browserRunRateLimited(error)) throw error;
      if (attempt >= 3) break;

      const limits = await browserRunLimits(env);
      if (limits && !browserRunHasCapacity(limits)) {
        await waitForBrowserRunCapacity(
          env,
          {
            kind: "extract",
            id: status.id,
            ownerHash: String((status as any).ownerHash || ""),
            shellUrl: String(status.shellUrl || ""),
            courseId: String(status.courseId || ""),
          },
          11 * 60 * 1000,
        );
      }
      const waitMs = browserRunWaitMs(limits);
      const current =
        (await getJson<CourseraExtractionStatus>(env, statusKey(status.id))) ||
        status;
      await writeStatus(env, current, {
        state: "RUNNING",
        phase: `Cloudflare Browser Run rate-limited browser startup · retrying in ${Math.ceil(waitMs / 1000)}s`,
        liveViewUrl: "",
      });
      await sleep(waitMs);
    }
  }
  const finalLimits = await browserRunLimits(env);
  throw new Error(
    `Cloudflare Browser Run's RPC-backed launch is still being rejected after CTI waited and retried. No extraction work was started. Capacity: ${browserRunCapacitySummary(finalLimits)}. Last error: ${browserRunErrorMessage(lastError)}`,
  );
}

async function ownedStatus(env: Env, id: string, hash: string) {
  const value = await getJson<CourseraExtractionStatus>(env, statusKey(id));
  if (!value || value.ownerHash !== hash) fail("Extraction job not found.", 404);
  return value;
}

function cleanStatus(status: CourseraExtractionStatus) {
  const { ownerHash: _ownerHash, ...safe } = status;
  return safe;
}

async function encryptionKey(env: Env) {
  if (!env.CTI_SESSION_KEY || env.CTI_SESSION_KEY.length < 24)
    fail("CTI_SESSION_KEY is not configured for the extractor Worker.", 503);
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(env.CTI_SESSION_KEY),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

const b64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const unb64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function encryptState(env: Env, value: unknown) {
  const key = await encryptionKey(env),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    plain = new TextEncoder().encode(JSON.stringify(value)),
    encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain),
    );
  return JSON.stringify({ v: 1, iv: b64(iv), data: b64(encrypted) });
}

async function decryptState(env: Env, value: string) {
  const envelope = JSON.parse(value);
  if (
    envelope?.v !== 1 ||
    typeof envelope.iv !== "string" ||
    typeof envelope.data !== "string"
  )
    throw new Error("Saved Coursera session has an unsupported format.");
  const key = await encryptionKey(env),
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(envelope.iv) },
      key,
      unb64(envelope.data),
    );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function saveSession(
  env: Env,
  hash: string,
  storageState: unknown,
  shellUrl: string,
  courseId: string,
) {
  await env.ARTIFACTS.put(sessionKey(hash), await encryptState(env, storageState), {
    httpMetadata: { contentType: "application/json" },
  });
  await putJson(env, sessionMetaKey(hash), {
    connected: true,
    connectedAt: now(),
    verifiedShellUrl: shellUrl,
    verifiedCourseId: courseId,
  });
}

async function loadSession(env: Env, hash: string) {
  const object = await env.ARTIFACTS.get(sessionKey(hash));
  if (!object) return null;
  return decryptState(env, await object.text());
}

async function loadRuntimeState(env: Env, id: string) {
  const object = await env.ARTIFACTS.get(runtimeStateKey(id));
  if (!object) return null;
  return decryptState(env, await object.text());
}

async function saveRuntimeState(env: Env, id: string, storageState: unknown) {
  await env.ARTIFACTS.put(
    runtimeStateKey(id),
    await encryptState(env, storageState),
    { httpMetadata: { contentType: "application/json" } },
  );
}

async function verifiedAuthoringPage(page: any, shellUrl: string, courseId: string) {
  await page.goto(shellUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(2_000);
  const url = new URL(page.url());
  if (
    url.hostname !== "www.coursera.org" ||
    !url.pathname.includes(`/teach/`) ||
    !url.pathname.includes(`/${courseId}/content`)
  )
    return false;
  const state = await page.evaluate(async (expectedCourseId: string) => {
    const title = document.title;
    const text = (document.body?.innerText || "").slice(0, 4000);
    let materialsOk = false;
    try {
      const response = await fetch(
        "/api/authoringCourseMaterials.v1/" +
          encodeURIComponent(expectedCourseId) +
          "/",
        { credentials: "include" },
      );
      materialsOk = response.ok;
    } catch {
      materialsOk = false;
    }
    return { title, text, materialsOk };
  }, courseId);
  if (/sign in|log in|access denied|not authorized/i.test(state.text))
    return false;
  return (
    state.materialsOk &&
    (/edit content/i.test(state.title) ||
      /course material|content/i.test(state.text))
  );
}

function organizationSsoLabel(urlValue: string) {
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    if (/okta/.test(host)) return "Okta";
    if (!/(^|\.)coursera\.org$/.test(host)) return "organization SSO";
  } catch {}
  return "Coursera organization SSO";
}

async function advanceToOrganizationSso(page: any) {
  const attempts: Array<{ url: string; action: string }> = [];
  const ssoPattern =
    /(sign|log)\s*(in|up).*organization|organization.*(sign|log)\s*(in|up)|single\s*sign[- ]?on|\bsso\b|work\s*account|company\s*account/i;

  for (let round = 0; round < 4; round++) {
    const currentUrl = String(page.url() || "");
    let currentHost = "";
    try {
      currentHost = new URL(currentUrl).hostname.toLowerCase();
    } catch {}
    if (currentHost && !/(^|\.)coursera\.org$/.test(currentHost))
      return {
        provider: organizationSsoLabel(currentUrl),
        url: currentUrl,
        attempts,
      };

    const candidates = page.locator("button,a,[role='button']");
    const count = Math.min(await candidates.count(), 120);
    let clicked = false;
    for (let index = 0; index < count; index++) {
      const candidate = candidates.nth(index);
      let label = "";
      try {
        if (!(await candidate.isVisible())) continue;
        label = String(await candidate.innerText()).replace(/\s+/g, " ").trim();
      } catch {
        continue;
      }
      if (!label || !ssoPattern.test(label)) continue;
      attempts.push({ url: currentUrl, action: label.slice(0, 180) });
      try {
        await candidate.click({ timeout: 8_000 });
        clicked = true;
        await Promise.race([
          page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {}),
          page.waitForTimeout(2_000),
        ]);
      } catch {}
      break;
    }
    if (!clicked) break;
  }

  return {
    provider: organizationSsoLabel(String(page.url() || "")),
    url: String(page.url() || ""),
    attempts,
  };
}

async function completeInteractiveOrganizationSso(
  env: Env,
  status: CourseraExtractionStatus,
  context: any,
  page: any,
  payload: Extract<WorkflowPayload, { kind: "extract" }>,
) {
  status = await writeStatus(env, status, {
    state: "AWAITING_LOGIN",
    phase: "Preparing Coursera organization SSO",
    liveViewUrl: "",
  });

  const advance = await advanceToOrganizationSso(page);
  const cdp = await context.newCDPSession(page);
  const live = await (cdp as any).send("Cloudflare.getLiveView", {
    mode: "tab",
    expiresInMs: 15 * 60 * 1000,
  });
  const provider = organizationSsoLabel(String(page.url() || advance.url || ""));
  status = await writeStatus(env, status, {
    state: "AWAITING_LOGIN",
    phase:
      provider === "Okta"
        ? "Complete Okta SSO/MFA — CTI will resume this extraction"
        : "Complete your Coursera organization SSO/Okta sign-in — CTI will resume",
    liveViewUrl: live.devtoolsFrontendUrl,
  });

  const completed = new Promise<any>((resolve) => {
    (cdp as any).once("Cloudflare.handoffComplete", resolve);
  });
  await (cdp as any).send("Cloudflare.handoff", {
    instructions:
      "Use your normal Coursera work account through your organization's SSO/Okta flow. Do not create a personal Coursera account. Complete Okta and MFA if requested. When the Coursera authoring shell is visible, choose Done. CTI will save this authenticated browser session and continue the same extraction automatically.",
    timeout: 15 * 60 * 1000,
  });
  const handoff = await completed;
  if (!handoff?.success)
    throw new Error(
      `Organization SSO handoff did not complete: ${handoff?.reason || "unknown reason"}`,
    );

  status = await writeStatus(env, status, {
    state: "RUNNING",
    phase: "Verifying Coursera authoring access after SSO",
    liveViewUrl: "",
  });
  if (!(await verifiedAuthoringPage(page, payload.shellUrl, payload.courseId)))
    throw new Error(
      "Okta/organization sign-in finished, but this account still could not open the requested Coursera authoring shell.",
    );

  const storageState = await context.storageState({ indexedDB: true });
  await saveSession(
    env,
    payload.ownerHash,
    storageState,
    payload.shellUrl,
    payload.courseId,
  );
  return writeStatus(env, status, {
    state: "RUNNING",
    phase: "SSO complete — starting background extraction",
    liveViewUrl: "",
  });
}

async function readCaptureJson(page: any) {
  const prepared = await page.evaluate(() => {
    const w = window as any;
    if (!w.__CTI_LAST_JSON && w.__CTI_LAST_RESULT)
      w.__CTI_LAST_JSON = JSON.stringify(w.__CTI_LAST_RESULT);
    return {
      done: typeof w.__CTI_LAST_JSON === "string" && w.__CTI_LAST_JSON.length > 1,
      length:
        typeof w.__CTI_LAST_JSON === "string" ? w.__CTI_LAST_JSON.length : 0,
    };
  });
  if (!prepared.done) return "";
  const chunkSize = 512 * 1024,
    pieces: string[] = [];
  for (let offset = 0; offset < prepared.length; offset += chunkSize) {
    pieces.push(
      await page.evaluate(
        ({ offset, size }: { offset: number; size: number }) =>
          String((window as any).__CTI_LAST_JSON || "").slice(
            offset,
            offset + size,
          ),
        { offset, size: chunkSize },
      ),
    );
  }
  return pieces.join("");
}


type BackgroundFrameEvidence = {
  itemId: string;
  observedUrl: string;
  safeUrl: string;
  hostname: string;
  title: string;
  readyState: string;
  status: "CONTENT_OBSERVED" | "LOADING" | "EMPTY" | "ACCESS_OR_ERROR_PAGE";
  textSample: string;
  observedTextLength: number;
  textTruncated: boolean;
  links: string[];
  media: Array<{
    tag: string;
    src: string;
    poster: string;
    duration: number | null;
    trackCount: number;
  }>;
  observedAt: string;
  score: number;
};

async function loadBackgroundFrameEvidence(env: Env, id: string) {
  const object = await env.ARTIFACTS.get(backgroundFrameEvidenceKey(id));
  if (!object) return new Map<string, BackgroundFrameEvidence[]>();
  const decoded = (await decryptState(env, await object.text())) as Record<
    string,
    BackgroundFrameEvidence[]
  >;
  return new Map(
    Object.entries(decoded || {}).map(([itemId, evidence]) => [
      itemId,
      Array.isArray(evidence) ? evidence : [],
    ]),
  );
}

async function saveBackgroundFrameEvidence(
  env: Env,
  id: string,
  evidence: Map<string, BackgroundFrameEvidence[]>,
) {
  const value = Object.fromEntries(evidence.entries());
  await env.ARTIFACTS.put(
    backgroundFrameEvidenceKey(id),
    await encryptState(env, value),
    { httpMetadata: { contentType: "application/json" } },
  );
}

function safeObservedUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    return url.origin + url.pathname;
  } catch {
    return "";
  }
}

function frameMatchesPluginTarget(frameUrl: string, targetUrl: string) {
  try {
    const frame = new URL(frameUrl),
      target = new URL(targetUrl);
    if (frame.hostname === target.hostname) return true;
    if (
      /(?:^|\.)youtube(?:-nocookie)?\.com$/i.test(frame.hostname) &&
      /(?:^|\.)youtube(?:-nocookie)?\.com$|(?:^|\.)youtu\.be$/i.test(
        target.hostname,
      )
    )
      return true;
    return false;
  } catch {
    return false;
  }
}

async function collectExternalFramesForItem(
  page: any,
  itemId: string,
  observations: Map<string, BackgroundFrameEvidence[]>,
) {
  if (!itemId) return;
  const mainFrame = page.mainFrame();
  const existing = observations.get(itemId) || [];
  for (const frame of page.frames()) {
    if (frame === mainFrame) continue;
    const observedUrl = String(frame.url() || "");
    let parsed: URL;
    try {
      parsed = new URL(observedUrl);
    } catch {
      continue;
    }
    if (
      !/^https?:$/.test(parsed.protocol) ||
      parsed.hostname === "www.coursera.org" ||
      /(?:^|\.)coursera\.org$/i.test(parsed.hostname)
    )
      continue;

    let body: any;
    try {
      body = await frame.evaluate(() => {
        const clean = (value: unknown) =>
          String(value || "").replace(/\s+/g, " ").trim();
        const rawText = clean(document.body?.innerText || document.body?.textContent || "");
        const linkValues = Array.from(document.querySelectorAll("a[href]"))
          .slice(0, 160)
          .map((el) => (el as HTMLAnchorElement).href)
          .filter(Boolean);
        const media = Array.from(
          document.querySelectorAll("video,audio"),
        )
          .slice(0, 40)
          .map((el) => {
            const node = el as HTMLMediaElement;
            const tracks = Array.from(node.querySelectorAll("track"));
            return {
              tag: node.tagName.toLowerCase(),
              src: node.currentSrc || node.getAttribute("src") || "",
              poster:
                node instanceof HTMLVideoElement
                  ? node.poster || node.getAttribute("poster") || ""
                  : "",
              duration:
                Number.isFinite(node.duration) && node.duration >= 0
                  ? node.duration
                  : null,
              trackCount: tracks.length,
            };
          });
        return {
          title: document.title || "",
          readyState: document.readyState || "",
          rawText,
          links: linkValues,
          media,
        };
      });
    } catch {
      continue;
    }

    const text = String(body.rawText || ""),
      accessError =
        /^(?:access denied|403 forbidden|404 not found|sign in to continue|log in to continue|unauthorized)\b/i.test(
          text,
        ),
      readyState = String(body.readyState || ""),
      hasBodyEvidence =
        text.length >= 20 ||
        (body.links || []).length > 0 ||
        (body.media || []).length > 0;
    const status: BackgroundFrameEvidence["status"] = accessError
      ? "ACCESS_OR_ERROR_PAGE"
      : readyState === "loading"
        ? "LOADING"
        : hasBodyEvidence
          ? "CONTENT_OBSERVED"
          : "EMPTY";
    const sanitize = (value: string) => safeObservedUrl(String(value || ""));
    const evidence: BackgroundFrameEvidence = {
      itemId,
      observedUrl,
      safeUrl: safeObservedUrl(observedUrl),
      hostname: parsed.hostname,
      title: String(body.title || "").slice(0, 500),
      readyState,
      status,
      textSample: status === "CONTENT_OBSERVED" ? text.slice(0, 256_000) : "",
      observedTextLength: text.length,
      textTruncated: text.length > 256_000,
      links: [...new Set((body.links || []).map(sanitize).filter(Boolean))].slice(
        0,
        120,
      ),
      media: (body.media || [])
        .map((media: any) => ({
          tag: String(media.tag || ""),
          src: sanitize(media.src),
          poster: sanitize(media.poster),
          duration:
            media.duration == null || !Number.isFinite(Number(media.duration))
              ? null
              : Number(media.duration),
          trackCount: Math.max(0, Number(media.trackCount || 0)),
        }))
        .slice(0, 40),
      observedAt: now(),
      score:
        (status === "CONTENT_OBSERVED" ? 1000000 : 0) +
        Math.min(text.length, 500000) +
        (body.links || []).length * 100 +
        (body.media || []).length * 1000,
    };

    const key = evidence.safeUrl || evidence.hostname;
    const index = existing.findIndex(
      (entry) => (entry.safeUrl || entry.hostname) === key,
    );
    if (index < 0) existing.push(evidence);
    else if (evidence.score >= existing[index].score) existing[index] = evidence;
  }
  observations.set(
    itemId,
    existing
      .sort((a, b) => b.score - a.score)
      .slice(0, 20),
  );
}

function applyBackgroundPluginEvidence(
  capture: any,
  observations: Map<string, BackgroundFrameEvidence[]>,
) {
  const fingerprints = Array.isArray(capture?.fingerprints)
    ? capture.fingerprints
    : [];
  let pluginItemsObserved = 0,
    bodyObservedExternalBodies = 0,
    unresolvedExternalBodies = 0;

  for (const fp of fingerprints) {
    const type = String(fp?.typeName || fp?.type || "").toLowerCase();
    if (!/plugin|lti|widget/.test(type)) continue;
    const payload = (fp.payload ||= {}),
      plugin = (payload.pluginEvidence ||= {}),
      observed = observations.get(String(fp.id || "")) || [],
      targets = Array.isArray(plugin.targets)
        ? plugin.targets.map((target: any) => String(target?.url || "")).filter(Boolean)
        : [];
    const matched = observed.filter((frame) => {
      if (!targets.length) return observed.length === 1;
      return targets.some((target) =>
        frameMatchesPluginTarget(frame.observedUrl, target),
      );
    });
    if (!matched.length) continue;

    pluginItemsObserved++;
    const publicFrames = matched.map(({ observedUrl: _observedUrl, score: _score, ...rest }) => rest);
    plugin.backgroundFrames = publicFrames;
    const verified = publicFrames.filter(
      (frame) =>
        frame.status === "CONTENT_OBSERVED" &&
        frame.readyState !== "loading" &&
        (frame.observedTextLength > 0 ||
          frame.links.length > 0 ||
          frame.media.length > 0),
    );
    plugin.externalBodyVerified = verified.length > 0;
    plugin.backgroundCapture = {
      method: "PLAYWRIGHT_CROSS_ORIGIN_FRAME",
      observedFrames: publicFrames.length,
      bodyObservedFrames: verified.length,
      interactionVerified: false,
      scopeComplete: false,
      meaning:
        "Background browser observed the external frame DOM passively. No playback, form submission or protected interaction was performed.",
    };
    if (verified.length) {
      bodyObservedExternalBodies++;
      plugin.readiness = {
        pending: false,
        status: "BACKGROUND_FRAME_CONTENT_OBSERVED",
        readableFrames: verified.length,
        unreadableFrames: publicFrames.length - verified.length,
        interactionVerified: false,
      };
    } else {
      unresolvedExternalBodies++;
      plugin.readiness = {
        pending: false,
        status: "BACKGROUND_FRAME_UNRESOLVED",
        readableFrames: 0,
        unreadableFrames: publicFrames.length,
        interactionVerified: false,
      };
    }
    payload.captureContract = captureContractSummaryV6150(fp);
  }

  if (capture?.meta) {
    capture.meta.backgroundExternalFrameEvidence = {
      method: "PLAYWRIGHT_CROSS_ORIGIN_FRAME",
      pluginItemsObserved,
      bodyObservedExternalBodies,
      unresolvedExternalBodies,
      passiveOnly: true,
    };
    capture.meta.captureAccounting = finalCaptureAccountingV6150(
      fingerprints,
      capture.meta.activeSpaCrawl,
    );
    capture.meta.noSilentMisses = Boolean(
      capture.meta.captureAccounting.noSilentMisses,
    );
  }
  return capture;
}

async function runConnection(env: Env, payload: Extract<WorkflowPayload, { kind: "connect" }>) {
  let status = (await getJson<CourseraExtractionStatus>(
    env,
    statusKey(payload.id),
  ))!;
  const browser = await launchBrowserWithRateLimitRecovery(env, status);
  try {
    const context = await browser.newContext({ bypassCSP: true }),
      page = await context.newPage();

    status = await writeStatus(env, status, {
      state: "AWAITING_LOGIN",
      phase: "Opening Coursera sign-in",
      startedAt: now(),
    });

    await page.goto(payload.shellUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const cdp = await context.newCDPSession(page);
    const live = await (cdp as any).send("Cloudflare.getLiveView", {
      mode: "tab",
      expiresInMs: 15 * 60 * 1000,
    });
    status = await writeStatus(env, status, {
      state: "AWAITING_LOGIN",
      phase: "Sign in to Coursera, complete SSO/MFA, then choose Done",
      liveViewUrl: live.devtoolsFrontendUrl,
    });

    const completed = new Promise<any>((resolve) => {
      (cdp as any).once("Cloudflare.handoffComplete", resolve);
    });
    await (cdp as any).send("Cloudflare.handoff", {
      instructions:
        "Sign in to Coursera with your normal authorized work account. Complete SSO/MFA if requested. When the authoring shell is visible, choose Done.",
      timeout: 15 * 60 * 1000,
    });
    const handoff = await completed;
    if (!handoff?.success)
      throw new Error(
        `Coursera sign-in handoff did not complete: ${handoff?.reason || "unknown reason"}`,
      );

    status = await writeStatus(env, status, {
      phase: "Verifying Coursera authoring access",
      liveViewUrl: "",
    });
    if (!(await verifiedAuthoringPage(page, payload.shellUrl, payload.courseId)))
      throw new Error(
        "Coursera sign-in finished, but this account could not open the requested authoring shell.",
      );

    const storageState = await context.storageState({ indexedDB: true });
    await saveSession(
      env,
      payload.ownerHash,
      storageState,
      payload.shellUrl,
      payload.courseId,
    );
    await writeStatus(env, status, {
      state: "CONNECTED",
      phase: "Coursera connection verified",
      completedAt: now(),
      liveViewUrl: "",
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runExtractionChunk(
  env: Env,
  payload: Extract<WorkflowPayload, { kind: "extract" }>,
  chunkNumber: number,
) {
  const chunkStartedAt = Date.now();
  const chunkDeadline = chunkStartedAt + EXTRACTION_CHUNK_ACTIVE_MS;
  const monitorDeadline = chunkStartedAt + EXTRACTION_CHUNK_MONITOR_MS;
  let status = (await getJson<CourseraExtractionStatus>(
    env,
    statusKey(payload.id),
  ))!;
  const resumedStorageState = await loadRuntimeState(env, payload.id);
  const savedStorageState = await loadSession(env, payload.ownerHash);
  const storageState = resumedStorageState || savedStorageState || null;
  const externalFrameEvidence = await loadBackgroundFrameEvidence(
    env,
    payload.id,
  );

  status = await writeStatus(env, status, {
    state: "RUNNING",
    phase: resumedStorageState
      ? "Resuming authenticated browser from saved item checkpoints"
      : savedStorageState
        ? "Checking saved Coursera/Okta session"
        : "Opening Coursera — organization SSO will appear only if needed",
    startedAt: status.startedAt || now(),
  });

  const browser = await launchBrowserWithRateLimitRecovery(env, status);
  try {
    const contextOptions: Record<string, unknown> = {
      bypassCSP: true,
      acceptDownloads: true,
    };
    if (storageState) contextOptions.storageState = storageState;
    const context = await browser.newContext(contextOptions),
      page = await context.newPage();

    if (!(await verifiedAuthoringPage(page, payload.shellUrl, payload.courseId)))
      status = await completeInteractiveOrganizationSso(
        env,
        status,
        context,
        page,
        payload,
      );

    status = await writeStatus(env, status, {
      state: "RUNNING",
      phase: `Running Coursera extractor ${CTI_RELEASE_REGISTRY_.courseraExtractor.version} · chunk ${chunkNumber}`,
      liveViewUrl: "",
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (error: Error) => {
      if (pageErrors.length < 20) pageErrors.push(error.message);
    });

    await page.evaluate((deadline: number) => {
      (window as any).__CTI_BACKGROUND_CHUNK_DEADLINE_MS = deadline;
    }, chunkDeadline);
    await page.addScriptTag({ content: courseraSource });

    let lastStatusWrite = 0,
      lastRuntimeCheckpoint = 0,
      lastExternalFrameScan = 0;
    while (Date.now() < monitorDeadline) {
      const snapshot = await page.evaluate(() => {
        const w = window as any;
        const progress =
          document.getElementById("cti-progress-panel")?.innerText ||
          document.querySelector('[id*="cti"][id*="progress"]')?.textContent ||
          "";
        return {
          done:
            (typeof w.__CTI_LAST_JSON === "string" &&
              w.__CTI_LAST_JSON.length > 1) ||
            !!w.__CTI_LAST_RESULT,
          href: location.href,
          progress: String(progress || "").replace(/\s+/g, " ").slice(0, 260),
          activeItemId: String(w.__CTI_ACTIVE_ITEM_ID || ""),
          activeItemType: String(w.__CTI_ACTIVE_ITEM_TYPE || ""),
        };
      });

      if (!snapshot.href.includes(`/${payload.courseId}/content`))
        throw new Error(
          "Coursera left the requested authoring shell during extraction. The saved session may have expired.",
        );
      if (
        snapshot.activeItemId &&
        /plugin|lti|widget/i.test(snapshot.activeItemType) &&
        Date.now() - lastExternalFrameScan > 3500
      ) {
        await collectExternalFramesForItem(
          page,
          snapshot.activeItemId,
          externalFrameEvidence,
        );
        lastExternalFrameScan = Date.now();
      }
      if (snapshot.done) break;

      if (Date.now() - lastStatusWrite > 15_000) {
        status = await writeStatus(env, status, {
          phase: snapshot.progress || "Extracting Coursera item evidence",
        });
        lastStatusWrite = Date.now();
      }
      if (Date.now() - lastRuntimeCheckpoint > 30_000) {
        const runtimeState = await context.storageState({ indexedDB: true });
        await Promise.all([
          saveRuntimeState(env, payload.id, runtimeState),
          saveBackgroundFrameEvidence(env, payload.id, externalFrameEvidence),
        ]);
        lastRuntimeCheckpoint = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    const captureJson = await readCaptureJson(page);
    if (!captureJson) {
      const runtimeState = await context.storageState({ indexedDB: true });
      await Promise.all([
        saveRuntimeState(env, payload.id, runtimeState),
        saveBackgroundFrameEvidence(env, payload.id, externalFrameEvidence),
      ]);
      throw new Error(
        `Coursera extractor chunk ${chunkNumber} did not checkpoint before its 27-minute monitor deadline.${pageErrors.length ? " Page errors: " + pageErrors.join(" | ") : ""}`,
      );
    }

    let capture: unknown;
    try {
      capture = JSON.parse(captureJson);
    } catch {
      throw new Error("Extractor produced invalid capture JSON.");
    }

    const captureMeta = (capture as any)?.meta || {};
    const activeMeta = captureMeta.activeSpaCrawl || {};
    const cooperativeYielded = Boolean(
      captureMeta.backgroundChunk?.yielded || activeMeta.cooperativeChunkYielded,
    );
    if (cooperativeYielded) {
      const runtimeState = await context.storageState({ indexedDB: true });
      await Promise.all([
        saveRuntimeState(env, payload.id, runtimeState),
        saveBackgroundFrameEvidence(env, payload.id, externalFrameEvidence),
      ]);
      try {
        await saveSession(
          env,
          payload.ownerHash,
          runtimeState,
          payload.shellUrl,
          payload.courseId,
        );
      } catch {}
      const accounting = captureMeta.captureAccounting || {};
      const remainingItems = Math.max(
        Number(accounting.unvisitedCount || 0),
        Array.isArray(activeMeta.unvisitedTargetIds)
          ? activeMeta.unvisitedTargetIds.length
          : 0,
      );
      await writeStatus(env, status, {
        state: "RUNNING",
        phase: `Chunk ${chunkNumber} checkpointed safely · continuing${remainingItems ? ` · ${remainingItems} queued` : ""}`,
        liveViewUrl: "",
        artifactAvailable: false,
      });
      return {
        state: "CONTINUE" as const,
        chunk: chunkNumber,
        remainingItems,
        nextItemId: String(activeMeta.nextItemId || ""),
      };
    }

    status = await writeStatus(env, status, {
      state: "VERIFYING",
      phase: "Verifying no-miss completion contract",
    });

    capture = applyBackgroundPluginEvidence(capture, externalFrameEvidence);
    const finalizedCaptureJson = JSON.stringify(capture);
    const verdict = evaluateCourseraCapture(capture, payload.courseId);
    await env.ARTIFACTS.put(artifactKey(payload.id), finalizedCaptureJson, {
      httpMetadata: { contentType: "application/json" },
    });
    await Promise.all([
      env.ARTIFACTS.delete(runtimeStateKey(payload.id)),
      env.ARTIFACTS.delete(backgroundFrameEvidenceKey(payload.id)),
    ]);
    const exportName =
      (capture as any)?.meta?.exportFileName ||
      `CTI__COURSERA__${payload.courseId}__${payload.id}.json`;

    try {
      const refreshedSession = await context.storageState({ indexedDB: true });
      await saveSession(
        env,
        payload.ownerHash,
        refreshedSession,
        payload.shellUrl,
        payload.courseId,
      );
    } catch {}

    await writeStatus(env, status, {
      state: verdict.complete ? "COMPLETE" : "INCOMPLETE",
      phase: verdict.complete
        ? "Complete capture verified"
        : "Capture preserved; strict completion gate found unresolved evidence",
      completedAt: now(),
      artifactAvailable: true,
      artifactName: exportName,
      capture: verdict,
    } as Partial<CourseraExtractionStatus>);
    return { state: "DONE" as const, chunk: chunkNumber };
  } finally {
    await browser.close().catch(() => {});
  }
}

export class CourseraExtractionWorkflow extends WorkflowEntrypoint<
  Env,
  WorkflowPayload
> {
  async run(event: any, step: any) {
    const payload = event.payload as WorkflowPayload;
    try {
      if (payload.kind === "connect") {
        await step.do(
          "wait for Browser Run capacity",
          {
            retries: {
              limit: 0,
              delay: "1 second",
              backoff: "constant",
            },
            timeout: "12 minutes",
          },
          async () => {
            await waitForBrowserRunCapacity(this.env, payload);
            return { id: payload.id };
          },
        );
        await step.do(
          "connect Coursera session",
          {
            retries: {
              limit: 0,
              delay: "1 second",
              backoff: "constant",
            },
            timeout: "20 minutes",
          },
          async () => {
            await runConnection(this.env, payload);
            return { id: payload.id };
          },
        );
        return { id: payload.id };
      }

      for (let chunkNumber = 1; chunkNumber <= MAX_EXTRACTION_CHUNKS; chunkNumber++) {
        await step.do(
          `wait for Browser Run capacity chunk ${chunkNumber}`,
          {
            retries: {
              limit: 0,
              delay: "1 second",
              backoff: "constant",
            },
            timeout: "12 minutes",
          },
          async () => {
            await waitForBrowserRunCapacity(this.env, payload);
            return { id: payload.id, chunk: chunkNumber };
          },
        );
        const chunkResult = await step.do(
          `extract Coursera shell chunk ${chunkNumber}`,
          {
            retries: {
              // Cooperative chunking is the normal continuation path. One retry
              // remains only as a fallback for transient browser/platform failure.
              limit: 1,
              // Keep the fallback retry outside Workers Free's 20-second
              // new-browser acquisition interval. Normal 429 handling happens
              // inside launchBrowserWithRateLimitRecovery.
              delay: "30 seconds",
              backoff: "constant",
            },
            timeout: "30 minutes",
          },
          async () => runExtractionChunk(this.env, payload, chunkNumber),
        );
        if (chunkResult.state === "DONE")
          return { id: payload.id, chunks: chunkNumber };
      }
      throw new Error(
        `Coursera extraction still had checkpointed work after ${MAX_EXTRACTION_CHUNKS} cooperative chunks. No partial capture was promoted to COMPLETE; checkpoints were preserved.`,
      );
    } catch (error) {
      const current = await getJson<CourseraExtractionStatus>(
        this.env,
        statusKey(payload.id),
      );
      if (current)
        await writeStatus(this.env, current, {
          state: "FAILED",
          phase: "Background extraction stopped",
          completedAt: now(),
          liveViewUrl: "",
          error: error instanceof Error ? error.message : String(error),
        });
      throw error;
    }
  }
}

async function createWorkflow(
  env: Env,
  kind: "connect" | "extract",
  hash: string,
  shellUrl: string,
  courseId: string,
) {
  const id = `${kind === "connect" ? "connect" : "extract"}-${crypto.randomUUID()}`,
    createdAt = now(),
    status: CourseraExtractionStatus = {
      id,
      kind: kind === "connect" ? "connection" : "extraction",
      state: "QUEUED",
      shellUrl,
      courseId,
      createdAt,
      updatedAt: createdAt,
      ownerHash: hash,
      phase: kind === "connect" ? "Preparing secure Coursera login" : "Queued",
      artifactAvailable: false,
    };
  await putJson(env, statusKey(id), status);
  if (kind === "extract")
    await putJson(env, ownerJobKey(hash, createdAt, id), {
      id,
      createdAt,
      courseId,
      shellUrl,
    });
  await env.EXTRACTION_WORKFLOW.create({
    id,
    params: {
      kind,
      id,
      ownerHash: hash,
      shellUrl,
      courseId,
    } satisfies WorkflowPayload,
    retention: {
      successRetention: "7 days",
      errorRetention: "7 days",
    },
  });
  return status;
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      const caller = requireCaller(request),
        hash = await ownerHash(caller.email),
        url = new URL(request.url),
        path = url.pathname.split("/").filter(Boolean),
        method = request.method;

      if (path[0] === "health" && method === "GET")
        return json({
          ok: true,
          extractor: CTI_RELEASE_REGISTRY_.courseraExtractor,
          browserBinding: !!env.BROWSER,
          artifactBinding: !!env.ARTIFACTS,
          workflowBinding: !!env.EXTRACTION_WORKFLOW,
          sessionEncryption: !!env.CTI_SESSION_KEY,
        });

      if (path[0] === "session" && method === "GET") {
        const meta = await getJson<any>(env, sessionMetaKey(hash));
        const state = await env.ARTIFACTS.head(sessionKey(hash));
        return json({
          connected: !!meta?.connected && !!state,
          connectedAt: meta?.connectedAt || "",
          verifiedCourseId: meta?.verifiedCourseId || "",
        });
      }
      if (path[0] === "session" && method === "DELETE") {
        if (!["admin", "editor"].includes(caller.role))
          fail("Read-only CTI accounts cannot change Coursera connections.", 403);
        await Promise.all([
          env.ARTIFACTS.delete(sessionKey(hash)),
          env.ARTIFACTS.delete(sessionMetaKey(hash)),
        ]);
        return json({ connected: false });
      }

      if (path[0] === "connections" && path.length === 1 && method === "POST") {
        if (!["admin", "editor"].includes(caller.role))
          fail("Read-only CTI accounts cannot connect Coursera.", 403);
        const body = await readBody(request),
          target = parseCourseraShellUrl(String(body.url || ""));
        const status = await createWorkflow(
          env,
          "connect",
          hash,
          target.shellUrl,
          target.courseId,
        );
        return json({ status: cleanStatus(status) }, 202);
      }
      if (path[0] === "connections" && path[1] && method === "GET")
        return json({
          status: cleanStatus(await ownedStatus(env, path[1], hash)),
        });

      if (path[0] === "jobs" && path.length === 1 && method === "GET") {
        const listed = await env.ARTIFACTS.list({
          prefix: ownerJobPrefix(hash),
          limit: 100,
        });
        const refs: Array<{ id: string; createdAt: string }> = [];
        for (const object of listed.objects || []) {
          const marker = await getJson<any>(env, object.key);
          if (marker?.id)
            refs.push({
              id: String(marker.id),
              createdAt: String(marker.createdAt || ""),
            });
        }
        refs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const statuses: CourseraExtractionStatus[] = [];
        for (const ref of refs.slice(0, 20)) {
          const job = await getJson<CourseraExtractionStatus>(
            env,
            statusKey(ref.id),
          );
          if (job && job.ownerHash === hash) statuses.push(job);
        }
        return json({ statuses: statuses.map(cleanStatus) });
      }

      if (path[0] === "jobs" && path.length === 1 && method === "POST") {
        if (!["admin", "editor"].includes(caller.role))
          fail("Read-only CTI accounts cannot start extractions.", 403);
        const body = await readBody(request),
          target = parseCourseraShellUrl(String(body.url || ""));
        const status = await createWorkflow(
          env,
          "extract",
          hash,
          target.shellUrl,
          target.courseId,
        );
        return json({ status: cleanStatus(status) }, 202);
      }

      if (path[0] === "jobs" && path[1] && path.length === 2 && method === "GET")
        return json({
          status: cleanStatus(await ownedStatus(env, path[1], hash)),
        });

      if (
        path[0] === "jobs" &&
        path[1] &&
        path[2] === "artifact" &&
        method === "GET"
      ) {
        const status = await ownedStatus(env, path[1], hash);
        if (!status.artifactAvailable)
          fail("Capture artifact is not available yet.", 409);
        const object = await env.ARTIFACTS.get(artifactKey(path[1]));
        if (!object) fail("Capture artifact is missing.", 404);
        const name = String((status as any).artifactName || "coursera-capture.json")
          .replace(/[^a-z0-9._-]+/gi, "_")
          .slice(0, 180);
        return new Response(object.body, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${name}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      return json({ error: "Unknown extractor route." }, 404);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Background extractor request failed.",
        },
        Number((error as { status?: number }).status) || 500,
      );
    }
  },
};
