import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {bundleConsole} from '../tools/console-bundle.mjs';
import {extractorFunctions} from '../tools/extractor-functions.cjs';

const {fixture,El}=createRequire(import.meta.url)('../tools/assessment-fixture.cjs');
const definitions=extractorFunctions(bundleConsole(new URL('../src/extractors/coursera/entry.js',import.meta.url).pathname));
const clone=value=>JSON.parse(JSON.stringify(value));
function card(n,ready=true){
 const part=new El('section',{id:'assessment~q'+n,'data-testid':'assignment-part-'+(n-1)});
 part.append(new El('h3',{},n+'Auto-Graded 1 point'),new El('p',{},'Question Type Multiple Choice Prompt'),
  new El('p',{},'Which result is correct for scenario '+n+' in this assessment?'),new El('p',{},'Options'));
 if(ready)for(const [text,badge] of [['Correct choice '+n,'Correct'],['Wrong choice '+n,'Incorrect']]){
  const option=new El('div',{'data-testid':'option'});option.append(new El('p',{},text),new El('span',{},badge));part.append(option);
 }
 part.append(new El('p',{},'Export Settings'));return part;
}
function setup(count=609){
 const f=fixture({count,windowSize:27});
 for(const name of ['assessmentBodyCandidatesV61533','hydrateObservedBodyQuestionV61533','collectAssessmentFromOutlineDomV665']){
  assert(definitions.has(name),name);vm.runInContext(definitions.get(name),f.c);
 }
 delete f.content.attrs['data-testid'];
 f.content.replaceChildren(...Array.from({length:count},(_,i)=>card(i+1,i<27)));
 return f;
}

test('actual complete generic-body inventory includes 609 ordered witnesses despite only 27 labeled rail rows',()=>{
 const f=setup(),inventory=f.c.assessmentBodyCandidatesV61533(f.envelope,f.fp);
 assert.equal(inventory.complete,true);assert.equal(inventory.declared,609);assert.equal(inventory.candidates.length,609);
 assert.equal(inventory.content,f.content);assert.equal(inventory.sidebar,f.sidebar);
 assert(inventory.candidates.every((c,i)=>c.id==='assessment~q'+(i+1) && c.ordinal===i+1 && c.witness===f.content.children[i]));
 assert.equal(inventory.candidates[26].href,'#assessment~q27');assert.equal(inventory.candidates[27].href,'');
 assert.equal(inventory.candidates[27].anchor,null);assert.equal(inventory.candidates[27].question,undefined,
  'Body identity alone never copies a saved prompt or answer key');
 assert.equal(f.clicks(),0);assert.equal(f.mutations(),0);
});

test('body inventory rejects duplicate IDs, missing ordinals, changed declared counts and mismatched pins',()=>{
 const f=setup(30),original=f.content.children[29];
 assert.equal(f.c.assessmentBodyCandidatesV61533(f.envelope,f.fp,{sidebar:f.sidebar,content:new El('div')}).complete,false);
 f.envelope.append(new El('section',{id:'assessment~q30'}));
 assert.equal(f.c.assessmentBodyCandidatesV61533(f.envelope,f.fp).reason,'AMBIGUOUS_OBSERVED_BODY_INVENTORY');
 f.envelope.children.at(-1).remove();original.setAttribute('data-testid','assignment-part-28');
 assert.equal(f.c.assessmentBodyCandidatesV61533(f.envelope,f.fp).complete,false);
 original.setAttribute('data-testid','assignment-part-29');f.sidebar.children[0].textContent='Assignment outline Content (29)';
 assert.equal(f.c.assessmentBodyCandidatesV61533(f.envelope,f.fp).complete,false);
 assert.equal(f.clicks(),0);assert.equal(f.mutations(),0);
});

test('body hydrator scrolls an actual unresolved target and parses current explicit keys without activating controls',async()=>{
 const f=setup(30),candidate=f.c.assessmentBodyCandidatesV61533(f.envelope,f.fp).candidates[29];let scrolls=0;
 candidate.target.scrollIntoView=()=>{scrolls++;candidate.target.replaceChildren(...card(30,true).childNodes);};
 const hydrated=await f.c.hydrateObservedBodyQuestionV61533(candidate,f.fp,10000);
 assert.equal(hydrated.stopReason,'OBSERVED_BODY_QUESTION_READY');assert.equal(hydrated.target,candidate.target);
 assert.equal(hydrated.scrolled,true);assert.equal(hydrated.clicked,false);assert.equal(scrolls,1);
 assert.deepEqual(clone(hydrated.question.correctAnswers),['Correct choice 30']);
 assert.equal(f.clicks(),0);assert.equal(f.mutations(),0);
});

