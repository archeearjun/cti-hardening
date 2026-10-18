import {
  CTI_DIRECT_PUBLIC_PAGE_BODY_BYTES_V1,
  CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1,
  CTI_DIRECT_PUBLIC_PAGE_SERVICE_ORIGIN_V1,
  directPublicPageTargetV1,
  directPublicPageSameBookV1,
  directPublicPageHtmlBytesV1,
  directPublicPageContentTypeV1,
  directPublicPageEnvelopeBytesV1,
} from "../src/extractors/coursera/direct-data-public-page.js";

interface Options {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  serviceOrigin?: string;
  limits?: { requestMs?: number; bodyBytes?: number; envelopeBytes?: number };
}
interface Usage {
  status: number;
  observedAt: string;
  bytes: number;
  requests: number;
}
const errorCode = (code: string) =>
  Object.assign(Error(code), { providerCode: code });
const bound = (value: unknown, maximum: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : maximum;
function responseHeaders(usage: Usage, origin: string) {
  return new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-CTI-Provider-Transport": "CTI_PUBLIC_BACKEND",
    "X-CTI-Provider-Origin": origin,
    "X-CTI-Upstream-Status": String(usage.status),
    "X-CTI-Upstream-Observed-At": usage.observedAt,
    "X-CTI-Upstream-Bytes": String(usage.bytes),
    "X-CTI-Upstream-Requests": String(usage.requests),
  });
}
export function publicHtmlProviderErrorResponse(
  code: string,
  status = 400,
  serviceOrigin = CTI_DIRECT_PUBLIC_PAGE_SERVICE_ORIGIN_V1,
  usage: Usage = { status: 0, observedAt: "", bytes: 0, requests: 0 },
): Response {
  return new Response(
    JSON.stringify({
      error: /^PUBLIC_HTML_PROVIDER_[A-Z0-9_]{1,80}$/.test(code)
        ? code
        : "PUBLIC_HTML_PROVIDER_REQUEST_FAILED",
    }),
    { status, headers: responseHeaders(usage, serviceOrigin) },
  );
}

/** One public static page, never a generic URL proxy or a crawler. No caller
 * cookies, authorization, referer or other headers reach either public host. */
