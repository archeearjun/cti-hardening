import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";

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
    const check=observation=>observation && observation.data?.elements?.length===1 && observation.data.elements[0]?.id===target.id &&
      observation.data.paging?.next==null && observation.receipt?.resource==="authoringAssignmentManualGradedQuestions.v1" &&
      observation.receipt.id===target.id && observation.receipt.requestPath==="/api/authoringAssignmentManualGradedQuestions.v1/"+target.id &&
      observation.receipt.status===200 && observation.receipt.bodyFormat==="PARSED_SANITIZED_JSON_MODEL" &&
      Number.isFinite(Date.parse(observation.receipt.observedAt)) && observation.modelSha256===hashValue(observation.data);
    return record?.id===target.id && record.ordinal===target.ordinal && check(record.initial) && check(record.final) &&
      Date.parse(record.initial.receipt.observedAt)<=Date.parse(record.final.receipt.observedAt) &&
      directCanonicalSourceTextV1(record.initial.data)===directCanonicalSourceTextV1(record.final.data) && record.stable===true;
  } catch (_) {return false;}
}

