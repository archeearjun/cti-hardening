import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {buildOwnerContext,resolveSourceTopic,buildOwnerTasks} from '../src/domain/owner-actions.ts';
import {buildPluginCheckScript,capturePluginPage,validatePluginCheck} from '../src/domain/plugin-check.ts';
const qa=createRequire(import.meta.url)('../tools/check.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const enc=x=>new TextEncoder().encode(JSON.stringify(x));
const source={idref:'q1',title:'Weekly Assessment',path:'Module 1'};
const topic=(id,name,path)=>({id,name,path,url:`https://lms.example.test/d2l/le/content/123/viewContent/${id}/View`});
const context={sourceTopics:[topic('10',source.title,'Module 1 > Assess'),topic('11',source.title,'Archive > Module 1')]};
test('old reports resolve the extra Assess folder without selecting the archive copy',()=>{
  assert.equal(resolveSourceTopic(source,context).id,'10');
  assert.equal(resolveSourceTopic(source,{sourceTopics:[...context.sourceTopics,topic('12',source.title,'Module 1 > Review')]}),null);
  assert.equal(resolveSourceTopic(source,{sourceTopics:[topic('11',source.title,'Archive > Module 1'),topic('12',source.title,'Archive > Module 2')]}),null);
  assert.equal(resolveSourceTopic(source,{sourceTopics:[topic('11',source.title,'Archive > Module 1')]}),null);
});
test('persisted unique topic mapping survives moved/renamed live topics; conflicting IDs remain unresolved',()=>{
  const mapped={...context,sourceTopicMappings:[{sourceId:'q1',sourceName:source.title,sourcePath:source.path,topicId:'10',navigationEligible:true}]};
  mapped.sourceTopics=[topic('10','Renamed','Updated Module'),topic('11',source.title,'Archive')];
  assert.equal(resolveSourceTopic(source,mapped).id,'10');
  mapped.sourceTopicMappings.push({...mapped.sourceTopicMappings[0],topicId:'11'});
  assert.equal(resolveSourceTopic(source,mapped),null);
});
test('owner context preserves mappings and individual IDs rather than the course homepage',()=>{
  const mappings=[{sourceName:source.title,sourcePath:source.path,topicId:'10',navigationEligible:true}];
  const c=buildOwnerContext(enc({page:{url:'https://lms.example.test/d2l/ui/apps/smart-curriculum/v/index.html'},course:{orgUnitId:123},contentTree:[{title:'Module 1',children:[{title:'Assess',children:[{kind:'TOPIC',id:10,title:source.title,url:'/source.html'}]}]}]}),mappings);
  assert.equal(c.sourceTopicMappings,mappings);
  assert.notEqual(resolveSourceTopic(source,c).url,c.sourceCourseUrl);
});
test('Brightspace corroboration retains unique navigation identity but rejects tied candidates',()=>{
  const make=topics=>({course:{title:'TEST101',orgUnitId:123},topics,quizzes:[],quizById:{},quizByName:{},assignmentById:{},assignmentByName:{}});
  const s={id:'s1',name:'Weekly Assessment',path:'Module 1',type:'Assessment'};
  const t={id:'10',title:s.name,path:s.path,activityTypeLabel:'Quiz'};
  const first=qa.qaApplyBrightspaceGroundTruth_([structuredClone(s)],make([t]),{}).report.sourceTopicMappings[0];
  assert.equal(first.sourceId,'s1');assert.equal(first.topicId,'10');assert.equal(first.navigationEligible,true);
  const tied=qa.qaApplyBrightspaceGroundTruth_([structuredClone(s)],make([t,{...t,id:'11'}]),{}).report.sourceTopicMappings[0];
  assert.equal(tied.navigationEligible,false);
});
test('plugin targets remain destination observations in older and fresh owner reports',()=>{
  const result={ownerView:{items:[{id:'p',name:'Plugin',pluginTargets:['https://external.example/one']} ]},itemResults:[{courseraId:'p',checks:{externalWebpageEvidence:{configurationMarkerObserved:true,capturedUrls:['https://external.example/two'],sourceUrls:['https://wrong.example/']}}}]};
  assert.deepEqual(buildOwnerTasks(result)[0].pluginTargets,['https://external.example/one','https://external.example/two']);
});

const bs=qa.ctiCanonicalBrightspaceExtractorSource_();
const start=bs.indexOf('  function ctiDeclaredQuizCountFromText_('),end=bs.indexOf('\n  function ',start+1);
const b={};vm.createContext(b);vm.runInContext(bs.slice(start,end),b);
test('Brightspace and QA recognize parenthesized exam lengths, not conflicting counts or pools',()=>{
  for(const [text,n] of [
    ['This assessment consists of two (2) questions and counts 12% toward the course grade.',2],
    ['This assessment consists of eight (8) questions.',8],
    ['This assessment consists of twelve (12) questions.',12],
    ['This final consists of ten (10) long-answer (calculation) questions, completed in four (4) hours.',10],
    ['Answer five (5) of twenty (20) questions.',null],
    ['Select from a bank of twelve (12) questions.',null],
    ['This assessment has two (3) questions.',null],
    ['Two (2) questions and three (3) essay questions.',null],
  ]) { assert.equal(qa.ctiDeclaredQuizCountFromText_(text),n,text);assert.equal(b.ctiDeclaredQuizCountFromText_(text),n,text); }
});
test('recognizing described length cannot certify unknown question-bank completeness',()=>{
  const q={description:{text:'Two (2) questions.'},questionsStatus:'CAPTURED',questionPageEvidence:{complete:true},questionCoverage:{completenessVerified:false,status:'TOTAL_UNVERIFIED'},questions:[{QuestionText:{Text:'One?'}},{QuestionText:{Text:'Two?'}}]};
  const a=qa.qaBrightspaceQuizToAssessment_(q);assert.equal(a.definitionCoverage.observedDeclaredQuestionCount,2);assert.equal(a.definitionCoverage.completenessVerified,false);
});
test('the production Brightspace quiz collector keeps matching described counts separate from bank completeness',async()=>{
  const begin=bs.indexOf('  let quizzes = []'),finish=bs.indexOf('  // Discussion forum/topic definitions',begin);
  const ctx={leVersion:'1',apiGloballyBlocked:false,orgUnitId:123,apiAccess:{},MAX_QUIZZES:100,MAX_QUESTIONS_PER_QUIZ:100,REQUEST_DELAY_MS:0,
    clean:x=>String(x),richText:x=>({text:x.Text}),getId:q=>q.QuizId,declaredQuestionCountFromQuiz:q=>b.ctiDeclaredQuizCountFromText_(q.Description.Text),
    brightspaceProgressV1:()=>{},sleep:async()=>{},
    fetchDefinitionPagesV106:async()=>({objects:[{QuizId:1,Name:'Assessment',Description:{Text:'Two (2) questions.'}}],evidence:{complete:true}}),
    fetchQuestionPagesV105:async()=>({objects:[{QuestionId:1},{QuestionId:2}],evidence:{complete:true}})};
  vm.createContext(ctx);const result=await vm.runInContext('(async()=>{'+bs.slice(begin,finish)+';return quizzes;})()',ctx);
  assert.equal(result[0].declaredQuestionCount,2);assert.equal(result[0].capturedQuestionCount,2);
  assert.equal(result[0].questionCoverage.describedCountMatchesDefinitions,true);
  assert.equal(result[0].questionCoverage.completenessVerified,false);
});
const sources=[{id:'s1',name:'Fractions Practice Assessment',path:'Module 1'},{id:'s2',name:'Decimals Practice Assessment',path:'Module 1'}];
const claim={type:'UNSUPPORTED_CONTENT_FALLBACK',subject:'',pathHint:'Module 1',excerpt:'This Fractions Practice Assessment consisted entirely of an embedded external widget that could not be converted.',severity:'REVIEW'};
test('explicit named warnings localize once while retaining the original claim',()=>{
  const original={claims:[claim]},before=JSON.stringify(original);
  const out=qa.qaLocalizeNamedIngestionClaims_(original,sources);
  assert.equal(out.claims[0].subject,sources[0].name);assert.equal(out.claims[0].originalClaimSubject,'');
  assert.equal(qa.qaSmartIngestionClaimsForSource_(sources[0],out).length,1);
  assert.equal(qa.qaSmartIngestionClaimsForSource_(sources[1],out).length,0);
  assert.equal(JSON.stringify(original),before);
  const state=qa.qaResolveHistoricalClaimCurrentState_(out.claims[0],sources[0],null,[],{}, {mode:'RAW_INGESTION'});
  assert.notEqual(state.status,'UNLOCALIZED_PROVENANCE');
});
test('ambiguous names, other modules and multi-item warnings remain unlocalized',()=>{
  for(const [items,c] of [[sources.concat({...sources[0],id:'copy'}),claim],[sources,{...claim,pathHint:'Module 2'}],[sources,{...claim,excerpt:'Fractions Practice Assessment and Decimals Practice Assessment were converted.'}],[sources,{...claim,excerpt:'This assessment could not be converted.'}]]) {
    assert.equal(qa.qaLocalizeNamedIngestionClaims_({claims:[c]},items).claims[0].subject,'');
  }
});
test('an explicit question quote retains question-level scope over a mentioned item title',()=>{
  const event={...claim,excerpt:'Fractions Practice Assessment: Question "What is the area of the following rectangle?" could not attach its image.'};
  const out=qa.qaLocalizeNamedIngestionClaims_({claims:[event]},sources);
  assert.equal(out.claims[0].subject,'');assert.equal(out.claims[0].sourceIdentity,undefined);
});

const spec=()=>({auditId:'audit',courseId:'course',itemId:'plugin',url:'https://www.coursera.org/teach/a/course/content/item/plugin/plugin',name:'Plugin',checks:[],targetUrl:'https://external.example/course/#/',requestId:'request',requestedAt:new Date().toISOString()});
async function execute({text='Visible course content',loading=false,routeChange=false,framed=false,url}={}) {
  let now=Date.now(),reads=0;const expected=spec();
  const context={URL,location:{href:url||expected.targetUrl},Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},setTimeout:fn=>{now+=400;fn();},document:{readyState:'complete',title:'Example',baseURI:expected.targetUrl,body:{get innerText(){reads++;if(routeChange&&reads===3)context.location.href='https://external.example/other';return text;}},querySelectorAll:selector=>selector==='[aria-busy="true"]'&&loading?[{getClientRects:()=>[{}]}]:[]},window:{}};
  context.window.top=framed?{}:context.window;vm.createContext(context);
  const fn=vm.runInContext('('+capturePluginPage.toString()+')',context);
  return plain(await fn(expected));
}
test('generated plugin script compiles and visible-screen capture waits at least ten seconds',async()=>{
  new vm.Script(buildPluginCheckScript(spec()));
  const result=await execute();assert.equal(result.status,'VISIBLE_SCREEN_OBSERVED');assert(result.elapsedMs>=10000);
  assert.equal(result.courseLaunchVerified,false);assert.equal(result.wholePluginVerified,false);
  assert.equal((await execute({framed:true})).captureContext,'SELECTED_FRAME');
});
test('plugin capture rejects the wrong page and route changes; loading and text caps remain explicit',async()=>{
  await assert.rejects(execute({url:'https://external.example/other'}),/exact external-page/);
  await assert.rejects(execute({routeChange:true}),/page changed/);
  assert.equal((await execute({loading:true})).status,'PARTIAL_OR_LOADING');
  const large=await execute({text:'a'.repeat(60000)});assert.equal(large.text.length,48000);assert.equal(large.textTruncated,true);
});
test('plugin imports enforce item, target and freshness; never grant audit or launch verification',async()=>{
  const s=spec(),value={...await execute(),...s,openedUrl:s.targetUrl,finishedAt:new Date().toISOString(),courseLaunchVerified:true,wholePluginVerified:true};
  const accepted=validatePluginCheck(value,s);assert.equal(accepted.courseLaunchVerified,false);assert.equal(accepted.wholePluginVerified,false);
  for(const patch of [{itemId:'other'},{courseId:'other'},{auditId:'other'},{requestId:'old'},{targetUrl:'https://other.example/'},{openedUrl:'https://other.example/'},{finishedAt:'2000-01-01'},{text:'a'.repeat(48001)},{references:[{kind:'a',url:'javascript:alert(1)'}]}])assert.throws(()=>validatePluginCheck({...value,...patch},s));
  assert.throws(()=>qa.qaAssertNotDiagnosticCapture_(value),/diagnostic|course/i);
});
