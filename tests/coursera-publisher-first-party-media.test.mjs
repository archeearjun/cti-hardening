import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDirectDataMediaReaderV1 } from "../src/extractors/coursera/direct-data-media.js";
import { directPublisherMediaInventoryV1, directPublisherMediaStructureV1, directPublisherMediaEvidenceV1,
  directPublisherImageBodyStructureV1, directPublisherFirstPartyImageBindingV1 } from "../src/extractors/coursera/direct-data-publisher-media.js";
import { attachCourseraArchiveFileBytes } from "../src/domain/coursera-capture-archive.ts";
import { courseraInlineWidgetContent, courseraInlineWidgetContentText, validateCourseraInlineWidgetContent } from "../src/domain/coursera-inline-widget-content.ts";
import { createInlinePublisherMediaContentFixture } from "./coursera-inline-content-fixtures.mjs";
import { createDirectPublisherFirstPartyV1, runDirectPublisherFirstPartyV1 } from "../src/extractors/coursera/direct-data-publisher-first-party.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { directMaterialStabilityModelV1 } from "../src/extractors/coursera/direct-data-material-stability.js";

const OriginalDate=Date;
let clockMs=OriginalDate.parse("2027-01-15T08:00:00.009Z");
globalThis.Date=class extends OriginalDate {constructor(...args) {super(...(args.length ? args : [clockMs]));} static now() {return clockMs;}};
after(()=>{globalThis.Date=OriginalDate;});

const hash = bytes => createHash("sha256").update(bytes).digest("hex"), observedAt = "2027-01-15T08:00:00.008Z";
function fixture() {
  const f = createInlinePublisherMediaContentFixture({ outcomes: ["PUBLISHER_IMAGE_SERVICE_ORIGIN_CHALLENGE_NOT_ATTEMPTED"] }),
    inventory = directPublisherMediaInventoryV1(f.publisherObservation,f.targetUrl), resource = inventory.resources[0],
    binding = {courseId:f.courseId,itemId:f.fp.id,atomId:f.fp.atomId,providerId:f.providerId,
      targetUrl:f.targetUrl,sourceSha256:f.publisherObservation.model.sha256,planSha256:"a".repeat(64),sessionId:"b".repeat(32)};
  const entries=[{itemId:f.fp.id,atomId:f.fp.atomId,providerId:f.providerId,targetUrl:f.targetUrl,imageUrl:resource.url,sourceSha256:binding.sourceSha256}],
    material={id:f.courseId,material:{elements:[{elements:[{elements:[{id:"OtherAssignment",content:{typeName:"ungradedAssignment",
      definition:{assignmentFeatures:["SHOW_GRADE_ON_RELEASE","LIMITED_SUBMISSIONS"]}}}]}]}]}},
    comparison=hash(directCanonicalSourceTextV1(directMaterialStabilityModelV1(material)));
  binding.planSha256=hash(directCanonicalSourceTextV1({courseId:f.courseId,entries}));
  f.raw.meta.directDataCapture={runId:"Synthetic_pinned_run",materials:{elements:[material]},finalMaterials:{elements:[structuredClone(material)]},
    initialMaterialHash:hash(directCanonicalSourceTextV1(material)),
    materialStability:{policy:"NATIVE_ASSIGNMENT_FEATURE_FLAGS_V1",initialSha256:comparison,finalSha256:comparison},
    firstPartyRecovery:{scope:"PLANNED_PUBLISHER_IMAGES",courseId:f.courseId,origin:new URL(f.targetUrl).origin,planSha256:binding.planSha256,
      sessionId:binding.sessionId,requestedAt:"2027-01-15T08:00:00.006Z",readyAt:"2027-01-15T08:00:00.007Z",pinnedRunId:"Synthetic_pinned_run",
      pinnedMaterialHash:hash(directCanonicalSourceTextV1(material)),pinnedComparisonSha256:comparison,entries,
      publisherPagesRefetched:false,wholeWidgetVerified:false,publishedContentVerified:false}};
  return {...f,inventory,resource,binding};
}
function transport(f, options = {}) {
  const calls = [], bytes = options.bytes || f.publisherMediaBytes;
  return {calls,supports: payload => options.supports === false ? false : JSON.stringify(payload.binding) === JSON.stringify(f.binding),
    async request(payload,signal) {
      calls.push({payload,signal});
      if (options.throwObserved !== undefined) throw Object.assign(Error("synthetic read failed"),{observedBytes:options.throwObserved});
      const chunks = options.chunks || [bytes], response = {status:200,ok:true,type:"basic",url:f.resource.url,
        headers:new Headers({"content-type":options.mime || "image/png",...options.headers}),
        observedBytes:() => options.observedBytes ?? bytes.length,
        body:new ReadableStream({pull(controller) {const next=chunks.shift();if(next) controller.enqueue(next);else controller.close();}})},
        receipt = {transport:"FIRST_PARTY_BROWSER",origin:new URL(f.resource.url).origin,requestedUrl:f.resource.url,finalUrl:f.resource.url,
          method:"GET",credentials:"same-origin",mode:"same-origin",responseType:"basic",status:200,observedAt,
          originalContentType:response.headers.get("content-type"),collectorContext:"PROVIDER_PAGE_BROWSER",firstPartyBinding:structuredClone(f.binding)};
      if (options.mutate) options.mutate({response,receipt});
      return {response,receipt,firstPartyBinding:structuredClone(f.binding)};
    }};
}
async function acquire(f, options = {}, limits) {
  const helper = transport(f,options), reader = createDirectDataMediaReaderV1({archiveMode:true,publisherFirstPartyTransport:helper,limits,
    fetchImpl:async () => {throw Error("normal cross-origin or service fallback must not run");}}),
    result = await reader.readPublisherImageFirstParty(f.publisherObservation,f.targetUrl,f.resource,f.binding);
  return {helper,reader,result};
}
function commit(f,result) {
  f.publisherMedia.resources[0] = {...f.resource,body:result.body,priorFailures:[{reason:"PUBLISHER_IMAGE_BLOCKED_OR_FAILED"}]};
  return f.publisherMedia;
}

