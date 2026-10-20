import { directManualPartTargetsV1, directManualObservationV1 } from "../extractors/coursera/direct-data-native-observations.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { bindDirectAuthoringDraftV1 } from "../extractors/coursera/direct-data-models.js";
import {
  directReceiptSourceValidV1,
  directSourceBindingEvidenceV1,
} from "../extractors/coursera/direct-data-contracts.js";
import { directCmlMediaInventoryV1 } from "../extractors/coursera/direct-data-media-contracts.js";
import {
  retainedAuthoringFields,
  retainedAuthoringFieldsText,
} from "./coursera-retained-authoring-fields.ts";

type Obj = Record<string, any>;
const object = (v: unknown): Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const canonical = directCanonicalSourceTextV1;
const hash = (v: unknown): string =>
  bytesToHex(sha256(new TextEncoder().encode(canonical(v))));
const MAX_PROOF_CHARACTERS = 2000000;
const MAX_DISPLAY_CHARACTERS = 300000;
export const MAX_RETAINED_AUTHORING_SNAPSHOT_CHARACTERS = 8000000;

function withinProofBudget(
  value: unknown,
  limit = MAX_PROOF_CHARACTERS,
): boolean {
  const pending = [{ value, depth: 0 }];
  let nodes = 0,
    characters = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++nodes > 100000 || next.depth > 100) return false;
    if (typeof next.value === "string") characters += next.value.length;
    else if (next.value !== null && typeof next.value === "object") {
      const keys = Object.keys(next.value);
      if (keys.length + pending.length > 100000) return false;
      for (const key of keys) {
        characters += key.length;
        pending.push({
          value: (next.value as Obj)[key],
          depth: next.depth + 1,
        });
      }
    }
    if (characters > limit) return false;
  }
  return true;
}

export interface RetainedAuthoringBlock {
  kind: "TEXT_BLOCK" | "QUESTION_DEFINITION";
  ordinal: number;
  nativeId: string;
  groupId: string;
  nativeType: string;
  title: string;
  prompt: string;
  options: { id: string; text: string }[];
  formatStatus: "KNOWN_CML" | "UNSUPPORTED_CML";
  nativeValidation: "READY" | "NOT_READY" | "UNRECORDED";
  originalModelSha256: string;
  originalModelJson: string;
}
export interface RetainedAuthoringContent {
  schemaVersion: 1;
  scope: "RETAINED_AUTHORING_CONTENT_ONLY";
  courseId: string;
  itemId: string;
  atomId: string;
  draftHash: string;
  blocks: RetainedAuthoringBlock[];
  proof: {
    item: Obj;
    courseId: string;
    evidence: Obj;
    sources: Obj;
    assessment: Obj;
    projectedGroupIds: string[];
    resumeRevalidation?: unknown;
  };
}

/** Cheap structural/string bounds run before serializing or rehashing untrusted
 * saved projections. The snapshot applies a second cumulative bound. */
export function retainedCourseraAuthoringSize(value: unknown): number {
  if (!withinProofBudget(value, 3000000))
    throw Error(
      "Retained Coursera authoring content exceeds the review limit.",
    );
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string" || serialized.length > 3000000)
    throw Error(
      "Retained Coursera authoring content exceeds the review limit.",
    );
  return serialized.length;
}

/** Read-only supplemental view. It never enters the normalized question list or
 * establishes a key, an empty assessment, complete coverage or learner behavior.
 * Keep native CML inert: no source HTML or script is mounted in the interface. */
