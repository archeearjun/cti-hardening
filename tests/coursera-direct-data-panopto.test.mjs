import test from "node:test";
import assert from "node:assert/strict";
import { directPanoptoFixture, panoptoHash } from "./coursera-direct-panopto-fixtures.mjs";
import { directPanoptoAutomaticTargetV1, directPanoptoTargetV1, sanitizeDirectPanoptoModelV1,
  directPanoptoSourceV1, directPanoptoProjectionV1, directPanoptoPodcastBindingsV1 } from "../src/extractors/coursera/direct-data-panopto.js";
import { directPanoptoEvidenceStructureV1, directPanoptoArchiveBodiesV1 } from "../src/extractors/coursera/direct-data-panopto-contracts.js";
import { evaluateCourseraCapture } from "../src/domain/coursera-background-extraction.ts";
const checked=f=>directPanoptoEvidenceStructureV1(f.evidence,f.targets);
const invalid=f=>evaluateCourseraCapture(f.capture,f.evidence.courseId).reasons.some(r=>r.startsWith("DIRECT_PANOPTO_SOURCE_INVALID:"));

test("automatic provider scope and three distinct native identity roles remain exact",()=>{
  const f=directPanoptoFixture(), p=directPanoptoProjectionV1(f.targetUrl,f.model);
  assert.deepEqual(directPanoptoAutomaticTargetV1(f.targetUrl),{origin:"https://fixture.hosted.panopto.com",deliveryPublicId:f.ids.A});
  const other=f.targetUrl.replace("fixture.hosted.panopto.com","video.example.test");
  assert.ok(directPanoptoTargetV1(other)); assert.equal(directPanoptoAutomaticTargetV1(other),null);
  for(const url of [f.targetUrl.replace("https:","http:"),f.targetUrl+"&id="+f.ids.A,f.targetUrl+"#fragment",f.targetUrl.replace("Embed.aspx","List.aspx"),f.targetUrl.replace("fixture.hosted.panopto.com","fixture.hosted.panopto.com.evil.test")])
    assert.equal(directPanoptoAutomaticTargetV1(url),null);
  assert.equal(p.identity.deliveryPublicId,f.ids.A); assert.equal(p.identity.sessionPublicId,f.ids.B);
  assert.equal(p.identity.sessionFileId,f.ids.C); assert.equal(p.identity.viewerFileId,f.ids.D);
  assert.equal(p.navigation[0].sessionFileId,f.ids.C); assert.equal(p.navigation.length,9);
  assert.equal(p.captions.status,"REPORTED_NONE"); assert.equal(p.streams.length,2);
  assert.equal(p.streams[0].role,"VIEWER_STREAM"); assert.equal(p.streams[1].role,"PODCAST_STREAM");
  assert.equal(p.navigation[0].text,"Synthetic section 1 &lt;label&gt; &amp; <literal>");
});

test("native content joins and embed-origin identity fail closed without globally weakening sanitization",()=>{
  for(const mutate of [m=>m.SessionId="00000009-0000-4000-8000-000000000009",m=>m.Delivery.Timestamps[0].SessionID=m.Delivery.PublicID,
    m=>m.EmbedUrl=m.EmbedUrl.replace("fixture.hosted.panopto.com","another.hosted.panopto.com"),m=>m.Delivery.PublicID=m.Delivery.SessionPublicID]){
    const f=directPanoptoFixture(); mutate(f.model); assert.throws(()=>sanitizeDirectPanoptoModelV1(f.model,f.targetUrl));
  }
  const f=directPanoptoFixture(); f.model.accessToken="synthetic-secret";
  f.model.Delivery.PodcastStreams[0].StreamUrl+="?Signature=synthetic-secret";
  const sanitized=sanitizeDirectPanoptoModelV1(f.model,f.targetUrl);
  assert.equal(sanitized.data.accessToken,undefined); assert.equal(sanitized.data.SessionId,f.ids.B);
  assert.ok(!JSON.stringify(sanitized.data).includes("synthetic-secret"));
  assert.throws(()=>directPanoptoSourceV1(f.targetUrl,f.model));
});

