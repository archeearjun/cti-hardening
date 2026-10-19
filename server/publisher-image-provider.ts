import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directPublisherTargetV1 } from "../src/extractors/coursera/direct-data-publisher.js";
import {
  CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1,
  directPublisherImageUrlV1,
  directPublisherImageKindV1,
} from "../src/extractors/coursera/direct-data-publisher-media.js";

interface Input {
  targetUrl: string;
  imageUrl: string;
  sourceSha256: string;
}
interface Options {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  serviceOrigin?: string;
  limits?: { requestMs?: number; bodyBytes?: number };
}
interface Usage {
  status: number;
  observedAt: string;
  bytes: number;
  requests: number;
  challenge?: "cloudflare";
}
const SERVICE_ORIGIN = "https://cti-hardening.pages.dev";
const errorCode = (code: string) =>
  Object.assign(Error(code), { providerCode: code });
const bound = (value: unknown, maximum: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : maximum;
function headersFor(usage: Usage, origin: string) {
  return new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-CTI-Provider-Transport": "CTI_SERVICE_PUBLIC_IMAGE",
    "X-CTI-Provider-Origin": origin,
    "X-CTI-Upstream-Status": String(usage.status),
    "X-CTI-Upstream-Observed-At": usage.observedAt,
    "X-CTI-Upstream-Bytes": String(usage.bytes),
    "X-CTI-Upstream-Requests": String(usage.requests),
  });
}
export function publisherImageProviderErrorResponse(
  code: string,
  status = 400,
  origin = SERVICE_ORIGIN,
  usage: Usage = { status: 0, observedAt: "", bytes: 0, requests: 0 },
): Response {
  const headers = headersFor(usage, origin);
  headers.set("Content-Type", "application/json");
  // An HTTP 403 alone is not evidence of a challenge. This closed declaration
  // is emitted only for an explicitly observed upstream cf-mitigated header.
  if (
    code === "PUBLISHER_IMAGE_PROVIDER_CHALLENGE" &&
    usage.challenge === "cloudflare" &&
    usage.status === 403 &&
    usage.requests === 1 &&
    usage.bytes === 0
  )
    headers.set("X-CTI-Upstream-Challenge", "cloudflare");
  return new Response(
    JSON.stringify({
      error: /^PUBLISHER_IMAGE_PROVIDER_[A-Z0-9_]{1,80}$/.test(code)
        ? code
        : "PUBLISHER_IMAGE_PROVIDER_REQUEST_FAILED",
    }),
    { status, headers },
  );
}

/** A single literal public raster upload, with no caller headers or credentials.
 * The source hash is declared client context; it is not server verification of
 * the publisher JSON or of the image's membership in that source. */
