import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Fixed public resources only. No endpoint accepts a caller-selected URL.
export const TARGETS = Object.freeze([
  Object.freeze({
    id: "area-literal-jpeg",
    url: "https://opentextbc.ca/oerdiscipline/wp-content/uploads/sites/347/2020/06/can-of-paint-e1620155597347.jpg",
    referrer: "https://opentextbc.ca/mathfortrades2/chapter/area/",
    maximum: 16 * 1024 * 1024,
    accept: "image/png, image/jpeg, image/gif, image/webp",
    kind: "image",
  }),
  Object.freeze({
    id: "whole-numbers-literal-png",
    url: "https://opentextbc.ca/mathfortrades1/wp-content/uploads/sites/305/2020/04/dice-161377_1280.png",
    referrer: "https://opentextbc.ca/mathfortrades1/part/whole-numbers/",
    maximum: 16 * 1024 * 1024,
    accept: "image/png, image/jpeg, image/gif, image/webp",
    kind: "image",
  }),
  Object.freeze({
    id: "observed-book-epub-download",
    url: "https://opentextbc.ca/mathfortrades2/open/download?type=epub",
    referrer: "",
    maximum: 64 * 1024 * 1024,
    accept: "application/epub+zip, application/zip, application/octet-stream",
    kind: "epub",
  }),
]);
const PUBLIC_ORIGIN = "https://opentextbc.ca";
const stop = (response) => {
  try { void response.body?.cancel().catch(() => {}); } catch {}
};
const safeMime = (value) => {
  const mime = String(value || "").split(";")[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]{1,80}\/[a-z0-9!#$&^_.+-]{1,80}$/.test(mime) ? mime : "";
};
const identity = (response) => {
  const value = response.headers.get("content-encoding");
  return value === null || value.trim().toLowerCase() === "identity";
};
const allowedRedirect = (location, base, target) => {
  if (target.kind !== "epub" || typeof location !== "string" || location.length > 4000 || /[\u0000-\u0020\u007f\\]/.test(location)) return null;
  try {
    const u = new URL(location, base);
    if (u.origin !== PUBLIC_ORIGIN || u.username || u.password || u.port || u.hash ||
        !u.pathname.startsWith("/mathfortrades2/") || /(?:^|\/)(?:wp-admin|wp-login|wp-json)(?:\/|\.|$)/i.test(u.pathname)) return null;
    // Follow only a publisher-issued, public book-file redirect. Do not turn a
    // login, generic page, or signed URL into a new probe target.
    if (u.search || !/\.epub$/i.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
};

async function readOne(target, variant, state, fetcher, requestMs) {
  const result = { target: target.id, variant, status: 0, mime: "", bytes: 0, sha256: "", challenge: false, redirects: 0, outcome: "NOT_STARTED" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestMs);
  let reader, response;
  const cancelled = () => { try { void reader?.cancel().catch(() => {}); } catch {} };
  controller.signal.addEventListener("abort", cancelled);
  try {
    let url = target.url;
    while (true) {
      if (++state.requests > 6) { result.outcome = "REQUEST_BOUND"; return result; }
      response = await fetcher(url, {
        method: "GET", credentials: "omit", redirect: "manual", signal: controller.signal,
        referrerPolicy: variant === "observed-public-referrer" ? "strict-origin-when-cross-origin" : "no-referrer",
        headers: {
          Accept: target.accept,
          "Accept-Encoding": "identity",
          ...(variant === "observed-public-referrer" ? { Referer: target.referrer } : {}),
        },
      });
      result.status = response.status;
      result.mime = safeMime(response.headers.get("content-type"));
      result.challenge = response.headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge";
      if (response.redirected || (response.url && response.url !== url)) {
        result.outcome = "UNEXPECTED_REDIRECT"; stop(response); return result;
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = allowedRedirect(response.headers.get("location"), url, target);
        stop(response);
        if (!next || result.redirects >= 1 || next === url) { result.outcome = "REDIRECT_NOT_FOLLOWED"; return result; }
        result.redirects++; url = next; continue;
      }
      break;
    }
    if (response.status !== 200) { result.outcome = result.challenge ? "CHALLENGE_NOT_FOLLOWED" : "HTTP_FAILURE"; stop(response); return result; }
    if (response.headers.has("content-range")) { result.outcome = "PARTIAL_BODY_NOT_READ"; stop(response); return result; }
    const allowedMime = target.kind === "image"
      ? ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]
      : ["application/epub+zip", "application/zip", "application/octet-stream"];
    if (!allowedMime.includes(result.mime)) { result.outcome = "MIME_NOT_READ"; stop(response); return result; }
    if (!identity(response)) { result.outcome = "NON_IDENTITY_NOT_READ"; stop(response); return result; }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^[1-9]\d*$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > target.maximum)) {
      result.outcome = "DECLARED_LENGTH_NOT_READ"; stop(response); return result;
    }
    reader = response.body?.getReader();
    if (!reader) { result.outcome = "NO_BODY"; return result; }
    const hasher = sha256.create();
    let empty = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || (!next.value.length && ++empty > 8)) { result.outcome = "INVALID_STREAM"; cancelled(); return result; }
      if (!next.value.length) continue;
      empty = 0; result.bytes += next.value.length;
      if (result.bytes > target.maximum || (declared !== null && result.bytes > Number(declared))) { result.outcome = "BODY_BOUND"; cancelled(); return result; }
      hasher.update(next.value);
    }
    if (!result.bytes || (declared !== null && result.bytes !== Number(declared))) { result.outcome = "LENGTH_MISMATCH"; return result; }
    result.sha256 = bytesToHex(hasher.digest()); result.outcome = "EOF_HASHED";
    return result;
  } catch {
    cancelled();
    result.outcome = controller.signal.aborted ? "TIMEOUT" : "NETWORK_OR_RUNTIME_FAILURE";
    return result;
  } finally {
    clearTimeout(timer); controller.signal.removeEventListener("abort", cancelled);
    try { reader?.releaseLock(); } catch {}
  }
}

export async function runProbe({ fetcher = fetch, requestMs = 20000 } = {}) {
  if (!Number.isSafeInteger(requestMs) || requestMs < 1 || requestMs > 20000) throw Error("INVALID_DEADLINE");
  const state = { requests: 0 };
  const groups = await Promise.all(TARGETS.map(async (target) => {
    const first = await readOne(target, "without-referrer", state, fetcher, requestMs);
    // A normal observed public-page referrer is the only optional difference.
    // Never retry a Cloudflare challenge, and never forward browser cookies.
    if (target.kind === "image" && first.status === 403 && !first.challenge)
      return [first, await readOne(target, "observed-public-referrer", state, fetcher, requestMs)];
    return [first];
  }));
  return { kind: "CTI_BOUNDED_PUBLIC_ACCESS_PROBE", schemaVersion: 1, checkedAt: new Date().toISOString(),
    requestBound: 6, requests: Math.min(state.requests, 6), results: groups.flat(),
    courseCaptured: false, retainedContent: false, productionChanged: false };
}
