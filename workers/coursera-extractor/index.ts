import { launch } from "@cloudflare/playwright";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { courseraSource } from "../../src/generated/extractor-sources.js";
import { CTI_RELEASE_REGISTRY_ } from "../../src/engine/release.js";
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
const sessionKey = (ownerHash: string) => `sessions/${ownerHash}/state.json`;
const sessionMetaKey = (ownerHash: string) => `sessions/${ownerHash}/meta.json`;

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
  const state = await page.evaluate(() => ({
    title: document.title,
    text: (document.body?.innerText || "").slice(0, 4000),
  }));
  if (/sign in|log in|access denied|not authorized/i.test(state.text))
    return false;
  return /edit content/i.test(state.title) || /course material|content/i.test(state.text);
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
  const storageState = await loadSession(env, payload.ownerHash);
  if (!storageState)
    throw new Error(
      "Coursera is not connected for this CTI account. Connect Coursera before starting extraction.",
    );

  status = await writeStatus(env, status, {
    state: "RUNNING",
    phase: "Starting authenticated browser",
    startedAt: now(),
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
    let lastStatusWrite = 0;
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
        };
      });

      if (!snapshot.href.includes(`/${payload.courseId}/content`))
        throw new Error(
          "Coursera left the requested authoring shell during extraction. The saved session may have expired.",
        );
      if (snapshot.done) break;

      if (Date.now() - lastStatusWrite > 15_000) {
        status = await writeStatus(env, status, {
          phase: snapshot.progress || "Extracting Coursera item evidence",
        });
        lastStatusWrite = Date.now();
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

    const verdict = evaluateCourseraCapture(capture, payload.courseId);
    await env.ARTIFACTS.put(artifactKey(payload.id), captureJson, {
      httpMetadata: { contentType: "application/json" },
    });
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
          retries: { limit: 1, delay: "10 seconds" },
          timeout: payload.kind === "connect" ? "20 minutes" : "2 hours 10 minutes",
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
