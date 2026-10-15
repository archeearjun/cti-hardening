import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {evaluateCourseraCapture} from '../src/domain/coursera-background-extraction.ts';
import {readCourseraCaptureFileJson} from '../src/domain/coursera-capture-file.ts';

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
const secrets=['fixture-http-only-cookie','fixture-write-token','fixture-nested-token','fixture-asset-signed-secret'];
const configs=new Map(),atoms=new Map(),groups=new Map(),definitions=new Map(),assets=new Map(),providers=new Map(),fileSizes=new WeakMap();
const requests=[],mediaRequests=[],documents=[],errors=[],active=new Map(),maximum=new Map();
const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7sAAAAAASUVORK5CYII=','base64');
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
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(request,response)=>{
  const url=new URL(request.url,origin);
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
    if(!url.searchParams.has('open'))response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'nonce-fixture'; style-src 'self'; connect-src 'self' "+mediaOrigin);
    response.end(`<!doctype html><title>Direct capture fixture</title><main><a id="editor" href="/teach/${slug}/${courseId}/content/item/project/item_0000">Open quiz normally</a></main><script nonce="fixture">
      window.fixtureEditorClicks=0;window.fixtureScrolls=0;window.fixtureCsp=[];
      document.getElementById('editor').onclick=()=>{window.fixtureEditorClicks++;};
      window.addEventListener('scroll',()=>window.fixtureScrolls++,true);
      document.addEventListener('securitypolicyviolation',event=>window.fixtureCsp.push(event.violatedDirective));
      localStorage.setItem('__CTI_AUTOMATIC_LOCAL_ACTIVE_V61517_${courseId}','legacy-fixture-sentinel');
      ${config?.mode==='limited'?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={requests:4};':config?.mode==='budget-resume'?'window.__CTI_COURSERA_DIRECT_DATA_LIMITS__={requests:40};':''}
    </script>`);return;
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
  const deliveredProgram='void '+courseraDirectDataSource;
  const bookmark='javascript:'+encodeURIComponent(deliveredProgram);
  assert(Buffer.byteLength(bookmark,'utf8')<=500*1024,'The exact emitted bookmark must fit Chrome Bookmark Manager\'s URL limit');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,
    ...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
    args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--host-resolver-rules=MAP www.coursera.org 127.0.0.1:'+server.address().port+
      ',MAP fixture-cdn.cloudfront.net 127.0.0.1:'+server.address().port],
  });
  if(process.env.CTI_DIRECT_BROWSER_PROGRESS==='1')heartbeat=setInterval(async()=>{
    for(const context of browser.contexts())for(const page of context.pages())try{
      const progress=await page.evaluate(()=>{const state=window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;return state&&{courseId:state.courseId,state:state.state,phase:state.phase,counts:state.counts,exporting:state.exporting,exportError:state.exportError};});
      if(progress)console.error('Synthetic fixture progress: '+JSON.stringify(progress));
    }catch{ /* A closed synthetic page has no remaining state to report. */ }
  },10000);
  let nativeExecuted=true,policyCanaryVerified=false;
  async function poll(check,timeout=2000){const deadline=Date.now()+timeout;do{if(await check())return true;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);return false;}
  const canaryContext=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  if(allowPolicyFallback&&knownPolicy&&process.env.CTI_CHROMIUM_PATH==='/usr/bin/chromium'){
    const canary=await canaryContext.newPage();await canary.goto(origin+'/teach/'+slug+'/'+complete.id+'/content/edit?open=1');
    const session=await canaryContext.newCDPSession(canary),reply=await session.send('Page.navigate',{url:'javascript:void(window.__CTI_DIRECT_NATIVE_CANARY=true)',transitionType:'auto_bookmark'});
    assert.equal(reply.errorText,'net::ERR_ABORTED');assert.equal(await poll(()=>canary.evaluate(()=>window.__CTI_DIRECT_NATIVE_CANARY===true)),false);
    assert.equal(requests.length,0);policyCanaryVerified=true;await session.detach();await canary.close();
  }
  await canaryContext.close();
  async function launch(page,context){
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
  }
  async function open(config){
    const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true}),page=await context.newPage();
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
    page.on('pageerror',error=>errors.push(error.message));
    const destinations=[];page.on('request',request=>destinations.push(new URL(request.url()).origin));
    await page.goto(origin+'/teach/'+slug+'/'+config.id+'/content/edit');
    return {context,page,destinations};
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
    assert([...new Set(destinations)].every(destination=>destination===origin||destination===mediaOrigin),
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
  function assertOriginalMedia(config,capture){
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
    const verdict=evaluateCourseraCapture(capture,config.id);assert.equal(verdict.complete,true,JSON.stringify(verdict.reasons));
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
  await configured.context.close();

  for(const config of [changed,changedMaterial,changedGroup,authentication,limited]){
    const target=await runFileCase(config);assert.equal(evaluateCourseraCapture(target.capture,config.id).complete,false);
    assert(target.capture.fingerprints.some(fp=>fp.captureContract?.complete!==true),'Failures remain explicit item gaps');
    if(config.mode==='limited')assert(requests.slice(target.start).filter(request=>request.courseId===config.id).length<=4);
    if(config.mode==='authentication')assert.equal(target.state.state,'PAUSED');
    await target.context.close();
  }
  assert.deepEqual(errors,[]);
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
    missingAssetIdsAndMetadataAndCorsAndRedirectAndMimeAndBodyLimitAndSourceChangesRemainGaps:true,
    finalDownloadsPerCompletedRun:1,noEditorNavigation:true,authenticationAndLimitsAndSourceChangesRemainGaps:true,
    scope:'Actual generated entry with synthetic authoring draft APIs; no private-course completeness or throughput claim.'}));
}catch(error){
  console.error('::error::Direct-data browser check failed: '+error.message);throw error;
}finally{
  clearInterval(heartbeat);
  await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(scratch,{recursive:true,force:true});
}
