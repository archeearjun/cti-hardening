const observation = (status, reason) => ({status, reason});
const unknown = reason => observation('UNVERIFIED', reason);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
/** Compare retained projections, never invent missing grading or publication evidence. */
export function questionEvidenceDimensions(source, destination) {
  const compare = (a,b,known,scope) => known ? observation(equal(a,b)?'VERIFIED':'DIFFERENT',scope) : unknown(`${scope}: insufficient explicit evidence.`);
  const limits = q => (q.limitations || []).some(s => /truncat|prompt not captured|math.*unverified/i.test(s));
  const types = ['single-select','multiple-select','true-false','text-entry','essay','regex'];
  const dimensions = {
    prompt: compare(source.prompt,destination.prompt,typeof source.prompt==='string' && source.prompt.length>0 && typeof destination.prompt==='string' && destination.prompt.length>0 && !limits(source) && !limits(destination),'Exact retained prompt projection; original markup and media remain separate'),
    type: compare(source.type,destination.type,types.includes(source.type) && types.includes(destination.type),'Supported normalized question types; native manual-submission labels require an independent response/grading contract'),
    options: compare(source.options?.map(o=>o.text),destination.options?.map(o=>o.text),Array.isArray(source.options) && source.options.length>0 && Array.isArray(destination.options) && destination.options.length>0 && ![source,destination].some(q=>(q.limitations||[]).some(s=>/choice.*(unverified|truncat)/i.test(s))),'Ordered option text only; identifiers and selection semantics remain distinct'),
    answers: compare(source.answers,destination.answers,source.answerKeyReliable===true && destination.answerKeyReliable===true && Array.isArray(source.answers) && Array.isArray(destination.answers),'Retained answer-key text, not independent correctness or numeric tolerance'),
    feedback: compare(source.feedback,destination.feedback,source.feedbackCoverage==='CAPTURED' && destination.feedbackCoverage==='CAPTURED','Explicitly captured feedback text'),
    scoring: unknown('Weights, numeric tolerances and wildcard behavior require original scoring definitions.'),
    structuredMath: unknown('Matching text projections do not prove original mathematical markup fidelity.'),
    rubric: unknown('Rubric and grading semantics require independently bound definitions.'),
    attemptsAndTime: unknown('Quiz-level attempt and time policies require independent source bindings.'),
    media: unknown('Matching references or prompt text do not verify original asset identity or rendering.'),
    version: unknown('Current authoring observations do not establish published-version equivalence.'),
  };
  return {sourceQuestionId:source.id,destinationQuestionId:destination.id,scope:'RETAINED_QUESTION_PROJECTIONS',dimensions,status:Object.values(dimensions).some(d=>d.status==='DIFFERENT')?'DIFFERENT':'UNVERIFIED',completeContent:false};
}
