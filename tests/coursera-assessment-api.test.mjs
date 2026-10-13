import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as config from '../src/extractors/coursera/config.js';

const {fixture,El}=createRequire(import.meta.url)('../tools/assessment-fixture.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
function cml(text){return {typeName:'cml',definition:{dtdId:'synthetic',value:'<p>'+text+'</p>',unknownMath:'<math><mi>α</mi></math>'}};}
function definition(n){return {id:'assessment~definition'+n+'@1',writeAccessToken:'synthetic-secret',definition:{typeName:'mcq',definition:{
  prompt:cml(`Which result is correct for scenario ${n} in this assessment?`),shuffleOptions:true,correctOption:'chosen-'+n,
  options:[{id:'chosen-'+n,display:cml('Correct choice '+n),feedback:cml('Explanation '+n)},
   {id:'other-'+n,display:cml('Wrong choice '+n),feedback:cml('Wrong explanation '+n)}],
  unknownOriginalField:{unicode:'café 日本語',writeAccessToken:'nested-synthetic-secret'}}}};}
function setup(count=100,windowSize=count){
 const f=fixture({count,windowSize,mode:'virtual',budget:480000});
 f.c.URL=URL;f.c.AbortController=AbortController;f.c.TextEncoder=TextEncoder;f.c.TextDecoder=TextDecoder;f.c.setTimeout=setTimeout;f.c.clearTimeout=clearTimeout;
 f.c.MAX_CAPTURED_RESPONSE_CHARS=2500000;
 f.c.Date=Date;
 f.c.crypto=webcrypto;
 f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit/assessment/assessment-under-test');
 f.c.performance={getEntriesByType:()=>[
  {initiatorType:'fetch',name:'https://www.coursera.org/api/authoringAssignmentQuestionGroups.v1/assessment~q1?fields=id,questions'},
  {initiatorType:'xmlhttprequest',name:'https://www.coursera.org/api/authoringAssignmentMachineEvaluableQuestions.v1/assessment~definition1@1?fields=id,definition'}]};
 for(const [name,value] of Object.entries(config))f.c[name]=value;
 const calls=[];let active=0,maxActive=0;
 const fetchImpl=async (url,options)=>{
  calls.push({url,options});active++;maxActive=Math.max(maxActive,active);
  try{
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');
   const parsed=new URL(url);assert(parsed.searchParams.get('fields').includes('-writeAccessToken'));
   const ids=parsed.searchParams.has('ids')?parsed.searchParams.get('ids').split(','):[decodeURIComponent(parsed.pathname.split('/').pop())];
   const groups=parsed.pathname.includes('QuestionGroups');
   const elements=ids.map(id=>{
    const n=Number(id.match(groups?/~q(\d+)$/:/~definition(\d+)@1$/)?.[1]);
    return groups?{id,questions:['assessment~definition'+n+'@1'],scoringWeight:7,writeAccessToken:'synthetic-secret'}:definition(n);
   }).reverse();
   return new Response(JSON.stringify({elements,paging:{},linked:{}}),{headers:{'content-type':'application/json'}});
  }finally{active--;}
 };
 return {...f,calls,fetchImpl,maxActive:()=>maxActive,options:{certifiedItem:true,courseId:'Assessment_fixture_123',deadline:Date.now()+30000,fetchImpl}};
}

test('exact item-bound API batches preserve IDs, CML, keys and ordering without question rendering',async()=>{
 const f=setup();let writes=0,lastProgress=0;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,
  onProgress:(count,total)=>{lastProgress=count;assert.equal(total,100);},onCheckpoint:async(model,observation)=>{
   writes++;assert.equal(model.questionCount,100);assert.equal(observation.stopReason,'COMPLETE_ITEM_BOUND_AUTHORING_API');
   assert.equal(observation.diagnostics.requests,14);assert.equal(observation.rawEvidence.questionDefinitions.length,100);
   assert.equal(observation.rawEvidence.questionDefinitions.find(element=>element.id==='assessment~definition1@1').definition.definition.prompt.definition.value,definition(1).definition.definition.prompt.definition.value);
   assert(!JSON.stringify(observation).includes('synthetic-secret'));assert(!JSON.stringify(observation).includes('writeAccessToken'));
  }});
 assert.equal(result.captured,true);assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(f.clicks(),0);assert.equal(f.calls.length,14);assert(f.maxActive()<=2);assert.equal(result.diagnostics.maxConcurrentRequests,2);
 assert.equal(writes,1);assert.equal(lastProgress,100);
 assert(result.assessment.questions.every((q,i)=>q.id===String(i+1) && q.courseraQuestionId==='assessment~q'+(i+1) && q.sourceDefinitionId==='assessment~definition'+(i+1)+'@1'));
 assert.equal(result.assessment.questions[26].correctAnswers[0],'Correct choice 27');
 assert.equal(result.assessment.questions[26].points,null,'Scoring weight is retained without guessing point semantics');
 assert.equal(result.assessment.questions[26].options[0].sourceOptionId,'chosen-27');
 assert.equal(result.assessment.questions[26].options[0].feedback,'Explanation 27');
 assert.equal(result.rawEvidence.groups[26].scoringWeight,7);
 assert.equal(result.rawEvidence.questionDefinitions[26].definition.definition.prompt.definition.unknownMath,'<math><mi>α</mi></math>');
 assert.equal(result.rawEvidence.questionDefinitions[26].definition.definition.unknownOriginalField.unicode,'café 日本語');
 assert(!JSON.stringify(result.rawEvidence).includes('synthetic-secret'));
});

test('unsupported multiGet is probed once per resource and falls back to finite observed single GETs',async()=>{
 const f=setup(20),fetch=f.fetchImpl;let probes=0;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async(url,options)=>{
  if(new URL(url).searchParams.has('ids')){probes++;return new Response(null,{status:405});}return fetch(url,options);
 }});
 assert.equal(result.captured,true);assert.equal(probes,2);assert.equal(f.calls.length,40);assert.equal(result.diagnostics.requests,42);
 assert.deepEqual(clone(result.diagnostics.multiGetUnsupported).sort(),['authoringAssignmentMachineEvaluableQuestions.v1','authoringAssignmentQuestionGroups.v1']);
 assert.equal(f.clicks(),0);assert(f.maxActive()<=2);
});

test('single GETs preserve the observed literal version separator and resource-specific query shape',async()=>{
 const f=setup(100),fetch=f.fetchImpl;let probes=0,singles=0;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async(url,options)=>{
  const request=new URL(url),groups=request.pathname.includes('QuestionGroups');
  if(request.searchParams.has('ids')){probes++;return new Response(null,{status:405});}
  singles++;
  const key=request.pathname.split('/').pop();
  if(groups)assert.equal(request.searchParams.get('id'),key);
  else{
   assert.equal(request.searchParams.has('id'),false);
   // Match the successful Coursera path before URI decoding. Decoding here
   // previously hid an encoded @ delimiter that returns a missing definition.
   if(/%40/i.test(key))return new Response(null,{status:404});
   assert.match(key,/^assessment~definition\d+@1$/);
  }
  assert(request.searchParams.get('fields').split(',').includes('validation'));
  return fetch(url,options);
 }});
 assert.equal(result.captured,true);assert.equal(result.assessment.questionCount,100);
 assert.equal(result.diagnostics.requests,202);assert.equal(probes,2);assert.equal(singles,200);
 assert.deepEqual(clone(result.diagnostics.failures).map(failure=>failure.status),[405,405]);
 assert.equal(f.clicks(),0);assert(f.maxActive()<=2);
});

