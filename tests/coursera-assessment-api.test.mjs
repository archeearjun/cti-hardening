import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as config from '../src/extractors/coursera/config.js';

const {fixture}=createRequire(import.meta.url)('../tools/assessment-fixture.cjs');
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
  onProgress:(count,total)=>{lastProgress=count;assert.equal(total,100);},onCheckpoint:async model=>{writes++;assert.equal(model.questionCount,100);}});
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
  const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,{...f.options,deadline:Date.now()+(failure==='timeout'?20:10000),fetchImpl:async()=>{
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

test('an unsupported resource family avoids a repeated virtual-rail scan before DOM fallback',async()=>{
 const f=setup(100,27);f.sidebar.scrollTop=64;let scrolls=0;
 const scroll=f.sidebar.onScroll;f.sidebar.onScroll=y=>{scrolls++;scroll(y);};
 f.c.performance={getEntriesByType:()=>[{initiatorType:'fetch',name:'https://www.coursera.org/api/authoringAssignmentQuestionGroups.v1/assessment~q1'}]};
 const result=await f.c.collectCourseraAssessmentApiV61524(f.envelope,f.fp,f.options);
 assert.equal(result.attempted,false);assert.equal(result.stopReason,'SAME_ASSIGNMENT_READ_ENDPOINTS_NOT_OBSERVED');
 assert.equal(scrolls,0);assert.equal(f.sidebar.scrollTop,64);assert.equal(f.calls.length,0);
});
