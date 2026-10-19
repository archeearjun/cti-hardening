import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { harness, publisherEntryFixture, useNativeCml, exportedCapture, until } from './coursera-direct-data-entry.test.mjs';
import { createInlinePublisherMediaContentFixture } from './coursera-inline-content-fixtures.mjs';
import { directPublisherFirstPartyPlanV1, directPublisherFirstPartyPlanHashV1 } from '../src/extractors/coursera/direct-data-publisher-first-party.js';

const clone = value => structuredClone(value);
function recoveryFixture(t) {
  useNativeCml(t);
  const base=publisherEntryFixture(),old=base.fixtures[0],image=createInlinePublisherMediaContentFixture({itemId:old.fp.id,atomId:old.fp.atomId,outcomes:['CAPTURED','CAPTURED']}),
    events={opens:[],reads:[],closed:0,ready:null,fail:new Set()};
  base.fixtures[0]=image;
  let app;
  base.options.firstPartyFactory=settings=>{
    events.opens.push(settings);
    const plan=directPublisherFirstPartyPlanV1(settings.courseId,settings.entries),sessionId=String(events.opens.length).padStart(32,'0');
    let rejectReady;
    return {ready:()=>new Promise((resolve,reject)=>{rejectReady=reject;events.ready=async()=>resolve({sessionId,planSha256:await directPublisherFirstPartyPlanHashV1(plan)});}),
      close(){events.closed++;rejectReady?.(Error('PUBLISHER_FIRST_PARTY_CLOSED'));},supports(){return true;}};
  };
  base.options.mediaReaderFactory=settings=>({
    snapshot:()=>({bytes:0,requests:0,limits:{concurrentRequests:2}}),abort(){},release(){},
    async readPublisherImage(){return {reason:'PUBLISHER_IMAGE_HTTP_403'};},
    async readPublisherImageFirstParty(observation,target,resource,binding){
      assert(settings.publisherFirstPartyTransport,'The exact prepared transport must be installed');
      events.reads.push({binding:clone(binding),url:resource.url,sourceSha256:observation.model.sha256});
      if(events.fail.has(resource.url)){
        const observedAt=new app.context.Date().toISOString();
        return {reason:'PUBLISHER_FIRST_PARTY_HTTP_403',firstPartyAttempt:{transport:'FIRST_PARTY_BROWSER',origin:new URL(resource.url).origin,
          requestedUrl:resource.url,method:'GET',credentials:'same-origin',mode:'same-origin',collectorContext:'PROVIDER_PAGE_BROWSER',
          firstPartyBinding:clone(binding),attemptedAt:observedAt,requestAttempted:true,reason:'PUBLISHER_FIRST_PARTY_HTTP_403',observedBytes:0,
          status:403,responseType:'basic',observedAt,challenge:'cloudflare'}};
      }
      const template=image.publisherMedia.resources.find(value=>value.url===resource.url).body,
        bytes=new Uint8Array(image.publisherMediaBytes),observedAt=new app.context.Date().toISOString(),
        body={...clone(template),receipt:{...clone(template.receipt),transport:'FIRST_PARTY_BROWSER',credentials:'same-origin',responseType:'basic',
          observedAt,origin:new URL(resource.url).origin,mode:'same-origin',collectorContext:'PROVIDER_PAGE_BROWSER',responseObservedAt:observedAt,firstPartyBinding:clone(binding)}};
      assert.equal(createHash('sha256').update(bytes).digest('hex'),body.sha256);
      Object.defineProperty(body,'bytes',{value:bytes,configurable:true});return {body};
    },
  });
  app=harness(base.options);
  return {...base,app,image,events};
}
async function initial(f){f.app.launch();await f.app.idle();assert.equal(f.app.state().state,'INCOMPLETE');return f.app.state().runId;}
async function prepare(f){f.app.state().preparePublisherRecovery();await until(()=>!f.app.state().recovering,'Preparation never finished');assert.equal(f.app.state().phase,'Publisher recovery prepared',JSON.stringify(f.app.nodes.map(n=>n.textContent)));}
async function open(f){const before=f.events.opens.length;f.events.ready=null;f.app.state().openPublisherRecovery();assert.equal(f.events.opens.length,before+1,'Popup opens synchronously in the second click');await until(()=>!!f.events.ready,'Ready waiter missing');await f.events.ready();await f.app.idle();}

