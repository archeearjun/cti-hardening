import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BOOKS = Object.freeze([
  Object.freeze({ id: "mathfortrades1", index: "https://opentextbc.ca/mathfortrades1/wp-json/", ids: Object.freeze([227, 228, 230]) }),
  Object.freeze({ id: "mathfortrades2", index: "https://opentextbc.ca/mathfortrades2/wp-json/", ids: Object.freeze([232, 233]) }),
]);
const MAXIMUM = 4 * 1024 * 1024;
const safeString = (value, maximum = 2000) => typeof value === "string" && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : "";
const mimeOf = (value) => /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(String(value || "").split(";")[0].trim().toLowerCase())
  ? String(value).split(";")[0].trim().toLowerCase() : "";
const cancel = (response) => { try { void response.body?.cancel().catch(() => {}); } catch {} };
const publicUrl = (value, book) => {
  if (!safeString(value, 4000) || /[\u0000-\u0020\u007f\\%]/.test(value)) return "";
  try {
    const u = new URL(value);
    return u.origin === "https://opentextbc.ca" && !u.username && !u.password && !u.port && !u.search && !u.hash &&
      u.pathname.startsWith("/" + book.id + "/") && !/(?:^|\/)(?:wp-login|wp-admin)(?:\/|\.|$)/i.test(u.pathname) ? u.href : "";
  } catch { return ""; }
};

export function advertisedMatterRoutes(index) {
  if (!index || typeof index !== "object" || !Array.isArray(index.namespaces) || !index.namespaces.includes("pressbooks/v2") ||
      !index.routes || typeof index.routes !== "object" || Array.isArray(index.routes)) return [];
  const found = [];
  for (const kind of ["back-matter", "front-matter"]) {
    // These literal numeric templates are the only accepted official forms.
    // No publisher-provided regex is compiled or executed.
    for (const selector of ["(?P<id>[\\d]+)", "(?P<id>\\d+)", "(?P<id>[0-9]+)"]) {
      const route = "/pressbooks/v2/" + kind + "/" + selector;
      if (!Object.hasOwn(index.routes, route)) continue;
      const definition = index.routes[route];
      if (!definition || typeof definition !== "object" || definition.namespace !== "pressbooks/v2") continue;
      const endpoints = Array.isArray(definition.endpoints) ? definition.endpoints : [];
      // Require a literal, advertised endpoint GET, not merely a namespace or
      // collection name that might imply a typed route.
      if (!endpoints.some((endpoint) => endpoint && Array.isArray(endpoint.methods) && endpoint.methods.includes("GET"))) continue;
      found.push({ kind, route, method: "GET" });
    }
  }
  return found;
}

function plainTitle(value) {
  const raw = safeString(value, 4000);
  return raw.replace(/<[^>]*>/g, " ").replace(/&(?:amp|lt|gt|quot|apos|#39|#\d{1,7}|#x[a-f0-9]{1,6});/gi, (entity) => {
    const known = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
    if (known[entity.toLowerCase()] !== undefined) return known[entity.toLowerCase()];
    const n = entity[2].toLowerCase() === "x" ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  }).replace(/\s+/g, " ").trim().slice(0, 1000);
}

function typedMetadata(model, book, id, endpoint) {
  const validObject = !!model && typeof model === "object" && !Array.isArray(model);
  if (!validObject) return { identityAccepted: false };
  const identityAccepted = model.id === id && model.type === "back-matter" && model.status === "publish";
  const fields = [];
  if (identityAccepted && model.content && typeof model.content === "object" && !Array.isArray(model.content))
    for (const field of ["raw", "rendered", "protected"]) if (Object.hasOwn(model.content, field)) {
      const value = model.content[field];
      fields.push({ field, type: typeof value, ...(typeof value === "string" ? { characters: value.length } : {}) });
    }
  const self = Array.isArray(model._links?.self) ? model._links.self.slice(0, 8).map((entry) => entry?.href).filter((value) => value === endpoint) : [];
  return {
    identityAccepted,
    id: Number.isSafeInteger(model.id) ? model.id : null,
    type: /^[a-z][a-z0-9-]{0,59}$/.test(model.type || "") ? model.type : "",
    publicationStatus: /^[a-z][a-z0-9-]{0,59}$/.test(model.status || "") ? model.status : "",
    link: publicUrl(model.link, book),
    ...(identityAccepted ? { titlePlain: plainTitle(model.title?.rendered || model.title?.raw), contentFields: fields } : {}),
    selfLinks: self,
  };
}