test("stable content excludes mutable viewing fields and includes rendition/caption/navigation content",()=>{
  const f=directPanoptoFixture(), initial=panoptoHash(directPanoptoSourceV1(f.targetUrl,f.model));
  f.model.InvocationId=f.ids.A; f.model.LastViewingPosition=120; f.model.UserName="Synthetic observer";
  assert.equal(panoptoHash(directPanoptoSourceV1(f.targetUrl,f.model)),initial);
  for(const mutate of [m=>m.Delivery.Duration++,m=>m.Delivery.Timestamps[0].Caption+=" authored",m=>m.Delivery.HasCaptions=true,
    m=>m.Delivery.Streams[0].Variants[0].Bandwidth++]){
    const f=directPanoptoFixture(); mutate(f.model); assert.notEqual(panoptoHash(directPanoptoSourceV1(f.targetUrl,f.model)),initial);
  }
});

test("only declared MP4 podcasts produce body candidates; unknown captions never become transcripts",()=>{
  const f=directPanoptoFixture(); assert.deepEqual(directPanoptoPodcastBindingsV1(f.model,f.targetUrl),[f.candidate]);
  f.model.Delivery.PodcastStreams[0].ViewerMediaFileTypeName="hls";
  assert.deepEqual(directPanoptoPodcastBindingsV1(f.model,f.targetUrl),[]);
  f.model.Delivery.AvailableCaptions=[{unknown:"literal retained metadata"}];
  const p=directPanoptoProjectionV1(f.targetUrl,f.model); assert.equal(p.captions.status,"CONTRADICTORY");
  assert.equal(p.navigation[0].eventType,"SmartOcrToc"); assert.equal(p.transcript,undefined);
});

test("source and actual podcast byte hashes validate independently while whole widgets stay incomplete",()=>{
  const f=directPanoptoFixture(), result=checked(f), verdict=evaluateCourseraCapture(f.capture,f.evidence.courseId);
  assert.equal(result.valid,true); assert.equal(result.metadataVerified,true); assert.equal(result.podcastBodiesVerified,true);
  assert.equal(invalid(f),false); assert.equal(verdict.complete,false); assert.ok(verdict.reasons.includes("PLUGIN_BODY_UNVERIFIED:WidgetA"));
  assert.equal(f.fp.captureContract.complete,false);
  for(const mutate of [f=>f.evidence.courseId="other",f=>f.delivery.initial.receipt.requestForm[0][1]=f.ids.B,
    f=>f.delivery.final.receipt.method="GET",f=>f.delivery.final.receipt.requestForm.push(["action","change"]),
    f=>f.delivery.initial.receipt.origin="https://other.hosted.panopto.com",f=>f.delivery.podcasts[0].streamFileId=f.ids.E,
    f=>f.body.receipt.status=206,f=>f.body.receipt.contentRange="bytes 0-19/40",f=>f.body.mime="text/html",f=>f.evidence.wholeWidgetVerified=true]){
    const f=directPanoptoFixture(); mutate(f); assert.equal(checked(f).valid,false); assert.equal(invalid(f),true);
  }
  for(const mutate of [f=>{for(const read of [f.delivery.initial,f.delivery.final])read.model.Delivery.SessionName="Tampered source";},
    f=>{for(const read of [f.delivery.initial,f.delivery.final])read.model.UnknownMetadata="Retained metadata tampered";},
    f=>{f.body.sha256="a".repeat(64);f.body.receipt.sha256=f.body.sha256;}]){
    const f=directPanoptoFixture(); mutate(f); assert.equal(checked(f).valid,true); assert.equal(invalid(f),true);
  }
});

