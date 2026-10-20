import { sanitizeCourseraCourseDataModel } from "./direct-data-privacy.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";

export const CTI_DIRECT_MANUAL_FIELDS_V1 = "id,plagiarismConfig,graderType,graderInstructions,academicIntegrityConfiguration,prompt,rubrics,schema,submissionSchema,validation";

/** Manual parts name mutable definitions, not machine-evaluable groups. Never
 * invent a version or route these IDs through the machine question endpoint. */
export function directManualPartTargetsV1(bound) {
  const parts=bound?.draft?.content?.definition?.parts;
  if (bound?.sourceState !== "AUTHORING_DRAFT" || bound.draft?.content?.typeName !== "staffGradedDraft" ||
      !/^[A-Za-z0-9_-]{22}$/.test(bound.atomId || "") || !Array.isArray(parts) || parts.length>100) return [];
  const seen=new Set(), targets=[];
  for (const [index,part] of parts.entries()) {
    if(part?.typeName!=="storedManualGradedQuestionPart") continue;
    const id=part.definition?.id;
    if(!/^[A-Za-z0-9_-]{22}$/.test(id || "") || seen.has(id)) return [];
    seen.add(id);targets.push({id:bound.atomId+"~"+id,localId:id,ordinal:index+1});
  }
  return targets;
}

/** Validate source identity and stability independently of question/rubric
 * semantics. Raw acquisition alone cannot establish assessment completeness. */
export function directManualObservationV1(record, target, hashValue) {
  try {
    const check=observation=>{
      if (!observation) return false;
      const clean=sanitizeCourseraCourseDataModel(observation.data);
      return !clean.limitReached && observation.data?.elements?.length===1 && observation.data.elements[0]?.id===target.id &&
      observation.data.paging?.next==null && observation.receipt?.resource==="authoringAssignmentManualGradedQuestions.v1" &&
      observation.receipt.id===target.id && observation.receipt.requestPath==="/api/authoringAssignmentManualGradedQuestions.v1/"+target.id &&
      observation.receipt.status===200 && observation.receipt.bodyFormat==="PARSED_SANITIZED_JSON_MODEL" &&
      Number.isFinite(Date.parse(observation.receipt.observedAt)) &&
      observation.receipt.requestQuery?.some(pair=>pair[0]==="id" && pair[1]===target.id) &&
      observation.receipt.requestQuery?.some(pair=>pair[0]==="fields" && pair[1]===CTI_DIRECT_MANUAL_FIELDS_V1) &&
      observation.receipt.requestQuery.length===2 &&
      directCanonicalSourceTextV1(clean.data)===directCanonicalSourceTextV1(observation.data) &&
      observation.modelSha256===hashValue(observation.data);
    };
    return record?.id===target.id && record.localId===target.localId && record.ordinal===target.ordinal && check(record.initial) && check(record.final) &&
      Date.parse(record.initial.receipt.observedAt)<=Date.parse(record.final.receipt.observedAt) &&
      directCanonicalSourceTextV1(record.initial.data)===directCanonicalSourceTextV1(record.final.data) && record.stable===true;
  } catch (_) {return false;}
}


/** Observed authoring response shape. This is question-content acquisition,
 * not execution of the configured grader or proof of a published revision.
 * Callers supply sanitized reader data or independently checked observations. */
export function directManualQuestionV1(model) {
  if (!model || !/^[A-Za-z0-9_-]{22}~[A-Za-z0-9_-]{22}$/.test(model.id || "") ||
      model.prompt?.typeName !== "cml" || model.prompt.definition?.dtdId !== "assess/1" ||
      typeof model.prompt.definition.value !== "string" ||
      model.submissionSchema?.typeName !== "richText" || !Array.isArray(model.rubrics) || model.rubrics.length>100) return null;
  const fields=Object.fromEntries(CTI_DIRECT_MANUAL_FIELDS_V1.split(",").filter(key=>Object.hasOwn(model,key)).map(key=>[key,model[key]]));
  return {kind:"MANUAL_SUBMISSION",graderClassification:model.graderType === "AI" ? "AI" : "UNKNOWN",sourceState:"CURRENT_AUTHORING_QUESTION",publishedBodyVerified:false,fields};
}
