import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { directCmlMediaInventoryV1 } from "../extractors/coursera/direct-data-media-contracts.js";
import type { RetainedAuthoringBlock } from "./coursera-retained-authoring-content.ts";

type Obj = Record<string, unknown>;
export type AuthoredFieldStatus =
  | "PRESENT"
  | "EXPLICIT_EMPTY"
  | "EXPLICIT_EMPTY_SOURCE"
  | "NOT_RECORDED"
  | "UNSUPPORTED_CML"
  | "UNSUPPORTED_VALUE";
export interface AuthoredField {
  path: string;
  kind: "TEXT" | "BOOLEAN" | "CML" | "SOURCE_REFERENCE";
  status: AuthoredFieldStatus;
  value: string | boolean | null;
  literal: string;
  dtdId?: string;
}
export interface RetainedAuthoringFieldsIdentity {
  kind: "TEXT_BLOCK" | "QUESTION_DEFINITION";
  nativeType: string;
  nativeId: string;
  ordinal: number;
  originalModelSha256: string;
}
export interface AuthoredAnswerRecord {
  ordinal: number;
  id: AuthoredField;
  answer: AuthoredField;
  isCorrect: AuthoredField;
  feedback: AuthoredField;
}
export interface AuthoredReflectionOption {
  ordinal: number;
  id: AuthoredField;
  display: AuthoredField;
  feedback: AuthoredField;
}
export interface RetainedAuthoringFieldsView
  extends RetainedAuthoringFieldsIdentity {
  originalModelJson: string;
  applicability:
    | "AUTHORED_ANSWER_RECORDS_OBSERVED"
    | "UNKEYED_NATIVE_REFLECTION"
    | "NOT_APPLICABLE_INSTRUCTION"
    | "SOURCE_REFERENCE_ONLY"
    | "UNVERIFIED";
  applicabilityReason: string;
  title: AuthoredField;
  prompt: AuthoredField;
  answerRecords: AuthoredAnswerRecord[];
  answerRecordsStatus: AuthoredFieldStatus;
  options: AuthoredReflectionOption[];
  optionsStatus: AuthoredFieldStatus;
  defaultIncorrectFeedback: AuthoredField;
  noChosenFeedback: AuthoredField;
  shuffleOptions: AuthoredField;
  sourceDefect?: {
    status: "CAPTURED_SOURCE_DEFECT";
    kind: "EXPLICIT_EMPTY_MCQ_OPTION_DISPLAY";
    emptyOptionOrdinals: number[];
    nativeCorrectOption: AuthoredField;
    usableAnswerTextVerified: false;
  };
}

export const MAX_RETAINED_AUTHORING_FIELD_JSON_CHARACTERS = 300000;
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value: Obj, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function bounded(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++nodes > 100000 || next.depth > 100) return false;
    if (next.value !== null && typeof next.value === "object") {
      const values = Object.values(next.value);
      if (values.length + pending.length > 100000) return false;
      for (const value of values)
        pending.push({ value, depth: next.depth + 1 });
    }
  }
  return true;
}

function literalField(
  source: Obj,
  key: string,
  path = key,
  boolean = false,
): AuthoredField {
  const kind = boolean ? "BOOLEAN" : "TEXT";
  if (!own(source, key))
    return { path, kind, status: "NOT_RECORDED", value: null, literal: "" };
  const value = source[key];
  if (typeof value !== (boolean ? "boolean" : "string"))
    return {
      path,
      kind,
      status: "UNSUPPORTED_VALUE",
      value: null,
      literal: JSON.stringify(value),
    };
  return {
    path,
    kind,
    status: value === "" ? "EXPLICIT_EMPTY" : "PRESENT",
    value: value as string | boolean,
    literal: boolean ? String(value) : (value as string),
  };
}

