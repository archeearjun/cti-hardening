import { assessmentOutlineCandidatesV613, assessmentLayoutV61313, assessmentCaptureCoverageV613, rawAssessmentStateV61522 } from './assessments-4.js';
import { assessmentPartCountV8 } from './assessments-2.js';
import { assessmentOutlinePromptAlignedV613 } from './assessments-3.js';
import { isGenericCourseEditRoute, isItemSpecificCourseRoute } from './navigation-2.js';
import { courseId, stripHtml } from './text-and-dom.js';
import { sleepMs } from './text-and-dom-2.js';
import { isVisibleElement } from './text-and-dom-3.js';
import { isGlobalChromeElement } from './text-and-dom-4.js';
import { CTI_ASSESSMENT_API_BATCH_IDS_V61524, CTI_ASSESSMENT_API_CONCURRENCY_V61524, CTI_ASSESSMENT_API_REQUEST_MS_V61524,
  CTI_ASSESSMENT_API_BODY_BYTES_V61524, CTI_ASSESSMENT_API_TOTAL_BYTES_V61524, CTI_ASSESSMENT_API_MAX_PARTS_V61524,
  CTI_ASSESSMENT_API_RAIL_DISCOVERY_MS_V61524, CTI_ASSESSMENT_API_RAIL_MAX_STEPS_V61524 } from './config.js';

export function sanitizeAssessmentApiValueV61524(value, deadline) {
  const copied=rawAssessmentStateV61522(value,deadline);
  if(!copied.complete)return null;
  function removeSecrets(v){
    if(!v || typeof v!=='object')return;
    for(const key of Object.keys(v)){
      if(/^(?:writeAccessToken|accessToken|csrfToken|authorization)$/i.test(key))delete v[key];
      else removeSecrets(v[key]);
    }
  }
  removeSecrets(copied.value);return copied.value;
}

export function assessmentApiCmlV61524(value) {
  if(!value || value.typeName!=='cml' || !value.definition || typeof value.definition.value!=='string')return null;
  const text=stripHtml(value.definition.value);
  return {text,raw:value};
}

export function parseCourseraMcqDefinitionV61524(element, candidate) {
  if(!element || typeof element.id!=='string' || !candidate || !candidate.ordinal ||
    !/^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+@\d+$/.test(element.id))return null;
  const wrapper=element.definition,definition=wrapper && wrapper.definition;
  if(!wrapper || wrapper.typeName!=='mcq' || !definition || !Array.isArray(definition.options) ||
    definition.options.length<2 || definition.options.length>100 || typeof definition.correctOption!=='string')return null;
  const prompt=assessmentApiCmlV61524(definition.prompt);
  if(!prompt || !prompt.text || !assessmentOutlinePromptAlignedV613(candidate.label,prompt.text))return null;
  const ids=new Set(),options=[];
  for(const option of definition.options){
    if(!option || typeof option.id!=='string' || !option.id || ids.has(option.id))return null;
    const display=assessmentApiCmlV61524(option.display);
    const feedback=option.feedback==null?{text:''}:assessmentApiCmlV61524(option.feedback);
    if(!display || !display.text || !feedback)return null;
    ids.add(option.id);
    options.push({id:option.id,sourceOptionId:option.id,text:display.text,label:display.text,description:'',aliases:[],
      correct:option.id===definition.correctOption,feedback:feedback.text});
  }
  const chosen=options.filter(option=>option.correct);
  if(chosen.length!==1)return null;
  return {id:String(candidate.ordinal),courseraQuestionId:candidate.id,sourceDefinitionId:element.id,
    questionOrdinalObserved:true,type:'single-select',rawType:'mcq',prompt:prompt.text,options,
    correctAnswers:[chosen[0].text],feedback:'',points:null,optionTextReliable:true,answerTextReliable:true,
    answerKeyEvidence:{method:'EXACT_CORRECT_OPTION_ID',correctOption:definition.correctOption},
    shuffleOptions:typeof definition.shuffleOptions==='boolean'?definition.shuffleOptions:null,
    observationMethod:'AUTHORING_API_MATCHED_TO_LIVE_OUTLINE',observedAtMs:Date.now(),parserConfidence:0.98};
}

