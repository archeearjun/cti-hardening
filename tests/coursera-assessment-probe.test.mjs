import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bundleConsole} from '../tools/console-bundle.mjs';
import {createCourseraAssessmentProbeScript} from '../src/domain/coursera-assessment-probe.ts';
import {CTI_RELEASE_REGISTRY_} from '../src/engine/release.js';

const {fixture,El}=createRequire(import.meta.url)('../tools/assessment-fixture.cjs');
const shell='https://www.coursera.org/teach/synthetic/Probe_fixture_123/content/edit';
const editor='https://www.coursera.org/teach/synthetic/Probe_fixture_123/content/item/project/assessment-under-test';
const source=()=>bundleConsole(path.resolve('src/extractors/coursera/entry.js'));
const program=()=>createCourseraAssessmentProbeScript(shell,source());
const cml=text=>({typeName:'cml',definition:{dtdId:'synthetic',value:'<co-content><p>'+text+'</p></co-content>'}});
function definition(n){return {id:'assessment~definition'+n+'@1',writeAccessToken:'SYNTHETIC_SECRET',definition:{typeName:'mcq',definition:{
  prompt:cml(`Which result is correct for scenario ${n} in this assessment?`),correctOption:'exact-key-'+n,
  options:[{id:'exact-key-'+n,display:cml('Correct choice '+n),feedback:cml('Private feedback '+n)},
    {id:'other-'+n,display:cml('Wrong choice '+n),feedback:cml('Private feedback other '+n)}]}}};}

function setup(count=100,windowSize=count){
  const f=fixture({count,windowSize,mode:'virtual'}),calls=[],ui=[];
  f.c.Date=Date;f.c.location=new URL(editor);f.c.performance={getEntriesByType:()=>[]};
  f.c.Response=Response;f.c.Promise=Promise;f.c.TextEncoder=TextEncoder;f.c.TextDecoder=TextDecoder;
  f.c.window.top=f.c.window;
  f.c.document.createElement=tag=>{
    const node=new El(tag);ui.push(node);node.style={};
    node.attachShadow=()=>{const shadow=new El('div');node.append(shadow);return shadow;};
    node.focus=()=>{};node.select=()=>{};return node;
  };
  f.c.navigator={clipboard:{writeText:async text=>{f.c.copied=text;}}};
  f.c.window.fetch=async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');
    assert.equal(options.redirect,'error');
    const parsed=new URL(url),group=parsed.pathname.includes('QuestionGroups');
    const ids=parsed.searchParams.get('ids')?.split(',') || [decodeURIComponent(parsed.pathname.split('/').pop())];
    const elements=ids.map(id=>{
      const n=Number(id.match(group?/~q(\d+)$/:/~definition(\d+)@1$/)[1]);
      return group?{id,questions:['assessment~definition'+n+'@1'],writeAccessToken:'SYNTHETIC_SECRET'}:definition(n);
    }).reverse();
    return new Response(JSON.stringify({elements,paging:{},linked:{}}),{headers:{'content-type':'application/json'}});
  };
  return {...f,calls,ui};
}
async function run(f,script=program()){
  vm.runInContext(script,f.c);
  const deadline=Date.now()+15000;
  while(f.c.window.__CTI_COURSERA_ASSESSMENT_PROBE?.running && Date.now()<deadline)
    await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.c.window.__CTI_COURSERA_ASSESSMENT_PROBE?.running,false);
  return JSON.parse(JSON.stringify(f.c.window.__CTI_COURSERA_ASSESSMENT_PROBE.result));
}

test('quiz probe copies only canonical helper declarations before any run orchestration',()=>{
  const script=program();
  assert(script.startsWith('void (async function'));assert.doesNotThrow(()=>new vm.Script(script));
  assert(!script.includes('const existingRunLock ='));
  assert(!script.includes('automaticLocalPlan=automaticLocalPlan ||'));
  assert(!script.includes('Page.addScriptToEvaluateOnNewDocument'));
  assert(script.includes('function collectCourseraAssessmentApiV61524('));
  assert(!script.includes('returnToOutlineV6142(startUrl);'));
  const invalid=source().replace('  const CTI_RUN_LOCK_KEY =','  const DIFFERENT_RUN_LOCK_KEY =');
  assert.throws(()=>createCourseraAssessmentProbeScript(shell,invalid),/current extractor/);
  assert.throws(()=>createCourseraAssessmentProbeScript(shell,source().replaceAll(CTI_RELEASE_REGISTRY_.courseraExtractor.build,'incompatible-build')),/current extractor/);
  assert.throws(()=>createCourseraAssessmentProbeScript(shell,source()+'\n  const CTI_RUN_LOCK_KEY ='),/current extractor/);
  for(const url of ['http://www.coursera.org/teach/synthetic/Probe_fixture_123/content/edit',
    'https://coursera.org/teach/synthetic/Probe_fixture_123/content/edit','https://www.coursera.org/learn/synthetic'])
    assert.throws(()=>createCourseraAssessmentProbeScript(url,source()));
});