function cmlField(source: Obj, key: string, path = key, observedBlankDtd = false, sourceDisplay = false): AuthoredField {
  const missing: AuthoredField = {
    path,
    kind: "CML",
    status: "NOT_RECORDED",
    value: null,
    literal: "",
  };
  if (!own(source, key)) return missing;
  const value = source[key],
    definition =
      object(value) && object(value.definition) ? value.definition : null;
  const literal =
    definition && typeof definition.value === "string"
      ? definition.value
      : JSON.stringify(value, null, 2);
  const dtdId =
    definition && typeof definition.dtdId === "string"
      ? definition.dtdId
      : undefined;
  const unsupported: AuthoredField = {
    ...missing,
    status: "UNSUPPORTED_CML",
    literal,
    ...(dtdId === undefined ? {} : { dtdId }),
  };
  if (
    !object(value) ||
    value.typeName !== "cml" ||
    !definition ||
    typeof definition.value !== "string" ||
    (!/^(assess|staffGraded)\/1$/.test(dtdId || "") && !(observedBlankDtd && dtdId === ""))
  )
    return unsupported;
  const parsed = directCmlMediaInventoryV1(definition.value, 2);
  if (!parsed.valid || parsed.references.length) return unsupported;
  return {
    ...unsupported,
    status: parsed.text === "" ? sourceDisplay ? "EXPLICIT_EMPTY_SOURCE" : "EXPLICIT_EMPTY" : "PRESENT",
    value: parsed.text,
  };
}

function collectionStatus(source: Obj, key: string): AuthoredFieldStatus {
  if (!own(source, key)) return "NOT_RECORDED";
  if (!Array.isArray(source[key])) return "UNSUPPORTED_VALUE";
  return source[key].length ? "PRESENT" : "EXPLICIT_EMPTY";
}

/** Display fields only. The caller must separately validate native source and
 * observation proof. This helper checks the original model hash and identity;
 * it never establishes primary questions, grading validity or completeness. */
