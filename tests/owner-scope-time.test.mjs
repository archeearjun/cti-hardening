import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerScope, referenceArea, ownerHierarchy, groupTasks } from '../src/domain/owner-scope.ts';
import { capturedTime, timeMinutes, taskTimes, timeTotals, moduleTimes, moduleTimesText } from '../src/domain/owner-time.ts';
import { buildOwnerTasks, needsOwnerAction, validateOwnerReview } from '../src/domain/owner-actions.ts';
import { buildContentSnapshot } from '../src/domain/content-evidence.ts';
import { recordSummary, newRecord } from '../src/domain/workspace-store.ts';
import { normalizeCourseraItem_ } from '../src/engine/capture/normalization.js';
import { qaMergeCourseraPayload_ } from '../src/engine/capture/recovery.js';
import { qaAssessDestinationReadiness_ } from '../src/engine/readiness/destination.js';
import { qaOneToManyAggregateForSource_ } from '../src/engine/provenance/transformations.js';
import { parseCourseraTimeEstimate } from '../src/extractors/coursera/time-estimates.js';
import { comparisonFixture } from './workflow-fixtures.mjs';
import { createWorkflows } from '../src/domain/workflows.ts';
import { workerXml } from '../src/adapters/worker-xml.ts';
const day1='2026-10-01T10:00:00Z', day2='2026-10-02T10:00:00Z';
const task=(id,path='Module 1 > Lesson 1',minutes=10)=>buildOwnerTasks({ownerView:{items:[{id,name:id,path,status:'REVIEW',actions:[{action:'Verify source',severity:'REVIEW'}]}]}},[],'', [{id,content:{url:'',timeEstimate:capturedTime({timeEstimateMinutes:minutes},day1)}}])[0];

