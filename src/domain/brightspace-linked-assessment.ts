import { DOMParser, type Element, type Node } from "@xmldom/xmldom";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ContentEvidence } from "./content-evidence.ts";

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");
const id = (value: unknown) =>
  (typeof value === "string" || typeof value === "number") &&
  /^[0-9]{1,30}$/.test(String(value))
    ? String(value)
    : "";
const encoder = new TextEncoder();
const digest = (value: string) => bytesToHex(sha256(encoder.encode(value)));
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_NATIVE_BYTES = 8 * 1024 * 1024;
const MAX_QUIZZES = 2000;
const MAX_LINKS = 100;
const method = "CAPTURED_SAME_COURSE_QUICKLINK_ACTIVITY_ID_V1";
export const LINKED_BRIGHTSPACE_READING_BASIS =
  "Original Brightspace extraction with separate linked native assessment evidence";
export const LINKED_BRIGHTSPACE_QUIZ_BASIS =
  "Captured linked Brightspace native quiz; separate from the reading";
export interface BrightspaceQuizLinkSource {
  topicId: string;
  courseId: string;
  pageUrl: string;
  originalUrl: string;
  originalRef: string;
  bytes: number;
  capturedAt: string;
  rawHtml: string;
}
interface QuizIdentity {
  id: string;
  activityId: string;
}
interface QuizLink {
  authoredUrl: string;
  resolvedUrl: string;
  rcode: string;
  quizId: string;
  quizName: string;
  activityId: string;
  nativeRecord: string;
  nativeRecordSha256: string;
}
export interface BrightspaceLinkedAssessmentEvidence {
  schemaVersion: 1;
  method: typeof method;
  source: BrightspaceQuizLinkSource;
  nativeQuizInventory: QuizIdentity[];
  nativeQuizInventorySha256: string;
  assessments: (QuizLink & { content: ContentEvidence })[];
}
export function canonicalBrightspaceQuizLink(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalBrightspaceQuizLink).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalBrightspaceQuizLink(object(value)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function safeUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
function pageCourse(url: URL) {
  return (
    /^\/d2l\/(?:home|le\/(?:lessons|content|sequence))\/([0-9]{1,30})(?:\/|$)/i.exec(
      url.pathname,
    )?.[1] || ""
  );
}
function validSource(source: BrightspaceQuizLinkSource) {
  if (
    Object.keys(source).sort().join(",") !==
    "bytes,capturedAt,courseId,originalRef,originalUrl,pageUrl,rawHtml,topicId"
  )
    return false;
  if (
    typeof source.rawHtml !== "string" ||
    source.rawHtml.length > MAX_HTML_BYTES
  )
    return false;
  const page = safeUrl(source.pageUrl),
    original = safeUrl(source.originalUrl),
    bytes = encoder.encode(source.rawHtml);
  return !!(
    id(source.topicId) &&
    id(source.courseId) &&
    page &&
    original &&
    page.origin === original.origin &&
    pageCourse(page) === source.courseId &&
    (new RegExp(`^/content/enforced/${source.courseId}(?:-|/)`, "i").test(
      original.pathname,
    ) ||
      new RegExp(`^/d2l/le/content/${source.courseId}/`, "i").test(
        original.pathname,
      )) &&
    !original.hash &&
    bytes.length <= MAX_HTML_BYTES &&
    bytes.length === source.bytes &&
    digest(source.rawHtml) === source.originalRef &&
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) ===
      source.rawHtml &&
    typeof source.capturedAt === "string" &&
    source.capturedAt.length <= 80 &&
    Number.isFinite(Date.parse(source.capturedAt))
  );
}
function activityCode(value: string) {
  const match =
    /^https:\/\/ids\.brightspace\.com\/activities\/quiz\/([A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}-[0-9]{1,30})$/.exec(
      value,
    );
  return match?.[1] || "";
}
function sourceLinks(source: BrightspaceQuizLinkSource) {
  if (
    !validSource(source) ||
    /<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(source.rawHtml)
  )
    return [];
  let document,
    invalid = false;
  try {
    document = new DOMParser({
      onError: () => {
        invalid = true;
      },
    }).parseFromString(source.rawHtml, "text/html");
  } catch {
    return [];
  }
  if (invalid) return [];
  const links: { authoredUrl: string; resolvedUrl: string; rcode: string }[] =
      [],
    stack: { node: Node; depth: number }[] = [{ node: document, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++nodes > 50000 || depth > 100) return [];
    if (node.nodeType === 1) {
      const element = node as Element,
        tag = (element.localName || element.tagName).toLowerCase();
      if (tag === "base") return [];
      if (["script", "style", "template", "noscript"].includes(tag)) continue;
      if (tag === "a" && element.hasAttribute("href")) {
        const authoredUrl = element.getAttribute("href")!,
          url = safeUrl(authoredUrl, source.originalUrl);
        if (
          url &&
          url.origin === new URL(source.pageUrl).origin &&
          /^\/d2l\/common\/(?:dialogs\/quickLink\/)?quickLink\.d2l$/i.test(
            url.pathname,
          ) &&
          !url.hash
        ) {
          const params = [...url.searchParams],
            keys = params.map(([key]) => key.toLowerCase());
          if (
            new Set(keys).size === keys.length &&
            keys.every((key) => ["ou", "type", "rcode"].includes(key)) &&
            keys.length === 3 &&
            url.searchParams.get("ou") === source.courseId &&
            url.searchParams.get("type") === "quiz"
          ) {
            const rcode = url.searchParams.get("rcode") || "";
            if (
              activityCode(
                `https://ids.brightspace.com/activities/quiz/${rcode}`,
              )
            ) {
              if (links.length >= MAX_LINKS) return [];
              if (!links.some((link) => link.authoredUrl === authoredUrl))
                links.push({ authoredUrl, resolvedUrl: url.href, rcode });
            }
          }
        }
      }
    }
    for (let child = node.lastChild; child; child = child.previousSibling)
      stack.push({ node: child, depth: depth + 1 });
  }
  return links;
}
/** The capture integrity validator owns native original binding before this
 * function is called. This relationship only joins exact authored identifiers;
 * names, descriptions, projected links and list positions are never join keys. */
