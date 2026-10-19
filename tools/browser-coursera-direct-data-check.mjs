import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import JSZip from 'jszip';
import {createApiHandler,handleAuthorized} from '../server/api.ts';
import {CTI_OWNER_EMAIL} from '../server/access.ts';
import {workspaceRuntimeApiRequest,workspaceRuntimeCaller} from '../server/workspace-runtime.ts';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';
import {readCourseraCaptureFileJson} from '../src/domain/coursera-capture-file.ts';
import {panoptoDeliveryFixture} from '../tests/panopto-delivery-fixtures.mjs';
import {validateProviderAccessDiagnostic,providerAccessDiagnosticText} from '../src/domain/provider-access-diagnostic.ts';
import {createCourseraDirectDataCaptureBookmark,createCourseraDirectDataCaptureScript} from '../src/domain/coursera-direct-data-capture.ts';
import {encodeJavaScriptBookmarkPayload} from '../src/domain/bookmark-address.js';
import {bindDirectAuthoringDraftV1} from '../src/extractors/coursera/direct-data-models.js';
import {bindDirectPublishedDraftSnapshotV1,directPublishedDraftSnapshotInventoryV1,directPublishedDraftSnapshotSourceV1} from '../src/extractors/coursera/direct-data-authoring-snapshot.js';
import {directInlineWidgetEvidenceV1} from '../src/extractors/coursera/direct-data-contracts.js';
import {directCanonicalSourceTextV1} from '../src/extractors/coursera/direct-data-canonical.js';
import {directPublicHtmlEvidenceV1} from '../src/extractors/coursera/direct-data-public-page.js';
import {directPublisherEvidenceV1,directPublisherChapterV1,directPublisherResourceEvidenceV1,directPublisherResourceV1} from '../src/extractors/coursera/direct-data-publisher.js';
import {directPublisherMediaInventoryV1,directPublisherMediaEvidenceV1} from '../src/extractors/coursera/direct-data-publisher-media.js';
import {courseraInlineWidgetContent,courseraInlineWidgetContentText,courseraInlinePublisherResource} from '../src/domain/coursera-inline-widget-content.ts';
import {courseraAuthoringDraftSnapshot,validateCourseraAuthoringDraftSnapshot,courseraAuthoringDraftSnapshotText} from '../src/domain/coursera-authoring-draft-snapshot.ts';

// Execute the actual generated direct-data delivery program. The default CI
// path requires browser-initiated javascript: navigation. The explicit local
// flag permits only a separately reported reader test where managed Chromium's
// URL policy also blocks a no-CSP native canary; policies are never changed.
// Synthetic timings and schemas certify no private Coursera course or plugin.
const origin='https://www.coursera.org',slug='synthetic-direct-data';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-direct-data-browser-'));
const allowPolicyFallback=process.env.CTI_ALLOW_BOOKMARK_POLICY_BLOCKED==='1';
let knownPolicy=false;
try{const policy=JSON.parse(fs.readFileSync('/etc/chromium/policies/managed/urls.json','utf8'));
  knownPolicy=policy.URLBlocklist?.includes('*')&&!policy.URLAllowlist?.some(value=>value==='*'||/^javascript(?::|$)/i.test(value));
}catch{ /* Stock hosted Chromium has no local managed policy file. */ }
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),
  '-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const groupResource='authoringAssignmentQuestionGroups.v1',definitionResource='authoringAssignmentMachineEvaluableQuestions.v1';
const providerResource='authoringWidgetSessionProviders.v1';
const resources=new Set(['authoringCourseMaterials.v1','authoringCourses.v2','authoringAtoms.v2','authoringItemContentRelations.v1',groupResource,definitionResource,'assets.v1',providerResource]);
const mediaOrigin='https://fixture-cdn.cloudfront.net';
const helperOrigin='https://cti-hardening.pages.dev';
const panoptoOrigin='https://fixture.hosted.panopto.com',panoptoMediaOrigin='https://d2y36twrtb17ty.cloudfront.net';
const publisherOrigin='https://opentextbc.ca',publisherBook='syntheticbook';
const publisherOpaqueUrl=publisherOrigin+'/'+publisherBook+'/opaque-fixture.png';
const secrets=['fixture-http-only-cookie','fixture-write-token','fixture-nested-token','fixture-asset-signed-secret','fixture-cti-helper-cookie'];
const configs=new Map(),atoms=new Map(),groups=new Map(),definitions=new Map(),assets=new Map(),providers=new Map(),fileSizes=new WeakMap();
const requests=[],mediaRequests=[],documents=[],errors=[],active=new Map(),maximum=new Map();
const panoptoDeliveries=new Map(),panoptoRequests=[];
const publicPages=new Map(),publicPageRequests=[];
const publisherRequests=[],publisherCases=new Map(),publisherOpaqueRequests=[],publisherImageRequests=[],publisherImages=new Map(),publisherServiceImages=new Map();
const firstPartyPublisherRequests=[],firstPartyPublisherPages=new Map();
const helperRequests=[],helperUpstreamRequests=[],helperErrors=[];
const readerFixtureEntry=path.join(scratch,'direct-reader-entry.js');
fs.writeFileSync(readerFixtureEntry,`
import {createDirectDataReaderV1} from ${JSON.stringify(path.resolve('src/extractors/coursera/direct-data-network.js'))};
import {createDirectDataMediaReaderV1} from ${JSON.stringify(path.resolve('src/extractors/coursera/direct-data-media.js'))};
import {directPublisherMediaInventoryV1} from ${JSON.stringify(path.resolve('src/extractors/coursera/direct-data-publisher-media.js'))};
window.fixtureReadDirectProvider=async targetUrl=>{const reader=createDirectDataReaderV1();try{const result=await reader.readPanoptoDeliveryInfo(targetUrl);return{ok:result.ok,reason:result.reason,receipt:result.receipt};}finally{reader.abort('FIXTURE_FINISHED');}};
window.fixtureReadPublisher=async targetUrl=>{const reader=createDirectDataReaderV1();try{const result=await reader.readPublisherPage(targetUrl,{itemId:'item_0002',providerId:'abcdefghijklmnopqrstuv@1'});return{ok:result.ok,data:result.data,reason:result.reason,receipt:result.receipt,stats:reader.snapshot()};}finally{reader.abort('FIXTURE_FINISHED');}};
window.fixtureReadPublisherImage=async(observation,targetUrl,url)=>{const reader=createDirectDataMediaReaderV1({archiveMode:true});try{const inventory=directPublisherMediaInventoryV1(observation,targetUrl),resource=inventory?.resources.find(value=>value.url===url);const result=await reader.readPublisherImage(observation,targetUrl,resource);return{result,bodyBytes:result.body?.bytes?Array.from(result.body.bytes):null,stats:reader.snapshot()};}finally{reader.abort('FIXTURE_FINISHED');}};
`);
const directReaderBundle=await build({configFile:false,logLevel:'silent',publicDir:false,
  build:{write:false,emptyOutDir:false,minify:false,lib:{entry:readerFixtureEntry,name:'ctiDirectReaderFixture',formats:['iife']}}});
const directReaderSource=(Array.isArray(directReaderBundle)?directReaderBundle[0]:directReaderBundle).output.find(file=>file.type==='chunk').code;
const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7sAAAAAASUVORK5CYII=','base64');
// Container-shaped source bytes exercise archival and hashing, not playback.
const mp4Bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(20),Buffer.from('Synthetic podcast rendition bytes'),Buffer.alloc(160*1024+17,90)]);
const pdfBytes=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R /Size 3 >>\n%%EOF\n');
const presentation=new JSZip();
presentation.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
presentation.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
presentation.file('ppt/presentation.xml','<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>');
const pptxBytes=await presentation.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
function key(prefix,index){return prefix+String(index).padStart(22-prefix.length,'0');}
function cml(text,dtd='assess/1'){return {typeName:'cml',definition:{dtdId:dtd,value:'<co-content><p>'+text+'</p></co-content>'}};}
function makeCourse(id,mode,large=false){
  const items=[],partsCount=large?609:9,contentCount=large?165:mode==='large-export'?8:3,emptyCount=large?20:1;
  const config={id,mode,large,atomGets:new Map(),groupGets:new Map(),materialGets:0,partsCount,contentCount,emptyCount};configs.set(id,config);
  const courseIndex=configs.size;
  for(let index=0;index<contentCount;index++){
    const itemId='item_'+String(index).padStart(4,'0'),atomId=key('a'+courseIndex+'_',index);
    const type=index<2?'staffGraded':index===2&&large?'widget':'supplement';
    const contentId='atom~'+atomId,definition=type==='staffGraded'?{assignmentId:key('s'+courseIndex+'_',index)+'@1'}:
      type==='supplement'?{assetId:key('r'+courseIndex+'_',index)+'@1',assetTypeName:'html'}:{widgetId:'fixture-widget'};
    const leaf={id:itemId,name:'Material '+itemId,originalName:'Original '+itemId,published:false,atomId,contentId,
      content:{typeName:type,definition}};items.push(leaf);
    let draftContent;
    if(type==='staffGraded'){
      const count=index===0?partsCount:1,parts=[];
      for(let position=0;position<count;position++){
        const localId=key('g',position),groupId=atomId+'~'+localId,definitionId=atomId+'~'+key('q',position)+'@'+(position%3+1);
        parts.push({typeName:'storedQuestionGroupPart',definition:{id:localId}});
        groups.set(groupId,{courseId:id,itemId,value:{id:groupId,typeName:'storedQuestionGroup',questions:[definitionId],scoringWeight:1,
          writeAccessToken:secrets[1],validation:{isReadyForPublish:true}}});
        const checkbox=index===1;
        const native={prompt:cml('Synthetic question '+(position===8?7:position)+' café 日本語'),shuffleOptions:false,
          options:[0,1,2].map(option=>({id:'option-'+option,display:cml('Option '+option+' 日本語'),feedback:cml('Feedback '+option)})),
          ...(checkbox?{correctOptions:['option-0','option-2'],allowPartialScoring:false}:{correctOption:'option-'+(position%3)})};
        definitions.set(definitionId,{courseId:id,itemId,value:{id:definitionId,definition:{typeName:checkbox?'checkbox':'mcq',definition:native},
          validation:{typeName:'multipleChoiceValidation',definition:{isReadyForPublish:true}},writeAccessToken:secrets[1]}});
      }
      draftContent={typeName:'staffGradedDraft',definition:{name:'Draft '+itemId,parts,configuration:{shuffleQuestions:false},
        introduction:cml('Synthetic introduction'),passingFraction:0.8,reviewCriteria:cml('Synthetic review criteria'),assignmentLevelRubrics:[]}};
    }else if(type==='supplement')draftContent={typeName:'supplementDraft',definition:{name:'Draft '+itemId,
      content:cml(config.mode==='large-export'?'Bound large reading '+itemId+' '+'x'.repeat(1400000):
        'Bound reading body '+itemId+' café 日本語','supplement/1'),assetId:key('r'+courseIndex+'_',index)+'@2'}};
    else draftContent={typeName:'widgetDraft',definition:{widgetId:'fixture-widget',opaque:{externalBody:'not-fetched'}}};
    const atom={id:atomId,contentId,status:{typeName:'draftAtomStatus',definition:{}},storedAtomVersion:1,
      metadata:{updatedAt:1000},draft:{content:draftContent,timeCommitment:600},
      published:{content:{typeName:type==='supplement'?'supplementDraft':'oldPublishedType',definition:{name:'Separate published snapshot'}},timeCommitment:300},
      writeAccessToken:secrets[1],nested:{accessToken:secrets[2]}};
    const relation={id:atomId,atomId,branchRelationMap:{[id+'~'+itemId]:{courseId:id,itemId,courseSlug:slug}}};
    atoms.set(atomId,{courseId:id,itemId,atom,relation});
  }
  const empty=Array.from({length:emptyCount},(_,index)=>({id:'empty_'+index,name:'Explicit empty module '+index,
    elements:[],description:'',learningObjectives:[],timeCommitment:0}));
  config.material={id,courseId:id,conflictMetadata:{version:1,courseBranchVersion:1},
    material:{elements:[{id:'module_main',name:'Module',elements:[{id:'lesson_main',name:'Lesson',trackId:'fixture-track',elements:items}]},...empty]}};
  return config;
}
function makePublishedDraftSnapshotCourse(id,snapshotMode='stable'){
  const config=makeCourse(id,'complete'),row=[...atoms.values()].find(value=>value.courseId===id&&value.itemId==='item_0000'),
    material=config.material.material.elements[0].elements[0].elements[0],publishedAssignmentId=material.content.definition.assignmentId.replace('@1','@2');
  config.snapshotMode=snapshotMode;config.snapshotAtomId=row.atom.id;
  config.snapshotFirstGroupId=row.atom.id+'~'+row.atom.draft.content.definition.parts[0].definition.id;
  config.snapshotSecondGroupId=row.atom.id+'~'+row.atom.draft.content.definition.parts[1].definition.id;
  material.published=true;material.content.definition.assignmentId=snapshotMode==='forged-pointer'?publishedAssignmentId.replace('@2','@3'):publishedAssignmentId;
  row.atom.status={typeName:'publishedAtomStatus',definition:{}};row.atom.storedAtomVersion=2;
  row.atom.published.content={typeName:'staffGraded',definition:{assignmentId:publishedAssignmentId,isGraded:false}};
  row.atom.draft.content.definition.configuration.isGraded=false;
  row.atom.draft.content.definition.unknownOriginalField={text:'Literal attached draft field 日本語',enabled:false};
  // This original numeric model is retained without manufacturing an MCQ or
  // promoting a draft answer to a current published assessment answer.
  const lastGroup=groups.get(row.atom.id+'~'+row.atom.draft.content.definition.parts.at(-1).definition.id),
    lastDefinition=definitions.get(lastGroup.value.questions[0]);
  lastDefinition.value.definition={typeName:'numeric',definition:{prompt:cml('Original numeric draft prompt'),solution:{value:'1/3',tolerance:'0.001'}}};
  if(snapshotMode.startsWith('shared-definition')){
    config.snapshotSharedDefinition=true;
    config.snapshotSharedDefinitionId=groups.get(config.snapshotFirstGroupId).value.questions[0];
    groups.get(config.snapshotSecondGroupId).value.questions=[config.snapshotSharedDefinitionId];
    if(snapshotMode==='shared-definition-error')config.snapshotDefinitionErrorId=config.snapshotSharedDefinitionId;
  }
  return config;
}
function makeMediaCourse(id,mode='media-success'){
  const config=makeCourse(id,mode),reading=[...atoms.values()].find(row=>row.courseId===id&&row.itemId==='item_0002');
  const mediaKinds=[['image.png','image/png',pngBytes],['reference.pdf','application/pdf',pdfBytes],
    ['lesson.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation',pptxBytes]];
  config.assetGets=new Map();config.mediaIds=[];
  for(let index=0;index<mediaKinds.length;index++){
    const [name,mime,body]=mediaKinds[index],assetId=key('asset'+configs.size+'_',index);
    config.mediaIds.push(assetId);
    const url=mediaOrigin+'/'+id+'/'+assetId+'/'+name+'?X-Amz-Signature='+secrets[3]+'&Expires=2000000000';
    assets.set(assetId,{courseId:id,name,mime,body,url,value:{id:assetId,name,typeName:index===0?'image':'file',url:{url},writeAccessToken:secrets[1]}});
  }
  const references=mode==='media-pointer-missing'?'<img src="https://unfetched.example.invalid/missing.png"/>':
    '<img assetId="'+config.mediaIds[0]+'"/><a assetId="'+config.mediaIds[1]+'">Original reference</a><asset id="'+config.mediaIds[2]+'" name="lesson.pptx"/>';
  reading.atom.draft.content.definition.content={typeName:'cml',definition:{dtdId:'supplement/1',
    value:'<co-content><p>Original media bodies must be retained, including café 日本語.</p>'+references+'</co-content>'}};
  return config;
}
function makeDiscussionMediaCourse(id,mode='media-success'){
  const config=makeMediaCourse(id,mode),row=[...atoms.values()].find(row=>row.courseId===id&&row.itemId==='item_0002');
  const markup=row.atom.draft.content.definition.content.definition.value;
  row.atom.draft.content={typeName:'discussionPromptDraft',definition:{promptType:{typeName:'questionPerSession',definition:{
    title:'Discussion with original media',promptPermissions:{viewAnswersBeforeReplying:false},
    prompt:{typeName:'cml',definition:{dtdId:'discussion/1',value:markup}}
  }}}};
  const leaf=config.material.material.elements[0].elements[0].elements.find(item=>item.id===row.itemId);
  leaf.content={typeName:'discussionPrompt',definition:{discussionPromptId:key('discussion_',configs.size)+'@1'}};
  return config;
}
function makeDwgMediaCourse(id){
  const config=makeMediaCourse(id),assetId=key('cad'+configs.size+'_',0),name='original-plan.dwg',mime='application/acad';
  // Synthetic format header checks original retention, not CAD interoperability.
  const body=Buffer.alloc(512);body.write('AC1032');body.write('Original opaque drawing fixture',128);
  const url=mediaOrigin+'/'+id+'/'+assetId+'/'+name+'?X-Amz-Signature='+secrets[3]+'&Expires=2000000000';
  config.mediaIds.push(assetId);
  assets.set(assetId,{courseId:id,name,mime,body,url,value:{id:assetId,name,filename:name,fileExtension:'dwg',typeName:'generic',url:{url}}});
  const row=[...atoms.values()].find(value=>value.courseId===id&&value.itemId==='item_0002');
  row.atom.draft.content.definition.content.definition.value=row.atom.draft.content.definition.content.definition.value.replace('</co-content>',
    '<asset id="'+assetId+'" name="'+name+'" extension="dwg" assetType="generic"/></co-content>');
  return config;
}
function makeLargeMediaCourse(id){
  const config=makeCourse(id,'large-export');config.mode='media-success';config.assetGets=new Map();config.mediaIds=[];
  let index=0;
  for(const reading of atoms.values()){
    if(reading.courseId!==id||Number(reading.itemId.slice(5))<2)continue;
    const assetId=key('large'+configs.size+'_',index),name='original-large-'+index+'.png';
    const padding=index+1;
    const url=mediaOrigin+'/'+id+'/'+assetId+'/'+name+'?X-Amz-Signature='+secrets[3]+'&Expires=2000000000';
    const asset={courseId:id,name,mime:'image/png',url,value:{id:assetId,name,typeName:'image',url:{url}}};
    Object.defineProperty(asset,'body',{get:()=>Buffer.concat([pngBytes,Buffer.alloc(12*1024*1024-pngBytes.length,padding)])});
    assets.set(assetId,asset);
    config.mediaIds.push(assetId);
    reading.atom.draft.content.definition.content={typeName:'cml',definition:{dtdId:'supplement/1',
      value:'<co-content><p>Retain the original image '+index+'.</p><asset id="'+assetId+'"/></co-content>'}};
    index++;
  }
  return config;
}
function makePanoptoCourse(id,mode){
  const config=makeMediaCourse(id),fixture=panoptoDeliveryFixture(),number=configs.size.toString(16).padStart(8,'0');
  config.panoptoMode=mode;
  config.panoptoDeliveryId=number+'-0000-4000-8000-000000000001';
  config.panoptoTarget=panoptoOrigin+'/Panopto/Pages/Embed.aspx?id='+config.panoptoDeliveryId+'&autoplay=false&captions=true';
  config.panoptoMediaUrl=panoptoMediaOrigin+'/'+id+'/podcast.mp4';
  config.panoptoModel=structuredClone(fixture.model);
  config.panoptoModel.Delivery.PublicID=config.panoptoDeliveryId;
  config.panoptoModel.EmbedUrl='<iframe src="'+config.panoptoTarget.replaceAll('&','&amp;')+'"></iframe>';
  const replaceMediaUrl=value=>typeof value==='string'?value.replace('https://media.example.test/sessions/'+fixture.ids.C+'/',panoptoMediaOrigin+'/'+id+'/'):value;
  for(const stream of config.panoptoModel.Delivery.Streams){
    stream.StreamUrl=replaceMediaUrl(stream.StreamUrl);stream.StreamHttpUrl=replaceMediaUrl(stream.StreamHttpUrl);
    for(const variant of stream.Variants||[])variant.Url=replaceMediaUrl(variant.Url);
  }
  config.panoptoModel.Delivery.PodcastStreams[0].StreamUrl=config.panoptoMediaUrl+'?X-Amz-Signature='+secrets[3]+'&Expires=2000000000';
  config.expectedPanoptoModel=structuredClone(config.panoptoModel);
  config.expectedPanoptoModel.Delivery.PodcastStreams[0].StreamUrl=config.panoptoMediaUrl;
  panoptoDeliveries.set(config.panoptoDeliveryId,config);
  for(let index=3;index<=5;index++){
    const itemId='item_'+String(index).padStart(4,'0'),atomId=key('pa'+configs.size+'_',index),providerId=key('pp'+configs.size+'_',index);
    const name='Repeated external widget title',target=index===4?'https://unknown.example.test/widget/'+id:config.panoptoTarget;
    const atom={id:atomId,contentId:'atom~'+atomId,status:{typeName:'draftAtomStatus',definition:{}},storedAtomVersion:1,
      metadata:{updatedAt:1000},draft:{name,content:{typeName:'widgetDraft',definition:{providerId,isGraded:false,iframeTitle:name}}}};
    const relation={id:atomId,atomId,branchRelationMap:{[id+'~'+itemId]:{courseId:id,itemId,courseSlug:slug}}};
    atoms.set(atomId,{courseId:id,itemId,atom,relation});
    config.material.material.elements[0].elements[0].elements.push({id:itemId,name,atomId,contentId:atom.contentId,
      content:{typeName:'ungradedWidget',definition:{widgetSessionProviderId:providerId+'@1'}}});
    providers.set(providerId,{courseId:id,itemId,value:{id:providerId,isPublished:false,metadata:{updatedAt:1000},
      draft:{configuration:{url:target},pageSrc:target,iframeTitle:name,widgetVersionId:'synthetic-widget@1'}}});
  }
  config.contentCount+=3;return config;
}
function makeInlineWidgetCourse(id,mode='inline-success',duplicatePlacement=false){
  const config=makeCourse(id,'complete'),row=[...atoms.values()].find(value=>value.courseId===id&&value.itemId==='item_0002');
  config.inlineMode=mode;config.providerGets=new Map();config.inlineProviderId=key('iw'+configs.size+'_',1)+'@1';
  const markup='<co-content><p>Exact reading, 2 + 3 = 5.</p><widget id="'+config.inlineProviderId+'"/><widget id="'+config.inlineProviderId+'"/></co-content>';
  row.atom.draft.content.definition.content={typeName:'cml',definition:{dtdId:'assess/1',value:markup}};
  providers.set(config.inlineProviderId,{courseId:id,itemId:row.itemId,value:{id:config.inlineProviderId.split('@')[0],
    isPublished:true,owners:['COURSE~'+id],metadata:{updatedAt:1000},draft:{configuration:{url:'https://unavailable.example.test/recorded-inline-page'},
      pageSrc:'https://unavailable.example.test/recorded-inline-page',iframeTitle:'Exact inline page',widgetVersionId:'synthetic-widget@1'}}});
  if(duplicatePlacement){
    const itemId='item_0003',atomId=key('ia'+configs.size+'_',3),atom=structuredClone(row.atom);
    atom.id=atomId;atom.contentId='atom~'+atomId;
    const relation={id:atomId,atomId,branchRelationMap:{[id+'~'+itemId]:{courseId:id,itemId,courseSlug:slug}}};
    atoms.set(atomId,{courseId:id,itemId,atom,relation});
    config.material.material.elements[0].elements[0].elements.push({id:itemId,name:'Second native placement',atomId,contentId:atom.contentId,
      content:{typeName:'supplement',definition:{assetId:key('inlineReading_',configs.size)+'@1',assetTypeName:'html'}}});
    config.contentCount++;
  }
  return config;
}
function makePublicInlineWidgetCourse(id,mode='public-success',duplicatePlacement=false){
  const config=makeInlineWidgetCourse(id,mode,duplicatePlacement),provider=providers.get(config.inlineProviderId);
  config.publicTarget='https://opentextbc.ca/mathfortrades2/chapter/'+id.toLowerCase().replaceAll('_','-')+'/#main';
  config.publicHtml='<!doctype html><html><body><main><h1>Authored Area fixture</h1><p>Exact café 日本語 content.</p><section hidden>Original hidden lesson text.</section></main></body></html>';
  provider.value.draft.configuration.url=config.publicTarget;provider.value.draft.pageSrc=config.publicTarget;
  publicPages.set(config.publicTarget.split('#')[0],config);return config;
}
function makePublisherCase(chapterId,mode){
  const chapter={id:chapterId,status:'publish',type:'chapter',link:publisherOrigin+'/'+publisherBook+'/chapter/area-'+chapterId+'/',
    title:{raw:'Original Area café 日本語',rendered:'<span>Rendered Area</span>'},
    content:{raw:'  [latex]a + b[/latex]\nOriginal raw source.  ',rendered:'<p>Distinct rendered café 日本語.</p><script>window.__CTI_PUBLISHER_EXECUTED=true</script>',protected:false}};
  const config={chapterId,mode,chapter,targetUrl:publisherOrigin+'/'+publisherBook+'/?p='+chapterId+'/#main',requests:0};
  if(mode==='wrong-id')chapter.id++;
  if(mode==='wrong-book')chapter.link=publisherOrigin+'/anotherbook/chapter/area/';
  if(mode==='protected')chapter.content.protected=true;
  if(mode==='draft')chapter.status='draft';
  if(mode==='body-limit')chapter.content.raw='x'.repeat(1048576);
  if(mode==='escaped-credential')chapter.content.raw='https://example.test/?access_token=synthetic-sensitive-value';
  if(mode.startsWith('part-')){
    chapter.type=mode==='part-wrong-type'?'chapter':'part';chapter.link=publisherOrigin+'/'+publisherBook+'/part/unit-'+chapterId+'/';
    chapter._links={self:[{href:publisherOrigin+'/'+publisherBook+'/wp-json/pressbooks/v2/parts/'+chapterId}]};
  }
  if(mode.startsWith('back-matter-')){
    chapter.type=mode==='back-matter-wrong-type'?'part':'back-matter';
    chapter.link=publisherOrigin+'/'+publisherBook+'/back-matter/original-'+chapterId+'/';
    chapter._links={self:[{href:publisherOrigin+'/'+publisherBook+'/wp-json/pressbooks/v2/back-matter/'+chapterId}]};
    if(mode==='back-matter-protected')chapter.content.protected=true;
  }
  config.rawJson='\ufeff'+JSON.stringify(chapter,null,2)+'\n';
  if(mode==='escaped-credential')config.rawJson=config.rawJson.replace('access_token','access_\\u0074oken');
  config.bytes=mode==='invalid-utf8'?Buffer.from([0xc3,0x28]):Buffer.from(config.rawJson);
  publisherCases.set(chapterId,config);return config;
}
const publisherFixtures=[
  'omit-wildcard','include-exact','include-wildcard','wrong-origin','missing-acac','no-cors',
  'wrong-id','wrong-book','invalid-utf8','http-403','redirect','protected','draft','wrong-mime','http-429',
  'body-limit','escaped-credential',
].map((mode,index)=>makePublisherCase(179+index,mode));
const publisherPartFixtures=['part-success','part-wrong-type','part-missing','include-404','http-401'].map((mode,index)=>makePublisherCase(1100+index,mode));
const publisherBackMatterFixtures=['back-matter-success','back-matter-wrong-type','back-matter-protected',
  'back-matter-part-401','back-matter-part-403'].map((mode,index)=>makePublisherCase(1600+index,mode));
const baseline=makeCourse('Direct_baseline_fixture_123','baseline',true);
const complete=makeCourse('Direct_complete_fixture_123','complete');
for(const row of definitions.values())if(row.courseId===complete.id){
  const native=row.value.definition.definition;
  native.prompt.definition.value='<co-content><p>Keep &lt;div&gt; &amp; literal</p><p>Second paragraph 日本語</p></co-content>';
  native.options[0].display.definition.value='<co-content><p>&lt;answer&gt;</p></co-content>';
  native.options[0].feedback.definition.value='<co-content><p>Feedback &lt;code&gt;</p><p>Second paragraph</p></co-content>';
}
const nativeUnvisitedRecheck=makeCourse('Direct_native_unvisited_recheck_123','complete');
const unvisitedMaterials=nativeUnvisitedRecheck.material.material.elements[0].elements[0].elements;
const unvisitedReading=[...atoms.values()].find(row=>row.courseId===nativeUnvisitedRecheck.id&&row.itemId==='item_0002');
const unvisitedConvertedReading=[...atoms.values()].find(row=>row.courseId===nativeUnvisitedRecheck.id&&row.itemId==='item_0001');
unvisitedConvertedReading.atom.draft.content=structuredClone(unvisitedReading.atom.draft.content);
unvisitedConvertedReading.atom.draft.content.definition.name='Draft item_0001';
unvisitedMaterials[1].content=structuredClone(unvisitedMaterials[2].content);
unvisitedMaterials.shift();nativeUnvisitedRecheck.contentCount=2;
const publishedDraftSnapshot=makePublishedDraftSnapshotCourse('Direct_published_draft_123');
const publishedDraftSourceChanged=makePublishedDraftSnapshotCourse('Direct_published_source_changed_123','source-changed');
const publishedDraftGroupChanged=makePublishedDraftSnapshotCourse('Direct_published_group_changed_123','group-changed');
const publishedDraftForgedPointer=makePublishedDraftSnapshotCourse('Direct_published_wrong_pointer_123','forged-pointer');
const publishedDraftSharedDefinition=makePublishedDraftSnapshotCourse('Direct_published_shared_definition_123','shared-definition');
const publishedDraftSharedError=makePublishedDraftSnapshotCourse('Direct_published_shared_error_123','shared-definition-error');
const interrupted=makeCourse('Direct_resume_fixture_123','resume');
const oldCutoff=makeCourse('Direct_old_cutoff_fixture_123','resume');
const budgetResume=makeCourse('Direct_budget_resume_123','budget-resume');
const pauseDefinitionLimit=4;
for(const config of [interrupted,oldCutoff,budgetResume])config.pauseFixture={released:false,reads:0,held:0};
const changed=makeCourse('Direct_changed_fixture_123','changed');
const changedMaterial=makeCourse('Direct_material_change_123','material-changed');
const changedGroup=makeCourse('Direct_group_change_123','group-changed');
const authentication=makeCourse('Direct_auth_fixture_123','authentication');
const limited=makeCourse('Direct_limit_fixture_123','limited');
const largeExport=makeCourse('Direct_large_export_123','large-export');
const mediaSuccess=makeMediaCourse('Direct_media_complete_123');
const dwgOriginals=makeDwgMediaCourse('Direct_dwg_originals_123');
const assessReadingMedia=makeMediaCourse('Direct_assess_reading_123');
const assessReading=[...atoms.values()].find(row=>row.courseId===assessReadingMedia.id&&row.itemId==='item_0002');
assessReading.atom.draft.content.definition.content.definition.dtdId='assess/1';
const inlineWidgetReading=makeInlineWidgetCourse('Direct_inline_widget_123','inline-success',true);
const inlineWidgetWrongOwner=makeInlineWidgetCourse('Direct_inline_owner_123','inline-wrong-owner');
const inlineWidgetChanged=makeInlineWidgetCourse('Direct_inline_changed_123','inline-source-changed');
const inlineWidgetPartial=makeInlineWidgetCourse('Direct_inline_partial_123','inline-partial');
const inlineWidgetDiscussion=makeInlineWidgetCourse('Direct_inline_discussion_123');
const publicInlineWidget=makePublicInlineWidgetCourse('Direct_inline_public_123','public-success',true);
const publicInlineHtmlError=makePublicInlineWidgetCourse('Direct_inline_html_error_123','public-html-error');
const publicInlineChanged=makePublicInlineWidgetCourse('Direct_inline_public_changed_123','inline-source-changed');
const publisherReaderCourse=makeCourse('Direct_publisher_browser_123','complete');
publisherReaderCourse.directReaderCase=true;publisherReaderCourse.publisherReaderCase=true;
const publisherInlineCase=makePublisherCase(999,'omit-wildcard');
const publisherInlineCourse=makeInlineWidgetCourse('Direct_inline_publisher_123','publisher-success',true);
publisherInlineCourse.publisherReaderCase=true;
providers.get(publisherInlineCourse.inlineProviderId).value.draft.configuration.url=publisherInlineCase.targetUrl;
providers.get(publisherInlineCourse.inlineProviderId).value.draft.pageSrc=publisherInlineCase.targetUrl;
publisherInlineCourse.assetGets=new Map();publisherInlineCourse.mediaIds=[key('publisher_media_',1)];
const publisherOriginalId=publisherInlineCourse.mediaIds[0],publisherOriginalName='retained-original.png';
const publisherOriginalUrl=mediaOrigin+'/'+publisherInlineCourse.id+'/'+publisherOriginalId+'/'+publisherOriginalName+
  '?X-Amz-Signature='+secrets[3]+'&Expires=2000000000';
assets.set(publisherOriginalId,{courseId:publisherInlineCourse.id,name:publisherOriginalName,mime:'image/png',body:pngBytes,
  url:publisherOriginalUrl,value:{id:publisherOriginalId,name:publisherOriginalName,typeName:'image',url:{url:publisherOriginalUrl}}});
for(const row of atoms.values())if(row.courseId===publisherInlineCourse.id&&row.atom.draft.content.typeName==='supplementDraft')
  row.atom.draft.content.definition.content.definition.value=row.atom.draft.content.definition.content.definition.value.replace('</co-content>',
    '<img assetId="'+publisherOriginalId+'"/></co-content>');
const publisherPartCase=makePublisherCase(1199,'part-success');
const publisherPartCourse=makeInlineWidgetCourse('Direct_inline_publisher_part_123','publisher-part',true);
publisherPartCourse.publisherReaderCase=true;
providers.get(publisherPartCourse.inlineProviderId).value.draft.configuration.url=publisherPartCase.targetUrl;
providers.get(publisherPartCourse.inlineProviderId).value.draft.pageSrc=publisherPartCase.targetUrl;
const publisherImageCase=makePublisherCase(1299,'omit-wildcard');
const publisherImageBase=publisherOrigin+'/'+publisherBook+'/wp-content/uploads/2026/10/';
for(const [name,mode,body] of [['main.png','allowed',pngBytes],['no-cors.png','no-cors',pngBytes],
  ['redirect.png','redirect',pngBytes],['wrong-mime.png','wrong-mime',pngBytes],['bad-magic.png','bad-magic',pdfBytes]])
  publisherImages.set(publisherImageBase+name,{name,mode,body,requests:0});
const ignoredPublisherSrcset=Array.from({length:64},(_,i)=>publisherImageBase+'never-srcset-'+i+'.png '+(i+1)+'w').join(', ');
publisherImageCase.chapter.content.raw='<p>Literal original image source.</p><img src="'+publisherImageBase+'main.png" srcset="'+ignoredPublisherSrcset+'">'+
  '<a href="'+publisherImageBase+'main.png">Original drawing</a>'+['no-cors','redirect','wrong-mime','bad-magic'].map(name=>'<img src="'+publisherImageBase+name+'.png">').join('')+
  '<iframe src="https://example.test/never-read"></iframe><iframe src="https://cdnapisec.kaltura.com/p/never-read"></iframe>'+
  '<script>window.__CTI_PUBLISHER_IMAGE_EXECUTED=true;const ignored="<img src=\"'+publisherImageBase+'never-script.png\">";</script>';
publisherImageCase.chapter.content.rendered='<p>Rendered source stays separate.</p><img src="'+publisherImageBase+'main.png">';
publisherImageCase.rawJson='\ufeff'+JSON.stringify(publisherImageCase.chapter,null,2)+'\n';
publisherImageCase.bytes=Buffer.from(publisherImageCase.rawJson);
const publisherImageCourse=makeInlineWidgetCourse('Direct_inline_publisher_image_123','publisher-image',true);
publisherImageCourse.publisherReaderCase=true;publisherImageCourse.helperMode='legacy-image-unsupported';
providers.get(publisherImageCourse.inlineProviderId).value.draft.configuration.url=publisherImageCase.targetUrl;
providers.get(publisherImageCourse.inlineProviderId).value.draft.pageSrc=publisherImageCase.targetUrl;
// A valid PNG with a large ancillary text chunk exercises several real bridge
// pulls and EOF while retaining exact original bytes, without claiming playback.
function fixturePngTextChunk(text){
  const data=Buffer.from('Comment\0'+text),type=Buffer.from('tEXt'),content=Buffer.concat([type,data]);let crc=0xffffffff;
  for(const value of content){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length,0);type.copy(chunk,4);data.copy(chunk,8);chunk.writeUInt32BE((crc^0xffffffff)>>>0,data.length+8);return chunk;
}
const publisherServiceBytes=Buffer.concat([pngBytes.subarray(0,-12),fixturePngTextChunk('Synthetic original image context. '+ 'x'.repeat(160*1024+17)),pngBytes.subarray(-12)]);
const publisherPipelineCase=makePublisherCase(1349,'omit-wildcard');
const publisherPipeline={active:0,maximum:0,started:[],completed:[],responses:new Map(),pairTimers:new Map(),timedOut:[]};
const publisherPipelineUrls=Array.from({length:4},(_,index)=>publisherImageBase+'pipeline-original-'+index+'.png');
for(const [index,url]of publisherPipelineUrls.entries()){
  const body=Buffer.concat([pngBytes.subarray(0,-12),fixturePngTextChunk('Literal pipeline original '+index+' '+ 'x'.repeat(index*101)),pngBytes.subarray(-12)]);
  publisherImages.set(url,{name:url.split('/').at(-1),mode:'allowed',body,requests:0,pipeline:publisherPipeline,pipelineIndex:index});
}
publisherPipelineCase.chapter.content.raw='<p>Literal source order differs from response completion order.</p>'+
  publisherPipelineUrls.map(url=>'<img src="'+url+'">').join('');
publisherPipelineCase.chapter.content.rendered='<p>Distinct original rendered field.</p>'+
  publisherPipelineUrls.map(url=>'<a href="'+url+'">Original image</a>').join('');
publisherPipelineCase.rawJson='\ufeff'+JSON.stringify(publisherPipelineCase.chapter,null,2)+'\n';
publisherPipelineCase.bytes=Buffer.from(publisherPipelineCase.rawJson);
const publisherPipelineCourse=makeInlineWidgetCourse('Direct_inline_image_pipeline_123','publisher-image-pipeline',true);
publisherPipelineCourse.publisherReaderCase=true;
providers.get(publisherPipelineCourse.inlineProviderId).value.draft.configuration.url=publisherPipelineCase.targetUrl;
providers.get(publisherPipelineCourse.inlineProviderId).value.draft.pageSrc=publisherPipelineCase.targetUrl;
const publisherServiceCase=makePublisherCase(1399,'omit-wildcard'),publisherServiceImageUrl=publisherImageBase+'service-original.png';
publisherServiceCase.chapter.content.raw='<p>Literal service-backed original.</p><img src="'+publisherServiceImageUrl+'">';
publisherServiceCase.chapter.content.rendered='<p>Rendered field stays literal.</p><a href="'+publisherServiceImageUrl+'">Original raster</a>';
publisherServiceCase.rawJson='\ufeff'+JSON.stringify(publisherServiceCase.chapter,null,2)+'\n';publisherServiceCase.bytes=Buffer.from(publisherServiceCase.rawJson);
const publisherServiceCourse=makeInlineWidgetCourse('Direct_inline_public_image_service_123','publisher-service-image',true);
publisherServiceCourse.publisherReaderCase=true;publisherServiceCourse.publisherServiceMode='ready';
providers.get(publisherServiceCourse.inlineProviderId).value.draft.configuration.url=publisherServiceCase.targetUrl;
providers.get(publisherServiceCourse.inlineProviderId).value.draft.pageSrc=publisherServiceCase.targetUrl;
publisherImages.set(publisherServiceImageUrl,{name:'service-original.png',mode:'no-cors',body:publisherServiceBytes,requests:0});
publisherServiceImages.set(publisherServiceImageUrl,publisherServiceCourse);
const publisherChallengeCase=makePublisherCase(1499,'omit-wildcard');
const publisherChallengeUrls=['challenge-first.png','challenge-second.png'].map(name=>publisherImageBase+name);
publisherChallengeCase.chapter.content.raw='<p>Both literal originals remain unresolved after an observed publisher challenge.</p>'+
  publisherChallengeUrls.map(url=>'<img src="'+url+'">').join('');
publisherChallengeCase.chapter.content.rendered='<p>Distinct rendered field.</p>'+
  publisherChallengeUrls.map(url=>'<img src="'+url+'">').join('');
publisherChallengeCase.rawJson='\ufeff'+JSON.stringify(publisherChallengeCase.chapter,null,2)+'\n';
publisherChallengeCase.bytes=Buffer.from(publisherChallengeCase.rawJson);
const publisherChallengeCourse=makeInlineWidgetCourse('Direct_inline_image_challenge_123','publisher-image-challenge',true);
publisherChallengeCourse.publisherReaderCase=true;publisherChallengeCourse.publisherServiceMode='upstream-challenge';
publisherChallengeCourse.publisherImageCase=publisherChallengeCase;
providers.get(publisherChallengeCourse.inlineProviderId).value.draft.configuration.url=publisherChallengeCase.targetUrl;
providers.get(publisherChallengeCourse.inlineProviderId).value.draft.pageSrc=publisherChallengeCase.targetUrl;
for(const [index,url]of publisherChallengeUrls.entries()){
  const body=index===0?pngBytes:Buffer.concat([pngBytes.subarray(0,-12),fixturePngTextChunk('Second literal original.'),pngBytes.subarray(-12)]);
  publisherImages.set(url,{name:url.split('/').at(-1),mode:'no-cors',body,requests:0});
  publisherServiceImages.set(url,publisherChallengeCourse);
}
function makeFirstPartyPublisherCourse(id,chapterId,suffix){
  const publisherCase=makePublisherCase(chapterId,'omit-wildcard'),urls=['first','second'].map(name=>publisherImageBase+suffix+'-'+name+'.png');
  publisherCase.chapter.content.raw='<p>Faithful originals require an explicit publisher-tab recovery.</p>'+urls.map(url=>'<img src="'+url+'">').join('');
  publisherCase.chapter.content.rendered='<p>Distinct rendered original.</p>'+urls.map(url=>'<a href="'+url+'">Original raster</a>').join('');
  publisherCase.rawJson='\ufeff'+JSON.stringify(publisherCase.chapter,null,2)+'\n';publisherCase.bytes=Buffer.from(publisherCase.rawJson);
  const config=makeInlineWidgetCourse(id,'publisher-first-party',true);
  config.publisherReaderCase=true;config.publisherServiceMode='upstream-challenge';config.publisherImageCase=publisherCase;
  providers.get(config.inlineProviderId).value.draft.configuration.url=publisherCase.targetUrl;
  providers.get(config.inlineProviderId).value.draft.pageSrc=publisherCase.targetUrl;
  for(const [index,url]of urls.entries()){
    const body=index===0?pngBytes:Buffer.concat([pngBytes.subarray(0,-12),fixturePngTextChunk(suffix+' second literal original.'),pngBytes.subarray(-12)]);
    publisherImages.set(url,{name:url.split('/').at(-1),mode:'no-cors',body,requests:0,firstPartyCourse:config});publisherServiceImages.set(url,config);
  }
  firstPartyPublisherPages.set(String(chapterId),config);return{config,publisherCase,urls};
}
const firstPartyPublisher=makeFirstPartyPublisherCourse('Direct_first_party_recovery_123',1699,'first-party');
const firstPartyPublisherCoop=makeFirstPartyPublisherCourse('Direct_first_party_coop_123',1799,'first-party-coop');
firstPartyPublisherCoop.config.firstPartyCoop=true;
const firstPartyPublisherChanged=makeFirstPartyPublisherCourse('Direct_first_party_changed_123',1899,'first-party-changed');
const publisherBackMatterCase=makePublisherCase(1599,'back-matter-success');
const publisherBackMatterImageUrl=publisherImageBase+'back-matter-original.png';
publisherBackMatterCase.chapter.content.raw='<p>Original authored back matter café 日本語.</p><img src="'+publisherBackMatterImageUrl+'">';
publisherBackMatterCase.chapter.content.rendered='<p>Distinct rendered back matter.</p><a href="'+publisherBackMatterImageUrl+'">Original image</a>';
publisherBackMatterCase.rawJson='\ufeff'+JSON.stringify(publisherBackMatterCase.chapter,null,2)+'\n';
publisherBackMatterCase.bytes=Buffer.from(publisherBackMatterCase.rawJson);
publisherImages.set(publisherBackMatterImageUrl,{name:'back-matter-original.png',mode:'allowed',body:pngBytes,requests:0});
const publisherBackMatterCourse=makeInlineWidgetCourse('Direct_inline_back_matter_123','publisher-back-matter',true);
publisherBackMatterCourse.publisherReaderCase=true;
providers.get(publisherBackMatterCourse.inlineProviderId).value.draft.configuration.url=publisherBackMatterCase.targetUrl;
providers.get(publisherBackMatterCourse.inlineProviderId).value.draft.pageSrc=publisherBackMatterCase.targetUrl;
const publisherFlagLeaf=publisherInlineCourse.material.material.elements[0].elements[0].elements[0];
publisherFlagLeaf.content.typeName='ungradedAssignment';
publisherFlagLeaf.content.definition.assignmentFeatures=['LIMITED_SUBMISSIONS','TAKE_LATEST_GRADE','SHOW_GRADE_ON_RELEASE'];
const inlineDiscussionRow=[...atoms.values()].find(row=>row.courseId===inlineWidgetDiscussion.id&&row.itemId==='item_0002');
const inlineDiscussionCml=inlineDiscussionRow.atom.draft.content.definition.content;
inlineDiscussionRow.atom.draft.content={typeName:'discussionPromptDraft',definition:{promptType:{typeName:'questionPerSession',definition:{
  title:'Exact discussion with an embedded page',promptPermissions:{viewAnswersBeforeReplying:false},
  prompt:{...inlineDiscussionCml,definition:{...inlineDiscussionCml.definition,dtdId:'discussion/1'}}}}}};
inlineWidgetDiscussion.material.material.elements[0].elements[0].elements[2].content={typeName:'discussionPrompt',definition:{discussionPromptId:key('inlineDiscussion_',1)+'@1'}};
const failedInlineProviderId=key('missing_inline_',1)+'@2';
providers.set(failedInlineProviderId,{courseId:inlineWidgetPartial.id,itemId:'item_0002',fail:true,value:{id:failedInlineProviderId.split('@')[0]}});
const partialInlineRow=[...atoms.values()].find(row=>row.courseId===inlineWidgetPartial.id&&row.itemId==='item_0002');
partialInlineRow.atom.draft.content.definition.content.definition.value=partialInlineRow.atom.draft.content.definition.content.definition.value.replace('</co-content>',
  '<widget id="'+failedInlineProviderId+'"/></co-content>');
const mediaEnrichment=makeMediaCourse('Direct_media_enrichment_123','media-legacy-gap');
const mediaCheckpoint=makeDiscussionMediaCourse('Direct_media_checkpoint_123','media-legacy-gap');
const discussionMedia=makeDiscussionMediaCourse('Direct_discussion_media_123');
const mediaLegacyV12=makeMediaCourse('Direct_media_v12_archive_123');
const largeMedia=makeLargeMediaCourse('Direct_media_beyond64_123');
const mediaFailures=['media-pointer-missing','media-metadata-404','media-metadata-auth','media-body-403','media-body-cors',
  'media-body-redirect','media-body-html','media-metadata-changed','media-body-limit'].map((mode,index)=>makeMediaCourse('Direct_media_gap_'+index+'_123',mode));
const sixWidgets=makeCourse('Direct_widgets_six_123','large-export');
for(const row of atoms.values())if(row.courseId===sixWidgets.id&&Number(row.itemId.slice(5))>=2){
  row.atom.draft.content={typeName:'ungradedWidgetDraft',definition:{widgetId:'fixture-external-widget',opaque:{externalBody:'not-fetched'}}};
  const leaf=sixWidgets.material.material.elements[0].elements[0].elements.find(item=>item.id===row.itemId);
  leaf.content={typeName:'ungradedWidget',definition:{widgetId:'fixture-external-widget'}};
}
const configuredWidgets=makeCourse('Direct_widget_sources_123','large-export');
for(const row of atoms.values())if(row.courseId===configuredWidgets.id&&['item_0002','item_0003'].includes(row.itemId)){
  const providerId=key('provider_',Number(row.itemId.slice(5)));
  row.atom.draft.name='Same widget title';
  row.atom.draft.content={typeName:'widgetDraft',definition:{providerId,isGraded:false,iframeTitle:'Same widget title'}};
  const leaf=configuredWidgets.material.material.elements[0].elements[0].elements.find(item=>item.id===row.itemId);
  leaf.name='Same widget title';leaf.content={typeName:'widget',definition:{widgetSessionProviderId:providerId+'@1'}};
  const url='https://video.example.test/embed?id='+row.itemId+'&autoplay=false&captions=true&interactivity=all';
  providers.set(providerId,{courseId:row.courseId,itemId:row.itemId,value:{id:providerId,isPublished:false,metadata:{updatedAt:1000},
    draft:{configuration:{url,opaqueSetting:'Exact source '+row.itemId},pageSrc:url,iframeTitle:'Same widget title',widgetVersionId:'synthetic-widget@1'},
    writeAccessToken:secrets[1]}});
}
const panoptoComplete=makePanoptoCourse('Direct_panopto_mixed_123','allowed');
const panoptoMetadataCors=makePanoptoCourse('Direct_panopto_metadata_cors_123','metadata-cors');
const panoptoBodyCors=makePanoptoCourse('Direct_panopto_body_cors_123','body-cors');
const helperFailure=makePanoptoCourse('Direct_panopto_helper_failure_123','allowed');
const helperForeign=makePanoptoCourse('Direct_panopto_helper_foreign_123','metadata-csp');
const helperShort=makePanoptoCourse('Direct_panopto_helper_short_123','metadata-csp');
helperShort.helperCleanShortEof=true;
const runningPartial=makeMediaCourse('Direct_running_partial_123');
const partialMaterials=runningPartial.material.material.elements[0].elements[0].elements;
partialMaterials.unshift(partialMaterials.pop());
function helperMode(request){return /(?:^|;\s*)ctiFixtureMode=([a-z-]+)/.exec(request.headers.get('cookie')||'')?.[1]||'ready';}
async function waitForHelperFixture(config,signal){
  if(!config.helperHold||config.helperReleased)return;
  config.helperHeld=(config.helperHeld||0)+1;
  await new Promise((resolve,reject)=>{
    const release=()=>{signal?.removeEventListener('abort',aborted);resolve();};
    const aborted=()=>{config.helperAborted=(config.helperAborted||0)+1;reject(Error('Synthetic upstream request stopped'));};
    (config.helperWaiters||=[]).push(release);
    if(signal?.aborted)aborted();else signal?.addEventListener('abort',aborted,{once:true});
  });
}
function releaseHelperFixture(config){config.helperReleased=true;for(const release of config.helperWaiters||[])release();config.helperWaiters=[];}
async function fixtureProviderFetch(address,init){
  const url=new URL(address),headers=new Headers(init.headers);
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');
  assert.equal(headers.get('cookie'),null);assert.equal(headers.get('authorization'),null);
  if(url.origin==='https://opentextbc.ca'){
    if(publisherServiceImages.has(url.href)){
      const config=publisherServiceImages.get(url.href),image=publisherImages.get(url.href);
      assert.equal(init.method,'GET');assert.equal(headers.get('accept'),'image/png, image/jpeg, image/gif, image/webp');assert.equal(headers.get('accept-encoding'),'identity');
      assert.equal(headers.get('origin'),null);assert.equal(headers.get('referer'),null);
      helperUpstreamRequests.push({courseId:config.id,role:'PUBLISHER_IMAGE',url:url.href});
      if(config.publisherServiceMode==='upstream-denied')return new Response('synthetic public failure',{status:403,headers:{'Content-Type':'text/plain'}});
      if(config.publisherServiceMode==='upstream-challenge')return new Response('Synthetic challenge, not an image.',
        {status:403,headers:{'Content-Type':'text/html','cf-mitigated':'challenge'}});
      const pieces=[image.body.subarray(0,70001),image.body.subarray(70001)];
      return new Response(new ReadableStream({pull(controller){if(pieces.length)controller.enqueue(pieces.shift());else controller.close();}}),
        {headers:{'Content-Type':config.publisherServiceMode==='wrong-upstream-mime'?'text/html':'image/png','Content-Length':String(image.body.length)}});
    }
    assert.equal(init.method,'GET');const config=publicPages.get(url.href);assert(config);
    publicPageRequests.push({courseId:config.id,url:url.href,method:init.method});
    return new Response(config.inlineMode==='public-html-error'?'<html><body><input type="password"></body></html>':config.publicHtml,
      {headers:{'Content-Type':'text/html; charset=utf-8'}});
  }
  if(url.origin===panoptoOrigin){
    assert.equal(url.pathname,'/Panopto/Pages/Viewer/DeliveryInfo.aspx');assert.equal(init.method,'POST');
    const form=new URLSearchParams(init.body),config=panoptoDeliveries.get(form.get('deliveryId'));
    assert(config);assert.equal(Buffer.byteLength(init.body),193);
    assert.deepEqual([...form],[['deliveryId',config.panoptoDeliveryId],['isLiveNotes','false'],['refreshAuthCookie','false'],
      ['isActiveBroadcast','false'],['isEditing','false'],['isKollectiveAgentInstalled','false'],['isEmbed','true'],['responseType','json']]);
    helperUpstreamRequests.push({courseId:config.id,role:'METADATA'});
    await waitForHelperFixture(config,init.signal);
    return new Response(config.panoptoMode==='metadata-auth'?'{"error":"Synthetic provider sign-in required"}':JSON.stringify(config.panoptoModel),
      {status:config.panoptoMode==='metadata-auth'?401:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
  }
  assert.equal(url.origin,panoptoMediaOrigin);
  const config=configs.get(url.pathname.split('/')[1]);assert(config);
  assert.equal(url.pathname,'/'+config.id+'/podcast.mp4');assert.equal(init.method,'GET');
  assert.equal(url.searchParams.get('X-Amz-Signature'),secrets[3]);
  helperUpstreamRequests.push({courseId:config.id,role:'PODCAST'});
  const chunks=[mp4Bytes.subarray(0,70001),mp4Bytes.subarray(70001)];
  return new Response(new ReadableStream({pull(controller){if(chunks.length)controller.enqueue(chunks.shift());else controller.close();}}),
    {headers:{'Content-Type':'video/mp4','Content-Length':String(mp4Bytes.length)}});
}
const helperApi=createApiHandler(async request=>{
  const mode=helperMode(request),url=new URL(request.url);
  if(mode==='service-auth'&&url.pathname.startsWith('/api/provider/'))throw Object.assign(Error('Synthetic CTI authentication required'),{status:401});
  return {email:mode==='access-denied'?'fixture-observer@example.test':CTI_OWNER_EMAIL};
},fixtureProviderFetch);
const helperEnvironment={CTI_ADMINS:CTI_OWNER_EMAIL,CTI_DB:{prepare(){throw Error('Provider fixture must not read or write the workspace database');}},
  CTI_EXTRACTOR:{fetch:request=>handleAuthorized(workspaceRuntimeApiRequest(request),helperEnvironment.CTI_DB,
    workspaceRuntimeCaller(request),undefined,fixtureProviderFetch)}};
async function writeHelperResponse(response,result){
  if(response.destroyed){await result.body?.cancel().catch(()=>{});return;}
  response.writeHead(result.status,Object.fromEntries(result.headers));
  const reader=result.body?.getReader();
  if(reader)try{
    while(!response.destroyed){const next=await reader.read();if(next.done)break;
      if(!response.write(Buffer.from(next.value)))await new Promise(resolve=>{response.once('drain',resolve);response.once('close',resolve);});}
  }finally{if(response.destroyed)await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!response.destroyed)response.end();
}
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
  const url=new URL(request.url,origin);
  const host=request.headers.host?.split(':')[0];
  if(host===new URL(helperOrigin).hostname){
    if(url.pathname.startsWith('/api/')){
      let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;});
      request.on('end',()=>{void(async()=>{
        const controller=new AbortController();response.on('close',()=>{if(!response.writableEnded)controller.abort();});
        const headers=new Headers();for(const [key,value]of Object.entries(request.headers))if(typeof value==='string')headers.set(key,value);
        const input=new Request(helperOrigin+url.pathname,{method:request.method,headers,
          ...(body?{body}:{}),signal:controller.signal});
        let providerConfig;
        if(url.pathname.startsWith('/api/provider/')){
          const payload=JSON.parse(body),target=new URL(payload.targetUrl),identity=target.searchParams.get('id'),
            config=url.pathname==='/api/provider/publisher-image'?publisherServiceImages.get(payload.imageUrl):url.pathname==='/api/provider/public-html'?publicPages.get(target.href.split('#')[0]):panoptoDeliveries.get(identity);
          assert(config);helperRequests.push({courseId:config.id,kind:url.pathname.split('/').at(-1),mode:helperMode(input)});
          providerConfig=config;
        }
        let result=await helperApi(input,helperEnvironment);
        if(providerConfig&&url.pathname==='/api/provider/publisher-image'){
          const payload=JSON.parse(body);assert.deepEqual(Object.keys(payload).sort(),['imageUrl','sourceSha256','targetUrl']);
          const sourceCase=providerConfig.publisherImageCase||publisherServiceCase;
          assert.equal(payload.targetUrl,sourceCase.targetUrl);assert.equal(publisherServiceImages.get(payload.imageUrl),providerConfig);
          assert.equal(payload.sourceSha256,createHash('sha256').update(sourceCase.bytes).digest('hex'));
          assert(request.headers.cookie?.includes('ctiFixtureSession='+secrets[4]),'The helper API request is authenticated on its own origin');
          assert.equal(request.headers.origin,helperOrigin);assert.equal(request.headers['sec-fetch-site'],'same-origin');
          assert.equal(request.headers['content-type'],'application/json');
          if(result.status===200&&providerConfig.publisherServiceMode!=='ready'){
            const originalBytes=new Uint8Array(await result.arrayBuffer()),changed=new Headers(result.headers),mode=providerConfig.publisherServiceMode;
            let output=originalBytes;
            if(mode==='source-hash-tamper')changed.set('X-CTI-Publisher-Source-Hash','0'.repeat(64));
            if(mode==='mime-header-tamper')changed.set('Content-Type','text/html');
            if(mode==='missing-sha-header')changed.delete('X-CTI-Upstream-Sha256');
            if(mode==='sha-header-tamper')changed.set('X-CTI-Upstream-Sha256','0'.repeat(64));
            if(mode==='length-tamper'){changed.set('X-CTI-Upstream-Content-Length',String(originalBytes.length+1));changed.set('X-CTI-Upstream-Bytes',String(originalBytes.length+1));changed.delete('Content-Length');changed.delete('Content-Encoding');}
            if(mode==='clean-short-eof'){output=originalBytes.subarray(0,originalBytes.length-1);changed.delete('Content-Length');changed.delete('Content-Encoding');}
            if(mode==='body-sha-tamper'){output=originalBytes.slice();output[output.length-1]^=1;}
            result=new Response(output,{status:200,headers:changed});
          }
        }
        if(providerConfig?.helperCleanShortEof&&url.pathname.endsWith('/podcast')&&result.status===200){
          // Simulate an intermediary converting a streamed failure into a clean
          // EOF after a valid MP4 prefix. The original full byte declaration
          // must still cross the actual popup channel and prevent acceptance.
          const reader=result.body.getReader(),first=await reader.read();
          await reader.cancel();reader.releaseLock();
          result=new Response(first.value.subarray(0,12),{headers:result.headers});
        }
        await writeHelperResponse(response,result);
      })().catch(error=>{if(!response.destroyed){helperErrors.push(error.message);response.statusCode=500;response.end('Synthetic helper route failed');}});});return;
    }
    if(url.pathname==='/provider-helper.html'&&/(?:^|;\s*)ctiFixtureMode=legacy-image-unsupported(?:;|$)/.test(request.headers.cookie||'')){
      assert(request.headers.cookie?.includes('ctiFixtureSession='+secrets[4]));
      response.setHeader('Content-Type','text/html');response.setHeader('Cache-Control','no-store');
      response.end('<!doctype html><title>Synthetic legacy CTI helper</title><script>const p=new URLSearchParams(location.hash.slice(1)),nonce=p.get("nonce"),courseId=p.get("courseId");let authorized=false;fetch("/api/access",{credentials:"same-origin"}).then(async r=>{authorized=r.ok&&(await r.json()).fullCti===true});addEventListener("message",e=>{const m=e.data;if(e.origin!=="'+origin+'"||e.source!==opener||m?.protocol!=="CTI_PROVIDER_HELPER_V1"||m.nonce!==nonce||m.courseId!==courseId)return;if(m.type==="init"&&authorized)opener.postMessage({protocol:m.protocol,nonce,courseId,type:"ready"},e.origin);if(m.type==="request")opener.postMessage({protocol:m.protocol,nonce,courseId,type:"error",id:m.id,itemId:m.itemId,providerId:m.providerId,code:"PROVIDER_HELPER_OPERATION_UNSUPPORTED"},e.origin);});</script>');return;
    }
    if(url.pathname==='/foreign-window.html'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Unrelated fixture window</title>');return;}
    const file=path.resolve('dist','.'+url.pathname);
    assert(file.startsWith(path.resolve('dist')+path.sep));
    try{
      const mode=/(?:^|;\s*)ctiFixtureMode=([a-z-]+)/.exec(request.headers.cookie||'')?.[1];
      if(mode==='coop')response.setHeader('Cross-Origin-Opener-Policy','same-origin');
      response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'");
      response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
      response.end(fs.readFileSync(file));
    }catch(error){helperErrors.push(error.message);response.statusCode=404;response.end();}return;
  }
  if(host===new URL(publisherOrigin).hostname){
    if(url.pathname==='/favicon.ico'){response.statusCode=204;response.end();return;}
    if(url.pathname==='/'+publisherBook+'/'&&url.searchParams.has('p')){
      const config=firstPartyPublisherPages.get(url.searchParams.get('p').replace(/\/$/,''));
      assert(config,'Only an exact configured publisher page may be opened for recovery');assert.equal(request.method,'GET');
      assert.equal(request.headers['sec-fetch-mode'],'navigate');assert.equal(request.headers.authorization,undefined);
      assert(!String(request.headers.cookie||'').includes(secrets[0]),'A Coursera session never crosses into the publisher tab');
      if(config.firstPartyCoop)response.setHeader('Cross-Origin-Opener-Policy','same-origin');
      response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Cache-Control','no-store');
      response.setHeader('Set-Cookie','syntheticFirstPartyPublisher=publisher-local-only; HttpOnly; Secure; SameSite=Lax; Path=/');
      response.end('<!doctype html><title>Publisher recovery fixture</title><h1>Normal publisher page</h1><p>Run the same CTI course capture bookmark here.</p>');return;
    }
    if(url.pathname==='/'+publisherBook+'/opaque-fixture.png'&&!url.search){
      assert.equal(request.method,'GET');assert.equal(request.headers['sec-fetch-mode'],'no-cors');
      assert.equal(request.headers.cookie,undefined);assert.equal(request.headers.authorization,undefined);
      assert.equal(request.headers.referer,undefined);
      // A known image isolates the generic opaque response boundary. It is
      // separate from publisher JSON and never supplies extraction evidence.
      publisherOpaqueRequests.push({method:request.method,fetchMode:request.headers['sec-fetch-mode']});
      response.statusCode=200;assert.equal(response.hasHeader('Location'),false);
      response.setHeader('Content-Type','image/png');response.setHeader('Content-Length',String(pngBytes.length));
      response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','no-store');
      response.end(pngBytes);return;
    }
    if(publisherImages.has(publisherOrigin+url.pathname)){
      const image=publisherImages.get(publisherOrigin+url.pathname);assert.equal(url.search,'');
      if(request.headers['sec-fetch-mode']==='same-origin'){
        assert(image.firstPartyCourse,'Only the exact publisher recovery originals accept first-party reads');assert.equal(request.method,'GET');
        assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.origin,undefined);
        assert(String(request.headers.cookie||'').includes('syntheticFirstPartyPublisher=publisher-local-only'));
        assert(!String(request.headers.cookie||'').includes(secrets[0]),'Browser-owned publisher cookies stay separate from Coursera');
        firstPartyPublisherRequests.push({courseId:image.firstPartyCourse.id,url:publisherOrigin+url.pathname,method:request.method,
          fetchMode:request.headers['sec-fetch-mode'],publisherCookiePresent:true,courseraCookiePresent:false,authorizationPresent:false});
        response.setHeader('Content-Type','image/png');response.setHeader('Content-Length',String(image.body.length));response.setHeader('Cache-Control','no-store');
        response.end(image.body);return;
      }
      assert.equal(request.method,'GET');assert.equal(request.headers['sec-fetch-mode'],'cors');assert.equal(request.headers.origin,origin);
      assert.equal(request.headers.cookie,undefined);assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.referer,undefined);
      publisherImageRequests.push({url:publisherOrigin+url.pathname,mode:image.mode,method:request.method});image.requests++;
      response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
      if(image.mode!=='no-cors')response.setHeader('Access-Control-Allow-Origin','*');
      response.setHeader('Content-Type',image.mode==='wrong-mime'?'text/html':'image/png');
      if(image.mode==='redirect'){response.statusCode=302;response.setHeader('Location',publisherImageBase+'never-follow.png');response.end();return;}
      response.setHeader('Content-Length',String(image.body.length));
      if(image.pipeline){
        const pipeline=image.pipeline,index=image.pipelineIndex,pair=index-index%2;
        pipeline.started.push(publisherOrigin+url.pathname);pipeline.active++;
        pipeline.maximum=Math.max(pipeline.maximum,pipeline.active);
        let finished=false;
        const complete=()=>{if(!finished){finished=true;pipeline.active--;pipeline.completed.push(publisherOrigin+url.pathname);}};
        response.once('finish',complete);response.once('close',complete);
        pipeline.responses.set(index,{response,body:image.body});
        const earlier=pipeline.responses.get(pair),later=pipeline.responses.get(pair+1);
        if(earlier&&later){
          clearTimeout(pipeline.pairTimers.get(pair));pipeline.pairTimers.delete(pair);
          // Both real browser CORS reads must overlap. The later literal
          // source completes first, independent of request arrival order.
          later.response.once('finish',()=>{if(!earlier.response.writableEnded)earlier.response.end(earlier.body);});
          later.response.end(later.body);
        }else pipeline.pairTimers.set(pair,setTimeout(()=>{
          // Drain a serial-reader regression promptly rather than hanging the
          // whole suite; the final overlap assertions still reject it.
          pipeline.timedOut.push(pair);pipeline.pairTimers.delete(pair);
          for(const position of [pair,pair+1]){const held=pipeline.responses.get(position);if(held&&!held.response.writableEnded)held.response.end(held.body);}
        },10000));
        return;
      }
      response.end(image.body);return;
    }
    const match=new RegExp('^/'+publisherBook+'/wp-json/pressbooks/v2/(chapters|parts|back-matter)/([1-9]\\d*)$').exec(url.pathname);
    assert(match,'Only the configured public chapter endpoint is requested; redirects are not followed');
    const endpointType=match[1],config=publisherCases.get(Number(match[2]));assert(config,'Only a synthetic native publisher ID is requested');
    if(endpointType==='parts')assert(config.mode.startsWith('part-')||config.mode.startsWith('back-matter-'),'Only an exposed chapter-404 transition may request a part endpoint');
    if(endpointType==='back-matter')assert(config.mode.startsWith('back-matter-')||config.mode==='part-missing',
      'Only exposed chapter and part 404 responses permit a back-matter request');
    assert.equal(url.search,'');assert.equal(request.method,'GET');
    assert.equal(request.headers.origin,origin);
    assert.equal(request.headers['sec-fetch-mode'],'cors');assert.equal(request.headers.authorization,undefined);
    assert.equal(request.headers.referer,undefined,'No private Coursera path is forwarded to the public publisher');
    assert.equal(request.headers['x-coursera-naptime-fields'],undefined);
    assert.equal(request.headers['content-type'],undefined,'A simple public GET has no copied JSON/auth request headers');
    assert(!String(request.headers.cookie||'').includes(secrets[0]),'Coursera cookies cannot reach the publisher');
    const attempt=++config.requests;
    publisherRequests.push({chapterId:config.chapterId,endpointType,path:url.pathname,mode:config.mode,attempt,method:request.method,
      cookiePresent:!!request.headers.cookie,authorizationPresent:!!request.headers.authorization});
    response.setHeader('Cache-Control','no-store');response.setHeader('Vary','Origin, Cookie');
    const initialDenied=['include-exact','include-wildcard','missing-acac','http-403','include-404'].includes(config.mode)&&attempt===1;
    const cors=config.mode==='no-cors'?'none':config.mode==='wrong-origin'?'wrong':
      ['include-exact','missing-acac','http-403','include-404'].includes(config.mode)&&attempt>1?'exact':'wildcard';
    if(cors!=='none')response.setHeader('Access-Control-Allow-Origin',cors==='exact'?origin:cors==='wrong'?'https://another.example.test':'*');
    if(['include-exact','include-wildcard','http-403','include-404'].includes(config.mode)&&attempt>1)response.setHeader('Access-Control-Allow-Credentials','true');
    response.setHeader('Content-Type',config.mode==='wrong-mime'?'text/html; charset=utf-8':'application/json; charset=utf-8');
    if(config.mode==='redirect'){
      response.statusCode=302;response.setHeader('Location',publisherOrigin+'/'+publisherBook+'/chapter/never-follow/');response.end();return;
    }
    if(config.mode==='http-401'){response.statusCode=401;response.end('{\"error\":\"synthetic public access required\"}');return;}
    if(config.mode.startsWith('back-matter-')&&endpointType==='parts'&&/part-(401|403)$/.test(config.mode)){
      response.statusCode=Number(config.mode.slice(-3));response.end('{"error":"synthetic part access denied"}');return;
    }
    if(((config.mode.startsWith('part-')||config.mode.startsWith('back-matter-'))&&endpointType==='chapters')||
      config.mode.startsWith('back-matter-')&&endpointType==='parts'||config.mode==='part-missing'||config.mode==='include-404'&&attempt>1){
      response.statusCode=404;response.end('{"error":"synthetic missing typed publisher resource"}');return;
    }
    if(initialDenied||config.mode==='http-403'){response.statusCode=403;response.end('{"error":"synthetic public denial"}');return;}
    if(config.mode==='http-429'){response.statusCode=429;response.end('{"error":"synthetic public rate limit"}');return;}
    response.setHeader('Content-Length',String(config.bytes.length));response.end(config.bytes);return;
  }
  if(url.pathname==='/fixture-direct-provider-reader.js'){
    response.setHeader('Content-Type','text/javascript');response.end(directReaderSource);return;
  }
  if(host===new URL(panoptoOrigin).hostname){
    assert.equal(url.pathname,'/Panopto/Pages/Viewer/DeliveryInfo.aspx');
    assert.equal(request.method,'POST');assert.equal(request.headers.origin,origin);
    assert.equal(request.headers.cookie,undefined);assert.equal(request.headers.authorization,undefined);
    assert.equal(request.headers['content-type'],'application/x-www-form-urlencoded;charset=UTF-8');
    let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;});
    request.on('end',()=>{
      const form=new URLSearchParams(body),config=panoptoDeliveries.get(form.get('deliveryId'));
      assert(config,'Only an exactly configured delivery can be requested');
      assert.deepEqual([...form],[['deliveryId',config.panoptoDeliveryId],['isLiveNotes','false'],['refreshAuthCookie','false'],
        ['isActiveBroadcast','false'],['isEditing','false'],['isKollectiveAgentInstalled','false'],['isEmbed','true'],['responseType','json']]);
      assert.equal(Buffer.byteLength(body),193);
      panoptoRequests.push({courseId:config.id,role:'METADATA',method:request.method,form:[...form],corsAllowed:config.panoptoMode!=='metadata-cors'});
      // These are explicit synthetic browser-policy cases. They establish no
      // CORS permission for a real Panopto tenant or authenticated session.
      if(config.panoptoMode!=='metadata-cors')response.setHeader('Access-Control-Allow-Origin',origin);
      response.setHeader('Content-Type','application/json; charset=utf-8');
      if(config.panoptoMode==='metadata-auth'){
        response.statusCode=401;response.end('{"error":"Synthetic provider sign-in required"}');return;
      }
      response.end(JSON.stringify(config.panoptoModel));
    });return;
  }
  if(host===new URL(panoptoMediaOrigin).hostname){
    const config=configs.get(url.pathname.split('/')[1]);
    assert(config?.panoptoMode,'Panopto media must originate in this course\'s exact delivery model');
    assert.equal(url.pathname,'/'+config.id+'/podcast.mp4','HLS playlists and OCR labels are retained as references, not downloaded as MP4');
    assert.equal(request.method,'GET');assert.equal(request.headers.origin,origin);
    assert.equal(request.headers.cookie,undefined);assert.equal(request.headers.authorization,undefined);
    assert.equal(url.searchParams.get('X-Amz-Signature'),secrets[3]);
    panoptoRequests.push({courseId:config.id,role:'PODCAST',method:request.method,corsAllowed:config.panoptoMode!=='body-cors'});
    if(config.panoptoMode!=='body-cors')response.setHeader('Access-Control-Allow-Origin',origin);
    response.setHeader('Content-Type','video/mp4');response.setHeader('Content-Length',String(mp4Bytes.length));
    response.setHeader('ETag','"synthetic-podcast-rendition-v1"');
    response.setHeader('Last-Modified','Thu, 15 Oct 2026 10:00:00 GMT');
    response.setHeader('Access-Control-Expose-Headers','ETag, Last-Modified, Content-Length, Content-Type');
    response.end(mp4Bytes);return;
  }
  if(request.headers.host==='fixture-cdn.cloudfront.net'){
    const [courseId,assetId]=url.pathname.split('/').slice(1),config=configs.get(courseId),asset=assets.get(assetId);
    assert(config&&asset&&asset.courseId===courseId);assert.equal(config.mode,'media-body-cors');
    assert.equal(request.headers.origin,origin,'The native fetch must enforce a real cross-origin response');
    response.setHeader('Content-Type',asset.mime);
    // Browser interception can synthesize a CORS-approved response. Serve this
    // one through the real HTTPS network boundary, deliberately without ACAO.
    response.end(asset.body);return;
  }
  if(url.pathname==='/favicon.ico'){response.statusCode=204;response.end();return;}
  if(!url.pathname.startsWith('/api/')){
    const courseId=url.pathname.split('/')[3],config=configs.get(courseId);documents.push(url.pathname);
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.setHeader('Set-Cookie','fixtureSession='+secrets[0]+'; HttpOnly; Secure; SameSite=Lax; Path=/');
    if(!url.searchParams.has('open'))response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'nonce-fixture'; style-src 'self'; connect-src 'self' "+mediaOrigin+
      (config?.panoptoMode&&config.panoptoMode!=='metadata-csp'?' '+panoptoOrigin+' '+panoptoMediaOrigin:'')+
      (config?.publisherReaderCase&&!config.publisherCspBlocked?' '+publisherOrigin:''));
    response.end(`<!doctype html><title>Direct capture fixture</title><main><a id="editor" href="/teach/${slug}/${courseId}/content/item/project/item_0000">Open quiz normally</a><button id="foreign">Open unrelated test window</button></main><script nonce="fixture">
      window.fixtureEditorClicks=0;window.fixtureScrolls=0;window.fixturePanelScrolls=0;window.fixtureCsp=[];window.fixtureCspEvents=[];
      document.getElementById('editor').onclick=()=>{window.fixtureEditorClicks++;};
      document.getElementById('foreign').onclick=()=>window.open('${helperOrigin}/foreign-window.html','fixture-attacker');
      // Real operator clicks may scroll the fixed CTI controls. Course,
      // document and window scrolling must still remain zero during capture.
      window.addEventListener('scroll',event=>{
        if(event.target instanceof Element&&event.target.closest('#cti-direct-data-capture-v1'))window.fixturePanelScrolls++;
        else window.fixtureScrolls++;
      },true);
      document.addEventListener('securitypolicyviolation',event=>{
        window.fixtureCsp.push(event.violatedDirective);
        window.fixtureCspEvents.push({blockedURI:event.blockedURI,effectiveDirective:event.effectiveDirective,disposition:event.disposition});
      });
      localStorage.setItem('__CTI_AUTOMATIC_LOCAL_ACTIVE_V61517_${courseId}','legacy-fixture-sentinel');
      ${config?.snapshotSharedDefinition?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={concurrentRequests:1};':config?.mode==='limited'?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={requests:4};':config?.mode==='budget-resume'?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={requests:40};':''}
    </script>${config?.directReaderCase?'<script src="/fixture-direct-provider-reader.js"></script>':''}`);return;
  }
  const [, ,resource,...tail]=url.pathname.split('/'),reference=resource===providerResource?url.searchParams.get('widgetSessionProviderId'):resource==='assets.v1'?url.searchParams.get('ids'):
    decodeURIComponent(tail.join('/').replace(/\/$/,''));
  const binding=atoms.get(reference)||groups.get(reference)||definitions.get(reference)||assets.get(reference)||providers.get(reference),courseId=binding?.courseId||reference;
  const config=configs.get(courseId),inFlight=(active.get(courseId)||0)+1;
  active.set(courseId,inFlight);maximum.set(courseId,Math.max(maximum.get(courseId)||0,inFlight));
  let settled=false;const settle=()=>{if(settled)return;settled=true;active.set(courseId,(active.get(courseId)||1)-1);};
  response.on('finish',settle);response.on('close',settle);
  requests.push({courseId,resource,reference,path:url.pathname,query:[...url.searchParams],method:request.method,
    all:request.headers['x-coursera-naptime-fields'],authenticated:request.headers.cookie?.includes('fixtureSession='+secrets[0])===true});
  response.setHeader('Content-Type','application/json; charset=utf-8');
  let value;
  if(!config||!resources.has(resource)){response.statusCode=404;response.end('{}');return;}
  if(resource===providerResource){
    assert.equal(url.pathname,'/api/'+providerResource+'/');
    assert.equal(url.searchParams.get('q'),'getWithCourseId');
    assert.equal(url.searchParams.get('courseId'),courseId);
    assert.equal(url.searchParams.get('widgetSessionProviderId'),reference);
    assert(!url.searchParams.has('action'));
    if(binding.fail){response.statusCode=404;response.end('{}');return;}
    value=structuredClone(binding.value);
    if(config.providerGets){
      const count=(config.providerGets.get(reference)||0)+1;config.providerGets.set(reference,count);
      if(config.inlineMode==='inline-wrong-owner')value.owners=['COURSE~Another_native_course_123'];
      if(config.inlineMode==='inline-source-changed'&&count>1){value.metadata.updatedAt++;value.draft.configuration.url+='?revision=2';}
    }
  }
  else if(resource==='assets.v1'){
    const count=(config.assetGets.get(reference)||0)+1;config.assetGets.set(reference,count);
    assert.equal(url.pathname,'/api/assets.v1');assert.equal(url.searchParams.get('ids'),reference);
    assert.equal(request.headers['x-coursera-naptime-fields'],'ALL');
    if(['media-metadata-404','media-legacy-gap'].includes(config.mode)){response.statusCode=404;response.end('{}');return;}
    if(config.mode==='media-metadata-auth'){response.statusCode=401;response.end('{}');return;}
    value=structuredClone(binding.value);
    if(config.mode==='media-metadata-changed'&&count>1)value.name='Changed '+value.name;
  }
  else if(config.mode==='authentication'&&resource===groupResource){response.statusCode=401;response.end('{"error":"fixture auth stopped"}');return;}
  else if(resource==='authoringCourseMaterials.v1'){
    config.materialGets++;value=structuredClone(config.material);
    if(config.mode==='material-changed'&&config.materialGets>1)value.conflictMetadata.version=2;
  }else if(resource==='authoringCourses.v2')value={id:courseId,name:'Synthetic course'};
  else if(resource==='authoringAtoms.v2'){
    const count=(config.atomGets.get(reference)||0)+1;config.atomGets.set(reference,count);value=structuredClone(binding.atom);
    if(config.nativeRecheckAtomErrorId===reference){
      response.statusCode=503;response.end('{"error":"synthetic native recheck atom read failed"}');return;
    }
    if(config.mode==='media-first-atom-failed'&&binding.itemId==='item_0002'){
      response.statusCode=503;response.end('{"error":"current atom read failed before media acquisition"}');return;
    }
    if(['publisher-final-binding-failed','publisher-service-final-binding-failed'].includes(config.mode)&&['item_0002','item_0003'].includes(binding.itemId)&&
        count>config.failFinalAtomAfter.get(reference)){
      response.statusCode=503;response.end('{"error":"synthetic final native atom read failed"}');return;
    }
    if(config.mode==='media-final-atom-failed'&&binding.itemId==='item_0002'&&count>1){
      response.statusCode=503;response.end('{"error":"final atom consistency read interrupted"}');return;
    }
    if(config.mode==='changed'&&count>1){value.storedAtomVersion=2;value.metadata.updatedAt=2000;}
    if(config.snapshotMode==='source-changed'&&reference===config.snapshotAtomId&&count>1){
      value.published.content.definition.assignmentId=value.published.content.definition.assignmentId.replace('@2','@3');
      value.storedAtomVersion=3;value.metadata.updatedAt=2000;
    }
  }else if(resource==='authoringItemContentRelations.v1')value=structuredClone(binding.relation);
  else if(resource===groupResource){
    value=structuredClone(groups.get(reference)?.value);
    const count=(config.groupGets.get(reference)||0)+1;config.groupGets.set(reference,count);
    if(config.mode==='group-changed'&&count>1&&value)value.scoringWeight=2;
    if(config.snapshotMode==='group-changed'&&reference===config.snapshotFirstGroupId&&count>1&&value)value.scoringWeight=2;
  }
  else if(resource===definitionResource){
    if(/%40/i.test(url.pathname)){response.statusCode=404;response.end('{"error":"literal version delimiter required"}');return;}
    if(config.snapshotDefinitionErrorId===reference||config.snapshotAllDefinitionsFail&&binding.itemId==='item_0000'){
      response.statusCode=404;response.end('{"error":"current attached draft definition not available"}');return;
    }
    // Leave later reads in flight until the operator stops. Request arrival
    // alone does not establish that an earlier response reached IndexedDB.
    const pause=config.pauseFixture;
    if(pause&&!pause.released&&++pause.reads>pauseDefinitionLimit){pause.held++;return;}
    value=structuredClone(definitions.get(reference)?.value);
  }
  if(!value){response.statusCode=404;response.end('{}');return;}
  const linked=resource===providerResource?{'authoringWidgetSummaries.v1':[{id:'synthetic-widget@1',
    configurationExamples:[{configuration:{url:'https://example.test/format-example'}}]}]}:{};
  setTimeout(()=>{if(!response.destroyed)response.end(JSON.stringify({elements:[value],paging:{},linked}));},config.mode==='resume'?8:1);
});
let browser,heartbeat;
try{
  const {courseraDirectDataSource,courseraDirectDataBookmarkSource}=await import('../src/generated/extractor-sources.js');
  assert.equal(typeof courseraDirectDataSource,'string','Generate the maintained direct-data delivery source first');
  assert.match(courseraDirectDataSource,/__CTI_COURSERA_DIRECT_DATA_CAPTURE__/);
  const deliveredProgram=createCourseraDirectDataCaptureScript(courseraDirectDataBookmarkSource);
  const bookmark=createCourseraDirectDataCaptureBookmark(),parsedBookmark=new URL(bookmark);
  assert.equal(parsedBookmark.href,bookmark);assert.equal(parsedBookmark.search,'');assert.equal(parsedBookmark.hash,'');
  assert.equal(decodeURIComponent(parsedBookmark.pathname),deliveredProgram,'The compact address preserves the exact delivered source');
  assert(Buffer.byteLength(bookmark,'utf8')<=500*1024,'The exact emitted bookmark must fit Chrome Bookmark Manager\'s URL limit');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,
    ...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
    args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP www.coursera.org 127.0.0.1:'+server.address().port+
      ',MAP fixture-cdn.cloudfront.net 127.0.0.1:'+server.address().port+',MAP fixture.hosted.panopto.com 127.0.0.1:'+server.address().port+
      ',MAP d2y36twrtb17ty.cloudfront.net 127.0.0.1:'+server.address().port+',MAP cti-hardening.pages.dev 127.0.0.1:'+server.address().port+
      ',MAP opentextbc.ca 127.0.0.1:'+server.address().port],
  });
  if(process.env.CTI_DIRECT_BROWSER_PROGRESS==='1')heartbeat=setInterval(async()=>{
    for(const context of browser.contexts())for(const page of context.pages())try{
      const progress=await page.evaluate(()=>{const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;return state&&{courseId:state.courseId,state:state.state,phase:state.phase,counts:state.counts,exporting:state.exporting,exportError:state.exportError};});
      if(progress)console.error('Synthetic fixture progress: '+JSON.stringify(progress));
    }catch{ /* A closed synthetic page has no remaining state to report. */ }
  },10000);
  let nativeExecuted=true,policyCanaryVerified=false,compactCanaryExecuted=false;
  async function poll(check,timeout=2000){const deadline=Date.now()+timeout;do{if(await check())return true;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);return false;}
  const canaryContext=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  if(allowPolicyFallback&&knownPolicy&&process.env.CTI_CHROMIUM_PATH==='/usr/bin/chromium'){
    const canary=await canaryContext.newPage();await canary.goto(origin+'/teach/'+slug+'/'+complete.id+'/content/edit?open=1');
    const session=await canaryContext.newCDPSession(canary),reply=await session.send('Page.navigate',{url:'javascript:void(window.__CTI_DIRECT_NATIVE_CANARY=true)',transitionType:'auto_bookmark'});
    assert.equal(reply.errorText,'net::ERR_ABORTED');assert.equal(await poll(()=>canary.evaluate(()=>window.__CTI_DIRECT_NATIVE_CANARY===true)),false);
    assert.equal(requests.length,0);policyCanaryVerified=true;await session.detach();await canary.close();
  }
  const compactCanary=await canaryContext.newPage();await compactCanary.goto(origin+'/teach/'+slug+'/'+complete.id+'/content/edit');
  const punctuation='café 日本語 ? # % &=+/,:;@[]{} ! $ ( )';
  const canaryProgram='void(window.__CTI_COMPACT_URL_CANARY='+JSON.stringify(punctuation)+')',canaryAddress='javascript:'+encodeJavaScriptBookmarkPayload(canaryProgram);
  assert.deepEqual(await compactCanary.evaluate(address=>{const value=new URL(address);return{href:value.href,search:value.search,hash:value.hash,source:decodeURIComponent(value.pathname)};},canaryAddress),
    {href:canaryAddress,search:'',hash:'',source:canaryProgram},'Actual Chromium URL parsing preserves compact source and URI punctuation');
  const compactSession=await canaryContext.newCDPSession(compactCanary);
  await compactSession.send('Page.navigate',{url:canaryAddress,transitionType:'auto_bookmark'});
  compactCanaryExecuted=await poll(()=>compactCanary.evaluate(value=>window.__CTI_COMPACT_URL_CANARY===value,punctuation));
  assert(compactCanaryExecuted||policyCanaryVerified,'The browser executes the compact javascript URL without an eval or script loader');
  await compactSession.detach();await compactCanary.close();
  await canaryContext.close();
  async function launch(page,context,startCapture=true){
    const session=await context.newCDPSession(page);
    if(process.env.CTI_DIRECT_DEBUG_EXCEPTIONS==='1'){
      session.on('Debugger.paused',async event=>{
        console.error('Synthetic direct-data exception: '+String(event.data?.description||event.reason).slice(0,350));
        await session.send('Debugger.resume').catch(()=>{});
      });
      await session.send('Debugger.enable');await session.send('Debugger.setPauseOnExceptions',{state:'all'});
    }
    const reply=await session.send('Page.navigate',{url:bookmark,transitionType:'auto_bookmark'});
    const observed=await poll(()=>page.evaluate(()=>Boolean(window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__)));
    if(!observed){
      if(!policyCanaryVerified||reply.errorText!=='net::ERR_ABORTED'){
        const csp=await page.evaluate(()=>window.fixtureCsp||[]);throw new Error('Native direct-data bookmark did not execute: '+JSON.stringify({errorText:reply.errorText,csp}));
      }
      nativeExecuted=false;
      const evaluation=await session.send('Runtime.evaluate',{expression:deliveredProgram,userGesture:true,returnByValue:true});
      assert.equal(evaluation.exceptionDetails,undefined,'Generated direct capture source must be self-contained');
      await page.waitForFunction(()=>Boolean(window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__));
    }
    if(process.env.CTI_DIRECT_DEBUG_EXCEPTIONS!=='1')await session.detach();
    await page.getByRole('button',{name:'Capture/resume course',exact:true}).waitFor();
    if(startCapture)await page.getByRole('button',{name:'Capture/resume course',exact:true}).click();
  }
  async function launchFirstPartyBookmark(page,context){
    const session=await context.newCDPSession(page),reply=await session.send('Page.navigate',{url:bookmark,transitionType:'auto_bookmark'});
    const observed=await poll(()=>page.evaluate(()=>Boolean(document.getElementById('cti-publisher-recovery-panel'))));
    if(!observed){
      assert(policyCanaryVerified&&reply.errorText==='net::ERR_ABORTED','The SAME generated universal bookmark must execute in the first-party publisher tab');
      nativeExecuted=false;
      const evaluation=await session.send('Runtime.evaluate',{expression:deliveredProgram,userGesture:true,returnByValue:true});
      assert.equal(evaluation.exceptionDetails,undefined);await page.waitForSelector('#cti-publisher-recovery-panel');
    }
    await session.detach();
    assert.equal(await page.evaluate(()=>Boolean(window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__)),false,
      'The publisher branch never starts a Coursera capture or reads Coursera credentials');
  }
  async function open(config){
    const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true}),contextDownloads=[],popups=[];
    await context.addInitScript(()=>{
      window.fixtureProviderFrames=[];
      window.addEventListener('message',event=>{const m=event.data;if(m?.protocol==='CTI_PROVIDER_HELPER_V1')
        window.fixtureProviderFrames.push({type:m.type,id:m.id,kind:m.kind,nonce:m.nonce,courseId:m.courseId,
          itemId:m.itemId,providerId:m.providerId,origin:event.origin,seq:m.seq,offset:m.offset,
          bytes:m.bytes instanceof ArrayBuffer?m.bytes.byteLength:0,operations:Array.isArray(m.operations)?m.operations:undefined});});
    });
    context.on('page',target=>{target.on('pageerror',error=>errors.push(error.message));target.on('download',download=>contextDownloads.push({page:target,download}));popups.push(target);});
    if(config===publisherImageCourse)await context.addInitScript(()=>{
      window.fixturePublisherImageBodies=[];
      const original=Object.defineProperty;
      Object.defineProperty=function(object,key,descriptor){
        const result=Reflect.apply(original,this,[object,key,descriptor]);
        if(key==='bytes'&&object?.receipt?.transport==='BROWSER_PUBLISHER_IMAGE'&&object.archivePath&&descriptor.value instanceof Uint8Array)
          window.fixturePublisherImageBodies.push(object);
        return result;
      };
    });
    if(config===publisherPipelineCourse)await context.addInitScript(hashes=>{
      window.fixturePublisherPipelineCommits=[];
      const original=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,...args){
        const request=Reflect.apply(original,this,[value,...args]);
        if(this.name==='bodies'&&hashes.includes(value?.sha256)&&value.blob instanceof Blob){
          const commit={sha256:value.sha256,bytes:value.blob.size};
          this.transaction.addEventListener('complete',()=>window.fixturePublisherPipelineCommits.push(commit),{once:true});
        }
        return request;
      };
    },publisherPipelineUrls.map(url=>createHash('sha256').update(publisherImages.get(url).body).digest('hex')));
    const page=await context.newPage();
    if(config.helperMode)await context.addCookies([{name:'ctiFixtureMode',value:config.helperMode,url:helperOrigin,httpOnly:true,secure:true,sameSite:'None'}]);
    await context.addCookies([{name:'ctiFixtureSession',value:secrets[4],url:helperOrigin,httpOnly:true,secure:true,sameSite:'None'}]);
    if(config.helperMode==='popup-blocked')await page.addInitScript(()=>{window.open=()=>null;});
    await context.route(mediaOrigin+'/**',async route=>{
      const request=route.request(),url=new URL(request.url()),assetId=url.pathname.split('/')[2],asset=assets.get(assetId);
      const headers=await request.allHeaders();
      mediaRequests.push({courseId:config.id,assetId,url:request.url(),method:request.method(),
        credentialHeaders:['cookie','authorization'].filter(name=>headers[name])});
      assert(asset&&asset.courseId===config.id,'The binary URL must originate in this course\'s exact asset metadata');
      assert.equal(request.method(),'GET');assert.equal(headers.cookie,undefined);assert.equal(headers.authorization,undefined);
      assert.equal(url.searchParams.get('X-Amz-Signature'),secrets[3],
        'The signed response location is used ephemerally for the one fetch');
      const responseHeaders={'Content-Type':asset.mime,'Access-Control-Allow-Origin':origin};
      if(/\.dwg$/i.test(asset.name))responseHeaders['Content-Length']=String(asset.body.length);
      if(config.mode==='media-body-403'){await route.fulfill({status:403,headers:responseHeaders,body:'denied'});return;}
      if(config.mode==='media-body-cors'){await route.continue();return;}
      if(config.mode==='media-body-redirect'){
        await route.fulfill({status:302,headers:{...responseHeaders,Location:mediaOrigin+'/unexpected/redirect'},body:''});return;
      }
      if(config.mode==='media-body-html'){
        await route.fulfill({status:200,headers:{...responseHeaders,'Content-Type':'text/html'},body:'<!doctype html><title>Login</title>'});return;
      }
      const body=config.mode==='media-body-limit'?Buffer.concat([pngBytes,Buffer.alloc(17*1024*1024)]):asset.body;
      await route.fulfill({status:200,headers:responseHeaders,body});
    });
    let publisherImageStageChecked=false;
    await context.route(publisherOrigin+'/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      assert.equal(request.method(),'GET');
      const firstPartyPage=url.pathname==='/'+publisherBook+'/'&&firstPartyPublisherPages.has((url.searchParams.get('p')||'').replace(/\/$/,''));
      if(url.href!==publisherOpaqueUrl&&!publisherImages.has(url.href)&&!firstPartyPage&&url.pathname!=='/favicon.ico'){
        assert.match(url.pathname,new RegExp('^/'+publisherBook+'/wp-json/pressbooks/v2/(?:chapters|parts|back-matter)/[1-9]\\d*$'));
        assert(publisherCases.has(Number(url.pathname.split('/').at(-1))));
      }
      if(config===publisherImageCourse&&!publisherImageStageChecked&&url.href===publisherImageBase+'redirect.png'){
        const staged=await page.evaluate(async imageUrl=>{
          const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__,observed=window.fixturePublisherImageBodies.find(body=>body.canonicalUrl===imageUrl);
          const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
          const rows=await new Promise((resolve,reject)=>{const transaction=database.transaction(['bodies','items'],'readonly'),out={};
            for(const name of ['bodies','items']){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result.filter(row=>row.runId===state.runId);};}
            transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);});database.close();
          const blob=rows.bodies.find(row=>row.sha256===observed?.sha256);
          const owns=(value,sha)=>{if(!value||typeof value!=='object')return false;if(value.body?.sha256===sha&&value.body.archivePath)return true;return Object.values(value).some(child=>owns(child,sha));};
          return{observed:!!observed,released:observed?!Object.hasOwn(observed,'bytes'):false,sha256:observed?.sha256,
            staged:blob?.blob instanceof Blob,stagedBytes:blob?.blob?.size,acceptedSavedItemOwnsBody:rows.items.some(row=>owns(row.fingerprint,observed?.sha256))};
        },publisherImageBase+'main.png');
        assert.equal(staged.observed,true);assert.equal(staged.released,true,'The earlier original is staged and releases its transient byte array before the third image starts');
        assert.equal(staged.staged,true);assert.equal(staged.stagedBytes,pngBytes.length);assert.equal(staged.sha256,createHash('sha256').update(pngBytes).digest('hex'));
        assert.equal(staged.acceptedSavedItemOwnsBody,false,'Early local Blob staging is separate from accepted final native item ownership');
        publisherImageStageChecked=true;config.publisherImageStagingChecked=true;
      }
      // Fulfilled browser interceptions can synthesize CORS approval. Let the
      // native fetch reach the mapped HTTPS server so the browser enforces the
      // actual ACAO/credential combinations, including deliberate denials.
      await route.continue();
    });
    const destinations=[];page.on('request',request=>destinations.push(new URL(request.url()).origin));
    await page.goto(origin+'/teach/'+slug+'/'+config.id+'/content/edit');
    return {context,page,destinations,contextDownloads,popups};
  }
  async function terminal(page){
    await page.waitForFunction(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__?.running===false,{},{timeout:180000});
    return page.evaluate(()=>{const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;return {state:state.state,runId:state.runId,phase:state.phase,counts:state.counts,
      diagnostic:document.getElementById('cti-direct-data-capture-v1')?.innerText.slice(0,900)};});
  }
  async function savedProgress(page){
    return page.evaluate(async()=>{
      const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;
      if(!state?.runId)return null;
      const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const rows=await new Promise((resolve,reject)=>{const transaction=database.transaction(['definitions','groups','runs'],'readonly'),out={};
        for(const name of ['definitions','groups','runs']){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result.filter(row=>row.courseId===state.courseId&&row.runId===state.runId);};}
        transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);});database.close();
      return {running:state.running,definitions:rows.definitions.map(row=>row.definitionId),groups:rows.groups.length,
        groupIds:rows.groups.map(row=>row.groupId),runs:rows.runs.map(row=>({runId:row.runId,state:row.state}))};
    });
  }
  async function pauseAfterSavedProgress(target,config){
    assert(await poll(async()=>{
      const saved=await savedProgress(target.page);
      return saved?.running&&saved.definitions.length===pauseDefinitionLimit&&saved.groups>=pauseDefinitionLimit&&config.pauseFixture.held>0;
    },15000),'Pause requires committed definitions and groups while later definition reads remain in flight: '+config.id);
    await target.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.stop());
    config.pauseFixture.released=true;
  }
  async function readFile(download){
    const bytes=fs.readFileSync(await download.path());
    assert(download.suggestedFilename().endsWith('.zip'),'One ZIP carries the compressed native manifest and original files');
    assert(bytes.byteLength<=640*1024*1024,'The final archive must fit its 640 MiB hard byte limit');
    const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
    assert(zip.file('capture.json.gz'));
    const jsonBytes=gunzipSync(await zip.file('capture.json.gz').async('nodebuffer'),{maxOutputLength:128*1024*1024});
    assert(jsonBytes.byteLength<=128*1024*1024,'Expanded JSON must stay within the 128 MiB processing limit');
    assert(!jsonBytes.toString('utf8').includes('"base64"'),'Original binary bodies are stored once as ZIP files, outside metadata');
    const capture=await readCourseraCaptureFileJson(new File([bytes],download.suggestedFilename(),{type:'application/zip'}));
    fileSizes.set(capture,{compressed:true,archive:true,fileBytes:bytes.byteLength,jsonBytes:jsonBytes.byteLength});
    return capture;
  }
  function assertTransport(config,start){
    const received=requests.slice(start).filter(request=>request.courseId===config.id);
    assert(received.length>0);assert(received.every(request=>request.method==='GET'&&request.authenticated&&resources.has(request.resource)));
    assert(received.every(request=>!request.query.some(([key])=>key==='ids')||request.resource==='assets.v1'&&
      new Map(request.query).get('ids')===request.reference&&!request.reference.includes(',')),
      'Only exact source-referenced single asset IDs use the observed collection GET format');
    assert(maximum.get(config.id)<=4,'All roots, items, groups and definitions share one four-read pool');
    for(const request of received){
      if([groupResource,definitionResource,'authoringAtoms.v2','authoringItemContentRelations.v1'].includes(request.resource))assert.equal(request.all,'ALL');
      if(request.resource===definitionResource){assert(definitions.has(request.reference));assert(request.path.endsWith('@'+request.reference.split('@')[1]));assert(!/%40/i.test(request.path));}
      if(request.resource===groupResource){assert(groups.has(request.reference));assert.equal(new Map(request.query).get('id'),request.reference);}
      if(request.resource==='assets.v1'){assert(assets.has(request.reference));assert.equal(request.all,'ALL');}
    }
  }
  async function assertNoEditor(page,destinations){
    const config=configs.get(new URL(page.url()).pathname.split('/')[3]);
    assert([...new Set(destinations)].every(destination=>destination===origin||destination===mediaOrigin||
      config?.panoptoMode&&[panoptoOrigin,panoptoMediaOrigin].includes(destination)||
      config?.publisherReaderCase&&destination===publisherOrigin),
      'Only the authenticated authoring API and exact metadata-returned CDN can be requested');
    assert.equal(await page.evaluate(()=>window.fixtureEditorClicks),0);assert.equal(await page.evaluate(()=>window.fixtureScrolls),0,'The course, document and window remain unscrolled; only the fixed CTI controls may scroll');
    assert(!documents.some(address=>address.includes('/content/item/')),'No authoring editor is opened');
    assert.equal(await page.evaluate(()=>document.cookie.includes('fixtureSession')),false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('__CTI_AUTOMATIC_LOCAL_ACTIVE_V61517_'+location.pathname.split('/')[3])),'legacy-fixture-sentinel');
  }
  async function runFileCase(config){
    const target=await open(config),downloads=[];target.page.on('download',download=>downloads.push(download));
    const downloading=target.page.waitForEvent('download',{timeout:180000});void downloading.catch(()=>{});
    const start=requests.length;await launch(target.page,target.context);const state=await terminal(target.page);
    assert(state.counts.total>0,'No fixture inventory was established: '+JSON.stringify({state,requests:requests.slice(start).map(request=>({resource:request.resource,reference:request.reference}))}));
    const download=await Promise.race([downloading,target.page.waitForFunction(()=>{
      const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;return state?.exportError&&state.exporting===false;
    },{},{timeout:180000}).then(async()=>{throw Error('Native archive export failed: '+await target.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.exportError));})]);
    const capture=await readFile(download);await target.page.waitForTimeout(50);assert.equal(downloads.length,1);
    assert.equal(target.contextDownloads.length,1,'The cooperating helper must not produce a second capture artifact');
    assert.equal(target.contextDownloads[0].page,target.page,'The single ZIP is downloaded by the owning Coursera tab');
    assertTransport(config,start);await assertNoEditor(target.page,target.destinations);
    for(const secret of secrets)assert(!JSON.stringify(capture).includes(secret),'Credential markers must not enter final JSON');
    return {...target,state,capture,start,downloads};
  }
  {
    const target=await open(runningPartial),readingAtom=partialMaterials[0].atomId,nextAtom=partialMaterials[1].atomId,
      downloads=[],start=requests.length;
    let releaseFirst,releaseNext,firstHeld=false,nextHeld=false;
    const firstGate=new Promise(resolve=>{releaseFirst=resolve;}),nextGate=new Promise(resolve=>{releaseNext=resolve;});
    target.page.on('download',download=>downloads.push(download));
    await target.context.route(origin+'/api/authoringAtoms.v2/**',async route=>{
      const reference=decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
      if(reference===readingAtom&&!firstHeld){firstHeld=true;await firstGate;}
      else if(reference===nextAtom&&!nextHeld){nextHeld=true;await nextGate;}
      await route.continue();
    });
    try{
      const partialDownload=target.page.waitForEvent('download',{timeout:180000});void partialDownload.catch(()=>{});
      await launch(target.page,target.context);
      assert(await poll(()=>firstHeld,15000),'The partial-export fixture holds an actual current item request');
      const partialButton=target.page.getByRole('button',{name:'Download partial capture',exact:true});
      assert.equal(await partialButton.isEnabled(),true);await partialButton.click();
      assert.equal(await partialButton.isDisabled(),true);
      assert(await target.page.getByText('Waiting for the current item checkpoint. New item reads wait briefly while the partial snapshot is prepared.',{exact:true}).isVisible());
      assert.equal(downloads.length,0,'The archive cannot read an uncommitted current item');
      releaseFirst();
      const partialFile=await partialDownload,partialCapture=await readFile(partialFile);
      assert(await poll(()=>nextHeld,15000),'Native acquisition continues after the immutable snapshot is prepared');
      assert.equal(await target.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.running),true);
      assert(partialFile.suggestedFilename().includes('__PARTIAL__'));
      const proof=partialCapture.meta.directDataCapture;
      assert.equal(proof.acquisitionComplete,false);assert.equal(proof.wholeCourseVerified,false);assert.equal(proof.sourceStable,false);
      assert.equal(proof.stopReason,'PROVISIONAL_RUNNING_SNAPSHOT');assert.equal(proof.partialExport.provisional,true);
      assert.equal(proof.partialExport.scope,'COMMITTED_ITEM_BOUNDARY');assert.equal(proof.partialExport.stateAtSnapshot,'RUNNING');
      assert.equal(proof.coverage.content.total,3);assert.equal(proof.coverage.content.verified,1);
      assert.equal(proof.coverage.inventory.total,4);assert.equal(proof.coverage.inventory.read,1);
      assert.deepEqual(partialCapture.fingerprints.map(fp=>fp.id),[...partialMaterials.map(leaf=>leaf.id),'empty_0']);
      const partialReading=partialCapture.fingerprints[0],partialZip=await JSZip.loadAsync(fs.readFileSync(await partialFile.path()),{checkCRC32:true});
      for(const assetId of runningPartial.mediaIds){
        const source=assets.get(assetId),sha256=createHash('sha256').update(source.body).digest('hex');
        assert.deepEqual(await partialZip.file('files/'+sha256).async('nodebuffer'),source.body);
        assert(partialReading.payload.directAssetEvidence.assets.some(asset=>asset.assetId===assetId&&asset.body?.sha256===sha256));
      }
      assert(partialCapture.fingerprints.slice(1).every(fp=>fp.captureContract.complete===false));
      assert.equal(evaluateCourseraCapture(partialCapture,runningPartial.id).complete,false);
      const runId=await target.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.runId),saved=await savedNativeRun(target.page,runId);
      assert.equal(saved.runs[0].state,'RUNNING');assert.equal(saved.runs[0].captureMeta.directDataCapture.partialExport,undefined);
      assert.equal(await target.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.result),null);
      const finalDownload=target.page.waitForEvent('download',{timeout:180000});void finalDownload.catch(()=>{});
      releaseNext();
      const finalState=await terminal(target.page),finalCapture=await readFile(await finalDownload);
      await target.page.waitForFunction(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.exporting===false);
      assert.equal(finalState.state,'COMPLETE');assert.equal(finalState.runId,runId);
      assert.equal(finalCapture.meta.directDataCapture.partialExport,undefined);
      assert.equal(evaluateCourseraCapture(finalCapture,runningPartial.id).complete,true);
      assert.deepEqual(finalCapture.fingerprints.find(fp=>fp.id===partialReading.id),partialReading,
        'The later final archive retains the exact earlier native originals and their original observation dates');
      assert.equal(downloads.length,2,'One requested partial ZIP is followed by exactly one automatic final ZIP');
      assert.equal(target.contextDownloads.length,2);
      for(const leaf of partialMaterials){
        assert.equal(requests.slice(start).filter(request=>request.courseId===runningPartial.id&&request.resource==='authoringAtoms.v2'&&request.reference===leaf.atomId).length,2,
          'Snapshot export adds no native source reads');
      }
      assert.equal(requests.slice(start).filter(request=>request.courseId===runningPartial.id&&request.resource==='authoringCourseMaterials.v1').length,2);
      assertTransport(runningPartial,start);await assertNoEditor(target.page,target.destinations);
      for(const secret of secrets)assert(!JSON.stringify(partialCapture).includes(secret));
    }finally{releaseFirst();releaseNext();await target.context.close();}
  }
  const scrollGuard=await open(baseline);
  const scrollCalibration=await scrollGuard.page.evaluate(()=>{
    const controls=document.createElement('section');controls.id='cti-direct-data-capture-v1';document.body.append(controls);
    controls.dispatchEvent(new Event('scroll'));
    document.querySelector('main').dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    return {controls:window.fixturePanelScrolls,course:window.fixtureScrolls};
  });
  assert.deepEqual(scrollCalibration,{controls:1,course:2},'Owned-panel scrolling cannot conceal course or window traversal');
  await scrollGuard.context.close();
  const main=await runFileCase(baseline);
  assert.equal(main.capture.page.courseId,baseline.id);assert.equal(main.capture.fingerprints.length,185);
  assert.equal(main.state.state,'INCOMPLETE');
  assert.equal(main.capture.meta.directDataCapture.stats.maxConcurrentRequests,4,'The assessment workers fill the bounded four-read pool');
  const largeAssessment=main.capture.fingerprints.find(fp=>fp.id==='item_0000');
  const questions=largeAssessment.payload.structuredAssessment.questions;
  assert.equal(questions.length,609);assert.equal(largeAssessment.captureContract.complete,true);
  assert.equal(new Set(questions.map(question=>question.courseraQuestionId)).size,609);
  assert.equal(questions[7].prompt,questions[8].prompt,'Equal prompts remain separate source identities');
  assert.notEqual(questions[7].sourceDefinitionId,questions[8].sourceDefinitionId);
  for(let index=0;index<questions.length;index++){
    const question=questions[index],owner=atoms.get(largeAssessment.atomId);
    assert.equal(question.id,String(index+1));assert.equal(question.sourceDefinitionId,largeAssessment.atomId+'~'+key('q',index)+'@'+(index%3+1));
    assert.equal(question.courseraQuestionId,largeAssessment.atomId+'~'+key('g',index));assert.equal(owner.courseId,baseline.id);
    assert.deepEqual(question.options.filter(option=>option.correct).map(option=>option.sourceOptionId),['option-'+(index%3)]);
  }
  const checkbox=main.capture.fingerprints.find(fp=>fp.id==='item_0001');
  assert.equal(checkbox.captureContract.complete,true);assert.deepEqual(checkbox.payload.structuredAssessment.questions[0].answerKeyEvidence.correctOptions,['option-0','option-2']);
  const widget=main.capture.fingerprints.find(fp=>fp.id==='item_0002');assert.equal(widget.captureContract.complete,false);
  assert.equal(widget.captureContract.externalBodyVerified,false);assert(widget.payload.directDataSources.atom.elements[0].draft);
  assert.equal(evaluateCourseraCapture(main.capture,baseline.id).complete,false,'An unsupported widget prevents strict completion');
  const reading=main.capture.fingerprints.find(fp=>fp.id==='item_0003');assert.equal(reading.captureContract.complete,true);
  assert.match(reading.payload.textSample,/Bound reading body item_0003 café 日本語/);
  assert.equal(reading.payload.directDataSources.atom.elements[0].draft.content.definition.name,'Draft item_0003');
  assert.equal(reading.payload.directDataSources.atom.elements[0].published.content.definition.name,'Separate published snapshot');
  assert(main.capture.fingerprints.filter(fp=>fp.id.startsWith('empty_')).every(fp=>fp.captureContract.complete===true));
  await main.context.close();

  const success=await runFileCase(complete);assert.equal(success.state.state,'COMPLETE');
  const verdict=evaluateCourseraCapture(success.capture,complete.id);assert.equal(verdict.complete,true,JSON.stringify(verdict.reasons));
  for(const fp of success.capture.fingerprints.filter(fp=>fp.typeName==='staffGraded')){
    const question=fp.payload.structuredAssessment.questions[0];
    assert.equal(question.textFormat,'PLAIN_TEXT');
    assert.equal(question.prompt,'Keep <div> & literal Second paragraph 日本語');
    assert.equal(question.options[0].text,'<answer>');
    assert.equal(question.options[0].feedback,'Feedback <code> Second paragraph');
    assert(question.correctAnswers.includes('<answer>'));
    assert.equal(fp.payload.structuredAssessment.reviewCriteria.definition.value,'<co-content><p>Synthetic review criteria</p></co-content>');
  }
  async function recheckNativeCourse(target){
    await target.page.reload();await launch(target.page,target.context,false);
    const start=requests.length,downloading=target.page.waitForEvent('download',{timeout:180000});void downloading.catch(()=>{});
    await target.page.getByRole('button',{name:'Recheck native course content',exact:true}).click();
    const state=await terminal(target.page),capture=await readFile(await downloading);
    const mode=capture.meta.directDataCapture.nativeRecheck;
    assert.deepEqual(Object.keys(mode).sort(),['allMediaRefetched','externalRuntimeVerified','requestedAt','retainedDefinitionObservations','scope']);
    assert.equal(mode.scope,'ALL_NATIVE_ITEMS');assert(Number.isFinite(Date.parse(mode.requestedAt)));
    assert.equal(mode.retainedDefinitionObservations,true);assert.equal(mode.externalRuntimeVerified,false);assert.equal(mode.allMediaRefetched,false);
    assert.equal(capture.meta.directDataCapture.mediaEnrichment,undefined,'An explicit native recheck does not relabel itself as media-only enrichment');
    assertTransport(configs.get(capture.page.courseId),start);await assertNoEditor(target.page,target.destinations);
    return{state,capture,start};
  }
  const priorComplete=success.capture,priorDefinitionRows=(await savedNativeRun(success.page,success.state.runId)).definitions,
    initialAssessments=priorComplete.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),
    unchangedRecheck=await recheckNativeCourse(success),unchangedReads=requests.slice(unchangedRecheck.start).filter(request=>request.courseId===complete.id);
  assert.equal(unchangedRecheck.state.runId,success.state.runId,'An explicit native recheck can select the saved COMPLETE run for the unchanged course graph');
  assert.equal(unchangedRecheck.state.state,'COMPLETE');assert.equal(evaluateCourseraCapture(unchangedRecheck.capture,complete.id).complete,true);
  assert.equal(unchangedReads.filter(request=>request.resource===definitionResource).length,0,
    'Exact versioned definitions reuse their independently checked original checkpoint instead of being downloaded again');
  for(const prior of priorComplete.fingerprints.filter(fp=>fp.atomId)){
    assert.equal(unchangedReads.filter(request=>request.resource==='authoringAtoms.v2'&&request.reference===prior.atomId).length,2,
      'Every saved native item receives initial and final atom reads');
    assert.equal(unchangedReads.filter(request=>request.resource==='authoringItemContentRelations.v1'&&request.reference===prior.atomId).length,1);
    const current=unchangedRecheck.capture.fingerprints.find(fp=>fp.id===prior.id);
    assert(Date.parse(current.payload.directDataSources.receipts.atom.observedAt)>Date.parse(prior.payload.directDataSources.receipts.atom.observedAt));
    assert.deepEqual(current.payload.directDataSources.atom.elements[0].published,prior.payload.directDataSources.atom.elements[0].published,
      'A separate published snapshot stays original evidence rather than becoming current published-body verification');
  }
  for(const prior of initialAssessments){
    const current=unchangedRecheck.capture.fingerprints.find(fp=>fp.id===prior.id),before=prior.payload.assessmentApiEvidence,after=current.payload.assessmentApiEvidence;
    // Raw definitions are an exact-ID evidence inventory populated by async
    // workers; authored group/question order is checked independently below.
    const beforeDefinitions=new Map(before.questionDefinitions.map(definition=>[definition.id,definition])),
      afterDefinitions=new Map(after.questionDefinitions.map(definition=>[definition.id,definition]));
    assert.equal(after.questionDefinitions.length,before.questionDefinitions.length);
    assert.equal(beforeDefinitions.size,before.questionDefinitions.length);assert.equal(afterDefinitions.size,after.questionDefinitions.length);
    assert.deepEqual(new Set(afterDefinitions.keys()),new Set(beforeDefinitions.keys()));
    for(const [id,definition]of afterDefinitions)assert.deepEqual(definition,beforeDefinitions.get(id),
      'Each exact definition retains its complete original model, including authored option order, regardless of worker arrival order');
    assert.deepEqual(current.payload.structuredAssessment.questions,prior.payload.structuredAssessment.questions,
      'Reused exact definitions preserve normalized question content and original observation dates');
    for(const original of before.receipts.filter(value=>value.resource===definitionResource))
      assert.deepEqual(after.receipts.find(value=>value.resource===definitionResource&&value.id===original.id),original);
    for(const group of before.groups){
      assert.equal(unchangedReads.filter(request=>request.resource===groupResource&&request.reference===group.id).length,1,
        'Even an unchanged completed assessment gets one actual current mutable-group read');
      const old=before.groupStability.find(value=>value.id===group.id),fresh=after.groupStability.find(value=>value.id===group.id);
      assert.equal(fresh.stable,true);assert(Date.parse(fresh.receipt.observedAt)>Date.parse(old.receipt.observedAt));
    }
  }
  assert.deepEqual((await savedNativeRun(success.page,success.state.runId)).definitions,priorDefinitionRows,
    'The exact cached definition models, hashes and receipt dates are not rewritten by native recheck');
  assert.equal(unchangedReads.filter(request=>request.resource==='authoringCourseMaterials.v1').length,2);
  assert(unchangedRecheck.capture.meta.directDataCapture.stats.requests>priorComplete.meta.directDataCapture.stats.requests);
  assert.equal(unchangedRecheck.capture.meta.directDataCapture.stats.limits.concurrentRequests,4);

  const editedNativeGroup=[...groups.values()].find(row=>row.courseId===complete.id),
    oldNativeDefinitionId=editedNativeGroup.value.questions[0],oldNativeDefinition=definitions.get(oldNativeDefinitionId),
    newNativeDefinitionId=oldNativeDefinitionId.replace(/@\d+$/,value=>'@'+(Number(value.slice(1))+1));
  definitions.set(newNativeDefinitionId,{...oldNativeDefinition,value:{...oldNativeDefinition.value,id:newNativeDefinitionId,
    definition:{...oldNativeDefinition.value.definition,definition:{...oldNativeDefinition.value.definition.definition,
      prompt:cml('New exact version observed by native recheck 日本語')}}}});
  editedNativeGroup.value.questions[0]=newNativeDefinitionId;
  const editedNativeReading=[...atoms.values()].find(row=>row.courseId===complete.id&&row.itemId==='item_0002');
  editedNativeReading.atom.draft.content.definition.content=cml('Native reading changed after the saved complete capture 日本語','supplement/1');
  editedNativeReading.atom.storedAtomVersion++;editedNativeReading.atom.metadata.updatedAt++;
  const changedNativeRecheck=await recheckNativeCourse(success),changedNativeReads=requests.slice(changedNativeRecheck.start).filter(request=>request.courseId===complete.id),
    newNativeAssessment=changedNativeRecheck.capture.fingerprints.find(fp=>fp.id===editedNativeGroup.itemId);
  assert.equal(changedNativeRecheck.state.runId,success.state.runId);assert.equal(changedNativeRecheck.state.state,'COMPLETE');
  assert.equal(evaluateCourseraCapture(changedNativeRecheck.capture,complete.id).complete,true);
  assert.deepEqual(changedNativeReads.filter(request=>request.resource===definitionResource).map(request=>request.reference),[newNativeDefinitionId],
    'Only the newly referenced exact definition version receives a fresh GET');
  assert.equal(changedNativeReads.filter(request=>request.resource===groupResource&&request.reference===editedNativeGroup.value.id).length,2,
    'A changed mutable group receives the two current consistency reads before its new definition is accepted');
  assert(newNativeAssessment.payload.assessmentApiEvidence.questionDefinitions.some(value=>value.id===newNativeDefinitionId));
  assert(!newNativeAssessment.payload.assessmentApiEvidence.questionDefinitions.some(value=>value.id===oldNativeDefinitionId));
  const newNativeQuestion=newNativeAssessment.payload.structuredAssessment.questions.find(question=>question.prompt==='New exact version observed by native recheck 日本語');
  assert(newNativeQuestion);assert(newNativeQuestion.observedAtMs>Math.max(...initialAssessments.flatMap(fp=>fp.payload.structuredAssessment.questions.map(question=>question.observedAtMs))));
  assert.equal(changedNativeRecheck.capture.fingerprints.find(fp=>fp.id==='item_0002').payload.directDraftCml.definition.value,
    editedNativeReading.atom.draft.content.definition.content.definition.value,'Native recheck reads the changed source body rather than retaining the old reading');

  complete.nativeRecheckAtomErrorId=newNativeAssessment.atomId;
  const failedNativeRecheck=await recheckNativeCourse(success),failedNativeAssessment=failedNativeRecheck.capture.fingerprints.find(fp=>fp.id===newNativeAssessment.id);
  assert.equal(failedNativeRecheck.state.runId,success.state.runId);assert.equal(failedNativeRecheck.state.state,'INCOMPLETE');
  assert.equal(failedNativeAssessment.captureContract.complete,false);assert.equal(failedNativeAssessment.payload.directResumeRevalidation.verified,false);
  assert.deepEqual(failedNativeAssessment.payload.assessmentApiEvidence,newNativeAssessment.payload.assessmentApiEvidence,
    'A failed current atom request preserves the exact prior raw assessment models and source receipts as history');
  assert.deepEqual(failedNativeAssessment.payload.structuredAssessment,newNativeAssessment.payload.structuredAssessment);
  assert.equal(failedNativeRecheck.capture.meta.directDataCapture.coverage.assessments.verified,1);
  assert.equal(evaluateCourseraCapture(failedNativeRecheck.capture,complete.id).complete,false);
  assert.equal(requests.slice(failedNativeRecheck.start).filter(request=>request.courseId===complete.id&&request.resource===definitionResource).length,0);
  delete complete.nativeRecheckAtomErrorId;
  const oldNativeRun=await savedNativeRun(success.page,success.state.runId),freshNativeStart=requests.length,
    freshNativeDownload=success.page.waitForEvent('download',{timeout:180000});void freshNativeDownload.catch(()=>{});
  await success.page.getByRole('button',{name:'Start a fresh course capture',exact:true}).click();
  const freshNativeState=await terminal(success.page),freshNativeCapture=await readFile(await freshNativeDownload);
  assert.notEqual(freshNativeState.runId,success.state.runId);assert.equal(freshNativeState.state,'COMPLETE');
  assert.equal(freshNativeCapture.meta.directDataCapture.nativeRecheck,undefined);
  assert.equal(freshNativeCapture.meta.directDataCapture.resumed,false);assert.equal(freshNativeCapture.meta.directDataCapture.stats.inheritedBudget.requests,0);
  assert.equal(requests.slice(freshNativeStart).filter(request=>request.courseId===complete.id&&request.resource===definitionResource).length,10,
    'The separate fresh action still acquires every current definition under an independent budget');
  assert.deepEqual(await savedNativeRun(success.page,success.state.runId),oldNativeRun,'Fresh capture does not mutate the earlier rechecked run or its retained raw history');
  assertTransport(complete,freshNativeStart);await assertNoEditor(success.page,success.destinations);
  const priorFreshNativeRun=await savedNativeRun(success.page,freshNativeState.runId);
  complete.material.material.elements.push({id:'empty_native_recheck',name:'New explicit empty source module',elements:[],description:'',learningObjectives:[],timeCommitment:0});
  const changedGraphRecheck=await recheckNativeCourse(success);
  assert.notEqual(changedGraphRecheck.state.runId,freshNativeState.runId);assert.notEqual(changedGraphRecheck.state.runId,success.state.runId);
  assert.equal(changedGraphRecheck.state.state,'COMPLETE');assert.equal(changedGraphRecheck.capture.meta.directDataCapture.resumed,false);
  const changedGraphReads=requests.slice(changedGraphRecheck.start).filter(request=>request.courseId===complete.id),
    changedGraphProof=changedGraphRecheck.capture.meta.directDataCapture,changedGraphStats=changedGraphProof.stats;
  assert.deepEqual(changedGraphReads.slice(0,2).map(request=>request.resource).sort(),['authoringCourseMaterials.v1','authoringCourses.v2'].sort());
  assert.equal(changedGraphStats.inheritedBudget.requests,2,
    'A changed graph starts a separate run while charging its two current discovery reads, rather than inheriting the earlier run\'s spend');
  assert.equal(changedGraphStats.inheritedBudget.bytes,changedGraphProof.materialsReceipt.bytes+changedGraphProof.courseReceipt.bytes);
  assert.equal(changedGraphStats.currentAttempt.requests,changedGraphReads.length-2);
  assert.equal(changedGraphStats.requests,changedGraphReads.length,'The new run charges each observed discovery and capture GET exactly once');
  assert.equal(changedGraphRecheck.capture.fingerprints.length,5);assert(changedGraphRecheck.capture.fingerprints.some(fp=>fp.id==='empty_native_recheck'&&fp.captureContract.complete));
  assert.equal(requests.slice(changedGraphRecheck.start).filter(request=>request.courseId===complete.id&&request.resource===definitionResource).length,10,
    'A changed native course graph keeps the existing independent-run behavior and acquires its own exact definitions');
  assert.deepEqual(await savedNativeRun(success.page,freshNativeState.runId),priorFreshNativeRun);
  assert.deepEqual(await savedNativeRun(success.page,success.state.runId),oldNativeRun,'Graph changes preserve both earlier runs with their original source observations');
  assert.equal(success.downloads.length,6,'Initial capture, four explicit native rechecks and one fresh capture each export exactly one ZIP');
  await success.context.close();

  const unvisitedTarget=await runFileCase(nativeUnvisitedRecheck);
  assert.equal(unvisitedTarget.state.state,'COMPLETE');assert.equal(unvisitedTarget.capture.meta.directDataCapture.coverage.readings.verified,2);
  const unvisitedOriginals=unvisitedTarget.capture.fingerprints.filter(fp=>fp.atomId);
  assert.equal(unvisitedOriginals.length,2);
  const narrowSavedBudget=await unvisitedTarget.page.evaluate(async runId=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const saved=await new Promise((resolve,reject)=>{const transaction=database.transaction('runs','readwrite'),store=transaction.objectStore('runs'),request=store.getAll();let result;
      request.onsuccess=()=>{const row=request.result.find(value=>value.runId===runId);
        if(row?.state!=='COMPLETE'||!row.captureMeta.directDataCapture.wholeCourseVerified)throw Error('Expected a verified completed reading fixture');
        row.budget.requests=row.budget.limits.requests-2;store.put(row);
        result={runId:row.runId,requests:row.budget.requests,limit:row.budget.limits.requests};};
      transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('Narrow saved-budget seed aborted'));
    });database.close();return saved;
  },unvisitedTarget.state.runId);
  assert(narrowSavedBudget.requests>0&&narrowSavedBudget.requests<narrowSavedBudget.limit,
    'Only prior spent accounting is seeded; the saved run retains unspent eligibility and its original global request ceiling');
  const unvisitedAttempt=await recheckNativeCourse(unvisitedTarget),unvisitedReads=requests.slice(unvisitedAttempt.start).filter(request=>request.courseId===nativeUnvisitedRecheck.id);
  assert.equal(unvisitedAttempt.state.runId,narrowSavedBudget.runId);assert.equal(unvisitedAttempt.state.state,'INCOMPLETE');
  assert.equal(unvisitedAttempt.capture.meta.directDataCapture.stopReason,'COURSE_API_REQUEST_LIMIT');
  assert.equal(unvisitedAttempt.capture.meta.directDataCapture.stats.requests,narrowSavedBudget.limit);
  assert.equal(unvisitedReads.length,2);assert(unvisitedReads.every(request=>['authoringCourseMaterials.v1','authoringCourses.v2'].includes(request.resource)),
    'The two remaining native requests read inventory roots; neither retained reading receives a current atom response');
  function assertUnvisitedReadings(capture){
    assert.equal(capture.meta.directDataCapture.coverage.readings.verified,0);
    assert.equal(capture.meta.directDataCapture.wholeCourseVerified,false);assert.equal(evaluateCourseraCapture(capture,nativeUnvisitedRecheck.id).complete,false);
    for(const original of unvisitedOriginals){
      const current=capture.fingerprints.find(fp=>fp.id===original.id);assert(current);
      assert.equal(current.captureContract.complete,false);assert.equal(current.payload.directResumeRevalidation.verified,false);
      assert.deepEqual(current.payload.directDataSources,original.payload.directDataSources,
        'A pending or failed current attempt retains the exact older native model and original receipt dates without certifying them as current');
      assert.deepEqual(current.payload.directDraftCml,original.payload.directDraftCml);
      assert.equal(current.payload.textSample,original.payload.textSample);
    }
  }
  assertUnvisitedReadings(unvisitedAttempt.capture);
  const unvisitedSecond=unvisitedAttempt.capture.fingerprints.find(fp=>fp.id===unvisitedOriginals[1].id);
  assert.equal(unvisitedSecond.payload.directResumeRevalidation.reason,'DIRECT_NATIVE_RECHECK_NOT_READ');
  assert.notEqual(unvisitedSecond.payload.directNativeRecheckRequestedAt,unvisitedAttempt.capture.meta.directDataCapture.nativeRecheck.requestedAt,
    'An unvisited reading has no current attempt stamp merely because its old proof was hydrated');
  const unvisitedSaved=await savedNativeRun(unvisitedTarget.page,narrowSavedBudget.runId);
  for(const original of unvisitedOriginals){
    const row=unvisitedSaved.items.find(value=>value.itemId===original.id);assert.equal(row.fingerprint.captureContract.complete,false);
  }
  await unvisitedTarget.page.reload();await launch(unvisitedTarget.page,unvisitedTarget.context,false);
  const unvisitedResumeStart=requests.length,unvisitedResumeDownload=unvisitedTarget.page.waitForEvent('download',{timeout:180000});void unvisitedResumeDownload.catch(()=>{});
  await unvisitedTarget.page.getByRole('button',{name:'Capture/resume course',exact:true}).click();
  const unvisitedResumeState=await terminal(unvisitedTarget.page),unvisitedResumed=await readFile(await unvisitedResumeDownload);
  if(unvisitedResumeState.runId===narrowSavedBudget.runId){
    assertUnvisitedReadings(unvisitedResumed);assert.notEqual(unvisitedResumeState.state,'COMPLETE');
  }else{
    assert.equal(unvisitedResumed.meta.directDataCapture.resumed,false);assert.equal(unvisitedResumed.meta.directDataCapture.stats.inheritedBudget.requests,0);
    for(const original of unvisitedOriginals){
      const native=requests.slice(unvisitedResumeStart).filter(request=>request.courseId===nativeUnvisitedRecheck.id&&request.reference===original.atomId);
      assert.equal(native.filter(request=>request.resource==='authoringAtoms.v2').length,2);
      assert.equal(native.filter(request=>request.resource==='authoringItemContentRelations.v1').length,1);
      const current=unvisitedResumed.fingerprints.find(fp=>fp.id===original.id);
      assert(Date.parse(current.payload.directDataSources.receipts.atom.observedAt)>Date.parse(original.payload.directDataSources.receipts.atom.observedAt),
        'A separate post-limit run can verify a reading only after actual fresh native observations');
    }
  }
  const reopenedUnvisited=await savedNativeRun(unvisitedTarget.page,narrowSavedBudget.runId);
  for(const original of unvisitedOriginals){
    const row=reopenedUnvisited.items.find(value=>value.itemId===original.id);assert.equal(row.fingerprint.captureContract.complete,false);
    assert.deepEqual(row.fingerprint.payload.directDataSources,original.payload.directDataSources);
    assert.deepEqual(row.fingerprint.payload.directDraftCml,original.payload.directDraftCml);
  }
  assert.equal(reopenedUnvisited.runs[0].captureMeta.directDataCapture.coverage.readings.verified,0,
    'Reopening and ordinary Resume cannot resurrect the exhausted run\'s withdrawn completion flags');
  if(unvisitedResumeState.runId!==narrowSavedBudget.runId)assert.deepEqual(reopenedUnvisited,unvisitedSaved);
  assert.equal(unvisitedTarget.downloads.length,3);
  if(requests.slice(unvisitedResumeStart).some(request=>request.courseId===nativeUnvisitedRecheck.id))assertTransport(nativeUnvisitedRecheck,unvisitedResumeStart);
  await assertNoEditor(unvisitedTarget.page,unvisitedTarget.destinations);await unvisitedTarget.context.close();

  const sourceDigest=value=>createHash('sha256').update(directCanonicalSourceTextV1(value)).digest('hex');
  function fixtureNativeObservation(model){
    const value=structuredClone(model);delete value.writeAccessToken;
    if(value.nested)delete value.nested.accessToken;
    return{elements:[value],paging:{},linked:{}};
  }
  function assertPublishedDraftSnapshot(config,capture,start){
    const fp=capture.fingerprints.find(item=>item.id==='item_0000'),snapshot=fp.payload.directAuthoringDraftSnapshot,
      original=atoms.get(config.snapshotAtomId),native=requests.slice(start).filter(request=>request.courseId===config.id),
      own=request=>request.reference===fp.atomId||request.reference?.startsWith(fp.atomId+'~');
    assert.equal(fp.captureContract.complete,false);assert.equal(evaluateCourseraCapture(capture,config.id).complete,false);
    assert.equal(fp.payload.structuredAssessment,undefined,'An attached draft never becomes the current published assessment');
    assert.equal(fp.payload.assessmentApiEvidence,undefined,'Supplemental draft definitions do not enter the primary assessment evidence');
    assert.equal(capture.meta.directDataCapture.coverage.questions,1,'Only the separate current-draft quiz supplies primary question occurrences');
    assert.equal(capture.meta.directDataCapture.coverage.assessments.verified,1);
    assert.equal(fp.payload.directDataSources.atom.elements[0].status.typeName,'publishedAtomStatus');
    if(config.snapshotMode==='forged-pointer'){
      assert.equal(snapshot,undefined);assert.equal(courseraAuthoringDraftSnapshot(fp,config.id),null);
      assert.equal(native.filter(request=>own(request)&&[groupResource,definitionResource].includes(request.resource)).length,0,
        'A mismatched material published pointer cannot schedule even the first draft group or definition read');
      return null;
    }
    assert(snapshot);assert.equal(snapshot.method,'BOUND_PUBLISHED_ATOM_DRAFT_SNAPSHOT');
    assert.equal(snapshot.sourceState,'AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM');
    assert.equal(snapshot.courseId,config.id);assert.equal(snapshot.itemId,fp.id);assert.equal(snapshot.atomId,fp.atomId);
    assert.equal(snapshot.contentId,fp.contentId);assert.equal(snapshot.publishedAssignmentId,original.atom.published.content.definition.assignmentId);
    assert.equal(snapshot.sourceStable,config.snapshotMode!=='source-changed');
    for(const field of ['publishedContentVerified','contentCompletenessVerified','wholeItemVerified'])assert.equal(snapshot[field],false);
    assert.deepEqual(snapshot.source.initialAtom.data,fixtureNativeObservation(original.atom),'Full original sanitized atom includes the draft, published pointer and unknown source fields');
    assert.deepEqual(snapshot.source.relation.data,fixtureNativeObservation(original.relation));
    assert.deepEqual(snapshot.source.initialAtom.receipt,fp.payload.directDataSources.receipts.atom);
    assert.deepEqual(snapshot.source.relation.receipt,fp.payload.directDataSources.receipts.relation);
    const bound=bindDirectPublishedDraftSnapshotV1(fp,config.id,slug,snapshot.source.material,snapshot.source.initialAtom.data,snapshot.source.relation.data);
    assert.deepEqual(snapshot.inventory,directPublishedDraftSnapshotInventoryV1(bound));
    assert.equal(snapshot.sourceSha256,sourceDigest(directPublishedDraftSnapshotSourceV1(bound)));
    assert.deepEqual(snapshot.inventory.rawParts,original.atom.draft.content.definition.parts);assert.equal(snapshot.inventory.declared,9);
    const uniqueDefinitionIds=new Set(snapshot.inventory.candidates.map(candidate=>groups.get(candidate.id).value.questions[0])),
      expectedRetainedDefinitions=uniqueDefinitionIds.size-(config.snapshotDefinitionErrorId?1:0);
    assert.equal(snapshot.groups.length,9);assert.equal(snapshot.definitions.length,expectedRetainedDefinitions);assert.equal(snapshot.inventory.unsupportedParts.length,0);
    assert.equal(native.filter(request=>request.resource==='authoringAtoms.v2'&&own(request)).length,2);
    assert.equal(native.filter(request=>request.resource==='authoringItemContentRelations.v1'&&own(request)).length,1);
    assert.equal(native.filter(request=>request.resource===groupResource&&own(request)).length,18,'Each literal draft group gets one initial and one fresh final read');
    assert.equal(native.filter(request=>request.resource===definitionResource&&own(request)).length,uniqueDefinitionIds.size,'Each distinct exact versioned draft definition gets one fresh read');
    const first=Math.max(Date.parse(snapshot.source.initialAtom.receipt.observedAt),Date.parse(snapshot.source.relation.receipt.observedAt)),
      last=Date.parse(snapshot.source.finalAtom.receipt.observedAt);
    assert(Number.isFinite(first)&&Number.isFinite(last)&&last>=first);
    for(const observation of [snapshot.source.initialAtom,snapshot.source.relation,snapshot.source.finalAtom,
      ...snapshot.groups.flatMap(group=>[group.initial,group.final]),...snapshot.definitions]){
      assert.equal(observation.sourceSha256,sourceDigest(observation.data));
      assert.equal(observation.receipt.status,200);assert.equal(observation.receipt.bodyFormat,'PARSED_SANITIZED_JSON_MODEL');
      assert.equal(observation.receipt.sha256,observation.receipt.originalResponseSha256);
    }
    for(const candidate of snapshot.inventory.candidates){
      const pair=snapshot.groups.find(group=>group.id===candidate.id),sourceGroup=groups.get(candidate.id).value,
        definitionId=sourceGroup.questions[0],definition=snapshot.definitions.find(value=>value.id===definitionId),
        sourceDefinition=definitions.get(definitionId).value;
      assert(pair);assert.deepEqual(pair.initial.data,fixtureNativeObservation(sourceGroup));
      assert.equal(pair.initial.receipt.id,candidate.id);assert.equal(pair.final.receipt.id,candidate.id);
      assert.equal(native.filter(request=>request.resource===groupResource&&request.reference===candidate.id).length,2);
      assert.equal(native.filter(request=>request.resource===definitionResource&&request.reference===definitionId).length,1);
      const initialTime=Date.parse(pair.initial.receipt.observedAt),finalTime=Date.parse(pair.final.receipt.observedAt);
      assert(initialTime>=first&&finalTime>=initialTime&&last>=finalTime);
      if(config.snapshotDefinitionErrorId===definitionId){
        assert.equal(definition,undefined);
        assert.equal(snapshot.failures.filter(failure=>failure.scope==='DEFINITION'&&failure.id===definitionId).length,1,
          'A failed shared exact-version definition produces one owned failure without duplicate triples');
      }else{
        assert(definition);assert.deepEqual(definition.data,fixtureNativeObservation(sourceDefinition),'Every original native definition field survives credential stripping');
        const originalDefinitionJson=JSON.stringify({elements:[sourceDefinition],paging:{},linked:{}});
        assert.equal(definition.receipt.originalResponseSha256,createHash('sha256').update(originalDefinitionJson).digest('hex'));
        assert.equal(definition.receipt.bytes,Buffer.byteLength(originalDefinitionJson));assert.equal(definition.receipt.id,definitionId);
        assert.equal(definition.receipt.requestPath,'/api/'+definitionResource+'/'+definitionId);
        const definitionTime=Date.parse(definition.receipt.observedAt),owningGroups=snapshot.groups.filter(group=>group.initial.data.elements[0].questions.includes(definitionId));
        assert(definitionTime>=first&&definitionTime<=last&&owningGroups.some(group=>definitionTime>=Date.parse(group.initial.receipt.observedAt)&&definitionTime<=Date.parse(group.final.receipt.observedAt)),
          'Each exact-version definition has a real read witness in at least one owning group interval and the enclosing atom interval');
      }
      const changed=config.snapshotMode==='group-changed'&&candidate.id===config.snapshotFirstGroupId;
      assert.equal(pair.initial.sourceSha256===pair.final.sourceSha256,!changed);
      if(changed){assert.equal(pair.initial.data.elements[0].scoringWeight,1);assert.equal(pair.final.data.elements[0].scoringWeight,2);}
      else assert.deepEqual(pair.final.data,pair.initial.data);
    }
    if(config.snapshotMode==='source-changed'){
      assert.notEqual(snapshot.source.finalAtom.sourceSha256,snapshot.source.initialAtom.sourceSha256);
      assert.equal(snapshot.source.finalAtom.data.elements[0].published.content.definition.assignmentId,snapshot.publishedAssignmentId.replace('@2','@3'));
      assert(snapshot.failures.some(failure=>failure.scope==='SOURCE'&&failure.id===fp.atomId));
    }else if(config.snapshotMode==='group-changed')assert(snapshot.failures.some(failure=>failure.scope==='GROUP'&&failure.id===config.snapshotFirstGroupId));
    else if(config.snapshotDefinitionErrorId)assert.equal(snapshot.failures.filter(failure=>failure.scope==='DEFINITION'&&failure.id===config.snapshotDefinitionErrorId).length,1);
    else assert.deepEqual(snapshot.failures,[]);
    assert.equal(new Set(snapshot.failures.map(failure=>JSON.stringify(failure))).size,snapshot.failures.length,'Snapshot failure triples remain distinct');
    if(config.snapshotSharedDefinition){
      const earlier=snapshot.groups.find(group=>group.id===config.snapshotFirstGroupId),later=snapshot.groups.find(group=>group.id===config.snapshotSecondGroupId);
      assert(Date.parse(later.initial.receipt.observedAt)>Date.parse(earlier.final.receipt.observedAt),
        'The real bounded one-read pool schedules the second owning group after the first closes, proving shared reads across non-overlapping ownership intervals');
      assert.equal(native.filter(request=>request.resource===definitionResource&&request.reference===config.snapshotSharedDefinitionId).length,1);
    }
    const report=courseraAuthoringDraftSnapshot(fp,config.id);assert(report,'The independent domain verifier accepts only owned and hash-bound source observations');
    assert.equal(report.sourceStability,config.snapshotMode==='source-changed'?'CHANGED':'STABLE');
    assert.equal(report.draftConfiguration.isGraded,false);assert.equal(report.draftConfiguration.isGradedStatus,'RECORDED');
    assert.equal(report.parts.length,9);assert.equal(report.parts.filter(part=>part.definition).length,config.snapshotDefinitionErrorId?7:9);
    assert.equal(report.parts[0].group.status,config.snapshotMode==='group-changed'?'CHANGED':'STABLE');
    assert.equal(report.parts.at(-1).definition.nativeType,'numeric');assert.equal(report.parts.at(-1).definition.readableChoices,null);
    assert.deepEqual(JSON.parse(report.parts.at(-1).definition.originalModelJson),fixtureNativeObservation(definitions.get(snapshot.definitions.at(-1).id).value).elements[0]);
    if(config.snapshotSharedDefinition&&!config.snapshotDefinitionErrorId){
      assert.equal(report.parts[0].definition.id,report.parts[1].definition.id);
      assert.equal(report.parts[0].definition.originalModelSha256,report.parts[1].definition.originalModelSha256);
    }
    for(const field of ['publishedContentVerified','contentCompletenessVerified','wholeItemVerified'])assert.equal(report[field],false);
    const savedPath=path.join(scratch,config.id+'-draft-snapshot-report.json');fs.writeFileSync(savedPath,JSON.stringify(report));
    const reloaded=JSON.parse(fs.readFileSync(savedPath,'utf8'));validateCourseraAuthoringDraftSnapshot(reloaded,fp.id,config.id);assert.deepEqual(reloaded,report);
    const output=courseraAuthoringDraftSnapshotText(reloaded);
    assert.match(output,/DRAFT SNAPSHOT ON PUBLISHED ITEM; CURRENT PUBLISHED BODY UNVERIFIED/);
    assert(output.includes(snapshot.publishedAssignmentId)&&output.includes(snapshot.sourceSha256)&&output.includes('Original numeric draft prompt'));
    assert(output.includes('Literal attached draft field 日本語'));
    const forged=structuredClone(fp);forged.payload.directAuthoringDraftSnapshot.source.material.content.definition.assignmentId=snapshot.publishedAssignmentId.replace('@2','@9');
    assert.equal(courseraAuthoringDraftSnapshot(forged,config.id),null,'A serialized pointer rewrite cannot turn a foreign source into supplemental evidence');
    return report;
  }
  async function assertFailedDraftSnapshotResume(result,config){
    const previousFp=result.capture.fingerprints.find(fp=>fp.id==='item_0000'),prior=structuredClone(previousFp.payload.directAuthoringDraftSnapshot),
      priorView=courseraAuthoringDraftSnapshot(previousFp,config.id),primary=result.capture.fingerprints.find(fp=>fp.id==='item_0001'),
      before=await checkpointSnapshot(result.page);
    assert(priorView);assert.equal(prior.sourceStable,true);assert.equal(prior.definitions.length,9);
    assert(prior.failures.some(failure=>failure.scope==='GROUP'&&failure.id===config.snapshotFirstGroupId),
      'A naturally changed final group leaves an independently valid partial snapshot that needs an explicit fresh continuation');
    config.snapshotAllDefinitionsFail=true;
    const start=requests.length,downloading=result.page.waitForEvent('download',{timeout:180000});void downloading.catch(()=>{});
    await result.page.reload();await launch(result.page,result.context);const state=await terminal(result.page),capture=await readFile(await downloading),
      fp=capture.fingerprints.find(value=>value.id==='item_0000'),current=fp.payload.directAuthoringDraftSnapshot,
      history=fp.payload.directAuthoringDraftSnapshotHistory;
    assert.equal(state.runId,result.state.runId);assert.equal(state.state,'INCOMPLETE');assert.equal(state.counts.questions,1);
    assert(current);assert.equal(current.definitions.length,0,'A failed current read never borrows earlier native definitions into its current snapshot');
    assert.equal(current.groups.length,9);assert.equal(current.sourceStable,true);assert.equal(fp.captureContract.complete,false);
    assert.equal(current.failures.filter(failure=>failure.scope==='DEFINITION').length,9);
    assert.equal(new Set(current.failures.map(failure=>JSON.stringify(failure))).size,current.failures.length);
    assert.deepEqual(history,[prior],'A failed explicit continuation retains the complete earlier raw draft snapshot and every original observation date');
    assert(history.every(value=>!Object.hasOwn(value,'history')&&!Object.hasOwn(value,'earlierDraftObservations')&&!Object.hasOwn(value,'directAuthoringDraftSnapshotHistory')),
      'Raw earlier observations remain a flat array of original source records');
    assert.notEqual(current.source.initialAtom.receipt.observedAt,prior.source.initialAtom.receipt.observedAt);
    const report=courseraAuthoringDraftSnapshot(fp,config.id);assert(report);assert.equal(report.parts.filter(part=>part.definition).length,0);
    assert.equal(report.earlierDraftObservations.length,1);const earlier=report.earlierDraftObservations[0];
    assert.equal(earlier.parts.filter(part=>part.definition).length,9);assert.deepEqual(earlier.parts,priorView.parts);
    assert.equal(earlier.sourceSha256,priorView.sourceSha256);assert.equal(earlier.initialAtom.observedAt,priorView.initialAtom.observedAt);
    assert.equal(earlier.earlierDraftObservations,undefined);
    for(const view of [report,earlier])for(const field of ['publishedContentVerified','contentCompletenessVerified','wholeItemVerified'])assert.equal(view[field],false);
    const saved=path.join(scratch,config.id+'-failed-resume-report.json');fs.writeFileSync(saved,JSON.stringify(report));
    const reloaded=JSON.parse(fs.readFileSync(saved,'utf8'));validateCourseraAuthoringDraftSnapshot(reloaded,fp.id,config.id);assert.deepEqual(reloaded,report);
    const output=courseraAuthoringDraftSnapshotText(reloaded);assert.match(output,/Earlier draft observation/i);assert(output.includes('Original numeric draft prompt'));
    const native=requests.slice(start).filter(request=>request.courseId===config.id);
    assert.equal(native.filter(request=>request.resource===groupResource&&request.reference.startsWith(config.snapshotAtomId+'~')).length,18);
    assert.equal(native.filter(request=>request.resource===definitionResource&&request.reference.startsWith(config.snapshotAtomId+'~')).length,9);
    assert(!native.some(request=>[groupResource,definitionResource].includes(request.resource)&&!request.reference.startsWith(config.snapshotAtomId+'~')));
    const after=await checkpointSnapshot(result.page);
    assert.deepEqual(after.items.find(row=>row.itemId==='item_0001'),before.items.find(row=>row.itemId==='item_0001'));
    assert.deepEqual(capture.fingerprints.find(value=>value.id==='item_0001'),primary,'Failed supplemental refresh preserves primary native answers and original observation timestamps');
    assert.deepEqual(after.groups,before.groups);assert.deepEqual(after.definitions,before.definitions);assert.deepEqual(after.bodies,before.bodies);
    assert.deepEqual(after.items.find(row=>row.itemId==='item_0000').fingerprint.payload.directAuthoringDraftSnapshotHistory,[prior]);
    assert.equal(evaluateCourseraCapture(capture,config.id).complete,false);assert.equal(result.downloads.length,2);
    await assertNoEditor(result.page,result.destinations);
  }
  for(const config of [publishedDraftSnapshot,publishedDraftSourceChanged,publishedDraftGroupChanged,publishedDraftForgedPointer,
    publishedDraftSharedDefinition,publishedDraftSharedError]){
    const result=await runFileCase(config);assert.equal(result.state.state,'INCOMPLETE');assert.equal(result.state.counts.questions,1);
    assertPublishedDraftSnapshot(config,result.capture,result.start);
    if(config!==publishedDraftSnapshot){
      if(config===publishedDraftGroupChanged)await assertFailedDraftSnapshotResume(result,config);
      await result.context.close();continue;
    }
    const originalPrimary=result.capture.fingerprints.find(fp=>fp.id==='item_0001'),before=await checkpointSnapshot(result.page),
      historical={version:'1.8.6',buildId:'v1.8.6-publisher-back-matter-20261019'};
    assert(Number.isFinite(originalPrimary.payload.structuredAssessment.questions[0].observedAtMs),'The primary native question has its original observation date');
    await result.page.evaluate(async historical=>{
      const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','items'],'readwrite'),runs=transaction.objectStore('runs'),items=transaction.objectStore('items');
        const rr=runs.getAll();rr.onsuccess=()=>{for(const run of rr.result){
          if(run.state!=='INCOMPLETE'||run.counts.processed!==run.counts.total||run.captureMeta.directDataCapture.acquisitionComplete!==true)throw Error('Expected a completed native run before historical snapshot upgrade');
          run.buildId=historical.buildId;run.captureMeta.buildId=historical.buildId;run.captureMeta.extractor='CTI Direct Course Capture v'+historical.version;
          if(run.captureMeta.directDataCapture.coverage)delete run.captureMeta.directDataCapture.coverage.retainedDraftSnapshots;
          runs.put(run);
        }};
        const ir=items.getAll();ir.onsuccess=()=>{for(const row of ir.result)if(row.itemId==='item_0000'){
          delete row.fingerprint.payload.directAuthoringDraftSnapshot;delete row.state.retainedDraftSnapshot;delete row.state.retainedDraftDefinitionCount;items.put(row);
        }};
        transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('Historical checkpoint seed aborted'));
      });database.close();
    },historical);
    const historicalBefore=await checkpointSnapshot(result.page),historicalPrimary=historicalBefore.items.find(row=>row.itemId==='item_0001');
    assert.equal(historicalBefore.runs[0].buildId,historical.buildId);
    assert.equal(historicalBefore.items.find(row=>row.itemId==='item_0000').fingerprint.payload.directAuthoringDraftSnapshot,undefined);
    assert.deepEqual(historicalPrimary,before.items.find(row=>row.itemId==='item_0001'));
    assert(historicalBefore.groups.length>0&&historicalBefore.definitions.length>0,'The historical checkpoint retains independently acquired primary question sources');
    const resumeStart=requests.length,downloading=result.page.waitForEvent('download',{timeout:180000});void downloading.catch(()=>{});
    await result.page.reload();await launch(result.page,result.context);const resumedState=await terminal(result.page),resumed=await readFile(await downloading);
    assert.equal(resumedState.runId,result.state.runId);assert.equal(resumedState.state,'INCOMPLETE');
    assert.equal(resumed.meta.directDataCapture.resumed,true);assert.equal(resumed.meta.directDataCapture.recoveredFromBuild,historical.buildId);
    assert.equal(resumed.meta.directDataCapture.mediaEnrichment.retainedAssessmentObservations,true);
    assertPublishedDraftSnapshot(config,resumed,resumeStart);
    const after=await checkpointSnapshot(result.page);
    assert.deepEqual(after.items.find(row=>row.itemId==='item_0001'),historicalPrimary,'Snapshot enrichment preserves the primary fingerprint, original question receipts and observation dates');
    assert.deepEqual(resumed.fingerprints.find(fp=>fp.id==='item_0001'),originalPrimary);
    assert.deepEqual(after.groups,historicalBefore.groups);assert.deepEqual(after.definitions,historicalBefore.definitions);assert.deepEqual(after.bodies,historicalBefore.bodies);
    assert(!requests.slice(resumeStart).some(request=>request.courseId===config.id&&[groupResource,definitionResource].includes(request.resource)&&!request.reference.startsWith(config.snapshotAtomId+'~')),
      'A completed v1.8.6 checkpoint rereads only the previously skipped published item draft sources, preserving current primary assessment observations');
    assert.equal(result.downloads.length,2);
    const publishedNativeRecheck=await recheckNativeCourse(result);
    assert.equal(publishedNativeRecheck.state.runId,result.state.runId);assert.equal(publishedNativeRecheck.state.state,'INCOMPLETE');
    assertPublishedDraftSnapshot(config,publishedNativeRecheck.capture,publishedNativeRecheck.start);
    assert.deepEqual(publishedNativeRecheck.capture.fingerprints.find(fp=>fp.id==='item_0001').payload.structuredAssessment.questions,
      originalPrimary.payload.structuredAssessment.questions,'Explicit native recheck still preserves reused exact primary definition observation dates');
    assert.equal(result.downloads.length,3);await assertNoEditor(result.page,result.destinations);await result.context.close();
  }

  const scaled=await runFileCase(largeExport),scaledSize=fileSizes.get(scaled.capture);
  assert.equal(scaled.state.state,'COMPLETE');assert.equal(scaledSize.archive,true,'Chrome should download one ZIP with a gzip manifest');
  assert(scaledSize.jsonBytes>32*1024*1024,'The complete retained raw capture must exceed the old plain-JSON cutoff');
  assert(scaledSize.fileBytes<=32*1024*1024,'Lossless compression keeps the one-file download within the transfer limit');
  assert.equal(scaled.capture.fingerprints.length,9);assert(scaled.capture.fingerprints.every(fp=>fp.captureContract.complete===true));
  const scaledVerdict=evaluateCourseraCapture(scaled.capture,largeExport.id);
  assert.equal(scaledVerdict.complete,true,JSON.stringify(scaledVerdict.reasons));
  assert(scaled.capture.fingerprints.at(-2).payload.directDataSources.atom.elements[0].draft.content.definition.content.definition.value.includes('x'.repeat(1000000)),
    'The large raw body is preserved after compression and expansion');
  await scaled.context.close();

  const resumed=await open(interrupted),partialDownloads=[];resumed.page.on('download',download=>partialDownloads.push(download));
  const resumeStart=requests.length;await launch(resumed.page,resumed.context);
  await pauseAfterSavedProgress(resumed,interrupted);
  const paused=await terminal(resumed.page);assert.equal(paused.state,'PAUSED');assert.equal(partialDownloads.length,0,'Operator stop saves checkpoints without an automatic partial file');
  const saved=await savedProgress(resumed.page);
  assert.equal(saved.definitions.length,pauseDefinitionLimit);assert(saved.groups>=pauseDefinitionLimit);assert(saved.runs.some(run=>run.runId===paused.runId));
  await resumed.page.reload();const afterResumeStart=requests.length;
  const resumeDownload=resumed.page.waitForEvent('download',{timeout:180000});void resumeDownload.catch(()=>{});
  await launch(resumed.page,resumed.context);const resumeState=await terminal(resumed.page),resumeCapture=await readFile(await resumeDownload);
  assert.equal(resumeState.runId,paused.runId);assert.equal(resumeState.state,'COMPLETE');assert.equal(partialDownloads.length,1);
  assert.equal(evaluateCourseraCapture(resumeCapture,interrupted.id).complete,true);
  assert(resumeCapture.meta.directDataCapture.stats.requests>=requests.slice(resumeStart).filter(request=>request.courseId===interrupted.id).length,
    'The exported API budget includes requests from before the pause');
  assert(!requests.slice(afterResumeStart).some(request=>request.resource===definitionResource&&saved.definitions.includes(request.reference)),
    'Committed exact versioned definitions should resume from real IndexedDB rather than repeat reads');
  for(const id of saved.groupIds)assert.equal(requests.slice(afterResumeStart).filter(request=>request.resource===groupResource&&request.reference===id).length,1,
    'An unchanged committed group resumes with one fresh consistency read');
  assertTransport(interrupted,resumeStart);await assertNoEditor(resumed.page,resumed.destinations);await resumed.context.close();

  const recovering=await open(oldCutoff),recoveryDownloads=[];recovering.page.on('download',download=>recoveryDownloads.push(download));
  const recoveryStart=requests.length;await launch(recovering.page,recovering.context);
  await pauseAfterSavedProgress(recovering,oldCutoff);
  const recoveryPaused=await terminal(recovering.page);assert.equal(recoveryPaused.state,'PAUSED');assert.equal(recoveryDownloads.length,0);
  const legacy=await recovering.page.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const saved=await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','groups','definitions'],'readwrite'),out={};
      const runs=transaction.objectStore('runs'),request=runs.getAll();request.onsuccess=()=>{
        const row=request.result.at(-1);row.state='INCOMPLETE';row.reason='DIRECT_CAPTURE_EXPORT_BYTE_LIMIT';
        row.buildId='v1.0.0-bound-authoring-drafts-20261014';row.budget.limits.concurrentRequests=2;
        row.captureMeta.buildId=row.buildId;row.captureMeta.directDataCapture.stopReason=row.reason;
        row.captureMeta.directDataCapture.acquisitionComplete=false;row.captureMeta.directDataCapture.wholeCourseVerified=false;
        row.captureMeta.directDataCapture.limits.concurrentRequests=2;
        row.captureMeta.directDataCapture.limits.exportBytes=32*1024*1024;runs.put(row);
        out.runId=row.runId;out.requests=row.budget.requests;
      };
      const definitionRequest=transaction.objectStore('definitions').getAll();definitionRequest.onsuccess=()=>{out.definitions=definitionRequest.result.map(row=>row.definitionId);};
      const groupRows=transaction.objectStore('groups'),groupRequest=groupRows.getAll();groupRequest.onsuccess=()=>{
        out.groupIds=groupRequest.result.map(row=>row.groupId);
        for(const row of groupRequest.result){delete row.value.modelHash;groupRows.put(row);}
      };
      transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);
    });database.close();return saved;
  });
  assert(legacy.definitions.length>0);assert(legacy.groupIds.length>0);
  await recovering.page.reload();const recoveryFreshStart=requests.length;
  const recoveryDownloading=recovering.page.waitForEvent('download',{timeout:180000});void recoveryDownloading.catch(()=>{});
  await launch(recovering.page,recovering.context);const recoveryFinal=await terminal(recovering.page),recoveryCapture=await readFile(await recoveryDownloading);
  assert.equal(recoveryFinal.runId,recoveryPaused.runId,'The former export cutoff resumes the existing run');
  assert.equal(recoveryFinal.state,'COMPLETE');assert.equal(recoveryDownloads.length,1);
  assert.equal(recoveryCapture.meta.directDataCapture.limits.concurrentRequests,4,'The old two-slot limit upgrades without resetting cumulative budgets');
  assert(recoveryCapture.meta.directDataCapture.stats.requests>=legacy.requests,'The old run keeps its spent request budget');
  assert(!requests.slice(recoveryFreshStart).some(request=>request.resource===definitionResource&&legacy.definitions.includes(request.reference)),
    'Old versioned definitions survive an export-cutoff upgrade');
  for(const id of legacy.groupIds)assert.equal(requests.slice(recoveryFreshStart).filter(request=>request.resource===groupResource&&request.reference===id).length,1,
    'Old group checkpoints without new cache metadata still receive a fresh source read');
  assert.equal(evaluateCourseraCapture(recoveryCapture,oldCutoff.id).complete,true);
  assertTransport(oldCutoff,recoveryStart);await assertNoEditor(recovering.page,recovering.destinations);await recovering.context.close();

  const budgetTarget=await open(budgetResume),budgetDownloads=[];budgetTarget.page.on('download',download=>budgetDownloads.push(download));
  const budgetStart=requests.length;await launch(budgetTarget.page,budgetTarget.context);
  await pauseAfterSavedProgress(budgetTarget,budgetResume);
  const budgetPaused=await terminal(budgetTarget.page);assert.equal(budgetPaused.state,'PAUSED');assert.equal(budgetDownloads.length,0);
  await budgetTarget.page.reload();
  const budgetDownloading=budgetTarget.page.waitForEvent('download',{timeout:180000});void budgetDownloading.catch(()=>{});
  await launch(budgetTarget.page,budgetTarget.context);
  const budgetFinal=await terminal(budgetTarget.page),budgetCapture=await readFile(await budgetDownloading);
  assert.equal(budgetFinal.runId,budgetPaused.runId);assert.equal(budgetFinal.state,'INCOMPLETE');assert.equal(budgetDownloads.length,1);
  assert.equal(budgetCapture.meta.directDataCapture.stats.requests,40,'Resume must not reset the course request limit');
  assert.equal(budgetCapture.meta.directDataCapture.stopReason,'COURSE_API_REQUEST_LIMIT');
  assert(requests.slice(budgetStart).filter(request=>request.courseId===budgetResume.id).length<=40);
  assert.equal(evaluateCourseraCapture(budgetCapture,budgetResume.id).complete,false);
  assertTransport(budgetResume,budgetStart);await assertNoEditor(budgetTarget.page,budgetTarget.destinations);await budgetTarget.context.close();

  function retainedMediaBodies(capture){
    const result=new Map();
    const visit=value=>{
      if(!value||typeof value!=='object')return;
      if(typeof value.assetId==='string'&&value.body?.archivePath&&value.body.bytes instanceof Uint8Array)result.set(value.assetId,value);
      for(const child of Object.values(value))if(child&&typeof child==='object')visit(child);
    };
    visit(capture);return result;
  }
  function assertOriginalMedia(config,capture,courseComplete=true){
    const retained=retainedMediaBodies(capture),reading=capture.fingerprints.find(fp=>fp.id==='item_0002');
    assert.equal(reading.captureContract.complete,true,'Source-bound reading media is verified only after original bytes are retained');
    for(const assetId of config.mediaIds){
      const original=assets.get(assetId),originalBytes=original.body,evidence=retained.get(assetId);
      assert(evidence,'The final JSON must retain each original image and attachment body');
      assert.deepEqual(Buffer.from(evidence.body.bytes),originalBytes,'No thumbnail, converted copy or prefix replaces the original bytes');
      const digest=createHash('sha256').update(originalBytes).digest('hex');
      assert.equal(evidence.body.sha256,digest);assert.equal(evidence.body.size,originalBytes.byteLength);
      assert.equal(evidence.body.mime,original.mime);assert.equal(evidence.body.receipt.status,200);
      assert.equal(evidence.metadata.elements[0].id,assetId);assert.equal(evidence.metadataReceipt.id,assetId);
      assert.equal(evidence.metadataReceipt.resource,'assets.v1');assert.equal(evidence.metadataReceipt.requestPath,'/api/assets.v1');
      assert.equal(new Map(evidence.metadataReceipt.requestQuery).get('ids'),assetId);
      assert.equal(evidence.stability.stable,true);assert.equal(evidence.stability.metadata.elements[0].id,assetId);
      assert.equal(evidence.stability.receipt.status,200);
      assert.equal(evidence.stability.receipt.resource,'assets.v1');assert.equal(evidence.stability.receipt.id,assetId);
      assert.equal(evidence.body.canonicalUrl,original.url.split('?')[0]);
      const owner=capture.fingerprints.find(fp=>fp.payload.directAssetEvidence?.assets?.some(asset=>asset.assetId===assetId));
      assert.equal(owner.payload.assetDetails.find(detail=>detail.assetId===assetId).name,original.name,
        'Original file types remain identifiable by the native filename rather than a CML display label');
      assert.equal(config.assetGets.get(assetId),2,'Initial and fresh metadata bind and certify each body location');
    }
    const verdict=evaluateCourseraCapture(capture,config.id);assert.equal(verdict.complete,courseComplete,JSON.stringify(verdict.reasons));
    assert(mediaRequests.filter(request=>request.courseId===config.id).every(request=>request.credentialHeaders.length===0));
  }
  const boundMedia=await runFileCase(mediaSuccess);assert.equal(boundMedia.state.state,'COMPLETE');
  assertOriginalMedia(mediaSuccess,boundMedia.capture);await boundMedia.context.close();
  const boundDwg=await runFileCase(dwgOriginals);
  assert.equal(boundDwg.state.state,'COMPLETE');assertOriginalMedia(dwgOriginals,boundDwg.capture);
  const dwgBody=retainedMediaBodies(boundDwg.capture).get(dwgOriginals.mediaIds.at(-1)).body;
  assert.equal(dwgBody.mime,'application/acad');assert.equal(dwgBody.receipt.originalContentType,'application/acad');
  assert.equal(dwgBody.receipt.declaredBodyBytes,512,'DWG originals retain exact framing evidence');
  await boundDwg.context.close();
  const boundAssessReading=await runFileCase(assessReadingMedia);
  assert.equal(boundAssessReading.state.state,'COMPLETE');
  assertOriginalMedia(assessReadingMedia,boundAssessReading.capture);
  assert.deepEqual(boundAssessReading.capture.fingerprints.find(fp=>fp.id==='item_0002').payload.directDraftCml,
    assessReading.atom.draft.content.definition.content,'The original assess/1 reading CML envelope and value are preserved unchanged');
  await boundAssessReading.context.close();
  const boundInlineWidget=await runFileCase(inlineWidgetReading);
  const widgetReading=boundInlineWidget.capture.fingerprints.find(fp=>fp.id==='item_0002');
  assert.equal(boundInlineWidget.state.state,'INCOMPLETE');
  assert.equal(widgetReading.captureContract.complete,false,'Retained reading text does not establish the content of its embedded widget');
  assert.equal(evaluateCourseraCapture(boundInlineWidget.capture,inlineWidgetReading.id).complete,false);
  assert(widgetReading.payload.directDraftCml.definition.value.includes('<widget id="'+inlineWidgetReading.inlineProviderId+'"/>'),'Exact versioned widget references survive export');
  const inlinePlacements=boundInlineWidget.capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence);
  assert.equal(inlinePlacements.length,2,'Repeated reading placements keep separate native item evidence');
  for(const fp of inlinePlacements){
    const evidence=fp.payload.directInlineWidgetProviderEvidence,provider=evidence.providers[0];
    assert.equal(evidence.method,'BOUND_INLINE_CML_WIDGET_PROVIDERS');assert.equal(evidence.itemId,fp.id);
    assert.equal(provider.itemId,fp.id);assert.equal(provider.atomId,fp.atomId);assert.equal(provider.occurrences,2);
    assert.equal(provider.providerId,inlineWidgetReading.inlineProviderId);assert.equal(provider.stableSource,true);
    assert.equal(provider.initial.model.elements[0].id,inlineWidgetReading.inlineProviderId.split('@')[0]);
    assert.equal(provider.initial.receipt.id,inlineWidgetReading.inlineProviderId);
    assert.equal(new Map(provider.initial.receipt.requestQuery).get('widgetSessionProviderId'),inlineWidgetReading.inlineProviderId);
    assert.equal(provider.targets[0].itemId,fp.id);assert.equal(provider.bodyVerified,false);
    assert.equal(provider.wholeWidgetVerified,false);assert.equal(fp.captureContract.complete,false);
    assert.equal(provider.initial.modelHash,provider.final.modelHash);assert.equal(provider.initial.sourceHash,provider.final.sourceHash);
    const validate=target=>directInlineWidgetEvidenceV1(target,bindDirectAuthoringDraftV1(target,inlineWidgetReading.id,slug,
      target.payload.directDataSources.atom,target.payload.directDataSources.relation),
      value=>createHash('sha256').update(directCanonicalSourceTextV1(value)).digest('hex'));
    const checked=validate(fp);assert.equal(checked.providers.length,1);assert.equal(checked.failures.length,0);
    const forged=structuredClone(fp);
    forged.payload.directInlineWidgetProviderEvidence.providers[0].initial.receipt.requestQuery.find(pair=>pair[0]==='widgetSessionProviderId')[1]=key('other_widget_',1)+'@1';
    assert.equal(validate(forged),null,'A rewritten native provider query cannot bind inline configuration to the reading');
  }
  const inlineReads=requests.filter(request=>request.courseId===inlineWidgetReading.id&&request.resource===providerResource);
  assert.equal(inlineReads.length,2,'Same versioned inline provider is read twice per attempt without losing repeated placements');
  assert(inlineReads.every(request=>request.method==='GET'&&new Map(request.query).get('widgetSessionProviderId')===inlineWidgetReading.inlineProviderId));
  await boundInlineWidget.context.close();
  const inlineDiscussionResult=await runFileCase(inlineWidgetDiscussion),inlineDiscussion=inlineDiscussionResult.capture.fingerprints.find(fp=>fp.id==='item_0002');
  assert.equal(inlineDiscussion.captureContract.complete,false);assert.equal(inlineDiscussion.payload.directInlineWidgetProviderEvidence.providers[0].stableSource,true);
  assert.equal(inlineDiscussion.payload.directDraftCml.definition.dtdId,'discussion/1');
  assert.equal(evaluateCourseraCapture(inlineDiscussionResult.capture,inlineWidgetDiscussion.id).complete,false);
  await inlineDiscussionResult.context.close();
  for(const config of [publicInlineWidget,publicInlineHtmlError,publicInlineChanged]){
    const result=await runFileCase(config),placements=result.capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence);
    assert.equal(result.state.state,'INCOMPLETE');assert.equal(evaluateCourseraCapture(result.capture,config.id).complete,false);
    for(const fp of placements){
      const proof=fp.payload.directInlineWidgetProviderEvidence.providers[0];
      assert.equal(fp.captureContract.complete,false);assert.equal(proof.bodyVerified,false);assert.equal(proof.wholeWidgetVerified,false);
      if(config.inlineMode==='inline-source-changed'){
        assert.equal(proof.stableSource,false);assert(!proof.publicPages?.some(page=>page.observation));
      }else{
        assert.equal(proof.stableSource,true);assert.equal(proof.failures.length,0,'A page acquisition gap must not erase independently valid native configuration');
        assert.equal(proof.publicPages.length,1,'Matching authored URL fields dedupe into one retained public page');
        const page=proof.publicPages[0];assert.equal(page.targetUrl,config.publicTarget);
        assert.deepEqual(page.sourceFields,['draft.configuration.url','draft.pageSrc']);
        if(config.inlineMode==='public-success'){
          assert.equal(page.failures.length,0);assert.equal(page.observation.model.html,config.publicHtml);
          assert.equal(page.observation.model.requestedUrl,config.publicTarget);
          assert.equal(page.observation.model.normalizedUrl,config.publicTarget.split('#')[0]);
          assert.equal(page.observation.model.encoding,'UTF8');assert.equal(page.observation.receipt.transport,'CTI_PUBLIC_BACKEND');
          assert.equal(page.observation.receipt.declaredEnvelopeBytes,page.observation.receipt.bytes,'The decoded JSON envelope length survives the real helper channel');
          assert(directPublicHtmlEvidenceV1(page.observation,config.publicTarget,bytes=>createHash('sha256').update(bytes).digest('hex')));
        }else{assert.equal(page.observation,null);assert(page.failures.length>0);}
      }
    }
    const pageGets=publicPageRequests.filter(request=>request.courseId===config.id);
    assert.equal(pageGets.length,config.inlineMode==='inline-source-changed'?0:1,'Only a stable native target triggers one bounded public GET, including repeated reading placements');
    if(config.inlineMode==='public-success'){
      const retained=placements.reduce((sum,fp)=>sum+fp.payload.directInlineWidgetProviderEvidence.providers[0].publicPages[0].observation.model.bytes,0);
      assert.equal(result.capture.meta.directDataCapture.stats.publicPages.retainedUtf8Bytes,retained,'The byte budget counts every retained placement copy');
      assert.equal(result.capture.meta.directDataCapture.stats.byResource.PublicStaticHtml,1,'Cached page reuse does not count another network request');
    }
    await result.context.close();
  }
  const integratedPublisherStart=publisherRequests.length,integratedPublisherHelperStart=helperRequests.length;
  const publisherIntegrated=await runFileCase(publisherInlineCourse);
  assert.equal(publisherIntegrated.state.state,'INCOMPLETE');
  assert.equal(evaluateCourseraCapture(publisherIntegrated.capture,publisherInlineCourse.id).complete,false);
  const publisherPlacements=publisherIntegrated.capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence);
  assert.equal(publisherPlacements.length,2);
  for(const fp of publisherPlacements){
    const source=atoms.get(fp.atomId),provider=fp.payload.directInlineWidgetProviderEvidence.providers[0];
    assert.equal(provider.stableSource,true);assert.equal(provider.bodyVerified,false);assert.equal(provider.wholeWidgetVerified,false);
    assert.equal(fp.captureContract.complete,false,'An observed publisher chapter does not certify the containing interactive reading');
    assert.deepEqual(fp.payload.directDraftCml,source.atom.draft.content.definition.content,'Original Coursera CML remains separate from publisher JSON');
    assert.equal(provider.publisherPages.length,1);const page=provider.publisherPages[0];
    assert.equal(page.targetUrl,publisherInlineCase.targetUrl);assert.deepEqual(page.sourceFields,['draft.configuration.url','draft.pageSrc']);
    assert.equal(page.failures.length,0);assert.equal(page.observation.model.rawJson,publisherInlineCase.rawJson);
    assert.equal(page.observation.model.html,undefined);assert.equal(page.observation.receipt.transport,'BROWSER_PUBLISHER_API');
    assert(directPublisherEvidenceV1(page.observation,publisherInlineCase.targetUrl,bytes=>createHash('sha256').update(bytes).digest('hex')));
    assert(!provider.publicPages.some(page=>page.observation),'Publisher API JSON is never represented as captured page HTML');
  }
  assert.equal(publisherRequests.length-integratedPublisherStart,1,'Repeated native placements reuse one original publisher response');
  assert.equal(helperRequests.length,integratedPublisherHelperStart,'A successful browser API read never invokes a server fallback');
  const integratedStats=publisherIntegrated.capture.meta.directDataCapture.stats;
  assert.equal(integratedStats.byResource.PublisherChapter,1);assert.equal(integratedStats.publisherPages.readerOperations,1);
  assert.equal(integratedStats.publisherPages.observedBytes,publisherInlineCase.bytes.length);
  assert.equal(integratedStats.publicPages.retainedUtf8Bytes,publisherInlineCase.bytes.length*2,'Every retained placement is charged to the shared original-text budget');
  assert.equal(publisherIntegrated.capture.meta.directDataCapture.coverage.readings.verified,0);
  assert.equal(publisherIntegrated.capture.meta.directDataCapture.coverage.questions,10,'External publisher text is not turned into synthetic Coursera questions');
  const publisherCheckpointBefore=await checkpointSnapshot(publisherIntegrated.page),publisherAccessNativeStart=requests.length,
    publisherAccessProviderStart=publisherRequests.length,publisherAccessHelperStart=helperRequests.length;
  await publisherIntegrated.page.getByRole('button',{name:'Check embedded page access',exact:true}).click();
  await publisherIntegrated.page.waitForFunction(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__?.diagnosing===false&&
    window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__?.accessDiagnostic?.kind==='CTI_PUBLISHER_ACCESS_DIAGNOSTIC');
  const publisherAccess=await publisherIntegrated.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.accessDiagnostic);
  assert.equal(publisherAccess.diagnosticOnly,true);assert.equal(publisherAccess.accepted,true);assert.equal(publisherAccess.requests,1);
  assert.equal(publisherAccess.courseCaptured,false);assert.equal(publisherAccess.progressChanged,false);
  assert.equal(publisherAccess.source.targetUrl,publisherInlineCase.targetUrl);assert.equal(publisherAccess.chapter.id,999);
  assert.equal(publisherAccess.body.sha256,createHash('sha256').update(publisherInlineCase.bytes).digest('hex'));
  assert.equal(publisherRequests.length-publisherAccessProviderStart,1);assert.equal(helperRequests.length,publisherAccessHelperStart);
  assert.equal(requests.length,publisherAccessNativeStart,'The lightweight access check selects saved native sources without rereading questions or course APIs');
  assert.deepEqual(await checkpointSnapshot(publisherIntegrated.page),publisherCheckpointBefore,'Access checks do not replace saved raw sources, answers, dates or progress');
  const publisherAccessText=JSON.stringify(publisherAccess);
  assert(!publisherAccessText.includes('rawJson')&&!publisherAccessText.includes('Distinct rendered')&&!publisherAccessText.includes('[latex]'));
  assert.equal(publisherIntegrated.contextDownloads.length,1,'The access check does not automatically download another artifact');

  // Derive historical-version fixtures from an actual completed browser run.
  // Seed only era metadata/evidence, then reload before using the real store's
  // getActiveRun filter. No current capture may rewrite the seeded checkpoint.
  const publisherHistoricalSeed=await publisherIntegrated.page.evaluate(async runId=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const rows=await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','items'],'readonly'),out={};
      for(const name of ['runs','items']){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result.filter(row=>row.runId===runId);};}
      transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);});
    database.close();return rows;
  },publisherIntegrated.state.runId);
  assert.equal(publisherHistoricalSeed.runs.length,1);
  await publisherIntegrated.page.addInitScript(()=>{
    window.fixtureCheckpointWrites=[];
    for(const method of ['put','add','delete','clear']){
      const descriptor=Object.getOwnPropertyDescriptor(IDBObjectStore.prototype,method),original=descriptor.value;
      Object.defineProperty(IDBObjectStore.prototype,method,{...descriptor,value:function(...args){
        window.fixtureCheckpointWrites.push({store:this.name,method});return Reflect.apply(original,this,args);
      }});
    }
    for(const method of ['update','delete']){
      const descriptor=Object.getOwnPropertyDescriptor(IDBCursor.prototype,method),original=descriptor.value;
      Object.defineProperty(IDBCursor.prototype,method,{...descriptor,value:function(...args){
        window.fixtureCheckpointWrites.push({store:'cursor',method});return Reflect.apply(original,this,args);
      }});
    }
    const descriptor=Object.getOwnPropertyDescriptor(IDBDatabase.prototype,'transaction'),original=descriptor.value;
    Object.defineProperty(IDBDatabase.prototype,'transaction',{...descriptor,value:function(...args){
      if(args[1]==='readwrite')window.fixtureCheckpointWrites.push({store:'transaction',method:'readwrite'});
      return Reflect.apply(original,this,args);
    }});
  });
  for(const historical of [
    {version:'1.8.0',buildId:'v1.8.0-inline-widget-public-html-20261018'},
    {version:'1.8.1',buildId:'v1.8.1-browser-publisher-api-20261018'},
    {version:'1.8.3',buildId:'v1.8.3-publisher-sections-original-images-20261018'},
    {version:'1.8.4',buildId:'v1.8.4-public-publisher-images-20261019'},
    {version:'1.8.5',buildId:'v1.8.5-publisher-challenge-aware-20261019'},
    {version:'1.8.6',buildId:'v1.8.6-publisher-back-matter-20261019'},
    // Leave v1.8.2 seeded for the separate flag-order continuation below.
    {version:'1.8.2',buildId:'v1.8.2-historical-publisher-checkpoint-20261018'},
  ]){
    const seeded=await publisherIntegrated.page.evaluate(async ({seed,historical})=>{
      const rows=structuredClone(seed),run=rows.runs[0];
      if(run.state!=='INCOMPLETE'||run.counts.processed!==run.counts.total||
          run.captureMeta.directDataCapture.sourceStable!==true||run.captureMeta.directDataCapture.acquisitionComplete!==true||
          run.captureMeta.directDataCapture.wholeCourseVerified!==false||
          run.captureMeta.directDataCapture.stopReason!=='ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS')throw Error('Historical fixture requires a completed native run with evidence gaps');
      run.buildId=historical.buildId;run.captureMeta.buildId=historical.buildId;
      run.captureMeta.extractor='CTI Direct Course Capture v'+historical.version;
      if(historical.version==='1.8.0'){
        delete run.captureMeta.directDataCapture.stats.publisherPages;
        delete run.captureMeta.directDataCapture.stats.externalSources;
        for(const row of rows.items)for(const evidence of [row.fingerprint.payload.directInlineWidgetProviderEvidence,
          row.fingerprint.payload.directInlineWidgetProviderAttempt])for(const provider of evidence?.providers||[])delete provider.publisherPages;
      }
      const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','items'],'readwrite');
        for(const [name,values] of Object.entries(rows))for(const row of values)transaction.objectStore(name).put(row);
        transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});
      database.close();return{runId:run.runId,buildId:run.buildId,state:run.state,processed:run.counts.processed,total:run.counts.total};
    },{seed:publisherHistoricalSeed,historical});
    assert.equal(seeded.buildId,historical.buildId);assert.equal(seeded.state,'INCOMPLETE');
    assert.equal(seeded.processed,seeded.total);assert(seeded.total>0);
    const historicalBefore=await checkpointSnapshot(publisherIntegrated.page);
    assert(historicalBefore.definitions.length>0&&historicalBefore.groups.length>0,'The historical fixture retains real question definitions and groups');
    assert.equal(historicalBefore.bodies.length,1,'The historical fixture retains a real original-byte Blob');
    assert.equal(historicalBefore.bodies[0].blob.sha256,createHash('sha256').update(pngBytes).digest('hex'));
    const historicalNativeStart=requests.length,historicalProviderStart=publisherRequests.length,
      historicalHelperStart=helperRequests.length,historicalMediaStart=mediaRequests.length,historicalDownloads=publisherIntegrated.contextDownloads.length;
    await publisherIntegrated.page.reload();await launch(publisherIntegrated.page,publisherIntegrated.context,false);
    assert.deepEqual(await publisherIntegrated.page.evaluate(()=>{const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;
      return{state:state.state,running:state.running,runId:state.runId};}),{state:'READY',running:false,runId:''});
    assert.deepEqual(await checkpointSnapshot(publisherIntegrated.page),historicalBefore,'Opening the new bookmark does not migrate or relabel historical saved data');
    await publisherIntegrated.page.getByRole('button',{name:'Check embedded page access',exact:true}).click();
    await publisherIntegrated.page.waitForFunction(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__?.diagnosing===false&&
      window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__?.accessDiagnostic?.kind==='CTI_PUBLISHER_ACCESS_DIAGNOSTIC');
    const diagnostic=await publisherIntegrated.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.accessDiagnostic);
    assert.equal(diagnostic.accepted,true,'The real IndexedDB store must recover the completed '+historical.version+' run for a read-only access check');
    assert.equal(diagnostic.requests,1);assert.equal(diagnostic.source.targetUrl,publisherInlineCase.targetUrl);
    assert.equal(diagnostic.source.itemId,'item_0002');assert.equal(diagnostic.source.providerId,publisherInlineCourse.inlineProviderId);
    assert.equal(diagnostic.source.configuredSourceObservedAt,publisherPlacements[0].payload.directInlineWidgetProviderEvidence.providers[0].final.receipt.observedAt);
    assert.equal(diagnostic.body.sha256,createHash('sha256').update(publisherInlineCase.bytes).digest('hex'));
    assert.equal(diagnostic.courseCaptured,false);assert.equal(diagnostic.progressChanged,false);
    assert.equal(publisherRequests.length-historicalProviderStart,1);assert.equal(requests.length,historicalNativeStart);
    assert.equal(helperRequests.length,historicalHelperStart);assert.equal(mediaRequests.length,historicalMediaStart);
    assert.equal(publisherIntegrated.contextDownloads.length,historicalDownloads);
    assert.deepEqual(await publisherIntegrated.page.evaluate(()=>window.fixtureCheckpointWrites),[],
      'Historical access checks perform no IndexedDB write transactions, row writes, deletes or cursor updates');
    assert.deepEqual(await checkpointSnapshot(publisherIntegrated.page),historicalBefore,
      'Historical run metadata, native items, questions, original receipts, timestamps and original-byte hashes remain unchanged');
  }
  const beforeFlagResume=await checkpointSnapshot(publisherIntegrated.page),
    priorFlagRun=beforeFlagResume.runs.find(run=>run.runId===publisherIntegrated.state.runId),
    priorFlagAssignments=beforeFlagResume.items.filter(row=>['item_0000','item_0001'].includes(row.itemId)),
    flagResumeNativeStart=requests.length,flagResumeMediaStart=mediaRequests.length;
  assert.equal(priorFlagRun.buildId,'v1.8.2-historical-publisher-checkpoint-20261018');
  const initialFlagOrder=[...publisherFlagLeaf.content.definition.assignmentFeatures];
  publisherFlagLeaf.content.definition.assignmentFeatures.reverse();
  const flagDownloading=publisherIntegrated.page.waitForEvent('download',{timeout:180000});
  await publisherIntegrated.page.reload();await launch(publisherIntegrated.page,publisherIntegrated.context);
  const flagState=await terminal(publisherIntegrated.page),flagCapture=await readFile(await flagDownloading);
  assert.equal(flagState.runId,priorFlagRun.runId,'Known assignment flag reordering keeps the real completed v1.8.2 checkpoint');
  assert.equal(flagCapture.meta.directDataCapture.resumed,true);
  assert.equal(flagCapture.meta.directDataCapture.recoveredFromBuild,'v1.8.2-historical-publisher-checkpoint-20261018');
  assert.equal(flagCapture.meta.directDataCapture.mediaEnrichment.retainedAssessmentObservations,true);
  const afterFlagResume=await checkpointSnapshot(publisherIntegrated.page);
  assert.deepEqual(afterFlagResume.items.filter(row=>['item_0000','item_0001'].includes(row.itemId)),priorFlagAssignments,
    'Continuing source acquisition retains original assessment models, answer evidence and observation times');
  assert.deepEqual(afterFlagResume.definitions,beforeFlagResume.definitions);
  assert.deepEqual(afterFlagResume.groups,beforeFlagResume.groups);
  assert.deepEqual(afterFlagResume.bodies,beforeFlagResume.bodies,'The retained native PNG and original-byte Blob hash remain unchanged');
  assert(!requests.slice(flagResumeNativeStart).some(request=>[groupResource,definitionResource].includes(request.resource)),
    'Known flag ordering cannot cause verified question groups or definitions to be read again');
  assert.equal(mediaRequests.length,flagResumeMediaStart,'Matching native originals are validated without downloading their bytes again');
  assert(flagCapture.meta.directDataCapture.stats.requests>priorFlagRun.budget.requests);
  assert.equal(flagCapture.meta.directDataCapture.stats.media.bytes,priorFlagRun.budget.media.bytes);
  assert.equal(flagCapture.meta.directDataCapture.stats.media.requests,priorFlagRun.budget.media.requests);
  assert.notEqual(flagCapture.meta.directDataCapture.initialMaterialHash,priorFlagRun.materialHash);
  assert.equal(flagCapture.meta.directDataCapture.materialStability.initialSha256,
    priorFlagRun.captureMeta.directDataCapture.materialStability.initialSha256);
  assert.deepEqual(publisherFlagLeaf.content.definition.assignmentFeatures,[...initialFlagOrder].reverse(),
    'The native response flag order is not normalized in place');
  publisherFlagLeaf.content.definition.assignmentFeatures=initialFlagOrder;
  await publisherIntegrated.context.close();
  const partIntegratedStart=publisherRequests.length,partIntegratedHelperStart=helperRequests.length;
  const partIntegrated=await runFileCase(publisherPartCourse);
  const partPlacements=partIntegrated.capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence);
  assert.equal(partIntegrated.state.state,'INCOMPLETE');assert.equal(partPlacements.length,2);
  assert.equal(evaluateCourseraCapture(partIntegrated.capture,publisherPartCourse.id).complete,false);
  for(const fp of partPlacements){
    const provider=fp.payload.directInlineWidgetProviderEvidence.providers[0],page=provider.publisherPages[0];
    assert.equal(provider.bodyVerified,false);assert.equal(provider.wholeWidgetVerified,false);assert.equal(fp.captureContract.complete,false);
    assert.equal(page.observation.model.kind,'CTI_BROWSER_PUBLISHER_PART');assert.equal(page.observation.model.rawJson,publisherPartCase.rawJson);
    assert.equal(page.observation.receipt.resource,'PublisherPart');assert.equal(page.observation.receipt.credentials,'omit');
    assert.equal(page.observation.receipt.resolution.method,'CHAPTER_404_TO_PART');
    assert.equal(page.observation.receipt.resolution.chapterReceipt.status,404);
    assert.equal(page.observation.receipt.resolution.chapterReceipt.attempts.length,1);
    assert.equal(page.observation.receipt.resolution.chapterReceipt.attempts[0].credentials,'omit');
    assert(directPublisherResourceEvidenceV1(page.observation,page.targetUrl,bytes=>createHash('sha256').update(bytes).digest('hex')));
    assert.equal(directPublisherEvidenceV1(page.observation,page.targetUrl,bytes=>createHash('sha256').update(bytes).digest('hex')),null,
      'A part is accepted only by the explicit typed dispatcher, never relabeled as a chapter');
    assert.deepEqual(fp.payload.directDraftCml,atoms.get(fp.atomId).atom.draft.content.definition.content);
  }
  assert.deepEqual(publisherRequests.slice(partIntegratedStart).map(request=>request.endpointType),['chapters','parts'],
    'Two native placements share one bounded chapter-404/part-200 acquisition');
  assert.equal(helperRequests.length,partIntegratedHelperStart);
  assert.equal(partIntegrated.capture.meta.directDataCapture.stats.byResource.PublisherChapter,1);
  assert.equal(partIntegrated.capture.meta.directDataCapture.stats.byResource.PublisherPart,1);
  assert.equal(partIntegrated.capture.meta.directDataCapture.coverage.questions,10);
  await partIntegrated.context.close();

  const backMatterApiStart=publisherRequests.length,backMatterImageStart=publisherImageRequests.length,backMatterHelperStart=helperRequests.length;
  const backMatterIntegrated=await runFileCase(publisherBackMatterCourse);
  const backMatterPlacements=backMatterIntegrated.capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence);
  assert.equal(backMatterIntegrated.state.state,'INCOMPLETE');assert.equal(backMatterPlacements.length,2);
  assert.equal(evaluateCourseraCapture(backMatterIntegrated.capture,publisherBackMatterCourse.id).complete,false);
  for(const fp of backMatterPlacements){
    const provider=fp.payload.directInlineWidgetProviderEvidence.providers[0],page=provider.publisherPages[0],observation=page.observation;
    assert.equal(observation.model.kind,'CTI_BROWSER_PUBLISHER_BACK_MATTER');assert.equal(observation.model.resourceType,'back-matter');
    assert.equal(observation.model.rawJson,publisherBackMatterCase.rawJson);assert.equal(observation.model.bytes,publisherBackMatterCase.bytes.length);
    assert.equal(observation.model.sha256,createHash('sha256').update(publisherBackMatterCase.bytes).digest('hex'));
    assert.equal(observation.receipt.resource,'PublisherBackMatter');assert.equal(observation.receipt.credentials,'omit');
    assert.equal(observation.receipt.resolution.method,'CHAPTER_404_PART_404_TO_BACK_MATTER');
    const {chapterReceipt,partReceipt}=observation.receipt.resolution;
    for(const [receipt,resource,endpoint]of [[chapterReceipt,'PublisherChapter','chapters'],[partReceipt,'PublisherPart','parts']]){
      assert.equal(receipt.resource,resource);assert.equal(receipt.status,404);assert.equal(receipt.responseType,'cors');
      assert.equal(receipt.credentials,'omit');assert.equal(receipt.attempts.length,1);assert.equal(receipt.attempts[0].credentials,'omit');
      assert.equal(receipt.resolution,undefined,'Prior typed 404 receipts are flat independent observations');
      assert.equal(receipt.endpointUrl,publisherOrigin+'/'+publisherBook+'/wp-json/pressbooks/v2/'+endpoint+'/'+publisherBackMatterCase.chapterId);
    }
    assert(directPublisherResourceEvidenceV1(observation,page.targetUrl,bytes=>createHash('sha256').update(bytes).digest('hex')));
    assert.equal(directPublisherEvidenceV1(observation,page.targetUrl,bytes=>createHash('sha256').update(bytes).digest('hex')),null);
    assert.equal(directPublisherResourceV1(observation.model.rawJson,page.targetUrl,'part'),null,
      'New back matter is never relabeled as an existing chapter or part');
    assert.equal(directPublisherResourceV1(observation.model.rawJson,page.targetUrl,'back-matter').type,'back-matter');
    assert(directPublisherMediaEvidenceV1(observation,page.targetUrl,page.media,bytes=>createHash('sha256').update(bytes).digest('hex')));
    const image=page.media.resources[0];assert.equal(page.media.resources.length,1);assert.equal(image.url,publisherBackMatterImageUrl);
    assert.equal(image.references.length,2);assert.deepEqual(Buffer.from(image.body.bytes),pngBytes);
    assert.equal(image.body.receipt.sourceSha256,observation.model.sha256);assert.equal(image.body.receipt.responseType,'cors');
    assert.equal(image.body.archivePath,'files/'+createHash('sha256').update(pngBytes).digest('hex'));
    assert.equal(provider.bodyVerified,false);assert.equal(provider.wholeWidgetVerified,false);assert.equal(fp.captureContract.complete,false);
    const report=courseraInlineWidgetContent(fp,publisherBackMatterCourse.id);assert(report);
    const reportPage=report.providers[0].publisherPages[0];assert.equal(reportPage.status,'CAPTURED_PUBLISHER_API_BACK_MATTER');
    assert.equal(reportPage.resourceType,'back-matter');assert.equal(reportPage.resourceId,publisherBackMatterCase.chapterId);
    assert.equal(reportPage.resourceLink,publisherBackMatterCase.chapter.link);assert.equal(reportPage.media.resources[0].originalRef,image.body.archivePath);
    const original=courseraInlinePublisherResource(report,provider.providerId,page.targetUrl);assert(original);
    assert.equal(original.rawJson,publisherBackMatterCase.rawJson);assert.equal(original.resource.type,'back-matter');assert.equal(original.historical,false);
    const output=courseraInlineWidgetContentText(report);assert.match(output,/Publisher API back matter content/);
    assert(output.includes(publisherBackMatterImageUrl)&&output.includes(observation.model.sha256));
  }
  assert.deepEqual(publisherRequests.slice(backMatterApiStart).map(request=>request.endpointType),['chapters','parts','back-matter'],
    'Two native placements share one bounded three-GET typed acquisition');
  assert.equal(publisherImageRequests.length-backMatterImageStart,1);assert.equal(helperRequests.length,backMatterHelperStart);
  for(const resource of ['PublisherChapter','PublisherPart','PublisherBackMatter'])
    assert.equal(backMatterIntegrated.capture.meta.directDataCapture.stats.byResource[resource],1);
  assert.equal(backMatterIntegrated.capture.meta.directDataCapture.coverage.questions,10);
  const backMatterZip=await JSZip.loadAsync(fs.readFileSync(await backMatterIntegrated.contextDownloads[0].download.path()),{checkCRC32:true});
  assert.deepEqual(await backMatterZip.file('files/'+createHash('sha256').update(pngBytes).digest('hex')).async('nodebuffer'),pngBytes,
    'The same capture ZIP retains the back-matter original image under its exact native publisher source');
  assert.equal(await backMatterIntegrated.page.evaluate(()=>window.__CTI_PUBLISHER_EXECUTED),undefined);
  await backMatterIntegrated.context.close();

  const pipelineBrowserStart=publisherImageRequests.length,pipelineApiStart=publisherRequests.length,pipelineHelperStart=helperRequests.length;
  const pipelineImages=await runFileCase(publisherPipelineCourse);
  assert.equal(pipelineImages.state.state,'INCOMPLETE');
  assert.equal(publisherImageRequests.length-pipelineBrowserStart,4,'Each literal image is read once across both native placements');
  assert.equal(publisherRequests.length-pipelineApiStart,1);assert.equal(helperRequests.length,pipelineHelperStart);
  assert.equal(publisherPipeline.maximum,2,'Two actual HTTPS image responses overlap within the unchanged two-read ceiling');
  assert.equal(publisherPipeline.active,0);assert.deepEqual(publisherPipeline.timedOut,[]);
  assert.deepEqual(publisherPipeline.completed,[1,0,3,2].map(index=>publisherPipelineUrls[index]),
    'The real HTTPS fixture deliberately completes each later source before its earlier sibling');
  const pipelineStats=pipelineImages.capture.meta.directDataCapture.stats.media;
  assert.equal(pipelineStats.maxConcurrentRequests,2);assert.equal(pipelineStats.limits.concurrentRequests,2);
  assert.equal(pipelineStats.requests,4);assert.equal(pipelineStats.bytes,publisherPipelineUrls.reduce((sum,url)=>sum+publisherImages.get(url).body.length,0));
  const pipelineOriginals=publisherPipelineUrls.map(url=>({url,body:publisherImages.get(url).body,
    sha256:createHash('sha256').update(publisherImages.get(url).body).digest('hex')}));
  const pipelineCommits=await pipelineImages.page.evaluate(()=>window.fixturePublisherPipelineCommits);
  assert.deepEqual(pipelineCommits,pipelineOriginals.map(original=>({sha256:original.sha256,bytes:original.body.length})),
    'Immutable original Blobs commit in literal source order despite out-of-order network responses');
  const pipelinePlacements=pipelineImages.capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence);
  assert.equal(pipelinePlacements.length,2);
  for(const fp of pipelinePlacements){
    const provider=fp.payload.directInlineWidgetProviderEvidence.providers[0],page=provider.publisherPages[0];
    assert.equal(page.observation.model.rawJson,publisherPipelineCase.rawJson);
    assert.equal(page.observation.model.sha256,createHash('sha256').update(publisherPipelineCase.bytes).digest('hex'));
    assert(directPublisherMediaEvidenceV1(page.observation,page.targetUrl,page.media,bytes=>createHash('sha256').update(bytes).digest('hex')));
    assert.deepEqual(page.media.resources.map(resource=>resource.url),publisherPipelineUrls,
      'The accepted resource list retains literal order rather than response completion order');
    for(const [index,resource]of page.media.resources.entries()){
      const original=pipelineOriginals[index];assert.equal(resource.references.length,2);
      assert.equal(resource.reason,undefined);assert.equal(resource.body.sha256,original.sha256);assert.equal(resource.body.size,original.body.length);
      assert.equal(resource.body.archivePath,'files/'+original.sha256);assert.deepEqual(Buffer.from(resource.body.bytes),original.body);
      assert.equal(resource.body.receipt.transport,'BROWSER_PUBLISHER_IMAGE');assert.equal(resource.body.receipt.responseType,'cors');
      assert.equal(resource.body.receipt.sourceSha256,page.observation.model.sha256);assert.equal(resource.body.receipt.bytes,original.body.length);
      assert.equal(resource.body.receipt.sha256,original.sha256);assert.equal(resource.body.receipt.credentials,'omit');
    }
    assert.equal(fp.captureContract.complete,false);assert.equal(provider.bodyVerified,false);assert.equal(provider.wholeWidgetVerified,false);
    const report=courseraInlineWidgetContent(fp,publisherPipelineCourse.id);assert(report);
    const projected=report.providers[0].publisherPages[0].media.resources;
    assert.deepEqual(projected.map(resource=>resource.url),publisherPipelineUrls);
    assert.deepEqual(projected.map(resource=>resource.bytes),pipelineOriginals.map(original=>original.body.length));
  }
  assert.deepEqual(pipelinePlacements[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0].media.resources,
    pipelinePlacements[1].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0].media.resources,
    'Both native placements share the same source-bound original observations without duplicate downloads');
  const pipelineCheckpoint=await checkpointSnapshot(pipelineImages.page);assert.equal(pipelineCheckpoint.bodies.length,4);
  const pipelineZip=await JSZip.loadAsync(fs.readFileSync(await pipelineImages.contextDownloads[0].download.path()),{checkCRC32:true});
  assert.deepEqual(Object.keys(pipelineZip.files).filter(name=>/^files\/[a-f0-9]{64}$/.test(name)),pipelineOriginals.map(original=>'files/'+original.sha256),
    'The one exported ZIP lists original entries in source order');
  for(const original of pipelineOriginals)assert.deepEqual(await pipelineZip.file('files/'+original.sha256).async('nodebuffer'),original.body);
  assert.equal(pipelineImages.capture.meta.directDataCapture.coverage.questions,10);
  assert.equal(evaluateCourseraCapture(pipelineImages.capture,publisherPipelineCourse.id).complete,false);
  await pipelineImages.context.close();

  const imageIntegratedStart=publisherImageRequests.length,imageApiStart=publisherRequests.length,imageHelperStart=helperRequests.length;
  const imageIntegrated=await runFileCase(publisherImageCourse);
  function assertPublisherImageCapture(capture){
    const placements=capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence);
    assert.equal(placements.length,2);assert.equal(evaluateCourseraCapture(capture,publisherImageCourse.id).complete,false);
    const bodies=[];
    for(const fp of placements){
      const provider=fp.payload.directInlineWidgetProviderEvidence.providers[0],page=provider.publisherPages[0],media=page.media;
      assert.equal(page.observation.model.rawJson,publisherImageCase.rawJson,'Publisher JSON remains exactly the observed UTF-8 source');
      assert.equal(page.observation.model.sha256,createHash('sha256').update(publisherImageCase.bytes).digest('hex'));
      assert(directPublisherMediaEvidenceV1(page.observation,page.targetUrl,media,bytes=>createHash('sha256').update(bytes).digest('hex')),
        'Saved projection independently validates the publisher source, literal references and attached original bytes');
      assert.equal(media.resources.length,5);assert.equal(media.sourceSha256,page.observation.model.sha256);
      const original=media.resources.find(resource=>resource.url===publisherImageBase+'main.png');
      assert.equal(original.references.length,3,'The literal img/href references across raw and rendered fields share one source-bound URL');
      assert(original.body?.bytes instanceof Uint8Array);assert.deepEqual(Buffer.from(original.body.bytes),pngBytes);
      assert.equal(original.body.sha256,createHash('sha256').update(pngBytes).digest('hex'));
      assert.equal(original.body.archivePath,'files/'+original.body.sha256);assert.equal(original.body.receipt.transport,'BROWSER_PUBLISHER_IMAGE');
      assert.equal(original.body.receipt.sourceSha256,page.observation.model.sha256);assert.equal(original.body.receipt.responseType,'cors');
      assert.equal(original.body.receipt.credentials,'omit');assert.equal(original.body.receipt.requestedUrl,original.url);
      assert.equal(media.resources.find(resource=>resource.url.endsWith('/no-cors.png')).reason,'PUBLISHER_IMAGE_HELPER_OPERATION_UNSUPPORTED');
      assert.equal(media.resources.find(resource=>resource.url.endsWith('/redirect.png')).reason,'PUBLISHER_IMAGE_HELPER_OPERATION_UNSUPPORTED');
      assert.equal(media.resources.find(resource=>resource.url.endsWith('/wrong-mime.png')).reason,'PUBLISHER_IMAGE_MIME_OR_RANGE_UNSUPPORTED');
      assert.equal(media.resources.find(resource=>resource.url.endsWith('/bad-magic.png')).reason,'PUBLISHER_IMAGE_MAGIC_INVALID');
      assert(media.resources.filter(resource=>resource.reason).every(resource=>!resource.body),'Unreadable or unsupported bytes are never retained');
      for(const unavailable of media.resources.filter(resource=>resource.reason==='PUBLISHER_IMAGE_HELPER_OPERATION_UNSUPPORTED')){
        assert.equal(unavailable.attempts.length,2);assert.equal(unavailable.attempts[0].transport,'BROWSER_PUBLISHER_IMAGE');
        assert.equal(unavailable.attempts[0].reason,'PUBLISHER_IMAGE_BLOCKED_OR_FAILED');assert.equal(unavailable.attempts[1].serviceStatus,0);assert.equal(unavailable.attempts[1].upstreamRequests,0);
      }
      assert(media.failures.some(failure=>failure.reason==='PUBLISHER_IMAGE_SRCSET_ALTERNATIVES_NOT_SELECTED'));
      assert.equal(fp.captureContract.complete,false);assert.equal(provider.wholeWidgetVerified,false);assert.equal(provider.bodyVerified,false);
      bodies.push(original.body);
    }
    assert.deepEqual(bodies[0],bodies[1],'Repeated placements retain the same actual image observation and byte descriptor');
    assert.equal(capture.meta.directDataCapture.coverage.questions,10);return bodies[0];
  }
  const firstPublisherImage=assertPublisherImageCapture(imageIntegrated.capture);
  assert.equal(imageIntegrated.state.state,'INCOMPLETE');assert.equal(publisherImageRequests.length-imageIntegratedStart,5);
  assert.equal(publisherImageCourse.publisherImageStagingChecked,true,'The generated bookmark stages and releases the earlier original before starting the third read');
  assert.equal(publisherRequests.length-imageApiStart,1);assert.equal(helperRequests.length,imageHelperStart);
  assert(publisherImageRequests.slice(imageIntegratedStart).every(request=>publisherImages.has(request.url)),
    'Iframes, Kaltura, script text and 64 srcset alternatives produce no guessed media requests');
  assert.equal(await imageIntegrated.page.evaluate(()=>window.__CTI_PUBLISHER_IMAGE_EXECUTED===true),false);
  const imageCheckpoint=await checkpointSnapshot(imageIntegrated.page);
  assert.equal(imageCheckpoint.bodies.length,1,'The exact PNG is stored once across both native placements');
  assert.equal(imageCheckpoint.bodies[0].blob.sha256,firstPublisherImage.sha256);
  const imageArchive=await JSZip.loadAsync(fs.readFileSync(await imageIntegrated.contextDownloads[0].download.path()),{checkCRC32:true});
  assert.deepEqual(await imageArchive.file(firstPublisherImage.archivePath).async('nodebuffer'),pngBytes);
  const corruptImageBytes=Buffer.from(pngBytes);corruptImageBytes[corruptImageBytes.length-1]^=1;
  imageArchive.file(firstPublisherImage.archivePath,corruptImageBytes,{createFolders:false});
  const corruptImageArchive=await imageArchive.generateAsync({type:'nodebuffer',compression:'STORE'});
  await assert.rejects(()=>readCourseraCaptureFileJson(new File([corruptImageArchive],'publisher-image-corrupt.cti.zip',{type:'application/zip'})),/original file SHA-256 differs from its path/,
    'Recomputed ZIP CRC cannot conceal a changed archived original image');
  const imageResumeNativeStart=requests.length,imageResumeMediaStart=publisherImageRequests.length;
  const imageResumeDownload=imageIntegrated.page.waitForEvent('download',{timeout:180000});
  await imageIntegrated.page.reload();await launch(imageIntegrated.page,imageIntegrated.context);
  const imageResumeState=await terminal(imageIntegrated.page),imageResumeCapture=await readFile(await imageResumeDownload);
  assert.equal(imageResumeState.runId,imageIntegrated.state.runId);
  const resumedPublisherImage=assertPublisherImageCapture(imageResumeCapture);
  assert.notEqual(resumedPublisherImage.receipt.observedAt,firstPublisherImage.receipt.observedAt,
    'A mutable publisher URL receives fresh image bytes and a fresh observation on a new attempt');
  assert.equal(publisherImageRequests.length-imageResumeMediaStart,5);
  const imageResumedCheckpoint=await checkpointSnapshot(imageIntegrated.page);
  assert.deepEqual(imageResumedCheckpoint.bodies,imageCheckpoint.bodies);
  assert.deepEqual(imageResumedCheckpoint.definitions,imageCheckpoint.definitions);assert.deepEqual(imageResumedCheckpoint.groups,imageCheckpoint.groups);
  assert(!requests.slice(imageResumeNativeStart).some(request=>[groupResource,definitionResource].includes(request.resource)));
  const mainPublisherImage=publisherImages.get(publisherImageBase+'main.png');mainPublisherImage.mode='no-cors';
  const failedImageRefreshStart=publisherImageRequests.length,failedImageDownload=imageIntegrated.page.waitForEvent('download',{timeout:180000});
  await imageIntegrated.page.reload();await launch(imageIntegrated.page,imageIntegrated.context);
  const failedImageState=await terminal(imageIntegrated.page),failedImageCapture=await readFile(await failedImageDownload);
  assert.equal(failedImageState.runId,imageIntegrated.state.runId);assert.equal(publisherImageRequests.length-failedImageRefreshStart,5);
  for(const fp of failedImageCapture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence)){
    const page=fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
    assert.equal(page.observation.model.rawJson,publisherImageCase.rawJson);assert.equal(page.failures.length,0,
      'A failed raster request never discards the separately captured publisher JSON');
    assert(directPublisherMediaEvidenceV1(page.observation,page.targetUrl,page.media,bytes=>createHash('sha256').update(bytes).digest('hex')));
    const current=page.media.resources.find(resource=>resource.url===publisherImageBase+'main.png');
    assert.equal(current.reason,'PUBLISHER_IMAGE_HELPER_OPERATION_UNSUPPORTED');assert.equal(current.attempts[0].reason,'PUBLISHER_IMAGE_BLOCKED_OR_FAILED');assert.equal(current.body,undefined);
    assert.equal(page.media.retained.length,1);const retained=page.media.retained[0];
    assert.equal(retained.observation.model.rawJson,publisherImageCase.rawJson);
    const old=retained.resources.find(resource=>resource.url===publisherImageBase+'main.png').body;
    assert.deepEqual(old,resumedPublisherImage,'A failed fresh request keeps the exact prior body descriptor and receipt date');
    assert.deepEqual(Buffer.from(old.bytes),pngBytes);assert.equal(fp.captureContract.complete,false);
  }
  const failedImageCheckpoint=await checkpointSnapshot(imageIntegrated.page);
  assert.deepEqual(failedImageCheckpoint.bodies,imageResumedCheckpoint.bodies);
  const failedImageZip=await JSZip.loadAsync(fs.readFileSync(await imageIntegrated.contextDownloads.at(-1).download.path()),{checkCRC32:true});
  assert.deepEqual(await failedImageZip.file(firstPublisherImage.archivePath).async('nodebuffer'),pngBytes);

  // A fresh image response acquired before a failed final native consistency
  // read is diagnostic only. Its local staged Blob cannot own an archive entry, and must not
  // prevent exporting the independently valid earlier primary observation.
  mainPublisherImage.mode='allowed';const oldPublisherImageBytes=mainPublisherImage.body;
  mainPublisherImage.body=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const unownedImageHash=createHash('sha256').update(mainPublisherImage.body).digest('hex');assert.notEqual(unownedImageHash,firstPublisherImage.sha256);
  publisherImageCourse.mode='publisher-final-binding-failed';
  publisherImageCourse.failFinalAtomAfter=new Map([...publisherImageCourse.atomGets].map(([id,count])=>[id,count+1]));
  const failedNativeImageStart=publisherImageRequests.length,failedNativeImageDownload=imageIntegrated.page.waitForEvent('download',{timeout:180000});
  await imageIntegrated.page.reload();await launch(imageIntegrated.page,imageIntegrated.context);
  const failedNativeState=await terminal(imageIntegrated.page),failedNativeCapture=await readFile(await failedNativeImageDownload);
  assert.equal(failedNativeState.runId,imageIntegrated.state.runId);assert.equal(failedNativeState.state,'INCOMPLETE');
  assert.equal(publisherImageRequests.length-failedNativeImageStart,5);
  for(const fp of failedNativeCapture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence)){
    assert.equal(fp.payload.directResumeRevalidation.verified,false);assert.equal(fp.captureContract.complete,false);
    const saved=fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0],attempt=fp.payload.directInlineWidgetProviderAttempt.providers[0].publisherPages[0];
    assert.equal(saved.observation.model.rawJson,publisherImageCase.rawJson);assert.equal(attempt.observation.model.rawJson,publisherImageCase.rawJson);
    const retained=saved.media.retained.flatMap(group=>group.resources).find(resource=>resource.url===publisherImageBase+'main.png');
    assert.deepEqual(retained.body,resumedPublisherImage);assert.deepEqual(Buffer.from(retained.body.bytes),pngBytes);
    const unowned=attempt.media.resources.find(resource=>resource.url===publisherImageBase+'main.png');
    assert.equal(unowned.reason,'PUBLISHER_IMAGE_NATIVE_BINDING_UNVERIFIED');assert.equal(unowned.body,undefined);
    assert.equal(unowned.unretainedBody.sha256,unownedImageHash);assert.equal(unowned.unretainedBody.archivePath,undefined);
    assert.equal(unowned.unretainedBody.receipt.sourceSha256,attempt.observation.model.sha256);
    assert(attempt.observation.receipt.originalResponseSha256&&fp.payload.directResumeRevalidation.atomReceipt,
      'The failed current native/source observations remain available without promoting an unowned body');
  }
  const failedNativeZip=await JSZip.loadAsync(fs.readFileSync(await imageIntegrated.contextDownloads.at(-1).download.path()),{checkCRC32:true});
  assert.equal(failedNativeZip.file('files/'+unownedImageHash),null);assert.deepEqual(await failedNativeZip.file(firstPublisherImage.archivePath).async('nodebuffer'),pngBytes);
  const stagedFailedNative=await checkpointSnapshot(imageIntegrated.page),unownedLocal=stagedFailedNative.bodies.filter(row=>row.sha256===unownedImageHash);
  assert.equal(unownedLocal.length,1,'A locally staged immutable Blob may remain after final native validation fails');
  assert.equal(unownedLocal[0].blob.sha256,unownedImageHash);assert.equal(unownedLocal[0].metadata.kind,'PUBLISHER_IMAGE');
  assert.deepEqual(stagedFailedNative.bodies.filter(row=>row.sha256!==unownedImageHash),imageResumedCheckpoint.bodies,
    'Early staging preserves the valid earlier original Blob and metadata');
  const acceptedFileRefs=[];
  const collectAcceptedFileRefs=value=>{if(!value||typeof value!=='object')return;if(value.body?.archivePath)acceptedFileRefs.push(value.body);for(const child of Object.values(value))collectAcceptedFileRefs(child);};
  for(const row of stagedFailedNative.items)collectAcceptedFileRefs(row.fingerprint);
  assert(!acceptedFileRefs.some(body=>body.sha256===unownedImageHash),
    'A staged local Blob is not an accepted item/file ownership reference or export claim');
  mainPublisherImage.body=oldPublisherImageBytes;publisherImageCourse.mode='complete';
  await assertNoEditor(imageIntegrated.page,imageIntegrated.destinations);await imageIntegrated.context.close();
  const serviceImageBrowserStart=publisherImageRequests.length,serviceImageApiStart=helperRequests.length,serviceImageUpstreamStart=helperUpstreamRequests.length;
  const serviceImage=await runFileCase(publisherServiceCourse);
  function servicePublisherPage(capture){return capture.fingerprints.find(fp=>fp.id==='item_0002').payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];}
  function assertServicePublisherOriginal(capture){
    const placements=capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence);assert.equal(placements.length,2);
    for(const fp of placements){
      const provider=fp.payload.directInlineWidgetProviderEvidence.providers[0],page=provider.publisherPages[0],resource=page.media.resources[0],body=resource.body;
      assert.equal(page.observation.model.rawJson,publisherServiceCase.rawJson);assert.equal(page.failures.length,0);
      assert(directPublisherMediaEvidenceV1(page.observation,page.targetUrl,page.media,bytes=>createHash('sha256').update(bytes).digest('hex')));
      assert.equal(resource.url,publisherServiceImageUrl);assert.equal(resource.references.length,2);assert.equal(resource.reason,undefined);
      assert(body?.bytes instanceof Uint8Array);assert.deepEqual(Buffer.from(body.bytes),publisherServiceBytes);
      assert.equal(body.size,publisherServiceBytes.length);assert.equal(body.sha256,createHash('sha256').update(publisherServiceBytes).digest('hex'));
      assert.equal(body.archivePath,'files/'+body.sha256);const receipt=body.receipt;
      assert.equal(receipt.transport,'CTI_SERVICE_PUBLIC_IMAGE');assert.equal(receipt.responseType,'service');assert.equal(receipt.credentials,'omit');
      assert.equal(receipt.sourceSha256,page.observation.model.sha256);assert.equal(receipt.publisherSourceHash,page.observation.model.sha256);
      assert.equal(receipt.serviceOrigin,helperOrigin);assert.equal(receipt.serviceStatus,200);assert.equal(receipt.upstreamStatus,200);assert.equal(receipt.upstreamRequests,1);
      assert.equal(receipt.declaredBodyBytes,body.size);assert.equal(receipt.upstreamBytes,body.size);assert.equal(receipt.upstreamSha256,body.sha256);
      assert.equal(receipt.browserAttempt.transport,'BROWSER_PUBLISHER_IMAGE');assert.equal(receipt.browserAttempt.status,0);
      assert.equal(receipt.browserAttempt.responseType,'unreadable');assert.equal(receipt.browserAttempt.reason,'PUBLISHER_IMAGE_BLOCKED_OR_FAILED');
      assert.equal(receipt.observedAtBasis,'BROWSER_RESPONSE');assert(Number.isFinite(Date.parse(receipt.upstreamObservedAt)));
      assert.equal(fp.captureContract.complete,false);assert.equal(provider.bodyVerified,false);assert.equal(provider.wholeWidgetVerified,false);
    }
    assert.equal(capture.meta.directDataCapture.coverage.questions,10);assert.equal(evaluateCourseraCapture(capture,publisherServiceCourse.id).complete,false);
    return servicePublisherPage(capture).media.resources[0].body;
  }
  const serviceOriginal=assertServicePublisherOriginal(serviceImage.capture);
  assert.equal(publisherImageRequests.length-serviceImageBrowserStart,1,'The browser first makes one real CORS-denied literal image request');
  const firstServiceCalls=helperRequests.slice(serviceImageApiStart).filter(request=>request.courseId===publisherServiceCourse.id);
  assert.equal(firstServiceCalls.length,1);assert.equal(firstServiceCalls[0].kind,'publisher-image');
  assert.equal(helperUpstreamRequests.slice(serviceImageUpstreamStart).filter(request=>request.role==='PUBLISHER_IMAGE').length,1,
    'The maintained service uses one public credentialless GET, shared across the two native placements');
  const serviceFrames=await serviceImage.page.evaluate(()=>window.fixtureProviderFrames),chunks=serviceFrames.filter(frame=>frame.type==='chunk'),jobs=new Map();
  for(const frame of chunks){if(!jobs.has(frame.id))jobs.set(frame.id,[]);jobs.get(frame.id).push(frame);}
  const imageChunks=[...jobs.values()].find(frames=>frames.reduce((sum,frame)=>sum+frame.bytes,0)===publisherServiceBytes.length);
  assert(imageChunks?.length>=3,'The actual authenticated helper streams the original raster over several bounded postMessage pulls');
  let imageOffset=0;for(const [index,frame] of imageChunks.entries()){assert.equal(frame.seq,index);assert.equal(frame.offset,imageOffset);assert(frame.bytes>0&&frame.bytes<=65536);assert.equal(frame.origin,helperOrigin);imageOffset+=frame.bytes;}
  assert(serviceFrames.some(frame=>frame.type==='ready'&&frame.operations?.includes('publisherImage')),
    'The new helper explicitly advertises image support before an image job starts');
  assert.equal(serviceImage.contextDownloads.length,1,'Only the owning Coursera tab creates one complete capture ZIP');
  const serviceCheckpoint=await checkpointSnapshot(serviceImage.page);assert.equal(serviceCheckpoint.bodies.length,1);
  assert.equal(serviceCheckpoint.bodies[0].blob.sha256,serviceOriginal.sha256);
  const serviceZip=await JSZip.loadAsync(fs.readFileSync(await serviceImage.contextDownloads[0].download.path()),{checkCRC32:true});
  assert.deepEqual(await serviceZip.file(serviceOriginal.archivePath).async('nodebuffer'),publisherServiceBytes);
  const serviceSavedAssessments=serviceImage.capture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence);
  const serviceFailures=[
    ['source-hash-tamper','PUBLISHER_IMAGE_PROVIDER_HELPER_INVALID_RESPONSE'],
    ['missing-sha-header','PUBLISHER_IMAGE_PROVIDER_HELPER_INVALID_RESPONSE'],
    ['sha-header-tamper','PUBLISHER_IMAGE_SERVICE_HASH_MISMATCH'],
    ['body-sha-tamper','PUBLISHER_IMAGE_SERVICE_HASH_MISMATCH'],
    ['mime-header-tamper','PUBLISHER_IMAGE_MIME_OR_RANGE_UNSUPPORTED'],
    ['length-tamper','PUBLISHER_IMAGE_SERVICE_BLOCKED_OR_FAILED'],
    ['clean-short-eof','PUBLISHER_IMAGE_SERVICE_BLOCKED_OR_FAILED'],
    ['upstream-denied','PUBLISHER_IMAGE_UPSTREAM_HTTP_403'],
  ];
  for(const [mode,reason] of serviceFailures){
    publisherServiceCourse.publisherServiceMode=mode;
    const browserStart=publisherImageRequests.length,apiStart=helperRequests.length,upstreamStart=helperUpstreamRequests.length,nativeStart=requests.length;
    const downloading=serviceImage.page.waitForEvent('download',{timeout:180000});
    await serviceImage.page.reload();await launch(serviceImage.page,serviceImage.context);
    const state=await terminal(serviceImage.page),capture=await readFile(await downloading);
    assert.equal(state.runId,serviceImage.state.runId);assert.equal(state.state,'INCOMPLETE');
    assert.equal(publisherImageRequests.length-browserStart,1);assert.equal(helperRequests.length-apiStart,1);
    assert.equal(helperUpstreamRequests.length-upstreamStart,1,'A failed service frame never causes a second upstream GET');
    for(const fp of capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence)){
      const page=fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0],current=page.media.resources[0];
      assert.equal(page.observation.model.rawJson,publisherServiceCase.rawJson);assert.equal(page.failures.length,0);
      assert.equal(current.body,undefined);assert.equal(current.reason,reason,'Exact service trust-boundary failure for '+mode);
      assert.equal(current.attempts.length,2);assert.equal(current.attempts[0].status,0);assert.equal(current.attempts[0].reason,'PUBLISHER_IMAGE_BLOCKED_OR_FAILED');
      assert.equal(current.attempts[1].transport,'CTI_SERVICE_PUBLIC_IMAGE');assert.equal(current.attempts[1].reason,reason);
      assert.equal(page.media.retained.length,1);assert.deepEqual(page.media.retained[0].resources[0].body,serviceOriginal,
        'A failed current service read preserves original native-bound image bytes and observation date');
      assert.deepEqual(Buffer.from(page.media.retained[0].resources[0].body.bytes),publisherServiceBytes);
      assert(directPublisherMediaEvidenceV1(page.observation,page.targetUrl,page.media,bytes=>createHash('sha256').update(bytes).digest('hex')));
      assert.equal(fp.captureContract.complete,false);
    }
    assert.deepEqual(capture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),serviceSavedAssessments);
    assert(!requests.slice(nativeStart).some(request=>[groupResource,definitionResource].includes(request.resource)));
    const saved=await checkpointSnapshot(serviceImage.page);assert.deepEqual(saved.bodies,serviceCheckpoint.bodies);
    const archive=await JSZip.loadAsync(fs.readFileSync(await serviceImage.contextDownloads.at(-1).download.path()),{checkCRC32:true});
    assert.deepEqual(await archive.file(serviceOriginal.archivePath).async('nodebuffer'),publisherServiceBytes);
  }
  publisherServiceCourse.publisherServiceMode='ready';
  const actualServiceImage=publisherImages.get(publisherServiceImageUrl),priorServiceBytes=actualServiceImage.body;
  actualServiceImage.body=Buffer.concat([pngBytes.subarray(0,-12),fixturePngTextChunk('Different unowned service image.'),pngBytes.subarray(-12)]);
  const unownedServiceHash=createHash('sha256').update(actualServiceImage.body).digest('hex');assert.notEqual(unownedServiceHash,serviceOriginal.sha256);
  publisherServiceCourse.mode='publisher-service-final-binding-failed';
  publisherServiceCourse.failFinalAtomAfter=new Map([...publisherServiceCourse.atomGets].map(([id,count])=>[id,count+1]));
  const failedServiceNativeDownload=serviceImage.page.waitForEvent('download',{timeout:180000});
  await serviceImage.page.reload();await launch(serviceImage.page,serviceImage.context);
  const failedServiceState=await terminal(serviceImage.page),failedServiceCapture=await readFile(await failedServiceNativeDownload);
  assert.equal(failedServiceState.runId,serviceImage.state.runId);assert.equal(failedServiceState.state,'INCOMPLETE');
  for(const fp of failedServiceCapture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence)){
    assert.equal(fp.payload.directResumeRevalidation.verified,false);
    const old=fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0],attempt=fp.payload.directInlineWidgetProviderAttempt.providers[0].publisherPages[0];
    assert.equal(old.observation.model.rawJson,publisherServiceCase.rawJson);assert.equal(attempt.observation.model.rawJson,publisherServiceCase.rawJson);
    assert.deepEqual(old.media.retained[0].resources[0].body,serviceOriginal);
    const unowned=attempt.media.resources[0];assert.equal(unowned.body,undefined);assert.equal(unowned.reason,'PUBLISHER_IMAGE_NATIVE_BINDING_UNVERIFIED');
    assert.equal(unowned.unretainedBody.sha256,unownedServiceHash);assert.equal(unowned.unretainedBody.archivePath,undefined);
    assert.equal(unowned.unretainedBody.receipt.transport,'CTI_SERVICE_PUBLIC_IMAGE');assert.equal(unowned.unretainedBody.receipt.publisherSourceHash,attempt.observation.model.sha256);
  }
  const failedServiceZip=await JSZip.loadAsync(fs.readFileSync(await serviceImage.contextDownloads.at(-1).download.path()),{checkCRC32:true});
  assert.equal(failedServiceZip.file('files/'+unownedServiceHash),null);assert.deepEqual(await failedServiceZip.file(serviceOriginal.archivePath).async('nodebuffer'),publisherServiceBytes);
  const stagedService=await checkpointSnapshot(serviceImage.page),unownedServiceRows=stagedService.bodies.filter(row=>row.sha256===unownedServiceHash);
  assert.equal(unownedServiceRows.length,1);assert.equal(unownedServiceRows[0].blob.sha256,unownedServiceHash);
  const serviceOwnership=[];for(const row of stagedService.items){const walk=value=>{if(!value||typeof value!=='object')return;if(value.body?.archivePath)serviceOwnership.push(value.body);for(const child of Object.values(value))walk(child);};walk(row.fingerprint);}
  assert(!serviceOwnership.some(body=>body.sha256===unownedServiceHash),'Public-service staging cannot assign ownership after a failed native consistency read');
  actualServiceImage.body=priorServiceBytes;publisherServiceCourse.mode='complete';
  await assertNoEditor(serviceImage.page,serviceImage.destinations);await serviceImage.context.close();
  const challengeBrowserStart=publisherImageRequests.length,challengeServiceStart=helperRequests.length,challengeUpstreamStart=helperUpstreamRequests.length;
  const challengedImages=await runFileCase(publisherChallengeCourse);
  assert.equal(challengedImages.state.state,'INCOMPLETE');
  assert.equal(publisherImageRequests.length-challengeBrowserStart,2,
    'The browser still attempts each literal image with its own real CORS result');
  const challengeServiceCalls=helperRequests.slice(challengeServiceStart).filter(request=>request.courseId===publisherChallengeCourse.id);
  const challengeUpstreamCalls=helperUpstreamRequests.slice(challengeUpstreamStart).filter(request=>request.courseId===publisherChallengeCourse.id);
  assert.equal(challengeServiceCalls.length,1);assert.equal(challengeServiceCalls[0].kind,'publisher-image');
  assert.equal(challengeUpstreamCalls.length,1);assert.equal(challengeUpstreamCalls[0].role,'PUBLISHER_IMAGE');
  assert(publisherChallengeUrls.includes(challengeUpstreamCalls[0].url),
    'One observed publisher challenge stops subsequent same-origin service GETs, including duplicate native placements');
  const challengeAssessments=challengedImages.capture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence);
  for(const fp of challengedImages.capture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence)){
    const provider=fp.payload.directInlineWidgetProviderEvidence.providers[0],page=provider.publisherPages[0];
    assert.equal(page.observation.model.rawJson,publisherChallengeCase.rawJson);assert.deepEqual(page.failures,[]);
    assert(directPublisherMediaEvidenceV1(page.observation,page.targetUrl,page.media,bytes=>createHash('sha256').update(bytes).digest('hex')));
    assert.deepEqual(page.media.resources.map(resource=>resource.url),publisherChallengeUrls,'Resource order stays literal even when CORS failures finish out of order');
    const trigger=page.media.resources.find(resource=>resource.url===challengeUpstreamCalls[0].url),
      skipped=page.media.resources.find(resource=>resource.url!==challengeUpstreamCalls[0].url);
    assert(trigger&&skipped);assert.equal(trigger.body,undefined);assert.equal(skipped.body,undefined);
    assert.equal(trigger.reason,'PUBLISHER_IMAGE_UPSTREAM_CHALLENGE');assert.equal(trigger.attempts.length,2);
    assert.equal(trigger.attempts[0].reason,'PUBLISHER_IMAGE_BLOCKED_OR_FAILED');assert.equal(trigger.attempts[0].status,0);
    assert.equal(trigger.attempts[1].upstreamChallenge,'cloudflare');assert.equal(trigger.attempts[1].serviceStatus,502);
    assert.equal(trigger.attempts[1].upstreamStatus,403);assert.equal(trigger.attempts[1].upstreamRequests,1);assert.equal(trigger.attempts[1].upstreamBytes,0);
    assert.equal(trigger.attempts[1].notAttempted,undefined);assert(Number.isFinite(Date.parse(trigger.attempts[1].upstreamObservedAt)));
    assert.equal(skipped.reason,'PUBLISHER_IMAGE_SERVICE_ORIGIN_CHALLENGE_NOT_ATTEMPTED');assert.equal(skipped.attempts.length,2);
    assert.equal(skipped.attempts[0].reason,'PUBLISHER_IMAGE_BLOCKED_OR_FAILED');assert.equal(skipped.attempts[0].status,0);
    assert.equal(skipped.attempts[1].notAttempted,'ORIGIN_CHALLENGE');assert.equal(skipped.attempts[1].upstreamChallenge,undefined);
    assert.equal(skipped.attempts[1].serviceStatus,0);assert.equal(skipped.attempts[1].upstreamStatus,0);
    assert.equal(skipped.attempts[1].upstreamObservedAt,'');assert.equal(skipped.attempts[1].upstreamRequests,0);assert.equal(skipped.attempts[1].upstreamBytes,0);
    assert.deepEqual(skipped.attempts[1].blockedBy,{url:trigger.url,observedAt:trigger.attempts[1].observedAt});
    assert.equal(fp.captureContract.complete,false);assert.equal(provider.bodyVerified,false);assert.equal(provider.wholeWidgetVerified,false);
    const report=courseraInlineWidgetContent(fp,publisherChallengeCourse.id);assert(report);
    const reportMedia=report.providers[0].publisherPages[0].media;assert.equal(reportMedia.resources.length,2);
    for(const resource of reportMedia.resources){
      assert.equal(resource.status,'UNRESOLVED');assert.equal(resource.originalRef,'');assert.equal(resource.bytes,null);
      assert.deepEqual(resource.attempts,page.media.resources.find(value=>value.url===resource.url).attempts,
        'Archive acceptance and report projection preserve the complete actual-attempt or not-attempted context');
    }
    const text=courseraInlineWidgetContentText(report);
    assert(text.includes(trigger.url)&&text.includes(skipped.url));assert.match(text,/Publisher returned a Cloudflare challenge/);
    assert.match(text,/CTI image service not attempted/);assert.match(text,/No publisher HTTP result was observed for this skipped read/);
  }
  assert.equal(challengedImages.capture.meta.directDataCapture.coverage.questions,10);
  assert.equal(evaluateCourseraCapture(challengedImages.capture,publisherChallengeCourse.id).complete,false);
  const challengeCheckpoint=await checkpointSnapshot(challengedImages.page);assert.equal(challengeCheckpoint.bodies.length,0);
  const challengeZip=await JSZip.loadAsync(fs.readFileSync(await challengedImages.contextDownloads[0].download.path()),{checkCRC32:true});
  assert.equal(Object.keys(challengeZip.files).filter(name=>/^files\/[a-f0-9]{64}$/.test(name)).length,0,
    'Challenge pages and skipped sources never become retained image originals');
  publisherChallengeCourse.publisherServiceMode='ready';
  const challengeResumeBrowserStart=publisherImageRequests.length,challengeResumeServiceStart=helperRequests.length,
    challengeResumeUpstreamStart=helperUpstreamRequests.length,challengeResumeNativeStart=requests.length;
  const challengeResumeDownload=challengedImages.page.waitForEvent('download',{timeout:180000});
  await challengedImages.page.reload();await launch(challengedImages.page,challengedImages.context);
  const challengeResumeState=await terminal(challengedImages.page),challengeResumeCapture=await readFile(await challengeResumeDownload);
  assert.equal(challengeResumeState.runId,challengedImages.state.runId);assert.equal(challengeResumeState.state,'INCOMPLETE');
  assert.equal(publisherImageRequests.length-challengeResumeBrowserStart,2);
  assert.equal(helperRequests.slice(challengeResumeServiceStart).filter(request=>request.courseId===publisherChallengeCourse.id).length,2);
  assert.equal(helperUpstreamRequests.slice(challengeResumeUpstreamStart).filter(request=>request.courseId===publisherChallengeCourse.id).length,2,
    'An explicit Capture/resume creates a fresh reader and retries both unresolved images; challenge suppression is never permanent');
  for(const fp of challengeResumeCapture.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence)){
    const provider=fp.payload.directInlineWidgetProviderEvidence.providers[0],page=provider.publisherPages[0];
    assert.equal(page.observation.model.rawJson,publisherChallengeCase.rawJson);
    for(const resource of page.media.resources){
      assert(publisherChallengeUrls.includes(resource.url));assert(resource.body?.bytes instanceof Uint8Array);
      assert.deepEqual(Buffer.from(resource.body.bytes),publisherImages.get(resource.url).body);
      assert.equal(resource.body.receipt.transport,'CTI_SERVICE_PUBLIC_IMAGE');assert.equal(resource.body.receipt.upstreamStatus,200);
      assert.equal(resource.reason,undefined);assert.equal(resource.attempts,undefined);
    }
    assert.equal(fp.captureContract.complete,false);assert.equal(provider.bodyVerified,false);assert.equal(provider.wholeWidgetVerified,false);
  }
  assert.deepEqual(challengeResumeCapture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),challengeAssessments);
  assert(!requests.slice(challengeResumeNativeStart).some(request=>[groupResource,definitionResource].includes(request.resource)));
  assert.equal(evaluateCourseraCapture(challengeResumeCapture,publisherChallengeCourse.id).complete,false);
  assert.equal(challengedImages.contextDownloads.length,2);await assertNoEditor(challengedImages.page,challengedImages.destinations);
  await challengedImages.context.close();

  // The original one-click course capture still records blocked image bytes
  // honestly. Recovery is an explicit extra publisher-tab action with the SAME
  // generated bookmark, normal browser cookies kept local to that publisher.
  const firstPartyTarget=await runFileCase(firstPartyPublisher.config),firstPartyBefore=firstPartyTarget.capture,
    firstPartyAssessments=firstPartyBefore.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),
    firstPartyOriginalPages=firstPartyBefore.fingerprints.filter(fp=>fp.payload.directInlineWidgetProviderEvidence),
    firstPartyNativeStart=requests.length,firstPartyBodyStart=firstPartyPublisherRequests.length,
    firstPartyApiStart=publisherRequests.length,firstPartyServiceStart=helperRequests.length;
  assert.equal(firstPartyTarget.state.state,'INCOMPLETE');
  assert.equal(firstPartyOriginalPages.length,2);
  for(const fp of firstPartyOriginalPages)assert(fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0].media.resources.every(resource=>!resource.body));
  await firstPartyTarget.page.getByRole('button',{name:'Prepare publisher recovery',exact:true}).click();
  await firstPartyTarget.page.getByRole('button',{name:'Open publisher recovery',exact:true}).waitFor();
  assert.equal(firstPartyPublisherRequests.length,firstPartyBodyStart,'Preparation does not read publisher bytes or silently open another origin');
  const firstPartyPopupEvent=firstPartyTarget.context.waitForEvent('page'),firstPartyDownload=firstPartyTarget.page.waitForEvent('download',{timeout:180000});
  void firstPartyDownload.catch(()=>{});
  await firstPartyTarget.page.getByRole('button',{name:'Open publisher recovery',exact:true}).click();
  const firstPartyPopup=await firstPartyPopupEvent;
  await firstPartyPopup.waitForURL(value=>value.origin===publisherOrigin&&value.hash.includes('cti-publisher-recovery=1'));
  await firstPartyPopup.waitForLoadState('domcontentloaded');
  assert.equal(new URL(firstPartyPopup.url()).origin,publisherOrigin);
  assert(new URL(firstPartyPopup.url()).hash.includes('cti-publisher-recovery=1'));
  assert.equal(await firstPartyPopup.evaluate(()=>window.opener!==null),true);
  assert.equal(firstPartyPublisherRequests.length,firstPartyBodyStart,'Opening the normal publisher page does not start recovery before the operator invokes the bookmark');
  await launchFirstPartyBookmark(firstPartyPopup,firstPartyTarget.context);
  const firstPartyCapture=await readFile(await firstPartyDownload),firstPartyState=await terminal(firstPartyTarget.page),
    firstPartyObserved=firstPartyPublisherRequests.slice(firstPartyBodyStart);
  assert.equal(firstPartyState.runId,firstPartyTarget.state.runId);assert.equal(firstPartyState.state,'INCOMPLETE');
  assert.equal(firstPartyObserved.length,4,'Two separate native placements have four exact source-bound first-party image reads');
  assert(firstPartyObserved.every(value=>value.courseId===firstPartyPublisher.config.id&&value.fetchMode==='same-origin'&&value.publisherCookiePresent&&!value.courseraCookiePresent&&!value.authorizationPresent));
  assert.equal(helperRequests.length,firstPartyServiceStart,'First-party recovery does not retry the challenged public CTI image service');
  assert.equal(publisherRequests.length,firstPartyApiStart,'Retained exact publisher JSON keeps its original observation and is not relabelled as a new API read');
  const firstPartyNativeReads=requests.slice(firstPartyNativeStart).filter(value=>value.courseId===firstPartyPublisher.config.id);
  assert(!firstPartyNativeReads.some(value=>value.resource===definitionResource),'Publisher recovery retains exact-version definition observations without redownloading them');
  assert(firstPartyNativeReads.some(value=>value.resource===groupResource),'Recovery also refreshes mutable native question groups rather than trusting a saved completion label');
  for(const fp of firstPartyCapture.fingerprints.filter(value=>value.payload.directInlineWidgetProviderEvidence)){
    const prior=firstPartyOriginalPages.find(value=>value.id===fp.id).payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0],
      provider=fp.payload.directInlineWidgetProviderEvidence.providers[0],page=provider.publisherPages[0];
    assert.deepEqual(page.observation,prior.observation,'Original publisher JSON, hashes, receipts and observation dates remain unchanged');
    assert(directPublisherMediaEvidenceV1(page.observation,page.targetUrl,page.media,bytes=>createHash('sha256').update(bytes).digest('hex')));
    for(const resource of page.media.resources){
      const old=prior.media.resources.find(value=>value.url===resource.url),body=resource.body,receipt=body?.receipt;
      assert(body?.bytes instanceof Uint8Array);assert.deepEqual(Buffer.from(body.bytes),publisherImages.get(resource.url).body);
      assert.equal(body.sha256,createHash('sha256').update(publisherImages.get(resource.url).body).digest('hex'));
      assert.equal(receipt.transport,'FIRST_PARTY_BROWSER');assert.equal(receipt.collectorContext,'PROVIDER_PAGE_BROWSER');
      assert.equal(receipt.responseType,'basic');assert.equal(receipt.credentials,'same-origin');assert.equal(receipt.mode,'same-origin');
      assert.equal(receipt.firstPartyBinding.courseId,firstPartyPublisher.config.id);assert.equal(receipt.firstPartyBinding.itemId,fp.id);
      assert.equal(receipt.firstPartyBinding.atomId,fp.atomId);assert.equal(receipt.firstPartyBinding.providerId,provider.providerId);
      assert.equal(receipt.firstPartyBinding.targetUrl,page.targetUrl);assert.equal(receipt.firstPartyBinding.sourceSha256,page.observation.model.sha256);
      assert.match(receipt.firstPartyBinding.planSha256,/^[a-f0-9]{64}$/);assert.match(receipt.firstPartyBinding.sessionId,/^[a-f0-9]{32}$/);
      assert(resource.priorFailures.some(value=>value.reason===old.reason&&directCanonicalSourceTextV1(value.attempts)===directCanonicalSourceTextV1(old.attempts)),
        'The actual earlier public-service 403 or deferred read stays separately retained beside the later original body');
    }
    const atomReads=firstPartyNativeReads.filter(value=>value.resource==='authoringAtoms.v2'&&value.reference===fp.atomId);
    assert(atomReads.length>=2,'Fresh native atom reads bracket first-party byte acquisition before archive acceptance');
    assert.equal(provider.bodyVerified,false);assert.equal(provider.wholeWidgetVerified,false);assert.equal(fp.captureContract.complete,false);
  }
  for(const prior of firstPartyAssessments){
    const current=firstPartyCapture.fingerprints.find(fp=>fp.id===prior.id),before=prior.payload.assessmentApiEvidence,after=current.payload.assessmentApiEvidence,
      exactBefore=new Map(before.questionDefinitions.map(value=>[value.id,value])),exactAfter=new Map(after.questionDefinitions.map(value=>[value.id,value]));
    assert.deepEqual(current.payload.structuredAssessment.questions,prior.payload.structuredAssessment.questions,
      'Normalized questions retain their authored order, answers and original definition observation dates');
    assert.equal(exactAfter.size,exactBefore.size);assert.equal(after.questionDefinitions.length,before.questionDefinitions.length);
    for(const [id,definition]of exactAfter)assert.deepEqual(definition,exactBefore.get(id));
    for(const receipt of before.receipts.filter(value=>value.resource===definitionResource))
      assert.deepEqual(after.receipts.find(value=>value.resource===definitionResource&&value.id===receipt.id),receipt);
  }
  assert.equal(evaluateCourseraCapture(firstPartyCapture,firstPartyPublisher.config.id).complete,false);
  assert.equal(firstPartyTarget.contextDownloads.length,2);assert(firstPartyTarget.contextDownloads.every(value=>value.page===firstPartyTarget.page));
  assert(!JSON.stringify(firstPartyCapture).includes('publisher-local-only'),'Publisher cookies are not retained or forwarded in evidence');
  const firstPartyZip=await JSZip.loadAsync(fs.readFileSync(await firstPartyTarget.contextDownloads[1].download.path()),{checkCRC32:true});
  assert.equal(Object.keys(firstPartyZip.files).filter(name=>/^files\/[a-f0-9]{64}$/.test(name)).length,2,'Original ZIP bytes are deduplicated independently of native placements');
  await assertNoEditor(firstPartyTarget.page,firstPartyTarget.destinations);await firstPartyTarget.context.close();

  const coopRecovery=await runFileCase(firstPartyPublisherCoop.config),coopBodyStart=firstPartyPublisherRequests.length;
  await coopRecovery.page.getByRole('button',{name:'Prepare publisher recovery',exact:true}).click();
  await coopRecovery.page.getByRole('button',{name:'Open publisher recovery',exact:true}).waitFor();
  const coopPopupEvent=coopRecovery.context.waitForEvent('page');
  await coopRecovery.page.getByRole('button',{name:'Open publisher recovery',exact:true}).click();
  const coopPublisher=await coopPopupEvent;
  await coopPublisher.waitForURL(value=>value.origin===publisherOrigin&&value.hash.includes('cti-publisher-recovery=1'));
  await coopPublisher.waitForLoadState('domcontentloaded');
  assert.equal(await coopPublisher.evaluate(()=>window.opener),null,'The synthetic provider COOP response actually severs the browser opener');
  await launchFirstPartyBookmark(coopPublisher,coopRecovery.context);
  assert.match(await coopPublisher.locator('#cti-publisher-recovery-panel').innerText(),/could not connect.*No image content is established/s);
  assert.equal(firstPartyPublisherRequests.length,coopBodyStart);assert.equal(coopRecovery.contextDownloads.length,1);
  await coopRecovery.context.close();

  const changedRecovery=await runFileCase(firstPartyPublisherChanged.config),
    changedRecoveryOld=await savedNativeRun(changedRecovery.page,changedRecovery.state.runId),
    changedRecoveryBodyStart=firstPartyPublisherRequests.length,changedRecoveryNativeStart=requests.length;
  await changedRecovery.page.getByRole('button',{name:'Prepare publisher recovery',exact:true}).click();
  await changedRecovery.page.getByRole('button',{name:'Open publisher recovery',exact:true}).waitFor();
  firstPartyPublisherChanged.config.material.material.elements.push({id:'first_party_changed_outline',name:'Changed outline after frozen recovery plan',
    elements:[],description:'',learningObjectives:[],timeCommitment:0});
  const changedRecoveryPopupEvent=changedRecovery.context.waitForEvent('page'),changedRecoveryDownload=changedRecovery.page.waitForEvent('download',{timeout:30000});
  void changedRecoveryDownload.catch(()=>{});
  await changedRecovery.page.getByRole('button',{name:'Open publisher recovery',exact:true}).click();
  const changedRecoveryPopup=await changedRecoveryPopupEvent;
  await changedRecoveryPopup.waitForURL(value=>value.origin===publisherOrigin&&value.hash.includes('cti-publisher-recovery=1'));
  await changedRecoveryPopup.waitForLoadState('domcontentloaded');
  await launchFirstPartyBookmark(changedRecoveryPopup,changedRecovery.context);
  const changedRecoveryCapture=await readFile(await changedRecoveryDownload),changedRecoveryState=await terminal(changedRecovery.page),
    changedRecoveryReads=requests.slice(changedRecoveryNativeStart).filter(value=>value.courseId===firstPartyPublisherChanged.config.id);
  assert.notEqual(changedRecoveryState.runId,changedRecovery.state.runId,'A frozen recovery plan cannot be rebound to a changed native course graph');
  assert.equal(changedRecoveryState.state,'PAUSED');assert.equal(firstPartyPublisherRequests.length,changedRecoveryBodyStart);
  assert.equal(changedRecoveryCapture.meta.directDataCapture.stopReason,'PUBLISHER_FIRST_PARTY_MATERIAL_GRAPH_CHANGED');
  assert.deepEqual(await savedNativeRun(changedRecovery.page,changedRecovery.state.runId),changedRecoveryOld,
    'A rejected recovery on a new graph preserves the complete prior run with its original source observations and spent budget');
  assert.equal(changedRecoveryCapture.meta.directDataCapture.stats.requests,changedRecoveryReads.length,
    'Current discovery requests remain charged to the separate failed run');
  assert.equal(evaluateCourseraCapture(changedRecoveryCapture,firstPartyPublisherChanged.config.id).complete,false);
  assert.equal(changedRecovery.contextDownloads.length,2);await changedRecovery.context.close();
  for(const config of [inlineWidgetWrongOwner,inlineWidgetChanged,inlineWidgetPartial]){
    const result=await runFileCase(config),fp=result.capture.fingerprints.find(item=>item.id==='item_0002'),proof=fp.payload.directInlineWidgetProviderEvidence;
    assert.equal(result.state.state,'INCOMPLETE');assert.equal(fp.captureContract.complete,false);assert(proof);
    assert(fp.payload.directDraftCml.definition.value.includes(config.inlineProviderId),'Native CML is preserved when a provider read fails');
    if(config.inlineMode==='inline-partial'){
      assert.equal(proof.providers.length,2);assert.equal(proof.providers[0].stableSource,true);
      assert.equal(proof.providers[1].stableSource,false);assert(proof.providers[1].failures.length>0);
    }else{assert.equal(proof.providers[0].stableSource,false);assert(proof.providers[0].failures.length>0);}
    assert(requests.filter(request=>request.courseId===config.id).every(request=>request.method==='GET'),'Reading inline widget metadata never launches a POST preview');
    assert.equal(evaluateCourseraCapture(result.capture,config.id).complete,false);
    await result.context.close();
  }
  const boundDiscussion=await runFileCase(discussionMedia);
  assert.equal(boundDiscussion.state.state,'COMPLETE');assertOriginalMedia(discussionMedia,boundDiscussion.capture);
  const discussion=boundDiscussion.capture.fingerprints.find(fp=>fp.id==='item_0002');
  assert.equal(discussion.captureContract.status,'COMPLETE_BOUND_DRAFT_DISCUSSION');
  assert.equal(discussion.payload.discussionPromptPermissions.viewAnswersBeforeReplying,false);
  assert.equal(discussion.payload.responses,undefined);
  await boundDiscussion.context.close();


  const largeOriginals=await runFileCase(largeMedia);
  assert.equal(largeOriginals.state.state,'COMPLETE');assertOriginalMedia(largeMedia,largeOriginals.capture);
  const largeOriginalSize=fileSizes.get(largeOriginals.capture);
  assert(largeOriginalSize.fileBytes>64*1024*1024,'One ZIP preserves more original binary bytes than the old course-wide 64 MiB cutoff');
  assert(largeOriginals.capture.meta.directDataCapture.stats.media.bytes>=72*1024*1024);
  assert.equal(largeOriginals.capture.meta.directDataCapture.stats.media.limits.totalBytes,512*1024*1024);
  await largeOriginals.context.close();

  const legacyV12=await runFileCase(mediaLegacyV12),legacyV12Bodies=retainedMediaBodies(legacyV12.capture);
  const legacySaved=await legacyV12.page.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const rows=await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','items','bodies'],'readonly'),out={};
      for(const name of ['runs','items','bodies']){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result;};}
      transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);
    });
    const encoded=new Map();
    for(const row of rows.bodies){const bytes=new Uint8Array(await row.blob.arrayBuffer());let text='';for(const byte of bytes)text+=String.fromCharCode(byte);encoded.set(row.sha256,btoa(text));}
    const run=rows.runs.at(-1);run.state='INCOMPLETE';run.reason='ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS';
    run.buildId='v1.2.0-bound-reading-media-20261014';run.captureMeta.buildId=run.buildId;
    run.captureMeta.extractor='CTI Direct Course Capture v1.2.0';run.budget.media.bytes=64*1024*1024;
    Object.assign(run.captureMeta.directDataCapture,{acquisitionComplete:true,wholeCourseVerified:false,sourceStable:true,stopReason:run.reason});
    for(const row of rows.items){
      if(row.fingerprint?.id!=='item_0002')continue;
      const fingerprint=row.fingerprint;
      fingerprint.captureContract={...fingerprint.captureContract,complete:false,status:'UNRESOLVED_DIRECT_READING',reasons:['DIRECT_MEDIA_BYTE_LIMIT']};
      fingerprint.payload.captureContract={...fingerprint.captureContract};
      for(const asset of fingerprint.payload.directAssetEvidence.assets){
        asset.body.base64=encoded.get(asset.body.sha256);delete asset.body.archivePath;
        asset.body.receipt.bodyFormat='ORIGINAL_BINARY_BYTES_BASE64';delete asset.body.receipt.originalBodyFormat;
      }
    }
    await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','items','bodies'],'readwrite');
      transaction.objectStore('runs').put(run);for(const row of rows.items)transaction.objectStore('items').put(row);transaction.objectStore('bodies').clear();
      transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
    });database.close();return{runId:run.runId,apiRequests:run.budget.requests};
  });
  mediaLegacyV12.assetGets.clear();await legacyV12.page.reload();const legacyV12Start=requests.length;
  const legacyDownloading=legacyV12.page.waitForEvent('download',{timeout:180000});void legacyDownloading.catch(()=>{});
  await launch(legacyV12.page,legacyV12.context);const legacyFinal=await terminal(legacyV12.page),legacyCapture=await readFile(await legacyDownloading);
  assert.equal(legacyFinal.runId,legacySaved.runId);assert.equal(legacyFinal.state,'COMPLETE');
  assertOriginalMedia(mediaLegacyV12,legacyCapture);
  assert.equal(legacyCapture.meta.directDataCapture.stats.media.bytes,64*1024*1024,'The old 64 MiB wire budget remains charged');
  assert(legacyCapture.meta.directDataCapture.stats.requests>=legacySaved.apiRequests);
  assert(!requests.slice(legacyV12Start).some(request=>[groupResource,definitionResource].includes(request.resource)),
    'Migrating a completed v1.2 capture into one ZIP does not recapture assessment questions');
  const migratedBodies=retainedMediaBodies(legacyCapture);
  for(const assetId of mediaLegacyV12.mediaIds){
    assert.equal(migratedBodies.get(assetId).body.receipt.observedAt,legacyV12Bodies.get(assetId).body.receipt.observedAt);
    assert.equal(migratedBodies.get(assetId).body.receipt.originalBodyFormat,'ORIGINAL_BINARY_BYTES_BASE64');
    assert.equal(mediaRequests.filter(request=>request.courseId===mediaLegacyV12.id&&request.assetId===assetId).length,1,
      'Old retained originals migrate once rather than downloading again after the 64 MiB cutoff');
  }
  assert.equal(legacyV12.downloads.length,2);await legacyV12.context.close();

  const enriching=await runFileCase(mediaEnrichment);assert.equal(enriching.state.state,'INCOMPLETE');
  assert.equal(enriching.state.counts.processed,4,'The previous run acquired the complete inventory before encountering asset gaps');
  const preservedAssessments=enriching.capture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence).map(fp=>({
    id:fp.id,atom:fp.payload.directDataSources.atom,groups:fp.payload.assessmentApiEvidence.groups,
    definitions:fp.payload.assessmentApiEvidence.questionDefinitions,questions:fp.payload.structuredAssessment.questions,
  }));
  assert.equal(preservedAssessments.length,2);
  const enrichmentLegacy=await enriching.page.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const saved=await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','items'],'readwrite'),out={};
      const runs=transaction.objectStore('runs'),request=runs.getAll();request.onsuccess=()=>{
        const row=request.result.at(-1);row.state='INCOMPLETE';row.reason='ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS';
        row.buildId='v1.1.0-compressed-resumable-drafts-20261014';row.captureMeta.buildId=row.buildId;
        row.captureMeta.directDataCapture.acquisitionComplete=true;row.captureMeta.directDataCapture.wholeCourseVerified=false;
        row.captureMeta.directDataCapture.stopReason=row.reason;runs.put(row);
        out.runId=row.runId;out.requests=row.budget.requests;out.elapsedMs=row.budget.elapsedMs;
      };
      const items=transaction.objectStore('items'),itemRequest=items.getAll();itemRequest.onsuccess=()=>{
        for(const row of itemRequest.result){
          if(row.fingerprint?.id!=='item_0002')continue;
          for(const field of Object.keys(row.fingerprint.payload))if(/media|assets?Evidence/i.test(field))delete row.fingerprint.payload[field];
          items.put(row);
        }
      };
      transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);
    });database.close();return saved;
  });
  mediaEnrichment.mode='media-success';mediaEnrichment.assetGets.clear();
  await enriching.page.reload();const enrichmentStart=requests.length;
  const enrichedDownloading=enriching.page.waitForEvent('download',{timeout:180000});void enrichedDownloading.catch(()=>{});
  await launch(enriching.page,enriching.context);const enrichedState=await terminal(enriching.page),enrichedCapture=await readFile(await enrichedDownloading);
  assert.equal(enrichedState.runId,enrichmentLegacy.runId,'Media enrichment retains the completed v1.1 run identity');
  assert.equal(enrichedState.state,'COMPLETE');assert.equal(enriching.downloads.length,2,'Each bookmark attempt produces exactly one final file');
  assert(enrichedCapture.meta.directDataCapture.stats.requests>=enrichmentLegacy.requests,
    'Enrichment preserves all requests already spent in the completed run');
  assert(enrichedCapture.meta.directDataCapture.stats.elapsedMs>=enrichmentLegacy.elapsedMs,
    'Enrichment preserves the completed run\'s cumulative active duration');
  assert(!requests.slice(enrichmentStart).some(request=>request.courseId===mediaEnrichment.id&&
    [groupResource,definitionResource].includes(request.resource)),
    'Already verified assessment groups and definitions must not be captured again to add reading media');
  for(const prior of preservedAssessments){
    const current=enrichedCapture.fingerprints.find(fp=>fp.id===prior.id);
    assert.deepEqual(current.payload.directDataSources.atom,prior.atom);
    assert.deepEqual(current.payload.assessmentApiEvidence.groups,prior.groups);
    assert.deepEqual(current.payload.assessmentApiEvidence.questionDefinitions,prior.definitions);
    assert.deepEqual(current.payload.structuredAssessment.questions,prior.questions);
  }
  assertOriginalMedia(mediaEnrichment,enrichedCapture);assertTransport(mediaEnrichment,enrichmentStart);
  await assertNoEditor(enriching.page,enriching.destinations);await enriching.context.close();

  const checkpointedMedia=await runFileCase(mediaCheckpoint);
  assert.equal(checkpointedMedia.state.state,'INCOMPLETE');
  assert.equal(retainedMediaBodies(checkpointedMedia.capture).size,0,
    'A previous reading checkpoint exists before its missing original media becomes available');
  const previousReadingRunId=checkpointedMedia.state.runId;
  mediaCheckpoint.mode='media-first-atom-failed';mediaCheckpoint.atomGets.clear();
  await checkpointedMedia.page.reload();
  const failedCurrentDownload=checkpointedMedia.page.waitForEvent('download',{timeout:180000});void failedCurrentDownload.catch(()=>{});
  await launch(checkpointedMedia.page,checkpointedMedia.context);
  const failedCurrentState=await terminal(checkpointedMedia.page),failedCurrentCapture=await readFile(await failedCurrentDownload);
  const historicalPrompt=failedCurrentCapture.fingerprints.find(fp=>fp.id==='item_0002');
  assert.equal(failedCurrentState.runId,previousReadingRunId);
  assert.equal(historicalPrompt.payload.directResumeRevalidation.verified,false);
  assert.equal(historicalPrompt.payload.directDataSources.receipts.stability.stable,true,
    'The failed current read preserves the older stable source proof as historical evidence');
  assert.equal(historicalPrompt.captureContract.complete,false);
  assert.equal(evaluateCourseraCapture(failedCurrentCapture,mediaCheckpoint.id).complete,false);
  mediaCheckpoint.mode='media-final-atom-failed';mediaCheckpoint.atomGets.clear();mediaCheckpoint.assetGets.clear();
  await checkpointedMedia.page.reload();
  const interruptedDownloading=checkpointedMedia.page.waitForEvent('download',{timeout:180000});void interruptedDownloading.catch(()=>{});
  await launch(checkpointedMedia.page,checkpointedMedia.context);
  checkpointedMedia.state=await terminal(checkpointedMedia.page);checkpointedMedia.capture=await readFile(await interruptedDownloading);
  assert.equal(checkpointedMedia.state.runId,previousReadingRunId,'New media is added to the existing saved reading run');
  assert.equal(checkpointedMedia.state.state,'INCOMPLETE');
  const failedMediaReading=checkpointedMedia.capture.fingerprints.find(fp=>fp.id==='item_0002');
  assert.equal(failedMediaReading.captureContract.complete,false,'A failed final atom read cannot certify the reading as stable');
  assert(failedMediaReading.payload.directDataSources?.atom?.elements[0]?.draft,
    'Initial native draft evidence survives a final consistency-read failure');
  assert.notEqual(failedMediaReading.payload.directDataSources.receipts.stability?.stable,true,
    'The failed consistency read cannot inherit a successful stability flag');
  const savedBodies=retainedMediaBodies(checkpointedMedia.capture);
  for(const assetId of mediaCheckpoint.mediaIds){
    const evidence=savedBodies.get(assetId),original=assets.get(assetId);
    assert(evidence?.body,'A final atom failure must preserve a successfully retained original media body');
    assert.deepEqual(Buffer.from(evidence.body.bytes),original.body);
    assert.equal(evidence.stability.stable,true,'The prior asset metadata consistency proof is retained separately from atom stability');
    assert.equal(evidence.metadata.elements[0].id,assetId);
  }
  mediaCheckpoint.mode='media-success';mediaCheckpoint.assetGets.clear();
  await checkpointedMedia.page.reload();const checkpointResumeStart=requests.length;
  const checkpointDownloading=checkpointedMedia.page.waitForEvent('download',{timeout:180000});void checkpointDownloading.catch(()=>{});
  await launch(checkpointedMedia.page,checkpointedMedia.context);
  const checkpointFinal=await terminal(checkpointedMedia.page),checkpointCapture=await readFile(await checkpointDownloading);
  assert.equal(checkpointFinal.runId,checkpointedMedia.state.runId,'Interrupted media revalidation resumes its existing run');
  assert.equal(checkpointedMedia.downloads.length,4,'Each saved-gap, failed-current-read, interrupted-media and successful-resume attempt downloads one final capture');
  assert.equal(checkpointFinal.state,'COMPLETE');assertOriginalMedia(mediaCheckpoint,checkpointCapture);
  const resumedBodies=retainedMediaBodies(checkpointCapture);
  for(const assetId of mediaCheckpoint.mediaIds){
    const previous=savedBodies.get(assetId),current=resumedBodies.get(assetId);
    assert.deepEqual(current.body,previous.body,'Reusing unchanged original bytes preserves their original receipt and observation time');
    assert.equal(mediaRequests.filter(request=>request.courseId===mediaCheckpoint.id&&request.assetId===assetId).length,1,
      'A retained valid image or attachment is not downloaded again during resumed atom revalidation');
    assert.equal(requests.slice(checkpointResumeStart).filter(request=>request.courseId===mediaCheckpoint.id&&
      request.resource==='assets.v1'&&request.reference===assetId).length,2,
      'Reused original bytes still require two fresh native asset metadata reads');
  }
  assert(checkpointCapture.meta.directDataCapture.stats.requests>=checkpointedMedia.capture.meta.directDataCapture.stats.requests,
    'An interrupted media run retains its cumulative authoring API budget');
  assertTransport(mediaCheckpoint,checkpointResumeStart);await assertNoEditor(checkpointedMedia.page,checkpointedMedia.destinations);
  await checkpointedMedia.context.close();

  for(const config of mediaFailures){
    const target=await runFileCase(config),reading=target.capture.fingerprints.find(fp=>fp.id==='item_0002');
    if(process.env.CTI_DIRECT_BROWSER_PROGRESS==='1')console.error('Synthetic media gap: '+config.mode+' · '+target.state.state);
    assert.equal(evaluateCourseraCapture(target.capture,config.id).complete,false,config.mode+' must remain an explicit capture gap');
    assert.equal(reading.captureContract.complete,false,config.mode+' must remain an explicit body gap');
    assert(reading.captureContract.status.startsWith('UNRESOLVED_'),config.mode+' cannot certify a pointer or failed transport');
    if(config.mode==='media-pointer-missing'){
      assert.equal(requests.slice(target.start).filter(request=>request.resource==='assets.v1').length,0,
        'A native img pointer without an asset ID cannot trigger guessed metadata reads');
      assert.equal(mediaRequests.filter(request=>request.courseId===config.id).length,0);
    }
    if(config.mode==='media-metadata-auth')assert.equal(target.state.state,'PAUSED');
    await target.context.close();
  }
  const widgets=await runFileCase(sixWidgets);
  const widgetEntries=widgets.capture.fingerprints.filter(fp=>fp.payload.directDataSources?.atom?.elements[0]?.draft?.content?.typeName==='ungradedWidgetDraft');
  assert.equal(widgetEntries.length,6);assert(widgetEntries.every(fp=>fp.captureContract.complete===false&&fp.captureContract.externalBodyVerified===false));
  assert.equal(evaluateCourseraCapture(widgets.capture,sixWidgets.id).complete,false,
    'Retaining six widget references does not verify their external implementation');
  await widgets.context.close();

  const configured=await runFileCase(configuredWidgets);
  const configuredItems=configured.capture.fingerprints.filter(fp=>fp.payload.directWidgetProviderEvidence);
  assert.equal(configuredItems.length,2);
  assert.equal(new Set(configuredItems.map(fp=>fp.name)).size,1,'Equal titles retain separate native identities');
  for(const fp of configuredItems){
    const evidence=fp.payload.directWidgetProviderEvidence;
    assert.equal(fp.captureContract.sourceConfigurationVerified,true);
    assert.equal(fp.captureContract.complete,false);assert.equal(fp.captureContract.externalBodyVerified,false);
    assert.equal(evidence.itemId,fp.id);assert.equal(evidence.courseId,configuredWidgets.id);
    assert.equal(evidence.initial.model.elements[0].id,evidence.providerId);
    assert.equal(evidence.final.model.elements[0].id,evidence.providerId);
    assert.equal(evidence.initial.model.elements[0].draft.configuration.opaqueSetting,'Exact source '+fp.id);
    assert(evidence.targets.length===2&&evidence.targets.every(target=>target.url.includes('id='+fp.id)&&
      target.url.includes('captions=true')&&target.bodyVerified===false&&target.playbackVerified===false));
    assert(!evidence.targets.some(target=>target.url.includes('format-example')));
  }
  assert.equal(configured.capture.meta.directDataCapture.coverage.widgets.configurations,2);
  assert.equal(evaluateCourseraCapture(configured.capture,configuredWidgets.id).complete,false);
  const savedWidgetAssessments=configured.capture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence);
  const editedGroup=[...groups.values()].find(row=>row.courseId===configuredWidgets.id);
  const oldQuestionId=editedGroup.value.questions[0],oldQuestion=definitions.get(oldQuestionId);
  const editedQuestionId=oldQuestionId.replace(/@\d+$/,value=>'@'+(Number(value.slice(1))+1));
  definitions.set(editedQuestionId,{...oldQuestion,value:{...oldQuestion.value,id:editedQuestionId,
    definition:{...oldQuestion.value.definition,definition:{...oldQuestion.value.definition.definition,
      prompt:cml('Edited source question for fresh verification')}}}});
  editedGroup.value.questions[0]=editedQuestionId;
  for(const provider of providers.values())if(provider.courseId===configuredWidgets.id){
    provider.value.draft.configuration.url+='&revision=2';provider.value.draft.pageSrc=provider.value.draft.configuration.url;
    provider.value.metadata.updatedAt++;
  }
  await configured.page.reload();const widgetResumeStart=requests.length;
  const widgetResumeDownload=configured.page.waitForEvent('download',{timeout:180000});void widgetResumeDownload.catch(()=>{});
  await launch(configured.page,configured.context);const widgetResumeState=await terminal(configured.page);
  const widgetResumed=await readFile(await widgetResumeDownload);
  assert.equal(widgetResumeState.runId,configured.state.runId);
  const resumedWidgetRequests=requests.slice(widgetResumeStart).filter(request=>request.courseId===configuredWidgets.id);
  assert.equal(resumedWidgetRequests.filter(request=>request.resource===providerResource).length,4,
    'Each distinct provider gets two current reads even when its atom is unchanged');
  assert.equal(resumedWidgetRequests.filter(request=>request.resource===definitionResource||request.resource===groupResource).length,0,
    'Refreshing widget configuration does not recollect saved question definitions or groups');
  assert.deepEqual(widgetResumed.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),savedWidgetAssessments);
  for(const fp of widgetResumed.fingerprints.filter(fp=>fp.payload.directWidgetProviderEvidence)){
    assert.equal(fp.captureContract.sourceConfigurationVerified,true);
    assert(fp.payload.directWidgetProviderEvidence.targets.every(target=>target.url.includes('revision=2')));
  }
  assertTransport(configuredWidgets,widgetResumeStart);await assertNoEditor(configured.page,configured.destinations);
  async function savedNativeRun(page,runId){return page.evaluate(async id=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('cti-coursera-direct-data-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const result=await new Promise((resolve,reject)=>{const transaction=database.transaction(['runs','items','groups','definitions'],'readonly'),out={};
      for(const name of ['runs','items','groups','definitions']){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result.filter(row=>row.runId===id);};}
      transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);});database.close();return result;
  },runId);}
  const preservedRun=await savedNativeRun(configured.page,widgetResumeState.runId),freshStart=requests.length;
  const freshDownload=configured.page.waitForEvent('download',{timeout:180000});void freshDownload.catch(()=>{});
  await configured.page.getByRole('button',{name:'Start a fresh course capture',exact:true}).click();
  const freshState=await terminal(configured.page),freshCapture=await readFile(await freshDownload);
  assert.notEqual(freshState.runId,widgetResumeState.runId,'Explicit fresh verification opens an independent run');
  assert.equal(freshCapture.meta.directDataCapture.resumed,false);
  assert.equal(freshCapture.meta.directDataCapture.mediaEnrichment,undefined);
  assert(freshCapture.fingerprints.some(fp=>fp.payload.structuredAssessment?.questions?.some(q=>q.prompt==='Edited source question for fresh verification')),
    'A fresh full capture reads the edited native group and versioned question rather than relabeling retained questions');
  const freshRequests=requests.slice(freshStart).filter(request=>request.courseId===configuredWidgets.id);
  assert(freshRequests.some(request=>request.resource===groupResource));
  assert(freshRequests.some(request=>request.resource===definitionResource&&request.reference===editedQuestionId));
  assert.deepEqual(await savedNativeRun(configured.page,widgetResumeState.runId),preservedRun,
    'Prior run items, groups, definitions, receipts and cumulative budgets remain available for export unchanged');
  assert.equal(freshCapture.meta.directDataCapture.stats.inheritedBudget.requests,0,
    'Explicit fresh verification has a separate budget rather than resetting the prior saved run');
  assertTransport(configuredWidgets,freshStart);await assertNoEditor(configured.page,configured.destinations);
  await configured.context.close();

  function assertMixedNativeItems(config,capture){
    assert.deepEqual(capture.fingerprints.map(fp=>fp.id),['item_0000','item_0001','item_0002','item_0003','item_0004','item_0005','empty_0'],
      'Provider acquisition must preserve every native item, order and explicitly empty structural entry');
    assert(capture.fingerprints.filter(fp=>fp.id==='item_0000'||fp.id==='item_0001').every(fp=>fp.captureContract.complete===true));
    assertOriginalMedia(config,capture,false);
    for(const id of ['item_0003','item_0004','item_0005']){
      const fp=capture.fingerprints.find(value=>value.id===id);
      assert.equal(fp.captureContract.sourceConfigurationVerified,true);
      assert.equal(fp.captureContract.complete,false);assert.equal(fp.captureContract.externalBodyVerified,false);
    }
    const unknown=capture.fingerprints.find(fp=>fp.id==='item_0004');
    assert(unknown.payload.directWidgetProviderEvidence.targets.every(target=>target.url==='https://unknown.example.test/widget/'+config.id));
    assert(!unknown.payload.directPanoptoEvidence,'An unsupported plugin is retained without dispatching a guessed provider request');
    const verdict=evaluateCourseraCapture(capture,config.id);
    assert(!verdict.reasons.some(reason=>String(reason).startsWith('DIRECT_PANOPTO_SOURCE_INVALID:')),
      'Independent import must accept the retained provider proof or explicit acquisition gap: '+JSON.stringify(verdict.reasons));
    assert.equal(verdict.complete,false,
      'A retained podcast rendition does not certify HLS playback, caption absence or a complete external widget');
  }
  function assertPanoptoMetadata(config,capture,bodyExpected,itemId='item_0003'){
    const fp=capture.fingerprints.find(value=>value.id===itemId),evidence=fp.payload.directPanoptoEvidence;
    assert.equal(evidence.method,'BOUND_WIDGET_PANOPTO_DELIVERY');assert.equal(evidence.courseId,config.id);
    assert.equal(evidence.itemId,fp.id);assert.equal(evidence.atomId,fp.atomId);
    assert.equal(evidence.providerId,fp.payload.directWidgetProviderEvidence.providerId);
    assert.equal(evidence.deliveries.length,1,'Configuration URL and pageSrc share one exact delivery acquisition');
    const delivery=evidence.deliveries[0];assert.equal(delivery.targetUrl,config.panoptoTarget);
    assert.equal(delivery.stableSource,true);
    for(const observation of [delivery.initial,delivery.final]){
      assert.deepEqual(observation.model,config.expectedPanoptoModel,'Native delivery metadata, unknown fields and literal OCR labels are retained');
      assert.equal(observation.receipt.resource,'PanoptoDeliveryInfo');assert.equal(observation.receipt.method,'POST');
      assert.equal(observation.receipt.status,200);assert.equal(observation.receipt.requestPath,'/Panopto/Pages/Viewer/DeliveryInfo.aspx');
      assert.equal(observation.receipt.transport,'CTI_PUBLIC_BACKEND');assert.equal(observation.receipt.serviceOrigin,helperOrigin);
      assert.equal(observation.receipt.observedAtBasis,'UPSTREAM');assert.equal(observation.receipt.serviceStatus,200);
      assert.equal(observation.receipt.upstreamRequests,1);
      assert.equal(new URLSearchParams(observation.receipt.requestForm).get('deliveryId'),config.panoptoDeliveryId);
      assert.match(observation.sourceHash,/^[a-f0-9]{64}$/);
    }
    assert.equal(delivery.initial.sourceHash,delivery.final.sourceHash);
    assert.equal(delivery.initial.model.Delivery.HasCaptions,false);
    assert.deepEqual(delivery.initial.model.Delivery.AvailableCaptions,[]);
    assert(delivery.initial.model.Delivery.Timestamps.every(entry=>entry.EventTargetType==='SmartOcrToc'));
    assert.equal(delivery.podcasts.length,1);const podcast=delivery.podcasts[0];
    assert.equal(podcast.role,'PODCAST_STREAM_RENDITION');assert.equal(podcast.canonicalUrl,config.panoptoMediaUrl);
    assert.equal(podcast.mime,'video/mp4');
    if(bodyExpected){
      assert(podcast.body?.bytes instanceof Uint8Array,'The ZIP importer must attach the exact rendition bytes to this source-bound podcast');
      assert.deepEqual(Buffer.from(podcast.body.bytes),mp4Bytes);
      assert.equal(podcast.body.size,mp4Bytes.length);assert.equal(podcast.body.mime,'video/mp4');
      assert.equal(podcast.body.sha256,createHash('sha256').update(mp4Bytes).digest('hex'));
      assert.equal(podcast.body.archivePath,'files/'+podcast.body.sha256);assert.equal(podcast.body.receipt.status,200);
      assert.equal(podcast.body.receipt.transport,'CTI_PUBLIC_BACKEND');assert.equal(podcast.body.receipt.serviceOrigin,helperOrigin);
      assert.equal(podcast.body.receipt.observedAtBasis,'UPSTREAM');assert.equal(podcast.body.receipt.upstreamRequests,2);
      assert.equal(podcast.body.receipt.validationSourceHash,delivery.initial.sourceHash);
      assert.equal(podcast.body.receipt.declaredBodyBytes,mp4Bytes.length);
      assert(podcast.body.receipt.validationMetadataBytes>0);
      assert(Number.isFinite(Date.parse(podcast.body.receipt.observedAt)));
      assert.equal(delivery.failures.length,0);
    }else{
      assert(!podcast.body?.bytes,'A CORS-blocked HTTP 200 must never become captured binary evidence');
      assert(delivery.failures.length>0,'Blocked podcast acquisition remains an explicit item gap');
    }
    return {fp,evidence,delivery,podcast};
  }
  panoptoComplete.panoptoMode='metadata-csp';
  const mixed=await runFileCase(panoptoComplete);assert.equal(mixed.state.state,'INCOMPLETE');
  assertMixedNativeItems(panoptoComplete,mixed.capture);
  const acquired=assertPanoptoMetadata(panoptoComplete,mixed.capture,true);
  const duplicate=assertPanoptoMetadata(panoptoComplete,mixed.capture,true,'item_0005');
  assert.notEqual(acquired.evidence.providerId,duplicate.evidence.providerId,'Same-target placements retain their distinct provider joins');
  assert.deepEqual(acquired.podcast.body,duplicate.podcast.body,'The same-attempt shared source body remains attached to both native placements');
  assert.equal(panoptoRequests.filter(request=>request.courseId===panoptoComplete.id).length,0,'The course tab does not bypass its own connect-src policy');
  assert.equal(helperRequests.filter(request=>request.courseId===panoptoComplete.id&&request.kind==='metadata').length,4);
  assert.equal(helperRequests.filter(request=>request.courseId===panoptoComplete.id&&request.kind==='podcast').length,1);
  assert.equal(helperUpstreamRequests.filter(request=>request.courseId===panoptoComplete.id&&request.role==='METADATA').length,5,
    'The maintained backend performs its own fresh metadata validation before streaming the rendition');
  const transferred=(await mixed.page.evaluate(()=>window.fixtureProviderFrames)).filter(frame=>frame.type==='chunk'),byJob=new Map();
  for(const frame of transferred){if(!byJob.has(frame.id))byJob.set(frame.id,[]);byJob.get(frame.id).push(frame);}
  const podcastFrames=[...byJob.values()].find(frames=>frames.reduce((sum,frame)=>sum+frame.bytes,0)===mp4Bytes.length);
  assert(podcastFrames?.length>=3,'The actual helper stream requires multiple postMessage pulls');
  let offset=0;for(const [sequence,frame]of podcastFrames.entries()){
    assert.equal(frame.seq,sequence);assert.equal(frame.offset,offset);assert(frame.bytes>0&&frame.bytes<=65536);offset+=frame.bytes;
  }
  assert(podcastFrames.some(frame=>frame.bytes<65536),'Partial packets are retained without padding or truncation');
  const savedMixedAssessments=mixed.capture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),savedPodcast=acquired.podcast.body;
  await mixed.page.reload();const mixedResumeStart=requests.length,mixedProviderStart=helperRequests.length;
  const mixedDownload=mixed.page.waitForEvent('download',{timeout:180000});void mixedDownload.catch(()=>{});
  await launch(mixed.page,mixed.context);const mixedState=await terminal(mixed.page),mixedResumed=await readFile(await mixedDownload);
  assert.equal(mixedState.runId,mixed.state.runId);assert.equal(mixed.downloads.length,2,'Each completed attempt downloads one comprehensive ZIP');
  assertMixedNativeItems(panoptoComplete,mixedResumed);const resumedPanopto=assertPanoptoMetadata(panoptoComplete,mixedResumed,true);
  const resumedProviderRequests=helperRequests.slice(mixedProviderStart).filter(request=>request.courseId===panoptoComplete.id);
  assert.equal(resumedProviderRequests.filter(request=>request.kind==='metadata').length,4,'Resume freshly rechecks delivery metadata for both native placements');
  assert.equal(resumedProviderRequests.filter(request=>request.kind==='podcast').length,1,'A resumed attempt freshly downloads a mutable rendition URL, deduplicated only within that attempt');
  assert.deepEqual(Buffer.from(resumedPanopto.podcast.body.bytes),Buffer.from(savedPodcast.bytes));
  assert.notEqual(resumedPanopto.podcast.body.receipt.observedAt,savedPodcast.receipt.observedAt,'Fresh bytes carry their own observation time instead of relabeling an earlier download');
  assert.deepEqual(assertPanoptoMetadata(panoptoComplete,mixedResumed,true,'item_0005').podcast.body,resumedPanopto.podcast.body);
  assert.notEqual(resumedPanopto.delivery.initial.receipt.observedAt,acquired.delivery.initial.receipt.observedAt);
  const mixedNativeRequests=requests.slice(mixedResumeStart).filter(request=>request.courseId===panoptoComplete.id);
  assert.equal(mixedNativeRequests.filter(request=>request.resource===providerResource).length,6,'Every source-bound widget provider receives fresh consistency reads');
  assert.equal(mixedNativeRequests.filter(request=>request.resource===groupResource||request.resource===definitionResource).length,0);
  assert.deepEqual(mixedResumed.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),savedMixedAssessments,
    'Provider enrichment preserves native questions, keys, feedback and original assessment timestamps');
  assert(mixedResumed.meta.directDataCapture.stats.requests>=mixed.capture.meta.directDataCapture.stats.requests);
  // A changed declared rendition location invalidates reuse even though the
  // source fixture returns identical inert bytes; no URL-based aliasing occurs.
  panoptoComplete.panoptoMediaUrl+='?revision=2';
  panoptoComplete.panoptoModel.Delivery.PodcastStreams[0].StreamUrl=panoptoComplete.panoptoMediaUrl+'&X-Amz-Signature='+secrets[3]+'&Expires=2000000000';
  panoptoComplete.expectedPanoptoModel.Delivery.PodcastStreams[0].StreamUrl=panoptoComplete.panoptoMediaUrl;
  await mixed.page.reload();const changedProviderStart=helperRequests.length;
  const changedPodcastDownload=mixed.page.waitForEvent('download',{timeout:180000});void changedPodcastDownload.catch(()=>{});
  await launch(mixed.page,mixed.context);const changedPodcastState=await terminal(mixed.page),changedPodcastCapture=await readFile(await changedPodcastDownload);
  assert.equal(changedPodcastState.runId,mixed.state.runId);assert.equal(mixed.downloads.length,3);
  const changedPodcast=assertPanoptoMetadata(panoptoComplete,changedPodcastCapture,true);
  assert.equal(helperRequests.slice(changedProviderStart).filter(request=>request.courseId===panoptoComplete.id&&request.kind==='podcast').length,1);
  assert.notEqual(changedPodcast.podcast.body.receipt.observedAt,savedPodcast.receipt.observedAt,'A newly downloaded rendition carries its own source observation time');
  assert.deepEqual(changedPodcastCapture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),savedMixedAssessments);
  await assertNoEditor(mixed.page,mixed.destinations);

  async function checkpointSnapshot(page){
    return page.evaluate(async()=>{
      const database=await new Promise((resolve,reject)=>{
        const request=indexedDB.open('cti-coursera-direct-data-v1');
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      const names=[...database.objectStoreNames],rows=await new Promise((resolve,reject)=>{
        const transaction=database.transaction(names,'readonly'),out={};
        for(const name of names){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result;};}
        transaction.oncomplete=()=>resolve(out);transaction.onerror=()=>reject(transaction.error);
      });database.close();
      for(const values of Object.values(rows))for(const row of values)if(row.blob instanceof Blob){
        const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await row.blob.arrayBuffer()));
        row.blob={size:row.blob.size,type:row.blob.type,sha256:[...digest].map(value=>value.toString(16).padStart(2,'0')).join('')};
      }
      return JSON.parse(JSON.stringify(rows));
    });
  }
  const savedBeforeAccess=await checkpointSnapshot(mixed.page);
  const accessCases=[
    {provider:'allowed',helper:'ready',status:200,service:200},
    {provider:'metadata-csp',helper:'ready',status:200,service:200},
    {provider:'metadata-cors',helper:'ready',status:200,service:200},
    {provider:'metadata-auth',helper:'ready',status:401,service:502},
    {provider:'allowed',helper:'service-auth',status:0,service:401},
    {provider:'allowed',helper:'popup-blocked',status:0,service:0},
    {provider:'allowed',helper:'access-denied',status:0,service:0},
    {provider:'allowed',helper:'coop',status:0,service:0},
  ];
  for(const scenario of accessCases){
    panoptoComplete.panoptoMode=scenario.provider;
    await mixed.context.addCookies([{name:'ctiFixtureMode',value:scenario.helper,url:helperOrigin,httpOnly:true,secure:true,sameSite:'None'}]);
    await mixed.page.reload();const nativeStart=requests.length,externalStart=panoptoRequests.length,serviceStart=helperRequests.length,
      upstreamStart=helperUpstreamRequests.length,downloadStart=mixed.downloads.length;
    await launch(mixed.page,mixed.context,false);
    assert.deepEqual(await mixed.page.evaluate(()=>{
      const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;return {state:state.state,running:state.running,runId:state.runId};
    }),{state:'READY',running:false,runId:''},'Opening the bookmark waits for an explicit operation');
    assert.equal(requests.length,nativeStart);assert.equal(helperRequests.length,serviceStart);
    assert.equal(panoptoRequests.length,externalStart);
    assert.deepEqual(await checkpointSnapshot(mixed.page),savedBeforeAccess);
    if(scenario.helper==='popup-blocked')await mixed.page.evaluate(()=>{window.open=()=>null;});
    await mixed.page.getByRole('button',{name:'Check Panopto access',exact:true}).click();
    await mixed.page.waitForFunction(()=>{
      const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;return !!state?.accessDiagnostic&&!state.running&&!state.diagnosing;
    },{},{timeout:15000});
    const diagnostic=validateProviderAccessDiagnostic(await mixed.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.accessDiagnostic));
    assert.equal(diagnostic.courseId,panoptoComplete.id);assert.equal(diagnostic.notForCourseAudit,true);assert.equal(diagnostic.stopReason,'');
    assert.equal(await mixed.page.locator('#cti-direct-data-capture-v1 pre[role="status"]').innerText(),providerAccessDiagnosticText(diagnostic),
      'The actual bookmark card visibly explains success and both service and upstream failures');
    for(const key of ['contentCompletionVerified','sourceStabilityVerified','bodyVerified','playbackVerified','launchVerified','wholeWidgetVerified'])assert.equal(diagnostic[key],false);
    assert.deepEqual(diagnostic.items.map(item=>item.itemId).sort(),['item_0003','item_0005']);assert.equal(diagnostic.nativeFailures.length,0);
    assert.equal(diagnostic.items[0].request.receipt.observedAt,diagnostic.items[1].request.receipt.observedAt);
    const nativeReads=requests.slice(nativeStart).filter(request=>request.courseId===panoptoComplete.id);
    assert.equal(nativeReads.filter(request=>request.resource==='authoringCourseMaterials.v1').length,1);
    for(const resource of ['authoringAtoms.v2','authoringItemContentRelations.v1',providerResource])assert.equal(nativeReads.filter(request=>request.resource===resource).length,3);
    assert(nativeReads.every(request=>['authoringCourseMaterials.v1','authoringAtoms.v2','authoringItemContentRelations.v1',providerResource].includes(request.resource)));
    const services=helperRequests.slice(serviceStart),upstream=helperUpstreamRequests.slice(upstreamStart);
    assert.equal(panoptoRequests.length,externalStart,'The course tab never silently falls back to a blocked cross-origin fetch');
    assert.equal(services.length,['popup-blocked','access-denied','coop'].includes(scenario.helper)?0:1);
    assert.equal(upstream.length,scenario.status?1:0,'CTI login, popup and COOP failures do not invent an upstream response');
    assert(upstream.every(request=>request.role==='METADATA'),'Access checks never retrieve video bytes');
    for(const item of diagnostic.items){
      const receipt=item.request.receipt;
      assert.equal(item.targetUrl,panoptoComplete.panoptoTarget);assert(!Object.hasOwn(item.request,'model')&&!Object.hasOwn(item.request,'data'));
      assert.equal(receipt.transport,'CTI_PUBLIC_BACKEND');assert.equal(receipt.serviceOrigin,helperOrigin);
      assert.equal(receipt.status,scenario.status);assert.equal(receipt.serviceStatus,scenario.service);
      assert.equal(receipt.observedAtBasis,scenario.status?'UPSTREAM':'CLIENT_ATTEMPT');assert.equal(receipt.upstreamRequests,scenario.status?1:0);
      assert.equal(receipt.diagnostics,undefined,'A CTI service result is not labelled as a course-tab CSP observation');
      if(scenario.helper==='popup-blocked')assert.match(item.request.reason,/POPUP_BLOCKED/);
    }
    assert.equal(mixed.downloads.length,downloadStart,'The helper does not create a second capture artifact');
    assert.deepEqual(await checkpointSnapshot(mixed.page),savedBeforeAccess,'Access checks preserve all saved records, quiz timestamps and original body hashes');
    const serialized=JSON.stringify(diagnostic);assert(Buffer.byteLength(serialized)<=1024*1024);
    for(const secret of secrets)assert(!serialized.includes(secret));
    const accessDownload=mixed.page.waitForEvent('download');await mixed.page.getByRole('button',{name:'Download access report',exact:true}).click();
    const downloaded=await accessDownload;assert(downloaded.suggestedFilename().endsWith('.json'));
    assert.deepEqual(validateProviderAccessDiagnostic(JSON.parse(fs.readFileSync(await downloaded.path(),'utf8'))),diagnostic);
  }
  panoptoComplete.panoptoMode='allowed';await mixed.context.close();

  // Test the maintained direct reader separately: the cooperating helper is not
  // a claim that Coursera permits native cross-origin fetches.
  panoptoComplete.directReaderCase=true;
  const directPolicy=await open(panoptoComplete);
  for(const mode of ['allowed','metadata-csp','metadata-cors','metadata-auth']){
    panoptoComplete.panoptoMode=mode;await directPolicy.page.reload();await directPolicy.page.waitForFunction(()=>typeof window.fixtureReadDirectProvider==='function');
    const start=panoptoRequests.length,serviceStart=helperRequests.length;
    const result=await directPolicy.page.evaluate(targetUrl=>window.fixtureReadDirectProvider(targetUrl),panoptoComplete.panoptoTarget);
    const details=result.receipt.diagnostics,observed=panoptoRequests.slice(start);let expected=mode==='metadata-cors'?'CORS_OR_NETWORK':'HTTP_OBSERVED';
    if(mode==='metadata-csp'){
      assert.equal(observed.length,0);
      const events=await directPolicy.page.evaluate(()=>window.fixtureCspEvents),endpoint=new URL(panoptoOrigin+'/Panopto/Pages/Viewer/DeliveryInfo.aspx');
      const related=events.filter(event=>{try{return event.disposition==='enforce'&&['connect-src','default-src'].includes(event.effectiveDirective)&&new URL(event.blockedURI).origin===endpoint.origin;}catch{return false;}});
      assert(related.length>0,'A genuine enforced browser CSP event accompanies the direct request denial');
      expected=related.some(event=>new URL(event.blockedURI).pathname===endpoint.pathname)?'ENFORCED_CSP':'CSP_REPORTED_FOR_ORIGIN';
    }else assert.equal(observed.length,1);
    assert.equal(details.outcome,expected);assert.equal(details.policyEventsAvailable,true);
    assert.equal(details.httpStatus,mode==='allowed'?200:mode==='metadata-auth'?401:0);
    assert.equal(result.ok,mode==='allowed');assert.equal(helperRequests.length,serviceStart);
    assert.equal((await directPolicy.page.evaluate(()=>indexedDB.databases())).some(database=>database.name==='cti-coursera-direct-data-v1'),false);
  }
  panoptoComplete.directReaderCase=false;panoptoComplete.panoptoMode='allowed';await directPolicy.context.close();

  // These engineering fixtures exercise standard browser CORS through actual
  // HTTPS responses. They establish no policy for the publisher's live site,
  // the operator's Chrome profile, or the private Coursera course.
  const publisherPolicy=await open(publisherReaderCourse);
  await publisherPolicy.context.addCookies([{name:'syntheticPublisherCookie',value:'synthetic-publisher-cookie',
    url:publisherOrigin,httpOnly:true,secure:true,sameSite:'None'}]);
  await publisherPolicy.page.waitForFunction(()=>typeof window.fixtureReadPublisher==='function');
  const publisherNativeStart=requests.length,publisherHelperStart=helperRequests.length;
  let successfulPublisherObservation=null;
  for(const config of publisherFixtures){
    const start=publisherRequests.length;
    const result=await publisherPolicy.page.evaluate(targetUrl=>window.fixtureReadPublisher(targetUrl),config.targetUrl);
    const actual=publisherRequests.slice(start);
    const secondAttempt=['include-exact','include-wildcard','wrong-origin','missing-acac','no-cors','http-403','redirect'].includes(config.mode);
    assert.equal(actual.length,secondAttempt?2:1,'The native public endpoint must be exercised for '+config.mode);
    assert.equal(result.stats.requests,actual.length);assert.equal(result.stats.byResource.PublisherChapter,actual.length);
    assert.equal(result.receipt.attempts.length,actual.length);assert.equal(result.receipt.attempts[0].credentials,'omit');
    assert.equal(actual[0].cookiePresent,false,'The first public attempt omits even browser-owned publisher cookies');
    assert(actual.every(request=>request.method==='GET'&&!request.authorizationPresent));
    if(secondAttempt)assert.equal(result.receipt.attempts[1].credentials,'include');
    if(['omit-wildcard','include-exact'].includes(config.mode)){
      assert.equal(result.ok,true);assert.equal(result.reason,'');assert.equal(result.receipt.status,200);
      assert.equal(result.receipt.responseType,'cors');assert.equal(result.receipt.observedAtBasis,'BROWSER_RESPONSE');
      assert.equal(result.receipt.credentials,secondAttempt?'include':'omit');assert.equal(result.data.rawJson,config.rawJson);
      assert.equal(result.data.bytes,config.bytes.length);assert.equal(result.stats.bytes,config.bytes.length);
      assert.equal(result.data.sha256,createHash('sha256').update(config.bytes).digest('hex'));
      assert.equal(result.receipt.originalResponseSha256,result.data.sha256);
      assert.equal(result.data.statusCoverage,'PARTIAL_PUBLISHER_API_ONLY');assert.equal(result.data.html,undefined);
      assert.equal(result.receipt.transport,'BROWSER_PUBLISHER_API');assert.equal(result.receipt.serviceOrigin,undefined);
      const observation={model:result.data,receipt:result.receipt};
      assert(directPublisherEvidenceV1(observation,config.targetUrl,bytes=>createHash('sha256').update(bytes).digest('hex')));
      const native=directPublisherChapterV1(result.data.rawJson,config.targetUrl);
      assert.equal(native.content.raw,config.chapter.content.raw);assert.equal(native.content.rendered,config.chapter.content.rendered);
      assert.notEqual(native.content.raw,native.content.rendered,'Raw publisher source is not replaced with rendered page HTML');
      assert.equal(native.title.raw,config.chapter.title.raw);assert.equal(native.title.rendered,config.chapter.title.rendered);
      assert.equal(result.stats.completed,1);assert.equal(result.stats.failed,0);
      successfulPublisherObservation=observation;
    }else{
      assert.equal(result.ok,false);assert.equal(result.data,null);assert(result.reason);
      assert.equal(result.stats.completed,0);assert.equal(result.stats.failed,1);
      if(['include-wildcard','wrong-origin','missing-acac','no-cors','redirect'].includes(config.mode)){
        assert.equal(result.reason,'PUBLISHER_BROWSER_BLOCKED_OR_FAILED');
        assert.equal(result.receipt.status,0,'A server HTTP response hidden by browser policy is not an observed HTTP status');
        assert.equal(result.receipt.responseType,'unreadable');assert.equal(result.receipt.observedAtBasis,'BROWSER_ATTEMPT');
        assert.equal(result.receipt.bytes,0);assert.equal(result.receipt.originalResponseSha256,'');
        assert.equal(result.receipt.attempts.at(-1).status,0);
        if(['include-wildcard','missing-acac'].includes(config.mode))assert.equal(result.receipt.attempts[0].status,403,
          'A prior omit response remains separate from the final unreadable credentialed response');
      }else if(config.mode==='http-403')assert.equal(result.receipt.status,403);
      else if(config.mode==='http-429')assert.equal(result.receipt.status,429);
      else assert.equal(result.receipt.status,200,'An exposed HTTP 200 may still contain invalid or unsupported source evidence');
      if(config.mode==='invalid-utf8')assert.equal(result.reason,'PUBLISHER_BROWSER_UTF8');
      if(config.mode==='wrong-mime')assert.equal(result.reason,'PUBLISHER_BROWSER_MIME');
      if(['wrong-id','wrong-book','protected','draft','escaped-credential'].includes(config.mode))assert.equal(result.reason,'PUBLISHER_BROWSER_SOURCE_INVALID');
      if(config.mode==='body-limit')assert.match(result.reason,/BYTE_LIMIT/);
    }
  }
  for(const config of publisherPartFixtures){
    const start=publisherRequests.length;
    const result=await publisherPolicy.page.evaluate(targetUrl=>window.fixtureReadPublisher(targetUrl),config.targetUrl),actual=publisherRequests.slice(start);
    const resolvesPart=config.mode.startsWith('part-'),resolvesBackMatter=config.mode==='part-missing';
    assert.equal(actual.length,resolvesBackMatter?3:config.mode==='http-401'?1:2,'Typed resolution is bounded separately from the original credential retry');
    assert.deepEqual(actual.map(request=>request.endpointType),resolvesBackMatter?['chapters','parts','back-matter']:
      resolvesPart?['chapters','parts']:config.mode==='http-401'?['chapters']:['chapters','chapters']);
    assert.equal(actual[0].cookiePresent,false);assert(actual.every(request=>!request.authorizationPresent));
    if(resolvesPart&&!resolvesBackMatter){
      assert.equal(result.stats.byResource.PublisherChapter,1);assert.equal(result.stats.byResource.PublisherPart,1);
      assert.equal(result.receipt.resource,'PublisherPart');assert.equal(result.receipt.credentials,'omit');assert.equal(result.receipt.attempts.length,1);
      const prior=result.receipt.resolution.chapterReceipt;
      assert.equal(result.receipt.resolution.method,'CHAPTER_404_TO_PART');assert.equal(prior.status,404);assert.equal(prior.responseType,'cors');
      assert.equal(prior.resource,'PublisherChapter');assert.equal(prior.credentials,'omit');assert.equal(prior.attempts.length,1);
      assert.equal(prior.endpointUrl,publisherOrigin+'/'+publisherBook+'/wp-json/pressbooks/v2/chapters/'+config.chapterId);
      assert.equal(result.receipt.endpointUrl,publisherOrigin+'/'+publisherBook+'/wp-json/pressbooks/v2/parts/'+config.chapterId);
      assert.equal(actual[1].cookiePresent,false,'Part resolution never adds a third or credentialed GET');
    }
    if(resolvesBackMatter){
      assert.equal(result.receipt.resource,'PublisherBackMatter');assert.equal(result.receipt.status,404);
      assert.equal(result.receipt.credentials,'omit');assert.equal(result.receipt.attempts.length,1);
      assert.equal(result.receipt.resolution.method,'CHAPTER_404_PART_404_TO_BACK_MATTER');
      assert.equal(result.receipt.resolution.chapterReceipt.status,404);assert.equal(result.receipt.resolution.partReceipt.status,404);
      assert.equal(result.receipt.resolution.chapterReceipt.resolution,undefined);assert.equal(result.receipt.resolution.partReceipt.resolution,undefined);
      assert.equal(result.stats.byResource.PublisherChapter,1);assert.equal(result.stats.byResource.PublisherPart,1);
      assert.equal(result.stats.byResource.PublisherBackMatter,1);assert(actual.every(request=>!request.cookiePresent));
    }
    if(config.mode==='part-success'){
      assert.equal(result.ok,true);assert.equal(result.data.kind,'CTI_BROWSER_PUBLISHER_PART');assert.equal(result.data.rawJson,config.rawJson);
      assert(directPublisherResourceEvidenceV1({model:result.data,receipt:result.receipt},config.targetUrl,bytes=>createHash('sha256').update(bytes).digest('hex')));
      assert.equal(directPublisherResourceV1(result.data.rawJson,config.targetUrl,'part').type,'part');
    }else{
      assert.equal(result.ok,false);assert.equal(result.data,null);
      assert.equal(result.reason,config.mode==='part-wrong-type'?'PUBLISHER_BROWSER_SOURCE_INVALID':config.mode==='http-401'?'PUBLISHER_BROWSER_HTTP_401':config.mode==='include-404'?'PUBLISHER_BROWSER_RESOURCE_RESOLUTION_LIMIT':'PUBLISHER_BROWSER_HTTP_404');
      if(config.mode==='http-401'){assert.equal(result.receipt.status,401);assert.equal(result.receipt.attempts.length,1);assert.equal(result.receipt.resolution,undefined);}
      if(config.mode==='include-404'){assert.equal(result.receipt.resource,'PublisherChapter');assert.equal(result.receipt.attempts.length,2);assert.equal(result.receipt.resolution,undefined);}
    }
  }
  for(const config of publisherBackMatterFixtures){
    const start=publisherRequests.length;
    const result=await publisherPolicy.page.evaluate(targetUrl=>window.fixtureReadPublisher(targetUrl),config.targetUrl),actual=publisherRequests.slice(start);
    const denied=/part-(401|403)$/.test(config.mode),expectedEndpoints=denied?['chapters','parts']:['chapters','parts','back-matter'];
    assert.deepEqual(actual.map(request=>request.endpointType),expectedEndpoints,
      'Only two exposed omit-mode 404 responses authorize the third typed publisher GET');
    assert.equal(result.stats.requests,expectedEndpoints.length);assert(actual.every(request=>!request.cookiePresent&&!request.authorizationPresent));
    assert.equal(result.stats.byResource.PublisherChapter,1);assert.equal(result.stats.byResource.PublisherPart,1);
    if(denied){
      const status=Number(config.mode.slice(-3));assert.equal(result.ok,false);assert.equal(result.data,null);
      assert.equal(result.reason,'PUBLISHER_BROWSER_HTTP_'+status);assert.equal(result.receipt.resource,'PublisherPart');
      assert.equal(result.receipt.status,status);assert.equal(result.receipt.resolution.method,'CHAPTER_404_TO_PART');
      assert.equal(result.stats.byResource.PublisherBackMatter,undefined,
        'A part authorization failure never becomes a guessed back-matter source');
      continue;
    }
    assert.equal(result.stats.byResource.PublisherBackMatter,1);assert.equal(result.receipt.resource,'PublisherBackMatter');
    assert.equal(result.receipt.endpointUrl,publisherOrigin+'/'+publisherBook+'/wp-json/pressbooks/v2/back-matter/'+config.chapterId);
    assert.equal(result.receipt.resolution.method,'CHAPTER_404_PART_404_TO_BACK_MATTER');
    const {chapterReceipt,partReceipt}=result.receipt.resolution;
    assert.equal(chapterReceipt.status,404);assert.equal(partReceipt.status,404);
    assert.equal(chapterReceipt.resolution,undefined);assert.equal(partReceipt.resolution,undefined);
    if(config.mode==='back-matter-success'){
      assert.equal(result.ok,true);assert.equal(result.data.kind,'CTI_BROWSER_PUBLISHER_BACK_MATTER');
      assert.equal(result.data.resourceType,'back-matter');assert.equal(result.data.rawJson,config.rawJson);
      assert.equal(result.data.sha256,createHash('sha256').update(config.bytes).digest('hex'));
      assert(directPublisherResourceEvidenceV1({model:result.data,receipt:result.receipt},config.targetUrl,bytes=>createHash('sha256').update(bytes).digest('hex')));
    }else{
      assert.equal(result.ok,false);assert.equal(result.data,null);assert.equal(result.reason,'PUBLISHER_BROWSER_SOURCE_INVALID');
      assert.equal(result.receipt.status,200,'Wrong native type and protected content remain evidence gaps despite an exposed HTTP 200');
    }
  }
  const imageSourceResult=await publisherPolicy.page.evaluate(targetUrl=>window.fixtureReadPublisher(targetUrl),publisherImageCase.targetUrl);
  assert.equal(imageSourceResult.ok,true);const imageSource={model:imageSourceResult.data,receipt:imageSourceResult.receipt};
  const imageInventory=directPublisherMediaInventoryV1(imageSource,publisherImageCase.targetUrl);assert.equal(imageInventory.resources.length,5);
  for(const resource of imageInventory.resources){
    const start=publisherImageRequests.length;
    const result=await publisherPolicy.page.evaluate(({observation,targetUrl,url})=>window.fixtureReadPublisherImage(observation,targetUrl,url),
      {observation:imageSource,targetUrl:publisherImageCase.targetUrl,url:resource.url});
    assert.equal(publisherImageRequests.length-start,1,'Each literal original image receives one CORS request without a credential or proxy retry');
    assert.equal(result.stats.requests,1);
    if(resource.url.endsWith('/main.png')){
      assert.deepEqual(Buffer.from(result.bodyBytes),pngBytes);assert.equal(result.result.body.receipt.responseType,'cors');
      assert.equal(result.result.body.receipt.sourceSha256,imageSource.model.sha256);assert.equal(result.result.reason,undefined);
    }else{assert.equal(result.bodyBytes,null);assert.equal(result.result.body,undefined);assert(result.result.reason);}
  }
  const forgedImageSource=structuredClone(imageSource);forgedImageSource.model.sha256='0'.repeat(64);forgedImageSource.receipt.originalResponseSha256='0'.repeat(64);
  const beforeForgedImage=publisherImageRequests.length;
  const forgedImage=await publisherPolicy.page.evaluate(({observation,targetUrl,url})=>window.fixtureReadPublisherImage(observation,targetUrl,url),
    {observation:forgedImageSource,targetUrl:publisherImageCase.targetUrl,url:publisherImageBase+'main.png'});
  assert.equal(forgedImage.result.reason,'PUBLISHER_IMAGE_SOURCE_HASH_INVALID');assert.equal(publisherImageRequests.length,beforeForgedImage,
    'A changed publisher source hash is rejected before a binary network request');
  assert(successfulPublisherObservation);
  for(const responseType of ['basic','opaque']){
    const changed=structuredClone(successfulPublisherObservation);changed.receipt.responseType=responseType;
    assert.equal(directPublisherEvidenceV1(changed,changed.model.requestedUrl,bytes=>createHash('sha256').update(bytes).digest('hex')),null,
      'The importer never accepts a basic/opaque response as a browser CORS observation');
  }
  const opaqueStart=publisherOpaqueRequests.length,opaqueConsole=[],opaqueFailures=[];
  const recordOpaqueConsole=message=>{if(message.type()==='error'&&opaqueConsole.length<8)
    opaqueConsole.push(message.text().slice(0,350));};
  const recordOpaqueFailure=request=>{if(request.url()===publisherOpaqueUrl&&opaqueFailures.length<8)
    opaqueFailures.push({url:request.url(),error:request.failure()?.errorText||''});};
  publisherPolicy.page.on('console',recordOpaqueConsole);publisherPolicy.page.on('requestfailed',recordOpaqueFailure);
  let opaque;
  try{
    // Fetch requires redirect:follow with mode:no-cors. This exact control URL
    // is served as HTTP 200 without Location; production REST remains cors/error.
    opaque=await publisherPolicy.page.evaluate(async endpoint=>{const response=await fetch(endpoint,{mode:'no-cors',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer'});
      return{type:response.type,status:response.status,bytes:(await response.arrayBuffer()).byteLength};},publisherOpaqueUrl);
  }catch(error){
    throw Error('Synthetic opaque image control failed: '+JSON.stringify({observedGets:publisherOpaqueRequests.length-opaqueStart,
      consoleErrors:opaqueConsole,requestFailures:opaqueFailures})+'; '+error.message);
  }finally{
    publisherPolicy.page.off('console',recordOpaqueConsole);publisherPolicy.page.off('requestfailed',recordOpaqueFailure);
  }
  assert.equal(publisherOpaqueRequests.length-opaqueStart,1,'The fixed image control reaches the real HTTPS server exactly once');
  assert.deepEqual(opaque,{type:'opaque',status:0,bytes:0},'A native no-cors image control exposes no response body or HTTP status');
  const beforeInvalidPublisher=publisherRequests.length;
  const invalidPublisher=await publisherPolicy.page.evaluate(targetUrl=>window.fixtureReadPublisher(targetUrl),publisherOrigin+'/'+publisherBook+'/chapter/no-native-id/');
  assert.equal(invalidPublisher.ok,false);assert.equal(invalidPublisher.reason,'INVALID_PUBLISHER_TARGET');
  assert.equal(publisherRequests.length,beforeInvalidPublisher,'A chapter URL without a native numeric ID is not guessed or searched');
  publisherReaderCourse.publisherCspBlocked=true;await publisherPolicy.page.reload();
  await publisherPolicy.page.waitForFunction(()=>typeof window.fixtureReadPublisher==='function');
  const beforePublisherCsp=publisherRequests.length;
  const cspPublisher=await publisherPolicy.page.evaluate(targetUrl=>window.fixtureReadPublisher(targetUrl),publisherFixtures[0].targetUrl);
  assert.equal(cspPublisher.ok,false);assert.equal(cspPublisher.receipt.status,0);assert.equal(cspPublisher.receipt.responseType,'unreadable');
  assert.equal(cspPublisher.reason,'PUBLISHER_BROWSER_BLOCKED_OR_FAILED');assert.equal(publisherRequests.length,beforePublisherCsp);
  assert((await publisherPolicy.page.evaluate(()=>window.fixtureCspEvents)).some(event=>event.disposition==='enforce'&&
    ['connect-src','default-src'].includes(event.effectiveDirective)&&event.blockedURI.startsWith(publisherOrigin)),
    'The direct public reader respects the actual course-page CSP');
  assert.equal(await publisherPolicy.page.evaluate(()=>window.__CTI_PUBLISHER_EXECUTED===true),false);
  assert.equal(requests.length,publisherNativeStart,'A provider access check does not reread course content or questions');
  assert.equal(helperRequests.length,publisherHelperStart,'No CTI proxy silently retries a blocked browser publisher response');
  assert.equal((await publisherPolicy.page.evaluate(()=>indexedDB.databases())).some(database=>database.name==='cti-coursera-direct-data-v1'),false);
  publisherReaderCourse.publisherCspBlocked=false;await publisherPolicy.context.close();

  for(const config of [panoptoMetadataCors,panoptoBodyCors]){
    const target=await runFileCase(config);assert.equal(target.state.state,'INCOMPLETE');
    assertMixedNativeItems(config,target.capture);assertPanoptoMetadata(config,target.capture,true);
    assert.equal(panoptoRequests.filter(request=>request.courseId===config.id).length,0);
    assert(helperRequests.some(request=>request.courseId===config.id&&request.kind==='podcast'),
      'The cooperating public service reads the configured source without changing course-tab CORS policy');
    await target.context.close();
  }
  const shortTransfer=await runFileCase(helperShort);
  assertMixedNativeItems(helperShort,shortTransfer.capture);
  for(const itemId of ['item_0003','item_0005']){
    const retained=assertPanoptoMetadata(helperShort,shortTransfer.capture,false,itemId);
    assert.equal(retained.podcast.body,undefined,'A valid MP4 prefix cannot be retained as a full rendition after short EOF');
    assert.match(retained.podcast.reason,/PODCAST_LENGTH_MISMATCH/);
  }
  assert.equal(shortTransfer.state.state,'INCOMPLETE');
  await shortTransfer.context.close();
  for(const scenario of [
    {helper:'popup-blocked',provider:'allowed'},
    {helper:'coop',provider:'allowed'},
    {helper:'access-denied',provider:'allowed'},
    {helper:'service-auth',provider:'allowed'},
    {helper:'ready',provider:'metadata-auth'},
  ]){
    helperFailure.helperMode=scenario.helper;helperFailure.panoptoMode=scenario.provider;helperFailure.assetGets.clear();
    const serviceStart=helperRequests.length,upstreamStart=helperUpstreamRequests.length,target=await runFileCase(helperFailure);
    assertMixedNativeItems(helperFailure,target.capture);assert.equal(target.state.state,'INCOMPLETE');
    for(const itemId of ['item_0003','item_0005']){
      const delivery=target.capture.fingerprints.find(fp=>fp.id===itemId).payload.directPanoptoEvidence.deliveries[0];
      assert.equal(delivery.initial,null);assert.equal(delivery.final,null);assert.equal(delivery.podcasts.length,0);assert(delivery.failures.length>0);
      const failure=delivery.failures[0],receipt=failure.receipt;assert.equal(receipt.transport,'CTI_PUBLIC_BACKEND');
      assert.equal(receipt.status,scenario.provider==='metadata-auth'?401:0);
      assert.equal(receipt.observedAtBasis,scenario.provider==='metadata-auth'?'UPSTREAM':'CLIENT_ATTEMPT');
      assert.equal(receipt.serviceStatus,scenario.helper==='service-auth'?401:scenario.provider==='metadata-auth'?502:0);
      if(scenario.helper==='popup-blocked')assert.match(failure.reason,/POPUP_BLOCKED/);
    }
    const services=helperRequests.slice(serviceStart),upstream=helperUpstreamRequests.slice(upstreamStart);
    assert.equal(services.length,['popup-blocked','coop','access-denied'].includes(scenario.helper)?0:2);
    assert.equal(upstream.length,scenario.provider==='metadata-auth'?2:0);
    assert.equal(panoptoRequests.filter(request=>request.courseId===helperFailure.id).length,0);
    await target.context.close();
  }
  helperForeign.helperHold=true;helperForeign.helperReleased=false;
  const foreign=await open(helperForeign),foreignDownloads=[];foreign.page.on('download',download=>foreignDownloads.push(download));
  const foreignDownload=foreign.page.waitForEvent('download',{timeout:180000});void foreignDownload.catch(()=>{});
  await launch(foreign.page,foreign.context);
  assert(await poll(()=>Promise.resolve(helperForeign.helperHeld>0),15000));
  const actualHelper=foreign.popups.find(p=>p.url().startsWith(helperOrigin+'/provider-helper.html'));
  assert(actualHelper,'Capture opens a real cooperating CTI popup');
  await actualHelper.waitForFunction(()=>window.fixtureProviderFrames.some(frame=>frame.type==='request'&&frame.kind==='metadata'));
  const binding=await actualHelper.evaluate(()=>window.fixtureProviderFrames.find(frame=>frame.type==='request'&&frame.kind==='metadata'));
  const unrelatedOpened=foreign.context.waitForEvent('page');await foreign.page.getByRole('button',{name:'Open unrelated test window',exact:true}).click();
  const unrelated=await unrelatedOpened;await unrelated.waitForLoadState();
  await unrelated.evaluate(binding=>window.opener.postMessage({protocol:'CTI_PROVIDER_HELPER_V1',nonce:binding.nonce,courseId:binding.courseId,
    id:binding.id,itemId:binding.itemId,providerId:binding.providerId,type:'error',code:'PROVIDER_HELPER_INVALID_RESPONSE'},'https://www.coursera.org'),binding);
  await foreign.page.waitForFunction(binding=>window.fixtureProviderFrames.some(frame=>frame.type==='error'&&frame.nonce===binding.nonce&&frame.id===binding.id),binding);
  assert.equal(await foreign.page.evaluate(()=>window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__.running),true);
  assert.equal(foreignDownloads.length,0,'A same-origin foreign window with a correct nonce cannot complete or fail the owned provider request');
  releaseHelperFixture(helperForeign);const foreignState=await terminal(foreign.page),foreignCapture=await readFile(await foreignDownload);
  assert.equal(foreignDownloads.length,1);assertMixedNativeItems(helperForeign,foreignCapture);assertPanoptoMetadata(helperForeign,foreignCapture,true);
  const beforeCancelAssessments=foreignCapture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),beforeCancelBodies=retainedMediaBodies(foreignCapture);
  const originalPodcast=foreignCapture.fingerprints.find(fp=>fp.id==='item_0003').payload.directPanoptoEvidence.deliveries[0].podcasts[0];
  await unrelated.close();helperForeign.helperReleased=false;helperForeign.helperHeld=0;helperForeign.helperAborted=0;
  await foreign.page.reload();await launch(foreign.page,foreign.context);
  assert(await poll(()=>Promise.resolve(helperForeign.helperHeld>0),15000));
  await foreign.page.getByRole('button',{name:'Pause',exact:true}).click();
  const cancelled=await terminal(foreign.page);assert.equal(cancelled.state,'PAUSED');assert.equal(cancelled.runId,foreignState.runId);
  assert.equal(foreignDownloads.length,1,'Pausing does not produce an extra automatic file');
  assert(await poll(()=>Promise.resolve(helperForeign.helperAborted>0),5000),'Closing the owned helper aborts its real pending backend operation');
  const cancelledDownload=foreign.page.waitForEvent('download',{timeout:30000});
  await foreign.page.getByRole('button',{name:'Download saved capture',exact:true}).click();
  const cancelledCapture=await readFile(await cancelledDownload);
  assert.deepEqual(cancelledCapture.fingerprints.filter(fp=>fp.payload.assessmentApiEvidence),beforeCancelAssessments);
  const afterCancelBodies=retainedMediaBodies(cancelledCapture);
  for(const [assetId,asset]of beforeCancelBodies)assert.equal(afterCancelBodies.get(assetId)?.body.sha256,asset.body.sha256);
  const cancelledDelivery=cancelledCapture.fingerprints.find(fp=>fp.id==='item_0003').payload.directPanoptoEvidence.deliveries[0];
  const retainedPodcast=cancelledDelivery.podcasts.find(podcast=>podcast.retainedEvidence)?.retainedEvidence.podcast;
  assert(retainedPodcast?.body,'The original rendition remains available as explicitly historical evidence after cancellation');
  assert.equal(retainedPodcast.body.sha256,originalPodcast.body.sha256);
  assert.equal(retainedPodcast.body.receipt.observedAt,originalPodcast.body.receipt.observedAt);
  assert.deepEqual(Buffer.from(retainedPodcast.body.bytes),mp4Bytes);
  releaseHelperFixture(helperForeign);helperForeign.helperHold=false;await foreign.context.close();

  for(const config of [changed,changedMaterial,changedGroup,authentication,limited]){
    const target=await runFileCase(config);assert.equal(evaluateCourseraCapture(target.capture,config.id).complete,false);
    assert(target.capture.fingerprints.some(fp=>fp.captureContract?.complete!==true),'Failures remain explicit item gaps');
    if(config.mode==='limited')assert(requests.slice(target.start).filter(request=>request.courseId===config.id).length<=4);
    if(config.mode==='authentication')assert.equal(target.state.state,'PAUSED');
    await target.context.close();
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(helperErrors,[]);
  if(!nativeExecuted)console.warn('::warning::Managed Chromium blocks native bookmark URLs. Only the explicit debugger reader path was verified here; no browser policy changed.');
  console.log(JSON.stringify({status:nativeExecuted?'PASS':'PARTIAL',nativeBookmarkExecuted:nativeExecuted,readerVerified:true,
    inventory:185,contentItems:165,orderedMcqQuestions:609,checkboxKeys:true,unknownWidgetPreventsCompletion:true,
    realIndexedDbInterruptedResume:true,oldExportCutoffRunRecovered:true,stableVersionedDefinitionsNotReread:true,
    unchangedGroupsNeedOneFreshResumeRead:true,maximumRequestsInFlight:4,
    cumulativeResumeBudget:true,completeCaptureBeyondOld32MiBCutoff:true,losslessGzipWithin128MiB:true,expandedJsonWithin128MiB:true,
    originalPngPdfAndPptxBodies:true,exactAssetMetadataAndFreshStabilityReads:true,completedV110MediaEnrichmentSameRun:true,
    completeOriginalsBeyondOld64MiBCutoff:true,completedV12OriginalsMigratedIntoOneZip:true,
    interruptedMediaBodiesAndNativeDraftPreserved:true,resumedUnchangedBodiesNotDownloadedAgain:true,
    enrichmentNeverRereadsVerifiedAssessmentDefinitions:true,sixExternalWidgetsRemainUnverified:true,
    sameTitleWidgetProvidersIsolated:true,configuredTargetsNotSummaryExamples:true,widgetSettingsRefreshWithoutAssessmentRecapture:true,
    mixedProviderDispatchInOneBookmarkAndZip:true,panoptoNativeMetadataAndPodcastRenditionBytes:true,
    realCtiHelperPopupAndMaintainedBackend:true,publicHelperSucceedsWithoutRelaxingCourseCspOrCors:true,unknownProvidersNeverRequested:true,
    compactBookmarkExactBrowserSerialization:true,compactUnicodeAndPunctuationBookmarkExecuted:compactCanaryExecuted,
    panoptoResumeFreshlyDownloadsMutableRenditionAndPreservesAssessments:true,changedRenditionSourceInvalidatesReuse:true,
    bookmarkWaitsForExplicitCaptureOrAccessCheck:true,accessDiagnosticSeparatesUpstreamAndCtiServiceAndUnavailableHelper:true,
    directReaderPreservesGenuineCspAndCorsFailures:true,popupBlockedAndCoopAndAccessDeniedRemainExplicitGaps:true,
    publisherBrowserCorsAndCredentialModesEnforced:true,publisherApiRetainsExactUtf8JsonAndDistinctRawRenderedFields:true,
    publisherApiWrongIdentityProtectedDraftMimeUtf8AndBodyLimitRemainGaps:true,publisherBrowserBlockedResponseNeverInventsHttpStatus:true,
    completedV180ThroughV186CheckpointAccessUsesRealIndexedDbWithoutRecaptureOrWrites:true,
    publishedAtomDraftSnapshotsRetainExactGroupsDefinitionsHashesAndChronology:true,
    draftSnapshotsHaveIndependentSavedReportProjectionAndNeverSupplyCurrentPublishedCompletion:true,
    forgedPublishedPointerAndChangedFinalAtomOrGroupRemainGaps:true,
    completedV186ResumeAcquiresPreviouslySkippedDraftSnapshotsAndPreservesPrimaryQuestionDates:true,
    failedDraftSnapshotResumeRetainsFlatEarlierRawModelsAndOriginalObservationDates:true,
    sharedExactVersionDraftDefinitionReadOnceAcrossNonOverlappingOwnedGroupIntervals:true,
    failedSharedDefinitionHasOneFailureWithoutDuplicateTriples:true,
    v182FlagOrderOnlyResumePreservesNativeOriginalsAssessmentsAndCumulativeBudgets:true,
    syntheticTypedPartResolutionPreservesChapter404HistoryAndTwoGetBound:true,
    syntheticBackMatterResolutionPreservesTwoFlat404ReceiptsAndThreeGetBound:true,
    backMatterOriginalJsonImageOwnershipZipAndReportProjection:true,
    publisherImagesUseActualCorsAndExactSourceBoundOriginalArchiveBytes:true,
    publisherImagesOverlapAtMostTwoReadsAndCommitOriginalBlobsResourcesAndZipInSourceOrder:true,
    explicitAllNativeRecheckReadsCompletedAtomsAndMutableGroupsWithoutRelabelingCachedDefinitions:true,
    nativeRecheckFetchesNewExactVersionsAndRetainsPriorRawModelsAfterCurrentReadFailure:true,
    nativeRecheckPreservesPublishedAndExternalUncertaintyAndSeparateFreshRunBudgets:true,
    abortedNativeRecheckWithdrawsUnvisitedCompletionAcrossIndexedDbReloadAndOrdinaryResume:true,
    runningPartialExportKeepsFullInventoryAndOriginalBytesWithoutCheckpointMutation:true,
    partialSnapshotResumesNativeReadsAndPreservesExactlyOneAutomaticFinalArchive:true,
    publisherServiceImagesUseAuthenticatedHelperAndBoundedPublicBytesWithoutCorsForgery:true,
    publisherChallengeStopsSameOriginServiceReadsWithoutInventingSkippedHttpResults:true,
    publisherChallengeContextSurvivesZipAndReportWhileExplicitResumeRetriesOriginals:true,
    sameUniversalBookmarkRecoversExactPublisherOriginalsThroughExplicitFirstPartyPopup:true,
    firstPartyCookiesStayLocalWhileOriginalHashesNativeBindingsFailureHistoryAndQuestionDatesSurviveZip:true,
    publisherCoopSeveredOpenerRemainsAnExplicitUncapturedRecoveryFailure:true,
    changedNativeGraphRejectsFrozenPublisherRecoveryBeforeBytesAndPreservesOldRun:true,
    foreignSameOriginWindowCannotForgeProviderResult:true,cancelClosesHelperAndPreservesNativeAndHistoricalBytes:true,
    accessDiagnosticNeverRecapturesCourseOrWritesCheckpoints:true,accessReportSeparateSmallJsonOnlyOnRequest:true,
    missingAssetIdsAndMetadataAndCorsAndRedirectAndMimeAndBodyLimitAndSourceChangesRemainGaps:true,
    finalDownloadsPerCompletedRun:1,noEditorNavigation:true,authenticationAndLimitsAndSourceChangesRemainGaps:true,
    scope:'Actual generated entry with synthetic authoring draft APIs and explicit CORS-policy fixtures; no real Panopto CORS, playback or private-course completeness claim.'}));
}catch(error){
  console.error('::error::Direct-data browser check failed: '+error.message);throw error;
}finally{
  clearInterval(heartbeat);
  for(const timer of publisherPipeline.pairTimers.values())clearTimeout(timer);
  await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(scratch,{recursive:true,force:true});
}