function linkedTransport(f,fetchImpl) {
  const parentListeners=new Set(),providerListeners=new Set();
  let provider;
  const parent={location:{origin:"https://www.coursera.org"},closed:false,
    addEventListener(_type,listener) {parentListeners.add(listener);}, removeEventListener(_type,listener) {parentListeners.delete(listener);},
    postMessage(data,_origin,transfer=[]) {const message=structuredClone(data,{transfer});queueMicrotask(()=>{
      for(const listener of parentListeners) listener({data:message,origin:provider.location.origin,source:provider});});},
    open(url) {provider.location=new URL(url);return provider;}};
  provider={location:null,closed:false,opener:parent,
    addEventListener(_type,listener) {providerListeners.add(listener);}, removeEventListener(_type,listener) {providerListeners.delete(listener);},
    postMessage(data,_origin,transfer=[]) {const message=structuredClone(data,{transfer});queueMicrotask(()=>{
      for(const listener of providerListeners) listener({data:message,origin:parent.location.origin,source:parent});});}};
  provider.top=provider;
  const entry={itemId:f.fp.id,atomId:f.fp.atomId,providerId:f.providerId,targetUrl:f.targetUrl,imageUrl:f.resource.url,sourceSha256:f.binding.sourceSha256},
    transport=createDirectPublisherFirstPartyV1({courseId:f.courseId,entries:[entry],windowImpl:parent}),
    collector=runDirectPublisherFirstPartyV1({windowImpl:provider,fetchImpl});
  return {transport,close() {transport.close();collector.close();}};
}