test('prepared publisher recovery is readonly until the synchronous second click, then recovers pinned originals with fresh native source proof',async t=>{
  const f=recoveryFixture(t),runId=await initial(f),oldRun=clone(f.app.runs.get(runId)),oldItem=clone(f.app.items.get(runId+'/'+f.image.fp.id)),
    before=f.app.calls.length,storeWrites=f.app.metrics.saves.length,serviceOpens=f.app.metrics.helperOpens.length;
  await prepare(f);
  assert.equal(f.events.opens.length,0);assert.equal(f.app.calls.length,before);assert.equal(f.app.metrics.saves.length,storeWrites);
  assert.deepEqual(f.app.runs.get(runId),oldRun);assert.deepEqual(f.app.items.get(runId+'/'+f.image.fp.id),oldItem);
  assert.equal(f.app.button('Open publisher recovery').disabled,false);
  f.app.state().openPublisherRecovery();assert.equal(f.events.opens.length,1);assert.equal(f.app.state().recovering,true);
  assert.equal(f.app.calls.length,before,'No native/provider request is made while waiting for the provider bookmark');
  await until(()=>!!f.events.ready,'Ready waiter missing');await f.events.ready();await f.app.idle();
  assert.equal(f.app.state().runId,runId);assert.equal(f.app.metrics.helperOpens.length,serviceOpens,'Recovery does not open the public CTI service helper');
  assert.equal(f.app.calls.filter(c=>c.resource==='publisher').length,1,'Pinned original publisher JSON is not fetched again');
  assert.equal(f.app.calls.filter(c=>c.resource==='public').length,0,'No new HTML fallback is attempted');
  const calls=f.app.calls.slice(before);assert.equal(calls.filter(c=>c.resource==='atom').length,2);assert.equal(calls.filter(c=>c.resource==='relation').length,1);
  assert.equal(f.events.reads.length,2);
  const {capture,zip}=await exportedCapture(f.app.downloads.at(-1)),meta=capture.meta.directDataCapture,
    page=capture.fingerprints[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0],oldPage=oldItem.fingerprint.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  assert.deepEqual(page.observation,oldPage.observation,'Publisher response bytes/hash/receipt timestamps remain original');
  assert.equal(meta.firstPartyRecovery.pinnedRunId,runId);assert.equal(meta.firstPartyRecovery.entries.length,2);assert.equal(meta.firstPartyRecovery.publisherPagesRefetched,false);
  assert.equal(meta.nativeRecheck.scope,'ALL_NATIVE_ITEMS');assert.equal(meta.wholeCourseVerified,false);
  for(const resource of page.media.resources){
    assert.equal(resource.body.receipt.transport,'FIRST_PARTY_BROWSER');assert.deepEqual(resource.priorFailures,[{reason:'PUBLISHER_IMAGE_HTTP_403'}]);
    assert.deepEqual(await zip.file(resource.body.archivePath).async('nodebuffer'),Buffer.from(f.image.publisherMediaBytes));
    assert.equal(resource.body.receipt.firstPartyBinding.planSha256,meta.firstPartyRecovery.planSha256);
  }
});

test('changed graph after a frozen recovery plan owns only its two discovery reads and never mutates historical rows or fetches images',async t=>{
  const f=recoveryFixture(t),runId=await initial(f);await prepare(f);
  const oldRun=clone(f.app.runs.get(runId)),oldRows=clone([...f.app.items]),before=f.app.calls.length;
  f.app.control.materialRevision++;await open(f);
  assert.notEqual(f.app.state().runId,runId);assert.deepEqual(f.app.runs.get(runId),oldRun);assert.deepEqual([...f.app.items],oldRows);
  assert.equal(f.events.reads.length,0);assert.deepEqual(f.app.calls.slice(before).map(c=>c.resource).sort(),['course','materials']);
  const failed=f.app.runs.get(f.app.state().runId);assert.equal(failed.budget.requests,2);assert.equal(failed.captureMeta.directDataCapture.stopReason,'PUBLISHER_FIRST_PARTY_MATERIAL_GRAPH_CHANGED');
  const {capture}=await exportedCapture(f.app.downloads.at(-1));assert.equal(capture.meta.directDataCapture.wholeCourseVerified,false);assert(capture.fingerprints.every(fp=>fp.captureContract.complete===false));
});

