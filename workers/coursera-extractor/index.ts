import { launch } from "@cloudflare/playwright";
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
const sessionKey = (ownerHash: string) => `sessions/${ownerHash}/state.json`;
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
    verifiedExternalBodies = 0,
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
      verifiedFrames: verified.length,
      interactionVerified: false,
      meaning:
        "Background browser observed the external frame DOM passively. No playback, form submission or protected interaction was performed.",
    };
    if (verified.length) {
      verifiedExternalBodies++;
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
      verifiedExternalBodies,
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
  const browser = await launch(env.BROWSER, { keep_alive: 600_000 });
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

async function runExtraction(env: Env, payload: Extract<WorkflowPayload, { kind: "extract" }>) {
  let status = (await getJson<CourseraExtractionStatus>(
    env,
    statusKey(payload.id),
  ))!;
  const resumedStorageState = await loadRuntimeState(env, payload.id);
  const storageState =
    resumedStorageState || (await loadSession(env, payload.ownerHash));
  if (!storageState)
    throw new Error(
      "Coursera is not connected for this CTI account. Connect Coursera before starting extraction.",
    );

  status = await writeStatus(env, status, {
    state: "RUNNING",
    phase: resumedStorageState
      ? "Resuming authenticated browser from saved item checkpoints"
      : "Starting authenticated browser",
    startedAt: status.startedAt || now(),
  });

  const browser = await launch(env.BROWSER, { keep_alive: 600_000 });
  try {
    const context = await browser.newContext({
        storageState,
        bypassCSP: true,
        acceptDownloads: true,
      }),
      page = await context.newPage();

    if (!(await verifiedAuthoringPage(page, payload.shellUrl, payload.courseId)))
      throw new Error(
        "Saved Coursera session is expired or no longer authorized for this shell. Reconnect Coursera and retry.",
      );

    status = await writeStatus(env, status, {
      phase: `Running Coursera extractor ${CTI_RELEASE_REGISTRY_.courseraExtractor.version}`,
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (error: Error) => {
      if (pageErrors.length < 20) pageErrors.push(error.message);
    });

    await page.addScriptTag({ content: courseraSource });

    const deadline = Date.now() + 2 * 60 * 60 * 1000;
    let lastStatusWrite = 0,
      lastRuntimeCheckpoint = 0,
      lastExternalFrameScan = 0;
    const externalFrameEvidence = new Map<string, BackgroundFrameEvidence[]>();
    while (Date.now() < deadline) {
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
        await saveRuntimeState(env, payload.id, runtimeState);
        lastRuntimeCheckpoint = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    const captureJson = await readCaptureJson(page);
    if (!captureJson)
      throw new Error(
        `Coursera extractor did not produce a capture before the two-hour worker deadline.${pageErrors.length ? " Page errors: " + pageErrors.join(" | ") : ""}`,
      );

    status = await writeStatus(env, status, {
      state: "VERIFYING",
      phase: "Verifying no-miss completion contract",
    });

    let capture: unknown;
    try {
      capture = JSON.parse(captureJson);
    } catch {
      throw new Error("Extractor produced invalid capture JSON.");
    }

    capture = applyBackgroundPluginEvidence(capture, externalFrameEvidence);
    const finalizedCaptureJson = JSON.stringify(capture);
    const verdict = evaluateCourseraCapture(capture, payload.courseId);
    await env.ARTIFACTS.put(artifactKey(payload.id), finalizedCaptureJson, {
      httpMetadata: { contentType: "application/json" },
    });
    await env.ARTIFACTS.delete(runtimeStateKey(payload.id));
    const exportName =
      (capture as any)?.meta?.exportFileName ||
      `CTI__COURSERA__${payload.courseId}__${payload.id}.json`;

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
      await step.do(
        payload.kind === "connect"
          ? "connect Coursera session"
          : "extract Coursera shell",
        {
          retries:
            payload.kind === "connect"
              ? { limit: 0, delay: "1 second" }
              : { limit: 1, delay: "10 seconds" },
          timeout:
            payload.kind === "connect" ? "20 minutes" : "2 hours 10 minutes",
        },
        async () => {
          if (payload.kind === "connect") await runConnection(this.env, payload);
          else await runExtraction(this.env, payload);
          return { id: payload.id };
        },
      );
      return { id: payload.id };
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
        if (!(await env.ARTIFACTS.head(sessionKey(hash))))
          fail("Connect Coursera before starting a background extraction.", 409);
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