test("explicit first-party bytes use a distinct receipt, existing budgets and independently bound archive ownership", async () => {
  const f=fixture(), {helper,reader,result}=await acquire(f), media=commit(f,result), r=result.body.receipt;
  assert(result.body,result.reason);assert.equal(helper.calls.length,1);assert.equal(reader.snapshot().requests,1);
  assert.equal(reader.snapshot().bytes,f.publisherMediaBytes.length);
  assert.equal(r.transport,"FIRST_PARTY_BROWSER");assert.equal(r.credentials,"same-origin");assert.equal(r.responseType,"basic");
  assert.equal(r.mode,"same-origin");assert.equal(r.collectorContext,"PROVIDER_PAGE_BROWSER");assert.deepEqual(r.firstPartyBinding,f.binding);
  assert.equal(r.responseObservedAt,observedAt);assert.equal(r.observedAt,"2027-01-15T08:00:00.009Z");
  assert.equal(result.body.sha256,hash(f.publisherMediaBytes));assert(directPublisherMediaEvidenceV1(f.publisherObservation,f.targetUrl,media,hash));
  assert(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,media,f.binding));
  const reloaded=JSON.parse(JSON.stringify(f.raw)), body=result.body;
  assert.equal(directPublisherMediaEvidenceV1(f.publisherObservation,f.targetUrl,JSON.parse(JSON.stringify(media)),hash),null,"receipt is not original bytes");
  attachCourseraArchiveFileBytes(reloaded,[{path:body.archivePath,sha256:body.sha256,size:body.size,bytes:f.publisherMediaBytes}]);
  const inline=courseraInlineWidgetContent(reloaded.fingerprints[0],f.courseId), shown=inline.providers[0].publisherPages[0].media.resources[0];
  assert.equal(shown.status,"CAPTURED_ORIGINAL_FILE_REFERENCE");assert.equal(shown.firstPartyAcquisition.transport,"FIRST_PARTY_BROWSER");
  assert.equal(shown.priorFailures[0].reason,"PUBLISHER_IMAGE_BLOCKED_OR_FAILED");
  assert.equal(reloaded.fingerprints[0].captureContract.complete,false,"external image success is not whole-native-item verification");
  validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(inline)),f.fp.id,f.courseId);
  assert.match(courseraInlineWidgetContentText(inline),/collector-declared/);assert.match(courseraInlineWidgetContentText(inline),/Earlier publisher image read outcome retained/);
});

test("first-party native placement, plan, session, source and transport fields cannot be substituted", async () => {
  const f=fixture(), {result}=await acquire(f), original=result.body;
  for(const [field,value] of [["courseId","Another_course"],["itemId","OtherItem"],["atomId","x".repeat(22)],["providerId","x".repeat(22)+"@1"],
    ["targetUrl","https://opentextbc.ca/synthetic-book/?p=180/#main"],["sourceSha256","c".repeat(64)]]) {
    const body=structuredClone(original);body.receipt.firstPartyBinding[field]=value;
    assert.equal(directPublisherFirstPartyImageBindingV1(body.receipt,f.resource.url,f.binding.sourceSha256,f.binding),null,field);
    const media={...f.inventory,resources:[{...f.resource,body}]};
    assert.equal(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,media,f.binding),null,field);
    const raw=JSON.parse(JSON.stringify(f.raw));raw.fingerprints[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0].media=media;
    assert.throws(()=>attachCourseraArchiveFileBytes(raw,[{path:body.archivePath,sha256:body.sha256,size:body.size,bytes:f.publisherMediaBytes}]),/native source binding/,field);
  }
  for(const mutate of [b=>b.receipt.credentials="omit",b=>b.receipt.responseType="cors",b=>b.receipt.mode="cors",b=>b.receipt.origin="https://private.invalid",
    b=>b.receipt.collectorContext="COURSE_PAGE_BROWSER",b=>b.receipt.firstPartyBinding.planSha256="bad",b=>b.receipt.firstPartyBinding.sessionId="bad",
    b=>b.receipt.firstPartyBinding.cookie="must not be retained",b=>b.receipt.upstreamStatus=200]) {
    const body=structuredClone(original);mutate(body);assert.equal(directPublisherImageBodyStructureV1(body,f.resource.url,f.binding.sourceSha256),false);
  }
});

