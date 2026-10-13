import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckpointManagerV6150} from '../src/extractors/coursera/completion.js';

async function withCheckpointStore(check) {
  const previousStorage=globalThis.localStorage,previousDb=globalThis.indexedDB,records=[];
  globalThis.localStorage={getItem:()=>JSON.stringify({id:'synthetic-run',createdAt:Date.now()})};
  globalThis.indexedDB={open:()=>{
    const request={result:{close(){},transaction:()=>{
      const transaction={objectStore:()=>({put:record=>{
        records.push(structuredClone(record));queueMicrotask(()=>transaction.oncomplete());
      }})};return transaction;
    }}};
    queueMicrotask(()=>request.onsuccess());return request;
  }};
  try {
    const manager=await createCheckpointManagerV6150('Synthetic_course');
    assert.equal(manager.available,true);await check(manager,records);manager.close();
  } finally {
    if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;
    if(previousDb===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previousDb;
  }
}

test('question checkpoints retain safe API decisions before the item visit finishes',async()=>{
  await withCheckpointStore(async(manager,records)=>{
    const fp={id:'Synthetic_quiz',name:'Synthetic quiz',typeName:'staffGraded',payload:{captureAttempts:0}};
    const diagnostic={id:fp.id,attempt:1,completed:false,version:'v6.15.32',strongIdentitySeed:false,
      routeEditorCertified:true,sessionEditorCertified:false,
      authoringAssessmentApiStopReason:'AUTHORING_API_EVIDENCE_INCOMPLETE',
      questionCycleStopReason:'LOCAL_ASSESSMENT_CHECKPOINT_YIELD',
      authoringAssessmentApi:{requests:14,maxConcurrentRequests:2,bytes:12000,rateLimitRetries:0,
        missingGroups:['PRIVATE_GROUP_ID'],missingDefinitions:['PRIVATE_DEFINITION_ID'],unsupportedGroups:[],
        failures:[{resource:'authoringAssignmentMachineEvaluableQuestions.v1',status:404,reason:'HTTP_404',
          url:'https://www.coursera.org/api/PRIVATE_ID?accessToken=SECRET_TOKEN',body:{prompt:'PRIVATE_QUESTION'}}],
        inventoryDiscovery:{method:'OBSERVED_VIRTUAL_RAIL_SCROLL',scrollSteps:14,elapsedMs:1200,restored:true,labels:['PRIVATE_LABEL']},
        rawBody:{writeAccessToken:'SECRET_TOKEN'}}};
    assert.equal(await manager.save(fp,diagnostic,'assessment-progress'),true);
    const saved=records[0].diagnostic;
    assert.equal(saved.extractorVersion,'v6.15.32');assert.equal(saved.routeEditorCertified,true);
    assert.equal(saved.strongIdentitySeed,false);assert.equal(saved.sessionEditorCertified,false);
    assert.equal(saved.authoringAssessmentApiStopReason,'AUTHORING_API_EVIDENCE_INCOMPLETE');
    assert.equal(saved.questionCycleStopReason,'LOCAL_ASSESSMENT_CHECKPOINT_YIELD');
    assert.deepEqual(saved.authoringAssessmentApi,{requests:14,maxConcurrentRequests:2,bytes:12000,rateLimitRetries:0,
      missingGroups:1,missingDefinitions:1,unsupportedGroups:0,
      failures:[{resource:'authoringAssignmentMachineEvaluableQuestions.v1',status:404,reason:'HTTP_404'}],
      inventoryDiscovery:{method:'OBSERVED_VIRTUAL_RAIL_SCROLL',scrollSteps:14,elapsedMs:1200,restored:true}});
    assert(!/PRIVATE_|SECRET_TOKEN|accessToken|rawBody|url|prompt|labels/.test(JSON.stringify(saved)));
    assert.equal(records[0].pass,'assessment-progress');assert.equal(records[0].fingerprint.id,fp.id);
  });
});

test('checkpoint diagnostics bound counts and reject freeform reasons, versions and resource names',async()=>{
  await withCheckpointStore(async(manager,records)=>{
    const fp={id:'Synthetic_quiz',payload:{captureAttempts:0}};
    await manager.save(fp,{version:'PRIVATE_VERSION',strongIdentitySeed:'yes',routeEditorCertified:1,
      authoringAssessmentApiStopReason:'PRIVATE_REASON',authoringAssessmentApi:{requests:Infinity,
        maxConcurrentRequests:100000,bytes:-20,rateLimitRetries:2.5,
        failures:Array.from({length:50},()=>({resource:'PRIVATE_RESOURCE',status:10000,reason:'PRIVATE_FAILURE'})),
        inventoryDiscovery:{method:'PRIVATE_METHOD',scrollSteps:10000,elapsedMs:Infinity,restored:'yes'}}},'assessment-progress');
    const saved=records[0].diagnostic;
    assert.equal(saved.extractorVersion,'');assert.equal(saved.strongIdentitySeed,false);assert.equal(saved.routeEditorCertified,false);
    assert.equal(saved.authoringAssessmentApiStopReason,'UNRECOGNIZED_DIAGNOSTIC_REASON');
    assert.equal(saved.authoringAssessmentApi.requests,0);assert.equal(saved.authoringAssessmentApi.maxConcurrentRequests,100);
    assert.equal(saved.authoringAssessmentApi.bytes,0);assert.equal(saved.authoringAssessmentApi.rateLimitRetries,2);
    assert.equal(saved.authoringAssessmentApi.failures.length,40);
    assert.deepEqual(saved.authoringAssessmentApi.failures[0],{resource:'',status:599,reason:'UNRECOGNIZED_DIAGNOSTIC_REASON'});
    assert.deepEqual(saved.authoringAssessmentApi.inventoryDiscovery,{method:'',scrollSteps:1000,elapsedMs:0,restored:false});
    assert(!JSON.stringify(saved).includes('PRIVATE_'));
  });
});
