import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Finding } from "./types.ts";

type Model = Record<string, any>;
export const MAX_BRIGHTSPACE_ORIGINAL_BYTES = 64 * 1024 * 1024;
export const MAX_BRIGHTSPACE_ARCHIVE_ORIGINAL_BYTES = 512 * 1024 * 1024;
export const MAX_BRIGHTSPACE_ARCHIVE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_PROJECTION_BYTES = 16 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const object = (value: unknown): Model =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Model)
    : {};
const rows = (value: unknown): Model[] =>
  Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const digest = (value: string) => bytesToHex(sha256(encoder.encode(value)));

export interface BrightspaceArchiveFile {
  path: string;
  sha256: string;
  size: number;
  blob: Blob;
}
interface VerifiedArchiveBody {
  blob: Blob;
  sha256: string;
  size: number;
  text: Map<string, string>;
  prefix: Uint8Array;
}
// Blob bytes are immutable. Only this module can establish a verified resolver;
// serialized descriptors and arbitrary properties cannot assert body integrity.
const verifiedArchiveBodies = new WeakMap<object, VerifiedArchiveBody>();

function usesArchiveBodies(capture: Model) {
  const transport = capture.originalBodyTransport;
  const descriptors = Object.values(object(capture.assetBodies)).some(
    (body) => object(body).encoding === "archive",
  );
  if (transport == null && !descriptors) return false;
  if (
    Number(capture.schemaVersion) !== 2 ||
    !transport ||
    transport.format !== "CTI_BRIGHTSPACE_ARCHIVE_V1" ||
    transport.version !== 1 ||
    transport.bodyEncoding !== "archive" ||
    transport.hashAlgorithm !== "SHA-256"
  )
    throw Error("Brightspace archive original-body transport is invalid.");
  return true;
}

function archiveBodyDescriptor(key: string, body: Model) {
  if (
    !hashPattern.test(key) ||
    body.sha256 !== key ||
    body.encoding !== "archive" ||
    body.archivePath !== "files/" + key ||
    !Number.isSafeInteger(body.bytes) ||
    body.bytes < 0 ||
    body.bytes > MAX_BRIGHTSPACE_ARCHIVE_FILE_BYTES ||
    Object.hasOwn(body, "base64")
  )
    throw Error(
      "Brightspace archive original has an invalid path, SHA-256 or byte-length descriptor.",
    );
}

/** Original Blobs are available only after independent asynchronous verification. */
export function getBrightspaceOriginalBody(
  value: unknown,
  ref: string,
): Blob | undefined {
  const body = object(object(value).assetBodies)[ref],
    proof = body && verifiedArchiveBodies.get(body);
  if (!proof) return undefined;
  archiveBodyDescriptor(ref, body);
  if (proof.sha256 !== ref || proof.size !== body.bytes) return undefined;
  return proof.blob;
}

/** Bounded decoded originals used by content views without decoding binary bodies. */
export function getBrightspaceOriginalText(
  value: unknown,
  ref: string,
  charset = "utf-8",
): string | undefined {
  const body = object(object(value).assetBodies)[ref];
  if (!getBrightspaceOriginalBody(value, ref)) return undefined;
  return verifiedArchiveBodies.get(body)?.text.get(charset.toLowerCase());
}