test("recovery receipts require exact basic response identity, MIME, raster signature and EOF", async () => {
  for(const mutate of [({response})=>response.type="cors",({response})=>response.url+="?extra=1",({response})=>response.status=403,
    ({receipt})=>receipt.firstPartyBinding.itemId="OtherItem",({receipt})=>receipt.observedAt="not a date"]) {
    const {result}=await acquire(fixture(),{mutate});assert.equal(result.body,undefined);assert.equal(result.reason,"PUBLISHER_FIRST_PARTY_RECEIPT_INVALID");
  }
  for(const options of [{mime:"text/html"},{headers:{"content-range":"bytes 0-1/3"}},{bytes:new TextEncoder().encode("<html>challenge</html>")},
    {observedBytes:1000}]) {
    const {result}=await acquire(fixture(),options);assert.equal(result.body,undefined,JSON.stringify(options));
  }
  const f=fixture(), {helper,reader,result}=await acquire(f,{supports:false});
  assert.equal(result.reason,"PUBLISHER_FIRST_PARTY_PLAN_INVALID");assert.equal(helper.calls.length,0);assert.equal(reader.snapshot().requests,0);
});

test("failed and read-ahead bytes remain charged to the existing shared media allowance", async () => {
  const f=fixture();
  for(const options of [{observedBytes:1000},{throwObserved:1000},{throwObserved:536870913}]) {
    const {reader,result}=await acquire(f,options,{totalBytes:500});
    assert.equal(result.body,undefined);assert.equal(reader.snapshot().bytes,options.throwObserved || options.observedBytes);assert.equal(reader.snapshot().bodyBudgetExhausted,true);
    assert.equal(result.firstPartyAttempt.observedBytes,options.throwObserved || options.observedBytes);
  }
  const {reader,result}=await acquire(f,{}, {bodyBytes:8});assert.equal(result.reason,"PUBLISHER_IMAGE_BODY_BYTE_LIMIT");
  assert.equal(reader.snapshot().bytes,f.publisherMediaBytes.length,"failed full chunk stays charged");
});

test("a new original retains prior two-stage challenge failures exactly and cannot silently discard or rewrite their timestamps", async () => {
  const f=fixture(), {result}=await acquire(f), media=commit(f,result), prior={reason:"PUBLISHER_IMAGE_UPSTREAM_CHALLENGE",attempts:[
    {transport:"BROWSER_PUBLISHER_IMAGE",observedAt:"2027-01-15T08:00:00.006Z",status:0,responseType:"unreadable",reason:"PUBLISHER_IMAGE_BLOCKED_OR_FAILED"},
    {transport:"CTI_SERVICE_PUBLIC_IMAGE",observedAt:"2027-01-15T08:00:00.007Z",serviceOrigin:"https://cti-hardening.pages.dev",serviceStatus:502,
      upstreamStatus:403,upstreamObservedAt:"2027-01-15T08:00:00.007Z",upstreamRequests:1,upstreamBytes:0,upstreamChallenge:"cloudflare",reason:"PUBLISHER_IMAGE_UPSTREAM_CHALLENGE"}]};
  media.resources[0].priorFailures=[structuredClone(prior)];assert(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,media,f.binding));
  const snapshot=JSON.parse(JSON.stringify(media));assert.deepEqual(snapshot.resources[0].priorFailures,[prior]);
  snapshot.resources[0].priorFailures[0].attempts[1].upstreamStatus=200;
  assert.equal(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,snapshot,f.binding),null);
  media.resources[0].priorFailures=Array.from({length:17},()=>prior);
  assert.equal(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,media,f.binding),null,"history cannot be truncated to fit");
});

test("first-party images acquired after the final native proof stay inadmissible until a fresh native revalidation", async () => {
  const f=fixture(), {result}=await acquire(f);commit(f,result);result.body.receipt.observedAt="2027-01-15T08:00:00.011Z";
  assert.throws(()=>attachCourseraArchiveFileBytes(f.raw,[{path:result.body.archivePath,sha256:result.body.sha256,size:result.body.size,bytes:f.publisherMediaBytes}]),/native source binding/);
  const inline=courseraInlineWidgetContent(f.fp,f.courseId);
  assert(inline.providers[0].publisherPages[0].media.failures.includes("PUBLISHER_IMAGE_MEDIA_EVIDENCE_INVALID"));
});