test('failed definition HTTP reads appear once per request with their actual status',async()=>{
 const f=setup(20),fetch=f.fetchImpl;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async(url,options)=>{
  const request=new URL(url);
  if(request.searchParams.has('ids'))return new Response(null,{status:405});
  if(request.pathname.includes('MachineEvaluable'))return new Response(null,{status:404});
  return fetch(url,options);
 }});
 assert.equal(result.captured,false);assert.equal(result.diagnostics.requests,42);
 assert.equal(result.diagnostics.missingGroups.length,0);assert.equal(result.diagnostics.missingDefinitions.length,20);
 assert.equal(result.diagnostics.failures.length,22);
 assert.equal(result.diagnostics.failures.filter(failure=>failure.status===405).length,2);
 assert.equal(result.diagnostics.failures.filter(failure=>failure.status===404 && failure.reason==='HTTP_404').length,20);
 assert.equal(result.diagnostics.failures.some(failure=>failure.status===0),false);
});

test('valid partial batches fill each omitted exact identity once with a single GET',async()=>{
 const f=setup(20),fetch=f.fetchImpl,omitted=new Set(),singles=[];
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async(url,options)=>{
  const parsed=new URL(url),resource=parsed.pathname.split('/')[2],response=await fetch(url,options),body=await response.json();
  if(parsed.searchParams.has('ids') && !omitted.has(resource)){omitted.add(resource);body.elements.pop();}
  else if(!parsed.searchParams.has('ids'))singles.push(resource+':'+decodeURIComponent(parsed.pathname.split('/').pop()));
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 }});
 assert.equal(result.captured,true);assert.equal(singles.length,2);assert.equal(new Set(singles).size,2);
 assert.equal(f.calls.length,6);assert(f.maxActive()<=2);assert.equal(f.clicks(),0);
});

test('an incomplete or uncertified live outline starts no API requests',async()=>{
 const f=setup();
 const rejected=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,certifiedItem:false});
 assert.equal(rejected.attempted,false);assert.equal(f.calls.length,0);
 f.sidebar.children[1].remove();
 f.sidebar.onScroll=null;
 const incomplete=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 assert.equal(incomplete.attempted,false);assert.equal(f.calls.length,0);
 assert.equal(incomplete.stopReason,'INCOMPLETE_LIVE_OUTLINE_INVENTORY');
});

test('variants, duplicate response IDs and missing correct-option relations remain explicit gaps',async()=>{
 for(const failure of ['variants','duplicates','missingKey']){
  const f=setup(10),fetch=f.fetchImpl;
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async(url,options)=>{
   const response=await fetch(url,options),body=await response.json();
   if(url.includes('QuestionGroups') && failure==='variants')body.elements[0].questions.push('assessment~second-variant@1');
   if(url.includes('MachineEvaluable') && failure==='duplicates')body.elements.push(body.elements[0]);
   if(url.includes('MachineEvaluable') && failure==='missingKey')body.elements[0].definition.definition.correctOption='not-an-observed-option';
   return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  }});
  assert.equal(result.captured,false);assert.equal(f.clicks(),0);
  assert(!result.assessment || result.assessment.captureCompleteness.requiredAnswerCoverageComplete===false);
  if(failure==='variants')assert.equal(result.diagnostics.unsupportedGroups.length,1);
  if(failure==='variants')assert.equal(result.rawEvidence.groups.find(group=>group.questions.length>1).questions.length,2,'Unsupported variants remain in raw evidence');
  if(failure==='duplicates'){
   assert(result.diagnostics.failures.some(x=>x.reason==='AMBIGUOUS_API_RESPONSE_IDENTITY'));
   assert(f.calls.every(call=>new URL(call.url).searchParams.has('ids')),'An ambiguous response cannot be hidden by single-GET fallback');
  }
  if(failure==='missingKey'){
   assert.equal(result.diagnostics.missingDefinitions.length,1);
   assert(result.rawEvidence.questionDefinitions.some(element=>element.definition.definition.correctOption==='not-an-observed-option'),'An unsupported key relation remains observable in raw evidence');
  }
 }
});

test('authentication failure is terminal and changed editor identities cannot complete',async()=>{
 for(const status of [401,403]){
  const f=setup(20);let requests=0;
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async()=>{requests++;return new Response(null,{status});}});
  assert.equal(requests,1);assert.equal(result.authenticationFailed,true);assert.equal(result.assessment,null);assert.equal(result.rawEvidence,null);
  assert.equal(result.stopReason,'AUTHORING_API_AUTHENTICATION_FAILED');
 }
 const f=setup(10),fetch=f.fetchImpl;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async(url,options)=>{
  const response=await fetch(url,options);if(url.includes('MachineEvaluable'))f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit/assessment/another-item');return response;
 }});
 assert.equal(result.captured,false);assert.equal(result.assessment,null);assert.equal(result.stopReason,'EDITOR_IDENTITY_CHANGED_DURING_API_CAPTURE');
});

test('wrong MIME, redirect and a bounded item deadline report technical failures without accepting content',async()=>{
 for(const failure of ['mime','redirect','timeout']){
  const f=setup(10);
  // Certify the DOM before testing the deliberately pending fetch. Twenty ms
  // could expire before a request starts when other suites occupy the CPU.
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,deadline:Date.now()+(failure==='timeout'?1000:10000),fetchImpl:async()=>{
   if(failure==='timeout')return new Promise(()=>{});
   const response=new Response('{}',{headers:{'content-type':failure==='mime'?'text/html':'application/json'}});
   if(failure==='redirect')Object.defineProperty(response,'url',{value:'https://www.coursera.org/login'});return response;
  }});
  assert.equal(result.captured,false);assert.equal(result.assessment,null);
  const reason=failure==='mime'?'UNEXPECTED_API_MIME':failure==='redirect'?'UNEXPECTED_API_REDIRECT':'API_REQUEST_TIMEOUT';
  assert(result.diagnostics.failures.some(x=>x.reason===reason));
 }
});

test('one bounded retry honors a rate limit without increasing request concurrency',async()=>{
 const f=setup(10),fetch=f.fetchImpl;let limited=false;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async(url,options)=>{
  if(!limited){limited=true;return new Response(null,{status:429,headers:{'retry-after':'0'}});}return fetch(url,options);
 }});
 assert.equal(result.captured,true);assert.equal(result.diagnostics.rateLimitRetries,1);assert.equal(result.diagnostics.requests,3);
 assert(result.diagnostics.maxConcurrentRequests<=2);assert.equal(f.clicks(),0);
});

test('a long or future-date Retry-After declines safely without retrying ahead of the server',async()=>{
 for(const retryAfter of ['30',new Date(Date.now()+60000).toUTCString()]){
  const f=setup(10);let requests=0;
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async()=>{
   requests++;return new Response(null,{status:429,headers:{'retry-after':retryAfter}});
  }});
  assert.equal(requests,1);assert.equal(result.diagnostics.rateLimitRetries,0);assert.equal(result.captured,false);
  assert.equal(result.stopReason,'AUTHORING_API_RATE_LIMITED');
 }
});

test('a second rate-limited response stops acquisition after its single permitted retry',async()=>{
 const f=setup(20);let requests=0;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async()=>{
  requests++;return new Response(null,{status:429,headers:{'retry-after':'0'}});
 }});
 assert.equal(requests,2);assert.equal(result.diagnostics.rateLimitRetries,1);assert.equal(result.captured,false);
 assert.equal(result.stopReason,'AUTHORING_API_RATE_LIMITED');
});