test("blocked and changed reads remain explicit partial metadata without fabricated current body proof",()=>{
  const f=directPanoptoFixture(); f.delivery.final=null; f.delivery.stableSource=false; f.delivery.failures=["CORS_OR_NETWORK_BLOCKED"];
  let result=checked(f); assert.equal(result.valid,true); assert.equal(result.metadataVerified,false); assert.equal(result.podcastBodiesVerified,false);
  assert.equal(invalid(f),false);
  const g=directPanoptoFixture(); g.delivery.final.model.Delivery.Duration++;
  g.delivery.final.modelHash=panoptoHash(g.delivery.final.model);
  g.delivery.final.sourceHash=panoptoHash(directPanoptoSourceV1(g.targetUrl,g.delivery.final.model));
  g.delivery.stableSource=false;g.delivery.failures=["SOURCE_CHANGED"];
  assert.equal(checked(g).valid,true); assert.equal(checked(g).metadataVerified,false); assert.equal(invalid(g),false);
  const h=directPanoptoFixture(); h.delivery.initial=null;h.delivery.final=null;h.delivery.stableSource=false;
  h.delivery.podcasts=[];h.delivery.failures=["CORS_OR_NETWORK_BLOCKED"];
  assert.equal(checked(h).valid,true);assert.equal(checked(h).metadataVerified,false);assert.equal(invalid(h),false);
});

test("archive preflight owns scoped podcast descriptors and historical bodies without current promotion",()=>{
  const f=directPanoptoFixture(); delete f.body.base64;f.body.archivePath="files/"+f.body.sha256;
  f.body.receipt.bodyFormat="ORIGINAL_BINARY_BYTES_ARCHIVE";
  assert.equal(checked(f).valid,false);
  assert.deepEqual(directPanoptoArchiveBodiesV1(f.fp,f.evidence.courseId),[f.body]);
  Object.defineProperty(f.body,"bytes",{value:f.bytes,enumerable:false,configurable:true});
  assert.equal(checked(f).podcastBodiesVerified,true);
  const retained={targetUrl:f.targetUrl,initial:f.delivery.initial,final:f.delivery.final,stableSource:true,
    podcast:{...f.candidate,body:f.body}};
  f.delivery.initial=null;f.delivery.final=null;f.delivery.stableSource=false;f.delivery.failures=["CORS_OR_NETWORK_BLOCKED"];
  f.delivery.podcasts=[{...f.candidate,reason:"CURRENT_BODY_NOT_OBSERVED",retainedEvidence:retained}];
  const result=checked(f);assert.equal(result.valid,true);assert.equal(result.metadataVerified,false);
  assert.equal(result.podcastBodiesVerified,false);assert.equal(result.decoded.length,0);assert.equal(result.historical.length,1);
  assert.deepEqual(directPanoptoArchiveBodiesV1(f.fp,f.evidence.courseId),[f.body]);assert.equal(invalid(f),false);
  retained.final.sourceHash="b".repeat(64);assert.equal(checked(f).valid,false);
});

test("native candidate removal or changed URL retains separately bound historical bytes",()=>{
  for(const change of ["removed","changed"]){
    const f=directPanoptoFixture(), old=f.delivery.podcasts[0], retained={targetUrl:f.targetUrl,
      initial:structuredClone(f.delivery.initial),final:structuredClone(f.delivery.final),stableSource:true,podcast:old};
    for(const read of [f.delivery.initial,f.delivery.final]){
      if(change==="removed")read.model.Delivery.PodcastStreams=[];
      else read.model.Delivery.PodcastStreams[0].StreamUrl="https://media.example.test/replaced.mp4";
      read.modelHash=panoptoHash(read.model);read.sourceHash=panoptoHash(directPanoptoSourceV1(f.targetUrl,read.model));
    }
    const candidate=directPanoptoPodcastBindingsV1(f.delivery.initial.model,f.targetUrl)[0]||f.candidate;
    f.delivery.podcasts=[{...candidate,reason:"CURRENT_BODY_NOT_OBSERVED",retainedEvidence:retained}];
    const result=checked(f);assert.equal(result.valid,true);assert.equal(result.historical.length,1);
    assert.equal(result.podcastBodiesVerified,false);assert.equal(result.decoded.length,0);assert.equal(invalid(f),false);
  }
});

