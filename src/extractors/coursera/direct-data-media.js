import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import { sanitizeCourseraCourseDataModel } from "./direct-data-privacy.js";
import { directPanoptoSourceV1, directPanoptoPodcastBindingsV1 } from "./direct-data-panopto.js";
import { directProviderTransportReceiptV1, directProviderTransportErrorV1 } from "./direct-data-network.js";
import { directPublisherMediaInventoryV1, directPublisherImageKindV1,
  directPublisherImageServiceHeadersV1, directPublisherImageDateV1,
  directPublisherFirstPartyImageBindingV1 } from "./direct-data-publisher-media.js";

/** Only locations returned by the bound asset API are eligible for downloads. */
export function canonicalDirectAssetUrlV1(value) {
  if (typeof value !== "string" || value.length > 16384) return "";
  try {
    const url = new URL(value),
      host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !/\.(?:cloudfront\.net|amazonaws\.com|coursera\.org)$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|metadata)(?:\.|$)/.test(host) ||
      /^\/api(?:\/|$)/i.test(url.pathname)
    )
      return "";
    const sanitized = sanitizeCourseraCourseDataModel({ url: url.href });
    if (sanitized.limitReached || typeof sanitized.data?.url !== "string")
      return "";
    const canonical = new URL(sanitized.data.url);
    canonical.hash = "";
    return canonical.href;
  } catch (_) {
    return "";
  }
}

/** Delivery expiry is mutable transport metadata, not asset content identity. */
export function directAssetMetadataBindingV1(envelope, assetId) {
  if (
    !/^[A-Za-z0-9_-]{22}$/.test(assetId || "") ||
    !envelope ||
    !Array.isArray(envelope.elements) ||
    envelope.elements.length !== 1 ||
    (envelope.paging && envelope.paging.next != null)
  )
    return null;
  const element = envelope.elements[0];
  if (
    !element ||
    element.id !== assetId ||
    typeof element.name !== "string" ||
    !element.name.trim() ||
    element.name.length > 1024 ||
    typeof element.typeName !== "string" ||
    !element.typeName ||
    typeof element.url?.url !== "string"
  )
    return null;
  const canonicalUrl = canonicalDirectAssetUrlV1(element.url.url);
  if (!canonicalUrl) return null;
  try {
    const sanitized = sanitizeCourseraCourseDataModel(element);
    if (sanitized.limitReached) return null;
    const sourceModel = {
      ...sanitized.data,
      url: { ...sanitized.data.url, url: canonicalUrl },
    };
    for (const key of Object.keys(sourceModel.url))
      if (/^(?:expires|expiry|expiration|expiresAt)$/i.test(key))
        delete sourceModel.url[key];
    return {
      assetId,
      name: element.name,
      typeName: element.typeName,
      canonicalUrl,
      sourceModel,
      modelCanonical: directCanonicalSourceTextV1(sourceModel),
    };
  } catch (_) {
    return null;
  }
}

/** Native drawing identity is required before accepting any DWG response MIME. */
export function directDwgAssetBindingV1(name, sourceModel = null) {
  if (typeof name !== "string" || !/\.dwg$/i.test(name)) return false;
  if (sourceModel === null) return true;
  if (!sourceModel || typeof sourceModel !== "object") return false;
  for (const key of ["filename", "sourcePath"])
    if (
      sourceModel[key] !== undefined &&
      (typeof sourceModel[key] !== "string" ||
        !/\.dwg$/i.test(sourceModel[key]))
    )
      return false;
  if (
    sourceModel.fileExtension !== undefined &&
    (typeof sourceModel.fileExtension !== "string" ||
      !/^dwg$/i.test(sourceModel.fileExtension))
  )
    return false;
  return true;
}

/** Recognized DWG media types still require native filename and binary proof. */
export function directDwgMimeSupportedV1(mime) {
  return (
    typeof mime === "string" &&
    /^(?:image\/(?:vnd\.dwg|x-dwg)|application\/(?:acad|x-acad|autocad|x-autocad|dwg|x-dwg|octet-stream)|drawing\/dwg)$/.test(
      mime.split(";")[0].trim().toLowerCase(),
    )
  );
}

/** DWG framing and the exact observed MIME declaration travel with its bytes. */
export function directDwgBodyReceiptValidV1(receipt, mime, size) {
  return Boolean(
    receipt &&
      receipt.declaredBodyBytes === size &&
      typeof receipt.originalContentType === "string" &&
      receipt.originalContentType.length > 0 &&
      receipt.originalContentType.length <= 256 &&
      !/[\u0000-\u001f\u007f]/.test(receipt.originalContentType) &&
      receipt.originalContentType.split(";")[0].trim().toLowerCase() === mime,
  );
}

/** Inert original bytes must match both declared MIME and a supported signature.
 * DWG recognition retains a file; it does not parse or render drawing content. */
export function directAssetBodyKindV1(
  bytes,
  mime,
  name = "",
  sourceModel = null,
) {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.length ||
    typeof mime !== "string"
  )
    return "";
  const type = mime.split(";")[0].trim().toLowerCase(),
    generic = type === "application/octet-stream";
  const prefix = (...values) =>
    bytes.length >= values.length &&
    values.every((value, index) => bytes[index] === value);
  const ascii = (start, end) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (/\.dwg$/i.test(name)) {
    // AutoCAD 2000–2018 format families have a six-byte version followed by
    // five reserved zero bytes. Reject short headers and unknown future types.
    return directDwgAssetBindingV1(name, sourceModel) &&
      directDwgMimeSupportedV1(type) &&
      bytes.length >= 128 &&
      /^AC(?:1015|1018|1021|1024|1027|1032)$/.test(ascii(0, 6)) &&
      bytes.subarray(6, 11).every((value) => value === 0)
      ? "DWG"
      : "";
  }
  if (
    prefix(137, 80, 78, 71, 13, 10, 26, 10) &&
    (type === "image/png" || generic)
  )
    return "PNG";
  if (
    prefix(255, 216, 255) &&
    (type === "image/jpeg" || type === "image/jpg" || generic)
  )
    return "JPEG";
  if (
    bytes.length >= 6 &&
    /^(?:GIF87a|GIF89a)$/.test(ascii(0, 6)) &&
    (type === "image/gif" || generic)
  )
    return "GIF";
  if (
    bytes.length >= 12 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 12) === "WEBP" &&
    (type === "image/webp" || generic)
  )
    return "WEBP";
  if (prefix(37, 80, 68, 70, 45) && (type === "application/pdf" || generic))
    return "PDF";
  if (prefix(80, 75, 3, 4)) {
    const office = /\.(pptx|docx|xlsx)$/i.exec(name);
    if (office) {
      const suffix = {
        pptx: "presentationml.presentation",
        docx: "wordprocessingml.document",
        xlsx: "spreadsheetml.sheet",
      }[office[1].toLowerCase()];
      if (
        generic ||
        type === "application/zip" ||
        type === "application/vnd.openxmlformats-officedocument." + suffix
      )
        return "OFFICE_ZIP";
      return "";
    }
    if (
      type === "application/zip" ||
      type === "application/x-zip-compressed" ||
      (generic && /\.zip$/i.test(name))
    )
      return "ZIP";
  }
  if (
    bytes.length >= 12 &&
    ascii(4, 8) === "ftyp" &&
    (type === "video/mp4" || type === "audio/mp4")
  )
    return "MP4";
  if (prefix(73, 68, 51) && (type === "audio/mpeg" || type === "audio/mp3"))
    return "MP3";
  return "";
}

