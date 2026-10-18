import { directCanonicalSourceTextV1 } from './direct-data-canonical.js';

export const CTI_DIRECT_PUBLIC_PAGE_BODY_BYTES_V1 = 1048576;
export const CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1 = 2097152;
export const CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1 = 8388608;
export const CTI_DIRECT_PUBLIC_PAGE_SERVICE_ORIGIN_V1 = "https://cti-hardening.pages.dev";

/** The same closed public-book scope as the owner source-question reader.
 * Preserve the authored spelling separately from its normalized GET target. */
export function directPublicPageTargetV1(value) {
  if (typeof value !== "string" || !value || value.length > 4000 || /[\u0000-\u0020\u007f\\%]/.test(value) ||
      /(?:^|\/)\.{1,2}(?:\/|[?#]|$)/.test(value) || /(?:access_token|refresh_token|id_token|authorization|hmac|signature)\s*[:=]/i.test(value)) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port ||
        !["opentextbc.ca", "pressbooks.bccampus.ca"].includes(u.hostname) ||
        !/^\/[a-z0-9][a-z0-9-]*\//i.test(u.pathname)) return null;
    if (/^\/[a-z0-9][a-z0-9-]*\/wp-admin\/admin-ajax\.php$/i.test(u.pathname)) {
      if (u.searchParams.get("action") !== "h5p_embed" || !/^\d+$/.test(u.searchParams.get("id") || "") ||
          [...u.searchParams.keys()].some(key => !["action", "id"].includes(key)) || [...u.searchParams].length !== 2) return null;
    } else {
      if (/(?:wp-admin|wp-login|wp-json|\.php|%|\.\.)/i.test(u.pathname) ||
          new Set(u.searchParams.keys()).size !== [...u.searchParams].length) return null;
      for (const [key, entry] of u.searchParams) {
        if (!["p", "h5p-embed"].includes(key) || !/^\d+\/?$/.test(entry)) return null;
        u.searchParams.set(key, entry.replace(/\/$/, ""));
      }
    }
    u.hash = "";
    return { requestedUrl: value, normalizedUrl: u.href };
  } catch { return null; }
}

export function directPublicPageContentTypeV1(contentType) {
  if (typeof contentType !== "string" || !contentType || contentType.length > 256 || /[\u0000-\u001f\u007f]/.test(contentType)) return "";
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const charsets = [...contentType.matchAll(/(?:^|;)\s*charset\s*=\s*["']?([^\s;"']+)/gi)];
  const charset = charsets[0]?.[1];
  return charsets.length <= 1 && ["text/html", "application/xhtml+xml"].includes(mime) && (!charset || /^(utf-8|utf8|us-ascii)$/i.test(charset)) ? mime : "";
}

export function directPublicPageSameBookV1(value, initial) {
  const target = directPublicPageTargetV1(value), original = directPublicPageTargetV1(initial);
  if (!target || !original) return "";
  const a = new URL(original.normalizedUrl), b = new URL(target.normalizedUrl);
  return a.origin === b.origin && a.pathname.split("/")[1] === b.pathname.split("/")[1] ? target.normalizedUrl : "";
}

/** Originals are never redacted and then labelled original. Obvious login,
 * credential-bearing and non-text responses remain explicit acquisition gaps. */
export function directPublicPageHtmlBytesV1(html) {
  if (typeof html !== "string" || !html || html.length > CTI_DIRECT_PUBLIC_PAGE_BODY_BYTES_V1 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(html) ||
      !/<(?:!doctype\s+html|html|head|body|main|article)\b/i.test(html) ||
      /<input\b[^<>]*\btype\s*=\s*["']?password\b/i.test(html) ||
      /<form\b[^<>]*\baction\s*=\s*["'][^"'<>]*wp-login\.php/i.test(html) ||
      /["']?(?:access_token|refresh_token|id_token|authorization|authToken|sessionToken)["']?\s*[:=]\s*["'][^"']+["']/i.test(html) ||
      /\bBearer\s+[A-Za-z0-9_~.+\/-]{12,}/i.test(html) ||
      /[?&](?:access_token|refresh_token|id_token|hmac|x-amz-signature|x-goog-signature|signature)=[^\s"'<>]+/i.test(html)) return null;
  try {
    const bytes = new TextEncoder().encode(html);
    if (bytes.length > CTI_DIRECT_PUBLIC_PAGE_BODY_BYTES_V1 ||
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== html) return null;
    return bytes;
  } catch { return null; }
}

/** Structural proof only: callers independently recompute the HTML SHA-256.
 * Provider clocks/transport declarations are context, not signed attestations. */
export function directPublicPageSourceValidV1(value, targetUrl) {
  const object = entry => entry && typeof entry === "object" && !Array.isArray(entry);
  const target = directPublicPageTargetV1(targetUrl);
  if (!target || !object(value) || value.kind !== "CTI_PUBLIC_STATIC_HTML" || value.schemaVersion !== 1 ||
      Object.keys(value).some(key => !["kind", "schemaVersion", "statusCoverage", "requestedUrl", "normalizedUrl", "finalUrl", "redirects", "observedAt", "status", "mime", "contentType", "encoding", "bytes", "sha256", "html"].includes(key)) ||
      value.statusCoverage !== "PARTIAL_PUBLIC_HTML_ONLY" ||
      value.requestedUrl !== targetUrl || value.normalizedUrl !== target.normalizedUrl ||
      value.status !== 200 || value.encoding !== "UTF8" ||
      !["text/html", "application/xhtml+xml"].includes(value.mime) ||
      directPublicPageContentTypeV1(value.contentType) !== value.mime ||
      typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt)) || new Date(value.observedAt).toISOString() !== value.observedAt ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > CTI_DIRECT_PUBLIC_PAGE_BODY_BYTES_V1 ||
      !/^[a-f0-9]{64}$/.test(value.sha256 || "") || !Array.isArray(value.redirects) || value.redirects.length > 3) return false;
  let previous = target.normalizedUrl;
  const visited = new Set([previous]);
  for (const redirect of value.redirects) {
    if (!object(redirect) || Object.keys(redirect).some(key => !["from", "to", "status"].includes(key)) || redirect.from !== previous || ![301, 302, 303, 307, 308].includes(redirect.status) ||
        directPublicPageSameBookV1(redirect.to, target.normalizedUrl) !== redirect.to || visited.has(redirect.to)) return false;
    previous = redirect.to; visited.add(previous);
  }
  if (value.finalUrl !== previous || !directPublicPageSameBookV1(value.finalUrl, target.normalizedUrl)) return false;
  const bytes = directPublicPageHtmlBytesV1(value.html);
  return !!bytes && bytes.length === value.bytes;
}

export function directPublicPageObservationValidV1(value, targetUrl) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !directPublicPageSourceValidV1(value.model, targetUrl)) return false;
  const t = value.receipt, page = value.model, target = directPublicPageTargetV1(targetUrl);
  const normalized = new URL(target.normalizedUrl);
  return !!t && typeof t === "object" && !Array.isArray(t) && t.transport === "CTI_PUBLIC_BACKEND" &&
    t.serviceOrigin === CTI_DIRECT_PUBLIC_PAGE_SERVICE_ORIGIN_V1 && t.serviceStatus === 200 &&
    t.resource === "PublicStaticHtml" && t.id === targetUrl && t.requestedUrl === targetUrl && t.normalizedUrl === target.normalizedUrl &&
    t.origin === normalized.origin && t.requestPath === normalized.pathname && Array.isArray(t.requestQuery) &&
    JSON.stringify(t.requestQuery) === JSON.stringify([...normalized.searchParams]) &&
    t.bodyFormat === "PARSED_PUBLIC_HTML_ENVELOPE" && t.method === "GET" &&
    t.status === 200 && t.observedAtBasis === "UPSTREAM" && t.observedAt === page.observedAt &&
    t.upstreamRequests === page.redirects.length + 1 && t.upstreamBytes === page.bytes &&
    Number.isSafeInteger(t.bytes) && t.bytes > 0 && t.bytes <= CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1 &&
    t.declaredEnvelopeBytes === t.bytes &&
    /^[a-f0-9]{64}$/.test(t.originalResponseSha256 || "") &&
    typeof t.receivedAt === "string" && Number.isFinite(Date.parse(t.receivedAt)) && new Date(t.receivedAt).toISOString() === t.receivedAt;
}

/** This new CTI-controlled envelope has one deterministic JSON encoding. Raw
 * public HTML remains unchanged inside it; the two byte identities stay apart. */
export function directPublicPageEnvelopeBytesV1(model) {
  try {
    const encoded = directCanonicalSourceTextV1(model);
    if (encoded.length > CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1) return null;
    const bytes = new TextEncoder().encode(encoded);
    return bytes.length <= CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1 ? bytes : null;
  } catch { return null; }
}

/** A mandatory independent byte-hash callback prevents a retained declaration
 * from certifying HTML that is absent, changed, truncated or fabricated later. */
export function directPublicHtmlEvidenceV1(observation, targetUrl, hashBytes) {
  if (!directPublicPageObservationValidV1(observation, targetUrl) || typeof hashBytes !== "function") return null;
  try {
    const bytes = directPublicPageHtmlBytesV1(observation.model.html);
    const envelope = directPublicPageEnvelopeBytesV1(observation.model);
    return bytes && envelope && hashBytes(bytes) === observation.model.sha256 && envelope.length === observation.receipt.bytes &&
      hashBytes(envelope) === observation.receipt.originalResponseSha256 ? observation : null;
  } catch { return null; }
}