export function deriveBrightspaceLinkedAssessments(
  source: BrightspaceQuizLinkSource,
  quizzes: unknown[],
  project: (
    quiz: Obj,
    source: BrightspaceQuizLinkSource,
    url: string,
  ) => ContentEvidence,
): BrightspaceLinkedAssessmentEvidence | undefined {
  const links = sourceLinks(source);
  if (!links.length || quizzes.length > MAX_QUIZZES) return;
  const inventory = quizzes.map((value) => {
    const quiz = object(value);
    return { id: id(quiz.id), activityId: string(object(quiz.raw).ActivityId) };
  });
  if (inventory.some((quiz) => quiz.activityId.length > 1000)) return;
  return derive(source, inventory, quizzes, links, project);
}
function derive(
  source: BrightspaceQuizLinkSource,
  inventory: QuizIdentity[],
  quizzes: unknown[],
  links: ReturnType<typeof sourceLinks>,
  project: (
    quiz: Obj,
    source: BrightspaceQuizLinkSource,
    url: string,
  ) => ContentEvidence,
): BrightspaceLinkedAssessmentEvidence | undefined {
  const assessments: BrightspaceLinkedAssessmentEvidence["assessments"] = [];
  let retainedNativeBytes = 0,
    retainedQuestions = 0;
  for (const link of links) {
    const matches = inventory.filter(
      (quiz) => activityCode(quiz.activityId) === link.rcode,
    );
    if (
      matches.length !== 1 ||
      !matches[0].id ||
      inventory.filter((quiz) => quiz.id === matches[0].id).length !== 1
    )
      continue;
    const match = matches[0],
      records = quizzes
        .map(object)
        .filter(
          (quiz) =>
            id(quiz.id) === match.id &&
            object(quiz.raw).ActivityId === match.activityId,
        );
    if (records.length !== 1 || id(object(records[0].raw).QuizId) !== match.id)
      continue;
    const quiz = records[0];
    if (!Array.isArray(quiz.questions) || quiz.questions.length > 5000)
      continue;
    const nativeRecord = JSON.stringify(quiz);
    if (
      nativeRecord.length > MAX_NATIVE_BYTES ||
      encoder.encode(nativeRecord).byteLength > MAX_NATIVE_BYTES
    )
      continue;
    retainedNativeBytes += encoder.encode(nativeRecord).byteLength;
    retainedQuestions += quiz.questions.length;
    // Fail closed for the whole optional projection rather than silently
    // cropping linked records or multiplying a large quiz across many links.
    if (retainedNativeBytes > MAX_NATIVE_BYTES || retainedQuestions > 5000)
      return;
    assessments.push({
      ...link,
      quizId: match.id,
      quizName: string(object(quiz.raw).Name),
      activityId: match.activityId,
      nativeRecord,
      nativeRecordSha256: digest(nativeRecord),
      content: project(quiz, source, link.resolvedUrl),
    });
  }
  if (!assessments.length) return;
  return {
    schemaVersion: 1,
    method,
    source: { ...source },
    nativeQuizInventory: inventory,
    nativeQuizInventorySha256: digest(canonicalBrightspaceQuizLink(inventory)),
    assessments,
  };
}
/** Recheck exact original HTML bytes and native records, then rebuild every
 * relationship, question, key, count and coverage label. This is independent
 * projection integrity, not cryptographic attestation of the LMS response. */