test("real helper HTTP challenges and unreadable failures retain distinct exact failure context through media and saved projections", async () => {
  for(const outcome of ["challenge","unreadable","mime","no-reader","range"]) {
    const challenge=outcome === "challenge", known=outcome !== "unreadable",
      reason=({challenge:"HTTP_403",unreadable:"FETCH_FAILED",mime:"MIME_UNSUPPORTED","no-reader":"BODY_UNREADABLE",range:"RESPONSE_UNSUPPORTED"})[outcome];
    const f=fixture(), pair=linkedTransport(f,async url=>{
      if(!known) throw Error("synthetic browser cannot expose a response");
      return {status:challenge?403:200,type:"basic",url,redirected:false,
        headers:new Headers({"content-type":challenge || outcome === "mime"?"text/html":"image/png",
          ...(challenge?{"cf-mitigated":"challenge"}:{}),...(outcome === "range"?{"content-range":"bytes 0-1/3"}:{})}),
        body:outcome === "no-reader"?null:new ReadableStream({start() {},cancel() {}})};
    });
    try {
      Object.assign(f.binding,await pair.transport.ready());
      f.raw.meta.directDataCapture.firstPartyRecovery.sessionId=f.binding.sessionId;
      const reader=createDirectDataMediaReaderV1({archiveMode:true,publisherFirstPartyTransport:pair.transport}),
        read=await reader.readPublisherImageFirstParty(f.publisherObservation,f.targetUrl,f.resource,f.binding), attempt=read.firstPartyAttempt;
      assert.equal(read.body,undefined);assert.equal(attempt.reason,"PUBLISHER_FIRST_PARTY_"+reason);
      assert.equal(attempt.status,known?challenge?403:200:0);assert.equal(attempt.responseType,known?"basic":"unreadable");
      assert.equal(attempt.challenge,challenge?"cloudflare":undefined);assert.equal(attempt.observedAt,known?"2027-01-15T08:00:00.009Z":undefined);
      assert.equal(attempt.observedBytes,0);assert.equal(reader.snapshot().bytes,0);assert.equal(reader.snapshot().requests,1);
      assert.deepEqual(attempt.firstPartyBinding,f.binding);
      f.publisherMedia.resources[0]={...f.resource,reason:read.reason,firstPartyAttempt:attempt};
      assert(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,f.publisherMedia,f.binding));
      if(challenge) {
        const interrupted=structuredClone(f.publisherMedia);interrupted.resources[0].reason="OPERATOR_STOPPED";
        interrupted.resources[0].firstPartyAttempt.reason="OPERATOR_STOPPED";
        assert(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,interrupted,f.binding),"a concurrent stop does not erase an already observed HTTP challenge");
      }
      const inline=courseraInlineWidgetContent(JSON.parse(JSON.stringify(f.fp)),f.courseId), display=inline.providers[0].publisherPages[0].media.resources[0];
      assert.deepEqual(display.firstPartyAttempt,attempt);validateCourseraInlineWidgetContent(JSON.parse(JSON.stringify(inline)),f.fp.id,f.courseId);
      assert.match(courseraInlineWidgetContentText(inline),known?challenge?/HTTP 403.*Cloudflare challenge/:/Provider response: HTTP 200/:/No publisher HTTP response was exposed/);
      const savedAttempt=structuredClone(attempt), {result}=await acquire(f);
      f.publisherMedia.resources[0]={...f.resource,body:result.body,priorFailures:[{reason:read.reason,firstPartyAttempt:savedAttempt}]};
      assert(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,f.publisherMedia,f.binding));
      const recovered=courseraInlineWidgetContent(f.fp,f.courseId);
      assert.deepEqual(recovered.providers[0].publisherPages[0].media.resources[0].priorFailures[0].firstPartyAttempt,savedAttempt);
      const forged=structuredClone(f.publisherMedia);forged.resources[0].priorFailures[0].firstPartyAttempt.firstPartyBinding.itemId="OtherItem";
      assert.equal(directPublisherMediaStructureV1(f.publisherObservation,f.targetUrl,forged,f.binding),null);
    } finally {pair.close();}
  }
});