test('failed discovery after provider readiness charges a separate failed namespace and does not export earlier native completion as a fresh check',async t=>{
  const f=recoveryFixture(t),runId=await initial(f);await prepare(f);
  const oldRun=clone(f.app.runs.get(runId)),oldRows=clone([...f.app.items]),before=f.app.calls.length;
  f.app.control.beforeRead=call=>call.resource==='materials'?'COURSE_API_HTTP_503':undefined;
  await open(f);
  assert.notEqual(f.app.state().runId,runId);assert.deepEqual(f.app.runs.get(runId),oldRun);assert.deepEqual([...f.app.items],oldRows);
  assert.equal(f.events.reads.length,0);assert.equal(f.app.calls.length-before,2);
  assert.equal(f.app.runs.get(f.app.state().runId).budget.requests,2);
  const {capture}=await exportedCapture(f.app.downloads.at(-1));assert.equal(capture.meta.directDataCapture.wholeCourseVerified,false);assert.equal(capture.meta.directDataCapture.coverage.content.verified,0);
});

test('native source changes invalidate a planned publisher owner without falling back to public page/image reads',async t=>{
  const f=recoveryFixture(t);await initial(f);await prepare(f);const before=f.app.calls.length;
  const provider=f.image.fp.payload.directInlineWidgetProviderEvidence.providers[0];
  provider.initial.model.elements[0].draft.configuration.url='https://opentextbc.ca/synthetic-book/?p=180/#main';
  provider.initial.model.elements[0].draft.pageSrc='https://opentextbc.ca/synthetic-book/?p=180/#main';
  await open(f);
  assert.equal(f.events.reads.length,0);assert.equal(f.app.calls.slice(before).filter(c=>['publisher','public'].includes(c.resource)).length,0);
  assert.equal(f.app.state().coverage.content.verified,0);
});


test('a changed pinned candidate is refused before probes, and a forged original JSON hash cannot prepare any popup',async t=>{
  const f=recoveryFixture(t),runId=await initial(f);await prepare(f);
  const before=f.app.calls.length,downloads=f.app.downloads.length;
  f.app.runs.get(runId).materialHash='f'.repeat(64);const changed=clone(f.app.runs.get(runId));
  f.app.state().openPublisherRecovery();await until(()=>!!f.events.ready,'Ready waiter missing');await f.events.ready();
  await until(()=>!f.app.state().running&&!f.app.state().recovering,'Pin failure did not settle');
  assert.equal(f.app.calls.length,before);assert.deepEqual(f.app.runs.get(runId),changed);assert.equal(f.app.downloads.length,downloads);
  assert(f.app.nodes.some(n=>n.textContent.includes('PUBLISHER_FIRST_PARTY_PINNED_CAPTURE_CHANGED')));
  f.app.runs.get(runId).materialHash=f.app.runs.get(runId).captureMeta.directDataCapture.initialMaterialHash;
  const row=f.app.items.get(runId+'/'+f.image.fp.id),page=row.fingerprint.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  page.observation.model.rawJson+=' ';const saved=clone(f.app.runs.get(runId)),rows=clone([...f.app.items]);
  f.app.state().preparePublisherRecovery();await until(()=>!f.app.state().recovering,'Preparation did not settle');
  assert.equal(f.app.state().phase,'Publisher recovery could not be prepared');assert.equal(f.app.calls.length,before);assert.equal(f.events.opens.length,1);
  assert.deepEqual(f.app.runs.get(runId),saved);assert.deepEqual([...f.app.items],rows);
});