export function assessmentApiBodyInventoryV61527(layout) {
  const out={complete:false,reason:'INCOMPLETE_OBSERVED_BODY_INVENTORY',candidates:[]};
  if(!layout || !layout.sidebar.isConnected || !layout.content.isConnected ||
    layout.content===document.body || layout.content===document.documentElement ||
    layout.content.contains(layout.sidebar) || layout.sidebar.contains(layout.content))return out;
  const declared=assessmentPartCountV8(layout.root);
  if(!Number.isInteger(declared) || declared<1 || declared>CTI_ASSESSMENT_API_MAX_PARTS_V61524)return out;
  const parts=[...layout.content.querySelectorAll('[data-testid^="assignment-part-"]')].filter(part=>part.isConnected);
  const ids=new Set(),ordinals=new Set(),assignments=new Set(),byId=new Map();
  for(const part of parts){
    const id=String(part.id || ''),identity=id.match(/^([A-Za-z0-9_-]+)~[A-Za-z0-9_-]+$/);
    const index=String(part.getAttribute('data-testid') || '').match(/^assignment-part-(\d+)$/);
    const ordinal=index?Number(index[1])+1:0;
    if(!identity || !index || ordinal<1 || ordinal>declared || ids.has(id) || ordinals.has(ordinal) ||
      document.getElementById(id)!==part){out.reason='AMBIGUOUS_OBSERVED_BODY_INVENTORY';return out;}
    ids.add(id);ordinals.add(ordinal);assignments.add(identity[1]);byId.set(id,{id,ordinal,label:''});
  }
  if(parts.length!==declared || ordinals.size!==declared || assignments.size!==1)return out;
  const live=assessmentOutlineCandidatesV613(layout.sidebar,declared);
  if(!live.length)return out;
  for(const anchor of layout.sidebar.querySelectorAll('a[href^="#"]')){
    if(!isVisibleElement(anchor))continue;
    try{const id=decodeURIComponent(String(anchor.getAttribute('href') || '').slice(1));
      if(/^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+$/.test(id) && !byId.has(id)){
        out.reason='AMBIGUOUS_OBSERVED_BODY_INVENTORY';return out;
      }
    }catch(_){}
  }
  for(const candidate of live){
    const part=byId.get(candidate.id);
    if(!part || part.ordinal!==candidate.ordinal){out.reason='AMBIGUOUS_OBSERVED_BODY_INVENTORY';return out;}
    part.label=candidate.label;
  }
  // Exact compound DOM IDs and explicit part ordinals establish order even
  // when the virtual rail mounts fewer anchors. Blank labels carry no prompt
  // assertion; every definition/key still requires its exact versioned API ID.
  out.complete=true;out.reason='COMPLETE_OBSERVED_BODY_PART_INVENTORY';out.declared=declared;
  out.assignmentId=[...assignments][0];out.candidates=[...byId.values()].sort((a,b)=>a.ordinal-b.ordinal);
  return out;
}

export function assessmentApiUniqueLayoutV61525(layout,observedParts=null) {
  if(!layout || !layout.sidebar.isConnected || !layout.content.isConnected)return false;
  const sidebars=[...document.querySelectorAll('[data-testid="item-layout-left-sidebar"]')].filter(isVisibleElement);
  const contents=[...document.querySelectorAll('[data-testid="item-layout-content"]')].filter(isVisibleElement);
  if(sidebars.length!==1 || sidebars[0]!==layout.sidebar)return false;
  if(contents.length){
    if(contents.length!==1 || contents[0]!==layout.content)return false;
    return [...document.querySelectorAll('[data-testid^="assignment-part-"]')].filter(isVisibleElement)
      .every(part=>layout.content.contains(part) && !layout.sidebar.contains(part) && !isGlobalChromeElement(part));
  }
  // Coursera also renders a body without the content test marker. The existing
  // layout observer establishes that body from its exact sidebar -> part IDs.
  // Retain that structural proof, rather than accepting an arbitrary page root.
  if(layout.method!=='OBSERVED_OUTLINE_AND_ASSOCIATED_BODY' ||
    !isVisibleElement(layout.content) || layout.root===document.body || layout.root===document.documentElement ||
    layout.content===document.body || layout.content===document.documentElement ||
    layout.content===layout.sidebar || layout.content.contains(layout.sidebar) || layout.sidebar.contains(layout.content) ||
    !layout.root.contains(layout.sidebar) || !layout.root.contains(layout.content) || isGlobalChromeElement(layout.content))return false;
  const anchorIds=new Set();
  for(const anchor of layout.sidebar.querySelectorAll('a[href^="#"]')){
    try{const id=decodeURIComponent(String(anchor.getAttribute('href') || '').slice(1));
      if(/^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+$/.test(id))anchorIds.add(id);
    }catch(_){}
  }
  // During this layout's own rail discovery, a mounted question can stay in
  // the body after its anchor is virtualized away. Only identities/ordinals
  // already observed in that pinned sidebar can witness that association.
  if(observedParts && typeof observedParts.entries==='function'){
    for(const [id,candidate] of observedParts.entries())if(candidate?.id===id &&
      /^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+$/.test(id) && Number.isInteger(candidate.ordinal) && candidate.ordinal>0)anchorIds.add(id);
  }
  const bodyInventory=assessmentApiBodyInventoryV61527(layout);
  if(bodyInventory.complete)for(const candidate of bodyInventory.candidates)anchorIds.add(candidate.id);
  const parts=[...document.querySelectorAll('[data-testid^="assignment-part-"]')].filter(isVisibleElement);
  const partIds=new Set();
  if(!parts.length)return false;
  for(const part of parts){
    if(!part.id || partIds.has(part.id) || !anchorIds.has(part.id) ||
      document.getElementById(part.id)!==part || !layout.content.contains(part) ||
      layout.sidebar.contains(part) || isGlobalChromeElement(part))return false;
    const observed=observedParts && typeof observedParts.get==='function'?observedParts.get(part.id):null;
    const ordinal=String(part.getAttribute('data-testid') || '').match(/^assignment-part-(\d+)$/);
    if(observed && (!ordinal || Number(ordinal[1])+1!==observed.ordinal))return false;
    partIds.add(part.id);
  }
  return true;
}