test('a virtual rail discovers exact identities while restoring its own position and leaving content untouched',async()=>{
 const f=setup(100,27);f.sidebar.scrollTop=64;
 assert.equal(f.sidebar.querySelectorAll('a[href^="#"]').length,27);
 const contentPosition=f.content.scrollTop,bodyPosition=f.c.window.scrollY;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 assert.equal(result.captured,true);assert.equal(f.clicks(),0);assert.equal(f.sidebar.scrollTop,64);
 assert(result.diagnostics.inventoryDiscovery.scrollSteps>0);assert.equal(result.diagnostics.inventoryDiscovery.restored,true);
 assert.equal(f.content.scrollTop,contentPosition);assert.equal(f.c.window.scrollY,bodyPosition);
});

test('a cached virtual editor uses the verified adapter for a resource family absent from timing entries',async()=>{
 const f=setup(100,27);f.sidebar.scrollTop=64;let scrolls=0;
 const scroll=f.sidebar.onScroll;f.sidebar.onScroll=y=>{scrolls++;scroll(y);};
 f.c.performance={getEntriesByType:()=>[{initiatorType:'fetch',name:'https://www.coursera.org/api/authoringAssignmentQuestionGroups.v1/assessment~q1'}]};
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 assert.equal(result.captured,true);assert(scrolls>0);assert.equal(f.sidebar.scrollTop,64);assert.equal(f.clicks(),0);
 assert.equal(result.rawEvidence.resources.groups.source,'OBSERVED_RESOURCE_URL');
 assert.equal(result.rawEvidence.resources.questions.source,'CAPTURE_ADAPTER');
 assert.equal(f.calls.length,14);
});

test('a generic course route needs a pinned exact-item session while cached endpoint observations remain optional',async()=>{
 const f=setup(100);f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit');
 const certificate={exactItemControl:true,itemId:f.fp.id,courseId:'Assessment_fixture_123',route:f.c.location.href,sidebar:f.sidebar,content:f.content};
 const observedRequests=f.c.performance.getEntriesByType('resource').map(entry=>({url:entry.name,method:'GET'}));
 const bare=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 assert.equal(bare.attempted,false);assert.equal(bare.stopReason,'EDITOR_NOT_CERTIFIED');assert.equal(f.calls.length,0);
 const performanceOnly=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,sessionCertificate:certificate});
 assert.equal(performanceOnly.captured,true);assert.equal(f.clicks(),0);
 assert.equal(performanceOnly.rawEvidence.resources.groups.source,'CAPTURE_ADAPTER');
 assert.equal(performanceOnly.rawEvidence.resources.questions.source,'CAPTURE_ADAPTER');
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,certifiedItem:false,sessionCertificate:certificate,observedRequests});
 assert.equal(result.captured,true);assert.equal(result.rawEvidence.identityMethod,'SESSION_EXACT_ITEM_CONTROL');assert.equal(f.clicks(),0);
 assert(result.rawEvidence.resources.groups.source==='OBSERVED_GET' && result.rawEvidence.resources.questions.source==='OBSERVED_GET');
});

test('a generic course session rejects stale identities and ignores non-GET records when using the verified read adapter',async()=>{
 const f=setup(10);f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit');
 const certificate={exactItemControl:true,itemId:f.fp.id,courseId:'Assessment_fixture_123',route:f.c.location.href,sidebar:f.sidebar,content:f.content};
 const observedRequests=f.c.performance.getEntriesByType('resource').map(entry=>({url:entry.name,method:'GET'}));
 for(const change of [{exactItemControl:false},{sidebar:{}},{content:{}},{itemId:'another-item'},{courseId:'another-course'},{route:f.c.location.href+'?old=1'}]){
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,sessionCertificate:{...certificate,...change},observedRequests});
  assert.equal(result.attempted,false);assert.equal(result.stopReason,'SESSION_EDITOR_IDENTITY_NOT_VERIFIED');
 }
 const posts=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,sessionCertificate:certificate,
  observedRequests:observedRequests.map(record=>({...record,method:'POST'}))});
 assert.equal(posts.captured,true);assert.equal(f.calls.length,2);assert(f.calls.every(call=>call.options.method==='GET'));
 assert.equal(posts.rawEvidence.resources.groups.source,'CAPTURE_ADAPTER');
 assert.equal(posts.rawEvidence.resources.questions.source,'CAPTURE_ADAPTER');
});

test('an item-specific project editor captures definitions without any previous resource timing entries',async()=>{
 const f=setup(10);
 f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/project/assessment-under-test');
 f.c.performance={getEntriesByType:()=>[]};
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 assert.equal(result.captured,true);assert.equal(result.rawEvidence.identityMethod,'ITEM_SPECIFIC_ROUTE');assert.equal(f.clicks(),0);
 assert.equal(result.rawEvidence.resources.groups.source,'CAPTURE_ADAPTER');
 assert.equal(result.rawEvidence.resources.questions.source,'CAPTURE_ADAPTER');
 assert(f.calls.every(call=>new URL(call.url).origin==='https://www.coursera.org'&&call.options.method==='GET'));
});

test('a fresh exact project route certifies an Untitled editor independently from the outline-control score',()=>{
 const f=setup(10);f.fp.name='Untitled';
 f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/project/assessment-under-test');
 const certify=f.c.assessmentApiRouteEditorCertifiedV61526;
 assert.equal(certify(f.envelope,f.fp,'Assessment_fixture_123',new Set()),true);
 assert.equal(certify(f.envelope,{...f.fp,id:'wrong-item'},'Assessment_fixture_123',new Set()),false);
 assert.equal(certify(f.envelope,f.fp,'wrong-course',new Set()),false);
 assert.equal(certify(f.envelope,f.fp,'Assessment_fixture_123',null),false);
 assert.equal(certify(f.envelope,f.fp,'Assessment_fixture_123',new Set([f.sidebar])),false);
 assert.equal(certify(f.envelope,f.fp,'Assessment_fixture_123',new Set([f.content])),false);
 f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit');
 assert.equal(certify(f.envelope,f.fp,'Assessment_fixture_123',new Set()),false);
 f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/project/assessment-under-test');
 f.c.document.body.append(f.sidebar.cloneNode(true),f.content.cloneNode(true));
 assert.equal(certify(f.envelope,f.fp,'Assessment_fixture_123',new Set()),false);
});

test('a pinned generic-route editor session cannot survive replacement of its live sidebar',async()=>{
 const f=setup(10),fetch=f.fetchImpl;f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit');
 const certificate={exactItemControl:true,itemId:f.fp.id,courseId:'Assessment_fixture_123',route:f.c.location.href,sidebar:f.sidebar,content:f.content};
 const observedRequests=f.c.performance.getEntriesByType('resource').map(entry=>({url:entry.name,method:'GET'}));
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,sessionCertificate:certificate,observedRequests,
  fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(url.includes('MachineEvaluable'))f.sidebar.remove();return response;}});
 assert.equal(result.captured,false);assert.equal(result.assessment,null);assert.equal(result.stopReason,'EDITOR_IDENTITY_CHANGED_DURING_API_CAPTURE');
});

test('the session certificate requires an exact control and two new unique editor regions',()=>{
 const f=setup(10);f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit');
 const create=f.c.createAssessmentApiSessionCertificateV61525;
 const certificate=create(f.envelope,f.fp,'Assessment_fixture_123',true,new Set());
 assert.equal(certificate.exactItemControl,true);assert.equal(certificate.sidebar,f.sidebar);assert.equal(certificate.content,f.content);
 assert.equal(create(f.envelope,f.fp,'Assessment_fixture_123',false,new Set()),null);
 assert.equal(create(f.envelope,f.fp,'another-course',true,new Set()),null);
 assert.equal(create(f.envelope,f.fp,'Assessment_fixture_123',true,new Set([f.sidebar])),null);
 assert.equal(create(f.envelope,f.fp,'Assessment_fixture_123',true,new Set([f.content])),null);
 const duplicate=f.sidebar.cloneNode(true);f.c.document.body.append(duplicate);
 assert.equal(create(f.envelope,f.fp,'Assessment_fixture_123',true,new Set()),null);
});