export function retainedRawAuthoringFields(
  originalModelJson: string,
  identity: RetainedAuthoringFieldsIdentity,
): RetainedAuthoringFieldsView | null {
  try {
    if (
      typeof originalModelJson !== "string" ||
      !originalModelJson ||
      originalModelJson.length > MAX_RETAINED_AUTHORING_FIELD_JSON_CHARACTERS ||
      !identity ||
      !Number.isSafeInteger(identity.ordinal) ||
      identity.ordinal < 1 ||
      typeof identity.nativeId !== "string" ||
      !identity.nativeId ||
      !/^[a-f0-9]{64}$/.test(identity.originalModelSha256)
    )
      return null;
    const model: unknown = JSON.parse(originalModelJson);
    if (
      !object(model) ||
      !bounded(model) ||
      bytesToHex(
        sha256(new TextEncoder().encode(directCanonicalSourceTextV1(model))),
      ) !== identity.originalModelSha256
    )
      return null;
    const instruction = identity.kind === "TEXT_BLOCK";
    if (!instruction && identity.kind !== "QUESTION_DEFINITION") return null;
    const wrapper =
      !instruction && object(model.definition) ? model.definition : null;
    const body = instruction ? model.definition : wrapper?.definition;
    if (
      !object(body) ||
      (instruction
        ? identity.nativeType !== "storedTextBlockPart" ||
          model.typeName !== identity.nativeType ||
          body.id !== identity.nativeId
        : !["textExactMatch", "mcqReflect", "checkboxReflect", "mcq"].includes(
            identity.nativeType,
          ) ||
          wrapper?.typeName !== identity.nativeType ||
          model.id !== identity.nativeId)
    )
      return null;
    if (
      Array.isArray(body.options) &&
      (body.options.length > 200 ||
        body.options.some((value) => !object(value)))
    )
      return null;
    const exact = identity.nativeType === "textExactMatch", sourceDefect = identity.nativeType === "mcq";
    const values = Array.isArray(body.options) ? body.options : [];
    if (sourceDefect) {
      if (!/^[A-Za-z0-9_-]{22}~[A-Za-z0-9_-]{22}@\d+$/.test(identity.nativeId) ||
          Object.keys(body).some(key => !["prompt", "options", "correctOption", "shuffleOptions", "__typename"].includes(key)) ||
          values.length < 2 || values.length > 100 || typeof body.shuffleOptions !== "boolean" ||
          typeof body.correctOption !== "string" || !body.correctOption ||
          cmlField(body, "prompt", "prompt", true).status !== "PRESENT") return null;
      const ids = new Set<string>(); let emptyDisplays = 0;
      for (const [index, row] of values.entries()) {
        if (!object(row) || Object.keys(row).some(key => !["id", "display", "feedback", "__typename"].includes(key)) ||
            typeof row.id !== "string" || !row.id || ids.has(row.id)) return null;
        const display = cmlField(row, "display", "options[" + index + "].display", true, true),
          feedback = cmlField(row, "feedback", "options[" + index + "].feedback", true);
        if (!["PRESENT", "EXPLICIT_EMPTY_SOURCE"].includes(display.status) ||
            !["PRESENT", "EXPLICIT_EMPTY", "NOT_RECORDED"].includes(feedback.status)) return null;
        ids.add(row.id); if (display.status === "EXPLICIT_EMPTY_SOURCE") emptyDisplays++;
      }
      if (!emptyDisplays || !ids.has(body.correctOption)) return null;
    }
    const answerRecords: AuthoredAnswerRecord[] = exact
      ? values.map((value, index) => {
          const row = object(value) ? value : {},
            path = "options[" + index + "].";
          return {
            ordinal: index + 1,
            id: literalField(row, "id", path + "id"),
            answer: literalField(row, "answer", path + "answer"),
            isCorrect: literalField(row, "isCorrect", path + "isCorrect", true),
            feedback: cmlField(row, "feedback", path + "feedback"),
          };
        })
      : [];
    const options: AuthoredReflectionOption[] =
      !instruction && !exact
        ? values.map((value, index) => {
            const row = object(value) ? value : {},
              path = "options[" + index + "].";
            return {
              ordinal: index + 1,
              id: literalField(row, "id", path + "id"),
              display: cmlField(row, "display", path + "display", sourceDefect, sourceDefect),
              feedback: cmlField(row, "feedback", path + "feedback", sourceDefect),
            };
          })
        : [];
    const collection = collectionStatus(body, "options");
    const unkeyed =
      !own(body, "correctOption") &&
      !own(body, "correctOptions") &&
      values.every(
        (value) =>
          object(value) && !own(value, "isCorrect") && !own(value, "answer"),
      );
    const applicability = instruction
      ? "NOT_APPLICABLE_INSTRUCTION"
      : sourceDefect
        ? "SOURCE_REFERENCE_ONLY"
      : exact && Array.isArray(body.options) && values.length > 0
        ? "AUTHORED_ANSWER_RECORDS_OBSERVED"
        : !exact && unkeyed && Array.isArray(body.options)
          ? "UNKEYED_NATIVE_REFLECTION"
          : "UNVERIFIED";
    return {
      kind: identity.kind,
      nativeType: identity.nativeType,
      nativeId: identity.nativeId,
      ordinal: identity.ordinal,
      originalModelSha256: identity.originalModelSha256,
      originalModelJson,
      applicability,
      applicabilityReason:
        applicability === "NOT_APPLICABLE_INSTRUCTION"
          ? "This is an instruction block, not a question. An answer key does not apply to this block."
          : applicability === "SOURCE_REFERENCE_ONLY"
            ? "Captured source defect: at least one option display is explicitly empty in the captured native MCQ. The native correct-option ID is a source reference; no usable answer text or replacement choices have been inferred. Extraction coverage and readiness remain unchanged."
          : applicability === "AUTHORED_ANSWER_RECORDS_OBSERVED"
            ? "Authored answer records and native correctness flags are shown literally. Learner matching rules and answer validity remain unverified."
            : applicability === "UNKEYED_NATIVE_REFLECTION"
              ? "The captured native reflection model has no correct-option fields. No answer key has been inferred; grading and learner behavior remain unverified."
              : "Answer-key applicability is unverified. Inspect the literal original model.",
      title: literalField(body, "title"),
      prompt: cmlField(body, instruction ? "body" : "prompt", instruction ? "body" : "prompt", sourceDefect),
      answerRecords,
      answerRecordsStatus: exact ? collection : "NOT_RECORDED",
      options,
      optionsStatus: !instruction && !exact ? collection : "NOT_RECORDED",
      defaultIncorrectFeedback: cmlField(body, "defaultIncorrectFeedback"),
      noChosenFeedback: cmlField(body, "noChosenFeedback"),
      shuffleOptions: literalField(
        body,
        "shuffleOptions",
        "shuffleOptions",
        true,
      ),
      ...(sourceDefect ? {sourceDefect: {
        status: "CAPTURED_SOURCE_DEFECT" as const,
        kind: "EXPLICIT_EMPTY_MCQ_OPTION_DISPLAY" as const,
        emptyOptionOrdinals: options.filter(option => option.display.status === "EXPLICIT_EMPTY_SOURCE").map(option => option.ordinal),
        nativeCorrectOption: {...literalField(body, "correctOption"), kind: "SOURCE_REFERENCE" as const},
        usableAnswerTextVerified: false as const,
      }} : {}),
    };
  } catch {
    return null;
  }
}

