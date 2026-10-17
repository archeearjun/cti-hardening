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
import {createApiHandler} from '../server/api.ts';
import {CTI_OWNER_EMAIL} from '../server/access.ts';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';
import {readCourseraCaptureFileJson} from '../src/domain/coursera-capture-file.ts';
import {panoptoDeliveryFixture} from '../tests/panopto-delivery-fixtures.mjs';
import {validateProviderAccessDiagnostic,providerAccessDiagnosticText} from '../src/domain/provider-access-diagnostic.ts';
import {createCourseraDirectDataCaptureBookmark,createCourseraDirectDataCaptureScript} from '../src/domain/coursera-direct-data-capture.ts';
import {encodeJavaScriptBookmarkPayload} from '../src/domain/bookmark-address.js';

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
const secrets=['fixture-http-only-cookie','fixture-write-token','fixture-nested-token','fixture-asset-signed-secret','fixture-cti-helper-cookie'];
const configs=new Map(),atoms=new Map(),groups=new Map(),definitions=new Map(),assets=new Map(),providers=new Map(),fileSizes=new WeakMap();
const requests=[],mediaRequests=[],documents=[],errors=[],active=new Map(),maximum=new Map();
const panoptoDeliveries=new Map(),panoptoRequests=[];
const helperRequests=[],helperUpstreamRequests=[],helperErrors=[];
const readerFixtureEntry=path.join(scratch,'direct-reader-entry.js');
fs.writeFileSync(readerFixtureEntry,"import {createDirectDataReaderV1} from "+JSON.stringify(path.resolve('src/extractors/coursera/direct-data-network.js'))+";window.fixtureReadDirectProvider=async targetUrl=>{const reader=createDirectDataReaderV1();try{const result=await reader.readPanoptoDeliveryInfo(targetUrl);return{ok:result.ok,reason:result.reason,receipt:result.receipt};}finally{reader.abort('FIXTURE_FINISHED');}};");
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
const baseline=makeCourse('Direct_baseline_fixture_123','baseline',true);
const complete=makeCourse('Direct_complete_fixture_123','complete');
for(const row of definitions.values())if(row.courseId===complete.id){
  const native=row.value.definition.definition;
  native.prompt.definition.value='<co-content><p>Keep &lt;div&gt; &amp; literal</p><p>Second paragraph 日本語</p></co-content>';
  native.options[0].display.definition.value='<co-content><p>&lt;answer&gt;</p></co-content>';
  native.options[0].feedback.definition.value='<co-content><p>Feedback &lt;code&gt;</p><p>Second paragraph</p></co-content>';
}
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
const helperEnvironment={CTI_ADMINS:CTI_OWNER_EMAIL,CTI_DB:{prepare(){throw Error('Provider fixture must not read or write the workspace database');}}};
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
          const payload=JSON.parse(body),identity=new URL(payload.targetUrl).searchParams.get('id'),config=panoptoDeliveries.get(identity);
          assert(config);helperRequests.push({courseId:config.id,kind:url.pathname.split('/').at(-1),mode:helperMode(input)});
          providerConfig=config;
        }
        let result=await helperApi(input,helperEnvironment);
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
      (config?.panoptoMode&&config.panoptoMode!=='metadata-csp'?' '+panoptoOrigin+' '+panoptoMediaOrigin:''));
    response.end(`<!doctype html><title>Direct capture fixture</title><main><a id="editor" href="/teach/${slug}/${courseId}/content/item/project/item_0000">Open quiz normally</a><button id="foreign">Open unrelated test window</button></main><script nonce="fixture">
      window.fixtureEditorClicks=0;window.fixtureScrolls=0;window.fixtureCsp=[];window.fixtureCspEvents=[];
      document.getElementById('editor').onclick=()=>{window.fixtureEditorClicks++;};
      document.getElementById('foreign').onclick=()=>window.open('${helperOrigin}/foreign-window.html','fixture-attacker');
      window.addEventListener('scroll',()=>window.fixtureScrolls++,true);
      document.addEventListener('securitypolicyviolation',event=>{
        window.fixtureCsp.push(event.violatedDirective);
        window.fixtureCspEvents.push({blockedURI:event.blockedURI,effectiveDirective:event.effectiveDirective,disposition:event.disposition});
      });
      localStorage.setItem('__CTI_AUTOMATIC_LOCAL_ACTIVE_V61517_${courseId}','legacy-fixture-sentinel');
      ${config?.mode==='limited'?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={requests:4};':config?.mode==='budget-resume'?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={requests:40};':''}
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
    value=structuredClone(binding.value);
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
    if(config.mode==='media-first-atom-failed'&&binding.itemId==='item_0002'){
      response.statusCode=503;response.end('{"error":"current atom read failed before media acquisition"}');return;
    }
    if(config.mode==='media-final-atom-failed'&&binding.itemId==='item_0002'&&count>1){
      response.statusCode=503;response.end('{"error":"final atom consistency read interrupted"}');return;
    }
    if(config.mode==='changed'&&count>1){value.storedAtomVersion=2;value.metadata.updatedAt=2000;}
  }else if(resource==='authoringItemContentRelations.v1')value=structuredClone(binding.relation);
  else if(resource===groupResource){
    value=structuredClone(groups.get(reference)?.value);
    const count=(config.groupGets.get(reference)||0)+1;config.groupGets.set(reference,count);
    if(config.mode==='group-changed'&&count>1&&value)value.scoringWeight=2;
  }
  else if(resource===definitionResource){
    if(/%40/i.test(url.pathname)){response.statusCode=404;response.end('{"error":"literal version delimiter required"}');return;}
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
  const {courseraDirectDataSource}=await import('../src/generated/extractor-sources.js');
  assert.equal(typeof courseraDirectDataSource,'string','Generate the maintained direct-data delivery source first');
  assert.match(courseraDirectDataSource,/__CTI_COURSERA_DIRECT_DATA_CAPTURE__/);
  const deliveredProgram=createCourseraDirectDataCaptureScript(courseraDirectDataSource);
  const bookmark=createCourseraDirectDataCaptureBookmark(courseraDirectDataSource),parsedBookmark=new URL(bookmark);
  assert.equal(parsedBookmark.href,bookmark);assert.equal(parsedBookmark.search,'');assert.equal(parsedBookmark.hash,'');
  assert.equal(decodeURIComponent(parsedBookmark.pathname),deliveredProgram,'The compact address preserves the exact delivered source');
  assert(Buffer.byteLength(bookmark,'utf8')<=500*1024,'The exact emitted bookmark must fit Chrome Bookmark Manager\'s URL limit');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,
    ...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
    args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP www.coursera.org 127.0.0.1:'+server.address().port+
      ',MAP fixture-cdn.cloudfront.net 127.0.0.1:'+server.address().port+',MAP fixture.hosted.panopto.com 127.0.0.1:'+server.address().port+
      ',MAP d2y36twrtb17ty.cloudfront.net 127.0.0.1:'+server.address().port+',MAP cti-hardening.pages.dev 127.0.0.1:'+server.address().port],
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
  async function open(config){
    const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true}),contextDownloads=[],popups=[];
    await context.addInitScript(()=>{
      window.fixtureProviderFrames=[];
      window.addEventListener('message',event=>{const m=event.data;if(m?.protocol==='CTI_PROVIDER_HELPER_V1')
        window.fixtureProviderFrames.push({type:m.type,id:m.id,kind:m.kind,nonce:m.nonce,courseId:m.courseId,
          itemId:m.itemId,providerId:m.providerId,origin:event.origin,seq:m.seq,offset:m.offset,
          bytes:m.bytes instanceof ArrayBuffer?m.bytes.byteLength:0});});
    });
    context.on('page',target=>{target.on('pageerror',error=>errors.push(error.message));target.on('download',download=>contextDownloads.push({page:target,download}));popups.push(target);});
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
      config?.panoptoMode&&[panoptoOrigin,panoptoMediaOrigin].includes(destination)),
      'Only the authenticated authoring API and exact metadata-returned CDN can be requested');
    assert.equal(await page.evaluate(()=>window.fixtureEditorClicks),0);assert.equal(await page.evaluate(()=>window.fixtureScrolls),0);
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
  await success.context.close();

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
    foreignSameOriginWindowCannotForgeProviderResult:true,cancelClosesHelperAndPreservesNativeAndHistoricalBytes:true,
    accessDiagnosticNeverRecapturesCourseOrWritesCheckpoints:true,accessReportSeparateSmallJsonOnlyOnRequest:true,
    missingAssetIdsAndMetadataAndCorsAndRedirectAndMimeAndBodyLimitAndSourceChangesRemainGaps:true,
    finalDownloadsPerCompletedRun:1,noEditorNavigation:true,authenticationAndLimitsAndSourceChangesRemainGaps:true,
    scope:'Actual generated entry with synthetic authoring draft APIs and explicit CORS-policy fixtures; no real Panopto CORS, playback or private-course completeness claim.'}));
}catch(error){
  console.error('::error::Direct-data browser check failed: '+error.message);throw error;
}finally{
  clearInterval(heartbeat);
  await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(scratch,{recursive:true,force:true});
}