test('a second visible modal rejects a pinned session before any API acquisition',async()=>{
 const f=setup(10);f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit');
 const certificate=f.c.createAssessmentApiSessionCertificateV61525(f.envelope,f.fp,'Assessment_fixture_123',true,new Set());
 const observedRequests=f.c.performance.getEntriesByType('resource').map(entry=>({url:entry.name,method:'GET'}));
 f.c.document.body.append(f.sidebar.cloneNode(true),f.content.cloneNode(true));
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,certifiedItem:false,sessionCertificate:certificate,observedRequests});
 assert.equal(result.attempted,false);assert.equal(result.stopReason,'SESSION_EDITOR_IDENTITY_NOT_VERIFIED');assert.equal(f.calls.length,0);
});

test('fresh unmarked content bodies use exact live part associations for project and generic editor API reads',async()=>{
 for(const route of ['project','generic']){
  const f=setup(100);f.fp.name='Untitled';delete f.content.attrs['data-testid'];
  f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/'+
   (route==='project'?'item/project/assessment-under-test':'edit'));
  const layout=f.c.assessmentLayoutV61313(f.envelope);
  assert.equal(layout.method,'OBSERVED_OUTLINE_AND_ASSOCIATED_BODY');assert.equal(layout.content,f.content);
  const certificate=route==='generic'?f.c.createAssessmentApiSessionCertificateV61525(f.envelope,f.fp,'Assessment_fixture_123',true,new Set()):null;
  const certifiedItem=route==='project'&&f.c.assessmentApiRouteEditorCertifiedV61526(f.envelope,f.fp,'Assessment_fixture_123',new Set());
  assert.equal(Boolean(certificate||certifiedItem),true);
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,certifiedItem,sessionCertificate:certificate});
  assert.equal(result.captured,true);assert.equal(result.assessment.questionCount,100);assert.equal(f.calls.length,14);assert.equal(f.clicks(),0);
  assert.equal(result.rawEvidence.questionDefinitions.length,100);
 }
});

test('unmarked body certification declines stale regions, unrelated parts, competing markers and global chrome',()=>{
 for(const defect of ['stale-content','stale-part','stale-ancestor','missing-part','foreign-part','duplicate-part','marked-conflict','global-chrome']){
  const f=setup(10);delete f.content.attrs['data-testid'];
  f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/item/project/assessment-under-test');
  const baseline=new Set(),part=f.content.querySelector('[data-testid="assignment-part-0"]');
  if(defect==='stale-content')baseline.add(f.content);
  if(defect==='stale-part')baseline.add(part);
  if(defect==='stale-ancestor')baseline.add(f.envelope);
  if(defect==='missing-part')f.content.replaceChildren();
  if(defect==='foreign-part')f.c.document.body.append(new El('section',{'data-testid':'assignment-part-500',id:'anotherAssignment~foreignPart'},'Foreign question'));
  if(defect==='duplicate-part')f.c.document.body.append(part.cloneNode(true));
  if(defect==='marked-conflict')f.c.document.body.append(new El('div',{'data-testid':'item-layout-content'},'Different content body'));
  if(defect==='global-chrome')f.content.setAttribute('aria-label','Global navigation');
  assert.equal(f.c.assessmentApiRouteEditorCertifiedV61526(f.envelope,f.fp,'Assessment_fixture_123',baseline),false,defect);
  f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/edit');
  assert.equal(f.c.createAssessmentApiSessionCertificateV61525(f.envelope,f.fp,'Assessment_fixture_123',true,baseline),null,defect);
 }
});

test('an unmarked content body remains pinned while API definitions are read',async()=>{
 for(const route of ['project','generic']){
  const f=setup(10),fetch=f.fetchImpl;delete f.content.attrs['data-testid'];
  f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/'+
   (route==='project'?'item/project/assessment-under-test':'edit'));
  const certificate=route==='generic'?f.c.createAssessmentApiSessionCertificateV61525(f.envelope,f.fp,'Assessment_fixture_123',true,new Set()):null;
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,certifiedItem:route==='project',sessionCertificate:certificate,
   fetchImpl:async(url,options)=>{const response=await fetch(url,options);
    if(url.includes('MachineEvaluable')){const replacement=f.content.cloneNode(true);f.content.remove();f.envelope.append(replacement);}
    return response;
   }});
  assert.equal(result.captured,false);assert.equal(result.assessment,null);assert.equal(result.rawEvidence,null);
  assert.equal(result.stopReason,'EDITOR_IDENTITY_CHANGED_DURING_API_CAPTURE');
 }
});

test('unmarked virtual rail discovery retains only its pinned live identity witnesses and restores the rail',async()=>{
 for(const route of ['project','generic']){
  const f=setup(100,27);delete f.content.attrs['data-testid'];
  f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/'+
   (route==='project'?'item/project/assessment-under-test':'edit'));
  const original=f.sidebar.scrollTop,contentPosition=f.content.scrollTop;
  const certificate=route==='generic'?f.c.createAssessmentApiSessionCertificateV61525(f.envelope,f.fp,'Assessment_fixture_123',true,new Set()):null;
  const certifiedItem=route==='project'&&f.c.assessmentApiRouteEditorCertifiedV61526(f.envelope,f.fp,'Assessment_fixture_123',new Set());
  assert(Boolean(certificate||certifiedItem));
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,certifiedItem,sessionCertificate:certificate});
  assert.equal(result.captured,true);assert.equal(result.assessment.questionCount,100);assert.equal(f.calls.length,14);assert.equal(f.clicks(),0);
  assert(result.diagnostics.inventoryDiscovery.scrollSteps>0);assert.equal(result.diagnostics.inventoryDiscovery.restored,true);
  assert.equal(f.sidebar.scrollTop,original);assert.equal(f.content.scrollTop,contentPosition);
  if(certificate)assert.equal(f.c.assessmentApiSessionStillCurrentV61525(f.envelope,f.fp,'Assessment_fixture_123',certificate),true);
 }
});

test('pinned unmarked virtual discovery rejects unobserved parts, changed ordinals and replacement bodies before requests',async()=>{
 for(const defect of ['foreign-part','ordinal-change','replacement-body']){
  const f=setup(100,27);delete f.content.attrs['data-testid'];
  const scroll=f.sidebar.onScroll;let changed=false;
  f.sidebar.onScroll=y=>{scroll(y);if(y>0&&!changed){changed=true;
   if(defect==='foreign-part')f.content.querySelector('[data-testid^="assignment-part-"]').setAttribute('id','anotherAssignment~neverObserved');
   if(defect==='ordinal-change')f.content.querySelector('[data-testid^="assignment-part-"]').setAttribute('data-testid','assignment-part-500');
   if(defect==='replacement-body'){const replacement=f.content.cloneNode(true);f.content.remove();f.envelope.append(replacement);}
  }};
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
  assert.equal(result.captured,false);assert.equal(result.attempted,false);assert.equal(f.calls.length,0);assert.equal(f.clicks(),0);
  assert.equal(result.stopReason,'EDITOR_IDENTITY_CHANGED_DURING_API_DISCOVERY');assert.equal(f.sidebar.scrollTop,0);
 }
});

