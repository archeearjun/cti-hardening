import { directPanoptoAutomaticTargetV1, sanitizeDirectPanoptoModelV1,
  directPanoptoSourceV1, directPanoptoPodcastBindingsV1 } from "../src/extractors/coursera/direct-data-panopto.js";
import { directPanoptoRequestFormV1 } from "../src/extractors/coursera/direct-data-panopto-contracts.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";

interface ProviderOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  serviceOrigin?: string;
  limits?: {requestMs?: number; metadataBytes?: number; podcastBytes?: number};
  /** Internal fixture dependency, never accepted from an HTTP request. */
  mediaHosts?: string[];
}
interface Usage {
  status: number; observedAt: string; bytes: number; requests: number;
  validationBytes: number; validationSourceHash: string; validationObservedAt: string;
}
const SERVICE_ORIGIN = "https://cti-hardening.pages.dev";
const PODCAST_HOSTS = ["d2y36twrtb17ty.cloudfront.net"];
const codeError = (code: string) => Object.assign(new Error(code), {providerCode: code});
function safeCode(error: unknown, fallback: string): string {
  const code = (error as {providerCode?: unknown})?.providerCode;
  return typeof code === "string" && /^PANOPTO_PROVIDER_[A-Z0-9_]{1,80}$/.test(code) ? code : fallback;
}
function limit(value: number | undefined, maximum: number) {
  return Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, maximum) : maximum;
}
function usageHeaders(usage: Usage, serviceOrigin: string, streamed = false) {
  return new Headers({
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "X-CTI-Provider-Transport": "CTI_PUBLIC_BACKEND", "X-CTI-Provider-Origin": serviceOrigin,
    "X-CTI-Upstream-Status": String(usage.status), "X-CTI-Upstream-Observed-At": usage.observedAt,
    "X-CTI-Upstream-Bytes": String(streamed ? 0 : usage.bytes),
    "X-CTI-Upstream-Requests": String(usage.requests),
    "X-CTI-Validation-Bytes": String(usage.validationBytes),
    "X-CTI-Validation-Source-Hash": usage.validationSourceHash,
    "X-CTI-Validation-Observed-At": usage.validationObservedAt,
  });
}
export function panoptoProviderErrorResponse(code: string, status = 400, serviceOrigin = SERVICE_ORIGIN, usage?: Usage) {
  const headers = usageHeaders(usage || {status: 0, observedAt: "", bytes: 0, requests: 0,
    validationBytes: 0, validationSourceHash: "", validationObservedAt: ""}, serviceOrigin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({error: /^PANOPTO_PROVIDER_[A-Z0-9_]{1,80}$/.test(code)
    ? code : "PANOPTO_PROVIDER_REQUEST_FAILED"}), {status, headers});
}
function requestScope(options: ProviderOptions) {
  const controller = new AbortController();
  let code = "PANOPTO_PROVIDER_ABORTED";
  const abort = (next: string) => {if (!controller.signal.aborted) {code = next;controller.abort();}};
  const externalAbort = () => abort("PANOPTO_PROVIDER_ABORTED");
  if (options.signal?.aborted) externalAbort();
  else options.signal?.addEventListener("abort", externalAbort, {once: true});
  const timer = setTimeout(() => abort("PANOPTO_PROVIDER_TIMEOUT"), limit(options.limits?.requestMs, 30000));
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (controller.signal.aborted) throw codeError(code);
    let listener: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => reject(codeError(code));
      controller.signal.addEventListener("abort", listener, {once: true});
    });
    try {return await Promise.race([pending, cancelled]);}
    finally {controller.signal.removeEventListener("abort", listener);}
  }
  function close() {clearTimeout(timer);options.signal?.removeEventListener("abort", externalAbort);}
  return {controller, wait, abort, close, code: () => code};
}
async function discard(response: Response) {try {void response.body?.cancel().catch(() => {});} catch {}}
async function upstream(url: string, init: RequestInit, usage: Usage, options: ProviderOptions,
  scope: ReturnType<typeof requestScope>) {
  scope.controller.signal.throwIfAborted();
  usage.requests++;usage.status = 0;usage.observedAt = "";
  const pending = (options.fetcher || fetch)(url, {...init, credentials: "omit", redirect: "manual", signal: scope.controller.signal});
  void pending.then(response => {if (scope.controller.signal.aborted) void discard(response);}, () => {});
  const response = await scope.wait(pending);
  usage.status = Number(response.status || 0);usage.observedAt = new Date().toISOString();
  if (response.redirected || (response.url || url) !== url) {
    await discard(response);throw codeError("PANOPTO_PROVIDER_REDIRECT");
  }
  if (!response.ok || response.status !== 200) {
    await discard(response);throw codeError("PANOPTO_PROVIDER_HTTP_" + Number(response.status || 0));
  }
  return response;
}
async function metadata(targetUrl: string, usage: Usage, options: ProviderOptions,
  scope: ReturnType<typeof requestScope>, validation: boolean) {
  const target = directPanoptoAutomaticTargetV1(targetUrl);
  if (!target) throw codeError("PANOPTO_PROVIDER_INVALID_TARGET");
  const url = new URL("/Panopto/Pages/Viewer/DeliveryInfo.aspx", target.origin).href;
  const response = await upstream(url, {method: "POST", headers: {Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
    body: new URLSearchParams(directPanoptoRequestFormV1(target.deliveryPublicId)).toString()}, usage, options, scope);
  const mime = response.headers.get("content-type") || "";
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(mime)) {
    await discard(response);throw codeError("PANOPTO_PROVIDER_METADATA_MIME");
  }
  const maximum = limit(options.limits?.metadataBytes, 512 * 1024);
  if (Number(response.headers.get("content-length") || 0) > maximum) {
    await discard(response);throw codeError("PANOPTO_PROVIDER_METADATA_BYTE_LIMIT");
  }
  const reader = response.body?.getReader();
  if (!reader) throw codeError("PANOPTO_PROVIDER_BODY_UNAVAILABLE");
  const parts: Uint8Array[] = [];let count = 0, empty = 0;
  const cancel = () => {void reader.cancel().catch(() => {});};
  scope.controller.signal.addEventListener("abort", cancel, {once: true});
  try {
    while (true) {
      const next = await scope.wait(reader.read());
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || (!next.value.length && ++empty > 8))
        throw codeError("PANOPTO_PROVIDER_INVALID_STREAM");
      if (next.value.length) empty = 0;
      count += next.value.byteLength;
      if (validation) usage.validationBytes = count;else usage.bytes = count;
      if (count > maximum) throw codeError("PANOPTO_PROVIDER_METADATA_BYTE_LIMIT");
      parts.push(next.value);
    }
  } catch (error) {cancel();throw error;}
  finally {scope.controller.signal.removeEventListener("abort", cancel);try {reader.releaseLock();} catch {}}
  const bytes = new Uint8Array(count);let offset = 0;
  for (const part of parts) {bytes.set(part, offset);offset += part.length;}
  let raw, clean;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    clean = sanitizeDirectPanoptoModelV1(raw, targetUrl).data;
  } catch {throw codeError("PANOPTO_PROVIDER_METADATA_INVALID");}
  return {bytes, raw, clean, mime};
}
function responseStatus(code: string) {
  return code.endsWith("TIMEOUT") ? 504 : code.endsWith("ABORTED") ? 499
    : /(?:INVALID_TARGET|INVALID_REQUEST|SOURCE_CHANGED|STREAM_NOT_FOUND|MEDIA_DESTINATION)$/.test(code) ? 400 : 502;
}
function freshUsage(): Usage {
  return {status: 0, observedAt: "", bytes: 0, requests: 0, validationBytes: 0,
    validationSourceHash: "", validationObservedAt: ""};
}
export async function readPanoptoProviderMetadata(targetUrl: string, options: ProviderOptions = {}): Promise<Response> {
  const usage = freshUsage(), scope = requestScope(options), serviceOrigin = options.serviceOrigin || SERVICE_ORIGIN;
  try {
    const read = await metadata(targetUrl, usage, options, scope, false);
    const headers = usageHeaders(usage, serviceOrigin);headers.set("Content-Type", read.mime);
    return new Response(read.bytes as Uint8Array<ArrayBuffer>, {headers});
  } catch (error) {
    const code = scope.controller.signal.aborted ? scope.code() : safeCode(error, "PANOPTO_PROVIDER_REQUEST_FAILED");
    return panoptoProviderErrorResponse(code, responseStatus(code), serviceOrigin, usage);
  } finally {scope.close();}
}
export async function readPanoptoProviderPodcast(input: {targetUrl: string; streamFileId: string; sourceHash: string},
  options: ProviderOptions = {}): Promise<Response> {
  const usage = freshUsage(), scope = requestScope(options), serviceOrigin = options.serviceOrigin || SERVICE_ORIGIN;
  let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (!input || typeof input.targetUrl !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.streamFileId || "") ||
        !/^[a-f0-9]{64}$/.test(input.sourceHash || "")) throw codeError("PANOPTO_PROVIDER_INVALID_REQUEST");
    const read = await metadata(input.targetUrl, usage, options, scope, true);
    usage.validationObservedAt = usage.observedAt;
    const source = new TextEncoder().encode(directCanonicalSourceTextV1(directPanoptoSourceV1(input.targetUrl, read.clean)));
    usage.validationSourceHash = [...new Uint8Array(await scope.wait(crypto.subtle.digest("SHA-256", source)))]
      .map(value => value.toString(16).padStart(2, "0")).join("");
    if (usage.validationSourceHash !== input.sourceHash) throw codeError("PANOPTO_PROVIDER_SOURCE_CHANGED");
    const candidate = directPanoptoPodcastBindingsV1(read.clean, input.targetUrl)
      .find(value => value.streamFileId === input.streamFileId);
    const matches = read.raw.Delivery.PodcastStreams.filter((value: Record<string, unknown>) => value.StreamFileId === input.streamFileId);
    if (!candidate || matches.length !== 1) throw codeError("PANOPTO_PROVIDER_STREAM_NOT_FOUND");
    const location = matches[0].StreamUrl;
    const cleanLocation = sanitizeCourseraCourseDataModel({url: location});
    if (cleanLocation.limitReached || cleanLocation.data?.url !== candidate.canonicalUrl)
      throw codeError("PANOPTO_PROVIDER_MEDIA_DESTINATION");
    const url = new URL(location), tenant = directPanoptoAutomaticTargetV1(input.targetUrl)!;
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        (url.port && url.port !== "443") || !/\.mp4$/i.test(url.pathname) ||
        !(url.origin === tenant.origin || (options.mediaHosts || PODCAST_HOSTS).includes(url.hostname)))
      throw codeError("PANOPTO_PROVIDER_MEDIA_DESTINATION");
    const response = await upstream(url.href, {method: "GET", headers: {Accept: "video/mp4"}}, usage, options, scope);
    if (response.headers.get("content-range") !== null ||
        !/^video\/mp4(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
      await discard(response);throw codeError("PANOPTO_PROVIDER_PODCAST_MIME_OR_RANGE");
    }
    const maximum = limit(options.limits?.podcastBytes, 128 * 1024 * 1024);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maximum) {await discard(response);throw codeError("PANOPTO_PROVIDER_PODCAST_BYTE_LIMIT");}
    bodyReader = response.body?.getReader();
    if (!bodyReader) throw codeError("PANOPTO_PROVIDER_BODY_UNAVAILABLE");
    const reader = bodyReader, prefix = new Uint8Array(12), queued: Uint8Array[] = [];
    let prefixBytes = 0, empty = 0;
    async function nextChunk() {
      const next = await scope.wait(reader.read());
      if (!next.done) {
        if (!(next.value instanceof Uint8Array) || (!next.value.length && ++empty > 8)) throw codeError("PANOPTO_PROVIDER_INVALID_STREAM");
        if (next.value.length) empty = 0;
        usage.bytes += next.value.byteLength;
        if (usage.bytes > maximum) throw codeError("PANOPTO_PROVIDER_PODCAST_BYTE_LIMIT");
      } else if (declared > 0 && usage.bytes !== declared) throw codeError("PANOPTO_PROVIDER_PODCAST_LENGTH");
      return next;
    }
    while (prefixBytes < 12) {
      const next = await nextChunk();
      if (next.done) throw codeError("PANOPTO_PROVIDER_PODCAST_SIGNATURE");
      queued.push(next.value);
      const part = next.value.subarray(0, 12 - prefixBytes);prefix.set(part, prefixBytes);prefixBytes += part.length;
    }
    if (prefix[4] !== 102 || prefix[5] !== 116 || prefix[6] !== 121 || prefix[7] !== 112)
      throw codeError("PANOPTO_PROVIDER_PODCAST_SIGNATURE");
    let finished = false, onAbort = () => {};
    function cleanup(cancel = false) {
      if (finished) return;finished = true;
      scope.controller.signal.removeEventListener("abort", onAbort);
      if (cancel) void reader.cancel().catch(() => {});
      try {reader.releaseLock();} catch {}
      scope.close();
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        onAbort = () => {if (!finished) {controller.error(codeError(scope.code()));cleanup(true);}};
        scope.controller.signal.addEventListener("abort", onAbort, {once: true});
      },
      async pull(controller) {
        try {
          if (queued.length) {controller.enqueue(queued.shift()!);return;}
          const next = await nextChunk();
          if (finished) return;
          if (next.done) {controller.close();cleanup();} else controller.enqueue(next.value);
        } catch (error) {
          if (!finished) {controller.error(codeError(scope.controller.signal.aborted ? scope.code() : safeCode(error, "PANOPTO_PROVIDER_STREAM_FAILED")));cleanup(true);}
        }
      },
      cancel() {scope.abort("PANOPTO_PROVIDER_ABORTED");cleanup(true);},
    }, {highWaterMark: 0});
    const headers = usageHeaders(usage, serviceOrigin, true);headers.set("Content-Type", "video/mp4");
    return new Response(stream, {headers});
  } catch (error) {
    if (bodyReader) {void bodyReader.cancel().catch(() => {});try {bodyReader.releaseLock();} catch {}}
    scope.close();
    const code = scope.controller.signal.aborted ? scope.code() : safeCode(error, "PANOPTO_PROVIDER_REQUEST_FAILED");
    return panoptoProviderErrorResponse(code, responseStatus(code), serviceOrigin, usage);
  }
}