/** Validate base64 length and padding before allocating a bounded byte array. */
export function decodeDirectAssetBodyV1(body, maxBytes = 16 * 1024 * 1024) {
  if (
    !body ||
    !Number.isSafeInteger(body.size) ||
    body.size < 1 ||
    body.size > maxBytes ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    return null;
  if (body.archivePath !== undefined) {
    const owned = Object.getOwnPropertyDescriptor(body, "bytes");
    if (
      typeof body.base64 !== "undefined" ||
      !/^[a-f0-9]{64}$/.test(body.sha256 || "") ||
      body.archivePath !== "files/" + body.sha256 ||
      !owned ||
      !("value" in owned) ||
      !(owned.value instanceof Uint8Array) ||
      owned.value.byteLength !== body.size
    )
      return null;
    // Only explicitly hydrated originals are eligible. A manifest pointer or
    // an inherited/accessor field never manufactures verified body bytes.
    return new Uint8Array(owned.value);
  }
  if (typeof body.base64 !== "string") return null;
  const encoded = body.base64;
  if (
    !encoded.length ||
    encoded.length % 4 ||
    encoded.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    return null;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if ((encoded.length / 4) * 3 - padding !== body.size) return null;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (
    padding &&
    alphabet.indexOf(encoded[encoded.length - padding - 1]) %
      (padding === 2 ? 16 : 4) !==
      0
  )
    return null;
  try {
    const binary = atob(encoded);
    if (binary.length !== body.size) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch (_) {
    return null;
  }
}

export function encodeDirectAssetBodyV1(bytes) {
  if (!(bytes instanceof Uint8Array)) return "";
  const chunks = [];
  // A multiple of three keeps independently encoded chunks free of padding.
  for (let offset = 0; offset < bytes.length; offset += 12288) {
    let binary = "";
    for (const byte of bytes.subarray(offset, offset + 12288))
      binary += String.fromCharCode(byte);
    chunks.push(btoa(binary));
  }
  return chunks.join("");
}

/** Cached binary evidence remains eligible only with its original complete proof. */
export function directRetainedAssetMetadataReceiptValidV1(receipt, assetId) {
  const hash = receipt?.originalResponseSha256;
  return (
    !!receipt &&
    receipt.resource === "assets.v1" &&
    receipt.id === assetId &&
    receipt.requestPath === "/api/assets.v1" &&
    receipt.status === 200 &&
    receipt.bodyFormat === "PARSED_SANITIZED_JSON_MODEL" &&
    Array.isArray(receipt.requestQuery) &&
    receipt.requestQuery.length === 1 &&
    Array.isArray(receipt.requestQuery[0]) &&
    receipt.requestQuery[0].length === 2 &&
    receipt.requestQuery[0][0] === "ids" &&
    receipt.requestQuery[0][1] === assetId &&
    /^[a-f0-9]{64}$/.test(hash || "") &&
    (!receipt.sha256 || receipt.sha256 === hash) &&
    typeof receipt.observedAt === "string" &&
    Number.isFinite(Date.parse(receipt.observedAt))
  );
}

export async function directRetainedAssetBodyV1(
  evidence,
  assetId,
  maxBytes = 16 * 1024 * 1024,
) {
  if (
    !evidence ||
    evidence.reason ||
    evidence.assetId !== assetId ||
    evidence.stability?.stable !== true ||
    !directRetainedAssetMetadataReceiptValidV1(
      evidence.metadataReceipt,
      assetId,
    ) ||
    !directRetainedAssetMetadataReceiptValidV1(
      evidence.stability.receipt,
      assetId,
    )
  )
    return null;
  const initial = directAssetMetadataBindingV1(evidence.metadata, assetId),
    fresh = directAssetMetadataBindingV1(evidence.stability.metadata, assetId),
    raw = evidence.body;
  if (
    !initial ||
    !fresh ||
    initial.modelCanonical !== fresh.modelCanonical ||
    !raw ||
    !raw.receipt ||
    typeof raw.mime !== "string" ||
    raw.canonicalUrl !== initial.canonicalUrl ||
    !/^[a-f0-9]{64}$/.test(raw.sha256 || "")
  )
    return null;
  // Snapshot primitive fields before asynchronous hashing. The caller cannot
  // turn a verified body into different bytes while current metadata is read.
  const archive = raw.archivePath !== undefined;
  const body = {
      ...(archive ? { archivePath: raw.archivePath } : { base64: raw.base64 }),
      sha256: raw.sha256,
      size: raw.size,
      mime: raw.mime,
      canonicalUrl: raw.canonicalUrl,
      receipt: { ...raw.receipt },
    },
    receipt = body.receipt;
  if (archive) {
    const owned = Object.getOwnPropertyDescriptor(raw, "bytes");
    if (
      !owned ||
      !("value" in owned) ||
      !(owned.value instanceof Uint8Array) ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      !Number.isSafeInteger(body.size) ||
      body.size < 1 ||
      body.size > maxBytes ||
      owned.value.byteLength !== body.size
    )
      return null;
    Object.defineProperty(body, "bytes", {
      value: new Uint8Array(owned.value),
      enumerable: false,
      configurable: true,
    });
  }
  if (
    receipt.status !== 200 ||
    receipt.bodyFormat !==
      (archive
        ? "ORIGINAL_BINARY_BYTES_ARCHIVE"
        : "ORIGINAL_BINARY_BYTES_BASE64") ||
    receipt.bytes !== body.size ||
    receipt.mime !== body.mime ||
    receipt.sha256 !== body.sha256 ||
    receipt.canonicalUrl !== body.canonicalUrl ||
    typeof receipt.observedAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.observedAt))
  )
    return null;
  const bytes = decodeDirectAssetBodyV1(body, maxBytes);
  const kind =
    bytes &&
    directAssetBodyKindV1(bytes, body.mime, initial.name, initial.sourceModel);
  if (
    !kind ||
    (kind === "DWG" &&
      !directDwgBodyReceiptValidV1(receipt, body.mime, body.size)) ||
    !globalThis.crypto?.subtle
  )
    return null;
  try {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actual = [...hash]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return actual === body.sha256 ? { binding: initial, body } : null;
  } catch (_) {
    return null;
  }
}

/** Bounded asset bodies use their own two-slot pool; metadata shares API slots. */
export function createDirectDataMediaReaderV1(options = {}) {
  const archiveMode = options.archiveMode === true;
  const defaults = {
    concurrentRequests: 2,
    bodyBytes: 16 * 1024 * 1024,
    podcastBodyBytes: 128 * 1024 * 1024,
    totalBytes: (archiveMode ? 512 : 64) * 1024 * 1024,
    requestMs: 30000,
    durationMs: 60 * 60 * 1000,
  };
  const limits = {};
  for (const [name, maximum] of Object.entries(defaults)) {
    const requested = Number(options.limits?.[name]);
    limits[name] =
      name === "totalBytes" && requested === 0
        ? 0
        : Number.isFinite(requested) && requested > 0
          ? Math.min(maximum, Math.max(1, Math.floor(requested)))
          : maximum;
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis),
    api = options.apiReader;
  const startedAt = Date.now(),
    queue = [],
    controllers = new Set(),
    pending = new Map(),
    publisherImageChallenges = new Map(),
    publisherImageServiceGates = new Map(),
    cancellation = new AbortController();
  const stats = {
    requests: 0,
    bytes: 0,
    completed: 0,
    failed: 0,
    active: 0,
    maxConcurrentRequests: 0,
    queued: 0,
    statsHookFailures: 0,
  };
  let stopReason = "",
    bodyBudgetExhausted = false;
  function snapshot() {
    return {
      ...stats,
      queued: queue.length,
      elapsedMs: Date.now() - startedAt,
      stopped: !!stopReason,
      stopReason,
      bodyBudgetExhausted,
      limits: { ...limits },
    };
  }
  function notify() {
    if (typeof options.onStats !== "function") return;
    try {
      const result = options.onStats(snapshot());
      if (result && typeof result.catch === "function")
        result.catch(() => {
          stats.statsHookFailures++;
        });
    } catch (_) {
      stats.statsHookFailures++;
    }
  }
  function failure(assetId, reason, partial = {}) {
    return { assetId, reason, ...partial };
  }
  function abort(reason = "OPERATOR_STOPPED") {
    if (stopReason) return;
    stopReason =
      typeof reason === "string" && /^[A-Z0-9_]{1,96}$/.test(reason)
        ? reason
        : "OPERATOR_STOPPED";
    cancellation.abort();
    for (const controller of controllers) controller.abort();
    while (queue.length) {
      const job = queue.shift();
      stats.failed++;
      job.resolve(failure(job.assetId, stopReason));
    }
    notify();
  }
  function current() {
    if (stopReason) return false;
    if (Date.now() - startedAt >= limits.durationMs) {
      abort("DIRECT_MEDIA_TIME_LIMIT");
      return false;
    }
    if (typeof options.assertCurrent === "function") {
      try {
        const result = options.assertCurrent();
        if (result && typeof result.then === "function") {
          if (typeof result.catch === "function") result.catch(() => {});
          abort("SOURCE_CONTEXT_CHECK_FAILED");
          return false;
        }
        if (result === false) {
          abort("SOURCE_CONTEXT_CHANGED");
          return false;
        }
      } catch (_) {
        abort("SOURCE_CONTEXT_CHECK_FAILED");
        return false;
      }
    }
    return true;
  }
  function jobCurrent(controller) {
    return !controller.signal.aborted && current();
  }
  function jobStopReason(controller) {
    return (
      stopReason ||
      (typeof controller.signal.reason === "string" &&
      /^[A-Z0-9_]{1,96}$/.test(controller.signal.reason)
        ? controller.signal.reason
        : "DIRECT_ASSET_BODY_ABORTED")
    );
  }
  function scopedReceipt(response, assetId) {
    return response?.receipt
      ? {
          ...response.receipt,
          id: assetId,
          sha256: response.receipt.originalResponseSha256,
        }
      : null;
  }
  async function discard(response) {
    try {
      if (response?.body && typeof response.body.cancel === "function")
        await response.body.cancel();
    } catch (_) {}
  }
  async function captureBody(assetId, url, binding, controller, bodyBytes, providerRequest) {
    if (!jobCurrent(controller))
      return failure(assetId, jobStopReason(controller));
    if (stats.bytes >= limits.totalBytes) {
      bodyBudgetExhausted = true;
      notify();
      return failure(assetId, "DIRECT_MEDIA_BYTE_LIMIT");
    }
    if (!providerRequest && typeof fetchImpl !== "function")
      return failure(assetId, "FETCH_UNAVAILABLE");
    stats.requests++;
    notify();
    let response, serviceReceipt, declaredBodyBytes;
    if (providerRequest) {serviceReceipt={role:"PODCAST_STREAM_RENDITION",targetUrl:providerRequest.targetUrl,canonicalUrl:binding.canonicalUrl,bytes:0};
      directProviderTransportReceiptV1(null,serviceReceipt);}
    const failed=reason=>failure(assetId,reason,serviceReceipt?{receipt:{...serviceReceipt}}:{});
    try {
      response = providerRequest ? await options.providerTransport.request("podcast",providerRequest,controller.signal) :
        await fetchImpl(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept:
            binding.role === "PODCAST_STREAM_RENDITION"
              ? "video/mp4"
              : "image/*,application/pdf,application/zip,application/octet-stream,*/*;q=0.1",
        },
      });
      if (!jobCurrent(controller)) {
        await discard(response);
        return failed(jobStopReason(controller));
      }
      if (providerRequest) {
        const valid=directProviderTransportReceiptV1(response,serviceReceipt),
          validationBytes=Number(response.headers.get("X-CTI-Validation-Bytes")),
          validationSourceHash=response.headers.get("X-CTI-Validation-Source-Hash"),
          validationObservedAt=response.headers.get("X-CTI-Validation-Observed-At");
        if (valid) {
          stats.requests+=Math.max(0,serviceReceipt.upstreamRequests-1);
          if (Number.isSafeInteger(validationBytes) && validationBytes>=0 && validationBytes<=129*1024*1024) {
            stats.bytes+=validationBytes;
            if (validationBytes) serviceReceipt.validationMetadataBytes=validationBytes;
          }
          if (/^[a-f0-9]{64}$/.test(validationSourceHash || "")) serviceReceipt.validationSourceHash=validationSourceHash;
          if (validationObservedAt && Number.isFinite(Date.parse(validationObservedAt)) &&
              new Date(validationObservedAt).toISOString()===validationObservedAt)
            serviceReceipt.validationObservedAt=validationObservedAt;
          if (stats.bytes>limits.totalBytes) {
            bodyBudgetExhausted=true;for (const activeController of controllers) activeController.abort();
          }
          notify();
        }
        if (!valid || !response.ok || serviceReceipt.status!==200 || serviceReceipt.upstreamRequests!==2) {
          const wire=Number(response.headers.get("X-CTI-Upstream-Bytes"));
          if (valid && Number.isSafeInteger(wire) && wire>=0 && wire<=129*1024*1024) {stats.bytes+=wire;serviceReceipt.bytes=wire;}
          if (stats.bytes>limits.totalBytes) {bodyBudgetExhausted=true;for (const activeController of controllers) activeController.abort();notify();}
          const reason=await directProviderTransportErrorV1(response);
          return failed(bodyBudgetExhausted?"DIRECT_MEDIA_BYTE_LIMIT":!valid?"PROVIDER_HELPER_RECEIPT_INVALID":reason);
        }
        if (!Number.isSafeInteger(validationBytes) || validationBytes<1 || validationBytes>512*1024 ||
            validationSourceHash!==providerRequest.sourceHash || !serviceReceipt.validationObservedAt ||
            Number(response.headers.get("X-CTI-Upstream-Bytes"))!==0) {
          await discard(response);return failed("PROVIDER_HELPER_VALIDATION_INVALID");
        }
        const declared=response.headers.get("X-CTI-Upstream-Content-Length");
        declaredBodyBytes=/^[1-9]\d*$/.test(declared || "") ? Number(declared) : NaN;
        if (!Number.isSafeInteger(declaredBodyBytes)) {
          await discard(response);return failed("PANOPTO_PODCAST_LENGTH_UNAVAILABLE");
        }
        serviceReceipt.declaredBodyBytes=declaredBodyBytes;
        if (declaredBodyBytes>bodyBytes) {
          await discard(response);return failed("DIRECT_ASSET_BODY_BYTE_LIMIT");
        }
        if (bodyBudgetExhausted || !jobCurrent(controller)) {
          await discard(response);return failed(bodyBudgetExhausted?"DIRECT_MEDIA_BYTE_LIMIT":jobStopReason(controller));
        }
      }
      if (!response.ok || response.status !== 200) {
        await discard(response);
        return failed(
          "DIRECT_ASSET_BODY_HTTP_" + Number(response.status || 0),
        );
      }
      if (binding.role === "PODCAST_STREAM_RENDITION" && response.headers.get("content-range") !== null) {
        await discard(response);
        return failed("PANOPTO_PODCAST_PARTIAL_RESPONSE");
      }
      const encoding=response.headers.get("content-encoding");
      if (binding.role === "PODCAST_STREAM_RENDITION" && encoding !== null && encoding.trim().toLowerCase() !== "identity") {
        await discard(response);return failed("PANOPTO_PODCAST_ENCODING_UNSUPPORTED");
      }
      const actual = response.url || url;
      if (
        response.redirected ||
        actual !== url ||
        canonicalDirectAssetUrlV1(actual) !== binding.canonicalUrl
      ) {
        await discard(response);
        return failed("DIRECT_ASSET_BODY_REDIRECT");
      }
      const originalContentType = String(
          response.headers.get("content-type") || "",
        ),
        mime = originalContentType.split(";")[0].trim().toLowerCase(),
        drawing = directDwgAssetBindingV1(binding.name, binding.sourceModel);
      if (binding.role === "PODCAST_STREAM_RENDITION" && mime !== "video/mp4") {
        await discard(response);
        return failed("PANOPTO_PODCAST_MIME_UNSUPPORTED");
      }
      if (
        !/^(?:image\/(?:png|jpe?g|gif|webp)|application\/(?:pdf|zip|x-zip-compressed|octet-stream|vnd\.openxmlformats-officedocument\.(?:presentationml\.presentation|wordprocessingml\.document|spreadsheetml\.sheet))|(?:video|audio)\/mp4|audio\/(?:mpeg|mp3))$/.test(
          mime,
        ) &&
        !(drawing && directDwgMimeSupportedV1(mime))
      ) {
        await discard(response);
        return failed("DIRECT_ASSET_BODY_MIME_UNSUPPORTED");
      }
      const advertised = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(advertised) && advertised > bodyBytes) {
        await discard(response);
        return failed("DIRECT_ASSET_BODY_BYTE_LIMIT");
      }
      if (binding.role === "PODCAST_STREAM_RENDITION" && !providerRequest) {
        const declared=response.headers.get("content-length");
        declaredBodyBytes=/^[1-9]\d*$/.test(declared || "") ? Number(declared) : NaN;
        if (!Number.isSafeInteger(declaredBodyBytes)) {
          await discard(response);return failed("PANOPTO_PODCAST_LENGTH_UNAVAILABLE");
        }
      }
      if (drawing) {
        if (
          !directDwgMimeSupportedV1(mime) ||
          originalContentType.length > 256 ||
          /[\u0000-\u001f\u007f]/.test(originalContentType)
        ) {
          await discard(response);
          return failed("DIRECT_ASSET_BODY_MIME_UNSUPPORTED");
        }
        if (response.headers.get("content-range") !== null) {
          await discard(response);
          return failed("DIRECT_ASSET_BODY_PARTIAL_RESPONSE");
        }
        if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
          await discard(response);
          return failed("DIRECT_ASSET_BODY_ENCODING_UNSUPPORTED");
        }
        const declared = response.headers.get("content-length");
        declaredBodyBytes = /^[1-9]\d*$/.test(declared || "")
          ? Number(declared)
          : NaN;
        if (!Number.isSafeInteger(declaredBodyBytes)) {
          await discard(response);
          return failed("DIRECT_ASSET_BODY_LENGTH_UNAVAILABLE");
        }
      }
      const chunks = [];
      let count = 0;
      function add(bytes) {
        count += bytes.byteLength;
        if (serviceReceipt) serviceReceipt.bytes=count;
        stats.bytes += bytes.byteLength;
        notify();
        if (stats.bytes > limits.totalBytes) {
          bodyBudgetExhausted = true;
          // Stop active downloads while preserving metadata-only validation of
          // earlier originals. Exhaustion is an asset gap, not a lost session.
          for (const activeController of controllers) activeController.abort();
          notify();
          return false;
        }
        if (count > bodyBytes) return false;
        chunks.push(bytes);
        return true;
      }
      if (response.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        const cancelBody = () => {
          void reader.cancel().catch(() => {});
        };
        controller.signal.addEventListener("abort", cancelBody, { once: true });
        try {
          while (jobCurrent(controller)) {
            const next = await reader.read();
            if (!jobCurrent(controller)) {
              await reader.cancel();
              return failed(jobStopReason(controller));
            }
            if (next.done) break;
            if (!(next.value instanceof Uint8Array) || !add(next.value)) {
              await reader.cancel();
              return failed(
                stopReason ||
                  (bodyBudgetExhausted
                    ? "DIRECT_MEDIA_BYTE_LIMIT"
                    : "DIRECT_ASSET_BODY_BYTE_LIMIT"),
              );
            }
          }
          if (!jobCurrent(controller)) {
            await reader.cancel();
            return failed(jobStopReason(controller));
          }
        } finally {
          controller.signal.removeEventListener("abort", cancelBody);
          reader.releaseLock();
        }
      } else if (typeof response.arrayBuffer === "function") {
        const original = new Uint8Array(await response.arrayBuffer());
        if (!jobCurrent(controller))
          return failed(jobStopReason(controller));
        if (!add(original))
          return failed(
            stopReason ||
              (bodyBudgetExhausted
                ? "DIRECT_MEDIA_BYTE_LIMIT"
                : "DIRECT_ASSET_BODY_BYTE_LIMIT"),
          );
      } else return failed("DIRECT_ASSET_BODY_UNAVAILABLE");
      if (declaredBodyBytes !== undefined && count !== declaredBodyBytes)
        return failed(
          drawing
            ? "DIRECT_ASSET_BODY_LENGTH_MISMATCH"
            : "PANOPTO_PODCAST_LENGTH_MISMATCH",
        );
      const bytes = new Uint8Array(count);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      chunks.length = 0;
      if (
        !directAssetBodyKindV1(bytes, mime, binding.name, binding.sourceModel)
      )
        return failed("DIRECT_ASSET_BODY_MAGIC_INVALID");
      if (!globalThis.crypto?.subtle)
        return failed("RESPONSE_HASH_UNAVAILABLE");
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      if (!jobCurrent(controller))
        return failed(jobStopReason(controller));
      const sha256 = [...digest]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const body = {
        ...(binding.role === "PODCAST_STREAM_RENDITION" ? {kind:"PANOPTO_PODCAST_RENDITION"} : {}),
        ...(archiveMode
          ? { archivePath: "files/" + sha256 }
          : { base64: encodeDirectAssetBodyV1(bytes) }),
        sha256,
        size: count,
        mime,
        canonicalUrl: binding.canonicalUrl,
        receipt: {
          ...(binding.role === "PODCAST_STREAM_RENDITION" ? {role:"PODCAST_STREAM_RENDITION"} : {}),
          ...(serviceReceipt || {}),
          ...(declaredBodyBytes !== undefined ? {declaredBodyBytes} : {}),
          ...(drawing ? { originalContentType } : {}),
          status: serviceReceipt?.status || Number(response.status),
          bytes: count,
          mime,
          canonicalUrl: binding.canonicalUrl,
          sha256,
          observedAt: serviceReceipt?.observedAt || new Date().toISOString(),
          bodyFormat: archiveMode
            ? "ORIGINAL_BINARY_BYTES_ARCHIVE"
            : "ORIGINAL_BINARY_BYTES_BASE64",
        },
      };
      if (archiveMode)
        Object.defineProperty(body, "bytes", {
          value: bytes,
          enumerable: false,
          configurable: true,
        });
      return { assetId, body };
    } catch (error) {
      return failed(
        stopReason ||
          (bodyBudgetExhausted
            ? "DIRECT_MEDIA_BYTE_LIMIT"
            : controller.signal.aborted
              ? jobStopReason(controller)
              : providerRequest ? (/^PROVIDER_HELPER_[A-Z0-9_]{1,64}$/.test(error?.code || "")?error.code:"PROVIDER_HELPER_REQUEST_FAILED")
                : "DIRECT_ASSET_BODY_FETCH_FAILED"),
      );
    }
  }
  async function capturePublisherImage(job, controller) {
    let response, serviceContext = null, firstPartyContext = null, firstPartyCharged = 0, firstPartyRequestAttempted = false,
      firstPartyFailureContext = null, browserAttempt = null, serviceObservedAt = "",
      serviceFailure = {serviceOrigin:"https://cti-hardening.pages.dev",serviceStatus:0,
        upstreamStatus:0,upstreamObservedAt:"",upstreamRequests:0,upstreamBytes:0};
    const firstPartyAttemptedAt = new Date().toISOString();
    const chargeFirstParty = (delivered = 0, reported = 0) => {
      if (!job.firstPartyBinding) return 0;
      const observed = typeof response?.observedBytes === "function" ? response.observedBytes() : 0;
      if (![delivered,reported,observed].every(value => Number.isSafeInteger(value) && value >= 0))
        throw Error("PUBLISHER_FIRST_PARTY_BYTE_CONTEXT_INVALID");
      const total = Math.max(delivered,reported,observed,firstPartyCharged), delta = total - firstPartyCharged;
      if (!Number.isSafeInteger(stats.bytes + delta)) throw Error("PUBLISHER_FIRST_PARTY_BYTE_CONTEXT_INVALID");
      stats.bytes += delta; firstPartyCharged = total; notify();
      if (stats.bytes > limits.totalBytes) {
        bodyBudgetExhausted = true;
        for (const activeController of controllers) activeController.abort("DIRECT_MEDIA_BYTE_LIMIT");
      }
      return total;
    };
    const failed = reason => {
      if (job.firstPartyBinding) try { chargeFirstParty(); } catch (_) { reason = "PUBLISHER_FIRST_PARTY_BYTE_CONTEXT_INVALID"; }
      const context = {...serviceFailure};
      if (reason !== "PUBLISHER_IMAGE_UPSTREAM_CHALLENGE") delete context.upstreamChallenge;
      if (reason !== "PUBLISHER_IMAGE_SERVICE_ORIGIN_CHALLENGE_NOT_ATTEMPTED") { delete context.notAttempted; delete context.blockedBy; }
      return failure(job.assetId, reason, {url:job.url,
        ...(job.firstPartyBinding ? {firstPartyAttempt:{transport:"FIRST_PARTY_BROWSER",origin:new URL(job.url).origin,requestedUrl:job.url,
          method:"GET",credentials:"same-origin",mode:"same-origin",collectorContext:"PROVIDER_PAGE_BROWSER",firstPartyBinding:{...job.firstPartyBinding},
          attemptedAt:firstPartyAttemptedAt,requestAttempted:firstPartyRequestAttempted,reason,observedBytes:firstPartyCharged,
          ...(firstPartyContext ? {status:200,responseType:"basic",observedAt:firstPartyContext.observedAt} :
            firstPartyFailureContext ? {status:firstPartyFailureContext.status,responseType:"basic",observedAt:firstPartyFailureContext.observedAt,
              ...(firstPartyFailureContext.challenge ? {challenge:firstPartyFailureContext.challenge} : {})} : {status:0,responseType:"unreadable"})}} : {}),
        ...(browserAttempt ? {attempts:[browserAttempt,{transport:"CTI_SERVICE_PUBLIC_IMAGE",
          observedAt:reason === "PUBLISHER_IMAGE_UPSTREAM_CHALLENGE" ? serviceObservedAt : new Date().toISOString(),
          ...context,reason}]} : {})});
    };
    job.publisherFailure = failed;
    if (!jobCurrent(controller)) return failed(jobStopReason(controller));
    if (stats.bytes >= limits.totalBytes) return failed("DIRECT_MEDIA_BYTE_LIMIT");
    async function fallback(reason, observedAt) {
      const helper = options.providerTransport;
      if (!helper) return failed(reason);
      browserAttempt = {transport:"BROWSER_PUBLISHER_IMAGE",observedAt,status:0,responseType:"unreadable",reason};
      // Serialize only public-service fallbacks for this image origin. A queued
      // sibling must see an observed challenge before it can issue another GET.
      const origin = new URL(job.url).origin, prior = publisherImageServiceGates.get(origin) || Promise.resolve();
      let release, cancelWait;
      const held = new Promise(resolve => { release = resolve; }), tail = prior.then(() => held);
      publisherImageServiceGates.set(origin,tail);
      try {
        await Promise.race([prior,new Promise(resolve => {
          cancelWait = resolve;
          if (controller.signal.aborted) resolve();
          else controller.signal.addEventListener("abort",cancelWait,{once:true});
        })]);
        if (!jobCurrent(controller)) return failed(jobStopReason(controller));
        const blockedBy = publisherImageChallenges.get(origin);
        if (blockedBy) {
          Object.assign(serviceFailure,{notAttempted:"ORIGIN_CHALLENGE",blockedBy:{...blockedBy}});
          return failed("PUBLISHER_IMAGE_SERVICE_ORIGIN_CHALLENGE_NOT_ATTEMPTED");
        }
        if (typeof helper.ready === "function") await helper.ready();
        if (!jobCurrent(controller)) return failed(jobStopReason(controller));
        if (typeof helper.supports !== "function" || !helper.supports("publisherImage"))
          return failed("PUBLISHER_IMAGE_HELPER_OPERATION_UNSUPPORTED");
        stats.requests++; notify();
        response = await helper.request("publisherImage",{targetUrl:job.targetUrl,imageUrl:job.url,sourceSha256:job.sourceSha256},controller.signal);
        serviceFailure.serviceStatus = Number(response?.status || 0);
        const h = response?.headers, integer = name => {
          const value = h?.get(name); return /^(?:0|[1-9]\d*)$/.test(value || "") ? Number(value) : NaN;
        };
        if (h?.get("x-cti-provider-transport") === "CTI_SERVICE_PUBLIC_IMAGE" &&
            h.get("x-cti-provider-origin") === serviceFailure.serviceOrigin) {
          const status = integer("x-cti-upstream-status"), requests = integer("x-cti-upstream-requests"),
            bytes = integer("x-cti-upstream-bytes"), at = h.get("x-cti-upstream-observed-at") || "";
          if (Number.isSafeInteger(status) && (status === 0 || status >= 100 && status <= 599) && [0,1].includes(requests) &&
              Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 33554432 &&
              (status ? requests === 1 && directPublisherImageDateV1(at) : at === ""))
            Object.assign(serviceFailure,{upstreamStatus:status,upstreamObservedAt:at,upstreamRequests:requests,upstreamBytes:bytes});
        }
        if (!jobCurrent(controller)) { await discard(response); return failed(jobStopReason(controller)); }
        if (h?.get("x-cti-upstream-challenge") === "cloudflare" && serviceFailure.serviceStatus === 502 &&
            serviceFailure.upstreamStatus === 403 && serviceFailure.upstreamRequests === 1 && serviceFailure.upstreamBytes === 0) {
          serviceFailure.upstreamChallenge = "cloudflare";
          serviceObservedAt = new Date().toISOString();
          publisherImageChallenges.set(origin,{url:job.url,observedAt:serviceObservedAt});
          await discard(response);
          return failed("PUBLISHER_IMAGE_UPSTREAM_CHALLENGE");
        }
        serviceContext = directPublisherImageServiceHeadersV1(response,job.sourceSha256);
        if (!serviceContext) {
          stats.bytes += serviceFailure.upstreamBytes; notify();
          if (stats.bytes > limits.totalBytes) {
            bodyBudgetExhausted = true;
            for (const activeController of controllers) activeController.abort("DIRECT_MEDIA_BYTE_LIMIT");
          }
          await discard(response);
          return failed(bodyBudgetExhausted ? "DIRECT_MEDIA_BYTE_LIMIT" : serviceFailure.upstreamStatus && serviceFailure.upstreamStatus !== 200
            ? "PUBLISHER_IMAGE_UPSTREAM_HTTP_" + serviceFailure.upstreamStatus : response?.status !== 200
              ? "PUBLISHER_IMAGE_SERVICE_HTTP_" + Number(response?.status || 0) : "PUBLISHER_IMAGE_SERVICE_RECEIPT_INVALID");
        }
        // The buffered service has already read these upstream bytes, even if
        // browser delivery or later MIME verification fails. Charge once here;
        // matching delivered chunks below must not charge the same read twice.
        stats.bytes += serviceContext.upstreamBytes; notify();
        if (stats.bytes > limits.totalBytes) {
          bodyBudgetExhausted = true;
          for (const activeController of controllers) activeController.abort("DIRECT_MEDIA_BYTE_LIMIT");
          await discard(response); return failed("DIRECT_MEDIA_BYTE_LIMIT");
        }
        return null;
      } catch (error) {
        return failed(!jobCurrent(controller) ? jobStopReason(controller) :
          /^[A-Z0-9_]{1,80}$/.test(error?.code || "") ? "PUBLISHER_IMAGE_" + error.code : "PUBLISHER_IMAGE_SERVICE_BLOCKED_OR_FAILED");
      } finally {
        controller.signal.removeEventListener("abort",cancelWait);
        release();
        tail.then(() => { if (publisherImageServiceGates.get(origin) === tail) publisherImageServiceGates.delete(origin); });
      }
    }
    try {
      const browserObservedAt = new Date().toISOString();
      if (job.firstPartyBinding) {
        const helper = options.publisherFirstPartyTransport,
          payload = {targetUrl:job.targetUrl,imageUrl:job.url,sourceSha256:job.sourceSha256,binding:job.firstPartyBinding};
        if (!helper || typeof helper.request !== "function" || typeof helper.supports !== "function" || !helper.supports(payload))
          return failed("PUBLISHER_FIRST_PARTY_PLAN_INVALID");
        firstPartyRequestAttempted=true;stats.requests++; notify();
        const read = await helper.request(payload,controller.signal), r = read?.receipt;
        response = read?.response;
        if (!jobCurrent(controller)) { await discard(response); return failed(jobStopReason(controller)); }
        if (!r || r.transport !== "FIRST_PARTY_BROWSER" || r.origin !== new URL(job.url).origin || r.requestedUrl !== job.url || r.finalUrl !== job.url ||
            r.method !== "GET" || r.credentials !== "same-origin" || r.mode !== "same-origin" || r.responseType !== "basic" || r.status !== 200 ||
            r.collectorContext !== "PROVIDER_PAGE_BROWSER" || !directPublisherImageDateV1(r.observedAt) ||
            directCanonicalSourceTextV1(read.firstPartyBinding) !== directCanonicalSourceTextV1(job.firstPartyBinding) ||
            directCanonicalSourceTextV1(r.firstPartyBinding) !== directCanonicalSourceTextV1(job.firstPartyBinding) ||
            response?.type !== "basic" || response.url !== job.url || response.status !== 200 ||
            r.originalContentType !== response.headers?.get("content-type") ||
            !directPublisherFirstPartyImageBindingV1(r,job.url,job.sourceSha256,job.firstPartyBinding)) {
          await discard(response); return failed("PUBLISHER_FIRST_PARTY_RECEIPT_INVALID");
        }
        firstPartyContext = r;
      } else try {
        stats.requests++; notify();
        response = await fetchImpl(job.url, {method:"GET", mode:"cors", credentials:"omit",
          redirect:"error", referrerPolicy:"no-referrer", signal:controller.signal});
      } catch (_) {
        if (!jobCurrent(controller)) return failed(jobStopReason(controller));
        const unavailable = await fallback("PUBLISHER_IMAGE_BLOCKED_OR_FAILED",browserObservedAt);
        if (unavailable) return unavailable;
      }
      if (!jobCurrent(controller)) { await discard(response); return failed(jobStopReason(controller)); }
      if (!serviceContext && !firstPartyContext && response?.type !== "cors") {
        await discard(response);
        const unavailable = await fallback("PUBLISHER_IMAGE_RESPONSE_UNREADABLE",browserObservedAt);
        if (unavailable) return unavailable;
      }
      if (!serviceContext && (response.url !== job.url || response.status !== 200)) {
        await discard(response); return failed(response?.type === "cors" && response.status !== 200
          ? "PUBLISHER_IMAGE_HTTP_" + Number(response.status) : "PUBLISHER_IMAGE_RESPONSE_UNREADABLE");
      }
      const originalContentType = response.headers.get("content-type") || "",
        mime = originalContentType.split(";")[0].trim().toLowerCase();
      if (originalContentType.length > 256 || /[\u0000-\u001f\u007f]/.test(originalContentType) ||
          !["image/png","image/jpeg","image/jpg","image/gif","image/webp"].includes(mime) ||
          response.headers.get("content-range")) {
        await discard(response); return failed("PUBLISHER_IMAGE_MIME_OR_RANGE_UNSUPPORTED");
      }
      // Browser bytes may be content-decoded; a wire Content-Length is not
      // evidence of their decoded length. EOF, actual limits and SHA bind them.
      const reader = response.body?.getReader();
      if (!reader) return failed("PUBLISHER_IMAGE_BODY_UNREADABLE");
      const chunks = []; let count = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (firstPartyContext) chargeFirstParty();
          if (!jobCurrent(controller)) return failed(jobStopReason(controller));
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) return failed("PUBLISHER_IMAGE_BODY_UNREADABLE");
          const priorCount = count;
          count += part.value.byteLength;
          if (firstPartyContext) chargeFirstParty(count);
          else stats.bytes += serviceContext
            ? Math.max(0,count - serviceContext.declaredBodyBytes) - Math.max(0,priorCount - serviceContext.declaredBodyBytes)
            : part.value.byteLength;
          notify();
          if (stats.bytes > limits.totalBytes) {
            bodyBudgetExhausted = true;
            for (const activeController of controllers) activeController.abort("DIRECT_MEDIA_BYTE_LIMIT");
            return failed("DIRECT_MEDIA_BYTE_LIMIT");
          }
          if (count > limits.bodyBytes || firstPartyContext && firstPartyCharged > limits.bodyBytes) return failed("PUBLISHER_IMAGE_BODY_BYTE_LIMIT");
          if (serviceContext && count > serviceContext.declaredBodyBytes) return failed("PUBLISHER_IMAGE_SERVICE_LENGTH_MISMATCH");
          if (part.value.length) chunks.push(part.value);
          if (chunks.length > 8192) return failed("PUBLISHER_IMAGE_CHUNK_LIMIT");
        }
      } finally { try { await reader.cancel(); } catch (_) {} }
      if (!count) return failed("PUBLISHER_IMAGE_BODY_EMPTY");
      if (serviceContext && count !== serviceContext.declaredBodyBytes) return failed("PUBLISHER_IMAGE_SERVICE_LENGTH_MISMATCH");
      if (firstPartyContext && firstPartyCharged !== count) return failed("PUBLISHER_FIRST_PARTY_LENGTH_MISMATCH");
      const bytes = new Uint8Array(count); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      if (!directPublisherImageKindV1(bytes,mime)) return failed("PUBLISHER_IMAGE_MAGIC_INVALID");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),
        sha256 = [...digest].map(v => v.toString(16).padStart(2,"0")).join("");
      if (!jobCurrent(controller)) return failed(jobStopReason(controller));
      if (serviceContext && sha256 !== serviceContext.upstreamSha256) return failed("PUBLISHER_IMAGE_SERVICE_HASH_MISMATCH");
      const body = {archivePath:"files/" + sha256, sha256,size:count,mime,canonicalUrl:job.url,
        receipt:{resource:"PublisherImage",transport:firstPartyContext ? "FIRST_PARTY_BROWSER" : serviceContext ? "CTI_SERVICE_PUBLIC_IMAGE" : "BROWSER_PUBLISHER_IMAGE",sourceSha256:job.sourceSha256,
          requestedUrl:job.url,finalUrl:job.url,method:"GET",credentials:firstPartyContext ? "same-origin" : "omit",responseType:firstPartyContext ? "basic" : serviceContext ? "service" : "cors",status:200,
          bytes:count,mime,sha256,observedAt:new Date().toISOString(),originalContentType,
          ...(serviceContext ? {...serviceContext,observedAtBasis:"BROWSER_RESPONSE",browserAttempt} : {}),
          ...(firstPartyContext ? {origin:firstPartyContext.origin,mode:"same-origin",collectorContext:"PROVIDER_PAGE_BROWSER",
            responseObservedAt:firstPartyContext.observedAt,firstPartyBinding:{...job.firstPartyBinding}} : {}),
          bodyFormat:"ORIGINAL_BINARY_BYTES_ARCHIVE"}};
      Object.defineProperty(body,"bytes",{value:bytes,enumerable:false,configurable:true});
      return {url:job.url,body};
    } catch (error) {
      if (job.firstPartyBinding && Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 && directPublisherImageDateV1(error.observedAt))
        firstPartyFailureContext={status:error.status,observedAt:error.observedAt,...(error.status === 403 && error.challenge === "cloudflare" ? {challenge:"cloudflare"} : {})};
      if (job.firstPartyBinding) try { chargeFirstParty(0,Number(error?.observedBytes || 0)); } catch (_) { return failed("PUBLISHER_FIRST_PARTY_BYTE_CONTEXT_INVALID"); }
      if (response) await discard(response);
      const safeCode = /^PUBLISHER_FIRST_PARTY_[A-Z0-9_]{1,70}$/.test(error?.code || "") &&
        (!/^PUBLISHER_FIRST_PARTY_HTTP_/.test(error.code) || error.code === "PUBLISHER_FIRST_PARTY_HTTP_" + firstPartyFailureContext?.status) ? error.code : "PUBLISHER_FIRST_PARTY_BLOCKED_OR_FAILED";
      return failed(jobCurrent(controller) ? job.firstPartyBinding ? safeCode : serviceContext ? "PUBLISHER_IMAGE_SERVICE_BLOCKED_OR_FAILED" : "PUBLISHER_IMAGE_BLOCKED_OR_FAILED" : jobStopReason(controller));
    }
  }
  async function work(job, controller) {
    const assetId = job.assetId;
    if (!jobCurrent(controller))
      return failure(assetId, jobStopReason(controller));
    if (job.kind === "PUBLISHER_IMAGE") return capturePublisherImage(job,controller);
    if (job.kind === "PANOPTO_PODCAST") {
      const partial = {...job.binding};
      // Old attempt bodies cannot prove the bytes currently served by a
      // mutable rendition URL. Every new attempt takes a fresh bound GET.
      const helper=options.providerTransport;
      const location = helper ? job.binding.canonicalUrl : typeof job.metadataRead.takePanoptoPodcastLocation === "function"
        ? job.metadataRead.takePanoptoPodcastLocation(assetId) : "";
      if (!location || canonicalDirectAssetUrlV1(location) !== job.binding.canonicalUrl)
        return failure(assetId, "PANOPTO_PODCAST_LOCATION_UNSUPPORTED", partial);
      let providerRequest;
      if (helper) {
        if (!globalThis.crypto?.subtle) return failure(assetId,"RESPONSE_HASH_UNAVAILABLE",partial);
        const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(job.sourceCanonical));
        providerRequest={targetUrl:job.targetUrl,streamFileId:assetId,
          sourceHash:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("")};
      }
      const result = await captureBody(assetId,location,job.binding,controller,job.bodyBytes,providerRequest);
      return {...partial,...result};
    }
    if (typeof api?.readAsset !== "function")
      return failure(assetId, "ASSET_API_READER_UNAVAILABLE");
    const retained = await directRetainedAssetBodyV1(
      job.retainedEvidence,
      assetId,
      job.bodyBytes,
    );
    if (!jobCurrent(controller))
      return failure(assetId, jobStopReason(controller));
    if (!retained && stats.bytes >= limits.totalBytes) {
      bodyBudgetExhausted = true;
      notify();
      return failure(assetId, "DIRECT_MEDIA_BYTE_LIMIT");
    }
    const metadata = await api.readAsset(assetId);
    if (!jobCurrent(controller))
      return failure(assetId, jobStopReason(controller));
    const partial = {
      metadata: metadata?.data || null,
      metadataReceipt: scopedReceipt(metadata, assetId),
    };
    if (!metadata?.ok)
      return failure(
        assetId,
        metadata?.reason || "DIRECT_ASSET_METADATA_FAILED",
        partial,
      );
    const binding = directAssetMetadataBindingV1(metadata.data, assetId);
    if (!binding)
      return failure(assetId, "DIRECT_ASSET_METADATA_INVALID", partial);
    if (
      retained &&
      retained.binding.modelCanonical === binding.modelCanonical
    ) {
      partial.body = retained.body;
      if (archiveMode && partial.body.archivePath === undefined) {
        const bytes = decodeDirectAssetBodyV1(partial.body, job.bodyBytes);
        partial.body = {
          archivePath: "files/" + retained.body.sha256,
          sha256: retained.body.sha256,
          size: retained.body.size,
          mime: retained.body.mime,
          canonicalUrl: retained.body.canonicalUrl,
          receipt: {
            ...retained.body.receipt,
            bodyFormat: "ORIGINAL_BINARY_BYTES_ARCHIVE",
          },
        };
        Object.defineProperty(partial.body, "bytes", {
          value: bytes,
          enumerable: false,
          configurable: true,
        });
      }
    } else {
      const location =
        typeof metadata.takeAssetLocation === "function"
          ? metadata.takeAssetLocation()
          : "";
      if (
        !location ||
        canonicalDirectAssetUrlV1(location) !== binding.canonicalUrl
      )
        return failure(assetId, "DIRECT_ASSET_LOCATION_UNSUPPORTED", partial);
      const downloaded = await captureBody(
        assetId,
        location,
        binding,
        controller,
        job.bodyBytes,
      );
      if (!downloaded.body)
        return failure(
          assetId,
          downloaded.reason || "DIRECT_ASSET_BODY_FETCH_FAILED",
          partial,
        );
      partial.body = downloaded.body;
    }
    const fresh = await api.readAsset(assetId);
    if (!jobCurrent(controller))
      return failure(assetId, jobStopReason(controller), partial);
    const freshBinding =
      fresh?.ok && directAssetMetadataBindingV1(fresh.data, assetId);
    const stability = {
      stable:
        !!freshBinding &&
        freshBinding.modelCanonical === binding.modelCanonical,
      metadata: fresh?.data || null,
      receipt: scopedReceipt(fresh, assetId),
    };
    partial.stability = stability;
    if (!fresh?.ok)
      return failure(
        assetId,
        fresh?.reason || "DIRECT_ASSET_STABILITY_FAILED",
        partial,
      );
    if (!stability.stable)
      return failure(assetId, "DIRECT_ASSET_METADATA_CHANGED", partial);
    return { assetId, ...partial };
  }
  async function execute(job) {
    const controller = new AbortController();
    controllers.add(controller);
    const failed = reason => typeof job.publisherFailure === "function"
      ? job.publisherFailure(reason) : failure(job.assetId,reason);
    let timer, listener;
    const cancelled = new Promise((resolve) => {
      const durationRemaining = limits.durationMs - (Date.now() - startedAt),
        durationDeadline = durationRemaining <= limits.requestMs;
      listener = () =>
        resolve(failed(stopReason || "OPERATOR_STOPPED"));
      cancellation.signal.addEventListener("abort", listener, { once: true });
      timer = setTimeout(
        () => {
          if (durationDeadline || Date.now() - startedAt >= limits.durationMs) {
            abort("DIRECT_MEDIA_TIME_LIMIT");
            return;
          }
          controller.abort("DIRECT_MEDIA_REQUEST_TIMEOUT");
          resolve(failed("DIRECT_MEDIA_REQUEST_TIMEOUT"));
        },
        Math.max(1, Math.min(limits.requestMs, durationRemaining)),
      );
    });
    try {
      return await Promise.race([work(job, controller), cancelled]);
    } finally {
      clearTimeout(timer);
      cancellation.signal.removeEventListener("abort", listener);
      controllers.delete(controller);
    }
  }
  function pump() {
    if (!current()) return;
    while (
      queue.length &&
      !stopReason &&
      stats.active < limits.concurrentRequests
    ) {
      const job = queue.shift();
      stats.active++;
      stats.maxConcurrentRequests = Math.max(
        stats.maxConcurrentRequests,
        stats.active,
      );
      notify();
      const settle = (result) => {
        stats.active--;
        if (result.reason) stats.failed++;
        else stats.completed++;
        notify();
        job.resolve(result);
        pump();
      };
      execute(job).then(settle, () =>
        settle(failure(job.assetId, "DIRECT_MEDIA_READER_FAILED")),
      );
    }
  }
  function capture(assetId, retainedEvidence, captureOptions = {}) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(assetId || ""))
      return Promise.resolve(failure(assetId, "INVALID_ASSET_ID"));
    const requested = Number(captureOptions?.bodyBytes),
      bodyBytes =
        Number.isFinite(requested) && requested >= 0
          ? Math.min(limits.bodyBytes, Math.floor(requested))
          : limits.bodyBytes;
    if (bodyBytes === 0)
      return Promise.resolve(failure(assetId, "DIRECT_ASSET_BODY_BYTE_LIMIT"));
    if (!current()) return Promise.resolve(failure(assetId, stopReason));
    const previous = pending.get(assetId);
    if (
      previous &&
      !(previous.settled && previous.failed && retainedEvidence)
    ) {
      if (bodyBytes >= previous.bodyBytes) return previous.promise;
      // An in-flight or settled original cannot bypass a smaller caller's
      // remaining reading limit merely by sharing its request/cache entry.
      return previous.promise.then((result) =>
        result.body?.size > bodyBytes
          ? failure(assetId, "DIRECT_ASSET_BODY_BYTE_LIMIT", {
              metadata: result.metadata,
              metadataReceipt: result.metadataReceipt,
              stability: result.stability,
            })
          : result,
      );
    }
    const record = { settled: false, failed: false, promise: null, bodyBytes };
    const promise = new Promise((resolve) => {
      queue.push({
        assetId,
        retainedEvidence,
        bodyBytes,
        resolve: (result) => {
          record.settled = true;
          record.failed = !!result.reason;
          resolve(result);
        },
      });
      notify();
      pump();
    });
    record.promise = promise;
    pending.set(assetId, record);
    return promise;
  }
  function release(assetId) {
    const record = pending.get(assetId);
    if (!record?.settled) return false;
    pending.delete(assetId);
    return true;
  }
  function capturePanoptoPodcast(metadataRead, streamFileId, retainedPodcast, captureOptions = {}) {
    let binding, sourceCanonical, targetUrl;
    try {
      targetUrl=metadataRead?.receipt?.targetUrl;
      if (!metadataRead?.ok || metadataRead.receipt.resource!=="PanoptoDeliveryInfo" ||
          metadataRead.receipt.status!==200 || !/^[a-f0-9]{64}$/.test(metadataRead.receipt.originalResponseSha256 || ""))
        return Promise.resolve(failure(streamFileId,"PANOPTO_METADATA_INVALID"));
      sourceCanonical=directCanonicalSourceTextV1(directPanoptoSourceV1(targetUrl,metadataRead.data));
      const matches=directPanoptoPodcastBindingsV1(metadataRead.data,targetUrl)
        .filter(candidate=>candidate.streamFileId===streamFileId);
      if (matches.length!==1) return Promise.resolve(failure(streamFileId,"PANOPTO_PODCAST_IDENTITY_INVALID"));
      binding=matches[0];
    } catch (_) {return Promise.resolve(failure(streamFileId,"PANOPTO_METADATA_INVALID"));}
    const requested=Number(captureOptions?.bodyBytes), bodyBytes=Number.isFinite(requested) && requested>=0
      ? Math.min(limits.podcastBodyBytes,Math.floor(requested)) : limits.podcastBodyBytes;
    if (!bodyBytes) return Promise.resolve(failure(streamFileId,"DIRECT_ASSET_BODY_BYTE_LIMIT",binding));
    if (!current()) return Promise.resolve(failure(streamFileId,stopReason,binding));
    return new Promise(resolve=>{
      queue.push({kind:"PANOPTO_PODCAST",assetId:streamFileId,metadataRead,binding,bodyBytes,targetUrl,sourceCanonical,
        resolve:result=>resolve({...binding,...result})});
      notify();pump();
    });
  }
  async function readPublisherImage(observation, targetUrl, resource, firstPartyBinding) {
    const inventory = directPublisherMediaInventoryV1(observation,targetUrl),
      expected = inventory?.resources.find(value => value.url === resource?.url);
    if (!expected || directCanonicalSourceTextV1(expected) !== directCanonicalSourceTextV1(resource))
      return {url:resource?.url || "",reason:"PUBLISHER_IMAGE_SOURCE_INVALID"};
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(observation.model.rawJson)));
    if ([...digest].map(v => v.toString(16).padStart(2,"0")).join("") !== inventory.sourceSha256)
      return {url:resource.url,reason:"PUBLISHER_IMAGE_SOURCE_HASH_INVALID"};
    if (firstPartyBinding && (!options.publisherFirstPartyTransport ||
        firstPartyBinding.targetUrl !== targetUrl ||
        !directPublisherFirstPartyImageBindingV1({transport:"FIRST_PARTY_BROWSER",firstPartyBinding},resource.url,inventory.sourceSha256)))
      return {url:resource.url,reason:"PUBLISHER_FIRST_PARTY_PLAN_INVALID"};
    if (!current() || stats.bytes >= limits.totalBytes)
      return {url:resource.url,reason:stopReason || "DIRECT_MEDIA_BYTE_LIMIT"};
    const key = "PUBLISHER_IMAGE:" + inventory.sourceSha256 + ":" + resource.url +
      (firstPartyBinding ? ":" + directCanonicalSourceTextV1(firstPartyBinding) : "");
    if (pending.has(key)) return pending.get(key).promise;
    const promise = new Promise(resolve => {
      queue.push({kind:"PUBLISHER_IMAGE",assetId:resource.url,url:resource.url,targetUrl,sourceSha256:inventory.sourceSha256,
        ...(firstPartyBinding ? {firstPartyBinding:{...firstPartyBinding}} : {}),resolve});
      notify(); pump();
    });
    pending.set(key,{promise});
    return promise;
  }
  function readPublisherImageFirstParty(observation,targetUrl,resource,binding) {
    if (!binding) return Promise.resolve({url:resource?.url || "",reason:"PUBLISHER_FIRST_PARTY_PLAN_INVALID"});
    return readPublisherImage(observation,targetUrl,resource,binding);
  }
  return { capture, capturePanoptoPodcast, readPublisherImage, readPublisherImageFirstParty, snapshot, abort, release };
}
