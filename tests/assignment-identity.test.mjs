import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {fixture,El,functionCode}=require('../tools/assessment-fixture.cjs');
const qa=require('../tools/check.cjs');
import {buildPostQaText_} from '../src/reporting/owner-report.js';

const reflection='Answer the following 3 questions: 1. What did you observe? 2. What would you change? 3. Explain your reasoning in one journal entry.';

test('Generic item titles in a module overview cannot stop item navigation',()=>{
  const f=fixture({count:1});f.envelope.remove();
  f.c.URL=URL;f.c.location={href:'https://www.coursera.org/teach/fixture/course-fixture/content/edit',origin:'https://www.coursera.org'};
  const overview=new El('div',{'data-testid':'module-description'});
  overview.append(new El('h3',{},'Course Content & Learning Resources'),new El('input'),new El('p',{},
    'Engage with core learning resources such as the participant workbook, review emergency vest colors, and complete practical scenario-based assignments and summative assessments.'));
  f.c.document.body.append(overview);
  const fp={id:'blyBd',type:'Assignment',typeName:'staffGraded',name:'Assignment'};
  assert.equal(f.c.findOpenedEditorSurface(fp,[overview],null,new Set(),true),null);
  assert.equal(f.c.genericSurfaceNeedsPayloadUpgrade(fp,null),true,'the existing safe navigation fallback must remain eligible');
  for(const name of ['Assignment','Assessment','Quiz','New Reading','Untitled']) {
    overview.replaceChildren(new El('h3',{},name),new El('input'));
    assert.equal(f.c.findOpenedEditorSurface({...fp,name},[overview],null,new Set(),true),null,`${name}: a generic heading is not an item editor`);
  }
});

test('An exact published assignment layout is accepted without editable inputs or reactivation',()=>{
  const f=fixture({count:1});f.fp.name='Assignment';
  f.c.URL=URL;
  f.c.location={href:'https://www.coursera.org/teach/fixture/course-fixture/content/item/staffGraded/assessment-under-test',pathname:'/teach/fixture/course-fixture/content/item/staffGraded/assessment-under-test',origin:'https://www.coursera.org'};
  const surface=f.c.findOpenedEditorSurface(f.fp,[f.content],null,new Set(),true);
  assert(surface,'a bounded published layout on the exact course/item route is usable');
  assert.equal(f.c.genericSurfaceNeedsPayloadUpgrade(f.fp,surface),false);
  assert.equal(f.c.findOpenedEditorSurface({...f.fp,id:'another-item'},[f.content],null,new Set(),true),null,'a different item route does not prove this generic assignment');
  f.envelope.remove();
  assert.equal(f.c.findOpenedEditorSurface(f.fp,[f.content],null,new Set(),true),null,'a disconnected old editor cannot be reused');
});

test('Generic dialog fallback still requires a strong item session and independent editor signals',()=>{
  const f=fixture({count:1});f.envelope.remove();
  const dialog=new El('div',{role:'dialog','aria-label':'Reading editor'});
  dialog.append(new El('textarea',{},'Teaching content. '.repeat(12)));
  f.c.document.body.append(dialog);
  const fp={id:'reading-under-test',type:'Reading',name:'New Reading'};
  assert(f.c.findOpenedEditorSurface(fp,[dialog],null,new Set(),true));
  assert.equal(f.c.findOpenedEditorSurface(fp,[dialog],null,new Set(),false),null);
});