test('current complete body evidence is parsed directly without scrolling, while stale witnesses are refused',async()=>{
 const f=setup(30),inventory=f.c.assessmentBodyCandidatesV61533(f.envelope,f.fp),candidate=inventory.candidates[0];let scrolls=0;
 candidate.target.scrollIntoView=()=>scrolls++;
 const mounted=await f.c.hydrateObservedBodyQuestionV61533(candidate,f.fp,10000);
 assert.equal(mounted.stopReason,'OBSERVED_BODY_QUESTION_READY');assert.equal(scrolls,0);
 candidate.target.setAttribute('data-testid','assignment-part-9');
 const stale=await f.c.hydrateObservedBodyQuestionV61533(candidate,f.fp,10000);
 assert.equal(stale.stopReason,'BODY_WITNESS_NOT_CURRENT');assert.equal(stale.question,null);assert.equal(scrolls,0);
 assert.equal(f.clicks(),0);assert.equal(f.mutations(),0);
});

test('an observed body ID with no explicit accepted answer remains incomplete',async()=>{
 const f=setup(30),candidate=f.c.assessmentBodyCandidatesV61533(f.envelope,f.fp).candidates[29];
 candidate.target.scrollIntoView=()=>{};
 const incomplete=await f.c.hydrateObservedBodyQuestionV61533(candidate,f.fp,10000);
 assert.equal(incomplete.stopReason,'OBSERVED_BODY_EVIDENCE_INCOMPLETE');
 assert.notEqual(incomplete.question?.answerTextReliable,true);
 assert.equal(f.c.questionEvidenceReadyV6138(incomplete.question),false);
 assert.equal(f.clicks(),0);assert.equal(f.mutations(),0);
});

function seedPrecedenceFixture(priorPrompt,currentPrompt,currentReady=false){
 const f=setup(1),anchor=f.sidebar.querySelector('a'),priorChoice='Previously observed accepted choice',currentChoice='Currently observed accepted choice';
 function mount(prompt,ready,choice){
  const part=card(1,ready);part.children[2].textContent=prompt;
  if(ready)part.querySelector('[data-testid="option"]').children[0].textContent=choice;
  f.content.replaceChildren(part);anchor.textContent=prompt;
  const question=f.c.parseAssignmentPartDomV665(part,f.fp,1,prompt);
  assert.equal(question.prompt,prompt);
  return {questions:[{...question,courseraQuestionId:part.id,questionOrdinalObserved:true,observedAtMs:f.now()}]};
 }
 const seedAssessment=mount(priorPrompt,true,priorChoice),mountedAssessment=mount(currentPrompt,currentReady,currentChoice);
 let activations=0;
 anchor.onClick=()=>{activations++;mount(currentPrompt,true,currentChoice);};
 return {...f,seedAssessment,mountedAssessment,priorChoice,currentChoice,activations:()=>activations,
  collect:()=>f.c.collectAssessmentFromOutlineDomV665(f.envelope,f.fp,1,{deadline:10000,
   seedAssessment,mountedAssessment,resumeInProgress:true})};
}

test('resuming a current prompt-only placeholder retains its matching durable answer without reactivation',async()=>{
 const prompt='Which accepted choice belongs to this unchanged current question?';
 const f=seedPrecedenceFixture(prompt,prompt),result=await f.collect();
 assert.equal(result.stopReason,'COMPLETE');assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.deepEqual(clone(result.assessment.questions[0].correctAnswers),[f.priorChoice]);
 assert.equal(result.assessment.questions[0].prompt,prompt);assert.equal(f.activations(),0);assert.equal(f.mutations(),0);
});

test('changed operator and non-Latin prompts invalidate old keys and hydrate the actual current question',async()=>{
 for(const [priorPrompt,currentPrompt] of [
  ['What is the numerical result of 5 + 3 in this problem?','What is the numerical result of 5 − 3 in this problem?'],
  ['日本語で選びなさい. Choose the correct option for this scenario.','中国語で選びなさい. Choose the correct option for this scenario.']
 ]){
  const f=seedPrecedenceFixture(priorPrompt,currentPrompt);
  assert.equal(f.c.assessmentPromptKey_(priorPrompt),f.c.assessmentPromptKey_(currentPrompt),
   'The historical outline normalizer cannot distinguish this real prompt change');
  const result=await f.collect();
  assert.equal(result.stopReason,'COMPLETE');assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
  assert.equal(result.assessment.questions[0].prompt,currentPrompt);
  assert.deepEqual(clone(result.assessment.questions[0].correctAnswers),[f.currentChoice]);
  assert.equal(f.activations(),1,'The changed current placeholder must acquire its own explicit accepted answer');
  assert.equal(f.mutations(),0);
 }
});

test('newly ready current evidence replaces the saved key without navigating the question again',async()=>{
 const prompt='Which accepted choice belongs to this unchanged current question?';
 const f=seedPrecedenceFixture(prompt,prompt,true),result=await f.collect();
 assert.equal(result.stopReason,'COMPLETE');assert.equal(result.assessment.captureCompleteness.requiredAnswerCoverageComplete,true);
 assert.deepEqual(clone(result.assessment.questions[0].correctAnswers),[f.currentChoice]);
 assert.equal(result.assessment.questions[0].prompt,prompt);assert.equal(f.activations(),0);assert.equal(f.mutations(),0);
});