export async function runDiscovery({ fetcher = fetch, requestMs = 15000 } = {}) {
  if (!Number.isSafeInteger(requestMs) || requestMs < 1 || requestMs > 15000) throw Error("INVALID_DEADLINE");
  let requests = 0;
  async function readJson(url) {
    const record = { status: 0, mime: "", bytes: 0, sha256: "", challenge: false, outcome: "NOT_STARTED" };
    if (requests >= 7) return { record: { ...record, outcome: "REQUEST_BOUND" }, model: null };
    requests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestMs);
    let reader;
    const stopReader = () => { try { void reader?.cancel().catch(() => {}); } catch {} };
    controller.signal.addEventListener("abort", stopReader);
    try {
      const response = await fetcher(url, { method: "GET", credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { Accept: "application/json", "Accept-Encoding": "identity" } });
      record.status = response.status; record.mime = mimeOf(response.headers.get("content-type"));
      record.challenge = response.headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge";
      if (response.redirected || (response.url && response.url !== url) || [301, 302, 303, 307, 308].includes(response.status)) {
        record.outcome = "REDIRECT_NOT_FOLLOWED"; cancel(response); return { record, model: null };
      }
      if (response.status !== 200) { record.outcome = record.challenge ? "CHALLENGE_NOT_FOLLOWED" : "HTTP_FAILURE"; cancel(response); return { record, model: null }; }
      if (record.mime !== "application/json" || response.headers.has("content-range")) { record.outcome = "UNSUPPORTED_RESPONSE_NOT_READ"; cancel(response); return { record, model: null }; }
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^[1-9]\d*$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > MAXIMUM)) {
        record.outcome = "DECLARED_LENGTH_BOUND"; cancel(response); return { record, model: null };
      }
      reader = response.body?.getReader();
      if (!reader) { record.outcome = "NO_BODY"; return { record, model: null }; }
      const hash = createHash("sha256"), parts = [];
      let empty = 0;
      while (true) {
        const next = await reader.read();
        if (controller.signal.aborted) throw Error("ABORTED");
        if (next.done) break;
        if (!(next.value instanceof Uint8Array) || (!next.value.length && ++empty > 8)) { record.outcome = "INVALID_STREAM"; stopReader(); return { record, model: null }; }
        if (!next.value.length) continue;
        empty = 0; record.bytes += next.value.length;
        if (record.bytes > MAXIMUM) { record.outcome = "BODY_BOUND"; stopReader(); return { record, model: null }; }
        hash.update(next.value); parts.push(next.value);
      }
      if (!record.bytes) { record.outcome = "EMPTY_BODY"; return { record, model: null }; }
      // Fetch can expose decompressed bytes. Only an identity HTTP length can
      // be compared to this actual application body length.
      const encoding = response.headers.get("content-encoding");
      if (declared !== null && (!encoding || encoding.trim().toLowerCase() === "identity") && record.bytes !== Number(declared)) {
        record.outcome = "LENGTH_MISMATCH"; return { record, model: null };
      }
      record.sha256 = hash.digest("hex");
      try {
        const original = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts, record.bytes));
        const model = JSON.parse(original);
        record.outcome = "JSON_EOF_HASHED";
        return { record, model };
      } catch { record.outcome = "INVALID_UTF8_OR_JSON"; return { record, model: null }; }
    } catch { record.outcome = controller.signal.aborted ? "TIMEOUT" : "NETWORK_OR_RUNTIME_FAILURE"; return { record, model: null }; }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", stopReader); try { reader?.releaseLock(); } catch {} }
  }

  const indexes = await Promise.all(BOOKS.map(async (book) => {
    const response = await readJson(book.index);
    const routes = response.model ? advertisedMatterRoutes(response.model) : [];
    return { book, routes, record: { book: book.id, endpoint: book.index, ...response.record, declaredRoutes: routes } };
  }));
  const typed = await Promise.all(indexes.flatMap(({ book, routes }) => {
    const route = routes.find((value) => value.kind === "back-matter");
    if (!route) return [];
    return book.ids.map(async (id) => {
      const endpoint = book.index + route.route.slice(1).replace(/\(\?P<id>.*\)$/, String(id));
      const response = await readJson(endpoint);
      return { book: book.id, requestedId: id, endpoint, advertisedRoute: route.route, ...response.record,
        ...(response.model ? typedMetadata(response.model, book, id, endpoint) : {}) };
    });
  }));
  return { kind: "CTI_ADVERTISED_MATTER_API_DISCOVERY", schemaVersion: 1, checkedAt: new Date().toISOString(),
    requests, requestBound: 7, bodyBoundBytes: MAXIMUM, requestDeadlineMs: requestMs,
    indexes: indexes.map((value) => value.record), typed,
    courseCaptured: false, retainedContent: false, productionChanged: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runDiscovery();
  const output = resolve(process.argv[2] || "/tmp/public-matter-api-discovery.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
}
