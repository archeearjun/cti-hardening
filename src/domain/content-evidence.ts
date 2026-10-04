import { safeWebUrl, courseraItemUrl } from "./owner-urls.ts";
import { qaObservedEmptyAssessmentReceipt_ } from "../engine/assessment/assignment.js";
import {
  qaBrightspaceFlattenTopics_,
  qaBrightspaceQuizToAssessment_,
  qaBrightspaceText_,
} from "../engine/source/brightspace-assessment.js";

type Obj = Record<string, unknown>;
export const contentObject = (v: unknown): Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const string = (v: unknown): string => (typeof v === "string" ? v : "");
const integer = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
export type ContentCoverage = "COMPLETE" | "PARTIAL" | "UNVERIFIED" | "EMPTY";
export interface ContentQuestion {
  id: string;
  ordinal: string;
  type: string;
  prompt: string;
  options: { id: string; text: string }[];
  answers: string[];
  feedback: string;
  media: string[];
  limitations: string[];
}
export interface ContentEvidence {
  basis: string;
  capturedAt: string;
  url: string;
  text: string;
  textCoverage: ContentCoverage;
  textReason: string;
  questions: ContentQuestion[];
  questionCoverage: ContentCoverage;
  expectedQuestions: number | null;
  questionReason: string;
  references: string[];
  limitations: string[];
}
export interface ContentItem {
  id: string;
  name: string;
  path: string;
  content: ContentEvidence;
}
export interface ContentSnapshot {
  schemaVersion: 1;
  coursera: ContentItem[];
  brightspace: ContentItem[];
}
export function validateContentSnapshot(
  value: unknown,
): asserts value is ContentSnapshot {
  const s = contentObject(value),
    states = ["COMPLETE", "PARTIAL", "UNVERIFIED", "EMPTY"];
  if (
    s.schemaVersion !== 1 ||
    !Array.isArray(s.coursera) ||
    !Array.isArray(s.brightspace)
  )
    throw Error("Invalid saved content snapshot.");
  for (const list of [s.coursera, s.brightspace]) {
    if (list.length > 20000)
      throw Error("Content snapshot exceeds the item limit.");
    for (const entry of list) {
      const item = contentObject(entry),
        c = contentObject(item.content);
      if (
        ![
          item.id,
          item.name,
          item.path,
          c.basis,
          c.capturedAt,
          c.url,
          c.text,
          c.textReason,
          c.questionReason,
        ].every((v) => typeof v === "string") ||
        string(c.text).length > 300000 ||
        !states.includes(string(c.textCoverage)) ||
        !states.includes(string(c.questionCoverage)) ||
        !(
          c.expectedQuestions === null || integer(c.expectedQuestions) !== null
        ) ||
        !Array.isArray(c.questions) ||
        c.questions.length > 5000 ||
        ![c.references, c.limitations].every(
          (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
        )
      )
        throw Error("Invalid saved content evidence.");
      if (
        (c.questionCoverage === "COMPLETE" &&
          c.expectedQuestions !== c.questions.length) ||
        (c.questionCoverage === "EMPTY" && c.questions.length)
      )
        throw Error("Content count contradicts its coverage label.");
      for (const value of c.questions) {
        const q = contentObject(value);
        if (
          ![q.id, q.ordinal, q.type, q.prompt, q.feedback].every(
            (v) => typeof v === "string",
          ) ||
          string(q.prompt).length > 100000 ||
          !Array.isArray(q.options) ||
          q.options.length > 200 ||
          q.options.some(
            (v) =>
              typeof contentObject(v).id !== "string" ||
              typeof contentObject(v).text !== "string",
          ) ||
          ![q.answers, q.media, q.limitations].every(
            (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
          )
        )
          throw Error("Invalid saved question evidence.");
      }
    }
  }
}
/** Text is always rendered as text, never injected as HTML. Keep the complete
 * retained field up to an explicit safety bound; expose any additional cut. */
export function contentText(value: unknown): string {
  return string(value)
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?:p|div|br|li|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi,
      (all, entity: string) => {
        const named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        };
        if (entity[0] !== "#") return named[entity.toLowerCase()] ?? all;
        const n =
          entity[1].toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : all;
      },
    )
    .trim();
}
function question(value: unknown, index: number): ContentQuestion {
  const q = contentObject(value),
    limitations: string[] = [];
  const full = contentText(q.prompt),
    options = array(q.options);
  if (!full)
    limitations.push(
      "Question prompt not captured; this position is not an empty question.",
    );
  if (full.length > 100000 || q.promptTruncated === true)
    limitations.push("Prompt is truncated.");
  if (q.optionTextReliable === false)
    limitations.push("Choice text coverage is unverified.");
  if (q.mediaTruncated === true)
    limitations.push("Media reference capture is incomplete.");
  if (q.answerTextReliable !== true)
    limitations.push("Answer-key coverage is unverified or not applicable.");
  if (options.length > 200)
    limitations.push("Only the first 200 captured choices are displayed.");
  return {
    id: string(q.courseraQuestionId) || String(q.id ?? index + 1),
    ordinal: String(
      q._cycleOrdinal ?? q.questionNumber ?? q.ordinal ?? index + 1,
    ),
    type:
      string(q.rawType) ||
      string(q.type) ||
      string(q.library) ||
      "Type unverified",
    prompt: full.slice(0, 100000),
    options: options.slice(0, 200).map((v, i) => {
      const o = contentObject(v);
      const t = contentText(
        typeof v === "string" ? v : (o.text ?? o.label ?? o.description),
      );
      if (t.length > 100000) limitations.push("Choice text is truncated.");
      return { id: String(o.id ?? i + 1), text: t.slice(0, 100000) };
    }),
    answers: array(q.correctAnswers)
      .map((v) =>
        contentText(
          typeof v === "string"
            ? v
            : typeof v === "number" || typeof v === "boolean"
              ? String(v)
              : contentObject(v).text,
        ),
      )
      .filter(Boolean),
    feedback: contentText(q.feedback),
    media: [
      ...new Set(
        [...array(q.mediaRefs), ...array(q.images)]
          .map((v) =>
            typeof v === "string" ? v : string(contentObject(v).url),
          )
          .filter(Boolean),
      ),
    ],
    limitations,
  };
}
export function capturedContent(
  payload: unknown,
  options: {
    basis: string;
    capturedAt?: string;
    url?: string;
    itemId?: string;
    source?: boolean;
    excerpt?: boolean;
    editorObserved?: boolean;
  },
): ContentEvidence {
  const p = contentObject(payload),
    a = contentObject(p.structuredAssessment),
    c = contentObject(a.captureCompleteness),
    d = contentObject(a.definitionCoverage);
  const raw = array(a.questions),
    questions = raw.slice(0, 5000).map(question);
  const limitations: string[] = [];
  if (raw.length > 5000)
    limitations.push(
      "Only the first 5,000 captured question positions are displayed.",
    );
  const expected =
    options.source && Object.hasOwn(d, "observedDeclaredQuestionCount")
      ? integer(d.observedDeclaredQuestionCount)
      : (integer(c.declared) ?? integer(a.declaredQuestionCount));
  const uniqueQuestions =
    new Set(questions.map((q) => q.id)).size === questions.length;
  if (!uniqueQuestions)
    limitations.push(
      "Duplicate question identities were captured. All records are retained; completeness is unverified.",
    );
  const explicitEmpty =
    options.editorObserved !== false &&
    !questions.length &&
    qaObservedEmptyAssessmentReceipt_({
      ...p,
      id: options.itemId,
      type: "Assignment",
    });
  const complete =
    uniqueQuestions &&
    raw.length <= 5000 &&
    expected === questions.length &&
    (options.source
      ? d.completenessVerified === true
      : c.questionCoverageComplete === true) &&
    options.editorObserved !== false;
  const questionCoverage: ContentCoverage = explicitEmpty
    ? "EMPTY"
    : complete
      ? questions.length
        ? "COMPLETE"
        : "EMPTY"
      : questions.length
        ? "PARTIAL"
        : "UNVERIFIED";
  const full = string(p.textSample ?? p.text),
    receipt = contentObject(p.textCaptureEvidence);
  const truncated =
    p.textCaptureTruncated === true ||
    p.evidenceTruncated === true ||
    p.textTruncated === true ||
    receipt.truncated === true ||
    full.length > 300000 ||
    (integer(p.fullObservedTextLength) ??
      integer(p.textLength) ??
      full.length) > full.length;
  const exact =
    receipt.method === "EXACT_READING_FIELD" &&
    receipt.itemId === options.itemId &&
    receipt.capturedCharacters === full.length &&
    receipt.observedCharacters === full.length &&
    receipt.truncated === false;
  const sourceFull =
    options.source &&
    p.evidenceTruncated === false &&
    integer(p.textLength) === full.length &&
    p.textNormalizationStatus === "NORMALIZED";
  const textCoverage: ContentCoverage = full
    ? !options.excerpt &&
      !truncated &&
      options.editorObserved !== false &&
      (exact || sourceFull)
      ? "COMPLETE"
      : "PARTIAL"
    : exact && !truncated
      ? "EMPTY"
      : "UNVERIFIED";
  const references = [
    ...new Set(
      [
        ...array(p.links),
        ...array(p.embeddedRefs),
        ...array(contentObject(p.readingEditorEvidence).frames).map(
          (v) => contentObject(v).url,
        ),
        ...array(p.images),
        ...array(p.files).map((v) =>
          typeof v === "string" ? v : contentObject(v).path,
        ),
      ].filter((v): v is string => typeof v === "string"),
    ),
  ];
  const unreadFrames = array(
    contentObject(p.readingEditorEvidence).frames,
  ).filter((v) => contentObject(v).documentStatus === "NOT_READABLE").length;
  if (unreadFrames)
    limitations.push(
      `${unreadFrames} embedded page(s) could not be read inside Coursera. An empty editor text field does not establish an empty lesson. Recorded public links can be fetched separately; course loading remains unverified.`,
    );
  if (references.length || questions.some((q) => q.media.length))
    limitations.push(
      "References are listed; linked files, images, embedded screens and learner interactions are not verified by the text view.",
    );
  return {
    basis: options.basis,
    capturedAt: options.capturedAt || "",
    url: safeWebUrl(options.url),
    text: full.slice(0, 300000),
    textCoverage,
    textReason: options.excerpt
      ? "Only an excerpt was retained in this older report. Import its original extraction or capture this item again."
      : truncated
        ? "The capture or display limit cut this text. All retained text is shown."
        : textCoverage === "COMPLETE"
          ? "Complete captured text field; external resources are separate."
          : full
            ? "Captured text is shown in full, but whole-field coverage was not established."
            : textCoverage === "EMPTY"
              ? unreadFrames
                ? "The editor text field was empty, but embedded page content could not be read. The lesson is not confirmed empty."
                : "The exact text field was observed empty."
              : "Text was not captured. This does not establish an empty source or destination.",
    questions,
    questionCoverage,
    expectedQuestions: explicitEmpty ? 0 : expected,
    questionReason: explicitEmpty
      ? "Confirmed empty editor in the saved observation."
      : complete
        ? "All declared question positions captured. Prompt, choice, answer and media fidelity require separate evidence."
        : questions.length
          ? "These captured question positions are available; total coverage remains incomplete or unverified."
          : "No question definitions captured; absence from this evidence is not proof that questions are absent.",
    references,
    limitations,
  };
}
function parse(bytes?: Uint8Array): Obj {
  return bytes
    ? contentObject(JSON.parse(new TextDecoder().decode(bytes)))
    : {};
}
/** Called only after the comparison's input validation, or with a file whose
 * SHA-256 exactly matches the original report. No title-based course joining. */
