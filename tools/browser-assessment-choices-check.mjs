import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { bundleConsole } from './console-bundle.mjs';
import { extractorFunctions } from './extractor-functions.cjs';
import { CTI_MAX_ITEM_ATTEMPTS } from '../src/extractors/coursera/config.js';

// Real layout is essential here: display:contents has a zero-size container
// while its children remain rendered. A rectangle-only DOM stub misses this.
const definitions = [...extractorFunctions(bundleConsole(path.resolve('src/extractors/coursera/entry.js'))).values()].join('\n');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CTI_CHROMIUM_PATH ? { executablePath: process.env.CTI_CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
try {
  await page.setContent('<main id="editor"></main>');
  await page.addScriptTag({ content: `const CTI_MAX_ITEM_ATTEMPTS=${CTI_MAX_ITEM_ATTEMPTS};\n${definitions}` });
  const result = await page.evaluate(async () => {
    const fp = {id:'survey-fixture',type:'Assignment'};
    const editor = document.getElementById('editor');
    const card = (kind, labels, native=false) => {
      const part = document.createElement('section');
      part.setAttribute('data-testid', 'assignment-part-0');
      part.style.display = 'contents';
      part.innerHTML = `<h3>1 Auto-Graded 0 points</h3><p>Prompt *</p><p>Choose a learning method.</p><p>${kind==='radio'?'Options':'Answers'} *</p>`;
      for (const label of labels) {
        const row = document.createElement('div');
        row.className = 'rc-AssignmentAuthoringOptionsEditor__optionRow';
        row.style.display='contents';
        const control = document.createElement('span');
        control.className = `cds-choiceinput-root cds-choiceinput-checked cds-choiceinput-disabled cds-${kind}input-disabled`;
        control.style.cssText = 'display:inline-block;width:20px;height:20px;';
        control.setAttribute('aria-disabled','true');
        if (native) {
          const input = document.createElement('input');
          input.type=kind; input.disabled=true; input.checked=true;
          input.style.opacity='0';
          control.append(input);
        }
        const text = document.createElement('span'); text.textContent=label;
        const hiddenText=document.createElement('span');
        hiddenText.textContent='Hidden authoring feedback'; hiddenText.style.display='none';
        row.append(control,text,hiddenText); part.append(row);
      }
      part.insertAdjacentHTML('beforeend','<button>Add Variant</button>');
      editor.replaceChildren(part);
      return part;
    };
    const parse = (part) => parseAssignmentPartDomV665(part,fp,1,'');
    const radioPart = card('radio',['Classroom','Live online','Independent study','Hybrid']);
    const partRect = radioPart.getBoundingClientRect();
    const radio = parse(radioPart);
    const checkboxPart = card('checkbox',['Lecture','Video','Reading'],true);
    const checkbox = parse(checkboxPart);
    const labelCases={};
    for(const layout of ['normal','boxless','zero-height','sibling-label','split-inline','missing-label','hidden-label','long-label','ambiguous-row']) {
      const part=card('checkbox',['Independent study','Online'],true);
      for(const row of part.querySelectorAll('.rc-AssignmentAuthoringOptionsEditor__optionRow')) {
        const label=row.children[1];
        if(layout==='normal')row.style.display='flex';
        if(layout==='zero-height')row.style.cssText='display:block;height:0;overflow:visible';
        if(layout==='sibling-label'){
          const option=document.createElement('div'); option.setAttribute('data-testid','option');
          row.before(option); option.append(row,label);
        }
        if(layout==='split-inline' && label.textContent==='Independent study')label.innerHTML='<span>Inde</span><span>pendent</span> <b>study</b>';
        if(layout==='missing-label')label.remove();
        if(layout==='hidden-label')label.style.visibility='hidden';
        if(layout==='long-label')label.textContent='x'.repeat(2500);
      }
      if(layout==='ambiguous-row'){
        const rows=[...part.querySelectorAll('.rc-AssignmentAuthoringOptionsEditor__optionRow')];
        rows[1].children[0].remove();
        rows[0].append(document.createElement('input'));
        rows[0].lastElementChild.type='checkbox';
      }
      labelCases[layout]=unmarkedChoiceProbeV61320(part,fp,1);
    }
    const hidden = [];
    for (const mode of ['display','visibility','opacity','aria-hidden']) {
      const part=card('radio',['First','Second']);
      if(mode==='aria-hidden')editor.setAttribute(mode,'true');
      else editor.style[mode]=({display:'none',visibility:'hidden',opacity:'0'})[mode];
      hidden.push(unmarkedChoiceProbeV61320(part,fp,1));
      editor.removeAttribute('style'); editor.removeAttribute('aria-hidden');
    }
    const mixedPart=card('radio',['First','Second']);
    mixedPart.querySelectorAll('.cds-choiceinput-root')[1].className='cds-choiceinput-root cds-checkboxinput-disabled';
    const mixed=unmarkedChoiceProbeV61320(mixedPart,fp,1);
    const missingPart=card('checkbox',['First','Second']);
    missingPart.querySelectorAll('.cds-choiceinput-root').forEach(el=>el.remove());
    const missing=parse(missingPart);
    const prosePart=card('radio',['First','Second']);
    prosePart.querySelectorAll('p')[1].textContent='Which Answers belong in the response?';
    prosePart.querySelectorAll('.cds-choiceinput-root').forEach(el=>el.remove());
    const prose=parse(prosePart);
    const first=card('radio',['Classroom','Live online','Independent study','Hybrid']);
    const second=card('checkbox',['Lecture','Video','Reading'],true);
    const sidebar=document.createElement('aside');
    sidebar.setAttribute('data-testid','item-layout-left-sidebar');
    sidebar.innerHTML='<p>Assignment outline Content (2)</p>';
    [first,second].forEach((part,i)=>{
      part.id='fixture~q'+(i+1);
      part.setAttribute('data-testid','assignment-part-'+i);
      sidebar.insertAdjacentHTML('beforeend',`<div data-testid="assignment-outline"><span>${i+1}</span><a href="#${part.id}">Choose a learning method.</a></div>`);
    });
    editor.replaceChildren(sidebar,first,second);
    const cycle=await collectAssessmentFromOutlineDomV665(editor,fp,2,{deadline:Date.now()+15000});
    fp.payload={captureAttempts:1,structuredAssessment:cycle.assessment,nativeAssignment:{
      parserConfidence:0.92,settings:{gradeSetting:'Practice'},currentStateEvidence:{editorSurfaceObserved:true},
    }};
    const contract=captureContractV6150(fp);
    const compact=compactDiagnosticV6150({unmarkedChoiceProbes:[{
      ...unmarkedChoiceProbeV61320(first,fp,1),
      controls:Array.from({length:80},()=>({type:'radio',accepted:false,reason:'HIDDEN_CONTAINER',depth:5,privateText:'do not retain'})),
    }]},fp);
    return {partRect:{width:partRect.width,height:partRect.height},radio,checkbox,labelCases,hidden,mixed,missing,prose,cycle,contract,compact};
  });
  assert.equal(result.partRect.width,0);
  assert.equal(result.partRect.height,0);
  for(const [name,type,labels] of [
    ['radio','single-select',['Classroom','Live online','Independent study','Hybrid']],
    ['checkbox','multiple-select',['Lecture','Video','Reading']],
  ]) {
    const q=result[name];
    assert.equal(q.type,type,`${name}: visible choices inside a boxless part must be captured`);
    assert.equal(q.prompt,'Choose a learning method.');
    assert.deepEqual(q.options.map(o=>o.text),labels);
    assert(q.options.every(o=>o.correct===null),'disabled/checked presentation is not an answer key');
    assert.equal(q.points,0,'zero points is distinct from unknown');
    assert.equal(q.optionTextReliable,true);
    assert.equal(q.answerTextReliable,false);
    assert.deepEqual(q.correctAnswers,[]);
  }
  assert(result.hidden.every(p=>p.question===null),'hidden ancestry must remain rejected');
  assert(result.hidden.every(p=>p.controls.every(c=>c.reason==='HIDDEN_CONTAINER')));
  assert.equal(result.mixed.reason,'MIXED_CHOICE_CONTROLS');
  assert.equal(result.mixed.question,null);
  assert.equal(result.missing.type,'unknown');
  assert.equal(result.missing.prompt,'Choose a learning method.');
  assert.equal(result.prose.prompt,'Which Answers belong in the response?');
  for(const layout of ['normal','boxless','zero-height','sibling-label','split-inline']) {
    assert.equal(result.labelCases[layout].status,'CHOICES_CAPTURED',layout);
    assert.deepEqual(result.labelCases[layout].question.options.map(o=>o.text),['Independent study','Online'],layout);
  }
  for(const layout of ['missing-label','hidden-label','long-label','ambiguous-row'])
    assert.equal(result.labelCases[layout].question,null,layout);
  assert.equal(result.labelCases['long-label'].labels[0].reason,'LABEL_SCAN_LIMIT');
  assert.equal(result.cycle.questionCount,2);
  assert.deepEqual(result.cycle.assessment.questions.map(q=>q.options.length),[4,3]);
  assert(result.cycle.assessment.questions.every(q=>q.questionOrdinalObserved && q.options.every(o=>o.correct===null)));
  assert.equal(result.cycle.captureCompleteness.questionCoverageComplete,true);
  assert.equal(result.cycle.captureCompleteness.requiredAnswerCoverageComplete,false);
  assert.equal(result.contract.status,'UNRESOLVED_ANSWER_APPLICABILITY_REVIEW');
  assert.equal(result.contract.complete,false);
  const diagnostics=result.compact.unmarkedChoiceProbes[0].controls;
  assert.equal(diagnostics.length,16);
  assert(diagnostics.every(d=>d.reason==='HIDDEN_CONTAINER' && !('privateText' in d)));
  assert(result.compact.unmarkedChoiceProbes[0].labels.every(d=>d.reason==='RENDERED_OPTION_TEXT' && !('text' in d)));
  const times = await page.evaluate(() => {
    const editor=document.getElementById('editor');
    const check=(html)=>{editor.innerHTML=html;return collectCourseraTimeEstimate(editor);};
    const labeled=check('<label for="duration">Time estimate (minutes)</label><input id="duration" value="25">');
    const adjacent=check('<div><span>Time estimate</span><input value="15"><span>minutes</span></div>');
    const zero=check('<input aria-label="Time estimate (minutes)" value="0">');
    const hours=check('<input aria-label="Time estimate" value="1 h 30 min">');
    const conflict=check('<input aria-label="Time estimate (minutes)" value="10"><input aria-label="Time estimate (minutes)" value="20">');
    const rejected=[
      '<p>Question 1: estimate 25 minutes.</p><input value="25">',
      '<input aria-label="Time limit (minutes)" value="25">',
      '<input aria-label="Time estimate (minutes)" value="">',
      '<input aria-label="Time estimate" value="25">',
      '<input style="display:none" aria-label="Time estimate (minutes)" value="25">',
      '<div contenteditable="true">Time estimate 25 minutes</div>',
      '<div data-testid="assignment-part-0"><input aria-label="Time estimate (minutes)" value="25"></div>',
    ].map(check);
    editor.innerHTML='<span>Reading about time</span><span>12 min</span>';
    const outline=collectOutlineTimeEstimate(editor,'Reading about time');
    editor.innerHTML='<span>10 min</span>';
    const titleOnly=collectOutlineTimeEstimate(editor,'10 min');
    const target={timeEstimateMinutes:12};mergeEvidence(target,labeled);
    return {labeled,adjacent,zero,hours,conflict,rejected,outline,titleOnly,merged:target};
  });
  assert.equal(times.labeled.timeEstimateMinutes,25);
  assert.equal(times.adjacent.timeEstimateMinutes,15);
  assert.equal(times.zero.timeEstimateMinutes,0);
  assert.equal(times.hours.timeEstimateMinutes,90);
  assert.equal(times.conflict.timeEstimateState,'CONFLICT');
  assert.equal(times.conflict.timeEstimateMinutes,null);
  assert(times.rejected.every(r=>!('timeEstimateMinutes' in r)),'unlabeled, blank, hidden and learner-prose durations are not evidence');
  assert.equal(times.outline.timeEstimateMinutes,12);
  assert.deepEqual(times.titleOnly,{});
  assert.equal(times.merged.timeEstimateMinutes,25,'fresh editor setting replaces earlier outline estimate');
  console.log('PASS: real-browser labeled time controls, unit conversion, explicit zero, stale-outline replacement, conflicts and rejected ambiguous/prose values.');
  console.log('PASS: real-browser boxless question containers, disabled radio/checkbox choices, unknown keys, zero points, hidden ancestry, mixed controls, prompt boundaries, full outline traversal, strict completion, and bounded diagnostics.');
} finally {
  await browser.close();
}