test('current-quiz check verifies 100 original MCQ definitions and exact keys using fourteen GETs',async()=>{
  const f=setup(),result=await run(f);
  assert.equal(result.status,'VERIFIED_CURRENT_QUIZ');
  assert.equal(result.expectedCount,100);assert.equal(result.capturedCount,100);assert.equal(result.keyCount,100);
  assert.equal(result.requests,14);assert(result.bytes>0);assert.equal(f.calls.length,14);
  assert.equal(result.stopReason,'COMPLETE_ITEM_BOUND_AUTHORING_API');
  assert.equal(result.wholeCourseVerified,false);assert.equal(result.notForCourseAudit,true);
  assert.equal(result.scope,'CURRENT_QUIZ_ONLY');assert.equal(f.clicks(),0);assert.equal(f.mutations(),0);
  assert(f.calls.every(call=>call.options.signal instanceof AbortSignal && new URL(call.url).searchParams.get('fields').includes('-writeAccessToken')));
  const serialized=JSON.stringify(result);
  for(const privateValue of ['assessment~','Correct choice','Private feedback','writeAccessToken','SYNTHETIC_SECRET','coursera.org'])
    assert(!serialized.includes(privateValue),'Diagnostic leaked '+privateValue);
  const button=f.ui.find(node=>node.textContent==='Copy diagnostic result');
  await button.onclick();assert.deepEqual(JSON.parse(f.c.copied),result);
  assert.equal(f.c.window.__CTI_ITEM_FIDELITY_RUN_LOCK,undefined);
  assert.equal(f.c.window.__CTI_AUTOMATIC_LOCAL_CONFIG__,undefined);
});

test('generic outline, wrong course, subframe and active extractor fail closed without requests',async()=>{
  for(const mode of ['outline','otherCourse','subframe','active']){
    const f=setup();
    if(mode==='outline')f.c.location=new URL(shell);
    if(mode==='otherCourse')f.c.location=new URL(editor.replace('Probe_fixture_123','Other_course_123'));
    if(mode==='subframe')f.c.window.top={};
    if(mode==='active')f.c.window.__CTI_ITEM_FIDELITY_RUN_LOCK={running:true,lastHeartbeatAt:Date.now()};
    const result=await run(f);assert.equal(result.status,'NOT_VERIFIED');assert.equal(f.calls.length,0);
    assert.equal(result.stopReason,mode==='active'?'STOP_ACTIVE_EXTRACTOR_BEFORE_CHECK':'OPEN_EXACT_QUIZ_IN_EXPECTED_COURSE');
  }
});

test('an unmarked body with all observed part IDs and a 27-link virtual rail uses the same API check',async()=>{
  const f=setup(100,27);
  delete f.content.attrs['data-testid'];
  for(let n=2;n<=100;n++)f.content.append(new El('section',{id:'assessment~q'+n,'data-testid':'assignment-part-'+(n-1)}));
  const result=await run(f);
  assert.equal(result.status,'VERIFIED_CURRENT_QUIZ');assert.equal(result.capturedCount,100);
  assert.equal(result.keyCount,100);assert.equal(result.requests,14);assert.equal(f.clicks(),0);
  assert.equal(result.inventoryMethod,'COMPLETE_OBSERVED_BODY_PART_INVENTORY');
});

test('API denial and missing exact keys remain bounded diagnostics and never invoke DOM fallback',async()=>{
  for(const mode of ['denied','missingKey']){
    const f=setup(20),fetch=f.c.window.fetch;
    f.c.window.fetch=async(url,options)=>{
      if(mode==='denied'){f.calls.push({url,options});return new Response('{}',{status:403,headers:{'content-type':'application/json'}});}
      const response=await fetch(url,options),body=await response.json();
      if(url.includes('MachineEvaluable'))for(const value of body.elements)
        if(value.id==='assessment~definition20@1')value.definition.definition.correctOption='not-observed';
      return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
    };
    const result=await run(f);
    assert.equal(result.status,'INCOMPLETE_CURRENT_QUIZ');assert.equal(f.clicks(),0);assert.equal(f.mutations(),0);
    assert.equal(result.wholeCourseVerified,false);
    if(mode==='denied'){
      assert.equal(result.stopReason,'AUTHORING_API_AUTHENTICATION_FAILED');assert.equal(f.calls.length,1);
      assert(result.failures.some(failure=>failure.resource==='authoringAssignmentQuestionGroups.v1' && failure.status===403 && failure.code==='AUTHORING_API_AUTHENTICATION_FAILED'));
      assert(result.failures.length<=40);
    }else{assert.equal(result.keyCount,19);assert.equal(result.capturedCount,19);assert.equal(result.missingDefinitionCount,1);}
  }
});

test('the two-minute watchdog aborts an outstanding GET and exposes only a safe deadline code',async()=>{
  const f=setup();let watchdog,aborted=false;
  f.c.setTimeout=(callback,ms)=>{
    if(ms>110000){watchdog=callback;return 1;}
    return setTimeout(callback,ms);
  };
  f.c.clearTimeout=id=>{if(id!==1)clearTimeout(id);};
  f.c.window.fetch=async(url,options)=>{
    f.calls.push({url,options});
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{
      aborted=true;reject(new Error('PRIVATE_QUESTION_AND_TOKEN_NOT_EXPORTED'));
    },{once:true}));
  };
  vm.runInContext(program(),f.c);
  while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));
  watchdog();
  await new Promise(resolve=>setImmediate(resolve));
  const result=JSON.parse(JSON.stringify(f.c.window.__CTI_COURSERA_ASSESSMENT_PROBE.result));
  assert(aborted);assert.equal(result.stopReason,'API_CHECK_DEADLINE');assert.equal(result.requests,1);
  assert.equal(result.wholeCourseVerified,false);assert(!JSON.stringify(result).includes('PRIVATE_QUESTION'));
  assert.equal(f.clicks(),0);
});
