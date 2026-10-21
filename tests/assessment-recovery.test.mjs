import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessmentRecoveryPlans} from '../src/reporting/assessment-recovery.js';
import {assessmentMediaResolution} from '../src/engine/assessment/media-recovery.js';
import {questionIdentityCandidates} from '../src/engine/assessment/identity-candidates.js';
import {questionEvidenceDimensions} from '../src/engine/assessment/question-dimensions.js';
import {qaBrightspaceQuizQuestion_} from '../src/engine/source/brightspace-assessment.js';
import {DOMParser} from '@xmldom/xmldom';
import {qtiScoringDefinition_,parseQtiAssessmentStructure_} from '../src/source/qti.js';
import {contentQuestion} from '../src/domain/content-evidence.ts';
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/coursera/trde120-assessment-recovery.json',import.meta.url)));

test('exact saved comparison records five empty weekly editors without proving course-wide absence',()=>{
  assert.equal(f.auditId,'b00f533c-91ed-4865-a2e7-97b2559d95fc');
  const before=JSON.stringify(f), plans=assessmentRecoveryPlans(f,f.contentEvidence);
  for(const [id,count] of [['06PMM',2],['aKtOx',8],['vY3GP',3],['vwFDB',8],['Kd5up',12]]){
    const p=plans.find(p=>p.destinationId===id);
    assert.equal(p.destinationState,'RECORDED_EMPTY_EDITOR');assert.equal(p.sourceDefinitions,count);assert.equal(p.destinationPositions,0);
    assert.match(p.reason,/other candidate carriers/);assert.equal(p.automatedResolution,false);
  }
  assert.equal(JSON.stringify(f),before);
});
test('actual final assessment repair manifest retains separate source media gaps and exact failed destination IDs',()=>{
  const p=assessmentRecoveryPlans(f,f.contentEvidence).find(p=>p.destinationId==='LFrHs');
  assert.deepEqual(p.destinationFailures.map(q=>q.ordinal),['2','4']);
  assert.ok(p.destinationFailures.every(q=>q.questionId.startsWith('RwzXxrTaEfGOPAr_0ssJ-Q~') && q.sourceQuestionBinding==='UNVERIFIED'));
  assert.equal(p.sourceMedia.filter(m=>m.status==='NOT_IN_PACKAGE').length,4);
  const moved=p.sourceMedia.find(m=>m.status==='PRESENT_DIFFERENT_PATH');
  assert.equal(moved.sourceQuestionOrdinal,2);assert.equal(moved.resolution.status,'FILENAME_CANDIDATES_ONLY');assert.equal(moved.resolvedOriginal,null);
});
test('actual nine exact question candidates retain unresolved scoring, media and published contracts',()=>{
  const pairs=questionIdentityCandidates(f.contentEvidence);
  assert.equal(pairs.filter(p=>p.status==='EXACT_TEXT_CANDIDATE').length,9);
  for(const p of pairs){assert.equal(p.completeContent,false);assert.equal(p.parity.dimensions.scoring.status,'UNVERIFIED');assert.equal(p.parity.dimensions.version.status,'UNVERIFIED');}
});
test('same prompts cannot conceal different answers or missing scoring semantics',()=>{
  const q={id:'a',type:'text-entry',prompt:'Calculate this value.',options:[],answers:['1'],answerKeyReliable:true,limitations:[]};
  const p=questionEvidenceDimensions(q,{...q,id:'b',answers:['2']});
  assert.equal(p.dimensions.prompt.status,'VERIFIED');assert.equal(p.dimensions.answers.status,'DIFFERENT');assert.equal(p.status,'DIFFERENT');
  assert.equal(questionEvidenceDimensions(q,{...q}).status,'UNVERIFIED');
});
test('media relocation requires exact content identity; filenames alone and conflicting bytes never resolve',()=>{
  const a='a'.repeat(64),b='b'.repeat(64),assets=[{path:'other/image.png',sha256:a,integrity:'VERIFIED_RETAINED_ORIGINAL',originalRef:'files/'+a}];
  assert.equal(assessmentMediaResolution({ref:'image.png'},assets,true).status,'FILENAME_CANDIDATES_ONLY');
  assert.equal(assessmentMediaResolution({ref:'image.png',sha256:a},assets,true).status,'CONTENT_HASH_RELOCATION');
  assert.equal(assessmentMediaResolution({ref:'other/image.png',sha256:b},assets,true).status,'CONTENT_IDENTITY_CONFLICT');
  assert.equal(assessmentMediaResolution({ref:'missing.png'},assets,true).status,'NOT_IN_SUPPLIED_PACKAGE');
  assert.equal(assessmentMediaResolution({ref:'missing.png'},[],false).status,'ASSET_INVENTORY_UNVERIFIED');
  assert.equal(assessmentMediaResolution({ref:'other/image.png'},assets,true).learnerRenderingVerified,false);
});
test('Brightspace question HTML exposes original media references without fetching or discarding definitions',()=>{
  const raw={QuestionId:'native-q',QuestionTypeId:7,QuestionText:{Html:'<p>Draw this.</p><img src="Content/wall.png?x=1&amp;y=2">'},QuestionInfo:{},Points:2};
  const q=qaBrightspaceQuizQuestion_(raw,0);
  assert.deepEqual(q.mediaRefs,['Content/wall.png?x=1&y=2']);
  assert.deepEqual(q.sourceTypeEvidence.definition.QuestionText,raw.QuestionText);
  assert.equal(q.answerTextReliable,false);
});
test('reference-only source policy never produces assessment repair tasks',()=>{
  const r=structuredClone(f);r.itemResults.forEach(r=>r.operationalPolicy={inDecisionGate:false});
  assert.deepEqual(assessmentRecoveryPlans(r,r.contentEvidence),[]);
});
test('actual external practice reference retains provider but cannot certify widget bodies',()=>{
  const p=assessmentRecoveryPlans(f,f.contentEvidence,f.contentComparisons).find(p=>p.destinationId==='zBBdG');
  assert.equal(p.sourceWidgets[0].originalUrl,'https://opentextbc.ca/mathfortrades1/?p=156/#main');
  assert.equal(p.sourceWidgets[0].questionBodyStatus,'UNVERIFIED');
  assert.equal(p.sourceWidgets[0].configurationStatus,'UNVERIFIED');
  assert.equal(p.sourceWidgets[0].provider,'opentextbc.ca');
});
test('QTI numeric boundaries and wildcard processing survive projection without an invented interpretation',()=>{
  const doc=new DOMParser().parseFromString('<item ident="q"><resprocessing><respcondition><conditionvar><and><vargte respident="r">88.580</vargte><varlte respident="r">88.586</varlte></and></conditionvar><setvar action="Set">100</setvar></respcondition><respcondition><conditionvar><varequal respident="r">*</varequal></conditionvar><setvar action="Set">0</setvar></respcondition></resprocessing></item>','text/xml');
  const tree=qtiScoringDefinition_(doc.documentElement);
  const q=contentQuestion({id:'q',type:'text-entry',prompt:'Calculate the material.',sourceTypeEvidence:{method:'QTI_RESPONSE_AND_CC_PROFILE',identity:{itemId:'q',file:'quiz.xml'},scoringDefinition:tree},options:[],correctAnswers:['88.583','*'],answerTextReliable:false});
  assert.deepEqual(JSON.parse(q.settingsText).scoringDefinition,tree);
  assert.match(q.settingsText,/88.580/);assert.match(q.settingsText,/vargte/);
  assert.equal(q.answerKeyReliable,false);
});
test('QTI wildcard-like alternatives remain retained but cannot certify literal answer semantics',()=>{
  const previous=globalThis.DOMParser;globalThis.DOMParser=DOMParser;
  try {
    const make=value=>parseQtiAssessmentStructure_(`<questestinterop><item ident="q"><presentation><material><mattext>Enter the calculated result.</mattext></material><response_str ident="r"/></presentation><responseDeclaration identifier="r"><correctResponse><value>${value}</value></correctResponse></responseDeclaration></item></questestinterop>`,'questions.xml');
    const wildcard=make('*');assert.deepEqual(wildcard.questions[0].correctAnswers,['*']);assert.equal(wildcard.questions[0].answerTextReliable,false);
    assert.equal(make('27').questions[0].answerTextReliable,true);
    assert.ok(JSON.stringify(wildcard).includes('literal versus pattern semantics'));
  }finally{globalThis.DOMParser=previous;}
});
