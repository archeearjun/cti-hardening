/** Bounded response bytes. Count bytes actually exposed by the browser, including
 * the chunk which exceeds a limit; these are decoded HTTP-body bytes, not wire
 * transfer measurements. No partial body is returned as a captured original. */
export async function readBrightspaceBoundedBodyV110(response, options = {}) {
  const maxBytes = options.maxBytes || 4 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw Error("INVALID_BODY_LIMIT");
  const fail = (code) => {
    const error = Error(code);
    error.code = code;
    return error;
  };
  const lengthHeader = response.headers.get("content-length"),
    encoding = (response.headers.get("content-encoding") || "")
      .trim()
      .toLowerCase();
  let declared = null;
  // Fetch exposes decoded response bytes. A compressed wire Content-Length
  // cannot establish their size; an identity length can detect a clean but
  // incomplete EOF. Chunked responses need no invented expected length.
  if ((!encoding || encoding === "identity") && lengthHeader !== null) {
    const value = lengthHeader.trim();
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      await response.body?.cancel().catch(() => {});
      throw fail("INVALID_CONTENT_LENGTH");
    }
    declared = Number(value);
  }
  if (declared !== null && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw fail("BODY_LIMIT_EXCEEDED");
  }
  options.signal?.throwIfAborted();
  if (!response.body || typeof response.body.getReader !== "function")
    throw fail("RESPONSE_STREAM_UNAVAILABLE");
  const reader = response.body.getReader(),
    chunks = [];
  let length = 0,
    finished = false;
  const abort = () => {
    reader.cancel().catch(() => {});
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const next = await reader.read();
      options.signal?.throwIfAborted();
      if (next.done) {
        finished = true;
        if (declared !== null && length !== declared)
          throw fail("BODY_LENGTH_MISMATCH");
        break;
      }
      const bytes =
        next.value instanceof Uint8Array
          ? next.value
          : new Uint8Array(next.value);
      length += bytes.byteLength;
      options.onBytes?.(bytes.byteLength);
      if (length > maxBytes) throw fail("BODY_LIMIT_EXCEEDED");
      if (declared !== null && length > declared)
        throw fail("BODY_LENGTH_MISMATCH");
      chunks.push(bytes);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** The caller owns the request deadline; this bounds and decodes its response. */
export async function readBrightspaceJsonResponse(response, options = {}) {
  const bytes = await readBrightspaceBoundedBodyV110(response, options);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    const error = Error("INVALID_JSON_RESPONSE");
    error.code = "INVALID_JSON_RESPONSE";
    throw error;
  }
}

/** An observed Brightspace temporary image-file view, not a general tool route.
 * Keep the URL path literal: encoded separators or alternate wrapper shapes do
 * not establish the same native file endpoint. */