export function assessmentApiFreshLayoutV61527(layout,baselineSet) {
  if(!assessmentApiUniqueLayoutV61525(layout) || !baselineSet || typeof baselineSet.has!=='function' ||
    typeof baselineSet[Symbol.iterator]!=='function' ||
    baselineSet.has(layout.sidebar) || baselineSet.has(layout.content))return false;
  // A preexisting part/body must not become a "new" inferred body merely
  // because its content test marker was absent. The entry snapshots connected
  // regions and question parts before activating this exact course item.
  for(const region of baselineSet){
    if(!region || typeof region.contains!=='function')continue;
    if(region.contains(layout.sidebar) || region.contains(layout.content) ||
      layout.sidebar.contains(region) || layout.content.contains(region))return false;
  }
  return true;
}

export function assessmentApiRouteEditorCertifiedV61526(surfaceRoot,fp,expectedCourseId,baselineSet) {
  if(!fp || !fp.id || location.origin!=='https://www.coursera.org' ||
    String(expectedCourseId || '')!==courseId() ||
    !isItemSpecificCourseRoute(location.href,fp,expectedCourseId) ||
    !baselineSet || typeof baselineSet.has!=='function')return false;
  // A fresh editor on the exact item route establishes identity independently
  // of the course-outline control's label or discovery confidence score.
  const layout=assessmentLayoutV61313(surfaceRoot);
  return assessmentApiFreshLayoutV61527(layout,baselineSet);
}

export function createAssessmentApiSessionCertificateV61525(surfaceRoot,fp,expectedCourseId,exactItemControl,baselineSet) {
  if(exactItemControl!==true || !fp || !fp.id || location.origin!=='https://www.coursera.org' ||
    String(expectedCourseId || '')!==courseId() || !isGenericCourseEditRoute(location.href,expectedCourseId) ||
    !baselineSet || typeof baselineSet.has!=='function')return null;
  const layout=assessmentLayoutV61313(surfaceRoot);
  if(!assessmentApiFreshLayoutV61527(layout,baselineSet))return null;
  return {exactItemControl:true,itemId:String(fp.id),courseId:String(expectedCourseId),route:location.href,sidebar:layout.sidebar,content:layout.content};
}

export function assessmentApiEditorIdentityV61524(surfaceRoot,fp,options={}) {
  const failed={verified:false,method:'',layout:null,reason:options.sessionCertificate?'SESSION_EDITOR_IDENTITY_NOT_VERIFIED':'EDITOR_NOT_CERTIFIED'};
  if(options.certifiedItem!==true && !options.sessionCertificate)return failed;
  if(!fp || !fp.id || String(options.courseId || '')!==courseId() ||
    location.origin!=='https://www.coursera.org')return failed;
  const layout=assessmentLayoutV61313(surfaceRoot);
  if(!assessmentApiUniqueLayoutV61525(layout))return failed;
  if(options.certifiedItem===true && isItemSpecificCourseRoute(location.href,fp,options.courseId))return {verified:true,method:'ITEM_SPECIFIC_ROUTE',layout};
  const certificate=options.sessionCertificate;
  if(!isGenericCourseEditRoute(location.href,options.courseId) || !certificate || certificate.exactItemControl!==true ||
    certificate.itemId!==String(fp.id) || certificate.courseId!==String(options.courseId) || certificate.route!==location.href ||
    certificate.sidebar!==layout.sidebar || certificate.content!==layout.content || certificate.sidebar===certificate.content ||
    !assessmentApiUniqueLayoutV61525(layout))return failed;
  // The entry owns the exact outline-control interaction and constructs this
  // certificate only for a newly mounted layout. Pin its observed DOM identities
  // throughout acquisition; a generic route by itself supplies no item proof.
  return {verified:true,method:'SESSION_EXACT_ITEM_CONTROL',layout};
}

