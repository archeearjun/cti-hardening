import { directPublisherResourceObservationValidV1, directPublisherResourceV1,
  directPublisherResourceEvidenceV1 } from "./direct-data-publisher.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";

export const CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1 = 16777216;
export const CTI_DIRECT_PUBLISHER_IMAGE_URLS_V1 = 128;

export function directPublisherImageDateV1(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Failure context is never source/body verification or an HTTP attestation. */
export function directPublisherImageAttemptsV1(attempts, imageUrl) {
  if (!Array.isArray(attempts) || attempts.length !== 2) return null;
  const [browser,service] = attempts;
  if (!browser || Object.keys(browser).some(key => !["transport","observedAt","status","responseType","reason"].includes(key)) ||
      browser.transport !== "BROWSER_PUBLISHER_IMAGE" || !directPublisherImageDateV1(browser.observedAt) || browser.status !== 0 ||
      browser.responseType !== "unreadable" || !["PUBLISHER_IMAGE_BLOCKED_OR_FAILED","PUBLISHER_IMAGE_RESPONSE_UNREADABLE"].includes(browser.reason) ||
      !service || Object.keys(service).some(key => !["transport","observedAt","serviceOrigin","serviceStatus","upstreamStatus","upstreamObservedAt","upstreamRequests","upstreamBytes","reason","upstreamChallenge","notAttempted","blockedBy"].includes(key)) ||
      service.transport !== "CTI_SERVICE_PUBLIC_IMAGE" || service.serviceOrigin !== "https://cti-hardening.pages.dev" ||
      !directPublisherImageDateV1(service.observedAt) || Date.parse(service.observedAt) < Date.parse(browser.observedAt) ||
      !Number.isSafeInteger(service.serviceStatus) || !(service.serviceStatus === 0 || service.serviceStatus >= 200 && service.serviceStatus <= 599) ||
      !Number.isSafeInteger(service.upstreamStatus) || !(service.upstreamStatus === 0 || service.upstreamStatus >= 100 && service.upstreamStatus <= 599) ||
      ![0,1].includes(service.upstreamRequests) || !Number.isSafeInteger(service.upstreamBytes) || service.upstreamBytes < 0 || service.upstreamBytes > 33554432 ||
      (service.upstreamStatus ? service.upstreamRequests !== 1 || !directPublisherImageDateV1(service.upstreamObservedAt) : service.upstreamObservedAt !== "") ||
      typeof service.reason !== "string" || !/^[A-Z0-9_]{1,96}$/.test(service.reason)) return null;
  if (service.upstreamChallenge !== undefined || service.reason === "PUBLISHER_IMAGE_UPSTREAM_CHALLENGE") {
    if (service.upstreamChallenge !== "cloudflare" || service.serviceStatus !== 502 || service.upstreamStatus !== 403 ||
        service.upstreamRequests !== 1 || service.upstreamBytes !== 0 || service.reason !== "PUBLISHER_IMAGE_UPSTREAM_CHALLENGE" ||
        service.notAttempted !== undefined || service.blockedBy !== undefined) return null;
  } else if (service.notAttempted !== undefined || service.blockedBy !== undefined ||
      service.reason === "PUBLISHER_IMAGE_SERVICE_ORIGIN_CHALLENGE_NOT_ATTEMPTED") {
    const by = service.blockedBy;
    if (service.notAttempted !== "ORIGIN_CHALLENGE" || service.reason !== "PUBLISHER_IMAGE_SERVICE_ORIGIN_CHALLENGE_NOT_ATTEMPTED" ||
        service.serviceStatus !== 0 || service.upstreamStatus !== 0 || service.upstreamRequests !== 0 || service.upstreamBytes !== 0 ||
        !by || Object.keys(by).some(key => !["url","observedAt"].includes(key)) ||
        !directPublisherImageDateV1(by.observedAt) || Date.parse(by.observedAt) > Date.parse(service.observedAt) ||
        !imageUrl || !by.url || directPublisherImageUrlV1(imageUrl,imageUrl) !== imageUrl || directPublisherImageUrlV1(by.url,imageUrl) !== by.url ||
        new URL(by.url).origin !== new URL(imageUrl).origin) return null;
  }
  return attempts;
}

/** These headers declare what CTI's public reader observed. They do not prove
 * a Coursera login or that the service validated the parent publisher JSON. */
export function directPublisherImageServiceHeadersV1(response, sourceSha256) {
  const h = response?.headers, integer = name => {
    const value = h?.get(name); return /^(?:0|[1-9]\d*)$/.test(value || "") ? Number(value) : NaN;
  };
  if (response?.status !== 200 || h?.has("x-cti-upstream-challenge") || h?.get("x-cti-provider-transport") !== "CTI_SERVICE_PUBLIC_IMAGE" ||
      h.get("x-cti-provider-origin") !== "https://cti-hardening.pages.dev" ||
      h.get("x-cti-publisher-source-hash") !== sourceSha256 ||
      integer("x-cti-upstream-status") !== 200 || integer("x-cti-upstream-requests") !== 1 ||
      !directPublisherImageDateV1(h.get("x-cti-upstream-observed-at"))) return null;
  const size = integer("x-cti-upstream-content-length"), sha256 = h.get("x-cti-upstream-sha256");
  if (!Number.isSafeInteger(size) || size < 1 || size > CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1 ||
      integer("x-cti-upstream-bytes") !== size || !/^[a-f0-9]{64}$/.test(sha256 || "")) return null;
  return {serviceOrigin:"https://cti-hardening.pages.dev",serviceStatus:200,upstreamStatus:200,
    upstreamObservedAt:h.get("x-cti-upstream-observed-at"),upstreamRequests:1,upstreamBytes:size,
    declaredBodyBytes:size,upstreamSha256:sha256,publisherSourceHash:sourceSha256};
}

/** Only a literal public upload reference is eligible; no rendition guessing. */
export function directPublisherImageUrlV1(value, base) {
  if (typeof value !== "string" || !value || value.length > 4000 ||
      /[\u0000-\u0020\u007f\\%]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|[?#]|$)/.test(value)) return "";
  try {
    const u = new URL(value, base);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.search && !u.hash &&
      ["opentextbc.ca", "pressbooks.bccampus.ca"].includes(u.hostname) &&
      /^\/[a-z0-9][a-z0-9-]*\/wp-content\/uploads\/(?:[a-z0-9_().-]+\/)*[a-z0-9_().-]+\.(?:png|jpe?g|gif|webp)$/i.test(u.pathname)
      ? u.href : "";
  } catch (_) { return ""; }
}

export function directPublisherImageKindV1(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return "";
  if (mime === "image/png" && bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "PNG";
  if (["image/jpeg", "image/jpg"].includes(mime) && bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "JPEG";
  if (mime === "image/gif" && bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0,6)))) return "GIF";
  if (mime === "image/webp" && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "WEBP";
  return "";
}

export function directPublisherMediaAttributeV1(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[a-f0-9]{1,6});/gi, entity => {
    const named = {"&amp;":"&", "&quot;":'"', "&apos;":"'", "&lt;":"<", "&gt;":">"};
    if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
    const n = entity[2].toLowerCase() === "x" ? parseInt(entity.slice(3,-1),16) : Number(entity.slice(2,-1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity;
  });
}

/** A bounded tokenizer reads attributes only, never executes or renders HTML. */
export function directPublisherMediaInventoryV1(observation, targetUrl) {
  if (!directPublisherResourceObservationValidV1(observation, targetUrl)) return null;
  const chapter = directPublisherResourceV1(observation.model.rawJson, targetUrl, observation.model.kind === "CTI_BROWSER_PUBLISHER_BACK_MATTER" ? "back-matter" : observation.model.kind === "CTI_BROWSER_PUBLISHER_PART" ? "part" : "chapter");
  if (!chapter) return null;
  const resources = [], failures = [], byUrl = new Map();
  let references = 0;
  for (const field of ["raw", "rendered"]) {
    const html = chapter.content?.[field];
    if (typeof html !== "string") continue;
    const lower = html.toLowerCase();
    let offset = 0, ordinal = 0, tags = 0;
    while (offset < html.length) {
      const start = html.indexOf("<", offset);
      if (start < 0) break;
      if (html.startsWith("<!--", start)) {
        const end = html.indexOf("-->", start + 4);
        offset = end < 0 ? html.length : end + 3; continue;
      }
      let end = start + 1, quote = "";
      for (; end < html.length; end++) {
        const c = html[end];
        if (quote) { if (c === quote) quote = ""; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === ">" || c === "<") break;
      }
      offset = Math.max(start + 1, end + (html[end] === ">" ? 1 : 0));
      if (html[end] !== ">") continue;
      const text = html.slice(start + 1, end), name = text.match(/^([a-z][a-z0-9:-]*)(?=[\s/>]|$)/i);
      if (!name) continue;
      if (++tags > 20000) return null;
      const tag = name[1].toLowerCase();
      if (["script","style","textarea","title","xmp","noembed","noframes","iframe","plaintext"].includes(tag)) {
        if (tag === "plaintext") { offset = html.length; continue; }
        let close = lower.indexOf("</" + tag, offset);
        while (close >= 0 && !/[\s/>]/.test(lower[close + tag.length + 2] || ""))
          close = lower.indexOf("</" + tag,close + tag.length + 2);
        offset = close < 0 ? html.length : close; continue;
      }
      if (tag !== "img" && tag !== "a") continue;
      const attrs = new Map(), attr = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      attr.lastIndex = name[0].length;
      let match, duplicate = false;
      while ((match = attr.exec(text))) {
        const key = match[1].toLowerCase();
        if (attrs.has(key)) duplicate = true;
        attrs.set(key, match[2] ?? match[3] ?? match[4] ?? "");
      }
      const attribute = tag === "img" ? "src" : "href", literal = attrs.get(attribute), index = ordinal++;
      if (tag === "a" && (typeof literal !== "string" || !/\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i.test(directPublisherMediaAttributeV1(literal)))) continue;
      if (++references > 1024) return null;
      const reference = {field: "content." + field, tag, attribute, ordinal:index, attributeValue:literal ?? ""};
      const url = !duplicate && literal !== undefined ? directPublisherImageUrlV1(directPublisherMediaAttributeV1(literal), chapter.link) : "";
      if (!url) failures.push({...reference, reason:duplicate ? "PUBLISHER_IMAGE_DUPLICATE_ATTRIBUTE" : literal === undefined ? "PUBLISHER_IMAGE_SOURCE_ABSENT" : "PUBLISHER_IMAGE_URL_UNSUPPORTED"});
      else {
        if (!byUrl.has(url)) {
          if (resources.length >= CTI_DIRECT_PUBLISHER_IMAGE_URLS_V1) return null;
          const resource = {url, references:[]}; resources.push(resource); byUrl.set(url, resource);
        }
        byUrl.get(url).references.push(reference);
      }
      if (tag === "img" && attrs.has("srcset")) failures.push({...reference, reason:"PUBLISHER_IMAGE_SRCSET_ALTERNATIVES_NOT_SELECTED"});
      if (failures.length > 1024) return null;
    }
  }
  return {schemaVersion:1, sourceSha256:observation.model.sha256, resources, failures};
}

export function directPublisherImageBodyStructureV1(body, url, sourceSha256) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !["archivePath","sha256","size","mime","canonicalUrl","receipt"].includes(key)) ||
      !/^[a-f0-9]{64}$/.test(body.sha256 || "") || body.archivePath !== "files/" + body.sha256 ||
      body.canonicalUrl !== url || !Number.isSafeInteger(body.size) || body.size < 1 || body.size > CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1 ||
      !["image/png","image/jpeg","image/jpg","image/gif","image/webp"].includes(body.mime)) return false;
  const r = body.receipt;
  const service = r?.transport === "CTI_SERVICE_PUBLIC_IMAGE";
  return !!r && typeof r === "object" && !Array.isArray(r) &&
    Object.keys(r).every(key => ["resource","transport","sourceSha256","requestedUrl","finalUrl","method","credentials","responseType","status","bytes","mime","sha256","observedAt","originalContentType","bodyFormat",
      ...(service ? ["observedAtBasis","serviceOrigin","serviceStatus","upstreamStatus","upstreamObservedAt","upstreamRequests","upstreamBytes","declaredBodyBytes","upstreamSha256","publisherSourceHash","browserAttempt"] : [])].includes(key)) &&
    r.resource === "PublisherImage" && (service || r.transport === "BROWSER_PUBLISHER_IMAGE") && r.sourceSha256 === sourceSha256 &&
    r.requestedUrl === url && r.finalUrl === url && r.method === "GET" && r.credentials === "omit" && r.responseType === (service ? "service" : "cors") &&
    r.status === 200 && r.bytes === body.size && r.mime === body.mime && r.sha256 === body.sha256 &&
    typeof r.originalContentType === "string" && r.originalContentType.length <= 256 && !/[\u0000-\u001f\u007f]/.test(r.originalContentType) &&
    r.originalContentType.split(";")[0].trim().toLowerCase() === body.mime &&
    directPublisherImageDateV1(r.observedAt) &&
    (!service || r.observedAtBasis === "BROWSER_RESPONSE" && r.serviceOrigin === "https://cti-hardening.pages.dev" && r.serviceStatus === 200 &&
      r.upstreamStatus === 200 && directPublisherImageDateV1(r.upstreamObservedAt) && r.upstreamRequests === 1 &&
      r.upstreamBytes === body.size && r.declaredBodyBytes === body.size && r.upstreamSha256 === body.sha256 && r.publisherSourceHash === sourceSha256 &&
      !!directPublisherImageAttemptsV1([r.browserAttempt,{transport:"CTI_SERVICE_PUBLIC_IMAGE",observedAt:r.observedAt,
        serviceOrigin:r.serviceOrigin,serviceStatus:200,upstreamStatus:200,upstreamObservedAt:r.upstreamObservedAt,
        upstreamRequests:1,upstreamBytes:body.size,reason:"PUBLISHER_IMAGE_SERVICE_CAPTURED"}])) &&
    r.bodyFormat === "ORIGINAL_BINARY_BYTES_ARCHIVE";
}