function derive(
  proof: RetainedAuthoringContent["proof"],
): RetainedAuthoringContent | null {
  try {
    if (
      !withinProofBudget(proof) ||
      canonical(proof).length > MAX_PROOF_CHARACTERS
    )
      return null;
    const item = proof.item,
      courseId = proof.courseId;
    if (
      !item ||
      typeof courseId !== "string" ||
      !courseId ||
      !Array.isArray(proof.projectedGroupIds) ||
      proof.projectedGroupIds.some((id) => typeof id !== "string") ||
      new Set(proof.projectedGroupIds).size !== proof.projectedGroupIds.length
    )
      return null;
    const fp = {
      ...item,
      payload: {
        directDataSources: proof.sources,
        directDataEvidence: proof.evidence,
        ...(proof.resumeRevalidation === undefined
          ? {}
          : { directResumeRevalidation: proof.resumeRevalidation }),
      },
    };
    const branch =
      proof.sources.relation?.elements?.[0]?.branchRelationMap?.[
        courseId + "~" + item.id
      ];
    const bound = bindDirectAuthoringDraftV1(
      fp,
      courseId,
      branch?.courseSlug,
      proof.sources.atom,
      proof.sources.relation,
    );
    const sourceProof = directSourceBindingEvidenceV1(fp, bound);
    if (
      !sourceProof ||
      Object.entries(sourceProof).some(
        ([key, value]) => proof.evidence[key] !== value,
      ) ||
      sourceProof.draftHash !== hash(bound.draft) ||
      !["staffGraded", "gradedAssignment", "ungradedAssignment"].includes(
        item.typeName,
      ) ||
      bound.draft.content?.typeName !== "staffGradedDraft"
    )
      return null;
    const parts = bound.draft.content.definition?.parts;
    if (!Array.isArray(parts) || parts.length > 100) return null;
    const raw = proof.assessment;
    const rawValid =
      raw.method === "BOUND_AUTHORING_DRAFT_API" &&
      raw.courseId === courseId &&
      raw.itemId === item.id &&
      raw.assignmentId === item.atomId &&
      canonical(raw.rawParts) === canonical(parts);
    const uniqueMap = (values: unknown): Map<string, Obj> | null => {
      const rows = list(values),
        out = new Map<string, Obj>();
      if (rows.length > 100) return null;
      for (const row of rows) {
        if (!row || typeof row.id !== "string" || out.has(row.id)) return null;
        out.set(row.id, row);
      }
      return out;
    };
    const groups = uniqueMap(raw.groups),
      definitions = uniqueMap(raw.questionDefinitions),
      fresh = uniqueMap(raw.groupStability);
    if (!groups || !definitions || !fresh || list(raw.receipts).length > 200)
      return null;
    const receipt = (resource: string, id: string) =>
      list(raw.receipts).some((value) =>
        directReceiptSourceValidV1(value, resource, id),
      );
    const projected = new Set(proof.projectedGroupIds),
      blocks: RetainedAuthoringBlock[] = [];
    const seenParts = new Set<string>();
    const cmlText = (value: unknown): { value: string; known: boolean } => {
      const cml = object(value),
        body = object(cml.definition);
      if (cml.typeName !== "cml" || typeof body.value !== "string")
        return { value: "", known: false };
      const parsed = directCmlMediaInventoryV1(body.value, 2);
      const known =
        /^(assess|staffGraded)\/1$/.test(text(body.dtdId)) && parsed.valid;
      // Unknown dialects remain visible in the literal original below; do not
      // silently normalize them into a supported assessment question.
      return { value: known ? parsed.text : "", known };
    };
    for (let index = 0; index < parts.length; index++) {
      const part = object(parts[index]),
        pd = object(part.definition),
        id = text(pd.id);
      if (!id || seenParts.has(id)) return null;
      seenParts.add(id);
      if (part.typeName === "storedTextBlockPart") {
        const prompt = cmlText(pd.body),
          literal = JSON.stringify(part, null, 2);
        blocks.push({
          kind: "TEXT_BLOCK",
          ordinal: index + 1,
          nativeId: id,
          groupId: "",
          nativeType: part.typeName,
          title: text(pd.title),
          prompt: prompt.value,
          options: [],
          formatStatus: prompt.known ? "KNOWN_CML" : "UNSUPPORTED_CML",
          nativeValidation: "UNRECORDED",
          originalModelSha256: hash(part),
          originalModelJson: literal,
        });
        continue;
      }
      if (part.typeName === "storedManualGradedQuestionPart" && rawValid) {
        const target = directManualPartTargetsV1(bound).find((value: Obj) => value.ordinal === index + 1),
          observations = list(raw.manualDefinitions).filter(record => record.id === target?.id);
        if (target && observations.length === 1 && directManualObservationV1(observations[0],target,hash) &&
            Date.parse(observations[0].final.receipt.observedAt) <= Date.parse(proof.sources.receipts?.stability?.receipt?.observedAt)) {
          const original = observations[0].initial.data.elements[0], prompt = cmlText(original.prompt);
          blocks.push({kind:"QUESTION_DEFINITION",ordinal:index+1,nativeId:target.id,groupId:"",nativeType:"manualGraded",
            title:"",prompt:prompt.value,options:[],formatStatus:prompt.known ? "KNOWN_CML" : "UNSUPPORTED_CML",
            nativeValidation:"UNRECORDED",originalModelSha256:hash(original),originalModelJson:JSON.stringify(original,null,2)});
        }
        continue;
      }
      if (
        part.typeName !== "storedQuestionGroupPart" ||
        !/^[A-Za-z0-9_-]{22}$/.test(id)
      )
        continue;
      const groupId = item.atomId + "~" + id;
      if (projected.has(groupId) || !rawValid) continue;
      const group = groups.get(groupId),
        current = fresh.get(groupId),
        sourceId = group?.questions?.[0];
      if (
        !group ||
        !current ||
        current.stable !== true ||
        current.group?.id !== groupId ||
        canonical(current.group) !== canonical(group) ||
        !directReceiptSourceValidV1(
          current.receipt,
          "authoringAssignmentQuestionGroups.v1",
          groupId,
        ) ||
        !receipt("authoringAssignmentQuestionGroups.v1", groupId) ||
        !Array.isArray(group.questions) ||
        group.questions.length !== 1 ||
        typeof sourceId !== "string" ||
        !new RegExp("^" + item.atomId + "~[A-Za-z0-9_-]{22}@\\d+$").test(
          sourceId,
        ) ||
        !Array.isArray(group.questionReferences) ||
        group.questionReferences.length !== 1 ||
        group.questionReferences[0]?.authoringId !== sourceId ||
        !receipt("authoringAssignmentMachineEvaluableQuestions.v1", sourceId)
      )
        continue;
      const definition = definitions.get(sourceId);
      if (!definition) continue;
      const model = object(definition.definition),
        body = object(model.definition),
        prompt = cmlText(body.prompt);
      if (
        ![
          "textExactMatch",
          "checkboxReflect",
          "mcqReflect",
          "mcq",
          "checkbox",
        ].includes(text(model.typeName)) ||
        list(body.options).length > 200
      )
        continue;
      let known = prompt.known;
      const options = list(body.options).map((value) => {
        const option = object(value),
          display = cmlText(option.display);
        // A textExactMatch answer is retained only in its original model. It is
        // not an authored choice and is never relabelled as a verified key.
        if (model.typeName !== "textExactMatch") known &&= display.known;
        return { id: text(option.id), text: display.value };
      });
      const validation = object(
        object(definition.validation).definition,
      ).isReadyForPublish;
      blocks.push({
        kind: "QUESTION_DEFINITION",
        ordinal: index + 1,
        nativeId: sourceId,
        groupId,
        nativeType: model.typeName,
        title: "",
        prompt: prompt.value,
        options: model.typeName === "textExactMatch" ? [] : options,
        formatStatus: known ? "KNOWN_CML" : "UNSUPPORTED_CML",
        nativeValidation:
          validation === true
            ? "READY"
            : validation === false
              ? "NOT_READY"
              : "UNRECORDED",
        originalModelSha256: hash(definition),
        originalModelJson: JSON.stringify(definition, null, 2),
      });
    }
    if (
      !blocks.length ||
      blocks.reduce((sum, block) => sum + JSON.stringify(block).length, 0) >
        MAX_DISPLAY_CHARACTERS
    )
      return null;
    return {
      schemaVersion: 1,
      scope: "RETAINED_AUTHORING_CONTENT_ONLY",
      courseId,
      itemId: item.id,
      atomId: item.atomId,
      draftHash: sourceProof.draftHash,
      blocks,
      proof,
    };
  } catch {
    return null;
  }
}

