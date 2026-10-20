import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { buildSourceEvidenceFromZip_ } from "../src/source/scan.js";
import { extractTextEvidence_ } from "../src/source/content.js";
import { qaTextComparison_ } from "../src/engine/matching/payload.js";
import { normalizeCourseraItem_ } from "../src/engine/capture/normalization.js";
import { qaMergeCourseraPayload_ } from "../src/engine/capture/recovery.js";
import { qaApplyIncompleteTraversalGap_ } from "../src/engine/capture/evidence-limitations.js";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
import { comparisonFixture, encode } from "./workflow-fixtures.mjs";

const text = "An original instructional paragraph explaining quantities and measurements. ".repeat(4);
const model = () => ({textSample:text,textLength:text.length,textSha256:"a".repeat(64),textEvidenceCompleteness:1,type:"Reading"});

test("equal text hashes cannot certify truncated source evidence or unread destination bodies", () => {
  const source=model(), destination=model();
  assert.equal(qaTextComparison_(source,destination).status,"VERIFIED");
  for (const gap of [{evidenceTruncated:true},{textHashScope:"CAPTURED_SAMPLE"},{sourceTextRefreshRequired:true}])
    assert.equal(qaTextComparison_({...source,...gap},destination).status,"UNVERIFIED");
  assert.equal(qaTextComparison_(source,{...destination,directCaptureLimitation:{reason:"Unread body"}}).status,"UNVERIFIED");
});

test("source scanning labels bounded fragments and failed reads without changing originals", async t => {
  const original=globalThis.DOMParser;
  globalThis.DOMParser=DOMParser;t.after(()=>{globalThis.DOMParser=original;});
  const full=text.repeat(100), zip=new JSZip();
  zip.file("long.txt",full);
  const manifest='<manifest><resources><resource identifier="r" type="webcontent" href="long.txt"><file href="long.txt"/><file href="missing.txt"/></resource></resources></manifest>';
  const result=await buildSourceEvidenceFromZip_({},zip,manifest,"imsmanifest.xml");
  const r=result.resources.r;
  assert.equal(r.textSample.length,16000);
  assert.equal(r.textHashScope,"CAPTURED_SAMPLE");
  assert.equal(r.textCoverage.status,"INCOMPLETE");
  assert.equal(r.textCoverage.wholeResourceVerified,false);
  assert.equal(r.files[0].textHashScope,"FULL_NORMALIZED_FILE_TEXT");
  assert.equal(r.files[1].presentInPackage,false);
  assert.equal(await zip.file("long.txt").async("string"),full);
  zip.files["long.txt"].async=async()=>{throw new Error("Unreadable original");};
  const failed=(await buildSourceEvidenceFromZip_({},zip,manifest,"imsmanifest.xml")).resources.r;
  assert.equal(failed.evidenceTruncated,true);
  assert.equal(failed.textHashScope,"CAPTURED_SAMPLE");
  assert.equal(failed.textNormalizationStatus,"SOURCE_REFRESH_REQUIRED");
});

test("failed HTML parsing does not turn original markup into verified learner text", t => {
  const original=globalThis.DOMParser;
  globalThis.DOMParser=class {parseFromString(){throw new Error("Parser unavailable");}};
  t.after(()=>{globalThis.DOMParser=original;});
  assert.throws(()=>extractTextEvidence_("<p>Original instructional HTML</p>","html"),/not verified learner text/);
});

