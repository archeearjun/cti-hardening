import assert from 'node:assert/strict';
import {extractorFunctions} from './extractor-functions.cjs';

export function fixtureCourseraAssessmentProgram(source,shell){
const functions=extractorFunctions(source);
let program=source;
const substitutes={
 sleepMs:`async function sleepMs(ms){
  if(ms===350){await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}
  else await new Promise(resolve=>setTimeout(resolve,1));
 }`,
 readingRouteTemplateV61312:'function readingRouteTemplateV61312(){return {fixture:true}}',
 readingRouteForTargetV61311:'function readingRouteForTargetV61311(fp){return "fixture:"+fp.id}',
 recoverTypedEditorV61317:'async function recoverTypedEditorV61317(){return {attempted:false,captured:false,reason:"EXTERNAL_FIXTURE"}}',
 returnToOutlineV6142:`async function returnToOutlineV6142(){history.replaceState(null,'',${JSON.stringify(shell)});document.getElementById('editor').style.display='none'}`,
 hydrateOutlineSurfaceForCrawl:'async function hydrateOutlineSurfaceForCrawl(){return {fixture:true}}',
 crawlTargetPriority:'function crawlTargetPriority(){return 1}',
 interleaveCrawlTargetsV61313:'function interleaveCrawlTargetsV61313(targets){return targets}',
 findNavigationTargetForFingerprint:`async function findNavigationTargetForFingerprint(fp){if(fp.id!=='assessment-under-test')return null;return {element:document.getElementById('open-assessment'),score:1,reason:'visible-attribute-id',text:fp.name}}`,
 editorControlCandidates:`function editorControlCandidates(){return [{element:document.getElementById('open-assessment'),label:'Open assessment',tag:'button',score:1}]}`,
 dispatchReadOnlyEditorControl:`function dispatchReadOnlyEditorControl(control){control.element.click();history.replaceState(null,'',${JSON.stringify(shell + '/assessment/assessment-under-test')});return {attempted:true,mode:'history-popstate'}}`,
 findOpenedEditorSurface:`function findOpenedEditorSurface(){return {root:document.getElementById('editor'),score:1}}`,
 findCurrentEditorSurface:`function findCurrentEditorSurface(){return {root:document.getElementById('editor'),score:1}}`,
 waitForItemEvidenceStability:`async function waitForItemEvidenceStability(){return {surface:{root:document.getElementById('editor'),score:1},dwellMs:1,samples:3,evidenceChanges:0,timedOut:false}}`,
 recoverReadingRouteV61311:`async function recoverReadingRouteV61311(fp){
  const visits=JSON.parse(localStorage.getItem('fixture-reading-visits') || '[]');visits.push(fp.id);localStorage.setItem('fixture-reading-visits',JSON.stringify(visits));
  const text='Observed learner text café 日本語 '+fp.id;
  return {attempted:true,captured:true,route:'fixture:'+fp.id,dwellMs:1,samples:3,evidence:{textSample:text,textConfidence:'high',textEvidenceCompleteness:1,
    readingEditorEvidence:{itemId:fp.id},textCaptureEvidence:{method:'EXACT_READING_FIELD',scope:'EXACT_READING_FIELD',itemId:fp.id,observedCharacters:text.length,capturedCharacters:text.length}}};}`,
};
for(const [name,replacement] of Object.entries(substitutes)){
 const original=functions.get(name);assert(original,`Missing external boundary ${name}`);program=program.replace(original,replacement);
}
return program;
}
