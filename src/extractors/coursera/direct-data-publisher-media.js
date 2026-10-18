import { directPublisherResourceObservationValidV1, directPublisherResourceV1,
  directPublisherResourceEvidenceV1 } from "./direct-data-publisher.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";

export const CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1 = 16777216;
export const CTI_DIRECT_PUBLISHER_IMAGE_URLS_V1 = 128;

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
  const chapter = directPublisherResourceV1(observation.model.rawJson, targetUrl, observation.model.kind === "CTI_BROWSER_PUBLISHER_PART" ? "part" : "chapter");
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
  return !!r && typeof r === "object" && !Array.isArray(r) &&
    Object.keys(r).every(key => ["resource","transport","sourceSha256","requestedUrl","finalUrl","method","credentials","responseType","status","bytes","mime","sha256","observedAt","originalContentType","bodyFormat"].includes(key)) &&
    r.resource === "PublisherImage" && r.transport === "BROWSER_PUBLISHER_IMAGE" && r.sourceSha256 === sourceSha256 &&
    r.requestedUrl === url && r.finalUrl === url && r.method === "GET" && r.credentials === "omit" && r.responseType === "cors" &&
    r.status === 200 && r.bytes === body.size && r.mime === body.mime && r.sha256 === body.sha256 &&
    typeof r.originalContentType === "string" && r.originalContentType.length <= 256 && !/[\u0000-\u001f\u007f]/.test(r.originalContentType) &&
    r.originalContentType.split(";")[0].trim().toLowerCase() === body.mime &&
    typeof r.observedAt === "string" && Number.isFinite(Date.parse(r.observedAt)) && new Date(r.observedAt).toISOString() === r.observedAt &&
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
      Object.keys(resource).every(key => ["url","references","body","reason"].includes(key)) && resource.url === expected.url &&
      canonical(resource.references) === canonical(expected.references) &&
      (resource.body ? !resource.reason && directPublisherImageBodyStructureV1(resource.body, resource.url, sourceHash) :
        !historical && typeof resource.reason === "string" && /^[A-Z0-9_]{1,96}$/.test(resource.reason));
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