test("native incomplete-body limitation survives exact-ID enrichment without promoting a completion flag", () => {
  // Shape and reason codes observed on mSOBO in the uploaded v1.9.4 capture.
  const original={id:"reading",type:"Reading",payload:{...model(),assetEvidenceConfidence:1,linkEvidenceConfidence:1,directDataSources:{},
    captureContract:{itemId:"reading",complete:false,status:"UNRESOLVED_DIRECT_READING",
      reasons:["DIRECT_READING_ASSETS_UNRESOLVED","DIRECT_CML_MEDIA_REFERENCE_UNSUPPORTED"]}}};
  const before=JSON.stringify(original), native=normalizeCourseraItem_(original);
  assert.equal(native.directCaptureLimitation.itemId,"reading");
  assert.equal(native.assetEvidenceConfidence,0);
  assert.equal(native.linkEvidenceConfidence,0);
  const merged=qaMergeCourseraPayload_({id:"reading",assetEvidenceConfidence:1},native);
  assert.equal(merged.assetEvidenceConfidence,0);
  assert.equal(qaTextComparison_(model(),merged).reasonCode,"DESTINATION_NATIVE_BODY_UNVERIFIED");
  assert.equal(qaMergeCourseraPayload_({id:"other"},native).directCaptureLimitation,undefined);
  original.payload.captureContract.complete=true;
  assert.equal(normalizeCourseraItem_(original).directCaptureLimitation,undefined,"absence of a negative limitation is not positive proof");
  original.payload.captureContract.complete=false;
  assert.equal(JSON.stringify(original),before);
});

test("unmatched non-link content stays unknown during incomplete traversal", () => {
  const result={verdict:"MISSING",checks:{structure:{status:"MISSING"}},issues:["MISSING_ITEM"],evidenceCoverage:30};
  qaApplyIncompleteTraversalGap_(result,{recorded:true,complete:false,unresolvedItemIds:["unread"],unresolvedCount:1},null);
  assert.equal(result.verdict,"UNVERIFIED");
  assert.equal(result.checks.structure.status,"UNVERIFIED");
  assert(!result.issues.includes("MISSING_ITEM"));
  const complete={verdict:"MISSING",checks:{},issues:["MISSING_ITEM"]};
  qaApplyIncompleteTraversalGap_(complete,{recorded:true,complete:true},null);
  assert.equal(complete.verdict,"MISSING");
});

test("full comparison preserves source and native destination gaps instead of verified parity", () => {
  const workflows=createWorkflows(workerXml);
  for (const side of ["source","destination"]) {
    const input=comparisonFixture();
    const capture=JSON.parse(new TextDecoder().decode(input.json.bytes));
    const p=input.course.data.scan.courseTree[0].children[0].sourcePayload;
    p.textSha256="a".repeat(64); capture.fingerprints[0].payload.textSha256=p.textSha256;
    if(side==="source")p.evidenceTruncated=true;
    else Object.assign(capture.fingerprints[0].payload,{directDataSources:{},captureContract:{
      itemId:"reading",complete:false,status:"UNRESOLVED_DIRECT_READING",reasons:["DIRECT_CML_MEDIA_REFERENCE_UNSUPPORTED"]}});
    input.json.bytes=encode(capture);
    const result=workflows.compare(input).result;
    assert.equal(result.success,true);
    const item=result.itemResults.find(r=>r.sourceId==="reading");
    assert.equal(item.verdict,"UNVERIFIED",side);
    assert.equal(item.checks.evidenceAvailability.status,"INSUFFICIENT_EVIDENCE");
    assert.equal(item.checks.content.status,"UNVERIFIED");
  }
});

test("all 34 recorded v1.9.4 gaps survive normalization; draft and published completion remain separate", () => {
  const fixture=JSON.parse(fs.readFileSync(new URL("./fixtures/coursera/v194-coverage-contracts.json",import.meta.url)));
  let limited=0;
  for(const row of fixture.items) {
    const fp={id:row.id,type:row.type,captureContract:row.captureContract,payload:{
      ...(row.hasDirectDataSources?{directDataSources:{}}:{}),
      ...(row.hasPublishedReadingEvidence?{directPublishedReadingEvidence:{}}:{}),
      ...(row.hasNativeRecheckAttempt?{directNativeRecheckAttempt:{}}:{})}};
    const normalized=normalizeCourseraItem_(fp);
    assert.equal(Boolean(normalized.directCaptureLimitation),!row.captureContract.complete,row.id);
    if(normalized.directCaptureLimitation) {
      limited++;
      assert.deepEqual(normalized.directCaptureLimitation.reasons,row.captureContract.reasons);
    }
  }
  assert.equal(limited,34);
  assert.equal(fixture.items.find(x=>x.id==="LFrHs").captureContract.status,"COMPLETE_BOUND_DRAFT_MANUAL_ASSESSMENT");
  assert.equal(fixture.items.find(x=>x.id==="SekFW").captureContract.status,"COMPLETE_BOUND_PUBLISHED_READING");
});

