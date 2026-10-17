import {
  CTI_PROVIDER_HELPER_HEADERS_V1,
  CTI_PROVIDER_HELPER_ORIGIN_V1,
  CTI_PROVIDER_HELPER_PROTOCOL_V1,
} from "../src/extractors/coursera/direct-data-provider-helper.js";
import { directPanoptoAutomaticTargetV1 } from "../src/extractors/coursera/direct-data-panopto.js";

type Binding = { id: string; itemId?: string; providerId?: string };
type Job = {
  binding: Binding;
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  chunk: Uint8Array | null;
  chunkOffset: number;
  seq: number;
  bytes: number;
  declaredBytes: number | null;
  limit: number;
  busy: boolean;
  timer: ReturnType<typeof setTimeout>;
};

// The helper has no workspace or capture-store dependency. Access JWTs/cookies
// remain on CTI; only fixed, read-only operations and bounded response bytes
// cross the exact opener channel.
export function startProviderHelperV1(host: Window = window, fetchImpl: typeof fetch = fetch) {
  const { document, location } = host;
  const allowedOrigin = "https://www.coursera.org";
  const protocol = CTI_PROVIDER_HELPER_PROTOCOL_V1;
  const origin = CTI_PROVIDER_HELPER_ORIGIN_V1;
  const parameters = new URLSearchParams(location.hash.slice(1));
  const nonce = parameters.get("nonce");
  const courseId = parameters.get("courseId");
  const parent = host.opener as Window | null;
  const status = document.getElementById("status")!;
  const retry = document.getElementById("retry") as HTMLButtonElement;
  const jobs = new Map<string, Job>();
  let bound = false, authorized = false, accessFailed = false, closed = false, total = 0, requests = 0;
  let accessController: AbortController | null = null;
  let watchTimer: ReturnType<typeof setInterval>;

  function show(message: string) { status.textContent = message; }
  function send(type: string, extra: Record<string, unknown> = {}, transfer: Transferable[] = []) {
    if (closed) return;
    try { parent?.postMessage({ protocol, nonce, courseId, type, ...extra }, allowedOrigin, transfer); }
    catch { close(); }
  }
  function finish(job: Job) {
    if (!jobs.delete(job.binding.id)) return;
    clearTimeout(job.timer);
    job.controller.abort();
    void job.reader?.cancel().catch(() => {});
    job.chunk = null;
  }
  function fail(job: Job, code: string) { send("error", { ...job.binding, code }); finish(job); }
  function arm(job: Job) {
    if (!jobs.has(job.binding.id)) return;
    clearTimeout(job.timer);
    job.timer = setTimeout(() => fail(job, "PROVIDER_HELPER_TIMEOUT"), 30000);
  }
  function close() {
    if (closed) return;
    closed = true;
    authorized = false;
    accessController?.abort();
    clearInterval(watchTimer);
    for (const job of [...jobs.values()]) finish(job);
    host.removeEventListener("message", receive);
    show("Provider capture connection closed. Return to your Coursera tab.");
  }
  async function checkAccess() {
    accessController?.abort();
    const controller = new AbortController();
    accessController = controller;
    authorized = false;
    accessFailed = false;
    const timer = setTimeout(() => controller.abort(), 15000);
    retry.disabled = true;
    try {
      const response = await fetchImpl("/api/access", {
        credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      });
      const result: unknown = response.ok ? await response.json() : null;
      if (!response.ok || !result || typeof result !== "object" || !("fullCti" in result) || result.fullCti !== true)
        throw Error("access");
      if (closed || controller !== accessController) return;
      authorized = true;
      show(bound ? "Connected. Reading configured sources for your Coursera capture." : "Access verified. Waiting for your Coursera capture.");
      if (bound) send("ready");
    } catch {
      if (!closed && controller === accessController) {
        accessFailed = true;
        show("CTI access could not be verified. Sign into CTI, then retry capture from your Coursera tab.");
        if (bound) send("error", { code: "PROVIDER_HELPER_ACCESS_REQUIRED" });
      }
    } finally {
      clearTimeout(timer);
      if (controller === accessController) retry.disabled = false;
    }
  }
  async function start(m: Record<string, any>) {
    const payload = m.payload;
    const identity = { id: m.id, itemId: m.itemId, providerId: m.providerId };
    const valid = authorized && requests < 128 && jobs.size < 2 &&
      typeof m.id === "string" && /^[1-9]\d{0,3}$/.test(m.id) && !jobs.has(m.id) &&
      ["metadata", "podcast"].includes(m.kind) && payload && typeof payload === "object" &&
      !Array.isArray(payload) && directPanoptoAutomaticTargetV1(payload.targetUrl) &&
      Object.keys(payload).every(key => ["targetUrl", "itemId", "providerId", ...(m.kind === "podcast" ? ["streamFileId", "sourceHash"] : [])].includes(key)) &&
      ["itemId", "providerId"].every(key => payload[key] === m[key] && (m[key] === undefined ||
        typeof m[key] === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(m[key]))) &&
      (m.kind !== "podcast" || typeof payload.streamFileId === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.streamFileId) &&
        typeof payload.sourceHash === "string" && /^[a-f0-9]{64}$/.test(payload.sourceHash));
    if (!valid) { send("error", { ...identity, code: "PROVIDER_HELPER_INVALID_REQUEST" }); return; }
    const job: Job = {
      binding: identity, controller: new AbortController(), reader: null, chunk: null,
      chunkOffset: 0, seq: 0, bytes: 0, declaredBytes: null,
      limit: m.kind === "metadata" ? 512 * 1024 : 128 * 1024 * 1024,
      busy: false, timer: setTimeout(() => {}, 0),
    };
    jobs.set(m.id, job);
    requests++;
    arm(job);
    try {
      const body = { targetUrl: payload.targetUrl, ...(m.kind === "podcast" ? {
        streamFileId: payload.streamFileId, sourceHash: payload.sourceHash,
      } : {}) };
      const response = await fetchImpl("/api/provider/panopto/" + m.kind, {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json", Accept: m.kind === "metadata" ? "application/json" : "video/mp4" },
        body: JSON.stringify(body), signal: job.controller.signal,
      });
      if (!jobs.has(m.id) || closed) { void response.body?.cancel().catch(() => {}); return; }
      if (!response.body || [204, 205, 304].includes(response.status) ||
          Number(response.headers.get("content-length") || 0) > job.limit) {
        void response.body?.cancel().catch(() => {});
        fail(job, "PROVIDER_HELPER_INVALID_RESPONSE"); return;
      }
      if (m.kind === "podcast" && response.status === 200) {
        const length = response.headers.get("X-CTI-Upstream-Content-Length");
        const declared = /^[1-9]\d*$/.test(length || "") ? Number(length) : NaN;
        if (!Number.isSafeInteger(declared) || declared > job.limit) {
          void response.body.cancel().catch(() => {});
          fail(job, "PROVIDER_HELPER_PODCAST_LENGTH_UNAVAILABLE"); return;
        }
        job.declaredBytes = declared;
      }
      job.reader = response.body.getReader();
      const headers = CTI_PROVIDER_HELPER_HEADERS_V1.split(",").flatMap((name: string) => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      });
      if (headers.some(pair => pair[1].length > 256)) { fail(job, "PROVIDER_HELPER_INVALID_RESPONSE"); return; }
      send("head", { ...job.binding, status: response.status, headers });
      arm(job);
    } catch {
      if (jobs.has(m.id)) fail(job, "PROVIDER_HELPER_REQUEST_FAILED");
    }
  }
  async function pull(job: Job, m: Record<string, any>) {
    if (!job.reader || job.busy || m.seq !== job.seq || m.offset !== job.bytes) {
      fail(job, "PROVIDER_HELPER_INVALID_RESPONSE"); return;
    }
    job.busy = true;
    arm(job);
    try {
      if (!job.chunk || job.chunkOffset === job.chunk.byteLength) {
        const next = await job.reader.read();
        if (!jobs.has(job.binding.id)) return;
        if (next.done) {
          if (job.declaredBytes !== null && job.bytes !== job.declaredBytes) {
            fail(job, "PROVIDER_HELPER_PODCAST_LENGTH_MISMATCH"); return;
          }
          send("end", { ...job.binding, seq: job.seq, offset: job.bytes }); finish(job); return;
        }
        if (!(next.value instanceof Uint8Array) || !next.value.byteLength || next.value.byteLength > job.limit) {
          fail(job, "PROVIDER_HELPER_INVALID_RESPONSE"); return;
        }
        job.chunk = next.value;
        job.chunkOffset = 0;
      }
      const bytes = job.chunk.slice(job.chunkOffset, job.chunkOffset + 65536);
      if (job.declaredBytes !== null && job.bytes + bytes.byteLength > job.declaredBytes) {
        fail(job, "PROVIDER_HELPER_PODCAST_LENGTH_MISMATCH"); return;
      }
      if (job.bytes + bytes.byteLength > job.limit || total + bytes.byteLength > 512 * 1024 * 1024) {
        fail(job, "PROVIDER_HELPER_BYTE_LIMIT"); return;
      }
      const offset = job.bytes;
      job.bytes += bytes.byteLength;
      total += bytes.byteLength;
      job.chunkOffset += bytes.byteLength;
      const sequence = job.seq++;
      job.busy = false;
      send("chunk", { ...job.binding, seq: sequence, offset, bytes: bytes.buffer }, [bytes.buffer]);
      arm(job);
    } catch {
      if (jobs.has(job.binding.id)) fail(job, "PROVIDER_HELPER_REQUEST_FAILED");
    }
  }
  function receive(event: MessageEvent) {
    const m = event.data;
    if (closed || event.source !== parent || event.origin !== allowedOrigin || !m ||
        m.protocol !== protocol || m.nonce !== nonce || m.courseId !== courseId ||
        typeof m.type !== "string" || !["init", "request", "pull", "cancel", "close"].includes(m.type)) return;
    // The only large frames flow in the other direction. Reject extra fields
    // and oversized envelopes before initiating any provider operation.
    try { if (JSON.stringify(m).length > 8192) return; } catch { return; }
    if (m.type === "init") {
      bound = true;
      if (authorized) send("ready");
      else if (accessFailed) send("error", { code: "PROVIDER_HELPER_ACCESS_REQUIRED" });
      return;
    }
    if (!bound) return;
    if (m.type === "close") { close(); return; }
    if (m.type === "request") { void start(m); return; }
    const job = jobs.get(m.id);
    if (!job || m.itemId !== job.binding.itemId || m.providerId !== job.binding.providerId) return;
    if (m.type === "cancel") { finish(job); return; }
    void pull(job, m);
  }

  if (location.origin !== origin || !parent || !nonce || !/^[a-f0-9]{64}$/.test(nonce) ||
      !courseId || !/^[A-Za-z0-9_-]{8,128}$/.test(courseId) || [...parameters.keys()].length !== 2) {
    show("No valid Coursera capture connection. Start capture with your CTI bookmark in Coursera.");
    retry.disabled = true;
    return;
  }
  host.addEventListener("message", receive);
  host.addEventListener("pagehide", close, { once: true });
  retry.addEventListener("click", () => void checkAccess());
  watchTimer = setInterval(() => {
    if (!parent || parent.closed) close();
  }, 500);
  void checkAccess();
  return close;
}

if (typeof window !== "undefined") startProviderHelperV1();