test("normal content view preserves literal native metadata and stream references without claiming complete source text",async()=>{
  const {capturedContent,validateContentSnapshot,contentEvidenceText}=await import("../src/domain/content-evidence.ts");
  const f=directPanoptoFixture(), view=capturedContent(f.fp.payload,{basis:"Original extraction",itemId:f.fp.id});
  assert.equal(view.textCoverage,"PARTIAL");assert.ok(view.text.includes(f.model.Delivery.SessionName));
  for(const item of f.model.Delivery.Timestamps)assert.ok(view.text.includes(item.Caption));
  assert.ok(view.text.includes("Caption inventory: REPORTED_NONE"));assert.ok(view.text.includes("bodies verified in this input: 1"));
  assert.ok(view.references.includes(f.candidate.canonicalUrl));assert.ok(!view.text.includes("User-provided"));
  validateContentSnapshot({schemaVersion:1,coursera:[{id:f.fp.id,name:f.fp.name,path:"",content:view}],brightspace:[]});
  assert.ok(contentEvidenceText(view).includes(f.model.Delivery.Timestamps[0].Caption));
  for(const read of [f.delivery.initial,f.delivery.final])read.model.Delivery.SessionName="Tampered source";
  assert.equal(capturedContent(f.fp.payload,{basis:"Original extraction",itemId:f.fp.id}).text,"");
});

test("initial exact native ownership retains fresh bytes after final provider or atom revalidation fails",()=>{
  const f=directPanoptoFixture();delete f.body.base64;f.body.archivePath="files/"+f.body.sha256;f.body.receipt.bodyFormat="ORIGINAL_BINARY_BYTES_ARCHIVE";
  const widget=f.fp.payload.directWidgetProviderEvidence;
  widget.stableSource=false;widget.final=null;
  f.fp.payload.directResumeRevalidation={verified:false};f.fp.payload.directDataSources.receipts.stability.stable=false;
  assert.deepEqual(directPanoptoArchiveBodiesV1(f.fp,f.evidence.courseId),[f.body]);
  widget.initial.model.elements[0].id="z".repeat(22);
  assert.deepEqual(directPanoptoArchiveBodiesV1(f.fp,f.evidence.courseId),[]);
});

function backendFixture(){
 const f=directPanoptoFixture();
 for(const read of [f.delivery.initial,f.delivery.final])Object.assign(read.receipt,{
  transport:'CTI_PUBLIC_BACKEND',serviceOrigin:'https://cti-hardening.pages.dev',receivedAt:'2026-10-15T12:00:02.000Z',
  observedAtBasis:'UPSTREAM',upstreamRequests:1,serviceStatus:200});
 Object.assign(f.body.receipt,{transport:'CTI_PUBLIC_BACKEND',serviceOrigin:'https://cti-hardening.pages.dev',
  receivedAt:'2026-10-15T12:00:02.000Z',observedAtBasis:'UPSTREAM',upstreamRequests:2,serviceStatus:200,
  validationMetadataBytes:1234,validationSourceHash:f.delivery.initial.sourceHash,validationObservedAt:'2026-10-15T12:00:00.500Z',targetUrl:f.targetUrl});
 return f;
}

test('explicit public CTI service transport retains native metadata and independently verified rendition bytes',async()=>{
 const f=backendFixture(),result=checked(f);assert.equal(result.valid,true);assert.equal(result.podcastBodiesVerified,true);assert.equal(invalid(f),false);
 assert.equal(f.fp.captureContract.complete,false);
 const {capturedContent}=await import('../src/domain/content-evidence.ts');
 const view=capturedContent(f.fp.payload,{basis:'Original extraction',itemId:f.fp.id});
 assert.ok(view.text.includes("CTI's public service retrieved Panopto metadata and MP4 podcast rendition bytes without Panopto cookies"));
 assert.ok(view.text.includes('not cryptographic attestation'));assert.ok(view.text.includes('bodies verified in this input: 1'));
 assert.equal(view.textCoverage,'PARTIAL');
});