test("full comparison does not call an unmatched non-link item missing while editors are unread", () => {
  const input=comparisonFixture(), capture=JSON.parse(new TextDecoder().decode(input.json.bytes));
  const node=input.course.data.scan.courseTree[0].children[0];
  node.title="Unrelated source instructional activity";node.sourcePayload.links=[];
  node.sourcePayload.textSample="Investigate marine biodiversity through tidal surveys, identifying ecological relationships and writing a field journal.";
  node.sourcePayload.textLength=node.sourcePayload.textSample.length;
  capture.meta.activeSpaCrawl={targetIds:["reading","discussion"],eligibleTargets:2,
    targetDiagnostics:[{id:"reading"},{id:"discussion",editorSurfaceCaptured:true}]};
  input.json.bytes=encode(capture);
  const result=createWorkflows(workerXml).compare(input).result;
  assert.equal(result.success,true);
  const item=result.itemResults.find(r=>r.sourceId==="reading");
  assert.equal(item.verdict,"UNVERIFIED");
  assert.equal(item.checks.structure.standaloneMatch,"NOT_FOUND");
  assert.equal(item.checks.evidenceAvailability.destination.reasonCode,"DESTINATION_TRAVERSAL_INCOMPLETE");
  assert(!result.itemResults.some(r=>r.verdict==="MISSING"));
  capture.meta.activeSpaCrawl.targetDiagnostics[0].editorSurfaceCaptured=true;
  input.json.bytes=encode(capture);
  assert.equal(createWorkflows(workerXml).compare(input).result.itemResults.find(r=>r.sourceId==="reading").verdict,"MISSING");
  delete capture.meta.activeSpaCrawl;
  Object.assign(capture.fingerprints[0].payload,{directDataSources:{},captureContract:{
    itemId:"reading",complete:false,status:"UNRESOLVED_DIRECT_READING",reasons:["DIRECT_CML_MEDIA_REFERENCE_UNSUPPORTED"]}});
  input.json.bytes=encode(capture);
  const native=createWorkflows(workerXml).compare(input).result.itemResults.find(r=>r.sourceId==="reading");
  assert.equal(native.verdict,"UNVERIFIED");
  assert.equal(native.checks.evidenceAvailability.destination.reasonCode,"DESTINATION_NATIVE_BODIES_UNVERIFIED");
});

test("a native incomplete body cannot turn an unobserved source attachment into confirmed missing media", () => {
  const input=comparisonFixture(),capture=JSON.parse(new TextDecoder().decode(input.json.bytes));
  input.course.data.scan.courseTree[0].children[0].sourcePayload.files=[
    {name:"original.pdf",sha256:"b".repeat(64),size:100,presentInPackage:true}
  ];
  Object.assign(capture.fingerprints[0].payload,{assetEvidenceConfidence:1,directDataSources:{},
    captureContract:{itemId:"reading",complete:false,status:"UNRESOLVED_DIRECT_READING",
      reasons:["DIRECT_CML_EXTERNAL_ATTACHMENT_UNFETCHED"]}});
  input.json.bytes=encode(capture);
  const item=createWorkflows(workerXml).compare(input).result.itemResults.find(r=>r.sourceId==="reading");
  assert(!item.issues.includes("MISSING_ASSET"));
  assert(item.issues.includes("PAYLOAD_UNVERIFIED"));
  assert.equal(item.checks.assets.status,"UNVERIFIED");
});
