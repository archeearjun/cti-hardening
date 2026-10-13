import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  captureContractV6150,
  createCheckpointManagerV6150,
} from '../src/extractors/coursera/completion.js';
import {CTI_CHECKPOINT_STORE} from '../src/extractors/coursera/config.js';

// Select the actual inline callback by its acquisition call, so this check
// exercises the orchestration rather than duplicating its snapshot logic.
const source=fs.readFileSync(new URL('../src/extractors/coursera/entry.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('entry.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const callbacks=[];
function findCallback(node){
  if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
    node.expression.text==='collectCourseraAssessmentByQuestionCycleV662'){
    const options=node.arguments[2];
    assert(options && ts.isObjectLiteralExpression(options));
    const property=options.properties.find(value=>ts.isPropertyAssignment(value) && value.name.getText(ast)==='onCheckpoint');
    assert(property && ts.isConditionalExpression(property.initializer));
    assert(ts.isArrowFunction(property.initializer.whenTrue));
    callbacks.push(property.initializer.whenTrue.getText(ast));
  }
  ts.forEachChild(node,findCallback);
}
findCallback(ast);
assert.equal(callbacks.length,1,'The canonical assessment visit must own exactly one checkpoint callback');

function callbackFor(fp,checkpoint){
  const writes=[],meta={},diag={id:fp.id,attempt:fp.payload.captureAttempts,completed:false};
  const callback=vm.runInNewContext('('+callbacks[0]+')',{
    fp,diag,meta,
    options:{checkpoint,localSession:{checkpointWritten:value=>writes.push(value)}},
  });
  return {callback,meta,writes,diag};
}

async function withDurableStore(check){
  const priorStorage=globalThis.localStorage,priorDb=globalThis.indexedDB;
  const stores=new Map([[CTI_CHECKPOINT_STORE,new Map()],['item-checkpoint-manifests',new Map()]]);
  globalThis.localStorage={getItem:()=>JSON.stringify({id:'run-1700000000000-rawfixture',createdAt:Date.now()})};
  globalThis.indexedDB={open:()=>{
    const request={result:{close(){},transaction:names=>{
      const active=typeof names==='string'?[names]:names;
      const drafts=new Map(active.map(name=>[name,new Map(stores.get(name))]));
      let aborted=false;
      const transaction={
        objectStore:name=>({put:record=>drafts.get(name).set(record.key,structuredClone(record))}),
        abort(){aborted=true;queueMicrotask(()=>transaction.onabort?.());},
      };
      queueMicrotask(()=>{
        if(aborted)return;
        for(const [name,rows] of drafts)stores.set(name,rows);
        transaction.oncomplete?.();
      });
      return transaction;
    }}};
    queueMicrotask(()=>request.onsuccess());return request;
  }};
  let manager;
  try{
    manager=await createCheckpointManagerV6150('Synthetic_raw_course');
    assert.equal(manager.available,true);
    await check(manager,stores);
  }finally{
    manager?.close();
    if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;
    if(priorDb===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=priorDb;
  }
}

function rawFingerprint(){
  return {id:'Synthetic_quiz',name:'Synthetic large quiz',type:'Assessment',typeName:'staffGraded',
    payload:{captureAttempts:0,assessmentApiEvidence:{method:'OBSERVED_ITEM_BOUND_AUTHORING_GETS',
      groups:[{id:'Synthetic_group_1',questions:['Synthetic_definition_1@1'],
        unknownOriginalField:{rich:'<math><mi>synthetic</mi></math>'}}],questionDefinitions:[]},
      rawSnapshot:{unknownOriginalField:{annotations:['original synthetic annotation']}}}};
}

test('two crashes after raw-only API checkpoints preserve retry eligibility, raw wrappers and the active attempt',async()=>{
  await withDurableStore(async(manager,stores)=>{
    let restored=rawFingerprint();
    const original=structuredClone(restored.payload.rawSnapshot);
    for(let document=0;document<2;document++){
      const active=structuredClone(restored);
      active.payload.captureAttempts++;
      if(document)active.payload.assessmentApiEvidence.groups.push({id:'Synthetic_group_2',questions:['Synthetic_definition_2@1']});
      const before=structuredClone(active);
      const {callback,meta,writes,diag}=callbackFor(active,(snapshot,diagnostic,pass)=>{
        assert.equal(pass,'assessment-api-progress');
        return manager.save(snapshot,diagnostic,pass);
      });
      assert.equal(await callback(null),true);
      // Simulate the renderer disappearing now: neither the final item save nor
      // its later attempt decrement runs. Only the durable snapshot is resumed.
      const row=[...stores.get(CTI_CHECKPOINT_STORE).values()][0];
      restored=structuredClone(row.fingerprint);
      assert.equal(restored.payload.captureAttempts,0,'An unfinished raw-only read must not consume a completed editor attempt');
      assert.equal(captureContractV6150(restored).retryable,true);
      assert.equal(captureContractV6150(restored).needsEditor,true);
      assert.equal(captureContractV6150(restored).complete,false);
      assert.deepEqual(restored.payload.assessmentApiEvidence,active.payload.assessmentApiEvidence);
      assert.deepEqual(restored.payload.rawSnapshot,original);
      assert.equal(restored.payload.structuredAssessment,undefined,'Raw groups must not invent normalized questions');
      assert.equal(restored.payload.assessmentCaptureInProgress,undefined);
      assert.deepEqual(active,before,'The currently running attempt stays charged until its own final decision');
      assert.equal(diag.attempt,1);
      assert.equal(meta.checkpointWrites,1);assert.equal(meta.checkpointErrors,undefined);
      assert.deepEqual(writes,[true]);
    }
    assert.equal(restored.payload.assessmentApiEvidence.groups.length,2);
  });
});

test('a rejected raw-only checkpoint reports failure without changing the active attempt or source',async()=>{
  const fp=rawFingerprint();fp.payload.captureAttempts=1;
  const before=structuredClone(fp);
  const {callback,meta,writes}=callbackFor(fp,async()=>{throw Error('Synthetic storage failure');});
  assert.equal(await callback(null),false);
  assert.deepEqual(fp,before);
  assert.equal(meta.checkpointErrors,1);assert.equal(meta.checkpointWrites,undefined);
  assert.deepEqual(writes,[false]);
});