export function retainedCourseraAuthoringContent(
  item: unknown,
  courseId: string,
): RetainedAuthoringContent | null {
  const f = object(item),
    p = object(f.payload);
  const proof: RetainedAuthoringContent["proof"] = {
    item: {
      id: f.id,
      typeName: f.typeName,
      atomId: f.atomId,
      contentId: f.contentId,
    },
    courseId,
    evidence: object(p.directDataEvidence),
    sources: object(p.directDataSources),
    assessment: object(p.assessmentApiEvidence),
    projectedGroupIds: list(object(p.structuredAssessment).questions).map((q) =>
      text(object(q).courseraQuestionId),
    ),
    ...(p.directResumeRevalidation === undefined
      ? {}
      : { resumeRevalidation: p.directResumeRevalidation }),
  };
  return derive(proof);
}

export function validateRetainedCourseraAuthoringContent(
  value: unknown,
  itemId: string,
  questionIds: string[],
  expectedCourseId: string,
): asserts value is RetainedAuthoringContent {
  retainedCourseraAuthoringSize(value);
  const retained = object(value),
    proof = object(retained.proof);
  const derived = derive(proof as RetainedAuthoringContent["proof"]);
  if (
    !derived ||
    !expectedCourseId ||
    derived.courseId !== expectedCourseId ||
    derived.itemId !== itemId ||
    canonical(proof.projectedGroupIds) !== canonical(questionIds) ||
    canonical(value) !== canonical(derived)
  )
    throw Error(
      "Retained Coursera authoring content does not match its native source evidence.",
    );
}

export function retainedCourseraAuthoringText(
  content: RetainedAuthoringContent,
): string {
  return [
    "ADDITIONAL RETAINED AUTHORING CONTENT",
    "These native definitions and instructions are separate from normalized question counts. Keys, complete assessment coverage and learner behavior are not established by this view.",
    `Course ${content.courseId} | item ${content.itemId} | authoring atom ${content.atomId} | draft SHA-256 ${content.draftHash}`,
    ...content.blocks.flatMap((block) => {
      const fields = retainedAuthoringFields(block);
      return [
      `${block.kind === "TEXT_BLOCK" ? "Instruction block" : "Native definition"} at part ${block.ordinal} | ${block.nativeType} | ${block.nativeId}`,
      ...(block.title ? [block.title] : []),
      ...(block.prompt ? [block.prompt] : []),
      ...(fields ? [retainedAuthoringFieldsText(fields)] : []),
      ...block.options.map(
        (option, index) =>
          `Authored option ${option.id}: ${fields?.sourceDefect
            ? fields.options[index]?.display.status === "EXPLICIT_EMPTY_SOURCE"
              ? "[Explicitly empty in captured source]"
              : fields.options[index]?.display.value || "[no supported display text]"
            : option.text || "[no supported display text]"}`,
      ),
      `CML format: ${block.formatStatus} | native ready-for-publish flag: ${block.nativeValidation}`,
      `Original native model SHA-256: ${block.originalModelSha256}`,
      "Literal original native model:",
      block.originalModelJson,
    ]; }),
  ].join("\n");
}
