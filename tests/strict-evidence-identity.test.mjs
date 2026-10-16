import test from 'node:test';
import assert from 'node:assert/strict';
import { qaPlanCourseraPayloadBindings_ } from '../src/engine/comparison/course.js';
import { qaApplyBrightspaceGroundTruth_, qaPlanBrightspaceTopicBindings_, create_qaParseBrightspaceGroundTruthCapture_ } from '../src/engine/source/brightspace-matching.js';
import { createBrowserServices } from '../src/adapters/browser-services.ts';
import { createWorkflows } from '../src/domain/workflows.ts';
import { workerXml } from '../src/adapters/worker-xml.ts';
import { comparisonFixture, encode } from './workflow-fixtures.mjs';

const row=(id,name='Repeated item',path='Module 1')=>({id,name,path,type:'Reading'});
const topic=(id,title='Repeated item',path='Module 1',activityTypeLabel='Reading')=>({id,title,path,activityTypeLabel,contentEvidence:{status:'CAPTURED',text:'Literal observed source text.'}});
const capture=(topics,extra={})=>({topics,quizzes:[],assignments:[],runtimeCarriers:[],interactiveEmbeds:[],course:{},...extra});
const source=(id,name='Repeated item',path='Module 1',type='Reading')=>({id,name,path,type,textSample:'',textLength:0});
const apply=(sources,topics,extra={})=>qaApplyBrightspaceGroundTruth_(structuredClone(sources),capture(topics,extra),{});

test('Coursera payload binds unique case-sensitive native IDs; names cannot override explicit identity',()=>{
  const canonical=[row('A'),row('B')], live=[row('B'),row('A')];
  assert.deepEqual(qaPlanCourseraPayloadBindings_(canonical,live).map(p=>live[p.liveIndex].id),['A','B']);
  for(const [items,reason] of [[[row('different')],'NATIVE_ITEM_ID_NOT_CAPTURED'],[[row('a')],'NATIVE_ITEM_ID_NOT_CAPTURED']]){
    const p=qaPlanCourseraPayloadBindings_([row('A')],items)[0];
    assert.equal(p.liveIndex,-1);assert.equal(p.reason,reason);assert.equal(p.candidates.length,1);
  }
  const missing=qaPlanCourseraPayloadBindings_([row('')],[row('A')])[0];
  assert.equal(missing.liveIndex,-1);assert.equal(missing.reason,'XLSX_ITEM_ID_MISSING');
});

test('duplicate capture or XLSX IDs remain unresolved regardless of input order',()=>{
  const duplicate=[row('A','First'),row('A','Second')];
  for(const live of [duplicate,[...duplicate].reverse()]){
    const p=qaPlanCourseraPayloadBindings_([row('A')],live)[0];
    assert.equal(p.liveIndex,-1);assert.equal(p.reason,'DUPLICATE_CAPTURE_ITEM_ID');
    assert.equal(p.candidates.length,2);
  }
  assert(qaPlanCourseraPayloadBindings_(duplicate,[row('A')]).every(p=>p.liveIndex===-1 && p.reason==='DUPLICATE_XLSX_ITEM_ID'));
});

test('full comparison never copies same-title content from another Coursera ID',()=>{
  const workflows=createWorkflows(workerXml), input=comparisonFixture();
  const raw=JSON.parse(new TextDecoder().decode(input.json.bytes));
  raw.fingerprints[0].id='another-native-item';
  raw.fingerprints[0].payload.textSample='Wrong item payload sentinel';
  input.json.bytes=encode(raw);
  const result=workflows.compare(input);
  assert.equal(result.result.success,true);
  const binding=result.result.stats.extractorMeta.payloadBindingDiagnostics.find(p=>p.itemId==='reading');
  assert.equal(binding.reason,'NATIVE_ITEM_ID_NOT_CAPTURED');
  const item=result.result.ownerView.items.find(p=>p.id==='reading');
  assert(item);
  assert(!JSON.stringify(item).includes('Wrong item payload sentinel'));
});

