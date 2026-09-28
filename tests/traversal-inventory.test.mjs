import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createWorkflows} from '../src/domain/workflows.ts';
import {workerXml} from '../src/adapters/worker-xml.ts';
import {writeWorkbook} from '../src/adapters/workbook.ts';
import {comparisonFixture,encode} from './workflow-fixtures.mjs';
const qa=createRequire(import.meta.url)('../tools/check.cjs');
const items=Array.from({length:5},(_,i)=>({id:'i'+i,name:'Reading '+i,type:'Reading',payload:{}}));
const rows=[...items.map(i=>['Reading',i.name,'','','','','',i.id]),['**Lesson ID','lesson']];
function meta({visitedContainer=false}={}){return {activeSpaCrawl:{targets:6,eligibleTargets:6,targetIds:[...items.map(i=>i.id),'lesson'],navigated:visitedContainer?6:5,
  targetDiagnostics:[...items.map(i=>({id:i.id,editorSurfaceCaptured:true})),{id:'lesson',editorSurfaceCaptured:visitedContainer}]}};}
function inventory(rs=rows,js=items){return qa.qaXlsxTraversalInventory_(rs,js,{},'export.xlsx','capture.json');}
test('Matching XLSX lesson IDs remove false editor gaps while original traversal counts remain available',()=>{
  const m=meta(),original=JSON.stringify(m);m.xlsxTraversalInventory=inventory();
  const r=qa.qaCaptureTraversalSummary_(m);
  assert.equal(r.rawEligible,6);assert.equal(r.rawVisited,5);assert.equal(r.eligible,5);assert.equal(r.visited,5);
  assert.equal(r.complete,true);assert.equal(r.excludedContainerCount,1);assert.deepEqual(Array.from(r.unresolvedItemIds),[]);
  delete m.xlsxTraversalInventory;assert.equal(JSON.stringify(m),original);
  const reached=qa.qaCaptureTraversalSummary_({...meta({visitedContainer:true}),xlsxTraversalInventory:inventory()});
  assert.equal(reached.rawVisited,6);assert.equal(reached.visited,5);
});
test('A missing real item, arbitrary lesson title, ID conflict, or incoherent export cannot be dismissed',()=>{
  const missing=meta();missing.activeSpaCrawl.targetDiagnostics[0].editorSurfaceCaptured=false;missing.xlsxTraversalInventory=inventory();
  assert.equal(qa.qaCaptureTraversalSummary_(missing).unresolvedCount,1);
  assert.equal(qa.qaCaptureTraversalSummary_(meta()).unresolvedCount,1);
  for(const inv of [inventory(rows.map(r=>r[0]==='**Lesson ID'?['Lesson','lesson']:r)),
    inventory([...rows,['Reading','Actual item','','','','','','lesson']]),
    inventory(rows,items.map(i=>({...i,id:'other'+i.id}))),
    inventory(rows,items.map(i=>({...i,id:''})))]){
    assert.equal(qa.qaCaptureTraversalSummary_({...meta(),xlsxTraversalInventory:inv}).excludedContainerCount,0);
  }
});
test('Full comparison replaces capture-supplied inventory with authoritative XLSX evidence',()=>{
  const input=comparisonFixture(),capture={schemaVersion:34,page:{title:'Example'},meta:meta(),fingerprints:items};
  capture.meta.xlsxTraversalInventory={source:'COURSERA_XLSX_STRUCTURAL_IDS',identityVerified:true,containerIds:['i0','i1','i2','i3','i4','lesson'],itemIds:[]};
  input.json.bytes=encode(capture);input.excel.bytes=writeWorkbook({name:'example',sheets:{'FOR IMPORT':{values:rows}}});
  const r=createWorkflows(workerXml).compare(input);
  assert.equal(r.result.inputCoherence.status,'PASS');
  assert.equal(r.result.captureReadiness.traversal.visited,5);assert.equal(r.result.captureReadiness.traversal.eligible,5);
  assert.match(r.report,/lesson\/module containers confirmed/);
  assert.doesNotMatch(r.report,/Only 5\/6 item editors/);
});
