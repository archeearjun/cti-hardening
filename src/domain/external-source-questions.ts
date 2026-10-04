import { safeWebUrl } from "./owner-urls.ts";
import { contentText } from "./content-evidence.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
export interface SourceQuestionDefinition {
  id: string;
  library: string;
  prompt: string;
  promptTruncated?: boolean;
  options?: { id: string; text: string }[];
  optionTextReliable?: boolean;
  mediaRefs?: string[];
  mediaTruncated?: boolean;
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
  status: "CAPTURED" | "PARTIAL" | "UNVERIFIED";
  reason: string;
  bank: SourceQuestionBank | null;
  pages?: {
    url: string;
    text: string;
    observedCharacters: number;
    truncated: boolean;
  }[];
  observedBanks?: SourceQuestionBank[];
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
export function publicPageText(html: string, url: string) {
  // An identified document body is useful partial evidence, never proof that
  // embedded or dynamically loaded screens were read. Do not collect site chrome.
  const main =
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i) ||
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i);
  if (!main) return null;
  const text = contentText(main[1])
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n");
  return {
    url,
    text: text.slice(0, 48000),
    observedCharacters: text.length,
    truncated: text.length > 48000,
  };
}
function questionMedia(value: unknown) {
  const refs = new Set<string>();
  let visited = 0,
    truncated = false;
  function walk(v: unknown, depth: number, key = "") {
    if (++visited > 1000 || depth > 8) {
      truncated = true;
      return;
    }
    if (typeof v === "string") {
      if (["path", "url", "src"].includes(key) && v && v.length < 4000)
        refs.add(v);
      for (const m of v.matchAll(
        /<(?:img|video|audio|source|iframe)\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi,
      ))
        if (m[2].length < 4000) refs.add(m[2].replace(/&amp;/g, "&"));
    } else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (visited > 1000) break;
        walk(x, depth + 1, k);
      }
  }
  walk(value, 0);
  return {
    mediaRefs: [...refs].slice(0, 200),
    mediaTruncated: truncated || refs.size > 200,
  };
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
              const prompt = contentText(
                p.question || p.text || p.taskDescription || p.introduction,
              );
              const answers = Array.isArray(p.answers) ? p.answers : [];
              return {
                ...questionMedia(p),
                id: str(v.subContentId) || String(index + 1),
                library: lib,
                prompt: prompt.slice(0, 48000),
                promptTruncated: prompt.length > 48000,
                options: answers.slice(0, 200).map((v, i) => ({
                  id: String(i + 1),
                  text: contentText(obj(v).text).slice(0, 48000),
                })),
                optionTextReliable:
                  answers.length > 0 &&
                  answers.length <= 200 &&
                  answers.every(
                    (v) =>
                      typeof obj(v).text === "string" &&
                      contentText(obj(v).text).length <= 48000,
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
    !["CAPTURED", "PARTIAL", "UNVERIFIED"].includes(str(v.status)) ||
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
  if (v.pages !== undefined) {
    if (!Array.isArray(v.pages) || v.pages.length > 6)
      throw Error("Invalid source page evidence.");
    for (const page of v.pages) {
      const p = obj(page);
      if (
        !samePublicBook(p.url, str(v.targetUrl)) ||
        typeof p.text !== "string" ||
        p.text.length > 48000 ||
        !Number.isSafeInteger(p.observedCharacters) ||
        Number(p.observedCharacters) < p.text.length ||
        typeof p.truncated !== "boolean" ||
        p.truncated !== Number(p.observedCharacters) > p.text.length
      )
        throw Error("Invalid source page text.");
    }
  }
  if (v.observedBanks !== undefined) {
    if (!Array.isArray(v.observedBanks) || v.observedBanks.length > 50)
      throw Error("Invalid observed source banks.");
    for (const bank of v.observedBanks) validateBank(bank);
  }
  if (v.status !== "CAPTURED") {
    if (v.bank !== null)
      throw Error("Unverified evidence cannot declare a complete source bank.");
    if (
      v.status === "PARTIAL" &&
      (!v.documents.length ||
        !(
          (Array.isArray(v.pages) && v.pages.some((p) => str(obj(p).text))) ||
          (Array.isArray(v.observedBanks) && v.observedBanks.length)
        ))
    )
      throw Error(
        "Partial source evidence needs retained content and source receipts.",
      );
    return;
  }
  if (!v.documents.length) throw Error("Source document receipt missing.");
  validateBank(v.bank);
}
function validateBank(value: unknown) {
  const b = obj(value);
  if (
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
      question.prompt.length > 48000 ||
      (question.promptTruncated !== undefined &&
        typeof question.promptTruncated !== "boolean") ||
      (question.optionTextReliable !== undefined &&
        typeof question.optionTextReliable !== "boolean") ||
      (question.mediaTruncated !== undefined &&
        typeof question.mediaTruncated !== "boolean") ||
      (question.mediaRefs !== undefined &&
        (!Array.isArray(question.mediaRefs) ||
          question.mediaRefs.length > 200 ||
          question.mediaRefs.some(
            (r) => typeof r !== "string" || r.length > 4000,
          ))) ||
      (question.options !== undefined &&
        (!Array.isArray(question.options) ||
          question.options.length > 200 ||
          question.options.some(
            (v) =>
              typeof obj(v).id !== "string" ||
              typeof obj(v).text !== "string" ||
              str(obj(v).text).length > 48000,
          )))
    )
      throw Error("Source question definitions are invalid.");
  }
}