test('27 live rail anchors and 100 observed unmarked body parts establish complete IDs and order without scrolling',async()=>{
 for(const route of ['project','generic']){
  const f=setup(100,27);delete f.content.attrs['data-testid'];
  for(let n=2;n<=100;n++)f.content.append(new El('section',{id:'assessment~q'+n,'data-testid':'assignment-part-'+(n-1)},'Unhydrated content part'));
  f.c.location=new URL('https://www.coursera.org/teach/synthetic/Assessment_fixture_123/content/'+
   (route==='project'?'item/project/assessment-under-test':'edit'));
  let scrolls=0;const scroll=f.sidebar.onScroll;f.sidebar.onScroll=y=>{scrolls++;scroll(y);};
  const certificate=route==='generic'?f.c.createAssessmentApiSessionCertificateV61525(f.envelope,f.fp,'Assessment_fixture_123',true,new Set()):null;
  const certifiedItem=route==='project'&&f.c.assessmentApiRouteEditorCertifiedV61526(f.envelope,f.fp,'Assessment_fixture_123',new Set());
  assert(Boolean(certificate||certifiedItem));
  const inventory=f.c.assessmentApiBodyInventoryV61527(f.c.assessmentLayoutV61313(f.envelope));
  assert.equal(inventory.complete,true);assert.equal(inventory.candidates.length,100);
  assert.equal(inventory.candidates[99].label,'','An unhydrated body part cannot invent a question label');
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,certifiedItem,sessionCertificate:certificate});
  assert.equal(result.captured,true);assert.equal(result.assessment.questionCount,100);assert.equal(result.rawEvidence.questionDefinitions.length,100);
  assert.equal(result.diagnostics.inventoryDiscovery.method,'COMPLETE_OBSERVED_BODY_PART_INVENTORY');
  assert.equal(result.diagnostics.inventoryDiscovery.scrollSteps,0);assert.equal(scrolls,0);assert.equal(f.calls.length,14);assert.equal(f.clicks(),0);
 }
});

test('complete unmarked body inventory rejects duplicate IDs, ordinals, roots, omissions and mismatched rail links',()=>{
 for(const defect of ['duplicate-id','duplicate-ordinal','mixed-root','missing-part','foreign-anchor','conflicting-internal-marker']){
  const f=setup(100,27);delete f.content.attrs['data-testid'];
  for(let n=2;n<=100;n++)f.content.append(new El('section',{id:'assessment~q'+n,'data-testid':'assignment-part-'+(n-1)},'Unhydrated content part'));
  const last=f.content.querySelector('[data-testid="assignment-part-99"]');
  if(defect==='duplicate-id')last.setAttribute('id','assessment~q1');
  if(defect==='duplicate-ordinal')last.setAttribute('data-testid','assignment-part-0');
  if(defect==='mixed-root')last.setAttribute('id','anotherAssessment~q100');
  if(defect==='missing-part')last.remove();
  if(defect==='foreign-anchor')f.sidebar.querySelector('a[href^="#"]').setAttribute('href','#assessment~neverObserved');
  if(defect==='conflicting-internal-marker')f.envelope.append(new El('div',{'data-testid':'item-layout-content'},'Unrelated marked body'));
  const inventory=f.c.assessmentApiBodyInventoryV61527({root:f.envelope,sidebar:f.sidebar,content:f.content});
  if(defect!=='conflicting-internal-marker')assert.equal(inventory.complete,false,defect);
  assert.equal(f.c.assessmentApiRouteEditorCertifiedV61526(f.envelope,f.fp,'Assessment_fixture_123',new Set()),false,defect);
 }
});

test('609 and 2000 virtual rail identities fit observed-span bounds without question clicks',async()=>{
 for(const count of [609,2000]){
  const f=setup(count,27);f.sidebar.scrollTop=64;
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
  assert.equal(result.captured,true);assert.equal(result.assessment.questionCount,count);assert.equal(f.clicks(),0);
  assert.equal(result.diagnostics.inventoryDiscovery.observedParts,count);
  assert(result.diagnostics.inventoryDiscovery.scrollSteps>80);assert(result.diagnostics.inventoryDiscovery.scrollSteps<=420);
  assert.equal(result.diagnostics.inventoryDiscovery.restored,true);assert.equal(f.sidebar.scrollTop,64);
  assert.equal(result.rawEvidence.inventory.length,count);
  assert(result.rawEvidence.inventory.every((candidate,i)=>candidate.ordinal===i+1&&candidate.id==='assessment~q'+(i+1)));
  assert.equal(result.diagnostics.requests,2*Math.ceil(count/15));assert(result.diagnostics.maxConcurrentRequests<=2);
 }
});

test('failed discovery preserves counts, explicit limits and restoration diagnostics',async()=>{
 const f=setup(609,27);f.sidebar.scrollTop=64;f.sidebar.onScroll=null;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 assert.equal(result.attempted,false);assert.equal(result.captured,false);assert.equal(f.calls.length,0);
 assert.equal(result.diagnostics.inventoryDiscovery.declaredParts,609);
 assert.equal(result.diagnostics.inventoryDiscovery.observedParts,27);
 assert(result.diagnostics.inventoryDiscovery.stepLimit>=80);assert(result.diagnostics.inventoryDiscovery.stepLimit<=420);
 assert(result.diagnostics.inventoryDiscovery.timeLimitMs<=45000);assert.equal(result.diagnostics.inventoryDiscovery.restored,true);
 assert.equal(f.sidebar.scrollTop,64);assert.equal(result.diagnostics.inventoryDiscovery.stopReason,result.stopReason);
 const rejected=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,certifiedItem:false});
 assert.equal(rejected.diagnostics.inventoryDiscovery.method,'INVENTORY_PRECONDITION_DECLINED');
 assert.equal(rejected.diagnostics.inventoryDiscovery.stopReason,'EDITOR_NOT_CERTIFIED');
});

test('an exact current inventory rereads mutable groups and reuses only validated immutable definition bodies',async()=>{
 const f=setup(100),first=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 assert.equal(first.rawEvidence.cacheIntegrity.algorithm,'SHA-256');assert.equal(first.rawEvidence.cacheIntegrity.definitions.length,100);
 f.calls.length=0;
 const resumed=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,priorEvidence:clone(first.rawEvidence)});
 assert.equal(resumed.captured,true);assert.equal(resumed.diagnostics.reusedDefinitions,100);
 assert.equal(resumed.diagnostics.groupsRequests,7);assert.equal(resumed.diagnostics.definitionRequests,0);
 assert.equal(f.calls.length,7);assert(f.calls.every(call=>new URL(call.url).pathname.includes('QuestionGroups')));
 assert(resumed.diagnostics.cachedBytes>0);assert.equal(resumed.rawEvidence.questionDefinitions.length,100);assert.equal(f.clicks(),0);
 assert(!JSON.stringify(resumed.rawEvidence).includes('writeAccessToken'));
});

test('wrong prior identity, old receipts, reordered inventory and changed cached bodies never suppress required GETs',async()=>{
 const f=setup(20),first=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 for(const defect of ['course','item','assignment','inventory','receipts','duplicate-definition','tampered-definition','invalid-key','changed-group-version','oversized-prior-group']){
  const prior=clone(first.rawEvidence);f.calls.length=0;
  if(defect==='course')prior.courseId='another-course';
  if(defect==='item')prior.itemId='another-item';
  if(defect==='assignment')prior.assignmentId='another-assignment';
  if(defect==='inventory')prior.inventory.reverse();
  if(defect==='receipts')delete prior.cacheIntegrity;
  if(defect==='duplicate-definition')prior.questionDefinitions.push(clone(prior.questionDefinitions[0]));
  if(defect==='tampered-definition')prior.questionDefinitions.find(d=>d.id==='assessment~definition1@1').definition.definition.correctOption='other-1';
  if(defect==='invalid-key')prior.questionDefinitions.find(d=>d.id==='assessment~definition1@1').definition.definition.correctOption='missing-id';
  if(defect==='changed-group-version')prior.groups.find(g=>g.id==='assessment~q1').questions=['assessment~definition1@2'];
  if(defect==='oversized-prior-group')prior.groups.find(g=>g.id==='assessment~q1').oversizedUnknownField='x'.repeat(2600000);
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,priorEvidence:prior});
  assert.equal(result.captured,true,defect);assert(result.diagnostics.definitionRequests>0,defect);
  const requested=f.calls.filter(call=>new URL(call.url).pathname.includes('MachineEvaluable')).flatMap(call=>{
   const url=new URL(call.url);return url.searchParams.has('ids')?url.searchParams.get('ids').split(','):[decodeURIComponent(url.pathname.split('/').pop())];
  });
  assert(requested.includes('assessment~definition1@1'),defect);
  assert.equal(result.assessment.questions[0].correctAnswers[0],'Correct choice 1',defect);
 }
});