export function assessmentApiSessionStillCurrentV61525(surfaceRoot,fp,expectedCourseId,certificate) {
  if(!certificate)return true;
  try {
    const before=new URL(certificate.route),current=new URL(location.href);
    before.hash='';current.hash='';
    if(before.href!==current.href)return false;
    // Question anchors may change the fragment during the editor fallback.
    // Course, query, pinned regions and global uniqueness must still agree.
    return assessmentApiEditorIdentityV61524(surfaceRoot,fp,{courseId:expectedCourseId,
      sessionCertificate:{...certificate,route:location.href}}).verified;
  } catch (_) {return false;}
}

export function assessmentApiInventoryFromObservedCandidatesV61524(surfaceRoot,fp,options={},observedCandidates=null) {
  const out={complete:false,reason:'EDITOR_NOT_CERTIFIED',candidates:[],declared:0,assignmentId:'',resources:{}};
  const identity=assessmentApiEditorIdentityV61524(surfaceRoot,fp,options);
  if(!identity.verified){out.reason=identity.reason;return out;}
  const layout=identity.layout;
  if(!layout){out.reason='EDITOR_OUTLINE_UNAVAILABLE';return out;}
  const declared=assessmentPartCountV8(layout.root);
  if(!Number.isInteger(declared) || declared<1 || declared>CTI_ASSESSMENT_API_MAX_PARTS_V61524){out.reason='UNSUPPORTED_DECLARED_PART_COUNT';return out;}
  const bodyInventory=observedCandidates?null:assessmentApiBodyInventoryV61527(layout);
  const candidates=observedCandidates || (bodyInventory?.complete?bodyInventory.candidates:assessmentOutlineCandidatesV613(layout.sidebar,declared)),ids=new Set(),ordinals=new Set(),assignments=new Set();
  out.declared=declared;out.candidates=candidates;
  for(const candidate of candidates){
    const match=String(candidate.id || '').match(/^([A-Za-z0-9_-]+)~([A-Za-z0-9_-]+)$/);
    if(!match || !Number.isInteger(candidate.ordinal) || candidate.ordinal<1 || candidate.ordinal>declared ||
      ids.has(candidate.id) || ordinals.has(candidate.ordinal)){out.reason='AMBIGUOUS_OUTLINE_IDENTITY';return out;}
    ids.add(candidate.id);ordinals.add(candidate.ordinal);assignments.add(match[1]);
  }
  if(assignments.size!==1){out.reason='INCOMPLETE_LIVE_OUTLINE_INVENTORY';return out;}
  const assignmentId=[...assignments][0];
  // These two read resources and their response schemas were established by
  // the supplied real Coursera authoring sample. An endpoint template is not
  // item identity: the certified live editor, exact group IDs and observed
  // ordinals above supply that proof. A cached editor need not issue the same
  // discovery requests again before its definitions can be read.
  const resources={
    groups:{base:'https://www.coursera.org/api/authoringAssignmentQuestionGroups.v1',source:'CAPTURE_ADAPTER'},
    questions:{base:'https://www.coursera.org/api/authoringAssignmentMachineEvaluableQuestions.v1',source:'CAPTURE_ADAPTER'}
  };
  const observed=Array.isArray(options.observedRequests)?options.observedRequests.filter(r=>r && r.method==='GET').map(r=>({url:r.url,source:'OBSERVED_GET'})):[];
  if(identity.method==='ITEM_SPECIFIC_ROUTE'){
    try{for(const entry of performance.getEntriesByType('resource'))if(!entry.initiatorType || ['fetch','xmlhttprequest'].includes(entry.initiatorType))observed.push({url:entry.name,source:'OBSERVED_RESOURCE_URL'});}catch(_){}
  }
  for(const observedRequest of observed){
    try{
      const url=new URL(observedRequest.url,location.href);
      if(url.origin!==location.origin || url.origin!=='https://www.coursera.org' || url.username || url.password)continue;
      const match=decodeURIComponent(url.pathname).match(/^\/api\/(authoringAssignmentQuestionGroups\.v1|authoringAssignmentMachineEvaluableQuestions\.v1)\/([^/]+)\/?$/);
      if(!match)continue;
      const group=match[1]==='authoringAssignmentQuestionGroups.v1';
      const idMatch=match[2].match(group?/^([A-Za-z0-9_-]+)~[A-Za-z0-9_-]+$/:/^([A-Za-z0-9_-]+)~[A-Za-z0-9_-]+@\d+$/);
      if(!idMatch || idMatch[1]!==assignmentId)continue;
      resources[group?'groups':'questions']={base:url.origin+'/api/'+match[1],observedId:match[2],source:observedRequest.source};
    }catch(_){}
  }
  out.assignmentId=assignmentId;out.resources=resources;
  if(candidates.length!==declared || ordinals.size!==declared){out.reason='INCOMPLETE_LIVE_OUTLINE_INVENTORY';return out;}
  return {complete:true,reason:'COMPLETE_LIVE_OUTLINE_INVENTORY',candidates:candidates.map(c=>({id:c.id,ordinal:c.ordinal,label:c.label})),
    declared,assignmentId,resources,signature:JSON.stringify(candidates.map(c=>[c.id,c.ordinal,c.label])),sidebar:layout.sidebar,content:layout.content,route:location.href,identityMethod:identity.method,
    discovery:bodyInventory?.complete?{method:'COMPLETE_OBSERVED_BODY_PART_INVENTORY',scrollSteps:0,restored:true}:undefined};
}

