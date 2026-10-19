import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { directCmlMediaInventoryV1 } from "../extractors/coursera/direct-data-media-contracts.js";
import type { RetainedAuthoringBlock } from "./coursera-retained-authoring-content.ts";

type Obj = Record<string, unknown>;
export type AuthoredFieldStatus =
  | "PRESENT"
  | "EXPLICIT_EMPTY"
  | "NOT_RECORDED"
  | "UNSUPPORTED_CML"
  | "UNSUPPORTED_VALUE";
export interface AuthoredField {
  path: string;
  kind: "TEXT" | "BOOLEAN" | "CML";
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

function cmlField(source: Obj, key: string, path = key): AuthoredField {
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
    !/^(assess|staffGraded)\/1$/.test(dtdId || "")
  )
    return unsupported;
  const parsed = directCmlMediaInventoryV1(definition.value, 2);
  if (!parsed.valid || parsed.references.length) return unsupported;
  return {
    ...unsupported,
    status: parsed.text === "" ? "EXPLICIT_EMPTY" : "PRESENT",
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
        : !["textExactMatch", "mcqReflect", "checkboxReflect"].includes(
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
    const exact = identity.nativeType === "textExactMatch";
    const values = Array.isArray(body.options) ? body.options : [];
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
              display: cmlField(row, "display", path + "display"),
              feedback: cmlField(row, "feedback", path + "feedback"),
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
          : applicability === "AUTHORED_ANSWER_RECORDS_OBSERVED"
            ? "Authored answer records and native correctness flags are shown literally. Learner matching rules and answer validity remain unverified."
            : applicability === "UNKEYED_NATIVE_REFLECTION"
              ? "The captured native reflection model has no correct-option fields. No answer key has been inferred; grading and learner behavior remain unverified."
              : "Answer-key applicability is unverified. Inspect the literal original model.",
      title: literalField(body, "title"),
      prompt: cmlField(body, instruction ? "body" : "prompt"),
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
    out.push("Authored reflection options: " + view.optionsStatus);
    for (const option of view.options)
      out.push(
        "Authored reflection option " + option.ordinal,
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