export function buildContentSnapshot(
  courseraBytes?: Uint8Array,
  brightspaceBytes?: Uint8Array,
): ContentSnapshot {
  const raw = parse(courseraBytes),
    bs = parse(brightspaceBytes);
  const fingerprints = array(raw.fingerprints),
    topics = qaBrightspaceFlattenTopics_(array(bs.contentTree));
  const coursera: ContentItem[] = fingerprints.map((v) => {
    const f = contentObject(v);
    return {
      id: String(f.id ?? ""),
      name: string(f.name),
      path: string(f.path),
      content: capturedContent(f.payload, {
        basis: "Original Coursera extraction",
        capturedAt: string(raw.extractedAt),
        url:
          courseraItemUrl(
            {
              stats: {
                extractorMeta: { ...contentObject(raw.meta), page: raw.page },
              },
            },
            String(f.id ?? ""),
            "",
            f,
          ) || string(contentObject(raw.page).url),
        itemId: String(f.id ?? ""),
      }),
    };
  });
  const brightspace: ContentItem[] = topics.map((topic: Obj) => {
    const ce = contentObject(topic.contentEvidence),
      quizzes = array(bs.quizzes).filter(
        (v) => String(contentObject(v).id) === String(topic.toolItemId),
      );
    const quiz = contentObject(quizzes[0]);
    const verifiedEmpty =
      Array.isArray(quiz.questions) &&
      !quiz.questions.length &&
      contentObject(quiz.questionCoverage).completenessVerified === true &&
      contentObject(quiz.questionPageEvidence).complete === true &&
      quiz.questionsStatus === "CAPTURED" &&
      quiz.questionCount === 0;
    const assessment =
      topic.toolItemId != null && quizzes.length === 1
        ? verifiedEmpty
          ? {
              questions: [],
              declaredQuestionCount: 0,
              definitionCoverage: {
                completenessVerified: true,
                observedDeclaredQuestionCount: 0,
              },
            }
          : qaBrightspaceQuizToAssessment_(quizzes[0])
        : undefined;
    const text = string(ce.text) || qaBrightspaceText_(topic.description);
    return {
      id: String(topic.id),
      name: string(topic.title),
      path: string(topic.path),
      content: capturedContent(
        {
          textSample: text,
          textTruncated: ce.textTruncated,
          structuredAssessment: assessment,
          links: array(ce.links).map((v) =>
            typeof v === "string" ? v : contentObject(v).href,
          ),
          images: array(ce.images).map((v) =>
            typeof v === "string" ? v : contentObject(v).url,
          ),
          embeddedRefs: array(ce.embeds).map((v) => contentObject(v).url),
        },
        {
          basis: "Original Brightspace extraction",
          capturedAt: string(bs.capturedAt),
          source: true,
          url: string(topic.url),
        },
      ),
    };
  });
  return { schemaVersion: 1, coursera, brightspace };
}
export function contentEvidenceText(content: ContentEvidence): string {
  const out = [
    `${content.basis} | ${content.capturedAt || "Capture time unrecorded"}`,
    `Text: ${content.textCoverage} — ${content.textReason}`,
    content.text,
    `Questions: ${content.questionCoverage} | ${content.questions.length} captured / ${content.expectedQuestions ?? "unknown"} expected — ${content.questionReason}`,
  ];
  for (const q of content.questions)
    out.push(
      `Question ${q.ordinal} [${q.type}]`,
      q.prompt || "[Prompt not captured]",
      ...q.options.map(
        (o) => `  ${o.id}: ${o.text || "[Choice text not captured]"}`,
      ),
      ...q.answers.map((a) => `  Captured answer evidence: ${a}`),
      ...(q.feedback ? [`  Feedback: ${q.feedback}`] : []),
      ...q.media.map((m) => `  Media reference: ${m}`),
      ...q.limitations.map((l) => `  ${l}`),
    );
  out.push(
    ...content.references.map((r) => `Reference: ${r}`),
    ...content.limitations,
  );
  return out.filter(Boolean).join("\n");
}