export function brightspaceImageViewPathV111(pathname) {
  const match =
    /^\/d2l\/lp\/files\/temp\/[A-Za-z0-9_-]{1,160}\.([A-Za-z]{3,4});[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.([A-Za-z]{3,4})\/View$/.exec(
      pathname,
    );
  return (
    !!match &&
    /^(?:png|jpe?g|gif|webp|svg)$/.test(match[1].toLowerCase()) &&
    match[1].toLowerCase() === match[2].toLowerCase()
  );
}

/** Opaque DWG originals are eligible only in this course's native static-file
 * container. This does not authorize general same-origin tool or file routes. */
export function brightspaceDwgPathV121(pathname, courseId) {
  if (
    !/^\d{1,20}$/.test(String(courseId || "")) ||
    /%(?:2f|5c|00|25)/i.test(pathname)
  )
    return false;
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (
    /\/(?:login|logon|signin|signout|logout|auth|oauth|saml|sso)(?:[/.]|$)/i.test(
      path,
    ) ||
    /\/d2l\/api\//i.test(path)
  )
    return false;
  const match =
    /^\/content\/enforced\/(\d{1,20})(?:-[A-Za-z0-9_-]{1,160})?\/(.+\.dwg)$/i.exec(
      path,
    );
  return (
    !!match &&
    match[1] === String(courseId) &&
    !/[\\\0\r\n]/.test(path) &&
    !match[2].split("/").some((part) => !part || part === "." || part === "..")
  );
}

export function brightspaceDwgMimeV121(contentType) {
  return /^(?:image\/(?:vnd\.dwg|x-dwg)|application\/(?:acad|x-acad|autocad|x-autocad|dwg|x-dwg|octet-stream)|drawing\/dwg)$/i.test(
    String(contentType || "")
      .split(";", 1)[0]
      .trim(),
  );
}

/** A recognized original header is not CAD semantic or rendering validation. */
export function brightspaceDwgBytesV121(bytes) {
  return (
    bytes.length >= 128 &&
    /^AC(?:1015|1018|1021|1024|1027|1032)$/.test(
      String.fromCharCode(...bytes.subarray(0, 6)),
    ) &&
    bytes.subarray(6, 11).every((byte) => byte === 0)
  );
}

export function classifyBrightspaceReferenceV110(
  rawUrl,
  baseUrl,
  origin,
  courseId = "",
) {
  let url;
  try {
    url = new URL(String(rawUrl || ""), baseUrl || origin);
  } catch {
    return {
      url: "",
      kind: "INVALID",
      fetch: false,
      reason: "INVALID_REFERENCE_URL",
    };
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    return {
      url: url.href,
      kind: "UNSUPPORTED_SCHEME",
      fetch: false,
      reason: "NON_HTTP_OR_CREDENTIAL_URL",
    };
  if (url.origin !== new URL(origin).origin) {
    const kind = /(?:^|\.)hosted\.panopto\.com$/i.test(url.hostname)
      ? "PANOPTO"
      : /(?:^|\.)yuja\.com$/i.test(url.hostname)
        ? "YUJA"
        : "EXTERNAL";
    return {
      url: url.href,
      kind,
      fetch: false,
      reason: "EXTERNAL_REFERENCE_NOT_FETCHED",
    };
  }
  if (
    /\/(?:login|logon|signin|signout|logout|auth|oauth|saml|sso)(?:[/.]|$)/i.test(
      url.pathname,
    ) ||
    /\/d2l\/api\//i.test(url.pathname)
  )
    return {
      url: url.href,
      kind: "DYNAMIC_TOOL",
      fetch: false,
      reason: "AUTH_OR_API_REFERENCE_NOT_FETCHED",
    };
  if (/\/quickLink\.d2l$/i.test(url.pathname)) {
    let type = "",
      fileId = "";
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() === "type") type = value.toLowerCase();
      if (key.toLowerCase() === "fileid") fileId = value;
    }
    if (type === "lti")
      return {
        url: url.href,
        kind: "LTI",
        fetch: false,
        reason: "DYNAMIC_LTI_NOT_LAUNCHED",
      };
    if (
      type === "coursefile" &&
      fileId &&
      /\.(?:pdf|pptx?|docx?|xlsx?|csv|txt|srt|vtt|jpe?g|png|gif|webp|svg|zip)$/i.test(
        fileId,
      )
    )
      return { url: url.href, kind: "COURSE_FILE", fetch: true, reason: "" };
    return {
      url: url.href,
      kind: "DYNAMIC_TOOL",
      fetch: false,
      reason: "DYNAMIC_TOOL_NOT_LAUNCHED",
    };
  }
  if (brightspaceImageViewPathV111(url.pathname) && !url.search)
    return { url: url.href, kind: "SAME_ORIGIN_FILE", fetch: true, reason: "" };
  let decodedPath = url.pathname;
  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {}
  if (
    /^\/d2l\/lp\/files\/temp\//.test(decodedPath) &&
    decodedPath.includes(";")
  )
    return {
      url: url.href,
      kind: "UNSUPPORTED_RESOURCE",
      fetch: false,
      reason: "UNSUPPORTED_NATIVE_IMAGE_VIEW",
    };
  if (brightspaceDwgPathV121(url.pathname, courseId))
    return { url: url.href, kind: "SAME_ORIGIN_FILE", fetch: true, reason: "" };
  if (
    /\.(?:html?|xhtml|txt|srt|vtt|csv|json|jpe?g|png|gif|webp|svg|pdf|pptx?|docx?|xlsx?|mp4|webm|mp3|wav|m4a|zip)$/i.test(
      url.pathname,
    )
  )
    return { url: url.href, kind: "SAME_ORIGIN_FILE", fetch: true, reason: "" };
  return {
    url: url.href,
    kind: "UNSUPPORTED_RESOURCE",
    fetch: false,
    reason: "NO_SUPPORTED_STATIC_RESOURCE",
  };
}