export interface BrightspaceCaptureEvidence {
  schemaVersion: 1;
  platform: "BRIGHTSPACE";
  wholeCourseComplete: false;
  completeness: "GAPS_OR_UNVERIFIED";
  originalIntegrity:
    | "NOT_CHECKED"
    | "VERIFIED_RETAINED_ORIGINALS"
    | "NO_ORIGINAL_BODIES";
  counts: {
    topics: number;
    modules: number;
    quizzes: number;
    questionDefinitions: number;
    retainedOriginals: number;
    retainedOriginalBytes: number;
  };
  findings: Finding[];
  warnings: string[];
}
function inventory(capture: Model) {
  const nodes: Model[] = [];
  const visit = (list: unknown, depth: number) => {
    if (depth > 100)
      throw Error("Brightspace content tree exceeds its depth bound.");
    for (const node of rows(list)) {
      if (nodes.length >= 100000)
        throw Error(
          "Brightspace content tree exceeds its 100,000-entry bound.",
        );
      nodes.push(node);
      visit(node.children, depth + 1);
    }
  };
  visit(capture.contentTree, 0);
  return nodes;
}
function nativeQuestionIdentity(question: Model) {
  const ids = [question.QuestionId, question.questionId]
    .filter(
      (value) =>
        (typeof value === "string" || typeof value === "number") &&
        /^[A-Za-z0-9_-]{1,160}$/.test(text(value)),
    )
    .map((value) => text(value));
  return { id: ids[0] || "", conflicting: new Set(ids).size > 1 };
}
function sourceUrl(value: unknown, base?: string) {
  if (!text(value).trim()) return "";
  try {
    const url = new URL(text(value), base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
/** Re-evaluate the collector's narrow static-source scope independently. This
 * does not infer access permissions or trust a declared redirect policy. */
function approvedDwgSource(value: string, courseId: string) {
  const url = new URL(value);
  if (!/^\d{1,20}$/.test(courseId) || /%(?:2f|5c|00|25)/i.test(url.pathname))
    return false;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (
    /\/(?:login|logon|signin|signout|logout|auth|oauth|saml|sso)(?:[/.]|$)/i.test(
      pathname,
    ) ||
    /\/d2l\/api\//i.test(pathname)
  )
    return false;
  const match =
    /^\/content\/enforced\/(\d{1,20})(?:-[A-Za-z0-9_-]{1,160})?\/(.+\.dwg)$/i.exec(
      pathname,
    );
  return (
    !!match &&
    match[1] === courseId &&
    !/[\\\0\r\n]/.test(pathname) &&
    !match[2].split("/").some((part) => !part || part === "." || part === "..")
  );
}
function approvedDwgMime(value: unknown) {
  return (
    typeof value === "string" &&
    /^(?:image\/(?:vnd\.dwg|x-dwg)|application\/(?:acad|x-acad|autocad|x-autocad|dwg|x-dwg|octet-stream)|drawing\/dwg)$/i.test(
      value.split(";", 1)[0].trim(),
    )
  );
}
function approvedStaticSource(
  value: string,
  allowCourseFile: boolean,
  courseId = "",
) {
  const url = new URL(value);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (
    /\/(?:login|logon|signin|signout|logout|auth|oauth|saml|sso)(?:[/.]|$)/i.test(
      pathname,
    ) ||
    /\/d2l\/api\//i.test(pathname)
  )
    return false;
  // Independently mirror the narrow, observed image-view route. Decoding an
  // alternate path must not authorize encoded separators or tool wrappers.
  const imageView =
    /^\/d2l\/lp\/files\/temp\/[A-Za-z0-9_-]{1,160}\.([A-Za-z]{3,4});[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.([A-Za-z]{3,4})\/View$/.exec(
      url.pathname,
    );
  if (
    imageView &&
    !url.search &&
    /^(?:png|jpe?g|gif|webp|svg)$/.test(imageView[1].toLowerCase()) &&
    imageView[1].toLowerCase() === imageView[2].toLowerCase()
  )
    return true;
  if (/^\/d2l\/lp\/files\/temp\//.test(pathname) && /;/i.test(pathname))
    return false;
  if (approvedDwgSource(value, courseId)) return true;
  if (
    /\.(?:html?|xhtml|txt|srt|vtt|csv|json|jpe?g|png|gif|webp|svg|pdf|pptx?|docx?|xlsx?|mp4|webm|mp3|wav|m4a|zip)$/i.test(
      pathname,
    )
  )
    return true;
  if (!allowCourseFile || !/\/quickLink\.d2l$/i.test(pathname)) return false;
  const values = new Map(
    [...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]),
  );
  return (
    values.get("type")?.toLowerCase() === "coursefile" &&
    /\.(?:pdf|pptx?|docx?|xlsx?|csv|txt|srt|vtt|jpe?g|png|gif|webp|svg|zip)$/i.test(
      values.get("fileid") || "",
    )
  );
}
function bindingSources(
  capture: Model,
  nodes: Model[],
  kind: string,
  id: string,
  parentId = "",
) {
  if (kind === "DISCUSSION_TOPIC") {
    const forums = rows(capture.discussions).filter(
      (forum) => text(forum.id) === parentId,
    );
    if (forums.length !== 1) return [];
    return rows(forums[0].topics).filter((topic) =>
      [topic.id, topic.Id, topic.TopicId, topic.topicId].some(
        (value) => value != null && text(value) === id,
      ),
    );
  }
  const candidates =
    kind === "TOPIC" || kind === "MODULE"
      ? nodes.filter(
          (node) =>
            text(node.kind).toUpperCase() === kind &&
            !["REUSED_REFERENCE", "CYCLE_REFERENCE"].includes(
              node.structureEvidence?.status,
            ),
        )
      : kind === "DISCUSSION"
        ? rows(capture.discussions).flatMap((forum) => [
            forum,
            ...rows(forum.topics),
          ])
        : rows(capture[kind === "QUIZ" ? "quizzes" : "assignments"]);
  return candidates.filter((node) =>
    [node.id, node.Id, node.TopicId, node.ForumId].some(
      (value) => value != null && text(value) === id,
    ),
  );
}
function boundUrls(node: Model, base: string, nativeKind: string) {
  const urls = new Set<string>(),
    add = (value: unknown, relativeTo = base) => {
      const url = sourceUrl(value, relativeTo);
      if (url) urls.add(url);
    };
  add(node.url || node.Url || node.URL);
  const ev = object(node.contentEvidence);
  for (const entries of [
    ev.references,
    ev.images,
    ev.embeds,
    ev.links,
    ev.attachments,
    node.descriptionReferences,
  ])
    for (const ref of Array.isArray(entries) ? entries : [])
      add(
        typeof ref === "string"
          ? ref
          : ref.url || ref.href || ref.src || ref.rawUrl,
      );
  const unescape = (value: string) =>
    value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const number = entity.toLowerCase().startsWith("&#x")
        ? parseInt(entity.slice(3, -1), 16)
        : parseInt(entity.slice(2, -1), 10);
      return number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : entity;
    });
  let visited = 0;
  const visit = (value: unknown, depth: number, documentBase = base) => {
    if (++visited > 50000)
      throw Error(
        "Brightspace native media binding exceeds its 50,000-field bound.",
      );
    if (depth > 15) return;
    if (typeof value === "string") {
      const baseMatch =
        /<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
          value,
        );
      const relativeTo = baseMatch
        ? sourceUrl(
            unescape(baseMatch[1] ?? baseMatch[2] ?? baseMatch[3]),
            documentBase,
          ) || documentBase
        : documentBase;
      const pattern =
        /\b(?:src|href|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
      let match;
      while ((match = pattern.exec(value)))
        add(unescape(match[1] ?? match[2] ?? match[3]), relativeTo);
      const decoded = unescape(value);
      for (const css of decoded.matchAll(
        /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,
      ))
        add(css[1] ?? css[2] ?? css[3], relativeTo);
      for (const set of value.matchAll(
        /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      ))
        for (const candidate of unescape(set[1] ?? set[2] ?? set[3]).split(
          ",",
        )) {
          const url = candidate.trim().split(/\s+/)[0];
          if (url) add(url, relativeTo);
        }
    } else if (Array.isArray(value))
      for (const row of value) visit(row, depth + 1, documentBase);
    else if (value && typeof value === "object")
      for (const [key, row] of Object.entries(value)) {
        if (
          /^(?:description|custominstructions|instructions|questiontext|feedback|questioninfo|answers|answer|html|text|raw|rawdetail|topics)$/i.test(
            key,
          )
        )
          visit(row, depth + 1, documentBase);
      }
  };
  visit(node, 0);
  // Quiz definitions are captured separately from the quiz's rich description.
  // Only the declared quiz's top-level native question collection may supply
  // these references; an arbitrary nested `questions` property is not evidence
  // of ownership. Keep the existing rich-text field allowlist for descendants.
  if (nativeKind === "QUIZ") {
    const questions = Array.isArray(node.questions) ? node.questions : [];
    if (questions.length > 5000)
      throw Error(
        "Brightspace quiz media binding exceeds its 5,000-question bound.",
      );
    for (const input of questions) {
      const question = object(input);
      visited = 0;
      for (const field of [
        "QuestionText",
        "questionText",
        "Hint",
        "hint",
        "Feedback",
        "feedback",
        "QuestionInfo",
        "questionInfo",
      ])
        if (Object.hasOwn(question, field)) visit(question[field], 0);
    }
  }
  if (typeof ev.html === "string")
    visit(ev.html, 0, sourceUrl(ev.bodyReceipt?.responseUrl) || base);
  return urls;
}
function mediaReferences(node: Model, base: string) {
  const evidence = object(node.contentEvidence),
    refs = new Set<string>();
  const add = (value: unknown, relativeTo = base) => {
    const url = sourceUrl(value, relativeTo);
    if (url) refs.add(url);
  };
  for (const name of ["images", "embeds", "attachments", "media"])
    for (const value of Array.isArray(evidence[name]) ? evidence[name] : [])
      add(
        typeof value === "string"
          ? value
          : value.url || value.src || value.href,
      );
  const description = object(node.description);
  const html = text(evidence.html || description.html || description.Html);
  const attribute = (value: string) => value.replace(/&amp;/gi, "&");
  const declaredBase =
    /<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  const documentBase = declaredBase
    ? sourceUrl(
        attribute(declaredBase[1] ?? declaredBase[2] ?? declaredBase[3]),
        base,
      ) || base
    : base;
  const pattern =
    /<(?:img|iframe|audio|video|source|track|embed)\b[^>]*?\b(?:src|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;
  while ((match = pattern.exec(html)))
    add(attribute(match[1] ?? match[2] ?? match[3]), documentBase);
  return [...refs];
}

/** Conservative coverage inspection. Collector declarations are observations;
 * they cannot certify a whole LMS, and retained bodies need separate hashing. */
export function inspectBrightspaceCaptureEvidence(
  value: unknown,
): BrightspaceCaptureEvidence {
  const capture = object(value);
  if (
    (capture.schemaVersion != null &&
      ![1, 2].includes(Number(capture.schemaVersion))) ||
    !Array.isArray(capture.contentTree)
  )
    throw Error(
      "Supported Brightspace evidence uses schema 1 or 2 with a contentTree array.",
    );
  const nodes = inventory(capture),
    topics = nodes.filter((node) => text(node.kind).toUpperCase() === "TOPIC"),
    modules = nodes.filter(
      (node) => text(node.kind).toUpperCase() === "MODULE",
    );
  const quizzes = rows(capture.quizzes),
    bodies = object(capture.assetBodies),
    acquisition = object(capture.contentAcquisition);
  const findings: Finding[] = [];
  let omitted = 0;
  const add = (
    code: string,
    node: Model,
    detail: string,
    action = "Review the retained source evidence and capture the unresolved original if available. Do not invent content or infer that an unread source was empty.",
  ) => {
    if (findings.length >= 2000) {
      omitted++;
      return;
    }
    findings.push({
      code,
      severity: "EVIDENCE",
      itemId: text(node.id),
      itemName: text(node.title || node.name),
      path: Array.isArray(node.path)
        ? node.path.map(text).join(" > ")
        : text(node.path),
      detail,
      action,
    });
  };
  // Preserve the established first finding for legacy quiz-coverage reviews.
  for (const quiz of quizzes) {
    const questions = rows(quiz.questions),
      identities = questions.map(nativeQuestionIdentity);
    const missing = identities.filter((row) => !row.id).length,
      conflicts = identities.filter((row) => row.conflicting).length;
    const valid = identities.filter((row) => row.id).map((row) => row.id),
      duplicates = valid.length - new Set(valid).size;
    const pages = object(quiz.questionPageEvidence),
      coverage = object(quiz.questionCoverage);
    if (
      coverage.completenessVerified !== true ||
      pages.complete !== true ||
      quiz.questionsStatus !== "CAPTURED" ||
      missing ||
      conflicts ||
      duplicates
    )
      add(
        "QUIZ_DEFINITION_COVERAGE_UNVERIFIED",
        quiz,
        "Complete native question-definition coverage is unverified. Captured definitions, described exam length and the full bank are separate measurements.",
      );
    if (missing || conflicts || duplicates)
      add(
        "QUIZ_NATIVE_QUESTION_IDENTITY_UNVERIFIED",
        quiz,
        `${missing} definitions lack a native QuestionId; ${duplicates} repeated native IDs and ${conflicts} conflicting native-ID declarations were retained. Array positions are projection identities only.`,
      );
    if (
      pages.complete !== true ||
      pages.pageTraversalComplete === false ||
      pages.truncated === true ||
      pages.missingIdentities ||
      pages.duplicates ||
      pages.invalidRows
    )
      add(
        "QUIZ_PAGE_TRAVERSAL_UNVERIFIED",
        quiz,
        "Question API traversal or native identity receipts contain gaps. Matching captured counts cannot resolve them.",
      );
  }
  const ids = new Map<string, number>();
  for (const node of nodes) {
    const key = text(node.kind) + ":" + text(node.id);
    ids.set(key, (ids.get(key) || 0) + 1);
  }
  const retainedUrls = new Set(
    rows(acquisition.assets)
      .filter(
        (asset) =>
          asset.originalRef && Object.hasOwn(bodies, asset.originalRef),
      )
      .map((asset) => sourceUrl(asset.url))
      .filter(Boolean),
  );
  for (const node of nodes) {
    const kind = text(node.kind).toUpperCase(),
      ev = object(node.contentEvidence),
      structure = object(node.structureEvidence);
    if (
      !text(node.id) ||
      (ids.get(text(node.kind) + ":" + text(node.id)) || 0) > 1
    )
      add(
        "CONTENT_NATIVE_IDENTITY_UNVERIFIED",
        node,
        "Missing or repeated native content IDs remain unresolved; title or position cannot identify a different item's content.",
      );
    if (
      kind === "MODULE" &&
      (!Object.keys(structure).length ||
        structure.complete !== true ||
        structure.status !== "CAPTURED")
    )
      add(
        "MODULE_STRUCTURE_UNVERIFIED",
        node,
        "Module traversal was not independently established as complete. Inline fallback, reused references, cycles and failed reads remain explicit inventory gaps.",
      );
    if (kind === "TOPIC") {
      if (ev.status === "NON_TEXT_ASSET")
        add(
          "NON_TEXT_ASSET_BODY_NOT_RETAINED",
          node,
          "Only a binary asset pointer or headers were captured. Its original bytes were not retained.",
        );
      else if (
        !ev.rawBodyRef &&
        !ev.originalRef &&
        ev.status !== "DEFINITION_API_ONLY"
      )
        add(
          "TOPIC_ORIGINAL_BODY_NOT_RETAINED",
          node,
          "No retained original body is bound to this topic. Existing text may be a legacy projection, and does not verify files or unseen source content.",
        );
      if (!ev.rawBodyRef && text(ev.text).length >= 80000)
        add(
          "LEGACY_PAGE_TEXT_MAY_BE_CLIPPED",
          node,
          "This legacy text reaches the former 80,000-character boundary. The full original body is unavailable, so clipping cannot be ruled out.",
        );
      if (
        ev.projectionTruncated === true ||
        ev.truncated === true ||
        ev.textTruncated === true
      )
        add(
          "TOPIC_TEXT_PROJECTION_TRUNCATED",
          node,
          "The text projection is explicitly truncated. A retained raw body does not make this projection complete.",
        );
      if (
        ev.projectionStatus === "UNRESOLVED" ||
        (ev.rawBodyRef && ev.status !== "CAPTURED")
      )
        add(
          "TOPIC_TEXT_PROJECTION_UNVERIFIED",
          node,
          "Original bytes may be retained, while their decoded or rendered text projection remains unavailable or unresolved.",
        );
      if (/lti|scorm|plugin|runtime/i.test(text(node.activityTypeLabel)))
        add(
          "EXTERNAL_RUNTIME_CONTENT_UNVERIFIED",
          node,
          "An external or interactive item is declared. Configuration or page bytes do not establish its full runtime content or learner behavior.",
        );
    }
    const base = sourceUrl(
      ev.bodyReceipt?.responseUrl || ev.url || node.url,
      sourceUrl(capture.page?.url),
    );
    const missing = mediaReferences(node, base).filter(
      (url) => !retainedUrls.has(url),
    );
    if (missing.length)
      add(
        "REFERENCED_MEDIA_NOT_RETAINED",
        node,
        `${missing.length} referenced media or embedded sources have no retained original body. The configured pointers remain evidence, not fabricated replacement content.`,
      );
  }
  const receipts = object(capture.inventoryEvidence);
  for (const [name, receipt] of Object.entries(receipts)) {
    const row = object(receipt);
    if (name === "discussionTopics") {
      for (const [id, page] of Object.entries(row))
        if (object(page).complete !== true)
          add(
            "DISCUSSION_INVENTORY_UNVERIFIED",
            { id },
            "Discussion topic pagination remains incomplete or unverified.",
          );
    } else if (row.complete !== true)
      add(
        "SOURCE_INVENTORY_UNVERIFIED",
        { name },
        "The retained inventory traversal receipt contains an unresolved source or bound.",
      );
  }
  if (!Object.keys(receipts).length)
    add(
      "LEGACY_SOURCE_INVENTORY_UNVERIFIED",
      {},
      "Legacy captures do not independently establish every module, tool inventory or API page as complete.",
    );
  if (rows(capture.permissionBlocks).length)
    add(
      "BRIGHTSPACE_PERMISSION_GAPS",
      {},
      `${rows(capture.permissionBlocks).length} permission or source-access gaps were retained.`,
    );
  for (const gap of rows(acquisition.gaps))
    add(
      "SOURCE_ORIGINAL_ACQUISITION_GAP",
      gap,
      text(gap.reason || gap.status) ||
        "An original source could not be retained within the collector's access or limits.",
    );
  const warnings = [
    "Brightspace inspection preserves observed content and unresolved sources. It does not certify whole-course completeness, runtime behavior, source fidelity or publication readiness.",
    "Original-byte hashes and collector receipts establish retained-byte consistency, not server attestation or proof of the operator's login.",
    "HTML plain-text fields remain collector projections: their length and hash are checked, while original HTML is independently bound to the retained response bytes.",
  ];
  if (omitted)
    warnings.push(
      `${omitted} additional evidence findings exceed the 2,000-detail display bound; the original capture remains intact.`,
    );
  return {
    schemaVersion: 1,
    platform: "BRIGHTSPACE",
    wholeCourseComplete: false,
    completeness: "GAPS_OR_UNVERIFIED",
    originalIntegrity: Object.keys(bodies).length
      ? "NOT_CHECKED"
      : "NO_ORIGINAL_BODIES",
    counts: {
      topics: topics.length,
      modules: modules.length,
      quizzes: quizzes.length,
      questionDefinitions: quizzes.reduce(
        (sum, quiz) => sum + rows(quiz.questions).length,
        0,
      ),
      retainedOriginals: Object.keys(bodies).length,
      retainedOriginalBytes: 0,
    },
    findings,
    warnings,
  };
}

function assertReceipt(
  value: unknown,
  body: Model,
  label: string,
  captureOrigin: string,
  courseId: string,
) {
  const receipt = object(value),
    request = sourceUrl(receipt.requestUrl),
    response = sourceUrl(receipt.responseUrl);
  if (
    !request ||
    !response ||
    receipt.status !== 200 ||
    receipt.complete !== true ||
    receipt.bytes !== body.bytes ||
    receipt.sha256 !== body.sha256 ||
    new URL(request).origin !== captureOrigin ||
    new URL(response).origin !== captureOrigin ||
    typeof receipt.observedAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.observedAt))
  )
    throw Error(`Brightspace ${label} has an invalid original-body receipt.`);
  const dwg = [request, response].some((url) =>
    /\.dwg$/i.test(decodeURIComponent(new URL(url).pathname)),
  );
  if (
    dwg &&
    (!approvedDwgSource(request, courseId) ||
      !approvedDwgSource(response, courseId) ||
      !approvedDwgMime(receipt.contentType) ||
      !Number.isSafeInteger(receipt.declaredBodyBytes) ||
      receipt.declaredBodyBytes <= 0 ||
      receipt.declaredBodyBytes !== body.bytes ||
      receipt.contentRange !== null ||
      receipt.contentEncoding !== "identity")
  )
    throw Error(
      `Brightspace ${label} has an unsupported DWG original-body scope or receipt.`,
    );
  if (
    request !== response &&
    (receipt.redirectPolicy !== "SAME_ORIGIN_STATIC_CONTENT" ||
      receipt.mode !== "same-origin" ||
      receipt.sourceResponseRedirected !== true ||
      !approvedStaticSource(request, true, courseId) ||
      !approvedStaticSource(response, false, courseId))
  )
    throw Error(
      `Brightspace ${label} has an unsupported original-body redirect.`,
    );
  return { request, response, dwg };
}

function prepareBrightspaceCaptureIntegrity(value: unknown) {
  const capture = object(value),
    report = inspectBrightspaceCaptureEvidence(capture),
    bodies = object(capture.assetBodies),
    nodes = inventory(capture);
  const pageUrl = sourceUrl(capture.page?.url),
    captureOrigin = pageUrl ? new URL(pageUrl).origin : "",
    courseId = text(capture.course?.orgUnitId);
  if (Object.keys(bodies).length && !captureOrigin)
    throw Error(
      "Brightspace retained originals require the captured source-page origin.",
    );
  if (Object.keys(bodies).length > 10000)
    throw Error(
      "Brightspace original-body inventory exceeds its 10,000-body bound.",
    );
  const textRefs = new Map<string, Model[]>(),
    referenced = new Set<string>(),
    dwgRefs = new Set<string>();
  let projections = 0;
  const bind = (ref: unknown, label: string) => {
    if (
      typeof ref !== "string" ||
      !hashPattern.test(ref) ||
      !Object.hasOwn(bodies, ref)
    )
      throw Error(`Brightspace ${label} references a missing original body.`);
    referenced.add(ref);
    return object(bodies[ref]);
  };
  for (const node of nodes) {
    const ev = object(node.contentEvidence),
      ref = ev.rawBodyRef || ev.originalRef;
    if (!ref) continue;
    const body = bind(ref, "topic");
    const receipt = assertReceipt(
      ev.bodyReceipt,
      body,
      "topic",
      captureOrigin,
      courseId,
    );
    if (receipt.dwg) dwgRefs.add(ref);
    const target = sourceUrl(ev.url || node.url, sourceUrl(capture.page?.url));
    if (
      ev.url &&
      node.url &&
      sourceUrl(ev.url, pageUrl) !== sourceUrl(node.url, pageUrl)
    )
      throw Error(
        "Brightspace topic content URL differs from its native item URL.",
      );
    if (target && target !== receipt.request)
      throw Error(
        "Brightspace topic original-body receipt belongs to a different source URL.",
      );
    if (
      ev.rawBodyRef &&
      ev.status === "CAPTURED" &&
      ev.projectionStatus !== "UNRESOLVED"
    ) {
      if (
        !["html", "text", "srt", "vtt"].includes(ev.format) ||
        typeof ev.text !== "string" ||
        ev.textLength !== ev.text.length ||
        ev.textSha256 !== digest(ev.text)
      )
        throw Error(
          "Brightspace retained text projection hash, length or format is inconsistent.",
        );
      projections +=
        encoder.encode(ev.text).byteLength +
        encoder.encode(text(ev.html)).byteLength;
      if (body.bytes > MAX_TEXT_BYTES || projections > MAX_PROJECTION_BYTES)
        throw Error(
          "Brightspace retained text exceeds its original or cumulative projection bound.",
        );
      textRefs.set(ref, [...(textRefs.get(ref) || []), ev]);
    }
  }
  for (const asset of rows(capture.contentAcquisition?.assets)) {
    if (!asset.originalRef) continue;
    const body = bind(asset.originalRef, "asset");
    const receipt = assertReceipt(
      asset.receipt,
      body,
      "asset",
      captureOrigin,
      courseId,
    );
    if (receipt.dwg) dwgRefs.add(asset.originalRef);
    if (
      sourceUrl(asset.url) !== receipt.request ||
      asset.bytes !== body.bytes ||
      asset.sha256 !== body.sha256
    )
      throw Error(
        "Brightspace asset original-body identity or declared length is inconsistent.",
      );
    if (
      !rows(asset.sourceBindings).length ||
      rows(asset.sourceBindings).some(
        (binding) =>
          ![
            "TOPIC",
            "MODULE",
            "QUIZ",
            "ASSIGNMENT",
            "DISCUSSION",
            "DISCUSSION_TOPIC",
          ].includes(binding.kind) ||
          !text(binding.id) ||
          (binding.kind === "DISCUSSION_TOPIC" && !text(binding.parentId)),
      )
    )
      throw Error(
        "Brightspace retained asset lacks an explicit native source binding.",
      );
    for (const binding of rows(asset.sourceBindings)) {
      const candidates = bindingSources(
        capture,
        nodes,
        binding.kind,
        text(binding.id),
        text(binding.parentId),
      );
      if (candidates.length !== 1)
        throw Error(
          "Brightspace original asset references an absent or ambiguous native source in its inventory.",
        );
      if (
        !candidates.some((node) =>
          boundUrls(node, pageUrl, binding.kind).has(receipt.request),
        )
      )
        throw Error(
          "Brightspace original asset URL is not referenced by its declared native source.",
        );
    }
  }
  const archive = usesArchiveBodies(capture);
  return {
    capture,
    report,
    bodies,
    textRefs,
    referenced,
    dwgRefs,
    archive,
    bodyMedia: archive
      ? archiveBodyMedia(capture, nodes)
      : new Map<string, string[]>(),
  };
}

function assertOriginalProjection(
  key: string,
  textRefs: Map<string, Model[]>,
  decoded: Map<string, string>,
) {
  for (const ev of textRefs.get(key) || []) {
    const original = decoded.get(text(ev.charset || "utf-8").toLowerCase());
    if (
      original === undefined ||
      (ev.format === "html"
        ? typeof ev.html !== "string" || ev.html !== original
        : ev.text !== original)
    )
      throw Error(
        "Brightspace retained HTML or plain text differs from its original UTF-8 body.",
      );
  }
}

/** Validate legacy base64 in small chunks, or recheck independently verified
 * immutable archive Blobs. Archive descriptors alone never establish bytes. */
export function assertBrightspaceCaptureIntegrity(
  value: unknown,
): BrightspaceCaptureEvidence {
  const { report, bodies, textRefs, referenced, dwgRefs, archive, bodyMedia } =
    prepareBrightspaceCaptureIntegrity(value);
  let total = 0;
  for (const [key, input] of Object.entries(bodies)) {
    const body = object(input),
      base64 = body.base64;
    if (archive) {
      archiveBodyDescriptor(key, body);
      total += body.bytes;
      if (total > MAX_BRIGHTSPACE_ARCHIVE_ORIGINAL_BYTES)
        throw Error(
          "Brightspace archive originals exceed the independent 512 MiB bound.",
        );
      if (!referenced.has(key))
        throw Error(
          "Brightspace original body has no retained source reference.",
        );
      const proof = verifiedArchiveBodies.get(body);
      if (
        !proof ||
        proof.sha256 !== key ||
        proof.size !== body.bytes ||
        proof.blob.size !== body.bytes
      )
        throw Error(
          "Brightspace archive originals require independently verified original Blob bodies.",
        );
      const mimes = bodyMedia.get(key) || [];
      if (
        mimes.some((mime) =>
          /^(?:text\/|application\/(?:xhtml\+xml|json|x-subrip))/.test(mime),
        ) &&
        body.bytes > MAX_TEXT_BYTES
      )
        throw Error(
          "Brightspace archive text original exceeds its independent 4 MiB bound.",
        );
      assertArchiveSignature(mimes, proof.prefix);
      if (dwgRefs.has(key))
        assertDwgOriginalSignature(proof.prefix, body.bytes);
      assertOriginalProjection(key, textRefs, proof.text);
      continue;
    }
    if (
      !hashPattern.test(key) ||
      body.sha256 !== key ||
      body.encoding !== "base64" ||
      !Number.isSafeInteger(body.bytes) ||
      body.bytes < 0 ||
      body.bytes > MAX_BODY_BYTES ||
      typeof base64 !== "string" ||
      base64.length !== 4 * Math.ceil(body.bytes / 3) ||
      /[^A-Za-z0-9+/=]/.test(base64) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    )
      throw Error(
        "Brightspace retained original has invalid base64, SHA-256 or byte-length metadata.",
      );
    total += body.bytes;
    if (total > MAX_BRIGHTSPACE_ORIGINAL_BYTES)
      throw Error(
        "Brightspace retained originals exceed the independent 64 MiB bound.",
      );
    if (!referenced.has(key))
      throw Error(
        "Brightspace original body has no retained source reference.",
      );
    const hash = sha256.create(),
      decoders = new Map<string, { decoder: TextDecoder; text: string }>();
    for (const ev of textRefs.get(key) || []) {
      const charset = text(ev.charset || "utf-8").toLowerCase();
      if (!decoders.has(charset))
        decoders.set(charset, {
          decoder: new TextDecoder(charset, { fatal: true, ignoreBOM: true }),
          text: "",
        });
    }
    let length = 0,
      first = new Uint8Array();
    for (let start = 0; start < base64.length; start += 65536) {
      const encoded = base64.slice(start, start + 65536);
      let binary: string;
      try {
        binary = atob(encoded);
      } catch {
        throw Error("Brightspace retained original base64 cannot be decoded.");
      }
      if (start + encoded.length === base64.length && btoa(binary) !== encoded)
        throw Error("Brightspace retained original base64 is not canonical.");
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      if (!start) first = bytes.subarray(0, 128);
      length += bytes.length;
      hash.update(bytes);
      for (const projection of decoders.values())
        projection.text += projection.decoder.decode(bytes, { stream: true });
    }
    for (const projection of decoders.values())
      projection.text += projection.decoder.decode();
    if (length !== body.bytes || bytesToHex(hash.digest()) !== key)
      throw Error(
        "Brightspace retained original SHA-256 or actual byte length does not match.",
      );
    if (dwgRefs.has(key)) assertDwgOriginalSignature(first, body.bytes);
    assertOriginalProjection(
      key,
      textRefs,
      new Map([...decoders].map(([charset, value]) => [charset, value.text])),
    );
  }
  report.originalIntegrity = Object.keys(bodies).length
    ? "VERIFIED_RETAINED_ORIGINALS"
    : "NO_ORIGINAL_BODIES";
  report.counts.retainedOriginalBytes = total;
  return report;
}
export async function verifyBrightspaceCaptureEvidence(value: unknown) {
  return assertBrightspaceCaptureIntegrity(value);
}

function archiveBodyMedia(capture: Model, nodes: Model[]) {
  const result = new Map<string, string[]>();
  const category = (mime: string) =>
    ({
      "image/jpg": "image/jpeg",
      "application/x-pdf": "application/pdf",
      "application/x-zip-compressed": "application/zip",
      "text/srt": "application/x-subrip",
    })[mime] || mime;
  const addReceipt = (ref: unknown, ...values: unknown[]) => {
    if (typeof ref !== "string") return;
    const declarations: string[] = [];
    for (const value of values) {
      if (value == null || value === "") continue;
      if (
        typeof value !== "string" ||
        value.length > 1024 ||
        /[\r\n\0]/.test(value) ||
        !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;[^\r\n\0]*)?$/.test(
          value.trim(),
        )
      )
        throw Error(
          "Brightspace archive original has an invalid declared MIME type.",
        );
      const mime = value.split(";", 1)[0].trim().toLowerCase();
      if (!["application/octet-stream", "binary/octet-stream"].includes(mime))
        declarations.push(mime);
    }
    if (new Set(declarations.map(category)).size > 1)
      throw Error(
        "Brightspace archive original has contradictory native MIME declarations.",
      );
    // Identical bytes can be served by separate native URLs with different
    // headers. Each individual receipt must remain internally consistent.
    result.set(ref, [
      ...new Set([...(result.get(ref) || []), ...declarations]),
    ]);
  };
  for (const node of nodes) {
    const ev = object(node.contentEvidence);
    addReceipt(
      ev.rawBodyRef || ev.originalRef,
      ev.contentType,
      ev.bodyReceipt?.contentType,
    );
  }
  for (const asset of rows(capture.contentAcquisition?.assets))
    addReceipt(asset.originalRef, asset.mediaType, asset.receipt?.contentType);
  return result;
}