export async function readPublicHtmlProvider(
  targetUrl: string,
  options: Options = {},
): Promise<Response> {
  const usage: Usage = { status: 0, observedAt: "", bytes: 0, requests: 0 };
  const origin =
    options.serviceOrigin || CTI_DIRECT_PUBLIC_PAGE_SERVICE_ORIGIN_V1;
  const target = directPublicPageTargetV1(targetUrl);
  if (!target)
    return publicHtmlProviderErrorResponse(
      "PUBLIC_HTML_PROVIDER_INVALID_TARGET",
      400,
      origin,
      usage,
    );
  const controller = new AbortController();
  let reason = "PUBLIC_HTML_PROVIDER_ABORTED";
  const abort = (code: string) => {
    if (!controller.signal.aborted) {
      reason = code;
      controller.abort();
    }
  };
  const externalAbort = () => abort("PUBLIC_HTML_PROVIDER_ABORTED");
  if (options.signal?.aborted) externalAbort();
  else options.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = setTimeout(
    () => abort("PUBLIC_HTML_PROVIDER_TIMEOUT"),
    bound(options.limits?.requestMs, 20000),
  );
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (controller.signal.aborted) throw errorCode(reason);
    let listener = () => {};
    const stopped = new Promise<never>((_, reject) => {
      listener = () => reject(errorCode(reason));
      controller.signal.addEventListener("abort", listener, { once: true });
    });
    try {
      return await Promise.race([pending, stopped]);
    } finally {
      controller.signal.removeEventListener("abort", listener);
    }
  }
  const discard = (response: Response) => {
    try {
      void response.body?.cancel().catch(() => {});
    } catch {}
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const redirects: { from: string; to: string; status: number }[] = [],
      visited = new Set<string>();
    let url = target.normalizedUrl,
      response: Response;
    while (true) {
      if (controller.signal.aborted) throw errorCode(reason);
      visited.add(url);
      usage.requests++;
      usage.status = 0;
      usage.observedAt = "";
      const pending = (options.fetcher || fetch)(url, {
        method: "GET",
        credentials: "omit",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html, application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
      });
      void pending.then(
        (value) => {
          if (controller.signal.aborted) discard(value);
        },
        () => {},
      );
      response = await wait(pending);
      usage.status = response.status;
      usage.observedAt = new Date().toISOString();
      if (response.redirected || (response.url || url) !== url) {
        discard(response);
        throw errorCode("PUBLIC_HTML_PROVIDER_UNEXPECTED_REDIRECT");
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        discard(response);
        const next = location
          ? directPublicPageSameBookV1(
              new URL(location, url).href,
              target.normalizedUrl,
            )
          : "";
        if (!next || visited.has(next) || redirects.length >= 3)
          throw errorCode("PUBLIC_HTML_PROVIDER_REDIRECT_SCOPE");
        redirects.push({ from: url, to: next, status: response.status });
        url = next;
        continue;
      }
      break;
    }
    if (response.status !== 200 || response.headers.has("content-range")) {
      discard(response);
      throw errorCode("PUBLIC_HTML_PROVIDER_HTTP_" + response.status);
    }
    const contentType = response.headers.get("content-type") || "",
      mime = directPublicPageContentTypeV1(contentType);
    if (!mime) {
      discard(response);
      throw errorCode("PUBLIC_HTML_PROVIDER_MIME_OR_CHARSET");
    }
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding.trim().toLowerCase() !== "identity") {
      discard(response);
      throw errorCode("PUBLIC_HTML_PROVIDER_ENCODING");
    }
    const maximum = bound(
        options.limits?.bodyBytes,
        CTI_DIRECT_PUBLIC_PAGE_BODY_BYTES_V1,
      ),
      length = response.headers.get("content-length");
    const declared =
      length === null
        ? null
        : /^[1-9]\d*$/.test(length) && Number.isSafeInteger(Number(length))
          ? Number(length)
          : NaN;
    if (
      declared !== null &&
      (!Number.isSafeInteger(declared) || declared > maximum)
    ) {
      discard(response);
      throw errorCode("PUBLIC_HTML_PROVIDER_BODY_LIMIT_OR_LENGTH");
    }
    reader = response.body?.getReader();
    if (!reader) throw errorCode("PUBLIC_HTML_PROVIDER_BODY_UNAVAILABLE");
    const parts: Uint8Array[] = [];
    let size = 0,
      empty = 0;
    const cancel = () => {
      try {
        void reader?.cancel().catch(() => {});
      } catch {}
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        const next = await wait(reader.read());
        if (next.done) break;
        if (
          !(next.value instanceof Uint8Array) ||
          (!next.value.length && ++empty > 8)
        )
          throw errorCode("PUBLIC_HTML_PROVIDER_INVALID_STREAM");
        if (next.value.length) empty = 0;
        size += next.value.length;
        usage.bytes = size;
        if (parts.length >= 8192)
          throw errorCode("PUBLIC_HTML_PROVIDER_BODY_CHUNK_LIMIT");
        if (size > maximum || (declared !== null && size > declared))
          throw errorCode("PUBLIC_HTML_PROVIDER_BODY_LIMIT_OR_LENGTH");
        parts.push(next.value);
      }
    } catch (error) {
      cancel();
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      try {
        reader.releaseLock();
      } catch {}
    }
    if (!size || (declared !== null && size !== declared))
      throw errorCode("PUBLIC_HTML_PROVIDER_BODY_LIMIT_OR_LENGTH");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    let html: string;
    try {
      html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      throw errorCode("PUBLIC_HTML_PROVIDER_INVALID_UTF8");
    }
    const original = directPublicPageHtmlBytesV1(html);
    if (
      !original ||
      original.length !== bytes.length ||
      original.some((value, index) => value !== bytes[index])
    )
      throw errorCode("PUBLIC_HTML_PROVIDER_UNSAFE_OR_UNSUPPORTED_HTML");
    const digest = [
      ...new Uint8Array(await wait(crypto.subtle.digest("SHA-256", bytes))),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const model = {
      kind: "CTI_PUBLIC_STATIC_HTML",
      schemaVersion: 1,
      statusCoverage: "PARTIAL_PUBLIC_HTML_ONLY",
      requestedUrl: target.requestedUrl,
      normalizedUrl: target.normalizedUrl,
      finalUrl: url,
      redirects,
      observedAt: usage.observedAt,
      status: 200,
      mime,
      contentType,
      encoding: "UTF8",
      bytes: size,
      sha256: digest,
      html,
    };
    const envelope = directPublicPageEnvelopeBytesV1(model);
    if (
      !envelope ||
      envelope.length >
        bound(
          options.limits?.envelopeBytes,
          CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1,
        )
    )
      throw errorCode("PUBLIC_HTML_PROVIDER_ENVELOPE_LIMIT");
    const headers = responseHeaders(usage, origin);
    headers.set("X-CTI-Response-Envelope-Bytes", String(envelope.length));
    headers.set("Content-Length", String(envelope.length));
    return new Response(envelope as Uint8Array<ArrayBuffer>, { headers });
  } catch (error) {
    const reported = controller.signal.aborted
      ? reason
      : (error as { providerCode?: unknown })?.providerCode;
    const code =
      typeof reported === "string" &&
      /^PUBLIC_HTML_PROVIDER_[A-Z0-9_]{1,80}$/.test(reported)
        ? reported
        : "PUBLIC_HTML_PROVIDER_REQUEST_FAILED";
    return publicHtmlProviderErrorResponse(
      code,
      code.endsWith("TIMEOUT") ? 504 : code.endsWith("ABORTED") ? 499 : 502,
      origin,
      usage,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }
}