test('duplicate captured native IDs retain both observations as evidence-only rather than taking the first body',()=>{
  const input=comparisonFixture(), raw=JSON.parse(new TextDecoder().decode(input.json.bytes));
  raw.fingerprints.unshift({...structuredClone(raw.fingerprints[0]),payload:{textSample:'Duplicate payload sentinel',textLength:26}});
  input.json.bytes=encode(raw);
  const result=createWorkflows(workerXml).compare(input).result;
  assert.equal(result.success,true);
  assert.equal(result.stats.liveEvidenceOnlyNodeCount,2);
  assert.equal(result.stats.extractorMeta.payloadBindingDiagnostics.find(p=>p.itemId==='reading').reason,'DUPLICATE_CAPTURE_ITEM_ID');
  assert(!JSON.stringify(result.ownerView.items.find(p=>p.id==='reading')).includes('Duplicate payload sentinel'));
});

test('Brightspace repeated titles resolve by unique placement in either order',()=>{
  const sources=[source('package-one','Repeated item','Module 1'),source('package-two','Repeated item','Module 2')];
  const topics=[topic('10','Repeated item','Module 1 > Assess'),topic('20','Repeated item','Module 2')];
  for(const s of [sources,[...sources].reverse()])for(const t of [topics,[...topics].reverse()]){
    const result=apply(s,t), mappings=result.report.sourceTopicMappings;
    assert.equal(mappings.length,2);
    assert.deepEqual(Object.fromEntries(mappings.map(m=>[m.sourceId,m.topicId])),{'package-one':'10','package-two':'20'});
    assert(result.sourceItems.every(item=>item.textSample==='Literal observed source text.'));
  }
});

test('ties, duplicate IDs, absent placement and similar names never enrich source content',()=>{
  for(const topics of [[topic('10'),topic('11')],[topic('10'),topic('10')],[topic('10','Repeated item','Other module')],[topic('10','Repeated items')]]){
    const result=apply([source('package')],topics);
    assert.equal(result.report.sourceTopicMappings.length,0);
    assert.equal(result.sourceItems[0].textSample,'');
    assert.equal(result.sourceItems[0].liveSource,undefined);
    assert.equal(result.report.status,'REVIEW');
    assert(result.report.evidenceReviews.some(r=>r.kind==='SOURCE_TOPIC_IDENTITY_UNRESOLVED'));
  }
  assert.equal(qaPlanBrightspaceTopicBindings_([source('s','Repeated item','Root')],[topic('10','Repeated item','Root')])[0].topicIndex,-1);
});

test('duplicate source claims cannot turn a shared topic into an order-dependent match',()=>{
  const result=apply([source('p1'),source('p2')],[topic('10')]);
  assert(result.sourceItems.every(s=>!s.liveSource && !s.textSample));
  assert(result.report.sourceTopicCandidates.every(p=>p.reason==='TOPIC_CLAIMED_BY_MULTIPLE_SOURCE_ITEMS'));
  assert.equal(result.report.liveOnlyCount,1);
});

test('identity context preserves meaningful punctuation and non-Latin names; quiz and assignment tools stay separate',()=>{
  for(const [s,t] of [
    [source('p','A+B'),topic('10','A-B')],
    [source('p','课程 1'),topic('10','另一个 1')],
    [source('p','Quiz','Module 1','Assessment'),topic('10','Quiz','Module 1','Assignment')],
  ])assert.equal(apply([s],[t]).report.sourceTopicMappings.length,0);
});

test('explicit native topic identity can bind a renamed item; package IDs never masquerade as native IDs',()=>{
  const observed=topic('10','Renamed item','Moved module');
  const native={...source('package'),nativeIdentity:{platform:'BRIGHTSPACE',topicId:'10'}};
  const result=apply([native],[observed]);
  assert.equal(result.report.sourceTopicMappings[0].identityMethod,'NATIVE_TOPIC_ID');
  assert.equal(result.report.sourceTopicMappings[0].navigationEligible,true);
  assert.equal(apply([source('10')],[observed]).report.sourceTopicMappings.length,0);
  native.nativeIdentity.topicId='different';
  assert.equal(apply([native],[topic('10')]).report.sourceTopicMappings.length,0);
});