export function observedAssessmentApiInventoryV61524(surfaceRoot,fp,options={}) {
  return assessmentApiInventoryFromObservedCandidatesV61524(surfaceRoot,fp,options);
}

export async function discoverAssessmentApiRailInventoryV61524(surfaceRoot,fp,options={}) {
  const initial=observedAssessmentApiInventoryV61524(surfaceRoot,fp,options);
  if(initial.reason!=='INCOMPLETE_LIVE_OUTLINE_INVENTORY')return initial;
  const layout=assessmentLayoutV61313(surfaceRoot),sidebar=layout && layout.sidebar,content=layout && layout.content,route=location.href;
  if(!sidebar)return initial;
  const started=Date.now(),deadline=Math.min(Number(options.deadline || Infinity),started+CTI_ASSESSMENT_API_RAIL_DISCOVERY_MS_V61524);
  const seen=new Map(),ordinals=new Map(),roots=[],originals=new Map();let steps=0,reason='INCOMPLETE_LIVE_OUTLINE_INVENTORY';
  function observe(){
    const current=assessmentLayoutV61313(surfaceRoot);
    if(location.href!==route || !sidebar.isConnected || !content?.isConnected || !layout.root.isConnected ||
      !layout.root.contains(sidebar) || !layout.root.contains(content) ||
      current && (current.sidebar!==sidebar || current.content!==content) ||
      !current && layout.method!=='OBSERVED_OUTLINE_AND_ASSOCIATED_BODY' ||
      assessmentPartCountV8(layout.root)!==initial.declared){reason='EDITOR_IDENTITY_CHANGED_DURING_API_DISCOVERY';return false;}
    for(const candidate of assessmentOutlineCandidatesV613(sidebar,initial.declared)){
      const prior=seen.get(candidate.id),ordinalId=ordinals.get(candidate.ordinal);
      if(prior && (prior.ordinal!==candidate.ordinal || prior.label!==candidate.label) || ordinalId && ordinalId!==candidate.id){reason='AMBIGUOUS_OUTLINE_IDENTITY';return false;}
      seen.set(candidate.id,{id:candidate.id,ordinal:candidate.ordinal,label:candidate.label});ordinals.set(candidate.ordinal,candidate.id);
    }
    if(!assessmentApiUniqueLayoutV61525(layout,seen)){reason='EDITOR_IDENTITY_CHANGED_DURING_API_DISCOVERY';return false;}
    return true;
  }
  function addRoot(root){
    if(!root || roots.includes(root) || root===document.body || root===document.documentElement || root.contains(layout.content))return;
    try{const style=getComputedStyle(root);
      if(root.clientHeight>40 && root.scrollHeight>root.clientHeight+8 && /^(auto|scroll|overlay)$/.test(style.overflowY || ''))roots.push(root);
    }catch(_){}
  }
  addRoot(sidebar);for(let parent=sidebar.parentElement;parent && parent!==layout.root;parent=parent.parentElement)addRoot(parent);
  try{for(const node of sidebar.querySelectorAll('div,section,ul,ol'))addRoot(node);}catch(_){}
  if(!observe())return {...initial,reason};
  try{
    for(const root of roots.slice(0,3)){
      originals.set(root,Number(root.scrollTop || 0));
      const step=Math.max(80,Math.floor(root.clientHeight*0.7));
      for(let y=0;Date.now()<deadline && steps<CTI_ASSESSMENT_API_RAIL_MAX_STEPS_V61524;y+=step){
        const max=Math.max(0,root.scrollHeight-root.clientHeight),position=Math.min(y,max);
        if(Number(root.scrollTop || 0)!==position){root.scrollTop=position;steps++;await sleepMs(80);}
        if(!observe())break;
        if(seen.size===initial.declared || position===max)break;
      }
      if(reason!=='INCOMPLETE_LIVE_OUTLINE_INVENTORY' || seen.size===initial.declared)break;
    }
  }finally{
    for(const [root,position] of originals)if(root.isConnected && Number(root.scrollTop || 0)!==position){root.scrollTop=position;await sleepMs(80);}
  }
  if(reason!=='INCOMPLETE_LIVE_OUTLINE_INVENTORY')return {...initial,reason};
  if(!observe())return {...initial,reason};
  const candidates=[...seen.values()].sort((a,b)=>a.ordinal-b.ordinal);
  const result=assessmentApiInventoryFromObservedCandidatesV61524(surfaceRoot,fp,options,candidates);
  result.discovery={method:'OBSERVED_VIRTUAL_RAIL_SCROLL',scrollSteps:steps,restored:true,elapsedMs:Date.now()-started};
  return result;
}