test('service origin, observation basis, timestamps and validation usage cannot replace native proof',()=>{
 for(const mutate of [f=>f.delivery.initial.receipt.transport='UNVERIFIED_PROXY',
  f=>f.delivery.initial.receipt.serviceOrigin='https://other.example.test',
  f=>delete f.delivery.initial.receipt.receivedAt,f=>f.delivery.initial.receipt.receivedAt='2026',
  f=>f.delivery.initial.receipt.receivedAt='2026-10-15T10:00:00.000Z',
  f=>f.delivery.initial.receipt.upstreamRequests=0,f=>f.delivery.initial.receipt.observedAtBasis='CLIENT_ATTEMPT',
  f=>f.body.receipt.upstreamRequests=1,f=>f.body.receipt.validationMetadataBytes=0,
  f=>f.body.receipt.validationMetadataBytes=512*1024+1,f=>f.body.receipt.validationSourceHash='a'.repeat(64),
  f=>f.body.receipt.validationObservedAt='2026-10-16T12:00:00.000Z',f=>f.body.receipt.serviceStatus=401]){
  const f=backendFixture();mutate(f);assert.equal(checked(f).valid,false);assert.equal(invalid(f),true);
 }
 const legacy=directPanoptoFixture();assert.equal(checked(legacy).valid,true);
 for(const read of [legacy.delivery.initial,legacy.delivery.final])read.receipt.transport='COURSE_TAB_FETCH';
 legacy.body.receipt.transport='COURSE_TAB_FETCH';assert.equal(checked(legacy).valid,true);
 legacy.body.receipt.serviceOrigin='https://cti-hardening.pages.dev';assert.equal(checked(legacy).valid,false);
});

test('failed service validation may retain an actual changed source hash without certifying a body',()=>{
 const f=backendFixture(),pod=f.delivery.podcasts[0];pod.receipt={...f.body.receipt,validationSourceHash:'a'.repeat(64),status:0,
  serviceStatus:409,observedAtBasis:'CLIENT_ATTEMPT'};delete pod.body;pod.reason='PANOPTO_SOURCE_CHANGED';
 f.delivery.failures=[{reason:pod.reason,streamFileId:pod.streamFileId}];
 assert.equal(checked(f).valid,true);assert.equal(checked(f).podcastBodiesVerified,false);assert.equal(invalid(f),false);
});

test('prior direct and service failures remain bounded same-target diagnostic history',()=>{
 const f=backendFixture(),old=directPanoptoFixture().delivery.initial.receipt;
 old.status=0;old.originalResponseSha256='';old.sha256='';
 f.delivery.previousFailures=[{reason:'PANOPTO_ACCESS_BLOCKED_OR_FAILED',receipt:old}];f.delivery.previousFailuresTruncated=false;
 assert.equal(checked(f).valid,true);assert.equal(checked(f).metadataVerified,true);
 const receipt={...f.delivery.initial.receipt,status:0,serviceStatus:502,upstreamRequests:1,observedAtBasis:'CLIENT_ATTEMPT'};
 f.delivery.previousFailures.push({reason:'CTI_PROVIDER_REQUEST_FAILED',receipt});assert.equal(checked(f).valid,true);
 receipt.targetUrl=receipt.targetUrl.replace('fixture.hosted','other.hosted');assert.equal(checked(f).valid,false);
 receipt.targetUrl=f.targetUrl;f.delivery.previousFailures=Array.from({length:33},()=>({reason:'PANOPTO_ACCESS_BLOCKED_OR_FAILED'}));
 assert.equal(checked(f).valid,false);
});

test('failed service metadata limit retains charged overflow without manufacturing validation proof',()=>{
 const f=backendFixture(),pod=f.delivery.podcasts[0];pod.receipt={...f.body.receipt,status:0,serviceStatus:413,
  upstreamRequests:1,observedAtBasis:'CLIENT_ATTEMPT',validationMetadataBytes:512*1024+65536};
 delete pod.receipt.validationSourceHash;delete pod.receipt.validationObservedAt;delete pod.body;pod.reason='PANOPTO_METADATA_BYTE_LIMIT';
 f.delivery.failures=[{reason:pod.reason,streamFileId:pod.streamFileId}];
 assert.equal(checked(f).valid,true);assert.equal(checked(f).podcastBodiesVerified,false);assert.equal(invalid(f),false);
});