test('partial definition acquisition survives its deadline and resumes fulfilled exact versions',async()=>{
 const f=setup(20);let now=Date.now(),expired=false,saved=null;
 f.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const fetch=f.fetchImpl,first=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,deadline:now+1000,
  fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(!expired&&url.includes('MachineEvaluable')){expired=true;now+=2000;}return response;},
  onCheckpoint:async(model,observation)=>{saved={model,observation};}});
 assert.equal(first.captured,false);assert.equal(first.stopReason,'ITEM_API_DEADLINE');
 assert.equal(first.rawEvidence.questionDefinitions.length,15);assert.equal(saved.observation.rawEvidence.questionDefinitions.length,15);
 assert.equal(first.rawEvidence.cacheIntegrity.definitions.length,15);f.calls.length=0;
 const resumed=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,deadline:now+30000,priorEvidence:clone(first.rawEvidence)});
 assert.equal(resumed.captured,true);assert.equal(resumed.diagnostics.reusedDefinitions,15);
 assert.equal(resumed.diagnostics.groupsRequests,2);assert.equal(resumed.diagnostics.definitionRequests,1);assert.equal(f.calls.length,3);
 assert.equal(resumed.assessment.questionCount,20);assert.equal(f.clicks(),0);
});

test('raw unsupported definitions checkpoint even when no supported question model exists',async()=>{
 const f=setup(10),fetch=f.fetchImpl;let saved=0;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:async(url,options)=>{
  const response=await fetch(url,options),body=await response.json();
  if(url.includes('MachineEvaluable'))for(const element of body.elements)element.definition.typeName='unknown-text-entry-fixture';
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 },onCheckpoint:async(model,observation)=>{saved++;assert.equal(model,null);assert.equal(observation.rawEvidence.questionDefinitions.length,10);}});
 assert.equal(result.captured,false);assert.equal(result.assessment,null);assert.equal(saved,1);
 assert.equal(result.rawEvidence.questionDefinitions.length,10);assert.equal(result.diagnostics.missingDefinitions.length,10);
 assert(!JSON.stringify(result.rawEvidence).includes('writeAccessToken'));assert.equal(f.clicks(),0);
});

test('slow single-GET attempts obtain useful definitions and carry fulfilled bodies across bounded resumes',async()=>{
 const f=setup(100),fetch=f.fetchImpl;let now=Date.now();
 f.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const slowSingles=async(url,options)=>{
  if(new URL(url).searchParams.has('ids'))return new Response(null,{status:405});
  const response=await fetch(url,options);now+=5000;return response;
 };
 const first=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,deadline:now+120000,fetchImpl:slowSingles});
 assert.equal(first.captured,false);assert.equal(first.stopReason,'ITEM_API_DEADLINE');
 assert(first.rawEvidence.questionDefinitions.length>0,'Definitions must be acquired before all100group reads');
 assert(first.rawEvidence.questionDefinitions.length<100);assert.equal(first.diagnostics.multiGetUnsupported.length,2);
 const initialIds=new Set(first.rawEvidence.questionDefinitions.map(def=>def.id));f.calls.length=0;
 const second=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,deadline:now+120000,fetchImpl:slowSingles,priorEvidence:clone(first.rawEvidence)});
 assert.equal(second.captured,false);assert.equal(second.stopReason,'ITEM_API_DEADLINE');
 assert(second.rawEvidence.questionDefinitions.length>initialIds.size,'Each resume adds fulfilled definitions instead of replacing the earlier partial cache');
 assert([...initialIds].every(id=>second.rawEvidence.questionDefinitions.some(def=>def.id===id)));
 assert(second.rawEvidence.carriedDefinitionIds.length>0);assert(second.rawEvidence.carriedGroupIds.length>0);
 assert(second.diagnostics.definitionRequests>0);assert(second.diagnostics.maxConcurrentRequests<=2);
 assert(second.assessment.questionCount<100,'Carried definitions alone cannot certify current fresh-group coverage');
 const requestedDefinitions=f.calls.filter(call=>call.url.includes('MachineEvaluable')).map(call=>decodeURIComponent(new URL(call.url).pathname.split('/').pop()));
 assert(requestedDefinitions.every(id=>!initialIds.has(id)),'Resume prioritizes exact definitions not already fulfilled');
 assert.equal(f.clicks(),0);assert(!JSON.stringify(second.rawEvidence).includes('writeAccessToken'));
});

test('a freshly returned version change fetches that exact new definition and cannot reuse the old key',async()=>{
 const f=setup(20),fetch=f.fetchImpl,first=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);f.calls.length=0;let versionRead=false;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,priorEvidence:clone(first.rawEvidence),fetchImpl:async(url,options)=>{
  const parsed=new URL(url),ids=parsed.searchParams.has('ids')?parsed.searchParams.get('ids').split(','):[decodeURIComponent(parsed.pathname.split('/').pop())];
  if(url.includes('MachineEvaluable')&&ids.includes('assessment~definition1@2')){
   versionRead=true;assert.equal(options.method,'GET');assert(parsed.searchParams.get('fields').includes('validation,-writeAccessToken'));
   const element=definition(1);element.id='assessment~definition1@2';element.definition.definition.correctOption='other-1';
   return new Response(JSON.stringify({elements:[element]}),{headers:{'content-type':'application/json'}});
  }
  const response=await fetch(url,options),body=await response.json();
  if(url.includes('QuestionGroups'))for(const group of body.elements)if(group.id==='assessment~q1')group.questions=['assessment~definition1@2'];
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 }});
 assert.equal(result.captured,true);assert.equal(result.diagnostics.reusedDefinitions,19);assert.equal(result.diagnostics.definitionRequests,1);
 assert.equal(result.assessment.questions[0].sourceDefinitionId,'assessment~definition1@2');
 assert.equal(result.assessment.questions[0].correctAnswers[0],'Wrong choice 1');
 assert.equal(versionRead,true);
 assert.equal(f.clicks(),0);assert(!JSON.stringify(result.rawEvidence).includes('writeAccessToken'));
});

test('a609-part mixed bank preserves all original unsupported definitions and resumes only supported exact keys',async()=>{
 const f=setup(609,27),fetch=f.fetchImpl,unsupported=new Set([136,143,149,154,164,166,169,172,178,181,187,190,197]);
 const mixed=async(url,options)=>{
  const response=await fetch(url,options),body=await response.json();
  if(url.includes('MachineEvaluable'))for(const element of body.elements){
   const n=Number(element.id.match(/~definition(\d+)@1$/)?.[1]);
   if(unsupported.has(n))element.definition.typeName='unknown-bank-part-fixture';
  }
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 };
 const first=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:mixed});
 assert.equal(first.captured,false);assert.equal(first.assessment.questionCount,596);assert.equal(first.rawEvidence.questionDefinitions.length,609);
 assert.equal(first.rawEvidence.groups.length,609);assert.equal(first.diagnostics.missingDefinitions.length,13);
 assert.equal(first.assessment.captureCompleteness.requiredAnswerCoverageComplete,false);f.calls.length=0;
 const resumed=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,fetchImpl:mixed,priorEvidence:clone(first.rawEvidence)});
 assert.equal(resumed.captured,false);assert.equal(resumed.diagnostics.reusedDefinitions,596);assert.equal(resumed.diagnostics.definitionRequests,1);
 assert.equal(resumed.rawEvidence.questionDefinitions.length,609);assert.equal(resumed.assessment.questionCount,596);
 const ids=f.calls.filter(call=>call.url.includes('MachineEvaluable')).flatMap(call=>new URL(call.url).searchParams.get('ids').split(','));
 assert.equal(ids.length,13);assert(ids.every(id=>unsupported.has(Number(id.match(/~definition(\d+)@1$/)?.[1]))));
 assert.equal(f.clicks(),0);assert(!JSON.stringify(resumed.rawEvidence).includes('writeAccessToken'));
});

