export const CTI_DIRECT_PUBLISHER_BODY_BYTES_V1 = 1048576;

/** A native numeric book shortlink is the only supported chapter selector.
 * This is the publisher's observed chapter API, not a slug/search fallback. */
export function directPublisherTargetV1(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4000 ||
    /[\u0000-\u0020\u007f\\%]/.test(value) ||
    /(?:^|\/)\.{1,2}(?:\/|[?#]|$)/.test(value)
  )
    return null;
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      !["opentextbc.ca", "pressbooks.bccampus.ca"].includes(u.hostname) ||
      !/^\/[a-z0-9][a-z0-9-]*\/$/i.test(u.pathname) ||
      !["", "#main"].includes(u.hash) ||
      [...u.searchParams].length !== 1 ||
      !/^[1-9]\d{0,11}\/?$/.test(u.searchParams.get("p") || "")
    )
      return null;
    const chapterId = Number(u.searchParams.get("p").replace(/\/$/, ""));
    if (!Number.isSafeInteger(chapterId)) return null;
    const endpoint = new URL(
      u.pathname + "wp-json/pressbooks/v2/chapters/" + chapterId,
      u.origin,
    );
    return {
      requestedUrl: value,
      endpointUrl: endpoint.href,
      chapterId,
      bookUrl: new URL(u.pathname, u.origin).href,
    };
  } catch {
    return null;
  }
}

/** Only these observed Pressbooks resource routes are supported. A part is
 * tried for the identical native post ID after an exposed chapter 404. */
export function directPublisherResourceTargetV1(value, resourceType) {
  const target = directPublisherTargetV1(value);
  if (!target || !["chapter", "part"].includes(resourceType)) return null;
  return {
    ...target,
    resourceType,
    endpointUrl:
      resourceType === "part"
        ? target.bookUrl + "wp-json/pressbooks/v2/parts/" + target.chapterId
        : target.endpointUrl,
  };
}