function reflectivePart(n=1,{type='Reflective text answer',bounded=true}={}) {
  const p=new El('div',{id:'assessment~q'+n,'data-testid':'assignment-part-'+(n-1)});
  p.append(new El('h3',{},n+'Auto-Graded 1 point'),new El('h3',{'data-testid':'read-only-label'},'Question Type'),
    new El('select',{'data-testid':'read-only-value',disabled:''},type));
  const field=new El('div',bounded?{'data-testid':'prompt-editor'}:{});
  field.append(new El('h3',{},'Prompt'));
  field.append(new El('div',bounded?{'data-testid':'cml-viewer'}:{},reflection));p.append(field);return p;
}
function mount(f,parts,prompt=reflection){
  // Different ancestor tails previously produced separate prompt-only cards.
  const inner=new El('div'),outer=new El('div');inner.append(...parts,new El('div',{},'Export'));
  outer.append(inner,new El('div',{},'Settings Grade setting Practice'));f.content.replaceChildren(outer);
  for(const a of f.sidebar.querySelectorAll('a[href^="#"]'))a.textContent=prompt.slice(0,47);
}
test('Published reflection remains one identified question through the full capture path',async()=>{
  const f=fixture({count:1});mount(f,[reflectivePart()]);
  const wide=f.c.collectCourseraStructuredAssessment(f.envelope,f.fp);
  assert.equal(wide.questionCount,1);assert.equal(wide.declaredQuestionCount,1);
  const run=await f.runFull(),a=run.assessment,q=a.questions[0];
  assert.equal(a.questionCount,1);assert.equal(a.declaredQuestionCount,1);
  assert.equal(q.courseraQuestionId,'assessment~q1');assert.equal(q.type,'essay');assert.equal(q.prompt,reflection);
  assert.equal(a.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert.equal(a.captureCompleteness.answerEvidence,0);assert.equal(a.captureCompleteness.answerCoverageComplete,false);
  assert.equal(run.clicks,0);assert.equal(f.mutations(),0);
});
test('Identical prompts with different part IDs remain distinct; duplicate DOM IDs do not multiply questions',()=>{
  const f=fixture({count:2});mount(f,[reflectivePart(1),reflectivePart(2),reflectivePart(1)]);
  const a=f.c.collectCourseraStructuredAssessment(f.envelope,f.fp);
  assert.equal(a.questions.length,2);assert.equal(new Set(a.questions.map(q=>q.courseraQuestionId)).size,2);
  assert.equal(a.captureCompleteness.questionCoverageComplete,true);
});
test('Mounted subset and unknown reflective type keep evidence gaps',()=>{
  const f=fixture({count:3});mount(f,[reflectivePart(1)]);
  const a=f.c.collectCourseraStructuredAssessment(f.envelope,f.fp);
  assert.equal(a.declaredQuestionCount,3);assert.equal(a.questionCount,1);
  assert.equal(a.captureCompleteness.questionCoverageComplete,false);
  for(const options of [{type:'Short answer'},{bounded:false}]) {
    const part=reflectivePart(1,options);mount(f,[part]);
    assert.equal(f.c.parseWrittenResponsePartV6136(part,1),null);
  }
});
test('Observed file-upload heading keeps grader/rubric text outside the learner prompt',async()=>{
  const prompt='Upload your documented observations and justify the next action.';
  const f=fixture({count:1}),part=new El('div',{id:'assessment~q1','data-testid':'assignment-part-0'});
  part.append(new El('h3',{},'1AI-Graded File Upload Question'),new El('p',{},'Prompt'),new El('p',{},prompt),
    new El('h3',{},'AI Grader Instructions (Not shown to learners)'),new El('div',{},'Rubric text only for the grader.'));
  mount(f,[part],prompt);const before=part.textContent,run=await f.runFull(),q=run.assessment.questions[0];
  assert.equal(q.type,'file-upload');assert.equal(q.prompt,prompt);
  assert.match(q.promptBoundaryEvidence.rawPrompt,/Rubric text only/);
  assert.equal(run.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert.equal(run.assessment.captureCompleteness.answerEvidence,0);
  assert.equal(part.textContent,before);assert.equal(run.clicks,0);assert.equal(f.mutations(),0);
  part.textContent='1Auto-Graded 1 point Question Type Short answer Prompt Describe an AI-Graded File Upload Question. AI Grader Instructions (Not shown to learners)';
  assert.equal(f.c.parseWrittenResponsePartV6136(part,1),null);
});
test('Unknown questions cannot be called fully hydrated solely because there is only one',()=>{
  const f=fixture({count:1});
  assert.equal(f.c.assessmentIsFullyAnswerHydratedV667({declaredQuestionCount:1,questions:[{id:'1',type:'unknown',prompt:'Response required.'}]}),false);
});
test('A stale broad-parser hint cannot inflate a structurally declared outline count',async()=>{
  const f=fixture({count:1});const a=await f.c.collectAssessmentFromOutlineDomV665(f.envelope,f.fp,3,{deadline:45000});
  assert.equal(a.assessment.declaredQuestionCount,1);assert.equal(a.assessment.questions.length,1);
});
function pluginRoot(){const root=new El('div');root.documentRoot=true;
  root.append(new El('div',{},'PLUGIN Resource centre External Webpage'),new El('button',{},'View Configuration'));return root;}
test('Published External Webpage recognition requires the configuration control',()=>{
  const root=pluginRoot(),f=fixture({count:1});
  f.c.location={href:'https://example.test/course/item/plugin/resources'};
  Object.assign(f.c,{URL,isAuthoringChromeUrl:()=>false,isCourseraUiAssetUrl:()=>false,
    visiblePluginConfigurationV61316:()=>({values:[],editorCount:0,parseFailures:0}),
    extractConfiguredExternalUrls:()=>[],reactPropsForElement:()=>null});
  vm.runInContext(functionCode('collectPluginEvidenceV6139'),f.c);
  const p=f.c.collectPluginEvidenceV6139(root,{id:'resources',type:'Plugin'});
  assert.equal(p.kind,'EXTERNAL_WEBPAGE');assert.equal(p.launchStatus,'NOT_VERIFIED');
  root.querySelector('button').remove();assert.equal(f.c.collectPluginEvidenceV6139(root,{id:'resources',type:'Plugin'}).kind,'PLUGIN');
});
test('Existing published capture can verify the exact plugin target while launch stays unverified',()=>{
  const source={type:'Reading',sourceTypeRaw:'imswl_xmlv1p1',sourceLinkUrls:['https://example.test/resource/#/']};
  const destination={id:'resources',type:'Plugin',linkEvidenceConfidence:.97,
    original:{payload:{textScopeKind:'scoped-subtree',textSample:'PLUGIN Resource centre External Webpage View Configuration Settings Time estimate in minutes',
      links:['https://example.test/resource/#/'],pluginEvidence:{itemId:'resources',scope:'ITEM_EDITOR',kind:'PLUGIN',targets:[{url:'https://example.test/resource/#/',method:'FRAME_SRC'}]}}}};
  const result=qa.qaExternalWebpageEvidence_(source,destination);
  assert.equal(result.status,'VERIFIED_CONFIGURATION');assert.equal(result.launchStatus,'NOT_OBSERVED');
  for(const patch of [{textScopeKind:'generic-root'},{pluginEvidence:{itemId:'other',scope:'ITEM_EDITOR',kind:'PLUGIN'}},{textSample:'This prose refers to External Webpage and View Configuration.'}]) {
    const d=structuredClone(destination);Object.assign(d.original.payload,patch);
    assert.equal(qa.qaExternalWebpageEvidence_(source,d).reasonCode,'PLUGIN_CONFIGURATION_UNOBSERVED');
  }
  const d=structuredClone(destination);d.original.payload.links=['https://example.test/different/#/'];
  assert.equal(qa.qaExternalWebpageEvidence_(source,d).reasonCode,'LAUNCH_URL_DIFFERS');
});

test('Owner diagnostics separate duplicate records and non-applicable answer keys',()=>{
  function report(qc){return buildPostQaText_({success:true,summary:{},itemResults:[],missing:[],injected:[],
    stats:{extractorMeta:{activeSpaCrawl:{targetDiagnostics:[{id:'one',name:'Assessment',questionCycleCaptureCompleteness:qc}]}}}});}
  const duplicate=report({declared:3,captured:3,uniqueQuestionIds:1,questionCoverageComplete:false,answerEvidence:0,requiredAnswerCoverageComplete:false,missingQuestionOrdinals:[2,3]});
  assert.match(duplicate,/question records=3\/3 \| unique question IDs=1 \| question coverage=NO/);
  assert.match(duplicate,/Question positions absent at this intermediate stage: 2, 3/);
  const written=report({declared:1,captured:1,uniqueQuestionIds:1,questionCoverageComplete:true,answerEvidence:0,answerCoverageComplete:false,requiredAnswerCoverageComplete:true,answerKeyNotApplicableQuestionOrdinals:[1],missingRequiredAnswerOrdinals:[],unansweredQuestionOrdinals:[1]});
  assert.match(written,/answer keys=0\/0 \| applicable evidence complete=YES/);
  assert.match(written,/Answer key not applicable at positions: 1/);
  assert.doesNotMatch(written,/Positions without reliable answer keys at this intermediate stage: 1/);
});

test('An unresolved single question is retained without a completeness claim',async()=>{
  const f=fixture({count:1});mount(f,[reflectivePart(1,{type:'Unsupported response'})]);
  f.sidebar.querySelector('a[href^="#"]').onClick=()=>{};
  const run=await f.runFull();assert.equal(run.assessment.questions.length,1);
  assert.equal(run.assessment.questions[0].courseraQuestionId,'assessment~q1');
  assert.equal(run.assessment.captureCompleteness.requiredAnswerCoverageComplete,false);
  assert.equal(f.mutations(),0);
});
