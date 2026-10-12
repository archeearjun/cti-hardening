import { parseCourseraShellUrl } from "./coursera-background-extraction.ts";

/** A passive, bounded schema sample; this is not a course-content extractor. */
export function createCourseraResponseSampleScript(courseUrl: string): string {
  const target = parseCourseraShellUrl(courseUrl);
  if (new URL(courseUrl.trim()).origin !== "https://www.coursera.org")
    throw new Error("Use the exact https://www.coursera.org authoring origin.");
  return "void (" + installCourseraResponseSample.toString() + ")(" +
    JSON.stringify({ courseId: target.courseId, slug: target.slug }) + ");";
}

function installCourseraResponseSample(config: { courseId: string; slug: string }) {
  const host = window as Window & { __CTI_COURSERA_RESPONSE_SAMPLE?: any };
  const origin = "https://www.coursera.org";
  const coursePath = "/teach/" + config.slug + "/" + config.courseId + "/content";
  const inCourse = () => location.origin === origin &&
    (location.pathname === coursePath || location.pathname.startsWith(coursePath + "/"));
  if (window !== window.top || !inCourse())
    throw new Error("Run the response sample in the selected Coursera authoring course.");
  host.__CTI_COURSERA_RESPONSE_SAMPLE?.stop("REPLACED");
  document.getElementById("__cti_coursera_response_sample")?.remove();

  const limits = { bodyBytes: 6 * 1024 * 1024, totalBytes: 12 * 1024 * 1024,
    bodies: 40, durationMs: 5 * 60 * 1000 };
  const startedAt = new Date().toISOString(), deadline = Date.now() + limits.durationMs;
  const records: any[] = [], declined: Record<string, number> = {};
  const readers = new Set<any>(), listeners = new Set<() => void>();
  const xhrMethods = new WeakMap<XMLHttpRequest, string>();
  const encoder = new TextEncoder();
  let active = true, totalBytes = 0, readingBytes = 0, stopReason = "", downloaded = false;
  const originalFetch = host.fetch, xhrPrototype = XMLHttpRequest.prototype;
  const originalOpen = xhrPrototype.open, originalSend = xhrPrototype.send;

  const panel = document.createElement("section");
  panel.id = "__cti_coursera_response_sample";
  panel.setAttribute("aria-label", "CTI quiz response sample");
  Object.assign(panel.style, { position: "fixed", bottom: "12px", right: "12px",
    zIndex: "2147483647", width: "310px", maxWidth: "calc(100vw - 24px)",
    padding: "14px", border: "1px solid #9ba5b6", borderRadius: "8px",
    background: "#fff", color: "#172238", font: "13px/1.5 system-ui", boxShadow: "0 2px 12px #0003" });
  const title = document.createElement("strong"); title.textContent = "CTI · Quiz response sample";
  const help = document.createElement("p");
  help.textContent = "Open one quiz normally. This watches responses for up to 5 minutes and makes no requests. Then download the sample.";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const download = document.createElement("button"); download.textContent = "Download response sample";
  const stopButton = document.createElement("button"); stopButton.textContent = "Stop";
  stopButton.style.marginLeft = "8px";
  panel.append(title, help, status, download, stopButton);
  (document.body || document.documentElement).append(panel);

  function render() {
    const declinedCount = Object.values(declined).reduce((sum, value) => sum + value, 0);
    status.textContent = (active ? "Watching" : "Stopped: " + stopReason) + " · " +
      records.length + " captured · " + declinedCount + " declined · " +
      (totalBytes / 1024 / 1024).toFixed(2) + " MiB";
    stopButton.disabled = !active;
  }
  function decline(reason: string) { declined[reason] = (declined[reason] || 0) + 1; render(); }
  function declineReader(job: any, reason: string) {
    if (!job.declined) { job.declined = true; decline(reason); }
  }
  function current() {
    if (!active) return false;
    if (!inCourse()) { stop("LEFT_COURSE"); return false; }
    if (Date.now() >= deadline) { stop("TIME_LIMIT"); return false; }
    return true;
  }
  function address(value: string) {
    try {
      const url = new URL(value);
      if (url.origin !== origin || url.username || url.password ||
        !/^\/(?:maestro\/)?api\//.test(url.pathname)) return null;
      const resource = url.pathname.replace(/^\/(?:maestro\/)?api\//, "");
      if (/(?:auth(?!oring)|session|login|logout|token|account|user|profile|membership|enroll|permission|notification|payment|certificate)/i.test(resource) ||
        !/(?:course|authoring|assessment|assignment|question|quiz|exam)/i.test(resource)) return null;
      const query: [string, string][] = [];
      const identities = /^(?:id|ids|courseId|courseIds|branchId|branchIds|itemId|itemIds|assessmentId|assignmentId|questionId|questionIds|quizId|examId|start|limit|offset)$/;
      for (const [key, entry] of url.searchParams) {
        const safeIdentity = identities.test(key) && entry.length <= 512 && /^[A-Za-z0-9_,.!~:-]*$/.test(entry);
        const safeSelector = key === "q" && entry.length <= 80 && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(entry);
        const safeFields = /^(?:fields|includes)$/.test(key) && entry.length <= 512 && /^[A-Za-z0-9_,.()]*$/.test(entry);
        if (safeIdentity || safeSelector || safeFields) query.push([key, entry]);
      }
      return { pathname: url.pathname, query };
    } catch { return null; }
  }
  const isJson = (type: string) => /^application\/(?:[A-Za-z0-9.+-]*\+)?json\b/i.test(type);
  function retain(rawJson: string, bytes: number, metadata: any) {
    if (!current()) return;
    if (records.length >= limits.bodies) { decline("BODY_COUNT_LIMIT"); stop("BODY_COUNT_LIMIT"); return; }
    if (bytes > limits.bodyBytes) { decline("BODY_BYTE_LIMIT"); return; }
    if (bytes + totalBytes > limits.totalBytes) { decline("TOTAL_BYTE_LIMIT"); stop("TOTAL_BYTE_LIMIT"); return; }
    try { JSON.parse(rawJson); } catch { decline("INVALID_JSON"); return; }
    records.push({ ...metadata, byteLength: bytes, bodyFormat: "RAW_JSON_TEXT", rawJson });
    totalBytes += bytes; render();
    if (records.length === limits.bodies) stop("BODY_COUNT_LIMIT");
  }
  async function observeFetch(response: Response, method: string) {
    if (!current()) return;
    const route = address(response.url);
    if (!route || !isJson(response.headers.get("content-type") || "")) return;
    if (records.length + readers.size >= limits.bodies) { decline("BODY_COUNT_LIMIT"); return; }
    if (Number(response.headers.get("content-length")) > limits.bodyBytes) { decline("BODY_BYTE_LIMIT"); return; }
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const job = { reader: null as ReadableStreamDefaultReader<Uint8Array> | null, bytes: 0, declined: false, finished: false };
    readers.add(job);
    try {
      const clone = response.clone();
      if (!clone.body) { declineReader(job, "BODY_UNAVAILABLE"); return; }
      reader = clone.body.getReader(); job.reader = reader;
      const decoder = new TextDecoder(), pieces: string[] = [];
      while (true) {
        const chunk = await reader.read();
        if (!current()) { declineReader(job, "STOPPED_BEFORE_BODY_COMPLETE"); return; }
        if (chunk.done) break;
        const bytes = chunk.value.byteLength;
        if (job.bytes + bytes > limits.bodyBytes) { declineReader(job, "BODY_BYTE_LIMIT"); return; }
        if (totalBytes + readingBytes + bytes > limits.totalBytes) {
          declineReader(job, "TOTAL_BYTE_LIMIT"); stop("TOTAL_BYTE_LIMIT"); return;
        }
        job.bytes += bytes; readingBytes += bytes;
        pieces.push(decoder.decode(chunk.value, { stream: true }));
      }
      pieces.push(decoder.decode());
      job.finished = true;
      retain(pieces.join(""), job.bytes, { source: "FETCH", method,
        ...route, status: response.status, observedAt: new Date().toISOString() });
    } catch { if (active) declineReader(job, "BODY_UNREADABLE"); }
    finally {
      readers.delete(job); readingBytes -= job.bytes;
      // Cancel only the clone. Awaiting a tee cancellation can wait for the original caller.
      void reader?.cancel().catch(() => {});
    }
  }
  function fetchMethod(input: RequestInfo | URL, init?: RequestInit) {
    try {
      const descriptor = init && Object.getOwnPropertyDescriptor(init, "method");
      if (descriptor) return "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value.toUpperCase() : "UNKNOWN";
      if (init && Object.getPrototypeOf(init) !== Object.prototype) return "UNKNOWN";
      return input instanceof Request ?
        Object.getOwnPropertyDescriptor(Request.prototype, "method")!.get!.call(input) : "GET";
    } catch { return "UNKNOWN"; }
  }
  const wrappedFetch: typeof fetch = function (this: unknown, input, init) {
    const result = Reflect.apply(originalFetch, this, [input, init]) as Promise<Response>;
    const method = fetchMethod(input, init);
    void result.then(response => { void observeFetch(response, method); }, () => {});
    return result;
  };
  const wrappedOpen: typeof originalOpen = function (this: XMLHttpRequest, ...args: any[]) {
    const result = Reflect.apply(originalOpen, this, args);
    xhrMethods.set(this, typeof args[0] === "string" ? args[0].toUpperCase() : "UNKNOWN");
    return result;
  };
  const wrappedSend: typeof originalSend = function (this: XMLHttpRequest, ...args: any[]) {
    const xhr = this;
    const handler = () => {
      remove();
      if (!current()) return;
      try {
        const route = address(xhr.responseURL);
        if (!route || !isJson(xhr.getResponseHeader("content-type") || "")) return;
        if (Number(xhr.getResponseHeader("content-length")) > limits.bodyBytes) { decline("BODY_BYTE_LIMIT"); return; }
        let rawJson: string;
        if (!xhr.responseType || xhr.responseType === "text") rawJson = xhr.responseText;
        else { decline("UNSUPPORTED_XHR_RESPONSE_TYPE"); return; }
        if (typeof rawJson !== "string") { decline("BODY_UNAVAILABLE"); return; }
        if (rawJson.length > limits.bodyBytes) { decline("BODY_BYTE_LIMIT"); return; }
        const bytes = encoder.encode(rawJson).byteLength;
        retain(rawJson, bytes, { source: "XHR", method: xhrMethods.get(xhr) || "UNKNOWN",
          ...route, status: xhr.status, observedAt: new Date().toISOString() });
      } catch { decline("BODY_UNREADABLE"); }
    };
    const remove = () => { xhr.removeEventListener("loadend", handler); listeners.delete(remove); };
    xhr.addEventListener("loadend", handler, { once: true }); listeners.add(remove);
    try { return Reflect.apply(originalSend, xhr, args); } catch (error) { remove(); throw error; }
  };

  function stop(reason = "OPERATOR_STOPPED") {
    if (!active) return;
    active = false; stopReason = reason;
    if (host.fetch === wrappedFetch) host.fetch = originalFetch;
    if (xhrPrototype.open === wrappedOpen) xhrPrototype.open = originalOpen;
    if (xhrPrototype.send === wrappedSend) xhrPrototype.send = originalSend;
    for (const remove of [...listeners]) remove();
    for (const job of readers) {
      if (!job.finished) declineReader(job, "STOPPED_BEFORE_BODY_COMPLETE");
      void job.reader?.cancel().catch(() => {});
    }
    clearInterval(timer); window.removeEventListener("pagehide", leaving); render();
  }
  function getSnapshot() {
    return { kind: "CTI_COURSERA_RESPONSE_SAMPLE_V1", notForCourseAudit: true,
      courseId: config.courseId, startedAt, sampledAt: new Date().toISOString(),
      active, stopReason, limits, totalBytes, captured: records.length,
      declined: { ...declined }, responses: records.map(entry => ({ ...entry })) };
  }
  const leaving = () => stop("PAGE_CLOSED_OR_RELOADED");
  const timer = window.setInterval(() => { current(); render(); }, 1000);
  window.addEventListener("pagehide", leaving);
  stopButton.onclick = () => stop();
  download.onclick = () => {
    if (downloaded) return;
    stop("DOWNLOADED"); downloaded = true; download.disabled = true;
    const blob = new Blob([JSON.stringify(getSnapshot(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "CTI_Coursera_Response_Sample_" + config.courseId + "_" +
      new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    anchor.style.display = "none"; panel.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  try { host.fetch = wrappedFetch; xhrPrototype.open = wrappedOpen; xhrPrototype.send = wrappedSend; }
  catch { stop("OBSERVER_UNAVAILABLE"); throw new Error("This page does not permit the response observer."); }
  host.__CTI_COURSERA_RESPONSE_SAMPLE = { stop, getSnapshot };
  render();
}