test("a native proof between provider response headers and completed body cannot validate the new original", async () => {
  const f=fixture(), originalTime=clockMs, helper=transport(f,{chunks:[f.publisherMediaBytes]}), baseRequest=helper.request;
  helper.request=async(...args)=>{
    const result=await baseRequest(...args), original=result.response.body;
    result.response.body=new ReadableStream({async start(controller) {
      const reader=original.getReader(), chunk=await reader.read();clockMs=OriginalDate.parse("2027-01-15T08:00:00.012Z");
      controller.enqueue(chunk.value);controller.close();
    }});return result;
  };
  try {
    const reader=createDirectDataMediaReaderV1({archiveMode:true,publisherFirstPartyTransport:helper}),
      result=await reader.readPublisherImageFirstParty(f.publisherObservation,f.targetUrl,f.resource,f.binding);
    assert(result.body,result.reason);assert.equal(result.body.receipt.responseObservedAt,"2027-01-15T08:00:00.008Z");
    assert.equal(result.body.receipt.observedAt,"2027-01-15T08:00:00.012Z");commit(f,result);
    assert.throws(()=>attachCourseraArchiveFileBytes(f.raw,[{path:result.body.archivePath,sha256:result.body.sha256,size:result.body.size,bytes:f.publisherMediaBytes}]),/native source binding/);
  } finally {clockMs=originalTime;}
});

test("archive intake independently checks the frozen global plan while ordinary continuation retains earlier recovery sessions", async () => {
  const f=fixture(), {result}=await acquire(f);commit(f,result);
  const files=[{path:result.body.archivePath,sha256:result.body.sha256,size:result.body.size,bytes:f.publisherMediaBytes}],
    mode=f.raw.meta.directDataCapture, originalManifest=structuredClone(mode.firstPartyRecovery);
  for(const mutate of [raw=>delete raw.meta.directDataCapture.firstPartyRecovery,
    raw=>raw.meta.directDataCapture.firstPartyRecovery.planSha256="c".repeat(64),
    raw=>raw.meta.directDataCapture.firstPartyRecovery.sessionId="c".repeat(32),
    raw=>raw.meta.directDataCapture.firstPartyRecovery.pinnedRunId="Another_run",
    raw=>raw.meta.directDataCapture.firstPartyRecovery.pinnedComparisonSha256="c".repeat(64),
    raw=>raw.meta.directDataCapture.firstPartyRecovery.entries[0].imageUrl=f.resource.url.replace("drawing-0","drawing-1"),
    raw=>raw.meta.directDataCapture.firstPartyRecovery.wholeWidgetVerified=true]) {
    const raw=JSON.parse(JSON.stringify(f.raw));mutate(raw);assert.throws(()=>attachCourseraArchiveFileBytes(raw,files),/native source binding/);
  }
  mode.firstPartyRecoveryHistory=[originalManifest];
  mode.firstPartyRecovery={...structuredClone(originalManifest),sessionId:"c".repeat(32)};
  attachCourseraArchiveFileBytes(JSON.parse(JSON.stringify(f.raw)),files);
  const flags=mode.materials.elements[0].material.elements[0].elements[0].elements[0].content.definition.assignmentFeatures;
  flags.reverse();mode.finalMaterials=structuredClone(mode.materials);mode.initialMaterialHash=hash(directCanonicalSourceTextV1(mode.materials.elements[0]));
  assert.notEqual(mode.initialMaterialHash,originalManifest.pinnedMaterialHash,"raw feature order changed");
  attachCourseraArchiveFileBytes(JSON.parse(JSON.stringify(f.raw)),files);
  mode.firstPartyRecoveryHistory=Array.from({length:17},()=>structuredClone(originalManifest));
  assert.throws(()=>attachCourseraArchiveFileBytes(f.raw,files),/native source binding/,"manifest history cannot be truncated");
});