test('pause while waiting for the publisher bookmark closes the connection without native requests or saved writes',async t=>{
  const f=recoveryFixture(t),runId=await initial(f);await prepare(f);
  const before=f.app.calls.length,saved=clone(f.app.runs.get(runId)),rows=clone([...f.app.items]),downloads=f.app.downloads.length;
  f.app.state().openPublisherRecovery();await until(()=>!!f.events.ready,'Ready waiter missing');assert.equal(f.app.state().recovering,true);
  f.app.state().stop();await until(()=>!f.app.state().recovering,'Stopped readiness wait did not settle');
  assert(f.events.closed>0);assert.equal(f.app.calls.length,before);assert.deepEqual(f.app.runs.get(runId),saved);assert.deepEqual([...f.app.items],rows);
  assert.equal(f.app.downloads.length,downloads);assert.equal(f.app.button('Prepare publisher recovery').disabled,false);
  f.events.ready=null;await prepare(f);await open(f);assert.equal(f.events.reads.length,2,'An explicit second preparation can reconnect after Pause');
});


test('partial sessions retain old failure context and exact successful bodies, and ordinary native rechecks carry their global manifests',async t=>{
  const f=recoveryFixture(t),runId=await initial(f),failedUrl=f.image.publisherImageUrls[1];f.events.fail.add(failedUrl);
  await prepare(f);await open(f);
  let saved=f.app.items.get(runId+'/'+f.image.fp.id).fingerprint,
    page=saved.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0],first=clone(page.media.resources[0].body),
    firstManifest=clone(f.app.runs.get(runId).captureMeta.directDataCapture.firstPartyRecovery);
  assert.equal(page.media.resources[1].reason,'PUBLISHER_FIRST_PARTY_HTTP_403');
  assert.equal(page.media.resources[1].firstPartyAttempt.status,403);assert.equal(page.media.resources[1].firstPartyAttempt.challenge,'cloudflare');
  f.events.fail.clear();f.app.advance(1000);await prepare(f);assert.equal(f.app.button('Open publisher recovery').disabled,false);await open(f);
  saved=f.app.items.get(runId+'/'+f.image.fp.id).fingerprint;page=saved.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  assert.equal(f.events.reads.length,3,'A successful original from session A is not downloaded again in session B');
  assert.deepEqual(page.media.resources[0].body,first,'Old bytes/hash/session and actual response dates remain unchanged');
  assert.equal(page.media.resources[1].priorFailures.length,2);assert.equal(page.media.resources[1].priorFailures[1].firstPartyAttempt.status,403);
  const current=clone(f.app.runs.get(runId).captureMeta.directDataCapture.firstPartyRecovery);
  assert.notEqual(current.sessionId,firstManifest.sessionId);assert.equal(current.entries.length,1);
  assert.deepEqual(f.app.runs.get(runId).captureMeta.directDataCapture.firstPartyRecoveryHistory,[firstManifest]);
  f.app.advance(1000);f.app.state().recheckNative();await f.app.idle();
  const capture=(await exportedCapture(f.app.downloads.at(-1))).capture;
  assert.deepEqual(capture.meta.directDataCapture.firstPartyRecovery,current);assert.deepEqual(capture.meta.directDataCapture.firstPartyRecoveryHistory,[firstManifest]);
  page=capture.fingerprints[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  assert.equal(page.media.retained[0].resources.length,2);assert.equal(page.media.retained[0].resources[0].body.receipt.firstPartyBinding.sessionId,firstManifest.sessionId);
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified,false);
});


test('invalid saved media budgets after preparation cannot mutate the pinned run before graph ownership',async t=>{
  const f=recoveryFixture(t),runId=await initial(f);await prepare(f);
  f.app.runs.get(runId).budget.media.bytes='invalid';const old=clone(f.app.runs.get(runId)),before=f.app.calls.length,writes=f.app.metrics.saves.length;
  f.app.state().openPublisherRecovery();await until(()=>!!f.events.ready,'Ready waiter missing');await f.events.ready();
  await until(()=>!f.app.state().running&&!f.app.state().recovering,'Invalid budget failure did not settle');
  assert.deepEqual(f.app.runs.get(runId),old);assert.equal(f.app.calls.length,before);assert.equal(f.app.metrics.saves.length,writes);assert.equal(f.events.reads.length,0);
});
