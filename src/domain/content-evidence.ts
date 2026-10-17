import { safeWebUrl, courseraItemUrl } from "./owner-urls.ts";
import { supportedMathText } from "./supported-math-text.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { directCmlMediaInventoryV1 } from "../extractors/coursera/direct-data-media-contracts.js";
import { bindDirectAuthoringDraftV1 } from "../extractors/coursera/direct-data-models.js";
import { directWidgetEvidenceValidV1 } from "../extractors/coursera/direct-data-contracts.js";
import { directWidgetProviderSourceV1 } from "../extractors/coursera/direct-data-widget.js";
import { directPanoptoEvidenceStructureV1 } from "../extractors/coursera/direct-data-panopto-contracts.js";
import {
  directPanoptoSourceV1,
  directPanoptoProjectionV1,
} from "../extractors/coursera/direct-data-panopto.js";
import { workerXml } from "../adapters/worker-xml.ts";
import { assertBrightspaceCaptureIntegrity } from "./brightspace-capture-evidence.ts";
import {
  capturedTime,
  validateTimeEstimate,
  type TimeEstimate,
} from "./owner-time.ts";
import { choiceLabel, ctiAnswerText } from "./cti-answer-check.ts";
import { qaObservedEmptyAssessmentReceipt_ } from "../engine/assessment/assignment.js";
import { observeDirectNativeGrading } from "../engine/assessment/native-grading.js";
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
  options: { id: string; text: string; feedback?: string }[];
  answers: string[];
  feedback: string;
  media: string[];
  limitations: string[];
  settingsText?: string;
  answerCoverage?: "CAPTURED" | "NONE_AUTHORED" | "UNVERIFIED";
  feedbackCoverage?: "CAPTURED" | "NONE_AUTHORED" | "UNVERIFIED";
  answerKeyReliable?: boolean;
  mathTextChecked?: boolean;
}
export interface BrightspaceSourceBody {
  platform: "BRIGHTSPACE";
  topicId: string;
  status: string;
  format: string;
  contentType: string;
  observedAt: string;
  bytes: number | null;
  sha256: string;
  originalRef: string;
  originalIntegrity: "VERIFIED_RETAINED_ORIGINAL" | "UNVERIFIED";
  textScope: "ORIGINAL_BODY" | "DESCRIPTION_FALLBACK" | "NO_TEXT";
  descriptionText: string;
  descriptionTruncated: boolean;
  reason: string;
  projectionStatus: string;
  projectionReason: string;
  references: {
    url: string;
    rawUrl: string;
    tag: string;
    attribute: string;
    status: string;
    reason: string;
    originalRef: string;
    alt: string;
    text: string;
  }[];
}
export interface CapturedNativeGrading {
  method: "BOUND_AUTHORING_DRAFT_API";
  courseId: string;
  itemId: string;
  atomId: string;
  contentId: string;
  draftHash: string;
  storedAtomVersion: number;
  updatedAt: number;
  sourceState: "AUTHORING_DRAFT";
  stableSource: true;
  scope: "GRADING_SETTING_ONLY";
  field: "draft.content.definition.configuration.isGraded";
  graded: boolean;
  observedAt?: string;
}
export interface ContentEvidence {
  timeEstimate?: TimeEstimate;
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
  imageAltText?: { imageOrdinal: number; text: string }[];
  sourceBody?: BrightspaceSourceBody;
  nativeGrading?: CapturedNativeGrading;
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
      if (c.timeEstimate !== undefined) validateTimeEstimate(c.timeEstimate);
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
      if (c.imageAltText !== undefined) {
        if (!Array.isArray(c.imageAltText) || c.imageAltText.length > 100000)
          throw Error("Invalid saved image alt text.");
        let previousOrdinal = 0,
          characters = 0;
        for (const value of c.imageAltText) {
          const label = contentObject(value),
            ordinal = integer(label.imageOrdinal);
          if (
            ordinal === null ||
            ordinal <= previousOrdinal ||
            ordinal > 100000 ||
            typeof label.text !== "string"
          )
            throw Error("Invalid saved image alt text.");
          previousOrdinal = ordinal;
          characters += label.text.length;
          if (characters > 4000000)
            throw Error("Saved image alt text exceeds the source limit.");
        }
      }
      if (c.sourceBody !== undefined) {
        validateBrightspaceSourceBody(c.sourceBody);
        if (
          list !== s.brightspace ||
          contentObject(c.sourceBody).topicId !== item.id
        )
          throw Error(
            "Saved Brightspace source-body evidence belongs to a different native item or platform.",
          );
      }
      if (c.nativeGrading !== undefined) {
        validateCapturedNativeGrading(c.nativeGrading);
        if (list !== s.coursera || c.nativeGrading.itemId !== item.id)
          throw Error(
            "Saved native grading setting belongs to a different item or platform.",
          );
      }
      for (const value of c.questions) {
        const q = contentObject(value);
        if (
          (q.answerKeyReliable !== undefined &&
            typeof q.answerKeyReliable !== "boolean") ||
          (q.mathTextChecked !== undefined &&
            typeof q.mathTextChecked !== "boolean") ||
          (q.settingsText !== undefined &&
            (typeof q.settingsText !== "string" ||
              q.settingsText.length > 49000)) ||
          [q.answerCoverage, q.feedbackCoverage].some(
            (v) =>
              v !== undefined &&
              !["CAPTURED", "NONE_AUTHORED", "UNVERIFIED"].includes(String(v)),
          )
        )
          throw Error("Invalid saved definition coverage.");
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
              typeof contentObject(v).text !== "string" ||
              (contentObject(v).feedback !== undefined &&
                (typeof contentObject(v).feedback !== "string" ||
                  string(contentObject(v).feedback).length > 100000)),
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
function validateCapturedNativeGrading(
  value: unknown,
): asserts value is CapturedNativeGrading {
  const setting = contentObject(value),
    keys = [
      "method",
      "courseId",
      "itemId",
      "atomId",
      "contentId",
      "draftHash",
      "storedAtomVersion",
      "updatedAt",
      "sourceState",
      "stableSource",
      "scope",
      "field",
      "graded",
      "observedAt",
    ];
  if (
    Object.keys(setting).some((key) => !keys.includes(key)) ||
    setting.method !== "BOUND_AUTHORING_DRAFT_API" ||
    setting.sourceState !== "AUTHORING_DRAFT" ||
    setting.stableSource !== true ||
    setting.scope !== "GRADING_SETTING_ONLY" ||
    setting.field !== "draft.content.definition.configuration.isGraded" ||
    typeof setting.graded !== "boolean" ||
    typeof setting.courseId !== "string" ||
    !/^[A-Za-z0-9_-]{8,512}$/.test(setting.courseId) ||
    typeof setting.itemId !== "string" ||
    !/^[A-Za-z0-9_-]{1,512}$/.test(setting.itemId) ||
    typeof setting.atomId !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(setting.atomId) ||
    setting.contentId !== "atom~" + setting.atomId ||
    typeof setting.draftHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(setting.draftHash) ||
    !Number.isSafeInteger(setting.storedAtomVersion) ||
    Number(setting.storedAtomVersion) < 0 ||
    typeof setting.updatedAt !== "number" ||
    !Number.isFinite(setting.updatedAt)
  )
    throw Error("Invalid saved native grading setting.");
  if (
    setting.observedAt !== undefined &&
    (typeof setting.observedAt !== "string" ||
      setting.observedAt.length > 64 ||
      !Number.isFinite(Date.parse(setting.observedAt)) ||
      new Date(setting.observedAt).toISOString() !== setting.observedAt)
  )
    throw Error("Invalid saved native grading observation time.");
}
function validateBrightspaceSourceBody(value: unknown) {
  const body = contentObject(value),
    hash = /^[a-f0-9]{64}$/;
  const fields: [string, number][] = [
    ["topicId", 160],
    ["status", 100],
    ["format", 100],
    ["contentType", 1024],
    ["observedAt", 100],
    ["sha256", 64],
    ["originalRef", 64],
    ["reason", 4096],
    ["projectionStatus", 100],
    ["projectionReason", 4096],
    ["descriptionText", 300000],
  ];
  if (
    body.platform !== "BRIGHTSPACE" ||
    fields.some(
      ([field, limit]) =>
        typeof body[field] !== "string" || string(body[field]).length > limit,
    ) ||
    !["VERIFIED_RETAINED_ORIGINAL", "UNVERIFIED"].includes(
      string(body.originalIntegrity),
    ) ||
    !["ORIGINAL_BODY", "DESCRIPTION_FALLBACK", "NO_TEXT"].includes(
      string(body.textScope),
    ) ||
    typeof body.descriptionTruncated !== "boolean" ||
    !(
      body.bytes === null ||
      (integer(body.bytes) !== null && Number(body.bytes) <= 16 * 1024 * 1024)
    ) ||
    (body.sha256 !== "" && !hash.test(string(body.sha256))) ||
    (body.originalRef !== "" && !hash.test(string(body.originalRef))) ||
    (body.observedAt !== "" &&
      !Number.isFinite(Date.parse(string(body.observedAt)))) ||
    !Array.isArray(body.references) ||
    body.references.length > 2000
  )
    throw Error("Invalid saved Brightspace source-body evidence.");
  if (
    body.originalIntegrity === "VERIFIED_RETAINED_ORIGINAL" &&
    (!hash.test(string(body.sha256)) ||
      body.sha256 !== body.originalRef ||
      body.bytes === null ||
      !body.observedAt)
  )
    throw Error("Saved Brightspace original-body identity is incomplete.");
  if (
    body.originalIntegrity === "UNVERIFIED" &&
    (body.sha256 !== "" || body.originalRef !== "" || body.bytes !== null)
  )
    throw Error(
      "Unverified Brightspace source-body evidence claims retained original identity.",
    );
  let characters = 0;
  for (const value of body.references) {
    const reference = contentObject(value);
    for (const [field, limit] of [
      ["url", 32768],
      ["rawUrl", 32768],
      ["tag", 100],
      ["attribute", 100],
      ["status", 100],
      ["reason", 4096],
      ["originalRef", 64],
      ["alt", 4 * 1024 * 1024],
      ["text", 4 * 1024 * 1024],
    ] as [string, number][]) {
      if (
        typeof reference[field] !== "string" ||
        string(reference[field]).length > limit
      )
        throw Error("Invalid saved Brightspace resource-reference evidence.");
      characters += string(reference[field]).length;
    }
    if (
      reference.originalRef !== "" &&
      !hash.test(string(reference.originalRef))
    )
      throw Error("Invalid saved Brightspace resource original reference.");
  }
  if (characters > 16 * 1024 * 1024)
    throw Error(
      "Saved Brightspace resource-reference evidence exceeds its bound.",
    );
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
export function contentQuestion(value: unknown, index = 0): ContentQuestion {
  const q = contentObject(value),
    limitations: string[] = [];
  // Direct definition projection has already decoded the CML. Treating its
  // literal text as HTML again would erase authored examples such as <div>.
  const plainText =
    q.textFormat === "PLAIN_TEXT" &&
    q.observationMethod === "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION";
  const fieldText = plainText ? string : contentText;
  const full = supportedMathText(fieldText(q.prompt ?? q.text)),
    options = array(q.options);
  if (
    q.mathNotationRisk === true ||
    [
      q.prompt ?? q.text,
      ...options.map((v) =>
        typeof v === "string"
          ? v
          : (contentObject(v).text ??
            contentObject(v).label ??
            contentObject(v).description),
      ),
    ].some(
      (v) =>
        typeof v === "string" &&
        (plainText
          ? /\\\(|\\\[|\$\$/
          : /<(?:sup|sub|math|svg|img)\b|\\\(|\\\[|\$\$/i
        ).test(supportedMathText(v)),
    )
  )
    limitations.push(
      "Mathematical markup or original notation coverage requires inspection; refresh older source captures. Readable text may omit notation.",
    );
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
  if (q.definitionVersion === 1) {
    limitations.push(
      ...array(q.definitionLimitations).filter(
        (v): v is string => typeof v === "string",
      ),
    );
    if (q.answerTextReliable === true)
      limitations.push(
        "Answer key copied from source definitions. See the separate CTI answer check for calculation coverage and disagreements.",
      );
  }
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
      const t = fieldText(
        typeof v === "string" ? v : (o.text ?? o.label ?? o.description),
      );
      const feedback =
        typeof o.feedback === "string" ? fieldText(o.feedback) : undefined;
      if (t.length > 100000) limitations.push("Choice text is truncated.");
      if (feedback !== undefined && feedback.length > 100000)
        limitations.push("Choice feedback is truncated.");
      return {
        id: String(o.id ?? i + 1),
        text: t.slice(0, 100000),
        ...(feedback !== undefined
          ? { feedback: feedback.slice(0, 100000) }
          : {}),
      };
    }),
    answers: array(q.correctAnswers)
      .map((v) =>
        fieldText(
          typeof v === "string"
            ? v
            : typeof v === "number" || typeof v === "boolean"
              ? String(v)
              : contentObject(v).text,
        ),
      )
      .filter(Boolean),
    feedback: fieldText(q.feedback),
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
    answerKeyReliable: q.answerTextReliable === true,
    mathTextChecked: true,
    ...(q.definitionVersion === 1
      ? {
          settingsText: string(q.settingsText),
          answerCoverage:
            q.answerCoverage === "CAPTURED"
              ? ("CAPTURED" as const)
              : ("UNVERIFIED" as const),
          feedbackCoverage:
            q.feedbackCoverage === "CAPTURED"
              ? ("CAPTURED" as const)
              : q.feedbackCoverage === "NONE_AUTHORED"
                ? ("NONE_AUTHORED" as const)
                : ("UNVERIFIED" as const),
        }
      : {}),
  };
}
/** Certify the retained text field independently of unresolved media bodies.
 * Exported flags alone cannot upgrade a partial or altered draft to complete. */
function verifiedDirectDraftText(p: Obj, itemId: string | undefined): boolean {
  if (!itemId) return false;
  try {
    const evidence = contentObject(p.directDataEvidence),
      sources = contentObject(p.directDataSources),
      receipts = contentObject(sources.receipts),
      stability = contentObject(receipts.stability),
      atoms = array(contentObject(sources.atom).elements),
      relations = array(contentObject(sources.relation).elements),
      freshAtoms = array(contentObject(stability.atom).elements),
      atom = contentObject(atoms[0]),
      relation = contentObject(relations[0]),
      fresh = contentObject(freshAtoms[0]),
      atomId = string(evidence.atomId),
      courseId = string(evidence.courseId),
      branch = contentObject(
        contentObject(relation.branchRelationMap)[courseId + "~" + itemId],
      ),
      draft = contentObject(atom.draft),
      content = contentObject(draft.content),
      definition = contentObject(content.definition);
    const discussion =
      p.textScopeKind === "bound-authoring-draft-discussion-cml";
    if (
      evidence.method !== "BOUND_AUTHORING_DRAFT_API" ||
      evidence.itemId !== itemId ||
      !courseId ||
      evidence.sourceState !== "AUTHORING_DRAFT" ||
      evidence.stableSource !== true ||
      stability.stable !== true ||
      !/^[A-Za-z0-9_-]{22}$/.test(atomId) ||
      evidence.contentId !== "atom~" + atomId ||
      atoms.length !== 1 ||
      relations.length !== 1 ||
      freshAtoms.length !== 1 ||
      atom.id !== atomId ||
      atom.contentId !== evidence.contentId ||
      relation.id !== atomId ||
      relation.atomId !== atomId ||
      branch.courseId !== courseId ||
      branch.itemId !== itemId ||
      !string(branch.courseSlug) ||
      fresh.id !== atomId ||
      fresh.contentId !== atom.contentId ||
      contentObject(atom.status).typeName !== "draftAtomStatus" ||
      contentObject(fresh.status).typeName !== "draftAtomStatus" ||
      integer(atom.storedAtomVersion) === null ||
      evidence.storedAtomVersion !== atom.storedAtomVersion ||
      stability.storedAtomVersion !== atom.storedAtomVersion ||
      fresh.storedAtomVersion !== atom.storedAtomVersion ||
      typeof contentObject(atom.metadata).updatedAt !== "number" ||
      !Number.isFinite(contentObject(atom.metadata).updatedAt) ||
      evidence.updatedAt !== contentObject(atom.metadata).updatedAt ||
      stability.updatedAt !== evidence.updatedAt ||
      contentObject(fresh.metadata).updatedAt !== evidence.updatedAt ||
      (!discussion && p.textScopeKind !== "bound-authoring-draft-cml") ||
      content.typeName !==
        (discussion ? "discussionPromptDraft" : "supplementDraft")
    )
      return false;
    const receiptValid = (value: unknown, resource: string) => {
      const receipt = contentObject(value);
      return (
        receipt.resource === resource &&
        receipt.id === atomId &&
        receipt.status === 200 &&
        receipt.bodyFormat === "PARSED_SANITIZED_JSON_MODEL" &&
        /^[a-f0-9]{64}$/.test(string(receipt.sha256)) &&
        receipt.sha256 === receipt.originalResponseSha256 &&
        receipt.requestPath === "/api/" + resource + "/" + atomId
      );
    };
    if (
      !receiptValid(receipts.atom, "authoringAtoms.v2") ||
      !receiptValid(receipts.relation, "authoringItemContentRelations.v1") ||
      !receiptValid(stability.receipt, "authoringAtoms.v2")
    )
      return false;
    const hashText = (value: string) =>
        bytesToHex(sha256(new TextEncoder().encode(value))),
      canonical = directCanonicalSourceTextV1,
      draftHash = hashText(canonical(draft));
    if (
      evidence.draftHash !== draftHash ||
      stability.draftHash !== draftHash ||
      hashText(canonical(fresh.draft)) !== draftHash
    )
      return false;
    const promptType = contentObject(definition.promptType),
      sourceCml = discussion
        ? contentObject(contentObject(promptType.definition).prompt)
        : contentObject(definition.content),
      cml = contentObject(p.directDraftCml),
      body = contentObject(cml.definition),
      value = body.value;
    if (
      (discussion && promptType.typeName !== "questionPerSession") ||
      (discussion && evidence.discussionPromptType !== promptType.typeName) ||
      (!discussion &&
        (evidence.assetId !== definition.assetId ||
          !/^[A-Za-z0-9_-]{22}@\d+$/.test(string(definition.assetId)))) ||
      cml.typeName !== "cml" ||
      body.dtdId !== (discussion ? "discussion/1" : "supplement/1") ||
      evidence.dtdId !== body.dtdId ||
      canonical(cml) !== canonical(sourceCml) ||
      typeof value !== "string" ||
      evidence.rawCmlLength !== value.length ||
      evidence.rawCmlSha256 !== hashText(value) ||
      typeof p.textSample !== "string" ||
      evidence.plainTextLength !== p.textSample.length ||
      p.textLength !== p.textSample.length ||
      p.textSha256 !== hashText(p.textSample) ||
      p.textCaptureTruncated !== false ||
      p.textCaptureEvidence != null
    )
      return false;
    const parsed = directCmlMediaInventoryV1(value);
    return (
      parsed.valid &&
      typeof parsed.text === "string" &&
      parsed.text === p.textSample
    );
  } catch {
    return false;
  }
}

/** Read attributes only after the retained CML has passed its bound source proof.
 * XML parsing stays inert, works in workers and decodes authored entities once. */
function authoredImageAltText(
  p: Obj,
): NonNullable<ContentEvidence["imageAltText"]> {
  try {
    const value = contentObject(
      contentObject(p.directDraftCml).definition,
    ).value;
    if (typeof value !== "string" || !directCmlMediaInventoryV1(value).valid)
      return [];
    const pending = [workerXml.parse(value).getRootElement()],
      labels: NonNullable<ContentEvidence["imageAltText"]> = [];
    let imageOrdinal = 0;
    while (pending.length) {
      const element = pending.pop()!;
      if (/^(?:img|image)$/.test(element.getName().toLowerCase())) {
        imageOrdinal++;
        const alt = element.getAttribute("alt");
        if (alt) labels.push({ imageOrdinal, text: alt.getValue() });
      }
      const children = element.getChildren();
      for (let index = children.length - 1; index >= 0; index--)
        pending.push(children[index]);
    }
    return labels;
  } catch {
    return [];
  }
}

/** Expose only the exact item's source-bound widget targets, never summary
 * configuration examples or a same-title item's settings. */
function verifiedDirectWidgetTargets(p: Obj, itemId?: string): string[] {
  if (!itemId) return [];
  try {
    const sources = contentObject(p.directDataSources),
      atom = contentObject(array(contentObject(sources.atom).elements)[0]),
      evidence = contentObject(p.directDataEvidence),
      courseId = string(evidence.courseId),
      relation = contentObject(
        array(contentObject(sources.relation).elements)[0],
      ),
      branch = contentObject(
        contentObject(relation.branchRelationMap)[courseId + "~" + itemId],
      ),
      fp = {
        id: itemId,
        atomId: atom.id,
        contentId: atom.contentId,
        payload: p,
      },
      bound = bindDirectAuthoringDraftV1(
        fp,
        courseId,
        string(branch.courseSlug),
        sources.atom,
        sources.relation,
      );
    if (!directWidgetEvidenceValidV1(fp, bound)) return [];
    const proof = contentObject(p.directWidgetProviderEvidence),
      hash = (value: unknown) =>
        bytesToHex(
          sha256(new TextEncoder().encode(directCanonicalSourceTextV1(value))),
        );
    if (
      hash(atom.draft) !==
      contentObject(contentObject(sources.receipts).stability).draftHash
    )
      return [];
    for (const value of [proof.initial, proof.final]) {
      const observation = contentObject(value);
      if (
        hash(directWidgetProviderSourceV1(bound, observation.model)) !==
        observation.sourceHash
      )
        return [];
    }
    return array(proof.targets)
      .map((target) => string(contentObject(target).url))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Native metadata is recomputed independently of capture-reported counters.
 * A manifest can expose verified metadata while absent binary bytes remain a gap. */
function verifiedDirectPanoptoContent(
  p: Obj,
  itemId: string | undefined,
  targets: string[],
) {
  const empty = { text: "", references: [] as string[] };
  if (!itemId || !targets.length || !p.directPanoptoEvidence) return empty;
  try {
    const proof = contentObject(p.directPanoptoEvidence),
      rawTargets = contentObject(p.directWidgetProviderEvidence).targets,
      checked = directPanoptoEvidenceStructureV1(proof, rawTargets, {
        allowMissingBodies: true,
      }),
      hash = (value: unknown) =>
        bytesToHex(
          sha256(new TextEncoder().encode(directCanonicalSourceTextV1(value))),
        );
    if (!checked.valid) return empty;
    for (const value of array(proof.deliveries)) {
      const delivery = contentObject(value);
      for (const raw of [delivery.initial, delivery.final]) {
        if (!raw) continue;
        const observation = contentObject(raw);
        if (
          hash(observation.model) !== observation.modelHash ||
          hash(
            directPanoptoSourceV1(
              string(delivery.targetUrl),
              observation.model,
            ),
          ) !== observation.sourceHash
        )
          return empty;
      }
    }
    for (const previous of checked.historical)
      for (const observation of [previous.initial, previous.final])
        if (
          hash(observation.model) !== observation.modelHash ||
          hash(previous.source) !== observation.sourceHash
        )
          return empty;
    for (const decoded of [...checked.decoded, ...checked.historical])
      if (
        decoded.bytes &&
        bytesToHex(sha256(decoded.bytes)) !== decoded.body.sha256
      )
        return empty;
    const lines: string[] = [],
      references: string[] = [];
    const append = (
      projection: ReturnType<typeof directPanoptoProjectionV1>,
      targetUrl: string,
      label: string,
    ) => {
      lines.push(
        label,
        `Configured target: ${targetUrl}`,
        `Native title: ${projection.title}`,
        `Duration: ${projection.durationSeconds ?? "not supplied"} seconds`,
        `Delivery public ID: ${projection.identity.deliveryPublicId}`,
        `Underlying session public ID: ${projection.identity.sessionPublicId}`,
        `Session file ID: ${projection.identity.sessionFileId}`,
        `Caption inventory: ${projection.captions.status}`,
      );
      for (const stream of projection.streams) {
        lines.push(
          `${stream.role}: ${stream.name ?? "unnamed"}; format: ${stream.viewerMediaFileTypeName ?? "not supplied"}`,
        );
        for (const url of [
          stream.url,
          stream.httpUrl,
          ...stream.variants.map((variant) => variant.url),
        ])
          if (url) references.push(url);
      }
      for (const entry of projection.navigation)
        lines.push(
          `Native timestamp ${entry.timeSeconds ?? "unknown"}s [${entry.eventType ?? "unclassified"}]: ${entry.text ?? ""}`,
        );
      lines.push(
        "OCR/navigation labels are not speech captions or a transcript. Recorded stream links do not establish an uploaded original, playback, course launch or complete widget content.",
      );
    };
    for (const delivery of checked.deliveries) {
      if (delivery.projection)
        append(
          delivery.projection,
          delivery.targetUrl,
          checked.metadataVerified
            ? "Captured native Panopto delivery metadata"
            : "Partial native Panopto delivery metadata; current stability is unverified",
        );
    }
    if (!checked.metadataVerified)
      for (const previous of checked.historical)
        append(
          directPanoptoProjectionV1(previous.targetUrl, previous.initial.model),
          previous.targetUrl,
          "Historical Panopto metadata; this capture did not verify the current recording source",
        );
    const serviceMetadata = array(proof.deliveries).some((value) => {
        const delivery = contentObject(value);
        return [delivery.initial, delivery.final].some(
          (read) =>
            contentObject(contentObject(read).receipt).transport ===
            "CTI_PUBLIC_BACKEND",
        );
      }),
      serviceBodies = [...checked.decoded, ...checked.historical].some(
        (value) => value.body?.receipt?.transport === "CTI_PUBLIC_BACKEND",
      );
    if (lines.length && (serviceMetadata || serviceBodies))
      lines.push(
        `Source: CTI's public service retrieved ${serviceMetadata ? "Panopto metadata" : ""}${serviceMetadata && serviceBodies ? " and " : ""}${serviceBodies ? "MP4 podcast rendition bytes" : ""} without Panopto cookies. Recorded transport context is not cryptographic attestation or proof of your Panopto login.`,
      );
    if (lines.length)
      lines.push(
        `MP4 podcast rendition bodies verified in this input: ${checked.decoded.length}. Historical rendition bodies retained: ${checked.historical.filter((value) => value.bytes).length}; historical bytes do not verify the current source. Uploaded-original identity and complete viewer-stream coverage remain unverified.`,
      );
    return { text: lines.join("\n"), references: [...new Set(references)] };
  } catch {
    return empty;
  }
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
    questions = raw.slice(0, 5000).map(contentQuestion);
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
  const widgetTargets = options.source
      ? []
      : verifiedDirectWidgetTargets(p, options.itemId),
    panopto = options.source
      ? { text: "", references: [] }
      : verifiedDirectPanoptoContent(p, options.itemId, widgetTargets),
    full = [string(p.textSample ?? p.text), panopto.text]
      .filter(Boolean)
      .join("\n\n"),
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
  const directFull =
    !options.source && verifiedDirectDraftText(p, options.itemId);
  const imageAltText = directFull ? authoredImageAltText(p) : [];
  const textCoverage: ContentCoverage = full
    ? !options.excerpt &&
      !truncated &&
      options.editorObserved !== false &&
      (exact || sourceFull || directFull)
      ? "COMPLETE"
      : "PARTIAL"
    : (exact || directFull) && !truncated
      ? "EMPTY"
      : "UNVERIFIED";
  const references = [
    ...new Set(
      [
        ...widgetTargets,
        ...panopto.references,
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
  if (widgetTargets.length)
    limitations.push(
      panopto.text
        ? "Configured widget links were captured from this item's authoring draft. Panopto metadata and MP4 podcast byte coverage are described above; HLS viewer bodies, caption bodies, playback, course launch and complete widget content remain unverified."
        : "Configured widget links were captured from this item's authoring draft. External page content, video files, captions and playback remain unverified.",
    );
  const unreadFrames = array(
    contentObject(p.readingEditorEvidence).frames,
  ).filter((v) => contentObject(v).documentStatus === "NOT_READABLE").length;
  if (unreadFrames)
    limitations.push(
      `${unreadFrames} embedded page(s) could not be read inside Coursera. An empty editor text field does not establish an empty lesson. Recorded public links can be fetched separately; course loading remains unverified.`,
    );
  if (references.length || questions.some((q) => q.media.length))
    limitations.push(
      panopto.text
        ? "Recorded stream references include unarchived HLS variants; byte verification applies only to the explicitly counted MP4 podcast renditions. Embedded screens and learner interactions remain unverified."
        : "References are listed; linked files, images, embedded screens and learner interactions are not verified by the text view.",
    );
  return {
    basis: options.basis,
    timeEstimate: capturedTime(p, options.capturedAt || ""),
    capturedAt: options.capturedAt || "",
    url: safeWebUrl(options.url),
    text: full.slice(0, 300000),
    textCoverage,
    textReason: panopto.text
      ? "Captured native Panopto metadata; media bytes, source stability and whole-widget coverage are reported separately."
      : options.excerpt
        ? "Only an excerpt was retained in this older report. Import its original extraction or capture this item again."
        : truncated
          ? "The capture or display limit cut this text. The available excerpt is shown."
          : textCoverage === "COMPLETE"
            ? directFull
              ? "Complete captured authoring draft text; media coverage is separate."
              : "Complete captured text field; external resources are separate."
            : full
              ? "Captured text is shown in full, but whole-field coverage was not established."
              : textCoverage === "EMPTY"
                ? directFull
                  ? "The bound authoring draft text was empty; media coverage is separate."
                  : unreadFrames
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
    ...(imageAltText.length ? { imageAltText } : {}),
    limitations,
  };
}
function parse(bytes?: Uint8Array): Obj {
  return bytes
    ? contentObject(JSON.parse(new TextDecoder().decode(bytes)))
    : {};
}
function brightspaceQuizTopic(topic: Obj) {
  if (topic.activityType != null) return Number(topic.activityType) === 4;
  if (string(topic.activityTypeLabel))
    return string(topic.activityTypeLabel).toLowerCase() === "quiz";
  try {
    const url = new URL(string(topic.url));
    return (
      /\/quickLink\.d2l$/i.test(url.pathname) &&
      [...url.searchParams].some(
        ([key, value]) =>
          key.toLowerCase() === "type" && value.toLowerCase() === "quiz",
      )
    );
  } catch {
    return false;
  }
}
/** Called after original bytes, source origins, native bindings and projections
 * have passed the independent Brightspace intake validator. A declared status
 * alone never supplies original integrity, nor does a file body prove playback. */
function brightspaceSourceContent(
  topic: Obj,
  capture: Obj,
  assessment: unknown,
): ContentEvidence {
  const ce = contentObject(topic.contentEvidence),
    receipt = contentObject(ce.bodyReceipt),
    bodies = contentObject(capture.assetBodies),
    ref = string(ce.rawBodyRef || ce.originalRef),
    body = contentObject(bodies[ref]),
    originalVerified = /^[a-f0-9]{64}$/.test(ref) && body.sha256 === ref,
    bodyTextPresent = typeof ce.text === "string",
    description = qaBrightspaceText_(topic.description),
    text = bodyTextPresent ? string(ce.text) : description,
    content = capturedContent(
      {
        textSample: text,
        textTruncated:
          ce.textTruncated === true || ce.projectionTruncated === true,
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
        capturedAt: string(capture.capturedAt),
        source: true,
        url: string(topic.url),
      },
    );
  const normalizedUrl = (value: unknown) => {
    try {
      const url = new URL(string(value));
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  };
  const references = array(ce.references).map((value) => {
    const r = contentObject(value),
      url = typeof value === "string" ? value : string(r.url),
      original = array(contentObject(capture.contentAcquisition).assets)
        .map(contentObject)
        .find(
          (asset) =>
            normalizedUrl(asset.url) === normalizedUrl(url) &&
            normalizedUrl(url) !== "" &&
            asset.status === "CAPTURED_ORIGINAL" &&
            array(asset.sourceBindings).some((binding) => {
              const source = contentObject(binding);
              return (
                source.kind === "TOPIC" &&
                String(source.id) === String(topic.id)
              );
            }) &&
            typeof asset.originalRef === "string" &&
            contentObject(bodies[asset.originalRef]).sha256 ===
              asset.originalRef &&
            (!r.originalRef || r.originalRef === asset.originalRef),
        );
    return {
      url,
      rawUrl: string(r.rawUrl),
      tag: string(r.tag),
      attribute: string(r.attribute),
      status: string(r.status) || "UNVERIFIED",
      reason: string(r.reason),
      originalRef: original ? string(original.originalRef) : "",
      alt: string(r.alt),
      text: string(r.text),
    };
  });
  const sourceBody: BrightspaceSourceBody = {
    platform: "BRIGHTSPACE",
    topicId: String(topic.id),
    status: string(ce.status) || "UNVERIFIED",
    format: string(ce.format),
    contentType: string(ce.contentType) || string(receipt.contentType),
    observedAt:
      typeof receipt.observedAt === "string" &&
      Number.isFinite(Date.parse(receipt.observedAt))
        ? receipt.observedAt
        : "",
    bytes: originalVerified ? Number(body.bytes) : null,
    sha256: originalVerified ? ref : "",
    originalRef: originalVerified ? ref : "",
    originalIntegrity: originalVerified
      ? "VERIFIED_RETAINED_ORIGINAL"
      : "UNVERIFIED",
    textScope: bodyTextPresent
      ? "ORIGINAL_BODY"
      : description
        ? "DESCRIPTION_FALLBACK"
        : "NO_TEXT",
    descriptionText: description.slice(0, 300000),
    descriptionTruncated: description.length > 300000,
    reason: string(ce.reason),
    projectionStatus: string(ce.projectionStatus),
    projectionReason: string(ce.projectionReason),
    references,
  };
  validateBrightspaceSourceBody(sourceBody);
  content.sourceBody = sourceBody;
  const exactLiteralText =
    originalVerified &&
    ref === ce.rawBodyRef &&
    ce.status === "CAPTURED" &&
    ce.projectionStatus !== "UNRESOLVED" &&
    ["text", "srt", "vtt"].includes(string(ce.format)) &&
    ce.projectionTruncated === false &&
    ce.textTruncated !== true &&
    bodyTextPresent;
  if (exactLiteralText && text.length <= 300000) {
    content.textCoverage = text ? "COMPLETE" : "EMPTY";
    content.textReason = text
      ? "Complete literal source-file text verified against its retained original bytes; timing and caption markup are preserved. Media playback and whole-course completeness are separate."
      : "The retained original source file decoded to an empty text field. This establishes this file's empty text only; linked media and whole-course completeness are separate.";
  } else if (sourceBody.textScope === "DESCRIPTION_FALLBACK") {
    content.textCoverage = "PARTIAL";
    content.textReason =
      "The captured native topic description is shown. The source-file body text was not captured; this description does not establish the contents or emptiness of that file." +
      (sourceBody.descriptionTruncated
        ? " The display limit cut the description; the original capture retains the field."
        : "");
  } else if (
    originalVerified &&
    ce.format === "html" &&
    bodyTextPresent &&
    text.length <= 300000
  ) {
    content.textCoverage = text ? "PARTIAL" : "UNVERIFIED";
    content.textReason =
      "The original HTML body was retained and verified. This is the collector's text projection; its correspondence to rendered HTML, images and interactions remains unverified.";
  } else if (!bodyTextPresent || !text) {
    content.textReason = originalVerified
      ? ce.projectionStatus === "UNRESOLVED"
        ? "The original source-file bytes were retained and verified, but a readable text projection could not be established. The file is not confirmed empty."
        : "The original source-file bytes were retained and verified. This binary file has no captured readable text projection; it is not confirmed empty."
      : "The source-file body was not captured with independently verifiable original bytes. This does not establish an empty or broken source file.";
  }
  const labels = array(ce.images)
    .map((image, index) => ({
      imageOrdinal: index + 1,
      text: string(contentObject(image).alt),
    }))
    .filter((label) => label.text !== "");
  if (labels.length) content.imageAltText = labels;
  content.references = [
    ...new Set([
      ...content.references,
      ...references.map((r) => r.url).filter(Boolean),
    ]),
  ];
  content.limitations.push(
    "Source-file collection status and retained original integrity are separate from rendered appearance, media playback and complete course coverage.",
  );
  if (references.length)
    content.limitations.push(
      "Resource collection outcomes retain each native reference and placement. A captured file does not establish a working embedded player or complete external-provider content.",
    );
  return content;
}
/** Called only after the comparison's input validation, or with a file whose
 * SHA-256 exactly matches the original report. No title-based course joining. */
export function buildContentSnapshot(
  courseraBytes?: Uint8Array,
  brightspaceBytes?: Uint8Array,
  parsedCourseraCapture?: unknown,
): ContentSnapshot {
  // The comparison's trusted byte adapter can reuse its parsed model, including
  // separately verified archive originals, without decoding the large JSON again.
  const raw =
      parsedCourseraCapture === undefined
        ? parse(courseraBytes)
        : contentObject(parsedCourseraCapture),
    bs = parse(brightspaceBytes);
  if (brightspaceBytes) assertBrightspaceCaptureIntegrity(bs);
  const fingerprints = array(raw.fingerprints),
    topics = qaBrightspaceFlattenTopics_(array(bs.contentTree));
  const coursera: ContentItem[] = fingerprints.map((v) => {
    const f = contentObject(v),
      nativeGrading = observeDirectNativeGrading(
        f,
        string(contentObject(raw.page).courseId),
      );
    if (nativeGrading) validateCapturedNativeGrading(nativeGrading);
    return {
      id: String(f.id ?? ""),
      name: string(f.name),
      path: string(f.path),
      content: {
        ...capturedContent(f.payload, {
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
        ...(nativeGrading ? { nativeGrading } : {}),
      },
    };
  });
  const brightspace: ContentItem[] = topics.map((topic: Obj) => {
    const quizzes = brightspaceQuizTopic(topic)
      ? array(bs.quizzes).filter(
          (v) => String(contentObject(v).id) === String(topic.toolItemId),
        )
      : [];
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
    return {
      id: String(topic.id),
      name: string(topic.title),
      path: string(topic.path),
      content: brightspaceSourceContent(topic, bs, assessment),
    };
  });
  return { schemaVersion: 1, coursera, brightspace };
}
export function contentQuestionText(q: ContentQuestion): string {
  return [
    `Question ${q.ordinal} [${q.type}]`,
    q.prompt || "[Prompt not captured]",
    ...q.options.flatMap((o, i) => [
      `  ${choiceLabel(i)} (recorded ID ${o.id}): ${o.text || "[Choice text not captured]"}`,
      ...(o.feedback
        ? [`  Captured feedback for ${choiceLabel(i)}: ${o.feedback}`]
        : []),
    ]),
    ...(q.answerCoverage
      ? [`Source answer-key coverage: ${q.answerCoverage}`]
      : []),
    ...q.answers.map(
      (a) =>
        `  ${q.answerCoverage ? "Source-marked answer" : "Captured answer evidence"}: ${a}`,
    ),
    ctiAnswerText(q),
    ...(q.feedbackCoverage
      ? [`Authored feedback coverage: ${q.feedbackCoverage}`]
      : []),
    ...(q.feedback
      ? [
          q.feedbackCoverage
            ? `  Feedback and hints:\n${q.feedback}`
            : `  Feedback: ${q.feedback}`,
        ]
      : []),
    ...(q.settingsText
      ? [`Explicit question settings:\n${q.settingsText}`]
      : []),
    ...q.media.map((m) => `  Media reference: ${m}`),
    ...q.limitations.map((l) => `  ${l}`),
  ].join("\n");
}
export function contentEvidenceText(content: ContentEvidence): string {
  const out = [
    `${content.basis} | ${content.capturedAt || "Capture time unrecorded"}`,
    `Text: ${content.textCoverage} — ${content.textReason}`,
    content.text,
    `Questions: ${content.questionCoverage} | ${content.questions.length} captured / ${content.expectedQuestions ?? "unknown"} expected — ${content.questionReason}`,
  ];
  const grading = content.nativeGrading;
  if (grading)
    out.push(
      `Captured grading setting: ${grading.graded ? "Graded" : "Not graded"} | ${grading.sourceState} | ${grading.scope}`,
      `Native field: ${grading.field} = ${grading.graded}`,
      `Grading source: ${grading.method} | course: ${grading.courseId} | item: ${grading.itemId} | atom: ${grading.atomId} | content: ${grading.contentId}`,
      `Grading observation: ${grading.observedAt || "unrecorded"} | native modification value: ${grading.updatedAt} | stored atom version: ${grading.storedAtomVersion} | draft SHA-256: ${grading.draftHash}`,
      "This records the native grading toggle only. Passing score, attempts, complete assessment behavior, learner operation and published state are not established by this setting.",
    );
  const body = content.sourceBody;
  if (body) {
    out.push(
      `Brightspace native topic: ${body.topicId || "unrecorded"}`,
      `Source-file collection status: ${body.status}`,
      `Original-body integrity: ${body.originalIntegrity}`,
      `Source-file format: ${body.format || "unrecorded"} | MIME: ${body.contentType || "unrecorded"}`,
      `Source-body observation: ${body.observedAt || "unrecorded"} | text scope: ${body.textScope}`,
      `Retained original bytes: ${body.bytes ?? "unverified"} | SHA-256: ${body.sha256 || "unverified"} | reference: ${body.originalRef || "unverified"}`,
      ...(body.descriptionText
        ? [
            body.textScope === "DESCRIPTION_FALLBACK"
              ? `Native topic description: shown above as fallback text (plain-text projection${body.descriptionTruncated ? "; display truncated" : ""}).`
              : `Native topic description (plain-text projection${body.descriptionTruncated ? "; display truncated" : ""}):\n${body.descriptionText}`,
          ]
        : []),
      ...(body.reason ? [`Source-file outcome: ${body.reason}`] : []),
      ...(body.projectionStatus || body.projectionReason
        ? [
            `Text projection: ${body.projectionStatus || "unrecorded"} ${body.projectionReason}`,
          ]
        : []),
    );
    for (const reference of body.references)
      out.push(
        `Native resource: ${reference.tag || "unrecorded tag"}.${reference.attribute || "unrecorded attribute"} | ${reference.status} | ${reference.url}`,
        `  Raw reference: ${reference.rawUrl || "unrecorded"}`,
        ...(reference.reason
          ? [`  Collection outcome: ${reference.reason}`]
          : []),
        ...(reference.originalRef
          ? [`  Retained original reference: ${reference.originalRef}`]
          : []),
        ...(reference.alt ? [`  Authored alt text: ${reference.alt}`] : []),
        ...(reference.text
          ? [`  Authored reference text: ${reference.text}`]
          : []),
      );
  }
  for (const q of content.questions) out.push(contentQuestionText(q));
  out.push(
    ...content.references.map((r) => `Reference: ${r}`),
    ...(content.imageAltText || [])
      .filter((label) => label.text !== "")
      .map(
        (label) =>
          `Authored image alt text (source image ${label.imageOrdinal}): ${label.text}`,
      ),
    ...content.limitations,
  );
  return out.filter(Boolean).join("\n");
}