export function recheckAssessmentApiInventoryV61524(surfaceRoot,fp,options,inventory) {
  const mounted=observedAssessmentApiInventoryV61524(surfaceRoot,fp,options);
  const layout=assessmentLayoutV61313(surfaceRoot);
  if(!layout || layout.sidebar!==inventory.sidebar || layout.content!==inventory.content)
    return {...mounted,complete:false,reason:'EDITOR_IDENTITY_CHANGED_DURING_API_CAPTURE'};
  if(mounted.complete)return mounted;
  if(!inventory.discovery || mounted.reason!=='INCOMPLETE_LIVE_OUTLINE_INVENTORY' || location.href!==inventory.route)return mounted;
  if(!layout || layout.sidebar!==inventory.sidebar || !inventory.sidebar.isConnected || mounted.declared!==inventory.declared)return mounted;
  const known=new Map(inventory.candidates.map(c=>[c.id,c]));
  for(const candidate of mounted.candidates){const prior=known.get(candidate.id);
    if(!prior || prior.ordinal!==candidate.ordinal || prior.label!==candidate.label)return {...mounted,reason:'EDITOR_IDENTITY_CHANGED_DURING_API_CAPTURE'};}
  if(!mounted.candidates.length)return mounted;
  return assessmentApiInventoryFromObservedCandidatesV61524(surfaceRoot,fp,options,inventory.candidates);
}