/** Descriptor validation does not assert that original bytes are embedded. */
export function directPublisherMediaStructureV1(observation, targetUrl, media) {
  try {
    const current = directPublisherMediaInventoryV1(observation, targetUrl), canonical = directCanonicalSourceTextV1;
    if (!current || !media || media.schemaVersion !== 1 || media.sourceSha256 !== current.sourceSha256 ||
        Object.keys(media).some(key => !["schemaVersion","sourceSha256","resources","failures","retained"].includes(key)) ||
        canonical(media.failures) !== canonical(current.failures) || !Array.isArray(media.resources) || media.resources.length !== current.resources.length) return null;
    const check = (resource, expected, sourceHash, historical) => resource &&
      Object.keys(resource).every(key => ["url","references","body","reason","attempts"].includes(key)) && resource.url === expected.url &&
      canonical(resource.references) === canonical(expected.references) &&
      (resource.body ? !resource.reason && resource.attempts === undefined && directPublisherImageBodyStructureV1(resource.body, resource.url, sourceHash) :
        !historical && typeof resource.reason === "string" && /^[A-Z0-9_]{1,96}$/.test(resource.reason) &&
        (resource.attempts === undefined || directPublisherImageAttemptsV1(resource.attempts,resource.url) && resource.attempts[1].reason === resource.reason));
    if (!media.resources.every((resource,i) => check(resource,current.resources[i],current.sourceSha256,false))) return null;
    if (media.retained !== undefined && (!Array.isArray(media.retained) || media.retained.length > 128)) return null;
    let count = 0, sourceBytes = observation.model.bytes;
    const sources = new Set(), seen = new Set();
    for (const group of media.retained || []) {
      if (!group || Object.keys(group).some(key => !["observation","resources"].includes(key)) || !Array.isArray(group.resources) || !group.resources.length) return null;
      sourceBytes += group.observation?.model?.bytes || 8388609;
      if (!Number.isSafeInteger(sourceBytes) || sourceBytes > 8388608) return null;
      const inventory = directPublisherMediaInventoryV1(group.observation,targetUrl);
      if (!inventory || sources.has(inventory.sourceSha256)) return null;
      sources.add(inventory.sourceSha256);
      for (const resource of group.resources) {
        const expected = inventory.resources.find(value => value.url === resource?.url), key = inventory.sourceSha256 + ":" + resource?.url + ":" + resource?.body?.sha256;
        if (++count > 128 || !expected || seen.has(key) || !check(resource,expected,inventory.sourceSha256,true)) return null;
        seen.add(key);
      }
    }
    return sourceBytes <= 8388608 ? media : null;
  } catch (_) { return null; }
}

export function directPublisherMediaEvidenceV1(observation, targetUrl, media, hashBytes) {
  if (!directPublisherMediaStructureV1(observation,targetUrl,media) || !directPublisherResourceEvidenceV1(observation,targetUrl,hashBytes)) return null;
  try {
    for (const group of [{observation,resources:media.resources},...(media.retained || [])]) {
      if (!directPublisherResourceEvidenceV1(group.observation,targetUrl,hashBytes)) return null;
      for (const resource of group.resources) if (resource.body) {
        const d = Object.getOwnPropertyDescriptor(resource.body,"bytes"), bytes = d?.value;
        if (!d || d.enumerable || !(bytes instanceof Uint8Array) || bytes.length !== resource.body.size ||
            !directPublisherImageKindV1(bytes,resource.body.mime) || hashBytes(bytes) !== resource.body.sha256) return null;
      }
    }
    return media;
  } catch (_) { return null; }
}