test('renderer pressure checkpoints a useful exact-definition chunk and resumes only after fresh group bindings',async()=>{
 const f=setup(30),fetch=f.fetchImpl;let definitionsRead=false,writes=0,saved=null;
 const partial=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,
  pressureYieldReason:()=>definitionsRead?'LOCAL_RENDERER_HEAP_GROWTH_LIMIT':'',
  fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(url.includes('MachineEvaluable'))definitionsRead=true;return response;},
  onCheckpoint:async(model,observation)=>{writes++;saved={model,observation};}});
 assert.equal(partial.pressureYieldReason,'LOCAL_RENDERER_HEAP_GROWTH_LIMIT');
 assert.equal(partial.stopReason,'LOCAL_RENDERER_HEAP_GROWTH_LIMIT');assert.equal(partial.captured,false);
 assert.equal(partial.assessment.questionCount,15);assert.equal(partial.assessment.captureCompleteness.requiredAnswerCoverageComplete,false);
 assert.equal(f.calls.length,2,'No new group/definition reads follow the pressure transition');
 assert.equal(partial.rawEvidence.groups.length,15);assert.equal(partial.rawEvidence.questionDefinitions.length,15);
 assert.equal(partial.rawEvidence.cacheIntegrity.definitions.length,15);assert.equal(writes,1);
 assert.equal(saved.observation.pressureYieldReason,partial.pressureYieldReason);
 assert.equal(saved.model.questionCount,15);assert.equal(f.clicks(),0);
 assert(partial.assessment.questions.every((q,i)=>q.courseraQuestionId==='assessment~q'+(i+1) &&
  q.sourceDefinitionId==='assessment~definition'+(i+1)+'@1' && q.correctAnswers[0]==='Correct choice '+(i+1)));
 f.calls.length=0;
 const complete=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,priorEvidence:clone(partial.rawEvidence)});
 assert.equal(complete.pressureYieldReason,'');assert.equal(complete.captured,true);
 assert.equal(complete.assessment.questionCount,30);assert.equal(complete.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.equal(complete.rawEvidence.freshGroupIds.length,30,'Every current group is freshly read before completeness');
 assert.equal(complete.diagnostics.reusedDefinitions,15);assert.equal(complete.diagnostics.definitionRequests,1);
 const requestedDefinitions=f.calls.filter(call=>call.url.includes('MachineEvaluable')).flatMap(call=>new URL(call.url).searchParams.get('ids').split(','));
 assert.equal(requestedDefinitions.length,15);assert(requestedDefinitions.every(id=>Number(id.match(/~definition(\d+)@1$/)[1])>15));
 assert(complete.diagnostics.maxConcurrentRequests<=2);assert.equal(f.clicks(),0);
});

test('pressure between mutable groups and definitions saves raw groups without inventing a question model',async()=>{
 const f=setup(30),fetch=f.fetchImpl;let groupsRead=false,writes=0;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,
  pressureYieldReason:()=>groupsRead?'LOCAL_RENDERER_TIME_LIMIT':'',
  fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(url.includes('QuestionGroups'))groupsRead=true;return response;},
  onCheckpoint:async(model,observation)=>{writes++;assert.equal(model,null);assert.equal(observation.rawEvidence.groups.length,15);
   assert.equal(observation.rawEvidence.questionDefinitions.length,0);assert.equal(observation.pressureYieldReason,'LOCAL_RENDERER_TIME_LIMIT');}});
 assert.equal(result.captured,false);assert.equal(result.assessment,null);assert.equal(result.pressureYieldReason,'LOCAL_RENDERER_TIME_LIMIT');
 assert.equal(result.stopReason,'LOCAL_RENDERER_TIME_LIMIT');assert.equal(f.calls.length,1);assert.equal(writes,1);
 assert.equal(result.rawEvidence.groups.length,15);assert.equal(result.rawEvidence.questionDefinitions.length,0);
 assert.equal(result.diagnostics.missingGroups.length,15);assert.equal(result.diagnostics.missingDefinitions.length,15);
 assert.equal(f.clicks(),0);
});

test('single-GET pressure lets bounded in-flight reads settle but starts no later read',async()=>{
 const f=setup(30),fetch=f.fetchImpl;let definitionsRead=0,pressureObserved=false,readsAfterPressure=0;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,
  pressureYieldReason:()=>{if(definitionsRead<3)return '';pressureObserved=true;return 'LOCAL_RENDERER_HEAP_LIMIT';},
  fetchImpl:async(url,options)=>{
   if(pressureObserved)readsAfterPressure++;
   if(new URL(url).searchParams.has('ids'))return new Response(null,{status:405});
   const response=await fetch(url,options);if(url.includes('MachineEvaluable'))definitionsRead++;return response;
  }});
 assert.equal(result.captured,false);assert.equal(result.pressureYieldReason,'LOCAL_RENDERER_HEAP_LIMIT');
 assert.equal(readsAfterPressure,0);assert.equal(result.rawEvidence.groups.length,15);
 assert(result.rawEvidence.questionDefinitions.length>=3 && result.rawEvidence.questionDefinitions.length<=4,
  'At most the second already-started definition read may settle after pressure');
 assert.equal(result.assessment.questionCount,result.rawEvidence.questionDefinitions.length);
 assert(result.diagnostics.maxConcurrentRequests<=2);assert.equal(f.clicks(),0);
});

test('unknown and throwing pressure hooks do not silently halt or certify an incomplete assessment',async()=>{
 for(const value of ['LOCAL_RENDERER_UNKNOWN_LIMIT',{reason:'LOCAL_RENDERER_HEAP_LIMIT'},'throws']){
  const f=setup(20);
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,
   pressureYieldReason:()=>{if(value==='throws')throw new Error('private synthetic hook context');return value;}});
  assert.equal(result.pressureYieldReason,'');assert.equal(result.captured,true);assert.equal(result.assessment.questionCount,20);
  assert.equal(result.stopReason,'COMPLETE_ITEM_BOUND_AUTHORING_API');assert.equal(f.calls.length,4);
  assert.equal(result.diagnostics.pressureHookFailures>0,value==='throws');
  assert(!JSON.stringify(result).includes('private synthetic hook context'));assert.equal(f.clicks(),0);
 }
});

test('pressure after the final definition chunk keeps independently complete evidence complete',async()=>{
 const f=setup(10),fetch=f.fetchImpl;let definitionsRead=false,writes=0;
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,
  pressureYieldReason:()=>definitionsRead?'LOCAL_RENDERER_HEAP_LIMIT':'',
  fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(url.includes('MachineEvaluable'))definitionsRead=true;return response;},
  onCheckpoint:async(model,observation)=>{writes++;assert.equal(model.captureCompleteness.requiredAnswerCoverageComplete,true);
   assert.equal(observation.pressureYieldReason,'LOCAL_RENDERER_HEAP_LIMIT');}});
 assert.equal(result.captured,true);assert.equal(result.stopReason,'COMPLETE_ITEM_BOUND_AUTHORING_API');
 assert.equal(result.pressureYieldReason,'LOCAL_RENDERER_HEAP_LIMIT');assert.equal(result.assessment.questionCount,10);
 assert.equal(result.rawEvidence.freshGroupIds.length,10);assert.equal(f.calls.length,2);assert.equal(writes,1);
});