export function directPublisherContentTypeV1(value) {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return "";
  const mime = value.split(";")[0].trim().toLowerCase(),
    charsets = [
      ...value.matchAll(/(?:^|;)\s*charset\s*=\s*["']?([^\s;"']+)/gi),
    ];
  return mime === "application/json" &&
    charsets.length <= 1 &&
    (!charsets.length || /^(?:utf-?8|us-ascii)$/i.test(charsets[0][1]))
    ? mime
    : "";
}

/** Preserve the literal UTF-8 response, including a BOM. Credential-bearing
 * responses are rejected whole; redaction never produces an "original". */
export function directPublisherJsonBytesV1(rawJson) {
  if (
    typeof rawJson !== "string" ||
    !rawJson ||
    rawJson.length > CTI_DIRECT_PUBLISHER_BODY_BYTES_V1 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(rawJson) ||
    /\bBearer\s+[A-Za-z0-9_~.+\/-]{12,}/i.test(rawJson) ||
    /[?&](?:access_token|refresh_token|id_token|hmac|x-amz-signature|x-goog-signature|signature)=[^\s"'<>]+/i.test(
      rawJson,
    )
  )
    return null;
  try {
    const bytes = new TextEncoder().encode(rawJson);
    return bytes.length <= CTI_DIRECT_PUBLISHER_BODY_BYTES_V1 &&
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      ) === rawJson
      ? bytes
      : null;
  } catch {
    return null;
  }
}

export function directPublisherResourceV1(rawJson, targetUrl, resourceType) {
  const target = directPublisherTargetV1(targetUrl);
  if (
    !target ||
    !["chapter", "part"].includes(resourceType) ||
    !directPublisherJsonBytesV1(rawJson)
  )
    return null;
  try {
    const chapter = JSON.parse(
      rawJson.charCodeAt(0) === 0xfeff ? rawJson.slice(1) : rawJson,
    );
    const object = (value) =>
      value && typeof value === "object" && !Array.isArray(value);
    if (
      !object(chapter) ||
      chapter.id !== target.chapterId ||
      chapter.status !== "publish" ||
      chapter.type !== resourceType ||
      typeof chapter.link !== "string" ||
      chapter.link.length > 4000
    )
      return null;
    if (resourceType === "part" && chapter._links?.self !== undefined) {
      const self = chapter._links.self,
        endpoint = directPublisherResourceTargetV1(
          targetUrl,
          "part",
        ).endpointUrl;
      if (
        !Array.isArray(self) ||
        !self.length ||
        self.length > 8 ||
        self.some((value) => !object(value) || value.href !== endpoint)
      )
        return null;
    }
    const link = new URL(chapter.link),
      book = new URL(target.bookUrl);
    if (
      link.protocol !== "https:" ||
      link.origin !== book.origin ||
      link.username ||
      link.password ||
      link.port ||
      link.hash ||
      /[\u0000-\u0020\u007f\\%]/.test(chapter.link) ||
      /(?:^|\/)\.{1,2}(?:\/|[?#]|$)/.test(chapter.link) ||
      !link.pathname.startsWith(book.pathname) ||
      /(?:^|\/)(?:wp-admin|wp-login|wp-json)(?:\/|\.|$)/i.test(link.pathname) ||
      (link.search &&
        !(
          link.pathname === book.pathname &&
          [...link.searchParams].length === 1 &&
          link.searchParams.get("p") === String(target.chapterId)
        ))
    )
      return null;
    const pending = [{ value: chapter, depth: 0 }];
    let nodes = 0,
      scheduled = 1;
    while (pending.length) {
      const entry = pending.pop();
      if (++nodes > 100000 || entry.depth > 64) return null;
      if (
        typeof entry.value === "string" &&
        (/\bBearer\s+[A-Za-z0-9_~.+\/-]{12,}/i.test(entry.value) ||
          /[?&](?:access_token|refresh_token|id_token|hmac|x-amz-signature|x-goog-signature|signature)=[^\s"'<>]+/i.test(
            entry.value,
          ))
      )
        return null;
      if (entry.value && typeof entry.value === "object")
        for (const [key, value] of Object.entries(entry.value)) {
          if (++scheduled > 100000) return null;
          if (
            /^(?:__proto__|prototype|constructor|authorization|proxy-authorization|cookie|set-cookie|password|passwd|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|session[_-]?token|_?wpnonce)$/i.test(
              key,
            )
          )
            return null;
          pending.push({ value, depth: entry.depth + 1 });
        }
    }
    for (const name of ["title", "content", "excerpt"])
      if (chapter[name] !== undefined) {
        if (
          !object(chapter[name]) ||
          ["raw", "rendered"].some(
            (key) =>
              chapter[name][key] !== undefined &&
              typeof chapter[name][key] !== "string",
          ) ||
          (chapter[name].protected !== undefined &&
            chapter[name].protected !== false)
        )
          return null;
      }
    return chapter;
  } catch {
    return null;
  }
}

export function directPublisherChapterV1(rawJson, targetUrl) {
  return directPublisherResourceV1(rawJson, targetUrl, "chapter");
}

export function directPublisherSourceForTypeV1(value, targetUrl, resourceType) {
  const target = directPublisherResourceTargetV1(targetUrl, resourceType),
    object = value && typeof value === "object" && !Array.isArray(value);
  if (
    !target ||
    !object ||
    Object.keys(value).some(
      (key) =>
        ![
          "kind",
          "schemaVersion",
          "statusCoverage",
          "requestedUrl",
          "endpointUrl",
          "observedAt",
          "status",
          "mime",
          "contentType",
          "encoding",
          "bytes",
          "sha256",
          "rawJson",
        ].includes(key),
    ) ||
    value.kind !==
      (resourceType === "part"
        ? "CTI_BROWSER_PUBLISHER_PART"
        : "CTI_BROWSER_PUBLISHER_CHAPTER") ||
    value.schemaVersion !== 1 ||
    value.statusCoverage !== "PARTIAL_PUBLISHER_API_ONLY" ||
    value.requestedUrl !== targetUrl ||
    value.endpointUrl !== target.endpointUrl ||
    value.status !== 200 ||
    value.mime !== "application/json" ||
    directPublisherContentTypeV1(value.contentType) !== value.mime ||
    value.encoding !== "UTF8" ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    new Date(value.observedAt).toISOString() !== value.observedAt ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > CTI_DIRECT_PUBLISHER_BODY_BYTES_V1 ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    return false;
  const bytes = directPublisherJsonBytesV1(value.rawJson);
  return (
    !!bytes &&
    bytes.length === value.bytes &&
    !!directPublisherResourceV1(value.rawJson, targetUrl, resourceType)
  );
}

export function directPublisherSourceValidV1(value, targetUrl) {
  return directPublisherSourceForTypeV1(value, targetUrl, "chapter");
}

export function directPublisherResourceSourceValidV1(value, targetUrl) {
  return directPublisherSourceForTypeV1(
    value,
    targetUrl,
    value?.kind === "CTI_BROWSER_PUBLISHER_PART" ? "part" : "chapter",
  );
}

/** Resolution history has no response body: the original exposed 404 is
 * preserved as browser context, not as a successful chapter observation. */
export function directPublisherPartResolutionValidV1(
  value,
  targetUrl,
  observedAt,
) {
  const target = directPublisherTargetV1(targetUrl),
    r = value?.chapterReceipt;
  if (
    !target ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["method", "chapterReceipt"].includes(key),
    ) ||
    value.method !== "CHAPTER_404_TO_PART" ||
    !r ||
    typeof r !== "object" ||
    Array.isArray(r) ||
    Object.keys(r).some(
      (key) =>
        ![
          "transport",
          "resource",
          "id",
          "requestedUrl",
          "endpointUrl",
          "origin",
          "requestPath",
          "requestQuery",
          "method",
          "bodyFormat",
          "responseType",
          "credentials",
          "observedAtBasis",
          "observedAt",
          "receivedAt",
          "status",
          "bytes",
          "originalResponseSha256",
          "attempts",
        ].includes(key),
    )
  )
    return false;
  const endpoint = new URL(target.endpointUrl),
    a = r.attempts?.[0];
  return (
    r.transport === "BROWSER_PUBLISHER_API" &&
    r.resource === "PublisherChapter" &&
    r.id === targetUrl &&
    r.requestedUrl === targetUrl &&
    r.endpointUrl === target.endpointUrl &&
    r.origin === endpoint.origin &&
    r.requestPath === endpoint.pathname &&
    Array.isArray(r.requestQuery) &&
    !r.requestQuery.length &&
    r.method === "GET" &&
    r.bodyFormat === "ORIGINAL_PUBLISHER_JSON" &&
    r.responseType === "cors" &&
    r.credentials === "omit" &&
    r.observedAtBasis === "BROWSER_RESPONSE" &&
    typeof r.observedAt === "string" &&
    Number.isFinite(Date.parse(r.observedAt)) &&
    new Date(r.observedAt).toISOString() === r.observedAt &&
    Date.parse(r.observedAt) <= Date.parse(observedAt) &&
    r.receivedAt === "" &&
    r.status === 404 &&
    r.bytes === 0 &&
    r.originalResponseSha256 === "" &&
    Array.isArray(r.attempts) &&
    r.attempts.length === 1 &&
    !!a &&
    typeof a === "object" &&
    !Array.isArray(a) &&
    Object.keys(a).every((key) =>
      [
        "credentials",
        "observedAt",
        "status",
        "responseType",
        "bytes",
        "reason",
      ].includes(key),
    ) &&
    a.credentials === "omit" &&
    a.observedAt === r.observedAt &&
    a.status === 404 &&
    a.responseType === "cors" &&
    a.bytes === 0 &&
    a.reason === "PUBLISHER_BROWSER_HTTP_404"
  );
}

/** Browser CORS success is observed in the browser, not attested by a CTI
 * server. Native widget ownership is validated separately by its caller. */
export function directPublisherObservationForTypeV1(
  value,
  targetUrl,
  resourceType,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["model", "receipt"].includes(key)) ||
    !directPublisherSourceForTypeV1(value.model, targetUrl, resourceType)
  )
    return false;
  const t = value.receipt,
    m = value.model,
    target = directPublisherResourceTargetV1(targetUrl, resourceType),
    endpoint = new URL(target.endpointUrl);
  if (
    !t ||
    typeof t !== "object" ||
    Array.isArray(t) ||
    Object.keys(t).some(
      (key) =>
        ![
          "transport",
          "resource",
          "id",
          "requestedUrl",
          "endpointUrl",
          "origin",
          "requestPath",
          "requestQuery",
          "method",
          "bodyFormat",
          "responseType",
          "credentials",
          "observedAtBasis",
          "observedAt",
          "receivedAt",
          "status",
          "bytes",
          "originalResponseSha256",
          "attempts",
          ...(resourceType === "part" ? ["resolution"] : []),
        ].includes(key),
    ) ||
    t.transport !== "BROWSER_PUBLISHER_API" ||
    t.resource !==
      (resourceType === "part" ? "PublisherPart" : "PublisherChapter") ||
    t.id !== targetUrl ||
    t.requestedUrl !== targetUrl ||
    t.endpointUrl !== target.endpointUrl ||
    t.origin !== endpoint.origin ||
    t.requestPath !== endpoint.pathname ||
    !Array.isArray(t.requestQuery) ||
    t.requestQuery.length !== 0 ||
    t.method !== "GET" ||
    t.bodyFormat !== "ORIGINAL_PUBLISHER_JSON" ||
    t.responseType !== "cors" ||
    !["omit", "include"].includes(t.credentials) ||
    t.observedAtBasis !== "BROWSER_RESPONSE" ||
    t.observedAt !== m.observedAt ||
    t.status !== 200 ||
    t.bytes !== m.bytes ||
    t.originalResponseSha256 !== m.sha256 ||
    typeof t.receivedAt !== "string" ||
    !Number.isFinite(Date.parse(t.receivedAt)) ||
    new Date(t.receivedAt).toISOString() !== t.receivedAt ||
    Date.parse(t.receivedAt) < Date.parse(m.observedAt) ||
    !Array.isArray(t.attempts) ||
    ![1, 2].includes(t.attempts.length)
  )
    return false;
  if (
    resourceType === "part" &&
    (t.attempts.length !== 1 ||
      t.credentials !== "omit" ||
      !directPublisherPartResolutionValidV1(
        t.resolution,
        targetUrl,
        m.observedAt,
      ))
  )
    return false;
  let previous = 0;
  for (let i = 0; i < t.attempts.length; i++) {
    const a = t.attempts[i],
      final = i === t.attempts.length - 1;
    if (
      !a ||
      typeof a !== "object" ||
      Array.isArray(a) ||
      Object.keys(a).some(
        (key) =>
          ![
            "credentials",
            "observedAt",
            "status",
            "responseType",
            "bytes",
            "reason",
          ].includes(key),
      ) ||
      a.credentials !== (i ? "include" : "omit") ||
      typeof a.observedAt !== "string" ||
      !Number.isFinite(Date.parse(a.observedAt)) ||
      new Date(a.observedAt).toISOString() !== a.observedAt
    )
      return false;
    if (
      Date.parse(a.observedAt) < previous ||
      Date.parse(a.observedAt) > Date.parse(t.receivedAt)
    )
      return false;
    previous = Date.parse(a.observedAt);
    if (final) {
      if (
        a.credentials !== t.credentials ||
        a.status !== 200 ||
        a.responseType !== "cors" ||
        a.bytes !== m.bytes ||
        a.reason !== "" ||
        a.observedAt !== m.observedAt
      )
        return false;
    } else if (
      a.bytes !== 0 ||
      !(
        (a.status === 0 &&
          a.responseType === "unreadable" &&
          a.reason === "PUBLISHER_BROWSER_BLOCKED_OR_FAILED") ||
        (a.status === 403 &&
          a.responseType === "cors" &&
          a.reason === "PUBLISHER_BROWSER_HTTP_403")
      )
    )
      return false;
  }
  return true;
}

export function directPublisherObservationValidV1(value, targetUrl) {
  return directPublisherObservationForTypeV1(value, targetUrl, "chapter");
}

export function directPublisherResourceObservationValidV1(value, targetUrl) {
  return directPublisherObservationForTypeV1(
    value,
    targetUrl,
    value?.model?.kind === "CTI_BROWSER_PUBLISHER_PART" ? "part" : "chapter",
  );
}

export function directPublisherEvidenceV1(observation, targetUrl, hashBytes) {
  if (
    typeof hashBytes !== "function" ||
    !directPublisherObservationValidV1(observation, targetUrl)
  )
    return null;
  try {
    const bytes = directPublisherJsonBytesV1(observation.model.rawJson);
    return bytes && hashBytes(bytes) === observation.model.sha256
      ? observation
      : null;
  } catch {
    return null;
  }
}

export function directPublisherResourceEvidenceV1(
  observation,
  targetUrl,
  hashBytes,
) {
  if (
    typeof hashBytes !== "function" ||
    !directPublisherResourceObservationValidV1(observation, targetUrl)
  )
    return null;
  try {
    const bytes = directPublisherJsonBytesV1(observation.model.rawJson);
    return bytes && hashBytes(bytes) === observation.model.sha256
      ? observation
      : null;
  } catch {
    return null;
  }
}