test('reference folders are excluded at any ancestor; words in learner titles and source matches do not hide learner items',()=>{
  for(const path of ['Instructor Resources > Guides','Week 1 > Archive > Lesson 1','instructional resources','Instruction Resources','Archives']) {
    const t=task('item',path); assert.equal(ownerScope(t).included,false,path); assert.equal(needsOwnerAction(t),false);
    assert.equal(needsOwnerAction(t,{relevance:'relevant'}),true);
  }
  for(const path of ['Student Resources','Researching archives','Week 1 > Archival methods'])assert.equal(referenceArea(path),false,path);
  const t=task('Archive','Week 1');t.findings=[{sourcePath:'Archive'}];
  assert.equal(ownerScope(t).included,true);
  t.sourceOnly=true;assert.equal(ownerScope(t).included,false);
  t.findings.push({sourcePath:'Week 1'});assert.equal(ownerScope(t).included,true);
  assert.equal(ownerScope(t,{relevance:'not_relevant'}).included,false);
  assert.equal(ownerScope(t,{relevance:'auto'}).included,true);
});
test('nesting preserves module/lesson order and separate repeated names',()=>{
  const tasks=[task('a'),task('b'),task('c','Module 1 > Lesson 2'),task('d','Module 2'),task('e','Module 1 > Lesson 1')];
  const groups=ownerHierarchy(tasks);
  assert.deepEqual(groups.map(g=>g.title),['Module 1','Module 2','Module 1']);
  assert.deepEqual(groups[0].children.map(g=>g.title),['Lesson 1','Lesson 2']);
  assert.deepEqual(groups.flatMap(groupTasks).map(t=>t.id),['a','b','c','d','e']);
});
test('XLSX lesson metadata reaches the checklist while matching still uses the module',()=>{
  const input=comparisonFixture(),output=createWorkflows(workerXml).compare(input);
  const row=output.result.ownerView.items[0];
  assert.equal(row.path,'Module 1');assert.equal(row.lesson,'Lesson 1');
  assert.equal(buildOwnerTasks(output.result)[0].path,'Module 1 > Lesson 1');
  delete row.lesson;
  const snapshot=[{id:row.id,path:'Module 1 > Old lesson',content:{url:''}}];
  assert.equal(buildOwnerTasks(output.result,[],'',snapshot)[0].path,'Module 1 > Old lesson');
  snapshot[0].path='Other module > Wrong lesson';
  assert.equal(buildOwnerTasks(output.result,[],'',snapshot)[0].path,'Module 1');
});
test('unknown time is distinct from zero throughout normalization, merging and readiness',()=>{
  for(const v of [null,undefined,'',' ',false,true,-2,NaN,Infinity,'bad',[],{}]) {
    assert.equal(timeMinutes(v),null);
    const item=normalizeCourseraItem_({id:'v',name:'Video',type:'Video',payload:{timeEstimateMinutes:v}});
    assert.equal(item.timeEstimateMinutes,null,String(v));
    assert.equal(qaAssessDestinationReadiness_([item]).findings.some(f=>f.code==='ZERO_MINUTE_VIDEO'),false);
    const merged=qaMergeCourseraPayload_({id:'v',timeEstimateMinutes:12},item);
    assert.equal(merged.timeEstimateMinutes,12);
  }
  for(const v of [0,'0']){
    const item=normalizeCourseraItem_({id:'v',name:'Video',type:'Video',payload:{timeEstimateMinutes:v}});
    assert.equal(item.timeEstimateMinutes,0);
    assert.equal(qaAssessDestinationReadiness_([item]).findings.some(f=>f.code==='ZERO_MINUTE_VIDEO'),true);
    assert.equal(qaMergeCourseraPayload_({id:'v',timeEstimateMinutes:12},item).timeEstimateMinutes,0);
  }
  const source={name:'Long reading',path:'Module',type:'reading',textSample:'content '.repeat(100)};
  const children=[null,0,12].map((m,i)=>({name:`Long reading ${i+1}`,path:'Module',timeEstimateMinutes:m}));
  const aggregate=qaOneToManyAggregateForSource_(source,children);
  assert.equal(aggregate.aggregate.oneToMany.timeEvidenceChildren,2);
});
test('only explicit duration syntax parses and conflict remains unknown',()=>{
  for(const [text,n] of [['1 h 30 min',90],['Time estimate: 15 minutes',15],['1.5 hours',90],['0 min',0]])assert.equal(parseCourseraTimeEstimate(text),n);
  for(const text of ['15','', 'This question takes 10 minutes','-3 minutes','Time limit: 5 minutes'])assert.equal(parseCourseraTimeEstimate(text),null);
  assert.equal(capturedTime({timeEstimateMinutes:10,nativeAssignment:{settings:{timeEstimateMinutes:20}}}).state,'CONFLICT');
  assert.equal(capturedTime({timeEstimateMinutes:20,timeEstimateEvidence:'labeled-editor-time-estimate',nativeAssignment:{settings:{timeEstimateMinutes:10}}}).minutes,20);
  assert.equal(capturedTime({timeEstimateState:'CONFLICT',timeEstimateMinutes:10}).minutes,null);
});
test('baseline, refreshed and missing observations survive summaries without mutating the audit',()=>{
  const raw={extractedAt:day1,fingerprints:[{id:'a',name:'A',path:'Module 1',payload:{timeEstimateMinutes:10}}]};
  const snapshot=buildContentSnapshot(new TextEncoder().encode(JSON.stringify(raw)));
  const t=buildOwnerTasks({ownerView:{items:[{id:'a',name:'A',path:'Module 1'}]}},[],'',snapshot.coursera)[0];
  const original=JSON.stringify(t);
  const review={status:'open',note:'',relevance:'relevant',updatedAt:day2,updatedBy:'Owner',capture:{editorObserved:true,finishedAt:day2,payload:{timeEstimateMinutes:25}}};
  const summary=recordSummary(newRecord('item-review','A',{auditId:'audit',itemKey:t.key,review},'course')).data.review;
  assert.equal(summary.capture,undefined); assert.equal(summary.relevance,'relevant');
  assert.equal(taskTimes(t,summary).latest.minutes,25);
  assert.equal(taskTimes(t,summary).baseline.minutes,10);
  assert.equal(JSON.stringify(t),original);
  assert.equal(taskTimes(t,{capture:{...review.capture,payload:{}}}).latest.minutes,null);
  assert.equal(taskTimes(t,{capture:{...review.capture,editorObserved:false}}).latest.minutes,null);
  assert.equal(taskTimes(t,{capture:{...review.capture,finishedAt:'2026-09-01T00:00:00Z'}}).latest.minutes,10);
  assert.throws(()=>validateOwnerReview({...review,capture:undefined,relevance:'typo'}),/relevant/i);
});
test('module totals omit excluded/source-only items, flag partial coverage and export no item links',()=>{
  const tasks=[task('a'),task('b','Module 1 > Lesson 1',null),task('archive','Module 1 > Archive',50),task('ignore','Module 1 > Lesson 1',100)];
  const source=task('source');source.sourceOnly=true;tasks.push(source);
  const reviews=[{itemKey:'item:a',review:{capture:{editorObserved:true,finishedAt:day2,payload:{timeEstimateMinutes:25}}}},{itemKey:'item:ignore',review:{relevance:'not_relevant'}}];
  const totals=timeTotals(tasks,key=>reviews.find(r=>r.itemKey===key)?.review);
  assert.deepEqual(totals.baseline,{minutes:10,captured:1,total:2,missing:1});
  assert.deepEqual(totals.latest,{minutes:25,captured:1,total:2,missing:1});
  assert.equal(totals.refreshed,1);assert.equal(totals.excluded,2);
  const text=moduleTimesText(moduleTimes(tasks,reviews));
  assert.match(text,/baseline 10 min.*latest available 25 min/);assert.match(text,/PARTIAL TOTAL/);assert.doesNotMatch(text,/https?:\/\//);
  const missing=moduleTimesText(moduleTimes([task('missing','Unknown module',null)],[]));
  assert.match(missing,/baseline Not captured.*latest available Not captured/);assert.doesNotMatch(missing,/0 min/);
  const duplicate=moduleTimes(tasks,[...reviews,reviews[0]]);
  assert.equal(duplicate[0].latest.minutes,10,'ambiguous reviews cannot silently establish latest time');
});
