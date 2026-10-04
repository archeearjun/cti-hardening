import { safeWebUrl } from "./owner-urls.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
export interface SourceQuestionDefinition {
  id: string;
  library: string;
  prompt: string;
}
export interface SourceQuestionBank {
  id: string;
  library: "H5P.QuestionSet";
  count: number;
  questions: SourceQuestionDefinition[];
  selectedPerAttempt: number | null;
  randomOrder: boolean | null;
}
export interface SourceQuestionCapture {
  kind: "CTI_PUBLIC_SOURCE_QUESTIONS";
  schemaVersion: 1;
  sourceKey: string;
  targetUrl: string;
  capturedAt: string;
  status: "CAPTURED" | "UNVERIFIED";
  reason: string;
  bank: SourceQuestionBank | null;
  documents: { url: string; sha256: string; bytes: number }[];
  sourceLinkBasis: "RECORDED_SOURCE_LINK";
  automatedResolution: false;
}
/** Closed public-provider scope, never an arbitrary authenticated URL proxy.
 * Page IDs are preserved; normalize the historical ?p=123/#main spelling. */
export function publicSourceUrl(value: unknown): string {
  const safe = safeWebUrl(value);
  if (!safe || safe.length > 4000) return "";
  const u = new URL(safe);
  if (
    u.protocol !== "https:" ||
    u.port ||
    !["opentextbc.ca", "pressbooks.bccampus.ca"].includes(u.hostname)
  )
    return "";
  if (!/^\/[a-z0-9][a-z0-9-]*\//i.test(u.pathname)) return "";
  if (/^\/[a-z0-9][a-z0-9-]*\/wp-admin\/admin-ajax\.php$/i.test(u.pathname)) {
    if (
      u.searchParams.get("action") !== "h5p_embed" ||
      !/^\d+$/.test(u.searchParams.get("id") || "") ||
      [...u.searchParams.keys()].some((k) => !["action", "id"].includes(k)) ||
      [...u.searchParams].length !== 2
    )
      return "";
    u.hash = "";
    return u.href;
  }
  if (/(?:wp-admin|wp-login|wp-json|\.php|%|\.\.)/i.test(u.pathname)) return "";
  if (new Set(u.searchParams.keys()).size !== [...u.searchParams].length)
    return "";
  for (const [key, value] of u.searchParams) {
    if (!["p", "h5p-embed"].includes(key) || !/^\d+\/?$/.test(value)) return "";
    u.searchParams.set(key, value.replace(/\/$/, ""));
  }
  u.hash = "";
  return u.href;
}
export function samePublicBook(value: unknown, initial: string): string {
  const valid = publicSourceUrl(value);
  if (!valid) return "";
  const a = new URL(initial),
    b = new URL(valid);
  return a.origin === b.origin &&
    a.pathname.split("/")[1] === b.pathname.split("/")[1]
    ? valid
    : "";
}
function plain(value: unknown): string {
  return str(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|#39);/g,
      (v) =>
        ({
          "&nbsp;": " ",
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&#39;": "'",
        })[v] || v,
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}
function jsonObjectAt(source: string, offset: number): unknown {
  if (source[offset] !== "{") throw Error("H5P definition is not JSON.");
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = offset; i < source.length && i - offset <= 2_000_000; i++) {
    const c = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0)
      return JSON.parse(source.slice(offset, i + 1));
  }
  throw Error("H5P definition is incomplete or exceeds the limit.");
}
/** Parse data emitted by the official H5P WordPress plugin. Never execute page
 * JavaScript, evaluate arbitrary expressions or count visible question widgets. */
