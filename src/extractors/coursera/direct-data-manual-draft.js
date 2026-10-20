import { directManualPartTargetsV1, directManualObservationV1, directManualQuestionV1 } from "./direct-data-native-observations.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import { directCmlMediaInventoryV1 } from "./direct-data-media-contracts.js";
import { directSourceBindingEvidenceV1, directAssessmentMetadataCoverageV1, applyDirectContractV1 } from "./direct-data-contracts.js";

/** Complete only the observed AI/rich-text authoring schema. No publication,
 * answer key, grader execution or unknown grader semantics are inferred. */
export function directManualDraftModelV1(b, r, hash) {
  const d=b?.draft?.content?.definition, t=directManualPartTargetsV1(b),
    same=(a,c)=>directCanonicalSourceTextV1(a)===directCanonicalSourceTextV1(c),
    text=c=>{
      if(c?.typeName!=="cml" || c.definition?.dtdId!=="assess/1") return null;
      const p=directCmlMediaInventoryV1(c.definition.value);
      return p.valid && !p.references.length ? p.text : null;
    };
  if(!t.length || t.length!==d.parts.length ||
      d.parts.some(p=>Object.keys(p).some(k=>!["typeName","definition"].includes(k)) ||
        Object.keys(p.definition).some(k=>k!=="id")) ||
      r?.method!=="BOUND_AUTHORING_DRAFT_API" || r.courseId!==b.courseId ||
      r.itemId!==b.itemId || r.assignmentId!==b.atomId || !same(r.rawParts,d.parts) ||
      !Array.isArray(r.manualDefinitions) || r.manualDefinitions.length!==t.length ||
      !directAssessmentMetadataCoverageV1(d,d,d).valid ||
      Object.keys(d).some(k=>!["parts","configuration","introduction","reviewCriteria","passingFraction","assignmentLevelRubrics"].includes(k))) return null;
  const questions=[];
  for(let i=0;i<t.length;i++){
    const v=r.manualDefinitions[i], q=v?.initial?.data?.elements?.[0],
      m=directManualQuestionV1(q), prompt=text(q?.prompt);
    if(!directManualObservationV1(v,t[i],hash) || !m || m.graderClassification!=="AI" ||
        !same(m.fields,q) || prompt===null || !q.rubrics.length ||
        Object.keys(q.submissionSchema).some(k=>!["typeName","definition"].includes(k)) ||
        (q.submissionSchema.definition!==undefined &&
          (!q.submissionSchema.definition || typeof q.submissionSchema.definition!=="object" ||
            Array.isArray(q.submissionSchema.definition) || Object.keys(q.submissionSchema.definition).length)) ||
        (q.graderInstructions!==undefined && q.graderInstructions!=="") ||
        q.schema!==undefined) return null;
    const seen=new Set();
    for(const a of q.rubrics){
      if(typeof a?.id!=="string" || !a.id || seen.has(a.id) ||
          Object.keys(a).some(k=>!["id","details","prompt"].includes(k)) ||
          a.details?.typeName!=="multiLineInput" ||
          Object.keys(a.details).some(k=>!["typeName","definition"].includes(k)) ||
          Object.keys(a.details.definition || {}).some(k=>k!=="points") ||
          !Number.isFinite(a.details.definition?.points) || a.details.definition.points<0 ||
          text(a.prompt)===null) return null;
      seen.add(a.id);
    }
    questions.push({id:String(i+1),courseraQuestionId:t[i].id,sourceDefinitionId:t[i].id,
      sourceLocalId:t[i].localId,questionOrdinalObserved:true,type:"manual-submission",rawType:"storedManualGradedQuestionPart",
      textFormat:"PLAIN_TEXT",prompt,options:[],correctAnswers:[],feedback:"",
      points:q.rubrics.reduce((n,a)=>n+a.details.definition.points,0),
      answerTextReliable:false,optionTextReliable:false,answerKeyApplicable:false,
      answerKeyEvidence:{method:"AI_RUBRIC_SUBMISSION_NO_CHOICE_KEY",applicable:false},
      observationMethod:"BOUND_CURRENT_AUTHORING_MANUAL_DEFINITION",
      observedAtMs:Date.parse(v.initial.receipt.observedAt),manualSubmission:JSON.parse(JSON.stringify(m))});
  }
  return {schemaVersion:6,parser:"coursera-bound-manual-draft-v1",origin:"coursera-authoring-api",
    declaredQuestionCount:t.length,questionCount:t.length,answerEvidenceQuestionCount:0,questions,
    ...Object.fromEntries(["configuration","introduction","reviewCriteria","passingFraction","assignmentLevelRubrics"]
      .filter(k=>Object.hasOwn(d,k)).map(k=>[k,JSON.parse(JSON.stringify(d[k]))])),
    captureCompleteness:{declared:t.length,captured:t.length,declaredContentParts:t.length,
      questionCoverageComplete:true,requiredAnswerCoverageComplete:true,answerCoverageComplete:false,
      missingQuestionOrdinals:[],missingRequiredAnswerOrdinals:[],
      answerKeyApplicability:"NOT_APPLICABLE_AI_RUBRIC_SUBMISSION",
      stopReason:"COMPLETE_BOUND_DRAFT_MANUAL_ASSESSMENT"},
    sourceState:"AUTHORING_DRAFT",publishedBodyVerified:false,warnings:[]};
}

export function directManualDraftContractV1(fp,b,hash) {
  const p=fp.payload, e=directSourceBindingEvidenceV1(fp,b),
    s=p.directDataSources?.receipts, start=Date.parse(s?.atom?.observedAt), end=Date.parse(s?.stability?.receipt?.observedAt),
    a=e && fp.sourceIdentity?.published===false && directManualDraftModelV1(b,p.assessmentApiEvidence,hash);
  if(!a) return false;
  if(!Number.isFinite(start) || !Number.isFinite(end) || start>end ||
      !p.assessmentApiEvidence.manualDefinitions.every(r=>
        Date.parse(r.initial.receipt.observedAt)>=start && Date.parse(r.final.receipt.observedAt)<=end)) return false;
  p.structuredAssessment=a;
  p.directDataEvidence={...e,declaredContentParts:a.questionCount,
    verificationScope:"AUTHORING_DRAFT",publishedBodyVerified:false};
  p.directManualDraftEvidence={method:"BOUND_CURRENT_AUTHORING_MANUAL_DEFINITIONS",
    sourceDraftSha256:e.draftHash,questionCount:a.questionCount,
    publicationStatus:"UNPUBLISHED",publishedBodyVerified:false};
  applyDirectContractV1(fp,"COMPLETE_BOUND_DRAFT_MANUAL_ASSESSMENT",true);
  return true;
}