export async function collectCourseraAssessmentApiV61524(surfaceRoot,fp,options={}) {
  const out={attempted:false,captured:false,assessment:null,rawEvidence:null,stopReason:'',authenticationFailed:false,
    diagnostics:{requests:0,maxConcurrentRequests:0,bytes:0,rateLimitRetries:0,multiGetUnsupported:[],missingGroups:[],missingDefinitions:[],unsupportedGroups:[],failures:[]}};
  const inventory=await discoverAssessmentApiRailInventoryV61524(surfaceRoot,fp,options);
  out.stopReason=inventory.reason;
  if(!inventory.complete)return out;
  out.diagnostics.inventoryDiscovery=inventory.discovery || {method:'COMPLETE_MOUNTED_RAIL',scrollSteps:0,restored:true};
  if(typeof options.onProgress==='function')options.onProgress(0,inventory.declared);
  const deadline=Math.min(Number(options.deadline || Infinity),Date.now()+120000);
  const fetchImpl=options.fetchImpl || window.fetch.bind(window);
  const state={active:0,stop:'',bytes:0};out.attempted=true;
  function recordFailure(url,result){
    if(result.ok || out.diagnostics.failures.length>=40)return;
    let resource='';try{resource=new URL(url).pathname.split('/')[2] || '';}catch(_){}
    out.diagnostics.failures.push({resource,status:Number(result.status || 0),reason:String(result.reason || 'API_REQUEST_FAILED')});
  }
  async function request(url,retry=0){
    if(state.stop || Date.now()>=deadline)return {ok:false,reason:state.stop || 'ITEM_API_DEADLINE'};
    const controller=new AbortController(),timeoutMs=Math.min(CTI_ASSESSMENT_API_REQUEST_MS_V61524,deadline-Date.now());
    let timer,counted=true;state.active++;out.diagnostics.requests++;out.diagnostics.maxConcurrentRequests=Math.max(out.diagnostics.maxConcurrentRequests,state.active);
    function finishRequest(){if(counted){state.active--;counted=false;}}
    try{
      const result=await Promise.race([(async()=>{
        const response=await fetchImpl(url,{method:'GET',credentials:'same-origin',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
        if(response.status===401 || response.status===403){out.authenticationFailed=true;state.stop='AUTHORING_API_AUTHENTICATION_FAILED';return {ok:false,status:response.status,reason:state.stop};}
        if(response.status===429)return {ok:false,status:429,reason:'RATE_LIMITED',retryAfter:response.headers.get('retry-after')};
        if(!response.ok)return {ok:false,status:response.status,reason:'HTTP_'+response.status};
        const actual=new URL(response.url || url),expected=new URL(url);
        if(response.redirected || actual.origin!==expected.origin || actual.pathname!==expected.pathname)return {ok:false,reason:'UNEXPECTED_API_REDIRECT'};
        if(!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''))return {ok:false,reason:'UNEXPECTED_API_MIME'};
        const chunks=[];let bodyBytes=0;
        if(response.body && typeof response.body.getReader==='function'){
          const reader=response.body.getReader();
          try{while(true){const next=await reader.read();if(next.done)break;bodyBytes+=next.value.byteLength;state.bytes+=next.value.byteLength;
            if(bodyBytes>CTI_ASSESSMENT_API_BODY_BYTES_V61524 || state.bytes>CTI_ASSESSMENT_API_TOTAL_BYTES_V61524){state.stop=state.bytes>CTI_ASSESSMENT_API_TOTAL_BYTES_V61524?'ITEM_API_BYTE_LIMIT':'API_RESPONSE_BYTE_LIMIT';controller.abort();await reader.cancel();return {ok:false,reason:state.stop};}chunks.push(next.value);}}
          finally{reader.releaseLock();}
          const bytes=new Uint8Array(bodyBytes);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
          return {ok:true,data:JSON.parse(new TextDecoder().decode(bytes)),status:response.status};
        }
        const text=await response.text();bodyBytes=new TextEncoder().encode(text).byteLength;state.bytes+=bodyBytes;
        if(bodyBytes>CTI_ASSESSMENT_API_BODY_BYTES_V61524 || state.bytes>CTI_ASSESSMENT_API_TOTAL_BYTES_V61524){state.stop='API_RESPONSE_BYTE_LIMIT';return {ok:false,reason:state.stop};}
        return {ok:true,data:JSON.parse(text),status:response.status};
      })(),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({ok:false,reason:'API_REQUEST_TIMEOUT'});},timeoutMs);})]);
      recordFailure(url,result);
      if(result.status===429 && retry===0 && !state.stop){
        const seconds=Number(result.retryAfter),date=Date.parse(String(result.retryAfter || ''));
        const requestedWait=result.retryAfter!==null && Number.isFinite(seconds)?Math.max(0,seconds*1000):Number.isFinite(date)?Math.max(0,date-Date.now()):1000;
        const wait=Math.max(500,requestedWait);
        if(wait>10000 || Date.now()+wait>=deadline){state.stop='AUTHORING_API_RATE_LIMITED';return {ok:false,reason:state.stop};}
        out.diagnostics.rateLimitRetries++;clearTimeout(timer);finishRequest();await sleepMs(wait);return request(url,1);
      }
      if(result.status===429){state.stop='AUTHORING_API_RATE_LIMITED';return {...result,reason:state.stop};}
      return result;
    }catch(_){const result={ok:false,reason:controller.signal.aborted?'API_REQUEST_TIMEOUT':'API_REQUEST_FAILED'};recordFailure(url,result);return result;}
    finally{clearTimeout(timer);finishRequest();out.diagnostics.bytes=state.bytes;}
  }
  function readElements(response,requested){
    if(!response.ok || !response.data || !Array.isArray(response.data.elements))return {ok:false,reason:response.reason || 'INVALID_API_ENVELOPE'};
    const elements=new Map(),allowed=new Set(requested);
    for(const element of response.data.elements){
      if(!element || typeof element.id!=='string' || !allowed.has(element.id) || elements.has(element.id))return {ok:false,reason:'AMBIGUOUS_API_RESPONSE_IDENTITY'};
      elements.set(element.id,element);
    }
    return {ok:true,elements};
  }
  async function acquire(resource,ids,fields){
    const found=new Map(),missing=new Set();if(!ids.length)return found;
    function urlFor(batch,multiple){const url=new URL(resource.base+(multiple?'':'/'+encodeURIComponent(batch[0])));
      if(multiple)url.searchParams.set('ids',batch.join(','));url.searchParams.set('fields',fields+',-writeAccessToken');return url.href;}
    const firstIds=ids.slice(0,CTI_ASSESSMENT_API_BATCH_IDS_V61524),first=await request(urlFor(firstIds,true));
    const unsupported=[400,404,405,501].includes(first.status);
    if(unsupported)out.diagnostics.multiGetUnsupported.push(resource.base.split('/').pop());
    let remaining=ids;
    function accept(read,requested){
      if(!read.ok)return;
      for(const [id,element] of read.elements)found.set(id,element);
      if(!unsupported)for(const id of requested)if(!read.elements.has(id))missing.add(id);
    }
    if(!unsupported){const read=readElements(first,firstIds);recordFailure(urlFor(firstIds,true),read);accept(read,firstIds);remaining=ids.slice(firstIds.length);}
    const batches=[];
    for(let i=0;i<remaining.length;i+=unsupported?1:CTI_ASSESSMENT_API_BATCH_IDS_V61524)batches.push(remaining.slice(i,i+(unsupported?1:CTI_ASSESSMENT_API_BATCH_IDS_V61524)));
    let cursor=0;
    async function worker(){while(cursor<batches.length && !state.stop && Date.now()<deadline){const batch=batches[cursor++],response=await request(urlFor(batch,!unsupported));
      const read=readElements(response,batch);recordFailure(urlFor(batch,!unsupported),read);accept(read,batch);}}
    await Promise.all(Array.from({length:Math.min(CTI_ASSESSMENT_API_CONCURRENCY_V61524,batches.length)},()=>worker()));
    // Fill only omissions from structurally valid, identity-checked batch
    // responses. Ambiguous identities and failed batches remain explicit gaps.
    const missingIds=[...missing].filter(id=>!found.has(id));let missingCursor=0;
    async function fillMissing(){while(missingCursor<missingIds.length && !state.stop && Date.now()<deadline){
      const id=missingIds[missingCursor++],url=urlFor([id],false),response=await request(url),read=readElements(response,[id]);
      recordFailure(url,read);if(read.ok && read.elements.has(id))found.set(id,read.elements.get(id));}}
    await Promise.all(Array.from({length:Math.min(CTI_ASSESSMENT_API_CONCURRENCY_V61524,missingIds.length)},()=>fillMissing()));return found;
  }
  const groupIds=inventory.candidates.map(c=>c.id),groups=await acquire(inventory.resources.groups,groupIds,'id,questions,scoringWeight');
  if(out.authenticationFailed){out.stopReason=state.stop;return out;}
  const supported=new Map(),questionIds=[];
  for(const candidate of inventory.candidates){
    const group=groups.get(candidate.id);
    if(!group){out.diagnostics.missingGroups.push(candidate.id);continue;}
    if(!Array.isArray(group.questions) || group.questions.length!==1 || typeof group.questions[0]!=='string' ||
      !new RegExp('^'+inventory.assignmentId+'~[A-Za-z0-9_-]+@\\d+$').test(group.questions[0])){out.diagnostics.unsupportedGroups.push(candidate.id);continue;}
    supported.set(candidate.id,group);questionIds.push(group.questions[0]);
  }
  const uniqueQuestionIds=[...new Set(questionIds)],definitions=await acquire(inventory.resources.questions,uniqueQuestionIds,'id,definition');
  if(out.authenticationFailed){out.stopReason=state.stop;return out;}
  const after=recheckAssessmentApiInventoryV61524(surfaceRoot,fp,options,inventory);
  if(!after.complete || after.signature!==inventory.signature){out.stopReason='EDITOR_IDENTITY_CHANGED_DURING_API_CAPTURE';return out;}
  const questions=[],rawGroups=[],rawDefinitions=[],sanitizedGroups=new Map(),sanitizedDefinitions=new Map();
  for(const [id,group] of groups){const raw=sanitizeAssessmentApiValueV61524(group,deadline);if(raw){rawGroups.push(raw);sanitizedGroups.set(id,raw);}}
  for(const [id,element] of definitions){const raw=sanitizeAssessmentApiValueV61524(element,deadline);if(raw){rawDefinitions.push(raw);sanitizedDefinitions.set(id,raw);}}
  for(const candidate of inventory.candidates){
    const group=supported.get(candidate.id);if(!group)continue;
    const element=definitions.get(group.questions[0]);
    if(!element){out.diagnostics.missingDefinitions.push(group.questions[0]);continue;}
    const raw=sanitizedDefinitions.get(element.id);
    const parsed=raw && parseCourseraMcqDefinitionV61524(raw,candidate);
    if(!parsed){out.diagnostics.missingDefinitions.push(element.id);continue;}
    const rawGroup=sanitizedGroups.get(group.id);
    if(!rawGroup){out.diagnostics.unsupportedGroups.push(candidate.id);continue;}
    questions.push(parsed);
    if(typeof options.onProgress==='function')options.onProgress(questions.length,inventory.declared);
  }
  const coverage=assessmentCaptureCoverageV613(questions,inventory.declared,'AUTHORING_API', {declaredContentParts:inventory.declared});
  out.captured=coverage.requiredAnswerCoverageComplete===true;
  out.stopReason=out.captured?'COMPLETE_ITEM_BOUND_AUTHORING_API':state.stop || (Date.now()>=deadline?'ITEM_API_DEADLINE':'AUTHORING_API_EVIDENCE_INCOMPLETE');
  out.rawEvidence={method:'OBSERVED_ITEM_BOUND_AUTHORING_GETS',identityMethod:inventory.identityMethod,courseId:String(options.courseId),itemId:String(fp.id),assignmentId:inventory.assignmentId,
    observedAt:new Date().toISOString(),inventory:inventory.candidates,groups:rawGroups,questionDefinitions:rawDefinitions,resources:inventory.resources};
  if(questions.length){out.assessment={schemaVersion:6,parser:'coursera-item-bound-authoring-api-v1',origin:'coursera-authoring-api',
    declaredQuestionCount:inventory.declared,questionCount:questions.length,answerEvidenceQuestionCount:questions.length,questions,
    captureCompleteness:coverage,parserConfidence:out.captured?0.98:0.84,warnings:out.captured?[]:['Item-bound API capture is incomplete; inspect explicit missing identities.']};
    if(typeof options.onCheckpoint==='function')await options.onCheckpoint(out.assessment,
      {rawEvidence:out.rawEvidence,diagnostics:out.diagnostics,stopReason:out.stopReason});}
  return out;
}