function assertArchiveSignature(mimes: string[], bytes: Uint8Array) {
  const ascii = (at: number, value: string) =>
    [...value].every((char, index) => bytes[at + index] === char.charCodeAt(0));
  const prefix = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  for (const mime of mimes) {
    let valid = true;
    if (mime === "image/png") valid = prefix(137, 80, 78, 71, 13, 10, 26, 10);
    else if (["image/jpeg", "image/jpg"].includes(mime))
      valid = prefix(255, 216, 255);
    else if (mime === "image/gif")
      valid = ascii(0, "GIF87a") || ascii(0, "GIF89a");
    else if (mime === "image/webp")
      valid = ascii(0, "RIFF") && ascii(8, "WEBP");
    else if (["application/pdf", "application/x-pdf"].includes(mime))
      valid = ascii(0, "%PDF-");
    else if (
      /^(?:application\/(?:zip|x-zip-compressed|vnd\.openxmlformats-officedocument\..+))$/.test(
        mime,
      )
    )
      valid =
        prefix(80, 75, 3, 4) || prefix(80, 75, 5, 6) || prefix(80, 75, 7, 8);
    else if (["video/mp4", "audio/mp4"].includes(mime))
      valid = ascii(4, "ftyp");
    else if (["video/webm", "audio/webm"].includes(mime))
      valid = prefix(0x1a, 0x45, 0xdf, 0xa3);
    else if (["audio/wav", "audio/x-wav"].includes(mime))
      valid = ascii(0, "RIFF") && ascii(8, "WAVE");
    if (!valid)
      throw Error(
        "Brightspace archive original bytes contradict their declared MIME signature.",
      );
  }
}