export function retainedAuthoringFields(
  block: RetainedAuthoringBlock,
): RetainedAuthoringFieldsView | null {
  return retainedRawAuthoringFields(block?.originalModelJson, block);
}

export function authoredFieldText(field: AuthoredField): string {
  if (field.status === "NOT_RECORDED") return "[not recorded]";
  if (field.status === "EXPLICIT_EMPTY_SOURCE") return "[Explicitly empty in captured source]";
  if (field.status === "EXPLICIT_EMPTY")
    return field.kind === "CML"
      ? "[explicitly empty supported CML text]"
      : "[explicitly empty string]";
  if (field.status === "UNSUPPORTED_CML")
    return "[unsupported CML; literal source field follows]\n" + field.literal;
  if (field.status === "UNSUPPORTED_VALUE")
    return "[unsupported native field type]\n" + field.literal;
  return typeof field.value === "boolean"
    ? String(field.value)
    : (field.value ?? "");
}

/** The literal original remains available separately; these are additional
 * labelled source fields, never a normalized question or calculated key. */
export function retainedAuthoringFieldsText(
  view: RetainedAuthoringFieldsView,
): string {
  const field = (label: string, value: AuthoredField) =>
    label + " [" + value.status + "]: " + authoredFieldText(value);
  const out = [
    "TYPED AUTHORED SOURCE FIELDS",
    ...(view.sourceDefect ? ["Captured source defect", "SOURCE_REFERENCE: native correct-option ID only; usable answer text remains unverified."] : []),
    view.applicabilityReason,
    "Native type: " + view.nativeType,
    field("Title", view.title),
    field(
      view.kind === "TEXT_BLOCK" ? "Instruction body" : "Prompt",
      view.prompt,
    ),
  ];
  if (view.nativeType === "textExactMatch") {
    out.push("Authored answer records: " + view.answerRecordsStatus);
    for (const record of view.answerRecords)
      out.push(
        "Authored answer record " + record.ordinal,
        field("Native record ID", record.id),
        field("Literal authored answer", record.answer),
        field("Native isCorrect field", record.isCorrect),
        field("Authored feedback", record.feedback),
      );
    out.push(
      field("Default incorrect feedback", view.defaultIncorrectFeedback),
    );
  } else if (view.kind !== "TEXT_BLOCK") {
    out.push((view.sourceDefect ? "Captured source options: " : "Authored reflection options: ") + view.optionsStatus);
    if (view.sourceDefect)
      out.push(field("Native correct-option ID [SOURCE_REFERENCE]", view.sourceDefect.nativeCorrectOption));
    for (const option of view.options)
      out.push(
        (view.sourceDefect ? "Captured source option " : "Authored reflection option ") + option.ordinal,
        field("Native option ID", option.id),
        field("Authored display", option.display),
        field("Authored feedback", option.feedback),
      );
    out.push(
      field("No-selection feedback", view.noChosenFeedback),
      field("Native shuffleOptions field", view.shuffleOptions),
    );
  }
  return out.join("\n");
}