export function validateBrightspaceLinkedAssessments(
  value: unknown,
  source: Omit<
    BrightspaceQuizLinkSource,
    "rawHtml" | "pageUrl" | "courseId" | "capturedAt"
  >,
  project: (
    quiz: Obj,
    source: BrightspaceQuizLinkSource,
    url: string,
  ) => ContentEvidence,
): asserts value is BrightspaceLinkedAssessmentEvidence {
  const input = object(value),
    retained = object(input.source),
    inventory = input.nativeQuizInventory,
    assessments = input.assessments;
  const fail = () => {
    throw Error(
      "Saved linked Brightspace assessment differs from its original HTML or captured native quiz evidence.",
    );
  };
  if (
    !Array.isArray(inventory) ||
    inventory.length > MAX_QUIZZES ||
    !Array.isArray(assessments) ||
    assessments.length > MAX_LINKS ||
    !assessments.length
  )
    fail();
  const context = retained as unknown as BrightspaceQuizLinkSource;
  if (
    Object.entries(source).some(([key, value]) => retained[key] !== value) ||
    !validSource(context)
  )
    fail();
  const identities: QuizIdentity[] = [];
  for (const row of inventory as unknown[]) {
    const identity = object(row);
    if (
      Object.keys(identity).sort().join(",") !== "activityId,id" ||
      typeof identity.id !== "string" ||
      typeof identity.activityId !== "string" ||
      (identity.id !== "" && id(identity.id) !== identity.id) ||
      identity.activityId.length > 1000
    )
      fail();
    identities.push(identity as unknown as QuizIdentity);
  }
  if (
    input.nativeQuizInventorySha256 !==
    digest(canonicalBrightspaceQuizLink(identities))
  )
    fail();
  const quizzes: unknown[] = [];
  let nativeBytes = 0,
    nativeQuestions = 0;
  for (const row of assessments as unknown[]) {
    const record = object(row),
      raw = record.nativeRecord;
    if (typeof raw !== "string" || raw.length > MAX_NATIVE_BYTES) fail();
    const bytes = encoder.encode(raw as string);
    nativeBytes += bytes.length;
    if (nativeBytes > MAX_NATIVE_BYTES)
      throw Error(
        "Saved linked Brightspace assessment exceeds its aggregate native record bound.",
      );
    if (record.nativeRecordSha256 !== bytesToHex(sha256(bytes))) fail();
    let quiz: unknown;
    try {
      quiz = JSON.parse(raw as string);
    } catch {
      fail();
    }
    const questions = object(quiz).questions;
    if (!Array.isArray(questions)) fail();
    nativeQuestions += (questions as unknown[]).length;
    if (nativeQuestions > 5000)
      throw Error(
        "Saved linked Brightspace assessment exceeds its aggregate native question bound.",
      );
    if (!quizzes.some((value) => JSON.stringify(value) === raw))
      quizzes.push(quiz);
  }
  const expected = derive(
    context,
    identities,
    quizzes,
    sourceLinks(context),
    project,
  );
  if (
    !expected ||
    canonicalBrightspaceQuizLink(input) !==
      canonicalBrightspaceQuizLink(expected)
  )
    fail();
}