/** Recognize the narrow supported native-file header without interpreting CAD. */
function assertDwgOriginalSignature(bytes: Uint8Array, size: number) {
  if (
    size < 128 ||
    !/^AC(?:1015|1018|1021|1024|1027|1032)$/.test(
      String.fromCharCode(...bytes.subarray(0, 6)),
    ) ||
    !bytes.subarray(6, 11).every((byte) => byte === 0)
  )
    throw Error(
      "Brightspace DWG original bytes have an unsupported file signature.",
    );
}

/** Independently verify one immutable Blob at a time. This is also the worker
 * reattachment boundary: a structured clone does not carry trusted proof. */
export async function attachBrightspaceArchiveFileBlobs(
  value: unknown,
  archiveFiles: BrightspaceArchiveFile[],
): Promise<unknown> {
  const { capture, bodies, textRefs, referenced, dwgRefs, archive, bodyMedia } =
    prepareBrightspaceCaptureIntegrity(value);
  if (!archive || !Array.isArray(archiveFiles))
    throw Error(
      "Brightspace archive original-body transport or Blob inventory is missing.",
    );
  const files = new Map<string, BrightspaceArchiveFile>();
  let total = 0;
  for (const file of archiveFiles) {
    if (
      !file ||
      !hashPattern.test(file.sha256) ||
      file.path !== "files/" + file.sha256 ||
      files.has(file.path) ||
      !(file.blob instanceof Blob) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_BRIGHTSPACE_ARCHIVE_FILE_BYTES ||
      file.blob.size !== file.size
    )
      throw Error(
        "Brightspace archive has an invalid or duplicate original Blob descriptor.",
      );
    total += file.size;
    if (total > MAX_BRIGHTSPACE_ARCHIVE_ORIGINAL_BYTES)
      throw Error(
        "Brightspace archive originals exceed the independent 512 MiB bound.",
      );
    // Normalize away arbitrary Blob subclasses before retaining a resolver.
    // This preserves immutable backing bytes without materializing a buffer.
    const blob = new Blob([file.blob]);
    if (blob.size !== file.size)
      throw Error(
        "Brightspace archive original Blob size differs from its descriptor.",
      );
    files.set(file.path, { ...file, blob });
  }
  if (files.size !== Object.keys(bodies).length)
    throw Error(
      "Brightspace archive original file inventory differs from its native body inventory.",
    );
  for (const [key, input] of Object.entries(bodies)) {
    const body = object(input);
    archiveBodyDescriptor(key, body);
    const file = files.get(body.archivePath);
    if (
      !file ||
      file.sha256 !== key ||
      file.size !== body.bytes ||
      !referenced.has(key)
    )
      throw Error(
        "Brightspace archive original is absent, unreferenced or differs from its body receipt.",
      );
    const mimes = bodyMedia.get(key) || [];
    if (
      mimes.some((mime) =>
        /^(?:text\/|application\/(?:xhtml\+xml|json|x-subrip))/.test(mime),
      ) &&
      body.bytes > MAX_TEXT_BYTES
    )
      throw Error(
        "Brightspace archive text original exceeds its independent 4 MiB bound.",
      );
    const decoders = new Map<string, { decoder: TextDecoder; text: string }>();
    for (const ev of textRefs.get(key) || []) {
      const charset = text(ev.charset || "utf-8").toLowerCase();
      if (!decoders.has(charset))
        decoders.set(charset, {
          decoder: new TextDecoder(charset, { fatal: true, ignoreBOM: true }),
          text: "",
        });
    }
    const hasher = sha256.create();
    let first = new Uint8Array(),
      length = 0;
    for (let start = 0; start < file.size; start += 1024 * 1024) {
      const chunk = new Uint8Array(
        await file.blob
          .slice(start, Math.min(file.size, start + 1024 * 1024))
          .arrayBuffer(),
      );
      if (chunk.length !== Math.min(1024 * 1024, file.size - start))
        throw Error(
          "Brightspace archive original Blob could not be read completely.",
        );
      if (!start) first = chunk.subarray(0, 512);
      length += chunk.length;
      hasher.update(chunk);
      for (const decoder of decoders.values())
        decoder.text += decoder.decoder.decode(chunk, { stream: true });
    }
    if (length !== file.size || bytesToHex(hasher.digest()) !== key)
      throw Error(
        "Brightspace archive original SHA-256 or byte length does not match.",
      );
    for (const decoder of decoders.values())
      decoder.text += decoder.decoder.decode();
    assertArchiveSignature(mimes, first);
    if (dwgRefs.has(key)) assertDwgOriginalSignature(first, file.size);
    const decoded = new Map(
      [...decoders].map(([charset, projection]) => [charset, projection.text]),
    );
    assertOriginalProjection(key, textRefs, decoded);
    verifiedArchiveBodies.set(body, {
      blob: file.blob,
      sha256: key,
      size: file.size,
      text: decoded,
      prefix: first.slice(),
    });
  }
  assertBrightspaceCaptureIntegrity(capture);
  return capture;
}