export async function readPublisherImageProvider(
  input: Input,
  options: Options = {},
): Promise<Response> {
  const usage: Usage = { status: 0, observedAt: "", bytes: 0, requests: 0 },
    origin = options.serviceOrigin || SERVICE_ORIGIN;
  const literalAuthority = (value: unknown) =>
    typeof value === "string" &&
    /^https:\/\/(?:opentextbc\.ca|pressbooks\.bccampus\.ca)\//.test(value);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 3 ||
    !literalAuthority(input.targetUrl) ||
    !directPublisherTargetV1(input.targetUrl) ||
    !literalAuthority(input.imageUrl) ||
    /[?#]/.test(input.imageUrl) ||
    directPublisherImageUrlV1(input.imageUrl, input.targetUrl) !==
      input.imageUrl ||
    typeof input.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.sourceSha256)
  )
    return publisherImageProviderErrorResponse(
      "PUBLISHER_IMAGE_PROVIDER_INVALID_REQUEST",
      400,
      origin,
      usage,
    );

  const controller = new AbortController();
  let reason = "PUBLISHER_IMAGE_PROVIDER_ABORTED";
  const abort = (code: string) => {
    if (!controller.signal.aborted) {
      reason = code;
      controller.abort();
    }
  };
  const externalAbort = () => abort("PUBLISHER_IMAGE_PROVIDER_ABORTED");
  if (options.signal?.aborted) externalAbort();
  else options.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = setTimeout(
    () => abort("PUBLISHER_IMAGE_PROVIDER_TIMEOUT"),
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
  const cancel = () => {
    try {
      void reader?.cancel().catch(() => {});
    } catch {}
  };
  try {
    if (controller.signal.aborted) throw errorCode(reason);
    usage.requests++;
    const pending = (options.fetcher || fetch)(input.imageUrl, {
      method: "GET",
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "image/png, image/jpeg, image/gif, image/webp",
        "Accept-Encoding": "identity",
      },
    });
    void pending.then(
      (response) => {
        if (controller.signal.aborted) discard(response);
      },
      () => {},
    );
    const response = await wait(pending);
    usage.status = response.status;
    usage.observedAt = new Date().toISOString();
    if (
      response.redirected ||
      (response.url || input.imageUrl) !== input.imageUrl ||
      [301, 302, 303, 307, 308].includes(response.status)
    ) {
      discard(response);
      throw errorCode("PUBLISHER_IMAGE_PROVIDER_REDIRECT");
    }
    if (response.status !== 200 || response.headers.has("content-range")) {
      const challenge =
        response.status === 403 &&
        response.headers.get("cf-mitigated")?.trim().toLowerCase() ===
          "challenge";
      if (challenge) usage.challenge = "cloudflare";
      discard(response);
      throw errorCode(
        challenge
          ? "PUBLISHER_IMAGE_PROVIDER_CHALLENGE"
          : "PUBLISHER_IMAGE_PROVIDER_HTTP_" + response.status,
      );
    }
    const contentType = response.headers.get("content-type") || "",
      mime = contentType.split(";")[0].trim().toLowerCase();
    if (
      contentType.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(contentType) ||
      ![
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/gif",
        "image/webp",
      ].includes(mime)
    ) {
      discard(response);
      throw errorCode("PUBLISHER_IMAGE_PROVIDER_MIME");
    }
    const encoding = response.headers.get("content-encoding");
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
      discard(response);
      throw errorCode("PUBLISHER_IMAGE_PROVIDER_ENCODING");
    }
    const maximum = bound(
        options.limits?.bodyBytes,
        CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1,
      ),
      length = response.headers.get("content-length"),
      declared =
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
      throw errorCode("PUBLISHER_IMAGE_PROVIDER_BODY_LIMIT_OR_LENGTH");
    }
    reader = response.body?.getReader();
    if (!reader) throw errorCode("PUBLISHER_IMAGE_PROVIDER_BODY_UNAVAILABLE");
    controller.signal.addEventListener("abort", cancel, { once: true });
    const parts: Uint8Array[] = [],
      prefix = new Uint8Array(12),
      hasher = sha256.create();
    let prefixBytes = 0,
      empty = 0;
    while (true) {
      const next = await wait(reader.read());
      if (next.done) break;
      if (
        !(next.value instanceof Uint8Array) ||
        (!next.value.length && ++empty > 8)
      )
        throw errorCode("PUBLISHER_IMAGE_PROVIDER_INVALID_STREAM");
      if (!next.value.length) continue;
      empty = 0;
      usage.bytes += next.value.length;
      if (
        usage.bytes > maximum ||
        (declared !== null && usage.bytes > declared)
      )
        throw errorCode("PUBLISHER_IMAGE_PROVIDER_BODY_LIMIT_OR_LENGTH");
      if (parts.length >= 8192)
        throw errorCode("PUBLISHER_IMAGE_PROVIDER_BODY_CHUNK_LIMIT");
      const sample = next.value.subarray(0, 12 - prefixBytes);
      prefix.set(sample, prefixBytes);
      prefixBytes += sample.length;
      hasher.update(next.value);
      parts.push(next.value);
    }
    if (!usage.bytes || (declared !== null && usage.bytes !== declared))
      throw errorCode("PUBLISHER_IMAGE_PROVIDER_BODY_LIMIT_OR_LENGTH");
    if (!directPublisherImageKindV1(prefix.subarray(0, prefixBytes), mime))
      throw errorCode("PUBLISHER_IMAGE_PROVIDER_SIGNATURE");
    if (controller.signal.aborted) throw errorCode(reason);
    const headers = headersFor(usage, origin);
    headers.set("Content-Type", contentType);
    headers.set("Content-Encoding", "identity");
    headers.set("Content-Length", String(usage.bytes));
    headers.set("X-CTI-Upstream-Content-Length", String(usage.bytes));
    headers.set("X-CTI-Upstream-Sha256", bytesToHex(hasher.digest()));
    headers.set("X-CTI-Publisher-Source-Hash", input.sourceSha256);
    // Validate/hash the complete bounded body before any successful media
    // response. Relay retained chunks without an additional 16 MiB concat.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(out) {
          if (parts.length) out.enqueue(parts.shift()!);
          else out.close();
        },
        cancel() {
          parts.length = 0;
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { headers });
  } catch (error) {
    cancel();
    const candidate = (error as { providerCode?: unknown })?.providerCode,
      code = controller.signal.aborted
        ? reason
        : typeof candidate === "string" &&
            /^PUBLISHER_IMAGE_PROVIDER_[A-Z0-9_]{1,80}$/.test(candidate)
          ? candidate
          : "PUBLISHER_IMAGE_PROVIDER_REQUEST_FAILED";
    return publisherImageProviderErrorResponse(
      code,
      code.endsWith("TIMEOUT") ? 504 : code.endsWith("ABORTED") ? 499 : 502,
      origin,
      usage,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
    controller.signal.removeEventListener("abort", cancel);
    try {
      reader?.releaseLock();
    } catch {}
  }
}
