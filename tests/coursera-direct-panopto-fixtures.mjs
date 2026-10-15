import { createHash } from "node:crypto";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";
import { widgetFixture, WIDGET_COURSE, WIDGET_SLUG } from "./coursera-direct-widget-fixtures.mjs";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { directWidgetContractV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { directPanoptoSourceV1, sanitizeDirectPanoptoModelV1, directPanoptoPodcastBindingsV1 } from "../src/extractors/coursera/direct-data-panopto.js";
import { directPanoptoRequestFormV1 } from "../src/extractors/coursera/direct-data-panopto-contracts.js";
export const panoptoHash = value => createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex");
export function directPanoptoFixture() {
  const native = panoptoDeliveryFixture(), targetUrl = native.targetUrl.replace("video.example.test", "fixture.hosted.panopto.com");
  native.model.EmbedUrl = native.model.EmbedUrl.replace("video.example.test", "fixture.hosted.panopto.com");
  const f = widgetFixture({url:targetUrl}), model = sanitizeDirectPanoptoModelV1(native.model,targetUrl).data;
  directWidgetContractV1(f.fp,f.bound);
  const sourceHash = panoptoHash(directPanoptoSourceV1(targetUrl,model)), target = new URL(targetUrl);
  const receipt = {resource:"PanoptoDeliveryInfo",origin:target.origin,id:native.ids.A,targetUrl,
    method:"POST",requestPath:"/Panopto/Pages/Viewer/DeliveryInfo.aspx",requestForm:directPanoptoRequestFormV1(native.ids.A),
    status:200,mime:"application/json; charset=utf-8",bytes:10000,originalResponseSha256:"d".repeat(64),sha256:"d".repeat(64),
    bodyFormat:"PARSED_SANITIZED_JSON_MODEL",observedAt:"2026-10-15T12:00:00.000Z"};
  const read = {model,receipt,sourceHash,modelHash:panoptoHash(model)};
  const bytes = Uint8Array.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]),
    hash = createHash("sha256").update(bytes).digest("hex"), candidate = directPanoptoPodcastBindingsV1(model,targetUrl)[0];
  const body = {kind:"PANOPTO_PODCAST_RENDITION",base64:Buffer.from(bytes).toString("base64"),sha256:hash,size:bytes.length,mime:"video/mp4",canonicalUrl:candidate.canonicalUrl,
    receipt:{role:"PODCAST_STREAM_RENDITION",status:200,bytes:bytes.length,mime:"video/mp4",canonicalUrl:candidate.canonicalUrl,sha256:hash,
      observedAt:"2026-10-15T12:00:01.000Z",bodyFormat:"ORIGINAL_BINARY_BYTES_BASE64"}};
  const delivery = {targetUrl,initial:structuredClone(read),final:structuredClone(read),stableSource:true,podcasts:[{...candidate,body}],failures:[]};
  const evidence = {method:"BOUND_WIDGET_PANOPTO_DELIVERY",courseId:WIDGET_COURSE,itemId:f.fp.id,atomId:f.fp.atomId,
    providerId:f.fp.payload.directWidgetProviderEvidence.providerId,deliveries:[delivery],wholeWidgetVerified:false,
    playbackVerified:false,launchVerified:false,originalUploadVerified:false};
  f.fp.payload.directPanoptoEvidence=evidence;
  const materials={elements:[{id:WIDGET_COURSE,material:{elements:[{id:"module",name:"Synthetic module",elements:[{
    id:f.fp.id,name:f.fp.name,atomId:f.fp.atomId,contentId:f.fp.contentId,content:{typeName:"ungradedWidget",definition:{}}}]}]},
    conflictMetadata:{version:1,courseBranchVersion:1}}],paging:{}};
  const materialHash=panoptoHash(materials.elements[0]), materialReceipt={resource:"authoringCourseMaterials.v1",id:WIDGET_COURSE,status:200,
    bodyFormat:"PARSED_SANITIZED_JSON_MODEL",originalResponseSha256:"d".repeat(64),sha256:"d".repeat(64),requestPath:"/api/authoringCourseMaterials.v1/"+WIDGET_COURSE};
  const capture={page:{courseId:WIDGET_COURSE,url:`https://www.coursera.org/teach/${WIDGET_SLUG}/${WIDGET_COURSE}/content/edit`},
    meta:{baseFingerprintCount:1,directDataCapture:{mode:"BOUND_AUTHORING_DRAFT_API",version:1,sourceStable:true,acquisitionComplete:true,
      wholeCourseVerified:false,initialMaterialHash:materialHash,finalMaterialHash:materialHash,materialVersion:1,courseBranchVersion:1,
      materials,finalMaterials:structuredClone(materials),materialsReceipt:materialReceipt,finalMaterialsReceipt:structuredClone(materialReceipt)},
      captureAccounting:{inventoryCount:1,completeCount:0,unresolvedCount:1,unknownCount:0,unvisitedCount:0,externalContentUnverifiedCount:1,
        allInventoryAccounted:true,noSilentMisses:true,complete:false}},fingerprints:[f.fp]};
  return {...f,...native,targetUrl,model,evidence,delivery,body,bytes,candidate,capture,targets:f.fp.payload.directWidgetProviderEvidence.targets};
}