const quiz=id=>({id,name:'Weekly quiz',questionsStatus:'CAPTURED',questions:[{QuestionId:'question',QuestionTypeId:1,QuestionText:{Text:'Source question?'},QuestionInfo:{Answers:[{Answer:{Text:'A'},Weight:100},{Answer:{Text:'B'},Weight:0}]}}]});
test('quiz definitions require the exact unique tool-item ID, never a same-title fallback',()=>{
  const s=source('p','Weekly quiz','Module 1','Assessment'), t={...topic('10','Weekly quiz','Module 1','Quiz'),toolItemId:'quiz-one'};
  const good=apply([s],[t],{quizzes:[quiz('quiz-two'),quiz('quiz-one')]});
  assert(good.sourceItems[0].structuredAssessment);
  for(const quizzes of [[quiz('quiz-two')],[quiz('quiz-one'),quiz('quiz-one')]]){
    const result=apply([s],[t],{quizzes,quizByName:{'weekly quiz':quizzes[0]}});
    assert.equal(result.sourceItems[0].structuredAssessment,undefined);
    assert(result.report.evidenceReviews.some(r=>r.kind==='QUIZ_DEFINITION_IDENTITY_UNRESOLVED'));
  }
  delete t.toolItemId;
  assert.equal(apply([s],[t],{quizzes:[quiz('quiz-one')]}).sourceItems[0].structuredAssessment,undefined);
});

test('runtime families belong to exact topic IDs, including repeated same-title widgets',()=>{
  const s=source('p'), t=topic('10');
  const result=apply([s],[t],{runtimeCarriers:[{id:'different',title:s.name,family:'SCORM'}],interactiveEmbeds:[{topicId:'different',topicTitle:s.name,family:'H5P'}]});
  assert.equal(result.sourceItems[0].interactiveSignals,undefined);
  const exact=apply([s],[t],{runtimeCarriers:[{id:'10',title:'Renamed',family:'SCORM'}]});
  assert.deepEqual(exact.sourceItems[0].interactiveSignals.runtimeFamilies,['SCORM']);
});

test('assignment settings require a unique exact tool ID and stay separate from quiz definitions',()=>{
  const s=source('p','Assignment','Module 1','Assignment'), t={...topic('10','Assignment','Module 1','Assignment'),toolItemId:'a-one'};
  const assignment=id=>({id,name:s.name,raw:{SubmissionType:4,Assessment:{ScoreDenominator:12}}});
  const result=apply([s],[t],{assignments:[assignment('a-one')]});
  assert.equal(result.sourceItems[0].behavior.settings.points,12);
  for(const assignments of [[assignment('different')],[assignment('a-one'),assignment('a-one')]]){
    const wrong=apply([s],[t],{assignments,assignmentByName:{assignment:assignments[0]},quizzes:[quiz('a-one')]});
    assert.equal(wrong.sourceItems[0].behavior,undefined);
    assert(wrong.report.evidenceReviews.some(r=>r.kind==='ASSIGNMENT_DEFINITION_IDENTITY_UNRESOLVED'));
  }
});

test('Brightspace parser retains duplicate models while refusing last-write ID/name indexes',()=>{
  const parse=create_qaParseBrightspaceGroundTruthCapture_(createBrowserServices());
  const raw={extractor:'CTI Brightspace',schemaVersion:2,quizzes:[quiz('same'),quiz('same')],assignments:[]};
  const parsed=parse(Buffer.from(JSON.stringify(raw)).toString('base64'),'source.json');
  assert.equal(parsed.quizzes.length,2);assert.equal(parsed.quizById.same,null);assert.equal(parsed.quizByName['weekly quiz'],null);
});
