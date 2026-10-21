/** A read-only work plan anchored to recorded IDs, never a replacement verdict. */
import { assessmentMediaResolution } from "../engine/assessment/media-recovery.js";
export function assessmentRecoveryPlans(result = {}, snapshot = {}, contentComparisons = []) {
  const destination = new Map((snapshot.coursera || []).map(i=>[i.id,i]));
  const views = new Map(contentComparisons.map(i=>[i.id,i.view]));
  return (result.itemResults || []).flatMap(row=>{
    if(row.operationalPolicy?.inDecisionGate===false || row.operationalPolicy?.classification==='NON_LFM_POLICY_EXEMPT') return [];
    const item=destination.get(row.courseraId), content=item?.content;
    const assessment=row.checks?.structuredAssessment;
    const runtime=row.checks?.runtime;
    if(!content || (!assessment && !runtime)) return [];
    const questions=content.questions || [];
    const failures=questions.filter(q=>/\[Error: Image could not be created\]/i.test(q.prompt || ''));
    if(!assessment && !/^(?:Assignment|Assessment|Quiz|Ungraded Assignment)$/i.test(row.courseraType || '') && !failures.length) return [];
    const empty=content.questionCoverage==='EMPTY' && content.expectedQuestions===0 && questions.length===0;
    const gaps=assessment?.sourcePackageMediaGaps || [];
    const external=runtime?.detected===true && runtime.required===true;
    if(!assessment && !external && !failures.length) return [];
    return [{sourceId:row.sourceId,destinationId:row.courseraId,name:row.courseraName,path:row.courseraPath||row.sourcePath,url:content.url,
      sourceDefinitions:assessment?.sourceQuestionCount ?? null,
      sourceInventoryScope:'Captured definitions are not proof of full bank/pool membership.',
      destinationPositions:questions.length,destinationState:empty?'RECORDED_EMPTY_EDITOR':content.nativeGrading?.sourceState||'STATE_UNVERIFIED',
      action:failures.length?'Repair Coursera':empty?'Inspect manually':external?'Request source material':'Run focused check',
      reason:failures.length?'Explicit destination image-creation errors require repair; identify the intended source question independently.':empty?'This recorded editor has zero positions. Check transformation records and other candidate carriers before deciding where to restore source questions.':external?'EXTERNAL_QUESTION_BODY_UNVERIFIED: recorded runtime references do not establish acquired question bodies or learner behavior.':'Reuse retained definitions; inspect only the unresolved item-specific contract.',
      destinationFailures:failures.map(q=>({questionId:q.id,ordinal:q.ordinal,placeholder:q.prompt,sourceQuestionBinding:'UNVERIFIED',learnerRenderingVerified:false})),
      sourceMedia:gaps.map(g=>({sourceQuestionOrdinal:g.question,sourceQuestionId:g.sourceQuestionId||null,sourceFile:g.sourceFile||null,originalRef:g.ref,expectedPath:g.expectedPath,status:g.status,candidatePaths:g.candidates||[],resolution:assessmentMediaResolution(g,(g.candidates||[]).map(path=>({path})),g.status==='NOT_IN_PACKAGE'),resolvedOriginal:null,action:g.status==='NOT_IN_PACKAGE'?'Request source material':'Inspect manually',reason:g.status==='NOT_IN_PACKAGE'?'Absent from the inspected package inventory, not proven absent from the LMS. Use Check source assessment assets with the original package, or obtain authorized live-source evidence.':'Use Check source assessment assets to read original package bytes. Filename/path candidates alone do not establish question/image identity or live reference validity.'})),
      references:content.references||[],
      sourceWidgets:external ? [...new Set((views.get(row.courseraId)?.source || []).flatMap(s=>s.references || []))].flatMap(originalUrl=>{
        try {const u=new URL(originalUrl);if(u.protocol!=='https:' || u.username || u.password || [...u.searchParams.keys()].some(k=>/token|secret|signature|credential|authorization|password|session/i.test(k)))return [];
          return [{originalUrl,provider:u.hostname,observations:(views.get(row.courseraId)?.source||[]).filter(s=>(s.references||[]).includes(originalUrl)).map(s=>({basis:s.basis,capturedAt:s.capturedAt,url:s.url})),referenceStatus:'ACQUIRED_REFERENCE',configurationStatus:'UNVERIFIED',questionBodyStatus:'UNVERIFIED',runtimeStatus:'UNVERIFIED',learnerBehaviorStatus:'UNVERIFIED',action:['opentextbc.ca','pressbooks.bccampus.ca'].includes(u.hostname)?'Use the existing public source-question recovery on this item; retain a supported definition receipt before comparing questions.':'Inspect manually; no supported acquisition contract is established.'}];
        }catch{return [];}
      }) : [],publishedParity:'UNVERIFIED',automatedResolution:false}];
  });
}

export function assessmentRecoveryText(result, snapshot, contentComparisons) {
  const plans=assessmentRecoveryPlans(result,snapshot,contentComparisons);
  if(!plans.length)return '';
  const lines=['Assessment recovery — recorded evidence, not new verification'];
  for(const p of plans){
    lines.push(`${p.action} | ${p.sourceId} → ${p.destinationId} (${p.name}) | ${p.path || 'placement unrecorded'}`,
      `  ${p.reason} Source definitions: ${p.sourceDefinitions ?? 'unverified'}; destination positions: ${p.destinationPositions}; ${p.destinationState}. ${p.sourceInventoryScope}`);
    if(p.url)lines.push(`  ${p.url}`);
    for(const w of p.sourceWidgets)lines.push(`  Source reference: ${w.originalUrl} | provider ${w.provider}; configuration, question body, runtime and Coursera learner behavior UNVERIFIED. ${w.action}`);
    for(const q of p.destinationFailures)lines.push(`  Repair question ${q.ordinal} [${q.questionId}]: explicit image-creation placeholder. Intended source-question binding is UNVERIFIED; do not pair by ordinal. Learner rendering unverified.`);
    for(const m of p.sourceMedia)lines.push(`  ${m.action} | source question position ${m.sourceQuestionOrdinal}: ${m.originalRef} | ${m.status}; expected ${m.expectedPath}; candidates: ${m.candidatePaths.join(', ')||'none'}. ${m.reason}`);
  }
  return lines.join('\n');
}