test('an empty pressure receipt cannot replace historical raw definitions rejected for cache reuse',async()=>{
 const f=setup(20),original=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 const prior=clone(original.rawEvidence);delete prior.cacheIntegrity;f.fp.payload={assessmentApiEvidence:prior};f.calls.length=0;
 const empty=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,priorEvidence:prior,
  pressureYieldReason:()=> 'LOCAL_RENDERER_HEAP_LIMIT'});
 assert.equal(f.calls.length,0);assert.equal(empty.rawEvidence.groups.length,0);assert.equal(empty.rawEvidence.questionDefinitions.length,0);
 assert.equal(f.c.retainAssessmentApiRawEvidenceV61532(f.fp,empty),false);
 assert.equal(f.fp.payload.assessmentApiEvidence,prior);assert.equal(f.fp.payload.assessmentApiHistoricalEvidence,undefined);
 assert.equal(empty.retentionBlocked,undefined);assert.equal(empty.captured,false);
});

test('group-only pressure preserves rejected legacy raw separately and never promotes its bodies into cache or completeness',async()=>{
 const f=setup(20),fetch=f.fetchImpl,original=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 const prior=clone(original.rawEvidence);delete prior.cacheIntegrity;
 prior.questionDefinitions[0].definition.definition.correctOption='other-1';
 const originalText=JSON.stringify(prior);f.fp.payload={assessmentApiEvidence:prior};f.calls.length=0;let groupsRead=false;
 const partial=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,priorEvidence:prior,
  pressureYieldReason:()=>groupsRead?'LOCAL_RENDERER_HEAP_LIMIT':'',
  fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(url.includes('QuestionGroups'))groupsRead=true;return response;}});
 assert.equal(partial.assessment,null);assert.equal(partial.rawEvidence.groups.length,15);assert.equal(partial.rawEvidence.questionDefinitions.length,0);
 assert.equal(f.c.retainAssessmentApiRawEvidenceV61532(f.fp,partial),true);assert.equal(f.fp.payload.assessmentApiEvidence,partial.rawEvidence);
 const historical=f.fp.payload.assessmentApiHistoricalEvidence;
 assert.equal(historical.length,1);assert.equal(historical[0].notForCacheOrCompleteness,true);
 assert.equal(JSON.stringify(historical[0].rawEvidence),originalText,'Historical unknown fields and original receipt remain exact');
 assert.equal(historical[0].rawEvidence.cacheIntegrity,undefined,'A rejected body is not given a new cache receipt');
 f.calls.length=0;
 const complete=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,priorEvidence:f.fp.payload.assessmentApiEvidence});
 assert.equal(complete.captured,true);assert.equal(complete.diagnostics.reusedDefinitions,0);
 const definitionIds=f.calls.filter(call=>call.url.includes('MachineEvaluable')).flatMap(call=>new URL(call.url).searchParams.get('ids').split(','));
 assert.equal(definitionIds.length,20,'Every definition comes from a current GET, even with 20 historical bodies retained');
 assert.equal(complete.rawEvidence.freshGroupIds.length,20);assert.equal(complete.assessment.questions[0].correctAnswers[0],'Correct choice 1');
 assert.equal(f.c.retainAssessmentApiRawEvidenceV61532(f.fp,complete),true);assert.equal(f.fp.payload.assessmentApiHistoricalEvidence,historical);
 assert.equal(JSON.stringify(historical[0].rawEvidence),originalText);assert.equal(f.clicks(),0);
});

test('exact carried records do not create redundant history while changed same-ID raw and duplicate receipts remain preserved',async()=>{
 const f=setup(20),complete=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 const full=clone(complete.rawEvidence),partial=clone(full);
 partial.groups=partial.groups.slice(0,15);partial.questionDefinitions=partial.questionDefinitions.slice(0,15);
 f.fp.payload={assessmentApiEvidence:partial};
 assert.equal(f.c.retainAssessmentApiRawEvidenceV61532(f.fp,{rawEvidence:full}),true);
 assert.equal(f.fp.payload.assessmentApiHistoricalEvidence,undefined,'All exact partial records are already carried in the current raw');
 const changed=clone(full);changed.questionDefinitions[0].definition.definition.unknownOriginalField.unicode='changed original body';
 assert.equal(f.c.retainAssessmentApiRawEvidenceV61532(f.fp,{rawEvidence:changed}),true);
 assert.equal(f.fp.payload.assessmentApiHistoricalEvidence.length,1);
 assert.equal(f.fp.payload.assessmentApiHistoricalEvidence[0].rawEvidence,full);
 const history=f.fp.payload.assessmentApiHistoricalEvidence;f.fp.payload.assessmentApiEvidence=clone(full);
 assert.equal(f.c.retainAssessmentApiRawEvidenceV61532(f.fp,{rawEvidence:changed}),true);
 assert.equal(f.fp.payload.assessmentApiHistoricalEvidence,history,'The identical original receipt is not archived twice');
 assert.equal(history.length,1);assert.equal(history[0].rawEvidence.questionDefinitions[0].definition.definition.unknownOriginalField.unicode,'café 日本語');
});

test('historical raw beyond 32 MiB blocks destructive replacement with an explicit retention reason',()=>{
 const f=setup(1),prior={method:'OBSERVED_ITEM_BOUND_AUTHORING_GETS',courseId:'Assessment_fixture_123',itemId:f.fp.id,
  assignmentId:'assessment',inventory:[{id:'assessment~q1',ordinal:1}],groups:[{id:'assessment~q1',rawOriginal:'x'.repeat(32*1024*1024)}],questionDefinitions:[]};
 f.fp.payload={assessmentApiEvidence:prior};
 const observation={rawEvidence:{...prior,groups:[{id:'assessment~q1',questions:['assessment~definition1@1']}],questionDefinitions:[definition(1)]}};
 assert.equal(f.c.retainAssessmentApiRawEvidenceV61532(f.fp,observation),false);
 assert.equal(observation.retentionBlocked,'ASSESSMENT_API_HISTORY_LIMIT');assert.equal(f.fp.payload.assessmentApiEvidence,prior);
 assert.equal(f.fp.payload.assessmentApiHistoricalEvidence,undefined,'Capacity failure does not mutate the previous raw or history');
});

test('unrepresentable historical raw fails closed without replacing the original receipt',()=>{
 const f=setup(1),prior={method:'OBSERVED_ITEM_BOUND_AUTHORING_GETS',courseId:'Assessment_fixture_123',itemId:f.fp.id,
  assignmentId:'assessment',inventory:[],groups:[{id:'assessment~q1'}],questionDefinitions:[]};
 prior.groups[0].unrepresentableOriginal=prior;f.fp.payload={assessmentApiEvidence:prior};
 const observation={rawEvidence:{...prior,groups:[{id:'assessment~q2'}]}};
 assert.equal(f.c.retainAssessmentApiRawEvidenceV61532(f.fp,observation),false);
 assert.equal(observation.retentionBlocked,'ASSESSMENT_API_HISTORY_SERIALIZATION_FAILED');assert.equal(f.fp.payload.assessmentApiEvidence,prior);
 assert.equal(f.fp.payload.assessmentApiHistoricalEvidence,undefined);
});