export function readH5PQuestionSets(html: string): {
  banks: SourceQuestionBank[];
  unresolved: boolean;
} {
  const banks: SourceQuestionBank[] = [],
    seen = new Set<string>();
  let unresolved = false;
  const scripts = html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi);
  for (const match of scripts) {
    const script = match[1],
      marker =
        /^\s*(?:(?:var|let|const)\s+)?(?:window\.)?H5PIntegration\s*=\s*/g;
    let assignment;
    while ((assignment = marker.exec(script))) {
      try {
        const integration = obj(jsonObjectAt(script, marker.lastIndex));
        const entries = Object.entries(obj(integration.contents));
        if (entries.length > 50) throw Error("Too many H5P activities.");
        for (const [id, value] of entries) {
          const content = obj(value),
            library = str(content.library).split(" ")[0];
          if (library !== "H5P.QuestionSet") {
            unresolved = true;
            continue;
          }
          if (
            typeof content.jsonContent !== "string" ||
            content.jsonContent.length > 2_000_000
          )
            throw Error("Invalid question definitions.");
          const params = obj(JSON.parse(content.jsonContent));
          if (
            !Array.isArray(params.questions) ||
            params.questions.length > 1000
          )
            throw Error("Question definitions missing or too large.");
          const questions = params.questions.map(
            (q: unknown, index: number): SourceQuestionDefinition => {
              const v = obj(q),
                p = obj(v.params),
                lib = str(v.library).split(" ")[0];
              if (!/^H5P\.[A-Za-z0-9]+$/.test(lib))
                throw Error("Question library missing.");
              return {
                id: str(v.subContentId) || String(index + 1),
                library: lib,
                prompt: plain(
                  p.question || p.text || p.taskDescription || p.introduction,
                ),
              };
            },
          );
          const pool = params.poolSize;
          if (
            pool != null &&
            (!Number.isSafeInteger(pool) ||
              Number(pool) < 0 ||
              Number(pool) > questions.length)
          )
            throw Error("Invalid selection size.");
          const bank: SourceQuestionBank = {
            id,
            library: "H5P.QuestionSet",
            count: questions.length,
            questions,
            selectedPerAttempt:
              typeof pool === "number" && pool > 0 ? pool : null,
            randomOrder:
              typeof params.randomQuestions === "boolean"
                ? params.randomQuestions
                : null,
          };
          // Repeated integration assignments are often emitted for the same
          // activity. Conflicting data cannot silently select the first copy.
          const key = JSON.stringify(bank);
          if (!seen.has(key)) {
            banks.push(bank);
            seen.add(key);
          }
        }
      } catch {
        unresolved = true;
      }
    }
  }
  return { banks, unresolved };
}
export function h5pFrames(
  html: string,
  pageUrl: string,
  initial: string,
): { urls: string[]; unresolved: boolean } {
  const urls: string[] = [];
  let unresolved = false;
  for (const m of html.matchAll(
    /<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi,
  )) {
    try {
      const u = new URL(m[2].replace(/&amp;/g, "&"), pageUrl);
      // Only explicit H5P embeds found in the source page, never synthesized IDs.
      if (
        !u.searchParams.has("h5p-embed") &&
        u.searchParams.get("action") !== "h5p_embed"
      )
        continue;
      const valid = samePublicBook(u.href, initial);
      if (valid && !urls.includes(valid)) urls.push(valid);
      else if (!valid) unresolved = true;
    } catch {
      unresolved = true;
    }
  }
  return { urls, unresolved };
}
export function validateSourceQuestionCapture(
  value: unknown,
): asserts value is SourceQuestionCapture {
  const v = obj(value);
  if (
    v.kind !== "CTI_PUBLIC_SOURCE_QUESTIONS" ||
    v.schemaVersion !== 1 ||
    !str(v.sourceKey) ||
    str(v.sourceKey).length > 4000 ||
    !publicSourceUrl(v.targetUrl) ||
    !Number.isFinite(Date.parse(str(v.capturedAt))) ||
    !["CAPTURED", "UNVERIFIED"].includes(str(v.status)) ||
    str(v.reason).length > 2000 ||
    !Array.isArray(v.documents) ||
    v.documents.length > 6 ||
    v.automatedResolution !== false ||
    v.sourceLinkBasis !== "RECORDED_SOURCE_LINK"
  )
    throw Error("Invalid automatic source question evidence.");
  for (const d of v.documents) {
    const doc = obj(d);
    if (
      !samePublicBook(doc.url, str(v.targetUrl)) ||
      !/^[a-f0-9]{64}$/.test(str(doc.sha256)) ||
      !Number.isSafeInteger(doc.bytes) ||
      Number(doc.bytes) < 0 ||
      Number(doc.bytes) > 3_000_000
    )
      throw Error("Invalid source document receipt.");
  }
  if (v.status === "UNVERIFIED") {
    if (v.bank !== null)
      throw Error("Unverified evidence cannot declare a complete source bank.");
    return;
  }
  const b = obj(v.bank);
  if (
    !v.documents.length ||
    b.library !== "H5P.QuestionSet" ||
    !str(b.id) ||
    !Array.isArray(b.questions) ||
    b.questions.length > 1000 ||
    b.count !== b.questions.length ||
    (b.selectedPerAttempt !== null &&
      (!Number.isSafeInteger(b.selectedPerAttempt) ||
        Number(b.selectedPerAttempt) <= 0 ||
        Number(b.selectedPerAttempt) > b.questions.length)) ||
    (b.randomOrder !== null && typeof b.randomOrder !== "boolean")
  )
    throw Error("Source question bank count or scope is invalid.");
  for (const q of b.questions) {
    const question = obj(q);
    if (
      !str(question.id) ||
      !/^H5P\.[A-Za-z0-9]+$/.test(str(question.library)) ||
      typeof question.prompt !== "string" ||
      question.prompt.length > 6000
    )
      throw Error("Source question definitions are invalid.");
  }
}