/** One attempt owns its cache and byte budgets. Native placement bindings remain
 * separate even when their exact URLs or retained SHA-256 bodies are shared. */
export function createBrightspaceContentReader(options = {}) {
  const origin = new URL(options.origin || location.origin).origin;
  const courseId = String(options.courseId || "");
  const limits = {
    maxTextBytes: options.maxTextBytes || 4 * 1024 * 1024,
    maxAssetBytes: options.maxAssetBytes || 16 * 1024 * 1024,
    maxTotalBytes: options.maxTotalBytes || 96 * 1024 * 1024,
    maxRetainedBytes: options.maxRetainedBytes || 64 * 1024 * 1024,
    maxTextProjectionBytes: options.maxTextProjectionBytes || 16 * 1024 * 1024,
    maxRequests: options.maxRequests || 800,
    maxReferences: options.maxReferences || 2000,
    timeoutMs: options.timeoutMs || 30000,
  };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw Error("INVALID_CONTENT_READER_LIMIT");
  const request = options.request || ((url, init) => fetch(url, init));
  const Parser = options.DOMParser || globalThis.DOMParser;
  const encoder = new TextEncoder(),
    cache = new Map(),
    assets = new Map(),
    bodies = {};
  const gaps = [],
    referenceInventories = [];
  let requests = 0,
    observedBytes = 0,
    retainedBytes = 0,
    textProjectionBytes = 0,
    referenceCount = 0;

  async function hash(bytes) {
    const digest = options.sha256
      ? await options.sha256(bytes)
      : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
    if (!/^[a-f0-9]{64}$/.test(digest)) throw Error("INVALID_BODY_SHA256");
    return digest;
  }
  function binding(value) {
    if (
      !value ||
      ![
        "TOPIC",
        "MODULE",
        "QUIZ",
        "ASSIGNMENT",
        "DISCUSSION",
        "DISCUSSION_TOPIC",
      ].includes(value.kind) ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(String(value.id || "")) ||
      (value.kind === "DISCUSSION_TOPIC" &&
        !/^\d{1,20}$/.test(String(value.parentId || "")))
    )
      throw Error("NATIVE_SOURCE_BINDING_REQUIRED");
    return {
      kind: value.kind,
      id: String(value.id),
      path: Array.isArray(value.path)
        ? value.path.map(String)
        : String(value.path || ""),
      ...(value.kind === "DISCUSSION_TOPIC"
        ? { parentId: String(value.parentId) }
        : {}),
    };
  }
  function addBinding(record, source) {
    const exact = binding(source);
    if (
      !record.sourceBindings.some(
        (value) => JSON.stringify(value) === JSON.stringify(exact),
      )
    )
      record.sourceBindings.push(exact);
  }
  function gap(url, source, reason, extra = {}) {
    const value = { url, sourceBinding: binding(source), reason, ...extra };
    if (
      !gaps.some(
        (existing) => JSON.stringify(existing) === JSON.stringify(value),
      )
    )
      gaps.push(value);
    return value;
  }
  function base64(bytes) {
    let encoded = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      encoded += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(encoded);
  }
  function decode(bytes, contentType) {
    const charset =
      /(?:^|;)\s*charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ||
      "utf-8";
    const decoder = new TextDecoder(charset, { fatal: true, ignoreBOM: true });
    return { value: decoder.decode(bytes), charset: decoder.encoding };
  }
  function parse(html) {
    if (!Parser) throw Error("HTML_PARSER_UNAVAILABLE");
    return new Parser().parseFromString(html, "text/html");
  }
  function plainText(document) {
    function visit(node) {
      if (node.nodeType === 3 || node.nodeType === 4)
        return node.nodeValue || "";
      const tag = String(node.tagName || "").toLowerCase();
      if (["script", "style", "noscript", "template", "head"].includes(tag))
        return "";
      if (tag === "br") return "\n";
      let value = "";
      for (const child of Array.from(node.childNodes || []))
        value += visit(child);
      if (
        [
          "p",
          "div",
          "section",
          "article",
          "header",
          "footer",
          "li",
          "tr",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "blockquote",
          "pre",
        ].includes(tag)
      )
        value += "\n";
      if (["td", "th"].includes(tag)) value += "\t";
      return value;
    }
    return visit(document.body || document.documentElement || document);
  }
  function discoverReferences(html, sourceValue, baseUrl) {
    const source = binding(sourceValue),
      doc = parse(String(html || ""));
    let resolvedBase = baseUrl || origin;
    const elements = Array.from(doc.getElementsByTagName("*"));
    const base = elements.find(
      (el) =>
        String(el.tagName).toLowerCase() === "base" && el.getAttribute("href"),
    );
    if (base) {
      try {
        resolvedBase = new URL(base.getAttribute("href"), resolvedBase).href;
      } catch {}
    }
    const refs = [];
    let found = 0;
    function add(el, attribute, rawUrl) {
      if (!rawUrl) return;
      found++;
      if (referenceCount >= limits.maxReferences) return;
      referenceCount++;
      const classified = classifyBrightspaceReferenceV110(
        rawUrl,
        resolvedBase,
        origin,
        courseId,
      );
      const ref = {
        ...classified,
        rawUrl,
        tag: String(el.tagName).toLowerCase(),
        attribute,
        sourceBinding: source,
        text: el.textContent || "",
        alt: el.getAttribute("alt") || "",
      };
      refs.push(ref);
    }
    for (const el of elements) {
      const tag = String(el.tagName).toLowerCase();
      if (["a", "area"].includes(tag)) add(el, "href", el.getAttribute("href"));
      if (
        [
          "img",
          "iframe",
          "embed",
          "video",
          "audio",
          "source",
          "track",
        ].includes(tag)
      )
        add(el, "src", el.getAttribute("src"));
      if (tag === "object") add(el, "data", el.getAttribute("data"));
      if (tag === "video") add(el, "poster", el.getAttribute("poster"));
      const style = el.getAttribute("style") || "";
      for (const match of style.matchAll(
        /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,
      ))
        add(el, "style", match[1] || match[2] || match[3]);
      if (["img", "source"].includes(tag))
        for (const candidate of (el.getAttribute("srcset") || "").split(",")) {
          const raw = candidate.trim().split(/\s+/)[0];
          if (raw) add(el, "srcset", raw);
        }
    }
    const inventory = {
      sourceBinding: source,
      documentBase: resolvedBase,
      found,
      retained: refs.length,
      complete: found === refs.length,
    };
    referenceInventories.push(inventory);
    if (!inventory.complete)
      gap(baseUrl || "", source, "REFERENCE_LIMIT_EXCEEDED", {
        found,
        retained: refs.length,
      });
    refs.inventory = inventory;
    return refs;
  }
  async function acquire(url, sourceValue) {
    // Fragments are retained on the source reference but never sent over HTTP.
    const networkUrl = new URL(url);
    networkUrl.hash = "";
    url = networkUrl.href;
    const source = binding(sourceValue),
      existing = assets.get(url);
    if (existing) addBinding(existing, source);
    if (cache.has(url)) return cache.get(url);
    const asset = { url, status: "NOT_FETCHED", sourceBindings: [source] };
    assets.set(url, asset);
    const pending = (async () => {
      if (
        requests >= limits.maxRequests ||
        observedBytes >= limits.maxTotalBytes
      ) {
        asset.reason =
          requests >= limits.maxRequests
            ? "REQUEST_LIMIT_EXCEEDED"
            : "TOTAL_BODY_BUDGET_EXCEEDED";
        gap(url, source, asset.reason);
        return { asset };
      }
      requests++;
      const controller = new AbortController();
      let timedOut = false;
      const parentAbort = () => controller.abort(options.signal.reason);
      if (options.signal?.aborted) parentAbort();
      else
        options.signal?.addEventListener("abort", parentAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, limits.timeoutMs);
      try {
        controller.signal.throwIfAborted();
        const response = await request(url, {
          purpose: "COURSE_ORIGINAL_BODY",
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          mode: "same-origin",
          redirect: "follow",
          signal: controller.signal,
        });
        const mediaType = response.headers.get("content-type") || "";
        const responseUrl = response.url || url;
        asset.mediaType = mediaType;
        asset.receipt = {
          requestUrl: url,
          responseUrl,
          status: response.status,
          observedAt: new Date().toISOString(),
          contentType: mediaType,
          redirectPolicy: "SAME_ORIGIN_STATIC_CONTENT",
          mode: "same-origin",
          sourceResponseRedirected:
            response.redirected === true || responseUrl !== url,
          complete: false,
        };
        const finalTarget = classifyBrightspaceReferenceV110(
          responseUrl,
          origin,
          origin,
          courseId,
        );
        if (
          !response.ok ||
          response.status !== 200 ||
          new URL(responseUrl).origin !== origin ||
          !finalTarget.fetch ||
          (responseUrl !== url && finalTarget.kind !== "SAME_ORIGIN_FILE")
        ) {
          await response.body?.cancel().catch(() => {});
          throw Error(
            new URL(responseUrl).origin !== origin ||
              !finalTarget.fetch ||
              (responseUrl !== url && finalTarget.kind !== "SAME_ORIGIN_FILE")
              ? "OUT_OF_SCOPE_CONTENT_REDIRECT"
              : response.type === "opaqueredirect" ||
                  (response.status >= 300 && response.status < 400)
                ? "REDIRECT_NOT_FOLLOWED"
                : "HTTP_" + response.status,
          );
        }
        const isDwg = [url, responseUrl].some((target) =>
          /\.dwg$/i.test(decodeURIComponent(new URL(target).pathname)),
        );
        if (isDwg) {
          const declared = response.headers.get("content-length"),
            encoding = (response.headers.get("content-encoding") || "")
              .trim()
              .toLowerCase();
          if (
            !brightspaceDwgPathV121(new URL(url).pathname, courseId) ||
            !brightspaceDwgPathV121(new URL(responseUrl).pathname, courseId) ||
            !brightspaceDwgMimeV121(mediaType) ||
            declared === null ||
            !/^[1-9]\d*$/.test(declared.trim()) ||
            !Number.isSafeInteger(Number(declared)) ||
            response.headers.has("content-range") ||
            (encoding && encoding !== "identity")
          ) {
            await response.body?.cancel().catch(() => {});
            throw Error("DWG_ORIGINAL_RESPONSE_UNSUPPORTED");
          }
          asset.receipt.declaredBodyBytes = Number(declared);
          asset.receipt.contentRange = null;
          asset.receipt.contentEncoding = encoding || "identity";
        }
        const isText =
          !isDwg &&
          (/^(?:text\/(?:html|plain|srt|vtt|csv)|application\/(?:xhtml\+xml|json|x-subrip))(?:;|$)/i.test(
            mediaType,
          ) ||
            [url, responseUrl].some((target) =>
              /\.(?:txt|srt|vtt|csv|json)(?:[?#]|$)/i.test(target),
            ));
        const bytes = await readBrightspaceBoundedBodyV110(response, {
          signal: controller.signal,
          maxBytes: isText ? limits.maxTextBytes : limits.maxAssetBytes,
          onBytes(count) {
            observedBytes += count;
            if (observedBytes > limits.maxTotalBytes)
              throw Error("TOTAL_BODY_BUDGET_EXCEEDED");
          },
        });
        const bodyHash = await hash(bytes);
        controller.signal.throwIfAborted();
        if (isDwg && !brightspaceDwgBytesV121(bytes))
          throw Error("DWG_ORIGINAL_SIGNATURE_UNSUPPORTED");
        // Authentication forms and an HTML login/error returned for an image or
        // document are not course-file originals. Reject them before retention.
        if (
          isText &&
          /(?:text\/html|application\/xhtml\+xml)/i.test(mediaType)
        ) {
          if (
            [url, responseUrl].some(
              (target) =>
                brightspaceImageViewPathV111(new URL(target).pathname) ||
                /\.(?:jpe?g|png|gif|webp|pdf|pptx?|docx?|xlsx?|zip)(?:[?#]|$)/i.test(
                  target,
                ),
            )
          )
            throw Error("UNEXPECTED_HTML_FOR_ORIGINAL_FILE");
          let inspectedHtml = "";
          try {
            inspectedHtml = decode(bytes, mediaType).value;
          } catch {
            /* Retain undecodable originals below without claiming text. */
          }
          if (/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(inspectedHtml))
            throw Error("AUTHENTICATION_PAGE_NOT_CONTENT");
        }
        if (!bodies[bodyHash]) {
          if (retainedBytes + bytes.byteLength > limits.maxRetainedBytes)
            throw Error("RETAINED_BODY_BUDGET_EXCEEDED");
          // Archive delivery persists each immutable original independently.
          // A storage failure never publishes a successful original receipt.
          if (typeof options.retainOriginal === "function") {
            const stored = await options.retainOriginal(bytes, bodyHash);
            if (
              !stored ||
              stored.encoding !== "archive" ||
              stored.archivePath !== "files/" + bodyHash ||
              stored.bytes !== bytes.byteLength ||
              stored.sha256 !== bodyHash
            )
              throw Error("ORIGINAL_STORAGE_IDENTITY_MISMATCH");
            bodies[bodyHash] = { ...stored };
          } else
            bodies[bodyHash] = {
              encoding: "base64",
              base64: base64(bytes),
              bytes: bytes.byteLength,
              sha256: bodyHash,
            };
          retainedBytes += bytes.byteLength;
        }
        Object.assign(asset, {
          status: "CAPTURED_ORIGINAL",
          originalRef: bodyHash,
          sha256: bodyHash,
          bytes: bytes.byteLength,
          receipt: {
            ...asset.receipt,
            bytes: bytes.byteLength,
            sha256: bodyHash,
            complete: true,
          },
        });
        let text = "",
          html = "",
          format = "",
          charset = "";
        if (isText) {
          asset.projectionStatus = "UNRESOLVED";
          const decoded = decode(bytes, mediaType);
          charset = decoded.charset;
          asset.receipt.charset = charset;
          format =
            /text\/srt|application\/x-subrip/i.test(mediaType) ||
            [url, responseUrl].some((target) => /\.srt(?:[?#]|$)/i.test(target))
              ? "srt"
              : /text\/vtt/i.test(mediaType) ||
                  [url, responseUrl].some((target) =>
                    /\.vtt(?:[?#]|$)/i.test(target),
                  )
                ? "vtt"
                : /(?:text\/html|application\/xhtml\+xml)/i.test(mediaType)
                  ? "html"
                  : "text";
          if (format === "html") {
            html = decoded.value;
            text = plainText(parse(html));
          } else text = decoded.value;
          asset.projectionStatus = "CAPTURED";
        }
        if (options.signal?.aborted) options.signal.throwIfAborted();
        return {
          asset,
          ...(isText
            ? {
                text,
                html,
                format,
                charset,
                textSha256: await hash(encoder.encode(text)),
              }
            : {}),
        };
      } catch (error) {
        asset.status = asset.originalRef ? "CAPTURED_ORIGINAL" : "UNRESOLVED";
        asset.reason = timedOut
          ? "REQUEST_TIMEOUT"
          : controller.signal.aborted
            ? "REQUEST_ABORTED"
            : String(error.code || error.message || "READ_FAILED");
        if (asset.originalRef) {
          asset.projectionStatus = "UNRESOLVED";
          asset.projectionReason = asset.reason;
        }
        gap(url, source, asset.reason);
        return { asset };
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", parentAbort);
      }
    })();
    cache.set(url, pending);
    return pending;
  }
  async function readReferences(references) {
    const results = [];
    for (const ref of references || []) {
      options.signal?.throwIfAborted();
      const source = binding(ref.sourceBinding),
        classified = classifyBrightspaceReferenceV110(
          ref.url,
          ref.url || origin,
          origin,
          courseId,
        );
      if (!classified.fetch) {
        gap(classified.url, source, classified.reason, {
          kind: classified.kind,
        });
        results.push({ ...ref, ...classified, status: "NOT_FETCHED" });
      } else {
        const result = await acquire(classified.url, source);
        results.push({
          ...ref,
          status: result.asset.status,
          originalRef: result.asset.originalRef || "",
          reason: result.asset.reason || "",
        });
      }
    }
    return results;
  }
  async function readTopic(topic, settings = {}) {
    const source = binding({
      kind: "TOPIC",
      id: topic.id,
      path: topic.path || [],
    });
    const classified = classifyBrightspaceReferenceV110(
      topic.url,
      origin,
      origin,
      courseId,
    );
    const policy = topic.evidencePolicy;
    if (
      policy?.fetch === false ||
      [
        3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 24, 25, 26, 27, 29,
      ].includes(Number(topic.activityType))
    ) {
      gap(classified.url, source, "DYNAMIC_TOOL_DEFINITION_ONLY");
      return {
        status: policy?.status || "DEFINITION_API_ONLY",
        url: classified.url,
        reason:
          policy?.reason ||
          "Dynamic tool pages are never launched; read their native definitions separately.",
      };
    }
    if (!classified.fetch) {
      gap(classified.url, source, classified.reason, { kind: classified.kind });
      return {
        status:
          classified.kind === "EXTERNAL" ||
          ["PANOPTO", "YUJA"].includes(classified.kind)
            ? "EXTERNAL_NOT_FETCHED"
            : "NOT_FETCHED",
        url: classified.url,
        reason: classified.reason,
      };
    }
    const result = await acquire(classified.url, source),
      asset = result.asset;
    if (asset.status !== "CAPTURED_ORIGINAL")
      return {
        status: asset.status,
        url: asset.url,
        reason: asset.reason,
        bodyReceipt: asset.receipt || null,
      };
    if (typeof result.text !== "string")
      return {
        status: "CAPTURED_ORIGINAL",
        url: asset.url,
        contentType: asset.mediaType,
        originalRef: asset.originalRef,
        ...(asset.projectionStatus === "UNRESOLVED"
          ? {
              rawBodyRef: asset.originalRef,
              projectionStatus: "UNRESOLVED",
              projectionReason: asset.projectionReason,
            }
          : {}),
        bodyReceipt: asset.receipt,
      };
    // The JSON contains a separate projection for every native placement. Its
    // budget therefore counts emitted copies, even when HTTP/body hashes share
    // an original. Referenced HTML which is not emitted consumes no projection
    // budget; its retained original remains subject to the independent body cap.
    const projectionBytes =
      encoder.encode(result.html).byteLength +
      encoder.encode(result.text).byteLength;
    if (textProjectionBytes + projectionBytes > limits.maxTextProjectionBytes) {
      gap(asset.url, source, "TEXT_PROJECTION_BUDGET_EXCEEDED");
      return {
        status: "CAPTURED_ORIGINAL",
        url: asset.url,
        contentType: asset.mediaType,
        originalRef: asset.originalRef,
        rawBodyRef: asset.originalRef,
        bodyReceipt: asset.receipt,
        projectionStatus: "UNRESOLVED",
        projectionReason: "TEXT_PROJECTION_BUDGET_EXCEEDED",
      };
    }
    textProjectionBytes += projectionBytes;
    const refs =
      result.format === "html"
        ? discoverReferences(result.html, source, asset.receipt.responseUrl)
        : [];
    const evidence = {
      status: "CAPTURED",
      url: asset.url,
      documentUrl: asset.receipt.responseUrl,
      documentBase: refs.inventory?.documentBase || asset.receipt.responseUrl,
      contentType: asset.mediaType,
      rawBodyRef: asset.originalRef,
      bodyReceipt: asset.receipt,
      format: result.format,
      charset: result.charset,
      html: result.html,
      text: result.text,
      textLength: result.text.length,
      textSha256: result.textSha256,
      projectionTruncated: false,
      references: Array.from(refs),
      referenceReadStatus: refs.length ? "IN_PROGRESS" : "FINISHED",
      referenceInventory: refs.inventory || {
        sourceBinding: source,
        found: 0,
        retained: 0,
        complete: true,
      },
      links: refs
        .filter((ref) => ["a", "area"].includes(ref.tag))
        .map((ref) => ({ text: ref.text, rawHref: ref.rawUrl, href: ref.url })),
      images: refs
        .filter((ref) => ref.tag === "img")
        .map((ref) => ({ alt: ref.alt, rawUrl: ref.rawUrl, url: ref.url })),
      embeds: refs
        .filter((ref) =>
          [
            "iframe",
            "embed",
            "object",
            "video",
            "audio",
            "source",
            "track",
          ].includes(ref.tag),
        )
        .map((ref) => ({
          tag: ref.tag,
          rawUrl: ref.rawUrl,
          url: ref.url,
          kind: ref.kind,
        })),
    };
    // Publish the original and its exact references before acquiring children.
    // A pause can retain a child body, and its native parent must already expose
    // the source URL that owns it in the partial capture.
    settings.onEvidence?.(evidence);
    evidence.references = await readReferences(refs);
    evidence.referenceReadStatus = evidence.references.some(
      (ref) => ref.status !== "CAPTURED_ORIGINAL",
    )
      ? "FINISHED_WITH_GAPS"
      : "FINISHED";
    return evidence;
  }
  function snapshot() {
    return {
      version: 1,
      assetBodies: { ...bodies },
      assets: Array.from(assets.values()).map((asset) => ({
        ...asset,
        sourceBindings: asset.sourceBindings.map((value) => ({ ...value })),
      })),
      gaps: gaps.map((value) => ({ ...value })),
      referenceInventories: referenceInventories.map((value) => ({ ...value })),
      requests,
      observedBytes,
      retainedBytes,
      textProjectionBytes,
      limits: { ...limits },
      byteAccounting:
        "Browser-exposed decoded response-body bytes; failed reads remain charged. This is not wire-transfer accounting.",
      wholeCourseComplete: false,
    };
  }
  return { readTopic, discoverReferences, readReferences, snapshot };
}
